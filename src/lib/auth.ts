// Per-user PIN auth. Isomorphic (Web Crypto only) so it runs in both the edge
// middleware and Node route handlers. The session cookie is a signed token
// (payload.signature, HMAC-SHA256), so it cannot be forged without AUTH_TOKEN.
//
// .env:
//   APP_PINS=1234           one or more bootstrap owner/admin PINs (comma list)
//   AUTH_TOKEN=<long random> session + PIN-hash secret

export const COOKIE_NAME = "hd_session";

export type Role = "admin" | "user";
export interface Session {
  uid: string;
  name: string;
  role: Role;
}

function secret(): string {
  return process.env.AUTH_TOKEN || "hd-dev-session-change-me";
}

/** Bootstrap owner PINs from APP_PINS (always log in as the admin owner). */
export function getPins(): string[] {
  return (process.env.APP_PINS || "1234")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

const te = new TextEncoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(b: string): Uint8Array {
  const padLen = (4 - (b.length % 4)) % 4;
  const norm = b.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

/** Deterministic PIN hash for storage + lookup (never store plaintext PINs). */
export async function hashPin(pin: string): Promise<string> {
  return hmac("pin:" + pin.trim());
}

/** Hash a password with PBKDF2-SHA256. Returns "salt:hash" (both base64url).
 * Isomorphic (Web Crypto), so it runs in Node routes and the edge if ever needed. */
export async function hashPassword(password: string, saltB64?: string): Promise<string> {
  const salt = saltB64 ? b64urlToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  // Cast to BufferSource: TS 5.7 typed arrays are generic over the buffer kind,
  // and the salt ternary widens to ArrayBufferLike, which Web Crypto rejects.
  const keyMaterial = await crypto.subtle.importKey("raw", te.encode(password) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToB64url(salt) + ":" + bytesToB64url(new Uint8Array(bits));
}

/** Check a password against a stored "salt:hash" record. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const sep = stored.indexOf(":");
  if (sep < 0) return false;
  const saltB64 = stored.slice(0, sep);
  const recomputed = await hashPassword(password, saltB64);
  return recomputed === stored;
}

export async function signSession(s: Session): Promise<string> {
  const body = bytesToB64url(te.encode(JSON.stringify(s)));
  return body + "." + (await hmac(body));
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if ((await hmac(body)) !== sig) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as Session;
    if (s && s.uid && s.role) return s;
  } catch {
    /* fallthrough */
  }
  return null;
}
