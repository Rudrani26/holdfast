// Pure secret scanning for built, client-delivered files (TASKS T-063). Findings name the secret
// (env var or pattern) and the file, never the value.

/** Env vars whose values must never reach a browser. NEXT_PUBLIC_* is public by design. */
export const SECRET_NAME = /SECRET|PASSCODE|PASSWORD|PRIVATE|TOKEN|CREDENTIAL|API_KEY/i;
/** Shorter values would match ordinary text by chance. */
export const MIN_SECRET_LENGTH = 8;

/** Well-known credential shapes, independent of our env (e.g. a key pasted into source). */
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: "GCP service-account key JSON", re: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Google OAuth access token", re: /ya29\.[0-9A-Za-z_-]{20,}/ },
  { name: "PayPal access token", re: /A21AA[0-9A-Za-z_-]{40,}/ },
  { name: "Basic auth header", re: /Basic\s+[A-Za-z0-9+/]{40,}={0,2}/ },
];

export interface Finding {
  file: string;
  what: string;
}

/** Secret env values to look for: secret-named, non-public, long enough to be meaningful. */
export function secretValues(env: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && !k.startsWith("NEXT_PUBLIC_") && v.trim().length >= MIN_SECRET_LENGTH)
    .map(([name, value]) => ({ name, value: value.trim() }));
}

export function scanText(file: string, text: string, secrets: { name: string; value: string }[]): Finding[] {
  const found: Finding[] = [];
  for (const s of secrets) {
    // Also catch the URL-encoded and JSON-escaped forms a bundler or serializer might produce.
    const forms = new Set([s.value, encodeURIComponent(s.value), JSON.stringify(s.value).slice(1, -1)]);
    if ([...forms].some((f) => text.includes(f))) found.push({ file, what: `value of ${s.name}` });
  }
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) found.push({ file, what: p.name });
  return found;
}

/**
 * Which build outputs reach the browser: everything under .next/static, and the prerendered
 * HTML / RSC payloads under .next/server/app (not server JS, which never leaves the server).
 */
export function isClientDelivered(relPath: string): boolean {
  const p = relPath.replaceAll("\\", "/");
  if (p.startsWith("static/")) return true;
  if (!p.startsWith("server/app/")) return false;
  if (/\.(js|map|nft\.json)$/.test(p)) return false;
  return /\.(html|rsc|body)$/.test(p) || p.includes(".segments/");
}
