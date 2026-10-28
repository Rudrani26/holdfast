import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/types";
import { formatUsd, fromPayPalValue, toPayPalValue } from "./money";

describe("toPayPalValue", () => {
  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [99, "0.99"],
    [3800, "38.00"],
    [16200, "162.00"],
    [20000, "200.00"],
    [123456789, "1234567.89"],
  ])("%i cents → %s", (cents, value) => {
    expect(toPayPalValue(cents)).toBe(value);
  });

  it.each([[-1], [38.5], [0.1], [Number.NaN], [Number.POSITIVE_INFINITY], [2 ** 53]])("rejects %s", (cents) => {
    expect(() => toPayPalValue(cents)).toThrow(DomainError);
  });
});

describe("fromPayPalValue", () => {
  it.each([
    ["0.00", 0],
    ["0.01", 1],
    ["38.00", 3800],
    ["38", 3800],
    ["38.5", 3850],
    ["200.00", 20000],
    ["162.00", 16200],
  ])("%s → %i cents", (value, cents) => {
    expect(fromPayPalValue(value)).toBe(cents);
  });

  it.each([["-1.00"], ["38.001"], ["1e3"], [" 38.00"], ["38.00 "], ["38,00"], ["$38.00"], [""], ["."], ["38."], [".50"], ["abc"]])(
    "rejects %j",
    (value) => {
      expect(() => fromPayPalValue(value)).toThrow(/not a PayPal amount/);
    },
  );

  it("round-trips every cent value from 0 to 20000", () => {
    for (let c = 0; c <= 20000; c++) expect(fromPayPalValue(toPayPalValue(c))).toBe(c);
  });

  it("avoids float error (0.1 + 0.2 style)", () => {
    expect(fromPayPalValue("0.29")).toBe(29);
    expect(fromPayPalValue("1.15")).toBe(115);
  });
});

describe("formatUsd", () => {
  it("formats for display", () => {
    expect(formatUsd(3800)).toBe("$38.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
  });
});
