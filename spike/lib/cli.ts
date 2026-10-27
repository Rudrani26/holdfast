import type { PpResponse } from "./paypal";
import { describePayPalError } from "./bodies";
import { UsageError } from "./args";

/**
 * Runs a spike script's main. Sets process.exitCode rather than calling process.exit(): exiting
 * while fetch's keep-alive socket closes trips a libuv assertion on Windows (seen in T-002).
 */
export function runScript(name: string, main: (argv: string[]) => Promise<number>): void {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const usage = error instanceof UsageError ? " (usage: see spike/run-guide.md)" : "";
      console.error(`${name} ERROR: ${error instanceof Error ? error.message : String(error)}${usage}`);
      process.exitCode = 1;
    },
  );
}

export const isOk = (res: PpResponse) => res.status >= 200 && res.status < 300;

/** Prints `HTTP <status>` plus either the given detail lines or the PayPal error summary. */
export function report(step: string, res: PpResponse, details: string[], file: string): number {
  const ok = isOk(res);
  console.log(`${step}: HTTP ${res.status} ${ok ? "OK" : "ERROR"}`);
  if (ok) for (const line of details) console.log(`  ${line}`);
  else console.log(`  ${describePayPalError(res.json)}`);
  if (res.requestId) console.log(`  PayPal-Request-Id: ${res.requestId}`);
  console.log(`  Recorded: ${file}`);
  return ok ? 0 : 1;
}
