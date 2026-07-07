/**
 * GK Ai Newsroom — public reader page.
 *
 * A tiny zero-dependency HTTP server (node http + the mongodb driver we
 * already ship) that renders the daily feed straight from Mongo:
 *
 *   GET /                      the feed page (news + History/Timeline series
 *                              + today's podcast player), server-rendered
 *   GET /podcast/latest.wav    latest ready episode audio
 *   GET /podcast/<date>.wav    a specific episode ("YYYY-MM-DD")
 *   GET /healthz               JSON liveness probe for Railway
 *
 * Runs as the second Railway service in the gk-newsroom project (config in
 * railway.web.json). The cron worker writes Mongo; this reads it. Renders
 * are cached in-memory for 5 minutes so a social-media spike costs one
 * Mongo query per window, not one per visitor.
 *
 * Usage:  npm run web     (PORT env override, defaults 8080)
 */

import http from "node:http";
import { getDb } from "../lib/mongo.ts";
import { getEpisodeAudio, listEpisodes } from "../lib/podcast.ts";

const PORT = Number(process.env.PORT || 8080);
const CACHE_MS = 5 * 60 * 1000;

/* ---------------------------------------------------------------- data */

async function loadFeed() {
  const db = await getDb();
  const col = db.collection("ai_feed_items");

  const [news, history, timeline, episodes] = await Promise.all([
    col
      .find({ series: { $exists: false } })
      .sort({ publishedAt: -1 })
      .limit(40)
      .toArray(),
    col.find({ series: "history" }).sort({ seriesEpisode: 1 }).toArray(),
    col.find({ series: "timeline" }).sort({ seriesReleased: -1 }).toArray(),
    listEpisodes(1).catch(() => []),
  ]);

  return { news, history, timeline, episode: episodes[0] ?? null };
}

/* ------------------------------------------------------------- helpers */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(ms) {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

/** Only real http(s) images qualify for og:image (data-URI SVGs do not). */
function firstShareImage(news) {
  for (const it of news) {
    if (it.image && /^https?:\/\//.test(it.image)) return it.image;
  }
  return null;
}

/* -------------------------------------------------------------- render */

function card(it) {
  const kind = it.series === "history" ? "history" : it.series === "timeline" ? "timeline" : "news";
  const seriesPill =
    it.series === "history"
      ? `<span class="pill series">\u{1F4DA} Yai History · EP${esc(it.seriesEpisode)}</span>`
      : it.series === "timeline"
        ? `<span class="pill series">\u{1F570} Timeline · ${esc(it.seriesBrand ?? "")}</span>`
        : `<span class="pill src">${esc(it.source ?? "")}</span>`;
  const tags = [...(it.brands ?? []), ...(it.topics ?? [])]
    .slice(0, 4)
    .map((t) => `<span class="pill tag">${esc(t)}</span>`)
    .join("");
  const img = it.image
    ? `<img class="thumb" src="${esc(it.image)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  const when = it.series ? "" : `<span class="when">${timeAgo(it.publishedAt)}</span>`;
  const href = it.url && /^https?:\/\//.test(it.url) ? esc(it.url) : null;
  const title = href
    ? `<a href="${href}" target="_blank" rel="noopener">${esc(it.title)}</a>`
    : esc(it.title);

  return `<article class="card" data-kind="${kind}">
    ${img}
    <div class="body">
      <div class="meta">${seriesPill}${when}</div>
      <h2>${title}</h2>
      <p>${esc(it.summary ?? "")}</p>
      <div class="tags">${tags}</div>
    </div>
  </article>`;
}

function page({ news, history, timeline, episode }) {
  const top = news[0];
  const ogImage = firstShareImage(news);
  const player = episode
    ? `<section class="podcast">
        <div class="podcast-label">\u{1F399} Daily Ai Brief · ${esc(episode.dateKey ?? episode._id ?? "")}${
          episode.durationSec ? ` · ${Math.round(episode.durationSec / 60)} min` : ""
        }</div>
        <audio controls preload="none" src="/podcast/latest.wav"></audio>
      </section>`
    : "";

  const chips = ["all", "news", "history", "timeline"]
    .map(
      (k, i) =>
        `<button class="chip${i === 0 ? " on" : ""}" data-filter="${k}">${
          { all: "All", news: "News", history: "\u{1F4DA} History", timeline: "\u{1F570} Timeline" }[k]
        }</button>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GK Ai Newsroom — Daily Ai Brief</title>
<meta name="description" content="${esc(top?.title ?? "Daily Ai news, rewritten fresh every morning.")}">
<meta property="og:title" content="GK Ai Newsroom — Daily Ai Brief">
<meta property="og:description" content="${esc(top?.title ?? "Daily Ai news, rewritten fresh every morning.")}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta property="og:type" content="website">
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<style>
  :root { --bg:#0d1117; --card:#161b22; --line:#21262d; --fg:#e6edf3; --dim:#8b949e; --acc:#e3b341; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:16px 14px 60px; }
  header h1 { font-size:26px; letter-spacing:-.02em; }
  header h1 em { color:var(--acc); font-style:normal; }
  header .sub { color:var(--dim); font-size:14px; margin-top:2px; }
  .podcast { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px; margin:16px 0 6px; }
  .podcast-label { font-size:13px; color:var(--dim); margin-bottom:8px; }
  .podcast audio { width:100%; height:38px; }
  .chips { display:flex; gap:8px; margin:14px 0 4px; overflow-x:auto; -webkit-overflow-scrolling:touch; }
  .chip { flex:0 0 auto; background:var(--card); color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:6px 14px; font-size:13px; cursor:pointer; }
  .chip.on { color:#0d1117; background:var(--acc); border-color:var(--acc); font-weight:600; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; margin-top:14px; }
  .thumb { width:100%; max-height:300px; object-fit:cover; display:block; background:#0a0d12; }
  .body { padding:12px 14px 14px; }
  .meta { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .when { color:var(--dim); font-size:12px; }
  h2 { font-size:17px; line-height:1.35; }
  h2 a { color:var(--fg); text-decoration:none; }
  h2 a:active, h2 a:hover { color:var(--acc); }
  .body p { color:var(--dim); font-size:14px; margin-top:6px; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .pill { font-size:11.5px; border-radius:999px; padding:3px 9px; border:1px solid var(--line); color:var(--dim); }
  .pill.src { color:var(--acc); border-color:rgba(227,179,65,.35); }
  .pill.series { color:#79c0ff; border-color:rgba(121,192,255,.35); }
  footer { color:var(--dim); font-size:12px; text-align:center; margin-top:36px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>GK <em>Ai</em> Newsroom</h1>
    <div class="sub">The daily Ai brief — fresh every morning at 5 AM.</div>
  </header>
  ${player}
  <nav class="chips">${chips}</nav>
  <main id="feed">
    ${news.map(card).join("\n")}
    ${timeline.map(card).join("\n")}
    ${history.map(card).join("\n")}
  </main>
  <footer>GK Ai Newsroom · powered by the GK newsroom pipeline</footer>
</div>
<script>
  document.querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      c.classList.add("on");
      const f = c.dataset.filter;
      document.querySelectorAll(".card").forEach((el) => {
        el.style.display = f === "all" || el.dataset.kind === f ? "" : "none";
      });
    });
  });
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------- server */

let cache = { html: null, at: 0 };
let audioCache = { key: null, buf: null, at: 0 };

async function feedHtml() {
  if (cache.html && Date.now() - cache.at < CACHE_MS) return cache.html;
  const data = await loadFeed();
  cache = { html: page(data), at: Date.now() };
  return cache.html;
}

async function latestReadyDate() {
  const eps = await listEpisodes(1);
  return eps[0]?.dateKey ?? eps[0]?._id ?? null;
}

/** Serve WAV with Range support so mobile players can seek. */
function sendAudio(req, res, buf) {
  const range = req.headers.range;
  const total = buf.length;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    res.writeHead(206, {
      "Content-Type": "audio/wav",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(buf.subarray(start, end + 1));
  } else {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": total,
      "Cache-Control": "public, max-age=3600",
    });
    res.end(buf);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname;

    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (path === "/") {
      const html = await feedHtml();
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(html);
      return;
    }

    const m = path.match(/^\/podcast\/(latest|\d{4}-\d{2}-\d{2})\.wav$/);
    if (m) {
      const key = m[1] === "latest" ? await latestReadyDate() : m[1];
      if (!key) {
        res.writeHead(404).end("no episode yet");
        return;
      }
      if (audioCache.key !== key || Date.now() - audioCache.at > CACHE_MS) {
        const buf = await getEpisodeAudio(key);
        if (!buf) {
          res.writeHead(404).end("episode not found");
          return;
        }
        audioCache = { key, buf, at: Date.now() };
      }
      sendAudio(req, res, audioCache.buf);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  } catch (err) {
    console.error("[web]", err instanceof Error ? err.message : err);
    res.writeHead(500, { "Content-Type": "text/plain" }).end("server error");
  }
});

server.listen(PORT, () => {
  console.log(`GK Ai Newsroom web listening on :${PORT}`);
});
