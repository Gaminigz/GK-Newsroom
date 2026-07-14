/**
 * GK SMART — Leads (Brand Scout on the web).
 *
 * Code-gated view of the brand-scout intelligence (see brand-scout.ts):
 * garment brands ranked by AI-trendiness, signals, approach dossiers, and a
 * status/notes tracker. Linked discreetly from /accounting.
 *
 * Auth: single access code from the LEADS_CODE env var — NO default, NEVER
 * in the repo (public). If LEADS_CODE is unset the page is disabled (404).
 * Session cookie is in-memory, scoped to /leads.
 */

import crypto from "node:crypto";
import { getDb } from "./mongo.ts";
import { CATEGORY_WEIGHT } from "./brand-scout.ts";

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

function catPill(cat) {
  const hot = (CATEGORY_WEIGHT[cat] ?? 0) >= 3;
  return `<span class="cat${hot ? " hot" : ""}">${esc(cat)}</span>`;
}

function dossierHtml(d) {
  if (!d) return `<p class="dim" style="padding:10px 16px">No dossier yet — appears after the next scout run.</p>`;
  const roles = (d.targetRoles ?? []).map((r) => `<span class="role">${esc(r)}</span>`).join(" ");
  const mods = (d.modules ?? []).map((m) => `<span class="mod">${esc(m)}</span>`).join(" ");
  return `
    <div class="dossier">
      <div class="drow"><span class="dk">Why now</span><span>${esc(d.whyNow)}</span></div>
      <div class="drow"><span class="dk">Cambodia angle</span><span>${esc(d.cambodiaAngle)}</span></div>
      <div class="drow"><span class="dk">Target roles</span><span>${roles}</span></div>
      <div class="drow"><span class="dk">Hook</span><span>${esc(d.hook)}</span></div>
      <div class="drow"><span class="dk">Opener</span><span class="opener">${esc(d.opener)}</span></div>
      <div class="drow"><span class="dk">Pitch modules</span><span>${mods}</span></div>
    </div>`;
}

/** Full Brand Scout page HTML. `postPath` = where the status form submits. */
export async function renderBrandsPage({ postPath = "/leads/status", logoutPath = "/leads/logout" } = {}) {
  const db = await getDb();
  const brands = await db.collection("brands").find({}).sort({ score: -1, name: 1 }).toArray();
  const sigCol = db.collection("brand_signals");

  const blocks = [];
  for (const b of brands) {
    const sigs = await sigCol
      .find({ brandSlug: b._id, signal: true })
      .sort({ publishedAt: -1 })
      .limit(12)
      .toArray();
    const sigRows = sigs
      .map(
        (s) => `<tr>
          <td class="when">${timeAgo(s.publishedAt)}</td>
          <td>${catPill(s.category)} <b>×${s.strength}</b></td>
          <td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
              <div class="note">${esc(s.note)}</div></td>
          <td class="src">${esc(s.source)}</td>
        </tr>`,
      )
      .join("");
    const opts = STATUSES.map(
      (s) => `<option value="${s}"${s === (b.status || "new") ? " selected" : ""}>${s}</option>`,
    ).join("");
    blocks.push(`
      <details class="brand" id="${esc(b._id)}">
        <summary>
          <span class="score">${b.score ?? 0}</span>
          <span class="bname">${esc(b.name)}</span>
          <span class="meta">${esc(b.hq ?? "")}${b.cambodia ? " · 🇰🇭 sources Cambodia" : ""}</span>
          <span class="meta">${b.signalCount ?? 0} signals · latest ${timeAgo(b.lastSignalAt)}</span>
          <span class="status" style="color:${STATUS_COLOR[b.status || "new"]}">● ${esc(b.status || "new")}</span>
        </summary>
        <form class="track" method="POST" action="${esc(postPath)}">
          <input type="hidden" name="slug" value="${esc(b._id)}">
          <label>Status <select name="status">${opts}</select></label>
          <input class="notes" name="notes" value="${esc(b.notes ?? "")}" placeholder="your notes — contact found, email sent, who referred…">
          <button>Save</button>
        </form>
        ${dossierHtml(b.dossier)}
        <table>
          <tr><th>WHEN</th><th>SIGNAL</th><th>STORY</th><th>SOURCE</th></tr>
          ${sigRows || `<tr><td colspan="4" class="dim">No AI signals stored yet.</td></tr>`}
        </table>
      </details>`);
  }

  const totalSignals = brands.reduce((n, b) => n + (b.signalCount ?? 0), 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Leads — GK SMART</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing:border-box; margin:0; }
  body { background:#0d1117; color:#c9d1d9; font:14.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1060px; margin:0 auto; padding:26px 16px 80px; }
  h1 { font-size:24px; color:#fff; letter-spacing:-.01em; }
  .sub { color:#8b949e; margin:4px 0 22px; font-size:13.5px; }
  .sub a { color:#8b949e; }
  .brand { background:#161b22; border:1px solid #21262d; border-radius:14px; margin-bottom:12px; overflow:hidden; }
  summary { display:flex; align-items:center; gap:14px; padding:13px 16px; cursor:pointer; list-style:none; flex-wrap:wrap; }
  summary::-webkit-details-marker { display:none; }
  .score { background:linear-gradient(135deg,#e3b341,#f0883e); color:#0d1117; font-weight:800; border-radius:9px;
           min-width:46px; text-align:center; padding:4px 8px; font-size:15px; }
  .bname { font-weight:700; color:#fff; font-size:16px; }
  .meta { color:#8b949e; font-size:12.5px; }
  .status { margin-left:auto; font-weight:700; font-size:12.5px; }
  .track { display:flex; gap:10px; align-items:center; padding:10px 16px; background:#10151c; border-top:1px solid #21262d; flex-wrap:wrap; }
  .track label { color:#8b949e; font-size:12.5px; }
  .track select, .track input, .track button { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; padding:6px 10px; font-size:13px; }
  .track .notes { flex:1; min-width:220px; }
  .track button { background:#238636; color:#fff; border-color:#238636; font-weight:700; cursor:pointer; }
  .dossier { padding:12px 16px; border-top:1px solid #21262d; display:grid; gap:8px; }
  .drow { display:grid; grid-template-columns:130px 1fr; gap:10px; }
  .dk { color:#8b949e; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; padding-top:2px; }
  .opener { background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:9px 12px; display:block; color:#e6edf3; }
  .role, .mod { display:inline-block; background:#21262d; border-radius:99px; padding:2px 10px; font-size:12px; margin:1px 2px; }
  .mod { background:#122b1d; color:#3fb950; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#8b949e; font-size:10.5px; letter-spacing:.07em; padding:8px 16px 6px; border-top:1px solid #21262d; }
  td { padding:8px 16px; border-top:1px solid #1c2129; vertical-align:top; }
  td a { color:#58a6ff; text-decoration:none; }
  .when { white-space:nowrap; color:#8b949e; }
  .src { color:#8b949e; font-size:12px; white-space:nowrap; }
  .note { color:#8b949e; font-size:12.5px; margin-top:2px; }
  .cat { display:inline-block; background:#21262d; border-radius:99px; padding:1px 9px; font-size:11.5px; }
  .cat.hot { background:#2d1a12; color:#f0883e; }
  .dim { color:#8b949e; }
  code { background:#161b22; border:1px solid #30363d; border-radius:6px; padding:1px 6px; }
  .p { color:#8b949e; font-size:12.5px; margin-top:26px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎯 Leads · Brand Scout</h1>
  <div class="sub">Garment brands ranked by AI-trendiness — ${brands.length} brands · ${totalSignals} signals ·
    <a href="/accounting">← GK SMART Accounting</a> · <a href="${esc(logoutPath)}">sign out</a></div>
  ${blocks.join("\n")}
  <div class="p">Score = Σ category-weight × strength × recency over the last 365 days.
  supply_chain/sourcing ×3 · esg/design/automation/investment/hiring ×2 · retail_ai ×1.</div>
</div>
</body>
</html>`;
}

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
  res.setHeader("Set-Cookie", `gk_leads=${token}; HttpOnly; Path=/leads; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
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
    res.setHeader("Set-Cookie", "gk_leads=; Path=/leads; Max-Age=0");
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
    res.writeHead(303, { Location: `/leads#${slug}` });
    res.end();
    return;
  }

  if (path === "/leads" || path === "/leads/") {
    html(res, await renderBrandsPage());
    return;
  }

  res.writeHead(404).end("not found");
}
