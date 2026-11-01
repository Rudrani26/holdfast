import "server-only";
import type { z } from "zod";
import { getEnv } from "@/lib/env";
import { createTokenProvider } from "./auth";
import { PayPalUnknownOutcomeError, toApiError } from "./errors";

// Sandbox only: the env loader already refuses PAYPAL_ENV ≠ "sandbox"; the host is fixed too.
export const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
const TIMEOUT_MS = 30_000;

export type RequestSpec<S extends z.ZodType> =
  | { method: "GET"; path: string; schema: S }
  | {
      method: "POST" | "PATCH";
      path: string;
      /** Required on every write (§5): the idempotency key, also our settlement lock key. */
      requestId: string;
      body?: unknown;
      schema: S;
      /** Sandbox negative testing (`PayPal-Mock-Response`). */
      mockCode?: string;
    };

export interface PayPalResult<T> {
  status: number;
  /** Undefined only for an empty success body (e.g. 204). */
  data: T | undefined;
  debugId?: string;
}

export interface PayPalClientDeps {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class PayPalClient {
  private readonly fetchImpl: typeof fetch;
  private readonly tokens: ReturnType<typeof createTokenProvider>;

  constructor(deps: PayPalClientDeps) {
    if (!deps.clientId || !deps.clientSecret) throw new Error("PayPal client id and secret are required");
    this.fetchImpl = deps.fetch ?? fetch;
    this.tokens = createTokenProvider({
      baseUrl: PAYPAL_BASE_URL,
      clientId: deps.clientId,
      clientSecret: deps.clientSecret,
      fetch: this.fetchImpl,
      now: deps.now ?? Date.now,
      timeoutMs: TIMEOUT_MS,
    });
  }

  /**
   * One PayPal REST call. 2xx → body validated with `schema`; 4xx → PayPalApiError; 5xx, timeout,
   * network error or an unreadable 2xx body → PayPalUnknownOutcomeError. A 401 refreshes the token
   * once and retries with the same PayPal-Request-Id (§10).
   */
  async request<S extends z.ZodType>(spec: RequestSpec<S>): Promise<PayPalResult<z.infer<S>>> {
    if (!spec.path.startsWith("/")) throw new Error(`PayPal path must start with "/": ${spec.path}`);
    if (spec.method !== "GET" && !spec.requestId) throw new Error("PayPal-Request-Id is required for writes");

    const send = async (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      };
      let body: string | undefined;
      if (spec.method !== "GET") {
        headers["PayPal-Request-Id"] = spec.requestId;
        if (spec.mockCode) headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: spec.mockCode });
        body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
      }
      try {
        return await this.fetchImpl(`${PAYPAL_BASE_URL}${spec.path}`, {
          method: spec.method,
          headers,
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new PayPalUnknownOutcomeError(
          `${spec.method} ${spec.path} failed before a response: ${e instanceof Error ? e.name : "network error"}`,
        );
      }
    };

    let res = await send(await this.tokens.get());
    if (res.status === 401) res = await send(await this.tokens.get(true));

    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const text = await res.text().catch(() => "");
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (res.status >= 500) {
      throw new PayPalUnknownOutcomeError(`${spec.method} ${spec.path} returned ${res.status}`, res.status, debugId);
    }
    if (!res.ok) throw toApiError(res.status, json, debugId);
    if (json === undefined) {
      if (text) throw new PayPalUnknownOutcomeError(`${spec.path}: non-JSON success body`, res.status, debugId);
      return { status: res.status, data: undefined, debugId };
    }
    const parsed = spec.schema.safeParse(json);
    if (!parsed.success) {
      throw new PayPalUnknownOutcomeError(
        `${spec.path}: success body did not match the expected shape (${parsed.error.issues[0]?.path.join(".")})`,
        res.status,
        debugId,
      );
    }
    return { status: res.status, data: parsed.data as z.infer<S>, debugId };
  }
}

let shared: PayPalClient | undefined;

/** Process-wide client built from the validated environment. */
export function paypalClient(): PayPalClient {
  if (!shared) {
    const env = getEnv();
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new Error("PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET");
    }
    shared = new PayPalClient({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET });
  }
  return shared;
}
