import { NextResponse } from "next/server";
import { z } from "zod";
import { photoDeps } from "@/server/appDeps";
import { AuthConfigError } from "@/server/auth";
import { apiError, routeError } from "@/server/http";
import { MAX_UPLOAD_BYTES, uploadPhoto } from "@/server/photos";
import { renterSession } from "@/server/renter";

const AngleId = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** POST /api/r/[token]/contest-photo (renter token) multipart `angleId, file` → 201 `{ photoId }`. Only while awaiting the renter. */
export async function POST(request: Request, ctx: RouteContext<"/api/r/[token]/contest-photo">) {
  const { token } = await ctx.params;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return apiError(413, "FILE_TOO_LARGE", "Photos must be 10 MB or smaller.");
  try {
    const session = renterSession(token);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "INVALID_BODY", "Expected multipart/form-data.");
    }
    const angleId = AngleId.safeParse(form.get("angleId"));
    const file = form.get("file");
    if (!angleId.success || !(file instanceof File)) return apiError(400, "INVALID_BODY", "Expected angleId and a file.");
    if (file.size > MAX_UPLOAD_BYTES) return apiError(413, "FILE_TOO_LARGE", "Photos must be 10 MB or smaller.");
    const { photo } = await uploadPhoto(photoDeps(), {
      rentalId: session.rentalId,
      phase: "CONTEST",
      angleId: angleId.data,
      provenance: "UPLOADED_REAL",
      actor: "RENTER",
      file: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ photoId: photo.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    return routeError(e);
  }
}
