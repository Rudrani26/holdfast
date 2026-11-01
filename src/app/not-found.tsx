import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Not found · Kestrel Gear Rentals (demo)" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="text-muted-foreground">The link may be mistyped, or the item is no longer available.</p>
        <Link href="/" className="self-start rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          Browse rental gear
        </Link>
      </main>
    </>
  );
}
