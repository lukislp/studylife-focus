import { loadFeatureToggles } from "./featureToggles";
import { loadLastPollSnapshot } from "./pollSnapshot";
import { loadStoredSettings } from "./settings";
import { loadSpotifyConfig, loadSpotifyTokens } from "./spotifyConfig";

const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const guardStatus = document.getElementById("guard-status") as HTMLParagraphElement;
const tuneStatus = document.getElementById("tune-status") as HTMLParagraphElement;
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement;

openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function render(): Promise<void> {
  const [settings, toggles] = await Promise.all([loadStoredSettings(), loadFeatureToggles()]);

  connectionStatus.textContent = settings?.serverUrl
    ? `StudyLife server: ${settings.serverUrl}`
    : "Not set up yet - click Manage to get started.";

  await renderGuardStatus(settings?.guardApiKey ?? "", toggles.guardEnabled);
  await renderTuneStatus(settings?.tuneApiKey ?? "", toggles.tuneEnabled);
}

async function renderGuardStatus(guardApiKey: string, guardEnabled: boolean): Promise<void> {
  if (!guardApiKey) {
    guardStatus.textContent = "Guard: not connected";
    return;
  }
  if (!guardEnabled) {
    guardStatus.textContent = "Guard: connected, but switched off";
    return;
  }
  const snapshot = await loadLastPollSnapshot();
  if (!snapshot) {
    guardStatus.textContent = "Guard: waiting for the first check-in…";
    return;
  }
  guardStatus.textContent = snapshot.isRunning ? "Guard: focus session active - blocking is on" : "Guard: no focus session running";
  guardStatus.classList.toggle("active", snapshot.isRunning);
}

async function renderTuneStatus(tuneApiKey: string, tuneEnabled: boolean): Promise<void> {
  if (!tuneApiKey) {
    tuneStatus.textContent = "Tune: not connected";
    return;
  }
  if (!tuneEnabled) {
    tuneStatus.textContent = "Tune: connected, but switched off";
    return;
  }
  const [config, tokens] = await Promise.all([loadSpotifyConfig(), loadSpotifyTokens()]);
  if (!config.clientId || !tokens) {
    tuneStatus.textContent = "Tune: Spotify not connected";
  } else if (!config.focusPlaylistUri) {
    tuneStatus.textContent = "Tune: Spotify connected, but no focus playlist set";
  } else {
    tuneStatus.textContent = "Tune: Spotify connected";
  }
}

void render();
