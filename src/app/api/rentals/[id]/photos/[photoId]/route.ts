import type { NextRequest } from "next/server";
import { verifyRenterToken } from "@/lib/authTokens";
import { photoDeps } from "@/server/appDeps";
import { AuthConfigError, authSecrets, isStaff, STAFF_COOKIE } from "@/server/auth";
import { apiError } from "@/server/http";
import { readPhoto } from "@/server/photos";

/**
 * GET /api/rentals/[id]/photos/[photoId] → JPEG. Allowed for staff, or for the renter with `?t=<token>`
 * for this rental. Stands in for signed URLs (see src/server/storage.ts).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/photos/[photoId]">) {
  const { id, photoId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[A-Z]+_[a-z0-9-]{1,40}$/.test(photoId)) {
    return apiError(404, "NOT_FOUND", "Photo not found.");
  }
  try {
    const staff = isStaff(request.cookies.get(STAFF_COOKIE)?.value);
    const token = request.nextUrl.searchParams.get("t") ?? undefined;
    const renter = !staff && !!token && verifyRenterToken(authSecrets().renterLinkSecret, token, { forRentalId: id }).ok;
    if (!staff && !renter) return apiError(401, "UNAUTHENTICATED", "Staff session or renter link required.");
  } catch (e) {
    if (e instanceof AuthConfigError) return apiError(500, "AUTH_NOT_CONFIGURED", e.message);
    throw e;
  }
  const bytes = await readPhoto(photoDeps(), id, photoId);
  if (!bytes) return apiError(404, "NOT_FOUND", "Photo not found.");
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
