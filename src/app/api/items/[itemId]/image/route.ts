import { getRepo } from "@/server/deps";
import { apiError } from "@/server/http";
import { readObject } from "@/server/storage";

/** GET /api/items/[itemId]/image → the item's hero JPEG, streamed from the private bucket. */
export async function GET(_request: Request, ctx: RouteContext<"/api/items/[itemId]/image">) {
  const { itemId } = await ctx.params;
  if (!/^[a-z0-9-]{1,64}$/.test(itemId)) return apiError(404, "NOT_FOUND", "No such item.");
  const item = await getRepo().getItem(itemId);
  const bytes = item?.active ? await readObject(item.imagePath) : undefined;
  if (!bytes) return apiError(404, "NOT_FOUND", "No image for that item.");
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
  });
}
