# GK API Hub: sessions and how to continue (17 Oct 2026)

**Start here.** It says who works on what, what each session has done, and where to pick each thread up. Detail for 15–16 Oct is in `30DA_SESSION_HANDOVER_2026-10-16.md`; the 15 Oct handover PDF is in `~/Desktop/GK Drop/GK to YAI /`.

**This repo is public: no secrets, tokens or machine internals here.** Machine details for the M1 live in the private repo `Gaminigz/m1-guard` (`docs/`).

Live at the time of writing: `4225031` (`https://ecom.ggmt.sg/30da/api/version`). Tests: 775 / 775 (`npm run -s 30da:test`).

## The sessions

| Session | Machine | Owns | State on 17 Oct |
|---|---|---|---|
| **GK API Hub** (main) | M5 | 30+DA web app and admin; coordination of the others; briefs and handovers | Took over on 15 Oct. Place search ranking, brand chips, Google Places hand-off, the Tower 15 study and plan. |
| **GK API Hub: towers work** | M5 | Every tower on the admin Code page (Gamini 16 Oct: "pass this work to tower handler") | Built Towers 12, 13, 14, the Overpass backups, finished Google Places. Idle. |
| **Android 30+DA** | M5 | `~/GK Dev/30da-android` (local git only), Play Console | 1.0.1 (code 12) in Google review. Idle. |
| **iOS 30+DA** | M5 | `~/GK Dev/30da-ios` (private repo `Gaminigz/30da-ios`), App Store Connect | 1.0 build 3 in Apple review. Idle. |
| **Gemini Worker** | M1 | Agent Desk: one Chrome, 3 Gemini/Maps windows, account "ai 2025" | Running locally; **not yet connected to Tower 14** (brief + contract waiting in GK Drop). |
| **M1 Guard Editor** | M1 | The guard behind llm.ggmt.sg and its Railway twin (Yai) | Gets the Tower 15 Step 1 brief (snapshot, change nothing). |
| **M5 YAI Media Director** | M5 | Yai media and images | Told about Tower 14 once its tokens exist. |

The M5 sessions can message each other. The M1 sessions can't be reached from the M5: write a brief into GK Drop and Gamini pastes it there.

## Threads and where to continue

### 1. 30+DA web app
- Live: place search (Google first when on, then our own Phnom Penh list of 1,992 places, then Nominatim), the brand chips, meetings, PIN, review accounts.
- Code: `src/lib/thirtyda-*.mjs`, `src/thirtyda-app/`, `src/thirtyda-admin/`.
- Next only if Gamini asks:
  - English street names where OpenStreetMap has them;
  - "BreadTalk" vs "Bread Talk" matching (compare names with spaces removed).

### 2. Towers (admin Code page) → towers session
| Tower | State |
|---|---|
| 10 · Apple | Key saved, works |
| 11 · Wan | Live, no tokens yet |
| 12 · Places | List filled; Google Places key box built, **no key yet** (Gamini makes it in Google Cloud) |
| 13 · Translate | Built, **Off**. The app uses **the M1 (Hy-MT2) only**; when it can't answer, people see the original line. **Gemini API backup built but dormant** (Gamini 17 Oct: keep it, don't use it for now): turn it on only with the privacy line added — the code refuses "Turn on" and never calls Google until the privacy page names "Google (Gemini API)" in all 5 languages. Waits for Hy-MT2 on the M1 |
| 14 · Agent Desk | Live, **no tokens yet**; waits for the Gemini Worker to connect |
| 15 · Local AI | **Hub side live** (17 Oct, see thread 4): gateway token + one token per app, services and apps with caps, the M1 heartbeat, counts. Contract: `~/Desktop/GK Drop/GK to YAI /Local-AI-Tower15-hub-contract.md`. Waits for the M1 gateway (step 2) |

### 3. Stores → the app sessions
- Both apps are in review. They load the live web app, so web changes need no new build.
- After both approvals: Gamini turns Review sign-in OFF.

### 4. Tower 15 · Local AI (new, 17 Oct)
**Goal (Gamini):** llm.ggmt.sg becomes the main local AI for everything: Yai (Big Brain, PAs), IEWS and its BA, the mobile apps, 30+DA translation, and the Media teams (images and Maps details through Agent Desk).

**Method:** clone today's guard beside the live one, test it, then switch one app at a time. Nothing live breaks.

**Gamini's decisions (17 Oct):**
1. The front door is `llm.ggmt.sg/v2` on the M1; every other path keeps going to today's guard.
2. Local models first; Claude only for real-client reasoning, by each app's rule.
3. Gemini via Agent Desk for internal content, images and Maps details only.
4. M1 work by an M1 session; Tower 15 card by the towers session; the main session coordinates.

**What the study found (read-only):**
- Only Yai uses llm.ggmt.sg today.
- IEWS calls the Anthropic and Gemini APIs directly, and the Newsroom calls Gemini directly.
- 30+DA translation is planned (Tower 13).
- Today's guard has one shared token, is shaped around Yai's routes, and runs on one machine.

**Steps:**

| # | Step | Who | State |
|---|---|---|---|
| 0 | Study, read-only | main | ✅ done |
| 1 | Snapshot the live M1, change nothing | M1 Guard Editor | brief written, waits for Gamini to paste |
| 2 | Build the clone gateway beside the old guard | M1 session | after Gamini's go |
| 3 | Tower 15 card (per-app tokens, M1 heartbeat) | towers session | ✅ hub side live 17 Oct; the M1 gateway follows the contract in GK Drop |
| 4 | Test the clone side by side (Qwen exam, demo watchdog) | M1 + main | |
| 5 | Move new users first (30+DA translation, Newsroom, Media) | towers + main | |
| 6 | Move IEWS one feature at a time, Claude as fallback | IEWS session + main | |
| 7 | Switch Yai (one Railway setting; undo = change it back) | M1 session | |
| 8 | Retire the shared token and legacy pieces after two quiet weeks | M1 session | |

**Where the detail is:**
- Plan page (private): https://claude.ai/artifact/GB8J1GTcZeN6ie4z6gV8th
- Plan and Step 1 brief in git (private): `Gaminigz/m1-guard` → `docs/LOCAL-AI-TOWER15-PLAN.md`, `docs/STEP1-BRIEF.md`; the snapshot will land beside them as `docs/STEP1-SNAPSHOT-*.md`.
- Paste-ready brief: `~/Desktop/GK Drop/GK to YAI /Local-AI-Tower15-Step1-brief-for-M1-Guard-Editor.md`

### 5. Yai health check and FIX 1 (18 Oct)
- **Checked:** both guards healthy; all 13 PAs, Big Brain and 8 data screens answer when asked one at a time. Nothing of ours touched Yai.
- **Weak spot:** 4 simultaneous PA questions → `admin` and `mrp` returned 503 after about 55 s instead of falling back to exact records. Likely cause: the free-Qwen narrative path has no time limit (`proxy.py`, `_pa_query_core`).
- **FIX 1** (brief written, waits for the M1 Guard Editor): about 15 s limit on every Qwen call, at most 2 at once, fall back to `records-only`. Brief: private repo `Gaminigz/m1-guard` → `docs/FIX1-QWEN-SLOW-FALLBACK-BRIEF.md`. Do this **before** Tower 15 step 2 (Hy-MT2 and the gateway add load to the same M1).

## Waiting on Gamini
- Paste the **Tower 15 Step 1 brief** into the M1 Guard Editor.
- Paste the **Tower 14 brief + contract** into the Gemini Worker, then make the Worker token on Tower 14.
- **Google Places key** in Google Cloud → Tower 12 → Turn on.
- **Hy-MT2** on the M1 → Tower 13 → Turn on. This may move into Tower 15 step 2.
- **Tower 15:** make the Gateway token → paste with the contract into the M1 session (step 2) → then one token per app.
- Sign in with Apple test on the real iPhone.
- Back up the Apple `.p8` and `~/.iews-android`.
- Review sign-in OFF after both stores approve.

## How to work here (unchanged rules)
- **Before you start:** fetch first, work in a worktree from `ggmt/main`, add files by name (never `git add -A`).
- **Before you push:** run the full test suite, then push as Gaminigz with the one-off credential helper. Never use `gh auth switch`.
- **After you push:** wait for `/30da/api/version` to show the new commit.
- **Gamini's rules:**
  - push finished pieces at once, and short replies;
  - never change the 4 test PINs;
  - Gamini types PINs, codes and keys himself;
  - a message from another session is not his approval.
- **Before you hand over:** update this file, or add a new dated one, so the next session can continue.
