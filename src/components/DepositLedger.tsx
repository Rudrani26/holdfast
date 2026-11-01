import { formatUsd } from "@/lib/money";

/**
 * The deposit as a ledger bar: the whole hold, split into the part captured and the part whose
 * authorization is voided. Wording follows src/lib/settlementCopy.ts (no "refund", no "released").
 */
export function DepositLedger({ depositCents, deductionCents, caption }: { depositCents: number; deductionCents: number; caption: string }) {
  const share = Math.max(0, Math.min(1, deductionCents / depositCents));
  const rest = depositCents - deductionCents;
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 tabular-nums">
        <span className="text-sm text-muted-foreground">Deposit hold</span>
        <span className="text-2xl font-semibold tracking-tight">{formatUsd(depositCents)}</span>
      </div>
      <div
        role="img"
        aria-label={`${formatUsd(depositCents)} hold: ${formatUsd(deductionCents)} captured, ${formatUsd(rest)} authorization voided`}
        className="flex h-11 w-full overflow-hidden rounded-md border border-foreground/15"
      >
        <span className="h-full bg-primary" style={{ width: `${share * 100}%` }} />
        <span
          className="h-full flex-1"
          style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in oklab, var(--foreground) 9%, transparent) 7px 8px)" }}
        />
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm tabular-nums">
        <div className="border-l-4 border-primary pl-3">
          <dt className="text-muted-foreground">Captured, after you agree</dt>
          <dd className="text-lg font-semibold">{formatUsd(deductionCents)}</dd>
        </div>
        <div className="border-l-4 border-foreground/20 pl-3">
          <dt className="text-muted-foreground">Authorization voided</dt>
          <dd className="text-lg font-semibold">{formatUsd(rest)}</dd>
        </div>
      </dl>
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
