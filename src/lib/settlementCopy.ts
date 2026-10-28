/**
 * User-facing settlement wording (docs/PAYPAL_INTEGRATION.md §9), generated from evidence.
 * Rules: never call an authorization void a refund; never say "released" unless the buyer-side
 * effect was proven (E8 buyer view). Wording must match what PayPal actually returned.
 */
import type { Cents, SettlementMode } from "@/domain/types";
import { formatUsd } from "./money";

/**
 * Whether the spike proved the buyer sees the un-captured remainder released, per mode.
 * All false until the owner's E8 buyer-view check (spike/RESULTS.md §5). Flip only with evidence.
 */
export const RELEASE_EVIDENCE: Readonly<Record<SettlementMode, boolean>> = {
  PARTIAL_CAPTURE_THEN_VOID: false,
  PARTIAL_CAPTURE_FINAL: false,
  CAPTURE_THEN_REFUND: false,
};

export function authorizedCopy(depositCents: Cents): string {
  return `${formatUsd(depositCents)} deposit authorized (hold, not a charge)`;
}

export const CAPTURE_PENDING_COPY = "Capture pending at PayPal";

export interface SettledCopyInput {
  mode: SettlementMode;
  depositCents: Cents;
  deductionCents: Cents;
  /** True when the return inspection verdict was NO_NEW_DAMAGE (not just "no charges"). */
  cleanReturn?: boolean;
  evidence?: Readonly<Record<SettlementMode, boolean>>;
}

/** Wording after every planned operation has succeeded. */
export function settledCopy({
  mode,
  depositCents,
  deductionCents,
  cleanReturn = false,
  evidence = RELEASE_EVIDENCE,
}: SettledCopyInput): string {
  const released = evidence[mode];
  const remainder = depositCents - deductionCents;

  if (deductionCents === 0) {
    const tail = released ? "full deposit released" : "deposit authorization voided";
    return cleanReturn ? `No new damage detected · $0 charged · ${tail}` : `$0 charged · ${tail}`;
  }
  if (deductionCents === depositCents) return `${formatUsd(deductionCents)} captured (full deposit)`;

  const charged = formatUsd(deductionCents);
  switch (mode) {
    case "PARTIAL_CAPTURE_THEN_VOID":
      return released
        ? `${charged} captured · remaining ${formatUsd(remainder)} released`
        : `${charged} captured · remaining ${formatUsd(remainder)} authorization voided`;
    case "PARTIAL_CAPTURE_FINAL":
      // Sandbox E2: PayPal reports the whole authorization CAPTURED; say nothing about the remainder
      // unless its release was proven.
      return released
        ? `${charged} captured as final capture · remaining ${formatUsd(remainder)} released`
        : `${charged} captured as final capture`;
    case "CAPTURE_THEN_REFUND":
      return `${formatUsd(depositCents)} captured · ${formatUsd(remainder)} refunded`;
  }
}
