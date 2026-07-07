/**
 * Aggregates the top Ai news feeds into a single normalized list.
 *
 * Sources are all public RSS/Atom endpoints. Failures are isolated per
 * source (one broken feed does not blank the page). Extracts the best
 * available image + a short lede from each item.
 */

import Parser from "rss-parser";
import { ensureImages } from "./feed-image";
import { rewriteBatch } from "./feed-rewrite";

export type FeedItem = {
  source: string;
  sourceTag: string;
  title: string;
  url: string;
  summary: string;
  image: string | null;
  publishedAt: number;
  rewritten?: boolean;
  originalTitle?: string;
  brands: string[];
  countries: string[];
  topics: string[];
  /** "history" for Yai Ai History episodes, "timeline" for model releases,
   *  undefined for live RSS-driven news. */
  series?: "history" | "timeline";
  seriesEpisode?: number;
  seriesBrand?: string;
  seriesVersion?: string;
};

type Source = { name: string; tag: string; url: string };

// Curated Ai sources — labs + Western news + China news.
export const SOURCES: Source[] = [
  { name: "OpenAI",          tag: "Lab",   url: "https://openai.com/blog/rss.xml" },
  { name: "Google DeepMind", tag: "Lab",   url: "https://deepmind.google/blog/rss.xml" },
  { name: "TechCrunch AI",   tag: "News",  url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "Ars Technica",    tag: "News",  url: "https://arstechnica.com/tag/artificial-intelligence/feed/" },
  { name: "Wired AI",        tag: "News",  url: "https://www.wired.com/feed/tag/ai/latest/rss" },
  // Chinese Ai coverage — headlines land in Chinese, translated + rewritten
  // to English in the Yai voice by the same Gemini rewrite pass.
  { name: "QbitAI (量子位)", tag: "China", url: "https://www.qbitai.com/feed" },
  { name: "36Kr",            tag: "China", url: "https://36kr.com/feed" },
];

// Parser typed with the custom fields we look for.
type Item = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  "content:encoded"?: string;
  enclosure?: { url?: string };
  "media:content"?: { $?: { url?: string } } | Array<{ $?: { url?: string } }>;
  "media:thumbnail"?: { $?: { url?: string } } | Array<{ $?: { url?: string } }>;
};

const parser: Parser<Record<string, unknown>, Item> = new Parser({
  headers: {
    // Some CDNs 403 the default node fetch UA; a browser-ish UA works.
    "User-Agent":
      "Mozilla/5.0 (compatible; YaikhAiFeedBot/1.0; +https://yaikh.com/ai-feed)",
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [
      ["media:content", "media:content"],
      ["media:thumbnail", "media:thumbnail"],
      ["content:encoded", "content:encoded"],
    ],
  },
});

function pickImage(item: Item): string | null {
  const mediaContent = item["media:content"];
  const mediaThumb = item["media:thumbnail"];
  const firstMedia = Array.isArray(mediaContent) ? mediaContent[0] : mediaContent;
  const firstThumb = Array.isArray(mediaThumb) ? mediaThumb[0] : mediaThumb;
  const fromMedia = firstMedia?.$?.url || firstThumb?.$?.url;
  if (fromMedia) return fromMedia;

  const fromEnclosure = item.enclosure?.url;
  if (fromEnclosure) return fromEnclosure;

  const html = item["content:encoded"] || item.content || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, n = 220): string {
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, "") + "…";
}

async function fetchOne(src: Source): Promise<FeedItem[]> {
  const feed = await parser.parseURL(src.url);
  const items = (feed.items || []) as Item[];

  return items
    .filter((it) => it.title && it.link)
    .map<FeedItem>((it) => {
      const raw = it.contentSnippet || it.content || it["content:encoded"] || "";
      const summary = truncate(stripHtml(raw));
      const iso = it.isoDate || it.pubDate;
      const publishedAt = iso ? new Date(iso).getTime() : 0;
      return {
        source: src.name,
        sourceTag: src.tag,
        title: it.title!.trim(),
        url: it.link!,
        summary,
        image: pickImage(it),
        publishedAt,
        brands: [],
        countries: [],
        topics: [],
      };
    });
}

/**
 * Fire-and-forget archive: upsert enriched items into `ai_feed_items` so
 * the lookup history (by brand / country / topic) deepens with every
 * refresh. Never blocks or fails the page render.
 */
async function archiveItems(items: FeedItem[]): Promise<void> {
  if (!process.env.MONGO_URL || items.length === 0) return;
  try {
    const { getDb } = await import("./mongo");
    const db = await getDb();
    const col = db.collection("ai_feed_items");
    await col.bulkWrite(
      items.map((it) => ({
        updateOne: {
          filter: { url: it.url },
          update: { $set: { ...it, archivedAt: new Date() } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (err) {
    console.error("[ai-feed] archive failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Fetches all sources in parallel and returns a merged, sorted list.
 * `perSourceLimit` prevents one busy feed from dominating.
 */
export async function fetchAiFeed(opts?: {
  perSourceLimit?: number;
  totalLimit?: number;
}): Promise<{ items: FeedItem[]; errors: string[] }> {
  const perSourceLimit = opts?.perSourceLimit ?? 5;
  const totalLimit = opts?.totalLimit ?? 20;

  const settled = await Promise.allSettled(SOURCES.map(fetchOne));
  const errors: string[] = [];
  const all: FeedItem[] = [];

  settled.forEach((res, i) => {
    if (res.status === "fulfilled") {
      all.push(...res.value.slice(0, perSourceLimit));
    } else {
      errors.push(`${SOURCES[i].name}: ${res.reason?.message || res.reason}`);
    }
  });

  all.sort((a, b) => b.publishedAt - a.publishedAt);
  const top = all.slice(0, totalLimit);

  // Fan out both enrichments in parallel — they don't depend on each other.
  const [withImages, rewrites] = await Promise.all([
    ensureImages(top),
    rewriteBatch(top.map((it) => ({ source: it.source, title: it.title, summary: it.summary }))),
  ]);

  const keyRewritten = process.env.GEMINI_API_KEY ? true : false;
  const enriched: FeedItem[] = withImages.map((it, i) => {
    const r = rewrites[i];
    return {
      ...it,
      originalTitle: it.title,
      title: r.title,
      summary: r.summary,
      rewritten: keyRewritten,
      brands: r.brands,
      countries: r.countries,
      topics: r.topics,
    };
  });

  await archiveItems(enriched);

  // Interleave curated series (History + Timeline) from Mongo so the feed
  // is never just today's news. We pick a small random slice each render
  // — same story doesn't dominate two visits in a row.
  // Pull ALL series items (12 history + 47 timeline = 59). Two rules:
  //   1. Only Timeline items get spotlighted at the top (rotated randomly
  //      each render for discovery).
  //   2. History is ALWAYS presented in EP1→EP12 order at the bottom so
  //      the History filter chip reveals a clean sequence.
  const allSeries = await fetchAllSeries();
  const timeline = allSeries.filter((s) => s.series === "timeline");
  const history  = allSeries.filter((s) => s.series === "history")
                    .sort((a, b) => (a.seriesEpisode ?? 0) - (b.seriesEpisode ?? 0));
  const spotlightIdx = new Set<number>();
  while (spotlightIdx.size < Math.min(8, timeline.length)) {
    spotlightIdx.add(Math.floor(Math.random() * timeline.length));
  }
  const spotlight = [...spotlightIdx].sort((a, b) => a - b).map((i) => timeline[i]);
  const restTimeline = timeline.filter((_, i) => !spotlightIdx.has(i));
  const mixed = interleave(enriched, spotlight).concat(restTimeline).concat(history);

  return { items: mixed, errors };
}

/**
 * Pulls every curated Yai series item (history + model timelines) from
 * Mongo — bounded 12 + 47 ≈ 59 documents, safe to load in full so the
 * History / Timeline / Models filter chips reflect the real archive size.
 * Returns [] on any failure — never blocks live news.
 */
async function fetchAllSeries(): Promise<FeedItem[]> {
  if (!process.env.MONGO_URL) return [];
  try {
    const { getDb } = await import("./mongo");
    const db = await getDb();
    const col = db.collection("ai_feed_items");
    const docs = await col
      .find({ series: { $in: ["history", "timeline"] } })
      // History by episode #, then timeline by version release date.
      .sort({ seriesEpisode: 1, seriesReleased: -1 })
      .toArray();
    return docs.map((d) => ({
      source: d.source,
      sourceTag: d.sourceTag,
      title: d.title,
      url: d.url,
      summary: d.summary,
      image: d.image,
      publishedAt: d.publishedAt,
      rewritten: d.rewritten,
      originalTitle: d.originalTitle,
      brands: d.brands ?? [],
      countries: d.countries ?? [],
      topics: d.topics ?? [],
      series: d.series,
      seriesEpisode: d.seriesEpisode,
      seriesBrand: d.seriesBrand,
      seriesVersion: d.seriesVersion,
    }));
  } catch (err) {
    console.error("[ai-feed] fetchAllSeries failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Insert `series` items into `news`: one right after the first live news
 * card so the series is visible without scrolling, then every 3rd slot.
 */
function interleave(news: FeedItem[], series: FeedItem[]): FeedItem[] {
  if (series.length === 0) return news;
  const out: FeedItem[] = [];
  let s = 0;
  for (let i = 0; i < news.length; i++) {
    out.push(news[i]);
    // Slot the first series card immediately after the first news card,
    // then keep dropping one every 3rd position.
    if ((i === 0 || (i > 0 && i % 3 === 2)) && s < series.length) {
      out.push(series[s++]);
    }
  }
  while (s < series.length) out.push(series[s++]);
  return out;
}
