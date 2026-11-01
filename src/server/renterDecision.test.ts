import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { plan } from "@/domain/settlementPlanner";
import type { Inspection, LineItem, Rental } from "@/domain/types";
import { signRenterToken } from "@/lib/authTokens";
import { uploadPhoto } from "./photos";
import { MemoryRepo } from "./repo/memory";
import { explainLine, renterSession, renterView, submitDecision } from "./renter";
import type { ObjectStore } from "./storage";

const SECRET = "test-renter-link-secret-0123456789abcdef";
beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "p");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdef0123");
  vi.stubEnv("RENTER_LINK_SECRET", SECRET);
});

const RID = "r_0123456789abcdef0123";
const INSP = "return-1";
const finding = { findingId: "f1", damageType: "MISSING_PART" as const, severity: "MODERATE" as const, box: [300, 100, 700, 400] as [number, number, number, number], isNew: true, matchesBaselineMarkId: null, confidence: 0.98, evidence: "The left ear cushion is missing" };
const inspection = (verdict: Inspection["verdict"], findings = [finding]): Inspection => ({
  id: INSP,
  kind: "RETURN",
  model: "m",
  promptVersion: "hf-insp-v1",
  mode: "LIVE",
  status: "OK",
  verdict,
  perAngle: [
    { angleId: "left-side", usable: true, issues: [], latencyMs: 1, rawResponsePath: "x", noChangeConfidence: 0.1, findings },
    { angleId: "top", usable: true, issues: [], latencyMs: 1, rawResponsePath: "x", noChangeConfidence: 0.97, findings: [{ ...finding, findingId: "f1", damageType: "SCUFF", severity: "MINOR", isNew: false, matchesBaselineMarkId: "b1", evidence: "Headband scuff, unchanged" }] },
  ],
  createdAt: "2026-10-28T11:00:00.000Z",
});
const line = (over: Partial<LineItem> = {}): LineItem => ({
  id: `${INSP}_left-side_f1`,
  source: "AI",
  inspectionId: INSP,
  findingId: "f1",
  angleId: "left-side",
  damageType: "MISSING_PART",
  severity: "MODERATE",
  label: "Ear cushion replacement",
  amountCents: 3800,
  priceRuleRef: "MISSING_PART:MODERATE",
  staffDecision: "INCLUDED",
  round: 0,
  ...over,
});

async function setup(opts: { lines?: LineItem[]; verdict?: Inspection["verdict"]; rental?: Partial<Rental> } = {}) {
  const repo = new MemoryRepo();
  await repo.putItem({ id: "headphones", name: "Headphones", description: "d", imagePath: "i", depositCents: 20000, dailyRateCents: 1800, priceListId: "pl", angles: [{ id: "left-side", label: "Left earcup", hint: "" }, { id: "top", label: "Headband", hint: "" }], active: true });
  const lines = opts.lines ?? [line(), line({ id: "excluded", findingId: "f9", staffDecision: "EXCLUDED", label: "Cosmetic scratch", amountCents: 1200 })];
  const deduction = lines.filter((l) => l.staffDecision === "INCLUDED").reduce((s, l) => s + l.amountCents, 0);
  await repo.createRental({
    id: RID,
    itemId: "headphones",
    renter: { name: "Ada", email: "ada@example.com" },
    days: 2,
    depositCents: 20000,
    status: "AWAITING_RENTER",
    paymentState: "AUTHORIZED",
    paypal: { captures: [], refunds: [] },
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    staffConfirmedAt: "2026-10-28T11:05:00.000Z",
    approvedDeductionCents: deduction,
    contestRound: 0,
    createdAt: "2026-10-28T08:00:00.000Z",
    updatedAt: "2026-10-28T11:05:00.000Z",
    version: 7,
    ...opts.rental,
  });
  await repo.putInspection(RID, inspection(opts.verdict ?? "DAMAGE_PROPOSED", opts.verdict === "NO_NEW_DAMAGE" ? [] : [finding]));
  for (const l of lines) await repo.putLineItem(RID, l);
  const { token } = signRenterToken(SECRET, RID);
  return { repo, token, session: renterSession(token) };
}
const later = new Date("2026-10-28T12:00:00.000Z");
const code = async (p: Promise<unknown>) => (await p.then(() => undefined, (e: { code?: string }) => e))?.code;

describe("renter report", () => {
  it("shows only included lines, with a deterministic explanation, the price source and the box", async () => {
    const { repo, token, session } = await setup();
    const { report } = await renterView(repo, session, token);
    expect(report!.lines).toHaveLength(1);
    expect(report!.lines[0]).toMatchObject({
      label: "Ear cushion replacement",
      amountCents: 3800,
      priceSource: "PRICE_LIST",
      box: [300, 100, 700, 400],
      explanation: "The return photo (Left earcup) shows: The left ear cushion is missing. This was not in the check-out photos. Price from Kestrel Gear Rentals’s price list: Ear cushion replacement.",
    });
    expect(report!.preExisting).toEqual([{ angleLabel: "Headband", text: "Headband scuff, unchanged" }]);
    expect(report!.deductionCents).toBe(3800);
  });

  it("explains staff lines and overrides without inventing evidence", () => {
    expect(explainLine(line({ findingId: undefined, overrideReason: "Cleaning only" }), "Front")).toBe("Staff added this after comparing the Front photos. Amount set by staff: Cleaning only.");
  });
});

describe("submitDecision", () => {
  it("accept all → READY_TO_SETTLE; the planned ops capture $38 then void the rest", async () => {
    const { repo, session } = await setup();
    expect(await submitDecision(repo, session, [{ lineId: `${INSP}_left-side_f1`, decision: "ACCEPTED" }], later)).toBe("READY_TO_SETTLE");
    const r = (await repo.getRental(RID))!;
    expect(r.renterDecisionAt).toBe(later.toISOString());
    expect((await repo.getLineItem(RID, `${INSP}_left-side_f1`))!.renterDecision).toBe("ACCEPTED");
    expect((await repo.listEvents(RID))[0]).toMatchObject({ actor: "RENTER", type: "RENTER_ACCEPTED", summary: "Renter accepted the $38.00 deduction (1 line)" });
    expect(plan(r.settlementMode, r.depositCents, r.approvedDeductionCents!)).toEqual([{ op: "CAPTURE", amountCents: 3800, finalCapture: false }, { op: "VOID" }]);
  });

  it("clean return: 'Looks right' (no lines) → READY_TO_SETTLE and a $0 settlement plans a single void", async () => {
    const { repo, session } = await setup({ lines: [], verdict: "NO_NEW_DAMAGE" });
    expect(await submitDecision(repo, session, [], later)).toBe("READY_TO_SETTLE");
    const r = (await repo.getRental(RID))!;
    expect(plan(r.settlementMode, r.depositCents, r.approvedDeductionCents!)).toEqual([{ op: "VOID" }]);
    expect((await repo.listEvents(RID))[0]).toMatchObject({ type: "RENTER_CONFIRMED_CLEAN", summary: "Renter confirmed the return report: looks right ($0)" });
  });

  it("any contest → CONTESTED (round 1) with the comment saved; a contest needs a comment", async () => {
    const { repo, session } = await setup();
    const id = `${INSP}_left-side_f1`;
    expect(await code(submitDecision(repo, session, [{ lineId: id, decision: "CONTESTED" }]))).toBe("COMMENT_REQUIRED");
    expect(await submitDecision(repo, session, [{ lineId: id, decision: "CONTESTED", comment: "  The cushion was already loose at pickup  " }], later)).toBe("CONTESTED");
    expect((await repo.getRental(RID))!.contestRound).toBe(1);
    expect(await repo.getLineItem(RID, id)).toMatchObject({ renterDecision: "CONTESTED", renterComment: "The cushion was already loose at pickup" });
    // Lines carried into round 1 for staff revision, undecided; the excluded line comes along too.
    const round1 = (await repo.listLineItems(RID)).filter((l) => l.round === 1);
    expect(round1.map((l) => [l.id, l.staffDecision, l.renterDecision])).toEqual(
      expect.arrayContaining([
        [`${id}--r1`, "INCLUDED", undefined],
        ["excluded--r1", "EXCLUDED", undefined],
      ]),
    );
    expect(round1).toHaveLength(2);
  });

  it("must cover exactly the included lines", async () => {
    const { repo, session } = await setup();
    expect(await code(submitDecision(repo, session, [], later))).toBe("LINES_NOT_DECIDED");
    expect(await code(submitDecision(repo, session, [{ lineId: "excluded", decision: "ACCEPTED" }], later))).toBe("INVALID_DECISION");
    expect(await code(submitDecision(repo, session, [{ lineId: `${INSP}_left-side_f1`, decision: "ACCEPTED" }, { lineId: `${INSP}_left-side_f1`, decision: "ACCEPTED" }]))).toBe("INVALID_DECISION");
    expect((await repo.getRental(RID))!.status).toBe("AWAITING_RENTER");
  });

  it("is idempotent once decided, and refuses when nothing is awaiting", async () => {
    const { repo, session } = await setup();
    await submitDecision(repo, session, [{ lineId: `${INSP}_left-side_f1`, decision: "ACCEPTED" }], later);
    expect(await submitDecision(repo, session, [{ lineId: `${INSP}_left-side_f1`, decision: "CONTESTED", comment: "changed my mind" }])).toBe("READY_TO_SETTLE");
    expect((await repo.getLineItem(RID, `${INSP}_left-side_f1`))!.renterDecision).toBe("ACCEPTED");
    const b = await setup({ rental: { status: "INSPECTED", staffConfirmedAt: undefined } });
    expect(await code(submitDecision(b.repo, b.session, []))).toBe("NOT_AWAITING_DECISION");
  });

  it("after two contest rounds a further contest is refused and nothing is written", async () => {
    const { repo, session } = await setup({ lines: [line({ round: 2 })], rental: { contestRound: 2 } });
    expect(await code(submitDecision(repo, session, [{ lineId: `${INSP}_left-side_f1`, decision: "CONTESTED", comment: "no" }], later))).toBe("CONTEST_LIMIT_REACHED");
    expect((await repo.getLineItem(RID, `${INSP}_left-side_f1`))!.renterDecision).toBeUndefined();
  });
});

describe("contest photos", () => {
  it("renter may add a CONTEST photo while awaiting their decision; staff may not", async () => {
    const { repo } = await setup();
    const objects = new Map<string, Buffer>();
    const store: ObjectStore = { save: async (p, b) => void objects.set(p, b), read: async (p) => objects.get(p) };
    const file = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#888" } }).jpeg().toBuffer();
    const { photo } = await uploadPhoto({ repo, store }, { rentalId: RID, phase: "CONTEST", angleId: "left-side", provenance: "UPLOADED_REAL", actor: "RENTER", file });
    expect(photo.id).toBe("CONTEST_left-side");
    expect((await repo.listEvents(RID)).at(-1)).toMatchObject({ actor: "RENTER", summary: "Renter added a contest photo: Left earcup" });
    expect(await code(uploadPhoto({ repo, store }, { rentalId: RID, phase: "CONTEST", angleId: "left-side", provenance: "UPLOADED_REAL", file }))).toBe("PHASE_NOT_ALLOWED");
  });
});
