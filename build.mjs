// Bundles the extension's TS entry points into dist/ and copies the static files (manifest,
// HTML/CSS, icons) alongside them - dist/ is what gets loaded unpacked in chrome://extensions
// or zipped for the Web Store. Mirrors studylife-capture's build.mjs.
import { build, context } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

const sharedOptions = {
  bundle: true,
  outdir: "dist",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
};

// All four entry points are real ES modules (manifest.json declares "type": "module" for the
// background service worker; every *.html here loads its script the same way).
const moduleBuildOptions = {
  ...sharedOptions,
  entryPoints: ["src/background.ts", "src/popup.ts", "src/options.ts", "src/blocked.ts"],
  format: "esm",
};

const STATIC_FILES = [
  "manifest.json",
  "src/popup.html",
  "src/popup.css",
  "src/options.html",
  "src/options.css",
  "src/blocked.html",
  "src/blocked.css",
];

function copyStaticFiles() {
  for (const path of STATIC_FILES) {
    const dest = `dist/${path.split("/").pop()}`;
    copyFileSync(path, dest);
  }
  for (const size of [16, 48, 128]) {
    copyFileSync(`src/icon${size}.png`, `dist/icon${size}.png`);
  }
}

if (watch) {
  const ctx = await context(moduleBuildOptions);
  await ctx.watch();
  copyStaticFiles();
  console.log("Watching for changes...");
} else {
  await build(moduleBuildOptions);
  copyStaticFiles();
  console.log("Built to dist/");
}
