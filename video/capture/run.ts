/**
 * V2 scripted capture (docs/DEMO_VIDEO_PRODUCTION.md §5, video/shots.md).
 *
 *   npx tsx video/capture/run.ts all            # prep J2/J3, then record every scene in order
 *   npx tsx video/capture/run.ts <scene...>     # (re)run named scenes; state carries over
 *
 * One kiosk Chromium window fills the primary display (1536×864 CSS at 125% = 1920×1080), recorded by
 * ffmpeg gdigrab. The renter phone is the same window with 390×844 device emulation (cropped in V4).
 * Real PayPal Sandbox and live Gemini only. Gemini calls are capped in rec.ts (AI_CALL_CAP).
 * The owner types the PayPal buyer password in the popup; that part is not recorded.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { ANGLES, ASSETS_DIR, BASE_URL, PROFILE_DIR } from "./config";
import { appendLog, beat, click, CURSOR_SCRIPT, idsOnPage, loadState, moveTo, Recorder, reserveAiCalls, saveState, scrollTo, sleep, type, type CaptureState } from "./rec";

type J = "j1" | "j2" | "j3";
const ITEMS: Record<J, { itemId: string; dir: string }> = {
  j1: { itemId: "headphones", dir: "j1-damage" },
  j2: { itemId: "backpack", dir: "j2-clean" },
  j3: { itemId: "speaker", dir: "j3-contest" },
};
const CONTEST_REASON = "That mark was already on the grille at check-out; the return photo is just in direct sun.";
const PHONE = { width: 390, height: 844 };

const state: CaptureState = loadState();
let ctx: BrowserContext;
let staff: Page;
let phone: Page | undefined;

function journey(j: J) {
  const s = state.journeys[j];
  if (!s) throw new Error(`${j} is not booked yet; run ${j}-book or ${j}-prep first`);
  return s;
}

function staffPasscode(): string {
  const m = fs.readFileSync(".env.local", "utf8").match(/^STAFF_PASSCODE=(.*)$/m);
  if (!m?.[1]) throw new Error("STAFF_PASSCODE missing from .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function ensureStaff() {
  await staff.bringToFront();
  await staff.goto(`${BASE_URL}/staff`);
  if (staff.url().includes("/staff/login")) {
    await staff.getByLabel("Staff passcode").fill(staffPasscode());
    await staff.getByRole("button", { name: "Sign in" }).click();
    await staff.waitForURL(/\/staff$/);
  }
}

async function openStaffRental(j: J) {
  await staff.bringToFront();
  await staff.goto(`${BASE_URL}/staff/rentals/${journey(j).rentalId}`);
  await staff.getByRole("heading", { level: 1 }).waitFor();
  await staff.waitForLoadState("networkidle").catch(() => {});
}

/** The renter's phone: a second tab with 390×844 mobile emulation at the screen's 1.25 scale (crisp crop). */
async function openPhone(j: J) {
  phone ??= await ctx.newPage();
  const cdp = await ctx.newCDPSession(phone);
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...PHONE, deviceScaleFactor: 1.25, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await phone.bringToFront();
  await phone.goto(journey(j).renterLink);
  await phone.locator("main h1, main h2").first().waitFor();
  await phone.waitForLoadState("networkidle").catch(() => {});
  return phone;
}

async function book(j: J, rec?: Recorder) {
  const p = staff;
  await p.bringToFront();
  await p.goto(`${BASE_URL}/`);
  await p.waitForLoadState("networkidle").catch(() => {});
  if (rec) {
    await rec.start();
    await sleep(4500); // let the hero settlement tape play once
    await scrollTo(p, p.locator("#rent"), 40);
    await beat();
  }
  const card = p.locator(`a[href="/rent/${ITEMS[j].itemId}"]`).first();
  if (rec) await click(p, card);
  else await card.click();
  await p.getByLabel("Full name").waitFor();
  await p.waitForLoadState("networkidle").catch(() => {});
  if (rec) {
    rec.mark("booking form");
    await type(p, p.getByLabel("Full name"), "Alex Rivera");
    await type(p, p.getByLabel("Email"), "alex.rivera@example.com");
    await beat();
    await click(p, p.getByRole("button", { name: "Continue to deposit" }));
  } else {
    await p.getByLabel("Full name").fill("Alex Rivera");
    await p.getByLabel("Email").fill("alex.rivera@example.com");
    await p.getByRole("button", { name: "Continue to deposit" }).click();
  }
  const payButton = p.frameLocator("iframe[title*='PayPal']").first().locator("[data-funding-source='paypal']").first();
  await payButton.waitFor({ timeout: 30_000 });
  await beat();
  if (rec) {
    rec.mark("paypal button");
    const frameBox = await p.locator("iframe[title*='PayPal']").first().boundingBox();
    if (frameBox) await moveTo(p, p.locator("iframe[title*='PayPal']").first());
  }
  const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 30_000 }), payButton.click()]);
  await popup.waitForLoadState("domcontentloaded");
  const approve = popup.locator("#payment-submit-btn, button:has-text('Complete Purchase'), button:has-text('Agree & Continue'), button:has-text('Continue')").first();
  // The sandbox popup can take a while to load; decide only once either the sign-in form or the approve button shows.
  const needsLogin = await Promise.race([
    popup.locator("input[type=password]").waitFor({ timeout: 60_000 }).then(() => true),
    approve.waitFor({ timeout: 60_000 }).then(() => false),
  ]).catch(() => true);
  let rec2: Recorder | undefined;
  if (needsLogin) {
    if (rec) {
      await sleep(1200); // show the real PayPal sign-in page, then cut before the password
      rec.mark("paypal popup (cut before password)");
      appendLog({ scene: rec.scene, take: (await rec.stop(0)).take, file: rec.file, marks: rec.marks, ids: {}, note: "Ends at the PayPal popup; the owner signs in off camera." });
    }
    console.log(`\n>>> OWNER: type the sandbox buyer password in the PayPal popup and press Log In. Do not click Continue/Complete. (10 min max)\n`);
    // If the owner approves in the popup anyway, PayPal closes it; that is fine, the booking continues.
    await Promise.race([approve.waitFor({ timeout: 600_000 }), popup.waitForEvent("close", { timeout: 600_000 })]);
    if (rec) {
      rec2 = new Recorder(state, `${rec.scene}-approve`);
      await rec2.start();
      await beat(1500);
    }
  } else {
    await Promise.race([approve.waitFor({ timeout: 60_000 }), popup.waitForEvent("close", { timeout: 60_000 })]);
  }
  if (!popup.isClosed()) await approve.click().catch(() => console.log("  popup closed before the script clicked (owner approved)"));
  await p.waitForURL(/\/rent\/confirmed\//, { timeout: 90_000 });
  await p.getByRole("heading", { name: "Booking confirmed" }).waitFor({ timeout: 30_000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  const rentalId = new URL(p.url()).pathname.split("/").pop()!;
  const raw = (await p.locator("section[aria-labelledby='renter-link'] code").innerText()).trim();
  state.journeys[j] = { rentalId, renterLink: raw.startsWith("http") ? raw : `${BASE_URL}${raw}` };
  saveState(state);
  console.log(`  ${j} booked: ${rentalId}`);
  const recEnd = rec2 ?? rec;
  if (recEnd) {
    recEnd.mark("confirmation");
    await beat(1500);
    await scrollTo(p, p.locator("#pickup"), 120);
    await beat(2000);
    const ids = await idsOnPage(p);
    const r = await recEnd.stop(1500);
    appendLog({ scene: recEnd.scene, take: r.take, file: r.file, rentalId, marks: r.marks, ids });
  }
}

async function uploadAll(j: J, phase: "checkout" | "return", rec?: Recorder) {
  const grid = staff.locator("#capture-heading").locator("xpath=ancestor::section[1]");
  await grid.waitFor();
  for (const [i, angle] of ANGLES.entries()) {
    const label = grid.locator("label:has(input[type=file])").nth(i);
    if (rec) await moveTo(staff, label);
    await grid.locator("input[type=file]").nth(i).setInputFiles(path.join(ASSETS_DIR, ITEMS[j].dir, phase, `${angle}.jpg`));
    await staff.getByText(`${i + 1} of ${ANGLES.length} angles`).waitFor({ timeout: 60_000 });
    if (rec) await sleep(250);
  }
  await staff.waitForLoadState("networkidle").catch(() => {});
}

async function inspect(kind: "BASELINE" | "RETURN", rec?: Recorder) {
  // Each finished inspection adds one "Gemini (AI)" timeline entry (wording differs by verdict); waiting for a
  // new one also covers re-runs, where the previous report is already on the page.
  const entries = staff.getByText("Gemini (AI)", { exact: true });
  const before = await entries.count();
  const button = staff.getByRole("button", { name: kind === "BASELINE" ? /^Run AI baseline( again)?$/ : /^Run AI return inspection( again)?$/ });
  await button.waitFor();
  await staff.waitForLoadState("networkidle").catch(() => {});
  reserveAiCalls(state, ANGLES.length, `${kind} inspection`);
  rec?.mark(`click run ${kind.toLowerCase()} (wait starts)`);
  try {
    if (rec) await click(staff, button);
    else await button.click();
  } catch (e) {
    state.aiCalls -= ANGLES.length; // the request was never sent
    saveState(state);
    throw e;
  }
  await staff.getByRole("button", { name: /Gemini is/ }).waitFor({ timeout: 5_000 }).catch(() => {});
  await staff.getByRole("button", { name: /Gemini is/ }).waitFor({ state: "detached", timeout: 180_000 });
  for (let i = 0; i < 60 && (await entries.count()) <= before; i++) await sleep(500);
  if ((await entries.count()) <= before) throw new Error(`${kind} inspection finished but no new timeline entry appeared`);
  await staff.waitForLoadState("networkidle").catch(() => {});
  rec?.mark(`${kind.toLowerCase()} result visible (wait ends)`);
  const alerts = await staff.locator("main [role=alert]").filter({ hasText: /\S/ }).allInnerTexts();
  if (alerts.length) console.log(`  alerts: ${alerts.join(" | ")}`);
}

/** Vertex can time out on an angle (504); the app then holds the baseline for review. Retry once, within the cap. */
async function baselineWithRetry(rec?: Recorder) {
  await inspect("BASELINE", rec);
  const incomplete = async () => /^AI baseline incomplete/.test((await staff.getByText(/^AI baseline/).last().innerText()).trim());
  if (await incomplete()) {
    console.log("  baseline incomplete (model call failed on an angle); running it again once");
    rec?.mark("baseline incomplete: retry (cut in edit)");
    await inspect("BASELINE", rec);
    if (await incomplete()) throw new Error("baseline still incomplete after one retry");
  }
}

async function renterAck(j: J) {
  const p = await openPhone(j);
  await p.getByRole("button", { name: /I agree these photos/ }).click();
  await p.getByText("Check-out photos confirmed").waitFor({ timeout: 30_000 });
}

/** Off camera: book, check-out photos, baseline, renter acknowledgement (same real flow). */
async function prep(j: J) {
  console.log(`\n== ${j}-prep (not recorded)`);
  if (!state.journeys[j]) await book(j);
  await ensureStaff();
  await openStaffRental(j);
  // Resume from wherever this rental is: the renter-link box means the baseline is already ready.
  if (!(await staff.locator("section[aria-label='Renter link']").count())) {
    if (!(await staff.getByText(`${ANGLES.length} of ${ANGLES.length} angles`).count())) await uploadAll(j, "checkout");
    await baselineWithRetry();
  }
  if (!journey(j).renterLink) {
    // Adopted booking (approved before the script could read its confirmation): the staff page shows a fresh link.
    const raw = (await staff.locator("section[aria-label='Renter link'] code").innerText()).trim();
    journey(j).renterLink = raw.startsWith("http") ? raw : `${BASE_URL}${raw}`;
    saveState(state);
  }
  await renterAck(j);
  console.log(`  ${j} checked out and acknowledged`);
}

async function confirmLines(rec?: Recorder) {
  const confirm = staff.getByRole("button", { name: /^Confirm / });
  rec?.mark(`staff press: ${(await confirm.textContent())?.trim()}`);
  if (rec) await click(staff, confirm);
  else await confirm.click();
  // The refresh can replace the "Confirmed" note with the "Waiting for the renter" panel before we see it.
  await staff.getByText(/Confirmed\. Send this link to the renter|Waiting for the renter/).first().waitFor({ timeout: 30_000 });
}

async function settle(scene: string, j: J) {
  const rec = new Recorder(state, scene);
  await openStaffRental(j);
  const button = staff.getByRole("button", { name: /^Settle .* with PayPal$/ });
  await scrollTo(staff, staff.locator("#settle-heading"), 120);
  await rec.start();
  await beat();
  rec.mark("press settle");
  await click(staff, button);
  await staff.getByRole("heading", { name: "Receipt" }).waitFor({ timeout: 60_000 });
  rec.mark("receipt visible");
  await scrollTo(staff, staff.getByRole("heading", { name: "Receipt" }), 40);
  await staff.getByText("Waiting for PayPal's signed webhook").waitFor({ state: "detached", timeout: 75_000 }).catch(() => {});
  const late = await staff.getByText("webhook has not arrived yet").isVisible();
  rec.mark(late ? "webhook not arrived within 60 s" : "PayPal-confirmed badges visible");
  await beat(2500);
  const ids = await idsOnPage(staff);
  const r = await rec.stop(1500);
  appendLog({ scene, take: r.take, file: r.file, rentalId: journey(j).rentalId, marks: r.marks, ids, ...(late ? { note: "webhook late" } : {}) });
}

const SCENES: Record<string, () => Promise<void>> = {
  "j2-prep": () => prep("j2"),
  "j3-prep": () => prep("j3"),

  "j1-book": () => book("j1", new Recorder(state, "j1-book")),

  /** Storefront → booking form → PayPal button, ending before the popup (no payment; leaves an unpaid draft).
   * Retake for j1-book, whose footage was unusable; the edit hard-cuts (labelled) to J1's real PayPal popup. */
  "j1-form": async () => {
    const p = staff;
    await p.bringToFront();
    await p.goto(`${BASE_URL}/`);
    await p.waitForLoadState("networkidle").catch(() => {});
    await p.bringToFront();
    const rec = new Recorder(state, "j1-form");
    await rec.start();
    await sleep(4500);
    await scrollTo(p, p.locator("#rent"), 40);
    await beat();
    await click(p, p.locator('a[href="/rent/headphones"]').first());
    await p.getByLabel("Full name").waitFor();
    await p.waitForLoadState("networkidle").catch(() => {});
    rec.mark("booking form");
    await type(p, p.getByLabel("Full name"), "Alex Rivera");
    await type(p, p.getByLabel("Email"), "alex.rivera@example.com");
    await beat();
    await click(p, p.getByRole("button", { name: "Continue to deposit" }));
    await p.frameLocator("iframe[title*='PayPal']").first().locator("[data-funding-source='paypal']").first().waitFor({ timeout: 30_000 });
    rec.mark("paypal button visible");
    await moveTo(p, p.locator("iframe[title*='PayPal']").first());
    const r = await rec.stop(1500);
    appendLog({ scene: "j1-form", take: r.take, file: r.file, marks: r.marks, ids: {}, note: "Retake of the booking form (unpaid draft, not the J1 rental). Edit hard-cuts with a label to J1's real PayPal popup and confirmation in j1-book-approve." });
  },

  "j1-checkout": async () => {
    await ensureStaff();
    await openStaffRental("j1");
    const rec = new Recorder(state, "j1-checkout");
    await rec.start();
    await beat();
    await uploadAll("j1", "checkout", rec);
    rec.mark("6 photos uploaded");
    await beat();
    await baselineWithRetry(rec);
    await scrollTo(staff, staff.locator("#baseline-heading"), 100);
    await beat(2500);
    const r = await rec.stop();
    appendLog({ scene: "j1-checkout", take: r.take, file: r.file, rentalId: journey("j1").rentalId, marks: r.marks, ids: {} });
  },

  "j1-ack": async () => {
    const p = await openPhone("j1");
    const rec = new Recorder(state, "j1-ack");
    await rec.start();
    await beat();
    const agree = p.getByRole("button", { name: /I agree these photos/ });
    await scrollTo(p, p.getByText(/Existing|No existing marks/).first(), 160);
    await beat(1500);
    await click(p, agree);
    await p.getByText("Check-out photos confirmed").waitFor({ timeout: 30_000 });
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    rec.mark("acknowledged");
    const r = await rec.stop(2000);
    appendLog({ scene: "j1-ack", take: r.take, file: r.file, rentalId: journey("j1").rentalId, marks: r.marks, ids: {}, note: "Phone: crop x0 y0 488×1055" });
  },

  "j1-return": async () => {
    await openStaffRental("j1");
    const rec = new Recorder(state, "j1-return");
    await rec.start();
    await beat();
    await uploadAll("j1", "return", rec);
    rec.mark("6 return photos uploaded");
    await staff.reload();
    await staff.getByRole("button", { name: /^Run AI return inspection$/ }).waitFor();
    await staff.waitForLoadState("networkidle").catch(() => {});
    await inspect("RETURN", rec);
    await scrollTo(staff, staff.getByText(/Damage proposed|No new damage detected|No charges proposed/).first(), 30);
    await beat(2500);
    const pre = staff.locator("summary").filter({ hasText: "Pre-existing (not charged)" });
    if (await pre.count()) {
      await scrollTo(staff, pre, 300);
      await click(staff, pre);
      rec.mark("pre-existing expanded");
      await beat(2500);
    }
    const chip = staff.getByText(/from Kestrel.s price list, not the AI/).first();
    if (await chip.count()) {
      await scrollTo(staff, chip, 360);
      await moveTo(staff, chip);
      rec.mark("price chip");
      await beat(2000);
    }
    await confirmLines(rec);
    await beat(1500);
    const r = await rec.stop();
    appendLog({ scene: "j1-return", take: r.take, file: r.file, rentalId: journey("j1").rentalId, marks: r.marks, ids: {} });
  },

  "j1-accept": async () => {
    const p = await openPhone("j1");
    const rec = new Recorder(state, "j1-accept");
    await rec.start();
    await beat(1500);
    const radios = p.getByRole("radio", { name: "Accept" });
    for (let i = 0; i < (await radios.count()); i++) {
      await scrollTo(p, radios.nth(i).locator("xpath=ancestor::li[1]"), 10);
      await beat(1800);
      await click(p, radios.nth(i));
      await beat(600);
    }
    await click(p, p.getByRole("button", { name: "Send my decision" }));
    await p.getByRole("button", { name: "Send my decision" }).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    rec.mark("renter accepted");
    const r = await rec.stop(2500);
    appendLog({ scene: "j1-accept", take: r.take, file: r.file, rentalId: journey("j1").rentalId, marks: r.marks, ids: {}, note: "Phone: crop x0 y0 488×1055" });
  },

  "j1-settle": () => settle("j1-settle", "j1"),

  "j2-return": async () => {
    await ensureStaff();
    await openStaffRental("j2");
    const rec = new Recorder(state, "j2-return");
    await rec.start();
    await beat();
    await uploadAll("j2", "return", rec);
    await staff.reload();
    await staff.getByRole("button", { name: /^Run AI return inspection$/ }).waitFor();
    await staff.waitForLoadState("networkidle").catch(() => {});
    await inspect("RETURN", rec);
    const verdict = staff.getByText(/Damage proposed|No new damage detected|No charges proposed/).first();
    rec.mark(`verdict: ${(await verdict.innerText()).trim()}`);
    await scrollTo(staff, verdict, 30);
    await beat(3500);
    await confirmLines(rec);
    await beat(1500);
    const r = await rec.stop();
    appendLog({ scene: "j2-return", take: r.take, file: r.file, rentalId: journey("j2").rentalId, marks: r.marks, ids: {} });
  },

  "j2-confirm": async () => {
    await ensureStaff();
    await openStaffRental("j2");
    const verdict = staff.getByText(/Damage proposed|No new damage detected|No charges proposed/).first();
    await scrollTo(staff, verdict, 30);
    const rec = new Recorder(state, "j2-confirm");
    await rec.start();
    rec.mark(`verdict: ${(await verdict.innerText()).trim()}`);
    await beat(3500);
    await scrollTo(staff, staff.getByRole("button", { name: /^Confirm / }), 420);
    await beat(1500);
    await confirmLines(rec);
    await beat(1500);
    const r = await rec.stop();
    appendLog({ scene: "j2-confirm", take: r.take, file: r.file, rentalId: journey("j2").rentalId, marks: r.marks, ids: {} });
  },

  "j2-ok": async () => {
    const p = await openPhone("j2");
    const rec = new Recorder(state, "j2-ok");
    await rec.start();
    await beat(2500);
    const ok = p.getByRole("button", { name: "Looks right" });
    if (await ok.isVisible()) await click(p, ok);
    else rec.mark("NOT CLEAN: renter page shows lines");
    await ok.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
    rec.mark("renter: looks right");
    const r = await rec.stop(2500);
    appendLog({ scene: "j2-ok", take: r.take, file: r.file, rentalId: journey("j2").rentalId, marks: r.marks, ids: {}, note: "Phone: crop x0 y0 488×1055" });
  },

  "j2-settle": () => settle("j2-settle", "j2"),

  "j3-return": async () => {
    await ensureStaff();
    await openStaffRental("j3");
    const rec = new Recorder(state, "j3-return");
    await rec.start();
    await beat();
    await uploadAll("j3", "return", rec);
    await staff.reload();
    await staff.getByRole("button", { name: /^Run AI return inspection$/ }).waitFor();
    await staff.waitForLoadState("networkidle").catch(() => {});
    await inspect("RETURN", rec);
    const verdict = staff.getByText(/Damage proposed|No new damage detected|No charges proposed/).first();
    rec.mark(`verdict: ${(await verdict.innerText()).trim()}`);
    await scrollTo(staff, verdict, 30);
    await beat(3000);
    await confirmLines(rec);
    await beat(1200);
    const r = await rec.stop();
    appendLog({ scene: "j3-return", take: r.take, file: r.file, rentalId: journey("j3").rentalId, marks: r.marks, ids: {} });
  },

  "j3-contest": async () => {
    const p = await openPhone("j3");
    const rec = new Recorder(state, "j3-contest");
    await rec.start();
    await beat(1500);
    const radios = p.getByRole("radio", { name: "Contest" });
    const n = await radios.count();
    if (n === 0) rec.mark("NO LINES to contest");
    for (let i = 0; i < n; i++) {
      await scrollTo(p, radios.nth(i).locator("xpath=ancestor::li[1]"), 10);
      await beat(1500);
      await click(p, radios.nth(i));
      await type(p, p.getByLabel(/Why do you disagree/).nth(i), CONTEST_REASON);
      await beat();
    }
    if (n > 0) {
      await click(p, p.getByRole("button", { name: "Send my decision" }));
      await p.getByRole("button", { name: "Send my decision" }).waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
      rec.mark("renter contested");
    }
    const r = await rec.stop(2500);
    appendLog({ scene: "j3-contest", take: r.take, file: r.file, rentalId: journey("j3").rentalId, marks: r.marks, ids: {}, note: "Phone: crop x0 y0 488×1055" });
  },

  "j3-review": async () => {
    await openStaffRental("j3");
    const note = staff.getByText("Renter contested this line").first();
    await scrollTo(staff, note, 260);
    const rec = new Recorder(state, "j3-review");
    await rec.start();
    await beat(2500);
    const boxes = staff.getByRole("checkbox", { name: "Include in deduction" });
    for (let i = 0; i < (await boxes.count()); i++) {
      if (!(await boxes.nth(i).isChecked())) continue;
      await click(staff, boxes.nth(i));
      await staff.waitForFunction((idx) => !(document.querySelectorAll("input[type=checkbox]")[idx] as HTMLInputElement | undefined)?.checked, i, { timeout: 30_000 });
      await beat();
    }
    rec.mark("line excluded");
    await confirmLines(rec);
    await beat(1500);
    const r = await rec.stop();
    appendLog({ scene: "j3-review", take: r.take, file: r.file, rentalId: journey("j3").rentalId, marks: r.marks, ids: {} });
  },

  "j3-ok": async () => {
    const p = await openPhone("j3");
    const rec = new Recorder(state, "j3-ok");
    await rec.start();
    await beat(2000);
    const ok = p.getByRole("button", { name: "Looks right" });
    if (await ok.isVisible()) await click(p, ok);
    await ok.waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
    rec.mark("renter: looks right");
    const r = await rec.stop(2000);
    appendLog({ scene: "j3-ok", take: r.take, file: r.file, rentalId: journey("j3").rentalId, marks: r.marks, ids: {}, note: "Phone: crop x0 y0 488×1055" });
  },

  "j3-settle": () => settle("j3-settle", "j3"),

  trust: async () => {
    await staff.bringToFront();
    await staff.goto(`${BASE_URL}/how-it-works`);
    await staff.waitForLoadState("networkidle").catch(() => {});
    const rec = new Recorder(state, "trust");
    await rec.start();
    await beat(2500);
    await scrollTo(staff, staff.locator("#flow-heading").locator("xpath=.."), 20);
    await beat(2500);
    await scrollTo(staff, staff.locator("#eval-heading"), 60);
    rec.mark("eval card");
    await beat(4000);
    await scrollTo(staff, staff.locator("#rules-heading"), 60);
    await beat(3000);
    const r = await rec.stop();
    appendLog({ scene: "trust", take: r.take, file: r.file, marks: r.marks, ids: {} });
  },
};

const ORDER = ["j2-prep", "j3-prep", "j1-book", "j1-checkout", "j1-ack", "j1-return", "j1-accept", "j1-settle", "j2-return", "j2-confirm", "j2-ok", "j2-settle", "j3-return", "j3-contest", "j3-review", "j3-ok", "j3-settle", "trust"];

async function main() {
  const args = process.argv.slice(2);
  const scenes = args[0] === "all" ? ORDER : args;
  for (const s of scenes) if (!SCENES[s]) throw new Error(`unknown scene ${s}; known: ${ORDER.join(", ")}`);
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null, args: ["--kiosk", "--window-position=0,0", "--disable-infobars"] });
  await ctx.addInitScript(CURSOR_SCRIPT);
  staff = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    for (const s of scenes) {
      console.log(`\n== ${s} (AI calls used ${state.aiCalls})`);
      await SCENES[s]!();
    }
  } catch (e) {
    console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await Recorder.active?.abort();
    saveState(state);
    console.log(`\nAI calls used: ${state.aiCalls}`);
    await ctx.close();
  }
}

void main();
