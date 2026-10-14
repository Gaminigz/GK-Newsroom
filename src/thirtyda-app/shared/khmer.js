// Khmer line breaks (owner 2026-10-14: "khmer need fixing"). Khmer puts no spaces between words, only between
// phrases, and a Khmer reader expects a line to break at those spaces. Browsers break a Khmer run with a word
// dictionary instead, and each engine has its own: Chrome (and Android's web view) splits ស្មោះ|ត្រង់, ស្អប់|ខ្ពើម,
// ផ្ទៀង|ផ្ទាត់ and ការ|ណាត់ជួប; Node's ICU (the server) and iPhone keep those whole but still split ការ|យាយី.
// Measured at 390 px on the rules screen: "…និងស្មោះ ‖ ត្រង់។", "…ការ ‖ យាយី…", "…ឬការ ‖ ណាត់ជួប…".
// `word-break: keep-all` does not stop it.
//
// khmerKeep(text) puts U+2060 WORD JOINER between the Khmer clusters of each phrase (the text between two spaces or
// zero-width spaces — some strings carry those on purpose as "may break here"), so the spaces are where lines break,
// in every browser, the same on the server and in the app:
//   - a phrase of up to KEEP_WHOLE clusters (it fits a line in the app's narrow boxes on a 320 px phone) never breaks;
//   - a longer phrase may not fit a line at all: it stays joined inside its words and gets a zero-width space (a
//     sure place to break, in every engine) between two words — ICU's word dictionary (Intl.Segmenter), never inside
//     a word of KHMER_WORDS (shared/khmer-words.js: our own phrases cut by Node's / iPhone's dictionary, so Chrome
//     cuts them the same way), never right after ការ / សេចក្ដី / មិន … (they belong to the word after them), never
//     before a closing word (ទេ, ឡើយ, នេះ …), never leaving fewer than MIN_AFTER clusters for the next line.
//     Without Intl.Segmenter it stays joined all through (the CSS overflow-wrap rescues it).
// Never inside a cluster: never after U+17D2 COENG (its subscript consonant stays attached) and never in front of a
// combining mark (vowel signs, the other diacritics), so the letters shape exactly as before. Idempotent; a joiner
// already there stays. Text without Khmer comes back as it was. Display only: never for what people type, never for
// anything stored or compared.
// Imported by the server AND served to the browser unchanged: plain ES module, no Node imports, no regex lookbehind.
import { KHMER_WORDS } from './khmer-words.js';

export const WORD_JOINER = '\u2060';
/** A long phrase's place to break between two words (also what some strings carry by hand). */
export const ZERO_WIDTH_SPACE = '\u200B';

/** A phrase of at most this many Khmer clusters never breaks (≈ 200–240 px: the rules list is 230 px wide at 320 px). */
export const KEEP_WHOLE = 8;
/** A break inside a long phrase leaves at least this many clusters for the next line (no "ទេ?" alone). */
const MIN_AFTER = 3;
// They lean on the next word, so no break after them: a prefix, a negation, an auxiliary, the question word, and the
// little words a phrase starts with (Khmer writes its space BEFORE them: "សេវាកំដរ ឬការណាត់ជួប", "ការជជែក ដើម្បីសុវត្ថិភាព").
const NO_BREAK_AFTER = new Set([
  'ការ', 'សេចក្ដី', 'សេចក្តី', 'ភាព', 'អំពើ', 'អ្នក', 'មិន', 'ពុំ', 'កុំ', 'ត្រូវ', 'កំពុង', 'នឹង', 'តើ',
  'ឬ', 'និង', 'ហើយ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'ព្រោះ', 'បើ', 'ប្រសិនបើ', 'ដើម្បី', 'សម្រាប់', 'ដោយ', 'ជាមួយ', 'ក្នុង', 'នៅ',
  'ពី', 'តាម', 'ទៅ', 'ដល់', 'ចំពោះ', 'អំពី', 'ដែល', 'របស់', 'ជា', 'គឺ',
]);
// They close what comes before them (particles, demonstratives, "each other"): no break before them.
const NO_BREAK_BEFORE = new Set(['ទេ', 'ឡើយ', 'ទៀត', 'ផង', 'ណាស់', 'នេះ', 'នោះ', 'បានទេ', 'សិន', 'វិញ', 'ដែរ', 'គ្នា']);

const KHMER = /[\u1780-\u17FF\u19E0-\u19FF]/;
const PUNCT = /[\u17D4-\u17DB]/; // ។ ៕ ៖ ៗ ៘ ៙ ៚ ៛: narrow, not counted as a cluster
const COENG = '\u17D2';
const MARK = /\p{M}/u;
// Where a line may break: a space (not a no-break one) or a zero-width space. They split the text into phrases.
const BREAK = /([\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200B\u2028\u2029\u205F\u3000]+)/;
// Never a joiner next to these: a space of any kind, ZWSP / ZWNJ / ZWJ (they steer breaking and shaping), a joiner,
// a soft hyphen, a BOM.
const LEAVE = /[\s\u200B-\u200D\u2060\uFEFF\u00AD]/;

const KNOWN = new Set(KHMER_WORDS);
const LONGEST = KHMER_WORDS.reduce((n, w) => Math.max(n, [...w].length), 0);

let segmenter;
function words() {
  if (segmenter === undefined) {
    try { segmenter = new Intl.Segmenter('km', { granularity: 'word' }); } catch { segmenter = null; }
  }
  return segmenter;
}

/** True when the text has a Khmer letter, sign or digit in it. */
export const hasKhmer = (text) => typeof text === 'string' && KHMER.test(text);

/** A joiner may go between a and b (two neighbouring characters)? Only next to Khmer, never inside a cluster. */
function joins(a, b) {
  if (LEAVE.test(a) || LEAVE.test(b)) return false;
  if (a === COENG || MARK.test(b)) return false; // the subscript, a vowel sign, a diacritic: same cluster
  return KHMER.test(a) || KHMER.test(b); // Latin, digits and CJK keep their own breaks
}

/** Does a Khmer cluster start at cps[i]? (a Khmer letter / sign / digit that is not a mark and not after coeng) */
const startsCluster = (cps, i) => KHMER.test(cps[i]) && !MARK.test(cps[i]) && cps[i - 1] !== COENG;

/** How many Khmer clusters the text has (its punctuation ។ ៖ ៗ … not counted): how wide it is, roughly. */
export function khmerClusters(text) {
  const cps = [...String(text ?? '')];
  return cps.filter((ch, i) => startsCluster(cps, i) && !PUNCT.test(ch)).length;
}

/** Is position i strictly inside one of KHMER_WORDS written here (from a cluster's start to a cluster's end)? */
function insideKnownWord(cps, i) {
  const edge = (j) => j >= cps.length || startsCluster(cps, j) || !KHMER.test(cps[j]);
  for (let a = Math.max(0, i - LONGEST + 1); a < i; a++) {
    if (!startsCluster(cps, a)) continue;
    let word = cps.slice(a, i).join('');
    for (let b = i; b < cps.length && b - a < LONGEST; b++) {
      word += cps[b];
      if (KNOWN.has(word) && edge(b + 1)) return true;
    }
  }
  return false;
}

/** Positions (code points) inside a long phrase where a line may break: between two Khmer words. */
function openings(cps) {
  const open = new Set();
  const after = []; // after[i]: Khmer clusters (punctuation aside) from position i to the end
  let clusters = 0;
  for (let i = cps.length - 1; i >= 0; i--) {
    if (startsCluster(cps, i) && !PUNCT.test(cps[i])) clusters++;
    after[i] = clusters;
  }
  const seg = clusters > KEEP_WHOLE ? words() : null;
  if (!seg) return open;
  const at = new Map(); // code-unit offset → code-point position
  let unit = 0;
  cps.forEach((ch, i) => { at.set(unit, i); unit += ch.length; });
  const parts = [...seg.segment(cps.join(''))];
  for (let k = 1; k < parts.length; k++) {
    const a = parts[k - 1];
    const b = parts[k];
    const i = at.get(b.index);
    if (!a.isWordLike || !b.isWordLike || i === undefined) continue;
    if (!KHMER.test(cps[i - 1]) || !startsCluster(cps, i)) continue; // between two Khmer words only
    if (NO_BREAK_AFTER.has(a.segment) || NO_BREAK_BEFORE.has(b.segment)) continue;
    if (after[i] < MIN_AFTER || insideKnownWord(cps, i)) continue;
    open.add(i);
  }
  return open;
}

/** One phrase (no space in it): joiners everywhere a browser could break; a long phrase's openings get a ZWSP. */
function keepPhrase(phrase) {
  if (!KHMER.test(phrase)) return phrase;
  const cps = [];
  const had = new Set(); // positions that already have a joiner (kept: the author's, or an earlier khmerKeep)
  for (const ch of phrase) {
    if (ch === WORD_JOINER) had.add(cps.length);
    else cps.push(ch);
  }
  const open = openings(cps);
  let out = had.has(0) ? WORD_JOINER : '';
  for (let i = 0; i < cps.length; i++) {
    if (i > 0 && had.has(i)) out += WORD_JOINER; // the author's (or an earlier khmerKeep's) joiner holds
    else if (open.has(i)) out += ZERO_WIDTH_SPACE;
    else if (i > 0 && joins(cps[i - 1], cps[i])) out += WORD_JOINER;
    out += cps[i];
  }
  return cps.length && had.has(cps.length) ? out + WORD_JOINER : out;
}

const memo = new Map(); // the same lines come back on every repaint

/**
 * The text with each Khmer phrase kept whole on one line (a long one breaks only between whole words, at the
 * zero-width spaces put there): word joiners between the clusters, and between Khmer and whatever touches it
 * (30+DA។, បាទ/ចាស). Anything that is not a string, or has no Khmer, comes back unchanged.
 */
export function khmerKeep(text) {
  if (!hasKhmer(text)) return text;
  let kept = memo.get(text);
  if (kept === undefined) {
    kept = text.split(BREAK).map((part, i) => (i % 2 ? part : keepPhrase(part))).join('');
    if (memo.size >= 2000) memo.clear();
    memo.set(text, kept);
  }
  return kept;
}

const INVISIBLE = /[\u200B\u2060]/g;
/** The text without word joiners and zero-width spaces (what khmerKeep adds): a page title, a notification, the clipboard. */
export const khmerPlain = (text) => (typeof text === 'string' ? text.replace(INVISIBLE, '') : text);
