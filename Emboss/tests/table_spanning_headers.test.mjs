// F-12 — BANA Braille Formats 2016 §11.4.3: "Complex Tables with Column and Sub-column
// Headings. The primary column heading is left-justified over the secondary sub-column
// heading." (11.4.3) with its three lettered sub-rules:
//   a. "Insert a separation line after the primary heading. The line starts at the left
//      margin of the primary and secondary sub-column headings and ends at the right
//      margin of the last sub-column. The separation line is the width of the primary
//      heading when it is wider than all of the sub-column headings."
//   b. "Sub-column headings begin on the next line, left-justified above their respective
//      columns. Limit the sub-column headings to two lines."
//   c. "Each sub-column heading is followed by a separation line, running the width of the
//      column."
//
// Data model (standards-findings.md F-12 status update): `block.headers` stays the flat
// SUB-column (bottom) heading row; `block.headerGroups = [{ text, from, to }]` (0-based
// inclusive column span) carries the primary heading row. A column with a single-tier
// heading (no group over it, e.g. BANA Sample 11-2's "Fiscal Year" beside "Total/Direct/
// Grants") has no headerGroups entry. Row subheadings (11.5.1b) and the listed format's
// multi-entry column heading (11.16.1g) are OUT of scope — see the F-12 status update.
//
// The exact vertical placement of a single-tier heading beside a two-tier group (which
// rows its own line(s) land on) is derived from 11.4.3 read together with ALL FOUR of this
// section's worked two-tier-header gold samples (11-2, 11-9, 11-13, 11-15 —
// Emboss/tests/gold/bana-formats-2016/section-11/): the primary row and its separation
// line (11.4.3a) span ONLY the grouped columns (11.4.2c: a column "without a heading"
// — at that tier — has no separation line); the sub-column row and ITS separation line
// (11.4.3b/c) span every column, grouped or not, and a single-tier column's own heading is
// bottom-aligned against that row — confirmed directly by Sample 11-2's "Fiscal Year",
// which must wrap to two lines ("Fiscal" / "Year") because it doesn't fit its own 7-cell
// column: "Year" (the runover) sits on the sub-column row next to "Total", but "Fiscal"
// (the first line) is pushed into an EXTRA row between the primary separation line and the
// sub-column row — never sharing the primary row itself (which is blank under "Fiscal
// Year" in the gold braille). This is gold-verified below (test 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const up = (s) => String(s).toUpperCase();
const fakeOpts = (width = 40) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const findTable = (blocks) => {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'table') return b;
    if (Array.isArray(b.blocks)) { const r = findTable(b.blocks); if (r) return r; }
  }
  return null;
};
const dtbook = (tableXml) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    ${tableXml}
  </level1></bodymatter></book>
</dtbook>`;

// --- 1. parse.mjs: a two-row <thead> becomes headers + headerGroups -------------------

test('F-12 parse: <th colspan> (group) + <th rowspan> (single-tier) two-row <thead>', () => {
  const xml = dtbook(`<table>
    <thead>
      <tr><th rowspan="2">Fiscal Year</th><th colspan="3">In Millions of Dollars</th></tr>
      <tr><th>Total</th><th>Direct</th><th>Grants</th></tr>
    </thead>
    <tbody><tr><td>1998</td><td>981,712</td><td>817,770</td><td>163,942</td></tr></tbody>
  </table>`);
  const t = findTable(parseDtbook(xml).blocks);
  assert.ok(t, 'table block found');
  assert.deepEqual(t.headers, ['Fiscal Year', 'Total', 'Direct', 'Grants']);
  assert.deepEqual(t.headerGroups, [{ text: 'In Millions of Dollars', from: 1, to: 3 }]);
  assert.deepEqual(t.rows, [['1998', '981,712', '817,770', '163,942']]);
});

// Two groups side by side, no single-tier column at all (BANA Sample 11-13's shape:
// "prép." single-tier + "article défini" group — here simplified to two groups only,
// to prove multi-group column-index bookkeeping independently of the rowspan case).
test('F-12 parse: two <th colspan> groups side by side', () => {
  const xml = dtbook(`<table>
    <thead>
      <tr><th colspan="2">Odds</th><th colspan="2">Evens</th></tr>
      <tr><th>1</th><th>3</th><th>2</th><th>4</th></tr>
    </thead>
    <tbody><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></tbody>
  </table>`);
  const t = findTable(parseDtbook(xml).blocks);
  assert.deepEqual(t.headers, ['1', '3', '2', '4']);
  assert.deepEqual(t.headerGroups, [{ text: 'Odds', from: 0, to: 1 }, { text: 'Evens', from: 2, to: 3 }]);
});

// A single plain <thead> row (the overwhelmingly common case) must be completely
// unaffected — no headerGroups field at all.
test('F-12 parse regression: a single-row <thead> gets no headerGroups', () => {
  const xml = dtbook('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  const t = findTable(parseDtbook(xml).blocks);
  assert.deepEqual(t.headers, ['A', 'B']);
  assert.equal(t.headerGroups, undefined, JSON.stringify(t));
});

// Two thead rows with NO colspan/rowspan signal at all encode no hierarchy (BANA 11.4.3 is
// specifically a spanning relationship) — pre-existing behaviour (second row leads the
// body) unchanged; see corpus_word_losses.test.mjs's own "every <thead> row is kept" case.
test('F-12 parse regression: two plain <thead> rows with no span signal are NOT read as headerGroups', () => {
  const xml = dtbook('<table><thead><tr><th>A</th><th>B</th></tr><tr><th>Sub a</th><th>Sub b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  const t = findTable(parseDtbook(xml).blocks);
  assert.equal(t.headerGroups, undefined, JSON.stringify(t));
  assert.deepEqual(t.headers, ['A', 'B']);
  assert.deepEqual(t.rows, [['Sub a', 'Sub b'], ['1', '2']]);
});

// --- 2. Export round trip (nimas-export.mjs -> parse.mjs) ------------------------------

test('F-12 round trip: headerGroups survives export + re-parse unchanged', () => {
  const block = {
    type: 'table',
    headers: ['Fiscal Year', 'Total', 'Direct', 'Grants'],
    headerGroups: [{ text: 'In Millions of Dollars', from: 1, to: 3 }],
    rows: [['1998', '981,712', '817,770', '163,942']],
  };
  const doc = { title: null, blocks: [block] };
  const xml = exportToNimasXml(doc);
  assert.ok(xml.includes('<th rowspan="2">Fiscal Year</th>'), xml);
  assert.ok(xml.includes('<th colspan="3">In Millions of Dollars</th>'), xml);

  const reparsed = findTable(parseDtbook(xml).blocks);
  assert.deepEqual(reparsed.headers, block.headers);
  assert.deepEqual(reparsed.headerGroups, block.headerGroups);
  assert.deepEqual(reparsed.rows, block.rows);
});

test('F-12 round trip: two side-by-side groups, no single-tier column', () => {
  const block = {
    type: 'table',
    headers: ['1', '3', '2', '4'],
    headerGroups: [{ text: 'Odds', from: 0, to: 1 }, { text: 'Evens', from: 2, to: 3 }],
    rows: [['a', 'b', 'c', 'd']],
  };
  const doc = { title: null, blocks: [block] };
  const xml = exportToNimasXml(doc);
  const reparsed = findTable(parseDtbook(xml).blocks);
  assert.deepEqual(reparsed.headerGroups, block.headerGroups);
  assert.deepEqual(reparsed.headers, block.headers);
});

// --- 3. formatTable output for a sample-11-02-shaped table, against the real gold braille ---

test('F-12 format: BANA Sample 11-2 (Complex Table) header block matches the gold braille exactly', async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const TABLES = louis.TABLES.uebG2;
  const translate = (t, tf) => louis.translate(t, TABLES, tf || null);

  // print.headers (sample-11-02.json): row 1 "Fiscal Year" / "In Millions of Dollars"x3;
  // row 2 "" / "Total" / "Direct" / "Grants" -> block.headers/headerGroups per the F-12
  // data model (parse.mjs's own reading of the equivalent DTBook markup, tested above).
  const block = {
    type: 'table',
    headers: ['Fiscal Year', 'Total', 'Direct', 'Grants'],
    headerGroups: [{ text: 'In Millions of Dollars', from: 1, to: 3 }],
    rows: [
      ['1998', '981,712', '817,770', '163,942'],
      ['1999', '1,001,676', '825,833', '175,843'],
      ['2000', '1,054,503', '867,713', '186,790'],
      ['2001', '1,128,432', '920,394', '208,038'],
    ],
  };
  const boxed = { type: 'box', blocks: [block] };
  const lines = clean(formatBlock(boxed, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate }));

  // Expected lines, taken verbatim from tests/gold/bana-formats-2016/section-11/
  // sample-11-02.json's own `braille.lines[5..14]` (the box through the last data row —
  // excluding the placeholder "text" line and the preceding centred title, which this
  // test's plain (untitled) block does not render), upper-cased to match this project's
  // BRF ASCII convention (gold-run.mjs's own documented case-normalisation — see its
  // "gold §11 letter-case convention" comment; the standard's own dot pattern is
  // unaffected by letter case either way).
  const expected = [
    '7777777777777777777777777777777777777777',
    '         ,9 ,millions ( ,doll>s',
    '         "33333333333333333333333333333',
    ',fiscal',
    ',ye>     ,total      ,direct   ,grants',
    '"333333 "333333333 "3333333 "3333333',
    '#aiih      #iha1gab #hag1ggj #afc1idb',
    '#aiii    #a1jja1fgf #hbe1hcc #age1hdc',
    '#bjjj    #a1jed1ejc #hfg1gac #ahf1gij',
    '#bjja    #a1abh1dcb #ibj1cid #bjh1jch',
  ].map((l) => l.toUpperCase());

  const topIdx = lines.findIndex((l) => /^7+$/.test(l));
  assert.ok(topIdx >= 0, `top box line expected: ${JSON.stringify(lines)}`);
  const actualSlice = lines.slice(topIdx, topIdx + expected.length);
  assert.deepEqual(actualSlice, expected, JSON.stringify({ actualSlice, expected }, null, 2));
});

// --- 4. Trace parity (formatBlock vs traceBlock), as table_heading_placement.test.mjs does ---

test('F-12 trace parity: a group + a single-tier column that needs no runover (Sample 11-9 shape)', () => {
  const block = {
    type: 'table',
    headers: ['Year', '1st half', '2nd half', 'Annual avg'],
    headerGroups: [{ text: 'Semiannual averages', from: 1, to: 2 }],
    rows: [['1980', '–', '–', '82.9'], ['1984', '102.1', '104.4', '103.3']],
  };
  const formatted = clean(formatBlock(block, fakeOpts(40)));
  const traced = clean(traceBlock(block, fakeOpts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-12 trace parity: a group + a single-tier column that needs a runover (Sample 11-2 shape)', () => {
  const block = {
    type: 'table',
    headers: ['Fiscal Year', 'Total', 'Direct', 'Grants'],
    headerGroups: [{ text: 'In Millions of Dollars', from: 1, to: 3 }],
    rows: [['1998', '981712', '817770', '163942']],
  };
  const formatted = clean(formatBlock(block, fakeOpts(40)));
  const traced = clean(traceBlock(block, fakeOpts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-12 trace parity: two side-by-side groups, no single-tier column', () => {
  const block = {
    type: 'table',
    headers: ['1', '3', '2', '4'],
    headerGroups: [{ text: 'Odds', from: 0, to: 1 }, { text: 'Evens', from: 2, to: 3 }],
    rows: [['aa', 'bb', 'cc', 'dd']],
  };
  const formatted = clean(formatBlock(block, fakeOpts(40)));
  const traced = clean(traceBlock(block, fakeOpts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// --- 5. A group plus a rowspanned single heading: the extra-row placement itself -------

// This is the structural claim test 3 proves against the real gold braille (Sample 11-2);
// this test isolates the SAME shape with the fake translator so the row positions are
// easy to read directly off the assertions, independent of real braille contractions.
test('F-12: a single-tier heading needing 2 lines is pushed into an extra row, never the primary row', () => {
  const block = {
    type: 'table',
    // "FISCAL YEAR" (11 cells incl. the space) must wrap in a narrow column so it needs
    // two lines, mirroring Sample 11-2's "Fiscal Year"/"Fiscal"+"Year" — a column width
    // forced narrow by using short data/sub-headings elsewhere in that column. The
    // group's own heading ("AMOUNTS") is kept short so it always fits its span on one
    // line — isolating the single-tier column's OWN wrap from the (separately tested,
    // see the trace-parity tests above) case of the primary heading itself wrapping.
    headers: ['FISCAL YEAR', 'TOTAL', 'DIRECT', 'GRANTS'],
    headerGroups: [{ text: 'AMOUNTS', from: 1, to: 3 }],
    rows: [['1998', '100', '200', '300']],
  };
  // Force column 0 down to the width of "FISCAL" (its widest word, 6 cells — never
  // split, A27b/§1.10.1) so "FISCAL YEAR" cannot fit on one line — a table-spatial
  // format at a narrow overall width squeezes column 0 that far (fitColumnWidths)
  // while still fitting every other column's own longest word.
  block.format = 'spatial';
  const lines = clean(formatBlock(block, fakeOpts(30)));
  assert.equal(lines.some((l) => l.includes('@.<')), false, `must reach columnar, not the listed fallback: ${JSON.stringify(lines)}`);

  const primaryIdx = lines.findIndex((l) => l.trim().startsWith('AMOUNTS'));
  assert.ok(primaryIdx >= 0, JSON.stringify(lines));
  const col0Width = lines[primaryIdx].length - lines[primaryIdx].trimStart().length;
  assert.ok(col0Width >= 6, `column 0 must be wide enough for "FISCAL" (6 cells): ${JSON.stringify(lines[primaryIdx])}`);

  const sepAIdx = primaryIdx + 1;
  assert.ok(/^\s+"3+$/.test(lines[sepAIdx]), `sepA: ${JSON.stringify(lines[sepAIdx])}`);
  // Column 0 (Fiscal Year) is blank on both the primary row and its separation line.
  assert.equal(lines[primaryIdx].slice(0, col0Width).trim(), '', `col0 blank on primary row: ${JSON.stringify(lines[primaryIdx])}`);
  assert.equal(lines[sepAIdx].slice(0, col0Width).trim(), '', `col0 blank on sepA row: ${JSON.stringify(lines[sepAIdx])}`);

  const fiscalIdx = lines.findIndex((l) => l.trim() === 'FISCAL');
  assert.equal(fiscalIdx, sepAIdx + 1, `"FISCAL" is the extra row, right after sepA: ${JSON.stringify(lines)}`);
  // The grouped columns (Total/Direct/Grants) are blank on the extra row.
  assert.equal(lines[fiscalIdx].slice(col0Width).trim(), '', `grouped columns blank on the extra row: ${JSON.stringify(lines[fiscalIdx])}`);

  const yearIdx = fiscalIdx + 1;
  assert.ok(lines[yearIdx].trim().startsWith('YEAR'), `"YEAR" (runover) shares the sub-tier row with TOTAL/DIRECT/GRANTS: ${JSON.stringify(lines[yearIdx])}`);
  assert.ok(lines[yearIdx].includes('TOTAL'), JSON.stringify(lines[yearIdx]));

  const sepBIdx = yearIdx + 1;
  assert.ok(/^"3+/.test(lines[sepBIdx]), `sepB spans every column including col 0: ${JSON.stringify(lines[sepBIdx])}`);

  // Trace parity for this exact shape too.
  const traced = clean(traceBlock(block, fakeOpts(30), false, 0).map((t) => t.s));
  assert.deepEqual(traced, lines, JSON.stringify({ lines, traced }));
});

// --- 6. Regression: a table with no headerGroups renders exactly as before this fix -----

test('F-12 regression: a plain single-tier table (no headerGroups) is completely unaffected', () => {
  const block = { type: 'table', headers: ['Species', 'Habitat Unit'], rows: [['Grizzly Bear', 'Viable']], format: 'spatial' };
  const lines = clean(formatBlock(block, fakeOpts(40)));
  // Unchanged top-aligned behaviour for the plain (single-tier-only) header wrap —
  // BANA 11.4.1's own runover rule, outside this finding's scope (F-12 is specifically
  // about the second, PRIMARY heading tier; see the F-12 status update for this
  // top-vs-bottom-alignment discrepancy noted as an open observation, not fixed here).
  assert.ok(lines[1].startsWith('SPECIES'), JSON.stringify(lines));
  const traced = clean(traceBlock(block, fakeOpts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, lines);
});
