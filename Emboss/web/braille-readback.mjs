// Braille proofreading aloud (Paul, 4 Nov 2026; transcriber tools only). The pure part: turning ONE braille word, back-translated
// to text by the braille code in use, into the words a speech engine should say, so a mistake in the braille is heard.
// DOM-free and engine-free: the editor does the back-translation (web/braille-table.mjs makeTranslators(...).backTranslate) and the
// speaking (web/tts.mjs Reader); this file only decides what is said.
//
// Paul's decisions:
//  - "cap" before EVERY capital letter: "London" -> "cap London", "NASA" -> "cap N cap A cap S cap A", "McDonald" -> "cap Mc cap Donald".
//  - punctuation is named: comma, full stop (UKAAF) / period (BANA), open quote, close quote ...
//  - braille that does not back-translate is spoken as its dots ("dots 1 2 4").
// Every word spoken lives in DEFAULT_WORDS (English); the editor passes a dictionary built from en.json (app.readback.*), so the words
// can be translated like the rest of the interface.
import { brfCharDots } from '../engine/brf-ascii.mjs';

export const DEFAULT_WORDS = {
  cap: 'cap',
  dots: 'dots',
  blank: 'blank',
  equation: 'equation',
  page: 'page',
  period: 'period',
  full_stop: 'full stop',
  comma: 'comma',
  semicolon: 'semicolon',
  colon: 'colon',
  exclamation_mark: 'exclamation mark',
  exclamation_point: 'exclamation point',
  question_mark: 'question mark',
  apostrophe: 'apostrophe',
  open_quote: 'open quote',
  close_quote: 'close quote',
  open_single_quote: 'open single quote',
  close_single_quote: 'close single quote',
  open_parenthesis: 'open parenthesis',
  close_parenthesis: 'close parenthesis',
  open_bracket: 'open bracket',
  close_bracket: 'close bracket',
  open_square_bracket: 'open square bracket',
  close_square_bracket: 'close square bracket',
  open_brace: 'open brace',
  close_brace: 'close brace',
  hyphen: 'hyphen',
  dash: 'dash',
  ellipsis: 'ellipsis',
  slash: 'slash',
  backslash: 'backslash',
  at: 'at',
  hash: 'hash',
  dollar: 'dollar',
  pound: 'pound',
  euro: 'euro',
  percent: 'percent',
  ampersand: 'ampersand',
  asterisk: 'asterisk',
  plus: 'plus',
  equals: 'equals',
  less_than: 'less than',
  greater_than: 'greater than',
  underscore: 'underscore',
  tilde: 'tilde',
  caret: 'caret',
  vertical_bar: 'vertical bar',
  backtick: 'backtick',
  degrees: 'degrees',
  section: 'section',
  bullet: 'bullet',
  rule_line: 'line',
};

// Character -> dictionary key. Characters whose name depends on the standard or on position are handled in speakText.
const PUNCT = {
  ',': 'comma', ';': 'semicolon', ':': 'colon', '?': 'question_mark',
  '{': 'open_brace', '}': 'close_brace',
  '-': 'hyphen', '‐': 'hyphen', '‑': 'hyphen', '‒': 'dash', '–': 'dash', '—': 'dash', '―': 'dash',
  '…': 'ellipsis', '/': 'slash', '\\': 'backslash', '@': 'at', '#': 'hash', '$': 'dollar', '£': 'pound', '€': 'euro',
  '%': 'percent', '&': 'ampersand', '*': 'asterisk', '+': 'plus', '=': 'equals', '<': 'less_than', '>': 'greater_than',
  '_': 'underscore', '~': 'tilde', '^': 'caret', '|': 'vertical_bar', '`': 'backtick', '°': 'degrees', '§': 'section',
  '•': 'bullet', '“': 'open_quote', '”': 'close_quote', '‘': 'open_single_quote',
};
const OPENERS = new Set(['(', '[', '{', '“', '‘', '"', "'", '—', '–', '-', '/', '…']);   // what a quote that follows is an opening quote after

const isLetter = (ch) => /\p{L}/u.test(ch);
const isMark = (ch) => /\p{M}/u.test(ch);
const isUpper = (ch) => /\p{Lu}/u.test(ch) && ch.toLowerCase() !== ch;
const isLower = (ch) => /\p{Ll}/u.test(ch) || (isLetter(ch) && !isUpper(ch));
const isDigit = (ch) => ch >= '0' && ch <= '9';
const isSpace = (ch) => /\s/u.test(ch);

function dictOf(opts) { return (opts && opts.words) || DEFAULT_WORDS; }
function w(opts, key) { const d = dictOf(opts); return d[key] != null ? d[key] : (DEFAULT_WORDS[key] != null ? DEFAULT_WORDS[key] : key); }

// "dots 1 2 4" for a dot number string such as "124" (liblouis writes an unmapped cell as \124/ in a back-translation).
function dotsWords(digits, opts) { return `${w(opts, 'dots')} ${digits.split('').join(' ')}`; }

// The spoken form of a run of braille cells (BRF ASCII): "dots 1, dots 1 2", a blank cell "blank". Used for cells that did not
// back-translate, and for equations.
export function dotsPhrase(brf, opts) {
  const out = [];
  for (const ch of String(brf || '')) {
    const bits = brfCharDots(ch);
    if (bits == null) continue;
    if (bits === 0) { out.push(w(opts, 'blank')); continue; }
    const dots = [];
    for (let i = 0; i < 6; i++) if (bits & (1 << i)) dots.push(i + 1);
    out.push(dotsWords(dots.join(''), opts));
  }
  return out.join(', ');
}

// Words to say for the back-translated text of one braille word. opts: { standard: 'ukaaf' | 'bana', words }.
export function speakText(text, opts) {
  const bana = !!opts && opts.standard === 'bana';
  const s = String(text == null ? '' : text);
  const out = [];
  const chars = Array.from(s);
  const n = chars.length;
  let i = 0, openSingle = false;
  while (i < n) {
    const ch = chars[i];
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i + 1 < n ? chars[i + 1] : '';
    if (isSpace(ch)) { i++; continue; }
    // liblouis writes a cell it cannot back-translate as \<dots>/
    if (ch === '\\') {
      let j = i + 1, digits = '';
      while (j < n && chars[j] >= '1' && chars[j] <= '8') digits += chars[j++];
      if (digits && chars[j] === '/') { out.push(dotsWords(digits, opts)); i = j + 1; continue; }
    }
    if (isLetter(ch)) {
      if (isUpper(ch)) {
        let j = i + 1;
        if (j < n && isLower(chars[j])) {                       // a capital that begins a word: "cap London"
          while (j < n && (isLower(chars[j]) || isMark(chars[j]))) j++;
          out.push(`${w(opts, 'cap')} ${chars.slice(i, j).join('')}`);
        } else {                                                  // a capital on its own, or among capitals: "cap N"
          while (j < n && isMark(chars[j])) j++;
          out.push(`${w(opts, 'cap')} ${chars.slice(i, j).join('')}`);
        }
        i = j; continue;
      }
      let j = i + 1;
      while (j < n && ((isLetter(chars[j]) && !isUpper(chars[j])) || isMark(chars[j]))) j++;
      out.push(chars.slice(i, j).join(''));
      i = j; continue;
    }
    if (isDigit(ch)) {                                            // a number keeps its decimal point and thousands commas: 3.5, 1,000
      let j = i + 1;
      while (j < n && (isDigit(chars[j]) || ((chars[j] === '.' || chars[j] === ',') && j + 1 < n && isDigit(chars[j + 1])))) j++;
      out.push(chars.slice(i, j).join(''));
      i = j; continue;
    }
    if (ch === '.') {
      let j = i; while (j < n && chars[j] === '.') j++;
      out.push(j - i >= 3 ? w(opts, 'ellipsis') : (bana ? w(opts, 'period') : w(opts, 'full_stop')));
      i = j; continue;
    }
    if (ch === '!') { out.push(bana ? w(opts, 'exclamation_point') : w(opts, 'exclamation_mark')); i++; continue; }
    if (ch === '(' || ch === ')') {
      const open = ch === '(';
      out.push(w(opts, (open ? 'open_' : 'close_') + (bana ? 'parenthesis' : 'bracket')));
      i++; continue;
    }
    if (ch === '[' || ch === ']') {
      const open = ch === '[';
      out.push(w(opts, (open ? 'open_' : 'close_') + (bana ? 'bracket' : 'square_bracket')));
      i++; continue;
    }
    if (ch === '"') {                                             // straight double quote: open at the start of a word or after an opener
      out.push(w(opts, (!prev || isSpace(prev) || OPENERS.has(prev)) && next ? 'open_quote' : 'close_quote'));
      i++; continue;
    }
    if (ch === '’' || ch === "'") {                          // apostrophe, or a single closing / opening quote
      const afterLetter = prev && (isLetter(prev) || isDigit(prev));
      const beforeLetter = next && (isLetter(next) || isDigit(next));
      if (afterLetter && beforeLetter) out.push(w(opts, 'apostrophe'));
      else if ((!prev || isSpace(prev) || OPENERS.has(prev)) && next) { out.push(w(opts, 'open_single_quote')); openSingle = true; }
      else if (openSingle) { out.push(w(opts, 'close_single_quote')); openSingle = false; }
      else out.push(w(opts, afterLetter ? 'apostrophe' : 'close_single_quote'));   // no quote open: a plural possessive (dogs') or a dropped letter
      i++; continue;
    }
    if (ch === '”') { out.push(w(opts, 'close_quote')); i++; continue; }
    if (ch === '\u2018') openSingle = true;
    if (PUNCT[ch]) {
      // a run of hyphens is one dash
      if (ch === '-' && next === '-') { let j = i; while (j < n && chars[j] === '-') j++; out.push(w(opts, 'dash')); i = j; continue; }
      out.push(w(opts, PUNCT[ch])); i++; continue;
    }
    out.push(ch);                                                 // any other symbol: say it as it is
    i++;
  }
  return out.join(' ');
}

// What to say for one braille word: `brf` is its cells (BRF ASCII), `backText` what the braille code's back-translation made of it.
// A word that back-translates to nothing (a lone capital or number sign), or only to dots, is spoken as its dots so a stray
// indicator is heard rather than skipped.
export function readbackWord(brf, backText, opts) {
  const text = String(backText == null ? '' : backText);
  if (!text.trim()) return dotsPhrase(brf, opts);
  return speakText(text, opts);
}

// UEB back-translation (liblouis) misreads a contraction, wordsign or shortform that sits inside brackets: "(quickly)" comes back "(qkly)",
// "(children)" "(chn)", "(it)" "(x)" - which a proofreader would hear as a braille mistake that is not there. So for UEB the enclosing bracket
// cells are taken off, the word is back-translated on its own, and the brackets (and any punctuation after the closing one) are put back.
// `backTranslate(brf)` is the braille code's back-translation of a BRF string; `ueb` says the code is UEB (other codes use other bracket cells).
const UEB_ENCLOSURES = [['"<', '">', '(', ')'], ['.<', '.>', '[', ']'], ['_<', '_>', '{', '}']];
export function backTranslateWord(brf, backTranslate, opts) {
  const plain = backTranslate(brf);
  if (!(opts && opts.ueb)) return plain;
  for (const [o, c, ot, ct] of UEB_ENCLOSURES) {
    const hasOpen = brf.startsWith(o);
    const from = hasOpen ? o.length : 0;
    const ci = brf.lastIndexOf(c);
    if (ci < from || (!hasOpen && ci === 0) || (hasOpen && ci < 0)) continue;
    const inner = brf.slice(from, ci), tail = brf.slice(ci + c.length);
    if (!inner) continue;
    const a = backTranslate(inner);
    let tailText = '';
    if (tail) { const b = backTranslate(inner + tail); if (!b.startsWith(a)) return plain; tailText = b.slice(a.length); }
    return (hasOpen ? ot : '') + a + ct + tailText;
  }
  return plain;
}

// A decorative line of the layout (the line under a list or table: dots 5 and 3 then a run of dots 1 ...): six or more cells made of at most
// three kinds of cell. The editor asks this only of a word with no print behind it, and says "line" instead of reading it cell by cell.
export function isRuleToken(brf) {
  const s = String(brf || '');
  return s.length >= 6 && new Set(s).size <= 3;
}
