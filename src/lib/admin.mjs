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

const ADMIN_CODE = process.env.ADMIN_CODE || "555555";
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
  body { min-height:100vh; display:flex; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#191512; color:#e6edf3; }
  .left { flex:1.1; display:flex; flex-direction:column; justify-content:space-between; padding:36px 40px; background:#191512; }
  .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:19px; color:#fff; }
  .brand .chip { background:#e05a33; color:#fff; border-radius:9px; padding:4px 8px; font-size:15px; }
  .hero h1 { font-size:clamp(34px,5vw,52px); line-height:1.08; letter-spacing:-.02em; color:#fff; }
  .hero p { color:#a99d94; margin-top:14px; max-width:340px; font-size:15px; }
  .foot { color:#6f655d; font-size:12.5px; }
  .right { flex:1; background:#faf7f4; color:#1a1a1a; border-radius:26px 0 0 26px; display:flex; align-items:center; justify-content:center; padding:32px; }
  .card { width:100%; max-width:340px; }
  .card h2 { font-size:26px; letter-spacing:-.01em; }
  .card .sub { color:#6b6560; font-size:14px; margin:4px 0 22px; }
  label { display:block; font-size:11px; font-weight:700; letter-spacing:.08em; color:#6b6560; margin:16px 0 6px; }
  input[type=email], input[type=password] { width:100%; padding:12px 13px; font-size:15px; border:1.5px solid #ddd5cd; border-radius:10px; background:#fff; }
  input:focus { outline:none; border-color:#e05a33; }
  .code { display:flex; gap:8px; }
  .code input { width:44px; height:50px; text-align:center; font-size:20px; font-weight:700; border:1.5px solid #ddd5cd; border-radius:10px; background:#fff; }
  .hint { font-size:12px; color:#8a827b; margin-top:6px; }
  .err { background:#fdecea; color:#b3261e; border-radius:10px; padding:10px 12px; font-size:13.5px; margin-bottom:6px; }
  button { width:100%; margin-top:22px; padding:14px; font-size:15.5px; font-weight:700; color:#fff; background:#d9542b; border:0; border-radius:12px; cursor:pointer; }
  button:hover { background:#c4471f; }
  .forgot { display:block; text-align:center; color:#8a827b; font-size:13px; margin-top:14px; text-decoration:none; }
  @media (max-width:760px){ body{flex-direction:column} .right{border-radius:26px 26px 0 0} .hero{margin:34px 0} }
</style>
</head>
<body>
  <div class="left">
    <div class="brand"><span class="chip">35</span> 3una 5aha</div>
    <div class="hero">
      <h1>System<br>management<br>console</h1>
      <p>NewsRoom (Ai brief · 3 subjects · voice streamer) and the worldwide Sri Lankan food marketplace.</p>
    </div>
    <div class="foot">Restricted access · super admins only</div>
  </div>
  <div class="right">
    <form class="card" method="POST" action="/admin/login" id="f">
      <h2>Sign in</h2>
      <div class="sub">Use your admin credentials</div>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <label>EMAIL</label>
      <input type="email" name="email" value="admin@3una5aha.app" autocomplete="username">
      <label>PASSWORD</label>
      <input type="password" name="password" placeholder="••••••••••" autocomplete="current-password">
      <label>2FA CODE</label>
      <div class="code" id="code">
        ${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="1" data-i="${i}" autocomplete="off">`).join("")}
      </div>
      <div class="hint">From your authenticator app</div>
      <input type="hidden" name="code" id="codeVal">
      <button type="submit">Sign in to console</button>
      <a class="forgot" href="/admin">Forgot password?</a>
    </form>
  </div>
<script>
  const boxes = [...document.querySelectorAll('#code input')];
  boxes[0].focus();
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      b.value = b.value.replace(/\\D/g, '').slice(0, 1);
      if (b.value && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus();
    });
    b.addEventListener('paste', (e) => {
      const t = (e.clipboardData.getData('text') || '').replace(/\\D/g, '');
      if (t.length > 1) {
        e.preventDefault();
        t.split('').slice(0, 6).forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
        boxes[Math.min(t.length, 5)].focus();
      }
    });
  });
  document.getElementById('f').addEventListener('submit', () => {
    document.getElementById('codeVal').value = boxes.map((b) => b.value).join('');
  });
</script>
</body>
</html>`;
}

/* ------------------------------------------------------- console shell */

function shell(tab, body) {
  const tabs = [
    ["newsroom", "NewsRoom"],
    ["shop", "Superadmin Shop"],
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

const SAMPLE_OWNERS = [
  { name: "Kamatha Kitchen", owner: "Nimasha Perera", email: "hello@kamatha.lk", city: "Melbourne", country: "AU", signup: "Email", listings: 18, status: "active" },
  { name: "Serendib Spice Co.", owner: "Saman Silva", email: "saman@serendibspice.lk", city: "Colombo", country: "LK", signup: "Google", listings: 32, status: "active" },
  { name: "Pol Sambol House", owner: "Anoma Herath", email: "anoma@polsambol.house", city: "London", country: "GB", signup: "Email", listings: 9, status: "pending" },
  { name: "Achcharu Corner", owner: "Ruwan Jayasuriya", email: "ruwan@achcharu.corner", city: "Toronto", country: "CA", signup: "Email", listings: 21, status: "active" },
  { name: "Hela Kitchen (home cook)", owner: "Dilini Fernando", email: "dilini@hela.kitchen", city: "Dubai", country: "AE", signup: "Email", listings: 6, status: "pending" },
  { name: "Lanka Curry Hut", owner: "Mohamed Rizwan", email: "rizwan@lankacurry.hut", city: "Doha", country: "QA", signup: "Google", listings: 14, status: "suspended" },
];

async function ownersCol() {
  const db = await getDb();
  const col = db.collection("shop_owners");
  if ((await col.countDocuments()) === 0) {
    await col.insertMany(SAMPLE_OWNERS.map((o) => ({ ...o, createdAt: new Date(), sample: true })));
  }
  return col;
}

async function shopTab(flash = "") {
  const col = await ownersCol();
  const owners = await col.find({}).sort({ createdAt: 1 }).toArray();
  const active = owners.filter((o) => o.status === "active");
  const pending = owners.filter((o) => o.status === "pending");
  const listings = owners.reduce((a, o) => a + (o.listings ?? 0), 0);

  const rows = owners
    .map((o) => {
      const id = esc(String(o._id));
      const next = o.status === "suspended" ? ["active", "Reactivate"] : o.status === "pending" ? ["active", "Approve"] : ["suspended", "Suspend"];
      return `<tr>
      <td><strong>${esc(o.name)}</strong><br><span style="color:#8a827b;font-size:12px">${esc(o.owner)}</span></td>
      <td>${esc(o.city)}, ${esc(o.country)}</td>
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
    <div class="stats">
      <div class="stat"><div class="k">Total shop owners</div><div class="v">${owners.length}</div></div>
      <div class="stat"><div class="k">Pending review</div><div class="v">${pending.length}</div></div>
      <div class="stat"><div class="k">Active shops</div><div class="v">${active.length}</div></div>
      <div class="stat"><div class="k">Active listings</div><div class="v">${listings}</div></div>
    </div>
    <section>
      <h2>Owners</h2>
      <table><tr><th>SHOP / OWNER</th><th>CITY</th><th>SIGNUP</th><th>LISTINGS</th><th>STATUS</th><th>ACTIONS</th></tr>${rows}</table>
    </section>
    <div class="sub">iOS shop app + real owner sign-in come next — this console is the management side.</div>`,
  );
}

/* ---------------------------------------------------------------- route */

export async function handleAdmin(req, res, url) {
  const path = url.pathname;

  if (path === "/admin/login" && req.method === "POST") {
    const form = await readBody(req);
    const code = (form.get("code") || "").trim();
    if (code === ADMIN_CODE) {
      startSession(res);
      redirect(res, "/admin/newsroom");
    } else {
      html(res, loginPage("That code didn't match. Check your authenticator and try again."), 401);
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

  if (path === "/admin/shop/status" && req.method === "POST") {
    const form = await readBody(req);
    const { ObjectId } = await import("mongodb");
    const status = ["active", "pending", "suspended"].includes(form.get("status")) ? form.get("status") : "pending";
    const col = await ownersCol();
    await col.updateOne({ _id: new ObjectId(form.get("id")) }, { $set: { status } });
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
    html(res, await shopTab(`New temporary password for <strong>${esc(name)}</strong>: <code>${esc(pass)}</code> — they must set a new password at next sign-in (notified by email and SMS).`));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}
