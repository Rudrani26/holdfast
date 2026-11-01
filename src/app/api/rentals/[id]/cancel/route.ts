import { NextResponse, type NextRequest } from "next/server";
import { rentalIdSchema } from "@/lib/booking";
import { settlementDeps } from "@/server/appDeps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { cancelRental } from "@/server/settlement";

/** POST /api/rentals/[id]/cancel (staff) → `{ rental }`. Voids the deposit authorization. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/cancel">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!rentalIdSchema.safeParse(id).success) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  try {
    const out = await cancelRental(settlementDeps(), id);
    return out.ok
      ? NextResponse.json({ rental: out.rental })
      : NextResponse.json({ rental: out.rental, settlementOps: out.records, error: out.error }, { status: 502 });
  } catch (e) {
    return routeError(e);
  }
}
