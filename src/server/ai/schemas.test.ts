import { describe, expect, it } from "vitest";
import { BaselineResult, ReturnResult, toModelJsonSchema } from "./schemas";

const finding = {
  findingId: "f1",
  damageType: "MISSING_PART",
  severity: "MODERATE",
  box: [120, 400, 260, 520],
  isNew: true,
  matchesBaselineMarkId: null,
  confidence: 0.9,
  evidence: "Left ear cushion is missing.",
};
const validReturn = {
  angleId: "left-side",
  imageQuality: { usable: true, issues: [] },
  findings: [finding],
  noChangeConfidence: 0.1,
};

describe("ReturnResult", () => {
  it("accepts a valid result and an empty clean result", () => {
    expect(ReturnResult.parse(validReturn).findings).toHaveLength(1);
    expect(
      ReturnResult.parse({ ...validReturn, findings: [], noChangeConfidence: 0.97 }).findings,
    ).toEqual([]);
  });

  it.each([
    ["unknown damage type", { ...finding, damageType: "SMUDGE" }],
    ["box out of range", { ...finding, box: [0, 0, 1001, 10] }],
    ["box with 3 numbers", { ...finding, box: [0, 0, 10] }],
    ["confidence above 1", { ...finding, confidence: 1.2 }],
    ["evidence over 200 chars", { ...finding, evidence: "x".repeat(201) }],
  ])("rejects %s", (_name, bad) => {
    expect(ReturnResult.safeParse({ ...validReturn, findings: [bad] }).success).toBe(false);
  });

  it("caps findings at 10", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...finding, findingId: `f${i}` }));
    expect(ReturnResult.safeParse({ ...validReturn, findings: many }).success).toBe(false);
  });
});

describe("BaselineResult", () => {
  it("accepts marks and rejects ANGLE_MISMATCH (return-only issue)", () => {
    const base = {
      angleId: "front",
      imageQuality: { usable: true, issues: [] },
      marks: [{ markId: "b1", damageType: "SCUFF", severity: "MINOR", box: [1, 2, 3, 4], description: "scuff" }],
    };
    expect(BaselineResult.parse(base).marks).toHaveLength(1);
    expect(
      BaselineResult.safeParse({ ...base, imageQuality: { usable: true, issues: ["ANGLE_MISMATCH"] } }).success,
    ).toBe(false);
  });
});

describe("toModelJsonSchema", () => {
  const schema = toModelJsonSchema(ReturnResult) as Record<string, unknown>;
  const text = JSON.stringify(schema);

  it("keeps structure, enums and ranges", () => {
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["angleId", "imageQuality", "findings", "noChangeConfidence"]);
    expect(text).toContain('"MISSING_PART"');
    expect(text).toContain('"prefixItems"');
    expect(text).toContain('"maximum":1000');
  });

  it("drops keywords Vertex does not accept, without dropping fields named like them", () => {
    expect(text).not.toContain("$schema");
    expect(text).not.toContain("maxLength");
    const findingProps = (
      ((schema.properties as Record<string, { items: { properties: Record<string, unknown> } }>).findings).items
    ).properties;
    expect(Object.keys(findingProps)).toContain("evidence");
  });
});
