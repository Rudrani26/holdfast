import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANGLES_PER_ITEM, parseSeedData, SeedDataError } from "./seed-data";

const load = (name: string): unknown => JSON.parse(readFileSync(`data/${name}`, "utf8"));
type Json = { items: Record<string, unknown>[]; priceLists: Record<string, unknown>[] };
const catalog = () => load("catalog.json") as Json;
const lists = () => load("priceList.json") as Json;

function problems(c: unknown, p: unknown): string[] {
  try {
    parseSeedData(c, p);
  } catch (e) {
    if (e instanceof SeedDataError) return e.problems;
    throw e;
  }
  return [];
}

describe("seed data files", () => {
  const data = parseSeedData(catalog(), lists());

  it("has three items with six angles each and existing price lists", () => {
    expect(data.items.map((i) => i.id)).toEqual(["headphones", "speaker", "backpack"]);
    for (const item of data.items) expect(item.angles).toHaveLength(ANGLES_PER_ITEM);
  });

  it("holds a $200 deposit for the demo headphones and prices the J1 ear cushion at $38", () => {
    const headphones = data.items.find((i) => i.id === "headphones")!;
    expect(headphones.depositCents).toBe(20000);
    const rule = data.priceLists
      .find((p) => p.id === headphones.priceListId)!
      .rules.find((r) => r.damageType === "MISSING_PART" && r.severity === "MODERATE");
    expect(rule?.amountCents).toBe(3800);
  });

  it("prices each missing ear cushion at $38 whatever severity the model reports (one finding per cushion)", () => {
    // T-033 live run: one finding per removed cushion, rated SEVERE. A severity rule must not encode quantity.
    const rules = data.priceLists.find((p) => p.id === "pl-headphones")!.rules.filter((r) => r.damageType === "MISSING_PART");
    expect(rules.map((r) => r.amountCents)).toEqual(rules.map(() => 3800));
  });

  it("charges nothing for normal wear (SCUFF/MINOR) on every list", () => {
    for (const list of data.priceLists) {
      expect(list.rules.find((r) => r.damageType === "SCUFF" && r.severity === "MINOR")?.amountCents).toBe(0);
    }
  });
});

describe("parseSeedData rejects", () => {
  it("an unknown price list reference", () => {
    const c = catalog();
    c.items[0]!.priceListId = "pl-nope";
    expect(problems(c, lists())).toEqual(['item "headphones" references unknown price list "pl-nope"']);
  });

  it("duplicate item ids", () => {
    const c = catalog();
    c.items[1]!.id = "headphones";
    c.items[1]!.imagePath = "items/headphones.jpg";
    expect(problems(c, lists())).toContain('duplicate item id "headphones"');
  });

  it("a duplicate (damageType, severity) rule", () => {
    const p = lists();
    const rules = p.priceLists[0]!.rules as unknown[];
    rules.push(rules[0]);
    expect(problems(catalog(), p)).toEqual(["priceList.json: priceLists.0.rules: one rule per (damageType, severity)"]);
  });

  it("fractional or negative money, a wrong angle count, and a mismatched image path", () => {
    const c = catalog();
    c.items[0]!.depositCents = 200.5;
    c.items[1]!.angles = (c.items[1]!.angles as unknown[]).slice(0, 5);
    c.items[2]!.imagePath = "items/other.jpg";
    const p = lists();
    (p.priceLists[0]!.rules as { amountCents: number }[])[0]!.amountCents = -1;
    const found = problems(c, p).join("\n");
    expect(found).toContain("catalog.json: items.0.depositCents");
    expect(found).toContain("catalog.json: items.1.angles");
    expect(found).toContain("catalog.json: items.2.imagePath: imagePath must be items/<id>.jpg");
    expect(found).toContain("priceList.json: priceLists.0.rules.0.amountCents");
  });

  it("an unknown damage type", () => {
    const p = lists();
    (p.priceLists[0]!.rules as { damageType: string }[])[0]!.damageType = "SMUDGE";
    expect(problems(catalog(), p).join("\n")).toContain("priceList.json: priceLists.0.rules.0.damageType");
  });
});
