import { describe, expect, it } from "vitest";
import {
  RENTER_LINK_TTL_MS,
  safeEqual,
  signRenterToken,
  signStaffSession,
  STAFF_SESSION_TTL_MS,
  verifyRenterToken,
  verifyStaffSession,
} from "./authTokens";

const SECRET = "s".repeat(32);
const OTHER = "o".repeat(32);
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);

describe("safeEqual", () => {
  it("compares regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("staff session", () => {
  it("verifies a fresh session until it expires after 12 h", () => {
    const { value, expiresAt } = signStaffSession(SECRET, NOW);
    expect(expiresAt).toBe(NOW + STAFF_SESSION_TTL_MS);
    expect(verifyStaffSession(SECRET, value, NOW)).toBe(true);
    expect(verifyStaffSession(SECRET, value, expiresAt - 1)).toBe(true);
    expect(verifyStaffSession(SECRET, value, expiresAt)).toBe(false);
  });

  it("rejects a session signed with another secret, a tampered signature, or a moved expiry", () => {
    const { value } = signStaffSession(SECRET, NOW);
    expect(verifyStaffSession(OTHER, value, NOW)).toBe(false);
    expect(verifyStaffSession(SECRET, flip(value, value.length - 3), NOW)).toBe(false);
    const [expiry, sig] = value.split(".") as [string, string];
    expect(verifyStaffSession(SECRET, `${Number(expiry) + 1000}.${sig}`, NOW)).toBe(false);
  });

  it("rejects expiries further out than a real session could have", () => {
    const { value } = signStaffSession(SECRET, NOW + 24 * 60 * 60 * 1000);
    expect(verifyStaffSession(SECRET, value, NOW)).toBe(false);
  });

  it.each([[undefined], [""], ["garbage"], ["1234.abc"], [`${NOW}.`]])("rejects %j", (v) => {
    expect(verifyStaffSession(SECRET, v, NOW)).toBe(false);
  });

  it("refuses short secrets", () => {
    expect(() => signStaffSession("short", NOW)).toThrow(/at least 32/);
  });
});

describe("renter token", () => {
  it("round-trips rental id, expiry (14 days) and token id", () => {
    const t = signRenterToken(SECRET, "r_123", NOW, "nonce1");
    expect(t.expiresAt).toBe(NOW + RENTER_LINK_TTL_MS);
    expect(verifyRenterToken(SECRET, t.token, { now: NOW })).toEqual({
      ok: true,
      rentalId: "r_123",
      expiresAt: t.expiresAt,
      tokenId: "nonce1",
    });
  });

  it("each link gets a fresh random token id", () => {
    expect(signRenterToken(SECRET, "r1", NOW).tokenId).not.toBe(signRenterToken(SECRET, "r1", NOW).tokenId);
  });

  it("expires after 14 days", () => {
    const t = signRenterToken(SECRET, "r1", NOW);
    expect(verifyRenterToken(SECRET, t.token, { now: t.expiresAt - 1 }).ok).toBe(true);
    expect(verifyRenterToken(SECRET, t.token, { now: t.expiresAt })).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("detects tampering with the payload or signature, and another secret", () => {
    const t = signRenterToken(SECRET, "r1", NOW);
    const [payload, sig] = t.token.split(".") as [string, string];
    const forged = Buffer.from(`r2.${NOW + RENTER_LINK_TTL_MS}.x`).toString("base64url");
    expect(verifyRenterToken(SECRET, `${forged}.${sig}`, { now: NOW })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyRenterToken(SECRET, `${payload}.${flip(sig, 5)}`, { now: NOW })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyRenterToken(OTHER, t.token, { now: NOW })).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("a valid token for another rental is rejected when the route is scoped", () => {
    const t = signRenterToken(SECRET, "r1", NOW);
    expect(verifyRenterToken(SECRET, t.token, { now: NOW, forRentalId: "r2" })).toEqual({ ok: false, reason: "WRONG_RENTAL" });
    expect(verifyRenterToken(SECRET, t.token, { now: NOW, forRentalId: "r1" }).ok).toBe(true);
  });

  it.each([[undefined], [""], ["no-dot"], ["a.b.c"], ["!!!.xyz"]])("rejects malformed %j", (token) => {
    expect(verifyRenterToken(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("rejects rental ids that could break the format", () => {
    expect(() => signRenterToken(SECRET, "a.b", NOW)).toThrow();
    expect(() => signRenterToken(SECRET, "", NOW)).toThrow();
  });
});
