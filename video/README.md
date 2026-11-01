# Holdfast demo video

How the 2:47 demo video was made from the real running app, with real PayPal Sandbox transactions and live Gemini inspections. The brief is `docs/DEMO_VIDEO_PRODUCTION.md`; the creative source is `docs/DEMO_PLAN.md`.

| File | What it is |
| --- | --- |
| `shots.md` | Shot list, with where the video differs from DEMO_PLAN and why |
| `script.md` | Narration, exactly as sent to Text-to-Speech |
| `REHEARSAL.md` | V0 rehearsal results and friction found |
| `capture-log.json` | Every take: rental, time marks, PayPal IDs on screen, notes |
| `truth-audit.md` | Every PayPal ID in the final cut, checked against the PayPal Sandbox API |
| `YOUTUBE.md` | Title, description, chapters, tags |
| `LICENSES.md` | Fonts and tools (no music) |
| `cards/` | Title, chapter and end cards; overlay layers; phone composite background |
| `capture/` | Playwright capture: `run.ts` scenes, `rec.ts` recorder and pacing, `rehearse.ts` V0 rehearsal |
| `build/` | `stills.ts`, `tts.ts`, `vo-finish.ts`, `edit.ts`, `truth-audit.ts` |

Everything under `video/out/` is gitignored: raw clips, layers, narration, the rendered video.

## Reproduce

Prerequisites:
- the app deployed;
- `.env.local` with sandbox credentials;
- the owner signed in once with `npx tsx video/capture/login.ts`;
- ffmpeg 7;
- Google Application Default Credentials.

```bash
npx tsx video/capture/run.ts all                 # capture (owner types the PayPal buyer password in each popup)
npx tsx video/build/stills.ts raw && npx tsx video/build/stills.ts compose   # keyframes and cards
npx tsx video/build/tts.ts generate en-US-Chirp3-HD-Charon                    # narration (Text-to-Speech API)
npx tsx video/build/vo-finish.ts                                               # loudness and caption timings
npx tsx video/build/edit.ts layers && npx tsx video/build/edit.ts scenes && npx tsx video/build/edit.ts assemble final
npx tsx video/build/truth-audit.ts                                             # read-only PayPal checks
```

Live runs differ: Gemini's findings and PayPal IDs change every run. If you re-capture, update `script.md`, the EDL in `build/edit.ts` and `build/truth-audit.ts` from the new `capture-log.json`.

## Rules the cut follows

- **App content:** footage of the app is never altered. Overlays only annotate, or mask OS chrome: the taskbar and a checkout session ID in the PayPal popup's address bar.
- **Time:** every removed span is labelled "cut N s", and footage is never sped up.
- **Retake:** the J1 booking-form shot is a retake on an unpaid draft booking, joined by a labelled cut to J1's real PayPal popup. The original take recorded unrelated desktop content and was deleted.
