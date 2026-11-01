"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Starts an AI inspection. Disabled while running so one click = one bounded set of model calls. */
export function RunInspectionButton({ rentalId, kind, label, disabled }: { rentalId: string; kind: "BASELINE" | "RETURN"; label: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Honest progress: the server inspects all angles in one request, so show elapsed time, not a fake per-angle count.
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [pending]);

  async function run() {
    setSeconds(0);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rentals/${encodeURIComponent(rentalId)}/inspections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) setError(body?.error?.message ?? `Inspection failed (HTTP ${res.status}).`);
      router.refresh();
    } catch {
      setError("Network error. Refresh to see whether the inspection finished.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={() => void run()} disabled={disabled || pending}>
        {pending ? `Gemini is ${kind === "RETURN" ? "comparing" : "checking"} each angle… ${seconds} s` : label}
      </Button>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {pending ? "Live call to Gemini on Vertex AI, usually 10–30 s. Keep this page open." : null}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
