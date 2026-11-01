/**
 * Builds the PayPal unit-test fixtures in src/server/paypal/__fixtures__/ from the recorded (already
 * redacted) sandbox responses in spike/results/. Personal data in sandbox accounts (names, emails,
 * payer/merchant ids) is replaced with placeholders; PayPal object ids, statuses and amounts are kept.
 *
 *   npx tsx spike/make-fixtures.ts
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runScript } from "./lib/cli";

const RESULTS = path.resolve("spike/results");
const OUT = path.resolve("src/server/paypal/__fixtures__");

const PLACEHOLDERS: Record<string, string> = {
  email_address: "sandbox-user@example.com",
  payer_id: "SANDBOXPAYERID",
  account_id: "SANDBOXPAYERID",
  merchant_id: "SANDBOXMERCHANTID",
  given_name: "Sandbox",
  surname: "User",
  full_name: "Sandbox User",
};

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, k in PLACEHOLDERS && typeof v === "string" ? PLACEHOLDERS[k] : sanitize(v)]),
  );
}

async function recorded(file: string): Promise<Record<string, unknown>> {
  return (JSON.parse(await readFile(path.join(RESULTS, file), "utf8")) as { data: Record<string, unknown> }).data;
}

type Resp = { status: number; json: unknown; headers?: Record<string, string> };

async function write(name: string, source: string, status: number, body: unknown, extra: Record<string, unknown> = {}) {
  const fixture = {
    _note: `Recorded PayPal Sandbox response (${source}, 2026-10-27). Redacted; personal fields replaced with placeholders.`,
    status,
    body: sanitize(body),
    ...extra,
  };
  await writeFile(path.join(OUT, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`  ${name}.json  ← ${source} (HTTP ${status})`);
}

runScript("make-fixtures", async () => {
  await mkdir(OUT, { recursive: true });
  const response = async (file: string) => (await recorded(file)).response as Resp;

  const token = await response("E0-token.json");
  await write("token", "E0 POST /v1/oauth2/token", token.status, {
    ...(token.json as object),
    access_token: "FAKE-ACCESS-TOKEN-FOR-UNIT-TESTS",
    nonce: "FAKE-NONCE",
  });

  for (const [name, file, source] of [
    ["create-order", "E1-01-create-order.json", "E1 POST /v2/checkout/orders"],
    ["authorize", "E1-02-authorize.json", "E1 POST /v2/checkout/orders/{id}/authorize"],
    ["capture-partial", "E1-03-capture-1.json", "E1 capture $38.00 final_capture=false"],
    ["get-auth-partially-captured", "E1-04-get-auth-after-capture.json", "E1 GET authorization after capture"],
    ["void", "E1-05-void-1.json", "E1 POST void"],
    ["capture-final", "E2-03-capture-1.json", "E2 capture $38.00 final_capture=true"],
    ["void-previously-captured", "E2-05-void-1.json", "E2 void after final capture"],
    ["refund", "E4-06-refund-1.json", "E4 refund $162.00"],
    ["get-capture-partially-refunded", "E4-04-get-capture-after-refund.json", "E4 GET capture after refund"],
  ] as const) {
    const r = await response(file);
    await write(name, source, r.status, r.json, r.headers?.["paypal-debug-id"] ? { debugId: r.headers["paypal-debug-id"] } : {});
  }

  const idem = await recorded("E5-07-idempotency.json");
  const second = idem.second as Resp;
  await write("capture-idempotent-replay", "E5 repeat capture with the same PayPal-Request-Id", second.status, second.json);

  const neg = (await recorded("E6-08-negative-DUPLICATE_INVOICE_ID.json")).response as Resp;
  await write("capture-mock-duplicate-invoice", "E6 capture with PayPal-Mock-Response DUPLICATE_INVOICE_ID", neg.status, neg.json);

  // One verified webhook delivery: raw body + the PayPal transmission headers it arrived with.
  const files = (await readdir(RESULTS)).filter((f) => /^webhook-WH-[0-9A-Z]+-[0-9A-Z]+\.json$/.test(f));
  for (const f of files) {
    const data = await recorded(f);
    const received = data.received as { rawBody: string; headers: Record<string, string> };
    const outcome = (data.verification as { outcome: string }).outcome;
    if (outcome !== "SUCCESS" || !received.rawBody.includes('"PAYMENT.CAPTURE.COMPLETED"')) continue;
    const headers = Object.fromEntries(Object.entries(received.headers).filter(([k]) => k.startsWith("paypal-")));
    await write("webhook-capture-completed", `E7 webhook delivery ${f}, verified SUCCESS`, 200, sanitize(JSON.parse(received.rawBody)), { headers });
    break;
  }
  return 0;
});
