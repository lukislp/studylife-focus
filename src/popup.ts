import { loadLastPollSnapshot } from "./pollSnapshot";
import { loadStoredSettings } from "./settings";

const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const sessionStatus = document.getElementById("session-status") as HTMLParagraphElement;
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement;

openOptionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

async function render(): Promise<void> {
  const settings = await loadStoredSettings();
  if (!settings?.apiKey) {
    connectionStatus.textContent = "Not connected - click “Manage sites” to set up.";
    sessionStatus.textContent = "";
    return;
  }
  connectionStatus.textContent = `Connected to ${settings.serverUrl}`;

  const snapshot = await loadLastPollSnapshot();
  if (!snapshot) {
    sessionStatus.textContent = "Waiting for the first check-in…";
    return;
  }
  if (snapshot.isRunning) {
    sessionStatus.textContent = "Focus session active - blocking is on.";
    sessionStatus.classList.add("active");
  } else {
    sessionStatus.textContent = "No focus session running right now.";
    sessionStatus.classList.remove("active");
  }
}

void render();
