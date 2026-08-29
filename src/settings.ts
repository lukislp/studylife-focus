// Self-hosted, so unlike a typical extension there's no single fixed API host - every user points
// this at their own StudyLife instance. Only the BASE URL is ever stored/entered - every API call
// appends its own path (see api.ts), never the other way around, so the user never has to think
// about paths at all. Shared across both features (Guard and Tune) since it's one server; the two
// API keys are separate because Guard and Tune are two independent, separately-consented audiences
// server-side (identity contract v1 §2) - connecting one never implies the other is connected too.
export interface FocusExtensionSettings {
  serverUrl: string;
  guardApiKey: string;
  tuneApiKey: string;
}

/** The shape api.ts's pollTimerState/exchange* functions actually need - just whichever single
 * feature's key is relevant to that call, never both at once. */
export interface FeatureSettings {
  serverUrl: string;
  apiKey: string;
}

const STORAGE_KEY = "settings";

// Whatever is stored, connected or not: the options page persists the server URL as a draft
// (with empty keys) the moment a Connect button is clicked, so a page killed by the permission
// prompt doesn't lose the field - this loader is what restores that draft on reopen.
export async function loadStoredSettings(): Promise<FocusExtensionSettings | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<FocusExtensionSettings> | undefined;
  if (!stored?.serverUrl) return null;
  return {
    serverUrl: stored.serverUrl,
    guardApiKey: stored.guardApiKey ?? "",
    tuneApiKey: stored.tuneApiKey ?? "",
  };
}

export async function saveSettings(settings: FocusExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

// Connected settings only, scoped to one feature - polling needs a usable key, a URL-only draft
// (or the other feature's key) is not enough.
export async function loadGuardSettings(): Promise<FeatureSettings | null> {
  const settings = await loadStoredSettings();
  return settings?.guardApiKey ? { serverUrl: settings.serverUrl, apiKey: settings.guardApiKey } : null;
}

export async function loadTuneSettings(): Promise<FeatureSettings | null> {
  const settings = await loadStoredSettings();
  return settings?.tuneApiKey ? { serverUrl: settings.serverUrl, apiKey: settings.tuneApiKey } : null;
}

// Strips a trailing slash and any path/query/hash the user might have pasted in - only the
// origin is ever kept, so `${serverUrl}/api/...` concatenation in api.ts always lands on a
// real endpoint regardless of what the user typed (with or without a trailing slash, with or
// without "https://", with a stray "/setup" copied along with the URL from their browser bar).
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}
