"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Staff cancel before check-out: voids the PayPal authorization (POST /api/rentals/[id]/cancel). */
export function CancelRentalButton({ rentalId, deposit }: { rentalId: string; deposit: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/rentals/${encodeURIComponent(rentalId)}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? `Cancel failed (HTTP ${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. The authorization may or may not be voided; refresh to see its status.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Cancel rental</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this rental?</DialogTitle>
          <DialogDescription>
            Holdfast will void the {deposit} PayPal deposit authorization. The renter is not charged. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Keep rental
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void cancel()} disabled={pending}>
            {pending ? "Voiding…" : "Void authorization and cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
