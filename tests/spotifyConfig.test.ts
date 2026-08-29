import { beforeEach, describe, expect, it } from "vitest";
import { loadSpotifyConfig, loadSpotifyTokens, saveSpotifyConfig, saveSpotifyTokens } from "../src/spotifyConfig";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("loadSpotifyConfig", () => {
  it("defaults to empty fields when nothing is stored", async () => {
    await expect(loadSpotifyConfig()).resolves.toEqual({ clientId: "", focusPlaylistUri: "", breakPlaylistUri: "" });
  });

  it("round-trips a saved config", async () => {
    const config = { clientId: "abc123", focusPlaylistUri: "spotify:playlist:1", breakPlaylistUri: "" };
    await saveSpotifyConfig(config);
    await expect(loadSpotifyConfig()).resolves.toEqual(config);
  });

  it("falls back to empty strings for corrupted field values", async () => {
    storage.raw().spotifyConfig = { clientId: 123 };
    await expect(loadSpotifyConfig()).resolves.toEqual({ clientId: "", focusPlaylistUri: "", breakPlaylistUri: "" });
  });
});

describe("Spotify tokens", () => {
  it("returns null when nothing is stored", async () => {
    await expect(loadSpotifyTokens()).resolves.toBeNull();
  });

  it("round-trips saved tokens", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 12345 };
    await saveSpotifyTokens(tokens);
    await expect(loadSpotifyTokens()).resolves.toEqual(tokens);
  });
});
