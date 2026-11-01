# Shot list — Holdfast demo video (V1)

Source: `docs/DEMO_PLAN.md` §3, adjusted to the owner's decisions and the V0 rehearsal (`video/REHEARSAL.md`). Target **2:54**, hard limit 2:55.

**Recording setup:** hosted app `https://holdfast-806240887939.us-central1.run.app`, real PayPal Sandbox, live Gemini.
- **Desktop:** a 1536×864 CSS viewport at 125% zoom, which fills 1920×1080.
- **Renter phone:** 390×844 with touch emulation, composited right of the staff view (the `s06-phone` layout).

**Keyframe stills:** `video/out/stills/*.jpg` (gitignored), built by `npx tsx video/build/stills.ts raw|compose`.

## Changes from DEMO_PLAN.md (owner decisions and real results)

| DEMO_PLAN said | Video does | Why |
| --- | --- | --- |
| J1 finds one missing ear cushion, "$38" | Narrate the live result. In rehearsal: **2 missing parts × $38 = $76**, "$124 voided" | Real result; both ear cups are open in the owner's photo |
| J3 uses an "AI-edited photo (synthetic damage)" headband mark, STAIN $25 | **Real photos only.** Speaker set c008. In the V2 capture, Gemini proposed a "Small grille dent" ($15, from the list); in rehearsal it was a "scratch" ($10). The check-out photo already shows the creases. The renter contests, staff drop it, the hold is voided | Owner decision: no image-edit model. The contest is genuine |
| "Synthetic damage" end-card note and chips | Removed. The end card says "Real photos only" | No synthetic images exist |
| Owner records narration | AI voice (Google Cloud TTS), disclosed on the end card | DEMO_VIDEO_PRODUCTION §6 |

Narration below is a draft. Amounts and findings are filled in from the actual capture-day run before V3, never from this file.

## Scenes

| # | Time | Scene | Actions (exact) | Screen / viewport | On-screen proof (§0 point) | Narration (draft) | Caption / lower-third | Still |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | Title | — | Card `title.html` | — | "Deposits are where rental shops and renters stop trusting each other. Holdfast fixes that with evidence, consent and PayPal." | — | `c01-title` |
| 2 | 0:08–0:14 | Storefront | Load `/`; let the hero's settlement tape play once; scroll to the item grid; click **Headphones** | Desktop | Sandbox banner; PayPal and Gemini tags | (continues) | "Kestrel Gear Rentals, a demo shop · The renter books; the deposit goes on PayPal" | `s01-storefront` |
| 3 | 0:14–0:30 | Book + PayPal hold | Type name "Alex Rivera" and email `alex.rivera@example.com` at typing speed → **Continue to deposit** → PayPal button (clip `j1-form`, a retake on an unpaid draft) → **labelled hard cut** to J1's real PayPal "Pay with" page → approve → J1 confirmation (clip `j1-book-approve`, taskbar strip masked) | Desktop | **1:** authorization ID, status `CREATED`, expiry | "The renter authorizes a $200 deposit. It's a PayPal authorization: a hold, not a charge." | Callouts "A hold, not a charge", "Real PayPal authorization ID and expiry" | `s02-authorized` (taken after settlement, so it shows VOIDED; the capture shows CREATED) |
| 4 | 0:30–0:46 | Check-out + baseline | Staff page: 6 uploads (Real photo chips) → **Run AI baseline** (wait labelled "cut N s") → renter phone: **I agree these photos show the item's condition** | Desktop + phone | Existing marks listed (headband wear) | "At pickup, staff photograph six angles. Gemini notes the wear that's already there, and the renter confirms it." | "Baseline: existing wear, recorded" | — |
| 5 | 0:46–1:10 | Return + live AI | 6 return uploads → **Run AI return inspection** (elapsed counter visible, wait cut and labelled) → report appears → expand **Pre-existing (not charged)** | Desktop | **2:** findings with Gemini tag + confidence; existing wear "already recorded at check-out" | "On return, Gemini compares each pair live. It flags what's new, two missing parts, and leaves the old headband wear alone." | "Live comparison of check-out and return" | `s03-j1-report` |
| 6 | 1:10–1:20 | Price + staff gate | Hover the price chip → **Confirm $76.00 (2 lines)** | Desktop | **3:** "$38.00 from Kestrel's price list, not the AI" | "The AI never sets a price. Each line comes from the shop's own list, and staff confirm it." | Callout "Price from the shop's list, not the AI" | `s03-j1-report` |
| 7 | 1:20–1:30 | Renter consents | Phone: scroll the evidence → **Accept** on each line → **Send my decision** | Split: staff + phone | **4:** renter Accept | "The renter sees the same evidence and accepts." | "Both sides consent" | `s06-phone` (layout; final shows the decision screen) |
| 8 | 1:30–1:48 | Settle with proof | **Settle $76.00 with PayPal** → receipt → wait for the **PayPal-confirmed** badges (6–33 s, labelled cut) | Desktop | **5:** capture ID, `COMPLETED`, void `VOIDED`, webhook badges | "$76 captured. The remaining $124 authorization is voided, and here are PayPal's own statuses, confirmed by a signed webhook." | Callouts "Exact settlement", "PayPal's own statuses…" | `s05-j1-receipt` |
| 9 | 1:48–1:52 | Chapter | — | Card `chapter.html` | — | — | "Rental 2 of 3 · A clean return" | `c02-chapter` |
| 10 | 1:52–2:16 | Clean return | Backpack (pre-booked off camera, labelled "booked earlier, same flow"): return uploads → **Run AI return inspection** → "No new damage detected" panel → **Confirm $0** → phone **Looks right** → **Settle** → receipt | Desktop + phone | **6:** clean verdict on real photos, existing marks matched → `VOIDED`, PayPal-confirmed | "Most rentals come back fine, and a fair system has to say so. Different light, a different day: none of it is damage. Holdfast says 'no new damage', and PayPal voids the whole authorization." | "Clean return, real photos" | `s07-j2-receipt` |
| 11 | 2:16–2:34 | Contest | Speaker (pre-booked): report line "Small grille dent" ($15) → phone **Contest** with reason → staff sees the reason, unticks **Include in deduction** → **Confirm $0** → **Looks right** → settled, voided | Split | **7:** contest → line dropped → void | "And if the renter disagrees, they contest it. Staff see the reason next to the evidence, drop the line, and the hold is voided." | "Disagreement has a path" | `s08-j3-contest` |
| 12 | 2:34–2:46 | Guardrails + eval | `/how-it-works`: scroll lanes → eval card → rules | Desktop | **8:** eval with sample size and source label | "AI proposes, people decide, the price list prices, PayPal settles. Measured on our own real photos, with the sample size on screen." | Callout "Real photos, sample size stated" | `s09-eval` |
| 13 | 2:46–2:54 | End card | — | Card `end.html` | Disclosures; repo URL | "Holdfast: fair deposits, settled exactly." | — | `c03-end` |

Booking and check-out for J2 and J3 are pre-run off camera, with the same real flow, to stay under 2:55. Their IDs still go to `capture-log.json`.

## Fixes for V2 capture (from V0 and V1 review)

1. Wait for the report heading or verdict text after an inspection; don't rely on network idle. The rehearsal snapped the page before `router.refresh()` landed.
2. After every navigation, wait for the page content, not the skeleton.
3. Expand **Pre-existing (not charged)** before holding on the J1 report (proof point 2).
4. PayPal asks for the buyer password every time. The owner types it in the popup, and the edit hard-cuts from "popup opens" to "approved".
5. The staff list still shows one stray "Awaiting payment" daypack from the first rehearsal attempt. Avoid the list view, or cancel that draft before capture (owner's call).
6. The renter link box shows a truncated token prefix. It's harmless (no signature is visible), but don't hold on it.
