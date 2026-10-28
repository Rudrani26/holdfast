import "server-only";
import { NextResponse } from "next/server";

/** Error body shape for every API route (docs/ARCHITECTURE.md §5). */
export function apiError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
