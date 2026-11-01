/**
 * Settlement executor tests. PayPal replies are RECORDED SANDBOX RESPONSES from spike run E1 (partial
 * capture $38 → void on authorization 5TN13229TB9978039), so the rental below reuses E1's ids.
 * Timeouts, 5xx and "not captured yet" order reads are simulated and labelled so.
 */
import { describe, expect, it } from "vitest";
import { DomainError, type Rental, type SettlementRecord } from "@/domain/types";
import { fakePayPal, fixture, type Reply } from "./paypal/__fixtures__/fakePayPal";
import { MemoryRepo } from "./repo/memory";
import { cancelRental, LEASE_MS, settleRental, type SettlementDeps } from "./settlement";

const RENTAL_ID = "E1-20261027T223018Z"; // invoice HF-E1-20261027T223018Z-1 in the recorded capture
const ORDER_ID = "3M713225W46152355";
const AUTH_ID = "5TN13229TB9978039";
const CAPTURE_ID = "5B211957T5969872L";

const ready = (over: Partial<Rental> = {}): Rental => ({
  id: RENTAL_ID,
  itemId: "headphones",
  renter: { name: "Ada Renter", email: "ada@example.com" },
  days: 2,
  depositCents: 20000,
  status: "READY_TO_SETTLE",
  paymentState: "AUTHORIZED",
  paypal: { orderId: ORDER_ID, authorizationId: AUTH_ID, authStatus: "CREATED", captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  staffConfirmedAt: "2026-10-28T09:00:00.000Z",
  renterDecisionAt: "2026-10-28T09:05:00.000Z",
  approvedDeductionCents: 3800,
  contestRound: 0,
  createdAt: "2026-10-28T08:00:00.000Z",
  updatedAt: "2026-10-28T09:05:00.000Z",
  version: 5,
  ...over,
});

async function setup(replies: Reply[], rental: Rental = ready(), gate?: () => Promise<void>) {
  const repo = new MemoryRepo();
  await repo.createRental(rental);
  const pp = fakePayPal(replies, { gate });
  let t = Date.parse("2026-10-28T10:00:00.000Z");
  const slept: number[] = [];
  const deps: SettlementDeps = {
    repo,
    paypal: pp.client,
    now: () => new Date((t += 1000)),
    sleep: async (ms) => void slept.push(ms),
  };
  return { repo, pp, deps, slept };
}

const posts = (pp: ReturnType<typeof fakePayPal>, suffix: string) =>
  pp.api().filter((s) => s.method === "POST" && s.url.endsWith(suffix));

/** The recorded order read with no captures and the authorization still CREATED (simulated "not yet"). */
function orderNotCaptured(): Reply {
  const f = structuredClone(fixture("get-order-captured-voided")) as {
    status: number;
    body: { purchase_units: { payments: { captures?: unknown[]; authorizations: { status: string }[] } }[] };
  };
  delete f.body.purchase_units[0]!.payments.captures;
  f.body.purchase_units[0]!.payments.authorizations[0]!.status = "CREATED";
  return f;
}

async function rejects(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

describe("settleRental — PARTIAL_CAPTURE_THEN_VOID (recorded sandbox E1)", () => {
  it("captures the approved $38 (non-final), voids the rest, and marks the rental SETTLED", async () => {
    const { repo, pp, deps } = await setup([fixture("capture-partial"), fixture("void")]);
    const out = await settleRental(deps, RENTAL_ID);
    expect(out.ok).toBe(true);

    const [capture, voidCall] = pp.api();
    expect(capture!.url).toContain(`/v2/payments/authorizations/${AUTH_ID}/capture`);
    expect(capture!.headers["paypal-request-id"]).toBe(`settle:${RENTAL_ID}:1:capture`);
    expect(JSON.parse(capture!.body!)).toMatchObject({
      amount: { currency_code: "USD", value: "38.00" },
      final_capture: false,
      invoice_id: `HF-${RENTAL_ID}-1`,
    });
    expect(voidCall!.url).toContain(`/authorizations/${AUTH_ID}/void`);
    expect(voidCall!.headers["paypal-request-id"]).toBe(`settle:${RENTAL_ID}:1:void`);

    const rental = (await repo.getRental(RENTAL_ID))!;
    expect(rental).toMatchObject({
      status: "SETTLED",
      paymentState: "VOIDED_REMAINDER",
      paypal: { captures: [{ id: CAPTURE_ID, amountCents: 3800, status: "COMPLETED" }], voided: true, authStatus: "VOIDED" },
    });
    expect(out.records.map((r) => [r.op, r.status, r.paypalObjectId, r.attempts])).toEqual([
      ["CAPTURE", "SUCCEEDED", CAPTURE_ID, 1],
      ["VOID", "SUCCEEDED", AUTH_ID, 1],
    ]);
    const settled = (await repo.listEvents(RENTAL_ID)).find((e) => e.type === "SETTLED")!;
    expect(settled.summary).toBe("$38.00 captured · remaining $162.00 authorization voided");
  });

  it("is idempotent: settling a SETTLED rental makes no PayPal call", async () => {
    const { pp, deps } = await setup([fixture("capture-partial"), fixture("void")]);
    await settleRental(deps, RENTAL_ID);
    const again = await settleRental(deps, RENTAL_ID);
    expect(again.ok).toBe(true);
    expect(pp.api()).toHaveLength(2);
  });

  it("$0 deduction → void only", async () => {
    const { repo, pp, deps } = await setup([fixture("void")], ready({ approvedDeductionCents: 0 }));
    expect((await settleRental(deps, RENTAL_ID)).ok).toBe(true);
    expect(pp.api().map((s) => s.url.split("/").at(-1))).toEqual(["void"]);
    const rental = (await repo.getRental(RENTAL_ID))!;
    expect(rental).toMatchObject({ status: "SETTLED", paymentState: "VOIDED" });
    expect((await repo.listEvents(RENTAL_ID)).find((e) => e.type === "SETTLED")!.summary).toBe("$0 charged · deposit authorization voided");
  });

  it("$0 after a NO_NEW_DAMAGE return says so, matching the receipt", async () => {
    const { repo, deps } = await setup([fixture("void")], ready({ approvedDeductionCents: 0 }));
    await repo.putInspection(RENTAL_ID, { id: "return-1", kind: "RETURN", model: "m", promptVersion: "p", mode: "LIVE", status: "OK", perAngle: [], verdict: "NO_NEW_DAMAGE", createdAt: "2026-10-28T09:00:00.000Z" });
    await settleRental(deps, RENTAL_ID);
    expect((await repo.listEvents(RENTAL_ID)).find((e) => e.type === "SETTLED")!.summary).toBe("No new damage detected · $0 charged · deposit authorization voided");
  });

  it("refuses to settle without staff confirmation and renter acceptance", async () => {
    const a = await setup([], ready({ status: "AWAITING_RENTER" }));
    await rejects(settleRental(a.deps, RENTAL_ID), "NOT_READY_TO_SETTLE");
    const b = await setup([], ready({ renterDecisionAt: undefined }));
    await rejects(settleRental(b.deps, RENTAL_ID), "RENTER_ACCEPTANCE_REQUIRED");
    expect([...a.pp.api(), ...b.pp.api()]).toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("two simultaneous settle calls run one op set", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { repo, pp, deps } = await setup([fixture("capture-partial"), fixture("void")], ready(), () => held);

    const settled = Promise.allSettled([settleRental(deps, RENTAL_ID), settleRental(deps, RENTAL_ID)]);
    await new Promise((r) => setTimeout(r, 20)); // both calls are now past their claim
    release();
    const results = await settled;

    expect(posts(pp, "/capture")).toHaveLength(1);
    expect(posts(pp, "/void")).toHaveLength(1);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as DomainError).code).toBe("SETTLEMENT_IN_PROGRESS");
    expect((await repo.getRental(RENTAL_ID))!.status).toBe("SETTLED");
  });
});

describe("unknown outcome → reconciliation (§6.3)", () => {
  it("timeout on capture, then the order shows our capture → recorded without a second capture POST", async () => {
    const { repo, pp, deps, slept } = await setup([
      new TypeError("simulated network timeout"),
      fixture("get-order-captured-voided"), // recorded: capture with invoice HF-E1-…-1
      fixture("void"),
    ]);
    const out = await settleRental(deps, RENTAL_ID);
    expect(out.ok).toBe(true);
    expect(pp.api().map((s) => `${s.method} ${s.url.split("/v2/")[1]}`)).toEqual([
      `POST payments/authorizations/${AUTH_ID}/capture`,
      `GET checkout/orders/${ORDER_ID}`,
      `POST payments/authorizations/${AUTH_ID}/void`,
    ]);
    expect(slept).toEqual([1000]);
    const capture = out.records.find((r) => r.op === "CAPTURE")!;
    expect(capture).toMatchObject({ status: "SUCCEEDED", paypalObjectId: CAPTURE_ID, attempts: 2 });
    const event = (await repo.listEvents(RENTAL_ID)).find((e) => e.id === "settle-1-capture")!;
    expect(event.summary).toContain("confirmed by reconciliation");
  });

  it("timeout, order shows no capture yet → retries with the SAME request id", async () => {
    const { pp, deps } = await setup([new TypeError("simulated network timeout"), orderNotCaptured(), fixture("capture-partial"), fixture("void")]);
    expect((await settleRental(deps, RENTAL_ID)).ok).toBe(true);
    const captures = posts(pp, "/capture");
    expect(captures).toHaveLength(2);
    expect(new Set(captures.map((c) => c.headers["paypal-request-id"]))).toEqual(new Set([`settle:${RENTAL_ID}:1:capture`]));
  });

  it("3 unknown outcomes → SETTLEMENT_FAILED with the lock FAILED (simulated 503s)", async () => {
    const { repo, deps, slept } = await setup([{ status: 503, raw: "" }, { status: 503, raw: "" }, { status: 503, raw: "" }]);
    const out = await settleRental(deps, RENTAL_ID);
    expect(out.ok).toBe(false);
    expect(out.ok || out.error.code).toBe("PAYPAL_OUTCOME_UNKNOWN");
    expect(slept).toEqual([1000, 3000]);
    expect((await repo.getRental(RENTAL_ID))!.status).toBe("SETTLEMENT_FAILED");
    expect(await repo.getSettlement(`settle:${RENTAL_ID}:1:capture`)).toMatchObject({ status: "FAILED", attempts: 3 });
  });

  it("takes over a stale PENDING lock by reconciling first", async () => {
    const { repo, pp, deps } = await setup([fixture("get-order-captured-voided"), fixture("void")]);
    const stale: SettlementRecord = {
      idempotencyKey: `settle:${RENTAL_ID}:1:capture`,
      rentalId: RENTAL_ID,
      op: "CAPTURE",
      amountCents: 3800,
      requestId: `settle:${RENTAL_ID}:1:capture`,
      status: "PENDING",
      attempts: 1,
      createdAt: "2026-10-28T09:00:00.000Z",
      updatedAt: new Date(Date.parse("2026-10-28T10:00:00.000Z") - LEASE_MS - 1).toISOString(),
    };
    await repo.runTransaction(async (tx) => {
      await tx.getSettlement(stale.idempotencyKey);
      tx.putSettlement(stale);
    });
    expect((await settleRental(deps, RENTAL_ID)).ok).toBe(true);
    expect(posts(pp, "/capture")).toHaveLength(0);
    expect(pp.api()[0]!.method).toBe("GET");
  });
});

describe("failure and retry", () => {
  it("a PayPal rejection fails the rental; Settle again retries only the failed op, reconciling first", async () => {
    const { repo, pp, deps } = await setup([
      fixture("capture-partial"),
      fixture("void-previously-captured"), // recorded 422 (E2), standing in for a rejected void
    ]);
    const first = await settleRental(deps, RENTAL_ID);
    expect(first.ok).toBe(false);
    expect(first.ok || first.error.message).toContain("already captured as final");
    expect((await repo.getRental(RENTAL_ID))!).toMatchObject({ status: "SETTLEMENT_FAILED", paymentState: "PARTIALLY_CAPTURED" });
    expect(first.records.map((r) => [r.op, r.status])).toEqual([
      ["CAPTURE", "SUCCEEDED"],
      ["VOID", "FAILED"],
    ]);

    pp.replies.push(fixture("get-order-captured-voided")); // recorded: authorization VOIDED
    const retry = await settleRental(deps, RENTAL_ID);
    expect(retry.ok).toBe(true);
    expect(posts(pp, "/capture")).toHaveLength(1);
    expect(posts(pp, "/void")).toHaveLength(1);
    const rental = (await repo.getRental(RENTAL_ID))!;
    expect(rental).toMatchObject({ status: "SETTLED", paymentState: "VOIDED_REMAINDER" });
    expect((await repo.listEvents(RENTAL_ID)).map((e) => e.type)).toContain("SETTLEMENT_RETRY");
  });
});

describe("cancelRental", () => {
  it("voids an AUTHORIZED rental's authorization and cancels it", async () => {
    const { repo, pp, deps } = await setup([fixture("void")], ready({ status: "AUTHORIZED", approvedDeductionCents: undefined }));
    expect((await cancelRental(deps, RENTAL_ID)).ok).toBe(true);
    expect(pp.api()).toHaveLength(1);
    expect((await repo.getRental(RENTAL_ID))!).toMatchObject({ status: "CANCELLED", paymentState: "VOIDED", paypal: { voided: true } });
    expect(await cancelRental(deps, RENTAL_ID)).toMatchObject({ ok: true });
    expect(pp.api()).toHaveLength(1);
  });

  it("refuses to cancel once the rental is past check-out", async () => {
    const { deps } = await setup([]);
    await rejects(cancelRental(deps, RENTAL_ID), "INVALID_TRANSITION");
  });
});
