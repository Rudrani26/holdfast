"use client";

import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { GeminiTag, PriceSourceChip } from "@/components/Provenance";
import { Button } from "@/components/ui/button";
import type { DamageType, Finding, InspectionVerdict, LineItem, Severity } from "@/domain/types";
import { findingGroup, type FindingGroup } from "@/lib/findingGroups";
import { formatUsd } from "@/lib/money";
import { PhotoPair, type OverlayBox, type PairPhoto } from "./PhotoPair";

export interface AngleView {
  angleId: string;
  label: string;
  usable: boolean;
  issues: string[];
  needsHuman?: boolean;
  error?: string;
  noChangeConfidence?: number;
  findings: Finding[];
  before?: PairPhoto;
  after?: PairPhoto;
}

export interface RuleView {
  ref: string;
  label: string;
  amountCents: number;
  damageType: DamageType;
  severity: Severity;
}

export interface ContestView {
  decision: "ACCEPTED" | "CONTESTED";
  comment?: string;
  photo?: PairPhoto;
}

interface Props {
  rentalId: string;
  /** Previous-round renter decisions by current line id (T-042). */
  contests?: Record<string, ContestView>;
  contestRound?: number;
  /** After the contest limit: what settling only the accepted lines would deduct. */
  undisputed?: { cents: number; accepted: number; contested: number };
  depositCents: number;
  verdict: InspectionVerdict;
  aiNote: string;
  angles: AngleView[];
  lines: LineItem[];
  rules: RuleView[];
}

const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
const GROUPS: { key: FindingGroup; title: string; blurb: string; open: boolean }[] = [
  { key: "PROPOSED", title: "Proposed charges", blurb: "New damage the AI is confident about. Included by default; you decide.", open: true },
  { key: "NEEDS_EYES", title: "Needs your eyes", blurb: "The AI is unsure (50–75%). Excluded by default; include only if you agree.", open: true },
  { key: "PRE_EXISTING", title: "Pre-existing (not charged)", blurb: "Already recorded at check-out.", open: false },
  { key: "LOW_CONFIDENCE", title: "Low-confidence notes", blurb: "Below 50%: shown for transparency, never priced automatically.", open: false },
];

async function send(method: string, url: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> & { error?: { message?: string } };
    return res.ok ? { ok: true, json } : { ok: false, message: json.error?.message ?? `Request failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, message: "Network error. Try again." };
  }
}

/** Staff review of the return report (PRD §10 S6, TASKS T-034). Every change is saved and re-priced on the server. */
export function ReviewReport({ rentalId, depositCents, verdict, aiNote, angles, lines, rules, contests = {}, contestRound = 0, undisputed }: Props) {
  const contestedCount = Object.values(contests).filter((c) => c.decision === "CONTESTED").length;
  const lineFor = (angleId: string, findingId: string) => lines.find((l) => l.angleId === angleId && l.findingId === findingId);
  const included = lines.filter((l) => l.staffDecision === "INCLUDED");
  const unpriced = included.filter((l) => !l.priceRuleRef && !l.overrideReason);
  const subtotal = included.reduce((s, l) => s + l.amountCents, 0);
  const total = Math.min(subtotal, depositCents);
  const manual = lines.filter((l) => !l.findingId);

  const totals = (
    <TotalsPanel
      rentalId={rentalId}
      depositCents={depositCents}
      totalCents={total}
      capped={subtotal > depositCents}
      unpricedCount={unpriced.length}
      includedCount={included.length}
      clean={verdict === "NO_NEW_DAMAGE" && included.length === 0}
    />
  );

  if (verdict === "NO_NEW_DAMAGE" && included.length === 0 && manual.length === 0) {
    const existing = angles.flatMap((a) => a.findings.filter((f) => !f.isNew).map((f) => ({ a, f })));
    return (
      <section aria-labelledby="clean-heading" className="flex flex-col gap-5 rounded-lg border border-emerald-700/30 bg-emerald-50/40 p-5">
        <div>
          <h2 id="clean-heading" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CheckCircle2 className="size-7 text-emerald-700" aria-hidden="true" />
            No new damage detected
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{aiNote}</p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {angles.map((a) => (
            <li key={a.angleId} className="flex flex-col gap-1">
              <PhotoThumb photo={a.after} label={a.label} />
              <span className="inline-flex items-center gap-1 text-xs">
                <CheckCircle2 className="size-3.5 text-emerald-700" aria-hidden="true" />
                {a.label}: no change
              </span>
            </li>
          ))}
        </ul>
        {existing.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Already recorded at check-out (not charged)</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {existing.map(({ a, f }) => (
                <li key={`${a.angleId}-${f.findingId}`}>
                  {a.label}: {pretty(f.damageType)} — {f.evidence}
                </li>
              ))}
            </ul>
          </div>
        )}
        {totals}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Add a charge manually</summary>
          <ManualLineForm rentalId={rentalId} angles={angles} rules={rules} />
        </details>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">
          {verdict === "DAMAGE_PROPOSED" ? "Damage proposed — review each line" : verdict === "NO_NEW_DAMAGE" ? "No new damage detected (staff lines added)" : "No charges proposed — notes to glance at"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{aiNote}</p>
      </header>

      {contestedCount > 0 && (
        <p role="status" className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm">
          The renter contested {contestedCount} line{contestedCount > 1 ? "s" : ""} (contest round {contestRound} of 2). Their reasons and photos are shown beside each line. Revise (exclude, re-price or override with a reason), then confirm to send an updated report.
        </p>
      )}
      {undisputed && <SettleUndisputed rentalId={rentalId} {...undisputed} />}

      {angles.some((a) => !a.usable || a.needsHuman) && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Some angles were not inspected: {angles.filter((a) => !a.usable || a.needsHuman).map((a) => a.label).join(", ")}. Check them yourself.
        </p>
      )}

      {GROUPS.map((g) => {
        const items = angles.flatMap((a) => a.findings.filter((f) => findingGroup(f) === g.key).map((f) => ({ a, f })));
        if (items.length === 0) return null;
        return (
          <details key={g.key} open={g.open} className="group rounded-lg border">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 p-4">
              <span className="font-semibold">
                {g.title} <span className="font-normal text-muted-foreground">({items.length})</span>
              </span>
              <span className="text-xs text-muted-foreground">{g.blurb}</span>
            </summary>
            <ul className="flex flex-col gap-4 border-t p-4">
              {items.map(({ a, f }) => (
                <li key={`${a.angleId}-${f.findingId}`}>
                  <FindingCard rentalId={rentalId} angle={a} finding={f} group={g.key} line={lineFor(a.angleId, f.findingId)} rules={rules} contests={contests} />
                </li>
              ))}
            </ul>
          </details>
        );
      })}

      {manual.length > 0 && (
        <section aria-labelledby="manual-heading" className="rounded-lg border p-4">
          <h3 id="manual-heading" className="font-semibold">
            Staff-added lines
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {manual.map((l) => (
              <li key={l.id} className="rounded-md border p-3">
                <p className="text-sm">
                  {angles.find((a) => a.angleId === l.angleId)?.label ?? l.angleId}: {pretty(l.damageType)} ({pretty(l.severity)})
                </p>
                {contests[l.id] && <ContestNote contest={contests[l.id]!} />}
                <LineControls rentalId={rentalId} line={l} rules={rules} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-lg border p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Add a charge manually</summary>
        <ManualLineForm rentalId={rentalId} angles={angles} rules={rules} />
      </details>

      {totals}
    </div>
  );
}

function PhotoThumb({ photo, label }: { photo?: PairPhoto; label: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, sized by CSS
    <img src={photo.url} alt={`Return photo: ${label}`} className="aspect-[4/3] w-full rounded-md border object-cover" />
  ) : (
    <span className="flex aspect-[4/3] items-center justify-center rounded-md border text-xs text-muted-foreground">No photo</span>
  );
}

function FindingCard({ rentalId, angle, finding, group, line, rules, contests }: { rentalId: string; angle: AngleView; finding: Finding; group: FindingGroup; line?: LineItem; rules: RuleView[]; contests: Record<string, ContestView> }) {
  const tone: OverlayBox["tone"] = group === "PRE_EXISTING" ? "existing" : group === "PROPOSED" ? "new" : "review";
  const Icon = group === "PROPOSED" ? AlertTriangle : group === "PRE_EXISTING" ? CheckCircle2 : CircleHelp;
  return (
    <article className="grid gap-3 md:grid-cols-[3fr_2fr]">
      <PhotoPair angleLabel={angle.label} before={angle.before} after={angle.after} boxes={[{ id: finding.findingId, box: finding.box, tone, label: `${pretty(finding.damageType)} (${group === "PRE_EXISTING" ? "pre-existing" : "new"})` }]} />
      <div className="flex flex-col gap-2 text-sm">
        <GeminiTag className="self-start">Proposed by Gemini</GeminiTag>
        <p className="flex items-center gap-2 font-medium">
          <Icon className="size-4" aria-hidden="true" />
          {pretty(finding.damageType)} · {pretty(finding.severity)} · {angle.label}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Gemini confidence</span>
          <meter min={0} max={1} value={finding.confidence} className="h-2 flex-1 accent-ai" aria-label="Gemini confidence" />
          <span className="tabular-nums">{Math.round(finding.confidence * 100)}%</span>
        </div>
        <p className="rounded-md border border-dashed border-ai/40 bg-ai-soft px-2.5 py-1.5 text-ai">“{finding.evidence}”</p>
        {line && contests[line.id] && <ContestNote contest={contests[line.id]!} />}
        {line ? <LineControls rentalId={rentalId} line={line} rules={rules} /> : group === "PRE_EXISTING" ? <p className="text-xs">Matches check-out mark {finding.matchesBaselineMarkId ?? "—"}; not charged.</p> : <p className="text-xs">Not priced automatically. Add a manual charge if you disagree.</p>}
      </div>
    </article>
  );
}

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (method: string, url: string, body: unknown) => {
    setPending(true);
    setError(null);
    const r = await send(method, url, body);
    setPending(false);
    if (!r.ok) setError(r.message);
    else router.refresh();
    return r;
  };
  return { pending, error, run };
}

function LineControls({ rentalId, line, rules }: { rentalId: string; line: LineItem; rules: RuleView[] }) {
  const id = useId();
  const { pending, error, run } = useAction();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const url = `/api/rentals/${encodeURIComponent(rentalId)}/line-items/${encodeURIComponent(line.id)}`;
  const unpriced = !line.priceRuleRef && !line.overrideReason;

  async function override(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    const r = await run("PATCH", url, { overrideAmountCents: cents, overrideReason: reason.trim() });
    if (r.ok) {
      setAmount("");
      setReason("");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={line.staffDecision === "INCLUDED"}
            disabled={pending}
            onChange={(e) => void run("PATCH", url, { staffDecision: e.target.checked ? "INCLUDED" : "EXCLUDED" })}
          />
          Include in deduction
        </label>
        <span className={`tabular-nums ${line.staffDecision === "INCLUDED" ? "font-semibold" : "text-muted-foreground line-through"}`}>{formatUsd(line.amountCents)}</span>
      </div>
      <p className="text-xs">
        {line.overrideReason ? (
          <>
            <span className="font-medium">Staff override:</span> {line.overrideReason}
          </>
        ) : unpriced ? (
          <span className="font-medium text-destructive">No price-list rule matches — choose one or exclude this line.</span>
        ) : (
          <>Price-list rule: {line.label}</>
        )}
      </p>
      {!unpriced && <PriceSourceChip cents={line.amountCents} source={line.overrideReason ? "STAFF_OVERRIDE" : "PRICE_LIST"} />}
      <label htmlFor={`${id}-rule`} className="text-xs font-medium">
        Price-list rule (change type or severity)
      </label>
      <select
        id={`${id}-rule`}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={line.priceRuleRef ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && void run("PATCH", url, { priceRuleRef: e.target.value })}
      >
        <option value="">{line.priceRuleRef ? "—" : "Choose a rule…"}</option>
        {rules.map((r) => (
          <option key={r.ref} value={r.ref}>
            {r.label} · {pretty(r.damageType)}/{pretty(r.severity)} · {formatUsd(r.amountCents)}
          </option>
        ))}
      </select>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">Override the amount (reason required)</summary>
        <form onSubmit={override} className="mt-2 flex flex-col gap-2">
          <label className="text-xs" htmlFor={`${id}-amt`}>
            Amount (USD)
          </label>
          <input id={`${id}-amt`} inputMode="decimal" pattern="\d+(\.\d{1,2})?" required className="h-9 rounded-md border bg-background px-2 text-sm tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className="text-xs" htmlFor={`${id}-why`}>
            Reason (logged, max 200 characters)
          </label>
          <input id={`${id}-why`} required maxLength={200} className="h-9 rounded-md border bg-background px-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !amount || !reason.trim()}>
              Save override
            </Button>
            {line.overrideReason && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void run("PATCH", url, { overrideAmountCents: null })}>
                Remove override
              </Button>
            )}
          </div>
        </form>
      </details>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ManualLineForm({ rentalId, angles, rules }: { rentalId: string; angles: AngleView[]; rules: RuleView[] }) {
  const id = useId();
  const { pending, error, run } = useAction();
  const [angleId, setAngleId] = useState(angles[0]?.angleId ?? "");
  const [ref, setRef] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rule = rules.find((r) => r.ref === ref);
    if (!rule) return;
    const r = await run("POST", `/api/rentals/${encodeURIComponent(rentalId)}/line-items`, { angleId, damageType: rule.damageType, severity: rule.severity, priceRuleRef: rule.ref });
    if (r.ok) setRef("");
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
      <Field label="Angle" htmlFor={`${id}-angle`}>
        <select id={`${id}-angle`} className="h-9 rounded-md border bg-background px-2 text-sm" value={angleId} onChange={(e) => setAngleId(e.target.value)}>
          {angles.map((a) => (
            <option key={a.angleId} value={a.angleId}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Charge from the price list" htmlFor={`${id}-rule`}>
        <select id={`${id}-rule`} required className="h-9 rounded-md border bg-background px-2 text-sm" value={ref} onChange={(e) => setRef(e.target.value)}>
          <option value="">Choose…</option>
          {rules.map((r) => (
            <option key={r.ref} value={r.ref}>
              {r.label} · {formatUsd(r.amountCents)}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" size="sm" className="self-start" disabled={pending || !ref}>
        Add charge
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function TotalsPanel({ rentalId, depositCents, totalCents, capped, unpricedCount, includedCount, clean }: { rentalId: string; depositCents: number; totalCents: number; capped: boolean; unpricedCount: number; includedCount: number; clean: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renterLink, setRenterLink] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    const r = await send("POST", `/api/rentals/${encodeURIComponent(rentalId)}/confirm`, {});
    setPending(false);
    if (!r.ok) return setError(r.message);
    setRenterLink(String(r.json.renterLink ?? ""));
    router.refresh();
  }

  return (
    <section aria-labelledby="totals-heading" className="sticky bottom-0 flex flex-col gap-3 rounded-lg border bg-background p-4 shadow-sm">
      <h3 id="totals-heading" className="sr-only">
        Totals
      </h3>
      <dl className="grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div>
          <dt className="text-muted-foreground">Deposit hold</dt>
          <dd className="font-medium">{formatUsd(depositCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Proposed deduction</dt>
          <dd className="text-lg font-semibold">{formatUsd(totalCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Not charged</dt>
          <dd className="font-medium">{formatUsd(depositCents - totalCents)}</dd>
        </div>
      </dl>
      {capped && <p className="text-xs">Capped at the deposit.</p>}
      {unpricedCount > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {unpricedCount} included line{unpricedCount > 1 ? "s have" : " has"} no price. Choose a rule or exclude {unpricedCount > 1 ? "them" : "it"} before confirming.
        </p>
      )}
      {renterLink ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Confirmed. Send this link to the renter:</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{renterLink}</code>
            <CopyButton text={renterLink} label="Copy renter link" />
          </div>
        </div>
      ) : (
        <Button onClick={() => void confirm()} disabled={pending || unpricedCount > 0} className="self-start">
          {pending ? "Confirming…" : clean || totalCents === 0 ? "Confirm $0" : `Confirm ${formatUsd(totalCents)} (${includedCount} line${includedCount > 1 ? "s" : ""})`}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Confirming freezes these lines and sends them to the renter for their decision. Nothing is charged until they accept and you settle.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function ContestNote({ contest }: { contest: ContestView }) {
  if (contest.decision === "ACCEPTED") return <p className="text-xs text-muted-foreground">The renter accepted this line last round.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Renter contested this line</p>
      {contest.comment && <p>“{contest.comment}”</p>}
      {contest.photo && (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
        <img src={contest.photo.url} alt="Renter's contest photo" className="max-h-64 w-auto rounded-md border object-contain" />
      )}
    </div>
  );
}

function SettleUndisputed({ rentalId, cents, accepted, contested }: { rentalId: string; cents: number; accepted: number; contested: number }) {
  const { pending, error, run } = useAction();
  return (
    <section aria-labelledby="undisputed-heading" className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
      <h3 id="undisputed-heading" className="font-semibold">
        Contest limit reached
      </h3>
      <p>
        You can revise once more and confirm, or settle only what the renter accepted: <strong className="tabular-nums">{formatUsd(cents)}</strong> ({accepted} accepted line{accepted === 1 ? "" : "s"}; {contested} contested line{contested === 1 ? "" : "s"} dropped). The renter keeps the right to dispute with PayPal.
      </p>
      <Button variant="outline" className="self-start" disabled={pending} onClick={() => void run("POST", `/api/rentals/${encodeURIComponent(rentalId)}/settle-undisputed`, {})}>
        {pending ? "Saving…" : `Settle only the undisputed ${formatUsd(cents)}`}
      </Button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
