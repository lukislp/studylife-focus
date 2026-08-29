// Spotify's own OAuth 2.1 PKCE flow (accounts.spotify.com) - completely independent of
// StudyLife's own consent flow (connect.ts): this extension holds two separate identities, one
// per service, and StudyLife's backend is never involved in obtaining or refreshing the Spotify
// token. PKCE (not the older implicit grant) because Spotify requires it for a public client
// (a browser extension can't keep a client secret) - see
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow.

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = "user-modify-playback-state user-read-playback-state";
const CODE_VERIFIER_LENGTH = 64; // within RFC 7636's required 43-128 range

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** A fresh random PKCE code_verifier (RFC 7636 §4.1) - one per authorization attempt, never
 * reused. Uses the Web Crypto RNG available in both the service worker and (via jsdom) tests. */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_VERIFIER_LENGTH));
  let result = "";
  for (const byte of bytes) {
    result += VERIFIER_CHARS[byte % VERIFIER_CHARS.length];
  }
  return result;
}

/** RFC 7636 §4.2 S256 transform: BASE64URL-ENCODE(SHA256(ASCII(code_verifier))), no padding.
 * Pure given a verifier (only the verifier's own generation above is random), so this is the
 * part actually worth unit-testing against the RFC's own example vector. */
export async function computeCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds - refreshAccessToken is called proactively once this has passed. */
  expiresAt: number;
}

export type SpotifyAuthResult =
  | { ok: true; tokens: SpotifyTokens }
  | { ok: false; kind: "invalid-client-id" }
  | { ok: false; kind: "cancelled" }
  | { ok: false; kind: "auth-window-failed"; message: string }
  | { ok: false; kind: "invalid-redirect" }
  | { ok: false; kind: "state-mismatch" }
  | { ok: false; kind: "token-exchange-failed"; message: string };

/** Parses the code_verifier/S256 challenge pair, the redirect_uri chrome.identity hands the
 * extension, and the response Spotify's own /authorize redirects back to - factored out from
 * runSpotifyAuthFlow so the parsing itself is unit-testable without chrome.identity. */
export function parseSpotifyRedirect(
  responseUrl: string,
  expectedState: string,
): { ok: true; code: string } | { ok: false; kind: "invalid-redirect" | "state-mismatch" } {
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    return { ok: false, kind: "invalid-redirect" };
  }
  const error = parsed.searchParams.get("error");
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (error || !code || !state) {
    return { ok: false, kind: "invalid-redirect" };
  }
  if (state !== expectedState) {
    return { ok: false, kind: "state-mismatch" };
  }
  return { ok: true, code };
}

/** Runs the full interactive PKCE flow: opens Spotify's own consent screen via
 * chrome.identity.launchWebAuthFlow, then exchanges the returned code for tokens directly
 * against Spotify's token endpoint (no client secret - PKCE's whole point). */
export async function runSpotifyAuthFlow(clientId: string): Promise<SpotifyAuthResult> {
  if (!clientId.trim()) return { ok: false, kind: "invalid-client-id" };

  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallenge(verifier);
  const state = crypto.randomUUID();
  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("state", state);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/did not approve|cancel/i.test(message)) {
      return { ok: false, kind: "cancelled" };
    }
    return { ok: false, kind: "auth-window-failed", message };
  }
  if (!responseUrl) return { ok: false, kind: "cancelled" };

  const redirectResult = parseSpotifyRedirect(responseUrl, state);
  if (!redirectResult.ok) return redirectResult;

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: redirectResult.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    if (!response.ok) {
      return { ok: false, kind: "token-exchange-failed", message: await response.text() };
    }
    const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return {
      ok: true,
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + body.expires_in * 1000,
      },
    };
  } catch (error) {
    return { ok: false, kind: "token-exchange-failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Silent refresh (no user interaction) - called by background.ts whenever the stored
 * accessToken is at or past its expiry, right before a playback call. Spotify's refresh_token
 * grant is likewise client-secret-free for a PKCE-registered public client. */
export async function refreshSpotifyTokens(clientId: string, refreshToken: string): Promise<SpotifyTokens | null> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: body.access_token,
      // Spotify doesn't always rotate the refresh token - keep the old one if a new one isn't sent.
      refreshToken: body.refresh_token ?? refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  } catch {
    return null;
  }
}
