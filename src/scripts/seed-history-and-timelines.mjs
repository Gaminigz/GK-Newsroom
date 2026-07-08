/**
 * Seeds two static series into the ai_feed_items collection so they
 * rotate alongside daily RSS news on /ai-feed and get picked up by the
 * daily podcast script.
 *
 *   1. Ai history — 12 curated episodes (data/ai-history-episodes.ts)
 *   2. Model timelines — one item per model release
 *      (data/ai-model-timelines.ts)
 *
 * Each seed is expanded into a full Yai-voice article by Gemini 2.5 Flash
 * (title + 2-sentence summary + image URL from Yai's static tiles).
 *
 * Idempotent: `_id` per item is deterministic (id or brand+version), so
 * re-running only rewrites the same rows.
 *
 * Usage (from yaikh-com/):
 *   node scripts/seed-history-and-timelines.mjs [--rewrite]
 * With --rewrite, the LLM regenerates existing rows; without it, existing
 * rows are skipped.
 */

import { MongoClient } from "mongodb";
import { GoogleGenAI, Type } from "@google/genai";
// Data files are TS — invoke this script with `tsx` (installed as devDep):
//   npx tsx scripts/seed-history-and-timelines.mjs
import { HISTORY_EPISODES } from "../data/history-episodes.ts";
import { MODEL_TIMELINES } from "../data/model-timelines.ts";
import { brandTile, historyTile } from "./lib-brand-tiles.mjs";

const MODEL = "gemini-2.5-flash";

const REWRITE_PROMPT_HISTORY = `You write "The Yai Ai History" — short editorial articles that help a
manufacturing-industry audience (garment/footwear/bags factories in Cambodia and Asia)
understand where Ai came from. For each episode below, produce:

- title: max 90 chars, engaging, no clickbait, no emoji.
- summary: 2 crisp sentences (<= 260 chars total) that give the historical moment
  AND why it still matters today for anyone deploying Ai.

Rules:
- Never invent facts, dates, or people beyond the input.
- Preserve proper nouns exactly (Turing, Dartmouth, McCarthy, Rosenblatt, etc.).
- Keep the "Ai" spelling (not "AI").
- Return JSON only, in the same order as input.`;

const REWRITE_PROMPT_TIMELINE = `You write "The Yai Model Timeline" — one-paragraph explainers for major Ai model
releases, aimed at people deciding which model to use.

For each release below, produce:
- title: "<brand> <version>: <one-line hook>" — max 95 chars.
- summary: 2 sentences (<= 260 chars). Sentence 1: what this release actually shipped
  (from the input headline). Sentence 2: what it's best used for (from the input bestFor).
  Concrete and factory-operator-friendly.

Rules:
- Never invent facts or dates.
- Keep model version names exact (GPT-4o, Claude Sonnet 4.5, Gemini 1.5 Flash, etc.).
- Keep the "Ai" spelling.
- Return JSON only, in the same order as input.`;

async function rewriteBatch(ai, systemPrompt, items) {
  if (items.length === 0) return [];
  const userJson = JSON.stringify(items, null, 2);
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\nInput:\n${userJson}` }] },
    ],
    config: {
      temperature: 0.5,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ["title", "summary"],
        },
      },
    },
  });
  const parsed = JSON.parse(res.text.trim());
  if (!Array.isArray(parsed) || parsed.length !== items.length) {
    throw new Error(`Rewrite returned ${parsed.length} items, expected ${items.length}`);
  }
  return parsed.map((p, i) => ({
    title: p.title?.trim() || items[i].title,
    summary: p.summary?.trim() || items[i].summary || "",
  }));
}

// Tile helpers live in scripts/lib-brand-tiles.mjs.

async function main() {
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL not set");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const rewrite = process.argv.includes("--rewrite");
  console.log("rewrite existing:", rewrite);

  const history = HISTORY_EPISODES;
  const timelines = MODEL_TIMELINES;
  console.log("loaded:", history.length, "history episodes,",
    timelines.reduce((a, t) => a + t.releases.length, 0), "timeline entries");

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const col = client.db(process.env.MONGO_DB || "yaikh").collection("ai_feed_items");

  // ---- History ----
  const existingHistoryIds = new Set(
    (await col.find({ series: "history" }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
  );
  const histToWrite = rewrite ? history : history.filter((h) => !existingHistoryIds.has(h.id));
  console.log(`history: writing ${histToWrite.length}/${history.length}`);
  if (histToWrite.length > 0) {
    const rewrites = await rewriteBatch(ai, REWRITE_PROMPT_HISTORY, histToWrite.map((h) => ({
      ep: h.ep, year: h.year, title: h.title, subtitle: h.subtitle,
      keyFigures: h.keyFigures, keyEvents: h.keyEvents, whyItMatters: h.whyItMatters,
    })));
    // Spread over the last 12 days so they interleave with fresh news.
    const now = Date.now();
    await col.bulkWrite(histToWrite.map((h, i) => {
      const r = rewrites[i];
      const publishedAt = now - (i + 1) * 24 * 3600 * 1000 - Math.floor(Math.random() * 8 * 3600 * 1000);
      return {
        updateOne: {
          filter: { _id: h.id },
          update: {
            $set: {
              _id: h.id,
              series: "history",
              seriesEpisode: h.ep,
              source: "Yai History",
              sourceTag: "Series",
              title: r.title,
              url: `https://yaikh.com/ai-feed#${h.id}`,
              summary: r.summary,
              image: historyTile(h.ep, h.year),
              publishedAt,
              rewritten: true,
              originalTitle: h.title,
              brands: [],
              countries: [],
              topics: ["History"],
              archivedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    }), { ordered: false });
  }

  // ---- Timelines ----
  const flatTimeline = [];
  for (const t of timelines) {
    for (const r of t.releases) {
      const id = `ai-timeline-${t.brand.toLowerCase()}-${r.version.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      flatTimeline.push({ id, brand: t.brand, displayName: t.displayName, origin: t.origin,
                          version: r.version, released: r.released, headline: r.headline, bestFor: r.bestFor });
    }
  }
  const existingTLIds = new Set(
    (await col.find({ series: "timeline" }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
  );
  const tlToWrite = rewrite ? flatTimeline : flatTimeline.filter((t) => !existingTLIds.has(t.id));
  console.log(`timeline: writing ${tlToWrite.length}/${flatTimeline.length}`);
  if (tlToWrite.length > 0) {
    // Batch of 40 to keep prompts small
    const chunks = [];
    for (let i = 0; i < tlToWrite.length; i += 40) chunks.push(tlToWrite.slice(i, i + 40));
    const rewrites = [];
    for (const chunk of chunks) {
      const r = await rewriteBatch(ai, REWRITE_PROMPT_TIMELINE, chunk.map((t) => ({
        brand: t.brand, version: t.version, released: t.released, headline: t.headline, bestFor: t.bestFor,
      })));
      rewrites.push(...r);
      process.stdout.write(".");
    }
    console.log();

    const now = Date.now();
    await col.bulkWrite(tlToWrite.map((t, i) => {
      const r = rewrites[i];
      // Spread across last 3-14 days
      const publishedAt = now - (3 + Math.floor(Math.random() * 12)) * 24 * 3600 * 1000
        - Math.floor(Math.random() * 12 * 3600 * 1000);
      const countryMap = { "USA": "USA", "USA / UK": "USA", "France": "France", "China": "China" };
      return {
        updateOne: {
          filter: { _id: t.id },
          update: {
            $set: {
              _id: t.id,
              series: "timeline",
              seriesBrand: t.brand,
              seriesVersion: t.version,
              seriesReleased: t.released,
              source: t.displayName,
              sourceTag: "Timeline",
              title: r.title,
              url: `https://yaikh.com/ai-feed#${t.id}`,
              summary: r.summary,
              image: brandTile(t.brand),
              publishedAt,
              rewritten: true,
              originalTitle: `${t.brand} ${t.version} — ${t.headline}`,
              brands: [t.brand],
              countries: [countryMap[t.origin] || t.origin],
              topics: ["Models"],
              archivedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    }), { ordered: false });
  }

  const total = await col.countDocuments();
  const hist = await col.countDocuments({ series: "history" });
  const tl = await col.countDocuments({ series: "timeline" });
  console.log(`done — ai_feed_items total: ${total} | history: ${hist} | timeline: ${tl}`);
  await client.close();
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
