/**
 * Brand Scout — harvests AI-adoption signals for garment/apparel brands.
 *
 * LOCAL TOOL for the Yai sales effort (not wired into the public site or the
 * Railway cron). For each brand we ask Google News RSS (keyless) what the
 * brand is doing with AI, Gemini classifies each NEW story into a signal
 * category with a strength, brands accumulate an "AI-trendiness" score, and
 * the hottest brands get an auto-generated approach dossier: why now, the
 * Cambodia angle, who to target, the hook, an opener line.
 *
 * Collections:
 *   brand_signals  — one doc per story URL (judged once, re-runs are free)
 *   brands         — one doc per brand: score, signals, dossier, status/notes
 *
 * Run:  npm run brands        (harvest + judge + dossiers)
 * View: npm run brands-page   (local page on :8793)
 */

import Parser from "rss-parser";
import { GoogleGenAI, Type } from "@google/genai";

/** Brands worth watching. `cambodia: true` = known/likely Cambodia sourcing. */
export const BRANDS: { name: string; hq: string; cambodia: boolean }[] = [
  { name: "Adidas", hq: "Germany", cambodia: true },
  { name: "Nike", hq: "USA", cambodia: true },
  { name: "Puma", hq: "Germany", cambodia: true },
  { name: "H&M", hq: "Sweden", cambodia: true },
  { name: "Inditex Zara", hq: "Spain", cambodia: false },
  { name: "Uniqlo Fast Retailing", hq: "Japan", cambodia: true },
  { name: "Levi Strauss", hq: "USA", cambodia: true },
  { name: "Gap Inc", hq: "USA", cambodia: true },
  { name: "Primark", hq: "Ireland", cambodia: true },
  { name: "Next plc", hq: "UK", cambodia: true },
  { name: "Marks & Spencer", hq: "UK", cambodia: true },
  { name: "C&A", hq: "Netherlands", cambodia: true },
  { name: "Bestseller", hq: "Denmark", cambodia: true },
  { name: "Mango", hq: "Spain", cambodia: false },
  { name: "Lululemon", hq: "Canada", cambodia: true },
  { name: "Under Armour", hq: "USA", cambodia: true },
  { name: "VF Corporation", hq: "USA", cambodia: true },
  { name: "PVH Calvin Klein Tommy Hilfiger", hq: "USA", cambodia: true },
  { name: "Ralph Lauren", hq: "USA", cambodia: false },
  { name: "Hugo Boss", hq: "Germany", cambodia: false },
  { name: "Decathlon", hq: "France", cambodia: true },
  { name: "Columbia Sportswear", hq: "USA", cambodia: true },
  { name: "New Balance", hq: "USA", cambodia: true },
  { name: "ASICS", hq: "Japan", cambodia: true },
  { name: "Patagonia", hq: "USA", cambodia: false },
  { name: "Shein", hq: "Singapore", cambodia: false },
  { name: "Target apparel", hq: "USA", cambodia: true },
  { name: "Walmart apparel", hq: "USA", cambodia: true },
];

export function brandSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Two keyless queries per brand — same net as the country-AI feed. */
const QUERIES = (b: string) => [
  `"${b}" AI supply chain manufacturing`,
  `"${b}" artificial intelligence digital sourcing factory`,
];

/** Signal categories and how much they matter to a Yai (factory-side) sale. */
export const CATEGORY_WEIGHT: Record<string, number> = {
  supply_chain: 3, // AI in supply chain / logistics / production
  sourcing: 3, // supplier digitalization, sourcing tech, audits
  esg: 2, // ESG / traceability / compliance digitalization
  automation: 2, // factory automation, robotics
  design: 2, // AI in design/product development (4DP angle)
  investment: 2, // AI investments, acquisitions, partnerships
  hiring: 2, // AI leadership/team hires
  retail_ai: 1, // customer-facing AI (chatbots, try-on) — weak signal
  other: 0.5,
};

const MODEL = "gemini-2.5-flash";
const JUDGE_BATCH = 30;
const MAX_JUDGE = 300; // new stories judged per run
const DOSSIER_CAP = 10; // dossiers (re)generated per run
const PER_QUERY = 8; // stories taken per RSS query
const YEAR_MS = 365 * 24 * 3600 * 1000;

const parser = new Parser({ timeout: 15000 });

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function splitTitleSource(raw: string): { title: string; source: string } {
  const i = raw.lastIndexOf(" - ");
  if (i > 20) return { title: raw.slice(0, i).trim(), source: raw.slice(i + 3).trim() };
  return { title: raw.trim(), source: "" };
}

type RawStory = {
  url: string; title: string; source: string; summary: string;
  brand: string; brandSlug: string; publishedAt: number;
};

async function fetchBrandStories(brand: string): Promise<RawStory[]> {
  const out: RawStory[] = [];
  const cutoff = Date.now() - YEAR_MS;
  for (const q of QUERIES(brand)) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const feed = await parser.parseURL(url);
    for (const it of feed.items.slice(0, PER_QUERY)) {
      if (!it.link) continue;
      const publishedAt = it.isoDate ? Date.parse(it.isoDate) : (it.pubDate ? Date.parse(it.pubDate) : Date.now());
      if (Number.isFinite(publishedAt) && publishedAt < cutoff) continue;
      const { title, source } = splitTitleSource(it.title || "");
      if (!title) continue;
      out.push({
        url: it.link, title,
        source: (it as { source?: string }).source || source || "Google News",
        summary: stripHtml(it.contentSnippet || it.content || "").slice(0, 240),
        brand, brandSlug: brandSlug(brand),
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : Date.now(),
      });
    }
  }
  return out;
}

type Verdict = { signal: boolean; category: string; strength: number; note: string };

/** One batched Gemini call: classify stories as AI-adoption signals. */
async function judgeStories(ai: GoogleGenAI, stories: RawStory[]): Promise<Verdict[]> {
  const list = stories
    .map((s, i) => `#${i} [${s.brand}] ${s.title} — ${s.summary || "(no summary)"}`)
    .join("\n");
  const prompt = `You are scouting apparel/garment BRANDS for evidence they are adopting AI — to prioritise them as prospects for an AI manufacturing platform sold to their supplier factories.

For EACH story below decide:
- signal: true only if the story is real evidence THAT BRAND is investing in / adopting / mandating AI or digital technology (supply chain, sourcing, factories, ESG/traceability, design, automation, AI hires or investments). false if it's about a different company, generic industry chatter, stock commentary, or the brand is only mentioned in passing.
- category: one of supply_chain, sourcing, esg, automation, design, investment, hiring, retail_ai, other.
- strength: 1 = mention/intent, 2 = concrete initiative or pilot, 3 = major commitment (rollout, acquisition, mandate to suppliers).
- note: one short sentence a salesperson can read (max 140 chars).

Return exactly ${stories.length} items in order.

STORIES:
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
            signal: { type: Type.BOOLEAN },
            category: { type: Type.STRING },
            strength: { type: Type.INTEGER },
            note: { type: Type.STRING },
          },
          required: ["signal", "category", "strength", "note"],
        },
      },
    },
  });
  const arr = JSON.parse(resp.text ?? "[]") as Verdict[];
  if (!Array.isArray(arr) || arr.length !== stories.length) throw new Error("judge: bad response shape");
  return arr;
}

/** Compact Yai context fed to the dossier writer. */
const YAI_CONTEXT = `Yai (yaikh.com) is an Ai-Native Manufacturing Intelligence Platform by Texlink Technologies, Cambodia — built for garment/footwear/bag factories. Ladder: $120/yr digital admin core → cloud tiers → on-prem Ai server → agentic agents → multi-factory Ai. Killer demos: agent chat that produces a WRAP audit pack from live factory data in one conversation; Digital Audit module (energy/air/water/waste/chemical, Ministry of Environment collaboration); trilingual EN/中文/ខ្មែរ; Cambodia regulatory stack (E-Gov, e-invoice, GDT tax, ABA/Wing payouts); live in production factories (Yorkmars, Caswell). Partners: Anthropic, Google Cloud, JICA. The BRAND does not buy Yai — the brand endorses/prefers digitally-auditable suppliers, and its supplier factories in Cambodia buy Yai.`;

type Dossier = {
  whyNow: string;
  cambodiaAngle: string;
  targetRoles: string[];
  hook: string;
  opener: string;
  modules: string[];
};

async function writeDossier(
  ai: GoogleGenAI,
  brand: { name: string; hq: string; cambodia: boolean },
  signals: { title: string; category: string; strength: number; note: string; publishedAt: number }[],
): Promise<Dossier> {
  const sigList = signals
    .map((s) => `- [${s.category} ×${s.strength}] ${s.title} (${new Date(s.publishedAt).toISOString().slice(0, 10)}) — ${s.note}`)
    .join("\n");
  const prompt = `${YAI_CONTEXT}

BRAND: ${brand.name} (HQ: ${brand.hq}; ${brand.cambodia ? "known to source from Cambodia" : "Cambodia sourcing unconfirmed"}).

Their recent AI signals:
${sigList}

Write an approach dossier for the Yai sales team. Be specific to THIS brand's signals — no generic filler. Fields:
- whyNow: 1-2 sentences — what in their signals makes this the right moment.
- cambodiaAngle: 1-2 sentences — how their Cambodia/Asia supplier base connects to Yai (if sourcing unconfirmed, say what to verify first).
- targetRoles: 3-4 job titles to contact (regional/sourcing/compliance side, not global CEO).
- hook: the single strongest bridge between their AI agenda and Yai (1 sentence).
- opener: a 2-3 sentence cold-outreach opener referencing their actual initiative. Professional, no hype, no "I hope this finds you well".
- modules: 2-4 Yai modules most relevant to pitch (e.g. Digital Audit, YQMS, YPI, 4DP, Accounting/GDT).`;

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          whyNow: { type: Type.STRING },
          cambodiaAngle: { type: Type.STRING },
          targetRoles: { type: Type.ARRAY, items: { type: Type.STRING } },
          hook: { type: Type.STRING },
          opener: { type: Type.STRING },
          modules: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["whyNow", "cambodiaAngle", "targetRoles", "hook", "opener", "modules"],
      },
    },
  });
  return JSON.parse(resp.text ?? "{}") as Dossier;
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

/** Recompute a brand's score from its signals (recency-weighted, last 365d). */
function scoreSignals(signals: { category: string; strength: number; publishedAt: number }[]): number {
  const now = Date.now();
  let score = 0;
  for (const s of signals) {
    const age = Math.max(0, now - s.publishedAt);
    if (age > YEAR_MS) continue;
    const recency = 1 - (age / YEAR_MS) * 0.6; // fresh ≈ 1.0, year-old ≈ 0.4
    score += (CATEGORY_WEIGHT[s.category] ?? 0.5) * s.strength * recency;
  }
  return Math.round(score * 10) / 10;
}

export async function scoutBrands(): Promise<{
  brands: number; stories: number; newSignals: number; dossiers: number; errors: string[];
}> {
  const { getDb } = await import("./mongo");
  const db = await getDb();
  const sigCol = db.collection("brand_signals");
  const brandCol = db.collection("brands");
  await sigCol.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await sigCol.createIndex({ brandSlug: 1, publishedAt: -1 }).catch(() => {});

  const errors: string[] = [];

  // Ensure every seed brand has a doc (idempotent; keeps status/notes).
  const now = Date.now();
  for (const b of BRANDS) {
    await brandCol.updateOne(
      { _id: brandSlug(b.name) } as never,
      {
        $setOnInsert: { name: b.name, status: "new", notes: "", createdAt: now },
        $set: { hq: b.hq, cambodia: b.cambodia },
      },
      { upsert: true },
    );
  }

  // 1. Harvest.
  const perBrand = await mapLimit(BRANDS, 4, async (b) => {
    try {
      return await fetchBrandStories(b.name);
    } catch (e) {
      errors.push(`${b.name}: ${(e as Error).message}`);
      return [] as RawStory[];
    }
  });
  const byUrl = new Map<string, RawStory>();
  for (const list of perBrand) for (const s of list) if (!byUrl.has(s.url)) byUrl.set(s.url, s);
  const stories = [...byUrl.values()];

  // 2. Judge only URLs we've never seen (re-runs are free).
  const known = new Set(
    (await sigCol.find({ url: { $in: stories.map((s) => s.url) } }, { projection: { url: 1 } }).toArray()).map(
      (d) => d.url as string,
    ),
  );
  const fresh = stories.filter((s) => !known.has(s.url)).slice(0, MAX_JUDGE);

  let newSignals = 0;
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  for (let start = 0; start < fresh.length; start += JUDGE_BATCH) {
    const batch = fresh.slice(start, start + JUDGE_BATCH);
    let verdicts: Verdict[];
    try {
      if (!ai) throw new Error("GEMINI_API_KEY not set");
      verdicts = await judgeStories(ai, batch);
    } catch (e) {
      errors.push(`judge @${start}: ${(e as Error).message}`);
      continue; // unjudged stories stay unknown → retried next run
    }
    const ops = batch.map((s, i) => ({
      insertOne: {
        document: {
          ...s,
          signal: verdicts[i].signal,
          category: verdicts[i].category,
          strength: Math.min(3, Math.max(1, verdicts[i].strength || 1)),
          note: verdicts[i].note?.slice(0, 200) ?? "",
          createdAt: now,
        },
      },
    }));
    try {
      await sigCol.bulkWrite(ops as never, { ordered: false });
    } catch { /* duplicate URLs racing — fine */ }
    newSignals += verdicts.filter((v) => v.signal).length;
  }

  // 3. Rescore every brand from its stored signals.
  for (const b of BRANDS) {
    const slug = brandSlug(b.name);
    const sigs = await sigCol
      .find({ brandSlug: slug, signal: true }, { projection: { category: 1, strength: 1, publishedAt: 1 } })
      .toArray();
    await brandCol.updateOne(
      { _id: slug } as never,
      {
        $set: {
          score: scoreSignals(sigs as never),
          signalCount: sigs.length,
          lastSignalAt: sigs.length ? Math.max(...sigs.map((s) => s.publishedAt as number)) : null,
          updatedAt: now,
        },
      },
    );
  }

  // 4. Dossiers for the hottest brands whose dossier is stale (new signals since).
  let dossiers = 0;
  if (ai) {
    const hot = await brandCol
      .find({ score: { $gt: 0 } })
      .sort({ score: -1 })
      .limit(20)
      .toArray();
    for (const b of hot) {
      if (dossiers >= DOSSIER_CAP) break;
      if (b.dossierAt && b.lastSignalAt && b.dossierAt > b.lastSignalAt) continue; // up to date
      const sigs = await sigCol
        .find({ brandSlug: b._id, signal: true })
        .sort({ strength: -1, publishedAt: -1 })
        .limit(8)
        .toArray();
      if (!sigs.length) continue;
      try {
        const dossier = await writeDossier(
          ai,
          { name: b.name as string, hq: b.hq as string, cambodia: !!b.cambodia },
          sigs as never,
        );
        await brandCol.updateOne({ _id: b._id } as never, { $set: { dossier, dossierAt: Date.now() } });
        dossiers++;
      } catch (e) {
        errors.push(`dossier ${b.name}: ${(e as Error).message}`);
      }
    }
  }

  return { brands: BRANDS.length, stories: stories.length, newSignals, dossiers, errors };
}
