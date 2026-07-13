# GK Newsroom — session handover

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
