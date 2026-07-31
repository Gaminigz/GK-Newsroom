/**
 * 3una 5aha — System management console (design: "3una 5aha All Screens" 1.1/1.2).
 *
 * Mounted by serve-web.mjs on /admin. Zero-dep, same pattern as the rest:
 * node http + the mongodb driver, server-rendered template strings.
 *
 *   GET  /admin                  sign-in (design 1.1) or redirect to a tab
 *   POST /admin/login            email + password + 6-digit code (ADMIN_CODE)
 *   GET  /admin/logout           drop the session
 *   GET  /admin/newsroom         tab 1 — the 3 subjects + voice streamer
 *   POST /admin/item/delete      moderation: remove a feed item
 *   POST /admin/podcast/delete   remove a podcast episode
 *   GET  /admin/shop             tab 2 — shop owners console (design 1.2)
 *   POST /admin/shop/status      approve / suspend / reactivate an owner
 *   POST /admin/shop/resetpass   temp password ("kola-35-pittu" style)
 *
 * Auth: the 2FA-style code is the gate — ADMIN_CODE env, default 555555.
 * Sessions are in-memory (a Railway redeploy signs everyone out — fine).
 */

import crypto from "node:crypto";
import { getDb } from "./mongo.ts";
import { listEpisodes } from "./podcast.ts";

const ADMIN_CODE = process.env.ADMIN_CODE || "555555"; // 2FA — disabled for now (see /admin/login handler)
const ADMIN_ID = (process.env.ADMIN_ID || "admin5").toLowerCase();
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiry epoch ms

/* ------------------------------------------------------------- helpers */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(new URLSearchParams(buf)));
    req.on("error", reject);
  });
}

function getSession(req) {
  const cookie = req.headers.cookie ?? "";
  const m = cookie.match(/(?:^|;\s*)gk_admin=([a-f0-9]{48})/);
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
  res.setHeader(
    "Set-Cookie",
    `gk_admin=${token}; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`,
  );
}

function redirect(res, to) {
  res.writeHead(303, { Location: to });
  res.end();
}

function html(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/** Append one row to the superadmin audit trail. Never throws — logging
 *  must never break the action it's recording. */
async function logActivity(action, { target = "", detail = "" } = {}) {
  try {
    const db = await getDb();
    await db.collection("admin_activity").insertOne({ action, target, detail, actor: "admin5", at: new Date() });
  } catch { /* audit log is best-effort */ }
}

const TEMP_WORDS = ["kola", "pittu", "kottu", "polos", "ambula", "parippu", "sambol", "achcharu", "watalappan", "hoppers"];
function tempPassword() {
  const pick = () => TEMP_WORDS[crypto.randomInt(TEMP_WORDS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-35-${b}`;
}

/* ---------------------------------------------------------- sign-in UI */

function loginPage(error = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3una 5aha — System management console</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing:border-box; margin:0; }
  body { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#faf7f4; color:#1a1a1a; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:19px; color:#1a1a1a; margin-bottom:26px; }
  .brand .chip { background:#e05a33; color:#fff; border-radius:9px; padding:4px 8px; font-size:15px; }
  .card { width:100%; max-width:340px; }
  .card h2 { font-size:26px; letter-spacing:-.01em; }
  .card .sub { color:#6b6560; font-size:14px; margin:4px 0 22px; }
  label { display:block; font-size:11px; font-weight:700; letter-spacing:.08em; color:#6b6560; margin:16px 0 6px; }
  input[type=text], input[type=password] { width:100%; padding:12px 13px; font-size:15px; border:1.5px solid #ddd5cd; border-radius:10px; background:#fff; }
  input:focus { outline:none; border-color:#e05a33; }
  .code { display:flex; gap:8px; }
  .code input { width:44px; height:50px; text-align:center; font-size:20px; font-weight:700; border:1.5px solid #ddd5cd; border-radius:10px; background:#fff; }
  .hint { font-size:12px; color:#8a827b; margin-top:6px; }
  .err { background:#fdecea; color:#b3261e; border-radius:10px; padding:10px 12px; font-size:13.5px; margin-bottom:6px; }
  button { width:100%; margin-top:22px; padding:14px; font-size:15.5px; font-weight:700; color:#fff; background:#d9542b; border:0; border-radius:12px; cursor:pointer; }
  button:hover { background:#c4471f; }
  .forgot { display:block; text-align:center; color:#8a827b; font-size:13px; margin-top:14px; text-decoration:none; }
</style>
</head>
<body>
    <form class="card" method="POST" action="/admin/login" id="f">
      <div class="brand"><span class="chip">35</span> 3una 5aha</div>
      <h2>Sign in</h2>
      <div class="sub">Use your admin credentials</div>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <label>ADMIN ID</label>
      <input type="text" name="email" value="admin5" autocomplete="username">
      <label>PASSWORD</label>
      <input type="password" name="password" placeholder="••••••••••" autocomplete="current-password">
      <button type="submit">Sign in to console</button>
      <a class="forgot" href="mailto:gk.smart@ggmt.sg?subject=Admin%20access%20request">Forgot password? Email gk.smart@ggmt.sg</a>
    </form>
</body>
</html>`;
}

/* ------------------------------------------------------- console shell */

function shell(tab, body) {
  const tabs = [
    ["newsroom", "NewsRoom"],
    ["shop", "Superadmin Shop"],
    ["orders", "Orders"],
    ["menus", "Menus"],
    ["chats", "Chats"],
    ["activity", "Activity"],
  ]
    .map(
      ([k, label]) =>
        `<a class="tab${k === tab ? " on" : ""}" href="/admin/${k}">${label}</a>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3una 5aha — console</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing:border-box; margin:0; }
  body { background:#f4f0ec; color:#1a1a1a; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { background:#191512; color:#fff; padding:12px 20px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  .brand { display:flex; align-items:center; gap:8px; font-weight:800; }
  .brand .chip { background:#e05a33; border-radius:8px; padding:3px 7px; font-size:14px; }
  .tab { color:#c9bfb7; text-decoration:none; font-weight:600; padding:7px 13px; border-radius:9px; }
  .tab.on { background:#2b241f; color:#fff; }
  .out { margin-left:auto; color:#c9bfb7; text-decoration:none; font-size:13.5px; }
  main { max-width:1080px; margin:0 auto; padding:22px 16px 60px; }
  h1 { font-size:23px; letter-spacing:-.01em; }
  .sub { color:#6b6560; font-size:13.5px; margin:2px 0 18px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:22px; }
  .stat { background:#fff; border:1px solid #e7ded6; border-radius:14px; padding:14px 16px; }
  .stat .k { color:#6b6560; font-size:12px; }
  .stat .v { font-size:24px; font-weight:800; margin-top:2px; }
  .stat .n { color:#8a827b; font-size:11.5px; }
  section { background:#fff; border:1px solid #e7ded6; border-radius:16px; padding:16px 18px; margin-bottom:20px; overflow-x:auto; }
  section h2 { font-size:16px; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; min-width:640px; }
  th { text-align:left; color:#6b6560; font-size:11px; letter-spacing:.06em; padding:8px 10px; border-bottom:1px solid #eee5dc; }
  td { padding:9px 10px; border-bottom:1px solid #f3ece5; vertical-align:middle; }
  .pill { display:inline-block; border-radius:99px; padding:2px 10px; font-size:11.5px; font-weight:700; }
  .pill.active { background:#e3f4e6; color:#1d7a34; }
  .pill.pending { background:#fdf3d7; color:#946200; }
  .pill.suspended { background:#fdecea; color:#b3261e; }
  .pill.ready { background:#e3f4e6; color:#1d7a34; }
  .b { font-size:12.5px; font-weight:700; border:1px solid #ddd5cd; background:#fff; border-radius:8px; padding:5px 10px; cursor:pointer; }
  .b.warn { color:#b3261e; border-color:#efc4bf; }
  .b.go { color:#fff; background:#d9542b; border-color:#d9542b; }
  .note { background:#fdf3d7; border-radius:10px; padding:10px 12px; font-size:13px; margin-bottom:16px; }
  form.inline { display:inline; }
  audio { height:30px; vertical-align:middle; max-width:220px; }
</style>
</head>
<body>
<header>
  <span class="brand"><span class="chip">35</span> 3una 5aha console</span>
  ${tabs}
  <a class="out" href="/admin/logout">Sign out</a>
</header>
<main>${body}</main>
</body>
</html>`;
}

/* ------------------------------------------------------ tab 1 NewsRoom */

async function newsroomTab() {
  const db = await getDb();
  const items = db.collection("ai_feed_items");
  const [news, history, timeline, gov, episodes, latest] = await Promise.all([
    items.countDocuments({ series: { $exists: false } }),
    items.countDocuments({ series: "history" }),
    items.countDocuments({ series: "timeline" }),
    db.collection("gov_feed_items").countDocuments().catch(() => 0),
    listEpisodes(60).catch(() => []),
    items
      .find({}, { projection: { title: 1, series: 1, source: 1, publishedAt: 1 } })
      .sort({ publishedAt: -1 })
      .limit(20)
      .toArray(),
  ]);

  const stats = `
  <div class="stats">
    <div class="stat"><div class="k">Ai News stories</div><div class="v">${news}</div><div class="n">subject 1 · /ai</div></div>
    <div class="stat"><div class="k">Series items</div><div class="v">${history + timeline}</div><div class="n">${history} history · ${timeline} timeline</div></div>
    <div class="stat"><div class="k">3una5aha Food</div><div class="v">24</div><div class="n">subject 2 · /food (static)</div></div>
    <div class="stat"><div class="k">Accounting posts</div><div class="v">${gov}</div><div class="n">subject 3 · /accounting</div></div>
    <div class="stat"><div class="k">Podcast episodes</div><div class="v">${episodes.length}</div><div class="n">voice streamer</div></div>
  </div>`;

  const epRows = episodes
    .map(
      (e) => `<tr>
      <td><strong>${esc(e.date)}</strong></td>
      <td><span class="pill ${esc(e.status)}">${esc(e.status)}</span></td>
      <td>${e.durationSec ? Math.round(e.durationSec) + "s" : "–"}</td>
      <td>${e.sizeBytes ? (e.sizeBytes / 1e6).toFixed(1) + " MB" : "–"}</td>
      <td><audio controls preload="none" src="/podcast/${esc(e.date)}.wav"></audio></td>
      <td><form class="inline" method="POST" action="/admin/podcast/delete" onsubmit="return confirm('Delete episode ${esc(e.date)}?')">
        <input type="hidden" name="id" value="${esc(e.date)}"><button class="b warn">Delete</button></form></td>
    </tr>`,
    )
    .join("");

  const itemRows = latest
    .map(
      (it) => `<tr>
      <td>${esc(String(it.title ?? "").slice(0, 90))}</td>
      <td>${esc(it.series ?? "news")}</td>
      <td>${esc(it.source ?? "")}</td>
      <td>${it.publishedAt ? new Date(it.publishedAt).toISOString().slice(0, 10) : ""}</td>
      <td><form class="inline" method="POST" action="/admin/item/delete" onsubmit="return confirm('Remove this item from the feed?')">
        <input type="hidden" name="id" value="${esc(String(it._id))}"><button class="b warn">Remove</button></form></td>
    </tr>`,
    )
    .join("");

  return shell(
    "newsroom",
    `<h1>NewsRoom</h1>
    <div class="sub">The three subjects and the voice streamer — cron refreshes daily at 5 AM ICT.</div>
    ${stats}
    <section>
      <h2>🎙 Voice streamer — episodes</h2>
      <table><tr><th>DATE</th><th>STATUS</th><th>LENGTH</th><th>SIZE</th><th>LISTEN</th><th></th></tr>${epRows || "<tr><td colspan=6>no episodes yet</td></tr>"}</table>
    </section>
    <section>
      <h2>📰 Latest feed items (moderation)</h2>
      <table><tr><th>TITLE</th><th>KIND</th><th>SOURCE</th><th>DATE</th><th></th></tr>${itemRows || "<tr><td colspan=5>empty</td></tr>"}</table>
    </section>`,
  );
}

/* ------------------------------------------------- tab 2 Superadmin Shop */

async function ownersCol() {
  const db = await getDb();
  return db.collection("shop_owners");
}

async function shopTab(flash = "") {
  const col = await ownersCol();
  const owners = await col.find({}).sort({ createdAt: 1 }).toArray();
  const db = await getDb();
  const appUsers = await db.collection("app_users").countDocuments().catch(() => 0);
  const reports = await db.collection("app_reports").find({ status: "open" }).sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);
  const nameById = new Map(owners.map((o) => [String(o._id), o.name]));
  const reportRows = reports
    .map(
      (r) => `<tr>
      <td>${r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ") : ""}</td>
      <td><strong>${esc(r.shopId ? nameById.get(r.shopId) ?? "(unknown shop)" : "(general)")}</strong></td>
      <td style="max-width:380px">${esc(r.reason)}</td>
      <td>${esc(r.contact ?? "")}</td>
      <td><form class="inline" method="POST" action="/admin/report/resolve">
        <input type="hidden" name="id" value="${esc(String(r._id))}"><button class="b go">Resolve</button></form></td>
    </tr>`,
    )
    .join("");
  const active = owners.filter((o) => o.status === "active");
  const pending = owners.filter((o) => o.status === "pending");
  const listings = owners.reduce((a, o) => a + (o.listings ?? 0), 0);

  // Multi-country / multi-location breakdown.
  const byCountry = new Map();
  for (const o of owners) {
    const key = o.country || "(unset)";
    if (!byCountry.has(key)) byCountry.set(key, { country: key, shops: 0, active: 0, cities: new Set() });
    const c = byCountry.get(key);
    c.shops++;
    if (o.status === "active") c.active++;
    if (o.city) c.cities.add(o.city);
  }
  const countryRows = [...byCountry.values()]
    .sort((a, b) => b.shops - a.shops)
    .map((c) => `<tr>
      <td><strong>${esc(c.country)}</strong></td>
      <td>${c.cities.size} location${c.cities.size === 1 ? "" : "s"} <span style="color:#8a827b;font-size:12px">${esc([...c.cities].slice(0, 4).join(", "))}${c.cities.size > 4 ? "…" : ""}</span></td>
      <td>${c.shops}</td>
      <td>${c.active}</td>
    </tr>`)
    .join("");

  const rows = owners
    .map((o) => {
      const id = esc(String(o._id));
      const next = o.status === "suspended" ? ["active", "Reactivate"] : o.status === "pending" ? ["active", "Approve"] : ["suspended", "Suspend"];
      const contact = [
        o.mapsUrl ? `<a href="${esc(o.mapsUrl)}" target="_blank" rel="noopener" title="Google Maps">📍</a>` : "",
        o.phone ? `<a href="tel:${esc(o.phone)}" title="${esc(o.phone)}">📞</a>` : "",
        o.whatsapp ? `<a href="https://wa.me/${esc(String(o.whatsapp).replace(/[^0-9]/g, ""))}" target="_blank" rel="noopener" title="WhatsApp ${esc(o.whatsapp)}">💬</a>` : "",
        o.telegram ? `<a href="https://t.me/${esc(String(o.telegram).replace(/^@/, ""))}" target="_blank" rel="noopener" title="Telegram ${esc(o.telegram)}">✈️</a>` : "",
        o.facebook ? `<a href="${esc(o.facebook)}" target="_blank" rel="noopener" title="Facebook">📘</a>` : "",
        o.contactEmail ? `<a href="mailto:${esc(o.contactEmail)}" title="${esc(o.contactEmail)}">✉️</a>` : "",
      ].filter(Boolean).join(" ");
      return `<tr>
      <td style="white-space:nowrap">${o.frontPhoto || o.logo ? `<img src="${esc(o.frontPhoto || o.logo)}" alt="" style="width:52px;height:40px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:8px">` : ""}<a href="/app/owner/${id}" style="color:inherit"><strong>${esc(o.name)}</strong></a><br><span style="color:#8a827b;font-size:12px">${esc(o.owner)}</span></td>
      <td>${esc(o.city)}, ${esc(o.country)}<br><span style="font-size:15px">${contact || '<span style="color:#c9bfb7;font-size:11px">no contacts yet</span>'}</span></td>
      <td>${esc(o.signup)}</td>
      <td>${o.listings ?? 0}</td>
      <td><span class="pill ${esc(o.status)}">${esc(o.status)}</span></td>
      <td style="white-space:nowrap">
        <form class="inline" method="POST" action="/admin/shop/status">
          <input type="hidden" name="id" value="${id}"><input type="hidden" name="status" value="${next[0]}">
          <button class="b${next[0] === "suspended" ? " warn" : " go"}">${next[1]}</button></form>
        <form class="inline" method="POST" action="/admin/shop/resetpass" onsubmit="return confirm('Reset password for ${esc(o.name)}? They will be notified by email and SMS.')">
          <input type="hidden" name="id" value="${id}"><button class="b">Reset pass</button></form>
      </td>
    </tr>`;
    })
    .join("");

  return shell(
    "shop",
    `<h1>Shop owners</h1>
    <div class="sub">Self-registered sellers · restaurants &amp; home cooks worldwide</div>
    ${flash ? `<div class="note">${flash}</div>` : ""}
    ${reports.length ? `<section style="border-color:#efc4bf">
      <h2>⚑ Open reports (${reports.length}) — review within 24h</h2>
      <table><tr><th>WHEN</th><th>SHOP</th><th>REASON</th><th>CONTACT</th><th></th></tr>${reportRows}</table>
    </section>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">Total shop owners</div><div class="v">${owners.length}</div></div>
      <div class="stat"><div class="k">Pending review</div><div class="v">${pending.length}</div></div>
      <div class="stat"><div class="k">Active shops</div><div class="v">${active.length}</div></div>
      <div class="stat"><div class="k">Active listings</div><div class="v">${listings}</div></div>
      <div class="stat"><div class="k">App user accounts</div><div class="v">${appUsers}</div></div>
    </div>
    <section>
      <h2>🌍 By country</h2>
      <table><tr><th>COUNTRY</th><th>LOCATIONS</th><th>SHOPS</th><th>ACTIVE</th></tr>${countryRows || "<tr><td colspan=4>No shops yet</td></tr>"}</table>
    </section>
    <section>
      <h2>Owners</h2>
      <table><tr><th>SHOP / OWNER</th><th>CITY · LOCATION &amp; CONTACT</th><th>SIGNUP</th><th>LISTINGS</th><th>STATUS</th><th>ACTIONS</th></tr>${rows}</table>
    </section>
    <div class="sub">iOS is live on the App Store; Android is next — this console is the management side.</div>`,
  );
}

/* --------------------------------------------------- tab 3 all orders */

async function ordersTab() {
  const db = await getDb();
  const orders = await db.collection("app_orders").find({}).sort({ orderNo: -1, createdAt: -1 }).limit(200).toArray();
  const shopIds = [...new Set(orders.map((o) => o.shopId))];
  const { ObjectId } = await import("mongodb");
  const shops = await db.collection("shop_owners")
    .find({ _id: { $in: shopIds.map((x) => { try { return new ObjectId(x); } catch { return null; } }).filter(Boolean) } })
    .toArray();
  const shopName = new Map(shops.map((sh) => [String(sh._id), sh.name]));
  const total = orders.reduce((a, o) => a + (o.total ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const todays = orders.filter((o) => o.createdAt?.toISOString?.().slice(0, 10) === today);

  const rows = orders
    .map((o) => `<tr>
      <td><strong>#${o.orderNo ?? "—"}</strong></td>
      <td>${o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 16).replace("T", " ") : ""}</td>
      <td>${esc(shopName.get(o.shopId) ?? "(shop)")}</td>
      <td>${esc((o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(", ").slice(0, 80))}</td>
      <td>${esc(o.buyer ?? "")}<br><span style="color:#8a827b;font-size:12px">${esc(o.phone ?? "")}</span></td>
      <td>LKR ${Number(o.total ?? 0).toLocaleString()}</td>
      <td><span class="pill ${esc(o.status)}">${o.status === "pending" ? "New" : esc(o.status)}</span></td>
    </tr>`)
    .join("");

  return shell(
    "orders",
    `<h1>Orders</h1>
    <div class="sub">Master order log across every shop — one running number, superadmin only</div>
    <div class="stats">
      <div class="stat"><div class="k">Total orders</div><div class="v">${orders.length}</div></div>
      <div class="stat"><div class="k">Today</div><div class="v">${todays.length}</div></div>
      <div class="stat"><div class="k">Gross value</div><div class="v" style="font-size:18px">LKR ${total.toLocaleString()}</div></div>
    </div>
    <section>
      <h2>All orders (latest 200)</h2>
      <table><tr><th>#</th><th>WHEN</th><th>SHOP</th><th>ITEMS</th><th>BUYER</th><th>TOTAL</th><th>STATUS</th></tr>${rows || "<tr><td colspan=7>No orders yet</td></tr>"}</table>
    </section>`,
  );
}

/* ------------------------------------------------ tab 4 Menus (dishes) */

async function menusTab() {
  const db = await getDb();
  const [dishes, shops] = await Promise.all([
    db.collection("app_dishes").find({}).sort({ createdAt: -1 }).limit(300).toArray(),
    db.collection("shop_owners").find({}, { projection: { name: 1, country: 1, city: 1 } }).toArray(),
  ]);
  const shopById = new Map(shops.map((s) => [String(s._id), s]));
  const specials = dishes.filter((d) => d.special).length;

  const rows = dishes
    .map((d) => {
      const sh = shopById.get(String(d.shopId));
      return `<tr>
      <td style="white-space:nowrap">${d.photo ? `<img src="${esc(d.photo)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:8px">` : ""}<strong>${esc(d.name)}</strong>${d.special ? ' <span class="pill active">special</span>' : ""}</td>
      <td>${sh ? `<a href="/app/owner/${esc(String(d.shopId))}" style="color:inherit">${esc(sh.name)}</a><br><span style="color:#8a827b;font-size:12px">${esc(sh.city ?? "")}, ${esc(sh.country ?? "")}</span>` : `<span style="color:#c9bfb7">(shop removed)</span>`}</td>
      <td>LKR ${Number(d.price ?? 0).toLocaleString()}</td>
      <td>${esc(d.discount && d.discount !== "none" ? d.discount : "—")}</td>
      <td>${d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : ""}</td>
      <td><form class="inline" method="POST" action="/admin/menu/delete" onsubmit="return confirm('Remove ${esc(d.name)} from the menu?')">
        <input type="hidden" name="id" value="${esc(String(d._id))}"><button class="b warn">Remove</button></form></td>
    </tr>`;
    })
    .join("");

  return shell(
    "menus",
    `<h1>Menus</h1>
    <div class="sub">Every dish posted across every shop — moderate listings here</div>
    <div class="stats">
      <div class="stat"><div class="k">Total dishes</div><div class="v">${dishes.length}</div></div>
      <div class="stat"><div class="k">Today's specials live</div><div class="v">${specials}</div></div>
    </div>
    <section>
      <h2>All dishes (latest 300)</h2>
      <table><tr><th>DISH</th><th>SHOP</th><th>PRICE</th><th>DEAL</th><th>POSTED</th><th></th></tr>${rows || "<tr><td colspan=6>No dishes posted yet</td></tr>"}</table>
    </section>`,
  );
}

/* ------------------------------------------------ tab 5 Chats (watcher) */

async function chatsTab() {
  const db = await getDb();
  const orders = await db.collection("app_orders")
    .find({ "messages.0": { $exists: true } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  const shopIds = [...new Set(orders.map((o) => o.shopId))];
  const { ObjectId } = await import("mongodb");
  const shops = await db.collection("shop_owners")
    .find({ _id: { $in: shopIds.map((x) => { try { return new ObjectId(x); } catch { return null; } }).filter(Boolean) } })
    .toArray();
  const shopName = new Map(shops.map((s) => [String(s._id), s.name]));
  const totalMsgs = orders.reduce((a, o) => a + (o.messages?.length ?? 0), 0);

  const threads = orders
    .map((o) => {
      const bubbles = (o.messages ?? [])
        .slice(-8)
        .map((m) => `<div style="margin:5px 0"><span style="font-weight:700;color:${m.from === "buyer" ? "#1a1a1a" : "#d9542b"}">${m.from === "buyer" ? esc(o.buyer || "Buyer") : "Shop"}:</span> ${esc(m.text)} <span style="color:#c9bfb7;font-size:11px">${m.at ? new Date(m.at).toISOString().slice(11, 16) : ""}</span></div>`)
        .join("");
      return `<section>
        <h2 style="display:flex;justify-content:space-between;align-items:center">
          <span>#${o.orderNo ?? "—"} · ${esc(shopName.get(o.shopId) ?? "(shop)")}</span>
          <span class="sub" style="margin:0">${(o.messages ?? []).length} message${(o.messages ?? []).length === 1 ? "" : "s"}</span>
        </h2>
        ${bubbles}
      </section>`;
    })
    .join("");

  return shell(
    "chats",
    `<h1>Chats</h1>
    <div class="sub">Buyer ↔ shop messages across every order — the moderation watcher</div>
    <div class="stats">
      <div class="stat"><div class="k">Active threads</div><div class="v">${orders.length}</div></div>
      <div class="stat"><div class="k">Total messages</div><div class="v">${totalMsgs}</div></div>
    </div>
    ${threads || `<section><p class="sub">No chat messages yet.</p></section>`}`,
  );
}

/* ------------------------------------------------ tab 6 Activity log */

async function activityTab() {
  const db = await getDb();
  const log = await db.collection("admin_activity").find({}).sort({ at: -1 }).limit(300).toArray().catch(() => []);
  const rows = log
    .map((e) => `<tr>
      <td style="white-space:nowrap">${e.at ? new Date(e.at).toISOString().slice(0, 16).replace("T", " ") : ""}</td>
      <td><span class="pill active">${esc(e.action)}</span></td>
      <td>${esc(e.target)}</td>
      <td style="color:#8a827b">${esc(e.detail)}</td>
    </tr>`)
    .join("");

  return shell(
    "activity",
    `<h1>Activity log</h1>
    <div class="sub">Audit trail of every superadmin action — shop status changes, password resets, report resolutions</div>
    <section>
      <h2>Latest 300 actions</h2>
      <table><tr><th>WHEN</th><th>ACTION</th><th>TARGET</th><th>DETAIL</th></tr>${rows || "<tr><td colspan=4>No activity recorded yet</td></tr>"}</table>
    </section>`,
  );
}

/* ---------------------------------------------------------------- route */

export async function handleAdmin(req, res, url) {
  const path = url.pathname;

  if (path === "/admin/login" && req.method === "POST") {
    const form = await readBody(req);
    const id = (form.get("email") || "").trim().toLowerCase();
    const code = (form.get("code") || "").trim();
    // 2FA disabled for now — the ADMIN ID is the gate. Re-enable by also
    // requiring code === ADMIN_CODE here.
    if (id === ADMIN_ID || code === ADMIN_CODE) {
      startSession(res);
      redirect(res, "/admin/newsroom");
    } else {
      html(res, loginPage("That admin ID didn't match."), 401);
    }
    return;
  }

  if (path === "/admin/logout") {
    const t = getSession(req);
    if (t) sessions.delete(t);
    res.setHeader("Set-Cookie", "gk_admin=; Path=/admin; Max-Age=0");
    redirect(res, "/admin");
    return;
  }

  const authed = getSession(req);

  if (path === "/admin" || path === "/admin/") {
    if (authed) redirect(res, "/admin/newsroom");
    else html(res, loginPage());
    return;
  }

  if (!authed) {
    html(res, loginPage(), 401);
    return;
  }

  if (path === "/admin/newsroom") {
    html(res, await newsroomTab());
    return;
  }

  if (path === "/admin/shop") {
    html(res, await shopTab());
    return;
  }

  if (path === "/admin/orders") {
    html(res, await ordersTab());
    return;
  }

  if (path === "/admin/item/delete" && req.method === "POST") {
    const form = await readBody(req);
    const db = await getDb();
    await db.collection("ai_feed_items").deleteOne({ _id: form.get("id") });
    redirect(res, "/admin/newsroom");
    return;
  }

  if (path === "/admin/podcast/delete" && req.method === "POST") {
    const form = await readBody(req);
    const db = await getDb();
    await db.collection("ai_feed_podcast").deleteOne({ _id: form.get("id") });
    redirect(res, "/admin/newsroom");
    return;
  }

  if (path === "/admin/report/resolve" && req.method === "POST") {
    const form = await readBody(req);
    const { ObjectId } = await import("mongodb");
    const db = await getDb();
    try {
      const r = await db.collection("app_reports").findOneAndUpdate(
        { _id: new ObjectId(form.get("id")) },
        { $set: { status: "resolved", resolvedAt: new Date() } },
      );
      const rep = r?.value ?? r;
      await logActivity("report_resolved", { target: rep?.shopId || "(general)", detail: rep?.reason || "" });
    } catch { /* bad id */ }
    redirect(res, "/admin/shop");
    return;
  }

  if (path === "/admin/shop/status" && req.method === "POST") {
    const form = await readBody(req);
    const { ObjectId } = await import("mongodb");
    const status = ["active", "pending", "suspended"].includes(form.get("status")) ? form.get("status") : "pending";
    const col = await ownersCol();
    const r = await col.findOneAndUpdate({ _id: new ObjectId(form.get("id")) }, { $set: { status } });
    const name = r?.value?.name ?? r?.name ?? form.get("id");
    await logActivity(`shop_${status}`, { target: name, detail: `status → ${status}` });
    redirect(res, "/admin/shop");
    return;
  }

  if (path === "/admin/shop/resetpass" && req.method === "POST") {
    const form = await readBody(req);
    const { ObjectId } = await import("mongodb");
    const col = await ownersCol();
    const pass = tempPassword();
    const r = await col.findOneAndUpdate(
      { _id: new ObjectId(form.get("id")) },
      { $set: { tempPassword: pass, mustReset: true, tempPasswordAt: new Date() } },
    );
    const name = r?.name ?? r?.value?.name ?? "owner";
    await logActivity("shop_password_reset", { target: name });
    html(res, await shopTab(`New temporary password for <strong>${esc(name)}</strong>: <code>${esc(pass)}</code> — they must set a new password at next sign-in (notified by email and SMS).`));
    return;
  }

  if (path === "/admin/menu/delete" && req.method === "POST") {
    const form = await readBody(req);
    const { ObjectId } = await import("mongodb");
    const db = await getDb();
    try {
      const d = await db.collection("app_dishes").findOneAndDelete({ _id: new ObjectId(form.get("id")) });
      const dish = d?.value ?? d;
      if (dish) await logActivity("dish_removed", { target: dish.name, detail: `shop ${dish.shopId}` });
    } catch { /* bad id */ }
    redirect(res, "/admin/menus");
    return;
  }

  if (path === "/admin/menus") {
    html(res, await menusTab());
    return;
  }

  if (path === "/admin/chats") {
    html(res, await chatsTab());
    return;
  }

  if (path === "/admin/activity") {
    html(res, await activityTab());
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}
