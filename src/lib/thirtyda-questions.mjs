/**
 * 30+DA question choices — what people pick from when they ask (screens 5 + 8).
 *
 * Mongo `thirtyda_questions`, one doc per level, written only by the super admin web:
 *   { _id:'L1'|'L2', level, slots:[ [ {key, text:{en,km,zh,ko,ja}} ×5 ] ×(4|2) ], updatedAt, updatedBy:'superadmin' }
 * Slot i holds the 5 choices of "Question i+1". A missing (or malformed) doc means the built-in
 * choices dealt from shared/questions.js (defaultSlots), which keep the bank keys.
 *
 * Read by src/lib/thirtyda-app.mjs (GET /questions, POST /pairs/:id/sets) and written by
 * src/lib/thirtyda-admin.mjs. Both run in one process, so a save clears the in-memory cache at
 * once; a short TTL bounds how stale another instance can be.
 */

import crypto from "node:crypto";
import { LANGS } from "../thirtyda-app/shared/rules.js";
import { LEVEL_RULES } from "../thirtyda-app/shared/questions.js";
import {
  QUESTION_CHOICES, defaultSlots, checkQuestionSlots, flattenSlots,
} from "../thirtyda-app/shared/question-slots.js";

export const QUESTIONS_COLLECTION = "thirtyda_questions";
export const QUESTION_LEVELS = [1, 2];
const CACHE_MS = 30e3;
const KEY_RE = /^[a-z0-9_]{1,40}$/;

const cache = new Map(); // level → { at, value }

export const levelDocId = (level) => `L${level}`;
/** 'L1' → 1, 'L2' → 2, anything else → null. */
export const levelFromId = (id) => ({ L1: 1, L2: 2 })[id] ?? null;

const cleanText = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

function wellFormed(doc, level) {
  const pick = LEVEL_RULES[level]?.pick;
  return Array.isArray(doc?.slots) && doc.slots.length === pick
    && doc.slots.every((slot) => Array.isArray(slot) && slot.length === QUESTION_CHOICES
      && slot.every((c) => typeof c?.key === "string" && c.key && LANGS.every((l) => typeof c.text?.[l] === "string" && c.text[l])));
}

const copySlots = (slots) => slots.map((slot) => slot.map((c) => ({ key: c.key, text: Object.fromEntries(LANGS.map((l) => [l, c.text[l]])) })));

const sameSlots = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function readConfig(d, level) {
  const doc = await d.collection(QUESTIONS_COLLECTION).findOne({ _id: levelDocId(level) });
  const builtIn = defaultSlots(level);
  if (doc && wellFormed(doc, level)) {
    const slots = copySlots(doc.slots);
    return {
      level, slots, updatedAt: doc.updatedAt ?? null, updatedBy: doc.updatedBy ?? null, reset: Boolean(doc.reset),
      isDefault: false, matchesDefault: sameSlots(slots, builtIn),
    };
  }
  if (doc) console.warn(`[30da questions] stored ${levelDocId(level)} is malformed; using the built-in choices`);
  return { level, slots: builtIn, updatedAt: null, updatedBy: null, reset: false, isDefault: true, matchesDefault: true };
}

/**
 * The live choices of a level: { level, slots, updatedAt, updatedBy, reset, isDefault (no saved doc),
 * matchesDefault }. Shared by every caller: do not mutate.
 */
export async function questionConfig(d, level) {
  const hit = cache.get(level);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await readConfig(d, level);
  cache.set(level, { at: Date.now(), value });
  return value;
}

export function invalidateQuestions(level) {
  if (level) cache.delete(level);
  else cache.clear();
}

/** What the app shows: [{ n, options:[{ key, text }] }], text in `lang` (falling back to English). */
export function slotsView(slots, lang) {
  return slots.map((slot, i) => ({ n: i + 1, options: slot.map((c) => ({ key: c.key, text: c.text[lang] || c.text.en })) }));
}

/** The flat legacy list: choice 1 of every slot first, so system[0..pick-1] is one pick per slot. */
export const flatView = (view) => flattenSlots(view.map((s) => s.options));

const short = (s, n = 42) => {
  const chars = [...String(s ?? "")];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
};

/** A short, human summary of what changed between two versions of a level (for the audit log). */
export function diffSlots(before, after) {
  const parts = [];
  after.forEach((slot, i) => slot.forEach((c, j) => {
    const o = before?.[i]?.[j];
    const at = `Q${i + 1}·${j + 1}`;
    if (!o || o.key !== c.key) {
      parts.push(`${at} “${short(o?.text?.en)}” → “${short(c.text.en)}”`);
      return;
    }
    const langs = LANGS.filter((l) => o.text[l] !== c.text[l]);
    if (!langs.length) return;
    parts.push(langs.includes("en") ? `${at} “${short(o.text.en)}” → “${short(c.text.en)}”${langs.length > 1 ? ` (+${langs.filter((l) => l !== "en").join(", ")})` : ""}` : `${at} ${langs.join(", ")}`);
  }));
  const shown = parts.slice(0, 6).join("; ");
  return {
    changes: parts.length,
    summary: parts.length ? `${shown}${parts.length > 6 ? `; +${parts.length - 6} more` : ""}` : "No changes",
  };
}

/**
 * Save a level. `input` = [[{ key?, text:{...} }]] as the admin page sends it.
 * A choice keeps its key when the key is one this level already knows (current or built-in) and is
 * not used twice; every other choice gets a new stable key ('q1_' + 8 hex). Old question sets keep
 * the full text they were sent with, so editing or replacing a choice never rewrites history.
 * → { ok:false, problems } | { ok:false, conflict:true, current } | { ok:true, config, diff }
 */
export async function saveQuestions(d, level, input, { by = "superadmin", baseUpdatedAt } = {}) {
  const check = checkQuestionSlots(input, level);
  if (!check.ok) return { ok: false, problems: check.problems };
  const current = await readConfig(d, level);
  // Another tab saved in between: do not overwrite what the admin has not seen.
  if (baseUpdatedAt !== undefined && (baseUpdatedAt || null) !== (current.updatedAt || null)) {
    return { ok: false, conflict: true, current };
  }
  const known = new Set([...current.slots.flat(), ...defaultSlots(level).flat()].map((c) => c.key));
  const used = new Set();
  const slots = input.map((slot) => slot.map((c) => {
    let key = typeof c?.key === "string" && KEY_RE.test(c.key) && known.has(c.key) && !used.has(c.key) ? c.key : null;
    while (!key || used.has(key)) {
      const fresh = `q${level}_${crypto.randomBytes(4).toString("hex")}`;
      if (!known.has(fresh)) key = fresh;
    }
    used.add(key);
    return { key, text: Object.fromEntries(LANGS.map((l) => [l, cleanText(c.text[l])])) };
  }));
  const diff = diffSlots(current.slots, slots);
  const updatedAt = new Date().toISOString();
  await d.collection(QUESTIONS_COLLECTION).updateOne(
    { _id: levelDocId(level) },
    { $set: { level, slots, updatedAt, updatedBy: by }, $unset: { reset: "" } },
    { upsert: true },
  );
  invalidateQuestions(level);
  return { ok: true, config: await questionConfig(d, level), diff };
}

/** Put a level back to the built-in choices (saved, so the page shows when it happened). */
export async function resetQuestions(d, level, { by = "superadmin" } = {}) {
  const current = await readConfig(d, level);
  const slots = defaultSlots(level);
  const diff = diffSlots(current.slots, slots);
  const updatedAt = new Date().toISOString();
  await d.collection(QUESTIONS_COLLECTION).updateOne(
    { _id: levelDocId(level) },
    { $set: { level, slots, updatedAt, updatedBy: by, reset: true } },
    { upsert: true },
  );
  invalidateQuestions(level);
  return { config: await questionConfig(d, level), diff };
}
