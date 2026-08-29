// Pure helper for background.ts's syncTimerHintContentScript - kept separate purely so the match-
// pattern computation is unit-testable without touching the chrome.scripting API surface.
export const TIMER_HINT_SCRIPT_ID = "studylife-timer-hint";
export const TIMER_HINT_MESSAGE_TYPE = "studylife-timer-hint";

/** The dynamic content script's match pattern for a connected server URL, or null if there's
 * nothing to register (not connected, or a malformed stored URL that normalizeServerUrl should
 * already have prevented - fail closed rather than registering a broken pattern). */
export function computeTimerHintMatch(serverUrl: string | null): string | null {
  if (!serverUrl) return null;
  try {
    return `${new URL(serverUrl).origin}/*`;
  } catch {
    return null;
  }
}

export function isTimerHintMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === TIMER_HINT_MESSAGE_TYPE;
}
