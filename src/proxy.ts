import { NextResponse, type NextRequest } from "next/server";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/authTokens";

// Next.js 16 renamed middleware.ts → proxy.ts. This only gates staff *pages*; every staff API route
// checks the session itself (the proxy is a convenience, not the security boundary).

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/staff/login") return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const ok = !!secret && secret.length >= 32 && verifyStaffSession(secret, request.cookies.get(STAFF_COOKIE)?.value);
  if (ok) return NextResponse.next();

  const login = new URL("/staff/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/staff", "/staff/:path*"],
};
