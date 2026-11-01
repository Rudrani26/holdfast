import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding, Inspection, Item, PriceList, Rental } from "@/domain/types";
import { applyReturnInspection, countGroups, draftsFromInspection, lineIdFor } from "./lineItems";
import { MemoryRepo } from "./repo/memory";

// Prices come from the real seed price list (data/priceList.json) for the demo headphones.
const priceList = (JSON.parse(readFileSync("data/priceList.json", "utf8")) as { priceLists: PriceList[] }).priceLists.find((p) => p.id === "pl-headphones")!;
const ANGLES = ["front", "back", "left-side", "right-side", "top", "bottom"];
const RID = "r_0123456789abcdef0123";

const item: Item = {
  id: "headphones",
  name: "Wireless over-ear headphones",
  description: "d",
  imagePath: "items/headphones.jpg",
  depositCents: 20000,
  dailyRateCents: 1800,
  priceListId: "pl-headphones",
  angles: ANGLES.map((id) => ({ id, label: id === "left-side" ? "Left earcup" : id, hint: "" })),
  active: true,
};

const f = (over: Partial<Finding>): Finding => ({
  findingId: "f1",
  damageType: "SCUFF",
  severity: "MINOR",
  box: [1, 2, 3, 4],
  isNew: true,
  matchesBaselineMarkId: null,
  confidence: 0.9,
  evidence: "e",
  ...over,
});

function inspection(perAngleFindings: Record<string, Finding[]>, over: Partial<Inspection> = {}): Inspection {
  return {
    id: "return-20261028-abc",
    kind: "RETURN",
    model: "gemini-3.7-flash",
    promptVersion: "hf-insp-v1",
    mode: "LIVE",
    status: "OK",
    perAngle: ANGLES.map((angleId) => ({ angleId, usable: true, issues: [], latencyMs: 5000, noChangeConfidence: perAngleFindings[angleId]?.some((x) => x.isNew) ? 0.1 : 0.95, rawResponsePath: `ai/${RID}/x/${angleId}.json`, findings: perAngleFindings[angleId] ?? [] })),
    verdict: "DAMAGE_PROPOSED",
    tokenUsage: { input: 18000, output: 3000 },
    createdAt: "2026-10-28T12:00:00.000Z",
    ...over,
  };
}

async function setup() {
  const repo = new MemoryRepo();
  await repo.putItem(item);
  await repo.putPriceList(priceList);
  const rental: Rental = {
    id: RID,
    itemId: "headphones",
    renter: { name: "Ada", email: "ada@example.com" },
    days: 2,
    depositCents: 20000,
    status: "RETURNED",
    paymentState: "AUTHORIZED",
    paypal: { captures: [], refunds: [] },
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    contestRound: 0,
    createdAt: "2026-10-28T08:00:00.000Z",
    updatedAt: "2026-10-28T08:00:00.000Z",
    version: 3,
  };
  await repo.createRental(rental);
  return repo;
}
const now = () => new Date("2026-10-28T12:01:00.000Z");

describe("applyReturnInspection", () => {
  it("J1: a missing ear cushion (new, 0.98) becomes an included $38 line from the price list; pre-existing and low-confidence are not priced", async () => {
    const repo = await setup();
    const insp = inspection({
      "left-side": [f({ findingId: "f1", damageType: "MISSING_PART", severity: "MODERATE", confidence: 0.98 })],
      top: [f({ findingId: "f1", isNew: false, matchesBaselineMarkId: "b1", confidence: 0.95 })],
      front: [f({ findingId: "f1", damageType: "SCRATCH", confidence: 0.6 }), f({ findingId: "f2", damageType: "STAIN", confidence: 0.3 })],
    });
    const out = await applyReturnInspection(repo, RID, insp, { wallMs: 14000, now });
    expect(out.rentalStatus).toBe("INSPECTED");
    expect(out.proposedTotalCents).toBe(3800);
    const lines = await repo.listLineItems(RID);
    expect(lines.map((l) => [l.angleId, l.label, l.amountCents, l.staffDecision])).toEqual(
      expect.arrayContaining([
        ["left-side", "Ear cushion replacement", 3800, "INCLUDED"],
        ["front", "Cosmetic scratch", 1200, "EXCLUDED"],
      ]),
    );
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.angleId === "left-side")).toMatchObject({ id: lineIdFor(insp.id, "left-side", "f1"), source: "AI", priceRuleRef: "MISSING_PART:MODERATE", round: 0 });
    const ev = (await repo.listEvents(RID)).find((e) => e.type === "AI_REPORT_READY")!;
    expect(ev.summary).toBe("AI report: 1 proposed charge totalling $38.00 from the price list · 1 to review · 1 pre-existing, not charged");
    expect(ev.data).toMatchObject({ verdict: "DAMAGE_PROPOSED", proposed: 1, needsEyes: 1, preExisting: 1, lowConfidence: 1, wallMs: 14000 });
    expect((await repo.getRental(RID))!.status).toBe("INSPECTED");
  });

  it("J2: NO_NEW_DAMAGE writes no lines and says so, with $0 proposed", async () => {
    const repo = await setup();
    const out = await applyReturnInspection(repo, RID, inspection({ top: [f({ isNew: false, matchesBaselineMarkId: "b1" })] }, { verdict: "NO_NEW_DAMAGE" }), { now });
    expect(out).toMatchObject({ rentalStatus: "INSPECTED", proposedTotalCents: 0, lines: [] });
    expect((await repo.listEvents(RID))[0]!.summary).toBe("No new damage detected across 6 angles · 1 pre-existing mark already recorded at check-out · $0 proposed");
  });

  it("INCOMPLETE keeps the rental RETURNED and lists what to retake or review", async () => {
    const repo = await setup();
    const insp = inspection({}, { verdict: "INCOMPLETE", status: "PARTIAL" });
    insp.perAngle[2] = { ...insp.perAngle[2]!, usable: false, issues: ["BLUR"] };
    insp.perAngle[4] = { ...insp.perAngle[4]!, usable: false, needsHuman: true, error: "schema" };
    const out = await applyReturnInspection(repo, RID, insp, { now });
    expect(out).toMatchObject({ rentalStatus: "RETURNED", lines: [] });
    expect(await repo.listLineItems(RID)).toHaveLength(0);
    const ev = (await repo.listEvents(RID))[0]!;
    expect(ev).toMatchObject({ type: "AI_REPORT_INCOMPLETE", summary: "AI return report incomplete: retake Left earcup (BLUR); review top" });
  });

  it("a finding with no matching price rule becomes an UNPRICED $0 line for staff to resolve", async () => {
    const repo = await setup();
    await applyReturnInspection(repo, RID, inspection({ back: [f({ damageType: "CHIP", severity: "MINOR", confidence: 0.9 })] }), { now });
    const [line] = await repo.listLineItems(RID);
    expect(line).toMatchObject({ label: "CHIP (minor) — no price rule", amountCents: 0, staffDecision: "INCLUDED" });
    expect(line!.priceRuleRef).toBeUndefined();
    expect((await repo.listEvents(RID))[0]!.data).toMatchObject({ unpricedLines: 1 });
  });

  it("NO_CHARGES_PROPOSED_REVIEW counts notes including unsure angles", async () => {
    const repo = await setup();
    const insp = inspection({}, { verdict: "NO_CHARGES_PROPOSED_REVIEW" });
    insp.perAngle[0] = { ...insp.perAngle[0]!, noChangeConfidence: 0.6 };
    await applyReturnInspection(repo, RID, insp, { now });
    expect((await repo.listEvents(RID))[0]!.summary).toBe("No charges proposed — 1 note to glance at");
  });
});

describe("draftsFromInspection / countGroups", () => {
  it("only new findings ≥ 0.50 become drafts; ≥ 0.75 included", () => {
    const insp = inspection({ front: [f({ findingId: "a", confidence: 0.75 }), f({ findingId: "b", confidence: 0.5 }), f({ findingId: "c", confidence: 0.49 }), f({ findingId: "d", isNew: false })] });
    expect(draftsFromInspection(insp).map((d) => [d.findingId, d.included])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(countGroups(insp)).toEqual({ proposed: 1, needsEyes: 1, preExisting: 1, lowConfidence: 1 });
  });
});
