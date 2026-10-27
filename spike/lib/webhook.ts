/**
 * Pure helpers for the spike webhook listener (docs/PAYPAL_INTEGRATION.md §7). No I/O.
 */
import { z } from "zod";

/** verify-webhook-signature body field → PayPal delivery header (Node lowercases header names). */
export const VERIFY_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export type VerifyField = keyof typeof VERIFY_HEADERS;

export type IncomingHeaders = Record<string, string | string[] | undefined>;

export function extractVerificationHeaders(headers: IncomingHeaders): {
  fields: Partial<Record<VerifyField, string>>;
  missing: VerifyField[];
} {
  const fields: Partial<Record<VerifyField, string>> = {};
  const missing: VerifyField[] = [];
  for (const [field, header] of Object.entries(VERIFY_HEADERS) as [VerifyField, string][]) {
    const raw = headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) fields[field] = value;
    else missing.push(field);
  }
  return { fields, missing };
}

/** Body for `POST /v1/notifications/verify-webhook-signature`. */
export function buildVerifyRequest(
  fields: Partial<Record<VerifyField, string>>,
  webhookId: string,
  webhookEvent: unknown,
) {
  return { ...fields, webhook_id: webhookId, webhook_event: webhookEvent };
}

export const verifyResponseSchema = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Record name for an event: `webhook-<eventId>`, or `webhook-unknown-<ms>` when the body has no
 * usable id. PayPal redelivers the same event id on retry, so later deliveries get `-delivery<N>`.
 */
export function eventRecordName(
  event: unknown,
  alreadyRecorded: (name: string) => boolean,
  now: number = Date.now(),
): string {
  const id = (event as { id?: unknown } | null)?.id;
  const base = typeof id === "string" && SAFE_ID.test(id) ? `webhook-${id}` : `webhook-unknown-${now}`;
  if (!alreadyRecorded(base)) return base;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base}-delivery${n}`;
    if (!alreadyRecorded(candidate)) return candidate;
  }
  return `${base}-delivery-${now}`;
}

/** Fields worth printing to the console for one event. Never includes headers or the raw body. */
export function summarizeEvent(event: unknown): { id?: string; eventType?: string; resourceId?: string } {
  const e = event as { id?: unknown; event_type?: unknown; resource?: { id?: unknown } } | null;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { id: str(e?.id), eventType: str(e?.event_type), resourceId: str(e?.resource?.id) };
}
