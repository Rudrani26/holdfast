import { NextResponse, type NextRequest } from "next/server";
import { signRenterToken } from "@/lib/authTokens";
import { getEnv } from "@/lib/env";
import { AuthConfigError, authSecrets } from "@/server/auth";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { confirmReview } from "@/server/review";

/**
 * POST /api/rentals/[id]/confirm (staff) → `{ renterLink, deductionCents, rentalStatus }`.
 * Freezes the round's lines (FR-9); the renter link carries a token for this rental only.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/confirm">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  let secret: string;
  try {
    secret = authSecrets().renterLinkSecret;
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }
  try {
    const { rental, deductionCents } = await confirmReview({ repo: getRepo() }, id);
    const { token } = signRenterToken(secret, id);
    return NextResponse.json({ renterLink: `${getEnv().APP_BASE_URL ?? ""}/r/${token}`, deductionCents, rentalStatus: rental.status });
  } catch (e) {
    return routeError(e);
  }
}
