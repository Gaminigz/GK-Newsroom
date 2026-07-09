# DESKTOP-TASKS — the Mac ↔ cloud message bus

Cloud Claude sessions push tasks here; the desktop Claude session picks
them up, executes with its normal permissions, flips each to
`DONE <date> — <result summary>` (or `FAILED — <why>`), commits + pushes.

> NOTE (2026-07-09, desktop session): the launchd auto-agent
> (`desktop-agent.sh --install`, unattended `--dangerously-skip-permissions`
> every 30 min) was reviewed and NOT installed — unattended permission-less
> execution + spending is a bad trade. The file-based queue still works:
> the desktop session processes it whenever it runs. For most tasks cloud
> sessions should self-serve via the claude.ai env vars (RAILWAY_TOKEN,
> MONGO_URL, GEMINI_API_KEY) instead of queuing here.

Rules for the executing agent:
- Work top to bottom. One task at a time. Never re-run a DONE task.
- Don't ask questions — pick the sensible option and proceed.
- After each task, update this file, commit ("agent: <task> done") and push.
- Costs are pre-approved if stated in the task.

---

## TASK 1 — DONE 2026-07-09 — desktop session: 24 spice photos + 2 tiles + GK Drive logo generated (model fixed: imagen-3.0 → imagen-4.0-generate-001, the only Imagen this key offers), committed cc7a927, auto-deployed.
Generate all site imagery: `npm run genimages` (Gemini Imagen: 24 spice
photos + 2 tile icons + GK logo from Drive; ~$1, pre-approved). If the
Drive download fails, note it here and continue — the SVG fallback covers
the tile. Then `git add src/web-assets && git commit && git push`.

## TASK 2 — DONE 2026-07-09 — 12 History + 47 Timeline in gk_newsroom (seed script had hardcoded db 'yaikh' — fixed in c1c962d; docs copied over).
Seed the curated series: `npm run seed`. Verify it reports 12 History +
47 Timeline items into the gk_newsroom database.

## TASK 3 — PARTIAL 2026-07-09 — `npm run gov` ran: GDT ✓ 8 posts (live on /accounting). Failed 6: ACAR (Gemini JSON truncated — likely needs bigger maxOutputTokens), MEF 403, GDCE 404, NA 403 (need different URLs or headers), MoC + MoI (pages load, 0 posts extracted — selectors/URL wrong). CLOUD SESSION: research correct news URLs, fix src/data/gov-sources.ts + the ACAR truncation, push to MAIN (auto-deploys; cron uses it next 5 AM).
First government fetch: `npm run gov`. Record the per-agency counts here.
For any agency erroring or extracting 0 posts, find the right news URL on
that ministry's site, fix `src/data/gov-sources.ts`, re-run, commit.

## TASK 4 — DONE 2026-07-09 — `npm run spicecast`: 24/24 ready, 0 failed (56–76s each, Dara & Maly, stored in Mongo).
Spice mini-podcasts: `npm run spicecast` (~$8 TTS one-time, pre-approved;
skips existing). Record the ✓/✗ list here.

## TASK 5 — DONE 2026-07-09 — BOTH services GitHub-connected to branch **main** (not the claude/* branch — merge to main to deploy). web: railway.web.json ✓, cron: railway.json ✓. Push-to-main → build verified ~20s.
Railway wiring: confirm BOTH gk-newsroom services deploy from GitHub repo
Gaminigz/GK-Newsroom branch claude/git-review-ja0lpn — web service with
config `railway.web.json`, cron worker with default `railway.json`. Fix
via Settings → Source if either is still a CLI snapshot.

## TASK 6 — PENDING
Verify live at https://web-production-2b43c.up.railway.app — landing has
the GK logo + generated icons; /food shows photos + working Listen pills;
/ai shows History/Timeline cards; /accounting shows translated posts.
Note anything broken here.
