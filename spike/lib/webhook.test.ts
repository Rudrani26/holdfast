import { describe, expect, it } from "vitest";
import {
  buildVerifyRequest,
  eventRecordName,
  extractVerificationHeaders,
  summarizeEvent,
  verifyResponseSchema,
} from "./webhook";

// Header values are made up; they only exercise the mapping.
const DELIVERY_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-example",
  "paypal-transmission-id": "tx-123",
  "paypal-transmission-sig": "sig==",
  "paypal-transmission-time": "2026-10-27T12:00:00Z",
  "content-type": "application/json",
};

describe("extractVerificationHeaders", () => {
  it("maps PayPal delivery headers to verify-webhook-signature fields", () => {
    const { fields, missing } = extractVerificationHeaders(DELIVERY_HEADERS);
    expect(missing).toEqual([]);
    expect(fields).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-example",
      transmission_id: "tx-123",
      transmission_sig: "sig==",
      transmission_time: "2026-10-27T12:00:00Z",
    });
  });

  it("reports missing headers (e.g. a manual curl post)", () => {
    const { fields, missing } = extractVerificationHeaders({ "paypal-transmission-id": "tx-1" });
    expect(fields).toEqual({ transmission_id: "tx-1" });
    expect(missing).toEqual(["auth_algo", "cert_url", "transmission_sig", "transmission_time"]);
  });

  it("takes the first value of a repeated header", () => {
    const { fields } = extractVerificationHeaders({ "paypal-auth-algo": ["A", "B"] });
    expect(fields.auth_algo).toBe("A");
  });
});

describe("buildVerifyRequest", () => {
  it("adds webhook_id and the parsed event", () => {
    const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" };
    const { fields } = extractVerificationHeaders(DELIVERY_HEADERS);
    expect(buildVerifyRequest(fields, "WEBHOOK-123", event)).toEqual({
      ...fields,
      webhook_id: "WEBHOOK-123",
      webhook_event: event,
    });
  });
});

describe("verifyResponseSchema", () => {
  it.each([["SUCCESS"], ["FAILURE"]])("accepts %s", (status) => {
    expect(verifyResponseSchema.parse({ verification_status: status }).verification_status).toBe(status);
  });

  it("rejects anything else", () => {
    expect(verifyResponseSchema.safeParse({ verification_status: "MAYBE" }).success).toBe(false);
  });
});

describe("eventRecordName", () => {
  const none = () => false;

  it("uses the event id", () => {
    expect(eventRecordName({ id: "WH-58D3-1A2B" }, none)).toBe("webhook-WH-58D3-1A2B");
  });

  it.each([[null], [{}], [{ id: "../../etc" }], [{ id: 42 }]])(
    "falls back to a timestamp for unusable id %j",
    (event) => {
      expect(eventRecordName(event, none, 1700000000000)).toBe("webhook-unknown-1700000000000");
    },
  );

  it("suffixes redeliveries of the same event", () => {
    const seen = new Set(["webhook-WH-1", "webhook-WH-1-delivery2"]);
    expect(eventRecordName({ id: "WH-1" }, (n) => seen.has(n))).toBe("webhook-WH-1-delivery3");
  });
});

describe("summarizeEvent", () => {
  it("extracts id, type and resource id only", () => {
    expect(
      summarizeEvent({ id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "AUTH-1" } }),
    ).toEqual({ id: "WH-1", eventType: "PAYMENT.AUTHORIZATION.VOIDED", resourceId: "AUTH-1" });
  });
});
