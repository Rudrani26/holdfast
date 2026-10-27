# PAYPAL_INTEGRATION.md — Holdfast payment integration

Status labels used throughout:
- **VERIFIED (doc)** — stated in PayPal's official documentation as of Oct 27, 2026. Not yet observed in our sandbox.
- **VERIFIED (sandbox)** — observed in our sandbox; filled in after the spike (Section 3) with a link to `spike/results/*.json`.
- **UNVERIFIED** — assumption; must be tested before relying on it.

Everything runs against **PayPal Sandbox only** (`https://api-m.sandbox.paypal.com`).

## 1. Why PayPal is central

The deposit *is* a PayPal authorization. Holdfast's entire value is settling that authorization fairly: capture only the approved amount, release or refund the rest, and show a verifiable audit trail. Removing PayPal removes the product.

The PayPal agent toolkit / MCP server does **not** expose authorize, void or partial-capture operations (its tools are `create_order`, `pay_order`, `create_refund`, etc.). Holdfast therefore calls the Orders v2 and Payments v2 REST APIs directly. This is a deliberate, documented decision, not an omission.

## 2. Sandbox configuration (owner does this once)

1. Log in at developer.paypal.com → **Apps & Credentials** → toggle **Sandbox** → **Create App** (merchant, default sandbox business account). Copy Client ID and Secret into `.env.local`.
2. **Testing Tools → Sandbox Accounts**: note the sandbox **business** (merchant) account and a sandbox **personal** (buyer) account. Create a fresh personal account named "Holdfast Demo Renter" with a USD balance for demos.
3. In the business account settings (log in at sandbox.paypal.com as the business account), check payment preferences for anything related to authorization/capture. Record what you see in `spike/RESULTS.md` (UNVERIFIED whether any setting exists).
4. Webhooks are added later in the app settings (Section 7).

Env vars: `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `SETTLEMENT_MODE`.

## 3. Feasibility spike (Milestone 0 — first implementation milestone)

Goal: prove the settlement flow with real sandbox state before building the app. Scripts live in `spike/`, run with `npx tsx`, and write redacted raw responses to `spike/results/<experiment>-<step>.json`.

Buyer approval in the spike is manual: the create-order script prints the order's approval link (HATEOAS link with `rel` `payer-action` or `approve`); the owner opens it, logs in as the sandbox personal account, approves, then runs the next script.

| ID | Experiment | Steps | Record |
| --- | --- | --- | --- |
| E0 | Token | `POST /v1/oauth2/token` (client credentials) | expiry; token NOT saved |
| E1 | Partial capture, then void | Order A $200 `AUTHORIZE` → approve → `/authorize` → capture $38 `final_capture:false` → `GET` auth → `POST void` → `GET` auth | statuses after each step; void accepted or error name |
| E2 | Partial capture, final | Order B $200 → approve → authorize → capture $38 `final_capture:true` → `GET` auth → attempt `void` → `GET` auth | status; whether void returns an error such as `PREVIOUSLY_CAPTURED` |
| E3 | Void only | Order C $200 → approve → authorize → void → `GET` | `VOIDED` |
| E4 | Fallback | Order D $200 → approve → authorize → capture $200 → refund $162 → `GET` capture, `GET` refund | statuses, amounts |
| E5 | Idempotency | Order E → authorize → capture $38 with request ID `X` → repeat identical call with `X` | same capture ID returned, no second capture |
| E6 | Negative test | Capture with header `PayPal-Mock-Response: {"mock_application_codes":"<CODE>"}` using a code listed for authorization capture in PayPal's Payments v2 error docs | error returned and parsed |
| E7 | Real webhooks | Listener (`spike/webhook-server.ts`) on `localhost:8787` exposed via a free `cloudflared` quick tunnel; register URL in sandbox app; capture events from E1–E4; call `verify-webhook-signature` | `verification_status` per event |
| E8 | Buyer view | Log in to sandbox.paypal.com as the personal account after E1, E2, E4 | screenshots of activity; note whether any amount still shows as pending/held |

**Spike outcome (run 2026-10-27; full report and evidence links in `spike/RESULTS.md`):**
- Authorization status values: VERIFIED (doc). **VERIFIED (sandbox):** observed `CREATED`, `PARTIALLY_CAPTURED`, `CAPTURED` and `VOIDED` ([E1](../spike/results/E1-04-get-auth-after-capture.json), [E2](../spike/results/E2-04-get-auth-after-capture.json)).
- **VERIFIED (sandbox):** an authorization is valid for 29 days (authorized 2026-10-27T22:41Z, expires 2026-11-25T22:41Z, [E1](../spike/results/E1-02-authorize.json)). The 3-day honor period is VERIFIED (doc) only; not tested.
- **VERIFIED (sandbox):** partial capture of a PayPal-wallet authorization works with **no account setting enabled**. $38.00 of $200.00 → `201 COMPLETED` ([E1](../spike/results/E1-03-capture-1.json)). The legacy enablement note does not apply to this sandbox REST account.
- **VERIFIED (sandbox):** a void after a partial capture with `final_capture:false` is accepted: `200`, authorization `VOIDED` ([E1](../spike/results/E1-05-void-1.json)).
- **VERIFIED (sandbox):** after a partial capture with `final_capture:true`, the authorization reports `CAPTURED`, even though only $38 of $200 was taken. A void then fails with `422`, issue `PREVIOUSLY_CAPTURED` ([E2](../spike/results/E2-05-void-1.json)).
- Whether the buyer sees the voided remainder as released: **UNVERIFIED** until E8 (owner buyer-view check).

**Decision rule → `SETTLEMENT_MODE`:**

| Spike outcome | Mode | Settlement for deduction D on deposit H |
| --- | --- | --- |
| E1 succeeds: capture D, void accepted, buyer view shows no remaining held amount | `PARTIAL_CAPTURE_THEN_VOID` (preferred) | capture D `final_capture:false` → void |
| E1 void rejected but E2 shows remainder no longer held | `PARTIAL_CAPTURE_FINAL` | capture D `final_capture:true` |
| Partial capture rejected in both, after checking account settings and docs | `CAPTURE_THEN_REFUND` (fallback) | capture H → refund H − D |
| In all modes, D = 0 | — | void |
| In all modes, D = H | — | capture H `final_capture:true` |

"Remainder released" claims require evidence from E8 or authoritative docs. If evidence is ambiguous, UI copy uses the neutral wording in Section 9.

Before declaring partial capture unavailable: (1) re-read current Payments v2 capture docs; (2) check sandbox business account settings; (3) retry once with a new order; (4) search PayPal developer community; (5) record each step in `spike/RESULTS.md`.

**Fallback customer experience (`CAPTURE_THEN_REFUND`), stated honestly:**
- During the rental the deposit is still an authorization hold (unchanged).
- At settlement the renter sees a **$200 payment** followed by a **$162 refund**, not a partial hold release.
- Refund availability depends on the renter's funding source; in sandbox it is immediate. Do not quote production timings.
- In production, fee treatment on refunds may differ from a partial capture (UNVERIFIED; out of scope).
- Competitiveness reassessment if fallback is used: Technological Implementation drops modestly; Innovation (evidence → consent → settlement loop) is unchanged; Presentation must show both transactions plainly. Holdfast remains viable.

## 4. Authentication

- `POST /v1/oauth2/token`, Basic auth with Client ID/Secret, body `grant_type=client_credentials`.
- Cache the token in memory until `expires_in − 60s`. Never log or persist it.
- Module: `src/server/paypal/auth.ts`.

## 5. Orders v2 and Payments v2 calls

All POSTs send headers: `Authorization: Bearer <token>`, `Content-Type: application/json`, `PayPal-Request-Id: <idempotency key>`, `Prefer: return=representation`.

### 5.1 Create the deposit order
`POST /v2/checkout/orders`
```json
{
  "intent": "AUTHORIZE",
  "purchase_units": [{
    "reference_id": "<rentalId>",
    "custom_id": "<rentalId>",
    "description": "Security deposit hold — <item name> (Holdfast demo)",
    "amount": { "currency_code": "USD", "value": "200.00" }
  }],
  "payment_source": {
    "paypal": {
      "experience_context": {
        "brand_name": "Kestrel Gear Rentals (demo)",
        "shipping_preference": "NO_SHIPPING",
        "user_action": "CONTINUE"
      }
    }
  }
}
```
**VERIFIED (sandbox):** returns **`200`** (not 201) with `status: PAYER_ACTION_REQUIRED` and a `payer-action` link, for every order created. Accept either 200 or 201. This exact `experience_context` is accepted for AUTHORIZE orders. Without a `return_url`, the hosted approval page loops after "Review order", but the approval is still recorded (`APPROVED`). The app uses the JS SDK popup instead. Evidence: [E1-01](../spike/results/E1-01-create-order.json).

Request ID: `rental:<rentalId>:create-order`.

### 5.2 Buyer approval (app)
JavaScript SDK v5 loaded from `https://www.paypal.com/sdk/js?client-id=<NEXT_PUBLIC_PAYPAL_CLIENT_ID>&currency=USD&intent=authorize` (the `intent=authorize` query param is VERIFIED (doc) as required for authorize flows). `createOrder` calls our server; `onApprove` calls our authorize route. v6 SDK is optional P2; v5 is documented and supported.

### 5.3 Authorize
`POST /v2/checkout/orders/{orderId}/authorize`, body `{}`. Request ID `rental:<id>:authorize`.
Read `purchase_units[0].payments.authorizations[0]`: `id`, `status`, `amount`, `expiration_time`. Store all.

### 5.4 Capture (full or partial)
`POST /v2/payments/authorizations/{authorizationId}/capture`
```json
{
  "amount": { "currency_code": "USD", "value": "38.00" },
  "final_capture": false,
  "invoice_id": "HF-<rentalId>-<settlementSeq>",
  "note_to_payer": "Holdfast deposit settlement: approved damage charges only.",
  "soft_descriptor": "HOLDFAST"
}
```
Request ID `settle:<rentalId>:<settlementSeq>:capture`. `final_capture` per mode. `invoice_id` must be unique per capture. Duplicate invoice IDs return an error, negative-test code `DUPLICATE_INVOICE_ID`: VERIFIED (doc), and **VERIFIED (sandbox)** via the mock header as `422 UNPROCESSABLE_ENTITY` with no capture created ([E6](../spike/results/E6-08-negative-DUPLICATE_INVOICE_ID.json)).

**VERIFIED (sandbox):** a new capture returns `201`. Repeating it with the same `PayPal-Request-Id` returns `200` with the **same** capture ID and creates no second capture ([E5](../spike/results/E5-07-idempotency.json)).

### 5.5 Void
`POST /v2/payments/authorizations/{authorizationId}/void`, empty body. Request ID `settle:<rentalId>:<seq>:void`. **VERIFIED (sandbox):** returns **`200` with the full authorization** (`status: VOIDED`) when `Prefer: return=representation` is sent ([E1](../spike/results/E1-05-void-1.json), [E3](../spike/results/E3-05-void-1.json)). After a final capture it returns `422 PREVIOUSLY_CAPTURED` ([E2](../spike/results/E2-05-void-1.json)).

### 5.6 Refund
`POST /v2/payments/captures/{captureId}/refund`
```json
{ "amount": { "currency_code": "USD", "value": "162.00" }, "note_to_payer": "Holdfast: unused deposit returned" }
```
Request ID `settle:<rentalId>:<seq>:refund`.

### 5.7 Reads used for reconciliation
`GET /v2/checkout/orders/{id}`, `GET /v2/payments/authorizations/{id}`, `GET /v2/payments/captures/{id}`, `GET /v2/payments/refunds/{id}`.

## 6. Idempotency (two layers)

1. **Our lock (primary).** Before any capture/void/refund, the settlement executor creates `settlements/{idempotencyKey}` in a Firestore transaction with `status: PENDING`. If the doc already exists with `SUCCEEDED`, return its stored result; if `PENDING`, go to reconciliation (6.3). Keys are deterministic: `settle:<rentalId>:<seq>:<op>`.
2. **PayPal-Request-Id (secondary).** Same key sent to PayPal so a retried HTTP call returns the original result. PayPal retains request IDs only for a limited window (check the API docs for the exact period); never rely on it alone.
3. **Unknown outcome (timeout / 5xx / network error).** Never blindly re-POST with a new ID. First `GET` the authorization (and captures linked from it); if the operation took effect, record it; otherwise retry with the **same** request ID. Max 3 attempts with backoff (1s, 3s, 9s), then mark `SETTLEMENT_FAILED` for staff.

## 7. Webhooks

Register in the sandbox app (Apps & Credentials → app → Webhooks): URL `https://<public-host>/api/webhooks/paypal`. During the spike/local dev the host is a `cloudflared` quick tunnel; after owner-approved deployment it is the Cloud Run URL (the webhook ID changes; update `PAYPAL_WEBHOOK_ID`).

Events (names to confirm against PayPal's webhook event list during E7):
`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`.

Handler (`src/app/api/webhooks/paypal/route.ts`):
1. Read the **raw** body; parse JSON separately.
2. `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from headers `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`), `webhook_id` (`PAYPAL_WEBHOOK_ID`), `webhook_event` (parsed body).
3. If `verification_status !== "SUCCESS"`: store with `verified:false`, return `400`, do nothing else.
4. Dedupe on event `id` (`webhookEvents/{eventId}`).
5. Map resource → rental via `custom_id` / `invoice_id` / authorization ID; append a `PAYPAL_WEBHOOK_VERIFIED` timeline event; update `paypalConfirmed` flags.
6. Return `200` quickly.

Webhooks **confirm**; they do not drive settlement. The API response drives state; the webhook adds the "PayPal-confirmed" badge.

VERIFIED (doc): events from the Webhooks Simulator use webhook ID `WEBHOOK_ID` and cannot be verified via the postback endpoint. Use real sandbox transactions to test verification.

**VERIFIED (sandbox), E7 (`spike/RESULTS.md` §E7):**
- All 6 event names above were accepted at registration.
- 11 real deliveries were received, covering `AUTHORIZATION.CREATED`, `AUTHORIZATION.VOIDED`, `CAPTURE.COMPLETED` and `CAPTURE.REFUNDED`. **All verified `SUCCESS`** with `webhook_event` sent as the parsed body.
- Every event's `resource.custom_id` carries our `purchase_units[].custom_id`, so step 5 can map an event to its rental by `custom_id` alone.
- Capture and refund resources also carry our `invoice_id`.
- `supplementary_data.related_ids` gives `order_id`, plus `authorization_id` on captures.
- **Delivery is delayed and can arrive out of order:**
  - `VOIDED` arrived 30–66 s after the API call;
  - `AUTHORIZATION.CREATED` sometimes arrived after `CAPTURE.COMPLETED`;
  - so the timeline must order events by PayPal resource time, not arrival time.

## 8. Payment state machine (per rental)

```
NONE → ORDER_CREATED → APPROVED → AUTHORIZED
AUTHORIZED → VOIDED                                   (deduction 0, or cancel)
AUTHORIZED → PARTIALLY_CAPTURED → VOIDED_REMAINDER    (mode PARTIAL_CAPTURE_THEN_VOID)
AUTHORIZED → PARTIALLY_CAPTURED_FINAL                 (mode PARTIAL_CAPTURE_FINAL)
AUTHORIZED → CAPTURED_FULL                            (deduction = deposit)
AUTHORIZED → CAPTURED_FULL → PARTIALLY_REFUNDED       (mode CAPTURE_THEN_REFUND)
any settled state → PARTIALLY_REFUNDED                (contest won after capture)
any → ERROR_NEEDS_RECONCILE                           (unknown outcome after retries)
```
`paymentState` is updated only from PayPal responses or verified webhooks, never from client input. The raw PayPal `status` strings are stored alongside.

## 9. UI wording rules (generated from evidence)

`src/lib/settlementCopy.ts` maps `(SETTLEMENT_MODE, observed statuses)` → user-facing text.

**Spike outcome (T-006).** Recommended mode: **`PARTIAL_CAPTURE_THEN_VOID`**.
- Sandbox evidence confirms the statuses behind the "Void succeeded", "Mode A", "Mode B" and "Mode C" rows: E1 void → `VOIDED`; E2 auth → `CAPTURED` with void `PREVIOUSLY_CAPTURED`; E4 capture → `PARTIALLY_REFUNDED` with refund `COMPLETED`.
- **E8 (buyer view) is still pending**, so the "released" upgrades below stay **off**. The evidence flag in code must default to `false`.
- If Mode B were ever used, its copy must not suggest the remainder was voided. The API shows only `CAPTURED`, and a void is rejected.

Rules:

| Situation | Allowed wording | Forbidden wording |
| --- | --- | --- |
| Authorized, not settled | "$200 deposit authorized (hold, not a charge)" | "charged", "paid" |
| Void succeeded | "Deposit authorization voided — no charge" | "refunded" |
| Clean return (deduction $0, void succeeded) | "No new damage detected · $0 charged · deposit authorization voided" (upgrade to "full deposit released" only if E3/E8 showed the buyer's held amount cleared) | "refunded", unproven "released" |
| Mode A after capture+void | "$38 captured · remaining $162 authorization voided" ("released" only if E8 proved it) | "refunded $162" |
| Mode B | "$38 captured as final capture" + whatever E2/E8 proved about the remainder | unproven "released" |
| Mode C | "$200 captured · $162 refunded" | "hold released" |
| Pending capture | "Capture pending at PayPal" | "complete" |

Every settlement row shows the PayPal object ID and raw status, plus a "PayPal-confirmed" badge after a verified webhook.

## 10. Error recovery

| Condition | Handling |
| --- | --- |
| 401 from PayPal | Refresh token once, retry with same request ID |
| 422 `UNPROCESSABLE_ENTITY` | Parse `details[].issue`; do not retry; show staff a precise message (e.g. authorization expired, previously captured, previously voided) |
| Authorization expired / past honor period | Out of MVP scope (rentals ≤ 3 days). Show error; P2: reauthorize |
| 5xx / timeout | Reconcile via GET (§6.3) |
| Webhook verification failure | Log, store unverified, return 400 |
| Amount > remaining authorization | Prevented by pricer cap; also checked server-side before calling PayPal |

Confirm exact `issue` codes against PayPal's Orders v2 and Payments v2 error references during M2; do not hard-code codes you have not seen.

## 11. Test cases

Unit (no network, `npm test`): request body builders; money formatting; settlement planner for each mode and D ∈ {0, 38, 200}; copy rules; idempotency key derivation; webhook header extraction.

Integration (opt-in, `npm run test:integration`, sandbox): create → (manual approve) → authorize → settle per mode; idempotent repeat; negative capture via mock header; webhook verification against a recorded real event (verification only works within PayPal's accepted window — UNVERIFIED how long; record behaviour).

## 12. References (official)

- Authorize and capture: https://developer.paypal.com/docs/checkout/standard/customize/authorization
- Delayed capture / partial capture: https://docs.paypal.ai/payments/methods/paypal/delayed-capture
- Authorization status values: https://developer.paypal.com/api/orders/v2/definitions/authorization_status
- Void authorization (beta guide): https://developer.paypal.com/beta/payments/void-authorization
- Void endpoint reference: https://developer.paypal.com/api/payments/v2/authorizations-void
- Negative testing headers: https://developer.paypal.com/negative-testing/request-headers
- Webhooks and simulator: https://developer.paypal.com/api/rest/webhooks/rest
- Agent tools reference (to confirm what the toolkit does not cover): https://developer.paypal.com/ai-tools/agent-tools
- Legacy note on enabling partial capture: https://developer.paypal.com/docs/archive/payments/authorize-and-capture-payments/

## 13. Known uncertainties (resolve in M0)

Status after the spike on 2026-10-27; details in `spike/RESULTS.md`.

1. ~~Whether partial capture of a PayPal-wallet authorization needs account enablement in sandbox.~~ **Resolved:** no enablement was needed (E1, E2).
2. Whether `final_capture:true` releases the remainder, and whether void is permitted afterwards.
   - **Partly resolved:** void is **not** permitted (`PREVIOUSLY_CAPTURED`), and the auth reports `CAPTURED`.
   - Whether the buyer sees the remainder released is **pending E8**.
3. Whether void after `final_capture:false` returns the remainder to the buyer's available balance in the sandbox UI. **Pending E8.** The API confirms `VOIDED` (E1).
4. ~~Exact webhook event names and payload links to authorization/capture IDs.~~ **Resolved:** all 6 names were accepted, and events link through `custom_id`, `invoice_id` and `related_ids` (E7).
5. ~~`experience_context` accepted values for `AUTHORIZE` orders.~~ **Resolved:** the §5.1 values were accepted.
6. PayPal-Request-Id retention window. **Open:** not documented on the capture reference and not tested. The app's own lock (§6.1) stays primary.
