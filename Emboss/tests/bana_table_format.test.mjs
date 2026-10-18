// Systematic Unit Test Suite for Phase 4A: BANA §11 Listed & Spatial Table Formatter
// Verifies BANA §11.1–11.3 Spatial Columnar and BANA §11.4 Listed Table formatting.

import { formatDocument } from '../format/document.mjs';

console.log('=== Running BANA Table Formatting Test Suite (Phase 4A) ===\n');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
    if (detail) console.error(`    Detail: ${detail}`);
  }
}

const trUpper = (s) => String(s).toUpperCase();

// Helper to normalize CRLF -> LF and strip lines
const clean = (str) => str.replace(/\r/g, '');

// --- Test 1: Simple 2x2 Spatial Columnar Table ---
console.log('--- Test 1: Simple Spatial Columnar Table ---');
const spatialDoc = {
  blocks: [
    {
      type: 'table',
      headers: ['Name', 'Age'],
      rows: [
        ['Ann', '3'],
        ['Bob', '5']
      ]
    }
  ]
};

const spatialOut = clean(formatDocument(spatialDoc, {
  translate: trUpper,
  width: 30,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

const spatialLines = spatialOut.split('\n').filter(l => l.length > 0);
// BANA §11.2.5b: "Each column is separated from a following column by two blank cells" — on
// every line, even where "NAME" (4 cells) exactly fills column 1. K33 (26 Sep 2026): this test
// used to pin a one-cell gap there (F-10/Q-7, read from BANA Example 11-2); that reading came from
// a gold transcription taken from a text dump that had collapsed two blank cells to one. The
// book's page images show two cells, and transcriber KD confirms 11.2.5b.
check('Spatial table has header line with the 2-cell gutter even where the header exactly fills its column (§11.2.5b, K33)', spatialLines.some(l => l.includes('NAME  AGE')));
// BANA §11.4.2b: the separation line is dot 5 followed by dots 25 ("3333) across each column's
// full width; the runs are two blank cells apart like the columns (K33 — Example 11-2's page image:
// `"3333333  "33333333333333333`).
check('Spatial table has "333 separation line, two cells between columns (§11.4.2b, §11.2.5b, K33)', spatialLines.some(l => l === '"333  "33'), `lines: ${JSON.stringify(spatialLines)}`);
check('Spatial table has row 1 data', spatialLines.some(l => l.includes('ANN   3')));
check('Spatial table has row 2 data', spatialLines.some(l => l.includes('BOB   5')));
// Single-line rows should not have blank lines between them
const annIdx = spatialLines.findIndex(l => l.includes('ANN'));
const bobIdx = spatialLines.findIndex(l => l.includes('BOB'));
check('Single-line rows are single-spaced (no blank line between them)', bobIdx === annIdx + 1);

// --- Test 2: Multi-line Spatial Table (F-77: no forced inter-row blank line) ---
console.log('\n--- Test 2: Multi-line Spatial Table ---');
const multiLineSpatialDoc = {
  blocks: [
    {
      type: 'table',
      format: 'spatial',
      headers: ['Feature', 'Notes'],
      rows: [
        ['Ecosystem', 'A biological community of organisms and physical environment.'],
        ['Biome', 'A large community of flora and fauna.']
      ]
    }
  ]
};

const multiSpatialOut = clean(formatDocument(multiLineSpatialDoc, {
  translate: trUpper,
  width: 60,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

const rawMultiLines = multiSpatialOut.split('\n');
check('Multi-line spatial table contains row 1 cell', rawMultiLines.some(l => l.includes('ECOSYSTEM')));
// Check for blank line between multi-line rows
const row1LineIdx = rawMultiLines.findIndex(l => l.includes('ECOSYSTEM'));
const row2LineIdx = rawMultiLines.findIndex(l => l.includes('BIOME'));
const linesBetween = rawMultiLines.slice(row1LineIdx + 1, row2LineIdx);
// F-77 (standards-findings.md): formatColumnar used to insert a blank line after EVERY
// row once any one of them wrapped, citing a "BANA §11.3.4" that does not exist in this
// reference edition. BANA Formats 2016 Sample 7-1 and Sample 11-4 both show a wrapped row
// with NO blank line around it, and §11.5.4 ("Blank Lines. Follow print when blank lines
// are used to show row groupings...") only follows print's own blank lines. Fixed: no
// blank line here even though row 1 ("Ecosystem") wraps to more than one line.
check('Multi-line spatial table has NO forced blank line between data rows (F-77; no such BANA rule)', !linesBetween.includes(''), `lines between: ${JSON.stringify(linesBetween)}`);

// --- Test 3: Listed Table Format (BANA Formats §11.16, Sample 11-24) ---
console.log('\n--- Test 3: Listed Table Format (Forced via format: listed) ---');
const listedDoc = {
  blocks: [
    {
      type: 'table',
      format: 'listed',
      headers: ['Word', 'Part of Speech', 'Definition'],
      rows: [
        ['aspect', 'noun', 'a particular part or feature of something'],
        ['trait', 'noun', 'a distinguishing quality or characteristic']
      ]
    }
  ]
};

const listedOut = clean(formatDocument(listedDoc, {
  translate: trUpper,
  width: 38,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

const listedLines = listedOut.split('\n');
check('Listed table TN explains the print-format change (§11.16l)', listedLines.some(l => l.includes('@.<PRINT FORMAT IS CHANGED.')));
check('Row 1: first column heading + row heading as a cell-5 heading (§11.16e)', listedLines.some(l => l.startsWith('    WORD: ASPECT')));
check('Row 1: other headings with entries in 1-3 (§11.16f)', listedLines.some(l => l.startsWith('PART OF SPEECH: NOUN')));
check('Row 1: second heading in 1-3', listedLines.some(l => l.startsWith('DEFINITION: A PARTICULAR')));
check('Row 2 heading in cell 5', listedLines.some(l => l.startsWith('    WORD: TRAIT')));
check('Blank line before each row (§11.16k)', listedOut.includes('SOMETHING\n\n    WORD: TRAIT'));

// --- Test 4: Wide Table Auto-Switching to Listed Format ---
console.log('\n--- Test 4: Wide Table Auto-Switching ---');
const wideTableDoc = {
  blocks: [
    {
      type: 'table',
      format: 'auto',
      headers: ['Country', 'Capital City', 'Primary Language', 'Currency Name', 'Population Estimate'],
      rows: [
        ['United States of America', 'Washington, District of Columbia', 'English', 'United States Dollar', '330 Million'],
        ['United Kingdom', 'London, Greater London', 'English', 'Pound Sterling', '67 Million']
      ]
    }
  ]
};

const wideOut = clean(formatDocument(wideTableDoc, {
  translate: trUpper,
  width: 38,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

check('Wide table exceeding page width automatically formats as Listed table', wideOut.includes('@.<PRINT FORMAT IS CHANGED.'));
check('Wide table extracts row 1 in listed format', wideOut.includes('UNITED STATES OF AMERICA'));

// --- Test 5: Sparse / Empty Cells in Listed Table (BANA Formats §11.16h) ---
console.log('\n--- Test 5: Sparse / Empty Cells in Listed Table ---');
const sparseDoc = {
  blocks: [
    {
      type: 'table',
      format: 'listed',
      headers: ['Term', 'Variant', 'Meaning'],
      rows: [
        ['Matrix', '', 'A rectangular array of numbers'],
        ['Vector', '1D array', 'A quantity having direction and magnitude']
      ]
    }
  ]
};

const sparseOut = clean(formatDocument(sparseDoc, {
  translate: trUpper,
  width: 38,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

check('Blank entry is three unspaced guide dots', sparseOut.includes('VARIANT: """'));
check('Blank entries are explained in the TN', sparseOut.includes('THREE GUIDE DOTS'));

// --- Test 6: Table Title and Custom Transcriber Note ---
console.log('\n--- Test 6: Table Title and Custom Transcriber Note ---');
const titledDoc = {
  blocks: [
    {
      type: 'table',
      title: 'Vocabulary Terms Table',
      tabletn: 'Table: Listed format for Chapter 1 terms.',
      format: 'listed',
      headers: ['Term', 'Definition'],
      rows: [
        ['Hypothesis', 'A proposed explanation based on limited evidence.']
      ]
    }
  ]
};

const titledOut = clean(formatDocument(titledDoc, {
  translate: trUpper,
  width: 60,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

check('Table title is centred above table', titledOut.includes('VOCABULARY TERMS TABLE'));
check('Custom transcriber note is formatted in TN symbols', titledOut.includes('@.<TABLE: LISTED FORMAT FOR CHAPTER 1 TERMS.') && titledOut.includes('PRINT FORMAT IS CHANGED.'));

// --- Test 7: Table without Headers ---
console.log('\n--- Test 7: Table without Headers ---');
const noHeadersDoc = {
  blocks: [
    {
      type: 'table',
      headers: [],
      rows: [
        ['Item A', '100'],
        ['Item B', '200']
      ]
    }
  ]
};

const noHeadersOut = clean(formatDocument(noHeadersDoc, {
  translate: trUpper,
  width: 30,
  depth: 25,
  mode: 'bana',
  standard: 'bana'
}));

// "Item A"/"Item B" (6 cells) exactly fill column 1; the gap before the number column is still
// two cells (§11.2.5b; K33 — the one-cell gap this test used to pin is withdrawn, as above).
check('Table without headers formats in spatial columns without errors', noHeadersOut.includes('ITEM A  100'));
check('Second row of headerless table formats cleanly', noHeadersOut.includes('ITEM B  200'));

console.log(`\nTable formatting tests complete: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
