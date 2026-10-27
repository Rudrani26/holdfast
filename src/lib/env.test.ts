import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env";

const VALID_SECRET = "s".repeat(32);

function expectEnvError(source: Record<string, string | undefined>, variable: string) {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).problems.some((p) => p.startsWith(`${variable}:`))).toBe(
      true,
    );
    return error as EnvValidationError;
  }
  throw new Error(`expected parseEnv to reject ${variable}`);
}

describe("parseEnv", () => {
  it("accepts PAYPAL_ENV=sandbox with nothing else set", () => {
    const env = parseEnv({ PAYPAL_ENV: "sandbox" });
    expect(env.PAYPAL_ENV).toBe("sandbox");
    expect(env.FIRESTORE_COLLECTION_PREFIX).toBe("");
  });

  it("throws when PAYPAL_ENV=production", () => {
    const error = expectEnvError({ PAYPAL_ENV: "production" }, "PAYPAL_ENV");
    expect(error.message).toContain('must be exactly "sandbox"');
  });

  it.each([["live"], ["Sandbox"], [" sandbox"], [""]])("throws when PAYPAL_ENV=%j", (value) => {
    expectEnvError({ PAYPAL_ENV: value }, "PAYPAL_ENV");
  });

  it("throws when PAYPAL_ENV is missing", () => {
    expectEnvError({}, "PAYPAL_ENV");
  });

  it("parses a fully populated environment", () => {
    const env = parseEnv({
      PAYPAL_ENV: "sandbox",
      APP_BASE_URL: "http://localhost:3000",
      PAYPAL_CLIENT_ID: "client-id",
      PAYPAL_CLIENT_SECRET: "client-secret",
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: "client-id",
      PAYPAL_WEBHOOK_ID: "webhook-id",
      SETTLEMENT_MODE: "PARTIAL_CAPTURE_THEN_VOID",
      GCP_PROJECT_ID: "project",
      GCP_REGION: "us-central1",
      FIRESTORE_COLLECTION_PREFIX: "dev_",
      GCS_BUCKET: "bucket",
      VERTEX_LOCATION: "us-central1",
      GEMINI_MODEL: "model",
      IMAGE_EDIT_MODEL: "edit-model",
      AI_MODE: "replay",
      AI_DAILY_CALL_LIMIT: "300",
      STAFF_PASSCODE: "passcode",
      SESSION_SECRET: VALID_SECRET,
      RENTER_LINK_SECRET: VALID_SECRET,
      DEMO_BANNER: "true",
    });
    expect(env.AI_DAILY_CALL_LIMIT).toBe(300);
    expect(env.DEMO_BANNER).toBe(true);
    expect(env.SETTLEMENT_MODE).toBe("PARTIAL_CAPTURE_THEN_VOID");
  });

  it("treats blank optional values as unset", () => {
    const env = parseEnv({ PAYPAL_ENV: "sandbox", SETTLEMENT_MODE: "", SESSION_SECRET: "" });
    expect(env.SETTLEMENT_MODE).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
  });

  it("rejects an unknown SETTLEMENT_MODE", () => {
    expectEnvError({ PAYPAL_ENV: "sandbox", SETTLEMENT_MODE: "VOID_EVERYTHING" }, "SETTLEMENT_MODE");
  });

  it.each([["0"], ["-1"], ["2.5"], ["many"]])("rejects AI_DAILY_CALL_LIMIT=%j", (value) => {
    expectEnvError({ PAYPAL_ENV: "sandbox", AI_DAILY_CALL_LIMIT: value }, "AI_DAILY_CALL_LIMIT");
  });

  it("rejects short secrets without echoing their value", () => {
    const error = expectEnvError(
      { PAYPAL_ENV: "sandbox", SESSION_SECRET: "hunter2-not-long" },
      "SESSION_SECRET",
    );
    expect(error.message).not.toContain("hunter2-not-long");
  });
});
