import { normalizeServerUrl, type FeatureSettings } from "./settings";

// Wire shape of StudyLife.Shared.Dtos.TimerStateDto (GET /api/timerstate) - only the fields either
// feature actually reads are declared (Guard needs all three; Tune only ever reads isRunning, but
// shares this same payload type and endpoint). scripts/contract-check.mjs diffs TIMER_STATE_FIELDS
// below against the committed OpenAPI spec's TimerStateDto schema, so a server-side field rename
// fails CI here instead of silently breaking polling once a build reaches users.
export interface TimerStateDtoPayload {
  isRunning: boolean;
  phaseEndsAt: string | null;
  serverNow: string;
}

export const TIMER_STATE_FIELDS = [
  "isRunning",
  "phaseEndsAt",
  "serverNow",
] as const satisfies readonly (keyof TimerStateDtoPayload)[];

// A network round trip that hangs forever (unreachable server, no TCP reset) would otherwise
// leave a poll stuck indefinitely - a poll that hasn't returned by then is just treated as "try
// again next alarm/hint" rather than block the service worker.
const REQUEST_TIMEOUT_MS = 10_000;

export type PollResult =
  | { ok: true; state: TimerStateDtoPayload }
  | { ok: false; kind: "offline" }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "http"; status: number }
  | { ok: false; kind: "network"; message: string };

// Shared by both features - the caller passes whichever of its own (FocusGuardApiKey or
// FocusTunesApiKey) settings are relevant. Both slots' ApiKeyScopes entries allow exactly this one
// endpoint (plus Auth.Whoami) - a leaked key can therefore only ever reveal "is a session running
// right now", nothing about its content (see the studylife repo's ApiKeyScopes doc comments).
export async function pollTimerState(settings: FeatureSettings): Promise<PollResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline" };
  }

  const url = `${normalizeServerUrl(settings.serverUrl)}/api/timerstate`;
  try {
    const response = await fetchWithTimeout(url, {
      headers: { "X-Api-Key": settings.apiKey },
    });
    if (response.status === 401) {
      return { ok: false, kind: "unauthorized" };
    }
    if (!response.ok) {
      return { ok: false, kind: "http", status: response.status };
    }
    const state = (await response.json()) as TimerStateDtoPayload;
    return { ok: true, state };
  } catch (error) {
    return { ok: false, kind: "network", message: describeError(error) };
  }
}

// Independent of TKeyField (only the ok:true branch differs by key field name) - exported
// separately so callers that handle a Guard and a Tune exchange with the same code path (e.g.
// background.ts's describeExchangeFailure) can type against one shared failure shape instead of
// an awkward Exclude<..., {ok:true}> derivation.
export type ExchangeFailure =
  | { ok: false; kind: "offline" }
  // The server predates the browser-connect endpoint - callers should tell the user to update
  // their server instead of retrying.
  | { ok: false; kind: "not-found" }
  | { ok: false; kind: "http"; status: number; message: string }
  | { ok: false; kind: "network"; message: string };

export type ExchangeResult<TKeyField extends string> =
  | ({ ok: true; userId: number } & Record<TKeyField, string>)
  | ExchangeFailure;

// Trades the passkey-signed assertion from the browser consent flow (connect.ts /
// chrome.identity.launchWebAuthFlow) for a FocusGuardApiKey - the server-side counterpart is
// POST /api/auth/focusguard-assertion-exchange (StudyLife's AuthController). Anonymous POST: the
// assertion itself is the credential, there's no X-Api-Key to send yet since that's exactly what
// this call is meant to produce.
export async function exchangeFocusGuardAssertion(
  serverUrl: string,
  assertion: string,
): Promise<ExchangeResult<"focusGuardApiKey">> {
  return exchangeAssertion(serverUrl, assertion, "focusguard", "focusGuardApiKey");
}

// Same as above, audience "focustunes" - server-side counterpart is
// POST /api/auth/focustunes-assertion-exchange. Still an entirely separate exchange/key/audience
// from Guard's, even though both now ship in the same browser extension package.
export async function exchangeFocusTunesAssertion(
  serverUrl: string,
  assertion: string,
): Promise<ExchangeResult<"focusTunesApiKey">> {
  return exchangeAssertion(serverUrl, assertion, "focustunes", "focusTunesApiKey");
}

async function exchangeAssertion<TKeyField extends string>(
  serverUrl: string,
  assertion: string,
  audiencePath: "focusguard" | "focustunes",
  keyField: TKeyField,
): Promise<ExchangeResult<TKeyField>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline" };
  }
  const url = `${normalizeServerUrl(serverUrl)}/api/auth/${audiencePath}-assertion-exchange`;
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assertion }),
    });
    if (response.status === 404) {
      return { ok: false, kind: "not-found" };
    }
    if (!response.ok) {
      return { ok: false, kind: "http", status: response.status, message: await safeText(response) };
    }
    const body = (await response.json()) as { userId?: number } & Partial<Record<TKeyField, string>>;
    const apiKey = body[keyField];
    if (!apiKey) {
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: `Server response was missing ${keyField}.`,
      };
    }
    return { ok: true, userId: body.userId ?? 0, [keyField]: apiKey } as ExchangeResult<TKeyField> & { ok: true };
  } catch (error) {
    return { ok: false, kind: "network", message: describeError(error) };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request timed out.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
