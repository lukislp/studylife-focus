// Packages the already-built dist/ into .zip files under release/, with dist/'s CONTENTS at the
// archive root (not a wrapping "dist/" folder) - the Chrome Web Store requires manifest.json at
// the top level, and the unzipped folder of a release download *is* the extension folder.
//
// Two archives come out of one build (see scripts/package-variants.mjs):
//   release/studylife-focus-v<version>.zip                   - GitHub release / Load unpacked,
//                                                             manifest keeps its "key"
//   release/studylife-focus-v<version>-chrome-web-store.zip  - Chrome Web Store upload,
//                                                             manifest without "key"
// dist/ itself is never changed, so local development keeps the key.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { ZipArchive } from "archiver";
import { packageVariants } from "./scripts/package-variants.mjs";

if (!existsSync("dist")) {
  console.error("dist/ not found - run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf-8"));
mkdirSync("release", { recursive: true });

for (const variant of packageVariants(manifest.version)) {
  const outputPath = `release/${variant.fileName}`;
  const output = createWriteStream(outputPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (error) => {
    throw error;
  });
  archive.pipe(output);
  archive.glob("**/*", { cwd: "dist", ignore: ["manifest.json"], dot: true });
  archive.append(`${JSON.stringify(variant.manifest(manifest), null, 2)}\n`, { name: "manifest.json" });
  await archive.finalize();
  await once(output, "close");
  console.log(`Packaged ${outputPath} (${variant.name}, ${(archive.pointer() / 1024).toFixed(1)} KB)`);
}
