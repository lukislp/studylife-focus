// Separate from settings.ts (server URL + API keys) on purpose, same reasoning as blockConfig.ts:
// a completely different concern - whether an already-connected feature should currently be
// acting at all. Lets a user connect both Guard and Tune once, then flip either off temporarily
// (e.g. "I want music-switching today but not site-blocking") without disconnecting/reconnecting.
export interface FeatureToggles {
  guardEnabled: boolean;
  tuneEnabled: boolean;
}

const STORAGE_KEY = "featureToggles";

// On by default: a feature the user has gone through the trouble of connecting is presumably one
// they want active immediately, not one they then have to remember to also switch on.
const DEFAULT_TOGGLES: FeatureToggles = { guardEnabled: true, tuneEnabled: true };

export async function loadFeatureToggles(): Promise<FeatureToggles> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<FeatureToggles> | undefined;
  if (!stored) return { ...DEFAULT_TOGGLES };
  return {
    guardEnabled: typeof stored.guardEnabled === "boolean" ? stored.guardEnabled : DEFAULT_TOGGLES.guardEnabled,
    tuneEnabled: typeof stored.tuneEnabled === "boolean" ? stored.tuneEnabled : DEFAULT_TOGGLES.tuneEnabled,
  };
}

export async function saveFeatureToggles(toggles: FeatureToggles): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: toggles });
}
