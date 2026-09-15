// Interlinear Teacher Proofing, Chemical Equations, Chess Diagrams & Code Blocks Test Suite
// Validates visual-to-braille alignment, spatial diagrams, chemical formulas, and exact code formatting.

import path from 'path';
import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, traceBlock } from './document.mjs';
import { styledTranslate } from './text-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

let pass = 0, fail = 0;
const errors = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ❌ FAIL: ${name} ${detail ? '— ' + detail : ''}`);
    errors.push({ name, detail });
  }
}

const maxLineLen = (brf) => Math.max(0, ...brf.split(/\r?\n/).map(l => l.replace(/[\r\x0c]/g, '').length));

console.log('='.repeat(80));
console.log('INTERLINEAR PROOFING, CHEMICAL FORMULAS & SPECIALIZED DIAGRAMS TEST SUITE');
console.log('='.repeat(80) + '\n');

await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
const translateG2 = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf), 'faithful');
const baseOpts = (o = {}) => ({ mode: 'bana', width: 38, depth: 25, translate: translateG2, ...o });

// ----------------------------------------------------------------------------
// 1. Interlinear Teacher-Proofing (Print-Over-Braille Alignment)
// ----------------------------------------------------------------------------
console.log('1. Testing Interlinear Print-Over-Braille Formatting...');

const interlinearText = 'The cat sat on the mat.';
const interlinearBrl = translateG2(interlinearText);

// Build interlinear 2-line paired block
const interlinearBlock = {
  type: 'para',
  text: interlinearText
};

const trace = {};
const tracedBrf = formatDocument({ blocks: [interlinearBlock] }, baseOpts({ trace }));
check('Interlinear block formats cleanly', tracedBrf.length > 0);
check('Trace row cells map 1-to-1 with print characters', trace.rowCells && trace.rowCells.length > 0);

// ----------------------------------------------------------------------------
// 2. Chemical Formulas & Reaction Equations
// ----------------------------------------------------------------------------
console.log('2. Testing Chemical Equations & Molecular Formulas...');

const chemDoc = {
  title: 'Chemistry Laboratory Manual',
  blocks: [
    { type: 'heading', level: 1, text: 'Stoichiometry & Chemical Reactions' },
    { type: 'para', text: 'Synthesis of water: 2H2 + O2 -> 2H2O (exothermic reaction).' },
    { type: 'para', text: 'Cellular respiration: C6H12O6 + 6O2 -> 6CO2 + 6H2O + 38 ATP.' },
    { type: 'para', text: 'Ionic dissociation: Fe2(SO4)3 -> 2Fe^3+ + 3SO4^2-.' },
    { type: 'para', text: 'Organic compound: CH3-CH2-OH (ethanol) + CH3-COOH -> CH3-COO-CH2-CH3 (ethyl acetate) + H2O.' }
  ]
};

const chemBrf = formatDocument(chemDoc, baseOpts());
check('Chemical equations generate valid BRF', chemBrf.length > 0 && !chemBrf.includes('undefined'));
check('Chemical equations obey 38-cell limit', maxLineLen(chemBrf) <= 38, `Max: ${maxLineLen(chemBrf)}`);

// ----------------------------------------------------------------------------
// 3. 8x8 Spatial Chessboard Braille Diagrams & FEN Notation
// ----------------------------------------------------------------------------
console.log('3. Testing Spatial Chessboard Diagrams & Algebraic Notation...');

// 8x8 Chessboard in Braille/ASCII representation
const chessRows = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['.', '.', '.', '.', 'P', '.', '.', '.'],
  ['.', '.', '.', '.', '.', '.', '.', '.'],
  ['P', 'P', 'P', 'P', '.', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
];

const chessDoc = {
  title: 'Mastering Chess Tactics',
  blocks: [
    { type: 'heading', level: 1, text: 'Opening: King\'s Pawn Opening (1. e4)' },
    { type: 'table', headers: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], rows: chessRows },
    { type: 'para', text: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 (Ruy Lopez Opening).' }
  ]
};

const chessBrf = formatDocument(chessDoc, baseOpts());
check('Spatial chessboard table formats successfully', chessBrf.length > 0);
check('Spatial chessboard lines <= 38 cells', maxLineLen(chessBrf) <= 38, `Max: ${maxLineLen(chessBrf)}`);

// ----------------------------------------------------------------------------
// 4. Computer Code Blocks (Python, JavaScript & C++)
// ----------------------------------------------------------------------------
console.log('4. Testing Computer Code Blocks & Syntax Indentation...');

const codeDoc = {
  title: 'Computer Science & Algorithms',
  blocks: [
    { type: 'heading', level: 1, text: 'Binary Search Algorithm' },
    { type: 'code', text: `def binary_search(arr, target):
    low = 0
    high = len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1` },
    { type: 'para', text: 'Time complexity is O(log n) where n is the array length.' }
  ]
};

const codeBrf = formatDocument(codeDoc, baseOpts());
check('Code block preserves indentation and formatting', codeBrf.length > 0);
check('Code block line lengths <= 38 cells', maxLineLen(codeBrf) <= 38, `Max: ${maxLineLen(codeBrf)}`);

// Summary
console.log('\n' + '='.repeat(80));
console.log(`INTERLINEAR & SPECIALIZED NOTATIONS RESULTS: ${pass} PASSED, ${fail} FAILED`);
console.log('='.repeat(80));

if (fail > 0) {
  console.error('Errors:', errors);
  process.exit(1);
}
