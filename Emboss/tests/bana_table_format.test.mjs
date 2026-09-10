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
check('Spatial table has header line with 2-space gutter', spatialLines.some(l => l.includes('NAME  AGE')));
check('Spatial table has separator line with hyphens under columns', spatialLines.some(l => l.includes('----  ---')));
check('Spatial table has row 1 data', spatialLines.some(l => l.includes('ANN   3')));
check('Spatial table has row 2 data', spatialLines.some(l => l.includes('BOB   5')));
// Single-line rows should not have blank lines between them
const annIdx = spatialLines.findIndex(l => l.includes('ANN'));
const bobIdx = spatialLines.findIndex(l => l.includes('BOB'));
check('Single-line rows are single-spaced (no blank line between them)', bobIdx === annIdx + 1);

// --- Test 2: Multi-line Spatial Table (BANA §11.3.4 Inter-row spacing) ---
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
check('Multi-line spatial table has blank line between data rows (BANA §11.3.4)', linesBetween.includes(''), `lines between: ${JSON.stringify(linesBetween)}`);

// --- Test 3: Listed Table Format (BANA §11.4) ---
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
check('Listed table includes standard TN announcing format', listedLines.some(l => l.includes('@.<TABLE: LISTED TABLE FORMAT@.>')));
check('Listed table Row 1 label starts in Cell 1', listedLines.some(l => l.startsWith('ASPECT')));
check('Listed table Row 1 attribute line starts in Cell 3 with header prefix', listedLines.some(l => l.startsWith('  PART OF SPEECH: NOUN')));
check('Listed table Row 1 second attribute starts in Cell 3 with header prefix', listedLines.some(l => l.startsWith('  DEFINITION: A PARTICULAR')));
check('Listed table Row 2 label starts in Cell 1', listedLines.some(l => l.startsWith('TRAIT')));
check('Listed table has blank line separating row entries', listedOut.includes('SOMETHING\n\nTRAIT'));

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

check('Wide table exceeding page width automatically formats as Listed table', wideOut.includes('@.<TABLE: LISTED TABLE FORMAT@.>'));
check('Wide table extracts row 1 in listed format', wideOut.includes('UNITED STATES OF AMERICA'));

// --- Test 5: Sparse / Empty Cells in Listed Table (BANA §11.4.3) ---
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

check('Omitted cell in listed table produces dash (---)', sparseOut.includes('VARIANT: ---'));

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
check('Custom transcriber note is formatted in TN symbols', titledOut.includes('@.<TABLE: LISTED FORMAT FOR CHAPTER 1 TERMS.@.>'));

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

check('Table without headers formats in spatial columns without errors', noHeadersOut.includes('ITEM A  100'));
check('Second row of headerless table formats cleanly', noHeadersOut.includes('ITEM B  200'));

console.log(`\nTable formatting tests complete: ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
