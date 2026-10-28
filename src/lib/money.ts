/**
 * Money is integer cents everywhere inside Holdfast. PayPal's string form ("38.00") exists only at
 * the PayPal boundary, and is converted here without floating-point arithmetic.
 */
import { DomainError, type Cents } from "@/domain/types";

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new DomainError("INVALID_AMOUNT", `amount must be a non-negative integer number of cents, got ${cents}`);
  }
}

/** 3800 → "38.00" */
export function toPayPalValue(cents: Cents): string {
  assertCents(cents);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

const PAYPAL_VALUE = /^(\d{1,13})(?:\.(\d{1,2}))?$/;

/** "38.00" → 3800. Accepts "38", "38.5" and "38.50"; rejects signs, spaces, exponents and > 2 decimals. */
export function fromPayPalValue(value: string): Cents {
  const m = PAYPAL_VALUE.exec(value);
  if (!m) throw new DomainError("INVALID_AMOUNT", `not a PayPal amount: ${JSON.stringify(value)}`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  assertCents(cents);
  return cents;
}

/** 3800 → "$38.00" for display. */
export function formatUsd(cents: Cents): string {
  const [whole, fraction] = toPayPalValue(cents).split(".");
  return `$${Number(whole).toLocaleString("en-US")}.${fraction}`;
}
