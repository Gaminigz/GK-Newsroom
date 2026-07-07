/**
 * Renders today's "Yai Ai Brief" as a 1080×1920 photo card (TikTok photo
 * mode / IG story format): navy brand background, date, top headlines
 * with source + tags, yaikh.com/ai-feed footer.
 *
 * Usage:  MONGO_URL=... node scripts/render-brief-photo.mjs [outPath]
 * Reads the latest classified stories from Mongo (ai_feed_items).
 */

import { MongoClient } from "mongodb";
import sharp from "sharp";
import path from "node:path";

const W = 1080;
const H = 1920;
const MAX_STORIES = 5;

const NAVY = "#0A1F47";
const NAVY_DEEP = "#071634";
const ORANGE = "#F37021";
const AMBER = "#F5C26B";
const CREAM = "#FDF6EC";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Greedy word-wrap for SVG <text> lines. */
function wrap(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) {
      cur = (cur + " " + w).trim();
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (words.join(" ").length > lines.join(" ").length && lines.length === maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, "") + "…";
  }
  return lines;
}

async function main() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error("MONGO_URL not set");
  const out = process.argv[2] || path.join(process.cwd(), "brief-photo.png");

  const client = new MongoClient(mongoUrl);
  await client.connect();
  const items = await client
    .db("yaikh")
    .collection("ai_feed_items")
    .find({}, { projection: { title: 1, source: 1, brands: 1, topics: 1, publishedAt: 1 } })
    .sort({ publishedAt: -1 })
    .limit(MAX_STORIES)
    .toArray();
  await client.close();

  if (items.length === 0) throw new Error("no stories in ai_feed_items");

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Phnom_Penh",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ---- compose story blocks ----
  let y = 620;
  const blocks = items
    .map((it, idx) => {
      const lines = wrap(it.title, 34, 3);
      const tag = [it.source, ...(it.brands || []).slice(0, 1)].filter(Boolean).join(" · ");
      const startY = y;
      const titleHeight = lines.length * 62;
      y += titleHeight + 46 + 60; // title + tag + gap
      const lineSvg = lines
        .map(
          (l, i) =>
            `<text x="90" y="${startY + i * 62}" font-family="Helvetica, Arial, sans-serif" font-size="50" font-weight="700" fill="${CREAM}">${esc(l)}</text>`
        )
        .join("\n");
      return `
        <text x="90" y="${startY - 58}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="4" fill="${ORANGE}">${esc(tag.toUpperCase())}</text>
        ${lineSvg}
        <rect x="90" y="${startY + titleHeight - 20}" width="${idx === items.length - 1 ? 0 : 900}" height="2" fill="#FFFFFF14"/>
      `;
    })
    .join("\n");

  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${NAVY}"/>
      <stop offset="1" stop-color="${NAVY_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="1040" cy="120" r="360" fill="${ORANGE}" opacity="0.07"/>
  <circle cx="60" cy="1860" r="300" fill="${AMBER}" opacity="0.05"/>

  <!-- header -->
  <rect x="90" y="150" width="150" height="8" fill="${ORANGE}"/>
  <text x="90" y="255" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="800" fill="${CREAM}">YAI AI BRIEF</text>
  <text x="90" y="330" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="500" fill="${AMBER}">${esc(dateLabel)}</text>
  <text x="90" y="420" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#FFFFFFAA">Today's top Ai stories — curated for manufacturers</text>

  <!-- stories -->
  ${blocks}

  <!-- footer -->
  <rect x="0" y="${H - 170}" width="${W}" height="170" fill="#00000033"/>
  <text x="90" y="${H - 95}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="800" fill="${ORANGE}">yaikh.com/ai-feed</text>
  <text x="90" y="${H - 45}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#FFFFFF99">Full stories + daily 3-minute Ai podcast</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log("rendered:", out);
  console.log("stories:", items.map((i) => i.title.slice(0, 60)));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
