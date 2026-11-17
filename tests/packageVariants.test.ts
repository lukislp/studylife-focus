import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packageVariants, toStoreManifest } from "../scripts/package-variants.mjs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8")) as Record<string, unknown>;

describe("package variants", () => {
  it("builds one unpacked and one Chrome Web Store archive per version", () => {
    expect(packageVariants("1.2.3").map((v) => [v.name, v.fileName])).toEqual([
      ["unpacked", "studylife-focus-v1.2.3.zip"],
      ["store", "studylife-focus-v1.2.3-chrome-web-store.zip"],
    ]);
  });

  it("keeps the manifest key in the unpacked archive, so unpacked installs get the pinned ID", () => {
    const unpacked = packageVariants("1.2.3").find((v) => v.name === "unpacked")!;
    expect(manifest.key).toEqual(expect.any(String));
    expect(unpacked.manifest(manifest)).toEqual(manifest);
  });

  it("drops only the key from the store manifest and leaves the source untouched", () => {
    const store = toStoreManifest(manifest);
    expect(store).not.toHaveProperty("key");
    const { key: _key, ...rest } = manifest;
    expect(store).toEqual(rest);
    expect(manifest.key).toEqual(expect.any(String));
  });
});
