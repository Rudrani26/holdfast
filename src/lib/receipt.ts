import type { Cents, Rental, SettlementOpKind, SettlementRecord, TimelineEvent } from "@/domain/types";
import { formatUsd } from "./money";
import { CAPTURE_PENDING_COPY, settledCopy } from "./settlementCopy";

// Receipt model (TASKS T-043; PAYPAL_INTEGRATION.md §9). Pure. Shown identically to staff and renter.
// Wording comes from settlementCopy (evidence-based); statuses are exactly what PayPal returned.

/** Verified webhook event types that confirm each operation's PayPal object (sandbox E7 names). */
const CONFIRMING: Record<SettlementOpKind, string> = {
  CAPTURE: "PAYMENT.CAPTURE.COMPLETED",
  VOID: "PAYMENT.AUTHORIZATION.VOIDED",
  REFUND: "PAYMENT.CAPTURE.REFUNDED",
};
const ORDER: Record<SettlementOpKind, number> = { CAPTURE: 0, VOID: 1, REFUND: 2 };

export interface ReceiptOp {
  op: SettlementOpKind;
  label: string;
  amountCents?: Cents;
  status: SettlementRecord["status"];
  paypalObjectId?: string;
  paypalStatus?: string;
  /** A verified PayPal webhook confirmed this object. */
  paypalConfirmed: boolean;
  error?: string;
}

export interface Receipt {
  state: "SETTLED" | "FAILED" | "IN_PROGRESS";
  headline: string;
  depositCents: Cents;
  chargedCents: Cents;
  notChargedCents: Cents;
  ops: ReceiptOp[];
  orderId?: string;
  authorizationId?: string;
  undisputedOnly: boolean;
  capturePending: boolean;
}

export function buildReceipt({ rental, records, events, cleanReturn = false }: { rental: Rental; records: SettlementRecord[]; events: TimelineEvent[]; cleanReturn?: boolean }): Receipt {
  const verified = events
    .filter((e) => e.type === "PAYPAL_WEBHOOK_VERIFIED")
    .map((e) => ({ type: e.data.eventType, resourceId: e.data.resourceId }));
  const ops = [...records]
    .filter((r) => r.rentalId === rental.id)
    .sort((a, b) => ORDER[a.op] - ORDER[b.op])
    .map((r): ReceiptOp => ({
      op: r.op,
      label: r.op === "VOID" ? "Void authorization" : `${r.op === "CAPTURE" ? "Capture" : "Refund"} ${formatUsd(r.amountCents ?? 0)}`,
      ...(r.amountCents !== undefined ? { amountCents: r.amountCents } : {}),
      status: r.status,
      ...(r.paypalObjectId ? { paypalObjectId: r.paypalObjectId } : {}),
      ...(r.paypalStatus ? { paypalStatus: r.paypalStatus } : {}),
      paypalConfirmed: r.status === "SUCCEEDED" && !!r.paypalObjectId && verified.some((v) => v.resourceId === r.paypalObjectId && v.type === CONFIRMING[r.op]),
      ...(r.error ? { error: r.error } : {}),
    }));

  const captured = rental.paypal.captures.reduce((s, c) => s + c.amountCents, 0);
  const refunded = rental.paypal.refunds.reduce((s, r) => s + r.amountCents, 0);
  const chargedCents = captured - refunded;
  const capturePending = rental.paypal.captures.some((c) => c.status === "PENDING");
  const deduction = rental.approvedDeductionCents ?? 0;

  let state: Receipt["state"] = "IN_PROGRESS";
  let headline = "Settlement in progress";
  if (rental.status === "SETTLED") {
    state = "SETTLED";
    headline = capturePending ? `${CAPTURE_PENDING_COPY} (${formatUsd(deduction)})` : settledCopy({ mode: rental.settlementMode, depositCents: rental.depositCents, deductionCents: deduction, cleanReturn: cleanReturn && deduction === 0 });
  } else if (rental.status === "SETTLEMENT_FAILED") {
    state = "FAILED";
    headline = "Settlement did not finish. Nothing more happens until the shop retries; a retry checks PayPal first, so it cannot charge twice.";
  }

  return {
    state,
    headline,
    depositCents: rental.depositCents,
    chargedCents,
    notChargedCents: rental.depositCents - chargedCents,
    ops,
    ...(rental.paypal.orderId ? { orderId: rental.paypal.orderId } : {}),
    ...(rental.paypal.authorizationId ? { authorizationId: rental.paypal.authorizationId } : {}),
    undisputedOnly: !!rental.undisputedOnly,
    capturePending,
  };
}
