import "server-only";
import { getEnv } from "@/lib/env";
import { applyLocalQuotaProject } from "./gcp";
import { FirestoreRepo } from "./repo/firestore";
import type { Repo } from "./repo/types";

// Process-wide singletons for route handlers. Unit tests replace this module with vi.mock.

let repo: Repo | undefined;

export function getRepo(): Repo {
  if (!repo) {
    const env = getEnv();
    if (!env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is not set");
    applyLocalQuotaProject(env.GCP_PROJECT_ID);
    repo = new FirestoreRepo({ projectId: env.GCP_PROJECT_ID, prefix: env.FIRESTORE_COLLECTION_PREFIX });
  }
  return repo;
}
