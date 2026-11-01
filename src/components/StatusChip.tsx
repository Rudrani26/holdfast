import { AlertTriangle, CheckCircle2, CircleDot, Clock, XCircle, type LucideIcon } from "lucide-react";
import type { RentalStatus } from "@/domain/types";

type Tone = "waiting" | "active" | "done" | "problem" | "closed";

const TONE: Record<RentalStatus, Tone> = {
  DRAFT: "waiting",
  AWAITING_PAYMENT: "waiting",
  AUTHORIZED: "active",
  BASELINE_READY: "active",
  CHECKED_OUT: "active",
  RETURNED: "active",
  INSPECTED: "active",
  AWAITING_RENTER: "waiting",
  CONTESTED: "problem",
  READY_TO_SETTLE: "active",
  SETTLED: "done",
  SETTLEMENT_FAILED: "problem",
  CANCELLED: "closed",
};

const STYLE: Record<Tone, { icon: LucideIcon; className: string }> = {
  waiting: { icon: Clock, className: "bg-amber-50 text-amber-950 ring-amber-700/30" },
  active: { icon: CircleDot, className: "bg-sky-50 text-sky-950 ring-sky-700/30" },
  done: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-950 ring-emerald-700/30" },
  problem: { icon: AlertTriangle, className: "bg-red-50 text-red-950 ring-red-700/30" },
  closed: { icon: XCircle, className: "bg-muted text-foreground ring-border" },
};

export const statusLabel = (s: RentalStatus) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");

/** Rental status with icon + text (never color alone, PRD §10). */
export function StatusChip({ status }: { status: RentalStatus }) {
  const { icon: Icon, className } = STYLE[TONE[status]];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${className}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}
