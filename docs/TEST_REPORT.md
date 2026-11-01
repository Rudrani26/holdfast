# Test report (T-081)

Run on **Nov 1, 2026**. Every result below was observed in this run, unless a row says otherwise.

## Summary

| Area | Result |
| --- | --- |
| Unit tests (`npm test`) | **653 / 653 passed** (42 files) |
| Typecheck, lint | Passed |
| Fresh-clone install, checks, tests, build | **Passed** in a clean folder |
| Integration: Firestore repo contract and photo pipeline | **12 / 12 passed** (after a config fix, below) |
| Integration: live Gemini (3 tests) | **3 / 3 passed**, 19 live calls (cap 38) |
| Integration: live PayPal settlement test | Not run; the J1–J3 journeys cover live settlement |
| J1–J3 on the deployed app | Passed in today's scripted run; all 13 PayPal checks match |
| Deployed smoke test | Passed (8 routes and the webhook guard) |

## 1. Unit tests, typecheck, lint

```text
npm run typecheck   → passed
npm run lint        → passed
npm test            → Test Files 42 passed (42) · Tests 653 passed (653)
```

## 2. Fresh-clone test

The fresh clone holds the files a clone would get from this commit: every tracked or committable file, without gitignored ones. That is 295 files, copied into an empty folder with no `.env.local` and no `node_modules`.

```text
npm ci              → added 781 packages
npm run typecheck   → passed
npm run lint        → passed
npm test            → Test Files 42 passed (42) · Tests 653 passed (653)
npm run build       → succeeded
```

**Not covered:** the README's cloud setup (PayPal Sandbox app, GCP project, seed). Those steps need a separate account and were not repeated here.

## 3. Integration tests (opt-in, real services)

### Firestore and Cloud Storage

```text
FIRESTORE_INTEGRATION=1 npm run test:integration -- src/server/repo src/server/photos
→ Test Files 2 passed (2) · Tests 12 passed (12)
```

**Defect found and fixed.** The first run failed one test with `Unknown angle "front"`. The two files ran in parallel, and each wipes the shared `it_` collections, so one file deleted the other's test item. Run one after the other, both passed. The fix is `fileParallelism: false` in `vitest.integration.config.ts`; with it, both files pass in a normal run.

### Live Gemini on Vertex AI (`gemini-3.7-flash`, real owner photos)

Each test's call cap is enforced in code through the daily usage counter.

| Test | Cap | Live calls | Result |
| --- | --- | --- | --- |
| `inspect`: baseline on one photo per item, then replay | 6 | 3 | Passed. Replay returned the recorded result with **0** calls. |
| `return`: baseline, return and priced report | 8 | 4 | Passed. See the cases below. |
| `cleanReturn`: unchanged item, six angles, different light | 24 | 12 | Passed. Verdict `NO_NEW_DAMAGE`, $0 proposed. |

`return` cases:
- **Headphones, both ear cushions removed:** `DAMAGE_PROPOSED`, with 2 × "Ear cushion replacement" at $38.00 from the price list, $76.00 in total. A pre-existing headband tear was matched to the baseline and not charged.
- **Backpack, unchanged, warm light against daylight:** `NO_NEW_DAMAGE`, $0.

Cost: 19 calls, which is cents at the rates in `eval/reports/eval-20261030050110.md` (24 calls ≈ $0.08).

### Live PayPal settlement

Not run. `settlement.integration.test.ts` needs a rental that a sandbox buyer has approved in the PayPal popup, and only the owner can do that approval. Live settlement is covered end to end by J1–J3 below.

## 4. Journeys on the deployed app

J1–J3 ran end to end on the deployed Cloud Run service on Nov 1, 2026. The run used the scripted browser capture (`video/capture/run.ts`), with the owner approving each PayPal popup as the sandbox buyer.

- **App code:** no file under `src/`, `scripts/`, `eval/`, `package.json`, `next.config.ts` or `Dockerfile` has changed since that run.
- **PayPal checks:** every PayPal ID was re-checked with read-only Sandbox API calls (`video/truth-audit.md`).

| Journey | What happened | PayPal now |
| --- | --- | --- |
| **J1** damage | $200 hold. Gemini proposed two missing ear cushions; staff confirmed; the renter accepted. | Capture `3AK885510K404981V` `COMPLETED` $76.00; authorization `22X40097DE206973U` `VOIDED` |
| **J2** clean return | Backpack in different light. Live verdict `NO_NEW_DAMAGE`, $0. | Authorization `7CL065587Y652090U` `VOIDED` |
| **J3** contest | The renter contested a proposed grille line; staff excluded it; $0 settled. | Authorization `3RE78577G3579781P` `VOIDED` |

All 7 "PayPal-confirmed" badges map to real, signature-verified webhook events for the right IDs.

## 5. Deployed smoke test

Run against `https://holdfast-806240887939.us-central1.run.app`.

| Request | Expected | Got |
| --- | --- | --- |
| `GET /` | 200 | 200 |
| `GET /how-it-works` | 200 | 200 |
| `GET /rent/headphones` | 200 | 200 |
| `GET /staff` without a session | Redirect to login | 307 → `/staff/login?next=%2Fstaff` |
| `GET /staff/login` | 200 | 200 |
| `GET /r/invalid-token` | Error page, no data | 200, "…link is invalid or has expired. Ask the shop for a new one." |
| `GET /api/rentals` without a session | 401 | 401 |
| `GET /does-not-exist` | 404 | 404 |
| `POST /api/webhooks/paypal` with no signature | Rejected | 400 |

## 6. Known gaps

- The README's cloud setup has not been followed by a second person on a second machine.
- The deployed revision ID was not re-read for this report, because the gcloud CLI session had expired. The source has not changed since the J1–J3 run, which was made against the deployed service.
- The evaluation set is small (8 real cases, one false charge). See the README for caveats.
