# 3una 5aha — APP session handover

Written 2026-08-05. This hands the **buyer-app side** (`/app` marketplace +
`ios-app/`) to a fresh session because the current conversation is near its
context limit. Read §0 first — there's one live blocker waiting on the news
session. The newsroom/feed side is a **separate session** (see
`NEWSROOM_HANDOVER.md`); don't touch its files.

---

## 0. STATUS — read this first

### ✅ RESOLVED (2026-08-05 late): Mongo write-block is FIXED
Earlier today app writes were failing (HTTP 500) because the Mongo cluster was
full of newsroom audio. **This is now resolved** — the news session migrated
everything to a new Atlas cluster (single shared `MONGO_URL`, no split needed)
and deleted 116 audio episodes to get under the free-tier cap.

**Verified working just now:** a real kitchen-stock write returned **303** and
persisted in Mongo (`Carrot 6 kg @90` confirmed via direct query); `shop_owners`
data intact; `/app/orders` 200. All app data migrated with parity.

- **No app code change was needed** — `app.mjs`/`shop-suite.mjs` read the new
  cluster automatically via the same `getDb()`/`MONGO_URL`. Do NOT add
  `NEWS_MONGO_URL`/`getNewsDb()` (the split plan in `NEWSROOM_HANDOVER.md` was
  made moot — everything is one cluster).
- **Update your local `.env`** if you run `npm run web` locally: pull the
  current `MONGO_URL` with `railway variables --service web` (gitignored, not in
  the repo). A stale old value points at the now-empty old cluster and makes
  app data look vanished (it moved, didn't vanish).
- **⚠️ Not durable:** 131 spice episodes still hold audio in Mongo. If the news
  session runs `spicecast`/`spicecast:local` again it can re-hit the cap. That's
  their concern (paid tier or move audio to blob store) — but if app writes
  start 500ing again, this is why; check `NEWSROOM_HANDOVER.md`.
- **Re-check anytime** with a write test:
  ```
  railway run --service web node -e "const {MongoClient}=require('mongodb');(async()=>{const c=new MongoClient(process.env.MONGO_URL);await c.connect();const db=c.db(process.env.MONGO_DB||'gk_newsroom');try{await db.collection('kitchen_stock').updateOne({shopId:'_wt',name:'_t'},{\$set:{qty:1}},{upsert:true});await db.collection('kitchen_stock').deleteOne({shopId:'_wt'});console.log('WRITES: unblocked')}catch(e){console.log('WRITES: BLOCKED',e.message.slice(0,60))}await c.close()})()"
  ```

### 🟡 Pending: native App Store / Play resubmission
All the native changes below are **built and simulator-tested but NOT shipped**
— they need an iOS archive+upload (new version) and an Android AAB rebuild to
reach users. The **web changes are all live now**. Batch these into one
resubmit when ready (see §4).

### ✅ What's fully done & live (web) this session
Everything below is deployed on Railway and verified. The **iOS app is live**
at `apps.apple.com/app/3una-5aha/id6789434204` (build 3, the earlier native
rebuild — unchanged by this session's native edits until resubmit).

---

## 1. What was built this session

### Shop-owner tools (all in `src/lib/shop-suite.mjs` + `src/lib/app.mjs`)
- **Kitchen Stock** (`stockPage`) — real per-shop inventory (Mongo
  `kitchen_stock`). Category tabs (Vegi/Meat/Dry/Spices) drive a single
  compact one-line add row `[ingredient ▾][Qty][unit ▾][price][＋]`,
  center-aligned. Optional price → `price × qty = total` per item + created
  date. Ingredient list from `src/data/lanka-ingredients.mjs` (~90 items,
  English+Sinhala+default unit). Routes: `POST /app/owner/:id/stock/add`
  (upsert by shopId+name), `POST /app/owner/:id/stock/:id/remove`.
- **Purchase Planner** (`planPage`) — pick dishes + headcount (presets Daily 10
  / Party 25 / Catering 50 / Event 100), 35Ai scales every recipe and merges
  into one shopping list with LKR cost. Reads recipes from the same
  `/dishes/ai-recipe` endpoint (catalogue-first, see below).
- **Plan Menu** (`menuPage`) — two tabs: "Single dish · 35Ai" (AI recipe +
  ingredients + price, save to `app_dishes`) and "Set menu" (compose picked
  dishes into a set meal). `POST /app/owner/:id/menu/set` + `/menu/set/:id/remove`.
- **Per-shop currency** — `src/data/currencies.mjs` (16 currencies, LKR
  default). Picker in Shop Profile; owner-entered prices (kitchen stock, dish
  prices) show in the chosen symbol. `currencyOf(shop)` / `fmtMoney(shop,amt)`.
  NOTE: the Purchase Planner's auto-cost stays LKR (it's a Sri-Lanka market
  library estimate; no live FX).
- **Shop Profile** (`profilePage` in `app.mjs`) — full business profile: logo,
  **4 photos** (front/kitchen/food/seating gallery — slot 1 = `frontPhoto`,
  slots 2–4 = `photo2/3/4`), owner name, currency, Google Maps location,
  phone/WhatsApp/Telegram/Facebook/**Instagram/TikTok/YouTube**/**Google
  Business Profile**, contact email. Form limit raised to 3.5 MB for 5 photos.

### 35Ai recipes — catalogue-first (`src/lib/ai-dish.mjs`)
`generateRecipe()` resolves in order: (1) Mongo `app_dish_recipes` cache →
(2) **catalogue** (`src/data/spices.ts` ingredient tables, parsed per-serving
via `parseQty5`/`catalogueRecipe`) → (3) Gemini last resort. 175 of the 247
catalogue dishes have ingredient lists, so most recipes are **free + instant +
offline**, sidestepping the Gemini spend cap (which is maxed). Both cache read
and Gemini cache write are best-effort try/catch (survive a full Mongo).

### Identity + navigation cleanup
- **Shop Manager** — native `Manager` tab (storefront icon) after Map + red
  "Shop Manager" button in Account (`ios-app/.../NativeApp.swift`). Opens
  `GET /app/manager` which resolves the owner's shop from the session
  (`app_shop` cookie fast-path, else `shop_owners` lookup by `app_email` — works
  for email/Apple/Google/SMS) and redirects to the owner hub. Non-owners get an
  "open your shop" prompt.
- **Web nav = native** — `buyerNav` is now Home · Orders · Map · Manager ·
  Account (added Manager → `/app/manager`, renamed Location→Map, Profile→Account
  to mirror the native TabView).
- **Logout moved up** — ManagerView hides its native nav title so the web owner
  hub renders from the top; the hub now leads with a "Shop Manager" heading and
  the shell's fixed Logout sits top-right under the status bar.
- **One sign-in** — personal profile signed-out prompt points to the unified
  `/app` sign-in (no more parallel email-only login); removed the redundant
  "Open your shop" row from the native Account (Manager tab covers it).

### Email verification (earlier this session) — `src/lib/mail.mjs`
Real 6-digit codes via **Resend** (`RESEND_API_KEY` on Railway) from
`3una 5aha · තුන පහ <gk.smart@ggmt.sg>`. Domain `ggmt.sg` verified in Resend
(SPF/DKIM in Cloudflare). Works for signup + password reset; bilingual copy.

### Food catalogue (handed to news, but app reads it)
247-entry catalogue in `src/data/spices.ts` (all bilingual + ingredients) +
`lanka_dishes/spices/bakery` Mongo collections. The app's Plan Menu picker and
35Ai read these. Ownership + the /food channel are **news-session** now (see
`NEWSROOM_HANDOVER.md` 2026-08-04 addendum). Don't regenerate audio (spend cap
+ storage).

---

## 2. Stack references

### Git / deploy
- Repo: `/Users/gamini/GK Dev/yai-newsroom`, remote `ggmt` →
  `Gaminigz/GK-Newsroom`, branch `main`.
- **`gh auth switch --user Gaminigz` before every push** (403 otherwise).
  Commit author stays `yaikhsales <gamini@yaikh.com>`. `git push ggmt main`.
- Railway auto-deploys `web` on push. Live: `https://web-production-2b43c.up.railway.app`.
  Verify features with `curl` after ~30–60 s (see §3 test snippets).

### Railway (project `gk-newsroom`, workspace "GK SMART's Projects")
- Service **web** (this app) — `MONGO_URL`, `MONGO_DB=gk_newsroom`,
  `RESEND_API_KEY`, `RESEND_FROM`, `GEMINI_API_KEY` (paid key, but spend cap is
  maxed — 35Ai is catalogue-first so it doesn't matter), APNs vars, `ADMIN_CODE`.
- Service **newsroom** — the news pipeline (separate session).
- `railway variables --service web` to inspect; `railway run --service web <cmd>`
  to run scripts against prod env.

### MongoDB
- `MONGO_URL` → Atlas Cluster0, DB `gk_newsroom`. **Currently full (512/512)** —
  see §0. App collections: `shop_owners`, `app_dishes`, `app_orders`,
  `app_users`, `kitchen_stock`, `app_dish_recipes`, + shared catalogue
  `lanka_dishes/spices/bakery`.

### Test accounts / ids
- Owner: `aa@a.com` / `111111` → shop **Ceylon Kitchen Colombo**,
  id `6a4fa9bc0156d2dce4bb2c69`.
- Buyer: `a@a.com` / `111111`.
- iOS bundle `sg.ggmt.una5aha`, Team `4KX4774V2U`, Apple app id `6789434204`.

---

## 3. Handy verification snippets
```bash
BASE=https://web-production-2b43c.up.railway.app; SHOP=6a4fa9bc0156d2dce4bb2c69
curl -s -c /tmp/t.txt -X POST "$BASE/app/login-email" -H "Content-Type: application/x-www-form-urlencoded" -d "email=aa@a.com&password=111111" -o /dev/null
# nav consistency
curl -s -b /tmp/t.txt "$BASE/app/home" | grep -oE 'href="/app/(home|orders|location|manager|profile)"'
# manager route resolves owner
curl -s -b /tmp/t.txt -o /dev/null -w "%{http_code} %{redirect_url}\n" "$BASE/app/manager"
# 35Ai catalogue recipe (free)
curl -s -b /tmp/t.txt -X POST "$BASE/app/owner/$SHOP/dishes/ai-recipe" -H "Content-Type: application/x-www-form-urlencoded" -d "dish=Watalappam"
# write test (will 500 until Mongo is cleared)
curl -s -b /tmp/t.txt -X POST "$BASE/app/owner/$SHOP/stock/add" -H "Content-Type: application/x-www-form-urlencoded" -d "name=Carrot&category=Vegi&qty=6&unit=kg" -o /dev/null -w "%{http_code}\n"
```

---

## 4. Native resubmission (when ready)
The native edits (`ios-app/ios/App/App/NativeApp.swift`: Manager tab, ManagerView,
red Shop-Manager button, Account cleanup, Logout position) are committed and
**build + run in the simulator** (verified this session). To ship:
1. Bump `CURRENT_PROJECT_VERSION` (currently **3**) → 4 in `project.pbxproj`
   (both Debug/Release).
2. Archive + export + upload — see `ios-app/APP_REVIEW_HANDOVER.md` §6 for the
   exact `xcodebuild archive` / `-exportArchive` flow and the
   `/tmp/exportOptions.plist` (team `4KX4774V2U`, `app-store-connect`, upload).
3. Attach the new build in App Store Connect, answer export compliance ("None
   of the algorithms"), submit for review. Reply letter not needed (not a
   rejection response) — just a normal version update. New nav/Shop-Manager is
   the headline change.
4. **Android**: rebuild the signed AAB (`ios-app/android`, `./gradlew
   bundleRelease`, keystore at `~/Documents/apple-keys/una5aha-upload.jks`) and
   upload to Play — see `ios-app/ANDROID_LAUNCH_HANDOVER.md`.
- Local build: `cd ios-app/ios/App && xcodebuild -project App.xcodeproj -scheme
  App -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug
  build`. DerivedData:
  `~/Library/Developer/Xcode/DerivedData/App-gabmuxupbhthiygiaglfcpouwvcm/…/App.app`.
- Simulator note: use `mcp__Claude_Code_iOS_Simulator__control` with **point**
  coords (402×874 on iPhone 17), not screenshot pixels. Manager native tab ≈
  (269,842). The owner hub inside the Manager tab is a webview; tapping the shop
  name opens Shop Profile.

---

## 5. Session boundary (don't collide)
- **APP session (this doc):** `src/lib/app.mjs`, `src/lib/shop-suite.mjs`,
  `src/lib/ai-dish.mjs`, `src/lib/mail.mjs`, `src/data/lanka-ingredients.mjs`,
  `src/data/currencies.mjs`, `ios-app/`.
- **NEWS session:** `/food`,`/ai`,`/accounting` in `serve-web.mjs`,
  `src/data/spices.ts`, `gen-images.mjs`, `gen-food-content.mjs`,
  `spice-podcast.ts`, `lanka-dishes/spices/bakery.mjs`, `web-assets/spices/`.
  Currently doing the **Mongo split** (see §0 + `NEWSROOM_HANDOVER.md`).
- **SHARED, coordinate:** `src/scripts/serve-web.mjs` (router mounts both) and
  `src/lib/mongo.ts`. Pull before editing; keep changes in separate route
  blocks.

## 6. Suggested first moves for the fresh session
1. Run the write test in §0. If unblocked → the Mongo split is done; verify a
   real owner write and you're clear to build write-features again.
2. If still blocked → app writes are down for live users; ping the news session
   (their delete step is the unblock). Meanwhile only read-only/native work is
   safe to build.
3. Otherwise: the native App Store/Play resubmission (§4) is the biggest
   user-facing pending item.
