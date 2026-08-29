import { BlockConfig, loadBlockConfig, saveBlockConfig } from "./blockConfig";
import {
  clearPendingConnect,
  connectMessageType,
  describeConnectResult,
  requestHostPermission,
  setPendingConnect,
  type ConnectAudience,
  type ConnectResult,
} from "./connect";
import { loadFeatureToggles, saveFeatureToggles } from "./featureToggles";
import { normalizeDomain } from "./rules";
import { loadStoredSettings, normalizeServerUrl, saveSettings } from "./settings";
import { runSpotifyAuthFlow, type SpotifyAuthResult } from "./spotifyAuth";
import { loadSpotifyConfig, saveSpotifyConfig, saveSpotifyTokens } from "./spotifyConfig";
import { TOGGLE_MESSAGE_TYPE, type ToggleFeature } from "./toggleMessage";

// ── Tabs ─────────────────────────────────────────────────────────────────────────────────────

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.dataset.tab;
    for (const b of tabButtons) b.classList.toggle("active", b === button);
    for (const panel of tabPanels) panel.hidden = panel.id !== `tab-${target}`;
  });
}

// ── General tab: shared StudyLife server URL ────────────────────────────────────────────────

const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const saveServerUrlButton = document.getElementById("save-server-url") as HTMLButtonElement;
const serverUrlStatus = document.getElementById("server-url-status") as HTMLParagraphElement;

async function initServerUrl(): Promise<void> {
  const existing = await loadStoredSettings();
  if (existing) serverUrlInput.value = existing.serverUrl;
}

saveServerUrlButton.addEventListener("click", async () => {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  if (!serverUrl || !isValidHttpUrl(serverUrl)) {
    setStatus(serverUrlStatus, "Enter a valid server URL, e.g. https://studylife.example.com", "error");
    return;
  }
  const existing = await loadStoredSettings();
  await saveSettings({
    serverUrl,
    guardApiKey: existing?.guardApiKey ?? "",
    tuneApiKey: existing?.tuneApiKey ?? "",
  });
  setStatus(serverUrlStatus, "Saved. Connect Guard and/or Tune from their own tabs.", "success");
});

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function setStatus(el: HTMLParagraphElement, message: string, kind: "success" | "error"): void {
  el.textContent = message;
  el.className = `status ${kind}`;
}

// ── Shared connect flow, parameterized per audience/feature ─────────────────────────────────
// Mirrors the pre-merge studylife-focusguard/studylife-focustunes options.ts exactly: the
// permission REQUEST must happen here, inside this click handler's own user gesture
// (chrome.permissions.request throws outside one) - only the final step (opening the actual auth
// window) is handed off to background.ts, which survives the permission prompt/auth window
// stealing this page's focus.

async function connectFeature(
  audience: ConnectAudience,
  connectButton: HTMLButtonElement,
  statusEl: HTMLParagraphElement,
  onConnected: () => void,
): Promise<void> {
  const settings = await loadStoredSettings();
  if (!settings?.serverUrl) {
    setStatus(statusEl, "Save your StudyLife server URL in the General tab first.", "error");
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(settings.serverUrl);
  } catch {
    setStatus(statusEl, "The saved server URL looks invalid - fix it in the General tab first.", "error");
    return;
  }

  connectButton.disabled = true;

  const originPattern = parsedUrl.origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [originPattern] }))) {
    await setPendingConnect(audience, settings.serverUrl);
    setStatus(statusEl, "Grant the permission prompt - StudyLife's login window then opens automatically.", "success");
    const granted = await requestHostPermission(originPattern);
    if (!granted) {
      await clearPendingConnect(audience);
      connectButton.disabled = false;
      setStatus(statusEl, "Permission to access this server was denied - connecting needs it (click again to retry).", "error");
    }
    return;
  }

  setStatus(statusEl, "Opening StudyLife's login page…", "success");

  chrome.runtime
    .sendMessage({ type: connectMessageType(audience), audience, serverUrl: settings.serverUrl })
    .then((result: ConnectResult) => {
      connectButton.disabled = false;
      setStatus(statusEl, describeConnectResult(result), result.ok ? "success" : "error");
      if (result.ok) onConnected();
    })
    .catch(() => {
      connectButton.disabled = false;
    });
}

// ── Feature enable/disable toggles ───────────────────────────────────────────────────────────

async function initToggle(checkbox: HTMLInputElement, feature: ToggleFeature, currentlyEnabled: boolean): Promise<void> {
  checkbox.checked = currentlyEnabled;
  checkbox.addEventListener("change", async () => {
    const toggles = await loadFeatureToggles();
    const next = { ...toggles, [feature === "guard" ? "guardEnabled" : "tuneEnabled"]: checkbox.checked };
    await saveFeatureToggles(next);
    await chrome.runtime.sendMessage({ type: TOGGLE_MESSAGE_TYPE, feature, enabled: checkbox.checked }).catch(() => {
      // Service worker unreachable is vanishingly unlikely for a plain sendMessage, but if it
      // happens the next poll/alarm still converges to the correct state regardless.
    });
  });
}

// ── Guard tab ─────────────────────────────────────────────────────────────────────────────────

const guardEnabledToggle = document.getElementById("guard-enabled-toggle") as HTMLInputElement;
const guardConnectButton = document.getElementById("guard-connect-button") as HTMLButtonElement;
const guardConnectStatus = document.getElementById("guard-connect-status") as HTMLParagraphElement;
const guardConnectionHint = document.getElementById("guard-connection-hint") as HTMLParagraphElement;

const modeToggle = document.getElementById("mode-toggle") as HTMLInputElement;
const modeToggleLabel = document.getElementById("mode-toggle-label") as HTMLSpanElement;
const modeToggleSub = document.getElementById("mode-toggle-sub") as HTMLSpanElement;
const listHeading = document.getElementById("list-heading") as HTMLHeadingElement;
const listDesc = document.getElementById("list-desc") as HTMLParagraphElement;
const domainInput = document.getElementById("domain-input") as HTMLInputElement;
const addDomainButton = document.getElementById("add-domain") as HTMLButtonElement;
const domainListEl = document.getElementById("domain-list") as HTMLUListElement;

let blockConfig: BlockConfig = { mode: "whitelist", whitelist: [], blacklist: [] };

async function initGuardConnection(): Promise<void> {
  const existing = await loadStoredSettings();
  if (existing?.guardApiKey) {
    guardConnectionHint.textContent = `Connected to ${existing.serverUrl}`;
    guardConnectionHint.classList.add("success");
    guardConnectButton.textContent = "Reconnect Guard";
    setStatus(guardConnectStatus, "Already connected - reconnecting replaces the current key (use after a disconnect).", "success");
  }
}

guardConnectButton.addEventListener("click", () =>
  connectFeature("focusguard", guardConnectButton, guardConnectStatus, () => void initGuardConnection()));

function renderListSection(): void {
  const isWhitelist = blockConfig.mode === "whitelist";

  modeToggle.checked = isWhitelist;
  modeToggleLabel.firstChild!.textContent = isWhitelist
    ? "Allowlist - block everything except the sites below"
    : "Blocklist - only block the sites below, everything else stays reachable";
  modeToggleSub.textContent = isWhitelist
    ? "Recommended for deep focus - decide up front what you need, nothing else sneaks in."
    : "Simpler to set up, but never fully complete - new distractions need to be added reactively.";

  listHeading.textContent = isWhitelist ? "Allowed sites" : "Blocked sites";
  listDesc.innerHTML = isWhitelist
    ? "Just the domain, e.g. <code>wikipedia.org</code> - subdomains are covered automatically, no need to list each one. StudyLife itself is always reachable, no matter what's on this list."
    : "Just the domain, e.g. <code>reddit.com</code> - subdomains are covered automatically, no need to list each one.";

  const list = isWhitelist ? blockConfig.whitelist : blockConfig.blacklist;
  domainListEl.innerHTML = "";
  for (const domain of list) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn-danger";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => void removeDomain(domain));
    li.append(span, removeButton);
    domainListEl.append(li);
  }
}

async function addDomain(): Promise<void> {
  const domain = normalizeDomain(domainInput.value);
  if (!domain) return;
  const list = blockConfig.mode === "whitelist" ? blockConfig.whitelist : blockConfig.blacklist;
  if (!list.includes(domain)) list.push(domain);
  domainInput.value = "";
  await saveBlockConfig(blockConfig);
  renderListSection();
}

async function removeDomain(domain: string): Promise<void> {
  const list = blockConfig.mode === "whitelist" ? blockConfig.whitelist : blockConfig.blacklist;
  const index = list.indexOf(domain);
  if (index !== -1) list.splice(index, 1);
  await saveBlockConfig(blockConfig);
  renderListSection();
}

addDomainButton.addEventListener("click", () => void addDomain());
domainInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void addDomain();
});

async function setMode(mode: BlockConfig["mode"]): Promise<void> {
  blockConfig.mode = mode;
  await saveBlockConfig(blockConfig);
  renderListSection();
}

modeToggle.addEventListener("change", () => {
  void setMode(modeToggle.checked ? "whitelist" : "blacklist");
});

// ── Tune tab ──────────────────────────────────────────────────────────────────────────────────

const tuneEnabledToggle = document.getElementById("tune-enabled-toggle") as HTMLInputElement;
const tuneConnectButton = document.getElementById("tune-connect-button") as HTMLButtonElement;
const tuneConnectStatus = document.getElementById("tune-connect-status") as HTMLParagraphElement;
const tuneConnectionHint = document.getElementById("tune-connection-hint") as HTMLParagraphElement;

const redirectUriDisplay = document.getElementById("redirect-uri-display") as HTMLInputElement;
const spotifyClientIdInput = document.getElementById("spotify-client-id") as HTMLInputElement;
const focusPlaylistInput = document.getElementById("focus-playlist") as HTMLInputElement;
const breakPlaylistInput = document.getElementById("break-playlist") as HTMLInputElement;
const saveSpotifyConfigButton = document.getElementById("save-spotify-config") as HTMLButtonElement;
const spotifyConnectButton = document.getElementById("spotify-connect-button") as HTMLButtonElement;
const spotifyStatus = document.getElementById("spotify-status") as HTMLParagraphElement;

async function initTuneConnection(): Promise<void> {
  const existing = await loadStoredSettings();
  if (existing?.tuneApiKey) {
    tuneConnectionHint.textContent = `Connected to ${existing.serverUrl}`;
    tuneConnectionHint.classList.add("success");
    tuneConnectButton.textContent = "Reconnect Tune";
    setStatus(tuneConnectStatus, "Already connected - reconnecting replaces the current key (use after a disconnect).", "success");
  }
}

tuneConnectButton.addEventListener("click", () =>
  connectFeature("focustunes", tuneConnectButton, tuneConnectStatus, () => void initTuneConnection()));

// No permission-prompt/popup-death dance needed here (unlike the StudyLife flow above): the two
// Spotify hosts are optional_host_permissions requested once, on this same click, so this runs
// entirely within this page's own click handler.

saveSpotifyConfigButton.addEventListener("click", async () => {
  await saveSpotifyConfig({
    clientId: spotifyClientIdInput.value.trim(),
    focusPlaylistUri: focusPlaylistInput.value.trim(),
    breakPlaylistUri: breakPlaylistInput.value.trim(),
  });
  setStatus(spotifyStatus, "Saved.", "success");
});

spotifyConnectButton.addEventListener("click", async () => {
  const clientId = spotifyClientIdInput.value.trim();
  if (!clientId) {
    setStatus(spotifyStatus, "Enter and save your Spotify client ID first.", "error");
    return;
  }
  await saveSpotifyConfig({
    clientId,
    focusPlaylistUri: focusPlaylistInput.value.trim(),
    breakPlaylistUri: breakPlaylistInput.value.trim(),
  });

  spotifyConnectButton.disabled = true;

  // Spotify's two hosts are optional_host_permissions (see manifest.json) - only requested once
  // the user actually wants to use Tune, not upfront at install for everyone (including
  // Guard-only users).
  const spotifyOrigins = ["https://accounts.spotify.com/*", "https://api.spotify.com/*"];
  if (!(await chrome.permissions.contains({ origins: spotifyOrigins }))) {
    const granted = await chrome.permissions.request({ origins: spotifyOrigins });
    if (!granted) {
      spotifyConnectButton.disabled = false;
      setStatus(spotifyStatus, "Permission to reach Spotify was denied - connecting needs it (click again to retry).", "error");
      return;
    }
  }

  setStatus(spotifyStatus, "Opening Spotify's login page…", "success");
  const result = await runSpotifyAuthFlow(clientId);
  spotifyConnectButton.disabled = false;

  if (!result.ok) {
    setStatus(spotifyStatus, describeSpotifyAuthResult(result), "error");
    return;
  }
  await saveSpotifyTokens(result.tokens);
  setStatus(spotifyStatus, "Connected to Spotify.", "success");
});

function describeSpotifyAuthResult(result: Exclude<SpotifyAuthResult, { ok: true }>): string {
  switch (result.kind) {
    case "invalid-client-id":
      return "Enter your Spotify client ID first.";
    case "cancelled":
      return "Connection cancelled.";
    case "auth-window-failed":
      return `Couldn't open Spotify's login page: ${result.message}`;
    case "invalid-redirect":
      return "Spotify's response was missing the expected data - try again.";
    case "state-mismatch":
      return "Couldn't verify the connection response - try again.";
    case "token-exchange-failed":
      return `Couldn't complete the connection: ${result.message}`;
  }
}

async function initSpotify(): Promise<void> {
  redirectUriDisplay.value = chrome.identity.getRedirectURL();
  const config = await loadSpotifyConfig();
  spotifyClientIdInput.value = config.clientId;
  focusPlaylistInput.value = config.focusPlaylistUri;
  breakPlaylistInput.value = config.breakPlaylistUri;
}

// ── Init ──────────────────────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const toggles = await loadFeatureToggles();
  await initToggle(guardEnabledToggle, "guard", toggles.guardEnabled);
  await initToggle(tuneEnabledToggle, "tune", toggles.tuneEnabled);

  blockConfig = await loadBlockConfig();
  renderListSection();

  await initSpotify();
  await initServerUrl();
  await initGuardConnection();
  await initTuneConnection();
}

void init();
