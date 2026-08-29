import { beforeEach, describe, expect, it } from "vitest";
import { loadGuardSettings, loadStoredSettings, loadTuneSettings, normalizeServerUrl, saveSettings } from "../src/settings";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("normalizeServerUrl", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeServerUrl("https://studylife.example.com/")).toBe("https://studylife.example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeServerUrl("https://studylife.example.com///")).toBe("https://studylife.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  https://studylife.example.com  ")).toBe("https://studylife.example.com");
  });

  it("leaves a plain URL with no trailing slash unchanged", () => {
    expect(normalizeServerUrl("https://studylife.example.com")).toBe("https://studylife.example.com");
  });

  // The base-URL-only guarantee: whatever path/query/hash the user pastes in gets stripped down
  // to just the origin, so every API call in api.ts/connect.ts appends its own path onto a clean
  // base rather than accidentally duplicating or conflicting with one the user typed.
  it("strips a path down to just the origin", () => {
    expect(normalizeServerUrl("https://studylife.example.com/setup")).toBe("https://studylife.example.com");
  });

  it("strips a query string and hash down to just the origin", () => {
    expect(normalizeServerUrl("https://studylife.example.com/login?x=1#y")).toBe("https://studylife.example.com");
  });

  it("preserves a non-default port", () => {
    expect(normalizeServerUrl("https://studylife.example.com:8443/anything")).toBe("https://studylife.example.com:8443");
  });
});

describe("loadStoredSettings", () => {
  it("returns a URL-only draft with empty keys when nothing has connected yet", async () => {
    await saveSettings({ serverUrl: "https://studylife.example.com", guardApiKey: "", tuneApiKey: "" });
    await expect(loadStoredSettings()).resolves.toEqual({
      serverUrl: "https://studylife.example.com",
      guardApiKey: "",
      tuneApiKey: "",
    });
  });

  it("returns null when nothing is stored at all", async () => {
    await expect(loadStoredSettings()).resolves.toBeNull();
  });

  it("keeps Guard's and Tune's keys independent - connecting one never affects the other", async () => {
    await saveSettings({ serverUrl: "https://studylife.example.com", guardApiKey: "guard-secret", tuneApiKey: "" });
    await expect(loadStoredSettings()).resolves.toEqual({
      serverUrl: "https://studylife.example.com",
      guardApiKey: "guard-secret",
      tuneApiKey: "",
    });
  });
});

describe("loadGuardSettings / loadTuneSettings", () => {
  const serverUrl = "https://studylife.example.com";

  it("returns null for a feature with no key yet, even if the other feature is connected", async () => {
    await saveSettings({ serverUrl, guardApiKey: "guard-secret", tuneApiKey: "" });
    await expect(loadGuardSettings()).resolves.toEqual({ serverUrl, apiKey: "guard-secret" });
    await expect(loadTuneSettings()).resolves.toBeNull();
  });

  it("returns settings for both features once both are connected", async () => {
    await saveSettings({ serverUrl, guardApiKey: "guard-secret", tuneApiKey: "tune-secret" });
    await expect(loadGuardSettings()).resolves.toEqual({ serverUrl, apiKey: "guard-secret" });
    await expect(loadTuneSettings()).resolves.toEqual({ serverUrl, apiKey: "tune-secret" });
  });

  it("returns null from both when nothing is stored", async () => {
    await expect(loadGuardSettings()).resolves.toBeNull();
    await expect(loadTuneSettings()).resolves.toBeNull();
  });
});
