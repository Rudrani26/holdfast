import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signStaffSession } from "@/lib/authTokens";

const SESSION_SECRET = "a".repeat(32);
const ENV = {
  PAYPAL_ENV: "sandbox",
  STAFF_PASSCODE: "correct horse battery",
  SESSION_SECRET,
  RENTER_LINK_SECRET: "b".repeat(32),
};

// getEnv() caches process.env on first use, so each test gets fresh modules with stubbed env.
async function load(env: Record<string, string | undefined> = ENV) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const auth = await import("./auth");
  const login = await import("@/app/api/staff/login/route");
  const logout = await import("@/app/api/staff/logout/route");
  return { auth, login, logout };
}

const loginRequest = (body: unknown, ip = "203.0.113.7") =>
  new Request("http://localhost/api/staff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.1, ${ip}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("RateLimiter", () => {
  it("allows `limit` attempts per window, then reports when to retry", async () => {
    const { auth } = await load();
    const rl = new auth.RateLimiter(3, 60_000);
    expect([0, 1, 2].map((i) => rl.hit("ip", 1000 + i).allowed)).toEqual([true, true, true]);
    expect(rl.hit("ip", 2000)).toEqual({ allowed: false, retryAfterSec: 59 });
    expect(rl.hit("other", 2000).allowed).toBe(true);
    expect(rl.hit("ip", 61_000).allowed).toBe(true); // first hit left the window
  });
});

describe("clientIp", () => {
  it("uses the last X-Forwarded-For entry (the one Cloud Run appends)", async () => {
    const { auth } = await load();
    expect(auth.clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(auth.clientIp(new Headers())).toBe("unknown");
  });
});

describe("POST /api/staff/login", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie on the right passcode", async () => {
    const { login, auth } = await load();
    const res = await login.POST(loginRequest({ passcode: ENV.STAFF_PASSCODE }));
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^hf_staff=\d{13}\./);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    const value = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    expect(auth.isStaff(value)).toBe(true);
  });

  it("401 on a wrong passcode, 400 on a bad body, and never echoes the passcode", async () => {
    const { login } = await load();
    const wrong = await login.POST(loginRequest({ passcode: "guess" }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await wrong.text()).not.toContain(ENV.STAFF_PASSCODE);
    expect((await login.POST(loginRequest("not json"))).status).toBe(400);
    expect((await login.POST(loginRequest({ pass: "x" }))).status).toBe(400);
  });

  it("rate-limits the 11th attempt from one IP within 15 minutes (even with the right passcode)", async () => {
    const { login } = await load();
    for (let i = 0; i < 10; i++) expect((await login.POST(loginRequest({ passcode: "guess" }))).status).toBe(401);
    const limited = await login.POST(loginRequest({ passcode: ENV.STAFF_PASSCODE }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await login.POST(loginRequest({ passcode: ENV.STAFF_PASSCODE }, "192.0.2.9"))).status).toBe(204);
  });

  it("500 with the missing variable names (not values) when auth is not configured", async () => {
    const { login } = await load({ PAYPAL_ENV: "sandbox", STAFF_PASSCODE: "x", SESSION_SECRET: "", RENTER_LINK_SECRET: "" });
    const res = await login.POST(loginRequest({ passcode: "x" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "AUTH_NOT_CONFIGURED" } });
  });
});

describe("POST /api/staff/logout", () => {
  const logoutRequest = async (cookie?: string) => {
    const { NextRequest } = await import("next/server");
    return new NextRequest("http://localhost/api/staff/logout", {
      method: "POST",
      headers: cookie ? { cookie: `hf_staff=${cookie}` } : {},
    });
  };

  it("clears the cookie for a staff session", async () => {
    const { logout } = await load();
    const res = await logout.POST(await logoutRequest(signStaffSession(SESSION_SECRET).value));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/hf_staff=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
  });

  it("401 without a valid session", async () => {
    const { logout } = await load();
    expect((await logout.POST(await logoutRequest())).status).toBe(401);
    expect((await logout.POST(await logoutRequest("123.forged"))).status).toBe(401);
  });
});
