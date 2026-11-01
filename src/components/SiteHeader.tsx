import Link from "next/link";
import { HoldfastMark } from "@/components/Provenance";

const link =
  "rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Header with the always-visible sandbox banner (PRD S1). */
export function SiteHeader() {
  return (
    <header className="border-b bg-card">
      <p className="bg-hold-soft px-4 py-1.5 text-center text-sm font-medium text-hold-ink">
        Sandbox demo: PayPal Sandbox only, no real money moves.
      </p>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5 rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <HoldfastMark />
          <span className="flex flex-col leading-tight">
            <span className="font-display text-lg font-bold tracking-tight">Holdfast</span>
            <span className="text-xs text-muted-foreground">at Kestrel Gear Rentals, a demo shop</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-5">
          <Link href="/how-it-works" className={link}>
            How deposits work
          </Link>
          <Link href="/staff" className={link}>
            Staff workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Footer naming what the demo is built on. */
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Built with <span className="font-semibold text-paypal">PayPal Orders v2</span> (sandbox) and{" "}
          <span className="font-semibold text-ai">Gemini on Google Vertex AI</span>.
        </p>
        <p>A hackathon demo. No real money moves.</p>
      </div>
    </footer>
  );
}
