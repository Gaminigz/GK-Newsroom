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
 * Users → Photos (owner 2026-10-15: "the 4 photo preview and has function to manually view and approve or disqualify"):
 * the admin's Users table draws every profile's 4 slots (photoSummary: ids + status only) and a dialog shows them large
 * (adminSlots). Approve there is the same approve. Disqualify takes down ANY photo, approved or pending: the slot is
 * emptied exactly as a reject empties it, the person gets the same notice; it acts only while THAT photo is still in
 * that slot, and never on an App review account.
 *
 * Users → Photos → Upload (owner 2026-10-15, the 4 App review test users: "its take 1 hours to make 4 test users damn"):
 * the team puts a photo straight into a slot of an App review account — never a real person's — APPROVED at once (no
 * review entry: the team put it there). putReviewPhoto swaps it in only while that slot still holds the photo the
 * request read (or is still empty), so two uploads into one slot never both land. On a review account made from an
 * existing profile the upload is recorded and the profile's own photo kept, never deleted: "Stop being a review
 * account" takes the team's photos out and puts the profile's own back, so none of them reaches real people.
 *
 * Pure apart from the collection handed in, so the unit tests run without a database.
 */

import { isPhotoId } from "./thirtyda-photos.mjs";
import { REVIEW } from "./thirtyda-review.mjs";

export const PHOTO_PENDING = "pending";
/** A photo with no review entry (checked by the team, or put there before the rule): everyone may see it. */
export const PHOTO_APPROVED = "approved";
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

/** Slot `index` as the admin sees it: 'pending', 'approved', or null when it is empty. */
export function slotStatus(u, index) {
  if (!isPhotoId(slotsOf(u)[index])) return null;
  return isPending(u, index) ? PHOTO_PENDING : PHOTO_APPROVED;
}

/** true while `photoId` is the photo in slot `index` (approved or pending): the admin's view of that slot. */
export const photoInSlot = (u, index, photoId) => isPhotoId(photoId) && slotsOf(u)[index] === photoId;

/**
 * The 4 slots of one profile for the admin (Users → Photos), slot-aligned, empty ones included:
 * [{ index, photoId, status, at }] — `at` = when a pending photo was put there (null once approved, or empty).
 */
export function adminSlots(u) {
  return Array.from({ length: SLOTS }, (_, i) => {
    const status = slotStatus(u, i);
    return {
      index: i, photoId: status ? slotsOf(u)[i] : null, status,
      at: status === PHOTO_PENDING ? u.photoReviewAt?.[i] ?? null : null,
    };
  });
}

/** The Users table's summary of a profile's photos: 4 × { photoId, status } — ids and status only. */
export const photoSummary = (u) => adminSlots(u).map(({ photoId, status }) => ({ photoId, status }));

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
/** Only while that exact photo is still in that slot (approved or pending), and never an App review account's. */
const stillThere = (userId, index, photoId) => ({ _id: userId, [`photos.${index}`]: photoId, demo: { $ne: REVIEW } });

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

/** Reject and disqualify alike: the slot is emptied (the others stay where they are) and the person is told. */
const emptySlot = (index, notice) => ({ $set: { [`photos.${index}`]: null }, $unset: reviewUnset(index), $push: { notices: notice } });

/**
 * Reject → true (the slot is empty now and the notice is on the profile; the caller deletes the stored photo and,
 * when asked, blocks the person), or false when that photo is no longer pending in that slot.
 */
export async function rejectPhoto(users, { userId, index, photoId, notice }) {
  const r = await users.updateOne(stillPending(userId, index, photoId), emptySlot(index, notice));
  return Boolean(r.modifiedCount);
}

/**
 * Disqualify (Users → Photos) → true: the photo, approved or pending, is out of its slot exactly as a reject leaves it
 * (the slot empty, its review cleared, the notice on the profile; the caller drops the empty slots at the end, deletes
 * the stored photo and, when asked, blocks the person). false when that photo is no longer in that slot, or the profile
 * is an App review account.
 */
export async function disqualifyPhoto(users, { userId, index, photoId, notice }) {
  const r = await users.updateOne(stillThere(userId, index, photoId), emptySlot(index, notice));
  return Boolean(r.modifiedCount);
}

/**
 * Matches while slot `index` is empty: an explicit null, or past the end of the list (the app's emptySlotFilter in
 * src/lib/thirtyda-app.mjs — `{"photos.3": null}` alone misses a slot past the end).
 */
const emptySlotFilter = (index) => ({ $or: [{ [`photos.${index}`]: { $type: "null" } }, { [`photos.${index}`]: { $exists: false } }] });

/**
 * Upload (Users → Photos) → true: slot `index` of an App review account holds `photoId` now, approved (its review entry
 * cleared). Only while that slot still holds `oldId` (null: still empty), the profile is still an App review account
 * and no delete has started on it. Past the end of the list Mongo pads the slots between with null — the app's own empty
 * slot — so the list stays slot-aligned (photo 4 stays photo 4). `demoKind` (a profile made by "Create demo account",
 * users.demoPhotos) marks that slot's kind too. `fromProfile` (a review account made from an existing profile, which
 * "Stop being a review account" puts back among real people) records the upload in reviewUploads.<index> (its id), and
 * `kept` — the profile's own photo it replaces, { id, pendingAt } — in reviewWas.photos.<index>: Stop takes the team's
 * photo out again and puts that one back (src/lib/thirtyda-review.mjs stopReviewAccount). false when any of that
 * changed meanwhile: the caller removes the new file.
 */
export async function putReviewPhoto(users, { userId, index, oldId = null, photoId, demoKind = null, fromProfile = false, kept = null }) {
  const r = await users.updateOne(
    {
      _id: userId, demo: REVIEW, deleting: { $exists: false }, photos: { $type: "array" },
      ...(oldId == null ? emptySlotFilter(index) : { [`photos.${index}`]: oldId }),
    },
    {
      $set: {
        [`photos.${index}`]: photoId,
        ...(demoKind ? { [`demoPhotos.${index}`]: demoKind } : {}),
        ...(fromProfile ? { [`reviewUploads.${index}`]: photoId } : {}),
        ...(kept ? { [`reviewWas.photos.${index}`]: kept } : {}),
      },
      $unset: reviewUnset(index),
    },
  );
  return Boolean(r.modifiedCount);
}
