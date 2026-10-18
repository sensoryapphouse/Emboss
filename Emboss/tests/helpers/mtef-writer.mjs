// Test-only MTEF WRITER: builds Equation Editor 3.0 (MTEF 3) and MathType (MTEF 5) equation
// data byte by byte from the published record layouts, then wraps it the way Word embeds it
// (28-byte EQNOLEFILEHDR -> "Equation Native" stream -> OLE2 compound file -> .docx
// `word/embeddings/oleObjectN.bin`). Used by tests/mtef.test.mjs and tests/docx_equations.test.mjs.
import { writeCfb } from './cfb-writer.mjs';

export const FACE = { TEXT: 1, FUNCTION: 2, VARIABLE: 3, LCGREEK: 4, UCGREEK: 5, SYMBOL: 6, VECTOR: 7, NUMBER: 8, MTEXTRA: 11, SPACE: 24 };
export const EMB = { DOT: 2, DDOT: 3, PRIME: 5, DPRIME: 6, TILDE: 8, HAT: 9, RARROW: 11, OBAR: 17 };

const u16 = (v) => [v & 0xFF, (v >> 8) & 0xFF];
const cp = (ch) => (typeof ch === 'number' ? ch : ch.codePointAt(0));

// ---- MTEF 3 (Equation Editor 3.x): tag byte = record type | options << 4 ----
export const v3 = {
  header: [3, 1, 1, 3, 0],
  line: (...items) => [0x01, ...items.flat(), 0x00],
  nullLine: () => [0x11],
  // opts.embell: embellishment types; opts.nudge: add a (small) nudge
  char(face, ch, opts = {}) {
    const emb = opts.embell || [];
    const tag = 0x02 | (emb.length ? 0x20 : 0) | (opts.nudge ? 0x80 : 0) | (opts.auto ? 0x10 : 0);
    const out = [tag];
    if (opts.nudge) out.push(128 + 3, 128 - 2);
    out.push(face + 128, ...u16(cp(ch)));
    if (emb.length) { for (const e of emb) out.push(0x06, e); out.push(0x00); }
    return out;
  },
  chars: (face, str) => [...str].flatMap((c) => v3.char(face, c)),
  tmpl: (sel, vari, ...subs) => [0x03, sel, vari, 0x00, ...subs.flat(), 0x00],
  pile: (halign, ...lines) => [0x04, halign, 0x01, ...lines.flat(), 0x00],
  matrix(rows, cols, ...cells) {
    return [0x05, 0x01, 0x02, 0x00, rows, cols, ...new Array(Math.ceil((rows + 1) / 4)).fill(0), ...new Array(Math.ceil((cols + 1) / 4)).fill(0), ...cells.flat(), 0x00];
  },
  size: { FULL: [0x0A], SUB: [0x0B], SUB2: [0x0C], SYM: [0x0D] },
  // A whole equation: header, full size, one line (or pile), END.
  eqn: (...body) => [...v3.header, 0x0A, ...body.flat(), 0x00],
};

// ---- MTEF 5 (MathType 4+): type byte then options byte ----
export const v5 = {
  header: (inline = false) => [5, 1, 0, 6, 0, ...Array.from('DSMT6', (c) => c.charCodeAt(0)), 0, inline ? 1 : 0],
  line: (...items) => [0x01, 0x00, ...items.flat(), 0x00],
  nullLine: () => [0x01, 0x01],
  char(face, ch, opts = {}) {
    const emb = opts.embell || [];
    const o = (emb.length ? 0x01 : 0) | (opts.funcStart ? 0x02 : 0) | (opts.pos8 != null ? 0x04 : 0) | (opts.noMtcode ? 0x20 : 0) | (opts.nudge ? 0x08 : 0);
    const out = [0x02, o];
    if (opts.nudge) out.push(128, 128, ...u16(300), ...u16(0xFFF0));   // large nudge form
    out.push(face + 128);
    if (!opts.noMtcode) out.push(...u16(cp(ch)));
    if (opts.pos8 != null) out.push(opts.pos8);
    if (emb.length) { for (const e of emb) out.push(0x06, 0x00, e); out.push(0x00); }
    return out;
  },
  chars: (face, str) => [...str].flatMap((c) => v5.char(face, c)),
  // variation >= 0x80 is written in the two-byte form
  tmpl(sel, vari, ...subs) {
    const vb = vari < 0x80 ? [vari] : [(vari & 0x7F) | 0x80, vari >> 8];
    return [0x03, 0x00, sel, ...vb, 0x00, ...subs.flat(), 0x00];
  },
  pile: (halign, ...lines) => [0x04, 0x00, halign, 0x01, ...lines.flat(), 0x00],
  matrix(rows, cols, ...cells) {
    return [0x05, 0x00, 0x01, 0x02, 0x00, rows, cols, ...new Array(Math.ceil((rows + 1) / 4)).fill(0), ...new Array(Math.ceil((cols + 1) / 4)).fill(0), ...cells.flat(), 0x00];
  },
  size: { FULL: [0x0A], SUB: [0x0B], SYM: [0x0D] },
  // Definitions MathType writes before the equation: an encoding, fonts, font styles,
  // a colour, equation preferences and a "future" record — all must be skipped correctly.
  preamble() {
    const z = (s) => [...Array.from(s, (c) => c.charCodeAt(0)), 0];
    return [
      0x13, ...z('WinAllBasicCodePages'),               // ENCODING_DEF #5
      0x11, 0x05, ...z('Times New Roman'),             // FONT_DEF #1
      0x11, 0x03, ...z('Symbol'),                      // FONT_DEF #2
      0x08, 0x01, 0x02,                                // FONT_STYLE_DEF (font 1, italic)
      0x10, 0x00, ...u16(0), ...u16(0), ...u16(1000),  // COLOR_DEF (RGB)
      0x0F, 0x01,                                      // COLOR #1
      0x12, 0x00, 0x02, 0x21, 0x2F, 0x45, 0x8F,       // EQN_PREFS: 2 sizes "12pt","58%"
      0x01, 0x41, 0x50, 0xF0,                          //   1 spacing "150%" (odd nibble count, padded)
      0x02, 0x01, 0x02, 0x00,                          //   2 styles: font 1 italic; unused
      0x64, 0x03, 0xAA, 0xBB, 0xCC,                    // FUTURE record (type 100, 3 bytes)
    ];
  },
  eqn: (...body) => [...v5.header(), ...v5.preamble(), 0x0A, ...body.flat(), 0x00],
};

// 28-byte EQNOLEFILEHDR + MTEF.
export function equationNative(mtef) {
  const m = Uint8Array.from(mtef);
  const out = new Uint8Array(28 + m.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 28, true);
  dv.setUint32(2, 0x00020000, true);
  dv.setUint16(6, 0xC1C0, true);
  dv.setUint32(8, m.length, true);
  out.set(m, 28);
  return out;
}

const EQ3_CLSID = new Uint8Array([0x02, 0xCE, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
// An OLE equation object as Word stores it in word/embeddings/oleObjectN.bin.
export function oleEquationObject(mtef, opts = {}) {
  const enc = new TextEncoder();
  const compObj = new Uint8Array([1, 0, 0xFE, 0xFF, 3, 0x0A, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, ...EQ3_CLSID, ...enc.encode('\x17\0\0\0Microsoft Equation 3.0\0')]);
  return writeCfb([
    { path: '\x01CompObj', data: compObj },
    { path: '\x01Ole', data: new Uint8Array(20) },
    { path: '\x03ObjInfo', data: new Uint8Array(6) },
    { path: 'Equation Native', data: equationNative(mtef) },
  ], { rootClsid: EQ3_CLSID, version: opts.version || 3 });
}
