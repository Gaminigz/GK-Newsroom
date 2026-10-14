/**
 * 30+DA, photo review (store policy, owner 2026-10-14: "Yes, I approve photos").
 *
 *   thirtyda_users.photoReview   { '<slot index>': 'pending' }   a photo the team has not checked yet (index 0–3)
 *   thirtyda_users.photoReviewAt { '<slot index>': ISO time }    when it was put in that slot
 *
 * Every new or replaced photo is 'pending' (POST /profile, POST /me/photos, PUT /me/photos/:i in
 * src/lib/thirtyda-app.mjs). A slot with no entry is approved: the photos of profiles made before the rule count as
 * approved. A pending photo shows only to its owner (Me says "Waiting for approval"): GET /photos/:id, Nearby, the
 * guest cards, GET /people, the conversation headers and a report's photo list all skip it for everyone else.
 *
 * The admin's Photos page (src/lib/thirtyda-admin.mjs, src/thirtyda-admin/photos.*) lists pending photos, photo 1
 * first, oldest first. Approve clears the entry. Reject empties the slot (the stored photo is deleted), tells the
 * person (a notice, kind 'photo') and can block them too. Both act only while THAT photo (its id) is still pending in
 * that slot, so a photo replaced meanwhile is never approved or deleted by mistake.
 *
 * Pure apart from the collection handed in, so the unit tests run without a database.
 */

import { isPhotoId } from "./thirtyda-photos.mjs";

export const PHOTO_PENDING = "pending";
const SLOTS = 4; // = PHOTO_MAX in src/thirtyda-app/shared/rules.js
/** What the person is told when a photo is rejected (the app shows it in their language: app_notice_photo). */
export const PHOTO_REJECTED_TEXT = "A photo was not accepted — please use a clear photo of your face.";

const slotsOf = (u) => (Array.isArray(u?.photos) ? u.photos.slice(0, SLOTS) : []);

/** true while the photo in slot `index` (0–3) waits for the team. */
export const isPending = (u, index) => Number.isInteger(index) && u?.photoReview?.[index] === PHOTO_PENDING;

/** The photo id in slot `index` as everyone but its owner may see it: null while pending (or empty). */
export const publicPhotoId = (u, index) => (isPending(u, index) ? null : slotsOf(u)[index] ?? null);

/** Slot-aligned with MeView.photos (trailing empty slots left out): true where a photo waits for approval. */
export function pendingFlags(u) {
  const slots = slotsOf(u);
  while (slots.length && !slots.at(-1)) slots.pop();
  return slots.map((id, i) => Boolean(id) && isPending(u, i));
}

/** The $set fields that make the photo just put in slot `index` pending. */
export const pendingSet = (index, at = new Date().toISOString()) => ({
  [`photoReview.${index}`]: PHOTO_PENDING, [`photoReviewAt.${index}`]: at,
});

/** The $unset fields that clear slot `index`'s review (approved, removed or rejected). */
export const reviewUnset = (index) => ({ [`photoReview.${index}`]: "", [`photoReviewAt.${index}`]: "" });

/** A new profile's fields: photo 1 (slot index 0) pending. */
export const newProfileReview = (at = new Date().toISOString()) => ({ photoReview: { 0: PHOTO_PENDING }, photoReviewAt: { 0: at } });

/** Finds every profile with at least one pending photo. */
export const pendingFilter = () => ({ $or: Array.from({ length: SLOTS }, (_, i) => ({ [`photoReview.${i}`]: PHOTO_PENDING })) });

/** Only while that exact photo is still pending in that slot. */
const stillPending = (userId, index, photoId) => ({ _id: userId, [`photos.${index}`]: photoId, [`photoReview.${index}`]: PHOTO_PENDING });

/** "U-10234", 0–3, a photo id → the checked target, or null. */
export function reviewTarget(userId, index, photoId) {
  const i = Number(index);
  if (!/^U-\d+$/.test(String(userId ?? "")) || !Number.isInteger(i) || i < 0 || i >= SLOTS || !isPhotoId(photoId)) return null;
  return { userId: String(userId), index: i, photoId };
}

/**
 * The admin's queue from user documents: one row per pending photo — photo 1 first (the face Nearby shows), then the
 * oldest first. A slot whose photo is gone is left out. Blocked profiles are listed too (marked), so nothing waits forever.
 */
export function queueRows(users) {
  const rows = [];
  for (const u of users) {
    slotsOf(u).forEach((id, i) => {
      if (!isPending(u, i) || !isPhotoId(id)) return;
      rows.push({
        user: u._id, name: u.name ?? "", slot: i + 1, index: i, photoId: id, at: u.photoReviewAt?.[i] ?? null,
        // Nothing of theirs is public right now (a new profile, or a replaced main photo with nothing else approved).
        blocked: Boolean(u.blocked), nonePublic: !slotsOf(u).some((x, j) => x && !isPending(u, j)),
      });
    });
  }
  return rows.sort((a, b) => a.index - b.index || String(a.at ?? "").localeCompare(String(b.at ?? "")) || a.user.localeCompare(b.user));
}

const QUEUE_FIELDS = { name: 1, photos: 1, photoReview: 1, photoReviewAt: 1, blocked: 1 };

/** The pending photos, as queueRows. */
export async function pendingQueue(users) {
  return queueRows(await users.find(pendingFilter(), { projection: QUEUE_FIELDS }).toArray());
}

/** How many photos wait (the sidebar badge on every admin page). */
export async function pendingCount(users) {
  return (await pendingQueue(users)).length;
}

/** The profile a pending photo belongs to, or null when that photo is not (or no longer) pending. */
export async function pendingOwner(users, photoId) {
  if (!isPhotoId(photoId)) return null;
  const u = await users.findOne({ photos: photoId }, { projection: QUEUE_FIELDS });
  return u && isPending(u, slotsOf(u).indexOf(photoId)) ? u : null;
}

/** Approve → true, or false when that photo is no longer pending in that slot (replaced, removed or already checked). */
export async function approvePhoto(users, { userId, index, photoId }) {
  const r = await users.updateOne(stillPending(userId, index, photoId), { $unset: reviewUnset(index) });
  return Boolean(r.modifiedCount);
}

/** The notice a rejected photo leaves (shown once, as a dialog the person has to acknowledge). */
export const photoNotice = ({ id, slot, at = new Date().toISOString() }) => ({
  id, kind: "photo", slot, text: PHOTO_REJECTED_TEXT, at, seenAt: null,
});

/**
 * Reject → true (the slot is empty now and the notice is on the profile; the caller deletes the stored photo and,
 * when asked, blocks the person), or false when that photo is no longer pending in that slot.
 */
export async function rejectPhoto(users, { userId, index, photoId, notice }) {
  const r = await users.updateOne(stillPending(userId, index, photoId), {
    $set: { [`photos.${index}`]: null }, $unset: reviewUnset(index), $push: { notices: notice },
  });
  return Boolean(r.modifiedCount);
}
