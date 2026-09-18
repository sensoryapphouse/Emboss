// Six table-formatting bugs written up in Emboss/docs/standards-findings.md (F-2, F-3, F-6,
// F-7, F-8, F-19), each proved against the cited standard's own rule text and, where the
// gold corpus (Emboss/tests/gold/bana-formats-2016/section-11/) or the standard's own primary
// text (references/_text/B004.txt §12, references/_text/braille-formats-2016.txt §11) gives a
// worked example, against that example's own quoted content. Every expected value below comes
// from a rule quote or a worked example — never from Emboss's pre-fix output (standards-
// testing.md's own testing rule). One describe block per finding; formatBlock/traceBlock
// parity is asserted in every case that touches the formatter, so traceTable cannot drift
// from formatTable.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---- fake translate (structural tests: width/margin/column-layout behaviour) -------------
const up = (s) => String(s).toUpperCase();
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

// ---- real liblouis en-ueb-g2 translator (rule-text / worked-example tests) ---------------
let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t) => louis.translatePos(t, T);
});
const realOpts = (mode, width = 38) => ({
  mode, standard: mode, width, depth: 25, translate, translatePos,
});

const findTable = (blocks) => {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'table') return b;
    if (Array.isArray(b.blocks)) { const r = findTable(b.blocks); if (r) return r; }
  }
  return null;
};

// ===========================================================================================
// F-2 — BANA 11.5.4: "Blank Lines. Follow print when blank lines are used to show row
// groupings, or to set off rows of column totals." A row print gives with every column blank
// is a deliberate spacer, not BANA 11.6.4's per-entry "blank to be filled in" (guide dots).
// Gold evidence: tests/gold/bana-formats-2016/section-11/sample-11-06.json ("Table with Blank
// Rows") — its own print.rows include two rows of ['','',''] (after "West Midlands" and after
// "Wales"), and its agreed braille.lines record those as genuinely empty strings ("") between
// the surrounding data rows, never a row of guide dots.
// ===========================================================================================
describe('F-2 — a deliberately blank table row renders as a blank line, not guide dots', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Region/Nation', 'Yes', 'No'],
    rows: [
      ['North East', '5', '95'],
      ['North West', '8', '92'],
      ['', '', ''],                 // sample-11-06's own blank spacer row (11.5.4)
      ['England', '30', '70'],
    ],
  };

  test('a fully blank row is one empty output line (BANA 11.5.4)', () => {
    for (const mode of ['bana', 'ukaaf']) {
      const o = fakeOpts(mode, 40);
      const lines = clean(formatBlock(block, o));
      const neIdx = lines.findIndex((l) => l.includes('NORTH EAST'));
      const engIdx = lines.findIndex((l) => l.includes('ENGLAND'));
      assert.ok(neIdx >= 0 && engIdx > neIdx, `${mode}: ${JSON.stringify(lines)}`);
      // Between the two North rows and England: the North West data row, then exactly one
      // blank spacer line for the deliberately blank print row — nothing else.
      const between = lines.slice(neIdx + 1, engIdx);
      assert.equal(between.length, 2, `${mode}: expected [North West row, blank line]: ${JSON.stringify(between)}`);
      assert.ok(between[0].includes('NORTH WEST'), `${mode}: ${JSON.stringify(between)}`);
      assert.equal(between[1], '', `${mode}: the blank print row must render as a genuinely empty line: ${JSON.stringify(between)}`);
      // Never a row of guide-dot fill characters standing in for the blank row.
      assert.ok(!between.some((l) => l !== '' && !l.includes('NORTH WEST') && /^"+\s*"*\s*"*$/.test(l)),
        `${mode}: no guide-dot-only line: ${JSON.stringify(between)}`);
      parity(block, o);
    }
  });

  test('a row that MIXES real entries with one blank cell still guide-dots that cell (BANA 11.6.4, unaffected)', () => {
    const mixed = {
      type: 'table', format: 'columnar',
      headers: ['Name', 'Score'],
      rows: [['Ann', '10'], ['Bob', '']],   // Bob's score is blank, but Bob's name is not — not a spacer row
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(mixed, o));
    const bobLine = lines.find((l) => l.startsWith('BOB'));
    assert.ok(bobLine, JSON.stringify(lines));
    assert.ok(bobLine.includes('"'), `a row with one real entry and one blank cell still guide-dots the blank cell: ${JSON.stringify(bobLine)}`);
    parity(mixed, o);
  });

  test('a table whose EVERY row is blank is a skeleton table (BANA 11.9.1.b), not a run of blank lines', () => {
    // tests/gold/bana-formats-2016/section-11/sample-11-17.json ("Skeleton Table with
    // Column Headings"): "A skeleton table: only the five column headings are filled in
    // print; all four rows are entirely blank, intended for the reader to fill in their
    // own interests." 11.9.1.b: "Indicate empty column entries with guide dots" — every
    // one of the four blank rows must stay guide-dotted; collapsing them to blank lines
    // (this fix's OWN F-2 mechanism, misapplied here) would erase the skeleton shape a
    // reader is meant to write answers into.
    const skeleton = {
      type: 'table', format: 'columnar',
      headers: ['School', 'People', 'Pets', 'Places', 'Books'],
      rows: [
        ['', '', '', '', ''],
        ['', '', '', '', ''],
        ['', '', '', '', ''],
        ['', '', '', '', ''],
      ],
    };
    for (const o of [fakeOpts('bana', 40), realOpts('bana', 40)]) {
      const lines = clean(formatBlock(skeleton, o));
      // A data row here is entirely guide dots and spaces (no letters) — unlike the
      // header row (letters) or the separator line (its dot runs are contiguous, no
      // internal blanks between columns' worth of guide-dot runs the way a data row has).
      const dataLines = lines.filter((l) => l !== '' && /^["\s]+$/.test(l));
      assert.equal(dataLines.length, 4, `expected 4 guide-dotted rows, not blank lines: ${JSON.stringify(lines)}`);
      for (const l of dataLines) assert.ok(l.includes('"'), `each skeleton row must be guide-dotted: ${JSON.stringify(l)}`);
      parity(skeleton, o);
    }
  });

  test('against the real liblouis translator and sample-11-06\'s own three-column shape (gold-grounded)', () => {
    const o = realOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    assert.ok(lines.includes(''), `expected at least one genuinely blank line for the spacer row: ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});

// ===========================================================================================
// F-3 — BANA 11.2.5f: "Insert print notes pertaining to a table after the table title/label,
// but before the body of the table and any transcriber's notes." A table's own caption IS its
// print title/label (11.2.8); a <tabletn> is exactly the "transcriber's note" the rule places
// AFTER it. Order required: caption, then tabletn note, then the table body.
// ===========================================================================================
describe('F-3 — a table caption precedes its transcriber\'s note, which precedes the table body', () => {
  const dtbook = (tableXml) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    ${tableXml}
  </level1></bodymatter></book>
</dtbook>`;

  test('parseTable pushes the caption block before the tabletn note block', () => {
    const xml = dtbook(`<table>
      <caption>Population by Region</caption>
      <tabletn>Percentages are rounded to the nearest whole number.</tabletn>
      <thead><tr><th>Region</th><th>Pop</th></tr></thead>
      <tbody><tr><td>North</td><td>10</td></tr></tbody>
    </table>`);
    const doc = parseDtbook(xml);
    const kinds = doc.blocks.map((b) => (b && typeof b === 'object' ? b.type : null)).filter(Boolean);
    const capIdx = kinds.indexOf('caption');
    const noteIdx = kinds.indexOf('note');
    const tableIdx = kinds.indexOf('table');
    assert.ok(capIdx >= 0 && noteIdx >= 0 && tableIdx >= 0, JSON.stringify(kinds));
    assert.ok(capIdx < noteIdx, `caption (${capIdx}) must come before the tabletn note (${noteIdx}): ${JSON.stringify(kinds)}`);
    assert.ok(noteIdx < tableIdx, `tabletn note (${noteIdx}) must come before the table body (${tableIdx}): ${JSON.stringify(kinds)}`);
  });

  test('the same order survives into the rendered braille (formatDocument)', () => {
    const xml = dtbook(`<table>
      <caption>Population by Region</caption>
      <tabletn>Percentages are rounded to the nearest whole number.</tabletn>
      <thead><tr><th>Region</th><th>Pop</th></tr></thead>
      <tbody><tr><td>North</td><td>10</td></tr></tbody>
    </table>`);
    const doc = parseDtbook(xml);
    for (const mode of ['bana', 'ukaaf']) {
      const o = fakeOpts(mode, 40);
      const out = clean(formatDocument(doc, o).split('\n'));
      const capIdx = out.findIndex((l) => l.includes('POPULATION BY REGION'));
      const noteIdx = out.findIndex((l) => l.includes('PERCENTAGES ARE ROUNDED'));
      const bodyIdx = out.findIndex((l) => l.includes('NORTH') && l.includes('10'));
      assert.ok(capIdx >= 0 && noteIdx >= 0 && bodyIdx >= 0, `${mode}: ${JSON.stringify(out)}`);
      assert.ok(capIdx < noteIdx, `${mode}: caption must precede the tabletn note: ${JSON.stringify(out)}`);
      assert.ok(noteIdx < bodyIdx, `${mode}: tabletn note must precede the table body: ${JSON.stringify(out)}`);
    }
  });
});

// ===========================================================================================
// F-6 — BANA 11.6.1f: "Two or more guide dots lead the reader from one column to the next,
// and are inserted to fill out the width of a column with shorter entries." B004 §12: "guide
// dots are used to bridge the gap between columns, leaving a space at each end." Neither rule
// exempts a numeric column. Worked example: B004 §12 Example 1 (references/_text/B004.txt,
// "Good practice examples of simple tables"), whose own quoted braille bridges the Square/Cube
// columns' short entries with guide dots ("#a """" #a" for row 1), not plain space padding.
// ===========================================================================================
describe('F-6 — guide dots appear between numeric columns, exactly as for text columns', () => {
  // B004 §12 Example 1's own table (No./Square/Cube, 1-10) — references/_text/B004.txt.
  const nums = Array.from({ length: 10 }, (_, i) => i + 1);
  const block = {
    type: 'table', format: 'columnar',
    headers: ['No.', 'Square', 'Cube'],
    rows: nums.map((n) => [String(n), String(n * n), String(n * n * n)]),
  };

  test('a short numeric entry is bridged to its column edge by guide dots, not spaces (structural)', () => {
    const o = fakeOpts('ukaaf', 40);
    const lines = clean(formatBlock(block, o));
    // Row "1  1  1": both Square (width set by "100"/"729", i.e. 3) and Cube (width set by
    // "1000", 4) are much wider than their row-1 entries ("1"), and the table has a column
    // after each of them — so both must guide-dot the gap (§11.6.1f / B004 12 guide-dots).
    const row1 = lines.find((l) => l.trimStart().startsWith('1') && l.includes('1'));
    assert.ok(row1, JSON.stringify(lines));
    assert.ok(row1.includes('"'), `row 1 should contain guide dots bridging its short Square/Cube entries: ${JSON.stringify(row1)}`);
    parity(block, o);
  });

  test('against the real liblouis translator and B004 §12 Example 1\'s own worked braille', () => {
    const o = realOpts('ukaaf', 38);
    const lines = clean(formatBlock(block, o));
    // The header row keeps NO. / SQUARE / CUBE (contracted differently by liblouis, but the
    // structural point is: every data row after the header/separator carries guide dots
    // wherever a short Square/Cube entry leaves a multi-cell gap before the next column
    // (rows for n=1..9, where Square/Cube are 1-2 digits against the 3/4-digit maximum set
    // by "100"/"1000" — exactly B004's own example, which shows dots on every row but the
    // last, "10 100 1000", where every entry reaches its own column's natural width).
    const withDots = lines.filter((l) => l.includes('"'));
    assert.ok(withDots.length >= 9, `expected guide dots on at least 9 of the 10 data rows (all but the widest, "10/100/1000"): ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('a numeric column with NO shortfall (every entry already reaches the column edge) gets no guide dots on that line', () => {
    const o = fakeOpts('ukaaf', 40);
    const block2 = { type: 'table', format: 'columnar', headers: ['A', 'B'], rows: [['100', '5']] };
    const lines = clean(formatBlock(block2, o));
    const row = lines.find((l) => l.includes('100'));
    // Column A's own entry ("100") exactly fills its column (the header "A" is narrower) —
    // nothing left to bridge in that column; only column B (a genuinely short "5" against a
    // wider header "B"... note "B" is narrower than "5" too here, so no gap either). Sanity:
    // no guide dots appear when there is no shortfall to bridge.
    assert.ok(row, JSON.stringify(lines));
    assert.ok(!row.includes('"'), `no shortfall, so no guide dots expected: ${JSON.stringify(row)}`);
  });
});

// ===========================================================================================
// F-7 — BANA 11.6.1d: numerals are aligned "by place value... to align digits, DECIMALS, or
// COMMAS." B004 §12: "Column entries... are normally aligned on the left. However, if figures
// are to be worked on or summed... the figures may be aligned on the right (or their decimal
// points aligned)." Worked evidence, both directions:
//  - B004 §12 Example 1's own "No." column (1..10, no comma/decimal in any entry, a plain
//    sequential row label never summed) stays flush LEFT throughout in the book's own braille
//    ("#a" .. "#aj", no leading pad) — Emboss must not right/place-value-align it.
//  - BANA Sample 11-2 (tests/gold/bana-formats-2016/section-11/sample-11-02.json)'s "Total"
//    column ("981,712" / "1,001,676" / "1,054,503" / "1,128,432") DOES carry thousands commas
//    and the sample's own agreed braille right/place-value-aligns it (the 7-character
//    "981,712" gets 2 extra leading cells to line up with the 9-character entries below,
//    braille.lines rows 12-15) — Emboss must keep aligning THAT column.
// Decision (this fix): numericColumnPlan applies automatically only when at least one entry
// in the column actually carries a decimal point or thousands comma (BANA 11.6.1d's own
// wording: alignment is "to align digits, decimals, OR COMMAS" — punctuation to line up, not
// bare digits). `block.columnAlign[c]` ('left' | 'right') is the transcriber's explicit
// override in either direction, satisfying this finding's own "needs a way to mark a column
// as 'don't align'".
// ===========================================================================================
describe('F-7 — numeric column alignment defaults to left; place-value alignment needs a reason (or an override)', () => {
  test('B004 §12 Example 1\'s own "No." column (no comma/decimal) stays flush left, no right-padding', () => {
    const nums = Array.from({ length: 10 }, (_, i) => i + 1);
    const block = {
      type: 'table', format: 'columnar',
      headers: ['No.', 'Square', 'Cube'],
      rows: nums.map((n) => [String(n), String(n * n), String(n * n * n)]),
    };
    for (const o of [fakeOpts('ukaaf', 40), realOpts('ukaaf', 38)]) {
      const lines = clean(formatBlock(block, o));
      // Every data row's line must start with its own "No." entry's own first character —
      // i.e. NO leading space before the No. column (place-value right-padding would insert
      // one for every row except the widest, "10").
      const dataLines = lines.filter((l) => /^\S/.test(l) && !/NO\.|SQUARE|CUBE|,no|,squ|,cube/i.test(l.slice(0, 6)));
      assert.ok(dataLines.length >= 9, JSON.stringify(lines));
      for (const l of dataLines) assert.ok(!/^\s/.test(l), `"No." column must be flush left, no leading pad: ${JSON.stringify(l)}`);
      parity(block, o);
    }
  });

  test('BANA Sample 11-2\'s "Total" column (thousands commas) DOES place-value align, unchanged', () => {
    // tests/gold/bana-formats-2016/section-11/sample-11-02.json's own print.rows, Total column.
    const block = {
      type: 'table', format: 'columnar',
      headers: ['Fiscal Year', 'Total'],
      rows: [
        ['1998', '981,712'],
        ['1999', '1,001,676'],
        ['2000', '1,054,503'],
        ['2001', '1,128,432'],
      ],
    };
    const o = realOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    // Structural check: the 1998 row's Total entry (7 raw chars, "981,712") must be preceded
    // by MORE leading space than the 1999 row's (9 raw chars, "1,001,676") — i.e. right/
    // place-value aligned, not left-flush — exactly the gold sample's own braille shape.
    // Re-derived via the real translator so this doesn't depend on guessing liblouis' own
    // contraction of the digits.
    const b1998 = translate('981,712');
    const b1999 = translate('1,001,676');
    const line1998 = lines.find((l) => l.trimEnd().endsWith(b1998));
    const line1999 = lines.find((l) => l.trimEnd().endsWith(b1999));
    assert.ok(line1998 && line1999, JSON.stringify(lines));
    const start1998 = line1998.lastIndexOf(b1998);
    const start1999 = line1999.lastIndexOf(b1999);
    assert.ok(start1998 > start1999, `the shorter 1998 entry ("981,712") must start further right than the longer 1999 one ("1,001,676") — place-value alignment: line1998=${JSON.stringify(line1998)} line1999=${JSON.stringify(line1999)}`);
    parity(block, o);
  });

  test('columnAlign override: "right" forces alignment on a punctuation-free column; "left" forces left over a punctuated one', () => {
    const o = fakeOpts('bana', 40);
    const forcedRight = {
      type: 'table', format: 'columnar', columnAlign: ['right'],
      headers: ['No.'], rows: [['1'], ['10']],
    };
    const linesRight = clean(formatBlock(forcedRight, o));
    const row1 = linesRight.find((l) => l.trim() === '1');
    assert.ok(row1 && /^\s+1$/.test(row1), `columnAlign:'right' should right-pad even a punctuation-free column: ${JSON.stringify(linesRight)}`);
    parity(forcedRight, o);

    const forcedLeft = {
      type: 'table', format: 'columnar', columnAlign: ['left'],
      headers: ['Total'], rows: [['1,712'], ['12,000']],
    };
    const linesLeft = clean(formatBlock(forcedLeft, o));
    const shortRow = linesLeft.find((l) => l.includes('1,712'.toUpperCase()));
    assert.ok(shortRow && /^1,712/.test(shortRow.trim()) && !/^\s/.test(shortRow), `columnAlign:'left' should keep a punctuated column flush left: ${JSON.stringify(linesLeft)}`);
    parity(forcedLeft, o);
  });
});

// ===========================================================================================
// F-8 — BANA 11.4.2c: "Columns without a heading do not have a separation line." Per column,
// not all-or-nothing.
// ===========================================================================================
describe('F-8 — a column with no heading gets no separation line, even when other columns do', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Name', '', 'Score'],
    rows: [['Ann', 'x', '10'], ['Bob', 'y', '20']],
  };

  test('the separation line has a dot run only under the columns that have a heading (structural)', () => {
    for (const mode of ['bana', 'ukaaf']) {
      const o = fakeOpts(mode, 40);
      const lines = clean(formatBlock(block, o));
      // The separation line is the one line consisting only of guide-dot / blank cells,
      // right after the header row and before the first data row.
      const headerIdx = lines.findIndex((l) => l.includes('NAME') && l.includes('SCORE'));
      assert.ok(headerIdx >= 0, JSON.stringify(lines));
      const sep = lines[headerIdx + 1];
      assert.ok(sep, JSON.stringify(lines));
      // TABLE_GUIDE ('"') starts exactly one dot run per HEADED column — two here (Name,
      // Score), never three (previously: any heading anywhere drew a dot run under every
      // column, including the blank-headed middle one).
      const dotRuns = (sep.match(/"/g) || []).length;
      assert.equal(dotRuns, 2, `${mode}: expected exactly 2 dot runs (Name, Score), not one under the unheaded middle column too: ${JSON.stringify(sep)}`);
      parity(block, o);
    }
  });

  test('a table with every column headed keeps one dot run per column (regression)', () => {
    const full = { type: 'table', format: 'columnar', headers: ['A', 'B'], rows: [['1', '2']] };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(full, o));
    const headerIdx = lines.findIndex((l) => l.includes('A') && l.includes('B'));
    const sep = lines[headerIdx + 1];
    assert.equal((sep.match(/"/g) || []).length, 2, JSON.stringify(sep));
    parity(full, o);
  });

  test('a table with NO column headed at all draws no separation line (regression, pre-existing gate)', () => {
    const none = { type: 'table', format: 'columnar', headers: ['', ''], rows: [['1', '2']] };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(none, o));
    assert.ok(!lines.some((l) => l.includes('"')), JSON.stringify(lines));
    parity(none, o);
  });
});

// ===========================================================================================
// F-19 — B004 12b: "Paragraph form, where the information in each row of the table is
// converted to a paragraph in braille, with items separated by punctuation rather than being
// aligned." Worked example: B004 §12 Example 2 (references/_text/B004.txt) — every row's
// braille content matches character for character except the indent: the book's own quoted
// braille indents the TN and every row's first line 3 cells (a "4-1" margin), not 2.
// ===========================================================================================
describe('F-19 — UKAAF paragraph-form rows are indented to match B004\'s own worked example (4-1, not 3-1)', () => {
  const block = {
    type: 'table', format: 'paragraph',
    headers: ['Date', 'Description', 'Money out', 'Money in', 'Balance'],
    rows: [
      ['03/09/14', 'Direct Debit to Orange', '22.35', '', '822.26'],
      ['08/09/14', 'Payment by cheque 10031', '321.84', '', '500.42'],
      ['09/09/14', 'Received from Tomms RG', '', '250.00', '750.42'],
      ['12/09/14', 'Paypal payment', '75.22', '', '675.20'],
    ],
  };

  test('the opening TN and every row start 3 cells in (structural)', () => {
    const o = fakeOpts('ukaaf', 60);
    const lines = clean(formatBlock(block, o));
    const tnLine = lines.find((l) => l.includes('@.<'));
    assert.ok(tnLine, JSON.stringify(lines));
    assert.ok(/^ {3}@\.</.test(tnLine), `TN's first line must be indented 3 cells (4-1 margin): ${JSON.stringify(tnLine)}`);
    const rowLine = lines.find((l) => l.includes('03/09/14'));
    assert.ok(rowLine, JSON.stringify(lines));
    assert.ok(/^ {3}\S/.test(rowLine), `each row's first line must be indented 3 cells: ${JSON.stringify(rowLine)}`);
    parity(block, o);
  });

  test('against the real liblouis translator and B004 §12 Example 2\'s own worked braille', () => {
    const o = realOpts('ukaaf', 38);
    const lines = clean(formatBlock(block, o));
    // B004's own quoted braille (references/_text/B004.txt): "   #jc_/#ji_/#ad2 ,Direct
    // ,Debit" — 3 leading spaces before the first cell of content.
    const orangeLine = lines.find((l) => l.includes(translate('03/09/14').replace(/\s/g, '')) || l.trimStart().startsWith(translate('03/09/14')));
    assert.ok(orangeLine, JSON.stringify(lines));
    assert.equal(orangeLine.length - orangeLine.trimStart().length, 3, `expected exactly 3 leading blank cells, matching B004's own worked example: ${JSON.stringify(orangeLine)}`);
    const tnLine = lines.find((l) => l.includes('@.<'));
    assert.ok(tnLine, JSON.stringify(lines));
    assert.equal(tnLine.length - tnLine.trimStart().length, 3, `TN line should also be indented 3 cells: ${JSON.stringify(tnLine)}`);
    parity(block, o);
  });
});
