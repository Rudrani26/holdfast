import Link from "next/link";
import { Suspense } from "react";
import { StatusChip, statusLabel } from "@/components/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/money";
import { getRepo } from "@/server/deps";
import { isRentalStatus, listRentalSummaries } from "@/server/rentalViews";
import { requireStaffPage } from "@/server/staffPage";
import { LogoutButton } from "./LogoutButton";

export const metadata = { title: "Rentals · Holdfast staff" };

const FILTERS = ["AUTHORIZED", "CHECKED_OUT", "AWAITING_RENTER", "CONTESTED", "READY_TO_SETTLE", "SETTLED", "SETTLEMENT_FAILED"] as const;
const timeFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** S5 rentals list (PRD §10). */
export default function StaffRentalsPage({ searchParams }: PageProps<"/staff">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rentals</h1>
          <p className="text-sm text-muted-foreground">Kestrel Gear Rentals (demo) · PayPal Sandbox</p>
        </div>
        <LogoutButton />
      </header>
      <Suspense fallback={<Skeleton className="mt-6 h-64 w-full" />}>
        <RentalsTable searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function RentalsTable({ searchParams }: { searchParams: PageProps<"/staff">["searchParams"] }) {
  const { status: raw } = await searchParams;
  const status = isRentalStatus(raw) ? raw : undefined;
  await requireStaffPage(status ? `/staff?status=${status}` : "/staff");
  const rentals = await listRentalSummaries(getRepo(), status);

  return (
    <>
      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-2 text-sm">
        {[undefined, ...FILTERS].map((f) => (
          <Link
            key={f ?? "all"}
            href={f ? `/staff?status=${f}` : "/staff"}
            aria-current={f === status ? "page" : undefined}
            className="rounded-full border px-3 py-1 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {f ? statusLabel(f) : "All"}
          </Link>
        ))}
      </nav>
      {rentals.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No rentals{status ? ` with status ${statusLabel(status)}` : ""}.</p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Renter</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Deposit</TableHead>
              <TableHead>Updated (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rentals.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/staff/rentals/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                    {r.renterName}
                  </Link>
                </TableCell>
                <TableCell>{r.itemName}</TableCell>
                <TableCell>
                  <StatusChip status={r.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(r.depositCents)}</TableCell>
                <TableCell className="tabular-nums">{timeFmt.format(new Date(r.updatedAt))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
