import { describe, expect, it } from "vitest";
import type { Rental, SettlementRecord, TimelineEvent } from "@/domain/types";
import { buildReceipt } from "./receipt";

// Shape of the live T-022 sandbox settlement (rental r_31785f9f37166d4ca7a3, $60 hold, $12 captured, rest voided).
const RID = "r_31785f9f37166d4ca7a3";
const AUTH = "66L51265P76976324";
const CAP = "58Y58368RS476592N";

const rental = (over: Partial<Rental> = {}): Rental => ({
  id: RID,
  itemId: "backpack",
  renter: { name: "RC", email: "rc@example.com" },
  days: 3,
  depositCents: 6000,
  status: "SETTLED",
  paymentState: "VOIDED_REMAINDER",
  paypal: { orderId: "20661728UE870082F", authorizationId: AUTH, authStatus: "VOIDED", captures: [{ id: CAP, amountCents: 1200, status: "COMPLETED" }], refunds: [], voided: true },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  approvedDeductionCents: 1200,
  contestRound: 0,
  createdAt: "2026-10-28T05:12:43.454Z",
  updatedAt: "2026-10-28T05:25:29.287Z",
  version: 9,
  ...over,
});
const rec = (op: SettlementRecord["op"], over: Partial<SettlementRecord> = {}): SettlementRecord => ({
  idempotencyKey: `settle:${RID}:1:${op.toLowerCase()}`,
  rentalId: RID,
  op,
  ...(op === "VOID" ? {} : { amountCents: 1200 }),
  requestId: `settle:${RID}:1:${op.toLowerCase()}`,
  status: "SUCCEEDED",
  attempts: 1,
  paypalObjectId: op === "CAPTURE" ? CAP : AUTH,
  paypalStatus: op === "CAPTURE" ? "COMPLETED" : "VOIDED",
  createdAt: "2026-10-28T05:25:27.000Z",
  updatedAt: "2026-10-28T05:25:28.000Z",
  ...over,
});
const webhook = (eventType: string, resourceId: string): TimelineEvent => ({
  id: `webhook-${eventType}`,
  at: "2026-10-28T05:26:00Z",
  actor: "PAYPAL",
  type: "PAYPAL_WEBHOOK_VERIFIED",
  summary: "",
  data: { eventType, resourceId },
});

describe("buildReceipt", () => {
  it("mode A: evidence-based headline, amounts, ops in order with PayPal IDs and raw statuses", () => {
    const r = buildReceipt({ rental: rental(), records: [rec("VOID"), rec("CAPTURE")], events: [] });
    expect(r).toMatchObject({ state: "SETTLED", headline: "$12.00 captured · remaining $48.00 authorization voided", depositCents: 6000, chargedCents: 1200, notChargedCents: 4800, orderId: "20661728UE870082F", authorizationId: AUTH });
    expect(r.ops.map((o) => [o.label, o.paypalObjectId, o.paypalStatus, o.paypalConfirmed])).toEqual([
      ["Capture $12.00", CAP, "COMPLETED", false],
      ["Void authorization", AUTH, "VOIDED", false],
    ]);
  });

  it("PayPal-confirmed only from a verified webhook of the matching type and object", () => {
    const r = buildReceipt({
      rental: rental(),
      records: [rec("CAPTURE"), rec("VOID")],
      events: [webhook("PAYMENT.CAPTURE.COMPLETED", CAP), webhook("PAYMENT.AUTHORIZATION.CREATED", AUTH)],
    });
    expect(r.ops.map((o) => o.paypalConfirmed)).toEqual([true, false]); // CREATED does not confirm the void
    const both = buildReceipt({ rental: rental(), records: [rec("CAPTURE"), rec("VOID")], events: [webhook("PAYMENT.CAPTURE.COMPLETED", CAP), webhook("PAYMENT.AUTHORIZATION.VOIDED", AUTH)] });
    expect(both.ops.every((o) => o.paypalConfirmed)).toBe(true);
  });

  it("clean return: 'No new damage detected · $0 charged · deposit authorization voided'", () => {
    const r = buildReceipt({ rental: rental({ approvedDeductionCents: 0, paymentState: "VOIDED", paypal: { ...rental().paypal, captures: [] } }), records: [rec("VOID")], events: [], cleanReturn: true });
    expect(r).toMatchObject({ headline: "No new damage detected · $0 charged · deposit authorization voided", chargedCents: 0, notChargedCents: 6000 });
  });

  it("pending capture says so, never 'complete'", () => {
    const r = buildReceipt({ rental: rental({ paypal: { ...rental().paypal, captures: [{ id: CAP, amountCents: 1200, status: "PENDING" }] } }), records: [rec("CAPTURE", { paypalStatus: "PENDING" })], events: [] });
    expect(r.headline).toBe("Capture pending at PayPal ($12.00)");
    expect(r.capturePending).toBe(true);
  });

  it("failed settlement shows what succeeded and the failure, without claiming completion", () => {
    const r = buildReceipt({
      rental: rental({ status: "SETTLEMENT_FAILED", paymentState: "PARTIALLY_CAPTURED", paypal: { ...rental().paypal, voided: false, authStatus: "PARTIALLY_CAPTURED" } }),
      records: [rec("CAPTURE"), rec("VOID", { status: "FAILED", paypalObjectId: undefined, paypalStatus: undefined, error: "PayPal rejected the request: UNPROCESSABLE_ENTITY." })],
      events: [],
    });
    expect(r.state).toBe("FAILED");
    expect(r.headline).toMatch(/did not finish/);
    expect(r.ops[1]).toMatchObject({ status: "FAILED", error: "PayPal rejected the request: UNPROCESSABLE_ENTITY.", paypalConfirmed: false });
  });

  it("mode C counts refunds: charged = captured − refunded", () => {
    const r = buildReceipt({
      rental: rental({ settlementMode: "CAPTURE_THEN_REFUND", paypal: { ...rental().paypal, captures: [{ id: CAP, amountCents: 6000, status: "COMPLETED" }], refunds: [{ id: "REF1", amountCents: 4800, status: "COMPLETED" }] } }),
      records: [rec("CAPTURE", { amountCents: 6000 }), rec("REFUND", { amountCents: 4800, paypalObjectId: "REF1", paypalStatus: "COMPLETED" })],
      events: [webhook("PAYMENT.CAPTURE.REFUNDED", "REF1")],
    });
    expect(r).toMatchObject({ headline: "$60.00 captured · $48.00 refunded", chargedCents: 1200, notChargedCents: 4800 });
    expect(r.ops.find((o) => o.op === "REFUND")!.paypalConfirmed).toBe(true);
  });

  it("flags undisputed-only settlements", () => {
    expect(buildReceipt({ rental: rental({ undisputedOnly: true }), records: [], events: [] }).undisputedOnly).toBe(true);
  });
});
