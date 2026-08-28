// Keeps manifest.json's own "version" field (the one Chrome/the Web Store actually reads) in
// sync with the version semantic-release computes and writes into package.json. Mirrors
// studylife-capture's scripts/sync-manifest-version.mjs.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-manifest-version.mjs <version>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json version set to ${version}`);
