import "server-only";
import { getEnv } from "@/lib/env";
import { safeEqual, STAFF_COOKIE, verifyStaffSession } from "@/lib/authTokens";

// docs/ARCHITECTURE.md §6. One shared staff passcode; no user accounts.

export { STAFF_COOKIE };

export class AuthConfigError extends Error {
  constructor(missing: string[]) {
    super(`staff auth is not configured: set ${missing.join(", ")} in the environment`);
    this.name = "AuthConfigError";
  }
}

/** Secrets for auth, or AuthConfigError naming what is missing (never the values). */
export function authSecrets(): { staffPasscode: string; sessionSecret: string; renterLinkSecret: string } {
  const env = getEnv();
  const missing = (["STAFF_PASSCODE", "SESSION_SECRET", "RENTER_LINK_SECRET"] as const).filter((k) => !env[k]);
  if (missing.length > 0) throw new AuthConfigError(missing);
  return {
    staffPasscode: env.STAFF_PASSCODE as string,
    sessionSecret: env.SESSION_SECRET as string,
    renterLinkSecret: env.RENTER_LINK_SECRET as string,
  };
}

/** Constant-time passcode comparison. */
export const passcodeMatches = (input: string, expected: string) => safeEqual(input, expected);

/** True when the request carries a valid staff session cookie. */
export function isStaff(cookieValue: string | undefined, now = Date.now()): boolean {
  return verifyStaffSession(authSecrets().sessionSecret, cookieValue, now);
}

export function staffCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    // Secure everywhere except plain-http local dev (Safari drops Secure cookies on http://localhost).
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  };
}

/**
 * Sliding-window limiter: at most `limit` attempts per key in `windowMs`. In-memory, which is
 * acceptable for the single-instance demo (ARCHITECTURE.md §6); each Cloud Run instance counts alone.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records an attempt. Returns whether it is allowed and, if not, seconds until the next slot. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec: Math.ceil((recent[0]! + this.windowMs - now) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= now - this.windowMs)) this.hits.delete(key);
    }
  }
}

export const staffLoginLimiter = new RateLimiter(10, 15 * 60 * 1000);

/**
 * Client IP for rate limiting. Cloud Run's front end appends the real client address as the last
 * X-Forwarded-For entry; earlier entries are client-supplied and spoofable.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").map((s) => s.trim()).filter(Boolean).at(-1);
  return last || headers.get("x-real-ip") || "unknown";
}
