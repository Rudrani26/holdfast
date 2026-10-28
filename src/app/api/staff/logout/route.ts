import { NextResponse, type NextRequest } from "next/server";
import { AuthConfigError, isStaff, STAFF_COOKIE, staffCookieOptions } from "@/server/auth";
import { apiError } from "@/server/http";

/** POST /api/staff/logout (staff) → 204 and the session cookie cleared | 401 */
export async function POST(request: NextRequest) {
  try {
    if (!isStaff(request.cookies.get(STAFF_COOKIE)?.value)) {
      return apiError(401, "UNAUTHENTICATED", "Staff session required.");
    }
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(STAFF_COOKIE, "", { ...staffCookieOptions(0), maxAge: 0 });
  return res;
}
