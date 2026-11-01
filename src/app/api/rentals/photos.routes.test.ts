/** Photo routes: staff-only upload (multipart) and staff-or-renter-token reads. Deps swapped for memory (unit tests only). */
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rental } from "@/domain/types";
import { signRenterToken, signStaffSession, STAFF_COOKIE } from "@/lib/authTokens";
import type { PhotoDeps } from "@/server/photos";
import { MemoryRepo } from "@/server/repo/memory";
import { GET as photoGET } from "./[id]/photos/[photoId]/route";
import { POST as photosPOST } from "./[id]/photos/route";

const state = vi.hoisted(() => ({ deps: undefined as unknown as PhotoDeps }));
vi.mock("@/server/appDeps", () => ({ photoDeps: () => state.deps }));

const SESSION_SECRET = "test-session-secret-0123456789abcdef0123";
const RENTER_SECRET = "test-renter-link-secret-0123456789abcdef";
const ID = "r_0123456789abcdef0123";

beforeAll(() => {
  vi.stubEnv("PAYPAL_ENV", "sandbox");
  vi.stubEnv("STAFF_PASSCODE", "test-passcode");
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("RENTER_LINK_SECRET", RENTER_SECRET);
});

beforeEach(async () => {
  const repo = new MemoryRepo();
  await repo.putItem({
    id: "headphones",
    name: "Headphones",
    description: "d",
    imagePath: "items/headphones.jpg",
    depositCents: 20000,
    dailyRateCents: 1800,
    priceListId: "pl-headphones",
    angles: [{ id: "front", label: "Front", hint: "" }],
    active: true,
  });
  await repo.createRental({
    id: ID,
    itemId: "headphones",
    renter: { name: "Ada", email: "ada@example.com" },
    days: 1,
    depositCents: 20000,
    status: "AUTHORIZED",
    paymentState: "AUTHORIZED",
    paypal: { captures: [], refunds: [] },
    settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
    contestRound: 0,
    createdAt: "2026-10-28T08:00:00.000Z",
    updatedAt: "2026-10-28T08:00:00.000Z",
    version: 1,
  } satisfies Rental);
  const objects = new Map<string, Buffer>();
  state.deps = { repo, store: { save: async (p, b) => void objects.set(p, b), read: async (p) => objects.get(p) } };
});

const staffCookie = () => `${STAFF_COOKIE}=${signStaffSession(SESSION_SECRET).value}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const photoCtx = (id: string, photoId: string) => ({ params: Promise.resolve({ id, photoId }) });

async function upload(fields: Record<string, string>, file?: Blob, staff = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", file, "photo.jpg");
  const headers = new Headers(staff ? { cookie: staffCookie() } : {});
  return photosPOST(new NextRequest(`http://localhost/api/rentals/${ID}/photos`, { method: "POST", body: form, headers }), ctx(ID));
}

const jpeg = async () =>
  new Blob([new Uint8Array(await sharp({ create: { width: 640, height: 480, channels: 3, background: "#777" } }).jpeg().toBuffer())], { type: "image/jpeg" });
const ok = { phase: "CHECKOUT", angleId: "front", provenance: "LIVE_CAPTURE" };

describe("POST /api/rentals/[id]/photos", () => {
  it("401 without a staff session", async () => {
    expect((await upload(ok, await jpeg(), false)).status).toBe(401);
  });

  it("400 for missing file or bad fields; 415 for a non-image", async () => {
    expect((await upload(ok)).status).toBe(400);
    expect((await upload({ ...ok, provenance: "AI_MAGIC" }, await jpeg())).status).toBe(400);
    expect((await upload({ ...ok, phase: "LATER" }, await jpeg())).status).toBe(400);
    const res = await upload(ok, new Blob(["just text"], { type: "image/jpeg" }));
    expect(res.status).toBe(415);
  });

  it("413 when Content-Length is over the limit, before reading the body", async () => {
    const req = new NextRequest(`http://localhost/api/rentals/${ID}/photos`, {
      method: "POST",
      body: "x",
      headers: { cookie: staffCookie(), "content-length": String(11 * 1024 * 1024) },
    });
    expect((await photosPOST(req, ctx(ID))).status).toBe(413);
  });

  it("201 with photo id and hash; then readable by staff and by the renter's token for this rental only", async () => {
    const res = await upload(ok, await jpeg());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { photoId: string; sha256: string; width: number };
    expect(body).toMatchObject({ photoId: "CHECKOUT_front", width: 640 });
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);

    const get = (query: string, cookie?: string) =>
      photoGET(new NextRequest(`http://localhost/api/rentals/${ID}/photos/CHECKOUT_front${query}`, { headers: cookie ? { cookie } : {} }), photoCtx(ID, "CHECKOUT_front"));
    const staffRes = await get("", staffCookie());
    expect(staffRes.status).toBe(200);
    expect(staffRes.headers.get("content-type")).toBe("image/jpeg");
    expect((await get(`?t=${signRenterToken(RENTER_SECRET, ID).token}`)).status).toBe(200);
    expect((await get(`?t=${signRenterToken(RENTER_SECRET, "r_ffffffffffffffffffff").token}`)).status).toBe(401);
    expect((await get("")).status).toBe(401);
  });
});
