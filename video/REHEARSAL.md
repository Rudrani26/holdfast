# V0 rehearsal — Nov 1, 2026 (UTC), production revision holdfast-00006-6fb

Real PayPal Sandbox, live Gemini (gemini-3.7-flash). 36 of 36 approved AI calls used. Screenshots and page text: `video/out/rehearsal/` (gitignored).

| Journey | Rental | What happened | Timings |
| --- | --- | --- | --- |
| J1 damage (headphones, $200 hold) | r_761eba53fedd06eb56df | Gemini proposed 2 missing parts on the front angle at 98% (left earcup cover off, right ear cushion off). Both priced by the list at $38 (Ear cushion replacement). Staff confirmed $76, renter accepted, PayPal captured $76 and voided the remaining $124. | baseline 12.7 s, return 17.9 s, settle 2.9 s, webhook 33 s |
| J2 clean (backpack, $60 hold) | r_8a00e9bf068a25cab780 | Baseline: 6 pre-existing marks. Return: "No new damage detected", all marks matched to baseline. Staff confirmed $0, renter "Looks right", PayPal voided the authorization. | baseline 12.2 s, return 12.2 s, settle 1.4 s, webhook 6 s |
| J3 contest (speaker, $120 hold) | r_8fbe9765483bbaccb4e0 | Gemini proposed a minor grille "scratch" at 92% ($10, Cosmetic scratch). The check-out photo already shows creases there; the return photo is in direct sun. Renter contested with a reason, staff excluded the line, confirmed $0, renter "Looks right", PayPal voided. | baseline 16.9 s, return 16.9 s, settle 1.9 s, webhook 6.5 s |

## Friction found (and what was done)

1. Staff "Waiting for the renter" panel and status notes showed internal task IDs (T-041, T-042). Fixed in code; needs a redeploy to be live.
2. PayPal checkout asks for the buyer password every time (the profile only remembers the email). The owner types it; the video should cut from the popup opening to the approved state.
3. J1 narration in DEMO_PLAN says "$38, one cushion". The real result is two missing parts, $76. Narrate what happened.
4. J3 finding differs from the Oct 30 eval (a "dent" then, a "scratch" now): the model is not deterministic. Capture J3 once and keep that take.
5. The renter page needs a moment to load after navigation; capture should wait for network idle before recording a scene.
6. Webhook confirmation took 6–33 s; the "Waiting for PayPal's signed webhook" line auto-refreshes, which is fine on camera but J1 may need a trim.
