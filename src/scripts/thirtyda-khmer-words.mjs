#!/usr/bin/env node
// Writes src/thirtyda-app/shared/khmer-words.js: the Khmer words of 30+DA's own long phrases, as ICU's Khmer
// dictionary (Node's — the server's, and iPhone's) cuts them. shared/khmer.js keeps each of them whole when a long
// phrase has to break, so Chrome / Android (whose own dictionary cuts much finer: ផ្ទៀង|ផ្ទាត់, បោក|ប្រាស់) break our
// lines where iPhone and the server do. Run it after Khmer strings change:  node src/scripts/thirtyda-khmer-words.mjs
// A word missing from the list only means Chrome may cut it where its dictionary does (as before the list).
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEEP_WHOLE, khmerClusters } from '../thirtyda-app/shared/khmer.js';

const root = fileURLToPath(new URL('../../', import.meta.url)); // the folder may have a space in its name
const SOURCES = ['src/thirtyda-app', 'src/lib/thirtyda-pages.mjs'];
const SKIP = /(?:\.test\.mjs|khmer-words\.js|board[\\/]demo\.js)$/;
const KHMER = /[\u1780-\u17FF]/;

function files(path) {
  const full = join(root, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

// Every string literal with Khmer in it, cut into phrases at spaces and zero-width spaces.
const phrases = new Set();
for (const file of SOURCES.flatMap(files).filter((f) => /\.(m?js)$/.test(f) && !SKIP.test(f))) {
  const src = readFileSync(join(root, file), 'utf8');
  for (const m of src.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?[\u1780-\u17FF](?:(?!\1)[^\\]|\\.)*)\1/g)) {
    for (const phrase of m[2].replace(/\\u200b/gi, ' ').replace(/\u2060/g, '').split(/[\s\u200B]+/)) if (KHMER.test(phrase)) phrases.add(phrase);
  }
}

const segmenter = new Intl.Segmenter('km', { granularity: 'word' });
const words = new Set();
for (const phrase of phrases) {
  if (khmerClusters(phrase) <= KEEP_WHOLE) continue;
  for (const { segment, isWordLike } of segmenter.segment(phrase)) {
    if (isWordLike && /^[\u1780-\u17FF]+$/.test(segment) && khmerClusters(segment) >= 2) words.add(segment);
  }
}
const list = [...words].sort();

const lines = [];
let line = '';
for (const w of list) {
  const item = `'${w}',`;
  if (line && line.length + item.length > 116) { lines.push(line); line = ''; }
  line += (line ? ' ' : '') + item;
}
if (line) lines.push(line);
writeFileSync(join(root, 'src/thirtyda-app/shared/khmer-words.js'), `// Written by src/scripts/thirtyda-khmer-words.mjs — do not edit by hand. The Khmer words of 30+DA's own long phrases,
// as ICU's Khmer dictionary (Node / iPhone) cuts them: shared/khmer.js never breaks a line inside one of these.
// Plain ES module, served to the browser unchanged.
export const KHMER_WORDS = [
${lines.map((l) => `  ${l}`).join('\n')}
];
`);
console.log(`${list.length} words from ${phrases.size} phrases`);
