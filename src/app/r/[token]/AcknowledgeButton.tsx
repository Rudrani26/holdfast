"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function AcknowledgeButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/r/${encodeURIComponent(token)}/baseline-ack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) setError(body?.error?.message ?? `Could not save (HTTP ${res.status}).`);
      else router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="w-full" onClick={() => void acknowledge()} disabled={pending}>
        {pending ? "Saving…" : "I agree these photos show the item's condition"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
