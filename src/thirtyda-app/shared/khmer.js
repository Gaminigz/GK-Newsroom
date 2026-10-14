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
//   - a longer phrase may not fit a line at all, so it gets a few zero-width spaces (a sure place to break, in every
//     engine), each between two words. A word dictionary (Intl.Segmenter) says where the words are, but it also cuts
//     real compounds (Node's នី|មួយ|ៗ, ស្នងការ|ដ្ឋាន, ទទួល|បាន; Chrome's much finer, or oddly glued: "នោះផុត"), so:
//       · the words are the segmenter's, read again with our own list (reading(): KHMER_WORDS — our phrases as Node's /
//         iPhone's dictionary cuts them, written by src/scripts/thirtyda-khmer-words.mjs — and KHMER_COMPOUNDS, kept by
//         hand in shared/khmer-compounds.js): never a break inside one of those, in any engine, for any text;
//       · always in front of a word that starts a part of the phrase (ដែល, និង, ដើម្បី, សម្រាប់, ក្នុង, របស់ …: where
//         Khmer writers put their own spaces);
//       · elsewhere only while a stretch is still longer than KEEP_WHOLE clusters: one break near its middle, between
//         two plain words rather than next to a lone syllable (a dictionary's leftover of a word it does not know) or
//         between two halves that rhyme (ស្ងប់ស្ងាត់, ប្រហាក់ប្រហែល); where the words lean on each other (after អ្នក,
//         នៅ, ជិត …, before ទេ, នេះ, ទាំង …) only in a stretch of more than LAST_RESORT clusters;
//     never right after ការ / សេចក្ដី / មិន / កុំ … (NEVER_AFTER: they belong to the word after them), never in front
//     of ៗ or other Khmer punctuation, never leaving fewer than MIN_AFTER clusters for the next line. Without
//     Intl.Segmenter it stays joined all through (the CSS overflow-wrap rescues it).
// Never inside a cluster: never after U+17D2 COENG (its subscript consonant stays attached) and never in front of a
// combining mark (vowel signs, the other diacritics), so the letters shape exactly as before. Idempotent; a joiner
// already there stays. Text without Khmer comes back as it was. Display only: never for what people type, never for
// anything stored or compared.
// Imported by the server AND served to the browser unchanged: plain ES module, no Node imports, no regex lookbehind.
import { KHMER_WORDS } from './khmer-words.js';
import { KHMER_COMPOUNDS } from './khmer-compounds.js';

export const WORD_JOINER = '\u2060';
/** A long phrase's place to break between two words (also what some strings carry by hand). */
export const ZERO_WIDTH_SPACE = '\u200B';

/** A phrase of at most this many Khmer clusters never breaks (≈ 200–240 px: the rules list is 230 px wide at 320 px). */
export const KEEP_WHOLE = 8;
/** A break inside a long phrase leaves at least this many clusters for the next line (no "ទេ?" alone). */
const MIN_AFTER = 3;
/** A stretch this long with no better place may break where its words lean on each other (after អ្នក, before នេះ …). */
const LAST_RESORT = 12;
// Never a break after these, however long the stretch: ការ / សេចក្ដី … make a noun of the word after them (the owner's
// ការ|យាយី, ការ|ណាត់ជួប), មិន / កុំ … negate it, តើ asks it, ដ៏ ties it to the word before.
const NEVER_AFTER = new Set(['ការ', 'សេចក្ដី', 'សេចក្តី', 'ភាព', 'អំពើ', 'មិន', 'ពុំ', 'កុំ', 'តើ', 'ដ៏']);
// They lean on the next word, so no break after them: a prefix, a negation, an auxiliary, the question word, "every",
// "near" / "around" (នៅជិត|អ្នក would part them from their word), and the little words a phrase starts with (Khmer
// writes its space BEFORE them: "សេវាកំដរ ឬការណាត់ជួប", "ការជជែក ដើម្បីសុវត្ថិភាព").
const NO_BREAK_AFTER = new Set([
  'ការ', 'សេចក្ដី', 'សេចក្តី', 'ភាព', 'អំពើ', 'អ្នក', 'មិន', 'ពុំ', 'កុំ', 'ត្រូវ', 'កំពុង', 'នឹង', 'តើ',
  'ឬ', 'និង', 'ហើយ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'ព្រោះ', 'បើ', 'ប្រសិនបើ', 'ដើម្បី', 'សម្រាប់', 'ដោយ', 'ជាមួយ', 'ក្នុង', 'នៅ',
  'ពី', 'តាម', 'ទៅ', 'ដល់', 'ចំពោះ', 'អំពី', 'ដែល', 'របស់', 'ជា', 'គឺ', 'នៃ', 'លើ', 'នូវ', 'ដ៏', 'រាល់', 'គ្រប់',
  'ជិត', 'ក្បែរ', 'ជុំវិញ',
]);
// They close what comes before them (particles, demonstratives, "each other", "-er / -est"): no break before them.
const NO_BREAK_BEFORE = new Set([
  'ទេ', 'ឡើយ', 'ទៀត', 'ផង', 'ណាស់', 'នេះ', 'នោះ', 'បានទេ', 'សិន', 'វិញ', 'ដែរ', 'គ្នា', 'ប៉ុណ្ណោះ', 'នៅឡើយ', 'ដ៏',
  'ជាង', 'ជាងគេ',
]);
// Chrome's dictionary sometimes glues a little word onto the next or the one before, or cuts one in two ("នោះផុត",
// "ជិតៗគឺ", "ចាកចេញពី", "នៅជុំ|វិញ"), so these are looked for in the letters, not the segments: no break in front of
// letters that start with one of these ("this / that", "all / both", "each", ដ៏ …) …
const CLOSES_START = ['នេះ', 'នោះ', 'ទាំង', 'ដ៏', 'នីមួយៗ'];
// … nor after letters that end with one of these ("is", "or", "and", "of", "from", "to", "near", "around":
// នៅជុំវិញ|អ្នក would part them from their word).
const LEANS_END = ['គឺ', 'ឬ', 'និង', 'នៃ', 'ពី', 'ទៅ', 'ជិត', 'ក្បែរ', 'ជុំវិញ'];
// A part of the phrase starts with these (a relative clause, "and", "or", "to", "for", "in", "of", "by", "as", "is",
// "must", "is …ing", "still"): a line may always break in front of them. Only words that never end a compound or a
// verb's own complement (មិនឃើញ in មើលមិនឃើញ, មិនបាន in អានមិនបាន), so not មិន… and not ការ.
const STARTS = new Set([
  'ដែល', 'និង', 'ឬ', 'ហើយ', 'ប៉ុន្តែ', 'ប៉ុន្ដែ', 'ព្រោះ', 'ព្រោះតែ', 'បើ', 'ប្រសិនបើ', 'ដើម្បី', 'សម្រាប់', 'ក្នុង',
  'នៅក្នុង', 'នៅ', 'នៅពេល', 'ជាមួយ', 'ចំពោះ', 'អំពី', 'តាម', 'ពី', 'ទៅ', 'លើ', 'នៃ', 'របស់', 'ដោយ', 'ជា', 'គឺ',
  'គឺជា', 'ដូចជា', 'រហូតដល់', 'លុះត្រាតែ', 'ក្នុងចំណោម', 'ត្រូវ', 'ត្រូវបាន', 'កំពុង', 'នៅតែ',
]);
// One-cluster words that are words in their own right (a lone syllable that is none of these is ICU's leftover of a
// word its dictionary does not know: នី of នីមួយៗ, មេ of ម៉ាស៊ីនមេ).
const ONE_CLUSTER_WORDS = new Set([
  'ជា', 'នៅ', 'ពី', 'ទៅ', 'ឬ', 'គឺ', 'តើ', 'នៃ', 'លើ', 'ក៏', 'ទេ', 'គេ', 'វា', 'មក', 'ថា', 'តែ', 'ឲ្យ', 'ឱ្យ',
]);

const KHMER = /[\u1780-\u17FF\u19E0-\u19FF]/;
const PUNCT = /[\u17D4-\u17DB]/; // ។ ៕ ៖ ៗ ៘ ៙ ៚ ៛: narrow, not counted as a cluster
const COENG = '\u17D2';
const MARK = /\p{M}/u;
// Where a line may break: a space (not a no-break one) or a zero-width space. They split the text into phrases.
const BREAK = /([\t\n\v\f\r \u1680\u2000-\u2006\u2008-\u200B\u2028\u2029\u205F\u3000]+)/;
// Never a joiner next to these: a space of any kind, ZWSP / ZWNJ / ZWJ (they steer breaking and shaping), a joiner,
// a soft hyphen, a BOM.
const LEAVE = /[\s\u200B-\u200D\u2060\uFEFF\u00AD]/;

// The words our own reading of a phrase knows (reading()): never a break inside one of KNOWN; the little words are
// words in their own right too.
const KNOWN = new Set([...KHMER_WORDS, ...KHMER_COMPOUNDS]);
const READ = new Set([...KNOWN, ...ONE_CLUSTER_WORDS, ...STARTS, ...NO_BREAK_AFTER, ...NO_BREAK_BEFORE, ...NEVER_AFTER]);
const LONGEST = [...READ].reduce((n, w) => Math.max(n, [...w].length), 0);

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

/**
 * Our own reading of the phrase: cut into pieces, each a word we know (KHMER_WORDS, KHMER_COMPOUNDS, the little words
 * above) or else one cluster (or one other character) — as few unknown pieces as can be, then as few pieces.
 * [start, end, known?] for each piece. Read whole like this, a known word that only happens to straddle two words
 * (សារ in ភាសា|របស់, ដដែល in កូដ|ដែល) is not a piece.
 */
function reading(cps) {
  const n = cps.length;
  const edge = (j) => j >= n || startsCluster(cps, j) || !KHMER.test(cps[j]); // where a piece may start or end
  const cost = new Array(n + 1).fill(Infinity); // unknown pieces × 1000 + pieces, up to position b
  const back = new Array(n + 1); // back[b] = [a, known?]: the piece that ends at b in the best reading
  cost[0] = 0;
  const reach = (a, b, known) => {
    const c = cost[a] + (known ? 1 : 1001);
    if (c < cost[b]) {
      cost[b] = c;
      back[b] = [a, known];
    }
  };
  for (let a = 0; a < n; a++) {
    if (cost[a] === Infinity) continue;
    let b = a + 1;
    while (b < n && !edge(b)) b++;
    reach(a, b, false);
    let word = '';
    for (let c = a; c < n && c - a < LONGEST; c++) {
      word += cps[c];
      if (READ.has(word) && edge(c + 1)) reach(a, c + 1, true);
    }
  }
  const pieces = [];
  for (let b = n; b > 0;) {
    const [a, known] = back[b];
    pieces.unshift([a, b, known]);
    b = a;
  }
  return pieces;
}

/**
 * The phrase's words: the segmenter's cuts, none inside a known word of our reading, and our reading's cuts between
 * two known words (Chrome's dictionary glues some: "ចិត្តផឹកកា", "នោះផុត"). [start, end, text] for each.
 */
function wordsOf(cps, parts, at) {
  const pieces = reading(cps);
  const inside = new Set();
  const cut = new Set([0, cps.length]);
  pieces.forEach(([a, b, known], p) => {
    if (known) for (let i = a + 1; i < b; i++) inside.add(i);
    if (known && p > 0 && pieces[p - 1][2]) cut.add(a);
  });
  for (const part of parts) {
    const i = at.get(part.index);
    if (i !== undefined && !inside.has(i)) cut.add(i);
  }
  const bounds = [...cut].sort((x, y) => x - y);
  return bounds.slice(1).map((end, k) => [bounds[k], end, cps.slice(bounds[k], end).join('')]);
}
const WORDY = /[\p{L}\p{N}]/u;

/** The first cluster of a word: two words starting alike (ប្រ|ប្រ, ស្ង|ស្ង, ទំ|ទំ) are most likely one rhyming pair. */
function firstCluster(word) {
  const cps = [...word];
  let n = 1;
  while (n < cps.length && (cps[n - 1] === COENG || MARK.test(cps[n]))) n++;
  return cps.slice(0, n).join('');
}
const rhymes = (a, b) => {
  const x = firstCluster(a);
  const y = firstCluster(b);
  return x.length > 1 && (x === y || (x.includes(COENG) && x.slice(0, 3) === y.slice(0, 3)));
};
const lone = (word) => khmerClusters(word) === 1 && !word.includes(COENG) && !ONE_CLUSTER_WORDS.has(word);

/**
 * Positions (code points) inside a long phrase where a line may break: between two Khmer words, in front of each word
 * that starts a part of the phrase, and where a stretch is still too long, one more near its middle, again and again.
 */
function openings(cps) {
  const open = new Set();
  const after = []; // after[i]: Khmer clusters (punctuation aside) from position i to the end
  let clusters = 0;
  after[cps.length] = 0;
  for (let i = cps.length - 1; i >= 0; i--) {
    if (startsCluster(cps, i) && !PUNCT.test(cps[i])) clusters++;
    after[i] = clusters;
  }
  const seg = clusters > KEEP_WHOLE ? words() : null;
  if (!seg) return open;
  const at = new Map(); // code-unit offset → code-point position
  let unit = 0;
  cps.forEach((ch, i) => { at.set(unit, i); unit += ch.length; });
  const list = wordsOf(cps, [...seg.segment(cps.join(''))], at);
  const strong = [];
  // The other places, each with a cost: 0 between two plain words, 1 next to a lone syllable, 2 between rhyming
  // halves; 3 / 4 where the words lean on each other (after អ្នក / របស់ / នៅ …, before ទេ / នេះ …; 3 when a part of
  // the phrase starts there), only in a stretch of more than LAST_RESORT clusters with no better place, so it does not
  // run past its box and get cut just anywhere (overflow-wrap).
  const weak = [];
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1][2];
    const b = list[k][2];
    const i = list[k][0];
    if (!WORDY.test(a) || !WORDY.test(b)) continue;
    if (!KHMER.test(cps[i - 1]) || !startsCluster(cps, i) || PUNCT.test(cps[i])) continue; // two Khmer words, not ៗ
    if (after[i] < MIN_AFTER || NEVER_AFTER.has(a)) continue;
    const left = cps.slice(Math.max(0, i - 8), i).join(''); // the letters either side, whatever the segments
    const right = cps.slice(i, i + 8).join('');
    const leans = NO_BREAK_AFTER.has(a) || NO_BREAK_BEFORE.has(b)
      || LEANS_END.some((w) => left.endsWith(w)) || CLOSES_START.some((w) => right.startsWith(w));
    if (leans) weak.push({ i, cost: STARTS.has(b) ? 3 : 4 });
    else if (STARTS.has(b)) strong.push(i);
    else weak.push({ i, cost: rhymes(a, b) ? 2 : lone(a) || lone(b) ? 1 : 0 });
  }
  for (const i of strong) open.add(i);
  // A stretch (between two openings) still longer than KEEP_WHOLE clusters: its best other place, then each half.
  const split = (from, to) => {
    const size = after[from] - after[to];
    if (size <= KEEP_WHOLE) return;
    let best = null;
    for (const w of weak) {
      if (w.i <= from || w.i >= to || (w.cost > 2 && size <= LAST_RESORT)) continue;
      const off = Math.abs((after[from] - after[w.i]) - (after[w.i] - after[to]));
      if (!best || w.cost < best.cost || (w.cost === best.cost && off < best.off)) best = { ...w, off };
    }
    if (!best) return;
    open.add(best.i);
    split(from, best.i);
    split(best.i, to);
  };
  const edges = [0, ...strong, cps.length];
  for (let e = 1; e < edges.length; e++) split(edges[e - 1], edges[e]);
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
