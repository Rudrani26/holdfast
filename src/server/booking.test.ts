/**
 * Booking service tests: MemoryRepo + the real PayPalClient replaying RECORDED SANDBOX RESPONSES
 * (src/server/paypal/__fixtures__). Cases PayPal did not show us in the spike are built from those
 * recordings with one field changed, and labelled "simulated".
 */
import { describe, expect, it } from "vitest";
import type { Item } from "@/domain/types";
import { DomainError } from "@/domain/types";
import { authorizeRental, createOrderForRental, createRental, type BookingDeps } from "./booking";
import { fakePayPal, fixture, type Reply } from "./paypal/__fixtures__/fakePayPal";
import { PayPalUnknownOutcomeError } from "./paypal/errors";
import { MemoryRepo } from "./repo/memory";

const ORDER_ID = "3M713225W46152355"; // id in the create-order and authorize recordings
const AUTH_ID = "5TN13229TB9978039";

const item = (over: Partial<Item> = {}): Item => ({
  id: "headphones",
  name: "Wireless over-ear headphones",
  description: "Wireless over-ear headphones, matte black.",
  imagePath: "items/headphones.jpg",
  depositCents: 20000,
  dailyRateCents: 1800,
  priceListId: "pl-headphones",
  angles: [],
  active: true,
  ...over,
});

async function setup(replies: Reply[] = [], items: Item[] = [item()]) {
  const repo = new MemoryRepo();
  for (const i of items) await repo.putItem(i);
  const pp = fakePayPal(replies);
  const deps: BookingDeps = {
    repo,
    paypal: pp.client,
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    now: () => new Date("2026-10-28T10:00:00.000Z"),
  };
  return { repo, pp, deps };
}

const input = { itemId: "headphones", days: 2 as const, renterName: "Ada Renter", renterEmail: "ada@example.com" };

async function rejects(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

describe("createRental", () => {
  it("creates a DRAFT rental with the deposit from the item and a RENTAL_CREATED event", async () => {
    const { repo, deps } = await setup();
    const rental = await createRental(deps, input);
    expect(rental.id).toMatch(/^r_[0-9a-f]{20}$/);
    const stored = await repo.getRental(rental.id);
    expect(stored).toMatchObject({
      status: "DRAFT",
      paymentState: "NONE",
      depositCents: 20000,
      days: 2,
      renter: { name: "Ada Renter", email: "ada@example.com" },
      settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
      contestRound: 0,
    });
    expect((await repo.listEvents(rental.id)).map((e) => e.type)).toEqual(["RENTAL_CREATED"]);
  });

  it("rejects unknown and inactive items", async () => {
    const { deps } = await setup([], [item({ id: "speaker", active: false })]);
    await rejects(createRental(deps, input), "ITEM_NOT_FOUND");
    await rejects(createRental(deps, { ...input, itemId: "speaker" }), "ITEM_NOT_FOUND");
  });

  it("gives every rental a distinct id", async () => {
    const { deps } = await setup();
    const ids = new Set(await Promise.all([1, 2, 3, 4, 5].map(async () => (await createRental(deps, input)).id)));
    expect(ids.size).toBe(5);
  });
});

describe("createOrderForRental", () => {
  it("creates the order for the server-side deposit and moves the rental to AWAITING_PAYMENT", async () => {
    const { repo, pp, deps } = await setup([fixture("create-order")]);
    const { id } = await createRental(deps, input);
    expect(await createOrderForRental(deps, id)).toEqual({ orderId: ORDER_ID });

    const [call] = pp.api();
    expect(call!.headers["paypal-request-id"]).toBe(`rental:${id}:create-order`);
    const body = JSON.parse(call!.body!) as { intent: string; purchase_units: { custom_id: string; amount: { value: string } }[] };
    expect(body.intent).toBe("AUTHORIZE");
    expect(body.purchase_units[0]).toMatchObject({ custom_id: id, amount: { currency_code: "USD", value: "200.00" } });

    const rental = await repo.getRental(id);
    expect(rental).toMatchObject({ status: "AWAITING_PAYMENT", paymentState: "ORDER_CREATED", paypal: { orderId: ORDER_ID } });
    expect((await repo.listEvents(id)).map((e) => e.type)).toContain("ORDER_CREATED");
  });

  it("returns the existing order on a repeat call without calling PayPal again", async () => {
    const { pp, deps } = await setup([fixture("create-order")]);
    const { id } = await createRental(deps, input);
    await createOrderForRental(deps, id);
    expect(await createOrderForRental(deps, id)).toEqual({ orderId: ORDER_ID });
    expect(pp.api()).toHaveLength(1);
  });

  it("rejects unknown rentals and rentals past payment", async () => {
    const { repo, deps } = await setup();
    await rejects(createOrderForRental(deps, "r_00000000000000000000"), "RENTAL_NOT_FOUND");
    const { id } = await createRental(deps, input);
    await repo.runTransaction(async (tx) => {
      const r = (await tx.getRental(id))!;
      tx.putRental({ ...r, status: "CANCELLED" });
    });
    await rejects(createOrderForRental(deps, id), "RENTAL_NOT_PAYABLE");
  });

  it("leaves the rental unchanged when PayPal's outcome is unknown (simulated 503)", async () => {
    const { repo, deps } = await setup([{ status: 503, raw: "" }]);
    const { id } = await createRental(deps, input);
    await expect(createOrderForRental(deps, id)).rejects.toBeInstanceOf(PayPalUnknownOutcomeError);
    expect((await repo.getRental(id))!.status).toBe("DRAFT");
  });
});

describe("authorizeRental", () => {
  async function ordered(replies: Reply[], items?: Item[]) {
    const s = await setup([fixture("create-order"), ...replies], items);
    const { id } = await createRental(s.deps, { ...input, itemId: (items ?? [item()])[0]!.id });
    await createOrderForRental(s.deps, id);
    return { ...s, id };
  }

  it("authorizes the recorded order and stores the authorization (recorded sandbox response)", async () => {
    const { repo, pp, deps, id } = await ordered([fixture("authorize")]);
    expect(await authorizeRental(deps, { rentalId: id, orderId: ORDER_ID })).toEqual({
      status: "CREATED",
      authorizationId: AUTH_ID,
      expiresAt: "2026-11-25T22:41:33Z",
    });
    expect(pp.api()[1]!.headers["paypal-request-id"]).toBe(`rental:${id}:authorize`);
    const rental = await repo.getRental(id);
    expect(rental).toMatchObject({
      status: "AUTHORIZED",
      paymentState: "AUTHORIZED",
      paypal: { orderId: ORDER_ID, authorizationId: AUTH_ID, authStatus: "CREATED", authExpiresAt: "2026-11-25T22:41:33Z" },
    });
    const events = await repo.listEvents(id);
    expect(events.map((e) => e.type).sort()).toEqual(["DEPOSIT_AUTHORIZED", "ORDER_CREATED", "RENTAL_CREATED"]);
    const authorized = events.find((e) => e.type === "DEPOSIT_AUTHORIZED")!;
    expect(authorized.summary).toBe("$200.00 deposit authorized (hold, not a charge)");
    expect(authorized.data).toMatchObject({ authorizationId: AUTH_ID, amountCents: 20000 });
  });

  it("is idempotent: a repeat call returns the stored authorization without calling PayPal", async () => {
    const { pp, deps, id } = await ordered([fixture("authorize")]);
    const first = await authorizeRental(deps, { rentalId: id, orderId: ORDER_ID });
    expect(await authorizeRental(deps, { rentalId: id, orderId: ORDER_ID })).toEqual(first);
    expect(pp.api()).toHaveLength(2);
  });

  it("rejects an order id that is not this rental's", async () => {
    const { pp, deps, id } = await ordered([]);
    await rejects(authorizeRental(deps, { rentalId: id, orderId: "9XX99999XX9999999" }), "ORDER_MISMATCH");
    expect(pp.api()).toHaveLength(1);
  });

  it("rejects a DRAFT rental that has no order", async () => {
    const { deps } = await setup();
    const { id } = await createRental(deps, input);
    await rejects(authorizeRental(deps, { rentalId: id, orderId: ORDER_ID }), "ORDER_MISMATCH");
  });

  it("does not mark the deposit held when the authorized amount differs from the deposit", async () => {
    // The recording authorizes $200.00; this item's deposit is $120.00.
    const { repo, deps, id } = await ordered([fixture("authorize")], [item({ id: "speaker", depositCents: 12000 })]);
    await rejects(authorizeRental(deps, { rentalId: id, orderId: ORDER_ID }), "AUTHORIZATION_NOT_CREATED");
    const rental = await repo.getRental(id);
    expect(rental).toMatchObject({ status: "AWAITING_PAYMENT", paymentState: "ORDER_CREATED", paypal: { authorizationId: AUTH_ID } });
    expect((await repo.listEvents(id)).map((e) => e.type)).toContain("DEPOSIT_NOT_AUTHORIZED");
  });

  it("does not mark the deposit held for a non-CREATED authorization status (simulated PENDING)", async () => {
    const pending = structuredClone(fixture("authorize")) as { status: number; body: { purchase_units: { payments: { authorizations: { status: string }[] } }[] } };
    pending.body.purchase_units[0]!.payments.authorizations[0]!.status = "PENDING";
    const { repo, deps, id } = await ordered([pending]);
    await rejects(authorizeRental(deps, { rentalId: id, orderId: ORDER_ID }), "AUTHORIZATION_NOT_CREATED");
    expect((await repo.getRental(id))!.status).toBe("AWAITING_PAYMENT");
  });
});
