import "server-only";
import { randomBytes } from "node:crypto";
import { price, ruleRef, type LineDraft } from "@/domain/pricer";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type Cents, type DamageType, type LineItem, type PriceList, type Rental, type Severity } from "@/domain/types";
import { formatUsd } from "@/lib/money";
import type { Repo } from "./repo/types";

// Staff review of the return report (TASKS T-034; PRD FR-7–FR-9). Every amount comes from the pricer:
// a price-list rule, or a staff override with a logged reason. Client-sent amounts are only accepted
// as an explicit override and are recorded as such.

/** Rental states in which staff may edit lines and confirm (CONTESTED: revision round, T-042). */
const REVIEWABLE: readonly Rental["status"][] = ["INSPECTED", "CONTESTED"];

export interface ReviewDeps {
  repo: Repo;
  now?: () => Date;
}

const iso = (d: ReviewDeps) => (d.now?.() ?? new Date()).toISOString();

async function load(deps: ReviewDeps, rentalId: string): Promise<{ rental: Rental; priceList: PriceList }> {
  const rental = await deps.repo.getRental(rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
  if (!REVIEWABLE.includes(rental.status)) throw new DomainError("NOT_IN_REVIEW", `Lines can only be changed during review (rental is ${rental.status}).`);
  const item = await deps.repo.getItem(rental.itemId);
  const priceList = item && (await deps.repo.getPriceList(item.priceListId));
  if (!priceList) throw new DomainError("PRICE_LIST_MISSING", "This item's price list is missing.");
  return { rental, priceList };
}

/** The lines that count in the current round. */
export const currentLines = (lines: LineItem[], rental: Rental) => lines.filter((l) => l.round === rental.contestRound);

function draftOf(line: LineItem): LineDraft {
  return {
    key: line.id,
    source: line.source,
    ...(line.findingId ? { findingId: line.findingId } : {}),
    angleId: line.angleId,
    damageType: line.damageType,
    severity: line.severity,
    included: line.staffDecision === "INCLUDED",
    ...(line.priceRuleRef ? { priceRuleRef: line.priceRuleRef } : {}),
    ...(line.overrideReason ? { override: { amountCents: line.amountCents, reason: line.overrideReason } } : {}),
  };
}

function applyPriced(line: LineItem, draft: LineDraft, priceList: PriceList, depositCents: Cents): LineItem {
  const [p] = price([draft], priceList, depositCents).lines;
  const rest: LineItem = { ...line };
  delete rest.priceRuleRef; // re-set below from the pricer's result
  delete rest.overrideReason;
  return {
    ...rest,
    source: p!.source,
    label: p!.label,
    amountCents: p!.amountCents,
    staffDecision: p!.included ? "INCLUDED" : "EXCLUDED",
    ...(p!.priceRuleRef ? { priceRuleRef: p!.priceRuleRef } : {}),
    ...(p!.overrideReason ? { overrideReason: p!.overrideReason } : {}),
  };
}

export interface LinePatch {
  staffDecision?: "INCLUDED" | "EXCLUDED";
  /** Choose a price-list rule (e.g. a different severity); clears any override. */
  priceRuleRef?: string;
  /** Staff override: both fields together. `null` clears the override. */
  overrideAmountCents?: Cents | null;
  overrideReason?: string;
}

export async function updateLine(deps: ReviewDeps, rentalId: string, lineId: string, patch: LinePatch): Promise<LineItem> {
  const { rental, priceList } = await load(deps, rentalId);
  const line = await deps.repo.getLineItem(rentalId, lineId);
  if (!line || line.round !== rental.contestRound) throw new DomainError("LINE_NOT_FOUND", "Line not found in the current round.");

  const draft = draftOf(line);
  if (patch.staffDecision) draft.included = patch.staffDecision === "INCLUDED";
  if (patch.priceRuleRef !== undefined) {
    draft.priceRuleRef = patch.priceRuleRef;
    delete draft.override;
  }
  if (patch.overrideAmountCents === null) delete draft.override;
  else if (patch.overrideAmountCents !== undefined) {
    if (patch.overrideAmountCents > rental.depositCents) throw new DomainError("INVALID_OVERRIDE", `An override cannot exceed the ${formatUsd(rental.depositCents)} deposit.`);
    draft.override = { amountCents: patch.overrideAmountCents, reason: patch.overrideReason ?? "" };
  }
  const updated = applyPriced(line, draft, priceList, rental.depositCents);
  await deps.repo.putLineItem(rentalId, updated);

  const changes = [
    line.staffDecision !== updated.staffDecision && (updated.staffDecision === "INCLUDED" ? "included" : "excluded"),
    line.amountCents !== updated.amountCents && `${formatUsd(line.amountCents)} → ${formatUsd(updated.amountCents)}`,
    line.label !== updated.label && `“${updated.label}”`,
    updated.overrideReason && updated.overrideReason !== line.overrideReason && `override: ${updated.overrideReason}`,
  ].filter(Boolean);
  if (changes.length > 0) {
    await deps.repo.runTransaction(async (tx) => {
      await tx.getRental(rentalId);
      const at = iso(deps);
      tx.addEvent(rentalId, {
        id: `line-${lineId}-${at}`,
        at,
        actor: "STAFF",
        type: updated.overrideReason && updated.overrideReason !== line.overrideReason ? "LINE_OVERRIDDEN" : "LINE_UPDATED",
        summary: `${line.label} (${line.angleId}): ${changes.join(", ")}`,
        data: { lineId, before: { amountCents: line.amountCents, staffDecision: line.staffDecision, priceRuleRef: line.priceRuleRef }, after: { amountCents: updated.amountCents, staffDecision: updated.staffDecision, priceRuleRef: updated.priceRuleRef } },
      });
    });
  }
  return updated;
}

export async function addManualLine(
  deps: ReviewDeps,
  rentalId: string,
  input: { angleId: string; damageType: DamageType; severity: Severity; priceRuleRef: string },
): Promise<LineItem> {
  const { rental, priceList } = await load(deps, rentalId);
  const item = await deps.repo.getItem(rental.itemId);
  if (!item?.angles.some((a) => a.id === input.angleId)) throw new DomainError("UNKNOWN_ANGLE", `Unknown angle "${input.angleId}".`);
  if (!priceList.rules.some((r) => ruleRef(r.damageType, r.severity) === input.priceRuleRef)) {
    throw new DomainError("UNKNOWN_PRICE_RULE", "Pick a rule from the price list.");
  }
  const at = iso(deps);
  const base: LineItem = {
    id: `manual-${at.replace(/[-:.TZ]/g, "")}-${randomBytes(3).toString("hex")}`,
    source: "STAFF",
    angleId: input.angleId,
    damageType: input.damageType,
    severity: input.severity,
    label: "",
    amountCents: 0,
    priceRuleRef: input.priceRuleRef,
    staffDecision: "INCLUDED",
    round: rental.contestRound,
  };
  const line = applyPriced(base, draftOf(base), priceList, rental.depositCents);
  await deps.repo.putLineItem(rentalId, line);
  await deps.repo.runTransaction(async (tx) => {
    await tx.getRental(rentalId);
    tx.addEvent(rentalId, {
      id: `line-${line.id}`,
      at,
      actor: "STAFF",
      type: "LINE_ADDED",
      summary: `Staff added ${line.label} (${input.angleId}) from the price list: ${formatUsd(line.amountCents)}`,
      data: { lineId: line.id, priceRuleRef: input.priceRuleRef, amountCents: line.amountCents },
    });
  });
  return line;
}

/** Line id without its round suffix (`--r<n>`, added when lines are carried into a contest round). */
export const baseLineId = (id: string) => id.replace(/--r\d+$/, "");

/** The renter's previous-round decision for each current line (T-042: shown to staff beside the finding). */
export function contestsByLine(lines: LineItem[], rental: Rental): Map<string, { decision: "ACCEPTED" | "CONTESTED"; comment?: string }> {
  const prev = lines.filter((l) => l.round === rental.contestRound - 1 && l.renterDecision);
  const out = new Map<string, { decision: "ACCEPTED" | "CONTESTED"; comment?: string }>();
  for (const l of currentLines(lines, rental)) {
    const p = prev.find((x) => baseLineId(x.id) === baseLineId(l.id));
    if (p?.renterDecision) out.set(l.id, { decision: p.renterDecision, ...(p.renterComment ? { comment: p.renterComment } : {}) });
  }
  return out;
}

/**
 * After the contest limit (ARCHITECTURE.md §4): settle only what the renter accepted in the last
 * decided round, re-priced from the list; contested lines are excluded. CONTESTED → READY_TO_SETTLE.
 */
export async function settleUndisputed(deps: ReviewDeps, rentalId: string): Promise<{ rental: Rental; deductionCents: Cents }> {
  const { rental, priceList } = await load(deps, rentalId);
  if (rental.status !== "CONTESTED") throw new DomainError("NOT_CONTESTED", "Only a contested rental can settle undisputed lines.");
  const decided = (await deps.repo.listLineItems(rentalId)).filter((l) => l.round === rental.contestRound - 1 && l.staffDecision === "INCLUDED");
  const acceptedLines = decided.filter((l) => l.renterDecision === "ACCEPTED");
  const pricing = price(acceptedLines.map(draftOf), priceList, rental.depositCents);
  return deps.repo.runTransaction(async (tx) => {
    const current = await tx.getRental(rentalId);
    if (!current) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    const at = iso(deps);
    const next = transition(current, { type: "STAFF_SETTLE_UNDISPUTED", at, undisputedDeductionCents: pricing.totalCents });
    if (next instanceof DomainError) throw next;
    tx.putRental(next);
    tx.addEvent(rentalId, {
      id: `settle-undisputed-${at}`,
      at,
      actor: "STAFF",
      type: "STAFF_SETTLE_UNDISPUTED",
      summary: `After ${current.contestRound} contest rounds, staff chose to settle only the undisputed ${formatUsd(pricing.totalCents)} (${acceptedLines.length} accepted line${acceptedLines.length === 1 ? "" : "s"}); ${decided.length - acceptedLines.length} contested line${decided.length - acceptedLines.length === 1 ? "" : "s"} dropped`,
      data: { deductionCents: pricing.totalCents, accepted: acceptedLines.map((l) => l.id), contested: decided.filter((l) => l.renterDecision === "CONTESTED").map((l) => l.id) },
    });
    return { rental: next, deductionCents: pricing.totalCents };
  });
}

/**
 * Staff confirm (FR-9): re-prices the current round's lines, refuses while any included line is
 * unpriced, freezes the deduction (capped at the deposit, FR-8) and moves the rental to AWAITING_RENTER.
 */
export async function confirmReview(deps: ReviewDeps, rentalId: string): Promise<{ rental: Rental; deductionCents: Cents; cappedAtDeposit: boolean }> {
  const { rental, priceList } = await load(deps, rentalId);
  const lines = currentLines(await deps.repo.listLineItems(rentalId), rental);
  const pricing = price(lines.map(draftOf), priceList, rental.depositCents);
  if (pricing.blockingUnpricedKeys.length > 0) {
    throw new DomainError("LINES_UNPRICED", `Price or exclude ${pricing.blockingUnpricedKeys.length} unpriced line(s) before confirming.`);
  }
  const included = pricing.lines.filter((l) => l.included);
  return deps.repo.runTransaction(async (tx) => {
    const current = await tx.getRental(rentalId);
    if (!current) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    const at = iso(deps);
    const next = transition(current, { type: "STAFF_CONFIRMED", at, deductionCents: pricing.totalCents });
    if (next instanceof DomainError) throw next;
    tx.putRental(next);
    tx.addEvent(rentalId, {
      id: `staff-confirmed-${current.contestRound}-${at}`,
      at,
      actor: "STAFF",
      type: "STAFF_CONFIRMED",
      summary:
        pricing.totalCents === 0
          ? "Staff confirmed $0 — no deduction proposed to the renter"
          : `Staff confirmed a ${formatUsd(pricing.totalCents)} deduction (${included.length} line${included.length > 1 ? "s" : ""})${pricing.cappedAtDeposit ? ", capped at the deposit" : ""}`,
      data: { deductionCents: pricing.totalCents, lines: included.map((l) => ({ lineId: l.key, label: l.label, amountCents: l.amountCents })), round: current.contestRound },
    });
    return { rental: next, deductionCents: pricing.totalCents, cappedAtDeposit: pricing.cappedAtDeposit };
  });
}
