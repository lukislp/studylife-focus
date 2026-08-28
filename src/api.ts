import { normalizeServerUrl, type FocusGuardSettings } from "./settings";

// Wire shape of StudyLife.Shared.Dtos.TimerStateDto (GET /api/timerstate) - only the fields this
// extension actually reads are declared; the server sends more (SessionId, IsBreak, CurrentRound,
// TimerModeId, ClientSequence, UpdatedAt) that background.ts has no use for. scripts/contract-check.mjs
// diffs TIMER_STATE_FIELDS below against the committed OpenAPI spec's TimerStateDto schema, so a
// server-side field rename fails CI here instead of silently breaking polling once the Web Store
// review finally lets a drifted build reach users.
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
// leave a poll stuck indefinitely - same reasoning as studylife-capture's REQUEST_TIMEOUT_MS, but
// shorter here since a poll that hasn't returned by then should just be treated as "try again
// next alarm" rather than block the service worker.
const REQUEST_TIMEOUT_MS = 10_000;

export type PollResult =
  | { ok: true; state: TimerStateDtoPayload }
  | { ok: false; kind: "offline" }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "http"; status: number }
  | { ok: false; kind: "network"; message: string };

// The extension authenticates with a long-lived FocusGuardApiKey (provisioned via the browser
// consent flow, see connect.ts/exchangeFocusGuardAssertion below) via the server's unified
// X-Api-Key gate. The FocusGuard slot's ApiKeyScopes entry allows exactly this one endpoint
// (plus Auth.Whoami) - a leaked key can therefore only ever reveal "is a session running right
// now", nothing about its content (see the studylife repo's ApiKeyScopes.FocusGuard doc comment).
export async function pollTimerState(settings: FocusGuardSettings): Promise<PollResult> {
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

export type ExchangeResult =
  | { ok: true; focusGuardApiKey: string; userId: number }
  | { ok: false; kind: "offline" }
  // The server predates the browser-connect endpoint - callers should tell the user to update
  // their server instead of retrying.
  | { ok: false; kind: "not-found" }
  | { ok: false; kind: "http"; status: number; message: string }
  | { ok: false; kind: "network"; message: string };

// Trades the passkey-signed assertion from the browser consent flow (connect.ts /
// chrome.identity.launchWebAuthFlow) for a FocusGuardApiKey - the server-side counterpart is
// POST /api/auth/focusguard-assertion-exchange (StudyLife's AuthController). Anonymous POST:
// the assertion itself is the credential, there's no X-Api-Key to send yet since that's exactly
// what this call is meant to produce.
export async function exchangeFocusGuardAssertion(serverUrl: string, assertion: string): Promise<ExchangeResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, kind: "offline" };
  }
  const url = `${normalizeServerUrl(serverUrl)}/api/auth/focusguard-assertion-exchange`;
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
    const body = (await response.json()) as { userId?: number; focusGuardApiKey?: string };
    if (!body.focusGuardApiKey) {
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: "Server response was missing focusGuardApiKey.",
      };
    }
    return { ok: true, focusGuardApiKey: body.focusGuardApiKey, userId: body.userId ?? 0 };
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
