"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PayPalDepositButton } from "@/components/PayPalDepositButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bookingInput, RENTAL_DAYS } from "@/lib/booking";
import { formatUsd } from "@/lib/money";

interface Props {
  item: { id: string; name: string; depositCents: number; dailyRateCents: number };
  paypalClientId: string;
}

type Days = (typeof RENTAL_DAYS)[number];

/** Step 1: renter details → creates a DRAFT rental. Step 2: PayPal deposit authorization. */
export function BookingForm({ item, paypalClientId }: Props) {
  const router = useRouter();
  const [days, setDays] = useState<Days>(2);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const [rentalId, setRentalId] = useState<string | null>(null);

  const deposit = formatUsd(item.depositCents);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = bookingInput.safeParse({ itemId: item.id, days, renterName: name, renterEmail: email });
    if (!parsed.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "renterName") fieldErrors.name ??= issue.message;
        else if (issue.path[0] === "renterEmail") fieldErrors.email ??= issue.message;
        else fieldErrors.form ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const res = await fetch("/api/rentals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => null)) as { rentalId?: string; error?: { message?: string } } | null;
      if (res.ok && body?.rentalId) setRentalId(body.rentalId);
      else setErrors({ form: body?.error?.message ?? `Booking failed (HTTP ${res.status}).` });
    } catch {
      setErrors({ form: "Network error. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  if (rentalId) {
    return (
      <section aria-labelledby="pay-heading" className="flex flex-col gap-4">
        <h2 id="pay-heading" className="text-xl font-semibold">
          Authorize your {deposit} deposit
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Renter</dt>
          <dd>
            {name} · {email}
          </dd>
          <dt className="text-muted-foreground">Rental</dt>
          <dd className="tabular-nums">
            {days} day{days > 1 ? "s" : ""} · rental fee {formatUsd(item.dailyRateCents * days)}, paid at pickup (not charged in this demo)
          </dd>
        </dl>
        <DepositExplainer deposit={deposit} />
        <PayPalDepositButton
          clientId={paypalClientId}
          rentalId={rentalId}
          onAuthorized={(confirmationPath) => router.push(confirmationPath)}
        />
        <Button type="button" variant="ghost" className="self-start" onClick={() => setRentalId(null)}>
          Edit details
        </Button>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-labelledby="details-heading">
      <h2 id="details-heading" className="text-xl font-semibold">
        Your booking
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Rental length</legend>
        <div className="flex gap-2">
          {RENTAL_DAYS.map((d) => (
            <label
              key={d}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input type="radio" name="days" value={d} checked={days === d} onChange={() => setDays(d)} className="accent-primary" />
              {d} day{d > 1 ? "s" : ""}
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          Rental fee {formatUsd(item.dailyRateCents * days)}, paid at pickup (not charged in this demo).
        </p>
      </fieldset>
      <Field id="renter-name" label="Full name" error={errors.name}>
        <Input
          id="renter-name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "renter-name-error" : undefined}
        />
      </Field>
      <Field id="renter-email" label="Email" error={errors.email}>
        <Input
          id="renter-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "renter-email-error" : undefined}
        />
      </Field>
      <DepositExplainer deposit={deposit} />
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {errors.form}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Continue to deposit"}
      </Button>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function DepositExplainer({ deposit }: { deposit: string }) {
  return (
    <p className="rounded-md border-l-4 border-hold bg-hold-soft p-3 text-sm text-hold-ink">
      <strong>{deposit} authorization: a hold, not a charge.</strong> You&apos;ll approve any deduction before
      it&apos;s taken.
    </p>
  );
}
