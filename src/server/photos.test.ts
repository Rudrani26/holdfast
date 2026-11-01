import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { DomainError, type Item, type Rental } from "@/domain/types";
import { MAX_UPLOAD_BYTES, normalizePhoto, readPhoto, uploadPhoto, type PhotoDeps } from "./photos";
import { MemoryRepo } from "./repo/memory";
import type { ObjectStore } from "./storage";

// Test images are generated here with sharp; nothing is fetched.
const image = (width: number, height: number, format: "jpeg" | "png" | "gif" | "webp" = "jpeg") =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .toFormat(format)
    .toBuffer();

/** A camera-like JPEG: landscape pixels, EXIF orientation 6 (rotate 90°), and identifying EXIF tags. */
const cameraJpeg = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Owner Name", Copyright: "private-serial-123", Model: "PhoneCam" } } })
    .toBuffer();

async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return (e as DomainError).code;
}

describe("normalizePhoto", () => {
  it("applies EXIF rotation, strips all metadata, caps the long edge at 1600 px, hashes the output", async () => {
    const input = await cameraJpeg();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await normalizePhoto(input);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect([out.width, out.height]).toEqual([1067, 1600]); // portrait after rotation
    expect([meta.width, meta.height]).toEqual([1067, 1600]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.bytes.includes(Buffer.from("private-serial-123"))).toBe(false);
    expect(out.sha256).toBe(createHash("sha256").update(out.bytes).digest("hex"));
  });

  it("converts PNG to JPEG and never enlarges small photos", async () => {
    const out = await normalizePhoto(await image(800, 600, "png"));
    expect((await sharp(out.bytes).metadata()).format).toBe("jpeg");
    expect([out.width, out.height]).toEqual([800, 600]);
  });

  it("is deterministic (same input → same hash)", async () => {
    const input = await image(1000, 700);
    expect((await normalizePhoto(input)).sha256).toBe((await normalizePhoto(input)).sha256);
  });

  it("rejects empty, oversized, non-image, GIF and HEIC input", async () => {
    expect(await code(normalizePhoto(Buffer.alloc(0)))).toBe("EMPTY_FILE");
    expect(await code(normalizePhoto(Buffer.alloc(MAX_UPLOAD_BYTES + 1)))).toBe("FILE_TOO_LARGE");
    expect(await code(normalizePhoto(Buffer.from("not an image at all, just text")))).toBe("UNSUPPORTED_IMAGE");
    expect(await code(normalizePhoto(await image(10, 10, "gif")))).toBe("UNSUPPORTED_IMAGE");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
    expect(await code(normalizePhoto(heic))).toBe("UNSUPPORTED_IMAGE");
  });
});

const ANGLES = ["front", "back", "left-side", "right-side", "top", "bottom"];
const item: Item = {
  id: "headphones",
  name: "Wireless over-ear headphones",
  description: "Wireless over-ear headphones, matte black.",
  imagePath: "items/headphones.jpg",
  depositCents: 20000,
  dailyRateCents: 1800,
  priceListId: "pl-headphones",
  angles: ANGLES.map((id) => ({ id, label: id, hint: "" })),
  active: true,
};
const rental = (status: Rental["status"]): Rental => ({
  id: "r_0123456789abcdef0123",
  itemId: "headphones",
  renter: { name: "Ada Renter", email: "ada@example.com" },
  days: 2,
  depositCents: 20000,
  status,
  paymentState: "AUTHORIZED",
  paypal: { captures: [], refunds: [] },
  settlementMode: "PARTIAL_CAPTURE_THEN_VOID",
  contestRound: 0,
  createdAt: "2026-10-28T08:00:00.000Z",
  updatedAt: "2026-10-28T08:00:00.000Z",
  version: 1,
});

async function setup(status: Rental["status"]) {
  const repo = new MemoryRepo();
  await repo.putItem(item);
  await repo.createRental(rental(status));
  const objects = new Map<string, Buffer>();
  const store: ObjectStore = { save: async (p, b) => void objects.set(p, b), read: async (p) => objects.get(p) };
  let t = Date.parse("2026-10-28T10:00:00.000Z");
  const deps: PhotoDeps = { repo, store, now: () => new Date((t += 1000)) };
  return { repo, objects, deps };
}
const RID = "r_0123456789abcdef0123";

describe("uploadPhoto", () => {
  it("stores the normalized JPEG at the documented path and records the photo + event", async () => {
    const { repo, objects, deps } = await setup("AUTHORIZED");
    const { photo, rentalStatus } = await uploadPhoto(deps, { rentalId: RID, phase: "CHECKOUT", angleId: "front", provenance: "LIVE_CAPTURE", file: await cameraJpeg() });
    expect(photo.id).toBe("CHECKOUT_front");
    expect(photo.gcsPath).toBe(`rentals/${RID}/CHECKOUT/front-${photo.sha256.slice(0, 12)}.jpg`);
    expect(createHash("sha256").update(objects.get(photo.gcsPath)!).digest("hex")).toBe(photo.sha256);
    expect(rentalStatus).toBe("AUTHORIZED");
    expect(await repo.listPhotos(RID, "CHECKOUT")).toHaveLength(1);
    expect((await repo.listEvents(RID)).map((e) => e.type)).toEqual(["PHOTO_UPLOADED"]);
  });

  it("re-upload replaces the angle's photo and is logged as PHOTO_REPLACED", async () => {
    const { repo, deps } = await setup("AUTHORIZED");
    const first = await uploadPhoto(deps, { rentalId: RID, phase: "CHECKOUT", angleId: "front", provenance: "LIVE_CAPTURE", file: await image(900, 600) });
    const second = await uploadPhoto(deps, { rentalId: RID, phase: "CHECKOUT", angleId: "front", provenance: "UPLOADED_HYBRID", file: await image(600, 900) });
    const photos = await repo.listPhotos(RID, "CHECKOUT");
    expect(photos).toHaveLength(1);
    expect(photos[0]!.sha256).toBe(second.photo.sha256);
    const replaced = (await repo.listEvents(RID)).find((e) => e.type === "PHOTO_REPLACED")!;
    expect(replaced.data).toMatchObject({ replacedSha256: first.photo.sha256, provenance: "UPLOADED_HYBRID" });
    expect(replaced.summary).toContain("(UPLOADED_HYBRID)");
  });

  it("moves CHECKED_OUT → RETURNED once all six return angles are uploaded", async () => {
    const { repo, deps } = await setup("CHECKED_OUT");
    const file = await image(400, 300);
    for (const [i, angleId] of ANGLES.entries()) {
      const { rentalStatus } = await uploadPhoto(deps, { rentalId: RID, phase: "CHECKIN", angleId, provenance: "LIVE_CAPTURE", file });
      expect(rentalStatus).toBe(i < ANGLES.length - 1 ? "CHECKED_OUT" : "RETURNED");
    }
    expect((await repo.getRental(RID))!.status).toBe("RETURNED");
    // A retake after RETURNED is still allowed (before inspection).
    await uploadPhoto(deps, { rentalId: RID, phase: "CHECKIN", angleId: "top", provenance: "LIVE_CAPTURE", file: await image(300, 400) });
  });

  it("rejects the wrong phase or state, unknown angles, and bad files without storing anything", async () => {
    const a = await setup("CHECKED_OUT");
    const file = await image(400, 300);
    expect(await code(uploadPhoto(a.deps, { rentalId: RID, phase: "CHECKOUT", angleId: "front", provenance: "LIVE_CAPTURE", file }))).toBe("PHOTO_NOT_ALLOWED_NOW");
    expect(await code(uploadPhoto(a.deps, { rentalId: RID, phase: "CONTEST", angleId: "front", provenance: "LIVE_CAPTURE", file }))).toBe("PHASE_NOT_ALLOWED");
    expect(await code(uploadPhoto(a.deps, { rentalId: RID, phase: "CHECKIN", angleId: "inside", provenance: "LIVE_CAPTURE", file }))).toBe("UNKNOWN_ANGLE");
    expect(await code(uploadPhoto(a.deps, { rentalId: RID, phase: "CHECKIN", angleId: "front", provenance: "LIVE_CAPTURE", file: Buffer.from("text") }))).toBe("UNSUPPORTED_IMAGE");
    expect(await code(uploadPhoto(a.deps, { rentalId: "r_ffffffffffffffffffff", phase: "CHECKIN", angleId: "front", provenance: "LIVE_CAPTURE", file }))).toBe("RENTAL_NOT_FOUND");
    expect(a.objects.size).toBe(0);
    expect(await a.repo.listPhotos(RID)).toHaveLength(0);
  });

  it("readPhoto returns stored bytes, or undefined for a missing photo", async () => {
    const { deps } = await setup("AUTHORIZED");
    const { photo } = await uploadPhoto(deps, { rentalId: RID, phase: "CHECKOUT", angleId: "back", provenance: "UPLOADED_REAL", file: await image(500, 500) });
    expect(createHash("sha256").update((await readPhoto(deps, RID, "CHECKOUT_back"))!).digest("hex")).toBe(photo.sha256);
    expect(await readPhoto(deps, RID, "CHECKOUT_front")).toBeUndefined();
  });
});
