/**
 * Opt-in: runs the Repo contract against real Firestore. Needs the Firestore database and the
 * composite index on `it_rentals` (status asc, updatedAt desc), plus FIRESTORE_INTEGRATION=1:
 *
 *   FIRESTORE_INTEGRATION=1 npm run test:integration
 *
 * All test data lives under the fixed `it_` collection prefix (never dev_ or demo data). Indexes are
 * per collection name, so the prefix is fixed and isolation comes from wiping `it_*` collections
 * before each test; tests within a file run sequentially.
 */
import { Firestore } from "@google-cloud/firestore";
import { config as loadDotenv } from "dotenv";
import { describe, it } from "vitest";
import { describeRepoContract } from "./contract";
import { FirestoreRepo } from "./firestore";
import { COLLECTIONS } from "./types";

loadDotenv({ path: ".env.local", quiet: true });
const PREFIX = "it_";

if (process.env.FIRESTORE_INTEGRATION === "1") {
  const projectId = process.env.GCP_PROJECT_ID;
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= projectId;
  const db = new Firestore({ projectId, ignoreUndefinedProperties: true });

  describeRepoContract("FirestoreRepo", async () => {
    // recursiveDelete also removes rental subcollections (photos, events, ...).
    await Promise.all(Object.values(COLLECTIONS).map((c) => db.recursiveDelete(db.collection(`${PREFIX}${c}`))));
    return new FirestoreRepo({ firestore: db, prefix: PREFIX });
  });
} else {
  describe("FirestoreRepo contract", () => {
    it.skip("set FIRESTORE_INTEGRATION=1 to run against real Firestore", () => {});
  });
}
