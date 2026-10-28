# IEWS → GKVerify Telegram phone verification

Source: https://github.com/Gaminigz/GK-Newsroom (`main`).

Base URL: `https://ecom.ggmt.sg/30da/hub/verify/telegram`

This contract belongs to `src/lib/thirtyda-hub-verify.mjs`. It is available only after that module's commit is deployed to the web service. A local file or Git commit alone does not enable these endpoints. Do not substitute the old `/30da/api/auth/telegram/*` routes: they sign into 30+DA.

## 1. Configure the Hub once

1. Sign into https://ecom.ggmt.sg/30da/admin/connections and open **Telegram Bot**, tower 2.
2. Leave the existing bot key and webhook in place. The bot must be enabled after its existing successful check.
3. Under **Shared verification · IEWS**, save the actual IEWS HTTPS page that users should return to, for example the IEWS phone-verification screen. The IEWS maintainer supplies this URL. It must have no query parameters or fragment. No invented URL is required by the API.
4. Click **Create IEWS key**. Copy the key displayed once into the IEWS backend's secret manager as `IEWS_GK_VERIFY_TOKEN`.
5. Set `IEWS_GK_VERIFY_BASE=https://ecom.ggmt.sg/30da/hub/verify/telegram` on the IEWS backend. Restart/redeploy IEWS as its environment configuration requires.

The verification key starts `verifyiews_`. It is separate from Telegram's bot token and the Local AI token. All development sessions working on the same IEWS backend use that backend's configuration; they do not each create a bot/key or run `setWebhook`. Replacing/revoking this key immediately invalidates access to checks started with the previous key.

## 2. Start from the IEWS backend

The IEWS frontend calls **its own backend** after the user enters a number. Require the existing IEWS session or a short-lived pending-registration session and your normal CSRF/rate-limit checks. Never expose the GKVerify key in browser JavaScript, an APK, a URL, a screenshot, or a Git commit.

The IEWS server generates a random UUID `reference` for this attempt. Save `{reference, user/session ID, phone, request_id, expires_at}` server-side. One active attempt per IEWS user/session is recommended; a newer attempt supersedes the previous local binding. Reuse the same reference only when retrying the same start call after a network failure. A changed phone or a fresh attempt gets a new reference. Do not use an email/phone/user ID as the reference.

```http
POST /30da/hub/verify/telegram/requests
Authorization: Bearer <IEWS_GK_VERIFY_TOKEN>
Content-Type: application/json

{"phone":"+85512345678","reference":"a92255bf-7568-4c6b-a631-73e67d267f91"}
```

Phone is E.164: `+` country code followed by digits, no spaces. Reference is 16–100 letters, digits, `_` or `-`. Shared bot messages currently use English.

Response `201` (including an idempotent retry):

```json
{
  "request_id": "<64 lowercase hex characters>",
  "reference": "a92255bf-7568-4c6b-a631-73e67d267f91",
  "status": "waiting",
  "telegram_url": "https://t.me/<configured-bot>?start=<opaque-token>",
  "match": "🍊 47",
  "expires_at": "<ISO timestamp>",
  "poll_after_ms": 2000
}
```

Return only the necessary display fields to the IEWS frontend. Show the match sign beside the **Open Telegram** button; open `telegram_url` exactly as returned. Do not construct a bot username or a start token yourself. On mobile, keep the IEWS waiting screen intact while Telegram opens. On desktop, open Telegram in a separate tab/window.

The user taps Telegram's Start button if prompted, checks the matching sign, then taps **Share my number**. Our server requires both the contact's Telegram user ID to match its sender and the contact's phone to match the requested number. A typed number or someone else's contact never verifies. The first Telegram user opening this attempt owns it.

## 3. Poll from IEWS backend

While the waiting screen is active, the IEWS frontend asks its own backend for status about every two seconds. The IEWS backend loads this attempt from its authenticated session binding and calls:

```http
GET /30da/hub/verify/telegram/requests/<request_id>
Authorization: Bearer <IEWS_GK_VERIFY_TOKEN>
```

Response `200`:

```json
{
  "request_id": "<same request ID>",
  "reference": "a92255bf-7568-4c6b-a631-73e67d267f91",
  "status": "waiting",
  "expires_at": "<ISO timestamp>"
}
```

Statuses:

| Status | IEWS action |
| --- | --- |
| `waiting` | Keep waiting/polling. |
| `verified` | Collect the result below, from the backend. |
| `consumed` | Your backend may retry collection if its previous response was lost; otherwise show its saved outcome. |
| `mismatch` | Explain that Telegram's number differs; start again with a new reference after correcting it. |
| `expired` | Stop polling and offer a fresh attempt with a new reference. |

The request lasts ten minutes. Verification close to expiry grants at least two minutes to collect it. Use the returned expiry. **Back to IEWS** only opens your configured page; URL arrival does not prove verification. Recover the user's pending attempt through IEWS's own session and query the Hub again. No verification proof or phone number is placed in the return URL.

## 4. Collect and update the IEWS user

```http
POST /30da/hub/verify/telegram/requests/<request_id>/consume
Authorization: Bearer <IEWS_GK_VERIFY_TOKEN>
Content-Type: application/json

{}
```

Response `200`:

```json
{
  "request_id": "<same request ID>",
  "reference": "a92255bf-7568-4c6b-a631-73e67d267f91",
  "status": "consumed",
  "app": "iews",
  "phone": "+85512345678",
  "verified_at": "<ISO timestamp>",
  "consumed_at": "<ISO timestamp>"
}
```

Before updating an account, the IEWS backend must check ALL of these against its saved active attempt:

- Same authenticated/pending-registration session and user.
- Same `request_id`, `reference`, and normalized phone.
- `app === 'iews'`, `status === 'consumed'` and a `verified_at` timestamp.
- Attempt is still the current one for that user/session, not a superseded attempt.

Then atomically mark the intended IEWS user's phone verified and mark the local attempt completed. Enforce IEWS's existing policy if another account already owns that number; GKVerify does not decide account merging, login, ownership conflicts or access permissions. Idempotent collection with the same key and ID is supported until expiry, so a lost HTTP response must not cause duplicate IEWS accounts or repeated side effects.

Do not accept `verified:true`, a phone, or a Hub request ID supplied by an unrelated browser session as proof. Verification proves control of the Telegram account whose own shared number matches; it is not a fresh SMS challenge or identity/age verification.

## 5. Errors and limits

Errors have `{ "error": "<code>", "message": "<plain text>" }`.

| HTTP / error | Action |
| --- | --- |
| `401 unauthorized` | Missing/wrong/revoked IEWS key. Fix server configuration; do not ask users to retry their number. |
| `403 server_only` | Called with browser Origin. Route it through IEWS backend. |
| `404 not_found` | ID unknown or not owned by the current key; very old checks may have been purged. |
| `409 reference_conflict` | Start reference reused for a different number/expired attempt; generate a new one. |
| `409 not_verified` | Collection before successful verification. |
| `410 expired` | Collection attempted after expiry. |
| `415 json_required` / `400 invalid_json` / `422 invalid_phone` or `invalid_reference` | Correct the request format. |
| `429 rate_limited` | Back off; do not keep opening new attempts. |
| `503 bot_unavailable`, `setup_required`, `unavailable` | Hub/configuration problem; keep phone unverified and show a retry option. |

Current Hub limits per server process, over 15 minutes: 100 new checks per IEWS key, five new checks per phone, 12,000 authenticated start/status/consume requests per key. Retrying an existing start does not consume the new-check allowance. IEWS must also enforce its own durable per-user/session/IP limits and timeouts. These Hub limits are not a distributed quota across replicas/restarts.

The checks are short-lived Mongo records; automatic cleanup is approximately 40 minutes after creation and is asynchronous. A later Hub settings snapshot shows current retained states, not lifetime usage. No IEWS user or 30+DA user is created by the shared endpoints.

## Ready-to-import Node.js helper

Use [`examples/iews-gkverify.mjs`](examples/iews-gkverify.mjs) from your IEWS server. It requires Node 20+ and the two environment variables above. It handles HTTP calls only; the IEWS session binding and database updates described above remain mandatory.

```js
import crypto from 'node:crypto';
import { startPhoneCheck, phoneCheckStatus, collectPhoneCheck } from './iews-gkverify.mjs';

const reference = crypto.randomUUID();
const check = await startPhoneCheck({ phone: '+85512345678', reference });
// Persist check.request_id + reference + phone against the current IEWS user/session.
// Frontend displays check.match and opens check.telegram_url.

const state = await phoneCheckStatus(check.request_id); // Called later, while polling.
if (state.status === 'verified' || state.status === 'consumed') {
  const proof = await collectPhoneCheck(check.request_id);
  // Validate proof against your saved active attempt, then atomically update your IEWS user.
}
```

No real email, phone contact, bot key or application key is included in these examples. The sample number is illustrative; do not send a real verification request until a consenting user initiates it.
