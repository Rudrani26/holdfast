import { describe, expect, it } from "vitest";
import { mockResponseHeader, PAYPAL_BASE_URL } from "./paypal";

// No network: these cover only the pure parts of the client.
describe("paypal spike client", () => {
  it("targets the sandbox host only", () => {
    expect(PAYPAL_BASE_URL).toBe("https://api-m.sandbox.paypal.com");
  });

  it("builds the negative-testing mock header", () => {
    expect(JSON.parse(mockResponseHeader("EXAMPLE_CODE"))).toEqual({
      mock_application_codes: "EXAMPLE_CODE",
    });
  });
});
