import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Item, LineItem, PriceList, Rental } from "@/domain/types";
import { MemoryRepo } from "./repo/memory";
import { addManualLine, confirmReview, updateLine, type ReviewDeps } from "./review";

// Real seed price list (data/priceList.json) for the demo headphones.
const priceList = (JSON.parse(readFileSync("data/priceList.json", "utf8")) as { priceLists: PriceList[] }).priceLists.find((p) => p.id === "pl-headphones")!;
const RID = "r_0123456789abcdef0123";
const item: Item = {
  id: "headphones",
  name: "Headphones",
  description: "d",
  imagePath: "items/headphones.jpg",
  depositCents: 20000,
  dailyRateCents: 1800,
  priceListId: "pl-headphones",
  angles: ["front", "back", "left-side", "right-side", "top", "bottom"].map((id) => ({ id, label: id, hint: "" })),
  active: true,
};
const line = (over: Partial<LineItem>): LineItem => ({
  id: "insp_left-side_f1",
  source: "AI",
  inspectionId: "insp",
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

async function setup(lines: LineItem[], over: Partial<Rental> = {}) {
  const repo = new MemoryRepo();
  await repo.putItem(item);
  await repo.putPriceList(priceList);
  await repo.createRental({
    id: RID,
    itemId: "headphones",
    renter: { name: "Ada", email: "ada@example.com" },
    days: 2,
    depositCents: 20000,
    status: "INSPECTED",
    paymentState: "AUTHORIZED",
    paypal: { captures: [], refunds: [] },
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    contestRound: 0,
    createdAt: "2026-10-28T08:00:00.000Z",
    updatedAt: "2026-10-28T08:00:00.000Z",
    version: 4,
    ...over,
  });
  for (const l of lines) await repo.putLineItem(RID, l);
  let t = Date.parse("2026-10-28T13:00:00.000Z");
  const deps: ReviewDeps = { repo, now: () => new Date((t += 1000)) };
  return { repo, deps };
}

const code = async (p: Promise<unknown>) => (await p.then(() => undefined, (e: { code?: string }) => e))?.code;

describe("updateLine", () => {
  it("J4: staff include a 'Needs your eyes' line; it is logged", async () => {
    const { repo, deps } = await setup([line({ id: "needs", staffDecision: "EXCLUDED", damageType: "SCRATCH", severity: "MINOR", priceRuleRef: "SCRATCH:MINOR", label: "Cosmetic scratch", amountCents: 1200 })]);
    const out = await updateLine(deps, RID, "needs", { staffDecision: "INCLUDED" });
    expect(out).toMatchObject({ staffDecision: "INCLUDED", amountCents: 1200 });
    expect((await repo.listEvents(RID))[0]).toMatchObject({ type: "LINE_UPDATED", actor: "STAFF", summary: "Cosmetic scratch (left-side): included" });
  });

  it("choosing another rule (e.g. severity) re-prices from the price list", async () => {
    const { deps } = await setup([line({})]);
    const out = await updateLine(deps, RID, "insp_left-side_f1", { priceRuleRef: "BROKEN_PART:SEVERE" });
    expect(out).toMatchObject({ label: "Broken hinge or headband", amountCents: 12000, priceRuleRef: "BROKEN_PART:SEVERE" });
  });

  it("override needs a reason, cannot exceed the deposit, is logged, and can be removed", async () => {
    const { repo, deps } = await setup([line({})]);
    expect(await code(updateLine(deps, RID, "insp_left-side_f1", { overrideAmountCents: 2000, overrideReason: "  " }))).toBe("INVALID_OVERRIDE");
    expect(await code(updateLine(deps, RID, "insp_left-side_f1", { overrideAmountCents: 20001, overrideReason: "x" }))).toBe("INVALID_OVERRIDE");
    const o = await updateLine(deps, RID, "insp_left-side_f1", { overrideAmountCents: 2000, overrideReason: "Cushion reusable after cleaning" });
    expect(o).toMatchObject({ amountCents: 2000, source: "STAFF", overrideReason: "Cushion reusable after cleaning" });
    expect((await repo.listEvents(RID)).at(-1)).toMatchObject({ type: "LINE_OVERRIDDEN" });
    const back = await updateLine(deps, RID, "insp_left-side_f1", { overrideAmountCents: null });
    expect(back).toMatchObject({ amountCents: 3800, label: "Ear cushion replacement" });
    expect(back.overrideReason).toBeUndefined();
  });

  it("rejects an unknown rule, an unknown line, and edits outside review", async () => {
    const { deps } = await setup([line({})]);
    expect(await code(updateLine(deps, RID, "insp_left-side_f1", { priceRuleRef: "CHIP:MINOR" }))).toBe("UNKNOWN_PRICE_RULE");
    expect(await code(updateLine(deps, RID, "nope", { staffDecision: "EXCLUDED" }))).toBe("LINE_NOT_FOUND");
    const b = await setup([line({})], { status: "AWAITING_RENTER" });
    expect(await code(updateLine(b.deps, RID, "insp_left-side_f1", { staffDecision: "EXCLUDED" }))).toBe("NOT_IN_REVIEW");
  });
});

describe("addManualLine", () => {
  it("adds an included STAFF line priced from the list", async () => {
    const { repo, deps } = await setup([]);
    const l = await addManualLine(deps, RID, { angleId: "top", damageType: "DENT", severity: "MODERATE", priceRuleRef: "DENT:MODERATE" });
    expect(l).toMatchObject({ source: "STAFF", staffDecision: "INCLUDED", amountCents: 3000, label: "Dent repair", round: 0 });
    expect(await repo.listLineItems(RID)).toHaveLength(1);
    expect((await repo.listEvents(RID))[0]!.type).toBe("LINE_ADDED");
  });

  it("rejects unknown angles and rules", async () => {
    const { deps } = await setup([]);
    expect(await code(addManualLine(deps, RID, { angleId: "inside", damageType: "DENT", severity: "MODERATE", priceRuleRef: "DENT:MODERATE" }))).toBe("UNKNOWN_ANGLE");
    expect(await code(addManualLine(deps, RID, { angleId: "top", damageType: "CHIP", severity: "MINOR", priceRuleRef: "CHIP:MINOR" }))).toBe("UNKNOWN_PRICE_RULE");
  });
});

describe("confirmReview", () => {
  it("J1: freezes $38 and moves to AWAITING_RENTER", async () => {
    const { repo, deps } = await setup([line({}), line({ id: "x", findingId: "f2", staffDecision: "EXCLUDED", amountCents: 1200 })]);
    const out = await confirmReview(deps, RID);
    expect(out).toMatchObject({ deductionCents: 3800, cappedAtDeposit: false, rental: { status: "AWAITING_RENTER", approvedDeductionCents: 3800 } });
    expect((await repo.listEvents(RID)).at(-1)).toMatchObject({ type: "STAFF_CONFIRMED", summary: "Staff confirmed a $38.00 deduction (1 line)" });
  });

  it("J2: no lines → Confirm $0", async () => {
    const { repo, deps } = await setup([]);
    expect((await confirmReview(deps, RID)).deductionCents).toBe(0);
    expect((await repo.listEvents(RID))[0]!.summary).toBe("Staff confirmed $0 — no deduction proposed to the renter");
  });

  it("refuses while an included line is unpriced", async () => {
    const { deps } = await setup([line({ id: "u", damageType: "CHIP", severity: "MINOR", priceRuleRef: undefined, label: "CHIP (minor) — no price rule", amountCents: 0 })]);
    expect(await code(confirmReview(deps, RID))).toBe("LINES_UNPRICED");
  });

  it("caps at the deposit (FR-8)", async () => {
    const { deps } = await setup([line({ id: "a", priceRuleRef: "BROKEN_PART:SEVERE" }), line({ id: "b", findingId: "f2", priceRuleRef: "BROKEN_PART:SEVERE" })], { depositCents: 20000 });
    expect(await confirmReview(deps, RID)).toMatchObject({ deductionCents: 20000, cappedAtDeposit: true });
  });

  it("re-prices stored lines from the list (a tampered stored amount does not count)", async () => {
    const { deps } = await setup([line({ amountCents: 1 })]);
    expect((await confirmReview(deps, RID)).deductionCents).toBe(3800);
  });
});
