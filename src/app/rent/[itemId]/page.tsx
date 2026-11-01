import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { getEnv } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { getRepo } from "@/server/deps";
import { BookingForm } from "./BookingForm";

export const metadata = { title: "Book · Holdfast" };

export default function RentPage({ params }: PageProps<"/rent/[itemId]">) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← All items
        </Link>
        <Suspense fallback={<Skeleton className="mt-6 h-96 w-full" />}>
          <Booking params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}

async function Booking({ params }: { params: PageProps<"/rent/[itemId]">["params"] }) {
  const { itemId } = await params;
  if (!/^[a-z0-9-]{1,64}$/.test(itemId)) notFound();
  const item = await getRepo().getItem(itemId);
  if (!item?.active) notFound();
  const paypalClientId = getEnv().NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  return (
    <div className="mt-6 grid gap-8 md:grid-cols-[2fr_3fr]">
      <section aria-labelledby="item-name">
        <Image
          src={`/api/items/${item.id}/image`}
          alt={item.description}
          width={1600}
          height={1195}
          unoptimized
          className="aspect-[4/3] w-full rounded-lg border object-cover"
        />
        <h1 id="item-name" className="mt-4 text-2xl font-semibold tracking-tight">
          {item.name}
        </h1>
        <p className="mt-1 text-muted-foreground">{item.description}</p>
        <p className="mt-3 text-sm tabular-nums">
          {formatUsd(item.dailyRateCents)} per day · {formatUsd(item.depositCents)} deposit hold
        </p>
      </section>
      {paypalClientId ? (
        <BookingForm
          item={{ id: item.id, name: item.name, depositCents: item.depositCents, dailyRateCents: item.dailyRateCents }}
          paypalClientId={paypalClientId}
        />
      ) : (
        <p role="alert" className="text-destructive">
          Booking is unavailable: PayPal is not configured (NEXT_PUBLIC_PAYPAL_CLIENT_ID).
        </p>
      )}
    </div>
  );
}
