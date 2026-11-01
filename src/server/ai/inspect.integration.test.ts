/**
 * Opt-in LIVE Vertex test (PAID, ~$0.005 per call). Runs a BASELINE inspection on one real owner photo
 * per demo item, then replays one of them with zero calls.
 *
 *   AI_LIVE=1 AI_LIVE_MAX_CALLS=6 npm run test:integration -- inspect
 *
 * Hard bound: the code's own daily cap is set to AI_LIVE_MAX_CALLS (default 6) on a fresh `it_` usage
 * counter, so the run cannot make more calls than that. Uses `it_` collections and deletes its photos
 * and raw responses; the ai-replay/ recordings it writes are real live results and are kept.
 */
import { existsSync, readFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import type { Item } from "@/domain/types";
import { uploadPhoto } from "../photos";
import { FirestoreRepo } from "../repo/firestore";
import { COLLECTIONS } from "../repo/types";
import { gcsStore, mediaBucket } from "../storage";
import { vertexModelClient } from "./client";
import { runAngle, runBaselineInspection, type InspectDeps } from "./inspect";
import { baselineUserText } from "./prompts";
import { BaselineResult } from "./schemas";
import { utcDay } from "./usage";

loadDotenv({ path: ".env.local", quiet: true });
const CASES = [
  { itemId: "headphones", name: "Wireless over-ear headphones", description: "Wireless over-ear headphones, matte black.", photo: "eval/spike-pairs/1/before.jpg" },
  { itemId: "speaker", name: "Portable Bluetooth speaker", description: "Portable Bluetooth speaker, silver aluminum body with metal grille.", photo: "eval/spike-pairs/3/before.jpg" },
  { itemId: "backpack", name: "Everyday daypack", description: "Everyday daypack backpack, dark blue canvas.", photo: "eval/spike-pairs/4/before.jpg" },
];
const run = process.env.AI_LIVE === "1" && CASES.every((c) => existsSync(c.photo));

describe.runIf(run)("baseline inspection against Vertex (live, paid)", () => {
  it("inspects one real photo per item, then replays with zero calls", { timeout: 180_000 }, async () => {
    const maxCalls = Number(process.env.AI_LIVE_MAX_CALLS ?? "6");
    expect(maxCalls).toBeLessThanOrEqual(20);
    const project = process.env.GCP_PROJECT_ID!;
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
    const db = new Firestore({ projectId: project, ignoreUndefinedProperties: true });
    const wipe = () => Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`it_${c}`))));
    await wipe();
    const repo = new FirestoreRepo({ firestore: db, prefix: "it_" });
    const model = vertexModelClient({ project, location: process.env.VERTEX_LOCATION!, model: process.env.GEMINI_MODEL! });
    const deps: InspectDeps = { repo, store: gcsStore, model, mode: "LIVE", dailyLimit: maxCalls };
    const stamp = Date.now();
    const rentalIds: string[] = [];

    try {
      const summary: unknown[] = [];
      for (const c of CASES) {
        const item: Item = {
          id: c.itemId,
          name: c.name,
          description: c.description,
          imagePath: `items/${c.itemId}.jpg`,
          depositCents: 6000,
          dailyRateCents: 700,
          priceListId: `pl-${c.itemId}`,
          angles: [{ id: "front", label: "Front", hint: "" }],
          active: true,
        };
        await repo.putItem(item);
        const rentalId = `it-ai-${c.itemId}-${stamp}`;
        rentalIds.push(rentalId);
        await repo.createRental({
          id: rentalId,
          itemId: c.itemId,
          renter: { name: "Integration Test", email: "it@example.com" },
          days: 1,
          depositCents: 6000,
          status: "AUTHORIZED", // test fixture state in it_ collections; no PayPal object exists for it
          paymentState: "NONE",
          paypal: { captures: [], refunds: [] },
          settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
          contestRound: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        });
        await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKOUT", angleId: "front", provenance: "UPLOADED_REAL", file: readFileSync(c.photo) });
        const { inspection, rentalStatus } = await runBaselineInspection(deps, rentalId);
        const a = inspection.perAngle[0]!;
        summary.push({ item: c.itemId, rentalStatus, usable: a.usable, issues: a.issues, needsHuman: a.needsHuman, error: a.error, latencyMs: a.latencyMs, tokens: inspection.tokenUsage, marks: a.marks?.map((m) => `${m.damageType}/${m.severity}: ${m.description}`) });
        expect(a.needsHuman).toBeUndefined(); // schema-valid answer within 2 attempts
      }

      // Replay: same photo bytes → the recorded live answer, no call.
      const headphones = (await repo.listPhotos(rentalIds[0]!, "CHECKOUT"))[0]!;
      const callsBefore = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
      const replayed = await runAngle(
        { ...deps, mode: "REPLAY" },
        {
          rentalId: rentalIds[0]!,
          inspectionId: "replay-check",
          kind: "BASELINE",
          angleId: "front",
          text: baselineUserText({ itemName: CASES[0]!.name, itemDescription: CASES[0]!.description, angleId: "front", angleLabel: "Front" }),
          images: [{ bytes: (await gcsStore.read(headphones.gcsPath))!, sha256: headphones.sha256 }],
          baselineMarksJson: "",
          schema: BaselineResult,
        },
      );
      const callsAfter = await repo.runTransaction((tx) => tx.getAiUsage(utcDay(new Date())));
      const first = (await repo.listInspections(rentalIds[0]!))[0]!.perAngle[0]!;
      console.log(JSON.stringify({ summary, modelCalls: callsAfter, replay: { ok: replayed.ok, sameMarks: replayed.ok && JSON.stringify(replayed.result.marks) === JSON.stringify(first.marks), callsDuringReplay: callsAfter - callsBefore } }, null, 2));
      expect(replayed.ok).toBe(true);
      expect(callsAfter - callsBefore).toBe(0);
      expect(callsAfter).toBeLessThanOrEqual(maxCalls);
    } finally {
      for (const id of rentalIds) {
        await mediaBucket().deleteFiles({ prefix: `rentals/${id}/` });
        await mediaBucket().deleteFiles({ prefix: `ai/${id}/` });
      }
      await wipe();
    }
  });
});
