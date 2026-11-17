// PKCE (RFC 7636, S256 only) helpers for the Guard and Tune consent connect flows. The verifier is
// generated per connect attempt, lives only in the service worker's memory next to the OAuth
// `state` (the whole flow runs in one background chain, see background.ts), is sent exactly once
// in the assertion-exchange body, and is never persisted or placed in a URL.

export interface PkcePair {
  verifier: string;
  challenge: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function challengeForVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

// 32 random bytes -> 43 base64url characters, inside RFC 7636's 43-128 unreserved-character range.
export async function newPkcePair(): Promise<PkcePair> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = toBase64Url(bytes);
  return { verifier, challenge: await challengeForVerifier(verifier) };
}
