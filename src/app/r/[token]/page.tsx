import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Receipt } from "@/components/Receipt";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Timeline } from "@/components/Timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainError } from "@/domain/types";
import { formatUsd } from "@/lib/money";
import { authorizedCopy, plannedCopy } from "@/lib/settlementCopy";
import { getRepo } from "@/server/deps";
import { renterSession, renterView, type RenterView } from "@/server/renter";
import { AcknowledgeButton } from "./AcknowledgeButton";
import { DecisionForm } from "./DecisionForm";

// The path carries the renter token: never index it, never leak it in a Referer header.
export const metadata: Metadata = { title: "Your rental · Holdfast", robots: { index: false, follow: false }, referrer: "no-referrer" };

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** S7 renter page (PRD §10), mobile-first. T-040: baseline acknowledgement; decision/receipt follow in T-041/T-043. */
export default function RenterPage({ params }: PageProps<"/r/[token]">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Renter params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Renter({ params }: { params: PageProps<"/r/[token]">["params"] }) {
  const { token } = await params;
  // Token and session checks read the clock: render at request time, never during prerender.
  await connection();
  let view: RenterView;
  try {
    view = await renterView(getRepo(), renterSession(token), token);
  } catch (e) {
    return (
      <p role="alert" className="text-destructive">
        {e instanceof DomainError ? e.message : "This page could not be loaded."}
      </p>
    );
  }

  return (
    <article className="flex flex-col gap-6">
      <header>
        <p className="text-sm text-muted-foreground">Hi {view.renterName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{view.itemName}</h1>
        <p className="mt-1 text-sm tabular-nums">
          {view.days} day{view.days > 1 ? "s" : ""} · {authorizedCopy(view.depositCents)}
        </p>
      </header>
      <StateBody view={view} token={token} />
    </article>
  );
}

function StateBody({ view, token }: { view: RenterView; token: string }) {
  switch (view.status) {
    case "AUTHORIZED":
      return <Panel title="The shop is photographing the item">At pickup, staff photograph it from 6 angles. You&apos;ll confirm those photos here before you leave.</Panel>;
    case "BASELINE_READY":
      return view.baseline ? <BaselineAck view={view} token={token} /> : <Panel title="Almost ready">The check-out photos are being prepared. Refresh in a moment.</Panel>;
    case "CHECKED_OUT":
    case "RETURNED":
    case "INSPECTED":
      return (
        <>
          <Panel title="Check-out photos confirmed">
            You confirmed the item&apos;s condition{view.baselineAckAt ? ` on ${dateFmt.format(new Date(view.baselineAckAt))} UTC` : ""}. After you return it, the shop compares the same angles. If anything is proposed, you&apos;ll see the photos and the price here and decide before anything is charged.
          </Panel>
          {view.baseline && <BaselineGallery view={view} />}
        </>
      );
    case "AWAITING_RENTER":
      return view.report ? (
        <DecisionForm token={token} report={view.report} depositCents={view.depositCents} plannedText={plannedCopy(view.settlementMode, view.depositCents, view.report.deductionCents)} />
      ) : (
        <Panel title="Your return report">The report is being prepared. Refresh in a moment.</Panel>
      );
    case "CONTESTED": {
      const n = view.report?.lines.filter((l) => l.renterDecision === "CONTESTED").length ?? 0;
      return (
        <Panel title="Thanks — the shop is reviewing your response">
          You contested {n} line{n === 1 ? "" : "s"}. The shop will look at your reasons and photos and send an updated report to this page. Nothing has been charged.
        </Panel>
      );
    }
    case "READY_TO_SETTLE":
      return (
        <Panel title={view.report && view.report.lines.length === 0 ? "Thanks — confirmed" : `Thanks — you accepted ${formatUsd(view.report?.deductionCents ?? 0)}`}>
          {plannedCopy(view.settlementMode, view.depositCents, view.report?.deductionCents ?? 0)} You&apos;ll see the PayPal result and receipt here.
        </Panel>
      );
    case "SETTLED":
    case "SETTLEMENT_FAILED":
      return view.receipt ? (
        <>
          <Receipt receipt={view.receipt} heading={view.status === "SETTLED" ? "Your receipt" : "Settlement status"} />
          <Suspense fallback={null}>
            <RenterTimeline rentalId={view.rentalId} />
          </Suspense>
        </>
      ) : (
        <Panel title="Receipt">Your receipt is being prepared.</Panel>
      );
    case "CANCELLED":
      return <Panel title="Rental cancelled">The deposit authorization was voided. You were not charged.</Panel>;
    default:
      return <Panel title="Booking in progress">The deposit hold has not been placed yet.</Panel>;
  }
}

/** Server-rendered through the allowlisting Timeline component; raw event data never reaches the client. */
async function RenterTimeline({ rentalId }: { rentalId: string }) {
  return <Timeline events={await getRepo().listEvents(rentalId)} heading="What happened" />;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-muted/30 p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm">{children}</p>
    </section>
  );
}

function BaselineAck({ view, token }: { view: RenterView; token: string }) {
  const marks = view.baseline!.angles.reduce((n, a) => n + a.marks.length, 0);
  return (
    <section aria-labelledby="ack-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="ack-heading" className="text-lg font-semibold">
          Please confirm the item&apos;s condition
        </h2>
        <p className="mt-1 text-sm">
          These photos were taken at pickup. {marks > 0 ? `${marks} existing mark${marks === 1 ? " is" : "s are"} recorded below; ` : "No existing marks were found; "}
          anything recorded now can never be charged to you.
        </p>
      </div>
      <BaselineGallery view={view} />
      <AcknowledgeButton token={token} />
      <p className="text-xs text-muted-foreground">If something is missing from the list, tell the staff now so they can photograph it before you leave.</p>
    </section>
  );
}

function BaselineGallery({ view }: { view: RenterView }) {
  return (
    <ul className="flex flex-col gap-4">
      {view.baseline!.angles.map((a) => (
        <li key={a.angleId} className="overflow-hidden rounded-lg border">
          {a.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- token-authenticated API image
            <img src={a.photoUrl} alt={`Check-out photo: ${a.label}`} className="aspect-[4/3] w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <p className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">No photo</p>
          )}
          <div className="p-3 text-sm">
            <p className="font-medium">{a.label}</p>
            {a.marks.length === 0 ? (
              <p className="text-muted-foreground">No existing marks</p>
            ) : (
              <ul className="mt-1 list-disc pl-5">
                {a.marks.map((m) => (
                  <li key={m.markId}>
                    Existing {pretty(m.damageType).toLowerCase()} ({pretty(m.severity).toLowerCase()}): {m.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
