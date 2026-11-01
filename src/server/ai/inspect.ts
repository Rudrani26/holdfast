import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type Inspection, type InspectionKind, type RentalStatus } from "@/domain/types";
import type { Repo } from "../repo/types";
import type { ObjectStore } from "../storage";
import { ModelRequestError, type ModelClient } from "./client";
import { baselineUserText, PROMPT_VERSION, returnUserText, SYSTEM_INSTRUCTION } from "./prompts";
import { readRecording, replayKey, replayPath, writeRecording } from "./replay";
import { BaselineResult, ReturnResult, toModelJsonSchema } from "./schemas";
import { reserveModelCall } from "./usage";
import { inspectionVerdict } from "./verdict";

// AI inspection runner (AI_PIPELINE.md §4–§6, §9; TASKS T-032). The model proposes; nothing here
// prices, charges or talks to PayPal (enforced by the ESLint import ban on src/server/ai).

export const ANGLE_CONCURRENCY = 3;
const MAX_ATTEMPTS = 2; // first call + one retry on invalid output, timeout or 5xx

export interface InspectDeps {
  repo: Repo;
  store: ObjectStore;
  model: ModelClient;
  mode: "LIVE" | "REPLAY";
  dailyLimit: number;
  now?: () => Date;
}

interface Image {
  bytes: Buffer;
  sha256: string;
}

interface AngleRequest<T> {
  rentalId: string;
  inspectionId: string;
  kind: InspectionKind;
  angleId: string;
  text: string;
  images: Image[];
  baselineMarksJson: string;
  schema: z.ZodType<T & { angleId: string }>;
}

/** Call accounting for evaluation: live calls made, and whether the first answer was valid. */
interface CallInfo {
  calls?: number;
  firstTryValid?: boolean;
  replayed?: boolean;
}

export type AngleOutcome<T> =
  | ({ ok: true; result: T; latencyMs: number; usage: { input: number; output: number }; rawResponsePath: string } & CallInfo)
  | ({ ok: false; error: string; latencyMs: number; usage: { input: number; output: number }; rawResponsePath: string } & CallInfo);

const now = (deps: InspectDeps) => deps.now?.() ?? new Date();

/** Parses and validates one model answer; the answer must be about the angle we asked for. */
function validate<T>(schema: AngleRequest<T>["schema"], angleId: string, text: string): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "model returned invalid JSON" };
  }
  const v = schema.safeParse(json);
  if (!v.success) return { ok: false, error: `schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  if (v.data.angleId !== angleId) return { ok: false, error: `model answered for angle "${v.data.angleId}"` };
  return { ok: true, value: v.data };
}

/** One angle: replay lookup, or up to 2 live calls (each reserved against the daily cap first). */
export async function runAngle<T>(deps: InspectDeps, req: AngleRequest<T>): Promise<AngleOutcome<T>> {
  const key = replayKey({
    promptVersion: PROMPT_VERSION,
    model: deps.model.model,
    kind: req.kind,
    imageSha256: req.images.map((i) => i.sha256),
    baselineMarksJson: req.baselineMarksJson,
  });
  const zero = { input: 0, output: 0 };

  if (deps.mode === "REPLAY") {
    try {
      const rec = await readRecording(deps.store, key);
      const v = validate(req.schema, req.angleId, rec.rawText);
      return v.ok
        ? { ok: true, result: v.value, latencyMs: 0, usage: zero, rawResponsePath: replayPath(key), calls: 0, firstTryValid: true, replayed: true }
        : { ok: false, error: `recording failed validation: ${v.error}`, latencyMs: 0, usage: zero, rawResponsePath: replayPath(key), calls: 0, replayed: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: 0, usage: zero, rawResponsePath: "" };
    }
  }

  const attempts: { attempt: number; latencyMs: number; rawText?: string; usage?: { input: number; output: number }; modelVersion?: string; error?: string }[] = [];
  let value: T | undefined;
  let lastError = "no attempt made";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && value === undefined; attempt++) {
    try {
      await reserveModelCall(deps.repo, deps.dailyLimit, now(deps));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      break; // daily cap: make no call
    }
    const started = Date.now();
    try {
      const res = await deps.model.generate({
        systemInstruction: SYSTEM_INSTRUCTION,
        text: req.text,
        images: req.images.map((i) => i.bytes),
        responseJsonSchema: toModelJsonSchema(req.schema),
      });
      const v = validate(req.schema, req.angleId, res.text);
      attempts.push({ attempt, latencyMs: Date.now() - started, rawText: res.text, usage: res.usage, modelVersion: res.modelVersion, ...(v.ok ? {} : { error: v.error }) });
      if (v.ok) {
        value = v.value;
        await writeRecording(deps.store, key, {
          source: "LIVE",
          recordedAt: now(deps).toISOString(),
          model: deps.model.model,
          ...(res.modelVersion ? { modelVersion: res.modelVersion } : {}),
          promptVersion: PROMPT_VERSION,
          kind: req.kind,
          rawText: res.text,
          usage: res.usage,
        });
      } else lastError = v.error;
    } catch (e) {
      lastError = e instanceof ModelRequestError ? e.message : `model call failed: ${e instanceof Error ? e.message : String(e)}`;
      attempts.push({ attempt, latencyMs: Date.now() - started, error: lastError });
      if (e instanceof ModelRequestError) break; // 4xx will not change on retry
    }
  }

  const rawResponsePath = `ai/${req.rentalId}/${req.inspectionId}/${req.angleId}.json`;
  if (attempts.length > 0) {
    await deps.store.save(
      rawResponsePath,
      Buffer.from(JSON.stringify({ kind: req.kind, angleId: req.angleId, model: deps.model.model, promptVersion: PROMPT_VERSION, replayKey: key, attempts })),
      "application/json",
    );
  }
  const usage = attempts.reduce((u, a) => ({ input: u.input + (a.usage?.input ?? 0), output: u.output + (a.usage?.output ?? 0) }), zero);
  const latencyMs = attempts.reduce((s, a) => s + a.latencyMs, 0);
  const info = { calls: attempts.length, firstTryValid: attempts.length > 0 && !attempts[0]!.error, replayed: false };
  return value !== undefined
    ? { ok: true, result: value, latencyMs, usage, rawResponsePath, ...info }
    : { ok: false, error: lastError, latencyMs, usage, rawResponsePath: attempts.length > 0 ? rawResponsePath : "", ...info };
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping input order in the result. */
export async function mapPool<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// One inspection per rental at a time in this process (each costs paid calls). Single-instance demo.
const running = new Set<string>();

export const newInspectionId = (kind: InspectionKind, at: Date) =>
  `${kind.toLowerCase()}-${at.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;

/**
 * BASELINE inspection over the rental's 6 check-out photos. When every angle has a usable,
 * schema-valid answer the rental moves AUTHORIZED → BASELINE_READY; otherwise it stays AUTHORIZED
 * and staff retake or review the listed angles and run it again.
 */
export async function runBaselineInspection(deps: InspectDeps, rentalId: string): Promise<{ inspection: Inspection; rentalStatus: RentalStatus }> {
  if (running.has(rentalId)) throw new DomainError("INSPECTION_RUNNING", "An inspection is already running for this rental.");
  running.add(rentalId);
  try {
    const rental = await deps.repo.getRental(rentalId);
    if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    if (rental.status !== "AUTHORIZED") throw new DomainError("NOT_READY_FOR_BASELINE", `Baseline runs on an AUTHORIZED rental (this one is ${rental.status}).`);
    const item = await deps.repo.getItem(rental.itemId);
    if (!item) throw new DomainError("ITEM_NOT_FOUND", "Item not found.");
    const photos = await deps.repo.listPhotos(rentalId, "CHECKOUT");
    const missing = item.angles.filter((a) => !photos.some((p) => p.angleId === a.id));
    if (missing.length > 0) throw new DomainError("PHOTOS_MISSING", `Upload check-out photos first: ${missing.map((a) => a.label).join(", ")}.`);

    const started = now(deps);
    const inspectionId = newInspectionId("BASELINE", started);
    const outcomes = await mapPool(item.angles, ANGLE_CONCURRENCY, async (angle) => {
      const photo = photos.find((p) => p.angleId === angle.id)!;
      const bytes = await deps.store.read(photo.gcsPath);
      if (!bytes) {
        return { angle, outcome: { ok: false, error: "photo file missing from storage; retake", latencyMs: 0, usage: { input: 0, output: 0 }, rawResponsePath: "" } as AngleOutcome<BaselineResult> };
      }
      const outcome = await runAngle(deps, {
        rentalId,
        inspectionId,
        kind: "BASELINE",
        angleId: angle.id,
        text: baselineUserText({ itemName: item.name, itemDescription: item.description, angleId: angle.id, angleLabel: angle.label }),
        images: [{ bytes, sha256: photo.sha256 }],
        baselineMarksJson: "",
        schema: BaselineResult,
      });
      return { angle, outcome };
    });

    const perAngle: Inspection["perAngle"] = outcomes.map(({ angle, outcome }) =>
      outcome.ok
        ? {
            angleId: angle.id,
            usable: outcome.result.imageQuality.usable,
            issues: outcome.result.imageQuality.issues,
            latencyMs: outcome.latencyMs,
            rawResponsePath: outcome.rawResponsePath,
            findings: [],
            marks: outcome.result.marks,
          }
        : { angleId: angle.id, usable: false, issues: [], latencyMs: outcome.latencyMs, rawResponsePath: outcome.rawResponsePath, findings: [], needsHuman: true, error: outcome.error },
    );
    const okCount = outcomes.filter((o) => o.outcome.ok).length;
    const tokenUsage = outcomes.reduce((u, o) => ({ input: u.input + o.outcome.usage.input, output: u.output + o.outcome.usage.output }), { input: 0, output: 0 });
    const inspection: Inspection = {
      id: inspectionId,
      kind: "BASELINE",
      model: deps.model.model,
      promptVersion: PROMPT_VERSION,
      mode: deps.mode,
      status: okCount === outcomes.length ? "OK" : okCount === 0 ? "FAILED" : "PARTIAL",
      perAngle,
      tokenUsage,
      createdAt: started.toISOString(),
    };
    await deps.repo.putInspection(rentalId, inspection);

    const ready = perAngle.every((a) => !a.needsHuman && a.usable);
    const marks = perAngle.reduce((n, a) => n + (a.marks?.length ?? 0), 0);
    const label = (id: string) => item.angles.find((a) => a.id === id)?.label ?? id;
    const problems = perAngle
      .filter((a) => a.needsHuman || !a.usable)
      .map((a) => (a.needsHuman ? `review ${label(a.angleId)} (${a.error})` : `retake ${label(a.angleId)}${a.issues.length ? ` (${a.issues.join(", ")})` : ""}`));
    const replayNote = deps.mode === "REPLAY" ? " · replayed AI result recorded from a live call" : "";

    const rentalStatus = await deps.repo.runTransaction(async (tx) => {
      const current = await tx.getRental(rentalId);
      if (!current) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
      const at = now(deps).toISOString();
      tx.addEvent(rentalId, {
        id: `ai-${inspectionId}`,
        at,
        actor: "AI",
        type: ready ? "AI_BASELINE_READY" : "AI_BASELINE_INCOMPLETE",
        summary: ready
          ? `AI baseline: ${marks} pre-existing mark${marks === 1 ? "" : "s"} across ${perAngle.length} angles${replayNote}`
          : `AI baseline incomplete: ${problems.join("; ")}${replayNote}`,
        data: { inspectionId, model: deps.model.model, mode: deps.mode, marks, tokenInput: tokenUsage.input, tokenOutput: tokenUsage.output },
      });
      if (ready && current.status === "AUTHORIZED") {
        const next = transition(current, { type: "BASELINE_READY", at });
        if (next instanceof DomainError) throw next;
        tx.putRental(next);
        return next.status;
      }
      return current.status;
    });
    return { inspection, rentalStatus };
  } finally {
    running.delete(rentalId);
  }
}

/**
 * RETURN inspection: per angle, check-out photo + return photo + that angle's baseline marks.
 * Stores the inspection with its deterministic verdict and returns it. Pricing, line items and the
 * rental transition happen outside the AI module (src/server/lineItems.ts).
 */
export async function runReturnInspection(deps: InspectDeps, rentalId: string): Promise<{ inspection: Inspection; wallMs: number }> {
  if (running.has(rentalId)) throw new DomainError("INSPECTION_RUNNING", "An inspection is already running for this rental.");
  running.add(rentalId);
  try {
    const rental = await deps.repo.getRental(rentalId);
    if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    if (rental.status !== "RETURNED") throw new DomainError("NOT_READY_FOR_RETURN_INSPECTION", `Return inspection runs on a RETURNED rental (this one is ${rental.status}).`);
    const item = await deps.repo.getItem(rental.itemId);
    if (!item) throw new DomainError("ITEM_NOT_FOUND", "Item not found.");
    const baseline = (await deps.repo.listInspections(rentalId)).filter((i) => i.kind === "BASELINE").at(-1);
    if (!baseline) throw new DomainError("BASELINE_MISSING", "This rental has no baseline inspection to compare against.");
    const [checkout, checkin] = await Promise.all([deps.repo.listPhotos(rentalId, "CHECKOUT"), deps.repo.listPhotos(rentalId, "CHECKIN")]);
    const missing = item.angles.filter((a) => !checkout.some((p) => p.angleId === a.id) || !checkin.some((p) => p.angleId === a.id));
    if (missing.length > 0) throw new DomainError("PHOTOS_MISSING", `Both photos are needed for: ${missing.map((a) => a.label).join(", ")}.`);

    const started = now(deps);
    const t0 = Date.now();
    const inspectionId = newInspectionId("RETURN", started);
    const outcomes = await mapPool(item.angles, ANGLE_CONCURRENCY, async (angle) => {
      const before = checkout.find((p) => p.angleId === angle.id)!;
      const after = checkin.find((p) => p.angleId === angle.id)!;
      const [b1, b2] = await Promise.all([deps.store.read(before.gcsPath), deps.store.read(after.gcsPath)]);
      if (!b1 || !b2) {
        return { angle, outcome: { ok: false, error: "photo file missing from storage; retake", latencyMs: 0, usage: { input: 0, output: 0 }, rawResponsePath: "" } as AngleOutcome<ReturnResult> };
      }
      const marks = baseline.perAngle.find((p) => p.angleId === angle.id)?.marks ?? [];
      const outcome = await runAngle(deps, {
        rentalId,
        inspectionId,
        kind: "RETURN",
        angleId: angle.id,
        text: returnUserText({ itemName: item.name, angleId: angle.id, angleLabel: angle.label, baselineMarks: marks }),
        images: [
          { bytes: b1, sha256: before.sha256 },
          { bytes: b2, sha256: after.sha256 },
        ],
        baselineMarksJson: JSON.stringify(marks),
        schema: ReturnResult,
      });
      return { angle, outcome };
    });

    const perAngle: Inspection["perAngle"] = outcomes.map(({ angle, outcome }) =>
      outcome.ok
        ? {
            angleId: angle.id,
            usable: outcome.result.imageQuality.usable,
            issues: outcome.result.imageQuality.issues,
            latencyMs: outcome.latencyMs,
            noChangeConfidence: outcome.result.noChangeConfidence,
            rawResponsePath: outcome.rawResponsePath,
            findings: outcome.result.findings,
          }
        : { angleId: angle.id, usable: false, issues: [], latencyMs: outcome.latencyMs, rawResponsePath: outcome.rawResponsePath, findings: [], needsHuman: true, error: outcome.error },
    );
    const okCount = outcomes.filter((o) => o.outcome.ok).length;
    const inspection: Inspection = {
      id: inspectionId,
      kind: "RETURN",
      model: deps.model.model,
      promptVersion: PROMPT_VERSION,
      mode: deps.mode,
      status: okCount === outcomes.length ? "OK" : okCount === 0 ? "FAILED" : "PARTIAL",
      perAngle,
      verdict: inspectionVerdict(perAngle),
      tokenUsage: outcomes.reduce((u, o) => ({ input: u.input + o.outcome.usage.input, output: u.output + o.outcome.usage.output }), { input: 0, output: 0 }),
      createdAt: started.toISOString(),
    };
    await deps.repo.putInspection(rentalId, inspection);
    return { inspection, wallMs: Date.now() - t0 };
  } finally {
    running.delete(rentalId);
  }
}
