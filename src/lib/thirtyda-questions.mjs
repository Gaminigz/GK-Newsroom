/**
 * 30+DA question choices — what people pick from when they ask (screens 5 + 8).
 *
 * Mongo `thirtyda_questions`, one doc per level, written only by the super admin web:
 *   { _id:'L1'|'L2', level, slots:[ [ {key, text:{en,km,zh,ko,ja}} ×5 ] ×(4|2) ],
 *     titles?:[ {en,km,zh,ko,ja} | null ] ×(4|2), updatedAt, updatedBy:'superadmin', reset? }
 * Slot i holds the 5 choices of "Question i+1"; titles[i] is its optional topic ("Communication").
 * A missing (or malformed) doc means the built-in choices dealt from shared/questions.js
 * (defaultSlots), which keep the bank keys, and no topics.
 *
 * A key names one question: it stays only while the choice's English is unchanged (translation
 * fixes keep it). Re-wording a choice gives it a new key, so an ask screen still showing the old
 * wording is refused (422 {slot}) and reloads instead of sending text the asker never saw.
 * Saves are conditional on the version the admin loaded (`updatedAt`), so two tabs cannot both win.
 *
 * Read by src/lib/thirtyda-app.mjs (GET /questions, POST /pairs/:id/sets) and written by
 * src/lib/thirtyda-admin.mjs. Both run in one process, so a save clears the in-memory cache at
 * once; a short TTL bounds how stale another instance can be.
 */

import crypto from "node:crypto";
import { LANGS } from "../thirtyda-app/shared/rules.js";
import { LEVEL_RULES } from "../thirtyda-app/shared/questions.js";
import {
  QUESTION_CHOICES, defaultSlots, checkQuestionSlots, checkQuestionTitles, hasTitle, flattenSlots,
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

/** [topic|null] × pick: a stored topic is used only when all five languages are there. */
function readTitles(raw, level) {
  const pick = LEVEL_RULES[level]?.pick ?? 0;
  return Array.from({ length: pick }, (_, i) => {
    const t = Array.isArray(raw) ? raw[i] : null;
    return t && LANGS.every((l) => typeof t[l] === "string" && t[l]) ? Object.fromEntries(LANGS.map((l) => [l, t[l]])) : null;
  });
}

/** What a save stores for the topics: cleaned text, a blank topic = null. */
const cleanTitles = (titles) => titles.map((t) => (hasTitle(t) ? Object.fromEntries(LANGS.map((l) => [l, cleanText(t[l])])) : null));

/** A new version stamp, always later than the one it replaces (two saves in one millisecond stay distinct). */
function nextStamp(prev) {
  const before = Date.parse(prev ?? "") || 0;
  return new Date(Math.max(Date.now(), before + 1)).toISOString();
}

const sameSlots = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function readConfig(d, level) {
  const doc = await d.collection(QUESTIONS_COLLECTION).findOne({ _id: levelDocId(level) });
  const builtIn = defaultSlots(level);
  if (doc && wellFormed(doc, level)) {
    const slots = copySlots(doc.slots);
    const titles = readTitles(doc.titles, level);
    return {
      level, slots, titles, updatedAt: doc.updatedAt ?? null, updatedBy: doc.updatedBy ?? null, reset: Boolean(doc.reset),
      isDefault: false, matchesDefault: sameSlots(slots, builtIn) && titles.every((t) => !t),
    };
  }
  if (doc) console.warn(`[30da questions] stored ${levelDocId(level)} is malformed; using the built-in choices`);
  // A malformed doc still carries its version, so the next save (conditional on it) can replace it.
  return {
    level, slots: builtIn, titles: readTitles(null, level), updatedAt: doc?.updatedAt ?? null, updatedBy: null, reset: false,
    isDefault: true, matchesDefault: true,
  };
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

/**
 * What the app shows: [{ n, title, options:[{ key, text }] }], text in `lang` (falling back to English);
 * title = Question n's topic in `lang`, or null when it has none.
 */
export function slotsView(slots, lang, titles = []) {
  return slots.map((slot, i) => ({
    n: i + 1,
    title: titles[i] ? titles[i][lang] || titles[i].en : null,
    options: slot.map((c) => ({ key: c.key, text: c.text[lang] || c.text.en })),
  }));
}

/** The flat legacy list: choice 1 of every slot first, so system[0..pick-1] is one pick per slot. */
export const flatView = (view) => flattenSlots(view.map((s) => s.options));

const short = (s, n = 42) => {
  const chars = [...String(s ?? "")];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
};

/**
 * A short, human summary of what changed between two versions of a level (for the audit log).
 * Topics are compared only when both lists are given.
 */
export function diffSlots(before, after, { titlesBefore, titlesAfter } = {}) {
  const parts = [];
  if (titlesBefore && titlesAfter) {
    titlesAfter.forEach((t, i) => {
      const o = titlesBefore[i] ?? null;
      const langs = LANGS.filter((l) => (o?.[l] ?? "") !== (t?.[l] ?? ""));
      if (!langs.length) return;
      parts.push(langs.includes("en") || !o || !t ? `Q${i + 1} topic “${short(o?.en ?? "")}” → “${short(t?.en ?? "")}”` : `Q${i + 1} topic ${langs.join(", ")}`);
    });
  }
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
 * Save a level. `input` = [[{ key?, text:{...} }]] as the admin page sends it; `titles` =
 * [topic|null] × pick (left out: the stored topics stay as they are).
 * A choice keeps its key only when this level already knows the key (current, else built-in) WITH
 * the same English text, and the key is not used twice: a translation fix keeps it, a re-worded
 * question gets a new stable key ('q1_' + 8 hex). Old question sets keep the full text they were
 * sent with, so editing or replacing a choice never rewrites history.
 * `baseUpdatedAt` = the version the admin loaded (null = never saved); the write only lands while
 * that is still the stored version, so of two tabs saving at once exactly one wins.
 * → { ok:false, problems } | { ok:false, conflict:true, current } | { ok:true, config, diff }
 */
export async function saveQuestions(d, level, input, { by = "superadmin", baseUpdatedAt, titles } = {}) {
  const check = checkQuestionSlots(input, level);
  const titleCheck = titles === undefined ? { ok: true, problems: [] } : checkQuestionTitles(titles, level);
  if (!check.ok || !titleCheck.ok) return { ok: false, problems: [...check.problems, ...titleCheck.problems] };
  const current = await readConfig(d, level);
  const base = baseUpdatedAt === undefined ? undefined : baseUpdatedAt || null;
  // Another tab saved in between: do not overwrite what the admin has not seen.
  if (base !== undefined && base !== (current.updatedAt || null)) return { ok: false, conflict: true, current };

  // key → the English it stands for; the current choices win over the built-in ones.
  const englishOf = new Map();
  for (const c of [...defaultSlots(level).flat(), ...current.slots.flat()]) englishOf.set(c.key, cleanText(c.text.en));
  const used = new Set();
  const slots = input.map((slot) => slot.map((c) => {
    const text = Object.fromEntries(LANGS.map((l) => [l, cleanText(c.text[l])]));
    const asked = typeof c?.key === "string" && KEY_RE.test(c.key) ? c.key : null;
    let key = asked && englishOf.get(asked) === text.en && !used.has(asked) ? asked : null;
    while (!key || used.has(key)) {
      const fresh = `q${level}_${crypto.randomBytes(4).toString("hex")}`;
      if (!englishOf.has(fresh)) key = fresh;
    }
    used.add(key);
    return { key, text };
  }));
  const nextTitles = titles === undefined ? current.titles : cleanTitles(titles);
  const diff = diffSlots(current.slots, slots, { titlesBefore: current.titles, titlesAfter: nextTitles });

  const filter = { _id: levelDocId(level) };
  if (base !== undefined) filter.updatedAt = base; // null also matches "no doc yet" / no stamp
  const doc = { level, slots, titles: nextTitles, updatedAt: nextStamp(current.updatedAt), updatedBy: by };
  try {
    const r = await d.collection(QUESTIONS_COLLECTION).updateOne(filter, { $set: doc, $unset: { reset: "" } }, { upsert: true });
    if (!r.matchedCount && !r.upsertedCount) throw Object.assign(new Error("changed"), { code: 11000 });
  } catch (err) {
    // The upsert found no doc at that version and the insert hit the existing _id: someone else saved first.
    if (err?.code !== 11000) throw err;
    invalidateQuestions(level);
    return { ok: false, conflict: true, current: await readConfig(d, level) };
  }
  invalidateQuestions(level);
  return { ok: true, config: await questionConfig(d, level), diff };
}

/** Put a level back to the built-in choices and no topics (saved, so the page shows when it happened). */
export async function resetQuestions(d, level, { by = "superadmin" } = {}) {
  const current = await readConfig(d, level);
  const slots = defaultSlots(level);
  const titles = readTitles(null, level);
  const diff = diffSlots(current.slots, slots, { titlesBefore: current.titles, titlesAfter: titles });
  await d.collection(QUESTIONS_COLLECTION).updateOne(
    { _id: levelDocId(level) },
    { $set: { level, slots, titles, updatedAt: nextStamp(current.updatedAt), updatedBy: by, reset: true } },
    { upsert: true },
  );
  invalidateQuestions(level);
  return { config: await questionConfig(d, level), diff };
}
