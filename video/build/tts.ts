/**
 * V3 voice-over with Google Cloud Text-to-Speech, Chirp 3: HD voices (docs/DEMO_VIDEO_PRODUCTION.md §6).
 *
 *   npx tsx video/build/tts.ts voices                     # list en-US Chirp 3: HD voices
 *   npx tsx video/build/tts.ts audition <voice> [...]     # hook + clean-return lines per voice
 *   npx tsx video/build/tts.ts generate <voice> [scene]   # every scene block in video/script.md (or one)
 *
 * Auth: the owner's Application Default Credentials (the same as Vertex); no key is stored or printed.
 * Hard cap: 60 synthesis requests per run. Output: LINEAR16 48 kHz WAV in video/out/vo/.
 */
import fs from "node:fs";
import path from "node:path";
// Transitive dependency of @google-cloud/firestore and @google/genai; used here only to mint an ADC access token.
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.GCP_PROJECT_ID ?? "holdfast-demo-2026";
const API = "https://texttospeech.googleapis.com/v1";
const OUT = path.resolve("video/out/vo");
const MAX_REQUESTS = 60;
let requests = 0;

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function synthesize(voice: string, text: string, file: string) {
  if (++requests > MAX_REQUESTS) throw new Error(`request cap ${MAX_REQUESTS} reached`);
  const r = await call<{ audioContent: string }>("POST", `${API}/text:synthesize`, {
    input: { text },
    voice: { languageCode: "en-US", name: voice },
    audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 48000 },
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.audioContent, "base64"));
  fs.writeFileSync(file.replace(/\.wav$/, ".txt"), text + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)} (${text.length} chars)`);
}

/** Scene blocks from video/script.md: "## <scene>" headings, narration in the following "> " quote lines. */
function scriptBlocks(): { scene: string; text: string }[] {
  const md = fs.readFileSync("video/script.md", "utf8");
  const blocks: { scene: string; text: string }[] = [];
  let scene = "";
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^## (\S+)/);
    if (h) scene = h[1]!;
    else if (scene && line.startsWith("> ")) {
      const last = blocks.at(-1);
      if (last?.scene === scene) last.text += " " + line.slice(2).trim();
      else blocks.push({ scene, text: line.slice(2).trim() });
    }
  }
  return blocks;
}

const AUDITION = [
  "Deposits are where rental shops and renters stop trusting each other. Holdfast fixes that with evidence, consent, and PayPal.",
  "Most rentals come back fine, and a fair system has to say so. Holdfast says no new damage, and PayPal voids the whole authorization. Nothing is charged.",
].join(" ");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "voices") {
    const r = await call<{ voices: { name: string; ssmlGender: string }[] }>("GET", `${API}/voices?languageCode=en-US`);
    for (const v of r.voices.filter((v) => v.name.includes("Chirp3-HD"))) console.log(`${v.name}\t${v.ssmlGender}`);
  } else if (cmd === "audition") {
    for (const voice of args) await synthesize(voice, AUDITION, path.join(OUT, "audition", `${voice}.wav`));
  } else if (cmd === "generate") {
    const [voice, only] = args;
    if (!voice) throw new Error("generate <voice> [scene]");
    for (const b of scriptBlocks().filter((b) => !only || b.scene === only)) await synthesize(voice, b.text, path.join(OUT, `${b.scene}.wav`));
  } else {
    throw new Error("usage: tts.ts voices | audition <voice...> | generate <voice> [scene]");
  }
  console.log(`synthesis requests this run: ${requests}`);
}

void main();
