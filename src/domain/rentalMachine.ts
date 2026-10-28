/**
 * Rental state machine (docs/ARCHITECTURE.md §4). Pure: callers load facts (e.g. line-item
 * decisions) and pass them in the event; the machine checks guards and returns the next rental or a
 * DomainError. It never touches PayPal; payment state is updated only from PayPal responses.
 */
import { DomainError, type Cents, type IsoTime, type Rental, type RentalStatus } from "./types";

export const MAX_CONTEST_ROUNDS = 2;

export type RentalEvent =
  | { type: "ORDER_CREATED"; at: IsoTime }
  | { type: "DEPOSIT_AUTHORIZED"; at: IsoTime }
  | { type: "BASELINE_READY"; at: IsoTime }
  | { type: "BASELINE_ACKNOWLEDGED"; at: IsoTime; tokenId: string }
  | { type: "RETURN_PHOTOS_UPLOADED"; at: IsoTime }
  | { type: "RETURN_INSPECTED"; at: IsoTime }
  /** Staff confirm the priced line items; `deductionCents` is the pricer total for included lines. */
  | { type: "STAFF_CONFIRMED"; at: IsoTime; deductionCents: Cents }
  /** Renter's per-line decisions, summarized for included lines (0 included = clean return). */
  | { type: "RENTER_DECIDED"; at: IsoTime; includedLines: number; accepted: number; contested: number }
  /** After the contest limit: settle undisputed lines only; contested lines are excluded. */
  | { type: "STAFF_SETTLE_UNDISPUTED"; at: IsoTime; undisputedDeductionCents: Cents }
  | { type: "SETTLEMENT_SUCCEEDED"; at: IsoTime }
  | { type: "SETTLEMENT_FAILED"; at: IsoTime }
  | { type: "SETTLEMENT_RETRY"; at: IsoTime }
  | { type: "CANCELLED"; at: IsoTime };

export type RentalEventType = RentalEvent["type"];

/** Which statuses each event may start from. */
export const ALLOWED_FROM: Record<RentalEventType, readonly RentalStatus[]> = {
  ORDER_CREATED: ["DRAFT"],
  DEPOSIT_AUTHORIZED: ["AWAITING_PAYMENT"],
  BASELINE_READY: ["AUTHORIZED"],
  BASELINE_ACKNOWLEDGED: ["BASELINE_READY"],
  RETURN_PHOTOS_UPLOADED: ["CHECKED_OUT"],
  RETURN_INSPECTED: ["RETURNED"],
  STAFF_CONFIRMED: ["INSPECTED", "CONTESTED"],
  RENTER_DECIDED: ["AWAITING_RENTER"],
  STAFF_SETTLE_UNDISPUTED: ["CONTESTED"],
  SETTLEMENT_SUCCEEDED: ["READY_TO_SETTLE"],
  SETTLEMENT_FAILED: ["READY_TO_SETTLE"],
  SETTLEMENT_RETRY: ["SETTLEMENT_FAILED"],
  CANCELLED: ["AUTHORIZED", "BASELINE_READY"],
};

const fail = (code: string, message: string) => new DomainError(code, message);

function checkDeduction(rental: Rental, cents: Cents): DomainError | undefined {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return fail("INVALID_AMOUNT", "deduction must be non-negative integer cents");
  }
  if (cents > rental.depositCents) {
    return fail("DEDUCTION_EXCEEDS_DEPOSIT", `deduction ${cents} exceeds deposit ${rental.depositCents}`);
  }
  return undefined;
}

export function transition(rental: Rental, event: RentalEvent): Rental | DomainError {
  if (!ALLOWED_FROM[event.type].includes(rental.status)) {
    return fail("INVALID_TRANSITION", `${event.type} is not allowed from ${rental.status}`);
  }
  const next = (status: RentalStatus, patch: Partial<Rental> = {}): Rental => ({
    ...rental,
    ...patch,
    status,
    updatedAt: event.at,
    version: rental.version + 1,
  });

  switch (event.type) {
    case "ORDER_CREATED":
      return next("AWAITING_PAYMENT");
    case "DEPOSIT_AUTHORIZED":
      return next("AUTHORIZED");
    case "BASELINE_READY":
      return next("BASELINE_READY");
    case "BASELINE_ACKNOWLEDGED":
      if (!event.tokenId) return fail("INVALID_EVENT", "baseline acknowledgement needs the renter token id");
      return next("CHECKED_OUT", { baselineAck: { at: event.at, tokenId: event.tokenId } });
    case "RETURN_PHOTOS_UPLOADED":
      return next("RETURNED");
    case "RETURN_INSPECTED":
      return next("INSPECTED");

    case "STAFF_CONFIRMED": {
      const bad = checkDeduction(rental, event.deductionCents);
      if (bad) return bad;
      // A new confirmation opens a new decision round: any earlier renter decision no longer counts.
      return next("AWAITING_RENTER", {
        staffConfirmedAt: event.at,
        renterDecisionAt: undefined,
        approvedDeductionCents: event.deductionCents,
      });
    }

    case "RENTER_DECIDED": {
      const { includedLines, accepted, contested } = event;
      if (![includedLines, accepted, contested].every((n) => Number.isSafeInteger(n) && n >= 0)) {
        return fail("INVALID_EVENT", "line counts must be non-negative integers");
      }
      if (!rental.staffConfirmedAt || event.at < rental.staffConfirmedAt) {
        return fail("STAFF_CONFIRMATION_REQUIRED", "renter decision must follow staff confirmation in this round");
      }
      if (accepted + contested !== includedLines) {
        return fail("LINES_NOT_DECIDED", `renter decided ${accepted + contested} of ${includedLines} included lines`);
      }
      if (contested > 0) {
        if (rental.contestRound >= MAX_CONTEST_ROUNDS) {
          return fail("CONTEST_LIMIT_REACHED", `only ${MAX_CONTEST_ROUNDS} contest rounds are allowed`);
        }
        return next("CONTESTED", { renterDecisionAt: event.at, contestRound: rental.contestRound + 1 });
      }
      return next("READY_TO_SETTLE", { renterDecisionAt: event.at });
    }

    case "STAFF_SETTLE_UNDISPUTED": {
      if (rental.contestRound < MAX_CONTEST_ROUNDS) {
        return fail(
          "CONTEST_ROUNDS_NOT_EXHAUSTED",
          `settling undisputed lines only is allowed after ${MAX_CONTEST_ROUNDS} contest rounds`,
        );
      }
      const bad = checkDeduction(rental, event.undisputedDeductionCents);
      if (bad) return bad;
      if (rental.approvedDeductionCents !== undefined && event.undisputedDeductionCents > rental.approvedDeductionCents) {
        return fail("DEDUCTION_EXCEEDS_CONFIRMED", "undisputed amount cannot exceed the staff-confirmed amount");
      }
      return next("READY_TO_SETTLE", { approvedDeductionCents: event.undisputedDeductionCents, undisputedOnly: true });
    }

    case "SETTLEMENT_SUCCEEDED": {
      const guard = settleGuard(rental);
      return guard ?? next("SETTLED");
    }
    case "SETTLEMENT_FAILED":
      return next("SETTLEMENT_FAILED");
    case "SETTLEMENT_RETRY":
      return next("READY_TO_SETTLE");
    case "CANCELLED":
      return next("CANCELLED");
  }
}

/**
 * Settlement may run only from READY_TO_SETTLE with a staff-confirmed amount within the deposit, and
 * (unless settling undisputed lines after the contest limit) a renter decision in the current round.
 */
export function settleGuard(rental: Rental): DomainError | undefined {
  if (rental.status !== "READY_TO_SETTLE") {
    return fail("NOT_READY_TO_SETTLE", `cannot settle from ${rental.status}`);
  }
  if (!rental.staffConfirmedAt || rental.approvedDeductionCents === undefined) {
    return fail("STAFF_CONFIRMATION_REQUIRED", "no staff-confirmed amount");
  }
  if (!rental.undisputedOnly && (!rental.renterDecisionAt || rental.renterDecisionAt < rental.staffConfirmedAt)) {
    return fail("RENTER_ACCEPTANCE_REQUIRED", "renter has not accepted the current round");
  }
  return checkDeduction(rental, rental.approvedDeductionCents);
}
