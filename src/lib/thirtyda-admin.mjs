/**
 * 30+DA super admin web — screens 13 (Sign in) + A2 (Users & chat monitor) + Questions.
 *
 *   GET  /30da/admin                      sign-in page (code only)
 *   GET  /30da/admin/monitor              live overview + chat monitor
 *   GET  /30da/admin/questions            the question choices people pick from (Level 1 / Level 2)
 *   GET  /30da/admin/gk-smart-logo.png    the GK SMART logo (96 px) next to "GK API Hub · 30+DA" in every page's header
 *   GET  /30da/admin/gk-smart-favicon.png the tab icon (32 px). Both are named files, like the scripts and styles: a name
 *        from the URL is only ever matched against that list, never read as a path.
 *   POST /30da/admin/api/signin           { code }
 *   POST /30da/admin/api/signout
 *   GET  /30da/admin/api/overview         counts, users, open flags
 *   GET  /30da/admin/api/chat?flag=|user= one full conversation
 *   POST /30da/admin/api/users/:id/block|unblock   { flagId?, undo? } — an App review demo account is never blocked (409)
 *   POST /30da/admin/api/users/:id/delete  { confirm: id } the whole account, for good — the app's own full delete
 *        (src/lib/thirtyda-delete.mjs deleteAccount). The one delete path: Users → Delete and App review → Remove.
 *        → the overview (counts + users); 400 confirm ≠ id, 404 no such profile. Audited with the id only.
 *   POST /30da/admin/api/flags/:id/warn|dismiss    (closing a flag writes resolvedAt + resolvedAction; Block does too)
 *   GET  /30da/admin/api/flags/:id/photo  the photo a report points at (store policy, owner 2026-10-14)
 *   GET  /30da/admin/api/questions        both levels: [{ id:'L1', slots:[[{key,text:{en,km,zh,ko,ja}}×5]×4], titles, … }]
 *   PUT  /30da/admin/api/questions/L1|L2  { slots, titles?, updatedAt? } → saved level | 422 { problems } | 409 changed
 *   POST /30da/admin/api/questions/L1|L2/reset   back to the built-in choices
 *   GET  /30da/admin/connections  (= /30da/admin/code)   the "Code" page: how people get their code / sign in
 *   GET  /30da/admin/api/connections      { keyReady, devAuth, testCodes, onRailway, connections:[{ id, name, set, last4, updatedAt, updatedBy, live, … }] }
 *   PUT  /30da/admin/api/connections/telegram        { token } → saved (encrypted) | 422 bad format | 503 no key
 *   PUT  /30da/admin/api/connections/telegram-bot    { token } the free bot's key: getMe + setWebhook, then saved (encrypted)
 *   POST /30da/admin/api/connections/telegram-bot/try   getMe + getWebhookInfo → the app offers the bot (or stops it)
 *   DELETE /30da/admin/api/connections/telegram-bot  deleteWebhook + remove (src/lib/thirtyda-telegram-bot.mjs)
 *   PUT  /30da/admin/api/connections/whatsapp        { token?, phoneNumberId, templateName, templateLang? } (empty token = keep the saved one)
 *   PUT  /30da/admin/api/connections/google          { clientId, clientSecret? }   (empty secret = keep the saved one)
 *   PUT  /30da/admin/api/connections/facebook        { appId, appSecret? }
 *   PUT  /30da/admin/api/connections/tiktok          { clientKey, clientSecret? }
 *   PUT  /30da/admin/api/connections/apple           { teamId, keyId, privateKey? } Sign in with Apple's key (the .p8; empty =
 *        keep the saved one) — for the token revoke on delete; the sign-in itself needs no key (src/lib/thirtyda-apple.mjs)
 *   POST /30da/admin/api/connections/apple/try       the ES256 client secret + a made-up code at Apple's /auth/token:
 *        invalid_grant = the key works (the tower goes Live), invalid_client = a wrong key → { ok, reason?, detail?, view }
 *   DELETE /30da/admin/api/connections/:id           remove what is saved for telegram | whatsapp | google | facebook | tiktok | apple | translate
 *   Tower 11 · Wan (the GK API Hub: image to video on the M5 for Yai Media Director, src/lib/thirtyda-hub-wan.mjs) — the
 *   page's data carries a `wan` block (status, the M5's last claim, the queue, the tokens' last 4 + made-at, options, jobs):
 *   POST /30da/admin/api/connections/wan/tokens/client|worker   New token: the old one stops at once → { token, kind, view }.
 *        The ONLY answer that carries a token (shown once on the page); kept as its SHA-256 + last 4. Audited with the last 4.
 *   DELETE /30da/admin/api/connections/wan/tokens/client|worker Revoke
 *   PUT  /30da/admin/api/connections/wan/options     { enabled?, sizes?: { '480p', '720p' }, maxSeconds? } → the page's data | 422
 *   POST /30da/admin/api/connections/wan/try         queue a test render of the home picture (source 'try', the same caps)
 *   GET  /30da/admin/api/connections/wan/clips/:id   a Try's clip for the tower's player (byte ranges), never a client's
 *   Tower 12 · Places (our own Phnom Penh place list, src/lib/thirtyda-hub-places.mjs) — the page's data carries a
 *   `places` block (status, the list's time, size and store, the last Overpass ask, the last error):
 *   POST /30da/admin/api/connections/places/refresh   ask OpenStreetMap now, in the background → { ok, view } | 429 too soon
 *   POST /30da/admin/api/connections/places/search    { q, lang } a test search → our hits, Nominatim asked or not (never signed)
 *   PUT  /30da/admin/api/connections/places/google    { enabled?, monthlyCap? } Google's On / Off and cap; its key: the generic
 *        PUT / DELETE /api/connections/googleplaces { key } (src/lib/thirtyda-places-google.mjs; the key's last 4 only)
 *   Tower 13 · Translate (where chat lines are translated, src/lib/thirtyda-hub-translate.mjs) — the page's data carries a
 *   `translate` block (where: host, model, prompt style; On / Off, the wait; the app's numbers; the last Try; never the token):
 *   PUT  /30da/admin/api/connections/translate        { url, model, token?, style } (empty token = keep the saved one)
 *   PUT  /30da/admin/api/connections/translate/options { enabled?, timeoutS? } → the page's data | 422
 *   POST /30da/admin/api/connections/translate/try    { text, from, to | 'all' } → { ok, results: [{ to, ok, text | error, ms }], view }
 *   POST /30da/admin/api/connections/telegram|whatsapp/test   { phone } → a real code to that phone, or why not.
 *        A test that goes through turns the channel on in the app (src/lib/thirtyda-code-send.mjs channelOffer);
 *        the answer carries the page's fresh data (`view`) so the card can say so at once.
 *   GET  /30da/admin/api/connections/google|facebook|tiktok/try    (a new tab) the real sign-in with a test state bound to
 *        this admin session → Google / Facebook / TikTok → the app's callback, which ends on a small "Works ✓ / Did not work"
 *        page and makes no user or session (src/lib/thirtyda-app.mjs signinTry)
 *   Bot Save / Try that went through also set the bot's profile words (setMyDescription / setMyShortDescription, 5
 *        languages, best effort — src/lib/thirtyda-support.mjs describeBot).
 *   GET  /30da/admin/support                  Support: questions people sent the Telegram bot, and the team's replies
 *   GET  /30da/admin/api/support              { chats: [{ chatId, name, username, profileId, lastAt, lastText, unread, … }], unread, bot }
 *   GET  /30da/admin/api/support/unread       { unread } (the sidebar badge on every admin page)
 *   GET  /30da/admin/api/support/:chatId      { chat, messages } — opening it marks it read
 *   POST /30da/admin/api/support/:chatId/reply { text } → the bot sends it to that chat (plain text ≤ 2000) and it is kept;
 *        Telegram refusing (they blocked the bot) comes back in plain words. Audited with ids and lengths only, never text.
 *   GET  /30da/admin/photos                   Photos: new and replaced photos waiting for approval (src/lib/thirtyda-photo-review.mjs)
 *   GET  /30da/admin/api/photos               { photos: [{ user, name, slot, at, url, photoId, blocked, nonePublic }], count } — photo 1 first
 *   GET  /30da/admin/api/photos/count         { count } (the sidebar badge on every admin page)
 *   GET  /30da/admin/api/photos/:photoId      the photo itself, only while it is pending, never cached
 *   POST /30da/admin/api/photos/:userId/:slotIndex/approve   { photoId } → everyone can see it now
 *   POST /30da/admin/api/photos/:userId/:slotIndex/reject    { photoId, block? } → deleted, the person told; block = also block them
 *        Both act only while that photo is still pending in that slot (409 otherwise). Audited with ids only.
 *   Users → Photos (owner 2026-10-15: "the 4 photo preview and has function to manually view and approve or disqualify"):
 *   GET  /30da/admin/api/users/:id/photos     { user: { id, name, review, blocked }, slots: [4 × { index, photoId, status:
 *        'approved'|'pending'|null, at, url, thumb }] } slot-aligned; url / thumb carry the photo id, so a replaced photo
 *        never shows under the old one. 404 no such profile. The opening is audited (the id only).
 *   GET  /30da/admin/api/users/:id/photos/:index?id=<photoId>[&size=thumb]   the photo while THAT id is in that slot
 *        (approved or pending; 404 otherwise); size=thumb ≤ 160 px. Admin only, never cached.
 *   POST /30da/admin/api/users/:id/photos/:index/approve      { photoId } the Photos page's approve (pending only)
 *   POST /30da/admin/api/users/:id/photos/:index/disqualify   { photoId, block? } an approved OR pending photo: the slot
 *        emptied as Reject empties it, the stored photo deleted, the person told (the same notice); block = also block
 *        them. 409 photo_changed when that photo is no longer in that slot; 409 review_account for an App review account
 *        (its photos are uploaded instead). Both answer the fresh slots + { count } (photos waiting) and are
 *        audited with ids only. The overview's user rows carry photos: [4 × { photoId, status }] (ids + status only),
 *        so the Users table draws the 4 thumbnails without a request per profile.
 *   POST /30da/admin/api/users/:id/photos/:index/upload   the photo itself as the body (Content-Type image/jpeg |
 *        image/png | image/webp, ≤ 10 MB: 413 past it, the rest never buffered) into that slot of an App REVIEW account
 *        only (owner 2026-10-15, the 4 test users: "its take 1 hours to make 4 test users damn"); any other profile →
 *        409 not_review_account (the team never puts a photo on a real person's profile). Re-encoded by the photo store
 *        (JPEG ≤ 720 px, EXIF stripped; 400 bad_photo for anything that is not a photo), approved at once, slot-aligned
 *        (past the end the slots between stay empty); a preset-made account marks the slot 'uploaded' (users.demoPhotos:
 *        real on the App review page, kept by Edit / Refresh photos). Swapped in only while the slot still holds the
 *        photo the request read (409 photo_changed: the new file removed); the photo it replaces is deleted after the
 *        swap — unless it is the profile's own (a review account made from a profile): that one is kept and the upload
 *        recorded, and "Stop being a review account" takes the uploads out and puts the profile's own photos back.
 *        → the fresh slots + { count }, like approve / disqualify. Same limit as those; audited with ids only.
 *   GET  /30da/admin/review                   App review: demo accounts for the App Store / Google Play reviewers
 *   GET  /30da/admin/api/review               { on, code, accounts, profiles, notes, … } (src/lib/thirtyda-review.mjs reviewView)
 *   POST /30da/admin/api/review/switch        { on } "Review sign-in" ON / OFF (ON: blocks + open flags between demo
 *                                             accounts cleared; OFF: review devices forgotten — src/lib/thirtyda-review-world.mjs)
 *   POST /30da/admin/api/review/code          New code (6 digits, sealed); clears the demo accounts' blocks + flags too
 *   POST /30da/admin/api/review/accounts/:id  { phone, pin } "Use as review account" (or save it again)
 *   POST /30da/admin/api/review/accounts/:id/stop   "Stop being a review account" (409 for one made on the page)
 *   POST /30da/admin/api/review/demo          { preset: 'woman'|'man', name, realName, gender, birthYear, role, lang, phone, pin }
 *        "Create demo account": a NEW fully filled review account with 4 approved photos, or the same one updated
 *        (src/lib/thirtyda-demo.mjs createDemoAccount)
 *   POST /30da/admin/api/review/demo/:id/photos     "Refresh photos": the folder's files (placeholders for the rest)
 *        Every answer is the page's fresh data. Audited with ids only (never a number, a PIN or the code).
 *        "Remove" on that page is POST /30da/admin/api/users/:id/delete (above): one delete path.
 *
 * Secrets (src/lib/thirtyda-settings.mjs) are sealed with THIRTYDA_SECRET_KEY and never sent back:
 * only { set, last4, updatedAt, updatedBy }. The audit log never carries them either.
 *
 * Auth: one access code from the THIRTYDA_ADMIN_CODE env var — NO default,
 * NEVER in the repo (public). Unset means sign-in fails closed.
 * Every admin action is written to `thirtyda_audit`.
 * Data lives in the `thirtyda_*` collections the app (src/lib/thirtyda-app.mjs)
 * writes. Nothing is seeded here: demo data only comes from
 * `npm run 30da:seed`, which refuses to touch a non-dev database.
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "./mongo.ts";
import { clientIp } from "./thirtyda-net.mjs";
import {
  QUESTION_LEVELS, levelDocId, levelFromId, questionConfig, saveQuestions, resetQuestions,
} from "./thirtyda-questions.mjs";
import { LEVEL_RULES } from "../thirtyda-app/shared/questions.js";
import {
  keyReady, saveSecret, removeSecret, secretStatus, saveFields, readFields, fieldsStatus, SettingsError, noteSecretUse,
} from "./thirtyda-settings.mjs";
import {
  checkTelegramToken, checkWhatsAppFields, channelLive, channelOffer, deliverCode, testCodesAllowed, CODE_TTL_S,
} from "./thirtyda-code-send.mjs";
import {
  checkSigninFields, signinRedirect, signinKeys, publicOrigin, createSigninState, authorizeUrl, stateCookie, stateHash, SIGNIN_WIRED,
  pkcePair,
} from "./thirtyda-signin.mjs";
import { outboundFetch } from "./thirtyda-test-fetch.mjs";
import { APPLE, checkAppleFields, appleKeys, tryAppleKey } from "./thirtyda-apple.mjs";
import { botView, saveBot, tryBot, removeBot, windowLimiter } from "./thirtyda-telegram-bot.mjs";
import {
  listSupportChats, supportThread, sendSupportReply, supportUnread, describeBot, SUPPORT_TEXT_MAX,
} from "./thirtyda-support.mjs";
import { tryResultPage, requestLang } from "./thirtyda-pages.mjs";
import { normalizePhone, trimPhotoSlots, ensurePhotoArray } from "./thirtyda-app.mjs";
import {
  reviewView, setReviewSwitch, newReviewCode, makeReviewAccount, stopReviewAccount, ReviewError, isReview,
} from "./thirtyda-review.mjs";
import { deleteAccount } from "./thirtyda-delete.mjs";
import { clearReviewWorld, forgetReviewDevices } from "./thirtyda-review-world.mjs";
import { createDemoAccount, refreshDemoPhotos, demoView, DEMO_UPLOADED } from "./thirtyda-demo.mjs";
import { QUESTION_CHOICES, CHOICE_LIMITS, TITLE_LIMITS } from "../thirtyda-app/shared/question-slots.js";
import { resolveUpdate, reopenUpdate } from "./thirtyda-blocks.mjs";
import { targetLabel } from "../thirtyda-app/shared/safety.js";
import { BAD_WORD_REASONS } from "../thirtyda-app/shared/bad-words.js";
import { readPhoto, isPhotoId, deletePhoto, thumbPhoto, savePhoto, PhotoError } from "./thirtyda-photos.mjs";
import { placesAdminView, refreshPlaces, placesTry } from "./thirtyda-hub-places.mjs";
import { translateAdminView, checkTranslateFields, saveTranslateOptions, translateTry } from "./thirtyda-hub-translate.mjs";
import { resetTranslate } from "./thirtyda-translate.mjs";
import { placeIndex, placeSearch, placesGoogle } from "./thirtyda-meet.mjs";
import { checkGooglePlacesFields, saveGoogleOptions } from "./thirtyda-places-google.mjs";
import { wanAdminView, newWanToken, revokeWanToken, saveWanOptions, queueWanTry, wanTryClip, sendClip } from "./thirtyda-hub-wan.mjs";
import {
  pendingQueue, pendingOwner, pendingCount, reviewTarget, approvePhoto, rejectPhoto, photoNotice, disqualifyPhoto, adminSlots,
  photoSummary, photoInSlot, putReviewPhoto, isPending,
} from "./thirtyda-photo-review.mjs";

const BASE = "/30da/admin";
const CODE = process.env.THIRTYDA_ADMIN_CODE || "";
const COOKIE = "thirtyda_admin";
const WARNING_TEXT =
  "We stopped a message that broke the 30+DA rules. Contact details are never allowed. Next time the account is blocked.";
// A warning over a bad word (store policy, owner 2026-10-14): the notice carries rule 'word' and the app says this instead.
const WARNING_TEXT_WORD =
  "We stopped words that broke the 30+DA rules. Rude, sexual or money words are never allowed. Next time the account is blocked.";
const BAD_WORD_REASON_SET = new Set(Object.values(BAD_WORD_REASONS));
// A stopped name (no conversation): what the queue calls the field.
const FIELD_LABELS = { name: "App name", realName: "Real name" };
const SESSION_HOURS = 8;
const MAX_ATTEMPTS = 5; // wrong codes per IP per window
const MAX_FAILURES = 20; // wrong codes from everyone together per window: caps guessing from rotating IPs
const WINDOW_MS = 15 * 60 * 1000;
const MAX_WRITES = 30; // question saves/resets per admin session per window
const QUESTIONS_BODY_MAX = 200_000; // 20 choices × 5 languages × 100 characters, with room to spare
const MAX_TESTS = 10; // real Telegram test codes per admin session per window (each one costs money)
const MAX_REPLIES = 60; // support replies per admin session per window
const replyLimits = windowLimiter(WINDOW_MS);
const MAX_PHOTO_DECISIONS = 120; // Users → Photos approve / disqualify / upload per admin session per window (30 profiles × 4)
const photoLimits = windowLimiter(WINDOW_MS);
// Users → Photos → Upload: the photo itself is the body, so this one route takes an image type instead of JSON.
const UPLOAD_PATH = /^\/api\/users\/U-\d+\/photos\/[0-3]\/upload$/;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UPLOAD_BYTES_MAX = 10 * 1024 * 1024; // the Media Director's files are a few MB; the store keeps ≤ 720 px anyway

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
};

// Unit tests only (src/lib/thirtyda-admin.test.mjs, thirtyda-admin-photos.test.mjs, thirtyda-admin-upload.test.mjs): an
// in-memory database, a stand-in for the delete and for the photo store ({ read, remove, save }). Unset in the server,
// where the admin always uses getDb(), the app's own deleteAccount and the real photo store.
const testHooks = { db: null, deleteAccount: null, photoStore: null };
export function setAdminTestHooks({ db: d = null, deleteAccount: del = null, photoStore = null } = {}) {
  testHooks.db = d;
  testHooks.deleteAccount = del;
  testHooks.photoStore = photoStore;
}
/** The photo store: read(id) → the JPEG or null, remove(id), save(bytes) → the id (re-encoded; PhotoError: not a photo). */
const photoStore = () => testHooks.photoStore ?? { read: readPhoto, remove: deletePhoto, save: savePhoto };

// ---------- db ----------
let ready = null;
async function db() {
  if (testHooks.db) return testHooks.db;
  const d = await getDb();
  if (!ready) {
    ready = d.collection("thirtyda_admin_sessions")
      .createIndex({ expires: 1 }, { expireAfterSeconds: 0 })
      .catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}

const LEVEL_NAMES = { 1: "question", 2: "answer", 3: "chat" };
const strip = ({ _id, ...doc }) => doc;
/** A started delete as the overview shows it: what it wrote down, its Apple id without the sealed token (apple.box). */
const withoutAppleBox = ({ apple, ...was }) => ({ ...was, ...(apple ? { apple: { sub: apple.sub } } : {}) });

/** Live presence from the app's heartbeat; older (sample) rows keep their stored value. */
function presenceOf(u, now = Date.now()) {
  if (!u.lastSeenAt) return u.presence || "offline";
  const age = now - new Date(u.lastSeenAt).getTime();
  return age < 2 * 60e3 ? "online" : age < 15 * 60e3 ? "idle" : "offline";
}

async function load() {
  const d = await db();
  const [users, chats, flags] = await Promise.all(
    ["thirtyda_users", "thirtyda_chats", "thirtyda_flags"].map((c) => d.collection(c).find({}).toArray()),
  );
  return { d, users: users.map(strip), chats: chats.map(strip), flags: flags.map(strip) };
}

async function overview() {
  const { users: rows, chats, flags } = await load();
  const users = rows.map((u) => ({ ...u, presence: presenceOf(u) }));
  const byId = new Map(users.map((u) => [u.id, u]));
  const open = flags.filter((f) => f.status === "open").sort((a, b) => b.at.localeCompare(a.at));
  const live = users.filter((u) => !u.blocked);
  // App review accounts (src/lib/thirtyda-review.mjs) are counted on their own, never in the real numbers.
  const real = live.filter((u) => !isReview(u));
  return {
    updatedAt: new Date().toISOString(),
    stats: {
      online: real.filter((u) => u.presence === "online").length,
      level3Chats: chats.filter((c) => c.level === 3 && !byId.get(c.a)?.blocked && !byId.get(c.b)?.blocked && !isReview(byId.get(c.a)) && !isReview(byId.get(c.b))).length,
      openFlags: open.length,
      blocked: users.length - live.length,
      reviewAccounts: users.filter(isReview).length,
    },
    // The PIN's hash and its wrong-try count never leave the server (the admin sees only whether one is set); nor does
    // a review account's sealed PIN or the number it had before, nor Sign in with Apple's sealed refresh token (on the
    // profile, or in deleting.apple while a delete runs: only its Apple id stays there).
    // Photos: the 4 slots as ids + status only (photoSummary) — the table draws the thumbnails from them.
    users: users.map(({ blockResolved, location, locOffset, locMoves, locAt, notices, pinHash, pinAt, pinTries, reviewPinBox, reviewWas, appleRefresh, deleting, photos, photoReview, photoReviewAt, ...u }) => ({
      ...u,
      ...(deleting ? { deleting: withoutAppleBox(deleting) } : {}),
      photos: photoSummary({ photos, photoReview, photoReviewAt }),
      review: isReview(u),
      pinSet: Boolean(pinHash),
      openFlags: open.filter((f) => f.from === u.id).length,
    })),
    flags: open.map((f) => {
      const chat = chats.find((c) => c.id === f.chatId);
      const msg = chat?.messages.find((m) => m.flagId === f.id) ?? {};
      // The level the message was written at, not where the pair is now. A block, or a report on a profile or a photo,
      // is about the person, not a message: no level.
      const aboutPerson = f.kind === "blocked" || (f.target && !/^(?:line|reply):/.test(String(f.target)));
      const level = aboutPerson ? null : msg.level ?? f.level ?? chat?.level;
      const { key, photoId, ...rest } = f; // the open-flag key and the photo's id stay on the server
      return {
        ...rest,
        fromName: byId.get(f.from)?.name ?? f.from,
        // A guest's report (POST /guest/report): nobody's profile on the other side.
        toName: f.guest ? "A guest" : byId.get(f.to)?.name ?? f.to,
        level,
        levelName: level ? LEVEL_NAMES[level] : null,
        // Store policy (owner 2026-10-14): what a report points at ("Profile", "Photo 2", "Line 3"), and the reported
        // photo itself (GET /api/flags/:id/photo, this flag only).
        targetLabel: f.target ? targetLabel(f.target) : f.field ? FIELD_LABELS[f.field] ?? null : null,
        photo: photoId ? `${BASE}/api/flags/${encodeURIComponent(f.id)}/photo` : null,
        // A stopped name has no conversation: its flag carries the text itself.
        message: { text: msg.text ?? f.text ?? "", english: msg.english ?? f.english ?? null, hit: msg.hit ?? f.hit ?? null },
      };
    }),
  };
}

async function chatFor({ flag, user }) {
  const { users, chats, flags } = await load();
  let chat;
  if (flag) chat = chats.find((c) => c.id === flags.find((f) => f.id === flag)?.chatId);
  else if (user) {
    // Most recent conversation with messages for this user.
    chat = chats
      .filter((c) => (c.a === user || c.b === user) && c.messages.length)
      .sort((x, y) => y.messages.at(-1).at.localeCompare(x.messages.at(-1).at))[0];
  }
  if (!chat) return null;
  const name = (id) => users.find((u) => u.id === id)?.name ?? id;
  const people = { [chat.a]: name(chat.a), [chat.b]: name(chat.b) };
  return {
    id: chat.id,
    level: chat.level,
    levelName: LEVEL_NAMES[chat.level],
    // Someone chose "Forget it" after Level 2: the conversation is over (the 'decision' rows say who).
    endedAt: chat.endedAt ?? null,
    people,
    messages: chat.messages.map((m) => {
      const f = m.flagId && flags.find((x) => x.id === m.flagId);
      // A 'decision' row with no sender is the app's own note ("Both chose to open the chat").
      return { ...m, fromName: m.from ? people[m.from] : "30+DA", flag: f ? { kind: f.kind, reason: f.reason, status: f.status } : null };
    }),
  };
}

// ---------- auth ----------
function checkCode(code) {
  if (!CODE) return false;
  // Compare digests so length differences don't leak through timing.
  const a = crypto.createHash("sha256").update(String(code)).digest();
  const b = crypto.createHash("sha256").update(CODE).digest();
  return crypto.timingSafeEqual(a, b);
}

const attempts = new Map(); // ip -> [timestamps of wrong codes]
let failures = []; // every wrong code, any IP
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  failures = failures.filter((t) => now - t < WINDOW_MS);
  return list.length >= MAX_ATTEMPTS || failures.length >= MAX_FAILURES;
}

function tokenOf(req) {
  return (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`))?.[1] ?? null;
}

async function signedIn(req) {
  const token = tokenOf(req);
  if (!token) return false;
  const d = await db();
  return Boolean(await d.collection("thirtyda_admin_sessions").findOne({ _id: token, expires: { $gt: new Date() } }));
}

async function audit(req, action, extra = {}) {
  const d = await db();
  await d.collection("thirtyda_audit").insertOne({ at: new Date(), action, ip: clientIp(req), ...extra });
}

// ---------- http ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
}

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", png: "image/png" };
async function serveFile(res, name) {
  const buf = await readFile(new URL(`../thirtyda-admin/${name}`, import.meta.url));
  send(res, 200, buf, { "Content-Type": TYPES[name.split(".").pop()], "Cache-Control": "no-store" });
}

function readJson(req) {
  return readJsonBody(req, 1e4).then((r) => r.value ?? {});
}

/**
 * A JSON object body up to `max` BYTES → { value }, or { tooLarge } / { bad }.
 * The raw Buffers are joined before decoding: decoding chunk by chunk would turn a Khmer or
 * Chinese character split across two chunks into U+FFFD.
 */
function readJsonBody(req, max) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (over) return resolve({ tooLarge: true });
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const v = JSON.parse(raw.trim() ? raw : "{}");
        resolve(v && typeof v === "object" && !Array.isArray(v) ? { value: v } : { bad: true });
      } catch {
        resolve({ bad: true });
      }
    });
    req.on("error", () => resolve({ bad: true }));
  });
}

/**
 * Writes must come from the admin pages themselves. SameSite=Strict keeps the cookie off other
 * sites, but not off a sibling subdomain: refuse a foreign Origin / Sec-Fetch-Site, and any body
 * that is not JSON (an HTML form can only send form-encoded or text/plain without a preflight).
 * Upload (`photo`: Users → Photos → Upload) takes only an image type instead — just as out of a form's
 * reach: another site's fetch with it needs a preflight, which this server never answers.
 * → null when fine, else [status, message].
 */
function writeRefused(req, { photo = false } = {}) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return [403, "Requests must come from the admin pages."];
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* "null" or junk */ }
    if (host !== (req.headers["x-forwarded-host"] || req.headers.host)) return [403, "Requests must come from the admin pages."];
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (photo) return UPLOAD_TYPES.includes(type) ? null : [415, "Send a JPEG, PNG or WebP photo (Content-Type image/jpeg, image/png or image/webp)."];
  if (type !== "application/json") return [415, "Send JSON (Content-Type: application/json)."];
  return null;
}

/**
 * A raw body up to `max` BYTES → { buf }, or { tooLarge } / { bad }. A Content-Length past the limit is refused before
 * anything is read; a body that grows past it while it streams is answered at once — nothing more is kept (the rest
 * runs off unread into the flowing stream, never into memory).
 */
function readRawBody(req, max) {
  if (Number(req.headers["content-length"] || 0) > max) {
    req.resume();
    return Promise.resolve({ tooLarge: true });
  }
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      if (!r.buf) chunks.length = 0;
      resolve(r);
    };
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > max) return finish({ tooLarge: true });
      chunks.push(c);
    });
    req.on("end", () => finish({ buf: Buffer.concat(chunks) }));
    req.on("error", () => finish({ bad: true }));
  });
}

const writes = new Map(); // admin session → [timestamps of question saves/resets]
function writeLimited(req) {
  const key = tokenOf(req) || clientIp(req);
  const now = Date.now();
  const list = (writes.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_WRITES) {
    writes.set(key, list);
    return true;
  }
  list.push(now);
  writes.set(key, list);
  return false;
}

const tests = new Map(); // admin session → [timestamps of test sends]
function testLimited(req) {
  const key = tokenOf(req) || clientIp(req);
  const now = Date.now();
  const list = (tests.get(key) || []).filter((t) => now - t < WINDOW_MS);
  tests.set(key, list);
  if (list.length >= MAX_TESTS) return true;
  list.push(now);
  return false;
}

/** "+85512345678" → "+855•••••678": enough for the audit to tell test numbers apart. */
const maskPhone = (p) => (p ? `${p.slice(0, 4)}${"•".repeat(Math.max(0, p.length - 7))}${p.slice(-3)}` : null);

/**
 * The Code page's data. Never a secret: a secret shows only its last 4 characters (last4 / masks); the
 * plain fields (WhatsApp phone number ID + template, Google client ID, Facebook app ID) show as saved.
 */
async function connectionsView(d, req) {
  const tg = await secretStatus(d, "telegram");
  const envToken = String(process.env.THIRTYDA_TG_TOKEN ?? "").trim();
  const { readable, lastSend, ...view } = tg;
  const devAuth = process.env.THIRTYDA_DEV_AUTH === "1";
  const [wa, google, facebook, tiktok, apple] = await Promise.all(["whatsapp", "google", "facebook", "tiktok", "apple"].map((n) => fieldsStatus(d, n)));
  const [tgOffer, waOffer] = await Promise.all(["telegram", "whatsapp"].map((c) => channelOffer(d, c)));
  // Whether the app offers the channel: only once a test code went through (and no lasting failure since).
  const offer = ({ offered, state, reason, detail, at }) => ({ offered, offer: { state, reason, detail, at } });
  const origin = publicOrigin(req);
  const keysOk = {
    google: Boolean(await signinKeys(d, "google")), facebook: Boolean(await signinKeys(d, "facebook")), tiktok: Boolean(await signinKeys(d, "tiktok")),
  };
  const signin = (id, name, st) => ({
    id, name, kind: "signin", ...st,
    // Live = the app's button really signs people in (the same rule as GET /auth/methods).
    live: Boolean(SIGNIN_WIRED[id]) && keysOk[id],
    wired: SIGNIN_WIRED[id],
    redirect: signinRedirect(req, id),
    privacyUrl: `${origin}/30da/privacy`,
    deleteUrl: `${origin}/30da/delete-data`,
    termsUrl: `${origin}/30da/terms`,
    tryUrl: `${BASE}/api/connections/${id}/try`,
  });
  return {
    keyReady: keyReady(),
    devAuth,
    // Exactly what the app does (same rule): on-screen test codes only in test mode with no channel set up.
    testCodes: await testCodesAllowed(d, devAuth),
    // On Railway (the live server) test mode must be off: the page shows a red warning while it is on.
    onRailway: Boolean(process.env.RAILWAY_ENVIRONMENT),
    connections: [
      {
        id: "telegram",
        name: "Telegram",
        kind: "code",
        ...view,
        readable,
        lastSend,
        // THIRTYDA_TG_TOKEN is used only while nothing readable is saved here.
        envFallback: envToken ? { last4: envToken.slice(-4) } : null,
        live: (view.set && readable) || Boolean(envToken),
        ...offer(tgOffer),
        // The free 30+DA bot (src/lib/thirtyda-telegram-bot.mjs): key …last4, @username, offered after a good Try.
        bot: await botView(d),
      },
      // Live once all four fields are saved and readable (channelLive); offered once a test code went through.
      { id: "whatsapp", name: "WhatsApp", kind: "code", ...wa, live: await channelLive(d, "whatsapp"), ...offer(waOffer) },
      signin("google", "Google sign-in", google),
      signin("facebook", "Facebook sign-in", facebook),
      signin("tiktok", "TikTok sign-in", tiktok),
      // Sign in with Apple (tower 10, src/lib/thirtyda-apple.mjs): the sign-in works on the iPhone app without any key
      // (signinWorks); the key (Team ID, Key ID, the .p8) lets "Delete my account" revoke Apple's token. Live = the key
      // is saved, readable and its last use (Try, or a real sign-in's token exchange) went through.
      {
        id: "apple", name: "Sign in with Apple", kind: "apple", ...apple,
        signinWorks: true,
        keyOk: Boolean(await appleKeys(d).catch(() => null)),
        live: Boolean(apple.set && apple.readable && apple.lastSend?.ok),
        bundleId: APPLE.bundleId,
        teamIdDefault: APPLE.teamId,
        tryUrl: `${BASE}/api/connections/apple/try`,
      },
    ],
    // Tower 11 · Wan (the GK API Hub, src/lib/thirtyda-hub-wan.mjs): never a token or a token's hash, only their last 4.
    // A Wan failure never takes the other ten towers down: the page then draws without tower 11 (`wan` null).
    wan: await wanAdminView(d, req).catch((err) => {
      console.error("[30da admin] wan:", err instanceof Error ? err.message : err);
      return null;
    }),
    // Tower 12 · Places (src/lib/thirtyda-hub-places.mjs): our own Phnom Penh place list. A failure: drawn without it.
    // Its `google` block: the Places API key (its last 4 only), On / Off, the month's cap and counts.
    places: await placesAdminView(placeIndex()).then(async (p) => ({
      ...p,
      google: await placesGoogle().status(d).catch((err) => {
        console.error("[30da admin] places google:", err instanceof Error ? err.message : err);
        return null;
      }),
    })).catch((err) => {
      console.error("[30da admin] places:", err instanceof Error ? err.message : err);
      return null;
    }),
    // Tower 13 · Translate (src/lib/thirtyda-hub-translate.mjs): never the token, only its last 4. A failure: without it.
    translate: await translateAdminView(d).catch((err) => {
      console.error("[30da admin] translate:", err instanceof Error ? err.message : err);
      return null;
    }),
  };
}

/** PUT bodies of the "fields" connections: what the admin typed → checked values (a secret left empty keeps the saved one). */
const FIELD_CHECKS = {
  whatsapp: (input, current) => checkWhatsAppFields(input, current),
  google: (input, current) => checkSigninFields("google", input, current),
  facebook: (input, current) => checkSigninFields("facebook", input, current),
  tiktok: (input, current) => checkSigninFields("tiktok", input, current),
  apple: (input, current) => checkAppleFields(input, current),
  translate: (input, current) => checkTranslateFields(input, current),
  googleplaces: (input, current) => checkGooglePlacesFields(input, current),
};
const CONNECTION_NAMES = {
  telegram: "Telegram", whatsapp: "WhatsApp", google: "Google", facebook: "Facebook", tiktok: "TikTok", apple: "Apple", translate: "Translate",
  googleplaces: "Google Places",
};
const TESTABLE = ["telegram", "whatsapp"];

/** One level as the Questions page edits it. */
function questionsView(level, config) {
  return {
    id: levelDocId(level),
    level,
    pick: LEVEL_RULES[level].pick,
    write: LEVEL_RULES[level].write,
    choices: QUESTION_CHOICES,
    limits: { min: CHOICE_LIMITS[0], max: CHOICE_LIMITS[1] },
    titleLimits: { min: TITLE_LIMITS[0], max: TITLE_LIMITS[1] },
    slots: config.slots,
    titles: config.titles,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
    reset: config.reset,
    isDefault: config.isDefault,
    matchesDefault: config.matchesDefault,
  };
}

/**
 * The free Telegram bot on the Telegram card (src/lib/thirtyda-telegram-bot.mjs):
 *   PUT    { token }  Save: getMe (→ @username) + setWebhook to this site → sealed; the answer is the page's fresh data.
 *   POST   /try       getMe + getWebhookInfo: a pass turns the bot on in the app, a failure stops it → { ok, …, view }.
 *   DELETE           deleteWebhook + remove (open checks end).
 * Never the key or the webhook secret in an answer or the audit (only the key's last 4 and the bot's @username).
 */
async function telegramBotRoute(req, res, isTry) {
  if (writeLimited(req)) {
    req.resume();
    return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
  }
  const d = await db();
  const fetchImpl = outboundFetch();
  if (isTry) {
    req.resume();
    if (testLimited(req)) return json(res, 429, { error: `That is ${MAX_TESTS} tries in 15 minutes. Try again later.` });
    const r = await tryBot(d, { fetchImpl });
    // The bot's profile words (what people see before they write to it), best effort.
    const described = r.ok ? await describeBot(d, { fetchImpl }) : null;
    await audit(req, "connection_test", {
      connection: "telegram-bot", ok: r.ok, ...(r.ok ? { username: r.username, described: described.ok } : { reason: r.reason }),
    });
    const view = await connectionsView(d, req);
    if (!r.ok) return json(res, r.status || 422, { ok: false, error: r.error, reason: r.reason, detail: r.detail ?? null, view });
    return json(res, 200, { ok: true, username: r.username, view });
  }
  if (req.method === "DELETE") {
    req.resume();
    const r = await removeBot(d, { fetchImpl });
    await audit(req, "connection_remove", { connection: "telegram-bot", removed: r.removed, webhookDeleted: r.webhookDeleted });
    return json(res, 200, await connectionsView(d, req));
  }
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge) return json(res, 413, { error: "That is far too long to save." });
  if (body.bad) return json(res, 400, { error: "Send { token }." });
  try {
    const r = await saveBot(d, body.value.token, { origin: publicOrigin(req), fetchImpl, by: "superadmin" });
    if (!r.ok) {
      if (r.reason !== "format") await audit(req, "connection_save_refused", { connection: "telegram-bot", reason: r.reason });
      return json(res, r.status, { error: r.error, field: r.field, reason: r.reason, detail: r.detail });
    }
    const described = await describeBot(d, { fetchImpl });
    await audit(req, "connection_save", { connection: "telegram-bot", last4: r.last4, username: r.username, described: described.ok });
  } catch (err) {
    if (err instanceof SettingsError && err.code === "no_key") {
      await audit(req, "connection_save_refused", { connection: "telegram-bot", reason: "no_key" });
      return json(res, 503, {
        error: "The server's lock key is missing, so the bot key cannot be saved yet. Ask your developer to set it, then save again.",
        reason: "no_key",
      });
    }
    throw err;
  }
  return json(res, 200, await connectionsView(d, req));
}

/** What "Try the key" says when Apple did not take it (plain words; never the key, the secret or the code). */
const APPLE_TRY_WORDS = {
  no_key: "Save the Team ID, Key ID and private key first, then try them.",
  bad_key: "Apple refused the key (invalid_client). Check the Key ID and Team ID, and that the key has Sign in with Apple set up for sg.ggmt.thirtyda.",
  provider_error: "Apple had a problem on its side. Try again in a few minutes.",
  timeout: "Apple did not answer in time. Try again.",
  network: "Apple could not be reached. Try again.",
  other: "Apple gave an answer we did not expect. Try again, or make a new key.",
};

/**
 * POST /api/connections/apple/try — Sign in with Apple's key on the Code page: the ES256 client secret and a made-up code
 * at Apple's /auth/token (src/lib/thirtyda-apple.mjs tryAppleKey). invalid_grant = Apple accepted the key and refused only
 * the code: the key works and the tower is Live (the outcome goes on the card: noteSecretUse kind 'try'). Never the key,
 * the client secret or the code in the answer or the audit. → { ok, reason?, error?, detail?, view }.
 */
async function appleTryRoute(req, res) {
  req.resume();
  if (testLimited(req)) return json(res, 429, { error: `That is ${MAX_TESTS} tries in 15 minutes. Try again later.` });
  const d = await db();
  const keys = await appleKeys(d).catch(() => null);
  const r = keys ? await tryAppleKey(keys, { fetchImpl: outboundFetch() }) : { ok: false, reason: "no_key", detail: null };
  if (keys) await noteSecretUse(d, "apple", { ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail, kind: "try" }).catch(() => {});
  await audit(req, "connection_test", { connection: "apple", ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
  const view = await connectionsView(d, req);
  if (!r.ok) {
    return json(res, r.reason === "no_key" ? 400 : 422, { ok: false, reason: r.reason, error: APPLE_TRY_WORDS[r.reason] || APPLE_TRY_WORDS.other, detail: r.detail ?? null, view });
  }
  return json(res, 200, { ok: true, view });
}

/**
 * Tower 11 · Wan on the Code page (signed in; writes are same-origin JSON: checked before this). m[1] = what, m[2] = the
 * token's kind, m[3] = a job id.
 *   POST tokens/:kind → { token, kind, view }: the token in full this once (never again, never in the audit: its last 4).
 *   DELETE tokens/:kind → the page's data. PUT options → the page's data | 422 { error, field }.
 *   POST try → { ok, job_id, view } | the cap that stopped it { ok:false, error, reason, view }.
 *   GET clips/:id → the Try's clip (byte ranges, for the <video>); 404 for anything else.
 */
async function wanRoute(req, res, m) {
  const d = await db();
  if (m[3]) {
    if (req.method !== "GET") return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    const clip = await wanTryClip(d, m[3]);
    if (!clip) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    return sendClip(req, res, clip.buf, clip.type, SECURITY_HEADERS);
  }
  const what = m[2] ? "token" : m[1];
  const allowed = { token: ["POST", "DELETE"], options: ["PUT"], try: ["POST"] }[what];
  if (!allowed.includes(req.method)) {
    req.resume();
    return json(res, 404, { error: "Not found." });
  }
  if (what === "try") {
    req.resume();
    if (testLimited(req)) return json(res, 429, { error: `That is ${MAX_TESTS} tries in 15 minutes. Try again later.` });
    const r = await queueWanTry(d);
    await audit(req, "wan_try", { ok: r.ok, ...(r.ok ? { job: r.job_id } : { reason: r.reason }) });
    const view = await connectionsView(d, req);
    if (!r.ok) return json(res, r.status, { ok: false, error: r.error, reason: r.reason, view });
    return json(res, 200, { ok: true, job_id: r.job_id, view });
  }
  if (writeLimited(req)) {
    req.resume();
    return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
  }
  if (what === "token") {
    req.resume();
    if (req.method === "DELETE") {
      const r = await revokeWanToken(d, m[2]);
      await audit(req, "wan_token_revoke", { kind: m[2], removed: r.removed });
      return json(res, 200, await connectionsView(d, req));
    }
    const { token, view: made } = await newWanToken(d, m[2], { by: "superadmin" });
    await audit(req, "wan_token_new", { kind: m[2], last4: made.last4 });
    return json(res, 200, { token, kind: m[2], view: await connectionsView(d, req) });
  }
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge) return json(res, 413, { error: "That is far too long to save." });
  if (body.bad) return json(res, 400, { error: "Send the options as JSON." });
  const r = await saveWanOptions(d, body.value, { by: "superadmin" });
  if (!r.ok) return json(res, 422, { error: r.error, field: r.field });
  await audit(req, "wan_options", { enabled: r.options.enabled, sizes: r.options.sizes, maxSeconds: r.options.maxSeconds });
  return json(res, 200, await connectionsView(d, req));
}

/**
 * Tower 12 · Places on the Code page (signed in; writes are same-origin JSON: checked before this). m[1] = what.
 *   POST refresh → { ok: true, view } (Overpass is asked in the background) | 429 { ok: false, error, reason, view }.
 *   POST search { q, lang } → placesTry's answer | 422 { error }. 20 test searches a minute: they share the app's
 *   Nominatim queue (1 a second), and each one asks Google when its key is saved (counted against the month's cap).
 *   PUT google { enabled?, monthlyCap? } → the page's data | 422 { error, field }: Google's On / Off and cap.
 */
const placeTries = windowLimiter(60e3);
async function placesRoute(req, res, m) {
  if (m[1] === "google") {
    if (req.method !== "PUT") {
      req.resume();
      return json(res, 404, { error: "Not found." });
    }
    const body = await readJsonBody(req, 1e4);
    if (body.tooLarge) return json(res, 413, { error: "That is far too long." });
    if (body.bad) return json(res, 400, { error: "Send the options as JSON." });
    if (writeLimited(req)) return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
    const d = await db();
    const r = await saveGoogleOptions(d, body.value, { by: "superadmin" });
    if (!r.ok) return json(res, 422, { error: r.error, field: r.field });
    placesGoogle().reset(); // the app reads it again at once
    await audit(req, "places_google_options", { enabled: r.options.enabled, monthlyCap: r.options.monthlyCap });
    return json(res, 200, await connectionsView(d, req));
  }
  if (req.method !== "POST") {
    req.resume();
    return json(res, 404, { error: "Not found." });
  }
  if (m[1] === "refresh") {
    req.resume();
    if (writeLimited(req)) return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
    const r = refreshPlaces(placeIndex());
    await audit(req, "places_refresh", { ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
    const view = await connectionsView(await db(), req);
    if (!r.ok) return json(res, r.reason === "busy" ? 409 : 429, { ok: false, error: r.error, reason: r.reason, view });
    return json(res, 200, { ok: true, view });
  }
  const body = await readJsonBody(req, 2000);
  if (body.tooLarge) return json(res, 413, { error: "That is far too long to search." });
  if (body.bad) return json(res, 400, { error: "Send the search as JSON." });
  if (placeTries.over(tokenOf(req) || clientIp(req), 20)) return json(res, 429, { error: "That is 20 searches in a minute. Wait a moment." });
  const r = await placesTry(placeSearch(), { q: body.value?.q, lang: body.value?.lang });
  if (r.error) return json(res, 422, { error: r.error });
  return json(res, 200, r);
}

/**
 * Tower 13 · Translate on the Code page (signed in; writes are same-origin JSON: checked before this). m[1] = what.
 *   PUT options { enabled?, timeoutS? } → the page's data | 422 { error, field }.
 *   POST try { text, from, to } → { ok, results: [{ to, ok, text | error, ms }], view } | 422 / 400 { error, field? }.
 *   30 tries in 15 minutes (each one runs the M1's model). The line itself is never kept or audited.
 */
const translateTries = windowLimiter(WINDOW_MS);
async function translateRoute(req, res, m) {
  const want = m[1] === "options" ? "PUT" : "POST";
  if (req.method !== want) {
    req.resume();
    return json(res, 404, { error: "Not found." });
  }
  const d = await db();
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge) return json(res, 413, { error: "That is far too long." });
  if (body.bad) return json(res, 400, { error: "Send it as JSON." });
  if (m[1] === "options") {
    if (writeLimited(req)) return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
    const r = await saveTranslateOptions(d, body.value, { by: "superadmin" });
    if (!r.ok) return json(res, 422, { error: r.error, field: r.field });
    await audit(req, "translate_options", { enabled: r.options.enabled, timeoutS: r.options.timeoutS });
    return json(res, 200, await connectionsView(d, req));
  }
  if (translateTries.over(tokenOf(req) || clientIp(req), 30)) return json(res, 429, { error: "That is 30 tries in 15 minutes. Try again later." });
  const r = await translateTry(d, body.value);
  if (r.status) return json(res, r.status, { error: r.error, field: r.field, reason: r.reason });
  await audit(req, "translate_try", { ok: r.ok, from: r.from, to: r.results.map((x) => x.to), model: r.model });
  return json(res, 200, { ...r, view: await connectionsView(d, req) });
}

/**
 * Block a person: the monitor's Block, Reject + block on the Photos page, Disqualify + block on Users → Photos. → { alreadyBlocked }
 * Blocking settles every open flag this user raised; undo reopens exactly those. A flag
 * raised after the block (e.g. a report on an older message) settles too, but then the
 * block itself is not new, so there is nothing to undo.
 */
async function blockUser(d, u) {
  const users = d.collection("thirtyda_users");
  const flags = d.collection("thirtyda_flags");
  const alreadyBlocked = Boolean(u.blocked);
  const settled = (await flags.find({ from: u.id ?? u._id, status: "open" }).toArray()).map((f) => f._id);
  await flags.updateMany({ _id: { $in: settled } }, resolveUpdate("blocked", new Date().toISOString()));
  await users.updateOne(
    { _id: u._id },
    alreadyBlocked ? { $addToSet: { blockResolved: { $each: settled } } } : { $set: { blocked: true, blockResolved: settled } },
  );
  return { alreadyBlocked };
}

/** The Photos page's data: pending photos, photo 1 first, each with its admin-only url. */
async function photoQueueView(d) {
  const rows = await pendingQueue(d.collection("thirtyda_users"));
  return {
    count: rows.length,
    photos: rows.map((r) => ({ ...r, url: `${BASE}/api/photos/${r.photoId}` })),
  };
}

/**
 * Users → Photos (owner 2026-10-15): one profile's 4 slots, each with its admin-only urls, or null (no such profile).
 * The photo id is in the url (?id=): a photo replaced meanwhile never shows under the old one's slot.
 */
async function userPhotosView(d, id) {
  const u = await d.collection("thirtyda_users").findOne(
    { _id: id }, { projection: { name: 1, photos: 1, photoReview: 1, photoReviewAt: 1, blocked: 1, demo: 1 } },
  );
  if (!u) return null;
  const src = (s) => `${BASE}/api/users/${encodeURIComponent(u._id)}/photos/${s.index}?id=${s.photoId}`;
  return {
    user: { id: u._id, name: u.name ?? "", review: isReview(u), blocked: Boolean(u.blocked) },
    slots: adminSlots(u).map((s) => ({ ...s, url: s.photoId ? src(s) : null, thumb: s.photoId ? `${src(s)}&size=thumb` : null })),
  };
}

/**
 * Users → Photos (signed in; writes are same-origin JSON, or an image for upload: checked before this). m[1] = the
 * profile, m[2] = the slot index (0–3), m[3] = approve | disqualify | upload.
 *   GET  …/photos                          → userPhotosView; 404 no such profile.
 *   GET  …/photos/:index?id=[&size=thumb]  → the image while THAT id is in that slot (approved or pending), else 404.
 *   POST …/approve    { photoId }          → the Photos page's approve: pending only.
 *   POST …/disqualify { photoId, block? }  → any photo, approved or pending, of a profile that is not an App review account.
 *   POST …/upload     <the photo>         → into that slot of an App review account only (uploadRoute).
 * A write answers the fresh slots + { count } (photos waiting: the sidebar badge); a refusal carries them too.
 */
async function userPhotosRoute(req, res, m, url) {
  const d = await db();
  const users = d.collection("thirtyda_users");
  if (req.method === "GET" && !m[2]) {
    const view = await userPhotosView(d, m[1]);
    if (!view) return json(res, 404, { error: "There is no such profile (it may be deleted already).", reason: "not_found" });
    await audit(req, "view_user_photos", { user: m[1] });
    return json(res, 200, view);
  }
  if (req.method === "GET" && !m[3]) {
    const target = reviewTarget(m[1], m[2], url.searchParams.get("id"));
    const u = target ? await users.findOne({ _id: target.userId }, { projection: { photos: 1 } }) : null;
    let buf = u && photoInSlot(u, target.index, target.photoId) ? await photoStore().read(target.photoId) : null;
    // An empty file (a write cut short) is no photo: 404 like an unreadable one, never an empty image or a 500.
    if (buf?.length && url.searchParams.get("size") === "thumb") buf = await thumbPhoto(buf).catch(() => null);
    if (!buf?.length) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    return send(res, 200, buf, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "private, no-store" });
  }
  if (req.method !== "POST" || !m[3]) {
    req.resume();
    return json(res, 404, { error: "Not found." });
  }
  if (photoLimits.over(tokenOf(req) || clientIp(req), MAX_PHOTO_DECISIONS)) {
    req.resume();
    return json(res, 429, { error: "That is a lot of photo changes in 15 minutes. Try again in a few minutes." });
  }
  if (m[3] === "upload") return uploadRoute(req, res, d, m);
  const body = await readJsonBody(req, 1e4);
  if (body.bad || body.tooLarge) return json(res, 400, { error: "Send { photoId }." });
  const target = reviewTarget(m[1], m[2], body.value.photoId);
  if (!target) return json(res, 400, { error: "Send { photoId }." });
  const u = await users.findOne({ _id: target.userId });
  if (!u) return json(res, 404, { error: "There is no such profile (it may be deleted already).", reason: "not_found" });
  const slot = target.index + 1;
  const fresh = async () => ({ ...(await userPhotosView(d, target.userId)), count: await pendingCount(users) });
  const refused = async (reason, error) => json(res, 409, { error, reason, ...(await fresh()) });
  const changed = () => refused("photo_changed", "This photo was changed or already checked. The photos are up to date now.");
  const reviewAccount = () => refused("review_account", "This is an App review account: upload its photos here instead (Upload / Replace).");
  if (m[3] === "approve") {
    if (!(await approvePhoto(users, target))) return changed();
    await audit(req, "photo_approve", { user: target.userId, slot, photo: target.photoId });
    return json(res, 200, { ok: true, ...(await fresh()) });
  }
  // Disqualify: the slot is emptied as a reject empties it and the person told (a notice), the empty slots at the end are
  // dropped, then the stored photo is deleted; block = also block them. Never an App review account's photo.
  if (isReview(u)) return reviewAccount();
  const notice = photoNotice({ id: `N-${crypto.randomBytes(6).toString("hex")}`, slot });
  if (!(await disqualifyPhoto(users, { ...target, notice }))) {
    // Made an App review account meanwhile, or that photo is no longer in that slot.
    return isReview(await users.findOne({ _id: target.userId }, { projection: { demo: 1 } })) ? reviewAccount() : changed();
  }
  await trimPhotoSlots(users, target.userId);
  await photoStore().remove(target.photoId);
  const blocked = body.value.block === true ? await blockUser(d, u) : null;
  await audit(req, "photo_disqualified", {
    user: target.userId, slot, photo: target.photoId, block: Boolean(blocked), ...(blocked ? { alreadyBlocked: blocked.alreadyBlocked } : {}),
  });
  return json(res, 200, { ok: true, blocked: Boolean(blocked), ...(await fresh()) });
}

/**
 * POST …/photos/:index/upload (signed in, same-origin, an image type: checked before this; the photo limit counted).
 * The App review test users' photos, put in by the team (owner 2026-10-15: "its take 1 hours to make 4 test users
 * damn") — ONLY an App review account's: the team never puts a photo on a real person's profile. The bytes go through
 * the photo store (re-encoded JPEG ≤ 720 px, EXIF stripped) and into slot m[2], approved at once; the photo there before
 * is deleted only after the swap went through (a profile's own is kept for Stop, see below). The swap is conditional on
 * the slot still holding the photo read here, so a slot changed meanwhile (another upload, Refresh photos or Edit that
 * landed first, Stop being a review account, a delete) → 409 and the new file is removed; Refresh photos, Edit and Stop
 * are conditional on the photos they read in turn, so an upload landing first makes THEM answer 409. → { ok, user, slots,
 * count } (the GET's view + the photos waiting). Audited with ids only.
 */
async function uploadRoute(req, res, d, m) {
  const users = d.collection("thirtyda_users");
  const index = Number(m[2]);
  const fresh = async () => ({ ...(await userPhotosView(d, m[1])), count: await pendingCount(users) });
  const refused = async (reason, error) => json(res, 409, { error, reason, ...(await fresh()) });
  const notReview = () => refused("not_review_account", "Only an App review account takes uploaded photos: the team never puts photos on a real person's profile.");
  const notFound = () => json(res, 404, { error: "There is no such profile (it may be deleted already).", reason: "not_found" });
  const u = await users.findOne({ _id: m[1] }, {
    projection: { photos: 1, demo: 1, demoPhotos: 1, demoPreset: 1, deleting: 1, photoReview: 1, photoReviewAt: 1, reviewUploads: 1, "reviewWas.photos": 1 },
  });
  if (!u || u.deleting) {
    req.resume();
    return notFound();
  }
  if (!isReview(u)) {
    req.resume();
    return notReview();
  }
  const body = await readRawBody(req, UPLOAD_BYTES_MAX);
  if (body.tooLarge) return json(res, 413, { error: "That photo is too big: 10 MB at most.", reason: "too_large" }, { Connection: "close" });
  if (body.bad || !body.buf.length) return json(res, 400, { error: "Choose a photo to upload.", reason: "bad_photo" });
  // The photo the request read (null: an empty slot, or past the end of the list): swapped only while it is still there.
  await ensurePhotoArray(users, u);
  const old = u.photos[index] ?? null;
  let photoId;
  try {
    photoId = await photoStore().save(body.buf);
  } catch (err) {
    if (err instanceof PhotoError) return json(res, 400, { error: err.message, reason: "bad_photo" });
    throw err;
  }
  const demoKind = Array.isArray(u.demoPhotos) ? DEMO_UPLOADED : null;
  // Made from an existing profile ("Use as review account"): "Stop being a review account" puts it back among real
  // people, so the upload is recorded and the profile's own photo it replaces is KEPT, not deleted — Stop takes the
  // team's photo out again and puts that one back (src/lib/thirtyda-review.mjs stopReviewAccount).
  const fromProfile = !u.demoPreset;
  const own = fromProfile && isPhotoId(old) && u.reviewUploads?.[index] !== old;
  const kept = own ? { id: old, pendingAt: isPending(u, index) ? u.photoReviewAt?.[index] ?? new Date().toISOString() : null } : null;
  let ok;
  try {
    ok = await putReviewPhoto(users, { userId: u._id, index, oldId: old, photoId, demoKind, fromProfile, kept });
  } catch (err) {
    await photoStore().remove(photoId); // the database refused (a failover, a write error): no file left behind
    throw err;
  }
  if (!ok) {
    await photoStore().remove(photoId);
    const now = await users.findOne({ _id: u._id }, { projection: { demo: 1, deleting: 1 } });
    if (!now || now.deleting) return notFound();
    return isReview(now) ? refused("photo_changed", "This photo was changed meanwhile. The photos are up to date now: upload again.") : notReview();
  }
  // The photo it replaced: the team's own earlier upload (or a preset's) is deleted; the profile's own waits for Stop
  // (and one of its own kept earlier for this slot, now replaced by this one, goes).
  const before = u.reviewWas?.photos?.[index]?.id;
  if (own) {
    if (isPhotoId(before) && before !== old) await photoStore().remove(before);
  } else if (isPhotoId(old) && old !== photoId) await photoStore().remove(old);
  await audit(req, "review_photo_upload", { user: u._id, slot: index + 1, photo: photoId, ...(isPhotoId(old) ? { [own ? "kept" : "replaced"]: old } : {}) });
  return json(res, 200, { ok: true, ...(await fresh()) });
}

/**
 * POST /api/users/:id/delete { confirm: id } (signed in, same-origin JSON: checked before this): the whole account, for
 * good, through the app's own full delete (deleteAccount: profile, photos, messages, sessions, sign-in links, codes).
 * The one delete path of the admin: Users → Delete (monitor.js) and App review → Remove (review.js) both call it.
 * The confirm must be the id itself; an unknown id → 404. → the overview (the row is gone, the counts are fresh).
 * Audited with the id only.
 */
async function deleteUserRoute(req, res, id) {
  if (writeLimited(req)) {
    req.resume();
    return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
  }
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge || body.bad) return json(res, 400, { error: "Send JSON." });
  if (body.value.confirm !== id) return json(res, 400, { error: `Confirm with the profile's id (${id}).`, reason: "confirm" });
  const d = await db();
  const u = await d.collection("thirtyda_users").findOne({ _id: id }, { projection: { _id: 1 } });
  if (!u) return json(res, 404, { error: "There is no such profile (it may be deleted already).", reason: "not_found" });
  const r = await (testHooks.deleteAccount ?? deleteAccount)(d, id);
  // Sign in with Apple: whether the profile's Apple token was revoked too (only for a profile that had one).
  const appleRevoke = r?.apple ?? null;
  await audit(req, "delete_user", { user: id, ...(appleRevoke ? { appleRevoke } : {}) });
  return json(res, 200, { ...(await overview()), deleted: id, ...(appleRevoke ? { appleRevoke } : {}) });
}

/** Everything the App review page shows: the review accounts, the notes, and the "Create demo account" panel. */
async function reviewPage(d) {
  const [view, demo] = await Promise.all([reviewView(d), demoView(d)]);
  return { ...view, demo };
}

/**
 * The App review page's writes (signed in, same-origin JSON: checked before this). Every answer is the page's fresh
 * data; refusals are { error } in plain words. The audit carries ids and on/off only.
 */
async function reviewRoute(req, res, m) {
  if (writeLimited(req)) {
    req.resume();
    return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
  }
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge || body.bad) return json(res, 400, { error: "Send JSON." });
  const v = body.value;
  const d = await db();
  try {
    if (m[1] === "switch") {
      if (typeof v.on !== "boolean") return json(res, 400, { error: "Send { on: true | false }." });
      const r = await setReviewSwitch(d, v.on);
      // OFF: the phones that signed in to a demo account lose their Create profile pass (src/lib/thirtyda-review-world.mjs).
      const devicesForgotten = v.on ? 0 : await forgetReviewDevices(d);
      await audit(req, "review_switch", { on: v.on, sessionsEnded: r.sessionsEnded, devicesForgotten });
      if (v.on) await freshReviewWorld(req, d);
    } else if (m[1] === "code") {
      await newReviewCode(d);
      await audit(req, "review_code_new");
      await freshReviewWorld(req, d);
    } else if (m[2] && m[3]) {
      // The photos uploaded on Users → Photos go (the profile's own come back): through the same photo store.
      const r = await stopReviewAccount(d, m[2], { remove: (x) => photoStore().remove(x) });
      await audit(req, "review_account_stop", { user: m[2], sessionsEnded: r.sessionsEnded, photosDeleted: r.photosDeleted });
    } else if (m[2]) {
      const phone = normalizePhone(v.phone);
      await makeReviewAccount(d, m[2], { phone, pin: typeof v.pin === "string" || typeof v.pin === "number" ? String(v.pin) : "" });
      await audit(req, "review_account_save", { user: m[2] });
    }
  } catch (err) {
    if (err instanceof ReviewError) return json(res, err.status, { error: err.message, reason: err.code });
    if (err instanceof SettingsError && err.code === "no_key") {
      return json(res, 503, { error: "The server's lock key is missing, so the code cannot be kept. Ask your developer to set it.", reason: "no_key" });
    }
    throw err;
  }
  return json(res, 200, await reviewPage(d));
}

/**
 * "Create demo account" (m[1] = 'demo') and "Refresh photos" (m[2] = the id) on the App review page (signed in,
 * same-origin JSON: checked before this). → the page's fresh data (+ created / id); refusals { error, reason, field? }.
 * Audited with ids and the preset only (never a number, a PIN or a name).
 */
async function demoRoute(req, res, m) {
  if (writeLimited(req)) {
    req.resume();
    return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
  }
  const body = await readJsonBody(req, 1e4);
  if (body.tooLarge || body.bad) return json(res, 400, { error: "Send JSON." });
  const v = body.value;
  const d = await db();
  const text = (x) => (typeof x === "string" || typeof x === "number" ? String(x) : undefined);
  try {
    if (m[2]) {
      await refreshDemoPhotos(d, m[2]);
      await audit(req, "review_demo_photos", { user: m[2] });
      return json(res, 200, { ...(await reviewPage(d)), id: m[2] });
    }
    const preset = typeof v.preset === "string" ? v.preset : "";
    const fields = {
      name: text(v.name), realName: text(v.realName), gender: text(v.gender), birthYear: v.birthYear == null ? undefined : text(v.birthYear),
      role: text(v.role), lang: text(v.lang), phone: text(v.phone), pin: text(v.pin),
    };
    const r = await createDemoAccount(d, preset, fields);
    await audit(req, "review_demo_save", { user: r.user._id, preset, created: r.created });
    return json(res, 200, { ...(await reviewPage(d)), id: r.user._id, created: r.created });
  } catch (err) {
    if (err instanceof ReviewError) return json(res, err.status, { error: err.message, reason: err.code, ...(err.field ? { field: err.field } : {}) });
    throw err;
  }
}

/**
 * Review sign-in ON / New code (owner 2026-10-14, the iOS audit): a block between two demo accounts would leave the next
 * reviewer an empty Nearby the blocked side cannot undo — lift those blocks and close the open flags between demo
 * accounts (src/lib/thirtyda-review-world.mjs). Audited with ids only, only when there was something to clear.
 */
async function freshReviewWorld(req, d) {
  const r = await clearReviewWorld(d);
  if (r.blocks.length || r.flags.length) await audit(req, "review_world_reset", { blocks: r.blocks, flags: r.flags });
}

export async function handleThirtyDaAdmin(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const sub = path.slice(BASE.length) || "/";

  const asset = sub.match(/^\/(app\.css|signin\.js|monitor\.js|questions\.js|connections\.js|support\.js|support\.css|support-badge\.js|photos\.js|photos\.css|review\.js|review\.css|delete-profile\.js|gk-smart-logo\.png|gk-smart-favicon\.png)$/);
  if (req.method === "GET" && asset) return serveFile(res, asset[1]);

  if (req.method !== "GET" && req.method !== "HEAD" && sub.startsWith("/api/")) {
    const refused = writeRefused(req, { photo: req.method === "POST" && UPLOAD_PATH.test(sub) });
    if (refused) {
      req.resume();
      return json(res, refused[0], { error: refused[1] });
    }
  }

  if (req.method === "POST" && sub === "/api/signin") {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      await audit(req, "signin_blocked", { reason: "rate_limit" });
      return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    }
    const { code = "" } = await readJson(req);
    if (!checkCode(code)) {
      attempts.get(ip).push(Date.now());
      failures.push(Date.now());
      await audit(req, "signin_failed");
      return json(res, 401, { error: "That code is not right." });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    const d = await db();
    await d.collection("thirtyda_admin_sessions").insertOne({
      _id: token,
      created: new Date(),
      expires: new Date(Date.now() + SESSION_HOURS * 3600e3),
    });
    await audit(req, "signin");
    return json(res, 200, { ok: true, next: `${BASE}/monitor` }, {
      "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${BASE}; Max-Age=${SESSION_HOURS * 3600}`,
    });
  }

  const me = await signedIn(req);

  if (req.method === "GET" && sub === "/") {
    if (me) return send(res, 302, "", { Location: `${BASE}/monitor` });
    return serveFile(res, "signin.html");
  }
  if (req.method === "GET" && sub === "/monitor") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_monitor");
    return serveFile(res, "monitor.html");
  }
  if (req.method === "GET" && sub === "/questions") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_questions");
    return serveFile(res, "questions.html");
  }
  if (req.method === "GET" && (sub === "/connections" || sub === "/code")) {
    // The "Code" page; /code is the same page under its new name.
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_connections");
    return serveFile(res, "connections.html");
  }
  if (req.method === "GET" && sub === "/support") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_support");
    return serveFile(res, "support.html");
  }
  if (req.method === "GET" && sub === "/photos") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_photos");
    return serveFile(res, "photos.html");
  }
  if (req.method === "GET" && sub === "/review") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_review");
    return serveFile(res, "review.html");
  }

  // "Try sign-in" (Google / Facebook / TikTok card): opened in a new tab, so it answers with pages and redirects, not JSON.
  const tryM = req.method === "GET" && sub.match(/^\/api\/connections\/(google|facebook|tiktok)\/try$/);
  if (tryM) {
    if (!me) return send(res, 302, "", { Location: BASE });
    const provider = tryM[1];
    const page = (reason) => send(res, 200, tryResultPage({ provider, ok: false, reason, lang: requestLang(req, url) }), {
      "Content-Type": TYPES.html, "Cache-Control": "no-store", "X-Robots-Tag": "noindex", Vary: "Accept-Language",
    });
    if (testLimited(req)) return page("too_many");
    const d = await db();
    const keys = await signinKeys(d, provider);
    if (!keys) return page("no_keys");
    // The test state is bound to this admin session (its token's hash): the callback checks it is still signed in.
    const pkce = pkcePair(provider);
    const state = await createSigninState(d, provider, { test: true, adminHash: stateHash(tokenOf(req)), verifier: pkce?.verifier });
    await audit(req, "signin_try_start", { connection: provider });
    return send(res, 302, "", {
      Location: authorizeUrl(provider, { clientId: keys.id, redirectUri: signinRedirect(req, provider), state, codeChallenge: pkce?.challenge }),
      "Set-Cookie": stateCookie(req, provider, state),
      "Cache-Control": "no-store",
    });
  }

  if (sub.startsWith("/api/") && !me) return json(res, 401, { error: "signed_out" });

  if (req.method === "POST" && sub === "/api/signout") {
    const d = await db();
    await d.collection("thirtyda_admin_sessions").deleteOne({ _id: tokenOf(req) });
    await audit(req, "signout");
    return json(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${BASE}; Max-Age=0` });
  }

  if (req.method === "GET" && sub === "/api/overview") return json(res, 200, await overview());

  if (req.method === "GET" && sub === "/api/chat") {
    const flag = url.searchParams.get("flag");
    const user = url.searchParams.get("user");
    const chat = await chatFor({ flag, user });
    await audit(req, "view_chat", { flag, user, chat: chat?.id ?? null });
    return json(res, 200, { chat });
  }

  if (req.method === "GET" && sub === "/api/questions") {
    const d = await db();
    const levels = await Promise.all(QUESTION_LEVELS.map(async (level) => questionsView(level, await questionConfig(d, level))));
    return json(res, 200, { levels });
  }

  let m = sub.match(/^\/api\/questions\/(L\d)(\/reset)?$/);
  if (m && ((req.method === "PUT" && !m[2]) || (req.method === "POST" && m[2]))) {
    const level = levelFromId(m[1]);
    if (!level) return json(res, 404, { error: "No such level." });
    if (writeLimited(req)) return json(res, 429, { error: "Too many saves. Try again in a few minutes." });
    const d = await db();
    if (m[2]) {
      const { config, diff } = await resetQuestions(d, level);
      await audit(req, "questions_reset", { level: m[1], changes: diff.changes, summary: diff.summary });
      return json(res, 200, { ...questionsView(level, config), changes: diff.changes, summary: diff.summary });
    }
    const body = await readJsonBody(req, QUESTIONS_BODY_MAX);
    if (body.tooLarge) return json(res, 413, { error: "That is too much text to save." });
    if (body.bad || !Array.isArray(body.value.slots)) return json(res, 400, { error: "Send { slots: [...] }." });
    const opts = {
      ...("updatedAt" in body.value ? { baseUpdatedAt: body.value.updatedAt } : {}),
      ...("titles" in body.value ? { titles: body.value.titles } : {}),
    };
    const r = await saveQuestions(d, level, body.value.slots, opts);
    if (r.conflict) {
      return json(res, 409, {
        error: "These questions were changed in another tab. Reload to see the latest before saving.",
        current: questionsView(level, r.current),
      });
    }
    if (!r.ok) {
      const n = r.problems.length;
      return json(res, 422, { error: `Fix ${n} ${n === 1 ? "problem" : "problems"} before saving.`, problems: r.problems });
    }
    await audit(req, "questions_update", { level: m[1], changes: r.diff.changes, summary: r.diff.summary });
    return json(res, 200, { ...questionsView(level, r.config), changes: r.diff.changes, summary: r.diff.summary });
  }

  if (req.method === "GET" && sub === "/api/connections") return json(res, 200, await connectionsView(await db(), req));

  // Tower 11 · Wan: tokens, options, Try, and the Try's clip (src/lib/thirtyda-hub-wan.mjs).
  m = sub.match(/^\/api\/connections\/wan\/(tokens\/(client|worker)|options|try|clips\/([a-f0-9]{32}))$/);
  if (m) return wanRoute(req, res, m);

  // Tower 13 · Translate: On / Off + the wait (PUT options), Try (POST try). Its keys: the generic PUT / DELETE below.
  m = sub.match(/^\/api\/connections\/translate\/(options|try)$/);
  if (m) return translateRoute(req, res, m);

  // Tower 12 · Places: Refresh now, a test search (src/lib/thirtyda-hub-places.mjs).
  m = sub.match(/^\/api\/connections\/places\/(refresh|search|google)$/);
  if (m) return placesRoute(req, res, m);

  // Sign in with Apple's key: "Try the key" (Save / Remove are the generic PUT / DELETE below).
  if (req.method === "POST" && sub === "/api/connections/apple/try") return appleTryRoute(req, res);

  // The free Telegram bot: PUT { token } (Save) · POST …/try · DELETE (Remove).
  m = sub.match(/^\/api\/connections\/telegram-bot(\/try)?$/);
  if (m && ((m[1] && req.method === "POST") || (!m[1] && (req.method === "PUT" || req.method === "DELETE")))) {
    return telegramBotRoute(req, res, Boolean(m[1]));
  }

  m = sub.match(/^\/api\/connections\/([a-z]+)(\/test)?$/);
  if (m && ((m[2] && req.method === "POST") || (!m[2] && (req.method === "PUT" || req.method === "DELETE")))) {
    const id = m[1];
    if (!CONNECTION_NAMES[id]) {
      req.resume();
      return json(res, 404, { error: "There is no such card on this page." });
    }
    if (m[2] && !TESTABLE.includes(id)) {
      req.resume();
      return json(res, 404, { error: `${CONNECTION_NAMES[id]} has no test code: use Try sign-in on its card.` });
    }
    if (writeLimited(req)) {
      req.resume();
      return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
    }
    const d = await db();
    const name = CONNECTION_NAMES[id];

    if (m[2]) {
      // A real code to a real phone through what is saved (Telegram: or THIRTYDA_TG_TOKEN): proves the setup works.
      const body = await readJsonBody(req, 1e4);
      if (body.bad || body.tooLarge) return json(res, 400, { error: "Send { phone }." });
      const phone = normalizePhone(body.value.phone);
      if (!phone) return json(res, 422, { error: "That phone number does not look right. Write it with the country code, e.g. +855 12 345 678.", reason: "bad_phone" });
      const view = await connectionsView(d, req);
      if (!view.connections.find((c) => c.id === id)?.live) {
        const what = id === "telegram" ? "a Telegram token" : "all four WhatsApp boxes";
        return json(res, 400, { error: `Save ${what} first, then send a test code.`, reason: "not_set" });
      }
      if (testLimited(req)) return json(res, 429, { error: `That is ${MAX_TESTS} test codes in 15 minutes. Try again later.` });
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      // test: a code that goes through turns the channel on in the app; a lasting failure stops it (channelOffer).
      const r = await deliverCode(id, phone, code, { d, record: false, test: true, fetchImpl: outboundFetch() });
      await audit(req, "connection_test", {
        connection: id, phone: maskPhone(phone), ok: r.ok, ...(r.ok ? { requestId: r.requestId } : { reason: r.reason, detail: r.detail }),
      });
      const fresh = await connectionsView(d, req);
      if (!r.ok) return json(res, 422, { ok: false, error: r.message, reason: r.reason, detail: r.detail, phone, view: fresh });
      // The test code is not a sign-in code (nothing stores it): showing it lets the admin match what arrives.
      return json(res, 200, { ok: true, phone, code, ttl: CODE_TTL_S, requestId: r.requestId, cost: r.cost, balance: r.balance, view: fresh });
    }

    if (req.method === "DELETE") {
      req.resume();
      const r = await removeSecret(d, id);
      if (id === "translate") resetTranslate(); // the app goes back to the env (or off) at once
      if (id === "googleplaces") placesGoogle().reset(); // the app stops asking Google at once
      await audit(req, "connection_remove", { connection: id, removed: r.removed });
      return json(res, 200, await connectionsView(d, req));
    }

    const body = await readJsonBody(req, 1e4);
    if (body.tooLarge) return json(res, 413, { error: "That is far too long to save." });
    if (body.bad) return json(res, 400, { error: id === "telegram" ? "Send { token }." : "Send the boxes as JSON." });
    try {
      if (id === "telegram") {
        const c = checkTelegramToken(body.value.token);
        if (!c.ok) return json(res, 422, { error: c.error, field: "token" });
        const saved = await saveSecret(d, "telegram", c.token, { by: "superadmin" });
        await audit(req, "connection_save", { connection: "telegram", last4: saved.last4 });
      } else {
        // An empty secret box keeps the secret already saved (so a template name can change without the token).
        const current = await readFields(d, id).catch(() => null);
        const c = FIELD_CHECKS[id](body.value, current);
        if (!c.ok) return json(res, 422, { error: c.error, field: c.field });
        const saved = await saveFields(d, id, c.values, { by: "superadmin" });
        if (id === "translate") resetTranslate(); // the app uses the new server at once
        if (id === "googleplaces") placesGoogle().reset(); // the app uses the new key at once
        // Never a secret in the audit: only which boxes changed, and the secrets' last 4.
        const changed = Object.keys(c.values).filter((f) => !current || current[f] !== c.values[f]);
        await audit(req, "connection_save", { connection: id, masks: saved.masks, changed });
      }
    } catch (err) {
      if (err instanceof SettingsError && err.code === "no_key") {
        await audit(req, "connection_save_refused", { connection: id, reason: "no_key" });
        return json(res, 503, {
          error: `The server's lock key is missing, so the ${name} keys cannot be saved yet. Ask your developer to set it, then save again.`,
          reason: "no_key",
        });
      }
      throw err;
    }
    return json(res, 200, await connectionsView(d, req));
  }

  // Support: questions people sent the Telegram bot, and the team's replies (src/lib/thirtyda-support.mjs).
  if (req.method === "GET" && sub === "/api/support/unread") return json(res, 200, { unread: await supportUnread(await db()) });
  if (req.method === "GET" && sub === "/api/support") {
    const d = await db();
    const [list, bot] = await Promise.all([listSupportChats(d), botView(d)]);
    return json(res, 200, { ...list, max: SUPPORT_TEXT_MAX, bot: { set: bot.set, username: bot.username, offered: bot.offered } });
  }
  m = sub.match(/^\/api\/support\/(\d{1,16})(\/reply)?$/);
  if (m && ((req.method === "GET" && !m[2]) || (req.method === "POST" && m[2]))) {
    const chatId = Number(m[1]);
    const d = await db();
    if (!m[2]) {
      const thread = Number.isSafeInteger(chatId) ? await supportThread(d, chatId) : null;
      if (!thread) return json(res, 404, { error: "There is no such conversation." });
      // The page refreshes an open conversation every few seconds: only the opening is audited.
      if (url.searchParams.get("refresh") !== "1") await audit(req, "support_open", { chatId });
      return json(res, 200, thread);
    }
    if (replyLimits.over(tokenOf(req) || clientIp(req), MAX_REPLIES)) {
      req.resume();
      return json(res, 429, { error: "That is a lot of replies in 15 minutes. Try again in a few minutes." });
    }
    const body = await readJsonBody(req, 64e3);
    if (body.tooLarge) return json(res, 413, { error: `A reply can be at most ${SUPPORT_TEXT_MAX} characters.` });
    if (body.bad) return json(res, 400, { error: "Send { text }." });
    const r = await sendSupportReply(d, chatId, body.value.text, { fetchImpl: outboundFetch() });
    // Ids and lengths only: never the words.
    const length = typeof body.value.text === "string" ? body.value.text.trim().length : 0;
    await audit(req, "support_reply", { chatId, length, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
    if (!r.ok) return json(res, r.status, { error: r.error, reason: r.reason });
    return json(res, 200, { ok: true, message: r.message, ...(await supportThread(d, chatId, { markRead: false })) });
  }

  // App review (src/lib/thirtyda-review.mjs): demo accounts for the App Store / Google Play reviewers.
  if (req.method === "GET" && sub === "/api/review") return json(res, 200, await reviewPage(await db()));
  m = sub.match(/^\/api\/review\/(switch|code|accounts\/(U-\d+)(\/stop)?)$/);
  if (req.method === "POST" && m) return reviewRoute(req, res, m);
  m = sub.match(/^\/api\/review\/(demo)(?:\/(U-\d+)\/photos)?$/);
  if (req.method === "POST" && m) return demoRoute(req, res, m);

  m = sub.match(/^\/api\/users\/(U-\d+)\/delete$/);
  if (req.method === "POST" && m) return deleteUserRoute(req, res, m[1]);

  m = sub.match(/^\/api\/users\/(U-\d+)\/(block|unblock)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const users = d.collection("thirtyda_users");
    const flags = d.collection("thirtyda_flags");
    const u = await users.findOne({ _id: m[1] });
    if (!u) return json(res, 404, { error: "No such user." });
    const { flagId = null, undo = false } = await readJson(req);
    // A demo account stays usable for the store reviewers: the App review page stops it first (owner 2026-10-14).
    if (m[2] === "block" && isReview(u)) {
      return json(res, 409, { error: "This is an App review demo account, so it is not blocked. Stop it on the App review page first.", reason: "review_account" });
    }
    const alreadyBlocked = m[2] === "block" && Boolean(u.blocked);
    if (m[2] === "block") {
      await blockUser(d, u);
    } else if (m[2] === "unblock" && u.blocked) {
      if (undo) await flags.updateMany({ _id: { $in: u.blockResolved || [] } }, reopenUpdate());
      await users.updateOne({ _id: u._id }, { $set: { blocked: false, blockResolved: [] } });
    }
    await audit(req, m[2] === "block" ? (alreadyBlocked ? "block_user_again" : "block_user") : undo ? "undo_block" : "unblock_user", { user: u.id, flagId });
    return json(res, 200, { ...(await overview()), alreadyBlocked });
  }

  // Users → Photos: a profile's 4 photos — view, approve, disqualify; upload into an App review account (owner 2026-10-15).
  m = sub.match(/^\/api\/users\/(U-\d+)\/photos(?:\/([0-3])(?:\/(approve|disqualify|upload))?)?$/);
  if (m) return userPhotosRoute(req, res, m, url);

  // Photos waiting for approval (store policy, owner 2026-10-14, src/lib/thirtyda-photo-review.mjs).
  if (req.method === "GET" && sub === "/api/photos") return json(res, 200, await photoQueueView(await db()));
  if (req.method === "GET" && sub === "/api/photos/count") return json(res, 200, { count: (await photoQueueView(await db())).count });
  // The photo itself: only while it waits for approval, only for the admin, never cached.
  m = sub.match(/^\/api\/photos\/([a-f0-9]{32})$/);
  if (req.method === "GET" && m) {
    const d = await db();
    const owner = await pendingOwner(d.collection("thirtyda_users"), m[1]);
    const buf = owner ? await photoStore().read(m[1]) : null;
    if (!buf) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    return send(res, 200, buf, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "no-store" });
  }
  m = sub.match(/^\/api\/photos\/(U-\d+)\/([0-3])\/(approve|reject)$/);
  if (req.method === "POST" && m) {
    const body = await readJsonBody(req, 1e4);
    if (body.bad || body.tooLarge) return json(res, 400, { error: "Send { photoId }." });
    const target = reviewTarget(m[1], m[2], body.value.photoId);
    if (!target) return json(res, 400, { error: "Send { photoId }." });
    const d = await db();
    const users = d.collection("thirtyda_users");
    const slot = target.index + 1;
    const changed = async () => json(res, 409, {
      error: "This photo was changed or already checked. The list is up to date now.", ...(await photoQueueView(d)),
    });
    if (m[3] === "approve") {
      if (!(await approvePhoto(users, target))) return changed();
      await audit(req, "photo_approve", { user: target.userId, slot, photo: target.photoId });
      return json(res, 200, { ok: true, ...(await photoQueueView(d)) });
    }
    // Reject: the slot is emptied and the person told (a notice), then the stored photo is deleted; block = also block them.
    const notice = photoNotice({ id: `N-${crypto.randomBytes(6).toString("hex")}`, slot });
    if (!(await rejectPhoto(users, { ...target, notice }))) return changed();
    await trimPhotoSlots(users, target.userId);
    await photoStore().remove(target.photoId);
    let blocked = null;
    if (body.value.block === true) {
      const u = await users.findOne({ _id: target.userId });
      if (u && !isReview(u)) blocked = await blockUser(d, u); // a demo account is never blocked (App review)
    }
    await audit(req, "photo_reject", {
      user: target.userId, slot, photo: target.photoId, block: Boolean(blocked), ...(blocked ? { alreadyBlocked: blocked.alreadyBlocked } : {}),
    });
    return json(res, 200, { ok: true, blocked: Boolean(blocked), ...(await photoQueueView(d)) });
  }

  // The photo a report points at (store policy, owner 2026-10-14): only through its flag, only for the admin, never cached.
  m = sub.match(/^\/api\/flags\/(f\d+)\/photo$/);
  if (req.method === "GET" && m) {
    const d = await db();
    const f = await d.collection("thirtyda_flags").findOne({ _id: m[1] }, { projection: { photoId: 1 } });
    const buf = f && isPhotoId(f.photoId) ? await photoStore().read(f.photoId) : null;
    if (!buf) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    await audit(req, "view_reported_photo", { flag: m[1] });
    return send(res, 200, buf, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "no-store" });
  }

  m = sub.match(/^\/api\/flags\/(f\d+)\/(warn|dismiss)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const flags = d.collection("thirtyda_flags");
    const f = await flags.findOne({ _id: m[1], status: "open" });
    if (!f) return json(res, 404, { error: "This flag is already closed." });
    // A warning keeps the flag in the queue so it can still be blocked or dismissed; Dismiss closes it (resolvedAt +
    // resolvedAction, src/lib/thirtyda-blocks.mjs).
    const at = new Date().toISOString();
    await flags.updateOne({ _id: f._id }, m[2] === "warn" ? { $set: { warned: true, warnedAt: f.warnedAt ?? at } } : resolveUpdate("dismissed", at));
    if (m[2] === "warn" && !f.warned) {
      // The app shows unseen notices as a dialog the user has to acknowledge (rule 'word': in its bad-word wording).
      const word = BAD_WORD_REASON_SET.has(f.reason);
      await d.collection("thirtyda_users").updateOne({ _id: f.from }, {
        $push: {
          notices: {
            id: `N-${crypto.randomBytes(6).toString("hex")}`,
            kind: "warning",
            ...(word ? { rule: "word" } : {}),
            flagId: f.id,
            text: word ? WARNING_TEXT_WORD : WARNING_TEXT,
            at: new Date().toISOString(),
            seenAt: null,
          },
        },
      });
    }
    await audit(req, m[2] === "warn" ? "send_warning" : "dismiss_flag", { flag: f.id, user: f.from });
    return json(res, 200, await overview());
  }

  send(res, 404, "Not found", { "Content-Type": "text/plain" });
}
