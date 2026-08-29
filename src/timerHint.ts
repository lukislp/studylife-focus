// Dynamically registered (see background.ts's syncTimerHintContentScript) against exactly the
// one StudyLife origin the user connected to - never declared as a static content script, since
// that origin is only known at connect time (self-hosted, no fixed domain this extension could
// ship with). Purely a "check now" nudge: the actual isRunning truth still always comes from the
// extension's own authenticated poll, this just tells it not to wait for the next scheduled one.
const EVENT_NAME = "studylife:timerstate-changed";

window.addEventListener(EVENT_NAME, () => {
  chrome.runtime.sendMessage({ type: "studylife-timer-hint" }).catch(() => {
    // Extension context can be invalidated (reloaded/updated) between page load and this firing -
    // nothing this content script can do about that, the next scheduled poll still covers it.
  });
});
