/**
 * Per-experiment run state (`spike/results/state-<exp>.json`): the PayPal IDs each later step
 * needs, so the owner does not copy IDs by hand. Contains IDs and amounts only, never secrets.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_RESULTS_DIR } from "./record";

export interface OpResult {
  attempt: number;
  httpStatus: number;
  id?: string;
  status?: string;
  amount: string;
  final?: boolean;
}

export interface RunState {
  exp: string;
  runId: string;
  createdAt: string;
  orderId?: string;
  orderAmount?: string;
  authorizationId?: string;
  captures: OpResult[];
  refunds: OpResult[];
  voids: Omit<OpResult, "amount">[];
  /** Attempt counters, incremented on every POST so retries get fresh request IDs and invoice IDs. */
  attempts: { capture: number; void: number; refund: number };
}

/** `E1-20261027T220630Z`-style run id; part of every PayPal-Request-Id and invoice_id. */
export function newRunId(exp: string, now: Date = new Date()): string {
  return `${exp}-${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

export function newRunState(exp: string, now: Date = new Date()): RunState {
  return {
    exp,
    runId: newRunId(exp, now),
    createdAt: now.toISOString(),
    captures: [],
    refunds: [],
    voids: [],
    attempts: { capture: 0, void: 0, refund: 0 },
  };
}

const stateFile = (exp: string, dir: string) => path.join(dir, `state-${exp}.json`);

export async function loadState(exp: string, dir: string = DEFAULT_RESULTS_DIR): Promise<RunState> {
  try {
    return JSON.parse(await readFile(stateFile(exp, dir), "utf8")) as RunState;
  } catch {
    throw new Error(`No run state for ${exp}. Start with: npx tsx spike/01-create-order.ts --exp ${exp}`);
  }
}

export async function saveState(state: RunState, dir: string = DEFAULT_RESULTS_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(stateFile(state.exp, dir), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Last successful (2xx, has id) operation in a list. */
export function lastSucceeded<T extends { httpStatus: number; id?: string }>(ops: T[]): T | undefined {
  return [...ops].reverse().find((op) => op.httpStatus >= 200 && op.httpStatus < 300 && op.id);
}
