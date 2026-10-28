import { NextResponse } from "next/server";
import { z } from "zod";
import { signStaffSession } from "@/lib/authTokens";
import {
  AuthConfigError,
  authSecrets,
  clientIp,
  passcodeMatches,
  STAFF_COOKIE,
  staffCookieOptions,
  staffLoginLimiter,
} from "@/server/auth";
import { apiError } from "@/server/http";

const Body = z.object({ passcode: z.string().min(1).max(200) });

/** POST /api/staff/login `{ passcode }` → 204 + hf_staff cookie | 400 | 401 | 429 | 500 */
export async function POST(request: Request) {
  // Count every attempt (valid or not) before checking anything, so the limit cannot be probed.
  const limit = staffLoginLimiter.hit(clientIp(request.headers));
  if (!limit.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many login attempts. Try again later.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  let secrets;
  try {
    secrets = authSecrets();
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }

  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", "Expected { passcode: string }.");
  if (!passcodeMatches(parsed.data.passcode, secrets.staffPasscode)) {
    return apiError(401, "INVALID_PASSCODE", "Incorrect passcode.");
  }

  const session = signStaffSession(secrets.sessionSecret);
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(STAFF_COOKIE, session.value, staffCookieOptions(session.expiresAt));
  return res;
}
