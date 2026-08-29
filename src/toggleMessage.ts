// Shared between options.ts (where a feature's enable/disable toggle is flipped) and
// background.ts (which owns the actual side effects of that - see its handleToggleChanged).
// Small and standalone rather than living in background.ts itself, same reasoning as
// CONNECT_MESSAGE_TYPE living in connect.ts: options.ts is a separate bundle entry point and
// shouldn't import from the service-worker's own entry file.
export const TOGGLE_MESSAGE_TYPE = "studylife-focus:toggle-changed";

export type ToggleFeature = "guard" | "tune";

export interface ToggleMessage {
  type: typeof TOGGLE_MESSAGE_TYPE;
  feature: ToggleFeature;
  enabled: boolean;
}

export function isToggleMessage(message: unknown): message is ToggleMessage {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; feature?: unknown; enabled?: unknown };
  return (
    candidate.type === TOGGLE_MESSAGE_TYPE &&
    (candidate.feature === "guard" || candidate.feature === "tune") &&
    typeof candidate.enabled === "boolean"
  );
}
