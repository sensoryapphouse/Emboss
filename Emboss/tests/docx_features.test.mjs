// DOCX import defect fixes (docx-fix audit, 25 Sep 2026 — see AGENTS.md's brief and the
// audit's own repro .docx files, numbered 11-44, for the read-only investigation this task
// builds on). Each `test()` below is one numbered item from that brief:
//   1. a nested <w:tbl> inside a table cell no longer corrupts the outer table
//   2. tracked-change w:moveFrom text no longer leaks/duplicates (w:moveTo still shows)
//   3. hidden text (w:vanish / w:specVanish) is never transcribed
//   4. w:caps AND w:smallCaps both upper-case the run (RUEB 9.6.1); style inheritance too
//   5. w:sym (Wingdings/Symbol/…) maps to Unicode, with a visible fallback placeholder
//   6. SmartArt/chart drawings get an image-description placeholder instead of vanishing
//   7. Shift+Enter line breaks (w:br, no type / type="textWrapping") keep their lines
//   8. a non-equation embedded OLE object gets its own placeholder (see also
//      docx_equations.test.mjs, which this item's fix also touches)
//   9. a drop-cap paragraph (w:framePr[@w:dropCap]) merges onto the following paragraph
//   10. docProps/core.xml dc:title/dc:creator is a fallback for model.title/metadata.creator
//   11. w:altChunk (embedded HTML/RTF/text) is read through Emboss's own parsers
//   12. w:ruby keeps only the base text, drops the ruby annotation (w:rt)
// Each test is written to FAIL against the pre-fix parse.mjs (verified by hand — see this
// task's final report — by temporarily pointing the import below at a saved pre-fix copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDocx } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';

async function buildDocx({ bodyXml, rels = '', extraParts = [], extraNs = '' }) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}"${extraNs}><w:body>${bodyXml}</w:body></w:document>`;
  const parts = [{ name: 'word/document.xml', text: docXml }, ...extraParts];
  if (rels) parts.push({ name: 'word/_rels/document.xml.rels', text: rels });
  const buf = await makeZip(parts).arrayBuffer();
  return parseDocx(buf);
}
const RELS = (...rs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rs.join('')}</Relationships>`;

// ---------------------------------------------------------------------------------------
// Item 1: nested table in a cell.
// ---------------------------------------------------------------------------------------
// The outer tables below mark their first row as a header row (w:tblHeader): without it a
// one-row table, or one holding a nested table, is read as a LAYOUT table (table-kind.mjs,
// layout_tables.test.mjs) and unwrapped, and these tests are about the data-table reader.
// IMP-W6 (Paul, 30 Sep 2026, decisions.md "Word import"): a nested table is no longer flattened into its outer cell; the outer table
// stays a table, its cell holds the placeholder "(table follows)", and the inner table follows as a table of its own. The three tests
// below pinned the flattened text ("Outer A1 Inner 1 Inner 2") and a single table block. Still pinned: the outer table keeps its own
// 2 columns and its rows, with nothing leaking in or repeated.
test('item 1: a nested w:tbl inside a cell does not corrupt the outer table', async () => {
  const bodyXml = `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>
    <w:tc><w:p><w:r><w:t>Outer A1</w:t></w:r></w:p>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>Inner 1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Inner 2</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>
    </w:tc>
    <w:tc><w:p><w:r><w:t>Outer B1</w:t></w:r></w:p></w:tc>
  </w:tr></w:tbl>`;
  const doc = await buildDocx({ bodyXml });
  const tables = doc.blocks.filter((b) => b.type === 'table');
  assert.equal(tables.length, 2, 'the outer table and, after it, the inner one as a table of its own: ' + JSON.stringify(doc.blocks));
  const t = tables[0];
  assert.equal(t.headers.length, 2, 'still just 2 outer columns, not the inner table\'s cells leaking in as extra columns: ' + JSON.stringify(t.headers));
  assert.equal(t.rows.length, 0, 'the inner table\'s row must not appear as a bogus extra OUTER row: ' + JSON.stringify(t.rows));
  assert.equal(t.headers[0], 'Outer A1 (table follows)', 'a placeholder where the inner table was');
  assert.equal(t.headers[1], 'Outer B1');
  assert.deepEqual([tables[1].headers, tables[1].rows], [['Inner 1', 'Inner 2'], []], 'the inner table, once');
  assert.equal(JSON.stringify(doc.blocks).split('Inner 1').length - 1, 1, 'Inner 1 appears once');
});

test('item 1: a nested table with a second outer row keeps that row intact', async () => {
  const bodyXml = `<w:tbl>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>
      <w:tc><w:p><w:r><w:t>Outer A1</w:t></w:r></w:p>
        <w:tbl><w:tr>
          <w:tc><w:p><w:r><w:t>Inner 1</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Inner 2</w:t></w:r></w:p></w:tc>
        </w:tr></w:tbl>
      </w:tc>
      <w:tc><w:p><w:r><w:t>Outer B1</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>Outer A2</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Outer B2</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>`;
  const doc = await buildDocx({ bodyXml });
  const t = doc.blocks.find((b) => b.type === 'table');
  assert.equal(t.headers[0], 'Outer A1 (table follows)');
  assert.equal(t.headers[1], 'Outer B1');
  assert.deepEqual(t.rows, [['Outer A2', 'Outer B2']], JSON.stringify(t.rows));
  assert.deepEqual(doc.blocks.filter((b) => b.type === 'table')[1].headers, ['Inner 1', 'Inner 2']);
});

// ---------------------------------------------------------------------------------------
// Item 2: w:moveFrom / w:moveTo.
// ---------------------------------------------------------------------------------------
test('item 2: w:moveFrom text never appears; w:moveTo text does; no duplication', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Para A starts. </w:t></w:r>
      <w:moveFrom w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Sentence that was moved.</w:t></w:r></w:moveFrom>
      <w:r><w:t xml:space="preserve"> Para A ends.</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Para B starts. </w:t></w:r>
      <w:moveTo w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Sentence that was moved.</w:t></w:r></w:moveTo>
      <w:r><w:t xml:space="preserve"> Para B ends.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const paras = doc.blocks.filter((b) => b.type === 'para');
  assert.equal(paras.length, 2, JSON.stringify(doc.blocks));
  assert.equal(paras[0].text, 'Para A starts. Para A ends.', 'moveFrom text is gone, no duplicate, no stray leftover spacing');
  assert.equal(paras[1].text, 'Para B starts. Sentence that was moved. Para B ends.', 'moveTo text is real, current content and must show');
});

// ---------------------------------------------------------------------------------------
// Item 3: hidden text.
// ---------------------------------------------------------------------------------------
test('item 3: w:vanish text is never transcribed', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Visible text. </w:t></w:r>
    <w:r><w:rPr><w:vanish/></w:rPr><w:t>HIDDEN-SHOULD-NOT-SHOW</w:t></w:r>
    <w:r><w:t xml:space="preserve"> More visible.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'Visible text. More visible.', JSON.stringify(para));
  assert.ok(!para.text.includes('HIDDEN'), JSON.stringify(para));
});

test('item 3: w:specVanish text is never transcribed either', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">A </w:t></w:r>
    <w:r><w:rPr><w:specVanish/></w:rPr><w:t>SPEC-HIDDEN</w:t></w:r>
    <w:r><w:t xml:space="preserve"> B</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'A B', JSON.stringify(para));
});

// ---------------------------------------------------------------------------------------
// Item 4: w:caps / w:smallCaps -> upper case (RUEB 9.6.1), incl. rStyle inheritance.
// ---------------------------------------------------------------------------------------
test('item 4: w:caps and w:smallCaps both upper-case the run (RUEB 9.6.1)', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Normal </w:t></w:r>
    <w:r><w:rPr><w:caps/></w:rPr><w:t>shown as caps</w:t></w:r>
    <w:r><w:t xml:space="preserve"> and </w:t></w:r>
    <w:r><w:rPr><w:smallCaps/></w:rPr><w:t>small caps text</w:t></w:r>
    <w:r><w:t>.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'Normal SHOWN AS CAPS and SMALL CAPS TEXT.', JSON.stringify(para));
});

test('item 4: caps set via a character style (rStyle), resolved up w:basedOn', async () => {
  const bodyXml = `<w:p><w:r><w:rPr><w:rStyle w:val="AllCaps"/></w:rPr><w:t>styled caps text</w:t></w:r></w:p>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
  <w:style w:type="character" w:styleId="AllCapsBase"><w:rPr><w:caps/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="AllCaps"><w:basedOn w:val="AllCapsBase"/></w:style>
</w:styles>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/styles.xml', text: stylesXml }] });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'STYLED CAPS TEXT', JSON.stringify(para));
});

// ---------------------------------------------------------------------------------------
// Item 5: w:sym.
// ---------------------------------------------------------------------------------------
test('item 5: w:sym maps a Wingdings glyph (arrow) to Unicode', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">A symbol: </w:t></w:r>
    <w:r><w:sym w:font="Wingdings" w:char="F0E0"/></w:r>
    <w:r><w:t xml:space="preserve"> follows.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'A symbol: → follows.', JSON.stringify(para));
});

test('item 5: w:sym on a plain (non-symbol) font uses the code point directly', async () => {
  const bodyXml = `<w:p><w:r><w:sym w:font="MS Gothic" w:char="2612"/></w:r>
    <w:r><w:t xml:space="preserve"> Task complete (checked, via w:sym glyph)</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, '☒ Task complete (checked, via w:sym glyph)', JSON.stringify(para));
});

test('item 5: an unmapped Wingdings glyph falls back to a visible placeholder, not silence', async () => {
  // Wingdings F076 (diamond — genuinely not in WINGDINGS_GLYPHS, unlike F0FE/F0FD which the
  // docx-fix item 9 pass added a confidently-sourced mapping for; see that test below): no
  // confidently-sourced mapping, so this must NOT vanish, and must NOT be mistaken for one
  // of the table's real entries.
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F076"/></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  // EXPECTATION CHANGED 30 Sep 2026 (import fix list #36 / audit w03 — Paul's import fix list): the placeholder was U+25A1, the white
  // square, which braille translates as a real white-square sign — a wrong symbol, silently, with no warning. It is now
  // U+FFFD (the replacement character): still visible, and a character the braille tables have no cell for, so the
  // formatter's untranslatable-character warning reports it; the import also lists it in doc.warnings
  // (Emboss/tests/docx_import_batch_30sep.test.mjs, group #36).
  assert.equal(para.text, 'Before \uFFFD after', JSON.stringify(para));
});

// ---------------------------------------------------------------------------------------
// Item 6: SmartArt / chart drawings.
// ---------------------------------------------------------------------------------------
test('item 6: a SmartArt diagram with a docPr descr becomes a graphic placeholder', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Before diagram: </w:t></w:r>
    <w:r><w:drawing><wp:inline>
      <wp:docPr id="1" name="Diagram1" descr="A cycle diagram showing four stages: Plan, Do, Check, Act"/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
        <dgm:relIds xmlns:dgm="${DGM}" r:dm="rIdDm1" r:lo="rIdLo1" r:qs="rIdQs1" r:cs="rIdCs1"/>
      </a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r>
    <w:r><w:t>.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, 'no graphic/placeholder block at all: ' + JSON.stringify(doc.blocks));
  assert.equal(g.alt, 'A cycle diagram showing four stages: Plan, Do, Check, Act');
});

test('item 6: a chart drawing with no descr falls back to a generic "chart" label', async () => {
  const bodyXml = `<w:p><w:r><w:drawing><wp:inline>
      <wp:docPr id="2" name="Chart1"/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
        <c:chart xmlns:c="${C}" r:id="rIdChart1"/>
      </a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, JSON.stringify(doc.blocks));
  assert.equal(g.alt, 'chart');
});

test('item 6: a diagram with no descr falls back to its own (simple) data-part text', async () => {
  const bodyXml = `<w:p><w:r><w:drawing><wp:inline>
      <wp:docPr id="3" name="Diagram2"/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
        <dgm:relIds xmlns:dgm="${DGM}" r:dm="rIdDm2" r:lo="rIdLo2" r:qs="rIdQs2" r:cs="rIdCs2"/>
      </a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>`;
  const dataXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dsp:dataModel xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="${A}">
  <a:p><a:r><a:t>Plan</a:t></a:r></a:p>
  <a:p><a:r><a:t>Do</a:t></a:r></a:p>
</dsp:dataModel>`;
  const doc = await buildDocx({
    bodyXml,
    rels: RELS('<Relationship Id="rIdDm2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="diagrams/data1.xml"/>'),
    extraParts: [{ name: 'word/diagrams/data1.xml', text: dataXml }],
  });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, JSON.stringify(doc.blocks));
  assert.equal(g.alt, 'Plan, Do');
});

// ---------------------------------------------------------------------------------------
// Item 7: Shift+Enter line breaks.
// ---------------------------------------------------------------------------------------
// IMP-W2 (Paul, 30 Sep 2026; decisions.md "Word import"): Shift+Enter in an ordinary paragraph is a forced line break inside ONE
// paragraph, no longer poetry/verse layout (one play/verse block per line). These two tests pinned the old verse split and now
// expect the single paragraph with '\n' between the lines; the verse split for a poem/verse STYLE is pinned in
// import_imp_w_30sep.test.mjs. (docs/expectation-changes.md)
test('item 7: Shift+Enter lines stay separate lines, not run together (IMP-W2: one paragraph, forced line breaks)', async () => {
  const bodyXml = `<w:p><w:r><w:t>Line one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Line two</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Line three</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  assert.equal(doc.blocks.filter((b) => b.type === 'play').length, 0, 'not verse: ' + JSON.stringify(doc.blocks));
  assert.equal(doc.blocks.length, 1, JSON.stringify(doc.blocks));
  assert.equal(doc.blocks[0].segments.map((s) => s.text).join(''), 'Line one\nLine two\nLine three');
});

test('item 7: w:type="textWrapping" is the same as no type at all (IMP-W2)', async () => {
  const bodyXml = `<w:p><w:r><w:t>Wrapped</w:t></w:r><w:r><w:br w:type="textWrapping" w:clear="all"/></w:r><w:r><w:t>line two, same paragraph (Shift+Enter poetry style).</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  assert.equal(doc.blocks.filter((b) => b.type === 'play').length, 0, JSON.stringify(doc.blocks));
  assert.equal(doc.blocks[0].segments.map((s) => s.text).join(''), 'Wrapped\nline two, same paragraph (Shift+Enter poetry style).', JSON.stringify(doc.blocks));
});

test('item 7: a column break (w:type="column") is unaffected — collapses to a space, not a new line', async () => {
  const bodyXml = `<w:p><w:r><w:t>Col one text.</w:t></w:r><w:r><w:br w:type="column"/></w:r><w:r><w:t>Col two text.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const verse = doc.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
  assert.equal(verse.length, 0, 'a column break must not be treated as a Shift+Enter line break: ' + JSON.stringify(doc.blocks));
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'Col one text. Col two text.');
});

// ---------------------------------------------------------------------------------------
// Item 8: non-equation embedded OLE object (see also docx_equations.test.mjs).
// ---------------------------------------------------------------------------------------
test('item 8: an embedded Excel spreadsheet gets a placeholder + load warning', async () => {
  const O = 'urn:schemas-microsoft-com:office:office';
  const V = 'urn:schemas-microsoft-com:vml';
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">See the embedded spreadsheet: </w:t></w:r>
    <w:r><w:object w:dxaOrig="1000" w:dyaOrig="1000">
      <v:shapetype id="_x0000_t75"/>
      <v:shape id="_x0000_i1025" type="#_x0000_t75"><v:imagedata r:id="rIdIcon1" o:title=""/></v:shape>
      <o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" ShapeID="_x0000_i1025" DrawAspect="Icon" ObjectID="_1" r:id="rIdOle1"/>
    </w:object></w:r>
    <w:r><w:t>.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, extraNs: ` xmlns:o="${O}" xmlns:v="${V}"` });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.ok(para.segments, JSON.stringify(para));
  const note = para.segments.find((s) => s.type === 'imgnote');
  assert.ok(note, JSON.stringify(para));
  assert.match(note.text, /embedded object not transcribed/);
  assert.match(note.text, /excel spreadsheet/i);
  assert.ok(doc.warnings && doc.warnings.some((w) => /embedded object/i.test(w)), JSON.stringify(doc.warnings));
});

// ---------------------------------------------------------------------------------------
// Item 9: drop caps.
// ---------------------------------------------------------------------------------------
test('item 9: a drop-cap paragraph merges onto the start of the following paragraph', async () => {
  const bodyXml = `<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3"/></w:pPr><w:r><w:t>O</w:t></w:r></w:p>
    <w:p><w:r><w:t>nce upon a time, in the drop-cap paragraph continuation.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const paras = doc.blocks.filter((b) => b.type === 'para' || b.type === 'title' || b.type === 'heading');
  assert.equal(paras.length, 1, 'the drop-cap paragraph must not survive as its own separate block: ' + JSON.stringify(doc.blocks));
  assert.equal(paras[0].text, 'Once upon a time, in the drop-cap paragraph continuation.', JSON.stringify(paras[0]));
});

test('item 9: a drop cap as the very last paragraph is still kept (fallback push)', async () => {
  const bodyXml = `<w:p><w:r><w:t>Intro.</w:t></w:r></w:p>
    <w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3"/></w:pPr><w:r><w:t>T</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const paras = doc.blocks.filter((b) => b.type === 'para');
  assert.equal(paras.length, 2, JSON.stringify(doc.blocks));
  assert.equal(paras[1].text, 'T', JSON.stringify(paras[1]));
});

// ---------------------------------------------------------------------------------------
// Item 10: docProps/core.xml title/author fallback.
// ---------------------------------------------------------------------------------------
test('item 10: dc:title fills model.title when the body has none; dc:creator -> metadata.creator', async () => {
  const bodyXml = `<w:p><w:r><w:t>Just an ordinary first paragraph, no Title style.</w:t></w:r></w:p>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Document's Real Title</dc:title><dc:creator>Jane Author</dc:creator></cp:coreProperties>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'docProps/core.xml', text: coreXml }] });
  assert.equal(doc.title, "The Document's Real Title", JSON.stringify(doc));
  assert.equal(doc.metadata && doc.metadata.creator, 'Jane Author', JSON.stringify(doc));
});

test('item 10: a real body title always wins over docProps/core.xml', async () => {
  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Body Title</w:t></w:r></w:p>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Core Title Must Not Win</dc:title></cp:coreProperties>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'docProps/core.xml', text: coreXml }] });
  assert.equal(doc.title, 'Body Title', JSON.stringify(doc));
});

// ---------------------------------------------------------------------------------------
// Item 11: w:altChunk.
// ---------------------------------------------------------------------------------------
test('item 11: w:altChunk (embedded HTML) is read and spliced in, in place', async () => {
  const bodyXml = `<w:p><w:r><w:t>Before altChunk.</w:t></w:r></w:p>
    <w:altChunk r:id="rIdChunk1"/>
    <w:p><w:r><w:t>After altChunk.</w:t></w:r></w:p>`;
  const chunkHtml = `<html><body><p>Chunk paragraph one.</p><p>Chunk paragraph two.</p></body></html>`;
  const doc = await buildDocx({
    bodyXml,
    rels: RELS('<Relationship Id="rIdChunk1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk1.html"/>'),
    extraParts: [{ name: 'word/chunk1.html', text: chunkHtml }],
  });
  const texts = doc.blocks.filter((b) => b.type === 'para').map((b) => b.text);
  assert.deepEqual(texts, ['Before altChunk.', 'Chunk paragraph one.', 'Chunk paragraph two.', 'After altChunk.'], JSON.stringify(doc.blocks));
});

// ---------------------------------------------------------------------------------------
// Item 12: w:ruby.
// ---------------------------------------------------------------------------------------
// IMP-W11 (Paul, 30 Sep 2026, decisions.md "Word import"): the ruby guide is no longer dropped; it follows its base text in brackets.
// This test pinned "keeps only the base text, drops the ruby annotation".
test('item 12: w:ruby keeps the base text and follows it with the ruby annotation in brackets (IMP-W11)', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Word: </w:t></w:r>
    <w:r><w:ruby><w:rubyPr/>
      <w:rt><w:r><w:t>かんじ</w:t></w:r></w:rt>
      <w:rubyBase><w:r><w:t>漢字</w:t></w:r></w:rubyBase>
    </w:ruby></w:r>
    <w:r><w:t xml:space="preserve"> follows.</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'Word: 漢字 (かんじ) follows.', JSON.stringify(para));
});

// ---------------------------------------------------------------------------------------
// NIMAS save/reopen: the new structures (nested table flattened, verse-line breaks,
// placeholders) must survive an export/reopen round trip.
// ---------------------------------------------------------------------------------------
// IMP-W2 (Paul, 30 Sep 2026): the verse split now applies only to a poem / verse STYLE, so this round trip uses a "Poem" style
// paragraph (it used an unstyled one); an ordinary paragraph's forced line break is round-tripped in import_imp_w_30sep.test.mjs.
test('NIMAS round trip: shift-enter verse lines (in a poem style) survive export/reopen', async () => {
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Poem"><w:name w:val="Poem"/></w:style></w:styles>`;
  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="Poem"/></w:pPr><w:r><w:t>Line one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Line two</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/styles.xml', text: styles }] });
  const xml = exportToNimasXml(doc, { title: 'T' });
  const reopened = parseDtbook(xml);
  const verse = reopened.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
  assert.deepEqual(verse.map((b) => b.text), ['Line one', 'Line two'], xml);
});

test('NIMAS round trip: a nested table keeps its text (a table of its own after the outer one)', async () => {
  const bodyXml = `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>
    <w:tc><w:p><w:r><w:t>Outer A1</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner 1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:tc>
    <w:tc><w:p><w:r><w:t>Outer B1</w:t></w:r></w:p></w:tc>
  </w:tr></w:tbl>`;
  const doc = await buildDocx({ bodyXml });
  const xml = exportToNimasXml(doc, { title: 'T' });
  const reopened = parseDtbook(xml);
  const t = reopened.blocks.find((b) => b.type === 'table');
  assert.ok(t, xml);
  assert.equal(t.headers.length, 2, 'still 2 columns after a save/reopen round trip, not 3: ' + JSON.stringify(t.headers));
  assert.equal(t.rows.length, 0, 'no bogus extra row survives a save/reopen round trip: ' + JSON.stringify(t.rows));
  assert.equal(t.headers[0], 'Outer A1 (table follows)');   // IMP-W6
  assert.equal(t.headers[1], 'Outer B1');
  assert.deepEqual(reopened.blocks.filter((b) => b.type === 'table')[1].headers, ['Inner 1']);   // the inner table, once, after it
});
