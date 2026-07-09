# 3una 5aha — App Store submission kit

Everything for App Store Connect, prepared 2026-07-09. The Xcode project
lives in `ios-app/ios/App/App.xcodeproj` (Capacitor 8, SPM).

## Identity
- **Bundle ID:** `sg.ggmt.una5aha` (register in App Store Connect → same id)
- **App name:** 3una 5aha
- **Subtitle (30 chars):** Sri Lankan food, worldwide
- **Category:** Food & Drink (secondary: Shopping)
- **Age rating:** 4+ (questionnaire: all "No")
- **Company:** GGMT PTE. LTD. (Singapore)

## Description (draft)
Find real Sri Lankan food anywhere in the world — cooked by restaurants
and home cooks near you.

3una 5aha (කුළුබඩු — "the spice marketplace") connects you with Sri Lankan
kitchens in your city: browse nearby shops, today's specials and promotions,
order for pickup, and chat directly with the cook about your order.

Selling your own cooking? Open your shop in one minute — publish dishes
with prices, time windows and daily specials, manage incoming orders, and
talk to your buyers. No fees during our launch period.

• Nearby shops and today's specials
• Order for pickup, chat with the cook
• Shop dashboard for sellers — dishes, specials, orders
• Sinhala hints throughout · prices in local currency
• The spice library — 24 Sri Lankan spices with photos and mini-podcasts

## Keywords (100 chars)
sri lanka,sri lankan food,curry,kottu,spices,home cook,pickup,colombo,
ayubowan,rice and curry

## Required URLs (all live)
- **Support:** https://web-production-2b43c.up.railway.app/app/support
- **Privacy Policy:** https://web-production-2b43c.up.railway.app/app/privacy
- **Marketing (optional):** https://web-production-2b43c.up.railway.app

## Privacy "nutrition label" answers (App Privacy section)
Data collected, linked to user, not used for tracking:
- Contact info: name, phone (orders only)
- User content: order messages, shop listings
- Identifiers: none · Location: coarse city string user types (NOT device GPS — until the GPS plugin ships; update this answer when it does)
No third-party advertising, no tracking, no data sold.
Account deletion: in-app link (Support page) + email — already required and live.

## Review notes (paste into App Review notes field)
Marketplace app. No login required to browse. To see the seller side:
tap "Sell on 3una 5aha" and register a test shop (instant, no approval
gate). Test order: open any shop, add a dish, checkout with any name and
phone. Support/deletion: /app/support. Content moderation: operators
suspend shops/users via admin console; users report via Support (24h SLA
stated in Terms).

## Remaining before submission (tracked)
1. Xcode installed → open project, set Signing Team (user's Apple account)
2. Native plugins so it's not a bare wrapper: push notifications (order
   updates), camera (dish photos), geolocation (nearby shops) + in-app
   report button on shop pages
3. Screenshots: 6.7" (1290×2796) + 5.5" (1242×2208) — capture from
   simulator once building
4. TestFlight internal build → then submit

## Signing & upload commands (once Xcode + team set)
```bash
sudo xcode-select -s /Applications/Xcode.app
xcodebuild -runFirstLaunch
cd ios-app && npx cap sync ios
open ios/App/App.xcodeproj   # set Team in Signing & Capabilities once
# archive + upload happens via Xcode Organizer (Product → Archive)
```
