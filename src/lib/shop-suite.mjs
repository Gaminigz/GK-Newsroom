/**
 * Shop suite — the owner's 13-button hub and the 11 new function screens
 * (design "3una 5aha All Screens" rows 2.1–2.12). Each screen ships as a
 * STATIC preview first (sample data, matching the approved design); functions
 * get wired to real collections one by one.
 *
 * Existing functions (My dishes, Table QR) keep their original routes; this
 * module only adds the hub + previews under /app/owner/:id/suite/:key.
 */

import { shell, esc } from "./app.mjs";

const ORANGE = "#d9542b";

/** One tile per function. `href(id)` = real page; suite previews use key.
 *  Table QR is not in the grid — it sits top-right under the Logout pill. */
export const SUITE_TILES = [
  { key: "dishes", label: "Food Menu", emoji: "🍛", real: (id) => `/app/owner/${id}/dishes` },
  { key: "dashboard", label: "Dashboard", emoji: "📊" },
  { key: "menu", label: "Menu setup", emoji: "🍱" },
  { key: "costs", label: "Cost sheet", emoji: "🧮" },
  { key: "stock", label: "Kitchen stock", emoji: "📦" },
  { key: "purchasing", label: "Purchasing", emoji: "🛒" },
  { key: "plan", label: "Purchase plan", emoji: "🧾" },
  { key: "books", label: "Shop accounting", emoji: "📚" },
  { key: "salaries", label: "Staff salaries entries", emoji: "💬" },
  { key: "staff", label: "Staff Pay", emoji: "👥" },
  { key: "utilities", label: "Utilities Pay", emoji: "💡" },
  { key: "health", label: "Business health", emoji: "❤️" },
];

/* ------------------------------------------------------------- the hub */

/** Round function button. Ready = green glow; locked = small padlock badge. */
function hubCircle(emoji, size, ready) {
  return `<span style="position:relative;width:${size}px;height:${size}px;border-radius:99px;background:#fff;
      border:2px solid ${ready ? "#35c98a" : "#ece3da"};
      box-shadow:${ready ? "0 0 0 5px #35c98a2e, 0 4px 16px #35c98a52" : "0 3px 10px #00000014"};
      display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.42)}px">${emoji}${ready ? "" :
      `<span style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:99px;background:#fff;border:1px solid #e3d9cf;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 4px #0002">🔒</span>`}
    </span>`;
}

export function ownerHubPage(shop, toast = "") {
  const id = String(shop._id);
  const tiles = SUITE_TILES.map((t) => `
    <a href="${t.real ? t.real(id) : `/app/owner/${id}/suite/${t.key}`}" style="display:flex;flex-direction:column;align-items:center;gap:9px;text-decoration:none">
      ${hubCircle(t.emoji, 80, !!t.real)}
      <span style="font-size:11.5px;font-weight:700;color:#1a1a1a;text-align:center;line-height:1.2">${t.label}</span>
    </a>`).join("");
  return shell({
    title: `${shop.name} — shop`,
    noBack: true,
    toast,
    body: `
    <div class="row" style="gap:9px;margin-bottom:4px;align-items:flex-start">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app/home">‹</a>
      <div style="flex:1;min-width:0"><strong style="font-size:17px">${esc(shop.name)}</strong>
      <div class="sub" style="font-size:11.5px">Shop owner mode · ${esc(shop.owner || "")}</div></div>
      <a href="/app/owner/${id}/qr" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:5px;text-decoration:none;margin-top:28px">
        ${hubCircle("▦", 54, true)}
        <span style="font-size:10px;font-weight:700;color:#1a1a1a">Table QR</span></a>
    </div>
    <div class="sub" style="font-size:12.5px;margin:6px 0 16px">All shop functions — tap a button. <span class="si">සියලු කාර්යයන්</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px 8px">${tiles}</div>`,
  });
}

/* ----------------------------------------------- shared preview pieces */

function page(shop, key, title, si, body) {
  const id = String(shop._id);
  return shell({
    title: `${title} — ${shop.name}`,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="/app/owner/${id}">‹</a>
      <h1 style="font-size:21px;flex:1;min-width:0">${title} <span class="si">${si}</span></h1>
      <span class="pill" style="flex:0 0 auto;background:#fdf3d7;border:1px solid #efdba8;color:#946200;font-size:10.5px">Preview · sample data</span></div>
    ${body}`,
  });
}

const money = (usd, lkr) => `<strong>$${usd}</strong> / LKR ${lkr}`;
const tile = (label, val, color = "") =>
  `<div class="card" style="flex:1;margin:0;padding:11px 12px"><div class="sub" style="font-size:10.5px;letter-spacing:.04em">${label}</div>
   <strong style="font-size:14px;${color ? `color:${color}` : ""}">${val}</strong></div>`;
const statusPill = (txt, kind) => {
  const c = kind === "ok" ? "#1d7a34;background:#e8f6ec;border-color:#bfe5c8"
    : kind === "warn" ? "#946200;background:#fdf3d7;border-color:#efdba8"
    : "#b3261e;background:#fdecea;border-color:#efc4bf";
  return `<span class="pill" style="flex:0 0 auto;font-size:10.5px;border:1px solid;color:${c}">${txt}</span>`;
};

/* --------------------------------------------------------- the screens */

function dashboardPage(shop) {
  const row = (init, name, sub, price, st, kind) => `
    <div class="card row" style="margin-top:10px;padding:11px 13px">
      <span style="width:38px;height:38px;border-radius:12px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12.5px;flex:0 0 auto">${init}</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${name}</strong>
      <div class="sub" style="font-size:12px">${sub} · ${price}</div></div>${statusPill(st, kind)}</div>`;
  return page(shop, "dashboard", "Dashboard", "සාප්පුව", `
    <div class="card row" style="margin-top:12px;padding:10px 14px;background:#e8f6ec;border-color:#bfe5c8">
      <div style="flex:1"><strong style="color:#1d7a34;font-size:13.5px">You're open</strong><div class="sub" style="font-size:11.5px">Accepting orders until 9:00 PM</div></div>
      <label class="toggle"><input type="checkbox" checked disabled><span></span></label></div>
    <div class="row" style="gap:8px;margin-top:12px">
      ${tile("ORDERS TODAY", "14")}${tile("REVENUE", "$88.0 · LKR 28,400")}${tile("NEW CHATS", "3")}
    </div>
    <div class="row" style="justify-content:space-between;margin-top:18px"><strong>Incoming orders</strong><span class="sub" style="font-size:12px">see all</span></div>
    ${row("NP", "1× Feast Pack · 2× Watalappan", "Nimal P. · pickup 7 PM", "$9.61 / LKR 3,100", "New", "bad")}
    ${row("SF", "3× Lunch packet", "Shehan F. · delivery 12:30", "$4.46 / LKR 1,440", "Preparing", "warn")}
    ${row("AK", "1× Kukul Mas Curry + rice", "Amaya K. · picked up", "$2.63 / LKR 850", "Done", "ok")}
    <div class="row" style="justify-content:space-between;margin-top:18px"><strong>Today's special &amp; discounts</strong><span class="sub" style="font-size:12px">edit</span></div>
    <div class="card row" style="margin-top:10px;padding:11px 13px">
      <span style="width:38px;height:38px;border-radius:12px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto">🎁</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">Feast Pack for 2 <span class="pill deal">-20%</span></strong>
      <div class="sub" style="font-size:12px">$7.44 / LKR 2,400 · live until 8 PM · <span style="color:#1d7a34;font-weight:700">9 sold</span></div></div></div>`);
}

function menuPage(shop) {
  const comp = (name, sub, price) => `
    <div class="card row" style="margin-top:8px;padding:10px 13px;background:#fdf0ec;border-color:#f3cfc2">
      <span style="width:22px;height:22px;border-radius:7px;background:#d9542b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto">✓</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${name}</strong><div class="sub" style="font-size:11.5px">${sub}</div></div>
      <span class="sub" style="font-size:12.5px;font-weight:700;flex:0 0 auto">${price}</span></div>`;
  const line = (l, v) => `<div class="row" style="justify-content:space-between;font-size:13px;margin-top:5px"><span class="sub">${l}</span><strong>${v}</strong></div>`;
  return page(shop, "menu", "Menu setup", "මෙනු සැකසුම", `
    <div class="seg" style="margin-top:12px">
      <label><input type="radio" name="mtab"><span class="opt" style="font-size:12px;padding:6px 12px">Single dish</span></label>
      <label><input type="radio" name="mtab" checked><span class="opt" style="font-size:12px;padding:6px 12px">Set menu</span></label>
      <label><input type="radio" name="mtab"><span class="opt" style="font-size:12px;padding:6px 12px">Combo</span></label>
      <label><input type="radio" name="mtab"><span class="opt" style="font-size:12px;padding:6px 12px">Events</span></label>
    </div>
    <input type="text" value="Rice & 3-Curry Lunch Set" style="margin-top:12px" readonly>
    <div class="row" style="justify-content:space-between;margin-top:12px"><strong style="font-size:13.5px">Pick from your dishes</strong><span style="color:${ORANGE};font-weight:700;font-size:12.5px">5 picked</span></div>
    ${comp("Red rice", "350 g cooked · base of the set", "$0.62 / LKR 200")}
    ${comp("Parippu (dhal)", "50 g portion", "$0.87 / LKR 280")}
    ${comp("Beef curry", "100 g portion", "$2.94 / LKR 950")}
    ${comp("Boiled egg", "1 egg", "$0.37 / LKR 120")}
    ${comp("Pol Sambol", "30 g · side", "$0.46 / LKR 150")}
    <div class="card" style="margin-top:14px;padding:13px 14px">
      ${line("Dishes ordered separately", "$5.27 / LKR 1,700")}
      ${line("Ingredients · from price list", "$1.74 / LKR 560")}
      ${line("Marketing · platform fee", "$0.37 / LKR 120")}
      ${line("Utilities · gas & electricity", "$0.28 / LKR 90")}
      <div class="row" style="justify-content:space-between;border-top:1px solid #f0e7de;margin-top:9px;padding-top:9px">
        <strong>Set meal price</strong><strong style="color:${ORANGE};border:1.5px solid ${ORANGE};border-radius:10px;padding:4px 10px">$3.72 / LKR 1,200</strong></div>
      <div class="sub" style="margin-top:9px;font-size:12px;color:#1d7a34">✅ Profit $1.33 / LKR 430 per set · saves buyers 29%</div>
    </div>
    <button class="btn" style="margin-top:14px" disabled>Post set meal as one item</button>`);
}

function costsPage(shop) {
  const row = (name, kind, cost, sale, margin, warn) => `
    <div class="card" style="margin-top:10px;padding:12px 14px">
      <div class="row" style="justify-content:space-between"><strong style="font-size:13.5px">${name}</strong><span class="pill" style="font-size:10.5px">${kind}</span></div>
      <div class="row" style="gap:14px;margin-top:7px;font-size:12.5px">
        <span class="sub">PLANNED COST<br><strong style="color:#1a1a1a">${cost}</strong></span>
        <span class="sub">SALE PRICE<br><strong style="color:#1a1a1a">${sale}</strong></span>
        <span style="flex:1"></span>
        ${statusPill("MARGIN " + margin, warn ? "warn" : "ok")}
      </div></div>`;
  return page(shop, "costs", "Cost sheet", "පිරිවැය", `
    <div class="seg" style="margin-top:12px">
      <label><input type="radio" name="ctab" checked><span class="opt" style="font-size:12px;padding:6px 12px">All</span></label>
      <label><input type="radio" name="ctab"><span class="opt" style="font-size:12px;padding:6px 12px">Single dish</span></label>
      <label><input type="radio" name="ctab"><span class="opt" style="font-size:12px;padding:6px 12px">Set menu</span></label>
      <label><input type="radio" name="ctab"><span class="opt" style="font-size:12px;padding:6px 12px">Combo</span></label>
    </div>
    ${row("Parippu (dhal) curry", "Single dish", "$2.48 / LKR 800", "$4.03 / LKR 1,300", "38%")}
    ${row("Rice & 3-Curry Lunch Set", "Set menu", "$2.39 / LKR 770", "$3.72 / LKR 1,200", "36%")}
    ${row("Buriyani set menu", "Set menu", "$6.04 / LKR 1,950", "$8.53 / LKR 2,750", "29%", true)}
    ${row("Lunch beef + 2 drinks combo", "Combo", "$8.99 / LKR 2,900", "$15.0 / LKR 4,850", "40%")}
    <div class="card" style="margin-top:12px;padding:10px 14px;background:#e8f6ec;border-color:#bfe5c8">
      <span style="color:#1d7a34;font-size:12.5px;font-weight:700">✅ Average margin 36% · target ≥ 30% before posting</span></div>`);
}

function stockPage(shop) {
  const row = (code, name, qty, sub, st, kind) => `
    <div class="card row" style="margin-top:9px;padding:11px 13px">
      <span style="width:36px;height:36px;border-radius:10px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11.5px;flex:0 0 auto">${code}</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${name} <span class="sub" style="font-weight:600">${qty}</span></strong>
      <div class="sub" style="font-size:11.5px">${sub}</div></div>${statusPill(st, kind)}</div>`;
  return page(shop, "stock", "Kitchen stock", "ගබඩාව", `
    <div class="seg" style="margin-top:12px">
      <label><input type="radio" name="stab" checked><span class="opt" style="font-size:12px;padding:6px 12px">Full · 42</span></label>
      <label><input type="radio" name="stab"><span class="opt" style="font-size:12px;padding:6px 12px">Vegi</span></label>
      <label><input type="radio" name="stab"><span class="opt" style="font-size:12px;padding:6px 12px">Meat</span></label>
      <label><input type="radio" name="stab"><span class="opt" style="font-size:12px;padding:6px 12px">Dry</span></label>
      <label><input type="radio" name="stab"><span class="opt" style="font-size:12px;padding:6px 12px">Spices</span></label>
    </div>
    <div class="card" style="margin-top:12px;padding:10px 14px;background:#fdecea;border-color:#efc4bf">
      <strong style="color:#b3261e;font-size:13px">❗ Use today — coconut milk, batch of 9 Jul</strong>
      <div class="sub" style="font-size:11.5px">Oldest batch always cooks first · first in, first out</div></div>
    ${row("CM", "Coconut milk", "2 L", "2 batches · oldest in 9 Jul · min 2 L · max 10 L · avg use 3 L / day", "Use today", "bad")}
    ${row("CH", "Chicken (curry cut)", "4.5 kg", "1 batch · in 10 Jul, 6:20 AM · min 5 kg · max 15 kg · avg use 4 kg / day", "Use first", "warn")}
    ${row("GB", "Green beans", "1.2 kg", "1 batch · in 10 Jul · below minimum · min 2 kg · max 6 kg", "Low", "warn")}
    ${row("RR", "Red rice", "18 kg", "2 batches · oldest in 2 Jul · dry store · min 10 kg · max 40 kg", "OK", "ok")}
    ${row("DC", "Dried chili", "8 packs", "1 batch · in 28 Jun · dry store · min 4 · max 20 packs", "OK", "ok")}
    <div class="row" style="gap:10px;margin-top:16px">
      <button class="btn" style="flex:1;background:#191512" disabled>+ Receive stock</button>
      <button class="btn ghost" style="flex:1" disabled>Log waste</button></div>`);
}

function purchasingPage(shop) {
  const supplier = (init, name, sub, on) => `
    <div class="card" style="margin:0 0 8px;padding:10px 11px;${on ? "background:#191512;border-color:#191512;color:#fff" : ""}">
      <span style="display:inline-flex;width:26px;height:26px;border-radius:8px;background:${on ? "#2e2a26" : "#f0e7de"};align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:${on ? "#fff" : "#1a1a1a"}">${init}</span>
      <strong style="display:block;font-size:12px;margin-top:5px">${name}</strong>
      <span style="font-size:10px;opacity:.7">${sub}</span></div>`;
  const item = (name, price, qty) => `
    <div class="card row" style="margin:0 0 8px;padding:9px 11px;${qty ? "background:#fdf0ec;border-color:#f3cfc2" : ""}">
      <div style="flex:1;min-width:0"><strong style="font-size:12.5px">${name}</strong><div class="sub" style="font-size:11px">${price}</div></div>
      <span class="sub" style="font-size:15px;padding:0 5px">−</span><strong style="font-size:12.5px;min-width:26px;text-align:center">${qty || 0}</strong><span style="color:${ORANGE};font-size:15px;padding:0 5px">＋</span></div>`;
  return page(shop, "purchasing", "Purchasing", "මිලදී ගැනීම්", `
    <div class="card" style="margin-top:12px;padding:9px 13px;background:#fdf3d7;border-color:#efdba8">
      <span style="font-size:10.5px;font-weight:800;color:#946200">RUNNING LOW</span>
      <span class="pill" style="font-size:11px;margin-left:6px">Coconut milk · 2 L</span>
      <span class="pill" style="font-size:11px">Chicken · 4.5 kg</span>
      <span class="pill" style="font-size:11px">Red lentils · 800 g</span></div>
    <div class="row" style="gap:12px;margin-top:14px;align-items:flex-start">
      <div style="flex:0 0 116px">
        <div class="sub" style="font-size:10.5px;letter-spacing:.04em;margin-bottom:8px">SUPPLIERS</div>
        ${supplier("MM", "New Manning Market", "veg · meat · fish", true)}
        ${supplier("CA", "Ceylon Agro Traders", "rice · dry goods")}
        ${supplier("LF", "Lanka Fresh Coconut", "coconut · oil")}
        <span style="color:${ORANGE};font-size:11.5px;font-weight:700">+ Add supplier</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="sub" style="font-size:10.5px;letter-spacing:.04em;margin-bottom:8px">NEW MANNING MARKET — PRICE LIST</div>
        ${item("Coconut", "$0.50 / LKR 160 / pc", "4 pc")}
        ${item("Red rice", "$0.99 / LKR 320 / kg", "2 kg")}
        ${item("White rice", "$0.81 / LKR 260 / kg")}
        ${item("Chicken (curry cut)", "$3.56 / LKR 1,150 / kg")}
        ${item("Coconut milk", "$1.49 / LKR 480 / L", "1 L")}
      </div></div>
    <div class="card row" style="margin-top:12px;padding:12px 14px;background:${ORANGE};border-color:${ORANGE}">
      <div style="flex:1;color:#fff"><strong style="font-size:13px">Purchase plan · 3 items · auto-created</strong></div>
      <strong style="color:#fff">$5.46 / LKR 1,760</strong></div>`);
}

function planPage(shop) {
  const group = (init, name, sub, rows, subtotal) => `
    <div class="card" style="margin-top:12px;padding:12px 14px">
      <div class="row"><span style="width:30px;height:30px;border-radius:9px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:800;flex:0 0 auto">${init}</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13px">${name}</strong><div class="sub" style="font-size:11px">${sub}</div></div></div>
      ${rows.map(([n, p]) => `<div class="row" style="justify-content:space-between;font-size:13px;margin-top:8px"><span>${n}</span><strong>${p}</strong></div>`).join("")}
      <div class="row" style="justify-content:space-between;border-top:1px solid #f0e7de;margin-top:9px;padding-top:8px;font-size:13px"><span class="sub">Subtotal</span><strong>${subtotal}</strong></div></div>`;
  return page(shop, "plan", "Purchase plan", "සැලැස්ම", `
    <p class="sub" style="margin-top:10px;font-size:12.5px">Auto-created from Purchasing · your shopping list at the market</p>
    ${group("MM", "New Manning Market", "open from 5 AM · pay cash", [["Coconut × 4 pc", "$1.98 / LKR 640"], ["Red rice × 2 kg", "$1.98 / LKR 640"]], "$3.97 / LKR 1,280")}
    ${group("LF", "Lanka Fresh Coconut", "delivers · order before 3 PM", [["Coconut milk × 1 L", "$1.49 / LKR 480"]], "$1.49 / LKR 480")}
    <div class="card row" style="margin-top:12px;padding:12px 14px;background:#191512;border-color:#191512">
      <div style="flex:1;color:#fff"><span style="font-size:10.5px;opacity:.75">TOTAL TO BUY · 3 ITEMS · 2 SUPPLIERS</span><br><strong style="font-size:15px;color:#ffb08f">$5.46 / LKR 1,760</strong></div>
      <span class="pill" style="background:#2e2a26;color:#fff;border:1px solid #4a443e">Share list</span></div>
    <div class="card" style="margin-top:10px;padding:10px 14px;background:#e8f6ec;border-color:#bfe5c8">
      <span style="color:#1d7a34;font-size:12.5px;font-weight:700">✅ Nothing forgotten — the plan updates when stock or prices change</span></div>
    <div class="row" style="gap:10px;margin-top:14px">
      <button class="btn" style="flex:2" disabled>Mark all bought</button>
      <button class="btn ghost" style="flex:1" disabled>Edit plan</button></div>`);
}

function booksPage(shop) {
  const line = (dot, name, sub, amt, neg) => `
    <div class="card row" style="margin-top:9px;padding:11px 13px">
      <span style="width:9px;height:9px;border-radius:99px;background:${neg ? "#b3261e" : "#1d7a34"};flex:0 0 auto"></span>
      <div style="flex:1;min-width:0"><strong style="font-size:13px">${name}</strong><div class="sub" style="font-size:11.5px">${sub}</div></div>
      <strong style="flex:0 0 auto;font-size:13px;color:${neg ? "#b3261e" : "#1d7a34"}">${amt}</strong></div>`;
  return page(shop, "books", "Sales &amp; Purchases", "විකුණුම් මිලදී", `
    <div class="row" style="gap:8px;margin-top:12px">
      ${tile("SOLD", "$1,507 · LKR 486,000", "#1d7a34")}${tile("BOUGHT", "$663 · LKR 214,000")}${tile("WASTE", "$38.4 · LKR 12,400", "#b3261e")}
    </div>
    <div class="card" style="margin-top:12px;padding:18px 14px;border-style:dashed;border-width:2px;text-align:center">
      <strong style="font-size:13.5px">scan a bill — snap a photo, totals are read into the books</strong>
      <div class="sub" style="font-size:12px;margin-top:3px;text-decoration:underline">or browse files</div></div>
    <div class="sub" style="font-size:10.5px;letter-spacing:.04em;margin-top:16px">THIS WEEK</div>
    ${line(1, "Sales — 14 orders", "Today · from order chat checkout", "+$88.0 / LKR 28,400")}
    ${line(1, "New Manning Market", "Today · bill scanned · veg & chicken", "−$38.4 / LKR 12,400", true)}
    ${line(1, "Waste — 1.2 kg vegetables", "Yesterday · logged from kitchen stock", "−$2.94 / LKR 950", true)}
    ${line(1, "Sales — 18 orders", "Yesterday", "+$96.7 / LKR 31,200")}
    ${line(1, "Gas cylinder ×2", "8 Jul · bill scanned", "−$29.8 / LKR 9,600", true)}`);
}

function salariesPage(shop) {
  const bubble = (txt) => `<div style="max-width:82%;margin:10px 0 0 auto;background:#191512;color:#fff;border-radius:16px 16px 5px 16px;padding:10px 13px;font-size:13.5px">${txt}</div>`;
  const confirm = (title, rows) => `
    <div class="card" style="margin-top:10px;padding:12px 14px">
      <strong style="color:#1d7a34;font-size:13px">✅ ${title}</strong>
      ${rows.map(([l, v]) => `<div class="row" style="justify-content:space-between;font-size:12.5px;margin-top:6px"><span class="sub">${l}</span><strong>${v}</strong></div>`).join("")}
    </div>`;
  return page(shop, "salaries", "Staff salaries", "වැටුප්", `
    <p class="sub" style="margin-top:10px;font-size:12.5px">Just type name, salary, start date, shift &amp; pay date — the app adds it and calculates payroll automatically.</p>
    ${bubble("Kamal Perera, cook, salary 180$, started 1 Jun, morning shift 6-2, pay on the 5th")}
    ${confirm("Added to staff — Kamal Perera", [["Salary", "$180 / LKR 58,000 / month"], ["Shift", "Morning · 6 AM – 2 PM"], ["Start date", "1 Jun 2026"], ["Payment date", "5th of every month"]])}
    ${bubble("Ruwan, delivery, 35,000 LKR, started 20 May, flexible shift, pay 5th")}
    ${confirm("Added — Ruwan Fernando", [["Salary", "$109 / LKR 35,000 / month · flexible shift · pays on the 5th", ""]])}
    <div class="card row" style="margin-top:12px;padding:12px 14px;background:#191512;border-color:#191512">
      <div style="flex:1;color:#fff"><span style="font-size:10.5px;opacity:.75">MONTHLY PAYROLL · AUTO-CALCULATED</span><br><strong style="font-size:15px;color:#ffb08f">$589 / LKR 190,000</strong></div>
      <span style="color:#fff;font-size:10.5px;opacity:.75;text-align:right">counted into Business health costs</span></div>
    <div class="row" style="gap:8px;margin-top:14px">
      <input type="text" placeholder="Type name, salary, shift, pay date…" style="flex:1" disabled>
      <span style="width:44px;height:44px;border-radius:99px;background:${ORANGE};color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto">›</span></div>`);
}

function staffPage(shop) {
  const row = (init, color, name, role, sub, pay, payday) => `
    <div class="card row" style="margin-top:9px;padding:11px 13px">
      <span style="width:38px;height:38px;border-radius:12px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:0 0 auto">${init}</span>
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${name}</strong> <span class="sub" style="font-size:11px">${role}</span>
      <div class="sub" style="font-size:11.5px">${sub}</div></div>
      <div style="flex:0 0 auto;text-align:right"><strong style="font-size:12.5px">${pay}</strong><div class="sub" style="font-size:10.5px">${payday}</div></div></div>`;
  return page(shop, "staff", "Staff · 4", "කාර්ය මණ්ඩලය", `
    <div style="text-align:right;margin-top:6px"><span style="color:${ORANGE};font-size:12px;font-weight:700">+ Add in chat</span></div>
    ${row("KP", "#3f7d5d", "Kamal Perera", "Cook", "Morning · 6 AM – 2 PM · started 1 Jun 2026", "$180 / LKR 58,000", "Pay 5th")}
    ${row("NS", "#8a6d3b", "Nimal Silva", "Kitchen helper", "Evening · 2 PM – 10 PM · started 15 Mar 2026", "$140 / LKR 45,000", "Pay 5th")}
    ${row("SJ", "#4a5d8a", "Sithara Jayasuriya", "Cashier & packing", "Morning · 7 AM – 3 PM · started 2 Jan 2026", "$161 / LKR 52,000", "Pay 1st")}
    ${row("RF", "#7d4a8a", "Ruwan Fernando", "Delivery", "Flexible shift · started 20 May 2026", "$109 / LKR 35,000", "Pay 5th")}
    <div class="card row" style="margin-top:12px;padding:12px 14px;background:#191512;border-color:#191512">
      <div style="flex:1;color:#fff"><span style="font-size:10.5px;opacity:.75">MONTHLY PAYROLL · AUTO-CALCULATED</span><br><strong style="font-size:15px;color:#ffb08f">$589 / LKR 190,000</strong></div>
      <span style="color:#fff;font-size:10.5px;opacity:.75;text-align:right">counted into Business health costs</span></div>`);
}

function utilitiesPage(shop) {
  const row = (name, amt, st, kind) => `
    <div class="row" style="justify-content:space-between;font-size:13px;margin-top:8px">
      <span>${name}</span><span class="row" style="gap:8px"><strong>${amt}</strong>${statusPill(st, kind)}</span></div>`;
  return page(shop, "utilities", "Utilities", "බිල්පත්", `
    <p class="sub" style="margin-top:10px;font-size:12.5px">Type rent, electricity, water or tax — it repeats from the start date and is ticked off once paid.</p>
    <div class="card" style="margin-top:12px;padding:12px 14px">
      <div class="sub" style="font-size:10.5px;letter-spacing:.04em">JULY · THIS MONTH</div>
      ${row("Rent", "$186 / LKR 60,000", "Paid ✓", "ok")}
      ${row("Electricity", "$57.0 / LKR 18,400", "Due 25th", "warn")}
      ${row("Water", "$13.9 / LKR 4,500", "Paid ✓", "ok")}
      ${row("Quarterly tax", "$18.6 / LKR 6,000", "Due 30th", "warn")}
    </div>
    <div style="max-width:82%;margin:12px 0 0 auto;background:#191512;color:#fff;border-radius:16px 16px 5px 16px;padding:10px 13px;font-size:13.5px">Rent 60,000 LKR monthly, from 1 Jan, pay on the 1st</div>
    <div class="card" style="margin-top:10px;padding:12px 14px">
      <strong style="color:#1d7a34;font-size:13px">✅ Rent added — repeats monthly</strong>
      <div class="sub" style="font-size:12px;margin-top:4px">$186 / LKR 60,000 / month · from 1 Jan 2026 · due the 1st · July marked paid ✓</div></div>
    <div style="max-width:82%;margin:12px 0 0 auto;background:#191512;color:#fff;border-radius:16px 16px 5px 16px;padding:10px 13px;font-size:13.5px">Electricity bill came, 18,400</div>
    <div class="card" style="margin-top:10px;padding:12px 14px">
      <strong style="font-size:13px">Electricity · July · $57.0 / LKR 18,400</strong>
      <div class="sub" style="font-size:12px;margin-top:3px">Added to this month's utilities — due 25 Jul</div>
      <span class="pill" style="display:inline-block;margin-top:8px;background:${ORANGE};color:#fff;border-color:${ORANGE}">Mark as paid</span></div>
    <div class="row" style="gap:8px;margin-top:14px">
      <input type="text" placeholder="Type a bill — rent, electricity, water, tax…" style="flex:1" disabled>
      <span style="width:44px;height:44px;border-radius:99px;background:${ORANGE};color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto">›</span></div>`);
}

function healthPage(shop) {
  const bars = [0.4, 0.5, 0.35, 0.62, 0.7, 0.95, 0.55].map((h, i) =>
    `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px;height:90px">
      <div style="width:9px;border-radius:4px;background:#191512;height:${Math.round(h * 78)}px"></div>
      <div style="width:9px;border-radius:4px;background:#e8a087;height:${Math.round(h * 48)}px"></div>
      <span class="sub" style="font-size:9px">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</span></div>`).join("");
  const spend = (name, amt, pct, color) => `
    <div style="margin-top:9px"><div class="row" style="justify-content:space-between;font-size:12.5px"><span>${name}</span><strong>${amt} · ${pct}</strong></div>
    <div style="height:6px;border-radius:99px;background:#f0e7de;margin-top:4px"><div style="height:6px;border-radius:99px;background:${color};width:${pct}"></div></div></div>`;
  const pl = (name, sub, verdict, ok) => `
    <div class="card row" style="margin-top:9px;padding:11px 13px">
      <div style="flex:1;min-width:0"><strong style="font-size:13px">${name}</strong><div class="sub" style="font-size:11.5px">${sub}</div></div>
      <div style="flex:0 0 auto;text-align:right">${statusPill(verdict, ok ? "ok" : "bad")}<div class="sub" style="font-size:10.5px;margin-top:2px;font-weight:700;color:${ok ? "#1d7a34" : "#b3261e"}">${ok ? "✓ Keep going" : "Rework or drop"}</div></div></div>`;
  return page(shop, "health", "Business health", "ව්‍යාපාරය", `
    <div class="card" style="margin-top:12px;padding:10px 14px;background:#e8f6ec;border-color:#bfe5c8">
      <strong style="color:#1d7a34;font-size:13.5px">✅ Running well</strong>
      <div class="sub" style="font-size:11.5px">Profit up 12% vs last month · waste under control</div></div>
    <div class="row" style="gap:8px;margin-top:12px">
      ${tile("SALES", "$1,507 · LKR 486,000")}${tile("COSTS", "$812 · LKR 262,000")}${tile("PROFIT", "$694 · LKR 224,000", "#1d7a34")}
    </div>
    <div class="card" style="margin-top:12px;padding:13px 14px">
      <div class="row" style="justify-content:space-between"><strong style="font-size:12.5px">THIS WEEK · SALES VS COSTS</strong>
      <span class="sub" style="font-size:10.5px">● Sales <span style="color:#e8a087">●</span> Costs</span></div>
      <div class="row" style="gap:4px;margin-top:10px">${bars}</div></div>
    <div class="row" style="gap:8px;margin-top:10px">
      ${tile("FOOD COST", "34% · on target, aim ≤ 35%", "#1d7a34")}${tile("WASTE", "2.9% of purchases", "#1d7a34")}
    </div>
    <div class="card" style="margin-top:12px;padding:13px 14px">
      <strong style="font-size:12.5px">WHERE THE MONEY GOES · JULY</strong>
      ${spend("Ingredients", "$663 / LKR 214,000", "43%", ORANGE)}
      ${spend("Staff salaries", "$589 / LKR 190,000", "39%", "#8a6d3b")}
      ${spend("Utilities · rent, electric, water, tax", "$274 / LKR 88,500", "18%", "#4a5d8a")}
      ${spend("Waste", "$38.4 / LKR 12,400", "2.5%", "#b3261e")}
    </div>
    <div class="sub" style="font-size:10.5px;letter-spacing:.04em;margin-top:16px">DISH P&amp;L — KEEP OR DROP?</div>
    ${pl("Lunch packet", "212 sold · profit made $242 / LKR 78,000", "41% margin", true)}
    ${pl("Watalappan", "150 sold · profit made $91.5 / LKR 29,500", "55% margin", true)}
    ${pl("Rice & 3-Curry Lunch Set (set meal)", "96 sold · profit made $128 / LKR 41,300", "38% margin", true)}
    ${pl("Jackfruit cutlets", "18 sold · lost $7.44 / LKR 2,400 after waste", "9% margin", false)}`);
}

const PAGES = {
  dashboard: dashboardPage, menu: menuPage, costs: costsPage, stock: stockPage,
  purchasing: purchasingPage, plan: planPage, books: booksPage,
  salaries: salariesPage, staff: staffPage, utilities: utilitiesPage, health: healthPage,
};

/** Render a suite preview page, or null if the key is unknown. */
export function suitePage(shop, key) {
  const fn = PAGES[key];
  return fn ? fn(shop) : null;
}
