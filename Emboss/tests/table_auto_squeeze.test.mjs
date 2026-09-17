// T9 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026) — BANA Formats 2016 §11.6.1: "Column
// entries are limited to two lines. Entries that cannot be limited to two lines require
// another specialized table format." a. "Indent column entry runovers two cells to the
// right of the left-hand margin of the column." §11.6.1g: "Do not insert guide dots after
// a column runover (other than the first column), as the runover is not leading to the
// beginning of the next column."
//
// Before this fix: `resolveTableLayout`'s 'auto' mode only attempted the word-preserving
// squeeze (`fitColumnWidths`) when the table already fit the line at its UNSQUEEZED
// natural width (or carried a two-tier header, F-12) — otherwise it fell straight to
// Listed (BANA)/paragraph (UKAAF) without ever trying to squeeze. This is why BANA Sample
// 11-04 (Emboss/tests/gold/bana-formats-2016/section-11/sample-11-04.json), whose own
// transcription squeezes 22/17/19-cell natural columns down to 13/13/10 with runovers, fell
// straight to Listed in Emboss (see standards-findings.md's F-18 status update) — the old
// pre-check rejected the table before the squeeze ever got a chance to fit it.
//
// This file proves the fix: 'auto' now always tries the squeeze first, and accepts
// columnar only when it fits AND every entry (headers included) stays within two lines at
// the squeezed width, with no word divided (already guaranteed by `fitColumnWidths`'
// `columnMinWidths`, which this fix also had to correct — see the second test below and
// its own comment).
//
// Sample 11-04 itself is NOT used as this file's worked example: proving the fix against
// it surfaced a second, pre-existing gap it was not in this fix's scope to build — see the
// "NOT Sample 11-04" comment below the two-line-count test for the full account, and
// standards-findings.md's own T9 status update (filed against BANA 1.10.1, already
// "partial" in standards-map.md for the same underlying gap: no code path for the
// discretionary division of a compound term).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, tableLayout } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (width = 38) => ({
  mode: 'bana', standard: 'bana', width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));

// --- Auto squeezes when every entry fits two lines (BANA §11.6.1) ----------------------

// At its natural (unsqueezed) width this table is 62 cells wide — far over the 36-cell
// line — so the OLD 'auto' pre-check ("only try the squeeze when the table already fits
// unsqueezed") would reject it outright and fall to Listed without ever trying to squeeze.
// Squeezed, every entry (including two multi-word entries that runover, and a third
// column that ALSO runs over on row 2) still fits in two lines with no word divided.
const squeezeBlock = {
  type: 'table', format: 'auto',
  headers: ['Country', 'Capital City', 'Population'],
  rows: [
    ['United Kingdom', 'London', '67 million'],
    ['United States', 'Washington City', '331 million'],
  ],
};

// F-77 (standards-findings.md): no blank line between these two wrapped rows — BANA
// Formats §7's own Sample 7-1 ("Two Boxes Separated by a Blank Line") shows a wrapped row
// with no blank line around it either side, and §11.5.4 ("Blank Lines. Follow print when
// blank lines are used to show row groupings...") only follows print's OWN blank lines,
// never inserts one just because a row happens to wrap. formatColumnar used to insert a
// blank line after every row once ANY row wrapped, citing a "BANA §11.3.4" that does not
// exist in this edition — removed; see the dedicated F-77 tests below for the fix itself.
test('T9: auto mode squeezes into columnar when every entry fits two squeezed lines', () => {
  assert.equal(tableLayout(squeezeBlock, opts(36)), 'columnar',
    'the whole table (62 cells natural) does not fit unsqueezed at width 36 — the pre-T9 ' +
    'pre-check would have rejected it outright; T9 must still try the squeeze');
  const lines = clean(formatBlock(squeezeBlock, opts(36)));
  assert.deepEqual(lines, [
    '',
    'COUNTRY    CAPITAL CITY POPULATION',
    '"33333333 "33333333333 "333333333',
    'UNITED "" LONDON """"" 67 MILLION',
    '  KINGDOM',
    'UNITED "" WASHINGTON    331',
    '  STATES     CITY          MILLION',
    '',
  ], JSON.stringify(lines));
});

// §11.6.1a: "Indent column entry runovers two cells to the right of the left-hand margin
// of the column." Proved here on an unambiguous single-column table (no column-boundary
// gutter to complicate reading the indent) squeezed by the same T9 auto-squeeze path;
// the multi-column squeezed table above (`squeezeBlock`) shows column 1's own runover
// ("KINGDOM"/"STATES", asserted in its exact full-line form there) landing correctly at
// its own column's left margin, indented 2, the same way.
test('T9: column entry runovers are indented two cells (§11.6.1a)', () => {
  const lines = clean(formatBlock(squeezeBlock, opts(36)));
  assert.equal(lines[4], '  KINGDOM', 'row 1 column 1 runover, 2-cell indent (from the squeezed table above)');
  const single = {
    type: 'table', format: 'auto',
    headers: ['Description'],
    rows: [['alpha beta gamma delta epsilon']],
  };
  const lines2 = clean(formatBlock(single, opts(16)));
  assert.deepEqual(lines2, ['', 'DESCRIPTION', '"333333333333333', 'ALPHA BETA GAMMA', '  DELTA EPSILON', ''], JSON.stringify(lines2));
  assert.equal(lines2[4], '  DELTA EPSILON', 'runover indented exactly 2 cells');
});

// §11.6.1g: "Do not insert guide dots after a column runover (other than the first
// column), as the runover is not leading to the beginning of the next column." None of
// this table's three runover lines above are preceded by a guide-dot run — a genuine
// guide-dot fill (`""` after "UNITED"/"LONDON" on the row's FIRST line) is a different,
// unaffected mechanism (§11.6.1f, bridging a short entry to the next column).
test('T9: no guide dots inserted after a column runover (§11.6.1g)', () => {
  const lines = clean(formatBlock(squeezeBlock, opts(36)));
  for (const runover of ['  KINGDOM', '  STATES     CITY          MILLION']) {
    assert.ok(!runover.includes('"'), `runover line must carry no guide dots: ${JSON.stringify(runover)}`);
  }
});

test('T9: formatBlock and traceBlock agree on the squeezed columnar table', () => {
  const formatted = clean(formatBlock(squeezeBlock, opts(36)));
  const traced = clean(traceBlock(squeezeBlock, opts(36), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// --- Auto falls back when an entry needs three lines even squeezed ---------------------

// "Dense tropical forest" (3 words) cannot be limited to two lines at any width this
// 3-column table can squeeze it to without violating column 1's own word-preserving
// minimum — BANA §11.6.1's own text ("Entries that cannot be limited to two lines require
// another specialized table format") requires the fallback here, not a 3-line columnar
// entry.
const threeLineBlock = {
  type: 'table', format: 'auto',
  headers: ['Animal Name', 'Habitat Description', 'Population Count'],
  rows: [
    ['Mountain Gorilla', 'Dense tropical forest', '880 individuals'],
    ['Snow Leopard', 'High mountain terrain', '4000 individuals'],
  ],
};

// T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): at width 40 this table's three
// columns can be divided into vertical sections that each fit at their own NATURAL
// (unsqueezed) width (BANA §11.14) — the "needs three lines squeezed" problem never
// arises there because vertical division never squeezes a column below its own widest
// entry in the first place. Vertical division is tried before Listed (§11.12.1's "another
// table format" is chosen for readability, not assumed to always be Listed), so width 40
// now resolves 'vertical', not 'listed' — this is the fix working as intended, not a
// regression: the old expectation (every one of these widths must fall to Listed) was
// only ever true because Emboss had no other alternate format to offer yet.
test('T9: auto falls back to Listed when an entry would need three lines even squeezed (narrower than any vertical-division section can fit)', () => {
  for (const w of [30, 34, 36, 38]) {
    assert.equal(tableLayout(threeLineBlock, opts(w)), 'listed',
      `"Dense tropical forest" cannot reach two lines at width ${w}, and no vertical section fits either: ${tableLayout(threeLineBlock, opts(w))}`);
  }
  const lines = clean(formatBlock(threeLineBlock, opts(38)));
  assert.ok(lines.some((l) => l.includes('PRINT FORMAT IS CHANGED')), 'falls back to the Listed format TN');
});

// T4: at width 40 (just wide enough for two vertical sections — row heading + one data
// column each) 'auto' reaches 'vertical' instead, per BANA §11.14 being tried before
// Listed stays the last resort.
test('T4: at a width where vertical division fits, auto prefers it over Listed', () => {
  assert.equal(tableLayout(threeLineBlock, opts(40)), 'vertical');
  const lines = clean(formatBlock(threeLineBlock, opts(40)));
  assert.ok(lines.some((l) => l.includes('DIVIDED VERTICALLY')), 'the vertical-division TN (§11.14.1c) appears');
  assert.ok(!lines.some((l) => l.includes('PRINT FORMAT IS CHANGED')), 'not the Listed format TN');
});

// NOT Sample 11-04: its own "Habitat Unit" column has a genuine 3-line-or-divide dilemma
// of its own — "20 ac/territory"/"1 ac/territory" are each a single unspaced print token
// (no space around the "/"), so at ANY column width this table can squeeze to (its own
// row-heading and population columns already sit at their own word-preserving minimum,
// leaving no more width to give), that whole token (12 cells) cannot fit a runover line
// (indent 2 cells) without being divided — exactly what the book's own braille shows: it
// divides "ac/territory" at the slash, treating it like a hyphenated compound (a discretion
// BANA 1.10.1 grants for hyphenated compounds — already recorded "partial" in
// standards-map.md, no code path exists to invoke it for ANY joining punctuation). Adding
// that discretion was out of scope for T9 (a generic squeeze/fallback decision, not a new
// word-division mode) and risks a much larger, unreviewed change to the shared wrapCells
// primitive — so sample-11-04 correctly (and, per gold-run.mjs, still) falls back to
// Listed under this fix, and standards-findings.md's T9 status update says so plainly
// rather than forcing a false "matches" claim.
test('T9: word-preserving squeeze never divides a word (BANA §11.6.1a/A27b) — regression for the runover-margin gap found proving this fix', () => {
  // A single multi-word entry whose widest word ("individuals", 11 cells) would land on
  // a column-entry RUNOVER line (indent 2): the column must be at least 11+2=13 cells
  // wide to host it without hard-chunking. Before this fix, `columnMinWidths` only
  // required 11 (the word's own length, ignoring the runover indent it may need to
  // survive on) — `fitColumnWidths` would then squeeze this column to exactly 11 and
  // `wrapCells`' own "overflow safety net" (an arbitrary character cut, never meant to
  // fire under normal operation) would silently divide the word instead.
  const block = {
    type: 'table', format: 'auto',
    headers: ['A', 'B'],
    rows: [['xxxxxxxxxxxxxxxxxxxx', '880 individuals']],
  };
  for (let w = 15; w <= 40; w++) {
    const layout = tableLayout(block, opts(w));
    if (layout !== 'columnar') continue;
    const lines = clean(formatBlock(block, opts(w)));
    assert.ok(!lines.some((l) => /INDIVIDUAL[^S]/.test(l) || /^\s*S\s*$/.test(l)),
      `"individuals" must never be split at width ${w}: ${JSON.stringify(lines)}`);
  }
});

// --- F-77 (standards-findings.md): no blank line between rows just because one wraps ---
//
// formatColumnar used to insert a blank line after EVERY data row once ANY row in the
// table wrapped to more than one physical line, citing a "BANA §11.3.4" that does not
// exist in this reference edition (§11.3 runs only 11.3.1-11.3.2). BANA's own §11.5.4
// ("Blank Lines. Follow print when blank lines are used to show row groupings...") only
// follows PRINT's own blank lines — it never manufactures one just because a row wraps.
// Both cases below mirror worked BANA gold samples that directly contradict the old
// behaviour by showing NO blank line around a wrapped row.

// Mirrors BANA Sample 7-1's own "Kinetic Energy" box (Emboss/tests/gold/bana-formats-2016/
// section-7/sample-7-01.json): three short rows, then a fourth whose second column wraps
// to two lines ("electrons in an electrical current"). The gold braille (source lines
// 5599-5606) carries no blank line anywhere among these four rows, including around the
// wrapped one.
test('F-77: no blank line around a wrapped LAST row (BANA Sample 7-1, Kinetic Energy box)', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Kinetic Energy', 'Example'],
    rows: [
      ['Sound', 'vibrating object'],
      ['Thermal', 'hot cocoa'],
      ['Mechanical', 'falling rock'],
      ['Electrical', 'electrons in an electrical current'],
    ],
  };
  const lines = clean(formatBlock(block, opts(40)));
  assert.deepEqual(lines, [
    '',
    'KINETIC ENERGY EXAMPLE',
    '"3333333333333 "33333333333333333333333',
    'SOUND """""""" VIBRATING OBJECT',
    'THERMAL """""" HOT COCOA',
    'MECHANICAL """ FALLING ROCK',
    'ELECTRICAL """ ELECTRONS IN AN',
    '                  ELECTRICAL CURRENT',
    '',
  ], JSON.stringify(lines));
});

// A row in the MIDDLE of the table wraps this time (not the last) — no blank line before
// OR after it either, same rule (§11.5.4 only follows print's own blank lines).
test('F-77: no blank line around a wrapped MIDDLE row', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Animal', 'Note'],
    rows: [
      ['Fox', 'quick and clever animal'],
      ['Owl', 'wise'],
      ['Bear', 'strong'],
    ],
  };
  const lines = clean(formatBlock(block, opts(30)));
  assert.deepEqual(lines, [
    '',
    'ANIMAL NOTE',
    '"33333 "333333333333333333333',
    'FOX "" QUICK AND CLEVER',
    '          ANIMAL',
    'OWL "" WISE',
    'BEAR    STRONG',
    '',
  ], JSON.stringify(lines));
});

test('F-77: formatBlock and traceBlock agree with no forced blank lines', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Kinetic Energy', 'Example'],
    rows: [
      ['Sound', 'vibrating object'],
      ['Electrical', 'electrons in an electrical current'],
    ],
  };
  const formatted = clean(formatBlock(block, opts(40)));
  const traced = clean(traceBlock(block, opts(40), false, 0).map((t) => t.s));
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});
