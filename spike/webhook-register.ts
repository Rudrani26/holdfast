/**
 * Registers the spike webhook in the sandbox app via REST (docs/PAYPAL_INTEGRATION.md §7), instead
 * of the dashboard. If a webhook pointing at a *.trycloudflare.com URL already exists, its URL is
 * replaced in place, so PAYPAL_WEBHOOK_ID stays stable across tunnel restarts.
 *
 *   npx tsx spike/webhook-register.ts --url https://<words>.trycloudflare.com/webhook [--write-env]
 *
 * --write-env sets PAYPAL_WEBHOOK_ID in .env.local (replacing that one line or appending it);
 * no other line is read out or printed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { describePayPalError } from "./lib/bodies";
import { runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";

// §7 event list. PayPal rejects unknown names, which answers §13 uncertainty #4 for these.
export const WEBHOOK_EVENTS = [
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
];

type Webhook = { id: string; url: string; event_types?: { name: string }[] };

async function writeEnvWebhookId(id: string): Promise<void> {
  const file = ".env.local";
  const text = await readFile(file, "utf8");
  const line = `PAYPAL_WEBHOOK_ID=${id}`;
  const next = /^PAYPAL_WEBHOOK_ID=.*$/m.test(text)
    ? text.replace(/^PAYPAL_WEBHOOK_ID=.*$/m, line)
    : `${text.replace(/\n?$/, "\n")}${line}\n`;
  await writeFile(file, next, "utf8");
}

runScript("webhook-register", async (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: { url: { type: "string" }, "write-env": { type: "boolean" } },
    strict: true,
  });
  const url = values.url ?? "";
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/webhook$/.test(url)) {
    throw new Error("--url must be https://<words>.trycloudflare.com/webhook");
  }

  const list = await pp("GET", "/v1/notifications/webhooks");
  if (list.status !== 200) throw new Error(`list webhooks: ${describePayPalError(list.json)}`);
  const hooks = ((list.json as { webhooks?: Webhook[] }).webhooks ?? []) as Webhook[];
  const existing = hooks.find((h) => h.url.includes(".trycloudflare.com/"));

  const res = existing
    ? await pp("PATCH", `/v1/notifications/webhooks/${existing.id}`, [
        { op: "replace", path: "/url", value: url },
      ])
    : await pp("POST", "/v1/notifications/webhooks", {
        url,
        event_types: WEBHOOK_EVENTS.map((name) => ({ name })),
      });
  await record(`E7-webhook-${existing ? "update" : "create"}`, {
    request: existing ? { op: "replace url", id: existing.id, url } : { url, events: WEBHOOK_EVENTS },
    response: res,
  });

  if (res.status < 200 || res.status >= 300) {
    console.log(`webhook ${existing ? "update" : "create"}: HTTP ${res.status} — ${describePayPalError(res.json)}`);
    return 1;
  }
  const hook = res.json as Webhook;
  console.log(`webhook ${existing ? "updated" : "created"}: ${hook.id} → ${hook.url}`);
  console.log(`events: ${(hook.event_types ?? []).map((e) => e.name).join(", ")}`);
  if (values["write-env"]) {
    await writeEnvWebhookId(hook.id);
    console.log("PAYPAL_WEBHOOK_ID written to .env.local");
  }
  return 0;
});
