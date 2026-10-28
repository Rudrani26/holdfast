/**
 * Pure helpers for the T-007 vision feasibility check: truth parsing, scoring, call budget.
 */
import { z } from "zod";

const DAMAGE_TYPES = [
  "SCRATCH", "SCUFF", "CRACK", "DENT", "CHIP", "STAIN", "TEAR", "MISSING_PART", "BROKEN_PART", "OTHER",
] as const;

type DamageTypeName = (typeof DAMAGE_TYPES)[number];

export type Truth =
  | { kind: "NO_CHANGE"; note: string }
  | { kind: "NEW_DAMAGE"; damageType?: DamageTypeName; note: string };

const isDamageType = (v: string): v is DamageTypeName => (DAMAGE_TYPES as readonly string[]).includes(v);

/**
 * `truth.txt` is one line: `NO_CHANGE <note>` or `NEW_DAMAGE[:<DamageType>] <note>`,
 * e.g. `NEW_DAMAGE:MISSING_PART left ear cushion removed`.
 */
export function parseTruth(text: string): Truth {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  const [head = "", ...rest] = line.split(/\s+/);
  const note = rest.join(" ");
  if (head === "NO_CHANGE") return { kind: "NO_CHANGE", note };
  const m = /^NEW_DAMAGE(?::([A-Z_]+))?$/.exec(head);
  if (m) {
    const type = m[1];
    if (type === undefined) return { kind: "NEW_DAMAGE", note };
    if (!isDamageType(type)) throw new Error(`truth.txt: unknown damage type ${type}`);
    return { kind: "NEW_DAMAGE", damageType: type, note };
  }
  throw new Error('truth.txt must start with "NO_CHANGE" or "NEW_DAMAGE[:TYPE]"');
}

/** Lowest confidence at which a new finding reaches staff at all (AI_PIPELINE.md §6). */
export const REPORT_THRESHOLD = 0.5;

export interface ScoredFinding {
  damageType: string;
  isNew: boolean;
  confidence: number;
}

export interface PairScore {
  correct: boolean;
  /** NEW_DAMAGE only: a reported new finding has the expected type (undefined if no type given). */
  typeMatch?: boolean;
  reportedNew: number;
  reason: string;
}

/**
 * A pair is correct when the model's reportable new findings (isNew, confidence ≥ 0.5) agree with
 * the truth: none for NO_CHANGE (an unchanged item flagged as damaged fails the gate), ≥ 1 for NEW_DAMAGE.
 */
export function scorePair(truth: Truth, findings: ScoredFinding[]): PairScore {
  const reportable = findings.filter((f) => f.isNew && f.confidence >= REPORT_THRESHOLD);
  if (truth.kind === "NO_CHANGE") {
    return {
      correct: reportable.length === 0,
      reportedNew: reportable.length,
      reason: reportable.length === 0 ? "no new findings" : `flagged ${reportable.map((f) => f.damageType).join(", ")} on an unchanged item`,
    };
  }
  const typeMatch = truth.damageType ? reportable.some((f) => f.damageType === truth.damageType) : undefined;
  return {
    correct: reportable.length > 0,
    typeMatch,
    reportedNew: reportable.length,
    reason: reportable.length > 0 ? `reported ${reportable.map((f) => f.damageType).join(", ")}` : "missed the damage",
  };
}

/** Hard cap on model calls for the whole run (T-007: 20). Retries count. */
export class CallBudget {
  private used = 0;
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("call budget must be 1–20");
  }
  get spent(): number {
    return this.used;
  }
  /** Reserves one call; returns false (and reserves nothing) when the budget is exhausted. */
  take(): boolean {
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}

export const visionArgsSchema = z.object({
  list: z.boolean().default(false),
  models: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .refine((m) => m.length <= 2, "at most 2 candidate models")
    .refine((m) => m.every((id) => /^[a-z0-9][a-z0-9.-]{2,80}$/.test(id)), "model ids look like gemini-x.y-flash"),
  pairs: z.string().default("eval/spike-pairs"),
  location: z.string().regex(/^(global|[a-z]+-[a-z]+\d)$/, "a Vertex location such as us-central1 or global").optional(),
  maxCalls: z.coerce.number().int().min(1).max(20).default(20),
});
