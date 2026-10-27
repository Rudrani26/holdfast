/**
 * CLI argument parsing for the spike scripts. Uses node:util parseArgs (strict) + Zod.
 * Every parser takes argv without the node/script prefix, e.g. ["--exp", "E1"].
 */
import { parseArgs } from "node:util";
import { z } from "zod";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const amountSchema = z
  .string()
  .regex(/^\d{1,7}\.\d{2}$/, 'must look like "38.00"')
  .refine((v) => Number(v) > 0, "must be greater than 0.00");

const expSchema = z.string().regex(/^[A-Za-z0-9-]{1,20}$/, 'use letters, digits or "-", e.g. E1');
const paypalIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "not a PayPal ID");
const labelSchema = z.string().regex(/^[A-Za-z0-9-]{1,30}$/, 'use letters, digits or "-"');
const boolSchema = z.enum(["true", "false"]).transform((v) => v === "true");

function parse<T extends z.ZodType>(argv: string[], names: string[], schema: T): z.infer<T> {
  let values: Record<string, unknown>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: Object.fromEntries(names.map((n) => [n, { type: "string" as const }])),
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const result = schema.safeParse(values);
  if (!result.success) {
    throw new UsageError(
      result.error.issues.map((i) => `--${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

export const parseCreateOrderArgs = (argv: string[]) =>
  parse(
    argv,
    ["exp", "amount", "item"],
    z.object({
      exp: expSchema,
      amount: amountSchema.default("200.00"),
      item: z.string().min(1).max(60).default("Spike test item"),
    }),
  );

export const parseAuthorizeArgs = (argv: string[]) =>
  parse(argv, ["exp", "order"], z.object({ exp: expSchema, order: paypalIdSchema.optional() }));

export const parseCaptureArgs = (argv: string[]) =>
  parse(
    argv,
    ["exp", "amount", "final", "auth"],
    z.object({
      exp: expSchema,
      amount: amountSchema,
      final: boolSchema,
      auth: paypalIdSchema.optional(),
    }),
  );

export const GET_TARGETS = ["auth", "order", "capture", "refund"] as const;

export const parseGetArgs = (argv: string[]) =>
  parse(
    argv,
    ["exp", "what", "id", "label"],
    z.object({
      exp: expSchema,
      what: z.enum(GET_TARGETS).default("auth"),
      id: paypalIdSchema.optional(),
      label: labelSchema,
    }),
  );

export const parseVoidArgs = (argv: string[]) =>
  parse(argv, ["exp", "auth"], z.object({ exp: expSchema, auth: paypalIdSchema.optional() }));

export const parseIdempotencyArgs = (argv: string[]) =>
  parse(argv, ["exp", "amount"], z.object({ exp: expSchema, amount: amountSchema.default("38.00") }));

export const parseNegativeArgs = (argv: string[]) =>
  parse(
    argv,
    ["exp", "code", "amount"],
    z.object({
      exp: expSchema,
      code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "use an UPPER_SNAKE PayPal issue code").default("DUPLICATE_INVOICE_ID"),
      amount: amountSchema.default("1.00"),
    }),
  );

export const parseRefundArgs = (argv: string[]) =>
  parse(
    argv,
    ["exp", "amount", "capture"],
    z.object({ exp: expSchema, amount: amountSchema, capture: paypalIdSchema.optional() }),
  );
