import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_OVERRIDE_REASON } from "@/domain/pricer";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { updateLine } from "@/server/review";

const Body = z
  .object({
    staffDecision: z.enum(["INCLUDED", "EXCLUDED"]).optional(),
    priceRuleRef: z.string().regex(/^[A-Z_]+:[A-Z]+$/).optional(),
    overrideAmountCents: z.number().int().nonnegative().nullable().optional(),
    overrideReason: z.string().trim().min(1).max(MAX_OVERRIDE_REASON).optional(),
  })
  .strict()
  .refine((b) => typeof b.overrideAmountCents !== "number" || b.overrideReason, { message: "An override needs a reason." });

/** PATCH /api/rentals/[id]/line-items/[lineId] (staff) → `{ lineItem }` */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/line-items/[lineId]">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id, lineId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[A-Za-z0-9_-]{1,120}$/.test(lineId)) return apiError(404, "LINE_NOT_FOUND", "Line not found.");
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", parsed.error.issues.map((i) => i.message).join("; "));
  try {
    return NextResponse.json({ lineItem: await updateLine({ repo: getRepo() }, id, lineId, parsed.data) });
  } catch (e) {
    return routeError(e);
  }
}
