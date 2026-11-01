import { NextResponse, type NextRequest } from "next/server";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { settleUndisputed } from "@/server/review";

/**
 * POST /api/rentals/[id]/settle-undisputed (staff) → `{ rentalStatus, deductionCents }`. Only after the
 * contest limit: freezes the renter-accepted lines as the deduction (ARCHITECTURE.md §4). Settlement
 * itself still runs from /settle.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/settle-undisputed">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  try {
    const { rental, deductionCents } = await settleUndisputed({ repo: getRepo() }, id);
    return NextResponse.json({ rentalStatus: rental.status, deductionCents });
  } catch (e) {
    return routeError(e);
  }
}
