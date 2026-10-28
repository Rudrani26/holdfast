/**
 * Deterministic pricer (docs/AI_PIPELINE.md §7). Prices come only from the shop's price list or a
 * staff override with a logged reason. The AI never sets a price; this module never sees model output
 * beyond the damage type and severity of each line. Pure: no I/O.
 */
import {
  DomainError,
  type Cents,
  type DamageType,
  type PriceList,
  type PriceRule,
  type Severity,
} from "./types";

export const MAX_OVERRIDE_REASON = 200;

/** A line before pricing: an AI finding or a manual staff line, plus staff's decisions on it. */
export interface LineDraft {
  key: string;
  source: "AI" | "STAFF";
  findingId?: string;
  angleId: string;
  damageType: DamageType;
  severity: Severity;
  included: boolean;
  /** Staff-chosen rule, e.g. "CRACK:MODERATE". Defaults to the line's own type and severity. */
  priceRuleRef?: string;
  override?: { amountCents: Cents; reason: string };
}

export type PriceStatus = "PRICED" | "UNPRICED" | "OVERRIDDEN";

export interface PricedLine {
  key: string;
  source: "AI" | "STAFF";
  findingId?: string;
  angleId: string;
  damageType: DamageType;
  severity: Severity;
  included: boolean;
  status: PriceStatus;
  label: string;
  /** 0 for UNPRICED lines. */
  amountCents: Cents;
  priceRuleRef?: string;
  overrideReason?: string;
}

export interface PricingResult {
  lines: PricedLine[];
  /** Sum of included line amounts before the deposit cap. */
  subtotalCents: Cents;
  /** Amount to settle: subtotal capped at the deposit. */
  totalCents: Cents;
  cappedAtDeposit: boolean;
  /** Included lines with no price: staff must pick a rule or exclude them before confirming. */
  blockingUnpricedKeys: string[];
}

export const ruleRef = (damageType: DamageType, severity: Severity) => `${damageType}:${severity}`;

const isCents = (n: number) => Number.isSafeInteger(n) && n >= 0;

function indexRules(priceList: PriceList): Map<string, PriceRule> {
  const rules = new Map<string, PriceRule>();
  for (const rule of priceList.rules) {
    const ref = ruleRef(rule.damageType, rule.severity);
    if (rules.has(ref)) throw new DomainError("INVALID_PRICE_LIST", `duplicate price rule ${ref}`);
    if (!isCents(rule.amountCents)) {
      throw new DomainError("INVALID_PRICE_LIST", `rule ${ref} amount must be non-negative integer cents`);
    }
    rules.set(ref, rule);
  }
  return rules;
}

function priceLine(draft: LineDraft, rules: Map<string, PriceRule>): PricedLine {
  const base = {
    key: draft.key,
    source: draft.source,
    findingId: draft.findingId,
    angleId: draft.angleId,
    damageType: draft.damageType,
    severity: draft.severity,
    included: draft.included,
  };

  if (draft.override) {
    const { amountCents, reason } = draft.override;
    const trimmed = reason.trim();
    if (!isCents(amountCents)) {
      throw new DomainError("INVALID_OVERRIDE", `override for ${draft.key} must be non-negative integer cents`);
    }
    if (trimmed.length === 0 || trimmed.length > MAX_OVERRIDE_REASON) {
      throw new DomainError(
        "INVALID_OVERRIDE",
        `override for ${draft.key} needs a reason of 1–${MAX_OVERRIDE_REASON} characters`,
      );
    }
    const rule = rules.get(draft.priceRuleRef ?? ruleRef(draft.damageType, draft.severity));
    return {
      ...base,
      source: "STAFF",
      status: "OVERRIDDEN",
      label: rule?.label ?? `${draft.damageType} (${draft.severity.toLowerCase()})`,
      amountCents,
      priceRuleRef: rule ? ruleRef(rule.damageType, rule.severity) : undefined,
      overrideReason: trimmed,
    };
  }

  if (draft.priceRuleRef !== undefined && !rules.has(draft.priceRuleRef)) {
    throw new DomainError("UNKNOWN_PRICE_RULE", `no price rule ${draft.priceRuleRef} in this price list`);
  }
  const ref = draft.priceRuleRef ?? ruleRef(draft.damageType, draft.severity);
  const rule = rules.get(ref);
  if (!rule) {
    return {
      ...base,
      status: "UNPRICED",
      label: `${draft.damageType} (${draft.severity.toLowerCase()}) — no price rule`,
      amountCents: 0,
    };
  }
  return { ...base, status: "PRICED", label: rule.label, amountCents: rule.amountCents, priceRuleRef: ref };
}

export function price(drafts: LineDraft[], priceList: PriceList, depositCents: Cents): PricingResult {
  if (!isCents(depositCents)) {
    throw new DomainError("INVALID_AMOUNT", "deposit must be non-negative integer cents");
  }
  const keys = new Set<string>();
  for (const d of drafts) {
    if (keys.has(d.key)) throw new DomainError("DUPLICATE_LINE", `duplicate line key ${d.key}`);
    keys.add(d.key);
  }

  const rules = indexRules(priceList);
  const lines = drafts.map((d) => priceLine(d, rules));
  const subtotalCents = lines.filter((l) => l.included).reduce((sum, l) => sum + l.amountCents, 0);
  const cappedAtDeposit = subtotalCents > depositCents;
  return {
    lines,
    subtotalCents,
    totalCents: cappedAtDeposit ? depositCents : subtotalCents,
    cappedAtDeposit,
    blockingUnpricedKeys: lines.filter((l) => l.included && l.status === "UNPRICED").map((l) => l.key),
  };
}
