/**
 * GK SMART — Garments (trade-press outreach tracker).
 *
 * Shares the /leads gate (same LEADS_CODE session, Path=/ cookie — one
 * login unlocks Leads, AI Funding, and this). Combines, per outlet on one
 * page: what it is / who reads it / how to reach them (static research),
 * a live "recent stories" pull via Google News RSS (no Gemini — keeps
 * working during a Gemini outage), and a status/notes outreach tracker
 * (same UI pattern as Leads' brand tracker).
 *
 *   /garments            directory — outlets grouped by tier
 *   /garments/o/<slug>    outlet detail + recent stories + tracker
 */

import { getDb } from "./mongo.ts";
import { GARMENT_OUTLETS } from "../data/garment-press.ts";

export const OUTREACH_STATUSES = ["new", "drafted", "sent", "replied", "published", "declined", "parked"];
const STATUS_COLOR = {
  new: "#8b949e", drafted: "#58a6ff", sent: "#e3b341", replied: "#d29922",
  published: "#3fb950", declined: "#f85149", parked: "#6e7681",
};
const TIER_LABEL = { 1: "Tier 1 — pitch now", 2: "Tier 2 — tangential", 3: "Tier 3 — skip" };

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function isoCountry(iso) {
  try { return regionNames.of(iso.toUpperCase()) ?? iso; } catch { return iso; }
}
function isoToFlag(iso) {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  return String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

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
  .wrap { max-width:1080px; margin:0 auto; padding:26px 16px 80px; }
  h1 { font-size:24px; color:#fff; letter-spacing:-.01em; }
  .sub { color:#8b949e; margin:4px 0 22px; font-size:13.5px; }
  .sub a { color:#8b949e; }
  a { color:#58a6ff; }
  code { background:#161b22; border:1px solid #30363d; border-radius:6px; padding:1px 6px; }
  .dim { color:#8b949e; }
`;

/* --------------------------------------------------- directory page */

export async function renderGarmentDirectory() {
  const db = await getDb();
  const outlets = await db.collection("garment_outlets").find({}).toArray();
  const bySlug = Object.fromEntries(outlets.map((o) => [o._id, o]));
  const totalStories = await db.collection("garment_press_items").countDocuments();

  const tiers = [1, 2, 3].map((tier) => {
    const rows = GARMENT_OUTLETS.filter((o) => o.tier === tier)
      .map((o) => {
        const live = bySlug[o.slug] ?? {};
        const dot = STATUS_COLOR[live.status || "new"];
        return `<a class="ocard" href="/garments/o/${esc(o.slug)}">
          <span class="flag">${isoToFlag(o.iso)}</span>
          <span class="oname">${esc(o.name)}</span>
          <span class="ometa">${esc(isoCountry(o.iso))}</span>
          <span class="ostatus" style="color:${dot}">● ${esc(live.status || "new")}</span>
        </a>`;
      })
      .join("");
    return `<section>
      <h2>${esc(TIER_LABEL[tier])}</h2>
      <div class="grid">${rows}</div>
    </section>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Garments — GK SMART</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  section { margin-bottom:24px; }
  h2 { font-size:15px; color:#e3b341; margin-bottom:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px; }
  .ocard { display:flex; align-items:center; gap:9px; flex-wrap:wrap; background:#161b22; border:1px solid #21262d;
           border-radius:12px; padding:12px 14px; text-decoration:none; color:#c9d1d9; }
  .ocard:hover { border-color:#e3b34155; }
  .flag { font-size:18px; }
  .oname { font-weight:700; color:#fff; flex:1; min-width:0; }
  .ometa { color:#8b949e; font-size:12px; }
  .ostatus { font-size:11.5px; font-weight:700; width:100%; }
  .p { color:#8b949e; font-size:12.5px; margin-top:8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>📰 Garments · Trade-press outreach</h1>
  <div class="sub">${GARMENT_OUTLETS.length} outlets · ${totalStories} stories tracked ·
    <a href="/accounting">← GK SMART Accounting</a> · <a href="/leads">🎯 Leads</a> · <a href="/ai/world">🌍 AI Funding</a> · <a href="/leads/logout">sign out</a></div>
  ${tiers.join("\n")}
  <div class="p">Directory built from a research pass over the Cambodia Int'l Textile &amp; Garment Industry Exhibition's
  media-partner list. Tier 1 = live outreach channel found (submit-article / press page / direct email) and genuinely
  covers garment/footwear/textile manufacturing. "Recent stories" refresh daily via Google News (no AI cost).</div>
</div>
</body>
</html>`;
}

/* --------------------------------------------------- outlet detail page */

export async function renderGarmentOutlet(slug) {
  const outlet = GARMENT_OUTLETS.find((o) => o.slug === slug);
  if (!outlet) return null;
  const db = await getDb();
  const live = (await db.collection("garment_outlets").findOne({ _id: slug })) ?? {};
  const stories = await db
    .collection("garment_press_items")
    .find({ slug })
    .sort({ publishedAt: -1 })
    .limit(10)
    .toArray();

  const storyRows = stories
    .map(
      (s) => `<tr>
        <td class="when">${timeAgo(s.publishedAt)}</td>
        <td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
        <div class="note">${esc(s.summary ?? "")}</div></td>
        <td class="src">${esc(s.source)}</td>
      </tr>`,
    )
    .join("");

  const opts = OUTREACH_STATUSES.map(
    (s) => `<option value="${s}"${s === (live.status || "new") ? " selected" : ""}>${s}</option>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(outlet.name)} — Garments</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  .back { display:inline-block; color:#8b949e; text-decoration:none; margin-bottom:12px; font-size:14px; }
  .head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:6px; }
  .flagbig { font-size:34px; }
  .tier { background:linear-gradient(135deg,#e3b341,#f0883e); color:#0d1117; font-weight:800; border-radius:10px; padding:6px 12px; font-size:13px; }
  .metaline { color:#8b949e; font-size:13.5px; margin-bottom:16px; }
  section { background:#161b22; border:1px solid #21262d; border-radius:14px; padding:16px 18px; margin-bottom:14px; overflow-x:auto; }
  section h2 { font-size:15px; color:#fff; margin-bottom:12px; }
  .drow { display:grid; grid-template-columns:130px 1fr; gap:10px; margin-bottom:10px; }
  .dk { color:#8b949e; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; padding-top:2px; }
  .outreach { background:#101a10; border:1px solid #23863655; border-radius:10px; padding:9px 12px; display:block; color:#7ee2a8; }
  .track { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .track label { color:#8b949e; font-size:12.5px; }
  .track select, .track input, .track button { background:#0d1117; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; padding:7px 10px; font-size:13px; }
  .track .notes { flex:1; min-width:220px; }
  .track button { background:#238636; color:#fff; border-color:#238636; font-weight:700; cursor:pointer; }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:480px; }
  th { text-align:left; color:#8b949e; font-size:10.5px; letter-spacing:.07em; padding:6px 8px; border-bottom:1px solid #21262d; }
  td { padding:8px; border-top:1px solid #1c2129; vertical-align:top; }
  .when { white-space:nowrap; color:#8b949e; }
  .src { color:#8b949e; font-size:12px; white-space:nowrap; }
  .note { color:#8b949e; font-size:12.5px; margin-top:2px; }
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/garments">← All outlets</a>
  <div class="head">
    <span class="flagbig">${isoToFlag(outlet.iso)}</span>
    <h1>${esc(outlet.name)}</h1>
    <span class="tier">${esc(TIER_LABEL[outlet.tier])}</span>
  </div>
  <div class="metaline"><a href="${esc(outlet.url)}" target="_blank" rel="noopener">${esc(outlet.url)}</a> · ${esc(isoCountry(outlet.iso))}</div>

  <section>
    <h2>Track</h2>
    <form class="track" method="POST" action="/garments/status">
      <input type="hidden" name="slug" value="${esc(slug)}">
      <label>Status <select name="status">${opts}</select></label>
      <input class="notes" name="notes" value="${esc(live.notes ?? "")}" placeholder="your notes — pitch sent, editor contact, reply…">
      <button>Save</button>
    </form>
  </section>

  <section>
    <h2>What / who / how to reach them</h2>
    <div class="drow"><span class="dk">What</span><span>${esc(outlet.what)}</span></div>
    <div class="drow"><span class="dk">Audience</span><span>${esc(outlet.audience)}</span></div>
    <div class="drow"><span class="dk">Outreach</span><span class="outreach">${esc(outlet.outreach)}</span></div>
    <div class="drow"><span class="dk">Verdict</span><span>${esc(outlet.verdict)}</span></div>
  </section>

  <section>
    <h2>Recent stories from this outlet</h2>
    <table>
      <tr><th>WHEN</th><th>STORY</th><th>SOURCE</th></tr>
      ${storyRows || `<tr><td colspan="3" class="dim">No stories pulled yet — refreshes daily via Google News (no AI cost).</td></tr>`}
    </table>
  </section>
</div>
</body>
</html>`;
}

/* -------------------------------------------------------------- routing */

function readBody(req, limit = 50_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => { buf += c; if (buf.length > limit) reject(new Error("body too large")); });
    req.on("end", () => resolve(new URLSearchParams(buf)));
    req.on("error", reject);
  });
}

/** Called from serve-web.mjs — caller already verified hasLeadsSession(). */
export async function handleGarments(req, res, url) {
  const path = url.pathname;

  if (path === "/garments/status" && req.method === "POST") {
    const form = await readBody(req);
    const slug = form.get("slug");
    const status = OUTREACH_STATUSES.includes(form.get("status")) ? form.get("status") : "new";
    const notes = (form.get("notes") || "").slice(0, 2000);
    const db = await getDb();
    await db.collection("garment_outlets").updateOne({ _id: slug }, { $set: { status, notes } }, { upsert: true });
    res.writeHead(303, { Location: `/garments/o/${encodeURIComponent(slug)}` });
    res.end();
    return;
  }

  const om = path.match(/^\/garments\/o\/([a-z0-9-]+)$/);
  if (om) {
    const page = await renderGarmentOutlet(om[1]);
    if (!page) { res.writeHead(404).end("unknown outlet"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
    return;
  }

  if (path === "/garments" || path === "/garments/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(await renderGarmentDirectory());
    return;
  }

  res.writeHead(404).end("not found");
}
