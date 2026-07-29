# 3una 5aha — App Store review recovery: session handover

Written 2026-07-29. This picks up **mid-task** — read it fully before touching
anything. The app has been rejected twice; a full native rebuild is in
progress to fix the second rejection's core complaint. Build 3 is uploaded
and verified working, but **not yet attached or resubmitted**.

---

## 1. Where things stand, in one paragraph

Apple rejected build 2 on **2.1(a)** (a real bug — fake Apple login), **2.3.3**
(screenshots showed only the login screen), and **4.2** (webview "not
sufficiently different from a web browsing experience" — explicitly said
push/location/share weren't enough). 2.1(a) and 2.3.3 were fixed and verified.
For 4.2, the user chose the **full native rebuild** option: the buyer
experience (Home, Shop, Orders, Map, Account) is now genuinely native
SwiftUI, backed by a new JSON API, with webviews kept only for secondary
flows. **Build 3 with all of this is uploaded to Apple and verified working
on both iPhone and iPad simulators.** What's left is almost entirely
App-Store-Connect bookkeeping + new screenshots + resubmit.

---

## 2. Rejection history (read the actual Apple text before assuming anything)

- **First rejection** (submission `2e462374-fbb7-41fc-a72a-e920e487e429`,
  2026-07-16): Guideline 2.3.6 (age-rating metadata mismatch) + 4.2 (minimum
  functionality — webview wrapper). Fixed with build 2: real push
  notifications (APNs), native camera, native share, native geolocation
  (browser-level), haptics, offline banner, age-rating corrected to 4+.
- **Second rejection** (same submission thread, reviewed 2026-07-28,
  device iPad Air 11" M3, iPadOS 26.5.2):
  - **Guideline 2.1(a) — App Completeness (real bug):** *"The app failed to
    display the Apple login option and automatically approved the user for
    login."* The Apple button was a plain form POST to a dev-static
    auto-login, never invoking real Sign in with Apple.
  - **Guideline 2.3.3 — Accurate Metadata:** *"The 6.5-inch iPhone and
    13-inch iPad screenshots only display a login screen."*
  - **Guideline 4.2 — Minimum Functionality (again, more pointed):**
    *"Including features such as push notifications, Core Location, or
    sharing do not provide a robust enough experience to be appropriate for
    the App Store."* — i.e. build 2's native additions were explicitly
    judged insufficient. This forced the bigger architectural decision below.

**User's decision on 4.2** (asked via structured options — "native home
screen only" / "native shell + webview" / "full native core" / "something
else"): chose **"Full native core (bigger rebuild)"** — real native
SwiftUI screens for Home, Shop detail, and Orders against a proper JSON
API; webview only for long-tail pages (legal, owner dashboard).

---

## 3. What's been built and verified (build 3)

### 3a. Fix for 2.1(a) — real native Sign in with Apple
- Enabled **Sign In with Apple** capability on the `sg.ggmt.una5aha` App ID
  at developer.apple.com (it had **never actually been turned on** despite
  `AUTH_SETUP.md` flagging it as a prerequisite — this was the root cause).
- Added `com.apple.developer.applesignin` entitlement to
  `ios-app/ios/App/App/App.entitlements`.
- Installed `@capacitor-community/apple-sign-in` (used inside the webview
  fallback path only now — see below, the native app has its own
  AuthenticationServices flow).
- **Verified live**: tapping Apple on-device triggers Apple's actual
  system "Sign in to your Apple Account" sheet (confirmed via screenshot —
  simulator has no Apple ID configured, which is expected and fine; a real
  device or Apple's own review devices will show the real account picker).
- The web welcome page's Apple button (for browser/PWA testing outside the
  native app) no longer has any dev-static shortcut — it leads to the email
  sign-in form instead. Google/Facebook buttons were already hidden earlier
  (same fake-login risk, not yet real).

### 3b. Fix for 2.3.3 — needs REDO with native screenshots (see §5)
Old (webview) screenshots showing real content (not login) were uploaded to
App Store Connect earlier — iPhone 6.5" and iPad 13" sections both show
2 screenshots each, no error banner. **BUT** now that the app is fully
native, those webview-styled screenshots are stale and should be replaced
with screenshots of the actual native UI (see §5 — in progress, one is
mid-capture-fail and needs a retake).

### 3c. Fix for 4.2 — full native SwiftUI core (the big one)
**New JSON API** (`src/lib/app.mjs`, pushed to production, live):
- `GET /app/api/home?q=&city=` → `{ city, flash: [...], shops: [...] }`
  (shops now include `lat`/`lng`)
- `GET /app/api/shop/:id` → `{ shop, special, dishes }`
- `GET /app/api/orders?phone=` → `{ orders: [...] }`
- Verified working locally and live (curl-tested, real data returned).

**New native Swift file**: `ios-app/ios/App/App/NativeApp.swift` (~550
lines) — the entire native core:
- `RootView` — native `TabView`: Home / Orders / Map / Account
- `HomeView` — native list, flash-card carousel, search, pull-to-refresh,
  calls `/app/api/home`
- `ShopView` — native shop detail, dish list, **native basket** (in-memory
  `BasketLine` state), native "View basket" bar
- `OrderSheet` — native form (name/phone/pickup time via `@AppStorage`),
  POSTs to the **existing** `/app/order` endpoint (form-urlencoded) — basket/
  checkout logic was NOT reimplemented, it reuses the proven server route
- `OrdersView` — native list, calls `/app/api/orders?phone=` (phone
  remembered via `@AppStorage("buyerPhone")`)
- `ShopsMapView` — **real MapKit** `Map` view with annotations from
  `/app/api/home`'s shop `lat`/`lng`, tap a pin → native shop detail
- `AccountView` — **native `SignInWithAppleButton`**
  (AuthenticationServices), posts the real identity token to the existing
  `/app/auth/apple` verified-JWKS endpoint; also lists webview-backed rows
  (profile, shop-owner signup, support, terms, privacy) opened via `WebSheet`
- `WebSheet` / `WebViewRepresentable` — a `WKWebView` wrapper that
  **syncs native cookies into the webview's cookie store first**, so signing
  in with Apple natively also authenticates the webview-backed secondary
  pages
- `PushRegistrar` — native APNs registration (`UNUserNotificationCenter` +
  `UIApplication.registerForRemoteNotifications`), no Capacitor bridge
  needed for this; posts token to `/app/push/register`
- `DataImage` — dish/shop photos are stored as base64 **data URIs** in
  Mongo; this decodes them directly to `UIImage` (SwiftUI's `AsyncImage`
  does not handle `data:` URIs via `URLSession`, so this was necessary)

**AppDelegate.swift**: now creates a `UIWindow` with
`UIHostingController(rootView: RootView())` as the root — the native
SwiftUI tree is the actual app root, not Capacitor's bridge view. Also
calls `PushRegistrar.shared.requestAndRegister()` on launch, and forwards
APNs device-token callbacks to `PushRegistrar`.

**Info.plist**: `UIMainStoryboardFile` key removed (native code creates
the window programmatically now).

**project.pbxproj**: `NativeApp.swift` wired into the `App` target's
Sources build phase; `CURRENT_PROJECT_VERSION` bumped to **3** (both
Debug/Release configs).

**Build verification**:
- `xcodebuild ... build` → **BUILD SUCCEEDED** on first real attempt (iPhone
  17 simulator), and again on iPad Pro 13" (M5) simulator.
- **Manually tested in the simulator, all 4 tabs confirmed working**:
  Home (flash card + shop list render with live data) → tapped into Shop
  detail (real dish list, images, prices) → added 2 items to basket (native
  basket bar showed "2 item(s) · US$6.83 · LKR 2,050", correct) → Orders tab
  (empty state renders correctly) → Account tab (Sign in with Apple button
  present, tapping it correctly invoked Apple's real native sheet) → Map tab
  (real MapKit map rendered with a pin for Ceylon Kitchen Colombo near
  Colombo, correctly positioned).
- Also verified on iPad — Home screen renders correctly (native, not
  webview-cramped).
- **Archived and uploaded to App Store Connect**: `xcodebuild archive` →
  `xcodebuild -exportArchive` both succeeded, "Upload succeeded" confirmed.
  This is **build `1.0 (3)`**, currently processing/ready at Apple, **NOT
  yet attached to the version** in App Store Connect (version still has
  build 2 attached from the last rejection).

---

## 4. Everything already committed and pushed (git log, newest first)

```
797bc2d Native SwiftUI core (guideline 4.2 rebuild): Home, Shop+basket+ordering,
        Orders, MapKit map, Account with native Sign in with Apple
55283fb JSON API for the native app: /app/api/home, /app/api/shop/:id, /app/api/orders
941778d Fix Apple review bug 2.1(a): real native Sign in with Apple
616efe4 Native app layer for App Review 4.2: push notifications (APNs), ...
        [older, from first rejection]
```
All pushed to `ggmt main` (`Gaminigz/GK-Newsroom`, remember to
`gh auth switch --user Gaminigz` before pushing — this repo drifts to the
`yaikhsales` gh account otherwise, a known recurring gotcha).

---

## 5. Exactly what's left — pick up here

### Step A — Redo the App Store screenshots (native UI, not webview)
Screenshots must show the **native app**, not the old webview screens
(they'd look inconsistent / arguably still risk a 2.3.3-style complaint
about accuracy). Location: `~/Desktop/3una5aha-AppStore-v3/`.

**Current state of that folder** (as of the interruption):
- `1-home-iphone.png` — ✅ good, native Home tab, 1284×2778, verified
- `2-shop-iphone.png` — ✅ good, native Shop detail (Ceylon Kitchen Colombo,
  dishes visible), 1284×2778, verified
- `3-map-iphone.png` — ❌ **WRONG, needs redo**. A mis-tap landed on
  "Report this shop" which opened Safari; this file is actually a screenshot
  of Safari's report-a-problem page, not the map. **Do not upload this one.**
  The real Map tab (confirmed working live, native MapKit, pin rendered
  correctly for Ceylon Kitchen Colombo near Colombo) was seen on-screen but
  never saved to disk before the session was interrupted for handover.

**To finish (iPhone, 3 screenshots recommended — Home, Shop, Map)**:
```bash
# Simulator: iPhone 17, app already builds via the archive at /tmp/App-b3.xcarchive
# (or rebuild: cd ios-app/ios/App && xcodebuild -project App.xcodeproj -scheme App \
#   -destination 'platform=iOS Simulator,name=iPhone 17' build)
xcrun simctl boot "iPhone 17" 2>/dev/null
open -a Simulator
xcrun simctl launch "iPhone 17" sg.ggmt.una5aha
# Tap Map tab carefully (bottom nav, ~4th icon) — NOT "Report this shop" if still on a shop page.
# Best to go Home tab -> Map tab directly, skip Shop page, to avoid the mis-tap risk.
xcrun simctl io "iPhone 17" screenshot ~/Desktop/3una5aha-AppStore-v3/3-map-iphone-raw.png
cd ~/Desktop/3una5aha-AppStore-v3 && sips -z 2778 1284 3-map-iphone-raw.png --out 3-map-iphone.png
```
**Then repeat for iPad** (`iPad Pro 13-inch (M5)` simulator, target size
2064×2752, no resize needed — see prior session's pattern, `sips -Z` not
needed since simctl screenshot on that sim already outputs 2064×2752
directly) — need at minimum a Home shot; Shop + Map recommended too, to
directly address "screenshots only display a login screen" with maximum
confidence for both device classes Apple explicitly named.

### Step B — Upload screenshots in App Store Connect (needs the user's hands)
File-picker dialogs cannot be driven by browser automation (confirmed
repeatedly this session — `<input type=file>` requires native OS dialog,
Claude's browser pane cannot access the user's local Desktop folder). Copy
the pattern from earlier in this session verbatim:
1. Navigate to `https://appstoreconnect.apple.com/apps/6789434204/distribution/ios/version/inflight`
   (session will have expired — user must sign in with Apple ID + 2FA each
   time; this happened repeatedly this session, it's normal, just wait for
   "ok logged in"/"ok in" from the user before re-navigating).
2. iPhone tab → 6.5" Display → **Delete All** → confirm → **Choose File**
   → select the 3 new `-iphone.png` files **ONE AT A TIME** (multi-select
   caused wrong-file mix-ups twice this session — the `-6.5` vs plain
   filename confusion doesn't apply this round since v3 files are pre-sized
   correctly, but single-file uploads are still safer and were what
   finally worked reliably).
3. iPad tab → 13" Display → **Delete All** → confirm → **Choose File** →
   same, one at a time.
4. Confirm no red "dimensions wrong" banner appears. Screenshots auto-save
   on upload (the page's "Save" button stays disabled — this is normal,
   confirmed this session).

### Step C — Swap build 2 → build 3
On the same version page, scroll to the **Build** section:
1. Click the build's red **remove (−)** icon to detach build 2.
2. Click **Add Build** (or similar) → select **build 3 (1.0 (3))** — it
   should be visible if processing finished; if it still shows "Processing"
   wait and refresh.
3. It will likely re-ask the **export compliance** question (asked twice
   already this session, same answer both times): *"What type of encryption
   algorithms does your app implement?"* → select **"None of the algorithms
   mentioned above"** (the app only uses standard HTTPS).

### Step D — Reply letter + resubmit (needs explicit user sign-off — do not send unilaterally)
Draft covering all 3 issues from the second rejection. Suggested content
(adapt/confirm wording with the user before sending — this is an outward
message to Apple reviewers, treat as a communication requiring approval):

> Thank you for the detailed review. All three issues have been addressed:
>
> **Guideline 2.1(a) (Bug):** Fixed. The Apple sign-in button now invokes
> real native Sign in with Apple (AuthenticationServices) — previously it
> was a placeholder that skipped authentication. The App ID's Sign In with
> Apple capability, which had not been enabled, is now configured.
>
> **Guideline 2.3.3 (Screenshots):** Fixed. New screenshots show the app's
> actual home feed, shop browsing, and map — not a login screen.
>
> **Guideline 4.2 (Minimum Functionality):** We've rebuilt the core buyer
> experience as fully native SwiftUI — Home, restaurant browsing, ordering,
> and a live map are now native screens (not a webview), backed by our own
> JSON API. Sign in with Apple, push notifications, and MapKit are used
> natively throughout. The webview is now used only for secondary account
> pages (profile editing, becoming a seller, legal pages).
>
> Test accounts: buyer `a@a.com` / `111111` · shop owner `aa@a.com` /
> `111111`.
>
> Thank you for your time.
> GGMT PTE. LTD.

Then click **Update Review** / **Resubmit**.

---

## 6. Known gotchas hit repeatedly this session (don't rediscover these)

- **App Store Connect session expires constantly** in the browser pane —
  every navigation after a few minutes idle can land back at Apple's sign-in
  screen. Always re-check with `get_page_text` before assuming a page loaded;
  don't assume a stale session, just ask the user to sign in again.
- **File uploads need the user's literal clicks** — no way around this with
  browser automation tooling available.
- **Multi-select file pickers are risky** — filenames like
  `2-shop-iphone.png` vs `2-shop-iphone-6.5.png` look identical at a glance
  in Finder icon view; single-file uploads avoid mix-ups entirely.
- **`gh auth switch --user Gaminigz`** before every push to this repo, or
  you'll get a 403 (this repo's git remote silently prefers the
  `yaikhsales` gh account otherwise).
- **The Simulator window relocates/closes** between long gaps in the
  session (observed multiple times — likely the host environment recycling
  something). Always re-verify with a screenshot before assuming simulator
  state, and re-boot/re-launch if needed:
  `xcrun simctl boot "iPhone 17"; open -a Simulator; xcrun simctl launch "iPhone 17" sg.ggmt.una5aha`
- **Coordinate drift**: computer-use screenshots sometimes land on a
  different monitor than expected after window moves — always take a fresh
  `screenshot` before clicking, don't chain blind clicks across turns.
- **`document.querySelector('input[type="file"]').click()` does nothing
  useful** — it may open a picker the browser automation still can't see or
  fill; don't waste time on JS workarounds for file inputs, hand off to the
  user immediately.
- **Export options plist** for archive uploads lives only at `/tmp/exportOptions.plist`
  — it does not persist across environment resets; recreate it if
  `xcodebuild -exportArchive` fails with "file not found":
  ```
  cat > /tmp/exportOptions.plist <<'EOF'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>method</key><string>app-store-connect</string>
    <key>destination</key><string>upload</string>
    <key>teamID</key><string>4KX4774V2U</string>
    <key>uploadSymbols</key><true/>
    <key>signingStyle</key><string>automatic</string>
  </dict></plist>
  EOF
  ```

---

## 7. Reference / credentials already set up (don't recreate)

- **Bundle ID**: `sg.ggmt.una5aha` · **Team**: `4KX4774V2U` (GGMT PTE. LTD.)
- **Apple ID (App Store Connect app record)**: `6789434204`
- **APNs push key**: Key ID `727T9G6ASG` ("una5aha push topic",
  topic-specific to avoid the 2-key team-scoped limit), `.p8` backed up at
  `~/Documents/apple-keys/AuthKey_727T9G6ASG.p8` (one-time download, already
  used, cannot re-download — don't lose this file). Set on Railway **web**
  service as `APNS_KEY_ID` / `APNS_KEY_P8` / `APNS_TEAM_ID=4KX4774V2U` /
  `APNS_TOPIC=sg.ggmt.una5aha`. Verified working (test push returned Apple
  `400 BadDeviceToken`, meaning the JWT/key auth succeeded).
- **Live server**: `https://web-production-2b43c.up.railway.app` — Railway
  project `gk-newsroom` (workspace "GK SMART's Projects"), service `web`.
- **Test accounts** (both password `111111`): `a@a.com` = buyer,
  `aa@a.com` = shop owner (Ceylon Kitchen Colombo dashboard).
- Full stack context (Mongo, Railway, repo split from the news-feed
  session) is in the auto-memory `gk-newsroom-stack` — read that too, it's
  loaded automatically every session for this project.

---

## 8. Session boundary reminder

Per earlier project convention: this session (and its continuation) owns
**app development (iOS/Android, `/app` + `ios-app/`)**. The news-feed side
(`/ai`, `/accounting`, pipelines) was handed off to a separate session in
an earlier round — see `NEWSROOM_HANDOVER.md` in the repo root if that ever
needs touching again. Shared files (`serve-web.mjs`, `mongo.ts`) — coordinate
before editing.
