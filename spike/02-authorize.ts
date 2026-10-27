/**
 * Step 2 — authorize the buyer-approved order (docs/PAYPAL_INTEGRATION.md §5.3).
 *
 *   npx tsx spike/02-authorize.ts --exp E1 [--order <orderId>]
 */
import { parseAuthorizeArgs } from "./lib/args";
import { extractAuthorization, idAndStatus } from "./lib/bodies";
import { isOk, report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { loadState, saveState } from "./lib/state";

runScript("02-authorize", async (argv) => {
  const args = parseAuthorizeArgs(argv);
  const state = await loadState(args.exp);
  const orderId = args.order ?? state.orderId;
  if (!orderId) throw new Error(`No order id for ${args.exp}; run 01 first or pass --order`);

  const path = `/v2/checkout/orders/${orderId}/authorize`;
  const requestId = `spike:${state.runId}:authorize`;
  const res = await pp("POST", path, {}, { requestId });
  const file = await record(`${args.exp}-02-authorize`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body: {} },
    response: res,
  });

  const auth = extractAuthorization(res.json);
  if (isOk(res) && auth) {
    await saveState({ ...state, orderId, authorizationId: auth.id });
  }
  const code = report(
    `${args.exp} authorize order ${orderId}`,
    res,
    [
      `order status ${idAndStatus(res.json).status}`,
      `authorization ${auth?.id} · status ${auth?.status} · amount ${auth?.amount}`,
      `expires ${auth?.expirationTime}`,
    ],
    file,
  );
  if (code === 0 && !auth) {
    console.log("  No authorization found in purchase_units[0].payments — see the recorded JSON.");
    return 1;
  }
  return code;
});
