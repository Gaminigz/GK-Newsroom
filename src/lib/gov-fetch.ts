/**
 * GK SMART Accounting — Cambodian government feed.
 *
 * For each source in gov-sources.ts:
 *   1. Fetch its official news page (HTML).
 *   2. Hand the readable text + links to Gemini, which extracts the recent
 *      posts AND translates Khmer → English in the same pass (same trick
 *      as the Chinese Ai-news sources).
 *   3. Upsert into Mongo `gov_feed_items` keyed by post URL — re-runs
 *      never duplicate.
 *
 * Failures are isolated per source: one changed ministry website never
 * blanks the channel. Cost: one small Gemini call per source per run
 * (~$0.01/day for all seven).
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getDb } from "./mongo";
import { GOV_SOURCES, type GovSource } from "../data/gov-sources";

const MODEL = "gemini-2.5-flash";
const PAGE_CHAR_CAP = 28_000;
const POSTS_PER_SOURCE = 8;
const FETCH_TIMEOUT_MS = 20_000;

export type GovPost = {
  agency: string;
  url: string;
  titleKm: string;
  title: string;
  summary: string;
  kind: "Training" | "Event" | "Prakas" | "Announcement" | "News";
  postedAt: number | null;
};

/** Fetch a page and reduce it to readable text with visible [text](url) links. */
async function fetchReadable(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GKNewsroomBot/1.0; +https://github.com/Gaminigz/GK-Newsroom)",
        Accept: "text/html,*/*",
        "Accept-Language": "km,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let html = (await res.text()).slice(0, 400_000);
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    // Keep anchors as markdown so Gemini can return absolute URLs.
    const base = new URL(url);
    html = html.replace(
      /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href, text) => {
        const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (!t) return " ";
        let abs = href;
        try { abs = new URL(href, base).href; } catch {}
        return ` [${t}](${abs}) `;
      },
    );
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PAGE_CHAR_CAP);
  } finally {
    clearTimeout(timer);
  }
}

async function extractPosts(src: GovSource, pageText: string): Promise<GovPost[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are reading the official news page of ${src.name} (${src.nameKm}), Cambodia.
The page text below is mostly Khmer, with links preserved as [text](url).

Extract the ${POSTS_PER_SOURCE} most recent distinct news/announcement posts. For each:
- titleKm: the original Khmer title (verbatim; if the original is English keep it).
- title: faithful ENGLISH translation of the title, <= 100 chars. Never invent facts.
- summary: 1-2 sentence English summary from the visible text (<= 220 chars). If only a title is visible, expand it into a plain sentence without adding facts.
- url: the post's absolute link from the page. Must start with http. If a post has no link, skip it.
- kind: one of Training, Event, Prakas, Announcement, News. (Prakas = ministerial regulation/directive; use it when the post is about a Prakas, circular, or regulation.)
- dateIso: the post's date as YYYY-MM-DD if visible near it, else empty string. Khmer months: មករា=01 កុម្ភៈ=02 មីនា=03 មេសា=04 ឧសភា=05 មិថុនា=06 កក្កដា=07 សីហា=08 កញ្ញា=09 តុលា=10 វិច្ឆិកា=11 ធ្នូ=12.
Skip navigation, menus, categories, and anything that is not a dated post. Return ONLY the JSON array.

PAGE TEXT:
${pageText}`;

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      // Same 2.5-Flash gotcha as the podcast: without this, thinking
      // tokens eat the output budget and the JSON comes back truncated.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            titleKm: { type: Type.STRING },
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            url: { type: Type.STRING },
            kind: { type: Type.STRING },
            dateIso: { type: Type.STRING },
          },
          required: ["titleKm", "title", "summary", "url", "kind", "dateIso"],
        },
      },
    },
  });

  const text = res.text?.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as Array<Record<string, string>>;
  if (!Array.isArray(parsed)) return [];

  const KINDS = new Set(["Training", "Event", "Prakas", "Announcement", "News"]);
  return parsed
    .filter((p) => p.url?.startsWith("http") && p.title?.trim())
    .slice(0, POSTS_PER_SOURCE)
    .map((p) => ({
      agency: src.abbrev,
      url: p.url,
      titleKm: p.titleKm?.trim() || p.title.trim(),
      title: p.title.trim(),
      summary: p.summary?.trim() || "",
      kind: (KINDS.has(p.kind) ? p.kind : "News") as GovPost["kind"],
      postedAt: /^\d{4}-\d{2}-\d{2}$/.test(p.dateIso) ? Date.parse(p.dateIso) : null,
    }));
}

/**
 * Fetch every source, translate, and archive. Returns per-source counts
 * plus isolated errors — mirrors fetchAiFeed()'s contract.
 */
export async function fetchGovFeed(): Promise<{
  counts: Record<string, number>;
  errors: string[];
}> {
  const db = await getDb();
  const col = db.collection("gov_feed_items");
  const counts: Record<string, number> = {};
  const errors: string[] = [];

  const settled = await Promise.allSettled(
    GOV_SOURCES.map(async (src) => {
      const text = await fetchReadable(src.newsUrl);
      const posts = await extractPosts(src, text);
      if (posts.length === 0) throw new Error("no posts extracted");
      await col.bulkWrite(
        posts.map((p) => ({
          updateOne: {
            filter: { url: p.url },
            update: {
              $set: { ...p, updatedAt: new Date() },
              $setOnInsert: { fetchedAt: new Date() },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      return { abbrev: src.abbrev, n: posts.length };
    }),
  );

  settled.forEach((res, i) => {
    if (res.status === "fulfilled") counts[res.value.abbrev] = res.value.n;
    else errors.push(`${GOV_SOURCES[i].abbrev}: ${res.reason?.message || res.reason}`);
  });

  return { counts, errors };
}
