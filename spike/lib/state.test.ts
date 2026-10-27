import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lastSucceeded, loadState, newRunId, newRunState, saveState } from "./state";

describe("run state", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("derives a compact, request-id-safe run id", () => {
    expect(newRunId("E1", new Date("2026-10-27T22:06:30.123Z"))).toBe("E1-20261027T220630Z");
  });

  it("round-trips through disk and explains a missing run", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "hf-state-"));
    const state = { ...newRunState("E1"), orderId: "ORDER1" };
    await saveState(state, dir);
    expect(await loadState("E1", dir)).toEqual(state);
    await expect(loadState("E2", dir)).rejects.toThrow(/01-create-order\.ts --exp E2/);
  });

  it("lastSucceeded skips failed attempts", () => {
    const ops = [
      { attempt: 1, httpStatus: 201, id: "CAP1", amount: "38.00" },
      { attempt: 2, httpStatus: 422, amount: "38.00" },
    ];
    expect(lastSucceeded(ops)?.id).toBe("CAP1");
    expect(lastSucceeded([{ attempt: 1, httpStatus: 500, amount: "1.00" }])).toBeUndefined();
  });
});
