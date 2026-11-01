import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { DomainError } from "@/domain/types";
import { AuthConfigError, isStaff, STAFF_COOKIE } from "./auth";
import { PayPalApiError, PayPalUnknownOutcomeError } from "./paypal/errors";

/** Error body shape for every API route (docs/ARCHITECTURE.md §5). */
export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

/** For staff routes: a 401/500 response when the request has no valid staff session, else undefined. */
export function requireStaff(request: NextRequest) {
  try {
    if (!isStaff(request.cookies.get(STAFF_COOKIE)?.value)) return apiError(401, "UNAUTHENTICATED", "Staff session required.");
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }
  return undefined;
}

const DOMAIN_STATUS: Record<string, number> = {
  ITEM_NOT_FOUND: 404,
  RENTAL_NOT_FOUND: 404,
  ORDER_MISMATCH: 400,
  RENTAL_NOT_PAYABLE: 409,
  INVALID_TRANSITION: 409,
  RENTAL_EXISTS: 409,
  AUTHORIZATION_NOT_CREATED: 402,
  NOT_READY_TO_SETTLE: 409,
  STAFF_CONFIRMATION_REQUIRED: 409,
  RENTER_ACCEPTANCE_REQUIRED: 409,
  SETTLEMENT_IN_PROGRESS: 409,
  RENTAL_STATE_CHANGED: 409,
  EMPTY_FILE: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE: 415,
  PHASE_NOT_ALLOWED: 400,
  UNKNOWN_ANGLE: 400,
  PHOTO_NOT_ALLOWED_NOW: 409,
  NOT_READY_FOR_BASELINE: 409,
  PHOTOS_MISSING: 409,
  INSPECTION_RUNNING: 409,
  NOT_READY_FOR_RETURN_INSPECTION: 409,
  BASELINE_MISSING: 409,
  PRICE_LIST_MISSING: 500,
  NOT_IN_REVIEW: 409,
  LINE_NOT_FOUND: 404,
  INVALID_OVERRIDE: 400,
  UNKNOWN_PRICE_RULE: 400,
  LINES_UNPRICED: 409,
  DEDUCTION_EXCEEDS_DEPOSIT: 409,
  RENTER_LINK_INVALID: 401,
  NOTHING_TO_ACKNOWLEDGE: 409,
  NOT_AWAITING_DECISION: 409,
  INVALID_DECISION: 400,
  COMMENT_REQUIRED: 400,
  LINES_NOT_DECIDED: 400,
  CONTEST_LIMIT_REACHED: 409,
  NOT_CONTESTED: 409,
  CONTEST_ROUNDS_NOT_EXHAUSTED: 409,
};

/**
 * Maps a thrown error to an API response for renter-facing routes. Unknown errors are logged
 * server-side and answered with a generic 500 (no internals in the response).
 */
export function routeError(e: unknown) {
  if (e instanceof DomainError) return apiError(DOMAIN_STATUS[e.code] ?? 400, e.code, e.message);
  if (e instanceof PayPalApiError) {
    // INSTRUMENT_DECLINED is PayPal's documented authorize/capture decline; the buyer can pick another funding source.
    if (e.hasIssue("INSTRUMENT_DECLINED")) {
      return apiError(402, "INSTRUMENT_DECLINED", "PayPal declined that payment method. Please choose another one.");
    }
    // Observed in sandbox (T-021 smoke test): authorize called before the buyer approved.
    if (e.hasIssue("ORDER_NOT_APPROVED")) {
      return apiError(409, "ORDER_NOT_APPROVED", "The deposit has not been approved in PayPal yet. Please approve it first.");
    }
    console.error("PayPal rejected request", e.message);
    const ref = e.debugId ? ` (PayPal debug id ${e.debugId})` : "";
    return apiError(502, "PAYPAL_REJECTED", `PayPal rejected the request: ${e.errorName}${e.issues.length ? ` — ${e.issues.join(", ")}` : ""}.${ref}`);
  }
  if (e instanceof PayPalUnknownOutcomeError) {
    console.error("PayPal outcome unknown", e.message);
    return apiError(503, "PAYPAL_UNAVAILABLE", "PayPal did not respond in time. It is safe to try again.");
  }
  console.error("Unhandled route error", e);
  return apiError(500, "INTERNAL", "Something went wrong. Please try again.");
}
