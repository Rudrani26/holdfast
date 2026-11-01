/** Metrics + report tests on hand-built run results (not model output). */
import { describe, expect, it } from "vitest";
import type { Finding } from "../src/domain/types";
import type { EvalCase } from "./manifest.schema";
import { computeMetrics, type AngleRun, type CaseRun } from "./metrics";
import { renderReport } from "./report";

const f = (over: Partial<Finding>): Finding => ({ findingId: "f1", damageType: "SCRATCH", severity: "MINOR", box: [0, 0, 1, 1], isNew: true, matchesBaselineMarkId: null, confidence: 0.9, evidence: "e", ...over });
const angle = (over: Partial<AngleRun> = {}): AngleRun => ({ angleId: "front", ok: true, usable: true, noChangeConfidence: 0.95, findings: [], latencyMs: 5000, calls: 1, firstTryValid: true, replayed: false, usage: { input: 2000, output: 300 }, ...over });
const run = (caseId: string, findings: Finding[], over: Partial<CaseRun> = {}): CaseRun => ({ caseId, status: "RUN", mode: "LIVE", angles: [angle({ findings })], baseline: [angle()], verdict: findings.some((x) => x.isNew && x.confidence >= 0.75) ? "DAMAGE_PROPOSED" : "NO_NEW_DAMAGE", wallMs: 9000, ...over });
const c = (caseId: string, over: Partial<EvalCase>): EvalCase => ({
  caseId,
  item: "headphones",
  angleId: "front",
  source: "REAL",
  caseType: "NO_CHANGE",
  subtype: "LIGHTING",
  humanVerified: true,
  expected: { baselineMarks: [], newFindings: [], shouldCharge: false },
  ...over,
});

const cases: EvalCase[] = [
  c("c001", {}), // clean, correct
  c("c002", { subtype: "SHADOW" }), // clean, FALSE CHARGE
  c("c003", { caseType: "PREEXISTING_ONLY", subtype: "ANGLE", expected: { baselineMarks: [{ damageType: "SCUFF" }], newFindings: [], shouldCharge: false } }),
  c("c004", { caseType: "NEW_DAMAGE", subtype: undefined, expected: { baselineMarks: [], newFindings: [{ damageType: "MISSING_PART", severity: "MODERATE" }, { damageType: "MISSING_PART", severity: "MODERATE" }], shouldCharge: true } }),
  c("c005", { caseType: "NEW_DAMAGE", subtype: undefined, expected: { baselineMarks: [], newFindings: [{ note: "untyped" }], shouldCharge: true } }),
  c("c006", { caseType: "FULL_CLEAN_RETURN", subtype: "LIGHTING", angleId: undefined, expected: { baselineMarks: [], newFindings: [], shouldCharge: false, expectedVerdict: "NO_NEW_DAMAGE" } }),
  c("c007", { source: "WEB", subtype: "SAME_PHOTO_TRANSFORMED" }),
];
const runs: CaseRun[] = [
  run("c001", []),
  run("c002", [f({ damageType: "STAIN", confidence: 0.8 })]),
  run("c003", [f({ damageType: "SCUFF", isNew: false, matchesBaselineMarkId: "b1" })]),
  run("c004", [f({ damageType: "MISSING_PART", severity: "SEVERE", confidence: 0.99 }), f({ findingId: "f2", damageType: "MISSING_PART", severity: "MODERATE", confidence: 0.99 }), f({ findingId: "f3", damageType: "DENT", confidence: 0.6 })]),
  run("c005", [f({ damageType: "DENT", confidence: 0.55 })], { angles: [angle({ findings: [f({ damageType: "DENT", confidence: 0.55 })], firstTryValid: false, calls: 2 })] }),
  { caseId: "c006", status: "RUN", mode: "LIVE", angles: Array.from({ length: 6 }, (_, i) => angle({ angleId: `a${i}` })), baseline: Array.from({ length: 6 }, (_, i) => angle({ angleId: `a${i}` })), verdict: "NO_NEW_DAMAGE", wallMs: 17000 },
  { caseId: "c007", status: "SKIPPED", skipReason: "images not present", angles: [], baseline: [], wallMs: 0 },
];

describe("computeMetrics (REAL)", () => {
  const m = computeMetrics("REAL", cases, runs);

  it("headline clean-return metrics count proposed lines on clean cases", () => {
    expect(m.cleanReturnAccuracy).toEqual({ n: 4, hits: 3, rate: 0.75 }); // c001, c003, c006 clean; c002 false charge
    expect(m.falseChargeRate).toEqual({ n: 4, hits: 1, rate: 0.25 });
    expect(m.falseChargeBySubtype).toEqual({ LIGHTING: { n: 1, hits: 0, rate: 0 }, SHADOW: { n: 1, hits: 1, rate: 1 }, ANGLE: { n: 1, hits: 0, rate: 0 } });
    expect(m.fullCleanNoNewDamage).toEqual({ n: 1, hits: 1, rate: 1 });
  });

  it("clean-verdict precision: of NO_NEW_DAMAGE verdicts, share truly clean", () => {
    // NO_NEW_DAMAGE verdicts: c001, c003, c006 (clean) and c005 (0.55 only → no proposed, but should charge).
    expect(m.cleanVerdictPrecision).toEqual({ n: 4, hits: 3, rate: 0.75 });
  });

  it("typed recall/precision with one-to-one matching; severity exact and within one", () => {
    expect(m.typedRecall).toEqual({ n: 2, hits: 2, rate: 1 }); // two MISSING_PART matched
    expect(m.typedPrecision).toEqual({ n: 3, hits: 2, rate: 2 / 3 }); // DENT 0.6 unmatched
    expect(m.severityExact).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(m.severityWithinOne).toEqual({ n: 2, hits: 2, rate: 1 });
    expect(m.newDamageDetected).toEqual({ n: 2, hits: 2, rate: 1 }); // c005 untyped still detected at 0.55
    expect(m.chargeDecisionAccuracy).toEqual({ n: 6, hits: 4, rate: 4 / 6 }); // c002 false charge, c005 not proposed
  });

  it("pre-existing suppression, schema validity, latency and accounting", () => {
    expect(m.preExistingSuppression).toEqual({ n: 1, hits: 1, rate: 1 });
    expect(m.schemaValidFirstTry.hits).toBe(m.schemaValidFirstTry.n - 1);
    expect(m.schemaValidAfterRetry.rate).toBe(1);
    expect(m.latencyPerAngleP50Ms).toBe(5000);
    expect(m.sixAngleWallP50Ms).toBe(17000);
    expect(m).toMatchObject({ casesRun: 6, casesSkipped: 0 });
  });

  it("unmeasured metrics are null, not zero", () => {
    expect(m.qualityFailFlagged).toEqual({ n: 0, hits: 0, rate: null });
    expect(computeMetrics("WEB", cases, runs)).toMatchObject({ casesRun: 0, casesSkipped: 1, falseChargeRate: { rate: null } });
  });
});

describe("renderReport", () => {
  const md = renderReport({ runId: "eval-x", startedAt: "2026-10-28T00:00:00Z", model: "gemini-3.7-flash", promptVersion: "hf-insp-v1", mode: "replay", maxCalls: 0 }, cases, runs, [computeMetrics("REAL", cases, runs)]);

  it("opens with the data caveats (no generated images; too few cases)", () => {
    const first = md.split("\n").find((l) => l.startsWith("**Read this first.**"))!;
    expect(first).toContain("no AI-generated (HYBRID/SYNTHETIC) images");
    expect(first).toContain("far too few for statistically meaningful rates");
  });

  it("puts clean-return metrics before damage metrics and lists skipped cases", () => {
    expect(md.indexOf("False-charge rate")).toBeLessThan(md.indexOf("Typed recall"));
    expect(md).toContain("| **False-charge rate** | 25% (1/4) |");
    expect(md).toContain("skipped: images not present");
    expect(md).toContain("n/a (0 cases)");
  });

  it("states the generated-image caveat first when such cases exist", () => {
    const withHybrid = renderReport({ runId: "x", startedAt: "", model: "m", promptVersion: "p", mode: "replay", maxCalls: 0 }, [...cases, c("c008", { source: "HYBRID" })], runs, []);
    expect(withHybrid).toContain("Results on HYBRID images do not demonstrate real-world accuracy");
  });
});
