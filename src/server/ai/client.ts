import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getEnv } from "@/lib/env";
import { applyLocalQuotaProject } from "../gcp";

// Vertex Gemini behind a small port, so inspection logic is unit-tested with a stub (no paid calls).
// Call shape is the one proven live in T-007 (spike/vision-check.ts): inline JPEGs, temperature 0,
// JSON structured output, 2048 max output tokens, `global` location.

export const CALL_TIMEOUT_MS = 30_000; // AI_PIPELINE.md §6: 30 s per angle

export interface ModelCall {
  systemInstruction: string;
  text: string;
  /** JPEG bytes, in order (baseline: 1; return: check-out then return). */
  images: Buffer[];
  responseJsonSchema: unknown;
}

export interface ModelResponse {
  text: string;
  usage: { input: number; output: number };
  modelVersion?: string;
}

/** The model refused the request (4xx): retrying the same inputs will not help. */
export class ModelRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

export interface ModelClient {
  readonly model: string;
  generate(call: ModelCall): Promise<ModelResponse>;
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown }).status;
  if (typeof s === "number") return s;
  const m = /"code":\s*(\d{3})/.exec(e instanceof Error ? e.message : String(e));
  return m ? Number(m[1]) : undefined;
}

export function vertexModelClient(opts: { project: string; location: string; model: string }): ModelClient {
  applyLocalQuotaProject(opts.project);
  const ai = new GoogleGenAI({ vertexai: true, project: opts.project, location: opts.location });
  return {
    model: opts.model,
    async generate(call) {
      try {
        const res = await ai.models.generateContent({
          model: opts.model,
          contents: [
            {
              role: "user",
              parts: [{ text: call.text }, ...call.images.map((b) => ({ inlineData: { mimeType: "image/jpeg", data: b.toString("base64") } }))],
            },
          ],
          config: {
            systemInstruction: call.systemInstruction,
            temperature: 0,
            responseMimeType: "application/json",
            responseJsonSchema: call.responseJsonSchema,
            maxOutputTokens: 2048,
            httpOptions: { timeout: CALL_TIMEOUT_MS },
          },
        });
        const u = res.usageMetadata;
        return {
          text: res.text ?? "",
          usage: { input: u?.promptTokenCount ?? 0, output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) },
          modelVersion: res.modelVersion,
        };
      } catch (e) {
        const status = statusOf(e);
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          throw new ModelRequestError(status, `model request rejected (HTTP ${status})`);
        }
        throw e;
      }
    },
  };
}

let shared: ModelClient | undefined;

/** Process-wide client from env (GEMINI_MODEL pinned in T-007, VERTEX_LOCATION=global). */
export function modelClient(): ModelClient {
  if (!shared) {
    const env = getEnv();
    if (!env.GCP_PROJECT_ID || !env.VERTEX_LOCATION || !env.GEMINI_MODEL) {
      throw new Error("Set GCP_PROJECT_ID, VERTEX_LOCATION and GEMINI_MODEL for AI inspection");
    }
    shared = vertexModelClient({ project: env.GCP_PROJECT_ID, location: env.VERTEX_LOCATION, model: env.GEMINI_MODEL });
  }
  return shared;
}
