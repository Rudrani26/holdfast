"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error state with retry (TASKS T-061). Shows no internals: the digest is a reference
 * the shop can find in the server logs.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="text-muted-foreground">
        Something went wrong on our side, often a brief connection problem with the database. Nothing was charged, and any PayPal hold is unchanged.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/" className="rounded-sm text-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          Go to the shop
        </Link>
      </div>
      {error.digest && <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>}
    </main>
  );
}
