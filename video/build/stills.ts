/**
 * V1 keyframe stills (docs/DEMO_VIDEO_PRODUCTION.md §4), all from the real app:
 *   raw     live production pages at 1920×1080 (browser zoom 125%) and the renter phone at 390×844,
 *           plus crops of rehearsal screenshots for states that no longer exist (report before settlement).
 *   compose cards and annotated stills via video/cards/*.html → JPEG q92 in video/out/stills/.
 *
 *   npx tsx video/build/stills.ts raw
 *   npx tsx video/build/stills.ts compose
 *
 * Read-only against production: no AI calls, no PayPal calls. Staff passcode and renter tokens are read
 * from .env.local and the gitignored rehearsal output, never printed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { BASE_URL } from "../capture/config";

const OUT = path.resolve("video/out/stills");
const RAW = path.join(OUT, "raw");
const REH = path.resolve("video/out/rehearsal");
const CARDS = path.resolve("video/cards");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
fs.mkdirSync(RAW, { recursive: true });

/** Filmed at 125% zoom: a 1536×864 CSS viewport rendered at 1.25× fills a 1920×1080 frame. */
const FILM = { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const RENTALS = { j1: "r_761eba53fedd06eb56df", j2: "r_8a00e9bf068a25cab780", j3: "r_8fbe9765483bbaccb4e0" } as const;

function renterToken(j: keyof typeof RENTALS): string {
  const dir = path.join(REH, j);
  const file = fs.readdirSync(dir).find((f) => f.endsWith("staff-confirmed.txt"));
  const m = file && fs.readFileSync(path.join(dir, file), "utf8").match(/\/r\/([A-Za-z0-9._-]+)/);
  if (!m?.[1]) throw new Error(`no renter link recorded for ${j}`);
  return m[1];
}

function staffPasscode(): string {
  const m = fs.readFileSync(".env.local", "utf8").match(/^STAFF_PASSCODE=(.*)$/m);
  if (!m?.[1]) throw new Error("STAFF_PASSCODE missing from .env.local");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function ready(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** Scroll so the element's top sits `offset` CSS px below the viewport top, then screenshot the viewport. */
async function shootAt(page: Page, selector: string | null, file: string, offset = 24) {
  if (selector) {
    await page.locator(selector).first().evaluate((e, off) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - off), offset);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(RAW, file) });
  console.log(`raw ${file}`);
}

/** Crop a 1536×864 window from a 100%-zoom rehearsal screenshot and scale it to 1920×1080 (approximates 125% zoom). */
function cropRehearsal(src: string, y: number, file: string) {
  const x = 184; // centers 1536 px in the 1905 px wide full-page capture
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", path.join(REH, src), "-vf", `crop=1536:864:${x}:${y},scale=1920:1080:flags=lanczos`, path.join(RAW, file)]);
  console.log(`raw ${file} (from rehearsal ${src})`);
}

async function raw() {
  const browser = await chromium.launch();
  const film = await browser.newContext(FILM);
  const p = await film.newPage();

  await p.goto(`${BASE_URL}/`);
  await ready(p);
  await shootAt(p, null, "s01-storefront.png");

  await p.goto(`${BASE_URL}/rent/confirmed/${RENTALS.j1}?t=${renterToken("j1")}`);
  await ready(p);
  await shootAt(p, "h1", "s02-authorized.png", 40);

  await p.goto(`${BASE_URL}/how-it-works`);
  await ready(p);
  await shootAt(p, "#eval-heading", "s09-eval.png", 60);

  await p.goto(`${BASE_URL}/staff/login`);
  await p.getByLabel("Staff passcode").fill(staffPasscode());
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/staff$/);
  for (const [j, file] of [["j1", "s05-j1-receipt.png"], ["j2", "s07-j2-receipt.png"], ["j3", "s08-j3-receipt.png"]] as const) {
    await p.goto(`${BASE_URL}/staff/rentals/${RENTALS[j]}`);
    await ready(p);
    await shootAt(p, "h2:text-is('Receipt')", file, 24);
  }

  const phone = await browser.newContext(PHONE);
  const r = await phone.newPage();
  await r.goto(`${BASE_URL}/r/${renterToken("j1")}`);
  await ready(r);
  await shootAt(r, null, "s06-j1-renter-phone.png");

  await browser.close();

  cropRehearsal("j1/03-return-review.png", 150, "s03-j1-report.png");
  cropRehearsal("j3/01-contest-review.png", 150, "s08b-j3-contest.png");
}

type Callout = { x: number; y: number; w: number; h: number; label: string; below?: boolean; right?: boolean };
type Spec = { bg?: string; split?: boolean; phone?: string; callouts?: Callout[]; lower?: { kicker: string; title: string }; cut?: string };

/** Annotated stills. Callout boxes are positioned on the raw frames (1920×1080 coordinates). */
const SHOTS: Record<string, Spec> = {
  "s01-storefront": { bg: "s01-storefront.png", lower: { kicker: "Kestrel Gear Rentals, a demo shop", title: "The renter books; the deposit goes on PayPal" } },
  "s02-authorized": { bg: "s02-authorized.png", callouts: [{ x: 552, y: 150, w: 816, h: 82, label: "A hold, not a charge", right: true }, { x: 552, y: 340, w: 480, h: 104, label: "Real PayPal authorization ID and expiry", right: true }] },
  "s03-j1-report": { bg: "s03-j1-report.png", cut: "cut 14 s", callouts: [{ x: 1062, y: 284, w: 596, h: 182, label: "Proposed by Gemini, 98% confident", right: true }, { x: 1076, y: 538, w: 372, h: 50, label: "Price from the shop's list, not the AI", right: true }], lower: { kicker: "Live comparison of check-out and return", title: "Two parts missing: proposed, not charged" } },
  "s05-j1-receipt": { bg: "s05-j1-receipt.png", callouts: [{ x: 582, y: 56, w: 670, h: 46, label: "Exact settlement", right: true }, { x: 588, y: 218, w: 1054, h: 200, label: "PayPal's own statuses, confirmed by signed webhook", right: true }] },
  "s06-phone": { split: true, bg: "s05-j1-receipt.png", phone: "s06-j1-renter-phone.png", lower: { kicker: "Both sides see the same record", title: "$76 captured, the remaining $124 voided" } },
  "s07-j2-receipt": { bg: "s07-j2-receipt.png", callouts: [{ x: 582, y: 56, w: 782, h: 46, label: "Clean return, real photos", right: true }, { x: 588, y: 218, w: 1054, h: 98, label: "The whole authorization voided", right: true }] },
  "s08-j3-contest": { bg: "s08b-j3-contest.png", callouts: [{ x: 1112, y: 578, w: 546, h: 124, label: "The renter's reason", right: true }, { x: 1124, y: 712, w: 524, h: 44, label: "Staff exclude the line", right: true }], lower: { kicker: "Disagreement has a path", title: "Contested, reviewed, dropped" } },
  "s09-eval": { bg: "s09-eval.png", callouts: [{ x: 256, y: 40, w: 1408, h: 340, label: "Real photos, sample size stated", below: true }] },
};

async function compose() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const cards: [string, string][] = [
    ["c01-title", "title.html"],
    ["c02-chapter", `chapter.html?n=${encodeURIComponent("Rental 2 of 3")}&t=${encodeURIComponent("A clean return")}&s=${encodeURIComponent("Different light, same bag. A fair system has to say “nothing new”.")}`],
    ["c03-end", "end.html"],
  ];
  for (const [name, file] of cards) {
    await page.goto(pathToFileURL(path.join(CARDS, file.split("?")[0]!)).href + (file.includes("?") ? `?${file.split("?")[1]}` : ""));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 92 });
    console.log(`card ${name}.jpg`);
  }
  for (const [name, spec] of Object.entries(SHOTS)) {
    const abs = (f?: string) => f && pathToFileURL(path.join(RAW, f)).href;
    const full = { ...spec, bg: abs(spec.bg), phone: abs(spec.phone) };
    // A distinct query per shot forces a real load; a hash-only change would keep the previous overlay.
    await page.goto(`${pathToFileURL(path.join(CARDS, "overlay.html")).href}?shot=${name}#${encodeURIComponent(JSON.stringify(full))}`);
    await page.evaluate(() => Promise.all([document.fonts.ready, ...Array.from(document.images).map((i) => i.decode().catch(() => {}))]));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 92 });
    console.log(`still ${name}.jpg`);
  }
  await browser.close();
}

const cmd = process.argv[2];
if (cmd === "raw") void raw();
else if (cmd === "compose") void compose();
else throw new Error("usage: stills.ts raw|compose");
