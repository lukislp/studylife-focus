# Privacy Policy - StudyLife Focus

StudyLife Focus is a browser extension for a self-hosted [StudyLife](https://github.com/lukislp/studylife)
instance, bundling two independent features (Guard and Tune). There is no vendor server involved -
your data goes at most three places: your own StudyLife server, Spotify's own API (Tune only,
using credentials you obtain directly from Spotify), and your own device's local browser storage.

## What this extension reads

- **Whether a focus session is currently running**, via `GET /api/timerstate` on the StudyLife
  server you configure, roughly every 30 seconds (faster if you started/paused/reset the timer
  from the same browser - see the next point). Guard and Tune each use their own separate API key
  for this; neither key can read anything else from your account - not your notes, sessions,
  courses, or settings (see the `studylife` repo's `ApiKeyScopes.FocusGuard`/`ApiKeyScopes.FocusTunes`
  for the server-enforced scope).
- **A single browser event StudyLife's own page dispatches** on your server's origin only, via a
  small content script registered for exactly that one origin. The script listens for that one
  named event and nothing else - it never reads the page's DOM, its content, or any other data on
  it; hearing the event just makes the extension poll the endpoint above immediately instead of
  waiting for its next scheduled check.
- **(Guard) The URLs of your currently open browser tabs**, compared locally against your own
  block list to decide which already-open tabs to redirect when a focus session starts. This
  comparison happens entirely on your device - tab URLs are never sent anywhere, not even to your
  own StudyLife server.
- **(Guard) The URL of a page you navigate to while a session is active**, to decide whether to
  allow or redirect it (again, entirely local, via the browser's own `declarativeNetRequest` API -
  the extension's code never sees the destination URL of a blocked navigation, only the browser's
  matching engine does).
- **(Tune) Which Spotify devices are available**, via Spotify's own API, only when it needs to
  switch playback and no device is already active - used solely to pick one to target, never
  stored or sent anywhere else.
- **(Tune) Nothing from Spotify beyond what's needed to switch playback** - this extension never
  reads your listening history, library, or personal data from Spotify's API.

## What this extension stores

Locally, in the browser's own extension storage, never transmitted anywhere except back to the
service each item authenticates with:

- Your StudyLife server's base URL, shared by both features.
- Your Guard and Tune API keys, independently (obtained via the passkey-backed browser-consent
  connect flow, once per feature you connect - you never see or copy/paste either key yourself).
- Whether each feature is currently switched on or off.
- Guard's chosen blocking mode (allowlist/blocklist) and the domains on it.
- Guard's result of the most recent poll (session running or not, and when it ends), used to
  render the blocked page's countdown without an extra network call.
- Tune's Spotify client ID, focus/break playlist URIs, and Spotify OAuth tokens (obtained directly
  from Spotify via its own PKCE authorization flow - StudyLife is never involved in obtaining or
  refreshing this token, and never sees it).
- The URLs of tabs Guard redirected to the blocked page, only until the session ends - kept
  temporarily so those tabs can be sent back to what they were showing before, cleared once
  restored. Held in session storage (cleared on browser restart), never transmitted anywhere.

## What this extension never does

- Never collects analytics, telemetry, or crash reports.
- Never contacts any server other than the one you explicitly configure, plus Spotify if you
  connect Tune.
- Never reads the content of any page you visit, including your own StudyLife pages - the
  content script mentioned above only listens for one specific named browser event.
- Never writes anything to your StudyLife account - both API keys are read-only by server-side
  design, even if they wanted to write something.
- Never shares your Spotify token with StudyLife, or your StudyLife credentials with Spotify.

## Source

This extension is open source (AGPL-3.0): <https://github.com/lukislp/studylife-focus>.
