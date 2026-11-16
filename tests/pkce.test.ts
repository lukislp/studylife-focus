import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeFocusGuardAssertion, exchangeFocusTunesAssertion } from "../src/api";
import { buildConsentUrl } from "../src/connect";
import { challengeForVerifier, newPkcePair } from "../src/pkce";

afterEach(() => vi.unstubAllGlobals());

describe("PKCE pair", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    expect(await challengeForVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("generates a unique unpadded base64url verifier of 43-128 chars with a matching S256 challenge", async () => {
    const a = await newPkcePair();
    const b = await newPkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier, "ascii").digest("base64url"));
  });
});

describe("buildConsentUrl", () => {
  it.each(["focusguard", "focustunes"] as const)("adds state and the S256 challenge for %s", (audience) => {
    const url = new URL(buildConsentUrl(audience, "https://srv.example", "https://x.chromiumapp.org/", "st", "chal"));
    expect(url.pathname).toBe(`/connect/${audience}`);
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.chromiumapp.org/");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.search).not.toContain("verifier");
  });
});

describe("assertion exchange body", () => {
  function stubFetch(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends codeVerifier next to the assertion on the Guard exchange", async () => {
    const fetchMock = stubFetch({ userId: 1, focusGuardApiKey: "k" });
    const result = await exchangeFocusGuardAssertion("https://srv.example", "asr", "ver");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://srv.example/api/auth/focusguard-assertion-exchange");
    expect(JSON.parse(init.body)).toEqual({ assertion: "asr", codeVerifier: "ver" });
  });

  it("sends codeVerifier next to the assertion on the Tune exchange", async () => {
    const fetchMock = stubFetch({ userId: 1, focusTunesApiKey: "k" });
    await exchangeFocusTunesAssertion("https://srv.example", "asr", "ver");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://srv.example/api/auth/focustunes-assertion-exchange");
    expect(JSON.parse(init.body)).toEqual({ assertion: "asr", codeVerifier: "ver" });
  });
});

describe("manifest stable extension ID", () => {
  it("embeds a key that maps to the documented extension ID", () => {
    const manifest = JSON.parse(readFileSync("manifest.json", "utf-8")) as { key?: string };
    expect(manifest.key).toBeTruthy();
    const hex = createHash("sha256").update(Buffer.from(manifest.key!, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
    expect(id).toBe("hhgnenpnafffiadgabcclncnbfdopnlp");
    expect(readFileSync("README.md", "utf-8")).toContain(id);
  });
});
