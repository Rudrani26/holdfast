import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthConfigError } from "@/server/auth";
import { getRepo } from "@/server/deps";
import { apiError, routeError } from "@/server/http";
import { MAX_RENTER_COMMENT, renterSession, submitDecision } from "@/server/renter";

const Body = z
  .object({
    decisions: z
      .array(
        z.object({
          lineId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
          decision: z.enum(["ACCEPTED", "CONTESTED"]),
          comment: z.string().max(MAX_RENTER_COMMENT).optional(),
        }),
      )
      .max(50),
  })
  .strict();

/** POST /api/r/[token]/decision (renter token) `{ decisions }` → `{ status }`. Empty list = "Looks right" on a clean return. */
export async function POST(request: Request, ctx: RouteContext<"/api/r/[token]/decision">) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", "Expected { decisions: [{ lineId, decision, comment? }] }.");
  try {
    const status = await submitDecision(getRepo(), renterSession(token), parsed.data.decisions);
    return NextResponse.json({ status });
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    return routeError(e);
  }
}
