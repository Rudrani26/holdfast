import { describe, expect, it } from "vitest";
import { price, type LineDraft } from "./pricer";
import { DomainError, type PriceList } from "./types";

// Demo price list from docs/AI_PIPELINE.md §7.
const priceList: PriceList = {
  id: "demo",
  name: "Demo",
  currency: "USD",
  rules: [
    { damageType: "MISSING_PART", severity: "MODERATE", amountCents: 3800, label: "Ear cushion replacement" },
    { damageType: "CRACK", severity: "MODERATE", amountCents: 4500, label: "Crack repair" },
    { damageType: "SCRATCH", severity: "MINOR", amountCents: 1200, label: "Minor scratch" },
    { damageType: "SCUFF", severity: "MINOR", amountCents: 0, label: "Normal wear (not charged)" },
    { damageType: "STAIN", severity: "MODERATE", amountCents: 2500, label: "Stain cleaning" },
    { damageType: "TEAR", severity: "MODERATE", amountCents: 4000, label: "Tear repair" },
    { damageType: "DENT", severity: "MODERATE", amountCents: 3000, label: "Dent repair" },
    { damageType: "BROKEN_PART", severity: "SEVERE", amountCents: 12000, label: "Broken part replacement" },
  ],
};
const DEPOSIT = 20000;

let n = 0;
const line = (over: Partial<LineDraft> = {}): LineDraft => ({
  key: `l${++n}`,
  source: "AI",
  angleId: "left-side",
  damageType: "MISSING_PART",
  severity: "MODERATE",
  included: true,
  ...over,
});

describe("price", () => {
  it("prices an included finding from the price list", () => {
    const r = price([line({ findingId: "f1" })], priceList, DEPOSIT);
    expect(r.lines[0]).toMatchObject({
      status: "PRICED",
      label: "Ear cushion replacement",
      amountCents: 3800,
      priceRuleRef: "MISSING_PART:MODERATE",
      source: "AI",
      findingId: "f1",
    });
    expect(r).toMatchObject({ subtotalCents: 3800, totalCents: 3800, cappedAtDeposit: false, blockingUnpricedKeys: [] });
  });

  it("zero lines → $0 total (clean return)", () => {
    expect(price([], priceList, DEPOSIT)).toEqual({
      lines: [],
      subtotalCents: 0,
      totalCents: 0,
      cappedAtDeposit: false,
      blockingUnpricedKeys: [],
    });
  });

  it("excluded lines are priced for display but not counted", () => {
    const r = price([line(), line({ damageType: "CRACK", included: false })], priceList, DEPOSIT);
    expect(r.lines[1]).toMatchObject({ amountCents: 4500, included: false });
    expect(r.totalCents).toBe(3800);
  });

  it("a $0 normal-wear rule is priced at 0, not unpriced", () => {
    const r = price([line({ damageType: "SCUFF", severity: "MINOR" })], priceList, DEPOSIT);
    expect(r.lines[0]).toMatchObject({ status: "PRICED", amountCents: 0 });
    expect(r.blockingUnpricedKeys).toEqual([]);
  });

  it("no matching rule → UNPRICED line that blocks confirmation while included", () => {
    const included = line({ damageType: "CHIP", severity: "SEVERE" });
    const excluded = line({ damageType: "OTHER", severity: "MINOR", included: false });
    const r = price([included, excluded], priceList, DEPOSIT);
    expect(r.lines.map((l) => l.status)).toEqual(["UNPRICED", "UNPRICED"]);
    expect(r.lines[0]?.amountCents).toBe(0);
    expect(r.blockingUnpricedKeys).toEqual([included.key]);
  });

  it("staff can price a line with a different rule", () => {
    const r = price([line({ damageType: "CHIP", severity: "MINOR", priceRuleRef: "SCRATCH:MINOR" })], priceList, DEPOSIT);
    expect(r.lines[0]).toMatchObject({ status: "PRICED", amountCents: 1200, priceRuleRef: "SCRATCH:MINOR" });
  });

  it("rejects a rule reference that is not in the price list", () => {
    expect(() => price([line({ priceRuleRef: "CRACK:SEVERE" })], priceList, DEPOSIT)).toThrow(DomainError);
  });

  it("staff override with a reason becomes a STAFF line", () => {
    const r = price([line({ override: { amountCents: 2000, reason: "  Cushion was already loose  " } })], priceList, DEPOSIT);
    expect(r.lines[0]).toMatchObject({
      status: "OVERRIDDEN",
      source: "STAFF",
      amountCents: 2000,
      overrideReason: "Cushion was already loose",
      label: "Ear cushion replacement",
    });
    expect(r.totalCents).toBe(2000);
  });

  it("an override also resolves an otherwise unpriced line", () => {
    const r = price([line({ damageType: "CHIP", severity: "SEVERE", override: { amountCents: 5000, reason: "Chip on hinge" } })], priceList, DEPOSIT);
    expect(r.lines[0]?.status).toBe("OVERRIDDEN");
    expect(r.blockingUnpricedKeys).toEqual([]);
  });

  it.each([
    ["empty reason", { amountCents: 100, reason: "   " }],
    ["reason over 200 chars", { amountCents: 100, reason: "x".repeat(201) }],
    ["negative amount", { amountCents: -1, reason: "r" }],
    ["fractional cents", { amountCents: 10.5, reason: "r" }],
  ])("rejects an override with %s", (_n, override) => {
    expect(() => price([line({ override })], priceList, DEPOSIT)).toThrow(/override/);
  });

  it("accepts a reason of exactly 200 chars", () => {
    expect(price([line({ override: { amountCents: 1, reason: "x".repeat(200) } })], priceList, DEPOSIT).totalCents).toBe(1);
  });

  it("caps the total at the deposit and flags it", () => {
    const r = price(
      [line({ damageType: "BROKEN_PART", severity: "SEVERE" }), line({ damageType: "CRACK" }), line({ damageType: "TEAR" })],
      priceList,
      DEPOSIT,
    );
    expect(r.subtotalCents).toBe(20500);
    expect(r.totalCents).toBe(20000);
    expect(r.cappedAtDeposit).toBe(true);
  });

  it("a total exactly at the deposit is not flagged as capped", () => {
    const r = price([line({ override: { amountCents: 20000, reason: "Item lost" } })], priceList, DEPOSIT);
    expect(r).toMatchObject({ totalCents: 20000, cappedAtDeposit: false });
  });

  it("rejects duplicate line keys, duplicate rules and invalid deposits", () => {
    expect(() => price([line({ key: "a" }), line({ key: "a" })], priceList, DEPOSIT)).toThrow(/duplicate line/);
    const dup = { ...priceList, rules: [...priceList.rules, { ...priceList.rules[0]! }] };
    expect(() => price([], dup, DEPOSIT)).toThrow(/duplicate price rule/);
    expect(() => price([], priceList, -1)).toThrow(DomainError);
  });

  it("is deterministic and preserves line order", () => {
    const drafts = [line({ damageType: "STAIN" }), line({ damageType: "DENT" }), line()];
    expect(price(drafts, priceList, DEPOSIT)).toEqual(price(drafts, priceList, DEPOSIT));
    expect(price(drafts, priceList, DEPOSIT).lines.map((l) => l.key)).toEqual(drafts.map((d) => d.key));
  });
});
