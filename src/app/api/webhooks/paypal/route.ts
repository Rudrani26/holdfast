import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { clientIp, RateLimiter } from "@/server/auth";
import { webhookDeps } from "@/server/appDeps";
import { apiError } from "@/server/http";
import { handlePayPalWebhook } from "@/server/webhookIntake";

// Each delivery costs one PayPal verification call; bound how many an unauthenticated caller can cause.
const webhookLimiter = new RateLimiter(120, 60 * 1000);
const MAX_BODY_BYTES = 256 * 1024;

/** POST /api/webhooks/paypal (PayPal signature) → 200 | 400 unverified | 503 verify unavailable */
export async function POST(request: Request) {
  const limit = webhookLimiter.hit(clientIp(request.headers));
  if (!limit.allowed) return apiError(429, "RATE_LIMITED", "Too many requests.", { "Retry-After": String(limit.retryAfterSec) });

  const webhookId = getEnv().PAYPAL_WEBHOOK_ID;
  if (!webhookId) return apiError(500, "WEBHOOK_NOT_CONFIGURED", "PAYPAL_WEBHOOK_ID is not set.");

  // Raw body, read once: verification uses the exact bytes PayPal sent.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return apiError(413, "PAYLOAD_TOO_LARGE", "Body too large.");

  const out = await handlePayPalWebhook(webhookDeps(webhookId), rawBody, request.headers);
  return NextResponse.json(out.body, { status: out.status });
}
