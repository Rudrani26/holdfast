# DEMO_VIDEO_PRODUCTION.md — Build the Holdfast demo video

This is the production brief. It turns the working app into a polished demo video under three minutes, recorded from the **real running app** with real PayPal Sandbox transactions and live Gemini inspections.

The project rules still apply in full. In particular:
- **No Git write operations, ever.**
- No deployments, cloud resource changes or paid tools without owner approval.
- Never fabricate PayPal or AI results.

`docs/DEMO_PLAN.md` is the creative source of truth: storyboard, narration, disclosure lines. This file explains how to produce it.

## 0. What "amazing" means here

Judges may score from the video alone. The video wins if, within 3 minutes, a skeptical judge sees all of these happen for real:

| # | Winning point | Must be visible on screen | Criterion |
| --- | --- | --- | --- |
| 1 | The deposit is a real PayPal authorization, not a charge | PayPal sandbox popup; authorization ID, status `CREATED`, expiry date | Technological Implementation |
| 2 | AI compares before/after live and ignores pre-existing wear | Report appearing; the scuff labelled "already recorded at check-out" | Innovation |
| 3 | AI never sets prices | "$38 · from Kestrel's price list" next to the finding | Innovation, Impact |
| 4 | Both sides consent | Staff "Confirm", renter phone "Accept" | Design, Impact |
| 5 | Exact settlement with proof | Capture ID, captured amount, remainder status, "PayPal-confirmed" webhook badge | Technological Implementation |
| 6 | **The system can say "No new damage detected"** | Clean-return verdict on real photos → `VOIDED` status | Innovation, Impact |
| 7 | Disagreement has a path | Contest → line dropped → void | Design |
| 8 | Guardrails are real | Trust page; eval headline with sample size and source label | Presentation |

Every one of these must come from the real app. No mockups, no After-Effects transactions, no edited numbers.

## 1. Rules specific to the video

1. **Real footage only.** Capture the actual app, the real PayPal sandbox popup and real API results. Title cards, callouts and captions may be added in post; app content may not be altered.
2. **Truth audit.** Record every PayPal ID and inspection ID that appears on screen in `video/capture-log.json`. Before the final render, verify each PayPal ID with a read-only `GET` against the sandbox and confirm its status matches what is shown.
3. **Wording** follows `PAYPAL_INTEGRATION.md` §9 for the active `SETTLEMENT_MODE`. Narration must never say "refunded" for a void or "released" unless the spike proved it.
4. **Time cuts are labelled.** Waiting for Gemini or PayPal may be trimmed, with a small on-screen "cut 18 s" label. Do not speed up footage to fake latency.
5. **Replay mode** only if a live run is impossible on recording day, with the app's "Replayed AI result" badge visible and stated in narration.
6. **Disclosures** from `DEMO_PLAN.md` §4: sandbox banner throughout, chips on AI-edited photos, end-card note.
7. **Never show:** secrets, `.env*` files, the PayPal developer dashboard credentials page, terminal windows with tokens, real people's emails, browser bookmarks or notifications.
8. **No copyrighted music.** Use silence, or a track whose license is recorded in `video/LICENSES.md`.
9. **Free tools only:** Playwright (Apache-2.0), ffmpeg, Node. Before installing anything, state its name, version and license.
10. **Output:** 1920×1080, 30 fps, H.264 `yuv420p`, AAC 48 kHz, length **≤ 2:55**.
11. **The owner records nothing.** Screen capture is fully automated and narration is an AI voice (§6). The owner only approves stages, signs in to the sandbox buyer profile once, and clicks in the PayPal popup only if PayPal blocks automation.
12. **AI voice disclosure:** the end card includes "Narration: AI-generated voice (Google Cloud Text-to-Speech)", and so does the YouTube description.

## 2. Pipeline overview

```
V0 readiness audit & demo hardening   → STOP (owner review)
V1 shot list + full-size keyframe stills → STOP (owner approves the look)
V2 scripted capture of each scene (real app, real sandbox) → STOP
V3 AI voice-over (Google Cloud TTS Chirp 3 HD, free tier) → STOP (owner picks the voice)
V4 rough cut: cards, callouts, captions, assembly → STOP
V5 final render, truth audit, QA checklist, YouTube package → STOP
```

Folder layout (inside the repo, all source committed by the owner):

```
video/
  README.md              how to reproduce the video
  shots.md               shot list with exact actions and expected on-screen proof
  script.md              final narration with timestamps
  capture/
    config.ts            viewport, browser profile, URLs, scene list
    scenes/*.ts          one Playwright script per scene
    run.ts               runs a scene, records it, writes capture-log entries
  cards/*.html           title, chapter, callout and end cards (rendered to PNG/MP4)
  build/
    render-cards.ts      HTML → JPEG (q92) → MP4 stills
    assemble.sh          per-scene encode → concat → audio → captions
  capture-log.json       IDs shown per scene (truth audit)
  LICENSES.md            fonts, music (if any), tools
  out/                   gitignored: raw/, scenes/, holdfast-demo.mp4, .srt
```

Add `video/out/` and `video/capture/.profile/` to `.gitignore`.

## 3. V0 — Readiness audit and demo hardening

The video can only be as smooth as the app.

1. Read `docs/TASKS.md` and the actual code to establish what is built. Report what's complete, partial or missing for J1 (deduction), J2 (clean return), J3 (contest), the receipt and the trust page.
2. Run `npm run typecheck && npm run lint && npm test` and report real results.
3. With owner approval, run each journey once end to end against the sandbox and live Gemini, using `scripts/demo-reset.ts` (create it if T-062 isn't done). Record every friction point: slow steps, layout shift, unclear states, console errors, flashes of empty content, overflowing text at 1920×1080 and at 390 px.
4. Propose a **demo hardening list**, ranked by visual impact, and fix only what the owner approves. Typical items:
   - Skeleton loaders instead of spinners; a progress line during inspection ("Comparing angle 3 of 6…").
   - Stable layout (no jumps when results load); smooth state transitions (150–250 ms, respecting `prefers-reduced-motion`).
   - Money in tabular numerals; PayPal IDs in monospace with a copy button.
   - A clear settlement result card for each mode.
   - The clean-verdict panel exactly as in `PRD.md` §10.
   - Zero console errors on the demo path.
5. Add a **demo data kit**: `demo-assets/` (gitignored) holding the exact photos for each scene, with a manifest saying which are real and which are AI-edited. Add a reset command that recreates the three demo rentals in a known state.
6. Milestone report, then **STOP**.

Hardening must not change behaviour, amounts, wording rules or approval gates.

## 4. V1 — Shot list and keyframe stills

1. Turn `DEMO_PLAN.md` §3 into `video/shots.md`. For each shot list:
   - The scene ID and its target duration.
   - The exact user actions.
   - The URL and viewport: desktop 1920×1080; renter phone emulated at 390×844 and composited at the right of the frame.
   - The on-screen proof required (from §0 above).
   - The narration line and caption text.
2. Capture **full-size JPEG stills (quality 92)** at the busiest moment of each scene, exactly as it will be filmed:
   - The report with findings.
   - The settlement card with IDs.
   - The clean verdict.
   - The phone composite.
3. Look at each still at full size. Check that text is readable at 1080p, there is no overflow, the disclosure chips are visible, nothing sensitive is on screen and the hierarchy is clear. Fix layout issues (with approval) before any capture.
4. Draft the visual system for cards and callouts:
   - One accent color matching the app; the app's font family; a dark-neutral title card.
   - Callouts as rounded highlight boxes with a short label, e.g. "Real PayPal authorization" or "Price from shop's list, not AI".
   - Lower-thirds naming the winning point for each scene.
5. Send the stills and card drafts; **STOP** for owner approval.

## 5. V2 — Scripted capture

Goal: clean, repeatable footage of each scene from the real app.

**Capture method.** Detect the OS and choose:
- **Preferred:** a headed Chromium window at exactly 1920×1080 (device scale 1), driven by Playwright, while ffmpeg records that screen region. Use avfoundation on macOS (needs Screen Recording permission for VS Code or the terminal; tell the owner), gdigrab on Windows, x11grab on Linux. Record at 30 fps with `-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p`.
- **Fallback:** Playwright's built-in `recordVideo` at 1920×1080, transcoded to the output settings. Note that its quality is lower.

**Human-like pacing.** Real cursor movement (eased, 300–600 ms per move), short pauses (600–1200 ms) after each result appears, so viewers can read. Type renter details at natural speed. Scroll smoothly. Never click faster than a person would.

**PayPal sandbox popup.**
- Use a persistent browser profile (`video/capture/.profile/`, gitignored) in which the owner has signed in once as the sandbox buyer, so no credentials are typed on camera.
- If PayPal shows a challenge or blocks automation, pause the script and ask the owner to click **Continue/Pay** manually while recording continues.
- Never try to get around PayPal's checks.

**Renter phone.** Run the renter page in a second context at 390×844 with touch emulation. Composite it later beside the staff view, or cut to it full-frame with a phone frame drawn in post.

**Per scene:**
1. Reset demo data to the scene's start state.
2. Start recording.
3. Run the actions.
4. Wait for the real API result.
5. Hold for 1–2 s.
6. Stop recording.

Write the raw clip to `video/out/raw/<scene>.mp4` (temporary name, renamed on success). Append the IDs shown (order, authorization, capture, void or refund, webhook event, inspection) to `capture-log.json`.

**Retakes.** Each scene must be re-runnable on its own. Keep the best take per scene; record the take number in the log.

**Clean-return scene.**
- Real photos only, check-out and return shot under genuinely different lighting or angle (owner provides them).
- If the live verdict isn't `NO_NEW_DAMAGE`, do not fake it. Report it and follow the `DEMO_PLAN.md` fallback.

Milestone report listing each scene, take, duration and the IDs captured; **STOP**.

## 6. V3 — AI voice-over (the owner records nothing)

**Engine: Google Cloud Text-to-Speech, Chirp 3: HD voices**, on the owner's existing GCP project.
- Google's pricing page (checked Oct 29, 2026) lists 1 million free characters per month for Chirp 3: HD. The whole script is about 2,500 characters, so even 50 re-generations stay inside the free tier. Usage beyond it would draw on the trial credit, not cash.
- **Owner approval needed once:** enable `texttospeech.googleapis.com` on the project. Uses the same `gcloud auth application-default login` credentials as Vertex.
- Do not use Gemini-TTS: Google lists no free tier for it.
- Offline fallback if the API is unavailable: Kokoro (Apache-2.0) or Piper (MIT), run locally. They sound less natural; use only if Chirp 3 HD can't be used.

Steps:
1. **Script.** Finalize `video/script.md`: one narration block per scene, timed to the captured clips, about 145 words per minute. Plain, confident, specific, with the winning points from §0 in the words. Write for the ear:
   - Short sentences.
   - Amounts spelled the way they should be spoken ("thirty-eight dollars").
   - IDs never read aloud; they are shown on screen instead.
2. **Voice audition.**
   - List available en-US Chirp 3: HD voices.
   - Render the same two narration lines (the hook and the clean-return line) with 4–5 calm, warm, mid-tempo voices.
   - Save them as `video/out/vo/audition/<voice>.wav` and send them to the owner; **STOP** for the owner's pick.
3. **Generate per scene.** Synthesize each scene's block with the chosen voice:
   - Output to `video/out/vo/<scene>.wav`: LINEAR16, 48 kHz.
   - Use the API's speaking-rate control only if the docs say Chirp 3: HD supports it; otherwise adjust pacing by rewording or adding sentence breaks.
   - Store the exact text sent next to each file (`<scene>.txt`) so any line can be regenerated alone.
   - Hard cap: 60 synthesis requests per run.
4. **Fit to picture.**
   - Measure each clip's duration with ffprobe. If narration runs longer than its scene, trim words first, then extend holds on static moments. Never speed up the voice beyond 1.05×.
   - Leave about 0.3 s of silence before and after each block.
5. **Finish.** Normalize to −16 LUFS and apply a gentle high-pass at 80 Hz. Add a light de-ess only if the audition shows harsh sibilance.
6. **Captions.** Generate them from the exact synthesized text with real timings: `video/out/holdfast-demo.srt`.
7. **Music (optional, default off).** If added, the track must have a recorded license, sit at −28 LUFS under the voice and duck during narration.

Add Text-to-Speech to `docs/DEPLOYMENT.md` §2 (free tier: 1M chars/month for Chirp 3 HD) when it is enabled.

## 7. V4 — Rough cut

Follow these rendering rules:

1. Render cards (title, chapter dividers if used, end card) from HTML with Playwright to JPEG q92 at 1920×1080. Turn each into an MP4 still with:
   `-framerate 30 -i card.jpg -vf format=yuv420p,loop=-1:1,trim=duration=<s> -pix_fmt yuv420p`
   (fades after `loop`).
2. Produce **one encoded file per scene**, all with identical size, frame rate and encoder settings (`libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -r 30`). Each file includes:
   - Trims and labelled time cuts.
   - Callouts and lower-thirds via `overlay` from PNGs rendered from `cards/`.
   - Gentle zooms on IDs and amounts (crop/scale, ≤ 1.3×, eased).
   - The phone composite.
   - Any crossfade into or out of that scene.
3. Write each scene to `video/out/scenes/<scene>.tmp.mp4` and rename to `<scene>.mp4` only when ffmpeg exits 0.
4. Join scenes with the concat demuxer and `-c copy`. Add narration with `-c:v copy -map 0:v -map 1:a` (AAC 48 kHz, −16 LUFS).
5. Burn captions into the final export (re-encode once) and keep the `.srt` for YouTube.
6. Before any full render, render 3–4 frames at full size from the busiest moments of the assembled timeline and look at them.
7. To change one scene later, re-render only that scene's file (and the next one if it holds a crossfade), then concat again.

Send the rough cut; **STOP** for owner feedback.

## 8. V5 — Final render, audit and QA

1. Apply feedback; render the final `video/out/holdfast-demo.mp4`.
2. **Truth audit** (read-only sandbox `GET` calls, owner-approved): every PayPal ID in `capture-log.json` exists with the status shown on screen. Report a table: scene · object · ID · status shown · status verified.
3. **QA checklist** (report each item pass/fail):
   - [ ] Length ≤ 2:55.
   - [ ] All 8 winning points visible.
   - [ ] Clean-return scene real and live (or labelled replay).
   - [ ] Settlement wording matches the active mode.
   - [ ] Disclosure chips and banner visible.
   - [ ] End-card disclosure present.
   - [ ] No secrets or personal data on screen.
   - [ ] Captions accurate and synced.
   - [ ] Audio clean, no clipping, consistent loudness.
   - [ ] AI-voice disclosure on end card and in the YouTube description.
   - [ ] No copyrighted music.
   - [ ] Plays in a standard player.
   - [ ] 1080p30 H.264 + AAC.
4. **YouTube package** (`video/YOUTUBE.md`): title, description with what's real (PayPal Sandbox, live Gemini on Vertex AI, synthetic images disclosed), chapters with timestamps, repo link placeholder, tags. The owner uploads as **Public** and checks it plays logged-out.
5. Final milestone report with a suggested commit message (plain text); **STOP**.

## 9. If something breaks on recording day

| Problem | Do this |
| --- | --- |
| PayPal sandbox slow or erroring | Retry the scene later; never fake a transaction. If unavailable for hours, record other scenes and come back. |
| Vertex slow | Keep the real wait, cut it with a label. |
| Vertex down | Replay mode with badge and spoken disclosure, only for byte-identical photos that ran live before. |
| Clean return not reaching `NO_NEW_DAMAGE` | Re-shoot photos with the guided angles, or show the honest "No charges proposed — review" state. |
| PayPal popup blocks automation | Owner clicks during capture. |
| Over 2:55 | Shorten waits and holds first, then the contest scene; never cut a winning point's proof. |
