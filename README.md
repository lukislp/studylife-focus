# StudyAtrium Focus

(formerly StudyLife)

[![CI](https://github.com/lukislp/studylife-focus/actions/workflows/ci.yml/badge.svg)](https://github.com/lukislp/studylife-focus/actions/workflows/ci.yml) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/lukislp/studylife-focus/badge)](https://scorecard.dev/viewer/?uri=github.com/lukislp/studylife-focus) [![CodeQL](https://github.com/lukislp/studylife-focus/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/lukislp/studylife-focus/security/code-scanning)
[![Release](https://img.shields.io/github/v/release/lukislp/studylife-focus)](https://github.com/lukislp/studylife-focus/releases)
[![License: AGPL-3.0](https://img.shields.io/github/license/lukislp/studylife-focus)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://www.typescriptlang.org/)

A browser extension with two independent, separately-toggleable features tied to your
[StudyAtrium](https://github.com/lukislp/studylife) focus-timer session:

- **Guard** - blocks or allows sites while a session is running, so opening a distracting site
  during deep-work time takes a deliberate detour instead of one click.
- **Tune** - switches a Spotify playlist automatically ("focus" while running, "break"/pause once
  it ends).

Originally two separate extensions (`studylife-focusguard` and `studylife-focustunes`). Both exist
purely to automate something about your environment around the exact same signal - whether a
StudyAtrium focus session is currently running - so they're merged into one package: one shared
alarm/polling timer and one shared server-URL setup instead of two separate extensions each
independently reimplementing the same "is a session running" infrastructure, and one install
instead of two for a single coherent purpose. Each feature still keeps its own settings tab, its
own on/off switch, and its own narrowly-scoped, separately-consented API key - merging the
*packaging* didn't merge the two features' concerns into each other.

## Install

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/studylife-focus/bhjoeghhdmaoepmbklbcbdkfnjbgclbh)**
- the easiest way, gets automatic updates. The two routes below install the extension
**unpacked** instead - either from the packaged release archive, or from your own build. It is a Manifest V3 extension
built for Chrome 120 or newer (`target: chrome120` in `build.mjs`); other Chromium-based
browsers use the same packaging, only their extensions page lives at a different URL.

### From a release

1. Download `studylife-focus-v<version>.zip` from the
   [latest release](https://github.com/lukislp/studylife-focus/releases/latest).
2. Unzip it into a folder you intend to keep. `manifest.json` sits at the top level of the
   archive, so the unzipped folder *is* the extension folder - don't wrap it in another one.
3. Open `chrome://extensions` and turn **Developer mode** on (top right).
4. Click **Load unpacked** and select that folder.
5. Open the extension's options page - the **Manage** button in its toolbar popup, or
   **Details -> Extension options** on its card - and continue with "How it works" below.

Leave the folder where it is. Chrome derives an unpacked extension's ID from its path, and the
Spotify redirect URI shown on the Tune tab is derived in turn from that ID
(`chrome.identity.getRedirectURL()`) - moving the folder later means registering the new
redirect URI with your Spotify app again.

Every release also carries a keyless [Sigstore](https://www.sigstore.dev/) signature bundle
(`studylife-focus-v<version>.zip.sigstore.json`) and a GitHub build-provenance attestation
(`provenance.intoto.jsonl`) next to the archive, both produced by this repo's own CI run. To
check the download is the artifact that pipeline built, before unpacking it:

```bash
cosign verify-blob --bundle studylife-focus-v<version>.zip.sigstore.json \
  --certificate-identity-regexp '^https://github.com/lukislp/studylife-focus/\.github/workflows/ci\.yml@refs/heads/main$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  studylife-focus-v<version>.zip
```

### From source

```bash
npm ci
npm run build      # -> dist/
```

Then load `dist/` exactly as in steps 3-5 above. `npm run package` additionally zips `dist/` into
`release/studylife-focus-v<version>.zip` - the same archive the releases carry - and into the
Chrome Web Store package (see "Publishing to the Chrome Web Store" below).

### Updating

An unpacked extension doesn't auto-update. To move to a newer version, download (or rebuild) it
over the same folder and press the reload icon on its card in `chrome://extensions`. Your server
URL, connections and block list live in `chrome.storage` and survive that, as long as the folder
path stays the same.

**Upgrading from a version before the stable extension ID (v1.2.10 and earlier):** those builds
had no `"key"` in their manifest, so Chrome derived the ID from the install path. This version
pins a fixed ID (see "Stable extension ID" below), which means Chrome treats it as a *new*
extension: settings and connections stored under the old ID are not carried over, and you need to
set the server URL again and reconnect Guard and Tune once. Recommended: load the new version
(`Load unpacked`), reconnect, then remove the old entry.

## How it works

1. **General tab**: point the extension at your self-hosted StudyAtrium server (base URL only, e.g.
   `https://studylife.example.com` - no path needed, every subpage/API route under it is covered)
   and save it. This is shared by both features - connect either or both from their own tabs next.
2. **Guard tab**: connect (the same passkey-backed consent flow studylife-capture and
   studylife-mcp use - no API key to copy/paste), then choose a mode:
   - **Allowlist** (recommended) - block everything except the sites you list.
   - **Blocklist** - only block the sites you list, everything else stays reachable.
3. **Tune tab**: connect, then register your own free Spotify app at
   [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (Spotify requires
   every integration to have its own client), set its redirect URI to the one shown on this tab,
   paste the client ID in, set a focus playlist (and optionally a break playlist - otherwise
   playback just pauses), and connect Spotify itself.
4. Either feature reacts within a second or two if you started/paused/reset the timer from the
   same browser this extension runs in (StudyAtrium's own page dispatches an event a content script
   picks up and relays - see "Known limitations" for the confirmed race this mitigates but doesn't
   fully eliminate), and falls back to polling `GET /api/timerstate` (roughly every 30 seconds)
   for a session started elsewhere (another device, the phone app, etc.).
5. Flip either feature's "Enabled" toggle off at any time without disconnecting it - Guard
   immediately releases any active block and restores swept tabs; Tune simply stops switching
   playback going forward.

Add a domain once (e.g. `wikipedia.org`) and every subdomain/subpage under it is covered
automatically - no need to list `en.wikipedia.org`, `de.wikipedia.org`, etc. separately. For Tune,
Spotify just needs to be open somewhere (app running, or a web player tab) - it doesn't need to
already be playing; if no device is currently active, Tune looks up your available Spotify devices
itself and targets one directly.

## Permissions

- `storage` - your server URL, both features' API keys, your block-list configuration, and your
  Spotify config/tokens, stored locally only.
- `alarms` - the every-30-seconds poll (see above).
- `declarativeNetRequest` - Guard's actual blocking/redirecting mechanism.
- `tabs` - Guard reads the URLs of your currently open tabs, purely to redirect already-open
  matches the moment a focus session starts. Tab URLs are compared against your block list
  locally and never leave the browser - see [PRIVACY.md](PRIVACY.md).
- `identity` - three independent OAuth-style flows: StudyAtrium's browser-consent connect (once per
  feature you connect), and Spotify's own PKCE authorization flow for Tune.
- `notifications` - a confirmation when connecting either feature succeeds or fails.
- `scripting` - dynamically registers a tiny content script against exactly the one server origin
  you connect to, so it can hear StudyAtrium's own page dispatch a "timer state changed" browser
  event and relay a "check now" nudge to the extension - it doesn't read or modify page content,
  and the poll fallback still covers everything if this never fires.
- `optional_host_permissions` (`http://*/*`, `https://*/*`) - **access to all websites**, requested
  when you connect Guard (together with your server's origin, in one prompt). Guard's default
  allowlist mode blocks every site that is not on your list, so the browser only lets it redirect
  a navigation to a site it holds access to - and that has to be every site. Guard uses this
  access for one thing: the browser's own matching engine compares each page address you navigate
  to with your block list and redirects blocked ones to the blocked page. The extension's code
  does not read, inject into, or modify the pages you visit, and no page address is sent anywhere
  (see [PRIVACY.md](PRIVACY.md)). If you only connect Tune, the prompt covers just your StudyAtrium
  server's origin.
- `optional_host_permissions` for `accounts.spotify.com`/`api.spotify.com` - requested only when
  you connect Tune's Spotify integration, so a Guard-only install never prompts for Spotify access
  at all.

## Known limitations

- **Up to ~30 seconds of lag when the poll fallback is what's covering a transition** (a session
  started from a device/browser this extension isn't installed in) - `chrome.alarms` (the only
  persistent timer primitive available to an MV3 service worker, which can be killed and
  respawned at any time) has a 30-second minimum period for an unpacked extension (1 minute
  for the Chrome Web Store build).
- **The instant same-browser path can occasionally lose a race.** The page-side event fires the
  moment the timer's LOCAL state changes, but the `PUT /api/timerstate` that actually persists that
  state to the server is a separate, unordered network request - confirmed live via the service
  worker's own logs: a hint-triggered poll landing ~40ms after the click read the OLD server state,
  because the save simply hadn't landed yet, and only the next alarm tick caught the real change.
  Mitigated (not eliminated - a sufficiently slow save could still outlast it) by retrying the poll
  twice more, 1s and 2.5s after the first one. Open `chrome://extensions` -> StudyAtrium Focus ->
  "service worker" -> Console to watch this live: a `received timer-state hint from page` line
  right after your click confirms the instant path fired, and any `hint retry poll` lines after it
  show the race being caught.
- **Guard's blocked page doesn't say which site you tried to visit** - the redirect is a static
  extension page, not a per-request rewrite, so there's currently no channel carrying the original
  URL along.
- **Guard's automatic "restore my tabs" behavior only covers tabs that were already open when the
  session started** (the ones the sweep itself redirected). A tab that tried to navigate to a
  blocked site *while* a session was already running isn't tracked the same way, so it stays on
  the blocked page until you navigate it yourself.
- **No in-extension way to end a session early.** Both API keys are deliberately read-only (see
  below) - if you need to stop, end the session in StudyAtrium itself.

## Why the API keys are this narrow

Guard's and Tune's StudyAtrium keys can each reach exactly one endpoint: `GET /api/timerstate`
(plus `whoami` for diagnostics) - two separate, separately-consented server-side identities
(neither can read the other's connection state), matching `ApiKeyScopes.FocusGuard` /
`ApiKeyScopes.FocusTunes` in the `studylife` repo. Neither can read your notes, sessions, courses,
or settings, and neither can write anything at all - not even the timer state either one polls.
Tune's actual music control happens entirely against Spotify's own API, using a completely
separate token obtained directly from Spotify - StudyAtrium never sees it, and Spotify never sees
your StudyAtrium credentials.

## Stable extension ID

`manifest.json` embeds a fixed public key in its `"key"` field, so Chrome derives the **same
extension ID** on every machine and every unpacked load. Only the public half exists in this
repository (the private key was discarded, it is not needed for unpacked installs).

```
Unpacked builds:   hhgnenpnafffiadgabcclncnbfdopnlp
                   https://hhgnenpnafffiadgabcclncnbfdopnlp.chromiumapp.org/
Chrome Web Store:  bhjoeghhdmaoepmbklbcbdkfnjbgclbh
                   https://bhjoeghhdmaoepmbklbcbdkfnjbgclbh.chromiumapp.org/
```

The store install has its own ID because the store signs the package with the listing's key
(the store package is built without `"key"`, see below). `chrome.identity.launchWebAuthFlow()`
returns the consent result to the redirect URI of whichever build is installed, and the
StudyAtrium server accepts both IDs by default and nothing else. If you fork this repository with
your own key, your ID and redirect URI differ and must be allowed on your server
(`Consent:ChromeExtensionIds:focusguard` / `:focustunes`).

The Guard and Tune connect flows use PKCE (S256): each connect attempt creates a fresh code
verifier in the service worker, the consent URL carries only its challenge, and the verifier is
sent once in the assertion exchange and then discarded.

## Publishing to the Chrome Web Store

`npm run package` (zip.mjs) builds two archives from the same `dist/`:

| Archive | `manifest.json` | Use |
|---|---|---|
| `release/studylife-focus-v<version>.zip` | with `"key"` | GitHub release download, Load unpacked |
| `release/studylife-focus-v<version>-chrome-web-store.zip` | without `"key"` | upload to the Chrome Web Store |

Upload **only the `-chrome-web-store.zip`** in the developer dashboard. The store does not accept
a manifest `"key"` that is not the listing's own, and it signs the package with the listing's key
anyway, so the store build keeps the ID `bhjoeghhdmaoepmbklbcbdkfnjbgclbh`. The two archives
differ in that one manifest field only (`scripts/package-variants.mjs`); `dist/` itself keeps the
key, so local development and unpacked loads keep the stable unpacked ID. Every release carries
both archives, each with its own Sigstore bundle and covered by the build-provenance attestation.

## Development

```
npm ci
npm run typecheck
npm test
npm run build      # -> dist/
npm run package    # -> release/*.zip
```

`npm run contract-check` diffs this extension's hand-mirrored `TimerStateDtoPayload` (`src/api.ts`)
against the main `studylife` repo's committed OpenAPI spec.

## License

AGPL-3.0 - see [LICENSE](LICENSE).
