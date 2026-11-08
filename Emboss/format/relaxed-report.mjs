// Relaxed braille, Stage 4 (A91; Paul 3 Oct 2026, decision H "help teachers choose"): which contractions of the OPEN DOCUMENT a reader
// profile leaves out, and how often each occurs. Pure: no DOM, no settings, no table loading; works in Node and the browser. The page
// (web/reader-profile-ui.mjs) passes in the document's text and the page's own translator, and shows the result in the profile manager.
//
// METHOD (it has to scale to a whole book, and to follow every tick instantly):
//   1. countSigns(text, translatePos): the document's DISTINCT words are translated ONCE, in full contracted UEB, and each is split into
//      signs exactly as relaxTranslation does it (translatePos + identifySigns); the signs are counted per catalogue key, each word's
//      signs times the number of times the word occurs. The count is cached by the page for the document (textSignature says whether
//      the text has changed), and it runs in time slices that give the page the floor between them, so a book never freezes the page.
//   2. leftOut(counts, profileKeys): for ANY profile the list is just the counted signs the profile does not hold, commonest first -
//      no new translation, so ticking a box updates the list at once.
// The counts come from relaxTranslation with nothing ticked, so they are the signs a profile WOULD really spell out (a word that cannot
// be taken apart stays contracted and is not counted - the same words relaxed braille leaves contracted). Each word is translated on its
// own, not inside its sentence: a letter standing alone, or a word whose contraction depends on its neighbours, can differ by a sign or
// two from the document's braille; for choosing which contractions to teach next that is well inside what is useful.
//
// A whole-word sign and a groupsign are different entries, as in the catalogue: "child" (strong_contraction_wordsigns:child) and "ch"
// (strong_contractions:ch); "be" the word (lower_wordsigns:be) and "be-" at the start of a word (lower_contractions:be).
import { UEB_CONTRACTION_SIGNS, signByKey } from './relaxed-signs.mjs';
import { relaxTranslation, allowsEverything } from './relaxed-braille.mjs';

/**
 * The sample sentence of the profile manager. Chosen for teachers of young learners: all nine groups of contractions are in it (the,
 * and, children, because, said, could, were, was, their, father, had, one in "gone", out, but, not, go, ea, bb, in, ch, er, ow, ed,
 * ness), the words are ones a child knows, and it is about three lines of braille. It ends kindly, not with "sadness" (Paul,
 * 3 Oct 2026: S3). A teacher can type a sentence of their own instead.
 */
export const DEFAULT_SAMPLE = 'The children were happy because their father said the teacher was kind, but they could not go out; the rabbit had gone and they showed kindness.';

const ORDER = new Map(UEB_CONTRACTION_SIGNS.map((s, i) => [s.key, i]));
const NO_SIGNS = new Set();
const HAS_LETTER = /\p{L}/u;
const defaultYield = () => new Promise((resolve) => setTimeout(resolve, 0));
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** A short fingerprint of a text (its length and a 53-bit hash): the page counts again only when this changes. */
export function textSignature(text) {
  const s = typeof text === 'string' ? text : '';
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${s.length}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

// the signs of one word, as the keys relaxTranslation would spell out with nothing ticked: [key, key, ...] (a sign twice = twice)
function signsOfWord(word, translatePos) {
  const tr = translatePos(word);
  if (!tr || typeof tr.braille !== 'string') return { keys: [], unresolved: false };
  const r = relaxTranslation(word, tr, NO_SIGNS, { translatePos });
  return { keys: r.spelledOut.map((s) => s.sign), unresolved: r.unresolved.length > 0 };
}

/**
 * Count the contractions of a text, per catalogue key. Resolves to
 *   { counts: Map<key, times>, words, distinctWords, unresolvedWords }
 * or to null if `isCancelled()` became true (the document changed, the dialog closed).
 *   text           the document's text (any string); words are runs of non-white-space; only those with a letter are counted.
 *   translatePos   translatePos(word) -> { braille (BRF ASCII), inputPos[] } in full contracted UEB, unrelaxed (makeTranslators(...).translatePos).
 *   options        sliceMs (default 12): how long to work before giving the page the floor; yieldFn (default setTimeout 0): the
 *                  giving; isCancelled(): checked between slices; onProgress(fraction 0..1): between slices.
 * A word the translator throws on is skipped; the count goes on.
 */
export async function countSigns(text, translatePos, options) {
  const o = options || {};
  const sliceMs = o.sliceMs > 0 ? o.sliceMs : 12;
  const yieldFn = typeof o.yieldFn === 'function' ? o.yieldFn : defaultYield;
  const cancelled = typeof o.isCancelled === 'function' ? o.isCancelled : () => false;
  const progress = typeof o.onProgress === 'function' ? o.onProgress : () => {};
  const str = typeof text === 'string' ? text : '';

  // 1. the distinct words and how often each occurs
  const freq = new Map();
  let words = 0;
  const re = /\S+/gu;
  let m, n = 0, t0 = now();
  while ((m = re.exec(str))) {
    const w = m[0];
    if (HAS_LETTER.test(w)) { words++; freq.set(w, (freq.get(w) || 0) + 1); }
    if ((++n & 1023) === 0 && now() - t0 >= sliceMs) {
      if (cancelled()) return null;
      await yieldFn();
      t0 = now();
    }
  }

  // 2. each distinct word once
  const counts = new Map();
  let unresolvedWords = 0, done = 0;
  const total = freq.size || 1;
  t0 = now();
  progress(0);
  for (const [word, times] of freq) {
    try {
      const r = signsOfWord(word, translatePos);
      for (const k of r.keys) counts.set(k, (counts.get(k) || 0) + times);
      if (r.unresolved) unresolvedWords += times;
    } catch { /* a word the translator cannot take: skipped */ }
    done++;
    if (now() - t0 >= sliceMs) {
      if (cancelled()) return null;
      progress(done / total);
      await yieldFn();
      if (cancelled()) return null;
      t0 = now();
    }
  }
  progress(1);
  return { counts, words, distinctWords: freq.size, unresolvedWords };
}

/**
 * The contractions of the counted text that a profile leaves out, commonest first (ties in the catalogue's order):
 * [{ key, sign (the catalogue entry), count }]. `allowed`: the profile as a Set (or array) of keys; null / undefined / every key = All,
 * which leaves nothing out.
 */
export function leftOut(counts, allowed) {
  if (!counts || allowed == null || allowsEverything(allowed)) return [];
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  const rows = [];
  for (const [key, count] of counts) {
    if (set.has(key)) continue;
    const sign = signByKey(key);
    if (sign && count > 0) rows.push({ key, sign, count });
  }
  rows.sort((a, b) => (b.count - a.count) || (ORDER.get(a.key) - ORDER.get(b.key)));
  return rows;
}

/**
 * Where a sign is used, for the teacher's list: 'whole' (only for a whole word: child, but, was, the shortforms), 'part' (only inside a
 * word: ch, ea, ing, the final contractions, be-) or 'either' (the whole word and inside longer words: the, and, father, some).
 */
export function signUse(sign) {
  if (!sign) return 'part';
  if (sign.wholeWord) return 'whole';
  if (sign.group === 'strong_wordsigns' || sign.group === 'initial_contractions') return 'either';
  return 'part';
}
