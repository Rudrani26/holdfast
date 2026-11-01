import "server-only";
import { ALLOWED_FROM, settleGuard, transition } from "@/domain/rentalMachine";
import { plan, type SettlementOp } from "@/domain/settlementPlanner";
import {
  DomainError,
  type Cents,
  type IsoTime,
  type PaymentState,
  type Rental,
  type RentalStatus,
  type SettlementRecord,
} from "@/domain/types";
import { formatUsd } from "@/lib/money";
import { settledCopy } from "@/lib/settlementCopy";
import type { PayPalClient } from "./paypal/client";
import { PayPalApiError, staffMessage } from "./paypal/errors";
import { getOrderPayments } from "./paypal/orders";
import { captureAuthorization, invoiceId, refundCapture, settlementRequestId, voidAuthorization } from "./paypal/payments";
import type { Repo, Tx } from "./repo/types";

// Settlement executor (TASKS T-022; PAYPAL_INTEGRATION.md §5.4–§5.6, §6). Runs the planner's ops in
// order. Each op is guarded by `settlements/settle:<rentalId>:<seq>:<op>`, created PENDING in a
// transaction before PayPal is called; the same key is the PayPal-Request-Id. Only staff routes call
// this, after the recorded staff and renter approvals that settleGuard checks.

/** One settlement round per rental in the MVP (a post-capture contest refund would be round 2). */
export const SETTLEMENT_SEQ = 1;
/** A PENDING lock younger than this belongs to a call still in flight (3 attempts × 30 s + backoff). */
export const LEASE_MS = 3 * 60 * 1000;
/** Waits between the 3 attempts of an op whose outcome is unknown (§6.3). */
export const BACKOFF_MS = [1000, 3000] as const;
const MAX_ATTEMPTS = 3;

export interface SettlementDeps {
  repo: Repo;
  paypal: PayPalClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export type SettlementOutcome =
  | { ok: true; rental: Rental; records: SettlementRecord[] }
  | { ok: false; rental: Rental; records: SettlementRecord[]; error: { code: string; message: string } };

const iso = (deps: SettlementDeps): IsoTime => (deps.now?.() ?? new Date()).toISOString();
const sleepFor = (deps: SettlementDeps) => deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

async function mustGetRental(repo: Repo | Tx, rentalId: string): Promise<Rental> {
  const rental = await repo.getRental(rentalId);
  if (!rental) throw new DomainError("RENTAL_NOT_FOUND", "Rental not found.");
  return rental;
}

function apply(result: Rental | DomainError): Rental {
  if (result instanceof DomainError) throw result;
  return result;
}

const opLabel = (op: SettlementOp) =>
  op.op === "VOID" ? "Void authorization" : `${op.op === "CAPTURE" ? "Capture" : "Refund"} ${formatUsd(op.amountCents)}`;

/** Settles a READY_TO_SETTLE rental (or retries a SETTLEMENT_FAILED one) with the approved amount. */
export async function settleRental(deps: SettlementDeps, rentalId: string): Promise<SettlementOutcome> {
  let rental = await mustGetRental(deps.repo, rentalId);
  if (rental.status === "SETTLED") return { ok: true, rental, records: await deps.repo.listSettlements(rentalId) };

  if (rental.status === "SETTLEMENT_FAILED") {
    rental = await deps.repo.runTransaction(async (tx) => {
      const current = await mustGetRental(tx, rentalId);
      if (current.status !== "SETTLEMENT_FAILED") return current;
      const at = iso(deps);
      const next = apply(transition(current, { type: "SETTLEMENT_RETRY", at }));
      tx.putRental(next);
      tx.addEvent(rentalId, { id: `settlement-retry-${at}`, at, actor: "STAFF", type: "SETTLEMENT_RETRY", summary: "Staff retried settlement", data: {} });
      return next;
    });
  }

  const guard = settleGuard(rental);
  if (guard) throw guard;
  const deductionCents = rental.approvedDeductionCents!;
  const ops = plan(rental.settlementMode, rental.depositCents, deductionCents);

  const run = await runOps(deps, rental, ops, ["READY_TO_SETTLE"]);
  const records = await deps.repo.listSettlements(rentalId);
  // Same headline as the receipt: a $0 settlement after a NO_NEW_DAMAGE verdict says so.
  const cleanReturn = (await deps.repo.listInspections(rentalId)).filter((i) => i.kind === "RETURN").at(-1)?.verdict === "NO_NEW_DAMAGE";

  if (run.ok) {
    const settled = await deps.repo.runTransaction(async (tx) => {
      const current = await mustGetRental(tx, rentalId);
      if (current.status === "SETTLED") return current;
      const at = iso(deps);
      const next = apply(transition(current, { type: "SETTLEMENT_SUCCEEDED", at }));
      tx.putRental(next);
      tx.addEvent(rentalId, {
        id: `settled-${SETTLEMENT_SEQ}`,
        at,
        actor: "SYSTEM",
        type: "SETTLED",
        summary: settledCopy({ mode: next.settlementMode, depositCents: next.depositCents, deductionCents, cleanReturn }),
        data: { deductionCents, paymentState: next.paymentState },
      });
      return next;
    });
    return { ok: true, rental: settled, records };
  }

  const failed = await deps.repo.runTransaction(async (tx) => {
    const current = await mustGetRental(tx, rentalId);
    if (current.status !== "READY_TO_SETTLE") return current;
    const at = iso(deps);
    const next = apply(transition(current, { type: "SETTLEMENT_FAILED", at }));
    tx.putRental(next);
    tx.addEvent(rentalId, {
      id: `settlement-failed-${at}`,
      at,
      actor: "SYSTEM",
      type: "SETTLEMENT_FAILED",
      summary: `Settlement stopped: ${run.error.message}`,
      data: { code: run.error.code },
    });
    return next;
  });
  return { ok: false, rental: failed, records, error: run.error };
}

/** Cancels an AUTHORIZED or BASELINE_READY rental by voiding its authorization. */
export async function cancelRental(deps: SettlementDeps, rentalId: string): Promise<SettlementOutcome> {
  const rental = await mustGetRental(deps.repo, rentalId);
  if (rental.status === "CANCELLED") return { ok: true, rental, records: await deps.repo.listSettlements(rentalId) };
  if (!ALLOWED_FROM.CANCELLED.includes(rental.status)) {
    throw new DomainError("INVALID_TRANSITION", `A ${rental.status} rental cannot be cancelled.`);
  }

  const run = await runOps(deps, rental, [{ op: "VOID" }], ALLOWED_FROM.CANCELLED);
  const records = await deps.repo.listSettlements(rentalId);
  if (!run.ok) return { ok: false, rental: await mustGetRental(deps.repo, rentalId), records, error: run.error };

  const cancelled = await deps.repo.runTransaction(async (tx) => {
    const current = await mustGetRental(tx, rentalId);
    if (current.status === "CANCELLED") return current;
    const at = iso(deps);
    const next = apply(transition(current, { type: "CANCELLED", at }));
    tx.putRental(next);
    tx.addEvent(rentalId, {
      id: "cancelled",
      at,
      actor: "STAFF",
      type: "CANCELLED",
      summary: "Rental cancelled · deposit authorization voided — no charge",
      data: { paymentState: next.paymentState },
    });
    return next;
  });
  return { ok: true, rental: cancelled, records };
}

type RunResult = { ok: true } | { ok: false; error: { code: string; message: string } };

async function runOps(deps: SettlementDeps, rental: Rental, ops: SettlementOp[], allowed: readonly RentalStatus[]): Promise<RunResult> {
  for (const op of ops) {
    const claim = await claimOp(deps, rental.id, op, allowed);
    if (claim.done) continue;
    const result = await executeOp(deps, rental.id, op, claim.record, claim.reconcileFirst);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/**
 * The lock (§6.1). SUCCEEDED → skip. A fresh PENDING lock means another call is running this op →
 * SETTLEMENT_IN_PROGRESS. A stale PENDING or a FAILED lock is taken over, reconciling first.
 */
async function claimOp(deps: SettlementDeps, rentalId: string, op: SettlementOp, allowed: readonly RentalStatus[]) {
  const key = settlementRequestId(rentalId, SETTLEMENT_SEQ, op.op);
  return deps.repo.runTransaction(async (tx) => {
    const rental = await mustGetRental(tx, rentalId);
    const existing = await tx.getSettlement(key);
    if (existing?.status === "SUCCEEDED") return { done: true as const };
    if (!allowed.includes(rental.status)) {
      throw new DomainError("RENTAL_STATE_CHANGED", `Rental is ${rental.status}; settlement stopped.`);
    }
    const now = deps.now?.() ?? new Date();
    if (existing?.status === "PENDING" && now.getTime() - Date.parse(existing.updatedAt) < LEASE_MS) {
      throw new DomainError("SETTLEMENT_IN_PROGRESS", "This settlement is already running. Refresh in a moment.");
    }
    const record: SettlementRecord = {
      idempotencyKey: key,
      rentalId,
      op: op.op,
      ...(op.op === "VOID" ? {} : { amountCents: op.amountCents }),
      requestId: key,
      status: "PENDING",
      attempts: existing?.attempts ?? 0,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    tx.putSettlement(record);
    return { done: false as const, record, reconcileFirst: existing !== undefined };
  });
}

interface PayPalResult {
  id?: string;
  status?: string;
  amountCents?: Cents;
  finalCapture?: boolean;
  reconciled: boolean;
}

async function executeOp(
  deps: SettlementDeps,
  rentalId: string,
  op: SettlementOp,
  record: SettlementRecord,
  reconcileFirst: boolean,
): Promise<RunResult> {
  const rental = await mustGetRental(deps.repo, rentalId);
  const { authorizationId, orderId } = rental.paypal;
  if (!authorizationId || !orderId) return fail(deps, rentalId, record, record.attempts, "NO_AUTHORIZATION", "This rental has no PayPal authorization.");

  if (op.op === "CAPTURE") {
    const captured = rental.paypal.captures.reduce((sum, c) => sum + c.amountCents, 0);
    if (op.amountCents > rental.depositCents - captured) {
      return fail(deps, rentalId, record, record.attempts, "AMOUNT_EXCEEDS_AUTHORIZATION", "Capture would exceed the remaining authorization.");
    }
  }

  let attempts = record.attempts;
  let reconcile = reconcileFirst;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (i > 0) await sleepFor(deps)(BACKOFF_MS[i - 1]!);
    attempts++;
    try {
      const found = reconcile ? await reconcileOp(deps.paypal, rental, op) : undefined;
      const result = found ?? (await callPayPal(deps.paypal, rental, op, record.requestId));
      await succeed(deps, rentalId, op, record, attempts, result);
      return { ok: true };
    } catch (e) {
      if (e instanceof PayPalApiError) return fail(deps, rentalId, record, attempts, "PAYPAL_REJECTED", staffMessage(e));
      if (e instanceof DomainError) return fail(deps, rentalId, record, attempts, e.code, e.message);
      // Unknown outcome (timeout, 5xx, network, unreadable body): check PayPal before any retry.
      console.error(`settlement ${record.idempotencyKey} attempt ${attempts}:`, e instanceof Error ? e.message : e);
      reconcile = true;
    }
  }
  return fail(
    deps,
    rentalId,
    record,
    attempts,
    "PAYPAL_OUTCOME_UNKNOWN",
    `PayPal did not confirm "${opLabel(op)}" after ${MAX_ATTEMPTS} attempts. Retry checks PayPal first, so it cannot double-charge.`,
  );
}

async function callPayPal(paypal: PayPalClient, rental: Rental, op: SettlementOp, requestId: string): Promise<PayPalResult> {
  const authorizationId = rental.paypal.authorizationId!;
  switch (op.op) {
    case "CAPTURE": {
      const c = await captureAuthorization(paypal, {
        authorizationId,
        amountCents: op.amountCents,
        finalCapture: op.finalCapture,
        invoiceId: invoiceId(rental.id, SETTLEMENT_SEQ),
        requestId,
      });
      return { id: c.id, status: c.status, amountCents: c.amountCents ?? op.amountCents, finalCapture: c.finalCapture ?? op.finalCapture, reconciled: false };
    }
    case "VOID": {
      const v = await voidAuthorization(paypal, { authorizationId, requestId });
      return { id: authorizationId, status: v.status, reconciled: false };
    }
    case "REFUND": {
      const captureId = rental.paypal.captures[0]?.id;
      if (!captureId) throw new DomainError("NO_CAPTURE", "No capture to refund.");
      const r = await refundCapture(paypal, { captureId, amountCents: op.amountCents, requestId });
      return { id: r.id, status: r.status, amountCents: r.amountCents ?? op.amountCents, reconciled: false };
    }
  }
}

/** §6.3: did the op already take effect? Reads the order's payments; undefined means "not yet". */
async function reconcileOp(paypal: PayPalClient, rental: Rental, op: SettlementOp): Promise<PayPalResult | undefined> {
  const payments = await getOrderPayments(paypal, rental.paypal.orderId!);
  switch (op.op) {
    case "CAPTURE": {
      const c = payments.captures.find((x) => x.invoiceId === invoiceId(rental.id, SETTLEMENT_SEQ));
      return c && { id: c.id, status: c.status, amountCents: c.amountCents, finalCapture: c.finalCapture, reconciled: true };
    }
    case "VOID": {
      const a = payments.authorizations.find((x) => x.id === rental.paypal.authorizationId);
      return a?.status === "VOIDED" ? { id: a.id, status: a.status, reconciled: true } : undefined;
    }
    case "REFUND": {
      const r = payments.refunds.find((x) => x.amountCents === op.amountCents);
      return r && { id: r.id, status: r.status, amountCents: r.amountCents, reconciled: true };
    }
  }
}

function nextPaymentState(current: PaymentState, rental: Rental, op: SettlementOp, result: PayPalResult): PaymentState {
  switch (op.op) {
    case "CAPTURE":
      if (!(result.finalCapture ?? op.finalCapture)) return "PARTIALLY_CAPTURED";
      return op.amountCents === rental.depositCents ? "CAPTURED_FULL" : "PARTIALLY_CAPTURED_FINAL";
    case "VOID":
      return current === "PARTIALLY_CAPTURED" ? "VOIDED_REMAINDER" : "VOIDED";
    case "REFUND":
      return "PARTIALLY_REFUNDED";
  }
}

async function succeed(deps: SettlementDeps, rentalId: string, op: SettlementOp, record: SettlementRecord, attempts: number, result: PayPalResult) {
  await deps.repo.runTransaction(async (tx) => {
    const rental = await mustGetRental(tx, rentalId);
    const at = iso(deps);
    const paypal = { ...rental.paypal };
    if (op.op === "CAPTURE" && result.id && !paypal.captures.some((c) => c.id === result.id)) {
      paypal.captures = [...paypal.captures, { id: result.id, amountCents: result.amountCents ?? op.amountCents, status: result.status ?? "UNKNOWN" }];
    }
    if (op.op === "VOID") {
      paypal.voided = true;
      if (result.status) paypal.authStatus = result.status;
    }
    if (op.op === "REFUND" && result.id && !paypal.refunds.some((r) => r.id === result.id)) {
      paypal.refunds = [...paypal.refunds, { id: result.id, amountCents: result.amountCents ?? op.amountCents, status: result.status ?? "UNKNOWN" }];
    }
    tx.putRental({
      ...rental,
      paypal,
      paymentState: nextPaymentState(rental.paymentState, rental, op, result),
      updatedAt: at,
      version: rental.version + 1,
    });
    tx.putSettlement({ ...record, status: "SUCCEEDED", attempts, paypalObjectId: result.id, paypalStatus: result.status, updatedAt: at });
    tx.addEvent(rentalId, {
      id: `settle-${SETTLEMENT_SEQ}-${op.op.toLowerCase()}`,
      at,
      actor: "PAYPAL",
      type: "SETTLEMENT_OP_SUCCEEDED",
      summary: `${opLabel(op)} · PayPal status ${result.status ?? "(no body)"}${result.reconciled ? " (confirmed by reconciliation)" : ""}`,
      data: {
        op: op.op,
        paypalObjectId: result.id,
        status: result.status,
        amountCents: op.op === "VOID" ? undefined : (result.amountCents ?? op.amountCents),
        requestId: record.requestId,
        reconciled: result.reconciled,
      },
    });
  });
}

async function fail(
  deps: SettlementDeps,
  rentalId: string,
  record: SettlementRecord,
  attempts: number,
  code: string,
  message: string,
): Promise<RunResult> {
  await deps.repo.runTransaction(async (tx) => {
    await tx.getSettlement(record.idempotencyKey); // reads before writes
    const at = iso(deps);
    tx.putSettlement({ ...record, status: "FAILED", attempts, error: message, updatedAt: at });
    tx.addEvent(rentalId, {
      id: `settle-${SETTLEMENT_SEQ}-${record.op.toLowerCase()}-failed-${at}`,
      at,
      actor: "SYSTEM",
      type: "SETTLEMENT_OP_FAILED",
      summary: `${record.op} failed: ${message}`,
      data: { op: record.op, code, attempts, requestId: record.requestId },
    });
  });
  return { ok: false, error: { code, message } };
}
