/**
 * E7 — Webhook listener (docs/PAYPAL_INTEGRATION.md §3 E7, §7).
 * Run from the repo root: `npx tsx spike/webhook-server.ts`, then expose it with cloudflared
 * (see spike/README.md). Each POST /webhook is recorded raw first, then verified with PayPal.
 * Response: 200 when PayPal says SUCCESS, otherwise 400 — the same contract as the app route.
 */
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { assertSpikeEnv, pp, type PpResponse } from "./lib/paypal";
import { DEFAULT_RESULTS_DIR, record } from "./lib/record";
import {
  buildVerifyRequest,
  eventRecordName,
  extractVerificationHeaders,
  summarizeEvent,
  verifyResponseSchema,
} from "./lib/webhook";

const HOST = "127.0.0.1";
const PORT = 8787;
const MAX_BODY_BYTES = 1_000_000;

assertSpikeEnv();
const webhookIdRaw = process.env.PAYPAL_WEBHOOK_ID;
const webhookId = webhookIdRaw && !webhookIdRaw.startsWith("<") ? webhookIdRaw : undefined;

function readRawBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

type Verification =
  | { outcome: "SKIPPED"; reason: string }
  | { outcome: "SUCCESS" | "FAILURE" | "ERROR"; request: unknown; response?: PpResponse; error?: string };

async function verify(req: IncomingMessage, event: unknown): Promise<Verification> {
  if (!webhookId) {
    return { outcome: "SKIPPED", reason: "PAYPAL_WEBHOOK_ID not set in .env.local" };
  }
  const { fields, missing } = extractVerificationHeaders(req.headers);
  const body = buildVerifyRequest(fields, webhookId, event);
  const request = { ...body, missingHeaders: missing };
  try {
    const response = await pp("POST", "/v1/notifications/verify-webhook-signature", body);
    const parsed = verifyResponseSchema.safeParse(response.json);
    const outcome = response.status === 200 && parsed.success ? parsed.data.verification_status : "ERROR";
    return { outcome, request, response };
  } catch (error) {
    return { outcome: "ERROR", request, error: error instanceof Error ? error.message : String(error) };
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url !== "/webhook") return reply(res, 404, { error: "not found" });
  if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" });

  const receivedAt = new Date().toISOString();
  const raw = await readRawBody(req);
  if (raw === null) return reply(res, 413, { error: "body too large" });
  const rawBody = raw.toString("utf8");

  let event: unknown;
  let parseError: string | undefined;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const name = eventRecordName(event, (n) => existsSync(path.join(DEFAULT_RESULTS_DIR, `${n}.json`)));
  const received = { at: receivedAt, method: req.method, url: req.url, headers: req.headers, rawBody };

  // Record the raw delivery before anything else can fail.
  await record(name, { received, parseError, verification: { outcome: "PENDING" } });
  if (parseError !== undefined) {
    console.log(`[${receivedAt}] ${name}: invalid JSON → 400`);
    return reply(res, 400, { error: "invalid JSON" });
  }

  const verification = await verify(req, event);
  await record(name, { received, verification });

  const s = summarizeEvent(event);
  const status = verification.outcome === "SUCCESS" ? 200 : 400;
  console.log(
    `[${receivedAt}] ${s.eventType ?? "?"} id=${s.id ?? "?"} resource=${s.resourceId ?? "?"} ` +
      `verification=${verification.outcome} → ${status} (${name}.json)`,
  );
  reply(res, status, { verification: verification.outcome });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(`handler error: ${error instanceof Error ? error.message : String(error)}`);
    if (!res.headersSent) reply(res, 500, { error: "internal error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Webhook listener on http://${HOST}:${PORT}/webhook (sandbox)`);
  console.log(
    webhookId
      ? "PAYPAL_WEBHOOK_ID is set: deliveries will be verified with PayPal."
      : "PAYPAL_WEBHOOK_ID not set: deliveries are recorded, verification is SKIPPED.",
  );
  console.log("Press Ctrl+C to stop.");
});

process.on("SIGINT", () => {
  console.log("\nStopping listener.");
  server.closeAllConnections();
  server.close();
});
