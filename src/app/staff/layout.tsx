import Link from "next/link";
import { HoldfastMark } from "@/components/Provenance";

/** Staff area chrome: the sandbox banner appears on every page, staff included. */
export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <>
      <header className="border-b bg-card">
        <p className="bg-hold-soft px-4 py-1.5 text-center text-sm font-medium text-hold-ink">Sandbox demo: PayPal Sandbox only, no real money moves.</p>
        <div className="mx-auto w-full max-w-6xl px-4 py-3">
          <Link href="/staff" className="inline-flex items-center gap-2 rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <HoldfastMark className="size-6" />
            <span className="font-display font-bold tracking-tight">Holdfast</span>
            <span className="text-sm text-muted-foreground">staff workspace, Kestrel Gear Rentals</span>
          </Link>
        </div>
      </header>
      {children}
    </>
  );
}
