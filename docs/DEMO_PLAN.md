# DEMO_PLAN.md — Under-three-minute demonstration

Target length **2:45–2:55**. Judges may stop at 3:00 and may score from the video alone, so every claim must be visible on screen.

## 1. Emotional hook

"A deposit is a promise both sides stop trusting the moment something comes back different." Show the tension in 10 seconds: a renter worried about an unfair charge, a shop owner worried about eating the cost. Holdfast's answer: show the evidence, let the renter agree, settle only that.

## 2. What judges must see (mapped to criteria)

| Criterion | Proof in the video |
| --- | --- |
| Technological Implementation | Real sandbox authorization ID; live Gemini call; capture/void (or capture/refund) with PayPal IDs and statuses; verified-webhook badges; idempotent Settle |
| Design | Clean two-sided flow; phone-sized renter page; clear money states |
| Potential Impact | Generalizes to any deposit; fairness for both sides; one-line market framing (no invented statistics) |
| Innovation | Evidence → consent → exact settlement loop; AI proposes, people decide, price list prices |
| Presentation | Tight narrative, captions, no dead time, guardrails stated plainly |

## 3. Storyboard

| Time | Screen | Narration (draft) | Proves |
| --- | --- | --- | --- |
| 0:00–0:10 | Title card → storefront with "Sandbox demo" banner | "Deposits are where rental shops and renters stop trusting each other. Holdfast fixes that with evidence, consent and PayPal." | Hook |
| 0:10–0:26 | Renter books headphones; PayPal sandbox popup; confirmation with authorization ID + expiry | "The renter authorizes a $200 deposit. It's a PayPal authorization — a hold, not a charge." | Real Orders v2 `AUTHORIZE` |
| 0:26–0:42 | Staff phone: 6 guided angles; baseline finds an existing scuff; renter link → "I agree" | "At pickup, staff photograph six angles. Gemini notes what's already worn, and the renter confirms it." | Baseline + consent |
| 0:42–1:08 | Return: same angles, "Real photo" chips (ear cushion physically removed — real, non-destructive); report appears (wait trimmed with on-screen "cut 18 s") | "On return, Gemini compares each pair live. It flags the missing ear cushion as new, and ignores the scuff that was there before." | Live AI, pre-existing suppression |
| 1:08–1:20 | Finding card: evidence, confidence, "$38 from Kestrel's price list"; staff confirm | "The AI never sets a price. $38 comes from the shop's own list, and staff confirm it." | Deterministic pricing, human gate |
| 1:20–1:32 | Renter phone: plain explanation, Accept | "The renter sees the same evidence and accepts." | Consent |
| 1:32–1:52 | Settle → ops with PayPal IDs and statuses; webhook badge turns green | Wording **exactly** per proven mode, e.g. "$38 captured. The remaining authorization is voided — here's PayPal's own status." | Real settlement, verified webhook |
| 1:52–2:18 | **Clean return.** Second rental, backpack, all "Real photo" chips; return photos taken in different light and from a slightly different angle, strap repositioned. Report: **"No new damage detected"**, 6 checked angles, existing wear "already recorded at check-out". Staff "Confirm $0" → renter "Looks right" → Settle → "$0 charged · deposit authorization voided" + PayPal `VOIDED` status | "Most rentals come back fine — and a fair system has to say so. Different light, different angle, a moved strap: none of it is damage. Holdfast says 'no new damage', and PayPal voids the authorization. Nothing charged." | Restraint; no false positives on real hard negatives; void path |
| 2:18–2:34 | Contest, fast: third rental, return photo with chip "AI-edited photo (synthetic damage)" shows a headband mark; AI proposes STAIN $25; renter taps Contest ("dust, it wipes off") + real photo; staff drop line → void | "And if the renter disagrees, they contest it. Here the line is dropped — no charge." | Contest path |
| 2:34–2:52 | Trust page: 5 guardrails; eval headline (clean-return accuracy on real photos, with sample size); repo URL | "AI proposes, people decide, the price list prices, PayPal settles. Holdfast: fair deposits, settled exactly." | Safety, measured restraint, close |

The clean return is the emotional turn of the video: after showing the system can catch real damage, show that it does not invent any. Use only real photos for it, and only show the eval number if the report exists, with its sample size and source label (e.g. "14 of 16 real no-change pairs, no charge proposed").

If the live clean-return run does not reach `NO_NEW_DAMAGE` on recording day, do not stage it: re-shoot the photos under the guided angles, or show the honest `NO_CHARGES_PROPOSED_REVIEW` state ("No charges proposed — 1 note to glance at") with staff dismissing the note.

If `SETTLEMENT_MODE=CAPTURE_THEN_REFUND`, replace 1:32–1:52 narration with: "The deposit was held during the rental. At settlement, Holdfast captures the $200 and immediately refunds $162 — both transactions are shown here." Never say "released".

## 4. Disclosure lines (on screen, not only spoken)

- Corner banner throughout: "PayPal Sandbox · no real money".
- On any AI-edited/generated photo: chip "AI-edited photo (synthetic damage)" / "AI-generated photo".
- End card: "Some return photos contain synthetic damage created for this demo. All inspections ran live on these images."
- If any segment uses replay mode: badge visible and stated: "Replayed result recorded from a live run of these exact images."

## 5. Failure-proof recording strategy

1. **Data prep (Nov 7):** run `scripts/demo-reset.ts`; seed; prepare the exact photo files in a `demo-assets/` folder (gitignored if they include personal items you'd rather not publish).
2. **Rehearse live twice** on the deployed app; record those runs (they populate the replay store with live results).
3. **Record segments separately** (booking, check-out, return, renter, settlement, clean return, contest). For the clean return, shoot check-out and return photos at different times of day so the lighting difference is genuine. Live mode first; use replay mode only for a segment where Vertex is slow/unavailable, with the badge visible.
4. **PayPal popups:** pre-login the sandbox buyer in the recording browser profile to avoid typing credentials on camera. Never show the developer dashboard secrets page.
5. **Screen setup:** 1920×1080, browser zoom 110–125%, hide bookmarks/extensions, notifications off. Renter page shown in a phone-sized window or device emulation at 390 px.
6. **Audio:** record narration separately (free tool such as Audacity or the OS recorder), quiet room, then align. No copyrighted music; silence or a royalty-free track with documented license.
7. **Editing:** free editor (e.g. DaVinci Resolve free, Shotcut, or OS built-in). Mark any time cuts with an on-screen "cut N s". Burn-in captions.
8. **Backup:** keep raw segments; export 1080p; upload to YouTube as **Public** by Nov 9; check it plays logged-out.

## 6. Checklist before final export

- [ ] Every PayPal ID shown is real sandbox data from the recorded run.
- [ ] Settlement wording matches `PAYPAL_INTEGRATION.md` §9 for the active mode.
- [ ] Synthetic image chips visible whenever such photos are on screen.
- [ ] Clean-return segment uses only real photos and a live (or labelled replayed-live) `NO_NEW_DAMAGE` verdict; void status shown from PayPal.
- [ ] No secrets, tokens, emails of real people, or personal information visible.
- [ ] Length ≤ 2:55; captions on; audio levels consistent.
- [ ] Repo URL and project name on the final card.
