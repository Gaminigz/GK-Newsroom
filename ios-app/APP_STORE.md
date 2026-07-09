# 3una 5aha — App Store submission kit

Everything for App Store Connect, prepared 2026-07-09. The Xcode project
lives in `ios-app/ios/App/App.xcodeproj` (Capacitor 8, SPM).

## Identity
- **Bundle ID:** `sg.ggmt.una5aha` (register in App Store Connect → same id)
- **App name:** 3una 5aha
- **Subtitle (30 chars):** Sri Lankan food near you
- **Category:** Food & Drink (secondary: Shopping)
- **Age rating:** 4+ (questionnaire: all "No")
- **Company / Publisher:** GGMT PTE. LTD. (Singapore) — https://www.ggmt.sg

## Description (draft)
Find Sri Lankan restaurants near you — anywhere in the world.

3una 5aha (තුන පහ) is a non-commercial community app that hosts Sri Lankan
restaurants and home cooks posting their business activities: dishes, daily
specials, deals and events. Travelling? Open the app and see today's deals
from Sri Lankan kitchens near your location. Order for pickup and chat
directly with the cook.

Run a Sri Lankan restaurant or cook from home? List yourself in one
minute — completely free. 3una 5aha charges no fees and takes no
commission: it exists to connect the worldwide Sri Lankan food community.

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
- **Marketing:** https://www.ggmt.sg

## Privacy "nutrition label" answers (App Privacy section)
Data collected, linked to user, not used for tracking:
- Contact info: name, phone (orders only)
- User content: order messages, shop listings
- Identifiers: none · Location: approximate coordinates WITH user permission, used only to show nearby restaurants/deals; kept on device (cookie), not stored server-side with identity
No third-party advertising, no tracking, no data sold.
Account deletion: in-app link (Support page) + email — already required and live.

## Review notes (paste into App Review notes field)
Non-commercial community app (free listings, no fees/commission) hosting Sri Lankan restaurants; travellers find dishes nearby via location. Sign-in buttons are present; browsing works as guest with no login. To see the seller side:
tap "Sell on 3una 5aha" and register a test shop (instant, no approval
gate). Test order: open any shop, add a dish, checkout with any name and
phone. Support/deletion: /app/support (email, Telegram, WhatsApp). Publisher: GGMT PTE. LTD. — www.ggmt.sg. Content moderation: operators
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
