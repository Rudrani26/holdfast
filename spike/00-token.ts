/**
 * E0 — OAuth token (docs/PAYPAL_INTEGRATION.md §3, §4).
 * Run from the repo root: `npx tsx spike/00-token.ts`
 * Prints the token expiry only. Writes spike/results/E0-token.json with the token redacted.
 */
import { PAYPAL_BASE_URL, requestToken, tokenResponseSchema } from "./lib/paypal";
import { record } from "./lib/record";

async function main(): Promise<number> {
  const response = await requestToken();
  const file = await record("E0-token", {
    request: {
      method: "POST",
      url: `${PAYPAL_BASE_URL}/v1/oauth2/token`,
      body: "grant_type=client_credentials",
    },
    response,
  });

  const parsed = tokenResponseSchema.safeParse(response.json);
  if (response.status !== 200 || !parsed.success) {
    const body = response.json as { error?: unknown; error_description?: unknown } | null;
    console.error(
      `E0 FAIL: HTTP ${response.status} ${String(body?.error ?? "unexpected response shape")}` +
        (body?.error_description ? ` — ${String(body.error_description)}` : ""),
    );
    console.error(`Recorded (redacted): ${file}`);
    return 1;
  }

  const expiresAt = new Date(Date.now() + parsed.data.expires_in * 1000);
  console.log(`E0 PASS: sandbox token issued (${parsed.data.token_type})`);
  console.log(`expires_in: ${parsed.data.expires_in}s (≈ ${expiresAt.toISOString()})`);
  console.log(`Recorded (redacted): ${file}`);
  return 0;
}

// Set exitCode instead of calling process.exit(): exiting while fetch's keep-alive socket is
// closing trips a libuv assertion on Windows (observed on Node 25.2.1).
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`E0 ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
