"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 3000;
const MAX_MS = 60_000;

/**
 * While a PayPal action shown on the page still lacks its verified webhook, re-render the server
 * page every 3 s (for at most 60 s) so the "PayPal-confirmed" badge appears without a manual reload.
 * Read-only: it only refreshes server-rendered data, it never calls PayPal.
 */
export function AwaitPayPalWebhook({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > MAX_MS) {
        clearInterval(t);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, EVERY_MS);
    return () => clearInterval(t);
  }, [waiting, router]);

  if (!waiting) return null;
  return (
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
      {gaveUp ? "PayPal's webhook has not arrived yet. Refresh later to see it confirmed." : "Waiting for PayPal's signed webhook to confirm…"}
    </p>
  );
}
