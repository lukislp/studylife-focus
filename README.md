# StudyLife FocusGuard

A browser extension that blocks or allows sites while a [StudyLife](https://github.com/lukislp/studylife)
focus-timer session is running - so opening `X` distracting sites during deep-work time takes a
deliberate detour instead of one click.

Separate from [studylife-capture](https://github.com/lukislp/studylife-capture) on purpose: capture
saves things *into* StudyLife, this reads one thing *out of* it (whether a session is active) and
never touches your notes, sessions, or account settings at all.

## How it works

1. Point the extension at your self-hosted StudyLife server (base URL only, e.g.
   `https://studylife.example.com` - no path needed, every subpage/API route under it is covered).
2. Connect - the same passkey-backed consent flow studylife-capture and studylife-mcp use. No API
   key to copy and paste.
3. Choose a mode:
   - **Allowlist** (recommended) - block everything except the sites you list. Best for actual
     deep-focus time: you decide up front what you need, nothing sneaks in.
   - **Blocklist** - only block the sites you list, everything else stays reachable. Simpler to
     set up, but never fully "complete" - new distractions need to be added reactively.
4. While a focus session is running (polled from `GET /api/timerstate`, roughly once a minute -
   see "Known limitations" below), blocked navigations redirect to a page showing the session's
   remaining time, and any matching tabs already open when the session starts get swept too.

Add a domain once (e.g. `wikipedia.org`) and every subdomain/subpage under it is covered
automatically - no need to list `en.wikipedia.org`, `de.wikipedia.org`, etc. separately.

## Permissions

- `storage` - your server URL, API key, and block-list configuration, stored locally only.
- `alarms` - the once-a-minute poll (see below).
- `declarativeNetRequest` - the actual blocking/redirecting mechanism.
- `tabs` - reads the URLs of your currently open tabs, purely to redirect already-open matches
  the moment a focus session starts (declarativeNetRequest only ever intercepts *new*
  navigations). Tab URLs are compared against your block list locally and never leave the
  browser - see [PRIVACY.md](PRIVACY.md).
- `identity` - the browser-consent connect flow (`chrome.identity.launchWebAuthFlow`).
- `notifications` - a confirmation when connecting succeeds or fails.
- `optional_host_permissions` (`http://*/*`, `https://*/*`) - requested at connect time, scoped
  to exactly the one server origin you enter, never granted upfront.

## Known limitations

- **Up to ~60 seconds of lag** between a focus session starting/ending and blocking actually
  engaging - `chrome.alarms` (the only persistent timer primitive available to an MV3 service
  worker, which can be killed and respawned at any time) has a 1-minute minimum period for
  installed extensions.
- **The blocked page doesn't say which site you tried to visit** - the redirect is a static
  extension page, not a per-request rewrite, so there's currently no channel carrying the
  original URL along. A future version could add this via `chrome.webNavigation` plus a
  regex-based redirect rewrite; it's a real gap, just not solved yet.
- **No in-extension way to end a session early.** The FocusGuard API key is deliberately
  read-only (see below) - if you need to stop, end the session in StudyLife itself.

## Why the API key is this narrow

FocusGuard's key can reach exactly one endpoint: `GET /api/timerstate` (plus `whoami` for
diagnostics). It can't read your notes, sessions, or courses, and it can't write anything at
all - not even the timer state it polls. A leaked FocusGuard key tells an attacker only whether
you currently have a session running, nothing else. See the `studylife` repo's
`ApiKeyScopes.FocusGuard` for the enforced scope.

## Development

```
npm ci
npm run typecheck
npm test
npm run build      # -> dist/
npm run package    # -> release/*.zip
```

`npm run contract-check` diffs this extension's hand-mirrored `TimerStateDtoPayload` (`src/api.ts`)
against the main `studylife` repo's committed OpenAPI spec, so a server-side field rename fails
here instead of silently breaking polling in production.

## License

AGPL-3.0 - see [LICENSE](LICENSE).
