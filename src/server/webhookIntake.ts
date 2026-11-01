import "server-only";
import type { IsoTime } from "@/domain/types";
import type { PayPalClient } from "./paypal/client";
import { PayPalUnknownOutcomeError } from "./paypal/errors";
import { eventReferences, verifyWebhook } from "./paypal/webhooks";
import type { Repo } from "./repo/types";

// PayPal webhook intake (PAYPAL_INTEGRATION.md §7). Webhooks CONFIRM; they never drive settlement or
// change rental/payment state. A verified event adds a PAYPAL_WEBHOOK_VERIFIED timeline entry, dated
// by PayPal's resource time because deliveries arrive late and out of order (sandbox E7).

export interface WebhookDeps {
  repo: Repo;
  paypal: PayPalClient;
  webhookId: string;
  now?: () => Date;
}

export type WebhookOutcome =
  | { status: 200; body: { ok: true; duplicate?: true; rentalId?: string } }
  | { status: 400; body: { error: { code: string; message: string } } }
  | { status: 503; body: { error: { code: string; message: string } } };

const bad = (code: string, message: string): WebhookOutcome => ({ status: 400, body: { error: { code, message } } });

export async function handlePayPalWebhook(deps: WebhookDeps, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const receivedAt: IsoTime = (deps.now?.() ?? new Date()).toISOString();

  let verification;
  try {
    verification = await verifyWebhook(deps.paypal, { rawBody, headers, webhookId: deps.webhookId });
  } catch (e) {
    if (e instanceof PayPalUnknownOutcomeError) {
      // Non-2xx makes PayPal redeliver later, when verification can complete.
      return { status: 503, body: { error: { code: "VERIFY_UNAVAILABLE", message: "Could not verify with PayPal; retry later." } } };
    }
    console.error("webhook verification request rejected", e instanceof Error ? e.message : e);
    verification = { verified: false as const, reason: "SIGNATURE_FAILURE" as const, eventId: undefined };
  }

  if (!verification.verified) {
    const { eventId } = verification;
    if (eventId) {
      // Recorded for the audit trail; never overwrites a verified record, and dedupe ignores it.
      let parsed: { event_type?: unknown; resource?: { id?: unknown } } = {};
      try {
        parsed = JSON.parse(rawBody) as typeof parsed;
      } catch {}
      await deps.repo.runTransaction(async (tx) => {
        if ((await tx.getWebhookEvent(eventId))?.verified) return;
        tx.putWebhookEvent({
          paypalEventId: eventId,
          eventType: String(parsed.event_type ?? "unknown").slice(0, 100),
          resourceId: String(parsed.resource?.id ?? "unknown").slice(0, 100),
          verified: false,
          receivedAt,
        });
      });
    }
    console.warn(`webhook rejected: ${verification.reason}${eventId ? ` (${eventId})` : ""}`);
    return bad("WEBHOOK_NOT_VERIFIED", `Webhook rejected: ${verification.reason}.`);
  }

  const { event } = verification;
  const refs = eventReferences(event);
  return deps.repo.runTransaction(async (tx) => {
    const existing = await tx.getWebhookEvent(event.id);
    if (existing?.verified) return { status: 200, body: { ok: true, duplicate: true, rentalId: existing.rentalId } } as const;
    const rental = refs.rentalId ? await tx.getRental(refs.rentalId) : undefined;

    if (rental) {
      tx.addEvent(rental.id, {
        id: `webhook-${event.id}`,
        at: refs.resourceTime ?? receivedAt,
        actor: "PAYPAL",
        type: "PAYPAL_WEBHOOK_VERIFIED",
        summary: `PayPal confirmed ${event.event_type}${refs.resourceStatus ? ` · ${refs.resourceStatus}` : ""} (verified webhook)`,
        data: {
          eventId: event.id,
          eventType: event.event_type,
          resourceId: refs.resourceId,
          status: refs.resourceStatus,
          orderId: refs.orderId,
          authorizationId: refs.authorizationId,
          receivedAt,
        },
      });
    }
    tx.putWebhookEvent({
      paypalEventId: event.id,
      eventType: event.event_type,
      resourceId: refs.resourceId,
      verified: true,
      ...(rental ? { rentalId: rental.id } : {}),
      receivedAt,
      processedAt: receivedAt,
    });
    return { status: 200, body: { ok: true, ...(rental ? { rentalId: rental.id } : {}) } } as const;
  });
}
