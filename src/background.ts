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

// Chrome's documented minimum for a repeating alarm in an installed (non-dev-mode) extension is
// 1 minute - a focus session can therefore take up to ~60s to actually start blocking after the
// timer starts server-side. Acceptable trade-off (see README): there is no faster persistent
// timer primitive available to an MV3 service worker, which can otherwise be killed and
// respawned at any time (setInterval would not survive that).
const POLL_ALARM_NAME = "focusguard-poll";
const POLL_PERIOD_MINUTES = 1;

// Persisted (not just in-memory) so a service-worker restart mid-session doesn't misread a fresh
// "not running" as a transition and skip the tab sweep it already did before being killed.
const LAST_ACTIVE_KEY = "lastKnownActive";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) void pollAndApply();
});

async function pollAndApply(): Promise<void> {
  const settings = await loadSettings();
  if (!settings) return; // not connected yet - nothing to poll, nothing to block

  const result = await pollTimerState(settings);
  // Any failure (offline, unauthorized, http, network) is treated as "unknown" and left alone
  // rather than either blocking or unblocking - a transient network hiccup must never suddenly
  // block every site, and an expired key must never silently stop blocking mid-session either.
  // The next successful poll (or a manual reconnect for "unauthorized") resolves it either way.
  if (!result.ok) return;

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
    await sweepOpenTabs(ruleConfig);
  }
}

async function sweepOpenTabs(config: RuleConfig): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const blockedUrl = chrome.runtime.getURL(BLOCKED_PAGE_PATH);
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
      await chrome.tabs.update(tab.id, { url: blockedUrl }).catch(() => {
        // A tab can close between query() and update() - nothing to redirect anymore, ignore.
      });
    }
  }
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
