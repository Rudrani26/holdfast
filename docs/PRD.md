# PRD.md — Holdfast product requirements

## 1. Summary

**Pitch:** Holdfast turns rental deposits into fair, evidence-backed PayPal settlements. AI shows what changed, the renter agrees, and PayPal settles only the approved amount.

**Demo shop:** "Kestrel Gear Rentals" — a fictional small rental shop renting everyday gear (headphones, backpack, insulated bottle or similar items the owner already has). Fictional brand only; no real brands, logos or people.

## 2. Target users

| User | Context | Pain |
| --- | --- | --- |
| **Shop staff / owner** (primary buyer) | 1–5 person rental business; 20–60 rentals a week; deposits $100–$1,500; rentals of 1–3 days | Manual inspections; arguing deductions by email; manual charges; forgotten holds; disputes |
| **Renter** | Rents gear occasionally | Fears unfair deductions; no visibility into evidence; slow deposit return |

Assumption (unvalidated): the pain is common across gear, tool, costume, party and event rentals. The pitch generalizes as "any deposit".

## 3. Core problem

Deposits fail on trust. Condition at check-out is undocumented, damage at return is asserted rather than shown, prices feel arbitrary, and settling means a manual charge or a forgotten hold. Both sides lose time and goodwill.

## 4. Differentiation

AI damage-inspection products exist (enterprise equipment rental, condition-report apps), but they stop at a report. Holdfast closes the loop: evidence → shop price list → staff confirmation → renter consent → exact PayPal settlement → auditable receipt. The AI never prices and never moves money.

## 5. User journeys

**J1 — Happy path (deduction).** Renter books headphones for 2 days and authorizes a $200 deposit → staff photograph 6 angles; AI notes one pre-existing scuff; renter acknowledges baseline → on return staff photograph the same angles → AI finds a missing ear cushion (new) and ignores the scuff (pre-existing) → price list says $38 → staff confirm → renter reads the explanation and accepts → staff press Settle → PayPal: $38 captured; remainder handled per proven mode → receipt with PayPal IDs and verified-webhook badges.

**J2 — Clean return (a headline journey, not an edge case).** Same booking and baseline → on return, AI compares all 6 angles and finds nothing new; the pre-existing scuff is listed as "already recorded at check-out" → report shows **"No new damage detected"** with a check per angle and $0 proposed → staff tap "Confirm $0" → renter's phone shows the same verdict and taps "Looks right" → staff Settle → authorization voided → receipt "No charge · deposit authorization voided" with the PayPal status. Holdfast's credibility comes from being able to say this confidently.

**J3 — Contest.** AI proposes a crack ($38) → renter contests: "That crack was there before" + photo → staff review baseline vs contest photo (P1: AI re-check) → staff drop the line → renter accepts $0 → void.

**J4 — Low-confidence finding.** AI is unsure (confidence 0.5–0.75) → shown as "Needs your eyes", excluded by default → staff decide.

**J5 — Settlement failure.** PayPal returns an error → rental moves to `SETTLEMENT_FAILED` with a clear message → staff retry safely (idempotent).

## 6. MVP features (P0)

1. Storefront with 3 seeded items and deposit amounts.
2. Booking form + PayPal deposit authorization (sandbox).
3. Staff passcode login, rentals list.
4. Rental workspace with stepper: Check-out → Return → Report → Renter → Settlement.
5. Guided 6-angle capture (phone camera via file input with `capture`, or upload) with provenance selection.
6. AI baseline inspection (pre-existing marks) and renter baseline acknowledgment via signed link.
7. AI return inspection per angle pair; findings with type, severity, confidence, region box, short evidence; deterministic inspection verdict including **"No new damage detected"** (`AI_PIPELINE.md` §6.1).
8. Deterministic pricing from the shop price list; cap at deposit.
9. Staff review: include/exclude lines, change severity (re-prices from list), add manual line from list, override amount with reason.
10. Renter decision page: per-line accept/contest with comment (and optional photo).
11. Contest loop (max 2 rounds), staff revise.
12. Settlement execution per `SETTLEMENT_MODE`, idempotent, reconciled.
13. Verified PayPal webhooks → timeline badges.
14. Audit timeline (renter receipt + staff view).
15. Disclosure chips for synthetic/hybrid images; "Replayed AI result" badge in replay mode; sandbox banner.
16. Trust page: "How Holdfast decides" (guardrails in plain language).

P1: AI re-check using renter contest photo; price-list editor UI; finding-region overlay toggle; demo reset script; auto-settle flag.
P2: Difference heatmap; duplicate-finding merge; reauthorization; dispute webhook view; v6 JS SDK.

## 7. Explicit exclusions

User accounts / Firebase Auth; multi-shop or multi-tenant; inventory management; rentals > 3 days; reauthorization; native mobile app; email/SMS sending (links are shown/copied); insurance; ID verification; PayPal disputes automation; marketplace payouts; production PayPal; real customer data; analytics dashboards; internationalization; currencies other than USD.

## 8. Functional requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Renter can create a rental for an active item, 1–3 days, with name and email (validated). |
| FR-2 | System creates an `AUTHORIZE` order for exactly the item's deposit and authorizes it after buyer approval. |
| FR-3 | Staff can capture/upload one photo per angle per phase; re-upload replaces the previous one and is logged. |
| FR-4 | Baseline inspection lists pre-existing marks per angle. |
| FR-5 | Renter must acknowledge the baseline before status `CHECKED_OUT` (staff may record "renter declined to acknowledge" — logged). |
| FR-6 | Return inspection compares each angle pair and returns schema-valid findings or `NEEDS_HUMAN`. |
| FR-6a | The report shows one inspection verdict (`NO_NEW_DAMAGE`, `NO_CHARGES_PROPOSED_REVIEW`, `DAMAGE_PROPOSED`, `INCOMPLETE`) computed by code per `AI_PIPELINE.md` §6.1. A $0 outcome still requires staff confirmation and renter acknowledgement. |
| FR-7 | Pricer maps `(damageType, severity)` to the shop price list; unmatched types produce an unpriced line that staff must price from the list or exclude. |
| FR-8 | Total deduction never exceeds deposit; server rejects otherwise. |
| FR-9 | Staff confirmation freezes the line items for that round and produces the renter link. |
| FR-10 | Renter decisions are recorded per line with timestamp. |
| FR-11 | Settlement runs only from `READY_TO_SETTLE` and executes the planned PayPal ops idempotently. |
| FR-12 | Timeline records every state change, AI run, approval, PayPal op and verified webhook. |
| FR-13 | All settlement wording follows `PAYPAL_INTEGRATION.md` §9. |

## 9. Nonfunctional requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Return inspection (6 angles) completes in ≤ 30 s p50, ≤ 60 s p95 (live). |
| NFR-2 | Pages usable on a 390 px-wide phone and a laptop; Lighthouse accessibility ≥ 90 on key pages. |
| NFR-3 | No secret reaches the client bundle (checked by test grepping `.next/static`). |
| NFR-4 | Settlement is exactly-once under double clicks, retries and duplicate webhooks (tested). |
| NFR-5 | Cost: ≤ $0.05 per inspection estimated; daily AI call cap enforced. |
| NFR-6 | A new machine can run the app from README in ≤ 15 minutes (excluding account creation). |

## 10. Screen specifications

**S1 Storefront `/`** — header with shop name and sandbox banner; 3 item cards (photo, name, daily rate, deposit); "How Holdfast keeps deposits fair" strip linking to S9.

**S2 Booking `/rent/[itemId]`** — item summary; days selector (1–3); name, email; deposit explainer ("$200 authorization — a hold, not a charge. You'll approve any deduction before it's taken."); PayPal button; error and retry states. On success → S3.

**S3 Booking confirmed `/rent/confirmed/[rentalId]`** — authorization ID, status, expiry date; "Show this at pickup"; renter link (copy button) for baseline acknowledgment.

**S4 Staff login `/staff/login`** — passcode field.

**S5 Rentals list `/staff`** — table: renter, item, status chip, deposit, updated; filter by status.

**S6 Rental workspace `/staff/rentals/[id]`** — left: stepper; right: step panel.
- *Check-out:* 6 angle tiles with ghost hint text, capture/upload, provenance select, "Run baseline", baseline marks list.
- *Return:* same tiles for check-in.
- *Report — clean verdict:* large "No new damage detected" heading, 6 angle thumbnails each with a check and "no change" label, pre-existing marks listed as "already recorded at check-out (not charged)", totals "Deposit $200 · Proposed deduction $0", primary button "Confirm $0". Calm, not celebratory; this must feel as authoritative as a damage report.
- *Report:* per angle, before/after side by side with finding boxes; finding cards (type, severity, confidence bar, evidence sentence, price from list, include toggle); "Needs your eyes" group; totals panel (deposit, deduction, remaining); Confirm button.
- *Renter:* link, live status of renter decision.
- *Settlement:* planned ops preview ("Capture $38, then void authorization"), Settle button, results with PayPal IDs/statuses, webhook badges.
- Timeline drawer available on every step.

**S7 Renter page `/r/[token]`** — mobile-first. States: baseline acknowledgment; waiting; decision (per line: photo pair crop, plain explanation, price source "from Kestrel's price list", Accept / Contest + comment + optional photo); clean return ("No new damage detected — no deduction", the 6 checked angles, one "Looks right" button); receipt (amounts, PayPal IDs, timeline).

**S8 Receipt** — within S7 and S6: final amounts, wording per §9 of PAYPAL_INTEGRATION.md.

**S9 Trust page `/how-it-works`** — five guardrails: AI proposes, people decide; prices come from the shop's list; renter consent required; every PayPal action is verified and idempotent; sandbox only. Diagram of the flow.

Visual direction: calm, trustworthy, high contrast; one accent color; generous whitespace; money amounts in tabular numerals; status chips with icon + text (never color alone).

## 11. Acceptance criteria (MVP done)

- J1, J2, J3 run end to end in the deployed sandbox demo with real PayPal sandbox objects and live Gemini calls.
- J2 on a real, unchanged item reaches the `NO_NEW_DAMAGE` verdict live (photographed under different lighting/angle from check-out) and ends in a voided authorization.
- Timeline shows PayPal IDs and at least one verified webhook per settled rental.
- No settlement possible without both approvals (tested).
- Duplicate Settle clicks produce one set of PayPal ops (tested).
- Synthetic/hybrid images display a disclosure chip everywhere.
- README setup reproduces the app on a clean machine.

## 12. Success metrics

Product (hypotheses, measured only in the demo/eval context):
- Eval (headline): clean-return accuracy, false-charge rate and clean-verdict precision on no-change, pre-existing-only and full clean-return cases, reported separately for real vs hybrid vs synthetic images.
- Eval: new-damage recall on clearly visible damage.
- Inspection latency p50/p95; cost per inspection.
- Demo: J1 completes in under 3 minutes of wall-clock interaction.

Hackathon: all submission items complete by Nov 9; video ≤ 2:55.
