import { NextResponse } from "next/server";
import { AuthConfigError } from "@/server/auth";
import { getRepo } from "@/server/deps";
import { apiError, routeError } from "@/server/http";
import { acknowledgeBaseline, renterSession } from "@/server/renter";

/** POST /api/r/[token]/baseline-ack (renter token) `{}` → `{ ok: true }`. Idempotent. */
export async function POST(_request: Request, ctx: RouteContext<"/api/r/[token]/baseline-ack">) {
  const { token } = await ctx.params;
  try {
    await acknowledgeBaseline(getRepo(), renterSession(token));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    return routeError(e);
  }
}
