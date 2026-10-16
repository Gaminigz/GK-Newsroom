# 30+DA & GK API Hub: session handover, 15–16 Oct 2026

Written for the original "GK API HUB + 30DA Web Admin" session (and anyone else) coming back to this repo. It covers
what changed after the 15 Oct handover (live then: `765e554`). **This repo is public: no secrets here.** Settings are
named, never their values; tokens and keys live only on the admin Code page (sealed) or in Railway env.

Live at the time of writing: **`af46506`** (`https://ecom.ggmt.sg/30da/api/version`).

## Who did the work

| Session | Machine | Did |
|---|---|---|
| GK API Hub (new account) | M5 | Took over from the 15 Oct handover; place search ranking, brand chips, briefs, this note |
| GK API Hub: towers work | M5 | Towers 12, 13, 14, the Overpass backups, finished Google Places |
| Android 30+DA | M5 | 1.0.1 (code 12) committed and sent to Google Play review |
| iOS 30+DA | M5 | Build 3 sent to App Store review; the shell folder put in git (private) |
| Gemini Worker | M1 | Agent Desk (one Chrome, 3 hidden windows) for Tower 14 |

## Commits after the 15 Oct handover (all on `main`, pushed as Gaminigz)

| Commit | What |
|---|---|
| `1df7a62` | Our own Phnom Penh place list (Overpass extract, ~2,000 places, typo-friendly search) + the composer's "Meet" button. Committed as "WIP" on the paused branch; it went live with the next commit. |
| `e5706e9` | Place search live + 2 ranking fixes: among equal matches, better words beat nearer ("Bown Coffee" no longer lists Pho Bowl; "cafe riverside" lists cafés before a restaurant whose old OSM name says "Cafe"). |
| `141b4d3` | **Tower 12 · Places**: the list's status, Refresh now, a test search. |
| `707954e` | **Tower 13 · Translate**: server, model, sealed token, Off/On, wait, Try. Off until turned on. |
| `fd97bfd` | Backup Overpass servers (main, then 2 mirrors) so the list fills when overpass-api.de is down. |
| `8769264` | **Google Places first** in the meeting search (key on Tower 12, Off until turned on, monthly cap, live only, nothing kept). Privacy page names Google Maps in 5 languages (POLICY_DATE 2026-10-16). |
| `a151d33` | **Brand chips** in the Meet sheet: Brown Coffee, Tube Coffee, Starbucks, KOI Thé, AEON Mall, Park Café, Pasta Corner. One tap shows that brand's nearest places with distance. |
| `af46506` | **Tower 14 · Agent Desk**: a job queue for the Gemini Worker on the M1 (text / image / maps), same pull design as Tower 11 · Wan. |

Tests at `af46506`: 775 / 775 (`npm run -s 30da:test`).

## Owner's decisions (Gamini, 15–16 Oct)

- **Place search order:** Google Places (when its key is on) → our own Phnom Penh list → Nominatim.
- **No copying Google Maps results into our own list.** Gamini first asked to "harvest" Maps via Claude in Chrome. That is against Google's terms, so the Places API key on Tower 12 does it properly instead. Approved "pick up and fix it".
- **Brand chips:** "small text tags to click … show up most nearest of that pick then confirm". The list is in `src/thirtyda-app/shared/meet.js` `MEET_BRANDS`. Gamini wrote "Browns" and "Paste Corner"; the chips use the real names (Brown Coffee, Pasta Corner).
- **Meeting card map link** = Google Maps at the exact point, for both people; it opens the phone's Google Maps app.
- **Agent Desk (Tower 14):** job queue (nothing on the M1 opened to the internet).
  - Gamini chose to use it for **Google Maps details and images** for the Media teams, knowing that automating Gemini/Maps in a browser can get the Google account suspended. It runs on a separate Google account ("ai 2025"), not his main one.
  - **Never 30+DA user data** (chats, profiles, photos): private chat translation stays on Tower 13 (Hy-MT2 on the M1). Maps answers never go into our place list.
- **Tower work belongs to the towers session**, not the main session ("pass this work to tower handler").
- Standing rules unchanged: push finished pieces at once; never change the 4 test PINs; Gamini types PINs, codes and keys himself; short replies.

## Live state (16 Oct)

| Item | State |
|---|---|
| Place list (Mongo `thirtyda_places_index`) | Filled 16 Oct 07:56 (+7): 1,992 places, 66.6 KB, from overpass-api.de; refreshes weekly |
| Tower 10 · Apple | `.p8` saved; Try → "Works ✓" |
| Tower 12 · Google Places | Built, **no key yet** (Off) |
| Tower 13 · Translate | Built, **Off**, no model/token saved |
| Tower 14 · Agent Desk | Live, **no tokens yet**; the Gemini Worker has not connected |
| Mongo (M0, 512 MB) | ~300 MB used |
| Railway `THIRTYDA_PIN_PEPPER` | **Not set** (the 15 Oct handover lists it); PIN hashes carry no extra server secret. Gamini's call. |
| `THIRTYDA_WAIT_MINUTES` | 2 (short wait for testing) |

What our own list covers (16 Oct): Starbucks 18, Brown 16, KOI 10, Park Café 3, AEON Mall 3, Tube Coffee 5, Pasta Corner 2. Google shows ~20–25 branches of Tube Coffee, BreadTalk and Pasta Corner. That gap is why the Places key exists.

## Stores

- **Google Play:** 1.0.1 (code 12) sent 16 Oct: "Changes in review". The Data safety delete URL was already right; the fix was the live page (`765e554`). In "Sign in details" the two row **titles** have Sophea/Dara swapped; the usernames and PINs inside are correct.
- **App Store:** 1.0 build 3 sent 16 Oct 07:39: "Waiting for Review". The iOS shell is now the private repo `Gaminigz/30da-ios` (`60bc13b`).
- Both apps load the live web app, so web changes reach them without a new build.

## Open items

| Item | Who |
|---|---|
| Sign in with Apple test on the real iPhone | Gamini |
| Google Places: make the key (Cloud → enable "Places API (New)" → API key restricted to it) → paste on Tower 12 → test search → Turn on → budget alert | Gamini |
| Tower 13: load Hy-MT2-1.8B on the M1 → model + M1 guard token → Try → Turn on | Gamini |
| Tower 14: paste the brief + contract into the Gemini Worker (M1); make the Worker token; Try text/image/maps; then app tokens for Yai Media Director, M1 and M2 apps | Gamini, then the main session briefs the Media sessions |
| Tower 11 · Wan tokens | Gamini |
| Review sign-in OFF after both stores approve | Gamini |
| Back up the Apple `.p8` and `~/.iews-android` (the 30+DA Android key is already in Google Drive → Keys Backup, password-locked) | Gamini |
| Khmer street names show in English mode on some addresses (OSM `addr:street` is Khmer); could prefer `addr:street:en` | Next account, if asked |
| "BreadTalk" vs "Bread Talk": one-word / two-word names don't find each other in our list; compare names with spaces removed | Next account, if asked |

## Files outside the repo (not in git on purpose)

- `~/Desktop/GK Drop/GK to YAI /30DA-GK-API-Hub-Handover-2026-10-15.pdf`: the 15 Oct handover
- `~/Desktop/GK Drop/GK to YAI /Agent-Desk-Tower14-brief-for-Gemini-Worker.md` and `Agent-Desk-Tower14-contract.md`: for the Gemini Worker
- The source of truth for the Tower 14 contract is the header of `src/lib/thirtyda-hub-desk.mjs`.
