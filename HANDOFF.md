# HANDOFF — read this first, every new Claude session

> Written 2026-07-07 by the previous session. If any fact here contradicts
> the code, **trust the code and update this file**.

## ✅ RESOLVED (2026-07-08): Railway `gk-newsroom` deploy is live

Fixed by the user's local desktop session via Railway CLI (`railway up`):
service **newsroom** in project **gk-newsroom** (GK SMART's Projects,
`gamini@ggmt.sg`) is ACTIVE, unexposed, US West, with the Cron Runs tab
present — cron `0 22 * * *` UTC (5 AM ICT) picked up from `railway.json`.

## ✅ RESOLVED (2026-07-08): web reader deployed — https://web-production-2b43c.up.railway.app

Deployed by the local desktop session via `railway up` (service **web** in
project gk-newsroom, staged copy with `railway.web.json` as the active
`railway.json`, vars `MONGO_URL` + `MONGO_DB=gk_newsroom`). Verified live:
`/healthz` → `{"ok":true}`, `/` renders today's stories, and
`/podcast/latest.wav` → 200 (7.6 MB) after fixing `latestReadyDate()` in
`serve-web.mjs` — `listEpisodes()` returns `{date}`, never `dateKey`/`_id`,
so latest always resolved null → 404. The 2026-07-08 pipeline run was
executed locally (`npm run daily` with `.env` sourced — the scripts do NOT
auto-load `.env`; a bare `npm run daily` dies at the Mongo step): 35 items
+ the podcast episode landed in `gk_newsroom`. First unattended cron run
still unverified (follow-up 1). Original steps kept for reference:

1. Check your access: is `RAILWAY_TOKEN` in env and can you reach
   `backboard.railway.com`? Test:
   `curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $RAILWAY_TOKEN" -H 'Content-Type: application/json' -d '{"query":"query { me { email } }"}'`
   → expect `gamini@ggmt.sg`.
2. If YES — via GraphQL API (or `npm i -g @railway/cli`): in project
   **gk-newsroom** (id `78f4810c-8e60-49ee-8e14-2ee6036308ec`, env
   `da9be3c8-...`) create a SECOND service from GitHub repo
   `Gaminigz/GK-Newsroom`, branch `claude/git-review-ja0lpn`, with config
   file path `railway.web.json` (NOT the root railway.json — that's the
   cron worker's). Set service variables `MONGO_URL` (from env),
   `MONGO_DB=gk_newsroom`. Create a service domain (`serviceDomainCreate`).
3. Verify: GET `https://<domain>/healthz` → `{"ok":true}`, then `/` renders
   real stories. Only then give the user the URL and record it HERE.
4. If NO access — tell the user plainly that the environment settings
   (RAILWAY_TOKEN + Full network) didn't save, and fall back to the local
   desktop session route (it has a logged-in Railway CLI).

**Web reader summary:** `npm run web` / `src/scripts/serve-web.mjs` is the
public shareable feed page (news + series + podcast player). Routes: `/`,
`/podcast/latest.wav`, `/podcast/YYYY-MM-DD.wav`, `/healthz`.

Follow-ups still open:
1. **Verify first cron run writes to Mongo** — after 5 AM ICT check
   `gk_newsroom.ai_feed_items` for today-dated docs and `ai_feed_podcast`
   for today's `_id`.
2. **`railway up` deploys the local folder, not GitHub** — the service is
   likely NOT linked to the repo, so `git push` won't auto-deploy. To fix:
   service Settings → Source → connect `Gaminigz/GK-Newsroom`, branch
   `claude/git-review-ja0lpn` (or main after merge).
3. **Rotate secrets** — the Mongo password and Gemini key appeared in
   screen captures during setup. Rotate both (Atlas → Database Access;
   AI Studio → new key), then update Railway variables + local `.env`.

Original task notes kept below for context.

### (archived) ACTIVE TASK (2026-07-08): fix the Railway `gk-newsroom` deploy

State when the last session ended:

- Railway account **GK SMART's Projects** (`gamini@ggmt.sg`, Hobby) already has a
  project **`gk-newsroom`** showing **0/1 services online** — almost certainly
  because it deploys a branch with no start command. The fix is committed on
  branch **`claude/git-review-ja0lpn`**: `railway.json` (startCommand
  `npm run daily`, cron `0 22 * * *` UTC = 5 AM ICT, restartPolicy NEVER) plus
  a `daily` npm script and `tsx` moved to production dependencies.
- The user created a Railway account API token (`claude-code`) and was setting
  the Claude environment to **Full network access** with env vars
  `RAILWAY_TOKEN`, `MONGO_URL`, `GEMINI_API_KEY`. If those are present in your
  container, YOU have Railway API access — do not ask the user to click.

What to do (in order):

1. Verify access: `curl -s https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer $RAILWAY_TOKEN" -H 'Content-Type: application/json' -d '{"query":"query { me { email } }"}'` — expect `gamini@ggmt.sg`.
2. Via the GraphQL API (or `npm i -g @railway/cli` + `RAILWAY_TOKEN` env):
   find project `gk-newsroom` → its service → set source branch to
   `claude/git-review-ja0lpn`, set service variables `MONGO_URL`,
   `MONGO_DB=gk_newsroom`, `GEMINI_API_KEY`, confirm cron from railway.json.
3. Trigger a deploy, tail the logs. Success = `fetched N items` then
   `done: {...}` then clean exit. "No open ports" warnings are normal (cron
   worker, no HTTP server).
4. Verify data: connect with `MONGO_URL` to DB `gk_newsroom`, check
   `ai_feed_items` has docs dated today and `ai_feed_podcast` has today's
   `_id`. Only then tell the user it works.
5. Update this section (or delete it) when done.

## The one-paragraph picture

You are working on **`yaikhsales/yai-newsroom`** — a CLI-first Node/TypeScript pipeline that fetches Ai news, rewrites it in the Yai voice with Gemini, stores everything in a shared MongoDB Atlas cluster, generates a daily podcast, and (via an Android-emulator posting rig) posts to TikTok + YouTube Shorts on the Yai channels. The public marketing site **`yaikhsales/homepage`** reads the same Mongo DB to render `/ai-feed` and stream the podcast — do **not** duplicate pipeline logic there. The seam is Mongo.

## The three production lanes

| Lane | Owner | URL |
|---|---|---|
| **This repo** — CLI pipeline | GK stack: `Gaminigz/GK-Newsroom` on GitHub; daily cron on Railway (**GK SMART's Projects**, `gamini@ggmt.sg`, Hobby) — see `railway.json`. Also runs locally on the user's Mac. | https://github.com/Gaminigz/GK-Newsroom |
| **`yaikhsales/homepage`** — marketing site (legacy yaikh stack) | Railway (`robust-hope / production`) on the yaikh account — GK reader-side fork NOT done yet | https://yaikh-com-production.up.railway.app / https://yaikh.com |
| **MongoDB Atlas** — the seam | GK stack: `gamini@ggmt.sg` Atlas account | cluster `Cluster0` (`cluster0.rnuc0oz.mongodb.net`), DB `gk_newsroom` |

## Auth accounts

- **GitHub for this org:** `yaikhsales` (the `gamini@yaikh.com` account). Set active with `gh auth switch --user yaikhsales` **every time** — the active account drifts back to `Gaminigz` between commands, which has no push permission on org repos.
- **Google Cloud project:** "Default Gemini Project" (Tier-1 billing, Free Trial credit still active). The API key in the user's `.env` is minted there.
- **TikTok:** `@yaikh2025` (display "Texlink"). Logged into the AVD.
- **YouTube:** channel "AiOT GKSMART" (`@AioT-b2r`, 14 subs). Community-post tab is NOT enabled — needs 500 subs.

## The user's collaboration style — DO NOT VIOLATE

- **Do not ask clarifying questions when you can act.** The user has repeatedly asked to be left alone to review the output. When two paths exist, pick the higher-value one and move.
- **Verify before you say something works.** Never claim "posted" or "live" without checking with a screenshot or an HTTP probe. The user has caught this multiple times.
- **Short replies.** Terse status updates > paragraphs.
- **Brand spelling: `Ai`, not `AI`.** In prose, code, prompts, and overlays. Model-family names (GPT, Claude, Gemini) keep official spelling.

## The MongoDB collections you'll touch

| Collection | Doc shape (key fields) | Written by | Read by |
|---|---|---|---|
| `ai_feed_items` | `_id` = story URL (news) or seed id (series); `series?: "history"\|"timeline"`; `seriesEpisode`, `seriesBrand`, `seriesVersion`; `brands[]`, `countries[]`, `topics[]`; `image` (data-URI SVG for series, real URL for news); `publishedAt`; `title`, `summary`, `originalTitle` | `run-fetch.mjs`, `seed-history-and-timelines.mjs` | yaikh.com `/ai-feed` (via `lib/ai-feed.ts` in the homepage repo) |
| `ai_feed_podcast` | `_id` = "YYYY-MM-DD"; `status: "ready"\|"generating"\|"failed"`; `audio` (BSON Binary WAV, 24 kHz mono 16-bit); `script`; `durationSec`; `stories[]` | `run-podcast.mjs` | yaikh.com `/api/ai-feed/podcast/audio` |

Never rename or restructure these collections without also patching the homepage repo.

## What's already working end-to-end

- ✅ RSS ingest (5 Western + 2 Chinese sources)
- ✅ Gemini rewrite + Chinese→English translation in one pass
- ✅ Brand/country/topic classification
- ✅ og:image scrape + fallback tiles with real brand logos (Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Alibaba, Nvidia via SimpleIcons paths — OpenAI has a designed word lockup because SimpleIcons dropped their mark)
- ✅ 12 History + 47 Timeline items seeded and rendering on `/ai-feed` with `📚 Yai History · EPn` and `🕰 Timeline · Brand` pills. History is sorted EP1→EP12 at the bottom of the feed so the filter chip always shows a clean sequence.
- ✅ Daily podcast (Dara + Maly two-speaker, `gemini-2.5-flash-preview-tts`, Puck + Kore voices) storing WAV in Mongo
- ✅ TikTok text-post via Android emulator, both English and Khmer (ADBKeyBoard IME for Unicode via `am broadcast -a ADB_INPUT_B64 --es msg <base64>`)
- ✅ YouTube Shorts via YouTube's **free in-app Shorts Ai create feature** (AI Playground → Create video from a prompt — free in-app generation of video or music, NOT a Veo/Gemini API call, costs us nothing), with music picked from the "epic cinematic" search (row 3 = "Epic Cinematic Dramatic Adventure Trailer", 157K uses), music ducked to 25%, **Pop filter for sharpness** (the only sharpness-boosting filter — Retro/Dreamy/Soft all reduce sharpness), big bold text overlay at the top, uploaded

## The proven emulator recipe (repeat exactly)

Set-up done once per AVD:
1. AVD name: `yai-tik` (Pixel 7, Play-Store image, 6 GB RAM, 8 GB storage)
2. `adb install ADBKeyBoard.apk` and `adb shell ime set com.android.adbkeyboard/.AdbIME`
3. Log into TikTok (`@yaikh2025`) and YouTube (`gaminiai2025@gmail.com`) once, manually

Per-post:
1. `source src/scripts/yt-routine.sh`
2. `yt_veo_prompt "your visual prompt..."` — waits ~60s for YouTube's free Ai create to generate
3. `yt_pipeline "$'overlay text\\nline 2\\n\\nyaikh.com/ai-feed'" "caption with #yai #yaikh #Claude #ai"`

Caption cap on YouTube Shorts is **100 characters**. Never exceed it — the Upload button greys out and it's easy to miss.

## What is NOT yet built (in priority order)

1. **Video renderer for YouTube from a static image** — currently YouTube's free in-app Ai create generates from a prompt each time. Faster/cheaper alternative: ffmpeg over the daily rendered photo + a 30-second slice of the podcast audio. See `scripts/render-brief-photo.mjs` for the photo half.
2. **Facebook Reels posting** — Meta Graph API works but the Yai account needs a Page (not a personal profile). Approach: mirror `yt-routine.sh` but drive the FB app.
3. **Cron / schedule** — ✅ Railway cron service (GK account, `gamini@ggmt.sg`): `railway.json` runs `npm run daily` (fetch → podcast) at 22:00 UTC = 5:00 AM ICT. Costs ~$0.61/day in Gemini calls per run — change `startCommand` to `npm run fetch` if podcast should stay manual. Emulator posting part still needs a machine to be up (not cron-able on Railway).
4. **The floating "Winamp-style" podcast player** on yaikh.com is done in the homepage repo — no work here.

## Gotchas we've already paid for — do NOT re-debug

- **`adb shell input text` mangles multi-byte characters** (Khmer, Chinese, emoji). Always use ADBKeyBoard's `ADB_INPUT_B64` intent for anything non-ASCII.
- **YouTube Shorts caption ≤ 100 chars.** Longer captions grey out the Upload button.
- **YouTube compression softens small text.** Overlays must be BIG (3–4 words per line) or they turn to mush after transcode.
- **Community posts need 500+ subscribers.** The @AioT-b2r channel doesn't have them yet; text-only YT posts aren't an option — must be video.
- **OpenAI's SimpleIcons mark was removed for trademark.** Timeline tiles for OpenAI use a designed word lockup (see `lib-brand-tiles.mjs`).
- **`gh` active account drifts** back to Gaminigz. Prepend every push with `gh auth switch --user yaikhsales`.
- **Zsh doesn't word-split unquoted `$var`** the way bash does. `htap()` in `yt-routine.sh` handles both single-arg and two-arg forms because of this.
- **Podcast script uses `thinkingConfig: { thinkingBudget: 0 }`** — without it, Gemini 2.5 Flash burns the `maxOutputTokens` budget on invisible thinking tokens and produces a truncated 52-word script instead of the full 390-word 3-minute episode.

## Cost reality (as of July 2026)

- Per fetch (~40 items rewritten): **~$0.005**
- Per podcast (150s TTS): **~$0.60**
- Daily total: **~$0.61 · monthly: ~$18**
- Free Trial credit ($354 total; ~$347 remaining at handoff) covers ~18 months at this cadence.
- The larger Google Cloud "GenAI App Builder" credit ($1,276) can NOT be spent on plain Gemini calls — it's reserved for Vertex AI Agent Builder / Search. Leave it alone until we migrate the PA chat agents.

## Where to find the display side

- Marketing site + `/ai-feed` reader: **`yaikhsales/homepage`** repo, path `yaikh-com/app/ai-feed/`.
- If a feed-render change needs a matching UI change (new field on `ai_feed_items`, new pill style, etc.), coordinate the two repos — this repo writes the field, the homepage repo reads it in `lib/ai-feed.ts`'s `fetchAllSeries()` and displays it in `FeedList.tsx`'s `FeedCard`.
