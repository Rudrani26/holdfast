import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateEval, type CatalogItem, type ValidationInput } from "./validate";

const catalog = (JSON.parse(readFileSync("data/catalog.json", "utf8")) as { items: CatalogItem[] }).items;
const realManifest = JSON.parse(readFileSync("eval/manifest.json", "utf8")) as { cases: Record<string, unknown>[]; extraItems: unknown[] };
const realProvenance = Object.fromEntries(realManifest.cases.map((c) => [c.caseId as string, JSON.parse(readFileSync(`eval/provenance/${c.caseId as string}.json`, "utf8"))]));

const input = (over: Partial<ValidationInput> = {}): ValidationInput => ({
  manifestJson: structuredClone(realManifest),
  provenanceByCase: structuredClone(realProvenance),
  catalog,
  fileExists: () => true, // image presence is checked by the CLI; owner photos are not in the repo
  ...over,
});
const withCase = (c: Record<string, unknown>, prov?: unknown) =>
  input({
    manifestJson: { ...structuredClone(realManifest), cases: [...structuredClone(realManifest.cases), c] },
    provenanceByCase: { ...structuredClone(realProvenance), ...(prov ? { [c.caseId as string]: prov } : {}) },
  });
const base = {
  caseId: "c099",
  item: "backpack",
  angleId: "front",
  source: "REAL",
  caseType: "NO_CHANGE",
  subtype: "SHADOW",
  humanVerified: true,
  expected: { baselineMarks: [], newFindings: [], shouldCharge: false },
};
const realProv = { caseId: "c099", source: "REAL", capturedBy: "owner", capturedOn: "2026-10-29", staging: "hand shadow at return" };

describe("eval manifest", () => {
  it("the committed manifest and provenance validate", () => {
    const r = validateEval(input());
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, cases: realManifest.cases.length });
    expect(r.composition.FULL_CLEAN_RETURN).toEqual({ REAL: realManifest.cases.filter((c) => c.caseType === "FULL_CLEAN_RETURN").length });
  });

  it("every case needs provenance matching its source", () => {
    expect(validateEval(withCase(base)).errors).toContain("case c099: missing eval/provenance/c099.json");
    expect(validateEval(withCase(base, { ...realProv, source: "WEB" })).ok).toBe(false);
    expect(validateEval(withCase(base, realProv)).ok).toBe(true);
  });

  it("WEB cases need URL, author and an open license", () => {
    const web = { ...base, source: "WEB", subtype: "SAME_PHOTO_TRANSFORMED" };
    const prov = { caseId: "c099", source: "WEB", url: "https://commons.wikimedia.org/wiki/File:Example.jpg", author: "Jane Doe", license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", retrievedOn: "2026-10-29" };
    expect(validateEval(withCase(web, prov)).ok).toBe(true);
    const noLicense = { ...prov } as Record<string, unknown>;
    delete noLicense.license;
    expect(validateEval(withCase(web, noLicense)).errors.join("\n")).toContain("provenance/c099.json: license");
    expect(validateEval(withCase(web, { ...prov, license: "CC-BY-NC-4.0" })).ok).toBe(false); // non-commercial is not open
    expect(validateEval(withCase(web, { ...prov, author: "" })).ok).toBe(false);
  });

  it("generated cases need generator details and are flagged until human-verified", () => {
    const hybrid = { ...base, source: "HYBRID", caseType: "NEW_DAMAGE", subtype: undefined, humanVerified: false, expected: { baselineMarks: [], newFindings: [{ damageType: "SCRATCH", severity: "MINOR" }], shouldCharge: true } };
    const prov = { caseId: "c099", source: "HYBRID", before: { capturedBy: "owner", capturedOn: "2026-10-29" }, after: { model: "gemini-2.5-flash-image", prompt: "add a light scratch", date: "2026-10-29" } };
    const r = validateEval(withCase(hybrid, prov));
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("case c099: generated image not yet human-verified (excluded from runs)");
    expect(validateEval(withCase(hybrid, { ...prov, after: { model: "x", date: "2026-10-29" } })).ok).toBe(false);
  });

  it("expected answers must be consistent with the case type", () => {
    const errs = (c: Record<string, unknown>) => validateEval(withCase({ ...base, ...c }, realProv)).errors.join("\n");
    expect(errs({ subtype: undefined })).toContain("NO_CHANGE needs a subtype");
    expect(errs({ expected: { baselineMarks: [], newFindings: [], shouldCharge: true } })).toContain("shouldCharge must be true exactly when");
    expect(errs({ caseType: "PREEXISTING_ONLY" })).toContain("PREEXISTING_ONLY needs baseline marks");
    expect(errs({ caseType: "QUALITY_FAIL" })).toContain("QUALITY_FAIL expects usable=false");
    expect(validateEval(withCase({ ...base, caseType: "QUALITY_FAIL", subtype: undefined, expected: { baselineMarks: [], newFindings: [], shouldCharge: false, usable: false } }, realProv)).ok).toBe(true);
  });

  it("FULL_CLEAN_RETURN must be REAL, cover every angle, and expect NO_NEW_DAMAGE", () => {
    const c006 = structuredClone(realManifest.cases.find((c) => c.caseId === "c006")!);
    const angles = { ...(c006.angles as Record<string, unknown>) };
    delete angles.bottom;
    const e = validateEval(withCase({ ...c006, caseId: "c099", angles, source: "HYBRID" }, { ...realProv, source: "HYBRID", before: { capturedBy: "owner", capturedOn: "2026-10-29" }, after: { model: "m", prompt: "p", date: "2026-10-29" } })).errors.join("\n");
    expect(e).toContain("missing angles bottom");
    expect(e).toContain("FULL_CLEAN_RETURN must be REAL");
  });

  it("rejects unknown items/angles, duplicate ids, path traversal and missing files", () => {
    expect(validateEval(withCase({ ...base, item: "kayak" }, realProv)).errors.join()).toContain('unknown item "kayak"');
    expect(validateEval(withCase({ ...base, angleId: "inside" }, realProv)).errors.join()).toContain('angle "inside" is not an angle of backpack');
    expect(validateEval(withCase({ ...base, caseId: "c001" })).errors.join()).toContain("duplicate caseId");
    expect(validateEval(withCase({ ...base, images: { before: "../../.env.local.jpg", after: "a.jpg" } }, realProv)).ok).toBe(false);
    const missing = validateEval({ ...withCase(base, realProv), fileExists: (p) => !p.startsWith("images/c099") });
    expect(missing.errors).toEqual(["case c099: missing image eval/images/c099/before.jpg", "case c099: missing image eval/images/c099/after.jpg"]);
  });
});
