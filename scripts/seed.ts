/**
 * Seeds the demo catalog and price lists into Firestore and uploads item hero images to GCS (T-015).
 *
 *   npm run seed                  # validate, upload changed images, upsert items and price lists
 *   npm run seed -- --dry-run     # validate and show what would change; writes nothing
 *   npm run seed -- --skip-images # Firestore only
 *   npm run seed -- --production  # deployed collections (no prefix), whatever .env.local says
 *
 * Idempotent: documents are upserted by id (a re-run never duplicates), and an image is uploaded only
 * when its normalized bytes differ from the object already in the bucket (MD5 comparison).
 * Collections use FIRESTORE_COLLECTION_PREFIX, as the app does.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Storage } from "@google-cloud/storage";
import { config as loadDotenv } from "dotenv";
import sharp from "sharp";
import { getEnv } from "@/lib/env";
import { FirestoreRepo } from "@/server/repo/firestore";
import { parseSeedData } from "./seed-data";

loadDotenv({ path: ".env.local", quiet: true });

const HERO_MAX_PX = 1600;

/** Upright, at most 1600 px on the long side, JPEG, no metadata. Deterministic for a given input. */
async function normalizeHeroImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: HERO_MAX_PX, height: HERO_MAX_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/** JSON with sorted keys, so Firestore's map key order does not count as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

type Change = "created" | "updated" | "unchanged";
const change = (before: unknown, after: unknown): Change =>
  before === undefined ? "created" : stable(before) === stable(after) ? "unchanged" : "updated";

async function main(argv: string[]): Promise<number> {
  const unknown = argv.filter((a) => a !== "--dry-run" && a !== "--skip-images" && a !== "--production");
  if (unknown.length > 0) throw new Error(`unknown argument(s): ${unknown.join(" ")}`);
  const dryRun = argv.includes("--dry-run");
  const skipImages = argv.includes("--skip-images");
  // Explicit flag: on Windows an empty env var is "unset", so FIRESTORE_COLLECTION_PREFIX= cannot select it.
  const production = argv.includes("--production");

  const env = getEnv();
  if (!env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is not set");
  if (!skipImages && !env.GCS_BUCKET) throw new Error("GCS_BUCKET is not set (or pass --skip-images)");
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= env.GCP_PROJECT_ID;

  const data = parseSeedData(
    JSON.parse(await readFile("data/catalog.json", "utf8")),
    JSON.parse(await readFile("data/priceList.json", "utf8")),
  );
  const prefix = production ? "" : env.FIRESTORE_COLLECTION_PREFIX;
  console.log(
    `Seed data valid: ${data.items.length} items, ${data.priceLists.length} price lists. ` +
      `Target: project ${env.GCP_PROJECT_ID}, collections "${prefix}items" / "${prefix}priceLists"` +
      (skipImages ? ", images skipped" : `, bucket ${env.GCS_BUCKET}`) +
      (dryRun ? " (dry run: nothing is written)" : ""),
  );

  if (!skipImages) {
    const bucket = new Storage({ projectId: env.GCP_PROJECT_ID }).bucket(env.GCS_BUCKET!);
    for (const item of data.items) {
      const local = `data/images/${item.id}.jpg`;
      const bytes = await normalizeHeroImage(await readFile(local));
      const md5 = createHash("md5").update(bytes).digest("base64");
      const file = bucket.file(item.imagePath);
      const [exists] = await file.exists();
      const remoteMd5 = exists ? (await file.getMetadata())[0].md5Hash : undefined;
      const status: Change = !exists ? "created" : remoteMd5 === md5 ? "unchanged" : "updated";
      if (status !== "unchanged" && !dryRun) {
        await file.save(bytes, { contentType: "image/jpeg", resumable: false });
      }
      console.log(`  image  ${item.imagePath.padEnd(24)} ${status} (${Math.round(bytes.length / 1024)} KB from ${local})`);
    }
  }

  const repo = new FirestoreRepo({ projectId: env.GCP_PROJECT_ID, prefix });
  for (const list of data.priceLists) {
    const status = change(await repo.getPriceList(list.id), list);
    if (status !== "unchanged" && !dryRun) await repo.putPriceList(list);
    console.log(`  price list ${list.id.padEnd(20)} ${status} (${list.rules.length} rules)`);
  }
  for (const item of data.items) {
    const status = change(await repo.getItem(item.id), item);
    if (status !== "unchanged" && !dryRun) await repo.putItem(item);
    console.log(`  item       ${item.id.padEnd(20)} ${status}`);
  }
  console.log(dryRun ? "Dry run complete." : "Seed complete.");
  return 0;
}

// process.exitCode, not process.exit(): see spike/lib/cli.ts (libuv assertion on Windows).
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`seed ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
