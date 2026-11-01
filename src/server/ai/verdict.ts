import "server-only";
import type { Inspection, InspectionVerdict } from "@/domain/types";
import { findingGroup, NO_CHANGE_AT } from "@/lib/findingGroups";

// Inspection verdict (AI_PIPELINE.md §6.1). Pure. Thresholds live in src/lib/findingGroups.ts so the
// staff review UI groups findings exactly as the server does.
export { findingGroup, INCLUDE_AT, NO_CHANGE_AT, REVIEW_AT, type FindingGroup } from "@/lib/findingGroups";

type AngleResult = Pick<Inspection["perAngle"][number], "usable" | "needsHuman" | "findings" | "noChangeConfidence">;

/**
 * Computed by code from model outputs, never asked of the model. Order matters: any unusable or
 * unanswered angle makes the inspection INCOMPLETE, whatever else it says.
 */
export function inspectionVerdict(perAngle: AngleResult[]): InspectionVerdict {
  if (perAngle.length === 0 || perAngle.some((a) => !a.usable || a.needsHuman)) return "INCOMPLETE";
  const groups = perAngle.flatMap((a) => a.findings.map(findingGroup));
  if (groups.includes("PROPOSED")) return "DAMAGE_PROPOSED";
  const anyNewReportable = groups.includes("NEEDS_EYES");
  const allSure = perAngle.every((a) => (a.noChangeConfidence ?? 0) >= NO_CHANGE_AT);
  if (!anyNewReportable && allSure && !groups.includes("LOW_CONFIDENCE")) return "NO_NEW_DAMAGE";
  return "NO_CHARGES_PROPOSED_REVIEW";
}
