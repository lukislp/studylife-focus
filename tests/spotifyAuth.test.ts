import { describe, expect, it } from "vitest";
import { computeCodeChallenge, generateCodeVerifier, parseSpotifyRedirect } from "../src/spotifyAuth";

describe("computeCodeChallenge", () => {
  // RFC 7636 Appendix B's own worked example - the canonical test vector for the S256 transform.
  it("matches RFC 7636 Appendix B's worked example", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    await expect(computeCodeChallenge(verifier)).resolves.toBe(expected);
  });

  it("produces a URL-safe string with no padding", async () => {
    const challenge = await computeCodeChallenge(generateCodeVerifier());
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    const a = await computeCodeChallenge(verifier);
    const b = await computeCodeChallenge(verifier);
    expect(a).toBe(b);
  });
});

describe("generateCodeVerifier", () => {
  it("produces a verifier within RFC 7636's required length range (43-128)", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("only uses RFC 7636's unreserved character set", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("produces different values on successive calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });
});

describe("parseSpotifyRedirect", () => {
  const state = "abc123";

  it("returns the code for a valid redirect with matching state", () => {
    const result = parseSpotifyRedirect(`https://ext.chromiumapp.org/callback?code=xyz&state=${state}`, state);
    expect(result).toEqual({ ok: true, code: "xyz" });
  });

  it("flags invalid-redirect when Spotify reports an error", () => {
    const result = parseSpotifyRedirect(
      `https://ext.chromiumapp.org/callback?error=access_denied&state=${state}`,
      state,
    );
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags invalid-redirect when code is missing", () => {
    const result = parseSpotifyRedirect(`https://ext.chromiumapp.org/callback?state=${state}`, state);
    expect(result).toEqual({ ok: false, kind: "invalid-redirect" });
  });

  it("flags state-mismatch when the state does not round-trip", () => {
    const result = parseSpotifyRedirect(
      `https://ext.chromiumapp.org/callback?code=xyz&state=wrong`,
      state,
    );
    expect(result).toEqual({ ok: false, kind: "state-mismatch" });
  });

  it("flags invalid-redirect for an unparseable URL", () => {
    expect(parseSpotifyRedirect("not a url", state)).toEqual({ ok: false, kind: "invalid-redirect" });
  });
});
