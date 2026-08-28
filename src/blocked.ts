import { loadLastPollSnapshot } from "./pollSnapshot";
import { loadSettings } from "./settings";

const countdownEl = document.getElementById("countdown") as HTMLParagraphElement;
const hintEl = document.getElementById("until-hint") as HTMLParagraphElement;
const openLink = document.getElementById("open-studylife") as HTMLAnchorElement;

// Deliberately does NOT know which site the browser was actually navigating to when the
// declarativeNetRequest rule fired - the redirect is a static extensionPath (see rules.ts), not a
// per-request substitution, so there is nothing to display beyond "you're in a focus session"
// (see the README's "known limitations" for what a per-site "you tried to visit X" would need).
async function render(): Promise<void> {
  const [snapshot, settings] = await Promise.all([loadLastPollSnapshot(), loadSettings()]);

  if (settings) {
    openLink.href = settings.serverUrl;
    openLink.hidden = false;
  }

  if (!snapshot?.phaseEndsAt) {
    countdownEl.textContent = "Focus session in progress";
    hintEl.textContent = "";
    return;
  }

  // Corrects for local/server clock skew using the poll's own reference point rather than
  // trusting the device clock outright - polledAt (local) and serverNow (server) were captured
  // in the same request/response round trip, so their difference is the skew at that moment.
  const skewMs = snapshot.polledAt - Date.parse(snapshot.serverNow);
  const endsAt = Date.parse(snapshot.phaseEndsAt);

  const tick = () => {
    const remainingMs = endsAt - (Date.now() - skewMs);
    if (remainingMs <= 0) {
      countdownEl.textContent = "Almost done";
      hintEl.textContent = "This page will keep showing until FocusGuard's next check confirms the session ended.";
      return;
    }
    countdownEl.textContent = formatDuration(remainingMs);
    hintEl.textContent = `Ends around ${new Date(endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };
  tick();
  setInterval(tick, 1000);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

void render();
