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
import QRCode from "qrcode";
import { getDb } from "./mongo.ts";
import { newCode, sendVerificationEmail, sendPasswordResetEmail } from "./mail.mjs";
import { loadPresetDishes, generateRecipe, priceIngredient } from "./ai-dish.mjs";
import { LANKA_INGREDIENTS, STOCK_UNITS, INGREDIENT_INDEX } from "../data/lanka-ingredients.mjs";
import { uploadDishPhoto, deleteDishPhoto, getIngredientPhotoMap } from "./drive.mjs";
import { CURRENCIES, CURRENCY_CODES, currencyOf, fmtMoney } from "../data/currencies.mjs";

const ORANGE = "#d9542b";
const PUBLIC_BASE = process.env.PUBLIC_BASE || "https://web-production-2b43c.up.railway.app";
const PROVIDER_LABEL = { apple: "Apple", google: "Google", facebook: "Facebook", sms: "SMS", email: "email" };
const DIET_OPTIONS = ["Vegetarian", "Vegan", "Halal", "No pork", "No beef", "No seafood"];
const CUISINE_OPTIONS = ["Rice & curry", "Kottu", "Hoppers", "String hoppers", "Short eats", "Bakery", "Sweets"];
const LANG_OPTIONS = ["en", "si", "ta"];

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

/* ---- native push (APNs) --------------------------------------------- */

/** Push to every device registered for a shop; prunes dead tokens. */
async function notifyShop(shopId, payload) {
  const { apnsReady, sendPushAll } = await import("./apns.mjs");
  if (!apnsReady() || !shopId) return;
  const tokens = (await (await col("push_tokens")).find({ kind: "shop", shopId: String(shopId) }).toArray()).map((t) => t.token);
  if (!tokens.length) return;
  const { dead } = await sendPushAll(tokens, payload);
  if (dead.length) await (await col("push_tokens")).deleteMany({ token: { $in: dead } });
}

/** Push to a buyer's devices, matched by the phone used at checkout. */
async function notifyBuyer(phone, payload) {
  const { apnsReady, sendPushAll } = await import("./apns.mjs");
  if (!apnsReady() || !phone) return;
  const tokens = (await (await col("push_tokens")).find({ kind: "buyer", phone: String(phone) }).toArray()).map((t) => t.token);
  if (!tokens.length) return;
  const { dead } = await sendPushAll(tokens, payload);
  if (dead.length) await (await col("push_tokens")).deleteMany({ token: { $in: dead } });
}

/** Support email as a mailto link — the phone offers the user's mail app. */
const SUPPORT_MAILTO = `<a href="mailto:gk.smart@ggmt.sg?subject=3una%205aha%20support" style="color:#b3672f;font-weight:700;text-decoration:underline">gk.smart@ggmt.sg</a>`;

/** Promo types a special can carry — buyers see the picked tag on the flash
 *  card and shop banner, so they know what kind of deal it is. */
const PROMO_TAGS = ["New promo", "Today special", "Holidays catch", "Drink bite",
  "Weekend catch", "My treat", "Celebration", "Sports watch"];

/** Small chip row under the special toggle; visible only while it's on. */
function promoTagChips(formId, current = "") {
  const cur = PROMO_TAGS.includes(current) ? current : "Today special";
  return `<div class="seg" id="promoTags" style="display:none;gap:6px;margin:8px 0 2px">
      ${PROMO_TAGS.map((t) => `<label><input type="radio" name="promoTag" value="${t}" form="${formId}" ${t === cur ? "checked" : ""}><span class="opt" style="font-size:11.5px;padding:5px 10px">${t}</span></label>`).join("")}
    </div>
    <script>
      (() => {
        const tgl = document.querySelector('input[name="special"]');
        const row = document.getElementById('promoTags');
        const sync = () => { row.style.display = tgl.checked ? 'flex' : 'none'; };
        tgl.addEventListener('change', sync); sync();
      })();
    </script>`;
}

/** Indicative rate for the US$ display; dishes are priced in LKR. */
const LKR_PER_USD = 300;

// FX rates vs 1 LKR (approximate 2026 rates — refresh via API later).
// All prices in Mongo are stored as LKR base; every display converts.
const LKR_TO = {
  LKR: 1,
  USD: 1 / 300,
  KHR: 4100 / 300,   // Cambodian riel
  SGD: 1.35 / 300,
  GBP: 0.79 / 300,
  AUD: 1.53 / 300,
  AED: 3.67 / 300,
  INR: 83 / 300,
  EUR: 0.92 / 300,
};
const CUR_SYM = {
  LKR: "LKR",  USD: "US$", KHR: "៛",  SGD: "S$",
  GBP: "£",    AUD: "A$",  AED: "AED", INR: "₹",  EUR: "€",
};
// Country (name OR ISO code) → { primary, secondary }.
// Primary = local; Secondary = what the app's users most want to compare against
// (Sri Lankan diaspora market → LKR everywhere; in Sri Lanka → USD for tourists).
const COUNTRY_CUR = {
  "Sri Lanka":      { primary: "LKR", secondary: "USD" },
  "LK":             { primary: "LKR", secondary: "USD" },
  "Cambodia":       { primary: "USD", secondary: "LKR" },
  "KH":             { primary: "USD", secondary: "LKR" },
  "Singapore":      { primary: "SGD", secondary: "LKR" },
  "SG":             { primary: "SGD", secondary: "LKR" },
  "United Kingdom": { primary: "GBP", secondary: "LKR" },
  "GB":             { primary: "GBP", secondary: "LKR" },
  "UK":             { primary: "GBP", secondary: "LKR" },
  "Australia":      { primary: "AUD", secondary: "LKR" },
  "AU":             { primary: "AUD", secondary: "LKR" },
  "UAE":            { primary: "AED", secondary: "LKR" },
  "AE":             { primary: "AED", secondary: "LKR" },
  "India":          { primary: "INR", secondary: "LKR" },
  "IN":             { primary: "INR", secondary: "LKR" },
};
function fx(lkrAmt, code) {
  const r = LKR_TO[code] || LKR_TO.USD;
  const v = Number(lkrAmt || 0) * r;
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 10)   return v.toFixed(1).replace(/\.0$/, "");
  return v.toFixed(2);
}
function pairFor(country) {
  return COUNTRY_CUR[country] || { primary: "USD", secondary: "LKR" };
}
/** Price for a specific shop — shows local first, secondary alongside. */
function shopPrice(shop, lkrAmt) {
  const { primary, secondary } = pairFor(shop && shop.country);
  const glue = (code) => (["LKR", "AED"].includes(code) ? " " : "");
  const one = (code) => `${CUR_SYM[code]}${glue(code)}${fx(lkrAmt, code)}`;
  return `${one(primary)} · ${one(secondary)}`;
}

/** Travellers see US$ first, locals still get the exact LKR price. */
function lkr(n) {
  const v = Number(n ?? 0);
  return `US$${(v / LKR_PER_USD).toFixed(2)} · LKR ${v.toLocaleString("en-US")}`;
}

/** Dish thumbnail — real photo when the owner uploaded one, emoji tile otherwise. */
function dishThumb(d, extra = "", emoji = "🍛") {
  return d?.photo
    ? `<div class="thumb" style="${extra};background-image:url(${d.photo});background-size:cover;background-position:center"></div>`
    : `<div class="thumb" style="${extra}">${emoji}</div>`;
}

/** Shop logo thumb — uploaded logo when present, emoji tile otherwise. */
function shopThumb(shop, extra = "", emoji = "🍲") {
  if (shop?.logo) {
    // When `extra` sets size, use it alone — avoids WKWebView's inconsistent
    // handling of duplicate properties like width:52px;...;width:130px.
    const sizing = extra || "width:52px;height:52px;border-radius:12px";
    return `<div style="${sizing};background:#f0e7de;flex:0 0 auto;background-image:url(${shop.logo});background-size:cover;background-position:center;background-repeat:no-repeat"></div>`;
  }
  return `<div class="thumb" style="${extra}">${emoji}</div>`;
}

async function oid(id) {
  const { ObjectId } = await import("mongodb");
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * Shared identity layer for ALL real logins (Apple/Google/Facebook/SMS/Email).
 * Given a provider-verified identity, find-or-create the user and sign them in.
 * A provider-verified email arrives already verified (no code needed).
 */
async function signInIdentity(res, { provider, email, phone, name }) {
  const users = await col("app_users");
  const key = email ? { email: email.toLowerCase() } : { phone };
  let u = await users.findOne(key);
  if (!u) {
    await users.insertOne({
      ...key, provider, name: name || "",
      verified: !!email, // provider already verified the email; phone is verified by OTP
      createdAt: new Date(),
    });
    u = await users.findOne(key);
  } else if (!u.provider) {
    await users.updateOne(key, { $set: { provider, verified: true } });
  }
  const cookies2 = [`app_user=${provider}; Path=/app; Max-Age=31536000; SameSite=Lax`];
  if (email) cookies2.push(`app_email=${encodeURIComponent(email.toLowerCase())}; Path=/app; Max-Age=31536000; SameSite=Lax`);
  if (phone) cookies2.push(`app_phone=${encodeURIComponent(phone)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
  res.setHeader("Set-Cookie", cookies2);
}

/**
 * Verify an OIDC id_token (Google / Apple) against the provider's JWKS.
 * Returns { email, name } if valid and audience matches, else null.
 */
async function verifyIdToken(idToken, { jwksUrl, issuers, audience }) {
  try {
    const [h, p, sig] = idToken.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (!issuers.includes(payload.iss)) return null;
    if (audience && payload.aud !== audience) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    const jwks = await (await fetch(jwksUrl)).json();
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const keyObj = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), keyObj, Buffer.from(sig, "base64url"));
    if (!ok) return null;
    return { email: payload.email, name: payload.name };
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

/** Kebab-case slug from a shop name, safe for URLs. */
function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "shop";
}

/** Ensure a shop has a stored slug (deterministic, unique). Persists on first use. */
async function ensureShopSlug(shop) {
  if (shop.slug) return shop.slug;
  const shops = await col("shop_owners");
  const base = slugify(shop.name);
  let slug = base;
  let n = 1;
  while (await shops.findOne({ slug, _id: { $ne: shop._id } })) { n++; slug = `${base}-${n}`; }
  await shops.updateOne({ _id: shop._id }, { $set: { slug } });
  return slug;
}

/** Resolve a shop's coordinates: Google/Apple Maps link first, city geocode fallback. */
async function resolveCoords(mapsUrl, city, country) {
  try {
    if (mapsUrl) {
      const r = await fetch(mapsUrl, { redirect: "follow" });
      const u = r.url || "";
      const m = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/[?&](?:q|ll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
    }
  } catch { /* fall through to geocode */ }
  try {
    if (city) {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city + ", " + (country || ""))}`,
        { headers: { "User-Agent": "3una5aha/0.1 (gk.smart@ggmt.sg)" } });
      const j = await r.json();
      if (j?.[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon) };
    }
  } catch { /* no coords */ }
  return null;
}

async function dishesFor(shopId) {
  return (await col("app_dishes")).find({ shopId: String(shopId) }).sort({ createdAt: -1 }).toArray();
}

/* ---------------------------------------------------------------- shell */

function shell({ title, body, nav = "", back = "", noPad = false, backFloat = false, noBack = false, toast = "", hideLogout = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#faf7f4">
<link rel="manifest" href="/app/manifest.json">
<title>${esc(title)}</title>
<style>
  * { box-sizing:border-box; margin:0; -webkit-tap-highlight-color:transparent; }
  body { background:#faf7f4; color:#1a1a1a; font:15.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         max-width:480px; margin:0 auto; min-height:100vh;
         padding:${noPad ? "0" : "14px 24px"}; padding-top:calc(env(safe-area-inset-top, 0px) + 30px); padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 88px); }
  .logout { position:fixed; top:calc(env(safe-area-inset-top, 0px) + 4px); right:16px; z-index:80;
            font-size:12px; font-weight:700; color:#d92d20; background:#fff; border:1px solid #f1c1bb;
            border-radius:99px; padding:5px 12px; box-shadow:0 2px 8px #0002; }
  a { color:inherit; text-decoration:none; }
  h1 { font-size:24px; letter-spacing:-.02em; }
  .si { color:#b3672f; font-weight:400; font-size:.82em; }
  .sub { color:#6b6560; font-size:13.5px; }
  .chiprow { display:flex; gap:8px; overflow-x:auto; padding:12px 0; scrollbar-width:none; }
  .chip { flex:0 0 auto; border:1px solid #e0d6cc; background:#fff; border-radius:99px; padding:7px 14px; font-size:13px; font-weight:600; color:#4a443f; }
  .chip.on { background:#191512; border-color:#191512; color:#fff; }
  .card { background:#fff; border:1px solid #ece3da; border-radius:16px; padding:13px 14px; margin-bottom:11px; display:block; }
  .row { display:flex; align-items:center; gap:10px; }
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
  @keyframes flashpulse { 0%,100% { box-shadow:0 0 0 0 #d9542b00; } 50% { box-shadow:0 0 0 7px #d9542b1c, 0 6px 22px #d9542b38; } }
  .flashcard { animation:flashpulse 2.6s ease-in-out infinite; border-color:#d9542b55; }
  .toast { position:fixed; top:45%; left:50%; transform:translate(-50%,-50%); background:#191512; color:#fff;
           padding:15px 24px; border-radius:14px; font-weight:700; font-size:15.5px; z-index:100;
           box-shadow:0 10px 34px #0007; text-align:center; max-width:80vw; }
  .back.float { position:absolute; z-index:10; top:calc(env(safe-area-inset-top, 0px) + 30px); left:24px; margin:0; box-shadow:0 2px 8px #0003; }
  .basketbar { position:fixed; bottom:calc(max(10px, env(safe-area-inset-bottom)) + 72px); left:50%; transform:translateX(-50%); width:calc(100% - 48px); max-width:432px;
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
${toast ? `<div class="toast" id="toast">✓ ${esc(toast)}</div><script>setTimeout(()=>{const t=document.getElementById('toast');if(t){t.style.transition='opacity .4s';t.style.opacity='0';setTimeout(()=>t.remove(),450)}},2000)</script>` : ""}
${hideLogout ? "" : `<a class="logout" id="logoutBtn" href="/app/logout" hidden>Logout</a><script>if(document.cookie.includes('app_user='))document.getElementById('logoutBtn').hidden=false;</script>`}
${noBack ? "" : `<a class="back${backFloat ? " float" : ""}" href="${back ? esc(back) : "/app"}" onclick="${back ? "" : "if(history.length>1){history.back();return false}"}">‹</a>`}
${body}
${nav}
<script>
// When loaded inside the native app's WKWebView, hide the web .nav bar —
// the native TabView already provides one. Detection is layered so
// redirects (which strip ?native=1) still hide the nav:
//   1. ?native=1 in the URL         (initial load from Swift)
//   2. sessionStorage 'native'      (sticky within the same WebView)
//   3. cookie 'native=1'            (set by Swift on WebView creation;
//                                    survives all server redirects)
(function(){
  var here = new URLSearchParams(location.search).get('native') === '1';
  var sticky = false;
  try { sticky = sessionStorage.getItem('native') === '1'; } catch(e) {}
  var viaCookie = /(?:^|;\s*)native=1(?:;|$)/.test(document.cookie);
  if (here || sticky || viaCookie) {
    try { sessionStorage.setItem('native','1'); } catch(e) {}
    var s = document.createElement('style');
    s.textContent = '.nav{display:none!important} body{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 20px)!important}';
    document.head.appendChild(s);
  }
})();
</script>
${NATIVE_BRIDGE}
</body>
</html>`;
}

/**
 * Native bridge — runs ONLY inside the Capacitor app (no-op in browsers).
 * Push registration, haptic taps, offline banner, and a share helper.
 */
const NATIVE_BRIDGE = `<script>
(() => {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  const P = C.Plugins || {};
  try {
    const Push = P.PushNotifications;
    if (Push) {
      Push.addListener('registration', (t) => {
        localStorage.setItem('pushReg', String(Date.now()));
        fetch('/app/push/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: t.value, platform: 'ios' }) }).catch(() => {});
      });
      Push.addListener('pushNotificationActionPerformed', (a) => {
        const url = a && a.notification && a.notification.data && a.notification.data.url;
        if (url && url.indexOf('/app') === 0) location.href = url;
      });
      if (Date.now() - Number(localStorage.getItem('pushReg') || 0) > 86400000) {
        Push.requestPermissions().then((r) => { if (r.receive === 'granted') Push.register(); }).catch(() => {});
      }
    }
  } catch (e) {}
  try {
    const H = P.Haptics;
    if (H) document.addEventListener('click', (e) => {
      if (e.target.closest('.btn, #flashYes, #flashNo, .chip, .toggle')) H.impact({ style: 'LIGHT' }).catch(() => {});
    }, true);
  } catch (e) {}
  try {
    const N = P.Network;
    if (N) N.addListener('networkStatusChange', (s) => {
      let b = document.getElementById('netBar');
      if (!s.connected) {
        if (!b) {
          b = document.createElement('div');
          b.id = 'netBar';
          b.textContent = 'No connection — reconnecting…';
          b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99;background:#b3261e;color:#fff;text-align:center;font:600 12px system-ui;padding:9px';
          document.body.appendChild(b);
        }
      } else if (b) { b.remove(); location.reload(); }
    });
  } catch (e) {}
  window.nativeShare = (title, url) => {
    const S = P.Share;
    if (S) { S.share({ title: title, url: url }).catch(() => {}); return false; }
    if (navigator.share) { navigator.share({ title: title, url: url }).catch(() => {}); return false; }
    return true;
  };
  try {
    // Dish/shop photos: native camera-or-library sheet instead of the file input.
    const Cam = P.Camera;
    const box = document.getElementById('photoBox');
    if (Cam && box) box.addEventListener('click', (e) => {
      e.preventDefault();
      Cam.getPhoto({ resultType: 'dataUrl', quality: 80, width: 800, source: 'PROMPT' }).then((ph) => {
        const f = document.getElementById('photoData');
        if (f) f.value = ph.dataUrl;
        box.style.backgroundImage = 'url(' + ph.dataUrl + ')';
        const hint = document.getElementById('photoHint');
        if (hint) hint.textContent = '';
      }).catch(() => {});
    }, true);
  } catch (e) {}
})();
</script>`;

function buyerNav(on) {
  const items = [
    ["home", "/app/home", "⌂", "Home"],
    ["orders", "/app/orders", "▤", "Orders"],
    ["location", "/app/location", "◎", "Map"],
    ["manager", "/app/manager", "🏪", "Manager"],
    ["profile", "/app/profile", "○", "Account"],
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

function legalFooter(includeSupport = true) {
  return `<div class="sub" style="font-size:12px;margin-top:22px;text-align:center">
    <a href="/app/terms" style="text-decoration:underline">Terms of Service</a> ·
    <a href="/app/privacy" style="text-decoration:underline">Privacy Policy</a>${includeSupport ? ` ·
    <a href="/app/support" style="text-decoration:underline">Support &amp; Contact</a>` : ""}
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
  const APPLE_SVG = `<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#fff" d="M16.4 12.7c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8 2.2-1.2 3-2.4c.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.6-3.9zM14 5.6c.7-.8 1.1-1.9 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>`;
  return shell({
    title: "3una 5aha — find Sri Lankan food near you",
    backFloat: true,
    hideLogout: true,
    body: `
    <div style="text-align:center">
      <img src="/assets/hero-welcome.jpg?v=2" alt="Sri Lankan spices and rice &amp; curry"
           style="width:calc(100% + 48px);margin:calc(-1 * (env(safe-area-inset-top, 0px) + 30px)) -24px 14px;aspect-ratio:16/10;object-fit:cover;border-radius:0 0 26px 26px;display:block"
           onerror="this.remove()">
      <h1 style="font-size:30px"><span style="color:${ORANGE}">3</span>una <span style="color:${ORANGE}">5</span>aha <span style="font-weight:800">· තුන පහ</span></h1>
      <p class="sub" style="max-width:330px;margin:8px auto 4px;font-size:14.5px">
        <strong>Find Sri Lankan restaurants and home cooking near you.</strong> A non-commercial
        community app where Sri Lankan restaurants and home cooks post their
        dishes, deals and daily activities — so travellers anywhere in the
        world can find Sri Lankan dishes nearby.</p>
      <div style="margin:16px 0 6px;display:grid;grid-template-columns:1fr 1fr;gap:9px">
      <button type="button" id="appleSignInBtn" class="btn dark" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 6px;font-size:15px">${APPLE_SVG}Apple</button>
      ${loginBtn("email", "ghost", "✉️", "Email")
          + loginBtn("sms", "ghost", "💬", "SMS")
          + `<a class="btn ghost" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 6px;font-size:15px" href="/app/home">👀 Guest</a>`}
      </div>
      <!-- Web-only fallback for the Apple button (native app always uses the JS handler below). -->
      <form id="appleWebFallback" method="POST" action="/app/login" style="display:none">
        <input type="hidden" name="via" value="apple">
      </form>
      <div class="sub" style="font-size:12.5px;margin:12px 0 8px"><strong>Support &amp; Contact</strong> — email, Telegram or WhatsApp:</div>
      ${supportLinks()}
      ${legalFooter(false)}
      <div class="sub" style="font-size:11.5px;margin-top:8px">By continuing you agree to our Terms &amp; Privacy Policy</div>
      <div class="sub" style="font-size:11.5px;margin-top:4px">Published by <a href="https://www.ggmt.sg" target="_blank" rel="noopener" style="text-decoration:underline;font-weight:700">www.ggmt.sg</a> · GGMT PTE. LTD.</div>
    </div>
    <script>
      document.getElementById('appleSignInBtn').addEventListener('click', async () => {
        const cap = window.Capacitor;
        const SIWA = cap && cap.Plugins && cap.Plugins.SignInWithApple;
        if (!cap || !cap.isNativePlatform || !cap.isNativePlatform() || !SIWA) {
          // Outside the native app there is no real Apple sign-in — offer the
          // email form instead of any shortcut.
          document.querySelector('#appleWebFallback').action = '/app/login';
          const via = document.createElement('input');
          via.type = 'hidden'; via.name = 'via'; via.value = 'email';
          const f = document.getElementById('appleWebFallback');
          f.innerHTML = ''; f.appendChild(via); f.submit();
          return;
        }
        try {
          const result = await SIWA.authorize({
            clientId: 'sg.ggmt.una5aha',
            redirectURI: 'https://web-production-2b43c.up.railway.app/app',
            scopes: 'email name',
            state: 'una5aha',
          });
          const r = result.response || result;
          if (!r || !r.identityToken) throw new Error('no identity token');
          const body = new URLSearchParams();
          body.set('id_token', r.identityToken);
          const name = [r.givenName, r.familyName].filter(Boolean).join(' ');
          if (name) body.set('name', name);
          if (r.email) body.set('email', r.email);
          const resp = await fetch('/app/auth/apple', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
          if (resp.ok) location.href = '/app/home';
          else alert('Sign in with Apple failed — please try again.');
        } catch (err) {
          // User cancelled the native sheet, or a transient error — do nothing.
        }
      });
    </script>`,
  });
}

/* -------------------------------------------------- sms login page */

function smsLoginPage(error = "") {
  return shell({
    title: "Sign in with phone — 3una 5aha",
    back: "/app",
    hideLogout: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app">‹</a><h1 style="font-size:21px">Sign in with phone</h1></div>
    <div class="sub" style="margin:4px 0 6px">Enter your phone number and a password — you're in right away.
    We'll verify your number with a code (valid 24h) later; a red dot reminds you until then.</div>
    ${error ? `<div class="card" style="background:#fdecea;border-color:#efc4bf;color:#b3261e">${esc(error)}</div>` : ""}
    <form method="POST" action="/app/login-sms">
      <label>PHONE NUMBER</label>
      <input type="tel" name="phone" required placeholder="+94 77 123 4567" autocomplete="tel">
      <label>PASSWORD</label>
      <input type="password" name="password" required placeholder="••••••" autocomplete="current-password">
      <button class="btn" style="margin-top:18px">Sign in</button>
    </form>`,
  });
}

/* ------------------------------------------------ email test login */

function emailLoginPage(error = "") {
  return shell({
    title: "Sign in with email — 3una 5aha",
    back: "/app",
    hideLogout: true,
    body: `
    <h1>Sign in with email <span style="font-weight:800">· ඊමේල් වලින් පිවිසෙන්න</span></h1>
    <div class="sub" style="margin:4px 0 6px">Submit your email and password — new emails get an account instantly.
    A verification code is emailed to you from gk.smart@ggmt.sg; you can sign in right away and verify within 24 hours.</div>
    <div class="sub" style="margin:6px 0 10px;font-style:italic">ඔබේ ඊමේල් සහ මුරපදය දෙන්න. අලුත් ඊමේල් වලට ගිණුමක් වහාම හැදෙයි.
    gk.smart@ggmt.sg වෙතින් සත්‍යාපන අංක 6ක් ඔබට එවනු ලැබේ — ඔබට වහාම පිවිසෙන්න පුළුවන්, පැය 24ක් ඇතුළත සත්‍යාපනය කරන්න.</div>
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

/* ----------------------------------------------------- user profile */

async function userProfilePage(req, flash = "") {
  const c = cookies(req);
  const email = decodeURIComponent(c.app_email || "");
  const u = email ? await (await col("app_users")).findOne({ email }) : null;
  const ownedShop = email ? await (await col("shop_owners")).findOne({ email }) : null;
  const favIds = (c.app_favs || "").split("|").filter(Boolean);
  const owners = await col("shop_owners");
  const favShops = favIds.length
    ? await owners.find({ _id: { $in: (await Promise.all(favIds.map(oid))).filter(Boolean) } }).toArray()
    : [];
  const phone = c.app_phone ? decodeURIComponent(c.app_phone) : "";
  const ordered = phone
    ? await (await col("app_orders")).find({ phone }).sort({ createdAt: -1 }).limit(30).toArray()
    : [];
  const orderedIds = [...new Set(ordered.map((o) => o.shopId))].filter((id) => !favIds.includes(id));
  const usedShops = orderedIds.length
    ? await owners.find({ _id: { $in: (await Promise.all(orderedIds.map(oid))).filter(Boolean) } }).toArray()
    : [];
  const shopRow = (sh, tag) => `<a class="card row" href="/app/shop/${String(sh._id)}" style="margin:0 0 8px">
    ${shopThumb(sh)}
    <div style="flex:1;min-width:0"><strong>${esc(sh.name)}</strong><div class="sub" style="font-size:12px">${esc(sh.city ?? "")} · ${tag}</div></div><span class="sub">›</span></a>`;

  return shell({
    title: "Profile — 3una 5aha",
    nav: buyerNav("profile"),
    noBack: true,
    toast: flash,
    body: `
    <div class="row" style="gap:10px;align-items:center;margin-top:-26px;padding-right:80px">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app/home">‹</a>
      <div style="flex:1;min-width:0">
        <div class="sub" style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;line-height:1.1">Account</div>
        <strong style="font-size:17px;line-height:1.15;display:block">${u ? esc(u.name || email) : "Guest"}</strong>
        <div class="sub" style="font-size:11px;line-height:1.15">${u ? `${esc(email)}${u.provider ? ` · via ${PROVIDER_LABEL[u.provider] || u.provider}` : ""} ${u.verified ? '<span style="color:#1d9d4b">✓</span>' : '<a href="/app/verify" style="color:#d92d20;text-decoration:underline">● verify email</a>'}` : "Not signed in"}</div>
      </div>
      ${u ? (() => { const av = u.avatar || ownedShop?.logo || ""; return `<label for="avIn" class="thumb" id="avBox" style="width:52px;height:52px;border-radius:99px;cursor:pointer;background-size:cover;background-position:center;background-color:#f0e7de;position:relative;flex:0 0 auto;${av ? `background-image:url(${av})` : ""}"><span id="avHint" style="font-size:18px">${av ? "" : "👤"}</span><span style="position:absolute;right:-3px;bottom:-3px;width:22px;height:22px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;border:2px solid #faf7f4;pointer-events:none">📷</span></label>`; })() : ""}
    </div>
    ${u ? `
    <form method="POST" action="/app/profile" style="margin-top:14px">
      <input type="file" id="avIn" accept="image/*" style="display:none">
      <input type="hidden" name="avatar" id="avData">
      <label>NAME</label>
      <input type="text" name="name" value="${esc(u.name ?? "")}" placeholder="Your name">
      <label>PHONE</label>
      <input type="tel" name="phone" value="${esc(u.phone ?? phone)}" placeholder="+94 77 123 4567">
      <label>WHATSAPP <span style="font-weight:400">— leave blank if same as phone</span></label>
      <input type="tel" name="whatsapp" value="${esc(u.whatsapp ?? "")}" placeholder="+94 77 123 4567">
      <label>TELEGRAM</label>
      <input type="text" name="telegram" value="${esc(u.telegram ?? "")}" placeholder="@yourhandle">
      <label>HOME CITY <span style="font-weight:400">— we'll surface shops near you</span></label>
      <input type="text" name="city" value="${esc(u.city ?? "")}" placeholder="Colombo, Kandy, Galle…">
      <label>CURRENCY <span style="font-weight:400">— view prices in your currency</span></label>
      <select name="currency" style="width:100%;padding:11px;border-radius:10px;border:1px solid #e3d6c2;background:#fff;font-size:14px">
        ${CURRENCIES.map((c) => `<option value="${c.code}"${(u.currency || "LKR") === c.code ? " selected" : ""}>${c.code} · ${esc(c.name)} (${esc(c.symbol)})</option>`).join("")}
      </select>
      <label>LANGUAGE</label>
      <div class="seg">
        ${[["en", "English"], ["si", "සිංහල"], ["ta", "தமிழ்"]].map(([v, l]) => `<label><input type="radio" name="lang" value="${v}"${(u.lang || "en") === v ? " checked" : ""}><span class="opt">${l}</span></label>`).join("")}
      </div>
      <label>DIET <span style="font-weight:400">— we'll flag matching dishes</span></label>
      <div class="seg">
        ${["Vegetarian", "Vegan", "Halal", "No pork", "No beef", "No seafood"].map((d) => `<label><input type="checkbox" name="diet" value="${esc(d)}"${(u.diet || []).includes(d) ? " checked" : ""}><span class="opt">${d}</span></label>`).join("")}
      </div>
      <label>DISHES YOU LOVE</label>
      <div class="seg">
        ${["Rice & curry", "Kottu", "Hoppers", "String hoppers", "Short eats", "Bakery", "Sweets"].map((d) => `<label><input type="checkbox" name="cuisine" value="${esc(d)}"${(u.cuisines || []).includes(d) ? " checked" : ""}><span class="opt">${d}</span></label>`).join("")}
      </div>
      ${ownedShop ? `
      <label style="margin-top:20px">SHOP PHOTOS <span style="font-weight:400">— 1 front · 2 inside · 3 &amp; 4 dishes</span></label>
      <div class="sub" style="font-size:11.5px;margin:-2px 0 8px">Live on your shop page. Also editable in Shop Manager → Shop Profile.</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${[
          { n: 1, field: "frontPhoto", hint: "shop front", val: ownedShop.frontPhoto || "" },
          { n: 2, field: "photo2", hint: "inside", val: ownedShop.photo2 || "" },
          { n: 3, field: "photo3", hint: "dish 1", val: ownedShop.photo3 || "" },
          { n: 4, field: "photo4", hint: "dish 2", val: ownedShop.photo4 || "" },
        ].map(({ n, field, hint, val }) => `<label for="ph${n}In" class="thumb" id="ph${n}Box" style="width:calc(50% - 4px);height:110px;font-size:12px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative;${val ? `background-image:url(${val})` : ""}"><span id="ph${n}Hint">${val ? "" : hint}</span><span style="position:absolute;right:-6px;bottom:-6px;width:30px;height:30px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
        <input type="file" id="ph${n}In" accept="image/*" style="display:none">
        <input type="hidden" name="${field}" id="ph${n}Data">`).join("")}
      </div>` : ""}
      <button class="btn" style="margin-top:18px">Save profile</button>
    </form>
    <strong style="display:block;margin:20px 0 8px">Change password — pick one</strong>
    <form method="POST" action="/app/profile/password" class="card" style="padding:12px 14px">
      <strong style="font-size:13.5px">1 · With your old password</strong>
      <label>OLD PASSWORD</label><input type="password" name="old" required>
      <label>NEW PASSWORD (6+)</label><input type="password" name="next" required minlength="6">
      <button class="btn" style="margin-top:12px;padding:11px">Change password</button>
    </form>
    <form method="POST" action="/app/profile/reset-send" class="card row" style="padding:12px 14px">
      <div style="flex:1"><strong style="font-size:13.5px">2 · Email me a reset code</strong>
        <div class="sub" style="font-size:12px">Sent by ${SUPPORT_MAILTO} · valid 24h</div></div>
      <button class="btn ghost" style="width:auto;padding:10px 14px">Send</button>
    </form>
    <a class="card row" href="mailto:gk.smart@ggmt.sg?subject=Password%20help%20—%203una%205aha" style="padding:12px 14px">
      <div style="flex:1"><strong style="font-size:13.5px">3 · Ask GK SMART support</strong>
        <div class="sub" style="font-size:12px">gk.smart@ggmt.sg — access recovery</div></div><span class="sub">›</span></a>
    <script>
      document.getElementById('avIn').addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        const img = new Image();
        img.onload = () => {
          const c2 = document.createElement('canvas'); const side = Math.min(img.width, img.height);
          c2.width = c2.height = Math.min(300, side);
          c2.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c2.width, c2.height);
          const data = c2.toDataURL('image/jpeg', 0.8);
          document.getElementById('avData').value = data;
          const box = document.getElementById('avBox');
          box.style.backgroundImage = 'url(' + data + ')';
          document.getElementById('avHint').textContent = '';
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(f);
      });
      // Shop-photo uploads (only present when the user owns a shop)
      function wirePh(n) {
        var input = document.getElementById('ph'+n+'In'); if (!input) return;
        input.addEventListener('change', function(e){
          var f = e.target.files[0]; if (!f) return;
          var img = new Image();
          img.onload = function(){
            var c = document.createElement('canvas');
            var sc = Math.min(1, 800 / Math.max(img.width, img.height));
            c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            var data = c.toDataURL('image/jpeg', 0.8);
            document.getElementById('ph'+n+'Data').value = data;
            document.getElementById('ph'+n+'Box').style.backgroundImage = 'url(' + data + ')';
            document.getElementById('ph'+n+'Hint').textContent = '';
            URL.revokeObjectURL(img.src);
          };
          img.src = URL.createObjectURL(f);
        });
      }
      for (var i = 1; i <= 4; i++) wirePh(i);
    </script>`
    : `<a class="btn" style="margin-top:14px;padding:12px" href="/app">Sign in to save favourites</a>
       <div class="sub" style="font-size:11.5px;margin:6px 2px 0">Apple · Google · email — your photo, name, phone and favourites live on the account.</div>`}
    <strong style="display:block;margin:18px 0 6px;font-size:14px">★ My favourites</strong>
    ${favShops.map((sh) => shopRow(sh, "★ favourite")).join("") || `<div class="sub card" style="padding:11px 13px;margin:0;font-size:12.5px">Tap ☆ on a shop page or long-press a map pin to save it here.</div>`}
    ${usedShops.length ? `<strong style="display:block;margin:14px 0 6px;font-size:14px">Ordered before</strong>${usedShops.map((sh) => shopRow(sh, "ordered before")).join("")}` : ""}`,
  });
}

function resetPage(error = "") {
  return shell({
    title: "Reset password — 3una 5aha",
    back: "/app/profile",
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/profile">‹</a><h1 style="font-size:21px">Reset password</h1></div>
    <p class="sub" style="margin:8px 0 4px">Enter the code emailed by ${SUPPORT_MAILTO} (valid 24h) and your new password.</p>
    ${error ? `<div class="card" style="background:#fdecea;border-color:#efc4bf;color:#b3261e">${esc(error)}</div>` : ""}
    <form method="POST" action="/app/profile/reset">
      <label>RESET CODE</label>
      <input type="text" name="code" inputmode="numeric" maxlength="6" required style="letter-spacing:6px;text-align:center;font-weight:700">
      <label>NEW PASSWORD (6+)</label>
      <input type="password" name="next" required minlength="6">
      <button class="btn" style="margin-top:16px">Set new password</button>
    </form>
    <div class="sub" style="text-align:center;font-size:11.5px;margin-top:16px">(development note: the code is 111111 until email sending goes live)</div>`,
  });
}

/* ------------------------------------------------- email verification */

function verifyPage(email, error = "") {
  return shell({
    title: "Verify your email — 3una 5aha",
    back: "/app/home",
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/home">‹</a><h1 style="font-size:21px">Verify your email</h1></div>
    <p class="sub" style="margin:8px 0 4px">A 6-digit code was emailed to <strong>${esc(email)}</strong> by
    ${SUPPORT_MAILTO}. Codes are valid for 24 hours — this is a non-commercial community app,
    so you can also do this later.</p>
    ${error ? `<div class="card" style="background:#fdecea;border-color:#efc4bf;color:#b3261e">${esc(error)}</div>` : ""}
    <form method="POST" action="/app/verify">
      <label>VERIFICATION CODE</label>
      <input type="text" name="code" inputmode="numeric" maxlength="6" required placeholder="••••••" style="letter-spacing:6px;font-size:19px;font-weight:700;text-align:center">
      <button class="btn" style="margin-top:16px">Confirm email</button>
    </form>
    <div style="text-align:center;margin-top:14px"><a class="sub" href="/app/home" style="text-decoration:underline">Not now — verify later</a></div>
    <div class="sub" style="text-align:center;font-size:11.5px;margin-top:16px">Didn't get the email? Check spam, or wait a minute — first-time delivery can be slow.</div>`,
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

async function homePage(req, url) {
  const c = cookies(req);
  const q = (url?.searchParams.get("q") || "").trim().slice(0, 60);
  const city = c.app_city || (c.app_geo ? "Near you" : "Set location");
  let unverified = false, verifyKind = "";
  if (c.app_email) {
    const u = await (await col("app_users")).findOne({ email: decodeURIComponent(c.app_email) });
    if (u && !u.verified) { unverified = true; verifyKind = "email"; }
  } else if (c.app_user === "sms" && c.app_phone) {
    const u = await (await col("app_users")).findOne({ phone: decodeURIComponent(c.app_phone) });
    if (u && !u.verified) { unverified = true; verifyKind = "phone"; }
  }
  const shops = await activeShops();
  const specials = await (await col("app_dishes"))
    .find({ special: true })
    .sort({ createdAt: -1 })
    .limit(8)
    .toArray();
  const shopName = new Map(shops.map((s) => [String(s._id), s.name]));

  // Search: filter shops by name/city and surface matching dishes.
  const searching = q.length > 0;
  let shownShops = shops;
  let dishHits = [];
  if (searching) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const allDishes = await (await col("app_dishes")).find({}).limit(400).toArray();
    dishHits = allDishes.filter((d) => rx.test(d.name || "") || rx.test(d.nameSi || ""));
    const dishShopIds = new Set(dishHits.map((d) => String(d.shopId)));
    shownShops = shops.filter((s) =>
      rx.test(s.name || "") || rx.test(s.city || "") || dishShopIds.has(String(s._id)));
  }

  // Flash card data: today's specials, user's city first (geo preference).
  const shopCity = new Map(shops.map((sh) => [String(sh._id), sh.city ?? ""]));
  const myCity = (c.app_city || "").toLowerCase();
  const flash = specials
    .map((d) => ({
      id: String(d._id),
      shopId: d.shopId,
      name: d.name,
      nameSi: d.nameSi ?? "",
      price: lkr(d.price),
      deal: d.discount && d.discount !== "none" ? d.discount : "",
      shop: shopName.get(d.shopId) ?? "",
      window: d.window ?? "today",
      photo: d.photo ?? "",
      tag: d.promoTag || "Today special",
      near: myCity && (shopCity.get(d.shopId) || "").toLowerCase().includes(myCity) ? 0 : 1,
    }))
    .sort((a, b) => a.near - b.near);

  const shopCards = (
    await Promise.all(
      shownShops.map(async (s) => {
        const dishes = await dishesFor(s._id);
        const deal = dishes.find((d) => d.discount && d.discount !== "none");
        return `<a class="card row" href="/app/shop/${String(s._id)}" style="padding:0;gap:10px;padding-right:10px;overflow:hidden">
        ${shopThumb(s, "width:130px;height:130px;border-radius:0")}
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
      <div class="row" style="gap:8px;min-width:0">
        <a class="back" style="margin:0;width:30px;height:30px;flex:0 0 auto" href="/app">‹</a>
        <a href="/app/location" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:${ORANGE}">●</span> <strong style="font-size:13.5px">${esc(city)}</strong> <span class="sub">▾</span> <span class="si" style="font-size:14.5px;font-weight:800;color:#1a1a1a">· ආයුබෝවන් Ayubowan</span></a>
      </div>
      <span class="pill" style="background:#191512;color:#fff;padding:6px 13px;flex:0 0 auto">Shop</span>
    </div>
    ${unverified ? `<a href="/app/verify" class="card row" style="margin-top:10px;padding:9px 13px;background:#fdecea;border-color:#efc4bf">
      <span style="width:10px;height:10px;border-radius:99px;background:#d92d20;flex:0 0 auto;box-shadow:0 0 0 3px #d92d2033"></span>
      <span style="flex:1;font-size:13px"><strong>Verify your ${verifyKind}</strong> — a 24h code will confirm your ${verifyKind}</span>
      <span class="sub">›</span></a>` : ""}
    <form action="/app/home" style="margin:16px 0 0"><input type="text" name="q" value="${esc(q)}" placeholder="🔍 Search dishes, shops, spices…"></form>
    ${searching ? `
    <div class="row" style="justify-content:space-between;margin-top:12px">
      <strong>Results for “${esc(q)}”</strong>
      <a class="sub" href="/app/home" style="text-decoration:underline">✕ clear</a>
    </div>
    ${dishHits.slice(0, 12).map((d) => `
      <a class="card row" href="/app/shop/${esc(String(d.shopId))}" style="margin-top:10px">
        ${dishThumb(d)}
        <div style="flex:1;min-width:0">
          <strong>${esc(d.name)}</strong>${d.nameSi ? ` <span class="si sub">${esc(d.nameSi)}</span>` : ""}
          <div class="sub" style="font-size:12.5px">${esc(shopName.get(d.shopId) ?? "")}</div>
          <strong style="color:${ORANGE};font-size:13.5px">${esc(lkr(d.price))}</strong>
        </div><span style="color:#c9bfb7">›</span>
      </a>`).join("")}
    ${!dishHits.length && !shownShops.length ? `<div class="card" style="margin-top:10px;text-align:center;padding:22px 16px">
      <div style="font-size:30px">🔍</div>
      <strong style="display:block;margin-top:6px">Nothing found for “${esc(q)}”</strong>
      <span class="sub" style="font-size:13px">Try a dish name like “kottu” or a city.</span>
    </div>` : ""}` : ""}
    ${!searching && flash.length ? `
    <a class="card row flashcard" id="flashCard" href="${flash[0].demo ? "#" : "/app/shop/" + esc(flash[0].shopId)}" style="margin:14px 0 0;padding:0;overflow:hidden;gap:12px">
      <div id="flashImg" style="width:118px;align-self:stretch;min-height:104px;flex:0 0 auto;background:#f0e7de ${flash[0].photo ? `url('${flash[0].photo}') center/cover no-repeat` : ""};display:flex;align-items:center;justify-content:center;font-size:30px">${flash[0].photo ? "" : "🍛"}</div>
      <div style="flex:1;min-width:0;padding:10px 12px 10px 0">
        <span class="pill today" id="flashTag">${esc(flash[0].tag.toUpperCase())} <span class="si" style="color:#fff">අද විශේෂ</span></span>
        <strong id="flashName" style="display:block;font-size:15px;margin-top:3px">${esc(flash[0].name)}</strong>
        <div class="sub" id="flashMeta" style="font-size:12.5px">${esc(flash[0].shop)} · ${esc(flash[0].window)}</div>
        <strong id="flashPrice" style="color:${ORANGE}">${esc(flash[0].price)}</strong> <span class="pill deal" id="flashDeal" ${flash[0].deal ? "" : "hidden"}>${esc(flash[0].deal)}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;padding:10px 12px 10px 0;flex:0 0 auto;justify-content:center">
        <button id="flashNo" aria-label="Not for me" style="width:38px;height:38px;border-radius:99px;border:1.5px solid #f1c1bb;background:#fff;color:#d92d20;font-size:16px;font-weight:800;cursor:pointer">✕</button>
        <button id="flashYes" aria-label="Like" style="width:38px;height:38px;border-radius:99px;border:1.5px solid #bfe5c8;background:#fff;color:#1d9d4b;font-size:17px;cursor:pointer">♥</button>
      </div>
    </a>
    <script id="flashData" type="application/json">${JSON.stringify(flash)}</script>
    <script>
      (() => {
        const items = JSON.parse(document.getElementById('flashData').textContent);
        let i = 0, timer = null;
        const card = document.getElementById('flashCard');
        const voted = JSON.parse(localStorage.getItem('dishVotes') || '{}');
        function render(d) {
          card.href = '/app/shop/' + d.shopId;
          document.getElementById('flashTag').textContent = (d.tag || 'Today special').toUpperCase();
          const img = document.getElementById('flashImg');
          img.style.background = d.photo ? "#f0e7de url('" + d.photo + "') center/cover no-repeat" : '#f0e7de';
          img.textContent = d.photo ? '' : '🍛';
          document.getElementById('flashName').textContent = d.name;
          document.getElementById('flashMeta').textContent = d.shop + ' · ' + d.window;
          document.getElementById('flashPrice').textContent = d.price;
          const deal = document.getElementById('flashDeal');
          deal.hidden = !d.deal; deal.textContent = d.deal;
          document.getElementById('flashYes').style.opacity = voted[d.id] ? '.35' : '1';
        }
        function advance(dir) {
          if (items.length < 2) return;
          card.style.transition = 'transform .3s, opacity .3s';
          card.style.transform = dir ? 'translateX(' + (dir * 90) + 'px)' : '';
          card.style.opacity = '0.1';
          setTimeout(() => {
            i = (i + 1) % items.length;
            render(items[i]);
            card.style.transform = '';
            card.style.opacity = '1';
          }, 310);
          restart();
        }
        function vote(kind) {
          const d = items[i];
          if (kind === 'like' && voted[d.id]) { advance(1); return; }
          if (kind === 'like') { voted[d.id] = 1; localStorage.setItem('dishVotes', JSON.stringify(voted)); }
          fetch('/app/dish/' + d.id + '/' + (kind === 'like' ? 'like' : 'pass'), { method: 'POST' }).catch(() => {});
          advance(kind === 'like' ? 1 : -1);
        }
        function restart() { clearInterval(timer); timer = setInterval(() => advance(0), 3500); }
        document.getElementById('flashYes').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); vote('like'); });
        document.getElementById('flashNo').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); vote('pass'); });
        let x0 = null;
        card.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
        card.addEventListener('touchend', (e) => {
          if (x0 === null) return;
          const dx = e.changedTouches[0].clientX - x0; x0 = null;
          if (dx > 55) vote('like'); else if (dx < -55) vote('pass');
        }, { passive: true });
        render(items[0]);
        restart();
      })();
    </script>` : ""}
    ${searching ? "" : `<div class="chiprow">
      <span class="chip on">Nearby</span><span class="chip">Today's special</span><span class="chip">Promotions</span><span class="chip">Open now</span>
    </div>`}
    <div class="row" style="justify-content:space-between;margin-top:4px"><strong>${searching ? "Matching restaurants" : "Nearby restaurants"}</strong><span class="sub">${searching ? `${shownShops.length} found` : "near your location"}</span></div>
    <div style="margin-top:10px">${shopCards || (searching ? "" : `<div class="card" style="text-align:center;padding:26px 16px">
      <div style="font-size:34px">🍛</div>
      <strong style="display:block;margin-top:8px">No restaurants near you yet</strong>
      <span class="sub" style="display:block;font-size:13px;margin-top:4px">Try another city from <a href="/app/location" style="color:${ORANGE};font-weight:700">Set location</a> — or be the first:</span>
      <a class="btn" href="/app/register" style="margin-top:14px;display:inline-block;width:auto;padding:12px 22px">List your kitchen — free</a>
    </div>`)}</div>
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

async function shopPage(id, extras = {}) {
  const shop = await shopById(id);
  if (!shop) return null;
  const dishes = await dishesFor(shop._id);
  const special = dishes.find((d) => d.special);
  const tableN = Number(extras.tableN) || 0;

  const dishRows = dishes
    .filter((d) => !d.special)
    .map(
      (d) => `<div class="card row" style="margin:0 0 8px;padding:0;overflow:hidden;gap:12px">
      ${d.photo
        ? `<div onclick="previewFrom(this)" style="width:100px;align-self:stretch;min-height:92px;flex:0 0 auto;background-image:url(${d.photo});background-size:cover;background-position:center;cursor:zoom-in"></div>`
        : `<div class="thumb" style="width:100px;align-self:stretch;min-height:92px;border-radius:0">🍛</div>`}
      <div style="flex:1;padding:10px 0;min-width:0">
        <strong style="font-size:14.5px">${esc(d.name)}</strong>${d.nameSi ? ` <span class="si">${esc(d.nameSi)}</span>` : ""}
        <div class="sub" style="font-size:12.5px">Available ${esc(d.window ?? "all day")}</div>
        <strong style="font-size:13.5px">${shopPrice(shop, d.price)}</strong>
      </div>
      <button class="btn" style="width:38px;padding:8px 0;border-radius:11px;margin-right:12px;flex:0 0 auto" onclick='add(${JSON.stringify(String(d._id))},${JSON.stringify(d.name)},${Number(d.price) || 0})'>+</button>
    </div>`,
    )
    .join("");

  return shell({
    title: `${shop.name} — 3una 5aha`,
    back: "/app/home",
    backFloat: true,
    nav: buyerNav("home"),
    body: `
    ${shopThumb(shop, "width:calc(100% + 48px);height:150px;font-size:34px;margin:calc(-1 * (env(safe-area-inset-top, 0px) + 30px)) -24px 0;border-radius:0 0 22px 22px", "🍛")}
    ${tableN ? `<div class="row" style="margin-top:12px;padding:10px 14px;background:#191512;color:#fff;border-radius:14px;justify-content:space-between;align-items:center">
      <div><span style="font-size:11px;opacity:.75;letter-spacing:.06em">DINE-IN · ${esc(shop.name.toUpperCase())}</span><br><strong style="font-size:18px">🍽 Table ${tableN}</strong></div>
      <span class="sub" style="font-size:11px;color:#ffb08f;text-align:right;line-height:1.3">Pick items · tap<br>SEND TO KITCHEN</span>
    </div>` : ""}
    <h1 style="margin-top:12px">${esc(shop.name)} <span class="si">කෑම</span></h1>
    <div class="sub">★ 4.8 · ${esc(shop.city)}, ${esc(shop.country)} · ${shop.open === false ? "closed now" : "open now"}</div>
    ${special ? `
    <div class="card" style="margin-top:14px">
      <span class="pill today">${esc((special.promoTag || "Today special").toUpperCase())}</span> <strong style="font-size:13.5px">Today's special package <span class="si">අද විශේෂ</span></strong>
      <div class="row" style="margin-top:10px">
        ${dishThumb(special, "", "🎁")}
        <div style="flex:1">
          <strong>${esc(special.name)}</strong>
          <div class="sub" style="font-size:12.5px">${esc(special.nameSi ?? "")}</div>
          <strong style="color:${ORANGE}">${shopPrice(shop, special.price)}</strong> <span class="sub">· ${esc(special.window ?? "today")}</span>
        </div>
        <button class="btn" style="width:38px;padding:8px 0;border-radius:11px" onclick='add(${JSON.stringify(String(special._id))},${JSON.stringify(special.name)},${Number(special.price) || 0})'>+</button>
      </div>
    </div>` : ""}
    <strong style="display:block;margin:14px 0 10px">Popular dishes</strong>
    ${dishRows || `<div class="sub">No dishes published yet.</div>`}

    <div class="sub" style="text-align:center;margin:16px 0">
      <a href="#" onclick="return favShop('${String(shop._id)}', this)" style="text-decoration:underline;font-weight:700" id="favLink">☆ Add to favourites</a>
      &nbsp;·&nbsp; <a href="#" onclick="return window.nativeShare ? nativeShare('${esc(shop.name)} on 3una 5aha', 'https://web-production-2b43c.up.railway.app/app/shop/${String(shop._id)}') : true" style="text-decoration:underline">↗ Share</a>
      &nbsp;·&nbsp; <a href="/app/report?shop=${String(shop._id)}" style="text-decoration:underline">⚑ Report this shop</a></div>
    <script>
      function favShop(id, el) {
        fetch('/app/fav/' + id, { method: 'POST' }).then((r) => r.json()).then((j) => {
          if (el) el.textContent = j.fav ? '★ In your favourites' : '☆ Add to favourites';
        }).catch(() => {});
        return false;
      }
      if ((document.cookie.match(/app_favs=([^;]*)/) || [])[1]?.includes('${String(shop._id)}'))
        document.getElementById('favLink').textContent = '★ In your favourites';
    </script>
    <div class="basketbar" id="bar" onclick="checkout()"><span id="barL">View basket</span><span id="barR"></span></div>

    <div id="sheet" style="display:none;position:fixed;inset:0;background:rgba(20,15,10,.45);z-index:9" onclick="if(event.target===this)this.style.display='none'">
      <form method="POST" action="/app/order" style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#faf7f4;border-radius:22px 22px 0 0;padding:20px 26px calc(env(safe-area-inset-bottom, 0px) + 28px)">
        <strong style="font-size:17px">${tableN ? `Send Table ${tableN} order to kitchen` : "Confirm pickup order"}</strong>
        <div id="sheetItems" style="margin:10px 0 2px"></div>
        <input type="hidden" name="shopId" value="${String(shop._id)}">
        <input type="hidden" name="items" id="itemsField">
        ${tableN ? `<input type="hidden" name="tableN" value="${tableN}">` : `<label>YOUR NAME</label><input type="text" name="buyer" required placeholder="Nimal P.">
        <label>PHONE</label><input type="tel" name="phone" required placeholder="+61 412 555 210">
        <label>PICKUP TIME</label><input type="text" name="pickupAt" placeholder="7:00 PM" value="7:00 PM">`}
        <button class="btn" style="margin-top:${tableN ? 12 : 18}px">${tableN ? `🍽 SEND TO KITCHEN · <span id="sheetTotal"></span>` : `Place order · <span id="sheetTotal"></span>`}</button>
      </form>
    </div>
<div id="pv" onclick="this.style.display='none'" style="display:none;position:fixed;inset:0;background:rgba(15,10,5,.92);z-index:60;align-items:center;justify-content:center;cursor:zoom-out">
      <img id="pvImg" style="max-width:94vw;max-height:88vh;border-radius:14px" alt="">
    </div>
<script>
  function previewFrom(el) {
    const m = (el.style.backgroundImage || '').match(/url\("?(.+?)"?\)$/);
    if (!m) return;
    document.getElementById('pvImg').src = m[1];
    document.getElementById('pv').style.display = 'flex';
  }
  const BKEY = 'basket_${String(shop._id)}';
  const money = (v) => 'US$' + (v / ${LKR_PER_USD}).toFixed(2) + ' \\u00b7 LKR ' + v.toLocaleString();
  let basket = [];
  try { basket = JSON.parse(localStorage.getItem(BKEY) || '[]'); } catch {}
  function persist() { localStorage.setItem(BKEY, JSON.stringify(basket)); }
  function add(id, name, price) {
    const f = basket.find((b) => b.id === id);
    if (f) f.qty++; else basket.push({ id, name, price, qty: 1 });
    persist(); render(); renderSheet();
  }
  function qty(id, d) {
    const f = basket.find((b) => b.id === id);
    if (!f) return;
    f.qty += d;
    if (f.qty <= 0) basket = basket.filter((b) => b.id !== id);
    persist(); render(); renderSheet();
    if (!basket.length) document.getElementById('sheet').style.display = 'none';
  }
  function render() {
    const n = basket.reduce((a, b) => a + b.qty, 0);
    const t = basket.reduce((a, b) => a + b.qty * b.price, 0);
    const bar = document.getElementById('bar');
    bar.style.display = n ? 'flex' : 'none';
    document.getElementById('barL').textContent = 'View basket · ' + n + ' item' + (n > 1 ? 's' : '');
    document.getElementById('barR').textContent = money(t);
  }
  function renderSheet() {
    const box = document.getElementById('sheetItems');
    box.innerHTML = basket.map((b) =>
      '<div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">' +
      '<span style="flex:1;min-width:0;font-size:14px"><b>' + b.name.replace(/</g, '&lt;') + '</b></span>' +
      '<button type="button" onclick="qty(\\'' + b.id + '\\',-1)" style="width:30px;height:30px;border-radius:99px;border:1.5px solid #ddd5cd;background:#fff;font-weight:800;cursor:pointer">−</button>' +
      '<span style="width:20px;text-align:center;font-weight:700">' + b.qty + '</span>' +
      '<button type="button" onclick="qty(\\'' + b.id + '\\',1)" style="width:30px;height:30px;border-radius:99px;border:1.5px solid #ddd5cd;background:#fff;font-weight:800;cursor:pointer">＋</button>' +
      '<span style="width:132px;text-align:right;font-size:11.5px;font-weight:700">' + money(b.qty * b.price) + '</span>' +
      '<button type="button" onclick="qty(\\'' + b.id + '\\',-99)" aria-label="Remove" style="width:30px;height:30px;border-radius:99px;border:1.5px solid #f1c1bb;background:#fff;color:#d92d20;font-weight:800;cursor:pointer">✕</button>' +
      '</div>').join('');
    document.getElementById('itemsField').value = JSON.stringify(basket);
    const tEl = document.getElementById('sheetTotal');
    if (tEl) tEl.textContent = money(basket.reduce((a, b) => a + b.qty * b.price, 0));
  }
  function checkout() { renderSheet(); document.getElementById('sheet').style.display = 'block'; }
  document.querySelector('#sheet form').addEventListener('submit', () => {
    document.getElementById('itemsField').value = JSON.stringify(basket);
    localStorage.removeItem(BKEY);
  });
  render();
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
      <div class="row" style="justify-content:space-between"><strong style="color:${ORANGE};font-size:13px">YOUR ORDER</strong><span class="pill ${esc(order.status)}">${esc(order.status)}</span></div>
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
    body: `<div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/home">‹</a><h1>My orders</h1></div><div class="sub" style="margin-bottom:14px">Pickup orders from this phone</div>
    ${rows || `<div class="sub">No orders yet — find a shop on <a href="/app/home" style="color:${ORANGE};font-weight:700">Home</a>.</div>`}`,
  });
}

/* ------------------------------------------------- 3.7 set location */

async function locationPage(req) {
  const c = cookies(req);
  const shops = (await activeShops()).filter((sh) => Number.isFinite(sh.lat) && Number.isFinite(sh.lng));
  const pins = shops.map((sh) => ({ id: String(sh._id), name: sh.name, lat: sh.lat, lng: sh.lng }));
  const geo = (c.app_geo || "").split(",").map(Number);
  const start = geo.length === 2 && Number.isFinite(geo[0]) ? geo : [6.9271, 79.8612];
  return shell({
    title: "Set your location — 3una 5aha",
    nav: buyerNav("location"),
    noBack: true,
    body: `
    <link rel="stylesheet" href="/assets/vendor/leaflet.css">
    <div class="row" style="gap:10px;margin-bottom:8px"><a class="back" style="margin:0" href="/app/home">‹</a><h1>Set your location</h1><span class="sub si">ඔබේ ස්ථානය</span></div>
    <div id="map" style="height:42vh;border-radius:16px;border:1px solid #ece3da;z-index:1"></div>
    <div class="sub" id="mapCount" style="text-align:center;margin:8px 0 4px">Loading map…</div>
    <form method="POST" action="/app/location" id="locForm">
      <label>CITY / SUBURB — search anywhere you're travelling</label>
      <div class="row" style="gap:8px">
        <input type="text" name="city" id="cityIn" value="${esc(c.app_city ?? "")}" placeholder="Melbourne VIC, Australia" style="flex:1">
        <button type="button" class="btn" id="findBtn" style="width:auto;padding:12px 14px;flex:0 0 auto">Find</button>
      </div>
      <input type="hidden" name="geo" id="geoIn" value="${esc(c.app_geo ?? "")}">
      <label>CONTACT NUMBER FOR ORDERS</label>
      <input type="tel" name="phone" value="${esc(c.app_phone ?? "")}" placeholder="+61 412 555 210">
      <button class="btn" style="margin-top:16px">Save &amp; continue</button>
    </form>
    <script src="/assets/vendor/leaflet.js"></script>
    <script>
      (() => {
        const shops = ${JSON.stringify(pins)};
        if (typeof L === 'undefined') {
          document.getElementById('mapCount').textContent = 'Map could not load — you can still search a city below.';
          return;
        }
        const map = L.map('map').setView([${start[0]}, ${start[1]}], 12);
        L.tileLayer('/app/tiles/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
        const circle = L.circle(map.getCenter(), { radius: 10000, color: '#d9542b', weight: 1.5, fillColor: '#d9542b', fillOpacity: 0.06 }).addTo(map);
        let me = null, markers = [];
        const D = (a, b, c2, d) => { const R = 6371, r = Math.PI / 180, x = (c2 - a) * r, y = (d - b) * r,
          h = Math.sin(x/2)**2 + Math.cos(a*r) * Math.cos(c2*r) * Math.sin(y/2)**2; return 2 * R * Math.asin(Math.sqrt(h)); };
        function refresh() {
          const cc = map.getCenter();
          circle.setLatLng(cc);
          document.getElementById('geoIn').value = cc.lat.toFixed(4) + ',' + cc.lng.toFixed(4);
          markers.forEach((m) => map.removeLayer(m)); markers = [];
          let n = 0;
          shops.forEach((s) => {
            if (D(cc.lat, cc.lng, s.lat, s.lng) <= 10) {
              n++;
              const mk = L.circleMarker([s.lat, s.lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#d9542b', fillOpacity: 1 }).addTo(map)
                .bindPopup('<b>' + s.name + '</b><br><a href="/app/shop/' + s.id + '">Open shop →</a><br><a href="#" data-id="' + s.id + '" onclick="return window.favShop(this.dataset.id, this)">☆ Save favourite</a>');
              mk.on('contextmenu', () => window.favShop(s.id));
              markers.push(mk);
            }
          });
          document.getElementById('mapCount').textContent =
            n + ' Sri Lankan shop' + (n === 1 ? '' : 's') + ' within 10 km — drag the map to explore';
        }
        map.on('moveend', refresh);
        refresh();
        if (navigator.geolocation) navigator.geolocation.getCurrentPosition((pos) => {
          const ll = [pos.coords.latitude, pos.coords.longitude];
          me = L.circleMarker(ll, { radius: 7, color: '#1d6ff2', fillColor: '#1d6ff2', fillOpacity: 0.9 }).addTo(map).bindPopup('You are here');
          map.setView(ll, 13);
        }, () => {}, { timeout: 8000 });
        window.favShop = (id, el) => {
          fetch('/app/fav/' + id, { method: 'POST' }).then((r) => r.json()).then((j) => {
            if (el) el.textContent = j.fav ? '★ Saved to favourites' : '☆ Save favourite';
            document.getElementById('mapCount').textContent = j.fav ? '★ Saved to your favourites (see Profile)' : 'Removed from favourites';
          }).catch(() => {});
          return false;
        };
        document.getElementById('findBtn').addEventListener('click', async () => {
          const q = document.getElementById('cityIn').value.trim();
          if (!q) return;
          try {
            const r = await fetch('/app/geocode?q=' + encodeURIComponent(q));
            const j = await r.json();
            if (j[0]) map.setView([Number(j[0].lat), Number(j[0].lon)], 12);
            else document.getElementById('mapCount').textContent = 'Place not found — try a bigger city name';
          } catch { document.getElementById('mapCount').textContent = 'Search unavailable — check connection'; }
        });
      })();
    </script>`,
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

async function ownerDash(id, toast = "") {
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
    toast,
    body: `
    <div class="row" style="gap:9px;margin-bottom:10px">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app" onclick="if(history.length>1){history.back();return false}">‹</a>
      <a class="row" href="/app/owner/${String(shop._id)}/profile" style="flex:1;min-width:0;gap:9px">${shopThumb(shop, "width:42px;height:42px")}
        <div style="min-width:0"><strong style="font-size:16px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(shop.name)} <span class="sub" style="font-size:11px">✏️</span></strong><div class="sub" style="font-size:11.5px">${esc(shop.owner || "")}</div></div></a>
    </div>
    <div class="row" style="gap:8px;margin-bottom:14px">
      <form method="POST" action="/app/owner/${String(shop._id)}/toggle" class="row" style="gap:6px;flex:0 0 auto">
        <span class="sub" style="font-size:12px;font-weight:700;color:${open ? "#1d7a34" : "#b3261e"}">${open ? "Open" : "Closed"}</span>
        <label class="toggle"><input type="checkbox" ${open ? "checked" : ""} onchange="this.form.submit()"><span></span></label>
      </form>
      <span style="flex:1"></span>
      <a class="chip" href="/app/shop/${String(shop._id)}" style="flex:0 0 auto;padding:7px 12px;font-size:12.5px">Buyer view</a>
      <a class="chip" href="/app/owner/${String(shop._id)}/qr" style="flex:0 0 auto;padding:7px 12px;font-size:12.5px">▦ Table QR</a>
    </div>
    ${shop.status === "pending" ? `<div class="card" style="background:#fdf3d7;border-color:#efdba8"><strong style="color:#946200">⏳ Pending review</strong><div class="sub" style="font-size:12.5px">The 3una 5aha team is reviewing your shop. You can build your menu now — buyers see you once approved.</div></div>` : ""}
    ${shop.status === "suspended" ? `<div class="card" style="background:#fdecea;border-color:#efc4bf"><strong style="color:#b3261e">⛔ Suspended</strong><div class="sub" style="font-size:12.5px">Your shop is hidden from buyers. Contact support via /app/support.</div></div>` : ""}
    <div class="row" style="justify-content:space-between;align-items:baseline;margin:2px 0 8px">
      <strong>My dishes <span class="sub" style="font-weight:400">— tap a tile to edit, buyers see these</span></strong>
    </div>
    ${(() => {
      const CATS = ["Starters", "Bites", "Vegi meals", "Chicken", "Beef", "Mutton", "Pork", "Sea food", "Drinks", "Desserts"];
      const inCat = (c) => c === "All" ? dishes.length : dishes.filter((d) => (d.category || "") === c).length;
      return `<div id="dishChips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px">
        <button type="button" class="dChip on" data-cat="All" onclick="dishTab('All',this)" style="border:1px solid #e0d6cc;background:#191512;color:#fff;border-radius:99px;padding:5px 11px;font-size:11px;font-weight:600;cursor:pointer">All · ${dishes.length}</button>
        ${CATS.map((c) => `<button type="button" class="dChip" data-cat="${esc(c)}" onclick="dishTab('${esc(c)}',this)" style="border:1px solid #e0d6cc;background:#fff;border-radius:99px;padding:5px 11px;font-size:11px;font-weight:600;color:#4a443f;cursor:pointer">${esc(c)} · ${inCat(c)}</button>`).join("")}
      </div>`;
    })()}
    <div id="dishGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${Array.from({ length: Math.max(12, dishes.length + 2) }, (_, i) => {
        const d = dishes[i];
        if (!d) return `<a href="/app/owner/${String(shop._id)}/add-dish" class="dTile" data-cat="__add__" style="margin:0;padding:0;overflow:hidden;border-style:dashed;border-width:2px;text-align:center;border-radius:16px;background:#fff;border:2px dashed #ece3da">
          <div style="aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8a827b;font-size:12.5px;padding:8px"><span style="font-size:26px">＋</span>Add your dish<br><span style="font-size:11px">photo · price · time</span></div></a>`;
        return `<a href="/app/owner/${String(shop._id)}/dish/${String(d._id)}" class="dTile card" data-cat="${esc(d.category || "")}" style="margin:0;padding:0;overflow:hidden;position:relative">
          <div style="aspect-ratio:4/3;background:#f0e7de ${d.photo ? `url(${d.photo}) center/cover` : ""};display:flex;align-items:center;justify-content:center;font-size:30px">${d.photo ? "" : "🍛"}</div>
          <span class="pill" style="position:absolute;top:7px;right:7px;background:#fff;border:1px solid #ece3da">✏️ Edit</span>
          ${d.special ? `<span class="pill deal" style="position:absolute;top:7px;left:7px">Special</span>` : ""}
          <div style="padding:8px 10px"><strong style="font-size:13px;line-height:1.3;display:block">${esc(d.name)}</strong>
          <div class="sub" style="font-size:12px">${shopPrice(shop, d.price)}${d.discount && d.discount !== "none" ? ` · <span style=\"color:${ORANGE}\">${esc(d.discount)}</span>` : ""}${d.category ? ` · <span style="color:#946200">${esc(d.category)}</span>` : ""}</div></div></a>`;
      }).join("")}
    </div>
    <script>
      function dishTab(cat, btn){
        document.querySelectorAll('#dishChips .dChip').forEach(function(c){
          c.classList.remove('on'); c.style.background='#fff'; c.style.color='#4a443f';
        });
        btn.classList.add('on'); btn.style.background='#191512'; btn.style.color='#fff';
        document.querySelectorAll('.dTile').forEach(function(t){
          var c = t.dataset.cat;
          if(c === '__add__' || cat === 'All' || c === cat) t.style.display=''; else t.style.display='none';
        });
      }
    </script>
    ${orders.length ? `<div class="row" style="justify-content:space-between;margin-top:16px"><strong>Incoming orders</strong>
      <span class="sub" style="font-size:12px">today ${todays.length} · ${lkr(revenue)} · ${chats} chats</span></div>
    <div style="margin-top:10px">${orderRows}</div>` : ""}
    <div style="height:70px"></div>
    <a class="btn" style="position:fixed;bottom:calc(env(safe-area-inset-bottom, 0px) + 18px);right:max(24px,calc(50% - 216px));width:auto;padding:13px 20px;border-radius:99px" href="/app/owner/${String(shop._id)}/add-dish">+ Add dish</a>`,
  });
}

/* -------------------------------------------------- table QR page */

async function qrPage(shop, extras = {}) {
  const id = String(shop._id);
  const slug = await ensureShopSlug(shop);
  // Short URL used in the QR itself — half the characters of the full
  // /app/shop/<24-char-hex> path, denser QR, easier to scan.
  const baseUrl = `${PUBLIC_BASE}/m/${slug}`;
  // Table list lives on the shop doc as `tables: [1,2,3,...]`. Empty means
  // 'no tables added yet' — start with a suggestion.
  const tables = Array.isArray(shop.tables) ? [...shop.tables].sort((a, b) => a - b) : [];
  const MAX_TABLES = 25;
  const sel = Number(extras.sel) || 0;
  const selValid = sel > 0 && tables.includes(sel);
  const contacts = [
    shop.phone ? `📞 ${esc(shop.phone)}` : "",
    shop.whatsapp ? `💬 ${esc(shop.whatsapp)}` : "",
    shop.contactEmail ? `✉️ ${esc(shop.contactEmail)}` : "",
  ].filter(Boolean).join("  ·  ");
  const safeName = esc(shop.name).replace(/[^a-zA-Z0-9]+/g, "-");
  // Golden-angle hue per table so each one gets a distinct color (like suppliers).
  const hueFor = (n) => Math.round(((n - 1) * 137.5 + 20) % 360);
  const accentFor = (n) => `hsl(${hueFor(n)} 65% 52%)`;
  const tintFor = (n) => `hsl(${hueFor(n)} 70% 96%)`;

  // Only generate the QR for the selected table (save bandwidth).
  let selQr = "";
  if (selValid) {
    selQr = await QRCode.toDataURL(`${baseUrl}/${sel}`, { margin: 1, width: 640, color: { dark: "#1a1a1a", light: "#ffffff" } });
  }

  const tableCard = (n) => {
    const on = sel === n;
    const accent = accentFor(n);
    const href = on ? `/app/owner/${id}/qr` : `/app/owner/${id}/qr?sel=${n}`;
    return `
    <div class="tCard" data-href="${href}" role="button" tabindex="0" style="cursor:pointer;margin:0 0 6px;padding:9px 10px 9px 12px;min-width:0;border-left:4px solid ${accent};border:1px solid ${on ? "#191512" : "#ece3da"};border-left:4px solid ${accent};border-radius:12px;${on ? "background:#191512;color:#fff" : "background:" + tintFor(n)}">
      <div class="row" style="justify-content:space-between;align-items:center;gap:6px">
        <strong style="font-size:13px;flex:1;min-width:0">Table ${n}</strong>
        <form method="POST" action="/app/owner/${id}/tables/${n}/remove" onclick="event.stopPropagation()" onsubmit="event.stopPropagation();return confirm('Remove Table ${n}?')" style="margin:0">
          <button class="btn ghost" style="width:auto;padding:2px 6px;font-size:10px;color:${on ? "#ffb08f" : "#b3261e"};background:transparent;border:0" title="Remove">✕</button>
        </form>
      </div>
    </div>`;
  };

  // The right-panel QR viewer with share + download.
  const qrPanel = selValid ? `
    <div style="margin:0;padding:10px 12px;border:1px solid ${accentFor(sel)};border-radius:12px;background:${tintFor(sel)}">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <strong style="font-size:13px;color:${accentFor(sel)}">TABLE ${sel}</strong>
        <a href="/app/owner/${id}/qr" style="font-size:14px;color:#b3261e;text-decoration:none;line-height:1" title="close">✕</a>
      </div>
      <img id="qrImg" src="${selQr}" alt="Table ${sel} QR" style="width:100%;max-width:220px;margin:8px auto 6px;display:block;background:#fff;border-radius:8px">
      <div class="sub" style="font-size:10.5px;text-align:center;margin-top:2px">📱 Scan for our menu</div>
      <button type="button" class="btn" onclick="previewJpg(${sel})" style="margin-top:8px;padding:8px;font-size:11.5px;width:100%">🔍 Preview &amp; Download</button>
      <button type="button" class="btn ghost" onclick="shareQr(${sel})" style="margin-top:5px;padding:8px;font-size:11.5px;width:100%;color:#191512;border:1px solid #ece3da">↗ Share link</button>
    </div>
    <!-- Preview modal — full branded card with actions -->
    <div id="qrPrev" style="display:none;position:fixed;inset:0;background:#191512e6;z-index:200;align-items:center;justify-content:center;padding:20px 16px calc(env(safe-area-inset-bottom, 0px) + 110px);flex-direction:column">
      <div style="position:absolute;top:14px;right:16px;font-size:22px;color:#fff;cursor:pointer;line-height:1;padding:6px" onclick="closePrev()">✕</div>
      <div style="color:#fff;font-size:12px;letter-spacing:.05em;margin-bottom:8px" id="qrPrevTitle">TABLE PREVIEW</div>
      <img id="qrPrevImg" src="" alt="Preview" style="max-width:100%;max-height:64vh;object-fit:contain;border-radius:10px;background:#fff;box-shadow:0 6px 24px #0006">
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;justify-content:center">
        <button type="button" id="qrPrevDl" class="btn" style="padding:10px 18px;font-size:13px">⬇ Download JPG</button>
        <button type="button" id="qrPrevShare" class="btn ghost" style="padding:10px 18px;font-size:13px;background:#fff;color:#191512;border:0">↗ Share</button>
      </div>
    </div>` : `
    <div class="sub" style="margin:2px 4px;font-size:11px;text-align:center;line-height:1.4;color:#946200;padding:10px 4px">
      Tap a table on the left to see the QR<br>
      <span class="si">වම් පස මේසයක් තෝරන්න</span>
    </div>`;

  return shell({
    title: "Table QR — " + shop.name,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/owner/${id}">‹</a><h1 style="font-size:21px">Table QR</h1></div>
    <p class="sub" style="margin:8px 0 12px;font-size:12px;line-height:1.4">Add tables on the left. Tap one to see its QR — download, share, or print. Cap ${MAX_TABLES} tables. <span class="si">වම් පස මේස එකතු කරන්න.</span></p>

    <div class="row" style="gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
      <strong style="font-size:14px">Tables <span class="si">මේස</span> · ${tables.length}/${MAX_TABLES}</strong>
      ${tables.length < MAX_TABLES ? `<form method="POST" action="/app/owner/${id}/tables/add" style="margin:0"><button type="submit" title="Add table" style="width:26px;height:26px;border-radius:99px;background:${ORANGE};color:#fff;border:0;font-size:16px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 6px #d9542b40;padding:0">+</button></form>` : `<span class="sub" style="font-size:10.5px">max reached</span>`}
      ${tables.length > 0 ? `<a class="btn" href="/app/owner/${id}/qr/print?tables=${Math.max(...tables)}" target="_blank" style="width:auto;padding:5px 10px;font-size:11px">🖨 Print all</a>` : ""}
    </div>

    ${tables.length ? `
    <div style="display:grid;grid-template-columns:42% 58%;gap:8px;margin-top:10px;align-items:start">
      <div class="tScroll" style="max-height:460px;overflow-y:scroll;padding:2px 8px 2px 0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#d9542b80 transparent">
        ${tables.map(tableCard).join("")}
      </div>
      <div style="min-width:0;position:sticky;top:0">${qrPanel}</div>
    </div>
    <style>
      .tScroll::-webkit-scrollbar { width: 6px; -webkit-appearance: none; }
      .tScroll::-webkit-scrollbar-thumb { background: #d9542b80; border-radius: 3px; }
      .tScroll::-webkit-scrollbar-track { background: transparent; }
    </style>` : `<div class="sub card" style="margin-top:12px;padding:14px;text-align:center;font-size:12.5px">
      <div style="font-size:26px">🪑</div>
      <div style="margin-top:6px">No tables yet — tap <strong style="color:${ORANGE}">+</strong> above to add your first table.</div>
    </div>`}

    <div class="sub" style="text-align:center;font-size:10.5px;margin-top:14px">Print output = 2 QRs per A4 (each half is A5). Browser <strong>Print → Save as PDF</strong>.</div>

    <script>
      var SHOP_NAME = ${JSON.stringify(shop.name)};
      var SHOP_CITY = ${JSON.stringify([shop.city, shop.country].filter(Boolean).join(", "))};
      var CONTACTS = ${JSON.stringify(contacts.replace(/&nbsp;/g, " "))};
      var SAFE_NAME = ${JSON.stringify(safeName)};
      var QR_SRC = ${JSON.stringify(selQr || "")};
      document.querySelectorAll('.tCard').forEach(function(c){
        c.addEventListener('click', function(e){
          if(e.target.closest('a,form,button')) return;
          var href = c.getAttribute('data-href'); if(href) location.href = href;
        });
      });
      function shareQr(n){
        var url = '${baseUrl}/' + n;
        if(navigator.share){
          navigator.share({title:SHOP_NAME + ' — Table ' + n, text:'Scan for our menu — Table ' + n, url:url}).catch(function(){});
        } else if(window.nativeShare){
          window.nativeShare(SHOP_NAME + ' — Table ' + n, url);
        } else {
          navigator.clipboard.writeText(url).then(function(){ alert('Link copied — paste into WhatsApp / any chat.'); });
        }
      }
      // Compose a branded card on a hidden canvas — returns a Promise
      // that resolves with the JPG data URI.
      function renderJpg(n){
        return new Promise(function(resolve, reject){
          if(!QR_SRC){ reject(new Error('no QR')); return; }
        var canvas = document.createElement('canvas');
        var W = 826, H = 1170; // A5 portrait @ ~140 DPI
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
        // brand line — '3una 5aha තුන පහ'
        ctx.textAlign = 'center';
        ctx.font = 'bold 44px -apple-system, Helvetica, sans-serif';
        function drawBrand(y){
          var parts = [
            {t:'3', c:'#d9542b'},{t:'una ', c:'#1a1a1a'},
            {t:'5', c:'#d9542b'},{t:'aha ', c:'#1a1a1a'},
            {t:'තුන පහ', c:'#1a1a1a'},
          ];
          var full = parts.map(function(p){return p.t;}).join('');
          var totalW = ctx.measureText(full).width;
          var x = (W - totalW) / 2;
          parts.forEach(function(p){
            ctx.fillStyle = p.c;
            ctx.textAlign = 'left';
            ctx.fillText(p.t, x, y);
            x += ctx.measureText(p.t).width;
          });
          ctx.textAlign = 'center';
        }
        drawBrand(90);
        // Shop name
        ctx.fillStyle = '#1a1a1a';
        ctx.font = 'bold 56px -apple-system, Helvetica, sans-serif';
        ctx.fillText(SHOP_NAME, W/2, 175);
        // City
        if(SHOP_CITY){
          ctx.fillStyle = '#6b6560';
          ctx.font = '28px -apple-system, Helvetica, sans-serif';
          ctx.fillText(SHOP_CITY, W/2, 220);
        }
        // TABLE N pill
        var pillTxt = 'TABLE ' + n;
        ctx.font = 'bold 30px -apple-system, Helvetica, sans-serif';
        var pillW = ctx.measureText(pillTxt).width + 60;
        var pillH = 46, pillY = 260;
        ctx.fillStyle = '#191512';
        var pillX = (W - pillW) / 2;
        var r = pillH/2;
        ctx.beginPath();
        ctx.moveTo(pillX + r, pillY);
        ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
        ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
        ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
        ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(pillTxt, W/2, pillY + pillH/2 + 2);
        ctx.textBaseline = 'alphabetic';
        // QR image (drawImage from the loaded QR)
        var img = new Image();
        img.onload = function(){
          var qSize = 560;
          ctx.drawImage(img, (W - qSize)/2, 340, qSize, qSize);
          // Scan hint
          ctx.fillStyle = '#1a1a1a';
          ctx.font = 'bold 34px -apple-system, Helvetica, sans-serif';
          ctx.fillText('📱 Scan for our menu', W/2, 960);
          // Contacts
          if(CONTACTS){
            ctx.fillStyle = '#6b6560';
            ctx.font = '24px -apple-system, Helvetica, sans-serif';
            var lines = wrap(ctx, CONTACTS, W - 80);
            var y = 1010;
            lines.forEach(function(l){ ctx.fillText(l, W/2, y); y += 32; });
          }
          // Footer
          ctx.fillStyle = '#a99d94';
          ctx.font = '20px -apple-system, Helvetica, sans-serif';
          ctx.fillText('the spice marketplace · ggmt.sg', W/2, 1120);
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = function(){ reject(new Error('QR load failed')); };
        img.src = QR_SRC;
        });
      }
      // Preview flow — render the card, show it in the modal, hook the
      // Download/Share buttons to the final data URI.
      function previewJpg(n){
        var modal = document.getElementById('qrPrev');
        var img = document.getElementById('qrPrevImg');
        var title = document.getElementById('qrPrevTitle');
        var dl = document.getElementById('qrPrevDl');
        var sh = document.getElementById('qrPrevShare');
        title.textContent = 'TABLE ' + n + ' · preview';
        img.src = '';
        dl.disabled = true; dl.textContent = 'Rendering…';
        modal.style.display = 'flex';
        renderJpg(n).then(function(dataUri){
          img.src = dataUri;
          dl.disabled = false; dl.textContent = '⬇ Download JPG';
          dl.onclick = function(){
            var link = document.createElement('a');
            link.download = SAFE_NAME + '-Table-' + n + '.jpg';
            link.href = dataUri;
            document.body.appendChild(link); link.click(); link.remove();
          };
          sh.onclick = function(){
            // Try Web Share API with the JPG file first (works on iOS 15+).
            fetch(dataUri).then(function(r){return r.blob();}).then(function(blob){
              var file = new File([blob], SAFE_NAME + '-Table-' + n + '.jpg', {type:'image/jpeg'});
              if(navigator.canShare && navigator.canShare({files:[file]})){
                return navigator.share({title:SHOP_NAME + ' — Table ' + n, files:[file]});
              }
              // Fallback: share the URL only.
              if(navigator.share){ return navigator.share({title:SHOP_NAME + ' — Table ' + n, url:'${baseUrl}/'+n}); }
              throw new Error('no share');
            }).catch(function(){
              navigator.clipboard.writeText('${baseUrl}/' + n).then(function(){ alert('Link copied — paste into WhatsApp / any chat.'); });
            });
          };
        }).catch(function(e){ dl.textContent = 'Failed'; });
      }
      function closePrev(){ document.getElementById('qrPrev').style.display = 'none'; }
      (function(){ var m = document.getElementById('qrPrev'); if(m){ m.addEventListener('click', function(e){ if(e.target === m) closePrev(); }); } })();
      function wrap(ctx, text, maxW){
        var words = text.split(' '), lines = [], line = '';
        for(var i=0; i<words.length; i++){
          var test = line ? line + ' ' + words[i] : words[i];
          if(ctx.measureText(test).width > maxW && line){ lines.push(line); line = words[i]; }
          else line = test;
        }
        if(line) lines.push(line);
        return lines;
      }
    </script>`,
  });
}

async function qrPrintPage(shop, tableCount) {
  const id = String(shop._id);
  const n = Math.max(1, Math.min(50, Number(tableCount) || 1));
  const slug = await ensureShopSlug(shop);
  const baseUrl = `${PUBLIC_BASE}/m/${slug}`;
  const contacts = [
    shop.phone ? `📞 ${esc(shop.phone)}` : "",
    shop.whatsapp ? `💬 ${esc(shop.whatsapp)}` : "",
    shop.contactEmail ? `✉️ ${esc(shop.contactEmail)}` : "",
  ].filter(Boolean).join("  ·  ");
  const qrs = [];
  for (let i = 1; i <= n; i++) qrs.push({ label: `Table ${i}`, url: `${baseUrl}/${i}` });
  for (const q of qrs) {
    q.dataUri = await QRCode.toDataURL(q.url, { margin: 1, width: 720, color: { dark: "#1a1a1a", light: "#ffffff" } });
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Table QR print — ${esc(shop.name)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { width: 210mm; height: 148.5mm; padding: 14mm 20mm; text-align: center; page-break-inside: avoid; position: relative; }
  .card:nth-child(2n) { border-bottom: 1px dashed #bbb; }
  .cut { position: absolute; left: 0; right: 0; bottom: -0.5px; text-align: center; font-size: 8pt; color: #aaa; letter-spacing: .1em; }
  .brand { font-weight: 800; font-size: 22pt; }
  .brand .accent { color: #d9542b; }
  .shop { font-size: 26pt; font-weight: 800; margin: 6mm 0 1mm; }
  .city { color: #6b6560; font-size: 11pt; }
  .tag { display: inline-block; background: #191512; color: #fff; padding: 2mm 6mm; border-radius: 99px; font-size: 12pt; font-weight: 800; margin: 4mm 0 3mm; letter-spacing: .06em; }
  .qr { width: 62mm; height: 62mm; display: block; margin: 2mm auto 3mm; }
  .scan { font-weight: 700; font-size: 13pt; }
  .contacts { color: #6b6560; font-size: 10pt; margin-top: 4mm; }
  .foot { color: #a99d94; font-size: 8pt; margin-top: 3mm; }
  @media screen { body { background: #eee; padding: 20px; } .card { background:#fff; margin: 0 auto 20px; box-shadow: 0 3px 12px #0002; } }
</style>
</head><body>
${qrs.map((q, i) => `<div class="card">
  <div class="brand"><span class="accent">3</span>una <span class="accent">5</span>aha තුන පහ</div>
  <div class="shop">${esc(shop.name)}</div>
  <div class="city">${esc(shop.city ?? "")}${shop.country ? ", " + esc(shop.country) : ""}</div>
  <div class="tag">${esc(q.label.toUpperCase())}</div>
  <img class="qr" src="${q.dataUri}" alt="QR">
  <div class="scan">📱 Scan for our menu</div>
  ${contacts ? `<div class="contacts">${contacts}</div>` : ""}
  <div class="foot">the spice marketplace · ggmt.sg</div>
  ${(i + 1) % 2 === 0 ? "" : `<div class="cut">— — — — — CUT / FOLD — — — — —</div>`}
</div>`).join("")}
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });</script>
</body></html>`;
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
      <div class="card row" style="margin:10px 0 0;padding:8px 13px">
        <div style="flex:1;min-width:0"><strong style="font-size:13.5px">Today's special package</strong> <span class="sub" style="font-size:11.5px">· shown in promotions</span></div>
        <label class="toggle"><input type="checkbox" name="special" value="1" form="dishEditForm" ${d.special ? "checked" : ""}><span></span></label>
      </div>
      ${promoTagChips("dishEditForm", d.promoTag)}
    <form method="POST" action="/app/owner/${String(shop._id)}/dish/${String(d._id)}" id="dishEditForm">
      <label for="photoIn" class="thumb" id="photoBox" style="width:100%;height:150px;margin:10px 0;font-size:13px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative;${d.photo ? `background-image:url(${d.photo})` : ""}"><span id="photoHint">${d.photo ? "" : "add dish photo — tap to use camera or library"}</span><span style="position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
      <input type="file" id="photoIn" accept="image/*" style="display:none">
      <input type="hidden" name="photo" id="photoData">
      <label>DISH NAME</label>
      <input type="text" name="name" required value="${esc(d.name)}">
      <label>SINHALA NAME (OPTIONAL)</label>
      <input type="text" name="nameSi" value="${esc(d.nameSi ?? "")}">
      <div class="row" style="gap:10px">
        <div style="flex:1"><label>PRICE (${currencyOf(shop).code})</label><input type="number" name="price" required min="0" value="${Number(d.price) || 0}"></div>
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
      <label>SHOP PHOTOS <span style="font-weight:400">— up to 4: shop front, kitchen, food, seating</span></label>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${[1, 2, 3, 4].map((n) => {
          const val = n === 1 ? (shop.frontPhoto || shop.photo1 || "") : (shop["photo" + n] || "");
          const dataField = n === 1 ? "frontPhoto" : "photo" + n;
          return `<label for="ph${n}In" class="thumb" id="ph${n}Box" style="width:calc(50% - 4px);height:110px;font-size:12px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative;${val ? `background-image:url(${val})` : ""}"><span id="ph${n}Hint">${val ? "" : (n === 1 ? "shop front" : "photo " + n)}</span><span style="position:absolute;right:-6px;bottom:-6px;width:30px;height:30px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
          <input type="file" id="ph${n}In" accept="image/*" style="display:none">
          <input type="hidden" name="${dataField}" id="ph${n}Data">`;
        }).join("")}
      </div>
      <label>SHOP NAME</label>
      <input type="text" name="name" required value="${esc(shop.name)}">
      <label>OWNER NAME</label>
      <input type="text" name="owner" value="${esc(shop.owner ?? "")}" placeholder="Your name">
      <label>CURRENCY <span style="font-weight:400">— all your prices show in this</span></label>
      <select name="currency" style="width:100%;padding:11px;border-radius:10px;border:1px solid #e3d6c2;background:#fff;font-size:14px">
        ${CURRENCIES.map((c) => `<option value="${c.code}"${(shop.currency || "LKR") === c.code ? " selected" : ""}>${c.code} · ${esc(c.name)} (${esc(c.symbol)})</option>`).join("")}
      </select>
      <label>GOOGLE MAPS LOCATION <span style="font-weight:400">— Google Maps → Share → Copy link</span></label>
      <input type="text" name="mapsUrl" value="${esc(shop.mapsUrl ?? "")}" placeholder="https://maps.app.goo.gl/…">
      <label>PHONE</label>
      <input type="tel" name="phone" value="${esc(shop.phone ?? "")}" placeholder="+94 77 123 4567">
      <label>WHATSAPP</label>
      <input type="tel" name="whatsapp" value="${esc(shop.whatsapp ?? "")}" placeholder="+94 77 123 4567">
      <label>TELEGRAM</label>
      <input type="text" name="telegram" value="${esc(shop.telegram ?? "")}" placeholder="@yourshop">
      <label>FACEBOOK PAGE</label>
      <input type="text" name="facebook" value="${esc(shop.facebook ?? "")}" placeholder="https://facebook.com/yourshop">
      <label>INSTAGRAM</label>
      <input type="text" name="instagram" value="${esc(shop.instagram ?? "")}" placeholder="@yourshop or instagram.com/yourshop">
      <label>TIKTOK</label>
      <input type="text" name="tiktok" value="${esc(shop.tiktok ?? "")}" placeholder="@yourshop or tiktok.com/@yourshop">
      <label>YOUTUBE</label>
      <input type="text" name="youtube" value="${esc(shop.youtube ?? "")}" placeholder="youtube.com/@yourshop">
      <label>GOOGLE BUSINESS PROFILE <span style="font-weight:400">— your Google listing link</span></label>
      <input type="text" name="googleBusiness" value="${esc(shop.googleBusiness ?? "")}" placeholder="https://g.page/yourshop or Maps business link">
      <label>CONTACT EMAIL</label>
      <input type="text" name="contactEmail" value="${esc(shop.contactEmail ?? "")}" placeholder="hello@yourshop.lk">
      <button class="btn" style="margin-top:18px">Save profile</button>
    </form>
<script>
  function wirePhoto(inputId, boxId, hintId, dataId, square) {
    document.getElementById(inputId).addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        if (square) {
          const side = Math.min(img.width, img.height);
          c.width = c.height = Math.min(400, side);
          c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, c.width, c.height);
        } else {
          const max = 800;
          const sc = Math.min(1, max / Math.max(img.width, img.height));
          c.width = Math.round(img.width * sc);
          c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        }
        const data = c.toDataURL('image/jpeg', 0.8);
        document.getElementById(dataId).value = data;
        const box = document.getElementById(boxId);
        box.style.backgroundImage = 'url(' + data + ')';
        document.getElementById(hintId).textContent = '';
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
  }
  wirePhoto('logoIn', 'logoBox', 'logoHint', 'logoData', true);
  for (var n = 1; n <= 4; n++) wirePhoto('ph'+n+'In', 'ph'+n+'Box', 'ph'+n+'Hint', 'ph'+n+'Data', false);
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
      <div class="card row" style="margin:10px 0 0;padding:8px 13px">
        <div style="flex:1;min-width:0"><strong style="font-size:13.5px">Today's special package</strong> <span class="sub" style="font-size:11.5px">· shown in promotions</span></div>
        <label class="toggle"><input type="checkbox" name="special" value="1" form="dishForm"><span></span></label>
      </div>
      ${promoTagChips("dishForm")}
    <form method="POST" action="/app/owner/${String(shop._id)}/publish" id="dishForm">
      <label for="photoIn" class="thumb" id="photoBox" style="width:100%;height:130px;margin:10px 0;font-size:13px;color:#8a827b;cursor:pointer;background-size:cover;background-position:center;position:relative"><span id="photoHint">add dish photo — tap to use camera or library</span><span style="position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:99px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid #faf7f4;pointer-events:none">📷</span></label>
      <input type="file" id="photoIn" accept="image/*" style="display:none">
      <input type="hidden" name="photo" id="photoData">
      <label>DISH NAME</label>
      <input type="text" name="name" required placeholder="Ambul Thiyal (fish curry)">
      <label>SINHALA NAME (OPTIONAL)</label>
      <input type="text" name="nameSi" placeholder="අඹුල් තියල්">
      <div class="row" style="gap:10px">
        <div style="flex:1"><label>PRICE (${currencyOf(shop).code})</label><input type="number" name="price" required min="0" placeholder="950"></div>
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

export { shell, esc, lkr, shopPrice, fx, pairFor, CUR_SYM, LKR_TO };

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

  // Native app registers its APNs device token here (see NATIVE_BRIDGE).
  if (path === "/app/push/register" && req.method === "POST") {
    let raw = "";
    for await (const ch of req) { raw += ch; if (raw.length > 4096) break; }
    let token = "";
    try { token = String(JSON.parse(raw).token || "").slice(0, 200); } catch { /* bad json */ }
    if (/^[a-f0-9]{32,200}$/i.test(token)) {
      const c = cookies(req);
      await (await col("push_tokens")).updateOne(
        { token },
        { $set: {
            token, platform: "ios",
            kind: c.app_shop ? "shop" : "buyer",
            shopId: c.app_shop || null,
            phone: c.app_phone ? decodeURIComponent(c.app_phone) : null,
            email: c.app_email ? decodeURIComponent(c.app_email) : null,
            updatedAt: new Date(),
        } },
        { upsert: true },
      );
    }
    res.writeHead(204).end();
    return;
  }

  // Map tile proxy — OpenStreetMap blocks apps that omit a User-Agent, and a
  // Capacitor webview can't set one; fetching server-side (same origin as the
  // app) fixes both the "Loading map…" hang and the tile policy block.
  {
    const tm = path.match(/^\/app\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/);
    if (tm) {
      const [z, x, y] = [tm[1], tm[2], tm[3]];
      try {
        const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
          headers: { "User-Agent": "3una5aha/1.0 (https://www.ggmt.sg; gk.smart@ggmt.sg)" },
        });
        if (!r.ok) { res.writeHead(r.status).end("tile error"); return; }
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" });
        res.end(buf);
      } catch {
        res.writeHead(502).end("tile fetch failed");
      }
      return;
    }
  }

  // Geocode proxy — same reasoning: Nominatim needs a User-Agent, set it server-side.
  if (path === "/app/geocode") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    if (!q) { res.writeHead(400, { "Content-Type": "application/json" }).end("[]"); return; }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": "3una5aha/1.0 (https://www.ggmt.sg; gk.smart@ggmt.sg)" } });
      const j = await r.json();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" });
      res.end(JSON.stringify(j));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
    }
    return;
  }

  /* ---- JSON API for the native app (Home / Shop / Orders screens) -----
   * Same data the server-rendered pages use, reshaped as JSON. Public and
   * read-only — no auth beyond an optional buyer phone for order history,
   * matching the existing cookie-free, guest-first design. */

  if (path === "/app/api/home") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const city = url.searchParams.get("city") || "";
    const shops = await activeShops();
    const specials = await (await col("app_dishes")).find({ special: true }).sort({ createdAt: -1 }).limit(8).toArray();
    const shopName = new Map(shops.map((s) => [String(s._id), s.name]));
    const shopCity = new Map(shops.map((s) => [String(s._id), s.city ?? ""]));
    const myCity = city.toLowerCase();

    const flash = specials.map((d) => ({
      id: String(d._id), shopId: d.shopId, name: d.name, nameSi: d.nameSi ?? "",
      price: Number(d.price) || 0, deal: d.discount && d.discount !== "none" ? d.discount : "",
      shop: shopName.get(d.shopId) ?? "", window: d.window ?? "today", photo: d.photo ?? "",
      tag: d.promoTag || "Today special",
      near: myCity && (shopCity.get(d.shopId) || "").toLowerCase().includes(myCity) ? 0 : 1,
    })).sort((a, b) => a.near - b.near);

    let shownShops = shops;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const allDishes = await (await col("app_dishes")).find({}).limit(400).toArray();
      const dishShopIds = new Set(allDishes.filter((d) => rx.test(d.name || "") || rx.test(d.nameSi || "")).map((d) => String(d.shopId)));
      shownShops = shops.filter((s) => rx.test(s.name || "") || rx.test(s.city || "") || dishShopIds.has(String(s._id)));
    }
    const shopList = await Promise.all(shownShops.map(async (s) => {
      const dishes = await dishesFor(s._id);
      const deal = dishes.find((d) => d.discount && d.discount !== "none");
      return {
        id: String(s._id), name: s.name, city: s.city ?? "", logo: s.logo ?? "",
        rating: 4 + ((String(s._id).charCodeAt(10) % 5) + 4) / 10,
        dishes: dishes.length || s.listings || 0, open: s.open !== false,
        deal: deal ? deal.discount : "",
        lat: Number.isFinite(s.lat) ? s.lat : null,
        lng: Number.isFinite(s.lng) ? s.lng : null,
        frontPhoto: s.frontPhoto ?? "",
        photo2: s.photo2 ?? "",
        photo3: s.photo3 ?? "",
      };
    }));

    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ city: city || null, flash, shops: shopList }));
    return;
  }

  const apiShopMatch = path.match(/^\/app\/api\/shop\/([a-f0-9]{24})$/);
  if (apiShopMatch) {
    const shop = await shopById(apiShopMatch[1]);
    if (!shop) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" })); return; }
    const dishes = await dishesFor(shop._id);
    const special = dishes.find((d) => d.special) || null;
    const toDish = (d) => ({
      id: String(d._id), name: d.name, nameSi: d.nameSi ?? "", price: Number(d.price) || 0,
      photo: d.photo ?? "", window: d.window ?? "all day", discount: d.discount && d.discount !== "none" ? d.discount : "",
      category: d.category ?? "",
    });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({
      shop: {
        id: String(shop._id), name: shop.name, city: shop.city ?? "", country: shop.country ?? "",
        logo: shop.logo ?? "", frontPhoto: shop.frontPhoto ?? "", open: shop.open !== false,
      },
      special: special ? { ...toDish(special), tag: special.promoTag || "Today special" } : null,
      dishes: dishes.filter((d) => !d.special).map(toDish),
    }));
    return;
  }

  if (path === "/app/api/orders") {
    const phone = (url.searchParams.get("phone") || "").trim().slice(0, 24);
    const list = phone
      ? await (await col("app_orders")).find({ phone }).sort({ createdAt: -1 }).limit(20).toArray()
      : [];
    const shopIds = [...new Set(list.map((o) => o.shopId))];
    const shopOids = (await Promise.all(shopIds.map(oid))).filter(Boolean);
    const shopNames = new Map(
      (shopOids.length ? await (await col("shop_owners")).find({ _id: { $in: shopOids } }).toArray() : [])
        .map((s) => [String(s._id), s.name]),
    );
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({
      orders: list.map((o) => ({
        id: String(o._id), orderNo: o.orderNo, shop: shopNames.get(o.shopId) ?? "Shop",
        items: o.items ?? [], total: o.total, status: o.status, pickupAt: o.pickupAt ?? "",
        createdAt: o.createdAt,
      })),
    }));
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
    res.setHeader("Set-Cookie", [
      "app_user=; Path=/app; Max-Age=0; SameSite=Lax",
      "app_email=; Path=/app; Max-Age=0; SameSite=Lax",
      "app_shop=; Path=/app; Max-Age=0; SameSite=Lax",
      "app_phone=; Path=/app; Max-Age=0; SameSite=Lax",
      "app_city=; Path=/app; Max-Age=0; SameSite=Lax",
      "app_geo=; Path=/app; Max-Age=0; SameSite=Lax",
    ]);
    redirect(res, "/app");
    return;
  }

  if (path === "/app/login" && req.method === "POST") {
    // Development: static sign-in — records the chosen provider and lands
    // on the deals page. Swapped for real OAuth/SMS in the native phase.
    const form = await readForm(req);
    const via = ["google", "facebook", "apple", "email", "sms"].includes(form.get("via")) ? form.get("via") : "guest";
    if (via === "email") { html(res, emailLoginPage()); return; }
    if (via === "sms") { html(res, smsLoginPage()); return; }
    res.setHeader("Set-Cookie", `app_user=${via}; Path=/app; Max-Age=31536000; SameSite=Lax`);
    redirect(res, "/app/home");
    return;
  }

  if (path === "/app/login-sms" && req.method === "POST") {
    const form = await readForm(req);
    const phone = String(form.get("phone") || "").replace(/[^0-9+]/g, "").slice(0, 20);
    const password = String(form.get("password") || "");
    if (phone.length < 7 || password.length < 6) {
      html(res, smsLoginPage("Enter a valid phone number and a password of at least 6 characters."), 400);
      return;
    }
    // Dev stage: phone+password creates/signs in immediately; verification is a
    // 24h code sent later (red-dot nag until done). No code sent right now.
    const users = await col("app_users");
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    let u = await users.findOne({ phone });
    if (!u) {
      await users.insertOne({ phone, hash, provider: "sms", verified: false, code: "111111", codeAt: new Date(), createdAt: new Date() });
    } else if (u.hash !== hash) {
      html(res, smsLoginPage("Wrong password for this number. Recovery: gk.smart@ggmt.sg"), 401);
      return;
    }
    res.setHeader("Set-Cookie", [
      `app_user=sms; Path=/app; Max-Age=31536000; SameSite=Lax`,
      `app_phone=${encodeURIComponent(phone)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
    ]);
    redirect(res, "/app/home");
    return;
  }

  // Native plugins POST the provider's id_token / access data here.
  if (path === "/app/auth/google" && req.method === "POST") {
    const form = await readForm(req);
    const id = await verifyIdToken(form.get("id_token") || "", {
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      issuers: ["accounts.google.com", "https://accounts.google.com"],
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });
    if (!id?.email) { res.writeHead(401).end("google verify failed"); return; }
    await signInIdentity(res, { provider: "google", email: id.email, name: id.name });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  if (path === "/app/auth/apple" && req.method === "POST") {
    const form = await readForm(req);
    const id = await verifyIdToken(form.get("id_token") || "", {
      jwksUrl: "https://appleid.apple.com/auth/keys",
      issuers: ["https://appleid.apple.com"],
      audience: process.env.APPLE_BUNDLE_ID || "sg.ggmt.una5aha",
    });
    // Apple only sends the name on first sign-in — accept it from the client.
    const email = id?.email || String(form.get("email") || "").toLowerCase();
    if (!email) { res.writeHead(401).end("apple verify failed"); return; }
    await signInIdentity(res, { provider: "apple", email, name: form.get("name") || id?.name });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  if (path === "/app/auth/facebook" && req.method === "POST") {
    const form = await readForm(req);
    const token = String(form.get("access_token") || "");
    if (!token) { res.writeHead(401).end("no token"); return; }
    try {
      const r = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`);
      const fb = await r.json();
      if (!fb?.email) { res.writeHead(401).end("facebook verify failed"); return; }
      await signInIdentity(res, { provider: "facebook", email: fb.email, name: fb.name });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(401).end("facebook error"); }
    return;
  }

  // SMS OTP via Twilio Verify (server holds the secret).
  if (path === "/app/auth/sms/send" && req.method === "POST") {
    const form = await readForm(req);
    const phone = String(form.get("phone") || "").replace(/[^0-9+]/g, "").slice(0, 20);
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, svc = process.env.TWILIO_VERIFY_SID;
    if (!sid || !svc || !phone) { res.writeHead(400).end("sms not configured"); return; }
    try {
      await fetch(`https://verify.twilio.com/v2/Services/${svc}/Verifications`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: phone, Channel: "sms" }),
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ sent: true }));
    } catch { res.writeHead(502).end("sms send failed"); }
    return;
  }

  if (path === "/app/auth/sms/check" && req.method === "POST") {
    const form = await readForm(req);
    const phone = String(form.get("phone") || "").replace(/[^0-9+]/g, "").slice(0, 20);
    const code = String(form.get("code") || "").replace(/[^0-9]/g, "").slice(0, 8);
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, svc = process.env.TWILIO_VERIFY_SID;
    if (!sid || !svc) { res.writeHead(400).end("sms not configured"); return; }
    try {
      const r = await fetch(`https://verify.twilio.com/v2/Services/${svc}/VerificationCheck`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: phone, Code: code }),
      });
      const j = await r.json();
      if (j.status !== "approved") { res.writeHead(401).end("bad code"); return; }
      await signInIdentity(res, { provider: "sms", phone });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    } catch { res.writeHead(502).end("sms check failed"); }
    return;
  }

  if (path === "/app/login-email" && req.method === "POST") {
    const form = await readForm(req);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
      html(res, emailLoginPage("Enter a valid email and a password of at least 6 characters."), 400);
      return;
    }
    if (!["a@a.com", "aa@a.com"].includes(email)) {
      // Real account flow: create on first sign-in, verify by emailed code later.
      const users = await col("app_users");
      const hash = crypto.createHash("sha256").update(password).digest("hex");
      let u = await users.findOne({ email });
      if (!u) {
        const code = newCode();
        await users.insertOne({ email, hash, verified: false, code, codeAt: new Date(), createdAt: new Date() });
        sendVerificationEmail(email, code).catch((e) => console.error(`[auth] verify send error for ${email}: ${e.message}`));
        console.log(`[auth] new account ${email} — verification code emailed, valid 24h`);
      } else if (u.hash !== hash) {
        html(res, emailLoginPage("Wrong password for this email. Access recovery: gk.smart@ggmt.sg"), 401);
        return;
      }
      res.setHeader("Set-Cookie", [
        `app_user=email; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_email=${encodeURIComponent(email)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
      ]);
      redirect(res, "/app/home");
      return;
    }
    if (password !== "111111") {
      html(res, emailLoginPage("Wrong password."), 401);
      return;
    }
    // Make sure the demo accounts have an app_users row so /app/profile renders
    // as signed-in (personal Account) — buyer and owner both need this.
    await (await col("app_users")).updateOne(
      { email },
      { $setOnInsert: { email, provider: "email", verified: true, createdAt: new Date() } },
      { upsert: true },
    );
    // If this email owns a shop, land on its dashboard; otherwise browse as buyer.
    const ownShop = await (await col("shop_owners")).findOne({ email });
    if (ownShop) {
      res.setHeader("Set-Cookie", [
        `app_user=email; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_email=${encodeURIComponent(email)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_shop=${String(ownShop._id)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
      ]);
      redirect(res, `/app/owner/${String(ownShop._id)}`);
    } else {
      res.setHeader("Set-Cookie", [
        `app_user=email; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_email=${encodeURIComponent(email)}; Path=/app; Max-Age=31536000; SameSite=Lax`,
      ]);
      redirect(res, "/app/home");
    }
    return;
  }

  if (path === "/app/profile") {
    if (req.method === "POST") {
      const email = decodeURIComponent(cookies(req).app_email || "");
      if (!email) { redirect(res, "/app/profile"); return; }
      const form = await readForm(req, 3_500_000); // up to 4 shop photos for owners
      const avatar = String(form.get("avatar") || "");
      const avatarOk = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar) && avatar.length < 400_000;
      const phone = String(form.get("phone") || "").trim().slice(0, 24);
      const lang = LANG_OPTIONS.includes(form.get("lang")) ? form.get("lang") : "en";
      const currency = CURRENCY_CODES.includes(form.get("currency")) ? form.get("currency") : "LKR";
      const diet = (form.getAll ? form.getAll("diet") : []).filter((d) => DIET_OPTIONS.includes(d));
      const cuisines = (form.getAll ? form.getAll("cuisine") : []).filter((c) => CUISINE_OPTIONS.includes(c));
      await (await col("app_users")).updateOne({ email }, { $set: {
        name: String(form.get("name") || "").trim().slice(0, 60),
        phone,
        whatsapp: String(form.get("whatsapp") || "").trim().slice(0, 24),
        telegram: String(form.get("telegram") || "").trim().slice(0, 40),
        city: String(form.get("city") || "").trim().slice(0, 80),
        currency, lang, diet, cuisines,
        ...(avatarOk ? { avatar } : {}),
      } });
      // If this user owns a shop, also persist the 4 shop photos when supplied.
      const ownShop = await (await col("shop_owners")).findOne({ email });
      if (ownShop) {
        const photoOk = (v) => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 600_000;
        const shopSet = {};
        const front = String(form.get("frontPhoto") || "");
        if (photoOk(front)) shopSet.frontPhoto = front;
        for (const n of [2, 3, 4]) {
          const v = String(form.get("photo" + n) || "");
          if (photoOk(v)) shopSet["photo" + n] = v;
        }
        if (Object.keys(shopSet).length) {
          await (await col("shop_owners")).updateOne({ _id: ownShop._id }, { $set: shopSet });
        }
      }
      res.setHeader("Set-Cookie", `app_phone=${encodeURIComponent(phone)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
      html(res, await userProfilePage({ headers: { cookie: (req.headers.cookie || "").replace(/app_phone=[^;]*/, "app_phone=" + encodeURIComponent(phone)) } }, "Profile saved"));
    } else {
      html(res, await userProfilePage(req));
    }
    return;
  }

  if (path === "/app/profile/password" && req.method === "POST") {
    const email = decodeURIComponent(cookies(req).app_email || "");
    const form = await readForm(req);
    const users = await col("app_users");
    const u = email ? await users.findOne({ email }) : null;
    const oldHash = crypto.createHash("sha256").update(String(form.get("old") || "")).digest("hex");
    if (!u || u.hash !== oldHash) {
      html(res, await userProfilePage(req, "Old password didn't match"));
      return;
    }
    const next = String(form.get("next") || "");
    if (next.length < 6) { html(res, await userProfilePage(req, "New password too short")); return; }
    await users.updateOne({ email }, { $set: { hash: crypto.createHash("sha256").update(next).digest("hex") } });
    html(res, await userProfilePage(req, "Password changed"));
    return;
  }

  if (path === "/app/profile/reset-send" && req.method === "POST") {
    const email = decodeURIComponent(cookies(req).app_email || "");
    if (email) {
      const rc = newCode();
      await (await col("app_users")).updateOne({ email }, { $set: { resetCode: rc, resetAt: new Date() } });
      sendPasswordResetEmail(email, rc).catch((e) => console.error(`[auth] reset send error for ${email}: ${e.message}`));
      console.log(`[auth] password reset code emailed to ${email}`);
    }
    redirect(res, "/app/profile/reset");
    return;
  }

  if (path === "/app/profile/reset") {
    const email = decodeURIComponent(cookies(req).app_email || "");
    if (!email) { redirect(res, "/app/profile"); return; }
    if (req.method === "POST") {
      const form = await readForm(req);
      const users = await col("app_users");
      const u = await users.findOne({ email });
      const fresh = u?.resetAt && Date.now() - new Date(u.resetAt).getTime() < 24 * 3600 * 1000;
      if (!u || !fresh || String(form.get("code") || "").trim() !== u.resetCode) {
        html(res, resetPage("Code wrong or expired — send a fresh one from Profile."), 401);
        return;
      }
      const next = String(form.get("next") || "");
      if (next.length < 6) { html(res, resetPage("New password too short.")); return; }
      await users.updateOne({ email }, {
        $set: { hash: crypto.createHash("sha256").update(next).digest("hex") },
        $unset: { resetCode: "", resetAt: "" },
      });
      html(res, await userProfilePage(req, "Password changed"));
    } else {
      html(res, resetPage());
    }
    return;
  }

  if (path === "/app/verify") {
    const email = decodeURIComponent(cookies(req).app_email || "");
    if (!email) { redirect(res, "/app"); return; }
    if (req.method === "POST") {
      const form = await readForm(req);
      const code = String(form.get("code") || "").trim();
      const users = await col("app_users");
      const u = await users.findOne({ email });
      if (!u) { redirect(res, "/app"); return; }
      const fresh = u.codeAt && Date.now() - new Date(u.codeAt).getTime() < 24 * 3600 * 1000;
      if (!fresh) {
        const fresh6 = newCode();
        await users.updateOne({ email }, { $set: { code: fresh6, codeAt: new Date() } });
        sendVerificationEmail(email, fresh6).catch((e) => console.error(`[auth] verify resend error for ${email}: ${e.message}`));
        html(res, verifyPage(email, "That code has expired (codes last 24 hours) — a new one was just emailed."), 401);
        console.log(`[auth] resent verification code to ${email}`);
        return;
      }
      if (code !== u.code) {
        html(res, verifyPage(email, "That code didn't match — check the email from gk.smart@ggmt.sg."), 401);
        return;
      }
      await users.updateOne({ email }, { $set: { verified: true }, $unset: { code: "", codeAt: "" } });
      redirect(res, "/app/home");
    } else {
      html(res, verifyPage(email));
    }
    return;
  }

  if (path === "/app/terms") { html(res, termsPage()); return; }
  if (path === "/app/privacy") { html(res, privacyPage()); return; }
  if (path === "/app/support") { html(res, supportPage()); return; }

  if (path === "/app/home") {
    html(res, await homePage(req, url));
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
    const rawT = url.searchParams.get("t");
    const tableN = rawT && /^\d{1,2}$/.test(rawT) ? Math.max(1, Math.min(25, Number(rawT))) : 0;
    const page = await shopPage(m[1], { tableN });
    if (page) { html(res, page); return; }
  }

  // Short QR-friendly URL: /m/<slug>  or  /m/<slug>/<table>
  // Resolves the slug → shop._id and 303-redirects to the full route.
  m = path.match(/^\/m\/([a-z0-9-]{2,40})(?:\/(\d{1,2}))?$/);
  if (m) {
    const shop = await (await col("shop_owners")).findOne({ slug: m[1] });
    if (shop) {
      const t = m[2] ? `?t=${Number(m[2])}` : "";
      redirect(res, `/app/shop/${String(shop._id)}${t}`);
      return;
    }
  }

  if (path === "/app/order" && req.method === "POST") {
    const form = await readForm(req);
    let items = [];
    try { items = JSON.parse(form.get("items") || "[]"); } catch { /* empty basket */ }
    items = items
      .filter((i) => i && i.name && Number(i.qty) > 0)
      .map((i) => ({ name: String(i.name).slice(0, 80), qty: Math.min(Number(i.qty), 50), price: Number(i.price) || 0 }));
    if (!items.length) { redirect(res, "/app/home"); return; }
    const rawT = String(form.get("tableN") || "").trim();
    const tableN = /^\d{1,2}$/.test(rawT) ? Math.max(1, Math.min(25, Number(rawT))) : 0;
    const phone = String(form.get("phone") || "").slice(0, 24);
    // Global running order number — atomic counter, superadmin-visible only.
    const counter = await (await col("counters")).findOneAndUpdate(
      { _id: "orderNo" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" },
    );
    const orderNo = counter?.seq ?? counter?.value?.seq ?? 1;
    const c2 = cookies(req);
    const nativeHeader = (req.headers["x-app-source"] || "").toLowerCase() === "app";
    const source = tableN ? "table" : ((c2.native === "1" || nativeHeader) ? "app" : "ecom");
    const doc = {
      orderNo,
      shopId: String(form.get("shopId") || ""),
      items,
      total: items.reduce((a, i) => a + i.qty * i.price, 0),
      buyer: tableN ? `Table ${tableN}` : String(form.get("buyer") || "").slice(0, 60),
      phone: tableN ? "" : phone,
      pickupAt: tableN ? `dine-in · Table ${tableN}` : String(form.get("pickupAt") || "").slice(0, 24),
      type: tableN ? "table" : "pickup",
      source,
      ...(tableN ? { tableN } : {}),
      status: "pending_review",
      messages: [],
      createdAt: new Date(),
    };
    const r = await (await col("app_orders")).insertOne(doc);
    if (!tableN) {
      res.setHeader("Set-Cookie", `app_phone=${encodeURIComponent(phone)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
    }
    redirect(res, `/app/order/${r.insertedId}`);
    // Native push to the shop owner's devices — fire-and-forget.
    notifyShop(doc.shopId, {
      title: tableN ? `🍽 Table ${tableN} order` : "New order 🍛",
      body: `${items.reduce((a, i) => a + i.qty, 0)} item(s) · ${lkr(doc.total)}${doc.buyer ? ` — ${doc.buyer}` : ""}`,
      url: `/app/owner/${doc.shopId}/dishes`,
    }).catch(() => {});
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

  m = path.match(/^\/app\/dish\/([a-f0-9]{24})\/(like|pass)$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[1]);
    if (_id) {
      await (await col("app_dishes")).updateOne({ _id }, { $inc: { [m[2] === "like" ? "likes" : "passes"]: 1 } });
    }
    res.writeHead(204).end();
    return;
  }

  m = path.match(/^\/app\/fav\/([a-f0-9]{24})$/);
  if (m && req.method === "POST") {
    const favs = (cookies(req).app_favs || "").split("|").filter(Boolean);
    const i = favs.indexOf(m[1]);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(m[1]);
    res.setHeader("Set-Cookie", `app_favs=${favs.slice(0, 30).join("|")}; Path=/app; Max-Age=31536000; SameSite=Lax`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ fav: i < 0 }));
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
      const geo = String(form.get("geo") || "").slice(0, 24);
      res.setHeader("Set-Cookie", [
        `app_city=${city}; Path=/app; Max-Age=31536000; SameSite=Lax`,
        `app_phone=${phone}; Path=/app; Max-Age=31536000; SameSite=Lax`,
        ...(/^-?\d+\.\d+,-?\d+\.\d+$/.test(geo) ? [`app_geo=${geo}; Path=/app; Max-Age=31536000; SameSite=Lax`] : []),
      ]);
      redirect(res, "/app/home");
    } else {
      html(res, await locationPage(req));
    }
    return;
  }

  // Shop Manager entry point — resolves the signed-in owner's shop from
  // the session (works for email/Apple/Google/SMS login) and jumps to the
  // owner hub. The native app's "Shop Manager" tab + button point here.
  if (path === "/app/manager") {
    const c = cookies(req);
    // Fast path: app_shop cookie already set (email login sets it).
    if (c.app_shop) { redirect(res, `/app/owner/${c.app_shop}`); return; }
    // Otherwise look the owner up by their signed-in email.
    const email = c.app_email ? decodeURIComponent(c.app_email).toLowerCase() : "";
    if (email) {
      const ownShop = await (await col("shop_owners")).findOne({ email });
      if (ownShop) {
        res.setHeader("Set-Cookie", `app_shop=${String(ownShop._id)}; Path=/app; Max-Age=31536000; SameSite=Lax`);
        redirect(res, `/app/owner/${String(ownShop._id)}`);
        return;
      }
    }
    // Signed in but no shop yet (or not signed in) — send to the welcome /
    // "open your shop" flow.
    html(res, shell({
      title: "Shop Manager — 3una 5aha",
      hideLogout: true,
      body: `
      <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/home">‹</a><h1 style="font-size:21px">Shop Manager <span class="si">සාප්පු කළමනාකරු</span></h1></div>
      <div class="card" style="margin-top:14px;padding:16px;text-align:center">
        <div style="font-size:34px">🏪</div>
        <strong style="display:block;margin-top:8px;font-size:15px">You don't have a shop yet</strong>
        <p class="sub" style="font-size:13px;margin-top:6px">Shop Manager is where restaurants and home cooks manage their menu, kitchen stock, purchase planning and more — all free.<br><span class="si">ඔබට තවම සාප්පුවක් නැත. නොමිලේ එකක් විවෘත කරන්න.</span></p>
        <a class="btn" style="margin-top:14px" href="/app">Open your shop — free</a>
        ${email ? "" : `<a class="btn ghost" style="margin-top:10px" href="/app">Sign in first</a>`}
      </div>`,
    }));
    return;
  }

  // Market prices — curated typical retail from Cargills / Keells / Manning.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/market-prices$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (!shop) { res.writeHead(404).end("not found"); return; }
    const [{ marketPricesPage }, { MARKET_PRICES }] = await Promise.all([
      import("./shop-suite.mjs"),
      import("../data/market-prices.mjs"),
    ]);
    html(res, marketPricesPage(shop, { prices: MARKET_PRICES }));
    return;
  }

  // Owner hub — 13 round buttons, one per shop function.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/suite\/([a-z]+)$/);
  if (m) {
    const { suitePage } = await import("./shop-suite.mjs");
    const shop = await shopById(m[1]);
    // Menu page needs the shop's real dishes + any already-saved set meals.
    const extras = {};
    if (shop && m[2] === "menu") {
      const dishesCol = await col("app_dishes");
      const allDishes = await dishesCol.find({ shopId: m[1] }).sort({ createdAt: -1 }).toArray();
      extras.singles = allDishes.filter((d) => d.type !== "set");
      extras.sets = allDishes.filter((d) => d.type === "set");
      extras.msg = url.searchParams.get("msg") || "";
      // Pull the current dish catalogue from Mongo — auto-picks up new
      // dishes added via the newsroom without needing a code redeploy.
      extras.presetDishes = await loadPresetDishes(await col("lanka_dishes"));
    }
    // POS needs the shop's dishes (with price + photo) + today's sales totals.
    if (shop && m[2] === "kitchen") {
      extras.kitchenOrders = await (await col("app_orders"))
        .find({ shopId: m[1], status: { $in: ["pending", "preparing", "done"] } })
        .sort({ status: 1, createdAt: 1 }).toArray();
    }
    if (shop && m[2] === "pos") {
      extras.currency = currencyOf(shop);
      extras.dishes = await (await col("app_dishes"))
        .find({ shopId: m[1], type: { $ne: "set" } }).sort({ createdAt: -1 }).toArray();
      extras.pendingOrders = await (await col("app_orders"))
        .find({ shopId: m[1], status: "pending_review" }).sort({ createdAt: -1 }).limit(20).toArray();
      extras.onHoldCount = await (await col("app_orders"))
        .countDocuments({ shopId: m[1], status: "on_hold" });
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todays = await (await col("app_orders"))
        .find({ shopId: m[1], createdAt: { $gte: startOfDay } })
        .project({ total: 1, status: 1 }).toArray();
      const count = (s) => todays.filter((o) => s.includes(o.status)).length;
      extras.statusCounts = {
        waiting: count(["pending_review"]),
        kitchen: count(["pending", "preparing"]),
        ready: count(["done"]),
        delivered: count(["delivered"]),
      };
      const kitchenBound = todays.filter((o) => ["pending", "preparing", "done", "delivered"].includes(o.status));
      extras.todaysSales = {
        count: kitchenBound.length,
        total: kitchenBound.reduce((n, b) => n + (Number(b.total) || 0), 0),
      };
    }
    // Purchase Planner also needs the dish catalogue for its dish picker.
    if (shop && m[2] === "plan") {
      extras.presetDishes = await loadPresetDishes(await col("lanka_dishes"));
      extras.currency = currencyOf(shop);
      // Items the owner flagged 🛒 in Kitchen Stock — surface at the top.
      extras.storeBuys = await (await col("kitchen_stock"))
        .find({ shopId: m[1], buyNext: true }).sort({ buyNextAt: -1 }).toArray();
      // Supplier dropdown for each buy line.
      extras.suppliers = await (await col("suppliers"))
        .find({ shopId: m[1] }).sort({ name: 1 }).toArray();
      // Market-price benchmarks so each row shows paid vs market ▲/▼%.
      const { MARKET_PRICES } = await import("../data/market-prices.mjs");
      extras.marketPrices = MARKET_PRICES;
    }
    // Kitchen Stock: the categorised ingredient catalogue + the shop's
    // saved store contents.
    if (shop && m[2] === "stock") {
      extras.ingredientCats = LANKA_INGREDIENTS;
      extras.units = STOCK_UNITS;
      extras.msg = url.searchParams.get("msg") || "";
      extras.currency = currencyOf(shop);
      extras.stock = await (await col("kitchen_stock"))
        .find({ shopId: m[1] }).sort({ category: 1, name: 1 }).toArray();
      extras.ingredientPhotos = await getIngredientPhotoMap();
    }
    // Bill History: supplier directory + bill counts (optionally filtered
    // by year/month) + the selected supplier's bill photos.
    if (shop && m[2] === "history") {
      extras.suppliers = await (await col("suppliers"))
        .find({ shopId: m[1] }).sort({ createdAt: 1 }).toArray();
      const year = url.searchParams.get("y") || "";
      const month = url.searchParams.get("m") || "";
      extras.year = year;
      extras.month = month;
      extras.currency = currencyOf(shop);
      // Bill filter: same period the user picked in the header.
      const periodFilter = {};
      if (year) {
        const y = Number(year);
        const mi = month ? Number(month) - 1 : 0;
        const start = new Date(y, mi, 1);
        const end = month ? new Date(y, mi + 1, 1) : new Date(y + 1, 0, 1);
        periodFilter.uploadedAt = { $gte: start, $lt: end };
      }
      // Per-supplier bill counts within the picked period.
      const rows = await (await col("supplier_bills")).aggregate([
        { $match: { shopId: m[1], ...periodFilter } },
        { $group: { _id: "$supplierId", n: { $sum: 1 } } },
      ]).toArray();
      extras.billsBySupplier = Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
      const supId = url.searchParams.get("sup");
      if (supId && /^[a-f0-9]{24}$/i.test(supId)) {
        extras.selectedSupplierId = supId;
        extras.selectedBills = await (await col("supplier_bills"))
          .find({ shopId: m[1], supplierId: supId, ...periodFilter })
          .sort({ uploadedAt: -1 })
          .toArray();
      }
    }
    // Buying & bills: surface items running low from the shop's own stock
    // + the shop's supplier directory.
    if (shop && m[2] === "purchasing") {
      const LOW_DEFAULT = { kg: 2, L: 2, g: 500, ml: 500, nos: 6, packs: 1, pcs: 5 };
      const all = await (await col("kitchen_stock"))
        .find({ shopId: m[1] }).toArray();
      extras.runningLow = all
        .filter((s) => {
          const threshold = s.minQty != null && s.minQty !== "" ? Number(s.minQty) : (LOW_DEFAULT[s.unit] ?? 1);
          return Number(s.qty) <= threshold;
        })
        .sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0));
      extras.suppliers = await (await col("suppliers"))
        .find({ shopId: m[1] }).sort({ createdAt: 1 }).toArray();
      // Count of items assigned to each supplier, keyed by supplier _id string.
      extras.itemsBySupplier = {};
      for (const it of all) {
        if (it.buySupplierId) {
          const k = String(it.buySupplierId);
          (extras.itemsBySupplier[k] = extras.itemsBySupplier[k] || []).push(it);
        }
      }
      // Bill photo counts per supplier so each card can show a badge.
      const billCounts = await (await col("supplier_bills")).aggregate([
        { $match: { shopId: m[1] } },
        { $group: { _id: "$supplierId", n: { $sum: 1 } } },
      ]).toArray();
      extras.billsBySupplier = Object.fromEntries(billCounts.map((b) => [String(b._id), b.n]));
      // Which supplier is currently expanded (?sup=<id> in the URL)?
      const supId = url.searchParams.get("sup");
      if (supId && /^[a-f0-9]{24}$/i.test(supId)) {
        extras.selectedSupplierId = supId;
      }
    }
    const pageHtml = shop ? suitePage(shop, m[2], extras) : null;
    if (pageHtml) { html(res, pageHtml); return; }
    res.writeHead(404).end("not found");
    return;
  }

  // Create a set-meal (composed of picked dishes) — Phase 1 wiring, no AI yet.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/menu\/set$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const name = String(form.get("name") || "").trim().slice(0, 80);
    const pickedIds = form.getAll("dishId").map(String).slice(0, 20);
    const price = Math.max(0, Number(form.get("price")) || 0);
    if (name && pickedIds.length && price > 0) {
      const dishesCol = await col("app_dishes");
      const oids = (await Promise.all(pickedIds.map(oid))).filter(Boolean);
      const picked = await dishesCol.find({ _id: { $in: oids }, shopId: m[1] }).toArray();
      const components = picked.map((d) => ({ dishId: String(d._id), name: d.name, price: Number(d.price) || 0 }));
      await dishesCol.insertOne({
        shopId: m[1],
        type: "set",
        name,
        nameSi: "",
        price,
        portions: Math.max(1, Number(form.get("portions")) || 10),
        window: "All day",
        discount: "none",
        components,
        createdAt: new Date(),
      });
      const shopOid = await oid(m[1]);
      if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: 1 } });
      redirect(res, `/app/owner/${m[1]}/suite/menu?msg=${encodeURIComponent("Set meal saved")}`);
      return;
    }
    redirect(res, `/app/owner/${m[1]}/suite/menu?msg=${encodeURIComponent("Pick a name, at least one dish, and a price.")}`);
    return;
  }

  // Kitchen Stock: add or update an ingredient in the shop's store.
  // Upsert by shopId+name so re-adding the same item updates its qty.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/stock\/add$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const name = String(form.get("name") || "").trim().slice(0, 60);
    const qty = Math.max(0, Number(form.get("qty")) || 0);
    const unit = STOCK_UNITS.includes(form.get("unit")) ? form.get("unit") : "kg";
    const price = Math.max(0, Number(form.get("price")) || 0); // optional LKR per unit
    // Category comes from the form but we trust the ingredient index if known.
    const known = INGREDIENT_INDEX[name.toLowerCase()];
    const category = known ? known.category : String(form.get("category") || "Vegi").slice(0, 20);
    const si = known ? known.si : String(form.get("si") || "").slice(0, 60);
    if (name && qty > 0) {
      await (await col("kitchen_stock")).updateOne(
        { shopId: m[1], name },
        { $set: { shopId: m[1], name, category, si, qty, unit, price, updatedAt: new Date() },
          $setOnInsert: { addedAt: new Date() } },
        { upsert: true },
      );
      redirect(res, `/app/owner/${m[1]}/suite/stock?msg=${encodeURIComponent(`${name} saved to store`)}`);
      return;
    }
    redirect(res, `/app/owner/${m[1]}/suite/stock?msg=${encodeURIComponent("Pick an ingredient and a quantity.")}`);
    return;
  }

  // Kitchen Stock: remove an ingredient from the store.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/stock\/([a-f0-9]{24})\/remove$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) await (await col("kitchen_stock")).deleteOne({ _id, shopId: m[1] });
    redirect(res, `/app/owner/${m[1]}/suite/stock?msg=${encodeURIComponent("Removed from store")}`);
    return;
  }

  // Suppliers: add a new supplier to the shop's directory.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/suppliers\/add$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const name = String(form.get("name") || "").trim().slice(0, 80);
    let mapsUrl = String(form.get("mapsUrl") || "").trim().slice(0, 300);
    if (mapsUrl && !/^https?:\/\//.test(mapsUrl)) mapsUrl = "https://" + mapsUrl;
    const validCats = new Set(["Vegi", "Meat", "Dry", "Spice"]);
    const cats = (form.getAll ? form.getAll("cat") : []).filter((c) => validCats.has(c));
    if (name) {
      await (await col("suppliers")).insertOne({
        shopId: m[1], name, mapsUrl, categories: cats, createdAt: new Date(),
      });
      redirect(res, `/app/owner/${m[1]}/suite/purchasing?msg=${encodeURIComponent(`${name} added`)}`);
    } else {
      redirect(res, `/app/owner/${m[1]}/suite/purchasing?msg=${encodeURIComponent("Supplier name required")}`);
    }
    return;
  }

  // POS: ring up a sale — accepts JSON {items:[{id,name,price,qty}]}.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/pos\/ring$/);
  if (m && req.method === "POST") {
    const body = await readBody(req, 60_000);
    let doc;
    try { doc = JSON.parse(body || "{}"); } catch { doc = {}; }
    const items = Array.isArray(doc.items) ? doc.items.slice(0, 40) : [];
    const cleaned = items
      .filter((i) => i && typeof i.name === "string" && i.name.length <= 80 && Number(i.price) >= 0 && Number(i.qty) > 0 && Number(i.qty) <= 999)
      .map((i) => ({ name: String(i.name).slice(0, 80), price: Number(i.price) || 0, qty: Math.min(999, Math.round(Number(i.qty))) }));
    if (!cleaned.length) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "empty basket" })); return; }
    const total = cleaned.reduce((n, i) => n + i.price * i.qty, 0);
    // Counter clerk built + is submitting this cart — treat as already reviewed:
    // straight to `pending` (kitchen queue), no pending_review pit-stop.
    const cx = await (await col("counters")).findOneAndUpdate(
      { _id: "orderNo" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" },
    );
    const orderNo = cx?.seq ?? cx?.value?.seq ?? 1;
    const insert = await (await col("app_orders")).insertOne({
      orderNo, shopId: m[1], items: cleaned, total,
      buyer: "Counter", phone: "", pickupAt: "counter",
      type: "counter", source: "counter", status: "pending",
      messages: [], createdAt: new Date(),
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, total, orderId: String(insert.insertedId) }));
    return;
  }

  // Kitchen: advance an order along the pipeline (pending→preparing→done→delivered).
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/kitchen\/order\/([a-f0-9]{24})\/advance$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    let body = {};
    try { body = JSON.parse((await readBody(req, 200)) || "{}"); } catch { /* empty */ }
    const to = String(body.to || "");
    const valid = { preparing: ["pending"], done: ["preparing"], delivered: ["done"] };
    if (_id && valid[to]) {
      await (await col("app_orders")).updateOne(
        { _id, shopId: m[1], status: { $in: valid[to] } },
        { $set: { status: to, [`${to}At`]: new Date() } },
      );
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  // POS: shop clerk reviews an incoming order and sends it to the kitchen.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/pos\/order\/([a-f0-9]{24})\/(send-to-kitchen|hold)$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const nextStatus = m[3] === "send-to-kitchen" ? "pending" : "on_hold";
      await (await col("app_orders")).updateOne(
        { _id, shopId: m[1], status: { $in: ["pending_review", "on_hold"] } },
        { $set: { status: nextStatus, reviewedAt: new Date() } },
      );
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  // Bills: delete a single bill photo (from the Bill History modal).
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/bills\/([a-f0-9]{24})\/remove$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) await (await col("supplier_bills")).deleteOne({ _id, shopId: m[1] });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  // Suppliers: upload a bill photo (Base64 JPEG data URI).
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/suppliers\/([a-f0-9]{24})\/bills$/);
  if (m && req.method === "POST") {
    const form = await readForm(req, 5_000_000);
    const image = String(form.get("image") || "");
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 4_500_000) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "bad image" }));
      return;
    }
    await (await col("supplier_bills")).insertOne({
      shopId: m[1], supplierId: m[2], image, uploadedAt: new Date(),
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return;
  }

  // Suppliers: remove a supplier from the directory.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/suppliers\/([a-f0-9]{24})\/remove$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) await (await col("suppliers")).deleteOne({ _id, shopId: m[1] });
    redirect(res, `/app/owner/${m[1]}/suite/purchasing?msg=${encodeURIComponent("Supplier removed")}`);
    return;
  }

  // Purchasing plan: set which supplier will supply this item + planned buy qty.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/stock\/([a-f0-9]{24})\/buy-plan$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const form = await readForm(req);
      const supRaw = String(form.get("buySupplierId") || "").trim();
      const buySupplierId = supRaw && /^[a-f0-9]{24}$/i.test(supRaw) ? supRaw : null;
      const bqRaw = form.get("buyQty");
      const buyQty = bqRaw != null && bqRaw !== "" ? Math.max(0, Number(bqRaw)) : null;
      await (await col("kitchen_stock")).updateOne({ _id, shopId: m[1] },
        { $set: { buySupplierId, buyQty, buyPlanAt: new Date() } });
    }
    redirect(res, `/app/owner/${m[1]}/suite/plan?msg=${encodeURIComponent("Saved")}`);
    return;
  }

  // Kitchen Stock: toggle 'buyNext' so the item lands in the Purchase Plan.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/stock\/([a-f0-9]{24})\/buy$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const cur = await (await col("kitchen_stock")).findOne({ _id, shopId: m[1] });
      const next = !cur?.buyNext;
      await (await col("kitchen_stock")).updateOne({ _id, shopId: m[1] },
        { $set: { buyNext: next, buyNextAt: next ? new Date() : null } });
      const msg = next ? `${cur?.name || "Item"} sent to Purchase Plan` : "Removed from Purchase Plan";
      redirect(res, `/app/owner/${m[1]}/suite/stock?msg=${encodeURIComponent(msg)}`);
    } else {
      redirect(res, `/app/owner/${m[1]}/suite/stock`);
    }
    return;
  }

  // Kitchen Stock: edit qty / unit / price / min-max for an existing item.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/stock\/([a-f0-9]{24})\/edit$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const form = await readForm(req);
      const qty = Math.max(0, Number(form.get("qty")) || 0);
      const price = Math.max(0, Number(form.get("price")) || 0);
      const unit = STOCK_UNITS.includes(form.get("unit")) ? form.get("unit") : undefined;
      const minRaw = form.get("minQty");
      const maxRaw = form.get("maxQty");
      const minQty = minRaw != null && minRaw !== "" ? Math.max(0, Number(minRaw)) : null;
      const maxQty = maxRaw != null && maxRaw !== "" ? Math.max(0, Number(maxRaw)) : null;
      const set = { qty, price, minQty, maxQty, updatedAt: new Date() };
      if (unit) set.unit = unit;
      await (await col("kitchen_stock")).updateOne({ _id, shopId: m[1] }, { $set: set });
    }
    redirect(res, `/app/owner/${m[1]}/suite/stock?msg=${encodeURIComponent("Updated")}`);
    return;
  }

  // AI: generate per-serving ingredient recipe for a Sri Lankan dish name.
  // Cached in `app_dish_recipes` (keyed by lowercased dish name) — repeat
  // queries for the same dish don't re-hit Gemini.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dishes\/ai-recipe$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const dish = String(form.get("dish") || "").trim().slice(0, 80);
    if (!dish) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: "dish name required" })); return; }
    const cache = await col("app_dish_recipes");
    const r = await generateRecipe(dish, cache);
    if (!r.ok) { res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify(r)); return; }
    // Attach price + matched-library-name to each ingredient so the UI
    // can show cost without a second round-trip.
    const priced = r.recipe.ingredients.map((ing) => {
      const p = priceIngredient(ing.name, ing.quantity, ing.unit);
      return { ...ing, lkr: p.lkr, matched: p.matched };
    });
    const totalLkr = priced.reduce((s, i) => s + (Number(i.lkr) || 0), 0);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      ok: true, cached: !!r.cached, dish, servings: r.recipe.servings || 1,
      ingredients: priced, totalLkr: Math.round(totalLkr * 10) / 10,
      methodSummary: r.recipe.methodSummary || "",
    }));
    return;
  }

  // Save a single dish with an attached recipe (from the AI-assisted flow).
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dishes\/ai-save$/);
  if (m && req.method === "POST") {
    const form = await readForm(req);
    const name = String(form.get("name") || "").trim().slice(0, 80);
    const price = Math.max(0, Number(form.get("price")) || 0);
    const portions = Math.max(1, Number(form.get("portions")) || 20);
    let recipe = null;
    try { recipe = JSON.parse(String(form.get("recipe") || "null")); } catch {}
    if (name && price > 0) {
      await (await col("app_dishes")).insertOne({
        shopId: m[1], type: "single", name, nameSi: "",
        price, portions, window: String(form.get("window") || "All day").slice(0, 20),
        discount: "none", special: false, promoTag: "Today special",
        ...(recipe && Array.isArray(recipe.ingredients) ? { recipe } : {}),
        createdAt: new Date(),
      });
      const shopOid = await oid(m[1]);
      if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: 1 } });
      redirect(res, `/app/owner/${m[1]}/suite/menu?msg=${encodeURIComponent("Dish saved")}`);
      return;
    }
    redirect(res, `/app/owner/${m[1]}/suite/menu?msg=${encodeURIComponent("Name + price required.")}`);
    return;
  }

  // Remove a set meal.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/menu\/set\/([a-f0-9]{24})\/remove$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      await (await col("app_dishes")).deleteOne({ _id, shopId: m[1], type: "set" });
      const shopOid = await oid(m[1]);
      if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: -1 } });
    }
    redirect(res, `/app/owner/${m[1]}/suite/menu?msg=${encodeURIComponent("Set meal removed")}`);
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})$/);
  if (m) {
    const { ownerHubPage } = await import("./shop-suite.mjs");
    const shop = await shopById(m[1]);
    if (!shop) { res.writeHead(404).end("not found"); return; }
    html(res, ownerHubPage(shop, (url.searchParams.get("msg") || "").slice(0, 60)));
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dishes$/);
  if (m) {
    const page = await ownerDash(m[1], (url.searchParams.get("msg") || "").slice(0, 60));
    if (page) { html(res, page); return; }
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/toggle$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[1]);
    const shop = _id && (await (await col("shop_owners")).findOne({ _id }));
    if (shop) await (await col("shop_owners")).updateOne({ _id }, { $set: { open: shop.open === false } });
    redirect(res, `/app/owner/${m[1]}/dishes?msg=${encodeURIComponent(shop && shop.open === false ? "You're open" : "You're closed")}`);
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
      // Tell the buyer's devices — fire-and-forget.
      const order = await (await col("app_orders")).findOne({ _id });
      if (order?.phone) {
        notifyBuyer(order.phone, {
          title: status === "done" ? "Order ready 🎉" : "Order confirmed 👨‍🍳",
          body: status === "done" ? "Your order is ready for pickup." : "The kitchen is preparing your order.",
          url: "/app/orders",
        }).catch(() => {});
      }
    }
    redirect(res, `/app/owner/${m[1]}/dishes?msg=${encodeURIComponent("Order updated")}`);
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/profile$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (!shop) { res.writeHead(404).end("not found"); return; }
    if (req.method === "POST") {
      const form = await readForm(req, 3_500_000); // up to 5 photos (logo + 4)
      const name = String(form.get("name") || "").trim().slice(0, 80);
      const owner = String(form.get("owner") || "").trim().slice(0, 60);
      const logo = String(form.get("logo") || "");
      const logoOk = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length < 500_000;
      const photoOk = (v) => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 600_000;
      const front = String(form.get("frontPhoto") || "");
      const urlish = (v) => { v = String(v || "").trim().slice(0, 200); return v && !/^https?:\/\//.test(v) ? "https://" + v : v; };
      const currency = CURRENCY_CODES.includes(form.get("currency")) ? form.get("currency") : "LKR";
      const set = {
        ...(name ? { name } : {}), owner, currency,
        ...(logoOk ? { logo } : {}),
        ...(photoOk(front) ? { frontPhoto: front } : {}),
        ...([2, 3, 4].reduce((acc, n) => {
          const v = String(form.get("photo" + n) || "");
          if (photoOk(v)) acc["photo" + n] = v;
          return acc;
        }, {})),
        mapsUrl: urlish(form.get("mapsUrl")),
        facebook: urlish(form.get("facebook")),
        instagram: String(form.get("instagram") || "").trim().slice(0, 120),
        tiktok: String(form.get("tiktok") || "").trim().slice(0, 120),
        youtube: String(form.get("youtube") || "").trim().slice(0, 120),
        googleBusiness: urlish(form.get("googleBusiness")),
        telegram: String(form.get("telegram") || "").trim().slice(0, 60),
        whatsapp: String(form.get("whatsapp") || "").trim().slice(0, 24),
        phone: String(form.get("phone") || "").trim().slice(0, 24),
        contactEmail: String(form.get("contactEmail") || "").trim().slice(0, 80),
      };
      const coords = await resolveCoords(set.mapsUrl, shop.city, shop.country);
      if (coords) { set.lat = coords.lat; set.lng = coords.lng; }
      await (await col("shop_owners")).updateOne({ _id: shop._id }, { $set: set });
      redirect(res, `/app/owner/${m[1]}?msg=${encodeURIComponent("Profile saved")}`);
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
      let photoValue = null;
      if (photoOk) {
        const driveUrl = await uploadDishPhoto(photo, { shopId: m[1], dishName: name || d.name });
        photoValue = driveUrl || photo; // fall back to base64 if Drive is off
        if (driveUrl && typeof d.photo === "string") { await deleteDishPhoto(d.photo); }
      }
      await (await col("app_dishes")).updateOne({ _id }, { $set: {
        ...(name ? { name } : {}),
        nameSi: String(form.get("nameSi") || "").slice(0, 80),
        ...(photoValue ? { photo: photoValue } : {}),
        price: Math.max(0, Number(form.get("price")) || 0),
        portions: Math.max(1, Number(form.get("portions")) || 20),
        window: String(form.get("window") || "All day").slice(0, 20),
        discount: String(form.get("discount") || "none").slice(0, 10),
        special: form.get("special") === "1",
        promoTag: PROMO_TAGS.includes(form.get("promoTag")) ? form.get("promoTag") : "Today special",
        updatedAt: new Date(),
      } });
      redirect(res, `/app/owner/${m[1]}/dishes?msg=${encodeURIComponent("Dish saved")}`);
    } else {
      html(res, dishEditPage(shop, d));
    }
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/dish\/([a-f0-9]{24})\/delete$/);
  if (m && req.method === "POST") {
    const _id = await oid(m[2]);
    if (_id) {
      const doomed = await (await col("app_dishes")).findOne({ _id, shopId: m[1] }, { projection: { photo: 1 } });
      const r = await (await col("app_dishes")).deleteOne({ _id, shopId: m[1] });
      if (r.deletedCount) {
        if (doomed && typeof doomed.photo === "string") { await deleteDishPhoto(doomed.photo); }
        const shopOid = await oid(m[1]);
        if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: -1 } });
      }
    }
    redirect(res, `/app/owner/${m[1]}/dishes?msg=${encodeURIComponent("Dish removed")}`);
    return;
  }

  // Print-optimized page — A4 with 2 QR cards per page + auto-print on load.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/qr\/print$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (!shop) { res.writeHead(404).end("not found"); return; }
    const tables = Number(url.searchParams.get("tables")) || 1;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await qrPrintPage(shop, tables));
    return;
  }

  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/qr$/);
  if (m) {
    const shop = await shopById(m[1]);
    if (shop) { html(res, await qrPage(shop, { sel: url.searchParams.get("sel") })); return; }
  }

  // Tables: add the next available slot (up to 25).
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/tables\/add$/);
  if (m && req.method === "POST") {
    const shop = await shopById(m[1]);
    if (shop) {
      const cur = Array.isArray(shop.tables) ? shop.tables : [];
      if (cur.length < 25) {
        const used = new Set(cur.map(Number));
        let next = 1;
        while (used.has(next) && next <= 25) next++;
        if (next <= 25) {
          await (await col("shop_owners")).updateOne({ _id: shop._id }, { $set: { tables: [...cur, next].sort((a, b) => a - b) } });
          redirect(res, `/app/owner/${m[1]}/qr?sel=${next}`);
          return;
        }
      }
    }
    redirect(res, `/app/owner/${m[1]}/qr`);
    return;
  }

  // Tables: remove a single table number.
  m = path.match(/^\/app\/owner\/([a-f0-9]{24})\/tables\/(\d{1,2})\/remove$/);
  if (m && req.method === "POST") {
    const n = Number(m[2]);
    const shop = await shopById(m[1]);
    if (shop) {
      const cur = Array.isArray(shop.tables) ? shop.tables : [];
      await (await col("shop_owners")).updateOne({ _id: shop._id }, { $set: { tables: cur.filter((x) => Number(x) !== n) } });
    }
    redirect(res, `/app/owner/${m[1]}/qr`);
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
    let photoValue = null;
    if (photoOk) {
      const driveUrl = await uploadDishPhoto(photo, { shopId: m[1], dishName: name });
      photoValue = driveUrl || photo;
    }
    if (name) {
      await (await col("app_dishes")).insertOne({
        shopId: m[1],
        name,
        nameSi: String(form.get("nameSi") || "").slice(0, 80),
        ...(photoValue ? { photo: photoValue } : {}),
        price: Math.max(0, Number(form.get("price")) || 0),
        portions: Math.max(1, Number(form.get("portions")) || 20),
        window: String(form.get("window") || "All day").slice(0, 20),
        discount: String(form.get("discount") || "none").slice(0, 10),
        special: form.get("special") === "1",
        promoTag: PROMO_TAGS.includes(form.get("promoTag")) ? form.get("promoTag") : "Today special",
        createdAt: new Date(),
      });
      const shopOid = await oid(m[1]);
      if (shopOid) await (await col("shop_owners")).updateOne({ _id: shopOid }, { $inc: { listings: 1 } });
    }
    redirect(res, `/app/owner/${m[1]}/dishes?msg=${encodeURIComponent("Dish published")}`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
}
