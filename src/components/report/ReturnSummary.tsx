import type { Angle, Inspection, InspectionVerdict, LineItem } from "@/domain/types";
import { formatUsd } from "@/lib/money";
import { findingGroup, type FindingGroup } from "@/server/ai/verdict";

const VERDICT_TEXT: Record<InspectionVerdict, string> = {
  NO_NEW_DAMAGE: "No new damage detected",
  NO_CHARGES_PROPOSED_REVIEW: "No charges proposed — notes to glance at",
  DAMAGE_PROPOSED: "Damage proposed",
  INCOMPLETE: "Incomplete — retake or review angles",
};
const GROUP_TEXT: Record<FindingGroup, string> = {
  PROPOSED: "Proposed",
  NEEDS_EYES: "Needs your eyes",
  PRE_EXISTING: "Pre-existing (already recorded at check-out, not charged)",
  LOW_CONFIDENCE: "Low-confidence note",
};
const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

/** Read-only return report (T-033). The interactive staff review arrives with T-034. */
export function ReturnSummary({ inspection, angles, lines, depositCents }: { inspection: Inspection; angles: Angle[]; lines: LineItem[]; depositCents: number }) {
  const label = (id: string) => angles.find((a) => a.id === id)?.label ?? id;
  const included = lines.filter((l) => l.staffDecision === "INCLUDED" && l.inspectionId === inspection.id);
  const total = Math.min(depositCents, included.reduce((s, l) => s + l.amountCents, 0));
  return (
    <section aria-labelledby="return-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="return-heading" className="text-lg font-semibold">
          {inspection.verdict ? VERDICT_TEXT[inspection.verdict] : "Return inspection"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {inspection.model} · {inspection.promptVersion}
          {inspection.mode === "REPLAY" && " · replayed AI result recorded from a live call"}
        </p>
      </div>
      {inspection.verdict !== "INCOMPLETE" && (
        <p className="text-sm tabular-nums">
          Deposit {formatUsd(depositCents)} · Proposed deduction {formatUsd(total)} <span className="text-muted-foreground">(prices from the shop&apos;s price list)</span>
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg border">
        {inspection.perAngle.map((a) => (
          <li key={a.angleId} className="flex flex-col gap-1 p-3 text-sm">
            <p className="font-medium">
              {label(a.angleId)}{" "}
              <span className="font-normal text-muted-foreground">
                {a.needsHuman ? "— needs your review" : !a.usable ? `— retake photo${a.issues.length ? ` (${a.issues.map(pretty).join(", ")})` : ""}` : a.findings.length === 0 ? "— no change" : ""}
                {a.noChangeConfidence !== undefined && ` · no-change confidence ${Math.round(a.noChangeConfidence * 100)}%`}
              </span>
            </p>
            {a.needsHuman && <p className="text-xs text-muted-foreground">{a.error}</p>}
            {a.findings.map((f) => {
              const line = lines.find((l) => l.inspectionId === inspection.id && l.angleId === a.angleId && l.findingId === f.findingId);
              return (
                <p key={f.findingId} className="ml-4 text-xs">
                  <span className="font-medium">{GROUP_TEXT[findingGroup(f)]}:</span> {pretty(f.damageType)} ({pretty(f.severity)}, {Math.round(f.confidence * 100)}%) — {f.evidence}
                  {line && (
                    <span className="tabular-nums">
                      {" "}
                      → {line.label}: {formatUsd(line.amountCents)} {line.staffDecision === "INCLUDED" ? "(included)" : "(excluded)"}
                    </span>
                  )}
                </p>
              );
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
