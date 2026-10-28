import "server-only";
import { z } from "zod";
import { DAMAGE_TYPES, SEVERITIES, type Finding as DomainFinding } from "@/domain/types";

// docs/AI_PIPELINE.md §5. Zod is the source of truth: model output is always validated with these,
// and the JSON schema sent to Vertex (structured output) is derived from them.

export const DamageType = z.enum(DAMAGE_TYPES);
export const Severity = z.enum(SEVERITIES);

const coord = z.number().min(0).max(1000);
/** `[ymin, xmin, ymax, xmax]`, normalized 0–1000, on the return (second) image. */
export const Box = z.tuple([coord, coord, coord, coord]);

export const BaselineResult = z.object({
  angleId: z.string(),
  imageQuality: z.object({
    usable: z.boolean(),
    issues: z.array(z.enum(["BLUR", "GLARE", "LOW_LIGHT", "OBSTRUCTED", "OUT_OF_FRAME"])),
  }),
  marks: z
    .array(
      z.object({
        markId: z.string(),
        damageType: DamageType,
        severity: Severity,
        box: Box,
        description: z.string().max(160),
      }),
    )
    .max(10),
});
export type BaselineResult = z.infer<typeof BaselineResult>;

export const ReturnResult = z.object({
  angleId: z.string(),
  imageQuality: z.object({
    usable: z.boolean(),
    issues: z.array(
      z.enum(["BLUR", "GLARE", "LOW_LIGHT", "OBSTRUCTED", "OUT_OF_FRAME", "ANGLE_MISMATCH"]),
    ),
  }),
  findings: z
    .array(
      z.object({
        findingId: z.string(),
        damageType: DamageType,
        severity: Severity,
        box: Box,
        isNew: z.boolean(),
        matchesBaselineMarkId: z.string().nullable(),
        confidence: z.number().min(0).max(1),
        evidence: z.string().max(200),
      }),
    )
    .max(10),
  noChangeConfidence: z.number().min(0).max(1),
});
export type ReturnResult = z.infer<typeof ReturnResult>;
export type Finding = ReturnResult["findings"][number];

// Compile-time check: a validated model finding is storable as the domain Finding.
const _findingIsDomainFinding = (f: Finding): DomainFinding => f;
void _findingIsDomainFinding;

// Keywords Vertex `responseJsonSchema` accepts (per the @google/genai GenerateContentConfig docs).
// Anything else (e.g. maxLength, $schema) is dropped; Zod still enforces it on the response.
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "oneOf",
  "properties",
  "additionalProperties",
  "required",
]);

function keepSupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(keepSupported);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) continue;
    // `properties` maps names → schemas; its keys are field names, not keywords.
    out[key] =
      key === "properties"
        ? Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, keepSupported(v)]))
        : keepSupported(value);
  }
  return out;
}

/** JSON schema for Vertex structured output, derived from a Zod schema. */
export function toModelJsonSchema(schema: z.ZodType): unknown {
  return keepSupported(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}
