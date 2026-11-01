import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";

// Recording, pacing and bookkeeping for scripted capture (docs/DEMO_VIDEO_PRODUCTION.md §5).

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
export const RAW_DIR = path.resolve("video/out/raw");
const STATE_FILE = path.resolve("video/out/capture-state.json");
const LOG_FILE = path.resolve("video/capture-log.json");

/** Hard cap on Gemini calls for the whole V2 capture (owner approval: 36 + one 12-call retake). */
export const AI_CALL_CAP = 48;

export interface JourneyState {
  rentalId: string;
  renterLink: string;
}
export interface CaptureState {
  aiCalls: number;
  journeys: Partial<Record<"j1" | "j2" | "j3", JourneyState>>;
  takes: Record<string, number>;
}

export function loadState(): CaptureState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as CaptureState;
  } catch {
    return { aiCalls: 0, journeys: {}, takes: {} };
  }
}
export function saveState(s: CaptureState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/** Reserve Gemini calls before starting an inspection; refuses past the cap. */
export function reserveAiCalls(s: CaptureState, n: number, label: string) {
  if (s.aiCalls + n > AI_CALL_CAP) throw new Error(`AI cap: ${s.aiCalls} used of ${AI_CALL_CAP}; refusing ${label} (${n} calls)`);
  s.aiCalls += n;
  saveState(s);
}

export interface LogEntry {
  scene: string;
  take: number;
  file: string;
  rentalId?: string;
  /** Seconds from clip start → what happened; V4 uses these to place labelled cuts. */
  marks: { t: number; label: string }[];
  ids: Record<string, string[]>;
  note?: string;
}
export function appendLog(entry: LogEntry) {
  let log: LogEntry[] = [];
  try {
    log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8")) as LogEntry[];
  } catch {
    // first entry
  }
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + "\n");
}

/** PayPal and AI identifiers visible on a page (for the truth audit). */
export async function idsOnPage(page: Page): Promise<Record<string, string[]>> {
  const text = await page.locator("main").first().innerText().catch(() => "");
  const grab = (re: RegExp) => [...new Set([...text.matchAll(re)].map((m) => m[1]!))];
  return {
    orders: grab(/(?:Order|PayPal order)\s+([A-Z0-9]{17})/g),
    authorizations: grab(/(?:Authorization(?: ID)?|PayPal authorization|Resource)\s+([A-Z0-9]{17})/g),
    captures: grab(/Capture ID\s+([A-Z0-9]{17})/g),
    webhookEvents: grab(/(WH-[A-Z0-9-]+)/g),
  };
}

/** Screen recording of the primary display (1920×1080 physical) with ffmpeg gdigrab. */
export class Recorder {
  /** The clip being recorded, so a failed scene can be stopped and marked failed. */
  static active: Recorder | undefined;
  private ff?: ChildProcess;
  private started = 0;
  readonly marks: { t: number; label: string }[] = [];
  file = "";

  constructor(
    private state: CaptureState,
    readonly scene: string,
  ) {}

  async start() {
    fs.mkdirSync(RAW_DIR, { recursive: true });
    const take = (this.state.takes[this.scene] ?? 0) + 1;
    this.state.takes[this.scene] = take;
    saveState(this.state);
    this.file = path.join(RAW_DIR, `${this.scene}.take${take}.mp4`);
    this.ff = spawn(
      FFMPEG,
      ["-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "0", "-offset_x", "0", "-offset_y", "0", "-video_size", "1920x1080", "-i", "desktop", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", `${this.file}.part.mp4`],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    Recorder.active = this;
    await sleep(1200); // gdigrab warm-up; the first second is trimmed in the edit anyway
    this.started = Date.now();
    this.mark("start");
  }

  mark(label: string) {
    this.marks.push({ t: Math.round((Date.now() - this.started) / 100) / 10, label });
  }

  async stop(holdMs = 1500): Promise<{ file: string; take: number; marks: { t: number; label: string }[] }> {
    await sleep(holdMs);
    this.mark("end");
    const ff = this.ff!;
    const exited = new Promise((r) => ff.on("exit", r));
    ff.stdin!.write("q");
    await exited;
    fs.renameSync(`${this.file}.part.mp4`, this.file);
    Recorder.active = undefined;
    console.log(`  recorded ${path.basename(this.file)} (${this.marks.at(-1)!.t} s)`);
    return { file: path.relative(process.cwd(), this.file).replaceAll("\\", "/"), take: this.state.takes[this.scene]!, marks: this.marks };
  }

  /** Stop without keeping the clip (failed take). */
  async abort() {
    if (!this.ff || this.ff.exitCode !== null) return;
    const exited = new Promise((r) => this.ff!.on("exit", r));
    this.ff.stdin!.write("q");
    await exited;
    fs.renameSync(`${this.file}.part.mp4`, this.file.replace(/\.mp4$/, ".failed.mp4"));
    Recorder.active = undefined;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A pause long enough for a viewer to read what just appeared. */
export const beat = (ms = rand(700, 1100)) => sleep(ms);

/** Eased cursor move (300–600 ms) to the centre of a locator; the fake cursor follows these events. */
export async function moveTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = await page.evaluate(() => (window as unknown as { __cursor?: { x: number; y: number } }).__cursor ?? { x: innerWidth / 2, y: innerHeight / 2 });
  const ms = rand(300, 600);
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
}

export async function click(page: Page, target: Locator) {
  await moveTo(page, target);
  await sleep(rand(120, 220));
  await target.click();
}

export async function type(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.pressSequentially(text, { delay: rand(55, 85) });
}

/** Smoothly scroll so the target sits `offset` CSS px below the top. */
export async function scrollTo(page: Page, target: Locator, offset = 90) {
  await target.first().evaluate((e, off) => window.scrollTo({ top: e.getBoundingClientRect().top + window.scrollY - off, behavior: "smooth" }), offset);
  await sleep(950);
}

/**
 * Injected into every page: hides scrollbars (browser chrome, not app content) and draws a cursor that
 * follows mouse events, because the OS cursor is not where Playwright's synthetic input is.
 */
export const CURSOR_SCRIPT = `
(() => {
  const css = "html{scrollbar-width:none}html::-webkit-scrollbar{display:none}" +
    "#__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;pointer-events:none;z-index:2147483647;transition:transform 60ms linear}" +
    "#__demo_cursor svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}" +
    "#__demo_cursor.down svg{transform:scale(.85)}";
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    const c = document.createElement("div"); c.id = "__demo_cursor";
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const p = window.__cursor; if (p) c.style.transform = "translate(" + p.x + "px," + p.y + "px)"; else c.style.opacity = "0";
    document.body.appendChild(c);
  };
  addEventListener("mousemove", (e) => { window.__cursor = { x: e.clientX, y: e.clientY }; const c = document.getElementById("__demo_cursor"); if (c) { c.style.opacity = "1"; c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; } }, true);
  addEventListener("mousedown", () => document.getElementById("__demo_cursor")?.classList.add("down"), true);
  addEventListener("mouseup", () => document.getElementById("__demo_cursor")?.classList.remove("down"), true);
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install); else install();
})();
`;
