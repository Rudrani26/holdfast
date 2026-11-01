import type { Finding } from "@/domain/types";

// Finding thresholds (AI_PIPELINE.md §6). Shared by the server verdict and the staff review UI.
// Initial values; tune with the evaluation set (§10) and record changes in AI_PIPELINE.md.

/** New finding at or above this → proposed line, included by default. */
export const INCLUDE_AT = 0.75;
/** New finding at or above this (and below INCLUDE_AT) → "Needs your eyes", excluded by default. */
export const REVIEW_AT = 0.5;
/** Every angle must be at least this sure nothing changed for NO_NEW_DAMAGE. */
export const NO_CHANGE_AT = 0.8;

export type FindingGroup = "PROPOSED" | "NEEDS_EYES" | "PRE_EXISTING" | "LOW_CONFIDENCE";

export function findingGroup(f: Pick<Finding, "isNew" | "confidence">): FindingGroup {
  if (!f.isNew) return "PRE_EXISTING";
  if (f.confidence >= INCLUDE_AT) return "PROPOSED";
  if (f.confidence >= REVIEW_AT) return "NEEDS_EYES";
  return "LOW_CONFIDENCE";
}
