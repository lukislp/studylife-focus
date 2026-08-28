import { BlockConfig, loadBlockConfig, saveBlockConfig } from "./blockConfig";
import {
  CONNECT_MESSAGE_TYPE,
  clearPendingConnect,
  describeConnectResult,
  requestHostPermission,
  setPendingConnect,
  type ConnectResult,
} from "./connect";
import { normalizeDomain } from "./rules";
import { loadStoredSettings, normalizeServerUrl, saveSettings } from "./settings";

const serverUrlInput = document.getElementById("server-url") as HTMLInputElement;
const connectionHint = document.getElementById("connection-hint") as HTMLParagraphElement;
const connectButton = document.getElementById("connect-button") as HTMLButtonElement;
const connectStatus = document.getElementById("connect-status") as HTMLParagraphElement;

const modeWhitelist = document.getElementById("mode-whitelist") as HTMLInputElement;
const modeBlacklist = document.getElementById("mode-blacklist") as HTMLInputElement;
const listHeading = document.getElementById("list-heading") as HTMLHeadingElement;
const listDesc = document.getElementById("list-desc") as HTMLParagraphElement;
const domainInput = document.getElementById("domain-input") as HTMLInputElement;
const addDomainButton = document.getElementById("add-domain") as HTMLButtonElement;
const domainListEl = document.getElementById("domain-list") as HTMLUListElement;

let config: BlockConfig = { mode: "whitelist", whitelist: [], blacklist: [] };

async function initConnection(): Promise<void> {
  const existing = await loadStoredSettings();
  if (existing) {
    serverUrlInput.value = existing.serverUrl;
    if (existing.apiKey) {
      connectionHint.textContent = `Connected to ${existing.serverUrl}`;
      connectionHint.classList.add("success");
      connectButton.textContent = "Reconnect";
      setConnectStatus("Already connected - reconnecting replaces the current key (use after a disconnect).", "success");
    }
  }
}

// Primary path: browser-consent connect via chrome.identity, run by the service worker (see
// background.ts/connect.ts). Living on a full options TAB (not the action popup) means this
// button's own page survives the permission prompt/auth window stealing focus - unlike an action
// popup, a normal tab does not auto-close on focus loss, so the pending-connect handoff in
// connect.ts is a defensive fallback here rather than the expected path.
connectButton.addEventListener("click", async () => {
  const serverUrl = normalizeServerUrl(serverUrlInput.value);
  if (!serverUrl) {
    setConnectStatus("Enter your StudyLife server URL first.", "error");
    return;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(serverUrl);
  } catch {
    setConnectStatus("Enter a valid server URL, e.g. https://studylife.example.com", "error");
    return;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    setConnectStatus("Enter a valid server URL, e.g. https://studylife.example.com", "error");
    return;
  }

  connectButton.disabled = true;

  const existingSettings = await loadStoredSettings();
  await saveSettings({ serverUrl, apiKey: existingSettings?.apiKey ?? "" });

  // Base URL only, "/*" covers every path under it - the permission this requests is scoped to
  // the whole origin, never a specific page/route, so the poll and the consent flow's own
  // /connect/focusguard and /api/... calls all work without asking again.
  const originPattern = parsedUrl.origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [originPattern] }))) {
    await setPendingConnect(serverUrl);
    setConnectStatus("Grant the permission prompt - StudyLife's login window then opens automatically.", "success");
    const granted = await requestHostPermission(originPattern);
    if (!granted) {
      await clearPendingConnect();
      connectButton.disabled = false;
      setConnectStatus("Permission to access this server was denied - connecting needs it (click again to retry).", "error");
    }
    return;
  }

  setConnectStatus("Opening StudyLife's login page…", "success");

  chrome.runtime
    .sendMessage({ type: CONNECT_MESSAGE_TYPE, serverUrl })
    .then((result: ConnectResult) => {
      connectButton.disabled = false;
      setConnectStatus(describeConnectResult(result), result.ok ? "success" : "error");
      if (result.ok) void initConnection();
    })
    .catch(() => {
      connectButton.disabled = false;
    });
});

function setConnectStatus(message: string, kind: "success" | "error"): void {
  connectStatus.textContent = message;
  connectStatus.className = `status ${kind}`;
}

// ── Blocking mode + allow/block list ────────────────────────────────────────────────────

function renderListSection(): void {
  const isWhitelist = config.mode === "whitelist";
  listHeading.textContent = isWhitelist ? "Allowed sites" : "Blocked sites";
  listDesc.innerHTML = isWhitelist
    ? "Just the domain, e.g. <code>wikipedia.org</code> - subdomains are covered automatically, no need to list each one. StudyLife itself is always reachable, no matter what's on this list."
    : "Just the domain, e.g. <code>reddit.com</code> - subdomains are covered automatically, no need to list each one.";

  const list = isWhitelist ? config.whitelist : config.blacklist;
  domainListEl.innerHTML = "";
  for (const domain of list) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => void removeDomain(domain));
    li.append(span, removeButton);
    domainListEl.append(li);
  }
}

async function addDomain(): Promise<void> {
  const domain = normalizeDomain(domainInput.value);
  if (!domain) return;
  const list = config.mode === "whitelist" ? config.whitelist : config.blacklist;
  if (!list.includes(domain)) list.push(domain);
  domainInput.value = "";
  await saveBlockConfig(config);
  renderListSection();
}

async function removeDomain(domain: string): Promise<void> {
  const list = config.mode === "whitelist" ? config.whitelist : config.blacklist;
  const index = list.indexOf(domain);
  if (index !== -1) list.splice(index, 1);
  await saveBlockConfig(config);
  renderListSection();
}

addDomainButton.addEventListener("click", () => void addDomain());
domainInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") void addDomain();
});

async function setMode(mode: BlockConfig["mode"]): Promise<void> {
  config.mode = mode;
  await saveBlockConfig(config);
  renderListSection();
}

modeWhitelist.addEventListener("change", () => {
  if (modeWhitelist.checked) void setMode("whitelist");
});
modeBlacklist.addEventListener("change", () => {
  if (modeBlacklist.checked) void setMode("blacklist");
});

async function init(): Promise<void> {
  config = await loadBlockConfig();
  modeWhitelist.checked = config.mode === "whitelist";
  modeBlacklist.checked = config.mode === "blacklist";
  renderListSection();
  await initConnection();
}

void init();
