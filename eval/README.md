# Holdfast evaluation set

How well does the AI inspection separate new damage from "nothing changed"? This folder holds the
labelled cases used to measure that (spec: `docs/AI_PIPELINE.md` §10).

## Layout

| Path | What | In git? |
| --- | --- | --- |
| `manifest.json` | One entry per case: item, angle, source, case type, expected answer | yes |
| `manifest.schema.ts` | Zod schema for the manifest and provenance files | yes |
| `provenance/<caseId>.json` | Where each case's images came from (required for every case) | yes |
| `validate.ts` | Pure validation (used by `npm run eval:validate` and tests) | yes |
| `images/<caseId>/before.jpg`, `after.jpg` | Default image location for new cases | **no** (owner photos) |
| `spike-pairs/`, `clean-return/` | Owner photos from T-007 and T-033, referenced by the manifest | **no** |
| `reports/` | Eval run output (`npm run eval`, T-052) | `.json` no, `.md` yes |

Image paths in the manifest are relative to `eval/`. The owner's photos are private, so a fresh
clone has the labels and provenance but not the images; `npm run eval:validate` then reports the
missing files.

## Sources (always labelled)

- `REAL` — both photos of an object the owner owns; changes staged without damaging anything.
- `HYBRID` — real check-out photo; return photo is an AI edit of it (`npm run eval:generate`, T-051).
- `SYNTHETIC` — both images AI-generated.
- `WEB` — openly licensed photos only (CC0, CC BY, public domain) with URL, author, license and
  retrieval date in the provenance file.

Results on `HYBRID` and `SYNTHETIC` images do not demonstrate real-world accuracy; every report
says so first.

## Adding a case

1. Put the photos in `images/<caseId>/before.jpg` and `after.jpg` (or reference another eval path).
2. Add the case to `manifest.json`. Label only what you know: `damageType` and `severity` are
   optional on expected findings, and metrics skip what is not labelled.
3. Add `provenance/<caseId>.json` for its source (see `manifest.schema.ts`).
4. Generated images start with `"humanVerified": false`; set it to `true` only after checking the
   edit changed nothing except the intended damage. Unverified cases are excluded from runs.
5. Run `npm run eval:validate`.

## Current set

6 REAL cases: 3 new damage (headphone ear cushions, lens hood rim, speaker grille), 2 pre-existing
only (backpack under different light, mouse at a different angle), and 1 six-angle full clean return
(headphones, daylight vs lamp). `npm run eval:validate` lists the gaps against the §10.2 targets.
