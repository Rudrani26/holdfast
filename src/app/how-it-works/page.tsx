import Link from "next/link";
import { DepositLedger } from "@/components/DepositLedger";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "How deposits work · Holdfast" };

type Actor = "renter" | "staff" | "ai" | "paypal";
const LANES: { actor: Actor; name: string }[] = [
  { actor: "renter", name: "You" },
  { actor: "staff", name: "Shop staff" },
  { actor: "ai", name: "Gemini (AI)" },
  { actor: "paypal", name: "PayPal" },
];
const COL: Record<Actor, string> = { renter: "md:col-start-2", staff: "md:col-start-3", ai: "md:col-start-4", paypal: "md:col-start-5" };
const TONE: Record<Actor, string> = {
  renter: "border-foreground/25 bg-card",
  staff: "border-foreground/25 bg-card",
  ai: "border-dashed border-ai/50 bg-ai-soft text-ai",
  paypal: "border-paypal/30 bg-paypal-soft text-paypal",
};

/** The real order of events in the app; each action sits in the lane of whoever does it. */
const STAGES: { stage: string; actions: { actor: Actor; text: string }[] }[] = [
  { stage: "Booking", actions: [{ actor: "renter", text: "Approve the deposit in PayPal" }, { actor: "paypal", text: "Places a hold on the deposit. Nothing is charged." }] },
  { stage: "Pickup", actions: [{ actor: "staff", text: "Photograph the item from 6 angles" }, { actor: "ai", text: "Lists marks that are already there" }, { actor: "renter", text: "Confirm the photos and existing marks" }] },
  { stage: "Return", actions: [{ actor: "staff", text: "Photograph the same 6 angles" }, { actor: "ai", text: "Compares each angle and proposes what looks new" }] },
  { stage: "Review", actions: [{ actor: "staff", text: "Check every finding, price it from the shop's list, confirm" }] },
  { stage: "Your decision", actions: [{ actor: "renter", text: "Accept each line, or contest it with a reason and photo" }] },
  { stage: "Settlement", actions: [{ actor: "staff", text: "Press Settle" }, { actor: "paypal", text: "Captures only the agreed amount and voids the rest of the hold" }] },
];

const GUARDRAILS: { title: string; body: string }[] = [
  { title: "AI proposes, people decide", body: "The AI compares photos and suggests what changed. Staff confirm every line and you accept or contest it. The AI's code has no path to PayPal." },
  { title: "Prices come from the shop's list", body: "The AI never sees prices. Every charge is a line from the shop's published price list, or a staff override that records a written reason." },
  { title: "Nothing is captured without your agreement", body: "Settlement runs only after staff confirm and you accept. Contest a line and it goes back to staff, for up to two rounds; you can still raise a dispute with PayPal." },
  { title: "Every PayPal action is checked and can't repeat", body: "Each capture or void is locked and sent with a fixed request ID, so a retry can never charge twice. PayPal's notifications are signature-verified before they count." },
  { title: "Sandbox only", body: "This demo uses PayPal Sandbox. No real money moves, and the app refuses to start against live PayPal." },
];

/** From eval/reports/eval-20261030050110.md (REAL cases only). Update when a new report is produced. */
const EVAL: { label: string; value: string; note: string }[] = [
  { label: "Clean returns with no charge proposed", value: "4 of 5", note: "One false charge (a speaker grille “dent” in direct sun): the kind of line staff review and contest exist to remove." },
  { label: "Damaged items flagged", value: "3 of 3", note: "Missing ear cushions, a cracked lens hood, a dented speaker." },
  { label: "Pre-existing marks left uncharged", value: "2 of 2", note: "Wear recorded at check-out was not charged again." },
];

export default function HowItWorksPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:py-14">
        <h1 className="max-w-[22ch] text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">How your deposit is settled</h1>
        <p className="mt-4 max-w-[60ch] text-lg text-muted-foreground">
          Holdfast keeps your deposit as a PayPal hold and only takes what you agreed to. Here is who does what, in order.
        </p>

        <section aria-labelledby="flow-heading" className="mt-12">
          <h2 id="flow-heading" className="sr-only">
            Who does what
          </h2>
          <div aria-hidden="true" className="hidden gap-3 border-b pb-2 text-sm font-semibold md:grid md:grid-cols-[8rem_repeat(4,minmax(0,1fr))]">
            <span />
            {LANES.map((l) => (
              <span key={l.actor} className={l.actor === "ai" ? "text-ai" : l.actor === "paypal" ? "text-paypal" : undefined}>
                {l.name}
              </span>
            ))}
          </div>
          <ol className="flex flex-col">
            {STAGES.map((s) => (
              <li key={s.stage} className="grid gap-2 border-b py-4 md:grid-cols-[8rem_repeat(4,minmax(0,1fr))] md:gap-3">
                <h3 className="text-sm font-semibold md:col-start-1 md:row-span-3 md:pt-2">{s.stage}</h3>
                {s.actions.map((a) => (
                    <p key={a.text} className={`rounded-md border p-3 text-sm md:row-start-1 ${COL[a.actor]} ${TONE[a.actor]}`}>
                      <span className="mb-1 block text-xs font-semibold md:sr-only">{LANES.find((l) => l.actor === a.actor)!.name}</span>
                      {a.text}
                    </p>
                  ))}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">The AI lane never meets the PayPal lane: money only moves after a person has decided.</p>
        </section>

        <section aria-labelledby="eval-heading" className="mt-16 rounded-2xl border bg-card p-6">
          <h2 id="eval-heading" className="text-2xl font-semibold tracking-tight">
            How the AI did on real photos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evaluation run of Oct 30, 2026 on 8 real photo sets of our own gear (source: REAL, no AI-edited images). Too few cases for an
            accuracy claim; read each number as evidence, not a rate.
          </p>
          <dl className="mt-5 grid gap-5 sm:grid-cols-3">
            {EVAL.map((e) => (
              <div key={e.label} className="border-l-4 border-ai/60 pl-4">
                <dt className="text-sm text-muted-foreground">{e.label}</dt>
                <dd className="font-display text-3xl font-semibold tabular-nums">{e.value}</dd>
                <dd className="mt-1 text-sm">{e.note}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="rules-heading" className="mt-16 grid gap-10 md:grid-cols-[1fr_22rem]">
          <div>
            <h2 id="rules-heading" className="text-2xl font-semibold tracking-tight">
              The rules Holdfast follows
            </h2>
            <dl className="mt-6 flex flex-col gap-6">
              {GUARDRAILS.map((g) => (
                <div key={g.title} className="border-l-4 border-hold pl-4">
                  <dt className="font-semibold">{g.title}</dt>
                  <dd className="mt-1 max-w-[60ch] text-muted-foreground">{g.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <aside aria-labelledby="clean-heading" className="self-start rounded-lg border bg-card p-5">
            <h2 id="clean-heading" className="mb-4 font-semibold">
              If nothing new is found
            </h2>
            <DepositLedger
              depositCents={20000}
              deductionCents={0}
              caption="The report says “No new damage detected”, you tap “Looks right”, and the whole authorization is voided. You are not charged."
            />
          </aside>
        </section>

        <p className="mt-16">
          <Link href="/" className="rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            Browse rental gear
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
