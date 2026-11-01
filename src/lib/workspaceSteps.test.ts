import { describe, expect, it } from "vitest";
import { RENTAL_STATUSES } from "@/domain/types";
import { needsDisclosure, workspaceSteps } from "./workspaceSteps";

const states = (status: Parameters<typeof workspaceSteps>[0]) => workspaceSteps(status).map((s) => s.state[0]).join("");

describe("workspaceSteps", () => {
  it.each([
    ["AWAITING_PAYMENT", "cuuuuuu"],
    ["AUTHORIZED", "dcuuuuu"],
    ["BASELINE_READY", "ddcuuuu"],
    ["CHECKED_OUT", "dddcuuu"],
    ["RETURNED", "ddddcuu"],
    ["CONTESTED", "ddddcuu"],
    ["AWAITING_RENTER", "dddddcu"],
    ["SETTLEMENT_FAILED", "ddddddc"],
    ["SETTLED", "ddddddd"],
    ["CANCELLED", "uuuuuuu"],
  ] as const)("%s → %s", (status, expected) => {
    expect(states(status)).toBe(expected);
  });

  it("has exactly one current step for every active status", () => {
    for (const s of RENTAL_STATUSES.filter((s) => s !== "SETTLED" && s !== "CANCELLED")) {
      expect(workspaceSteps(s).filter((x) => x.state === "current")).toHaveLength(1);
    }
  });

  it("discloses only AI-edited and AI-generated images", () => {
    expect([needsDisclosure("LIVE_CAPTURE"), needsDisclosure("UPLOADED_REAL")]).toEqual([false, false]);
    expect([needsDisclosure("UPLOADED_HYBRID"), needsDisclosure("UPLOADED_SYNTHETIC")]).toEqual([true, true]);
  });
});
