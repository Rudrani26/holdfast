import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PHOTO_PHASES, PROVENANCES } from "@/domain/types";
import { photoDeps } from "@/server/appDeps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { MAX_UPLOAD_BYTES, uploadPhoto } from "@/server/photos";

const Fields = z.object({
  phase: z.enum(PHOTO_PHASES),
  angleId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  provenance: z.enum(PROVENANCES),
});

/**
 * POST /api/rentals/[id]/photos (staff), multipart `phase, angleId, provenance, file` →
 * `{ photoId, sha256, width, height, rentalStatus }`. Re-uploading an angle replaces it (logged).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/photos">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");

  // Reject oversized bodies before buffering them (multipart overhead allowance: 64 KB).
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return apiError(413, "FILE_TOO_LARGE", "Photos must be 10 MB or smaller.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "INVALID_BODY", "Expected multipart/form-data.");
  }
  const fields = Fields.safeParse({ phase: form.get("phase"), angleId: form.get("angleId"), provenance: form.get("provenance") });
  const file = form.get("file");
  if (!fields.success || !(file instanceof File)) {
    return apiError(400, "INVALID_BODY", "Expected phase, angleId, provenance and a file.");
  }
  if (file.size > MAX_UPLOAD_BYTES) return apiError(413, "FILE_TOO_LARGE", "Photos must be 10 MB or smaller.");

  try {
    const { photo, rentalStatus } = await uploadPhoto(photoDeps(), {
      rentalId: id,
      ...fields.data,
      file: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(
      { photoId: photo.id, sha256: photo.sha256, width: photo.width, height: photo.height, rentalStatus },
      { status: 201 },
    );
  } catch (e) {
    return routeError(e);
  }
}
