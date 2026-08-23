# Session handover — binding, git, Mongo, Railway

Written 2026-08-23 by the News Feed session ("3 5 News Feed ggmt.sg"),
after browser control failed on every attempt. Read this first in the
fresh session.

---

## 1. Browser binding — the unresolved problem

**Symptom:** every `claude-in-chrome` call fails, on every site, in every
browser:

```
navigate  → "Navigation to this domain is not allowed"
screenshot→ "Permission denied for this action on this domain"
read_page → "Permission denied for reading pages on this domain"
```

This includes neutral sites (`example.com`, `google.com`) — so it is NOT
the Meta blocklist, and NOT a site-specific restriction.

**What was already ruled out (don't repeat this work):**

| Tried | Result |
|---|---|
| `switch_browser` + Connect + naming, several times | Connects, reports a name — still fails |
| `select_browser` on ALL 3 deviceIds individually | All 3 fail identically |
| Fresh tabs / fresh tab groups | No change |
| Chrome Developer mode | Already ON |
| Claude extension health | v1.0.85, enabled, service worker running, "On all sites", all permissions granted |
| Other Claude sessions, same machine/browsers/account | **Work fine** |

**Conclusion:** the fault is this *session's* binding, not the browser,
not the extension, not the account. The one untested fix is a session
restart — hence this handover.

**Likely cause (unconfirmed):** this session was running as a *sidebar
panel inside* the Chrome window it was trying to drive (tab titled
"3 5 News Feed ggmt.sg / GK Dev"). Driving the browser you are hosted in
may be what's refused. If the fresh session is started from a terminal
rather than the in-browser panel, that would explain a fix.

**First thing to do in the new session:**
```
navigate → https://example.com   then screenshot
```
If that works, binding is healthy. If it still fails, the problem is
deeper than session lifetime and worth reporting as a bug.

### The "glow"
The Claude Chrome extension outlines tabs it currently controls with a
glowing border (orange/teal). Glow = "Claude is driving this tab". No
glow for this session = confirmation nothing was getting through.

### Blocked domains (true for ALL sessions, not a binding issue)
- **web.whatsapp.com** — navigation refused outright.
- **facebook.com** — navigation works, but reading page content is
  refused.
- Both are Meta properties on the automation blocklist. Independently
  reproduced by the peer session. **Browser automation cannot capture
  WhatsApp content — don't design around it.** WhatsApp Business API is
  the legitimate path if automated order capture is wanted.
- **railway.com** — also refused navigation for this session (use the
  CLI instead, which works fine).

### Two different browsers — don't confuse them
- `mcp__claude-in-chrome__*` → the user's **real Chrome**, has all their
  logins, shows the glow. **Broken for this session.**
- `mcp__Claude_Browser__*` → a **sandboxed in-app browser**. Works
  perfectly, but has NO user logins and never glows. Fine for public
  research; useless for anything needing an account.

---

## 2. Git

- **Repo:** `/Users/gamini/GK Dev/yai-newsroom`
- **Push remote:** `ggmt` → `https://github.com/Gaminigz/GK-Newsroom.git`
- `origin` → `yaikhsales/yai-newsroom` (legacy, do not push here)
- **Branch:** `main`
- ⚠️ **Always run `gh auth switch --user Gaminigz` before pushing** —
  auth drifts to `yaikhsales` and pushes 403.
- Push to `main` auto-deploys on Railway.

## 3. Mongo

**Primary (live, everything runs on this):**
- Atlas cluster `cluster0.tt0e2hg.mongodb.net`, user
  `gaminios2023_db_user`, DB **`gk_newsroom`**
- Full connection string is in `.env` as `MONGO_URL` (gitignored — never
  commit it)
- Single shared `MONGO_URL` serves BOTH the newsroom and the 3una5aha
  shop app. No split, no second connection anywhere in the code.
- **512MB M0 free-tier cap has caused live outages twice.** Podcast audio
  stored as BSON binary is what fills it. See
  `NEWSROOM_HANDOVER.md` for the incident history.
- Local DNS quirk: if `querySrv EREFUSED` appears, set DNS servers in the
  script — `dns.setServers(['8.8.8.8','1.1.1.1'])` before connecting.

**Overflow tier (deployed, NOT yet usable):**
- A **MongoDB Community** service now runs in the same Railway project
  (`● Online`, volume `mongodb-volume`).
- Its `MONGO_URL` is `mongodb://mongo:***@mongodb.railway.internal:27017`
  — **private network only**, unreachable from a laptop.
- A public URL appears in `railway status`
  (`mongodb-production-1a51.up.railway.app`) but **there is no TCP proxy
  provisioned**, so it is not a working Mongo endpoint. Verified.
- **To use it:** Railway dashboard → MongoDB service → Settings →
  Networking → **TCP Proxy** (not "Generate Domain"/"Custom Domain" —
  those are for HTTP). That yields a `host:port` that works externally.
- Intended design (Gamini's): Atlas stays the hot tier for
  most-touched data; cold/overflow data (podcast audio first) moves to
  this Community server. Selective tiering — native `mongosync` is the
  wrong tool, it mirrors everything.

## 4. Railway

- **Workspace:** GK SMART's Projects
- **Project:** `gk-newsroom` — `78f4810c-8e60-49ee-8e14-2ee6036308ec`
- **Environment:** production — `da9be3c8-c86a-49dd-8c03-216fb4636368`
- **Services:**
  - `web` — the site, `https://ecom.ggmt.sg`, service ID
    `45d90154-563f-43db-9261-c98cabe8d619`
  - `newsroom` — daily cron worker (`npm run daily`, 0 22 * * * UTC)
  - `MongoDB` — the Community overflow server (see above)
- **CLI works fine** (`railway variables`, `deployment list`, `redeploy`,
  `logs`, `add`). Only the *browser* is blocked from railway.com.
- ⚠️ `railway domain <custom>` returns `Unauthorized` for this account —
  custom domains must be added in the dashboard by hand.
- Custom-domain limit on the current plan is **hit** (ecom.ggmt.sg +
  3una5aha.ggmt.sg). A 3rd needs a plan upgrade.

## 5. Live URLs

Everything is path-based under `ggmt.sg` (see `CLAUDE.md` domain policy —
one domain, path per product, no new subdomains):

| URL | What |
|---|---|
| `ggmt.sg/newsfeed` | GK Newsroom hub (4 tiles) |
| `ggmt.sg/newsfeed/ai` | Ai News + Cambodia startup Telegram feed |
| `ggmt.sg/newsfeed/food` | 3una5aha food catalogue |
| `ggmt.sg/newsfeed/accounting` | GK SMART business news |
| `ggmt.sg/newsfeed/3una5aha` | 3una5aha app info page |
| `ggmt.sg/newsfeed/app` | the 3una5aha app itself |

`ggmt.sg/newsfeed/*` is reverse-proxied from the IEWS server into this
app; `applyPrefixShim` in `serve-web.mjs` re-prefixes outgoing links.
**When adding a new top-level route, add it to `PREFIX_ROUTES` in that
shim** or its links break under `/newsfeed`.

## 6. Open items

1. **Browser binding** — restart session, test `example.com` first.
2. **MongoDB Community TCP proxy** — enable in dashboard, then the
   overflow-tier migration script can be written.
3. **Gemini API key is over its monthly spend cap** — blocks image gen,
   TTS, and AI rewrites. The Telegram pipelines fall back to free
   Google Translate automatically (tested, working). Nothing to fix in
   code; the cap needs raising in AI Studio.
4. **3una5aha Shop Watch extension** (`tools/3una5aha-watch`) — skeleton
   only: 3 quick-link buttons + Reload Agent. The actual "watch" behavior
   was never decided. **Do not build WhatsApp DOM-reading into it
   without Gamini's explicit go-ahead** — a peer session proposed a
   content-script workaround around the Meta block; that carries real
   account-ban risk and Gamini has not approved it.
