/**
 * V5 truth audit (docs/DEMO_VIDEO_PRODUCTION.md §8.2): every PayPal object shown in the final video is fetched
 * from the PayPal Sandbox with read-only GET calls and compared with the status shown on screen.
 *
 *   npx tsx video/build/truth-audit.ts      → prints the table and writes video/truth-audit.md
 *
 * Sandbox only. Client credentials are read from .env.local and never printed; the OAuth token is never logged.
 */
import fs from "node:fs";

const BASE = "https://api-m.sandbox.paypal.com";

/** What the final cut shows, per scene (from video/capture-log.json and the reviewed frames). */
const SHOWN: { scene: string; object: "order" | "authorization" | "capture" | "webhook-event"; id: string; shown: string }[] = [
  { scene: "02-book (J1)", object: "order", id: "5UK7089516358800F", shown: "order created; authorization placed" },
  { scene: "02-book (J1)", object: "authorization", id: "22X40097DE206973U", shown: "CREATED, $200.00, expires Nov 30, 2026" },
  { scene: "06-settle (J1)", object: "capture", id: "3AK885510K404981V", shown: "COMPLETED, $76.00" },
  { scene: "06-settle (J1)", object: "authorization", id: "22X40097DE206973U", shown: "VOIDED (remainder)" },
  { scene: "08-clean (J2)", object: "authorization", id: "7CL065587Y652090U", shown: "VOIDED, $0 charged" },
  { scene: "09-contest (J3)", object: "authorization", id: "3RE78577G3579781P", shown: "VOIDED, $0 charged" },
];
/** Signed webhooks behind the "PayPal-confirmed" badges in the settle scenes. */
const WEBHOOKS: { scene: string; id: string }[] = [
  ...["WH-2340001800281321K-5PP46019SV010294C", "WH-9FK58463D4251682K-4E976668U8177663V", "WH-0FA27087VH250763L-0CM53756NE434301P"].map((id) => ({ scene: "06-settle (J1)", id })),
  ...["WH-9GV68671159227602-43547732U6238854D", "WH-10G910584B1912809-06P43368JE4580207"].map((id) => ({ scene: "08-clean (J2)", id })),
  ...["WH-9YN33173KR753843X-5V827982L04695636", "WH-4G740289AK5372503-371952988A313605S"].map((id) => ({ scene: "09-contest (J3)", id })),
];

function env(name: string): string {
  const m = fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, "");
  if (!v) throw new Error(`${name} missing from .env.local`);
  return v;
}

async function token(): Promise<string> {
  if (env("PAYPAL_ENV") !== "sandbox") throw new Error("PAYPAL_ENV must be sandbox");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${env("PAYPAL_CLIENT_ID")}:${env("PAYPAL_CLIENT_SECRET")}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function get(t: string, url: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${url}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return (await res.json()) as Record<string, unknown>;
}

const PATH = { order: "/v2/checkout/orders/", authorization: "/v2/payments/authorizations/", capture: "/v2/payments/captures/" } as const;

async function main() {
  const t = await token();
  const rows: string[] = [];
  for (const s of SHOWN) {
    const r = await get(t, PATH[s.object as keyof typeof PATH] + s.id);
    const amount = (r.amount as { value?: string } | undefined)?.value;
    const verified = r.error ? String(r.error) : `${String(r.status)}${amount ? `, $${amount}` : ""}${r.expiration_time ? `, expires ${String(r.expiration_time)}` : ""}`;
    rows.push(`| ${s.scene} | ${s.object} | \`${s.id}\` | ${s.shown} | ${verified} |`);
  }
  for (const w of WEBHOOKS) {
    const r = await get(t, `/v1/notifications/webhooks-events/${w.id}`);
    const res = r.resource as { id?: string; status?: string } | undefined;
    const verified = r.error ? String(r.error) : `${String(r.event_type)} → ${res?.id ?? "?"} ${res?.status ?? ""}`.trim();
    rows.push(`| ${w.scene} | webhook event | \`${w.id}\` | "PayPal-confirmed" badge | ${verified} |`);
  }
  const md = [
    "# Truth audit — final demo video",
    "",
    `Run ${new Date().toISOString()} with read-only GET calls to the PayPal Sandbox (\`video/build/truth-audit.ts\`).`,
    "",
    "| Scene | Object | ID | Shown on screen | Verified with PayPal |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "An authorization's status is its current one: `22X40097DE206973U` was `CREATED` when the booking scene was filmed and is `VOIDED` now that the remainder was voided (scene 06), so both on-screen values are consistent with PayPal's history.",
    "",
  ].join("\n");
  fs.writeFileSync("video/truth-audit.md", md);
  console.log(rows.join("\n"));
}

void main();
