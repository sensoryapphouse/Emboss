// Unicode NFC for the two liblouis wrappers (engine/louis.mjs in Node, engine/louis-browser.mjs in the browser), with the position map
// translatePos needs. One implementation, imported by both (S3a #16, ChatGPT audit 15 Oct 2026): the two used to carry their own copy,
// and both grouped only "a character plus the combining marks after it", so Hangul Jamo (which compose into a syllable although
// none of them is a mark) were never composed: NFD 가 gave '@<' where NFC 가 gives '$', and 한글 gave 'J<3@[1' where it gives 'J3@!'.
// Plain ES module: no Node or DOM API, so it runs unchanged in both.
//
// normalizeNfc(text, typeform) -> { text, typeform, map }
//   text      always text.normalize('NFC') - the real Unicode composition, not a hand-written subset of it.
//   typeform  (when given) the per-character emphasis array, one entry per character of the NEW text, taken from the first character
//             of the cluster that produced it.
//   map       null when nothing changed (the common, fast case: one .normalize() and a comparison); else map[k] is the index in the
//             ORIGINAL string of the first character of the cluster that produced new character k, so translatePos can hand the
//             editor offsets into the caller's own (possibly decomposed) string. A cluster that composes to several characters
//             maps all of them to its start, which is exactly the position prepareMarks already uses for its own inserted modifier
//             cells, so the two stages compose cleanly.
//
// Composition is done per CLUSTER: a character plus whatever can combine into it - the combining marks after it (\p{M}) and, for
// Hangul, the vowel and final-consonant Jamo (U+1160-U+11FF, U+D7B0-U+D7FF) that follow a leading consonant or an LV syllable. A
// leading consonant (U+1100-U+115F) starts a new cluster, so 한글 written as six Jamo is two clusters of three. The clusters
// are joined and checked against text.normalize('NFC') of the whole string; if they ever disagree (a script this grouping does not
// know about) the whole-string result wins and the map falls back to a prefix/suffix alignment, so the text is always exactly NFC and
// the map is always monotone and inside the source.
const MARK_RE = /^\p{M}$/u;
const HANGUL_TRAILING_RE = /^[ᅠ-ᇿힰ-퟿]$/;

const unitsOf = (cp) => (cp > 0xFFFF ? 2 : 1);
function joinsBefore(ch) {                       // does this character stay in the cluster of the one before it?
  return MARK_RE.test(ch) || HANGUL_TRAILING_RE.test(ch);
}

export function normalizeNfc(text, typeform) {
  const composed = text.normalize('NFC');
  if (composed === text) return { text, typeform, map: null };
  let out = '';
  const starts = [];                             // original index of the cluster that produced each output unit
  let i = 0;
  while (i < text.length) {
    const cp0 = text.codePointAt(i);
    let j = i + unitsOf(cp0);
    while (j < text.length) {
      const cp = text.codePointAt(j);
      if (!joinsBefore(String.fromCodePoint(cp))) break;
      j += unitsOf(cp);
    }
    // a single ASCII character is its own NFC: skip the call
    const piece = (j === i + 1 && cp0 < 0x80) ? text[i] : text.slice(i, j).normalize('NFC');
    out += piece;
    for (let k = 0; k < piece.length; k++) starts.push(i);
    i = j;
  }
  if (out !== composed) {
    // the clusters missed an interaction: keep the true NFC and align it to the source by its unchanged prefix and suffix
    out = composed;
    starts.length = 0;
    let p = 0;
    while (p < text.length && p < composed.length && text[p] === composed[p]) p++;
    let s = 0;
    while (s < text.length - p && s < composed.length - p && text[text.length - 1 - s] === composed[composed.length - 1 - s]) s++;
    for (let k = 0; k < composed.length; k++) {
      if (k < p) starts.push(k);
      else if (k >= composed.length - s) starts.push(text.length - (composed.length - k));
      else starts.push(p);
    }
  }
  const tf = typeform ? starts.map((st) => typeform[st] || 0) : null;
  return { text: out, typeform: tf, map: starts };
}
