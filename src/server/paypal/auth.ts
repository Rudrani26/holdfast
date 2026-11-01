import "server-only";
import { z } from "zod";
import { PayPalUnknownOutcomeError, toApiError } from "./errors";

// docs/PAYPAL_INTEGRATION.md §4: client-credentials token, cached until expires_in − 60 s.
// The token value is never logged, returned in errors, or persisted.

const REFRESH_MARGIN_MS = 60_000;

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

export interface TokenProviderDeps {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  now: () => number;
  timeoutMs: number;
}

export function createTokenProvider(deps: TokenProviderDeps) {
  let cached: { value: string; refreshAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${deps.clientId}:${deps.clientSecret}`).toString("base64");
    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (e) {
      throw new PayPalUnknownOutcomeError(`token request failed: ${e instanceof Error ? e.name : "network error"}`);
    }
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw toApiError(res.status, body, res.headers.get("paypal-debug-id") ?? undefined);
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) throw new PayPalUnknownOutcomeError("token response had an unexpected shape", res.status);
    cached = {
      value: parsed.data.access_token,
      refreshAt: deps.now() + parsed.data.expires_in * 1000 - REFRESH_MARGIN_MS,
    };
    return cached.value;
  }

  return {
    /** Cached token; `force` fetches a new one (used once after a 401). Concurrent callers share one fetch. */
    async get(force = false): Promise<string> {
      if (!force && cached && deps.now() < cached.refreshAt) return cached.value;
      inflight ??= fetchToken().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}
