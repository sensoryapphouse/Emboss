// F-1: parseTable read colspan but never rowspan, so a rowspanned row-heading cell was
// silently dropped from every row after its own <tr> and everything after it in that row
// shifted one column to the left (Emboss/docs/standards-findings.md, F-1).
//
// BANA Formats 2016 §11.5.3a: "When a row heading is not repeated but refers to more than
// one column entry, leave the area(s) where the inferred row heading(s) belong blank." That
// is unambiguous about what belongs in a spanned row's row-heading area — a blank, not a
// repeat — so Emboss fills every column a rowspanned cell covers with '' in the rows after
// its own, for both row headings and ordinary column entries (data integrity applies to
// either), keeping every row the same width as the table's column count.
// IMP-W5 (Paul, 30 Sep 2026, decisions.md "Word import": "Merged cells repeat the merged text in every cell they cover, so no column
// is left empty in braille"): the HTML, ODT and DOCX readers below now REPEAT a merged cell's text in the cells it covers instead of
// leaving them blank (BANA 11.5.3a, above). The DTBook reader (parseDtbook) is unchanged and keeps the blank of F-1. The tests for the
// three readers that changed carry the IMP-W5 reason at each changed expectation; their shapes (what is aligned with what) are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook, parseHtml, parseOdt } from '../input/parse.mjs';
import { formatBlock } from '../format/document.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;

const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const odtBuf = (contentBodyXml) => zipBuf([{
  name: 'content.xml',
  text: `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><office:body><office:text>${contentBodyXml}</office:text></office:body></office:document-content>`,
}]);

const dtbook = (tableXml) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
  ${tableXml}
</level1></bodymatter></book></dtbook>`;

const opts = (mode, width) => ({ mode, width, depth: 25, translate: (s) => String(s) });

test('F-1 reproduction: a rowspanned row heading leaves the spanned row a blank first cell, not shifted', () => {
  const xml = dtbook(`<table>
    <tr><th>Region</th><th>Year</th><th>Sales</th></tr>
    <tr><td rowspan="2">North</td><td>2020</td><td>10</td></tr>
    <tr><td>2021</td><td>12</td></tr>
  </table>`);
  const t = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['Region', 'Year', 'Sales']);
  assert.deepEqual(t.rows[0], ['North', '2020', '10']);
  // Not ['2021', '12'] shifted into Region/Year — BANA 11.5.3a: the row-heading area
  // stays blank for the row(s) after the one that carries it.
  assert.deepEqual(t.rows[1], ['', '2021', '12']);
});

// Updated for F-12 (BANA 11.4.3, "Complex Tables with Column and Sub-column Headings"):
// two <thead> rows of nothing but <th> is exactly the DTBook shape a two-tier header
// round-trips as (parse.mjs's parseTable / nimas-export.mjs's serializeBlock) — a
// <th colspan> is a GROUP's primary heading, a <th rowspan> a single-tier heading
// beside it. Before this fix, the second <thead> row had no such reading and was
// pushed into `rows` as an ordinary (blank-continuation) data row — this test's own
// original expectation, which the F-12 status update in standards-findings.md records
// as superseded by this rule, not merely reformatted here.
test('rowspan in a header row: a <th> spanning two <thead> rows becomes a headerGroups single-tier column, not a data row (BANA 11.4.3)', () => {
  const xml = dtbook(`<table>
    <thead>
      <tr><th rowspan="2">Product</th><th colspan="2">2024</th></tr>
      <tr><th>Q1</th><th>Q2</th></tr>
    </thead>
    <tbody>
      <tr><td>Widgets</td><td>10</td><td>20</td></tr>
    </tbody>
  </table>`);
  const t = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['Product', 'Q1', 'Q2']);
  assert.deepEqual(t.headerGroups, [{ text: '2024', from: 1, to: 2 }]);
  // No synthetic blank-continuation data row — the tbody's own row is rows[0].
  assert.deepEqual(t.rows, [['Widgets', '10', '20']]);
});

test('rowspan and colspan together stay aligned in both the spanning row and the row after it', () => {
  const xml = dtbook(`<table>
    <tr><th>Region</th><th>H1</th><th>H2</th><th>Total</th></tr>
    <tr><td rowspan="2">North</td><td colspan="2">Merged</td><td>100</td></tr>
    <tr><td>A</td><td>B</td><td>200</td></tr>
  </table>`);
  const t = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[0], ['North', 'Merged', '', '100']);
  assert.deepEqual(t.rows[1], ['', 'A', 'B', '200']);
});

test('a rowspan reaching past the table\'s last row does not throw and does not corrupt the rows that do exist', () => {
  const xml = dtbook(`<table>
    <tr><th>Region</th><th>Year</th></tr>
    <tr><td rowspan="5">North</td><td>2020</td></tr>
  </table>`);
  let t;
  assert.doesNotThrow(() => {
    t = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  });
  assert.deepEqual(t.rows, [['North', '2020']]);
});

test('formatBlock keeps a rowspanned row aligned: the blank row-heading area lines up with the row above, not shifted', () => {
  const xml = dtbook(`<table>
    <tr><th>Region</th><th>Year</th><th>Sales</th></tr>
    <tr><td rowspan="2">North</td><td>2020</td><td>10</td></tr>
    <tr><td>2021</td><td>12</td></tr>
  </table>`);
  const block = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  for (const mode of ['bana', 'ukaaf']) {
    const lines = formatBlock(block, opts(mode, 40));
    const northLine = lines.find((l) => l.includes('North'));
    const blankHeadingLine = lines.find((l) => l.includes('2021'));
    assert.ok(northLine && blankHeadingLine, `${mode}: both rows should render: ${JSON.stringify(lines)}`);
    // "2020" (row 1, Year column) and "2021" (row 2, Year column) must start at the same
    // column offset — if the spanned row had shifted left (the F-1 bug), "2021" would
    // start where "North" starts instead.
    assert.equal(northLine.indexOf('2020'), blankHeadingLine.indexOf('2021'), `${mode}: Year column misaligned: ${JSON.stringify(lines)}`);
    assert.equal(northLine.indexOf('10'), blankHeadingLine.indexOf('12'), `${mode}: Sales column misaligned: ${JSON.stringify(lines)}`);
    // The spanned row must not repeat/leak "North" and must not start with "2021" itself
    // (that would mean it landed in the Region column).
    assert.equal(blankHeadingLine.indexOf('North'), -1, `${mode}: row heading should not repeat: ${JSON.stringify(lines)}`);
    assert.notEqual(blankHeadingLine.indexOf('2021'), 0, `${mode}: Year value must not have shifted into the Region column: ${JSON.stringify(lines)}`);
  }
});

// ---------------------------------------------------------------------------------------
// F-1, HTML: parseHtml's own table reader (a separate code path from parseDtbook's
// parseTable, used for HTML/EPUB) handled colspan but never rowspan either. Fixed via the
// shared createSpanReader helper (parse.mjs, next to parseHtml).
// ---------------------------------------------------------------------------------------
test('HTML: rowspan in the first column leaves the spanned row a blank first cell, not shifted', () => {
  const html = '<table><tr><th>Region</th><th>Year</th><th>Sales</th></tr>' +
    '<tr><td rowspan="2">North</td><td>2020</td><td>10</td></tr>' +
    '<tr><td>2021</td><td>12</td></tr></table>';
  const t = parseHtml(html).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['Region', 'Year', 'Sales']);
  assert.deepEqual(t.rows[0], ['North', '2020', '10']);
  assert.deepEqual(t.rows[1], ['North', '2021', '12']);   // IMP-W5 (was ['', '2021', '12'])
});

test('HTML: rowspan in a middle column stays aligned', () => {
  const html = '<table><tr><td>Region</td><td rowspan="2">Note</td><td>Value</td></tr>' +
    '<tr><td>North</td><td>10</td></tr></table>';
  const t = parseHtml(html).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[0], ['Region', 'Note', 'Value']);
  assert.deepEqual(t.rows[1], ['North', 'Note', '10']);   // IMP-W5 (was ['North', '', '10'])
});

test('HTML: rowspan reaching to the end of the table does not throw or corrupt existing rows', () => {
  const html = '<table><tr><td>Region</td><td>Year</td><td rowspan="3">ongoing</td></tr>' +
    '<tr><td>North</td><td>2020</td></tr><tr><td>South</td><td>2021</td></tr></table>';
  let t;
  assert.doesNotThrow(() => { t = parseHtml(html).blocks.find((b) => b.type === 'table'); });
  assert.deepEqual(t.rows[0], ['Region', 'Year', 'ongoing']);
  assert.deepEqual(t.rows[1], ['North', '2020', 'ongoing']);   // IMP-W5 (was '')
  assert.deepEqual(t.rows[2], ['South', '2021', 'ongoing']);   // IMP-W5 (was '')
});

test('HTML: rowspan combined with colspan stays aligned in both the spanning row and the row after it', () => {
  const html = '<table><tr><td>Region</td><td>H1</td><td>H2</td><td>Total</td></tr>' +
    '<tr><td rowspan="2">North</td><td colspan="2">Merged</td><td>100</td></tr>' +
    '<tr><td>A</td><td>B</td><td>200</td></tr></table>';
  const t = parseHtml(html).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[1], ['North', 'Merged', 'Merged', '100']);   // IMP-W5 (was ['North', 'Merged', '', '100'])
  assert.deepEqual(t.rows[2], ['North', 'A', 'B', '200']);            // IMP-W5 (was ['', 'A', 'B', '200'])
});

// ---------------------------------------------------------------------------------------
// F-1, ODT: parseOdt's table reader only read <table:table-cell>, never
// <table:covered-table-cell> — the element ODF always writes, in-place, for every grid
// position a row OR column span covers (the same reason DOCX's w:vMerge needs no special
// handling: unlike HTML's rowspan, the ODF/OOXML grid stays physically rectangular). A
// covered position was skipped outright, not blanked, so the row came out short and every
// later real cell shifted into the wrong column — data corruption, not just a formatting
// gap. Fixed by reading <table:covered-table-cell> as an empty cell in place.
// ---------------------------------------------------------------------------------------
test('ODT: rowspan (table:number-rows-spanned) in the first column leaves the spanned row a blank first cell, not shifted', async () => {
  const buf = await odtBuf(`<table:table>
    <table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Year</text:p></table:table-cell><table:table-cell><text:p>Sales</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell table:number-rows-spanned="2"><text:p>North</text:p></table:table-cell><table:table-cell><text:p>2020</text:p></table:table-cell><table:table-cell><text:p>10</text:p></table:table-cell></table:table-row>
    <table:table-row><table:covered-table-cell/><table:table-cell><text:p>2021</text:p></table:table-cell><table:table-cell><text:p>12</text:p></table:table-cell></table:table-row>
  </table:table>`);
  const model = await parseOdt(buf);
  const t = model.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[0], ['Region', 'Year', 'Sales']);
  assert.deepEqual(t.rows[1], ['North', '2020', '10']);
  assert.deepEqual(t.rows[2], ['North', '2021', '12']);   // IMP-W5 (was ['', '2021', '12'])
});

test('ODT: rowspan in a middle column stays aligned', async () => {
  const buf = await odtBuf(`<table:table>
    <table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell table:number-rows-spanned="2"><text:p>Note</text:p></table:table-cell><table:table-cell><text:p>Value</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>10</text:p></table:table-cell></table:table-row>
  </table:table>`);
  const model = await parseOdt(buf);
  const t = model.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[0], ['Region', 'Note', 'Value']);
  assert.deepEqual(t.rows[1], ['North', 'Note', '10']);   // IMP-W5 (was ['North', '', '10'])
});

test('ODT: rowspan reaching to the end of the table does not throw or corrupt existing rows', async () => {
  const buf = await odtBuf(`<table:table>
    <table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Year</text:p></table:table-cell><table:table-cell><text:p>ongoing</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell><text:p>2020</text:p></table:table-cell><table:table-cell table:number-rows-spanned="2"><text:p>note</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell><text:p>South</text:p></table:table-cell><table:table-cell><text:p>2021</text:p></table:table-cell><table:covered-table-cell/></table:table-row>
  </table:table>`);
  let model;
  await assert.doesNotReject(async () => { model = await parseOdt(buf); });
  const t = model.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[1], ['North', '2020', 'note']);
  assert.deepEqual(t.rows[2], ['South', '2021', 'note']);   // IMP-W5 (was '')
});

test('ODT: rowspan combined with colspan (table:number-columns-spanned) stays aligned', async () => {
  const buf = await odtBuf(`<table:table>
    <table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>H1</text:p></table:table-cell><table:table-cell><text:p>H2</text:p></table:table-cell><table:table-cell><text:p>Total</text:p></table:table-cell></table:table-row>
    <table:table-row><table:table-cell table:number-rows-spanned="2"><text:p>North</text:p></table:table-cell><table:table-cell table:number-columns-spanned="2"><text:p>Merged</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>100</text:p></table:table-cell></table:table-row>
    <table:table-row><table:covered-table-cell/><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell><table:table-cell><text:p>200</text:p></table:table-cell></table:table-row>
  </table:table>`);
  const model = await parseOdt(buf);
  const t = model.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows[1], ['North', 'Merged', 'Merged', '100']);   // IMP-W5 (was ['North', 'Merged', '', '100'])
  assert.deepEqual(t.rows[2], ['North', 'A', 'B', '200']);            // IMP-W5 (was ['', 'A', 'B', '200'])
});

// ---------------------------------------------------------------------------------------
// F-1, DOCX: parseDocx's own table reader never reads w:vMerge at all — but unlike HTML's
// rowspan (which omits the covered cell from later <w:tr>s outright), OOXML keeps one real
// (normally empty) <w:tc> per row per column even for a vMerge continuation cell, so the
// grid parseDocx already reads stays rectangular with no special-casing needed. This is a
// regression guard confirming that, not a fix — see createSpanReader's own comment in
// parse.mjs for the scratch repro this was checked against before deciding not to touch
// parseDocx for this finding.
// ---------------------------------------------------------------------------------------
test('DOCX: a w:vMerge continuation cell keeps the grid rectangular and (IMP-W5) repeats the merged cell\'s text', async () => {
  const { parseDocx } = await import('../input/parse.mjs');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Year</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2020</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>2021</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`;
  const buf = await zipBuf([{ name: 'word/document.xml', text: docXml }]);
  const model = await parseDocx(buf);
  const t = model.blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['Region', 'Year', 'Sales']);
  assert.deepEqual(t.rows[0], ['North', '2020', '10']);
  assert.deepEqual(t.rows[1], ['North', '2021', '12']);   // IMP-W5 (was ['', '2021', '12'])
});
