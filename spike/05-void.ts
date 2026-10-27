/**
 * Step 5 — void the authorization (docs/PAYPAL_INTEGRATION.md §5.5). Empty body.
 * Records whether PayPal answers 204 or 200 with a representation. In E2 an error is a result.
 *
 *   npx tsx spike/05-void.ts --exp E1 [--auth <authorizationId>]
 */
import { parseVoidArgs } from "./lib/args";
import { idAndStatus } from "./lib/bodies";
import { report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { loadState, saveState } from "./lib/state";

runScript("05-void", async (argv) => {
  const args = parseVoidArgs(argv);
  const state = await loadState(args.exp);
  const authId = args.auth ?? state.authorizationId;
  if (!authId) throw new Error(`No authorization id for ${args.exp}; run 02 first or pass --auth`);

  const attempt = state.attempts.void + 1;
  const path = `/v2/payments/authorizations/${authId}/void`;
  const requestId = `spike:${state.runId}:void:${attempt}`;
  const res = await pp("POST", path, undefined, { requestId });
  const file = await record(`${args.exp}-05-void-${attempt}`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body: null },
    response: res,
  });

  const { id, status } = idAndStatus(res.json);
  await saveState({
    ...state,
    attempts: { ...state.attempts, void: attempt },
    voids: [...state.voids, { attempt, httpStatus: res.status, id, status }],
  });
  return report(
    `${args.exp} void ${authId}`,
    res,
    [res.status === 204 ? "204 No Content (no representation returned)" : `authorization status ${status}`],
    file,
  );
});
