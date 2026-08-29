# Privacy Policy - StudyLife FocusGuard

StudyLife FocusGuard is a browser extension for a self-hosted [StudyLife](https://github.com/lukislp/studylife)
instance. There is no vendor server involved - your data goes exactly two places: your own
StudyLife server, and your own device's local browser storage.

## What this extension reads

- **Whether a focus session is currently running**, via `GET /api/timerstate` on the StudyLife
  server you configure, roughly every 30 seconds (faster if you started/paused/reset the timer
  from the same browser - see the next point). The extension's API key cannot read anything else
  from your account - not your notes, sessions, courses, or settings (see the `studylife` repo's
  `ApiKeyScopes.FocusGuard` for the server-enforced scope).
- **A single browser event StudyLife's own page dispatches** on your server's origin only, via a
  small content script registered for exactly that one origin. The script listens for that one
  named event and nothing else - it never reads the page's DOM, its content, or any other data on
  it; hearing the event just makes the extension poll the endpoint above immediately instead of
  waiting for its next scheduled check.
- **The URLs of your currently open browser tabs**, compared locally against your own block
  list to decide which already-open tabs to redirect when a focus session starts. This
  comparison happens entirely on your device - tab URLs are never sent anywhere, not even to
  your own StudyLife server.
- **The URL of a page you navigate to while a session is active**, to decide whether to allow or
  redirect it (again, entirely local, via the browser's own `declarativeNetRequest` API - the
  extension's code never sees the destination URL of a blocked navigation, only the browser's
  matching engine does).

## What this extension stores

Locally, in the browser's own extension storage, never transmitted anywhere except back to your
own StudyLife server as part of authenticating the poll above:

- Your StudyLife server's base URL.
- Your FocusGuard API key (obtained via the passkey-backed browser-consent connect flow - you
  never see or copy/paste the key itself).
- Your chosen blocking mode (allowlist/blocklist) and the domains on it.
- The result of the most recent poll (session running or not, and when it ends), used to render
  the blocked page's countdown without an extra network call.

## What this extension never does

- Never collects analytics, telemetry, or crash reports.
- Never contacts any server other than the one you explicitly configure.
- Never reads the content of any page you visit, including your own StudyLife pages - the
  content script mentioned above only listens for one specific named browser event.
- Never writes anything to your StudyLife account - the API key it uses cannot, even if it
  wanted to (read-only by server-side design).

## Source

This extension is open source (AGPL-3.0): <https://github.com/lukislp/studylife-focusguard>.
