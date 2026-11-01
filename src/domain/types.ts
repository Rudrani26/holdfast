/**
 * Domain types (docs/ARCHITECTURE.md §3, §4; docs/PAYPAL_INTEGRATION.md §8). Pure: no I/O, no
 * Firestore or SDK types. Money is integer cents; times are ISO-8601 strings at this layer.
 * Enum values are `as const` arrays so Zod schemas elsewhere can be built from the same source.
 */

export type IsoTime = string;
export type Cents = number;

export const DAMAGE_TYPES = [
  "SCRATCH",
  "SCUFF",
  "CRACK",
  "DENT",
  "CHIP",
  "STAIN",
  "TEAR",
  "MISSING_PART",
  "BROKEN_PART",
  "OTHER",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const SEVERITIES = ["MINOR", "MODERATE", "SEVERE"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RENTAL_STATUSES = [
  "DRAFT",
  "AWAITING_PAYMENT",
  "AUTHORIZED",
  "BASELINE_READY",
  "CHECKED_OUT",
  "RETURNED",
  "INSPECTED",
  "AWAITING_RENTER",
  "CONTESTED",
  "READY_TO_SETTLE",
  "SETTLED",
  "SETTLEMENT_FAILED",
  "CANCELLED",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const PAYMENT_STATES = [
  "NONE",
  "ORDER_CREATED",
  "APPROVED",
  "AUTHORIZED",
  "VOIDED",
  "PARTIALLY_CAPTURED",
  "VOIDED_REMAINDER",
  "PARTIALLY_CAPTURED_FINAL",
  "CAPTURED_FULL",
  "PARTIALLY_REFUNDED",
  "ERROR_NEEDS_RECONCILE",
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Chosen from spike evidence (spike/RESULTS.md): PARTIAL_CAPTURE_THEN_VOID. */
export const SETTLEMENT_MODES = [
  "PARTIAL_CAPTURE_THEN_VOID",
  "PARTIAL_CAPTURE_FINAL",
  "CAPTURE_THEN_REFUND",
] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];

export const PHOTO_PHASES = ["CHECKOUT", "CHECKIN", "CONTEST"] as const;
export type PhotoPhase = (typeof PHOTO_PHASES)[number];

export const PROVENANCES = ["LIVE_CAPTURE", "UPLOADED_REAL", "UPLOADED_HYBRID", "UPLOADED_SYNTHETIC"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const INSPECTION_KINDS = ["BASELINE", "RETURN", "RECHECK"] as const;
export type InspectionKind = (typeof INSPECTION_KINDS)[number];

export const INSPECTION_VERDICTS = [
  "NO_NEW_DAMAGE",
  "NO_CHARGES_PROPOSED_REVIEW",
  "DAMAGE_PROPOSED",
  "INCOMPLETE",
] as const;
export type InspectionVerdict = (typeof INSPECTION_VERDICTS)[number];

export const EVENT_ACTORS = ["SYSTEM", "STAFF", "RENTER", "AI", "PAYPAL"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

export const SETTLEMENT_OPS = ["CAPTURE", "VOID", "REFUND"] as const;
export type SettlementOpKind = (typeof SETTLEMENT_OPS)[number];

export interface Angle {
  id: string;
  label: string;
  hint: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  imagePath: string;
  depositCents: Cents;
  dailyRateCents: Cents;
  priceListId: string;
  angles: Angle[];
  active: boolean;
}

export interface PriceRule {
  damageType: DamageType;
  severity: Severity;
  amountCents: Cents;
  label: string;
}

export interface PriceList {
  id: string;
  name: string;
  currency: "USD";
  rules: PriceRule[];
}

export interface PayPalRecord {
  orderId?: string;
  authorizationId?: string;
  authStatus?: string;
  authExpiresAt?: IsoTime;
  captures: { id: string; amountCents: Cents; status: string }[];
  refunds: { id: string; amountCents: Cents; status: string }[];
  voided?: boolean;
}

export interface Rental {
  id: string;
  itemId: string;
  renter: { name: string; email: string };
  days: 1 | 2 | 3;
  depositCents: Cents;
  status: RentalStatus;
  paymentState: PaymentState;
  paypal: PayPalRecord;
  settlementMode: SettlementMode;
  baselineAck?: { at: IsoTime; tokenId: string };
  staffConfirmedAt?: IsoTime;
  renterDecisionAt?: IsoTime;
  approvedDeductionCents?: Cents;
  contestRound: number;
  /** Set when staff settle only undisputed lines after the contest limit (ARCHITECTURE.md §4). */
  undisputedOnly?: boolean;
  createdAt: IsoTime;
  updatedAt: IsoTime;
  version: number;
}

export interface Photo {
  id: string;
  phase: PhotoPhase;
  angleId: string;
  gcsPath: string;
  sha256: string;
  width: number;
  height: number;
  provenance: Provenance;
  createdAt: IsoTime;
}

/** A model finding as stored (AI_PIPELINE.md §5; the Zod schema in src/server/ai is checked against this). */
export interface Finding {
  findingId: string;
  damageType: DamageType;
  severity: Severity;
  box: [number, number, number, number];
  isNew: boolean;
  matchesBaselineMarkId: string | null;
  confidence: number;
  evidence: string;
}

/** A pre-existing mark from the baseline inspection (AI_PIPELINE.md §5 BaselineResult.marks). */
export interface BaselineMark {
  markId: string;
  damageType: DamageType;
  severity: Severity;
  box: [number, number, number, number];
  description: string;
}

export interface Inspection {
  id: string;
  kind: InspectionKind;
  model: string;
  promptVersion: string;
  mode: "LIVE" | "REPLAY";
  status: "OK" | "PARTIAL" | "FAILED";
  perAngle: {
    angleId: string;
    usable: boolean;
    issues: string[];
    latencyMs: number;
    noChangeConfidence?: number;
    rawResponsePath: string;
    findings: Finding[];
    /** BASELINE only: pre-existing marks on the check-out photo. */
    marks?: BaselineMark[];
    /** No schema-valid answer after the retry (or no call possible); staff review this angle. */
    needsHuman?: boolean;
    /** Why the angle needs a human (no secrets; shown to staff). */
    error?: string;
  }[];
  verdict?: InspectionVerdict;
  tokenUsage?: { input: number; output: number };
  createdAt: IsoTime;
}

export interface LineItem {
  id: string;
  source: "AI" | "STAFF";
  inspectionId?: string;
  findingId?: string;
  angleId: string;
  damageType: DamageType;
  severity: Severity;
  label: string;
  amountCents: Cents;
  priceRuleRef?: string;
  overrideReason?: string;
  staffDecision: "INCLUDED" | "EXCLUDED";
  renterDecision?: "ACCEPTED" | "CONTESTED";
  renterComment?: string;
  round: number;
}

export interface TimelineEvent {
  id: string;
  at: IsoTime;
  actor: EventActor;
  type: string;
  summary: string;
  /** PayPal IDs, statuses and similar. Never secrets. */
  data: Record<string, unknown>;
}

export interface SettlementRecord {
  idempotencyKey: string;
  rentalId: string;
  op: SettlementOpKind;
  amountCents?: Cents;
  requestId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  paypalObjectId?: string;
  paypalStatus?: string;
  error?: string;
  createdAt: IsoTime;
  updatedAt: IsoTime;
}

export interface WebhookEventRecord {
  paypalEventId: string;
  eventType: string;
  resourceId: string;
  verified: boolean;
  rentalId?: string;
  receivedAt: IsoTime;
  processedAt?: IsoTime;
}

/** Typed domain failure (ARCHITECTURE.md §8); route handlers map `code` to a 4xx. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
