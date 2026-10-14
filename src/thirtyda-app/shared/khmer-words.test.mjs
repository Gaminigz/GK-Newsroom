// KHMER_WORDS (written by src/scripts/thirtyda-khmer-words.mjs): Chrome's word dictionary cuts much finer than Node's
// and iPhone's (ផ្ទៀង|ផ្ទាត់, ទំនាក់|ទំនង — measured in Chrome 155). With a segmenter that cuts like Chrome, a long
// phrase must still break only where Node / iPhone break it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KHMER_WORDS } from './khmer-words.js';
import { khmerKeep, khmerClusters, ZERO_WIDTH_SPACE } from './khmer.js';

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
    assert.ok(khmerClusters(w) >= 2, w);
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
