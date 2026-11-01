# Narration script (V3)

Spoken text only. One block per scene ID from `video/shots.md`; the `> ` lines are sent to Text-to-Speech exactly as written (`video/build/tts.ts generate`).

**Rules:**
- About 145 words per minute.
- Amounts are spelled the way they should be spoken; IDs are never read aloud.
- Every amount and result is from the V2 capture (`video/capture-log.json`).
- Wording follows PAYPAL_INTEGRATION §9: a hold is "authorized", the remainder is "voided", never "released" or "refunded".

Target: 2:54. Word count: about 330.

## title
0:00–0:08

> Deposits are where rental shops and renters stop trusting each other. Holdfast fixes that with evidence, consent, and PayPal.

## book
0:08–0:30 · storefront, booking form, PayPal popup, confirmation

> A renter books headphones and approves a two hundred dollar deposit in PayPal. It's a PayPal authorization: a hold, not a charge. Here is the authorization, and when it expires.

## checkout
0:30–0:46 · six photos, Gemini baseline, renter confirms on their phone

> At pickup, staff photograph six angles. Gemini, on Google's Vertex AI, notes the wear that's already there. The renter confirms those photos on their phone.

## return
0:46–1:10 · return photos, live inspection (labelled cut), report, pre-existing wear

> On return, staff take the same six photos, and Gemini compares each pair live. It finds both ear cushions missing. The wear recorded at pickup is not charged again.

## price
1:10–1:20 · price chip, staff confirm

> The AI never sets a price. Each cushion is thirty-eight dollars from the shop's own price list, and staff confirm it.

## accept
1:20–1:30 · renter phone, Accept

> The renter sees the same photos and prices, and accepts.

## settle
1:30–1:48 · Settle, receipt, PayPal-confirmed badges

> Staff press settle. PayPal captures seventy-six dollars and voids the remaining hundred and twenty-four. These are PayPal's own statuses, confirmed by signed webhooks.

## clean
1:52–2:16 · backpack: live inspection, "No new damage detected", Confirm zero, Looks right, void

> Most rentals come back fine, and a fair system has to say so. This backpack came back photographed in different light, with sun across it. Gemini finds no new damage, and matches three old marks to the check-out photos. The renter taps looks right, and PayPal voids the whole authorization. Nothing is charged.

## contest
2:16–2:34 · speaker: fifteen-dollar dent proposed, renter contests, staff drop it, void

> When the renter disagrees, they contest. Here Gemini proposed a fifteen dollar dent, but the check-out photo shows that grille was already creased. Staff read the reason, drop the line, and the hold is voided.

## trust
2:34–2:46 · how-it-works lanes, eval card, rules

> AI proposes. People decide. The price list prices. PayPal settles. And we measured it on our own real photos, with the sample size on screen.

## end
2:46–2:54

> Holdfast. Fair deposits, settled exactly.
