import type { DamageType, Finding, InspectionVerdict, Severity } from "../src/domain/types";
import { findingGroup, REVIEW_AT } from "../src/lib/findingGroups";
import type { EvalCase } from "./manifest.schema";

// Evaluation metrics (docs/AI_PIPELINE.md §10.4; TASKS T-052). Pure: takes per-case run results,
// returns numbers per source. Clean-return metrics come first: false charges are the trust failure.

export interface AngleRun {
  angleId: string;
  ok: boolean;
  error?: string;
  usable: boolean;
  noChangeConfidence?: number;
  findings: Finding[];
  latencyMs: number;
  calls: number;
  firstTryValid: boolean;
  replayed: boolean;
  usage: { input: number; output: number };
}

export interface CaseRun {
  caseId: string;
  status: "RUN" | "SKIPPED";
  skipReason?: string;
  mode?: "LIVE" | "REPLAY" | "MIXED";
  /** Return-inspection result per angle (1 angle, or 6 for FULL_CLEAN_RETURN). */
  angles: AngleRun[];
  /** Baseline calls (counted for validity, latency and cost). */
  baseline: AngleRun[];
  verdict?: InspectionVerdict;
  wallMs: number;
}

const SEVERITY_RANK: Record<Severity, number> = { MINOR: 0, MODERATE: 1, SEVERE: 2 };
const CLEAN_TYPES = new Set(["NO_CHANGE", "PREEXISTING_ONLY", "FULL_CLEAN_RETURN"]);

/** New findings at or above the review threshold: what a renter could be asked to pay for. */
export const reportableNew = (r: CaseRun) => r.angles.flatMap((a) => a.findings.filter((f) => f.isNew && f.confidence >= REVIEW_AT));
/** Lines included by default (≥ 0.75): what the app would propose without staff action. */
export const proposedLines = (r: CaseRun) => r.angles.flatMap((a) => a.findings.filter((f) => findingGroup(f) === "PROPOSED")).length;

export interface Rate {
  n: number;
  hits: number;
  /** hits / n, or null when n = 0 (not measured). */
  rate: number | null;
}
const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n === 0 ? null : hits / n });

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

export interface SourceMetrics {
  source: string;
  casesRun: number;
  casesSkipped: number;
  /** Headline: no proposed line on NO_CHANGE / PREEXISTING_ONLY / FULL_CLEAN_RETURN. */
  cleanReturnAccuracy: Rate;
  falseChargeRate: Rate;
  /** FULL_CLEAN_RETURN: confident NO_NEW_DAMAGE verdict; and no false charge at all. */
  fullCleanNoNewDamage: Rate;
  fullCleanNoFalseCharge: Rate;
  /** Of cases the system called NO_NEW_DAMAGE, share truly without new damage. */
  cleanVerdictPrecision: Rate;
  /** NO_CHANGE / PREEXISTING_ONLY subtype → false charges. */
  falseChargeBySubtype: Record<string, Rate>;
  /** Clean cases the model could not inspect (unusable photo or no valid answer). */
  cleanIncomplete: Rate;
  chargeDecisionAccuracy: Rate;
  /** Any reportable new finding on cases that should charge (type-agnostic). */
  newDamageDetected: Rate;
  /** Typed expected findings matched by a reportable finding of the same type. */
  typedRecall: Rate;
  typedPrecision: Rate;
  severityExact: Rate;
  severityWithinOne: Rate;
  preExistingSuppression: Rate;
  qualityFailFlagged: Rate;
  schemaValidFirstTry: Rate;
  schemaValidAfterRetry: Rate;
  latencyPerAngleP50Ms: number | null;
  latencyPerAngleP95Ms: number | null;
  sixAngleWallP50Ms: number | null;
  liveCalls: number;
  tokens: { input: number; output: number };
}

/** Greedy one-to-one type matching of expected new findings to reportable findings. */
function matchFindings(expected: { damageType?: DamageType; severity?: Severity }[], got: Finding[]) {
  const pool = [...got];
  const pairs: { expected: { damageType?: DamageType; severity?: Severity }; got: Finding }[] = [];
  for (const e of expected.filter((x) => x.damageType)) {
    const i = pool.findIndex((g) => g.damageType === e.damageType);
    if (i >= 0) pairs.push({ expected: e, got: pool.splice(i, 1)[0]! });
  }
  return pairs;
}

export function computeMetrics(source: string, cases: EvalCase[], runs: CaseRun[]): SourceMetrics {
  const byId = new Map(runs.map((r) => [r.caseId, r]));
  const mine = cases.filter((c) => c.source === source);
  const ran = mine.map((c) => ({ c, r: byId.get(c.caseId) })).filter((x): x is { c: EvalCase; r: CaseRun } => x.r?.status === "RUN");

  const clean = ran.filter(({ c }) => CLEAN_TYPES.has(c.caseType));
  const cleanOk = clean.filter(({ r }) => proposedLines(r) === 0).length;
  const full = ran.filter(({ c }) => c.caseType === "FULL_CLEAN_RETURN");
  const saidClean = ran.filter(({ r }) => r.verdict === "NO_NEW_DAMAGE");

  const falseChargeBySubtype: Record<string, Rate> = {};
  for (const { c, r } of clean.filter(({ c }) => c.subtype && c.caseType !== "FULL_CLEAN_RETURN")) {
    const prev = falseChargeBySubtype[c.subtype!] ?? rate(0, 0);
    falseChargeBySubtype[c.subtype!] = rate(prev.hits + (proposedLines(r) > 0 ? 1 : 0), prev.n + 1);
  }

  const decisions = ran.filter(({ c }) => c.caseType !== "QUALITY_FAIL");
  const shouldCharge = ran.filter(({ c }) => c.expected.shouldCharge);
  const typed = shouldCharge.filter(({ c }) => c.expected.newFindings.some((f) => f.damageType));
  let expectedTyped = 0;
  let matched = 0;
  let reportableInTyped = 0;
  let sevN = 0;
  let sevExact = 0;
  let sevNear = 0;
  for (const { c, r } of typed) {
    const got = reportableNew(r);
    const pairs = matchFindings(c.expected.newFindings, got);
    expectedTyped += c.expected.newFindings.filter((f) => f.damageType).length;
    matched += pairs.length;
    reportableInTyped += got.length;
    for (const p of pairs.filter((p) => p.expected.severity)) {
      sevN++;
      const d = Math.abs(SEVERITY_RANK[p.expected.severity!] - SEVERITY_RANK[p.got.severity]);
      if (d === 0) sevExact++;
      if (d <= 1) sevNear++;
    }
  }

  const calls = ran.flatMap(({ r }) => [...r.baseline, ...r.angles]);
  const live = calls.filter((a) => !a.replayed && a.calls > 0);
  const preOnly = ran.filter(({ c }) => c.caseType === "PREEXISTING_ONLY");
  const quality = ran.filter(({ c }) => c.caseType === "QUALITY_FAIL");

  return {
    source,
    casesRun: ran.length,
    casesSkipped: mine.length - ran.length,
    cleanReturnAccuracy: rate(cleanOk, clean.length),
    falseChargeRate: rate(clean.length - cleanOk, clean.length),
    fullCleanNoNewDamage: rate(full.filter(({ r }) => r.verdict === "NO_NEW_DAMAGE").length, full.length),
    fullCleanNoFalseCharge: rate(full.filter(({ r }) => proposedLines(r) === 0).length, full.length),
    cleanVerdictPrecision: rate(saidClean.filter(({ c }) => !c.expected.shouldCharge).length, saidClean.length),
    falseChargeBySubtype,
    cleanIncomplete: rate(clean.filter(({ r }) => r.verdict === "INCOMPLETE").length, clean.length),
    chargeDecisionAccuracy: rate(decisions.filter(({ c, r }) => (proposedLines(r) > 0) === c.expected.shouldCharge).length, decisions.length),
    newDamageDetected: rate(shouldCharge.filter(({ r }) => reportableNew(r).length > 0).length, shouldCharge.length),
    typedRecall: rate(matched, expectedTyped),
    typedPrecision: rate(matched, reportableInTyped),
    severityExact: rate(sevExact, sevN),
    severityWithinOne: rate(sevNear, sevN),
    preExistingSuppression: rate(preOnly.filter(({ r }) => reportableNew(r).length === 0).length, preOnly.length),
    qualityFailFlagged: rate(quality.filter(({ r }) => r.angles.some((a) => !a.usable)).length, quality.length),
    schemaValidFirstTry: rate(live.filter((a) => a.firstTryValid).length, live.length),
    schemaValidAfterRetry: rate(live.filter((a) => a.ok).length, live.length),
    latencyPerAngleP50Ms: percentile(live.map((a) => a.latencyMs), 50),
    latencyPerAngleP95Ms: percentile(live.map((a) => a.latencyMs), 95),
    sixAngleWallP50Ms: percentile(full.filter(({ r }) => r.mode === "LIVE").map(({ r }) => r.wallMs), 50),
    liveCalls: calls.reduce((s, a) => s + (a.replayed ? 0 : a.calls), 0),
    tokens: calls.reduce((t, a) => ({ input: t.input + a.usage.input, output: t.output + a.usage.output }), { input: 0, output: 0 }),
  };
}
