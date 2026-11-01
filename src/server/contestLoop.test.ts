/** T-042 contest loop across rounds, with the real review + renter services on MemoryRepo. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { settleGuard } from "@/domain/rentalMachine";
import { plan } from "@/domain/settlementPlanner";
import type { LineItem, PriceList } from "@/domain/types";
import { signRenterToken } from "@/lib/authTokens";
import { MemoryRepo } from "./repo/memory";
import { renterSession, submitDecision } from "./renter";
import { confirmReview, contestsByLine, settleUndisputed, updateLine } from "./review";

const SECRET = "test-renter-link-secret-0123456789abcdef";
beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "p");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdef0123");
  vi.stubEnv("RENTER_LINK_SECRET", SECRET);
});

const priceList = (JSON.parse(readFileSync("data/priceList.json", "utf8")) as { priceLists: PriceList[] }).priceLists.find((p) => p.id === "pl-headphones")!;
const RID = "r_0123456789abcdef0123";
const CRACK = "insp_top_f1";
const CUSHION = "insp_left-side_f1";
const line = (id: string, over: Partial<LineItem>): LineItem => ({
  id,
  source: "AI",
  inspectionId: "insp",
  findingId: "f1",
  angleId: id.includes("top") ? "top" : "left-side",
  damageType: "CRACK",
  severity: "MODERATE",
  label: "Cracked earcup or headband repair",
  amountCents: 4500,
  priceRuleRef: "CRACK:MODERATE",
  staffDecision: "INCLUDED",
  round: 0,
  ...over,
});

async function setup(lines: LineItem[]) {
  const repo = new MemoryRepo();
  await repo.putItem({ id: "headphones", name: "H", description: "d", imagePath: "i", depositCents: 20000, dailyRateCents: 1800, priceListId: "pl-headphones", angles: [{ id: "top", label: "Headband", hint: "" }, { id: "left-side", label: "Left earcup", hint: "" }], active: true });
  await repo.putPriceList(priceList);
  await repo.createRental({ id: RID, itemId: "headphones", renter: { name: "Ada", email: "ada@example.com" }, days: 2, depositCents: 20000, status: "INSPECTED", paymentState: "AUTHORIZED", paypal: { captures: [], refunds: [] }, settlementMode: "PARTIAL_CAPTURE_THEN_VOID", contestRound: 0, createdAt: "2026-10-28T08:00:00.000Z", updatedAt: "2026-10-28T08:00:00.000Z", version: 5 });
  for (const l of lines) await repo.putLineItem(RID, l);
  let t = Date.parse("2026-10-28T12:00:00.000Z");
  const now = () => new Date((t += 60_000));
  const session = renterSession(signRenterToken(SECRET, RID).token);
  return { repo, now, session, deps: { repo, now } };
}

describe("contest loop", () => {
  it("J3: renter contests the crack → staff see the reason, drop the line, re-confirm → renter accepts $0 → single void", async () => {
    const { repo, now, session, deps } = await setup([line(CRACK, {})]);
    await confirmReview(deps, RID);
    expect(await submitDecision(repo, session, [{ lineId: CRACK, decision: "CONTESTED", comment: "That crack was there before" }], now())).toBe("CONTESTED");

    const rental = (await repo.getRental(RID))!;
    const lines = await repo.listLineItems(RID);
    expect(contestsByLine(lines, rental).get(`${CRACK}--r1`)).toEqual({ decision: "CONTESTED", comment: "That crack was there before" });

    await updateLine(deps, RID, `${CRACK}--r1`, { staffDecision: "EXCLUDED" });
    const reconfirmed = await confirmReview(deps, RID);
    expect(reconfirmed).toMatchObject({ deductionCents: 0, rental: { status: "AWAITING_RENTER", contestRound: 1 } });
    expect(await submitDecision(repo, session, [], now())).toBe("READY_TO_SETTLE");

    const done = (await repo.getRental(RID))!;
    expect(settleGuard(done)).toBeUndefined();
    expect(plan(done.settlementMode, done.depositCents, done.approvedDeductionCents!)).toEqual([{ op: "VOID" }]);
    // Round 0 keeps the renter's contest; the history is intact.
    expect(await repo.getLineItem(RID, CRACK)).toMatchObject({ round: 0, renterDecision: "CONTESTED" });
  });

  it("after two contest rounds staff may settle only the undisputed lines", async () => {
    const { repo, now, session, deps } = await setup([line(CRACK, {}), line(CUSHION, { damageType: "MISSING_PART", label: "Ear cushion replacement", amountCents: 3800, priceRuleRef: "MISSING_PART:MODERATE" })]);
    await confirmReview(deps, RID);
    expect(await code(settleUndisputed(deps, RID))).toBe("NOT_IN_REVIEW"); // AWAITING_RENTER

    // Round 0 → contest the crack, accept the cushion.
    await submitDecision(repo, session, [{ lineId: CRACK, decision: "CONTESTED", comment: "pre-existing" }, { lineId: CUSHION, decision: "ACCEPTED" }], now());
    expect(await code(settleUndisputed(deps, RID))).toBe("CONTEST_ROUNDS_NOT_EXHAUSTED"); // only 1 round so far
    await confirmReview(deps, RID); // staff stand by both lines
    // Round 1 → contest again.
    expect(await submitDecision(repo, session, [{ lineId: `${CRACK}--r1`, decision: "CONTESTED", comment: "still pre-existing" }, { lineId: `${CUSHION}--r1`, decision: "ACCEPTED" }], now())).toBe("CONTESTED");
    expect((await repo.getRental(RID))!.contestRound).toBe(2);

    const out = await settleUndisputed(deps, RID);
    expect(out).toMatchObject({ deductionCents: 3800, rental: { status: "READY_TO_SETTLE", undisputedOnly: true, approvedDeductionCents: 3800 } });
    expect(settleGuard(out.rental)).toBeUndefined();
    expect((await repo.listEvents(RID)).at(-1)).toMatchObject({ type: "STAFF_SETTLE_UNDISPUTED", summary: expect.stringContaining("undisputed $38.00 (1 accepted line); 1 contested line dropped") });
  });

  it("in the final round the renter can no longer contest", async () => {
    const { repo, now, session, deps } = await setup([line(CRACK, {})]);
    await confirmReview(deps, RID);
    await submitDecision(repo, session, [{ lineId: CRACK, decision: "CONTESTED", comment: "a" }], now());
    await confirmReview(deps, RID);
    await submitDecision(repo, session, [{ lineId: `${CRACK}--r1`, decision: "CONTESTED", comment: "b" }], now());
    await confirmReview(deps, RID); // round 2 sent to the renter
    expect(await code(submitDecision(repo, session, [{ lineId: `${CRACK}--r2`, decision: "CONTESTED", comment: "c" }], now()))).toBe("CONTEST_LIMIT_REACHED");
    expect(await submitDecision(repo, session, [{ lineId: `${CRACK}--r2`, decision: "ACCEPTED" }], now())).toBe("READY_TO_SETTLE");
  });
});

const code = async (p: Promise<unknown>) => (await p.then(() => undefined, (e: { code?: string }) => e))?.code;
