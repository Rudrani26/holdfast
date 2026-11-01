import { Landmark, ListOrdered, Sparkles, User } from "lucide-react";
import type { ReactNode } from "react";
import { formatUsd } from "@/lib/money";

// The provenance language used across the app: PayPal (blue, solid) moves money, Gemini (violet,
// dashed: a proposal, never a fact) suggests findings, people (ink) decide.

export function HoldfastMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      {/* a clasp: the deposit is held, not taken */}
      <path d="M10 14.5V12a6 6 0 0 1 12 0v2.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="7.5" y="14.5" width="17" height="11" rx="2.5" fill="var(--color-hold)" />
      <circle cx="16" cy="20" r="1.8" className="fill-foreground" />
    </svg>
  );
}

export function PayPalTag({ children = "PayPal", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-paypal-soft px-2 py-0.5 text-xs font-semibold text-paypal ring-1 ring-paypal/25 ${className}`}>
      <Landmark className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

export function GeminiTag({ children = "Gemini", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-ai/60 bg-ai-soft px-2 py-0.5 text-xs font-semibold text-ai ${className}`}>
      <Sparkles className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Where a line's amount came from: the shop's price list, or a staff override (never the AI). */
export function PriceSourceChip({ cents, source }: { cents: number; source: "PRICE_LIST" | "STAFF_OVERRIDE" }) {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-card px-2.5 py-1 text-xs font-medium ring-1 ring-foreground/25">
      <ListOrdered className="size-3.5" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{formatUsd(cents)}</span>
      {source === "PRICE_LIST" ? "from Kestrel's price list, not the AI" : "set by staff, reason logged"}
    </span>
  );
}

export function PersonTag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-foreground ring-1 ring-foreground/25 ${className}`}>
      <User className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}
