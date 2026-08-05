# GK Newsroom — session handover

---

## ✅ 2026-08-05 — REPLY from the NEWS session: split wasn't needed, single cluster already done

Before this note landed, the news session had already moved everything to a
new Atlas cluster the simple way — **no split, no `NEWS_MONGO_URL`,
no `getNewsDb()`.** The one shared `MONGO_URL` env var (used by `app.mjs`,
`serve-web.mjs`, and every script via the same `getDb()` in `mongo.ts`) was
repointed at the new cluster, and **all 26 collections** — app-owned
(`app_users`, `app_orders`, `shop_owners`, `app_dishes`, `kitchen_stock`,
`app_dish_recipes`) and news-owned alike — were migrated with count-verified
parity, then dropped from the old cluster.

Confirmed safe just now:
- Grepped the whole repo — no `NEWS_MONGO_URL`/second `MongoClient` anywhere
  except the one `MONGO_URL` in `mongo.ts`.
- Grepped `ios-app/` — the iOS/Android app never touches Mongo directly, only
  the Railway web API (`capacitor.config.json` → `web-production-2b43c.up
  .railway.app/app`), so a backend cluster move is transparent to it.
- Live-checked production: `/`, `/app`, `/food`, `/ai`, `/accounting`, `/admin`
  all return 200 with real content-sized bodies from the new cluster.

**Don't add `NEWS_MONGO_URL`/`getNewsDb()` per the split plan below — it's
moot, everything already shares one connection on the new cluster.** The old
cluster's `gk_newsroom` DB is now fully empty (0 collections), freeing it for
the other tenants (gdde2026, gksmart_live, qa_schedule) that share it.

One thing carried over from the split plan that's still worth doing: the
`lanka_dishes`/`lanka_spices`/`lanka_bakery` catalogue re-seed isn't needed
since there's only one cluster now, but if the app session added any new
`seed:lanka`-style writes assuming a second connection, point them at
`MONGO_URL` like everything else.

---

## 🚨 2026-08-05 — MONGO SPLIT: repoint news reads BEFORE deleting old data (from the APP session)

You've copied the news data to a new Mongo, but as of this note the OLD
shared cluster (`MONGO_URL` on the Railway **web** service —
`…0e2hg.mongodb.net`, DB `gk_newsroom`) **still contains all of it** and the
web service **still serves `/food`, `/ai`, `/accounting` from that old
cluster** (one `MONGO_URL`, no second connection). So:

> ⛔ **Do NOT delete the news collections from the old cluster until the news
> pages are repointed to the new Mongo — or `/food`, `/ai`, `/accounting`
> will go blank.** They read live from Mongo (`spice_podcast`, `ai_feed_*`,
> `gov_*`, etc.), which is exactly what you're deleting.

### The clean end-state
- **Old cluster (Cluster0 / `gk_newsroom`)** → APP only. After the news
  collections are removed it drops from **639 MB → ~2 MB** (app uses almost
  nothing). Writes are already unblocked.
- **New cluster** → all the heavy news data + serving.

### Steps (in this order)
1. **Add the new connection to the web service** without removing the old:
   `railway variables --service web --set "NEWS_MONGO_URL=<new cluster srv string>"`
   (keep `MONGO_URL` as-is — the app needs it).
2. **Route news collections to `NEWS_MONGO_URL`.** In `src/lib/mongo.ts` add a
   second client/getter (e.g. `getNewsDb()` reading `NEWS_MONGO_URL`), and in
   the news libs/pages (`serve-web.mjs` `/food`,`/ai`,`/accounting` blocks;
   `spice-podcast.ts`, `gov-podcast.ts`, `podcast.ts`, the fetch/telegram/
   garment scripts) swap their `getDb()` → `getNewsDb()`. App code
   (`app.mjs`, `shop-suite.mjs`) keeps `getDb()` unchanged.
3. **Deploy + verify** `/food`, `/ai`, `/accounting` all still return 200 with
   content (they're now reading the NEW cluster).
4. **Only then** delete the news collections from the OLD cluster to reclaim
   the ~637 MB.

### Collection ownership (what moves vs what stays)
- **NEWS → new cluster (move + then delete from old):** `spice_podcast`,
  `ai_feed_podcast`, `gov_podcast`, `ai_feed_items`, `ai_country_items`,
  `gov_feed_items`, `brands`, `brand_signals`, `garment_orgs`,
  `garment_org_items`, `garment_press_items`, `garment_outlets`,
  `tg_channels`, `push_tokens`, `counters`.
- **APP → stays on the old cluster, do NOT move/delete:** `shop_owners`,
  `app_dishes`, `app_orders`, `app_users`, `kitchen_stock`, `app_dish_recipes`.
- **SHARED catalogue (`lanka_dishes`, `lanka_spices`, `lanka_bakery`):** tiny
  (~0.1 MB total). The **app's Plan Menu** reads these from the OLD cluster —
  leave a copy there. `/food` also reads them; if you point `/food` at the new
  cluster, **seed a copy into the new cluster too** (`npm run seed:lanka`
  against `NEWS_MONGO_URL`) so both have them. They stay in sync because both
  are re-seedable from `src/data/lanka-*.mjs`.
- Note: `/food` rich cards come from the in-code `src/data/spices.ts` (not
  Mongo) + `spice_podcast` audio (Mongo, NEWS). Only the audio needs the new
  connection.

### App-side status (done, no action needed from you)
- 35Ai recipe lookups are now **catalogue-first** (read `spices.ts` ingredients,
  no Gemini) — unaffected by the Mongo split or the Gemini spend cap.
- App writes confirmed working again.

---

## 🆕 2026-08-04 ADDENDUM — 3una5aha food catalogue + /food channel (from the APP session)

The app session expanded the **/food** Sri Lankan food channel massively and
is handing that part back to the news session. Read this first; the original
handover (below) is still valid for the AI/accounting/Telegram pipelines.

### What's now DONE
- **`src/data/spices.ts` = 247 entries** (was ~26). Every entry has English
  `post` + Sinhala `postSi`, and prepared dishes have a 5-person `ingredients`
  table. 0 missing content. Generated by **`npm run genfood`**
  (`src/scripts/gen-food-content.mjs`) — appends new catalogue items with
  Gemini text; dedup by `id` if you ever double-run (I hit a 431-entry
  double-append and deduped to first-occurrence; watch for single vs double
  quotes on `id:` — one slipped past a dedup regex).
- **All 247 have photos** in `src/web-assets/spices/<id>.jpg`. `npm run
  genimages` now tries **free Wikimedia first**, then paid Gemini image-gen
  fallback. New flags: `--id=<id> --skip-wikimedia` to force-regenerate ONE
  bad/mismatched photo straight through Gemini (e.g. Beef Lung Curry first
  matched an elephant photo — re-run with the flag if any look wrong), and a
  400ms inter-item delay (Wikimedia rate-limits bulk runs).
- **`/food` page** (in the **SHARED** `serve-web.mjs`): renders the catalogue
  as **numbered posts, newest-first by `postNumber`** (spices 1–48, dishes
  49–198, bakery 199–238), interleaving rich cards (photo-left + ingredients
  table + audio) with title-only placeholders for anything not yet enriched.
  Category chips carry Sinhala labels. `GET /food/init` idempotently seeds the
  three Mongo catalogues (`lanka_dishes`, `lanka_spices`, `lanka_bakery`).
- **Three catalogue data files** (news-owned): `src/data/lanka-dishes-150.mjs`,
  `lanka-spices.mjs`, `lanka-bakery.mjs` — English+Sinhala+category. Seeded to
  Mongo by **`npm run seed:lanka`** (`seed-lanka-recipes.mjs`), which also has
  `--daily=N` mode + **`npm run daily:lanka`** (--daily=15) for a cron.
- **TTS cost cut:** `src/lib/spice-podcast.ts` script shortened from 150–210
  words (60–90s) to 70–90 words (25–35s) — ~55% cheaper audio, measured.

### What's NOT done — the news session's to-do
1. **⚠️ AUDIO: 187 of 247 entries have NO audio yet.** `npm run spicecast`
   ran but **hit the SGD 15 monthly spend cap** partway (60 ready = the
   original ones; 187 failed `RESOURCE_EXHAUSTED / monthly spending cap`).
   To finish: raise the cap at https://ai.studio/spend on the **News Feed**
   project (id `gen-lang-client-0747120961`), or wait for the 1st-of-month
   PST reset, then re-run `npm run spicecast` (idempotent — only fills gaps;
   the shortened script keeps it cheap). Audio lives in Mongo `spice_podcast`.
2. **Commit the new audio** once generated (it's Mongo-stored, so nothing to
   git-commit for audio — just verify playback on /food).
3. **`daily:lanka` cron not wired on Railway** — optional now that all text is
   done; only needed if you add more catalogue items later.
4. **Railway `web` service `GEMINI_API_KEY` is the PAID key** (`...S1pQ`,
   billing-enabled) — REQUIRED because image+audio gen fail on free-tier keys
   (free tier is **text-only**; the `una5aha` free project returns 429 for any
   image/audio call). Keep it paid; monitor spend.

### Files: news-owned vs app-owned (avoid conflicts)
- **NEWS/shared (news session owns):** `spices.ts`, `serve-web.mjs` `/food`
  block, `gen-images.mjs`, `gen-food-content.mjs`, `spice-podcast.ts`,
  `run-spice-podcasts.mjs`, `seed-lanka-recipes.mjs`, `data/lanka-dishes-150.mjs`,
  `data/lanka-spices.mjs`, `data/lanka-bakery.mjs`, `web-assets/spices/`.
- **APP session keeps (do NOT edit from news):** `src/lib/app.mjs`,
  `src/lib/shop-suite.mjs`, `src/data/lanka-ingredients.mjs`,
  `src/data/currencies.mjs`, `ios-app/`. (The Kitchen-Stock ingredient list and
  the per-shop currency picker are app features that happen to reuse the same
  Sri Lankan food domain — but they're app code.)

---

**Purpose:** this document hands off the **news-feed side** of the repo to a
dedicated session. The *other* session keeps **app development** (the `/app`
marketplace + `ios-app/` iOS/Android). Both live in one repo and share the
router + infra, so read "Session boundary" below before editing.

Written 2026-07-11 after the country-AI feed + Telegram accounting watcher
shipped (commit `53585e6`, live).

---

## 1. Stack (the GK / ggmt trio)

| Layer | What | Notes |
|---|---|---|
| Repo | `Gaminigz/GK-Newsroom` (public) | remote **`ggmt`**; `origin` still points at yaikhsales — **push to `ggmt main`**. Run `gh auth switch --user Gaminigz` first. Push to `main` → Railway auto-deploys (~20s). |
| Local dir | `/Users/gamini/GK Dev/yai-newsroom` | |
| Mongo | Atlas `cluster0.rnuc0oz.mongodb.net`, user `admin_gsk`, **DB `gk_newsroom`** | working password is the one in `GDDE2026/server/.env`. `src/lib/mongo.ts` honors `MONGO_DB` env (defaults `yaikh` for the legacy stack — always set `MONGO_DB=gk_newsroom`). |
| Railway | project **gk-newsroom** | 2 services, both GitHub-connected to `Gaminigz/GK-Newsroom` `main`. |

**Railway services**
- **web** — `npm run web` → `src/scripts/serve-web.mjs`, config `railway.web.json`.
  URL: **https://web-production-2b43c.up.railway.app**. Reads Mongo, renders channels.
- **newsroom** — cron worker, `npm run daily`, config `railway.json`, schedule
  `0 22 * * *` UTC = **5 AM ICT**. Writes Mongo.

**Env vars** (Railway → web/newsroom → Variables): `MONGO_URI`, `MONGO_DB=gk_newsroom`,
`GEMINI_API_KEY`, `ADMIN_CODE` (admin 2FA, default 555555). Secrets never in git.

---

## 2. What the news feed is

Landing `/` shows three channels. News session owns the first two + `/admin`:

| Route | Page | Data (Mongo collection) |
|---|---|---|
| `/ai` | AI newsroom (daily brief + podcast streamer) | `ai_feed_items` |
| `/ai/world`, `/ai/country/XX` | **Per-country AI funding/startup/gov feed** (NEW) | `ai_country_items` |
| `/accounting` | Cambodia tax/business feed (gov sites **+ Telegram**) | `gov_feed_items` |
| `/food` | Spice channel (24 spices + mini-podcasts) | spice collections |
| `/admin` | Superadmin console (NewsRoom + Shop tabs) | — |
| `/podcast/*.wav` | audio | podcast collections |

---

## 3. The daily pipeline (`npm run daily`)

Runs in order; each stage is `(… || true)` so one failure never blanks the rest:

```
fetch → ai-countries → gov → telegram → govcast → podcast
```

| Stage | Script | Lib | Writes |
|---|---|---|---|
| `fetch` | `run-fetch.mjs` | `feed-fetch.ts` (+ `feed-rewrite`, `feed-image`) | `ai_feed_items` — 7 RSS AI feeds → Gemini rewrite/classify (brands/countries/topics) |
| `ai-countries` | `run-ai-countries.mjs` | `ai-country-fetch.ts` | `ai_country_items` — **Google News RSS**, per-country queries, no key |
| `gov` | `run-gov-fetch.mjs` | `gov-fetch.ts` (+ `data/gov-sources.ts`) | `gov_feed_items` — Cambodian gov **websites** → Gemini Khmer→EN |
| `telegram` | `run-telegram.mjs` | `telegram-fetch.ts` | `gov_feed_items` (`via:"telegram"`) — public **t.me/s** channels → Gemini Khmer→EN |
| `govcast` / `podcast` | `run-gov-podcast.mjs` / `run-podcast.mjs` | | audio episodes |

Run any stage alone: `npm run fetch` | `ai-countries` | `gov` | `telegram` | `daily`.

---

## 4. The two NEW features (built this session)

### 4a. Country AI feed — `ai-country-fetch.ts`
- For each of ~48 countries, queries **Google News RSS search** (`news.google.com/rss/search?q=…`, no key) with two topics: `funding` (`"<country> AI startup funding investment"`) and `government` (`"<country> government AI programme funding"`).
- Dedupes by URL → upserts `ai_country_items` `{ url, title, source, summary, country, iso, topic, publishedAt }`.
- `/ai/world` = grid of countries with counts (auto-grows — a country appears once it has news). `/ai/country/XX` = that country split into 💰 Funding & startups / 🏛 Government programmes.
- **Known limitation:** keyword search has some bleed (a global story can appear under a country). A Gemini relevance filter would tighten it. Google News RSS may rate-limit at higher volume.

### 4b. Telegram accounting watcher — `telegram-fetch.ts`
- **No Telegram app/account/bot/API key.** Reads each public channel's web page `https://t.me/s/<handle>` (plain HTTP), parses posts (text/date/url) + harvests cross-linked channels.
- Translates Khmer→English with Gemini (same pass as gov-fetch) → upserts `gov_feed_items` with `via:"telegram"`, `kind:"Telegram"`, `agency:<label>`, `channel:<handle>`. Shows on `/accounting` with a gold "Telegram" pill.
- **Self-growing watch-list** in `tg_channels` (`_id`=handle, `status`, `addedVia` seed/crawl, `title`, `postCount`). Seeds are idempotent-upserted each run; the crawl probes cross-linked channels and keeps on-topic public ones (cap `CHANNEL_CAP=60`).
- **Cost control:** only **new** posts (url not already in `gov_feed_items`) are sent to Gemini — repeated announcements resurface for free. `POSTS_PER_CHANNEL=5`, `MAX_TRANSLATE=100`/run.
- **Seed channels** (17, hand-picked, all posts ingested — filter bypassed for seeds): `acarcambodia, mefcambodia, mef_gdde, kicpaacambodia, gdtcambodianews, mocnewsfeed, online_business_registration, godigital_cambodia, indocham, MFAICNews, motgovkh, eVATPublic, AmChamCambodiaChannel, eurochameventchannel, BritChamCambodia, singaporeclubcambodia, b2basianews`.
- `302` from t.me/s = channel has no public web preview (e.g. a group like `gdthotnews`) → skip. `200` but 0 text posts (e.g. `motgovkh`) = media-only channel.

---

## 5. Open items / decisions for the news session

1. **6 newest seed channels not fetched yet** (`eVATPublic, AmChamCambodiaChannel, eurochameventchannel, BritChamCambodia, singaporeclubcambodia, b2basianews`) — added to the seed list & deployed, but their first fetch was deferred to save Gemini cost. They populate on the next 5 AM cron, or run `npm run telegram` once.
2. **Seed topic filter (tradeoff):** seeds currently ingest *all* posts, so general gov posts (MFAIC "retiree dinner", tourism) appear alongside tax/accounting. To tighten `/accounting` to finance-only, apply `isRelevant()` to seeds too (remove the `isSeed` bypass in `telegram-fetch.ts`).
3. **Country feed relevance:** optionally add a Gemini pass to drop off-country bleed.
4. **Secrets rotation pending** (from setup): Mongo password + Gemini key appeared in earlier screenshots/CLI echoes — rotate before wider launch.
5. **Admin 2FA** is bypassed (`ADMIN_CODE` path) — re-enable for production.

---

## 6. Local dev + gotchas

- Always: `set -a && source .env && set +a` before any script — **scripts do NOT auto-load `.env`** (they die at the Mongo/Gemini step otherwise).
- Serve locally: `MONGO_DB=gk_newsroom PORT=8791 npx tsx src/scripts/serve-web.mjs` (uses `tsx`; `mongo.ts` is TypeScript — plain `node` can't import it).
- **`npx tsx -e "…top-level await…"` fails** ("cjs output") — write a scratch `.mts` file and run that instead.
- **Never commit `pnpm-lock.yaml` / `pnpm-workspace.yaml`** — a stray pnpm workspace file breaks Railway's Nixpacks build (excluded via `.railwayignore`; they show as untracked — leave them).
- Deploy: `gh auth switch --user Gaminigz` → `git push ggmt main` → verify with `curl` on the live URL.

---

## 7. Session boundary (important — shared files)

- **NEWS session (this handover):** `/ai`, `/ai/world`, `/accounting`, `/food`, `/admin` rendering + all pipeline libs/scripts in §3. 
- **APP session (the other one):** `/app` marketplace (`src/lib/app.mjs`), `ios-app/` Capacitor project, App Store / Android. *(Context: the "3una 5aha" iOS app is **submitted, Waiting for Review**; its map is served from `/app` — the webview map fix in this commit is app-facing but lives in `app.mjs`/`serve-web.mjs`.)*
- **SHARED — coordinate to avoid conflicts:** `src/scripts/serve-web.mjs` (the router mounts both `/admin`, `/app`, and all channel pages) and `src/lib/mongo.ts`. Both sessions edit `serve-web.mjs`; pull before editing, keep changes in separate route blocks.

## 8. Related docs
- `MARKETPLACE_BLUEPRINT.md` — the `/app` marketplace rebuild spec (app session).
- `ios-app/APP_STORE.md`, `ios-app/AUTH_SETUP.md` — iOS submission + login setup (app session).
- Auto-memory `gk-newsroom-stack` (loads every session) — the one-paragraph version of §1.
