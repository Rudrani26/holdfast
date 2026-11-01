import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DAMAGE_TYPES, SEVERITIES } from "@/domain/types";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { addManualLine } from "@/server/review";

const Body = z
  .object({
    angleId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    damageType: z.enum(DAMAGE_TYPES),
    severity: z.enum(SEVERITIES),
    priceRuleRef: z.string().regex(/^[A-Z_]+:[A-Z]+$/),
  })
  .strict();

/** POST /api/rentals/[id]/line-items (staff) manual line priced from the price list → 201 `{ lineItem }` */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/line-items">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", "Expected { angleId, damageType, severity, priceRuleRef }.");
  try {
    return NextResponse.json({ lineItem: await addManualLine({ repo: getRepo() }, id, parsed.data) }, { status: 201 });
  } catch (e) {
    return routeError(e);
  }
}
