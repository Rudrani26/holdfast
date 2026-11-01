# TASKS.md — Holdfast implementation plan

Rules for every task:
- Do exactly one task per session unless the owner says otherwise; then deliver a milestone report (files, what works, tests run, risks, dependencies, cost-relevant actions, suggested commit message, next task) and **stop**.
- No Git write operations, ever. Suggest a commit message; the owner commits.
- No cloud resource creation, API enablement, deployment or billing change without explicit owner approval for that action.
- Before reporting done, run: `npm run typecheck && npm run lint && npm test` plus the task's own commands. Report real results.

Priorities: **P0** = required for the demo; **P1** = strong polish; **P2** = only if time remains.

Owner-only steps are marked **[OWNER]**.

---

## Milestone 0 — Feasibility (must finish before M1)

### T-001 — Scaffold the project (P0)
- **Depends:** none. **Files:** repo root, `package.json`, `tsconfig.json`, `.eslintrc*`/`eslint.config.*`, `vitest.config.ts`, `.env.example`, `.gitignore`, `LICENSE`, `src/app/page.tsx`, `src/lib/env.ts`.
- **Instructions:**
  1. Create a Next.js App Router project with TypeScript, Tailwind, ESLint, `src/` directory, npm, in the current directory. Set `"strict": true`.
  2. Add Vitest; add scripts: `typecheck`, `lint`, `test`, `test:integration` (runs `vitest --config vitest.integration.config.ts`, empty for now), `seed`, `eval`, `eval:generate`.
  3. Add `tsx`, `zod`, `dotenv` (dev/runtime as appropriate). Initialize shadcn/ui (button, card, input, badge, dialog, tabs, toast/sonner, table, skeleton).
  4. `LICENSE`: MIT, with the owner's name placeholder `<OWNER NAME>` for the owner to fill.
  5. `.gitignore` must include `.env*` except `.env.example`, `spike/results/`, `eval/reports/*.json`, `.next`, `node_modules`.
  6. `.env.example` with every variable from `docs/ARCHITECTURE.md` §10, placeholder values only.
  7. `src/lib/env.ts`: Zod-validated env loader; throws if `PAYPAL_ENV !== "sandbox"`.
- **Acceptance:** `npm run dev` serves a placeholder page; env validation fails loudly when `PAYPAL_ENV=production`.
- **Tests:** `npm run typecheck && npm run lint && npm test` → all pass; a unit test for env validation (sandbox ok, production throws).
- **Done when:** report lists every dependency with version and license.

### T-002 — Spike PayPal client (P0)
- **Depends:** T-001. **Files:** `spike/lib/paypal.ts`, `spike/lib/record.ts`, `spike/README.md`.
- **Instructions:** minimal `fetch`-based client: `getToken()` (cached), `pp(method, path, body?, { requestId?, mockCode? })` returning `{ status, headers, json }`. `record(name, data)` writes `spike/results/<name>.json` with `access_token`, `Authorization` and secrets redacted. Read env from `.env.local` via dotenv.
- **Acceptance:** `npx tsx spike/00-token.ts` prints token expiry only and writes `spike/results/E0-token.json` without the token.
- **Tests:** unit test for the redaction function.
- **[OWNER]** fills `.env.local` with sandbox Client ID/Secret before running.

### T-003 — Spike webhook listener (P0)
- **Depends:** T-002. **Files:** `spike/webhook-server.ts`, `spike/README.md` (tunnel instructions).
- **Instructions:** Node `http` server on port 8787: captures raw body + headers for `POST /webhook`, writes `spike/results/webhook-<eventId>.json`, then calls `verify-webhook-signature` and records the result. Document running `cloudflared tunnel --url http://localhost:8787` (free quick tunnel, no account) — install instructions only; the owner installs it.
- **Acceptance:** server runs; a manual `curl` post is recorded (verification will fail for fake data — expected).
- **[OWNER]** starts the tunnel, registers `https://<tunnel>/webhook` in the sandbox app with the events in `PAYPAL_INTEGRATION.md` §7, puts the webhook ID in `.env.local`.

### T-004 — Spike experiments E1–E4 (P0)
- **Depends:** T-002, T-003. **Files:** `spike/01-create-order.ts`, `spike/02-authorize.ts`, `spike/03-capture.ts`, `spike/04-get-auth.ts`, `spike/05-void.ts`, `spike/06-refund.ts`, `spike/run-guide.md`.
- **Instructions:** scripts take CLI args (`--exp E1 --amount 38.00 --final false` etc.) and record every response. `01` prints the approval link and stops. `run-guide.md` lists the exact command sequence for E1–E4 from `PAYPAL_INTEGRATION.md` §3, including the **[OWNER]** manual approval step and the E8 buyer-view screenshot step.
- **Acceptance:** owner can run E1–E4 by following `run-guide.md` alone.
- **Tests:** unit tests for argument parsing and body builders (no network).

### T-005 — Spike idempotency + negative test, E5–E6 (P0)
- **Depends:** T-004. **Files:** `spike/07-idempotency.ts`, `spike/08-negative.ts`.
- **Instructions:** E5 repeats a capture with the same `PayPal-Request-Id` and compares capture IDs. E6 sends `PayPal-Mock-Response` with an error code taken from PayPal's documented capture errors (look it up; cite the URL in the script header).
- **Acceptance:** results recorded; script prints PASS/FAIL per check with the evidence.

### T-006 — Spike results report (P0)
- **Depends:** owner has run T-004/T-005 and E7/E8. **Files:** `spike/RESULTS.md`, update `docs/PAYPAL_INTEGRATION.md` (status labels → VERIFIED (sandbox) with links; §9 wording table).
- **Instructions:** summarize each experiment: request, status codes, PayPal statuses, errors, webhook verification results, buyer-view observations (from owner screenshots/notes). Apply the decision rule (§3) and recommend `SETTLEMENT_MODE`. List anything still uncertain.
- **Acceptance:** recommendation is traceable to recorded JSON. **STOP for owner go/no-go.**

### T-007 — Vision feasibility check and model pin (P0)
- **Depends:** T-001; **[OWNER]** places 5 image pairs in `eval/spike-pairs/<n>/before.jpg|after.jpg` with a one-line `truth.txt` each (≥ 2 real, ≥ 2 real no-change pairs with a lighting or angle difference). **[OWNER]** has run `gcloud auth application-default login` and approved enabling the Vertex AI API on the project (see `DEPLOYMENT.md` §3).
- **Files:** `spike/vision-check.ts`, `src/server/ai/schemas.ts` (Zod from `AI_PIPELINE.md` §5), `src/server/ai/prompts.ts`.
- **Instructions:** run the RETURN prompt on each pair with 2 candidate Gemini Flash model IDs (list available models first; choose from those offered on Vertex in `VERTEX_LOCATION`). Record validity, findings vs truth, latency, token usage. Hard cap: 20 model calls total.
- **Acceptance:** table in `spike/RESULTS.md` (vision section) with a recommended `GEMINI_MODEL`; ≥ 4/5 correct, **both no-change pairs return no new findings**, and 100% schema-valid after one retry — or a clear failure analysis. A model that flags damage on an unchanged item fails this gate.
- **STOP for go/no-go (with T-006).**

---

## Milestone 1 — Foundations

### T-010 — Domain types and money (P0)
- **Depends:** T-006 decision. **Files:** `src/domain/types.ts`, `src/lib/money.ts`, tests.
- **Instructions:** types/enums from `ARCHITECTURE.md` §3; `toPayPalValue(cents)`, `fromPayPalValue(str)`; reject non-integer cents.
- **Tests:** money round-trip, edge cases (0, 1, 20000, invalid strings).

### T-011 — Pricer (P0)
- **Files:** `src/domain/pricer.ts`, tests.
- **Instructions:** per `AI_PIPELINE.md` §7 (included/excluded, unpriced, staff override with reason, cap at deposit).
- **Tests:** ≥ 10 cases incl. cap, unpriced, override, zero lines.

### T-012 — Rental state machine (P0)
- **Files:** `src/domain/rentalMachine.ts`, tests.
- **Instructions:** transitions and guards from `ARCHITECTURE.md` §4; function `transition(rental, event) → rental | DomainError`.
- **Tests:** every allowed transition; key forbidden ones (settle without renter acceptance, settle twice, contest round 3).

### T-013 — Settlement planner and copy (P0)
- **Files:** `src/domain/settlementPlanner.ts`, `src/lib/settlementCopy.ts`, tests.
- **Instructions:** `plan(mode, depositCents, deductionCents) → Op[]` per `PAYPAL_INTEGRATION.md` §3 table; copy rules per §9 updated by T-006.
- **Tests:** each mode × D ∈ {0, 3800, 20000}; copy never contains "refund" for void, never "released" unless the mode's evidence flag is true.

### T-014 — Repository layer (P0)
- **Files:** `src/server/repo/types.ts`, `src/server/repo/memory.ts`, `src/server/repo/firestore.ts`, tests (memory only).
- **Instructions:** `Repo` interface for items, priceLists, rentals (+ subcollections), settlements, webhookEvents, aiUsage; `runTransaction` abstraction used for state changes and settlement locks; collection prefix support.
- **Tests:** memory repo contract tests; Firestore repo covered by integration test (opt-in).

### T-015 — Seed data (P0)
- **Depends:** T-014; **[OWNER]** approves Firestore database creation (`DEPLOYMENT.md` §4).
- **Files:** `data/catalog.json`, `data/priceList.json`, `scripts/seed.ts`.
- **Instructions:** 3 items (placeholders the owner edits: e.g. headphones, backpack, insulated bottle), 6 angles each, deposit 20000 for the demo item, price list from `AI_PIPELINE.md` §7. Item hero images uploaded to GCS (`items/<id>.jpg`) from `data/images/` supplied by the owner.
- **Acceptance:** `npm run seed` is idempotent (re-run does not duplicate).

### T-016 — Auth: staff session and renter links (P0)
- **Files:** `src/server/auth.ts`, `src/middleware.ts`, `src/app/staff/login/page.tsx`, `src/app/api/staff/login/route.ts`, `src/app/api/staff/logout/route.ts`, tests.
- **Instructions:** per `ARCHITECTURE.md` §6, constant-time compare, rate limit.
- **Tests:** token sign/verify, expiry, tamper detection, wrong rental.

---

## Milestone 2 — Payments in the app

### T-020 — PayPal server module (P0)
- **Files:** `src/server/paypal/{auth,client,orders,payments,errors,webhooks}.ts`, tests.
- **Instructions:** port spike learnings; typed Zod-validated responses; `PayPal-Request-Id` always set; error mapping per `PAYPAL_INTEGRATION.md` §10 using only issue codes observed or documented.
- **Tests:** unit tests with recorded (redacted) spike responses as fixtures — label fixtures clearly as recorded sandbox responses.

### T-021 — Booking flow with deposit authorization (P0)
- **Depends:** T-015, T-020. **Files:** `src/app/page.tsx` (storefront), `src/app/rent/[itemId]/page.tsx`, `src/app/rent/confirmed/[rentalId]/page.tsx`, `src/components/PayPalDepositButton.tsx`, API routes `POST /api/rentals`, `POST /api/paypal/orders`, `POST /api/paypal/orders/[orderId]/authorize`.
- **Instructions:** load JS SDK v5 with `intent=authorize`; server creates order for the item's deposit (client never sends an amount); authorize on approve; write events `ORDER_CREATED`, `DEPOSIT_AUTHORIZED`.
- **Acceptance:** **[OWNER]** completes a booking with the sandbox buyer; rental shows `AUTHORIZED` with authorization ID and expiry.
- **Tests:** route validation tests (memory repo, PayPal module stubbed in unit tests only).

### T-022 — Settlement executor (P0)
- **Files:** `src/server/settlement.ts`, `src/app/api/rentals/[id]/settle/route.ts`, `src/app/api/rentals/[id]/cancel/route.ts`, tests.
- **Instructions:** plan → for each op: transactional lock `settlements/{key}` → call PayPal → record → event; reconciliation on unknown outcome (`PAYPAL_INTEGRATION.md` §6); final rental status `SETTLED` or `SETTLEMENT_FAILED`.
- **Tests:** concurrency test (two simultaneous settle calls → one op set); retry after simulated timeout reconciles via GET; failure path.
- **Integration (opt-in):** settle a real sandbox authorization in the chosen mode.

### T-023 — Webhook route (P0)
- **Files:** `src/app/api/webhooks/paypal/route.ts`, tests.
- **Instructions:** per `PAYPAL_INTEGRATION.md` §7; raw body; dedupe; map to rental; `PAYPAL_WEBHOOK_VERIFIED` event.
- **Tests:** unverified → 400 and no state change; duplicate event → processed once.

### T-024 — Timeline component and API (P0)
- **Files:** `src/components/Timeline.tsx`, used in staff workspace and renter receipt.
- **Instructions:** chronological events with actor icon, summary, PayPal IDs (monospace, copyable), verified badges.
- **Acceptance:** visible for any rental; no secrets rendered.

---

## Milestone 3 — Photos and AI inspection

### T-030 — Photo upload and storage (P0)
- **Depends:** **[OWNER]** approved bucket creation. **Files:** `src/server/storage.ts`, `src/app/api/rentals/[id]/photos/route.ts`, tests.
- **Instructions:** multipart, ≤ 10 MB, jpeg/png/heic (convert to jpeg), `sharp` pipeline (`ARCHITECTURE.md` §7), provenance required, signed read URLs.
- **Tests:** normalization (EXIF stripped, size), invalid types rejected.

### T-031 — Guided capture UI (P0)
- **Files:** `src/app/staff/rentals/[id]/page.tsx` (workspace shell + stepper), `src/components/capture/*`.
- **Instructions:** 6 angle tiles with hint text, `<input type="file" accept="image/*" capture="environment">`, upload progress, retake, provenance select (default "Real photo"), disclosure chips.
- **Acceptance:** works on a phone browser over the tunnel or deployed URL.

### T-032 — Gemini client and baseline inspection (P0)
- **Depends:** T-007 model pin. **Files:** `src/server/ai/{client,inspect,replay,usage}.ts`, `src/app/api/rentals/[id]/inspections/route.ts`.
- **Instructions:** per `AI_PIPELINE.md` §4–6, §9; parallel angles (concurrency 3); store raw responses in GCS; daily cap; replay store write on live success.
- **Tests:** schema validation, retry-once logic, replay key derivation, cap enforcement (all with stubbed client).

### T-033 — Return inspection and line items (P0)
- **Files:** extend `src/server/ai/inspect.ts`; `src/server/lineItems.ts`.
- **Instructions:** RETURN prompt with baseline marks; thresholds → findings groups; `src/server/ai/verdict.ts` (pure) computes the inspection verdict per `AI_PIPELINE.md` §6.1; pricer → line items; event `AI_REPORT_READY` with verdict and counts; measure latency and tokens.
- **Tests:** verdict unit tests for all four verdicts, including: one unusable angle → `INCOMPLETE` even if no findings; a 0.55-confidence new finding → not `NO_NEW_DAMAGE`; pre-existing-only findings → `NO_NEW_DAMAGE` when confidences pass.
- **Acceptance:** live run on a real pair yields a report in ≤ 60 s; live run on a real unchanged item (6 angles) yields `NO_NEW_DAMAGE` or a documented reason why not.

### T-034 — Report and staff review UI (P0)
- **Files:** `src/components/report/*`.
- **Instructions:** before/after side by side, finding boxes drawn from normalized coordinates over the return image, finding cards, groups (Proposed / Needs your eyes / Pre-existing / Low-confidence), include toggles, severity change re-prices, manual line from price list, override with reason, totals panel, Confirm → renter link.
- **Acceptance:** J1, J2 (clean-verdict panel per `PRD.md` §10 S6) and J4 behaviours from `PRD.md` §5.

### T-035 — Replay mode wiring (P1)
- **Files:** UI badge, env switch.
- **Acceptance:** with `AI_MODE=replay`, a previously live-run pair returns identical findings with the badge; an unseen pair fails clearly.

---

## Milestone 4 — Renter consent and contest

### T-040 — Renter page: baseline acknowledgment (P0)
- **Files:** `src/app/r/[token]/page.tsx`, `src/app/api/r/[token]/*`.
- **Acceptance:** renter sees baseline photos + marks, acknowledges; rental → `CHECKED_OUT`.

### T-041 — Renter decision (P0)
- **Instructions:** per-line accept/contest with comment; optional contest photo upload; explanations generated from finding evidence + price-list label (deterministic template; no extra AI call in P0).
- **Clean return:** with zero included lines, the page shows the "No new damage detected" state and one "Looks right" button, recorded as the renter decision.
- **Acceptance:** accept-all (or "Looks right" on a clean return) → `READY_TO_SETTLE`; any contest → `CONTESTED`; a $0 settlement plans a single void.

### T-042 — Contest loop (P0) and AI re-check (P1)
- **P0:** staff see contest comments/photos beside the finding; revise; re-confirm → new round; max 2 rounds.
- **P1:** `RECHECK` inspection including the renter's photo; shown as advisory to staff.

### T-043 — Receipt (P0)
- **Acceptance:** after settlement both staff and renter see amounts, PayPal IDs, statuses, verified badges, wording per evidence.

---

## Milestone 5 — Evaluation dataset and runner

### T-050 — Eval structure and manifest validation (P0)
- **Files:** `eval/manifest.schema.ts`, `eval/README.md`, `scripts/eval-validate.ts`.
- **Acceptance:** manifest validates; every case has provenance; WEB cases have license fields.

### T-051 — Hybrid/synthetic generation script (P0) — **SKIPPED by owner decision (2026-10-28): no image-edit model.** The eval set is REAL (plus openly licensed WEB) only; HYBRID/SYNTHETIC rows in `AI_PIPELINE.md` §10.2 are not pursued.
- **Depends:** **[OWNER]** approves image-edit model usage (credits). **Files:** `scripts/eval-generate.ts`.
- **Instructions:** input: real `before.jpg` + damage spec (type, severity, location words); call the pinned image-edit model; save `after.jpg`, provenance (model, prompt, date); hard cap 60 images per run total; `humanVerified:false` until the owner reviews.
- **Acceptance:** generates N requested images; prints estimated cost; never exceeds cap.

### T-052 — Eval runner and report (P0)
- **Files:** `scripts/eval-run.ts`.
- **Instructions:** run cases (`--mode live|replay`, `--source REAL|HYBRID|...`), compute metrics in `AI_PIPELINE.md` §10.4 with the clean-return headline metrics first (including per-subtype false-charge breakdown and inspection-level verdicts for FULL_CLEAN_RETURN), write `eval/reports/<ts>.md|json`, first paragraph states synthetic-data caveat. Cap calls with `--max-calls`.
- **Acceptance:** report produced with per-source tables.

---

## Milestone 6 — Polish and trust

### T-060 — Storefront, trust page, visual design (P0)
- **Files:** `src/app/page.tsx`, `src/app/how-it-works/page.tsx`, theme tokens.
- **Acceptance:** PRD §10 S1, S9; sandbox banner; consistent typography and spacing.

### T-061 — States, accessibility, mobile (P0)
- **Acceptance:** loading/empty/error/retry for every async action; Lighthouse accessibility ≥ 90 on S2, S6, S7; usable at 390 px.

### T-062 — Demo reset and guard rails (P1)
- **Files:** `scripts/demo-reset.ts`.
- **Instructions:** archive demo rentals (prefix-scoped), never touch other data; re-seed.

### T-063 — Secret-leak check (P0)
- **Files:** `scripts/check-bundle-secrets.ts`.
- **Instructions:** after `npm run build`, scan `.next/static` for secret env values and known secret patterns.
- **Acceptance:** passes; included in the pre-deploy checklist.

---

## Milestone 7 — Deployment (owner approval required at each step)

### T-070 — Container and deploy script (P0)
- **Files:** `Dockerfile` (Next.js standalone output), `.dockerignore`, `scripts/deploy.md` (commands only).
- **Instructions:** prepare commands from `DEPLOYMENT.md` §6. **Do not run them.** The owner runs or explicitly authorizes each.
- **Acceptance:** `docker build` succeeds locally if Docker is installed (optional) or `npm run build` succeeds.

### T-071 — Post-deploy configuration (P0)
- **[OWNER]** registers the Cloud Run webhook URL in the sandbox app, updates `PAYPAL_WEBHOOK_ID` secret, runs smoke test from `DEPLOYMENT.md` §9.

---

## Milestone 8 — Documentation and verification

### T-080 — README (P0)
- **Contents:** pitch, screenshots, architecture diagram, how AI and PayPal are used (and what the agent toolkit does not cover), setup from zero (sandbox app, GCP project, env, seed, run), demo walkthrough, settlement mode and its evidence, AI disclosure (synthetic images, replay mode), eval summary with caveats, security notes, limitations, license.
- **Acceptance:** owner follows it on a clean machine (T-081).

### T-081 — Full regression and fresh-clone test (P0)
- **Instructions:** run all unit tests, opt-in integration tests (with approval), J1–J3 manually on the deployed app; produce `docs/TEST_REPORT.md` with real results.

### T-082 — Submission assets (P0)
- Screenshots, architecture image, Devpost text draft (`docs/DEVPOST_DRAFT.md`). The owner submits.

---

## Milestone 9 — Stretch (P2, only after freeze review)

T-090 difference heatmap · T-091 duplicate-finding hints · T-092 auto-settle flag · T-093 dispute webhook view · T-094 JS SDK v6.

---

## Dependency order (summary)

T-001 → T-002 → T-003 → T-004 → T-005 → T-006 ┐
T-001 → T-007 ───────────────────────────────┴→ GO/NO-GO
→ T-010 → T-011 → T-012 → T-013 → T-014 → T-015 → T-016
→ T-020 → T-021 → T-022 → T-023 → T-024
→ T-030 → T-031 → T-032 → T-033 → T-034 (→ T-035)
→ T-040 → T-041 → T-042 → T-043
→ T-050 → T-051 → T-052 (can run in parallel with M4 once T-032 exists)
→ T-060 → T-061 → T-063 (→ T-062)
→ T-070 → T-071 → T-080 → T-081 → T-082

## Schedule mapping

| Date | Tasks | Go/no-go |
| --- | --- | --- |
| Tue Oct 27 | T-001–T-004 | Token + first authorization |
| Wed Oct 28 | T-005–T-007 | **Core flow + vision go/no-go** |
| Thu Oct 29 | T-010–T-016 | Domain tests green; seed works |
| Fri Oct 30 | T-020, T-021; owner shoots real eval photos | Booking creates a real authorization |
| Sat Oct 31 | T-022–T-024, T-030 | Settlement executor passes concurrency test |
| Sun Nov 1 | T-031–T-033 | Live return inspection on a real pair |
| Mon Nov 2 | T-034, T-040, T-041 | **J1 end to end in sandbox** |
| Tue Nov 3 | T-042, T-043, T-050, T-051 | J3 contest works; hybrid images generated |
| Wed Nov 4 | T-052, threshold tuning, T-035 | Eval report produced |
| Thu Nov 5 | T-060, T-061, T-063 | Accessibility ≥ 90; no secrets in bundle |
| Fri Nov 6 | **Feature freeze**; T-070, T-071 (approved deploy) | Deployed smoke test passes |
| Sat Nov 7 | T-080, T-081 | Fresh-clone install works |
| Sun Nov 8 | Demo recording (`DEMO_PLAN.md`) | Video ≤ 2:55 |
| Mon Nov 9 | T-082; owner submits early | Submission saved |
| Tue Nov 10–Wed Nov 11 | Contingency, rule re-check | Final confirmation |
| Thu Nov 12 | Deadline noon PST — no changes | — |
