// A9 (EMBOSS-TASKS.md) / F-9 (standards-findings.md) — BANA Formats 2016 §11.6.1b and
// §11.5.2a, and the §11.4.1/11.5.1c/11.6.1 two-line cap.
//
//   "Begin all column entries on the line on which the row heading ends." (BANA 11.6.1b)
//   "All column entries begin on the same line on which the row heading ends." (11.5.2a —
//     the same rule, stated from the row-heading side; BANA Sample 11-4's own citation)
//   "Column entries are limited to two lines. Entries that cannot be limited to two lines
//     require another specialized table format." (BANA 11.6.1)
//   "Column headings ... are limited to two lines." (11.4.1)  "Limit a row heading to two
//     lines." (11.5.1c)
//
// THE BUG (A9): formatColumnar/traceColumnar wrapped every column of a row independently,
// then rendered line `li` of every column side by side (zipped by raw line index). When a
// row heading (column 0, §11.5.1) needed two lines, that lined its FIRST line up with the
// entries' first line instead — i.e. entries began where the row heading STARTS, the
// opposite of what 11.6.1b/11.5.2a require. BANA Sample 11-4 (Emboss/tests/gold/
// bana-formats-2016/section-11/sample-11-04.json, illustrating exactly 11.5.2a/11.6.1a/b)
// shows the row heading's own runover ("Sapsucker") sharing a line with the column
// entries' own FIRST line, with nothing above it in those columns — proving the intended
// shape below. (Sample 11-4 as a WHOLE table is not gold-matched here: its own "Habitat
// Unit" column entries — "20 ac/territory", "1 ac/territory" — are a single unspaced print
// token divided at the slash in the book's own braille, a discretionary word-division mode
// (BANA 1.10.1, standards-map.md "partial") this project has not built for any joining
// punctuation — see table_auto_squeeze.test.mjs's "NOT Sample 11-04" comment for the full
// account. The tests below use the same species/columns but substitute plain multi-word
// entries — e.g. "20 acres" for "20 ac/territory" — so the table reaches columnar layout
// and Sample 11-4's OWN 11.5.2a/11.6.1b shape (row heading runover sharing a line with the
// entries' first line) can be checked against the real translator.)
//
// THE FIX: column 0 is rendered on its own, unshifted timeline; every other column's entry
// is held back (`offset` blank lines) until column 0's own last line, then rendered on its
// own timeline from there. A column whose entry has not yet begun (still within the row
// heading's own runover) renders plain blank — never guide-dotted (that would misread as a
// deliberately blank BANA §11.6.4 entry, which it is not).
//
// F-9 STATUS: separately from A9, the two-line cap this finding describes ("no enforced
// two-line cap on headings, row headings, or column entries") was already fixed by T9 (17
// Sep 2026, EMBOSS-TASKS.md, standards-map.md BANA 11.6.1) under a different name —
// `fitsTwoLines` (document.mjs) — which `resolveTableLayout`'s 'auto' mode already checks
// against headers, row headings AND column entries alike (it iterates every column,
// including column 0) before accepting a columnar layout, falling back to Listed/paragraph
// otherwise. The regression-guard tests below prove this directly against the rule text
// for all three (headers/row headings/entries) and were already passing before this file
// was added — T9's fix, not a new one. The one documented exception (by Paul's own T9
// decision) is a transcriber-FORCED 'columnar' table, which bypasses the check entirely —
// also proved below, so a future change cannot silently "fix" that deliberate override.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatBlock, traceBlock, tableLayout } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const up = (s) => String(s).toUpperCase();
const fakeOpts = (width) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t) => louis.translatePos(t, T);
});
const realOpts = (width = 38) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate, translatePos,
});

// ===========================================================================================
// A9 — BANA 11.6.1b/11.5.2a: entries begin on the row heading's LAST line
// ===========================================================================================
describe('A9 — column entries begin on the line the row heading ENDS, not the line it starts', () => {
  // Row heading "Alphabet Betamax" squeezes to two lines ("ALPHABET" / "BETAMAX"); the two
  // data columns ('X', 'Y') are each one line. Structural (fake translate) — the exact
  // shape, unclouded by contraction.
  const block = {
    type: 'table', format: 'columnar',
    headers: ['A', 'B', 'C'],
    rows: [['Alphabet Betamax', 'X', 'Y']],
  };

  test('a two-line row heading pushes the entries down to its last line (structural)', () => {
    const o = fakeOpts(20);
    const lines = clean(formatBlock(block, o));
    assert.deepEqual(lines, [
      '',
      'A             B   C',
      '"33333333333  "3  "3',   // two blank cells between separation runs (11.2.5b, K33)
      'ALPHABET """',
      '  BETAMAX     X   Y',
      '',
    ], JSON.stringify(lines));
    // Neither entry appears on the row heading's FIRST line — that line is column 0 alone.
    assert.ok(!lines[3].includes('X') && !lines[3].includes('Y'), `entries must not appear on the heading's first line: ${JSON.stringify(lines[3])}`);
    parity(block, o);
  });

  // Grounded in BANA Sample 11-4 (Emboss/tests/gold/bana-formats-2016/section-11/
  // sample-11-04.json), whose own row heading "Williamson's Sapsucker" wraps to two lines
  // and whose gold braille.notes says explicitly: "the column entries beginning on the
  // line the row heading ENDS (line 16), per rule 11.5.2.a". The habitat-unit entry is
  // "20 acres" here, not the book's own "20 ac/territory" — see this file's header
  // comment for why (a separate, out-of-scope compound-word division gap).
  test("against the real liblouis translator and BANA Sample 11-4's own row-heading-runover shape", () => {
    const o = realOpts(38);
    const sampleBlock = {
      type: 'table', format: 'columnar',
      headers: ['Species', 'Habitat Unit', 'Potential Population'],
      rows: [["Williamson's Sapsucker", '20 acres', '23,350 pairs']],
    };
    assert.equal(tableLayout(sampleBlock, o), 'columnar');
    const lines = clean(formatBlock(sampleBlock, o));
    assert.deepEqual(lines, [
      '',
      ',SPECIES       ,HABITAT  ,POT5TIAL',   // two blank cells between columns (11.2.5b, K33)
      '               ,UNIT     ,POPULA;N',
      '"333333333333  "3333333  "3333333333',
      ",WILLIAMSON'S",
      '  ,SAPSUCK]    #BJ """"  #BC1CEJ',
      '                 ACRES     PAIRS',
      '',
    ], JSON.stringify(lines));
    parity(sampleBlock, o);
  });

  // §11.6.4's own "blank space" guide-dot convention must still line up on the row
  // heading's LAST line, never earlier — a column that has not yet "begun" (still
  // waiting out the row heading's runover) is plain blank, not a premature blank-entry
  // guide-dot fill.
  test('a blank entry beside a two-line row heading is guide-dotted only from the heading\'s last line (structural)', () => {
    const o = fakeOpts(20);
    const blankBlock = {
      type: 'table', format: 'columnar',
      headers: ['A', 'B', 'C'],
      rows: [['Alphabet Betamax', '', 'Y']],
    };
    const lines = clean(formatBlock(blankBlock, o));
    // Line 3 (the row heading's first line) is column 0 alone — its own guide-dot fill
    // (§11.5.1d, bridging "ALPHABET" to its own column edge) is unrelated to the blank
    // entry in column 1, which has not begun yet and must carry no content or dots here.
    assert.equal(lines[3], 'ALPHABET """', 'row heading first line, its own dot fill only — column 1 not reached yet');
    assert.equal(lines[4], '  BETAMAX     ""  Y', "the blank entry's own guide-dot fill (§11.6.4) begins only on the heading's last line, alongside the other entry");
    parity(blankBlock, o);
  });

  // Regression: a SINGLE-line row heading with an entry that itself runs over is
  // unaffected — offset is 0, so this is the pre-existing (already correct) zip-by-index
  // shape. Mirrors BANA Sample 11-4's own "Bald Eagle" row (heading 1 line, "500 ac/nest
  // site" entry runs over) using plain words to reach columnar layout.
  test('a one-line row heading is unaffected — an entry runover still starts on the heading\'s own (only) line (structural)', () => {
    const o = fakeOpts(60);
    const eagleBlock = {
      type: 'table', format: 'columnar',
      headers: ['Species', 'Habitat', 'Population'],
      rows: [['Eagle', 'Five Hundred Acres Near The Nest Site Location Wide', 'Fifty']],
    };
    assert.equal(tableLayout(eagleBlock, o), 'columnar');
    const lines = clean(formatBlock(eagleBlock, o));
    const eagleLine = lines.find((l) => l.startsWith('EAGLE'));
    assert.ok(eagleLine, `row heading's own single line must carry the first entry line too: ${JSON.stringify(lines)}`);
    assert.ok(eagleLine.includes('FIVE'), `entry begins on the heading's own (only) line: ${JSON.stringify(eagleLine)}`);
    // The entry's own runover (2nd+ line) is unaffected by A9 (offset 0 throughout).
    assert.ok(lines.some((l) => l.startsWith('  ') && l.includes('WIDE')), `entry runover still lands, unaffected: ${JSON.stringify(lines)}`);
    parity(eagleBlock, o);
  });

  // Regression for the maxLines floor this fix had to keep: a row that is ENTIRELY blank
  // (row heading included) is BANA §11.9.1.b's skeleton-table case (guide-dotted, not a
  // vanished/blank line) whenever some other row in the table has real content —
  // table_rules.test.mjs's F-2 describe block covers this in depth; checked again here
  // because this fix's first draft dropped these rows to zero lines (headingLines and
  // every entry's own offset+length both evaluated to 0).
  test('a skeleton table (every row entirely blank, BANA 11.9.1.b) still renders guide-dotted lines, never zero lines (regression)', () => {
    // This fix's first draft computed a row's line count as
    // max(headingLines, ...entries' offset+length) with NO floor — when every cell in a
    // row is blank (including the row heading), every one of those terms is 0, so the row
    // vanished (0 output lines) instead of rendering its §11.9.1.b guide-dot line. Every
    // row here is blank (anyRowHasContent is false, so this is the whole-table-blank
    // skeleton case, not F-2's "blank row among real ones" spacer-line case).
    const o = fakeOpts(30);
    const block2 = {
      type: 'table', format: 'columnar',
      headers: ['A', 'B', 'C'],
      rows: [['', '', ''], ['', '', '']],
    };
    const lines = clean(formatBlock(block2, o));
    assert.deepEqual(lines, [
      '',
      'A  B  C',   // K33: the headings and separation line keep the two-cell gap too, so they line up with the rows
      '"  "  "',
      '"  "  "',
      '"  "  "',
      '',
    ], JSON.stringify(lines));
    parity(block2, o);
  });
});

// ===========================================================================================
// F-9 — the two-line cap (BANA 11.4.1/11.5.1c/11.6.1) already fires via `fitsTwoLines`
// (T9, 17 Sep 2026) for 'auto' mode; regression guards only, per this file's header comment.
// ===========================================================================================
describe('F-9 — a header, row heading, or entry needing a third line forces a format switch (auto mode); a transcriber-forced columnar table is unaffected, by design (T9)', () => {
  test('11.4.1: a column heading needing 3 lines falls back, does not render a 3-line heading (auto)', () => {
    const o = fakeOpts(20);
    const block = {
      type: 'table', format: 'auto',
      headers: ['A Very Long Column Heading Indeed Truly', 'B'],
      rows: [['x', 'y']],
    };
    assert.equal(tableLayout(block, o), 'listed');
    const lines = clean(formatBlock(block, o));
    // The TN itself word-wraps at this narrow width, so check across the joined
    // (whitespace-normalised) text rather than any one line.
    const joined = lines.map((l) => l.trim()).filter(Boolean).join(' ');
    assert.ok(joined.includes('PRINT FORMAT IS CHANGED'), `falls back to the Listed format TN: ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('11.5.1c: a row heading needing 3 lines falls back (auto)', () => {
    const o = fakeOpts(20);
    const block = {
      type: 'table', format: 'auto',
      headers: ['H1', 'H2'],
      rows: [['A Very Long Row Heading Indeed Truly Sir', 'y']],
    };
    assert.equal(tableLayout(block, o), 'listed');
    parity(block, o);
  });

  test('11.6.1: a column entry needing 3 lines falls back (auto) — same mechanism T9 already proved', () => {
    const o = fakeOpts(20);
    const block = {
      type: 'table', format: 'auto',
      headers: ['H1', 'H2'],
      rows: [['x', 'A Very Long Column Entry Indeed Truly Sir']],
    };
    assert.equal(tableLayout(block, o), 'listed');
    parity(block, o);
  });

  // T9's own documented, deliberate exception (Paul's decision, EMBOSS-TASKS.md): a
  // transcriber who explicitly forces 'columnar' bypasses the two-line check entirely.
  // Proved here so a future change cannot silently alter that decision.
  test("a transcriber-forced 'columnar' table is NOT checked against the two-line cap (by design, T9)", () => {
    const o = fakeOpts(20);
    const block = {
      type: 'table', format: 'columnar',
      headers: ['A Very Long Column Heading Indeed Truly', 'B'],
      rows: [['x', 'y']],
    };
    assert.equal(tableLayout(block, o), 'columnar', 'forced columnar bypasses fitsTwoLines, by design');
    const lines = clean(formatBlock(block, o));
    assert.ok(lines.some((l) => l.startsWith('A VERY LONG')), `a 3-line heading is rendered, not rejected: ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});
