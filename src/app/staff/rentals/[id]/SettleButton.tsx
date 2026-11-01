"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Staff press Settle (or Retry): POST /api/rentals/[id]/settle. The server decides the amount. */
export function SettleButton({ rentalId, label }: { rentalId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rentals/${encodeURIComponent(rentalId)}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) setError(body?.error?.message ?? `Settlement failed (HTTP ${res.status}).`);
    } catch {
      setError("Network error. Refresh to see what PayPal recorded before retrying; a retry checks PayPal first.");
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={() => void settle()} disabled={pending}>
        {pending ? "Settling with PayPal…" : label}
      </Button>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {pending ? "Keep this page open." : null}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
