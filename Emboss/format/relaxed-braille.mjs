// Relaxed braille, task 2 (A91): the relaxing step. Pure: no DOM, no settings, no table loading; works in Node and the browser.
//
// Relaxed braille = UEB contracted braille that uses only the contractions a reader has learned; every other contraction is spelled
// out in letters (Relaxed_Braille.md, Paul 3 Oct 2026). Method: translate the text in full contracted UEB as now (liblouis, with
// typeform, whole text, so every indicator is right), split each word's braille into signs (relaxed-signs.mjs), and replace each
// sign the profile does not hold by the letters it stands for. The liblouis tables are never changed. NOTHING calls this module
// yet: wiring it into the editor / Quick Mode / formatter is task 3.
//
//   relaxTranslation(text, { braille, inputPos }, allowed, { translatePos })
//     -> { braille, inputPos, spelledOut: [{ start, end, chars, sign, wordStart, wordEnd }], unresolved: [{ start, end, chars }] }
//
//   text        the string that was translated (with the SAME text, `translation` is what louis.translatePos(text, table, typeform)
//               returned: braille in BRF ASCII, one cell per character; inputPos[i] = index in `text` of the character cell i came from).
//   allowed     a Set of catalogue keys (`group:print`, UEB_CONTRACTION_SIGNS[i].key) the reader holds, or null / undefined = "All".
//               null, or a Set holding every key, returns the translation UNCHANGED and does no segmentation at all (fast path).
//   translatePos optional; only the fallback uses it (see below). Same call as louis.translatePos(word) with the UEB grade 2 table.
//   spelledOut  each sign spelled out: its characters in `text` ([start, end), original case), the catalogue key, and the whole
//               word's extent in `text` (wordStart/wordEnd) - what the status bar (decision I) and the "contractions left out"
//               report (decision H) need.
//   unresolved  words (or pieces) that could not be taken apart exactly; they are left as liblouis made them (contracted).
//
// WORDS are runs of non-white-space in `text`; punctuation attached to a word stays with it, as identifySigns expects. Each word's
// cells are cut out of the FULL translation (so capital passage, typeform and number indicators are as liblouis placed them), its
// positions re-based to the word, and handed to segmentWord / identifySigns.
//
// WHAT CHANGES: a piece whose `sign` is a catalogue key the profile does not hold becomes the BRF letters (A-Z) of its print
// characters. Its prefix (capital, grade 1, typeform indicators) and suffix (terminators) are kept exactly. A piece with sign null
// (letters, numbers, punctuation) is never touched. Grade 1 indicators are neither added nor removed (decision A).
//
// WORDS THAT CANNOT BE TAKEN APART. A word is "unexplained" when, after identifySigns (which already repairs liblouis's positions
// where it can), a piece of plain letters still has cells that are not those letters, or the pieces do not tile the word's cells.
// Then: (1) if `translatePos` was given, translate the word ALONE and use that if its cells are exactly the same cells as the
// word's cells in the full translation (so its positions can be trusted); (2) otherwise the word is left contracted and reported in
// `unresolved`. (The grade 1 table is not available to a pure module, so re-translating a word in grade 1 is not an option here.)
//
// New inputPos: a spelled-out letter points at its own character (word start + piece start + k); prefix and suffix cells keep the
// position liblouis gave them (clamped so positions never go backwards); every other cell is unchanged. Same length as `braille`.

import { UEB_CONTRACTION_SIGNS, signByKey, segmentWord, identifySigns } from './relaxed-signs.mjs';

const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);

/** True when `allowed` means "every contraction" (null, undefined, or a Set holding every catalogue key). */
export function allowsEverything(allowed) {
  if (allowed == null) return true;
  if (!(allowed instanceof Set)) allowed = new Set(allowed);        // an array of keys is accepted too
  if (allowed.size < ALL_KEYS.length) return false;
  for (const k of ALL_KEYS) if (!allowed.has(k)) return false;
  return true;
}

function unchanged(translation, unresolved) {
  const t = translation || {};
  return {
    braille: typeof t.braille === 'string' ? t.braille : '',
    inputPos: t.inputPos || [],
    spelledOut: [],
    unresolved: unresolved || [],
  };
}

const PLAIN_LETTERS_RE = /^[A-Za-z'’-]+$/;
const ASCII_LETTERS_RE = /^[A-Za-z]+$/;

// Is this piece of a word one that matched no sign but may still hide one? That is a piece of two or more characters with a letter in
// it, whose cells are not exactly its plain letters. (liblouis's positions are usually good, and then every multi-character piece
// with no sign is plain letters - "'s", "colonel", "non" - or punctuation; a piece like "it," is liblouis's positions failing.)
function isUnexplained(p) {
  if (p.sign || !p.chars || [...p.chars].length < 2 || !/[A-Za-z]/.test(p.chars)) return false;
  if (!PLAIN_LETTERS_RE.test(p.chars)) return true;           // letters mixed with punctuation or digits in ONE piece: cannot be told
  const cells = p.cells || '';
  const pre = (p.prefix || '').length, suf = (p.suffix || '').length;
  const body = cells.slice(pre, cells.length - suf);
  return body !== p.chars.toUpperCase().replace('’', "'");     // a-z in BRF ASCII are the upper-case letters; ' and - are themselves
}

// Do the pieces tile the word and hold exactly the word's cells?
function tilesWord(word, slice, pieces) {
  if (!pieces.length) return false;
  let pos = 0, cells = '';
  for (const p of pieces) {
    if (p.start !== pos || p.chars !== word.slice(p.start, p.end)) return false;
    pos = p.end;
    cells += p.cells;
  }
  return pos === word.length && cells === slice;
}

// -> { pieces } or { unresolved: [{start,end,chars}] } for one word. start/end are indexes into `word`.
function piecesOfWord(word, slice, sliceTP, aloneTP) {
  const pieces = identifySigns(word, segmentWord(word, sliceTP));
  const tiles = tilesWord(word, slice, pieces);
  if (tiles && !pieces.some(isUnexplained)) return { pieces, bad: [] };
  if (aloneTP) {
    const alone = identifySigns(word, segmentWord(word, aloneTP));
    if (tilesWord(word, slice, alone) && !alone.some(isUnexplained)) return { pieces: alone, bad: [] };
  }
  if (!tiles) return { pieces: null, bad: [{ start: 0, end: word.length, chars: word }] };
  return { pieces, bad: pieces.filter(isUnexplained).map((p) => ({ start: p.start, end: p.end, chars: p.chars })) };
}

/**
 * Spell out every contraction `allowed` does not hold. See the header of this file for the shape of the result.
 */
export function relaxTranslation(text, translation, allowed, options) {
  if (allowed != null && !(allowed instanceof Set)) allowed = new Set(allowed);
  if (allowsEverything(allowed)) {
    const t = translation || {};
    return { braille: t.braille, inputPos: t.inputPos, spelledOut: [], unresolved: [] };    // the very same values, nothing segmented
  }
  const str = String(text == null ? '' : text);
  const braille = translation && typeof translation.braille === 'string' ? translation.braille : '';
  const pos = translation && translation.inputPos;
  const translatePos = options && typeof options.translatePos === 'function' ? options.translatePos : null;
  if (!braille) return unchanged(translation);
  if (!pos || pos.length !== braille.length) {
    return unchanged(translation, [{ start: 0, end: str.length, chars: str }]);       // no positions: nothing can be said about any word
  }

  // which word does each character of the text belong to (-1: white space)
  const words = [];
  const owner = new Int32Array(str.length).fill(-1);
  for (const m of str.matchAll(/\S+/gu)) {
    for (let k = m.index; k < m.index + m[0].length; k++) owner[k] = words.length;
    words.push({ start: m.index, end: m.index + m[0].length, from: -1, to: -1, ok: true });
  }
  // the cells of each word: first / last cell whose position falls in the word
  for (let j = 0; j < braille.length; j++) {
    const p = pos[j];
    const w = Number.isInteger(p) && p >= 0 && p < str.length ? owner[p] : -1;
    if (w < 0) {
      continue;
    }
    const W = words[w];
    if (W.from < 0) W.from = j;
    else if (W.to !== j - 1) W.ok = false;       // another cell (of white space or of another word) sits between this word's cells
    W.to = j;
  }

  const cache = new Map();
  const replacements = [];      // { from, to, cells, pos }
  const spelledOut = [];
  const unresolved = [];
  for (const W of words) {
    if (W.from < 0) continue;
    const word = str.slice(W.start, W.end);
    if (!W.ok) { unresolved.push({ start: W.start, end: W.end, chars: word }); continue; }
    const slice = braille.slice(W.from, W.to + 1);
    const rebased = [];
    for (let j = W.from; j <= W.to; j++) rebased.push(pos[j] - W.start);
    const key = `${word}\u0000${slice}\u0000${rebased.join(',')}`;
    let found = cache.get(key);
    if (!found) {
      found = piecesOfWord(word, slice, () => ({ braille: slice, inputPos: rebased }), translatePos ? (w) => translatePos(w) : null);
      cache.set(key, found);
    }
    for (const b of found.bad) unresolved.push({ start: W.start + b.start, end: W.start + b.end, chars: b.chars });
    if (!found.pieces) continue;

    let touched = false;
    const cells = [];
    const outPos = [];
    let ci = W.from;
    let last = -1;
    for (const p of found.pieces) {
      const n = p.cells.length;
      // A piece liblouis reported together with its neighbours (p.refined: "herent" as one piece) has unreliable positions: all its
      // cells then point at the first character of the whole run. Such a piece is given the position of its own first character.
      const keep = () => { for (let k = 0; k < n; k++) { cells.push(braille[ci + k]); outPos.push(p.refined ? W.start + p.start : pos[ci + k]); } };
      const holds = !p.sign || allowed.has(p.sign);
      const pre = (p.prefix || '').length, suf = (p.suffix || '').length;
      const letters = ASCII_LETTERS_RE.test(p.chars) ? p.chars : null;
      if (holds || !letters || pre + suf >= n || !p.cells.startsWith(p.prefix || '') || !p.cells.endsWith(p.suffix || '')) {
        if (!holds) unresolved.push({ start: W.start + p.start, end: W.start + p.end, chars: p.chars });
        keep();
      } else {
        touched = true;
        const first = W.start + p.start;
        for (let k = 0; k < pre; k++) { cells.push(braille[ci + k]); outPos.push(Math.min(pos[ci + k], first)); }
        for (let k = 0; k < letters.length; k++) { cells.push(letters[k].toUpperCase()); outPos.push(first + k); }
        const lastLetter = first + letters.length - 1;
        for (let k = n - suf; k < n; k++) { cells.push(braille[ci + k]); outPos.push(Math.max(pos[ci + k], lastLetter)); }
        spelledOut.push({ start: first, end: W.start + p.end, chars: p.chars, sign: p.sign, wordStart: W.start, wordEnd: W.end });
      }
      ci += n;
    }
    if (touched) {
      for (let k = 1; k < outPos.length; k++) if (outPos[k] < outPos[k - 1]) outPos[k] = outPos[k - 1];   // never backwards
      replacements.push({ from: W.from, to: W.to, cells: cells.join(''), pos: outPos });
    }
  }

  if (!replacements.length) return { braille, inputPos: pos.slice(), spelledOut, unresolved };
  let nb = '';
  const np = [];
  let at = 0;
  for (const r of replacements) {
    nb += braille.slice(at, r.from);
    for (let j = at; j < r.from; j++) np.push(pos[j]);
    nb += r.cells;
    for (const q of r.pos) np.push(q);
    at = r.to + 1;
  }
  nb += braille.slice(at);
  for (let j = at; j < braille.length; j++) np.push(pos[j]);
  return { braille: nb, inputPos: np, spelledOut, unresolved };
}

/**
 * Just the list of what was spelled out: [{ start, end, chars, sign, wordStart, wordEnd }] (indexes into `text`).
 * For the status bar (decision I: "teacher: ea and er spelled out") and the "contractions left out" report (decision H).
 * Group by `sign` for a count, by `wordStart` for one word; signByKey(sign) gives the sign's print and cells.
 */
export function spelledOutSigns(text, translation, allowed, options) {
  return relaxTranslation(text, translation, allowed, options).spelledOut;
}

export { signByKey };
