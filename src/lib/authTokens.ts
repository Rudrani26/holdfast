/**
 * HMAC-signed staff sessions and renter links (docs/ARCHITECTURE.md §6). Pure functions over
 * node:crypto, used by route handlers and by src/proxy.ts (Node runtime). Secrets are passed in.
 *
 *   staff cookie  hf_staff = `<expiryMs>.<HMAC(SESSION_SECRET, "staff|<expiryMs>")>`
 *   renter token  `<base64url("<rentalId>.<expiryMs>.<nonce>")>.<HMAC(RENTER_LINK_SECRET, payload)>`
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STAFF_COOKIE = "hf_staff";
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const RENTER_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const RENTAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`auth secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
}

const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

/** Constant-time string comparison, independent of length (both sides hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function signStaffSession(secret: string, now = Date.now()): { value: string; expiresAt: number } {
  assertSecret(secret);
  const expiresAt = now + STAFF_SESSION_TTL_MS;
  return { value: `${expiresAt}.${hmac(secret, `staff|${expiresAt}`)}`, expiresAt };
}

export function verifyStaffSession(secret: string, value: string | undefined, now = Date.now()): boolean {
  assertSecret(secret);
  if (!value) return false;
  const m = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return false;
  const expiresAt = Number(m[1]);
  // Reject expired sessions and expiries further out than a freshly signed session could be.
  if (expiresAt <= now || expiresAt > now + STAFF_SESSION_TTL_MS) return false;
  return safeEqual(m[2]!, hmac(secret, `staff|${expiresAt}`));
}

export interface RenterToken {
  token: string;
  rentalId: string;
  expiresAt: number;
  /** Random per-link id, recorded with the renter's baseline acknowledgement. */
  tokenId: string;
}

export function signRenterToken(
  secret: string,
  rentalId: string,
  now = Date.now(),
  nonce = randomBytes(12).toString("base64url"),
): RenterToken {
  assertSecret(secret);
  if (!RENTAL_ID.test(rentalId)) throw new Error("rental id must be 1–64 chars of [A-Za-z0-9_-]");
  const expiresAt = now + RENTER_LINK_TTL_MS;
  const payload = Buffer.from(`${rentalId}.${expiresAt}.${nonce}`).toString("base64url");
  return { token: `${payload}.${hmac(secret, payload)}`, rentalId, expiresAt, tokenId: nonce };
}

export type RenterTokenCheck =
  | { ok: true; rentalId: string; expiresAt: number; tokenId: string }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "WRONG_RENTAL" };

/**
 * Verifies a renter token. Pass `forRentalId` when the route is scoped to a rental: a valid token
 * for a different rental is rejected (a token grants access to its own rental only).
 */
export function verifyRenterToken(
  secret: string,
  token: string | undefined,
  { now = Date.now(), forRentalId }: { now?: number; forRentalId?: string } = {},
): RenterTokenCheck {
  assertSecret(secret);
  const m = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return { ok: false, reason: "MALFORMED" };
  const payload = m[1]!;
  const sig = m[2]!;
  // Signature first, so nothing about an unsigned payload is trusted or leaked.
  if (!safeEqual(sig, hmac(secret, payload))) return { ok: false, reason: "BAD_SIGNATURE" };

  const parts = Buffer.from(payload, "base64url").toString("utf8").split(".");
  if (parts.length !== 3) return { ok: false, reason: "MALFORMED" };
  const [rentalId, expiry, tokenId] = parts as [string, string, string];
  const expiresAt = Number(expiry);
  if (!RENTAL_ID.test(rentalId) || !/^\d{13}$/.test(expiry) || !tokenId) return { ok: false, reason: "MALFORMED" };
  if (expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (forRentalId !== undefined && forRentalId !== rentalId) return { ok: false, reason: "WRONG_RENTAL" };
  return { ok: true, rentalId, expiresAt, tokenId };
}
