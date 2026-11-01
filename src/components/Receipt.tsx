import { AlertTriangle, BadgeCheck, CheckCircle2, Clock } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { formatUsd } from "@/lib/money";
import type { Receipt as ReceiptModel } from "@/lib/receipt";

/** Settlement receipt (PRD §10 S8): the same for staff and renter. */
export function Receipt({ receipt, heading = "Receipt" }: { receipt: ReceiptModel; heading?: string }) {
  const Icon = receipt.state === "SETTLED" ? (receipt.capturePending ? Clock : CheckCircle2) : receipt.state === "FAILED" ? AlertTriangle : Clock;
  return (
    <section aria-labelledby="receipt-heading" className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 id="receipt-heading" className="text-sm font-medium text-muted-foreground">
          {heading}
        </h2>
        <p className="mt-1 flex items-start gap-2 text-lg font-semibold">
          <Icon className={`mt-1 size-5 shrink-0 ${receipt.state === "FAILED" ? "text-red-700" : "text-emerald-700"}`} aria-hidden="true" />
          {receipt.headline}
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div>
          <dt className="text-muted-foreground">Deposit hold</dt>
          <dd className="font-medium">{formatUsd(receipt.depositCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Charged</dt>
          <dd className="font-semibold">{formatUsd(receipt.chargedCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Not charged</dt>
          <dd className="font-medium">{formatUsd(receipt.notChargedCents)}</dd>
        </div>
      </dl>

      {receipt.undisputedOnly && (
        <p className="text-sm">Settled only the lines the renter accepted, after two contest rounds. The renter keeps the right to raise a dispute with PayPal.</p>
      )}

      {receipt.ops.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">PayPal operations</h3>
          <ol className="mt-2 flex flex-col gap-2">
            {receipt.ops.map((op) => (
              <li key={op.op} className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{op.label}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    {op.paypalStatus && (
                      <span className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        <span className="sr-only">PayPal status </span>
                        {op.paypalStatus}
                      </span>
                    )}
                    {op.status !== "SUCCEEDED" && <span className="font-medium text-red-700">{op.status === "FAILED" ? "Failed" : "Not confirmed yet"}</span>}
                    {op.paypalConfirmed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-900 ring-1 ring-emerald-700/30">
                        <BadgeCheck className="size-3.5" aria-hidden="true" />
                        PayPal-confirmed
                      </span>
                    ) : (
                      op.status === "SUCCEEDED" && <span className="text-muted-foreground">Awaiting PayPal webhook</span>
                    )}
                  </span>
                </div>
                {op.paypalObjectId && (
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{op.op === "CAPTURE" ? "Capture ID" : op.op === "VOID" ? "Authorization ID" : "Refund ID"}</span>
                    <code className="font-mono break-all">{op.paypalObjectId}</code>
                    <CopyButton text={op.paypalObjectId} label="Copy" size="xs" ariaLabel={`Copy ${op.label} PayPal ID`} />
                  </p>
                )}
                {op.error && <p className="text-xs text-red-700">{op.error}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {receipt.orderId && (
          <>
            <dt className="text-muted-foreground">PayPal order</dt>
            <dd className="font-mono break-all">{receipt.orderId}</dd>
          </>
        )}
        {receipt.authorizationId && (
          <>
            <dt className="text-muted-foreground">PayPal authorization</dt>
            <dd className="font-mono break-all">{receipt.authorizationId}</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">PayPal Sandbox · statuses shown exactly as PayPal returned them.</p>
    </section>
  );
}
