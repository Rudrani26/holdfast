import { z } from "zod";

/** POST /api/rentals body (ARCHITECTURE.md §5, PRD FR-1). Shared by the booking form and the route. */
export const bookingInput = z.object({
  itemId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  days: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  renterName: z.string().trim().min(1, "Enter your name").max(80, "Name is too long"),
  renterEmail: z.email("Enter a valid email address").max(254),
});
export type BookingInput = z.infer<typeof bookingInput>;

export const RENTAL_DAYS = [1, 2, 3] as const;

/** Rental ids are random (not enumerable): `r_` + 20 hex chars. They also travel to PayPal as custom_id. */
export const rentalIdSchema = z.string().regex(/^r_[0-9a-f]{20}$/);
