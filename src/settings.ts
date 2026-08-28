// Self-hosted, so unlike a typical extension there's no single fixed API host -
// every user points this at their own StudyLife instance. Only the BASE URL is ever
// stored/entered - every API call appends its own path (see api.ts), never the other way
// around, so the user never has to think about paths at all.
export interface FocusGuardSettings {
  serverUrl: string;
  apiKey: string;
}

const STORAGE_KEY = "settings";

// Whatever is stored, connected or not: the options page persists the server URL as a draft
// (with an empty apiKey) the moment Connect is clicked, so a page killed by the permission
// prompt doesn't lose the field - this loader is what restores that draft on reopen.
export async function loadStoredSettings(): Promise<FocusGuardSettings | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY] as FocusGuardSettings | undefined;
  if (!settings?.serverUrl) return null;
  return settings;
}

// Connected settings only - polling needs a usable key, a URL-only draft is not enough.
export async function loadSettings(): Promise<FocusGuardSettings | null> {
  const settings = await loadStoredSettings();
  return settings?.apiKey ? settings : null;
}

export async function saveSettings(settings: FocusGuardSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
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
