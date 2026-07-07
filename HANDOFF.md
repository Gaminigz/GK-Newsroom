# HANDOFF — read this first, every new Claude session

> Written 2026-07-07 by the previous session. If any fact here contradicts
> the code, **trust the code and update this file**.

## The one-paragraph picture

You are working on **`yaikhsales/yai-newsroom`** — a CLI-first Node/TypeScript pipeline that fetches Ai news, rewrites it in the Yai voice with Gemini, stores everything in a shared MongoDB Atlas cluster, generates a daily podcast, and (via an Android-emulator posting rig) posts to TikTok + YouTube Shorts on the Yai channels. The public marketing site **`yaikhsales/homepage`** reads the same Mongo DB to render `/ai-feed` and stream the podcast — do **not** duplicate pipeline logic there. The seam is Mongo.

## The three production lanes

| Lane | Owner | URL |
|---|---|---|
| **This repo** — CLI pipeline | runs locally on the user's Mac (not deployed) | https://github.com/yaikhsales/yai-newsroom |
| **`yaikhsales/homepage`** — marketing site | Railway (`robust-hope / production`) | https://yaikh-com-production.up.railway.app / https://yaikh.com |
| **MongoDB Atlas** — the seam | Atlas project **Project 0** in TEXLINK org | cluster `yaikhhomepage`, DB `yaikh` |

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
- ✅ YouTube Shorts via Veo (AI Playground → Create video from a prompt), with music picked from the "epic cinematic" search (row 3 = "Epic Cinematic Dramatic Adventure Trailer", 157K uses), music ducked to 25%, **Pop filter for sharpness** (the only sharpness-boosting filter — Retro/Dreamy/Soft all reduce sharpness), big bold text overlay at the top, uploaded

## The proven emulator recipe (repeat exactly)

Set-up done once per AVD:
1. AVD name: `yai-tik` (Pixel 7, Play-Store image, 6 GB RAM, 8 GB storage)
2. `adb install ADBKeyBoard.apk` and `adb shell ime set com.android.adbkeyboard/.AdbIME`
3. Log into TikTok (`@yaikh2025`) and YouTube (`gaminiai2025@gmail.com`) once, manually

Per-post:
1. `source src/scripts/yt-routine.sh`
2. `yt_veo_prompt "your visual prompt..."` — waits ~60s for Veo to generate
3. `yt_pipeline "$'overlay text\\nline 2\\n\\nyaikh.com/ai-feed'" "caption with #yai #yaikh #Claude #ai"`

Caption cap on YouTube Shorts is **100 characters**. Never exceed it — the Upload button greys out and it's easy to miss.

## What is NOT yet built (in priority order)

1. **Video renderer for YouTube from a static image** — currently Veo generates from a prompt each time. Faster/cheaper alternative: ffmpeg over the daily rendered photo + a 30-second slice of the podcast audio. See `scripts/render-brief-photo.mjs` for the photo half.
2. **Facebook Reels posting** — Meta Graph API works but the Yai account needs a Page (not a personal profile). Approach: mirror `yt-routine.sh` but drive the FB app.
3. **Cron / schedule** — everything runs manually today. `launchd` plist (Mac) or GitHub Actions (cloud) would let it run daily without user interaction. Emulator part still needs a machine to be up.
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
