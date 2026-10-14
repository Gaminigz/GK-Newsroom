/**
 * 30+DA, people blocking each other (store policy, owner 2026-10-14; the rules in src/thirtyda-app/shared/safety.js).
 *
 *   thirtyda_blocks { _id: '<by>|<who>', by, who, at }   one row per "by blocked who" (at = ISO time)
 *
 * A block works BOTH ways: neither sees the other on Nearby (and the guest cards), on a profile, or in a photo, neither
 * can start a conversation with the other, and a conversation between them is frozen and left out of both lists
 * (src/lib/thirtyda-app.mjs). Only `by` can lift it, and only `by` ever learns it exists: GET /me/blocks lists the people
 * I blocked, never the people who blocked me. The blocked person sees what they see when someone is gone.
 *
 * Every new block is also a flag for the admin (kind 'blocked', from = who was blocked, to = who blocked them), so the
 * team sees it next to the reports; the user lifting the block withdraws it while it is still open. Flags carry a `key`
 * while they are open: one open flag per block, and one per reporter + person + target (a unique index on open flags).
 * When the admin acts, resolvedAt + resolvedAction are written and the key goes (resolveUpdate).
 *
 * Pure apart from the collections handed in, so the unit tests run without a database.
 */

import crypto from "node:crypto";

export const BLOCKS = "thirtyda_blocks";

export const blockId = (by, who) => `${by}|${who}`;

/** The ids of everyone `meId` blocked or was blocked by. */
export async function blockedIds(blocks, meId) {
  if (!meId) return new Set();
  const rows = await blocks.find({ $or: [{ by: meId }, { who: meId }] }, { projection: { by: 1, who: 1 } }).toArray();
  return new Set(rows.map((r) => (r.by === meId ? r.who : r.by)));
}

/** true when either of the two blocked the other. */
export async function blockedBetween(blocks, a, b) {
  if (!a || !b || a === b) return false;
  return Boolean(await blocks.findOne({ _id: { $in: [blockId(a, b), blockId(b, a)] } }, { projection: { _id: 1 } }));
}

/** `by` blocks `who` (idempotent) → { created, at } (at = when the block was made, the first time). */
export async function addBlock(blocks, by, who, at = new Date().toISOString()) {
  const r = await blocks.updateOne({ _id: blockId(by, who) }, { $setOnInsert: { by, who, at } }, { upsert: true });
  if (r.upsertedCount) return { created: true, at };
  const row = await blocks.findOne({ _id: blockId(by, who) });
  return { created: false, at: row?.at ?? at };
}

/** `by` lifts their block of `who` (never the other way round) → true when there was one. */
export async function removeBlock(blocks, by, who) {
  const r = await blocks.deleteMany({ _id: blockId(by, who) });
  return Boolean(r.deletedCount);
}

/** The people `meId` blocked, newest first: [{ id, name, at }] (a person gone since then is left out). */
export async function myBlocks(blocks, users, meId) {
  const rows = (await blocks.find({ by: meId }).toArray()).sort((x, y) => String(y.at).localeCompare(String(x.at)));
  if (!rows.length) return [];
  const people = await users.find({ _id: { $in: rows.map((r) => r.who) } }, { projection: { name: 1 } }).toArray();
  const byId = new Map(people.map((u) => [u._id, u]));
  return rows.filter((r) => byId.has(r.who)).map((r) => ({ id: r.who, name: byId.get(r.who).name ?? "", at: r.at }));
}

// ---------------------------------------------------------------- flags for the admin

/** The key that keeps one open flag per block. */
export const blockFlagKey = (by, who) => `blocked|${by}|${who}`;
/** The key that keeps one open report per reporter + person + target. */
export const reportFlagKey = (by, who, target) => `report|${by}|${who}|${target}`;

/** The admin's flag for a new block: about `who` (from), raised by `by` (to). No names: the queue shows them by id. */
export function blockFlag({ id, by, who, at, chatId = null }) {
  return {
    _id: id, id, chatId, from: who, to: by, at, reason: "Blocked in the app", kind: "blocked", status: "open", warned: false,
    key: blockFlagKey(by, who),
  };
}

/**
 * The admin's flag for a report on a person: about `who` (from), raised by `by` (to), "Reported by <name> · <label>" like
 * a reported chat line (src/lib/thirtyda-delete.mjs cuts the name out if either of them deletes their account).
 * `extra`: photoId + slot for a photo, level for a line.
 */
export function reportFlag({ id, by, byName, who, at, label, target, chatId = null, extra = {} }) {
  return {
    _id: id, id, chatId, from: who, to: by, at, reason: `Reported by ${byName} · ${label}`, kind: "reported", status: "open",
    warned: false, target, ...extra, key: reportFlagKey(by, who, target),
  };
}

/** The key that keeps one open guest report per address (hashed) + person. */
export const guestReportKey = (by, who) => `guest|${by}|${who}`;
/** A guest's address as a report keeps it: a one-way hash (one open report per address + person; never the address). */
export const guestReporter = (ip) => crypto.createHash("sha256").update(`30da-guest-report|${String(ip ?? "")}`).digest("hex").slice(0, 24);

/**
 * The admin's flag for a guest's report (store policy, owner 2026-10-14: a guest — no profile yet — sees members' cards,
 * so a guest can report one too, POST /guest/report): about `who` (from), "Reported by a guest · <label>", the profile
 * as the target. A guest has no profile, so no `to` and no name: `guest: true` says who reported it. `by` = guestReporter.
 */
export function guestReportFlag({ id, by, who, at, label }) {
  return {
    _id: id, id, chatId: null, from: who, to: null, guest: true, at, reason: `Reported by a guest · ${label}`, kind: "reported",
    status: "open", warned: false, target: "profile", key: guestReportKey(by, who),
  };
}

/**
 * The update that closes an open flag: status, resolvedAt, resolvedAction (what was done: 'blocked' | 'dismissed' |
 * 'unblocked' when the person lifted their own block), and the open-flag key goes.
 */
export function resolveUpdate(action, at, status = action) {
  return { $set: { status, resolvedAt: at, resolvedAction: action }, $unset: { key: "" } };
}

/** The update that opens a closed flag again (the admin's Undo): no longer resolved. */
export const reopenUpdate = () => ({ $set: { status: "open" }, $unset: { resolvedAt: "", resolvedAction: "" } });
