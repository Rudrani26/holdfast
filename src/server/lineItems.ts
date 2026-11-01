import "server-only";
import { price, type LineDraft } from "@/domain/pricer";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type Inspection, type LineItem, type RentalStatus } from "@/domain/types";
import { formatUsd } from "@/lib/money";
import { findingGroup, NO_CHANGE_AT, type FindingGroup } from "./ai/verdict";
import type { Repo } from "./repo/types";

// Return report → priced line items (AI_PIPELINE.md §6–§7, TASKS T-033). Outside the AI module on
// purpose: findings carry only damage type and severity; every amount comes from the shop's price
// list via the deterministic pricer. Staff confirm or change all of it in the review (T-034).

export interface ReportCounts {
  proposed: number;
  needsEyes: number;
  preExisting: number;
  lowConfidence: number;
}

export function countGroups(inspection: Inspection): ReportCounts {
  const counts: Record<FindingGroup, number> = { PROPOSED: 0, NEEDS_EYES: 0, PRE_EXISTING: 0, LOW_CONFIDENCE: 0 };
  for (const a of inspection.perAngle) for (const f of a.findings) counts[findingGroup(f)]++;
  return { proposed: counts.PROPOSED, needsEyes: counts.NEEDS_EYES, preExisting: counts.PRE_EXISTING, lowConfidence: counts.LOW_CONFIDENCE };
}

/** Line id: stable per inspection, angle and finding (a safe Firestore document id). */
export const lineIdFor = (inspectionId: string, angleId: string, findingId: string) => `${inspectionId}_${angleId}_${findingId}`;

/** New findings become lines: ≥ 0.75 included, 0.50–0.75 excluded ("Needs your eyes"). Others are never priced. */
export function draftsFromInspection(inspection: Inspection): LineDraft[] {
  return inspection.perAngle.flatMap((a) =>
    a.findings
      .map((f) => ({ f, group: findingGroup(f) }))
      .filter(({ group }) => group === "PROPOSED" || group === "NEEDS_EYES")
      .map(({ f, group }) => ({
        key: lineIdFor(inspection.id, a.angleId, f.findingId),
        source: "AI" as const,
        findingId: f.findingId,
        angleId: a.angleId,
        damageType: f.damageType,
        severity: f.severity,
        included: group === "PROPOSED",
      })),
  );
}

/**
 * Applies a stored RETURN inspection. INCOMPLETE → the rental stays RETURNED (retake/review, rerun).
 * Otherwise writes priced AI lines and moves RETURNED → INSPECTED with an AI_REPORT_READY event.
 */
export async function applyReturnInspection(
  repo: Repo,
  rentalId: string,
  inspection: Inspection,
  { wallMs, now = () => new Date() }: { wallMs?: number; now?: () => Date } = {},
): Promise<{ rentalStatus: RentalStatus; lines: LineItem[]; proposedTotalCents: number }> {
  if (inspection.kind !== "RETURN" || !inspection.verdict) throw new Error("applyReturnInspection needs a RETURN inspection with a verdict");
  const rental = await repo.getRental(rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
  const item = await repo.getItem(rental.itemId);
  if (!item) throw new DomainError("ITEM_NOT_FOUND", "Item not found.");
  const counts = countGroups(inspection);
  const label = (id: string) => item.angles.find((a) => a.id === id)?.label ?? id;
  const replayNote = inspection.mode === "REPLAY" ? " · replayed AI result recorded from a live call" : "";
  const data = {
    inspectionId: inspection.id,
    verdict: inspection.verdict,
    ...counts,
    model: inspection.model,
    mode: inspection.mode,
    tokenInput: inspection.tokenUsage?.input ?? 0,
    tokenOutput: inspection.tokenUsage?.output ?? 0,
    ...(wallMs !== undefined ? { wallMs } : {}),
  };

  if (inspection.verdict === "INCOMPLETE") {
    const todo = inspection.perAngle
      .filter((a) => a.needsHuman || !a.usable)
      .map((a) => (a.needsHuman ? `review ${label(a.angleId)}` : `retake ${label(a.angleId)}${a.issues.length ? ` (${a.issues.join(", ")})` : ""}`));
    await repo.runTransaction(async (tx) => {
      await tx.getRental(rentalId);
      const at = now().toISOString();
      tx.addEvent(rentalId, { id: `ai-${inspection.id}`, at, actor: "AI", type: "AI_REPORT_INCOMPLETE", summary: `AI return report incomplete: ${todo.join("; ")}${replayNote}`, data });
    });
    return { rentalStatus: rental.status, lines: [], proposedTotalCents: 0 };
  }

  const priceList = await repo.getPriceList(item.priceListId);
  if (!priceList) throw new DomainError("PRICE_LIST_MISSING", `Price list ${item.priceListId} not found.`);
  const pricing = price(draftsFromInspection(inspection), priceList, rental.depositCents);
  const lines: LineItem[] = pricing.lines.map((l) => ({
    id: l.key,
    source: "AI",
    inspectionId: inspection.id,
    findingId: l.findingId,
    angleId: l.angleId,
    damageType: l.damageType,
    severity: l.severity,
    label: l.label,
    amountCents: l.amountCents,
    ...(l.priceRuleRef ? { priceRuleRef: l.priceRuleRef } : {}),
    staffDecision: l.included ? "INCLUDED" : "EXCLUDED",
    round: rental.contestRound,
  }));
  for (const line of lines) await repo.putLineItem(rentalId, line);

  const summary =
    inspection.verdict === "NO_NEW_DAMAGE"
      ? `No new damage detected across ${inspection.perAngle.length} angles${counts.preExisting ? ` · ${counts.preExisting} pre-existing mark${counts.preExisting > 1 ? "s" : ""} already recorded at check-out` : ""} · $0 proposed`
      : inspection.verdict === "DAMAGE_PROPOSED"
        ? `AI report: ${counts.proposed} proposed charge${counts.proposed > 1 ? "s" : ""} totalling ${formatUsd(pricing.totalCents)} from the price list${pricing.cappedAtDeposit ? " (capped at deposit)" : ""}${counts.needsEyes ? ` · ${counts.needsEyes} to review` : ""}${counts.preExisting ? ` · ${counts.preExisting} pre-existing, not charged` : ""}`
        : noteSummary(counts, inspection.perAngle.filter((a) => (a.noChangeConfidence ?? 0) < NO_CHANGE_AT).length);

  const rentalStatus = await repo.runTransaction(async (tx) => {
    const current = await tx.getRental(rentalId);
    if (!current) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    const at = now().toISOString();
    tx.addEvent(rentalId, {
      id: `ai-${inspection.id}`,
      at,
      actor: "AI",
      type: "AI_REPORT_READY",
      summary: `${summary}${replayNote}`,
      data: { ...data, proposedTotalCents: pricing.totalCents, unpricedLines: pricing.blockingUnpricedKeys.length },
    });
    if (current.status !== "RETURNED") return current.status;
    const next = transition(current, { type: "RETURN_INSPECTED", at });
    if (next instanceof DomainError) throw next;
    tx.putRental(next);
    return next.status;
  });
  return { rentalStatus, lines, proposedTotalCents: pricing.totalCents };
}

function noteSummary(counts: ReportCounts, unsureAngles: number): string {
  const notes = counts.needsEyes + counts.lowConfidence + unsureAngles;
  return `No charges proposed — ${notes} note${notes === 1 ? "" : "s"} to glance at`;
}
