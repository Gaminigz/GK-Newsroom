/**
 * GK SMART — Leads (Brand Scout on the web).
 *
 * Code-gated brand-connection intelligence (see brand-scout.ts):
 *   /leads            A→Z directory — 26 letter columns, flags, scores
 *   /leads/b/<slug>   brand detail — signals, approach dossier, first-contact
 *                     deep-search buttons, status/notes tracker
 *
 * Auth: single access code from the LEADS_CODE env var — NO default, NEVER
 * in the repo (public). If LEADS_CODE is unset the page is disabled (404).
 * The session cookie (Path=/) also unlocks the AI Funding pages.
 */

import crypto from "node:crypto";
import { getDb } from "./mongo.ts";
import { CATEGORY_WEIGHT, contactLinks, isoToFlag } from "./brand-scout.ts";

const SESSION_MS = 12 * 3600 * 1000;
const sessions = new Map(); // token → expiry

export const STATUSES = ["new", "research", "approach", "contacted", "replied", "demo", "pilot", "parked"];
const STATUS_COLOR = {
  new: "#8b949e", research: "#58a6ff", approach: "#e3b341", contacted: "#f0883e",
  replied: "#d29922", demo: "#3fb950", pilot: "#2ea043", parked: "#6e7681",
};

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function timeAgo(ts) {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

const BASE_CSS = `
  * { box-sizing:border-box; margin:0; }
  body { background:#0d1117; color:#c9d1d9; font:14.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1160px; margin:0 auto; padding:26px 16px 80px; }
  h1 { font-size:24px; color:#fff; letter-spacing:-.01em; }
  .sub { color:#8b949e; margin:4px 0 18px; font-size:13.5px; }
  .sub a { color:#8b949e; }
  a { color:#58a6ff; }
  code { background:#161b22; border:1px solid #30363d; border-radius:6px; padding:1px 6px; }
  .dim { color:#8b949e; }
`;

/* --------------------------------------------------- A→Z directory page */

export async function renderDirectory({ brandPath = "/leads/b/", homeLinks = true } = {}) {
  const db = await getDb();
  const brands = await db.collection("brands").find({}).sort({ name: 1 }).toArray();

  // Group by first letter A..Z (numbers/symbols → #)
  const groups = new Map();
  for (const b of brands) {
    const ch = (b.name?.[0] ?? "#").toUpperCase();
    const key = ch >= "A" && ch <= "Z" ? ch : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const letters = [...groups.keys()].sort();

  const columns = letters
    .map((L) => {
      const chips = groups
        .get(L)
        .map((b) => {
          const dot = STATUS_COLOR[b.status || "new"];
          const score = b.score ?? 0;
          return `<a class="bchip" href="${esc(brandPath + b._id)}" title="${esc(b.sector ?? "")} · ${esc(b.hq ?? "")} · ${b.signalCount ?? 0} signals">
            <span class="flag">${isoToFlag(b.iso ?? "")}</span>
            <span class="nm">${esc(b.name)}</span>
            ${score > 0 ? `<span class="sc">${score}</span>` : ""}
            <span class="dot" style="background:${dot}"></span>
          </a>`;
        })
        .join("");
      return `<div class="col"><div class="letter">${L}</div>${chips}</div>`;
    })
    .join("");

  const totalSignals = brands.reduce((n, b) => n + (b.signalCount ?? 0), 0);
  const hot = brands.filter((b) => (b.score ?? 0) > 0).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 12);
  const hotRow = hot
    .map(
      (b) => `<a class="hotchip" href="${esc(brandPath + b._id)}">
        <span class="hs">${b.score}</span> ${isoToFlag(b.iso ?? "")} ${esc(b.name)}
      </a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — GK SMART</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  .hotrow { display:flex; gap:8px; overflow-x:auto; padding-bottom:8px; margin-bottom:14px; -webkit-overflow-scrolling:touch; }
  .hotchip { flex:0 0 auto; display:flex; align-items:center; gap:6px; background:#1c1408; border:1px solid #e3b34155;
             color:#e6edf3; border-radius:99px; padding:6px 13px; font-size:13px; text-decoration:none; font-weight:600; }
  .hotchip .hs { background:linear-gradient(135deg,#e3b341,#f0883e); color:#0d1117; font-weight:800; border-radius:7px; padding:1px 7px; font-size:12px; }
  .filter { width:100%; background:#161b22; color:#fff; border:1px solid #30363d; border-radius:10px; padding:10px 14px; font-size:14px; margin-bottom:14px; }
  .board { display:flex; gap:12px; overflow-x:auto; align-items:flex-start; padding-bottom:16px; -webkit-overflow-scrolling:touch; }
  .col { flex:0 0 205px; background:#161b22; border:1px solid #21262d; border-radius:14px; padding:10px; }
  .letter { font-size:17px; font-weight:800; color:#e3b341; padding:2px 6px 8px; border-bottom:1px solid #21262d; margin-bottom:8px; }
  .bchip { display:flex; align-items:center; gap:7px; text-decoration:none; color:#c9d1d9; font-size:13px;
           padding:6px 7px; border-radius:9px; }
  .bchip:hover { background:#1f2630; color:#fff; }
  .bchip .flag { font-size:15px; }
  .bchip .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bchip .sc { background:#2d1a12; color:#f0883e; font-weight:700; border-radius:7px; padding:0 6px; font-size:11.5px; }
  .bchip .dot { width:7px; height:7px; border-radius:99px; flex:0 0 auto; }
  .p { color:#8b949e; font-size:12.5px; margin-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎯 Leads · Brand Scout</h1>
  <div class="sub">${brands.length} brands A→Z · ${totalSignals} AI signals ·
    ${homeLinks ? `<a href="/accounting">← GK SMART Accounting</a> · <a href="/ai/world">🌍 AI Funding</a> · <a href="/leads/logout">sign out</a>` : "local"}</div>
  ${hot.length ? `<div class="hotrow">${hotRow}</div>` : ""}
  <input class="filter" id="filter" placeholder="filter brands… (name, country, sector)">
  <div class="board" id="board">${columns}</div>
  <div class="p">● status colour — grey new · blue research · yellow approach · orange contacted · green demo/pilot.
  Orange badge = AI-trendiness score. Tap a brand for its signals, approach dossier and first-contact search buttons.</div>
</div>
<script>
  const f = document.getElementById("filter");
  f.addEventListener("input", () => {
    const q = f.value.trim().toLowerCase();
    document.querySelectorAll(".bchip").forEach((c) => {
      c.style.display = !q || (c.textContent + " " + (c.title || "")).toLowerCase().includes(q) ? "" : "none";
    });
    document.querySelectorAll(".col").forEach((col) => {
      const any = [...col.querySelectorAll(".bchip")].some((c) => c.style.display !== "none");
      col.style.display = any ? "" : "none";
    });
  });
</script>
</body>
</html>`;
}

/* --------------------------------------------------- brand detail page */

export async function renderBrandPage(slug, { backPath = "/leads", postPath = "/leads/status" } = {}) {
  const db = await getDb();
  const b = await db.collection("brands").findOne({ _id: slug });
  if (!b) return null;
  const sigs = await db
    .collection("brand_signals")
    .find({ brandSlug: slug, signal: true })
    .sort({ publishedAt: -1 })
    .limit(25)
    .toArray();

  const sigRows = sigs
    .map((s) => {
      const hot = (CATEGORY_WEIGHT[s.category] ?? 0) >= 3;
      return `<tr>
        <td class="when">${timeAgo(s.publishedAt)}</td>
        <td><span class="cat${hot ? " hot" : ""}">${esc(s.category)}</span> <b>×${s.strength}</b></td>
        <td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
            <div class="note">${esc(s.note)}</div></td>
        <td class="src">${esc(s.source)}</td>
      </tr>`;
    })
    .join("");

  const d = b.dossier;
  const roles = (d?.targetRoles ?? []).map((r) => `<span class="role">${esc(r)}</span>`).join(" ");
  const mods = (d?.modules ?? []).map((m) => `<span class="mod">${esc(m)}</span>`).join(" ");
  const dossierBlock = d
    ? `<section>
        <h2>Approach dossier</h2>
        <div class="drow"><span class="dk">Why now</span><span>${esc(d.whyNow)}</span></div>
        <div class="drow"><span class="dk">Cambodia angle</span><span>${esc(d.cambodiaAngle)}</span></div>
        <div class="drow"><span class="dk">First contact</span><span class="first">${esc(d.firstContact ?? "—")}</span></div>
        <div class="drow"><span class="dk">Target roles</span><span>${roles}</span></div>
        <div class="drow"><span class="dk">Hook</span><span>${esc(d.hook)}</span></div>
        <div class="drow"><span class="dk">Opener</span><span class="opener">${esc(d.opener)}</span></div>
        <div class="drow"><span class="dk">Pitch modules</span><span>${mods}</span></div>
      </section>`
    : `<section><h2>Approach dossier</h2><p class="dim">Not written yet — dossiers cover the highest-scoring brands first; appears after the next scout run once this brand has signals.</p></section>`;

  const links = contactLinks(b.name)
    .map((l) => `<a class="clink" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
    .join("");

  const opts = STATUSES.map(
    (s) => `<option value="${s}"${s === (b.status || "new") ? " selected" : ""}>${s}</option>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(b.name)} — Leads</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  .back { display:inline-block; color:#8b949e; text-decoration:none; margin-bottom:12px; font-size:14px; }
  .head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:6px; }
  .flagbig { font-size:34px; }
  .score { background:linear-gradient(135deg,#e3b341,#f0883e); color:#0d1117; font-weight:800; border-radius:10px; padding:6px 12px; font-size:18px; }
  .metaline { color:#8b949e; font-size:13.5px; margin-bottom:16px; }
  .status-big { font-weight:700; }
  section { background:#161b22; border:1px solid #21262d; border-radius:14px; padding:16px 18px; margin-bottom:14px; overflow-x:auto; }
  section h2 { font-size:15px; color:#fff; margin-bottom:12px; }
  .track { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .track label { color:#8b949e; font-size:12.5px; }
  .track select, .track input, .track button { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; padding:7px 10px; font-size:13px; }
  .track .notes { flex:1; min-width:220px; }
  .track button { background:#238636; color:#fff; border-color:#238636; font-weight:700; cursor:pointer; }
  .clinks { display:flex; gap:8px; flex-wrap:wrap; }
  .clink { display:inline-block; background:#0d1117; border:1px solid #30363d; border-radius:99px; padding:7px 14px;
           font-size:13px; color:#c9d1d9; text-decoration:none; }
  .clink:hover { border-color:#58a6ff; color:#58a6ff; }
  .drow { display:grid; grid-template-columns:130px 1fr; gap:10px; margin-bottom:8px; }
  .dk { color:#8b949e; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; padding-top:2px; }
  .opener { background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:9px 12px; display:block; color:#e6edf3; }
  .first { background:#101a10; border:1px solid #23863655; border-radius:10px; padding:9px 12px; display:block; color:#7ee2a8; }
  .role, .mod { display:inline-block; background:#21262d; border-radius:99px; padding:2px 10px; font-size:12px; margin:1px 2px; }
  .mod { background:#122b1d; color:#3fb950; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:560px; }
  th { text-align:left; color:#8b949e; font-size:10.5px; letter-spacing:.07em; padding:6px 8px; border-bottom:1px solid #21262d; }
  td { padding:8px; border-top:1px solid #1c2129; vertical-align:top; }
  .when { white-space:nowrap; color:#8b949e; }
  .src { color:#8b949e; font-size:12px; white-space:nowrap; }
  .note { color:#8b949e; font-size:12.5px; margin-top:2px; }
  .cat { display:inline-block; background:#21262d; border-radius:99px; padding:1px 9px; font-size:11.5px; }
  .cat.hot { background:#2d1a12; color:#f0883e; }
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="${esc(backPath)}">← All brands A→Z</a>
  <div class="head">
    <span class="flagbig">${isoToFlag(b.iso ?? "")}</span>
    <h1>${esc(b.name)}</h1>
    <span class="score">${b.score ?? 0}</span>
    <span class="status-big" style="color:${STATUS_COLOR[b.status || "new"]}">● ${esc(b.status || "new")}</span>
  </div>
  <div class="metaline">${esc(b.hq ?? "")} · ${esc(b.sector ?? "")}${b.cambodia ? " · 🇰🇭 sources Cambodia" : ""} ·
    ${b.signalCount ?? 0} signals · latest ${timeAgo(b.lastSignalAt)}</div>

  <section>
    <h2>Track</h2>
    <form class="track" method="POST" action="${esc(postPath)}">
      <input type="hidden" name="slug" value="${esc(b._id)}">
      <label>Status <select name="status">${opts}</select></label>
      <input class="notes" name="notes" value="${esc(b.notes ?? "")}" placeholder="your notes — contact found, email sent, who referred…">
      <button>Save</button>
    </form>
  </section>

  <section>
    <h2>Find the first contact</h2>
    <div class="clinks">${links}</div>
  </section>

  ${dossierBlock}

  <section>
    <h2>AI signals</h2>
    <table>
      <tr><th>WHEN</th><th>SIGNAL</th><th>STORY</th><th>SOURCE</th></tr>
      ${sigRows || `<tr><td colspan="4" class="dim">No AI signals stored yet for this brand — it stays on the daily watch.</td></tr>`}
    </table>
  </section>
</div>
</body>
</html>`;
}

/* ---------------------------------------------------------- login page */

function loginPage(err = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — GK SMART</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing:border-box; margin:0; }
  body { background:#0d1117; color:#c9d1d9; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         min-height:100vh; display:flex; align-items:center; justify-content:center; }
  .card { background:#161b22; border:1px solid #21262d; border-radius:16px; padding:30px 28px; width:min(92vw,360px); text-align:center; }
  h1 { font-size:19px; color:#fff; margin-bottom:4px; }
  .sub { color:#8b949e; font-size:13px; margin-bottom:18px; }
  input { width:100%; background:#0d1117; color:#fff; border:1px solid #30363d; border-radius:10px;
          padding:11px 12px; font-size:17px; text-align:center; letter-spacing:.35em; }
  button { width:100%; margin-top:12px; background:#238636; color:#fff; border:0; border-radius:10px;
           padding:11px; font-size:15px; font-weight:700; cursor:pointer; }
  .err { color:#f85149; font-size:13px; margin-top:10px; }
  .foot { color:#484f58; font-size:12px; margin-top:16px; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/leads/login">
    <h1>🎯 Leads</h1>
    <div class="sub">GK SMART · private</div>
    <input name="code" type="password" inputmode="numeric" autocomplete="off" placeholder="access code" autofocus>
    <button>Enter</button>
    ${err ? `<div class="err">${esc(err)}</div>` : ""}
    <div class="foot">Confidential — authorized access only.</div>
  </form>
</body>
</html>`;
}

/* -------------------------------------------------------- auth plumbing */

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > limit) reject(new Error("body too large")); });
    req.on("end", () => resolve(new URLSearchParams(buf)));
    req.on("error", reject);
  });
}

function getSession(req) {
  const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)gk_leads=([a-f0-9]{48})/);
  if (!m) return null;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) {
    sessions.delete(m[1]);
    return null;
  }
  return m[1];
}

function startSession(res) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  const secure = process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "";
  // Path=/ — the same session also unlocks the private AI Funding pages
  // (/ai/world, /ai/country/XX), gated in serve-web.mjs via hasLeadsSession.
  res.setHeader("Set-Cookie", `gk_leads=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
}

/** True if the request carries a live leads session (used by serve-web to gate AI Funding). */
export function hasLeadsSession(req) {
  return !!getSession(req);
}

function html(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

let failures = 0; // crude brute-force damper, resets on process restart

export async function handleLeads(req, res, url) {
  const CODE = process.env.LEADS_CODE;
  if (!CODE) {
    res.writeHead(404).end("not found");
    return;
  }
  const path = url.pathname;

  if (path === "/leads/login" && req.method === "POST") {
    const form = await readBody(req, 5000);
    const attempt = (form.get("code") || "").trim();
    if (failures > 50) {
      html(res, loginPage("Too many attempts — restart required."), 429);
      return;
    }
    const a = Buffer.from(attempt.padEnd(64).slice(0, 64));
    const b = Buffer.from(String(CODE).padEnd(64).slice(0, 64));
    if (attempt && crypto.timingSafeEqual(a, b)) {
      failures = 0;
      startSession(res);
      res.writeHead(303, { Location: "/leads" });
      res.end();
    } else {
      failures++;
      html(res, loginPage("Wrong code."), 401);
    }
    return;
  }

  if (path === "/leads/logout") {
    const t = getSession(req);
    if (t) sessions.delete(t);
    res.setHeader("Set-Cookie", "gk_leads=; Path=/; Max-Age=0");
    res.writeHead(303, { Location: "/leads" });
    res.end();
    return;
  }

  const authed = getSession(req);
  if (!authed) {
    html(res, loginPage(), path === "/leads" ? 200 : 401);
    return;
  }

  if (path === "/leads/status" && req.method === "POST") {
    const form = await readBody(req);
    const slug = form.get("slug");
    const status = STATUSES.includes(form.get("status")) ? form.get("status") : "new";
    const notes = (form.get("notes") || "").slice(0, 2000);
    const db = await getDb();
    await db.collection("brands").updateOne({ _id: slug }, { $set: { status, notes } });
    res.writeHead(303, { Location: `/leads/b/${encodeURIComponent(slug)}` });
    res.end();
    return;
  }

  const bm = path.match(/^\/leads\/b\/([a-z0-9-]+)$/);
  if (bm) {
    const page = await renderBrandPage(bm[1]);
    if (!page) {
      res.writeHead(404).end("unknown brand");
      return;
    }
    html(res, page);
    return;
  }

  if (path === "/leads" || path === "/leads/") {
    html(res, await renderDirectory());
    return;
  }

  res.writeHead(404).end("not found");
}
