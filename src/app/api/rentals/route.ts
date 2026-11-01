import { NextResponse, type NextRequest } from "next/server";
import { bookingInput } from "@/lib/booking";
import { bookingDeps } from "@/server/appDeps";
import { clientIp, RateLimiter } from "@/server/auth";
import { createRental } from "@/server/booking";
import { getRepo } from "@/server/deps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { isRentalStatus, listRentalSummaries } from "@/server/rentalViews";

/** GET /api/rentals?status= (staff) → `{ rentals: RentalSummary[] }`, newest update first. */
export async function GET(request: NextRequest) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  if (status !== undefined && !isRentalStatus(status)) return apiError(400, "INVALID_STATUS", "Unknown rental status.");
  return NextResponse.json({ rentals: await listRentalSummaries(getRepo(), status) });
}

// Public route that writes to Firestore: cap bookings per client IP.
const bookingLimiter = new RateLimiter(20, 60 * 60 * 1000);

/** POST /api/rentals `{ itemId, days, renterName, renterEmail }` → 201 `{ rentalId }` */
export async function POST(request: Request) {
  const limit = bookingLimiter.hit(clientIp(request.headers));
  if (!limit.allowed) {
    return apiError(429, "RATE_LIMITED", "Too many bookings from this network. Try again later.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }
  const parsed = bookingInput.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return apiError(400, "INVALID_BODY", parsed.error.issues.map((i) => i.message).join("; "));
  }
  try {
    const rental = await createRental(bookingDeps(), parsed.data);
    return NextResponse.json({ rentalId: rental.id }, { status: 201 });
  } catch (e) {
    return routeError(e);
  }
}
