import { describe, expect, it } from "vitest";
import { computeTimerHintMatch, isTimerHintMessage } from "../src/timerHintRegistration";

describe("computeTimerHintMatch", () => {
  it("returns the origin's wildcard match pattern for a connected server URL", () => {
    expect(computeTimerHintMatch("https://study.example.com")).toBe("https://study.example.com/*");
  });

  it("ignores any path/query already present, matching only the origin", () => {
    expect(computeTimerHintMatch("https://study.example.com/some/path?x=1")).toBe("https://study.example.com/*");
  });

  it("returns null when not connected", () => {
    expect(computeTimerHintMatch(null)).toBeNull();
  });

  it("returns null for a malformed stored URL instead of throwing", () => {
    expect(computeTimerHintMatch("not a url")).toBeNull();
  });
});

describe("isTimerHintMessage", () => {
  it("recognizes a well-formed timer hint message", () => {
    expect(isTimerHintMessage({ type: "studylife-timer-hint" })).toBe(true);
  });

  it("rejects unrelated message shapes", () => {
    expect(isTimerHintMessage({ type: "connect", serverUrl: "https://x" })).toBe(false);
    expect(isTimerHintMessage(null)).toBe(false);
    expect(isTimerHintMessage(undefined)).toBe(false);
    expect(isTimerHintMessage("studylife-timer-hint")).toBe(false);
    expect(isTimerHintMessage({})).toBe(false);
  });
});
