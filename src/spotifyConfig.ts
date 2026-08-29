import type { SpotifyTokens } from "./spotifyAuth";

// User-supplied, not shipped with the extension: Spotify requires every app to register its own
// client (https://developer.spotify.com/dashboard) - there is no shared client id an open-source
// extension could safely embed, since a public client id combined with a fixed redirect URI
// would let anyone impersonate this app's own registration.
export interface SpotifyConfig {
  clientId: string;
  focusPlaylistUri: string;
  /** Empty = pause playback on break/session-end instead of switching to a second playlist. */
  breakPlaylistUri: string;
}

const CONFIG_KEY = "spotifyConfig";
const TOKENS_KEY = "spotifyTokens";

const DEFAULT_CONFIG: SpotifyConfig = { clientId: "", focusPlaylistUri: "", breakPlaylistUri: "" };

export async function loadSpotifyConfig(): Promise<SpotifyConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const stored = result[CONFIG_KEY] as Partial<Record<keyof SpotifyConfig, unknown>> | undefined;
  if (!stored) return { ...DEFAULT_CONFIG };
  return {
    clientId: typeof stored.clientId === "string" ? stored.clientId : "",
    focusPlaylistUri: typeof stored.focusPlaylistUri === "string" ? stored.focusPlaylistUri : "",
    breakPlaylistUri: typeof stored.breakPlaylistUri === "string" ? stored.breakPlaylistUri : "",
  };
}

export async function saveSpotifyConfig(config: SpotifyConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function loadSpotifyTokens(): Promise<SpotifyTokens | null> {
  const result = await chrome.storage.local.get(TOKENS_KEY);
  return (result[TOKENS_KEY] as SpotifyTokens | undefined) ?? null;
}

export async function saveSpotifyTokens(tokens: SpotifyTokens): Promise<void> {
  await chrome.storage.local.set({ [TOKENS_KEY]: tokens });
}

export async function clearSpotifyTokens(): Promise<void> {
  await chrome.storage.local.remove(TOKENS_KEY);
}
