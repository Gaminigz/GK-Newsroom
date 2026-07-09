/**
 * 3una 5aha — the spice marketplace mobile app (design: "3una 5aha All
 * Screens" rows 2 & 3). Mounted by serve-web.mjs on /app.
 *
 * Installable mobile web app (PWA-style standalone) on the same stack —
 * the iOS/Android native shells come later; the seams (Mongo collections,
 * routes) are already real:
 *
 *   Buyer (design 3.x)
 *   GET  /app                     3.1 welcome — browse as guest works now
 *   GET  /app/home                3.3 what's cooking nearby — promos + shops
 *   GET  /app/shop/<id>           3.5 shop page — dishes, basket, order
 *   POST /app/order               create order (items + name/phone/pickup)
 *   GET  /app/order/<id>          3.6 order chat — buyer ⇄ shop, card inline
 *   POST /app/order/<id>/message  append chat message
 *   GET  /app/orders              my orders (by phone cookie)
 *   GET  /app/location            3.7 set your location (manual v1)
 *
 *   Shop owner (design 2.x)
 *   GET  /app/owner/<id>          2.1 dashboard — open toggle, orders, chats
 *   POST /app/owner/<id>/toggle   open / closed
 *   POST /app/owner/<id>/order-status   New → Preparing → Done
 *   GET  /app/owner/<id>/add-dish 2.2 add a dish කෑමක් එකතු
 *   POST /app/owner/<id>/publish  publish dish → shows on shop page + promos
 *
 * Collections: shop_owners (shared with /admin), app_dishes, app_orders.
 */

import crypto from "node:crypto";
import { getDb } from "./mongo.ts";

const ORANGE = "#d9542b";

/* ------------------------------------------------------------- helpers */

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

async function readForm(req, limit) {
  return new URLSearchParams(await readBody(req, limit));
}

function redirect(res, to) {
  res.writeHead(303, { Location: to });
  res.end();
}

function html(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((p) => p.trim().split("=").map(decodeURIComponent)).filter((p) => p[0]),
  );
}

function lkr(n) {
  return "LKR " + Number(n ?? 0).toLocaleString("en-US");
}

/** Dish thumbnail — real photo when the owner uploaded one, emoji tile otherwise. */
function dishThumb(d, extra = "", emoji = "🍛") {
  return d?.photo
    ? `<div class="thumb" style="${extra};background-image:url(${d.photo});background-size:cover;background-position:center"></div>`
    : `<div class="thumb" style="${extra}">${emoji}</div>`;
}

/** Shop logo thumb — uploaded logo when present, emoji tile otherwise. */
function shopThumb(shop, extra = "", emoji = "🍲") {
  return shop?.logo
    ? `<div class="thumb" style="${extra};background-image:url(${shop.logo});background-size:cover;background-position:center"></div>`
    : `<div class="thumb" style="${extra}">${emoji}</div>`;
}

async function oid(id) {
  const { ObjectId } = await import("mongodb");
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- data */

async function col(name) {
  const db = await getDb();
  return db.collection(name);
}

async function activeShops() {
  return (await col("shop_owners")).find({ status: "active" }).sort({ listings: -1 }).toArray();
}

async function shopById(id) {
  const _id = await oid(id);
  return _id ? (await col("shop_owners")).findOne({ _id }) : null;
}

async function dishesFor(shopId) {
  return (await col("app_dishes")).find({ shopId: String(shopId) }).sort({ createdAt: -1 }).toArray();
}

/* ---------------------------------------------------------------- shell */

function shell({ title, body, nav = "", back = "", noPad = false, backFloat = false, noBack = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#faf7f4">
<link rel="manifest" href="/app/manifest.json">
<title>${esc(title)}</title>
<style>
  * { box-sizing:border-box; margin:0; -webkit-tap-highlight-color:transparent; }
  body { background:#faf7f4; color:#1a1a1a; font:15.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         max-width:480px; margin:0 auto; min-height:100vh;
         padding:${noPad ? "0" : "14px 20px"}; padding-top:calc(env(safe-area-inset-top, 0px) + 10px); padding-bottom:84px; }
  a { color:inherit; text-decoration:none; }
  h1 { font-size:24px; letter-spacing:-.02em; }
  .si { color:#b3672f; font-weight:400; font-size:.82em; }
  .sub { color:#6b6560; font-size:13.5px; }
  .row { display:flex; align-items:center; gap:10px; }
  .chiprow { display:flex; gap:8px; overflow-x:auto; padding:12px 0; scrollbar-width:none; }
  .chip { flex:0 0 auto; border:1px solid #e0d6cc; background:#fff; border-radius:99px; padding:7px 14px; font-size:13px; font-weight:600; color:#4a443f; }
  .chip.on { background:#191512; border-color:#191512; color:#fff; }
  .card { background:#fff; border:1px solid #ece3da; border-radius:16px; padding:13px 14px; margin-bottom:11px; display:block; }
  .pill { display:inline-block; border-radius:99px; padding:2px 9px; font-size:11px; font-weight:700; }
  .pill.deal { background:${ORANGE}; color:#fff; }
  .pill.new { background:${ORANGE}; color:#fff; }
  .pill.preparing { background:#fdf3d7; color:#946200; }
  .pill.pending { background:#fdf3d7; color:#946200; }
  .pill.done { background:#e3f4e6; color:#1d7a34; }
  .pill.today { background:${ORANGE}; color:#fff; }
  .btn { display:block; width:100%; text-align:center; padding:14px; font-size:15.5px; font-weight:700; color:#fff; background:${ORANGE}; border:0; border-radius:13px; cursor:pointer; }
  .btn.ghost { background:#fff; color:#1a1a1a; border:1.5px solid #e0d6cc; }
  .btn.dark { background:#191512; }
  .btn.fb { background:#1877f2; }
  input[type=text], input[type=tel], input[type=number], input[type=password], select {
    width:100%; padding:12px 13px; font-size:15px; border:1.5px solid #ddd5cd; border-radius:11px; background:#fff; }
  input:focus, select:focus { outline:none; border-color:${ORANGE}; }
  label { display:block; font-size:11px; font-weight:700; letter-spacing:.07em; color:#6b6560; margin:14px 0 6px; }
  .thumb { width:52px; height:52px; border-radius:12px; background:#f0e7de; display:flex; align-items:center; justify-content:center; font-size:22px; flex:0 0 auto; }
  .nav { position:fixed; bottom:0; left:50%; transform:translateX(-50%); width:100%; max-width:480px;
         background:#fffdfb; border-top:1px solid #ece3da; display:flex; padding:8px 0 max(10px, env(safe-area-inset-bottom)); }
  .nav a { flex:1; text-align:center; font-size:11px; color:#8a827b; font-weight:600; }
  .nav a .i { display:block; font-size:19px; margin-bottom:1px; }
  .nav a.on { color:${ORANGE}; }
  .back { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:99px; background:#fff; border:1px solid #ece3da; margin-bottom:10px; }
  .back.float { position:absolute; z-index:10; top:calc(env(safe-area-inset-top, 0px) + 10px); left:20px; margin:0; box-shadow:0 2px 8px #0003; }
  .basketbar { position:fixed; bottom:74px; left:50%; transform:translateX(-50%); width:calc(100% - 40px); max-width:440px;
               background:#191512; color:#fff; border-radius:14px; padding:14px 16px; display:none; justify-content:space-between; font-weight:700; }
  .stat { background:#fff; border:1px solid #ece3da; border-radius:14px; padding:11px 13px; flex:1; }
  .stat .k { color:#6b6560; font-size:11.5px; }
  .stat .v { font-size:20px; font-weight:800; }
  .toggle { position:relative; width:52px; height:30px; flex:0 0 auto; }
  .toggle input { display:none; }
  .toggle span { position:absolute; inset:0; border-radius:99px; background:#d8cfc6; transition:.15s; }
  .toggle span:after { content:""; position:absolute; top:3px; left:3px; width:24px; height:24px; border-radius:99px; background:#fff; transition:.15s; }
  .toggle input:checked + span { background:#2f9e44; }
  .toggle input:checked + span:after { left:25px; }
  .seg { display:flex; gap:8px; flex-wrap:wrap; }
  .seg .opt { border:1.5px solid #ddd5cd; background:#fff; border-radius:99px; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
  .seg input { display:none; }
  .seg input:checked + .opt, .seg .opt.on { background:#191512; color:#fff; border-color:#191512; }
  .bubble { max-width:78%; border-radius:16px; padding:9px 13px; margin-bottom:8px; font-size:14.5px; }
  .bubble.buyer { background:#191512; color:#fff; margin-left:auto; border-bottom-right-radius:5px; }
  .bubble.shop { background:#fff; border:1px solid #ece3da; border-bottom-left-radius:5px; }
  .ok { background:#e3f4e6; color:#1d7a34; border-radius:11px; padding:9px 12px; font-size:13.5px; font-weight:600; }
</style>
</head>
<body>
${noBack ? "" : `<a class="back${backFloat ? " float" : ""}" href="${back ? esc(back) : "/app"}" onclick="${back ? "" : "if(history.length>1){history.back();return false}"}">‹</a>`}
${body}
${nav}
</body>
</html>`;
}

function buyerNav(on) {
  const items = [
    ["home", "/app/home", "⌂", "Home"],
    ["orders", "/app/orders", "▤", "Orders"],
    ["location", "/app/location", "◎", "Location"],
    ["profile", "/app", "○", "Profile"],
  ];
  return `<nav class="nav">${items
    .map(([k, href, i, label]) => `<a href="${href}" class="${k === on ? "on" : ""}"><span class="i">${i}</span>${label}</a>`)
    .join("")}</nav>`;
}

/* -------------------------------------------------------- 3.1 welcome */

const SUPPORT = {
  email: "gk.smart@ggmt.sg",
  telegram: "https://t.me/GKSmartbiz",
  whatsapp: "https://wa.me/6585565977",
  whatsappLabel: "+65 8556 5977",
};

function supportLinks() {
  // Logo-only — no address or number in the visible page (anti-spam).
  const b = "display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:99px";
  return `<div class="row" style="gap:12px;justify-content:center">
    <a style="${b};background:#6b6560" href="mailto:${SUPPORT.email}" aria-label="Email support">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="#fff" stroke-width="2"/><path d="M3 7l9 6 9-6" stroke="#fff" stroke-width="2" fill="none"/></svg></a>
    <a style="${b};background:#229ED9" href="${SUPPORT.telegram}" target="_blank" rel="noopener" aria-label="Telegram support">
      <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#fff" d="M21.9 4.1c.3-1.1-.8-1.6-1.7-1.2L2.6 9.7c-1.1.4-1.1 1.6 0 1.9l4.5 1.4 1.7 5.3c.3.9 1.4 1.1 2 .4l2.4-2.3 4.6 3.4c.8.6 2 .2 2.2-.8l2-14.9zM8.5 12.6l9.3-5.7c.4-.2.8.3.4.6l-7.6 7-.3 3.2-1.8-5.1z"/></svg></a>
    <a style="${b};background:#25D366" href="${SUPPORT.whatsapp}" target="_blank" rel="noopener" aria-label="WhatsApp support">
      <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#fff" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.6-6.1c-.3-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8 1-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4 0-.5.1-.7l.5-.6c.1-.2.1-.3 0-.5l-.8-1.9c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.9.9-1.1 2.2-.2 3.9a11.6 11.6 0 0 0 4.5 4.3c1.7.8 2.5.9 3.3.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.5-.2z"/></svg></a>
  </div>`;
}

function legalFooter() {
  return `<div class="sub" style="font-size:12px;margin-top:22px;text-align:center">
    <a href="/app/terms" style="text-decoration:underline">Terms of Service</a> ·
    <a href="/app/privacy" style="text-decoration:underline">Privacy Policy</a> ·
    <a href="/app/support" style="text-decoration:underline">Support &amp; Contact</a>
  </div>`;
}

function welcomePage(req) {
  const c = cookies(req ?? { headers: {} });
  const myShop = c.app_shop;
  const loggedIn = c.app_user;
  const loginBtn = (via, style, svg, label) => `
    <form method="POST" action="/app/login">
      <input type="hidden" name="via" value="${via}">
      <button class="btn ${style}" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 6px;font-size:15px">${svg}${label}</button>
    </form>`;
  return shell({
    title: "3una 5aha — find Sri Lankan food near you",
    backFloat: true,
    body: `
    <div style="text-align:center">
      <img src="/assets/hero-welcome.jpg?v=2" alt="Sri Lankan spices and rice &amp; curry"
           style="width:calc(100% + 40px);margin:calc(-1 * (env(safe-area-inset-top, 0px) + 10px)) -20px 14px;aspect-ratio:16/10;object-fit:cover;border-radius:0 0 26px 26px;display:block"
           onerror="this.remove()">
      <h1 style="font-size:30px"><span style="color:${ORANGE}">3</span>una <span style="color:${ORANGE}">5</span>aha <span style="font-weight:800">· තුන පහ</span></h1>
      <p class="sub" style="max-width:330px;margin:8px auto 4px;font-size:14.5px">
        <strong>Find Sri Lankan restaurants and home cooking near you.</strong> A non-commercial
        community app where Sri Lankan restaurants and home cooks post their
        dishes, deals and daily activities — so travellers anywhere in the
        world can find real Sri Lankan food nearby.</p>
      <div style="margin:16px 0 6px;display:grid;grid-template-columns:1fr 1fr;gap:9px">
      ${loginBtn("google", "ghost", `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2 3.7-5 3.7-8.6z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1L1.3 17.2C3.3 21.2 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.3 6.8C.5 8.4 0 10.1 0 12s.5 3.6 1.3 5.2l3.8-2.9z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l2.7-2.7C16.9 1.2 14.2 0 12 0 7.3 0 3.3 2.8 1.3 6.8l3.8 2.9c1-3 3.7-5 6.9-5z"/></svg>`, "Google")
          + loginBtn("facebook", "fb", `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>`, "Facebook")
          + loginBtn("apple", "dark", `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8 2.2-1.2 3-2.4c.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.6-3.9zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>`, "Apple")
          + loginBtn("email", "ghost", "✉️", "Email")
          + loginBtn("sms", "ghost", "💬", "SMS")
          + `<a class="btn ghost" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 6px;font-size:15px" href="/app/home">👀 Guest</a>`}
      </div>
      <div class="sub" style="font-size:12.5px;margin:12px 0 8px">Support requests — email, Telegram or WhatsApp:</div>
      ${supportLinks()}
      ${legalFooter()}
      <div class="sub" style="font-size:11.5px;margin-top:8px">By continuing you agree to our Terms &amp; Privacy Policy</div>
      <div class="sub" style="font-size:11.5px;margin-top:4px">Published by <a href="https://www.ggmt.sg" target="_blank" rel="noopener" style="text-decoration:underline;font-weight:700">www.ggmt.sg</a> · GGMT PTE. LTD.</div>
    </div>`,
  });
}

/* ------------------------------------------------ email test login */

function emailLoginPage(error = "") {
  return shell({
    title: "Sign in with email — 3una 5aha",
    back: "/app",
    body: `
    <h1>Sign in with email</h1>
    <div class="sub" style="margin:4px 0 6px">Development accounts — shop: <code>a@a.com</code> · user: <code>aa@a.com</code> · password <code>111111</code></div>
    ${error ? `<div class="card" style="background:#fdecea;border-color:#efc4bf;color:#b3261e">${esc(error)}</div>` : ""}
    <form method="POST" action="/app/login-email">
      <label>EMAIL</label>
      <input type="text" name="email" required placeholder="a@a.com" autocomplete="username">
      <label>PASSWORD</label>
      <input type="password" name="password" required placeholder="••••••" autocomplete="current-password">
      <button class="btn" style="margin-top:18px">Sign in</button>
    </form>`,
  });
}

/* --------------------------------------------------- legal & support */

function legalShell(title, body) {
  return shell({
    title: `${title} — 3una 5aha`,
    back: "/app",
    body: `<h1 style="font-size:21px">${esc(title)}</h1>
    <div class="sub" style="margin-bottom:14px">3una 5aha · published by <a href="https://www.ggmt.sg" target="_blank" rel="noopener" style="text-decoration:underline">www.ggmt.sg</a> (GGMT PTE. LTD., Singapore) · last updated 9 July 2026</div>
    <div class="card" style="line-height:1.65">${body}</div>
    ${legalFooter()}`,
  });
}

function termsPage() {
  return legalShell("Terms of Service", `
    <p><strong>1. The service.</strong> 3una 5aha is a <strong>non-commercial community platform</strong> that hosts Sri Lankan restaurants and home cooks ("shops") who post their business activities — dishes, daily specials, deals and events — so travellers and locals can find Sri Lankan food nearby, based on their location. Listing is free: 3una 5aha charges no fees and takes no commission. Shops prepare and sell food directly to buyers; 3una 5aha provides the listing, discovery, ordering and chat platform and is not the seller, preparer or deliverer of any food.</p>
    <p style="margin-top:10px"><strong>2. Accounts.</strong> Browsing needs no account. Shops register with contact details and are live immediately. We may suspend or remove any shop or user that breaks these terms, posts objectionable content, or harms the community — without prior notice.</p>
    <p style="margin-top:10px"><strong>3. User content &amp; zero tolerance.</strong> Dish listings, photos and chat messages are user-generated. Objectionable content, abuse, fraud or illegal goods are not tolerated. Report any content or user via <a href="/app/support" style="text-decoration:underline">Support</a> — reports are reviewed within 24 hours and offending content or users removed or blocked.</p>
    <p style="margin-top:10px"><strong>4. Orders &amp; payment.</strong> Orders are agreements between buyer and shop. Payment is settled directly with the shop at pickup unless stated otherwise. Prices are set by shops in their local currency.</p>
    <p style="margin-top:10px"><strong>5. Food safety.</strong> Shops are solely responsible for food safety, hygiene, allergen information and compliance with their local food regulations.</p>
    <p style="margin-top:10px"><strong>6. Liability.</strong> The service is provided "as is". To the maximum extent permitted by law, GK SMART is not liable for indirect or consequential loss arising from use of the platform.</p>
    <p style="margin-top:10px"><strong>7. Changes.</strong> We may update these terms; continued use means acceptance. Questions: <a href="mailto:${SUPPORT.email}" style="text-decoration:underline">${SUPPORT.email}</a>.</p>`);
}

function privacyPage() {
  return legalShell("Privacy Policy", `
    <p><strong>What we collect.</strong> Buyers: name, phone number, city and order/chat history — only what you enter when ordering. Shops: shop name, owner name, email, phone, city and listings. No payment card data is collected or stored. No advertising trackers, no analytics SDKs, no selling of data — ever.</p>
    <p style="margin-top:10px"><strong>Why.</strong> Solely to run the marketplace: showing nearby shops, passing your order and pickup chat to the shop, and letting shops manage their menu.</p>
    <p style="margin-top:10px"><strong>Where it lives.</strong> Data is stored in MongoDB Atlas (cloud database) and served via Railway (hosting). It is visible only to you, the shop you order from, and the 3una 5aha operators.</p>
    <p style="margin-top:10px"><strong>Location.</strong> With your permission, your approximate location is used for one purpose only: showing Sri Lankan restaurants and today's deals near you. It is kept as a cookie on your device, never stored on our servers with your identity, and never shared or sold.</p>
    <p style="margin-top:10px"><strong>Cookies.</strong> A small number of functional cookies only (your city/coordinates, your phone for order history, your shop id, your sign-in choice). No tracking cookies.</p>
    <p style="margin-top:10px"><strong>Your rights &amp; account deletion.</strong> You can request a copy of your data, correction, or <strong>full deletion of your account and data</strong> at any time — email <a href="mailto:${SUPPORT.email}?subject=Account%20deletion%20request" style="text-decoration:underline">${SUPPORT.email}</a> or message us on <a href="${SUPPORT.telegram}" style="text-decoration:underline">Telegram</a> / <a href="${SUPPORT.whatsapp}" style="text-decoration:underline">WhatsApp</a>. Deletion is completed within 30 days.</p>
    <p style="margin-top:10px"><strong>Children.</strong> The service is not directed at children under 13.</p>
    <p style="margin-top:10px"><strong>Contact.</strong> Data controller: GK SMART (GGMT PTE. LTD., Singapore) · <a href="mailto:${SUPPORT.email}" style="text-decoration:underline">${SUPPORT.email}</a>.</p>`);
}

function supportPage() {
  return legalShell("Support & Contact", `
    <p><strong>Support requests — buyers and restaurant owners.</strong> All support goes through these three channels (email, Telegram, WhatsApp): tech support, order problems, password/access recovery, reports of bad content or behaviour, account deletion.</p>
    <p style="margin-top:12px">✉️ Email: <a href="mailto:${SUPPORT.email}" style="text-decoration:underline;font-weight:700">${SUPPORT.email}</a><br>
    ✈️ Telegram: <a href="${SUPPORT.telegram}" style="text-decoration:underline;font-weight:700">@GKSmartbiz</a><br>
    💬 WhatsApp: <a href="${SUPPORT.whatsapp}" style="text-decoration:underline;font-weight:700">${SUPPORT.whatsappLabel}</a></p>
    <p style="margin-top:12px"><strong>Lost access to your shop?</strong> Email us from your registered address and we restore your dashboard link. <strong>Account deletion:</strong> one message, done within 30 days. <strong>Reporting content:</strong> tell us the shop or order — reviewed within 24 hours.</p>`);
}

/* ----------------------------------------------------------- 3.3 home */

async function homePage(req) {
  const c = cookies(req);
  const city = c.app_city || (c.app_geo ? "Near you" : "Set location");
  const shops = await activeShops();
  const specials = await (await col("app_dishes"))
    .find({ special: true })
    .sort({ createdAt: -1 })
    .limit(8)
    .toArray();
  const shopName = new Map(shops.map((s) => [String(s._id), s.name]));

  const promoCards = specials
    .map(
      (d) => `<a class="card" style="flex:0 0 190px;margin:0" href="/app/shop/${esc(d.shopId)}">
      <span class="pill deal">${d.discount && d.discount !== "none" ? esc(d.discount) : "Special"}</span>
      ${dishThumb(d, "width:100%;height:84px;margin:9px 0")}
      <strong style="font-size:14px">${esc(d.name)}</strong>
      <div class="sub" style="font-size:12px">${esc(shopName.get(d.shopId) ?? "")} · ${esc(d.window ?? "today")}</div>
    </a>`,
    )
    .join("");

  const shopCards = (
    await Promise.all(
      shops.map(async (s) => {
        const dishes = await dishesFor(s._id);
        const deal = dishes.find((d) => d.discount && d.discount !== "none");
        return `<a class="card row" href="/app/shop/${String(s._id)}">
        ${shopThumb(s)}
        <div style="flex:1">
          <strong>${esc(s.name)}</strong> ${deal ? `<span class="pill deal">${esc(deal.discount)}</span>` : ""}
          <div class="sub" style="font-size:12.5px">★ 4.${(String(s._id).charCodeAt(10) % 5) + 4} · ${esc(s.city)} · ${dishes.length || s.listings || 0} dishes</div>
          <div class="sub" style="font-size:12.5px;color:#1d7a34">${s.open === false ? "Closed now" : "Open now"}</div>
        </div><span style="color:#c9bfb7">›</span>
      </a>`;
      }),
    )
  ).join("");

  return shell({
    title: "3una 5aha — what's cooking nearby?",
    nav: buyerNav("home"),
    noBack: true,
    body: `
    <div class="row" style="justify-content:space-between">
      <a href="/app/location"><span style="color:${ORANGE}">●</span> <strong style="font-size:13.5px">${esc(city)}</strong> <span class="sub">▾</span></a>
      <span class="pill" style="background:#191512;color:#fff;padding:6px 13px">Shop</span>
    </div>
    <div class="sub si" style="margin-top:12px">ආයුබෝවන් · Ayubowan</div>
    <h1>What's cooking nearby?</h1>
    <form action="/app/home" style="margin:12px 0 0"><input type="text" name="q" placeholder="🔍 Search dishes, shops, spices…"></form>
    <div class="chiprow">
      <span class="chip on">Nearby</span><span class="chip">Today's special</span><span class="chip">Promotions</span><span class="chip">Open now</span>
    </div>
    <div class="row" style="justify-content:space-between"><strong>Today's promotions <span class="si">අද විශේෂ</span></strong><a class="sub" href="#">See all</a></div>
    <div class="chiprow" style="align-items:stretch">${promoCards || `<span class="sub">No specials yet — shop owners publish them from their dashboard.</span>`}</div>
    <div class="row" style="justify-content:space-between;margin-top:4px"><strong>Nearby restaurants</strong><span class="sub">near your location</span></div>
    <div style="margin-top:10px">${shopCards || `<span class="sub">No open restaurants yet.</span>`}</div>
    <script>
      // Geo capture: remembers coordinates so deals/restaurants can be
      // sorted by real distance (Google Maps wiring lands with native GPS).
      if (!document.cookie.includes("app_geo=") && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          document.cookie = "app_geo=" + pos.coords.latitude.toFixed(3) + "," + pos.coords.longitude.toFixed(3) + "; path=/app; max-age=86400; SameSite=Lax";
        }, () => {}, { timeout: 8000 });
      }
    </script>`,
  });
}

/* ------------------------------------------------------ 3.5 shop page */

async function shopPage(id) {
  const shop = await shopById(id);
  if (!shop) return null;
  const dishes = await dishesFor(shop._id);
  const special = dishes.find((d) => d.special);

  const dishRows = dishes
    .filter((d) => !d.special)
    .map(
      (d) => `<div class="card row">
      ${dishThumb(d)}
      <div style="flex:1">
        <strong style="font-size:14.5px">${esc(d.name)}</strong>${d.nameSi ? ` <span class="si">${esc(d.nameSi)}</span>` : ""}
        <div class="sub" style="font-size:12.5px">Available ${esc(d.window ?? "all day")}</div>
        <strong style="font-size:13.5px">${lkr(d.price)}</strong>
      </div>
      <button class="btn" style="width:38px;padding:8px 0;border-radius:11px" onclick='add(${JSON.stringify(String(d._id))},${JSON.stringify(d.name)},${Number(d.price) || 0})'>+</button>
    </div>`,
    )
    .join("");

  return shell({
    title: `${shop.name} — 3una 5aha`,
    back: "/app/home",
    backFloat: true,
    nav: buyerNav("home"),
    body: `
    ${shopThumb(shop, "width:calc(100% + 40px);height:150px;font-size:34px;margin:calc(-1 * (env(safe-area-inset-top, 0px) + 10px)) -20px 0;border-radius:0 0 22px 22px", "🍛")}
    <h1 style="margin-top:12px">${esc(shop.name)} <span class="si">කෑම</span></h1>
    <div class="sub">★ 4.8 · ${esc(shop.city)}, ${esc(shop.country)} · ${shop.open === false ? "closed now" : "open now"}</div>
    ${special ? `
    <div class="card" style="margin-top:14px">
      <span class="pill today">TODAY</span> <strong style="font-size:13.5px">Today's special package <span class="si">අද විශේෂ</span></strong>
      <div class="row" style="margin-top:10px">
        ${dishThumb(special, "", "🎁")}
        <div style="flex:1">
          <strong>${esc(special.name)}</strong>
          <div class="sub" style="font-size:12.5px">${esc(special.nameSi ?? "")}</div>
          <strong style="color:${ORANGE}">${lkr(special.price)}</strong> <span class="sub">· ${esc(special.window ?? "today")}</span>
        </div>
        <button class="btn" style="width:38px;padding:8px 0;border-radius:11px" onclick='add(${JSON.stringify(String(special._id))},${JSON.stringify(special.name)},${Number(special.price) || 0})'>+</button>
      </div>
    </div>` : ""}
    <strong style="display:block;margin:14px 0 10px">Popular dishes</strong>
    ${dishRows || `<div class="sub">No dishes published yet.</div>`}

    <div class="sub" style="text-align:center;margin:16px 0"><a href="/app/report?shop=${String(shop._id)}" style="text-decoration:underline">⚑ Report this shop</a></div>
    <div class="basketbar" id="bar" onclick="checkout()"><span id="barL">View basket</span><span id="barR"></span></div>

    <div id="sheet" style="display:none;position:fixed;inset:0;background:rgba(20,15,10,.45);z-index:9" onclick="if(event.target===this)this.style.display='none'">
      <form method="POST" action="/app/order" style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#faf7f4;border-radius:22px 22px 0 0;padding:20px 18px 30px">
        <strong style="font-size:17px">Confirm pickup order</strong>
        <div class="sub" id="sum" style="margin:6px 0 2px"></div>
        <input type="hidden" name="shopId" value="${String(shop._id)}">
        <input type="hidden" name="items" id="itemsField">
        <label>YOUR NAME</label><input type="text" name="buyer" required placeholder="Nimal P.">
        <label>PHONE</label><input type="tel" name="phone" required placeholder="+61 412 555 210">
        <label>PICKUP TIME</label><input type="text" name="pickupAt" placeholder="7:00 PM" value="7:00 PM">
        <button class="btn" style="margin-top:18px">Place order · <span id="sheetTotal"></span></button>
      </form>
    </div>
<script>
  const basket = [];
  function add(id, name, price) {
    const f = basket.find((b) => b.id === id);
    if (f) f.qty++; else basket.push({ id, name, price, qty: 1 });
    render();
  }
  function render() {
    const n = basket.reduce((a, b) => a + b.qty, 0);
    const t = basket.reduce((a, b) => a + b.qty * b.price, 0);
    const bar = document.getElementById('bar');
    bar.style.display = n ? 'flex' : 'none';
    document.getElementById('barL').textContent = 'View basket · ' + n + ' item' + (n > 1 ? 's' : '');
    document.getElementById('barR').textContent = 'LKR ' + t.toLocaleString();
  }
  function checkout() {
    document.getElementById('itemsField').value = JSON.stringify(basket);
    document.getElementById('sum').textContent = basket.map((b) => b.qty + '× ' + b.name).join(' · ');
    document.getElementById('sheetTotal').textContent = 'LKR ' + basket.reduce((a, b) => a + b.qty * b.price, 0).toLocaleString();
    document.getElementById('sheet').style.display = 'block';
  }
</script>`,
  });
}

/* ------------------------------------------------- 3.6 order + chat */

async function orderPage(id, asShop = false) {
  const _id = await oid(id);
  const order = _id ? await (await col("app_orders")).findOne({ _id }) : null;
  if (!order) return null;
  const shop = await shopById(order.shopId);

  const items = (order.items ?? [])
    .map((it) => `<div class="row" style="justify-content:space-between;font-size:13.5px"><span>${it.qty}× ${esc(it.name)}</span><strong>${lkr(it.qty * it.price)}</strong></div>`)
    .join("");

  const msgs = (order.messages ?? [])
    .map((m) => `<div class="bubble ${m.from === "buyer" ? "buyer" : "shop"}">${esc(m.text)}</div>`)
    .join("");

  return shell({
    title: `Order — ${shop?.name ?? ""}`,
    noBack: true,
    nav: asShop ? "" : buyerNav("orders"),
    body: `
    <div class="row">
      <a class="back" style="margin:0" href="${asShop ? `/app/owner/${esc(order.shopId)}` : "/app/orders"}">‹</a>
      <div class="thumb" style="width:42px;height:42px">🍲</div>
      <div><strong>${esc(shop?.name ?? "Shop")}</strong><div class="sub" style="font-size:12px;color:#1d7a34">● Online · replies in ~5 min</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row" style="justify-content:space-between"><strong style="color:${ORANGE};font-size:13px">ORDER #${String(order._id).slice(-4).toUpperCase()}</strong><span class="pill ${esc(order.status)}">${esc(order.status)}</span></div>
      <div style="margin-top:8px">${items}</div>
      <div class="row" style="justify-content:space-between;border-top:1px solid #f0e7de;margin-top:8px;padding-top:8px"><strong>Total</strong><strong style="color:${ORANGE}">${lkr(order.total)}</strong></div>
    </div>
    ${order.status === "done" ? `<div class="ok">✓ Order completed${order.pickupAt ? ` — picked up ${esc(order.pickupAt)}` : ""}</div>` : order.confirmedAt ? `<div class="ok">✓ Order confirmed for ${esc(order.pickupAt ?? "pickup")}</div>` : ""}
    <div style="margin:16px 0">${msgs || `<div class="sub">Say hello — ask about pickup time or extras.</div>`}</div>
    <form method="POST" action="/app/order/${String(order._id)}/message" class="row">
      <input type="hidden" name="from" value="${asShop ? "shop" : "buyer"}">
      ${asShop ? `<input type="hidden" name="as" value="shop">` : ""}
      <input type="text" name="text" required placeholder="Message ${esc(asShop ? (order.buyer ?? "buyer") : (shop?.name ?? "shop"))}…" style="flex:1">
      <button class="btn" style="width:46px;padding:11px 0;border-radius:99px">➤</button>
    </form>`,
  });
}

async function ordersPage(req) {
  const c = cookies(req);
  const phone = c.app_phone;
  const list = phone
    ? await (await col("app_orders")).find({ phone }).sort({ createdAt: -1 }).limit(20).toArray()
    : [];
  const shops = new Map((await (await col("shop_owners")).find({}).toArray()).map((s) => [String(s._id), s.name]));
  const rows = list
    .map(
      (o) => `<a class="card row" href="/app/order/${String(o._id)}">
      <div class="thumb">🧾</div>
      <div style="flex:1"><strong>${esc(shops.get(o.shopId) ?? "Shop")}</strong>
        <div class="sub" style="font-size:12.5px">${(o.items ?? []).reduce((a, b) => a + b.qty, 0)} items · ${lkr(o.total)}</div></div>
      <span class="pill ${esc(o.status)}">${esc(o.status)}</span>
    </a>`,
    )
    .join("");
  return shell({
    title: "My orders — 3una 5aha",
    nav: buyerNav("orders"),
    noBack: true,
    body: `<h1>My orders</h1><div class="sub" style="margin-bottom:14px">Pickup orders from this phone</div>
    ${rows || `<div class="sub">No orders yet — find a shop on <a href="/app/home" style="color:${ORANGE};font-weight:700">Home</a>.</div>`}`,
  });
}

/* ------------------------------------------------- 3.7 set location */

function locationPage(req) {
  const c = cookies(req);
  return shell({
    title: "Set your location — 3una 5aha",
    nav: buyerNav("location"),
    noBack: true,
    body: `
    <h1>Set your location</h1>
    <div class="sub si">ඔබේ ස්ථානය සකසන්න</div>
    <p class="sub" style="margin:8px 0 4px">Find Sri Lankan food anywhere in the world — search your suburb or city.</p>
    <form method="POST" action="/app/location">
      <label>CITY / SUBURB</label>
      <input type="text" name="city" value="${esc(c.app_city ?? "")}" placeholder="Melbourne VIC, Australia">
      <label>CONTACT NUMBER FOR ORDERS</label>
      <input type="tel" name="phone" value="${esc(c.app_phone ?? "")}" placeholder="+61 412 555 210">
      <div class="thumb" style="width:100%;height:150px;margin:16px 0;font-size:13px;color:#8a827b">🗺 map search — native app phase</div>
      <button class="btn">Save &amp; continue</button>
    </form>`,
  });
}

/* ------------------------------------------------------ report abuse */

function reportPage(shop, sent = false) {
  return shell({
    title: "Report — 3una 5aha",
    back: shop ? `/app/shop/${String(shop._id)}` : "/app/home",
    body: sent
      ? `<div style="text-align:center;padding-top:12vh">
          <div style="font-size:44px">✅</div>
          <h1 style="margin-top:10px">Report received</h1>
          <p class="sub" style="max-width:280px;margin:10px auto">Thank you — the 3una 5aha team reviews reports within 24 hours and removes offending content or users.</p>
          <div style="margin-top:18px"><a class="btn" href="/app/home">Back to browsing</a></div>
        </div>`
      : `<h1>Report ${shop ? esc(shop.name) : "a problem"}</h1>
        <p class="sub" style="margin:6px 0 4px">Objectionable content, abuse, fraud or a food-safety concern — tell us what's wrong. Reviewed within 24 hours.</p>
        <form method="POST" action="/app/report">
          <input type="hidden" name="shopId" value="${shop ? String(shop._id) : ""}">
          <label>WHAT HAPPENED</label>
          <textarea name="reason" required rows="5" maxlength="1000" style="width:100%;padding:12px 13px;font-size:15px;border:1.5px solid #ddd5cd;border-radius:11px;background:#fff;font-family:inherit"></textarea>
          <label>YOUR CONTACT (OPTIONAL)</label>
          <input type="text" name="contact" placeholder="email or phone — for follow-up">
          <button class="btn" style="margin-top:18px">Send report</button>
        </form>`,
  });
}

/* --------------------------------------- shop owner registration */

function registerPage(error = "") {
  return shell({
    title: "Register your shop — 3una 5aha",
    back: "/app",
    body: `
    <h1>Register your shop</h1>
    <div class="sub si">ඔබේ කඩය ලියාපදිංචි කරන්න</div>
    <p class="sub" style="margin:8px 0 4px">Restaurants &amp; home cooks welcome — worldwide. Your shop is <strong>live immediately</strong>, no waiting. Need help? <a href="/app/support" style="text-decoration:underline">Support</a> is one tap away.</p>
    ${error ? `<div class="card" style="background:#fdecea;border-color:#efc4bf;color:#b3261e">${esc(error)}</div>` : ""}
    <form method="POST" action="/app/register">
      <label>SHOP NAME</label>
      <input type="text" name="name" required placeholder="Kamatha Kitchen">
      <label>YOUR NAME</label>
      <input type="text" name="owner" required placeholder="Nimasha Perera">
      <label>EMAIL</label>
      <input type="text" name="email" required placeholder="hello@kamatha.lk">
      <label>PHONE</label>
      <input type="tel" name="phone" placeholder="+61 412 555 210">
      <div class="row" style="gap:10px">
        <div style="flex:2"><label>CITY</label><input type="text" name="city" required placeholder="Melbourne"></div>
        <div style="flex:1"><label>COUNTRY</label><input type="text" name="country" required placeholder="AU" maxlength="2" style="text-transform:uppercase"></div>
      </div>
      <div class="row" style="margin-top:16px;gap:10px">
        <label class="chip" style="margin:0"><input type="radio" name="kind" value="restaurant" checked style="accent-color:${ORANGE}"> Restaurant</label>
        <label class="chip" style="margin:0"><input type="radio" name="kind" value="homecook" style="accent-color:${ORANGE}"> Home cook</label>
      </div>
      <button class="btn" style="margin-top:20px">Submit for review</button>
    </form>`,
  });
}

function registeredPage(shopId, name) {
  return shell({
    title: "Shop live — 3una 5aha",
    body: `
    <div style="text-align:center;padding-top:10vh">
      <div style="font-size:52px">🎉</div>
      <h1 style="margin-top:10px">${esc(name)} is LIVE!</h1>
      <p class="sub" style="max-width:300px;margin:10px auto 26px">Buyers nearby can already find you. Add your first dishes now — this browser stays signed in to your dashboard (lost the link? <a href="/app/support" style="text-decoration:underline">Support</a> restores it).</p>
      <a class="btn" href="/app/owner/${esc(shopId)}/add-dish">+ Add my first dish</a>
      <div style="margin-top:12px"><a href="/app/owner/${esc(shopId)}" style="font-weight:700">Open my shop dashboard →</a></div>
      <div style="margin-top:14px"><a class="sub" href="/app/home">← back to browsing</a></div>
    </div>`,
  });
}

/* -------------------------------------------- 2.1 owner dashboard */

async function ownerDash(id) {
  const shop = await shopById(id);
  if (!shop) return null;
  const orders = await (await col("app_orders")).find({ shopId: String(shop._id) }).sort({ createdAt: -1 }).limit(15).toArray();
  const today = new Date().toISOString().slice(0, 10);
  const todays = orders.filter((o) => o.createdAt?.toISOString?.().slice(0, 10) === today);
  const revenue = todays.reduce((a, o) => a + (o.total ?? 0), 0);
  const chats = orders.filter((o) => (o.messages ?? []).some((m) => m.from === "buyer")).length;
  const dishes = await dishesFor(shop._id);
  const special = dishes.find((d) => d.special);
  const open = shop.open !== false;

  const orderRows = orders
    .map((o) => {
      const nxt = o.status === "pending" ? ["preparing", "Start preparing"] : o.status === "preparing" ? ["done", "Mark done"] : null;
      return `<div class="card">
      <div class="row" style="justify-content:space-between">
        <a href="/app/order/${String(o._id)}?as=shop" style="flex:1">
          <strong style="font-size:14px">${(o.items ?? []).map((i) => `${i.qty}× ${esc(i.name)}`).join(" · ")}</strong>
          <div class="sub" style="font-size:12.5px">${esc(o.buyer ?? "")} · pickup ${esc(o.pickupAt ?? "")} · ${lkr(o.total)}</div>
        </a>
        <span class="pill ${esc(o.status)}">${o.status === "pending" ? "New" : esc(o.status)}</span>
      </div>
      ${nxt ? `<form method="POST" action="/app/owner/${String(shop._id)}/order-status" style="margin-top:9px">
        <input type="hidden" name="order" value="${String(o._id)}"><input type="hidden" name="status" value="${nxt[0]}">
        <button class="btn ghost" style="padding:9px">${nxt[1]}</button></form>` : ""}
    </div>`;
    })
    .join("");

  return shell({
    title: `${shop.name} — shop owner`,
    noBack: true,
    body: `
    <div class="row" style="gap:8px;margin-bottom:12px">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app" onclick="if(history.length>1){history.back();return false}">‹</a>
      <a class="row" href="/app/owner/${String(shop._id)}/profile" style="flex:1;min-width:0;gap:8px">${shopThumb(shop, "width:40px;height:40px")}
        <div style="min-width:0"><strong style="font-size:14px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(shop.name)} <span class="sub" style="font-size:11px">✏️</span></strong><div class="sub" style="font-size:11.5px">${esc(shop.owner || "")}</div></div></a>
      <form method="POST" action="/app/owner/${String(shop._id)}/toggle" class="row" style="gap:5px;flex:0 0 auto">
        <span class="sub" style="font-size:11.5px;font-weight:700;color:${open ? "#1d7a34" : "#b3261e"}">${open ? "Open" : "Closed"}</span>
        <label class="toggle"><input type="checkbox" ${open ? "checked" : ""} onchange="this.form.submit()"><span></span></label>
      </form>
      <a class="chip" href="/app/shop/${String(shop._id)}" style="flex:0 0 auto;padding:6px 11px;font-size:12px">Buyer view</a>
    </div>
    ${shop.status === "pending" ? `<div class="card" style="background:#fdf3d7;border-color:#efdba8"><strong style="color:#946200">⏳ Pending review</strong><div class="sub" style="font-size:12.5px">The 3una 5aha team is reviewing your shop. You can build your menu now — buyers see you once approved.</div></div>` : ""}
    ${shop.status === "suspended" ? `<div class="card" style="background:#fdecea;border-color:#efc4bf"><strong style="color:#b3261e">⛔ Suspended</strong><div class="sub" style="font-size:12.5px">Your shop is hidden from buyers. Contact support via /app/support.</div></div>` : ""}
    <strong style="display:block;margin:2px 0 10px">My dishes <span class="sub" style="font-weight:400">— tap a tile to edit, buyers see these</span></strong>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${Array.from({ length: 6 }, (_, i) => {
        const d = dishes[i];
        if (!d) return `<a href="/app/owner/${String(shop._id)}/add-dish" class="card" style="margin:0;padding:0;overflow:hidden;border-style:dashed;border-width:2px;text-align:center">
          <div style="aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8a827b;font-size:12.5px;padding:8px"><span style="font-size:26px">＋</span>Add your dish<br><span style="font-size:11px">photo · price · time</span></div></a>`;
        return `<a href="/app/owner/${String(shop._id)}/dish/${String(d._id)}" class="card" style="margin:0;padding:0;overflow:hidden;position:relative">
          <div style="aspect-ratio:4/3;background:#f0e7de ${d.photo ? `url(${d.photo}) center/cover` : ""};display:flex;align-items:center;justify-content:center;font-size:30px">${d.photo ? "" : "🍛"}</div>
          <span class="pill" style="position:absolute;top:7px;right:7px;background:#fff;border:1px solid #ece3da">✏️ Edit</span>
          ${d.special ? `<span class="pill deal" style="position:absolute;top:7px;left:7px">Special</span>` : ""}
          <div style="padding:8px 10px"><strong style="font-size:13px;line-height:1.3;display:block">${esc(d.name)}</strong>
          <div class="sub" style="font-size:12px">${lkr(d.price)}${d.discount && d.discount !== "none" ? ` · <span style=\"color:${ORANGE}\">${esc(d.discount)}</span>` : ""}</div></div></a>`;
      }).join("")}
    </div>
    ${orders.length ? `<div class="row" style="justify-content:space-between;margin-top:16px"><strong>Incoming orders</strong>
      <span class="sub" style="font-size:12px">today ${todays.length} · ${lkr(revenue)} · ${chats} chats</span></div>
    <div style="margin-top:10px">${orderRows}</div>` : ""}
    <div style="height:70px"></div>
    <a class="btn" style="position:fixed;bottom:calc(env(safe-area-inset-bottom, 0px) + 18px);right:max(20px,calc(50% - 220px));width:auto;padding:13px 20px;border-radius:99px" href="/app/owner/${String(shop._id)}/add-dish">+ Add dish</a>`,
  });
}

/* ---------------------------------------------- dish edit (full) */

function dishEditPage(shop, d) {
  const seg = (name, opts, current) => opts.map((o) =>
    `<label><input type="radio" name="${name}" value="${o}" ${String(current) === o ? "checked" : ""}><span class="opt">${o === "none" ? "None" : o}</span></label>`).join("");
  return shell({
    title: "Edit dish — " + d.name,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/owner/${String(shop._id)}">‹</a>
      <h1 style="font-size:21px">Edit dish</h1></div>
      <div class="card row" style="margin:10px 0 0;padding:10px 13px">
        <div style="flex:1"><strong style="font-size:14px">Today's special package</strong>
          <div class="sub" style="font-size:12px">Featured in the promotions row for buyers nearby</div></div>
        <label class="toggle"><input type="checkbox" name="special" value="1" form="dishEditForm" ${d.special ? "checked" : ""}><span></span></label>
      </div>
    <form method="POST" action="/app/owner/${String(shop._id)}/dish/${String(d._id)}" id="dishEditForm">
      <label for="photoIn" class="thumb" id="photoBox" style="width:100%;height:150px;margin:10px 0;font-size:13px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative;${d.photo ? `background-image:url(${d.photo})` : ""}"><span id="photoHint">${d.photo ? "" : "add dish photo — tap to use camera or library"}</span><span style="position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
      <input type="file" id="photoIn" accept="image/*" capture="environment" style="display:none">
      <input type="hidden" name="photo" id="photoData">
      <label>DISH NAME</label>
      <input type="text" name="name" required value="${esc(d.name)}">
      <label>SINHALA NAME (OPTIONAL)</label>
      <input type="text" name="nameSi" value="${esc(d.nameSi ?? "")}">
      <div class="row" style="gap:10px">
        <div style="flex:1"><label>PRICE (LKR)</label><input type="number" name="price" required min="0" value="${Number(d.price) || 0}"></div>
        <div style="flex:1"><label>PORTIONS / DAY</label><input type="number" name="portions" value="${Number(d.portions) || 20}" min="1"></div>
      </div>
      <label>AVAILABLE TIME</label>
      <div class="seg">${seg("window", ["11 AM - 3 PM", "5 - 9 PM", "All day"], d.window ?? "All day")}</div>
      <label>DISCOUNT</label>
      <div class="seg">${seg("discount", ["none", "-10%", "-20%", "2 for 1"], d.discount ?? "none")}</div>

      <div class="row" style="gap:10px;margin-top:18px">
        <button class="btn" style="flex:2">Save changes</button>
        <button class="btn ghost" style="flex:1;color:#b3261e" formaction="/app/owner/${String(shop._id)}/dish/${String(d._id)}/delete" onclick="return confirm('Remove this dish from your menu?')">Delete</button>
      </div>
    </form>
<script>
  document.getElementById('photoIn').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const max = 800;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.8);
      document.getElementById('photoData').value = data;
      const box = document.getElementById('photoBox');
      box.style.backgroundImage = 'url(' + data + ')';
      document.getElementById('photoHint').textContent = '';
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
</script>`,
  });
}

/* --------------------------------------------- shop profile edit */

function profilePage(shop) {
  return shell({
    title: "Shop profile — " + shop.name,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/owner/${String(shop._id)}">‹</a>
      <h1 style="font-size:21px">Shop profile</h1></div>
    <form method="POST" action="/app/owner/${String(shop._id)}/profile">
      <label>SHOP LOGO</label>
      <label for="logoIn" class="thumb" id="logoBox" style="width:110px;height:110px;font-size:13px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative;${shop.logo ? `background-image:url(${shop.logo})` : ""}"><span id="logoHint">${shop.logo ? "" : "tap to add"}</span><span style="position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
      <input type="file" id="logoIn" accept="image/*" style="display:none">
      <input type="hidden" name="logo" id="logoData">
      <label>SHOP NAME</label>
      <input type="text" name="name" required value="${esc(shop.name)}">
      <label>OWNER NAME</label>
      <input type="text" name="owner" value="${esc(shop.owner ?? "")}" placeholder="Your name">
      <button class="btn" style="margin-top:18px">Save profile</button>
    </form>
<script>
  document.getElementById('logoIn').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const side = Math.min(img.width, img.height);
      c.width = c.height = Math.min(400, side);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.8);
      document.getElementById('logoData').value = data;
      const box = document.getElementById('logoBox');
      box.style.backgroundImage = 'url(' + data + ')';
      document.getElementById('logoHint').textContent = '';
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
</script>`,
  });
}

/* ------------------------------------------------ 2.2 add a dish */

function addDishPage(shop) {
  return shell({
    title: "Add a dish — " + shop.name,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/owner/${String(shop._id)}">‹</a>
      <h1 style="font-size:21px">Add a dish <span class="si">කෑමක් එකතු</span></h1></div>
      <div class="card row" style="margin:10px 0 0;padding:10px 13px">
        <div style="flex:1"><strong style="font-size:14px">Today's special package</strong>
          <div class="sub" style="font-size:12px">Featured in the promotions row for buyers nearby</div></div>
        <label class="toggle"><input type="checkbox" name="special" value="1" form="dishForm"><span></span></label>
      </div>
    <form method="POST" action="/app/owner/${String(shop._id)}/publish" id="dishForm">
      <label for="photoIn" class="thumb" id="photoBox" style="width:100%;height:130px;margin:10px 0;font-size:13px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative"><span id="photoHint">add dish photo — tap to use camera or library</span><span style="position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
      <input type="file" id="photoIn" accept="image/*" capture="environment" style="display:none">
      <input type="hidden" name="photo" id="photoData">
      <label>DISH NAME</label>
      <input type="text" name="name" required placeholder="Ambul Thiyal (fish curry)">
      <label>SINHALA NAME (OPTIONAL)</label>
      <input type="text" name="nameSi" placeholder="අඹුල් තියල්">
      <div class="row" style="gap:10px">
        <div style="flex:1"><label>PRICE (LKR)</label><input type="number" name="price" required min="0" placeholder="950"></div>
        <div style="flex:1"><label>PORTIONS / DAY</label><input type="number" name="portions" value="20" min="1"></div>
      </div>
      <label>AVAILABLE TIME</label>
      <div class="seg">
        ${["11 AM - 3 PM", "5 - 9 PM", "All day"].map((w, i) => `<label><input type="radio" name="window" value="${w}" ${i === 0 ? "checked" : ""}><span class="opt">${w}</span></label>`).join("")}
      </div>
      <label>DISCOUNT</label>
      <div class="seg">
        ${["none", "-10%", "-20%", "2 for 1"].map((d, i) => `<label><input type="radio" name="discount" value="${d}" ${i === 0 ? "checked" : ""}><span class="opt">${d === "none" ? "None" : d}</span></label>`).join("")}
      </div>
      <button class="btn" style="margin-top:18px">Publish dish</button>
    </form>
<script>
  document.getElementById('photoIn').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const max = 800;
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.8);
      document.getElementById('photoData').value = data;
      const box = document.getElementById('photoBox');
      box.style.backgroundImage = 'url(' + data + ')';
      document.getElementById('photoHint').textContent = '';
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
</script>`,
  });
}

/* ---------------------------------------------------------------- route */

export async function handleApp(req, res, url) {
  const path = url.pathname;

  if (path === "/app/manifest.json") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
    res.end(JSON.stringify({
      name: "3una 5aha",
      short_name: "3una5aha",
      start_url: "/app/home",
      display: "standalone",
      background_color: "#faf7f4",
      theme_color: "#d9542b",
      icons: [],
    }));
    return;
  }

  if (path === "/app" || path === "/app/") {
    html(res, welcomePage(req));
    return;
  }

  if (path === "/app/report") {
    if (req.method === "POST") {
      const form = await readForm(req);
      const reason = String(form.get("reason") || "").trim().slice(0, 1000);
      if (reason) {
        await (await col("app_reports")).insertOne({
          shopId: String(form.get("shopId") || "").slice(0, 24) || null,
          reason,
          contact: String(form.get("contact") || "").slice(0, 80),
          status: "open",
          createdAt: new Date(),
        });
      }
      html(res, reportPage(null, true));
    } else {
      const shop = await shopById(url.searchParams.get("shop") || "");
      html(res, reportPage(shop));
    }
    return;
  }

  if (path === "/app/logout") {
    res.setHeader("Set-Cookie", "app_user=; Path=/app; Max-Age=0");
    redirect(res, "/app");
    return;
  }

  if (path === "/app/login" && req.method === "POST") {
    // Development: static sign-in — records the chosen provider and lands
    // on the deals page. Swapped for real OAuth/SMS in the native phase.
    const form = await readForm(req);
    const via = ["google", "facebook", "apple", "email", "sms"].includes(form.get("via")) ? form.get("via") : "guest";
    if (via === "email") {
      html(res, emailLoginPage());
      return;
    }
    res.setHeader("Set-Cookie", `app_user=${via}; Path=/app; Max-Age=31536000; SameSite=Lax`);
    redirect(res, "/app/home");
    return;
  }

  if (path === "/app/login-email" && req.method === "POST") {
    // Development test accounts — replaced by real auth in the native phase.
    const form = await readForm(req);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (password !== "111111" || !["a@a.com", "aa@a.com"].includes(email)) {
      html(res, emailLoginPage("Invalid credentials. Testing accounts: a@a.com (shop) or aa@a.com (user), password 111111."), 401);
      return;
    }
    if (email === "a@a.com") {
      // Shop test account — ensure its shop exists, land on the dashboard.
      const owners = await col("shop_owners");
      let shop = await owners.findOne({ email });
      if (!shop) {
        const r = await owners.insertOne({
          name: "Test Kitchen", owner: "Test Owner", email, phone: "",
          city: "Colombo", country: "LK", kind: "restaurant", signup: "Email",
          listings: 0, status: "active", open: true, createdAt: new Date(), testAccount: true,
        });
        shop = { _id: r.insertedId };
      }
      res.setHeader("Set-Cookie", [
        `app_user=email; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_shop=${String(shop._id)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
      ]);
      redirect(res, `/app/owner/${String(shop._id)}`);
    } else {
      res.setHeader("Set-Cookie", `app_user=email; Path=/app; Max-Age=31536000; SameSite=Lax`);
      redirect(res, "/app/home");
    }
    return;
  }

  if (path === "/app/terms") { html(res, termsPage()); return; }
  if (path === "/app/privacy") { html(res, privacyPage()); return; }
  if (path === "/app/support") { html(res, supportPage()); return; }

  if (path === "/app/home") {
    html(res, await homePage(req));
    return;
  }

  if (path === "/app/register") {
    if (req.method === "POST") {
      const form = await readForm(req);
      const name = String(form.get("name") || "").trim().slice(0, 80);
      const owner = String(form.get("owner") || "").trim().slice(0, 60);
      const email = String(form.get("email") || "").trim().slice(0, 80);
      if (!name || !owner || !email) {
        html(res, registerPage("Shop name, your name and email are required."), 400);
        return;
      }
      const dupe = await (await col("shop_owners")).findOne({ email });
      if (dupe) {
        html(res, registerPage("A shop with this email already exists — check with the 3una 5aha team."), 409);
        return;
      }
      const r = await (await col("shop_owners")).insertOne({
        name,
        owner,
        email,
        phone: String(form.get("phone") || "").slice(0, 24),
        city: String(form.get("city") || "").trim().slice(0, 40),
        country: String(form.get("country") || "").trim().toUpperCase().slice(0, 2),
        kind: form.get("kind") === "homecook" ? "homecook" : "restaurant",
        signup: "App",
        listings: 0,
        // Auto-approved: shops are live immediately; admin only blocks
        // (suspends) on rule-breaking or via a support request.
        status: "active",
        open: true,
        createdAt: new Date(),
      });
      // Auto-login: the owner's browser remembers their shop.
      res.setHeader("Set-Cookie", `app_shop=${String(r.insertedId)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
      html(res, registeredPage(String(r.insertedId), name));
    } else {
      html(res, registerPage());
    }
    return;
  }

  let m = path.match(/^\/app\/shop\/([a-f0-9]{24})$/);
  if (m) {
    const page = await shopPage(m[1]);
    if (page) { html(res, page); return; }
  }

  if (path === "/app/order" && req.method === "POST") {
    const form = await readForm(req);
    let items = [];
    try { items = JSON.parse(form.get("items") || "[]"); } catch { /* empty basket */ }
    items = items
      .filter((i) => i && i.name && Number(i.qty) > 0)
      .map((i) => ({ name: String(i.name).slice(0, 80), qty: Math.min(Number(i.qty), 50), price: Number(i.price) || 0 }));
    if (!items.length) { redirect(res, "/app/home"); return; }
    const phone = String(form.get("phone") || "").slice(0, 24);
    const doc = {
      shopId: String(form.get("shopId") || ""),
      items,
      total: items.reduce((a, i) => a + i.qty * i.price, 0),
      buyer: String(form.get("buyer") || "").slice(0, 60),
      phone,
      pickupAt: String(form.get("pickupAt") || "").slice(0, 24),
      status: "pending",
      messages: [],
      createdAt: new Date(),
    };
    const r = await (await col("app_orders")).insertOne(doc);
    res.setHeader("Set-Cookie", `app_phone=${encodeURIComponent(phone)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
    redirect(res, `/app/order/${r.insertedId}`);
    return;
  }

  m = path.match(/^\/app\/order\/([a-f0-9]{24})$/);
  if (m) {
    const page = await orderPage(m[1], url.searchParams.get("as") === "shop");
    if (page) { html(res, page); return; }
  }

  m = path.match(/^\/app\/order\/([a-f0-9]{24})\/message$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const from = form.get("from") === "shop" ? "shop" : "buyer";
    const text = String(form.get("text") || "").slice(0, 500).trim();
    const _id = await oid(m[1]);
    if (text && _id) {
      await (await col("app_orders")).updateOne({ _id }, { $push: { messages: { from, text, at: new Date() } } });
    }
    redirect(res, `/app/order/${m[1]}${form.get("as") === "shop" ? "?as=shop" : ""}`);
    return;
  }

  if (path === "/app/orders") {
    html(res, await ordersPage(req));
    return;
  }

  if (path === "/app/location") {
    if (req.method === "POST") {
      const form = await readForm(req);
      const city = encodeURIComponent(String(form.get("city") || "").slice(0, 60));
      const phone = encodeURIComponent(String(form.get("phone") || "").slice(0, 24));
      res.setHeader("Set-Cookie", [
        `app_city=${city}; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_phone=${phone}; Path=/app; Max-Age=31536000; SameSite=Lax`,
      ]);
      redirect(res, "/app/home");
    } else {
      html(res, locationPage(req));
    }
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})$/);
  if (m) {
    const page = await ownerDash(m[1]);
    if (page) { html(res, page); return; }
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/toggle$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[1]);
    const shop = _id && (await (await col("shop_owners")).findOne({ _id }));
    if (shop) await (await col("shop_owners")).updateOne({ _id }, { $set: { open: shop.open === false } });
    redirect(res, `/app/owner/${m[1]}`);
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/order-status$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const status = ["preparing", "done"].includes(form.get("status")) ? form.get("status") : null;
    const _id = await oid(form.get("order"));
    if (status && _id) {
      await (await col("app_orders")).updateOne(
        { _id, shopId: m[1] },
        { $set: { status, ...(status === "preparing" ? { confirmedAt: new Date() } : {}) } },
      );
    }
    redirect(res, `/app/owner/${m[1]}`);
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/profile$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (!shop) { res.writeHead(404).end("not found"); return; }
    if (req.method === "POST") {
      const form = await readForm(req, 600_000);
      const name = String(form.get("name") || "").trim().slice(0, 80);
      const owner = String(form.get("owner") || "").trim().slice(0, 60);
      const logo = String(form.get("logo") || "");
      const logoOk = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length < 500_000;
      const set = { ...(name ? { name } : {}), owner, ...(logoOk ? { logo } : {}) };
      await (await col("shop_owners")).updateOne({ _id: shop._id }, { $set: set });
      redirect(res, `/app/owner/${m[1]}`);
    } else {
      html(res, profilePage(shop));
    }
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dish\/([a-f0-9]{24})$/);
  if (m) {
    const shop = await shopById(m[1]);
    const _id = await oid(m[2]);
    const d = shop && _id ? await (await col("app_dishes")).findOne({ _id, shopId: m[1] }) : null;
    if (!shop || !d) { res.writeHead(404).end("not found"); return; }
    if (req.method === "POST") {
      const form = await readForm(req, 600_000);
      const name = String(form.get("name") || "").trim().slice(0, 80);
      const photo = String(form.get("photo") || "");
      const photoOk = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length < 500_000;
      await (await col("app_dishes")).updateOne({ _id }, { $set: {
        ...(name ? { name } : {}),
        nameSi: String(form.get("nameSi") || "").slice(0, 80),
        ...(photoOk ? { photo } : {}),
        price: Math.max(0, Number(form.get("price")) || 0),
        portions: Math.max(1, Number(form.get("portions")) || 20),
        window: String(form.get("window") || "All day").slice(0, 20),
        discount: String(form.get("discount") || "none").slice(0, 10),
        special: form.get("special") === "1",
        updatedAt: new Date(),
      } });
      redirect(res, `/app/owner/${m[1]}`);
    } else {
      html(res, dishEditPage(shop, d));
    }
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dish\/([a-f0-9]{24})\/delete$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const r = await (await col("app_dishes")).deleteOne({ _id, shopId: m[1] });
      if (r.deletedCount) {
        const shopOid = await oid(m[1]);
        if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: -1 } });
      }
    }
    redirect(res, `/app/owner/${m[1]}`);
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/add-dish$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (shop) { html(res, addDishPage(shop)); return; }
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/publish$/);
  if (m && req.method === "POST") {
    const form = await readForm(req, 600_000); // base64 dish photo fits
    const name = String(form.get("name") || "").trim().slice(0, 80);
    const photo = String(form.get("photo") || "");
    const photoOk = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length < 500_000;
    if (name) {
      await (await col("app_dishes")).insertOne({
        shopId: m[1],
        name,
        nameSi: String(form.get("nameSi") || "").slice(0, 80),
        ...(photoOk ? { photo } : {}),
        price: Math.max(0, Number(form.get("price")) || 0),
        portions: Math.max(1, Number(form.get("portions")) || 20),
        window: String(form.get("window") || "All day").slice(0, 20),
        discount: String(form.get("discount") || "none").slice(0, 10),
        special: form.get("special") === "1",
        createdAt: new Date(),
      });
      const shopOid = await oid(m[1]);
      if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: 1 } });
    }
    redirect(res, `/app/owner/${m[1]}`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}
