import { exchangeFocusGuardAssertion, pollTimerState } from "./api";
import { loadBlockConfig } from "./blockConfig";
import {
  describeConnectResult,
  isConnectMessage,
  parseAuthRedirect,
  takePendingConnect,
  type ConnectResult,
} from "./connect";
import { saveLastPollSnapshot } from "./pollSnapshot";
import { BLOCKED_PAGE_PATH, computeRules, isDomainAllowed, MANAGED_RULE_IDS, type RuleConfig } from "./rules";
import { loadSettings, normalizeServerUrl, saveSettings } from "./settings";
import { computeTimerHintMatch, isTimerHintMessage, TIMER_HINT_SCRIPT_ID } from "./timerHintRegistration";

// Same reasoning as studylife-focustunes: Chrome only clamps chrome.alarms to a 1-minute minimum
// for extensions installed from the Web Store - unpacked ones (which FocusGuard is, for now) can
// go down to 30 seconds. This is purely the FALLBACK cadence for a session started from a
// device/browser this extension isn't installed in; see the timer-hint content script below for
// the (not fully reliable - see log() calls throughout this file) instant path.
const POLL_ALARM_NAME = "focusguard-poll";
const POLL_PERIOD_MINUTES = 0.5;

// Persisted (not just in-memory) so a service-worker restart mid-session doesn't misread a fresh
// "not running" as a transition and skip the tab sweep it already did before being killed.
const LAST_ACTIVE_KEY = "lastKnownActive";

// tabId -> the URL it was showing right before sweepOpenTabs() redirected it to the blocked
// page - restoreSweptTabs() reads this back when the session ends. Session storage (not local):
// only meaningful for the current browser session's actual open tabs, and clearing automatically
// on browser restart is the right behavior (a tab that no longer exists has nothing to restore).
const SWEPT_TABS_KEY = "sweptTabOriginalUrls";

// Visible in chrome://extensions -> FocusGuard -> "service worker" -> Console. Deliberately kept
// (not stripped in production builds) - this whole poll/hint pipeline has no other way to be
// diagnosed live, since none of it has any user-facing surface of its own.
function log(message: string): void {
  console.log(`[FocusGuard ${new Date().toISOString()}] ${message}`);
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
// dispatchTimerStateChanged) - the alarm-driven poll above stays as the fallback for a session
// started from a device/browser that isn't running this extension. ──

async function resyncTimerHintContentScript(): Promise<void> {
  const settings = await loadSettings();
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

// A hint fires the instant the page's LOCAL state changes, but the PUT that actually persists
// that state to the server is a separate, unordered network request - confirmed live (see
// README): a hint-triggered poll landing ~40ms later read the OLD state, because the PUT simply
// hadn't landed yet, and nothing caught the real change until the next 30s alarm tick. Retrying a
// couple of times shortly after closes that gap without waiting for the alarm fallback.
const HINT_RETRY_DELAYS_MS = [1000, 2500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!isTimerHintMessage(message)) return undefined;
  // Just a "check now" nudge, not a trusted state - pollAndApply() re-derives the truth from the
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

async function pollAndApply(): Promise<void> {
  const settings = await loadSettings();
  if (!settings) return; // not connected yet - nothing to poll, nothing to block

  const result = await pollTimerState(settings);
  // Any failure (offline, unauthorized, http, network) is treated as "unknown" and left alone
  // rather than either blocking or unblocking - a transient network hiccup must never suddenly
  // block every site, and an expired key must never silently stop blocking mid-session either.
  // The next successful poll (or a manual reconnect for "unauthorized") resolves it either way.
  if (!result.ok) {
    log(`poll failed (${result.kind}) - leaving current rules/tabs untouched`);
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

  const previouslyActive = ((await chrome.storage.session.get(LAST_ACTIVE_KEY))[LAST_ACTIVE_KEY] as boolean | undefined) ?? false;
  await chrome.storage.session.set({ [LAST_ACTIVE_KEY]: ruleConfig.active });
  log(`poll ok - server isRunning=${result.state.isRunning}, previouslyActive=${previouslyActive}`);

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
    log("transition detected: session STARTED - sweeping open tabs");
    await sweepOpenTabs(ruleConfig);
  } else if (!ruleConfig.active && previouslyActive) {
    log("transition detected: session ENDED - restoring swept tabs");
    await restoreSweptTabs();
  } else {
    log("no transition - rules reapplied idempotently, no tab sweep/restore needed");
  }
}

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
// showing before, once the session that caused the redirect has ended. Deliberately only tabs
// STILL sitting on the blocked page: if the user already navigated away from it themselves while
// the session was running, that's a deliberate choice this must not undo.
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

// ── Browser-consent connect flow (mirrors studylife-capture's background.ts, audience "focusguard") ──

chrome.permissions.onAdded.addListener((added) => {
  void (async () => {
    const serverUrl = await takePendingConnect(added.origins ?? []);
    if (!serverUrl) return;
    await handleConnectRequest(serverUrl).catch((e: unknown) =>
      finishConnect({ ok: false, kind: "auth-window-failed", message: e instanceof Error ? e.message : String(e) }));
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
  void handleConnectRequest(message.serverUrl)
    .catch((e: unknown) =>
      finishConnect({ ok: false, kind: "auth-window-failed", message: e instanceof Error ? e.message : String(e) }))
    .then(sendResponse);
  return true;
});

async function handleConnectRequest(rawServerUrl: string): Promise<ConnectResult> {
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
    return finishConnect({ ok: false, kind: "permission-denied" });
  }

  const state = crypto.randomUUID();
  const authUrl = new URL("/connect/focusguard", serverUrl);
  authUrl.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
  authUrl.searchParams.set("state", state);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/did not approve|cancel/i.test(message)) {
      return finishConnect({ ok: false, kind: "cancelled" });
    }
    return finishConnect({ ok: false, kind: "auth-window-failed", message });
  }
  if (!responseUrl) {
    return finishConnect({ ok: false, kind: "cancelled" });
  }

  const redirectResult = parseAuthRedirect(responseUrl, state);
  if (!redirectResult.ok) {
    return finishConnect({ ok: false, kind: redirectResult.kind });
  }

  const exchange = await exchangeFocusGuardAssertion(serverUrl, redirectResult.assertion);
  if (!exchange.ok) {
    switch (exchange.kind) {
      case "offline":
        return finishConnect({ ok: false, kind: "offline" });
      case "not-found":
        return finishConnect({ ok: false, kind: "server-outdated" });
      case "http":
        return finishConnect({
          ok: false,
          kind: "exchange-failed",
          message: exchange.message || `HTTP ${exchange.status}`,
        });
      case "network":
        return finishConnect({ ok: false, kind: "exchange-failed", message: exchange.message });
    }
  }

  await saveSettings({ serverUrl, apiKey: exchange.focusGuardApiKey });
  await syncTimerHintContentScript(serverUrl);
  await pollAndApply(); // pick up the current session state immediately, not up to a minute later
  return finishConnect({ ok: true, serverUrl });
}

function finishConnect(result: ConnectResult): ConnectResult {
  if (result.ok) {
    notify("Connected to StudyLife", result.serverUrl);
  } else {
    notify("StudyLife Connect failed", describeConnectResult(result));
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
