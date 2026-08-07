# 3una 5aha — Session handover (POS + Table QR + La Pha Ny seed)

Written 2026-08-08. Session context is at ~90% — start a fresh session and read
this before anything else. **Everything below is already committed and live on
Railway** unless explicitly marked native/pending.

Companion doc: [APP_SESSION_HANDOVER.md](APP_SESSION_HANDOVER.md) (older). Read
that too — the earlier session's setup (native rebuild, Mongo migration, one-login
cookies) is still the base.

---

## 0. Real-shop test rig — LA PHA NY SRI LANKAN LITTLE HUT

The demo owner `aa@a.com` / `111111` **no longer opens Ceylon Kitchen Colombo**
— it now lands on **La Pha Ny** (real Sri Lankan food shop, Amila, Phnom Penh,
Cambodia). Ceylon Kitchen still exists as `demo-ceylon@example.com` — no
password (unreachable via login, harmless).

- Shop `_id`: `6a75718da2de19ffac236055` · `slug`: `la-pha-ny`
- **47 real dishes** across 9 categories (Starters, Bites, Vegi meals, Chicken,
  Beef, Pork, Sea food, Drinks, Desserts), Sinhala names, real prices from
  Amila's Telegram menu. See §2 below for the seed script pattern.
- **10 tables** pre-added (`shop.tables = [1..10]`) so QR generation demos out
  of the box.
- Currency: `LK` primary display shows `LKR X · US$Y`; Cambodia (`KH`) shows
  `US$X · LKR Y`. See §4.

**Live URLs:**
- Owner hub: <https://web-production-2b43c.up.railway.app/app/owner/6a75718da2de19ffac236055>
- Buyer view: <https://web-production-2b43c.up.railway.app/app/shop/6a75718da2de19ffac236055>
- **Table 3 scan URL (as QR-encoded):** <https://web-production-2b43c.up.railway.app/m/la-pha-ny/3>
  → 303 → `/app/shop/…/?t=3` → dine-in menu with "🍽 Table 3" banner

---

## 1. Photos — NOT attached (important)

**All 47 dishes render with the 🍛 emoji placeholder.** No dish record has a
`photo` field set. I told the user this explicitly — options are:
1. Owner Amila taps ✎ per dish and uploads real photos in the app (~1 min/dish).
2. Seed SVG placeholders (same tiny data-URI trick used for the bill test).
3. WebFetch Unsplash stock photos and attach.

**Storage recommendation:** stay on Mongo base64 for now (~2 MB total app data,
plenty of runway). When we cross ~200 MB of photos, wire Cloudflare Images
($5/mo, 100k images, auto-resize). Google Drive is a poor fit (OAuth per shop,
awkward links, no CDN, 750 GB/day download limit). See
[mongo-quota-incident memory](/Users/gamini/.claude/projects/-Users-gamini-GK-Dev/memory/mongo-quota-incident-2026-08-05.md)
for context on why we watch DB size.

---

## 2. Data model changes this session

### Prices are now LKR base for ALL shops
- Every `app_dishes.price` is stored as LKR integer, regardless of shop's
  local currency.
- La Pha Ny prices were stored as USD ($5, $2 etc.) initially — converted via
  a `railway run` script (multiply by 300). Never store USD in `price` again;
  always LKR.
- Display converts via `fx(lkrAmt, code)` in `src/lib/app.mjs:145`.

### shop_owners docs gained
- `slug` (auto-generated on first `ensureShopSlug` call, kebab-case, unique)
- `tables: number[]` (sorted, 1–25 max, gaps allowed after mid-table delete)

### New collections
- `suppliers` — `{shopId, name, mapsUrl, categories:[], createdAt}`
- `supplier_bills` — `{shopId, supplierId, image (data:image/svg+xml or JPG), total?, uploadedAt}`
- `pos_sales` — `{shopId, items:[], total, createdAt}` (from Manager → POS clerk flow)

### kitchen_stock gained
- `minQty`, `maxQty` (per-item running-low threshold; falls back to per-unit
  defaults `{kg:2, L:2, g:500, ml:500, nos:6, packs:1, pcs:5}` when unset)
- `buyNext`, `buyNextAt` (🛒 flag to surface item in Purchasing)
- `buySupplierId`, `buyQty`, `buyPlanAt` (Purchasing per-item plan)

### app_dishes gained
- `category` (from `POS_CATEGORIES` list, exported from `src/lib/shop-suite.mjs`)

### app_orders gained
- `type: "pickup" | "table"`, `tableN` (when a QR-scan customer places an order)

### app_users
- Rich buyer profile fields: `whatsapp`, `telegram`, `city`, `currency`, `lang`,
  `diet: []`, `cuisines: []` (see [/app/profile](https://web-production-2b43c.up.railway.app/app/profile))

---

## 3. Feature map — what was built this session (in chronological order)

Every commit hash is a link to GitHub. Most items ended up on the **Shop Manager
tile grid** (14 tiles now, 3×4 + 2):

```
Setup Daily Menu · POS · Plan Menu
Cost sheet · Kitchen stock · Purchasing
Buying & bills · Bill History · Staff salaries
Staff Pay · Utilities Pay · Shop accounting
Dashboard · Business health
```

### Shop Manager compaction + one-login
- Compact header rows across Shop Manager, Buyer Profile, Manager tab
- `aa@a.com` demo login now sets `app_email` + upserts `app_users` doc so `/app/profile` recognizes signed-in state
- Buyer Profile: rich fields (WhatsApp, Telegram, city, currency, language, diet chips, cuisines chips)
- Shop owner extra section — 4 shop photos at bottom of the personal profile

### Kitchen Stock
- ✎ pencil per row → inline `[−][qty][+][unit][price][✓]` edit form
- **Min Qty / Max Qty** row underneath edit form — Min drives RUNNING LOW
- 🛒 buy button per row → toggles `buyNext`, item shows up in Purchasing
- Tab counts show `stocked/available` (e.g. `Vegi · 7/30`)
- Viewport `maximum-scale=1` on shell to stop iOS input-focus auto-zoom
  (was clipping Save/+/✓ buttons off-screen)

### Purchasing (formerly "Purchase plan")
- Renamed from `plan` tile
- Split-screen: **left** — 🛒 flagged items with supplier dropdown +
  Buy Qty box + ✓ save (green outline when saved, orange when pending)
- Total pinned at top
- Scrollable list (max-height:520px) so total stays visible over 10-20 items
- **Market prices button** → `/app/owner/:id/market-prices` — 48 curated
  Sri Lankan items from `src/data/market-prices.mjs`, with search + category
  filter. Each Purchasing row shows `▼ 5%` / `▲ 22%` / `= 0%` vs market benchmark.

### Buying & bills (formerly "Purchasing")
- Renamed. RUNNING LOW section wired to real kitchen_stock (per-item Min).
- **Suppliers** with `+` round Add button (flush next to heading), split-screen:
  suppliers list on left (color-coded by golden-angle hue), items panel on right.
- Each supplier: 📍 map link · 🧾 file-picker for bill photo · ✕ remove.
- Items panel is flat (no borders) with `TOTAL · Rs X` band at bottom in
  same hue as the supplier.

### Bill History (new tile)
- Same split-screen layout, right side shows uploaded bill thumbnails.
- Year + Month dropdowns filter by upload date.
- Tap a thumbnail → modal viewer with **🗑 Delete bill** (two-tap confirm —
  `confirm()` doesn't work in WKWebView unless `WKUIDelegate` is implemented).
- Test data: 10 bills seeded as SVG data URIs styled as receipts.

### POS tile (💳)
- New tile at row 1 col 2 (Dashboard moved down to Row 5)
- Category chip row wraps to 2-3 rows (no swipe needed): All · Starters ·
  **Bites** · Vegi meals · Chicken · Beef · Mutton · Pork · Sea food · Drinks · Desserts
- Split-screen: dish grid left (photos + tap-to-add), sticky bill panel right
  with `[−] N [+]` stepper per line + `Ring up` button
- Categories filter left grid; bill panel stays put
- Ring up → POST `/app/owner/:id/pos/ring` → `pos_sales`; Today's sales
  footer aggregates.
- Sinhala label: `විකුණුම් කවුන්ටරය` (was wrongly "recipe")

### Table QR (`/app/owner/:id/qr`)
- Owner enters number of tables (1-25 cap), split-screen: tables list left,
  QR panel right. Each table gets a unique hue.
- **🔍 Preview & Download** button → in-page modal renders a branded A5-portrait
  card on canvas (brand + shop + city + TABLE N pill + QR + scan hint +
  contacts + footer) → `⬇ Download JPG` and `↗ Share` (Web Share API with the
  JPG as an actual file attachment on iOS 15+).
- `🖨 Print all` opens `/app/owner/:id/qr/print?tables=N` — A4 portrait, 2
  cards per sheet with cut/fold guide, auto-fires `window.print()`.

### QR-to-order flow (customer scans → dine-in menu)
- QR encodes `.../m/<slug>/<table>` (short URL, ~60 chars vs the old 77).
- Server-side `/m/<slug>/<n>` 303-redirects to `/app/shop/<id>?t=<n>`.
  **Router dispatch fix in `serve-web.mjs` was necessary** — the earlier /app/…
  filter didn't route /m/… to handleApp.
- Storefront in DINE-IN mode: `🍽 Table N` banner up top, tap-to-add dish
  grid, `SEND TO KITCHEN` button (no name/phone/pickup fields), order saved
  with `type:"table", tableN:N`, push notification title uses 🍽.

### Currency (country-aware display)
- `LKR_TO`, `CUR_SYM`, `COUNTRY_CUR` maps in `src/lib/app.mjs:135-180`.
- `shopPrice(shop, lkrAmt)` returns `"US$5.00 · LKR 1,500"` for Cambodia,
  `"LKR 1,200 · US$4.00"` for Sri Lanka.
- Applied to shopPage + ownerDash (My dishes tiles). Buyer Home aggregates
  across shops so still uses the older `lkr()`.

### Native app changes (Swift, rebuilt + installed in sim; NOT shipped to App Store)
- **AccountView**: 2×2 grid (Apple · Email · SMS · Guest) matching web welcome
  page. Signed-in state reads `app_email` from `WKWebsiteDataStore.default().httpCookieStore`
  so web sign-in flips native `@AppStorage` correctly. Compact layout via
  `.listSectionSpacing(6)` (iOS 17+, guarded).
- **ManagerView + RootView**: custom `TabView(selection:)` binding bumps
  `managerReloadKey = UUID()` on every Manager tap (including re-selection).
  `WebViewRepresentable` reload-key logic uses a Coordinator so it only
  reloads when the key actually changes (not on every SwiftUI recompute).
  Fixes "logged out" bug where WebView was snapping back constantly.
- Web `.nav` hidden inside native via `?native=1` URL flag + `native=1`
  cookie set by Swift on WebView creation. Shell script checks all three
  signals so the native TabView is the only bottom bar.

---

## 4. Currency table (LKR base — critical to remember)

**All prices in `app_dishes.price` are LKR integers.** Display converts:

| Country | Primary | Secondary | Example La Pha Ny |
|---|---|---|---|
| Sri Lanka | LKR | US$ | LKR 1,200 · US$4.00 |
| Cambodia | US$ | LKR | US$5.00 · LKR 1,500 |
| Singapore | S$ | LKR | S$6.75 · LKR 1,500 |
| UK | £ | LKR | £3.95 · LKR 1,500 |
| Australia | A$ | LKR | A$7.65 · LKR 1,500 |
| UAE | AED | LKR | AED 18 · LKR 1,500 |
| India | ₹ | LKR | ₹415 · LKR 1,500 |
| default | US$ | LKR | US$5.00 · LKR 1,500 |

FX rates hardcoded in `LKR_TO`. **Refresh via API is future work** — probably
`api.exchangerate-api.com` or similar, weekly cached to Mongo.

---

## 5. Pending / open items

### High priority
- **DNS setup for `ecom.ggmt.sg`** — needs the user's Cloudflare action:
  Railway → `web` service → Domains → `+ Custom domain` → `ecom.ggmt.sg`;
  Cloudflare CNAME `ecom → xxx.up.railway.app`. Once live, set env var
  `PUBLIC_BASE=https://ecom.ggmt.sg` in Railway → every fresh QR carries
  the pretty URL. QR gets to ~34 chars, denser + easier to scan.
- **Photos for La Pha Ny dishes** — 47 dishes on 🍛 placeholder. Either
  Amila uploads, or seed SVG placeholders (choice from §1).
- **Native App Store resubmit** — 2 native commits from this session
  ([4be330e](https://github.com/Gaminigz/GK-Newsroom/commit/4be330e) +
  [b6f58ac](https://github.com/Gaminigz/GK-Newsroom/commit/b6f58ac) +
  [cf55a10](https://github.com/Gaminigz/GK-Newsroom/commit/cf55a10)) are
  in the sim but NOT shipped. Per user's rule, resubmission happens in a
  **dedicated iOS session**, not this one. Version bump 3→4, archive, upload.

### Medium
- Buyer Home flash card + shop rows still use the old `lkr()` helper (LKR-only)
  because they aggregate across shops. Could lookup shop per item for
  proper currency, at cost of N queries per Home load.
- POS supports "Bites" category. Existing dishes in other shops probably don't
  use it — no auto-migration.
- The `qrPage`'s `ensureShopSlug` is lazy — a shop with no slug won't have a
  working `/m/` URL until the owner opens the QR page once. Fine for MVP,
  but consider adding a slug on shop creation.

### Low
- FX rates are static — see §4 note about future refresh path.
- `pos_sales` docs aren't visible anywhere yet except "Today's sales" total
  on the POS page. Could add a Sales History view mirroring Bill History.
- Bill upload photos are stored as base64 data URIs (JPG or SVG). Same
  Mongo-bloat concern as dish photos — same Cloudflare migration when it hits
  the wall.

---

## 6. Gotchas the fresh session should know

### From earlier sessions (still true)
- **`gh auth switch --user Gaminigz`** before every push to
  `Gaminigz/GK-Newsroom` — remote silently prefers yaikhsales otherwise → 403.
- **Session cookies in the Cursor sim** persist across `simctl install` but
  not `simctl uninstall`. Reinstall keeps app data / cookies.
- **iOS `confirm()` is silently swallowed in WKWebView** unless the app
  implements `WKUIDelegate.runJavaScriptConfirmPanelWithMessage`. This
  session's `Delete bill` bug was caused by that — solved with an in-page
  two-tap confirm. **Any future destructive action must not rely on `confirm()`.**
- **Native TabView renders ABOVE the WKWebView** — modal padding must reserve
  ~110pt at the bottom or buttons get clipped by the tab bar.

### New this session
- **Sim tap coordinate precision is unreliable for small buttons in the
  middle of the viewport.** Confirmed the Delete flow works via curl POST;
  the sim taps just kept missing the ~40pt button. If you need to *prove*
  a button works, hit the endpoint directly.
- **`serve-web.mjs` only dispatches `/app` and `/m` paths to handleApp.**
  Any new short URL you add outside those namespaces needs its own dispatch
  branch at line ~1102.
- **La Pha Ny's `country: "Cambodia"`** (not the ISO code "KH"). The
  `COUNTRY_CUR` map handles both spellings for the countries we know.
  Any new country needs an entry.
- **`slug` on shop_owners is unique** — don't manually edit without checking
  for collisions. `ensureShopSlug` handles the uniqueness auto-suffix.
- **`price` on app_dishes is ALWAYS LKR integer.** If you ingest new dishes
  in USD from a menu poster, multiply by 300 or the display shows 0.02 USD /
  LKR 5 which is exactly the bug that prompted the whole currency refactor.

---

## 7. Reference — key file paths

| Concern | File | Line hint |
|---|---|---|
| POS_CATEGORIES + shop-suite hub | `src/lib/shop-suite.mjs` | 17 (SUITE_TILES), 101 (POS_CATEGORIES) |
| Shop Manager ownerHub | `src/lib/shop-suite.mjs` | 44 (`ownerHubPage`) |
| POS page (customer via QR uses buyer shopPage, not this) | `src/lib/shop-suite.mjs` | `posPage()` |
| Kitchen Stock | `src/lib/shop-suite.mjs` | `stockPage()` |
| Buying & bills | `src/lib/shop-suite.mjs` | `purchasingPage()` |
| Bill History | `src/lib/shop-suite.mjs` | `billHistoryPage()` |
| Purchasing | `src/lib/shop-suite.mjs` | `planPage()` |
| Market prices | `src/lib/shop-suite.mjs` | `marketPricesPage()` + `src/data/market-prices.mjs` |
| Table QR (owner) | `src/lib/app.mjs` | `qrPage()` (~1483) + `qrPrintPage()` |
| Buyer / dine-in view | `src/lib/app.mjs` | `shopPage()` (~1037) |
| Currency helpers | `src/lib/app.mjs` | 133-190 (`LKR_TO`, `COUNTRY_CUR`, `shopPrice`) |
| /m/ short URL route | `src/lib/app.mjs` | ~2613 (needs `serve-web.mjs` line 1102 dispatch) |
| /app/order route (tableN handling) | `src/lib/app.mjs` | ~2623 |
| Tables add/remove | `src/lib/app.mjs` | ~3020 (`/tables/add`, `/tables/:n/remove`) |
| Native AccountView | `ios-app/ios/App/App/NativeApp.swift` | `AccountView` |
| Native ManagerView + RootView tap-reset | `ios-app/ios/App/App/NativeApp.swift` | `RootView`, `WebViewRepresentable` (Coordinator) |
| Router dispatch (/app + /m) | `src/scripts/serve-web.mjs` | ~1102 |

---

## 8. Suggested first moves for the fresh session

1. **Read this doc + [APP_SESSION_HANDOVER.md](APP_SESSION_HANDOVER.md).**
2. **Check status:** `git log --oneline -10` and `railway status`. Session
   ended at ~62 commits pushed, all live.
3. **Test the customer flow:** open
   <https://web-production-2b43c.up.railway.app/m/la-pha-ny/3> in a browser
   — should show the DINE-IN Table 3 menu with real La Pha Ny dishes.
4. **Sign in as owner:** `aa@a.com` / `111111` → lands on La Pha Ny hub.
5. **If the user asks about photos:** see §1. Owner uploads via ✎ per dish,
   or seed SVG placeholders on request.
6. **If the user asks about the pretty URL:** see §5 — need Railway custom
   domain + Cloudflare CNAME (user action, 5 min).
7. **If the user asks about App Store:** hand off to a dedicated iOS session
   — don't do the archive+upload here (per user's standing rule).

---

## 9. Sample seed patterns (reference)

Add a dish:
```bash
railway run node -e "
const {MongoClient}=require('mongodb');
(async()=>{const c=new MongoClient(process.env.MONGO_URL);await c.connect();
const db=c.db(process.env.MONGO_DB||'gk_newsroom');
await db.collection('app_dishes').updateOne(
  {shopId:'6a75718da2de19ffac236055', name:'New Dish Name'},
  {\$set:{name:'New Dish Name', nameSi:'නම', price:1500, category:'Bites',
          shopId:'6a75718da2de19ffac236055', window:'all day', discount:'none',
          special:false, promoTag:'Today special', portions:20},
   \$setOnInsert:{createdAt:new Date()}},
  {upsert:true});
console.log('ok'); await c.close();})();
"
```

Add a table (via API — respects the 25 cap):
```bash
curl -s -b /tmp/cook.txt -X POST https://web-production-2b43c.up.railway.app/app/owner/6a75718da2de19ffac236055/tables/add -o /dev/null -w "%{http_code} %{redirect_url}\n"
```

Sign in as owner (for cookie):
```bash
curl -s -c /tmp/cook.txt -X POST https://web-production-2b43c.up.railway.app/app/login-email -d "email=aa@a.com&password=111111" -o /dev/null
```

---

## 10. What the app looks like right now

- **Buyer scans Table 3 QR at La Pha Ny** → dark banner "DINE-IN · LA PHA NY
  SRI LANKAN LITTLE HUT · 🍽 Table 3" → menu grid → basket → SEND TO KITCHEN
  → order lands with `tableN:3`. Push notification "🍽 Table 3 order" pings
  the kitchen.
- **Amila logs in** as `aa@a.com` / `111111` → Shop Manager hub → 14 tiles.
  Setup Daily Menu shows 47 dishes filterable by 10 category chips. Manages
  tables + prints A4 QRs (2/sheet). Sees Bill History + spend per supplier.
  Runs POS for walk-in customers.
- **All prices display in Cambodia's local convention** (`US$5.00 · LKR 1,500`
  for La Pha Ny). If Amila opens Ceylon Kitchen (Sri Lanka) it flips to
  `LKR 1,200 · US$4.00`. Adding a Singapore shop would auto-show `S$X · LKR Y`.

Session end. Everything above is live at
<https://web-production-2b43c.up.railway.app>.
