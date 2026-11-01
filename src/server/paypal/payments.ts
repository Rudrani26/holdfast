import "server-only";
import type { Cents, SettlementOpKind } from "@/domain/types";
import { fromPayPalValue, toPayPalValue } from "@/lib/money";
import type { PayPalClient } from "./client";
import { PayPalUnknownOutcomeError } from "./errors";
import * as s from "./schemas";

// docs/PAYPAL_INTEGRATION.md §5.4–§5.7. Every write carries the settlement idempotency key as its
// PayPal-Request-Id; the same key is our Firestore settlement lock (§6).

/** `settle:<rentalId>:<seq>:<op>` — deterministic per rental, settlement round and operation. */
export function settlementRequestId(rentalId: string, seq: number, op: SettlementOpKind): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("settlement sequence must be a positive integer");
  return `settle:${rentalId}:${seq}:${op.toLowerCase()}`;
}

/** `HF-<rentalId>-<seq>`: unique per capture (duplicates are rejected with DUPLICATE_INVOICE_ID). */
export const invoiceId = (rentalId: string, seq: number) => `HF-${rentalId}-${seq}`;

const cents = (m?: { value: string }) => (m ? fromPayPalValue(m.value) : undefined);
const enc = encodeURIComponent;

export interface PaymentObject {
  id: string;
  status: string;
  amountCents?: Cents;
}

function required<T>(data: T | undefined, what: string): T {
  if (!data) throw new PayPalUnknownOutcomeError(`${what} returned no body`);
  return data;
}

export async function captureAuthorization(
  client: PayPalClient,
  input: {
    authorizationId: string;
    amountCents: Cents;
    finalCapture: boolean;
    invoiceId: string;
    requestId: string;
    mockCode?: string;
  },
): Promise<PaymentObject & { finalCapture?: boolean; replayed: boolean }> {
  const { status, data } = await client.request({
    method: "POST",
    path: `/v2/payments/authorizations/${enc(input.authorizationId)}/capture`,
    requestId: input.requestId,
    mockCode: input.mockCode,
    body: {
      amount: { currency_code: "USD", value: toPayPalValue(input.amountCents) },
      final_capture: input.finalCapture,
      invoice_id: input.invoiceId,
      note_to_payer: "Holdfast deposit settlement: approved damage charges only.",
      soft_descriptor: "HOLDFAST",
    },
    schema: s.capture,
  });
  const c = required(data, "capture");
  // Sandbox E5: the original capture returns 201; a replay with the same request id returns 200.
  return { id: c.id, status: c.status, amountCents: cents(c.amount), finalCapture: c.final_capture, replayed: status === 200 };
}

/** Void the authorization (empty body). Sandbox returns 200 + the authorization (`VOIDED`). */
export async function voidAuthorization(
  client: PayPalClient,
  input: { authorizationId: string; requestId: string },
): Promise<{ status?: string }> {
  const { data } = await client.request({
    method: "POST",
    path: `/v2/payments/authorizations/${enc(input.authorizationId)}/void`,
    requestId: input.requestId,
    schema: s.authorization,
  });
  return { status: data?.status }; // a 204 (no body) is also success
}

export async function refundCapture(
  client: PayPalClient,
  input: { captureId: string; amountCents: Cents; requestId: string },
): Promise<PaymentObject> {
  const { data } = await client.request({
    method: "POST",
    path: `/v2/payments/captures/${enc(input.captureId)}/refund`,
    requestId: input.requestId,
    body: {
      amount: { currency_code: "USD", value: toPayPalValue(input.amountCents) },
      note_to_payer: "Holdfast: unused deposit returned",
    },
    schema: s.refund,
  });
  const r = required(data, "refund");
  return { id: r.id, status: r.status, amountCents: cents(r.amount) };
}

export async function getAuthorization(client: PayPalClient, authorizationId: string) {
  const { data } = await client.request({
    method: "GET",
    path: `/v2/payments/authorizations/${enc(authorizationId)}`,
    schema: s.authorization,
  });
  const a = required(data, "get authorization");
  return { id: a.id, status: a.status, amountCents: fromPayPalValue(a.amount.value), expiresAt: a.expiration_time };
}

export async function getCapture(client: PayPalClient, captureId: string): Promise<PaymentObject> {
  const { data } = await client.request({ method: "GET", path: `/v2/payments/captures/${enc(captureId)}`, schema: s.capture });
  const c = required(data, "get capture");
  return { id: c.id, status: c.status, amountCents: cents(c.amount) };
}

export async function getRefund(client: PayPalClient, refundId: string): Promise<PaymentObject> {
  const { data } = await client.request({ method: "GET", path: `/v2/payments/refunds/${enc(refundId)}`, schema: s.refund });
  const r = required(data, "get refund");
  return { id: r.id, status: r.status, amountCents: cents(r.amount) };
}
