"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PhotoPair } from "@/components/report/PhotoPair";
import { Button } from "@/components/ui/button";
import { PriceSourceChip } from "@/components/Provenance";
import { formatUsd } from "@/lib/money";
import type { RenterReport } from "@/server/renter";

type Choice = { decision: "ACCEPTED" | "CONTESTED" | undefined; comment: string; photo?: File; photoState?: "uploading" | "done" | "failed" };

async function post(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return body?.error?.message ?? `Something went wrong (HTTP ${res.status}).`;
  } catch {
    return "Network error. Check your connection and try again.";
  }
}

/** Renter decision (PRD §10 S7, TASKS T-041): accept or contest each proposed line, or "Looks right" on a clean return. */
export function DecisionForm({ token, report, depositCents, plannedText }: { token: string; report: RenterReport; depositCents: number; plannedText: string }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(report.lines.map((l) => [l.lineId, { decision: undefined, comment: "" }])));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/r/${encodeURIComponent(token)}`;
  /** After 2 contest rounds the renter may only accept (rentalMachine MAX_CONTEST_ROUNDS). */
  const finalRound = report.contestRound >= 2;
  const set = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id]!, ...patch } }));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const lines = report.lines;
    if (lines.some((l) => !choices[l.lineId]?.decision)) return setError("Choose Accept or Contest for every line.");
    if (lines.some((l) => choices[l.lineId]!.decision === "CONTESTED" && !choices[l.lineId]!.comment.trim())) return setError("Tell the shop why you disagree with each contested line.");
    setPending(true);
    // Optional contest photos first (one per angle).
    for (const l of lines) {
      const c = choices[l.lineId]!;
      if (c.decision !== "CONTESTED" || !c.photo || c.photoState === "done") continue;
      set(l.lineId, { photoState: "uploading" });
      const form = new FormData();
      form.set("angleId", l.angleId);
      form.set("file", c.photo);
      const err = await post(`${base}/contest-photo`, { method: "POST", body: form });
      set(l.lineId, { photoState: err ? "failed" : "done" });
      if (err) {
        setPending(false);
        return setError(`Photo for “${l.label}”: ${err}`);
      }
    }
    const err = await post(`${base}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisions: lines.map((l) => ({ lineId: l.lineId, decision: choices[l.lineId]!.decision, ...(choices[l.lineId]!.comment.trim() ? { comment: choices[l.lineId]!.comment.trim() } : {}) })),
      }),
    });
    setPending(false);
    if (err) setError(err);
    else router.refresh();
  }

  if (report.lines.length === 0) {
    const clean = report.verdict === "NO_NEW_DAMAGE";
    return (
      <section aria-labelledby="clean-heading" className="flex flex-col gap-4">
        <div className="rounded-lg border border-emerald-700/30 bg-emerald-50/50 p-4">
          <h2 id="clean-heading" className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 className="size-6 text-emerald-700" aria-hidden="true" />
            {clean ? "No new damage detected — no deduction" : "No deduction proposed"}
          </h2>
          <p className="mt-1 text-sm">
            {clean ? `The shop compared all ${report.angles.length} angles with your check-out photos and found nothing new.` : "The shop reviewed the return photos and is not proposing any charge."} {plannedText}
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {report.angles.map((a) => (
            <li key={a.angleId} className="flex flex-col gap-1">
              {a.after ? (
                // eslint-disable-next-line @next/next/no-img-element -- token-authenticated API image
                <img src={a.after.url} alt={`Return photo: ${a.label}`} className="aspect-[4/3] w-full rounded-md border object-cover" loading="lazy" referrerPolicy="no-referrer" />
              ) : null}
              <span className="inline-flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3.5 text-emerald-700" aria-hidden="true" />
                {a.label}
              </span>
            </li>
          ))}
        </ul>
        {report.preExisting.length > 0 && (
          <div className="text-sm">
            <h3 className="font-semibold">Already recorded at check-out (not charged)</h3>
            <ul className="mt-1 list-disc pl-5">
              {report.preExisting.map((p, i) => (
                <li key={i}>
                  {p.angleLabel}: {p.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button size="lg" className="w-full" disabled={pending} onClick={() => void submit()}>
          {pending ? "Saving…" : "Looks right"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate aria-labelledby="decision-heading">
      <div>
        <h2 id="decision-heading" className="text-xl font-semibold">
          Proposed deduction: {formatUsd(report.deductionCents)}
        </h2>
        {report.contestRound > 0 && <p className="mt-1 text-sm font-medium">Updated after your contest (round {report.contestRound}).</p>}
        <p className="mt-1 text-sm">
          From your {formatUsd(depositCents)} deposit hold. Nothing is charged until you decide. If you accept: {plannedText.replace(/^The shop will/, "the shop will")}
        </p>
        {finalRound && (
          <p className="mt-2 rounded-md border bg-muted/40 p-3 text-sm">
            You have already contested twice, the limit in this app. You can accept here, or contact the shop. You also keep the right to raise a dispute with PayPal.
          </p>
        )}
      </div>
      <ol className="flex flex-col gap-5">
        {report.lines.map((l, i) => {
          const c = choices[l.lineId]!;
          const name = `line-${i}`;
          return (
            <li key={l.lineId} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{l.label}</h3>
                <span className="text-lg font-semibold tabular-nums">{formatUsd(l.amountCents)}</span>
              </div>
              <PriceSourceChip cents={l.amountCents} source={l.priceSource} />
              <PhotoPair angleLabel={l.angleLabel} before={l.before} after={l.after} boxes={l.box ? [{ id: l.lineId, box: l.box, tone: "new", label: l.label }] : []} />
              <p className="text-sm">{l.explanation}</p>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Your decision on {l.label}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(finalRound ? (["ACCEPTED"] as const) : (["ACCEPTED", "CONTESTED"] as const)).map((d) => (
                    <label key={d} className="flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
                      <input type="radio" name={name} value={d} checked={c.decision === d} onChange={() => set(l.lineId, { decision: d })} className="accent-primary" />
                      {d === "ACCEPTED" ? "Accept" : "Contest"}
                    </label>
                  ))}
                </div>
              </fieldset>
              {c.decision === "CONTESTED" && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${name}-why`} className="text-sm font-medium">
                    Why do you disagree? (required)
                  </label>
                  <textarea id={`${name}-why`} maxLength={500} rows={3} className="rounded-md border bg-background p-2 text-sm" value={c.comment} onChange={(e) => set(l.lineId, { comment: e.target.value })} />
                  <label className="text-sm font-medium">
                    Add a photo (optional)
                    <input type="file" accept="image/*" capture="environment" className="mt-1 block w-full text-sm" onChange={(e) => set(l.lineId, { photo: e.target.files?.[0], photoState: undefined })} />
                  </label>
                  {c.photoState === "uploading" && <p className="text-xs">Uploading photo…</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send my decision"}
      </Button>
      <p className="text-xs text-muted-foreground">If you contest, the shop reviews your reasons and photos and sends an updated report here. You keep your right to raise a dispute with PayPal.</p>
    </form>
  );
}
