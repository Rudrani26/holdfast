import { describe, expect, it } from "vitest";
import { ALLOWED_FROM, settleGuard, transition, type RentalEvent, type RentalEventType } from "./rentalMachine";
import { DomainError, RENTAL_STATUSES, type Rental, type RentalStatus } from "./types";

const T = (min: number) => `2026-10-28T10:${String(min).padStart(2, "0")}:00.000Z`;

const base: Rental = {
  id: "r1",
  itemId: "headphones",
  renter: { name: "Demo Renter", email: "renter@example.com" },
  days: 2,
  depositCents: 20000,
  status: "DRAFT",
  paymentState: "NONE",
  paypal: { captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  contestRound: 0,
  createdAt: T(0),
  updatedAt: T(0),
  version: 1,
};

function ok(rental: Rental, event: RentalEvent): Rental {
  const r = transition(rental, event);
  if (r instanceof DomainError) throw new Error(`unexpected ${r.code}: ${r.message}`);
  return r;
}

function err(rental: Rental, event: RentalEvent): DomainError {
  const r = transition(rental, event);
  if (!(r instanceof DomainError)) throw new Error(`expected an error, got status ${r.status}`);
  return r;
}

/** Drives a rental through the happy path to `status`. */
function at(status: RentalStatus): Rental {
  const steps: RentalEvent[] = [
    { type: "ORDER_CREATED", at: T(1) },
    { type: "DEPOSIT_AUTHORIZED", at: T(2) },
    { type: "BASELINE_READY", at: T(3) },
    { type: "BASELINE_ACKNOWLEDGED", at: T(4), tokenId: "tok1" },
    { type: "RETURN_PHOTOS_UPLOADED", at: T(5) },
    { type: "RETURN_INSPECTED", at: T(6) },
    { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 3800 },
    { type: "RENTER_DECIDED", at: T(8), includedLines: 1, accepted: 1, contested: 0 },
    { type: "SETTLEMENT_SUCCEEDED", at: T(9) },
  ];
  let r = base;
  for (const e of steps) {
    if (r.status === status) return r;
    r = ok(r, e);
  }
  if (r.status !== status) throw new Error(`happy path does not reach ${status}`);
  return r;
}

const contested = (round = 0): Rental => ({ ...at("AWAITING_RENTER"), status: "CONTESTED", contestRound: round });

/** A valid event of each type, for the transition matrix. */
const sample: Record<RentalEventType, RentalEvent> = {
  ORDER_CREATED: { type: "ORDER_CREATED", at: T(20) },
  DEPOSIT_AUTHORIZED: { type: "DEPOSIT_AUTHORIZED", at: T(20) },
  BASELINE_READY: { type: "BASELINE_READY", at: T(20) },
  BASELINE_ACKNOWLEDGED: { type: "BASELINE_ACKNOWLEDGED", at: T(20), tokenId: "tok" },
  RETURN_PHOTOS_UPLOADED: { type: "RETURN_PHOTOS_UPLOADED", at: T(20) },
  RETURN_INSPECTED: { type: "RETURN_INSPECTED", at: T(20) },
  STAFF_CONFIRMED: { type: "STAFF_CONFIRMED", at: T(20), deductionCents: 0 },
  RENTER_DECIDED: { type: "RENTER_DECIDED", at: T(21), includedLines: 0, accepted: 0, contested: 0 },
  STAFF_SETTLE_UNDISPUTED: { type: "STAFF_SETTLE_UNDISPUTED", at: T(20), undisputedDeductionCents: 0 },
  SETTLEMENT_SUCCEEDED: { type: "SETTLEMENT_SUCCEEDED", at: T(20) },
  SETTLEMENT_FAILED: { type: "SETTLEMENT_FAILED", at: T(20) },
  SETTLEMENT_RETRY: { type: "SETTLEMENT_RETRY", at: T(20) },
  CANCELLED: { type: "CANCELLED", at: T(20) },
};

describe("happy path (ARCHITECTURE.md §4)", () => {
  it("DRAFT → … → SETTLED, bumping version and updatedAt each step", () => {
    const settled = at("SETTLED");
    expect(settled).toMatchObject({
      status: "SETTLED",
      version: 10,
      updatedAt: T(9),
      baselineAck: { at: T(4), tokenId: "tok1" },
      staffConfirmedAt: T(7),
      renterDecisionAt: T(8),
      approvedDeductionCents: 3800,
    });
  });

  it("does not mutate the input rental", () => {
    const before = at("INSPECTED");
    const copy = structuredClone(before);
    ok(before, { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 100 });
    expect(before).toEqual(copy);
  });

  it("clean return: zero included lines and a 'Looks right' decision → READY_TO_SETTLE with $0", () => {
    let r = ok(at("INSPECTED"), { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 0 });
    r = ok(r, { type: "RENTER_DECIDED", at: T(8), includedLines: 0, accepted: 0, contested: 0 });
    expect(r).toMatchObject({ status: "READY_TO_SETTLE", approvedDeductionCents: 0 });
    expect(settleGuard(r)).toBeUndefined();
  });
});

describe("transition matrix", () => {
  const cases = (Object.keys(ALLOWED_FROM) as RentalEventType[]).flatMap((type) =>
    RENTAL_STATUSES.map((status) => [type, status, ALLOWED_FROM[type].includes(status)] as const),
  );

  it.each(cases.filter(([, , allowed]) => !allowed))("%s from %s → INVALID_TRANSITION", (type, status) => {
    expect(err({ ...base, status }, sample[type]).code).toBe("INVALID_TRANSITION");
  });

  it.each([
    ["ORDER_CREATED", "DRAFT", "AWAITING_PAYMENT"],
    ["DEPOSIT_AUTHORIZED", "AWAITING_PAYMENT", "AUTHORIZED"],
    ["BASELINE_READY", "AUTHORIZED", "BASELINE_READY"],
    ["BASELINE_ACKNOWLEDGED", "BASELINE_READY", "CHECKED_OUT"],
    ["RETURN_PHOTOS_UPLOADED", "CHECKED_OUT", "RETURNED"],
    ["RETURN_INSPECTED", "RETURNED", "INSPECTED"],
    ["STAFF_CONFIRMED", "INSPECTED", "AWAITING_RENTER"],
    ["STAFF_CONFIRMED", "CONTESTED", "AWAITING_RENTER"],
    ["SETTLEMENT_FAILED", "READY_TO_SETTLE", "SETTLEMENT_FAILED"],
    ["SETTLEMENT_RETRY", "SETTLEMENT_FAILED", "READY_TO_SETTLE"],
    ["CANCELLED", "AUTHORIZED", "CANCELLED"],
    ["CANCELLED", "BASELINE_READY", "CANCELLED"],
  ] as const)("%s: %s → %s", (type, from, to) => {
    const start =
      from === "CONTESTED"
        ? contested(1)
        : from === "SETTLEMENT_FAILED"
          ? ok(at("READY_TO_SETTLE"), { type: "SETTLEMENT_FAILED", at: T(9) })
          : at(from);
    expect(ok(start, sample[type]).status).toBe(to);
  });
});

describe("renter decision guards", () => {
  const awaiting = () => at("AWAITING_RENTER");

  it("any contested line → CONTESTED and contestRound increments", () => {
    const r = ok(awaiting(), { type: "RENTER_DECIDED", at: T(8), includedLines: 2, accepted: 1, contested: 1 });
    expect(r).toMatchObject({ status: "CONTESTED", contestRound: 1 });
  });

  it("every included line must be decided", () => {
    expect(err(awaiting(), { type: "RENTER_DECIDED", at: T(8), includedLines: 2, accepted: 1, contested: 0 }).code).toBe(
      "LINES_NOT_DECIDED",
    );
  });

  it("a decision before staff confirmation in this round is rejected", () => {
    expect(err(awaiting(), { type: "RENTER_DECIDED", at: T(6), includedLines: 1, accepted: 1, contested: 0 }).code).toBe(
      "STAFF_CONFIRMATION_REQUIRED",
    );
  });

  it("rejects negative or fractional counts", () => {
    expect(err(awaiting(), { type: "RENTER_DECIDED", at: T(8), includedLines: 1, accepted: 1.5, contested: -0.5 }).code).toBe(
      "INVALID_EVENT",
    );
  });

  it("re-confirmation clears the previous round's renter decision", () => {
    const r = ok(contested(1), { type: "STAFF_CONFIRMED", at: T(30), deductionCents: 1000 });
    expect(r.renterDecisionAt).toBeUndefined();
    expect(r).toMatchObject({ staffConfirmedAt: T(30), approvedDeductionCents: 1000, contestRound: 1 });
  });
});

describe("contest rounds (max 2)", () => {
  it("allows two contests, rejects a third", () => {
    let r = at("AWAITING_RENTER");
    r = ok(r, { type: "RENTER_DECIDED", at: T(10), includedLines: 1, accepted: 0, contested: 1 });
    r = ok(r, { type: "STAFF_CONFIRMED", at: T(11), deductionCents: 3800 });
    r = ok(r, { type: "RENTER_DECIDED", at: T(12), includedLines: 1, accepted: 0, contested: 1 });
    expect(r).toMatchObject({ status: "CONTESTED", contestRound: 2 });
    r = ok(r, { type: "STAFF_CONFIRMED", at: T(13), deductionCents: 3800 });
    expect(err(r, { type: "RENTER_DECIDED", at: T(14), includedLines: 1, accepted: 0, contested: 1 }).code).toBe(
      "CONTEST_LIMIT_REACHED",
    );
  });

  it("after 2 rounds staff may settle undisputed lines only", () => {
    const r = ok(contested(2), { type: "STAFF_SETTLE_UNDISPUTED", at: T(30), undisputedDeductionCents: 1200 });
    expect(r).toMatchObject({ status: "READY_TO_SETTLE", approvedDeductionCents: 1200, undisputedOnly: true });
    expect(settleGuard(r)).toBeUndefined();
  });

  it("settling undisputed lines early, or for more than confirmed, is rejected", () => {
    expect(err(contested(1), { type: "STAFF_SETTLE_UNDISPUTED", at: T(30), undisputedDeductionCents: 0 }).code).toBe(
      "CONTEST_ROUNDS_NOT_EXHAUSTED",
    );
    expect(err(contested(2), { type: "STAFF_SETTLE_UNDISPUTED", at: T(30), undisputedDeductionCents: 5000 }).code).toBe(
      "DEDUCTION_EXCEEDS_CONFIRMED",
    );
  });
});

describe("settlement guards", () => {
  it("settle without renter acceptance is rejected", () => {
    expect(err(at("AWAITING_RENTER"), { type: "SETTLEMENT_SUCCEEDED", at: T(9) }).code).toBe("INVALID_TRANSITION");
    expect(settleGuard(at("AWAITING_RENTER"))?.code).toBe("NOT_READY_TO_SETTLE");
    // Even if status were forced, a missing renter decision blocks settlement.
    const forced = { ...at("AWAITING_RENTER"), status: "READY_TO_SETTLE" as const };
    expect(settleGuard(forced)?.code).toBe("RENTER_ACCEPTANCE_REQUIRED");
    expect(err(forced, { type: "SETTLEMENT_SUCCEEDED", at: T(9) }).code).toBe("RENTER_ACCEPTANCE_REQUIRED");
  });

  it("settle twice is rejected", () => {
    expect(err(at("SETTLED"), { type: "SETTLEMENT_SUCCEEDED", at: T(10) }).code).toBe("INVALID_TRANSITION");
    expect(settleGuard(at("SETTLED"))?.code).toBe("NOT_READY_TO_SETTLE");
  });

  it("a stale renter decision from before the latest confirmation does not count", () => {
    const stale = { ...at("READY_TO_SETTLE"), staffConfirmedAt: T(30), renterDecisionAt: T(8) };
    expect(settleGuard(stale)?.code).toBe("RENTER_ACCEPTANCE_REQUIRED");
  });

  it("staff confirmation rejects deductions above the deposit or not in whole cents", () => {
    const r = at("INSPECTED");
    expect(err(r, { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 20001 }).code).toBe("DEDUCTION_EXCEEDS_DEPOSIT");
    expect(err(r, { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 10.5 }).code).toBe("INVALID_AMOUNT");
    expect(ok(r, { type: "STAFF_CONFIRMED", at: T(7), deductionCents: 20000 }).approvedDeductionCents).toBe(20000);
  });

  it("a failed settlement can be retried, then settled", () => {
    let r = ok(at("READY_TO_SETTLE"), { type: "SETTLEMENT_FAILED", at: T(9) });
    r = ok(r, { type: "SETTLEMENT_RETRY", at: T(10) });
    expect(ok(r, { type: "SETTLEMENT_SUCCEEDED", at: T(11) }).status).toBe("SETTLED");
  });

  it("cancel is only possible before check-out", () => {
    expect(err(at("CHECKED_OUT"), { type: "CANCELLED", at: T(9) }).code).toBe("INVALID_TRANSITION");
  });
});
