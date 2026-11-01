# Devpost draft — Holdfast

Paste each section into the matching Devpost field. Before submitting, fill in the two `<…>` placeholders. Put the testing credentials only in the **private** testing-instructions field, never in the public text.

## Project name

Holdfast

## Tagline

Rental deposits settled on evidence: a PayPal hold, an AI photo comparison, and only the agreed amount captured.

## Links

- **Demo:** https://holdfast-806240887939.us-central1.run.app
- **Code:** https://github.com/Rudrani26/holdfast
- **Video:** `<YouTube URL>`

## Images

Upload in this order. All are in `docs/images/`.

1. `storefront.jpg`: the storefront, showing one deposit from start to finish
2. `architecture.png`: architecture
3. `ai-report.jpg`: Gemini's proposals, each priced from the shop's list
4. `settlement-receipt.jpg`: the receipt with PayPal IDs and webhook-confirmed statuses
5. `renter-phone.jpg`: the renter's view on a phone
6. `contest-review.jpg`: a contested line, reviewed and dropped

---

## About the project (main description)

### Inspiration

Small rental shops (camera gear, bikes, audio, outdoor kit) live on deposits, and deposits cause fights. The shop says the item came back damaged. The renter says it was already like that. The usual outcome is a charge the renter didn't expect, a chargeback, or a shop that gives up and absorbs the loss. Both sides lack a shared record of what changed and a fair, visible way to settle it.

### What it does

Holdfast turns a rental deposit into an evidence-backed settlement.

1. **Hold, not charge.** At booking, the renter approves a PayPal order with `intent: AUTHORIZE`. The $200 deposit is held as a PayPal authorization, and nothing is captured.
2. **Photos at pickup.** Staff take six guided photos. Gemini records the item's existing wear as a baseline, and the renter acknowledges it from a signed link.
3. **Compare at return.** Staff take the same six angles. Gemini compares each pair and proposes only what is new: the type, severity, location, a confidence score, and a quoted reason. Wear already in the baseline is not charged.
4. **The shop's price list sets the price.** A deterministic pricer maps each finding to the shop's own price list. The AI never sets a price.
5. **People decide.** Staff confirm, re-price or drop each line. The renter sees every photo and price, then accepts or contests each line with a reason.
6. **PayPal settles exactly that.** After both approvals, Holdfast captures only the agreed amount and voids the rest of the authorization. A clean return voids the whole authorization. Both sides get the same receipt, with PayPal's own IDs and statuses, each confirmed by a signature-verified webhook.

### How I built it

**PayPal is the money layer.**
- Orders v2 creates and authorizes the deposit.
- Payments v2 captures part of it with `final_capture: false` and voids the remainder. Capture-then-refund is a tested fallback mode.
- Every write carries a `PayPal-Request-Id`, so retries can't double-capture, and settlement runs under a Firestore lock.
- Webhooks (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.VOIDED`) are verified with PayPal's verify-signature API before anything is recorded.
- The PayPal agent toolkit doesn't expose authorize, partial capture or void, so Holdfast calls the REST APIs directly.

**Gemini is the evidence layer.**
- `gemini-3.7-flash` on Vertex AI runs with a strict JSON schema, and its output is validated with Zod.
- A baseline pass records existing wear; a return pass compares each photo pair against it.
- Uncertain findings go to a "needs your eyes" group instead of the bill.
- A daily call cap is enforced in Firestore.
- A replay mode returns only recorded live responses for identical photos, and the app labels it.

**The rest of the stack:** Next.js 16 (App Router) and TypeScript (strict), Tailwind CSS, shadcn/ui and Zod, with Firestore and a private Cloud Storage bucket, deployed on Google Cloud Run. Money is integer cents everywhere. The pricer, the rental state machine and the settlement planner are pure functions with unit tests: 653 tests in all.

### Challenges I ran into

- **Proving PayPal behaviour before building on it.** Before writing the settlement code, I ran a Sandbox spike.
  - **Partial capture plus void** works.
  - **After `final_capture: true`, a void fails** with `PREVIOUSLY_CAPTURED`. The authorization then reports `CAPTURED` even though only $38 of $200 was taken.
  - **Retries with the same request ID** return the same capture.

  Those results chose the settlement mode and the UI's wording. Holdfast says "captured" and "voided", never "refunded" or "released", because those are the statuses PayPal actually returns.
- **False charges destroy trust.** The hardest cases for the AI are clean returns in different light, at a different angle or on a different background. I built an evaluation set from real photos of my own gear and measured the false-charge rate rather than accuracy alone. The one false charge it found is exactly why people confirm every line.
- **Keeping the AI away from the money.** No code path lets model output set a price or start a transaction. Settlement code checks for the recorded staff and renter approvals itself.

### Accomplishments that I'm proud of

- The whole flow is real: PayPal Sandbox authorizations, captures and voids, plus live Gemini inspections on real photos. Every PayPal ID in the demo video was re-checked against PayPal's API afterwards.
- A clean return in different light comes back as "No new damage", and the whole hold is voided.
- A renter who disagrees has a real path. The contested line is reviewed and dropped, and the hold is voided.

### What I learned

Authorization lifecycles are subtle: a single flag, `final_capture`, decides whether the rest of a hold can still be voided. Vision models are strong at spotting missing parts and dents, and weakest on lighting and background changes. Designing for disagreement (contest rounds, visible evidence, human gates) mattered as much as the model's accuracy.

### What's next for Holdfast

- A larger evaluation set across more item types.
- Pre-filled findings for repeat damage.
- A view of PayPal disputes in the timeline.
- A pilot with a real rental shop, which would need a live PayPal account and its own review.

### Disclosures

- **PayPal Sandbox only.** No real money moves.
- **Live AI on real photos.** Gemini findings in the app and video come from live calls on real photos of my own items. No AI-generated or AI-edited images are used anywhere.
- **Evaluation.** The set is small (8 real cases) and is reported with its caveats in the repository.
- **Video voice.** The narration is an AI-generated voice (Google Cloud Text-to-Speech).
- **New work.** Holdfast was built from scratch during the hackathon period, starting Oct 27, 2026.

---

## Built with

next.js, typescript, react, tailwind-css, zod, paypal, paypal-rest-api, paypal-orders-api, paypal-webhooks, gemini, vertex-ai, google-cloud, google-cloud-run, firestore, google-cloud-storage, vitest

## Testing instructions (private field)

```
Live demo: https://holdfast-806240887939.us-central1.run.app (PayPal Sandbox, no real money)

1. Storefront → pick an item → enter any name and email → Continue to deposit → PayPal button.
   Sign in to the PayPal popup with this SANDBOX buyer account:
     email:    <sandbox buyer email>
     password: <sandbox buyer password>
2. Staff workspace → passcode: <staff passcode>
   Open the rental, add 6 check-out photos (any phone photos of one object), run the baseline.
3. Copy the renter link from the staff page, open it, acknowledge the baseline.
4. Add 6 return photos (change something visible, or nothing for a clean return), run the inspection,
   review and confirm.
5. On the renter link: accept, or contest a line. Then settle from the staff page.
   The receipt shows PayPal's capture/void IDs; badges turn "PayPal-confirmed" when webhooks arrive.

Each inspection makes live Gemini calls; a daily cap protects the demo.
```

Use a dedicated sandbox buyer account for judges, not the one used for development.

## Before you submit

- Fill in the video URL and the private testing fields.
- Re-read the official rules (`docs/SUBMISSION_CHECKLIST.md` §1–3) and check whether the form asks for category or prize selections.
- Open the repo, video and demo links in a logged-out browser.
