// BrailleBlaster-style HTML/DTBook table test fixtures (Emboss/tests/nimas_samples/
// TablesTestXml.xml — a real BrailleBlaster test file: an <html><body> document with 7
// <table>s whose cells hold print text followed by a BrailleBlaster <brl>…</brl> child
// carrying the pre-supplied braille for that print text).
//
// Two real bugs, found by importing this file into the editor:
//
// 1. parseFile routes ANY .xml file to parseDtbook (parse.mjs's parseFile dispatch), even
//    one whose root is <html><body> rather than DTBook's own <book>/<bodymatter>. Reading
//    it that way still finds every <table> (parseDtbook's own generic-wrapper descent), but
//    inlineSegments/getCleanText both deliberately exclude <brl> from a cell's print text
//    (it holds pre-supplied braille, not print) — so a cell whose ONLY content is <brl> (no
//    print text at all, e.g. the "Examples from Braille Formats 2011" tables) read as
//    completely empty. An all-empty row is dropped, and a table with no non-empty row
//    silently produced NO table block at all — 4 of the file's 7 tables vanished from the
//    model with no trace and no warning. Decided model: a <brl>-only cell holds LITERAL
//    braille (document.mjs's existing {type:'brl'} segment, F-187/F-188/F-222) — kept, not
//    dropped, and rendered as literal cells (segmentsToBraille/groupSegments already do
//    this once the segment survives parsing). Fixed by:
//      - parse.mjs's parseTable (DTBook) / parseHtml's own table branch (HTML): a cell
//        with no print text but a <brl> descendant becomes { text: '', segments:
//        [{ type: 'brl', text: '', brl }] } instead of ''.
//      - four "is this cell rich enough to keep its segments" predicates that all omitted
//        type==='brl' (so the segment was thrown away again even once produced):
//        format/cell-markup.mjs's cellFromSegments/cellIsRich, parse.mjs's
//        richCellFromSegments, format/document.mjs's segsBraille/segsAreRich.
//      - two DTBook row-keep checks that tested a cell's `.text` for truthiness (blank for
//        a brl-only cell, whose print `.text` is deliberately '') instead of real content.
//      - cell-markup.mjs's cellIsBlank, which also only checked print text.
// 2. A <td colspan="20"> in a table whose other rows are genuinely 4 columns wide parsed
//    into a 23-column block (colspan padded blindly, both in parseTable's own readSpannedRow
//    and the HTML/ODT-shared createSpanReader), instead of being clamped the way a
//    colspan="2"/"4" row in the SAME table already is. Fixed: the table's real column count
//    (mostCommonRowWidth: the most common row width, measured by each row's own raw,
//    unclamped colspan sum) clamps any wider colspan to whatever columns are actually left
//    in its row — a spanning cell then covers the remaining columns, exactly like a colspan
//    that already fit.
//
// Both readers (DTBook and HTML) are checked here and must behave the same — the file is
// literally identical content either way, just parsed by a different reader.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { parseFile, parseDtbook, parseHtml } from '../input/parse.mjs';
import { formatBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(here, 'nimas_samples/TablesTestXml.xml'), 'utf8');

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = { mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, translatePos: upPos };

const colCountOf = (t) => Math.max(t.headers.length, ...t.rows.map((r) => r.length), 0);

// The expected column count of each of the file's 7 tables, in source order, once colspan
// is read (and clamped where it overflows) correctly — independent of which reader parses
// it. Table index 2 is the colspan="20" table: the table's real width (from its own
// colspan="2"/colspan="4" rows) is 4, so the colspan="20" cell is clamped to 4 — but 3 more
// real <td>s follow it in the same source row, so that row (and so the table) is still 7
// columns wide overall; the point of the clamp is that the SPANNING CELL no longer reaches
// 20/23 columns on its own, not that the row's genuine extra cells are discarded.
const EXPECTED_COL_COUNTS = [3, 3, 7, 5, 5, 3, 4];

describe('TablesTestXml.xml: all 7 tables become table blocks (DTBook reader, the real parseFile(".xml") path)', () => {
  test('parseFile(".xml") routes to parseDtbook, and every <table> survives', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    assert.equal(tables.length, 7, 'all 7 <table>s become table blocks — none silently dropped');
  });

  test('each table has the right (colspan-clamped) column count', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    assert.deepEqual(tables.map(colCountOf), EXPECTED_COL_COUNTS);
  });

  test('a <brl>-only cell (no print text) keeps its braille as a literal brl segment', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    // Table 3 (0-based index 3): "Examples from Braille Formats 2011", every cell is
    // <td><brl>…</brl></td> with no print text of its own.
    const t = tables[3];
    const cell = t.rows[1][0];   // <td><brl>,m>ijuana</brl></td>
    assert.equal(typeof cell, 'object', 'a brl-only cell is a rich { text, segments } object, not a dropped empty string');
    assert.equal(cell.text, '');
    assert.deepEqual(cell.segments, [{ type: 'brl', text: '', brl: ',m>ijuana' }]);
    // An empty <brl></brl> (genuinely no braille either) stays a plain blank cell.
    assert.equal(t.rows[0][0], '');
  });

  test('a brl-only cell renders its literal braille untranslated', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    const lines = formatBlock(tables[3], opts).join('\n');
    // The literal source braille (lower-case ASCII braille, never run through translate/
    // upper-cased by the fake `up` translator above — proof it bypassed translation).
    assert.match(lines, /,m>ijuana/);
    assert.match(lines, /#he\.b/);
  });

  test('a cell with real print text still discards its <brl> sibling (Emboss translates the print itself)', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    assert.deepEqual(tables[0].headers, ['Very Lengthy Test Heading', 'Medium-sized Heading', 'Small Heading']);
    assert.deepEqual(tables[0].rows[0], ['Extremely Long Test Entry', 'Medium-sized Entry', 'Small Entry']);
  });

  test('the colspan="20" row is clamped to the table\'s real width (4), like its own colspan="2"/"4" rows', async () => {
    const model = await parseFile('TablesTestXml.xml', FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    const t = tables[2];
    assert.equal(t.rows[1][1], '', 'colspan="2" row: covered column blank');
    assert.equal(t.rows[2][1], '', 'colspan="4" row: covered column blank (spans the whole row)');
    // colspan="20" row: clamped to 4 (this row's own start column 0 to the table's real
    // width), covering columns 1-3 blank exactly like the colspan="4" row above — NOT
    // ballooned out to 20/23 columns. Three more real <td>s follow in the source after the
    // colspan="20" cell, so the row is still 7 wide overall (4 clamped + 3 real trailing
    // cells) — real content is never dropped, only the spanning cell's own reach is capped.
    const row = t.rows[3];
    assert.equal(row[0], 'Line Wrap Test');
    assert.equal(row[1], '');
    assert.equal(row[2], '');
    assert.equal(row[3], '');
    assert.equal(row.length, 7);
  });
});

describe('TablesTestXml.xml via the HTML reader (a .html file with the same content) behaves the same', () => {
  test('parseHtml finds all 7 tables with the same column counts as the DTBook reader', () => {
    const model = parseHtml(FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    assert.equal(tables.length, 7);
    assert.deepEqual(tables.map(colCountOf), EXPECTED_COL_COUNTS);
  });

  test('a <brl>-only cell keeps its braille the same way as the DTBook reader', () => {
    const model = parseHtml(FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    const cell = tables[3].rows[1][0];
    assert.equal(typeof cell, 'object');
    assert.equal(cell.text, '');
    assert.deepEqual(cell.segments, [{ type: 'brl', text: '', brl: ',m>ijuana' }]);
  });

  test('a cell with real print text does not have the <brl> ASCII text merged into it', () => {
    const model = parseHtml(FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    // Before the fix, htmlParagraphSegments/textContent had no <brl> exclusion at all, so
    // the cell's flat text read as "Extremely Long Test Entry,extremely ,l;g ,te/ ,5try".
    assert.equal(tables[0].rows[0][0], 'Extremely Long Test Entry');
  });

  // IMP-W5 (Paul, 30 Sep 2026, decisions.md "Word import": merged cells repeat their text in every cell they cover): the HTML reader now
  // repeats the spanning cell's text in the columns it covers (the DTBook reader above still leaves them blank). The clamp to the
  // table's real width (4 columns, 7 cells in all) is unchanged and is what this test is about.
  test('the colspan="20" row is clamped the same way as the DTBook reader (its covered columns now repeat the text, IMP-W5)', () => {
    const model = parseHtml(FIXTURE);
    const tables = model.blocks.filter((b) => b.type === 'table');
    const row = tables[2].rows[3];
    assert.equal(row[0], 'Line Wrap Test');
    assert.equal(row[1], 'Line Wrap Test');
    assert.equal(row[2], 'Line Wrap Test');
    assert.equal(row[3], 'Line Wrap Test');
    assert.equal(row.length, 7);
  });
});

// Small, focused DTBook-source repros (independent of the real fixture file) pinning the
// exact shapes the fixes above rely on.
describe('parseDtbook: minimal repros', () => {
  const dtbook = (tableXml) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
    ${tableXml}
  </level1></bodymatter></book></dtbook>`;

  test('a table whose every cell is <brl>-only is not silently dropped', () => {
    const xml = dtbook(`<table>
      <tr><td><brl>#a</brl></td><td><brl>#b</brl></td></tr>
      <tr><td><brl>#c</brl></td><td><brl>#d</brl></td></tr>
    </table>`);
    const model = parseDtbook(xml);
    const t = model.blocks.find((b) => b.type === 'table');
    assert.ok(t, 'the table block must exist, not vanish because every cell read as blank');
    assert.equal(t.rows.length, 2);
    assert.deepEqual(t.rows[0][0].segments, [{ type: 'brl', text: '', brl: '#a' }]);
  });

  test('a colspan wider than the table is clamped to the remaining columns, not left to widen the whole table', () => {
    const xml = dtbook(`<table>
      <tr><td>A</td><td>B</td><td>C</td></tr>
      <tr><td colspan="99">D</td></tr>
    </table>`);
    const model = parseDtbook(xml);
    const t = model.blocks.find((b) => b.type === 'table');
    assert.deepEqual(t.rows[0], ['A', 'B', 'C']);
    // Clamped to 3 (the table's real width from row 1), not left at 99.
    assert.deepEqual(t.rows[1], ['D', '', '']);
  });

  test('a truly blank row (no print, no brl) is still dropped, unchanged', () => {
    const xml = dtbook(`<table>
      <tr><td>A</td><td>B</td></tr>
      <tr><td></td><td></td></tr>
    </table>`);
    const model = parseDtbook(xml);
    const t = model.blocks.find((b) => b.type === 'table');
    assert.equal(t.rows.length, 1, 'the all-empty row stays dropped');
  });
});
