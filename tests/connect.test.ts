import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingConnect,
  connectMessageType,
  describeConnectResult,
  isConnectMessage,
  parseAuthRedirect,
  setPendingConnect,
  takePendingConnects,
  type ConnectResult,
} from "../src/connect";
import { createChromeStorageStub } from "./chrome-storage-stub";

const storage = createChromeStorageStub();

beforeEach(() => {
  storage.reset();
  storage.install();
});

describe("connectMessageType / isConnectMessage", () => {
  it("produces a distinct type per audience", () => {
    expect(connectMessageType("focusguard")).not.toBe(connectMessageType("focustunes"));
  });

  it("recognizes a well-formed message for either audience", () => {
    expect(isConnectMessage({ type: connectMessageType("focusguard"), audience: "focusguard", serverUrl: "https://x" })).toBe(true);
    expect(isConnectMessage({ type: connectMessageType("focustunes"), audience: "focustunes", serverUrl: "https://x" })).toBe(true);
  });

  it("rejects a message whose type doesn't match its own declared audience", () => {
    expect(isConnectMessage({ type: connectMessageType("focusguard"), audience: "focustunes", serverUrl: "https://x" })).toBe(false);
  });

  it("rejects unrelated or malformed shapes", () => {
    expect(isConnectMessage(null)).toBe(false);
    expect(isConnectMessage(undefined)).toBe(false);
    expect(isConnectMessage({})).toBe(false);
    expect(isConnectMessage({ type: connectMessageType("focusguard"), audience: "not-real", serverUrl: "https://x" })).toBe(false);
    expect(isConnectMessage({ type: connectMessageType("focusguard"), audience: "focusguard" })).toBe(false);
  });
});

describe("parseAuthRedirect", () => {
  const state = "abc123";

  it("returns the assertion for a valid redirect with matching state", () => {
    const result = parseAuthRedirect(
      `https://ext.chromiumapp.org/callback?assertion=tok&state=${state}`,
      state,
    );
    expect(result).toEqual({ ok: true, assertion: "tok" });
  });

  it("flags invalid-redirect when assertion is missing", () => {
    const result = parseAuthRedirect(`https://ext.chromiumapp.org/callback?state=${state}`, state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags invalid-redirect when state is missing", () => {
    const result = parseAuthRedirect("https://ext.chromiumapp.org/callback?assertion=tok", state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags state-mismatch when the state does not round-trip", () => {
    const result = parseAuthRedirect(
      `https://ext.chromiumapp.org/callback?assertion=tok&state=wrong`,
      state,
    );
    expect(result).toEqual({ ok: false, kind: "state-mismatch" });
  });

  it("flags invalid-redirect for an unparseable URL", () => {
    const result = parseAuthRedirect("not a url", state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("tolerates extra query params", () => {
    const result = parseAuthRedirect(
      `https://ext.chromiumapp.org/callback?assertion=tok&state=${state}&extra=1&another=x`,
      state,
    );
    expect(result).toEqual({ ok: true, assertion: "tok" });
  });
});

describe("describeConnectResult", () => {
  const allResults: ConnectResult[] = [
    { ok: true, serverUrl: "https://example.com" },
    { ok: false, kind: "invalid-url" },
    { ok: false, kind: "permission-denied" },
    { ok: false, kind: "cancelled" },
    { ok: false, kind: "auth-window-failed", message: "boom" },
    { ok: false, kind: "invalid-redirect" },
    { ok: false, kind: "state-mismatch" },
    { ok: false, kind: "server-outdated" },
    { ok: false, kind: "offline" },
    { ok: false, kind: "exchange-failed", message: "boom" },
  ];

  it.each(allResults)("returns a non-empty string for every ConnectResult kind", (result) => {
    expect(describeConnectResult(result).length).toBeGreaterThan(0);
  });

  it("returns the exact connected message", () => {
    expect(describeConnectResult({ ok: true, serverUrl: "https://x" })).toBe("Connected to StudyLife.");
  });

  it("returns the exact cancelled message", () => {
    expect(describeConnectResult({ ok: false, kind: "cancelled" })).toBe("Connection cancelled.");
  });

  it("includes the underlying message for exchange-failed", () => {
    expect(
      describeConnectResult({ ok: false, kind: "exchange-failed", message: "network down" }),
    ).toBe("Couldn't complete the connection: network down");
  });
});

describe("pending connect markers", () => {
  const serverUrl = "https://studylife.example.com";
  const origin = "https://studylife.example.com/*";

  it("round-trips through set -> take with a matching granted origin", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await expect(takePendingConnects([origin])).resolves.toEqual([{ audience: "focusguard", serverUrl }]);
  });

  it("returns both audiences' pending markers if both were staked against the same origin", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await setPendingConnect("focustunes", serverUrl);
    const result = await takePendingConnects([origin]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.audience).sort()).toEqual(["focusguard", "focustunes"]);
  });

  it("keeps each audience's marker independent - taking one doesn't consume the other", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await takePendingConnects([origin]);
    await setPendingConnect("focustunes", serverUrl);
    await expect(takePendingConnects([origin])).resolves.toEqual([{ audience: "focustunes", serverUrl }]);
  });

  it("returns nothing and leaves the marker when granted origins don't match", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await expect(takePendingConnects(["https://other.example.com/*"])).resolves.toEqual([]);
    await expect(takePendingConnects([origin])).resolves.toEqual([{ audience: "focusguard", serverUrl }]);
  });

  it("cleans up an expired marker", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      await setPendingConnect("focusguard", serverUrl);
      vi.setSystemTime(start + 2 * 60 * 1000 + 1); // just past the 2-minute TTL
      await expect(takePendingConnects([origin])).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
    expect(storage.raw()["pendingConnect:focusguard"]).toBeUndefined();
  });

  it("cleans up a malformed marker", async () => {
    storage.raw()["pendingConnect:focusguard"] = { serverUrl: 123, ts: "not-a-number" };
    await expect(takePendingConnects([origin])).resolves.toEqual([]);
    expect(storage.raw()["pendingConnect:focusguard"]).toBeUndefined();
  });

  it("returns nothing on a second take after the marker was already consumed", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await takePendingConnects([origin]);
    await expect(takePendingConnects([origin])).resolves.toEqual([]);
  });

  it("clearPendingConnect removes only that audience's marker", async () => {
    await setPendingConnect("focusguard", serverUrl);
    await setPendingConnect("focustunes", serverUrl);
    await clearPendingConnect("focusguard");
    await expect(takePendingConnects([origin])).resolves.toEqual([{ audience: "focustunes", serverUrl }]);
  });
});
