/**
 * "The Yai Ai Brief" — auto-generated daily podcast from the Ai feed.
 *
 * Pipeline (all Gemini, bills the GCP Free Trial credit):
 *   1. Take today's top feed items (already fetched/rewritten upstream).
 *   2. gemini-2.5-flash writes a ~3-minute two-host dialogue script.
 *   3. gemini-2.5-flash-preview-tts renders it as ONE multi-speaker audio
 *      generation (two distinct voices, real conversational pacing).
 *   4. Raw PCM is wrapped in a WAV header and stored in Mongo
 *      (`ai_feed_podcast`, one doc per day, ~9 MB < 16 MB BSON cap).
 *
 * Hosts: Dara (voice "Puck") and Maly (voice "Kore") — the Yai newsroom.
 *
 * Concurrency: the generate path claims the day's doc with a
 * status:"generating" insert first; a second caller sees the claim and
 * polls instead of double-paying for TTS.
 */

import { GoogleGenAI } from "@google/genai";
import { Binary } from "mongodb";
import { getDb } from "./mongo";
import { fetchAiFeed } from "./feed-fetch";

const SCRIPT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const COLLECTION = "ai_feed_podcast";

// A claim older than this is considered dead (crashed mid-generation).
const STALE_CLAIM_MS = 5 * 60_000;

export type EpisodeMeta = {
  date: string;
  status: "ready" | "generating" | "failed";
  createdAt?: Date;
  durationSec?: number;
  sizeBytes?: number;
  stories?: string[];
  error?: string;
};

/** Phnom Penh calendar date — one episode per local day. */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Phnom_Penh" });
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

/* ---------------- script generation ---------------- */

const SCRIPT_PROMPT = `You write "The Yai Ai Brief" — a short daily podcast where two
hosts from the Yai newsroom in Phnom Penh discuss today's Ai news for an audience of
factory owners and operators (garment, footwear, bags, softgoods).

Hosts:
- Dara — curious, asks the sharp questions, occasionally wry.
- Maly — the explainer, grounded, connects stories to what a factory operator should care about.

Write a dialogue script covering the stories below. Rules:
- Total length 400–480 words (about 3 minutes spoken).
- Open with a one-line show intro by Dara (mention it's the Yai Ai Brief and today's date).
- Cover the 4–5 most interesting stories; it's fine to give minor ones a single exchange.
- Natural conversation: reactions, short follow-up questions, no lecture monologues.
- Never invent facts beyond the summaries given. No numbers that aren't in the input.
- Where a story plainly matters to manufacturers, let Maly land that point in one sentence.
- Close with Maly signing off, inviting listeners back tomorrow on yaikh.com/ai-feed.
- Output format: plain text, one line per turn, exactly like:
Dara: ...
Maly: ...
No stage directions, no markdown, no sound effects.`;

async function writeScript(
  ai: GoogleGenAI,
  stories: { source: string; title: string; summary: string }[],
  dateKey: string
): Promise<string> {
  const input = stories
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title}\n   ${s.summary}`)
    .join("\n");
  const res = await ai.models.generateContent({
    model: SCRIPT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `${SCRIPT_PROMPT}\n\nToday's date: ${dateKey}\n\nStories:\n${input}` }],
      },
    ],
    config: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      // Thinking tokens count against maxOutputTokens on 2.5 Flash and were
      // truncating the dialogue — a scripted format needs no deliberation.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = res.text?.trim();
  if (!text || !text.includes("Dara:") || !text.includes("Maly:")) {
    throw new Error("script generation returned an unusable script");
  }
  const words = text.split(/\s+/).length;
  if (words < 250) {
    throw new Error(`script too short (${words} words) — refusing to cut a stub episode`);
  }
  return text;
}

/* ---------------- TTS ---------------- */

async function synthesize(ai: GoogleGenAI, script: string): Promise<Buffer> {
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: `TTS the following conversation between Dara and Maly:\n\n${script}` }],
      },
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

/** Wrap raw 16-bit mono PCM (24 kHz, Gemini TTS output) in a WAV header. */
function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2; // mono, 16-bit
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/* ---------------- orchestration ---------------- */

export async function getEpisodeMeta(dateKey = todayKey()): Promise<EpisodeMeta | null> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTION)
    .findOne({ _id: dateKey as never }, { projection: { audio: 0, script: 0 } });
  if (!doc) return null;
  return {
    date: dateKey,
    status: doc.status,
    createdAt: doc.createdAt,
    durationSec: doc.durationSec,
    sizeBytes: doc.sizeBytes,
    stories: doc.stories,
    error: doc.error,
  };
}

/** Every date that has a ready episode, newest first — feeds the calendar picker. */
export async function listEpisodeDates(limit = 366): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ status: "ready" }, { projection: { _id: 1 } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => String(d._id));
}

/** Most recent ready episodes, newest first — for the player's picker. */
export async function listEpisodes(limit = 14): Promise<EpisodeMeta[]> {
  const db = await getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ status: "ready" }, { projection: { audio: 0, script: 0 } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => ({
    date: String(doc._id),
    status: doc.status,
    createdAt: doc.createdAt,
    durationSec: doc.durationSec,
    sizeBytes: doc.sizeBytes,
    stories: doc.stories,
  }));
}

export async function getEpisodeAudio(dateKey = todayKey()): Promise<Buffer | null> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTION)
    .findOne({ _id: dateKey as never, status: "ready" }, { projection: { audio: 1 } });
  const bin = doc?.audio as Binary | undefined;
  return bin ? Buffer.from(bin.buffer) : null;
}

/**
 * Generate today's episode if it doesn't exist. Returns current meta.
 * Safe to call repeatedly — subsequent callers get the in-flight claim.
 */
export async function ensureEpisode(dateKey = todayKey()): Promise<EpisodeMeta> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  // Reclaim stale/failed docs, then try to claim the day.
  const existing = await col.findOne({ _id: dateKey as never });
  if (existing) {
    const stale =
      existing.status === "generating" &&
      Date.now() - new Date(existing.claimedAt ?? 0).getTime() > STALE_CLAIM_MS;
    if (existing.status === "ready") return (await getEpisodeMeta(dateKey))!;
    if (existing.status === "generating" && !stale) return (await getEpisodeMeta(dateKey))!;
    // failed or stale → delete and retry below
    await col.deleteOne({ _id: dateKey as never, status: existing.status });
  }

  try {
    await col.insertOne({
      _id: dateKey as never,
      status: "generating",
      claimedAt: new Date(),
    });
  } catch {
    // Lost the race — someone else is generating.
    return (await getEpisodeMeta(dateKey))!;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const { items } = await fetchAiFeed({ perSourceLimit: 3, totalLimit: 8 });
    if (items.length === 0) throw new Error("no feed items available");

    const stories = items.slice(0, 6).map((it) => ({
      source: it.source,
      title: it.title,
      summary: it.summary,
    }));

    const script = await writeScript(ai, stories, dateKey);
    const pcm = await synthesize(ai, script);
    const wav = pcmToWav(pcm);
    const durationSec = Math.round(pcm.length / (24_000 * 2));

    await col.updateOne(
      { _id: dateKey as never },
      {
        $set: {
          status: "ready",
          script,
          audio: new Binary(wav),
          mime: "audio/wav",
          durationSec,
          sizeBytes: wav.length,
          stories: stories.map((s) => s.title),
          createdAt: new Date(),
        },
        $unset: { claimedAt: "" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-feed-podcast] generation failed:", msg);
    await col.updateOne(
      { _id: dateKey as never },
      { $set: { status: "failed", error: msg }, $unset: { claimedAt: "" } }
    );
  }

  return (await getEpisodeMeta(dateKey))!;
}
