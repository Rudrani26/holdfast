import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { INSPECTION_KINDS } from "@/domain/types";
import { runBaselineInspection, runReturnInspection } from "@/server/ai/inspect";
import { inspectDeps } from "@/server/appDeps";
import { apiError, requireStaff, routeError } from "@/server/http";
import { applyReturnInspection } from "@/server/lineItems";

const Body = z.object({ kind: z.enum(INSPECTION_KINDS) });

/**
 * POST /api/rentals/[id]/inspections (staff) `{ kind }` → `{ inspectionId, status, rentalStatus, verdict? }`.
 * Makes paid model calls (bounded: 6 angles × ≤ 2 attempts, each counted against AI_DAILY_CALL_LIMIT).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/rentals/[id]/inspections">) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return apiError(404, "RENTAL_NOT_FOUND", "Rental not found.");
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return apiError(400, "INVALID_BODY", "Expected { kind: BASELINE | RETURN | RECHECK }.");
  if (parsed.data.kind === "RECHECK") return apiError(501, "NOT_IMPLEMENTED", "RECHECK (contest re-check) is a P1 item (T-042).");
  try {
    const deps = inspectDeps();
    if (parsed.data.kind === "BASELINE") {
      const { inspection, rentalStatus } = await runBaselineInspection(deps, id);
      return NextResponse.json({ inspectionId: inspection.id, status: inspection.status, rentalStatus });
    }
    const { inspection, wallMs } = await runReturnInspection(deps, id);
    const applied = await applyReturnInspection(deps.repo, id, inspection, { wallMs });
    return NextResponse.json({
      inspectionId: inspection.id,
      status: inspection.status,
      verdict: inspection.verdict,
      rentalStatus: applied.rentalStatus,
      proposedTotalCents: applied.proposedTotalCents,
    });
  } catch (e) {
    return routeError(e);
  }
}
