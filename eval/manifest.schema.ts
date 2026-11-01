import { z } from "zod";
import { DAMAGE_TYPES, INSPECTION_VERDICTS, SEVERITIES } from "../src/domain/types";

// Evaluation manifest (docs/AI_PIPELINE.md §10; TASKS T-050). Zod is the source of truth.
// Image paths are relative to eval/. Real owner photos live in gitignored folders and are
// referenced from here; the manifest and provenance files are committed, the images are not.

export const SOURCES = ["REAL", "HYBRID", "SYNTHETIC", "WEB"] as const;
export const CASE_TYPES = ["NEW_DAMAGE", "NO_CHANGE", "PREEXISTING_ONLY", "PREEXISTING_PLUS_NEW", "QUALITY_FAIL", "FULL_CLEAN_RETURN"] as const;
/** Hard-negative conditions (§10.2). Required for NO_CHANGE; optional context on other no-charge cases. */
export const SUBTYPES = ["LIGHTING", "ANGLE", "DISTANCE", "BACKGROUND", "GLARE", "SHADOW", "WIPEABLE_DUST", "REPOSITIONED", "PHONE_CHANGE", "SAME_PHOTO_TRANSFORMED"] as const;
/** Openly licensed only (§10.1: CC0, CC BY, public domain). */
export const WEB_LICENSES = ["CC0-1.0", "PDM-1.0", "PUBLIC-DOMAIN", "CC-BY-2.0", "CC-BY-3.0", "CC-BY-4.0"] as const;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const relPath = z
  .string()
  .regex(/^[A-Za-z0-9_./-]+\.(jpe?g|png|webp)$/i, "image path relative to eval/")
  .refine((p) => !p.split("/").includes(".."), "no '..' in image paths");
const coord = z.number().min(0).max(1000);

const expectedFinding = z.object({
  /** Optional when the owner's ground truth names only the location; type metrics then skip it. */
  damageType: z.enum(DAMAGE_TYPES).optional(),
  /** Optional when the owner labelled only the type; severity metrics then skip the finding. */
  severity: z.enum(SEVERITIES).optional(),
  box: z.tuple([coord, coord, coord, coord]).optional(),
  note: z.string().max(200).optional(),
});

const pair = z.object({ before: relPath, after: relPath });

export const evalCase = z
  .object({
    caseId: z.string().regex(/^c\d{3}$/),
    item: slug,
    /** Single-angle cases. FULL_CLEAN_RETURN uses `angles` instead. */
    angleId: slug.optional(),
    source: z.enum(SOURCES),
    caseType: z.enum(CASE_TYPES),
    subtype: z.enum(SUBTYPES).optional(),
    lighting: z.string().max(40).optional(),
    angleDelta: z.enum(["none", "small", "large"]).optional(),
    /** Generated images stay false until the owner checks the edit changed only the intended damage. */
    humanVerified: z.boolean(),
    images: pair.optional(),
    angles: z.record(slug, pair).optional(),
    expected: z.object({
      baselineMarks: z.array(expectedFinding).max(10),
      newFindings: z.array(expectedFinding).max(10),
      shouldCharge: z.boolean(),
      expectedVerdict: z.enum(INSPECTION_VERDICTS).optional(),
      /** QUALITY_FAIL: the model should flag the photo unusable. */
      usable: z.boolean().optional(),
    }),
    notes: z.string().max(300).optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof evalCase>;

export const evalItem = z.object({ id: slug, name: z.string().min(1).max(80), description: z.string().min(1).max(200) }).strict();

export const manifest = z
  .object({
    version: z.literal(1),
    /** Items used only in evaluation (not in the shop catalog), e.g. objects from the T-007 spike. */
    extraItems: z.array(evalItem).default([]),
    cases: z.array(evalCase).min(1),
  })
  .strict();
export type Manifest = z.infer<typeof manifest>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const generator = z.object({ model: z.string().min(1), prompt: z.string().min(1).max(2000), date: isoDate, costUsdEstimate: z.number().nonnegative().optional() }).strict();

/** eval/provenance/<caseId>.json — required for every case. */
export const provenance = z.discriminatedUnion("source", [
  z.object({ caseId: z.string(), source: z.literal("REAL"), capturedBy: z.literal("owner"), capturedOn: isoDate, staging: z.string().max(300), device: z.string().max(80).optional() }).strict(),
  z.object({ caseId: z.string(), source: z.literal("HYBRID"), before: z.object({ capturedBy: z.literal("owner"), capturedOn: isoDate }).strict(), after: generator }).strict(),
  z.object({ caseId: z.string(), source: z.literal("SYNTHETIC"), before: generator, after: generator }).strict(),
  z
    .object({
      caseId: z.string(),
      source: z.literal("WEB"),
      url: z.url(),
      author: z.string().min(1).max(120),
      license: z.enum(WEB_LICENSES),
      licenseUrl: z.url(),
      retrievedOn: isoDate,
      transform: z.string().max(200).optional(),
    })
    .strict(),
]);
export type Provenance = z.infer<typeof provenance>;
