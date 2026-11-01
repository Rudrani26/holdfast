import type { CSSProperties, ReactNode } from "react";
import { GeminiTag, PayPalTag, PersonTag } from "@/components/Provenance";
import { formatUsd } from "@/lib/money";

// Storefront hero: one deposit's life as a tape of authored steps, revealed once on load (CSS only,
// static under prefers-reduced-motion). An illustration with real catalog prices, labelled as an example.

const DEPOSIT = 20000;
const CAPTURE = 3800;

const at = (i: number) => ({ "--i": i }) as CSSProperties;

function Step({ i, who, children, last = false }: { i: number; who: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <li className="tape-step relative grid grid-cols-[6.5rem_1fr] gap-3 pb-4" style={at(i)}>
      {!last && <span aria-hidden="true" className="absolute top-7 bottom-0 left-[3.1rem] w-px bg-border" />}
      <span className="relative flex justify-center self-start pt-0.5">{who}</span>
      <div className="min-w-0 text-sm">{children}</div>
    </li>
  );
}

export function SettlementTape() {
  return (
    <figure className="rounded-2xl border bg-card p-4 shadow-[0_1px_0_rgba(20,35,32,.04),0_12px_32px_-16px_rgba(20,35,32,.25)] sm:p-6">
      <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-lg font-semibold">One deposit, start to finish</span>
        <span className="text-xs text-muted-foreground">Example with the shop&apos;s real prices</span>
      </figcaption>
      <ol>
        <Step i={0} who={<PayPalTag />}>
          <p>
            Places a <strong className="font-semibold">{formatUsd(DEPOSIT)} hold</strong> on the renter&apos;s account. Nothing is charged.
          </p>
          <span className="mt-1 inline-block rounded bg-hold-soft px-1.5 py-0.5 font-mono text-xs text-hold-ink">AUTHORIZATION CREATED</span>
        </Step>
        <Step i={1} who={<GeminiTag />}>
          <p>Compares 6 check-out and return photos and proposes one finding:</p>
          <p className="mt-1 rounded-md border border-dashed border-ai/50 bg-ai-soft px-2.5 py-1.5 text-ai">
            Right side: ear cushion missing, <span className="tabular-nums">99%</span> confident
          </p>
        </Step>
        <Step i={2} who={<PersonTag>Staff</PersonTag>}>
          <p>
            Confirms it and prices it from the shop&apos;s list: Ear cushion replacement,{" "}
            <strong className="font-semibold tabular-nums">{formatUsd(CAPTURE)}</strong>.
          </p>
        </Step>
        <Step i={3} who={<PersonTag>Renter</PersonTag>}>
          <p>Sees the photos and the price, and accepts.</p>
        </Step>
        <Step i={4} who={<PayPalTag />} last>
          <p>
            Captures <strong className="font-semibold tabular-nums">{formatUsd(CAPTURE)}</strong> and voids the rest of the authorization.
          </p>
        </Step>
      </ol>
      <div
        role="img"
        aria-label={`${formatUsd(DEPOSIT)} hold: ${formatUsd(CAPTURE)} captured, ${formatUsd(DEPOSIT - CAPTURE)} authorization voided`}
        className="mt-1 flex h-10 overflow-hidden rounded-md bg-hold ring-1 ring-foreground/10"
      >
        {/* Starts as one amber hold; splits into captured and voided at the end of the tape. */}
        <span className="ledger-capture h-full bg-paypal" style={{ ...at(5), width: `${(CAPTURE / DEPOSIT) * 100}%` }} />
        <span
          className="tape-step h-full flex-1 bg-card"
          style={{ ...at(5), backgroundImage: "repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in oklab, var(--foreground) 12%, transparent) 7px 8px)" }}
        />
      </div>
      <dl className="tape-step mt-3 grid grid-cols-2 gap-3 text-sm tabular-nums" style={at(5)}>
        <div className="border-l-4 border-paypal pl-3">
          <dt className="text-muted-foreground">Captured by PayPal</dt>
          <dd className="font-display text-2xl font-semibold">{formatUsd(CAPTURE)}</dd>
        </div>
        <div className="border-l-4 border-foreground/20 pl-3">
          <dt className="text-muted-foreground">Authorization voided</dt>
          <dd className="font-display text-2xl font-semibold">{formatUsd(DEPOSIT - CAPTURE)}</dd>
        </div>
      </dl>
    </figure>
  );
}
