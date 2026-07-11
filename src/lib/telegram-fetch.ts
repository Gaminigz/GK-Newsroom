/**
 * Telegram channel watcher for the GK SMART Accounting feed.
 *
 * NO Telegram app, account, bot, or API key. Every public channel exposes a
 * plain web page at https://t.me/s/<handle> — we fetch it like any website,
 * parse the posts, keep the accounting/tax/finance-relevant ones, translate
 * Khmer → English with Gemini (the same pass gov-fetch uses), and upsert into
 * `gov_feed_items` (marked via:"telegram") so they show at /accounting.
 *
 * Self-growing: the watch-list lives in Mongo `tg_channels`. Each run harvests
 * the t.me/<other> channels that watched channels forward/mention, probes
 * them, and keeps the on-topic public ones — so the list crawls toward ~50
 * without anyone hand-collecting handles.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getDb } from "./mongo";

const MODEL = "gemini-2.5-flash";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CHANNELS_PER_RUN = 60;   // cap active fetches
const MAX_NEW_CANDIDATES = 25;     // cap crawl probes per run
const POSTS_PER_CHANNEL = 5;       // keep the newest N relevant posts
const MAX_TRANSLATE = 100;         // bound Gemini cost per run
const CHANNEL_CAP = 60;            // total registry ceiling

/** Curated public Cambodian gov / finance / business channels (hand-picked).
 *  Seeds are trusted: ALL their recent posts are ingested (the keyword filter
 *  only applies to auto-discovered channels). */
const SEED_CHANNELS = [
  "acarcambodia", "mefcambodia", "mef_gdde", "kicpaacambodia",
  "gdtcambodianews", "mocnewsfeed", "online_business_registration",
  "godigital_cambodia", "indocham", "MFAICNews", "motgovkh",
  "eVATPublic", "AmChamCambodiaChannel", "eurochameventchannel",
  "BritChamCambodia", "singaporeclubcambodia", "b2basianews",
];
const SEED_SET = new Set(SEED_CHANNELS);

/** Short label per known handle; else derived from the channel title/handle. */
const KNOWN_LABEL: Record<string, string> = {
  acarcambodia: "ACAR",
  mefcambodia: "MEF",
  mef_gdde: "GDDE",
  kicpaacambodia: "KICPAA",
  gdtcambodianews: "GDT",
  mocnewsfeed: "MoC",
  online_business_registration: "OBR",
  godigital_cambodia: "GoDigital",
  indocham: "IndoCham",
  MFAICNews: "MFAIC",
  motgovkh: "MoT",
  eVATPublic: "eFiling",
  AmChamCambodiaChannel: "AmCham",
  eurochameventchannel: "EuroCham",
  BritChamCambodia: "BritCham",
  singaporeclubcambodia: "SCC",
  b2basianews: "B2B",
};

/** Accounting / tax / finance relevance — English + Khmer keywords. */
const TOPIC_TERMS = [
  "tax", "taxation", "vat", "accounting", "account", "audit", "auditor",
  "prakas", "finance", "financial", "fiscal", "revenue", "customs", "excise",
  "invoice", "e-invoice", "budget", "cpa", "bookkeep", "economy", "economic",
  "ministry of economy", "gdt", "acar", "mef", "gdce", "camdx",
  "ពន្ធ", "គណនេយ្យ", "សវនកម្ម", "ហិរញ្ញវត្ថុ", "ប្រកាស", "អាករ",
  "ពាណិជ្ជកម្ម", "សេដ្ឋកិច្ច", "ថវិកា", "គយ",
];

export type TgPost = {
  handle: string;
  url: string;
  text: string;      // original (usually Khmer)
  postedAt: number | null;
};

type Translated = { titleKm: string; title: string; summary: string; kind: string };

function decodeEntities(s: string): string {
  return String(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isRelevant(text: string): boolean {
  const t = text.toLowerCase();
  return TOPIC_TERMS.some((k) => t.includes(k));
}

/** Fetch a channel's public web view. Returns null if it has no public preview. */
async function fetchChannel(handle: string): Promise<
  { title: string; posts: TgPost[]; crossLinks: string[] } | null
> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://t.me/s/${handle}`, {
      signal: ctl.signal,
      redirect: "manual", // a 302 means "no public preview" — skip, don't follow to the login wall
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GKNewsroomBot/1.0; +https://github.com/Gaminigz/GK-Newsroom)",
        "Accept-Language": "km,en;q=0.8",
      },
    });
    if (res.status !== 200) return null;
    const html = await res.text();

    const titleM = html.match(/<meta property="og:title" content="([^"]*)"/);
    const title = titleM ? decodeEntities(titleM[1]) : handle;

    const posts: TgPost[] = [];
    // Each post is one .tgme_widget_message wrapper.
    const chunks = html.split(/<div class="tgme_widget_message[ "]/).slice(1);
    for (const chunk of chunks) {
      const linkM = chunk.match(/tgme_widget_message_date"\s+href="(https:\/\/t\.me\/[^"/]+\/\d+)"/);
      const dateM = chunk.match(/datetime="([^"]+)"/);
      const textM = chunk.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!linkM || !textM) continue;
      const text = decodeEntities(textM[1]);
      if (!text || text.length < 12) continue;
      const postedAt = dateM ? Date.parse(dateM[1]) : NaN;
      posts.push({ handle, url: linkM[1], text, postedAt: Number.isFinite(postedAt) ? postedAt : null });
    }

    // Harvest other channels this one forwards/mentions (for the crawl).
    const cross = new Set<string>();
    for (const m of html.matchAll(/https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?![A-Za-z0-9_/])/g)) {
      const h = m[1].toLowerCase();
      if (h !== handle.toLowerCase() && h !== "s" && h !== "share" && h !== "iv") cross.add(h);
    }

    return { title, posts, crossLinks: [...cross] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Translate a channel's Khmer posts → English title/summary in one Gemini call. */
async function translatePosts(label: string, posts: TgPost[]): Promise<Translated[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey });

  const list = posts.map((p, i) => `#${i}: ${p.text.slice(0, 500)}`).join("\n\n");
  const prompt = `These are ${posts.length} recent Telegram posts from "${label}", a Cambodian government / finance channel. Most are Khmer.
For EACH post (in the same order, index 0..${posts.length - 1}) return:
- titleKm: a short Khmer title/headline (verbatim from the post; <= 90 chars).
- title: faithful ENGLISH translation of that headline (<= 100 chars). Never invent facts.
- summary: 1-2 sentence English summary of the post (<= 220 chars). No invented facts.
- kind: one of Training, Event, Prakas, Announcement, News.
Return exactly ${posts.length} items in order.

POSTS:
${list}`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            titleKm: { type: Type.STRING },
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            kind: { type: Type.STRING },
          },
          required: ["titleKm", "title", "summary", "kind"],
        },
      },
    },
  });

  try {
    const arr = JSON.parse(resp.text ?? "[]") as Translated[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function labelFor(handle: string, title: string): string {
  if (KNOWN_LABEL[handle]) return KNOWN_LABEL[handle];
  const initials = title.replace(/[^A-Za-z ]/g, "").trim().split(/\s+/).map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 2 && initials.length <= 5) return initials;
  return handle.slice(0, 6).toUpperCase();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

/**
 * Run one watch pass: fetch active channels, ingest relevant posts, crawl for
 * new channels. Returns counts. Isolated per channel — one dead handle never
 * blanks the run.
 */
export async function fetchTelegram(): Promise<{
  channels: number; posts: number; carried: number; discovered: number; errors: string[];
}> {
  const db = await getDb();
  const reg = db.collection("tg_channels");
  const feed = db.collection("gov_feed_items");
  await reg.createIndex({ status: 1 }).catch(() => {});

  // Ensure every seed channel is in the registry (idempotent — new seeds get
  // picked up on later runs, and a seed is never left out just because the
  // collection already exists).
  {
    const now = Date.now();
    for (const h of SEED_CHANNELS) {
      await reg.updateOne(
        { _id: h } as never,
        { $setOnInsert: { addedVia: "seed", firstSeen: now, postCount: 0 }, $set: { status: "active" } },
        { upsert: true },
      );
    }
  }

  const errors: string[] = [];
  const active = await reg.find({ status: { $in: ["active", "seed", "candidate"] } })
    .limit(MAX_CHANNELS_PER_RUN).toArray();

  const seen = new Set(active.map((c) => String(c._id)));
  const crossAll = new Set<string>();
  const kept: { handle: string; label: string; posts: TgPost[] }[] = [];

  await mapLimit(active, 5, async (c) => {
    const handle = String(c._id);
    const r = await fetchChannel(handle);
    const now = Date.now();
    if (!r) {
      await reg.updateOne({ _id: handle } as never, { $set: { status: "dead", lastFetched: now } });
      return;
    }
    r.crossLinks.forEach((h) => crossAll.add(h));
    // Trusted seeds: take all recent posts. Others: keyword-filter.
    const isSeed = SEED_SET.has(handle) || c.addedVia === "seed";
    const relevant = (isSeed ? r.posts : r.posts.filter((p) => isRelevant(p.text))).slice(0, POSTS_PER_CHANNEL);
    await reg.updateOne({ _id: handle } as never,
      { $set: { status: "active", title: r.title, lastFetched: now, postCount: relevant.length } });
    if (relevant.length) kept.push({ handle, label: labelFor(handle, r.title), posts: relevant });
  });

  // Crawl: probe newly-discovered channels; keep the on-topic public ones.
  const totalChannels = await reg.countDocuments({ status: { $ne: "dead" } });
  const room = Math.max(0, CHANNEL_CAP - totalChannels);
  const candidates = [...crossAll].filter((h) => !seen.has(h)).slice(0, Math.min(MAX_NEW_CANDIDATES, room));
  let discovered = 0;
  await mapLimit(candidates, 5, async (handle) => {
    const r = await fetchChannel(handle);
    const now = Date.now();
    if (!r) return; // no public preview → ignore silently
    const relevant = r.posts.filter((p) => isRelevant(p.text)).slice(0, POSTS_PER_CHANNEL);
    if (!relevant.length) return; // public but off-topic → skip
    await reg.updateOne({ _id: handle } as never,
      { $setOnInsert: { firstSeen: now, addedVia: "crawl" },
        $set: { status: "active", title: r.title, lastFetched: now, postCount: relevant.length } },
      { upsert: true });
    kept.push({ handle, label: labelFor(handle, r.title), posts: relevant });
    discovered++;
  });

  // Only translate posts we haven't seen before. A repeated announcement is
  // already in the feed (keyed by url) — no need to spend a Gemini call on it;
  // it just stays/resurfaces on its own.
  const allUrls = kept.flatMap((ch) => ch.posts.map((p) => p.url));
  const existing = new Set(
    (await feed.find({ url: { $in: allUrls } }, { projection: { url: 1 } }).toArray()).map((d) => d.url as string),
  );

  // Translate + upsert, bounded by MAX_TRANSLATE (applies to NEW posts only).
  let budget = MAX_TRANSLATE;
  let postCount = 0;
  let carried = 0;
  for (const ch of kept) {
    if (budget <= 0) break;
    const fresh = ch.posts.filter((p) => !existing.has(p.url));
    carried += ch.posts.length - fresh.length;
    if (!fresh.length) continue;
    const posts = fresh.slice(0, budget);
    budget -= posts.length;
    let tr: Translated[] = [];
    try {
      tr = await translatePosts(ch.label, posts);
    } catch (e) {
      errors.push(`${ch.handle}: ${(e as Error).message}`);
      continue;
    }
    const now = Date.now();
    const ops = posts.map((p, i) => {
      const t = tr[i];
      if (!t || !t.title?.trim()) return null;
      return {
        updateOne: {
          filter: { url: p.url },
          update: {
            $set: {
              agency: ch.label, titleKm: t.titleKm?.trim() || "", title: t.title.trim(),
              summary: t.summary?.trim() || "", kind: "Telegram", postedAt: p.postedAt,
              via: "telegram", channel: ch.handle, updatedAt: now,
            },
            $setOnInsert: { url: p.url, createdAt: now },
          },
          upsert: true,
        },
      };
    }).filter(Boolean);
    if (ops.length) {
      await feed.bulkWrite(ops as never);
      postCount += ops.length;
    }
  }

  return { channels: kept.length, posts: postCount, carried, discovered, errors };
}
