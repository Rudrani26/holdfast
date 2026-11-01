import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Inspection, Rental } from "@/domain/types";
import { signRenterToken } from "@/lib/authTokens";
import { MemoryRepo } from "./repo/memory";
import { acknowledgeBaseline, renterSession, renterView } from "./renter";

const SECRET = "test-renter-link-secret-0123456789abcdef";
beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "p");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdef0123");
  vi.stubEnv("RENTER_LINK_SECRET", SECRET);
});

const RID = "r_0123456789abcdef0123";
const OTHER = "r_ffffffffffffffffffff";
const rental = (id: string, status: Rental["status"]): Rental => ({
  id,
  itemId: "headphones",
  renter: { name: "Ada", email: "ada@example.com" },
  days: 2,
  depositCents: 20000,
  status,
  paymentState: "AUTHORIZED",
  paypal: { captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  contestRound: 0,
  createdAt: "2026-10-28T08:00:00.000Z",
  updatedAt: "2026-10-28T08:00:00.000Z",
  version: 2,
});
const baseline: Inspection = {
  id: "baseline-1",
  kind: "BASELINE",
  model: "gemini-3.7-flash",
  promptVersion: "hf-insp-v1",
  mode: "LIVE",
  status: "OK",
  perAngle: [
    { angleId: "front", usable: true, issues: [], latencyMs: 1, rawResponsePath: "ai/x", findings: [], marks: [] },
    { angleId: "top", usable: true, issues: [], latencyMs: 1, rawResponsePath: "ai/x", findings: [], marks: [{ markId: "b1", damageType: "TEAR", severity: "MODERATE", box: [1, 2, 3, 4], description: "Headband tear" }] },
  ],
  createdAt: "2026-10-28T09:00:00.000Z",
};

async function setup(status: Rental["status"] = "BASELINE_READY") {
  const repo = new MemoryRepo();
  await repo.putItem({ id: "headphones", name: "Wireless over-ear headphones", description: "d", imagePath: "i", depositCents: 20000, dailyRateCents: 1800, priceListId: "pl", angles: [{ id: "front", label: "Front", hint: "" }, { id: "top", label: "Headband", hint: "" }], active: true });
  await repo.createRental(rental(RID, status));
  await repo.createRental(rental(OTHER, "BASELINE_READY"));
  await repo.putInspection(RID, baseline);
  for (const angleId of ["front", "top"]) {
    await repo.putPhoto(RID, { id: `CHECKOUT_${angleId}`, phase: "CHECKOUT", angleId, gcsPath: `rentals/${RID}/CHECKOUT/${angleId}.jpg`, sha256: "abcdef0123456789", width: 1600, height: 1200, provenance: "UPLOADED_REAL", createdAt: "2026-10-28T09:00:00.000Z" });
  }
  return repo;
}

describe("renterSession", () => {
  it("accepts a valid token and rejects tampered or foreign-secret tokens with one generic message", () => {
    const { token, tokenId } = signRenterToken(SECRET, RID);
    expect(renterSession(token)).toEqual({ rentalId: RID, tokenId });
    for (const bad of [`${token}x`, signRenterToken("another-secret-0123456789abcdef0123456", RID).token, "nonsense"]) {
      expect(() => renterSession(bad)).toThrow("This link is invalid or has expired");
    }
  });
});

describe("renterView", () => {
  it("shows this rental's baseline photos (token-authenticated URLs) and marks, nothing internal", async () => {
    const repo = await setup();
    const { token } = signRenterToken(SECRET, RID);
    const view = await renterView(repo, renterSession(token), token);
    expect(view).toMatchObject({ rentalId: RID, status: "BASELINE_READY", itemName: "Wireless over-ear headphones", renterName: "Ada", depositCents: 20000 });
    expect(view.baseline!.angles[1]).toEqual({
      angleId: "top",
      label: "Headband",
      photoUrl: `/api/rentals/${RID}/photos/CHECKOUT_top?t=${encodeURIComponent(token)}&v=abcdef012345`,
      marks: [{ markId: "b1", damageType: "TEAR", severity: "MODERATE", description: "Headband tear" }],
    });
    const json = JSON.stringify(view);
    for (const internal of ["ada@example.com", "rawResponsePath", "gcsPath", "gemini", "paypal"]) expect(json).not.toContain(internal);
  });

  it("hides the baseline before it is ready", async () => {
    const repo = await setup("AUTHORIZED");
    const { token } = signRenterToken(SECRET, RID);
    expect((await renterView(repo, renterSession(token), token)).baseline).toBeUndefined();
  });
});

describe("acknowledgeBaseline", () => {
  it("BASELINE_READY → CHECKED_OUT with the token id and a renter event; idempotent", async () => {
    const repo = await setup();
    const session = renterSession(signRenterToken(SECRET, RID).token);
    const now = new Date("2026-10-28T10:00:00.000Z");
    const after = await acknowledgeBaseline(repo, session, now);
    expect(after).toMatchObject({ status: "CHECKED_OUT", baselineAck: { at: now.toISOString(), tokenId: session.tokenId } });
    expect((await repo.listEvents(RID))[0]).toMatchObject({ actor: "RENTER", type: "BASELINE_ACKNOWLEDGED", summary: "Renter acknowledged the check-out photos (2 angles, 1 pre-existing mark)", data: { inspectionId: "baseline-1" } });
    expect((await acknowledgeBaseline(repo, session)).status).toBe("CHECKED_OUT");
    expect(await repo.listEvents(RID)).toHaveLength(1);
  });

  it("a token for another rental acknowledges only that rental", async () => {
    const repo = await setup();
    await acknowledgeBaseline(repo, renterSession(signRenterToken(SECRET, OTHER).token)).catch(() => undefined);
    expect((await repo.getRental(RID))!.status).toBe("BASELINE_READY");
  });

  it("refuses before the baseline is ready", async () => {
    const repo = await setup("AUTHORIZED");
    await expect(acknowledgeBaseline(repo, renterSession(signRenterToken(SECRET, RID).token))).rejects.toMatchObject({ code: "NOTHING_TO_ACKNOWLEDGE" });
  });
});
