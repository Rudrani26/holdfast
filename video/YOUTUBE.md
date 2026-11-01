# YouTube package

Upload `video/out/holdfast-demo.mp4` (2:47, 1080p30), visibility **Public**, captions from `video/out/holdfast-demo.srt` (English). After upload, open the link in a logged-out window and check it plays.

## Title

Holdfast: rental deposits settled on evidence, with PayPal and Gemini

## Description

Holdfast turns a rental deposit into a fair, evidence-backed settlement.

The renter's deposit is a PayPal authorization: a hold, not a charge. At pickup and return, staff photograph six angles and Gemini on Google Vertex AI compares the pairs and proposes what's new. The shop's own price list prices each line, never the AI. Staff confirm, the renter accepts or contests on their phone, and PayPal captures only the agreed amount and voids the rest of the hold.

What you see in this video is real:
• PayPal Orders v2 in the PayPal Sandbox (no real money). Every order, authorization, capture and void shown was checked afterwards against PayPal's API, and each "PayPal-confirmed" badge comes from a signature-verified webhook.
• Live Gemini inspections (gemini-3.7-flash on Vertex AI) on real photos of our own gear. No AI-edited or generated images.
• Waits for Gemini and PayPal are cut, and every cut is labelled on screen. Nothing is sped up.
• Narration: AI-generated voice (Google Cloud Text-to-Speech, Chirp 3: HD).

Built with PayPal Orders v2 · PayPal webhooks · Gemini on Vertex AI · Next.js · Firestore · Cloud Run.

Code: https://github.com/Rudrani26/holdfast

Chapters
0:00 Deposits and trust
0:08 A PayPal hold, not a charge
0:31 Pickup: six photos and a Gemini baseline
0:50 Return: live comparison, priced from the shop's list
1:20 Settlement: $76 captured, the rest voided
1:34 A clean return: no new damage
2:04 Disagreement: contest, review, void
2:27 Guardrails and how the AI was measured
2:40 Disclosures

## Tags

PayPal, PayPal Sandbox, PayPal Orders API, Gemini, Vertex AI, Google Cloud, rental deposit, AI inspection, hackathon, Next.js
