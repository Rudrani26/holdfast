import "server-only";
import { RENTAL_STATUSES, type Cents, type RentalStatus } from "@/domain/types";
import type { Repo } from "./repo/types";

// Read models for staff screens and GET /api/rentals(/[id]) (ARCHITECTURE.md §5).

export interface RentalSummary {
  id: string;
  itemId: string;
  itemName: string;
  renterName: string;
  status: RentalStatus;
  paymentState: string;
  depositCents: Cents;
  updatedAt: string;
}

export const isRentalStatus = (s: unknown): s is RentalStatus => RENTAL_STATUSES.includes(s as RentalStatus);

export async function listRentalSummaries(repo: Repo, status?: RentalStatus, limit = 100): Promise<RentalSummary[]> {
  const [rentals, items] = await Promise.all([repo.listRentals({ status, limit }), repo.listItems()]);
  const names = new Map(items.map((i) => [i.id, i.name]));
  return rentals.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    itemName: names.get(r.itemId) ?? r.itemId,
    renterName: r.renter.name,
    status: r.status,
    paymentState: r.paymentState,
    depositCents: r.depositCents,
    updatedAt: r.updatedAt,
  }));
}

/** Everything the staff workspace shows for one rental, or undefined if it does not exist. */
export async function rentalDetail(repo: Repo, rentalId: string) {
  const rental = await repo.getRental(rentalId);
  if (!rental) return undefined;
  const [item, photos, inspections, lineItems, events] = await Promise.all([
    repo.getItem(rental.itemId),
    repo.listPhotos(rentalId),
    repo.listInspections(rentalId),
    repo.listLineItems(rentalId),
    repo.listEvents(rentalId),
  ]);
  return { rental, item, photos, inspections, lineItems, events };
}
