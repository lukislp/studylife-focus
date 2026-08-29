import { beforeEach, describe, expect, it } from "vitest";
import { loadFeatureToggles, saveFeatureToggles } from "../src/featureToggles";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("loadFeatureToggles", () => {
  it("defaults both features to enabled when nothing is stored", async () => {
    await expect(loadFeatureToggles()).resolves.toEqual({ guardEnabled: true, tuneEnabled: true });
  });

  it("round-trips a saved value", async () => {
    await saveFeatureToggles({ guardEnabled: false, tuneEnabled: true });
    await expect(loadFeatureToggles()).resolves.toEqual({ guardEnabled: false, tuneEnabled: true });
  });

  it("falls back to the default for a missing/malformed individual field", async () => {
    storage.raw().featureToggles = { guardEnabled: false };
    await expect(loadFeatureToggles()).resolves.toEqual({ guardEnabled: false, tuneEnabled: true });
  });
});
