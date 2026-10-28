/**
 * Settlement planner (docs/PAYPAL_INTEGRATION.md §3 decision table). Pure: turns a mode, the
 * deposit H and the approved deduction D into the ordered PayPal operations to run. The executor
 * (T-022) runs them; nothing here talks to PayPal.
 */
import { DomainError, type Cents, type SettlementMode } from "./types";

export type SettlementOp =
  | { op: "CAPTURE"; amountCents: Cents; finalCapture: boolean }
  | { op: "VOID" }
  | { op: "REFUND"; amountCents: Cents };

export function plan(mode: SettlementMode, depositCents: Cents, deductionCents: Cents): SettlementOp[] {
  if (!Number.isSafeInteger(depositCents) || depositCents <= 0) {
    throw new DomainError("INVALID_AMOUNT", "deposit must be positive integer cents");
  }
  if (!Number.isSafeInteger(deductionCents) || deductionCents < 0 || deductionCents > depositCents) {
    throw new DomainError("INVALID_AMOUNT", `deduction must be integer cents between 0 and ${depositCents}`);
  }

  // Same in every mode (§3): nothing owed → void; everything owed → one final capture.
  if (deductionCents === 0) return [{ op: "VOID" }];
  if (deductionCents === depositCents) return [{ op: "CAPTURE", amountCents: depositCents, finalCapture: true }];

  switch (mode) {
    case "PARTIAL_CAPTURE_THEN_VOID":
      // Verified in sandbox E1: void after a non-final partial capture is accepted.
      return [{ op: "CAPTURE", amountCents: deductionCents, finalCapture: false }, { op: "VOID" }];
    case "PARTIAL_CAPTURE_FINAL":
      return [{ op: "CAPTURE", amountCents: deductionCents, finalCapture: true }];
    case "CAPTURE_THEN_REFUND":
      return [
        { op: "CAPTURE", amountCents: depositCents, finalCapture: true },
        { op: "REFUND", amountCents: depositCents - deductionCents },
      ];
  }
}
