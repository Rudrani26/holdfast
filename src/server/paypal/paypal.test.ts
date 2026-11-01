/**
 * PayPal module tests. Responses are RECORDED PAYPAL SANDBOX RESPONSES from the spike
 * (src/server/paypal/__fixtures__, built by spike/make-fixtures.ts), replayed through a fake fetch.
 * No network. Failure modes PayPal did not show us (5xx, timeouts) are simulated and labelled so.
 */
import { describe, expect, it } from "vitest";
import { fakePayPal, fixture, type Reply } from "./__fixtures__/fakePayPal";
import type { PayPalClient } from "./client";
import { PayPalApiError, PayPalUnknownOutcomeError, staffMessage } from "./errors";
import { authorizeOrder, createDepositOrder, depositOrderBody, getOrder } from "./orders";
import {
  captureAuthorization,
  getAuthorization,
  getCapture,
  invoiceId,
  refundCapture,
  settlementRequestId,
  voidAuthorization,
} from "./payments";
import { eventReferences, verifyWebhook } from "./webhooks";

describe("auth and request headers", () => {
  it("fetches a token with Basic auth once and reuses it until expires_in − 60 s", async () => {
    const pp = fakePayPal([fixture("get-auth-partially-captured"), fixture("get-auth-partially-captured"), fixture("get-auth-partially-captured")]);
    await getAuthorization(pp.client, "5TN13229TB9978039");
    await getAuthorization(pp.client, "5TN13229TB9978039");
    expect(pp.tokenCalls()).toBe(1);
    const tokenReq = pp.sent[0]!;
    expect(tokenReq.headers.authorization).toBe(`Basic ${Buffer.from("test-client:test-secret").toString("base64")}`);
    expect(tokenReq.body).toBe("grant_type=client_credentials");
    pp.advance(32400 * 1000 - 59_000); // inside the 60 s refresh margin
    await getAuthorization(pp.client, "5TN13229TB9978039");
    expect(pp.tokenCalls()).toBe(2);
  });

  it("sends Bearer, Prefer: return=representation and the given PayPal-Request-Id on writes", async () => {
    const pp = fakePayPal([fixture("void")]);
    await voidAuthorization(pp.client, { authorizationId: "AUTH1", requestId: "settle:r1:1:void" });
    const call = pp.api()[0]!;
    expect(call).toMatchObject({ method: "POST", url: "https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH1/void" });
    expect(call.headers).toMatchObject({
      authorization: "Bearer TEST-TOKEN-1",
      prefer: "return=representation",
      "paypal-request-id": "settle:r1:1:void",
    });
    expect(call.body).toBeUndefined();
  });

  it("refuses a write without a request id", async () => {
    const pp = fakePayPal([]);
    await expect(
      pp.client.request({ method: "POST", path: "/v2/x", requestId: "", schema: (await import("zod")).z.unknown() }),
    ).rejects.toThrow(/PayPal-Request-Id is required/);
  });

  it("on 401, refreshes the token once and retries with the same request id (simulated 401)", async () => {
    const pp = fakePayPal([{ status: 401, body: { error: "invalid_token" } }, fixture("capture-partial")]);
    await captureAuthorization(pp.client, {
      authorizationId: "AUTH1",
      amountCents: 3800,
      finalCapture: false,
      invoiceId: "HF-r1-1",
      requestId: "settle:r1:1:capture",
    });
    const [first, retry] = pp.api();
    expect(pp.tokenCalls()).toBe(2);
    expect(first!.headers["paypal-request-id"]).toBe("settle:r1:1:capture");
    expect(retry!.headers["paypal-request-id"]).toBe("settle:r1:1:capture");
    expect(retry!.headers.authorization).toBe("Bearer TEST-TOKEN-2");
  });

  it("a failed token request never exposes the client secret", async () => {
    const pp = fakePayPal([], { tokenStatus: 401 });
    const err = await getOrder(pp.client, "O1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(String((err as Error).message)).not.toContain("test-secret");
  });
});

describe("orders (recorded sandbox responses)", () => {
  it("creates the deposit order per §5.1 and reads the payer-action link from a 200 response", async () => {
    const pp = fakePayPal([fixture("create-order")]);
    const order = await createDepositOrder(pp.client, { rentalId: "r_42", amountCents: 20000, itemName: "Headphones" });
    expect(order).toEqual({
      orderId: "3M713225W46152355",
      status: "PAYER_ACTION_REQUIRED",
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=3M713225W46152355",
    });
    const call = pp.api()[0]!;
    expect(call.headers["paypal-request-id"]).toBe("rental:r_42:create-order");
    expect(JSON.parse(call.body!)).toEqual(depositOrderBody({ rentalId: "r_42", amountCents: 20000, itemName: "Headphones" }));
    expect(JSON.parse(call.body!).purchase_units[0]).toMatchObject({
      custom_id: "r_42",
      amount: { currency_code: "USD", value: "200.00" },
    });
  });

  it("authorizes and returns authorization id, cents and expiry", async () => {
    const pp = fakePayPal([fixture("authorize")]);
    expect(await authorizeOrder(pp.client, { orderId: "3M713225W46152355", rentalId: "r_42" })).toEqual({
      orderId: "3M713225W46152355",
      orderStatus: "COMPLETED",
      authorizationId: "5TN13229TB9978039",
      authorizationStatus: "CREATED",
      amountCents: 20000,
      expiresAt: "2026-11-25T22:41:33Z",
    });
    expect(pp.api()[0]!.headers["paypal-request-id"]).toBe("rental:r_42:authorize");
  });
});

describe("payments (recorded sandbox responses)", () => {
  const capture = (client: PayPalClient, finalCapture = false, mockCode?: string) =>
    captureAuthorization(client, {
      authorizationId: "5TN13229TB9978039",
      amountCents: 3800,
      finalCapture,
      invoiceId: invoiceId("r1", 1),
      requestId: settlementRequestId("r1", 1, "CAPTURE"),
      mockCode,
    });

  it("partial capture: sends final_capture=false and a unique invoice id; reads 201 COMPLETED", async () => {
    const pp = fakePayPal([fixture("capture-partial")]);
    expect(await capture(pp.client)).toEqual({
      id: "5B211957T5969872L",
      status: "COMPLETED",
      amountCents: 3800,
      finalCapture: false,
      replayed: false,
    });
    expect(JSON.parse(pp.api()[0]!.body!)).toMatchObject({
      amount: { currency_code: "USD", value: "38.00" },
      final_capture: false,
      invoice_id: "HF-r1-1",
    });
    expect(pp.api()[0]!.headers["paypal-request-id"]).toBe("settle:r1:1:capture");
  });

  it("an idempotent replay (200, same capture id) is recognised", async () => {
    const pp = fakePayPal([fixture("capture-idempotent-replay")]);
    const result = await capture(pp.client);
    expect(result).toMatchObject({ id: "26F96310G2864510S", status: "COMPLETED", replayed: true });
  });

  it("void returns VOIDED; a 204 with no body is also success (204 simulated)", async () => {
    expect(await voidAuthorization(fakePayPal([fixture("void")]).client, { authorizationId: "A", requestId: "k" })).toEqual({
      status: "VOIDED",
    });
    expect(
      await voidAuthorization(fakePayPal([{ status: 204, body: null }]).client, { authorizationId: "A", requestId: "k" }),
    ).toEqual({ status: undefined });
  });

  it("void after a final capture → PayPalApiError PREVIOUSLY_CAPTURED with a staff message", async () => {
    const err = await voidAuthorization(fakePayPal([fixture("void-previously-captured")]).client, {
      authorizationId: "8EP712293Y7223943",
      requestId: "k",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err).toMatchObject({ status: 422, errorName: "UNPROCESSABLE_ENTITY", issues: ["PREVIOUSLY_CAPTURED"] });
    expect(staffMessage(err)).toMatch(/already captured as final/);
    expect(staffMessage(err)).toMatch(/debug id ca515367a9fab/);
  });

  it("negative test: sends PayPal-Mock-Response and parses DUPLICATE_INVOICE_ID", async () => {
    const pp = fakePayPal([fixture("capture-mock-duplicate-invoice")]);
    const err = await capture(pp.client, false, "DUPLICATE_INVOICE_ID").catch((e: unknown) => e);
    expect(pp.api()[0]!.headers["paypal-mock-response"]).toBe('{"mock_application_codes":"DUPLICATE_INVOICE_ID"}');
    expect((err as PayPalApiError).hasIssue("DUPLICATE_INVOICE_ID")).toBe(true);
    expect(staffMessage(err)).toMatch(/invoice ID was already used/);
  });

  it("refund and capture reads", async () => {
    const pp = fakePayPal([fixture("refund"), fixture("get-capture-partially-refunded")]);
    expect(await refundCapture(pp.client, { captureId: "2M190931H46376540", amountCents: 16200, requestId: "settle:r1:1:refund" })).toEqual({
      id: "2K87169674218511B",
      status: "COMPLETED",
      amountCents: 16200,
    });
    expect(JSON.parse(pp.api()[0]!.body!).amount).toEqual({ currency_code: "USD", value: "162.00" });
    expect(await getCapture(pp.client, "2M190931H46376540")).toEqual({
      id: "2M190931H46376540",
      status: "PARTIALLY_REFUNDED",
      amountCents: 20000,
    });
  });

  it("getAuthorization after a partial capture reports PARTIALLY_CAPTURED", async () => {
    const auth = await getAuthorization(fakePayPal([fixture("get-auth-partially-captured")]).client, "5TN13229TB9978039");
    expect(auth).toMatchObject({ status: "PARTIALLY_CAPTURED", amountCents: 20000 });
  });

  it("rejects non-integer cents before calling PayPal", async () => {
    const pp = fakePayPal([]);
    await expect(
      captureAuthorization(pp.client, { authorizationId: "A", amountCents: 38.5, finalCapture: false, invoiceId: "i", requestId: "k" }),
    ).rejects.toThrow(/integer/);
    expect(pp.api()).toHaveLength(0);
  });

  it("request id and invoice id formats", () => {
    expect(settlementRequestId("r1", 2, "VOID")).toBe("settle:r1:2:void");
    expect(() => settlementRequestId("r1", 0, "VOID")).toThrow();
    expect(invoiceId("r1", 2)).toBe("HF-r1-2");
  });
});

describe("unknown outcomes (simulated; reconcile before retrying)", () => {
  it.each([
    ["a 5xx", { status: 503, body: { name: "SERVICE_UNAVAILABLE" } }],
    ["a network error", new TypeError("fetch failed")],
    ["a 2xx body of the wrong shape", { status: 201, body: { unexpected: true } }],
    ["a non-JSON 2xx body", { status: 200, raw: "<html>" }],
  ] as const)("%s → PayPalUnknownOutcomeError", async (_name, reply) => {
    const pp = fakePayPal([reply as Reply]);
    const err = await refundCapture(pp.client, { captureId: "C", amountCents: 100, requestId: "k" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalUnknownOutcomeError);
    expect(staffMessage(err)).toMatch(/will check the payment status/);
  });
});

describe("webhooks (recorded sandbox delivery)", () => {
  const delivery = fixture("webhook-capture-completed");
  const rawBody = JSON.stringify(delivery.body);
  const headers = () => new Headers(delivery.headers);

  it("verifies with the five transmission headers, webhook id and parsed event", async () => {
    const pp = fakePayPal([{ status: 200, body: { verification_status: "SUCCESS" } }]);
    const result = await verifyWebhook(pp.client, { rawBody, headers: headers(), webhookId: "WH-ID" });
    expect(result.verified).toBe(true);
    const sent = JSON.parse(pp.api()[0]!.body!);
    expect(Object.keys(sent).sort()).toEqual(
      ["auth_algo", "cert_url", "transmission_id", "transmission_sig", "transmission_time", "webhook_event", "webhook_id"].sort(),
    );
    expect(sent.webhook_id).toBe("WH-ID");
    expect(sent.webhook_event).toEqual(delivery.body);
  });

  it("maps the recorded capture event to its rental via custom_id, with related ids", async () => {
    const pp = fakePayPal([{ status: 200, body: { verification_status: "SUCCESS" } }]);
    const result = await verifyWebhook(pp.client, { rawBody, headers: headers(), webhookId: "WH-ID" });
    if (!result.verified) throw new Error("expected verified");
    expect(eventReferences(result.event)).toMatchObject({
      rentalId: "spike-E2-20261027T223021Z",
      resourceId: "03A84484J18433418",
      resourceStatus: "COMPLETED",
      authorizationId: "8EP712293Y7223943",
      orderId: "29G10069CE107734B",
    });
  });

  it("FAILURE → not verified", async () => {
    const pp = fakePayPal([{ status: 200, body: { verification_status: "FAILURE" } }]);
    expect(await verifyWebhook(pp.client, { rawBody, headers: headers(), webhookId: "WH-ID" })).toMatchObject({
      verified: false,
      reason: "SIGNATURE_FAILURE",
    });
  });

  it("missing headers, invalid JSON or a non-event body are rejected without calling PayPal", async () => {
    const pp = fakePayPal([]);
    expect(await verifyWebhook(pp.client, { rawBody, headers: new Headers(), webhookId: "W" })).toMatchObject({ reason: "MISSING_HEADERS" });
    expect(await verifyWebhook(pp.client, { rawBody: "{nope", headers: headers(), webhookId: "W" })).toMatchObject({ reason: "INVALID_JSON" });
    expect(await verifyWebhook(pp.client, { rawBody: '{"id":1}', headers: headers(), webhookId: "W" })).toMatchObject({ reason: "INVALID_EVENT" });
    expect(pp.sent).toHaveLength(0);
  });
});
