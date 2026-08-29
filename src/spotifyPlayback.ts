// Thin wrapper over the two Spotify Web API playback endpoints this extension needs. Spotify's
// play/pause calls 404 ("no active device") unless a device is already actively playing there -
// so on that specific failure we look up the caller's available devices ourselves and retry once,
// targeted at one of them. This is what lets FocusTunes work as soon as Spotify is merely open
// somewhere (app running, web player tab open), not only when something is already playing.
const API_BASE = "https://api.spotify.com/v1/me/player";

export type PlaybackResult =
  | { ok: true }
  | { ok: false; kind: "unauthorized" }
  | { ok: false; kind: "no-active-device" }
  | { ok: false; kind: "http"; status: number; message: string }
  | { ok: false; kind: "network"; message: string };

export async function playPlaylist(accessToken: string, playlistUri: string): Promise<PlaybackResult> {
  return requestWithDeviceFallback(accessToken, "/play", { context_uri: playlistUri });
}

export async function pausePlayback(accessToken: string): Promise<PlaybackResult> {
  return requestWithDeviceFallback(accessToken, "/pause");
}

async function requestWithDeviceFallback(
  accessToken: string,
  path: string,
  body?: unknown,
): Promise<PlaybackResult> {
  const first = await request(accessToken, "PUT", path, body);
  if (first.ok || first.kind !== "no-active-device") return first;

  const deviceId = await findAvailableDeviceId(accessToken);
  if (!deviceId) return first; // nothing open anywhere - nothing we can do

  return request(accessToken, "PUT", `${path}?device_id=${encodeURIComponent(deviceId)}`, body);
}

interface SpotifyDevice {
  id: string;
  is_active: boolean;
  is_restricted: boolean;
}

async function findAvailableDeviceId(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/devices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { devices?: SpotifyDevice[] };
    const devices = data.devices ?? [];
    // Prefer a device Spotify already considers active, else any non-restricted one it can see.
    return devices.find((d) => d.is_active && !d.is_restricted)?.id
      ?? devices.find((d) => !d.is_restricted)?.id
      ?? null;
  } catch {
    return null;
  }
}

async function request(accessToken: string, method: string, path: string, body?: unknown): Promise<PlaybackResult> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) return { ok: false, kind: "unauthorized" };
    // 404 here specifically means "no active device" per Spotify's own API docs - distinct from
    // a generic not-found, worth surfacing as its own case so the caller can react to it.
    if (response.status === 404) return { ok: false, kind: "no-active-device" };
    if (!response.ok) {
      return { ok: false, kind: "http", status: response.status, message: await safeText(response) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, kind: "network", message: error instanceof Error ? error.message : String(error) };
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
