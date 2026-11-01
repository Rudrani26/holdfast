import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { CopyButton } from "@/components/CopyButton";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { AwaitPayPalWebhook } from "@/components/AwaitPayPalWebhook";
import { Timeline } from "@/components/Timeline";
import { buildTimeline } from "@/lib/timeline";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { verifyRenterToken } from "@/lib/authTokens";
import { rentalIdSchema } from "@/lib/booking";
import { getEnv } from "@/lib/env";
import { authorizedCopy } from "@/lib/settlementCopy";
import { authSecrets } from "@/server/auth";
import { getRepo } from "@/server/deps";

export const metadata = { title: "Booking confirmed · Holdfast", robots: { index: false } };

export default function ConfirmedPage(props: PageProps<"/rent/confirmed/[rentalId]">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Suspense fallback={<Skeleton className="h-80 w-full" />}>
          <Confirmation {...props} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

async function Confirmation({ params, searchParams }: PageProps<"/rent/confirmed/[rentalId]">) {
  const { rentalId } = await params;
  const { t } = await searchParams;
  // Token and session checks read the clock: render at request time, never during prerender.
  await connection();
  if (!rentalIdSchema.safeParse(rentalId).success) notFound();
  // The token comes from the authorize response, so only the person who approved in PayPal has it.
  const check = verifyRenterToken(authSecrets().renterLinkSecret, typeof t === "string" ? t : undefined, { forRentalId: rentalId });
  if (!check.ok) {
    return (
      <p role="alert" className="text-destructive">
        This confirmation link is invalid or has expired.
      </p>
    );
  }
  const repo = getRepo();
  const rental = await repo.getRental(rentalId);
  if (!rental) notFound();
  const [item, events] = await Promise.all([repo.getItem(rental.itemId), repo.listEvents(rental.id)]);
  const held = rental.paymentState !== "NONE" && rental.paymentState !== "ORDER_CREATED";
  const renterLink = `${getEnv().APP_BASE_URL ?? ""}/r/${t as string}`;

  return (
    <article className="flex flex-col gap-6">
      <header>
        <Badge variant={held ? "default" : "outline"}>{held ? "✓ Deposit authorized" : "Awaiting deposit"}</Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {held ? "Booking confirmed" : "Booking not yet authorized"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {item?.name ?? rental.itemId} · {rental.days} day{rental.days > 1 ? "s" : ""} · {rental.renter.name}
        </p>
      </header>

      {held ? (
        <p className="rounded-md border bg-muted/40 p-4 font-medium tabular-nums">{authorizedCopy(rental.depositCents)}</p>
      ) : (
        <p className="rounded-md border p-4">PayPal has not placed the deposit hold for this booking yet.</p>
      )}

      <section aria-labelledby="pickup">
        <h2 id="pickup" className="text-lg font-semibold">
          Show this at pickup
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Booking</dt>
          <dd className="font-mono break-all">{rental.id}</dd>
          <dt className="text-muted-foreground">PayPal authorization</dt>
          <dd className="font-mono break-all">{rental.paypal.authorizationId ?? "—"}</dd>
          <dt className="text-muted-foreground">PayPal status</dt>
          <dd className="font-mono">{rental.paypal.authStatus ?? "—"}</dd>
          <dt className="text-muted-foreground">Authorization expires</dt>
          <dd className="tabular-nums">
            {rental.paypal.authExpiresAt ? `${dateFmt.format(new Date(rental.paypal.authExpiresAt))} UTC` : "—"}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="renter-link">
        <h2 id="renter-link" className="text-lg font-semibold">
          Your renter link
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep this private link. At pickup you&apos;ll use it to confirm the item&apos;s condition photos, and after
          return to review any proposed deduction. Nothing is captured without your decision.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{renterLink}</code>
          <CopyButton text={renterLink} label="Copy renter link" />
        </div>
      </section>

      <Timeline events={events} heading="What has happened so far" />
      <AwaitPayPalWebhook waiting={buildTimeline(events).some((i) => i.paypalConfirmed === false)} />
    </article>
  );
}
