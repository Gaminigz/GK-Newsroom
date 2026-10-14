// khmerKeep: each Khmer phrase stays whole on a line (word joiners between its clusters), so lines break at the spaces
// between phrases; a phrase too long for any phone line breaks only between whole words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { khmerKeep, khmerPlain, khmerClusters, hasKhmer, WORD_JOINER, KEEP_WHOLE } from './khmer.js';
import { KHMER_WORDS } from './khmer-words.js';
import { KHMER_COMPOUNDS } from './khmer-compounds.js';
import { SYSTEM_QUESTIONS, SYSTEM_TOPICS, RETIRED_QUESTIONS, L1_ANSWERS, ROLES } from './questions.js';
import { PAGE_STRINGS } from '../../lib/thirtyda-pages.mjs';

const WJ = WORD_JOINER;
const COENG = String.fromCharCode(0x17d2);
const ZWSP = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);
const KHMER = /[\u1780-\u17ff\u19e0-\u19ff]/;
const MARK = /\p{M}/u;
const SPACE = /[\s\u200b]/;
const show = (s) => s.replaceAll(WJ, '·');
/** Every built-in Khmer line, topic, tap and job (what the admin's own lines look like). */
const questionLines = () => [
  ...Object.values(SYSTEM_QUESTIONS).flat(), ...Object.values(RETIRED_QUESTIONS).flat(), ...L1_ANSWERS, ...ROLES,
].map((q) => q.text.km).concat(Object.values(SYSTEM_TOPICS).flat().map((tp) => tp.km));

// The owner's report (2026-10-14, the rules screen at 390 px) and other lines a browser split mid-word.
const SAMPLES = [
  '30+DA គឺសម្រាប់ការណាត់ជួបដោយស្ងប់ស្ងាត់ និងស្មោះត្រង់។ សូមអាន ហើយយល់ព្រម។',
  'សូមមានចិត្តល្អ និងគោរពគ្នា។ គ្មានការស្អប់ខ្ពើម ការយាយី ឬការគំរាមកំហែង។',
  'គ្មានការសុំលុយ អំណោយ សេវាកំដរ ឬការណាត់ជួបដើម្បីលុយ គ្មានការបោកប្រាស់។',
  'ស្ត្រី', 'ក្ស្ម', 'បាទ/ចាស', 'ថ្ងៃនេះៗរវល់ច្រើន។', 'ពេលវេលាជាមួយគ្រួសារ ឬអាជីវកម្មនៅផ្ទះ',
  'រូបថតទី 2 បង្ហាញនៅពេលអ្នកដល់កម្រិត 2', `ប្រើ 30+DA បាន${ZWSP}ដោយ${ZWSP}ឥតគិតថ្លៃ`, '១២៣ ខែតុលា ២០២៦', 'អ៊ីមែល៖ gk.smart@ggmt.sg',
  'ដូច្នេះគ្មាននរណាផ្សេងអាចមើលការជជែករបស់អ្នកបានទេ។', 'ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។',
  'តើថ្ងៃនេះជាថ្ងៃស្ងប់ស្ងាត់សម្រាប់អ្នកទេ?', 'យើងរក្សាទុកលេខសម្គាល់ទូរស័ព្ទរបស់អ្នកជាទម្រង់កូដដែលអានមិនបាន',
];

/**
 * What khmerKeep put in front of each code point of the text: position → 'join' (a word joiner), 'open' (a zero-width
 * space: a long phrase's place to break between two words) or anything else it should never add.
 */
function added(text) {
  const kept = [...khmerKeep(text)];
  const cps = [...text];
  const at = new Map();
  let k = 0;
  for (let i = 0; i <= cps.length; i++) {
    while (k < kept.length && kept[k] !== cps[i]) {
      at.set(i, kept[k] === WJ ? 'join' : kept[k] === ZWSP ? 'open' : `other ${kept[k]}`);
      k++;
    }
    k++;
  }
  return at;
}
const joinsOf = (text) => new Set([...added(text)].filter(([, what]) => what === 'join').map(([i]) => i));

/** Where a browser could break between two characters of a phrase: next to Khmer, not inside a cluster. */
const breakable = (a, b) => (KHMER.test(a) || KHMER.test(b)) && !SPACE.test(a) && !SPACE.test(b) && a !== COENG && !MARK.test(b) && a !== NBSP && b !== NBSP;
const clustersOf = khmerClusters;
/** The text with "|" where a line may still break between Khmer characters (spaces aside), for the expectations. */
function marks(text) {
  const joined = joinsOf(text);
  const cps = [...text];
  return cps.map((ch, i) => (i && breakable(cps[i - 1], ch) && !joined.has(i) ? `|${ch}` : ch)).join('');
}

test('never inside a cluster: never after coeng, never in front of a vowel sign or other mark, only at grapheme boundaries', () => {
  const graphemes = new Intl.Segmenter('km', { granularity: 'grapheme' });
  for (const s of [...SAMPLES, ...SYSTEM_QUESTIONS[1].map((q) => q.text.km), ...ROLES.map((r) => r.text.km)]) {
    const kept = khmerKeep(s);
    assert.equal(khmerPlain(kept), khmerPlain(s), `${s}: only joiners and zero-width spaces added`);
    const cps = [...s];
    const bounds = new Set();
    let n = 0;
    for (const g of graphemes.segment(s)) { bounds.add(n); n += [...g.segment].length; }
    for (const [i, what] of added(s)) {
      assert.ok(what === 'join' || what === 'open', `${show(kept)}: added ${what}`);
      assert.ok(i > 0 && i < cps.length, `${show(kept)}: no joiner at either end`);
      assert.notEqual(cps[i - 1], COENG, `${show(kept)}: never after coeng (the subscript stays attached)`);
      assert.ok(!MARK.test(cps[i]), `${show(kept)}: never in front of a mark (U+${cps[i].codePointAt(0).toString(16)})`);
      assert.ok(bounds.has(i), `${show(kept)}: only at a grapheme boundary`);
      assert.ok(!SPACE.test(cps[i - 1]) && !SPACE.test(cps[i]), `${show(kept)}: never next to a space`);
    }
  }
  // The clusters, exactly: ស្មោះ | ត្រ | ង់ — the subscripts and vowel signs stay with their consonant.
  assert.equal(khmerKeep('ស្មោះត្រង់'), `ស្មោះ${WJ}ត្រ${WJ}ង់`);
  assert.equal(khmerKeep('ស្ត្រី'), 'ស្ត្រី', 'one cluster with two subscripts: nothing to join');
  assert.equal(khmerKeep('ការយាយី'), `កា${WJ}រ${WJ}យា${WJ}យី`);
});

test('a phrase that fits a line never breaks: the owner\'s three (ស្មោះ|ត្រង់, ការ|យាយី, ការ|ណាត់ជួប) and every short phrase', () => {
  for (const s of SAMPLES) {
    for (const phrase of s.split(/[\s\u200b]+/)) {
      if (clustersOf(phrase) > KEEP_WHOLE) continue;
      assert.ok(!marks(phrase).includes('|'), `${marks(phrase)}: whole`);
    }
  }
  assert.equal(marks('និងស្មោះត្រង់។'), 'និងស្មោះត្រង់។');
  assert.equal(marks('គ្មានការស្អប់ខ្ពើម ការយាយី'), 'គ្មានការស្អប់ខ្ពើម ការយាយី');
  assert.equal(marks('រូបថតខ្លួនឯង'), 'រូបថតខ្លួនឯង');
  // Counted in clusters, its punctuation aside: ស្មោះ ត្រ ង់ = 3; ឬ កា រ ណា ត់ ជួ ប ដើ ម្បី លុ យ = 11.
  assert.equal(khmerClusters('ស្មោះត្រង់។'), 3);
  assert.equal(khmerClusters('ឬការណាត់ជួបដើម្បីលុយ'), 11);
  // A space (or a zero-width space, "may break here") stays the place to break; nothing touches a no-break space.
  assert.equal(khmerKeep(`យើងពិនិត្យ${ZWSP}របាយការណ៍`), `យើ${WJ}ង${WJ}ពិ${WJ}និ${WJ}ត្យ${ZWSP}រ${WJ}បា${WJ}យ${WJ}កា${WJ}រ${WJ}ណ៍`);
  assert.equal(khmerKeep(`បង្ហាញនៅ${ZWSP}កម្រិត${NBSP}{n}`), `ប${WJ}ង្ហា${WJ}ញ${WJ}នៅ${ZWSP}ក${WJ}ម្រិ${WJ}ត${NBSP}{n}`);
  assert.equal(khmerKeep('បាទ/ចាស'), `បា${WJ}ទ${WJ}/${WJ}ចា${WJ}ស`, 'nor after a slash');
  assert.equal(khmerKeep('ប្រើ 30+DA។'), `ប្រើ 30+DA${WJ}។`, 'Latin keeps its own breaks; ។ stays with the word before it');
  for (const s of SAMPLES) assert.deepEqual(khmerKeep(s).split(' ').map(khmerPlain), s.split(' ').map(khmerPlain), `${s}: the spaces as they were`);
});

test('a phrase too long for a phone line breaks only between whole words — never after ការ / មិន / ឬ / ដើម្បី, never before ទេ, no scraps', () => {
  const words = new Intl.Segmenter('km', { granularity: 'word' });
  for (const s of SAMPLES) {
    for (const phrase of s.split(/[\s\u200b]+/)) {
      if (clustersOf(phrase) <= KEEP_WHOLE) continue;
      const wordStarts = new Map(); // position → the word before it
      let n = 0;
      let last = '';
      for (const w of words.segment(phrase)) { wordStarts.set(n, last); n += [...w.segment].length; last = w.segment; }
      const what = added(phrase);
      const cps = [...phrase];
      for (let i = 1; i < cps.length; i++) {
        if (!breakable(cps[i - 1], cps[i]) || what.get(i) === 'join') continue;
        // Every other place gets a zero-width space: a sure break in every engine, never left to its dictionary.
        assert.equal(what.get(i), 'open', `${marks(phrase)}: a zero-width space at ${i}`);
        assert.ok(wordStarts.has(i), `${marks(phrase)}: a break at ${i} is between two words`);
        const right = cps.slice(i).join('');
        assert.ok(clustersOf(right) >= 3, `${marks(phrase)}: no scrap left for the next line at ${i}`);
        assert.ok(!['ការ', 'សេចក្ដី', 'មិន', 'ត្រូវ', 'តើ', 'ឬ', 'និង', 'ដើម្បី', 'សម្រាប់', 'ដែល', 'របស់'].includes(wordStarts.get(i)), `${marks(phrase)}: not after ${wordStarts.get(i)}`);
        assert.ok(!/^(ទេ|ឡើយ|នេះ|នោះ|គ្នា)(?![\u1780-\u17ff])/.test(right), `${marks(phrase)}: not before a closing word`);
      }
    }
  }
  // As Node's ICU (the server's, and iOS's) splits them: between phrases inside the clause, never inside a word.
  assert.equal(marks('ឬការណាត់ជួបដើម្បីលុយ'), 'ឬការណាត់ជួប|ដើម្បីលុយ', 'ឬ and ដើម្បី go with the words after them');
  // As few as it takes: in front of a word that starts a part of the phrase (ជា, សម្រាប់, ដើម្បី, ដែល …), and inside
  // a stretch still longer than KEEP_WHOLE clusters, one more near its middle.
  assert.equal(marks('ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។'), 'ព័ត៌មានទំនាក់ទំនង|មិនត្រូវបាន|អនុញ្ញាតឡើយ។');
  assert.equal(marks('តើថ្ងៃនេះជាថ្ងៃស្ងប់ស្ងាត់សម្រាប់អ្នកទេ?'), 'តើថ្ងៃនេះ|ជាថ្ងៃស្ងប់ស្ងាត់|សម្រាប់អ្នកទេ?');
  assert.equal(marks('ដូច្នេះគ្មាននរណាផ្សេងអាចមើលការជជែករបស់អ្នកបានទេ។'), 'ដូច្នេះគ្មាន|នរណាផ្សេង|អាចមើល|ការជជែក|របស់អ្នកបានទេ។');
  // Never after ការ / មិន / កុំ, however long the stretch (the owner's ការ|យាយី): these stay whole.
  for (const s of ['ការជួញដូរមនុស្ស', 'ឬការគំរាមកំហែង។', 'និងការកេងប្រវ័ញ្ចលើកុមារ', 'កុំដាក់លេខទូរស័ព្ទ', 'សូមស្វាគមន៍ការត្រឡប់មកវិញ']) {
    assert.ok(!/(ការ|មិន|កុំ)\|/.test(marks(s)), marks(s));
  }
  // A short known word that only straddles two words protects nothing: សារ in ភាសា|របស់.
  assert.equal(marks('និងភាសារបស់អ្នកផងដែរ។'), 'និងភាសា|របស់អ្នកផងដែរ។');
  // No stretch of our own lines runs past LAST_RESORT (12) clusters without a place to break.
  for (const s of [...SAMPLES, ...Object.values(PAGE_STRINGS.km), ...questionLines()]) {
    for (const piece of khmerKeep(s).split(/[\s\u200b]+/)) assert.ok(clustersOf(piece) <= 12, `${show(khmerKeep(s)).replaceAll(ZWSP, '|')}: ${clustersOf(piece)} clusters with no place to break`);
  }
});

// Found in Chrome at 300–430 px (2026-10-14 review): ICU's own cuts had put a zero-width space inside these, so a line
// broke "…សារ·នី ‖ មួយ·ៗ…", "…អគ្គស្នងការ ‖ ដ្ឋាន…", "…ប្រហាក់ ‖ ប្រហែល…", "…ទទួល ‖ បាន…", "…នរណា ‖ ម្នាក់…", and the
// admin's / the question bank's "…ស្មោះ ‖ ត្រង់…", "…ចុង ‖ សប្តាហ៍…".
const COMPOUND_LINES = [
  'សារនីមួយៗត្រូវបានបកប្រែជាភាសារបស់អ្នក។', 'ស្គាល់នរណាម្នាក់បន្តិចម្ដងៗ', 'អ្នកសម្របសម្រួលរបស់យើងពិនិត្យរូបថតថ្មីនីមួយៗ',
  'ដូចជាអគ្គស្នងការដ្ឋាននគរបាលជាតិកម្ពុជា', 'ប្ដូរចំណុចប្រហាក់ប្រហែលទៅជាឈ្មោះតំបន់។', 'ចម្ងាយប្រហាក់ប្រហែល',
  'វាមិនដែលទទួលបានឈ្មោះរបស់អ្នកទេ។', 'បន្ទាប់មកយើងឈប់ទទួលបានវា។', 'មាននរណាម្នាក់កំពុងស្វែងរកអ្នកដែរ។',
  'តើអ្នកចង់ស្គាល់មនុស្សស្មោះត្រង់ម្នាក់ទេ?', 'ចុងសប្តាហ៍ត្រូវរៀបចំទុកមុន។', 'តើអ្នកចូលចិត្តចំណាយពេលចុងសប្ដាហ៍យ៉ាងដូចម្ដេច?',
  'តើអ្នកចូលចិត្តធ្វើអ្វីនៅចុងសប្តាហ៍ជាមួយក្រុមគ្រួសារ?', 'តើនៅកន្លែងអ្នកមានថ្ងៃចាំងទេ?', 'ខ្ញុំសប្បាយចិត្តណាស់ដែលបានស្គាល់អ្នក។',
  'អ្វីៗដែលចាត់ទុកកុមារជាវត្ថុផ្លូវភេទ', 'គណនីត្រូវហាមឃាត់ជារៀងរហូត', 'មានតែច្បាប់ចម្លងជាកូដដែលអានមិនបាន។',
  'យើងរក្សាទុកលេខសម្គាល់ទូរស័ព្ទរបស់អ្នកជាទម្រង់កូដដែលអានមិនបាន', 'ហើយម៉ាស៊ីនមេរបស់យើងបដិសេធអ្នកដែលមានអាយុក្រោម',
];

test('a compound is never cut: the hand-kept KHMER_COMPOUNDS, in our lines and in any other text', () => {
  const lines = [...COMPOUND_LINES, ...SAMPLES, ...Object.values(PAGE_STRINGS.km), ...questionLines()];
  let seen = 0;
  for (const line of lines) {
    const kept = khmerKeep(line);
    for (const word of KHMER_COMPOUNDS) {
      for (let at = line.indexOf(word); at >= 0; at = line.indexOf(word, at + 1)) {
        seen++;
        // The same words, in order, with nothing but joiners between their letters: no zero-width space inside.
        const inside = new RegExp([...word].join('\u2060?'));
        assert.match(kept, inside, `${show(kept).replaceAll(ZWSP, '|')}: ${word} whole`);
      }
    }
  }
  assert.ok(seen > 30, `${seen} compounds checked`);
  assert.equal(marks('សារនីមួយៗត្រូវបានបកប្រែជាភាសារបស់អ្នក។'), 'សារនីមួយៗ|ត្រូវបានបកប្រែ|ជាភាសា|របស់អ្នក។');
  assert.equal(marks('ដូចជាអគ្គស្នងការដ្ឋាននគរបាលជាតិកម្ពុជា'), 'ដូចជា|អគ្គស្នងការដ្ឋាន|នគរបាលជាតិ|កម្ពុជា');
  assert.equal(marks('ប្ដូរចំណុចប្រហាក់ប្រហែលទៅជាឈ្មោះតំបន់។'), 'ប្ដូរចំណុច|ប្រហាក់ប្រហែល|ទៅជាឈ្មោះតំបន់។');
  assert.equal(marks('តើអ្នកចង់ស្គាល់មនុស្សស្មោះត្រង់ម្នាក់ទេ?').includes('ស្មោះត្រង់'), true);
  assert.equal(marks('ចុងសប្តាហ៍ត្រូវរៀបចំទុកមុន។').startsWith('ចុងសប្តាហ៍'), true);
  for (const word of KHMER_COMPOUNDS) {
    assert.match(word, /^[\u1780-\u17ff]+$/, word);
    assert.ok(KHMER_WORDS.includes(word), `${word} is in KHMER_WORDS (run src/scripts/thirtyda-khmer-words.mjs)`);
  }
});

test('never a zero-width space in front of ៗ or other Khmer punctuation: a line never starts with ៗ', () => {
  const lines = [...COMPOUND_LINES, ...SAMPLES, ...Object.values(PAGE_STRINGS.km), ...questionLines(),
    'កុមារមិនអាចប្រើ 30+DA បានឡើយ។ អ្វីៗដែលចាត់ទុកកុមារជាវត្ថុផ្លូវភេទ', 'ស្គាល់គ្នាបន្តិចម្ដងៗជាភាសារបស់អ្នក',
    'ត្រូវលុបភ្លាមៗគណនីត្រូវហាមឃាត់', 'សំណួរងាយៗមួយចំនួនសម្រាប់អ្នកទាំងពីរ', 'ពេលនេះរវល់ៗច្រើនណាស់សម្រាប់ខ្ញុំ'];
  let opened = 0;
  for (const line of lines) {
    const kept = khmerKeep(line);
    opened += kept.split(ZWSP).length - 1;
    assert.ok(!/\u200b[\u17d4-\u17db]/.test(kept), `${show(kept).replaceAll(ZWSP, '|')}: no break before Khmer punctuation`);
  }
  assert.ok(opened > 100, `${opened} openings checked`);
});

test('idempotent: joined text comes back unchanged, a joiner already there is kept (never doubled)', () => {
  for (const s of SAMPLES) {
    const once = khmerKeep(s);
    assert.equal(khmerKeep(once), once, show(once));
    assert.ok(!once.includes(WJ + WJ));
  }
  // rules.js writes យល់ព្រម with its own joiner between យល់ and ព្រម.
  const own = `សូមអាន ហើយយល់${WJ}ព្រម។`;
  assert.equal(khmerKeep(own), `សូ${WJ}ម${WJ}អា${WJ}ន ហើ${WJ}យ${WJ}យ${WJ}ល់${WJ}ព្រ${WJ}ម${WJ}។`);
  // An author's joiner inside a long phrase holds even where the phrase could break.
  const long = 'ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។';
  const held = khmerKeep(long.replace('មិន', `${WJ}មិន`));
  assert.equal(khmerPlain(held), long);
  assert.ok(held.includes(`ង${WJ}មិ`));
});

test('text without Khmer is untouched (the same string); anything not a string comes back as it was', () => {
  for (const s of ['', 'Hello world', 'Safe and calm dating for 30+', '30+ 的安全、从容交友', '같은 실수를 반복하지 마세요.', '同じ過ちを、もう繰り返さない。',
    '👋🏽 hi', 'gk.smart@ggmt.sg', '{name} replied {n}/{total}']) {
    assert.equal(khmerKeep(s), s);
    assert.equal(hasKhmer(s), false);
  }
  for (const v of [null, undefined, 0, 42, true, ['ក'], { km: 'ក' }]) assert.equal(khmerKeep(v), v);
  // Mixed: only the Khmer phrase gets joiners; the others are exactly as they were.
  assert.equal(khmerKeep('Language · ភាសា · 语言 · 언어 · 言語'), `Language · ភា${WJ}សា · 语言 · 언어 · 言語`);
});

test('placeholders still fill: {name} is never split, so t() and the pages interpolate as before', () => {
  const kept = khmerKeep('{name} បានឆ្លើយ {n}/{total} ហើយ{name}ចង់ជជែក');
  const filled = kept.replace(/\{(\w+)\}/g, (m, k) => ({ name: 'Sophea', n: '2', total: '5' })[k] ?? m);
  assert.equal(khmerPlain(filled), 'Sophea បានឆ្លើយ 2/5 ហើយSopheaចង់ជជែក');
  assert.equal(kept.split('{name}').length, 3);
});

test('the built-in lines, topics, taps and jobs: every Khmer one joins cleanly and reads back unchanged without the joiners', () => {
  const all = [
    ...Object.values(SYSTEM_QUESTIONS).flat(), ...Object.values(RETIRED_QUESTIONS).flat(), ...L1_ANSWERS, ...ROLES,
  ].map((q) => q.text.km).concat(Object.values(SYSTEM_TOPICS).flat().map((tp) => tp.km));
  assert.ok(all.length > 40);
  for (const s of all) {
    assert.ok(hasKhmer(s), s);
    const kept = khmerKeep(s);
    assert.equal(khmerPlain(kept), s);
    assert.ok(![...kept].some((ch, i, cps) => (ch === WJ || ch === ZWSP) && (cps[i - 1] === COENG || MARK.test(cps[i + 1] || ''))), show(kept));
  }
});
