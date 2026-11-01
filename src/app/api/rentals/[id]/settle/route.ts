import { NextResponse, type NextRequest } from "next/server";
import { rentalIdSchema } from "@/lib/booking";
import { settlementDeps } from "@/server/appDeps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { settleRental } from "@/server/settlement";

/**
 * POST /api/rentals/[id]/settle (staff) → `{ rental, settlementOps }`. The amount is the rental's
 * staff-confirmed, renter-accepted deduction; the request body is ignored. Pressing Settle again on
 * a SETTLEMENT_FAILED rental retries (reconciling with PayPal first).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/settle">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!rentalIdSchema.safeParse(id).success) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  try {
    const out = await settleRental(settlementDeps(), id);
    const body = { rental: out.rental, settlementOps: out.records };
    return out.ok ? NextResponse.json(body) : NextResponse.json({ ...body, error: out.error }, { status: 502 });
  } catch (e) {
    return routeError(e);
  }
}
