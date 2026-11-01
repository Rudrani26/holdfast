import "server-only";

/**
 * PayPal error types (docs/PAYPAL_INTEGRATION.md §10). Two kinds matter to callers:
 * - PayPalApiError: PayPal answered and refused (4xx). The operation did not happen; do not retry.
 * - PayPalUnknownOutcomeError: timeout, network failure, 5xx, or an unreadable success body. The
 *   operation may or may not have happened; reconcile with a GET before retrying (§6.3).
 */

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    readonly issues: string[],
    readonly debugId: string | undefined,
    message: string,
  ) {
    super(`PayPal ${status} ${errorName}${issues.length ? ` [${issues.join(", ")}]` : ""}: ${message}`);
    this.name = "PayPalApiError";
  }

  hasIssue(issue: string): boolean {
    return this.issues.includes(issue);
  }
}

export class PayPalUnknownOutcomeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalUnknownOutcomeError";
  }
}

/** Parses a PayPal error body (REST `{name, message, details[], debug_id}` or OAuth `{error, error_description}`). */
export function toApiError(status: number, body: unknown, debugIdHeader?: string): PayPalApiError {
  const b = (body ?? {}) as {
    name?: unknown;
    message?: unknown;
    debug_id?: unknown;
    details?: { issue?: unknown }[];
    error?: unknown;
    error_description?: unknown;
  };
  const issues = Array.isArray(b.details)
    ? b.details.map((d) => d?.issue).filter((i): i is string => typeof i === "string")
    : [];
  return new PayPalApiError(
    status,
    String(b.name ?? b.error ?? `HTTP_${status}`),
    issues,
    typeof b.debug_id === "string" ? b.debug_id : debugIdHeader,
    String(b.message ?? b.error_description ?? "request rejected"),
  );
}

// Only issue codes observed in the sandbox spike (spike/RESULTS.md) get a tailored message.
// Anything else is shown with its raw name and issue codes; we do not guess at undocumented codes.
const STAFF_MESSAGES: Record<string, string> = {
  PREVIOUSLY_CAPTURED:
    "PayPal says this authorization was already captured as final, so the remaining amount cannot be voided.",
  DUPLICATE_INVOICE_ID: "PayPal rejected the capture because its invoice ID was already used.",
};

/** Human message for staff, without secrets. */
export function staffMessage(error: unknown): string {
  if (error instanceof PayPalApiError) {
    const known = error.issues.map((i) => STAFF_MESSAGES[i]).find(Boolean);
    const ref = error.debugId ? ` (PayPal debug id ${error.debugId})` : "";
    return `${known ?? `PayPal rejected the request: ${error.errorName}${error.issues.length ? ` — ${error.issues.join(", ")}` : ""}.`}${ref}`;
  }
  if (error instanceof PayPalUnknownOutcomeError) {
    return "PayPal did not confirm the result. Holdfast will check the payment status before retrying.";
  }
  return "Unexpected error while contacting PayPal.";
}
