/**
 * V3 finish (docs/DEMO_VIDEO_PRODUCTION.md §6 steps 4–6): per narration block
 *   - 80 Hz high-pass, loudness −16 LUFS (true peak −1.5 dB), 0.3 s silence before and after → video/out/vo/final/<scene>.wav
 *   - sentence timings from the real audio (pauses found by ffmpeg silencedetect) → video/out/vo/final/<scene>.json,
 *     used by V4 to write captions. If pauses and sentences don't line up, timings fall back to character share
 *     and the file says so.
 *
 *   npx tsx video/build/vo-finish.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const VO = path.resolve("video/out/vo");
const FINAL = path.join(VO, "final");
const PAD = 0.3;
const SCENES = ["title", "book", "checkout", "return", "price", "accept", "settle", "clean", "contest", "trust", "end"];

const duration = (f: string) => Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

/** Sentences as spoken; a colon starts a new caption line too. */
const sentences = (text: string) => text.match(/[^.!?:]+[.!?:]?/g)!.map((s) => s.trim()).filter(Boolean);

/** Pauses ≥ 0.18 s inside the speech, as [start, end] seconds. */
function pauses(file: string): [number, number][] {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.18", "-f", "null", "-"], { encoding: "utf8" });
  const starts = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((s, i) => [s, ends[i] ?? s] as [number, number]).filter(([s, e]) => s > 0.05 && e < duration(file) - 0.05);
}

fs.mkdirSync(FINAL, { recursive: true });
for (const scene of SCENES) {
  const src = path.join(VO, `${scene}.wav`);
  const text = fs.readFileSync(path.join(VO, `${scene}.txt`), "utf8").trim();
  const out = path.join(FINAL, `${scene}.wav`);
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", src, "-af", `highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11,adelay=${PAD * 1000}:all=1,apad=pad_dur=${PAD}`, "-ar", "48000", "-ac", "1", out]);

  const len = duration(src);
  const lines = sentences(text);
  // A boundary sits mid-pause; pick the longest pauses, one per sentence break.
  const gaps = pauses(src)
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, lines.length - 1)
    .sort((a, b) => a[0] - b[0]);
  let method = "silencedetect";
  let bounds: number[];
  if (gaps.length === lines.length - 1) {
    bounds = [0, ...gaps.map(([s, e]) => (s + e) / 2), len];
  } else {
    method = "character-share (pauses did not match sentences)";
    const total = lines.reduce((n, l) => n + l.length, 0);
    let acc = 0;
    bounds = [0, ...lines.map((l) => (acc += (l.length / total) * len))];
  }
  const cues = lines.map((l, i) => ({ text: l, start: +(bounds[i]! + PAD).toFixed(2), end: +(bounds[i + 1]! + PAD).toFixed(2) }));
  fs.writeFileSync(path.join(FINAL, `${scene}.json`), JSON.stringify({ scene, voice: "en-US-Chirp3-HD-Charon", duration: +(len + 2 * PAD).toFixed(2), method, cues }, null, 2) + "\n");
  console.log(`${scene.padEnd(9)} ${(len + 2 * PAD).toFixed(2)} s  ${lines.length} cue(s)  ${method}`);
}
