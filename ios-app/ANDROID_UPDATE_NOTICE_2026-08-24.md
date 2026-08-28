# Notice to the Android session — changes landed 24 Aug 2026

Written by the iOS/app session (`gk-dev-68`). **Read this before the next
Play Store submission.** Everything below is already committed and live on
Railway, so the Android WebView is picking up most of it right now whether
you have looked at it or not.

---

## 1. The one thing that needs your hands

I added a permission to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

**It is uncommitted.** The whole `ios-app/android/` tree is untracked in git,
so I left it alone rather than commit someone else's in-progress work. If you
`git clean` or reset that directory, the edit is gone.

Without it the new country feature cannot work on Android at all — the
WebView's `navigator.geolocation` fails silently and every buyer sees the
worldwide shop list.

**Coarse is deliberate.** We resolve to a country, never to a street. Do not
add `ACCESS_FINE_LOCATION`; it asks the user for more than we need and gives
Play Store reviewers a question to ask.

### Probably also needed — please verify, I could not test it

A Capacitor WebView does not automatically grant geolocation to the page even
when the app holds the permission. You normally need `WebChromeClient.onGeolocationPermissionsShowPrompt`
to call `callback.invoke(origin, true, false)`. Check whether the Capacitor
version in use does this for you. **Symptom if missing:** the manifest
permission is granted, Android shows no error, and the page's
`getCurrentPosition` callback simply never fires.

---

## 2. What changed on the server (already live, no action needed)

The Android app is a Capacitor shell pointing at
`https://web-production-2b43c.up.railway.app/app`, so these are already in
front of your users.

### Home follows the country the phone is in

`/app/api/home` accepts `country=KH` **or** raw `lat`/`lng`, which it reverse
geocodes through Nominatim (cached on a 0.1° grid). Shops *and* today's
specials are both scoped to that country — otherwise a traveller in Phnom
Penh is shown a special from a kitchen they cannot reach.

A country with no shops falls back to the worldwide list and sets
`outsideCountry: true` so a client can explain why the food is not nearby.
**Neither the web nor the native app renders that message yet** — the flag is
there, the UI is not. Worth building on your side.

Verified live: Phnom Penh → `KH`, Hanoi → `VN`, Singapore → `SG`, Colombo → `LK`.

### The web geo capture now reloads once

`homePage` wrote the `app_geo` cookie and never reloaded, so the coordinates
only took effect on the buyer's *next* visit. It reloads once after the first
fix. If you see one extra page load on first run, that is why, and it is
intentional.

### "Under registration" instead of "Open now"

`pendingRegistration()` marks a shop that cannot take an order — no owner
signed in, or fewer than **three** priced dishes. Those cards say **"Under
registration" in orange** rather than a green "Open now".

I raised that threshold from one dish to three today. Four shops signed up on
23 Aug and each added exactly one dish while setting up, which cleared a plain
`!dishCount` test and put a green "Open now" on a card with nothing to buy.

### Distance and delivery estimate

Shop cards carry `distanceKm` and `etaMins` (road factor 1.3, 22 km/h moto,
10 min prep). Ayubowan has no `lat`/`lng` yet so it returns `null` for both —
handle the null, do not print "null km".

### Bug fixed: a buyer with no location was at latitude 0

`url.searchParams.get("lat")` returns `null` when absent and `Number(null)` is
`0` — a real coordinate off West Africa that passes `isFinite`. Every Phnom
Penh shop was reported ~15,000 km away with a **41,215-minute** ETA. Fixed;
missing params now stay `NaN`. **If you cached any API responses, drop them.**

---

## 3. Data changes you should know about

- The **-15% badge is gone**. One dish (Chicken Kottu Roti) carried
  `discount: "-15%"`; it is now `"none"`. Shop cards no longer show a deal pill.
- Four new shops are live and branded: Ceylon Masala, Ayubowan Sri Lanka,
  Global Kitchen, and රා Bar. All are **one priced dish each**, so all four
  render as "Under registration". La Pha Ny has 96 priced dishes.

---

## 4. iOS parity — mirror this or the two apps disagree

`NativeApp.swift` gained:

- `CountryLocator` — `CLGeocoder` resolves the ISO country on device, and
  `HomeView` passes it as `country=` and reloads when the fix lands.
- `ShopSummary` now decodes `pending`, `distanceKm`, `etaMins`. It had none of
  these fields, which is why the native rows showed every shop as open while
  the web cards had been correct for a while.

Android gets the server behaviour for free through the WebView. **The only
Android-side work is the manifest permission and the geolocation prompt
callback.**

---

## 5. Before you submit to Play

1. Commit the `ios-app/android/` tree — it is entirely untracked, so nothing
   in it is backed up, including the manifest edit above.
2. Confirm `getCurrentPosition` actually fires inside the WebView on a real
   Android device. The Play listing will need a location-permission
   justification once it does.
3. The APK at `android/app/build/outputs/apk/debug/app-debug.apk` is a **debug**
   build (`versionCode 1`, `versionName "1.0"`) from 21 Aug. Play needs a
   signed release build and a versionCode above 1.
4. Decide what to show when `outsideCountry` is true. Right now a traveller in
   a country with no shops silently sees worldwide results with no explanation.

Questions to Gamini directly — I am not tracking Android.
