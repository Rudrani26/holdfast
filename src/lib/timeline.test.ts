import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Timeline } from "@/components/Timeline";
import type { TimelineEvent } from "@/domain/types";
import { buildTimeline } from "./timeline";

// Event shapes as written by booking.ts, settlement.ts and webhookIntake.ts; ids from the live
// T-022 sandbox settlement (rental r_31785f9f37166d4ca7a3).
const AUTH = "66L51265P76976324";
const CAPTURE = "58Y58368RS476592N";

const ev = (id: string, at: string, type: string, data: Record<string, unknown> = {}, actor: TimelineEvent["actor"] = "PAYPAL"): TimelineEvent => ({
  id,
  at,
  actor,
  type,
  summary: `${type} summary`,
  data,
});

const events: TimelineEvent[] = [
  ev("settle-1-void", "2026-10-28T05:25:28.754Z", "SETTLEMENT_OP_SUCCEEDED", { op: "VOID", paypalObjectId: AUTH, status: "VOIDED" }),
  ev("deposit-authorized", "2026-10-28T05:14:32.902Z", "DEPOSIT_AUTHORIZED", { orderId: "20661728UE870082F", authorizationId: AUTH, status: "CREATED" }),
  ev("settle-1-capture", "2026-10-28T05:25:27.009Z", "SETTLEMENT_OP_SUCCEEDED", { op: "CAPTURE", paypalObjectId: CAPTURE, status: "COMPLETED", amountCents: 1200 }),
  // Webhooks arrive late; they are dated by PayPal's resource time (no milliseconds).
  ev("webhook-WH-A", "2026-10-28T05:25:28Z", "PAYPAL_WEBHOOK_VERIFIED", { eventId: "WH-A1B2C3D4", eventType: "PAYMENT.CAPTURE.COMPLETED", resourceId: CAPTURE, status: "COMPLETED" }),
  ev("webhook-WH-B", "2026-10-28T05:14:33Z", "PAYPAL_WEBHOOK_VERIFIED", { eventId: "WH-E5F6G7H8", eventType: "PAYMENT.AUTHORIZATION.CREATED", resourceId: AUTH, status: "CREATED" }),
  ev("rental-created", "2026-10-28T05:12:43.454Z", "RENTAL_CREATED", { itemId: "backpack", days: 3 }, "RENTER"),
];

describe("buildTimeline", () => {
  const items = buildTimeline(events);

  it("orders chronologically by parsed time, mixing millisecond and second precision", () => {
    expect(items.map((i) => i.id)).toEqual([
      "rental-created",
      "deposit-authorized",
      "webhook-WH-B",
      "settle-1-capture",
      "webhook-WH-A",
      "settle-1-void",
    ]);
  });

  it("marks results confirmed only by a verified webhook of the matching type and object", () => {
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by("deposit-authorized").paypalConfirmed).toBe(true);
    expect(by("settle-1-capture").paypalConfirmed).toBe(true);
    // AUTHORIZATION.CREATED names the same authorization, but only AUTHORIZATION.VOIDED confirms a void.
    expect(by("settle-1-void").paypalConfirmed).toBe(false);
    expect(by("rental-created").paypalConfirmed).toBeUndefined();
  });

  it("lists PayPal ids once each, with labels, and the PayPal status", () => {
    const voidItem = items.find((i) => i.id === "settle-1-void")!;
    expect(voidItem.paypalIds).toEqual([{ label: "PayPal object", value: AUTH }]);
    expect(voidItem.status).toBe("VOIDED");
    expect(items.find((i) => i.id === "deposit-authorized")!.paypalIds.map((x) => x.label)).toEqual(["Order", "Authorization"]);
  });
});

describe("no secrets rendered", () => {
  const poisoned = ev("deposit-authorized", "2026-10-28T05:14:32.902Z", "DEPOSIT_AUTHORIZED", {
    authorizationId: AUTH,
    status: "CREATED",
    access_token: "A21AAsecret-access-token-value",
    clientSecret: "EK-client-secret-value",
    payerEmail: "buyer-personal@example.com",
    orderId: "<script>alert(1)</script>",
  });

  it("renders only allowlisted fields", () => {
    const html = renderToStaticMarkup(createElement(Timeline, { events: [poisoned] }));
    expect(html).toContain(AUTH);
    expect(html).toContain("DEPOSIT_AUTHORIZED summary");
    for (const leaked of ["A21AAsecret", "client-secret-value", "buyer-personal@example.com", "<script>", "alert(1)"]) {
      expect(html).not.toContain(leaked);
    }
  });

  it("drops a status that is not a PayPal status word", () => {
    const [item] = buildTimeline([{ ...poisoned, data: { status: "token=abc123" } }]);
    expect(item!.status).toBeUndefined();
  });

  it("shows an empty state", () => {
    expect(renderToStaticMarkup(createElement(Timeline, { events: [] }))).toContain("No events yet.");
  });
});
