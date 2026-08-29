// Browser-consent connect flow: shared between options.ts (where the user clicks a "Connect"
// button, i.e. where the trusted user gesture originates) and background.ts (which actually runs
// the flow). It has to live in the service worker, not the options page, because
// chrome.identity.launchWebAuthFlow()'s interactive auth window steals focus and closes the
// extension's page mid-await - the same focus-loss behavior the plain chrome.permissions.request()
// prompt already shows. Running the whole chain (permission request, auth window, token exchange)
// in the service worker means it survives regardless of what happens to the calling page once
// either dialog opens.
//
// Parameterized by audience (unlike the pre-merge studylife-focusguard/studylife-focustunes, each
// of which only ever spoke to its own single audience): Guard and Tune are still two entirely
// separate, separately-consented server-side identities (identity contract v1 §2, audiences
// "focusguard" and "focustunes") - merging the two EXTENSIONS into one browser extension didn't
// merge those two audiences, so this flow still runs twice, independently, once per feature tab.

export type ConnectAudience = "focusguard" | "focustunes";

export function connectMessageType(audience: ConnectAudience): string {
  return `studylife-focus:connect:${audience}`;
}

export interface ConnectMessage {
  type: string;
  audience: ConnectAudience;
  serverUrl: string;
}

export function isConnectMessage(message: unknown): message is ConnectMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; audience?: unknown; serverUrl?: unknown };
  return (
    typeof candidate.type === "string" &&
    (candidate.audience === "focusguard" || candidate.audience === "focustunes") &&
    candidate.type === connectMessageType(candidate.audience) &&
    typeof candidate.serverUrl === "string"
  );
}

export type ConnectResult =
  | { ok: true; serverUrl: string }
  | { ok: false; kind: "invalid-url" }
  | { ok: false; kind: "permission-denied" }
  | { ok: false; kind: "cancelled" }
  | { ok: false; kind: "auth-window-failed"; message: string }
  | { ok: false; kind: "invalid-redirect" }
  | { ok: false; kind: "state-mismatch" }
  | { ok: false; kind: "server-outdated" }
  | { ok: false; kind: "offline" }
  | { ok: false; kind: "exchange-failed"; message: string };

// Pure and exported specifically so it's unit-testable without any chrome.* mocking - parses the
// redirect chrome.identity.launchWebAuthFlow() hands back
// (<redirect_uri>?assertion=..&state=..) and checks the state round-trips, guarding against a
// forged or replayed redirect landing on the extension's own chromiumapp.org callback URL.
export function parseAuthRedirect(
  responseUrl: string,
  expectedState: string,
): { ok: true; assertion: string } | { ok: false; kind: "invalid-redirect" | "state-mismatch" } {
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    return { ok: false, kind: "invalid-redirect" };
  }
  const assertion = parsed.searchParams.get("assertion");
  const state = parsed.searchParams.get("state");
  if (!assertion || !state) {
    return { ok: false, kind: "invalid-redirect" };
  }
  if (state !== expectedState) {
    return { ok: false, kind: "state-mismatch" };
  }
  return { ok: true, assertion };
}

// Single source of truth for the connect flow's user-facing text, so background.ts's notification
// (the reliable channel, since the options page is expected to close mid-flow - see above) and
// options.ts's inline status (a best-effort extra, shown only if the page happens to survive)
// never drift into inconsistent wording for the same outcome.
export function describeConnectResult(result: ConnectResult): string {
  if (result.ok) {
    return "Connected to StudyLife.";
  }
  switch (result.kind) {
    case "invalid-url":
      return "Enter a valid server URL, e.g. https://studylife.example.com";
    case "permission-denied":
      return "Permission to access this server was denied - try connecting again and allow access when prompted.";
    case "cancelled":
      return "Connection cancelled.";
    case "auth-window-failed":
      return `Couldn't open StudyLife's login page: ${result.message}`;
    case "invalid-redirect":
      return "StudyLife's response was missing the expected data - try connecting again.";
    case "state-mismatch":
      return "Couldn't verify the connection response - try connecting again.";
    case "server-outdated":
      return "This StudyLife server doesn't support browser connect yet - update the server, then try again.";
    case "offline":
      return "You're offline - connect again once you're back online.";
    case "exchange-failed":
      return `Couldn't complete the connection: ${result.message}`;
  }
}

// Called from options.ts inside the Connect button's own user gesture (permissions.request throws
// outside one) - requests access to exactly the one server ORIGIN being connected to (base URL
// only, "/*" covers every path/subpage under it), no broader host_permissions declared upfront
// (see manifest.json). Persists once granted, so this is a no-op on every later call unless the
// user points the extension at a different origin - including the SECOND feature's connect, since
// both features share the same server origin.
export async function requestHostPermission(origin: string): Promise<boolean> {
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}

// Page-death handoff for the connect flow: the host-permission prompt steals focus and closes
// the options page, killing its JS BETWEEN the user's grant and the sendMessage that would start
// the auth flow. So the page stakes a pending-connect marker BEFORE prompting, and background.ts's
// chrome.permissions.onAdded listener takes it from there: grant lands -> the service worker
// consumes the marker and opens the auth window itself, page survival not required. take* is
// consume-once and TTL-bound so a stale marker from an abandoned attempt can't fire minutes later
// on an unrelated permission grant. Keyed by audience so a Guard connect in flight can never be
// mistaken for (or clobbered by) a Tune connect started moments later, or vice versa.
const PENDING_CONNECT_TTL_MS = 2 * 60 * 1000;

function pendingConnectKey(audience: ConnectAudience): string {
  return `pendingConnect:${audience}`;
}

export async function setPendingConnect(audience: ConnectAudience, serverUrl: string): Promise<void> {
  await chrome.storage.local.set({ [pendingConnectKey(audience)]: { serverUrl, ts: Date.now() } });
}

export async function clearPendingConnect(audience: ConnectAudience): Promise<void> {
  await chrome.storage.local.remove(pendingConnectKey(audience));
}

// grantedOrigins: the origins of the permission grant that woke the caller - the marker is only
// consumed when it actually belongs to one of them, so an unrelated grant (e.g. for a different
// server origin) can neither trigger nor destroy a pending connect. A malformed or expired
// marker is always cleaned up. Checks BOTH audiences' markers (either or both could legitimately
// be pending against the same origin grant, if the user started both connects in quick succession
// before either permission prompt resolved) and returns whichever audience/serverUrl pairs match.
export async function takePendingConnects(
  grantedOrigins: readonly string[],
): Promise<{ audience: ConnectAudience; serverUrl: string }[]> {
  const audiences: ConnectAudience[] = ["focusguard", "focustunes"];
  const results: { audience: ConnectAudience; serverUrl: string }[] = [];
  for (const audience of audiences) {
    const key = pendingConnectKey(audience);
    const stored = (await chrome.storage.local.get(key))[key] as { serverUrl?: unknown; ts?: unknown } | undefined;
    if (!stored) continue;
    if (typeof stored.serverUrl !== "string" || typeof stored.ts !== "number"
        || Date.now() - stored.ts > PENDING_CONNECT_TTL_MS) {
      await chrome.storage.local.remove(key);
      continue;
    }
    let origin: string;
    try {
      origin = `${new URL(stored.serverUrl).origin}/*`;
    } catch {
      await chrome.storage.local.remove(key);
      continue;
    }
    if (!grantedOrigins.includes(origin)) continue;
    await chrome.storage.local.remove(key);
    results.push({ audience, serverUrl: stored.serverUrl });
  }
  return results;
}
