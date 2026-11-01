import { CopyButton } from "@/components/CopyButton";
import { ReviewReport, type AngleView, type ContestView, type RuleView } from "@/components/report/ReviewReport";
import { MAX_CONTEST_ROUNDS } from "@/domain/rentalMachine";
import { ruleRef } from "@/domain/pricer";
import type { Inspection, Item, LineItem, Photo, Rental } from "@/domain/types";
import { signRenterToken } from "@/lib/authTokens";
import { getEnv } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { authSecrets } from "@/server/auth";
import { getRepo } from "@/server/deps";
import { contestsByLine, currentLines } from "@/server/review";

const photoView = (rentalId: string, p?: Photo) =>
  p && { url: `/api/rentals/${rentalId}/photos/${p.id}?v=${p.sha256.slice(0, 12)}`, width: p.width, height: p.height };

/** Builds the staff review (INSPECTED / CONTESTED) or the confirmed summary (AWAITING_RENTER). */
export async function ReviewPanel({ rental, item, photos, inspection, lines }: { rental: Rental; item: Item; photos: Photo[]; inspection: Inspection; lines: LineItem[] }) {
  const round = currentLines(lines, rental);

  if (rental.status === "AWAITING_RENTER") {
    const included = round.filter((l) => l.staffDecision === "INCLUDED");
    const link = `${getEnv().APP_BASE_URL ?? ""}/r/${signRenterToken(authSecrets().renterLinkSecret, rental.id).token}`;
    return (
      <section aria-labelledby="awaiting-heading" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="awaiting-heading" className="text-lg font-semibold">
          Waiting for the renter
        </h2>
        <p className="text-sm tabular-nums">
          Confirmed deduction: <strong>{formatUsd(rental.approvedDeductionCents ?? 0)}</strong>
          {included.length > 0 && ` (${included.map((l) => `${l.label} ${formatUsd(l.amountCents)}`).join(", ")})`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{link}</code>
          <CopyButton text={link} label="Copy renter link" />
        </div>
        <p className="text-xs text-muted-foreground">On this link the renter accepts or contests each line. Nothing is charged until they decide and you settle.</p>
      </section>
    );
  }

  const priceList = await getRepo().getPriceList(item.priceListId);
  const rules: RuleView[] = (priceList?.rules ?? []).map((r) => ({ ref: ruleRef(r.damageType, r.severity), label: r.label, amountCents: r.amountCents, damageType: r.damageType, severity: r.severity }));
  const angles: AngleView[] = item.angles.map((a) => {
    const r = inspection.perAngle.find((p) => p.angleId === a.id);
    return {
      angleId: a.id,
      label: a.label,
      usable: r?.usable ?? false,
      issues: r?.issues ?? [],
      ...(r?.needsHuman ? { needsHuman: true, error: r.error } : {}),
      ...(r?.noChangeConfidence !== undefined ? { noChangeConfidence: r.noChangeConfidence } : {}),
      findings: r?.findings ?? [],
      before: photoView(rental.id, photos.find((p) => p.phase === "CHECKOUT" && p.angleId === a.id)),
      after: photoView(rental.id, photos.find((p) => p.phase === "CHECKIN" && p.angleId === a.id)),
    };
  });
  const aiNote = `AI ${inspection.model} · ${inspection.promptVersion}${inspection.mode === "REPLAY" ? " · replayed AI result recorded from a live call" : ""} · the AI proposes; prices come only from the shop's price list; you decide.`;
  // T-042: the renter's previous-round decisions beside each line, with their contest photo for that angle.
  const contests: Record<string, ContestView> = {};
  for (const [lineId, c] of contestsByLine(lines, rental)) {
    const line = round.find((l) => l.id === lineId)!;
    const photo = c.decision === "CONTESTED" ? photoView(rental.id, photos.find((p) => p.phase === "CONTEST" && p.angleId === line.angleId)) : undefined;
    contests[lineId] = { ...c, ...(photo ? { photo } : {}) };
  }
  let undisputed: { cents: number; accepted: number; contested: number } | undefined;
  if (rental.status === "CONTESTED" && rental.contestRound >= MAX_CONTEST_ROUNDS) {
    const decided = lines.filter((l) => l.round === rental.contestRound - 1 && l.staffDecision === "INCLUDED");
    const accepted = decided.filter((l) => l.renterDecision === "ACCEPTED");
    // Display only; the server re-prices from the list when staff choose this.
    undisputed = { cents: Math.min(rental.depositCents, accepted.reduce((s, l) => s + l.amountCents, 0)), accepted: accepted.length, contested: decided.length - accepted.length };
  }
  return (
    <ReviewReport
      rentalId={rental.id}
      depositCents={rental.depositCents}
      verdict={inspection.verdict ?? "NO_CHARGES_PROPOSED_REVIEW"}
      aiNote={aiNote}
      angles={angles}
      lines={round}
      rules={rules}
      contests={contests}
      contestRound={rental.contestRound}
      {...(undisputed ? { undisputed } : {})}
    />
  );
}
