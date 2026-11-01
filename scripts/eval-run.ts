/**
 * Runs the evaluation set through the real inspection pipeline (TASKS T-052).
 *
 *   npm run eval -- --mode replay                       # $0: recorded live results only
 *   npm run eval -- --mode auto --max-calls 12          # replay when recorded, otherwise live (capped)
 *   npm run eval -- --mode live --cases c002,c003 --max-calls 8
 *   options: --source REAL,WEB   --cases c001,c004
 *
 * Each case: normalize photos exactly like the app (src/server/photos.ts) → BASELINE call on the
 * check-out photo → RETURN call with those marks → thresholds and verdict (src/server/ai/verdict.ts).
 * Live calls are capped by the app's own daily counter: limit = today's usage + --max-calls.
 * Writes eval/reports/<runId>.md and .json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { config as loadDotenv } from "dotenv";
import { manifest as manifestSchema, type EvalCase } from "../eval/manifest.schema";
import { computeMetrics, type AngleRun, type CaseRun } from "../eval/metrics";
import { costUsd, renderReport } from "../eval/report";
import { caseImages } from "../eval/validate";

loadDotenv({ path: ".env.local", quiet: true });

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { mode: { type: "string", default: "replay" }, "max-calls": { type: "string" }, source: { type: "string" }, cases: { type: "string" } },
    strict: true,
  });
  const mode = values.mode;
  if (mode !== "live" && mode !== "replay" && mode !== "auto") throw new Error("--mode live|replay|auto");
  const maxCalls = mode === "replay" ? 0 : Number(values["max-calls"]);
  if (mode !== "replay" && (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 60)) throw new Error("--max-calls 1–60 is required for live/auto");
  const sources = values.source?.split(",");
  const only = values.cases?.split(",");

  const { getRepo } = await import("../src/server/deps");
  const { gcsStore } = await import("../src/server/storage");
  const { modelClient } = await import("../src/server/ai/client");
  const { runAngle, mapPool, ANGLE_CONCURRENCY } = await import("../src/server/ai/inspect");
  const { baselineUserText, returnUserText, PROMPT_VERSION } = await import("../src/server/ai/prompts");
  const { BaselineResult, ReturnResult } = await import("../src/server/ai/schemas");
  const { inspectionVerdict } = await import("../src/server/ai/verdict");
  const { utcDay } = await import("../src/server/ai/usage");
  const { normalizePhoto } = await import("../src/server/photos");

  const parsed = manifestSchema.parse(JSON.parse(readFileSync("eval/manifest.json", "utf8")));
  const catalog = (JSON.parse(readFileSync("data/catalog.json", "utf8")) as { items: { id: string; name: string; description: string; angles: { id: string; label: string }[] }[] }).items;
  const itemOf = (id: string) => catalog.find((i) => i.id === id) ?? parsed.extraItems.find((i) => i.id === id);
  const angleLabel = (itemId: string, angleId: string) => catalog.find((i) => i.id === itemId)?.angles.find((a) => a.id === angleId)?.label ?? angleId;

  const repo = getRepo();
  const model = modelClient();
  const usedToday = () => repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
  const before = await usedToday();
  const live = { repo, store: gcsStore, model, mode: "LIVE" as const, dailyLimit: before + maxCalls };
  const replay = { ...live, mode: "REPLAY" as const };
  const runId = `eval-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  console.log(`${runId}: mode ${mode}, call cap ${maxCalls}, AI calls today before: ${before}`);

  /** Replay first in auto mode; fall back to live only when no recording exists. */
  async function call<T>(req: Parameters<typeof runAngle<T>>[1]) {
    if (mode !== "live") {
      const r = await runAngle(replay, req);
      if (r.ok || mode === "replay" || !/No recorded live result/.test(r.error)) return r;
    }
    return runAngle(live, req);
  }
  const toRun = (o: Awaited<ReturnType<typeof call<unknown>>>, angleId: string, extra: Partial<AngleRun>): AngleRun => ({
    angleId,
    ok: o.ok,
    ...(o.ok ? {} : { error: o.error }),
    usable: false,
    findings: [],
    latencyMs: o.latencyMs,
    calls: o.calls ?? 0,
    firstTryValid: o.firstTryValid ?? false,
    replayed: o.replayed ?? false,
    usage: o.usage,
    ...extra,
  });

  const selected: EvalCase[] = parsed.cases.filter((c) => (!sources || sources.includes(c.source)) && (!only || only.includes(c.caseId)));
  const runs: CaseRun[] = [];
  for (const c of selected) {
    const skip = (why: string) => {
      runs.push({ caseId: c.caseId, status: "SKIPPED", skipReason: why, angles: [], baseline: [], wallMs: 0 });
      console.log(`  ${c.caseId} skipped: ${why}`);
    };
    if ((c.source === "HYBRID" || c.source === "SYNTHETIC") && !c.humanVerified) { skip("generated image not human-verified"); continue; }
    const imgs = caseImages(c);
    if (imgs.some((i) => !existsSync(path.join("eval", i.before)) || !existsSync(path.join("eval", i.after)))) { skip("images not present"); continue; }
    const item = itemOf(c.item)!;
    const t0 = Date.now();
    const pairs = await mapPool(imgs, ANGLE_CONCURRENCY, async (img) => {
      const [b, a] = await Promise.all([normalizePhoto(readFileSync(path.join("eval", img.before))), normalizePhoto(readFileSync(path.join("eval", img.after)))]);
      const label = angleLabel(c.item, img.angleId);
      const rentalId = `${runId}-${c.caseId}`;
      const base = await call({ rentalId, inspectionId: "baseline", kind: "BASELINE", angleId: img.angleId, text: baselineUserText({ itemName: item.name, itemDescription: item.description, angleId: img.angleId, angleLabel: label }), images: [{ bytes: b.bytes, sha256: b.sha256 }], baselineMarksJson: "", schema: BaselineResult });
      const marks = base.ok ? base.result.marks : [];
      const ret = await call({ rentalId, inspectionId: "return", kind: "RETURN", angleId: img.angleId, text: returnUserText({ itemName: item.name, angleId: img.angleId, angleLabel: label, baselineMarks: marks }), images: [{ bytes: b.bytes, sha256: b.sha256 }, { bytes: a.bytes, sha256: a.sha256 }], baselineMarksJson: JSON.stringify(marks), schema: ReturnResult });
      return {
        baseline: toRun(base, img.angleId, base.ok ? { usable: base.result.imageQuality.usable } : {}),
        ret: toRun(ret, img.angleId, ret.ok ? { usable: ret.result.imageQuality.usable, noChangeConfidence: ret.result.noChangeConfidence, findings: ret.result.findings } : {}),
      };
    });
    const angles = pairs.map((p) => p.ret);
    const baseline = pairs.map((p) => p.baseline);
    const all = [...angles, ...baseline];
    const replayedAll = all.every((a) => a.replayed);
    const liveAll = all.every((a) => !a.replayed);
    const verdict = inspectionVerdict(angles.map((a) => ({ usable: a.usable, needsHuman: !a.ok, findings: a.findings, ...(a.noChangeConfidence !== undefined ? { noChangeConfidence: a.noChangeConfidence } : {}) })));
    const run: CaseRun = { caseId: c.caseId, status: "RUN", mode: replayedAll ? "REPLAY" : liveAll ? "LIVE" : "MIXED", angles, baseline, verdict, wallMs: Date.now() - t0 };
    const failed = all.find((a) => !a.ok);
    // A replay miss is "not run", never a model failure.
    if (all.some((a) => !a.ok && /No recorded live result/.test(a.error ?? ""))) { skip("no recorded live result for every call (replay)"); continue; }
    runs.push(run);
    console.log(`  ${c.caseId} ${run.mode} verdict ${verdict}${failed ? ` (angle ${failed.angleId}: ${failed.error})` : ""}`);
  }

  const used = (await usedToday()) - before;
  const metrics = [...new Set(selected.map((c) => c.source))].map((s) => computeMetrics(s, selected, runs));
  const meta = { runId, startedAt: new Date().toISOString(), model: model.model, promptVersion: PROMPT_VERSION, mode, maxCalls };
  mkdirSync("eval/reports", { recursive: true });
  writeFileSync(`eval/reports/${runId}.json`, JSON.stringify({ meta, liveCalls: used, runs, metrics }, null, 2));
  writeFileSync(`eval/reports/${runId}.md`, renderReport(meta, selected, runs, metrics));
  const tokens = metrics.reduce((t, m) => ({ input: t.input + m.tokens.input, output: t.output + m.tokens.output }), { input: 0, output: 0 });
  console.log(`live calls this run: ${used} · est. cost $${costUsd(tokens).toFixed(4)} · report eval/reports/${runId}.md`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(`eval ERROR: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
