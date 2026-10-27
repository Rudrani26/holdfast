# SUBMISSION_CHECKLIST.md — PayPal AI Hackathon

Source of truth: official rules https://paypalaihackathon.devpost.com/rules and resources https://paypalaihackathon.devpost.com/resources. The items below were taken from the owner's research context (rules inspected Oct 27, 2026). **[OWNER] re-read the official rules on Nov 9 and Nov 11** and update this file if anything changed. Where this file and the official rules disagree, the official rules win.

## 1. Deadlines

- [ ] Submission period ends **Nov 12, 2026, 12:00 noon Pacific** (rules §1). Target: submit by **Nov 9**, final check Nov 11.
- [ ] Project must stay available and free to test through **Dec 15, 2026** (judging period).
- [ ] No substantive changes after the deadline (rules §4–5); only organizer-approved fixes.

## 2. Eligibility (rules §3) [OWNER]

- [ ] Age of majority where you live.
- [ ] Not in an excluded jurisdiction; not an employee/agent/family of the sponsor or administrator; no conflict of interest.
- [ ] Read §3 in full yourself; do not rely on this summary.

## 3. Project requirements (rules §4)

- [ ] Functional application that uses the **PayPal developer platform via its free sandbox** and an **AI tool/model** (Gemini on Vertex AI). PayPal is central (deposit authorization + settlement).
- [ ] Built after Oct 1, 2026 (new project) — state this in the description.
- [ ] Runs consistently as described (not mockups).
- [ ] Third-party libraries/data used under valid licenses; list them in README (license summary).
- [ ] No unlicensed images: own photos, AI-generated images (disclosed), or openly licensed web images with attribution recorded in `eval/provenance/`.
- [ ] AI coding assistants: the official rules inspected do not name them; the owner owns and is responsible for the submitted code. (No claim beyond that.)

## 4. Repository

- [ ] Public GitHub repository.
- [ ] Open-source `LICENSE` (MIT) at repo root, with owner name filled in, recognized by GitHub at the top of the repo page.
- [ ] README: description, setup, run instructions, environment variables, sandbox account setup, seed, demo walkthrough, AI disclosure, limitations.
- [ ] `.env.example` with placeholders only; no secrets anywhere in history. [OWNER] scan history before making the repo public (e.g. search for the client secret string).
- [ ] Source, assets and docs included; large eval images optional (document how to obtain/generate them).

## 5. Working demo access

- [ ] Hosted URL (Cloud Run) **or** complete local run instructions (both planned).
- [ ] Safe sandbox test access for judges: staff passcode + dedicated sandbox buyer account in the Devpost private testing field.
- [ ] Smoke test of J1–J3 on the hosted URL within 24 h of submission.

## 6. Video

- [ ] Public YouTube video, plays when logged out.
- [ ] Shows the actual running application (`DEMO_PLAN.md`).
- [ ] Under 3 minutes (target ≤ 2:55).
- [ ] No unauthorized music, trademarks or third-party material; fictional shop brand only; PayPal referenced only as the payment platform used.
- [ ] Synthetic images disclosed on screen.

## 7. Devpost submission fields [OWNER]

- [ ] Project name, tagline (≤ 1 line pitch).
- [ ] Text description: problem, what it does, how PayPal is used (Orders v2 AUTHORIZE, Payments v2 capture/void/refund, webhooks), how AI is used (Gemini on Vertex, structured output, human gates), what's next, challenges, AI disclosure.
- [ ] "Built with" tags (Next.js, TypeScript, Google Cloud Run, Firestore, Cloud Storage, Vertex AI Gemini, PayPal REST APIs).
- [ ] Repo URL, video URL, demo URL, testing instructions.
- [ ] Images: screenshots, architecture diagram.
- [ ] English language throughout.
- [ ] Any required category/prize selections (check the form; only claim sponsor prizes whose tools you genuinely used — none planned).

## 8. Prize notes (rules §8)

- At most one grand prize + one sponsor prize, or one honorable mention + one sponsor prize.
- Honorable mentions relevant to Holdfast: Most Impactful, Best Demo Delivery, Best Use of PayPal + AI (judges decide; nothing to select unless the form asks).
- No sponsor tools are planned; do not claim sponsor prizes.

## 9. Final testing (Nov 7–9)

- [ ] `npm run typecheck && npm run lint && npm test` pass (record output in `docs/TEST_REPORT.md`).
- [ ] Opt-in integration tests pass against sandbox (with owner approval).
- [ ] Fresh-clone setup on a second machine or clean directory works from README.
- [ ] Secret-leak check passes.
- [ ] Budget alerts configured; Billing shows trial active with credit remaining.

## 10. Submission verification [OWNER]

- [ ] Devpost shows the submission as submitted (not draft) with all links working.
- [ ] Open repo, video and demo links from a logged-out browser.
- [ ] Screenshot the confirmation.
- [ ] Calendar reminders: Nov 11 final check; Dec 15 end of judging (keep the service up until then); Dec 16 cleanup (`DEPLOYMENT.md` §11).
