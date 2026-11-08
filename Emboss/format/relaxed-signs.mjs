// Relaxed braille, task 1 (A91): the catalogue of UEB contractions, the splitting of one word's braille into signs, and the naming
// of each sign. Pure: no DOM, no settings, no table loading; works in Node and the browser. The caller passes in `translatePos`.
//
// Relaxed braille = UEB that uses only the contractions a reader has learned. The method (Relaxed_Braille.md, Paul 3 Oct 2026):
// translate each word in full contracted UEB, split its braille into signs, and spell out any contraction the reader's profile
// does not hold. THIS file does the first half only: it finds which signs a word's braille is made of. Spelling out is a later task.
//
// THE CATALOGUE comes from Paige Learn's signs.js (`window.LEARN_SIGNS`): the nine contraction groups, with Learn's group ids and
// labels. Not taken: "Letters (a-z)" and "Punctuation & Indicators" - decision A, only contractions can be switched off.
//
// KEY SCHEME. Learn keys a sign by its print text, and the same print text recurs in two groups ("ch" is a groupsign in
// strong_contractions, "child" the wordsign for the same cell; "enough"/"en"; "in"). A key here is `<group id>:<print>`,
// e.g. `strong_contractions:ch`, `strong_contraction_wordsigns:child`, `shortforms:children`. That is unique across the whole
// catalogue (a test checks it) and tells a caller the group without a lookup. Learn's own bare key is kept as `learnKey`.
//
// Every cell of Learn's table is held twice: `braille` (Unicode, as Learn has it) and `brf` (BRF ASCII, the form Emboss's
// translators output). `wholeWord` is Learn's flag: the sign is valid only standing for a whole word (alphabetic wordsigns,
// the strong-contraction wordsigns, lower wordsigns, shortforms).

import { unicodeBrailleToBrf, brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

// ---- the catalogue (ported from Paige Learn signs.js; cells copied unchanged) -----------------------------------------------

const ALPHABETIC_WORDSIGNS = {
  but: '⠃', can: '⠉', do: '⠙', every: '⠑', from: '⠋', go: '⠛', have: '⠓', just: '⠚',
  knowledge: '⠅', like: '⠇', more: '⠍', not: '⠝', people: '⠏', quite: '⠟', rather: '⠗',
  so: '⠎', that: '⠞', us: '⠥', very: '⠧', will: '⠺', it: '⠭', you: '⠽', as: '⠵',
};
const STRONG_WORDSIGNS = { and: '⠯', for: '⠿', of: '⠷', the: '⠮', with: '⠾' };
const STRONG_CONTRACTIONS = {
  ch: '⠡', gh: '⠣', sh: '⠩', th: '⠹', wh: '⠱', ed: '⠫', er: '⠻', ou: '⠳', ow: '⠪',
  st: '⠌', ar: '⠜', ing: '⠬',
};
const STRONG_CONTRACTION_WORDSIGNS = { child: '⠡', shall: '⠩', this: '⠹', which: '⠱', out: '⠳', still: '⠌' };
const LOWER_WORDSIGNS = { be: '⠆', enough: '⠢', were: '⠶', his: '⠦', was: '⠴' };
// `be` here is the groupsign at the beginning of a word ("begin", "become"), beside con and dis; the whole word "be" is the lower
// wordsign. Two signs, so a profile can hold one without the other (Paul, 3 Oct 2026: N1 — added to Learn's catalogue too).
const LOWER_CONTRACTIONS = {
  ea: '⠂', bb: '⠆', cc: '⠒', ff: '⠖', gg: '⠶', en: '⠢', in: '⠔', be: '⠆', con: '⠒', dis: '⠲',
};
const INITIAL_CONTRACTIONS = {
  day: '⠐⠙', ever: '⠐⠑', father: '⠐⠋', here: '⠐⠓', know: '⠐⠅', lord: '⠐⠇', mother: '⠐⠍',
  name: '⠐⠝', one: '⠐⠕', part: '⠐⠏', question: '⠐⠟', right: '⠐⠗', some: '⠐⠎', time: '⠐⠞',
  under: '⠐⠥', work: '⠐⠺', young: '⠐⠽', there: '⠐⠮', character: '⠐⠡', through: '⠐⠹',
  where: '⠐⠱', ought: '⠐⠳', upon: '⠘⠥', word: '⠘⠺', these: '⠘⠮', those: '⠘⠹', whose: '⠘⠱',
  cannot: '⠸⠉', had: '⠸⠓', many: '⠸⠍', spirit: '⠸⠎', world: '⠸⠺', their: '⠸⠮',
};
const FINAL_CONTRACTIONS = {
  ound: '⠨⠙', ance: '⠨⠑', sion: '⠨⠝', less: '⠨⠎', ount: '⠨⠞',
  ence: '⠰⠑', ong: '⠰⠛', ful: '⠰⠇', tion: '⠰⠝', ness: '⠰⠎', ment: '⠰⠞', ity: '⠰⠽',
};
const SHORTFORMS = {
  about: '⠁⠃', above: '⠁⠃⠧', according: '⠁⠉', across: '⠁⠉⠗', after: '⠁⠋',
  afternoon: '⠁⠋⠝', afterward: '⠁⠋⠺', again: '⠁⠛', against: '⠁⠛⠌', almost: '⠁⠇⠍',
  already: '⠁⠇⠗', also: '⠁⠇', although: '⠁⠇⠹', altogether: '⠁⠇⠞', always: '⠁⠇⠺',
  because: '⠆⠉', before: '⠆⠋', behind: '⠆⠓', below: '⠆⠇', beneath: '⠆⠝', beside: '⠆⠎',
  between: '⠆⠞', beyond: '⠆⠽', blind: '⠃⠇', braille: '⠃⠗⠇', children: '⠡⠝',
  conceive: '⠒⠉⠧', conceiving: '⠒⠉⠧⠛', could: '⠉⠙', deceive: '⠙⠉⠧', deceiving: '⠙⠉⠧⠛',
  declare: '⠙⠉⠇', declaring: '⠙⠉⠇⠛', either: '⠑⠊', first: '⠋⠌', friend: '⠋⠗',
  good: '⠛⠙', great: '⠛⠗⠞', herself: '⠓⠻⠋', him: '⠓⠍', himself: '⠓⠍⠋', immediate: '⠊⠍⠍',
  its: '⠭⠎', itself: '⠭⠋', letter: '⠇⠗', little: '⠇⠇', much: '⠍⠡', must: '⠍⠌',
  myself: '⠍⠽⠋', necessary: '⠝⠑⠉', neither: '⠝⠑⠊', oneself: '⠐⠕⠋', ourselves: '⠳⠗⠧⠎',
  paid: '⠏⠙', perceive: '⠏⠻⠉⠧', perceiving: '⠏⠻⠉⠧⠛', perhaps: '⠏⠻⠓', quick: '⠟⠅',
  receive: '⠗⠉⠧', receiving: '⠗⠉⠧⠛', rejoice: '⠗⠚⠉', rejoicing: '⠗⠚⠉⠛', said: '⠎⠙',
  should: '⠩⠙', such: '⠎⠡', themselves: '⠮⠍⠧⠎', thyself: '⠹⠽⠋', today: '⠞⠙',
  together: '⠞⠛⠗', tomorrow: '⠞⠍', tonight: '⠞⠝', would: '⠺⠙', your: '⠽⠗',
  yourself: '⠽⠗⠋', yourselves: '⠽⠗⠧⠎',
};

// Learn names a sign by its print text; the groupsign "be" is "be-" there, as the whole word already has "be".
const LEARN_KEYS = { 'lower_contractions:be': 'be-' };
function makeGroup(id, label, table, wholeWord) {
  return {
    id, label,
    signs: Object.keys(table).map((print) => ({
      key: `${id}:${print}`, learnKey: LEARN_KEYS[`${id}:${print}`] || print, print,
      braille: table[print], brf: unicodeBrailleToBrf(table[print]),
      wholeWord: !!wholeWord, group: id,
    })),
  };
}

export const UEB_CONTRACTION_GROUPS = [
  makeGroup('alphabetic_wordsigns', 'Alphabetic Wordsigns', ALPHABETIC_WORDSIGNS, true),
  makeGroup('strong_wordsigns', 'Strong Wordsigns', STRONG_WORDSIGNS, false),
  makeGroup('strong_contractions', 'Strong Contractions', STRONG_CONTRACTIONS, false),
  makeGroup('strong_contraction_wordsigns', 'Strong Contraction Wordsigns', STRONG_CONTRACTION_WORDSIGNS, true),
  makeGroup('lower_wordsigns', 'Lower Wordsigns', LOWER_WORDSIGNS, true),
  makeGroup('lower_contractions', 'Lower Contractions', LOWER_CONTRACTIONS, false),
  makeGroup('initial_contractions', 'Initial Contractions', INITIAL_CONTRACTIONS, false),
  makeGroup('final_contractions', 'Final Contractions', FINAL_CONTRACTIONS, false),
  makeGroup('shortforms', 'Shortforms', SHORTFORMS, true),
];
// Learn has eleven groups; these are its nine CONTRACTION groups (the brief said ten but listed these nine). Left out: 'letters' and
// 'punctuation' (Punctuation & Indicators).

/** Every sign, flat. */
export const UEB_CONTRACTION_SIGNS = UEB_CONTRACTION_GROUPS.flatMap((g) => g.signs);
const BY_KEY = new Map(UEB_CONTRACTION_SIGNS.map((s) => [s.key, s]));
/** The sign with this catalogue key (`group:print`), or undefined. */
export function signByKey(key) { return BY_KEY.get(key); }

// lower-case print text -> every sign with that print (a print text can be in two groups only if the cells differ; none today)
const BY_PRINT = new Map();
for (const s of UEB_CONTRACTION_SIGNS) {
  if (!BY_PRINT.has(s.print)) BY_PRINT.set(s.print, []);
  BY_PRINT.get(s.print).push(s);
}

// ---- splitting a word's braille into signs ------------------------------------------------------------------------------------

/**
 * Split one word's braille into pieces, each paired with the print characters it stands for ("teacher" -> t | ea | ch | er).
 * The same splitting as `alignWord` in web/editor/editor.mjs (its main path), made pure.
 *
 *   translatePos(text) -> { braille (BRF ASCII), inputPos[] }  (louis.translatePos with the UEB grade 2 table does)
 *
 * liblouis's inputPos[i] is the index of the input character that output cell i came from; consecutive cells with the same
 * start are ONE piece (a contraction, or a shortform whose cells all start at the word's first letter). A piece's characters run
 * from its start to the next piece's start (the last one to the end of the word).
 * Returns [{ chars, cells (BRF), start, end }] (start/end index `word`).
 * If the positions are unusable it returns the whole word as ONE piece marked `approx: true` (nothing can be said about its parts).
 */
export function segmentWord(word, translatePos) {
  const text = String(word == null ? '' : word);
  if (!text) return [];
  let r = null;
  try { r = translatePos(text); } catch { r = null; }
  const b = r && typeof r.braille === 'string' ? r.braille : '';
  const pos = r && r.inputPos;
  const n = b.length;
  if (pos && n > 0 && pos.length >= n) {
    const segs = [];
    let j = 0;
    let ok = true;
    while (j < n) {
      const start = pos[j];
      if (!Number.isInteger(start) || start < 0 || start > text.length) { ok = false; break; }
      let k = j;
      while (k + 1 < n && pos[k + 1] === start) k++;
      let nextStart = text.length;
      if (k + 1 < n) nextStart = pos[k + 1];
      if (!Number.isInteger(nextStart) || nextStart < start || nextStart > text.length) { ok = false; break; }
      segs.push({ chars: text.slice(start, nextStart), cells: b.slice(j, k + 1), start, end: nextStart });
      j = k + 1;
    }
    if (ok && segs.length > 0) return segs;
  }
  return [{ chars: text, cells: b, start: 0, end: text.length, approx: true }];
}

// ---- naming each sign -------------------------------------------------------------------------------------------------------------

// Cells that can stand in FRONT of a sign in the same piece without being part of it (Unicode braille). Longest first.
//   capital letter ⠠, capital word ⠠⠠, capital passage ⠠⠠⠠; grade 1 symbol ⠰, word ⠰⠰, passage ⠰⠰⠰;
//   typeform symbol/word/passage indicators: italic ⠨ bold ⠘ underline ⠸ script ⠈ followed by ⠆ (symbol) ⠂ (word) ⠶ (passage).
const INDICATOR_RE = /^(?:⠠⠠⠠|⠠⠠|⠠|⠰⠰⠰|⠰⠰|⠰|[⠨⠘⠸⠈][⠆⠂⠶])/u;
// ... and after one: the terminators (capitals ⠠⠄, grade 1 ⠰⠄, typeform ⠨⠄ ⠘⠄ ⠸⠄ ⠈⠄), as in "PDFs", "TEACHERs", "ABc".
const TERMINATOR_RE = /^[⠠⠰⠨⠘⠸⠈]⠄/u;
const TRAILING_TERMINATORS_RE = /(?:[⠠⠰⠨⠘⠸⠈]⠄)+$/u;
const ONLY_TERMINATORS_RE = /^(?:[⠠⠰⠨⠘⠸⠈]⠄)+$/u;

// A piece of braille cells -> the places where the sign proper may begin: [{ at, prefix }], fewest indicator cells first.
function signStarts(uni) {
  const out = [{ at: 0, prefix: '' }];
  let at = 0;
  for (;;) {
    const m = INDICATOR_RE.exec(uni.slice(at));
    if (!m) break;
    at += m[0].length;
    out.push({ at, prefix: uni.slice(0, at) });
  }
  return out;
}

const NOT_WORD_RE = /^[^\p{L}\p{N}]*$/u;       // a piece with no letter or digit: punctuation / brackets / quotes

// What a plain letter, digit or apostrophe is in braille (Unicode). Used ONLY to take apart a piece that liblouis reports as one
// but which is really several signs (see `refinePiece`); letters and punctuation are never switched off.
const LETTER_CELLS = {
  a: '⠁', b: '⠃', c: '⠉', d: '⠙', e: '⠑', f: '⠋', g: '⠛', h: '⠓', i: '⠊', j: '⠚',
  k: '⠅', l: '⠇', m: '⠍', n: '⠝', o: '⠕', p: '⠏', q: '⠟', r: '⠗', s: '⠎', t: '⠞',
  u: '⠥', v: '⠧', w: '⠺', x: '⠭', y: '⠽', z: '⠵',
  '1': '⠁', '2': '⠃', '3': '⠉', '4': '⠙', '5': '⠑', '6': '⠋', '7': '⠛', '8': '⠓', '9': '⠊', '0': '⠚',
  "'": '⠄', '’': '⠄', '-': '⠤',
};
const NUMBER_SIGN = '⠼';

const MAX_PRINT = Math.max(...UEB_CONTRACTION_SIGNS.map((s) => s.print.length));   // the longest contraction print there is

/**
 * liblouis's inputPos sometimes gives SEVERAL signs one start position (a contraction was tried and refused, so the letters after
 * it share its start: "adherent" comes back as a | d | `herent` with the cells of h, er, en, t; "one" in "abandonee" is a piece
 * of three letters). A piece that matched no sign and holds more than one character is parsed against the catalogue instead:
 * its characters and cells are cut into catalogue signs and plain letters, longest sign first. Returns the sub-pieces, or null
 * if the piece cannot be explained exactly OR (unless `allowNoSign`) holds no contraction (then it stays one piece with sign null).
 */
function refinePiece(piece, allowNoSign) {
  const chars = [...(piece.chars || '')];
  if (chars.length < 2) return null;
  const uni = [...brfToUnicodeBraille(piece.cells || '')];
  const memo = new Map();
  // the terminator cells that may follow an item: j, j+2, j+4 ... (each a pair)
  const afterOptions = (j) => {
    const opts = [j];
    while (TERMINATOR_RE.test(uni.slice(opts[opts.length - 1]).join(''))) opts.push(opts[opts.length - 1] + 2);
    return opts;
  };
  // solve(i, j): parse chars[i..] with cells[j..]; returns the list of items or null
  const solve = (i, j) => {
    if (i === chars.length) return j === uni.length ? [] : null;
    const key = i * 4096 + j;
    if (memo.has(key)) return memo.get(key);
    let res = null;
    const starts = signStarts(uni.slice(j).join(''));
    outer:
    for (const st of starts) {
      const at = [...st.prefix].length;                    // indicator cells before the item
      const pre = st.prefix;
      const tryNext = (n, cl, sign, extraPre) => {
        for (const jEnd of afterOptions(j + at + cl)) {
          const rest = solve(i + n, jEnd);
          if (rest) return [{ ci: i, cn: n, cj: j, cl: jEnd - j, sign, pre: pre + (extraPre || '') }, ...rest];
        }
        return null;
      };
      for (let len = Math.min(MAX_PRINT, chars.length - i); len >= 1; len--) {   // a contraction here: longest first
        const cands = BY_PRINT.get(chars.slice(i, i + len).join('').toLowerCase());
        if (!cands) continue;
        for (const sign of [...cands].sort((x, y) => (x.wholeWord ? 1 : 0) - (y.wholeWord ? 1 : 0))) {   // inside a word: a groupsign before a wordsign with the same cells
          const cl = [...sign.braille].length;
          if (uni.slice(j + at, j + at + cl).join('') !== sign.braille) continue;
          const r = tryNext(len, cl, sign.key);
          if (r) { res = r; break outer; }
        }
      }
      const lc = LETTER_CELLS[chars[i].toLowerCase()];     // a plain letter / digit / apostrophe
      if (lc && uni[j + at] === lc) {
        const r = tryNext(1, 1, null);
        if (r) { res = r; break; }
      }
      if (/\d/.test(chars[i]) && uni[j + at] === NUMBER_SIGN && uni[j + at + 1] === lc) {   // a digit after its number sign
        const r = tryNext(1, 2, null, NUMBER_SIGN);
        if (r) { res = r; break; }
      }
    }
    memo.set(key, res);
    return res;
  };
  const items = solve(0, 0);
  if (!items || items.length < 2 || (!allowNoSign && !items.some((it) => it.sign))) return null;
  return items.map((it) => {
    const c = chars.slice(it.ci, it.ci + it.cn).join('');
    const offset = chars.slice(0, it.ci).join('').length;
    const cellsUni = uni.slice(it.cj, it.cj + it.cl).join('');
    const suffix = (TRAILING_TERMINATORS_RE.exec(cellsUni) || [''])[0];
    return {
      ...piece, chars: c, cells: unicodeBrailleToBrf(cellsUni),
      start: piece.start + offset, end: piece.start + offset + c.length, sign: it.sign,
      prefix: unicodeBrailleToBrf(it.pre), suffix: unicodeBrailleToBrf(suffix), refined: true,
    };
  });
}

// liblouis sometimes gives a terminator cell pair (⠠⠄) a piece of its own, attributed to the LAST letter of a contraction
// ("TEACHERs": er = E, then R = ⠠⠄). Fold such a piece into the one before it.
function foldTerminatorPieces(segs) {
  const out = [];
  for (const s of segs) {
    const uni = brfToUnicodeBraille(s.cells || '');
    if (out.length && ONLY_TERMINATORS_RE.test(uni)) {
      const prev = out[out.length - 1];
      out[out.length - 1] = { ...prev, chars: prev.chars + s.chars, cells: prev.cells + s.cells, end: s.end };
    } else out.push(s);
  }
  return out;
}

/**
 * Name the sign of each piece. Returns new pieces ({...piece, sign, prefix, suffix, whole}):
 *   sign   the catalogue key (`group:print`) when the piece is a contraction, else null (letters, punctuation, numbers, indicators).
 *   prefix the leading indicator cells in the piece (capital, grade 1, typeform) as BRF, '' when none - NOT part of the sign.
 *   suffix the trailing terminator cells (capitals / grade 1 / typeform terminator), as BRF, '' when none - NOT part of the sign.
 *   whole  true when the piece is the only piece of the word apart from surrounding punctuation ("(children)" -> children): a
 *          wordsign / shortform used for the whole word. False for a piece inside a longer word: a groupsign.
 * A piece is matched on its print letters (case-insensitive, exactly) AND its cells, so cells with several meanings are told apart
 * by their letters: ⠂ ea / comma, ⠆ bb / be / semicolon, ⠶ gg / were, ⠢ en / enough, ⠒ cc / con / colon, ⠲ dis / full stop,
 * ⠖ ff / exclamation, ⠦ his / question mark. The wholeWord flag of a sign is NOT enforced: liblouis also uses a shortform or a
 * wordsign at the start of a compound ("blindfast", "beatific" with be-), and a piece whose print letters and cells are exactly a
 * sign's IS that sign; `whole` tells the caller which use it is.
 * Two repairs of liblouis's positions: a lone terminator piece is folded into the piece before it, and a piece reported as several
 * signs at one position is taken apart (`refined: true` on the pieces made) - so the result can hold MORE pieces than `segments`
 * (never fewer, except for folded terminators). The pieces always tile the word: each `chars` is word.slice(start, end).
 */
export function identifySigns(word, segments) {
  const segs = foldTerminatorPieces(Array.isArray(segments) ? segments : []);
  // the "core" of the word: from the first to the last piece that holds a letter or digit (leading / trailing punctuation pieces excluded)
  let first = -1, last = -1;
  segs.forEach((s, i) => {
    if (!NOT_WORD_RE.test(s.chars || '')) { if (first < 0) first = i; last = i; }
  });
  const out = [];
  const isCore = [];                                       // parallel to `out`: did the piece come from the word's core?
  const push = (p, core) => { out.push(p); isCore.push(core); };
  segs.forEach((s, i) => {
    const inCore = first >= 0 && i >= first && i <= last;
    const whole = inCore && first === last;
    const uni = brfToUnicodeBraille(s.cells || '');
    const suffixUni = (TRAILING_TERMINATORS_RE.exec(uni) || [''])[0];
    const body = suffixUni ? uni.slice(0, uni.length - suffixUni.length) : uni;
    const starts = signStarts(body);
    const base = {
      ...s, sign: null, whole,
      prefix: unicodeBrailleToBrf(starts[starts.length - 1].prefix), suffix: unicodeBrailleToBrf(suffixUni),
    };
    if (inCore) {
      const cands = BY_PRINT.get((s.chars || '').toLowerCase());
      if (cands) {
        for (const st of starts) {
          const rest = body.slice(st.at);
          const same = cands.filter((c) => c.braille === rest);
          const sign = same.find((c) => !!c.wholeWord === !!whole) || same[0];   // "be": the wordsign alone, the groupsign in a word
          if (sign) { push({ ...base, sign: sign.key, prefix: unicodeBrailleToBrf(st.prefix) }, true); return; }
        }
      }
      const parts = refinePiece(s);
      if (parts) { for (const p of parts) push({ ...p, whole: false }, true); return; }
    }
    push(base, inCore);
  });
  // A mixed-case word can leave a contraction split across two pieces ("ARound": ar = A + the R that carries the terminator).
  // If a piece of the core is still unexplained (letters in print, but cells that are not those letters), parse the whole core at once.
  const a = isCore.indexOf(true), b = isCore.lastIndexOf(true);
  if (a >= 0 && out.slice(a, b + 1).some(unexplained)) {
    const core = out.slice(a, b + 1);
    const merged = {
      chars: core.map((p) => p.chars).join(''), cells: core.map((p) => p.cells).join(''),
      start: core[0].start, end: core[core.length - 1].end,
    };
    const parts = refinePiece(merged, true);
    if (parts) out.splice(a, b - a + 1, ...parts.map((p) => ({ ...p, whole: false })));
  }
  return out;
}

// A piece with print letters whose cells (less its indicators) are neither a catalogue sign nor those letters.
function unexplained(p) {
  if (p.sign || !p.chars) return false;
  const chars = [...p.chars.toLowerCase()];
  if (!chars.some((c) => /[a-z]/.test(c)) || !chars.every((c) => /[a-z'’-]/.test(c))) return false;
  const uni = brfToUnicodeBraille(p.cells || '');
  const body = uni.slice(brfToUnicodeBraille(p.prefix || '').length, uni.length - brfToUnicodeBraille(p.suffix || '').length);
  return body !== chars.map((c) => LETTER_CELLS[c]).join('');
}
