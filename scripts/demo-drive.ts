/**
 * Drives the staff-side steps of a demo rental with the owner's real photos, through the same service
 * code the staff routes call (photo pipeline, AI inspections, pricing). The human steps (PayPal booking,
 * renter acknowledgement, staff review + Confirm) stay in the browser.
 *
 *   npx tsx --conditions=react-server scripts/demo-drive.ts --rental r_… --step checkout --mode live --max-calls 6
 *   npx tsx --conditions=react-server scripts/demo-drive.ts --rental r_… --step return   --mode replay
 *
 * --mode replay serves only recorded LIVE results for byte-identical photos (AI_PIPELINE.md §9) and is
 * labelled in the UI. --max-calls caps live calls for this run on top of today's usage (default 6).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local", quiet: true });

const DIR = "eval/clean-return/headphones";
/** seed angle id → [check-out file, return file] (owner's file names) */
const FILES: Record<string, [string, string]> = {
  front: ["front.jpg", "after.jpg"],
  back: ["back.jpg", "back.jpg"],
  "left-side": ["left.jpg", "left.jpg"],
  "right-side": ["right.jpg", "right.jpg"],
  top: ["top.jpg", "top.jpg"],
  bottom: ["bottom.jpg", "bottom.jpg"],
};

async function main() {
  const { values } = parseArgs({
    options: { rental: { type: "string" }, step: { type: "string" }, mode: { type: "string" }, "max-calls": { type: "string" } },
    strict: true,
  });
  const rentalId = values.rental ?? "";
  if (!/^r_[0-9a-f]{20}$/.test(rentalId)) throw new Error("--rental r_<20 hex> required");
  if (values.step !== "checkout" && values.step !== "return") throw new Error("--step checkout|return");
  if (values.mode !== "live" && values.mode !== "replay") throw new Error("--mode live|replay");
  const maxCalls = Number(values["max-calls"] ?? "6");
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 12) throw new Error("--max-calls 0–12");

  const { getRepo } = await import("../src/server/deps");
  const { gcsStore } = await import("../src/server/storage");
  const { modelClient } = await import("../src/server/ai/client");
  const { runBaselineInspection, runReturnInspection } = await import("../src/server/ai/inspect");
  const { utcDay } = await import("../src/server/ai/usage");
  const { applyReturnInspection } = await import("../src/server/lineItems");
  const { uploadPhoto } = await import("../src/server/photos");

  const repo = getRepo();
  const usedToday = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
  const deps = { repo, store: gcsStore, model: modelClient(), mode: values.mode === "replay" ? ("REPLAY" as const) : ("LIVE" as const), dailyLimit: usedToday + (values.mode === "replay" ? 0 : maxCalls) };
  const rental = await repo.getRental(rentalId);
  if (!rental) throw new Error(`rental ${rentalId} not found (collections use FIRESTORE_COLLECTION_PREFIX)`);
  console.log(`${rentalId}: ${rental.status}; mode ${deps.mode}; AI calls today before: ${usedToday}; cap for this run: ${deps.dailyLimit - usedToday}`);

  const phase = values.step === "checkout" ? "CHECKOUT" : "CHECKIN";
  for (const [angleId, [before, after]] of Object.entries(FILES)) {
    const file = readFileSync(`${DIR}/${phase === "CHECKOUT" ? "before" : "after"}/${phase === "CHECKOUT" ? before : after}`);
    const { rentalStatus } = await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase, angleId, provenance: "UPLOADED_REAL", file });
    console.log(`  uploaded ${phase} ${angleId} → rental ${rentalStatus}`);
  }

  if (values.step === "checkout") {
    const { inspection, rentalStatus } = await runBaselineInspection(deps, rentalId);
    console.log(`baseline ${inspection.status} (${inspection.mode}) → rental ${rentalStatus}; tokens ${JSON.stringify(inspection.tokenUsage)}`);
    for (const a of inspection.perAngle) console.log(`  ${a.angleId}: usable=${a.usable} ${a.needsHuman ? `NEEDS_HUMAN ${a.error}` : ""} marks=${a.marks?.length ?? 0}`);
  } else {
    const { inspection, wallMs } = await runReturnInspection(deps, rentalId);
    const applied = await applyReturnInspection(repo, rentalId, inspection, { wallMs });
    console.log(`return ${inspection.status} (${inspection.mode}) verdict ${inspection.verdict} in ${wallMs} ms → rental ${applied.rentalStatus}; proposed ${applied.proposedTotalCents}¢; tokens ${JSON.stringify(inspection.tokenUsage)}`);
    for (const a of inspection.perAngle) console.log(`  ${a.angleId}: usable=${a.usable} noChange=${a.noChangeConfidence} findings=${a.findings.map((f) => `${f.damageType}/new=${f.isNew}/${f.confidence}`).join(",") || "none"}${a.needsHuman ? ` NEEDS_HUMAN ${a.error}` : ""}`);
  }
  const usedAfter = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
  console.log(`AI calls this run: ${usedAfter - usedToday}`);
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (e: unknown) => {
    console.error(`demo-drive ERROR: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  },
);
