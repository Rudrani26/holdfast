import { describe, expect, it } from "vitest";
import { plan } from "./settlementPlanner";
import { DomainError, SETTLEMENT_MODES } from "./types";

const H = 20000;

describe("plan (PAYPAL_INTEGRATION.md §3)", () => {
  it.each(SETTLEMENT_MODES)("%s: D = 0 → void only", (mode) => {
    expect(plan(mode, H, 0)).toEqual([{ op: "VOID" }]);
  });

  it.each(SETTLEMENT_MODES)("%s: D = H → single final capture of H", (mode) => {
    expect(plan(mode, H, H)).toEqual([{ op: "CAPTURE", amountCents: H, finalCapture: true }]);
  });

  it("PARTIAL_CAPTURE_THEN_VOID: capture D non-final, then void", () => {
    expect(plan("PARTIAL_CAPTURE_THEN_VOID", H, 3800)).toEqual([
      { op: "CAPTURE", amountCents: 3800, finalCapture: false },
      { op: "VOID" },
    ]);
  });

  it("PARTIAL_CAPTURE_FINAL: capture D as final", () => {
    expect(plan("PARTIAL_CAPTURE_FINAL", H, 3800)).toEqual([{ op: "CAPTURE", amountCents: 3800, finalCapture: true }]);
  });

  it("CAPTURE_THEN_REFUND: capture H, refund H − D", () => {
    expect(plan("CAPTURE_THEN_REFUND", H, 3800)).toEqual([
      { op: "CAPTURE", amountCents: H, finalCapture: true },
      { op: "REFUND", amountCents: 16200 },
    ]);
  });

  it("1 cent edge cases stay exact", () => {
    expect(plan("PARTIAL_CAPTURE_THEN_VOID", H, 1)[0]).toEqual({ op: "CAPTURE", amountCents: 1, finalCapture: false });
    expect(plan("CAPTURE_THEN_REFUND", H, H - 1)[1]).toEqual({ op: "REFUND", amountCents: 1 });
  });

  it("captured + refunded always nets to D, and never exceeds H", () => {
    for (const mode of SETTLEMENT_MODES) {
      for (const d of [0, 1, 3800, 19999, H]) {
        const ops = plan(mode, H, d);
        const captured = ops.reduce((s, o) => s + (o.op === "CAPTURE" ? o.amountCents : 0), 0);
        const refunded = ops.reduce((s, o) => s + (o.op === "REFUND" ? o.amountCents : 0), 0);
        expect(captured - refunded).toBe(d);
        expect(captured).toBeLessThanOrEqual(H);
      }
    }
  });

  it.each([
    [H, -1],
    [H, H + 1],
    [H, 38.5],
    [0, 0],
    [-100, 0],
  ])("rejects deposit %s / deduction %s", (deposit, deduction) => {
    expect(() => plan("PARTIAL_CAPTURE_THEN_VOID", deposit, deduction)).toThrow(DomainError);
  });
});
