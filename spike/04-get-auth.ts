/**
 * Step 4 — read current PayPal state (docs/PAYPAL_INTEGRATION.md §5.7). Defaults to the
 * authorization; `--what` also reads the order, latest capture, or latest refund.
 *
 *   npx tsx spike/04-get-auth.ts --exp E1 --label after-capture [--what auth|order|capture|refund] [--id <id>]
 */
import { parseGetArgs } from "./lib/args";
import { idAndStatus } from "./lib/bodies";
import { report, runScript } from "./lib/cli";
import { pp } from "./lib/paypal";
import { record } from "./lib/record";
import { lastSucceeded, loadState, type RunState } from "./lib/state";

const PATHS = {
  auth: (id: string) => `/v2/payments/authorizations/${id}`,
  order: (id: string) => `/v2/checkout/orders/${id}`,
  capture: (id: string) => `/v2/payments/captures/${id}`,
  refund: (id: string) => `/v2/payments/refunds/${id}`,
} as const;

function idFromState(what: keyof typeof PATHS, state: RunState): string | undefined {
  if (what === "auth") return state.authorizationId;
  if (what === "order") return state.orderId;
  if (what === "capture") return lastSucceeded(state.captures)?.id;
  return lastSucceeded(state.refunds)?.id;
}

runScript("04-get-auth", async (argv) => {
  const args = parseGetArgs(argv);
  const state = await loadState(args.exp);
  const id = args.id ?? idFromState(args.what, state);
  if (!id) throw new Error(`No ${args.what} id for ${args.exp} in run state; pass --id`);

  const path = PATHS[args.what](id);
  const res = await pp("GET", path);
  const file = await record(`${args.exp}-04-get-${args.what}-${args.label}`, {
    runId: state.runId,
    request: { method: "GET", path },
    response: res,
  });

  const json = res.json as { amount?: { value?: unknown } } | null;
  return report(
    `${args.exp} GET ${args.what} ${id} (${args.label})`,
    res,
    [`status ${idAndStatus(res.json).status}${json?.amount?.value ? ` · amount ${String(json.amount.value)}` : ""}`],
    file,
  );
});
