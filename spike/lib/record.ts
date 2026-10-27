import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const REDACTED = "[REDACTED]";

// Keys whose values are always secret, wherever they appear (body, headers, nested objects).
const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "nonce",
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "client_secret",
  "password",
  "secret",
]);

// Credentials embedded in free text, e.g. an echoed header in an error message.
const CREDENTIAL_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;

const registeredSecrets = new Set<string>();

/** Remember a runtime secret (e.g. a fresh access token) so `record` scrubs it anywhere it appears. */
export function registerSecret(value: string | undefined): void {
  // Very short values would redact unrelated text; real secrets and tokens are long.
  if (value && value.length >= 8) registeredSecrets.add(value);
}

function envSecrets(): string[] {
  return ["PAYPAL_CLIENT_SECRET", "SESSION_SECRET", "RENTER_LINK_SECRET", "STAFF_PASSCODE"]
    .map((name) => process.env[name])
    .filter((v): v is string => typeof v === "string" && v.length >= 8);
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value.replace(CREDENTIAL_PATTERN, `$1 ${REDACTED}`);
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return out;
}

/**
 * Returns a deep copy of `data` with secret-named keys replaced, `Bearer`/`Basic` credentials
 * masked, and every occurrence of the given secret values removed from strings. Pure.
 */
export function redact(data: unknown, secrets: readonly string[] = []): unknown {
  if (typeof data === "string") return scrubString(data, secrets);
  if (Array.isArray(data)) return data.map((item) => redact(item, secrets));
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : redact(value, secrets),
      ]),
    );
  }
  return data;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const DEFAULT_RESULTS_DIR = path.resolve(process.cwd(), "spike", "results");

/**
 * Writes `<dir>/<name>.json` with secrets redacted. Run spike scripts from the repo root so
 * results land in `spike/results/` (gitignored). Returns the written path.
 */
export async function record(
  name: string,
  data: unknown,
  { dir = DEFAULT_RESULTS_DIR }: { dir?: string } = {},
): Promise<string> {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid record name ${JSON.stringify(name)}: use letters, digits, ".", "_", "-"`);
  }
  const secrets = [...registeredSecrets, ...envSecrets()];
  const payload = {
    name,
    recordedAt: new Date().toISOString(),
    environment: "sandbox",
    data: redact(data, secrets),
  };
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}
