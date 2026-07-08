/**
 * GK Ai Newsroom — public reader page.
 *
 * A tiny zero-dependency HTTP server (node http + the mongodb driver we
 * already ship) that renders the daily feed straight from Mongo:
 *
 *   GET /                      landing page — three topic tiles, stacked
 *                              mobile-first: 3una5aha (Sri Lankan food),
 *                              Ai News, GK SMART Accounting
 *   GET /ai                    the Ai feed (news + History/Timeline series
 *                              + Winamp-style podcast player), server-rendered
 *   GET /food                  3una5aha — Sri Lankan food (coming soon)
 *   GET /accounting            GK SMART Accounting (coming soon)
 *   GET /podcast/latest.wav    latest ready episode audio
 *   GET /podcast/<date>.wav    a specific episode ("YYYY-MM-DD")
 *   GET /healthz               JSON liveness probe for Railway
 *
 * The player lists EVERY ready episode from `ai_feed_podcast` (they live in
 * Mongo forever once generated, so the back-catalog streams instantly) —
 * numbered Episode 1 = the oldest, with a dropdown to jump between days.
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
    // Full back-catalog, newest first. Episode 1 = the oldest ready one.
    listEpisodes(366).catch(() => []),
  ]);

  return { news, history, timeline, episodes };
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

/** "YYYY-MM-DD" → "DD.MM.YYYY" for the player display. */
function fmtDate(key) {
  const [y, m, d] = String(key).split("-");
  return d && m && y ? `${d}.${m}.${y}` : String(key);
}

function fmtDur(sec) {
  if (!sec || !Number.isFinite(sec)) return "–:––";
  const m = Math.floor(sec / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return `${m}:${s}`;
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

/**
 * Winamp-style compact player. `episodes` come newest-first from Mongo;
 * Episode numbers count up from the oldest (EP1 = first ever generated).
 */
function player(episodes) {
  if (!episodes?.length) return "";
  const total = episodes.length;
  const list = episodes.map((e, i) => ({
    n: total - i,
    date: e.date,
    label: fmtDate(e.date),
    dur: fmtDur(e.durationSec),
  }));
  const cur = list[0];

  const rows = list
    .map(
      (e, i) =>
        `<li data-i="${i}"${i === 0 ? ' class="on"' : ""}><span class="n">Episode ${e.n}</span><span class="d">${e.label}</span><span class="t">${e.dur}</span></li>`,
    )
    .join("");

  return `<section class="wa">
    <div class="wa-row">
      <button class="wa-b" id="waPrev" aria-label="Older episode">⏮</button>
      <button class="wa-b wa-main" id="waPlay" aria-label="Play">▶</button>
      <button class="wa-b" id="waNext" aria-label="Newer episode">⏭</button>
      <div class="wa-lcd">
        <div class="wa-lcd-top" id="waTitle">EP ${cur.n} · ${cur.label} · THE Ai BRIEF</div>
        <div class="wa-lcd-sub"><span id="waCur">0:00</span> / <span id="waDur">${cur.dur}</span></div>
      </div>
      <button class="wa-b wa-drop" id="waDrop" aria-label="Episode list">▾</button>
    </div>
    <div class="wa-seek" id="waSeek"><div class="wa-fill" id="waFill"></div></div>
    <ol class="wa-list" id="waList" hidden>${rows}</ol>
    <audio id="waAudio" preload="none"></audio>
    <script id="waData" type="application/json">${JSON.stringify(list)}</script>
  </section>`;
}

/** Shared page skeleton for landing + coming-soon pages (no Mongo needed). */
function shell({ title, desc, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<style>
  * { box-sizing:border-box; margin:0; }
  body { background:#0d1117; color:#e6edf3; font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:20px 14px 40px; min-height:100vh; display:flex; flex-direction:column; }
  header h1 { font-size:28px; letter-spacing:-.02em; }
  header h1 em { color:#e3b341; font-style:normal; }
  header .sub { color:#8b949e; font-size:14px; margin:2px 0 18px; }
  .tiles { display:flex; flex-direction:column; gap:14px; flex:1; }
  .tile { display:flex; flex-direction:column; justify-content:center; gap:6px; min-height:150px;
          border-radius:18px; padding:22px 22px; text-decoration:none; border:1px solid #ffffff1c;
          box-shadow:0 4px 14px #0007; }
  .tile:active { filter:brightness(1.12); }
  .tile .emoji { font-size:34px; line-height:1; }
  .tile h2 { color:#fff; font-size:23px; letter-spacing:-.01em; }
  .tile p { color:#ffffffc9; font-size:14px; }
  .tile .go { color:#ffffffee; font-size:13px; font-weight:600; margin-top:4px; }
  .t-food { background:linear-gradient(135deg,#8a3f12,#c2611c 55%,#e08a2e); }
  .t-ai   { background:linear-gradient(135deg,#0a1f47,#173a7a 60%,#2a5cb8); }
  .t-acct { background:linear-gradient(135deg,#0b3d2e,#14654a 60%,#1e8f66); }
  .soon { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:10px; }
  .soon .emoji { font-size:64px; }
  .soon h2 { font-size:24px; }
  .soon p { color:#8b949e; max-width:400px; }
  .back { display:inline-block; margin-bottom:14px; color:#8b949e; text-decoration:none; font-size:14px; }
  .back:active, .back:hover { color:#e3b341; }
  footer { color:#8b949e; font-size:12px; text-align:center; margin-top:28px; }
</style>
</head>
<body><div class="wrap">${body}<footer>GK Newsroom · ggmt.sg</footer></div></body>
</html>`;
}

function landingPage() {
  return shell({
    title: "GK Newsroom",
    desc: "3una5aha Sri Lankan food · the daily Ai brief · GK SMART accounting.",
    body: `
  <header>
    <h1>GK <em>Newsroom</em></h1>
    <div class="sub">Pick your channel.</div>
  </header>
  <nav class="tiles">
    <a class="tile t-food" href="/food">
      <span class="emoji">\u{1F35B}</span>
      <h2>3una5aha</h2>
      <p>Sri Lankan food — tuna paha flavours, stories and recipes.</p>
      <span class="go">Open →</span>
    </a>
    <a class="tile t-ai" href="/ai">
      <span class="emoji">\u{1F916}</span>
      <h2>Ai News</h2>
      <p>The daily Ai brief — fresh stories every morning at 5 AM, plus the podcast.</p>
      <span class="go">Open →</span>
    </a>
    <a class="tile t-acct" href="/accounting">
      <span class="emoji">\u{1F4CA}</span>
      <h2>GK SMART Accounting</h2>
      <p>Smart counting for your business — news and tools.</p>
      <span class="go">Open →</span>
    </a>
  </nav>`,
  });
}

function comingSoonPage({ emoji, name, blurb }) {
  return shell({
    title: `${name} — GK Newsroom`,
    desc: blurb,
    body: `
  <a class="back" href="/">← GK Newsroom</a>
  <div class="soon">
    <span class="emoji">${emoji}</span>
    <h2>${esc(name)}</h2>
    <p>${esc(blurb)}</p>
    <p><strong>Coming soon.</strong></p>
  </div>`,
  });
}

function page({ news, history, timeline, episodes }) {
  const top = news[0];
  const ogImage = firstShareImage(news);

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
  :root { --bg:#0d1117; --card:#161b22; --line:#21262d; --fg:#e6edf3; --dim:#8b949e; --acc:#e3b341; --lcd:#39ff88; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:680px; margin:0 auto; padding:16px 14px 60px; }
  header h1 { font-size:26px; letter-spacing:-.02em; }
  header h1 em { color:var(--acc); font-style:normal; }
  header .sub { color:var(--dim); font-size:14px; margin-top:2px; }

  /* ---- Winamp-style player ---- */
  .wa { margin:16px 0 6px; border:1px solid #14161b; border-radius:10px;
        background:linear-gradient(#343a46,#20242c); box-shadow:0 2px 8px #0006; overflow:hidden; }
  .wa-row { display:flex; align-items:center; gap:8px; padding:8px 10px 6px; }
  .wa-b { flex:0 0 auto; width:34px; height:30px; border-radius:6px; cursor:pointer; color:#cdd3dd;
          background:linear-gradient(#4a5160,#2b303a); border:1px solid #171a20;
          box-shadow:inset 0 1px 0 #ffffff22; font-size:13px; line-height:1; }
  .wa-b:active { background:linear-gradient(#2b303a,#4a5160); }
  .wa-main { width:42px; font-size:15px; color:var(--acc); }
  .wa-lcd { flex:1 1 auto; min-width:0; background:#080d09; border:1px solid #000;
            border-radius:5px; padding:4px 10px 5px; box-shadow:inset 0 2px 6px #000c; }
  .wa-lcd-top { color:var(--lcd); font:600 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
                letter-spacing:.06em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                text-shadow:0 0 6px #39ff8877; }
  .wa-lcd-sub { color:#2bcf6e; font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; opacity:.9; }
  .wa-drop { font-size:15px; transition:transform .18s; }
  .wa-drop.open { transform:rotate(180deg); }
  .wa-seek { height:8px; margin:0 10px 9px; border-radius:4px; background:#12151b;
             box-shadow:inset 0 1px 3px #000a; cursor:pointer; }
  .wa-fill { height:100%; width:0%; border-radius:4px;
             background:linear-gradient(90deg,#e3b341,#f37021); box-shadow:0 0 6px #f3702188; }
  .wa-list { list-style:none; max-height:224px; overflow-y:auto; border-top:1px solid #14161b;
             background:#101318; padding:4px 0; }
  .wa-list li { display:flex; gap:10px; align-items:baseline; padding:8px 14px; cursor:pointer;
                font:12.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; color:#aab3bf; }
  .wa-list li:hover { background:#181d25; }
  .wa-list li.on { color:var(--lcd); }
  .wa-list li.on .n::before { content:"▸ "; }
  .wa-list .n { flex:1; }
  .wa-list .d { color:#7f8894; }
  .wa-list li.on .d { color:var(--lcd); opacity:.8; }
  .wa-list .t { width:44px; text-align:right; color:#6b7480; }

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
    <a class="back" href="/" style="display:inline-block;margin-bottom:8px;color:#8b949e;text-decoration:none;font-size:14px">← GK Newsroom</a>
    <h1>GK <em>Ai</em> Newsroom</h1>
    <div class="sub">The daily Ai brief — fresh every morning at 5 AM.</div>
  </header>
  ${player(episodes)}
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

  // ---- Winamp player ----
  (() => {
    const data = document.getElementById("waData");
    if (!data) return;
    const eps = JSON.parse(data.textContent);          // newest first
    const audio = document.getElementById("waAudio");
    const play = document.getElementById("waPlay");
    const prev = document.getElementById("waPrev");
    const next = document.getElementById("waNext");
    const drop = document.getElementById("waDrop");
    const listEl = document.getElementById("waList");
    const title = document.getElementById("waTitle");
    const cur = document.getElementById("waCur");
    const dur = document.getElementById("waDur");
    const seek = document.getElementById("waSeek");
    const fill = document.getElementById("waFill");
    let i = 0, loaded = false;

    const mmss = (s) => isFinite(s) ? Math.floor(s/60) + ":" + String(Math.floor(s%60)).padStart(2,"0") : "–:––";

    function show(idx) {
      i = idx; loaded = false;
      const e = eps[i];
      title.textContent = "EP " + e.n + " · " + e.label + " · THE Ai BRIEF";
      dur.textContent = e.dur; cur.textContent = "0:00"; fill.style.width = "0%";
      listEl.querySelectorAll("li").forEach((li, k) => li.classList.toggle("on", k === i));
    }
    function load() {
      if (!loaded) { audio.src = "/podcast/" + eps[i].date + ".wav"; loaded = true; }
    }
    function start(idx) { show(idx); load(); audio.play(); }

    play.addEventListener("click", () => {
      load();
      if (audio.paused) audio.play(); else audio.pause();
    });
    audio.addEventListener("play",  () => { play.textContent = "⏸"; });
    audio.addEventListener("pause", () => { play.textContent = "▶"; });
    audio.addEventListener("ended", () => { if (i > 0) start(i - 1); });   // roll into the next-newer day
    audio.addEventListener("loadedmetadata", () => { dur.textContent = mmss(audio.duration); });
    audio.addEventListener("timeupdate", () => {
      cur.textContent = mmss(audio.currentTime);
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + "%";
    });

    prev.addEventListener("click", () => { if (i < eps.length - 1) start(i + 1); }); // older
    next.addEventListener("click", () => { if (i > 0) start(i - 1); });              // newer

    seek.addEventListener("click", (ev) => {
      if (!audio.duration) return;
      const r = seek.getBoundingClientRect();
      audio.currentTime = ((ev.clientX - r.left) / r.width) * audio.duration;
    });

    drop.addEventListener("click", () => {
      listEl.hidden = !listEl.hidden;
      drop.classList.toggle("open", !listEl.hidden);
    });
    listEl.addEventListener("click", (ev) => {
      const li = ev.target.closest("li");
      if (li) start(Number(li.dataset.i));
    });

    show(0);
  })();
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
  return eps[0]?.date ?? null;
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
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=600",
      });
      res.end(landingPage());
      return;
    }

    if (path === "/ai") {
      const html = await feedHtml();
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
      res.end(html);
      return;
    }

    if (path === "/food" || path === "/accounting") {
      const props =
        path === "/food"
          ? {
              emoji: "\u{1F35B}",
              name: "3una5aha",
              blurb: "Sri Lankan food — tuna paha flavours, stories and recipes.",
            }
          : {
              emoji: "\u{1F4CA}",
              name: "GK SMART Accounting",
              blurb: "Smart counting for your business — news and tools.",
            };
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=600",
      });
      res.end(comingSoonPage(props));
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
