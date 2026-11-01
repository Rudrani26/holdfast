import "server-only";
import { DomainError } from "@/domain/types";
import type { Repo } from "../repo/types";

// Daily model-call cap (AI_PIPELINE.md §9): `meta/aiUsage_<UTC day>.calls`, incremented in a
// transaction BEFORE each call (retries count). Above the limit, no call is made.

export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Reserves one model call for today or throws AI_DAILY_LIMIT. Returns the count after reserving. */
export async function reserveModelCall(repo: Repo, limit: number, now = new Date()): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("AI daily call limit must be a non-negative integer");
  const day = utcDay(now);
  return repo.runTransaction(async (tx) => {
    const used = await tx.getAiUsage(day);
    if (used >= limit) {
      throw new DomainError("AI_DAILY_LIMIT", `The daily AI call limit (${limit}) is reached. Try again tomorrow (UTC) or inspect manually.`);
    }
    tx.setAiUsage(day, used + 1);
    return used + 1;
  });
}
