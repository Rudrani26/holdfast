/**
 * E5 — Idempotency (docs/PAYPAL_INTEGRATION.md §3, §6). Sends the same partial capture twice
 * with one PayPal-Request-Id, then reads the order to count captures. Prints PASS/FAIL per check.
 *
 *   npx tsx spike/07-idempotency.ts --exp E5 [--amount 38.00]
 *
 * Needs an authorized order for <exp> (01 → owner approval → 02). The request id is fixed per run,
 * so re-running this script repeats the same request again rather than capturing more.
 */
import { parseIdempotencyArgs } from "./lib/args";
import { buildCaptureBody } from "./lib/bodies";
import { evaluateIdempotency, countCaptures, printChecks } from "./lib/checks";
import { runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { loadState } from "./lib/state";

runScript("07-idempotency", async (argv) => {
  const args = parseIdempotencyArgs(argv);
  const state = await loadState(args.exp);
  if (!state.orderId || !state.authorizationId) {
    throw new Error(`${args.exp} has no authorized order; run 01, approve, then 02`);
  }

  const orderPath = `/v2/checkout/orders/${state.orderId}`;
  const before = await pp("GET", orderPath);
  const capturesBefore = countCaptures(before.json);

  const path = `/v2/payments/authorizations/${state.authorizationId}/capture`;
  const requestId = `spike:${state.runId}:idempotency-capture`;
  const body = buildCaptureBody({ amount: args.amount, finalCapture: false, invoiceId: `HF-${state.runId}-idem` });

  const first = await pp("POST", path, body, { requestId });
  const second = await pp("POST", path, body, { requestId });
  const after = await pp("GET", orderPath);

  const checks = evaluateIdempotency(first, second, after, capturesBefore);
  const file = await record(`${args.exp}-07-idempotency`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body, sentTwice: true },
    orderBefore: before,
    first,
    second,
    orderAfter: after,
    checks,
  });
  const code = printChecks(`${args.exp} idempotency (PayPal-Request-Id ${requestId})`, checks);
  console.log(`  Recorded: ${file}`);
  return code;
});
