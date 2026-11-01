import { z } from "zod";
import { DAMAGE_TYPES, SEVERITIES, type Item, type PriceList } from "@/domain/types";

// Validates data/catalog.json and data/priceList.json before anything is written (T-015).
// Pure: callers read the files and pass the parsed JSON in.

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");
const cents = z.number().int().nonnegative();

export const ANGLES_PER_ITEM = 6;

const angle = z.object({ id: slug, label: z.string().min(1).max(40), hint: z.string().min(1).max(160) });

const item = z
  .object({
    id: slug,
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(200),
    imagePath: z.string(),
    depositCents: cents.positive(),
    dailyRateCents: cents.positive(),
    priceListId: slug,
    active: z.boolean(),
    angles: z.array(angle).length(ANGLES_PER_ITEM),
  })
  .refine((i) => i.imagePath === heroImagePath(i.id), { message: "imagePath must be items/<id>.jpg", path: ["imagePath"] })
  .refine((i) => new Set(i.angles.map((a) => a.id)).size === i.angles.length, {
    message: "angle ids must be unique",
    path: ["angles"],
  });

const rule = z.object({
  damageType: z.enum(DAMAGE_TYPES),
  severity: z.enum(SEVERITIES),
  amountCents: cents,
  label: z.string().min(1).max(80),
});

const priceList = z
  .object({ id: slug, name: z.string().min(1), currency: z.literal("USD"), rules: z.array(rule).min(1) })
  .refine((p) => new Set(p.rules.map(ruleKey)).size === p.rules.length, {
    message: "one rule per (damageType, severity)",
    path: ["rules"],
  });

const catalogFile = z.object({ items: z.array(item).min(1) });
const priceListFile = z.object({ priceLists: z.array(priceList).min(1) });

export const heroImagePath = (itemId: string) => `items/${itemId}.jpg`;
const ruleKey = (r: { damageType: string; severity: string }) => `${r.damageType}:${r.severity}`;

export interface SeedData {
  items: Item[];
  priceLists: PriceList[];
}

export class SeedDataError extends Error {
  constructor(readonly problems: string[]) {
    super(`seed data is invalid:\n  ${problems.join("\n  ")}`);
  }
}

const issues = (file: string, error: z.ZodError) =>
  error.issues.map((i) => `${file}: ${i.path.join(".") || "(root)"}: ${i.message}`);

/** Parses both files and checks cross-references; throws SeedDataError listing every problem. */
export function parseSeedData(catalogJson: unknown, priceListJson: unknown): SeedData {
  const catalog = catalogFile.safeParse(catalogJson);
  const lists = priceListFile.safeParse(priceListJson);
  const problems = [
    ...(catalog.success ? [] : issues("catalog.json", catalog.error)),
    ...(lists.success ? [] : issues("priceList.json", lists.error)),
  ];
  if (!catalog.success || !lists.success) throw new SeedDataError(problems);

  const { items } = catalog.data;
  const { priceLists } = lists.data;
  for (const [what, ids] of [
    ["item", items.map((i) => i.id)],
    ["price list", priceLists.map((p) => p.id)],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) problems.push(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  }
  const listIds = new Set(priceLists.map((p) => p.id));
  for (const i of items) {
    if (!listIds.has(i.priceListId)) problems.push(`item "${i.id}" references unknown price list "${i.priceListId}"`);
  }
  if (problems.length > 0) throw new SeedDataError(problems);
  return { items, priceLists };
}
