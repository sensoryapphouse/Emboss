// RTF \object (OLE) import — AGENTS.md task, 25 Sep 2026: read embedded OLE objects the way
// the DOCX reader already reads <w:object>/<o:OLEObject>, instead of skipping the whole
// `{\object ...}` group (see the old RTF_SKIP_KEYWORDS comment this replaced, and the
// removed "`object` (OLE) is intentionally unsupported" note in input/parse.mjs).
//
// `{\object\objemb{\*\objclass Equation.3}…{\*\objdata <hex>}{\result …}}` (or \objlink for a
// linked, not embedded, object). \objdata hex-decodes to an OLE1 ObjectHeader/EmbeddedObject
// ([MS-OLEDS] 2.2.4/2.2.5) whose NativeData is an OLE2 compound file (cfb.mjs) — for an
// equation ("Equation.3"/"Equation.DSMT4"/…, matched the same LEGACY_EQUATION_PROGID_RE as
// DOCX), that compound file is read by mtef.mjs's readOleEquation, exactly like a .docx's own
// word/embeddings/oleObjectN.bin. A non-equation embed (Excel/Visio/Package/…) gets the DOCX
// "embedded object not transcribed (<friendly name>)" placeholder, UNLESS \result carries a
// fallback \pict, in which case that picture becomes a real graphic (metafile.mjs's WMF/EMF
// decoding, already wired into handlePicture) with the placeholder text as its description.
//
// Test material: RTF written by hand, with \objdata hex built from OLE1's own published byte
// layout wrapping a CFB+MTEF equation object built with tests/helpers/cfb-writer.mjs /
// mtef-writer.mjs (see mtef.test.mjs / docx_equations.test.mjs for how those build a real
// Equation Editor 3.0 equation) — no real .docx/.rtf sample of a legacy OLE equation was
// available to convert with textutil (see this task's final report for that investigation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRtf } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { cellSegments } from '../format/cell-markup.mjs';
import { v3, FACE, oleEquationObject } from './helpers/mtef-writer.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0 ${body}}`;

// ---------------------------------------------------------------------------------------
// OLE1 ObjectHeader/EmbeddedObject ([MS-OLEDS] 2.2.4/2.2.5), the structure RTF's \objdata
// hex-decodes to: OLEVersion(4) + FormatID(4) + three LengthPrefixedAnsiString fields
// (ClassName/TopicName/ItemName: a little-endian u32 byte count INCLUDING the trailing NUL,
// then that many ANSI bytes) + NativeDataSize(4) + NativeData. `nativeData` here is the same
// OLE2 compound file oleEquationObject() (mtef-writer.mjs) already builds for the DOCX tests
// — RTF just wraps it in this extra OLE1 header, where DOCX's word/embeddings/*.bin holds it
// directly.
function ole1EmbeddedObject({ className = '', nativeData }) {
  const enc = new TextEncoder();
  const u32le = (n) => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];
  const lenPrefixed = (str) => {
    const bytes = [...enc.encode(str), 0];                 // ANSI text + trailing NUL
    return [...u32le(bytes.length), ...bytes];
  };
  const parts = [
    ...u32le(0x00000501),                                   // OLEVersion (arbitrary, unread)
    ...u32le(0x00000002),                                   // FormatID (arbitrary, unread)
    ...lenPrefixed(className),                              // ClassName
    ...lenPrefixed(''),                                     // TopicName
    ...lenPrefixed(''),                                     // ItemName
    ...u32le(nativeData.length),                             // NativeDataSize
  ];
  const out = new Uint8Array(parts.length + nativeData.length);
  out.set(Uint8Array.from(parts), 0);
  out.set(nativeData, parts.length);
  return out;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
    if (i % 32 === 31) hex += '\r\n';                        // real files wrap hex in newlines; hexToBytes must tolerate this
  }
  return hex;
}

// `{\object\objemb{\*\objclass <className>}{\*\objdata <hex>}[\result]}` for an embedded
// object whose \objdata native data is `nativeData` (a compound file for an equation, or any
// bytes for a non-equation embed — the non-equation path never reads them).
function objectGroup(className, nativeData, { link = false, result = '' } = {}) {
  const hex = bytesToHex(ole1EmbeddedObject({ className, nativeData }));
  return `{\\object\\${link ? 'objlink' : 'objemb'}{\\*\\objclass ${className}}{\\*\\objdata ${hex}}${result}}`;
}

// x^2 + 1 = 0, as Equation Editor 3.0 writes it (MTEF 3) — the same equation
// docx_equations.test.mjs/mtef.test.mjs use, so the expected MathML/braille below are known-good.
const EQ3_X2 = v3.eqn(v3.line(v3.char(FACE.VARIABLE, 'x'), v3.tmpl(15, 0, v3.nullLine(), v3.line(v3.char(FACE.NUMBER, '2'))), v3.char(FACE.SYMBOL, '+'), v3.char(FACE.NUMBER, '1'), v3.char(FACE.SYMBOL, '='), v3.char(FACE.NUMBER, '0')));
const X2_MATHML = '<math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn><mo>=</mo><mn>0</mn></mrow></math>';
const eq3Native = () => oleEquationObject(EQ3_X2);

const PNG_HEX = '89504e470d0a1a0a00000001';
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 1];

// ---------------------------------------------------------------------------------------
// Readable equation
// ---------------------------------------------------------------------------------------

test('a readable Equation Editor 3.0 \\object inside a sentence becomes an inline math segment', () => {
  const body = `{\\pard Solve ${objectGroup('Equation.3', eq3Native())} for x.\\par}`;
  const model = parseRtf(doc(body));
  const para = model.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(model.blocks));
  assert.deepEqual(para.segments.map((s) => s.type), ['text', 'math', 'text'], JSON.stringify(para.segments));
  assert.equal(para.segments[1].mathml, X2_MATHML);
  assert.ok(para.segments[1].latex, 'LaTeX is filled in, as for the DOCX path');
  assert.ok(!model.warnings || !model.warnings.length, 'a readable equation raises no warning: ' + JSON.stringify(model.warnings));
});

test('a readable equation alone in its own paragraph becomes a display math BLOCK, not a para', () => {
  const body = `{\\pard Before the equation.\\par}{\\pard ${objectGroup('Equation.DSMT4', eq3Native())}\\par}{\\pard After.\\par}`;
  const model = parseRtf(doc(body));
  assert.deepEqual(model.blocks.map((b) => b.type), ['para', 'math', 'para'], JSON.stringify(model.blocks));
  assert.equal(model.blocks[1].mathml, X2_MATHML);
  assert.ok(!model.warnings || !model.warnings.length, JSON.stringify(model.warnings));
});

test('an equation alone in a LIST item stays inside the list item, not pulled out as a display block', () => {
  const body = `{\\listtext\\pard\\plain \\'b7\\tab}\\pard\\li720 ${objectGroup('Equation.3', eq3Native())}\\par`;
  const model = parseRtf(doc(body));
  const list = model.blocks.find((b) => b.type === 'list');
  assert.ok(list, JSON.stringify(model.blocks));
  assert.equal(list.items[0].segments[0].type, 'math', JSON.stringify(list.items));
});

test('the braille of the imported equation equals MathCAT\'s own braille for the same hand-written MathML (UEB and Nemeth)', () => {
  const body = `{\\pard ${objectGroup('Equation.3', eq3Native())}\\par}`;
  const model = parseRtf(doc(body));
  const mathBlock = model.blocks.find((b) => b.type === 'math');
  assert.ok(mathBlock, JSON.stringify(model.blocks));
  const toUeb = makeMathToBrf('ukaaf'), toNemeth = makeMathToBrf('bana');
  const MATHCAT_FAILED = '/#';
  const u = toUeb(mathBlock.mathml), n = toNemeth(mathBlock.mathml);
  assert.ok(u && u !== MATHCAT_FAILED, 'MathCAT (UEB) could not read the imported equation: ' + mathBlock.mathml);
  assert.ok(n && n !== MATHCAT_FAILED, 'MathCAT (Nemeth) could not read the imported equation: ' + mathBlock.mathml);
  assert.equal(u, toUeb(X2_MATHML), 'UEB braille matches the hand-written equivalent MathML');
  assert.equal(n, toNemeth(X2_MATHML), 'Nemeth braille matches the hand-written equivalent MathML');
});

test('a readable equation inside a footnote is kept as a math segment, not dropped', () => {
  const body = `{\\pard See the note\\chftn {\\footnote\\pard\\plain \\chftn  Where ${objectGroup('Equation.3', eq3Native())} above.\\par}.\\par}`;
  const model = parseRtf(doc(body));
  const footnote = model.blocks.find((b) => b.type === 'footnote');
  assert.ok(footnote, JSON.stringify(model.blocks));
  assert.ok(footnote.segments, 'footnote paragraph kept its segments: ' + JSON.stringify(footnote));
  const mathSeg = footnote.segments.find((s) => s.type === 'math');
  assert.ok(mathSeg, 'the equation was not dropped from the footnote: ' + JSON.stringify(footnote.segments));
  assert.equal(mathSeg.mathml, X2_MATHML);
});

test('a readable equation inside a table cell is kept as a rich cell with a math segment', () => {
  const body = `{\\trowd\\intbl Formula\\cell ${objectGroup('Equation.3', eq3Native())}\\cell\\row\\pard\\par}`;
  const model = parseRtf(doc(body));
  const table = model.blocks.find((b) => b.type === 'table');
  assert.ok(table, JSON.stringify(model.blocks));
  const cell = table.headers[1];
  assert.ok(cell && typeof cell === 'object', 'the cell kept its rich segments, not flattened to a plain string: ' + JSON.stringify(table.headers));
  const segs = cellSegments(cell);
  const mathSeg = segs.find((s) => s.type === 'math');
  assert.ok(mathSeg, JSON.stringify(segs));
  assert.equal(mathSeg.mathml, X2_MATHML);
});

// ---------------------------------------------------------------------------------------
// Unreadable equation
// ---------------------------------------------------------------------------------------

test('an unreadable equation (objdata that is not a real OLE compound file) becomes the DOCX-style placeholder', () => {
  const junk = new Uint8Array([9, 9, 9, 9]);
  const body = `{\\pard Before: ${objectGroup('Equation.3', junk)} after.\\par}`;
  const model = parseRtf(doc(body));
  const para = model.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(model.blocks));
  assert.deepEqual(para.segments.map((s) => s.type), ['text', 'imgnote', 'text'], JSON.stringify(para.segments));
  const note = para.segments[1];
  assert.equal(note.text, 'equation not transcribed');
  assert.equal(note.prodnote, true);
  assert.equal(note.render, 'required');
});

test('an unreadable equation raises a load warning naming the count and what to do', () => {
  const junk = new Uint8Array([9, 9, 9, 9]);
  const body = `{\\pard ${objectGroup('Equation.3', junk)}\\par}`;
  const model = parseRtf(doc(body));
  assert.ok(Array.isArray(model.warnings) && model.warnings.length, JSON.stringify(model));
  const msg = model.warnings.join('; ');
  assert.match(msg, /\b1\b/, msg);
  assert.match(msg, /equation/i, msg);
  assert.match(msg, /equation editor/i, msg);
});

// ---------------------------------------------------------------------------------------
// Non-equation embed
// ---------------------------------------------------------------------------------------

test('a non-equation object with no usable \\result picture gets its own DOCX-style placeholder, not the equation one', () => {
  const body = `{\\pard Before: ${objectGroup('Excel.Sheet.12', new Uint8Array([1, 2, 3, 4]))} after.\\par}`;
  const model = parseRtf(doc(body));
  const para = model.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(model.blocks));
  assert.deepEqual(para.segments.map((s) => s.type), ['text', 'imgnote', 'text'], JSON.stringify(para.segments));
  const note = para.segments[1];
  assert.notEqual(note.text, 'equation not transcribed');
  assert.match(note.text, /embedded object not transcribed/);
  assert.match(note.text, /excel spreadsheet/i, note.text);
  assert.equal(note.prodnote, true);
  assert.equal(note.render, 'required');
  assert.ok(Array.isArray(model.warnings) && model.warnings.some((w) => /embedded object/i.test(w)), JSON.stringify(model.warnings));
});

test('a non-equation object whose \\result carries a \\pict becomes a real graphic, with the placeholder text as its description', () => {
  const result = `{\\result{\\pict\\pngblip\\picw100\\pich100 ${PNG_HEX}}}`;
  const body = `{\\pard Before.\\par}{\\pard ${objectGroup('Excel.Sheet.12', new Uint8Array([1, 2, 3, 4]), { result })}\\par}{\\pard After.\\par}`;
  const model = parseRtf(doc(body));
  const g = model.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, JSON.stringify(model.blocks));
  assert.match(g.alt, /embedded object not transcribed/);
  assert.match(g.alt, /excel spreadsheet/i, g.alt);
  assert.ok(model.resources && model.resources.length, JSON.stringify(model.resources));
  const res = model.resources.find((r) => r.path === g.src);
  assert.ok(res, JSON.stringify(model.resources));
  assert.equal(res.mime, 'image/png');
  assert.deepEqual([...res.bytes], PNG_BYTES);
  assert.ok(!JSON.stringify(model).includes('"imgnote"'), 'the picture replaced the placeholder note entirely: ' + JSON.stringify(model.blocks));
});

// ---------------------------------------------------------------------------------------
// Linked (not embedded) object
// ---------------------------------------------------------------------------------------

test('\\objlink (a linked, not embedded, object) gets its own "linked object not included" placeholder', () => {
  const body = `{\\pard Before: ${objectGroup('Excel.Sheet.12', new Uint8Array([1, 2, 3, 4]), { link: true })} after.\\par}`;
  const model = parseRtf(doc(body));
  const para = model.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(model.blocks));
  const note = para.segments.find((s) => s.type === 'imgnote');
  assert.ok(note, JSON.stringify(para.segments));
  assert.equal(note.text, 'linked object not included');
  assert.equal(note.prodnote, true);
  assert.equal(note.render, 'required');
});

test('a linked equation-classed object also gets the "linked object not included" placeholder, never treated as a readable equation', () => {
  // \objlink never even attempts to read \objdata (see parseOle1EmbeddedObject's doc
  // comment in parse.mjs) — a linked "Equation.3" must not be confused with an embedded one.
  const body = `{\\pard ${objectGroup('Equation.3', eq3Native(), { link: true })}\\par}`;
  const model = parseRtf(doc(body));
  const json = JSON.stringify(model);
  assert.ok(!json.includes('equation not transcribed'));
  assert.ok(!model.blocks.some((b) => b.type === 'math'));
  const para = model.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments && para.segments.some((s) => s.type === 'imgnote' && s.text === 'linked object not included'), JSON.stringify(model.blocks));
});

// ---------------------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------------------

test('a readable equation survives a NIMAS export as a real <math> element', () => {
  const body = `{\\pard Solve ${objectGroup('Equation.3', eq3Native())} for x.\\par}`;
  const model = parseRtf(doc(body));
  const xml = exportToNimasXml(model);
  assert.match(xml, /<m:math[^>]*>|<math[^>]*>/, xml);
  assert.ok(!/equation not transcribed/.test(xml));
});

test('the unreadable-equation placeholder survives a NIMAS export as a real prodnote', () => {
  const junk = new Uint8Array([9, 9, 9, 9]);
  const body = `{\\pard ${objectGroup('Equation.3', junk)}\\par}`;
  const model = parseRtf(doc(body));
  const xml = exportToNimasXml(model);
  assert.match(xml, /<prodnote render="required"[^>]*>equation not transcribed<\/prodnote>/, xml);
});
