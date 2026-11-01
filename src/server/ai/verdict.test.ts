import { describe, expect, it } from "vitest";
import type { Finding } from "@/domain/types";
import { findingGroup, inspectionVerdict } from "./verdict";

const finding = (over: Partial<Finding> = {}): Finding => ({
  findingId: "f1",
  damageType: "SCRATCH",
  severity: "MINOR",
  box: [0, 0, 10, 10],
  isNew: true,
  matchesBaselineMarkId: null,
  confidence: 0.9,
  evidence: "scratch",
  ...over,
});
const angle = (over: { usable?: boolean; needsHuman?: boolean; findings?: Finding[]; noChangeConfidence?: number } = {}) => ({
  usable: true,
  findings: [],
  noChangeConfidence: 0.95,
  ...over,
});
const six = (special?: ReturnType<typeof angle>) => [special ?? angle(), angle(), angle(), angle(), angle(), angle()];

describe("findingGroup", () => {
  it.each([
    [{ isNew: false, confidence: 0.99 }, "PRE_EXISTING"],
    [{ isNew: true, confidence: 0.75 }, "PROPOSED"],
    [{ isNew: true, confidence: 0.74 }, "NEEDS_EYES"],
    [{ isNew: true, confidence: 0.5 }, "NEEDS_EYES"],
    [{ isNew: true, confidence: 0.49 }, "LOW_CONFIDENCE"],
  ] as const)("%o → %s", (f, group) => expect(findingGroup(f)).toBe(group));
});

describe("inspectionVerdict", () => {
  it("NO_NEW_DAMAGE: all usable, nothing new, every angle ≥ 0.80 sure", () => {
    expect(inspectionVerdict(six())).toBe("NO_NEW_DAMAGE");
  });

  it("pre-existing-only findings → NO_NEW_DAMAGE when confidences pass", () => {
    expect(inspectionVerdict(six(angle({ findings: [finding({ isNew: false, matchesBaselineMarkId: "b1", confidence: 0.97 })] })))).toBe("NO_NEW_DAMAGE");
  });

  it("one unusable angle → INCOMPLETE even with no findings", () => {
    expect(inspectionVerdict(six(angle({ usable: false })))).toBe("INCOMPLETE");
  });

  it("an angle needing a human → INCOMPLETE, even if another angle proposes damage", () => {
    const perAngle = six(angle({ findings: [finding()] }));
    perAngle[3] = angle({ needsHuman: true, usable: false });
    expect(inspectionVerdict(perAngle)).toBe("INCOMPLETE");
  });

  it("a 0.55-confidence new finding → not NO_NEW_DAMAGE (review)", () => {
    expect(inspectionVerdict(six(angle({ findings: [finding({ confidence: 0.55 })] })))).toBe("NO_CHARGES_PROPOSED_REVIEW");
  });

  it("an angle below 0.80 no-change confidence → review", () => {
    expect(inspectionVerdict(six(angle({ noChangeConfidence: 0.7 })))).toBe("NO_CHARGES_PROPOSED_REVIEW");
  });

  it("a low-confidence note → review (documented overlap resolution)", () => {
    expect(inspectionVerdict(six(angle({ findings: [finding({ confidence: 0.3 })] })))).toBe("NO_CHARGES_PROPOSED_REVIEW");
  });

  it("≥ 1 included (≥ 0.75) new finding → DAMAGE_PROPOSED", () => {
    expect(inspectionVerdict(six(angle({ findings: [finding({ confidence: 0.98 })], noChangeConfidence: 0.05 })))).toBe("DAMAGE_PROPOSED");
  });

  it("no angles → INCOMPLETE", () => {
    expect(inspectionVerdict([])).toBe("INCOMPLETE");
  });
});
