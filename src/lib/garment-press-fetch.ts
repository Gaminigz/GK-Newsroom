/**
 * Garment trade-press + association "news push" — pulls real industry news
 * via Google News' keyless RSS search (same trick as ai-country-fetch.ts).
 * Deliberately has NO Gemini dependency — pure RSS, so it keeps working
 * even during a Gemini quota/credit outage.
 *
 * Two query modes per entity:
 *   - site: <domain>   the outlet's own indexed pages (thin for small
 *                       trade sites — often just back-issue archive pages)
 *   - topic query       a keyword phrase for what the entity actually
 *                       covers (e.g. "Bangladesh RMG garment factory") —
 *                       surfaces real industry news, not just self-links.
 * Results from both are merged and deduped, so the feed reads like actual
 * news instead of a magazine's own issue-announcement list.
 */

import Parser from "rss-parser";
import { GARMENT_OUTLETS } from "../data/garment-press";
import { ASSOCIATIONS } from "../data/garment-associations";

const parser = new Parser({ timeout: 15000 });
const PER_QUERY = 6;
const YEAR_MS = 365 * 24 * 3600 * 1000;

type NewsItem = { url: string; title: string; source: string; summary: string; publishedAt: number };

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function splitTitleSource(raw: string): { title: string; source: string } {
  const i = raw.lastIndexOf(" - ");
  if (i > 20) return { title: raw.slice(0, i).trim(), source: raw.slice(i + 3).trim() };
  return { title: raw.trim(), source: "" };
}

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

async function runQuery(q: string, fallbackSource: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - YEAR_MS;
  const out: NewsItem[] = [];
  for (const it of feed.items.slice(0, PER_QUERY)) {
    if (!it.link) continue;
    const publishedAt = it.isoDate ? Date.parse(it.isoDate) : it.pubDate ? Date.parse(it.pubDate) : Date.now();
    if (Number.isFinite(publishedAt) && publishedAt < cutoff) continue;
    const { title, source } = splitTitleSource(it.title || "");
    if (!title) continue;
    out.push({
      url: it.link,
      title,
      source: (it as { source?: string }).source || source || fallbackSource,
      summary: stripHtml(it.contentSnippet || it.content || "").slice(0, 240),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    });
  }
  return out;
}

/** Site-restricted query (the entity's own indexed pages) + a topical query
 * (real industry news about what it covers), merged and deduped by URL. */
async function fetchEntityNews(url: string, topic: string): Promise<NewsItem[]> {
  const host = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  const queries: Promise<NewsItem[]>[] = [];
  if (host) queries.push(runQuery(`site:${host}`, host).catch(() => []));
  if (topic) queries.push(runQuery(topic, host || topic).catch(() => []));
  if (!queries.length) return [];
  const results = await Promise.all(queries);
  const byUrl = new Map<string, NewsItem>();
  for (const list of results) for (const it of list) if (!byUrl.has(it.url)) byUrl.set(it.url, it);
  return [...byUrl.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 8);
}

/* ------------------------------------------------------- media outlets */

export async function fetchGarmentPress(): Promise<{ outlets: number; fetched: number; upserted: number; errors: string[] }> {
  const errors: string[] = [];
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const outletCol = db.collection("garment_outlets");
  const itemCol = db.collection("garment_press_items");
  await itemCol.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await itemCol.createIndex({ slug: 1, publishedAt: -1 }).catch(() => {});

  const now = Date.now();
  for (const o of GARMENT_OUTLETS) {
    await outletCol.updateOne(
      { _id: o.slug } as never,
      {
        $setOnInsert: { status: "new", notes: "", createdAt: now },
        $set: { name: o.name, iso: o.iso, url: o.url, tier: o.tier, what: o.what, audience: o.audience, outreach: o.outreach, verdict: o.verdict },
      },
      { upsert: true },
    );
  }

  let fetched = 0;
  let upserted = 0;
  // Tier 3 = skip list — don't bother pulling news for outlets we've already ruled out.
  await mapLimit(GARMENT_OUTLETS.filter((o) => o.tier <= 2), 5, async (o) => {
    try {
      const items = await fetchEntityNews(o.url, o.topic);
      fetched += items.length;
      for (const it of items) {
        const r = await itemCol.updateOne(
          { url: it.url },
          {
            $set: { title: it.title, source: it.source, summary: it.summary, publishedAt: it.publishedAt, seenAt: now },
            $setOnInsert: { url: it.url, slug: o.slug, createdAt: now },
          },
          { upsert: true },
        );
        if (r.upsertedCount) upserted++;
      }
    } catch (e) {
      errors.push(`${o.slug}: ${(e as Error).message}`);
    }
  });

  return { outlets: GARMENT_OUTLETS.length, fetched, upserted, errors };
}

/* ---------------------------------------------------------- associations */

const SECTOR_PHRASE: Record<string, string> = {
  garment: "garment apparel manufacturing",
  footwear: "footwear shoe manufacturing",
  bags: "bag luggage leather goods manufacturing",
  softgoods: "toy home textile manufacturing",
};

function deriveTopic(iso: string, countryLabel: string | undefined, sectors: string[]): string {
  const place = countryLabel || iso;
  const phrase = sectors.map((s) => SECTOR_PHRASE[s] ?? s).join(" ");
  return `${place} ${phrase}`.trim();
}

export async function fetchGarmentAssociations(): Promise<{ orgs: number; fetched: number; upserted: number; errors: string[] }> {
  const errors: string[] = [];
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const orgCol = db.collection("garment_orgs");
  const itemCol = db.collection("garment_org_items");
  await itemCol.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await itemCol.createIndex({ slug: 1, publishedAt: -1 }).catch(() => {});

  const now = Date.now();
  for (const a of ASSOCIATIONS) {
    await orgCol.updateOne(
      { _id: a.slug } as never,
      {
        $setOnInsert: { status: "new", notes: "", createdAt: now },
        $set: { name: a.name, iso: a.iso, countryLabel: a.countryLabel ?? "", url: a.url, sectors: a.sectors, what: a.what },
      },
      { upsert: true },
    );
  }

  let fetched = 0;
  let upserted = 0;
  await mapLimit(ASSOCIATIONS, 6, async (a) => {
    try {
      const topic = a.topic || deriveTopic(a.iso, a.countryLabel, a.sectors);
      const items = await fetchEntityNews(a.url, topic);
      fetched += items.length;
      for (const it of items) {
        const r = await itemCol.updateOne(
          { url: it.url },
          {
            $set: { title: it.title, source: it.source, summary: it.summary, publishedAt: it.publishedAt, seenAt: now },
            $setOnInsert: { url: it.url, slug: a.slug, createdAt: now },
          },
          { upsert: true },
        );
        if (r.upsertedCount) upserted++;
      }
    } catch (e) {
      errors.push(`${a.slug}: ${(e as Error).message}`);
    }
  });

  return { orgs: ASSOCIATIONS.length, fetched, upserted, errors };
}
