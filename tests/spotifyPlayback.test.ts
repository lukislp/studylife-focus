import { afterEach, describe, expect, it, vi } from "vitest";
import { pausePlayback, playPlaylist } from "../src/spotifyPlayback";

const ACCESS_TOKEN = "token-123";
const PLAYLIST_URI = "spotify:playlist:abc";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playPlaylist", () => {
  it("succeeds directly when a device is already active", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.spotify.com/v1/me/player/play");
  });

  it("retries against an available device when nothing is active yet", async () => {
    const devices = { devices: [{ id: "device-1", is_active: false, is_restricted: false }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404)) // first /play attempt: no active device
      .mockResolvedValueOnce(jsonResponse(200, devices)) // GET /devices
      .mockResolvedValueOnce(jsonResponse(200)); // retried /play?device_id=...
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.spotify.com/v1/me/player/play?device_id=device-1");
  });

  it("prefers an already-active device over other available ones", async () => {
    const devices = {
      devices: [
        { id: "device-idle", is_active: false, is_restricted: false },
        { id: "device-active", is_active: true, is_restricted: false },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, devices))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(fetchMock.mock.calls[2][0]).toBe("https://api.spotify.com/v1/me/player/play?device_id=device-active");
  });

  it("skips restricted devices", async () => {
    const devices = { devices: [{ id: "restricted", is_active: true, is_restricted: true }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, devices));
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: false, kind: "no-active-device" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry - nothing usable to target
  });

  it("gives up with the original error when no devices are available at all", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, { devices: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: false, kind: "no-active-device" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly if the devices lookup itself fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: false, kind: "no-active-device" });
  });

  it("does not attempt a device fallback for unrelated failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401));
    vi.stubGlobal("fetch", fetchMock);

    const result = await playPlaylist(ACCESS_TOKEN, PLAYLIST_URI);

    expect(result).toEqual({ ok: false, kind: "unauthorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("pausePlayback", () => {
  it("sends no body and applies the same device fallback", async () => {
    const devices = { devices: [{ id: "device-1", is_active: false, is_restricted: false }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, devices))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pausePlayback(ACCESS_TOKEN);

    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.spotify.com/v1/me/player/pause?device_id=device-1");
  });
});
