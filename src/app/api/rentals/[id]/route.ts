import { NextResponse, type NextRequest } from "next/server";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff } from "@/server/http";
import { rentalDetail } from "@/server/rentalViews";

/** GET /api/rentals/[id] (staff) → `{ rental, item, photos, inspections, lineItems, events }` */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  const detail = await rentalDetail(getRepo(), id);
  return detail ? NextResponse.json(detail) : apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
}
