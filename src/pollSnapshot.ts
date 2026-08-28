// Snapshot of the most recent successful /api/timerstate poll (background.ts writes it, blocked.ts
// reads it) - its own tiny module rather than living in background.ts so blocked.ts's bundle
// doesn't have to pull in the whole service-worker module graph (alarms/tabs/declarativeNetRequest
// usage) just to read one stored value.
export interface PollSnapshot {
  isRunning: boolean;
  phaseEndsAt: string | null;
  serverNow: string;
  polledAt: number;
}

const LAST_POLL_KEY = "lastPollSnapshot";

export async function saveLastPollSnapshot(snapshot: PollSnapshot): Promise<void> {
  await chrome.storage.local.set({ [LAST_POLL_KEY]: snapshot });
}

export async function loadLastPollSnapshot(): Promise<PollSnapshot | null> {
  const result = await chrome.storage.local.get(LAST_POLL_KEY);
  return (result[LAST_POLL_KEY] as PollSnapshot | undefined) ?? null;
}
