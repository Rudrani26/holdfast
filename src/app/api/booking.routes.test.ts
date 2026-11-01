/**
 * Route validation tests for the booking API. `bookingDeps` is replaced (unit tests only) with a
 * MemoryRepo and a PayPalClient that replays RECORDED SANDBOX RESPONSES; a declined authorization is
 * simulated from PayPal's documented INSTRUMENT_DECLINED issue and labelled so.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRenterToken } from "@/lib/authTokens";
import type { BookingDeps } from "@/server/booking";
import { fakePayPal, fixture, type Reply } from "@/server/paypal/__fixtures__/fakePayPal";
import { MemoryRepo } from "@/server/repo/memory";
import { POST as authorizePOST } from "./paypal/orders/[orderId]/authorize/route";
import { POST as ordersPOST } from "./paypal/orders/route";
import { POST as rentalsPOST } from "./rentals/route";

const state = vi.hoisted(() => ({ deps: undefined as unknown as BookingDeps }));
vi.mock("@/server/appDeps", () => ({ bookingDeps: () => state.deps }));

const SECRET = "test-renter-link-secret-0123456789abcdef";
const ORDER_ID = "3M713225W46152355";

beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "test-passcode");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdef0123");
  vi.stubEnv("RENTER_LINK_SECRET", SECRET);
});

let ip = 0;
function post(url: string, body: unknown) {
  // A fresh client IP per request keeps the booking rate limiter out of unrelated tests.
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip % 250}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

async function withDeps(replies: Reply[] = []) {
  const repo = new MemoryRepo();
  await repo.putItem({
    id: "headphones",
    name: "Wireless over-ear headphones",
    description: "Wireless over-ear headphones, matte black.",
    imagePath: "items/headphones.jpg",
    depositCents: 20000,
    dailyRateCents: 1800,
    priceListId: "pl-headphones",
    angles: [],
    active: true,
  });
  const pp = fakePayPal(replies);
  state.deps = { repo, paypal: pp.client, settlementMode: "PARTIAL_CAPTURE_THEN_VOID" };
  return { repo, pp };
}

const booking = { itemId: "headphones", days: 2, renterName: "Ada Renter", renterEmail: "ada@example.com" };

async function book(): Promise<string> {
  const res = await rentalsPOST(post("/api/rentals", booking));
  expect(res.status).toBe(201);
  return ((await res.json()) as { rentalId: string }).rentalId;
}

beforeEach(() => withDeps());

describe("POST /api/rentals", () => {
  it.each([
    ["not JSON", "{"],
    ["missing fields", {}],
    ["bad email", { ...booking, renterEmail: "nope" }],
    ["4 days", { ...booking, days: 4 }],
    ["blank name", { ...booking, renterName: "   " }],
    ["bad item id", { ...booking, itemId: "../etc" }],
  ])("400 for %s", async (_label, body) => {
    const res = await rentalsPOST(post("/api/rentals", body));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_BODY");
  });

  it("404 for an unknown item", async () => {
    const res = await rentalsPOST(post("/api/rentals", { ...booking, itemId: "kayak" }));
    expect(res.status).toBe(404);
  });

  it("201 with a rental id; a client-sent amount is ignored", async () => {
    const { repo } = await withDeps();
    const res = await rentalsPOST(post("/api/rentals", { ...booking, depositCents: 1, amount: "0.01" }));
    expect(res.status).toBe(201);
    const { rentalId } = (await res.json()) as { rentalId: string };
    expect((await repo.getRental(rentalId))!.depositCents).toBe(20000);
  });

  it("429 after 20 bookings from one IP in an hour", async () => {
    const same = () =>
      new Request("http://localhost/api/rentals", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.77" },
        body: JSON.stringify(booking),
      });
    for (let i = 0; i < 20; i++) expect((await rentalsPOST(same())).status).toBe(201);
    const res = await rentalsPOST(same());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("POST /api/paypal/orders", () => {
  it("400 for a malformed rental id, 404 for an unknown one", async () => {
    expect((await ordersPOST(post("/api/paypal/orders", { rentalId: "x" }))).status).toBe(400);
    expect((await ordersPOST(post("/api/paypal/orders", { rentalId: "r_00000000000000000000" }))).status).toBe(404);
  });

  it("returns the PayPal order id (recorded sandbox response)", async () => {
    await withDeps([fixture("create-order")]);
    const rentalId = await book();
    const res = await ordersPOST(post("/api/paypal/orders", { rentalId, amount: "0.01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderId: ORDER_ID });
  });

  it("503 PAYPAL_UNAVAILABLE when PayPal fails (simulated 500)", async () => {
    await withDeps([{ status: 500, raw: "" }]);
    const rentalId = await book();
    const res = await ordersPOST(post("/api/paypal/orders", { rentalId }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAYPAL_UNAVAILABLE");
  });
});

describe("POST /api/paypal/orders/[orderId]/authorize", () => {
  async function ordered(replies: Reply[]) {
    const deps = await withDeps([fixture("create-order"), ...replies]);
    const rentalId = await book();
    await ordersPOST(post("/api/paypal/orders", { rentalId }));
    return { ...deps, rentalId };
  }

  it("400 for a malformed order id or body", async () => {
    const { rentalId } = await ordered([]);
    expect((await authorizePOST(post("/x", { rentalId }), ctx("../../v1"))).status).toBe(400);
    expect((await authorizePOST(post("/x", {}), ctx(ORDER_ID))).status).toBe(400);
  });

  it("400 ORDER_MISMATCH for another order id", async () => {
    const { rentalId } = await ordered([]);
    const res = await authorizePOST(post("/x", { rentalId }), ctx("9XX99999XX9999999"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ORDER_MISMATCH");
  });

  it("returns the authorization and a confirmation path with a renter token for this rental", async () => {
    const { rentalId } = await ordered([fixture("authorize")]);
    const res = await authorizePOST(post("/x", { rentalId }), ctx(ORDER_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; authorizationId: string; expiresAt: string; confirmationPath: string };
    expect(body).toMatchObject({ status: "CREATED", authorizationId: "5TN13229TB9978039", expiresAt: "2026-11-25T22:41:33Z" });
    const url = new URL(body.confirmationPath, "http://localhost");
    expect(url.pathname).toBe(`/rent/confirmed/${rentalId}`);
    expect(verifyRenterToken(SECRET, url.searchParams.get("t") ?? undefined, { forRentalId: rentalId }).ok).toBe(true);
  });

  it("409 ORDER_NOT_APPROVED when authorizing before buyer approval (issue code seen in the sandbox smoke test)", async () => {
    const notApproved = {
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed", details: [{ issue: "ORDER_NOT_APPROVED" }] },
    };
    const { repo, rentalId } = await ordered([notApproved]);
    const res = await authorizePOST(post("/x", { rentalId }), ctx(ORDER_ID));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ORDER_NOT_APPROVED");
    expect((await repo.getRental(rentalId))!.status).toBe("AWAITING_PAYMENT");
  });

  it("402 INSTRUMENT_DECLINED so the button can restart (simulated from PayPal's documented decline)", async () => {
    const declined = {
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY", message: "simulated", details: [{ issue: "INSTRUMENT_DECLINED" }] },
    };
    const { repo, rentalId } = await ordered([declined]);
    const res = await authorizePOST(post("/x", { rentalId }), ctx(ORDER_ID));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INSTRUMENT_DECLINED");
    expect((await repo.getRental(rentalId))!.status).toBe("AWAITING_PAYMENT");
  });
});
