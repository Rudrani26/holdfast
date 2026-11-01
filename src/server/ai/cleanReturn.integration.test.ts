/**
 * Opt-in LIVE Vertex test (PAID, ~$0.005 per call). T-033 acceptance (b): a real unchanged item,
 * 6 angles, photographed at check-out and again at return under different light → NO_NEW_DAMAGE
 * (or a documented reason why not).
 *
 *   AI_LIVE=1 AI_LIVE_MAX_CALLS=24 npm run test:integration -- cleanReturn
 *
 * Photos (owner's, gitignored): eval/clean-return/headphones/{before,after}/. File names map to the
 * seed angle ids below. Hard bound: the code's daily cap = AI_LIVE_MAX_CALLS on a fresh `it_` counter.
 * Summary → eval/reports/ (gitignored). States between steps are labelled `it_` fixtures (T-040 pending).
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
const DIR = "eval/clean-return/headphones";
/** seed angle id → [before file, after file] */
const FILES: Record<string, [string, string]> = {
  front: ["front.jpg", "after.jpg"],
  back: ["back.jpg", "back.jpg"],
  "left-side": ["left.jpg", "left.jpg"],
  "right-side": ["right.jpg", "right.jpg"],
  top: ["top.jpg", "top.jpg"],
  bottom: ["bottom.jpg", "bottom.jpg"],
};
const run = process.env.AI_LIVE === "1" && Object.values(FILES).every(([b, a]) => existsSync(`${DIR}/before/${b}`) && existsSync(`${DIR}/after/${a}`));

describe.runIf(run)("clean 6-angle return against Vertex (live, paid)", () => {
  it("unchanged headphones → NO_NEW_DAMAGE", { timeout: 400_000 }, async () => {
    const maxCalls = Number(process.env.AI_LIVE_MAX_CALLS ?? "24");
    expect(maxCalls).toBeLessThanOrEqual(24);
    const project = process.env.GCP_PROJECT_ID!;
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
    const db = new Firestore({ projectId: project, ignoreUndefinedProperties: true });
    const wipe = () => Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`it_${c}`))));
    await wipe();
    const repo = new FirestoreRepo({ firestore: db, prefix: "it_" });
    const model = vertexModelClient({ project, location: process.env.VERTEX_LOCATION!, model: process.env.GEMINI_MODEL! });
    const deps: InspectDeps = { repo, store: gcsStore, model, mode: "LIVE", dailyLimit: maxCalls };
    const item = (JSON.parse(readFileSync("data/catalog.json", "utf8")) as { items: Item[] }).items.find((i) => i.id === "headphones")!;
    const priceList = (JSON.parse(readFileSync("data/priceList.json", "utf8")) as { priceLists: PriceList[] }).priceLists.find((p) => p.id === item.priceListId)!;
    expect(item.angles.map((a) => a.id).sort()).toEqual(Object.keys(FILES).sort());
    await repo.putItem(item);
    await repo.putPriceList(priceList);
    const stamp = Date.now();
    const rentalId = `it-clean-${stamp}`;
    const summary: Record<string, unknown> = { item: item.id, rentalId };

    try {
      const t = new Date().toISOString();
      await repo.createRental({
        id: rentalId,
        itemId: item.id,
        renter: { name: "Integration Test", email: "it@example.com" },
        days: 2,
        depositCents: item.depositCents,
        status: "AUTHORIZED", // test fixture: no PayPal object exists for it
        paymentState: "NONE",
        paypal: { captures: [], refunds: [] },
        settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
        contestRound: 0,
        createdAt: t,
        updatedAt: t,
        version: 1,
      });
      for (const [angleId, [before]] of Object.entries(FILES)) {
        await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKOUT", angleId, provenance: "UPLOADED_REAL", file: readFileSync(`${DIR}/before/${before}`) });
      }
      const baseline = await runBaselineInspection(deps, rentalId);
      summary.baseline = {
        status: baseline.inspection.status,
        rentalStatus: baseline.rentalStatus,
        tokens: baseline.inspection.tokenUsage,
        perAngle: baseline.inspection.perAngle.map((a) => ({ angleId: a.angleId, usable: a.usable, issues: a.issues, needsHuman: a.needsHuman, error: a.error, marks: a.marks?.map((m) => `${m.markId} ${m.damageType}/${m.severity}: ${m.description}`) })),
      };
      expect(baseline.rentalStatus).toBe("BASELINE_READY");

      // Test fixture step: renter acknowledgement (T-040) → CHECKED_OUT.
      await repo.runTransaction(async (tx) => {
        const r = (await tx.getRental(rentalId))!;
        tx.putRental({ ...r, status: "CHECKED_OUT", baselineAck: { at: new Date().toISOString(), tokenId: "it-fixture" }, version: r.version + 1 });
      });
      for (const [angleId, [, after]] of Object.entries(FILES)) {
        await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKIN", angleId, provenance: "UPLOADED_REAL", file: readFileSync(`${DIR}/after/${after}`) });
      }
      const { inspection, wallMs } = await runReturnInspection(deps, rentalId);
      const applied = await applyReturnInspection(repo, rentalId, inspection, { wallMs });
      summary.return = {
        verdict: inspection.verdict,
        status: inspection.status,
        rentalStatus: applied.rentalStatus,
        wallMs,
        proposedTotalCents: applied.proposedTotalCents,
        tokens: inspection.tokenUsage,
        perAngle: inspection.perAngle.map((a) => ({
          angleId: a.angleId,
          usable: a.usable,
          issues: a.issues,
          needsHuman: a.needsHuman,
          noChangeConfidence: a.noChangeConfidence,
          findings: a.findings.map((f) => `${f.findingId} ${f.damageType}/${f.severity} new=${f.isNew} conf=${f.confidence} match=${f.matchesBaselineMarkId}: ${f.evidence}`),
        })),
        event: (await repo.listEvents(rentalId)).find((e) => e.type.startsWith("AI_REPORT"))?.summary,
      };
      expect(wallMs).toBeLessThan(60_000);
      expect(inspection.verdict).toBe("NO_NEW_DAMAGE");
    } finally {
      summary.modelCalls = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
      summary.maxCalls = maxCalls;
      mkdirSync("eval/reports", { recursive: true });
      writeFileSync(`eval/reports/t033-clean-return-${stamp}.json`, JSON.stringify(summary, null, 2));
      await mediaBucket().deleteFiles({ prefix: `rentals/${rentalId}/` });
      await mediaBucket().deleteFiles({ prefix: `ai/${rentalId}/` });
      await wipe();
    }
  });
});
