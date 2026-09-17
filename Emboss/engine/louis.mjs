// Node ESM wrapper around the liblouis WASM engine (tables via NODEFS).
// Browser uses engine/louis-browser.mjs instead; both share the same marshalling.
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const createLiblouis = require('./liblouis-wasm.js');   // emscripten CJS glue
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let M = null;

export const TABLES = {
  uebG2: '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb',   // contracted (Grade 2)
  uebG1: '/tables/en-us-brf.dis,/tables/en-ueb-g1.ctb',   // uncontracted (Grade 1)
  uebG2_unicode: '/tables/unicode.dis,/tables/en-ueb-g2.ctb',
};

export async function init(tablesDir) {
  if (M) return;
  M = await createLiblouis();
  M.FS.mkdir('/tables');
  M.FS.mount(M.FS.filesystems.NODEFS, { root: tablesDir }, '/tables');
  const cs = M.ccall('lou_charSize', 'number', [], []);
  if (cs !== 2) throw new Error(`liblouis charSize ${cs}, expected 2`);
}

export function version() { return M.ccall('lou_version', 'string', [], []); }

// liblouis emphasis bits (kept identical to louis-browser.mjs): italic=1,
// underline=2, bold=4. Emit the UEB emphasis indicators when a typeform array
// (one entry per input char) is passed to translate().
export const TYPEFORM = { plain: 0, italic: 1, underline: 2, bold: 4 };

// ---- Non-BMP input (audit E-4; kept identical to louis-browser.mjs) ----
// liblouis is built with a 16-bit widechar (lou_charSize() === 2, checked in
// init) and the marshalling below feeds UTF-16 code units one at a time. A code
// point above U+FFFF therefore reaches the tables as two unrelated surrogate
// units, neither of which any table defines, so liblouis emits its
// undefined-character escape for each: 'a 𝑥 b' -> "A '\XD835''\XDC65' ;B".
// Mathematical alphanumerics (U+1D400–U+1D7FF: 𝑥 𝐀 𝟘 …) are exactly what
// maths-flavoured literary text contains, and NFKC folds them to the plain
// letter/digit (𝑥 -> x). Anything with no single-character BMP fold (emoji,
// supplementary CJK, …) becomes U+283F ⠿ (the full cell): braille-patterns.cti
// is in every UEB table closure, so liblouis passes it through as exactly ONE
// cell (BRF '='). U+FFFD would not do — the tables leave it undefined, so it
// prints as the escape '\XFFFD', which is the garbage this is meant to avoid.
//
// NFKC is applied per non-BMP code point, NOT to the whole string: the UEB
// tables define many BMP compatibility characters natively and braille them
// better than their fold would (x² -> X;9#B with the superscript indicator,
// but NFKC gives "x2"; ½ -> #A/B, but NFKC gives "1⁄2" whose U+2044 is itself
// undefined). BMP input is passed through untouched, so every existing
// translation stays byte-identical.
//
// translatePos() must return inputPos[] indexed into the CALLER's string (the
// editor maps cells back to print characters for print<->braille sync), while
// folding shortens the string by one unit per pair. A same-length filler was
// tried and rejected: every zero-width character the tables know (U+2060 WORD
// JOINER, U+FEFF) is classed as a space, so 'th𝑒'+filler brailles as ';THE'
// where translate() gives the contraction '!', and 'a𝑥𝑦b' sprouts grade-1
// indicators (U+200B is even `correct`ed to a real space). Instead foldNonBmp
// also returns map[foldedIndex] = originalIndex and translatePos remaps
// liblouis's positions through it — the braille stays identical to
// translate()'s, as its contract promises, and typeform arrays (one entry per
// input unit) are rebuilt alongside so emphasis stays on the right characters.
const SURROGATE_RE = /[\uD800-\uDFFF]/;
const NON_BMP_PLACEHOLDER = '\u283F';
// Fold of one surrogate pair (or lone surrogate) to a single BMP code unit.
function bmpFold(m) {
  if (m.length !== 2) return NON_BMP_PLACEHOLDER;             // lone surrogate: malformed input
  const f = m.normalize('NFKC');
  return (f.length === 1 && !SURROGATE_RE.test(f)) ? f : NON_BMP_PLACEHOLDER;
}
// Returns { text, typeform, map }; map is null when nothing was folded (the
// common case costs one regex test), else map[k] is the index in the original
// string of the unit that produced folded unit k.
function foldNonBmp(text, typeform) {
  if (!SURROGATE_RE.test(text)) return { text, typeform, map: null };
  let out = '';
  const tf = typeform ? [] : null;
  const map = [];
  for (let i = 0; i < text.length;) {
    const cu = text.charCodeAt(i);
    const isSur = cu >= 0xD800 && cu <= 0xDFFF;
    const pair = isSur && cu <= 0xDBFF && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00;
    out += isSur ? bmpFold(pair ? text.slice(i, i + 2) : text[i]) : text[i];   // always exactly one unit
    if (tf) tf.push(typeform[i] || 0);
    map.push(i);
    i += pair ? 2 : 1;
  }
  return { text: out, typeform: tf, map };
}

// Persistent reusable translation buffers in WASM memory to eliminate heap churn
let bufInCap = 0;
let bufInPtr = 0;
let bufOutCap = 0;
let bufOutPtr = 0;
let bufInPosPtr = 0;
let bufOutPosPtr = 0;
let bufTypeCap = 0;
let bufTypePtr = 0;
let bufInLenPtr = 0;
let bufOutLenPtr = 0;

function ensureBuffers(inLen, outCap) {
  if (!bufInLenPtr) {
    bufInLenPtr = M._malloc(4);
    bufOutLenPtr = M._malloc(4);
  }
  const maxCap = Math.max(inLen * 2, outCap, 4096);
  if (inLen > bufInCap) {
    if (bufInPtr) M._free(bufInPtr);
    if (bufOutPosPtr) M._free(bufOutPosPtr);
    bufInCap = Math.max(inLen * 2, 4096);
    bufInPtr = M._malloc(bufInCap * 2);
    bufOutPosPtr = M._malloc(bufInCap * 4);
  }
  if (outCap > bufOutCap) {
    if (bufOutPtr) M._free(bufOutPtr);
    if (bufInPosPtr) M._free(bufInPosPtr);
    bufOutCap = Math.max(outCap * 2, 16384);
    bufOutPtr = M._malloc(bufOutCap * 2);
    bufInPosPtr = M._malloc(bufOutCap * 4);
  }
  if (maxCap > bufTypeCap) {
    if (bufTypePtr) M._free(bufTypePtr);
    bufTypeCap = Math.max(maxCap * 2, 16384);
    bufTypePtr = M._malloc(bufTypeCap * 2);
  }
}

export function translate(text, tableList = TABLES.uebG2, typeform = null) {
  if (!M) throw new Error('call init() first');
  ({ text, typeform } = foldNonBmp(String(text), typeform));
  const inLen = text.length;
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    ensureBuffers(inLen, outCap);
    for (let i = 0; i < inLen; i++) M.setValue(bufInPtr + i * 2, text.charCodeAt(i), 'i16');
    M.setValue(bufInLenPtr, inLen, 'i32');
    M.setValue(bufOutLenPtr, outCap, 'i32');
    let typePtr = 0;
    if (typeform) {
      typePtr = bufTypePtr;
      for (let i = 0; i < inLen; i++) M.setValue(typePtr + i * 2, typeform[i] || 0, 'i16');
    }
    const rc = M.ccall('lou_translateString', 'number',
      ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [tableList, bufInPtr, bufInLenPtr, bufOutPtr, bufOutLenPtr, typePtr, 0, 0]);
    if (!rc) throw new Error('lou_translateString failed');
    const outLen = M.getValue(bufOutLenPtr, 'i32');
    if (outLen >= outCap && mul < 400) continue;
    if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');
    let out = '';
    for (let i = 0; i < outLen; i++) out += String.fromCharCode(M.getValue(bufOutPtr + i * 2, 'i16') & 0xffff);
    return out;
  }
}

// Translate AND return the cell→source-char map. Uses lou_translate (not
// ...String), which fills inputPos[j] = the input-char index that produced output
// cell j. Returns { braille, inputPos }. Braille is identical to translate()'s.
// Used for word/cell-level print↔braille linking in the editor.
export function translatePos(text, tableList = TABLES.uebG2, typeform = null) {
  if (!M) throw new Error('call init() first');
  const folded = foldNonBmp(String(text), typeform); // see the non-BMP notes above translate()
  ({ text, typeform } = folded);
  const posMap = folded.map;                          // folded index -> caller's index (null: nothing folded)
  const inLen = text.length;
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    ensureBuffers(inLen, outCap);
    for (let i = 0; i < inLen; i++) M.setValue(bufInPtr + i * 2, text.charCodeAt(i), 'i16');
    M.setValue(bufInLenPtr, inLen, 'i32');
    M.setValue(bufOutLenPtr, outCap, 'i32');
    let typePtr = 0;
    if (typeform) {
      typePtr = bufTypePtr;
      for (let i = 0; i < inLen; i++) M.setValue(typePtr + i * 2, typeform[i] || 0, 'i16');
    }
    const rc = M.ccall('lou_translate', 'number',
      ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [tableList, bufInPtr, bufInLenPtr, bufOutPtr, bufOutLenPtr, typePtr, 0, bufOutPosPtr, bufInPosPtr, 0, 0]);
    if (!rc) throw new Error('lou_translate failed');
    const outLen = M.getValue(bufOutLenPtr, 'i32');
    if (outLen >= outCap && mul < 400) continue;
    if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');
    let braille = '';
    const inputPos = new Array(outLen);
    for (let j = 0; j < outLen; j++) {
      braille += String.fromCharCode(M.getValue(bufOutPtr + j * 2, 'i16') & 0xffff);
      const p = M.getValue(bufInPosPtr + j * 4, 'i32');
      inputPos[j] = posMap ? (posMap[p] ?? p) : p;
    }
    return { braille, inputPos };
  }
}

// Back-translate BRF ASCII (or Unicode braille) -> text via the same table list.
// For the round-trip proofread: translate(text) then backTranslate(braille) should
// return the source text.
export function backTranslate(braille, tableList = TABLES.uebG2) {
  const res = backTranslateRuns(braille, tableList);
  return res.text;
}

// Back-translate BRF ASCII -> text AND return contiguous runs with TYPEFORM bits.
// tf: 0=plain, 1=italic, 2=underline, 4=bold (or bitwise combinations).
export function backTranslateRuns(braille, tableList = TABLES.uebG2) {
  if (!M) throw new Error('call init() first');
  const inLen = braille.length;
  for (let mul = 6; ; mul *= 4) {
    const outCap = inLen * mul + 1024;
    ensureBuffers(inLen, outCap);
    for (let i = 0; i < inLen; i++) M.setValue(bufInPtr + i * 2, braille.charCodeAt(i), 'i16');
    M.setValue(bufInLenPtr, inLen, 'i32');
    M.setValue(bufOutLenPtr, outCap, 'i32');
    for (let i = 0; i < outCap; i++) M.setValue(bufTypePtr + i * 2, 0, 'i16');
    const rc = M.ccall('lou_backTranslate', 'number',
      ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [tableList, bufInPtr, bufInLenPtr, bufOutPtr, bufOutLenPtr, bufTypePtr, 0, 0, 0, 0, 0]);
    if (!rc) throw new Error('lou_backTranslate failed');
    const outLen = M.getValue(bufOutLenPtr, 'i32');
    if (outLen >= outCap && mul < 400) continue;
    if (outLen >= outCap) throw new Error('liblouis: braille output exceeded the maximum buffer (possible truncation)');

    let out = '';
    const tfArray = new Array(outLen);
    for (let i = 0; i < outLen; i++) {
      out += String.fromCharCode(M.getValue(bufOutPtr + i * 2, 'i16') & 0xffff);
      tfArray[i] = M.getValue(bufTypePtr + i * 2, 'i16');
    }

    const runs = [];
    let curText = '';
    let curTf = -1;
    for (let i = 0; i < outLen; i++) {
      const ch = out[i];
      const tf = tfArray[i];
      if (curTf === -1) {
        curTf = tf;
        curText = ch;
      } else if (curTf === tf) {
        curText += ch;
      } else {
        runs.push({ type: 'text', text: curText, tf: curTf });
        curTf = tf;
        curText = ch;
      }
    }
    if (curText) runs.push({ type: 'text', text: curText, tf: curTf });

    return { text: out, tfArray, runs };
  }
}
