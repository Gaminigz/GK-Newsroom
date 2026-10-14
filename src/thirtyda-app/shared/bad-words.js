// 30+DA bad words (store policy, owner 2026-10-14: Apple 1.2 / Google Play UGC): sexual words, slurs, rude or
// threatening words, and money / escort words, in English, Khmer, Chinese, Korean and Japanese. Contact details have
// their own detector (rules.js); these lists stop the rest. rules.js imports this file and uses it for the app name,
// the real name, the written lines and the chat (findBadWords, checkAppName, checkRealName, checkWrittenQuestion,
// checkChatMessage). Imported by the server AND served to the browser unchanged, so: plain ES module, no Node imports,
// no DOM, and no regex lookbehind (older iOS Safari cannot even parse it).
//
// Everyday words must never be stopped, so:
//  - An English entry is a whole word (an "s" may follow: "boob" → "boobs"), unless marked with "*": "*shit" may end a
//    longer word ("bullshit"), "porn*" may run on ("porno"), "*fuck*" both. So "sex" stops "sex" but not "Sussex",
//    "sexist" or "sextant"; "cock" not "cocktail"; "cum" not "cucumber"; "rape" not "grape".
//    Phrases ("sugar daddy") also match joined ("sugar-daddy") or, when both words have 3+ letters, run together
//    ("sugardaddy"; but "go die" never "goodie").
//  - Look-alike spellings are read too: f*ck, fuuuck, sh1t, p0rn, s3x, f u c k, f.u.c.k. A word needs more real letters
//    than stand-ins, so "a55" (a phone) is not "ass".
//  - Khmer, Chinese, Korean and Japanese run words together, so their entries match inside the text. They are phrases
//    that only ever mean the bad thing: 做爱 but never 爱; 섹스 but not 보지 ("don't look"). Katakana entries stand
//    alone as a word: エッチ but not エッチング (etching), フェラ but not フェラーリ. Khmer entries start and end on a
//    syllable edge. An entry may list what must not come right after it: ['<시발', ['점', '역']] (시발점 = starting
//    point), and '<' makes it start a word ('<씨발' is not 민수씨 + 발음, "Minsu's pronunciation").
//  - Left out on purpose: bare everyday words that are also insults or slang — dog, pig, crazy, stupid, die, money,
//    "kill you", anal ("a bit anal"), kinky (hair), dtf (a printing method), ឆ្កែ, ជ្រូក, 小姐, 上床, 包夜 (a night at
//    an internet café), 自慰 ("console oneself"), 你妈的 ("your mum's"), 걸레 (a mop), 꺼져 (switched off), バカ, クソ,
//    天カス; and names that some people really have (Fuk, Choy, Van Dyke, チョン). Money is stopped only as a direct ask
//    ("send me money", 给我打钱, 돈 보내줘): "I send money to my parents" is everyday talk in every language.
//
// The lists were written by the team, not a native-speaker panel: add to them as the admin sees new words.

export const BAD_WORD_CATEGORIES = Object.freeze(['sexual', 'slur', 'harassment', 'money']);

/** The admin's words for a stopped text (used verbatim as the flag reason; the first hit decides). */
export const BAD_WORD_REASONS = Object.freeze({
  sexual: 'Sexual words',
  slur: 'Slur',
  harassment: 'Rude or threatening words',
  money: 'Money or escort words',
});

export const BAD_WORDS = Object.freeze({
  sexual: {
    en: [
      'sex', 'sexy', 'sext', 'sexting', 'sex chat', 'sex cam', 'sex video', 'sex tape', 'sex toy', 'horny', 'porn*',
      'nudes', 'nude pic', 'nude photo', 'naked pic', 'naked photo', 'dick pic', 'boob', 'boobies', 'tits', 'titties',
      'penis', 'vagina', 'pussy', 'pussies', 'cock', 'cocksucker', 'dick', 'clit', 'dildo', 'cum', 'cumshot*',
      'creampie*', 'blowjob*', 'blow job', 'handjob*', 'rimjob*', 'deepthroat*', 'orgasm*', 'orgy', 'orgies',
      'masturbat*', 'jerk off', 'jack off', 'gangbang*', 'threesome', 'milf', 'bdsm', 'nsfw', 'erotic*', 'fwb',
      'friends with benefits', 'one night stand', 'hookup', 'onlyfans', 'slut*', 'whore*',
    ],
    km: [
      'រួមភេទ', 'រឿងសិច', 'សិចស៊ី', 'សិចសុី', 'អាសអាភាស', 'ប្រដាប់ភេទ',
    ],
    zh: [
      '做爱', '做愛', '性交', '性爱', '性愛', '约炮', '約炮', '打炮', '炮友', '床伴', '口交', '肛交', '手淫',
      '色情', '黄片', '黃片', 'a片', '裸照', '鸡巴', '雞巴', '阴茎', '陰莖', '阴道', '陰道', '屄', '肏', '骚货', '騷貨',
      '淫荡', '淫蕩', '淫秽', '淫穢', '一夜情', '奶子', '啪啪啪',
    ],
    ko: [
      '섹스', '섹파', ['<야동', ['네']], '좆', '성관계', '원나잇', '원나이트', '오르가즘', '꼴려', '씹할',
    ],
    ja: [
      'セックス*', 'エッチ', 'エロ', 'セフレ', 'ヤリマン', 'ヤリチン', 'フェラ', 'ヌード', 'オナニー', 'ワンナイト*', 'ラブホ*',
      'ちんこ', 'ちんぽ', 'まんこ', 'おっぱい', '中出し', '手コキ', '体の関係', '体目的', '裸の写真',
    ],
  },
  slur: {
    en: [
      'nigger', 'nigga', 'niggaz', 'faggot', 'fag', 'retard', 'retarded', 'tranny', 'trannies', 'kike', 'spic', 'gook',
      'paki', 'wetback', 'shemale',
    ],
    km: ['ខ្ទើយ'],
    zh: ['黑鬼', '支那人', '支那猪', '支那豬', '脑残', '腦殘', '弱智'],
    ko: ['병신', 'ㅄ', '짱깨', '쪽바리', '깜둥이', '똥남아'],
    ja: ['ガイジ', '黒んぼ', '支那人'],
  },
  harassment: {
    en: [
      '*fuck*', 'fck*', 'fcuk*', 'phuck*', 'fuking', 'fukin', 'stfu', 'gtfo', '*shit', 'shitty', 'shithead', 'bitch*',
      'cunt', 'bastard', 'ass', 'asshole', 'arsehole', 'dumbass', 'jackass', 'wanker', 'wank*', 'twat', 'douchebag',
      'kill yourself', 'kill urself', 'kys', 'go die', 'rape', 'raped', 'raping', 'rapist',
    ],
    km: [
      'ចុយ', 'អាចង្រៃ', 'មេចង្រៃ', 'ទៅងាប់ទៅ', 'សម្លាប់ឯង',
    ],
    zh: [
      '傻逼', '傻b', '傻屄', '煞笔', '他妈的', '他媽的', '操你妈', '操你媽', '肏你', '草你妈', '草你媽', '草泥马', '草泥馬',
      '妈逼', '媽逼', '王八蛋', '混蛋', '贱人', '賤人', '婊子', '去死吧', '滚蛋', '滾蛋', '杀了你', '殺了你',
      '狗娘养的', '狗娘養的',
    ],
    ko: [
      '<씨발', '<씨팔', ['<시발', ['점', '역']], 'ㅅㅂ', '개새끼', '개새기', '개색기', '개색끼', '닥쳐', '미친놈', '미친년',
      '썅년', '엿 먹어', '지랄', '죽여 버',
    ],
    ja: [
      ['死ね', ['る', 'ない', 'ば', 'ます', 'ず']], 'ぶっ殺', '殺すぞ', 'ブス', 'キモい', 'キモ', 'クソ野郎', 'くそ野郎', '消えろ',
    ],
  },
  money: {
    en: [
      'escort service', 'escort girl', 'escort lady', 'escort agency', 'call girl', 'hooker', 'prostitut*', 'brothel',
      'pimp', 'sugar daddy', 'sugar baby', 'sugar babies', 'sugar mommy', 'sugar mummy', 'paid sex', 'pay for sex',
      'send me money', 'lend me money', 'loan me money', 'western union', 'moneygram', 'usdt', 'bitcoin', 'crypto', 'cryptocurrenc*',
      'forex', 'binance',
    ],
    km: ['ពេស្យា', 'លក់ខ្លួន'],
    zh: [
      '援交', '援助交际', '援助交際', '包养', '包養', '卖淫', '賣淫', '妓女', '嫖', '外围女', '外圍女', '陪睡',
      '给我打钱', '給我打錢', '打钱给我', '打錢給我', '转账给我', '轉帳給我', '转帐给我', '比特币', '比特幣', '虚拟币',
      '虛擬幣',
    ],
    ko: [
      '조건만남', '원조교제', '성매매', '출장마사지', '출장안마', '애인대행', '창녀', '돈 보내줘', '돈 좀 보내줘',
      ['돈 빌려줘', ['서']], '송금해줘', '비트코인',
    ],
    ja: [
      'パパ活', 'ママ活', '援交', '援助交際', '売春', '買春', '風俗嬢', 'デリヘル', ['お金貸して', ['くれた', 'もらっ', 'あげ']],
      ['お金を貸して', ['くれた', 'もらっ', 'あげ']], 'ビットコイン', '仮想通貨',
    ],
  },
});

// ---------------------------------------------------------------------------
// Matching. Runs over the text as rules.js folds it (lower case, full-width / accented / look-alike letters made
// plain, digits of every script made 0-9, invisible characters gone) and returns where each hit is in that folded text.

// The characters a letter may be typed as. '*' stands for a hidden vowel (f*ck, sh*t).
const STAND_INS = { a: '@4*', b: '8', e: '3*', g: '9', i: '1!|l*', l: '1|i', o: '0*', s: '5$', t: '7', u: 'v*' };
// Between the words of a phrase ("sugar-daddy"), and between real letters typed one by one ("f u c k", "f.u.c.k").
const SEP = "[\\s._\\-*'~+,/|]";
const SPACED_SEP = '[\\s._\\-*]';
const KATAKANA = /[\u30a0-\u30ff]/;
const KHMER = /[\u1780-\u17ff]/;
const KHMER_DEPENDENT = /[\u17b6-\u17d3\u17dd]/; // a vowel, sign or subscript glued on: the syllable goes on
const COENG = '\u17d2';
const HAN_OR_KANA = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const isLatin = (c) => c !== undefined && c >= 'a' && c <= 'z';

const escapeClass = (s) => s.replace(/[\]\\^-]/g, '\\$&');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const letterClass = (c) => (STAND_INS[c] ? `[${escapeClass(c + STAND_INS[c])}]` : escapeRe(c));

function latinMatchers(word, category) {
  const inside = word.startsWith('*');
  const runOn = word.endsWith('*');
  const core = word.replace(/^\*|\*$/g, '');
  const parts = core.split(' ');
  // A letter may be held down ("fuuuck", "sexxx": 3 or more of it) but never just doubled, which makes real words:
  // "poorness" is not "porn", "rapping" is not "raping".
  let group = 0;
  const held = (c) => {
    group++;
    return `(${letterClass(c)})(?:\\${group}\\${group}+)?`;
  };
  // Phrase words may run together ("sugardaddy") only where both sides have 3+ letters: "go die" is never "goodie".
  const compact = parts.map((p, k) => {
    const letters = [...p].map(held).join('');
    if (k === 0) return letters;
    return `${SEP}${p.length >= 3 && parts[k - 1].length >= 3 ? '*' : '+'}${letters}`;
  }).join('');
  const out = [{ re: new RegExp(`${compact}${runOn ? '' : 's?'}`, 'g'), category, left: !inside, right: !runOn, latin: true }];
  // Real letters typed one by one with a space, dot or dash between each ("s e x", "f.u.c.k"): a single word of 3+
  // letters. No stand-ins here, so "A's 5" is not "a s s".
  if (parts.length === 1 && core.length >= 3) {
    out.push({ re: new RegExp([...core].join(`${SPACED_SEP}+`), 'g'), category, left: true, right: true, latin: true });
  }
  return out;
}

function scriptMatcher(entry, category) {
  const [raw, notBefore = []] = Array.isArray(entry) ? entry : [entry];
  const wordStart = raw.startsWith('<'); // must start a word: '<씨발' is not the end of 민수씨 + 발음 ("pronunciation")
  const leftOpen = raw.startsWith('*');
  const rightOpen = raw.endsWith('*');
  const word = raw.replace(/^[*<]|\*$/g, '').normalize('NFKC').toLowerCase();
  const chars = [...word];
  // Chinese and Japanese never put spaces inside a word, so a space or a symbol typed into one is read through
  // ("做 爱", "セッ*クス"); Korean and Khmer only where the entry itself has a space.
  const body = chars.map((c, i) => {
    if (c === ' ') return '\\s*';
    const next = chars[i + 1];
    const gap = next !== undefined && next !== ' ' && HAN_OR_KANA.test(c) && HAN_OR_KANA.test(next) ? '[\\s*_~\\-]{0,2}' : '';
    return escapeRe(c) + gap;
  }).join('');
  return {
    re: new RegExp(body, 'g'),
    category,
    first: chars[0],
    last: chars[chars.length - 1],
    wordStart,
    leftOpen,
    rightOpen,
    notBefore: notBefore.map((s) => s.normalize('NFKC').toLowerCase()),
  };
}

const MATCHERS = [];
for (const category of BAD_WORD_CATEGORIES) {
  for (const list of Object.values(BAD_WORDS[category])) {
    for (const entry of list) {
      const text = Array.isArray(entry) ? entry[0] : entry;
      if (/^\*?[a-z]/.test(text) && !/[^a-z *]/.test(text)) MATCHERS.push(...latinMatchers(text, category));
      else MATCHERS.push(scriptMatcher(entry, category));
    }
  }
}

// More real letters than stand-ins (digits, symbols): "sh1t" and "s3x" count, "a55" does not.
function lettersWin(match) {
  let letters = 0, standIns = 0;
  for (const c of match) {
    if (isLatin(c)) letters++;
    else if (!/[\s._\-'~+,/]/.test(c)) standIns++;
  }
  return letters > standIns;
}

function accepts(m, t, fs, fe) {
  if (m.latin) {
    if (m.left && isLatin(t[fs - 1])) return false;
    if (m.right && isLatin(t[fe])) return false;
    return lettersWin(t.slice(fs, fe));
  }
  const prev = t[fs - 1], next = t[fe];
  if (isLatin(m.first) && isLatin(prev)) return false; // "a片" is not the end of "data片"
  if (m.wordStart && prev !== undefined && /\p{L}/u.test(prev)) return false;
  if (isLatin(m.last) && isLatin(next)) return false;
  if (!m.leftOpen && KATAKANA.test(m.first) && prev !== undefined && KATAKANA.test(prev)) return false;
  if (!m.rightOpen && KATAKANA.test(m.last) && next !== undefined && KATAKANA.test(next)) return false;
  if (KHMER.test(m.first) && prev === COENG) return false;
  if (KHMER.test(m.last) && next !== undefined && KHMER_DEPENDENT.test(next)) return false;
  return !m.notBefore.some((s) => t.startsWith(s, fe));
}

/**
 * Bad words in a FOLDED text (rules.js fold().low) → [{ category, fs, fe }] by position, overlaps resolved (the longer
 * hit wins). rules.js findBadWords maps them back onto what was typed.
 */
export function badWordSpans(t) {
  const found = [];
  for (const m of MATCHERS) {
    m.re.lastIndex = 0;
    for (let x; (x = m.re.exec(t));) {
      const fs = x.index, fe = fs + x[0].length;
      if (fe > fs && accepts(m, t, fs, fe)) found.push({ category: m.category, fs, fe });
      else m.re.lastIndex = fs + 1; // a rejected start never hides a good match inside it
    }
  }
  const kept = [];
  for (const h of found.sort((a, b) => (b.fe - b.fs) - (a.fe - a.fs) || a.fs - b.fs)) {
    if (!kept.some((k) => h.fs < k.fe && k.fs < h.fe)) kept.push(h);
  }
  return kept.sort((a, b) => a.fs - b.fs);
}
