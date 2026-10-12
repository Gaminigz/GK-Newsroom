// 30+DA question slots: what people pick from when they ask.
// Level 1 has 4 picked questions, Level 2 has 2 (LEVEL_RULES.pick). Each picked question
// ("Question 1", "Question 2", …) has its OWN list of exactly 5 choices, set by the super admin
// (stored in Mongo `thirtyda_questions`, one doc per level). Until the admin saves a level, its
// choices are dealt from the bank in shared/questions.js, keeping the bank keys.
// Imported by the server, the app (level-ask) and the admin Questions page: plain ES module, no DOM.
import { LANGS, LANG_ENGLISH, findContactDetails, charCount } from './rules.js';
import { SYSTEM_QUESTIONS, LEVEL_RULES } from './questions.js';

export const QUESTION_CHOICES = 5; // choices per picked question
export const CHOICE_LIMITS = Object.freeze([4, 100]); // characters per choice, in every language

/**
 * Deal `list` into `slots` lists of `size`, in order: choice j of slot i is list[j * slots + i].
 * With the bank this puts the design's examples first in each slot (L1: rain, busy, outside,
 * quiet day; L2: window, weather). Extra items are left out; a short list gives short slots.
 */
export function dealSlots(list, slots, size = QUESTION_CHOICES) {
  const items = Array.isArray(list) ? list : [];
  return Array.from({ length: Math.max(0, slots | 0) }, (_, i) =>
    Array.from({ length: size }, (_, j) => items[j * slots + i]).filter((x) => x !== undefined));
}

/** The inverse of dealSlots: one flat list, choice 1 of every slot first, then choice 2, … */
export function flattenSlots(slots) {
  const lists = Array.isArray(slots) ? slots : [];
  const size = Math.max(0, ...lists.map((s) => (Array.isArray(s) ? s.length : 0)));
  const out = [];
  for (let j = 0; j < size; j++) for (const s of lists) if (Array.isArray(s) && j < s.length) out.push(s[j]);
  return out;
}

/** Built-in choices for a level: [[{ key, text:{en,km,zh,ko,ja} } × 5] × pick], fresh copies. */
export function defaultSlots(level) {
  const rules = LEVEL_RULES[level];
  if (!rules) return [];
  return dealSlots(SYSTEM_QUESTIONS[level], rules.pick)
    .map((slot) => slot.map((q) => ({ key: q.key, text: { ...q.text } })));
}

/** One choice in one language: 4–100 characters, never a contact detail. */
export function checkQuestionChoice(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  const count = charCount(s);
  if (!count) return { ok: false, error: 'empty', count, hits: [], reason: null };
  const { ok: clean, hits, reason } = findContactDetails(s);
  const result = (error) => ({ ok: !error, error, count, hits, reason });
  if (!clean) return result('contact');
  if (count < CHOICE_LIMITS[0]) return result('too_short');
  if (count > CHOICE_LIMITS[1]) return result('too_long');
  return result(null);
}

// Same question twice in one level, whatever the case, spacing or final question mark.
const sameKey = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[\s?？。.!！]+$/u, '').toLowerCase();

function choiceMessage(r, lang) {
  const name = LANG_ENGLISH[lang] || lang;
  switch (r.error) {
    case 'empty': return `${name} text is missing.`;
    case 'too_short': return `${name}: at least ${CHOICE_LIMITS[0]} characters.`;
    case 'too_long': return `${name}: at most ${CHOICE_LIMITS[1]} characters (now ${r.count}).`;
    case 'contact': return `${name}: no contact details (${r.reason || 'contact detail'}: “${r.hits?.[0]?.match ?? ''}”).`;
    default: return `${name}: check this text.`;
  }
}

/**
 * Validate a level's choices as the admin sends them: `slots` = [[{ key?, text:{ en, km, zh, ko, ja } }]].
 * Shape: `pick` slots of exactly 5. Every choice: all five languages, 4–100 characters, no contact
 * details, no duplicate text within the level (per language). Returns { ok, problems } where each
 * problem is { slot, choice (1-based, null for the whole level/slot), lang|null, error, message, dupOf? }.
 */
export function checkQuestionSlots(slots, level) {
  const problems = [];
  const rules = LEVEL_RULES[level];
  if (!rules) return { ok: false, problems: [{ slot: null, choice: null, lang: null, error: 'level', message: 'Unknown level.' }] };
  if (!Array.isArray(slots) || slots.length !== rules.pick) {
    problems.push({ slot: null, choice: null, lang: null, error: 'shape', message: `Level ${level} needs ${rules.pick} questions.` });
    return { ok: false, problems };
  }
  const seen = Object.fromEntries(LANGS.map((l) => [l, new Map()]));
  slots.forEach((slot, i) => {
    if (!Array.isArray(slot) || slot.length !== QUESTION_CHOICES) {
      problems.push({ slot: i + 1, choice: null, lang: null, error: 'shape', message: `Question ${i + 1} needs ${QUESTION_CHOICES} choices.` });
      return;
    }
    slot.forEach((choice, j) => {
      const text = choice && typeof choice.text === 'object' && choice.text ? choice.text : {};
      for (const lang of LANGS) {
        const r = checkQuestionChoice(text[lang]);
        const at = { slot: i + 1, choice: j + 1, lang };
        if (!r.ok) {
          problems.push({ ...at, error: r.error, message: choiceMessage(r, lang), ...(r.error === 'contact' ? { hits: r.hits, reason: r.reason } : {}) });
          continue;
        }
        const k = sameKey(text[lang]);
        const first = seen[lang].get(k);
        if (first) {
          problems.push({ ...at, error: 'duplicate', dupOf: first, message: `${LANG_ENGLISH[lang]}: same text as Question ${first.slot} · choice ${first.choice}.` });
        } else {
          seen[lang].set(k, { slot: i + 1, choice: j + 1 });
        }
      }
    });
  });
  return { ok: problems.length === 0, problems };
}
