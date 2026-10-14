// 30+DA shared rules: languages, the contact-detail detector, the bad-word check and the text limits.
// Imported by the server AND served to the browser unchanged, so: plain ES module, no Node
// imports, no DOM, and no regex lookbehind (older iOS Safari cannot even parse it).

import { badWordSpans, BAD_WORD_REASONS } from './bad-words.js';

export { BAD_WORD_REASONS };

export const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
export const LANG_CODES = { en: 'EN', km: 'KM', zh: 'ZH', ko: 'KO', ja: 'JA' };
export const LANG_NATIVE = { en: 'English', km: 'ខ្មែរ', zh: '中文', ko: '한국어', ja: '日本語' };
export const LANG_FLAG = { en: '\u{1F1EC}\u{1F1E7}', km: '\u{1F1F0}\u{1F1ED}', zh: '\u{1F1E8}\u{1F1F3}', ko: '\u{1F1F0}\u{1F1F7}', ja: '\u{1F1EF}\u{1F1F5}' }; // GB KH CN KR JP
export const LANG_ENGLISH = { en: 'English', km: 'Khmer', zh: 'Chinese', ko: 'Korean', ja: 'Japanese' };
export const SPEECH_LOCALE = { en: 'en-US', km: 'km-KH', zh: 'zh-CN', ko: 'ko-KR', ja: 'ja-JP' };

export const CHAT_MIN = 20, CHAT_MAX = 30;

// ---- Photo slots: unlocked by level, seen per person.
// Level 1 → 1 photo (the main face photo), Level 2 → 1 more (2), Level 3 → 2 more (4). A person's level
// for uploading is the highest level they have OPENED with anyone. Who sees photo i is decided per pair:
// slot 1 is for every signed-in person (Nearby only ever shows it); slot i needs the level the viewer and
// the owner have opened together to reach PHOTO_SLOT_LEVELS[i].
export const PHOTO_MAX = 4;
export const PHOTO_SLOT_LEVELS = Object.freeze([1, 2, 3, 3]);

/** How many photo slots a person at `level` may fill: 1 → 1, 2 → 2, 3 → 4. */
export function photoSlotsFor(level) {
  const n = Number(level);
  return n >= 3 ? 4 : n >= 2 ? 2 : 1;
}

/** The level that unlocks the photo at 0-based `index` (1, 2, 3, 3); past the end → 3; not an index → null. */
export function photoSlotLevel(index) {
  const i = typeof index === 'number' || (typeof index === 'string' && index.trim()) ? Number(index) : NaN;
  if (!Number.isInteger(i) || i < 0) return null;
  return PHOTO_SLOT_LEVELS[Math.min(i, PHOTO_MAX - 1)];
}

/**
 * The level a pair has opened, for photos: l2_open / l3_wait / l3_decide → 2, l3_open → 3, anything else
 * → 1. An ended conversation ("Forget it") shows only the main photo again, like to everyone else.
 */
export function stageOpenLevel(stage) {
  if (stage === 'l3_open') return 3;
  if (stage === 'l2_open' || stage === 'l3_wait' || stage === 'l3_decide') return 2;
  return 1;
}

/** May a viewer who has opened `openLevel` with the owner see the owner's photo at `index`? (Owner: always.) */
export function photoVisible(index, openLevel) {
  const need = photoSlotLevel(index);
  return need !== null && (need === 1 || (Number(openLevel) || 1) >= need);
}

const QUESTION_LIMITS = { 1: [4, 80], 2: [4, 100] };
const ANSWER_LIMITS = [2, 120];

// Used verbatim as the admin flag reason; the first hit (by position) decides.
export const CONTACT_REASONS = {
  phone: 'Phone number shared',
  email: 'Email address shared',
  handle: 'Chat handle shared',
  app: 'Chat app named',
  link: 'Link shared',
};

// When two detectors claim the same characters, the more specific one wins.
const PRIORITY = { email: 0, link: 1, phone: 2, handle: 3, app: 4 };

// ---------------------------------------------------------------------------
// Folding: the detector scans a folded copy of the text. Compatibility forms (full-width,
// circled, math letters) are folded, digits of every script become 0-9, Latin accents and
// look-alike Cyrillic/Greek letters become plain a-z, invisible characters are dropped.
// `from`/`to` map every folded code unit back to the original so hits underline what was typed.

const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u20e3\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e0fff}]/gu;
const MARK = /^[\p{M}\uff9e\uff9f]$/u;
const STRIP_ACCENTS = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]/u;

// First code point of each block of ten decimal digits we fold (Arabic … Khmer, Mongolian, full-width).
const DIGIT_ZEROS = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
  0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0xa8d0, 0xa900, 0xff10];

const LOOKALIKE = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  ѕ: 's', і: 'i', ї: 'i', ј: 'j', ԁ: 'd', ӏ: 'l', ɡ: 'g', ı: 'i',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  // Small capitals (ᴛᴇʟᴇɢʀᴀᴍ): NFKC leaves them alone.
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ғ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm',
  ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z',
};

const PUNCT_FOLD = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '⁃': '-', '﹘': '-',
  '。': '.', '·': '.', '・': '.', '•': '.', '∙': '.', '⋅': '.', '、': ',',
  '‘': "'", '’': "'", 'ʼ': "'", '′': "'",
};

function digitOf(cp) {
  for (const z of DIGIT_ZEROS) if (cp >= z && cp <= z + 9) return cp - z;
  if (cp >= 0x2776 && cp <= 0x277e) return cp - 0x2775; // ❶-❾
  if (cp >= 0x2780 && cp <= 0x2788) return cp - 0x277f; // ➀-➈
  if (cp >= 0x278a && cp <= 0x2792) return cp - 0x2789; // ➊-➒
  if (cp >= 0x24f5 && cp <= 0x24fd) return cp - 0x24f4; // ⓵-⓽
  if (cp === 0x24ea || cp === 0x24ff) return 0; // ⓪ ⓿
  return -1;
}

const unitsAt = (s, i) => (s.codePointAt(i) > 0xffff ? 2 : 1);

function foldGroup(group) {
  const g = group.replace(INVISIBLE, '');
  if (!g) return '';
  const d = digitOf(g.codePointAt(0));
  if (d >= 0) return String(d);
  let n = g.normalize('NFKC');
  if (STRIP_ACCENTS.test(n)) n = n.normalize('NFD').replace(/\p{M}/gu, '');
  return n;
}

function fold(text) {
  const s = String(text ?? '');
  let low = '', cased = '';
  const from = [], to = [];
  let i = 0;
  while (i < s.length) {
    // A base character plus its combining marks fold together (ｸﾞ → グ, é → e, 0̲ → 0).
    const start = i;
    i += unitsAt(s, i);
    while (i < s.length && MARK.test(String.fromCodePoint(s.codePointAt(i)))) i += unitsAt(s, i);
    for (const ch of foldGroup(s.slice(start, i))) {
      let c = PUNCT_FOLD[ch] || ch;
      let l = c.toLowerCase();
      if (l.length !== c.length) l = c;
      const look = LOOKALIKE[l];
      if (look) { c = c === l ? look : look.toUpperCase(); l = look; }
      low += l;
      cased += c;
      for (let k = 0; k < l.length; k++) { from.push(start); to.push(i); }
    }
  }
  return { s, low, cased, from, to };
}

const isLatin = (c) => c !== undefined && c >= 'a' && c <= 'z';
const isAlnum = (c) => c !== undefined && /[a-z0-9]/.test(c);

// Runs `re` (global) over `t`; `accept(m)` returns a hit or null. A rejected match is retried
// one character later, so a bad start never hides a good match inside it.
function scan(re, t, accept) {
  const out = [];
  re.lastIndex = 0;
  for (let m; (m = re.exec(t));) {
    const hit = accept(m);
    if (hit) out.push(hit);
    else re.lastIndex = m.index + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phone numbers: runs of digits in any script, spelled-out digits (English, Khmer, Chinese,
// Korean, Japanese) and mixtures. Pieces are joined across any run of non-letters (spaces,
// punctuation, symbols, emoji: "012;887;766", "012 🙂 887") and up to two filler words
// ("012 then 887 then 766"). 7+ digits is a phone number, 6+ when a phone word comes just
// before. Dates, years, opening hours and money are let through. Two backstops: pieces that
// read as one number started with 0 or 855 ("012 … 887 … 766", even over several messages),
// and 9+ digits packed into any 40 characters whatever sits between them ("012x887x766").

// Tens and teens count as their digits too: "eight nine ten twelve five" is 7 digits (Gamini 2026-10-13).
const EN_NUMBER_WORDS = [['seventeen', '17'], ['eighteen', '18'], ['nineteen', '19'], ['thirteen', '13'], ['fourteen', '14'],
  ['fifteen', '15'], ['sixteen', '16'], ['seventy', '70'], ['eighty', '80'], ['ninety', '90'], ['twenty', '20'], ['thirty', '30'],
  ['forty', '40'], ['fourty', '40'], ['fifty', '50'], ['sixty', '60'], ['eleven', '11'], ['twelve', '12'], ['hundred', '00'],
  ['thousand', '000'], ['ten', '10'], ['nought', '0'], ['triple', ''], ['double', ''], ['three', '3'], ['seven', '7'], ['eight', '8'],
  ['zero', '0'], ['four', '4'], ['five', '5'], ['nine', '9'], ['one', '1'], ['two', '2'], ['six', '6'], ['oh', '0'], ['o', '0']];
const MULTIPLIER = { double: 2, triple: 3 };
const KM_NUMBER_WORDS = [['សាមសិប', '30'], ['សែសិប', '40'], ['ហាសិប', '50'], ['ហុកសិប', '60'], ['ចិតសិប', '70'],
  ['ប៉ែតសិប', '80'], ['កៅសិប', '90'], ['ម្ភៃ', '20'], ['ដប់', '10'], ['រយ', '00'], ['ប្រាំមួយ', '6'], ['ប្រាំពីរ', '7'], ['ប្រាំពីល', '7'], ['ប្រាំបី', '8'], ['ប្រាំបួន', '9'], ['ប្រាំ', '5'],
  ['សូន្យ', '0'], ['មួយ', '1'], ['ពីរ', '2'], ['បី', '3'], ['បួន', '4']];
// A Khmer vowel/sign/coeng glued on means a different word (ពីរ "two" vs ពីរោះ "lovely").
const KHMER_DEPENDENT = /[ា-៓៝]/;
// Phone-reading forms too: 幺 1, 两/兩 2, 洞 0, 拐 7, 勾 9 ("洞幺两拐", how a number is read out in Chinese).
const CJK_DIGITS = '零〇一二三四五六七八九幺壹贰貳叁參肆伍陆陸柒捌玖两兩洞拐勾';
const CJK_VALUES = '00123456789112233456678922079';
// Hangul digit syllables and one-kana digits are also everyday words, so runs of them need more. 빵 = a spoken 0.
const HANGUL_DIGITS = '공영빵일이삼사오육륙칠팔구';
const HANGUL_VALUES = '0001234566789';
const KANA_NUMBER_WORDS = [['きゅう', '9'], ['きゅー', '9'], ['キュウ', '9'], ['キュー', '9'], ['ぜろ', '0'], ['ゼロ', '0'],
  ['れい', '0'], ['レイ', '0'], ['まる', '0'], ['マル', '0'], ['いち', '1'], ['イチ', '1'], ['さん', '3'], ['サン', '3'],
  ['よん', '4'], ['ヨン', '4'], ['ろく', '6'], ['ロク', '6'], ['なな', '7'], ['ナナ', '7'], ['しち', '7'], ['シチ', '7'],
  ['はち', '8'], ['ハチ', '8']];
const KANA_WEAK = 'にニしシごゴくク';
const KANA_WEAK_VALUES = '22445599';

// Between two pieces of one number: any non-letters (at most MAX_GAP of them) and filler words.
const NOT_GAP = /[\p{L}\p{M}\p{N}]/u;
const isGap = (c) => c !== undefined && !NOT_GAP.test(c);
const MAX_GAP = 10;
const MAX_FILLERS = 2;
const LATIN_FILLERS = ['and', 'then', 'next', 'dash', 'hyphen', 'is', 'plus', 'also', 'after'];
const SCRIPT_FILLERS = ['然后', '然後', '和', '再', '跟', '그리고', '다음', 'それから', 'と', 'និង', 'បន្ទាប់មក', 'ហើយ'];
const CHAIN_GAP = 80; // characters between the pieces of one split number inside a single text
const DENSE_SPAN = 40;

const PHONE_CUE = /(?:(?:^|[^a-z])(?:phone|tel|mobile|cell|call|number|num|contact|whatsapp)|電話|电话|手机|手機|号码|號碼|전화|번호|폰|番号|携帯|លេខ|ទូរស័ព្ទ|ទូរសព្ទ)[^0-9]{0,12}$/;
const MONEY = /\$|usd|riel|khr|៛|រៀល|ដុល្លារ|dollar|buck|元|块|塊|원|円|yen|won|yuan|rmb|baht|฿|€|£|eur/;

function englishNumberAt(t, i) {
  for (const [w, v] of EN_NUMBER_WORDS) {
    if (!t.startsWith(w, i)) continue;
    const end = i + w.length;
    // "zeroonetwo" glued together still counts; "someone" or "often" do not.
    if (!isLatin(t[end]) || englishNumberAt(t, end)) return { end, word: w, v };
  }
  return null;
}

// o/l/i typed for 0/1 inside a chunk that is mostly digits: "O12", "0l2".
function leetDigit(t, i) {
  if (!'oli'.includes(t[i])) return false;
  let a = i, b = i + 1;
  while (a > 0 && isAlnum(t[a - 1])) a--;
  while (b < t.length && isAlnum(t[b])) b++;
  const chunk = t.slice(a, b);
  if (!/^[0-9oli]+$/.test(chunk)) return false;
  const digits = chunk.replace(/[oli]/g, '').length;
  return digits >= 1 && digits >= chunk.length - digits;
}

// One digit (or a word for one) at i: { end, n: digits it adds, v: their value, digit|weak|mult }.
function numberTokenAt(t, i, glued) {
  const c = t[i];
  if (c === undefined) return null;
  if (c >= '0' && c <= '9') return { end: i + 1, n: 1, v: c, digit: true };
  if (isLatin(c)) {
    if (leetDigit(t, i)) return { end: i + 1, n: 1, v: c === 'o' ? '0' : '1' };
    if (isLatin(t[i - 1]) && !glued) return null;
    const w = englishNumberAt(t, i);
    if (!w) return null;
    const mult = MULTIPLIER[w.word];
    return mult ? { end: w.end, n: mult - 1, v: '', mult: true } : { end: w.end, n: w.v.length, v: w.v, word: true };
  }
  if (c === '十' || c === '拾') return { end: i + 1, n: 2, v: '10', word: true };
  if (c === '십') return { end: i + 1, n: 2, v: '10', weak: true };
  if (t.startsWith('じゅう', i) || t.startsWith('ジュウ', i)) return { end: i + 3, n: 2, v: '10', word: true };
  let k = CJK_DIGITS.indexOf(c);
  if (k >= 0) return { end: i + 1, n: 1, v: CJK_VALUES[k] };
  k = HANGUL_DIGITS.indexOf(c);
  if (k >= 0) return { end: i + 1, n: 1, v: HANGUL_VALUES[k], weak: true };
  for (const [w, v] of KANA_NUMBER_WORDS) if (t.startsWith(w, i)) return { end: i + w.length, n: 1, v, word: true };
  k = KANA_WEAK.indexOf(c);
  if (k >= 0) return { end: i + 1, n: 1, v: KANA_WEAK_VALUES[k], weak: true };
  if (c >= 'ក' && c <= '៿' && t[i - 1] !== '្') {
    for (const [w, v] of KM_NUMBER_WORDS) {
      if (t.startsWith(w, i) && !KHMER_DEPENDENT.test(t[i + w.length] || '')) return { end: i + w.length, n: v.length, v, word: true };
    }
  }
  return null;
}

// A filler word at j ("and", "then", "និង" …): its end, or -1.
function fillerAt(t, j) {
  if (!isLatin(t[j - 1])) {
    for (const w of LATIN_FILLERS) if (t.startsWith(w, j) && !isLatin(t[j + w.length])) return j + w.length;
  }
  for (const w of SCRIPT_FILLERS) if (t.startsWith(w, j)) return j + w.length;
  return -1;
}

// Where the next piece of the number could start after `end` (past separators and fillers).
function skipGap(t, end) {
  let j = end, gap = 0;
  for (let fillers = 0; ; fillers++) {
    while (gap < MAX_GAP && isGap(t[j])) { j++; gap++; }
    const f = fillers < MAX_FILLERS ? fillerAt(t, j) : -1;
    if (f < 0) return j;
    j = f;
  }
}

function runDigits(toks) {
  let s = '', times = 1;
  for (const k of toks) {
    if (k.mult) { times = k.n + 1; continue; }
    s += k.v.repeat(times);
    times = 1;
  }
  return s;
}

function numberRuns(t) {
  const runs = [];
  let i = 0;
  while (i < t.length) {
    const first = numberTokenAt(t, i, false);
    if (!first) { i++; continue; }
    const toks = [first];
    let end = first.end;
    for (;;) {
      const j = skipGap(t, end);
      const next = numberTokenAt(t, j, j === end);
      if (!next) break;
      toks.push(next);
      end = next.end;
    }
    while (toks.length && toks[toks.length - 1].mult) toks.pop(); // "double" with nothing after
    if (toks.length) {
      const last = toks[toks.length - 1].end;
      const run = { start: i, end: last, toks, digits: runDigits(toks), weak: toks.some((k) => k.weak) };
      run.harmless = toks.every((k) => k.digit) && harmlessNumber(t, i, last);
      runs.push(run);
    }
    i = Math.max(end, i + 1);
  }
  return runs;
}

function validDate(a, b) {
  return a >= 1 && b >= 1 && a <= 31 && b <= 31 && (a <= 12 || b <= 12);
}

const TIME = '\\d{1,2}[:.h]\\d{2}';
const TIME_RE = new RegExp(`^${TIME}(?:-${TIME})?$`); // 10:30, open 8.30-17.30, 10:30 - 11:45
// A time only when it is one on a clock: "7:66" or "28:87" is digits dressed up as a time.
const validTimes = (r) => r.split('-').every((p) => {
  const [h, m] = p.split(/[:.h]/).map(Number);
  return h <= 24 && m <= 59;
});

// One digit-only piece that reads as a date, year, time, decimal or an amount of money.
function harmlessPiece(raw, near) {
  const r = raw.replace(/\s*([/.,:-])\s*/g, '$1');
  const groups = r.split(/[^0-9]+/).filter(Boolean);
  if (groups.every((g) => /^(?:19|20)\d\d$/.test(g))) return true; // "2023 2024", "1990-2024"
  let m = /^(\d{1,2})([/.-])(\d{1,2})\2(?:19|20)?\d{2}(?: ?\d{1,2}[.:]\d{2})?$/.exec(r);
  if (m && validDate(+m[1], +m[3])) return true; // 12/10/2024
  m = /^(?:19|20)\d{2}([/.-])(\d{1,2})\1(\d{1,2})(?: ?\d{1,2}[.:]\d{2})?$/.exec(r);
  if (m && validDate(+m[2], +m[3])) return true; // 2024-10-12
  if (TIME_RE.test(r) && validTimes(r)) return true;
  if (/^(?:0|[1-9]\d{0,2})[.,]\d{1,2}$/.test(r)) return true; // 0.5 km, 2.50
  if (/^[1-9]\d{0,2}([,.])\d{3}(?:\1\d{3})*(?:[.,]\d{1,2})?$/.test(r)) return true; // 1,000,000
  return /^(?:[1-9]\d{0,2}(?: \d{3})+|[1-9]\d{5,})$/.test(raw) && MONEY.test(near); // 1 000 000 riel
}

// Digit-only runs that read as dates, years, times or money, alone or joined by "and"/"to".
function harmlessNumber(t, start, end) {
  const raw = t.slice(start, end).replace(/\s+/g, ' ').trim();
  const near = `${t.slice(Math.max(0, start - 8), start)} ${t.slice(end, end + 10)}`;
  if (harmlessPiece(raw, near)) return true;
  const pieces = raw.split(/\s+(?:and|or|then|to)\s+/);
  return pieces.length > 1 && pieces.every((p) => harmlessPiece(p, near));
}

const cuedAt = (t, start) => PHONE_CUE.test(t.slice(Math.max(0, start - 30), start));

// Pieces of 2–8 digits that, read in order, make one number of 9–12 digits whose first piece
// starts like a dialled number: a trunk prefix (012, 097, 010 …) or the country code 855.
const PHONE_START = /^(?:0[1-9]\d{1,3}|855\d{0,2})$/;

function chainHits(t, runs, maxGap) {
  const out = [];
  const piece = (r) => !r.harmless && !r.weak && r.digits.length >= 2 && r.digits.length <= 8;
  for (let i = 0; i < runs.length; i++) {
    if (!piece(runs[i]) || !PHONE_START.test(runs[i].digits)) continue;
    let total = runs[i].digits.length, k = i, hitEnd = -1;
    while (k + 1 < runs.length && piece(runs[k + 1]) && runs[k + 1].start - runs[k].end <= maxGap
      && total + runs[k + 1].digits.length <= 12) {
      total += runs[++k].digits.length;
      if (total >= 9) hitEnd = k;
    }
    if (hitEnd < 0) continue;
    out.push({ type: 'phone', fs: runs[i].start, fe: runs[hitEnd].end });
    i = hitEnd;
  }
  return out;
}

// 9+ digits inside any DENSE_SPAN characters (7+ after a phone word), whatever separates them.
function denseHits(t, runs) {
  const pos = [];
  for (const r of runs) {
    if (r.harmless) continue;
    for (let i = r.start; i < r.end; i++) if (t[i] >= '0' && t[i] <= '9') pos.push(i);
  }
  const out = [];
  for (let i = 0, j = 0; i < pos.length; i++) {
    if (j < i) j = i;
    while (j + 1 < pos.length && pos[j + 1] - pos[i] < DENSE_SPAN) j++;
    const n = j - i + 1;
    if (n >= 9 || (n >= 7 && cuedAt(t, pos[i]))) {
      out.push({ type: 'phone', fs: pos[i], fe: pos[j] + 1 });
      i = j;
    }
  }
  return out;
}

function phoneHits(f, { chainGap = CHAIN_GAP } = {}) {
  const t = f.low, out = [];
  const runs = numberRuns(t);
  for (const { start, end, toks, weak, harmless } of runs) {
    const total = toks.reduce((n, k) => n + k.n, 0);
    const long = total >= 7 && (!weak || total >= 8);
    const cued = total >= 6 && !weak && cuedAt(t, start);
    // Four or more number words in a row read as a number being spelled out, whatever they add up to.
    const spelled = toks.filter((k) => k.word).length >= 4;
    if (!long && !cued && !spelled) continue;
    let fs = start, plus = false;
    if (t[fs - 1] === '(') fs--;
    if (t[fs - 1] === '+') { fs--; plus = true; } else if (t[fs - 1] === ' ' && t[fs - 2] === '+') { fs -= 2; plus = true; }
    if (!plus && harmless) continue;
    out.push({ type: 'phone', fs, fe: end });
  }
  return [...out, ...chainHits(t, runs, chainGap), ...denseHits(t, runs), ...gluedNumberHits(t)];
}

// Number words glued together or misspelt to slip past the word check ("fitythousandtworilmillionfittyfour",
// "fity thousand two million"): read the letters only, find number-word stems anywhere, and flag a chain of
// four or more that sit at most 3 stray letters apart. Ordinary sentences rarely chain more than two.
const GLUED_STEMS = [
  'seventeen', 'eighteen', 'nineteen', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'thousand', 'thousend', 'tousand',
  'hundred', 'hundered', 'hundret', 'million', 'milion', 'billion', 'seventy', 'eighty', 'ninety', 'ninty', 'twenty',
  'twenty', 'thirty', 'forty', 'fourty', 'fifty', 'fifity', 'fitty', 'fity', 'sixty', 'eleven', 'twelve', 'twelv',
  'three', 'seven', 'eight', 'zero', 'four', 'five', 'nine', 'one', 'two', 'six', 'ten',
];
function gluedNumberHits(t) {
  const idx = [];
  let letters = '';
  for (let i = 0; i < t.length; i++) if (t[i] >= 'a' && t[i] <= 'z') { letters += t[i]; idx.push(i); }
  const toks = [];
  for (let i = 0; i < letters.length;) {
    const w = GLUED_STEMS.find((stem) => letters.startsWith(stem, i));
    if (w) { toks.push([i, i + w.length]); i += w.length; } else i++;
  }
  const out = [];
  for (let a = 0; a < toks.length;) {
    let b = a;
    while (b + 1 < toks.length && toks[b + 1][0] - toks[b][1] <= 3) b++;
    if (b - a + 1 >= 4) out.push({ type: 'phone', fs: idx[toks[a][0]], fe: idx[toks[b][1] - 1] + 1 });
    a = b + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emails: plain, spaced, and spelled out ("tom at mail dot com", "tom艾特qq点com").

const LOCAL = '[a-z0-9_](?:[a-z0-9._%+\\-]*[a-z0-9_])?';
const LABEL = '[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?';
const AT_OBFUSCATED = '(?:\\s*[(\\[{<]\\s*(?:at|@)\\s*[)\\]}>]\\s*|\\s*(?:艾特|爱特|愛特|アットマーク|アット|あっと|골뱅이|앳)\\s*)';
const DOT_SPELLED = '(?:\\s*[(\\[{<]\\s*(?:dot|\\.)\\s*[)\\]}>]\\s*|\\s+dot\\s+|\\s*(?:点|點|ドット|どっと|닷|쩜)\\s*)';
const DOT_ANY = `(?:\\.|\\s+\\.\\s+|${DOT_SPELLED})`;
const MAIL_TLD = '(?:com|net|org|edu|gov|info|biz|kh|cn|jp|kr|sg|th|vn|hk|tw|co|io|me|ru|uk|us|de|fr|au|ca|in|my|ph|id)';
const MAIL_ONLY = ['gmail', 'googlemail', 'hotmail', 'ymail', 'icloud', 'protonmail', 'hanmail', 'foxmail'];
const MAIL_ANY = [...MAIL_ONLY, 'yahoo', 'outlook', 'proton', 'naver', 'daum', 'kakao', 'qq', '163', '126', 'yandex',
  'live', 'msn', 'aol', 'zoho', 'mail'];
const MAIL_ANY_SET = new Set(MAIL_ANY);

const EMAIL_PLAIN = new RegExp(`${LOCAL}@${LABEL}(?:\\.${LABEL})*\\.[a-z]{2,24}(?![a-z0-9])`, 'g');
const EMAIL_SYMBOL = new RegExp(`${LOCAL}(?:\\s*@\\s*|${AT_OBFUSCATED})${LABEL}(?:${DOT_ANY}${LABEL})*?${DOT_ANY}${MAIL_TLD}(?![a-z0-9])`, 'g');
const EMAIL_WORD = new RegExp(`(${LOCAL})\\s+at\\s+(${LABEL})((?:${DOT_ANY}${LABEL})*?${DOT_ANY}${MAIL_TLD})(?![a-z0-9])`, 'g');
const EMAIL_PROVIDER = new RegExp(`${LOCAL}(?:\\s*@\\s*|${AT_OBFUSCATED})(?:${MAIL_ANY.join('|')})(?![a-z0-9])`, 'g');
const EMAIL_PROVIDER_WORD = new RegExp(`${LOCAL}\\s+at\\s+(?:${MAIL_ONLY.join('|')})(?![a-z0-9])`, 'g');
const SPELLED_DOT = /dot|点|點|ドット|どっと|닷|쩜/;

// A mail provider (or the word "email") right next to a username, with no "@" at all:
// "my gmail is tomk88", "email: tom dot k88", "visal88 gmail", "tomk88 at outlook".
const MAIL_WORDS = ['gmail', 'googlemail', 'hotmail', 'ymail', 'icloud', 'protonmail', 'proton', 'outlook', 'yahoo',
  'naver', 'hanmail', 'daum', 'foxmail', 'yandex', 'zoho', 'aol'];
const MAIL_LABEL = `(?:${MAIL_WORDS.join('|')}|e-?mail|mail|邮箱|郵箱|邮件|이메일|메일|メール|អ៊ីមែល)`;
const USER_PART = '[a-z0-9_](?:[a-z0-9._\\-]{0,40}[a-z0-9_])?';
const USER = `(${USER_PART}(?:${DOT_SPELLED}${USER_PART})*)`;
const EMAIL_LABELLED = new RegExp(`${MAIL_LABEL}\\s*(?:(?:id|account|acc|address|addr|is|是|은|는|は|の)\\s*)*[:=\\-]?\\s*${USER}(?![a-z0-9_])`, 'g');
const EMAIL_AT_PROVIDER = new RegExp(`${USER}\\s+(?:at|on|in)\\s+(?:${MAIL_ANY.join('|')})(?![a-z0-9])`, 'g');
const EMAIL_NEXT_TO_PROVIDER = new RegExp(`${USER}\\s+(?:${MAIL_WORDS.join('|')})(?![a-z0-9])`, 'g');
const usernameLike = (u) => SPELLED_DOT.test(u) || looksLikeHandle(u);

function emailHits(f) {
  const t = f.low;
  const take = (m) => ({ type: 'email', fs: m.index, fe: m.index + m[0].length });
  const named = (m) => (!isLatin(t[m.index - 1]) && !/\d/.test(t[m.index - 1] || '') && usernameLike(m[1]) ? take(m) : null);
  return [
    ...scan(EMAIL_PLAIN, t, take),
    ...scan(EMAIL_SYMBOL, t, take),
    // "look at google.com" is a link, not an email: the word "at" needs a username-looking
    // local part, a mail provider, or a spelled-out dot.
    ...scan(EMAIL_WORD, t, (m) => (/[0-9._]/.test(m[1]) || MAIL_ANY_SET.has(m[2]) || SPELLED_DOT.test(m[3]) ? take(m) : null)),
    ...scan(EMAIL_PROVIDER, t, take),
    ...scan(EMAIL_PROVIDER_WORD, t, take),
    ...scan(EMAIL_LABELLED, t, named),
    ...scan(EMAIL_AT_PROVIDER, t, named),
    ...scan(EMAIL_NEXT_TO_PROVIDER, t, named),
  ];
}

// ---------------------------------------------------------------------------
// Links: URLs, www., short links (t.me, wa.me, line.me …), bare domains, "site dot com".

const SAFE_TLD = 'com|net|org|edu|gov|info|biz|kh|cn|jp|kr|sg|th|vn|hk|tw|ru|uk|de|fr|au|ly|gl|gg|cc|tv|xyz|site|online|club|vip|app|link|shop|store|asia|io|page|dev';
// Too close to everyday words after a missed space ("ok.so", "join.us"): only with a path.
const PATH_TLD = 'me|co|us|in|to|top|live|so|it|is|my|be|do|am|at|ee|la|ws|ai|id|ph|mm|ca';

const LINK_RES = [
  /(?:https?|ftp)\s*:\s*\/\/\S*/g,
  /www(?:\s*\.\s*|\s+dot\s+|\s*[([]dot[)\]]\s*)\S*/g,
  /(?:t|wa|m|ig|fb|lin|bit|line|kakao|zalo|tiktok|tinyurl|goo)\s*(?:\.|[([]dot[)\]]|\s+dot\s+|\s+\.\s+)\s*(?:me|ee|ly|gl|com|link|gg)(?:\s*\/\s*|\s+slash\s+)[^\s]*/g,
  /(?:t|wa|m)\.me(?![a-z0-9])/g,
  new RegExp(`(?:${LABEL}\\.)+(?:${SAFE_TLD})(?![a-z0-9\\-])(?:[/?#:][^\\s]*)?`, 'g'),
  new RegExp(`(?:${LABEL}\\.)+(?:${PATH_TLD})\\/[^\\s]*`, 'g'),
  new RegExp(`${LABEL}(?:\\s*[(\\[{<]\\s*dot\\s*[)\\]}>]\\s*|\\s+dot\\s+|\\s*(?:点|點|ドット|닷|쩜)\\s*)(?:${SAFE_TLD}|me|co)(?![a-z0-9])`, 'g'),
];

// "t me visal88": a short link typed with the dot left out.
const SHORT_LINK_NO_DOT = /(?:t|wa)\s+me\s*[/\s]\s*([a-z0-9_]{3,32})(?![a-z0-9_])/g;

function linkHits(f) {
  const t = f.low;
  return [
    ...LINK_RES.flatMap((re) => scan(re, t, (m) => {
      if (isAlnum(t[m.index - 1])) return null;
      let fe = m.index + m[0].length;
      while (fe > m.index + 1 && `.,!?;)]}'"`.includes(t[fe - 1])) fe--;
      return { type: 'link', fs: m.index, fe };
    })),
    ...scan(SHORT_LINK_NO_DOT, t, (m) => (!isAlnum(t[m.index - 1]) && looksLikeHandle(m[1])
      ? { type: 'link', fs: m.index, fe: m.index + m[0].length } : null)),
  ];
}

// ---------------------------------------------------------------------------
// Handles: @name, and "id: tom_88" style labels.

const HANDLE_RE = /@\s?([a-z0-9_](?:[a-z0-9_.]{0,30}[a-z0-9_])?)/g;
const NOT_HANDLES = new Set(['home', 'work', 'office', 'school', 'the', 'you', 'here', 'there', 'night', 'noon', 'lunch',
  'dinner', 'breakfast', 'gym', 'cafe', 'all', 'everyone', 'someone', 'mall', 'beach', 'park', 'market', 'church',
  'temple', 'pagoda']);
const TIME_WORD = /^\d{1,2}(?:[.:]?\d{2})?(?:am|pm|h|hr|hrs)?$/;
const ID_LABEL_RE = /(?:\bid\b|\busername\b|\buser\s?name\b|\bhandle\b|账号|帳號|帐号|微信号|微信號|아이디|ユーザー名|ユーザーネーム)\s*(?:の)?\s*(?:[:=-]|\bis\b|是|は|는|은)?\s*([a-z0-9_][a-z0-9_.-]{1,30}[a-z0-9_])(?![a-z0-9_])/g;

function looksLikeHandle(token) {
  if (token.length < 4) return false;
  if (/^\d+$/.test(token)) return token.length >= 5;
  return (/\d/.test(token) && /[a-z]/.test(token)) || token.includes('_');
}

function handleHits(f) {
  const t = f.low;
  return [
    ...scan(HANDLE_RE, t, (m) => {
      const name = m[1];
      if (/[a-z0-9._%+-]/.test(t[m.index - 1] || '')) return null;
      if (name.length < 3 || TIME_WORD.test(name) || NOT_HANDLES.has(name)) return null;
      if (/\s/.test(m[0][1]) && !/[0-9_]/.test(name)) return null; // "@ home" is just "at home"
      return { type: 'handle', fs: m.index, fe: m.index + m[0].length };
    }),
    ...scan(ID_LABEL_RE, t, (m) => (looksLikeHandle(m[1]) ? { type: 'handle', fs: m.index, fe: m.index + m[0].length } : null)),
  ];
}

// ---------------------------------------------------------------------------
// Chat apps, in all five languages. "line", "signal" and "messenger" are everyday words, so
// they only count as app names in context (LINE in caps, "line id", "add me on line" …).

const LATIN_APPS = [
  'tele\\s*gram', 'telegarm', 'telegrm', 'tele', 'tg',
  "wh?at'?s\\s*ap+", 'wh?ats?ap+',
  'we[-._]?chat', 'weixin', 'wx', 'vx',
  'viber', 'zalo', 'skype', 'discord', 'botim', 'facetime',
  'snap\\s*chat', 'tik\\s*tok', 'douyin', 'insta\\s*gram', 'insta',
  'kakao\\s*talk', 'kakao', 'katalk', 'face\\s*book', 'fb', 'twitter',
  'qq', 'weibo', 'xiaohongshu', 'tinder', 'bumble', 'badoo', 'okcupid', 'tantan',
];
const LATIN_APP_RE = new RegExp(`(?:${LATIN_APPS.join('|')})(?![a-z])`, 'g');

// "t e l e g r a m", "w.h.a.t.s.a.p.p": a separator between every letter.
const SPACED_APPS = ['telegram', 'whatsapp', 'wechat', 'viber', 'signal', 'instagram', 'snapchat', 'kakaotalk', 'zalo',
  'tiktok', 'messenger', 'facebook', 'line', 'skype'];
const SPACED_APP_RE = new RegExp(`(?:${SPACED_APPS.map((w) => w.split('').join('[\\s.\\-_*|/]+')).join('|')})(?![a-z])`, 'g');

const SCRIPT_APPS = [
  // Chinese
  '微信号', '微信號', '微信', '威信', '薇信', '徽信', 'v信', '加v(?![a-z])', '加q(?![a-z])', '扣扣(?!子)', '电报', '電報',
  '纸飞机', '紙飛機', '飞机号', '飛機號', '脸书', '臉書', '推特', '抖音', '小红书', '小紅書', '微博', '陌陌',
  '钉钉(?!子)', '釘釘(?!子)', 'ins号', 'ins號',
  // Korean
  '카카오톡', '카톡', '카카오\\s*(?:아이디|id|톡)', '텔레그램', '텔레(?![가-힣])', '왓츠\\s*앱', '위챗', '인스타그램',
  '인스타', '페이스북', '페북', '틱톡', '바이버', '스냅챗', '디스코드', '오픈\\s*채팅', '오픈톡',
  '라인\\s*(?:아이디|id|친구)', '시그널\\s*(?:앱|아이디)',
  // Khmer
  'តេឡេក្រាម', 'តេលេក្រាម', 'ថេឡេក្រាម', 'ថេលេក្រាម', 'តេឡេ(?![\\u1780-\\u17ff])', 'វីឆាត', 'វ៉ីឆាត',
  'វ៉ាត់សាប់', 'វ៉ាតសាប', 'វាត់សាប់', 'ហ្វេសប៊ុក', 'ហ្វេសបុក', 'ទិកតុក', 'តិកតុក', 'តិចតុក',
  'អ៊ីនស្តាក្រាម', 'អ៊ីនស្ដាក្រាម', 'អ៊ីនស្តា', 'អ៊ីនស្ដា', 'ម៉ែសេនជឺ', 'មែសេនជឺ', 'ម៉េសេនជឺ',
];
const SCRIPT_APP_RE = new RegExp(SCRIPT_APPS.join('|'), 'g');

// Japanese names must stand alone as katakana words: インスタント is "instant", オンライン is "online".
const KATAKANA_APPS = ['テレグラム', 'ワッツアップ', 'ウィーチャット', 'インスタグラム', 'インスタ', 'フェイスブック',
  'ティックトック', 'カカオトーク', 'スナップチャット', 'バイバー', 'ツイッター', 'ディスコード', 'スカイプ', 'ライン'];
const KATAKANA_APP_RE = new RegExp(`(?:${KATAKANA_APPS.join('|')})(?![\\u30a0-\\u30ff])`, 'g');
const KATAKANA = /[\u30a0-\u30ff]/;
const CJK_IDEOGRAPH = /[\u4e00-\u9fff]/;

const CONTEXT_APP_RE = /(?:line|signal|messenger|wa|ig|we\s+chat)(?![a-z])/g;
const CONTACT_VERB_BEFORE = /(?:^|[^a-z])(?:add|find|message|msg|text|txt|call|contact|chat|dm|pm|reach|follow|ping|talk|hit|friend|reply)(?:\s+(?:me|us|him|her))?(?:\s+up)?\s+(?:on|in|via|at|through|thru|with|over)\s+$/;
const ADD_BEFORE_ZH = /加\s*我?\s*$/;
const APP_VERB_BEFORE = /(?:^|[^a-z])(?:on|via|using|use|download|install|open|join)\s+$/;
const MY_BEFORE = /(?:^|[^a-z])(?:my|your|follow)\s+$/;
const LINE_AFTER = /^\s*(?:(?:app|id|account|acc|username|user\s?name|qr)(?![a-z])|me(?![a-z])(?!\s+up)|[:]|号|號|아이디|の?id)/;
const LINE_NOT_APP_AFTER = /^\s+(?:(?:with|for|of|up)(?![a-z])|\d)/;
const APP_AFTER = /^\s*(?:(?:app|id|account|acc|username|user\s?name|number|chat|call|group|contact|handle|qr)(?![a-z])|[:]|号|號|아이디|の?id)/;
// "ig dara88", "ig.dara88", "ig @ dara", "dara88 ig": Instagram's short name next to a handle (as "ig:" already is).
const IG_HANDLE_AFTER = /^\s*(?:[.:=-]\s*)?(@\s*[a-z0-9_]{2,}|[a-z0-9_][a-z0-9_.]{2,30}[a-z0-9_])/;
const IG_HANDLE_BEFORE = /(?:^|[^a-z0-9_.])([a-z0-9_][a-z0-9_.]{2,30}[a-z0-9_])\s*(?:[.:=-]\s*)?$/;

function igHandle(before, after) {
  const a = IG_HANDLE_AFTER.exec(after);
  if (a && (a[1].startsWith('@') || looksLikeHandle(a[1]))) return true;
  const b = IG_HANDLE_BEFORE.exec(before);
  return Boolean(b && looksLikeHandle(b[1]));
}

function isShouting(cased) {
  const letters = cased.match(/[A-Za-z]/g) || [];
  if (letters.length < 10) return false;
  return letters.filter((c) => c <= 'Z').length / letters.length > 0.7;
}

function contextApp(f, fs, fe) {
  const word = f.low.slice(fs, fe), cased = f.cased.slice(fs, fe);
  const before = f.low.slice(Math.max(0, fs - 40), fs), after = f.low.slice(fe, fe + 24);
  const caps = cased === cased.toUpperCase();
  if (word === 'line' && cased !== 'LINE' && LINE_NOT_APP_AFTER.test(after)) return false; // "in line with", "line 3"
  if (CONTACT_VERB_BEFORE.test(before) || ADD_BEFORE_ZH.test(before)) return true;
  // "we chat every day" is English; "add me on we chat", "my we chat id" are WeChat.
  if (word.startsWith('we')) return APP_AFTER.test(after) || APP_VERB_BEFORE.test(before) || MY_BEFORE.test(before);
  if (word === 'line') return (cased === 'LINE' && !f.shouting) || LINE_AFTER.test(after);
  if (APP_AFTER.test(after) || APP_VERB_BEFORE.test(before)) return true;
  if (word === 'ig' && igHandle(before, after)) return true;
  if (word === 'signal' || word === 'messenger') {
    // Capitalised mid-sentence or on its own; "Signal is weak here" just starts a sentence.
    const startsSentence = /(?:^|[.!?]\s+)$/.test(f.low.slice(0, fs).trimStart());
    if (startsSentence && /^\s+[a-z]/.test(f.cased.slice(fe))) return false;
    return cased[0] !== word[0] && !(caps && f.shouting);
  }
  return MY_BEFORE.test(before) || (caps && (word === 'ig' || !f.shouting)); // IG, WA
}

// Look-alike spellings of the long app names: te1egram, teleqram, tel3gram, telegr@m, vvhatsapp,
// Telegrann, whatsaap, wechaat. Only names of 6+ letters, where one slip still cannot make an
// everyday word (so not Tinder/tender, Bumble/humble, Discord/discard, Twitter/twister).
const FUZZY_APPS = ['telegram', 'whatsapp', 'wechat', 'instagram', 'snapchat', 'kakaotalk', 'facebook', 'tiktok'];
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '!': 'l', '|': 'l', '@': 'a', $: 's', q: 'g' };
const LEET_PAIRS = { vv: 'w', nn: 'm', rn: 'm' };

// Optimal string alignment distance, but only "is it 0 or 1?" matters, so give up past 1.
function withinOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      row.push(v);
    }
    if (Math.min(...row) > 1) return false;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length] <= 1;
}

function fuzzyAppHits(t) {
  const out = [];
  let word = '', ws = -1;
  const flush = (end) => {
    if (word.length >= 5 && word.length <= 10 && FUZZY_APPS.some((name) => withinOne(word, name))) out.push({ type: 'app', fs: ws, fe: end });
    word = '';
  };
  for (let i = 0; i < t.length;) {
    const pair = LEET_PAIRS[t.slice(i, i + 2)];
    const c = pair || LEET[t[i]] || t[i];
    const step = pair ? 2 : 1;
    if (isLatin(c)) {
      if (!word) ws = i;
      word += c;
    } else {
      flush(i);
    }
    i += step;
  }
  flush(t.length);
  return out;
}

function appHits(f) {
  const t = f.low;
  const take = (m) => ({ type: 'app', fs: m.index, fe: m.index + m[0].length });
  const word = (m) => (isLatin(t[m.index - 1]) ? null : take(m));
  return [
    ...scan(LATIN_APP_RE, t, word),
    ...scan(SPACED_APP_RE, t, word),
    ...scan(SCRIPT_APP_RE, t, take),
    ...scan(KATAKANA_APP_RE, t, (m) => {
      const prev = t[m.index - 1] || '';
      if (KATAKANA.test(prev) || (m[0] === 'ライン' && CJK_IDEOGRAPH.test(prev))) return null;
      return take(m);
    }),
    ...scan(CONTEXT_APP_RE, t, (m) => (word(m) && contextApp(f, m.index, m.index + m[0].length) ? take(m) : null)),
    ...fuzzyAppHits(t),
  ];
}

// ---------------------------------------------------------------------------
// Putting the hits together.

function resolveOverlaps(found) {
  const ranked = [...found].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || (b.fe - b.fs) - (a.fe - a.fs) || a.fs - b.fs);
  const kept = [];
  for (const h of ranked) if (!kept.some((k) => h.fs < k.fe && k.fs < h.fe)) kept.push(h);
  return kept.sort((a, b) => a.fs - b.fs);
}

// "Telegram @visal88", "WhatsApp: +855 …", "@visal88 on TG" read as one detail, typed by the detail.
const APP_GAP = /^[\s:=,.-]*(?:(?:id|is|on|in|via|at|me|my|号|號|아이디|는|은|は|の|是|no|number|account|acc)[\s:=,.-]*){0,3}$/;

function mergeAppNeighbours(f, hits) {
  const out = [];
  for (const h of hits) {
    const prev = out[out.length - 1];
    if (prev && (prev.type === 'app') !== (h.type === 'app') && APP_GAP.test(f.low.slice(prev.fe, h.fs))) {
      out[out.length - 1] = { type: prev.type === 'app' ? h.type : prev.type, fs: prev.fs, fe: h.fe };
    } else {
      out.push(h);
    }
  }
  return out;
}

// "LINE id: tomk88", "wechat is sophea_pp", "visal88 on telegram": the app name plus the id
// typed right after (or just before) it.
const APP_TAIL = /^\s*(?:の\s*)?(?:(?:id|号|號|아이디|username|user\s?name|account|acc|handle|number|no)\s*)?(?:[:=-]|is|是|は|는|은)?\s*([a-z0-9_][a-z0-9_.-]{1,30}[a-z0-9_])(?![a-z0-9_])/;
const APP_HEAD = /([a-z0-9_][a-z0-9_.-]{1,30}[a-z0-9_])\s+(?:on|in|via|at)\s+$/;

function extendAppHandles(f, hits) {
  return hits.map((h, k) => {
    if (h.type !== 'app') return h;
    const prev = hits[k - 1], next = hits[k + 1];
    const tail = APP_TAIL.exec(f.low.slice(h.fe));
    if (tail && looksLikeHandle(tail[1])) {
      const fe = h.fe + tail[0].length;
      if (!next || next.fs >= fe) return { type: 'handle', fs: h.fs, fe };
    }
    const before = f.low.slice(Math.max(0, h.fs - 40), h.fs);
    const head = APP_HEAD.exec(before);
    if (head && looksLikeHandle(head[1]) && !isAlnum(before[head.index - 1])) {
      const fs = h.fs - before.length + head.index;
      if (!prev || prev.fe <= fs) return { type: 'handle', fs, fe: h.fe };
    }
    return h;
  });
}

function toHit(f, h) {
  let { fs, fe } = h;
  while (fs < fe - 1 && /\s/.test(f.low[fs])) fs++;
  while (fe > fs + 1 && /\s/.test(f.low[fe - 1])) fe--;
  const start = f.from[fs], end = f.to[fe - 1];
  return { type: h.type, match: f.s.slice(start, end), start, end };
}

// Contact details are NEVER allowed at any level: phone numbers, emails, @handles, chat-app names, links.
// opts.chainGap: how far apart the pieces of one split phone number may be (characters).
export function findContactDetails(text, opts = {}) {
  const f = fold(text);
  if (!f.low.trim()) return { ok: true, hits: [], reason: null };
  f.shouting = isShouting(f.cased);
  const found = [...emailHits(f), ...linkHits(f), ...phoneHits(f, opts), ...handleHits(f), ...appHits(f)];
  const hits = extendAppHandles(f, mergeAppNeighbours(f, resolveOverlaps(found)))
    .map((h) => toHit(f, h))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  return { ok: hits.length === 0, hits, reason: hits.length ? CONTACT_REASONS[hits[0].type] : null };
}

/**
 * Contact details split over several texts that each pass on their own: the written questions of
 * one set, the five answers, or someone's last few chat lines ("My number starts 012" … "887" …
 * "766"). The texts are read as one, joined by line breaks, and a split number may spread over
 * all of them. Each hit says which texts it touches: `index` (first) and `lastIndex`.
 * → { ok, hits:[{ type, match, start, end, index, lastIndex }], reason, text } (text = the joined texts)
 */
export function findContactDetailsAcross(texts) {
  const parts = (Array.isArray(texts) ? texts : []).map((x) => String(x ?? ''));
  const text = parts.join('\n');
  const r = findContactDetails(text, { chainGap: Infinity });
  const starts = [];
  let at = 0;
  for (const p of parts) { starts.push(at); at += p.length + 1; }
  const indexAt = (pos) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= pos) k++; return k; };
  return { ...r, text, hits: r.hits.map((h) => ({ ...h, index: indexAt(h.start), lastIndex: indexAt(Math.max(h.start, h.end - 1)) })) };
}

// ---------------------------------------------------------------------------
// Replies to Level 1 and Level 2 lines (owner 2026-10-14: "all questions answering method change to 10 characters
// max" — "so no more yes no not really maybe"): typed, 1–10 characters, one line. And "same rule — can not write
// numbers like a phone or a TG handle, or imply them by words, even if they write them vertically or horizontally":
// on top of findContactDetails, one reply may not carry 5 or more digits in any form (digits, number words in the
// five languages, spaced or glued) nor any @name, and a person's replies are also read together, down the screen and
// in the order typed (findSplitContactDetails), so a number or a handle split over several replies is stopped too.

export const REPLY_MIN = 1, REPLY_MAX = 10;
const REPLY_DIGITS_MAX = 4; // "10:30", "1990", "2 or 3" pass; "0 1 2 8 8", "零一二八八", "oh 1 2 3 4" do not
const REPLY_CHAR_MAX = 12; // code points in one character: a Khmer stack, an emoji family with skin tones
// Code points in all: ten of the widest characters fit (ten family emoji are 70), so a reply the counter shows as
// 10/10 is never "too long"; marks that join a character count as nothing, so this is what stops them stacking.
export const REPLY_RAW_MAX = REPLY_MAX * REPLY_CHAR_MAX;

// All the digits one reply carries, however they are written. Hangul digit syllables and one-kana digits are also
// everyday words (일이 "work", に a particle), so they count only in a run of four number words or more.
function replyDigitHit(f) {
  let total = 0, fs = -1, fe = -1;
  for (const run of numberRuns(f.low)) {
    const n = run.toks.reduce((sum, k) => sum + (k.weak && run.toks.length < 4 ? 0 : k.n), 0);
    if (!n) continue;
    total += n;
    if (fs < 0) fs = run.start;
    fe = run.end;
  }
  return total > REPLY_DIGITS_MAX ? { type: 'phone', fs, fe } : null;
}

// "@ab", "@x_1", "@ dara": a reply has no use for an @name of any length, spaced or not ("@home", "@5pm", "@ my place"
// are just "at").
const REPLY_HANDLE_RE = /@\s*([a-z0-9_][a-z0-9_.]*)/g;
const AT_WORDS = new Set(['my', 'your', 'his', 'her', 'our', 'their', 'a', 'an', 'this', 'that', 'it', 'me', 'us', 'them',
  'least', 'last', 'first', 'once', 'times', 'ease', 'best', 'most']);
function replyHandleHits(f) {
  return scan(REPLY_HANDLE_RE, f.low, (m) => {
    const name = m[1], spaced = m[0].length > name.length + 1;
    if (NOT_HANDLES.has(name) || TIME_WORD.test(name) || (spaced && AT_WORDS.has(name))) return null;
    return { type: 'handle', fs: m.index, fe: m.index + m[0].length };
  });
}

/**
 * Contact details in ONE reply: findContactDetails, plus 5 or more digits in any form (phone) and any @name (handle).
 * → { ok, hits:[{ type, match, start, end }], reason }
 */
export function findReplyContactDetails(text) {
  const c = findContactDetails(text);
  if (!c.ok) return c;
  const f = fold(text);
  const hits = [replyDigitHit(f), ...replyHandleHits(f)].filter(Boolean).map((h) => toHit(f, h)).sort((a, b) => a.start - b.start);
  return hits.length ? { ok: false, hits, reason: CONTACT_REASONS[hits[0].type] } : c;
}

// One reading of the texts in an order, joined by `glue`: the hits that span two texts or more, one of them fresh,
// with their places re-counted in the spanned texts joined by line breaks (what the admin sees).
function splitHits(items, glue) {
  const starts = [];
  let at = 0;
  for (const x of items) { starts.push(at); at += x.text.length + glue.length; }
  const itemAt = (pos) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= pos) k++; return k; };
  const joined = items.map((x) => x.text).join(glue);
  const r = findContactDetails(joined, glue ? { chainGap: Infinity } : {});
  let found = r.hits;
  if (!glue) {
    // Glued, only the letters count ("we" + "chat", "@" + "ab"): numbers are read line by line, where breaks are gaps.
    const f = fold(joined);
    found = [...found.filter((h) => h.type !== 'phone'), ...replyHandleHits(f).map((h) => toHit(f, h))];
  }
  const spans = found
    .map((h) => ({ h, index: itemAt(h.start), lastIndex: itemAt(Math.max(h.start, h.end - 1)) }))
    .filter((s) => s.lastIndex > s.index && items.slice(s.index, s.lastIndex + 1).some((x) => x.fresh));
  if (!spans.length) return null;
  const { index, lastIndex } = spans[0];
  const span = items.slice(index, lastIndex + 1);
  const text = span.map((x) => x.text).join('\n');
  const local = []; // where each spanned text starts in `text`
  let pos = 0;
  for (const x of span) { local.push(pos); pos += x.text.length + 1; }
  const place = (p, end) => {
    const k = itemAt(end ? Math.max(0, p - 1) : p);
    const off = Math.min(p - starts[k], items[k].text.length);
    return k < index || k > lastIndex ? null : local[k - index] + off;
  };
  const hits = spans.filter((s) => s.index >= index && s.lastIndex <= lastIndex).map(({ h, index: i, lastIndex: j }) => {
    const start = place(h.start, false), end = place(h.end, true);
    return { type: h.type, match: text.slice(start, end), start, end, index: i, lastIndex: j };
  });
  return { ok: false, hits, reason: CONTACT_REASONS[hits[0].type], text, items: span };
}

const GLUE_WINDOW = 6; // texts glued together at most ("te" / "le" / "gr" / "am"); one letter each is read line by line

// ---- Digits added up, however far apart (owner 2026-10-14: "can not write numbers like a phone … even if they write
// them vertically or horizontally"). Read line by line, a number split down the replies hides behind ordinary replies
// between its pieces ("0" … "Not really" … "1288" … "ថ្ងៃនេះខ្ញុំរវល់ណាស់" … "7766"); so the digits one person typed
// are also simply added up, in any form, over everything in the order. A phone number needs 8 or more (a Cambodian
// number without its 0; a Chinese mobile has 11), and short replies with a number in them stay well under it.
export const SPLIT_DIGITS = 8;

/**
 * The digits a text carries for that sum, in any form (digits in any script, number words in the five languages) →
 * { n, fs, fe } (folded places of the first and last counted run). A number word that is also an everyday word (一 in
 * 一点点, さん in ダラさん, 일이 "work", "oh", "no one") counts only in a run of number words (Hangul / one-kana digits:
 * 4 or more) or in a text that is nothing but numbers ("零", "공일", "oh"). A date, year, time or sum of money reads
 * as one inside a sentence (a written line, a chat line); a reply is too short for that, so all its digits count.
 */
function splitDigits(f) {
  const t = f.low;
  const runs = numberRuns(t);
  if (!runs.length) return { n: 0, fs: -1, fe: -1 };
  let rest = '', at = 0;
  for (const r of runs) { rest += t.slice(at, r.start); at = r.end; }
  const bare = !NOT_GAP.test(rest + t.slice(at));
  const sentence = charCount(f.s) > REPLY_MAX;
  let n = 0, fs = -1, fe = -1;
  for (const r of runs) {
    if (sentence && r.harmless) continue;
    const k = r.toks.reduce((sum, tok) => sum + (tok.digit || bare || r.toks.length >= (tok.weak ? 4 : 2) ? tok.n : 0), 0);
    if (!k) continue;
    n += k;
    if (fs < 0) fs = r.start;
    fe = r.end;
  }
  return { n, fs, fe };
}

/** SPLIT_DIGITS or more over two texts or more of `items`, a fresh one among them → the split hit (the pieces), or null. */
function digitSumHit(items) {
  const pieces = [];
  let total = 0;
  items.forEach((x, i) => {
    const f = fold(x.text);
    const d = splitDigits(f);
    if (d.n) { total += d.n; pieces.push({ i, f, ...d }); }
  });
  if (total < SPLIT_DIGITS || pieces.length < 2 || !pieces.some((p) => items[p.i].fresh)) return null;
  // What the admin sees: only the texts that carry the digits, one per line, the hit from the first digit to the last.
  const text = pieces.map((p) => items[p.i].text).join('\n');
  const first = pieces[0], last = pieces[pieces.length - 1];
  const start = first.f.from[first.fs];
  const end = text.length - items[last.i].text.length + last.f.to[last.fe - 1];
  return {
    ok: false, hits: [{ type: 'phone', match: text.slice(start, end), start, end, index: first.i, lastIndex: last.i }],
    reason: CONTACT_REASONS.phone, text, items: pieces.map((p) => items[p.i]),
  };
}

// ---- Chat-app names spelt over short replies with other replies between the pieces ("wh" … "ok" … "atsapp",
// "tel" … "Yes" … "eg" … "Yes" … "ram", "微" … "好" … "信"). Neighbours are read by the glued windows; here a piece may
// skip up to CHAIN_SKIP texts, as long as the letters so far are still part of an app's name (so "ok" between "we"
// and "chat" is skipped, not glued in). Names that are everyday
// words (line, signal, messenger) are left to the context rules.
const CHAIN_APPS = [
  'telegram', 'tele', 'tg', 'whatsapp', 'whatsap', 'watsapp', 'wechat', 'weixin', 'wx', 'vx', 'viber', 'zalo', 'skype',
  'discord', 'botim', 'facetime', 'snapchat', 'tiktok', 'douyin', 'instagram', 'insta', 'kakaotalk', 'kakao', 'katalk',
  'facebook', 'fb', 'twitter', 'qq', 'weibo', 'xiaohongshu', 'tinder', 'bumble', 'badoo', 'okcupid', 'tantan',
  '微信', '微信号', '威信', '薇信', '徽信', '电报', '電報', '纸飞机', '紙飛機', '飞机号', '飛機號', '脸书', '臉書', '推特', '抖音',
  '小红书', '小紅書', '微博', '陌陌', '钉钉', '釘釘',
  '카카오톡', '카톡', '텔레그램', '텔레', '왓츠앱', '위챗', '인스타그램', '인스타', '페이스북', '페북', '틱톡', '바이버', '스냅챗',
  '디스코드', '오픈채팅', '오픈톡',
  'តេឡេក្រាម', 'តេលេក្រាម', 'ថេឡេក្រាម', 'ថេលេក្រាម', 'តេឡេ', 'វីឆាត', 'វ៉ីឆាត', 'វ៉ាត់សាប់', 'វ៉ាតសាប', 'វាត់សាប់',
  'ហ្វេសប៊ុក', 'ហ្វេសបុក', 'ទិកតុក', 'តិកតុក', 'តិចតុក', 'អ៊ីនស្តាក្រាម', 'អ៊ីនស្ដាក្រាម', 'អ៊ីនស្តា', 'អ៊ីនស្ដា',
  'テレグラム', 'ワッツアップ', 'ウィーチャット', 'インスタグラム', 'インスタ', 'フェイスブック', 'ティックトック', 'カカオトーク',
  'スナップチャット', 'バイバー', 'ツイッター', 'ディスコード', 'スカイプ',
];
const CHAIN_SKIP = 9; // texts that may sit between two pieces: a reply in Level 1 and the next in Level 2
const CHAIN_PIECES = 8;
const letterKey = (text) => fold(text).low.replace(/[^\p{L}\p{M}]/gu, '');
let chainKeys = null; // CHAIN_APPS folded like the texts, made on first use

/** An app name spelt over short texts of `items` (pieces in order, others skipped), a fresh one among them → the split hit, or null. */
function chainHit(items) {
  chainKeys ??= CHAIN_APPS.map(letterKey);
  const keys = items.map((x) => (charCount(x.text) <= REPLY_MAX ? letterKey(x.text) : ''));
  const part = (s) => chainKeys.some((w) => w.includes(s));
  let found = null;
  const walk = (chain, glued) => {
    if (chain.length >= 2 && chainKeys.includes(glued) && chain.some((k) => items[k].fresh)) {
      const r = splitHits(chain.map((k) => items[k]), '');
      if (r) {
        found = { ...r, hits: r.hits.map((h) => ({ ...h, index: chain[h.index], lastIndex: chain[h.lastIndex] })) };
        return;
      }
    }
    if (chain.length >= CHAIN_PIECES) return;
    const last = chain[chain.length - 1];
    for (let j = last + 1; j < items.length && j <= last + 1 + CHAIN_SKIP && !found; j++) {
      if (keys[j] && part(glued + keys[j])) walk([...chain, j], glued + keys[j]);
    }
  };
  for (let i = 0; i < items.length && !found; i++) if (keys[i] && part(keys[i])) walk([i], keys[i]);
  return found;
}

/**
 * Contact details written down (or across) several texts of one person that each pass alone: a reply per line read
 * top to bottom ("012" / "887" / "766", "zero" / "one" / "two" …, "tele" / "gram", "we" / "chat", "@" / "dara"), a
 * reply that finishes what a written line began, a chat line that finishes what the replies began. `orders` = lists of
 * { text, fresh, id? }, each read four ways: as one, line by line (like findContactDetailsAcross); every 2–6
 * neighbouring texts with a fresh one among them glued together (letters only: "we" + "chat"); the digits of all of
 * them added up, whatever sits between (SPLIT_DIGITS: "0" … "Yes I do" … "1288" … "Sunday" … "7766"); and app names
 * spelt over short texts with others between ("wh" … "ok" … "atsapp"). Only a hit that spans two texts or more, one of
 * them fresh, counts: what was let through before stays let through.
 * → { ok, hits:[{ type, match, start, end, index, lastIndex }], reason, text, items } — text = the spanned texts joined
 *   by line breaks (what the admin sees; hits point into it), items = the spanned { text, fresh, id }.
 */
export function findSplitContactDetails(orders) {
  for (const order of Array.isArray(orders) ? orders : []) {
    const items = (Array.isArray(order) ? order : [])
      .map((x) => ({ text: stripBidi(String(x?.text ?? '')).trim(), fresh: Boolean(x?.fresh), id: x?.id ?? null }))
      .filter((x) => x.text);
    if (items.length < 2 || !items.some((x) => x.fresh)) continue;
    const found = splitHits(items, '\n');
    if (found) return found;
    for (let size = 2; size <= Math.min(GLUE_WINDOW, items.length); size++) {
      for (let i = 0; i + size <= items.length; i++) {
        const window = items.slice(i, i + size);
        const glued = window.some((x) => x.fresh) ? splitHits(window, '') : null;
        if (glued) return glued;
      }
    }
    const summed = digitSumHit(items) || chainHit(items);
    if (summed) return summed;
  }
  return { ok: true, hits: [], reason: null, text: '', items: [] };
}

/**
 * Sexual words, slurs, rude or threatening words, and money / escort words (store policy, owner 2026-10-14; the lists
 * and how they match: ./bad-words.js), read through the same folding as contact details (ｆｕｃｋ, fück, f.u.c.k).
 * → { ok, hits:[{ type:'word', category, match, start, end }], reason } (reason: the first hit's BAD_WORD_REASONS).
 */
export function findBadWords(text) {
  const f = fold(text);
  if (!f.low.trim()) return { ok: true, hits: [], reason: null };
  const hits = badWordSpans(f.low).map((h) => ({ ...toHit(f, { type: 'word', fs: h.fs, fe: h.fe }), category: h.category }));
  return { ok: hits.length === 0, hits, reason: hits.length ? BAD_WORD_REASONS[hits[0].category] : null };
}

// ---------------------------------------------------------------------------
// Counting and the level text rules.

// Our own cluster rules rather than Intl.Segmenter, so the browser and the server always agree
// whatever ICU each one ships: a character plus its combining marks, Khmer subscripts (coeng +
// consonant: "ខ្ញុំ" is one), emoji ZWJ sequences and skin tones, and flag pairs.
const EXTEND = /[\p{M}\u200c\u200d\ufe0e\ufe0f\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
const COENG = 0x17d2, ZWJ = 0x200d;
const isKhmerLetter = (cp) => cp >= 0x1780 && cp <= 0x17b3;
const isRegional = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isPictographic = (cp) => cp >= 0x1f000 || (cp >= 0x2190 && cp <= 0x2bff) || cp === 0xa9 || cp === 0xae;

// One pass over the characters (trimmed, runs of spaces as one): how many there are, and the most
// code points any one of them holds (a "zalgo" letter stacks hundreds of marks onto one character).
function scanChars(text) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  let n = 0, size = 0, widest = 0, prev = 0, khmerBase = false, flagOpen = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const joins = n > 0 && (EXTEND.test(ch)
      || (prev === ZWJ && isPictographic(cp))
      || (prev === COENG && khmerBase && isKhmerLetter(cp))
      || (flagOpen && isRegional(cp)));
    if (!joins) {
      n++;
      size = 0;
      khmerBase = isKhmerLetter(cp);
    }
    if (++size > widest) widest = size;
    flagOpen = isRegional(cp) ? !flagOpen && !joins : flagOpen && joins;
    prev = cp;
  }
  return { count: n, widest };
}

// What a person would call characters: "កា" is one, "👍🏽" is one. Runs of spaces count once,
// so a short message cannot be padded out to the minimum with blanks.
export function charCount(text) {
  return scanChars(text).count;
}

const TRIVIAL_WORDS = [
  // en
  'yes', 'yeah', 'yea', 'yep', 'yup', 'ya', 'yah', 'ye', 'no', 'nope', 'nah', 'ok', 'okay', 'okey', 'oki', 'okie', 'k',
  'kk', 'hi', 'hey', 'hello', 'hallo', 'hiya', 'yo', 'sup', 'bye', 'byebye', 'goodbye', 'lol', 'lmao', 'lmfao', 'rofl',
  'haha', 'hehe', 'hihi', 'ha', 'he', 'ah', 'oh', 'aw', 'wow', 'omg', 'hmm', 'um', 'uh', 'mm', 'thx', 'ty', 'tq',
  'thanks', 'xd', 'xo', 'xoxo', 'gn', 'gm',
  // km
  'បាទ', 'ចាស', 'ចា', 'ចាះ', 'ចាស៎', 'បាទៗ', 'អូខេ', 'អូកេ', 'ហាយ', 'សួស្តី', 'សួស្ដី', 'ជំរាបសួរ', 'លាហើយ', 'បាយបាយ',
  'បាយៗ', 'ហាហា', 'ហាៗ', 'ហិហិ', 'អត់', 'ទេ', 'អឺ', 'អូ', 'អរគុណ',
  // zh
  '好', '好的', '是', '是的', '对', '對', '对的', '嗯', '哦', '噢', '喔', '啊', '呀', '嗨', '你好', '您好', '哈喽', '哈囉',
  '再见', '再見', '拜拜', '拜', '哈', '呵', '嘻', '嘿', '谢谢', '謝謝', '收到', '行',
  // ko
  '네', '넵', '넹', '예', '응', '웅', '엉', '어', '아니', '아니요', '아뇨', '안녕', '안녕하세요', '안녕히', '바이', '빠이',
  'ㅋ', 'ㅎ', 'ㅇㅇ', 'ㅇ', 'ㅠ', 'ㅜ', '오케이', '오키', '굿', '하이', '헬로', '감사', '감사합니다', '고마워', '고마워요',
  '땡큐', '그래', '헐',
  // ja
  'はい', 'うん', 'ええ', 'いいえ', 'いや', 'オッケー', 'オーケー', 'おけ', 'バイ', 'バイバイ', 'じゃね', 'じゃあね', 'またね',
  'こんにちは', 'こんばんは', 'おはよう', 'やあ', 'ハイ', 'ハロー', '笑', 'w', '草', 'ありがとう', 'どうも', 'ども', 'そう',
  'ね', 'ねえ', 'へえ', 'ふーん', 'うーん', 'えー', 'あ', 'お',
];
const TRIVIAL_SHAPES = [
  /^(?:h+[aeiou]+)+h*$/, // haha, hehe, hihi
  /^l+(?:o+l+)+$/, // lol, lolol
  /^(?:x+o+)+x*$/, // xoxo
  /^[\u314b\u314e\u3160\u315c\u110f\u1112\u1172\u116e]+$/u, // ㅋㅋㅋ ㅎㅎ ㅠㅠ (NFKC turns them into conjoining jamo)
  /^(?:哈|呵|嘻|嘿|笑|草|w)+$/u,
];
const TRIVIAL_STRIP = /[\p{P}\p{S}\u200b-\u200d\ufe0e\ufe0f\u20e3]/gu;

const wordKey = (w) => w.normalize('NFKC').toLowerCase().replace(/(.)\1+/gu, '$1');
const TRIVIAL = new Set(TRIVIAL_WORDS.map(wordKey));
// Glued pieces ("okok", "好的好的", "はいはい"); single Latin letters are left out so "know" ≠ k+no+w.
const TRIVIAL_PARTS = [...TRIVIAL].filter((w) => !/^[a-z]$/.test(w));
const TRIVIAL_PART_SET = new Set(TRIVIAL_PARTS);
const TRIVIAL_PART_MAX = Math.max(...TRIVIAL_PARTS.map((w) => w.length));

function isTrivialWord(w) {
  const k = wordKey(w);
  if (/^\d+$/.test(k) || TRIVIAL.has(k) || TRIVIAL_SHAPES.some((re) => re.test(k))) return true;
  const ok = [true];
  for (let i = 1; i <= k.length; i++) {
    ok[i] = false;
    for (let j = Math.max(0, i - TRIVIAL_PART_MAX); j < i && !ok[i]; j++) ok[i] = ok[j] && TRIVIAL_PART_SET.has(k.slice(j, i));
  }
  return ok[k.length];
}

function isTrivial(text) {
  const words = String(text ?? '').replace(TRIVIAL_STRIP, ' ').split(/\s+/).filter(Boolean);
  return words.every(isTrivialWord); // nothing but emoji/punctuation is trivial too
}

// Level 3 chat line: 20–30 characters, not just "ok"/"hi"/"bye", never a contact detail or a bad word
// (error 'contact' | 'word': the two the server stops and records for the admin; a contact detail is reported first).
export function checkChatMessage(text) {
  const count = charCount(text);
  const { ok: clean, hits, reason } = findContactDetails(text);
  const result = (error) => ({ ok: !error, error, hits, reason, count });
  if (!clean) return result('contact');
  const words = findBadWords(text);
  if (!words.ok) return { ok: false, error: 'word', hits: words.hits, reason: words.reason, count };
  if (count < CHAT_MIN) return result('too_short');
  if (count > CHAT_MAX) return result('too_long');
  if (isTrivial(text)) return result('trivial');
  return result(null);
}

function checkWritten(text, [min, max]) {
  const count = charCount(text);
  const hasWords = String(text ?? '').replace(TRIVIAL_STRIP, '').trim() !== '';
  if (!count || !hasWords) return { ok: false, error: 'empty', hits: [], reason: null, count };
  const { ok: clean, hits, reason } = findContactDetails(text);
  const result = (error) => ({ ok: !error, error, hits, reason, count });
  if (!clean) return result('contact');
  const words = findBadWords(text);
  if (!words.ok) return { ok: false, error: 'word', hits: words.hits, reason: words.reason, count };
  if (count < min) return result('empty');
  if (count > max) return result('too_long');
  return result(null);
}

// Written questions: Level 1 4–80 characters, Level 2 4–100.
export function checkWrittenQuestion(text, level) {
  return checkWritten(text, QUESTION_LIMITS[level] || QUESTION_LIMITS[2]);
}

// Answers in words, 2–120 characters: Level 2 took them until replies became taps (2026-10-13), and replies are
// short typed ones now (checkReply). Nothing sends these; kept for the rule's tests and for reading old ones.
export function checkWrittenAnswer(text) {
  return checkWritten(text, ANSWER_LIMITS);
}

// Direction controls (LRM / RLM, the embeddings and overrides U+202A–U+202E, the isolates U+2066–U+2069, ALM): none of
// the five languages needs them, and an override shows typed text backwards — "\u202emargelet" shows as "telegram",
// "\u202e88arad@" as "@dara88" — while every check reads it forwards. So they are taken out of whatever is kept.
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g;

/** `text` without direction controls (BIDI_CONTROLS): what is kept reads on screen as it was checked. */
export function stripBidi(text) {
  return String(text ?? '').replace(BIDI_CONTROLS, '');
}

/** A written line or a chat line as it is checked and kept: no direction controls, trimmed. */
export function cleanText(text) {
  return stripBidi(text).trim();
}

/** A reply as it is kept: no direction controls, trimmed, one line (any run of spaces or line breaks is one space). */
export function cleanReply(text) {
  return stripBidi(text).replace(/\s+/g, ' ').trim();
}

const NOTHING_SEEN = /[\p{M}\p{C}\p{Z}]/gu;

/**
 * A typed reply to a Level 1 or Level 2 line → { ok, text, count, error: null|'empty'|'too_long'|'contact'|'word', hits,
 * reason } (text = cleanReply). A contact detail is reported first (findReplyContactDetails), then a bad word, then
 * 1–10 characters as a person counts them (charCount: "ខ្ញុំ" is one, "好的" two). too_long also covers the raw caps.
 */
export function checkReply(raw) {
  const text = cleanReply(raw);
  const { count, widest } = scanChars(text);
  const c = findReplyContactDetails(text);
  const result = (error, x = c) => ({ ok: !error, text, count, error, hits: x.hits, reason: x.reason });
  if (!c.ok) return result('contact');
  const words = findBadWords(text);
  if (!words.ok) return result('word', words);
  if (count < REPLY_MIN || !text.replace(INVISIBLE, '').replace(NOTHING_SEEN, '')) return result('empty');
  if (count > REPLY_MAX || widest > REPLY_CHAR_MAX || [...text].length > REPLY_RAW_MAX) return result('too_long');
  return result(null);
}

// ---------------------------------------------------------------------------
// Profile (owner rule 2026-10-13): the app name is short (2–7 characters, the user's own pick, never a
// contact detail) and everyone gives a birth year. 30+DA is for people aged 30 and over, so the list
// only holds the years of ages 30–80 and anything younger is refused.

export const NAME_MIN = 2, NAME_MAX = 7;
// Raw size caps, so marks that join onto a character (and count as nothing) cannot stack without end:
// at most 64 code points in all (also the app-name inputs' maxlength: a code-unit count is never
// smaller, so whatever those boxes let through passes this cap) and 8 in any one character (a Khmer
// stack like "ស្ត្រី" is 6).
export const NAME_RAW_MAX = 64, NAME_CHAR_MAX = 8;
export const AGE_MIN = 30, AGE_MAX = 80;

// "This year" is Phnom Penh's (fixed UTC+7) on the server and in every browser, whatever the device
// clock's zone, so the year list and the server's check always agree.
const PHNOM_PENH_MS = 7 * 3600e3;
export function currentYear(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  return new Date((Number.isFinite(ms) ? ms : Date.now()) + PHNOM_PENH_MS).getUTCFullYear();
}

/** The birth years a person may pick, newest first: this year − 30 down to this year − 80. */
export function birthYearOptions(now = Date.now()) {
  const year = currentYear(now);
  return Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => year - AGE_MIN - i);
}

/**
 * A birth year as sent by a form (number or digit string) →
 * { ok, year:int|null, error:null|'missing'|'too_young'|'invalid' }.
 * missing = nothing chosen; too_young = born after this year − 30; invalid = not a year, in the future,
 * or before this year − 80 (not on the list).
 */
export function checkBirthYear(value, now = Date.now()) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === undefined || raw === null || raw === '') return { ok: false, year: null, error: 'missing' };
  const year = typeof raw === 'number' ? raw : /^\d{4}$/.test(String(raw)) ? Number(raw) : NaN;
  if (!Number.isInteger(year)) return { ok: false, year: null, error: 'invalid' };
  const thisYear = currentYear(now);
  if (year > thisYear || year < thisYear - AGE_MAX) return { ok: false, year, error: 'invalid' };
  if (year > thisYear - AGE_MIN) return { ok: false, year, error: 'too_young' };
  return { ok: true, year, error: null };
}

/**
 * An app name → { ok, name, count, error:null|'empty'|'too_short'|'too_long'|'contact'|'word', hits, reason }
 * (name = trimmed, single spaces). A contact detail is reported first, then a bad word: they are the rules that matter.
 * too_long also covers a name over the raw caps (NAME_RAW_MAX code points, NAME_CHAR_MAX in one character).
 */
export function checkAppName(text) {
  const name = stripBidi(text).trim().replace(/\s+/g, ' ');
  const { count, widest } = scanChars(name);
  const { ok: clean, hits, reason } = findContactDetails(name);
  const result = (error) => ({ ok: !error, name, count, error, hits, reason });
  if (!count) return result('empty');
  if (!clean) return result('contact');
  const words = findBadWords(name);
  if (!words.ok) return { ok: false, name, count, error: 'word', hits: words.hits, reason: words.reason };
  if (count > NAME_MAX || widest > NAME_CHAR_MAX || [...name].length > NAME_RAW_MAX) return result('too_long');
  if (count < NAME_MIN) return result('too_short');
  return result(null);
}

export const REAL_NAME_MIN = 2, REAL_NAME_MAX = 60;

/**
 * A real name (first and last, private until Level 3) → { ok, name, count, error:null|'empty'|'too_short'|'too_long'|
 * 'word', hits, reason } (name = trimmed, single spaces). 2–60 characters and no bad word (reported first).
 */
export function checkRealName(text) {
  const name = stripBidi(text).trim().replace(/\s+/g, ' ');
  const count = charCount(name);
  const words = findBadWords(name);
  const result = (error) => ({ ok: !error, name, count, error, hits: words.hits, reason: words.reason });
  if (!count) return result('empty');
  if (!words.ok) return result('word');
  if (count < REAL_NAME_MIN) return result('too_short');
  if (count > REAL_NAME_MAX) return result('too_long');
  return result(null);
}

/** The longest start of `text` that is at most `max` characters (as charCount counts them). For live inputs. */
export function clipChars(text, max) {
  const s = String(text ?? '');
  if (charCount(s) <= max) return s;
  const cps = [...s];
  let lo = 0, hi = cps.length;
  while (lo < hi) { // largest k with charCount(first k code points) <= max
    const mid = Math.ceil((lo + hi) / 2);
    if (charCount(cps.slice(0, mid).join('')) <= max) lo = mid;
    else hi = mid - 1;
  }
  // Never end on a lone combining mark's base without its marks: extend while the next code point joins.
  let out = cps.slice(0, lo).join('');
  for (let k = lo; k < cps.length; k++) {
    const next = out + cps[k];
    if (charCount(next) > charCount(out)) break;
    out = next;
  }
  return out;
}
