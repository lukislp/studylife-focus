import type { BlockMode } from "./rules";

// Separate from settings.ts's FocusGuardSettings (server URL + API key) on purpose: this is the
// user's actual blocking preference, a completely different concern that options.ts/popup.ts and
// background.ts all read/write independently of whether a connection even exists yet.
export interface BlockConfig {
  mode: BlockMode;
  whitelist: string[];
  blacklist: string[];
}

const STORAGE_KEY = "blockConfig";

// Whitelist is the recommended default (see README) - a fresh install with an empty whitelist
// blocks EVERYTHING except the configured StudyLife server the moment a focus session starts,
// which is why options.ts's first-run flow nudges the user to add a few sites before that
// happens, rather than silently starting from a maximally strict, unexplained state.
const DEFAULT_CONFIG: BlockConfig = { mode: "whitelist", whitelist: [], blacklist: [] };

export async function loadBlockConfig(): Promise<BlockConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<BlockConfig> | undefined;
  if (!stored) return { ...DEFAULT_CONFIG };
  return {
    mode: stored.mode === "blacklist" ? "blacklist" : "whitelist",
    whitelist: Array.isArray(stored.whitelist) ? stored.whitelist : [],
    blacklist: Array.isArray(stored.blacklist) ? stored.blacklist : [],
  };
}

export async function saveBlockConfig(config: BlockConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}
