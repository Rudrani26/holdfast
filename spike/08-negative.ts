/**
 * E6 — Negative test (docs/PAYPAL_INTEGRATION.md §3). Sends a capture with
 * `PayPal-Mock-Response: {"mock_application_codes":"<CODE>"}` and checks the error is returned,
 * parsed, and that no capture was created. Prints PASS/FAIL per check.
 *
 *   npx tsx spike/08-negative.ts --exp E5 [--code DUPLICATE_INVOICE_ID] [--amount 1.00]
 *
 * Code source: PayPal "Simulate negative responses with request headers" — lists Payments v2
 * "capture authorized payment" as supporting PayPal-Mock-Response and uses DUPLICATE_INVOICE_ID as
 * its example (UNPROCESSABLE_ENTITY, details[].issue). Fetched 2026-10-27:
 * https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
 *
 * Needs an authorization with remaining amount (E5's works: its capture used final_capture:false).
 */
import { parseNegativeArgs } from "./lib/args";
import { buildCaptureBody } from "./lib/bodies";
import { countCaptures, evaluateNegative, printChecks } from "./lib/checks";
import { runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { loadState } from "./lib/state";

runScript("08-negative", async (argv) => {
  const args = parseNegativeArgs(argv);
  const state = await loadState(args.exp);
  if (!state.orderId || !state.authorizationId) {
    throw new Error(`${args.exp} has no authorized order; run 01, approve, then 02`);
  }

  const orderPath = `/v2/checkout/orders/${state.orderId}`;
  const before = await pp("GET", orderPath);
  const capturesBefore = countCaptures(before.json);

  const path = `/v2/payments/authorizations/${state.authorizationId}/capture`;
  const requestId = `spike:${state.runId}:negative:${args.code}:${Date.now()}`;
  const body = buildCaptureBody({ amount: args.amount, finalCapture: false, invoiceId: `HF-${state.runId}-neg-${Date.now()}` });
  const res = await pp("POST", path, body, { requestId, mockCode: args.code });
  const after = await pp("GET", orderPath);

  const checks = evaluateNegative(res, args.code, capturesBefore, after);
  const file = await record(`E6-08-negative-${args.code}`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, mockCode: args.code, body },
    orderBefore: before,
    response: res,
    orderAfter: after,
    checks,
  });
  const code = printChecks(`E6 negative test: mock ${args.code} on ${state.authorizationId}`, checks);
  console.log(`  Recorded: ${file}`);
  return code;
});
