# Feasibility spike — PayPal Sandbox

Throwaway scripts that prove the deposit flow (authorize → partial capture → void / refund) against the
**real PayPal Sandbox** before the app is built. Plan and experiments: `docs/PAYPAL_INTEGRATION.md` §3.

Nothing here is mocked. Every script makes live sandbox calls and records the redacted responses.

## Setup [OWNER]

1. Create a sandbox app at developer.paypal.com → **Apps & Credentials** → **Sandbox** → **Create App**
   (see `docs/PAYPAL_INTEGRATION.md` §2).
2. Copy `.env.example` to `.env.local` (gitignored) and set:
   ```
   PAYPAL_ENV=sandbox
   PAYPAL_CLIENT_ID=<sandbox client id>
   PAYPAL_CLIENT_SECRET=<sandbox secret>
   ```
   The spike reads only these variables. Others may stay as placeholders.
3. Run every script **from the repo root** so results land in `spike/results/`.

## Scripts

| Command | Experiment | Output |
| --- | --- | --- |
| `npx tsx spike/00-token.ts` | E0 — OAuth token | prints `expires_in` only; writes `spike/results/E0-token.json` |
| `npx tsx spike/webhook-server.ts` | E7 — webhook listener on `127.0.0.1:8787` | one `spike/results/webhook-<eventId>.json` per delivery |

| `npx tsx spike/webhook-register.ts --url <tunnel>/webhook --write-env` | registers the E7 webhook through the API, or replaces its URL | keeps `PAYPAL_WEBHOOK_ID` stable across tunnel restarts |
| `spike/01`–`06`, `07-idempotency`, `08-negative` | E1–E6 | see `spike/run-guide.md` |

`webhook-register.ts` can replace the manual dashboard registration in step 3 below.
- On its first run it creates the webhook with the six §7 events.
- On later runs it updates that webhook's URL in place, so the webhook ID never changes.
- `--write-env` updates only the `PAYPAL_WEBHOOK_ID` line in `.env.local`.

## Vision check (T-007)

`spike/vision-check.ts` runs the RETURN inspection prompt (`src/server/ai/prompts.ts`) on 5 owner photo pairs with up to 2 candidate Gemini models on **Vertex AI**. These are live calls, billed to the GCP Free Trial credits.
- There is a hard cap of **20 model calls** per run; retries count toward it.
- Listing the available models doesn't count.

It must run with `--conditions=react-server`, because the AI modules import `server-only`:

```sh
npx tsx --conditions=react-server spike/vision-check.ts --list
npx tsx --conditions=react-server spike/vision-check.ts --models <model-a>,<model-b>
```

**[OWNER] prerequisites:**
1. **Photo pairs** at `eval/spike-pairs/<n>/before.jpg`, `after.jpg` and `truth.txt`, for n = 1…5.
   - `truth.txt` is one line: `NO_CHANGE <note>` or `NEW_DAMAGE[:TYPE] <note>`, for example `NEW_DAMAGE:MISSING_PART left ear cushion removed`.
   - At least 2 pairs must be real changes, and at least 2 real **no-change** pairs, with a lighting or angle difference between the two photos.
   - Use only items you own, and make only non-destructive changes (`docs/AI_PIPELINE.md` §10.1).
2. **`.env.local`:** set `GCP_PROJECT_ID=<your project id>` and `VERTEX_LOCATION=us-central1`.
3. **Application Default Credentials:** run `gcloud auth application-default login` once.
4. **Approve and enable the Vertex AI API** on the project (`docs/DEPLOYMENT.md` §3):
   `gcloud services enable aiplatform.googleapis.com --project <your project id>`

**What the gate checks:** for at least one model,
- 4 or more of the 5 pairs are correct;
- **both** no-change pairs come back with no new findings;
- every response matches the schema after at most one retry.

A model that flags damage on an unchanged item fails.

## Webhooks (E7)

### What the listener does
For each `POST /webhook`:

1. Records the raw body and headers immediately (`verification.outcome: "PENDING"`).
2. Calls `POST /v1/notifications/verify-webhook-signature` with:
   - the five `paypal-*` headers;
   - `PAYPAL_WEBHOOK_ID`;
   - the parsed event.
3. Rewrites the record with PayPal's answer:
   - `SUCCESS` or `FAILURE` from PayPal;
   - `ERROR` if the call itself failed;
   - `SKIPPED` if `PAYPAL_WEBHOOK_ID` is not set.
4. Replies `200` only on `SUCCESS`, otherwise `400`.

PayPal retries deliveries that don't get a 2xx response. A redelivery of the same event id is saved as `webhook-<eventId>-delivery<N>.json`.

Other details:
- Bodies over 1 MB get `413`.
- Other paths get `404`.
- The listener binds to `127.0.0.1` only.

### 1. Local check (no tunnel)

```sh
npx tsx spike/webhook-server.ts
# in a second terminal:
curl -s -X POST http://127.0.0.1:8787/webhook -H "Content-Type: application/json" \
  -d '{"id":"WH-LOCAL-TEST","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"TEST"}}'
```

Expected result:
- `spike/results/webhook-WH-LOCAL-TEST.json` is written;
- the reply is `400`.

The reply is `400` whether verification is `SKIPPED` (no webhook ID yet) or `FAILURE`/`ERROR` (fake data has no valid signature). Either way that is expected.

### 2. Expose it with a free Cloudflare quick tunnel [OWNER]

`cloudflared` is free and open-source (Apache-2.0). A quick tunnel needs no Cloudflare account.

- **Install (Windows):** `winget install --id Cloudflare.cloudflared`
- **Install (macOS):** `brew install cloudflared`
- **Other platforms:** https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

```sh
cloudflared tunnel --url http://127.0.0.1:8787
```

It prints a URL like `https://<random-words>.trycloudflare.com`. Keep both terminals open.

Use `127.0.0.1`, not `localhost`. On Windows `localhost` can resolve to `::1`, but the listener binds to IPv4 only.

The quick-tunnel URL **changes every time `cloudflared` restarts**. When it does, update the webhook URL in the sandbox app.

### 3. Register the webhook [OWNER]

1. Go to developer.paypal.com → **Apps & Credentials** → **Sandbox** → your app → **Webhooks** → **Add Webhook**.
2. Set the URL to `https://<random-words>.trycloudflare.com/webhook`.
3. Select these events (`docs/PAYPAL_INTEGRATION.md` §7):
   - `PAYMENT.AUTHORIZATION.CREATED`
   - `PAYMENT.AUTHORIZATION.VOIDED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.PENDING`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`

   If any of these names isn't offered, note what the dashboard lists instead. That is uncertainty #4 in §13.
4. Copy the **Webhook ID** into `.env.local` as `PAYPAL_WEBHOOK_ID=...`.
5. Restart the listener so it picks up the ID.

Notes:
- Events sent from the **Webhooks Simulator** use the webhook ID `WEBHOOK_ID` and cannot be verified (VERIFIED (doc), §7). Real verification evidence comes from the E1–E4 transactions in T-004.
- A manual `curl` post will still record `FAILURE` or `ERROR` after registration, because it has no valid PayPal signature.

## Library

- `lib/paypal.ts`
  - `getToken()`: cached until `expires_in − 60s`.
  - `requestToken()`: raw token response, not cached.
  - `pp(method, path, body?, { requestId?, mockCode? })`: returns `{ status, headers, json, requestId }`.
    - POSTs always send `PayPal-Request-Id`, generated if not given.
    - `mockCode` sets `PayPal-Mock-Response` for negative tests.
    - A 401 refreshes the token once and retries with the same request ID. There are no other retries.
- `lib/record.ts`
  - `record(name, data)` writes `spike/results/<name>.json` with secrets removed:
    - `access_token`, `Authorization`, cookies and similar keys;
    - `Bearer`/`Basic` credentials in text;
    - the client secret and any issued token, wherever they appear.

## Safety

- The base URL is hard-coded to `https://api-m.sandbox.paypal.com`.
- Scripts refuse to run unless `PAYPAL_ENV=sandbox`.
- Tokens and secrets are never printed. `spike/results/` is gitignored. Review a result file before sharing it.
