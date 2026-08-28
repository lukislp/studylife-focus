import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, loadStoredSettings, normalizeServerUrl, saveSettings } from "../src/settings";
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

describe("loadStoredSettings vs loadSettings", () => {
  it("returns a URL-only draft from loadStoredSettings but null from loadSettings", async () => {
    await saveSettings({ serverUrl: "https://studylife.example.com", apiKey: "" });
    await expect(loadStoredSettings()).resolves.toEqual({
      serverUrl: "https://studylife.example.com",
      apiKey: "",
    });
    await expect(loadSettings()).resolves.toBeNull();
  });

  it("returns full settings from both once an apiKey is present", async () => {
    const settings = { serverUrl: "https://studylife.example.com", apiKey: "secret" };
    await saveSettings(settings);
    await expect(loadStoredSettings()).resolves.toEqual(settings);
    await expect(loadSettings()).resolves.toEqual(settings);
  });

  it("returns null from both when nothing is stored", async () => {
    await expect(loadStoredSettings()).resolves.toBeNull();
    await expect(loadSettings()).resolves.toBeNull();
  });
});
