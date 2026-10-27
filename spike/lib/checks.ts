/**
 * PASS/FAIL evaluation for E5 (idempotency) and E6 (negative test). Pure; inputs are recorded
 * PayPal responses, outputs carry the evidence each verdict is based on.
 */
import type { PpResponse } from "./paypal";
import { idAndStatus } from "./bodies";

export interface Check {
  name: string;
  pass: boolean;
  evidence: string;
}

const ok = (res: PpResponse) => res.status >= 200 && res.status < 300;

/** Number of captures listed on an order (`purchase_units[0].payments.captures`), or undefined. */
export function countCaptures(order: unknown): number | undefined {
  const captures = (order as { purchase_units?: { payments?: { captures?: unknown } }[] } | null)
    ?.purchase_units?.[0]?.payments?.captures;
  if (captures === undefined) return 0;
  return Array.isArray(captures) ? captures.length : undefined;
}

/** E5: the same capture sent twice with one PayPal-Request-Id must yield one capture. */
export function evaluateIdempotency(
  first: PpResponse,
  second: PpResponse,
  orderAfter: PpResponse,
  capturesBefore: number | undefined,
): Check[] {
  const a = idAndStatus(first.json);
  const b = idAndStatus(second.json);
  const after = countCaptures(orderAfter.json);
  return [
    { name: "first capture succeeded", pass: ok(first) && !!a.id, evidence: `HTTP ${first.status}, capture ${a.id}, status ${a.status}` },
    { name: "repeat returned success", pass: ok(second) && !!b.id, evidence: `HTTP ${second.status}, capture ${b.id}, status ${b.status}` },
    { name: "same capture id returned", pass: !!a.id && a.id === b.id, evidence: `${a.id} vs ${b.id}` },
    {
      name: "exactly one new capture on the order",
      pass: ok(orderAfter) && after !== undefined && capturesBefore !== undefined && after - capturesBefore === 1,
      evidence: `captures before ${capturesBefore}, after ${after} (GET order HTTP ${orderAfter.status})`,
    },
  ];
}

/** E6: a mocked capture error must come back as a parsed 4xx and must not create a capture. */
export function evaluateNegative(
  res: PpResponse,
  code: string,
  capturesBefore: number | undefined,
  orderAfter: PpResponse,
): Check[] {
  const body = res.json as { name?: unknown; details?: { issue?: unknown }[] } | null;
  const issues = Array.isArray(body?.details) ? body.details.map((d) => d?.issue) : [];
  const after = countCaptures(orderAfter.json);
  return [
    { name: "error status returned", pass: res.status >= 400 && res.status < 500, evidence: `HTTP ${res.status}` },
    { name: "error body parsed", pass: typeof body?.name === "string", evidence: `name ${String(body?.name)}` },
    { name: `issue ${code} present`, pass: issues.includes(code), evidence: `issues [${issues.join(", ")}]` },
    {
      name: "no capture created",
      pass: ok(orderAfter) && after !== undefined && after === capturesBefore,
      evidence: `captures before ${capturesBefore}, after ${after}`,
    },
  ];
}

export function printChecks(title: string, checks: Check[]): number {
  console.log(`\n${title}`);
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name} — ${c.evidence}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed === 0 ? "  RESULT: PASS" : `  RESULT: FAIL (${failed} of ${checks.length} checks)`);
  return failed === 0 ? 0 : 1;
}
