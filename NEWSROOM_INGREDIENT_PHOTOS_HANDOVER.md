# Handover — generate shared ingredient photos for the 3una 5aha app

**Written 2026-08-08. For a fresh session working on the newsroom / image-gen side of this repo.**

## What this is

The 3una 5aha app's Kitchen Stock screen currently renders ingredient rows
with plain initial bubbles ("C" for Chickpeas, "CM" for Coconut milk, etc.).
The app-side ([shop-suite.mjs](src/lib/shop-suite.mjs) `stockPage`) is already
wired to render an `<img>` thumbnail instead whenever a matching photo exists
in a shared Drive folder — but no photos are there yet.

Your job: **populate that folder** with one AI-generated photo per ingredient
in `LANKA_INGREDIENTS` and `LANKA_SPICES`, using the same Gemini image-gen
pipeline this repo already uses for food posts.

Photos are **shared across every shop** — Chickpeas look the same in Amila's
La Pha Ny shop in Phnom Penh as in a Colombo shop. Only per-shop quantities
and local market prices differ.

## Target Drive folder

Google Drive folder ID: **`1fxKgtIc2L7CCJE0BEOK-KOLNU7PwQv_z`** (`3una 5aha photos/App photos`)

Access via the same service account already provisioned:
- Service account email: `una5aha-drive@una5aha.iam.gserviceaccount.com`
- Credentials JSON: `~/Downloads/una5aha-1916c10edb0f.json` (also on Railway as `GOOGLE_DRIVE_CREDENTIALS_JSON`)
- Env var already set on Railway `web` service: `GOOGLE_DRIVE_APP_PHOTOS_FOLDER_ID=1fxKgtIc2L7CCJE0BEOK-KOLNU7PwQv_z`

## Filename convention (critical — app matches by slug)

The app-side lookup is [`ingredientSlug()` in drive.mjs](src/lib/drive.mjs) — it
canonicalises the ingredient name so `"Red Onion (Shallot)"` → `red-onion-shallot`.
Uploads must use the slug + `.jpg`.

| Ingredient name | Uploaded filename |
|---|---|
| Big Onion | `big-onion.jpg` |
| Red Onion (Shallot) | `red-onion-shallot.jpg` |
| Curry Leaves | `curry-leaves.jpg` |
| Fish (Thora) | `fish-thora.jpg` |
| Chicken (curry cut) | `chicken-curry-cut.jpg` |
| Coconut milk | `coconut-milk.jpg` |

**Import the exact slug function** rather than re-implementing:
```js
import { ingredientSlug } from "./src/lib/drive.mjs";
```

## Source ingredient list

Read [src/data/lanka-ingredients.mjs](src/data/lanka-ingredients.mjs) — that's the
authoritative catalogue. Four categories: **Vegi, Meat, Dry, Spices**. Each item
has `{ name, si (Sinhala), unit }`. Roughly ~150 items total.

The `lanka_spices` Mongo collection (48 docs) has additional spice-specific
entries with `postNumber` matching newsroom posts — those posts already have
generated food-content images, but they're **dish** images not **ingredient**
images. Do not reuse those wholesale.

## Suggested pipeline

1. Load `LANKA_INGREDIENTS` from `src/data/lanka-ingredients.mjs`.
2. Flatten to one list of `{ category, name, si, unit }` — about 150 items.
3. For each item:
   - Compute slug via `ingredientSlug(name)`.
   - Skip if `<slug>.jpg` already exists in the Drive folder (idempotent — safe to re-run).
   - Prompt Gemini for a clean product photo: "Studio photo of {name} on a plain white background, top-down, no props, no text, food photography, high contrast, no shadows, {optional Sinhala hint}". Follow the same style as [src/scripts/gen-images.mjs](src/scripts/gen-images.mjs).
   - Save the returned JPEG (or convert PNG → JPEG) as `<slug>.jpg` — quality 80, max 800×800 to stay well under Mongo/CDN overhead. lh3.googleusercontent.com will auto-resize on request via `=w400` suffix if needed.
   - Upload to the Drive folder using the service account (`googleapis` is already installed at project root).
   - Make the file publicly readable (`permissions.create { role: "reader", type: "anyone" }`) so `https://lh3.googleusercontent.com/d/<fileId>` resolves for buyer WebViews.
4. Log a manifest to stdout: `slug, fileId, url` — useful for spot-checking.

Reuse the upload pattern already in [src/lib/drive.mjs](src/lib/drive.mjs)
`uploadDishPhoto()` — same auth, same publish step. Just target the App photos
folder instead of the root, and use the slug as the filename directly.

## Cost / quota

- ~150 images × Gemini Flash image gen (~$0.005 each) = **~$0.75 total** one-time.
- Free re-runs skip existing files — idempotent.
- Drive: 150 × ~50 KB thumbnails = ~7.5 MB storage. Well within the 15 GB free tier.

## How the app picks them up

No app-side deploy is needed after your run. The Kitchen Stock page maintains
an in-memory cache of the folder listing (`getIngredientPhotoMap()` in
`drive.mjs`) with a 5-minute TTL. Photos appear automatically:
- Within 5 min for the first shop that loads Kitchen Stock after your run
- Instantly for the current process on `forceRefresh` (not exposed via UI yet — could add a `?refresh=1` param if useful)

## Success criteria

- All 150 ingredient names in `LANKA_INGREDIENTS` have a matching `<slug>.jpg` in the Drive folder.
- Each file is publicly readable via `https://lh3.googleusercontent.com/d/<fileId>`.
- Opening `https://web-production-2b43c.up.railway.app/app/owner/6a75718da2de19ffac236055/suite/stock` (Amila logged in as `aa@a.com` / `111111`) shows real thumbnails on every row instead of initial bubbles.

## Not in scope for you

- Dish photos: shops upload their own via Manager → Setup Daily Menu (already wired to Drive per-shop).
- Set menu photos: separate followup task.
- Market prices: `src/data/market-prices.mjs` is the source; shops see benchmark comparisons in Purchasing.

## Related files

- App-side lookup: [src/lib/drive.mjs](src/lib/drive.mjs) — `getIngredientPhotoMap()`, `ingredientSlug()`
- Kitchen Stock render: [src/lib/shop-suite.mjs](src/lib/shop-suite.mjs) — `stockPage()`, `thumb()` helper
- Ingredient catalogue: [src/data/lanka-ingredients.mjs](src/data/lanka-ingredients.mjs)
- Existing gen-images pipeline: [src/scripts/gen-images.mjs](src/scripts/gen-images.mjs) — copy the Gemini call pattern
