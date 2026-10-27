# Spike results — PayPal Sandbox (E0–E7)

**Run date:** 2026-10-27, about 22:40–22:49 UTC.
**Environment:** `https://api-m.sandbox.paypal.com`, Node 25.2.1, scripts in `spike/`.

Every row below links to a redacted JSON recording in `spike/results/`. That folder is gitignored, so the files exist only on the owner's machine. The leak scan of all recorded files (one check for tokens, `Bearer`/`Basic` credentials and `access_token` values) found nothing.

Labels:
- **Observed** means it was seen in these recordings.
- **Docs** means it comes from PayPal documentation only.
- **Pending** means it is not yet known.

## 1. Headline

| Question | Answer | Evidence |
| --- | --- | --- |
| Can a PayPal-wallet authorization be partially captured? | **Yes.** It needed no account setting. | E1, E2: capture of $38.00 on a $200.00 auth → `201 COMPLETED` |
| Can the remainder be voided after a partial capture with `final_capture:false`? | **Yes.** Void → `200`, auth `VOIDED` | E1 |
| Can it be voided after `final_capture:true`? | **No.** `422 UNPROCESSABLE_ENTITY`, issue `PREVIOUSLY_CAPTURED` | E2 |
| Does the buyer see the remaining $162.00 released? | **Pending.** Needs the E8 buyer view. | — |
| Does the fallback (capture all, refund the rest) work? | **Yes.** | E4 |
| Do retries with the same `PayPal-Request-Id` create duplicates? | **No.** The same capture id is returned. | E5 |
| Are webhook signatures verifiable? | **Yes.** All 11 real deliveries were `SUCCESS`. | E7 |

**Recommendation: `SETTLEMENT_MODE=PARTIAL_CAPTURE_THEN_VOID`, subject to E8** (see §4).

## 2. Experiments

### E0 — OAuth token
`POST /v1/oauth2/token` → `200`, `token_type` Bearer, `expires_in` 32400 s (9 h). [E0-token.json](results/E0-token.json)

**Observed:** a second request about a minute later returned the *same* token. `expires_in` had dropped to 32348, so the Sandbox reuses the current token until it expires.

### E1 — Partial capture with `final_capture:false`, then void

Order `3M713225W46152355`, authorization `5TN13229TB9978039`.

| Step | HTTP | Status | Record |
| --- | --- | --- | --- |
| Create order ($200.00, AUTHORIZE) | 200 | `PAYER_ACTION_REQUIRED` | [E1-01-create-order](results/E1-01-create-order.json) |
| Owner approval → GET order | 200 | `APPROVED` | [E1-04-get-order-after-approval](results/E1-04-get-order-after-approval.json) |
| Authorize | 201 | order `COMPLETED`; auth `CREATED`, $200.00, expires 2026-11-25T22:41:33Z | [E1-02-authorize](results/E1-02-authorize.json) |
| GET auth | 200 | `CREATED` | [E1-04-get-auth-after-authorize](results/E1-04-get-auth-after-authorize.json) |
| Capture $38.00, `final_capture:false` | 201 | capture `5B211957T5969872L` `COMPLETED` | [E1-03-capture-1](results/E1-03-capture-1.json) |
| GET auth | 200 | `PARTIALLY_CAPTURED` | [E1-04-get-auth-after-capture](results/E1-04-get-auth-after-capture.json) |
| Void | **200** (full authorization returned) | `VOIDED` | [E1-05-void-1](results/E1-05-void-1.json) |
| GET auth | 200 | `VOIDED` | [E1-04-get-auth-after-void](results/E1-04-get-auth-after-void.json) |

### E2 — Partial capture with `final_capture:true`, then attempted void

Order `29G10069CE107734B`, authorization `8EP712293Y7223943`.

| Step | HTTP | Status | Record |
| --- | --- | --- | --- |
| Authorize | 201 | auth `CREATED`, $200.00 | [E2-02-authorize](results/E2-02-authorize.json) |
| Capture $38.00, `final_capture:true` | 201 | capture `03A84484J18433418` `COMPLETED`, `final_capture: true` | [E2-03-capture-1](results/E2-03-capture-1.json) |
| GET auth | 200 | **`CAPTURED`**, not `PARTIALLY_CAPTURED`, although only $38 of $200 was taken | [E2-04-get-auth-after-capture](results/E2-04-get-auth-after-capture.json) |
| Void | **422** | `UNPROCESSABLE_ENTITY`, issue **`PREVIOUSLY_CAPTURED`**, debug_id `ca515367a9fab` | [E2-05-void-1](results/E2-05-void-1.json) |
| GET auth | 200 | still `CAPTURED` | [E2-04-get-auth-after-void-attempt](results/E2-04-get-auth-after-void-attempt.json) |

The API says nothing about what happened to the remaining $162.00. Only E8 can show that.

### E3 — Void only (the clean-return path)

Order `7KB227000W8833534`, authorization `0SX36842WM8821239`.

| Step | HTTP | Status | Record |
| --- | --- | --- | --- |
| Authorize | 201 | auth `CREATED`, $200.00 | [E3-02-authorize](results/E3-02-authorize.json) |
| Void | 200 | `VOIDED` | [E3-05-void-1](results/E3-05-void-1.json) |
| GET auth | 200 | `VOIDED` | [E3-04-get-auth-after-void](results/E3-04-get-auth-after-void.json) |

### E4 — Fallback: full capture, then partial refund

Order `78N395224A2033523`, authorization `4TW63321HF319971A`.

| Step | HTTP | Status | Record |
| --- | --- | --- | --- |
| Authorize | 201 | auth `CREATED`, $200.00 | [E4-02-authorize](results/E4-02-authorize.json) |
| Capture $200.00, `final_capture:true` | 201 | capture `2M190931H46376540` `COMPLETED` | [E4-03-capture-1](results/E4-03-capture-1.json) |
| Refund $162.00 | 201 | refund `2K87169674218511B` `COMPLETED` | [E4-06-refund-1](results/E4-06-refund-1.json) |
| GET capture | 200 | `PARTIALLY_REFUNDED` | [E4-04-get-capture-after-refund](results/E4-04-get-capture-after-refund.json) |
| GET refund | 200 | `COMPLETED`, $162.00 | [E4-04-get-refund-after-refund](results/E4-04-get-refund-after-refund.json) |
| GET auth | 200 | `CAPTURED` | [E4-04-get-auth-after-refund](results/E4-04-get-auth-after-refund.json) |

### E5 — Idempotency

Order `20G33723KS496850J`, authorization `662160357U220583Y`. The same $38.00 capture body was sent twice with one `PayPal-Request-Id`. [E5-07-idempotency](results/E5-07-idempotency.json)

| Check | Result |
| --- | --- |
| First call | **201**, capture `26F96310G2864510S` `COMPLETED` |
| Repeat with the same request ID | **200**, same capture `26F96310G2864510S` |
| Captures on the order before → after | 0 → 1 |
| **Verdict** | **PASS** |

**Observed:** a replayed capture returns `200` where the original returned `201`. Docs: the capture reference calls this a "200 idempotent response".

The first E5 order (`8RC99582UF445094K`) never reached `APPROVED`, so it was abandoned. Its records are `E5-04-get-order-after-approval-2/-3`. A fresh order was approved on the first try.

### E6 — Negative test

A capture on E5's authorization was sent with the header `PayPal-Mock-Response: {"mock_application_codes":"DUPLICATE_INVOICE_ID"}`. Code source: <https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/>, which lists Payments v2 capture as supported. [E6-08-negative-DUPLICATE_INVOICE_ID](results/E6-08-negative-DUPLICATE_INVOICE_ID.json)

| Check | Result |
| --- | --- |
| Status | 422 |
| Body | `UNPROCESSABLE_ENTITY`, issues `[DUPLICATE_INVOICE_ID]` |
| Captures on the order before → after | 1 → 1, so no capture was created |
| **Verdict** | **PASS** |

### E7 — Real webhooks

The listener ran on `127.0.0.1:8787`, exposed through a `cloudflared` quick tunnel. The owner registered the webhook in the dashboard with the 6 events from §7. All 11 real PayPal deliveries verified **`SUCCESS`**. Verification sends PayPal the *parsed* event, and that was accepted.

| Event type | Count | Resources | Delay after the API call |
| --- | --- | --- | --- |
| `PAYMENT.AUTHORIZATION.CREATED` | 5 | E1–E5 authorizations | delivered after the capture/void events in some cases |
| `PAYMENT.CAPTURE.COMPLETED` | 4 | E1, E2, E4, E5 captures | 9 s (E1) |
| `PAYMENT.AUTHORIZATION.VOIDED` | 2 | E1, E3 | **66 s** (E1), 30 s (E3) |
| `PAYMENT.CAPTURE.REFUNDED` | 1 | E4 refund | 19 s |
| `PAYMENT.CAPTURE.PENDING` / `DENIED` | 0 | none expected | — |

**Observed:**
- Events can arrive **out of order**. The `AUTHORIZATION.CREATED` events for E4 and E5 came after their `CAPTURE.COMPLETED`.
- Void events can take more than a minute.

This supports the design in §7: webhooks confirm results, the API response drives state, and the timeline must sort by PayPal resource time, not by arrival.

Records are in `results/webhook-WH-*.json`. `webhook-WH-LOCAL-TEST*` and `webhook-WH-TUNNEL-TEST` are unsigned local tests, so their verification results (`SKIPPED`/`ERROR`) are expected.

### E8 — Buyer view

**Pending (owner).** What the sandbox personal account shows after E1, E2, E3 and E4.

### Other observations

- **Create order returns `200`, not `201`**, on the first, non-replayed call (all 6 orders). §5.1 expected 201. The app must accept either.
- **The approval page loops after "Review order".** The §5.1 order body has no `return_url`, so PayPal has nowhere to redirect. Approval is still recorded (`APPROVED`). This doesn't affect the app, which approves through the JS SDK popup.
- `experience_context` (`brand_name`, `NO_SHIPPING`, `CONTINUE`) was accepted for AUTHORIZE orders. This answers §13 #5.
- An authorization lasts **29 days**: authorized 2026-10-27T22:41Z, expires 2026-11-25T22:41Z. This matches the docs.

## 3. Decision rule (§3) applied

| Condition for `PARTIAL_CAPTURE_THEN_VOID` | Status |
| --- | --- |
| Capture D succeeds | **Met** (E1 capture `201 COMPLETED`) |
| The void is accepted | **Met** (E1 void `200 VOIDED`) |
| The buyer view shows no remaining held amount | **Pending** (E8) |

## 4. Recommendation

**Set `SETTLEMENT_MODE=PARTIAL_CAPTURE_THEN_VOID`.** The API evidence satisfies both conditions it can satisfy. The fallback modes were also proven: E2 for `PARTIAL_CAPTURE_FINAL`, E4 for `CAPTURE_THEN_REFUND`.

Until E8 is done:
- UI copy follows §9 neutral wording: "$38 captured · remaining $162 authorization voided".
- The words **"released"** and **"refunded"** are not used for the void path.

If E8 shows the $162 still held or pending after the void, the mode stays the same and the wording stays neutral.

Mode `PARTIAL_CAPTURE_FINAL` is **not** recommended. After a $38 final capture, PayPal reports the whole authorization as `CAPTURED`, and the remainder can no longer be voided (`PREVIOUSLY_CAPTURED`). That makes the remainder's fate unclear in the API.

## 5. Still uncertain

1. **E8:** what the buyer sees for the voided remainder (E1), the final partial capture (E2), the full void (E3) and capture-then-refund (E4).
2. **Business account settings** (§2 step 3): what the owner sees about authorization or capture settings. Partial capture worked without changing any setting.
3. **`PayPal-Request-Id` retention window:** not documented on the capture reference page, and not tested. The app's own lock (§6) is the primary guard anyway.
4. **The honor period (3 days):** whether a capture after day 3 behaves differently. Not tested; demo rentals are 3 days or less.
5. **The approval-page loop:** not investigated further; it doesn't affect the app flow.
