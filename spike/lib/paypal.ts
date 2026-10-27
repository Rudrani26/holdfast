/**
 * Minimal PayPal Sandbox REST client for the feasibility spike (docs/PAYPAL_INTEGRATION.md §3–§5).
 * Live sandbox calls only — no mocks. Credentials come from .env.local and never leave this module.
 */
import { randomUUID } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { parseEnv } from "../../src/lib/env";
import { registerSecret } from "./record";

export const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface PpResponse {
  status: number;
  headers: Record<string, string>;
  json: unknown;
  /** PayPal-Request-Id actually sent (POSTs always send one). */
  requestId?: string;
}

export interface PpOptions {
  requestId?: string;
  /** Negative-testing code sent as `PayPal-Mock-Response` (sandbox only). */
  mockCode?: string;
}

interface Credentials {
  clientId: string;
  clientSecret: string;
}

let credentials: Credentials | undefined;

/** Loads .env.local and fails fast unless sandbox credentials are present. Idempotent. */
export function assertSpikeEnv(): void {
  loadCredentials();
}

function loadCredentials(): Credentials {
  if (credentials) return credentials;
  loadDotenv({ path: ".env.local", quiet: true });
  // Reuse the app's sandbox guard; only the variables the spike needs are checked.
  parseEnv({ PAYPAL_ENV: process.env.PAYPAL_ENV });

  const missing = (["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] as const).filter((name) => {
    const value = process.env[name];
    return !value || value.startsWith("<");
  });
  if (missing.length > 0) {
    throw new Error(
      `Missing sandbox credentials in .env.local: ${missing.join(", ")}. See spike/README.md.`,
    );
  }
  credentials = {
    clientId: process.env.PAYPAL_CLIENT_ID as string,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET as string,
  };
  registerSecret(credentials.clientSecret);
  return credentials;
}

async function send(url: string, init: RequestInit): Promise<PpResponse> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { nonJsonBody: text };
    }
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
}

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  app_id: z.string().optional(),
  scope: z.string().optional(),
});

/** `POST /v1/oauth2/token` (client credentials). Returns the raw response; does not cache. */
export async function requestToken(): Promise<PpResponse> {
  const { clientId, clientSecret } = loadCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await send(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const parsed = tokenResponseSchema.safeParse(response.json);
  if (parsed.success) registerSecret(parsed.data.access_token);
  return response;
}

let cachedToken: { value: string; refreshAt: number } | undefined;

/** Cached access token, refreshed `expires_in − 60s` after issue. Never log the return value. */
export async function getToken({ forceRefresh = false } = {}): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.refreshAt) return cachedToken.value;
  const response = await requestToken();
  if (response.status !== 200) {
    throw new PayPalHttpError("token request failed", response);
  }
  const { access_token, expires_in } = tokenResponseSchema.parse(response.json);
  cachedToken = {
    value: access_token,
    refreshAt: Date.now() + expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
  };
  return access_token;
}

export class PayPalHttpError extends Error {
  constructor(
    message: string,
    readonly response: PpResponse,
  ) {
    const body = response.json as { name?: unknown; error?: unknown } | null;
    const name = body?.name ?? body?.error ?? "unknown";
    const debugId = response.headers["paypal-debug-id"] ?? "n/a";
    super(`${message}: HTTP ${response.status} ${String(name)} (debug id ${debugId})`);
    this.name = "PayPalHttpError";
  }
}

/** Builds the `PayPal-Mock-Response` header value for negative testing. */
export function mockResponseHeader(code: string): string {
  return JSON.stringify({ mock_application_codes: code });
}

/**
 * Calls a PayPal REST endpoint. POSTs always carry `PayPal-Request-Id` (generated if not given).
 * A 401 refreshes the token once and retries with the same request ID (§10). No other retries.
 */
export async function pp(
  method: HttpMethod,
  path: string,
  body?: unknown,
  { requestId, mockCode }: PpOptions = {},
): Promise<PpResponse> {
  if (!path.startsWith("/")) throw new Error(`path must start with "/": ${path}`);
  const effectiveRequestId = requestId ?? (method === "POST" ? `spike:${randomUUID()}` : undefined);

  const call = async (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    };
    if (effectiveRequestId) headers["PayPal-Request-Id"] = effectiveRequestId;
    if (mockCode) headers["PayPal-Mock-Response"] = mockResponseHeader(mockCode);
    return send(`${PAYPAL_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await call(await getToken());
  if (response.status === 401) {
    response = await call(await getToken({ forceRefresh: true }));
  }
  return { ...response, requestId: effectiveRequestId };
}
