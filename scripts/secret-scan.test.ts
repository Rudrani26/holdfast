import { describe, expect, it } from "vitest";
import { isClientDelivered, scanText, secretValues } from "./secret-scan";

// Fake values for the test only; none of these are real credentials.
const env = {
  PAYPAL_CLIENT_SECRET: "EFAKE-client-secret-value-0123456789",
  SESSION_SECRET: "fake-session-secret-0123456789abcdef0123",
  STAFF_PASSCODE: "fake passcode/with+symbols",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "AFakePublicClientId",
  PAYPAL_CLIENT_ID: "AFakePublicClientId",
  RENTER_LINK_SECRET: "short",
  GCP_PROJECT_ID: "holdfast-demo-2026",
};

describe("secretValues", () => {
  it("takes secret-named, non-public, long-enough values only", () => {
    expect(secretValues(env).map((s) => s.name)).toEqual(["PAYPAL_CLIENT_SECRET", "SESSION_SECRET", "STAFF_PASSCODE"]);
  });
});

describe("scanText", () => {
  const secrets = secretValues(env);

  it("passes clean output and does not flag the public client id", () => {
    expect(scanText("a.js", `const id="AFakePublicClientId";console.log("hello")`, secrets)).toEqual([]);
  });

  it("finds raw, URL-encoded and JSON-escaped secret values, naming the variable only", () => {
    expect(scanText("a.js", `x="EFAKE-client-secret-value-0123456789"`, secrets)).toEqual([{ file: "a.js", what: "value of PAYPAL_CLIENT_SECRET" }]);
    expect(scanText("b.html", `?p=${encodeURIComponent("fake passcode/with+symbols")}`, secrets)[0]!.what).toBe("value of STAFF_PASSCODE");
    expect(scanText("c.rsc", JSON.stringify({ s: "fake passcode/with+symbols" }), secrets)[0]!.what).toBe("value of STAFF_PASSCODE");
  });

  it("finds known credential patterns", () => {
    const what = (t: string) => scanText("x", t, []).map((f) => f.what);
    expect(what("-----BEGIN PRIVATE KEY-----\nabc")).toEqual(["PEM private key"]);
    expect(what(`{"private_key": "-----BEGIN PRIVATE KEY-----"}`)).toContain("GCP service-account key JSON");
    expect(what(`key=AIza${"x".repeat(35)}`)).toEqual(["Google API key"]);
    expect(what(`ya29.${"a".repeat(30)}`)).toEqual(["Google OAuth access token"]);
    expect(what(`A21AA${"b".repeat(60)}`)).toEqual(["PayPal access token"]);
  });
});

describe("isClientDelivered", () => {
  it.each([
    ["static/chunks/app/page-abc.js", true],
    ["static/css/app.css", true],
    ["server/app/index.html", true],
    ["server/app/how-it-works.rsc", true],
    ["server/app/how-it-works.segments/_full.segment.rsc", true],
    ["server/app/favicon.ico.body", true],
    ["server/app/page.js", false],
    ["server/app/page.js.map", false],
    ["server/chunks/ssr/abc.js", false],
    ["cache/fetch-cache/x", false],
  ])("%s → %s", (p, expected) => expect(isClientDelivered(p)).toBe(expected));
});
