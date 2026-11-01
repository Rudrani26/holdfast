import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { CaptureGrid } from "@/components/capture/CaptureGrid";
import { StatusChip } from "@/components/StatusChip";
import { Stepper } from "@/components/Stepper";
import { Timeline } from "@/components/Timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { ALLOWED_FROM } from "@/domain/rentalMachine";
import type { Inspection, Item, LineItem, Photo, Rental, TimelineEvent } from "@/domain/types";
import { ReturnSummary } from "@/components/report/ReturnSummary";
import { BaselineSummary } from "@/components/report/BaselineSummary";
import { formatUsd } from "@/lib/money";
import { getRepo } from "@/server/deps";
import { rentalDetail } from "@/server/rentalViews";
import { requireStaffPage } from "@/server/staffPage";
import { CancelRentalButton } from "./CancelRentalButton";
import { RenterLinkBox } from "./RenterLinkBox";
import { ReviewPanel } from "./ReviewPanel";
import { SettlementPanel } from "./SettlementPanel";
import { RunInspectionButton } from "./RunInspectionButton";

export const metadata = { title: "Rental workspace · Holdfast staff" };

/** S6 rental workspace: stepper + the panel for the current step + timeline (PRD §10). */
export default function StaffRentalPage({ params }: PageProps<"/staff/rentals/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <Link href="/staff" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Rentals
      </Link>
      <Suspense fallback={<Skeleton className="mt-6 h-96 w-full" />}>
        <Workspace params={params} />
      </Suspense>
    </main>
  );
}

async function Workspace({ params }: { params: PageProps<"/staff/rentals/[id]">["params"] }) {
  const { id } = await params;
  // Token and session checks read the clock: render at request time, never during prerender.
  await connection();
  await requireStaffPage(`/staff/rentals/${id}`);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const detail = await rentalDetail(getRepo(), id);
  if (!detail) notFound();
  const { rental, item, photos, inspections, lineItems, events } = detail;
  const baseline = inspections.filter((i) => i.kind === "BASELINE").at(-1);
  const returnInspection = inspections.filter((i) => i.kind === "RETURN").at(-1);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{item?.name ?? rental.itemId}</h1>
            <StatusChip status={rental.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {rental.renter.name} · {rental.renter.email} · {rental.days} day{rental.days > 1 ? "s" : ""} ·{" "}
            <span className="tabular-nums">{formatUsd(rental.depositCents)}</span> deposit hold
          </p>
        </div>
        {ALLOWED_FROM.CANCELLED.includes(rental.status) && <CancelRentalButton rentalId={rental.id} deposit={formatUsd(rental.depositCents)} />}
      </header>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <Stepper status={rental.status} />
        <div className="flex min-w-0 flex-col gap-8">
          <StepPanel rental={rental} item={item} photos={photos} baseline={baseline} returnInspection={returnInspection} lines={lineItems} events={events} />
          <PaymentFacts rental={rental} />
          <Timeline events={events} />
        </div>
      </div>
    </div>
  );
}

function StepPanel({
  rental,
  item,
  photos,
  baseline,
  returnInspection,
  lines,
  events,
}: {
  rental: Rental;
  item?: Item;
  photos: Photo[];
  baseline?: Inspection;
  returnInspection?: Inspection;
  lines: LineItem[];
  events: TimelineEvent[];
}) {
  const phase = rental.status === "AUTHORIZED" ? "CHECKOUT" : rental.status === "CHECKED_OUT" || rental.status === "RETURNED" ? "CHECKIN" : undefined;
  if (phase && item) {
    return (
      <>
        <CaptureGrid
          rentalId={rental.id}
          phase={phase}
          angles={item.angles}
          photos={photos.filter((p) => p.phase === phase).map((p) => ({ angleId: p.angleId, sha256: p.sha256, provenance: p.provenance }))}
        />
        {phase === "CHECKOUT" ? (
          <>
            {baseline && <BaselineSummary inspection={baseline} angles={item.angles} />}
            <RunInspectionButton
              rentalId={rental.id}
              kind="BASELINE"
              label={baseline ? "Run AI baseline again" : "Run AI baseline"}
              disabled={!item.angles.every((a) => photos.some((p) => p.phase === "CHECKOUT" && p.angleId === a.id))}
            />
          </>
        ) : rental.status === "RETURNED" ? (
          <>
            {returnInspection && <ReturnSummary inspection={returnInspection} angles={item.angles} lines={lines} depositCents={rental.depositCents} />}
            <RunInspectionButton rentalId={rental.id} kind="RETURN" label={returnInspection ? "Run AI return inspection again" : "Run AI return inspection"} />
          </>
        ) : (
          <Note>Once all angles are uploaded the rental moves to Returned.</Note>
        )}
      </>
    );
  }
  if (rental.status === "READY_TO_SETTLE" || rental.status === "SETTLEMENT_FAILED" || rental.status === "SETTLED") {
    return <SettlementPanel rental={rental} events={events} returnInspection={returnInspection} />;
  }
  if ((rental.status === "INSPECTED" || rental.status === "CONTESTED" || rental.status === "AWAITING_RENTER") && returnInspection && item) {
    return <ReviewPanel rental={rental} item={item} photos={photos} inspection={returnInspection} lines={lines} />;
  }
  if (rental.status === "BASELINE_READY" && baseline && item) {
    return (
      <>
        <BaselineSummary inspection={baseline} angles={item.angles} />
        <RenterLinkBox rentalId={rental.id} intro="Waiting for the renter to confirm these check-out photos. Hand over or send this link (the renter can also use the link from their booking confirmation):" />
      </>
    );
  }
  const message: Partial<Record<Rental["status"], string>> = {
    DRAFT: "The renter has not started the PayPal deposit yet.",
    AWAITING_PAYMENT: "Waiting for the renter to approve the deposit in PayPal.",
    BASELINE_READY: "Waiting for the renter to acknowledge the baseline photos.",
    AWAITING_RENTER: "Waiting for the renter's decision.",
    CONTESTED: "The renter contested a line. Review their reasons and confirm an updated report.",
    CANCELLED: "Cancelled. The deposit authorization was voided.",
  };
  return <Note>{message[rental.status] ?? `Status: ${rental.status}`}</Note>;
}

function PaymentFacts({ rental }: { rental: Rental }) {
  const captured = rental.paypal.captures.reduce((s, c) => s + c.amountCents, 0);
  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="text-lg font-semibold">
        Payment
      </h2>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Payment state</dt>
        <dd className="font-mono">{rental.paymentState}</dd>
        {rental.approvedDeductionCents !== undefined && (
          <>
            <dt className="text-muted-foreground">Approved deduction</dt>
            <dd className="tabular-nums">{formatUsd(rental.approvedDeductionCents)}</dd>
          </>
        )}
        {captured > 0 && (
          <>
            <dt className="text-muted-foreground">Captured</dt>
            <dd className="tabular-nums">{formatUsd(captured)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Settlement mode</dt>
        <dd className="font-mono">{rental.settlementMode}</dd>
        <dt className="text-muted-foreground">Rental id</dt>
        <dd className="font-mono break-all">{rental.id}</dd>
      </dl>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border bg-muted/40 p-3 text-sm">{children}</p>;
}
