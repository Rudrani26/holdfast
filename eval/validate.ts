import { CASE_TYPES, manifest as manifestSchema, provenance as provenanceSchema, SOURCES, SUBTYPES, type EvalCase } from "./manifest.schema";

// Pure manifest validation (TASKS T-050). Errors make the manifest invalid; warnings report gaps
// against the §10.2 composition targets and unverified generated images.

export interface CatalogItem {
  id: string;
  angles: { id: string }[];
}

export interface ValidationInput {
  manifestJson: unknown;
  /** eval/provenance/<caseId>.json contents by caseId (undefined when the file is missing). */
  provenanceByCase: Record<string, unknown>;
  catalog: CatalogItem[];
  fileExists: (pathRelativeToEval: string) => boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** caseType → source → count */
  composition: Record<string, Record<string, number>>;
  cases: number;
}

/** §10.2 minimum composition (case counts, and REAL minimums where the table sets them). */
export const TARGETS: Record<(typeof CASE_TYPES)[number], { total: number; realMin: number; realOnly?: boolean }> = {
  NEW_DAMAGE: { total: 14, realMin: 4 },
  NO_CHANGE: { total: 16, realMin: 12 },
  PREEXISTING_ONLY: { total: 6, realMin: 3 },
  PREEXISTING_PLUS_NEW: { total: 4, realMin: 0 },
  QUALITY_FAIL: { total: 4, realMin: 4 },
  FULL_CLEAN_RETURN: { total: 3, realMin: 3, realOnly: true },
};

/** Image files a case uses, relative to eval/ (default layout images/<caseId>/before|after.jpg). */
export function caseImages(c: EvalCase): { angleId: string; before: string; after: string }[] {
  if (c.angles) return Object.entries(c.angles).map(([angleId, p]) => ({ angleId, ...p }));
  const p = c.images ?? { before: `images/${c.caseId}/before.jpg`, after: `images/${c.caseId}/after.jpg` };
  return [{ angleId: c.angleId ?? "", ...p }];
}

export function validateEval(input: ValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = manifestSchema.safeParse(input.manifestJson);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `manifest.json: ${i.path.join(".") || "(root)"}: ${i.message}`), warnings, composition: {}, cases: 0 };
  }
  const { cases, extraItems } = parsed.data;
  const catalog = new Map(input.catalog.map((i) => [i.id, i]));
  const extra = new Set(extraItems.map((i) => i.id));
  for (const id of extra) if (catalog.has(id)) errors.push(`extraItems: "${id}" is already a catalog item`);

  const seen = new Set<string>();
  const composition: Record<string, Record<string, number>> = {};
  for (const c of cases) {
    const where = `case ${c.caseId}`;
    if (seen.has(c.caseId)) errors.push(`${where}: duplicate caseId`);
    seen.add(c.caseId);
    (composition[c.caseType] ??= {})[c.source] = (composition[c.caseType]![c.source] ?? 0) + 1;

    // Item and angles.
    const item = catalog.get(c.item);
    if (!item && !extra.has(c.item)) errors.push(`${where}: unknown item "${c.item}" (not in data/catalog.json or extraItems)`);
    if (c.caseType === "FULL_CLEAN_RETURN") {
      if (!c.angles || c.angleId || c.images) errors.push(`${where}: FULL_CLEAN_RETURN uses "angles" (all of the item's angles), not angleId/images`);
      if (item && c.angles) {
        const missing = item.angles.filter((a) => !c.angles![a.id]).map((a) => a.id);
        const unknown = Object.keys(c.angles).filter((a) => !item.angles.some((x) => x.id === a));
        if (missing.length) errors.push(`${where}: missing angles ${missing.join(", ")}`);
        if (unknown.length) errors.push(`${where}: unknown angles ${unknown.join(", ")}`);
      }
      if (c.source !== "REAL") errors.push(`${where}: FULL_CLEAN_RETURN must be REAL (§10.2)`);
      if (c.expected.expectedVerdict !== "NO_NEW_DAMAGE") errors.push(`${where}: FULL_CLEAN_RETURN expects verdict NO_NEW_DAMAGE`);
    } else {
      if (!c.angleId) errors.push(`${where}: angleId is required`);
      if (c.angles) errors.push(`${where}: "angles" is only for FULL_CLEAN_RETURN`);
      if (item && c.angleId && !item.angles.some((a) => a.id === c.angleId)) errors.push(`${where}: angle "${c.angleId}" is not an angle of ${c.item}`);
    }

    // Files.
    for (const img of caseImages(c)) {
      for (const p of [img.before, img.after]) if (!input.fileExists(p)) errors.push(`${where}: missing image eval/${p}`);
    }

    // Expected answer must be internally consistent with the case type.
    const e = c.expected;
    const hasNew = e.newFindings.length > 0;
    if (c.caseType === "QUALITY_FAIL") {
      if (e.usable !== false || e.shouldCharge || hasNew) errors.push(`${where}: QUALITY_FAIL expects usable=false, no new findings, shouldCharge=false`);
    } else if (e.shouldCharge !== hasNew) {
      errors.push(`${where}: shouldCharge must be true exactly when newFindings is non-empty`);
    }
    if (c.caseType === "NO_CHANGE") {
      if (!c.subtype) errors.push(`${where}: NO_CHANGE needs a subtype (${SUBTYPES.join(", ")})`);
      if (hasNew || e.baselineMarks.length) errors.push(`${where}: NO_CHANGE has no marks and no new findings (use PREEXISTING_ONLY for existing marks)`);
    }
    if (c.caseType === "PREEXISTING_ONLY" && (!e.baselineMarks.length || hasNew)) errors.push(`${where}: PREEXISTING_ONLY needs baseline marks and no new findings`);
    if (c.caseType === "PREEXISTING_PLUS_NEW" && (!e.baselineMarks.length || !hasNew)) errors.push(`${where}: PREEXISTING_PLUS_NEW needs baseline marks and new findings`);
    if (c.caseType === "NEW_DAMAGE" && !hasNew) errors.push(`${where}: NEW_DAMAGE needs at least one new finding`);

    // Provenance.
    const raw = input.provenanceByCase[c.caseId];
    if (raw === undefined) errors.push(`${where}: missing eval/provenance/${c.caseId}.json`);
    else {
      const p = provenanceSchema.safeParse(raw);
      if (!p.success) errors.push(...p.error.issues.map((i) => `provenance/${c.caseId}.json: ${i.path.join(".") || "(root)"}: ${i.message}`));
      else {
        if (p.data.caseId !== c.caseId) errors.push(`provenance/${c.caseId}.json: caseId is "${p.data.caseId}"`);
        if (p.data.source !== c.source) errors.push(`provenance/${c.caseId}.json: source ${p.data.source} ≠ manifest ${c.source}`);
      }
    }
    if ((c.source === "HYBRID" || c.source === "SYNTHETIC") && !c.humanVerified) warnings.push(`${where}: generated image not yet human-verified (excluded from runs)`);
  }

  // Composition against §10.2 (warnings: the dataset grows over time).
  for (const [type, t] of Object.entries(TARGETS)) {
    const bySource = composition[type] ?? {};
    const total = Object.values(bySource).reduce((s, n) => s + n, 0);
    const real = bySource.REAL ?? 0;
    if (total < t.total) warnings.push(`${type}: ${total}/${t.total} cases`);
    if (real < t.realMin) warnings.push(`${type}: ${real}/${t.realMin} REAL cases`);
  }
  const noChangeSubtypes = new Set(cases.filter((c) => c.caseType === "NO_CHANGE").map((c) => c.subtype));
  const uncovered = SUBTYPES.filter((s) => !noChangeSubtypes.has(s));
  if (uncovered.length) warnings.push(`NO_CHANGE subtypes not yet covered: ${uncovered.join(", ")}`);
  for (const s of SOURCES) if (!cases.some((c) => c.source === s)) warnings.push(`no ${s} cases yet`);

  return { ok: errors.length === 0, errors, warnings, composition, cases: cases.length };
}
