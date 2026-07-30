/**
 * Garment trade-press "news push" — pulls each outlet's own recent
 * headlines via Google News' site-restricted RSS search (same keyless
 * trick as ai-country-fetch.ts). Deliberately has NO Gemini dependency —
 * this is pure RSS, so it keeps working even during a Gemini
 * quota/credit outage (unlike the translated feeds).
 */

import Parser from "rss-parser";
import { GARMENT_OUTLETS } from "../data/garment-press";

const parser = new Parser({ timeout: 15000 });
const PER_OUTLET = 6;
const YEAR_MS = 365 * 24 * 3600 * 1000;

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

async function fetchOutletNews(domain: string): Promise<
  { url: string; title: string; source: string; summary: string; publishedAt: number }[]
> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const q = `site:${host}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const feed = await parser.parseURL(url);
  const cutoff = Date.now() - YEAR_MS;
  const out: { url: string; title: string; source: string; summary: string; publishedAt: number }[] = [];
  for (const it of feed.items.slice(0, PER_OUTLET)) {
    if (!it.link) continue;
    const publishedAt = it.isoDate ? Date.parse(it.isoDate) : it.pubDate ? Date.parse(it.pubDate) : Date.now();
    if (Number.isFinite(publishedAt) && publishedAt < cutoff) continue;
    const { title, source } = splitTitleSource(it.title || "");
    if (!title) continue;
    out.push({
      url: it.link,
      title,
      source: (it as { source?: string }).source || source || host,
      summary: stripHtml(it.contentSnippet || it.content || "").slice(0, 240),
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
    });
  }
  return out;
}

export async function fetchGarmentPress(): Promise<{ outlets: number; fetched: number; upserted: number; errors: string[] }> {
  const errors: string[] = [];
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const outletCol = db.collection("garment_outlets");
  const itemCol = db.collection("garment_press_items");
  await itemCol.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await itemCol.createIndex({ slug: 1, publishedAt: -1 }).catch(() => {});

  // Seed/refresh the static outlet directory (idempotent — keeps any status/notes already set).
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
  await mapLimit(GARMENT_OUTLETS, 5, async (o) => {
    try {
      const items = await fetchOutletNews(o.url);
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
