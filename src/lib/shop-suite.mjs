/**
 * Shop suite — the owner's 13-button hub and the 11 new function screens
 * (design "3una 5aha All Screens" rows 2.1–2.12). Each screen ships as a
 * STATIC preview first (sample data, matching the approved design); functions
 * get wired to real collections one by one.
 *
 * Existing functions (My dishes, Table QR) keep their original routes; this
 * module only adds the hub + previews under /app/owner/:id/suite/:key.
 */

import { shell, esc, shopPrice, pairFor, CUR_SYM, LKR_TO, MEALS, mealsFor, CATEGORY_LIST } from "./app.mjs";
import { ingredientSlug } from "./drive.mjs";

const ORANGE = "#d9542b";

/** How many set names a shop may add for itself, on top of SET_PRESETS. */
const CUSTOM_SET_MAX = 3;

/** Newsroom category → POS chip. The meat/seafood category covers Beef,
 *  Pork, Mutton, Sea food AND Chicken, so mapping by category alone sent all
 *  of them to Chicken and left the other four chips empty. Name decides first,
 *  category is the fallback. */
const FEED_TO_POS = {
  "Rice & Staples": "Vegi meals", "Vegetable Curries": "Vegi meals",
  "Meat & Seafood Curries": "Chicken", "Salads, Sambols & Relishes": "Starters",
  "Fried, Dry & Bite Dishes": "Bites", "Bread, Buns & Beer Snacks": "Bites",
  "Mixed, Fusion & Street Food": "Bites",
  "Bakery & Canteen Classics": "Bites", "Sri Lankan Cakes & Sweets": "Desserts",
};

const POS_BY_NAME = [
  [/\b(beef|harak)\b/i, "Beef"],
  [/\b(pork|ham|bacon|uru)\b/i, "Pork"],
  [/\b(mutton|goat|lamb|elu)\b/i, "Mutton"],
  [/(fish|prawn|shrimp|crab|cuttlefish|squid|eel|shark|sprat|tuna|seer|isso|malu|dallo|karawala)/i, "Sea food"],
  [/\b(chicken|kukul|duck|turkey|quail|egg|bittara)\b/i, "Chicken"],
  [/\b(tea|coffee|juice|soda|water|milk|faluda|lassi)\b/i, "Drinks"],
  [/\b(arrack|beer|toddy|wine|whisky|rum)\b/i, "Alcohol"],
];

/** Which chip a catalogue dish belongs under. */
export function posCategoryFor(name, category) {
  for (const [re, cat] of POS_BY_NAME) if (re.test(String(name || ""))) return cat;
  return FEED_TO_POS[category] || "Vegi meals";
}

/** The set names a shop may use — a CLOSED list, exactly like the dish
 *  catalogue. Nothing here is user-writable: a free-text box would spawn
 *  "Main dish" / "Main dishes" / "main  dishes" as three different sets, and
 *  every downstream reader (POS, kitchen stock, accounting) would treat them
 *  as three. Add a name here, not in the UI. */
const SET_PRESETS = [
  { name: "Normal package", nameSi: "සාමාන්‍ය පැකේජය" },
  { name: "Special menu", nameSi: "විශේෂ මෙනුව" },
  { name: "King Pack", nameSi: "කිං පැක්" },
  { name: "Rice set", nameSi: "බත් කට්ටලය" },
  { name: "Meat Combo", nameSi: "මස් කොම්බෝ" },
  { name: "Main dishes", nameSi: "ප්‍රධාන කෑම" },
  { name: "Side dishes", nameSi: "අතුරු කෑම" },
  { name: "Dessert", nameSi: "අතුරුපස" },
  // Curry sold by the cup — one set per size, so the buyer picks a size and
  // sees one price list rather than every dish twice.
  { name: "Big cup", nameSi: "විශාල කෝප්පය" },
  { name: "Small cup", nameSi: "කුඩා කෝප්පය" },
];

/** One tile per function. `href(id)` = real page; suite previews use key.
 *  Table QR is not in the grid — it sits top-right under the Logout pill. */
// `real:` = tile is wired to real Mongo collections (green glow, no padlock).
// Absence of `real:` = static preview screen — still opens, just hardcoded HTML.
export const SUITE_TILES = [
  // The QR a table is ordered from — the first thing a shop hands a customer,
  // so it opens the board rather than hiding in the header corner.
  { key: "qr", label: "Table QR", emoji: "▦", real: (id) => `/app/owner/${id}/qr` },
  { key: "dishes", label: "Shop Daily Menu", emoji: "🍛", real: (id) => `/app/owner/${id}/dishes` },
  { key: "pos", label: "POS", emoji: "💳", real: (id) => `/app/owner/${id}/suite/pos` },
  { key: "kitchen", label: "In Kitchen", emoji: "👨‍🍳", real: (id) => `/app/owner/${id}/suite/kitchen` },
  { key: "menu", label: "Plan Menu", emoji: "🍱", real: (id) => `/app/owner/${id}/suite/menu` },
  { key: "costs", label: "Portion Plan", emoji: "🧮", real: (id) => `/app/owner/${id}/suite/costs` },
  { key: "plan", label: "Purchase Plan", emoji: "🧾", real: (id) => `/app/owner/${id}/suite/plan` },
  { key: "stock", label: "Kitchen stock", emoji: "📦", real: (id) => `/app/owner/${id}/suite/stock` },
  { key: "purchasing", label: "Buying & bills", emoji: "🛒", real: (id) => `/app/owner/${id}/suite/purchasing` },
  { key: "history", label: "Bill History", emoji: "🗂️", real: (id) => `/app/owner/${id}/suite/history` },
  { key: "salaries", label: "Staff salaries entries", emoji: "💬" },
  { key: "staff", label: "Staff Pay", emoji: "👥" },
  { key: "utilities", label: "Utilities Pay", emoji: "💡" },
  { key: "books", label: "Shop accounting", emoji: "📚" },
  { key: "dashboard", label: "Dashboard", emoji: "📊" },
  { key: "health", label: "Business health", emoji: "❤️" },
];

/** The set types as plain data, for the native Plan Menu screen. */
export const SET_PRESETS_JSON = SET_PRESETS.map((s) => ({ name: s.name, nameSi: s.nameSi }));

/** How many of its own set names a shop may add — shared with the API. */
export const CUSTOM_SET_LIMIT = CUSTOM_SET_MAX;

/** Just the names, for the server-side dedupe on custom set types. */
export const SET_PRESET_NAMES = SET_PRESETS.map((s) => s.name);

/* ------------------------------------------------------------- the hub */

/** Round function button. Ready = green glow; locked = small padlock badge. */
/**
 * The board's icons, drawn rather than borrowed.
 *
 * Emoji were standing in for these — a mesh character ▦ for the table QR, an
 * abacus for the portion plan — and they render differently on every device,
 * carry the wrong metaphor, and cannot take the shop's colour. These are
 * plain SVG on a 24 grid: one stroke weight, one language, ours.
 */
const TILE_ICONS = {
  // A real QR: three finder eyes and a scatter of modules.
  qr: `<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/>
       <rect x="5.6" y="5.6" width="1.8" height="1.8" fill="currentColor" stroke="none"/><rect x="16.6" y="5.6" width="1.8" height="1.8" fill="currentColor" stroke="none"/><rect x="5.6" y="16.6" width="1.8" height="1.8" fill="currentColor" stroke="none"/>
       <path d="M14 14h3M20 14h1M14 17v4M17 17h1M20 17.5v3.5M17 21h1"/>`,
  // A plate with its cover — the day's dishes.
  dishes: `<path d="M3.5 19h17"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/><path d="M12 8.5V6.8"/><circle cx="12" cy="5.6" r="1.1"/>`,
  // Card terminal.
  pos: `<rect x="4" y="3" width="16" height="18" rx="2.2"/><rect x="7" y="6" width="10" height="4.5" rx="1"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2M14.5 17.5h2"/>`,
  // Chef's hat.
  kitchen: `<path d="M6 20h12v-1.6H6z"/><path d="M7 18.4v-4.2a4.2 4.2 0 0 1-1.6-7.4A3.6 3.6 0 0 1 12 4.6a3.6 3.6 0 0 1 6.6 2.2A4.2 4.2 0 0 1 17 14.2v4.2"/><path d="M10 14.4v4M14 14.4v4"/>`,
  // Calendar — the day being planned.
  menu: `<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/><path d="M7.5 13h3M13.5 13h3M7.5 16.5h3M13.5 16.5h3"/>`,
  // A stack of plates under steam — how many are we cooking for today.
  // (It was a pair of scales, which is a shop weighing goods, not a kitchen
  // counting servings.)
  costs: `<path d="M9 3.2c-.9 1 -.9 2 0 3M12 2.6c-.9 1 -.9 2 0 3M15 3.2c-.9 1 -.9 2 0 3"/>
          <path d="M3.2 10.2h17.6"/><path d="M4.8 10.2c0 3 3.2 5.4 7.2 5.4s7.2-2.4 7.2-5.4"/>
          <path d="M5.6 17c1.7 1 4 1.6 6.4 1.6s4.7-.6 6.4-1.6"/>
          <path d="M6.8 20.4c1.5.7 3.3 1 5.2 1s3.7-.3 5.2-1"/>`,
  // The shopping list on its clipboard.
  plan: `<rect x="4.5" y="4.5" width="15" height="16" rx="2"/><rect x="9" y="2.5" width="6" height="3.4" rx="1.2"/><path d="M8.5 11h1M8.5 14.5h1M8.5 18h1M12 11h4M12 14.5h4M12 18h3"/>`,
  // Stacked crates.
  stock: `<rect x="3" y="10.5" width="8" height="9" rx="1.3"/><rect x="13" y="10.5" width="8" height="9" rx="1.3"/><rect x="8" y="3.5" width="8" height="6.5" rx="1.3"/><path d="M5.6 10.5v2.4M15.6 10.5v2.4M10.6 3.5v2.4"/>`,
  // Trolley.
  purchasing: `<path d="M2.5 4h2.2l2.4 10.6h10.2"/><path d="M6.4 7h14l-1.7 6.2H7.8"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>`,
  // Filed bills.
  history: `<rect x="3" y="6.5" width="18" height="13.5" rx="2"/><path d="M3 10.5h18"/><path d="M8.5 4.5h7l1.2 2h-9.4z"/><path d="M10 14.5h4"/>`,
  // A note passed about pay.
  salaries: `<path d="M20.5 13.5a3 3 0 0 1-3 3H9l-4.5 3.5v-3.5a3 3 0 0 1-1-2.2v-6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z"/><path d="M12 7.8v6M10.2 9.4h2.6a1.3 1.3 0 0 1 0 2.6h-1.6a1.3 1.3 0 0 0 0 2.6h2.6"/>`,
  // Two people.
  staff: `<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M14.6 20a4.4 4.4 0 0 1 6.9-3.6"/>`,
  // A bulb.
  utilities: `<path d="M9.2 17.5h5.6"/><path d="M10 20.5h4"/><path d="M12 3.5a5.6 5.6 0 0 1 3.4 10 2.4 2.4 0 0 0-.9 1.8v.2H9.5v-.2a2.4 2.4 0 0 0-.9-1.8A5.6 5.6 0 0 1 12 3.5z"/>`,
  // The ledgers.
  books: `<path d="M4 5.2a2 2 0 0 1 2-2h4.5v17.6H6a2 2 0 0 1-2-2z"/><path d="M10.5 3.2H18a2 2 0 0 1 2 2v13.6a2 2 0 0 1-2 2h-7.5"/><path d="M13.5 8h3.5M13.5 11.5h3.5"/>`,
  // Bars.
  dashboard: `<path d="M3.5 20.5h17"/><rect x="5.5" y="12" width="3.4" height="6"/><rect x="10.6" y="7.5" width="3.4" height="10.5"/><rect x="15.7" y="4" width="3.4" height="14"/>`,
  // A heart with a pulse through it.
  health: `<path d="M12 20.5s-7.8-4.7-7.8-10a4.4 4.4 0 0 1 7.8-2.8 4.4 4.4 0 0 1 7.8 2.8c0 5.3-7.8 10-7.8 10z"/><path d="M5.6 12.6h3l1.4-2.4 1.9 4 1.4-2.4h4"/>`,
};

/** A colour per tile, so the board is read by eye before it is read by word.
 *  Warm for the kitchen, cool for the money, green for what is bought and
 *  stored, grey-blue for the people. */
const TILE_COLOUR = {
  qr: "#1a1a1a", dishes: "#d9542b", pos: "#2f6fd0", kitchen: "#c2410c",
  menu: "#d9542b", costs: "#7c3aed", plan: "#0f8a6a", stock: "#0f8a6a",
  purchasing: "#0f8a6a", history: "#8a6d3b", salaries: "#2f6fd0", staff: "#2f6fd0",
  utilities: "#c79100", books: "#8a6d3b", dashboard: "#7c3aed", health: "#c92a4a",
};

/** One icon, one stroke weight, filling the circle it sits in. */
function tileIcon(key, emoji, size) {
  const d = TILE_ICONS[key];
  if (!d) return `<span style="font-size:${Math.round(size * 0.52)}px">${emoji}</span>`;
  const px = Math.round(size * 0.64);
  const c = TILE_COLOUR[key] || "#1a1a1a";
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="${c}" color="${c}"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function hubCircle(emoji, size, ready, key = "") {
  // A wash of the tile's own colour: the circle was mostly empty white.
  const tint = TILE_COLOUR[key] ? `${TILE_COLOUR[key]}14` : "#fff";
  return `<span style="position:relative;width:${size}px;height:${size}px;border-radius:99px;background:${ready ? tint : "#faf7f4"};
      border:2px solid ${ready ? "#35c98a" : "#ece3da"};
      box-shadow:${ready ? "0 0 0 5px #35c98a2e, 0 4px 16px #35c98a52" : "0 3px 10px #00000014"};
      display:flex;align-items:center;justify-content:center">${tileIcon(key, emoji, size)}${ready ? "" :
      `<span style="position:absolute;bottom:-7px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:99px;background:#fff;border:1px solid #e3d9cf;display:flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 4px #0002">🔒</span>`}
    </span>`;
}

export function ownerHubPage(shop, toast = "") {
  const id = String(shop._id);
  const tiles = SUITE_TILES.map((t) => `
    <a href="${t.real ? t.real(id) : `/app/owner/${id}/suite/${t.key}`}" style="display:flex;flex-direction:column;align-items:center;gap:9px;text-decoration:none">
      ${hubCircle(t.emoji, 80, !!t.real, t.key)}
      <span style="font-size:11.5px;font-weight:700;color:#1a1a1a;text-align:center;line-height:1.2">${t.label}</span>
    </a>`).join("");
  return shell({
    title: `${shop.name} — shop`,
    noBack: true,
    toast,
    body: `
    <div class="row" style="gap:10px;align-items:center;margin-top:-26px;padding-right:80px">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app/home">‹</a>
      <div style="flex:1;min-width:0">
        <div class="sub" style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;line-height:1.1">Shop Manager</div>
        <strong style="font-size:17px;line-height:1.15;display:block">${esc(shop.name)}</strong>
        <div class="sub" style="font-size:11px;line-height:1.15">Owner · ${esc(shop.owner || "")}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px 8px;margin-top:14px">${tiles}</div>`,
  });
}

/* ----------------------------------------------- shared preview pieces */

function page(shop, key, title, si, body, backTo) {
  const id = String(shop._id);
  const backHref = backTo || `/app/owner/${id}`;
  return shell({
    title: `${title} — ${shop.name}`,
    noBack: true,
    body: `
    <div class="row" style="gap:10px"><a class="back" style="margin:0" href="${backHref}">‹</a>
      <h1 style="font-size:21px;flex:1;min-width:0">${title} <span class="si">${si}</span></h1></div>
    ${body}
    <script>
    /* Destructive buttons ask twice without a native dialog: the first tap
       relabels for 2.5 s, a second tap inside that window submits. WKWebView
       swallows confirm(), so a form gated on it never submitted at all. */
    document.querySelectorAll('form.armForm').forEach(function(f){
      var b = f.querySelector('button');
      if (!b) return;
      var label = b.innerHTML, armed = false, t = null;
      f.addEventListener('submit', function(e){
        if (armed) return;
        e.preventDefault();
        armed = true;
        b.innerHTML = 'Tap again';
        b.style.background = '#7a0f0f';
        b.style.color = '#fff';
        t = setTimeout(function(){
          armed = false; b.innerHTML = label; b.style.background = ''; b.style.color = '';
        }, 2500);
      });
    });
    </script>`,
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

export const POS_CATEGORIES = [
  "Starters", "Bites", "Vegi meals", "Chicken", "Beef", "Mutton", "Pork", "Sea food", "Drinks", "Desserts",
];

function posPage(shop, extras = {}) {
  const id = String(shop._id);
  const dishes = extras.dishes || [];
  const todaysSales = extras.todaysSales || { count: 0, total: 0 };
  const pendingOrders = extras.pendingOrders || [];
  const onHoldCount = extras.onHoldCount || 0;
  const sc = extras.statusCounts || { waiting: 0, kitchen: 0, ready: 0, delivered: 0 };
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const escT = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SOURCE_CHIP = {
    table:   { label: (o) => `🍽 TABLE ${o.tableN || "?"}`, bg: "#fdf0ec", border: "#e8a087", fg: "#8b3a1f" },
    app:     { label: () => "📱 APP",     bg: "#e8eefb", border: "#a9baea", fg: "#26418a" },
    ecom:    { label: () => "🛒 ECOM",    bg: "#e8f6ec", border: "#8fce9e", fg: "#1d7a34" },
    counter: { label: () => "🧾 COUNTER", bg: "#f0e7de", border: "#c9bfb7", fg: "#4a443f" },
  };
  const sourceChip = (o) => {
    const s = SOURCE_CHIP[o.source] || SOURCE_CHIP.ecom;
    return `<span style="display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.05em;padding:2px 7px;border-radius:99px;background:${s.bg};border:1px solid ${s.border};color:${s.fg}">${s.label(o)}</span>`;
  };
  const padNo = (n) => String(n || 0).padStart(5, "0");
  const _pair = pairFor(shop && shop.country);
  const _sufP = _pair.primary === "LKR" ? "LK" : (CUR_SYM[_pair.primary] || "$");
  const _sufS = _pair.secondary === "LKR" ? "LK" : (CUR_SYM[_pair.secondary] || "$");
  const _fmt = (lkrAmt, code) => {
    const v = Number(lkrAmt || 0) * (LKR_TO[code] || LKR_TO.USD);
    if (v >= 1000) return Math.round(v).toLocaleString("en-US");
    if (v >= 10)   return v.toFixed(1).replace(/\.0$/, "");
    return v.toFixed(2);
  };
  const _apply = (n, sym, isSuffix) => isSuffix ? `${n}${sym}` : `${sym}${n}`;
  const shortPrice = (lkrAmt) => `${_apply(_fmt(lkrAmt, _pair.primary), _sufP, _pair.primary === "LKR")}-${_apply(_fmt(lkrAmt, _pair.secondary), _sufS, _pair.secondary === "LKR")}`;
  const orderCard = (o) => {
    const oid = String(o._id);
    const totalPortions = (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
    const lines = (o.items || []).map((i) => {
      const lineLkr = Math.round((Number(i.price) || 0) * (Number(i.qty) || 0));
      return `<div style="display:flex;justify-content:space-between;gap:6px;padding:3px 0;border-bottom:1px dashed #3a332f;font-size:11px;color:#fff;line-height:1.2">
        <span style="flex:1;min-width:0">${escT(i.name)} <span style="color:#ffb08f">×${Number(i.qty) || 0}</span></span>
        <span style="color:#c9bfb7;flex:0 0 auto;font-size:9.5px">${escT(shortPrice(lineLkr))}</span>
      </div>`;
    }).join("");
    const wantStr = o.wantAt ? (() => {
      const d = new Date(o.wantAt);
      if (isNaN(d)) return "";
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return sameDay ? `today · ${t}` : `${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})} · ${t}`;
    })() : "";
    return `<div style="margin-top:8px" data-order-id="${oid}">
      <div style="margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;gap:6px">
        ${sourceChip(o)}
        <strong style="font-size:12.5px;color:#d9542b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">#${padNo(o.orderNo)}</strong>
      </div>
      ${wantStr ? `<div style="margin:-1px 0 3px 0;font-size:9.5px;color:#946200;font-weight:600">⏰ want ${escT(wantStr)}</div>` : ""}
      <div class="card" style="margin:0;padding:6px 9px;background:#191512;border-color:#191512;color:#fff">
        <div style="display:flex;justify-content:baseline;justify-content:space-between;align-items:baseline;gap:8px"><strong style="font-size:22px;line-height:1;color:#ffb08f">${totalPortions}</strong><strong style="color:#ffb08f;font-size:12.5px">${escT(shortPrice(Number(o.total) || 0))}</strong></div>
        <div style="margin-top:2px">${lines || '<div class="sub" style="color:#c9bfb7">no items</div>'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:4px;margin-top:5px">
        <button type="button" class="posSendBtn btn" data-oid="${oid}" style="padding:8px 4px;font-size:11.5px;font-weight:700">Send to Kitchen</button>
        <button type="button" class="posHoldBtn btn ghost" data-oid="${oid}" style="padding:8px 8px;font-size:10.5px;color:#946200;border-color:#efdba8">On Hold</button>
      </div>
    </div>`;
  };
  const countIn = (c) => c === "All" ? dishes.length : dishes.filter((d) => (d.category || "") === c).length;
  const cats = ["All", ...POS_CATEGORIES];
  const chips = cats.map((c, i) => `<button type="button" class="posChip${i === 0 ? " on" : ""}" data-cat="${escT(c)}" onclick="posTab('${escT(c)}',this)" style="flex:0 0 auto;border:1px solid #e0d6cc;background:#fff;border-radius:99px;padding:5px 10px;font-size:11px;font-weight:600;color:#4a443f;white-space:nowrap;cursor:pointer">${escT(c)}<span class="sub" style="font-weight:500"> · ${countIn(c)}</span></button>`).join("");
  // Meal row above the categories — 5% larger, since the service window is the
  // coarser filter the clerk reaches for first.
  const countMeal = (mm) => mm === "All day" ? dishes.length : dishes.filter((d) => mealsFor(d.window).includes(mm)).length;
  const mealChips = ["All day", ...MEALS].map((mm, i) => `<button type="button" class="posMeal${i === 0 ? " on" : ""}" data-meal="${escT(mm)}" onclick="posMealTab('${escT(mm)}',this)" style="flex:1 1 0;min-width:0;border:1px solid #e0d6cc;background:${i === 0 ? "#191512" : "#fff"};color:${i === 0 ? "#fff" : "#4a443f"};border-radius:99px;padding:6px 4px;font-size:12px;font-weight:700;white-space:nowrap;cursor:pointer">${escT(mm.replace(/\s+/g, ""))}<span style="font-weight:500;opacity:.7">${countMeal(mm)}</span></button>`).join("");
  const dishDisplayName = (name) => String(name || "").replace(/^Ceylon\s+/i, "").trim() || String(name || "");
  const dishCard = (d) => {
    const shown = dishDisplayName(d.name);
    return `
    <div class="posDish" data-cat="${escT(d.category || "")}" data-meals="${escT(mealsFor(d.window).join("|"))}" data-id="${String(d._id)}" data-name="${escT(d.name)}" data-price="${Number(d.price) || 0}" role="button" tabindex="0" style="display:flex;flex-direction:column;align-items:stretch;padding:0;background:#fff;border:1px solid #ece3da;border-radius:8px;overflow:hidden;cursor:pointer;text-align:left;min-width:0">
      <div style="aspect-ratio:1.3;background:${d.photo ? `url('${escT(d.photo)}') center/cover` : "#f0e7de"};position:relative">
        <button type="button" class="posDishMinus" data-id="${String(d._id)}" title="Remove one" style="display:none;position:absolute;top:4px;left:4px;background:#b3261e;color:#fff;font-size:13px;font-weight:800;width:20px;height:20px;border-radius:99px;border:0;padding:0;cursor:pointer;line-height:1;box-shadow:0 1px 3px #0004">−</button>
        <span class="posDishQty" data-id="${String(d._id)}" style="display:none;position:absolute;top:4px;right:4px;background:#191512;color:#fff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:99px;box-shadow:0 1px 3px #0004">×0</span>
      </div>
      <div style="padding:4px 6px 5px">
        <strong style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:9.5px;line-height:1.15;min-height:22px">${escT(shown)}</strong>
        <span class="sub" style="display:block;font-size:8.5px;color:#d9542b;font-weight:700;margin-top:2px">${escT(shopPrice(shop, Number(d.price) || 0))}</span>
      </div>
    </div>`;
  };
  return page(shop, "pos", "POS", "විකුණුම් කවුන්ටරය", `
    <div class="sub" style="font-size:11.5px;margin-top:6px;line-height:1.4">Pick a meal → category → tap a dish to add. Bill on the right.<br><span class="si">වේල · වර්ගය · කෑම තෝරන්න.</span></div>
    <div style="display:flex;gap:4px;margin-top:10px" id="posMeals">${mealChips}</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px" id="posChips">${chips}</div>
    ${dishes.length ? `
      <div style="display:grid;grid-template-columns:1fr 158px;gap:8px;margin-top:10px;align-items:start">
        <div id="posGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;max-height:520px;overflow-y:auto;padding-right:2px;overscroll-behavior:contain">
          ${dishes.map(dishCard).join("")}
        </div>
        <div style="position:sticky;top:0;min-width:0">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:2px;margin-bottom:4px;font-size:9.5px;text-align:center;color:#4a443f">
            <div>Waiting <strong>${sc.waiting}</strong></div>
            <div>Kitchen <strong>${sc.kitchen}</strong></div>
            <div>Ready <strong>${sc.ready}</strong></div>
            <div>Deliv. <strong>${sc.delivered}</strong></div>
          </div>
          <div id="posTotalBar" style="padding:6px 10px;background:#191512;border-radius:10px;color:#fff;display:flex;justify-content:space-between;align-items:baseline;gap:6px">
            <span style="font-size:9px;opacity:.72;letter-spacing:.05em">COUNTER · <span id="posCount">0</span></span>
            <strong style="font-size:12px;color:#ffb08f;text-align:right;line-height:1.1"><span id="posTotalDisplay">${escT(shopPrice(shop, 0))}</span></strong>
          </div>
          <div id="posBasket" style="margin-top:4px;max-height:240px;overflow-y:auto;font-size:10.5px;padding-right:2px;overscroll-behavior:contain">
            <div class="sub" style="font-size:10px;padding:2px 0;text-align:center;color:#c9bfb7">tap a dish to start</div>
          </div>
          <div id="posRingWrap" style="display:none;margin-top:8px">
            <button type="button" id="posRing" class="btn" style="width:100%;padding:11px 4px;font-size:11.5px;font-weight:700">Send to Kitchen</button>
            <button type="button" id="posClear" class="btn ghost" style="width:100%;padding:6px 4px;font-size:10.5px;color:#946200;border-color:#efdba8;margin-top:4px">On Hold</button>
          </div>
          ${pendingOrders.length ? `
          <div style="margin-top:14px;padding-top:8px;border-top:1px dashed #ece3da">
            <div class="row" style="justify-content:space-between;align-items:center">
              <strong style="font-size:11px;letter-spacing:.05em">PENDING · ${pendingOrders.length}</strong>
              ${onHoldCount ? `<span class="sub" style="font-size:9.5px;color:#946200">on hold: ${onHoldCount}</span>` : ""}
            </div>
            <div id="posPending" style="margin-top:2px;max-height:520px;overflow-y:auto;padding-right:2px;overscroll-behavior:contain">
              ${pendingOrders.map(orderCard).join("")}
            </div>
          </div>` : (onHoldCount ? `<div class="sub" style="margin-top:12px;font-size:10.5px;text-align:center;color:#946200">on hold: ${onHoldCount}</div>` : "")}
        </div>
      </div>
    ` : `<div class="sub card" style="margin-top:12px;padding:11px 13px;font-size:12.5px">No dishes yet — add some in <strong>Setup Daily Menu</strong> first, then come back.</div>`}

    <div style="margin-top:16px;padding-top:10px;border-top:1px solid #ece3da">
      <div class="row" style="justify-content:space-between">
        <strong style="font-size:12.5px">Today's sales <span class="si">අද</span></strong>
        <span class="sub" style="font-size:11.5px">${todaysSales.count} order${todaysSales.count === 1 ? "" : "s"} · ${escT(shopPrice(shop, todaysSales.total))}</span>
      </div>
    </div>

    <style>
      #posChips::-webkit-scrollbar,#posGrid::-webkit-scrollbar,#posBasket::-webkit-scrollbar{ display:none; }
      .posChip.on{ background:#191512!important; border-color:#191512!important; color:#fff!important; }
    </style>
    <script>
      var CUR_SYM = '${escT(cur.symbol)}';
      var PAIR = ${JSON.stringify(pairFor(shop && shop.country))};
      var SYMS = ${JSON.stringify(CUR_SYM)};
      var RATES = ${JSON.stringify(LKR_TO)};
      function fmt(lkr, code) {
        var v = (Number(lkr) || 0) * (RATES[code] || RATES.USD);
        if (v >= 1000) return Math.round(v).toLocaleString('en-US');
        if (v >= 10)   return v.toFixed(1).replace(/\.0$/,'');
        return v.toFixed(2);
      }
      function shopFmt(lkr) {
        var glue = function(c){ return (c==='LKR'||c==='AED') ? ' ' : ''; };
        return SYMS[PAIR.primary]+glue(PAIR.primary)+fmt(lkr,PAIR.primary)+' · '+SYMS[PAIR.secondary]+glue(PAIR.secondary)+fmt(lkr,PAIR.secondary);
      }
      var basket = [];
      var curCat = 'All', curMeal = 'All day';
      // Meal window and category filter independently, combined with AND.
      function applyPosFilters(){
        document.querySelectorAll('.posDish').forEach(function(d){
          var meals = (d.dataset.meals || '').split('|');
          var okMeal = curMeal === 'All day' || meals.indexOf(curMeal) >= 0;
          var okCat  = curCat === 'All' || d.dataset.cat === curCat;
          d.style.display = (okMeal && okCat) ? '' : 'none';
        });
      }
      function posMealTab(meal, btn){
        curMeal = meal;
        document.querySelectorAll('#posMeals .posMeal').forEach(function(c){
          c.classList.remove('on'); c.style.background='#fff'; c.style.color='#4a443f';
        });
        btn.classList.add('on'); btn.style.background='#191512'; btn.style.color='#fff';
        applyPosFilters();
      }
      function posTab(cat, btn){
        curCat = cat;
        document.querySelectorAll('#posChips .posChip').forEach(function(c){ c.classList.remove('on'); });
        btn.classList.add('on');
        applyPosFilters();
      }
      function render(){
        var box = document.getElementById('posBasket');
        var count = basket.reduce(function(n,i){return n+i.qty;},0);
        var total = basket.reduce(function(n,i){return n+i.qty*i.price;},0);
        document.getElementById('posCount').textContent = count + ' item' + (count===1?'':'s');
        document.getElementById('posTotalDisplay').textContent = shopFmt(total);
        document.getElementById('posRingWrap').style.display = count ? 'block' : 'none';
        // Sync per-dish qty badges + minus buttons on the cards.
        var byId = {}; basket.forEach(function(l){ byId[l.id] = l.qty; });
        document.querySelectorAll('.posDishQty').forEach(function(b){
          var q = byId[b.dataset.id] || 0;
          b.textContent = '×' + q;
          b.style.display = q > 0 ? 'inline-block' : 'none';
        });
        document.querySelectorAll('.posDishMinus').forEach(function(b){
          b.style.display = (byId[b.dataset.id] || 0) > 0 ? 'block' : 'none';
        });
        if(!count){ box.innerHTML = '<div class="sub" style="font-size:10.5px;padding:2px 0">Empty — tap a dish.</div>'; return; }
        box.innerHTML = basket.map(function(i,idx){
          return '<div style="padding:5px 0;border-bottom:1px solid #ece3da;line-height:1.3">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:4px">'
            +   '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px">'+i.name+'</strong>'
            +   '<button type="button" data-idx="'+idx+'" class="posRm" title="Remove line" style="background:none;border:0;color:#b3261e;font-size:11px;padding:0 2px;cursor:pointer">✕</button>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:4px;margin-top:3px">'
            +   '<button type="button" data-idx="'+idx+'" class="posDec" title="Reduce" style="width:22px;height:22px;background:#fdecea;border:1px solid #f1c1bb;border-radius:6px;color:#b3261e;font-size:14px;font-weight:800;line-height:1;padding:0;cursor:pointer">−</button>'
            +   '<strong style="width:20px;text-align:center;font-size:11.5px">'+i.qty+'</strong>'
            +   '<button type="button" data-idx="'+idx+'" class="posInc" title="Add" style="width:22px;height:22px;background:#e3f4e6;border:1px solid #bfe5c8;border-radius:6px;color:#1d7a34;font-size:14px;font-weight:800;line-height:1;padding:0;cursor:pointer">+</button>'
            +   '<span style="flex:1;text-align:right;color:#6b6560;font-size:9px">'+shopFmt(i.price)+' ea</span>'
            + '</div>'
            + '<div style="text-align:right;margin-top:2px"><strong style="color:#d9542b;font-size:10px">'+shopFmt(i.price*i.qty)+'</strong></div>'
            + '</div>';
        }).join('');
        document.querySelectorAll('.posRm').forEach(function(b){
          b.addEventListener('click', function(){ basket.splice(Number(b.dataset.idx),1); render(); });
        });
        document.querySelectorAll('.posDec').forEach(function(b){
          b.addEventListener('click', function(){
            var idx = Number(b.dataset.idx);
            basket[idx].qty--;
            if(basket[idx].qty <= 0) basket.splice(idx,1);
            render();
          });
        });
        document.querySelectorAll('.posInc').forEach(function(b){
          b.addEventListener('click', function(){ basket[Number(b.dataset.idx)].qty++; render(); });
        });
      }
      document.querySelectorAll('.posDish').forEach(function(d){
        d.addEventListener('click', function(e){
          // Ignore taps on the nested minus button — it has its own handler.
          if(e.target.closest('.posDishMinus')) return;
          var did = d.dataset.id, name = d.dataset.name, price = Number(d.dataset.price)||0;
          var line = basket.find(function(l){return l.id===did;});
          if(line){ line.qty++; } else { basket.push({id:did,name:name,price:price,qty:1}); }
          render();
        });
      });
      // '−' on the card: decrement qty, remove the line at zero.
      document.querySelectorAll('.posDishMinus').forEach(function(m){
        m.addEventListener('click', function(e){
          e.stopPropagation();
          var did = m.dataset.id;
          var idx = basket.findIndex(function(l){return l.id===did;});
          if(idx < 0) return;
          basket[idx].qty--;
          if(basket[idx].qty <= 0) basket.splice(idx,1);
          render();
        });
      });
      document.getElementById('posClear').addEventListener('click', function(){ basket = []; render(); });
      document.getElementById('posRing').addEventListener('click', function(){
        if(!basket.length) return;
        var btn = document.getElementById('posRing');
        btn.disabled = true; btn.textContent = 'Sending…';
        fetch('/app/owner/${id}/pos/ring', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({items: basket})
        })
        .then(function(r){ if(r.ok) location.reload(); else { btn.disabled=false; btn.textContent='Send to Kitchen'; }})
        .catch(function(){ btn.disabled=false; });
      });
      // Pending-order review actions: Send to Kitchen / On Hold per card.
      function reviewOrder(oid, action, card){
        card.style.opacity = '.5';
        fetch('/app/owner/${id}/pos/order/'+oid+'/'+action, {method:'POST'})
          .then(function(r){ if(r.ok) card.remove(); else card.style.opacity=''; })
          .catch(function(){ card.style.opacity=''; });
      }
      document.querySelectorAll('.posSendBtn').forEach(function(b){
        b.addEventListener('click', function(){ reviewOrder(b.dataset.oid, 'send-to-kitchen', b.closest('[data-order-id]')); });
      });
      document.querySelectorAll('.posHoldBtn').forEach(function(b){
        b.addEventListener('click', function(){ reviewOrder(b.dataset.oid, 'hold', b.closest('[data-order-id]')); });
      });
      // Auto-refresh every 15s to pull in newly scanned QR / app / ecom orders.
      setInterval(function(){ if(!basket.length && !document.hidden) location.reload(); }, 15000);
    </script>`);
}

function kitchenPage(shop, extras = {}) {
  const id = String(shop._id);
  const orders = extras.kitchenOrders || [];
  const escK = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SRC = {
    table:   { label: (o) => `🍽 T${o.tableN || "?"}`, bg: "#fdf0ec", border: "#e8a087", fg: "#8b3a1f" },
    app:     { label: () => "📱 APP",     bg: "#e8eefb", border: "#a9baea", fg: "#26418a" },
    ecom:    { label: () => "🛒 ECOM",    bg: "#e8f6ec", border: "#8fce9e", fg: "#1d7a34" },
    counter: { label: () => "🧾 COUNTER", bg: "#f0e7de", border: "#c9bfb7", fg: "#4a443f" },
  };
  const DEFAULT_PREP_MIN = 20;
  const STATUS = {
    pending:   { label: "New",       badge: "#946200", bg: "#fdf3d7", border: "#efdba8", next: "preparing", nextLabel: `Start Preparing · ${DEFAULT_PREP_MIN}m` },
    preparing: { label: "Preparing", badge: "#8b3a1f", bg: "#fdf0ec", border: "#e8a087", next: "done",      nextLabel: "Start Delivering" },
    done:      { label: "Delivering", badge: "#1d7a34", bg: "#e8f6ec", border: "#8fce9e", next: "delivered", nextLabel: "Mark Delivered" },
  };
  const bucket = { pending: [], preparing: [], done: [] };
  orders.forEach((o) => { if (bucket[o.status]) bucket[o.status].push(o); });
  const padNo = (n) => String(n || 0).padStart(5, "0");
  const card = (o) => {
    const src = SRC[o.source] || SRC.ecom;
    const st = STATUS[o.status];
    const totalPortions = (o.items || []).reduce((n, i) => n + (Number(i.qty) || 0), 0);
    const lines = (o.items || []).map((i) => `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px dashed #3a332f;color:#e7e2dc"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escK(i.name)}</span><strong style="color:#ffb08f;flex:0 0 auto">×${Number(i.qty) || 0}</strong></div>`).join("");
    // Cook timer: counts down from preparingAt + prepMinutes. Rendered live by
    // the script below; `data-due` is the epoch ms the dish should be ready.
    const prepMin = Number(o.prepMinutes) || DEFAULT_PREP_MIN;
    const dueMs = o.status === "preparing" && o.preparingAt
      ? new Date(o.preparingAt).getTime() + prepMin * 60_000
      : 0;
    const timerRow = dueMs
      ? `<div class="kTimer" data-due="${dueMs}" style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:5px;padding:4px 7px;border-radius:7px;background:#2a2320">
           <span style="font-size:9px;color:#c9bfb7;letter-spacing:.05em">COOK TIMER</span>
           <strong class="kTimerVal" style="font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffb08f">--:--</strong>
         </div>`
      : "";
    return `<div class="kOrder" data-order-id="${String(o._id)}" style="margin-top:9px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px">
        <span style="display:inline-block;font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:99px;background:${src.bg};border:1px solid ${src.border};color:${src.fg}">${src.label(o)}</span>
        <strong style="font-size:13px;color:${st.badge};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.03em">#${padNo(o.orderNo)}</strong>
      </div>
      <div class="card" style="margin:0;padding:9px 11px;background:#191512;border-color:#191512;color:#fff">
        ${timerRow}
        <div style="font-size:9.5px;color:#c9bfb7;letter-spacing:.05em;margin-bottom:4px">${totalPortions} portion${totalPortions === 1 ? "" : "s"}</div>
        ${lines}
        <button type="button" class="kAdvance btn" data-oid="${String(o._id)}" data-to="${st.next}" style="width:100%;padding:8px 4px;font-size:11.5px;font-weight:700;margin-top:8px">${st.nextLabel}</button>
      </div>
    </div>`;
  };
  const col = (title, hint, items, si) => `
    <div style="flex:1;min-width:0">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <strong style="font-size:12px;letter-spacing:.03em">${title} <span class="si">${si}</span></strong>
        <span class="sub" style="font-size:10.5px">${items.length}</span>
      </div>
      <div class="sub" style="font-size:10px;margin-top:1px">${hint}</div>
      ${items.length ? items.map(card).join("") : `<div class="sub" style="font-size:10.5px;padding:14px 0;text-align:center;color:#c9bfb7">—</div>`}
    </div>`;
  return page(shop, "kitchen", "In Kitchen", "කුස්සියේ", `
    <div class="sub" style="font-size:11.5px;margin-top:6px">Clerk sends it here → <strong>Start Preparing</strong> runs a ${DEFAULT_PREP_MIN}-minute cook timer → <strong>Delivering</strong> when it rings.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:14px">
      ${col("New", "just arrived", bucket.pending, "අලුත්")}
      ${col("Preparing", `${DEFAULT_PREP_MIN} min on the stove`, bucket.preparing, "පිසෙයි")}
      ${col("Delivering", "packed — on its way", bucket.done, "බෙදාහරිනවා")}
    </div>
    <style>
      @keyframes kPulse { 0%,100%{opacity:1} 50%{opacity:.45} }
      .kTimer.kDue { background:#1d7a34!important; animation:kPulse 1.1s ease-in-out infinite; }
      .kTimer.kDue .kTimerVal { color:#fff!important; }
    </style>
    <script>
      var PREP_MIN = ${DEFAULT_PREP_MIN};
      // Live cook-timer tick — counts down to the due time stamped on each card.
      function tickTimers(){
        document.querySelectorAll('.kTimer').forEach(function(t){
          var due = Number(t.dataset.due) || 0;
          if(!due) return;
          var left = Math.round((due - Date.now())/1000);
          var val = t.querySelector('.kTimerVal');
          if(left <= 0){
            t.classList.add('kDue');
            val.textContent = 'READY';
          } else {
            t.classList.remove('kDue');
            var m = Math.floor(left/60), s = left % 60;
            val.textContent = m + ':' + (s < 10 ? '0' : '') + s;
          }
        });
      }
      tickTimers();
      setInterval(tickTimers, 1000);

      document.querySelectorAll('.kAdvance').forEach(function(b){
        b.addEventListener('click', function(){
          var oid = b.dataset.oid, to = b.dataset.to, card = b.closest('.kOrder');
          card.style.opacity = '.5'; b.disabled = true;
          var body = {to: to};
          if(to === 'preparing') body.prepMinutes = PREP_MIN;
          fetch('/app/owner/${id}/kitchen/order/'+oid+'/advance', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(body),
          }).then(function(r){ if(r.ok) location.reload(); else { card.style.opacity=''; b.disabled=false; } })
          .catch(function(){ card.style.opacity=''; b.disabled=false; });
        });
      });
      setInterval(function(){ if(!document.hidden) location.reload(); }, 15000);
    </script>`);
}

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

function menuPage(shop, extras = {}) {
  const id = String(shop._id);
  const singles = extras.singles || [];
  const sets = extras.sets || [];
  // A dot means "something is planned here", nothing means empty.
  const planMeals = extras.plannedMeals || [];
  const planDates = extras.plannedDates || [];
  const presetDishes = extras.presetDishes || [];
  const msg = extras.msg || "";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Day plan: one per (date, meal). Groups carry their own editable pick count
  // so a shop can run "pick 2" sides one day and "pick 6" the next.
  const planDate = extras.planDate || new Date().toISOString().slice(0, 10);
  const planMeal = extras.planMeal || "Lunch";
  const dayPlan = extras.dayPlan || null;
  // Newsroom catalogue, grouped by its own category vocabulary, for the
  // dish dropdown on the left column.
  const feedDishes = extras.feedDishes || [];
  const feedByCat = feedDishes.reduce((acc, d) => {
    (acc[d.category || "Other"] = acc[d.category || "Other"] || []).push(d);
    return acc;
  }, {});
  // The fixed list, plus up to three names this shop made for itself. Old
  // plan labels are still NOT merged in — those were free text once, and
  // re-offering them would put the typo back in circulation.
  const customSets = (shop.customSetTypes || [])
    .map((n) => String(n).trim()).filter(Boolean).slice(0, CUSTOM_SET_MAX);
  const setChoices = [...SET_PRESETS, ...customSets.map((name) => ({ name, nameSi: "", custom: true }))];
  const freeSlots = Math.max(0, CUSTOM_SET_MAX - customSets.length);

  return page(shop, "menu", "Plan Menu", "මෙනු සැකසුම", `
    ${msg ? `<div class="card" style="margin-top:10px;padding:10px 13px;background:#e8f6ec;border-color:#bfe5c8;font-size:12.5px;color:#1d7a34">${esc(msg)}</div>` : ""}

    <!-- The plan is per date + per meal: 09.08 Lunch is a different plan from
         09.08 Dinner. Changing either reloads that day's plan. -->
    <div style="margin-top:12px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center">
        <input type="date" id="planDateBox" value="${esc(planDate)}" style="margin:0;font-weight:700;font-size:13px">
        <span class="sub" id="planStamp" style="font-size:11px">${esc(planMeal)} plan${dayPlan ? "" : " · new"}</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:6px" id="mealRow">
        ${MEALS.map((mm) => `<button type="button" class="mealBtn" data-meal="${esc(mm)}" style="flex:1 1 0;border:1px solid #e0d6cc;background:${mm === planMeal ? "#191512" : "#fff"};color:${mm === planMeal ? "#fff" : "#4a443f"};border-radius:99px;padding:7px 4px;font-size:12.5px;font-weight:700;cursor:pointer">${esc(mm)}</button>`).join("")}
      </div>
    </div>

    <!-- Category chips scope the dish pickers. The meal is the one chosen
         with the date above — no second row of meal buttons. -->
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px" id="setCats">
      ${["All", ...CATEGORY_LIST].map((c, i) => `<button type="button" class="setCat${i === 0 ? " on" : ""}" data-cat="${esc(c)}" onclick="setCatTab('${esc(c)}',this)" style="border:1px solid #e0d6cc;background:${i === 0 ? "#191512" : "#fff"};color:${i === 0 ? "#fff" : "#4a443f"};border-radius:99px;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer">${esc(c)} <span class="cnt" style="font-weight:700;color:${ORANGE}">${c === "All" ? singles.length : singles.filter((d) => (d.category || "") === c).length}</span></button>`).join("")}
    </div>

    <!-- Nothing to press: everything autosaves. This line only reports where
         the plan stands — grey idle, orange while you are editing, green once
         it is stored, red if a save failed. -->
    <div id="saveBtn" style="margin-top:12px;font-size:15px;font-weight:700;color:#4a443f;cursor:default;line-height:1.3">Save ${esc(planMeal)} plan · ${esc(planDate)}</div>
    <div id="saveNote" class="sub" style="font-size:11px;margin-top:2px"></div>

    <!-- Both builders stack; CSS order puts Set menu first so it sits directly
         under the filter chips that scope its dish pickers. -->
    <div style="display:flex;flex-direction:column">

    <!-- SET MENU -->
    <div id="tab-set" style="order:1">
      ${singles.length ? `
      <form method="POST" action="/app/owner/${id}/menu/plan" id="planForm" onsubmit="return savePlan(event)">
        <input type="hidden" name="date" value="${esc(planDate)}">
        <input type="hidden" name="meal" value="${esc(planMeal)}">
        <input type="hidden" name="planJson" id="planJson">

        <div style="display:grid;grid-template-columns:126px minmax(0,1fr);gap:6px;align-items:start;margin-top:14px;max-width:100%">

        <!-- Left: name a set, or drop a dish into one. -->
        <div class="card" style="margin:0;padding:10px;position:sticky;top:6px">
          <div style="display:flex;gap:3px">
            <button type="button" id="modeSet" onclick="setAddMode('set')" style="flex:1 1 0;border:1px solid #e0d6cc;background:#191512;color:#fff;border-radius:99px;padding:5px 4px;font-size:10.5px;font-weight:700;cursor:pointer">Set</button>
            <button type="button" id="modeDish" onclick="setAddMode('dish')" style="flex:1 1 0;border:1px solid #e0d6cc;background:#fff;color:#4a443f;border-radius:99px;padding:5px 4px;font-size:10.5px;font-weight:700;cursor:pointer">Dish</button>
          </div>

          <!-- Pick-from-a-list only, same as Dish mode. There is deliberately
               no name box: set names are a closed list. -->
          <div id="paneSet">
            <label style="margin-top:8px;font-size:9.5px">PICK SET TYPES</label>
            <button type="button" id="setItemBtn" style="width:100%;margin:0;text-align:left;border:1px solid #e3d6c2;background:#fff;border-radius:10px;padding:6px 8px;font-size:11px;line-height:1.3;cursor:pointer;color:#8a827b">Pick set types…</button>
            <!-- Same dish picker as the Dish pane — one shared list, reachable
                 from either side without switching tabs. -->
            <div style="border-top:1px solid #ece3da;margin-top:8px;padding-top:8px">
              <label style="margin:0;font-size:9.5px">PICK COMBO</label>
              <button type="button" id="setDishBtn" style="width:100%;margin:0;text-align:left;border:1px solid #e3d6c2;background:#fff;border-radius:10px;padding:6px 8px;font-size:11px;line-height:1.3;cursor:pointer;color:#8a827b">Pick combo…</button>
              <!-- Ticking 20 boxes for a menu already written out in WhatsApp
                   is the slow way round. Paste the text and let it build. -->
              <!-- Deliberately a big target: it's the fastest way into the
                   whole screen, and the column below it is empty anyway. -->
              <button type="button" class="pasteOpen" style="width:100%;margin:8px 0 0;display:block;text-align:center;border:1.5px dashed ${ORANGE};background:linear-gradient(180deg,#fffaf7 0%,#fbeade 100%);border-radius:14px;padding:16px 9px 17px;min-height:172px;cursor:pointer;color:${ORANGE};box-shadow:0 1px 0 rgba(217,84,43,.06)">
                <span style="display:block;font-size:27px;line-height:1">📋</span>
                <span style="display:block;font-size:12.5px;font-weight:800;line-height:1.25;margin-top:9px">Paste menu<br>text</span>
                <span style="display:block;width:26px;height:1.5px;background:${ORANGE};opacity:.35;margin:9px auto"></span>
                <span class="si" style="display:block;font-size:10px;font-weight:400;line-height:1.55;color:#9a6b52">මෙනුව ලියපු විදිහටම මෙතන අලවන්න — සෙට් සහ කෑම ඉබේම හැදෙනවා</span>
              </button>
              <div id="comboTarget" class="sub" style="font-size:10px;margin-top:5px;line-height:1.25"></div>
            </div>
          </div>

          <div id="paneDish" style="display:none">
            <!-- The target is set by tapping a set's name; this only stores it. -->
            <select id="dishSet" style="display:none"></select>
            <div id="dishTarget" class="sub" style="font-size:10px;margin-top:8px;line-height:1.3"></div>
            <div style="border-top:1px solid #ece3da;margin-top:8px;padding-top:8px">
              <label style="margin:0;font-size:9.5px">PICK COMBO</label>
              <!-- Native select popup is hard-capped at 248pt by iOS, so this
                   is our own panel: 267pt (800 physical px at 3x), searchable,
                   grouped like the native one. Ticking inside it adds the dish
                   straight away at price 0 — pricing happens on the set row,
                   which is the only place that writes back to app_dishes. -->
              <button type="button" id="dishItemBtn" style="width:100%;margin:0;text-align:left;border:1px solid #e3d6c2;background:#fff;border-radius:10px;padding:6px 8px;font-size:11px;line-height:1.3;cursor:pointer;color:#8a827b">Pick combo…</button>
              <!-- Deliberately a big target: it's the fastest way into the
                   whole screen, and the column below it is empty anyway. -->
              <button type="button" class="pasteOpen" style="width:100%;margin:8px 0 0;display:block;text-align:center;border:1.5px dashed ${ORANGE};background:linear-gradient(180deg,#fffaf7 0%,#fbeade 100%);border-radius:14px;padding:16px 9px 17px;min-height:172px;cursor:pointer;color:${ORANGE};box-shadow:0 1px 0 rgba(217,84,43,.06)">
                <span style="display:block;font-size:27px;line-height:1">📋</span>
                <span style="display:block;font-size:12.5px;font-weight:800;line-height:1.25;margin-top:9px">Paste menu<br>text</span>
                <span style="display:block;width:26px;height:1.5px;background:${ORANGE};opacity:.35;margin:9px auto"></span>
                <span class="si" style="display:block;font-size:10px;font-weight:400;line-height:1.55;color:#9a6b52">මෙනුව ලියපු විදිහටම මෙතන අලවන්න — සෙට් සහ කෑම ඉබේම හැදෙනවා</span>
              </button>
            </div>
          </div>

          <div id="addSetMsg" class="sub" style="font-size:10px;margin-top:6px;line-height:1.3"></div>
        </div>

        <!-- Right: the sets the owner has created, built by JS from the plan array.
             Sets sit at the top, level with the pickers on the left, so the
             card you are filling is always in view. The catalogue goes below. -->
        <div style="min-width:0">
          <div id="setList"></div>
          <div id="dishCatalogue" style="display:none;margin-top:12px"></div>
        </div>
        <script id="shopDishData" type="application/json">${JSON.stringify(singles.map((d) => ({
          id: String(d._id), name: d.name, nameSi: d.nameSi || "",
          price: Number(d.price) || 0, cat: d.category || "", meals: mealsFor(d.window), own: true,
        })))}</script>
        <script id="feedDishData" type="application/json">${JSON.stringify(feedDishes.map((d) => ({
          name: d.name, nameSi: d.nameSi || "", cat: d.category || "",
          pos: posCategoryFor(d.name, d.category),
        })))}</script>
        <script id="setChoiceData" type="application/json">${JSON.stringify(setChoices)}</script>
        </div>


      </form>

      <!-- Dish panel — 267pt wide (800 physical px at 3x), above the iOS cap. -->
      <div id="feedBackdrop" style="display:none;position:fixed;inset:0;z-index:880;background:rgba(0,0,0,.18)"></div>
      <div id="feedPanel" style="display:none;position:fixed;z-index:890;top:14%;left:50%;transform:translateX(-50%);width:267px;max-height:70vh;background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden">
        <div style="padding:9px 10px;border-bottom:1px solid #ece3da">
          <div class="row" style="gap:7px">
            <input type="text" id="feedSearch" placeholder="Search ${feedDishes.length} dishes…" style="margin:0;flex:1;min-width:0;font-size:12.5px;padding:8px 10px">
            <button type="button" id="feedDone" style="flex:0 0 auto;border:0;background:#191512;color:#fff;border-radius:99px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer">Done</button>
          </div>
          <div id="feedCount" class="sub" style="font-size:10.5px;margin-top:5px;color:${ORANGE};font-weight:700"></div>
        </div>
        <div id="feedPanelList" style="max-height:calc(70vh - 78px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 10px 10px"></div>
      </div>

      <!-- Paste panel. Write the day out the way you'd send it on WhatsApp;
           the server reads it, creates whatever the catalogue is missing, and
           fills the builder below so it can still be edited by hand. -->
      <div id="pasteBackdrop" style="display:none;position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.24)"></div>
      <div id="pastePanel" style="display:none;position:fixed;z-index:910;top:5%;left:50%;transform:translateX(-50%);width:min(92vw,340px);max-height:88vh;background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden;flex-direction:column">
        <div style="padding:11px 13px;border-bottom:1px solid #ece3da">
          <div style="font-size:14px;font-weight:700">Paste your menu</div>
          <div class="si" style="font-size:11px;margin-top:1px">මෙනුව අලවන්න</div>
          <div class="sub" style="font-size:10.5px;margin-top:4px;line-height:1.35">Write it the way you send it on WhatsApp — headings, dishes, prices. A dish the list doesn't have yet gets added, so next time it's already there.</div>
          <div class="si sub" style="font-size:10.5px;margin-top:3px;line-height:1.5">WhatsApp එකේ යවන විදිහටම ලියන්න — සෙට් නම, කෑම, මිල. ලැයිස්තුවේ නැති කෑමක් නම් ඒක එකතු වෙනවා, ඊළඟ පාරට තියෙනවා.</div>
        </div>
        <div style="padding:10px 13px;overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:0">
          <textarea id="pasteText" rows="11" placeholder="Rice Set&#10;Ponni samba white rice / පොන්නි සම්බා සුදූ බත්&#10;&#10;Meat combo&#10;Chicken / කුකුල් මස් 5$&#10;&#10;Side dishes for select 04 items&#10;1. Dhal / පරිප්පු&#10;2. Bean / බෝංචි" style="width:100%;margin:0;font-size:12.5px;line-height:1.45;padding:9px 10px;resize:vertical;min-height:150px"></textarea>
          <div id="pasteMsg" class="sub" style="font-size:11px;margin-top:7px;line-height:1.4"></div>
          <div id="pasteResult" style="font-size:11.5px;margin-top:7px;line-height:1.45"></div>
        </div>
        <div style="padding:10px 13px;border-top:1px solid #ece3da;display:flex;gap:7px">
          <button type="button" id="pasteCancel" style="flex:0 0 auto;border:1px solid #e0d6cc;background:#fff;color:#4a443f;border-radius:99px;padding:9px 15px;font-size:12.5px;font-weight:700;cursor:pointer">Close</button>
          <button type="button" id="pasteGo" style="flex:1;border:0;background:${ORANGE};color:#fff;border-radius:99px;padding:9px 15px;font-size:12.5px;font-weight:700;cursor:pointer">Build my menu</button>
        </div>
      </div>
      ` : `
      <!-- A shop with nothing listed yet. The builder needs dishes to build
           with, but pasting IS how you get them — so this branch carries its
           own paste box, standalone, and reloads into the real builder once
           the dishes exist. -->
      <div class="card" style="margin-top:12px;padding:12px 14px;background:#fdf0ec;border-color:#f3cfc2;font-size:12.5px;color:#946200">
        No dishes listed yet — paste your menu below and they get created for you.
      </div>
      <div class="card" style="margin-top:10px;padding:12px 14px">
        <div style="font-size:13.5px;font-weight:700">Paste your menu</div>
        <div class="si" style="font-size:11.5px;margin-top:1px">මෙනුව අලවන්න</div>
        <div class="sub" style="font-size:11px;margin-top:5px;line-height:1.4">Write it the way you send it on WhatsApp — headings, dishes, prices.</div>
        <div class="si sub" style="font-size:11px;margin-top:3px;line-height:1.5">WhatsApp එකේ යවන විදිහටම ලියන්න — සෙට් නම, කෑම, මිල.</div>
        <textarea id="emptyPasteText" rows="9" placeholder="Rice Set&#10;Ponni samba white rice / පොන්නි සම්බා සුදූ බත්&#10;&#10;Side dishes for select 04 items&#10;1. Dhal / පරිප්පු" style="width:100%;margin-top:8px;font-size:12.5px;line-height:1.45;padding:9px 10px;min-height:130px"></textarea>
        <button type="button" id="emptyPasteGo" style="width:100%;margin-top:8px;border:0;background:${ORANGE};color:#fff;border-radius:99px;padding:10px 15px;font-size:13px;font-weight:700;cursor:pointer">Build my menu</button>
        <div id="emptyPasteMsg" class="sub" style="font-size:11.5px;margin-top:7px;line-height:1.4"></div>
      </div>
      <script>
      (function(){
        var go = document.getElementById('emptyPasteGo');
        var msg = document.getElementById('emptyPasteMsg');
        // Same as the panel: WebKit restores the field on reload, and broken
        // Sinhala restored over and over looks like the app's doing.
        var box = document.getElementById('emptyPasteText');
        var marks = (box.value.match(/[‡†∂∑ΩÎÄâÃ¬Â]/g) || []).length;
        if (box.value && marks >= 3 && marks / box.value.length > 0.1) box.value = '';
        go.addEventListener('click', function(){
          var text = document.getElementById('emptyPasteText').value;
          if (!text.trim()) { msg.textContent = 'Paste the menu text first.'; return; }
          go.disabled = true; go.textContent = 'Reading…';
          msg.textContent = 'Reading your menu and creating the dishes…';
          fetch('/app/owner/${id}/menu/paste.json', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({text: text, date: '${esc(planDate)}', meal: '${esc(planMeal)}'}),
          })
          .then(function(r){ return r.json(); })
          .then(function(j){
            if (!j.ok) { go.disabled = false; go.textContent = 'Build my menu'; msg.textContent = j.error || 'Could not read that.'; return; }
            // Save it as the day straight away — there was nothing here to lose.
            return fetch('/app/owner/${id}/menu/plan.json', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({date: '${esc(planDate)}', meal: '${esc(planMeal)}', groups: j.groups || [], dishIds: j.dishIds || []}),
            }).then(function(){
              msg.textContent = (j.dishIds || []).length + ' dishes added — opening your menu…';
              location.reload();
            });
          })
          .catch(function(e){
            go.disabled = false; go.textContent = 'Build my menu';
            msg.textContent = 'No connection (' + e.message + ') — your text is still here.';
          });
        });
      })();
      <\/script>`}
    </div>

    </div><!-- /both builders -->

    <script>
    /* ---- dynamic set builder ----------------------------------------
       plan = [{name, pick, dishes:[{id,name,nameSi,price}]}]. The left panel
       mutates it; the right column is re-rendered from it; it is serialised
       into a hidden field on submit. */
    var plan = ${JSON.stringify((dayPlan?.groups || []).map((g) => ({
      name: g.label || "",
      pick: Number(g.pick) || 1,
      // null = no fixed price, the dish the buyer picks sets it. A number
      // (including 0, i.e. "included") is the price of the whole set.
      price: g.price == null ? null : Number(g.price) || 0,
      dishes: (g.choices || []).map((c) => ({ id: c.dishId, name: c.name, nameSi: c.nameSi || "", price: Number(c.price) || 0 })),
    })))};
    /* The dishes this shop serves on this date. A dish is on the day whether
       or not it sits in a set — that is what Dish mode lists. */
    var dayDishes = ${JSON.stringify(
      // A plan saved before day dish lists existed has none, so fall back to
      // whatever its sets hold. Once it has one, that list is the truth.
      (dayPlan?.dishIds || []).length
        ? dayPlan.dishIds.map(String)
        : Array.from(new Set(((dayPlan?.groups) || []).flatMap((g) => (g.choices || []).map((c) => String(c.dishId)))))
    )};
    function onDay(id){ return dayDishes.indexOf(String(id)) >= 0; }
    function addToDay(id){ if (id && !onDay(id)) dayDishes.push(String(id)); }
    var SHOP_ID = '${id}';
    var FREE_SLOTS = ${freeSlots};
    var PLAN_MEAL = '${esc(planMeal)}';
    var PLAN_DATE = '${esc(planDate)}';   // both reassigned by switchPlan()

    function money(lkr){
      var usd = (Number(lkr) || 0) / 300;
      return 'US$' + usd.toFixed(2) + ' · LKR ' + (Number(lkr) || 0).toLocaleString();
    }
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

    function renderPlan(){
      var host = document.getElementById('setList');
      if (!plan.length) {
        host.innerHTML = '<div class="sub" style="padding:18px 10px;text-align:center;font-size:11.5px;color:#c9bfb7">Pick a set from the list on the left</div>';
      } else {
        host.innerHTML = plan.map(function(s, si){
          // Same stacked shape as the Dish list — name, Sinhala, then price —
          // so both modes read identically. Price stays editable here.
          var rows = s.dishes.length ? s.dishes.map(function(d, di){
            var unpriced = !d.price;
            // Name across the full width, price and remove on the line under
            // it — side by side these squeezed the name down to one letter.
            return '<div style="padding:6px 0;border-bottom:1px solid #f2ece6;min-width:0">'
              + '<div style="display:flex;align-items:flex-start;gap:6px;min-width:0">'
              +   '<span style="flex:1;min-width:0">'
              +     '<span style="display:block;font-size:12px;line-height:1.25;font-weight:600">' + esc(d.name) + '</span>'
              +     (d.nameSi ? '<span class="si" style="display:block;font-size:10px;line-height:1.2">' + esc(d.nameSi) + '</span>' : '')
              +   '</span>'
              +   '<button type="button" class="delDishBtn" data-si="' + si + '" data-di="' + di + '"'
              +     ' style="flex:0 0 auto;width:24px;height:24px;border:0;background:none;color:#b3261e;font-size:14px;padding:0;cursor:pointer">✕</button>'
              + '</div>'
              + '<div style="display:flex;align-items:center;gap:5px;margin-top:3px;min-width:0">'
              +   '<span class="sub" style="font-size:10px;flex:0 0 auto">$</span>'
              +   '<input type="number" step="0.01" min="0" value="' + (d.price ? (d.price / 300).toFixed(2) : '') + '"'
              +     ' placeholder="0.00" data-si="' + si + '" data-di="' + di + '" class="dishPriceBox"'
              +     ' style="margin:0;width:60px;flex:0 0 auto;padding:3px 4px;text-align:center;font-weight:700;font-size:11px;'
              +     (unpriced ? 'border-color:#b3261e;' : '') + '">'
              +   '<span class="sub" style="flex:1;min-width:0;font-size:10px;font-weight:700;color:' + (unpriced ? '#b3261e' : '#d9542b') + '">'
              +     (unpriced ? 'no price yet' : money(d.price)) + '</span>'
              + '</div>'
              + '</div>';
          }).join('') : '<div class="sub" style="font-size:10.5px;padding:8px 0;color:#c9bfb7">no dishes yet</div>';
          var live = si === Number(document.getElementById('dishSet').value || 0);
          return '<div class="card" style="margin:0 0 10px 0;padding:11px 12px'
            + (live ? ';border-color:#d9542b;box-shadow:0 0 0 2px #d9542b22' : '') + '">'
            // Name on its own line, controls under it. Side by side, the row
            // ran past the right edge and the ✕ could not be reached at all.
            + '<div style="display:flex;align-items:center;gap:6px;min-width:0">'
            +   '<strong class="setName" data-si="' + si + '" style="flex:1;min-width:0;font-size:13px;cursor:pointer;'
            +     'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            +     (live ? 'color:#d9542b' : '') + '">' + esc(s.name)
            +     (live ? ' <span style="color:#d9542b">●</span>' : '')
            +   '</strong>'
            +   '<button type="button" onclick="delSet(' + si + ')" style="flex:0 0 auto;width:26px;height:26px;'
            +     'border:0;background:none;color:#b3261e;font-size:15px;padding:0;cursor:pointer">✕</button>'
            + '</div>'
            + '<div style="display:flex;align-items:center;gap:5px;margin-top:5px;min-width:0">'
            +   '<span class="sub" style="font-size:10px;flex:0 0 auto">pick</span>'
            +   '<input type="number" min="1" max="40" value="' + s.pick + '" onchange="plan[' + si + '].pick=Math.max(1,Number(this.value)||1)" style="margin:0;flex:1 1 0;min-width:0;padding:5px 2px;text-align:center;font-weight:700;font-size:12px">'
            // Price left empty = the dish the buyer picks sets it; a number is
            // what the whole set costs.
            +   '<span class="sub" style="font-size:10px;flex:0 0 auto">price $</span>'
            +   '<input type="number" step="0.01" min="0" class="setPriceBox" data-si="' + si + '"'
            +     ' value="' + (s.price == null ? '' : (s.price / 300).toFixed(2)) + '" placeholder="—"'
            +     ' style="margin:0;flex:1 1 0;min-width:0;padding:5px 2px;text-align:center;font-weight:700;font-size:12px">'
            + '</div>'
            + '<div style="margin-top:6px">' + rows + '</div>'
            + '</div>';
        }).join('');
      }
      // Editing a price here also updates the shop's own dish, so the
      // catalogue and any later plan show the corrected figure.
      host.querySelectorAll('.dishPriceBox').forEach(function(b){
        b.addEventListener('change', function(){
          var s = plan[Number(b.dataset.si)], d = s && s.dishes[Number(b.dataset.di)];
          if (!d) return;
          d.price = Math.round((Number(b.value) || 0) * 300);
          SHOP_DISHES.forEach(function(x){ if (x.id === d.id) x.price = d.price; });
          fetch('/app/owner/' + SHOP_ID + '/menu/dish-price', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id: d.id, price: d.price}),
          }).catch(function(){ /* price still saves with the plan */ });
          // Without this the row keeps its old "no price yet" and the old
          // US$ figure, so a price you just typed looks like it didn't take.
          renderPlan();
          if (addMode === 'dish') renderCatalogue();
        });
      });
      // Blank clears back to "priced by the dish"; 0 means the set is included.
      host.querySelectorAll('.setPriceBox').forEach(function(b){
        b.addEventListener('change', function(){
          var s = plan[Number(b.dataset.si)];
          if (!s) return;
          var v = String(b.value).trim();
          s.price = v === '' ? null : Math.max(0, Math.round((Number(v) || 0) * 300));
          renderPlan();
        });
      });
      // Tap a set's name to make it the one new dishes go into.
      host.querySelectorAll('.setName').forEach(function(b){
        b.addEventListener('click', function(){ focusSet(Number(b.dataset.si)); });
      });
      host.querySelectorAll('.delDishBtn').forEach(function(b){
        b.addEventListener('click', function(){ delDish(Number(b.dataset.si), Number(b.dataset.di)); });
      });

      saveDraft();
      markDirty();
      var cur = plan[Number(document.getElementById('dishSet').value || 0)] || plan[0];
      var dishTgt = document.getElementById('dishTarget');
      if (dishTgt) {
        dishTgt.innerHTML = cur
          ? 'ticking adds to <strong style="color:#d9542b">' + esc(cur.name) + '</strong>'
          : 'pick a set type first';
      }
      var setBtn = document.getElementById('setItemBtn');
      if (setBtn) {
        setBtn.textContent = cur ? cur.name : 'Pick set types…';
        setBtn.style.color = cur ? '#d9542b' : '#8a827b';
        setBtn.style.fontWeight = cur ? '700' : '400';
      }
      var tgt = document.getElementById('comboTarget');
      if (tgt) tgt.textContent = plan.length ? '' : 'pick a set type first';
      var sel = document.getElementById('dishSet');
      var keep = sel.value;
      sel.innerHTML = plan.map(function(s, si){ return '<option value="' + si + '">' + esc(s.name) + '</option>'; }).join('');
      if (keep && plan[keep]) sel.value = keep;
      sel.onchange = function(){ if (addMode === 'dish') renderCatalogue(); };
    }
    function renderPlanOnly(){ renderPlan(); }

    /* The shop's own dishes — the browsable list shown in Dish mode. */
    var SHOP_DISHES = JSON.parse(document.getElementById('shopDishData').textContent);
    var FEED_DISHES = JSON.parse(document.getElementById('feedDishData').textContent);
    var addMode = 'set';
    var setCat = 'All';   // the meal comes from the plan (PLAN_MEAL)

    function setCatTab(cat, btn){
      setCat = cat;
      document.querySelectorAll('#setCats .setCat').forEach(function(c){
        c.classList.remove('on'); c.style.background='#fff'; c.style.color='#4a443f';
      });
      btn.classList.add('on'); btn.style.background='#191512'; btn.style.color='#fff';
      if (addMode === 'dish') renderCatalogue();
      if (document.getElementById('feedPanel').style.display !== 'none') renderFeedPanel();
    }

    function setAddMode(mode){
      addMode = mode;
      var isSet = mode === 'set';
      document.getElementById('paneSet').style.display  = isSet ? '' : 'none';
      document.getElementById('paneDish').style.display = isSet ? 'none' : '';
      // Dish is about the shop's own dish list, scoped by the category chips —
      // a shop that never serves Pork or Beef manages that here. Sets belong to
      // Set mode; the only crossing point is Pick combo.
      document.getElementById('setList').style.display = isSet ? '' : 'none';
      // The sets stay on screen while picking — hiding them meant the owner
      // couldn't see what they'd just ticked, or reach the X to undo it.
      document.getElementById('dishCatalogue').style.display = isSet ? 'none' : '';
      var a = document.getElementById('modeSet'), b = document.getElementById('modeDish');
      a.style.background = isSet ? '#191512' : '#fff'; a.style.color = isSet ? '#fff' : '#4a443f';
      b.style.background = isSet ? '#fff' : '#191512'; b.style.color = isSet ? '#4a443f' : '#fff';
      document.getElementById('addSetMsg').textContent = '';
      if (!isSet) renderCatalogue();
    }

    /* Every dish the shop has, filtered by the meal + category chips up top.
       Tap one to drop it into the set selected on the left. */
    /* Full-width picker: search, alphabetical, tick to add / untick to remove.
       Combines the shop's own dishes with the shared Sri Lankan list; feed-only
       entries are pulled into the shop the first time they're ticked. */
    var dishSearch = '';
    function catalogueRows(){
      var seen = {};
      var rows = [];
      SHOP_DISHES.forEach(function(d){
        seen[d.name.toLowerCase()] = true;
        rows.push({id: d.id, name: d.name, nameSi: d.nameSi, price: d.price, cat: d.cat, meals: d.meals, own: true});
      });
      FEED_DISHES.forEach(function(d){
        if (seen[d.name.toLowerCase()]) return;
        rows.push({id: null, name: d.name, nameSi: d.nameSi, price: 0, cat: '', meals: ['Breakfast','Lunch','Dinner'], own: false});
      });
      return rows.sort(function(a, b){ return a.name.localeCompare(b.name); });
    }

    function renderCatalogue(){
      var host = document.getElementById('dishCatalogue');
      var si = Number(document.getElementById('dishSet').value);
      var inSet = (plan[si] ? plan[si].dishes : []).map(function(d){ return d.id; });
      var q = dishSearch.trim().toLowerCase();
      // The day's dish list, and nothing else. A dish that lives only inside
      // a set shows on the set card, not here.
      var onPlan = {};
      dayDishes.forEach(function(id){ onPlan[id] = true; });
      var list = catalogueRows().filter(function(d){
        // Search wins over everything — that is how you reach the full list.
        if (q) return d.name.toLowerCase().indexOf(q) >= 0 || (d.nameSi || '').toLowerCase().indexOf(q) >= 0;
        // Otherwise: only this day's menu. The whole catalogue lives behind
        // Pick combo; listing all 200 here meant scrolling forever to drop one.
        if (!d.own) return false;
        // On the day = shown. No meal-window filter here: the owner put it on
        // THIS date and meal, so hiding it because the dish record says
        // "breakfast" just makes it look like the pick didn't work.
        if (!onPlan[d.id]) return false;
        return setCat === 'All' || d.cat === setCat;
      });
      // Search + Done only — the sets below already show what's been added.
      var head = '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">'
        + '<input type="text" id="dishSearchBox" placeholder="Search all ' + catalogueRows().length
        +   (setCat === 'All' ? '' : ' ' + setCat) + ' dishes…" value="' + esc(dishSearch) + '" style="margin:0;flex:1;min-width:0;font-size:12px;padding:7px 10px">'
        + '<button type="button" id="pickDone" style="flex:0 0 auto;border:0;background:#191512;color:#fff;border-radius:99px;padding:7px 14px;font-size:11.5px;font-weight:700;cursor:pointer">Done</button>'
        + '</div>';
      var body = list.length
        ? '<div class="card" style="margin:0;padding:4px 10px">'
          + list.map(function(d){
              var already = d.id && inSet.indexOf(d.id) >= 0;
              // On the plan for this date, in any set? Then it can be taken
              // off the day from here — the set cards aren't shown in Dish.
              var onDay = d.id && onPlan[d.id];
              // Name and price on their own lines — side by side they collide
              // in a column this narrow.
              return '<label style="display:flex;align-items:center;gap:7px;padding:6px 0;border-bottom:1px solid #f2ece6;cursor:pointer">'
                + '<input type="checkbox" class="pickBox" data-name="' + esc(d.name) + '"' + (d.id ? ' data-id="' + d.id + '"' : '')
                +   (already ? ' checked' : '') + ' style="width:18px;height:18px;accent-color:#d9542b;flex:0 0 auto">'
                + '<span style="flex:1;min-width:0">'
                +   '<span style="display:block;font-size:12px;line-height:1.2;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                +     esc(d.name) + (d.own ? '' : ' <span class="sub" style="font-weight:400;font-size:9.5px">new</span>') + '</span>'
                +   (d.nameSi ? '<span class="si" style="display:block;font-size:10px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(d.nameSi) + '</span>' : '')
                +   '<span class="sub" style="display:block;font-size:10px;font-weight:700;color:#d9542b">' + (d.own ? money(d.price) : 'no price yet') + '</span>'
                +   (onDay ? '<span class="sub" style="display:block;font-size:9.5px;font-weight:700;color:#1d7a34">on this menu</span>' : '')
                + '</span>'
                + (onDay ? '<button type="button" class="offDayBtn" data-id="' + d.id + '" title="Take off this day"'
                    + ' style="flex:0 0 auto;width:28px;height:28px;border:0;background:none;color:#b3261e;font-size:15px;padding:0;cursor:pointer">✕</button>' : '')
                + '</label>';
            }).join('')
          + '</div>'
        : '<div class="sub" style="font-size:11.5px;padding:16px 8px;text-align:center;line-height:1.4">'
          + (dishSearch.trim()
              ? 'nothing matches'
              : 'Nothing on ' + PLAN_DATE + ' ' + PLAN_MEAL + ' yet.<br>Use <strong>Pick combo</strong> to add dishes, or search here to find one.')
          + '</div>';
      host.innerHTML = head + body;

      var box = document.getElementById('dishSearchBox');
      box.addEventListener('input', function(){
        dishSearch = box.value;
        var pos = box.selectionStart;
        renderCatalogue();
        var nb = document.getElementById('dishSearchBox');
        nb.focus(); nb.setSelectionRange(pos, pos);
      });
      document.getElementById('pickDone').addEventListener('click', function(){
        dishSearch = '';
        setAddMode('set');
      });
      host.querySelectorAll('.offDayBtn').forEach(function(b){
        b.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation();
          offTheDay(b.dataset.id);
        });
      });
      host.querySelectorAll('.pickBox').forEach(function(b){
        b.addEventListener('change', function(){
          if (b.checked) pickDish(b.dataset.id || null, b.dataset.name);
          else unpickDish(b.dataset.id || null, b.dataset.name);
        });
      });
    }

    /* Take a dish off this date entirely — out of every set holding it. The
       shop's dish list and every other date are untouched. */
    function offTheDay(id){
      var gone = '';
      dayDishes = dayDishes.filter(function(x){ return x !== String(id); });
      var known = SHOP_DISHES.filter(function(x){ return x.id === id; })[0];
      if (known) gone = known.name;
      plan.forEach(function(sx){
        sx.dishes = sx.dishes.filter(function(d){
          if (d.id === id) { gone = d.name; return false; }
          return true;
        });
      });
      if (!gone) return;
      document.getElementById('addSetMsg').textContent = gone + ' off ' + PLAN_DATE + '.';
      renderPlan();
      renderCatalogue();
    }

    function unpickDish(id, name){
      var si = Number(document.getElementById('dishSet').value);
      if (!plan[si]) return;
      plan[si].dishes = plan[si].dishes.filter(function(d){
        return id ? d.id !== id : d.name !== name;
      });
      document.getElementById('addSetMsg').textContent = name + ' removed.';
      renderPlanOnly();
    }

    function pickDish(id, name){
      var si = Number(document.getElementById('dishSet').value);
      var msg = document.getElementById('addSetMsg');
      if (!plan[si]) { msg.textContent = 'Make a set first.'; return; }
      if (id) {
        var d = SHOP_DISHES.filter(function(x){ return x.id === id; })[0];
        if (!d) return;
        if (plan[si].dishes.some(function(x){ return x.id === id; })) return;
        plan[si].dishes.push({id: d.id, name: d.name, nameSi: d.nameSi, price: d.price});
        msg.textContent = d.name + ' → ' + plan[si].name;
        renderPlanOnly();
        return;
      }
      // Feed-only entry — create it on the shop first, at 0 until priced.
      msg.textContent = 'Adding ' + name + '…';
      fetch('/app/owner/' + SHOP_ID + '/menu/add-from-feed', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name: name, price: 0, meal: PLAN_MEAL}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j.ok) { msg.textContent = j.error || 'Failed'; return; }
        var fedPrice = Number(j.price) || 0;
        SHOP_DISHES.push({id: j.id, name: name, nameSi: j.nameSi || '', price: fedPrice, cat: '', meals: ['Breakfast','Lunch','Dinner'], own: true});
        if (!plan[si].dishes.some(function(x){ return x.id === j.id; })) {
          plan[si].dishes.push({id: j.id, name: name, nameSi: j.nameSi || '', price: fedPrice});
        }
        msg.textContent = name + (fedPrice ? ' added at ' + money(fedPrice) + '.' : ' added — set its price on the right.');
        renderPlanOnly();
        renderCatalogue();
      })
      .catch(function(e){ msg.textContent = e.message; });
    }

    /* Point every picker at this set — the dropdown in Dish mode, the combo
       panel, and the "adding here" marker on the card itself. */
    function focusSet(i){
      if (!plan[i]) return;
      var sel = document.getElementById('dishSet');
      sel.value = String(i);
      document.getElementById('addSetMsg').textContent = 'Adding to ' + plan[i].name;
      renderPlan();
      if (addMode === 'dish') renderCatalogue();
      if (document.getElementById('feedPanel').style.display !== 'none') renderFeedPanel();
    }
    function delSet(i){ plan.splice(i, 1); renderPlan(); }
    function delDish(si, di){ plan[si].dishes.splice(di, 1); renderPlan(); }

    /* Custom pick panel — the native select popup is capped at 248pt by iOS,
       so this one is drawn at 267pt (800 physical px on a 3x screen). One
       panel serves both modes: 'dish' lists the shared dish library, 'set'
       lists set names. panelMode says which. */
    var feedQuery = '';
    /* One line of feedback rendered inside the panel — the status line in the
       left pane is behind it and can't be seen while it's open. */
    var slotNote = '';
    var panelMode = 'dish';
    var SET_CHOICES = JSON.parse(document.getElementById('setChoiceData').textContent);

    function renderFeedPanel(){
      if (panelMode === 'set') { renderSetPanel(); return; }
      var q = feedQuery.trim().toLowerCase();
      var si = Number(document.getElementById('dishSet').value);
      var inSet = plan[si]
        ? plan[si].dishes.map(function(d){ return d.name; })
        : SHOP_DISHES.filter(function(x){ return onDay(x.id); }).map(function(x){ return x.name; });
      var list = FEED_DISHES.filter(function(d){
        // Typing searches everything; otherwise the category chip scopes it.
        if (q) return d.name.toLowerCase().indexOf(q) >= 0 || (d.nameSi || '').toLowerCase().indexOf(q) >= 0;
        return setCat === 'All' || d.pos === setCat;
      });
      if (q) list = list.slice().sort(function(a, b){ return a.name.localeCompare(b.name); });
      document.getElementById('feedCount').textContent =
        (plan[si] ? inSet.length + ' in ' + plan[si].name : dayDishes.length + ' on this day')
        + (setCat === 'All' ? '' : ' · ' + setCat + ' only');
      var host = document.getElementById('feedPanelList');
      // Which set a tick lands in, chosen here rather than on the page behind
      // this panel — that indicator is hidden while the panel is open, so a
      // tick was a guess and often went to the wrong set.
      var chips = plan.length
        ? '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:2px 0 8px;border-bottom:1px solid #ece3da;margin-bottom:4px">'
          + plan.map(function(p2, pi){
              var on = pi === si;
              return '<button type="button" class="panelSet" data-si="' + pi + '"'
                + ' style="border:1px solid ' + (on ? '#d9542b' : '#e0d6cc') + ';background:' + (on ? '#d9542b' : '#fff')
                + ';color:' + (on ? '#fff' : '#4a443f') + ';border-radius:99px;padding:5px 10px;font-size:11.5px;'
                + 'font-weight:700;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                + esc(p2.name) + '</button>';
            }).join('')
          + '</div>'
        : '<div class="sub" style="font-size:11px;padding:4px 2px 8px">Ticking adds the dish to <strong>' + PLAN_DATE + ' ' + PLAN_MEAL + '</strong>. Make a set only if you want a package.</div>';
      if (!list.length) {
        host.innerHTML = chips
          + '<div class="sub" style="padding:22px 0;text-align:center;font-size:12px">'
          + (catalogueRefreshing ? 'checking the list…' : 'nothing matches') + '</div>';
        wirePanelSets(host);
        // The catalogue may have gained dishes since this page loaded. Fetch it
        // rather than making the owner reload and lose their place.
        refreshCatalogue();
        return;
      }
      host.innerHTML = chips + dishRowsHtml(list, q);
      wirePanelSets(host);
      wireDishBoxes(host);
    }

    /* Switching destination only redraws the panel — a full page render is
       what made this feel slow. */
    /* Pull the dish catalogue again, once per search that finds nothing. */
    var catalogueRefreshing = false, catalogueTried = {};
    function refreshCatalogue(){
      var key = feedQuery.trim().toLowerCase();
      if (catalogueRefreshing || catalogueTried[key]) return;
      catalogueTried[key] = true;
      catalogueRefreshing = true;
      fetch('/app/owner/' + SHOP_ID + '/menu.json?date=' + encodeURIComponent(PLAN_DATE) + '&meal=' + encodeURIComponent(PLAN_MEAL))
        .then(function(r){ return r.json(); })
        .then(function(j){
          catalogueRefreshing = false;
          if (!j.ok || !j.dishes) return;
          var before = FEED_DISHES.length;
          FEED_DISHES = j.dishes.map(function(d){
            return { name: d.name, nameSi: d.nameSi || '', cat: d.category || '', pos: d.pos || 'Vegi meals' };
          });
          if (FEED_DISHES.length !== before) renderFeedPanel();
        })
        .catch(function(){ catalogueRefreshing = false; });
    }

    function wirePanelSets(host){
      host.querySelectorAll('.panelSet').forEach(function(b){
        b.addEventListener('click', function(){
          document.getElementById('dishSet').value = b.dataset.si;
          renderFeedPanel();
        });
      });
    }

    /* Dish rows, shared by both panels — the set panel lists them underneath
       the sets so one search covers everything the owner might be after. */
    function dishRowsHtml(list, q){
      var si = Number(document.getElementById('dishSet').value);
      var inSet = (plan[si] ? plan[si].dishes : []).map(function(d){ return d.name; });
      var cat = '';
      return list.map(function(d){
        var head = '';
        if (!q && d.cat !== cat) { cat = d.cat; head = '<div class="sub" style="font-size:10px;letter-spacing:.04em;padding:12px 0 3px;font-weight:700">' + esc(cat || 'Other') + '</div>'; }
        var on = inSet.indexOf(d.name) >= 0;
        // Checkbox on the right; tick as many as you like, the panel stays open.
        return head + '<label style="display:flex;gap:8px;align-items:center;width:100%;border-bottom:1px solid #f2ece6;padding:6px 2px;cursor:pointer">'
          + '<span style="flex:1;min-width:0">'
          +   '<span style="display:block;font-size:13px;font-weight:600;line-height:1.25">' + esc(d.name) + '</span>'
          +   (d.nameSi ? '<span class="si" style="display:block;font-size:11px;line-height:1.3">' + esc(d.nameSi) + '</span>' : '')
          + '</span>'
          + '<input type="checkbox" class="feedBox" data-name="' + esc(d.name) + '"' + (on ? ' checked' : '')
          +   ' style="flex:0 0 auto;width:20px;height:20px;accent-color:#d9542b">'
          + '</label>';
      }).join('');
    }
    function wireDishBoxes(host){
      host.querySelectorAll('.feedBox').forEach(function(b){
        b.addEventListener('change', function(){
          if (b.checked) feedTick(b.dataset.name, b);
          else feedUntick(b.dataset.name);
        });
      });
    }

    /* Set types only. The dish list is its own picker — mixing the two into
       one scrolling list made both harder to read. */
    function renderSetPanel(){
      var q = feedQuery.trim().toLowerCase();
      var have = plan.map(function(s){ return s.name.toLowerCase(); });
      var list = SET_CHOICES.filter(function(s){
        if (!q) return true;
        return s.name.toLowerCase().indexOf(q) >= 0 || (s.nameSi || '').toLowerCase().indexOf(q) >= 0;
      });
      document.getElementById('feedCount').textContent =
        plan.length + (plan.length === 1 ? ' set' : ' sets') + ' in plan';
      var host = document.getElementById('feedPanelList');
      if (!list.length) {
        host.innerHTML = '<div style="padding:18px 4px;text-align:center">'
          + '<div class="sub" style="font-size:12px">nothing matches</div>'
          + '<div class="sub" style="font-size:10.5px;margin-top:6px;line-height:1.35">Set types come from a fixed list. Dishes are in the dish picker below.</div>'
          + '</div>';
        return;
      }
      host.innerHTML = list.map(function(s){
        var on = have.indexOf(s.name.toLowerCase()) >= 0;
        // Being renamed — a row of controls, not a tick row. prompt() is a
        // no-op inside the app's WebView, so the editor has to live here.
        if (s.custom && s.name === editingSet) {
          return '<div style="display:flex;gap:6px;align-items:center;width:100%;border-bottom:1px solid #f2ece6;padding:6px 2px">'
            + '<input type="text" id="setEditBox" maxlength="40" value="' + esc(s.name) + '"'
            +   ' style="flex:1;min-width:0;margin:0;font-size:13px;padding:7px 9px">'
            + '<button type="button" id="setEditSave" style="flex:0 0 auto;width:34px;height:34px;border:0;'
            +   'border-radius:99px;background:#191512;color:#fff;font-size:15px;padding:0;cursor:pointer">✓</button>'
            + '<button type="button" id="setEditDel" style="flex:0 0 auto;width:34px;height:34px;border:1px solid #efc4bf;'
            +   'border-radius:99px;background:#fdecea;color:#b3261e;font-size:14px;padding:0;cursor:pointer">🗑</button>'
            + '</div>';
        }
        return '<label style="display:flex;gap:8px;align-items:center;width:100%;border-bottom:1px solid #f2ece6;padding:5px 2px;cursor:pointer">'
          + '<span style="flex:1;min-width:0">'
          +   '<span style="display:block;font-size:13px;font-weight:600;line-height:1.2">' + esc(s.name) + '</span>'
          +   (s.nameSi ? '<span class="si" style="display:block;font-size:10.5px;line-height:1.2">' + esc(s.nameSi) + '</span>' : '')
          + '</span>'
          // Only the shop's own names can be renamed — the fixed six are shared
          // vocabulary and stay put.
          + (s.custom ? '<button type="button" class="setEdit" data-name="' + esc(s.name) + '"'
              + ' style="flex:0 0 auto;width:34px;height:34px;border:1px solid #e3d6c2;background:#fff;'
              + 'border-radius:99px;font-size:17px;line-height:1;padding:0;margin-right:2px;cursor:pointer;color:#d9542b">✎</button>' : '')
          + '<input type="checkbox" class="setBox" data-name="' + esc(s.name) + '"' + (on ? ' checked' : '')
          +   ' style="flex:0 0 auto;width:20px;height:20px;accent-color:#d9542b">'
          + '</label>';
      }).join('') + slotsHtml();
      host.querySelectorAll('.setBox').forEach(function(b){
        b.addEventListener('change', function(){
          if (b.checked) setTick(b.dataset.name);
          else setUntick(b.dataset.name, b);
        });
      });
      host.querySelectorAll('.setEdit').forEach(function(b){
        b.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation();
          editingSet = b.dataset.name;
          renderSetPanel();
        });
      });
      var eb = document.getElementById('setEditSave');
      if (eb) eb.addEventListener('click', function(){
        saveCustomSet(editingSet, document.getElementById('setEditBox').value);
      });
      var db = document.getElementById('setEditDel');
      if (db) db.addEventListener('click', function(){ saveCustomSet(editingSet, ''); });
      wireSlots(host);
    }

    /* Empty slots so a shop can name a package the fixed list doesn't cover.
       Capped, so this stays a considered addition rather than free text. */
    function slotsHtml(){
      if (feedQuery.trim() || FREE_SLOTS <= 0) return '';
      var rows = '';
      for (var i = 0; i < FREE_SLOTS; i++) {
        rows += '<div style="display:flex;gap:8px;align-items:center;width:100%;border-bottom:1px solid #f2ece6;padding:5px 2px">'
          + '<input type="text" class="slotBox" maxlength="40" placeholder="new package name…" data-i="' + i + '"'
          +   ' style="flex:1;min-width:0;margin:0;font-size:12.5px;padding:5px 8px">'
          + '<button type="button" class="slotOk" data-i="' + i + '"'
          +   ' style="flex:0 0 auto;width:26px;height:26px;border:0;border-radius:99px;background:#191512;color:#fff;font-size:13px;cursor:pointer;padding:0">✓</button>'
          + '</div>';
      }
      return '<div class="sub" style="font-size:9.5px;letter-spacing:.04em;padding:10px 0 2px;font-weight:700">YOUR OWN · ' + FREE_SLOTS + ' left</div>'
        + (slotNote ? '<div id="slotNote" style="font-size:11px;padding:4px 2px;color:#b3261e;line-height:1.3">' + esc(slotNote) + '</div>' : '')
        + rows;
    }

    function wireSlots(host){
      host.querySelectorAll('.slotOk').forEach(function(b){
        b.addEventListener('click', function(){
          var box = host.querySelectorAll('.slotBox')[Number(b.dataset.i)];
          addCustomSet(box ? box.value : '');
        });
      });
    }

    /* Saved on the shop, so the name is there next time instead of being
       retyped — and rejected if it only differs from an existing one by
       case or spacing. */
    function addCustomSet(raw){
      var msg = document.getElementById('addSetMsg');
      // NB: this whole script is inside a template literal, so the backslash
      // has to be doubled or it renders as /s+/g and eats every "s".
      var name = String(raw || '').trim().replace(/\\s+/g, ' ');
      if (!name) return;
      if (SET_CHOICES.some(function(s){ return s.name.toLowerCase() === name.toLowerCase(); })) {
        slotNote = '"' + name + '" is already in the list above.';
        msg.textContent = slotNote;
        renderSetPanel();
        return;
      }
      fetch('/app/owner/' + SHOP_ID + '/menu/set-type', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name: name}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j.ok) { slotNote = j.error || 'Failed'; msg.textContent = slotNote; renderSetPanel(); return; }
        slotNote = '';
        SET_CHOICES.push({name: name, nameSi: '', custom: true});
        FREE_SLOTS = Math.max(0, FREE_SLOTS - 1);
        setTick(name);
      })
      .catch(function(e){ msg.textContent = e.message; });
    }

    /* Rename one of the shop's own names, or pass an empty name to delete.
       Follows through to the plan on screen and to saved plans server-side. */
    var editingSet = '';
    function saveCustomSet(from, raw){
      var msg = document.getElementById('addSetMsg');
      var to = String(raw || '').trim().replace(/\\s+/g, ' ');
      if (to === from) { editingSet = ''; renderSetPanel(); return; }
      fetch('/app/owner/' + SHOP_ID + '/menu/set-type/edit', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({from: from, to: to}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j.ok) { slotNote = j.error || 'Failed'; msg.textContent = slotNote; renderSetPanel(); return; }
        slotNote = '';
        if (j.deleted) {
          SET_CHOICES = SET_CHOICES.filter(function(x){ return x.name !== from; });
          plan = plan.filter(function(p){ return p.name !== from; });
          FREE_SLOTS = FREE_SLOTS + 1;
          msg.textContent = from + ' deleted.';
        } else {
          SET_CHOICES.forEach(function(x){ if (x.name === from) x.name = j.to; });
          plan.forEach(function(p){ if (p.name === from) p.name = j.to; });
          msg.textContent = from + ' → ' + j.to;
        }
        editingSet = '';
        renderPlan(); renderSetPanel();
      })
      .catch(function(e){ msg.textContent = e.message; });
    }

    /* Only names already in SET_CHOICES reach this — the panel offers nothing
       else, so a plan can never carry an invented set name. */
    function setTick(name){
      var msg = document.getElementById('addSetMsg');
      if (plan.some(function(s){ return s.name.toLowerCase() === name.toLowerCase(); })) return;
      plan.push({name: name, pick: 1, price: null, dishes: []});
      msg.textContent = '"' + name + '" added — dishes go here now.';
      renderPlan();
      document.getElementById('dishSet').value = String(plan.length - 1);
      renderPlan(); renderSetPanel();
    }

    /* Untick drops the set. Confirm first if the owner already put dishes in
       it, otherwise a stray tap wipes their work. */
    function setUntick(name, box){
      var i = plan.map(function(s){ return s.name.toLowerCase(); }).indexOf(name.toLowerCase());
      if (i < 0) return;
      var had = plan[i].dishes.length;
      plan.splice(i, 1);
      slotNote = name + ' removed' + (had ? ' with its ' + had + ' dish(es)' : '') + ' — tick it again to bring it back.';
      document.getElementById('addSetMsg').textContent = slotNote;
      renderPlan(); renderSetPanel();
    }

    /* Tick — reuse the shop's dish if it already exists, otherwise pull it in
       from the shared list at price 0 for pricing in the set below. */
    function feedTick(name, box){
      var si = Number(document.getElementById('dishSet').value);
      var msg = document.getElementById('addSetMsg');
      var own = SHOP_DISHES.filter(function(x){ return x.name === name; })[0];
      if (own) {
        // No set chosen? The dish still goes on the day — that is the menu.
        addToDay(own.id);
        if (plan[si] && !plan[si].dishes.some(function(d){ return d.id === own.id; })) {
          plan[si].dishes.push({id: own.id, name: own.name, nameSi: own.nameSi, price: own.price});
        }
        msg.textContent = plan[si] ? name + ' → ' + plan[si].name : name + ' on ' + PLAN_DATE;
        renderPlan(); renderFeedPanel();
        return;
      }
      fetch('/app/owner/' + SHOP_ID + '/menu/add-from-feed', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({name: name, price: 0, meal: PLAN_MEAL}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (!j.ok) { msg.textContent = j.error || 'Failed'; if (box) box.checked = false; return; }
        var fedPrice = Number(j.price) || 0;
        SHOP_DISHES.push({id: j.id, name: name, nameSi: j.nameSi || '', price: fedPrice, cat: '', meals: ['Breakfast','Lunch','Dinner'], own: true});
        addToDay(j.id);
        if (plan[si] && !plan[si].dishes.some(function(d){ return d.id === j.id; })) {
          plan[si].dishes.push({id: j.id, name: name, nameSi: j.nameSi || '', price: fedPrice});
        }
        msg.textContent = name + (fedPrice ? ' added at ' + money(fedPrice) + '.' : ' added — set its price on the right.');
        renderPlan(); renderFeedPanel();
      })
      .catch(function(e){ msg.textContent = e.message; if (box) box.checked = false; });
    }
    function feedUntick(name){
      var si = Number(document.getElementById('dishSet').value);
      var known = SHOP_DISHES.filter(function(x){ return x.name === name; })[0];
      if (known) dayDishes = dayDishes.filter(function(x){ return x !== String(known.id); });
      if (!plan[si]) { document.getElementById('addSetMsg').textContent = name + ' off ' + PLAN_DATE + '.'; renderPlan(); renderFeedPanel(); return; }
      plan[si].dishes = plan[si].dishes.filter(function(d){ return d.name !== name; });
      document.getElementById('addSetMsg').textContent = name + ' removed.';
      renderPlan(); renderFeedPanel();
    }

    function openFeedPanel(mode){
      panelMode = mode === 'set' ? 'set' : 'dish';
      feedQuery = '';
      var search = document.getElementById('feedSearch');
      search.value = '';
      search.placeholder = panelMode === 'set'
        ? 'Search set types…'
        : 'Search ' + FEED_DISHES.length + ' dishes…';
      document.getElementById('feedBackdrop').style.display = '';
      document.getElementById('feedPanel').style.display = '';
      renderFeedPanel();
    }
    function closeFeedPanel(){
      document.getElementById('feedBackdrop').style.display = 'none';
      document.getElementById('feedPanel').style.display = 'none';
    }
    document.getElementById('dishItemBtn').addEventListener('click', function(){ openFeedPanel('dish'); });
    document.getElementById('setItemBtn').addEventListener('click', function(){ openFeedPanel('set'); });
    document.getElementById('setDishBtn').addEventListener('click', function(){ openFeedPanel('dish'); });
    document.getElementById('feedBackdrop').addEventListener('click', closeFeedPanel);
    document.getElementById('feedDone').addEventListener('click', closeFeedPanel);
    document.getElementById('feedSearch').addEventListener('input', function(){
      feedQuery = this.value; renderFeedPanel();
    });

    /* ---- paste a whole menu ------------------------------------------
       The owner writes the day out for WhatsApp anyway. This sends that text
       to the server, which reads it, adds anything the shared dish list is
       missing, and hands back sets and dishes. They land in the builder
       unsaved-but-autosaving, so everything is still editable by hand. */
    /* WKWebView puts back whatever was typed in a form when the page reloads.
       Handy for a half-written menu, wrong for text that arrived with its
       Sinhala already broken (‡∂¥ for පො) — that comes back every refresh and
       looks like the app is doing it. Only that gets cleared. */
    function clearIfGarbled(el){
      if (!el || !el.value) return;
      var marks = (el.value.match(/[‡†∂∑ΩÎÄâÃ¬Â]/g) || []).length;
      if (marks >= 3 && marks / el.value.length > 0.1) el.value = '';
    }
    clearIfGarbled(document.getElementById('pasteText'));
    /* Coming back to this screen restores the page from the WebView's
       back/forward cache — same DOM, same field contents, no reload. Without
       this the broken text is still sitting there every time you return. */
    window.addEventListener('pageshow', function(){
      clearIfGarbled(document.getElementById('pasteText'));
    });

    function openPaste(){
      clearIfGarbled(document.getElementById('pasteText'));
      document.getElementById('pasteBackdrop').style.display = '';
      document.getElementById('pastePanel').style.display = 'flex';
      document.getElementById('pasteMsg').textContent = '';
      document.getElementById('pasteResult').innerHTML = '';
      var t = document.getElementById('pasteText');
      t.focus();
    }
    function closePaste(){
      document.getElementById('pasteBackdrop').style.display = 'none';
      document.getElementById('pastePanel').style.display = 'none';
    }
    document.querySelectorAll('.pasteOpen').forEach(function(b){
      b.addEventListener('click', function(){ closeFeedPanel(); openPaste(); });
    });
    document.getElementById('pasteCancel').addEventListener('click', closePaste);
    document.getElementById('pasteBackdrop').addEventListener('click', closePaste);

    var pasteBusy = false;
    document.getElementById('pasteGo').addEventListener('click', function(){
      var go = document.getElementById('pasteGo');
      var msg = document.getElementById('pasteMsg');
      var text = document.getElementById('pasteText').value;
      if (!text.trim()) { msg.textContent = 'Paste the menu text first.'; return; }
      if (pasteBusy) return;
      pasteBusy = true;
      go.disabled = true;
      go.textContent = 'Reading…';
      msg.textContent = 'Reading your menu, checking every dish against the list…';
      document.getElementById('pasteResult').innerHTML = '';
      fetch('/app/owner/' + SHOP_ID + '/menu/paste.json', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({text: text, date: PLAN_DATE, meal: PLAN_MEAL}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        pasteBusy = false; go.disabled = false; go.textContent = 'Build my menu';
        if (!j.ok) { msg.textContent = j.error || 'Could not read that — try again.'; return; }
        applyPasted(j);
      })
      .catch(function(e){
        pasteBusy = false; go.disabled = false; go.textContent = 'Build my menu';
        msg.textContent = 'No connection (' + e.message + ') — your text is still here.';
      });
    });

    /* Merge what came back into the plan on screen. Sets already there keep
       their dishes and gain the pasted ones; nothing is replaced. */
    function applyPasted(j){
      var nSets = 0, nDishes = 0;
      (j.groups || []).forEach(function(g){
        var names = plan.map(function(s){ return s.name.toLowerCase(); });
        var i = names.indexOf(String(g.name).toLowerCase());
        if (i < 0) { plan.push({name: g.name, pick: Number(g.pick) || 1, price: g.price == null ? null : g.price, dishes: []}); i = plan.length - 1; nSets++; }
        else {
          if (g.pick) plan[i].pick = Number(g.pick);
          if (g.price != null) plan[i].price = g.price;
        }
        (g.dishes || []).forEach(function(d){
          var had = plan[i].dishes.filter(function(x){ return x.id === d.id; })[0];
          // Already in the set: take the price from the paste. Writing "6$"
          // for a dish that was 5$ has already changed it on the server, so
          // leaving the old figure on screen would just look like it failed.
          if (had) { had.price = Number(d.price) || 0; had.nameSi = d.nameSi || had.nameSi; return; }
          plan[i].dishes.push({id: d.id, name: d.name, nameSi: d.nameSi || '', price: Number(d.price) || 0});
        });
      });
      (j.dishIds || []).forEach(function(id){
        if (!onDay(id)) { addToDay(id); nDishes++; }
      });
      // Dishes the shop had never listed are now real — put them in the local
      // list so Dish mode and the pickers see them without a page reload.
      (j.groups || []).forEach(function(g){
        (g.dishes || []).forEach(function(d){
          var known = SHOP_DISHES.filter(function(x){ return x.id === d.id; })[0];
          if (known) { known.price = Number(d.price) || 0; return; }
          SHOP_DISHES.push({id: d.id, name: d.name, nameSi: d.nameSi || '', price: Number(d.price) || 0, cat: '', meals: ['Breakfast','Lunch','Dinner'], own: true});
        });
      });
      (j.newTypes || []).forEach(function(n){
        if (!SET_CHOICES.some(function(s){ return s.name.toLowerCase() === n.toLowerCase(); })) {
          SET_CHOICES.push({name: n, nameSi: '', custom: true});
          FREE_SLOTS = Math.max(0, FREE_SLOTS - 1);
        }
      });

      document.getElementById('pasteMsg').textContent = '';
      var out = '<div class="card" style="margin:0;padding:9px 11px;background:#e8f6ec;border-color:#bfe5c8">'
        + '<div style="font-weight:700;color:#1d7a34;font-size:12px">Built · ' + (j.groups || []).length + ' set'
        + (((j.groups || []).length === 1) ? '' : 's') + ' · ' + (j.dishIds || []).length + ' dishes on '
        + PLAN_MEAL + ' ' + PLAN_DATE + '</div>'
        + '<div class="sub" style="font-size:10.5px;margin-top:4px;line-height:1.4">It saves itself. Close this and edit anything — prices, dishes, how many the buyer picks.</div>'
        + '</div>';
      if ((j.created || []).length) {
        out += '<div class="sub" style="font-size:10.5px;margin-top:6px;line-height:1.4">'
          + '<strong style="color:#d9542b">New in the shared dish list:</strong> ' + esc(j.created.join(', '))
          + ' — there next time, for every shop.</div>';
      }
      if ((j.newTypes || []).length) {
        out += '<div class="sub" style="font-size:10.5px;margin-top:4px;line-height:1.4">New set name'
          + (j.newTypes.length === 1 ? '' : 's') + ': ' + esc(j.newTypes.join(', '))
          + ' · ' + j.slotsLeft + ' of your own left.</div>';
      }
      if ((j.renamed || []).length) {
        out += '<div class="sub" style="font-size:10.5px;margin-top:6px;line-height:1.45">'
          + j.renamed.map(function(r){ return '<strong>' + esc(r.from) + '</strong> → ' + esc(r.to); }).join('<br>')
          + '<br>Set names come from the fixed list plus three of your own, and yours are full'
          + ((j.setsInUse || []).length ? ' (' + esc(j.setsInUse.join(', ')) + ')' : '')
          + '. Free one in <strong>Pick set types</strong> to use your own wording.</div>';
      }
      if ((j.unplaced || []).length) {
        out += '<div style="font-size:10.5px;margin-top:6px;line-height:1.4;color:#b3261e">'
          + '<strong>' + esc(j.unplaced.join(', ')) + '</strong> could not become a set — '
          + 'set names are the fixed six plus three of your own, and yours are used'
          + ((j.setsInUse || []).length ? ' (' + esc(j.setsInUse.join(', ')) + ')' : '') + '. '
          + 'Those dishes are on the day anyway. Free one of your names in <strong>Pick set types</strong> '
          + '(the ✎), then paste again.</div>';
      }
      if (j.loose) {
        out += '<div style="font-size:10.5px;margin-top:6px;line-height:1.4;color:#946200">'
          + j.loose + ' dish' + (j.loose === 1 ? '' : 'es') + ' went on the day without a set — '
          + 'find them under <strong>Dish</strong>, or drop them into a set with Pick combo.</div>';
      }
      if (j.garbled) {
        out += '<div style="font-size:10.5px;margin-top:6px;line-height:1.4;color:#b3261e">'
          + j.garbled + ' line' + (j.garbled === 1 ? '' : 's') + ' arrived with broken Sinhala '
          + '(‡∂¥ instead of පො), so the Sinhala was dropped — the English name is fine. '
          + 'It happens when the text crosses a computer that mangles it; copy it again '
          + 'from the phone rather than retyping.</div>';
      }
      if (j.note) {
        out += '<div class="sub" style="font-size:10.5px;margin-top:6px;line-height:1.4">Not a dish, so left out: ' + esc(j.note) + '</div>';
      }
      document.getElementById('pasteResult').innerHTML = out;

      renderPlan();                              // draws, drafts, and marks dirty
      if (addMode === 'dish') renderCatalogue();
      refreshOwnerLists();
    }

    /* Pull the shop's dish list and the catalogue again after a paste, so the
       new dishes carry their real categories instead of the blank we guessed
       locally. The plan itself is left alone — it is on screen and not yet
       saved. */
    function refreshOwnerLists(){
      fetch('/app/owner/' + SHOP_ID + '/menu.json?date=' + encodeURIComponent(PLAN_DATE) + '&meal=' + encodeURIComponent(PLAN_MEAL))
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (!j.ok) return;
          if (j.myDishes) {
            SHOP_DISHES = j.myDishes.map(function(d){
              return {id: d.id, name: d.name, nameSi: d.nameSi || '', price: Number(d.price) || 0,
                      cat: d.category || '', meals: ['Breakfast','Lunch','Dinner'], own: true};
            });
          }
          if (j.dishes) {
            FEED_DISHES = j.dishes.map(function(d){
              return {name: d.name, nameSi: d.nameSi || '', cat: d.category || '', pos: d.pos || 'Vegi meals'};
            });
          }
          if (addMode === 'dish') renderCatalogue();
        })
        .catch(function(){ /* the local list is good enough until the next load */ });
    }

    /* Load another day/meal without leaving the page. */
    function switchPlan(date, meal){
      if (saveTimer) { clearTimeout(saveTimer); savePlan(); }
      PLAN_DATE = date; PLAN_MEAL = meal;
      DRAFT_KEY = 'plan:' + SHOP_ID + ':' + PLAN_DATE + ':' + PLAN_MEAL;
      document.getElementById('planDateBox').value = date;
      document.querySelectorAll('#mealRow .mealBtn').forEach(function(b){
        var on = b.dataset.meal === meal;
        b.style.background = on ? '#191512' : '#fff';
        b.style.color = on ? '#fff' : '#4a443f';
      });
      document.getElementById('planStamp').textContent = meal + ' plan · loading…';
      paintSave('dirty', 'Loading ' + meal + ' ' + date + '…');
      fetch('/app/owner/' + SHOP_ID + '/menu.json?date=' + encodeURIComponent(date) + '&meal=' + encodeURIComponent(meal), { headers: { Accept: 'application/json' } })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (!j.ok) throw new Error(j.error || 'could not load');
          dayDishes = (j.dishIds || []).slice();
          // Same fallback for plans saved before day dish lists existed.
          if (!dayDishes.length) {
            (j.plan || []).forEach(function(g){ (g.dishes || []).forEach(function(d){ addToDay(d.id); }); });
          }
          plan = (j.plan || []).map(function(g){
            return { name: g.name, pick: g.pick, price: g.price == null ? null : g.price,
                     dishes: (g.dishes || []).map(function(d){ return { id: d.id, name: d.name, nameSi: d.nameSi, price: d.price }; }) };
          });
          document.getElementById('dishSet').value = '0';
          firstPaint = true;                 // loading isn't an edit
          renderPlan();
          lastSaved = JSON.stringify([plan, dayDishes]);
          firstPaint = false;
          document.getElementById('planStamp').textContent = meal + ' plan' + (plan.length ? '' : ' · new');
          var any = plan.length || dayDishes.length;
          paintSave(any ? 'saved' : 'idle',
            any ? 'Saved · ' + meal + ' ' + date : meal + ' plan · ' + date + ' · nothing added yet');
        })
        .catch(function(e){
          document.getElementById('planStamp').textContent = meal + ' plan';
          paintSave('error', 'Could not load ' + date + ' — tap to retry');
        });
    }
    document.getElementById('planDateBox').addEventListener('change', function(){
      if (this.value) switchPlan(this.value, PLAN_MEAL);
    });
    document.querySelectorAll('#mealRow .mealBtn').forEach(function(b){
      b.addEventListener('click', function(){ switchPlan(PLAN_DATE, b.dataset.meal); });
    });

    function serialisePlan(){
      document.getElementById('planJson').value = JSON.stringify(plan);
      return true;
    }

    /* A draft is kept per date+meal so a reload, an accidental back, or the
       WebView reloading under you never costs the work. */
    var DRAFT_KEY = 'plan:' + SHOP_ID + ':' + PLAN_DATE + ':' + PLAN_MEAL;  // recomputed on switch
    function saveDraft(){
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(plan)); } catch (e) {}
    }
    function loadDraft(){
      try {
        var raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return false;
        var d = JSON.parse(raw);
        if (!Array.isArray(d) || !d.length) return false;
        if (plan.length) return false;          // a saved plan wins over a draft
        plan = d;
        document.getElementById('saveNote').textContent = 'Restored your unsaved changes.';
        return true;
      } catch (e) { return false; }
    }

    /* Posts JSON and stays on the page. The old form submit navigated away,
       and in this WebView that navigation can be cancelled — which lost the
       whole plan with no warning. */
    /* Autosave. A busy kitchen shouldn't have to remember a Save button, so
       the button becomes the status light instead:
         orange = edited, not saved yet     green = saved     red = failed */
    var saveTimer = null, lastSaved = '', firstPaint = true;
    var restTimer = null;
    function paintSave(state, text){
      var el = document.getElementById('saveBtn');
      if (!el) return;
      clearTimeout(restTimer);
      // Hold the green long enough to be noticed, then settle back to grey.
      if (state === 'saved') {
        restTimer = setTimeout(function(){
          paintSave('idle', PLAN_MEAL + ' plan · ' + PLAN_DATE + ' · all saved');
        }, 10000);
      }
      el.style.color = state === 'saved' ? '#1d7a34'      // green  — stored
        : state === 'error' ? '#b3261e'                   // red    — failed
        : state === 'dirty' ? '#d9542b'                   // orange — editing
        : '#4a443f';                                      // grey   — idle
      el.textContent = text;
    }
    function markDirty(){
      if (firstPaint) return;
      var now = JSON.stringify([plan, dayDishes]);
      if (now === lastSaved) return;
      paintSave('dirty', 'Saving ' + PLAN_MEAL + ' ' + PLAN_DATE + '…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function(){ savePlan(); }, 1200);
    }

    function savePlan(ev){
      if (ev) ev.preventDefault();
      var btn = document.getElementById('saveBtn');
      var note = document.getElementById('saveNote');
      // A day can hold dishes with no sets at all — that is still a menu.
      if (!plan.length && !dayDishes.length) { note.textContent = 'Nothing to save yet.'; return false; }
      btn.disabled = true;
      fetch('/app/owner/' + SHOP_ID + '/menu/plan.json', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({date: PLAN_DATE, meal: PLAN_MEAL, groups: plan, dishIds: dayDishes}),
      })
      .then(function(r){ return r.json(); })
      .then(function(j){
        btn.disabled = false;
        if (!j.ok) {
          paintSave('error', 'Not saved — tap to retry');
          note.textContent = j.error || 'Could not save — your plan is still here.';
          return;
        }
        lastSaved = JSON.stringify([plan, dayDishes]);
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        paintSave('saved', 'Saved · ' + PLAN_MEAL + ' ' + PLAN_DATE);
        note.textContent = j.groups + ' set' + (j.groups === 1 ? '' : 's')
          + ' · ' + (j.dishes != null ? j.dishes : dayDishes.length) + ' dishes saved';
      })
      .catch(function(e){
        btn.disabled = false;
        paintSave('error', 'Not saved — tap to retry');
        note.textContent = 'No connection (' + e.message + ') — your plan is safe on this page.';
      });
      return false;
    }
    loadDraft();
    renderPlan();
    lastSaved = JSON.stringify([plan, dayDishes]);
    firstPaint = false;
    var hasAny = plan.length || dayDishes.length;
    paintSave(hasAny ? 'saved' : 'idle',
      hasAny ? 'Saved · ' + PLAN_MEAL + ' ' + PLAN_DATE : PLAN_MEAL + ' plan · ' + PLAN_DATE + ' · nothing added yet');

    </script>`);
}

/* The day you planned, costed. Same date and meal row as Plan Menu, so this
   is the same menu seen from the kitchen's side: what each dish costs to
   cook against what you charge for it.

   Every number is ours — the 5-person ingredient tables in the dish
   catalogue, priced from the LKR ingredient library. Nothing is fetched. A
   dish the catalogue has no recipe for says so rather than showing a
   flattering zero. */
function costsPage(shop, extras = {}) {
  const id = String(shop._id);
  const date = extras.date || new Date().toISOString().slice(0, 10);
  const meal = extras.meal || "Lunch";
  const sets = extras.sets || [];
  // A dot means "something is planned here", nothing means empty.
  const planMeals = extras.plannedMeals || [];
  const planDates = extras.plannedDates || [];
  const dishes = extras.dishes || [];

  // LKR_TO holds multipliers — LKR × LKR_TO.USD = dollars.
  // Seven days that roll with the one you are on — yesterday, the day shown,
  // and the five ahead. A fixed Mon–Sun strands you at the edge on a Sunday;
  // this way the next days to plan are always the ones in front of you.
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const shown = new Date(date + "T00:00:00Z");
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(shown);
    d.setUTCDate(shown.getUTCDate() + i - 1);
    const iso = d.toISOString().slice(0, 10);
    return { iso, dow: DOW[d.getUTCDay()], day: d.getUTCDate(), today: iso === todayIso };
  });

  const money = (lkr) => `$${((Number(lkr) || 0) * LKR_TO.USD).toFixed(2)} / LKR ${(Number(lkr) || 0).toLocaleString()}`;
  const marginOf = (cost, sale) => (!sale || cost == null ? null : Math.round(((sale - cost) / sale) * 100));

  /* One set, one card. The header is a single line — a kitchen reads
     "costs 414, sells 300, −38%" faster than three stacked labels. */
  const row = (name, kind, cost, sale, note, detail = "", base = undefined, partial = false) => {
    // A set's margin is measured against the dishes that could be costed, not
    // against the whole set's price — otherwise one costed dish out of five
    // reports the set as 90% profitable.
    const margin = marginOf(cost, base === undefined ? sale : base);
    const pill = margin == null
      ? `<span class="pill" style="font-size:10px;color:#8a827b;padding:3px 8px">no recipe</span>`
      : statusPill((partial ? "≈" : "") + margin + "%", margin < 30 ? "warn" : "ok");
    return `
    <div class="card" style="margin-top:9px;padding:11px 13px">
      <div style="display:flex;gap:8px;align-items:baseline">
        <strong style="font-size:13.5px;flex:1;min-width:0">${esc(name)}</strong>
        <span class="sub" style="font-size:10px;flex:0 0 auto">${esc(kind)}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;font-size:12px">
        <span style="flex:1;min-width:0">
          <span class="sub">costs</span> <strong>${cost == null ? "—" : "LKR " + cost.toLocaleString()}</strong>
          <span class="sub"> · sells</span> <strong>${sale ? "LKR " + sale.toLocaleString() : `<span style="color:#b3261e">—</span>`}</strong>
        </span>
        ${pill}
      </div>
      ${note ? `<div class="sub" style="font-size:10px;margin-top:3px;line-height:1.35">${note}</div>` : ""}
      ${detail ? `
      <!-- A kitchen cooks a set in one number: "twenty today". These put that
           number on every dish at once; any single dish can still be nudged
           afterwards. -->
      <div style="display:flex;gap:5px;align-items:center;margin-top:7px;flex-wrap:wrap">
        <span class="sub" style="font-size:10px">set all</span>
        ${[5, 10, 15, 20, 25].map((n) => `<button type="button" class="bulkBtn" data-n="${n}"
          style="border:1px solid #e0d6cc;background:#fff;color:#4a443f;border-radius:99px;width:34px;height:34px;
          font-size:12px;font-weight:700;cursor:pointer;padding:0">${n}</button>`).join("")}
        <button type="button" class="bulkBtn" data-n="0"
          style="border:1px solid #efc4bf;background:#fdecea;color:#b3261e;border-radius:99px;padding:0 11px;height:34px;
          font-size:11px;font-weight:700;cursor:pointer">clear</button>
      </div>` : ""}
      ${detail}
    </div>`;
  };

  // A dish inside a set is costed there; this is the rest of the day.
  const inSets = new Set(sets.flatMap((s) => s.rows.map((r) => r.name)));
  const loose = dishes.filter((d) => !inSets.has(d.name));

  // Only what can be costed counts towards the average — a dish with no
  // recipe would otherwise drag the shop's margin around for no reason.
  // Every dish that has both a recipe and a price, wherever it sits. Counting
  // whole sets only said "nothing here has both" on a day where a dish plainly
  // did — it was just inside a set we could not fully cost.
  const allDishes = [...sets.flatMap((x) => x.rows), ...loose];
  const costed = allDishes.filter((d) => d.cost != null && d.sale);
  const avg = costed.length
    ? Math.round(costed.reduce((n, x) => n + marginOf(x.cost, x.sale), 0) / costed.length)
    : null;

  /* What is actually inside the set, line by line. The set's own figure is an
     average across these, so without them a bad margin says nothing about
     which dish caused it. */
  /* Every ingredient of a dish with what it costs, so a wrong price can be
     corrected where it is noticed. Hidden until "prices" is tapped. */
  const ingPanel = (r) => !r.lines.length ? "" : `
          <div id="ing-${esc(r.id)}" style="display:none;margin-top:6px;background:#faf7f4;border-radius:9px;padding:7px 8px">
            ${r.lines.map((l) => `
              <div style="display:flex;gap:6px;align-items:center;padding:3px 0;font-size:10.5px">
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title="${esc(l.name)}">${esc(l.name)}<span class="sub"> · ${l.qty == null ? "to taste" : esc(String(l.qty)) + " " + esc(l.unit || "")}</span></span>
                <input type="number" inputmode="numeric" min="0" class="rateBox" data-key="${esc(l.key)}" data-per="${esc(l.per)}" value="${l.rate == null ? "" : l.rate}"
                  placeholder="?" style="margin:0;width:66px;padding:5px 4px;font-size:12.5px;text-align:center;border-radius:8px;${l.mine ? `border-color:${ORANGE};color:${ORANGE};font-weight:700` : ""}">
                <span class="sub" style="flex:0 0 auto;width:42px;font-size:9.5px">/${esc(l.per)}</span>
              </div>`).join("")}
            <div class="sub" style="font-size:9.5px;margin-top:4px;line-height:1.35">Type what you pay — orange is your price. Clear it to use ours.</div>
          </div>`;

  /* How many of this dish the kitchen is cooking, and what that run costs.
     The same control whether the dish sits in a set or stands on its own. */
  const counter = (r) => {
    const total = r.cost != null && r.portions ? r.cost * r.portions : null;
    return `
          <div style="display:flex;gap:6px;align-items:center;margin-top:5px">
            <button type="button" class="stepBtn" data-id="${esc(r.id)}" data-step="-1"
              style="flex:0 0 auto;width:34px;height:34px;border:1px solid #e0d6cc;background:#fff;border-radius:10px;font-size:18px;font-weight:700;line-height:1;color:#4a443f;cursor:pointer;padding:0">−</button>
            <input type="number" inputmode="numeric" min="0" max="9999" class="portionBox" data-id="${esc(r.id)}"
              data-cost="${r.cost == null ? "" : r.cost}" value="${r.portions || ""}"
              placeholder="0" style="margin:0;width:56px;padding:6px 4px;font-size:15px;font-weight:700;text-align:center;border-radius:9px">
            <button type="button" class="stepBtn" data-id="${esc(r.id)}" data-step="1"
              style="flex:0 0 auto;width:34px;height:34px;border:0;background:${ORANGE};color:#fff;border-radius:10px;font-size:18px;font-weight:700;line-height:1;cursor:pointer;padding:0">+</button>
            <span id="tot-${esc(r.id)}" style="flex:1;min-width:0;font-weight:700;font-size:12.5px;color:#4a443f">${total == null ? "" : "LKR " + total.toLocaleString()}</span>
            ${r.lines.length ? `<button type="button" class="ingToggle" data-id="${esc(r.id)}"
              style="flex:0 0 auto;border:0;background:none;font-size:11px;cursor:pointer;color:${ORANGE};font-weight:700;padding:4px 2px;text-decoration:underline">prices</button>`
            : `<!-- No recipe for this one, so there is nothing to add up. The
                    owner types what it costs them instead. -->
              <span class="sub" style="flex:0 0 auto;font-size:10px">cost</span>
              <input type="number" inputmode="numeric" min="0" class="costBox" data-id="${esc(r.id)}" value="${r.typed || ""}"
                placeholder="?" style="margin:0;width:66px;padding:5px 4px;font-size:12.5px;text-align:center;border-radius:8px;${r.typed ? `border-color:${ORANGE};color:${ORANGE};font-weight:700` : ""}">`}
          </div>
          ${ingPanel(r)}`;
  };

  /* A dish inside the set: what it costs against what it sells for, then the
     counter. Two tight lines, so eight side dishes read as a list rather than
     a wall. */
  const inner = (rows) => !rows.length ? "" : `
    <div style="margin-top:8px;border-top:1px solid #f2ece6">
      ${rows.map((r) => {
        const mg = marginOf(r.cost, r.sale);
        return `<div style="padding:7px 0;border-bottom:1px solid #f7f3ef">
          <div style="display:flex;gap:8px;align-items:baseline">
            <span style="flex:1;min-width:0">
              <span style="font-weight:600;font-size:12px">${esc(r.name)}</span>
              ${r.nameSi ? `<span class="si" style="font-size:10px"> ${esc(r.nameSi)}</span>` : ""}
            </span>
            <span style="flex:0 0 auto;font-size:10.5px;white-space:nowrap">
              <span class="sub">${r.cost == null ? "—" : r.cost.toLocaleString()}</span><span class="sub"> → </span><span style="font-weight:700;color:${mg == null ? "#8a827b" : mg < 30 ? "#b3261e" : "#1d7a34"}">${r.sale ? r.sale.toLocaleString() : "—"}${mg == null ? "" : " · " + mg + "%"}</span>
            </span>
          </div>
          ${counter(r)}
        </div>`;
      }).join("")}
    </div>`;


  const setCards = sets.map((s) => row(
    // No margin means we could not cost enough of it, so show no cost either
    // rather than let one dish's figure stand for the whole set.
    s.label, `Set menu · pick ${s.pick}`, s.marginBase ? s.cost : null, s.sale,
    `${s.costed} of ${s.of} priced from the recipe book`
    + (s.partial ? ` · ≈ margin is for those ${s.costed}` : "")
    + (s.pick > 1 ? ` · cost is the average of the choices × ${s.pick}` : "")
    + (s.fixedPrice ? " · you set this set's price" : " · priced by the dish picked"),
    inner(s.rows), s.marginBase, s.partial,
  )).join("");

  /* Dishes the owner never put in a set. Twenty of them as twenty cards is
     unreadable, so they group onto their shelf — rice, meat, vegetables —
     and each card totals the run its portions describe. */
  // Menu order, not the order the dishes happen to sit in the plan: rice
  // opens a Sri Lankan meal and sweets close it, and the sheet should read
  // the way the meal is served.
  const SHELF_ORDER = ["Rice & staples", "Meat & seafood", "Vegetables",
    "Salads & sambols", "Breads & snacks", "Sweets", "Other dishes"];
  const shelves = [];
  for (const d of loose) {
    let g = shelves.find((x) => x.name === d.shelf);
    if (!g) { g = { name: d.shelf, rows: [] }; shelves.push(g); }
    g.rows.push(d);
  }
  shelves.sort((a, b) => {
    const ai = SHELF_ORDER.indexOf(a.name), bi = SHELF_ORDER.indexOf(b.name);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const dishCards = shelves.map((g) => {
    const cooked = g.rows.filter((r) => r.portions);
    const runCost = cooked.reduce((n, r) => n + (r.cost || 0) * r.portions, 0);
    const runSale = cooked.reduce((n, r) => n + (r.sale || 0) * r.portions, 0);
    const anyCost = cooked.some((r) => r.cost != null);
    return row(
      g.name, `${g.rows.length} dish${g.rows.length === 1 ? "" : "es"} on the day`,
      cooked.length && anyCost ? runCost : null,
      cooked.length ? runSale : 0,
      cooked.length
        ? `for the portions below`
        : `add portions to cost the run`,
      inner(g.rows),
    );
  }).join("");

  return page(shop, "costs", "Portion Plan", "කී දෙනෙකුට උයනවාද?", `
    <style>
      /* The stepper arrows come out bigger than the number itself on iOS and
         are a poor target next to it. Type the number instead. */
      .portionBox::-webkit-outer-spin-button, .portionBox::-webkit-inner-spin-button,
      .rateBox::-webkit-outer-spin-button, .rateBox::-webkit-inner-spin-button {
        -webkit-appearance: none; appearance: none; margin: 0;
      }
      .portionBox, .rateBox { -moz-appearance: textfield; appearance: textfield; }
    </style>
    <!-- The same day and meal as Plan Menu, so the two screens always agree. -->
    <div style="margin-top:12px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center">
        <input type="date" id="costDate" value="${esc(date)}" style="margin:0;font-weight:700;font-size:13px">
        <span class="sub" style="font-size:11px">${extras.hasPlan ? `${esc(meal)} plan` : "no plan yet"}</span>
      </div>
      <!-- The week the shown date sits in. A kitchen plans in days, and
           flipping between them is the whole job of this screen. -->
      <div style="display:flex;gap:3px;margin-top:6px">
        ${weekDays.map((d) => `<a href="/app/owner/${id}/suite/costs?date=${d.iso}&meal=${esc(meal)}"
          style="flex:1 1 0;text-decoration:none;text-align:center;border:${d.today && d.iso !== date ? `1.5px solid ${ORANGE}` : `1px solid ${d.iso === date ? "#191512" : "#e0d6cc"}`};
          background:${d.iso === date ? "#191512" : "#fff"};color:${d.iso === date ? "#fff" : "#4a443f"};
          border-radius:10px;padding:6px 2px;line-height:1.15">
          <span style="display:block;font-size:9.5px;opacity:.75">${d.dow}</span>
          <span style="display:block;font-size:13px;font-weight:700">${d.day}</span>
          <span style="display:block;height:5px;margin-top:2px">${planDates.includes(d.iso) ? `<span style="display:inline-block;width:5px;height:5px;border-radius:99px;background:${d.iso === date ? "#fff" : ORANGE}"></span>` : ""}</span>
        </a>`).join("")}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px">
        ${(extras.meals || MEALS).map((mm) => `<a href="/app/owner/${id}/suite/costs?date=${esc(date)}&meal=${esc(mm)}" style="flex:1 1 0;text-decoration:none;border:1px solid #e0d6cc;background:${mm === meal ? "#191512" : "#fff"};color:${mm === meal ? "#fff" : "#4a443f"};border-radius:99px;padding:5px 4px 7px;font-size:12.5px;font-weight:700;text-align:center">
          <span style="display:block;height:6px;line-height:6px">${planMeals.includes(mm) ? `<span style="display:inline-block;width:5px;height:5px;border-radius:99px;background:${mm === meal ? "#fff" : ORANGE}"></span>` : ""}</span>
          ${esc(mm)}</a>`).join("")}
      </div>
    </div>

    ${!extras.hasPlan ? `
      <div class="card" style="margin-top:12px;padding:12px 14px;background:#fdf0ec;border-color:#f3cfc2;font-size:12.5px;color:#946200">
        Nothing planned for ${esc(meal)} on ${esc(date)}.
        <a href="/app/owner/${id}/suite/menu" style="color:${ORANGE};font-weight:700">Plan the menu</a> and its cost lands here.
      </div>` : setCards + dishCards}

    ${avg != null ? `
      <div class="card" style="margin-top:12px;padding:10px 14px;background:${avg >= 30 ? "#e8f6ec" : "#fdf0ec"};border-color:${avg >= 30 ? "#bfe5c8" : "#f3cfc2"}">
        <span style="color:${avg >= 30 ? "#1d7a34" : "#946200"};font-size:12.5px;font-weight:700">
          ${avg >= 30 ? "✅" : "⚠️"} Average margin ${avg}% · target ≥ 30% before posting</span>
        <div class="sub" style="font-size:10.5px;margin-top:4px;line-height:1.4">
          Costed from the recipe book and today's ingredient prices — ${costed.length} of ${allDishes.length} dishes.
        </div>
      </div>` : (extras.hasPlan ? `
      <div class="card" style="margin-top:12px;padding:10px 14px;font-size:12px" class="sub">
        Nothing here has both a recipe and a price yet.
      </div>` : "")}

    <script>
    document.getElementById('costDate').addEventListener('change', function(){
      if (this.value) location.href = '/app/owner/${id}/suite/costs?date=' + this.value + '&meal=${esc(meal)}';
    });

    /* Show a dish's ingredients so their prices can be corrected. */
    document.querySelectorAll('.ingToggle').forEach(function(b){
      b.addEventListener('click', function(){
        var box = document.getElementById('ing-' + b.dataset.id);
        if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
      });
    });

    /* Portions cooked today. Saved on the plan for this date and meal, so
       tomorrow starts clean. The total beside the box is worked out here —
       portions don't change any set's per-serving figure, so tapping + never
       reloads the page out from under you. */
    var saveTimers = {};
    function paintTotal(inp){
      var out = document.getElementById('tot-' + inp.dataset.id);
      if (!out) return;
      var cost = Number(inp.dataset.cost), n = Number(inp.value) || 0;
      out.textContent = (!cost || !n) ? '' : 'LKR ' + (cost * n).toLocaleString();
    }
    function savePortions(inp){
      paintTotal(inp);
      clearTimeout(saveTimers[inp.dataset.id]);
      saveTimers[inp.dataset.id] = setTimeout(function(){
        fetch('/app/owner/${id}/costs/portions.json', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({date:'${esc(date)}', meal:'${esc(meal)}', dishId: inp.dataset.id, portions: inp.value}),
        }).catch(function(){ /* the number is still on screen */ });
      }, 600);
    }
    document.querySelectorAll('.portionBox').forEach(function(inp){
      inp.addEventListener('change', function(){ savePortions(inp); });
      inp.addEventListener('input', function(){ paintTotal(inp); });
    });
    /* One tap sets every dish on the card — the whole set cooked in the same
       number — and each dish saves itself as if it had been typed. */
    document.querySelectorAll('.bulkBtn').forEach(function(b){
      b.addEventListener('click', function(){
        var card = b.closest('.card');
        if (!card) return;
        card.querySelectorAll('.portionBox').forEach(function(inp){
          inp.value = b.dataset.n === '0' ? '' : b.dataset.n;
          savePortions(inp);
        });
      });
    });
    document.querySelectorAll('.stepBtn').forEach(function(b){
      b.addEventListener('click', function(){
        var inp = document.querySelector('.portionBox[data-id="' + b.dataset.id + '"]');
        if (!inp) return;
        inp.value = Math.max(0, Math.min(9999, (Number(inp.value) || 0) + Number(b.dataset.step)));
        savePortions(inp);
      });
    });

    /* A dish the recipe book does not cover — the owner says what it costs. */
    document.querySelectorAll('.costBox').forEach(function(inp){
      inp.addEventListener('change', function(){
        fetch('/app/owner/${id}/costs/dish-cost.json', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({dishId: inp.dataset.id, lkr: inp.value}),
        }).then(function(r){ return r.json(); }).then(function(){ location.reload(); })
          .catch(function(){});
      });
    });

    /* An ingredient price this shop pays. Blank clears it back to ours. */
    document.querySelectorAll('.rateBox').forEach(function(inp){
      inp.addEventListener('change', function(){
        fetch('/app/owner/${id}/costs/price.json', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({key: inp.dataset.key, unit: inp.dataset.per, lkr: inp.value}),
        }).then(function(r){ return r.json(); }).then(function(){ location.reload(); })
          .catch(function(){});
      });
    });
    </script>`);
}

function stockPage(shop, extras = {}) {
  const id = String(shop._id);
  const cats = extras.ingredientCats || {};      // { Vegi:{label,labelSi,items:[{name,si,unit}]}, ... }
  const stock = extras.stock || [];              // [{ _id, name, category, qty, unit }]
  const units = extras.units || ["kg", "L", "packs", "pcs"];
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const msg = extras.msg || "";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const catKeys = Object.keys(cats);
  const initials = (n) => n.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "··";

  // Tabs: one per category (Vegi/Meat/Dry/Spices) plus All. The label is
  // "<stocked>/<available>" — how many items the shop has in stock vs how
  // many ingredient types the picker offers for that category. Tapping a
  // category tab BOTH filters the stock list AND switches the add-form's
  // ingredient dropdown to that category — one control, not two.
  const countFor = (cat) => stock.filter((s) => s.category === cat).length;
  const availableFor = (cat) => (cats[cat]?.items?.length ?? 0);
  const totalAvailable = catKeys.reduce((n, c) => n + availableFor(c), 0);
  const tabs = catKeys.map((c, i) => `<button type="button" class="chip${i === 0 ? " on" : ""}" data-cat="${esc(c)}" onclick="stockTab('${esc(c)}',this)">${esc(c)} · ${countFor(c)}<span class="sub" style="font-weight:500">/${availableFor(c)}</span></button>`)
    .concat([`<button type="button" class="chip" data-cat="All" onclick="stockTab('All',this)">All · ${stock.length}<span class="sub" style="font-weight:500">/${totalAvailable}</span></button>`])
    .join("");

  // Client-side data: category → its ingredient options (name+unit).
  const catData = JSON.stringify(Object.fromEntries(
    catKeys.map((c) => [c, cats[c].items.map((it) => ({ name: it.name, si: it.si, unit: it.unit }))])
  ));

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  };
  const photoMap = extras.ingredientPhotos instanceof Map ? extras.ingredientPhotos : new Map();
  const thumb = (name) => {
    const url = photoMap.get(ingredientSlug(name));
    return url
      ? `<span style="width:36px;height:36px;border-radius:10px;background:#f0e7de url('${esc(url)}') center/cover;flex:0 0 auto"></span>`
      : `<span style="width:36px;height:36px;border-radius:10px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11.5px;flex:0 0 auto">${esc(initials(name))}</span>`;
  };
  /* One line of controls, always open, saving themselves.
     It used to be a card of boxes: a pencil to reveal an editor, six bordered
     inputs in a grid, a tick to commit, and two more boxes under that. A cook
     adjusting a kilo of onions should not have to open a form and confirm. */
  const stockRow = (s) => {
    const price = Number(s.price) || 0;
    const qty = Number(s.qty) || 0;
    const lineTotal = price > 0 ? Math.round(price * qty) : 0;
    const sid = String(s._id);
    const low = s.minQty != null && s.minQty !== "" && qty <= Number(s.minQty);
    // Borderless until touched: the value is the thing to read, not its box.
    const bare = "border:0;background:transparent;padding:2px 3px;margin:0;font-size:12.5px;border-radius:6px";
    return `
    <div class="stockrow" data-id="${sid}" data-cat="${esc(s.category)}"
      style="display:flex;gap:9px;align-items:flex-start;padding:10px 2px;border-bottom:1px solid #f2ece6">
      ${thumb(s.name)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:6px;align-items:baseline">
          <strong style="flex:1;min-width:0;font-size:13px">${esc(s.name)}</strong>
          ${low ? `<span style="flex:0 0 auto;font-size:9px;font-weight:800;color:#b3261e;letter-spacing:.03em">LOW</span>` : ""}
        </div>
        <div class="sub" style="font-size:10px">${esc(s.category)}${s.si ? ` · ${esc(s.si)}` : ""}${s.addedAt ? ` · ${fmtDate(s.addedAt)}` : ""}</div>

        <div style="display:flex;gap:5px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <button type="button" class="stStep" data-id="${sid}" data-step="-1"
            style="flex:0 0 auto;width:30px;height:30px;border:1px solid #e0d6cc;background:#fff;border-radius:9px;font-size:16px;font-weight:700;line-height:1;color:#b3261e;cursor:pointer;padding:0">−</button>
          <input type="number" class="stQty" data-id="${sid}" min="0" step="0.1" value="${esc(String(s.qty ?? ""))}"
            style="${bare};width:46px;text-align:center;font-weight:700;font-size:14px;background:#faf7f4">
          <button type="button" class="stStep" data-id="${sid}" data-step="1"
            style="flex:0 0 auto;width:30px;height:30px;border:0;background:${ORANGE};color:#fff;border-radius:9px;font-size:16px;font-weight:700;line-height:1;cursor:pointer;padding:0">+</button>
          <select class="stUnit" data-id="${sid}" style="${bare};width:52px;font-size:11px;color:#6b625a">
            ${units.map((u) => `<option value="${esc(u)}"${s.unit === u ? " selected" : ""}>${esc(u)}</option>`).join("")}
          </select>
          <span class="sub" style="font-size:10px">${esc(cur.symbol)}</span>
          <input type="number" class="stPrice" data-id="${sid}" min="0" step="0.01" value="${esc(String(s.price || ""))}" placeholder="price"
            style="${bare};width:58px;text-align:right;background:#faf7f4">
          <span class="stTotal" id="sttot-${sid}" style="flex:1;min-width:0;text-align:right;font-size:11.5px;font-weight:700;color:${ORANGE}">${lineTotal ? esc(cur.symbol) + " " + lineTotal.toLocaleString() : ""}</span>
        </div>

        <div style="display:flex;gap:9px;align-items:center;margin-top:5px">
          <span class="sub" style="font-size:9.5px">min</span>
          <input type="number" class="stMin" data-id="${sid}" min="0" step="0.1" value="${esc(String(s.minQty ?? ""))}" placeholder="—"
            style="${bare};width:40px;text-align:center;font-size:11px;color:#b3261e">
          <span class="sub" style="font-size:9.5px">max</span>
          <input type="number" class="stMax" data-id="${sid}" min="0" step="0.1" value="${esc(String(s.maxQty ?? ""))}" placeholder="—"
            style="${bare};width:40px;text-align:center;font-size:11px;color:#1d7a34">
          <span class="stSaved" id="stsv-${sid}" class="sub" style="flex:1;font-size:9.5px;color:#1d7a34;opacity:0;transition:opacity .2s">saved</span>
          <form method="POST" action="/app/owner/${id}/stock/${sid}/buy" style="margin:0;flex:0 0 auto">
            <button style="border:0;background:none;font-size:14px;cursor:pointer;padding:2px;${s.buyNext ? "" : "opacity:.4"}" title="${s.buyNext ? "On the purchase plan" : "Send to purchase plan"}">🛒</button>
          </form>
          <form method="POST" action="/app/owner/${id}/stock/${sid}/remove" class="armForm" style="margin:0;flex:0 0 auto">
            <button style="border:0;background:none;color:#b3261e;font-size:14px;cursor:pointer;padding:2px" title="Remove">✕</button>
          </form>
        </div>
      </div>
    </div>`;
  };

  const emptyState = `<div class="card" style="margin-top:12px;padding:14px;background:#fdf0ec;border-color:#f3cfc2;font-size:12.5px;color:#946200;text-align:center">
    Your kitchen store is empty. Pick a category above, choose the vegetables, meats, dry goods and spices you use for your menu, and set how much you buy — 35Ai keeps track from there.<br><span class="si" style="display:inline-block;margin-top:6px">ඔබේ ගබඩාව හිස්. ඉහළින් වර්ගයක් තෝරා, ඔබ භාවිත කරන ද්‍රව්‍ය එකතු කරන්න.</span></div>`;

  return page(shop, "stock", "Kitchen Stock", "කුස්සි ගබඩාව", `
    <div class="sub" style="font-size:11px;margin-top:8px;line-height:1.45">Build your store once — pick the items you cook with, set what you buy, and 35Ai tracks it against your menu.<br><span class="si" style="font-size:12.4px">ඔබ භාවිත කරන ද්‍රව්‍ය එකතු කර ප්‍රමාණය දෙන්න.</span></div>

    <div class="chips" style="display:flex;gap:8px;margin-top:12px;overflow-x:auto;-webkit-overflow-scrolling:touch">${tabs}</div>

    <!-- Add an ingredient — one compact line, dropdown follows the tab -->
    <div class="card" style="margin-top:12px;padding:10px 11px;background:#fdf7ee;border-color:#efe0c8">
      <div class="row" style="gap:5px;align-items:center">
        <select id="addName" onchange="syncUnit()" title="Ingredient" style="flex:2.4;min-width:0;height:40px;padding:0 6px;border-radius:9px;border:1px solid #e3d6c2;background:#fff;font-size:12.5px;text-align:center;text-align-last:center"></select>
        <input type="number" id="addQty" min="0" step="0.1" placeholder="Qty" title="How much to buy" style="flex:1;min-width:0;height:40px;padding:0 6px;font-size:13px;font-weight:700;text-align:center" oninput="calcLine()">
        <select id="addUnit" title="Unit" style="flex:0 0 auto;width:52px;height:40px;padding:0 2px;border-radius:9px;border:1px solid #e3d6c2;background:#fff;font-size:12px;text-align:center;text-align-last:center">
          ${units.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join("")}
        </select>
        <input type="number" id="addPrice" min="0" step="0.01" placeholder="${esc(cur.symbol)}" title="Price per unit in ${esc(cur.code)} (optional)" style="flex:1.1;min-width:0;height:40px;padding:0 6px;font-size:13px;text-align:center" oninput="calcLine()">
        <button type="button" class="btn" style="width:auto;height:40px;padding:0 14px;flex:0 0 auto;font-size:15px" onclick="submitStock()">＋</button>
      </div>
      <div id="addLineTotal" class="sub" style="font-size:11.5px;margin-top:7px;color:#1d7a34;display:none;text-align:center"></div>
    </div>
    <input type="hidden" id="addCat" value="${esc(catKeys[0] || "Vegi")}">
    <input type="hidden" id="addCatLabel" value="Vegi">

    <!-- Current stock -->
    <div class="row" style="justify-content:space-between;margin-top:18px"><strong style="font-size:14px">In your store <span class="si">ගබඩාවේ</span></strong><span class="sub" id="stockCount" style="font-size:12px">${stock.length} items</span></div>
    <div id="stockList">
      ${stock.length ? stock.map(stockRow).join("") : emptyState}
    </div>

    <form method="POST" action="/app/owner/${id}/stock/add" id="stockAddForm" style="display:none">
      <input type="hidden" name="name" id="fName">
      <input type="hidden" name="category" id="fCat">
      <input type="hidden" name="qty" id="fQty">
      <input type="hidden" name="unit" id="fUnit">
      <input type="hidden" name="si" id="fSi">
      <input type="hidden" name="price" id="fPrice">
    </form>

    <script>
    /* Every control on a stock row saves itself, 600ms after you stop. No
       pencil to open an editor, no tick to commit — the row is the form. */
    var stTimers = {};
    function stSave(sid){
      var row = document.querySelector('.stockrow[data-id="' + sid + '"]');
      if (!row) return;
      var qty = row.querySelector('.stQty').value;
      var price = row.querySelector('.stPrice').value;
      var unit = row.querySelector('.stUnit').value;
      var body = new URLSearchParams({
        qty: qty, unit: unit, price: price,
        minQty: row.querySelector('.stMin').value,
        maxQty: row.querySelector('.stMax').value,
      });
      // The running total is ours to keep current; the server is only storage.
      var tot = document.getElementById('sttot-' + sid);
      if (tot) {
        var n = (Number(qty) || 0) * (Number(price) || 0);
        tot.textContent = n > 0 ? '${esc(cur.symbol)} ' + Math.round(n).toLocaleString() : '';
      }
      clearTimeout(stTimers[sid]);
      stTimers[sid] = setTimeout(function(){
        fetch('/app/owner/${id}/stock/' + sid + '/edit', {
          method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: body,
        }).then(function(){
          var f = document.getElementById('stsv-' + sid);
          if (!f) return;
          f.style.opacity = '1';
          setTimeout(function(){ f.style.opacity = '0'; }, 1400);
        }).catch(function(){ /* the number is still on screen */ });
      }, 600);
    }
    document.querySelectorAll('.stQty, .stPrice, .stMin, .stMax, .stUnit').forEach(function(el){
      el.addEventListener('change', function(){ stSave(el.dataset.id); });
      el.addEventListener('input', function(){ stSave(el.dataset.id); });
    });
    document.querySelectorAll('.stStep').forEach(function(b){
      b.addEventListener('click', function(){
        var row = document.querySelector('.stockrow[data-id="' + b.dataset.id + '"]');
        var inp = row && row.querySelector('.stQty');
        if (!inp) return;
        inp.value = Math.max(0, Math.round(((Number(inp.value) || 0) + Number(b.dataset.step)) * 10) / 10);
        stSave(b.dataset.id);
      });
    });

    var CAT_DATA = ${catData};
    function stockTab(cat, btn){
      document.querySelectorAll('.chips .chip').forEach(function(c){ c.classList.remove('on'); });
      btn.classList.add('on');
      // Filter the stored-items list.
      document.querySelectorAll('.stockrow').forEach(function(r){
        r.style.display = (cat==='All' || r.dataset.cat===cat) ? '' : 'none';
      });
      // Switch the add-form to this category (skip for the All tab —
      // keep whatever category was last active for adding).
      if(cat!=='All'){
        document.getElementById('addCat').value = cat;
        document.getElementById('addCatLabel').textContent = cat;
        fillIngredients();
      }
    }
    function fillIngredients(){
      var cat = document.getElementById('addCat').value;
      var sel = document.getElementById('addName');
      var opts = (CAT_DATA[cat]||[]);
      sel.innerHTML = opts.map(function(o){ return '<option value="'+o.name.replace(/"/g,'&quot;')+'" data-unit="'+o.unit+'" data-si="'+(o.si||'').replace(/"/g,'&quot;')+'">'+o.name+(o.si?' · '+o.si:'')+'</option>'; }).join('');
      syncUnit();
    }
    function syncUnit(){
      var sel = document.getElementById('addName');
      var opt = sel.options[sel.selectedIndex];
      if(opt){ document.getElementById('addUnit').value = opt.dataset.unit || 'kg'; }
    }
    function calcLine(){
      var qty = Number(document.getElementById('addQty').value)||0;
      var price = Number(document.getElementById('addPrice').value)||0;
      var el = document.getElementById('addLineTotal');
      if(qty>0 && price>0){
        el.style.display='';
        el.innerHTML = 'Total value: <strong style="color:#d9542b">${esc(cur.symbol)} '+Math.round(qty*price).toLocaleString()+'</strong> ('+price+' × '+qty+')';
      } else { el.style.display='none'; }
    }
    function submitStock(){
      var sel = document.getElementById('addName');
      var opt = sel.options[sel.selectedIndex];
      var qty = document.getElementById('addQty').value;
      if(!opt || !qty || Number(qty)<=0){ alert('Pick an ingredient and enter how much to buy.'); return; }
      document.getElementById('fName').value = opt.value;
      document.getElementById('fCat').value = document.getElementById('addCat').value;
      document.getElementById('fQty').value = qty;
      document.getElementById('fUnit').value = document.getElementById('addUnit').value;
      document.getElementById('fSi').value = opt.dataset.si || '';
      document.getElementById('fPrice').value = document.getElementById('addPrice').value || '';
      document.getElementById('stockAddForm').submit();
    }
    fillIngredients();
    // Pencil icons open the inline edit form for each stock row.
    document.querySelectorAll('.editBtn').forEach(function(b){
      b.addEventListener('click', function(){
        var f = document.getElementById(b.dataset.target);
        if(!f) return;
        var open = f.style.display !== 'none';
        // Close other open edit forms so at most one is expanded.
        document.querySelectorAll('.editForm').forEach(function(x){ x.style.display='none'; });
        f.style.display = open ? 'none' : 'block';
        if(!open){ var q = f.querySelector('input[name=qty]'); if(q){ q.focus(); q.select(); } }
      });
    });
    // − / + quick-adjust: bump qty by 1 (or 0.1 for sub-unit items).
    function stepQty(row, delta){
      var q = row.querySelector('input[name=qty]');
      if(!q) return;
      var v = Number(q.value) || 0;
      var step = v < 5 ? 0.5 : 1;
      var next = Math.max(0, +(v + delta * step).toFixed(2));
      q.value = String(next);
    }
    document.querySelectorAll('.editForm .stepUp').forEach(function(b){
      b.addEventListener('click', function(){ stepQty(b.closest('.editForm'), 1); });
    });
    document.querySelectorAll('.editForm .stepDown').forEach(function(b){
      b.addEventListener('click', function(){ stepQty(b.closest('.editForm'), -1); });
    });
    </script>`);
}

function purchasingPage(shop, extras = {}) {
  const id = String(shop._id);
  const runningLow = extras.runningLow || [];
  const suppliers = extras.suppliers || [];
  const itemsBySupplier = extras.itemsBySupplier || {};
  const billsBySupplier = extras.billsBySupplier || {};
  const selectedSupplierId = extras.selectedSupplierId || "";
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const escP = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => String(n || "").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "··";
  // Deterministic hue per supplier — assigned by position in the sorted
  // list using the golden angle (137.5°) so adjacent suppliers get
  // maximally distinct colors. Same color links the supplier card on
  // the left to its items panel on the right.
  const supplierHues = new Map();
  suppliers.forEach((s, i) => {
    supplierHues.set(String(s._id), Math.round((i * 137.5 + 20) % 360));
  });
  const supHue = (s) => supplierHues.get(String(s._id)) ?? 0;
  const supAccent = (s) => `hsl(${supHue(s)} 65% 52%)`;
  const supTint = (s) => `hsl(${supHue(s)} 70% 96%)`;
  // Each low-stock item becomes a form-button that queues itself into
  // Purchasing (same /stock/:id/buy toggle used from Kitchen Stock).
  const lowPill = (s) => `
    <form method="POST" action="/app/owner/${id}/stock/${String(s._id)}/buy" style="display:inline;margin:0" title="Send to Purchasing">
      <button class="pill" style="font-size:11px;margin-left:6px;background:${s.buyNext ? "#d9542b" : "#fff"};color:${s.buyNext ? "#fff" : "#946200"};border:1px solid ${s.buyNext ? "#d9542b" : "#efdba8"};cursor:pointer">${escP(s.name)} · ${escP(String(s.qty || 0))} ${escP(s.unit || "")}${s.buyNext ? " ✓" : ""}</button>
    </form>`;
  const runningLowBlock = runningLow.length ? `
    <div class="card" style="margin-top:12px;padding:9px 13px;background:#fdf3d7;border-color:#efdba8">
      <span style="font-size:10.5px;font-weight:800;color:#946200">RUNNING LOW · ${runningLow.length}</span>
      ${runningLow.map(lowPill).join("")}
    </div>` : `
    <div class="card" style="margin-top:12px;padding:11px 13px;background:#e8f6ec;border-color:#bfe5c8">
      <span style="font-size:11.5px;font-weight:700;color:#1d7a34">✓ Store is well stocked — nothing is running low right now.</span>
    </div>`;
  // Whole card is a clickable <div> (not <a>, because it contains a
  // nested map <a> and a remove <form> — nested anchors are invalid HTML
  // and cause the browser to auto-close the outer <a>, breaking layout).
  // Tapping toggles ?sup=<id> to reveal the items panel underneath.
  const supplierCard = (s) => {
    const sid = String(s._id);
    const on = selectedSupplierId === sid;
    const count = (itemsBySupplier[sid] || []).length;
    const href = on ? "?native=1" : `?sup=${sid}&native=1`;
    const accent = supAccent(s);
    const billCount = (billsBySupplier[sid] || 0);
    return `
    <div class="card supCard" data-href="${href}" role="button" tabindex="0" style="cursor:pointer;margin:0;padding:10px 11px 10px 13px;min-width:0;border-left:4px solid ${accent};${on ? "background:#191512;border-color:#191512;border-left-color:" + accent + ";color:#fff" : "background:" + supTint(s)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <span style="display:inline-flex;width:28px;height:28px;border-radius:8px;background:${on ? "#2e2a26" : "#f0e7de"};align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:${on ? "#fff" : "#1a1a1a"};flex:0 0 auto">${escP(initials(s.name))}</span>
        <div class="row" style="gap:6px;flex:0 0 auto;align-items:center">
          ${count > 0 ? `<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:99px;background:${on ? "#ffb08f" : "#fdf3d7"};color:${on ? "#191512" : "#946200"}">${count}</span>` : ""}
          ${s.mapsUrl ? `<a href="${escP(s.mapsUrl)}" target="_blank" onclick="event.stopPropagation()" style="font-size:13px;text-decoration:none;opacity:${on ? ".9" : "1"}" title="Open in Maps">📍</a>` : ""}
          <!-- Tap it and the phone's camera opens on the back lens: point at
               the bill, shoot, and it files itself under this supplier.
               The capture attribute is what opens the camera rather than the
               photo library. -->
          <label onclick="event.stopPropagation()" style="cursor:pointer;position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9px;background:${on ? "#2e2a26" : "#fff"};border:1px solid ${on ? "#3a332f" : "#e3d6c2"};line-height:1" title="Photograph a bill for this supplier">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${on ? "#ffb08f" : accent}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 8.5h3.2l1.4-2.2h7.8l1.4 2.2h3.2a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 18.5v-8A1.5 1.5 0 0 1 3.5 8.5z"/>
              <circle cx="12" cy="14" r="3.4"/>
            </svg>
            ${billCount > 0 ? `<span style="position:absolute;top:-5px;right:-6px;background:${accent};color:#fff;font-size:9px;font-weight:800;border-radius:99px;padding:1px 5px;min-width:14px;text-align:center">${billCount}</span>` : ""}
            <input type="file" accept="image/*" capture="environment" class="billIn" data-supplier="${sid}" style="display:none" onclick="event.stopPropagation()">
          </label>
          <form method="POST" action="/app/owner/${id}/suppliers/${sid}/remove" class="armForm" onsubmit="event.stopPropagation()" style="margin:0" onclick="event.stopPropagation()">
            <button class="btn ghost" style="width:auto;padding:2px 6px;font-size:10px;color:${on ? "#ffb08f" : "#b3261e"};background:transparent;border:0" title="Remove">✕</button>
          </form>
        </div>
      </div>
      <strong style="display:block;font-size:12.5px;margin-top:6px;line-height:1.25">${escP(s.name)}</strong>
      ${(s.categories || []).length ? `<span style="font-size:10.5px;${on ? "opacity:.7" : "color:#6b6560"}">${(s.categories || []).map((c) => escP(c).toLowerCase()).join(" · ")}</span>` : ""}
    </div>`;
  };

  const selectedSupplier = selectedSupplierId ? suppliers.find((s) => String(s._id) === selectedSupplierId) : null;
  const selItems = selectedSupplier ? (itemsBySupplier[selectedSupplierId] || []) : [];
  const selTotal = selItems.reduce((n, it) => n + (Number(it.buyQty) || 0) * (Number(it.price) || 0), 0);
  const bills = extras.supplierBills || [];
  const fmtDate = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };
  const selectedItemsBlock = selectedSupplier ? (() => {
    const accent = supAccent(selectedSupplier);
    return `
    <div style="margin:0;padding:8px 10px;border:1px solid ${accent};border-radius:12px;background:${supTint(selectedSupplier)}">
      <div class="row" style="justify-content:space-between;align-items:baseline;gap:6px">
        <span class="sub" style="font-weight:700;font-size:10.5px;letter-spacing:.04em;color:${accent}">${selItems.length} ITEM${selItems.length === 1 ? "" : "S"}</span>
        <a href="?native=1" style="font-size:15px;color:#b3261e;text-decoration:none;line-height:1;flex:0 0 auto" title="close">✕</a>
      </div>
      ${selItems.length === 0
        ? `<div class="sub" style="font-size:11.5px;margin-top:6px;line-height:1.35">Pick this supplier on any 🛒 item in <strong>Purchasing</strong>.</div>`
        : `<div style="margin-top:4px">${selItems.map((it) => {
            const bq = Number(it.buyQty) || 0;
            const price = Number(it.price) || 0;
            const line = bq * price;
            return `<div class="row" style="gap:6px;padding:2px 0;font-size:11.5px;line-height:1.25">
              <span style="flex:1;min-width:0"><strong>${escP(it.name)}</strong> <span class="sub">${bq}${escP(it.unit || "")}${price > 0 ? ` @${price}` : ""}</span></span>
              ${line > 0 ? `<strong style="color:#d9542b;flex:0 0 auto">${line.toLocaleString()}</strong>` : ""}
            </div>`;
          }).join("")}
          ${selTotal > 0 ? `<div class="row" style="justify-content:space-between;margin-top:5px;padding-top:5px;border-top:1px solid ${accent}55;font-size:12px"><strong style="letter-spacing:.04em">TOTAL</strong><strong style="color:#d9542b">${escP(cur.symbol)} ${selTotal.toLocaleString()}</strong></div>` : ""}
        </div>`
      }
      ${bills.length ? `
      <!-- The bills themselves. A photograph you cannot see afterwards is a
           photograph you cannot check. -->
      <div style="margin-top:9px;padding-top:8px;border-top:1px solid ${accent}55">
        <div class="sub" style="font-weight:700;font-size:10px;letter-spacing:.04em;color:${accent}">${bills.length} BILL${bills.length === 1 ? "" : "S"}</div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding:6px 0 2px;-webkit-overflow-scrolling:touch">
          ${bills.map((b) => `
            <a href="${escP(b.image)}" target="_blank" style="flex:0 0 auto;text-decoration:none;display:block;width:64px">
              <img src="${escP(b.image)}" alt="bill" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid ${accent}55;display:block">
              <span class="sub" style="display:block;font-size:8.5px;text-align:center;margin-top:2px">${escP(fmtDate(b.uploadedAt))}</span>
            </a>`).join("")}
        </div>
        ${bills.some((b) => b.text) ? bills.filter((b) => b.text).map((b) => `
          <div style="margin-top:6px;background:#fff;border-radius:8px;padding:6px 8px">
            <div class="sub" style="font-size:8.5px;letter-spacing:.04em">READ FROM ${escP(fmtDate(b.uploadedAt))}${b.total ? ` · TOTAL ${escP(cur.symbol)} ${Number(b.total).toLocaleString()}` : ""}</div>
            <div style="font-size:10.5px;line-height:1.35;white-space:pre-wrap;margin-top:3px;max-height:120px;overflow:auto">${escP(b.text)}</div>
          </div>`).join("")
        : `<div class="sub" style="font-size:10px;line-height:1.35">Photographed, not yet read. Nothing here reads a bill's text yet — see the note below.</div>`}
      </div>` : ""}
    </div>`;
  })() : "";
  return page(shop, "purchasing", "Buying &amp; bills", "මිලදී ගැනීම් සහ බිල්", `
    ${runningLowBlock}
    <div class="row" style="gap:10px;align-items:center;margin-top:14px">
      <strong style="font-size:14px">Suppliers <span class="si">සැපයුම්කරුවන්</span></strong>
      <button type="button" id="addSupBtn" title="Add supplier" style="width:28px;height:28px;border-radius:99px;background:${ORANGE};color:#fff;border:0;font-size:17px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 6px #d9542b40;padding:0">+</button>
    </div>
    <form id="addSupForm" method="POST" action="/app/owner/${id}/suppliers/add" style="display:none;margin-top:10px" class="card" style2="padding:12px 13px">
      <div style="padding:12px 13px">
        <label style="margin-top:0">SUPPLIER NAME</label>
        <input type="text" name="name" required placeholder="e.g. New Manning Market" style="height:38px;font-size:13.5px">
        <label>GOOGLE MAPS LOCATION <span style="font-weight:400">— Maps → Share → Copy link</span></label>
        <input type="text" name="mapsUrl" placeholder="https://maps.app.goo.gl/…" style="height:38px;font-size:13px">
        <label>CATEGORIES <span style="font-weight:400">— pick what they supply</span></label>
        <div class="seg" style="gap:6px">
          ${["Vegi", "Meat", "Dry", "Spice"].map((c) => `<label><input type="checkbox" name="cat" value="${c}"><span class="opt">${c}</span></label>`).join("")}
        </div>
        <div class="row" style="gap:8px;margin-top:14px">
          <button type="button" id="cancelSup" class="btn ghost" style="flex:1">Cancel</button>
          <button type="submit" class="btn" style="flex:2">Save supplier</button>
        </div>
      </div>
    </form>
    ${suppliers.length
      ? `<div style="display:grid;grid-template-columns:42% 58%;gap:8px;margin-top:10px;align-items:start">
          <div class="supScroll" style="max-height:460px;overflow-y:scroll;padding:2px 8px 2px 0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:thin;scrollbar-color:#d9542b80 transparent">
            ${suppliers.map((s) => supplierCard(s)).join("")}
          </div>
          <div style="min-width:0;position:sticky;top:0">
            ${selectedSupplier ? selectedItemsBlock : `<div class="sub" style="margin:2px 6px;padding:0;text-align:center;font-size:11px;line-height:1.4;color:#946200">Tap a supplier on the left to see the items they'll deliver <span class="si" style="display:block;margin-top:3px">වම් පස</span></div>`}
          </div>
        </div>
        <style>
          .supScroll::-webkit-scrollbar { width: 6px; -webkit-appearance: none; }
          .supScroll::-webkit-scrollbar-thumb { background: #d9542b80; border-radius: 3px; }
          .supScroll::-webkit-scrollbar-track { background: transparent; }
        </style>`
      : `<div class="sub card" style="margin-top:10px;padding:11px 13px;font-size:12.5px">No suppliers yet — tap <strong style="color:${ORANGE}">+</strong> above to add one.</div>`
    }
    <script>
      (function(){
        var openBtn = document.getElementById('addSupBtn');
        var form = document.getElementById('addSupForm');
        var cancel = document.getElementById('cancelSup');
        if(!openBtn || !form) return;
        function open(){ form.style.display=''; openBtn.style.transform='rotate(45deg)'; var n=form.querySelector('input[name=name]'); if(n) n.focus(); }
        function close(){ form.style.display='none'; openBtn.style.transform=''; }
        openBtn.addEventListener('click', function(){ form.style.display==='none' ? open() : close(); });
        // Make supplier cards behave as toggle-links (they can't be actual <a>
        // because they wrap a nested map link and a remove form).
        document.querySelectorAll('.supCard').forEach(function(c){
          c.addEventListener('click', function(e){
            if(e.target.closest('a,form,button,label,input')) return;
            var href = c.getAttribute('data-href'); if(href) location.href = href;
          });
        });
        // 🧾 bill photo uploader per supplier. Picks camera or library on
        // iOS (native sheet), resizes client-side to 1200px JPEG, POSTs.
        document.querySelectorAll('.billIn').forEach(function(inp){
          inp.addEventListener('change', function(e){
            var f = e.target.files[0]; if(!f) return;
            var sid = inp.dataset.supplier;
            var img = new Image();
            img.onload = function(){
              var c = document.createElement('canvas');
              var sc = Math.min(1, 1200 / Math.max(img.width, img.height));
              c.width = Math.round(img.width * sc);
              c.height = Math.round(img.height * sc);
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              var data = c.toDataURL('image/jpeg', 0.7);
              var fd = new FormData();
              fd.append('image', data);
              fetch('/app/owner/${id}/suppliers/'+sid+'/bills', {method:'POST', body: new URLSearchParams(fd)})
                .then(function(r){ if(r.ok) location.reload(); else alert('Could not save that bill — try again'); })
                .catch(function(){ alert('Could not save that bill — check the connection'); });
              URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(f);
          });
        });
        openBtn.style.transition = 'transform .15s';
        if(cancel) cancel.addEventListener('click', close);
      })();
    </script>`);
}

function billHistoryPage(shop, extras = {}) {
  const id = String(shop._id);
  const suppliers = extras.suppliers || [];
  const billsBySupplier = extras.billsBySupplier || {};
  const selectedSupplierId = extras.selectedSupplierId || "";
  const selectedBills = extras.selectedBills || [];
  const year = extras.year || "";
  const month = extras.month || "";
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => String(n || "").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "··";
  // Same golden-angle hue assignment as Buying & bills so a supplier
  // keeps its color across the two pages.
  const supplierHues = new Map();
  suppliers.forEach((s, i) => supplierHues.set(String(s._id), Math.round((i * 137.5 + 20) % 360)));
  const supHue = (s) => supplierHues.get(String(s._id)) ?? 0;
  const supAccent = (s) => `hsl(${supHue(s)} 65% 52%)`;
  const supTint = (s) => `hsl(${supHue(s)} 70% 96%)`;

  const selectedSupplier = selectedSupplierId ? suppliers.find((s) => String(s._id) === selectedSupplierId) : null;
  const supBillTotal = selectedBills.reduce((n, b) => n + (Number(b.total) || 0), 0);
  const fmtDate = (d) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  };

  const supplierCard = (s) => {
    const sid = String(s._id);
    const on = selectedSupplierId === sid;
    const count = billsBySupplier[sid] || 0;
    // Preserve current year/month filter when clicking a supplier.
    const qs = new URLSearchParams();
    if (!on) qs.set("sup", sid);
    if (year) qs.set("y", year);
    if (month) qs.set("m", month);
    qs.set("native", "1");
    const href = "?" + qs.toString();
    const accent = supAccent(s);
    return `
    <div class="card supCard" data-href="${href}" role="button" tabindex="0" style="cursor:pointer;margin:0 0 6px;padding:10px 11px 10px 13px;min-width:0;border-left:4px solid ${accent};${on ? "background:#191512;border-color:#191512;border-left-color:" + accent + ";color:#fff" : "background:" + supTint(s)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <span style="display:inline-flex;width:28px;height:28px;border-radius:8px;background:${on ? "#2e2a26" : "#f0e7de"};align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:${on ? "#fff" : "#1a1a1a"};flex:0 0 auto">${escH(initials(s.name))}</span>
        ${count > 0 ? `<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:99px;background:${on ? "#ffb08f" : accent};color:${on ? "#191512" : "#fff"}">🧾 ${count}</span>` : `<span class="sub" style="font-size:10px;${on ? "opacity:.55" : ""}">no bills</span>`}
      </div>
      <strong style="display:block;font-size:12.5px;margin-top:6px;line-height:1.25">${escH(s.name)}</strong>
      ${(s.categories || []).length ? `<span style="font-size:10.5px;${on ? "opacity:.7" : "color:#6b6560"}">${(s.categories || []).map((c) => escH(c).toLowerCase()).join(" · ")}</span>` : ""}
    </div>`;
  };

  const years = [];
  const thisYear = 2026;
  for (let y = thisYear; y >= thisYear - 4; y--) years.push(y);
  const months = [
    ["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"],
    ["05", "May"], ["06", "Jun"], ["07", "Jul"], ["08", "Aug"],
    ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"],
  ];

  const filterQs = (yy, mm) => {
    const q = new URLSearchParams();
    if (selectedSupplierId) q.set("sup", selectedSupplierId);
    if (yy) q.set("y", yy);
    if (mm) q.set("m", mm);
    q.set("native", "1");
    return "?" + q.toString();
  };

  const rightPanel = selectedSupplier ? (() => {
    const accent = supAccent(selectedSupplier);
    return `
    <div style="margin:0;padding:8px 10px;border:1px solid ${accent};border-radius:12px;background:${supTint(selectedSupplier)}">
      <div class="row" style="justify-content:space-between;align-items:baseline;gap:6px">
        <span class="sub" style="font-weight:700;font-size:10.5px;letter-spacing:.04em;color:${accent}">${selectedBills.length} BILL${selectedBills.length === 1 ? "" : "S"}${year ? ` · ${year}${month ? "/" + month : ""}` : ""}</span>
        <a href="${filterQs(year, month).replace(/sup=[a-f0-9]+&?/, "").replace(/\?&/, "?")}" style="font-size:15px;color:#b3261e;text-decoration:none;line-height:1;flex:0 0 auto" title="close">✕</a>
      </div>
      ${selectedBills.length === 0
        ? `<div class="sub" style="font-size:11.5px;margin-top:6px;line-height:1.35">No bills uploaded yet${year ? " for this period" : ""}. Tap 🧾 on the supplier card in <strong>Buying &amp; bills</strong> to add one.</div>`
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
          ${selectedBills.map((b) => `
            <button type="button" class="billThumb" data-id="${String(b._id)}" data-src="${escH(b.image || "")}" data-date="${fmtDate(b.uploadedAt)}" style="display:block;text-align:left;padding:0;background:none;border:0;cursor:pointer;color:inherit">
              <div style="aspect-ratio:1;background:#fff url('${escH(b.image || "")}') center/cover;border:1px solid ${accent}55;border-radius:8px"></div>
              <div class="sub" style="font-size:10px;margin-top:3px;text-align:center">${fmtDate(b.uploadedAt)}</div>
            </button>`).join("")}
          </div>
          ${supBillTotal > 0 ? `<div class="row" style="justify-content:space-between;margin-top:8px;padding-top:6px;border-top:1px solid ${accent}55;font-size:12px"><strong>TOTAL SPEND</strong><strong style="color:#d9542b">${escH(cur.symbol)} ${supBillTotal.toLocaleString()}</strong></div>` : ""}
        </div>`
      }
    </div>`;
  })() : "";

  return page(shop, "history", "Bill History", "බිල් ඉතිහාසය", `
    <div class="sub" style="font-size:12px;margin-top:8px;line-height:1.5">Every 🧾 you snapped in <strong>Buying &amp; bills</strong> shows up here so you can see the history of any supplier at a glance — filter by month or year for a quick spend view.</div>
    <div class="row" style="gap:8px;align-items:center;margin-top:12px">
      <strong style="flex:1;min-width:0;font-size:14px">Suppliers <span class="si">සැපයුම්කරුවන්</span></strong>
      <select onchange="location.href=this.value" style="width:auto;height:32px;padding:0 6px;border-radius:8px;border:1px solid #e3d6c2;background:#fff;font-size:12px">
        <option value="${filterQs("", month)}"${year === "" ? " selected" : ""}>All years</option>
        ${years.map((y) => `<option value="${filterQs(String(y), month)}"${String(year) === String(y) ? " selected" : ""}>${y}</option>`).join("")}
      </select>
      <select onchange="location.href=this.value" style="width:auto;height:32px;padding:0 6px;border-radius:8px;border:1px solid #e3d6c2;background:#fff;font-size:12px">
        <option value="${filterQs(year, "")}"${month === "" ? " selected" : ""}>All months</option>
        ${months.map(([mv, ml]) => `<option value="${filterQs(year, mv)}"${month === mv ? " selected" : ""}>${ml}</option>`).join("")}
      </select>
    </div>
    ${suppliers.length ? `
      <div style="display:grid;grid-template-columns:42% 58%;gap:8px;margin-top:10px;align-items:start">
        <div class="supScroll" style="max-height:460px;overflow-y:scroll;padding:2px 8px 2px 0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:thin;scrollbar-color:#d9542b80 transparent">
          ${suppliers.map(supplierCard).join("")}
        </div>
        <div style="min-width:0;position:sticky;top:0">
          ${selectedSupplier ? rightPanel : `<div class="sub" style="margin:2px 6px;padding:0;text-align:center;font-size:11px;line-height:1.4;color:#946200">Tap a supplier on the left to see their bills <span class="si" style="display:block;margin-top:3px">වම් පස</span></div>`}
        </div>
      </div>
      <style>
        .supScroll::-webkit-scrollbar { width: 6px; -webkit-appearance: none; }
        .supScroll::-webkit-scrollbar-thumb { background: #d9542b80; border-radius: 3px; }
        .supScroll::-webkit-scrollbar-track { background: transparent; }
      </style>` : `<div class="sub card" style="margin-top:12px;padding:11px 13px;font-size:12.5px">No suppliers yet. Add some in <strong>Buying &amp; bills</strong> first.</div>`}
    <div id="billModal" style="display:none;position:fixed;inset:0;background:#191512e6;z-index:200;align-items:center;justify-content:center;padding:20px 20px calc(env(safe-area-inset-bottom, 0px) + 110px);flex-direction:column">
      <div style="position:absolute;top:14px;right:16px;font-size:22px;color:#fff;cursor:pointer;line-height:1;padding:6px" id="billModalClose">✕</div>
      <img id="billModalImg" src="" alt="Bill" style="max-width:100%;max-height:62vh;object-fit:contain;border-radius:8px;background:#fff">
      <div style="display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap;justify-content:center">
        <div id="billModalDate" style="color:#fff;font-size:13px;letter-spacing:.04em"></div>
        <button type="button" id="billModalDelete" style="background:#b3261e;color:#fff;border:0;border-radius:99px;padding:8px 16px;font-size:12.5px;font-weight:700;cursor:pointer">🗑 Delete bill</button>
      </div>
    </div>
    <script>
      document.querySelectorAll('.supCard').forEach(function(c){
        c.addEventListener('click', function(e){
          if(e.target.closest('a,form,button,label,input')) return;
          var href = c.getAttribute('data-href'); if(href) location.href = href;
        });
      });
      // Tap a bill thumbnail → open the full image in a modal overlay.
      (function(){
        var modal = document.getElementById('billModal');
        var img = document.getElementById('billModalImg');
        var dateEl = document.getElementById('billModalDate');
        var closeBtn = document.getElementById('billModalClose');
        var delBtn = document.getElementById('billModalDelete');
        if(!modal) return;
        var currentId = null;
        function open(id, src, date){
          currentId = id;
          img.src = src;
          dateEl.textContent = 'Bill of ' + date;
          modal.style.display = 'flex';
          // Reset delete button to default state whenever a new bill opens.
          if(typeof disarm === 'function') disarm();
          delBtn.disabled = false;
        }
        function close(){ modal.style.display = 'none'; img.src = ''; currentId = null; if(typeof disarm === 'function') disarm(); delBtn.disabled = false; }
        document.querySelectorAll('.billThumb').forEach(function(b){
          b.addEventListener('click', function(){ open(b.dataset.id, b.dataset.src, b.dataset.date); });
        });
        closeBtn.addEventListener('click', close);
        modal.addEventListener('click', function(e){ if(e.target === modal) close(); });
        document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
        // Two-tap confirm: first tap flips label to 'Tap again to confirm'
        // for 2.5 s, second tap within the window fires the delete. This
        // avoids native confirm() which WKWebView silently swallows unless
        // the app implements WKUIDelegate.
        var armed = false, armTimer = null;
        var delLabel = '🗑 Delete bill';
        function disarm(){ armed = false; delBtn.textContent = delLabel; delBtn.style.background = '#b3261e'; if(armTimer){ clearTimeout(armTimer); armTimer = null; } }
        delBtn.addEventListener('click', function(){
          if(!currentId) return;
          if(!armed){
            armed = true;
            delBtn.textContent = 'Tap again to confirm';
            delBtn.style.background = '#7a0f0f';
            armTimer = setTimeout(disarm, 2500);
            return;
          }
          disarm();
          delBtn.textContent = 'Deleting…';
          delBtn.disabled = true;
          fetch('/app/owner/${id}/bills/'+currentId+'/remove', {method:'POST'})
            .then(function(r){ if(r.ok) location.reload(); else { delBtn.disabled=false; delBtn.textContent=delLabel; } })
            .catch(function(){ delBtn.disabled=false; delBtn.textContent=delLabel; });
        });
      })();
    </script>`);
}

function planPage(shop, extras = {}) {
  const id = String(shop._id);
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const storeBuys = extras.storeBuys || [];
  const suppliers = extras.suppliers || [];
  const marketPrices = extras.marketPrices || [];
  const escS = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Build a case-insensitive lookup: item name → market entry.
  const marketByName = new Map();
  for (const m of marketPrices) marketByName.set(String(m.name).toLowerCase(), m);
  const marketFor = (b) => marketByName.get(String(b.name || "").toLowerCase());
  const buyTotal = storeBuys.reduce((n, b) => n + (Number(b.buyQty || b.qty) || 0) * (Number(b.price) || 0), 0);

  const emptyState = `<div class="card" style="margin-top:14px;padding:16px;text-align:center">
      <div style="font-size:30px">🛒</div>
      <strong style="display:block;margin-top:6px;font-size:14px">No items yet</strong>
      <p class="sub" style="font-size:12.5px;margin-top:6px;line-height:1.5">Open Kitchen Stock, then tap 🛒 on any item to add it to your Purchase Plan.<br><span class="si">කුස්සි ගබඩාවෙන් 🛒 බොත්තම එබීමෙන් අවශ්‍ය ද්‍රව්‍ය මෙතැනට එක් වේ.</span></p>
      <a class="btn" style="margin-top:12px;padding:11px" href="/app/owner/${id}/suite/stock">Open Kitchen Stock</a>
    </div>`;

  // The money figure belongs at the top, where it is read before deciding
  // anything — not buried under eleven supplier rows.
  const totalBanner = buyTotal > 0
    ? `<div class="card row" style="margin-top:12px;padding:11px 14px;background:#191512;border-color:#191512"><strong style="flex:1;font-size:12px;color:#fff;opacity:.8;letter-spacing:.04em">ESTIMATED TOTAL TO BUY · ${storeBuys.length} ITEMS</strong><strong style="font-size:15px;color:#ffb08f">${escS(cur.symbol)} ${buyTotal.toLocaleString()}</strong></div>`
    : "";

  const list = storeBuys.length ? `
    <div class="row" style="justify-content:space-between;margin-top:14px">
      <strong style="font-size:14px">From your kitchen store <span class="si">ඔබේ ගබඩාවෙන්</span></strong>
      <span class="sub" style="font-size:12px">${storeBuys.length} item${storeBuys.length === 1 ? "" : "s"}</span>
    </div>
    <div class="planList" style="max-height:520px;overflow-y:scroll;padding:2px 8px 2px 0;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;scrollbar-width:thin;scrollbar-color:#d9542b80 transparent">
    <style>
      .planList::-webkit-scrollbar { width: 6px; -webkit-appearance: none; }
      .planList::-webkit-scrollbar-thumb { background: #d9542b80; border-radius: 3px; }
      .planList::-webkit-scrollbar-track { background: transparent; }
    </style>
    ${storeBuys.map((b) => {
      const sid = String(b._id);
      const q = Number(b.qty) || 0;
      const p = Number(b.price) || 0;
      const bq = b.buyQty != null && b.buyQty !== "" ? Number(b.buyQty) : (Number(b.maxQty) ? Math.max(0, Number(b.maxQty) - q) : 0);
      const line = p > 0 && bq > 0 ? Math.round(bq * p) : 0;
      const supplierOptions = suppliers.map((sup) => `<option value="${String(sup._id)}"${String(b.buySupplierId || "") === String(sup._id) ? " selected" : ""}>${escS(sup.name)}</option>`).join("");
      const mkt = marketFor(b);
      // Compare paid vs market only when both sides use the same base unit.
      const canCompare = mkt && String(mkt.unit).toLowerCase() === String(b.unit || "").toLowerCase();
      const marketBadge = mkt ? (() => {
        if (canCompare && p > 0) {
          const diff = Math.round(((p - mkt.lkr) / mkt.lkr) * 100);
          const color = diff <= 0 ? "#1d7a34" : diff > 10 ? "#b3261e" : "#946200";
          const arrow = diff < 0 ? "▼" : diff > 0 ? "▲" : "=";
          return `<span style="color:${color};font-weight:700">${arrow} ${Math.abs(diff)}%</span> vs market ${escS(cur.symbol)} ${mkt.lkr}/${escS(mkt.unit)}`;
        }
        return `<span style="color:#946200;font-weight:700">market</span> ${escS(cur.symbol)} ${mkt.lkr}/${escS(mkt.unit)}`;
      })() : "";
      return `<div class="card" style="margin-top:6px;padding:9px 11px 10px 13px">
        <div class="row" style="gap:6px">
          <div style="flex:1;min-width:0">
            <strong style="font-size:13px">${escS(b.name)}</strong>
            <div class="sub" style="font-size:11px">${escS(b.category || "")}${b.qty ? ` · in store ${escS(String(b.qty))} ${escS(b.unit || "")}` : ""}${p > 0 ? ` · ${escS(cur.symbol)} ${p}/${escS(b.unit || "")}` : ""}${b.minQty != null ? ` · min ${escS(String(b.minQty))}` : ""}${b.maxQty != null ? ` · max ${escS(String(b.maxQty))}` : ""}</div>
            ${marketBadge ? `<div class="sub" style="font-size:11px;margin-top:2px">${marketBadge}</div>` : ""}
          </div>
          ${line > 0 ? `<span style="font-size:12.5px;font-weight:700;color:#d9542b;flex:0 0 auto">${escS(cur.symbol)} ${line.toLocaleString()}</span>` : ""}
          <form method="POST" action="/app/owner/${id}/stock/${sid}/buy" style="margin:0;flex:0 0 auto">
            <button class="btn ghost" style="width:auto;padding:5px 7px;font-size:11px;color:#b3261e" title="Remove from Purchasing">✕</button>
          </form>
        </div>
        <form method="POST" action="/app/owner/${id}/stock/${sid}/buy-plan" style="margin-top:8px;display:grid;grid-template-columns:1fr 78px 36px;gap:4px;align-items:center">
          <select name="buySupplierId" style="min-width:0;height:32px;padding:0 6px;border-radius:8px;border:1px solid #e3d6c2;background:#fff;font-size:11.5px">
            <option value="">Pick supplier…</option>
            ${supplierOptions}
          </select>
          <input type="number" name="buyQty" min="0" step="0.1" value="${escS(String(b.buyQty ?? ""))}" placeholder="Buy ${escS(b.unit || "qty")}" title="Planned buy quantity in ${escS(b.unit || "unit")}" style="min-width:0;height:32px;padding:0 6px;font-size:11.5px;text-align:center;font-weight:700;border-radius:8px;border:1px solid #e3d6c2">
          ${b.buySupplierId && Number(b.buyQty) > 0
            ? `<button type="submit" title="Saved — tap to update" style="width:100%;min-width:0;height:32px;padding:0;font-size:13px;border-radius:8px;background:#fff;color:#1d7a34;border:1px solid #bfe5c8;font-weight:700">✓</button>`
            : `<button type="submit" class="btn" title="Save" style="width:100%;min-width:0;height:32px;padding:0;font-size:13px;border-radius:8px">✓</button>`
          }
        </form>
      </div>`;
    }).join("")}
    </div>
    <div class="sub" style="font-size:11px;margin-top:10px">Add or remove items with the 🛒 button on each Kitchen Stock row.</div>` : emptyState;

  /* The same day, week and meal as the Portion Plan — what a kitchen buys is
     decided by what it is cooking, so both screens sit on the same date. */
  const pDate = extras.date || new Date().toISOString().slice(0, 10);
  const pMeal = extras.meal || "Lunch";
  const planMeals = extras.plannedMeals || [];
  const planDates = extras.plannedDates || [];
  const DOWP = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const shownP = new Date(pDate + "T00:00:00Z");
  const todayP = new Date().toISOString().slice(0, 10);
  const weekP = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(shownP);
    d.setUTCDate(shownP.getUTCDate() + i - 1);
    const iso = d.toISOString().slice(0, 10);
    return { iso, dow: DOWP[d.getUTCDay()], day: d.getUTCDate(), today: iso === todayP };
  });
  const dayBar = `
    <div style="margin-top:12px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center">
        <input type="date" id="planDate" value="${escS(pDate)}" style="margin:0;font-weight:700;font-size:13px">
        <span class="sub" style="font-size:11px">${planMeals.includes(pMeal) ? `${escS(pMeal)} plan` : "no plan yet"}</span>
      </div>
      <div style="display:flex;gap:3px;margin-top:6px">
        ${weekP.map((d) => `<a href="/app/owner/${id}/suite/plan?date=${d.iso}&meal=${escS(pMeal)}"
          style="flex:1 1 0;text-decoration:none;text-align:center;border:${d.today && d.iso !== pDate ? `1.5px solid ${ORANGE}` : `1px solid ${d.iso === pDate ? "#191512" : "#e0d6cc"}`};
          background:${d.iso === pDate ? "#191512" : "#fff"};color:${d.iso === pDate ? "#fff" : "#4a443f"};
          border-radius:10px;padding:6px 2px;line-height:1.15">
          <span style="display:block;font-size:9.5px;opacity:.75">${d.dow}</span>
          <span style="display:block;font-size:13px;font-weight:700">${d.day}</span>
          <span style="display:block;height:5px;margin-top:2px">${planDates.includes(d.iso) ? `<span style="display:inline-block;width:5px;height:5px;border-radius:99px;background:${d.iso === pDate ? "#fff" : ORANGE}"></span>` : ""}</span>
        </a>`).join("")}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px">
        ${(extras.meals || ["Breakfast", "Lunch", "Dinner"]).map((mm) => `<a href="/app/owner/${id}/suite/plan?date=${escS(pDate)}&meal=${escS(mm)}" style="flex:1 1 0;text-decoration:none;border:1px solid #e0d6cc;background:${mm === pMeal ? "#191512" : "#fff"};color:${mm === pMeal ? "#fff" : "#4a443f"};border-radius:99px;padding:5px 4px 7px;font-size:12.5px;font-weight:700;text-align:center">
          <span style="display:block;height:6px;line-height:6px">${planMeals.includes(mm) ? `<span style="display:inline-block;width:5px;height:5px;border-radius:99px;background:${mm === pMeal ? "#fff" : ORANGE}"></span>` : ""}</span>
          ${escS(mm)}</a>`).join("")}
      </div>
      <!-- Something to buy that no recipe knows about — gas, bags, a sack of
           rice for the week. Type it and it joins the day's list. -->
      <div style="display:flex;gap:5px;margin-top:7px;align-items:center">
        <input list="ingList" id="addName" placeholder="add an item…" style="margin:0;flex:1;min-width:0;padding:8px 10px;font-size:12.5px;border-radius:10px">
        <input type="number" inputmode="decimal" min="0" id="addQty" placeholder="qty" style="margin:0;width:64px;padding:8px 4px;font-size:12.5px;text-align:center;border-radius:10px">
        <select id="addUnit" style="margin:0;width:66px;padding:8px 4px;font-size:12px;border-radius:10px">
          <option value="kg">kg</option><option value="g">g</option>
          <option value="l">L</option><option value="ml">ml</option>
          <option value="piece">pcs</option>
        </select>
        <button type="button" id="addBuy" style="flex:0 0 auto;border:0;background:${ORANGE};color:#fff;border-radius:10px;width:38px;height:36px;font-size:19px;font-weight:700;line-height:1;cursor:pointer;padding:0">+</button>
      </div>
      <div class="sub" style="font-size:9.5px;margin-top:3px">Lands in <strong>Added by hand</strong> at the top of the list, for this day only.</div>
      <datalist id="ingList">${(extras.knownIngredients || []).map((n) => `<option value="${escS(n)}">`).join("")}</datalist>
    </div>`;

  /* What that day actually needs, read the way the menu is built: the sets in
     order, then Others for the salt and curry leaves every pot wants.

     Each line is need / have. "20 kg / 1 kg" means the day takes 20 and the
     store holds 1, so buy the difference — rounded up to how the thing is
     actually sold, because nobody sells 19 kg of rice. No stock record at all
     shows as / 0. */
  const needed = extras.needed || [];
  const nice = (n, base) => base === "piece" ? `${Math.round(n * 10) / 10}`
    : base === "ml" ? (n >= 1000 ? `${Math.round(n / 100) / 10} L` : `${Math.round(n)} ml`)
    : (n >= 1000 ? `${Math.round(n / 100) / 10} kg` : `${Math.round(n)} g`);

  const SET_ORDER = ["Rice set", "Meat Combo", "Side dishes", "Dessert"];
  const shelvesN = [];
  for (const n of needed) {
    let g = shelvesN.find((x) => x.name === n.set);
    if (!g) { g = { name: n.set, rows: [] }; shelvesN.push(g); }
    g.rows.push(n);
  }
  shelvesN.sort((a, b) => {
    // What you typed sits first; the shared odds and ends sit last.
    const rank = (x) => x === "Added by hand" ? -1
      : x === "Others" ? 98
      : (SET_ORDER.indexOf(x) < 0 ? 90 : SET_ORDER.indexOf(x));
    return rank(a.name) - rank(b.name);
  });

  const needLine = (n) => {
    const ok = n.short <= 0;
    return `<div style="padding:8px 0;border-bottom:1px solid #f4efe9">
      <div style="display:flex;gap:8px;align-items:baseline">
        <strong style="flex:1;min-width:0;font-size:12.5px">${escS(n.name)}</strong>
        <span style="flex:0 0 auto;font-size:13px;font-variant-numeric:tabular-nums">
          <strong style="color:${ORANGE}">${escS(nice(n.need, n.base))}</strong>
          <span class="sub"> / </span>
          <strong style="color:${ok ? "#1d7a34" : "#8a827b"}">${escS(nice(n.have, n.base))}</strong>
        </span>
        <!-- Skip it for today: already have it, or cooking it another way. -->
        <button type="button" class="skipBuy" data-key="${escS(n.key)}" title="skip this one"
          style="flex:0 0 auto;border:0;background:none;color:#b3261e;font-size:16px;font-weight:700;line-height:1;cursor:pointer;padding:0 2px">✕</button>
      </div>
      <div style="display:flex;gap:8px;align-items:baseline;margin-top:2px">
        <span class="sub" style="flex:1;min-width:0;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escS(n.dishes.slice(0, 3).join(", "))}${n.dishes.length > 3 ? ` +${n.dishes.length - 3}` : ""}</span>
        <span style="flex:0 0 auto;font-size:10.5px;font-weight:700;color:${ok ? "#1d7a34" : ORANGE}">
          ${ok ? "enough in store" : `buy ${n.buy.count} × ${escS(nice(n.buy.size, n.buy.base))}${n.buy.word ? " " + escS(n.buy.word) : ""}`}
        </span>
      </div>
    </div>`;
  };

  const toBuy = needed.filter((n) => n.short > 0).length;
  const needList = needed.length ? `
    <div class="row" style="justify-content:space-between;margin-top:14px">
      <strong style="font-size:14px">For ${extras.neededFor} portions <span class="si">අවශ්‍ය ද්‍රව්‍ය</span></strong>
      <span class="sub" style="font-size:11.5px">${toBuy} to buy · ${needed.length - toBuy} in store</span>
    </div>
    ${shelvesN.map((g) => `
      <div class="card" style="margin-top:9px;padding:10px 13px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <strong style="font-size:13px">${escS(g.name)}</strong>
          <span class="sub" style="font-size:10px">${g.rows.length} item${g.rows.length === 1 ? "" : "s"}</span>
        </div>
        <div style="margin-top:4px">${g.rows.map(needLine).join("")}</div>
      </div>`).join("")}
    <div class="sub" style="font-size:10.5px;margin-top:8px;line-height:1.4">Need / in store. Buy quantities are rounded to how the thing is sold. "To taste" items are not counted.</div>`
    : "";

  return page(shop, "plan", "Purchase Plan", "මිලදී ගැනීම්", `
    <!-- Header on one line. Three stacked blocks of explanation pushed the
         actual list below the fold on a phone. -->
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <a href="/app/owner/${id}/market-prices" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;text-decoration:none;border:1.5px solid ${ORANGE};color:${ORANGE};font-weight:700;border-radius:99px;padding:7px 12px;font-size:12px">📊 Market prices</a>
    </div>
    ${dayBar}
    ${needList}
    <script>
      document.getElementById('planDate').addEventListener('change', function(){
        if (this.value) location.href = '/app/owner/${id}/suite/plan?date=' + this.value + '&meal=${escS(pMeal)}';
      });

      /* Skip an ingredient for today. Kept on the day, not on the recipe —
         tomorrow's list is unaffected. */
      document.querySelectorAll('.skipBuy').forEach(function(b){
        b.addEventListener('click', function(){
          fetch('/app/owner/${id}/plan/skip.json', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({date:'${escS(pDate)}', meal:'${escS(pMeal)}', key: b.dataset.key}),
          }).then(function(){ location.reload(); }).catch(function(){});
        });
      });

      var addBtn = document.getElementById('addBuy');
      function addItem(){
        var n = document.getElementById('addName').value.trim();
        var q = document.getElementById('addQty').value;
        if (!n || !q) return;
        addBtn.disabled = true;
        fetch('/app/owner/${id}/plan/add.json', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({date:'${escS(pDate)}', meal:'${escS(pMeal)}', name:n, qty:q, unit:document.getElementById('addUnit').value}),
        }).then(function(){ location.reload(); }).catch(function(){ addBtn.disabled = false; });
      }
      addBtn.addEventListener('click', addItem);
      document.getElementById('addQty').addEventListener('keydown', function(e){ if (e.key === 'Enter') addItem(); });
    </script>`);
}

export function marketPricesPage(shop, extras = {}) {
  const id = String(shop._id);
  const items = extras.prices || [];
  const escM = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cats = ["All", "Vegi", "Meat", "Dry", "Spices"];
  const countIn = (c) => c === "All" ? items.length : items.filter((i) => i.category === c).length;
  const chips = cats.map((c, i) => `<button type="button" class="chip${i === 0 ? " on" : ""}" data-cat="${escM(c)}" onclick="mpTab('${escM(c)}',this)">${escM(c)} · ${countIn(c)}</button>`).join("");
  /* One row per item, one column per place we check, and ours at the end.
     A blank column means that shop did not stock it the week it was checked;
     our figure averages only the ones that answered. */
  const SRC_COLS = [["cb", "CB"], ["carg", "CARG"], ["arp", "ARIP"], ["uber", "UBER"]];
  const cell = (v) => v == null || !Number.isFinite(Number(v))
    ? `<span style="color:#cfc5bb">–</span>`
    : Number(v).toLocaleString();
  const GRID = "grid-template-columns:1fr repeat(4,30px) 46px;gap:4px";
  const row = (it) => `
    <div class="mpRow" data-cat="${escM(it.category)}" data-name="${escM(it.name.toLowerCase())}"
      style="display:grid;${GRID};padding:7px 2px;border-bottom:1px solid #f2ece6;font-size:11px;align-items:baseline">
      <div style="min-width:0">
        <strong style="font-size:12px">${escM(it.name)}</strong>
        <span class="sub" style="display:block;font-size:9.5px">per ${escM(it.unit)}${it.packs ? ` · ${escM(it.packs)}` : ""}</span>
      </div>
      ${SRC_COLS.map(([k]) => `<div style="text-align:right;font-variant-numeric:tabular-nums;color:#6b625a">${cell(it[k])}</div>`).join("")}
      <div style="text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:${ORANGE}">${cell(it.app ?? it.lkr)}</div>
    </div>`;

  const header = `
    <div style="display:grid;${GRID};padding:6px 2px;border-bottom:1.5px solid #e0d6cc;
      font-size:9px;font-weight:800;letter-spacing:.03em;color:#8a827b;text-transform:uppercase">
      <div>Item</div>
      ${SRC_COLS.map(([, label]) => `<div style="text-align:right">${label}</div>`).join("")}
      <div style="text-align:right;color:${ORANGE}">35APP</div>
    </div>`;

  return page(shop, "market", "Market Prices", "වෙළඳ මිල", `
    <div class="sub" style="font-size:11.5px;margin-top:8px;line-height:1.45">
      <strong>CB</strong> Central Bank · <strong>CARG</strong> Cargills · <strong>ARIP</strong> Arpico · <strong>UBER</strong> Keells on UberEats · <strong style="color:${ORANGE}">35APP</strong> ours, the average of those that had it.
      <br><span class="si" style="font-size:11.5px">සතියකට වරක් යාවත්කාලීන වේ.</span></div>
    <div class="chips" style="display:flex;gap:8px;margin-top:12px;overflow-x:auto;-webkit-overflow-scrolling:touch">${chips}</div>
    <input type="search" id="mpSearch" placeholder="Search — carrot, chicken, cardamom…" style="margin-top:10px;font-size:14px" oninput="mpFilter()">
    <div style="margin-top:10px">${header}</div>
    <div id="mpList">
      ${items.map(row).join("")}
    </div>
    <div class="sub" style="font-size:10.5px;margin-top:14px;text-align:center;color:#8a827b">
      Checked weekly${extras.checkedAt ? ` · last ${escM(String(extras.checkedAt).slice(0, 10))}` : " · seed figures, not yet checked"}. A dash means that shop did not have it.<br>
      Real market varies by day and season.
    </div>
    <script>
      var currentCat = 'All';
      function mpTab(cat, btn){
        currentCat = cat;
        document.querySelectorAll('.chips .chip').forEach(function(c){ c.classList.remove('on'); });
        btn.classList.add('on');
        mpFilter();
      }
      function mpFilter(){
        var q = (document.getElementById('mpSearch').value || '').trim().toLowerCase();
        document.querySelectorAll('.mpRow').forEach(function(r){
          var catOk = currentCat==='All' || r.dataset.cat===currentCat;
          var qOk = !q || (r.textContent.toLowerCase().indexOf(q) >= 0);
          r.style.display = (catOk && qOk) ? '' : 'none';
        });
      }
    </script>`, `/app/owner/${id}/suite/plan`);
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
  history: billHistoryPage, pos: posPage, kitchen: kitchenPage,
  salaries: salariesPage, staff: staffPage, utilities: utilitiesPage, health: healthPage,
};

/** Render a suite page, or null if the key is unknown. `extras` carries
 *  page-specific pre-loaded data (e.g. the shop's real dishes for the
 *  menu page). */
export function suitePage(shop, key, extras = {}) {
  const fn = PAGES[key];
  return fn ? fn(shop, extras) : null;
}
