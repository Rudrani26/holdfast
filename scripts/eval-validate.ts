/**
 * Validates eval/manifest.json and eval/provenance/*.json (TASKS T-050).
 *
 *   npm run eval:validate
 *
 * Exit 1 on errors. Warnings (composition gaps vs AI_PIPELINE.md §10.2, unverified generated images)
 * are printed but do not fail.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateEval, type CatalogItem } from "../eval/validate";

const EVAL = "eval";
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

function main(): number {
  const manifestJson = readJson(path.join(EVAL, "manifest.json")) as { cases?: { caseId?: unknown }[] };
  const provenanceByCase: Record<string, unknown> = {};
  for (const c of manifestJson.cases ?? []) {
    const id = String(c.caseId ?? "");
    const p = path.join(EVAL, "provenance", `${id}.json`);
    if (/^c\d{3}$/.test(id) && existsSync(p)) provenanceByCase[id] = readJson(p);
  }
  const catalog = (readJson("data/catalog.json") as { items: CatalogItem[] }).items;
  const result = validateEval({ manifestJson, provenanceByCase, catalog, fileExists: (p) => existsSync(path.join(EVAL, p)) });

  console.log(`eval manifest: ${result.cases} cases`);
  for (const [type, bySource] of Object.entries(result.composition)) {
    console.log(`  ${type.padEnd(22)} ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(", ")}`);
  }
  for (const w of result.warnings) console.log(`  warning: ${w}`);
  for (const e of result.errors) console.error(`  ERROR: ${e}`);
  console.log(result.ok ? "VALID" : `INVALID (${result.errors.length} errors)`);
  return result.ok ? 0 : 1;
}

process.exitCode = main();
