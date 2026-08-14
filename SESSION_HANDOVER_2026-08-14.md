# Session handover — 10–14 Aug 2026 (Plan Menu, buyer menu, iOS 1.1)

Continues from `SESSION_HANDOVER_2026-08-08.md`. Everything below is pushed to
`Gaminigz/GK-Newsroom` `main` and deployed on Railway unless stated.

---

## 1. Where things stand right now

| Thing | State |
|---|---|
| Web (Railway `web`) | live, all work below deployed |
| iOS **1.0** | live on the App Store since 30 Jul |
| iOS **1.1 build 5** | delivered to App Store Connect, **not yet submitted** |
| `ecom.ggmt.sg` | still not set up — open since 8 Aug |
| Mongo `gk_newsroom` | 147 MB of 512 MB (was 546 MB — see §5) |

**The one open action:** App Store Connect → 3una 5aha → **+ Version 1.1** →
What's New → attach **build 5** (not 4) → export compliance *exempt* →
Add for Review → Submit. Auto-release is on, so it publishes once approved.

Build 4 was rejected at upload with error **90683** — missing
`NSLocationAlwaysAndWhenInUseUsageDescription`. The Capacitor Geolocation
plugin references the always-authorisation API and Apple requires a purpose
string for anything *referenced*, used or not. Fixed in build 5 (`9ca1432`).

Local artefacts: `~/Desktop/3una5aha-1.1-build5.ipa`, archive at
`/tmp/una5aha-1.1.xcarchive` (not in Xcode Organizer — archived to /tmp).

---

## 2. Plan Menu — rebuilt

The screen the shop owner uses to plan a day. `src/lib/shop-suite.mjs`
`menuPage()` plus routes in `src/lib/app.mjs`.

**The model changed.** `day_plans` used to store only *sets*, so a dish could
appear on a date only by living inside one. It now also stores **`dishIds`** —
the shop's dish list for that date, independent of sets. This was the thing
Gamini asked for repeatedly and I kept missing:

- **Dish mode** = the dishes served that date, under the category chips, each
  with a ✕ that takes it off *that day only*
- **Pick combo** = adds a dish to the day; with a set selected it also joins
  that set
- **Sets** = packages (Normal package, Meat Combo, King Pack tiers) on top

**Also in Plan Menu now:**
- **Autosave.** No Save button to remember — the button is the status light:
  orange editing, green saved, red failed. Changes post to
  `/menu/plan.json` 1.2 s after you stop; a local draft per date+meal survives
  reloads. The old Save was a form POST whose navigation the WebView could
  cancel, losing the whole plan silently.
- **Date + meal switch by fetch**, not navigation. Picking 9 Aug used to leave
  the page on the old date with the labels lying about it.
- **Set types are a closed list** (`SET_PRESETS`, 6 entries) plus up to **3**
  names the shop adds itself, stored on `shop_owners.customSetTypes`, editable
  with the ✎ (inline row, not `prompt()`). Free text was removed deliberately:
  "Main dish"/"Main dishes"/"main dishes" as three sets poisons POS, stock and
  accounting downstream.
- **Set price box.** Empty = the dish picked sets the price; `0` = included;
  a number = fixed tier price. `planPrice` sums per set rather than taking one
  global max.
- **A price typed once is the price everywhere** — writes to `app_dishes` for
  every date, and seeds `lanka_dishes.priceLkr` when the catalogue has none.
- The picker **refetches the catalogue itself** when a search finds nothing, so
  adding a dish server-side no longer means telling the owner to reload.

---

## 3. Buyer side — the day's menu

`/app/api/shop/:id` (native) and `/app/shop/:id` (web + table QR) both follow
one rule now:

- **Meal has a plan** → the buyer sees that plan's sets and that day's dishes,
  nothing else
- **Meal has no plan** → no sets, just the dishes whose window covers that
  meal; the shop accepts or rejects the order

A Lunch plan no longer shows at Breakfast or Dinner. **Removed** the old
fallback to "any plan saved today" — it existed because the server clock is
UTC and a shop hours ahead could see its plan vanish. If that bites, scope it
to the shop's timezone rather than restoring the fallback.

Before: a buyer saw all 64 dishes the shop had ever listed. After: 4–11,
matching the day.

---

## 4. Catalogue — 150 → 223 dishes

`src/data/lanka-dishes-150.mjs`, seeded to `lanka_dishes`.

The list was written in Sri Lankan names (`Malu Mirisata`, `Parippu`,
`Kukul Mas Curry`), so the word an owner actually types found nothing. Added
the plain names and the families that kept coming up missing: Fish/Beef/Egg/
Dhal Curry, Rice, Salad, Shrimp + Devilled, Kottu, Biryani, **BBQ** (9),
**roti** (Coconut/Pol/Plain/Paratha/Godhamba), Muringa, Temperate Dry Fish,
Basmathi White Rice, Fry Rice. A new **Rice & Staples** category.

`priceLkr` on a catalogue entry is a suggested price — a dish pulled in from
the picker arrives priced instead of red "no price yet". 32 of 218 have one.

**Category chips** are POS categories; catalogue dishes carry newsroom
categories. `posCategoryFor()` maps them, **by dish name first** — mapping by
category alone put all of `Meat & Seafood Curries` under Chicken and left
Beef/Pork/Mutton/Sea food returning zero.

---

## 5. The outage — 11 Aug

`gk_newsroom` hit **546 MB** against M0's 512 MB cap. Atlas throttled the
cluster: a 2-document read took **36–69 s** while writes stayed fast. Every
`/app/*` route timed out with Railway's "Application failed to respond"; `/`
and `/food` still answered, which made it look like an app bug.

Cause: **podcast audio stored inside Mongo documents** —
`spice_podcast` 305 MB, `ai_feed_podcast` 144 MB, `gov_podcast` 85 MB, i.e.
534 MB of 541 MB. The shop app's own data is under 8 MB.

Fixed by stripping `audio` from all but the newest 3 per feed and rebuilding
the collections (M0 forbids `compact`, so `$unset` alone doesn't return the
files). Now 147 MB.

**Still open:** `gov_podcast` holds 85 MB of audio. The newsroom session was
asked to move audio to Drive/R2 and keep a URL in the doc. One `MONGO_URL`
serves both the newsroom and the shop app — there is no second connection in
the code, so anything that fills the cluster takes down an App Store app.

⚠️ During the cleanup my rebuild emptied `ai_feed_podcast`; its 22 episodes
were safe in `ai_feed_podcast_tmp` and the newsroom session renamed it back.

---

## 6. Traps worth knowing

- **`prompt()` and `confirm()` are silently swallowed in WKWebView.** They
  return null/false with no dialog. This killed the rename pen, and meant
  unticking a set that held dishes could never remove it. All replaced with
  in-page controls (inline editor, two-tap confirm). The same trap had already
  been noted in this file's bill-delete code — check for it before adding any
  native dialog.
- **The page script lives inside a template literal.** `/\s+/g` renders as
  `/s+/g` and eats every "s" — a name like "Bites Pack" saved as "Bite  Pack".
  Double the backslash.
- **Simulator WebKit render stall.** Blank, untappable WebView screens on the
  iPhone 17 sim are a paint stall (~29 s per frame), not an app bug. Read the
  log first; restart the simulator with `shutdown` + `boot`. **Never `erase`** —
  it wipes the session and costs Gamini his login.
- **`gh` auth drifts to `yaikhsales`** and pushes 403. `gh auth switch --user
  Gaminigz` before pushing.

---

## 7. Open items

1. **Submit iOS 1.1 build 5** (see §1)
2. **`ecom.ggmt.sg`** — Railway custom domain + Cloudflare CNAME, **grey cloud
   / DNS-only** (Railway issues its own cert). Then set
   `PUBLIC_BASE=https://ecom.ggmt.sg` so table QRs carry it. Printed QRs keep
   working on the Railway URL.
3. **`gov_podcast` 85 MB** — newsroom side
4. **Unpriced dishes** — a handful sit at LKR 0 and buyers can't order them
5. **`2+4` / `1+1` / `3+4`** on 9 Aug Lunch are placeholder set names Gamini
   made while testing; he said their contents are wrong but never said what
   they should be. Ask before touching.
