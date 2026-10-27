/**
 * Step 1 — create an AUTHORIZE order (docs/PAYPAL_INTEGRATION.md §5.1), print the buyer approval
 * link, and STOP. The owner approves in the browser as the sandbox personal account, then runs 02.
 *
 *   npx tsx spike/01-create-order.ts --exp E1 [--amount 200.00] [--item "Spike test item"]
 *
 * Starts a new run for <exp>: replaces spike/results/state-<exp>.json.
 */
import { parseCreateOrderArgs } from "./lib/args";
import { approvalLink, buildCreateOrderBody, idAndStatus } from "./lib/bodies";
import { isOk, report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { newRunState, saveState } from "./lib/state";

runScript("01-create-order", async (argv) => {
  const args = parseCreateOrderArgs(argv);
  const state = newRunState(args.exp);
  const path = "/v2/checkout/orders";
  const body = buildCreateOrderBody({
    referenceId: `spike-${state.runId}`,
    amount: args.amount,
    itemName: args.item,
  });
  const requestId = `spike:${state.runId}:create-order`;

  const res = await pp("POST", path, body, { requestId });
  const file = await record(`${args.exp}-01-create-order`, {
    runId: state.runId,
    request: { method: "POST", path, requestId, body },
    response: res,
  });

  const { id, status } = idAndStatus(res.json);
  const link = approvalLink(res.json);
  if (isOk(res) && id) {
    await saveState({ ...state, orderId: id, orderAmount: args.amount });
  }
  const code = report(
    `${args.exp} create order ($${args.amount} AUTHORIZE)`,
    res,
    [`order ${id} · status ${status}`, `run ${state.runId}`],
    file,
  );
  if (code === 0) {
    if (!link) {
      console.log("  No payer-action/approve link in the response — see the recorded JSON.");
      return 1;
    }
    console.log("\n[OWNER] Open this link, log in as the sandbox PERSONAL (buyer) account, and approve:");
    console.log(`  ${link}`);
    console.log(`Then run: npx tsx spike/02-authorize.ts --exp ${args.exp}`);
  }
  return code;
});
