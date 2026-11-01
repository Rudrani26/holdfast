import type { Provenance, RentalStatus } from "@/domain/types";

// Staff workspace stepper (PRD §10 S6). Pure: the step list and each step's state come from the
// rental status alone.

export const WORKSPACE_STEPS = [
  { key: "deposit", label: "Deposit authorized" },
  { key: "checkout", label: "Check-out photos" },
  { key: "baseline", label: "Baseline acknowledged" },
  { key: "return", label: "Return photos" },
  { key: "report", label: "Inspection report" },
  { key: "renter", label: "Renter decision" },
  { key: "settle", label: "Settlement" },
] as const;
export type StepKey = (typeof WORKSPACE_STEPS)[number]["key"];
export type StepState = "done" | "current" | "upcoming";

/** Index of the step the rental is on; past the last index means everything is done. */
const CURRENT: Record<RentalStatus, number> = {
  DRAFT: 0,
  AWAITING_PAYMENT: 0,
  AUTHORIZED: 1,
  BASELINE_READY: 2,
  CHECKED_OUT: 3,
  RETURNED: 4,
  INSPECTED: 4,
  CONTESTED: 4,
  AWAITING_RENTER: 5,
  READY_TO_SETTLE: 6,
  SETTLEMENT_FAILED: 6,
  SETTLED: 7,
  CANCELLED: -1,
};

export function workspaceSteps(status: RentalStatus): { key: StepKey; label: string; state: StepState }[] {
  const current = CURRENT[status];
  return WORKSPACE_STEPS.map((s, i) => ({
    ...s,
    state: current === -1 ? "upcoming" : i < current ? "done" : i === current ? "current" : "upcoming",
  }));
}

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  UPLOADED_REAL: "Real photo",
  LIVE_CAPTURE: "Real photo, taken live in this app",
  UPLOADED_HYBRID: "AI-edited real photo",
  UPLOADED_SYNTHETIC: "AI-generated image",
};

/** Provenances that must carry a disclosure chip wherever the photo is shown (ARCHITECTURE.md §3). */
export const needsDisclosure = (p: Provenance) => p === "UPLOADED_HYBRID" || p === "UPLOADED_SYNTHETIC";
