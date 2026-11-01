/**
 * Opt-in LIVE sandbox test: settles a real, already-AUTHORIZED rental in the configured mode.
 * It needs a rental that a sandbox buyer approved (booking flow, T-021):
 *
 *   SETTLE_IT_RENTAL_ID=r_… SETTLE_IT_DEDUCTION_CENTS=1200 npm run test:integration -- settlement
 *
 * The rental (in FIRESTORE_COLLECTION_PREFIX collections) is moved to READY_TO_SETTLE with a clearly
 * labelled IT_FORCED_READY event standing in for inspection + staff + renter approvals, then
 * settled through the real executor and PayPal Sandbox. This consumes the authorization.
 */
import { config as loadDotenv } from "dotenv";
import { describe, expect, it } from "vitest";
import { paypalClient } from "./paypal/client";
import { getAuthorization } from "./paypal/payments";
import { FirestoreRepo } from "./repo/firestore";
import { settleRental } from "./settlement";

loadDotenv({ path: ".env.local", quiet: true });
const rentalId = process.env.SETTLE_IT_RENTAL_ID;

describe.runIf(rentalId)("settlement against PayPal Sandbox (live)", () => {
  it("settles a real authorization: capture the deduction, void the rest", { timeout: 120_000 }, async () => {
    expect(process.env.PAYPAL_ENV).toBe("sandbox");
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= process.env.GCP_PROJECT_ID;
    const repo = new FirestoreRepo({ projectId: process.env.GCP_PROJECT_ID, prefix: process.env.FIRESTORE_COLLECTION_PREFIX ?? "" });
    const deduction = Number(process.env.SETTLE_IT_DEDUCTION_CENTS ?? "1200");

    const at = new Date().toISOString();
    await repo.runTransaction(async (tx) => {
      const r = await tx.getRental(rentalId!);
      if (r?.status !== "AUTHORIZED") throw new Error(`rental ${rentalId} must be AUTHORIZED (is ${r?.status})`);
      tx.putRental({
        ...r,
        status: "READY_TO_SETTLE",
        staffConfirmedAt: at,
        renterDecisionAt: at,
        approvedDeductionCents: deduction,
        updatedAt: at,
        version: r.version + 1,
      });
      tx.addEvent(rentalId!, {
        id: `it-forced-ready-${at}`,
        at,
        actor: "SYSTEM",
        type: "IT_FORCED_READY",
        summary: `Integration test: moved to READY_TO_SETTLE with a ${deduction}¢ deduction (inspection and approvals skipped)`,
        data: { deductionCents: deduction },
      });
    });

    const out = await settleRental({ repo, paypal: paypalClient() }, rentalId!);
    console.log(JSON.stringify({ ok: out.ok, status: out.rental.status, paymentState: out.rental.paymentState, paypal: out.rental.paypal, ops: out.records.map((r) => [r.op, r.status, r.paypalObjectId, r.paypalStatus]) }, null, 2));
    expect(out.ok).toBe(true);
    expect(out.rental.status).toBe("SETTLED");

    const auth = await getAuthorization(paypalClient(), out.rental.paypal.authorizationId!);
    console.log("authorization after settlement:", auth.status);
    expect(auth.status).toBe(out.rental.settlementMode === "PARTIAL_CAPTURE_THEN_VOID" ? "VOIDED" : "CAPTURED");

    // Settling again is a no-op.
    const again = await settleRental({ repo, paypal: paypalClient() }, rentalId!);
    expect(again.records).toHaveLength(out.records.length);
  });
});
