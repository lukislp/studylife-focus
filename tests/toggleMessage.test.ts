import { describe, expect, it } from "vitest";
import { isToggleMessage, TOGGLE_MESSAGE_TYPE } from "../src/toggleMessage";

describe("isToggleMessage", () => {
  it("recognizes a well-formed message for either feature", () => {
    expect(isToggleMessage({ type: TOGGLE_MESSAGE_TYPE, feature: "guard", enabled: true })).toBe(true);
    expect(isToggleMessage({ type: TOGGLE_MESSAGE_TYPE, feature: "tune", enabled: false })).toBe(true);
  });

  it("rejects unrelated or malformed shapes", () => {
    expect(isToggleMessage(null)).toBe(false);
    expect(isToggleMessage(undefined)).toBe(false);
    expect(isToggleMessage({})).toBe(false);
    expect(isToggleMessage({ type: TOGGLE_MESSAGE_TYPE, feature: "not-real", enabled: true })).toBe(false);
    expect(isToggleMessage({ type: TOGGLE_MESSAGE_TYPE, feature: "guard", enabled: "yes" })).toBe(false);
    expect(isToggleMessage({ type: "something-else", feature: "guard", enabled: true })).toBe(false);
  });
});
