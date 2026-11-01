/** Review routes: staff-only, strict bodies, override needs a reason. Repo swapped for memory (unit tests only). */
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signStaffSession, STAFF_COOKIE, verifyRenterToken } from "@/lib/authTokens";
import { MemoryRepo } from "@/server/repo/memory";
import { POST as confirmPOST } from "./[id]/confirm/route";
import { PATCH as linePATCH } from "./[id]/line-items/[lineId]/route";
import { POST as manualPOST } from "./[id]/line-items/route";

const state = vi.hoisted(() => ({ repo: undefined as unknown as MemoryRepo }));
vi.mock("@/server/deps", () => ({ getRepo: () => state.repo }));

const SESSION = "test-session-secret-0123456789abcdef0123";
const RENTER = "test-renter-link-secret-0123456789abcdef";
const ID = "r_0123456789abcdef0123";
beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "p");
  vi.stubEnv("SESSION_SECRET", SESSION);
  vi.stubEnv("RENTER_LINK_SECRET", RENTER);
  vi.stubEnv("APP_BASE_URL", "https://demo.example");
});

beforeEach(async () => {
  state.repo = new MemoryRepo();
  await state.repo.putItem({ id: "headphones", name: "H", description: "d", imagePath: "i", depositCents: 20000, dailyRateCents: 1, priceListId: "pl", angles: [{ id: "top", label: "Top", hint: "" }], active: true });
  await state.repo.putPriceList({ id: "pl", name: "P", currency: "USD", rules: [{ damageType: "DENT", severity: "MODERATE", amountCents: 3000, label: "Dent repair" }] });
  await state.repo.createRental({ id: ID, itemId: "headphones", renter: { name: "A", email: "a@example.com" }, days: 1, depositCents: 20000, status: "INSPECTED", paymentState: "AUTHORIZED", paypal: { captures: [], refunds: [] }, settlementMode: "PARTIAL_CAPTURE_THEN_VOID", contestRound: 0, createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z", version: 1 });
});

const req = (body: unknown, staff = true) =>
  new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: staff ? { cookie: `${STAFF_COOKIE}=${signStaffSession(SESSION).value}` } : {} });

describe("review routes", () => {
  it("401 without staff", async () => {
    expect((await manualPOST(req({}, false), { params: Promise.resolve({ id: ID }) })).status).toBe(401);
    expect((await confirmPOST(req({}, false), { params: Promise.resolve({ id: ID }) })).status).toBe(401);
  });

  it("manual line 201; override without a reason or with extra fields → 400", async () => {
    const res = await manualPOST(req({ angleId: "top", damageType: "DENT", severity: "MODERATE", priceRuleRef: "DENT:MODERATE" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(201);
    const { lineItem } = (await res.json()) as { lineItem: { id: string; amountCents: number } };
    expect(lineItem.amountCents).toBe(3000);
    const ctx = { params: Promise.resolve({ id: ID, lineId: lineItem.id }) };
    expect((await linePATCH(req({ overrideAmountCents: 100 }), ctx)).status).toBe(400);
    expect((await linePATCH(req({ amountCents: 1 }), ctx)).status).toBe(400);
    expect((await linePATCH(req({ overrideAmountCents: 100, overrideReason: "goodwill" }), ctx)).status).toBe(200);
  });

  it("confirm returns a renter link for this rental and moves to AWAITING_RENTER", async () => {
    const res = await confirmPOST(req({}), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { renterLink: string; deductionCents: number; rentalStatus: string };
    expect(body).toMatchObject({ deductionCents: 0, rentalStatus: "AWAITING_RENTER" });
    const token = body.renterLink.replace("https://demo.example/r/", "");
    expect(verifyRenterToken(RENTER, token, { forRentalId: ID }).ok).toBe(true);
    expect((await confirmPOST(req({}), { params: Promise.resolve({ id: ID }) })).status).toBe(409);
  });
});
