/**
 * GK SMART — Garments · Associations (industry-body outreach tracker).
 *
 * Same gate as /leads and /garments (shared LEADS_CODE session). Unlike
 * garment-directory.mjs (media outlets, PR pitch angle), this tracks
 * INDUSTRY ASSOCIATIONS — outreach here is institutional (partnership,
 * membership, event-speaking) not a press pitch.
 *
 *   /garments/associations         directory — grouped by sector
 *   /garments/assoc/<slug>         org detail + recent stories + tracker
 */

import { getDb } from "./mongo.ts";
import { ASSOCIATIONS } from "../data/garment-associations.ts";

export const ORG_STATUSES = ["new", "researching", "contacted", "replied", "member-inquiry", "partnered", "declined", "parked"];
const STATUS_COLOR = {
  new: "#8b949e", researching: "#58a6ff", contacted: "#e3b341", replied: "#d29922",
  "member-inquiry": "#a371f7", partnered: "#3fb950", declined: "#f85149", parked: "#6e7681",
};
const SECTOR_LABEL = { garment: "👕 Garment", footwear: "👟 Footwear", bags: "👜 Bags & Luggage", softgoods: "🧸 Softgoods" };
const SECTORS = ["garment", "footwear", "bags", "softgoods"];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function isoCountry(iso) {
  if (!iso) return "";
  try { return regionNames.of(iso.toUpperCase()) ?? iso; } catch { return iso; }
}
function isoToFlag(iso) {
  if (!/^[A-Za-z]{2}$/.test(iso || "")) return "🌐";
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

export async function renderAssociationDirectory() {
  const db = await getDb();
  const orgs = await db.collection("garment_orgs").find({}).toArray();
  const bySlug = Object.fromEntries(orgs.map((o) => [o._id, o]));
  const totalStories = await db.collection("garment_org_items").countDocuments();

  const sections = SECTORS.map((sector) => {
    const rows = ASSOCIATIONS.filter((a) => a.sectors.includes(sector))
      .map((a) => {
        const live = bySlug[a.slug] ?? {};
        const dot = STATUS_COLOR[live.status || "new"];
        return `<a class="ocard" href="/garments/assoc/${esc(a.slug)}">
          <span class="flag">${isoToFlag(a.iso)}</span>
          <span class="oname">${esc(a.name)}</span>
          <span class="ometa">${esc(a.countryLabel || isoCountry(a.iso))}</span>
          <span class="ostatus" style="color:${dot}">● ${esc(live.status || "new")}</span>
        </a>`;
      })
      .join("");
    if (!rows) return "";
    return `<section>
      <h2>${SECTOR_LABEL[sector]}</h2>
      <div class="grid">${rows}</div>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Associations — Garments — GK SMART</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  section { margin-bottom:24px; }
  h2 { font-size:15px; color:#e3b341; margin-bottom:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }
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
  <h1>🏛 Garments · Industry Associations</h1>
  <div class="sub">${ASSOCIATIONS.length} associations · ${totalStories} stories tracked ·
    <a href="/garments">← Trade press</a> · <a href="/accounting">GK SMART Accounting</a> · <a href="/leads">🎯 Leads</a> · <a href="/leads/logout">sign out</a></div>
  ${sections}
  <div class="p">Garment/footwear/bags/softgoods manufacturing trade bodies worldwide. Outreach here is institutional
  (partnership, membership, event-speaking) — not a press pitch. "Recent stories" refresh daily via Google News
  (topical + site search, no AI cost). Facebook-only associations with no other public source get no automated
  feed — that content stays manual, read on demand through your own logged-in browser.</div>
</div>
</body>
</html>`;
}

/* --------------------------------------------------- org detail page */

export async function renderAssociationOrg(slug) {
  const org = ASSOCIATIONS.find((a) => a.slug === slug);
  if (!org) return null;
  const db = await getDb();
  const live = (await db.collection("garment_orgs").findOne({ _id: slug })) ?? {};
  const stories = await db
    .collection("garment_org_items")
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

  const opts = ORG_STATUSES.map(
    (s) => `<option value="${s}"${s === (live.status || "new") ? " selected" : ""}>${s}</option>`,
  ).join("");

  const sectorPills = org.sectors.map((s) => `<span class="pill">${SECTOR_LABEL[s]}</span>`).join(" ");
  const linkOut = org.url
    ? `<a href="${esc(org.url)}" target="_blank" rel="noopener">${esc(org.url)}</a>`
    : `<span class="dim">No confirmed official website — check Facebook manually if needed.</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(org.name)} — Garments</title>
<meta name="robots" content="noindex">
<style>
  ${BASE_CSS}
  .back { display:inline-block; color:#8b949e; text-decoration:none; margin-bottom:12px; font-size:14px; }
  .head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:6px; }
  .flagbig { font-size:34px; }
  .metaline { color:#8b949e; font-size:13.5px; margin-bottom:16px; }
  .pill { display:inline-block; background:#21262d; border-radius:99px; padding:3px 11px; font-size:12px; margin:1px 3px 1px 0; }
  section { background:#161b22; border:1px solid #21262d; border-radius:14px; padding:16px 18px; margin-bottom:14px; overflow-x:auto; }
  section h2 { font-size:15px; color:#fff; margin-bottom:12px; }
  .drow { display:grid; grid-template-columns:130px 1fr; gap:10px; margin-bottom:10px; }
  .dk { color:#8b949e; font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; padding-top:2px; }
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
  <a class="back" href="/garments/associations">← All associations</a>
  <div class="head">
    <span class="flagbig">${isoToFlag(org.iso)}</span>
    <h1>${esc(org.name)}</h1>
  </div>
  <div class="metaline">${linkOut} · ${esc(org.countryLabel || isoCountry(org.iso))} · ${sectorPills}</div>

  <section>
    <h2>Track</h2>
    <form class="track" method="POST" action="/garments/assoc-status">
      <input type="hidden" name="slug" value="${esc(slug)}">
      <label>Status <select name="status">${opts}</select></label>
      <input class="notes" name="notes" value="${esc(live.notes ?? "")}" placeholder="your notes — contact made, membership terms, event lead…">
      <button>Save</button>
    </form>
  </section>

  <section>
    <h2>What it is</h2>
    <div class="drow"><span class="dk">Scope</span><span>${esc(org.what)}</span></div>
  </section>

  <section>
    <h2>Recent stories mentioning this association</h2>
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
export async function handleAssociations(req, res, url) {
  const path = url.pathname;

  if (path === "/garments/assoc-status" && req.method === "POST") {
    const form = await readBody(req);
    const slug = form.get("slug");
    const status = ORG_STATUSES.includes(form.get("status")) ? form.get("status") : "new";
    const notes = (form.get("notes") || "").slice(0, 2000);
    const db = await getDb();
    await db.collection("garment_orgs").updateOne({ _id: slug }, { $set: { status, notes } }, { upsert: true });
    res.writeHead(303, { Location: `/garments/assoc/${encodeURIComponent(slug)}` });
    res.end();
    return;
  }

  const om = path.match(/^\/garments\/assoc\/([a-z0-9-]+)$/);
  if (om) {
    const page = await renderAssociationOrg(om[1]);
    if (!page) { res.writeHead(404).end("unknown association"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
    return;
  }

  if (path === "/garments/associations" || path === "/garments/associations/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(await renderAssociationDirectory());
    return;
  }

  res.writeHead(404).end("not found");
}
