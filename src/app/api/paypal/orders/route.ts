import { NextResponse } from "next/server";
import { z } from "zod";
import { rentalIdSchema } from "@/lib/booking";
import { createOrderForRental } from "@/server/booking";
import { bookingDeps } from "@/server/appDeps";
import { apiError, routeError } from "@/server/http";

const Body = z.object({ rentalId: rentalIdSchema });

/**
 * POST /api/paypal/orders `{ rentalId }` → `{ orderId }`. The amount is the rental's deposit,
 * taken from the item at booking; the client never sends one.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", "Expected { rentalId }.");
  try {
    return NextResponse.json(await createOrderForRental(bookingDeps(), parsed.data.rentalId));
  } catch (e) {
    return routeError(e);
  }
}
