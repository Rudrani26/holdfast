/**
 * Test-only harness. Replays RECORDED PAYPAL SANDBOX RESPONSES (the JSON files in this folder, built
 * by spike/make-fixtures.ts) through a fake fetch, so tests exercise the real PayPalClient with no
 * network. Never import this from app code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PayPalClient } from "../client";

export type Fixture = { status: number; body: unknown; headers?: Record<string, string>; debugId?: string };
export const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(path.join(__dirname, `${name}.json`), "utf8")) as Fixture;

export interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export type Reply = Fixture | { status: number; raw: string } | Error;

/** Fake fetch: the token endpoint answers with the token fixture; other calls pop `replies` in order. */
export function fakePayPal(
  replies: Reply[],
  { tokenStatus = 200, gate }: { tokenStatus?: number; /** awaited before each API reply (to hold calls in flight) */ gate?: () => Promise<void> } = {},
) {
  const sent: Sent[] = [];
  let tokenCalls = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    sent.push({ method: init?.method ?? "GET", url: String(url), headers, body: init?.body as string | undefined });
    if (String(url).endsWith("/v1/oauth2/token")) {
      tokenCalls++;
      const t = fixture("token");
      const body = { ...(t.body as object), access_token: `TEST-TOKEN-${tokenCalls}` };
      return new Response(JSON.stringify(body), { status: tokenStatus });
    }
    if (gate) await gate();
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request ${init?.method} ${url}`);
    if (next instanceof Error) throw next;
    if ("raw" in next) return new Response(next.raw, { status: next.status });
    const resHeaders = next.debugId ? { "paypal-debug-id": next.debugId } : undefined;
    return new Response(next.status === 204 ? null : JSON.stringify(next.body), { status: next.status, headers: resHeaders });
  }) as typeof fetch;
  let clock = Date.UTC(2026, 9, 28);
  const client = new PayPalClient({ clientId: "test-client", clientSecret: "test-secret", fetch: fetchImpl, now: () => clock });
  return {
    client,
    sent,
    replies,
    api: () => sent.filter((s) => !s.url.endsWith("/oauth2/token")),
    tokenCalls: () => tokenCalls,
    advance: (ms: number) => (clock += ms),
  };
}
