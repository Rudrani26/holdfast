/**
 * V0 step 3 rehearsal: drives one demo journey end to end on the hosted app with real PayPal Sandbox
 * and live Gemini, records timings, screenshots and page text, and notes friction for the video.
 *
 *   npx tsx video/capture/rehearse.ts j2 [--budget 12]
 *
 * Each journey costs 12 Gemini calls (6-angle baseline + 6-angle return). The script refuses to start
 * an inspection that would exceed --budget. The staff passcode is read from .env.local, never printed.
 * The PayPal buyer must already be signed in in the profile (login.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { ANGLES, ASSETS_DIR, BASE_URL, DESKTOP, PROFILE_DIR } from "./config";

type JourneyId = "j1" | "j2" | "j3";
const JOURNEYS: Record<JourneyId, { itemId: string; dir: string; renter: "accept" | "clean" | "contest" }> = {
  j1: { itemId: "headphones", dir: "j1-damage", renter: "accept" },
  j2: { itemId: "backpack", dir: "j2-clean", renter: "clean" },
  j3: { itemId: "speaker", dir: "j3-contest", renter: "contest" },
};
const CALLS_PER_INSPECTION = ANGLES.length;
const CONTEST_REASON = "That mark was already on the grille at check-out; the return photo is just in direct sun.";

const id = process.argv[2] as JourneyId;
if (!JOURNEYS[id]) throw new Error("usage: rehearse.ts j1|j2|j3 [--budget N]");
const budgetArg = process.argv.indexOf("--budget");
const budget = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : 12;
const journey = JOURNEYS[id];
const outDir = path.resolve("video/out/rehearsal", id);
fs.mkdirSync(outDir, { recursive: true });

let aiCalls = 0;
let shot = 0;
const started = Date.now();
const log: string[] = [];
function note(msg: string) {
  const line = `[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${msg}`;
  console.log(line);
  log.push(line);
}

function staffPasscode(): string {
  const env = fs.readFileSync(".env.local", "utf8");
  const m = env.match(/^STAFF_PASSCODE=(.*)$/m);
  if (!m?.[1]) throw new Error("STAFF_PASSCODE missing from .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const absolute = (link: string) => (link.startsWith("http") ? link : `${BASE_URL}${link}`);

async function snap(page: Page, name: string) {
  shot += 1;
  const base = path.join(outDir, `${String(shot).padStart(2, "0")}-${name}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${base}.png`, fullPage: true });
  fs.writeFileSync(`${base}.txt`, await page.locator("main").innerText().catch(() => ""));
}

async function book(ctx: BrowserContext, page: Page): Promise<{ rentalId: string; renterLink: string }> {
  await page.goto(`${BASE_URL}/rent/${journey.itemId}`);
  await page.getByLabel("Full name").fill("Alex Rivera");
  await page.getByLabel("Email").fill("alex.rivera@example.com");
  await snap(page, "booking-form");
  await page.getByRole("button", { name: "Continue to deposit" }).click();
  const frame = page.frameLocator("iframe[title*='PayPal']").first();
  const payButton = frame.locator("[data-funding-source='paypal']").first();
  await payButton.waitFor({ timeout: 30_000 });
  await snap(page, "paypal-button");
  const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 30_000 }), payButton.click()]);
  note("PayPal popup opened");
  await popup.waitForLoadState("domcontentloaded");
  const approve = popup.locator("#payment-submit-btn, button:has-text('Complete Purchase'), button:has-text('Agree & Continue'), button:has-text('Continue')").first();
  // PayPal checkout asks for the buyer password each time; the owner types it in the popup, never the script.
  if (await popup.locator("input[type=password]").isVisible({ timeout: 8_000 }).catch(() => false)) {
    note("WAITING FOR OWNER: type the sandbox buyer password in the PayPal popup and press Log In (10 min max)");
  }
  // The owner may approve in the popup themselves; PayPal then closes it.
  const closed = popup.waitForEvent("close", { timeout: 600_000 }).then(() => "closed" as const);
  const ready = approve.waitFor({ timeout: 600_000 }).then(() => "ready" as const);
  if ((await Promise.race([closed, ready]).catch(() => "timeout" as const)) === "ready") {
    await popup.screenshot({ path: path.join(outDir, `${String(++shot).padStart(2, "0")}-paypal-popup.png`) }).catch(() => {});
    await approve.click().catch(() => note("Popup closed before the script clicked; owner approved"));
    note("PayPal approve clicked");
  } else if (popup.isClosed()) {
    note("PayPal popup closed (approved by owner)");
  }
  await page.waitForURL(/\/rent\/confirmed\//, { timeout: 60_000 });
  await page.getByRole("heading", { name: "Booking confirmed" }).waitFor({ timeout: 30_000 });
  const rentalId = new URL(page.url()).pathname.split("/").pop()!;
  const raw = (await page.locator("section[aria-labelledby='renter-link'] code").innerText()).trim();
  const renterLink = absolute(raw);
  note(`Booked rental ${rentalId}; deposit authorized`);
  await snap(page, "confirmed");
  return { rentalId, renterLink };
}

async function staffLogin(page: Page, rentalId: string) {
  await page.goto(`${BASE_URL}/staff/login?next=${encodeURIComponent(`/staff/rentals/${rentalId}`)}`);
  await page.getByLabel("Staff passcode").fill(staffPasscode());
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`/staff/rentals/${rentalId}$`), { timeout: 30_000 });
  note("Staff signed in");
}

/** Reload and wait until the client is hydrated, so file inputs and buttons have their handlers. */
async function reloadReady(page: Page) {
  await page.reload({ waitUntil: "networkidle" });
}

async function uploadAll(page: Page, phase: "checkout" | "return") {
  await page.waitForLoadState("networkidle");
  for (const [i, angle] of ANGLES.entries()) {
    const file = path.join(ASSETS_DIR, journey.dir, phase, `${angle}.jpg`);
    await page.locator("input[type=file]").nth(i).setInputFiles(file);
    await page.getByText(`${i + 1} of ${ANGLES.length} angles`).waitFor({ timeout: 60_000 });
  }
  note(`Uploaded ${ANGLES.length} ${phase} photos`);
}

async function inspect(page: Page, name: RegExp, label: string) {
  if (aiCalls + CALLS_PER_INSPECTION > budget) throw new Error(`AI budget: ${aiCalls} used, ${budget} allowed; refusing ${label}`);
  const t = Date.now();
  aiCalls += CALLS_PER_INSPECTION;
  await page.getByRole("button", { name }).click();
  await page.getByRole("button", { name: /Gemini is/ }).waitFor({ state: "detached", timeout: 180_000 });
  // Next's route announcer is also role=alert; only count alerts inside the page.
  const err = await page.locator("main [role=alert]").filter({ hasText: /\S/ }).allInnerTexts();
  note(`${label} took ${((Date.now() - t) / 1000).toFixed(1)} s (AI calls so far ${aiCalls})${err.length ? `; alerts: ${err.join(" | ")}` : ""}`);
}

async function renterDecide(page: Page, link: string, mode: "accept" | "clean" | "contest") {
  await page.goto(link);
  await page.locator("main").waitFor();
  await snap(page, `renter-report-${mode}`);
  const looksRight = page.getByRole("button", { name: "Looks right" });
  if (await looksRight.isVisible()) {
    if (mode !== "clean") note(`FRICTION: expected ${mode} lines but the renter page shows a clean / no-deduction report`);
    await looksRight.click();
  } else {
    const choice = mode === "contest" ? "Contest" : "Accept";
    const radios = page.getByRole("radio", { name: choice });
    const n = await radios.count();
    for (let i = 0; i < n; i++) await radios.nth(i).check();
    if (mode === "contest") {
      const boxes = page.getByLabel(/Why do you disagree/);
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).fill(CONTEST_REASON);
    }
    if (mode === "clean") note(`FRICTION: expected a clean report but the renter page shows ${n} line(s); accepting`);
    await snap(page, `renter-${choice.toLowerCase()}-filled`);
    await page.getByRole("button", { name: "Send my decision" }).click();
    note(`Renter chose ${choice} on ${n} line(s)`);
  }
  await page.waitForTimeout(2500);
  await snap(page, "renter-after-decision");
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: DESKTOP });
  const renter = ctx.pages()[0] ?? (await ctx.newPage());
  note(`Journey ${id} (${journey.itemId}) on ${BASE_URL}, AI budget ${budget}`);
  try {
    // --rental <id> resumes a rental whose deposit is already authorized (skips the PayPal login).
    const resumeArg = process.argv.indexOf("--rental");
    const booked = resumeArg > 0 ? { rentalId: process.argv[resumeArg + 1]!, renterLink: "" } : await book(ctx, renter);
    const { rentalId } = booked;

    const staff = await ctx.newPage();
    await staffLogin(staff, rentalId);
    // --from return: rental already CHECKED_OUT. --from contest: renter already contested (CONTESTED).
    const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : "start";
    let renterLink = booked.renterLink;
    if (from === "start") {
      await uploadAll(staff, "checkout");
      await inspect(staff, /^Run AI baseline$/, "Baseline inspection");
      await snap(staff, "baseline");
      // The staff page shows a fresh renter link once the baseline is ready.
      renterLink ||= absolute((await staff.locator("section[aria-label='Renter link'] code").innerText()).trim());

      await renter.goto(renterLink);
      await renter.getByRole("button", { name: /I agree these photos/ }).click();
      await renter.getByText("Check-out photos confirmed").waitFor({ timeout: 30_000 });
      note("Renter acknowledged check-out photos");
      await snap(renter, "renter-acknowledged");
      await reloadReady(staff);
    }

    const staffConfirm = async () => {
      const confirm = staff.getByRole("button", { name: /^Confirm / });
      if (await confirm.isDisabled()) note("FRICTION: Confirm is disabled (unpriced line?)");
      note(`Staff pressed: ${await confirm.textContent()}`);
      await confirm.click();
      await staff.getByText("Confirmed. Send this link to the renter").waitFor({ timeout: 30_000 });
      renterLink ||= absolute((await staff.locator("section[aria-labelledby='totals-heading'] code").innerText()).trim());
      await snap(staff, "staff-confirmed");
    };

    if (from !== "contest") {
      await uploadAll(staff, "return");
      await reloadReady(staff);
      await inspect(staff, /^Run AI return inspection$/, "Return inspection");
      await snap(staff, "return-review");
      await staffConfirm();
      await renterDecide(renter, renterLink, journey.renter);
    }

    if (journey.renter === "contest") {
      await reloadReady(staff);
      await snap(staff, "contest-review");
      // Controlled checkbox: it flips only after the server saves the change and the page refreshes.
      const boxes = staff.getByRole("checkbox", { name: "Include in deduction" });
      const n = await boxes.count();
      for (let i = 0; i < n; i++) {
        if (await boxes.nth(i).isChecked()) {
          await boxes.nth(i).click();
          await staff.waitForFunction((idx) => !(document.querySelectorAll("input[type=checkbox]")[idx] as HTMLInputElement | undefined)?.checked, i, { timeout: 30_000 });
        }
      }
      note(`Staff excluded ${n} contested line(s)`);
      await snap(staff, "contest-excluded");
      await staffConfirm();
      await renterDecide(renter, renterLink, "clean");
    }

    await reloadReady(staff);
    const settle = staff.getByRole("button", { name: /^Settle .* with PayPal$/ });
    await settle.waitFor({ timeout: 30_000 });
    await snap(staff, "ready-to-settle");
    const t = Date.now();
    await settle.click();
    await staff.getByRole("heading", { name: "Receipt" }).waitFor({ timeout: 60_000 });
    note(`Settled with PayPal in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    await snap(staff, "receipt");
    const w = Date.now();
    await staff.getByText("Waiting for PayPal's signed webhook").waitFor({ state: "detached", timeout: 70_000 }).catch(() => {});
    const gaveUp = await staff.getByText("webhook has not arrived yet").isVisible();
    note(gaveUp ? "FRICTION: PayPal webhook did not arrive within 60 s" : `PayPal webhook confirmed after ${((Date.now() - w) / 1000).toFixed(1)} s`);
    await snap(staff, "receipt-confirmed");
    await renter.goto(renterLink);
    await snap(renter, "renter-final");
  } catch (e) {
    note(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
    for (const p of ctx.pages()) await p.screenshot({ path: path.join(outDir, `failure-${ctx.pages().indexOf(p)}.png`), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    note(`Done. Gemini calls started: ${aiCalls}`);
    fs.writeFileSync(path.join(outDir, "log.txt"), log.join("\n") + "\n");
    await ctx.close();
  }
}

void main();
