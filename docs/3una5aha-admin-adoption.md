# 3una 5aha administration in GK Workspaces

## What is adopted

The third workspace card opens `/30da/admin/shops`. It uses the existing GK super-admin session and the same `getDb()` database as the marketplace. It does not copy records or change a native app's server address.

The administration routes are in `src/lib/thirtyda-admin.mjs`, the data/actions are in `src/lib/thirtyda-shop-admin.mjs`, and the interface is `src/thirtyda-admin/shops.*`.

## How it affects the apps

| Admin operation | Stored change | Actual app effect |
| --- | --- | --- |
| Set active / pending / suspended | `shop_owners.status` | `activeShops()` selects active shops for buyer discovery. Direct shop/order/owner paths do not consistently enforce suspension. |
| Resolve report | `app_reports.status`, resolution, actor and time | Removes it from the open admin report queue. It does not change the shop status. |
| Remove listing | Archive in `shop_admin_removed_dishes`, then conditional deletion from `app_dishes` | App menus stop reading that record. Existing order snapshots retain item names/prices. Listing ID and original data are retained for restoration. |
| Restore listing | Insert original listing ID/data; mark archive restored | The record becomes available to the existing menu logic again. Meal plans, off-menu flags and shop visibility still apply. |
| Read orders | No order mutation | Oversight of the latest 200 records; operational transitions remain with seller POS/kitchen. |
| Read chats | No message mutation | Latest 100 order conversations, last eight messages each. No message is sent from the admin. |

Shop actions require the shared admin session, JSON writes subject to existing origin checks, a valid record ID and a written reason. They are rate limited. Action logs go to `admin_activity` and the GK `thirtyda_audit` collection. A session fingerprint identifies new GK events; the shared admin code does not identify a named human.

Menu changes have an operation lock and optimistic comparison against the original document to avoid deleting a concurrent seller edit. The archive is written before removal. These operations span multiple records; an infrastructure failure can interrupt a change, so the UI asks the admin to refresh before retrying an uncertain result. They are not a cross-collection transaction.

## Existing seller and order logic

Source: `src/lib/app.mjs` and `src/lib/shop-suite.mjs`.

- Shop registration currently creates an active shop immediately. Pending is an available state, not the current default onboarding gate.
- `status` and the seller's `open` flag are separate: platform discovery eligibility and kitchen availability.
- Online, native-app and table orders begin `pending_review`. The seller POS can hold them (`on_hold`) or send them to the kitchen (`pending`).
- Kitchen progression is `pending → preparing → done → delivered`. Counter orders enter `pending` directly. Newer kitchen endpoints validate the previous state; older order-status endpoints coexist.
- Payment records (`paidAt` and payment-provider fields) are separate from kitchen status. Stored order/menu prices in this admin are displayed in the marketplace's LKR base currency, not claimed to be bank settlement totals.
- Buyer and seller messages are embedded in `app_orders.messages`.
- The seller suite has working routes for QR, daily menu, POS, messages, kitchen, menu/portion/purchase planning, stock, buying/bills, bill history and bank setup. Staff pay/salary, utilities, accounting, dashboard and business-health tiles remain marked as previews in this source snapshot.

## Legacy gaps requiring their own application changes

1. Suspension is a discovery filter, not consistently an authorization rule on direct routes.
2. Several owner operations select a shop by path ID without a consistent server-side owner-session check. Adopting the admin does not repair seller authentication or revoke old access paths.
3. The legacy admin's temporary-password action writes `shop_owners.tempPassword` and `mustReset`. Marketplace sign-in checks `app_users.hash` instead; those reset fields are not consumed. The new workspace therefore does not offer that disconnected action.
4. The old standalone `/admin` console remains accessible through its existing authentication. Retiring it requires a separate routing decision after adoption is accepted.

## Scope of this release

The marketplace administrative interface is adopted under GK Workspaces. Seller app workflow and endpoints retain their current behavior. The logic page explains the gaps above, so an admin does not mistake a discovery change for a complete account lock.

Syntax checks were performed on the new JavaScript and handler changes. No business-data mutations were used to exercise the controls.
