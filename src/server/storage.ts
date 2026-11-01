import "server-only";
import { Storage, type Bucket } from "@google-cloud/storage";
import { getEnv } from "@/lib/env";
import { applyLocalQuotaProject } from "./gcp";

// Private media bucket (ARCHITECTURE.md §7). Public access prevention is enforced, so objects reach
// the browser only through server routes or signed URLs.

let bucket: Bucket | undefined;

export function mediaBucket(): Bucket {
  if (!bucket) {
    const env = getEnv();
    if (!env.GCP_PROJECT_ID || !env.GCS_BUCKET) throw new Error("GCP_PROJECT_ID and GCS_BUCKET must be set");
    applyLocalQuotaProject(env.GCP_PROJECT_ID);
    bucket = new Storage({ projectId: env.GCP_PROJECT_ID }).bucket(env.GCS_BUCKET);
  }
  return bucket;
}

/**
 * Object store port, so photo code can be tested without GCS. Reads go through authenticated app
 * routes, not signed URLs: V4 signing needs a service-account key or an IAM signBlob grant (checked
 * in T-030: local user ADC cannot sign), and neither is needed for a single-instance demo.
 */
export interface ObjectStore {
  save(path: string, bytes: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer | undefined>;
}

export const gcsStore: ObjectStore = {
  save: async (path, bytes, contentType) => {
    await mediaBucket().file(path).save(bytes, { contentType, resumable: false });
  },
  read: (path) => readObject(path),
};

/** Object bytes, or undefined if the object does not exist. */
export async function readObject(path: string): Promise<Buffer | undefined> {
  try {
    const [bytes] = await mediaBucket().file(path).download();
    return bytes;
  } catch (e) {
    if ((e as { code?: unknown }).code === 404) return undefined;
    throw e;
  }
}
