import "server-only";
import type { Cents } from "@/domain/types";
import { fromPayPalValue, toPayPalValue } from "@/lib/money";
import type { PayPalClient } from "./client";
import { PayPalUnknownOutcomeError } from "./errors";
import * as s from "./schemas";

// docs/PAYPAL_INTEGRATION.md §5.1–§5.3. The amount always comes from the server (the item's
// deposit), never from the client.

export const orderRequestId = (rentalId: string) => `rental:${rentalId}:create-order`;
export const authorizeRequestId = (rentalId: string) => `rental:${rentalId}:authorize`;

export interface CreatedOrder {
  orderId: string;
  status: string;
  /** Hosted approval link (`payer-action`, else `approve`), if present. */
  approvalUrl?: string;
}

export function depositOrderBody({ rentalId, amountCents, itemName }: { rentalId: string; amountCents: Cents; itemName: string }) {
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: rentalId,
        custom_id: rentalId,
        description: `Security deposit hold — ${itemName} (Holdfast demo)`.slice(0, 127),
        amount: { currency_code: "USD", value: toPayPalValue(amountCents) },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Kestrel Gear Rentals (demo)",
          shipping_preference: "NO_SHIPPING",
          user_action: "CONTINUE",
        },
      },
    },
  };
}

/** Sandbox returns 200 (not the documented 201) on first creation; both are success. */
export async function createDepositOrder(
  client: PayPalClient,
  input: { rentalId: string; amountCents: Cents; itemName: string },
): Promise<CreatedOrder> {
  const { data } = await client.request({
    method: "POST",
    path: "/v2/checkout/orders",
    requestId: orderRequestId(input.rentalId),
    body: depositOrderBody(input),
    schema: s.order,
  });
  if (!data) throw new PayPalUnknownOutcomeError("create order returned no body");
  const links = data.links ?? [];
  const approval = links.find((l) => l.rel === "payer-action") ?? links.find((l) => l.rel === "approve");
  return { orderId: data.id, status: data.status, approvalUrl: approval?.href };
}

export interface AuthorizedOrder {
  orderId: string;
  orderStatus: string;
  authorizationId: string;
  authorizationStatus: string;
  amountCents: Cents;
  expiresAt?: string;
}

export async function authorizeOrder(
  client: PayPalClient,
  { orderId, rentalId }: { orderId: string; rentalId: string },
): Promise<AuthorizedOrder> {
  const { data } = await client.request({
    method: "POST",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    requestId: authorizeRequestId(rentalId),
    body: {},
    schema: s.authorizeOrderResponse,
  });
  if (!data) throw new PayPalUnknownOutcomeError("authorize returned no body");
  const auth = data.purchase_units[0]!.payments.authorizations[0]!;
  return {
    orderId: data.id,
    orderStatus: data.status,
    authorizationId: auth.id,
    authorizationStatus: auth.status,
    amountCents: fromPayPalValue(auth.amount.value),
    expiresAt: auth.expiration_time,
  };
}

export interface OrderPayments {
  authorizations: { id: string; status: string; amountCents: Cents }[];
  captures: { id: string; status: string; amountCents?: Cents; invoiceId?: string; finalCapture?: boolean }[];
  refunds: { id: string; status: string; amountCents?: Cents }[];
}

/** Payments recorded on the order (§5.7). Sandbox-verified: lists captures with their invoice_id. */
export async function getOrderPayments(client: PayPalClient, orderId: string): Promise<OrderPayments> {
  const { data } = await client.request({
    method: "GET",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    schema: s.orderWithPayments,
  });
  if (!data) throw new PayPalUnknownOutcomeError("get order returned no body");
  const p = data.purchase_units[0]!.payments ?? {};
  const cents = (m?: { value: string }) => (m ? fromPayPalValue(m.value) : undefined);
  return {
    authorizations: (p.authorizations ?? []).map((a) => ({ id: a.id, status: a.status, amountCents: fromPayPalValue(a.amount.value) })),
    captures: (p.captures ?? []).map((c) => ({
      id: c.id,
      status: c.status,
      amountCents: cents(c.amount),
      invoiceId: c.invoice_id,
      finalCapture: c.final_capture,
    })),
    refunds: (p.refunds ?? []).map((r) => ({ id: r.id, status: r.status, amountCents: cents(r.amount) })),
  };
}

export async function getOrder(client: PayPalClient, orderId: string) {
  const { data } = await client.request({
    method: "GET",
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    schema: s.order,
  });
  if (!data) throw new PayPalUnknownOutcomeError("get order returned no body");
  return { orderId: data.id, status: data.status };
}
