import { describe, expect, it } from "vitest";
import { CallBudget, parseTruth, scorePair, visionArgsSchema } from "./vision";

describe("parseTruth", () => {
  it("parses NO_CHANGE and NEW_DAMAGE[:TYPE] lines", () => {
    expect(parseTruth("NO_CHANGE warm vs daylight\n")).toEqual({ kind: "NO_CHANGE", note: "warm vs daylight" });
    expect(parseTruth("NEW_DAMAGE:MISSING_PART left cushion removed")).toEqual({
      kind: "NEW_DAMAGE",
      damageType: "MISSING_PART",
      note: "left cushion removed",
    });
    expect(parseTruth("NEW_DAMAGE sticker added")).toEqual({ kind: "NEW_DAMAGE", note: "sticker added" });
  });

  it("rejects unknown labels and damage types", () => {
    expect(() => parseTruth("CHANGED something")).toThrow(/NO_CHANGE/);
    expect(() => parseTruth("NEW_DAMAGE:SMUDGE x")).toThrow(/unknown damage type/);
  });
});

describe("scorePair", () => {
  const f = (damageType: string, isNew: boolean, confidence: number) => ({ damageType, isNew, confidence });

  it("NO_CHANGE is correct only with no reportable new finding", () => {
    expect(scorePair({ kind: "NO_CHANGE", note: "" }, []).correct).toBe(true);
    expect(scorePair({ kind: "NO_CHANGE", note: "" }, [f("SCUFF", true, 0.49), f("STAIN", false, 0.9)]).correct).toBe(true);
    const wrong = scorePair({ kind: "NO_CHANGE", note: "" }, [f("STAIN", true, 0.5)]);
    expect(wrong.correct).toBe(false);
    expect(wrong.reason).toMatch(/unchanged item/);
  });

  it("NEW_DAMAGE needs a reportable new finding; type match reported separately", () => {
    const truth = { kind: "NEW_DAMAGE" as const, damageType: "MISSING_PART" as const, note: "" };
    expect(scorePair(truth, [])).toMatchObject({ correct: false, reason: "missed the damage" });
    expect(scorePair(truth, [f("BROKEN_PART", true, 0.8)])).toMatchObject({ correct: true, typeMatch: false });
    expect(scorePair(truth, [f("MISSING_PART", true, 0.8)])).toMatchObject({ correct: true, typeMatch: true });
  });
});

describe("CallBudget", () => {
  it("never exceeds its limit and rejects limits above 20", () => {
    const b = new CallBudget(2);
    expect([b.take(), b.take(), b.take()]).toEqual([true, true, false]);
    expect(b.spent).toBe(2);
    expect(() => new CallBudget(21)).toThrow();
    expect(() => new CallBudget(0)).toThrow();
  });
});

describe("visionArgsSchema", () => {
  it("splits models, caps at 2, and caps calls at 20", () => {
    expect(visionArgsSchema.parse({ models: "gemini-a-flash, gemini-b-flash" }).models).toEqual([
      "gemini-a-flash",
      "gemini-b-flash",
    ]);
    expect(visionArgsSchema.safeParse({ models: "a-1,b-2,c-3" }).success).toBe(false);
    expect(visionArgsSchema.safeParse({ maxCalls: "21" }).success).toBe(false);
    expect(visionArgsSchema.parse({}).maxCalls).toBe(20);
  });
});
