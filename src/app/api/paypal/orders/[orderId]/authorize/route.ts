import { NextResponse } from "next/server";
import { z } from "zod";
import { signRenterToken } from "@/lib/authTokens";
import { rentalIdSchema } from "@/lib/booking";
import { AuthConfigError, authSecrets } from "@/server/auth";
import { authorizeRental } from "@/server/booking";
import { bookingDeps } from "@/server/appDeps";
import { apiError, routeError } from "@/server/http";

const Body = z.object({ rentalId: rentalIdSchema });
const OrderId = z.string().regex(/^[A-Z0-9]{1,36}$/);

/**
 * POST /api/paypal/orders/[orderId]/authorize `{ rentalId }` →
 * `{ status, authorizationId, expiresAt, confirmationPath }`.
 * `confirmationPath` (beyond ARCHITECTURE §5) carries a signed renter token, so the confirmation
 * page and renter link are only reachable by whoever completed the PayPal approval.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/paypal/orders/[orderId]/authorize">) {
  const { orderId } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success || !OrderId.safeParse(orderId).success) {
    return apiError(400, "INVALID_BODY", "Expected a PayPal order id and { rentalId }.");
  }
  const { rentalId } = parsed.data;

  let secret: string;
  try {
    secret = authSecrets().renterLinkSecret;
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }

  try {
    const auth = await authorizeRental(bookingDeps(), { rentalId, orderId });
    const { token } = signRenterToken(secret, rentalId);
    return NextResponse.json({ ...auth, confirmationPath: `/rent/confirmed/${rentalId}?t=${token}` });
  } catch (e) {
    return routeError(e);
  }
}
