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
  { key: "dishes", label: "Setup Daily Menu", emoji: "🍛", real: (id) => `/app/owner/${id}/dishes` },
  { key: "dashboard", label: "Dashboard", emoji: "📊" },
  { key: "menu", label: "Plan Menu", emoji: "🍱" },
  { key: "costs", label: "Cost sheet", emoji: "🧮" },
  { key: "stock", label: "Kitchen stock", emoji: "📦" },
  { key: "plan", label: "Purchasing", emoji: "🧾" },
  { key: "purchasing", label: "Buying & bills", emoji: "🛒" },
  { key: "salaries", label: "Staff salaries entries", emoji: "💬" },
  { key: "staff", label: "Staff Pay", emoji: "👥" },
  { key: "utilities", label: "Utilities Pay", emoji: "💡" },
  { key: "books", label: "Shop accounting", emoji: "📚" },
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
    <div class="row" style="gap:10px;align-items:center;margin-top:-26px;padding-right:80px">
      <a class="back" style="margin:0;flex:0 0 auto" href="/app/home">‹</a>
      <div style="flex:1;min-width:0">
        <div class="sub" style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;line-height:1.1">Shop Manager</div>
        <strong style="font-size:17px;line-height:1.15;display:block">${esc(shop.name)}</strong>
        <div class="sub" style="font-size:11px;line-height:1.15">Owner · ${esc(shop.owner || "")}</div>
      </div>
      <a href="/app/owner/${id}/qr" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:4px;text-decoration:none">
        ${hubCircle("▦", 46, true)}
        <span style="font-size:9.5px;font-weight:700;color:#1a1a1a">Table QR</span></a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px 8px;margin-top:14px">${tiles}</div>`,
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
      <h1 style="font-size:21px;flex:1;min-width:0">${title} <span class="si">${si}</span></h1></div>
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

function menuPage(shop, extras = {}) {
  const id = String(shop._id);
  const singles = extras.singles || [];
  const sets = extras.sets || [];
  const presetDishes = extras.presetDishes || [];
  const msg = extras.msg || "";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const dishRow = (d) => {
    const price = Number(d.price) || 0;
    return `<label class="card row" style="margin-top:8px;padding:10px 13px;cursor:pointer">
      <input type="checkbox" name="dishId" value="${String(d._id)}" data-price="${price}" style="width:18px;height:18px;accent-color:${ORANGE};flex:0 0 auto" onchange="recompute()">
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${esc(d.name)}</strong>${d.nameSi ? ` <span class="si">${esc(d.nameSi)}</span>` : ""}
      <div class="sub" style="font-size:11.5px">${esc(d.window || "All day")}${d.portions ? ` · ${d.portions} portions/day` : ""}</div></div>
      <span class="sub" style="font-size:12.5px;font-weight:700;flex:0 0 auto">$${price.toFixed(2)}</span></label>`;
  };

  const savedSet = (s) => `
    <div class="card row" style="margin-top:10px;padding:11px 13px">
      <div style="flex:1;min-width:0">
        <strong style="font-size:13.5px">${esc(s.name)}</strong>
        <div class="sub" style="font-size:11.5px">${(s.components || []).length} components · $${(Number(s.price) || 0).toFixed(2)} · ${s.portions || 10} portions/day</div>
      </div>
      <form method="POST" action="/app/owner/${id}/menu/set/${String(s._id)}/remove" onsubmit="return confirm('Remove this set meal?')" style="margin:0">
        <button class="btn ghost" style="width:auto;padding:7px 10px;font-size:11.5px;color:#b3261e">Remove</button>
      </form>
    </div>`;

  const singlesHtml = singles.length
    ? singles.map(dishRow).join("")
    : `<div class="card" style="margin-top:8px;padding:12px 14px;background:#fdf0ec;border-color:#f3cfc2;font-size:12.5px;color:#946200">You have no dishes yet — add a single dish first from <a href="/app/owner/${id}/dishes" style="text-decoration:underline;color:#946200"><strong>Setup Daily Menu</strong></a>, then come back to combine them into set meals.</div>`;

  const presetOptions = presetDishes.map((d) => `<option value="${esc(d)}">`).join("");

  return page(shop, "menu", "Plan Menu", "මෙනු සැකසුම", `
    ${msg ? `<div class="card" style="margin-top:10px;padding:10px 13px;background:#e8f6ec;border-color:#bfe5c8;font-size:12.5px;color:#1d7a34">${esc(msg)}</div>` : ""}

    <div class="seg" style="margin-top:12px">
      <label><input type="radio" name="mtab" value="single" checked onchange="showTab('single')"><span class="opt" style="font-size:12px;padding:6px 12px">Single dish · 35Ai</span></label>
      <label><input type="radio" name="mtab" value="set" onchange="showTab('set')"><span class="opt" style="font-size:12px;padding:6px 12px">Set menu</span></label>
      <label><input type="radio" name="mtab" disabled><span class="opt" style="font-size:12px;padding:6px 12px;opacity:.4">Combo (soon)</span></label>
      <label><input type="radio" name="mtab" disabled><span class="opt" style="font-size:12px;padding:6px 12px;opacity:.4">Events (soon)</span></label>
    </div>

    <!-- SINGLE DISH TAB (AI-assisted) -->
    <div id="tab-single">
      <div class="row" style="justify-content:space-between;margin-top:16px;align-items:center">
        <strong style="font-size:14px">Create a single dish with 35Ai recipe</strong>
        <button type="button" onclick="toggleHelp()" title="How this works" style="width:26px;height:26px;border-radius:99px;border:1.5px solid #d9542b;background:#fff;color:#d9542b;font-weight:800;font-size:13px;cursor:pointer;flex:0 0 auto;padding:0">i</button>
      </div>
      <div id="aiHelp" class="card" style="display:none;margin-top:10px;padding:11px 13px;background:#fff9ec;border-color:#efe0b8;font-size:12px">
        Type or pick a Sri Lankan dish. 35Ai suggests typical ingredients, per-person grams, and estimated LKR cost. Adjust before saving.<br><span class="si">ඔබේ කෑමේ නම දෙන්න — 35Ai කෑමට යන අමුද්‍රව්‍ය, ග්‍රෑම් ප්‍රමාණය, සහ ලංකා මිල පෙන්වයි.</span>
      </div>

      <label style="margin-top:14px">DISH NAME <span class="si">කෑමේ නම</span></label>
      <input type="text" id="aiDishName" placeholder="e.g. Chicken curry — or tap one below" maxlength="80">
      <button type="button" class="btn" style="margin-top:10px" onclick="fetchRecipe()">Suggest ingredients with 35Ai</button>
      <div id="aiStatus" class="sub" style="font-size:12px;margin-top:8px;text-align:center"></div>
      <div class="sub" style="font-size:11.5px;margin-top:10px;text-align:center;color:#946200">🍛 ${presetDishes.length}+ Sri Lankan dishes ready — just type any name <span class="si">ලංකා කෑම ${presetDishes.length}+ — ඕනෑම නමක් ලියන්න</span></div>

      <!-- Grayed-out mock preview: shows what the ingredient list looks like BEFORE the user picks a dish -->
      <div id="aiMock" style="margin-top:16px;opacity:.45;pointer-events:none">
        <div class="row" style="justify-content:space-between;margin-top:6px"><strong style="font-size:12.5px">Example — Chicken curry (preview)</strong><span class="sub" style="font-size:11px">what the result looks like</span></div>
        <div class="card row" style="margin-top:8px;padding:10px 13px"><div style="flex:1"><strong style="font-size:13px">chicken</strong><div class="sub" style="font-size:11.5px">150 g · diced</div></div><span style="font-size:12.5px;font-weight:700">LKR 330</span></div>
        <div class="card row" style="margin-top:8px;padding:10px 13px"><div style="flex:1"><strong style="font-size:13px">onion</strong><div class="sub" style="font-size:11.5px">30 g · sliced</div></div><span style="font-size:12.5px;font-weight:700">LKR 13.5</span></div>
        <div class="card row" style="margin-top:8px;padding:10px 13px"><div style="flex:1"><strong style="font-size:13px">coconut milk</strong><div class="sub" style="font-size:11.5px">100 ml</div></div><span style="font-size:12.5px;font-weight:700">LKR 30</span></div>
        <div class="card row" style="margin-top:8px;padding:10px 13px"><div style="flex:1"><strong style="font-size:13px">curry powder (roasted)</strong><div class="sub" style="font-size:11.5px">5 g</div></div><span style="font-size:12.5px;font-weight:700">LKR 17.5</span></div>
        <div class="card" style="margin-top:12px;padding:12px 14px"><div class="row" style="justify-content:space-between;font-size:13px"><span class="sub">Estimated ingredient cost / serving</span><strong style="color:${ORANGE}">LKR 480</strong></div></div>
      </div>

      <div id="aiRecipe" style="display:none;margin-top:14px">
        <div class="row" style="justify-content:space-between;margin-top:6px"><strong style="font-size:13.5px">Ingredients per serving</strong><span id="aiMatched" class="sub" style="font-size:11.5px"></span></div>
        <div id="aiIngredients"></div>
        <div class="card" style="margin-top:12px;padding:12px 14px">
          <div class="row" style="justify-content:space-between;font-size:13px"><span class="sub">Estimated ingredient cost / serving</span><strong id="aiCost" style="color:${ORANGE}">LKR 0</strong></div>
          <div class="sub" style="font-size:11px;margin-top:4px">Prices are typical LKR rates from a common ingredient library. Real costs vary — this is a planning aid.</div>
        </div>

        <form method="POST" action="/app/owner/${id}/dishes/ai-save" id="aiSaveForm" style="margin-top:14px">
          <input type="hidden" name="name" id="aiSaveName">
          <input type="hidden" name="recipe" id="aiSaveRecipe">
          <label>SELLING PRICE PER SERVING (USD)</label>
          <input type="number" name="price" step="0.01" min="0" required placeholder="e.g. 3.20" style="font-size:15px;font-weight:700">
          <label style="margin-top:8px">DAILY PORTIONS</label>
          <input type="number" name="portions" min="1" value="20" required>
          <label style="margin-top:8px">SERVING WINDOW</label>
          <input type="text" name="window" value="All day" maxlength="20">
          <button class="btn" style="margin-top:14px">Save dish with recipe</button>
        </form>
      </div>
    </div>

    <!-- SET MENU TAB -->
    <div id="tab-set" style="display:none">
      ${sets.length ? `<div class="row" style="justify-content:space-between;margin-top:16px"><strong style="font-size:13.5px">Your set meals</strong><span class="sub" style="font-size:12px">${sets.length} saved</span></div>${sets.map(savedSet).join("")}` : ""}

      <div class="row" style="justify-content:space-between;margin-top:20px"><strong style="font-size:14px">Create a new set meal</strong></div>

      <form method="POST" action="/app/owner/${id}/menu/set">
        <label style="margin-top:10px">SET MEAL NAME</label>
        <input type="text" name="name" placeholder="e.g. Rice & 3-Curry Lunch Set" maxlength="80">

        <div class="row" style="justify-content:space-between;margin-top:14px"><strong style="font-size:13.5px">Pick from your dishes</strong><span id="pickCount" style="color:${ORANGE};font-weight:700;font-size:12.5px">0 picked</span></div>
        ${singlesHtml}

        ${singles.length ? `
        <div class="card" style="margin-top:14px;padding:13px 14px">
          <div class="row" style="justify-content:space-between;font-size:13px"><span class="sub">Components sub-total</span><strong id="subtotal">$0.00</strong></div>
          <label style="margin-top:10px">SET MEAL PRICE (USD)</label>
          <input type="number" name="price" step="0.01" min="0" placeholder="3.72" style="font-size:15px;font-weight:700">
          <label style="margin-top:10px">DAILY PORTIONS</label>
          <input type="number" name="portions" min="1" value="10">
        </div>
        <button class="btn" style="margin-top:14px">Post set meal as one item</button>
        ` : ""}
      </form>
    </div>

    <script>
    function showTab(which) {
      document.getElementById('tab-single').style.display = which === 'single' ? '' : 'none';
      document.getElementById('tab-set').style.display = which === 'set' ? '' : 'none';
    }
    function toggleHelp() {
      const h = document.getElementById('aiHelp');
      h.style.display = h.style.display === 'none' ? '' : 'none';
    }
    function recompute() {
      const boxes = document.querySelectorAll('input[name="dishId"]');
      let picked = 0, total = 0;
      boxes.forEach(b => { if (b.checked) { picked++; total += Number(b.dataset.price) || 0; } });
      const pc = document.getElementById('pickCount');
      const st = document.getElementById('subtotal');
      if (pc) pc.textContent = picked + ' picked';
      if (st) st.textContent = '$' + total.toFixed(2);
    }
    async function fetchRecipe() {
      const dish = document.getElementById('aiDishName').value.trim();
      if (!dish) { document.getElementById('aiStatus').textContent = 'Type a dish name first.'; return; }
      const s = document.getElementById('aiStatus');
      s.textContent = '⏳ Asking 35Ai…';
      try {
        const body = new URLSearchParams({ dish }).toString();
        const r = await fetch('/app/owner/${id}/dishes/ai-recipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const j = await r.json();
        if (!j.ok) { s.textContent = '❌ ' + (j.error || '35Ai failed'); return; }
        s.textContent = j.cached ? '✓ (from cache)' : '✓ (fresh 35Ai)';
        renderRecipe(dish, j);
      } catch (e) { s.textContent = '❌ ' + e.message; }
    }
    function renderRecipe(dish, j) {
      const mock = document.getElementById('aiMock');
      if (mock) mock.style.display = 'none';
      document.getElementById('aiRecipe').style.display = '';
      document.getElementById('aiSaveName').value = dish;
      document.getElementById('aiSaveRecipe').value = JSON.stringify({ servings: j.servings, ingredients: j.ingredients, methodSummary: j.methodSummary });
      const list = document.getElementById('aiIngredients');
      list.innerHTML = j.ingredients.map((i, idx) => \`
        <div class="card row" style="margin-top:8px;padding:10px 13px">
          <div style="flex:1;min-width:0"><strong style="font-size:13px">\${i.name}</strong>\${i.notes ? \` <span class="sub" style="font-size:11px">· \${i.notes}</span>\` : ''}
          <div class="sub" style="font-size:11.5px">\${i.quantity} \${i.unit}\${i.matched ? '' : ' · <span style="color:#946200">no price match</span>'}</div></div>
          <span style="font-size:12.5px;font-weight:700;color:\${i.lkr != null ? '#1a1a1a' : '#c8c1b8'}">\${i.lkr != null ? 'LKR ' + i.lkr : '—'}</span>
        </div>\`).join('');
      document.getElementById('aiCost').textContent = 'LKR ' + j.totalLkr;
      const matchedCount = j.ingredients.filter(i => i.matched).length;
      document.getElementById('aiMatched').textContent = matchedCount + '/' + j.ingredients.length + ' priced';
    }
    </script>`);
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
  const stockRow = (s) => {
    const price = Number(s.price) || 0;
    const lineTotal = price > 0 ? Math.round(price * (Number(s.qty) || 0)) : 0;
    const sid = String(s._id);
    return `
    <div class="card stockrow" data-cat="${esc(s.category)}" style="margin-top:9px;padding:11px 13px">
      <div class="row">
        <span style="width:36px;height:36px;border-radius:10px;background:#f0e7de;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11.5px;flex:0 0 auto">${esc(initials(s.name))}</span>
        <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${esc(s.name)} <span class="sub" style="font-weight:600">${esc(String(s.qty))} ${esc(s.unit)}</span></strong>
        <div class="sub" style="font-size:11.5px">${esc(s.category)}${s.si ? ` · ${esc(s.si)}` : ""}${s.addedAt ? ` · ${fmtDate(s.addedAt)}` : ""}</div>
        ${price > 0 ? `<div class="sub" style="font-size:11.5px;color:#946200;margin-top:2px">${esc(cur.symbol)} ${price}/${esc(s.unit)} × ${esc(String(s.qty))} = <strong style="color:#d9542b">${esc(cur.symbol)} ${lineTotal.toLocaleString()}</strong></div>` : ""}</div>
        <button type="button" class="btn ghost editBtn" data-target="edit-${sid}" style="width:auto;padding:6px 9px;font-size:13px;color:#4a443f" title="Edit">✎</button>
        <form method="POST" action="/app/owner/${id}/stock/${sid}/buy" style="margin:0" title="${s.buyNext ? "Remove from Purchase Plan" : "Send to Purchase Plan"}">
          <button class="btn ghost" style="width:auto;padding:6px 9px;font-size:13px;${s.buyNext ? "background:#d9542b;border-color:#d9542b;color:#fff" : "color:#1d7a34"}">🛒</button>
        </form>
        <form method="POST" action="/app/owner/${id}/stock/${sid}/remove" onsubmit="return confirm('Remove ${esc(s.name)} from stock?')" style="margin:0">
          <button class="btn ghost" style="width:auto;padding:6px 10px;font-size:11px;color:#b3261e" title="Delete">✕</button>
        </form>
      </div>
      <form id="edit-${sid}" method="POST" action="/app/owner/${id}/stock/${sid}/edit" class="editForm" style="display:none;margin-top:9px;padding-top:9px;border-top:1px dashed #ece3da">
        <div style="display:grid;grid-template-columns:32px 1fr 32px 52px 1fr 38px;gap:3px;align-items:center">
          <button type="button" class="btn ghost stepDown" title="Issue / use stock" style="min-width:0;width:100%;height:34px;padding:0;font-size:16px;font-weight:800;color:#b3261e;border-radius:8px;border:1px solid #f1c1bb">−</button>
          <input type="number" name="qty" min="0" step="0.1" value="${esc(String(s.qty || ""))}" placeholder="Qty" style="min-width:0;height:34px;padding:0 2px;font-size:12px;text-align:center;font-weight:700;border-radius:8px;border:1px solid #e3d6c2">
          <button type="button" class="btn ghost stepUp" title="Add to stock" style="min-width:0;width:100%;height:34px;padding:0;font-size:16px;font-weight:800;color:#1d7a34;border-radius:8px;border:1px solid #bfe5c8">+</button>
          <select name="unit" style="min-width:0;height:34px;padding:0 2px;border-radius:8px;border:1px solid #e3d6c2;background:#fff;font-size:11px;text-align:center;text-align-last:center">
            ${units.map((u) => `<option value="${esc(u)}"${s.unit === u ? " selected" : ""}>${esc(u)}</option>`).join("")}
          </select>
          <input type="number" name="price" min="0" step="0.01" value="${esc(String(s.price || ""))}" placeholder="${esc(cur.symbol)}" style="min-width:0;height:34px;padding:0 4px;font-size:12px;text-align:center;border-radius:8px;border:1px solid #e3d6c2">
          <button type="submit" class="btn" title="Save" style="min-width:0;width:100%;height:34px;padding:0;font-size:14px;border-radius:8px">✓</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px;align-items:center">
          <div style="position:relative">
            <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#b3261e;pointer-events:none">MIN</span>
            <input type="number" name="minQty" min="0" step="0.1" value="${esc(String(s.minQty ?? ""))}" placeholder="reach → RUNNING LOW" title="When qty falls to this, RUNNING LOW is flagged" style="width:100%;min-width:0;height:32px;padding:0 8px 0 40px;font-size:11.5px;text-align:right;border-radius:8px;border:1px solid #f1c1bb;background:#fff8f5">
          </div>
          <div style="position:relative">
            <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#1d7a34;pointer-events:none">MAX</span>
            <input type="number" name="maxQty" min="0" step="0.1" value="${esc(String(s.maxQty ?? ""))}" placeholder="ideal stock level" title="Target stock level after replenishment" style="width:100%;min-width:0;height:32px;padding:0 8px 0 40px;font-size:11.5px;text-align:right;border-radius:8px;border:1px solid #bfe5c8;background:#f4faf5">
          </div>
        </div>
      </form>
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
  const escP = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => String(n || "").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "··";
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
  // First supplier renders 'active' (dark) — visual anchor for the current
  // selection in the section. Cards are stacked compact: initials badge on
  // top, name, then category subtitle in the muted line beneath.
  const supplierCard = (s, i) => {
    const on = i === 0;
    return `
    <div class="card" style="margin:0 0 6px;padding:10px 11px;min-width:0;${on ? "background:#191512;border-color:#191512;color:#fff" : ""}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <span style="display:inline-flex;width:28px;height:28px;border-radius:8px;background:${on ? "#2e2a26" : "#f0e7de"};align-items:center;justify-content:center;font-size:10.5px;font-weight:800;color:${on ? "#fff" : "#1a1a1a"};flex:0 0 auto">${escP(initials(s.name))}</span>
        <div class="row" style="gap:4px;flex:0 0 auto">
          ${s.mapsUrl ? `<a href="${escP(s.mapsUrl)}" target="_blank" style="font-size:13px;text-decoration:none;opacity:${on ? ".9" : "1"}" title="Open in Maps">📍</a>` : ""}
          <form method="POST" action="/app/owner/${id}/suppliers/${String(s._id)}/remove" onsubmit="return confirm('Remove ${escP(s.name)}?')" style="margin:0">
            <button class="btn ghost" style="width:auto;padding:2px 6px;font-size:10px;color:${on ? "#ffb08f" : "#b3261e"};background:transparent;border:0" title="Remove">✕</button>
          </form>
        </div>
      </div>
      <strong style="display:block;font-size:12.5px;margin-top:6px;line-height:1.25">${escP(s.name)}</strong>
      ${(s.categories || []).length ? `<span style="font-size:10.5px;${on ? "opacity:.7" : "color:#6b6560"}">${(s.categories || []).map((c) => escP(c).toLowerCase()).join(" · ")}</span>` : ""}
    </div>`;
  };
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
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;align-items:start">
          <div style="max-height:340px;overflow-y:auto;padding-right:4px;-webkit-overflow-scrolling:touch">
            ${suppliers.map((s, i) => supplierCard(s, i)).join("")}
          </div>
          <div class="sub card" style="margin:0;padding:14px 12px;text-align:center;font-size:11.5px;background:#fdf7ee;border-color:#efe0c8;color:#946200">
            Tap a supplier to see their price list <span class="si" style="display:block;margin-top:3px">මිල ලැයිස්තුව</span>
          </div>
        </div>`
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
        openBtn.style.transition = 'transform .15s';
        if(cancel) cancel.addEventListener('click', close);
      })();
    </script>`);
}

function planPage(shop, extras = {}) {
  const id = String(shop._id);
  const cur = extras.currency || { code: "LKR", symbol: "Rs" };
  const storeBuys = extras.storeBuys || [];
  const suppliers = extras.suppliers || [];
  const escS = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const buyTotal = storeBuys.reduce((n, b) => n + (Number(b.buyQty || b.qty) || 0) * (Number(b.price) || 0), 0);

  const emptyState = `<div class="card" style="margin-top:14px;padding:16px;text-align:center">
      <div style="font-size:30px">🛒</div>
      <strong style="display:block;margin-top:6px;font-size:14px">No items yet</strong>
      <p class="sub" style="font-size:12.5px;margin-top:6px;line-height:1.5">Open Kitchen Stock, then tap 🛒 on any item to add it to your Purchase Plan.<br><span class="si">කුස්සි ගබඩාවෙන් 🛒 බොත්තම එබීමෙන් අවශ්‍ය ද්‍රව්‍ය මෙතැනට එක් වේ.</span></p>
      <a class="btn" style="margin-top:12px;padding:11px" href="/app/owner/${id}/suite/stock">Open Kitchen Stock</a>
    </div>`;

  const list = storeBuys.length ? `
    <div class="row" style="justify-content:space-between;margin-top:14px">
      <strong style="font-size:14px">From your kitchen store <span class="si">ඔබේ ගබඩාවෙන්</span></strong>
      <span class="sub" style="font-size:12px">${storeBuys.length} item${storeBuys.length === 1 ? "" : "s"}</span>
    </div>
    ${storeBuys.map((b) => {
      const sid = String(b._id);
      const q = Number(b.qty) || 0;
      const p = Number(b.price) || 0;
      const bq = b.buyQty != null && b.buyQty !== "" ? Number(b.buyQty) : (Number(b.maxQty) ? Math.max(0, Number(b.maxQty) - q) : 0);
      const line = p > 0 && bq > 0 ? Math.round(bq * p) : 0;
      const supplierOptions = suppliers.map((sup) => `<option value="${String(sup._id)}"${String(b.buySupplierId || "") === String(sup._id) ? " selected" : ""}>${escS(sup.name)}</option>`).join("");
      return `<div class="card" style="margin-top:6px;padding:9px 11px 10px 13px">
        <div class="row" style="gap:6px">
          <div style="flex:1;min-width:0">
            <strong style="font-size:13px">${escS(b.name)}</strong>
            <div class="sub" style="font-size:11px">${escS(b.category || "")}${b.qty ? ` · in store ${escS(String(b.qty))} ${escS(b.unit || "")}` : ""}${p > 0 ? ` · ${escS(cur.symbol)} ${p}/${escS(b.unit || "")}` : ""}${b.minQty != null ? ` · min ${escS(String(b.minQty))}` : ""}${b.maxQty != null ? ` · max ${escS(String(b.maxQty))}` : ""}</div>
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
    ${buyTotal > 0 ? `<div class="card row" style="margin-top:8px;padding:11px 14px;background:#191512;border-color:#191512"><strong style="flex:1;font-size:12px;color:#fff;opacity:.8;letter-spacing:.04em">ESTIMATED TOTAL TO BUY · ${storeBuys.length} ITEMS</strong><strong style="font-size:15px;color:#ffb08f">${escS(cur.symbol)} ${buyTotal.toLocaleString()}</strong></div>` : ""}
    <div class="sub" style="font-size:11px;margin-top:10px">Add or remove items with the 🛒 button on each Kitchen Stock row.</div>` : emptyState;

  return page(shop, "plan", "Purchasing", "මිලදී ගැනීම්", `
    <div class="sub" style="font-size:12.5px;margin-top:8px">Items you flagged with 🛒 in Kitchen Stock — your shopping list, priced at what you paid last time.<br><span class="si">කුස්සි ගබඩාවේ 🛒 කරන ලද ද්‍රව්‍ය මෙතැන පෙන්වයි.</span></div>
    ${list}`);
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

/** Render a suite page, or null if the key is unknown. `extras` carries
 *  page-specific pre-loaded data (e.g. the shop's real dishes for the
 *  menu page). */
export function suitePage(shop, key, extras = {}) {
  const fn = PAGES[key];
  return fn ? fn(shop, extras) : null;
}
