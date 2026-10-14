/**
 * 30+DA App review, the reviewers' side (owner 2026-10-14, after the iOS session's live audit). The demo accounts
 * themselves, the switch and the code are src/lib/thirtyda-review.mjs; this keeps the demo world usable for the
 * App Store / Google Play reviewers, who share phones and addresses and try every button.
 *
 *   - Review devices: a phone that signs in to a demo account (POST /auth/review/pin or /auth/review/verify, which send
 *     the app's device id) is kept as a review device — only a one-way hash of its id, like SIGNUP_DEVICES, never linked
 *     to a profile. While "Review sign-in" stays ON, Create profile without verifying skips "one profile per phone"
 *     (409 device_used) and the address's day limit for it (src/lib/thirtyda-app.mjs createProfile): the review notes ask
 *     reviewers to make a fresh profile to try Delete my account. Turning the switch OFF forgets every review device
 *     (the admin route), and each one goes by itself after REVIEW_DEVICE_KEEP_MS anyway (TTL on purgeAt).
 *   - A clean demo world: turning Review sign-in ON or pressing New code lifts every block between two review accounts
 *     and closes the open flags between them, so a reviewer who tried Block never leaves the next one an empty Nearby
 *     that the blocked side cannot undo. The admin route audits it with ids only.
 *   - The demo account's own "Delete my account" ends for the reviewer exactly like a real one (src/lib/thirtyda-delete.mjs
 *     deleteMe { demo }): signed out, "Your account was deleted" — the profile stays for the next reviewer.
 *
 * Pure apart from the `d` (Mongo Db) handed in, so the unit tests run without a database.
 */

import { REVIEW, reviewSwitch } from "./thirtyda-review.mjs";
import { deviceKey } from "./thirtyda-verify.mjs";
import { BLOCKS, resolveUpdate } from "./thirtyda-blocks.mjs";

export const REVIEW_DEVICES = "thirtyda_review_devices"; // { _id: hash of the device id, at, purgeAt }
export const REVIEW_DEVICE_KEEP_MS = 30 * 864e5; // a backstop: the switch going OFF forgets them all at once
const USERS = "thirtyda_users";
const FLAGS = "thirtyda_flags";

/** Keep this phone as a review device (a hash of its id). → true when kept, false for no / a bad id. */
export async function markReviewDevice(d, deviceId, { now = Date.now() } = {}) {
  const key = deviceKey(deviceId);
  if (!key) return false;
  await d.collection(REVIEW_DEVICES).updateOne(
    { _id: key }, { $set: { at: new Date(now), purgeAt: new Date(now + REVIEW_DEVICE_KEEP_MS) } }, { upsert: true },
  );
  return true;
}

/** true only while "Review sign-in" is ON and this phone signed in to a demo account (no / a bad id → false). */
export async function isReviewDevice(d, deviceId) {
  const key = deviceKey(deviceId);
  if (!key || !(await reviewSwitch(d)).on) return false;
  return Boolean(await d.collection(REVIEW_DEVICES).findOne({ _id: key }, { projection: { _id: 1 } }));
}

/** "Review sign-in" OFF: every review device is forgotten. → how many. */
export async function forgetReviewDevices(d) {
  return (await d.collection(REVIEW_DEVICES).deleteMany({})).deletedCount ?? 0;
}

/**
 * Lift every block between two review accounts and close the open flags between them (a block's flag, a report):
 * resolvedAction 'review_reset', status 'dismissed'. Blocks and flags that touch a real person are never touched.
 * → { blocks: [block ids], flags: [flag ids] } (ids only, for the audit).
 */
export async function clearReviewWorld(d, { at = new Date().toISOString() } = {}) {
  const ids = (await d.collection(USERS).find({ demo: REVIEW }, { projection: { _id: 1 } }).toArray()).map((u) => u._id);
  if (ids.length < 2) return { blocks: [], flags: [] };
  const blocks = (await d.collection(BLOCKS).find({ by: { $in: ids }, who: { $in: ids } }, { projection: { _id: 1 } }).toArray())
    .map((b) => b._id);
  if (blocks.length) await d.collection(BLOCKS).deleteMany({ _id: { $in: blocks } });
  const flags = (await d.collection(FLAGS).find({ status: "open", from: { $in: ids }, to: { $in: ids } }, { projection: { _id: 1 } }).toArray())
    .map((f) => f._id);
  if (flags.length) await d.collection(FLAGS).updateMany({ _id: { $in: flags } }, resolveUpdate("review_reset", at, "dismissed"));
  return { blocks, flags };
}
