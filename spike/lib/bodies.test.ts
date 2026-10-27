import { describe, expect, it } from "vitest";
import {
  approvalLink,
  buildCaptureBody,
  buildCreateOrderBody,
  buildRefundBody,
  describePayPalError,
  extractAuthorization,
  idAndStatus,
} from "./bodies";

// Response shapes below are hand-written to the documented Orders v2 / Payments v2 structure,
// not recorded sandbox responses. They test the readers only.

describe("request bodies (docs/PAYPAL_INTEGRATION.md §5)", () => {
  it("builds the AUTHORIZE deposit order", () => {
    expect(buildCreateOrderBody({ referenceId: "spike-E1-x", amount: "200.00", itemName: "Headphones" })).toEqual({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: "spike-E1-x",
          custom_id: "spike-E1-x",
          description: "Security deposit hold — Headphones (Holdfast demo)",
          amount: { currency_code: "USD", value: "200.00" },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Kestrel Gear Rentals (demo)",
            shipping_preference: "NO_SHIPPING",
            user_action: "CONTINUE",
          },
        },
      },
    });
  });

  it("builds a partial capture with final_capture and a unique invoice id", () => {
    expect(buildCaptureBody({ amount: "38.00", finalCapture: false, invoiceId: "HF-E1-x-1" })).toEqual({
      amount: { currency_code: "USD", value: "38.00" },
      final_capture: false,
      invoice_id: "HF-E1-x-1",
      note_to_payer: "Holdfast deposit settlement: approved damage charges only.",
      soft_descriptor: "HOLDFAST",
    });
    expect(buildCaptureBody({ amount: "200.00", finalCapture: true, invoiceId: "i" }).final_capture).toBe(true);
  });

  it("builds a partial refund", () => {
    expect(buildRefundBody({ amount: "162.00" })).toEqual({
      amount: { currency_code: "USD", value: "162.00" },
      note_to_payer: "Holdfast: unused deposit returned",
    });
  });
});

describe("approvalLink", () => {
  it("prefers payer-action, falls back to approve", () => {
    const links = [
      { href: "https://api/self", rel: "self" },
      { href: "https://sandbox/approve", rel: "approve" },
      { href: "https://sandbox/payer-action", rel: "payer-action" },
    ];
    expect(approvalLink({ links })).toBe("https://sandbox/payer-action");
    expect(approvalLink({ links: links.slice(0, 2) })).toBe("https://sandbox/approve");
  });

  it("returns undefined when there is no usable link", () => {
    expect(approvalLink({ links: [{ rel: "self", href: "x" }] })).toBeUndefined();
    expect(approvalLink({})).toBeUndefined();
    expect(approvalLink(null)).toBeUndefined();
  });
});

describe("extractAuthorization", () => {
  it("reads purchase_units[0].payments.authorizations[0]", () => {
    const order = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            authorizations: [
              {
                id: "AUTH1",
                status: "CREATED",
                amount: { currency_code: "USD", value: "200.00" },
                expiration_time: "2026-11-25T12:00:00Z",
              },
            ],
          },
        },
      ],
    };
    expect(extractAuthorization(order)).toEqual({
      id: "AUTH1",
      status: "CREATED",
      amount: "200.00",
      expirationTime: "2026-11-25T12:00:00Z",
    });
  });

  it("returns undefined for an error body or missing authorization", () => {
    expect(extractAuthorization({ name: "UNPROCESSABLE_ENTITY" })).toBeUndefined();
    expect(extractAuthorization({ purchase_units: [{ payments: { authorizations: [] } }] })).toBeUndefined();
  });
});

describe("idAndStatus", () => {
  it("reads id and status when they are strings", () => {
    expect(idAndStatus({ id: "CAP1", status: "COMPLETED" })).toEqual({ id: "CAP1", status: "COMPLETED" });
    expect(idAndStatus(null)).toEqual({ id: undefined, status: undefined });
  });
});

describe("describePayPalError", () => {
  it("summarizes name, message, issues and debug id", () => {
    expect(
      describePayPalError({
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed.",
        debug_id: "abc123",
        details: [{ issue: "EXAMPLE_ISSUE", description: "..." }],
      }),
    ).toBe(
      "UNPROCESSABLE_ENTITY — The requested action could not be performed. — issues: EXAMPLE_ISSUE — debug_id abc123",
    );
  });

  it("handles OAuth-style and empty bodies", () => {
    expect(describePayPalError({ error: "invalid_client", error_description: "Client Authentication failed" })).toBe(
      "invalid_client — Client Authentication failed",
    );
    expect(describePayPalError(null)).toBe("no error body");
  });
});
