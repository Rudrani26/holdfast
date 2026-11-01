import "server-only";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type BaselineMark, type InspectionVerdict, type LineItem, type Photo, type Rental, type RentalStatus, type SettlementMode } from "@/domain/types";
import { verifyRenterToken } from "@/lib/authTokens";
import { formatUsd } from "@/lib/money";
import { buildReceipt, type Receipt } from "@/lib/receipt";
import { authSecrets } from "./auth";
import type { Repo } from "./repo/types";

// Renter signed-link access (ARCHITECTURE.md §6; TASKS T-040). A token grants access to its own
// rental only; everything here is scoped to the rental id inside the verified token.

export interface RenterSession {
  rentalId: string;
  tokenId: string;
}

/** Verifies the path token or throws RENTER_LINK_INVALID (no detail about why, to the renter). */
export function renterSession(token: string): RenterSession {
  const check = verifyRenterToken(authSecrets().renterLinkSecret, token);
  if (!check.ok) throw new DomainError("RENTER_LINK_INVALID", "This link is invalid or has expired. Ask the shop for a new one.");
  return { rentalId: check.rentalId, tokenId: check.tokenId };
}

export interface RenterBaselineAngle {
  angleId: string;
  label: string;
  photoUrl?: string;
  marks: Pick<BaselineMark, "markId" | "damageType" | "severity" | "description">[];
}

/** What the renter page may show. No staff notes, no other rentals, no internal ids beyond PayPal's. */
export interface RenterView {
  rentalId: string;
  status: RentalStatus;
  itemName: string;
  renterName: string;
  depositCents: number;
  days: number;
  settlementMode: SettlementMode;
  baselineAckAt?: string;
  baseline?: { inspectionId: string; angles: RenterBaselineAngle[] };
  /** After staff confirmation: the proposed lines and the renter's decisions. */
  report?: RenterReport;
  /** After settlement (or a failed attempt): the same receipt staff see. */
  receipt?: Receipt;
}

const REPORT_STATES: readonly RentalStatus[] = ["AWAITING_RENTER", "CONTESTED", "READY_TO_SETTLE", "SETTLED", "SETTLEMENT_FAILED"];

export async function renterView(repo: Repo, session: RenterSession, token: string): Promise<RenterView> {
  const rental = await repo.getRental(session.rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "This rental no longer exists.");
  const item = await repo.getItem(rental.itemId);
  const [photos, inspections] = await Promise.all([repo.listPhotos(rental.id, "CHECKOUT"), repo.listInspections(rental.id)]);
  const baseline = inspections.filter((i) => i.kind === "BASELINE").at(-1);
  const showBaseline = baseline && rental.status !== "AUTHORIZED" && rental.status !== "DRAFT" && rental.status !== "AWAITING_PAYMENT";
  const report = REPORT_STATES.includes(rental.status) ? await renterReport(repo, rental, token) : undefined;
  let receipt: Receipt | undefined;
  if (rental.status === "SETTLED" || rental.status === "SETTLEMENT_FAILED") {
    const [records, events] = await Promise.all([repo.listSettlements(rental.id), repo.listEvents(rental.id)]);
    const returnVerdict = inspections.filter((i) => i.kind === "RETURN").at(-1)?.verdict;
    receipt = buildReceipt({ rental, records, events, cleanReturn: returnVerdict === "NO_NEW_DAMAGE" });
  }
  return {
    ...(receipt ? { receipt } : {}),
    ...(report ? { report } : {}),
    rentalId: rental.id,
    status: rental.status,
    itemName: item?.name ?? rental.itemId,
    renterName: rental.renter.name,
    depositCents: rental.depositCents,
    days: rental.days,
    settlementMode: rental.settlementMode,
    ...(rental.baselineAck ? { baselineAckAt: rental.baselineAck.at } : {}),
    ...(showBaseline
      ? {
          baseline: {
            inspectionId: baseline.id,
            angles: (item?.angles ?? []).map((a) => {
              const photo = photos.find((p) => p.angleId === a.id);
              return {
                angleId: a.id,
                label: a.label,
                ...(photo ? { photoUrl: `/api/rentals/${rental.id}/photos/${photo.id}?t=${encodeURIComponent(token)}&v=${photo.sha256.slice(0, 12)}` } : {}),
                marks: (baseline.perAngle.find((p) => p.angleId === a.id)?.marks ?? []).map(({ markId, damageType, severity, description }) => ({ markId, damageType, severity, description })),
              };
            }),
          },
        }
      : {}),
  };
}

/** Renter acknowledges the baseline photos and marks (FR-5): BASELINE_READY → CHECKED_OUT. Idempotent. */
export async function acknowledgeBaseline(repo: Repo, session: RenterSession, now = new Date()): Promise<Rental> {
  const inspections = await repo.listInspections(session.rentalId);
  const baseline = inspections.filter((i) => i.kind === "BASELINE").at(-1);
  return repo.runTransaction(async (tx) => {
    const rental = await tx.getRental(session.rentalId);
    if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "This rental no longer exists.");
    if (rental.baselineAck) return rental; // already acknowledged (this or another link)
    if (rental.status !== "BASELINE_READY" || !baseline) {
      throw new DomainError("NOTHING_TO_ACKNOWLEDGE", "The check-out photos are not ready to acknowledge yet.");
    }
    const at = now.toISOString();
    const next = transition(rental, { type: "BASELINE_ACKNOWLEDGED", at, tokenId: session.tokenId });
    if (next instanceof DomainError) throw next;
    const marks = baseline.perAngle.reduce((n, a) => n + (a.marks?.length ?? 0), 0);
    tx.putRental(next);
    tx.addEvent(rental.id, {
      id: "baseline-acknowledged",
      at,
      actor: "RENTER",
      type: "BASELINE_ACKNOWLEDGED",
      summary: `Renter acknowledged the check-out photos (${baseline.perAngle.length} angles, ${marks} pre-existing mark${marks === 1 ? "" : "s"})`,
      data: { inspectionId: baseline.id, tokenId: session.tokenId, marks },
    });
    return next;
  });
}

// ---- Renter decision (TASKS T-041; PRD FR-10) ----

export interface RenterPhotoRef {
  url: string;
  width: number;
  height: number;
}

export interface RenterLine {
  lineId: string;
  angleId: string;
  angleLabel: string;
  label: string;
  amountCents: number;
  /** Deterministic plain-language explanation (finding evidence + price source); no AI call. */
  explanation: string;
  priceSource: "PRICE_LIST" | "STAFF_OVERRIDE";
  box?: [number, number, number, number];
  before?: RenterPhotoRef;
  after?: RenterPhotoRef;
  renterDecision?: "ACCEPTED" | "CONTESTED";
  renterComment?: string;
}

export interface RenterReport {
  verdict: InspectionVerdict;
  deductionCents: number;
  lines: RenterLine[];
  angles: { angleId: string; label: string; after?: RenterPhotoRef }[];
  preExisting: { angleLabel: string; text: string }[];
  decidedAt?: string;
  contestRound: number;
}

const SHOP = "Kestrel Gear Rentals";
const sentence = (s: string) => s.trim().replace(/[.!]?$/, ".");

export function explainLine(line: LineItem, angleLabel: string, evidence?: string): string {
  const what = evidence
    ? `The return photo (${angleLabel}) shows: ${sentence(evidence)} This was not in the check-out photos.`
    : `Staff added this after comparing the ${angleLabel} photos.`;
  const cost = line.overrideReason ? `Amount set by staff: ${sentence(line.overrideReason)}` : `Price from ${SHOP}’s price list: ${line.label}.`;
  return `${what} ${cost}`;
}

const photoRef = (rentalId: string, token: string, p?: Photo): RenterPhotoRef | undefined =>
  p && { url: `/api/rentals/${rentalId}/photos/${p.id}?t=${encodeURIComponent(token)}&v=${p.sha256.slice(0, 12)}`, width: p.width, height: p.height };

/** The confirmed round as the renter sees it: included lines only (excluded lines were not proposed). */
export async function renterReport(repo: Repo, rental: Rental, token: string): Promise<RenterReport | undefined> {
  const inspection = (await repo.listInspections(rental.id)).filter((i) => i.kind === "RETURN").at(-1);
  if (!inspection?.verdict || !rental.staffConfirmedAt) return undefined;
  const [item, lines, photos] = await Promise.all([repo.getItem(rental.itemId), repo.listLineItems(rental.id), repo.listPhotos(rental.id)]);
  const label = (id: string) => item?.angles.find((a) => a.id === id)?.label ?? id;
  const photo = (phase: Photo["phase"], angleId: string) => photoRef(rental.id, token, photos.find((p) => p.phase === phase && p.angleId === angleId));
  const included = lines.filter((l) => l.round === rental.contestRound && l.staffDecision === "INCLUDED");
  return {
    verdict: inspection.verdict,
    deductionCents: rental.approvedDeductionCents ?? 0,
    contestRound: rental.contestRound,
    ...(rental.renterDecisionAt && rental.renterDecisionAt >= rental.staffConfirmedAt ? { decidedAt: rental.renterDecisionAt } : {}),
    lines: included.map((l) => {
      const finding = l.inspectionId === inspection.id ? inspection.perAngle.find((a) => a.angleId === l.angleId)?.findings.find((f) => f.findingId === l.findingId) : undefined;
      return {
        lineId: l.id,
        angleId: l.angleId,
        angleLabel: label(l.angleId),
        label: l.label,
        amountCents: l.amountCents,
        explanation: explainLine(l, label(l.angleId), finding?.evidence),
        priceSource: l.overrideReason ? ("STAFF_OVERRIDE" as const) : ("PRICE_LIST" as const),
        ...(finding ? { box: finding.box } : {}),
        before: photo("CHECKOUT", l.angleId),
        after: photo("CHECKIN", l.angleId),
        ...(l.renterDecision ? { renterDecision: l.renterDecision } : {}),
        ...(l.renterComment ? { renterComment: l.renterComment } : {}),
      };
    }),
    angles: (item?.angles ?? []).map((a) => ({ angleId: a.id, label: a.label, after: photo("CHECKIN", a.id) })),
    preExisting: inspection.perAngle.flatMap((a) => a.findings.filter((f) => !f.isNew).map((f) => ({ angleLabel: label(a.angleId), text: f.evidence }))),
  };
}

export const MAX_RENTER_COMMENT = 500;

export interface RenterDecisionInput {
  lineId: string;
  decision: "ACCEPTED" | "CONTESTED";
  comment?: string;
}

/**
 * Records the renter's decision on every included line of the confirmed round (FR-10). Zero lines
 * (clean return) records "Looks right". All accepted → READY_TO_SETTLE; any contested → CONTESTED.
 * Idempotent once decided for this round.
 */
export async function submitDecision(repo: Repo, session: RenterSession, decisions: RenterDecisionInput[], now = new Date()): Promise<RentalStatus> {
  const rental = await repo.getRental(session.rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "This rental no longer exists.");
  if (rental.status !== "AWAITING_RENTER") {
    const decidedThisRound = rental.renterDecisionAt && rental.staffConfirmedAt && rental.renterDecisionAt >= rental.staffConfirmedAt;
    if (decidedThisRound && (rental.status === "READY_TO_SETTLE" || rental.status === "CONTESTED")) return rental.status;
    throw new DomainError("NOT_AWAITING_DECISION", "There is nothing to decide right now.");
  }
  const included = (await repo.listLineItems(rental.id)).filter((l) => l.round === rental.contestRound && l.staffDecision === "INCLUDED");
  const byId = new Map<string, RenterDecisionInput>();
  for (const d of decisions) {
    if (byId.has(d.lineId) || !included.some((l) => l.id === d.lineId)) throw new DomainError("INVALID_DECISION", "Decisions must match the proposed lines.");
    if (d.decision === "CONTESTED" && !d.comment?.trim()) throw new DomainError("COMMENT_REQUIRED", "Tell the shop why you disagree with each contested line.");
    if ((d.comment?.length ?? 0) > MAX_RENTER_COMMENT) throw new DomainError("INVALID_DECISION", `Comments are limited to ${MAX_RENTER_COMMENT} characters.`);
    byId.set(d.lineId, d);
  }
  const accepted = [...byId.values()].filter((d) => d.decision === "ACCEPTED").length;
  const contested = byId.size - accepted;
  const at = now.toISOString();

  // Validate the transition (line coverage, contest limit) before writing anything.
  const preview = transition(rental, { type: "RENTER_DECIDED", at, includedLines: included.length, accepted, contested });
  if (preview instanceof DomainError) throw preview;

  for (const line of included) {
    const d = byId.get(line.id)!;
    const updated: LineItem = { ...line, renterDecision: d.decision };
    delete updated.renterComment;
    if (d.comment?.trim()) updated.renterComment = d.comment.trim();
    await repo.putLineItem(rental.id, updated);
  }
  if (contested > 0) {
    // Carry the round's lines into the next round for staff revision (T-042). The renter's decisions
    // and comments stay on this round's lines; the copies start undecided.
    const round = rental.contestRound + 1;
    for (const l of (await repo.listLineItems(rental.id)).filter((x) => x.round === rental.contestRound)) {
      // `--r<n>` suffix: stays within the [A-Za-z0-9_-] line-id pattern the routes accept.
      const copy: LineItem = { ...l, id: `${l.id.replace(/--r\d+$/, "")}--r${round}`, round };
      delete copy.renterDecision;
      delete copy.renterComment;
      await repo.putLineItem(rental.id, copy);
    }
  }
  return repo.runTransaction(async (tx) => {
    const current = await tx.getRental(rental.id);
    if (!current) throw new DomainError("RENTAL_NOT_FOUND", "This rental no longer exists.");
    const next = transition(current, { type: "RENTER_DECIDED", at, includedLines: included.length, accepted, contested });
    if (next instanceof DomainError) throw next;
    tx.putRental(next);
    tx.addEvent(rental.id, {
      id: `renter-decided-${current.contestRound}-${at}`,
      at,
      actor: "RENTER",
      type: included.length === 0 ? "RENTER_CONFIRMED_CLEAN" : contested > 0 ? "RENTER_CONTESTED" : "RENTER_ACCEPTED",
      summary:
        included.length === 0
          ? "Renter confirmed the return report: looks right ($0)"
          : contested > 0
            ? `Renter contested ${contested} of ${included.length} line${included.length > 1 ? "s" : ""}`
            : `Renter accepted the ${formatUsd(current.approvedDeductionCents ?? 0)} deduction (${accepted} line${accepted > 1 ? "s" : ""})`,
      data: { tokenId: session.tokenId, round: current.contestRound, accepted, contested, decisions: [...byId.values()].map((d) => ({ lineId: d.lineId, decision: d.decision })) },
    });
    return next.status;
  });
}
