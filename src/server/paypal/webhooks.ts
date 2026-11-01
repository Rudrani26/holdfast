import "server-only";
import type { PayPalClient } from "./client";
import * as s from "./schemas";

// docs/PAYPAL_INTEGRATION.md §7. Verified in sandbox E7: sending the parsed event as `webhook_event`
// verifies SUCCESS. Webhooks confirm; they never drive settlement.

const VERIFY_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export type WebhookVerification =
  | { verified: true; event: s.WebhookEvent }
  | { verified: false; reason: "INVALID_JSON" | "INVALID_EVENT" | "MISSING_HEADERS" | "SIGNATURE_FAILURE"; eventId?: string };

/**
 * Verifies a delivery from its raw body and headers. Missing transmission headers or a body that is
 * not a PayPal event are rejected without calling PayPal.
 */
export async function verifyWebhook(
  client: PayPalClient,
  { rawBody, headers, webhookId }: { rawBody: string; headers: Headers; webhookId: string },
): Promise<WebhookVerification> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { verified: false, reason: "INVALID_JSON" };
  }
  const event = s.webhookEvent.safeParse(json);
  if (!event.success) return { verified: false, reason: "INVALID_EVENT" };

  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(VERIFY_HEADERS)) {
    const value = headers.get(header);
    if (!value) return { verified: false, reason: "MISSING_HEADERS", eventId: event.data.id };
    fields[field] = value;
  }

  const { data } = await client.request({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    requestId: `webhook-verify:${fields.transmission_id}`,
    body: { ...fields, webhook_id: webhookId, webhook_event: json },
    schema: s.verifyWebhookResponse,
  });
  return data?.verification_status === "SUCCESS"
    ? { verified: true, event: event.data }
    : { verified: false, reason: "SIGNATURE_FAILURE", eventId: event.data.id };
}

/**
 * Links an event to a rental (§7 step 5). Sandbox E7 showed every resource carries our custom_id
 * (= rental id); capture/refund resources also carry invoice_id `HF-<rentalId>-<seq>`.
 */
export function eventReferences(event: s.WebhookEvent) {
  const r = event.resource;
  const fromInvoice = r.invoice_id?.match(/^HF-(.+)-\d+$/)?.[1];
  return {
    rentalId: r.custom_id ?? fromInvoice,
    resourceId: r.id,
    resourceStatus: r.status,
    orderId: r.supplementary_data?.related_ids?.order_id,
    authorizationId: r.supplementary_data?.related_ids?.authorization_id,
    /** PayPal's own time for the change; order the timeline by this, not by arrival (E7). */
    resourceTime: r.update_time ?? event.create_time,
  };
}
