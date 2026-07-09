# DESKTOP-TASKS — the Mac ↔ cloud message bus

Cloud Claude sessions push tasks here; the Mac's auto-agent (launchd →
`src/scripts/desktop-agent.sh`) pulls every 30 minutes and executes any
task marked `PENDING`, then flips it to `DONE <date> — <result summary>`
(or `FAILED — <why>`) and commits + pushes this file back.

Rules for the executing agent:
- Work top to bottom. One task at a time. Never re-run a DONE task.
- Don't ask questions — pick the sensible option and proceed.
- After each task, update this file, commit ("agent: <task> done") and push.
- Costs are pre-approved if stated in the task.

---

## TASK 1 — PENDING
Generate all site imagery: `npm run genimages` (Gemini Imagen: 24 spice
photos + 2 tile icons + GK logo from Drive; ~$1, pre-approved). If the
Drive download fails, note it here and continue — the SVG fallback covers
the tile. Then `git add src/web-assets && git commit && git push`.

## TASK 2 — PENDING
Seed the curated series: `npm run seed`. Verify it reports 12 History +
47 Timeline items into the gk_newsroom database.

## TASK 3 — PENDING
First government fetch: `npm run gov`. Record the per-agency counts here.
For any agency erroring or extracting 0 posts, find the right news URL on
that ministry's site, fix `src/data/gov-sources.ts`, re-run, commit.

## TASK 4 — PENDING
Spice mini-podcasts: `npm run spicecast` (~$8 TTS one-time, pre-approved;
skips existing). Record the ✓/✗ list here.

## TASK 5 — PENDING
Railway wiring: confirm BOTH gk-newsroom services deploy from GitHub repo
Gaminigz/GK-Newsroom branch claude/git-review-ja0lpn — web service with
config `railway.web.json`, cron worker with default `railway.json`. Fix
via Settings → Source if either is still a CLI snapshot.

## TASK 6 — PENDING
Verify live at https://web-production-2b43c.up.railway.app — landing has
the GK logo + generated icons; /food shows photos + working Listen pills;
/ai shows History/Timeline cards; /accounting shows translated posts.
Note anything broken here.
