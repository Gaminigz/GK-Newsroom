/**
 * One-time stopgap: fill missing `spice_podcast` audio using macOS's
 * built-in `say` voices instead of Gemini TTS — used when the Gemini
 * project's monthly spend cap blocks `npm run spicecast`.
 *
 * Builds a short Dara/Maly two-line narration directly from each spice's
 * existing `post` text (no Gemini call at all — fully offline), voices it
 * with two distinct macOS voices, and writes straight into Mongo with the
 * same shape `ensureSpiceEpisode` uses so /food can't tell the difference
 * player-side. Marks `voiceSource: "macos-say"` for traceability so a
 * future Gemini pass can find-and-upgrade these specifically.
 *
 * macOS only (needs `say` + `afconvert`) — NOT part of the Railway
 * pipeline, run by hand from this machine. Idempotent: skips ids that
 * already have a ready episode unless --force.
 *
 * Usage:
 *   npm run spicecast:local
 *   npm run spicecast:local -- --force
 *   npm run spicecast:local -- --id=beef-lung-curry
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Binary } from "mongodb";
import { getDb, closeDb } from "../lib/mongo.ts";
import { SPICES } from "../data/spices.ts";

const run = promisify(execFile);
const COLLECTION = "spice_podcast";
const FORCE = process.argv.includes("--force");
const ONLY_ID = (process.argv.find((a) => a.startsWith("--id=")) || "").split("=")[1] || null;

const VOICE_DARA = "Daniel"; // en_GB, curious host
const VOICE_MALY = "Samantha"; // en_US, storyteller host
const SAMPLE_RATE = 24_000;

/** Build a short two-line narration from data already in spices.ts —
 * no Gemini call. Mirrors the Dara(intro)/Maly(explain+tip) shape of the
 * Gemini-written episodes without inventing anything new. */
function buildScript(spice) {
  const daraLine = `Today on 3una5aha: ${spice.name} — in Sinhala, ${spice.sinhala}.`;
  let malyLine = spice.post.trim();
  // Keep it in the same ~25-40s ballpark as the Gemini episodes.
  const words = malyLine.split(/\s+/);
  if (words.length > 80) malyLine = words.slice(0, 80).join(" ") + "…";
  return { daraLine, malyLine, text: `Dara: ${daraLine}\nMaly: ${malyLine}` };
}

async function synthesizeVoice(text, voice, outAiff) {
  await run("say", ["-v", voice, "-o", outAiff, text]);
}

async function aiffToPcm(aiffPath) {
  const wavPath = aiffPath.replace(/\.aiff$/, ".wav");
  await run("afconvert", ["-f", "WAVE", "-d", `LEI16@${SAMPLE_RATE}`, "-c", "1", aiffPath, wavPath]);
  const buf = await readFile(wavPath);
  await unlink(wavPath).catch(() => {});
  // Strip the 44-byte WAV header — we re-wrap the concatenated PCM once at the end.
  return buf.subarray(44);
}

function pcmToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Half a second of silence at 16-bit mono — a small gap between speakers. */
const GAP_MS = 350;
const gapPcm = Buffer.alloc(Math.round(SAMPLE_RATE * 2 * (GAP_MS / 1000)));

async function synthesizeEpisode(spice) {
  const { daraLine, malyLine, text } = buildScript(spice);
  const tmp = tmpdir();
  const daraAiff = path.join(tmp, `dara-${spice.id}.aiff`);
  const malyAiff = path.join(tmp, `maly-${spice.id}.aiff`);
  try {
    await synthesizeVoice(daraLine, VOICE_DARA, daraAiff);
    await synthesizeVoice(malyLine, VOICE_MALY, malyAiff);
    const [daraPcm, malyPcm] = await Promise.all([aiffToPcm(daraAiff), aiffToPcm(malyAiff)]);
    const pcm = Buffer.concat([daraPcm, gapPcm, malyPcm]);
    const wav = pcmToWav(pcm);
    const durationSec = Math.round(pcm.length / (SAMPLE_RATE * 2));
    return { wav, durationSec, script: text };
  } finally {
    await unlink(daraAiff).catch(() => {});
    await unlink(malyAiff).catch(() => {});
  }
}

async function main() {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const targets = ONLY_ID ? SPICES.filter((s) => s.id === ONLY_ID) : SPICES;
  if (ONLY_ID && targets.length === 0) throw new Error(`no spice with id "${ONLY_ID}"`);

  let ok = 0, skip = 0, fail = 0;
  for (const s of targets) {
    if (!FORCE) {
      const existing = await col.findOne({ _id: s.id }, { projection: { status: 1 } });
      if (existing?.status === "ready") { skip++; continue; }
    }
    try {
      const { wav, durationSec, script } = await synthesizeEpisode(s);
      await col.updateOne(
        { _id: s.id },
        {
          $set: {
            status: "ready",
            script,
            audio: new Binary(wav),
            mime: "audio/wav",
            durationSec,
            sizeBytes: wav.length,
            voiceSource: "macos-say",
            createdAt: new Date(),
          },
          $unset: { error: "" },
        },
        { upsert: true },
      );
      console.log(`✓ ${s.id} (${durationSec}s)`);
      ok++;
    } catch (e) {
      console.log(`✗ ${s.id}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\ndone — ${ok} generated, ${skip} already ready, ${fail} failed.`);
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
