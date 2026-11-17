// The two archives `npm run package` (zip.mjs) builds from the same dist/:
//
// - "unpacked": manifest.json exactly as built, INCLUDING its "key". This is the GitHub release
//   download people load with "Load unpacked"; the key gives every such install the same,
//   server-pinned extension ID (hhgnenpnafffiadgabcclncnbfdopnlp).
// - "store": manifest.json WITHOUT "key", for upload to the Chrome Web Store. The store refuses
//   a manifest key that is not the listing's own and signs the package with its key, so the
//   store build keeps the listing's ID (bhjoeghhdmaoepmbklbcbdkfnjbgclbh).
//
// Only the manifest differs; every other file is the same bytes in both archives.

/** @param {string} version */
export function packageVariants(version) {
  return [
    { name: "unpacked", fileName: `studylife-focus-v${version}.zip`, manifest: (m) => m },
    { name: "store", fileName: `studylife-focus-v${version}-chrome-web-store.zip`, manifest: toStoreManifest },
  ];
}

/** A copy of the manifest without "key"; the input is not modified. */
export function toStoreManifest(manifest) {
  const { key: _key, ...rest } = manifest;
  return rest;
}
