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
function translateScripts(text, translate) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  if (text.indexOf(subOpen) < 0 && text.indexOf(supOpen) < 0) return translate(text);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === subOpen || c === supOpen) {
      let j = text.indexOf(end, i + 1);
      if (j < 0) j = text.length;
      const content = text.slice(i + 1, j);
      if (content) out += levelSign(c) + translate(content);
      i = j < text.length ? j + 1 : j;             // consume the end marker
    } else if (c === end) {
      i++;                                          // stray end marker: ignore
    } else {
      let j = i;
      while (j < text.length && text[j] !== subOpen && text[j] !== supOpen && text[j] !== end) j++;
      out += translate(text.slice(i, j));
      i = j;
    }
  }
  return out;
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
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code === 0x00a0 || code === 0x202f || (code >= 0x2000 && code <= 0x200a) || code === 0x205f || code === 0x3000) {
      cleanText += ' ';
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
      if (Array.isArray(tf)) cleanTf.push(tf[i] || 0);
    }
  }
  return { text: cleanText, tf: cleanTf };
}

// Wrap a translate(text[, typeform])->braille function with the chosen house
// style. Applies quote exchange (if requested) to baseline text, then resolves
// any subscript / superscript markers. quoteStyle: 'faithful' (default) | 'exchange'.
export function styledTranslate(translate, quoteStyle) {
  const base = quoteStyle === 'exchange'
    ? (t, tf) => translate(exchangeQuotes(t), tf)
    : translate;
  const withScripts = (t, tf) => (tf ? base(t, tf) : translateScripts(t, base));
  return (t, tf) => {
    const { text: cleanT, tf: cleanTf } = normalizeTextAndTypeform(t, tf);
    return translateWithBraillePreservation(cleanT, cleanTf, withScripts);
  };
}
