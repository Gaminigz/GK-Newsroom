/**
 * "The GK SMART Brief" — daily 2-minute Dara & Maly episode summarizing
 * the latest Cambodian government announcements (gov_feed_items) for
 * business owners and accountants. One doc per day in Mongo
 * (`gov_podcast`, _id = "YYYY-MM-DD", audio as BSON Binary WAV).
 *
 * Idempotent per day. Wired into `npm run daily` after the gov fetch.
 * Cost ≈ $0.40/day (shorter than the Ai brief).
 */

import { GoogleGenAI } from "@google/genai";
import { Binary } from "mongodb";
import { getDb } from "./mongo";
import { todayKey } from "./podcast";

const SCRIPT_MODEL = "gemini-2.5-flash";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const COLLECTION = "gov_podcast";

export type GovEpisodeMeta = {
  date: string;
  status: "ready" | "failed";
  durationSec?: number;
  stories?: string[];
  error?: string;
};

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

const SCRIPT_PROMPT = `You write "The GK SMART Brief" — a short daily podcast where the
two Yai newsroom hosts in Phnom Penh cover Cambodian government announcements for an
audience of business owners, accountants and tax practitioners.

Hosts:
- Dara — curious, asks what it means for a business.
- Maly — the explainer, precise about deadlines, Prakas numbers and obligations.

Write a dialogue covering the announcements below. Rules:
- Total 250–330 words (about 2 minutes spoken).
- Open with Dara: it's the GK SMART Brief and today's date.
- Cover the 3–5 most business-relevant items; group minor ones in one exchange.
- Never invent facts, numbers, dates or Prakas numbers beyond the input.
- Where an item creates an obligation or deadline, Maly states it plainly.
- Close with Maly signing off, one sentence.
- Output: plain text, one line per turn, exactly like:
Dara: ...
Maly: ...
No stage directions, no markdown.`;

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

export async function ensureGovEpisode(dateKey = todayKey(), force = false): Promise<GovEpisodeMeta> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const existing = await col.findOne(
    { _id: dateKey as never },
    { projection: { audio: 0, script: 0 } },
  );
  if (existing?.status === "ready" && !force) {
    return { date: dateKey, status: "ready", durationSec: existing.durationSec, stories: existing.stories };
  }

  const posts = await db
    .collection("gov_feed_items")
    .find({}, { projection: { agency: 1, title: 1, summary: 1, kind: 1, postedAt: 1 } })
    .sort({ postedAt: -1, updatedAt: -1 })
    .limit(10)
    .toArray();
  if (posts.length === 0) {
    return { date: dateKey, status: "failed", error: "no gov posts in Mongo yet (run npm run gov first)" };
  }

  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  try {
    const input = posts
      .map((p, i) => `${i + 1}. [${p.agency} · ${p.kind}] ${p.title}\n   ${p.summary}`)
      .join("\n");
    const scriptRes = await ai.models.generateContent({
      model: SCRIPT_MODEL,
      contents: [
        { role: "user", parts: [{ text: `${SCRIPT_PROMPT}\n\nToday's date: ${dateKey}\n\nAnnouncements:\n${input}` }] },
      ],
      config: {
        temperature: 0.6,
        maxOutputTokens: 4096,
        // 2.5-Flash: thinking tokens eat the output budget.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const script = scriptRes.text?.trim();
    if (!script || !script.includes("Dara:") || !script.includes("Maly:")) {
      throw new Error("unusable script");
    }

    const ttsRes = await ai.models.generateContent({
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
    const part = ttsRes.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error("TTS returned no audio data");
    const pcm = Buffer.from(b64, "base64");
    const wav = pcmToWav(pcm);
    const durationSec = Math.round(pcm.length / (24_000 * 2));
    const stories = posts.slice(0, 6).map((p) => `[${p.agency}] ${p.title}`);

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
          stories,
          createdAt: new Date(),
        },
        $unset: { error: "" },
      },
      { upsert: true },
    );
    return { date: dateKey, status: "ready", durationSec, stories };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await col.updateOne(
      { _id: dateKey as never },
      { $set: { status: "failed", error: msg } },
      { upsert: true },
    );
    return { date: dateKey, status: "failed", error: msg };
  }
}

/** Recent ready episodes, newest first — feeds the /accounting streamer. */
export async function listGovEpisodes(limit = 60): Promise<
  Array<{ date: string; durationSec?: number; stories?: string[] }>
> {
  const db = await getDb();
  const docs = await db
    .collection(COLLECTION)
    .find({ status: "ready" }, { projection: { audio: 0, script: 0 } })
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({ date: String(d._id), durationSec: d.durationSec, stories: d.stories }));
}

export async function getGovAudio(dateKey: string): Promise<Buffer | null> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTION)
    .findOne({ _id: dateKey as never, status: "ready" }, { projection: { audio: 1 } });
  const bin = doc?.audio as Binary | undefined;
  return bin ? Buffer.from(bin.buffer) : null;
}
