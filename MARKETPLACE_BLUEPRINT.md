# Marketplace App Blueprint — reuse for any topic

A field guide to rebuild the **3una 5aha** stack for a *different* subject
(e.g. hardware sellers, tutors, farm produce, event vendors) without
re-deriving the architecture. Written 2026-07-10 from the working system.

> **The idea in one line:** a non-commercial community marketplace where
> **providers** post listings and **buyers** discover them nearby, on one
> zero-dependency Node server, wrapped in a Capacitor iOS/Android shell,
> with a web superadmin console. Swap the nouns, keep the machine.

---

## 1. The stack (don't change unless you must)

| Layer | Choice | Why |
|---|---|---|
| Server | Node `http` + template strings, **no framework** | zero deps, one file per surface, trivial to reason about |
| DB | MongoDB Atlas (driver only) | flexible docs; collections are the seams |
| Host | Railway, GitHub-connected auto-deploy | push to `main` → live in ~20s |
| Cron | Railway cron service, separate `railway.json` | daily jobs (feeds, digests) |
| Native | **Capacitor 8** (SPM, no CocoaPods) shell over the live web `/app` | one codebase, real App Store binary |
| Images | Gemini **Imagen 4** (`imagen-4.0-generate-001`) one-time, committed | icons, hero, category photos; **not** at runtime |
| Maps | **Leaflet + OpenStreetMap** (no API key) | swap tiles for Google/Apple in native phase |

Two Railway services in one project:
- **web** — `npm run web` → `src/scripts/serve-web.mjs`, config `railway.web.json`
- **cron worker** — `npm run daily`, config root `railway.json`, schedule `0 22 * * *` UTC

## 2. File map

```
src/scripts/serve-web.mjs   Router + landing/topic pages. Mounts the sub-apps:
                              if (path.startsWith("/admin")) handleAdmin(...)
                              if (path.startsWith("/app"))   handleApp(...)
src/lib/app.mjs             THE MARKETPLACE (buyer + provider). ~1800 lines.
src/lib/admin.mjs           Superadmin console (login → tabs).
src/lib/mongo.ts            getDb(name = process.env.MONGO_DB || "<default>")
src/web-assets/             Imagen output, committed (icons, hero, photos)
ios-app/                    Capacitor project; APP_STORE.md is the submission kit
```

Everything is **server-rendered template strings** returning HTML. Shared
`shell({title, body, nav, back, toast, noBack, backFloat})` wraps every page.
No client framework; small inline `<script>` blocks per page for interactivity.

## 3. Data model (rename the nouns)

| Collection | 3una5aha meaning | Generic role |
|---|---|---|
| `shop_owners` | restaurants / home cooks | **providers** (name, owner, email, city, country, lat/lng, logo, frontPhoto, mapsUrl, phone, whatsapp, telegram, facebook, contactEmail, status active/pending/suspended, open) |
| `app_dishes` | dishes | **listings** (shopId, name, photo, price, window, discount, special, likes, passes) |
| `app_orders` | pickup orders | **transactions** (shopId, items[], total, buyer, phone, pickupAt, status pending/preparing/done, messages[]) |
| `app_users` | buyer/seller accounts | **users** (email, hash sha256, verified, code+codeAt, avatar, name, phone, resetCode) |
| `app_reports` | abuse reports | **moderation queue** |

Ownership/identity is **cookie-based** (no server sessions for the app):
`app_user` (provider of sign-in), `app_email`, `app_shop` (auto-login to a
provider dashboard), `app_phone`, `app_city`, `app_geo` (lat,lng),
`app_favs` (pipe-joined ids). Admin uses an in-memory session token cookie.

## 4. The patterns worth copying verbatim

- **Photo upload** — `<label>`+hidden `<input type=file accept="image/*">`;
  a `wirePhoto(input,box,hint,data,square)` JS resizes on-device to ≤800px
  JPEG data-URI, stored in Mongo (like the podcast WAVs). Persistent 📷 badge
  so it reads as tappable. **No `capture="environment"`** (that forces camera-
  only; omit it to allow library too).
- **Centered toast** — every mutating action redirects `?msg=...`; `shell`
  renders a mid-screen pill that fades after 2s. Never bottom-anchored.
- **Persistent basket** — `localStorage` per provider; bar + editable sheet
  (−/＋/✕) survive navigation/restart; cleared only on order or empty.
- **Flash card** — provider "special" toggle surfaces a pulsing auto-rotating
  card on the buyer home; ✕/♥ + swipe record `passes`/`likes` ($inc); owner
  sees ♥ counts. Geo-city preference orders them.
- **Map discovery** — Leaflet, user dot + 10km circle, provider pins from
  `resolveCoords()` (expand Google/Apple Maps link → else geocode city via
  Nominatim). Drag anywhere → pins+count refresh; "Find" geocodes any city.
- **Deferred email verification** — sign in immediately; red-dot banner nags
  to verify with a 24h code "from <support email>"; "verify later" always
  allowed (non-commercial). Dev stage: code fixed, SMTP swap is one function.
- **Auto-approve + block-only moderation** — providers go live instantly;
  superadmin only Suspends/Reactivates and clears reports. No pending queue.
- **Edge insets** — global 24px side padding; every fixed/full-bleed element
  (heroes, basket bar, floating buttons, logout) tuned to it + safe-area.
- **Universal nav** — inline back on every page (webview has no system back);
  red Logout pinned under the battery clears all app cookies.

## 5. Superadmin console (`src/lib/admin.mjs`)

Login: `ADMIN_ID` (default `admin5`) gates it; `ADMIN_CODE` 2FA exists but is
bypassed for now (re-enable in the `/admin/login` handler). Two tabs:
- **NewsRoom / content** — stats + moderation of the content collections
- **Superadmin <Providers>** — count of providers **and** app users; table
  with front-photo thumb, city, tappable location/contact icons
  (📍📞💬✈️📘✉️), status pills, Suspend/Reactivate, Reset-pass, open reports
  queue with Resolve.

## 6. iOS (see `ios-app/APP_STORE.md`)

Capacitor `server.url` → the live `/app`. Icon+splash from one 1024 Imagen
image via `capacitor-assets generate`. Info.plist has camera/photo/location
usage strings. **App Review essentials already built:** guest browsing, in-app
report button (UGC rule), in-app + email account deletion, privacy/terms/
support pages, publisher attribution. Build: `xcodebuild ... -destination
'platform=iOS Simulator,name=<device>'`; needs Xcode + one signing-team click.

## 7. To fork for a NEW topic

1. Copy the repo; set new `appId`, app name, Mongo `MONGO_DB`, Railway project.
2. **Rename the 5 collections' meaning** (§3) — the code is generic; only the
   labels/copy are food-specific. Grep for user-facing strings: "dish",
   "restaurant", "shop", "spice", "pickup", "Ayubowan", Sinhala text.
3. Regenerate `src/web-assets` with Imagen prompts for the new topic (icon =
   one 1024 square; hero = 16:10; category photos as needed).
4. Rewrite `/app/terms`, `/app/privacy`, `/app/support`, welcome copy, and
   `APP_STORE.md` for the new subject + same publisher.
5. Keep all §4 patterns as-is. Keep the deploy pipeline (§1) as-is.
6. Seed one real provider, delete demo/test artifacts before launch.

## 8. Deploy & workflow rules

- Push to `main` → Railway auto-deploys web (+cron). Verify with `curl` on the
  live URL, then relaunch the simulator app (it loads the live `/app`).
- Batch changes locally, ask before pushing (per [[feedback-batch-pushes]]).
- Pre-launch checklist: rotate DB/API creds, re-enable admin 2FA, wire real
  SMTP for verification, real OAuth for Google/Apple/FB/SMS logins (all are
  dev-static placeholders today), custom domain.
