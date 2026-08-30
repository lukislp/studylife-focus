# StudyLife Focus

A browser extension with two independent, separately-toggleable features tied to your
[StudyLife](https://github.com/lukislp/studylife) focus-timer session:

- **Guard** - blocks or allows sites while a session is running, so opening a distracting site
  during deep-work time takes a deliberate detour instead of one click.
- **Tune** - switches a Spotify playlist automatically ("focus" while running, "break"/pause once
  it ends).

Originally two separate extensions (`studylife-focusguard` and `studylife-focustunes`). Both exist
purely to automate something about your environment around the exact same signal - whether a
StudyLife focus session is currently running - so they're merged into one package: one shared
alarm/polling timer and one shared server-URL setup instead of two separate extensions each
independently reimplementing the same "is a session running" infrastructure, and one install
instead of two for a single coherent purpose. Each feature still keeps its own settings tab, its
own on/off switch, and its own narrowly-scoped, separately-consented API key - merging the
*packaging* didn't merge the two features' concerns into each other.

## How it works

1. **General tab**: point the extension at your self-hosted StudyLife server (base URL only, e.g.
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
   same browser this extension runs in (StudyLife's own page dispatches an event a content script
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
- `identity` - three independent OAuth-style flows: StudyLife's browser-consent connect (once per
  feature you connect), and Spotify's own PKCE authorization flow for Tune.
- `notifications` - a confirmation when connecting either feature succeeds or fails.
- `scripting` - dynamically registers a tiny content script against exactly the one server origin
  you connect to, so it can hear StudyLife's own page dispatch a "timer state changed" browser
  event and relay a "check now" nudge to the extension - it doesn't read or modify page content,
  and the poll fallback still covers everything if this never fires.
- `optional_host_permissions` (`http://*/*`, `https://*/*`) - requested only at StudyLife connect
  time, scoped to exactly the one server origin you enter.
- `optional_host_permissions` for `accounts.spotify.com`/`api.spotify.com` - requested only when
  you connect Tune's Spotify integration, so a Guard-only install never prompts for Spotify access
  at all.

## Known limitations

- **Up to ~30 seconds of lag when the poll fallback is what's covering a transition** (a session
  started from a device/browser this extension isn't installed in) - `chrome.alarms` (the only
  persistent timer primitive available to an MV3 service worker, which can be killed and
  respawned at any time) has a 30-second minimum period for an unpacked extension (1 minute
  once/if this ever ships via the Web Store).
- **The instant same-browser path can occasionally lose a race.** The page-side event fires the
  moment the timer's LOCAL state changes, but the `PUT /api/timerstate` that actually persists that
  state to the server is a separate, unordered network request - confirmed live via the service
  worker's own logs: a hint-triggered poll landing ~40ms after the click read the OLD server state,
  because the save simply hadn't landed yet, and only the next alarm tick caught the real change.
  Mitigated (not eliminated - a sufficiently slow save could still outlast it) by retrying the poll
  twice more, 1s and 2.5s after the first one. Open `chrome://extensions` -> StudyLife Focus ->
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
  below) - if you need to stop, end the session in StudyLife itself.

## Why the API keys are this narrow

Guard's and Tune's StudyLife keys can each reach exactly one endpoint: `GET /api/timerstate`
(plus `whoami` for diagnostics) - two separate, separately-consented server-side identities
(neither can read the other's connection state), matching `ApiKeyScopes.FocusGuard` /
`ApiKeyScopes.FocusTunes` in the `studylife` repo. Neither can read your notes, sessions, courses,
or settings, and neither can write anything at all - not even the timer state either one polls.
Tune's actual music control happens entirely against Spotify's own API, using a completely
separate token obtained directly from Spotify - StudyLife never sees it, and Spotify never sees
your StudyLife credentials.

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
