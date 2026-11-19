# Privacy Policy - StudyAtrium Focus

StudyAtrium Focus is a browser extension for a self-hosted [StudyAtrium](https://github.com/lukislp/studylife)
instance, bundling two independent features (Guard and Tune). There is no vendor server involved -
your data goes at most three places: your own StudyAtrium server, Spotify's own API (Tune only,
using credentials you obtain directly from Spotify), and your own device's local browser storage.

**Controller:** the operator of your instance. **Publisher:** see the imprint at
<https://lktec.org/impressum>. Spotify is a separate controller for everything that happens at
Spotify (see "Spotify" below).

## Access to all websites (Guard)

When you connect Guard, the browser asks for **access to all websites** (`http://*/*` and
`https://*/*`; Chrome words this as being able to read and change your data on all websites).
Guard needs it because its default allowlist mode blocks every site that is not on your list, and
the browser only allows redirecting a navigation to a site the extension has access to - so it has
to cover every site. What the extension does with it, verified against the code:

- While a focus session is active, the browser's own `declarativeNetRequest` matching engine
  compares the address of each page you navigate to with your block list and redirects blocked
  ones to the extension's blocked page. The extension's code does not receive the address of a
  blocked navigation.
- It does not read, inject into, or modify the content of the pages you visit. The only content
  script it registers is limited to your StudyAtrium server's origin (see above).
- Page addresses are never sent to your StudyAtrium server, to Spotify, or anywhere else.

If you only connect Tune, the browser asks for your StudyAtrium server's origin only. You can
withdraw the broad access at any time on the extension's page in `chrome://extensions`
(Guard then stops working).
## What this extension reads

- **Whether a focus session is currently running**, via `GET /api/timerstate` on the StudyAtrium
  server you configure, roughly every 30 seconds (faster if you started/paused/reset the timer
  from the same browser - see the next point). Guard and Tune each use their own separate API key
  for this; neither key can read anything else from your account - not your notes, sessions,
  courses, or settings (see the `studylife` repo's `ApiKeyScopes.FocusGuard`/`ApiKeyScopes.FocusTunes`
  for the server-enforced scope).
- **A single browser event StudyAtrium's own page dispatches** on your server's origin only, via a
  small content script registered for exactly that one origin. The script listens for that one
  named event and nothing else - it never reads the page's DOM, its content, or any other data on
  it; hearing the event just makes the extension poll the endpoint above immediately instead of
  waiting for its next scheduled check.
- **(Guard) The URLs of your currently open browser tabs**, compared locally against your own
  block list to decide which already-open tabs to redirect when a focus session starts. This
  comparison happens entirely on your device - tab URLs are never sent anywhere, not even to your
  own StudyAtrium server.
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

- Your StudyAtrium server's base URL, shared by both features.
- Your Guard and Tune API keys, independently (obtained via the passkey-backed browser-consent
  connect flow, once per feature you connect - you never see or copy/paste either key yourself).
- Whether each feature is currently switched on or off.
- Guard's chosen blocking mode (allowlist/blocklist) and the domains on it.
- Guard's result of the most recent poll (session running or not, and when it ends), used to
  render the blocked page's countdown without an extra network call.
- Tune's Spotify client ID, focus/break playlist URIs, and Spotify OAuth tokens (obtained directly
  from Spotify via its own PKCE authorization flow - StudyAtrium is never involved in obtaining or
  refreshing this token, and never sees it).
- The URLs of tabs Guard redirected to the blocked page, only until the session ends - kept
  temporarily so those tabs can be sent back to what they were showing before, cleared once
  restored. Held in session storage (cleared on browser restart), never transmitted anywhere.

## Spotify

If you connect Tune, the extension talks to Spotify directly from your browser
(`accounts.spotify.com` for the authorization flow and token refresh, `api.spotify.com` for
playback). It sends Spotify your own Spotify client ID, the authorization tokens, and playback
commands (start a playlist by its URI, pause), plus the list-of-devices lookup described above.
StudyAtrium is not involved in that traffic. Spotify processes this data as its own controller
under [Spotify's privacy policy](https://www.spotify.com/legal/privacy-policy/); you can revoke
the extension's access to your Spotify account at <https://www.spotify.com/account/apps/>.

## Deleting your data

The extension has no account of its own. Removing the extension from the browser deletes
everything it stored locally (server URL, both API keys, block list, Spotify settings and tokens).
Also revoke the Guard and Tune API keys in your StudyAtrium instance, and the access in your
Spotify account (link above), because deleting the local copy does not invalidate them.
## What this extension never does

- Never collects analytics, telemetry, or crash reports.
- Never contacts any server other than the one you explicitly configure, plus Spotify if you
  connect Tune.
- Never reads the content of any page you visit, including your own StudyAtrium pages - the
  content script mentioned above only listens for one specific named browser event.
- Never writes anything to your StudyAtrium account - both API keys are read-only by server-side
  design, even if they wanted to write something.
- Never shares your Spotify token with StudyAtrium, or your StudyAtrium credentials with Spotify.

## Source

This extension is open source (AGPL-3.0): <https://github.com/lukislp/studylife-focus>.
