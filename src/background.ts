import { exchangeFocusGuardAssertion, exchangeFocusTunesAssertion, pollTimerState, type ExchangeFailure } from "./api";
import { loadBlockConfig } from "./blockConfig";
import {
  describeConnectResult,
  isConnectMessage,
  parseAuthRedirect,
  takePendingConnects,
  type ConnectAudience,
  type ConnectResult,
} from "./connect";
import { loadFeatureToggles } from "./featureToggles";
import { saveLastPollSnapshot } from "./pollSnapshot";
import { BLOCKED_PAGE_PATH, computeRules, isDomainAllowed, MANAGED_RULE_IDS, type RuleConfig } from "./rules";
import { loadGuardSettings, loadStoredSettings, loadTuneSettings, normalizeServerUrl, saveSettings } from "./settings";
import { refreshSpotifyTokens } from "./spotifyAuth";
import { loadSpotifyConfig, loadSpotifyTokens, saveSpotifyTokens } from "./spotifyConfig";
import { pausePlayback, playPlaylist } from "./spotifyPlayback";
import { computeTimerHintMatch, isTimerHintMessage, TIMER_HINT_SCRIPT_ID } from "./timerHintRegistration";
import { isToggleMessage } from "./toggleMessage";

// Chrome only clamps chrome.alarms to a 1-minute minimum for extensions installed from the Web
// Store - unpacked ones (this stays unpacked/private, being install-limit-constrained rather than
// Store-distributed) can go down to 30 seconds. This is purely the FALLBACK cadence for a session
// started from a device/browser this extension isn't installed in, or whenever the instant hint
// path below misses; see README's "Known limitations" for the confirmed race it's mitigating.
const POLL_ALARM_NAME = "focus-poll";
const POLL_PERIOD_MINUTES = 0.5;

// A hint fires the instant the page's LOCAL state changes, but the PUT that actually persists
// that state to the server is a separate, unordered network request - confirmed live: a
// hint-triggered poll landing ~40ms later read the OLD state, because the PUT simply hadn't
// landed yet, and nothing caught the real change until the next alarm tick. Retrying a couple of
// times shortly after closes that gap without waiting for the alarm fallback.
const HINT_RETRY_DELAYS_MS = [1000, 2500];

// Persisted (not just in-memory) so a service-worker restart mid-session doesn't misread a fresh
// "not running" as a transition and skip the tab sweep/playlist switch it already did before being
// killed. Separate keys per feature - Guard and Tune each have their own independent transition
// history, since either can be connected/enabled without the other.
const LAST_ACTIVE_GUARD_KEY = "lastKnownActiveGuard";
const LAST_ACTIVE_TUNE_KEY = "lastKnownActiveTune";

// tabId -> the URL it was showing right before sweepOpenTabs() redirected it to the blocked
// page - restoreSweptTabs() reads this back when the session ends. Session storage (not local):
// only meaningful for the current browser session's actual open tabs, and clearing automatically
// on browser restart is the right behavior (a tab that no longer exists has nothing to restore).
const SWEPT_TABS_KEY = "sweptTabOriginalUrls";

// Refresh a bit before Spotify's own expiry, not exactly at it, so a playback call never races
// a token that expires mid-request.
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

// Visible in chrome://extensions -> StudyLife Focus -> "service worker" -> Console. Deliberately
// kept (not stripped in production builds) - this whole poll/hint pipeline has no other way to be
// diagnosed live, since none of it has any user-facing surface of its own.
function log(message: string): void {
  console.log(`[StudyLifeFocus ${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  void resyncTimerHintContentScript();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  void resyncTimerHintContentScript();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM_NAME) return;
  log("alarm tick - scheduled poll");
  void pollAndApply();
});

// ── Instant reaction via a page-side hint (see timerHint.ts / interop.js's
// dispatchTimerStateChanged) - the alarm-driven poll above stays as the fallback. ──

async function resyncTimerHintContentScript(): Promise<void> {
  const settings = await loadStoredSettings();
  await syncTimerHintContentScript(settings?.serverUrl ?? null);
}

async function syncTimerHintContentScript(serverUrl: string | null): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [TIMER_HINT_SCRIPT_ID] });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [TIMER_HINT_SCRIPT_ID] });
  }

  const match = computeTimerHintMatch(serverUrl);
  if (!match) return; // not connected, or a malformed stored URL - nothing to register

  await chrome.scripting.registerContentScripts([
    { id: TIMER_HINT_SCRIPT_ID, matches: [match], js: ["timerHint.js"], runAt: "document_idle" },
  ]);
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isTimerHintMessage(message)) return undefined;
  // Just a "check now" nudge, not a trusted state - pollAndApply() re-derives the truth from this
  // extension's own authenticated GET /api/timerstate exactly as the alarm-driven call does. If
  // this log line is ever MISSING right after a Start/Pause/Reset click, the page's event either
  // didn't fire, or chrome.runtime.sendMessage failed to reach/wake a service worker that had
  // already gone idle - either way, only the alarm tick above will eventually catch up on it.
  log("received timer-state hint from page - polling now");
  void pollWithHintRetries();
  return undefined;
});

async function pollWithHintRetries(): Promise<void> {
  await pollAndApply();
  for (const delayMs of HINT_RETRY_DELAYS_MS) {
    await sleep(delayMs);
    log(`hint retry poll after ${delayMs}ms (in case the initial poll raced ahead of the server-side save)`);
    await pollAndApply();
  }
}

// Dispatches to each feature's own independent poll+apply, gated on that feature currently being
// both connected (has its own API key) and enabled (see featureToggles.ts) - either can run
// without the other, and neither ever sees or touches the other's stored state.
async function pollAndApply(): Promise<void> {
  const toggles = await loadFeatureToggles();
  if (toggles.guardEnabled) await pollAndApplyGuard();
  if (toggles.tuneEnabled) await pollAndApplyTune();
}

async function pollAndApplyGuard(): Promise<void> {
  const settings = await loadGuardSettings();
  if (!settings) return; // Guard not connected yet

  const result = await pollTimerState(settings);
  // Any failure (offline, unauthorized, http, network) is treated as "unknown" and left alone
  // rather than either blocking or unblocking - a transient network hiccup must never suddenly
  // block every site, and an expired key must never silently stop blocking mid-session either.
  if (!result.ok) {
    log(`guard poll failed (${result.kind}) - leaving current rules/tabs untouched`);
    return;
  }

  await saveLastPollSnapshot({
    isRunning: result.state.isRunning,
    phaseEndsAt: result.state.phaseEndsAt,
    serverNow: result.state.serverNow,
    polledAt: Date.now(),
  });

  const blockConfig = await loadBlockConfig();
  const alwaysAllowedDomains = [hostnameOf(settings.serverUrl)].filter((h): h is string => h !== null);
  const ruleConfig: RuleConfig = {
    active: result.state.isRunning,
    mode: blockConfig.mode,
    whitelist: blockConfig.whitelist,
    blacklist: blockConfig.blacklist,
    alwaysAllowedDomains,
  };

  const previouslyActive = ((await chrome.storage.session.get(LAST_ACTIVE_GUARD_KEY))[LAST_ACTIVE_GUARD_KEY] as boolean | undefined) ?? false;
  await chrome.storage.session.set({ [LAST_ACTIVE_GUARD_KEY]: ruleConfig.active });
  log(`guard poll ok - server isRunning=${result.state.isRunning}, previouslyActive=${previouslyActive}`);

  // Recomputed and reapplied on EVERY poll, not only on a detected transition - idempotent, so a
  // service-worker restart that missed the exact start/stop edge still converges to the correct
  // ruleset on its very next poll instead of staying stuck with whatever the last live SW applied.
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...MANAGED_RULE_IDS],
    addRules: computeRules(ruleConfig),
  });

  // Sweeping already-open tabs only makes sense right as a session STARTS - declarativeNetRequest
  // only ever intercepts NEW navigations, so a tab that was already open and loaded before the
  // rules changed needs an explicit push. Gated on the transition (not "ruleConfig.active" alone)
  // so this doesn't re-scan every open tab on every single poll while a session is already running.
  if (ruleConfig.active && !previouslyActive) {
    log("guard transition: session STARTED - sweeping open tabs");
    await sweepOpenTabs(ruleConfig);
  } else if (!ruleConfig.active && previouslyActive) {
    log("guard transition: session ENDED - restoring swept tabs");
    await restoreSweptTabs();
  } else {
    log("guard: no transition - rules reapplied idempotently, no tab sweep/restore needed");
  }
}

async function pollAndApplyTune(): Promise<void> {
  const settings = await loadTuneSettings();
  if (!settings) return; // Tune not connected yet

  const result = await pollTimerState(settings);
  if (!result.ok) {
    log(`tune poll failed (${result.kind}) - leaving current playback state untouched`);
    return;
  }

  const previouslyActive = ((await chrome.storage.session.get(LAST_ACTIVE_TUNE_KEY))[LAST_ACTIVE_TUNE_KEY] as boolean | undefined) ?? false;
  await chrome.storage.session.set({ [LAST_ACTIVE_TUNE_KEY]: result.state.isRunning });
  log(`tune poll ok - server isRunning=${result.state.isRunning}, previouslyActive=${previouslyActive}`);

  if (result.state.isRunning === previouslyActive) {
    log("tune: no transition - nothing to switch");
    return;
  }
  await applyPlaylistForState(result.state.isRunning);
}

async function applyPlaylistForState(sessionActive: boolean): Promise<void> {
  const config = await loadSpotifyConfig();
  if (!config.clientId) {
    log("tune transition detected, but Spotify isn't connected yet - nothing to switch");
    return;
  }

  const accessToken = await getValidAccessToken(config.clientId);
  if (!accessToken) {
    log("tune transition detected, but no valid Spotify access token (not connected, or refresh failed)");
    return;
  }

  if (sessionActive) {
    if (!config.focusPlaylistUri) {
      log("tune: session started, but no focus playlist is configured - nothing to switch to");
      return;
    }
    log("tune: session started - switching to the focus playlist");
    await playPlaylist(accessToken, config.focusPlaylistUri);
  } else if (config.breakPlaylistUri) {
    log("tune: session ended - switching to the break playlist");
    await playPlaylist(accessToken, config.breakPlaylistUri);
  } else {
    log("tune: session ended - pausing playback (no break playlist configured)");
    await pausePlayback(accessToken);
  }
  // Playback-call failures (no active device, network, etc.) are silently accepted - there is
  // no user-facing surface waiting on this call's result, and the next transition will simply
  // try again.
}

async function getValidAccessToken(clientId: string): Promise<string | null> {
  const tokens = await loadSpotifyTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - TOKEN_EXPIRY_BUFFER_MS) return tokens.accessToken;

  const refreshed = await refreshSpotifyTokens(clientId, tokens.refreshToken);
  if (!refreshed) return null;
  await saveSpotifyTokens(refreshed);
  return refreshed.accessToken;
}

// ── Feature enable/disable toggles (options.ts) - unlike the poll gating above, turning Guard OFF
// needs an immediate, explicit undo (release any active block right now), since blocking has a
// real, visible side effect on the browser that must not just linger until the next poll happens
// to notice the toggle changed. Turning Tune off needs no such undo - it simply stops switching
// playback going forward, there's nothing further to release. ──

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isToggleMessage(message)) return undefined;
  void handleToggleChanged(message.feature, message.enabled);
  return undefined;
});

async function handleToggleChanged(feature: "guard" | "tune", enabled: boolean): Promise<void> {
  log(`${feature} toggled ${enabled ? "on" : "off"}`);
  if (feature === "guard") {
    if (enabled) {
      await pollAndApplyGuard();
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [...MANAGED_RULE_IDS], addRules: [] });
      await restoreSweptTabs();
      await chrome.storage.session.remove(LAST_ACTIVE_GUARD_KEY);
    }
    return;
  }
  if (enabled) await pollAndApplyTune();
}

// ── FocusGuard-specific: tab sweep/restore ──────────────────────────────────────────────────

async function sweepOpenTabs(config: RuleConfig): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const blockedUrl = chrome.runtime.getURL(BLOCKED_PAGE_PATH);
  const originalUrls: Record<number, string> = {};
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let hostname: string;
    try {
      const parsed = new URL(tab.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue; // leave chrome://, the extension's own pages, etc. alone
      hostname = parsed.hostname;
    } catch {
      continue;
    }
    if (!isDomainAllowed(hostname, config)) {
      // Recorded BEFORE the redirect - this is the only point in the whole extension that ever
      // sees a blocked page's real destination (see rules.ts's comment on why the
      // declarativeNetRequest redirect itself can't carry it along), so restoreSweptTabs() below
      // can send the tab back where it was once the session ends.
      originalUrls[tab.id] = tab.url;
      await chrome.tabs.update(tab.id, { url: blockedUrl }).catch(() => {
        // A tab can close between query() and update() - nothing to redirect anymore, ignore.
      });
    }
  }
  if (Object.keys(originalUrls).length > 0) {
    const existing = ((await chrome.storage.session.get(SWEPT_TABS_KEY))[SWEPT_TABS_KEY] as Record<number, string> | undefined) ?? {};
    await chrome.storage.session.set({ [SWEPT_TABS_KEY]: { ...existing, ...originalUrls } });
  }
  log(`swept ${Object.keys(originalUrls).length} tab(s) to the blocked page`);
}

// Sends every tab this extension itself redirected to the blocked page back to whatever it was
// showing before, once the session that caused the redirect has ended (or Guard was switched
// off). Deliberately only tabs STILL sitting on the blocked page: if the user already navigated
// away from it themselves while the session was running, that's a deliberate choice this must
// not undo.
async function restoreSweptTabs(): Promise<void> {
  const stored = (await chrome.storage.session.get(SWEPT_TABS_KEY))[SWEPT_TABS_KEY] as Record<number, string> | undefined;
  if (!stored || Object.keys(stored).length === 0) {
    log("restore: nothing was swept - nothing to restore");
    return;
  }

  const blockedUrl = chrome.runtime.getURL(BLOCKED_PAGE_PATH);
  let restored = 0;
  for (const [tabIdKey, originalUrl] of Object.entries(stored)) {
    const tabId = Number(tabIdKey);
    const tab = await chrome.tabs.get(tabId).catch(() => null); // tab may have been closed since
    if (!tab || tab.url !== blockedUrl) continue;
    await chrome.tabs.update(tabId, { url: originalUrl })
      .then(() => { restored++; })
      .catch(() => {
        // Closed between the get() above and this update() - nothing left to restore, ignore.
      });
  }
  await chrome.storage.session.remove(SWEPT_TABS_KEY);
  log(`restored ${restored} of ${Object.keys(stored).length} previously-swept tab(s)`);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ── Browser-consent connect flow for StudyLife - runs independently once per audience
// (identity contract v1 §2: "focusguard" and "focustunes" are still two separate, separately-
// consented server-side identities, merging the two EXTENSIONS didn't merge those). Spotify's own
// OAuth (spotifyAuth.ts) is unrelated and runs entirely within options.ts. ──

chrome.permissions.onAdded.addListener((added) => {
  void (async () => {
    const pending = await takePendingConnects(added.origins ?? []);
    for (const { audience, serverUrl } of pending) {
      await handleConnectRequest(audience, serverUrl).catch((e: unknown) =>
        finishConnect(audience, { ok: false, kind: "auth-window-failed", message: e instanceof Error ? e.message : String(e) }));
    }
  })();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isConnectMessage(message)) return undefined;
  // Returning true keeps the message channel open so the sendResponse below can fire once
  // handleConnectRequest's async chain resolves - see connect.ts for why this whole flow lives
  // here rather than in the calling page. sendResponse is best-effort: if the options page
  // already closed (the expected, common case once the auth window opens), this simply has no
  // listener left to reach, and the notify() call inside handleConnectRequest is what the user
  // actually sees. The .catch is load-bearing: an unhandled rejection here dies silently in the
  // service worker and the user sees NOTHING.
  void handleConnectRequest(message.audience, message.serverUrl)
    .catch((e: unknown) =>
      finishConnect(message.audience, { ok: false, kind: "auth-window-failed", message: e instanceof Error ? e.message : String(e) }))
    .then(sendResponse);
  return true;
});

async function handleConnectRequest(audience: ConnectAudience, rawServerUrl: string): Promise<ConnectResult> {
  const serverUrl = normalizeServerUrl(rawServerUrl);

  let origin: string;
  try {
    origin = `${new URL(serverUrl).origin}/*`;
  } catch {
    return { ok: false, kind: "invalid-url" };
  }

  // Contains-check ONLY - the actual permissions.request() happens in the calling page, inside
  // the button's own user gesture (see studylife-capture's background.ts for why requesting from
  // the service worker itself fails).
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    return finishConnect(audience, { ok: false, kind: "permission-denied" });
  }

  const state = crypto.randomUUID();
  const authUrl = new URL(`/connect/${audience}`, serverUrl);
  authUrl.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
  authUrl.searchParams.set("state", state);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/did not approve|cancel/i.test(message)) {
      return finishConnect(audience, { ok: false, kind: "cancelled" });
    }
    return finishConnect(audience, { ok: false, kind: "auth-window-failed", message });
  }
  if (!responseUrl) {
    return finishConnect(audience, { ok: false, kind: "cancelled" });
  }

  const redirectResult = parseAuthRedirect(responseUrl, state);
  if (!redirectResult.ok) {
    return finishConnect(audience, { ok: false, kind: redirectResult.kind });
  }

  const existing = await loadStoredSettings();
  const toggles = await loadFeatureToggles();
  if (audience === "focusguard") {
    const exchange = await exchangeFocusGuardAssertion(serverUrl, redirectResult.assertion);
    if (!exchange.ok) return finishConnect(audience, describeExchangeFailure(exchange));
    await saveSettings({
      serverUrl,
      guardApiKey: exchange.focusGuardApiKey,
      tuneApiKey: existing?.tuneApiKey ?? "",
    });
    await syncTimerHintContentScript(serverUrl);
    // Pick up the current session state immediately, not up to 30s later - but only if the user
    // hasn't switched Guard off, in which case connecting must not start blocking behind their back.
    if (toggles.guardEnabled) await pollAndApplyGuard();
  } else {
    const exchange = await exchangeFocusTunesAssertion(serverUrl, redirectResult.assertion);
    if (!exchange.ok) return finishConnect(audience, describeExchangeFailure(exchange));
    await saveSettings({
      serverUrl,
      guardApiKey: existing?.guardApiKey ?? "",
      tuneApiKey: exchange.focusTunesApiKey,
    });
    await syncTimerHintContentScript(serverUrl);
    if (toggles.tuneEnabled) await pollAndApplyTune();
  }
  return finishConnect(audience, { ok: true, serverUrl });
}

function describeExchangeFailure(exchange: ExchangeFailure): ConnectResult {
  switch (exchange.kind) {
    case "offline":
      return { ok: false, kind: "offline" };
    case "not-found":
      return { ok: false, kind: "server-outdated" };
    case "http":
      return { ok: false, kind: "exchange-failed", message: exchange.message || `HTTP ${exchange.status}` };
    case "network":
      return { ok: false, kind: "exchange-failed", message: exchange.message };
  }
}

function finishConnect(audience: ConnectAudience, result: ConnectResult): ConnectResult {
  const featureName = audience === "focusguard" ? "Guard" : "Tune";
  if (result.ok) {
    notify(`Connected StudyLife ${featureName}`, result.serverUrl);
  } else {
    notify(`StudyLife ${featureName} connect failed`, describeConnectResult(result));
  }
  return result;
}

function notify(title: string, message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title,
    message,
  });
}
