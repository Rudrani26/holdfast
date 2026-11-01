/**
 * AI inspection tests with a STUB model client (unit tests only; no Vertex calls, no cost).
 * The stub's answers are hand-written JSON in the BaselineResult shape, not recorded model output.
 */
import { describe, expect, it } from "vitest";
import type { Item, Rental } from "@/domain/types";
import { MemoryRepo } from "../repo/memory";
import type { ObjectStore } from "../storage";
import { ModelRequestError, type ModelCall, type ModelClient, type ModelResponse } from "./client";
import { ANGLE_CONCURRENCY, mapPool, runAngle, runBaselineInspection, runReturnInspection, type InspectDeps } from "./inspect";
import { PROMPT_VERSION } from "./prompts";
import { replayKey, replayPath } from "./replay";
import { BaselineResult } from "./schemas";
import { reserveModelCall } from "./usage";

const ANGLES = ["front", "back", "left-side", "right-side", "top", "bottom"];
const RID = "r_0123456789abcdef0123";
const NOW = new Date("2026-10-28T12:00:00.000Z");

const baselineJson = (angleId: string, over: Partial<BaselineResult> = {}) =>
  JSON.stringify({
    angleId,
    imageQuality: { usable: true, issues: [] },
    marks: angleId === "top" ? [{ markId: "b1", damageType: "SCUFF", severity: "MINOR", box: [100, 200, 180, 320], description: "Light scuff on the headband" }] : [],
    ...over,
  });

type Reply = string | Error | ((call: ModelCall) => string);

/** STUB model: answers from `script(angleId, attempt)`; records every call and peak concurrency. */
function stubModel(script: (angleId: string, attempt: number) => Reply = (a) => baselineJson(a)) {
  const calls: ModelCall[] = [];
  const attempts = new Map<string, number>();
  let inFlight = 0;
  let peak = 0;
  const client: ModelClient = {
    model: "stub-model",
    async generate(call): Promise<ModelResponse> {
      calls.push(call);
      const angleId = /angleId "([^"]+)"/.exec(call.text)?.[1] ?? "?";
      const n = (attempts.get(angleId) ?? 0) + 1;
      attempts.set(angleId, n);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const reply = script(angleId, n);
      if (reply instanceof Error) throw reply;
      return { text: typeof reply === "function" ? reply(call) : reply, usage: { input: 1000, output: 200 }, modelVersion: "stub-1" };
    },
  };
  return { client, calls, peak: () => peak };
}

function memoryStore() {
  const objects = new Map<string, Buffer>();
  const store: ObjectStore = { save: async (p, b) => void objects.set(p, b), read: async (p) => objects.get(p) };
  return { store, objects };
}

const item: Item = {
  id: "headphones",
  name: "Wireless over-ear headphones",
  description: "Wireless over-ear headphones, matte black.",
  imagePath: "items/headphones.jpg",
  depositCents: 20000,
  dailyRateCents: 1800,
  priceListId: "pl-headphones",
  angles: ANGLES.map((id) => ({ id, label: id, hint: "" })),
  active: true,
};

async function setup(opts: { status?: Rental["status"]; photos?: string[]; limit?: number; script?: Parameters<typeof stubModel>[0]; mode?: "LIVE" | "REPLAY" } = {}) {
  const repo = new MemoryRepo();
  await repo.putItem(item);
  await repo.createRental({
    id: RID,
    itemId: "headphones",
    renter: { name: "Ada", email: "ada@example.com" },
    days: 2,
    depositCents: 20000,
    status: opts.status ?? "AUTHORIZED",
    paymentState: "AUTHORIZED",
    paypal: { captures: [], refunds: [] },
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    contestRound: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    version: 1,
  });
  const { store, objects } = memoryStore();
  for (const angleId of opts.photos ?? ANGLES) {
    const gcsPath = `rentals/${RID}/CHECKOUT/${angleId}.jpg`;
    objects.set(gcsPath, Buffer.from(`jpeg-bytes-${angleId}`));
    await repo.putPhoto(RID, { id: `CHECKOUT_${angleId}`, phase: "CHECKOUT", angleId, gcsPath, sha256: `sha-${angleId}`, width: 1600, height: 1200, provenance: "UPLOADED_REAL", createdAt: NOW.toISOString() });
  }
  const model = stubModel(opts.script);
  const deps: InspectDeps = { repo, store, model: model.client, mode: opts.mode ?? "LIVE", dailyLimit: opts.limit ?? 100, now: () => NOW };
  return { repo, store, objects, model, deps };
}

const angleReq = (angleId = "front") => ({
  rentalId: RID,
  inspectionId: "baseline-test",
  kind: "BASELINE" as const,
  angleId,
  text: `Angle: ${angleId} (angleId "${angleId}")`,
  images: [{ bytes: Buffer.from("img"), sha256: "sha-img" }],
  baselineMarksJson: "",
  schema: BaselineResult,
});

describe("replayKey", () => {
  const base = { promptVersion: PROMPT_VERSION, model: "gemini-3.7-flash", kind: "RETURN" as const, imageSha256: ["a", "b"], baselineMarksJson: "[]" };
  it("is deterministic and changes with every input", () => {
    expect(replayKey(base)).toBe(replayKey({ ...base }));
    expect(replayKey(base)).toMatch(/^[0-9a-f]{64}$/);
    const variants = [
      { ...base, promptVersion: "hf-insp-v2" },
      { ...base, model: "gemini-3.8-flash" },
      { ...base, kind: "RECHECK" as const },
      { ...base, imageSha256: ["a", "c"] },
      { ...base, imageSha256: ["b", "a"] },
      { ...base, baselineMarksJson: '[{"markId":"b1"}]' },
    ];
    expect(new Set([replayKey(base), ...variants.map(replayKey)]).size).toBe(variants.length + 1);
  });
});

describe("daily call cap", () => {
  it("counts calls per UTC day and refuses above the limit", async () => {
    const repo = new MemoryRepo();
    expect(await reserveModelCall(repo, 2, NOW)).toBe(1);
    expect(await reserveModelCall(repo, 2, NOW)).toBe(2);
    await expect(reserveModelCall(repo, 2, NOW)).rejects.toMatchObject({ code: "AI_DAILY_LIMIT" });
    expect(await reserveModelCall(repo, 2, new Date("2026-10-29T00:00:01Z"))).toBe(1);
  });

  it("makes no model call once the cap is reached", async () => {
    const { deps, model, repo } = await setup({ limit: 1 });
    expect((await runAngle(deps, angleReq("front"))).ok).toBe(true);
    const second = await runAngle(deps, angleReq("back"));
    expect(second).toMatchObject({ ok: false });
    expect(second.ok || second.error).toContain("daily AI call limit (1)");
    expect(model.calls).toHaveLength(1);
    await repo.runTransaction(async (tx) => expect(await tx.getAiUsage("2026-10-28")).toBe(1));
  });
});

describe("runAngle (live, stubbed model)", () => {
  it("valid first answer → 1 call, raw response stored, live recording written for replay", async () => {
    const { deps, model, objects } = await setup();
    const out = await runAngle(deps, angleReq("top"));
    expect(out.ok).toBe(true);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.images).toEqual([Buffer.from("img")]);
    expect(out.rawResponsePath).toBe(`ai/${RID}/baseline-test/top.json`);
    const raw = JSON.parse(objects.get(out.rawResponsePath)!.toString()) as { attempts: unknown[] };
    expect(raw.attempts).toHaveLength(1);
    const key = replayKey({ promptVersion: PROMPT_VERSION, model: "stub-model", kind: "BASELINE", imageSha256: ["sha-img"], baselineMarksJson: "" });
    expect(JSON.parse(objects.get(replayPath(key))!.toString())).toMatchObject({ source: "LIVE", model: "stub-model", promptVersion: PROMPT_VERSION });
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    const { deps, model } = await setup({ script: (a, n) => (n === 1 ? "{not json" : baselineJson(a)) });
    expect((await runAngle(deps, angleReq())).ok).toBe(true);
    expect(model.calls).toHaveLength(2);
  });

  it("schema failure twice → not ok (NEEDS_HUMAN), exactly 2 calls, nothing recorded for replay", async () => {
    const { deps, model, objects } = await setup({ script: (a) => baselineJson(a, { imageQuality: { usable: true, issues: ["SMUDGE" as never] } }) });
    const out = await runAngle(deps, angleReq());
    expect(out.ok).toBe(false);
    expect(out.ok || out.error).toContain("schema");
    expect(model.calls).toHaveLength(2);
    expect([...objects.keys()].some((k) => k.startsWith("ai-replay/"))).toBe(false);
  });

  it("an answer about a different angle counts as invalid", async () => {
    const { deps } = await setup({ script: () => baselineJson("back") });
    const out = await runAngle(deps, angleReq("front"));
    expect(out.ok || out.error).toContain('answered for angle "back"');
  });

  it("does not retry a 4xx; retries a timeout once", async () => {
    const a = await setup({ script: () => new ModelRequestError(400, "model request rejected (HTTP 400)") });
    expect((await runAngle(a.deps, angleReq())).ok).toBe(false);
    expect(a.model.calls).toHaveLength(1);
    const b = await setup({ script: (angle, n) => (n === 1 ? new Error("deadline exceeded") : baselineJson(angle)) });
    expect((await runAngle(b.deps, angleReq())).ok).toBe(true);
    expect(b.model.calls).toHaveLength(2);
  });
});

describe("replay mode", () => {
  it("returns the recorded live result for identical inputs with no model call; misses fail clearly", async () => {
    const live = await setup();
    const first = await runAngle(live.deps, angleReq("top"));
    const replayDeps: InspectDeps = { ...live.deps, mode: "REPLAY" };
    const callsBefore = live.model.calls.length;
    const again = await runAngle(replayDeps, angleReq("top"));
    expect(again.ok && first.ok && again.result).toEqual(first.ok && first.result);
    expect(live.model.calls).toHaveLength(callsBefore);
    const miss = await runAngle(replayDeps, { ...angleReq("top"), images: [{ bytes: Buffer.from("other"), sha256: "sha-other" }] });
    expect(miss).toMatchObject({ ok: false, error: "No recorded live result for these exact images." });
  });
});

describe("runBaselineInspection", () => {
  it("6 usable angles → inspection OK, rental BASELINE_READY, AI_BASELINE_READY event; ≤ 3 calls in flight", async () => {
    const { deps, repo, model } = await setup();
    const { inspection, rentalStatus } = await runBaselineInspection(deps, RID);
    expect(rentalStatus).toBe("BASELINE_READY");
    expect(inspection).toMatchObject({ kind: "BASELINE", status: "OK", model: "stub-model", promptVersion: PROMPT_VERSION, mode: "LIVE", tokenUsage: { input: 6000, output: 1200 } });
    expect(inspection.perAngle.map((a) => a.angleId)).toEqual(ANGLES);
    expect(inspection.perAngle.find((a) => a.angleId === "top")!.marks).toHaveLength(1);
    expect(model.calls).toHaveLength(6);
    expect(model.peak()).toBeLessThanOrEqual(ANGLE_CONCURRENCY);
    expect(await repo.listInspections(RID)).toHaveLength(1);
    const ev = (await repo.listEvents(RID)).find((e) => e.type === "AI_BASELINE_READY")!;
    expect(ev).toMatchObject({ actor: "AI", summary: "AI baseline: 1 pre-existing mark across 6 angles" });
    expect(model.calls[0]!.text).toContain("Wireless over-ear headphones");
  });

  it("an unusable photo keeps the rental AUTHORIZED and asks for a retake", async () => {
    const { deps, repo } = await setup({ script: (a) => baselineJson(a, a === "left-side" ? { imageQuality: { usable: false, issues: ["BLUR"] } } : {}) });
    const { inspection, rentalStatus } = await runBaselineInspection(deps, RID);
    expect(rentalStatus).toBe("AUTHORIZED");
    expect(inspection.status).toBe("OK"); // every call answered validly; one photo is just unusable
    const ev = (await repo.listEvents(RID)).find((e) => e.type === "AI_BASELINE_INCOMPLETE")!;
    expect(ev.summary).toBe("AI baseline incomplete: retake left-side (BLUR)");
  });

  it("an angle with no valid answer is flagged for review and the inspection is PARTIAL", async () => {
    const { deps } = await setup({ script: (a) => (a === "back" ? "{bad" : baselineJson(a)) });
    const { inspection, rentalStatus } = await runBaselineInspection(deps, RID);
    expect(inspection.status).toBe("PARTIAL");
    expect(inspection.perAngle.find((a) => a.angleId === "back")).toMatchObject({ needsHuman: true, usable: false });
    expect(rentalStatus).toBe("AUTHORIZED");
  });

  it("refuses without all check-out photos, or in the wrong state, before any model call", async () => {
    const a = await setup({ photos: ["front", "back"] });
    await expect(runBaselineInspection(a.deps, RID)).rejects.toMatchObject({ code: "PHOTOS_MISSING" });
    const b = await setup({ status: "CHECKED_OUT" });
    await expect(runBaselineInspection(b.deps, RID)).rejects.toMatchObject({ code: "NOT_READY_FOR_BASELINE" });
    expect([...a.model.calls, ...b.model.calls]).toHaveLength(0);
  });

  it("refuses a second concurrent run for the same rental", async () => {
    const { deps, model } = await setup();
    const results = await Promise.allSettled([runBaselineInspection(deps, RID), runBaselineInspection(deps, RID)]);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(["INSPECTION_RUNNING"]);
    expect(model.calls).toHaveLength(6);
  });
});

describe("mapPool", () => {
  it("keeps order and bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });
});

const returnJson = (angleId: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    angleId,
    imageQuality: { usable: true, issues: [] },
    findings:
      angleId === "left-side"
        ? [{ findingId: "f1", damageType: "MISSING_PART", severity: "MODERATE", box: [300, 100, 700, 400], isNew: true, matchesBaselineMarkId: null, confidence: 0.98, evidence: "Ear cushion missing" }]
        : angleId === "top"
          ? [{ findingId: "f1", damageType: "SCUFF", severity: "MINOR", box: [100, 200, 180, 320], isNew: false, matchesBaselineMarkId: "b1", confidence: 0.95, evidence: "Same headband scuff" }]
          : [],
    noChangeConfidence: angleId === "left-side" ? 0.02 : 0.96,
    ...over,
  });

async function returnSetup(script?: Parameters<typeof stubModel>[0], opts: { withBaseline?: boolean; status?: Rental["status"] } = {}) {
  const s = await setup({ status: opts.status ?? "RETURNED", script: script ?? ((a) => returnJson(a)) });
  for (const angleId of ANGLES) {
    const gcsPath = `rentals/${RID}/CHECKIN/${angleId}.jpg`;
    s.objects.set(gcsPath, Buffer.from(`return-bytes-${angleId}`));
    await s.repo.putPhoto(RID, { id: `CHECKIN_${angleId}`, phase: "CHECKIN", angleId, gcsPath, sha256: `sha-in-${angleId}`, width: 1600, height: 1200, provenance: "UPLOADED_REAL", createdAt: NOW.toISOString() });
  }
  if (opts.withBaseline !== false) {
    await s.repo.putInspection(RID, {
      id: "baseline-1",
      kind: "BASELINE",
      model: "stub-model",
      promptVersion: PROMPT_VERSION,
      mode: "LIVE",
      status: "OK",
      perAngle: ANGLES.map((angleId) => ({
        angleId,
        usable: true,
        issues: [],
        latencyMs: 1,
        rawResponsePath: "",
        findings: [],
        marks: angleId === "top" ? [{ markId: "b1", damageType: "SCUFF" as const, severity: "MINOR" as const, box: [100, 200, 180, 320] as [number, number, number, number], description: "Light scuff on the headband" }] : [],
      })),
      createdAt: NOW.toISOString(),
    });
  }
  return s;
}

describe("runReturnInspection", () => {
  it("sends check-out then return photo plus that angle's baseline marks; stores the verdict", async () => {
    const { deps, model, repo } = await returnSetup();
    const { inspection } = await runReturnInspection(deps, RID);
    expect(model.calls).toHaveLength(6);
    const top = model.calls.find((c) => c.text.includes('angleId "top"'))!;
    expect(top.images.map((b) => b.toString())).toEqual(["jpeg-bytes-top", "return-bytes-top"]);
    expect(top.text).toContain('"markId":"b1"');
    expect(model.calls.find((c) => c.text.includes('angleId "front"'))!.text).toContain("(JSON): []");
    expect(inspection).toMatchObject({ kind: "RETURN", status: "OK", verdict: "DAMAGE_PROPOSED" });
    expect(inspection.perAngle.find((a) => a.angleId === "left-side")!.findings[0]).toMatchObject({ damageType: "MISSING_PART", isNew: true });
    expect((await repo.listInspections(RID)).map((i) => i.kind)).toEqual(["BASELINE", "RETURN"]);
  });

  it("clean return → NO_NEW_DAMAGE", async () => {
    const { deps } = await returnSetup((a) => returnJson(a, { findings: [], noChangeConfidence: 0.97 }));
    expect((await runReturnInspection(deps, RID)).inspection.verdict).toBe("NO_NEW_DAMAGE");
  });

  it("refuses without a baseline or outside RETURNED, before any model call", async () => {
    const a = await returnSetup(undefined, { withBaseline: false });
    await expect(runReturnInspection(a.deps, RID)).rejects.toMatchObject({ code: "BASELINE_MISSING" });
    const b = await returnSetup(undefined, { status: "CHECKED_OUT" });
    await expect(runReturnInspection(b.deps, RID)).rejects.toMatchObject({ code: "NOT_READY_FOR_RETURN_INSPECTION" });
    expect([...a.model.calls, ...b.model.calls]).toHaveLength(0);
  });
});
