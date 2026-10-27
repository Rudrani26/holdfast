import { z } from "zod";

// Variables from docs/ARCHITECTURE.md §10. Only PAYPAL_ENV is required at this stage;
// the rest are validated when present and become required in the tasks that use them.

export const SETTLEMENT_MODES = [
  "PARTIAL_CAPTURE_THEN_VOID",
  "PARTIAL_CAPTURE_FINAL",
  "CAPTURE_THEN_REFUND",
] as const;

export const AI_MODES = ["live", "replay"] as const;

// A blank line in .env.local (`FOO=`) means "not set", not "set to the empty string".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const envSchema = z.object({
  PAYPAL_ENV: z.literal("sandbox", {
    error: 'must be exactly "sandbox"; Holdfast never runs against live PayPal',
  }),
  APP_BASE_URL: optional(z.url()),
  PAYPAL_CLIENT_ID: optional(z.string()),
  PAYPAL_CLIENT_SECRET: optional(z.string()),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: optional(z.string()),
  PAYPAL_WEBHOOK_ID: optional(z.string()),
  SETTLEMENT_MODE: optional(z.enum(SETTLEMENT_MODES)),
  GCP_PROJECT_ID: optional(z.string()),
  GCP_REGION: optional(z.string()),
  FIRESTORE_COLLECTION_PREFIX: z.string().default(""),
  GCS_BUCKET: optional(z.string()),
  VERTEX_LOCATION: optional(z.string()),
  GEMINI_MODEL: optional(z.string()),
  IMAGE_EDIT_MODEL: optional(z.string()),
  AI_MODE: optional(z.enum(AI_MODES)),
  AI_DAILY_CALL_LIMIT: optional(z.coerce.number().int().positive()),
  STAFF_PASSCODE: optional(z.string()),
  SESSION_SECRET: optional(z.string().min(32)),
  RENTER_LINK_SECRET: optional(z.string().min(32)),
  DEMO_BANNER: optional(z.stringbool()),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Validates an environment record. Error messages name the variable and the rule it
 * broke, never the value, so secrets cannot leak into logs.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
