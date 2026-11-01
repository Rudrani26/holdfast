/**
 * Opt-in: the real upload path — sharp pipeline → GCS bucket → Firestore (`it_` collections) → read back.
 *
 *   FIRESTORE_INTEGRATION=1 npm run test:integration -- photos
 *
 * Uses a real owner photo from eval/spike-pairs (gitignored; skipped if absent). Deletes the objects
 * and `it_` documents it creates.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { config as loadDotenv } from "dotenv";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { readPhoto, uploadPhoto } from "./photos";
import { FirestoreRepo } from "./repo/firestore";
import { COLLECTIONS } from "./repo/types";
import { gcsStore, mediaBucket } from "./storage";

loadDotenv({ path: ".env.local", quiet: true });
const PHOTO = "eval/spike-pairs/1/before.jpg";
const run = process.env.FIRESTORE_INTEGRATION === "1" && existsSync(PHOTO);

describe.runIf(run)("photo upload against GCS + Firestore (live)", () => {
  it("normalizes, stores, records and reads back a real photo", { timeout: 60_000 }, async () => {
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= process.env.GCP_PROJECT_ID;
    const db = new Firestore({ projectId: process.env.GCP_PROJECT_ID, ignoreUndefinedProperties: true });
    await Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`it_${c}`))));
    const repo = new FirestoreRepo({ firestore: db, prefix: "it_" });
    const rentalId = `it-photo-${Date.now()}`;
    await repo.putItem({
      id: "headphones",
      name: "Wireless over-ear headphones",
      description: "Wireless over-ear headphones, matte black.",
      imagePath: "items/headphones.jpg",
      depositCents: 20000,
      dailyRateCents: 1800,
      priceListId: "pl-headphones",
      angles: [{ id: "front", label: "Front", hint: "" }],
      active: true,
    });
    await repo.createRental({
      id: rentalId,
      itemId: "headphones",
      renter: { name: "Integration Test", email: "it@example.com" },
      days: 1,
      depositCents: 20000,
      status: "AUTHORIZED", // test fixture state in it_ collections; no PayPal object exists for it
      paymentState: "NONE",
      paypal: { captures: [], refunds: [] },
      settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
      contestRound: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    });

    const original = readFileSync(PHOTO);
    try {
      const { photo } = await uploadPhoto({ repo, store: gcsStore }, { rentalId, phase: "CHECKOUT", angleId: "front", provenance: "UPLOADED_REAL", file: original });
      console.log(`uploaded ${original.length} B → ${photo.gcsPath} ${photo.width}x${photo.height}`);
      const [meta] = await mediaBucket().file(photo.gcsPath).getMetadata();
      expect(meta.contentType).toBe("image/jpeg");
      const back = (await readPhoto({ repo, store: gcsStore }, rentalId, "CHECKOUT_front"))!;
      expect(createHash("sha256").update(back).digest("hex")).toBe(photo.sha256);
      expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(1600);
      expect((await sharp(back).metadata()).exif).toBeUndefined();
      expect((await repo.listEvents(rentalId)).map((e) => e.type)).toEqual(["PHOTO_UPLOADED"]);
    } finally {
      await mediaBucket().deleteFiles({ prefix: `rentals/${rentalId}/` });
      await Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`it_${c}`))));
    }
  });
});
