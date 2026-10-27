import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REDACTED, record, redact, registerSecret } from "./record";

// Fake values shaped like real ones; no real credentials in tests.
const FAKE_TOKEN = "A21AAFakeTokenValueForUnitTestsOnly_0123456789";

describe("redact", () => {
  it("redacts access_token in a token response and keeps expiry", () => {
    const out = redact({
      scope: "https://uri.paypal.com/services/payments/payment",
      access_token: FAKE_TOKEN,
      token_type: "Bearer",
      app_id: "APP-80W284485P519543T",
      expires_in: 32400,
      nonce: "2026-10-27T12:00:00ZFakeNonce",
    });
    expect(out).toMatchObject({ access_token: REDACTED, nonce: REDACTED, expires_in: 32400 });
    expect(JSON.stringify(out)).not.toContain(FAKE_TOKEN);
  });

  it("redacts Authorization headers regardless of case and nesting", () => {
    const out = redact({
      request: { headers: { Authorization: `Bearer ${FAKE_TOKEN}`, "content-type": "json" } },
      response: { headers: { "set-cookie": "ts=abc", "paypal-debug-id": "f1d2" } },
    }) as { request: { headers: Record<string, string> }; response: { headers: Record<string, string> } };
    expect(out.request.headers.Authorization).toBe(REDACTED);
    expect(out.request.headers["content-type"]).toBe("json");
    expect(out.response.headers["set-cookie"]).toBe(REDACTED);
    expect(out.response.headers["paypal-debug-id"]).toBe("f1d2");
  });

  it("masks Bearer/Basic credentials embedded in free text", () => {
    const out = redact({ message: `sent Basic Y2xpZW50OnNlY3JldA== and Bearer ${FAKE_TOKEN}` });
    expect(out).toEqual({ message: `sent Basic ${REDACTED} and Bearer ${REDACTED}` });
  });

  it("removes known secret values wherever they appear, including arrays", () => {
    const secret = "client-secret-value-123";
    const out = redact({ list: [`x${secret}y`, { deep: secret }], n: 1, ok: true, nil: null }, [
      secret,
    ]);
    expect(out).toEqual({ list: [`x${REDACTED}y`, { deep: REDACTED }], n: 1, ok: true, nil: null });
  });

  it("does not mutate its input", () => {
    const input = { access_token: FAKE_TOKEN };
    redact(input);
    expect(input.access_token).toBe(FAKE_TOKEN);
  });
});

describe("record", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes redacted JSON and scrubs registered runtime secrets", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "hf-record-"));
    registerSecret(FAKE_TOKEN);
    const file = await record(
      "E0-token",
      { response: { json: { access_token: FAKE_TOKEN }, echoed: `token=${FAKE_TOKEN}` } },
      { dir },
    );
    const text = await readFile(file, "utf8");
    expect(path.basename(file)).toBe("E0-token.json");
    expect(text).not.toContain(FAKE_TOKEN);
    expect(JSON.parse(text)).toMatchObject({ name: "E0-token", environment: "sandbox" });
  });

  it.each([["../escape"], ["a/b"], [""], [".hidden"]])("rejects unsafe name %j", async (name) => {
    await expect(record(name, {}, { dir: os.tmpdir() })).rejects.toThrow(/Invalid record name/);
  });
});
