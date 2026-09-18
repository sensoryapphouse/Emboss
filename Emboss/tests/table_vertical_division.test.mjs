// T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026 — standards-findings.md F-18's own
// status update): BANA Braille Formats 2016 §11.14 Wide Tables: Vertical Division.
//
//   11.14.1 "A wide table may be divided into vertical sections. When a divided table
//   takes more than a single page, the preferred format is to place the table on facing
//   pages."
//     a. "Divided tables should be on one braille page if possible."
//     b. "Repeat the row headings for each section of the table."
//     c. "Use a transcriber's note to inform the reader of the vertically divided table.
//        Sample: Table is divided vertically into 2 sections."
//   (See Sample 11-22: Table Divided Vertically on page 11-48.)
//
// Paul's decision (EMBOSS-TASKS.md T4): build vertical division as a SELECTABLE table
// format ('vertical') AND as the automatic fallback in 'auto' mode when the squeezed
// columns do not fit — tried BEFORE Listed, which stays the last resort.
//
// Column 0 is always the row-heading column (§11.5.1: "The first column consists of the
// row headings"). Vertical division packs the table's DATA columns into consecutive
// sections at their own NATURAL (unsqueezed) width — never squeezed — with column 0
// repeated in every section (11.14.1b): this is exactly what BANA's own Sample 11-22
// shows (none of its six data columns is narrowed; they are simply grouped 4+2 across two
// sections once the table no longer fits on one line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatBlock, traceBlock, tableLayout } from '../format/document.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { loadSamples, runOne } from '../scripts/gold-run.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (width = 40) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));

// --- Gold proof: BANA Sample 11-22 "Table Divided Vertically" --------------------------
//
// tests/gold/bana-formats-2016/section-11/sample-11-22.json is a worked example whose
// braille.lines are transcribed directly from the standard (BANA Formats 2016, source
// lines 9776-9804): a 7-column table (row headings + 1900/1910/1920/1930/1940/1950) that
// divides into two sections (4 + 2 columns) at braille page width 40, with the row-heading
// column ("Denmark"/"Sweden"/"Norway"/"Finland") repeated in each section and the rule's
// own sample TN wording ("Table is divided vertically into 2 sections."). Before this fix,
// Emboss had no vertical-division format at all and fell back to Listed, producing a
// completely different (and much longer) table — see standards-findings.md's F-18 status
// update for the before/after gold-run.mjs evidence. This test proves the fix directly
// against the standard's own quoted braille, character for character — not against
// Emboss's own prior output.
test('BANA Sample 11-22: gold-run.mjs reports an exact character-for-character match', () => {
  const { sample } = loadSamples().find(({ sample: s }) => s.id === 'sample-11-22');
  const result = runOne(sample);
  assert.equal(result.status, 'match',
    `sample-11-22 must match the standard's own braille exactly: ${result.diagnosis}`);
});

// The same table, built directly (not via gold-run's box/title wrapping) to pin down the
// vertical-division table body on its own: tableLayout must report 'vertical', and the
// rendered lines must be exactly BANA's own Sample 11-22 body (its box/title lines are
// tested separately, above, via the full gold sample).
const sample1122Block = {
  type: 'table', format: 'auto',
  headers: ['', '1900', '1910', '1920', '1930', '1940', '1950'],
  rows: [
    ['Denmark', '13.9', '16.2', '37.0', '33.8', '44.3', '54.4'],
    ['Sweden', '8.7', '12.2', '32.4', '41.7', '64.3', '75.2'],
    ['Norway', '10.3', '14.6', '35.9', '43.2', '67.9', '77.3'],
    ['Finland', '6.9', '10.3', '25.6', '34.7', '44.2', '52.1'],
  ],
};

test('BANA §11.14: auto mode chooses vertical division for a table whose sections fit (Sample 11-22 shape)', () => {
  assert.equal(tableLayout(sample1122Block, opts(40)), 'vertical');
});

test('BANA §11.14.1b: the row-heading column is repeated in every section, sections separated by a blank line', () => {
  const lines = clean(formatBlock(sample1122Block, opts(40)));
  // Two occurrences of each row heading (once per section) — 11.14.1b.
  for (const name of ['DENMARK', 'SWEDEN', 'NORWAY', 'FINLAND']) {
    const count = lines.filter((l) => l.startsWith(name)).length;
    assert.equal(count, 2, `"${name}" must appear once per section (2 sections): ${JSON.stringify(lines)}`);
  }
  // 4 blank lines: leading (formatTable's own convention), after the TN (before the
  // first section), between the two sections' data (11.14.1a: one braille page, sections
  // simply stacked with a blank line — matching the gold sample's own line 15), trailing.
  const blankIdxs = lines.reduce((acc, l, i) => (l === '' ? [...acc, i] : acc), []);
  assert.equal(blankIdxs.length, 4, `leading, after TN, between sections, trailing: ${JSON.stringify(lines)}`);
});

test('BANA §11.14.1c: the transcriber\'s note announces the vertical division, sample wording', () => {
  const lines = clean(formatBlock(sample1122Block, opts(40)));
  const tn = lines.slice(0, 4).join(' ');
  assert.match(tn, /TABLE IS DIVIDED VERTICALLY\s+INTO 2 SECTIONS\./, JSON.stringify(lines));
});

test('BANA §11.4.2c mirrored for vertical division: the row-heading column has no separation-line dot run under its own blank header', () => {
  const lines = clean(formatBlock(sample1122Block, opts(40)));
  const sepLine = lines.find((l) => l.includes('"333'));
  assert.ok(sepLine, JSON.stringify(lines));
  // The row-heading column's own width (its header cell is '') must be plain spaces,
  // not guide dots, before the first dot run begins.
  const firstDot = sepLine.indexOf('"');
  assert.ok(sepLine.slice(0, firstDot).trim() === '', `no dots under the blank row-heading header: ${JSON.stringify(sepLine)}`);
});

test('formatBlock and traceBlock agree on the vertical-division table (Sample 11-22 shape)', () => {
  const formatted = clean(formatBlock(sample1122Block, opts(40)));
  const traced = clean(traceBlock(sample1122Block, opts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// --- Auto fallback: vertical when sections fit, Listed when they don't -----------------

// Five columns, none of which need to wrap — squeezed columnar never fits at these
// widths, but two vertical sections (3 data columns + 2) do.
const fiveColBlock = {
  type: 'table', format: 'auto',
  headers: ['Student Name', 'Quiz One', 'Quiz Two', 'Quiz Three', 'Quiz Four'],
  rows: [
    ['Alexander', '88', '92', '79', '95'],
    ['Bernadette', '76', '81', '90', '85'],
  ],
};

test('T4: auto prefers vertical division over Listed once the squeeze fails but sections fit', () => {
  for (const w of [30, 32, 34, 36]) {
    assert.equal(tableLayout(fiveColBlock, opts(w)), 'vertical',
      `width ${w}: got ${tableLayout(fiveColBlock, opts(w))}`);
  }
  // Wide enough that the whole table fits unsqueezed: plain columnar, no division needed.
  assert.equal(tableLayout(fiveColBlock, opts(38)), 'columnar');
});

// BANA 11.6.1f: "Two or more guide dots lead the reader from one column to the next, and
// are inserted to fill out the width of a column with shorter entries" — the gap after
// "88"/"76" (Quiz One, header-driven width 8) and after "79"/"90" (Quiz Three, header-
// driven width 10) is guide-dotted, exactly like the row-heading column's own gap, not
// left as plain space (F-6; standards-findings.md — this test previously encoded the
// pre-fix behaviour, plain space padding, for a numeric column specifically).
test('T4: vertical division renders 2 sections with headers repeated and no data lost', () => {
  const lines = clean(formatBlock(fiveColBlock, opts(36)));
  assert.deepEqual(lines, [
    '',
    '      @.<TABLE IS DIVIDED VERTICALLY',
    '    INTO 2 SECTIONS.@.>',
    '',
    'STUDENT NAME QUIZ ONE QUIZ TWO',
    '"33333333333 "3333333 "3333333',
    'ALEXANDER "" 88 """"" 92',
    'BERNADETTE    76 """"" 81',
    '',
    'STUDENT NAME QUIZ THREE QUIZ FOUR',
    '"33333333333 "333333333 "33333333',
    'ALEXANDER "" 79 """"""" 95',
    'BERNADETTE    90 """"""" 85',
    '',
  ], JSON.stringify(lines));
});

// A single data column is itself too wide to fit beside the row-heading column at all —
// vertical division cannot help (no section boundary would ever fit), so 'auto' falls
// through to Listed, exactly as before this fix for a table with no viable alternate.
const noFitBlock = {
  type: 'table', format: 'auto',
  headers: ['Student Name', 'A rather long descriptive quiz-one column heading indeed', 'Quiz Two'],
  rows: [
    ['Alexander', 'a rather long descriptive single entry that alone exceeds the line width available here', '92'],
  ],
};

test('T4: auto still falls back to Listed when even a single column cannot fit beside the row heading', () => {
  assert.equal(tableLayout(noFitBlock, opts(36)), 'listed');
  const lines = clean(formatBlock(noFitBlock, opts(36)));
  assert.ok(lines.some((l) => l.includes('PRINT FORMAT IS CHANGED')), JSON.stringify(lines));
});

// A 2-column table (row heading + 1 data column) has nothing to divide — vertical
// division needs at least 2 data columns (§11.14.1's own "sections", plural).
test('T4: a 2-column table has nothing to divide — stays columnar when it fits', () => {
  const block = { type: 'table', format: 'auto', headers: ['A', 'B'], rows: [['x', 'y']] };
  assert.equal(tableLayout(block, opts(40)), 'columnar');
});

// --- Explicit 'vertical' format -----------------------------------------------------

test("T4: explicit format:'vertical' produces the same division 'auto' falls back to", () => {
  const forced = { ...fiveColBlock, format: 'vertical' };
  assert.equal(tableLayout(forced, opts(36)), 'vertical');
  const lines = clean(formatBlock(forced, opts(36)));
  assert.ok(lines.some((l) => l.includes('DIVIDED VERTICALLY')), JSON.stringify(lines));
  assert.deepEqual(lines, clean(formatBlock(fiveColBlock, opts(36))));
});

test("T4: explicit format:'vertical' on a table that already fits in one section falls back to Listed (nothing to divide)", () => {
  // §11.14.1 divides a WIDE table into "sections" (plural) — a table whose data columns
  // already fit together in a single section has nothing to divide, so forcing 'vertical'
  // here (rather than silently rendering one lone "section") falls back the same way
  // resolveTableLayout's own tryVertical does for any other undividable table.
  const block = {
    type: 'table', format: 'vertical',
    headers: ['A', 'Quiz One', 'Quiz Two'],
    rows: [['Row', '1', '2']],
  };
  assert.equal(tableLayout(block, opts(40)), 'listed');
});

test("T4: explicit format:'vertical' falls back to Listed when division is impossible", () => {
  assert.equal(tableLayout(noFitBlock, opts(36)), 'listed');
  const forced = { ...noFitBlock, format: 'vertical' };
  assert.equal(tableLayout(forced, opts(36)), 'listed');
});

test("T4: explicit format:'vertical' with a two-tier header (F-12 headerGroups) falls back to Listed — not gold-verified, out of scope", () => {
  const block = {
    type: 'table', format: 'vertical',
    headers: ['', 'Total', 'Direct', 'Grants', 'Other'],
    headerGroups: [{ text: 'Fiscal Year', from: 1, to: 3 }],
    rows: [['2020', '1', '2', '3', '4']],
  };
  assert.equal(tableLayout(block, opts(20)), 'listed');
});

// --- Round trip: DTBook class="bana-vertical" (parse.mjs / nimas-export.mjs) -----------

const findTable = (blocks) => {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'table') return b;
    if (Array.isArray(b.blocks)) { const r = findTable(b.blocks); if (r) return r; }
  }
  return null;
};

test("T4 round trip: block.format === 'vertical' exports as class=\"bana-vertical\" and re-parses back to 'vertical'", () => {
  const block = {
    type: 'table', format: 'vertical',
    headers: ['', '1900', '1910'],
    rows: [['Denmark', '13.9', '16.2']],
  };
  const doc = { title: null, blocks: [block] };
  const xml = exportToNimasXml(doc);
  assert.match(xml, /<table class="bana-vertical">/, xml);

  const reparsed = findTable(parseDtbook(xml).blocks);
  assert.ok(reparsed, 'table not found after re-parse');
  assert.equal(reparsed.format, 'vertical');
  assert.deepEqual(reparsed.headers, block.headers);
  assert.deepEqual(reparsed.rows, block.rows);
});
