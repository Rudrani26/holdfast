import { describe, expect, it } from "vitest";
import {
  parseAuthorizeArgs,
  parseCaptureArgs,
  parseCreateOrderArgs,
  parseGetArgs,
  parseIdempotencyArgs,
  parseNegativeArgs,
  parseRefundArgs,
  parseVoidArgs,
  UsageError,
} from "./args";

describe("parseCreateOrderArgs", () => {
  it("defaults to a $200.00 order", () => {
    expect(parseCreateOrderArgs(["--exp", "E1"])).toEqual({
      exp: "E1",
      amount: "200.00",
      item: "Spike test item",
    });
  });

  it("accepts an explicit amount and item", () => {
    expect(parseCreateOrderArgs(["--exp", "E1-retry", "--amount", "150.00", "--item", "Headphones"])).toEqual({
      exp: "E1-retry",
      amount: "150.00",
      item: "Headphones",
    });
  });

  it("requires --exp", () => {
    expect(() => parseCreateOrderArgs([])).toThrow(UsageError);
  });

  it.each([["E1/../x"], ["E 1"], [""]])("rejects unsafe exp %j", (exp) => {
    expect(() => parseCreateOrderArgs(["--exp", exp])).toThrow(/--exp/);
  });

  it("rejects unknown flags and positionals", () => {
    expect(() => parseCreateOrderArgs(["--exp", "E1", "--amont", "1.00"])).toThrow(UsageError);
    expect(() => parseCreateOrderArgs(["--exp", "E1", "extra"])).toThrow(UsageError);
  });
});

describe("amounts", () => {
  it.each([["38"], ["38.0"], ["38.000"], ["-38.00"], ["0.00"], ["1,000.00"], ["abc"], ["38.00 "]])(
    "rejects %j",
    (amount) => {
      expect(() => parseRefundArgs(["--exp", "E4", "--amount", amount])).toThrow(/--amount/);
    },
  );

  it.each([["0.01"], ["38.00"], ["200.00"], ["162.00"]])("accepts %j unchanged", (amount) => {
    expect(parseRefundArgs(["--exp", "E4", "--amount", amount]).amount).toBe(amount);
  });
});

describe("parseCaptureArgs", () => {
  it("parses --final as a boolean", () => {
    expect(parseCaptureArgs(["--exp", "E1", "--amount", "38.00", "--final", "false"])).toEqual({
      exp: "E1",
      amount: "38.00",
      final: false,
    });
    expect(parseCaptureArgs(["--exp", "E2", "--amount", "38.00", "--final", "true"]).final).toBe(true);
  });

  it("requires --final and --amount explicitly", () => {
    expect(() => parseCaptureArgs(["--exp", "E1", "--amount", "38.00"])).toThrow(/--final/);
    expect(() => parseCaptureArgs(["--exp", "E1", "--final", "true"])).toThrow(/--amount/);
  });

  it.each([["yes"], ["TRUE"], ["1"]])("rejects --final %j", (final) => {
    expect(() => parseCaptureArgs(["--exp", "E1", "--amount", "38.00", "--final", final])).toThrow(
      /--final/,
    );
  });

  it("accepts an explicit authorization id", () => {
    expect(
      parseCaptureArgs(["--exp", "E1", "--amount", "1.00", "--final", "true", "--auth", "0VF52814937998046"]).auth,
    ).toBe("0VF52814937998046");
  });
});

describe("parseGetArgs", () => {
  it("defaults to the authorization and requires a label", () => {
    expect(parseGetArgs(["--exp", "E1", "--label", "after-capture"])).toEqual({
      exp: "E1",
      what: "auth",
      label: "after-capture",
    });
    expect(() => parseGetArgs(["--exp", "E1"])).toThrow(/--label/);
  });

  it("accepts capture/refund/order targets and rejects others", () => {
    expect(parseGetArgs(["--exp", "E4", "--what", "refund", "--label", "x"]).what).toBe("refund");
    expect(() => parseGetArgs(["--exp", "E4", "--what", "payout", "--label", "x"])).toThrow(/--what/);
  });
});

describe("parseIdempotencyArgs / parseNegativeArgs", () => {
  it("apply defaults", () => {
    expect(parseIdempotencyArgs(["--exp", "E5"])).toEqual({ exp: "E5", amount: "38.00" });
    expect(parseNegativeArgs(["--exp", "E5"])).toEqual({
      exp: "E5",
      code: "DUPLICATE_INVOICE_ID",
      amount: "1.00",
    });
  });

  it("rejects a malformed mock code (it becomes a header value)", () => {
    expect(() => parseNegativeArgs(["--exp", "E5", "--code", 'X","y":"z'])).toThrow(/--code/);
    expect(() => parseNegativeArgs(["--exp", "E5", "--code", "lower_case"])).toThrow(/--code/);
  });
});

describe("id arguments", () => {
  it.each([["../void"], ["ID WITH SPACE"], ["a/b"]])("rejects id %j", (id) => {
    expect(() => parseVoidArgs(["--exp", "E1", "--auth", id])).toThrow(/--auth/);
    expect(() => parseAuthorizeArgs(["--exp", "E1", "--order", id])).toThrow(/--order/);
  });
});
