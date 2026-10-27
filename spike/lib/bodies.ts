/**
 * Request bodies and response readers for Orders v2 / Payments v2 (docs/PAYPAL_INTEGRATION.md §5).
 * Pure functions, no I/O. Amounts are PayPal strings ("38.00"), already validated by lib/args.ts.
 */

export const CURRENCY = "USD";

export function money(value: string) {
  return { currency_code: CURRENCY, value };
}

/** §5.1 — deposit order with intent AUTHORIZE. */
export function buildCreateOrderBody({
  referenceId,
  amount,
  itemName,
}: {
  referenceId: string;
  amount: string;
  itemName: string;
}) {
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: referenceId,
        custom_id: referenceId,
        description: `Security deposit hold — ${itemName} (Holdfast demo)`,
        amount: money(amount),
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

/** §5.4 — full or partial capture of an authorization. `invoiceId` must be unique per capture. */
export function buildCaptureBody({
  amount,
  finalCapture,
  invoiceId,
}: {
  amount: string;
  finalCapture: boolean;
  invoiceId: string;
}) {
  return {
    amount: money(amount),
    final_capture: finalCapture,
    invoice_id: invoiceId,
    note_to_payer: "Holdfast deposit settlement: approved damage charges only.",
    soft_descriptor: "HOLDFAST",
  };
}

/** §5.6 — partial refund of a capture. */
export function buildRefundBody({ amount }: { amount: string }) {
  return { amount: money(amount), note_to_payer: "Holdfast: unused deposit returned" };
}

type Link = { href?: unknown; rel?: unknown };

/** Buyer approval URL from an order: HATEOAS link `payer-action` (preferred) or `approve`. */
export function approvalLink(order: unknown): string | undefined {
  const links = (order as { links?: unknown } | null)?.links;
  if (!Array.isArray(links)) return undefined;
  for (const rel of ["payer-action", "approve"]) {
    const link = (links as Link[]).find((l) => l?.rel === rel && typeof l.href === "string");
    if (link) return link.href as string;
  }
  return undefined;
}

export interface AuthorizationSummary {
  id: string;
  status?: string;
  amount?: string;
  expirationTime?: string;
}

/** §5.3 — `purchase_units[0].payments.authorizations[0]` from an authorize response. */
export function extractAuthorization(order: unknown): AuthorizationSummary | undefined {
  const auth = (
    order as {
      purchase_units?: { payments?: { authorizations?: Record<string, unknown>[] } }[];
    } | null
  )?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth || typeof auth.id !== "string") return undefined;
  const amount = auth.amount as { value?: unknown } | undefined;
  return {
    id: auth.id,
    status: typeof auth.status === "string" ? auth.status : undefined,
    amount: typeof amount?.value === "string" ? amount.value : undefined,
    expirationTime: typeof auth.expiration_time === "string" ? auth.expiration_time : undefined,
  };
}

/** `id` and `status` of a capture/refund/authorization/order resource, if present. */
export function idAndStatus(json: unknown): { id?: string; status?: string } {
  const r = json as { id?: unknown; status?: unknown } | null;
  return {
    id: typeof r?.id === "string" ? r.id : undefined,
    status: typeof r?.status === "string" ? r.status : undefined,
  };
}

/** One-line summary of a PayPal error body: name, message, `details[].issue`, debug id. */
export function describePayPalError(json: unknown): string {
  const e = json as {
    name?: unknown;
    message?: unknown;
    debug_id?: unknown;
    details?: { issue?: unknown; description?: unknown }[];
    error?: unknown;
    error_description?: unknown;
  } | null;
  if (!e || typeof e !== "object") return "no error body";
  const parts = [String(e.name ?? e.error ?? "UNKNOWN_ERROR")];
  if (e.message ?? e.error_description) parts.push(String(e.message ?? e.error_description));
  const issues = Array.isArray(e.details)
    ? e.details.map((d) => (typeof d?.issue === "string" ? d.issue : undefined)).filter(Boolean)
    : [];
  if (issues.length > 0) parts.push(`issues: ${issues.join(", ")}`);
  if (typeof e.debug_id === "string") parts.push(`debug_id ${e.debug_id}`);
  return parts.join(" — ");
}
