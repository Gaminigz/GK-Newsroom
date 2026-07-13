/**
 * Country-by-country AI activity feed.
 *
 * We don't scrape Facebook or Google directly (both block it). Instead we ask
 * **Google News RSS search** the same thing a person would type — e.g.
 * "Singapore AI funding government programme" — and take whatever Google
 * surfaces: a gov page, a news article, or a public Facebook post. Google is
 * the net; the source underneath can be anything.
 *
 * Per country we run two queries:
 *   - funding    → "<country> AI startup funding investment"
 *   - government → "<country> government AI programme funding"
 *
 * Results are upserted into `ai_country_items` keyed by URL (re-running never
 * duplicates). The web view groups them by country, auto-growing: a country
 * only appears once it has results.
 */

import Parser from "rss-parser";
import { GoogleGenAI, Type } from "@google/genai";

/** Countries we ask Google about. Display auto-grows from whatever returns. */
export const COUNTRIES: { name: string; iso: string }[] = [
  { name: "United States", iso: "US" }, { name: "China", iso: "CN" },
  { name: "United Kingdom", iso: "GB" }, { name: "Canada", iso: "CA" },
  { name: "Germany", iso: "DE" }, { name: "France", iso: "FR" },
  { name: "India", iso: "IN" }, { name: "Japan", iso: "JP" },
  { name: "South Korea", iso: "KR" }, { name: "Singapore", iso: "SG" },
  { name: "Australia", iso: "AU" }, { name: "Israel", iso: "IL" },
  { name: "United Arab Emirates", iso: "AE" }, { name: "Saudi Arabia", iso: "SA" },
  { name: "Netherlands", iso: "NL" }, { name: "Sweden", iso: "SE" },
  { name: "Switzerland", iso: "CH" }, { name: "Finland", iso: "FI" },
  { name: "Ireland", iso: "IE" }, { name: "Spain", iso: "ES" },
  { name: "Italy", iso: "IT" }, { name: "Brazil", iso: "BR" },
  { name: "Mexico", iso: "MX" }, { name: "Indonesia", iso: "ID" },
  { name: "Malaysia", iso: "MY" }, { name: "Thailand", iso: "TH" },
  { name: "Vietnam", iso: "VN" }, { name: "Philippines", iso: "PH" },
  { name: "Sri Lanka", iso: "LK" }, { name: "Bangladesh", iso: "BD" },
  { name: "Pakistan", iso: "PK" }, { name: "Nigeria", iso: "NG" },
  { name: "Kenya", iso: "KE" }, { name: "South Africa", iso: "ZA" },
  { name: "Egypt", iso: "EG" }, { name: "Turkey", iso: "TR" },
  { name: "Poland", iso: "PL" }, { name: "Estonia", iso: "EE" },
  { name: "Norway", iso: "NO" }, { name: "Denmark", iso: "DK" },
  { name: "New Zealand", iso: "NZ" }, { name: "Taiwan", iso: "TW" },
  { name: "Qatar", iso: "QA" }, { name: "Rwanda", iso: "RW" },
  { name: "Argentina", iso: "AR" }, { name: "Portugal", iso: "PT" },
  { name: "Austria", iso: "AT" }, { name: "Belgium", iso: "BE" },
];

export type Topic = "funding" | "government";

const QUERIES: { topic: Topic; q: (c: string) => string }[] = [
  { topic: "funding", q: (c) => `${c} AI startup funding investment` },
  { topic: "government", q: (c) => `${c} government AI programme funding` },
];

export type CountryItem = {
  url: string;
  title: string;
  source: string;
  summary: string;
  country: string;
  iso: string;
  topic: Topic;
  publishedAt: number;
};

/** ISO-3166 alpha-2 → flag emoji (regional indicator letters). */
export function isoToFlag(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  return String.fromCodePoint(
    ...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

const parser = new Parser({ timeout: 15000 });

/* ---------------- Gemini relevance judge ----------------
 * Keyword search bleeds: a global roundup or an other-country story can match
 * "<country> AI funding". Each stored item carries `relevant: boolean`; the
 * web view hides `relevant: false`. Only items not yet judged cost a Gemini
 * call — re-runs are free. No key / a failed call defaults to relevant (never
 * blank the feed on an outage). */

const JUDGE_MODEL = "gemini-2.5-flash";
const JUDGE_BATCH = 40; // items per Gemini call
const JUDGE_MAX_PER_RUN = 400; // backlog cap so one run can't burn the quota

type Judgeable = { country: string; topic: Topic; title: string; summary: string };

/** One batched call: true/false per item, in order. Throws on API failure. */
async function judgeBatch(ai: GoogleGenAI, items: Judgeable[]): Promise<boolean[]> {
  const list = items
    .map((it, i) => `#${i} [${it.country} / ${it.topic}] ${it.title} — ${it.summary || "(no summary)"}`)
    .join("\n");
  const prompt = `You curate a per-country AI-industry news feed. Each story below was found by keyword search for the country and topic shown in [brackets]. Decide for EACH story whether it truly belongs there.

relevant=true only if the story is specifically about AI in THAT country — its startups, companies, investors, or its government's AI programmes/policy/funding.
relevant=false if the story is mainly about a different country, a global/multi-country roundup where the named country is incidental, or not about AI at all.

Return exactly ${items.length} verdicts in order.

STORIES:
${list}`;

  const resp = await ai.models.generateContent({
    model: JUDGE_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: { relevant: { type: Type.BOOLEAN } },
          required: ["relevant"],
        },
      },
    },
  });
  const arr = JSON.parse(resp.text ?? "[]") as { relevant?: boolean }[];
  if (!Array.isArray(arr) || arr.length !== items.length) throw new Error("judge: bad response shape");
  return arr.map((v) => v.relevant !== false);
}

/** Judge up to `cap` items in batches; unjudged/failed batches default to relevant. */
async function judgeAll(items: Judgeable[], cap: number, errors: string[]): Promise<boolean[]> {
  const verdicts = items.map(() => true);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || items.length === 0) return verdicts;
  const ai = new GoogleGenAI({ apiKey });
  const n = Math.min(items.length, cap);
  for (let start = 0; start < n; start += JUDGE_BATCH) {
    const batch = items.slice(start, Math.min(start + JUDGE_BATCH, n));
    try {
      const res = await judgeBatch(ai, batch);
      for (let i = 0; i < batch.length; i++) verdicts[start + i] = res[i];
    } catch (e) {
      errors.push(`judge @${start}: ${(e as Error).message}`);
    }
  }
  return verdicts;
}

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Google News RSS puts "Headline - Source" in the title; split the source off. */
function splitTitleSource(raw: string): { title: string; source: string } {
  const i = raw.lastIndexOf(" - ");
  if (i > 20) return { title: raw.slice(0, i).trim(), source: raw.slice(i + 3).trim() };
  return { title: raw.trim(), source: "" };
}

async function runQuery(country: string, iso: string, topic: Topic, q: string): Promise<CountryItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - 365 * 24 * 3600 * 1000; // drop anything over a year old
  const out: CountryItem[] = [];
  for (const it of feed.items.slice(0, 8)) {
    if (!it.link) continue;
    const publishedAt = it.isoDate ? Date.parse(it.isoDate) : (it.pubDate ? Date.parse(it.pubDate) : Date.now());
    if (Number.isFinite(publishedAt) && publishedAt < cutoff) continue;
    const { title, source } = splitTitleSource(it.title || "");
    if (!title) continue;
    out.push({
      url: it.link,
      title,
      source: (it as { source?: string }).source || source || "Google News",
      summary: stripHtml(it.contentSnippet || it.content || "").slice(0, 240),
      country,
      iso,
      topic,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    });
  }
  return out;
}

/** Simple concurrency limiter — keeps us gentle on Google News. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetch every country×topic query, dedupe by URL, upsert into
 * `ai_country_items`. Returns a summary count. Failures are isolated per
 * query so one bad response never blanks the run.
 */
export async function fetchCountryAi(): Promise<{
  fetched: number;
  upserted: number;
  judged: number;
  dropped: number;
  errors: string[];
}> {
  const jobs: { country: string; iso: string; topic: Topic; q: string }[] = [];
  for (const c of COUNTRIES) {
    for (const { topic, q } of QUERIES) jobs.push({ country: c.name, iso: c.iso, topic, q: q(c.name) });
  }

  const errors: string[] = [];
  const perJob = await mapLimit(jobs, 4, async (j) => {
    try {
      return await runQuery(j.country, j.iso, j.topic, j.q);
    } catch (e) {
      errors.push(`${j.country}/${j.topic}: ${(e as Error).message}`);
      return [] as CountryItem[];
    }
  });

  // Dedupe by URL (a story can match several queries; first wins).
  const byUrl = new Map<string, CountryItem>();
  for (const list of perJob) for (const it of list) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
  const items = [...byUrl.values()];

  const { getDb } = await import("./mongo");
  const db = await getDb();
  const col = db.collection("ai_country_items");
  await col.createIndex({ iso: 1, topic: 1, publishedAt: -1 }).catch(() => {});

  // Judge only URLs we haven't stored yet — stored items keep their verdict.
  const known = new Set(
    (await col.find({ url: { $in: items.map((i) => i.url) } }, { projection: { url: 1 } }).toArray()).map(
      (d) => d.url as string,
    ),
  );
  const fresh = items.filter((it) => !known.has(it.url));
  const freshVerdicts = await judgeAll(fresh, JUDGE_MAX_PER_RUN, errors);
  const verdictByUrl = new Map(fresh.map((it, i) => [it.url, freshVerdicts[i]]));
  let judged = fresh.length;
  let dropped = freshVerdicts.filter((v) => !v).length;

  let upserted = 0;
  const now = Date.now();
  for (const it of items) {
    const r = await col.updateOne(
      { url: it.url },
      {
        $set: { title: it.title, source: it.source, summary: it.summary, publishedAt: it.publishedAt, seenAt: now },
        $setOnInsert: {
          url: it.url,
          country: it.country,
          iso: it.iso,
          topic: it.topic,
          createdAt: now,
          relevant: verdictByUrl.get(it.url) ?? true,
        },
      },
      { upsert: true },
    );
    if (r.upsertedCount) upserted++;
  }

  // Backlog sweep: items stored before the judge existed have no `relevant`.
  const budget = JUDGE_MAX_PER_RUN - Math.min(judged, JUDGE_MAX_PER_RUN);
  if (budget > 0) {
    const backlog = await col
      .find(
        { relevant: { $exists: false } },
        { projection: { url: 1, country: 1, topic: 1, title: 1, summary: 1 } },
      )
      .limit(budget)
      .toArray();
    if (backlog.length) {
      const verdicts = await judgeAll(
        backlog.map((d) => ({ country: d.country, topic: d.topic, title: d.title, summary: d.summary ?? "" })),
        budget,
        errors,
      );
      const ops = backlog.map((d, i) => ({
        updateOne: { filter: { _id: d._id }, update: { $set: { relevant: verdicts[i] } } },
      }));
      await col.bulkWrite(ops);
      judged += backlog.length;
      dropped += verdicts.filter((v) => !v).length;
    }
  }

  return { fetched: items.length, upserted, judged, dropped, errors };
}
