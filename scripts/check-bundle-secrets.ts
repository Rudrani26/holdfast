/**
 * Pre-deploy secret-leak check (TASKS T-063; docs/DEPLOYMENT.md §6 checklist).
 *
 *   npm run build && npm run check:secrets
 *
 * Scans every client-delivered build output for the values of secret env vars from .env.local and
 * for known credential patterns. Prints names and files only. Exit 1 on any finding, or if there is
 * no build to scan.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { isClientDelivered, scanText, secretValues, type Finding } from "./secret-scan";

const NEXT = ".next";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main(): number {
  if (!existsSync(path.join(NEXT, "static"))) {
    console.error("No build found: run `npm run build` first.");
    return 1;
  }
  // Only .env.local (the app's secrets), never the whole process environment.
  const env = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
  const secrets = secretValues(env);
  const files = walk(NEXT).filter((f) => isClientDelivered(path.relative(NEXT, f)));
  const findings: Finding[] = [];
  let bytes = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    bytes += text.length;
    findings.push(...scanText(path.relative(".", f), text, secrets));
  }
  console.log(`Scanned ${files.length} client-delivered files (${(bytes / 1e6).toFixed(1)} MB) for ${secrets.length} secret values (${secrets.map((s) => s.name).join(", ") || "none"}) and known key patterns.`);
  if (secrets.length === 0) console.log("Note: no secret values found in .env.local; only patterns were checked.");
  for (const x of findings) console.error(`  LEAK: ${x.what} in ${x.file}`);
  console.log(findings.length === 0 ? "PASS: no secrets in client-delivered build output." : `FAIL: ${findings.length} finding(s).`);
  return findings.length === 0 ? 0 : 1;
}

process.exitCode = main();
