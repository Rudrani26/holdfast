import { describe, expect, it } from "vitest";
import { countCaptures, evaluateIdempotency, evaluateNegative } from "./checks";
import type { PpResponse } from "./paypal";

// Hand-written responses in the documented shape; not recorded sandbox data.
const res = (status: number, json: unknown): PpResponse => ({ status, headers: {}, json });
const order = (captureIds: string[]) =>
  res(200, { purchase_units: [{ payments: { captures: captureIds.map((id) => ({ id })) } }] });

describe("countCaptures", () => {
  it("counts captures, treating a missing list as zero", () => {
    expect(countCaptures(order(["A", "B"]).json)).toBe(2);
    expect(countCaptures({ purchase_units: [{ payments: {} }] })).toBe(0);
    expect(countCaptures({ purchase_units: [{ payments: { captures: "x" } }] })).toBeUndefined();
  });
});

describe("evaluateIdempotency", () => {
  it("passes when both calls return the same capture and one capture is added", () => {
    const checks = evaluateIdempotency(
      res(201, { id: "CAP1", status: "COMPLETED" }),
      res(200, { id: "CAP1", status: "COMPLETED" }),
      order(["CAP1"]),
      0,
    );
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it("fails when the repeat creates a second capture", () => {
    const checks = evaluateIdempotency(
      res(201, { id: "CAP1" }),
      res(201, { id: "CAP2" }),
      order(["CAP1", "CAP2"]),
      0,
    );
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      "same capture id returned",
      "exactly one new capture on the order",
    ]);
  });
});

describe("evaluateNegative", () => {
  const error = res(422, {
    name: "UNPROCESSABLE_ENTITY",
    details: [{ issue: "DUPLICATE_INVOICE_ID", description: "..." }],
  });

  it("passes for a parsed 422 with the issue and no new capture", () => {
    expect(evaluateNegative(error, "DUPLICATE_INVOICE_ID", 1, order(["CAP1"])).every((c) => c.pass)).toBe(true);
  });

  it("fails if the mock was ignored and a capture went through", () => {
    const checks = evaluateNegative(res(201, { id: "CAP2" }), "DUPLICATE_INVOICE_ID", 1, order(["CAP1", "CAP2"]));
    expect(checks.every((c) => !c.pass)).toBe(true);
  });
});
