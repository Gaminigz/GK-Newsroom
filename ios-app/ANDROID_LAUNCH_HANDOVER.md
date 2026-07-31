# 3una 5aha — Android launch: session handover

Written 2026-07-31 by the iOS session. The iOS app **shipped and is live
worldwide** at `apps.apple.com/app/3una-5aha/id6789434204`. This document is
for a **fresh session** dedicated to launching the same app on **Google
Play Store from scratch**. Read this fully before touching anything.

The user (`gamini@ggmt.sg` / GK SMART) already has an **approved Google Play
Developer account** — no $25 signup, no verification wait. Log into
Play Console with the same GGMT account.

---

## 1. Where things stand, in one paragraph

The app has **no Android platform yet** — `ios-app/` is a Capacitor project
with only `@capacitor/ios` in dependencies. The web app is fully built and
running on Railway; it's what the iOS app wraps for webview-backed screens.
For iOS, Apple forced a **full native SwiftUI rebuild** (see
`APP_REVIEW_HANDOVER.md`) because of guideline 4.2 (webview wrapper). For
Android, Google Play is **much more lenient** about webview apps — so the
first decision is *how native* the Android build needs to be. Everything
else (backend, screenshots, listing copy, test accounts, push infra) is
either already live or reusable from the iOS work.

---

## 2. Stack references — read these before touching anything

### 2a. Git / repo
- **Repo path**: `/Users/gamini/GK Dev/yai-newsroom`
- **Primary remote**: `ggmt` → `https://github.com/Gaminigz/GK-Newsroom.git`
- **Secondary remote**: `origin` → `https://github.com/yaikhsales/yai-newsroom.git` (public split, don't push there routinely)
- **Branch**: `main` (single branch, no dev/staging split)
- **Commit identity**: `yaikhsales <gamini@yaikh.com>` (matches all history — don't change it)
- **Push credential**: **`gh auth switch --user Gaminigz`** BEFORE every push.
  Both `Gaminigz` and `yaikhsales` gh accounts exist; the repo silently
  prefers `yaikhsales` and fails with 403 otherwise. Check with
  `gh auth status | head -5` — active account must be Gaminigz.
- **Do NOT push to the `origin` (yaikhsales) remote** unless the user
  explicitly asks. `git push ggmt main` is the default.
- **Session boundary** (important): this repo hosts TWO product lines —
  the **buyer app** (`/app`, `ios-app/`) and the **newsroom pipeline**
  (`/ai`, `/accounting`, telegram/garment stuff). Android work owns only
  the buyer-app side. Shared files (`serve-web.mjs`, `mongo.ts`) —
  coordinate before editing.

### 2b. MongoDB
- **Provider**: MongoDB Atlas, cluster `Cluster0` (workspace: GK SMART)
- **Database name**: `gk_newsroom`
- **Connection**: read via env var `MONGO_URI` on Railway (do NOT hardcode)
- **Collections you'll touch** (buyer app side, read-only unless writing
  test data):
  - `shops` — restaurant records, includes `lat`/`lng`
  - `dishes` — menu items, base64 photo data URIs
  - `orders` — buyer orders (POSTed by `/app/order`)
  - `pushTokens` — APNs/FCM device tokens (iOS ones live here already; Android would join the same collection)
- If you need to inspect Mongo locally, `mongosh` with the Atlas
  connection string; the user will paste it — don't guess.

### 2c. Railway (backend hosting)
- **Project**: `gk-newsroom` (workspace: "GK SMART's Projects")
- **Service**: `web` — Node/Express app in this repo, entry `serve-web.mjs`
- **Live URL**: `https://web-production-2b43c.up.railway.app`
- **Auto-deploys** from `ggmt/main` (every push triggers a build)
- **Env vars already set on `web`** (do not overwrite blindly):
  - `MONGO_URI` — Atlas connection string
  - `APNS_KEY_ID` / `APNS_KEY_P8` / `APNS_TEAM_ID=4KX4774V2U` / `APNS_TOPIC=sg.ggmt.una5aha` — iOS push
  - Various Gemini / Telegram / news pipeline vars (unrelated, don't touch)
- **For Android push notifications**: you'll need to add
  `FCM_SERVER_KEY` (or Firebase service account JSON) — see §5c below.
- **Verify a deploy** by `curl https://web-production-2b43c.up.railway.app/app/api/home` — should return JSON.

### 2d. Test accounts (both password `111111`)
- `a@a.com` — buyer account (can place orders)
- `aa@a.com` — shop owner (Ceylon Kitchen Colombo dashboard)
- Include these in the Play Console "App content > App access" answer
  when submitting for review.

### 2e. Bundle / app identity (must match iOS to keep users linked)
- **Application ID / package name**: `sg.ggmt.una5aha`
  (Android convention is reversed-domain, matching iOS bundle ID is fine
  and recommended — same user identity, same push topic conceptually.)
- **App name (display)**: `3una 5aha`
- **Version**: start at `1.0` / `versionCode 1`
- **Team**: GGMT PTE. LTD.
- **Support URL** (already public): `https://web-production-2b43c.up.railway.app/app/support`
- **Marketing URL**: `https://www.ggmt.sg`
- **Privacy Policy URL**: `https://web-production-2b43c.up.railway.app/app/privacy`
  (verify it loads before submitting — Play Console will crawl it)

---

## 3. FIRST DECISION — how native does the Android app need to be?

Ask the user before writing any code. The answer determines everything else.

### Option A — Capacitor webview (fastest, 1 day)
- Add `@capacitor/android` to `ios-app/package.json`
- `npx cap add android`
- Reuse the exact same webview + Capacitor plugins that iOS build 2 had
  (push, camera, share, geolocation, haptics, offline banner)
- Google Play generally accepts this if there's a real reason for the
  wrapper AND the app has some native features. **Likely to pass Play
  review.**
- Risk: if Google *does* push back (rare, but happens), you'd need to
  scramble like the iOS session did.

### Option B — Native Kotlin/Jetpack Compose (parallel to iOS SwiftUI, 3–5 days)
- Build Android Studio project with native `Composable` screens for
  Home / Shop / Orders / Map / Account
- Reuse the same JSON API endpoints (`/app/api/home`, `/app/api/shop/:id`,
  `/app/api/orders`) that were built for the iOS native rebuild
- Use Google Maps Compose for the Map tab (parity with iOS MapKit)
- Google Sign-In (or Sign in with Google) for the Account tab
- **Most polished, matches iOS quality.** Recommended if the user wants
  the two apps to feel like siblings.

### Option C — Hybrid (Capacitor shell + native pieces, 2–3 days)
- Capacitor webview for most flows
- Native Android modules for the parts Google is picky about (real
  push registration, camera intent, share sheet)
- Middle ground; probably overkill unless the user has a specific reason

**Recommend Option A first** unless the user says otherwise. Google Play
almost never rejects Capacitor apps that have plugin-backed native
features. If it does get rejected, the fallback to native Kotlin exists.

---

## 4. Google Play Console — one-time app setup

Assumes the developer account is already approved (user confirmed).

### 4a. Create the app
1. Log in at `https://play.google.com/console/`
2. **Create app** button (top right)
3. Fill:
   - App name: `3una 5aha`
   - Default language: English (United States) — matches iOS listing
   - App or game: **App**
   - Free or paid: **Free**
   - Declarations: check both (developer program policies + US export laws)

### 4b. Complete "Set up your app" checklist (Dashboard → left column)
Play Console shows a checklist. All must be green before you can submit.
Rough order:
1. **App access** — declare whether the app has restricted access:
   - Answer: **All functionality is available without special access**
     (browsing works as guest; sign-in is optional)
   - But *do* provide the test accounts in the notes (a@a.com / 111111,
     aa@a.com / 111111) so reviewers can test ordering + shop dashboard.
2. **Ads** — **No**, the app contains no ads
3. **Content ratings** — fill the questionnaire (food/local-services app,
   no violence, no user-generated adult content). Should return **PEGI 3**
   / **Everyone**.
4. **Target audience** — 13+ (safe default; matches the iOS 4+ intent
   without triggering under-13 COPPA compliance)
5. **News app declaration** — **No** (it's a food/shop app, not a news app)
6. **COVID-19 contact tracing** — **No**
7. **Data safety** — must be filled carefully. Data collected:
   - Name (from Sign in with Apple/Google if used) — used for account
   - Email — used for account + support
   - Phone number — required for order pickup
   - Location (approximate, only if user grants permission) — for nearby-shop search
   - Photos (only if a shop owner uploads a dish image, and only stored on
     our server not shared with 3rd parties)
   - No advertising ID, no analytics tracking, no cross-app tracking
   - All data encrypted in transit (HTTPS)
   - Users can delete their account via the in-app Support page
8. **Government apps** — **No**
9. **Financial features** — **No** (ordering != financial services; no
   payment processing in-app, cash on pickup)
10. **Health** — **No**
11. **Store settings** — app category **Food & Drink**
12. **Store listing** — see §6

### 4c. Set up app signing
Play Console will offer Play App Signing (Google manages the signing key,
you upload with an upload key you generate). **Accept the default (Play
manages the signing key)** — it's what Google recommends and it makes key
recovery possible if you lose the upload key.

Generate the upload keystore:
```bash
keytool -genkey -v \
  -keystore ~/Documents/apple-keys/una5aha-upload.jks \
  -alias una5aha \
  -keyalg RSA -keysize 2048 -validity 10000
```
Store the keystore file at `~/Documents/apple-keys/` (same folder as the
APNs key `.p8`) — that folder is already the user's private-keys
convention. **Back it up externally** — losing this + Play App Signing
being off would mean never being able to update the app.

---

## 5. Build the Android app (Option A — Capacitor path)

Assuming Option A was chosen. If Option B/C, adapt.

### 5a. Add Capacitor Android platform
```bash
cd "/Users/gamini/GK Dev/yai-newsroom/ios-app"
npm install @capacitor/android
npx cap add android
```
This creates `ios-app/android/` (same shape as `ios-app/ios/`).

### 5b. Configure `android/app/build.gradle`
- `applicationId "sg.ggmt.una5aha"` (must match Play Console)
- `versionCode 1`, `versionName "1.0"`
- `minSdkVersion 24` (Android 7.0) or `26` (Android 8.0) — matches iOS 15+ ambition
- `targetSdkVersion 34` (Play requires target API 34 as of 2026)

### 5c. Push notifications — Firebase Cloud Messaging (FCM)
Android's equivalent of APNs. Setup:
1. Firebase console → create project `una5aha` (or reuse existing GGMT
   Firebase if one exists — check first)
2. Add Android app to the Firebase project, package `sg.ggmt.una5aha`
3. Download `google-services.json`, place at `ios-app/android/app/google-services.json`
4. Firebase Console → Project Settings → Cloud Messaging → get the
   **Server key** (or generate a service account for HTTP v1 API)
5. Add to Railway env: `FCM_SERVER_KEY` (or paste service account JSON as `FCM_SERVICE_ACCOUNT`)
6. Update `serve-web.mjs` push route to dispatch to FCM for Android tokens
   (currently only APNs for iOS tokens) — see the APNs code as a
   template. Ask the user before writing this if unclear.

### 5d. Native tweaks matching iOS
The iOS native rebuild added things Play reviewers will notice too:
- **Deep-link support** for `sg.ggmt.una5aha://` (already configured
  on iOS via URL schemes; Android uses intent filters in `AndroidManifest.xml`)
- **Splash screen** — Capacitor generates from `ios-app/assets/` — run
  `npx capacitor-assets generate --android` after copying the same
  splash/icon set the iOS build uses
- **Icon** — use the same 3una 5aha icon (`ios-app/assets/icon.png`)

### 5e. Build the release AAB (Android App Bundle)
```bash
cd ios-app/android
./gradlew bundleRelease
# outputs: app/build/outputs/bundle/release/app-release.aab
```
Sign it with the upload key (Android Studio can do this, or
`jarsigner` + `zipalign`). Or use Android Studio's "Generate Signed
Bundle" wizard which handles both.

The `.aab` is what you upload to Play Console — **NOT** the `.apk`.

---

## 6. Store listing content

Reuse iOS listing verbatim where possible. Copy from App Store Connect
version 1.0 fields.

- **App name**: `3una 5aha`
- **Short description** (80 chars max):
  `Sri Lankan food nearby — order for pickup, chat with the cook.`
- **Full description**: reuse the iOS "Description" field (long-form
  ~3200 chars) — pull it from App Store Connect
- **App icon**: 512×512 PNG (Play Store display icon) — generate from
  `ios-app/assets/icon.png` if not sized right
- **Feature graphic**: 1024×500 PNG — required by Play Store; create one
  matching the iOS marketing feel (Play displays this above the
  screenshots on the store listing)

### Screenshots (very similar to iOS, but Android sizes)
Play Console requires:
- **Phone screenshots**: 2–8 shots, 16:9 or 9:16, min 320px, max 3840px
- **7-inch tablet**: 1–8 shots, min 320px
- **10-inch tablet**: 1–8 shots, min 320px

Capture from Android Studio emulator (Pixel 8 Pro for phone, Pixel Tablet
for 10"). Or copy the pattern from the iOS session (see the
`APP_REVIEW_HANDOVER.md` for the exact `xcrun simctl io screenshot` +
`sips` resize workflow — Android equivalent is `adb exec-out screencap
-p > file.png`).

Screenshots MUST show real native app content (not just login), same
lesson the iOS session learned from Apple 2.3.3 rejection. Capture:
1. Home screen with flash card + restaurant list
2. Shop detail with dish list
3. Map view with restaurant pins
4. (Optional) Basket + order flow

Save originals to `~/Desktop/3una5aha-Play-v1/`.

---

## 7. Submit for review

1. Play Console → **Production** track (or **Internal testing** first if
   the user wants a soft-launch to a small tester list)
2. **Create new release**
3. Upload the `.aab` from §5e
4. Release notes (English): `First release. Native food-ordering experience for Sri Lankan restaurants.`
5. **Review release** → **Start rollout to Production**
6. Google review takes anywhere from **hours to 7 days** — much faster
   than Apple usually (typically 1–3 days for first submissions).

---

## 8. Known gotchas (learned from iOS, transferable)

- **Session sign-in in Play Console** doesn't expire as aggressively as
  App Store Connect, but 2FA still required each fresh session — user has
  to click the phone prompt. Don't expect to drive login via automation.
- **File-picker uploads** in Play Console face the same restriction as
  App Store Connect (browser automation can't open native OS pickers).
  The user has to click "Choose file" and select files themselves. Copy
  the iOS pattern: prepare files on `~/Desktop/`, walk the user through
  clicks.
- **Bundle ID immutable** once first release is created — triple-check
  `sg.ggmt.una5aha` is right before hitting Create.
- **Play App Signing key CANNOT be recovered if lost + you opt out of
  Play-managed signing**. Do NOT opt out. Do NOT lose the upload
  keystore either — back it up alongside `AuthKey_727T9G6ASG.p8`.
- **Target API 34 requirement**: as of August 2025 Google requires
  new apps to target API level 34+ (Android 14). Capacitor 8+ handles
  this automatically but verify in `build.gradle` before uploading.
- **Data safety form is scrutinized**. If the app collects a field the
  form doesn't declare, Play will reject with a "Data safety
  discrepancy" warning. When in doubt, over-declare (declaring
  something you don't collect is fine; the reverse triggers rejection).

---

## 9. What NOT to touch

- Don't edit the iOS side (`ios-app/ios/`, `AppDelegate.swift`,
  `NativeApp.swift`, `App.entitlements`) unless the iOS session explicitly
  asks you to coordinate. The iOS app is LIVE — any change there needs
  its own version bump + resubmission.
- Don't touch the newsroom pipeline (`/ai`, `/accounting`,
  `serve-web.mjs` news routes, Telegram stuff, garment associations) —
  different session owns that.
- Don't restructure `serve-web.mjs` — the shared API routes
  (`/app/api/*`, `/app/order`, `/app/push/register`, `/app/auth/apple`)
  are load-bearing for BOTH the iOS live app and the Android app you're
  about to build. Add new routes if you need them; don't rename existing.
- Don't create a new Mongo database — reuse `gk_newsroom`. Data models
  (shops, dishes, orders, pushTokens) are shared platform-wide by design.

---

## 10. Session kickoff prompt

When starting the new session, paste this:

> Read `/Users/gamini/GK Dev/yai-newsroom/ios-app/ANDROID_LAUNCH_HANDOVER.md`
> in full, then walk me through publishing 3una 5aha on Google Play Store.
> Answer the §3 first-decision question with your recommendation before
> writing code. The iOS side is already live — don't touch it.
