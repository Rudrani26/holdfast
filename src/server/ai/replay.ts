import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError, type InspectionKind } from "@/domain/types";
import type { ObjectStore } from "../storage";

// Replay store (AI_PIPELINE.md §9). Only responses from LIVE calls that passed schema validation are
// written, keyed by the exact inputs. Replay mode returns such a recording for byte-identical inputs
// and otherwise fails; it never fabricates a result.

export interface ReplayKeyInput {
  promptVersion: string;
  model: string;
  kind: InspectionKind;
  /** SHA-256 hex of the normalized image bytes, in call order. */
  imageSha256: string[];
  /** RETURN/RECHECK: the baseline marks sent in the prompt ("" for BASELINE). */
  baselineMarksJson: string;
}

/** sha256(promptVersion + model + kind + sha256(img1) + sha256(img2) + baselineMarksJson), "|"-joined. */
export function replayKey(k: ReplayKeyInput): string {
  const parts = [k.promptVersion, k.model, k.kind, ...k.imageSha256, k.baselineMarksJson];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export const replayPath = (key: string) => `ai-replay/${key}.json`;

const Recording = z.object({
  source: z.literal("LIVE"),
  recordedAt: z.string(),
  model: z.string(),
  modelVersion: z.string().optional(),
  promptVersion: z.string(),
  kind: z.string(),
  rawText: z.string(),
  usage: z.object({ input: z.number(), output: z.number() }),
});
export type Recording = z.infer<typeof Recording>;

export async function writeRecording(store: ObjectStore, key: string, rec: Recording): Promise<void> {
  await store.save(replayPath(key), Buffer.from(JSON.stringify(rec)), "application/json");
}

/** The recorded live response for these exact inputs, or REPLAY_MISS. */
export async function readRecording(store: ObjectStore, key: string): Promise<Recording> {
  const bytes = await store.read(replayPath(key));
  const parsed = bytes ? Recording.safeParse(JSON.parse(bytes.toString("utf8"))) : undefined;
  if (!parsed?.success) throw new DomainError("REPLAY_MISS", "No recorded live result for these exact images.");
  return parsed.data;
}
