/**
 * Opt-in LIVE Vertex test (PAID, ~$0.005 per call): full baseline → return → priced report on real
 * owner photo pairs, one angle per item, using the seed catalog and price lists.
 *
 *   AI_LIVE=1 AI_LIVE_MAX_CALLS=8 npm run test:integration -- return
 *
 * Hard bound: the code's daily cap is AI_LIVE_MAX_CALLS on a fresh `it_` usage counter. Writes a summary
 * to eval/reports/ (gitignored). Rental states between steps are set directly in `it_` collections
 * (labelled test fixtures: the renter-acknowledgement page arrives with T-040).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import type { Item, PriceList } from "@/domain/types";
import { applyReturnInspection } from "../lineItems";
import { uploadPhoto } from "../photos";
import { FirestoreRepo } from "../repo/firestore";
import { COLLECTIONS } from "../repo/types";
import { gcsStore, mediaBucket } from "../storage";
import { vertexModelClient } from "./client";
import { runBaselineInspection, runReturnInspection, type InspectDeps } from "./inspect";
import { utcDay } from "./usage";

loadDotenv({ path: ".env.local", quiet: true });
const PAIRS = [
  { itemId: "headphones", pair: "eval/spike-pairs/1", truth: "NEW_DAMAGE ear cushion removed" },
  { itemId: "backpack", pair: "eval/spike-pairs/4", truth: "NO_CHANGE warm vs daylight; pre-existing scuff unchanged" },
];
const run = process.env.AI_LIVE === "1" && PAIRS.every((p) => existsSync(`${p.pair}/before.jpg`) && existsSync(`${p.pair}/after.jpg`));

describe.runIf(run)("return inspection against Vertex (live, paid)", () => {
  it("baseline → return → priced report on real pairs", { timeout: 300_000 }, async () => {
    const maxCalls = Number(process.env.AI_LIVE_MAX_CALLS ?? "8");
    expect(maxCalls).toBeLessThanOrEqual(20);
    const project = process.env.GCP_PROJECT_ID!;
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
    const db = new Firestore({ projectId: project, ignoreUndefinedProperties: true });
    const wipe = () => Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`it_${c}`))));
    await wipe();
    const repo = new FirestoreRepo({ firestore: db, prefix: "it_" });
    const model = vertexModelClient({ project, location: process.env.VERTEX_LOCATION!, model: process.env.GEMINI_MODEL! });
    const deps: InspectDeps = { repo, store: gcsStore, model, mode: "LIVE", dailyLimit: maxCalls };
    const catalog = (JSON.parse(readFileSync("data/catalog.json", "utf8")) as { items: Item[] }).items;
    const priceLists = (JSON.parse(readFileSync("data/priceList.json", "utf8")) as { priceLists: PriceList[] }).priceLists;
    const stamp = Date.now();
    const rentalIds: string[] = [];
    const results: unknown[] = [];

    try {
      for (const p of PAIRS) {
        const seed = catalog.find((i) => i.id === p.itemId)!;
        const front = seed.angles.find((a) => a.id === "front")!;
        await repo.putItem({ ...seed, angles: [front] }); // one angle per item for this check
        await repo.putPriceList(priceLists.find((l) => l.id === seed.priceListId)!);
        const rentalId = `it-ret-${p.itemId}-${stamp}`;
        rentalIds.push(rentalId);
        const t = new Date().toISOString();
        await repo.createRental({
          id: rentalId,
          itemId: p.itemId,
          renter: { name: "Integration Test", email: "it@example.com" },
          days: 1,
          depositCents: seed.depositCents,
          status: "AUTHORIZED", // test fixture: no PayPal object exists for it
          paymentState: "NONE",
          paypal: { captures: [], refunds: [] },
          settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
          contestRound: 0,
          createdAt: t,
          updatedAt: t,
          version: 1,
        });
        await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKOUT", angleId: "front", provenance: "UPLOADED_REAL", file: readFileSync(`${p.pair}/before.jpg`) });
        const baseline = await runBaselineInspection(deps, rentalId);
        expect(baseline.rentalStatus).toBe("BASELINE_READY");

        // Test fixture step: renter acknowledgement (T-040) → CHECKED_OUT.
        await repo.runTransaction(async (tx) => {
          const r = (await tx.getRental(rentalId))!;
          tx.putRental({ ...r, status: "CHECKED_OUT", baselineAck: { at: new Date().toISOString(), tokenId: "it-fixture" }, version: r.version + 1 });
        });
        const up = await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKIN", angleId: "front", provenance: "UPLOADED_REAL", file: readFileSync(`${p.pair}/after.jpg`) });
        expect(up.rentalStatus).toBe("RETURNED");

        const { inspection, wallMs } = await runReturnInspection(deps, rentalId);
        const applied = await applyReturnInspection(repo, rentalId, inspection, { wallMs });
        results.push({
          item: p.itemId,
          truth: p.truth,
          baselineMarks: baseline.inspection.perAngle[0]!.marks,
          verdict: inspection.verdict,
          rentalStatus: applied.rentalStatus,
          wallMs,
          findings: inspection.perAngle[0]!.findings,
          noChangeConfidence: inspection.perAngle[0]!.noChangeConfidence,
          lines: applied.lines.map((l) => ({ label: l.label, amountCents: l.amountCents, decision: l.staffDecision })),
          proposedTotalCents: applied.proposedTotalCents,
          tokens: { baseline: baseline.inspection.tokenUsage, return: inspection.tokenUsage },
        });
        expect(wallMs).toBeLessThan(60_000);
      }
    } finally {
      const calls = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
      mkdirSync("eval/reports", { recursive: true });
      const file = `eval/reports/t033-live-${stamp}.json`;
      writeFileSync(file, JSON.stringify({ model: model.model, modelCalls: calls, maxCalls, results }, null, 2));
      console.log(`summary written to ${file} (model calls: ${calls})`);
      for (const id of rentalIds) {
        await mediaBucket().deleteFiles({ prefix: `rentals/${id}/` });
        await mediaBucket().deleteFiles({ prefix: `ai/${id}/` });
      }
      await wipe();
    }
  });
});
