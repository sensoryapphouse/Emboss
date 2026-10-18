// Browser ESM wrapper around the liblouis WASM engine.
// Tables are fetched and written into the in-memory FS at /tables. The glue
// (liblouis-wasm.js) is loaded as a classic <script>, exposing globalThis.createLiblouis.

import { normalizeNfc } from './unicode-nfc.mjs';   // S3a #16: one NFC implementation for Node and the browser

// The include-closure for the UEB tables (engine/ueb-table-closure.txt).
const TABLE_FILES = [
  'braille-patterns.cti', 'en-ueb-chardefs.uti', 'en-ueb-g1.ctb', 'en-ueb-g2.ctb',
  'en-ueb-math.ctb', 'en-us-brf.dis', 'latinLetterDef6Dots.uti',
  'latinUppercaseComp6.uti', 'spaces.uti', 'text_nabcc.dis', 'unicode.dis',
];

export const TABLES = {
  uebG2: '/tables/en-us-brf.dis,/tables/en-ueb-g2.ctb',   // contracted (Grade 2)
  uebG1: '/tables/en-us-brf.dis,/tables/en-ueb-g1.ctb',   // uncontracted (Grade 1)
};

let M = null;                        // the READY engine: published only after init() has finished (S3a #13)
let baseUrl = '';                    // remembered from init, for ensureTables
const present = new Set();           // table files written into the wasm FS (fetched bytes; NOT necessarily a complete include graph - see `ready`)
const ready = new Set();             // table files whose whole include graph is installed (S3a #12)
const includesOf = new Map();        // table file -> the names it `include`s, read from the bytes written
let initPromise = null;              // the one shared init: callers made while it runs wait for it (S3a #13)

// S3a #13 (ChatGPT audit 15 Oct 2026): the engine used to be published (M = ...) as soon as the wasm module existed, before the
// startup tables were written, so a second init() call made meanwhile - or any translate() - found a non-null engine and went ahead
// with no tables; and a preload that failed left that half-built engine published, so a retry returned its version string without
// fetching anything. Now init() builds into LOCAL state and publishes M, present and ready only after every startup table has
// been fetched and the engine has been checked. Every caller shares the one promise; if it rejects, nothing was published and the
// next init() starts again from the network (with a fresh wasm instance, so no half-written filesystem is reused).
export function init(opts = {}) {
  if (initPromise) return initPromise;
  const p = initNow(opts);
  initPromise = p;
  p.catch(() => { if (initPromise === p) initPromise = null; });
  return p;
}
async function initNow({ tablesBaseUrl, wasmFactory } = {}) {
  const factory = wasmFactory || globalThis.createLiblouis;
  if (!factory) throw new Error('liblouis-wasm.js not loaded (globalThis.createLiblouis missing)');
  const engine = await factory();
  try { engine.FS.mkdir('/tables'); } catch { /* exists */ }
  const loaded = new Map();
  await Promise.all(TABLE_FILES.map(async (name) => {
    const res = await fetch(`${tablesBaseUrl}/${name}`);
    if (!res.ok) throw new Error(`table fetch failed: ${name} (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    engine.FS.writeFile(`/tables/${name}`, bytes);
    loaded.set(name, bytes);
  }));
  const cs = engine.ccall('lou_charSize', 'number', [], []);
  if (cs !== 2) throw new Error(`liblouis charSize ${cs}, expected 2`);
  // everything succeeded: publish. TABLE_FILES is the complete UEB include closure, so these are ready as they stand.
  M = engine;
  baseUrl = tablesBaseUrl || '';
  present.clear(); ready.clear(); includesOf.clear();
  for (const [name, bytes] of loaded) { present.add(name); ready.add(name); includesOf.set(name, includesIn(bytes)); }
  return version();
}

// THE ENGINE ONLY KNOWS THE TABLES IT WAS GIVEN (user report, 2026-08-19).
// init() writes the eleven UEB files above and nothing else, so selecting any
// other braille code asked liblouis to compile a table that was not in its
// filesystem: lou_backTranslateString failed, the app's bt() swallowed the
// throw and returned '', and the print pane went blank with no message. The
// 476 tables ship and serve — they were simply never handed to the engine.
//
// ensureTables() fetches a table and, RECURSIVELY, everything it `include`s:
// a liblouis table is a graph, not a file (afr-za-g1.ctb includes en-ueb-g1.ctb,
// which includes en-ueb-chardefs.uti, en-ueb-math.ctb and braille-patterns.cti),
// and one missing leaf fails the whole compile exactly as a missing root does.
// Files already present are skipped, so a second selection of the same code
// costs nothing and an offline reselect works from the service worker's cache.
// Throws — callers must decide what to do about a code that cannot be loaded,
// and the one thing they must not do is silently show an empty document.
const INCLUDE_RE = /^\s*include\s+(\S+)/gim;
// Includes are named relative to the tables directory, so the name in the directive is the name to fetch. Decoded as UTF-8 only to read
// them; the bytes written to the filesystem are untouched.
function includesIn(bytes) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return [...text.matchAll(INCLUDE_RE)].map((m) => m[1]);
}

// One request at a time (A89, the nightly random-action run): a table is marked present as soon as its own file is written, before
// the files it includes have arrived, so a second request made meanwhile (a settings change starts one without waiting; the
// transcription that follows makes another) found it present, returned at once, and liblouis compiled it with includes missing —
// "Cannot resolve table 'digits6DotsPlusDot6.uti'". Each request now waits for the one before it to finish.
//
// S3a #12 (ChatGPT audit 15 Oct 2026): "present" (bytes written) is not "ready" (every file it includes written too). A file whose
// include failed to download stayed present, so the retry skipped the whole branch and reported success with the dependency still
// missing - the code stayed unable to translate until the page was reloaded. A file is now added to `ready` only when the whole
// include graph under the request has been installed; on a retry the files already written are not fetched again, but their includes
// ARE walked, so exactly the failed parts are fetched. A failure is never remembered. Cycles (a includes b includes a) are cut by the
// per-request `seen` set.
let ensureChain = Promise.resolve();
export function ensureTables(tableList) {
  const run = ensureChain.then(() => ensureTablesNow(tableList));
  ensureChain = run.catch(() => {});
  return run;
}
async function ensureTablesNow(tableList) {
  if (!M) throw new Error('call init() first');
  const queue = String(tableList).split(',')
    .map((p) => p.trim().replace(/^\/tables\//, ''))
    .filter(Boolean);
  const seen = new Set();
  const fetched = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    if (ready.has(name)) continue;                 // its whole graph is installed: nothing below it to fetch
    if (!present.has(name)) {
      const res = await fetch(`${baseUrl}/${name}`);
      if (!res.ok) throw new Error(`table fetch failed: ${name} (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      M.FS.writeFile(`/tables/${name}`, bytes);
      present.add(name);
      includesOf.set(name, includesIn(bytes));
      fetched.push(name);
    }
    for (const inc of includesOf.get(name) || []) queue.push(inc);
  }
  // every file this request reached, and everything under it, is now installed
  for (const name of seen) ready.add(name);
  return fetched;                    // what this call had to go and get
}

export function version() { return M.ccall('lou_version', 'string', [], []); }

// liblouis typeform (emphasis) bit values for the `formtype` buffer. Legacy
// liblouis convention (still the values the UEB emphasis classes map to):
// italic=1, underline=2, bold=4. Verify with a live emphasis test before relying on it.
// trans1-trans5 (32/64/128/256/512): UEB 9.5.1 transcriber-defined typeform indicators,
// kept identical to Emboss/engine/louis.mjs (see its longer comment for how these bit
// values were confirmed against en-ueb-g1.ctb's `emphclass` order). Emboss's
// strikethrough feature always uses trans1.
export const TYPEFORM = { plain: 0, italic: 1, underline: 2, bold: 4, script: 8, transnote: 16, trans1: 32, trans2: 64, trans3: 128, trans4: 256, trans5: 512 };

// ---- Non-BMP input (audit E-4, A78; kept identical to louis.mjs) ----
// liblouis is built with a 16-bit widechar (lou_charSize() === 2, checked in
// init) and the marshalling below feeds UTF-16 code units one at a time. A code
// point above U+FFFF therefore reaches the tables as two unrelated surrogate
// units, neither of which any table defines, so liblouis emits its
// undefined-character escape for each: 'a 💡 b' -> "A '\XD83D''\XDCA1' ;B".
// Mathematical alphanumerics (U+1D400–U+1D7FF: 𝑥 𝐀 𝟘 …) are exactly what
// maths-flavoured literary text contains, and NFKC folds them to the plain
// letter/digit (𝑥 -> x) before liblouis ever sees the pair, so they still
// braille as that one letter/digit, not an undefined-character escape.
// Anything with no single-character BMP fold (emoji, supplementary CJK, …) is
// left as its own two surrogate units — liblouis's own undefined-character
// escape mechanism then does the rest, exactly as it already does for an
// ordinary undefined BMP character (U+261E ☞ etc.): format/document.mjs's
// scanUndefinedEscapes re-pairs the two adjacent escapes back into the one code
// point (BANA: a transcriber-defined icon symbol, ICON-1; UKAAF: the full cell
// plus a lou-undefined-char warning) — see its own comment for the full design.
// A caller with no such scrub layer (a bare louis.translate()/translatePos()
// call) gets the raw '\Xhhhh' escape text for an unfoldable non-BMP character,
// the same as it already does for an undefined BMP one; this wrapper no longer
// invents a placeholder cell on liblouis's behalf.
//
// NFKC is applied per non-BMP code point, NOT to the whole string: the UEB
// tables define many BMP compatibility characters natively and braille them
// better than their fold would (x² -> X;9#B with the superscript indicator,
// but NFKC gives "x2"; ½ -> #A/B, but NFKC gives "1⁄2" whose U+2044 is itself
// undefined). BMP input is passed through untouched, so every existing
// translation stays byte-identical.
//
// translatePos() must return inputPos[] indexed into the CALLER's string (the
// editor maps cells back to print characters for print<->braille sync).
// Folding a mathematical-alphanumeric pair down to its one-letter NFKC fold
// shortens the string by one unit; an unfoldable pair is now kept at its own
// two units, so foldNonBmp's `map` covers both cases uniformly (map[k] is
// always the ORIGINAL-string index that produced folded-string unit k, one
// map entry per OUTPUT unit — one for a fold, two for a kept pair, mapping
// both units back to the pair's own start). A same-length filler was tried and
// rejected for the folding case: every zero-width character the tables know
// (U+2060 WORD JOINER, U+FEFF) is classed as a space, so 'th𝑒'+filler brailles
// as ';THE' where translate() gives the contraction '!', and 'a𝑥𝑦b' sprouts
// grade-1 indicators (U+200B is even `correct`ed to a real space). Instead
// translatePos remaps liblouis's positions through `map` — the braille stays
// identical to translate()'s, as its contract promises, and typeform arrays
// (one entry per input unit) are rebuilt alongside so emphasis stays on the
// right characters.
const SURROGATE_RE = /[\uD800-\uDFFF]/;
// Fold of one surrogate pair to a single BMP code unit, when NFKC gives one (mathematical
// alphanumerics: 𝑥 -> x). Returns null — no fold available — for a lone/malformed surrogate
// (m.length !== 2) or a pair whose NFKC form isn't a single BMP character (most emoji): the
// code point is then kept intact by foldNonBmp below, not replaced here.
function bmpFold(m) {
  if (m.length !== 2) return null;
  const f = m.normalize('NFKC');
  return (f.length === 1 && !SURROGATE_RE.test(f)) ? f : null;
}
// Returns { text, typeform, map }; map is null when nothing was folded (the
// common case costs one regex test), else map[k] is the index in the original
// string of the unit that produced folded unit k.
//
// A78 (this comment block's own gap, closed): a non-BMP code point with no single-character
// NFKC fold (most emoji, e.g. U+1F4A1 💡) used to be replaced here with the full-cell
// placeholder (U+283F ⠿) before liblouis ever ran, so it could never become one of ICON-1's
// transcriber-defined print symbols, and UKAAF raised no lou-undefined-char warning for it —
// see document.mjs's ICON_SYMBOL_BRL comment, which flagged exactly this. Now its surrogate
// units are kept intact and handed to liblouis unchanged: the 16-bit widechar tables have no
// definition for either half, so lou_translateString falls back to its OWN
// undefined-character escape for each unit ('\Xhhhh' — precisely what it already does for an
// ordinary undefined BMP character, e.g. U+261E ☞), rather than this wrapper inventing a cell
// on liblouis's behalf. document.mjs's scanUndefinedEscapes already re-pairs two adjacent
// surrogate-half escapes back into the single code point the reader actually sees (its own
// comment anticipated this fix), so both the BANA icon-symbol path and the UKAAF
// full-cell-plus-warning path now see it like any other untranslatable character. A
// lone/malformed surrogate is passed through the same way, as one unit. Mathematical
// alphanumerics keep folding exactly as before (bmpFold's fast path, untouched).
function foldNonBmp(text, typeform) {
  if (!SURROGATE_RE.test(text)) return { text, typeform, map: null };
  let out = '';
  const tf = typeform ? [] : null;
  const map = [];
  for (let i = 0; i < text.length;) {
    const cu = text.charCodeAt(i);
    const isSur = cu >= 0xD800 && cu <= 0xDFFF;
    const pair = isSur && cu <= 0xDBFF && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xFC00) === 0xDC00;
    const unit = pair ? text.slice(i, i + 2) : text[i];
    const piece = isSur ? (bmpFold(unit) ?? unit) : text[i];   // fold when possible, else keep the code point intact (comment above)
    out += piece;
    for (let k = 0; k < piece.length; k++) {
      if (tf) tf.push(typeform[i] || 0);
      map.push(i);
    }
    i += pair ? 2 : 1;
  }
  return { text: out, typeform: tf, map };
}

// ---- NFC normalisation (K20 / BANA 1.16.2, RUEB 4.2.2/4.2.4) ----
// Decomposed accents (a base letter followed by a combining mark, U+0300-U+036F — common
// from web pages and some Word files) make liblouis contract ACROSS the accented letter and
// misplace capital signs: "Général" decomposed (e + combining acute) gives ",G^/5^/]AL"; NFC-
// composed ("é" precomposed) gives the correct ",G^/EN^/ERAL". liblouis's own tables only
// recognise the precomposed form, so the fix is to normalise to NFC before translation, not to
// teach the tables the decomposed form.
// Returns { text, typeform, map }; map is null when nothing changed (the fast, common path:
// one .normalize() comparison), else map[k] is the index in the ORIGINAL string of the
// character that produced composed character k — used by translatePos to remap inputPos back
// to the caller's own offsets (the editor's click-linking depends on this).
// Composition is done per "cluster" (a base character plus whatever combines into it: the combining marks after it, and for Hangul
// the vowel/final Jamo after a leading consonant). S3a #16 (ChatGPT audit 15 Oct 2026): the clustering used to be a
// hand-written copy in each wrapper that grouped only base + \p{M} marks, so Hangul Jamo - which compose into a syllable though none
// is a mark - stayed decomposed and NFD Korean got different contractions from NFC (NFD 가 '@<' vs NFC '$'). The one implementation
// now lives in engine/unicode-nfc.mjs, imported by both runtimes (it is a plain ES module and ships in the build).
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

// Translate `text` -> BRF. `typeform`, if given, is an array (one entry per input
// character) of TYPEFORM bit flags; liblouis emits the UEB emphasis indicators.
// Passing no typeform keeps the exact previous behaviour (6th arg 0).
function rawTranslate(text, tableList = TABLES.uebG2, typeform = null) {
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

// Translate AND return the cell→source-char map (inputPos[j] = input-char index
// that produced output cell j). Braille is identical to translate()'s. Used for
// word/cell-level print↔braille linking in the editor.
function rawTranslatePos(text, tableList = TABLES.uebG2, typeform = null) {
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

// ---------------------------------------------------------------------------
// Pronunciation notation (BANA Formats 20.3-20.4). Three things liblouis's UEB tables do not
// do, done here in the wrapper so every caller (formatter, editor, gold runs) gets them:
//  1. U+02C8 / U+02CC (modifier-letter primary / secondary stress) have no table entry (hex
//     escape). UEB stress symbols are `^.b` (primary) and `^.2` (secondary), written where the
//     mark stands (20.3.1). The mark is taken out of the text, so contractions are decided as
//     if it were not there, and the cells are put back at its position.
//  2. A letter with TWO OR MORE modifiers (precomposed, e.g. U+1E09, or combining sequences)
//     is written with all its modifiers BEFORE the letter, nearest-to-the-letter first
//     (20.4.6a-b); the tables write them after the letter or in the wrong order, or, for
//     letters with no precomposed form, as a hex escape. The modifier cells are read from the
//     tables' own single-mark output (e.g. 'a'+macron -> '@-'), so nothing is hard-coded.
//     One mark on a letter is left exactly as before.
//  3. U+00B7 between two letters (the syllable dot of a dictionary entry) is the raised dot,
//     written like U+2022 (`_4`, 20.4.1).
// Returns null when the text has none of these (the common case): the fast path is untouched.
const PM_QUICK = /[ˈˌ·̀-ͯÀ-ỿ]/;
const PM_MARK = /[̀-ͯ]/;
const pmModCache = new Map();
function pmModifier(mark, tableList, plainTr) {
  const key = tableList + '|' + mark;
  if (pmModCache.has(key)) return pmModCache.get(key);
  let mod = null;
  for (const base of 'aeouicnsztyglkdhrmw') {
    const comp = (base + mark).normalize('NFC');
    if (comp.length !== 1 || comp === base + mark) continue;
    let r, b;
    try { r = plainTr(comp); b = plainTr(base).replace(/^;/, ''); } catch { continue; }
    if (b && r.length > b.length && r.endsWith(b) && !/\\X/i.test(r)) { mod = r.slice(0, r.length - b.length); break; }
  }
  pmModCache.set(key, mod);
  return mod;
}
function prepareMarks(text, typeform, tableList, plainTr) {
  if (!PM_QUICK.test(text)) return null;
  let out = '';
  const tf = typeform ? [] : null;
  const map = [];
  const ins = [];                                   // { at: index in `out`, braille, src }
  const swaps = [];                                 // K21: { base, mark } ORIGINAL-text indices to reorder in the output (see withMarks)
  let changed = false;
  const push = (ch, srcIdx) => { out += ch; if (tf) tf.push(typeform[srcIdx] || 0); map.push(srcIdx); };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === 'ˈ' || ch === 'ˌ') {
      ins.push({ at: out.length, braille: ch === 'ˈ' ? '^.B' : '^.2', src: i });
      changed = true; i++; continue;
    }
    if (ch === '·' && i > 0 && /\p{L}/u.test(text[i - 1]) && i + 1 < text.length && /\p{L}/u.test(text[i + 1])) {
      push('•', i); changed = true; i++; continue;
    }
    let j = i + 1;
    while (j < text.length && PM_MARK.test(text[j])) j++;
    const d = text.slice(i, j).normalize('NFD');
    if (d.length >= 3 && /^\p{L}$/u.test(d[0]) && [...d.slice(1)].every((m) => PM_MARK.test(m))) {
      const mods = [...d.slice(1)].map((m) => pmModifier(m, tableList, plainTr));
      if (mods.every((m) => m)) {
        ins.push({ at: out.length, braille: mods.join(''), src: i, letter: true });
        push(d[0], i); changed = true; i = j; continue;
      }
    }
    // K21 / BANA 21.9.3b: a modifier (accent) printed ABOVE a hyphen, dash or other non-letter
    // symbol goes "(unspaced) before the symbol" in braille. liblouis already gives the modifier
    // its own correct cells when the mark is left in the text (it has table entries for the bare
    // combining marks) — it just puts them AFTER the symbol ('-̈e' -> '-^3E', should be '^3-E';
    // 'il-̂t' -> 'IL-^%T', should be 'IL^%-T'). Stripping the mark out first (as the letter case
    // above does) is the WRONG fix here: it changes what liblouis sees around the next letter and
    // can insert a spurious grade-1 indicator liblouis would not otherwise write ("il-t" alone ->
    // "IL-;T", but "il-̂t" kept whole -> "IL-^%T", no semicolon). So the mark is left exactly where
    // it is (both characters pushed unchanged) and `swaps` records the pair for withMarks to
    // reorder in the OUTPUT once liblouis has translated the untouched text.
    if (j === i + 2 && !/^\p{L}$/u.test(text[i]) && /\S/u.test(text[i]) && PM_MARK.test(text[i + 1])) {
      swaps.push({ base: i, mark: i + 1 });
      push(text[i], i); push(text[i + 1], i + 1); changed = true; i = j; continue;
    }
    for (let k = i; k < j; k++) push(text[k], k);
    i = j;
  }
  return changed ? { text: out, typeform: tf, map, ins, swaps } : null;
}
// K21: swap a symbol-modifier's output cells to just before its symbol's cells wherever
// `swaps` (ORIGINAL-text index pairs) shows them adjacent in the translated output — `inputPos`
// here has already been remapped to those original indices. A pair that did not translate to
// two separate, adjacent spans (e.g. swallowed into a wider contraction) is left as liblouis
// wrote it: reordering only what is unambiguously "the modifier, then the symbol" is safer than
// guessing.
function applySwaps(swaps, braille, inputPos) {
  const chars = Array.from(braille);
  for (const { base, mark } of swaps) {
    let bs = -1, be = -1, ms = -1, me = -1;
    for (let i = 0; i < inputPos.length; i++) {
      if (inputPos[i] === base) { if (bs === -1) bs = i; be = i; }
      else if (inputPos[i] === mark) { if (ms === -1) ms = i; me = i; }
    }
    if (bs === -1 || ms === -1 || ms !== be + 1) continue;
    const baseSpan = chars.slice(bs, be + 1), markSpan = chars.slice(ms, me + 1);
    const basePos = inputPos.slice(bs, be + 1), markPos = inputPos.slice(ms, me + 1);
    chars.splice(bs, me - bs + 1, ...markSpan, ...baseSpan);
    inputPos.splice(bs, me - bs + 1, ...markPos, ...basePos);
  }
  return { braille: chars.join(''), inputPos };
}
// Runs rawPos(text', typeform') -> { braille, inputPos } and puts the inserted cells back.
function withMarks(prep, rawPos) {
  const r = rawPos(prep.text, prep.typeform);
  let braille = '';
  const inputPos = [];
  let k = 0;
  const flush = (upto) => {
    while (k < prep.ins.length && (upto === null || prep.ins[k].at <= upto)) {
      const it = prep.ins[k++];
      for (const c of it.braille) { braille += c; inputPos.push(it.src); }
    }
  };
  for (let j = 0; j < r.braille.length; j++) {
    flush(r.inputPos[j]);
    // a modified letter is not a lone letter: drop the grade 1 indicator liblouis put before it
    if (r.braille[j] === ';' && prep.ins.some((it) => it.letter && it.at === r.inputPos[j])) continue;
    braille += r.braille[j];
    inputPos.push(prep.map[r.inputPos[j]] ?? r.inputPos[j]);
  }
  flush(null);
  return prep.swaps && prep.swaps.length ? applySwaps(prep.swaps, braille, inputPos) : { braille, inputPos };
}

export function translate(text, tableList = TABLES.uebG2, typeform = null) {
  ({ text, typeform } = normalizeNfc(String(text), typeform));
  const prep = prepareMarks(text, typeform, tableList, (s) => rawTranslate(s, tableList));
  if (!prep) return rawTranslate(text, tableList, typeform);
  return withMarks(prep, (t, tf) => rawTranslatePos(t, tableList, tf)).braille;
}
export function translatePos(text, tableList = TABLES.uebG2, typeform = null) {
  const nfc = normalizeNfc(String(text), typeform);
  text = nfc.text; typeform = nfc.typeform;
  const prep = prepareMarks(text, typeform, tableList, (s) => rawTranslate(s, tableList));
  const result = prep ? withMarks(prep, (t, tf) => rawTranslatePos(t, tableList, tf)) : rawTranslatePos(text, tableList, typeform);
  if (!nfc.map) return result;
  return { braille: result.braille, inputPos: result.inputPos.map((p) => (typeof p === 'number' && p >= 0 ? (nfc.map[p] ?? p) : p)) };
}


// Back-translate BRF ASCII (or Unicode braille) -> text, using the same table list
// as translate(). Used for the round-trip proofread (translate then back-translate
// should return the source).
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
