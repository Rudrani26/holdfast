/**
 * T-007 — Vision feasibility check (docs/AI_PIPELINE.md §1, §4–§6). Runs the RETURN prompt on each
 * owner-supplied pair with up to 2 candidate Gemini models on Vertex AI and records validity,
 * findings vs truth, latency and token usage. LIVE model calls only; hard cap 20 calls (retries count).
 *
 *   npx tsx --conditions=react-server spike/vision-check.ts --list
 *   npx tsx --conditions=react-server spike/vision-check.ts --models <id-a>,<id-b> [--max-calls 20]
 *
 * Pairs: eval/spike-pairs/<n>/before.jpg, after.jpg, truth.txt (see spike/lib/vision.ts parseTruth).
 * Needs GCP_PROJECT_ID and VERTEX_LOCATION in .env.local, Application Default Credentials, and the
 * Vertex AI API enabled on the project (owner-approved). Spends Free Trial credits.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { config as loadDotenv } from "dotenv";
import sharp from "sharp";
import { PROMPT_VERSION, returnUserText, SYSTEM_INSTRUCTION } from "../src/server/ai/prompts";
import { ReturnResult, toModelJsonSchema } from "../src/server/ai/schemas";
import { runScript } from "./lib/cli";
import { record } from "./lib/record";
import { CallBudget, parseTruth, scorePair, visionArgsSchema, type Truth } from "./lib/vision";

const CALL_TIMEOUT_MS = 30_000;

/** AI_PIPELINE.md §3: EXIF rotate, strip metadata, long edge ≤ 1600 px, JPEG q85. */
async function normalize(file: string): Promise<{ data: string; sha256: string; width: number; height: number }> {
  const { data, info } = await sharp(await readFile(file))
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return {
    data: data.toString("base64"),
    sha256: createHash("sha256").update(data).digest("hex"),
    width: info.width,
    height: info.height,
  };
}

interface Attempt {
  attempt: number;
  latencyMs: number;
  valid: boolean;
  error?: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  rawText?: string;
}

interface Row {
  model: string;
  pair: string;
  truth: Truth;
  images: { before: string; after: string };
  attempts: Attempt[];
  validFirstTry: boolean;
  validAfterRetry: boolean;
  result?: ReturnResult;
  score?: ReturnType<typeof scorePair>;
}

interface Pair {
  id: string;
  truth: Truth;
  before: Awaited<ReturnType<typeof normalize>>;
  after: Awaited<ReturnType<typeof normalize>>;
}

async function loadPairs(dir: string): Promise<Pair[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
  const pairs: Pair[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
    const p = path.join(dir, e.name);
    pairs.push({
      id: e.name,
      truth: parseTruth(await readFile(path.join(p, "truth.txt"), "utf8")),
      before: await normalize(path.join(p, "before.jpg")),
      after: await normalize(path.join(p, "after.jpg")),
    });
  }
  return pairs;
}

function vertexClient(locationOverride?: string): GoogleGenAI {
  loadDotenv({ path: ".env.local", quiet: true });
  const project = process.env.GCP_PROJECT_ID;
  const location = locationOverride ?? process.env.VERTEX_LOCATION;
  if (!project || project.startsWith("<") || !location || location.startsWith("<")) {
    throw new Error("Set GCP_PROJECT_ID and VERTEX_LOCATION in .env.local");
  }
  // Application Default Credentials carry a quota project (the gcloud default at login time). Bill
  // and quota-check against the Holdfast project instead, unless the caller chose one explicitly.
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
  return new GoogleGenAI({ vertexai: true, project, location });
}

runScript("vision-check", async (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      list: { type: "boolean" },
      models: { type: "string" },
      pairs: { type: "string" },
      "max-calls": { type: "string" },
      location: { type: "string" },
    },
    strict: true,
  });
  const args = visionArgsSchema.parse({ ...values, maxCalls: values["max-calls"] });
  const ai = vertexClient(args.location);
  if (args.location) process.env.VERTEX_LOCATION = args.location;

  if (args.list) {
    // Model listing is a metadata call, not a generation call; it does not count toward the cap.
    const names: string[] = [];
    for await (const m of await ai.models.list({ config: { pageSize: 100 } })) {
      if (m.name && /gemini/i.test(m.name)) names.push(m.name.replace(/^.*\/models\//, ""));
    }
    console.log(`Gemini models offered in ${process.env.VERTEX_LOCATION}:`);
    for (const n of names.sort()) console.log(`  ${n}`);
    await record("vision-models", { location: process.env.VERTEX_LOCATION, models: names });
    return 0;
  }
  if (args.models.length === 0) throw new Error("pass --models <id-a>,<id-b> (run --list first)");

  const pairs = await loadPairs(args.pairs);
  if (pairs.length === 0) throw new Error(`no pairs in ${args.pairs}`);
  const budget = new CallBudget(args.maxCalls);
  const responseJsonSchema = toModelJsonSchema(ReturnResult);
  const rows: Row[] = [];

  const unavailable = new Set<string>();
  for (const model of args.models) {
    for (const pair of pairs) {
      if (unavailable.has(model)) {
        console.log(`${model.padEnd(28)} pair ${pair.id.padEnd(4)} SKIPPED (model not available to this project)`);
        continue;
      }
      const angleId = `pair-${pair.id}`;
      const text = returnUserText({ itemName: "Rental item", angleId, angleLabel: "as photographed", baselineMarks: [] });
      const attempts: Attempt[] = [];
      let parsed: ReturnResult | undefined;
      for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
        if (!budget.take()) break;
        const started = Date.now();
        try {
          const res = await ai.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  { text },
                  { inlineData: { mimeType: "image/jpeg", data: pair.before.data } },
                  { inlineData: { mimeType: "image/jpeg", data: pair.after.data } },
                ],
              },
            ],
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              temperature: 0,
              responseMimeType: "application/json",
              responseJsonSchema,
              maxOutputTokens: 2048,
              httpOptions: { timeout: CALL_TIMEOUT_MS },
            },
          });
          const latencyMs = Date.now() - started;
          let json: unknown;
          let error: string | undefined;
          try {
            json = JSON.parse(res.text ?? "");
            const v = ReturnResult.safeParse(json);
            if (v.success) parsed = v.data;
            else error = `schema: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
          } catch (e) {
            error = `json: ${e instanceof Error ? e.message : String(e)}`;
          }
          attempts.push({ attempt, latencyMs, usage: res.usageMetadata, modelVersion: res.modelVersion, rawText: res.text, valid: !!parsed, error });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          attempts.push({ attempt, latencyMs: Date.now() - started, valid: false, error: `call: ${message}` });
          // 4xx (not found, no access, bad request) will not change on retry; don't spend budget on it.
          const status = /"code":\s*(\d{3})/.exec(message)?.[1];
          if (status && status.startsWith("4")) {
            if (status === "404" || status === "403") unavailable.add(model);
            break;
          }
        }
      }

      const score = parsed ? scorePair(pair.truth, parsed.findings) : undefined;
      const last = attempts.at(-1);
      rows.push({
        model,
        pair: pair.id,
        truth: pair.truth,
        images: { before: pair.before.sha256, after: pair.after.sha256 },
        attempts,
        validFirstTry: attempts[0]?.valid ?? false,
        validAfterRetry: !!parsed,
        result: parsed,
        score,
      });
      console.log(
        `${model.padEnd(28)} pair ${pair.id.padEnd(4)} truth ${pair.truth.kind.padEnd(10)} ` +
          (attempts.length === 0
            ? "SKIPPED (call budget exhausted)"
            : parsed
              ? `${score?.correct ? "CORRECT" : "WRONG  "} ${score?.reason} · noChange ${parsed.noChangeConfidence} · ${last?.latencyMs} ms`
              : `INVALID after ${attempts.length} attempt(s): ${last?.error}`),
      );
    }
  }

  const summary = args.models.map((model) => {
    const r = rows.filter((x) => x.model === model);
    const noChange = r.filter((x) => x.truth.kind === "NO_CHANGE");
    const tokens = r.flatMap((x) => x.attempts).reduce(
      (acc, a) => ({
        input: acc.input + (a.usage?.promptTokenCount ?? 0),
        output: acc.output + (a.usage?.candidatesTokenCount ?? 0) + (a.usage?.thoughtsTokenCount ?? 0),
      }),
      { input: 0, output: 0 },
    );
    const latencies = r.flatMap((x) => x.attempts.map((a) => a.latencyMs)).sort((a, b) => a - b);
    return {
      model,
      pairs: r.length,
      correct: r.filter((x) => x.score?.correct).length,
      noChangePairs: noChange.length,
      noChangeCorrect: noChange.filter((x) => x.score?.correct).length,
      validFirstTry: r.filter((x) => x.validFirstTry).length,
      validAfterRetry: r.filter((x) => x.validAfterRetry).length,
      latencyMsP50: latencies[Math.floor(latencies.length / 2)],
      tokens,
      gate:
        r.filter((x) => x.score?.correct).length >= 4 &&
        noChange.length >= 2 &&
        noChange.every((x) => x.score?.correct) &&
        r.every((x) => x.validAfterRetry),
    };
  });

  const file = await record(`vision-check-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`, {
    promptVersion: PROMPT_VERSION,
    location: process.env.VERTEX_LOCATION,
    callsUsed: budget.spent,
    callCap: budget.limit,
    summary,
    rows,
  });
  console.log(`\nCalls used: ${budget.spent}/${budget.limit}`);
  for (const s of summary) {
    console.log(
      `${s.model}: ${s.correct}/${s.pairs} correct · no-change ${s.noChangeCorrect}/${s.noChangePairs} · ` +
        `schema-valid ${s.validFirstTry}/${s.pairs} first try, ${s.validAfterRetry}/${s.pairs} after retry · ` +
        `p50 ${s.latencyMsP50} ms · tokens in ${s.tokens.input} / out ${s.tokens.output} · GATE ${s.gate ? "PASS" : "FAIL"}`,
    );
  }
  console.log(`Recorded: ${file}`);
  return summary.some((s) => s.gate) ? 0 : 1;
});
