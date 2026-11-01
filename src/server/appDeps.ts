import "server-only";
import { getEnv } from "@/lib/env";
import type { BookingDeps } from "./booking";
import { getRepo } from "./deps";
import { paypalClient } from "./paypal/client";
import { modelClient } from "./ai/client";
import type { InspectDeps } from "./ai/inspect";
import type { PhotoDeps } from "./photos";
import type { SettlementDeps } from "./settlement";
import { gcsStore } from "./storage";
import type { WebhookDeps } from "./webhookIntake";

/** Spike decision (spike/RESULTS.md, owner GO): used when SETTLEMENT_MODE is unset. */
const DEFAULT_SETTLEMENT_MODE = "PARTIAL_CAPTURE_THEN_VOID";

/** AI_MODE=replay serves recorded live results only; AI_DAILY_CALL_LIMIT unset means no calls (0). */
export function inspectDeps(): InspectDeps {
  const env = getEnv();
  return {
    repo: getRepo(),
    store: gcsStore,
    model: modelClient(),
    mode: env.AI_MODE === "replay" ? "REPLAY" : "LIVE",
    dailyLimit: env.AI_DAILY_CALL_LIMIT ?? 0,
  };
}

export function photoDeps(): PhotoDeps {
  return { repo: getRepo(), store: gcsStore };
}

export function webhookDeps(webhookId: string): WebhookDeps {
  return { repo: getRepo(), paypal: paypalClient(), webhookId };
}

export function settlementDeps(): SettlementDeps {
  return { repo: getRepo(), paypal: paypalClient() };
}

export function bookingDeps(): BookingDeps {
  return {
    repo: getRepo(),
    paypal: paypalClient(),
    settlementMode: getEnv().SETTLEMENT_MODE ?? DEFAULT_SETTLEMENT_MODE,
  };
}
