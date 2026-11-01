import type { EvalCase } from "./manifest.schema";
import { proposedLines, reportableNew, type CaseRun, type Rate, type SourceMetrics } from "./metrics";

// Markdown report (TASKS T-052). Pure. First paragraph carries the data caveats (AI_PIPELINE.md §10.4).

/** Vertex list price for the pinned model (introductory, through 2026-12-31; spike/RESULTS.md). Estimate only. */
export const PRICE_PER_M = { input: 0.75, output: 3.75 };
export const costUsd = (t: { input: number; output: number }) => (t.input * PRICE_PER_M.input + t.output * PRICE_PER_M.output) / 1e6;

const pct = (r: Rate) => (r.rate === null ? "n/a (0 cases)" : `${(r.rate * 100).toFixed(0)}% (${r.hits}/${r.n})`);
const ms = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(1)} s`);

export interface RunMeta {
  runId: string;
  startedAt: string;
  model: string;
  promptVersion: string;
  mode: string;
  maxCalls: number;
}

export function renderReport(meta: RunMeta, cases: EvalCase[], runs: CaseRun[], metrics: SourceMetrics[]): string {
  const ran = runs.filter((r) => r.status === "RUN").length;
  const sources = [...new Set(cases.map((c) => c.source))];
  const generated = sources.filter((s) => s === "HYBRID" || s === "SYNTHETIC");
  const lines: string[] = [];
  lines.push(`# Holdfast inspection eval — ${meta.runId}`, "");
  lines.push(
    `**Read this first.** ${generated.length ? `Results on ${generated.join("/")} images do not demonstrate real-world accuracy. ` : "This run contains no AI-generated (HYBRID/SYNTHETIC) images: by owner decision no image-edit model is used, so all images are real photos of the owner's items (plus any openly licensed WEB photos listed). "}` +
      `${ran} case${ran === 1 ? "" : "s"} ran; ${ran < 30 ? "this is far too few for statistically meaningful rates — read the numbers as per-case evidence, not accuracy claims." : "rates are per-case counts, with no confidence intervals."} ` +
      `Prices come from the shop's price list, never from the model; this report measures only what the model proposes.`,
    "",
  );
  lines.push(`- Model: \`${meta.model}\` · prompt \`${meta.promptVersion}\` · mode \`${meta.mode}\` · call cap ${meta.maxCalls}`);
  lines.push(`- Started: ${meta.startedAt}`, "");

  for (const m of metrics) {
    lines.push(`## ${m.source} (${m.casesRun} run, ${m.casesSkipped} skipped)`, "");
    lines.push("### Clean returns (headline: false charges destroy trust)", "", "| Metric | Result |", "| --- | --- |");
    lines.push(`| Clean-return accuracy (no proposed line) | ${pct(m.cleanReturnAccuracy)} |`);
    lines.push(`| **False-charge rate** | ${pct(m.falseChargeRate)} |`);
    lines.push(`| Full clean return → NO_NEW_DAMAGE verdict | ${pct(m.fullCleanNoNewDamage)} |`);
    lines.push(`| Full clean return → no false charge | ${pct(m.fullCleanNoFalseCharge)} |`);
    lines.push(`| Clean-verdict precision | ${pct(m.cleanVerdictPrecision)} |`);
    lines.push(`| Clean cases not inspectable (INCOMPLETE) | ${pct(m.cleanIncomplete)} |`);
    const subtypes = Object.entries(m.falseChargeBySubtype);
    lines.push("", `False charges by hard-negative subtype: ${subtypes.length ? subtypes.map(([s, r]) => `${s} ${pct(r)}`).join(" · ") : "n/a"}`, "");
    lines.push("### Damage and quality", "", "| Metric | Result |", "| --- | --- |");
    lines.push(`| Charge decision accuracy | ${pct(m.chargeDecisionAccuracy)} |`);
    lines.push(`| New damage detected (any type) | ${pct(m.newDamageDetected)} |`);
    lines.push(`| Typed recall | ${pct(m.typedRecall)} |`);
    lines.push(`| Typed precision | ${pct(m.typedPrecision)} |`);
    lines.push(`| Severity exact / within one level | ${pct(m.severityExact)} / ${pct(m.severityWithinOne)} |`);
    lines.push(`| Pre-existing suppression | ${pct(m.preExistingSuppression)} |`);
    lines.push(`| Quality-fail flagged unusable | ${pct(m.qualityFailFlagged)} |`);
    lines.push(`| Localization (IoU ≥ 0.3) | n/a (no labelled boxes yet) |`, "");
    lines.push("### Reliability, latency, cost (live calls only)", "", "| Metric | Result |", "| --- | --- |");
    lines.push(`| Schema-valid first try / after retry | ${pct(m.schemaValidFirstTry)} / ${pct(m.schemaValidAfterRetry)} |`);
    lines.push(`| Latency per angle p50 / p95 | ${ms(m.latencyPerAngleP50Ms)} / ${ms(m.latencyPerAngleP95Ms)} |`);
    lines.push(`| 6-angle inspection wall time p50 | ${ms(m.sixAngleWallP50Ms)} |`);
    lines.push(`| Live calls · tokens in/out · est. cost | ${m.liveCalls} · ${m.tokens.input}/${m.tokens.output} · $${costUsd(m.tokens).toFixed(4)} |`, "");
  }

  lines.push("## Cases", "", "| Case | Source | Type | Expected | Verdict | Proposed lines | Reportable new findings | Mode |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of cases) {
    const r = runs.find((x) => x.caseId === c.caseId);
    const expected = c.expected.shouldCharge ? `charge (${c.expected.newFindings.map((f) => f.damageType ?? "untyped").join(", ")})` : "no charge";
    if (!r || r.status === "SKIPPED") {
      lines.push(`| ${c.caseId} | ${c.source} | ${c.caseType}${c.subtype ? ` / ${c.subtype}` : ""} | ${expected} | skipped: ${r?.skipReason ?? "not selected"} | | | |`);
      continue;
    }
    const found = reportableNew(r).map((f) => `${f.damageType} ${Math.round(f.confidence * 100)}%`).join(", ") || "none";
    lines.push(`| ${c.caseId} | ${c.source} | ${c.caseType}${c.subtype ? ` / ${c.subtype}` : ""} | ${expected} | ${r.verdict ?? "—"} | ${proposedLines(r)} | ${found} | ${r.mode} |`);
  }
  lines.push("", "Replay mode serves only recorded live model responses for byte-identical inputs (AI_PIPELINE.md §9).", "");
  return lines.join("\n");
}
