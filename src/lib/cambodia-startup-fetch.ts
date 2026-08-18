/**
 * Telegram watcher for Cambodia's startup / tech ecosystem channels.
 *
 * Same no-API technique as telegram-fetch.ts (public t.me/s/<handle> pages,
 * no Telegram app/account/bot/key), but a separate pipeline: different
 * seed channels, different topic (startup/AI ecosystem, not tax/accounting),
 * different target — writes into `ai_feed_items` (marked origin:"telegram-startup")
 * so posts show up on /ai alongside the RSS-sourced Ai news, photos included.
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getDb } from "./mongo";

const MODEL = "gemini-2.5-flash";
const FETCH_TIMEOUT_MS = 20_000;
const POSTS_PER_CHANNEL = 6;
const MAX_TRANSLATE = 40;

/** Cambodia startup / tech ecosystem channels — all trusted seeds, all posts kept. */
const SEED_CHANNELS = ["StartupCambodiaOfficial", "cambodia4point0", "TechoStartupCenter"];

const KNOWN_LABEL: Record<string, string> = {
  StartupCambodiaOfficial: "Startup Cambodia",
  cambodia4point0: "Cambodia 4.0",
  TechoStartupCenter: "Techo Startup Center",
};

async function freeTranslate(text: string): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=km&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = (await res.json()) as [string, string][][];
    const joined = (data[0] ?? []).map((seg) => seg[0]).join("").trim();
    return joined || null;
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return String(s)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type StartupPost = { handle: string; url: string; text: string; image: string | null; postedAt: number | null };

/** Fetch a channel's public web view — text, photo, timestamp per post. */
async function fetchChannel(handle: string): Promise<{ title: string; posts: StartupPost[] } | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://t.me/s/${handle}`, {
      signal: ctl.signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GKNewsroomBot/1.0; +https://github.com/Gaminigz/GK-Newsroom)",
        "Accept-Language": "km,en;q=0.8",
      },
    });
    if (res.status !== 200) return null;
    const html = await res.text();

    const titleM = html.match(/<meta property="og:title" content="([^"]*)"/);
    const title = titleM ? decodeEntities(titleM[1]) : handle;

    const posts: StartupPost[] = [];
    const chunks = html.split(/<div class="tgme_widget_message[ "]/).slice(1);
    for (const chunk of chunks) {
      const linkM = chunk.match(/tgme_widget_message_date"\s+href="(https:\/\/t\.me\/[^"/]+\/\d+)"/);
      const dateM = chunk.match(/datetime="([^"]+)"/);
      const textM = chunk.match(/tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!linkM) continue;
      const text = textM ? decodeEntities(textM[1]) : "";
      if (!text || text.length < 8) continue;
      const photoM = chunk.match(/tgme_widget_message_photo_wrap[\s\S]{0,300}?style="[^"]*background-image:url\('([^']+)'\)/);
      const postedAt = dateM ? Date.parse(dateM[1]) : NaN;
      posts.push({
        handle,
        url: linkM[1],
        text,
        image: photoM ? photoM[1] : null,
        postedAt: Number.isFinite(postedAt) ? postedAt : null,
      });
    }
    return { title, posts };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Translated = { title: string; summary: string };

async function translatePosts(label: string, posts: StartupPost[]): Promise<Translated[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey });

  const list = posts.map((p, i) => `#${i}: ${p.text.slice(0, 500)}`).join("\n\n");
  const prompt = `These are ${posts.length} recent Telegram posts from "${label}", a Cambodian startup/tech ecosystem channel (events, funding news, accelerator programs, AI-first startups). Some are Khmer, some English.
For EACH post (in order, index 0..${posts.length - 1}) return:
- title: a short ENGLISH headline capturing the post (<= 100 chars). If already in English, keep it faithful, just tightened. Never invent facts.
- summary: 1-2 sentence English summary (<= 220 chars). No invented facts.
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
          properties: { title: { type: Type.STRING }, summary: { type: Type.STRING } },
          required: ["title", "summary"],
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

export async function fetchCambodiaStartup(): Promise<{
  channels: number; posts: number; free: number; raw: number; carried: number; errors: string[];
}> {
  const db = await getDb();
  const col = db.collection("ai_feed_items");
  const errors: string[] = [];

  const kept: { handle: string; label: string; posts: StartupPost[] }[] = [];
  await mapLimit(SEED_CHANNELS, 3, async (handle) => {
    const r = await fetchChannel(handle);
    if (!r) { errors.push(`${handle}: no public preview`); return; }
    const posts = r.posts.slice(0, POSTS_PER_CHANNEL);
    if (posts.length) kept.push({ handle, label: KNOWN_LABEL[handle] ?? r.title, posts });
  });

  const allUrls = kept.flatMap((ch) => ch.posts.map((p) => p.url));
  const existing = new Set(
    (await col.find({ url: { $in: allUrls }, origin: "telegram-startup" }, { projection: { url: 1 } }).toArray())
      .map((d) => d.url as string),
  );

  let budget = MAX_TRANSLATE;
  let postCount = 0, freeCount = 0, rawCount = 0, carried = 0;

  for (const ch of kept) {
    if (budget <= 0) break;
    const fresh = ch.posts.filter((p) => !existing.has(p.url));
    carried += ch.posts.length - fresh.length;
    if (!fresh.length) continue;
    const posts = fresh.slice(0, budget);
    budget -= posts.length;
    const now = new Date();

    let tr: Translated[] = [];
    try {
      tr = await translatePosts(ch.label, posts);
    } catch (e) {
      errors.push(`${ch.handle}: ${(e as Error).message}`);
      const ops = await mapLimit(posts, 3, async (p) => {
        const free = await freeTranslate(p.text);
        const title = (free ?? p.text).slice(0, 100);
        const summary = (free ?? p.text).slice(0, 220);
        return {
          updateOne: {
            filter: { url: p.url },
            update: {
              $set: {
                source: ch.label, sourceTag: "Cambodia Startup", origin: "telegram-startup",
                title, originalTitle: p.text.slice(0, 200), summary,
                image: p.image, publishedAt: p.postedAt ?? now.getTime(),
                rewritten: !!free, brands: [], countries: ["Cambodia"], topics: ["startup"],
                archivedAt: now,
              },
              $setOnInsert: { url: p.url, createdAt: now },
            },
            upsert: true,
          },
        };
      });
      if (ops.length) await col.bulkWrite(ops, { ordered: false });
      freeCount += ops.length;
      continue;
    }

    const ops = posts.map((p, i) => {
      const t = tr[i];
      postCount++;
      return {
        updateOne: {
          filter: { url: p.url },
          update: {
            $set: {
              source: ch.label, sourceTag: "Cambodia Startup", origin: "telegram-startup",
              title: t?.title ?? p.text.slice(0, 100), originalTitle: p.text.slice(0, 200),
              summary: t?.summary ?? "", image: p.image, publishedAt: p.postedAt ?? now.getTime(),
              rewritten: true, brands: [], countries: ["Cambodia"], topics: ["startup"],
              archivedAt: now,
            },
            $setOnInsert: { url: p.url, createdAt: now },
          },
          upsert: true,
        },
      };
    });
    if (ops.length) await col.bulkWrite(ops, { ordered: false });
  }

  return { channels: kept.length, posts: postCount, free: freeCount, raw: rawCount, carried, errors };
}
