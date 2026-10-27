/**
 * Step 6 — refund part of a capture (docs/PAYPAL_INTEGRATION.md §5.6). Used by E4 (fallback mode).
 *
 *   npx tsx spike/06-refund.ts --exp E4 --amount 162.00 [--capture <captureId>]
 */
import { parseRefundArgs } from "./lib/args";
import { buildRefundBody, idAndStatus } from "./lib/bodies";
import { report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { lastSucceeded, loadState, saveState } from "./lib/state";

runScript("06-refund", async (argv) => {
  const args = parseRefundArgs(argv);
  const state = await loadState(args.exp);
  const captureId = args.capture ?? lastSucceeded(state.captures)?.id;
  if (!captureId) throw new Error(`No successful capture for ${args.exp}; run 03 first or pass --capture`);

  const attempt = state.attempts.refund + 1;
  const path = `/v2/payments/captures/${captureId}/refund`;
  const requestId = `spike:${state.runId}:refund:${attempt}`;
  const body = buildRefundBody({ amount: args.amount });
  const res = await pp("POST", path, body, { requestId });
  const file = await record(`${args.exp}-06-refund-${attempt}`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body },
    response: res,
  });

  const { id, status } = idAndStatus(res.json);
  await saveState({
    ...state,
    attempts: { ...state.attempts, refund: attempt },
    refunds: [...state.refunds, { attempt, httpStatus: res.status, id, status, amount: args.amount }],
  });
  return report(
    `${args.exp} refund $${args.amount} of capture ${captureId}`,
    res,
    [`refund ${id} · status ${status}`],
    file,
  );
});
