import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { transition } from "@/domain/rentalMachine";
import { DomainError, type Photo, type PhotoPhase, type Provenance, type RentalStatus } from "@/domain/types";
import type { Repo } from "./repo/types";
import { photoDocId } from "./repo/types";
import type { ObjectStore } from "./storage";

// Photo upload pipeline (ARCHITECTURE.md §7, TASKS T-030): auto-rotate from EXIF → strip all
// metadata → long edge ≤ 1600 px → JPEG q85 → SHA-256. Stored at
// rentals/<rentalId>/<phase>/<angleId>-<sha256[0:12]>.jpg; the photo doc is `<phase>_<angleId>`, so a
// re-upload replaces the previous one (the old object is kept for the audit trail until lifecycle).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000; // decompression-bomb guard (~8k × 6k)
const LONG_EDGE_PX = 1600;

/** Who may upload which phase, in which rental states. CONTEST photos come only from the renter route. */
const UPLOAD_STATES: Record<"STAFF" | "RENTER", Partial<Record<PhotoPhase, readonly RentalStatus[]>>> = {
  STAFF: { CHECKOUT: ["AUTHORIZED"], CHECKIN: ["CHECKED_OUT", "RETURNED"] },
  RENTER: { CONTEST: ["AWAITING_RENTER"] },
};

export interface NormalizedPhoto {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

/** Decodes by content (not by the declared type), accepts JPEG/PNG/WebP, returns the normalized JPEG. */
export async function normalizePhoto(input: Buffer): Promise<NormalizedPhoto> {
  if (input.length === 0) throw new DomainError("EMPTY_FILE", "The file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new DomainError("FILE_TOO_LARGE", "Photos must be 10 MB or smaller.");
  if (isHeic(input)) {
    throw new DomainError(
      "UNSUPPORTED_IMAGE",
      "HEIC photos are not supported. Upload from the browser camera, or set the iPhone camera format to “Most Compatible” (JPEG).",
    );
  }
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new DomainError("UNSUPPORTED_IMAGE", "That file is not a readable image.");
  }
  if (format !== "jpeg" && format !== "png" && format !== "webp") {
    throw new DomainError("UNSUPPORTED_IMAGE", "Upload a JPEG or PNG photo.");
  }
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply EXIF orientation; output carries no metadata (sharp strips it by default)
    .resize({ width: LONG_EDGE_PX, height: LONG_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex") };
}

/** ISO-BMFF `ftyp` box with a HEIC/HEIF brand (AVIF is a different brand and decodes fine). */
function isHeic(b: Buffer): boolean {
  if (b.length < 12 || b.toString("latin1", 4, 8) !== "ftyp") return false;
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(b.toString("latin1", 8, 12));
}

export const photoObjectPath = (rentalId: string, phase: PhotoPhase, angleId: string, sha256: string) =>
  `rentals/${rentalId}/${phase}/${angleId}-${sha256.slice(0, 12)}.jpg`;

export interface PhotoDeps {
  repo: Repo;
  store: ObjectStore;
  now?: () => Date;
}

export interface UploadInput {
  rentalId: string;
  phase: PhotoPhase;
  angleId: string;
  provenance: Provenance;
  file: Buffer;
  /** Default STAFF. RENTER only via the renter token route. */
  actor?: "STAFF" | "RENTER";
}

export async function uploadPhoto(deps: PhotoDeps, input: UploadInput): Promise<{ photo: Photo; rentalStatus: RentalStatus }> {
  const { rentalId, phase, angleId, provenance } = input;
  const rental = await deps.repo.getRental(rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
  const actor = input.actor ?? "STAFF";
  const allowed = UPLOAD_STATES[actor][phase];
  if (!allowed) throw new DomainError("PHASE_NOT_ALLOWED", `${phase} photos are not uploaded here.`);
  if (!allowed.includes(rental.status)) {
    throw new DomainError("PHOTO_NOT_ALLOWED_NOW", `${phase} photos cannot be uploaded while the rental is ${rental.status}.`);
  }
  const item = await deps.repo.getItem(rental.itemId);
  const angle = item?.angles.find((a) => a.id === angleId);
  if (!item || !angle) throw new DomainError("UNKNOWN_ANGLE", `Unknown angle "${angleId}" for this item.`);

  const normalized = await normalizePhoto(input.file);
  const gcsPath = photoObjectPath(rentalId, phase, angleId, normalized.sha256);
  await deps.store.save(gcsPath, normalized.bytes, "image/jpeg");

  const at = (deps.now?.() ?? new Date()).toISOString();
  const photo: Photo = {
    id: photoDocId({ phase, angleId }),
    phase,
    angleId,
    gcsPath,
    sha256: normalized.sha256,
    width: normalized.width,
    height: normalized.height,
    provenance,
    createdAt: at,
  };
  const previous = (await deps.repo.listPhotos(rentalId, phase)).find((p) => p.angleId === angleId);
  await deps.repo.putPhoto(rentalId, photo);

  // All return angles present → RETURNED (ARCHITECTURE.md §4 "return photos uploaded").
  let checkinComplete = false;
  if (phase === "CHECKIN") {
    const have = new Set((await deps.repo.listPhotos(rentalId, "CHECKIN")).map((p) => p.angleId));
    checkinComplete = item.angles.every((a) => have.has(a.id));
  }

  const rentalStatus = await deps.repo.runTransaction(async (tx) => {
    const current = await tx.getRental(rentalId);
    if (!current) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
    tx.addEvent(rentalId, {
      id: `photo-${phase.toLowerCase()}-${angleId}-${at}`,
      at,
      actor,
      type: previous ? "PHOTO_REPLACED" : "PHOTO_UPLOADED",
      summary: `${actor === "RENTER" ? `Renter ${previous ? "replaced" : "added"} a` : previous ? "Replaced" : "Added"} ${phase === "CHECKOUT" ? "check-out" : phase === "CHECKIN" ? "return" : "contest"} photo: ${angle.label}${provenance === "LIVE_CAPTURE" || provenance === "UPLOADED_REAL" ? "" : ` (${provenance})`}`,
      data: { phase, angleId, sha256: normalized.sha256, provenance, ...(previous ? { replacedSha256: previous.sha256 } : {}) },
    });
    if (checkinComplete && current.status === "CHECKED_OUT") {
      const next = transition(current, { type: "RETURN_PHOTOS_UPLOADED", at });
      if (next instanceof DomainError) throw next;
      tx.putRental(next);
      return next.status;
    }
    return current.status;
  });
  return { photo, rentalStatus };
}

/** Bytes of a stored photo, for the authenticated read route. */
export async function readPhoto(deps: PhotoDeps, rentalId: string, photoId: string): Promise<Buffer | undefined> {
  const photo = (await deps.repo.listPhotos(rentalId)).find((p) => p.id === photoId);
  return photo ? deps.store.read(photo.gcsPath) : undefined;
}
