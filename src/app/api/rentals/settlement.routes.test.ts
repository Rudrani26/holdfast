/**
 * Staff-only settle/cancel routes. `settlementDeps` is replaced (unit tests only) with a MemoryRepo
 * and a PayPalClient replaying RECORDED SANDBOX RESPONSES (spike E1 void).
 */
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rental } from "@/domain/types";
import { signStaffSession, STAFF_COOKIE } from "@/lib/authTokens";
import { fakePayPal, fixture } from "@/server/paypal/__fixtures__/fakePayPal";
import { MemoryRepo } from "@/server/repo/memory";
import type { SettlementDeps } from "@/server/settlement";
import { POST as cancelPOST } from "./[id]/cancel/route";
import { POST as settlePOST } from "./[id]/settle/route";

const state = vi.hoisted(() => ({ deps: undefined as unknown as SettlementDeps }));
vi.mock("@/server/appDeps", () => ({ settlementDeps: () => state.deps }));

const SESSION_SECRET = "test-session-secret-0123456789abcdef0123";
const ID = "r_0123456789abcdef0123";

beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "test-passcode");
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("RENTER_LINK_SECRET", "test-renter-link-secret-0123456789abcdef");
});

const rental = (status: Rental["status"]): Rental => ({
  id: ID,
  itemId: "headphones",
  renter: { name: "Ada Renter", email: "ada@example.com" },
  days: 2,
  depositCents: 20000,
  status,
  paymentState: "AUTHORIZED",
  paypal: { orderId: "3M713225W46152355", authorizationId: "5TN13229TB9978039", authStatus: "CREATED", captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  contestRound: 0,
  createdAt: "2026-10-28T08:00:00.000Z",
  updatedAt: "2026-10-28T08:00:00.000Z",
  version: 1,
});

let repo: MemoryRepo;
beforeEach(async () => {
  repo = new MemoryRepo();
  await repo.createRental(rental("AUTHORIZED"));
  state.deps = { repo, paypal: fakePayPal([fixture("void")]).client, sleep: async () => {} };
});

function req(staff: boolean) {
  const headers = new Headers();
  if (staff) headers.set("cookie", `${STAFF_COOKIE}=${signStaffSession(SESSION_SECRET).value}`);
  return new NextRequest("http://localhost/api/rentals/x", { method: "POST", headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("staff settlement routes", () => {
  it("401 without a staff session, and nothing changes", async () => {
    expect((await settlePOST(req(false), ctx(ID))).status).toBe(401);
    expect((await cancelPOST(req(false), ctx(ID))).status).toBe(401);
    expect((await repo.getRental(ID))!.status).toBe("AUTHORIZED");
  });

  it("404 for a malformed or unknown rental id", async () => {
    expect((await settlePOST(req(true), ctx("../x"))).status).toBe(404);
    expect((await cancelPOST(req(true), ctx("r_ffffffffffffffffffff"))).status).toBe(404);
  });

  it("409 when the rental is not ready to settle", async () => {
    const res = await settlePOST(req(true), ctx(ID));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_READY_TO_SETTLE");
  });

  it("cancel voids the authorization (recorded sandbox void)", async () => {
    const res = await cancelPOST(req(true), ctx(ID));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rental: Rental }).rental).toMatchObject({ status: "CANCELLED", paymentState: "VOIDED" });
  });
});
