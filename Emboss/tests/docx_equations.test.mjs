// DOCX equation import (AGENTS.md task, 25 Sep 2026):
//   1. A legacy Equation Editor 3.0 / MathType OLE equation (<w:object> with an
//      <o:OLEObject ProgID="Equation..."/> or "Equation.DSMT..."), which used to vanish
//      from the model without a trace, now becomes an inline "equation not transcribed"
//      placeholder (a BANA §10.11.1 embedded transcriber's note, the same segment shape an
//      image's alt-text note already uses) right where the equation sat, plus a load
//      warning through model.warnings (the editor's existing parse-warning banner).
//      (Since the MTEF reader, input/mtef.mjs: only an equation that cannot be READ gets
//      the placeholder — a readable one becomes a real math segment/block, see the
//      "readable legacy equations" section at the end. The placeholder tests here use an
//      unreadable object: four bytes that are not an OLE compound file.)
//   2. A non-equation OLE object (a different ProgID) gets its OWN placeholder (docx-fix
//      item 8, 25 Sep 2026: "embedded object not transcribed (<friendly ProgID name>)"),
//      never confused with the equation placeholder above — see docx_features.test.mjs for
//      that fix's own tests; the assertion below was updated to match (it used to assert the
//      pre-item-8 "silently absent" behaviour this fix intentionally replaces).
//   3. oMath/legacy-equation content nested inside constructs that used to have narrower
//      handling — a footnote/endnote paragraph, a w:hyperlink — is no longer dropped.
// omml.mjs's own fixes (fraction type, n-ary limLoc, plain-text runs, degree/prime
// operators) are covered by input/omml.test.mjs; this file is the DOCX-level plumbing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDocx } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';
import { formatDocument } from '../format/document.mjs';
import { v3, v5, FACE, oleEquationObject } from './helpers/mtef-writer.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const O = 'urn:schemas-microsoft-com:office:office';
const V = 'urn:schemas-microsoft-com:vml';

// A real Word legacy-equation <w:object> (Equation Editor 3.0 / MathType), as it actually
// appears embedded in a run — see the investigation this task built on
// (probe3-ole.mjs/build-combo-docx.mjs in the scratch folder) for the source shape.
function legacyEquationObject(progId, rId = 'rId5', imgRId = 'rId4') {
  return `<w:object w:dxaOrig="220" w:dyaOrig="220">
    <v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75"/>
    <v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:15pt;height:15pt" o:ole="">
      <v:imagedata r:id="${imgRId}" o:title=""/>
    </v:shape>
    <o:OLEObject Type="Embed" ProgID="${progId}" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1" r:id="${rId}"/>
  </w:object>`;
}

async function buildDocx({ bodyXml, rels = '', extraParts = [] }) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:m="${M}" xmlns:r="${R}" xmlns:o="${O}" xmlns:v="${V}"><w:body>${bodyXml}</w:body></w:document>`;
  const parts = [{ name: 'word/document.xml', text: docXml }, ...extraParts];
  if (rels) parts.push({ name: 'word/_rels/document.xml.rels', text: rels });
  const buf = await makeZip(parts).arrayBuffer();
  return parseDocx(buf);
}

const RELS = (...rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;

// ---------------------------------------------------------------------------------------
// Fix 1: legacy equation -> placeholder, in document order, with a load warning.
// ---------------------------------------------------------------------------------------

test('an unreadable legacy Equation Editor 3.0 object becomes an inline placeholder, in document order', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Before the equation: </w:t></w:r>
    <w:r>${legacyEquationObject('Equation.3')}</w:r>
    <w:r><w:t xml:space="preserve"> after the equation.</w:t></w:r></w:p>`;
  const doc = await buildDocx({
    bodyXml,
    rels: RELS(
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.emf"/>',
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>'
    ),
    extraParts: [{ name: 'word/media/image1.emf', data: new Uint8Array([1, 2, 3, 4]) }, { name: 'word/embeddings/oleObject1.bin', data: new Uint8Array([5, 6, 7, 8]) }],
  });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para, 'paragraph block exists: ' + JSON.stringify(doc.blocks));
  assert.ok(para.segments, 'paragraph kept its segments (the placeholder is not plain text)');
  const types = para.segments.map((s) => s.type);
  assert.deepEqual(types, ['text', 'imgnote', 'text'], 'text, placeholder, text — in document order: ' + JSON.stringify(para.segments));
  assert.equal(para.segments[0].text, 'Before the equation: ');
  assert.equal(para.segments[2].text, ' after the equation.');
  const note = para.segments[1];
  assert.equal(note.text, 'equation not transcribed');
  assert.equal(note.prodnote, true, 'exports as a real <prodnote>, not just cosmetic note styling');
  assert.equal(note.render, 'required', 'a reader must not be able to skip past a lost equation');
});

test('legacy equation raises a load warning naming the count and what to do', async () => {
  const bodyXml = `<w:p><w:r>${legacyEquationObject('Equation.3')}</w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  assert.ok(Array.isArray(doc.warnings) && doc.warnings.length, 'model.warnings is set: ' + JSON.stringify(doc));
  const msg = doc.warnings.join('; ');
  assert.match(msg, /\b1\b/, msg);
  assert.match(msg, /equation/i, msg);
  assert.match(msg, /equation editor/i, 'tells the transcriber what to do about it: ' + msg);
});

test('MathType ProgID (Equation.DSMT4) is recognised too, and multiple equations are counted', async () => {
  const bodyXml = `<w:p><w:r>${legacyEquationObject('Equation.DSMT4')}</w:r></w:p>
    <w:p><w:r>${legacyEquationObject('Equation.3', 'rId7', 'rId6')}</w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const notes = doc.blocks.filter((b) => b.segments).flatMap((b) => b.segments).filter((s) => s.type === 'imgnote');
  assert.equal(notes.length, 2, JSON.stringify(doc.blocks));
  assert.match(doc.warnings.join('; '), /\b2\b/, doc.warnings.join('; '));
});

test('a non-equation OLE object gets its own placeholder (docx-fix item 8), not the equation one', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Before: </w:t></w:r>
    <w:r>${legacyEquationObject('Excel.Sheet.12')}</w:r>
    <w:r><w:t xml:space="preserve"> after.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para, JSON.stringify(doc.blocks));
  assert.ok(para.segments, 'paragraph kept its segments (the OLE placeholder is not plain text): ' + JSON.stringify(para));
  const types = para.segments.map((s) => s.type);
  assert.deepEqual(types, ['text', 'imgnote', 'text'], JSON.stringify(para.segments));
  const note = para.segments[1];
  assert.notEqual(note.text, 'equation not transcribed', 'must not be mistaken for the equation placeholder');
  assert.match(note.text, /embedded object not transcribed/);
  assert.match(note.text, /excel spreadsheet/i, 'names the ProgID\'s friendly kind: ' + note.text);
  assert.equal(note.prodnote, true);
  assert.equal(note.render, 'required');
  assert.ok(Array.isArray(doc.warnings) && doc.warnings.some((w) => /embedded object/i.test(w)), JSON.stringify(doc.warnings));
});

// Builds the segments directly (not via parseDocx) so this is purely a format-layer
// check — it shows what the placeholder actually looks like in braille (for the report),
// on top of, not instead of, the parse-level "in document order" test above, which is the
// one that actually fails if the parse.mjs fix is reverted.
test('the placeholder shows in the braille (BANA embedded-TN markers), between the surrounding text', () => {
  const model = {
    blocks: [{
      type: 'para',
      segments: [
        { type: 'text', text: 'Before the equation: ' },
        { type: 'imgnote', text: 'equation not transcribed', prodnote: true, render: 'required' },
        { type: 'text', text: ' after the equation.' },
      ],
    }],
  };
  const up = (s) => String(s).toUpperCase();
  // A wide width, so this check is about content/order, not line-wrap placement (a
  // narrower cell count could legitimately wrap "TRANSCRIBED" onto its own line).
  const opts = { mode: 'bana', width: 120, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
  const brf = formatDocument(model, opts).replace(/\r/g, '');
  const flat = brf.replace(/\s+/g, ' ');
  assert.match(flat, /BEFORE THE EQUATION:/);
  assert.match(flat, /AFTER THE EQUATION\./);
  assert.match(flat, /@\.<EQUATION NOT TRANSCRIBED@\.>/, 'wrapped in the embedded-TN braille markers: ' + JSON.stringify(brf));
  // Document order preserved in the braille output too.
  const i1 = flat.indexOf('BEFORE THE EQUATION:');
  const i2 = flat.indexOf('EQUATION NOT TRANSCRIBED');
  const i3 = flat.indexOf('AFTER THE EQUATION.');
  assert.ok(i1 >= 0 && i1 < i2 && i2 < i3, brf);
});

test('the placeholder survives a NIMAS save/reopen round trip', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Before: </w:t></w:r>
    <w:r>${legacyEquationObject('Equation.3')}</w:r>
    <w:r><w:t xml:space="preserve"> after.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<prodnote render="required"[^>]*>equation not transcribed<\/prodnote>/, xml);
  const reopened = parseDtbook(xml);
  const para = reopened.blocks.find((b) => b.type === 'para' && b.segments);
  assert.ok(para, 'reopened doc still has a segmented paragraph: ' + JSON.stringify(reopened.blocks));
  const note = para.segments.find((s) => s.type === 'imgnote');
  assert.ok(note, JSON.stringify(para.segments));
  assert.equal(note.text, 'equation not transcribed');
  assert.equal(note.prodnote, true);
  assert.equal(note.render, 'required');
});

// ---------------------------------------------------------------------------------------
// Gap check (Paul's question, 25 Sep 2026): OMML equations elsewhere in the document —
// footnotes/endnotes and hyperlinks — must not be dropped either.
// ---------------------------------------------------------------------------------------

test('an equation inside a footnote paragraph (alongside other text) is kept, not dropped', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">See the note.</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`;
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}" xmlns:m="${M}"><w:footnote w:id="2"><w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>
  <m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>
  <w:r><w:t xml:space="preserve"> above.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/footnotes.xml', text: footnotesXml }] });
  const footnote = doc.blocks.find((b) => b.type === 'footnote');
  assert.ok(footnote, JSON.stringify(doc.blocks));
  const para = Array.isArray(footnote.blocks) ? footnote.blocks[0] : footnote;
  assert.ok(para.segments, 'footnote paragraph kept its segments: ' + JSON.stringify(footnote));
  const mathSeg = para.segments.find((s) => s.type === 'math');
  assert.ok(mathSeg, 'the equation was not dropped from the footnote: ' + JSON.stringify(para.segments));
  assert.match(mathSeg.mathml, /<msup>/);
});

test('an equation-only footnote paragraph (no other text) is still kept', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">See the note.</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`;
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}" xmlns:m="${M}"><w:footnote w:id="2"><w:p>
  <m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>
  </w:p></w:footnote></w:footnotes>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/footnotes.xml', text: footnotesXml }] });
  const footnote = doc.blocks.find((b) => b.type === 'footnote');
  assert.ok(footnote, 'the footnote itself was not dropped: ' + JSON.stringify(doc.blocks));
  const para = Array.isArray(footnote.blocks) ? footnote.blocks[0] : footnote;
  assert.ok(para && para.segments, 'an equation-only footnote paragraph is not gated out by "no text": ' + JSON.stringify(footnote));
  assert.ok(para.segments.some((s) => s.type === 'math'), JSON.stringify(para.segments));
});

test('an equation inside a w:hyperlink is kept, not dropped', async () => {
  const bodyXml = `<w:p><w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">link text </w:t></w:r>
    <m:oMath><m:r><m:t>x</m:t></m:r><m:r><m:t>+</m:t></m:r><m:r><m:t>1</m:t></m:r></m:oMath></w:hyperlink></w:p>`;
  const doc = await buildDocx({
    bodyXml,
    rels: RELS('<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/>'),
  });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(doc.blocks));
  const mathSeg = para.segments.find((s) => s.type === 'math');
  assert.ok(mathSeg, 'the equation inside the hyperlink was not dropped: ' + JSON.stringify(para.segments));
  assert.match(mathSeg.mathml, /<mi>x<\/mi><mo>\+<\/mo><mn>1<\/mn>/);
});

test('a legacy equation inside a w:hyperlink also gets the placeholder, not silently dropped', async () => {
  const bodyXml = `<w:p><w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">see </w:t></w:r>
    <w:r>${legacyEquationObject('Equation.3')}</w:r></w:hyperlink></w:p>`;
  const doc = await buildDocx({
    bodyXml,
    rels: RELS('<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/>'),
  });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(doc.blocks));
  assert.ok(para.segments.some((s) => s.type === 'imgnote' && s.text === 'equation not transcribed'), JSON.stringify(para.segments));
});


// ---------------------------------------------------------------------------------------
// Readable legacy equations (input/mtef.mjs): Equation Editor 3.0 / MathType OLE objects
// are converted to MathML and behave exactly like a modern (OMML) Word equation.
// ---------------------------------------------------------------------------------------
const OLE_REL = (id, n) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject${n}.bin"/>`;
const IMG_REL = '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>';
// x^2 + 1 = 0, as Equation Editor 3.0 writes it (MTEF 3)
const EQ3_X2 = v3.eqn(v3.line(v3.char(FACE.VARIABLE, 'x'), v3.tmpl(15, 0, v3.nullLine(), v3.line(v3.char(FACE.NUMBER, '2'))), v3.char(FACE.SYMBOL, '+'), v3.char(FACE.NUMBER, '1'), v3.char(FACE.SYMBOL, '='), v3.char(FACE.NUMBER, '0')));
const X2_MATHML = '<math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn><mo>=</mo><mn>0</mn></mrow></math>';
// (a + b)/2, as MathType 6 writes it (MTEF 5)
const EQ5_FRAC = v5.eqn(v5.line(v5.tmpl(11, 0, v5.line(v5.char(FACE.VARIABLE, 'a'), v5.char(FACE.SYMBOL, '+'), v5.char(FACE.VARIABLE, 'b')), v5.line(v5.char(FACE.NUMBER, '2')))));
const FRAC_MATHML = '<math display="block"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></mfrac></math>';
const oleParts = (...mtefs) => [{ name: 'word/media/image1.wmf', data: new Uint8Array([1, 2, 3, 4]) },
  ...mtefs.map((m, i) => ({ name: `word/embeddings/oleObject${i + 1}.bin`, data: m instanceof Uint8Array ? m : oleEquationObject(m) }))];

test('a readable Equation Editor 3.0 equation inside a sentence becomes an inline math segment, no warning', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Solve </w:t></w:r>
    <w:r>${legacyEquationObject('Equation.3')}</w:r>
    <w:r><w:t xml:space="preserve"> for x.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, rels: RELS(IMG_REL, OLE_REL('rId5', 1)), extraParts: oleParts(EQ3_X2) });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para && para.segments, JSON.stringify(doc.blocks));
  assert.deepEqual(para.segments.map((s) => s.type), ['text', 'math', 'text'], JSON.stringify(para.segments));
  assert.equal(para.segments[1].mathml, X2_MATHML);
  assert.ok(para.segments[1].latex, 'LaTeX is filled in, as for an OMML equation');
  assert.ok(!doc.warnings || !doc.warnings.length, 'nothing to warn about: ' + JSON.stringify(doc.warnings));
  assert.ok(!JSON.stringify(doc).includes('equation not transcribed'));
});

test('a readable legacy equation gives the same model as the equivalent OMML equation', async () => {
  const legacy = await buildDocx({
    bodyXml: `<w:p><w:r><w:t xml:space="preserve">Solve </w:t></w:r><w:r>${legacyEquationObject('Equation.3')}</w:r></w:p>`,
    rels: RELS(IMG_REL, OLE_REL('rId5', 1)), extraParts: oleParts(EQ3_X2),
  });
  const omml = await buildDocx({
    bodyXml: `<w:p><w:r><w:t xml:space="preserve">Solve </w:t></w:r><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>+1=0</m:t></m:r></m:oMath></w:p>`,
  });
  const a = legacy.blocks[0].segments[1], b = omml.blocks[0].segments[1];
  assert.equal(a.type, b.type);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), 'same segment fields');
  assert.equal(a.latex, b.latex, 'same LaTeX for the same equation');
});

test('a readable MathType (Equation.DSMT4) equation alone in its paragraph is a display math block', async () => {
  const bodyXml = `<w:p><w:r><w:t>Before.</w:t></w:r></w:p>
    <w:p><w:r><w:tab/></w:r><w:r>${legacyEquationObject('Equation.DSMT4')}</w:r></w:p>
    <w:p><w:r><w:t>After.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, rels: RELS(IMG_REL, OLE_REL('rId5', 1)), extraParts: oleParts(EQ5_FRAC) });
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para', 'math', 'para'], JSON.stringify(doc.blocks));
  assert.equal(doc.blocks[1].mathml, FRAC_MATHML);
  assert.ok(!doc.warnings || !doc.warnings.length, JSON.stringify(doc.warnings));
});

test('a legacy equation alone in a LIST item stays inside the list (not pulled out as a display block)', async () => {
  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r>${legacyEquationObject('Equation.3')}</w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, rels: RELS(IMG_REL, OLE_REL('rId5', 1)), extraParts: oleParts(EQ3_X2) });
  const list = doc.blocks.find((b) => b.type === 'list');
  assert.ok(list, JSON.stringify(doc.blocks));
  assert.equal(list.items[0].segments[0].type, 'math');
});

test('readable and unreadable legacy equations together: the warning counts only the unreadable one', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">One </w:t></w:r><w:r>${legacyEquationObject('Equation.3', 'rId5')}</w:r>
    <w:r><w:t xml:space="preserve"> two </w:t></w:r><w:r>${legacyEquationObject('Equation.DSMT4', 'rId6')}</w:r>
    <w:r><w:t xml:space="preserve"> three </w:t></w:r><w:r>${legacyEquationObject('Equation.3', 'rId7')}</w:r></w:p>`;
  // object 2 is a real compound file whose Equation Native holds truncated MTEF; object 3 is
  // not a compound file at all.
  const truncated = oleEquationObject(EQ5_FRAC.slice(0, EQ5_FRAC.length - 5));
  const doc = await buildDocx({
    bodyXml,
    rels: RELS(IMG_REL, OLE_REL('rId5', 1), OLE_REL('rId6', 2), OLE_REL('rId7', 3)),
    extraParts: oleParts(EQ3_X2, truncated, new Uint8Array([9, 9, 9])),
  });
  const segs = doc.blocks[0].segments;
  assert.deepEqual(segs.map((s) => s.type), ['text', 'math', 'text', 'imgnote', 'text', 'imgnote'], JSON.stringify(segs));
  assert.equal(segs[3].text, 'equation not transcribed');
  assert.equal(doc.warnings.length, 1, JSON.stringify(doc.warnings));
  assert.match(doc.warnings[0], /^2 old-style equations/);
});

test('readable legacy equations in a footnote, a table cell and a hyperlink', async () => {
  const bodyXml = `<w:p><w:r><w:t>Note.</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>
    <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r>${legacyEquationObject('Equation.3')}</w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">see </w:t></w:r><w:r>${legacyEquationObject('Equation.DSMT4', 'rId6')}</w:r></w:hyperlink></w:p>`;
  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}" xmlns:r="${R}" xmlns:o="${O}" xmlns:v="${V}"><w:footnote w:id="2"><w:p><w:r><w:t xml:space="preserve">Where </w:t></w:r><w:r>${legacyEquationObject('Equation.3', 'rId1')}</w:r></w:p></w:footnote></w:footnotes>`;
  const fnRels = RELS('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject3.bin"/>');
  const doc = await buildDocx({
    bodyXml,
    rels: RELS(IMG_REL, OLE_REL('rId5', 1), OLE_REL('rId6', 2), '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/>'),
    extraParts: [...oleParts(EQ3_X2, EQ5_FRAC, EQ3_X2), { name: 'word/footnotes.xml', text: footnotesXml }, { name: 'word/_rels/footnotes.xml.rels', text: fnRels }],
  });
  const json = JSON.stringify(doc);
  assert.ok(!json.includes('equation not transcribed'), json);
  const fn = doc.blocks.find((b) => b.type === 'footnote');
  assert.ok(fn && JSON.stringify(fn).includes('<msup><mi>x</mi><mn>2</mn></msup>'), 'footnote equation read via the footnotes part\'s own relationships: ' + JSON.stringify(fn));
  const table = doc.blocks.find((b) => b.type === 'table');
  assert.ok(table && JSON.stringify(table).includes('<msup>'), 'table-cell equation: ' + JSON.stringify(table));
  const linkPara = doc.blocks.filter((b) => b.type === 'para').pop();
  assert.ok(linkPara.segments.some((s) => s.type === 'math' && s.mathml === FRAC_MATHML), JSON.stringify(linkPara));
  assert.ok(!doc.warnings || !doc.warnings.length, JSON.stringify(doc.warnings));
});

test('a readable legacy equation survives a NIMAS save/reopen as a real equation', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Solve </w:t></w:r><w:r>${legacyEquationObject('Equation.3')}</w:r><w:r><w:t xml:space="preserve"> now.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, rels: RELS(IMG_REL, OLE_REL('rId5', 1)), extraParts: oleParts(EQ3_X2) });
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<m:math[^>]*>|<math[^>]*>/, xml);
  assert.ok(!/equation not transcribed/.test(xml));
  const reopened = parseDtbook(xml);
  const para = reopened.blocks.find((b) => b.segments && b.segments.some((s) => s.type === 'math'));
  assert.ok(para, JSON.stringify(reopened.blocks));
  // (the reopened MathML carries the DTBook's m: prefix, exactly as an OMML equation's does)
  assert.match(para.segments.find((s) => s.type === 'math').mathml, /<(m:)?msup><(m:)?mi>x<\/(m:)?mi><(m:)?mn>2<\/(m:)?mn><\/(m:)?msup>/);
});
