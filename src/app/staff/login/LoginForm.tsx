"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Only same-site staff paths are allowed as a post-login destination (no open redirect). */
function safeNext(next: string | null): string {
  return next && /^\/staff(\/[^/\\]*)*(\?.*)?$/.test(next) && !next.startsWith("/staff/login") ? next : "/staff";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.status === 204) {
        router.replace(safeNext(params.get("next")));
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? `Login failed (HTTP ${res.status}).`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="passcode" className="text-sm font-medium">
        Staff passcode
      </label>
      <Input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        required
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "login-error" : undefined}
      />
      <p id="login-error" role="alert" aria-live="polite" className="min-h-5 text-sm text-destructive">
        {error}
      </p>
      <Button type="submit" disabled={pending || passcode.length === 0}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
