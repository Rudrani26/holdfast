/**
 * One-time owner step: opens the capture browser profile at the PayPal Sandbox sign-in page so the
 * owner signs in as the sandbox BUYER by hand. Credentials are typed by the owner only, never by a
 * script, never logged. Close the window when done; the session stays in video/capture/.profile/.
 *
 *   npx tsx video/capture/login.ts
 */
import { chromium } from "playwright";
import { DESKTOP, PROFILE_DIR } from "./config";

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: DESKTOP, args: ["--start-maximized"] });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.sandbox.paypal.com/signin");
  console.log("Sign in as the sandbox BUYER in the opened window, then close the window.");
  await new Promise<void>((resolve) => ctx.on("close", () => resolve()));
  console.log("Profile saved to video/capture/.profile/ (gitignored).");
}

void main();
