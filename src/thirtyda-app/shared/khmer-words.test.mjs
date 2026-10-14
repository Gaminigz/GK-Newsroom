// KHMER_WORDS (written by src/scripts/thirtyda-khmer-words.mjs): Chrome's word dictionary cuts much finer than Node's
// and iPhone's (ផ្ទៀង|ផ្ទាត់, ទំនាក់|ទំនង — measured in Chrome 155). With a segmenter that cuts like Chrome, a long
// phrase must still break only where Node / iPhone break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KHMER_WORDS } from './khmer-words.js';
import { khmerKeep, khmerClusters, ZERO_WIDTH_SPACE } from './khmer.js';
import { KHMER_COMPOUNDS } from './khmer-compounds.js';

const NodeSegmenter = Intl.Segmenter;
const CHROME_CUTS = {
  'ផ្ទៀងផ្ទាត់': ['ផ្ទៀង', 'ផ្ទាត់'],
  'ទំនាក់ទំនង': ['ទំនាក់', 'ទំនង'],
  'លេខទូរស័ព្ទ': ['លេខ', 'ទូរស័ព្ទ'],
  'ស្ងប់ស្ងាត់': ['ស្ងប់', 'ស្ងាត់'],
};
/** Node's segmenter, then each of CHROME_CUTS cut the way Chrome cuts it. */
class ChromeLikeSegmenter {
  constructor(locale, options) {
    this.inner = new NodeSegmenter(locale, options);
    this.words = options?.granularity === 'word';
  }

  * segment(text) {
    for (const part of this.inner.segment(text)) {
      const cut = this.words && CHROME_CUTS[part.segment];
      if (!cut) { yield part; continue; }
      let index = part.index;
      for (const piece of cut) {
        yield { segment: piece, index, input: text, isWordLike: true };
        index += piece.length;
      }
    }
  }
}

const LONG = [
  'ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។',
  'សូមផ្ទៀងផ្ទាត់លេខទូរស័ព្ទរបស់អ្នកជាមុនសិន។',
  'ការណាត់ជួបប្រកបដោយសុវត្ថិភាពនិងភាពស្ងប់ស្ងាត់',
];

test('KHMER_WORDS: sorted, no repeats, each a Khmer word of two clusters or more', () => {
  assert.ok(KHMER_WORDS.length > 100);
  assert.deepEqual(KHMER_WORDS, [...new Set(KHMER_WORDS)].sort());
  for (const w of KHMER_WORDS) {
    assert.match(w, /^[\u1780-\u17ff]+$/, w);
    assert.ok(khmerClusters(w) >= 2 || /\u17d7$/.test(w), w); // or a word with its ៗ (អ្វីៗ)
  }
  for (const w of Object.keys(CHROME_CUTS)) assert.ok(KHMER_WORDS.includes(w), `${w} is listed`);
});

test('a Chrome-like dictionary breaks our long phrases exactly where Node / iPhone do: never inside a listed word', async () => {
  const fake = new ChromeLikeSegmenter('km', { granularity: 'word' });
  assert.deepEqual([...fake.segment('ទំនាក់ទំនង')].map((p) => p.segment), ['ទំនាក់', 'ទំនង'], 'the stand-in cuts like Chrome');
  for (const phrase of LONG) assert.ok(khmerClusters(phrase) > 8, phrase);
  const asNode = LONG.map(khmerKeep);
  Intl.Segmenter = ChromeLikeSegmenter;
  try {
    const chrome = await import('./khmer.js?chrome-like');
    const asChrome = LONG.map(chrome.khmerKeep);
    assert.deepEqual(asChrome.map((s) => s.split(ZERO_WIDTH_SPACE).length), asNode.map((s) => s.split(ZERO_WIDTH_SPACE).length));
    assert.deepEqual(asChrome, asNode);
    for (const [i, s] of asChrome.entries()) {
      const shown = s.replaceAll(chrome.WORD_JOINER, '');
      for (const w of Object.keys(CHROME_CUTS)) if (LONG[i].includes(w)) assert.ok(shown.includes(w), `${w} whole in ${shown}`);
    }
  } finally {
    Intl.Segmenter = NodeSegmenter;
  }
});

/** The finest dictionary there could be: every Khmer cluster a word of its own (any cut a browser might make). */
class EveryClusterSegmenter {
  constructor(locale, options) {
    this.inner = new NodeSegmenter(locale, options);
    this.words = options?.granularity === 'word';
  }

  * segment(text) {
    for (const part of this.inner.segment(text)) {
      if (!this.words || !part.isWordLike || !/[\u1780-\u17ff]/.test(part.segment)) { yield part; continue; }
      const cps = [...part.segment];
      let index = part.index;
      let piece = cps[0];
      for (let i = 1; i <= cps.length; i++) {
        if (i === cps.length || (!/\p{M}/u.test(cps[i]) && cps[i - 1] !== '\u17d2')) {
          yield { segment: piece, index, input: text, isWordLike: true };
          index += piece.length;
          piece = '';
        }
        if (i < cps.length) piece += cps[i];
      }
    }
  }
}

// The hand-kept compounds (shared/khmer-compounds.js) hold whatever the dictionary: the review's lines, cut at every
// cluster, never break inside one of them.
test('KHMER_COMPOUNDS hold under any dictionary: cut at every cluster, the compounds still never break inside', async () => {
  const lines = [
    'សារនីមួយៗត្រូវបានបកប្រែជាភាសារបស់អ្នក។', 'ដូចជាអគ្គស្នងការដ្ឋាននគរបាលជាតិកម្ពុជា', 'ប្ដូរចំណុចប្រហាក់ប្រហែលទៅជាឈ្មោះតំបន់។',
    'វាមិនដែលទទួលបានឈ្មោះរបស់អ្នកទេ។', 'មាននរណាម្នាក់កំពុងស្វែងរកអ្នកដែរ។', 'តើអ្នកចង់ស្គាល់មនុស្សស្មោះត្រង់ម្នាក់ទេ?',
    'ចុងសប្តាហ៍ត្រូវរៀបចំទុកមុន។', 'តើអ្នកចូលចិត្តធ្វើអ្វីនៅចុងសប្តាហ៍ជាមួយក្រុមគ្រួសារ?', 'តើនៅកន្លែងអ្នកមានថ្ងៃចាំងទេ?',
    'ខ្ញុំសប្បាយចិត្តណាស់ដែលបានស្គាល់អ្នក។',
  ];
  const fake = new EveryClusterSegmenter('km', { granularity: 'word' });
  assert.deepEqual([...fake.segment('ស្មោះត្រង់')].map((p) => p.segment), ['ស្មោះ', 'ត្រ', 'ង់'], 'the stand-in cuts every cluster');
  Intl.Segmenter = EveryClusterSegmenter;
  try {
    const fine = await import('./khmer.js?every-cluster');
    for (const line of lines) {
      const kept = fine.khmerKeep(line);
      assert.ok(kept.includes(ZERO_WIDTH_SPACE), `${line}: long, so it opens somewhere`);
      for (const word of KHMER_COMPOUNDS) {
        if (!line.includes(word)) continue;
        assert.ok(kept.replaceAll(fine.WORD_JOINER, '').includes(word), `${kept.replaceAll(fine.WORD_JOINER, '').replaceAll(ZERO_WIDTH_SPACE, '|')}: ${word} whole`);
      }
      assert.ok(!/\u200b[\u17d4-\u17db]/.test(kept), `${line}: no break before ៗ`);
    }
  } finally {
    Intl.Segmenter = NodeSegmenter;
  }
});

// Chrome's own segments (measured in Chrome 155, 2026-10-14) glue a little word onto the next or cut one in two:
// "នៅជុំ|វិញ", "នោះផុត", "ជិតៗគឺ", "ចាកចេញពី". The near / around / this / that / is / from words still hold.
const CHROME_SEGMENTS = {
  'តើឥឡូវនេះនៅជុំវិញអ្នកមមាញឹកទេ?': ['តើ', 'ឥឡូវ', 'នេះ', 'នៅជុំ', 'វិញ', 'អ្នក', 'មមាញឹក', 'ទេ', '?'],
  'លេខកូដនោះផុតកំណត់ហើយ។ឥឡូវនេះ': ['លេខកូដ', 'នោះផុត', 'កំណត់', 'ហើយ', '។', 'ឥឡូវ', 'នេះ'],
  'កន្លែងជិតៗគឺល្អបំផុតសម្រាប់យើង': ['កន្លែង', 'ជិតៗគឺ', 'ល្អ', 'បំផុត', 'សម្រាប់', 'យើង'],
  'ការចាកចេញពីកម្មវិធីមិនលុបអ្វីទេ': ['ការ', 'ចាកចេញពី', 'កម្មវិធី', 'មិន', 'លុប', 'អ្វី', 'ទេ'],
};
class ChromeSegmenter {
  constructor(locale, options) {
    this.inner = new NodeSegmenter(locale, options);
    this.words = options?.granularity === 'word';
  }

  * segment(text) {
    const cut = this.words && CHROME_SEGMENTS[text];
    if (!cut) { yield* this.inner.segment(text); return; }
    let index = 0;
    for (const piece of cut) {
      yield { segment: piece, index, input: text, isWordLike: /[\u1780-\u17d3]/.test(piece) };
      index += piece.length;
    }
  }
}

test('Chrome\'s glued segments: still no break after near / around / is / from, nor before this / that', async () => {
  for (const [text, cut] of Object.entries(CHROME_SEGMENTS)) assert.equal(cut.join(''), text);
  Intl.Segmenter = ChromeSegmenter;
  try {
    const chrome = await import('./khmer.js?chrome-segments');
    const shown = (s) => chrome.khmerKeep(s).replaceAll(chrome.WORD_JOINER, '').replaceAll(ZERO_WIDTH_SPACE, '|');
    assert.ok(!shown('តើឥឡូវនេះនៅជុំវិញអ្នកមមាញឹកទេ?').includes('ជុំវិញ|'), shown('តើឥឡូវនេះនៅជុំវិញអ្នកមមាញឹកទេ?'));
    assert.ok(!shown('លេខកូដនោះផុតកំណត់ហើយ។ឥឡូវនេះ').includes('|នោះ'), shown('លេខកូដនោះផុតកំណត់ហើយ។ឥឡូវនេះ'));
    assert.ok(!shown('កន្លែងជិតៗគឺល្អបំផុតសម្រាប់យើង').includes('គឺ|'), shown('កន្លែងជិតៗគឺល្អបំផុតសម្រាប់យើង'));
    assert.ok(!shown('ការចាកចេញពីកម្មវិធីមិនលុបអ្វីទេ').includes('ពី|'), shown('ការចាកចេញពីកម្មវិធីមិនលុបអ្វីទេ'));
  } finally {
    Intl.Segmenter = NodeSegmenter;
  }
});
