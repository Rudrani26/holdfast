import "server-only";
import { z } from "zod";

// Response shapes for the fields Holdfast reads, matching recorded sandbox responses
// (src/server/paypal/__fixtures__). Unknown extra fields are allowed and ignored.

export const money = z.object({ currency_code: z.string(), value: z.string() });
export const link = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });

export const order = z.object({
  id: z.string(),
  status: z.string(),
  links: z.array(link).optional(),
});

export const authorization = z.object({
  id: z.string(),
  status: z.string(),
  amount: money,
  expiration_time: z.string().optional(),
  custom_id: z.string().optional(),
});

export const authorizeOrderResponse = z.object({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(z.object({ payments: z.object({ authorizations: z.array(authorization).min(1) }) }))
    .min(1),
});

export const capture = z.object({
  id: z.string(),
  status: z.string(),
  amount: money.optional(),
  final_capture: z.boolean().optional(),
  invoice_id: z.string().optional(),
  custom_id: z.string().optional(),
});

export const refund = z.object({
  id: z.string(),
  status: z.string(),
  amount: money.optional(),
});

/** GET order with its payments (verified in sandbox: captures carry our invoice_id). Used to reconcile. */
export const orderWithPayments = order.extend({
  purchase_units: z
    .array(
      z.object({
        payments: z
          .object({
            authorizations: z.array(authorization).optional(),
            captures: z.array(capture).optional(),
            refunds: z.array(refund).optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

export const verifyWebhookResponse = z.object({
  verification_status: z.enum(["SUCCESS", "FAILURE"]),
});

export const webhookEvent = z.object({
  id: z.string(),
  event_type: z.string(),
  create_time: z.string().optional(),
  resource_type: z.string().optional(),
  resource: z.object({
    id: z.string(),
    status: z.string().optional(),
    custom_id: z.string().optional(),
    invoice_id: z.string().optional(),
    update_time: z.string().optional(),
    supplementary_data: z
      .object({
        related_ids: z
          .object({
            order_id: z.string().optional(),
            authorization_id: z.string().optional(),
            capture_id: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});
export type WebhookEvent = z.infer<typeof webhookEvent>;
