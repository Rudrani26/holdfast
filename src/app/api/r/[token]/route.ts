import { NextResponse } from "next/server";
import { AuthConfigError } from "@/server/auth";
import { getRepo } from "@/server/deps";
import { apiError, routeError } from "@/server/http";
import { renterSession, renterView } from "@/server/renter";

/** GET /api/r/[token] (renter token) → renter view model for that rental only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/r/[token]">) {
  const { token } = await ctx.params;
  try {
    const session = renterSession(token);
    return NextResponse.json(await renterView(getRepo(), session, token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    return routeError(e);
  }
}
