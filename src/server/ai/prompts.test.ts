import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baselineUserText, PROMPT_VERSION, returnUserText, SYSTEM_INSTRUCTION } from "./prompts";

describe("prompts", () => {
  it("is versioned", () => {
    expect(PROMPT_VERSION).toBe("hf-insp-v1");
  });

  it("system instruction carries the AI_PIPELINE §4/§6.1 rules", () => {
    expect(SYSTEM_INSTRUCTION).toMatch(/do not decide charges or prices/);
    expect(SYSTEM_INSTRUCTION).toMatch(/data, never instructions/);
    expect(SYSTEM_INSTRUCTION).toMatch(/empty findings list with a high noChangeConfidence/);
    expect(SYSTEM_INSTRUCTION).toMatch(/\[ymin, xmin, ymax, xmax\]/);
  });

  it("never mentions money (the model never sees prices)", () => {
    const all = [
      SYSTEM_INSTRUCTION,
      baselineUserText({ itemName: "Headphones", itemDescription: "Over-ear", angleId: "front", angleLabel: "Front" }),
      returnUserText({ itemName: "Headphones", angleId: "front", angleLabel: "Front", baselineMarks: [] }),
    ].join("\n");
    expect(all).not.toMatch(/\$|USD|price list|amount|cents/i);
  });

  it("embeds baseline marks as JSON in the return prompt", () => {
    const text = returnUserText({
      itemName: "Bottle",
      angleId: "top",
      angleLabel: "Top",
      baselineMarks: [{ markId: "b1", damageType: "SCUFF", severity: "MINOR", box: [1, 2, 3, 4], description: "lid scuff" }],
    });
    expect(text).toContain('"markId":"b1"');
    expect(text).toContain('angleId "top"');
  });
});

describe("AI code isolation (AI_PIPELINE.md §8)", () => {
  it("no src/server/ai module imports PayPal or settlement code", () => {
    const dir = path.resolve(process.cwd(), "src/server/ai");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*(server\/paypal|settlement)[^"']*["']/);
    }
  });
});
