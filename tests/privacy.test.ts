import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The broad host access Guard asks for must stay disclosed. If the manifest ever gains or loses a
// host permission, these checks force PRIVACY.md and README.md to be revisited.
const manifest = JSON.parse(readFileSync("manifest.json", "utf-8")) as { optional_host_permissions?: string[] };
const privacy = readFileSync("PRIVACY.md", "utf-8");
const readme = readFileSync("README.md", "utf-8");

describe("host access disclosure", () => {
  const hosts = manifest.optional_host_permissions ?? [];

  it("requests broad access that the docs name as access to all websites", () => {
    expect(hosts).toContain("https://*/*");
    expect(privacy.toLowerCase()).toContain("access to all websites");
    expect(readme.toLowerCase()).toContain("access to all websites");
  });

  it("documents the Spotify hosts the manifest asks for", () => {
    for (const host of hosts.filter((h) => h.includes("spotify.com"))) {
      const bare = host.replace("https://", "").replace("/*", "");
      expect(privacy, `PRIVACY.md does not mention ${bare}`).toContain(bare);
    }
  });

  it("names the controller and publisher", () => {
    expect(privacy).toContain("the operator of your instance");
    expect(privacy).toContain("https://lktec.org/impressum");
  });
});