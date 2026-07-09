/**
 * 3una5aha spice mini-podcasts — one 1–2 minute Dara & Maly episode per
 * spice, generated ONCE and stored in Mongo (`spice_podcast`, _id =
 * spice id, audio as BSON Binary WAV) so the /food page streams the
 * back-catalog instantly forever.
 *
 * Generation is idempotent: a ready episode is never re-paid for.
 * Cost ≈ $0.35 per spice (TTS-dominated), one-time.
 */

import { GoogleGenAI } from "@google/genai";
import { Binary } from "mongodb";
import { getDb } from "./mongo";
import type { Spice } from "../data/spices";

const SCRIPT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const COLLECTION = "spice_podcast";

export type SpiceEpisodeMeta = {
  id: string;
  status: "ready" | "failed";
  durationSec?: number;
  sizeBytes?: number;
  error?: string;
};

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

const SCRIPT_PROMPT = `You write 60-90 second mini-episodes of "3una5aha" — a bite-size
podcast about the spices of Sri Lankan cooking, hosted by the same two Yai newsroom
voices, Dara and Maly, in Phnom Penh.

Hosts:
- Dara — curious, asks what it smells/tastes like, where it goes.
- Maly — the food storyteller, warm and concrete.

Write ONE mini-episode about the spice given below. Rules:
- Total 150–210 words (60–90 seconds spoken).
- Open with Dara naming the spice (English + how the Sinhala name sounds).
- Use ONLY the facts provided; you may add universally known culinary facts, but
  never invent statistics or history that isn't common knowledge.
- Make one concrete dish reference the listener can picture.
- Close with Maly's one-line "how to use it at home" tip.
- Output: plain text, one line per turn, exactly like:
Dara: ...
Maly: ...
No stage directions, no markdown.`;

async function writeScript(ai: GoogleGenAI, spice: Spice): Promise<string> {
  const res = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${SCRIPT_PROMPT}\n\nSpice: ${spice.name} (Sinhala: ${spice.sinhala}, category: ${spice.category})\nFacts: ${spice.post}`,
          },
        ],
      },
    ],
    config: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      // 2.5-Flash gotcha: thinking tokens eat the output budget.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = res.text?.trim();
  if (!text || !text.includes("Dara:") || !text.includes("Maly:")) {
    throw new Error("unusable script");
  }
  const words = text.split(/\s+/).length;
  if (words < 100) throw new Error(`script too short (${words} words)`);
  return text;
}

async function synthesize(ai: GoogleGenAI, script: string): Promise<Buffer> {
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [
      { role: "user", parts: [{ text: `TTS the following conversation between Dara and Maly:\n\n${script}` }] },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: "Dara", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
            { speaker: "Maly", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          ],
        },
      },
    },
  });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const b64 = part?.inlineData?.data;
  if (!b64) throw new Error("TTS returned no audio data");
  return Buffer.from(b64, "base64");
}

/** Wrap raw 16-bit mono 24 kHz PCM (Gemini TTS output) in a WAV header. */
function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
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

/** Generate (if missing) and return meta. Never re-generates a ready episode. */
export async function ensureSpiceEpisode(spice: Spice, force = false): Promise<SpiceEpisodeMeta> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const existing = await col.findOne(
    { _id: spice.id as never },
    { projection: { audio: 0, script: 0 } },
  );
  if (existing?.status === "ready" && !force) {
    return { id: spice.id, status: "ready", durationSec: existing.durationSec, sizeBytes: existing.sizeBytes };
  }

  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  try {
    const script = await writeScript(ai, spice);
    const pcm = await synthesize(ai, script);
    const wav = pcmToWav(pcm);
    const durationSec = Math.round(pcm.length / (24_000 * 2));
    await col.updateOne(
      { _id: spice.id as never },
      {
        $set: {
          status: "ready",
          script,
          audio: new Binary(wav),
          mime: "audio/wav",
          durationSec,
          sizeBytes: wav.length,
          createdAt: new Date(),
        },
        $unset: { error: "" },
      },
      { upsert: true },
    );
    return { id: spice.id, status: "ready", durationSec, sizeBytes: wav.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await col.updateOne(
      { _id: spice.id as never },
      { $set: { status: "failed", error: msg } },
      { upsert: true },
    );
    return { id: spice.id, status: "failed", error: msg };
  }
}

/** Ready episodes: id → durationSec. Feeds the /food page's players. */
export async function listSpiceEpisodes(): Promise<Record<string, number>> {
  const db = await getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ status: "ready" }, { projection: { durationSec: 1 } })
    .toArray();
  return Object.fromEntries(docs.map((d) => [String(d._id), d.durationSec ?? 0]));
}

export async function getSpiceAudio(id: string): Promise<Buffer | null> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTION)
    .findOne({ _id: id as never, status: "ready" }, { projection: { audio: 1 } });
  const bin = doc?.audio as Binary | undefined;
  return bin ? Buffer.from(bin.buffer) : null;
}
