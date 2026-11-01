import "server-only";
import { randomBytes } from "node:crypto";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type IsoTime, type Rental, type SettlementMode } from "@/domain/types";
import type { BookingInput } from "@/lib/booking";
import { formatUsd } from "@/lib/money";
import type { PayPalClient } from "./paypal/client";
import { authorizeOrder, createDepositOrder } from "./paypal/orders";
import type { Repo, Tx } from "./repo/types";

// Booking flow (TASKS T-021; PAYPAL_INTEGRATION.md §5.1–§5.3). The deposit always comes from the
// item record, never from the client. PayPal is called outside transactions (a transaction may run
// twice); the result is then recorded in a transaction that re-checks the rental's state.

export interface BookingDeps {
  repo: Repo;
  paypal: PayPalClient;
  settlementMode: SettlementMode;
  now?: () => Date;
}

export const newRentalId = () => `r_${randomBytes(10).toString("hex")}`;

const iso = (deps: BookingDeps): IsoTime => (deps.now?.() ?? new Date()).toISOString();

async function mustGetRental(repo: Repo | Tx, rentalId: string): Promise<Rental> {
  const rental = await repo.getRental(rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
  return rental;
}

function apply(result: Rental | DomainError): Rental {
  if (result instanceof DomainError) throw result;
  return result;
}

/** Creates a DRAFT rental for an active item. */
export async function createRental(deps: BookingDeps, input: BookingInput): Promise<Rental> {
  const item = await deps.repo.getItem(input.itemId);
  if (!item?.active) throw new DomainError("ITEM_NOT_FOUND", "That item is not available.");
  const at = iso(deps);
  const rental: Rental = {
    id: newRentalId(),
    itemId: item.id,
    renter: { name: input.renterName, email: input.renterEmail },
    days: input.days,
    depositCents: item.depositCents,
    status: "DRAFT",
    paymentState: "NONE",
    paypal: { captures: [], refunds: [] },
    settlementMode: deps.settlementMode,
    contestRound: 0,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
  await deps.repo.runTransaction(async (tx) => {
    if (await tx.getRental(rental.id)) throw new DomainError("RENTAL_EXISTS", "Rental id collision; try again.");
    tx.putRental(rental);
    tx.addEvent(rental.id, {
      id: "rental-created",
      at,
      actor: "RENTER",
      type: "RENTAL_CREATED",
      summary: `Booked ${item.name} for ${input.days} day${input.days > 1 ? "s" : ""}; deposit ${formatUsd(item.depositCents)}`,
      data: { itemId: item.id, days: input.days, depositCents: item.depositCents },
    });
  });
  return rental;
}

/**
 * Creates the PayPal deposit order (or returns the one already created). The request id is
 * `rental:<id>:create-order`, so a repeat or concurrent call gets the same order from PayPal.
 */
export async function createOrderForRental(deps: BookingDeps, rentalId: string): Promise<{ orderId: string }> {
  const rental = await mustGetRental(deps.repo, rentalId);
  if (rental.status === "AWAITING_PAYMENT" && rental.paypal.orderId) return { orderId: rental.paypal.orderId };
  if (rental.status !== "DRAFT") throw new DomainError("RENTAL_NOT_PAYABLE", `Rental is ${rental.status}.`);
  const item = await deps.repo.getItem(rental.itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "That item is not available.");

  const order = await createDepositOrder(deps.paypal, {
    rentalId,
    amountCents: rental.depositCents,
    itemName: item.name,
  });

  return deps.repo.runTransaction(async (tx) => {
    const current = await mustGetRental(tx, rentalId);
    if (current.paypal.orderId) return { orderId: current.paypal.orderId };
    const at = iso(deps);
    const next = apply(transition(current, { type: "ORDER_CREATED", at }));
    tx.putRental({ ...next, paymentState: "ORDER_CREATED", paypal: { ...next.paypal, orderId: order.orderId } });
    tx.addEvent(rentalId, {
      id: "order-created",
      at,
      actor: "PAYPAL",
      type: "ORDER_CREATED",
      summary: `PayPal order created for a ${formatUsd(rental.depositCents)} deposit authorization`,
      data: { orderId: order.orderId, status: order.status },
    });
    return { orderId: order.orderId };
  });
}

export interface AuthorizationResult {
  status: string;
  authorizationId: string;
  expiresAt?: string;
}

/**
 * Authorizes the approved order. Only the order recorded on this rental is accepted. Repeat calls
 * after success return the stored authorization; PayPal also dedupes on `rental:<id>:authorize`.
 */
export async function authorizeRental(
  deps: BookingDeps,
  { rentalId, orderId }: { rentalId: string; orderId: string },
): Promise<AuthorizationResult> {
  const rental = await mustGetRental(deps.repo, rentalId);
  if (rental.paypal.orderId !== orderId) throw new DomainError("ORDER_MISMATCH", "That PayPal order does not belong to this rental.");
  const stored = storedAuthorization(rental);
  if (stored) return stored;
  if (rental.status !== "AWAITING_PAYMENT") throw new DomainError("RENTAL_NOT_PAYABLE", `Rental is ${rental.status}.`);

  const auth = await authorizeOrder(deps.paypal, { orderId, rentalId });
  const at = iso(deps);

  if (auth.authorizationStatus !== "CREATED" || auth.amountCents !== rental.depositCents) {
    // Record what PayPal returned, but do not treat the deposit as held.
    await deps.repo.runTransaction(async (tx) => {
      const current = await mustGetRental(tx, rentalId);
      tx.putRental({
        ...current,
        paypal: { ...current.paypal, authorizationId: auth.authorizationId, authStatus: auth.authorizationStatus, authExpiresAt: auth.expiresAt },
        updatedAt: at,
        version: current.version + 1,
      });
      tx.addEvent(rentalId, {
        id: `authorization-not-held-${auth.authorizationId}`,
        at,
        actor: "PAYPAL",
        type: "DEPOSIT_NOT_AUTHORIZED",
        summary: `PayPal returned authorization status ${auth.authorizationStatus} for ${formatUsd(auth.amountCents)}; deposit not held`,
        data: { orderId, authorizationId: auth.authorizationId, status: auth.authorizationStatus, amountCents: auth.amountCents },
      });
    });
    throw new DomainError(
      "AUTHORIZATION_NOT_CREATED",
      `PayPal did not place the deposit hold (status ${auth.authorizationStatus}). No money was taken.`,
    );
  }

  return deps.repo.runTransaction(async (tx) => {
    const current = await mustGetRental(tx, rentalId);
    const already = storedAuthorization(current);
    if (already) return already;
    const next = apply(transition(current, { type: "DEPOSIT_AUTHORIZED", at }));
    tx.putRental({
      ...next,
      paymentState: "AUTHORIZED",
      paypal: { ...next.paypal, authorizationId: auth.authorizationId, authStatus: auth.authorizationStatus, authExpiresAt: auth.expiresAt },
    });
    tx.addEvent(rentalId, {
      id: "deposit-authorized",
      at,
      actor: "PAYPAL",
      type: "DEPOSIT_AUTHORIZED",
      summary: `${formatUsd(auth.amountCents)} deposit authorized (hold, not a charge)`,
      data: {
        orderId,
        orderStatus: auth.orderStatus,
        authorizationId: auth.authorizationId,
        status: auth.authorizationStatus,
        amountCents: auth.amountCents,
        expiresAt: auth.expiresAt,
      },
    });
    return { status: auth.authorizationStatus, authorizationId: auth.authorizationId, expiresAt: auth.expiresAt };
  });
}

function storedAuthorization(rental: Rental): AuthorizationResult | undefined {
  const { authorizationId, authStatus, authExpiresAt } = rental.paypal;
  if (rental.paymentState === "NONE" || rental.paymentState === "ORDER_CREATED" || !authorizationId || !authStatus) return undefined;
  return { status: authStatus, authorizationId, expiresAt: authExpiresAt };
}
