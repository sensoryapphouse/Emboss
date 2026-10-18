// Old-style Word equations -> MathML.
//
// Equation Editor 3.0 ("Equation.3") and MathType ("Equation.DSMT4" ... "DSMT7") equations
// are embedded in Word files as OLE objects: in a .docx, `<w:object><o:OLEObject r:id=…>`
// points at `word/embeddings/oleObjectN.bin`, an OLE2 compound file (see cfb.mjs) holding an
// "Equation Native" stream = a 28-byte EQNOLEFILEHDR followed by MTEF, the binary equation
// format (version 3 for Equation Editor 3.x, 4 for MathType 3.5, 5 for MathType 4 and later).
// This module parses MTEF and converts it to presentation MathML in the same shape the OMML
// converter (omml.mjs) produces for a modern Word equation, so an old equation then flows
// through the editor / NIMAS export / MathCAT braille exactly like a new one.
//
// Written for Emboss from the published format descriptions — "MathType MTEF v.3 (Equation
// Editor 3.x)", "MTEF v.4 (MathType 3.5)" and "MTEF v.5 (MathType 4.0 and later)" (Design
// Science, archived at rtf2latex2e.sourceforge.net) — with three open-source readers
// consulted (not copied) to settle points where the published text is wrong or silent:
// LibreOffice starmath/source/mathtype.cxx (MPL-2.0), the Ruby `mathtype` +
// `mathtype_to_mathml` gems (MIT) and MTEF-py (Apache-2.0). Findings taken from them:
//   * big-operator slots are main, LOWER, UPPER, operator char (the spec lists upper first;
//     all three readers, which were checked against real files, use lower first);
//   * MTEF 5 limit variation bits are 0x10 lower / 0x20 upper / 0x40 summation-style
//     (the spec's 0x01/0x02 collide with the integral-count bits);
//   * a sub/superscript template scripts the item that PRECEDES it in the line;
//   * a radical's first slot is the radicand, the second the (optional) index;
//   * Equation Editor 3.0 character values are Unicode (MTCode); Symbol-font positions only
//     appear in MTEF 2/4 and explicit "Symbol" fonts.
//
// API
//   equationNativeToMathML(streamBytes) -> string     the "Equation Native" stream's bytes
//   mtefToMathML(mtefBytes)            -> string      raw MTEF (header onwards)
//   oleEquationToMathML(oleBytes)      -> string      a whole OLE object (.bin, a CFB file)
//   readOleEquation(oleBytes)          -> { mathml } | { error }   never throws
//   parseMtef(mtefBytes)               -> { version, platform, product, inline, body }
//   class MtefError extends Error
// Every converter throws MtefError (or CfbError from cfb.mjs) when the equation cannot be
// read faithfully — an unknown template, a character with no Unicode meaning, truncated
// data — rather than guess; the caller then keeps its "equation not transcribed" note.

import { readCfb, isCfb } from './cfb.mjs';

export class MtefError extends Error {
  constructor(message) { super(message); this.name = 'MtefError'; }
}

// ---------------------------------------------------------------------------------------
// Byte reader
// ---------------------------------------------------------------------------------------
class Reader {
  constructor(u8) { this.u8 = u8; this.pos = 0; }
  get eof() { return this.pos >= this.u8.length; }
  byte() {
    if (this.pos >= this.u8.length) throw new MtefError(`MTEF data ends unexpectedly at byte ${this.pos}`);
    return this.u8[this.pos++];
  }
  peek() { return this.pos < this.u8.length ? this.u8[this.pos] : -1; }
  u16() { const lo = this.byte(); return lo | (this.byte() << 8); }
  s16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  mtuint() { const b = this.byte(); return b < 255 ? b : this.u16(); }
  stringz() {
    let s = '';
    for (;;) { const b = this.byte(); if (!b) return s; s += String.fromCharCode(b); }
  }
  skip(n) {
    if (this.pos + n > this.u8.length) throw new MtefError('MTEF data ends inside a record');
    this.pos += n;
  }
}

function toU8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes && bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new MtefError('expected bytes');
}

// ---------------------------------------------------------------------------------------
// MTEF parser -> a small record tree
//   { t:'line', null:bool, items:[…] }   { t:'char', face, code, pos8, embell:[n], fn }
//   { t:'tmpl', sel, vari, subs:[…] }    { t:'pile', halign, lines:[…] }
//   { t:'matrix', rows, cols, cells:[…] } { t:'embell', type }
// Size, colour, font, ruler and preference records are read and dropped (they only affect
// print appearance), except fonts, which are kept to resolve explicit-font characters.
// ---------------------------------------------------------------------------------------
const END = 0, LINE = 1, CHAR = 2, TMPL = 3, PILE = 4, MATRIX = 5, EMBELL = 6, RULER = 7;
const MAX_DEPTH = 200;

export function parseMtef(bytes) {
  const r = new Reader(toU8(bytes));
  const version = r.byte();
  if (version < 2 || version > 5) throw new MtefError(`unsupported MTEF version ${version}`);
  const platform = r.byte();
  const product = r.byte();
  r.byte(); r.byte();                                      // product version / subversion
  let inline = false;
  if (version === 5) {
    r.stringz();                                           // application key, e.g. "DSMT4"
    inline = !!(r.byte() & 1);
  }
  const v5 = version === 5;
  const fonts = new Map();            // v2-4: typeface (negative) -> font name
  const fontDefs = [];                // v5: FONT_DEF names (1-based)
  const fontStyleDefs = [];           // v5: FONT_STYLE_DEF -> font def index (1-based)
  let depth = 0;

  const nudge = () => {
    const dx = r.byte(), dy = r.byte();
    if (dx === 128 && dy === 128) { r.u16(); r.u16(); }
  };
  const ruler = () => {
    const n = r.byte();
    for (let i = 0; i < n; i++) { r.byte(); r.u16(); }
  };
  // A RULER that follows a LINE/PILE (option xfRULER / mtefOPT_LP_RULER) is written as a
  // whole record in the files seen by LibreOffice's reader; tolerate it with or without its
  // record-type byte.
  const optionalRuler = () => {
    const p = r.peek();
    if ((v5 ? p : (p & 0x0F)) === RULER) r.byte();
    ruler();
  };
  const nibbleArray = () => {
    const count = r.byte();
    let done = 0, hi = true, cur = 0, inValue = false;
    while (done < count) {
      let nib;
      if (hi) { cur = r.byte(); nib = cur >> 4; } else nib = cur & 0x0F;
      hi = !hi;
      if (!inValue) inValue = true;                        // units nibble
      else if (nib === 0x0F) { inValue = false; done++; }
    }
  };

  // Read one record; returns null for END, undefined for records that carry no structure.
  const record = () => {
    const tag = r.byte();
    const type = v5 ? tag : tag & 0x0F;
    if (type === END) return null;
    if (v5 && type >= 100) { r.skip(r.mtuint()); return undefined; }   // future-expansion records
    const opt = v5 ? (type <= EMBELL ? r.byte() : 0) : tag >> 4;
    const NUDGE = 0x08;
    switch (type) {
      case LINE: {
        if (opt & NUDGE) nudge();
        if (opt & 0x04) r.u16();                           // line spacing
        if (opt & 0x02) optionalRuler();
        if (opt & 0x01) return { t: 'line', null: true, items: [] };
        return { t: 'line', null: false, items: list() };
      }
      case CHAR: {
        if (opt & NUDGE) nudge();
        let face = r.byte() - 128;
        let code = null, pos8 = null;
        if (v5) {
          if (!(opt & 0x20)) code = r.u16();               // MTCode unless mtefOPT_CHAR_ENC_NO_MTCODE
          if (opt & 0x04) pos8 = r.byte();                 // 8-bit font position
          if (opt & 0x10) pos8 = r.u16();                  // 16-bit font position
        } else {
          code = version < 3 ? r.byte() : r.u16();
        }
        const embellFlag = v5 ? 0x01 : 0x02;
        const fnFlag = v5 ? 0x02 : 0x01;
        const embell = [];
        if (opt & embellFlag) {
          for (const e of list()) if (e && e.t === 'embell') embell.push(e.type);
        }
        // Only MTEF 5 marks the START of a function name; MTEF 3's xfAUTO just means "auto-recognised".
        return { t: 'char', face, code, pos8, embell, fn: v5 && !!(opt & fnFlag) };
      }
      case TMPL: {
        if (opt & NUDGE) nudge();
        const sel = r.byte();
        let vari = r.byte();
        if (v5 && (vari & 0x80)) vari = (vari & 0x7F) | (r.byte() << 8);
        r.byte();                                          // template-specific options
        return { t: 'tmpl', sel, vari, subs: list() };
      }
      case PILE: {
        if (opt & NUDGE) nudge();
        const halign = r.byte();
        r.byte();                                          // valign
        if (opt & 0x02) optionalRuler();
        return { t: 'pile', halign, lines: list() };
      }
      case MATRIX: {
        if (opt & NUDGE) nudge();
        r.byte(); r.byte(); r.byte();                      // valign, h_just, v_just
        const rows = r.byte(), cols = r.byte();
        r.skip(Math.ceil((rows + 1) * 2 / 8));             // row partition lines
        r.skip(Math.ceil((cols + 1) * 2 / 8));             // column partition lines
        return { t: 'matrix', rows, cols, cells: list() };
      }
      case EMBELL: {
        if (opt & NUDGE) nudge();
        return { t: 'embell', type: r.byte() };
      }
      case RULER: ruler(); return undefined;
      case 8:
        if (v5) { fontStyleDefs.push(r.mtuint()); r.byte(); }                 // FONT_STYLE_DEF
        else { const tf = r.byte() - 128; r.byte(); fonts.set(tf, r.stringz()); } // FONT
        return undefined;
      case 9: {                                            // SIZE
        const b = r.byte();
        if (b === 101) r.u16();
        else if (b === 100) { r.byte(); r.u16(); }
        else r.byte();
        return undefined;
      }
      case 10: case 11: case 12: case 13: case 14: return undefined;   // FULL/SUB/SUB2/SYM/SUBSYM
    }
    if (!v5) throw new MtefError(`unknown MTEF record type ${type}`);
    switch (type) {
      case 15: r.mtuint(); return undefined;               // COLOR
      case 16: {                                           // COLOR_DEF
        const o = r.byte();
        for (let i = 0; i < ((o & 1) ? 4 : 3); i++) r.u16();
        if (o & 4) r.stringz();
        return undefined;
      }
      case 17: r.mtuint(); fontDefs.push(r.stringz()); return undefined;   // FONT_DEF
      case 18: {                                           // EQN_PREFS
        r.byte();
        nibbleArray();                                     // sizes
        nibbleArray();                                     // spacing
        const n = r.byte();
        for (let i = 0; i < n; i++) if (r.mtuint()) r.byte();
        return undefined;
      }
      case 19: r.stringz(); return undefined;              // ENCODING_DEF
    }
    throw new MtefError(`unknown MTEF record type ${type}`);
  };

  // An object list: records up to (and consuming) END.
  function list() {
    if (++depth > MAX_DEPTH) throw new MtefError('MTEF structure is nested too deeply');
    const out = [];
    for (;;) {
      const rec = record();
      if (rec === null) break;
      if (rec !== undefined) out.push(rec);
    }
    depth--;
    return out;
  }

  // Top level: definitions, sizes, then one LINE or PILE, then END (a missing final END at
  // the very end of the data is tolerated).
  const body = [];
  while (!r.eof) {
    const rec = record();
    if (rec === null) break;
    if (rec !== undefined) body.push(rec);
  }
  const fontName = (face) => {
    if (face >= 0) return null;
    if (!v5) return fonts.get(face) || null;
    const fsd = fontStyleDefs[-face - 1];
    return (fsd && fontDefs[fsd - 1]) || null;
  };
  return { version, platform, product, inline, body, fontName };
}

// ---------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------
const F_TEXT = 1, F_FUNCTION = 2, F_VARIABLE = 3, F_LCGREEK = 4, F_UCGREEK = 5, F_SYMBOL = 6,
  F_VECTOR = 7, F_NUMBER = 8, F_TEXT_FE = 12, F_EXPAND = 22, F_MARKER = 23, F_SPACE = 24;

// Adobe Symbol font positions -> Unicode (used only for MTEF 2/4 symbol styles, explicit
// "Symbol" fonts, and Greek-style characters stored as Latin letters).
const SYMBOL_FONT = (() => {
  const m = new Map();
  const greekLower = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
  const greekUpper = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
  for (let i = 0; i < 26; i++) { m.set(0x61 + i, greekLower[i]); m.set(0x41 + i, greekUpper[i]); }
  const extra = {
    0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2A: '∗', 0x2D: '−', 0x40: '≅', 0x5C: '∴', 0x5E: '⊥', 0x60: '‾', 0x7E: '∼',
    0xA1: 'ϒ', 0xA2: '′', 0xA3: '≤', 0xA4: '⁄', 0xA5: '∞', 0xA6: 'ƒ', 0xAB: '↔', 0xAC: '←', 0xAD: '↑', 0xAE: '→', 0xAF: '↓',
    0xB0: '°', 0xB1: '±', 0xB2: '″', 0xB3: '≥', 0xB4: '×', 0xB5: '∝', 0xB6: '∂', 0xB7: '•', 0xB8: '÷', 0xB9: '≠',
    0xBA: '≡', 0xBB: '≈', 0xBC: '…', 0xC0: 'ℵ', 0xC1: 'ℑ', 0xC2: 'ℜ', 0xC3: '℘', 0xC4: '⊗', 0xC5: '⊕', 0xC6: '∅',
    0xC7: '∩', 0xC8: '∪', 0xC9: '⊃', 0xCA: '⊇', 0xCB: '⊄', 0xCC: '⊂', 0xCD: '⊆', 0xCE: '∈', 0xCF: '∉', 0xD0: '∠',
    0xD1: '∇', 0xD5: '∏', 0xD6: '√', 0xD7: '⋅', 0xD8: '¬', 0xD9: '∧', 0xDA: '∨', 0xDB: '⇔', 0xDC: '⇐', 0xDD: '⇑',
    0xDE: '⇒', 0xDF: '⇓', 0xE0: '◊', 0xE1: '〈', 0xE5: '∑', 0xF1: '〉', 0xF2: '∫',
  };
  for (const [k, v] of Object.entries(extra)) m.set(Number(k), v);
  return m;
})();

// MTCode private-use characters (MathType's extension of Unicode) with a real meaning.
const MTCODE_PUA = new Map(Object.entries({
  0xE083: '+', 0xE421: '⩾', 0xE425: '⩽',
  0xE901: '⩲', 0xE902: '⩱', 0xE903: '⨦', 0xE904: '⨤', 0xE90B: '⊇', 0xE90C: '⊆', 0xE922: '⋚', 0xE924: '⩪',
  0xE92D: '⋛', 0xE932: '≲', 0xE933: '≳', 0xE93A: '≾', 0xE93B: '≿', 0xE98F: '·', 0xEA06: '≰', 0xEA07: '≱',
  0xEA0B: '⊉', 0xEA0C: '⊈', 0xEA32: '⪉', 0xEA33: '⪊', 0xEA34: '≨', 0xEA35: '≩', 0xEA3A: '⋨', 0xEA3B: '⋩',
  0xEA40: '⪵', 0xEA41: '⪶', 0xEA42: '⊈', 0xEA43: '⊉', 0xEA44: '⊊', 0xEA45: '⊋',
  0xEE04: '˜', 0xEE05: '˜', 0xEE06: '˜', 0xEE07: '^', 0xEE08: '^', 0xEE09: '^', 0xEE0A: '⌢', 0xEE0B: '⌢', 0xEE0C: '⌢',
  0xEE19: '⁗',
  // Differential d / exponential e / imaginary i, j (MathType's "upright" math letters).
  0xED10: 'd', 0xED11: 'e', 0xED12: 'i', 0xED13: 'j', 0xED16: 'D',
}).map(([k, v]) => [Number(k), v]));
// Spacing characters: nothing to transcribe. (EF00-EF08 in MathType 4+, EB01-EB08 in
// Equation Editor 3.0's MT Extra encoding.)
const isSpaceCode = (code, version) => (code >= 0xEF00 && code <= 0xEF08) || (version < 5 && code >= 0xEB00 && code <= 0xEB08)
  || code === 0x20 || code === 0x09 || code === 0xA0 || (code >= 0x2000 && code <= 0x200B) || code === 0x205F || code === 0xFEFF;

// Mathematical alphanumeric ranges MathType maps into private use.
const LETTERLIKE_HOLES = {
  fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
  double: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
  script: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
};
function mathAlnum(code) {
  const ranges = [[0xF000, 'fraktur', 0x1D504], [0xF080, 'double', 0x1D538], [0xF100, 'script', 0x1D49C]];
  for (const [base, kind, uni] of ranges) {
    if (code >= base && code < base + 52) {
      const i = code - base;
      const letter = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(97 + i - 26);
      return LETTERLIKE_HOLES[kind][letter] || String.fromCodePoint(uni + i);
    }
  }
  if (code >= 0xF0C0 && code <= 0xF0C9) return String.fromCodePoint(0x1D7D8 + code - 0xF0C0);
  return null;
}

// The Unicode text of a CHAR record, or '' for a pure spacing character.
function charText(rec, ctx) {
  let code = rec.code;
  const font = ctx.fontName(rec.face);
  const symbolFont = font && /symbol/i.test(font);
  if (code == null) {                                      // MTEF 5 with no MTCode: font position only
    if (rec.pos8 == null) throw new MtefError('character with no code');
    if (symbolFont && SYMBOL_FONT.has(rec.pos8)) return SYMBOL_FONT.get(rec.pos8);
    code = rec.pos8;
  }
  // Symbol-font positions: MTEF 2/4 symbol styles, explicit Symbol fonts, and Greek-style
  // characters stored as plain Latin letters.
  if (code < 0x100) {
    const greekFace = rec.face === F_LCGREEK || rec.face === F_UCGREEK;
    const legacySymbol = ctx.version !== 3 && ctx.version !== 5 && rec.face === F_SYMBOL;
    if ((symbolFont || legacySymbol || (greekFace && /[A-Za-z]/.test(String.fromCharCode(code)))) && SYMBOL_FONT.has(code)) {
      return SYMBOL_FONT.get(code);
    }
  }
  if (isSpaceCode(code, ctx.version)) return '';
  if (code >= 0xE000 && code <= 0xF8FF) {
    if (MTCODE_PUA.has(code)) return MTCODE_PUA.get(code);
    const alnum = mathAlnum(code);
    if (alnum) return alnum;
    throw new MtefError(`character U+${code.toString(16).toUpperCase().padStart(4, '0')} (MathType private use) has no known meaning`);
  }
  if (code < 0x20) return '';
  return String.fromCodePoint(code);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LETTER_RE = /^[\p{L}]$/u;
const DIGIT_RE = /^[0-9]$/;
// Symbols that are identifiers (ordinary symbols), not operators, even in the Symbol style.
const MI_SYMBOLS = new Set(['∞', '∂', '∅', 'ℵ', 'ℏ', '℘', 'ℑ', 'ℜ', '∇', '△', '∠']);

// Classify one character: { kind: 'mi'|'mn'|'mo'|'text'|'fn'|'skip', text, bold }
function classify(rec, ctx) {
  const face = rec.face;
  if (face === F_EXPAND || face === F_MARKER || face === F_SPACE) return { kind: 'skip' };
  const text = charText(rec, ctx);
  if (!text) return { kind: face === F_TEXT || face === F_TEXT_FE ? 'text' : 'skip', text: ' ' };
  const letter = LETTER_RE.test(text) || /^[\u{1D400}-\u{1D7FF}ℂℍℕℙℚℝℤℭℌℑℜℨℬℰℱℋℐℒℳℛℯℊℴ]$/u.test(text);
  const digit = DIGIT_RE.test(text) || /^[\u{1D7D8}-\u{1D7E1}]$/u.test(text);
  if (face === F_TEXT || face === F_TEXT_FE) {
    if (letter || text === '\'') return { kind: 'text', text };
    if (digit) return { kind: 'mn', text };
    return { kind: 'mo', text };
  }
  if (face === F_FUNCTION && letter) return { kind: 'fn', text };
  if (face === F_NUMBER && (digit || text === '.')) return { kind: 'mn', text };
  if (digit) return { kind: 'mn', text, bold: face === F_VECTOR };
  if (letter) return { kind: 'mi', text, bold: face === F_VECTOR };
  if (MI_SYMBOLS.has(text)) return { kind: 'mi', text };
  return { kind: 'mo', text };
}

// ---------------------------------------------------------------------------------------
// MathML building helpers
// ---------------------------------------------------------------------------------------
const mrow = (inner) => `<mrow>${inner}</mrow>`;
const mo = (ch) => `<mo>${escapeXml(ch)}</mo>`;
const group = (nodes) => (nodes.length === 1 ? nodes[0] : mrow(nodes.join('')));
const EMPTY = '<mrow></mrow>';

// Character embellishments (EMBELL record types). Glyphs chosen so MathCAT gives real
// UEB and Nemeth accents: two/three/four dots are repeated U+02D9 (MathCAT has no braille
// for U+00A8 or the combining U+20DB/20DC in Nemeth).
const EMBELL_OVER = { 2: '˙', 3: '˙˙', 4: '˙˙˙', 24: '˙˙˙˙', 8: '˜', 9: '^', 11: '→', 12: '←', 13: '↔', 14: '⇀', 15: '↼', 17: '¯', 19: '⌢', 20: '⌣' };
const EMBELL_UNDER = { 25: '˙', 26: '˙˙', 27: '˙˙˙', 28: '˙˙˙˙', 29: '¯', 30: '˜', 31: '⌢', 32: '⌣', 33: '→', 34: '←', 35: '↔', 36: '⇀', 37: '↼' };
const EMBELL_PRIME = { 5: '′', 6: '″', 18: '‴' };
function applyEmbellishments(node, types) {
  let out = node;
  let primes = '';
  let backPrime = false;
  for (const e of types) {
    if (EMBELL_PRIME[e]) primes += EMBELL_PRIME[e];
    else if (e === 7) backPrime = true;
    else if (EMBELL_OVER[e]) out = `<mover accent="true">${out}${mo(EMBELL_OVER[e])}</mover>`;
    else if (EMBELL_UNDER[e]) out = `<munder accentunder="true">${out}${mo(EMBELL_UNDER[e])}</munder>`;
    else if (e === 10) out = `<menclose notation="updiagonalstrike">${out}</menclose>`;
    else if (e === 16) out = `<menclose notation="horizontalstrike">${out}</menclose>`;
    else if (e === 21) out = `<menclose notation="updiagonalstrike downdiagonalstrike">${out}</menclose>`;
    else if (e === 22) out = `<menclose notation="updiagonalstrike">${out}</menclose>`;
    else if (e === 23) out = `<menclose notation="downdiagonalstrike">${out}</menclose>`;
    else throw new MtefError(`unknown embellishment ${e}`);
  }
  if (primes) out = `<msup>${out}${mo(primes)}</msup>`;
  if (backPrime) out = `<mmultiscripts>${out}<mprescripts/><none/>${mo('′')}</mmultiscripts>`;
  return out;
}

// ---------------------------------------------------------------------------------------
// Templates: selector/variation -> a version-independent description
// ---------------------------------------------------------------------------------------
const FENCES = [['⟨', '⟩'], ['(', ')'], ['{', '}'], ['[', ']'], ['|', '|'], ['‖', '‖'], ['⌊', '⌋'], ['⌈', '⌉'], ['⟦', '⟧']];
const BIGOPS = { sum: '∑', prod: '∏', coprod: '∐', union: '⋃', inter: '⋂' };
const INTEGRALS = { 1: '∫', 2: '∬', 3: '∭' };
const LOOP_INTEGRALS = { 1: '∮', 2: '∯', 3: '∰' };

function describeTemplate(version, sel, vari) {
  if (version === 5) {
    if (sel <= 8) {
      const [l, r] = FENCES[sel];
      return { kind: 'fence', left: vari & 1 ? l : '', right: vari & 2 ? r : '' };
    }
    if (sel === 9) {
      const pick = (n) => ['(', ')', '[', ']'][n & 3];
      return { kind: 'fence', left: pick(vari), right: pick(vari >> 4), useChars: true };
    }
    if (sel === 10) return { kind: 'root' };
    if (sel === 11) return { kind: 'frac', slash: !!(vari & 2), linear: !!(vari & 2) && !!(vari & 4) };
    if (sel === 12 || sel === 13) return { kind: 'bar', under: sel === 12, double: !!(vari & 1) };
    if (sel === 14) {
      let ch;
      if (vari & 1) ch = vari & 0x20 ? '⇆' : '⇄';
      else if (vari & 2) ch = vari & 0x20 ? '⇋' : '⇌';
      else ch = (vari & 0x30) === 0x10 ? '←' : (vari & 0x30) === 0x20 ? '→' : '↔';
      return { kind: 'arrow', ch, top: !!(vari & 4), bottom: !!(vari & 8) };
    }
    if (sel >= 15 && sel <= 22) {
      const lower = !!(vari & 0x10), upper = !!(vari & 0x20), sumStyle = !!(vari & 0x40);
      let ch;
      if (sel === 15) {
        const n = (vari & 3) || 1;
        const loop = vari & 0x0C;
        ch = loop === 0x08 ? '∲' : loop === 0x0C ? '∳' : loop ? LOOP_INTEGRALS[n] : INTEGRALS[n];
      } else ch = [BIGOPS.sum, BIGOPS.prod, BIGOPS.coprod, BIGOPS.union, BIGOPS.inter, '∫', '∑'][sel - 16];
      return { kind: 'bigop', ch, lower, upper, sumStyle, useChar: sel >= 16 };
    }
    if (sel === 23) return { kind: 'lim' };
    if (sel === 24 || sel === 25) return { kind: 'hbrace', top: !!(vari & 1), brace: sel === 24 };
    if (sel === 26) return { kind: 'ldiv', quotient: !!(vari & 1) };
    if (sel >= 27 && sel <= 29) return { kind: 'script', sub: sel !== 28, sup: sel !== 27, pre: !!(vari & 1) };
    if (sel === 30) return { kind: 'dirac', left: !!(vari & 1), right: !!(vari & 2) };
    if (sel === 31) {
      const harpoon = !!(vari & 8);
      const ch = (vari & 3) === 3 ? '↔' : vari & 1 ? (harpoon ? '↼' : '←') : (harpoon ? '⇀' : '→');
      return { kind: 'accent', ch, under: !!(vari & 4) };
    }
    if (sel === 32) return { kind: 'accent', ch: '˜' };
    if (sel === 33) return { kind: 'accent', ch: '^' };
    if (sel === 34) return { kind: 'accent', ch: '⌢' };
    if (sel === 35) return { kind: 'enclose', notation: 'actuarial' };
    if (sel === 36) {
      const n = vari & 1 ? 'horizontalstrike' : [vari & 2 ? 'updiagonalstrike' : '', vari & 4 ? 'downdiagonalstrike' : ''].filter(Boolean).join(' ') || 'updiagonalstrike';
      return { kind: 'enclose', notation: n };
    }
    if (sel === 37) {
      const sides = ['left', 'right', 'top', 'bottom'].filter((_, i) => vari & (2 << i));
      const n = sides.length === 4 || !sides.length ? (vari & 1 ? 'roundedbox' : 'box') : sides.join(' ');
      return { kind: 'enclose', notation: n };
    }
    throw new MtefError(`unknown MathType template selector ${sel}`);
  }
  // MTEF 2-4 (Equation Editor 3.x, MathType 3.x)
  if (sel <= 7) {
    const [l, r] = FENCES[sel];
    if (sel >= 6) return { kind: 'fence', left: l, right: r };
    return { kind: 'fence', left: vari === 2 ? '' : l, right: vari === 1 ? '' : r };
  }
  if (sel <= 12) {
    const pairs = { 8: ['[', '['], 9: [']', ']'], 10: [']', '['], 11: ['[', ')'], 12: ['(', ']'] };
    return { kind: 'fence', left: pairs[sel][0], right: pairs[sel][1] };
  }
  if (sel === 13) return { kind: 'root' };
  if (sel === 14) return { kind: 'frac' };
  if (sel === 15) return { kind: 'script', sub: vari !== 0, sup: vari !== 1, pre: false };
  if (sel === 16 || sel === 17) return { kind: 'bar', under: sel === 16, double: vari === 1 };
  if (sel >= 18 && sel <= 20) return { kind: 'arrow', ch: ['←', '→', '↔'][sel - 18], top: vari !== 1, bottom: vari === 1, single: true };
  if (sel >= 21 && sel <= 26) {
    const n = [1, 2, 3, 1, 2, 3][sel - 21];
    const loop = (sel === 21 && (vari === 3 || vari === 4)) || ((sel === 22 || sel === 23) && vari >= 2)
      || (sel === 24 && vari === 2) || ((sel === 25 || sel === 26) && vari === 0);
    const lowerOnly = sel <= 23 ? (sel === 21 ? vari === 1 || vari === 4 : vari === 1 || vari === 3) : !(sel === 24 && vari === 0);
    const both = (sel === 21 && vari === 2) || (sel === 24 && vari === 0);
    return { kind: 'bigop', ch: loop ? LOOP_INTEGRALS[n] : INTEGRALS[n], lower: lowerOnly || both, upper: both, sumStyle: sel >= 24 };
  }
  if (sel === 27 || sel === 28) return { kind: 'hbrace', top: sel === 27, brace: true };
  if (sel >= 29 && sel <= 38) {
    const op = [BIGOPS.sum, BIGOPS.prod, BIGOPS.coprod, BIGOPS.union, BIGOPS.inter][(sel - 29) >> 1];
    const intStyle = (sel - 29) % 2 === 1;
    return { kind: 'bigop', ch: op, lower: vari !== 2, upper: vari === 1, sumStyle: !intStyle };
  }
  if (sel === 39) return { kind: 'lim', lower: vari !== 0, upper: vari !== 1 };
  if (sel === 40) return { kind: 'ldiv', quotient: vari === 0 };
  if (sel === 41) return { kind: 'frac', slash: true, linear: vari === 1 };
  if (sel === 42 || sel === 43) return { kind: 'bigop', ch: sel === 42 ? '∫' : '∑', lower: vari !== 0, upper: vari !== 1, sumStyle: sel === 43, useChar: true };
  if (sel === 44) return { kind: 'script', sub: vari !== 0, sup: vari !== 1, pre: true };
  if (sel === 45) return { kind: 'dirac', left: vari !== 2, right: vari !== 1 };
  if (sel === 46 || sel === 47) return { kind: 'accent', ch: ['←', '→', '↔'][vari] || '→', under: sel === 46 };
  if (sel === 48) return { kind: 'accent', ch: '⌢' };
  throw new MtefError(`unknown Equation Editor template selector ${sel}`);
}

// ---------------------------------------------------------------------------------------
// Tree -> MathML
// ---------------------------------------------------------------------------------------
// Function names (import fix list #31, .doc part; Paul's A84 decision for Word equations, omml.mjs convertFunc): a function is
// <mi>name</mi> followed by U+2061 (FUNCTION APPLICATION), never <mtext>. Equation Editor writes a function name in its Function style
// (an 'fn' run here); LibreOffice Math and MathType users also write it in the Text style, so a Text-style word that is exactly a
// known function name is the function too (the list is mathml-to-latex.mjs's MATH_FUNCS plus the inverse functions and sgn).
const FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'Pr',
  'det', 'gcd', 'deg', 'dim', 'ker', 'hom', 'arg', 'sgn',
]);
const APPLY_FUNCTION = '\u2061';
// omml.mjs FUNCTION_SPACE: UEB (Guidelines for Technical Material 9.3.3) spaces a function name from a letter before it; MathCAT does
// not see a letter inside a script ("a_n cos"), so an explicit space stands between them. Nemeth ignores it.
const FUNCTION_SPACE = '<mspace width="0.3em"/>';
// The text a MathML string shows (its tags dropped)
const textOfMathML = (x) => x.replace(/<[^>]*>/g, '');
// MathML of an opening bracket / a bracketed group / anything that can be the argument of a function; an operator cannot
const OPENERS = new Set(['(', '[', '{', '\u27E8', '\u230A', '\u2308', '\u27E6']);
function canBeArgument(node) {
  const m = /^<mo\b[^>]*>([^<]*)<\/mo>$/.exec(node);
  return !m || OPENERS.has(m[1]);
}
// The nodes of one line, with U+2061 after each function name that has an argument following it and the UEB space before a function
// that follows a script ending in a letter. `meta[i]` = { fn, scriptLetter } for nodes[i].
function finishLine(nodes, meta) {
  const out = [];
  nodes.forEach((node, i) => {
    const m = meta[i] || {};
    if (m.fn && i > 0 && (meta[i - 1] || {}).scriptLetter) out.push(FUNCTION_SPACE);
    out.push(node);
    if (m.fn && i + 1 < nodes.length && canBeArgument(nodes[i + 1])) out.push(mo(APPLY_FUNCTION));
  });
  return out;
}
// A fence of a bracket template: stretchy (MathType brackets always grow with their content), as omml.mjs writes Word's m:d; a missing
// bracket is an empty fence element so the print view still knows the group was fenced (\left. / \right.)
const fence = (ch) => `<mo fence="true" stretchy="true">${escapeXml(ch)}</mo>`;

function convertLine(items, ctx) {
  const nodes = [];
  const meta = [];                                         // per node: { fn: a function name, scriptLetter: a script ending in a Latin letter }
  let run = null;                                          // { kind, text, bold }
  let pendingPre = null;                                   // prescripts waiting for their base
  const push = (node, m = null) => {
    if (pendingPre) { const p = pendingPre; pendingPre = null; nodes.push(`<mmultiscripts>${node}<mprescripts/>${p.sub}${p.sup}</mmultiscripts>`); meta.push(null); }
    else { nodes.push(node); meta.push(m); }
  };
  const flush = () => {
    if (!run) return;
    const r = run; run = null;
    if (r.kind === 'mn') push(`<mn${r.bold ? ' mathvariant="bold"' : ''}>${escapeXml(r.text)}</mn>`);
    else if (r.kind === 'fn') push(`<mi>${escapeXml(r.text)}</mi>`, { fn: true });
    else if (r.kind === 'text') {
      // Spaces around words are kept (as no-break spaces, like omml.mjs's plain-text runs):
      // MathCAT needs them to space "2 if y" correctly in braille.
      const t = r.text.trim();
      if (!t) return;
      if (FUNCTION_NAMES.has(t)) push(`<mi>${escapeXml(t)}</mi>`, { fn: true });
      else if (t.length === 1 && LETTER_RE.test(t)) push(`<mi mathvariant="normal">${escapeXml(t)}</mi>`);
      else push(`<mtext>${escapeXml(r.text.replace(/ /g, '\u00A0'))}</mtext>`);
    }
  };
  for (const it of items) {
    if (it.t === 'char') {
      const c = classify(it, ctx);
      if (c.kind === 'skip') continue;
      const embellished = it.embell.length > 0;
      const mergeable = (c.kind === 'mn' || c.kind === 'fn' || c.kind === 'text') && !embellished;
      if (mergeable && run && run.kind === c.kind && !(c.kind === 'fn' && it.fn) && run.bold === c.bold) { run.text += c.text; continue; }
      flush();
      if (mergeable) { run = { kind: c.kind, text: c.text, bold: c.bold }; continue; }
      let node;
      if (c.kind === 'mn' || c.kind === 'mi') node = `<${c.kind}${c.bold ? ' mathvariant="bold"' : ''}>${escapeXml(c.text)}</${c.kind}>`;
      else if (c.kind === 'fn') node = `<mi>${escapeXml(c.text)}</mi>`;
      else if (c.kind === 'text') node = LETTER_RE.test(c.text) ? `<mi mathvariant="normal">${escapeXml(c.text)}</mi>` : `<mtext>${escapeXml(c.text)}</mtext>`;
      else node = mo(c.text);
      push(embellished ? applyEmbellishments(node, it.embell) : node, c.kind === 'fn' && !embellished ? { fn: true } : null);
      continue;
    }
    flush();
    if (it.t === 'tmpl') {
      const d = describeTemplate(ctx.version, it.sel, it.vari);
      if (d.kind === 'script') {
        const { sub, sup } = scriptSlots(it, d, ctx);
        if (d.pre) { pendingPre = { sub: sub || '<none/>', sup: sup || '<none/>' }; continue; }
        const base = nodes.length ? nodes.pop() : EMPTY;
        const baseMeta = meta.pop() || null;
        const last = sup || sub;                                      // the script that ends the construct (a sub-superscript: the superscript)
        const m = { fn: !!(baseMeta && baseMeta.fn), scriptLetter: !!last && /[A-Za-z]\s*$/.test(textOfMathML(last)) };
        if (sub && sup) nodes.push(`<msubsup>${base}${sub}${sup}</msubsup>`);
        else if (sub) nodes.push(`<msub>${base}${sub}</msub>`);
        else if (sup) nodes.push(`<msup>${base}${sup}</msup>`);
        else nodes.push(base);
        meta.push(m);
        continue;
      }
      // Long division is a spatial layout (divisor before the template, dividend under the
      // bracket, quotient above). MathCAT reads MathML's longdiv enclosure as the bare
      // digits ("3)45" came out as "345"), which is wrong, so leave it to the transcriber.
      if (d.kind === 'ldiv') throw new MtefError('long division layout is not converted');
      push(convertTemplate(it, d, ctx), templateIsFunction(d, it, ctx) ? { fn: true } : null);   // a limit template (lim, max, min ... under a limit) is a function name
    } else if (it.t === 'pile') push(convertPile(it, ctx));
    else if (it.t === 'matrix') push(convertMatrix(it, ctx));
    else if (it.t === 'line') { const inner = it.null ? '' : convertLine(it.items, ctx); if (inner) push(inner); }
    else if (it.t === 'embell') throw new MtefError('embellishment outside a character');
  }
  flush();
  if (pendingPre) { nodes.push(`<mmultiscripts>${EMPTY}<mprescripts/>${pendingPre.sub}${pendingPre.sup}</mmultiscripts>`); meta.push(null); }
  const finished = finishLine(nodes, meta);
  return finished.length ? group(finished) : '';
}

// A template's object list split into slots (LINE/PILE, in order; a null line is EMPTY)
// and characters (fence / operator / arrow glyphs).
function splitSubs(tmpl, ctx) {
  const slots = [];
  const chars = [];
  for (const s of tmpl.subs) {
    if (s.t === 'line') slots.push(s.null ? EMPTY : (convertLine(s.items, ctx) || EMPTY));
    else if (s.t === 'pile') slots.push(convertPile(s, ctx));
    else if (s.t === 'char') chars.push(s);
    else if (s.t === 'tmpl' || s.t === 'matrix') slots.push(convertLine([s], ctx) || EMPTY);
  }
  return { slots, chars };
}

function scriptSlots(tmpl, d, ctx) {
  const { slots } = splitSubs(tmpl, ctx);
  const has = (x) => x && x !== EMPTY;
  // ScrBoxClass: subscript slot, superscript slot (both normally present, one maybe null).
  let sub = slots.length >= 2 ? slots[0] : d.sub && !d.sup ? slots[0] : null;
  let sup = slots.length >= 2 ? slots[1] : d.sup && !d.sub ? slots[0] : null;
  return { sub: has(sub) ? sub : null, sup: has(sup) ? sup : null };
}

// A fence/operator glyph from a template CHAR record, when it is a plain Unicode character.
function templateChar(chars, i, ctx) {
  const c = chars[i];
  if (!c) return null;
  try {
    const t = charText(c, ctx);
    return t && !/[-]/.test(t) ? t : null;
  } catch { return null; }
}

// The function name (lim, max ...) a big-operator template's operator characters spell, or null.
// The operator is the template's own character records (MTEF 5), or, in MTEF 3 (Equation Editor, LibreOffice), the characters of its
// fourth LINE (main, lower, upper, operator).
function bigopFunctionName(tmpl, ctx) {
  let chars = tmpl.subs.filter((s) => s.t === 'char');
  if (!chars.length) {
    const lines = tmpl.subs.filter((s) => s.t === 'line');
    const op = lines[3];
    if (op && !op.null && op.items.length && op.items.every((x) => x.t === 'char')) chars = op.items;
  }
  if (!chars.length) return null;
  let name = '';
  for (const c of chars) {
    let t = null;
    try { t = charText(c, ctx); } catch { return null; }
    name += t || '';
  }
  name = name.trim();
  return FUNCTION_NAMES.has(name) ? name : null;
}
// True when the template is, or renders as, a function name still waiting for its argument (a limit; a big operator spelling lim)
function templateIsFunction(d, tmpl, ctx) {
  if (d.kind === 'lim') return true;
  if (d.kind !== 'bigop') return false;
  const { slots } = splitSubs(tmpl, ctx);
  return !!bigopFunctionName(tmpl, ctx) && !(slots[0] && slots[0] !== EMPTY);
}

function convertTemplate(tmpl, d, ctx) {
  const { slots, chars } = splitSubs(tmpl, ctx);
  const has = (x) => x && x !== EMPTY;
  const main = slots[0] || EMPTY;
  switch (d.kind) {
    case 'fence': {
      let { left, right } = d;
      if (d.useChars && chars.length === 2) {
        left = templateChar(chars, 0, ctx) ?? left;
        right = templateChar(chars, 1, ctx) ?? right;
      }
      const inner = main === EMPTY ? '' : main.startsWith('<mrow>') && main.endsWith('</mrow>') ? main.slice(6, -7) : main;
      return mrow(fence(left) + inner + fence(right));
    }
    case 'root': {
      const index = slots[1];
      return has(index) ? `<mroot>${main}${index}</mroot>` : `<msqrt>${main}</msqrt>`;
    }
    case 'frac': {
      const num = slots[0] || EMPTY, den = slots[1] || EMPTY;
      if (d.linear) return mrow(`${num}${mo('/')}${den}`);
      if (d.slash) return `<mfrac bevelled="true">${num}${den}</mfrac>`;
      return `<mfrac>${num}${den}</mfrac>`;
    }
    case 'bar': {
      const one = (x) => d.under ? `<munder accent="true">${x}${mo('¯')}</munder>` : `<mover accent="true">${x}${mo('¯')}</mover>`;
      return d.double ? one(one(main)) : one(main);
    }
    case 'arrow': {
      const ch = templateChar(chars, 0, ctx) || d.ch;
      const op = mo(ch);
      let top = null, bottom = null;
      if (d.single) { if (d.bottom) bottom = main; else top = main; }
      else {
        // ArroBoxClass (MTEF 5): top slot, bottom slot.
        if (slots.length >= 2) { top = slots[0]; bottom = slots[1]; }
        else if (d.bottom && !d.top) bottom = slots[0]; else top = slots[0];
      }
      top = has(top) ? top : null; bottom = has(bottom) ? bottom : null;
      if (top && bottom) return `<munderover>${op}${bottom}${top}</munderover>`;
      if (top) return `<mover>${op}${top}</mover>`;
      if (bottom) return `<munder>${op}${bottom}</munder>`;
      return op;
    }
    case 'bigop': {
      // BigOpBoxClass: main, lower, upper, operator character.
      let lower = null, upper = null;
      if (slots.length >= 3) { lower = slots[1]; upper = slots[2]; }
      else if (slots.length === 2) { if (d.upper && !d.lower) upper = slots[1]; else lower = slots[1]; }
      lower = has(lower) ? lower : null; upper = has(upper) ? upper : null;
      // A big-operator template whose operator is written out as a function name (LibreOffice writes "lim" as the operator characters
      // of a summation-style template): it is the limit function, not a summation sign.
      const fnName = bigopFunctionName(tmpl, ctx);
      if (fnName) {
        const name = `<mi>${escapeXml(fnName)}</mi>`;
        const limited = lower && upper ? `<munderover>${name}${lower}${upper}</munderover>` : lower ? `<munder>${name}${lower}</munder>` : upper ? `<mover>${name}${upper}</mover>` : name;
        return main === EMPTY ? limited : mrow(`${limited}${mo(APPLY_FUNCTION)}${main}`);
      }
      let ch = d.ch;
      const tc = templateChar(chars, 0, ctx);
      if (tc && (d.useChar || tc === ch || /[∫∬∭∮∯∰∲∳∑∏∐⋃⋂]/.test(tc))) ch = tc;
      // Multiple integral signs written as separate characters (∫∫) -> one ∬ / ∭.
      if (chars.length > 1 && /^∫$/.test(ch)) {
        const all = chars.map((c, i) => templateChar(chars, i, ctx)).join('');
        if (/^∫+$/.test(all)) ch = INTEGRALS[Math.min(3, all.length)] || ch;
      }
      const op = mo(ch);
      let opNode;
      if (d.sumStyle) {
        opNode = lower && upper ? `<munderover>${op}${lower}${upper}</munderover>` : lower ? `<munder>${op}${lower}</munder>` : upper ? `<mover>${op}${upper}</mover>` : op;
      } else {
        opNode = lower && upper ? `<msubsup>${op}${lower}${upper}</msubsup>` : lower ? `<msub>${op}${lower}</msub>` : upper ? `<msup>${op}${upper}</msup>` : op;
      }
      const body = main === EMPTY ? '' : main;
      return mrow(opNode + body);
    }
    case 'lim': {
      // LimBoxClass: main slot (e.g. "lim"), lower, upper.
      let lower = slots[1], upper = slots[2];
      if (slots.length === 2 && d.upper && !d.lower) { upper = slots[1]; lower = null; }
      lower = has(lower) ? lower : null; upper = has(upper) ? upper : null;
      if (lower && upper) return `<munderover>${main}${lower}${upper}</munderover>`;
      if (lower) return `<munder>${main}${lower}</munder>`;
      if (upper) return `<mover>${main}${upper}</mover>`;
      return main;
    }
    case 'hbrace': {
      const ch = d.top ? (d.brace ? '⏞' : '⎴') : (d.brace ? '⏟' : '⎵');
      const label = has(slots[1]) ? slots[1] : null;
      const inner = d.top ? `<mover>${main}${mo(ch)}</mover>` : `<munder>${main}${mo(ch)}</munder>`;
      if (!label) return inner;
      return d.top ? `<mover>${inner}${label}</mover>` : `<munder>${inner}${label}</munder>`;
    }
    case 'dirac': {
      const left = has(slots[0]) ? slots[0] : '';
      const right = has(slots[1]) ? slots[1] : '';
      // ⟨a|b⟩, ⟨a| (bra only) or |b⟩ (ket only).
      return mrow((d.left ? mo('⟨') + left : '') + mo('|') + (d.right ? right + mo('⟩') : ''));
    }
    case 'accent':
      return d.under ? `<munder accentunder="true">${main}${mo(d.ch)}</munder>` : `<mover accent="true">${main}${mo(d.ch)}</mover>`;
    case 'enclose':
      return `<menclose notation="${d.notation}">${main}</menclose>`;
  }
  throw new MtefError(`unhandled template kind ${d.kind}`);
}

function convertPile(pile, ctx) {
  const rows = pile.lines.filter((l) => l.t === 'line' || l.t === 'pile');
  const align = { 1: 'left', 2: 'center', 3: 'right' }[pile.halign];
  const cell = (l) => (l.t === 'pile' ? convertPile(l, ctx) : l.null ? '' : convertLine(l.items, ctx));
  return `<mtable${align && align !== 'center' ? ` columnalign="${align}"` : ''}>${rows.map((l) => `<mtr><mtd>${cell(l)}</mtd></mtr>`).join('')}</mtable>`;
}

function convertMatrix(m, ctx) {
  const cells = m.cells.filter((c) => c.t === 'line' || c.t === 'pile');
  if (!m.rows || !m.cols) throw new MtefError('matrix with no rows or columns');
  if (cells.length < m.rows * m.cols) throw new MtefError(`matrix has ${cells.length} cells, expected ${m.rows * m.cols}`);
  const cell = (l) => (l.t === 'pile' ? convertPile(l, ctx) : l.null ? '' : convertLine(l.items, ctx));
  let out = '';
  for (let r = 0; r < m.rows; r++) {
    out += '<mtr>';
    for (let c = 0; c < m.cols; c++) out += `<mtd>${cell(cells[r * m.cols + c])}</mtd>`;
    out += '</mtr>';
  }
  return `<mtable>${out}</mtable>`;
}

// ---------------------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------------------
export function mtefToMathML(bytes) {
  const ast = parseMtef(bytes);
  const ctx = { version: ast.version, fontName: ast.fontName };
  const inner = convertLine(ast.body, ctx);
  if (!inner) throw new MtefError('equation is empty');
  // Same outer shape as omml.mjs (ommlElementToMathML), so both paths look alike downstream.
  return `<math display="block">${inner}</math>`;
}

// The "Equation Native" stream: EQNOLEFILEHDR { u16 cbHdr (28), u32 version, u16 cf,
// u32 cbObject (MTEF length), u32 reserved[4] } followed by the MTEF bytes.
export function equationNativeToMathML(bytes) {
  const u8 = toU8(bytes);
  if (u8.length < 28 + 5) throw new MtefError('Equation Native stream is too short');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let hdr = dv.getUint16(0, true);
  if (hdr < 28 || hdr >= u8.length) hdr = 28;
  const declared = dv.getUint32(8, true);
  const end = declared > 0 && hdr + declared <= u8.length ? hdr + declared : u8.length;
  return mtefToMathML(u8.subarray(hdr, end));
}

export function oleEquationToMathML(bytes) {
  const u8 = toU8(bytes);
  if (!isCfb(u8)) throw new MtefError('not an OLE equation object (no compound-file signature)');
  const cfb = readCfb(u8);
  const entry = cfb.entries.find((e) => e.type === 'stream' && e.name.toLowerCase() === 'equation native');
  if (!entry) throw new MtefError('OLE object has no "Equation Native" stream');
  return equationNativeToMathML(cfb.getStream(entry.path));
}

export function readOleEquation(bytes) {
  try {
    return { mathml: oleEquationToMathML(bytes) };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}
