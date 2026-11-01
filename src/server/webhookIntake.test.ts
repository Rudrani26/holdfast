/**
 * Webhook intake tests. The delivery is a RECORDED SANDBOX WEBHOOK (E7 PAYMENT.CAPTURE.COMPLETED,
 * custom_id spike-E2-20261027T223021Z) with its real transmission headers. PayPal's verification
 * answer is given as recorded in E7 (`SUCCESS`); `FAILURE` and 5xx answers are simulated.
 */
import { describe, expect, it } from "vitest";
import type { Rental } from "@/domain/types";
import { fakePayPal, fixture, type Reply } from "./paypal/__fixtures__/fakePayPal";
import { MemoryRepo } from "./repo/memory";
import { handlePayPalWebhook } from "./webhookIntake";

const delivery = fixture("webhook-capture-completed") as { body: { id: string }; headers: Record<string, string> };
const rawBody = JSON.stringify(delivery.body);
const EVENT_ID = delivery.body.id;
const RENTAL_ID = "spike-E2-20261027T223021Z";
const SUCCESS: Reply = { status: 200, body: { verification_status: "SUCCESS" } };
const FAILURE: Reply = { status: 200, body: { verification_status: "FAILURE" } };

const rental: Rental = {
  id: RENTAL_ID,
  itemId: "headphones",
  renter: { name: "Ada Renter", email: "ada@example.com" },
  days: 2,
  depositCents: 20000,
  status: "SETTLED",
  paymentState: "PARTIALLY_CAPTURED_FINAL",
  paypal: { orderId: "29G10069CE107734B", authorizationId: "8EP712293Y7223943", captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_FINAL",
  contestRound: 0,
  createdAt: "2026-10-27T22:30:00.000Z",
  updatedAt: "2026-10-27T22:43:00.000Z",
  version: 9,
};

async function setup(replies: Reply[], withRental = true) {
  const repo = new MemoryRepo();
  if (withRental) await repo.createRental(rental);
  const pp = fakePayPal(replies);
  const deps = { repo, paypal: pp.client, webhookId: "WH-TEST-ID", now: () => new Date("2026-10-27T22:43:10.000Z") };
  return { repo, pp, deps };
}

describe("handlePayPalWebhook", () => {
  it("verified delivery → 200, timeline event dated by PayPal's resource time, record stored", async () => {
    const { repo, pp, deps } = await setup([SUCCESS]);
    const out = await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    expect(out).toEqual({ status: 200, body: { ok: true, rentalId: RENTAL_ID } });

    const sent = JSON.parse(pp.api()[0]!.body!) as { webhook_id: string; transmission_id: string };
    expect(sent.webhook_id).toBe("WH-TEST-ID");
    expect(sent.transmission_id).toBe(delivery.headers["paypal-transmission-id"]);

    const events = await repo.listEvents(RENTAL_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: `webhook-${EVENT_ID}`,
      at: "2026-10-27T22:42:08Z", // resource.update_time, not arrival
      actor: "PAYPAL",
      type: "PAYPAL_WEBHOOK_VERIFIED",
      summary: "PayPal confirmed PAYMENT.CAPTURE.COMPLETED · COMPLETED (verified webhook)",
      data: { resourceId: "03A84484J18433418", status: "COMPLETED", authorizationId: "8EP712293Y7223943" },
    });
    expect(await repo.getWebhookEvent(EVENT_ID)).toMatchObject({ verified: true, rentalId: RENTAL_ID, eventType: "PAYMENT.CAPTURE.COMPLETED" });
  });

  it("does not change rental or payment state (webhooks confirm, they do not drive)", async () => {
    const { repo, deps } = await setup([SUCCESS]);
    await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    expect(await repo.getRental(RENTAL_ID)).toEqual(rental);
  });

  it("duplicate delivery is processed once", async () => {
    const { repo, deps } = await setup([SUCCESS, SUCCESS]);
    await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    const again = await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    expect(again).toEqual({ status: 200, body: { ok: true, duplicate: true, rentalId: RENTAL_ID } });
    expect(await repo.listEvents(RENTAL_ID)).toHaveLength(1);
  });

  it("unverified (simulated FAILURE) → 400, stored as unverified, no state change", async () => {
    const { repo, deps } = await setup([FAILURE]);
    const out = await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    expect(out.status).toBe(400);
    expect(await repo.listEvents(RENTAL_ID)).toHaveLength(0);
    expect(await repo.getRental(RENTAL_ID)).toEqual(rental);
    expect(await repo.getWebhookEvent(EVENT_ID)).toMatchObject({ verified: false, eventType: "PAYMENT.CAPTURE.COMPLETED" });
  });

  it("a forged unverified copy does not block the real delivery", async () => {
    const { repo, deps } = await setup([FAILURE, SUCCESS]);
    await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    const real = await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers));
    expect(real).toEqual({ status: 200, body: { ok: true, rentalId: RENTAL_ID } });
    expect(await repo.listEvents(RENTAL_ID)).toHaveLength(1);
  });

  it("missing signature headers → 400 without calling PayPal", async () => {
    const { pp, deps } = await setup([]);
    const out = await handlePayPalWebhook(deps, rawBody, new Headers({ "content-type": "application/json" }));
    expect(out.status).toBe(400);
    expect(pp.api()).toHaveLength(0);
  });

  it("not JSON → 400", async () => {
    const { deps } = await setup([]);
    expect((await handlePayPalWebhook(deps, "{nope", new Headers(delivery.headers))).status).toBe(400);
  });

  it("verified event for an unknown rental → 200, recorded without a rental", async () => {
    const { repo, deps } = await setup([SUCCESS], false);
    expect(await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers))).toEqual({ status: 200, body: { ok: true } });
    expect((await repo.getWebhookEvent(EVENT_ID))!.rentalId).toBeUndefined();
  });

  it("verification unavailable (simulated 503) → 503 so PayPal redelivers; nothing stored", async () => {
    const { repo, deps } = await setup([{ status: 503, raw: "" }]);
    expect((await handlePayPalWebhook(deps, rawBody, new Headers(delivery.headers))).status).toBe(503);
    expect(await repo.getWebhookEvent(EVENT_ID)).toBeUndefined();
  });
});
