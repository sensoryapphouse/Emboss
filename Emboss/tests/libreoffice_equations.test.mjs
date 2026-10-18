// LibreOffice Math formulas saved as .doc / .docx / .rtf (26 Sep 2026).
//
// Fixtures (tests/fixtures/libreoffice/lo-math-*): LibreOffice 26.8's own output
// (soffice --headless --convert-to doc|docx|rtf, with Load/Save › Microsoft Office ›
// "MathType to LibreOffice Math and reverse" on, i.e. registry MathToMathType=true) of a
// flat-ODF source holding the same nine formulas — fraction, root, sub/superscript, sum,
// integral, matrix, brackets, Greek, text in a formula — four ways:
//   * display — each formula alone in its own paragraph, anchored as a character;
//   * inline  — each formula after its label in the same paragraph, as a character;
//   * float   — each formula a floating frame anchored to its own paragraph;
//   * char    — each formula a floating frame anchored to a character after its label.
//
// What LibreOffice writes:
//   .doc  — every formula is a MathType (Equation.3, "Equation Native" MTEF) object in
//           ObjectPool/_<id>. An as-character formula is an EMBED field whose field
//           SEPARATOR carries sprmCFOle2 + sprmCFObj + sprmCPicLocation = the ObjectPool id
//           ([MS-DOC] 2.6.1); the 0x01 in the field result is only the preview picture (its
//           sprmCPicLocation is a PICF offset in the Data stream). A floating formula is an
//           OfficeArt shape with fOleShape ([MS-ODRAW] 2.2.40) whose pictureId property
//           (0x010B) holds, in its high word, the text-box story that holds the object's
//           EMBED field (the same field as above). doc.mjs used to read only Word's own form
//           (sprmCFOle2 on the 0x01 itself), so all nine became pictures.
//   .docx — OMML: m:oMath in the paragraph, or <w:p><m:oMathPara> for a display formula
//           (Word writes display equations that way too); the latter was never walked, so
//           every display equation was dropped.
//   .rtf  — {\mmath{\*\moMath …}{\mmathPict …}} (Office Math as RTF groups, what Word 2007+
//           writes too); it was not read, so the fallback picture was shown instead.
// The .doc and .rtf are compared with the .docx: the same nine formulas as math, in the
// same places, giving the same MathCAT braille (UEB and Nemeth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDoc } from '../input/doc.mjs';
import { parseDocx, parseOdt, parseFile } from '../input/parse.mjs';
import { readCfb } from '../input/cfb.mjs';
import { writeCfb } from './helpers/cfb-writer.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const LOFIX = new URL('./fixtures/libreoffice/', import.meta.url);
const raw = (name) => readFileSync(new URL(name, LOFIX));
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const toUeb = makeMathToBrf('ukaaf');
const toNemeth = makeMathToBrf('bana');
const MATHCAT_FAILED = '/#';                               // node-maths-helper's fallback (⠌⠼)

const LABELS = ['Fraction:', 'Root:', 'SubSup:', 'Sum:', 'Integral:', 'Matrix:', 'Brackets:', 'Greek:', 'TextInFormula:'];

// Every math segment/block of a model, in reading order.
function mathsOf(model) {
  const out = [];
  JSON.stringify(model.blocks, (k, v) => { if (v && v.type === 'math') out.push(v.mathml); return v; });
  return out;
}
// The model's reading order, reduced to text labels and "M" for each formula.
function shape(model) {
  const out = [];
  for (const b of model.blocks) {
    if (b.type === 'math') out.push('M');
    else if (b.type === 'graphic') out.push('G');
    else if (b.segments) for (const s of b.segments) out.push(s.type === 'math' ? 'M' : s.type === 'imgnote' ? `N:${s.text}` : String(s.text || '').trim());
    else out.push(b.text);
  }
  return out.filter(Boolean);
}
function sameBraille(got, expected, label) {
  const u = toUeb(got), n = toNemeth(got);
  assert.ok(u && u !== MATHCAT_FAILED && n && n !== MATHCAT_FAILED, `${label}: MathCAT could not read ${got}`);
  assert.equal(u, toUeb(expected), `${label}: UEB\n got      ${got}\n expected ${expected}`);
  assert.equal(n, toNemeth(expected), `${label}: Nemeth\n got      ${got}\n expected ${expected}`);
}

// The nine formulas as the .docx gives them (OMML → MathML), independent of the .doc path.
const EXPECTED = [
  '<mfrac><mn>1</mn><mn>2</mn></mfrac>',
  '<msqrt><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></msqrt>',
  '<msubsup><mi>x</mi><mn>1</mn><mn>2</mn></msubsup>',
  '<mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi></mrow>',
  null,                                                    // integral: MTEF and OMML spell "dx" differently (mtext / mi); same braille
  '<mrow><mo>(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo>)</mo></mrow>',
  '<mrow><mo>[</mo><mi>a</mi><mo>+</mo><mi>b</mi><mo>]</mo></mrow>',
  '<mi>α</mi><mo>+</mo><mi>β</mi><mo>=</mo><mi>γ</mi>',
  '<mtext>speed</mtext><mo>=</mo><mfrac><mtext>distance</mtext><mtext>time</mtext></mfrac>',
];
// MathML without its <math> wrapper and grouping-only <mrow>s (MTEF adds some OMML does not).
const flat = (m) => m.replace(/^<math[^>]*>|<\/math>$/g, '').replace(/<\/?mrow>/g, '');
// EXPECTATION CHANGED 30 Sep 2026 (import fix list #31, .doc part; Paul's A84 decision that Word brackets are stretchy fences,
// Emboss/docs/expectation-changes.md): a bracket of a MathType bracket template is now <mo fence="true" stretchy="true">(</mo>, as
// omml.mjs writes Word's m:d (it was a plain <mo>(</mo>). The .doc and .docx MathML now agree; the braille is identical.
const fenced = (m) => m.replace(/<mo>([()\[\]{}|])<\/mo>/g, '<mo fence="true" stretchy="true">$1</mo>');

for (const kind of ['display', 'inline', 'float', 'char']) {
  test(`LibreOffice .doc (${kind}): all nine MathType formulas come through as math, in place, with the .docx's braille`, async () => {
    const doc = await parseDoc(ab(raw(`lo-math-${kind}.doc`)));
    const docx = await parseDocx(ab(raw(`lo-math-${kind}.docx`)));
    const dm = mathsOf(doc), xm = mathsOf(docx);
    assert.equal(dm.length, 9, `nine formulas as math, not pictures: ${JSON.stringify(shape(doc))}`);
    assert.equal(xm.length, 9, 'the .docx gives nine formulas');
    assert.ok(!doc.blocks.some((b) => b.type === 'graphic'), 'no formula is left as a picture');
    assert.ok(!(doc.resources || []).length, 'no preview pictures are kept');
    assert.equal(doc.warnings, undefined, 'every formula was read');
    // Reading order: each label, then its formula — the same as the .docx.
    assert.deepEqual(shape(doc), LABELS.flatMap((l) => [l, 'M']));
    assert.deepEqual(shape(doc), shape(docx));
    // Alone in its paragraph → a display math block (as the .docx's m:oMathPara); after text → inline.
    const blockMath = doc.blocks.filter((b) => b.type === 'math').length;
    assert.equal(blockMath, kind === 'display' || kind === 'float' ? 9 : 0);
    dm.forEach((m, i) => {
      sameBraille(m, xm[i], `${kind} ${LABELS[i]}`);
      if (EXPECTED[i]) assert.equal(flat(m), flat(fenced(EXPECTED[i])), `${kind} ${LABELS[i]} MathML`);
    });
  });
}

// EXPECTATION CHANGED (A84, import fix list #31; Emboss/docs/expectation-changes.md): omml.mjs now writes an
// m:d bracket as a stretchy fence, <mo fence="true" stretchy="true">(</mo> (Word's brackets grow with their
// content), where it wrote a plain <mo>(</mo>. The .doc (MTEF) path now does the same (see `fenced` above); the .rtf
// path is untouched. The braille is identical.
test('LibreOffice .docx: a display formula (<w:p><m:oMathPara>) is a math block, not dropped', async () => {
  const docx = await parseDocx(ab(raw('lo-math-display.docx')));
  assert.deepEqual(docx.blocks.map((b) => b.type), LABELS.flatMap(() => ['para', 'math']));
  mathsOf(docx).forEach((m, i) => { if (EXPECTED[i]) assert.equal(flat(m), flat(fenced(EXPECTED[i])), `${LABELS[i]} MathML`); });
});

test('LibreOffice .rtf: \\mmath formulas are read as math (not their \\mmathPict pictures), matching the .docx', async () => {
  const rtf = await parseFile('lo-math-char.rtf', raw('lo-math-char.rtf').toString('latin1'));
  const docx = await parseDocx(ab(raw('lo-math-char.docx')));
  const rm = mathsOf(rtf), xm = mathsOf(docx);
  assert.equal(rm.length, 9, `nine formulas as math: ${JSON.stringify(shape(rtf))}`);
  assert.ok(!rtf.blocks.some((b) => b.type === 'graphic'), 'no formula is left as a picture');
  assert.deepEqual(shape(rtf), shape(docx));
  assert.deepEqual(rm, xm, 'the same MathML as the .docx (the same OMML, read by omml.mjs)');
  rm.forEach((m, i) => sameBraille(m, xm[i], `rtf ${LABELS[i]}`));
});

// ---- ODT: LibreOffice's own <draw:frame><draw:object xlink:href="./Object N"/>
// <draw:image xlink:href="./ObjectReplacements/Object N"/></draw:frame> — the object's own
// zip part (Object N/content.xml) is a <math:math> document, real MathML already (unlike
// DOCX's OMML, which ommlElementToMathML has to build MathML from scratch), usually wrapped
// <semantics>PRESENTATION<annotation encoding="StarMath 5.0">…</annotation></semantics>.
// lo-math-*.odt were made by round-tripping the existing lo-math-*.docx fixtures through
// LibreOffice 26.8 itself (soffice --convert-to odt) — the same nine formulas, the same
// four frame layouts (LibreOffice anchors every embedded Math object "as character" once
// it's ODT's own, so "display"/"float" both come out as the formula alone in its own
// paragraph, and "inline"/"char" both come out as the formula sharing the label's
// paragraph — matching the block/inline split the .doc/.docx pairs already show).
//
// The Integral formula (index 4) is a documented exception to the braille-equality check
// below, the ODT/DOCX counterpart to EXPECTED[4]'s own doc/docx MTEF-vs-OMML note: LibreOffice's
// ODF Math export marks the trailing "dx" mathvariant="italic" (see Object 5/content.xml —
// kept faithfully; odtMathObjectToMathml only strips the StarMath <annotation>, never a real
// MathML attribute), but its OMML export of the very same formula does not mark "dx" italic
// at all — a genuine LibreOffice ODF-vs-OOXML export difference, not a parseOdt defect. Unlike
// the .doc/.docx "dx" spelling difference (still the same braille), MathCAT renders this one
// differently (an extra UEB/Nemeth italics indicator), so it's excluded from the direct
// ODT-vs-DOCX braille comparison only (still checked individually for a real, non-fallback
// braille reading).
const ODT_INTEGRAL = 4;
// LibreOffice's ODF Math export adds presentational attributes OMML's own leaner output
// never had (<mo stretchy="false">, <mo fence="true" form="prefix" stretchy="true">, …) —
// irrelevant to structure or braille (sameBraille is the real proof of that), so stripped
// before comparing against EXPECTED's bare element shape, the same "modulo grouping" latitude
// flat() already gives the <mrow>s MTEF/OMML disagree on.
const stripAttrs = (m) => m.replace(/<(\/?[a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, '<$1>');
for (const kind of ['display', 'inline', 'float', 'char']) {
  test(`LibreOffice .odt (${kind}): all nine MathType formulas come through as math, in place, with the .docx's braille`, async () => {
    const odt = await parseOdt(ab(raw(`lo-math-${kind}.odt`)));
    const docx = await parseDocx(ab(raw(`lo-math-${kind}.docx`)));
    const om = mathsOf(odt), xm = mathsOf(docx);
    assert.equal(om.length, 9, `nine formulas as math, not pictures: ${JSON.stringify(shape(odt))}`);
    assert.equal(xm.length, 9, 'the .docx gives nine formulas');
    assert.ok(!odt.blocks.some((b) => b.type === 'graphic'), 'no formula is left as a picture');
    assert.ok(!(odt.resources || []).length, 'no ObjectReplacements pictures are kept');
    // Reading order: each label, then its formula — the same as the .docx.
    assert.deepEqual(shape(odt), LABELS.flatMap((l) => [l, 'M']));
    assert.deepEqual(shape(odt), shape(docx));
    // Alone in its paragraph → a display math block; after the label's text → inline.
    const blockMath = odt.blocks.filter((b) => b.type === 'math').length;
    assert.equal(blockMath, kind === 'display' || kind === 'float' ? 9 : 0);
    om.forEach((m, i) => {
      const u = toUeb(m), n = toNemeth(m);
      assert.ok(u && u !== MATHCAT_FAILED && n && n !== MATHCAT_FAILED, `odt ${kind} ${LABELS[i]}: MathCAT could not read ${m}`);
      if (i !== ODT_INTEGRAL) sameBraille(m, xm[i], `odt ${kind} ${LABELS[i]}`);
      if (EXPECTED[i]) assert.equal(flat(stripAttrs(m)), flat(EXPECTED[i]), `odt ${kind} ${LABELS[i]} MathML`);
    });
  });
}

// ---- objects that are not readable equations: the existing placeholders ----
// A LibreOffice .doc with two of its objects altered: the first becomes an Excel sheet (its
// CompObj ProgID replaced, no Equation Native), the second an equation whose MTEF is damaged.
function compObj(userType, progId) {
  const enc = (s) => { const b = Buffer.from(s + '\0', 'latin1'); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); return Buffer.concat([n, b]); };
  return new Uint8Array(Buffer.concat([Buffer.alloc(28), enc(userType), Buffer.alloc(4), enc(progId)]));
}
function alterObjects(name) {
  const bytes = raw(name);
  const cfb = readCfb(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const streams = [];
  for (const e of cfb.entries) {
    if (e.type !== 'stream') continue;
    let data = cfb.getStream(e.path);
    if (/^ObjectPool\/_2147483647\//.test(e.path)) {           // the first formula (Fraction)
      if (/Equation Native$/.test(e.path)) continue;
      if (/\x01CompObj$/.test(e.path)) data = compObj('Microsoft Excel Worksheet', 'Excel.Sheet.12');
    }
    if (/^ObjectPool\/_2147483646\/Equation Native$/.test(e.path)) data = new Uint8Array(data.length).fill(0xEE);   // the second (Root)
    streams.push({ path: e.path, data });
  }
  return ab(Buffer.from(writeCfb(streams)));
}
for (const kind of ['inline', 'float']) {
  test(`LibreOffice .doc (${kind}): a non-equation object is the "not transcribed" placeholder with its preview picture; an unreadable equation the equation placeholder`, async () => {
    const doc = await parseDoc(alterObjects(`lo-math-${kind}.doc`));
    const s = shape(doc);
    assert.equal(mathsOf(doc).length, 7, JSON.stringify(s));
    // The Excel object: its placeholder where the formula was, and its preview picture just
    // before the paragraph holding it (as every picture); the damaged equation: the equation
    // placeholder. The other seven formulas are unaffected.
    const excel = 'N:embedded object not transcribed (Excel spreadsheet)';
    const head = kind === 'inline' ? ['G', 'Fraction:', excel] : ['Fraction:', 'G', excel];
    assert.deepEqual(s, [...head, 'Root:', 'N:equation not transcribed', ...LABELS.slice(2).flatMap((l) => [l, 'M'])]);
    assert.equal(doc.blocks.filter((b) => b.type === 'graphic').length, 1, 'only the Excel object keeps its picture');
    assert.equal((doc.resources || []).length, 1);
    assert.equal(doc.warnings.length, 2);
    assert.match(doc.warnings[0], /^1 old-style equation \(Equation Editor 3\.0 \/ MathType\) could not be read/);
    assert.match(doc.warnings[1], /^1 embedded object \(e\.g\. a spreadsheet/);
  });
}
