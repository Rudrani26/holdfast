import { AwaitPayPalWebhook } from "@/components/AwaitPayPalWebhook";
import { Receipt } from "@/components/Receipt";
import { plan } from "@/domain/settlementPlanner";
import type { Inspection, Rental, TimelineEvent } from "@/domain/types";
import { formatUsd } from "@/lib/money";
import { buildReceipt } from "@/lib/receipt";
import { buildTimeline } from "@/lib/timeline";
import { plannedCopy } from "@/lib/settlementCopy";
import { getRepo } from "@/server/deps";
import { SettleButton } from "./SettleButton";

/** S6 settlement step: planned PayPal ops, Settle / Retry, then the receipt (PRD §10, TASKS T-043). */
export async function SettlementPanel({ rental, events, returnInspection }: { rental: Rental; events: TimelineEvent[]; returnInspection?: Inspection }) {
  const records = await getRepo().listSettlements(rental.id);
  const deduction = rental.approvedDeductionCents ?? 0;
  const receipt = buildReceipt({ rental, records, events, cleanReturn: returnInspection?.verdict === "NO_NEW_DAMAGE" });
  const ops = plan(rental.settlementMode, rental.depositCents, deduction);
  const awaitingWebhook = rental.status === "SETTLED" && buildTimeline(events).some((i) => i.paypalConfirmed === false);

  return (
    <div className="flex flex-col gap-4">
      {rental.status !== "SETTLED" && (
        <section aria-labelledby="settle-heading" className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 id="settle-heading" className="text-lg font-semibold">
            {rental.status === "SETTLEMENT_FAILED" ? "Settlement stopped" : "Ready to settle"}
          </h2>
          <p className="text-sm tabular-nums">
            Approved deduction <strong>{formatUsd(deduction)}</strong> of the {formatUsd(rental.depositCents)} hold{rental.undisputedOnly ? " (undisputed lines only)" : ""}. {plannedCopy(rental.settlementMode, rental.depositCents, deduction)}
          </p>
          <ol className="list-decimal pl-5 font-mono text-xs">
            {ops.map((op, i) => (
              <li key={i}>
                {op.op === "VOID" ? "VOID authorization" : `${op.op} ${formatUsd(op.amountCents)}${op.op === "CAPTURE" ? ` (final_capture: ${op.finalCapture})` : ""}`}
              </li>
            ))}
          </ol>
          <SettleButton rentalId={rental.id} label={rental.status === "SETTLEMENT_FAILED" ? "Retry settlement" : `Settle ${formatUsd(deduction)} with PayPal`} />
          <p className="text-xs text-muted-foreground">Mode {rental.settlementMode}. Each PayPal call is locked and idempotent; Settle twice is safe.</p>
        </section>
      )}
      {(records.length > 0 || rental.status === "SETTLED") && <Receipt receipt={receipt} heading={rental.status === "SETTLED" ? "Receipt" : "What PayPal has done so far"} />}
      <AwaitPayPalWebhook waiting={awaitingWebhook} />
    </div>
  );
}
