/**
 * V4 rough cut (docs/DEMO_VIDEO_PRODUCTION.md §7). The edit decision list below cuts the real V2 clips into
 * scenes; every removed span inside a clip gets an on-screen "cut N s" label; footage is never sped up.
 *
 *   npx tsx video/build/edit.ts layers            # render overlay PNGs, phone backgrounds, card stills
 *   npx tsx video/build/edit.ts scenes [id...]    # encode video/out/scenes/<id>.mp4 (all, or the named ones)
 *   npx tsx video/build/edit.ts assemble [final]  # concat + narration + captions → video/out/holdfast-rough.mp4, or holdfast-demo.mp4 (+ .srt)
 *   npx tsx video/build/edit.ts frames            # full-size review frames from the assembled timeline
 *
 * Layers only annotate, or hide OS chrome (taskbar, a checkout session ID); app and PayPal pixels are untouched.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OUT = path.resolve("video/out");
const RAW = path.join(OUT, "raw");
const LAYERS = path.join(OUT, "layers");
const SCENES_DIR = path.join(OUT, "scenes");
const VO = path.join(OUT, "vo", "final");
const CARDS = path.resolve("video/cards");
const STILLS = path.join(OUT, "stills");
/** Where the cropped phone video sits inside phone-bg.html's bezel. */
const PHONE_BOX = { x: 1412, y: 122, w: 386, h: 835 };
/** The renter-phone emulation fills the top-left 488×1055 px of the 1920×1080 capture (390×844 CSS at 1.25). */
const PHONE_CROP = "crop=488:1055:0:0";

type Box = { x: number; y: number; w: number; h: number };
type Callout = Box & { label: string; side?: "right" | "below" | "above" };
/** Times in a window are clip seconds. */
type Window = { from: number; to: number };
interface Seg {
  clip: string;
  in: number;
  out: number;
  /** Renter-phone segment: composited beside a still of the staff page (clip + second). */
  phone?: { staffClip: string; staffAt: number };
  cutLabel?: string;
  callouts?: (Window & { items: Callout[] })[];
  masks?: (Window & { items: Box[] })[];
}
interface Scene {
  id: string;
  card?: { image: string; dur: number };
  segs?: Seg[];
  lower?: { kicker: string; title: string };
  /** Narration blocks (video/out/vo/final/<block>.wav) and their start time in the scene. */
  vo: { block: string; at: number }[];
}

const EDL: Scene[] = [
  { id: "01-title", card: { image: "c01-title.jpg", dur: 7.9 }, vo: [{ block: "title", at: 0.3 }] },
  {
    id: "02-book",
    lower: { kicker: "Real PayPal Sandbox", title: "A $200 deposit, held by PayPal" },
    segs: [
      { clip: "j1-form", in: 1.0, out: 4.5 },
      { clip: "j1-form", in: 10.2, out: 18.8 },
      {
        clip: "j1-book-approve",
        in: 15.5,
        out: 26.6,
        cutLabel: "cut: buyer signs in to PayPal",
        masks: [{ from: 15.5, to: 20.0, items: [{ x: 0, y: 1018, w: 1920, h: 62 }, { x: 372, y: 44, w: 300, h: 32 }] }],
        callouts: [{ from: 23.6, to: 26.6, items: [{ x: 552, y: 40, w: 816, h: 88, label: "A hold, not a charge" }, { x: 552, y: 230, w: 482, h: 106, label: "Real PayPal authorization ID and expiry" }] }],
      },
    ],
    vo: [{ block: "book", at: 0.5 }],
  },
  {
    id: "03-checkout",
    lower: { kicker: "Pickup", title: "Six photos; Gemini notes existing wear" },
    segs: [
      { clip: "j1-checkout", in: 1.2, out: 5.5 },
      { clip: "j1-checkout", in: 41.6, out: 43.8 },
      { clip: "j1-checkout", in: 57.6, out: 62.5 },
      { clip: "j1-ack", in: 1.2, out: 9.0, phone: { staffClip: "j1-checkout", staffAt: 61 } },
    ],
    vo: [{ block: "checkout", at: 0.5 }],
  },
  {
    id: "04-return",
    lower: { kicker: "Return · live Gemini on Vertex AI", title: "Both ear cushions missing" },
    segs: [
      { clip: "j1-return", in: 1.2, out: 4.5 },
      { clip: "j1-return", in: 37.0, out: 39.5 },
      {
        clip: "j1-return",
        in: 66.0,
        out: 80.5,
        callouts: [
          { from: 66.2, to: 69.0, items: [{ x: 1056, y: 222, w: 588, h: 176, label: "Proposed by Gemini, 99% confident" }, { x: 1070, y: 479, w: 362, h: 40, label: "Price from the shop's list, not the AI" }] },
          { from: 72.8, to: 76.6, items: [{ x: 572, y: 376, w: 1088, h: 292, label: "Already recorded at check-out: not charged" }] },
        ],
      },
    ],
    vo: [
      { block: "return", at: 0.4 },
      { block: "price", at: 12.4 },
    ],
  },
  {
    id: "05-accept",
    lower: { kicker: "Renter's phone", title: "Same evidence; the renter accepts" },
    segs: [{ clip: "j1-accept", in: 7.0, out: 16.5, phone: { staffClip: "j1-return", staffAt: 82.0 } }],
    vo: [{ block: "accept", at: 1.0 }],
  },
  {
    id: "06-settle",
    lower: { kicker: "Settlement", title: "$76 captured, $124 voided" },
    segs: [
      { clip: "j1-settle", in: 1.5, out: 9.5 },
      {
        clip: "j1-settle",
        in: 24.5,
        out: 29.9,
        callouts: [{ from: 25.5, to: 29.9, items: [{ x: 582, y: 76, w: 672, h: 44, label: "Exact settlement" }, { x: 588, y: 238, w: 1054, h: 196, label: "PayPal's own statuses, confirmed by signed webhook" }] }],
      },
    ],
    vo: [{ block: "settle", at: 0.5 }],
  },
  { id: "07-chapter", card: { image: "c02-chapter.jpg", dur: 3.5 }, vo: [] },
  {
    id: "08-clean",
    lower: { kicker: "Rental 2 · clean return, real photos", title: "No new damage detected" },
    segs: [
      { clip: "j2-return", in: 1.2, out: 5.0 },
      {
        clip: "j2-confirm",
        in: 1.2,
        out: 9.5,
        cutLabel: "cut 99 s · uploads and live inspection",
        callouts: [{ from: 1.4, to: 5.6, items: [{ x: 594, y: 30, w: 410, h: 54, label: "Live verdict on real photos" }, { x: 594, y: 726, w: 864, h: 104, label: "Old marks matched to check-out" }] }],
      },
      { clip: "j2-ok", in: 1.5, out: 7.7, phone: { staffClip: "j2-confirm", staffAt: 11.5 } },
      { clip: "j2-settle", in: 1.6, out: 6.0 },
      { clip: "j2-settle", in: 11.0, out: 15.5 },
    ],
    vo: [{ block: "clean", at: 0.5 }],
  },
  {
    id: "09-contest",
    lower: { kicker: "Rental 3 · disagreement", title: "Contested, reviewed, dropped" },
    segs: [
      {
        clip: "j3-return",
        in: 71.5,
        out: 75.5,
        cutLabel: "cut 70 s · uploads and live inspection",
        callouts: [{ from: 71.7, to: 75.5, items: [{ x: 1104, y: 226, w: 540, h: 172, label: "Gemini proposes a $15 dent" }] }],
      },
      { clip: "j3-contest", in: 6.0, out: 11.0, phone: { staffClip: "j3-return", staffAt: 74.0 } },
      { clip: "j3-contest", in: 17.0, out: 19.8, phone: { staffClip: "j3-return", staffAt: 74.0 } },
      {
        clip: "j3-review",
        in: 2.5,
        out: 8.5,
        callouts: [{ from: 2.6, to: 5.4, items: [{ x: 1106, y: 306, w: 538, h: 124, label: "The renter's reason" }, { x: 1120, y: 446, w: 520, h: 36, label: "Staff exclude the line" }] }],
      },
      { clip: "j3-settle", in: 10.5, out: 15.4 },
    ],
    vo: [{ block: "contest", at: 0.5 }],
  },
  {
    id: "10-trust",
    lower: { kicker: "Guardrails", title: "Measured on our own real photos" },
    segs: [{ clip: "trust", in: 4.0, out: 17.0, callouts: [{ from: 10.0, to: 14.5, items: [{ x: 256, y: 40, w: 1408, h: 340, label: "Real photos, sample size stated", side: "below" }] }] }],
    vo: [{ block: "trust", at: 0.5 }],
  },
  { id: "11-end", card: { image: "c03-end.jpg", dur: 8.0 }, vo: [{ block: "end", at: 0.8 }] },
];

const clipFile = (clip: string) => path.join(RAW, `${clip}.take1.mp4`);
const run = (args: string[]) => execFileSync(FFMPEG, ["-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const hash = (v: unknown) => crypto.createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 12);

interface Cue {
  text: string;
  start: number;
  end: number;
}
const voInfo = (block: string) => JSON.parse(fs.readFileSync(path.join(VO, `${block}.json`), "utf8")) as { duration: number; cues: Cue[] };

/** Layers a scene needs: [png file, scene-time from, scene-time to]. */
interface Layer {
  items: unknown[];
  from: number;
  to: number;
}

function planScene(s: Scene) {
  const segs = s.segs ?? [];
  const starts: number[] = [];
  let t = 0;
  for (const g of segs) {
    starts.push(t);
    t += g.out - g.in;
  }
  const voEnd = Math.max(0, ...s.vo.map((v) => v.at + voInfo(v.block).duration));
  const dur = +(s.card ? s.card.dur : Math.max(t, voEnd + 0.4)).toFixed(3);
  const layers: Layer[] = [];
  if (s.lower) layers.push({ items: [{ kind: "lower", ...s.lower }], from: 0.2, to: 4.6 });
  segs.forEach((g, i) => {
    const at = (clipT: number) => starts[i]! + (clipT - g.in);
    const prev = segs[i - 1];
    const label = g.cutLabel ?? (prev && prev.clip === g.clip && g.in - prev.out > 1 ? `cut ${Math.round(g.in - prev.out)} s` : undefined);
    if (label) layers.push({ items: [{ kind: "cut", text: label }], from: starts[i]!, to: Math.min(starts[i]! + 2.2, dur) });
    for (const w of g.masks ?? []) layers.push({ items: w.items.map((b) => ({ kind: "mask", ...b })), from: at(w.from), to: at(w.to) });
    for (const w of g.callouts ?? []) layers.push({ items: w.items.map((c) => ({ kind: "callout", ...c })), from: at(w.from), to: at(w.to) });
  });
  for (const v of s.vo) for (const c of voInfo(v.block).cues) layers.push({ items: [{ kind: "caption", text: c.text }], from: v.at + c.start, to: v.at + c.end });
  // Last, so callout dimming never covers the disclosure.
  if (!s.card) layers.push({ items: [{ kind: "tag" }], from: 0, to: dur });
  return { segs, starts, dur, layers };
}

const layerPng = (items: unknown[]) => path.join(LAYERS, `${hash(items)}.png`);
const phoneBgPng = (g: Seg) => path.join(LAYERS, `phonebg-${g.phone!.staffClip}-${g.phone!.staffAt}.png`);

async function renderLayers() {
  fs.mkdirSync(LAYERS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const done = new Set<string>();
  for (const s of EDL) {
    const { layers, segs } = planScene(s);
    for (const l of layers) {
      const file = layerPng(l.items);
      if (done.has(file)) continue;
      done.add(file);
      await page.goto(`${pathToFileURL(path.join(CARDS, "layer.html")).href}?${hash(l.items)}#${encodeURIComponent(JSON.stringify({ items: l.items }))}`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: file, omitBackground: true });
    }
    for (const g of segs.filter((x) => x.phone)) {
      const file = phoneBgPng(g);
      if (done.has(file)) continue;
      done.add(file);
      const still = file.replace(/\.png$/, "-staff.png");
      run(["-ss", String(g.phone!.staffAt), "-i", clipFile(g.phone!.staffClip), "-frames:v", "1", still]);
      await page.goto(`${pathToFileURL(path.join(CARDS, "phone-bg.html")).href}?${path.basename(file)}#${encodeURIComponent(pathToFileURL(still).href)}`);
      await page.evaluate(() => Promise.all([document.fonts.ready, ...Array.from(document.images).map((i) => i.decode().catch(() => {}))]));
      await page.screenshot({ path: file });
    }
  }
  await browser.close();
  console.log(`layers: ${done.size} PNGs in ${path.relative(process.cwd(), LAYERS)}`);
}

function encodeScene(s: Scene) {
  const { segs, dur, layers } = planScene(s);
  const args: string[] = [];
  const filters: string[] = [];
  let n = 0;
  let base: string;
  if (s.card) {
    args.push("-loop", "1", "-framerate", "30", "-t", String(dur), "-i", path.join(STILLS, s.card.image));
    // JPEG stills decode as full-range; convert so every scene is limited-range yuv420p and concat stays uniform.
    filters.push(`[0:v]scale=1920:1080:in_range=full:out_range=limited,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5[b0]`);
    n = 1;
    base = "b0";
  } else {
    const parts: string[] = [];
    segs.forEach((g, i) => {
      const len = (g.out - g.in).toFixed(3);
      args.push("-ss", String(g.in), "-t", len, "-i", clipFile(g.clip));
      const vi = n++;
      if (g.phone) {
        args.push("-loop", "1", "-framerate", "30", "-t", len, "-i", phoneBgPng(g));
        const bi = n++;
        filters.push(`[${vi}:v]${PHONE_CROP},scale=${PHONE_BOX.w}:${PHONE_BOX.h},fps=30,setpts=PTS-STARTPTS[p${i}]`);
        filters.push(`[${bi}:v]fps=30,setpts=PTS-STARTPTS[g${i}]`);
        filters.push(`[g${i}][p${i}]overlay=${PHONE_BOX.x}:${PHONE_BOX.y}:shortest=1,format=yuv420p,setsar=1[s${i}]`);
      } else {
        filters.push(`[${vi}:v]fps=30,setpts=PTS-STARTPTS,scale=1920:1080,format=yuv420p,setsar=1[s${i}]`);
      }
      parts.push(`[s${i}]`);
    });
    filters.push(`${parts.join("")}concat=n=${segs.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=5[b0]`);
    base = "b0";
  }
  layers.forEach((l, i) => {
    args.push("-i", layerPng(l.items));
    const li = n++;
    const next = `v${i + 1}`;
    filters.push(`[${base}][${li}:v]overlay=0:0:enable='between(t,${l.from.toFixed(2)},${l.to.toFixed(2)})'[${next}]`);
    base = next;
  });
  fs.mkdirSync(SCENES_DIR, { recursive: true });
  const tmp = path.join(SCENES_DIR, `${s.id}.tmp.mp4`);
  run([...args, "-filter_complex", filters.join(";"), "-map", `[${base}]`, "-t", String(dur), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-color_range", "tv", "-an", tmp]);
  fs.renameSync(tmp, path.join(SCENES_DIR, `${s.id}.mp4`));
  console.log(`scene ${s.id}: ${dur.toFixed(1)} s, ${segs.length} segment(s), ${layers.length} layer(s)`);
}

function timeline() {
  let t = 0;
  return EDL.map((s) => {
    const { dur } = planScene(s);
    const r = { s, start: t, dur };
    t += dur;
    return r;
  });
}

const srtTime = (x: number) => {
  const ms = Math.round(x * 1000);
  const p = (v: number, w = 2) => String(v).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

function assemble(name = "holdfast-rough") {
  const tl = timeline();
  const total = tl.reduce((a, x) => a + x.dur, 0);
  const list = path.join(OUT, "scenes.txt");
  fs.writeFileSync(list, tl.map((x) => `file '${path.join(SCENES_DIR, `${x.s.id}.mp4`).replaceAll("\\", "/")}'`).join("\n") + "\n");
  const video = path.join(OUT, "rough-video.mp4");
  run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);

  // Narration: each block at its absolute time, mixed without level changes, then the whole track to −16 LUFS.
  const blocks = tl.flatMap((x) => x.s.vo.map((v) => ({ file: path.join(VO, `${v.block}.wav`), at: x.start + v.at, block: v.block })));
  const args = blocks.flatMap((b) => ["-i", b.file]);
  const f = blocks.map((b, i) => `[${i}:a]adelay=${Math.round(b.at * 1000)}:all=1[a${i}]`);
  f.push(`${blocks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${blocks.length}:normalize=0,apad=whole_dur=${total.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]`);
  const narration = path.join(OUT, "narration.wav");
  run([...args, "-filter_complex", f.join(";"), "-map", "[mix]", "-t", total.toFixed(2), narration]);

  const out = path.join(OUT, `${name}.mp4`);
  run(["-i", video, "-i", narration, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", out]);

  // Captions are burned in per scene (layer PNGs); the .srt carries the same text and timings for YouTube.
  let k = 0;
  const srt = tl.flatMap((x) => x.s.vo.flatMap((v) => voInfo(v.block).cues.map((c) => `${++k}\n${srtTime(x.start + v.at + c.start)} --> ${srtTime(x.start + v.at + c.end)}\n${c.text}\n`)));
  fs.writeFileSync(path.join(OUT, `${name}.srt`), srt.join("\n"));
  console.log(`assembled ${path.relative(process.cwd(), out)}: ${total.toFixed(1)} s, ${blocks.length} narration blocks, ${k} captions`);
  for (const x of tl) console.log(`  ${x.start.toFixed(1).padStart(6)}  ${x.s.id}`);
}

function frames(times: number[]) {
  const out = path.join(OUT, fs.existsSync(path.join(OUT, "holdfast-demo.mp4")) ? "holdfast-demo.mp4" : "holdfast-rough.mp4");
  fs.mkdirSync(path.join(OUT, "review", "rough"), { recursive: true });
  for (const t of times) run(["-ss", String(t), "-i", out, "-frames:v", "1", path.join(OUT, "review", "rough", `t${t.toFixed(1)}.png`)]);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "layers") await renderLayers();
  else if (cmd === "scenes") for (const s of EDL.filter((x) => rest.length === 0 || rest.includes(x.id))) encodeScene(s);
  else if (cmd === "assemble") assemble(rest[0] === "final" ? "holdfast-demo" : undefined);
  else if (cmd === "frames") frames(rest.map(Number));
  else throw new Error("usage: edit.ts layers | scenes [id...] | assemble | frames <t...>");
}

void main();
