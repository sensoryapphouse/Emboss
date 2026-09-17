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
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { formatBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;

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
