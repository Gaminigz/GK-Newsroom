# yai-newsroom

The Yai Ai newsroom pipeline — end-to-end tooling that turns a handful of RSS feeds into the daily Ai brief you see on **[yaikh.com/ai-feed](https://yaikh.com/ai-feed)**, the podcast that streams from the site, and the social-media posts that go out on the Yai TikTok + YouTube channels.

**One shared Mongo DB** (Atlas cluster `yaikhhomepage`, DB `yaikh`) is the seam:
- This repo **writes** to it (fetch → rewrite → store · seed static series · generate podcast).
- The [yaikhsales/homepage](https://github.com/yaikhsales/homepage) marketing site **reads** from it (renders `/ai-feed`, serves the floating podcast player).
- The Android-emulator posting rig (also in `src/scripts/`) reads today's stories from Mongo and drives TikTok / YouTube through their apps.

## What it does

1. **Fetches** 7 RSS feeds: OpenAI blog, Google DeepMind, TechCrunch AI, Ars Technica, Wired AI, QbitAI (量子位), 36Kr.
2. **Rewrites** every headline in the Yai voice using **Gemini 2.5 Flash** — translates Chinese input to English in the same pass; classifies each story by brand / country / topic.
3. **Extracts images** — RSS media → article `og:image` scrape → a branded fallback tile if both fail.
4. **Archives** every enriched item into MongoDB (`ai_feed_items`) keyed by URL so re-runs are idempotent.
5. **Seeds a curated series** — 12 episodes of Yai Ai History and 47 model-timeline entries across 8 major labs (OpenAI, Anthropic, Google, Meta, xAI, Mistral, DeepSeek, Alibaba).
6. **Generates a daily podcast** — Gemini writes a two-host dialogue between Dara & Maly, then `gemini-2.5-flash-preview-tts` renders it as one multi-speaker audio; the WAV lands in Mongo (`ai_feed_podcast`).
7. **Renders social assets** — a 1080×1920 branded photo of today's top stories for TikTok / IG story usage.
8. **Drives TikTok + YouTube** — `yt-routine.sh` is a human-paced ADB helper that logs into an Android emulator and does everything real hands would do (search cinematic music, duck to 25%, Pop filter, text overlay, caption, upload).

## Prerequisites

- Node **20+**
- MongoDB Atlas access — cluster `yaikhhomepage` (shared with yaikh.com; do not spin up a new cluster)
- A Google AI Studio key on a project with the Free Trial credit — see `.env.example`
- For the posting rig only: Android Studio + a Pixel 7 AVD (`yai-tik`) with the Play-Store image, TikTok + YouTube installed, ADBKeyBoard IME installed & selected

## Setup

```bash
git clone git@github.com:yaikhsales/yai-newsroom.git
cd yai-newsroom
npm install
cp .env.example .env
# edit .env — fill in MONGO_URL and GEMINI_API_KEY
npm run ping           # sanity check: should print { ok: true, ms: N }
```

## Usage

```bash
# Populate today's news (RSS → rewrite → Mongo). 1 minute, ~$0.005 in Gemini calls.
npm run fetch

# Generate today's ~3-min podcast episode. 1–2 minutes, ~$0.60 in TTS calls.
npm run podcast
# Re-generate an existing episode:
npm run podcast -- --force

# Seed the 12 History + 47 Timeline items. Only needed once per prod DB
# (or after --rewrite when you edit src/data/*.ts).
npm run seed
npm run seed:rewrite    # regenerate all series items in place

# Render the daily 9:16 branded photo (for TikTok photo-post mode).
npm run photo -- ./out/brief.png
```

## Repository layout

```
src/
├── lib/
│   ├── mongo.ts              MongoClient singleton
│   ├── feed-fetch.ts         RSS aggregator + Mongo archiver
│   ├── feed-rewrite.ts       Gemini batched rewrite/translate/classify
│   ├── feed-image.ts         og:image scraper + fallback tile
│   └── podcast.ts            Dara & Maly script + TTS + Mongo store
├── data/
│   ├── history-episodes.ts   12 curated Yai Ai History seeds
│   ├── model-timelines.ts    47 model releases (8 labs) with "best for" lines
│   └── ai-players.ts         Metadata for the "Major Ai Players" strip
└── scripts/
    ├── run-fetch.mjs         `npm run fetch`
    ├── run-podcast.mjs       `npm run podcast`
    ├── seed-history-and-timelines.mjs   `npm run seed`
    ├── render-brief-photo.mjs           `npm run photo`
    ├── lib-brand-tiles.mjs   Real brand-logo SVGs (Anthropic, Google, etc.)
    └── yt-routine.sh         `source` this from a scratchpad — helpers for
                              the Android emulator posting rig
```

## Shared Mongo collections

| Collection        | Owner (writes)           | Reader                       | Notes |
|-------------------|--------------------------|------------------------------|-------|
| `ai_feed_items`   | this repo                | yaikh.com/ai-feed            | 1 doc per story; also holds the curated History+Timeline series |
| `ai_feed_podcast` | this repo                | yaikh.com/api/ai-feed/podcast/audio | 1 doc per day; audio stored as BSON Binary |

Never rename these collections or the marketing site's reader breaks silently.

## Costs (with today's usage pattern)

- Feed fetch (rewrite pass on ~40 items): ~$0.005/day
- Podcast (script + ~150s TTS):            ~$0.60/day
- Total ≈ **$0.61/day, ≈ $18/month**. Free Trial credit covers >18 months.

## Related repos

- **[yaikhsales/homepage](https://github.com/yaikhsales/homepage)** — the marketing site + `/ai-feed` reader UI + floating podcast player. Deployed to Railway (`robust-hope / production` env). Do NOT copy pipeline code back into it; keep the seam at Mongo.

## License

Private — Texlink Technologies Co., Ltd. All rights reserved.
