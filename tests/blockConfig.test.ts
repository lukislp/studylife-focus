import { beforeEach, describe, expect, it } from "vitest";
import { loadBlockConfig, saveBlockConfig } from "../src/blockConfig";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("loadBlockConfig", () => {
  it("defaults to whitelist mode with empty lists when nothing is stored", async () => {
    await expect(loadBlockConfig()).resolves.toEqual({ mode: "whitelist", whitelist: [], blacklist: [] });
  });

  it("round-trips a saved config", async () => {
    const config = { mode: "blacklist" as const, whitelist: [], blacklist: ["reddit.com"] };
    await saveBlockConfig(config);
    await expect(loadBlockConfig()).resolves.toEqual(config);
  });

  it("falls back to whitelist for a corrupted mode value", async () => {
    storage.raw().blockConfig = { mode: "not-a-real-mode", whitelist: ["x.com"] };
    await expect(loadBlockConfig()).resolves.toEqual({ mode: "whitelist", whitelist: ["x.com"], blacklist: [] });
  });

  it("falls back to an empty array for a corrupted list value", async () => {
    storage.raw().blockConfig = { mode: "whitelist", whitelist: "not-an-array" };
    await expect(loadBlockConfig()).resolves.toEqual({ mode: "whitelist", whitelist: [], blacklist: [] });
  });
});
