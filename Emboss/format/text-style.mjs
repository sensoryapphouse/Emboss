// House-style text preprocessing applied before translation.

// Quote exchange (RUEB 7.6.4): some UK transcriptions use the DOUBLE-quote sign
// for all primary dialogue even where print used single quotes. This maps curly
// single quotes to curly double quotes so liblouis emits the double-quote sign.
//   ‘ (U+2018) -> “ (U+201C)      — left single is almost always an opening quote
//   ’ (U+2019) -> ” (U+201D) ONLY when it's a closing quote, i.e. NOT followed by
//              a letter; if followed by a letter it's an apostrophe (don’t) — kept.
// Limitation: a U+2019 acting as a plural-possessive apostrophe followed by a
// space (e.g. "the dogs’ ball") is treated as a closing quote. This is the same
// ambiguity a human transcriber resolves by judgement; documented, not hidden.
export function exchangeQuotes(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '‘') {
      out += '“';
    } else if (c === '’') {
      out += /[A-Za-z]/.test(s[i + 1] || '') ? '’' : '”';
    } else if (c === "'") {
      const prev = s[i - 1] || '';
      const next = s[i + 1] || '';
      if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) {
        out += "'";
      } else if (/[A-Za-z0-9]/.test(next) && (!prev || /\s|[([{"«‘]/.test(prev))) {
        out += '“';
      } else if (/[A-Za-z0-9)\]}"»’.,!?;:]/.test(prev)) {
        out += '”';
      } else {
        out += "'";
      }
    } else {
      out += c;
    }
  }
  return out;
}

// Subscript / superscript markers. The parser (input/parse.mjs) brackets a docx
// run carrying w:vertAlign with these Private-Use characters; the translate step
// below turns each bracket into the UEB level indicator. PUA characters can't
// occur in ordinary document text and survive the parser's whitespace-collapse
// (they aren't whitespace), so they reach translation intact. subOpen / supOpen
// open a level; end returns to the baseline.
export const SCRIPT_MARKS = {
  subOpen: String.fromCharCode(0xe000),
  supOpen: String.fromCharCode(0xe001),
  end: String.fromCharCode(0xe002),
};

// UEB level indicators, in BRF ASCII, always preceded by the grade-1 indicator
// (";", dots 5-6). Without it the subscript sign (dots 2-6) reads as the "en"
// grade-2 contraction; liblouis's own precomposed superscript chars (e.g. "²")
// emit exactly ";9" in both grades, so we mirror that. Verified against the gold
// sign ";5#B" for CO2 in corpus/ukaaf/sample3.brf (RUEB / B004).
const levelSign = (marker) =>
  marker === SCRIPT_MARKS.subOpen ? ';5' : ';9';   // subscript (2-6) vs superscript (3-5)

// Translate text that may contain script markers. Baseline spans are translated
// as usual; a marked span becomes its level indicator followed by the
// translation of the marked content (a self-contained item — typically the
// digits of a chemical formula), so the numeric/letter content still gets its
// own indicators (e.g. the "#" number sign). No markers -> identical to a plain
// translate() call, so marker-free documents are unaffected.
// Rules of UEB 11.4.1: a level sign covers only the next "item" — an entire number, a single symbol, or an expression
// in brackets or grouping signs. A run that is anything else (a word, "2y", "n+1") needs braille grouping signs
// ⠣…⠜ ("<" ">"), and in grade 2 the whole symbols-sequence then goes into grade 1 with the grade-1 word indicator at
// its start, as RUEB 3.4's own example "mass" with subscript "sun" shows: ⠍⠁⠎⠎⠰⠰⠢⠣⠎⠥⠝⠜ (Paul, 30 Sep: "Subscript"
// brailled with the sign covering only its capital).
function isScriptItem(content) {
  const t = content.trim();
  if ([...t].length <= 1) return true;                              // one symbol
  if (/^[0-9]+(?:[.,][0-9]+)*$/.test(t)) return true;               // an entire number
  const pairs = { '(': ')', '[': ']', '{': '}' };
  if (pairs[t[0]] === t[t.length - 1]) {                            // one bracketed expression (the brackets match up)
    let depth = 0;
    for (let k = 0; k < t.length; k++) {
      if (t[k] === t[0]) depth++;
      else if (t[k] === pairs[t[0]]) { depth--; if (depth === 0 && k < t.length - 1) return false; }
    }
    return depth === 0;
  }
  return false;
}
// A word (a symbols-sequence) holding a run that is not a single item. As RUEB's examples: the grade-1 word indicator
// ";;" goes just before the first such run's level sign and covers the rest of the word ("mass" + subscript "sun":
// MASS;;5<SUN>), or at the start of the word when what comes before would need a grade-1 sign anyway (x to the 2y:
// ;;X9<#BY>); from there each level sign has no ";" of its own and "<" ">" enclose a run that is not a single item.
// `before` translates the word's start in the document's own grade (single-item scripts and all). Needs `g1`.
function translateGroupedWord(word, g1, tf, offset, before) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const tr = (a, b) => {
    const chunk = word.slice(a, b);
    if (!tf) return g1(chunk);
    return g1(chunk, Array.isArray(tf) ? tf.slice(offset + a, offset + b) : tf);
  };
  // the first run that is not a single item
  let first = 0;
  for (let k = 0; k < word.length; k++) {
    if (word[k] !== subOpen && word[k] !== supOpen) continue;
    let j = word.indexOf(end, k + 1);
    if (j < 0) j = word.length;
    const content = word.slice(k + 1, j);
    if (content.trim() && !isScriptItem(content)) { first = k; break; }
  }
  const head = first > 0 ? before(0, first) : '';
  let out, i;
  if (!head || head.startsWith(';')) { out = ';;'; i = 0; }
  else { out = head + ';;'; i = first; }
  while (i < word.length) {
    const c = word[i];
    if (c === subOpen || c === supOpen) {
      let j = word.indexOf(end, i + 1);
      if (j < 0) j = word.length;
      const content = word.slice(i + 1, j);
      if (content.trim()) out += (c === subOpen ? '5' : '9') + (isScriptItem(content) ? tr(i + 1, j) : '<' + tr(i + 1, j) + '>');
      else if (content) out += tr(i + 1, j);
      i = j < word.length ? j + 1 : j;
    } else if (c === end) {
      i++;
    } else {
      let j = i;
      while (j < word.length && word[j] !== subOpen && word[j] !== supOpen && word[j] !== end) j++;
      out += tr(i, j);
      i = j;
    }
  }
  return out;
}

function translateScripts(text, translate, tf, g1 = null) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  // tf (optional): a scalar typeform or a per-character array aligned with `text`; each chunk
  // gets the matching slice, so emphasised text that also carries a sub/superscript marker
  // (a bold run with a superscript "r") is resolved exactly like unemphasised text.
  const tr = (a, b) => {
    const chunk = text.slice(a, b);
    if (!tf) return translate(chunk);
    return translate(chunk, Array.isArray(tf) ? tf.slice(a, b) : tf);
  };
  if (text.indexOf(subOpen) < 0 && text.indexOf(supOpen) < 0 && text.indexOf(end) < 0) return tf ? translate(text, tf) : translate(text);
  // A run that is not a single item: its whole word goes through translateGroupedWord (grade 1 translator needed;
  // without one the run just gets its grouping signs in place). Everything else is translated as before.
  if (g1) {
    const wordRe = /\S+/g;
    let m, last = 0, out = '', grouped = false;
    while ((m = wordRe.exec(text)) !== null) {
      const w = m[0];
      let needs = false;
      for (let k = 0; k < w.length && !needs; k++) {
        if (w[k] !== subOpen && w[k] !== supOpen) continue;
        let j = w.indexOf(end, k + 1);
        if (j < 0) j = w.length;
        const content = w.slice(k + 1, j);
        if (content.trim() && !isScriptItem(content)) needs = true;
      }
      if (!needs) continue;
      grouped = true;
      if (m.index > last) out += translateScripts(text.slice(last, m.index), translate, Array.isArray(tf) ? tf.slice(last, m.index) : tf);
      out += translateGroupedWord(w, g1, tf, m.index, (a, b) => translateScripts(w.slice(a, b), translate, Array.isArray(tf) ? tf.slice(m.index + a, m.index + b) : tf));
      last = m.index + w.length;
    }
    if (grouped) {
      if (last < text.length) out += translateScripts(text.slice(last), translate, Array.isArray(tf) ? tf.slice(last) : tf);
      return out;
    }
  }
  // A86: the letters next to a sub/superscript belong to the same symbols-sequence; they are not a word standing alone.
  // Translated on their own, "H" of H₂O got a grade-1 sign (";,H") and "SO" of H₂SO₄ became the wordsign for "so" (",,S",
  // the O lost). RUEB 3.24.1: H₂O ,H;5#B,O; W with superscript m ,W;9M. And RUEB 5.6 / 6.5: a numeric indicator sets
  // grade 1 mode to the end of the symbols-sequence (a space, hyphen or dash), so a level sign after a number needs no
  // grade-1 indicator of its own (4m² #DM9#B, 1682.³ #AFHB49#C, the UKAAF gold's 3² #C9#B), the letters after a numeric
  // script are uncontracted, and a letter a-j straight after its digits takes the grade-1 indicator (x₂a X;5#B;A).
  // liblouis is given that context and then the context's own braille is cut off again (only when the cut is exact;
  // otherwise the chunk is translated as before): a superscript "²" beside the chunk stands in for a script (liblouis
  // brailles x² as X;9#B, not standing alone), and a digit in front of the chunk after a numeric script gives it the
  // numeric grade 1 mode (3the -> #CTHE, 3a -> #C;A).
  const CTX_SCRIPT = '\u00b2', CTX_NUMBER = '1';
  const ctxCache = {};
  const ctxBrl = (s) => (s in ctxCache ? ctxCache[s] : (ctxCache[s] = translate(s)));
  const trInContext = (a, b, pre, post) => {
    if (!pre && !post) return tr(a, b);
    const preBrl = pre ? ctxBrl(pre) : '', postBrl = post ? ctxBrl(post) : '';
    if ((pre && !preBrl) || (post && !postBrl)) return tr(a, b);
    const src = pre + text.slice(a, b) + post;
    let brl;
    if (!tf) brl = translate(src);
    else if (!Array.isArray(tf)) brl = translate(src, tf);
    else brl = translate(src, [...Array.from(pre, () => 0), ...tf.slice(a, b), ...Array.from(post, () => 0)]);
    if (typeof brl !== 'string' || !brl.startsWith(preBrl) || !brl.endsWith(postBrl) || brl.length < preBrl.length + postBrl.length) return tr(a, b);
    return brl.slice(preBrl.length, brl.length - postBrl.length);
  };
  // grade 1 mode set by a numeric indicator (or a grade-1 word indicator) earlier in the current symbols-sequence
  const inGrade1Mode = () => {
    const tail = out.slice(Math.max(out.lastIndexOf(' '), out.lastIndexOf('-')) + 1);
    return /#|;;/.test(tail) && !/;'[^#]*$/.test(tail);
  };
  let out = '';
  let i = 0;
  let afterScript = null;                           // null, or 'number' / 'other': the script just translated
  while (i < text.length) {
    const c = text[i];
    if (c === subOpen || c === supOpen) {
      let j = text.indexOf(end, i + 1);
      if (j < 0) j = text.length;
      const content = text.slice(i + 1, j);
      if (content.trim()) {
        const item = isScriptItem(content);
        const number = item && /^[0-9]/.test(content.trim());
        // grade-1 indicator before the level sign unless grade 1 mode is already on (levelSign gives ";5" / ";9")
        const sign = inGrade1Mode() ? levelSign(c).slice(1) : levelSign(c);
        // a letter or symbol as the script is not standing alone either (,W;9M, not ,W;9;M)
        const body = number ? tr(i + 1, j) : trInContext(i + 1, j, CTX_SCRIPT, '');
        out += sign + (item ? body : '<' + body + '>');
        afterScript = number ? 'number' : 'other';
      } else {
        if (content) out += tr(i + 1, j);           // a raised or lowered space (Word does this before a footnote number) is just a space
        afterScript = null;
      }
      i = j < text.length ? j + 1 : j;             // consume the end marker
    } else if (c === end) {
      i++;                                          // stray end marker: ignore
    } else {
      let j = i;
      while (j < text.length && text[j] !== subOpen && text[j] !== supOpen && text[j] !== end) j++;
      let k = j;
      while (k < text.length && text[k] === end) k++;
      let nextHasContent = false;
      if (k < text.length && (text[k] === subOpen || text[k] === supOpen)) { const e = text.indexOf(end, k + 1); nextHasContent = !!text.slice(k + 1, e < 0 ? text.length : e).trim(); }
      // touching a script on either side (no space between); a chunk that starts with a digit is left alone after a
      // script, since the context would join it to the number
      const pre = afterScript && /^[^\s0-9]/.test(text[i]) ? (afterScript === 'number' ? CTX_NUMBER : CTX_SCRIPT) : '';
      const post = nextHasContent && /\S$/.test(text.slice(i, j)) ? CTX_SCRIPT : '';
      out += trInContext(i, j, pre, post);
      afterScript = null;
      i = j;
    }
  }
  return out;
}

// Position-tracking twin of translateScripts' main path, for styledTranslatePos (import fix list #55, 1 Oct 2026).
// The editor's position trace used to hand the sub/superscript markers to liblouis, which escapes them; the layout then
// noticed the escape, threw the trace away and laid that block out again with `translate` (right braille, but no link from
// each braille cell to its print character, and a "trace-fallback" notice). This returns the SAME braille translateScripts
// gives, with an input position for every cell: the cells of a translated piece keep liblouis's own positions (shifted to the
// piece's place in the text); a level sign, "<" or ">" has no print character of its own and points at its marker.
// Anything it cannot do exactly returns null and the caller keeps the old behaviour (so the braille shown never changes):
//   - a run that is not a single item (needs the grade 1 translator, which styledTranslatePos is not given),
//   - Unicode braille in the same text (styledTranslate passes it through separately),
//   - a translatePos result without an inputPos array,
//   - and, last, any case where the braille built here is not character for character what translateScripts builds from
//     liblouis's plain braille (checked on every call, so this copy of the rules can never drift from the real ones unseen).
// The position trace for text with a sub/superscript run that is not a single item (translateScripts' grade-1 grouping,
// translateGroupedWord). The text is cut exactly where translateScripts cuts it: each grouped word is brailled by
// translateGroupedWord and its cells are spread over the word's own characters (a click on any of them finds the word); the
// text between is traced as before (resolveScriptsPos, or translatePos). Checked against translateScripts' own braille for the
// whole text: null on any difference (the old fallback), so the braille shown never changes.
function resolveGroupedScriptsPos(text, translatePos, tf, g1) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  if (!g1 || (text.indexOf(subOpen) < 0 && text.indexOf(supOpen) < 0)) return null;
  if (/[⠀-⣿]/.test(text)) return null;
  const BAIL = {};
  const brl = (s, t) => { const r = translatePos(s, t || null); if (!r || typeof r.braille !== 'string') throw BAIL; return r.braille; };
  const slice = (a, b) => (Array.isArray(tf) ? tf.slice(a, b) : tf);
  try {
    let out = '', last = 0, grouped = false;
    const pos = [];
    const piece = (a, b) => {
      if (b <= a) return;
      const sub = text.slice(a, b), t = slice(a, b);
      const r = resolveScriptsPos(sub, translatePos, t ?? null) || translatePos(sub, t ?? null);
      if (!r || typeof r.braille !== 'string' || !Array.isArray(r.inputPos) || r.inputPos.length !== r.braille.length) throw BAIL;
      out += r.braille;
      for (const p of r.inputPos) pos.push(typeof p === 'number' && p >= 0 ? a + p : p);
    };
    const wordRe = /\S+/g;
    let m;
    while ((m = wordRe.exec(text)) !== null) {
      const w = m[0];
      let needs = false;
      for (let k = 0; k < w.length && !needs; k++) {
        if (w[k] !== subOpen && w[k] !== supOpen) continue;
        let j = w.indexOf(end, k + 1);
        if (j < 0) j = w.length;
        const content = w.slice(k + 1, j);
        if (content.trim() && !isScriptItem(content)) needs = true;
      }
      if (!needs) continue;
      grouped = true;
      piece(last, m.index);
      const at = m.index;
      const wb = translateGroupedWord(w, g1, tf, at, (a, b) => translateScripts(w.slice(a, b), brl, slice(at + a, at + b)));
      out += wb;
      for (let k = 0; k < wb.length; k++) pos.push(at + Math.min(w.length - 1, Math.floor((k * w.length) / Math.max(1, wb.length))));
      last = at + w.length;
    }
    if (!grouped) return null;
    piece(last, text.length);
    const ref = translateScripts(text, brl, tf, g1);
    if (out !== ref || pos.length !== out.length) return null;
    return { braille: out, inputPos: pos };
  } catch (e) {
    if (e === BAIL) return null;
    throw e;
  }
}
function resolveScriptsPos(text, translatePos, tf) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  if (text.indexOf(subOpen) < 0 && text.indexOf(supOpen) < 0 && text.indexOf(end) < 0) return null;
  if (/[⠀-⣿]/.test(text)) return null;
  const wordRe = /\S+/g;
  let m;
  while ((m = wordRe.exec(text)) !== null) {                       // a run translateScripts would group (needs g1): leave it to the fallback
    const w = m[0];
    for (let k = 0; k < w.length; k++) {
      if (w[k] !== subOpen && w[k] !== supOpen) continue;
      let j = w.indexOf(end, k + 1);
      if (j < 0) j = w.length;
      const content = w.slice(k + 1, j);
      if (content.trim() && !isScriptItem(content)) return null;
    }
  }
  const BAIL = {};
  try {
    const call = (s, t) => {
      const r = translatePos(s, t || null);
      if (!r || typeof r.braille !== 'string' || !Array.isArray(r.inputPos) || r.inputPos.length !== r.braille.length) throw BAIL;
      return r;
    };
    const tfOf = (a, b) => (!tf ? null : Array.isArray(tf) ? tf.slice(a, b) : tf);
    let out = '';
    const pos = [];
    const lit = (str, at) => { out += str; for (let k = 0; k < str.length; k++) pos.push(at); };
    const add = (piece) => { out += piece.s; pos.push(...piece.p); };
    const trPos = (a, b) => {
      const r = call(text.slice(a, b), tfOf(a, b));
      return { s: r.braille, p: r.inputPos.map((p) => (typeof p === 'number' && p >= 0 ? a + p : p)) };
    };
    const CTX_SCRIPT = '²', CTX_NUMBER = '1';
    const ctxCache = {};
    const ctxBrl = (s) => (s in ctxCache ? ctxCache[s] : (ctxCache[s] = call(s, null).braille));
    const trInContextPos = (a, b, pre, post) => {
      if (!pre && !post) return trPos(a, b);
      const preBrl = pre ? ctxBrl(pre) : '', postBrl = post ? ctxBrl(post) : '';
      if ((pre && !preBrl) || (post && !postBrl)) return trPos(a, b);
      const src = pre + text.slice(a, b) + post;
      let t2 = null;
      if (tf) t2 = Array.isArray(tf) ? [...Array.from(pre, () => 0), ...tf.slice(a, b), ...Array.from(post, () => 0)] : tf;
      const r = call(src, t2);
      const brl = r.braille;
      if (!brl.startsWith(preBrl) || !brl.endsWith(postBrl) || brl.length < preBrl.length + postBrl.length) return trPos(a, b);
      const lo = preBrl.length, hi = brl.length - postBrl.length;
      const last = Math.max(a, b - 1);
      return {
        s: brl.slice(lo, hi),
        p: r.inputPos.slice(lo, hi).map((p) => (typeof p === 'number' && p >= 0 ? Math.min(last, Math.max(a, a + p - pre.length)) : p)),
      };
    };
    const inGrade1Mode = () => {
      const tail = out.slice(Math.max(out.lastIndexOf(' '), out.lastIndexOf('-')) + 1);
      return /#|;;/.test(tail) && !/;'[^#]*$/.test(tail);
    };
    let i = 0;
    let afterScript = null;
    while (i < text.length) {
      const c = text[i];
      if (c === subOpen || c === supOpen) {
        let j = text.indexOf(end, i + 1);
        if (j < 0) j = text.length;
        const content = text.slice(i + 1, j);
        if (content.trim()) {
          const item = isScriptItem(content);
          const number = item && /^[0-9]/.test(content.trim());
          const sign = inGrade1Mode() ? levelSign(c).slice(1) : levelSign(c);
          const body = number ? trPos(i + 1, j) : trInContextPos(i + 1, j, CTX_SCRIPT, '');
          lit(sign, i);
          if (!item) lit('<', i);
          add(body);
          if (!item) lit('>', Math.min(j, text.length - 1));
          afterScript = number ? 'number' : 'other';
        } else {
          if (content) add(trPos(i + 1, j));
          afterScript = null;
        }
        i = j < text.length ? j + 1 : j;
      } else if (c === end) {
        i++;
      } else {
        let j = i;
        while (j < text.length && text[j] !== subOpen && text[j] !== supOpen && text[j] !== end) j++;
        let k = j;
        while (k < text.length && text[k] === end) k++;
        let nextHasContent = false;
        if (k < text.length && (text[k] === subOpen || text[k] === supOpen)) { const e = text.indexOf(end, k + 1); nextHasContent = !!text.slice(k + 1, e < 0 ? text.length : e).trim(); }
        const pre = afterScript && /^[^\s0-9]/.test(text[i]) ? (afterScript === 'number' ? CTX_NUMBER : CTX_SCRIPT) : '';
        const post = nextHasContent && /\S$/.test(text.slice(i, j)) ? CTX_SCRIPT : '';
        add(trInContextPos(i, j, pre, post));
        afterScript = null;
        i = j;
      }
    }
    // the guard: exactly what translateScripts builds from the same liblouis braille
    const ref = translateScripts(text, (s, t) => (t ? translatePos(s, t) : translatePos(s, null)).braille, tf, null);
    if (out !== ref || pos.length !== out.length) return null;
    return { braille: out, inputPos: pos };
  } catch (e) {
    if (e === BAIL) return null;
    throw e;
  }
}

import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

// Runs of Unicode braille in the text pass straight through (mapped to BRF ASCII);
// everything else is translated chunk by chunk. A per-character typeform array is
// SLICED to each chunk so the emphasis stays aligned with the characters it marks.
function translateWithBraillePreservation(text, tf, translate) {
  if (!text) return '';
  if (!/[\u2800-\u28ff]/.test(text)) return translate(text, tf);
  let out = '';
  const regex = /([\u2800-\u28ff]+|[^\u2800-\u28ff]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const chunk = match[0];
    if (/^[\u2800-\u28ff]+$/.test(chunk)) {
      out += unicodeBrailleToBrf(chunk);
    } else {
      const tfChunk = Array.isArray(tf) ? tf.slice(match.index, match.index + chunk.length) : tf;
      out += translate(chunk, tfChunk);
    }
  }
  return out;
}

// Unicode whitespace & invisible control character normalizer.
// Replaces non-standard spaces (NBSP, narrow NBSP, em/en/thin space) with standard
// space and strips zero-width / bidirectional control characters (ZWJ, ZWNJ, ZWSP,
// soft hyphen) to prevent liblouis from emitting raw hex escapes (e.g. \X200C).
export function normalizeTextAndTypeform(text, tf) {
  if (!text) return { text: '', tf };
  if (!/[\u00A0\u202F\u2000-\u200A\u205F\u3000\u200B-\u200D\uFEFF\u00AD\u200E\u200F\u202A-\u202E\u2060-\u206F]/.test(text)) {
    return { text, tf };
  }
  let cleanText = '';
  const cleanTf = Array.isArray(tf) ? [] : tf;
  const map = [];   // map[k] = index in `text` of cleanText[k] (styledTranslatePos maps braille positions back through it)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code === 0x00a0 || code === 0x202f || (code >= 0x2000 && code <= 0x200a) || code === 0x205f || code === 0x3000) {
      // Import fix list #55 (b) (Paul, 1 Oct 2026): a no-break, narrow no-break, thin or figure space BETWEEN TWO DIGITS separates
      // digit groups (34 432 567) and reaches liblouis as a no-break space, which it brailles as the numeric space
      // (#CD"DCB"EFG, BANA 11.6.5); turned into a plain space it made three numbers (#CD #DCB #EFG). Elsewhere: a plain space.
      const digitGroup = (code === 0x00a0 || code === 0x202f || code === 0x2009 || code === 0x2007) && /\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '');
      cleanText += digitGroup ? '\u00a0' : ' ';
      map.push(i);
      if (Array.isArray(tf)) cleanTf.push(tf[i] || 0);
    } else if (
      (code >= 0x200b && code <= 0x200d) ||
      code === 0xfeff || code === 0x00ad ||
      code === 0x200e || code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f)
    ) {
      continue;
    } else {
      cleanText += ch;
      map.push(i);
      if (Array.isArray(tf)) cleanTf.push(tf[i] || 0);
    }
  }
  return { text: cleanText, tf: cleanTf, map };
}

// Wrap a translate(text[, typeform])->braille function with the chosen house
// style. Applies quote exchange (if requested) to baseline text, then resolves
// any subscript / superscript markers. quoteStyle: 'faithful' (default) | 'exchange'.
// The same house style for a position-tracking translator (the editor's `translatePos`, which the
// layout path uses to link each braille cell to its print character). Quote exchange keeps the
// length; the whitespace/invisible-character clean-up does not, so the returned inputPos entries are
// mapped back to indices in the caller's own text. Without the clean-up the editor brailled a soft
// hyphen as a hyphen, a zero-width space as a space, and wrote a raw no-break space (0xA0) into the
// BRF (A71, 26 Sep 2026). Unicode braille needs nothing here: the layout path handles it itself. Sub/superscript
// markers are resolved here too, with positions, wherever that gives exactly the braille `styledTranslate` gives
// (resolveScriptsPos, import fix list #55); a run it cannot do exactly (one that needs the grade 1 translator) is left to the layout
// path's fallback, which brailles that block with `translate` (right braille, no cell-to-print link for it).
// translateG1 (optional, as styledTranslate's): the raw grade-1 translator. With it, a run that is not a single item (the word
// "mass" with subscript "sun", RUEB 3.4) is traced too (resolveGroupedScriptsPos): its word's cells link back to the word as a
// whole. Feedback 30 Sep item 7 (Paul, 1 Oct): without it such a block fell back and showed "Editor link degraded" as a warning.
export function styledTranslatePos(translatePos, quoteStyle, translateG1 = null) {
  return (t, tf) => {
    const src = quoteStyle === 'exchange' ? exchangeQuotes(t) : t;
    const { text, tf: cleanTf, map } = normalizeTextAndTypeform(src, tf);
    // sub/superscript markers: resolved here, with positions, when that gives exactly the braille `styledTranslate` gives
    // (resolveScriptsPos, resolveGroupedScriptsPos); otherwise they go to liblouis as before and the layout falls back to
    // `translate` for that block.
    const res = resolveScriptsPos(text, translatePos, cleanTf ?? null)
      || (translateG1 ? resolveGroupedScriptsPos(text, translatePos, cleanTf ?? null, translateG1) : null)
      || translatePos(text, cleanTf ?? null);
    if (!map || !res || !Array.isArray(res.inputPos)) return res;
    return { ...res, inputPos: res.inputPos.map((p) => (typeof p === 'number' && p >= 0 && p < map.length ? map[p] : p)) };
  };
}

// translateG1 (optional): the grade-1 translator, for a sub/superscript run that is not a single item (see
// translateGroupedWord). Without it such a run still gets its grouping signs, in place.
export function styledTranslate(translate, quoteStyle, translateG1 = null) {
  const base = quoteStyle === 'exchange'
    ? (t, tf) => translate(exchangeQuotes(t), tf)
    : translate;
  const g1 = translateG1 ? (quoteStyle === 'exchange' ? (t, tf) => translateG1(exchangeQuotes(t), tf) : translateG1) : null;
  const withScripts = (t, tf) => translateScripts(t, base, tf, g1);
  return (t, tf) => {
    const { text: cleanT, tf: cleanTf } = normalizeTextAndTypeform(t, tf);
    return translateWithBraillePreservation(cleanT, cleanTf, withScripts);
  };
}
