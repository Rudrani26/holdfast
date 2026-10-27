/**
 * Step 3 — capture all or part of the authorization (docs/PAYPAL_INTEGRATION.md §5.4).
 *
 *   npx tsx spike/03-capture.ts --exp E1 --amount 38.00 --final false [--auth <authorizationId>]
 *
 * Each attempt gets a fresh PayPal-Request-Id and invoice_id (attempt counter in run state).
 */
import { parseCaptureArgs } from "./lib/args";
import { buildCaptureBody, idAndStatus } from "./lib/bodies";
import { report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { loadState, saveState } from "./lib/state";

runScript("03-capture", async (argv) => {
  const args = parseCaptureArgs(argv);
  const state = await loadState(args.exp);
  const authId = args.auth ?? state.authorizationId;
  if (!authId) throw new Error(`No authorization id for ${args.exp}; run 02 first or pass --auth`);

  const attempt = state.attempts.capture + 1;
  const path = `/v2/payments/authorizations/${authId}/capture`;
  const requestId = `spike:${state.runId}:capture:${attempt}`;
  const body = buildCaptureBody({
    amount: args.amount,
    finalCapture: args.final,
    invoiceId: `HF-${state.runId}-${attempt}`,
  });

  const res = await pp("POST", path, body, { requestId });
  const file = await record(`${args.exp}-03-capture-${attempt}`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body },
    response: res,
  });

  const { id, status } = idAndStatus(res.json);
  await saveState({
    ...state,
    attempts: { ...state.attempts, capture: attempt },
    captures: [
      ...state.captures,
      { attempt, httpStatus: res.status, id, status, amount: args.amount, final: args.final },
    ],
  });
  return report(
    `${args.exp} capture $${args.amount} final_capture=${args.final} on ${authId}`,
    res,
    [`capture ${id} · status ${status}`],
    file,
  );
});
