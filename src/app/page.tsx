import { Check, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { GeminiTag, PayPalTag, PersonTag } from "@/components/Provenance";
import { SettlementTape } from "@/components/SettlementTape";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/money";
import { getRepo } from "@/server/deps";

const focus = "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

const TRY_STEPS: { title: string; body: string; href?: string; cta?: string }[] = [
  { title: "Rent the headphones", body: "Approve the deposit with a PayPal Sandbox buyer account. PayPal places a hold; nothing is charged.", href: "#rent", cta: "Pick an item" },
  { title: "Inspect as staff", body: "Upload check-out and return photos and let Gemini compare them. The passcode is in the Devpost testing instructions.", href: "/staff", cta: "Open the staff workspace" },
  { title: "Answer as the renter", body: "Open the renter link from the staff page. See every photo and price, then accept or contest each line." },
  { title: "Settle", body: "Watch PayPal capture the agreed amount and void the rest, with signature-verified webhooks in the timeline." },
];

export default function Storefront() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        <section aria-labelledby="hero" className="grid items-center gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
          <div>
            <h1 id="hero" className="max-w-[14ch] text-[2.6rem] leading-[1.02] font-bold tracking-[-0.02em] text-balance sm:text-6xl">
              Deposits settled on evidence, not arguments.
            </h1>
            <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
              Holdfast keeps a rental deposit as a PayPal hold, has Gemini compare photos from pickup and return, prices anything new from the
              shop&apos;s own list, and takes only what the renter agrees to. The rest of the hold is voided.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Who does what">
              <li>
                <PayPalTag>PayPal holds and settles the money</PayPalTag>
              </li>
              <li>
                <GeminiTag>Gemini proposes, never decides</GeminiTag>
              </li>
              <li>
                <PersonTag>People approve every cent</PersonTag>
              </li>
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="#try" className={`inline-flex h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-primary/90 ${focus}`}>
                Try the live demo
              </a>
              <Link href="/how-it-works" className={`rounded-sm font-medium text-primary underline underline-offset-4 ${focus}`}>
                See how deposits are settled
              </Link>
            </div>
          </div>
          <SettlementTape />
        </section>

        <section id="try" aria-labelledby="try-heading" className="scroll-mt-6 rounded-2xl bg-foreground px-5 py-8 text-background sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="try-heading" className="text-3xl font-bold tracking-tight">
              Try it live, end to end
            </h2>
            <p className="text-sm text-background/75">Real PayPal Sandbox calls and live Gemini inspections. About 10 minutes.</p>
          </div>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRY_STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 border-t border-background/25 pt-4">
                <span className="font-display text-4xl font-bold text-hold tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-background/80">{s.body}</p>
                {s.href && (
                  <Link
                    href={s.href}
                    className="mt-auto self-start rounded-sm pt-1 text-sm font-medium text-background underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-hold focus-visible:outline-none"
                  >
                    {s.cta}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="engines-heading" className="py-16 sm:py-20">
          <h2 id="engines-heading" className="max-w-[30ch] text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Two engines, fenced apart. A person stands between them.
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
            <article aria-labelledby="paypal-heading" className="rounded-2xl border-2 border-paypal/20 bg-paypal-soft p-6">
              <PayPalTag>PayPal Orders v2, sandbox</PayPalTag>
              <h3 id="paypal-heading" className="mt-3 font-display text-2xl font-semibold text-paypal">
                Moves the money
              </h3>
              <ul className="mt-4 flex flex-col gap-3 text-sm leading-relaxed">
                <Fact>Creates the order with intent AUTHORIZE, so the deposit is a hold, not a payment.</Fact>
                <Fact>Captures only the agreed amount, then voids the rest of the authorization.</Fact>
                <Fact>Every write carries a fixed PayPal-Request-Id, so a retry can never charge twice.</Fact>
                <Fact>Webhooks count only after PayPal verifies their signature.</Fact>
              </ul>
            </article>
            <div className="flex items-center justify-center lg:flex-col" aria-hidden="true">
              <span className="h-px w-16 bg-border lg:h-16 lg:w-px" />
              <span className="m-2 rounded-full bg-card px-3 py-1 text-xs font-semibold ring-1 ring-foreground/25">Staff + renter</span>
              <span className="h-px w-16 bg-border lg:h-16 lg:w-px" />
            </div>
            <article aria-labelledby="gemini-heading" className="rounded-2xl border-2 border-dashed border-ai/35 bg-ai-soft p-6">
              <GeminiTag>Gemini 3.7 Flash on Vertex AI</GeminiTag>
              <h3 id="gemini-heading" className="mt-3 font-display text-2xl font-semibold text-ai">
                Reads the photos
              </h3>
              <ul className="mt-4 flex flex-col gap-3 text-sm leading-relaxed">
                <Fact>At pickup, lists the marks already on each of 6 angles, so they are never charged later.</Fact>
                <Fact>At return, compares each angle and proposes new damage with a box, type, severity, confidence and evidence.</Fact>
                <Fact>Answers in schema-checked JSON. Under 50% confidence is shown as a note, never priced.</Fact>
                <Fact no>Never sees a price and has no code path to PayPal.</Fact>
              </ul>
            </article>
          </div>

          <aside aria-labelledby="eval-heading" className="mt-10 grid gap-4 rounded-2xl border bg-card p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
            <h3 id="eval-heading" className="font-display text-xl font-semibold">
              Tested on our own gear
            </h3>
            <p className="max-w-[78ch] text-sm leading-relaxed text-muted-foreground">
              On 8 real photo pairs, Gemini found the damage on all 3 damaged items and left pre-existing marks uncharged. On 5 clean returns it
              proposed one false charge: a grille &ldquo;dent&rdquo; on a speaker shot farther away in direct sun. That is exactly why staff confirm
              every line and the renter can contest it before PayPal captures anything.
            </p>
          </aside>
        </section>

        <section id="rent" aria-labelledby="rent-heading" className="scroll-mt-6">
          <h2 id="rent-heading" className="text-3xl font-bold tracking-tight">
            Rent something
          </h2>
          <p className="mt-2 max-w-[60ch] text-muted-foreground">
            Kestrel Gear Rentals is a demo shop. Your deposit is a hold, not a charge, and nothing is captured until you agree.
          </p>
          <Suspense fallback={<ItemGridSkeleton />}>
            <ItemGrid />
          </Suspense>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function Fact({ children, no = false }: { children: ReactNode; no?: boolean }) {
  const Icon = no ? X : Check;
  return (
    <li className="flex gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

async function ItemGrid() {
  await connection();
  const items = await getRepo().listItems({ activeOnly: true });
  if (items.length === 0) {
    return <p className="mt-8 text-muted-foreground">No items are available right now.</p>;
  }
  return (
    <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="group flex flex-col overflow-hidden rounded-2xl border bg-card">
          <div className="relative">
            <Image
              src={`/api/items/${item.id}/image`}
              alt={item.description}
              width={1600}
              height={1195}
              unoptimized
              className="aspect-[4/3] w-full object-cover"
            />
            <span className="absolute bottom-3 left-3 rounded-full bg-hold px-2.5 py-1 text-xs font-semibold text-foreground tabular-nums">
              {formatUsd(item.depositCents)} hold
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-5">
            <h3 className="font-display text-xl font-semibold">{item.name}</h3>
            <p className="text-sm text-muted-foreground">{item.description}</p>
            <p className="mt-1 text-sm tabular-nums">
              <span className="font-semibold">{formatUsd(item.dailyRateCents)}</span> <span className="text-muted-foreground">per day</span>
            </p>
            <Link
              href={`/rent/${item.id}`}
              className={`mt-auto inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${focus}`}
            >
              Rent {item.name.toLowerCase()}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ItemGridSkeleton() {
  return (
    <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading items">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="mt-4 h-6 w-2/3" />
          <Skeleton className="mt-2 h-4 w-full" />
        </li>
      ))}
    </ul>
  );
}
