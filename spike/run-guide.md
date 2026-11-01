# Spike run guide: E1–E4 (+ E7 webhooks, E8 buyer view)

Follow this file top to bottom. Experiments are defined in `docs/PAYPAL_INTEGRATION.md` §3.

- Every command runs **from the repo root** against the **PayPal Sandbox only**.
- Every request and response is recorded, with secrets removed, in `spike/results/`.
- Steps marked **[OWNER]** are manual.

Each experiment uses its own fresh $200.00 order. Scripts keep the IDs they need in `spike/results/state-<exp>.json`, so you never copy IDs by hand.

## 0. Before you start

1. **E0 still passes:** `npx tsx spike/00-token.ts`
2. **[OWNER] Check the business account settings** (§2 step 3):
   - Log in at https://www.sandbox.paypal.com as the sandbox **business** account.
   - Look through payment preferences for anything about authorization, capture or partial capture.
   - Write down what you see, even "nothing found". It goes into `spike/RESULTS.md` in T-006.
3. **[OWNER] Note the buyer login.** Find the sandbox **personal** account email and password under developer.paypal.com → Testing Tools → Sandbox Accounts. You'll log in with it to approve each order.
4. **[OWNER] Recommended: start webhook capture (E7)** so that E1–E4 also produce real webhook evidence:
   - Terminal A: `npx tsx spike/webhook-server.ts`
   - Terminal B: `cloudflared tunnel --url http://127.0.0.1:8787`
   - Then check that the webhook URL in the sandbox app matches the current tunnel URL; see `spike/README.md` → Webhooks.

   Leave both running through step 4 of this guide. Deliveries appear as `spike/results/webhook-*.json`.
5. Have a folder ready for screenshots: `spike/results/screenshots/` (gitignored).

### Reading the output

Every script prints:
- `HTTP <code> OK` with the PayPal IDs and statuses, or
- `HTTP <code> ERROR` with PayPal's error name, `issues` and `debug_id`.

Each step's expected result below comes **from the docs and is not yet proven**. Whatever actually happens *is* the result: don't retry just to get the expected outcome. The only exception is the partial-capture checklist at the end.

---

## E1 — Partial capture with `final_capture:false`, then void

```sh
npx tsx spike/01-create-order.ts --exp E1
```
**[OWNER]** Open the printed link, log in as the **personal** account and approve.

After you click **Review order**, the page **loops forever**. This is expected and was seen in the Sandbox on 2026-10-27. The order body in §5.1 has no `return_url`, so PayPal has nowhere to redirect. The approval is already recorded, so close the tab.

To confirm, run `npx tsx spike/04-get-auth.ts --exp E1 --what order --label after-approval`. It should show `status APPROVED`.

```sh
npx tsx spike/02-authorize.ts --exp E1
npx tsx spike/04-get-auth.ts  --exp E1 --label after-authorize
npx tsx spike/03-capture.ts   --exp E1 --amount 38.00 --final false
npx tsx spike/04-get-auth.ts  --exp E1 --label after-capture
npx tsx spike/05-void.ts      --exp E1
npx tsx spike/04-get-auth.ts  --exp E1 --label after-void
```

Expected per the docs, not yet proven:
- the authorization is `CREATED`, then `PARTIALLY_CAPTURED` after the capture, then `VOIDED`;
- the void returns `204` or `200`.

Write down what you actually see, especially whether the void is **accepted**.

**[OWNER] E8 buyer view for E1:**
1. Log in at https://www.sandbox.paypal.com as the **personal** account.
2. Open Activity and the transaction details.
3. Take screenshots, saved as `spike/results/screenshots/E8-E1-*.png`.
4. Note: is any amount still shown as **pending or on hold**? Is only $38.00 shown as paid?

---

## E2 — Partial capture with `final_capture:true`, then attempt a void

```sh
npx tsx spike/01-create-order.ts --exp E2
```
**[OWNER]** Approve as the personal account.

```sh
npx tsx spike/02-authorize.ts --exp E2
npx tsx spike/03-capture.ts   --exp E2 --amount 38.00 --final true
npx tsx spike/04-get-auth.ts  --exp E2 --label after-capture
npx tsx spike/05-void.ts      --exp E2
npx tsx spike/04-get-auth.ts  --exp E2 --label after-void-attempt
```

The void here **may fail on purpose**, for example with `PREVIOUSLY_CAPTURED`. The script then shows `ERROR` and exits 1; that's a result, not a problem. Write down the exact error name and issue.

**[OWNER] E8 buyer view for E2:** as for E1, saved as `E8-E2-*.png`. Is the remaining $162.00 still shown as held?

---

## E3 — Void only (the clean-return path)

```sh
npx tsx spike/01-create-order.ts --exp E3
```
**[OWNER]** Approve as the personal account.

```sh
npx tsx spike/02-authorize.ts --exp E3
npx tsx spike/05-void.ts      --exp E3
npx tsx spike/04-get-auth.ts  --exp E3 --label after-void
```

Expected per the docs: `VOIDED`.

**[OWNER] E8 buyer view for E3:** saved as `E8-E3-*.png`. Does the $200.00 hold disappear, or does it show as voided or cancelled? This decides whether the UI may ever say "released" (§9).

---

## E4 — Fallback: full capture, then partial refund

```sh
npx tsx spike/01-create-order.ts --exp E4
```
**[OWNER]** Approve as the personal account.

```sh
npx tsx spike/02-authorize.ts --exp E4
npx tsx spike/03-capture.ts   --exp E4 --amount 200.00 --final true
npx tsx spike/06-refund.ts    --exp E4 --amount 162.00
npx tsx spike/04-get-auth.ts  --exp E4 --what capture --label after-refund
npx tsx spike/04-get-auth.ts  --exp E4 --what refund  --label after-refund
npx tsx spike/04-get-auth.ts  --exp E4 --label after-refund
```

Expected per the docs:
- the capture is `COMPLETED`, then `PARTIALLY_REFUNDED`;
- the refund is `COMPLETED`.

**[OWNER] E8 buyer view for E4:** saved as `E8-E4-*.png`. Expect a $200.00 payment and a $162.00 refund as two separate entries.

---

## E5 — Idempotency, and E6 — negative test (T-005)

```sh
npx tsx spike/01-create-order.ts --exp E5
```
**[OWNER]** Approve as the personal account.

```sh
npx tsx spike/02-authorize.ts    --exp E5
npx tsx spike/07-idempotency.ts  --exp E5                 # same $38.00 capture sent twice, one request ID
npx tsx spike/08-negative.ts     --exp E5                 # mock DUPLICATE_INVOICE_ID on E5's authorization
```

Both scripts print `PASS`/`FAIL` for each check, with the evidence behind it.

**E5** passes when:
- both calls return the **same** capture ID;
- the order shows exactly one new capture.

**E6** passes when:
- PayPal returns a 4xx `UNPROCESSABLE_ENTITY` with issue `DUPLICATE_INVOICE_ID`;
- no capture is created.

E6 reuses E5's authorization, which still has a remaining amount because E5 captured with `final_capture:false`.

---

## After E1–E4

1. **E7:** wait a minute or two, then stop the listener (Ctrl+C) and the tunnel.
   - Check `spike/results/webhook-*.json` for `verification.outcome`.
   - Note which event types arrived. Section 13 uncertainty #4 is about exactly this.
2. Report that the runs are done, and pass on your E8 notes and the account-settings notes. T-006 turns the recorded JSON into `spike/RESULTS.md` and the `SETTLEMENT_MODE` recommendation.

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| `02-authorize` fails with an "order not approved" type error | The buyer approval wasn't completed. Open the link again, approve, then rerun `02`. |
| You want to repeat an experiment on a new order | Use a new name, e.g. `--exp E1-retry`, so the first attempt's records are kept. |
| `03`, `05` or `06` fails and you want to try again | Just rerun it. Each attempt gets a new request ID, invoice ID and `-<attempt>` record file. |
| A script exits with `Missing sandbox credentials` or `must be exactly "sandbox"` | Fix `.env.local` (see `spike/README.md`). |
| Webhook outcome `SKIPPED` | `PAYPAL_WEBHOOK_ID` isn't set. Set it and restart the listener. |

### Partial capture rejected in E1 *and* E2?

Before treating partial capture as unavailable (§3), do all of these and record each one:

1. Re-read the current Payments v2 capture docs (links in `docs/PAYPAL_INTEGRATION.md` §12).
2. Re-check the business account settings (step 0.2).
3. Retry once with a new order: `--exp E1-retry`.
4. Search the PayPal developer community for the exact error `issue`.
5. Write down what each step showed for `spike/RESULTS.md`.
