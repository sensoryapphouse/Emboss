// Extreme Pathological & "Zalgo" Adversarial Fuzzing Test Suite
// Pushes word-wrapping, unicode normalization, buffer allocation, and recursive structures to the limit.

import path from 'path';
import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatBlock } from './document.mjs';
import { styledTranslate } from './text-style.mjs';
import { parseNimasXml, parseHtml, parseText, parseMarkdown } from '../input/parse.mjs';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;

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
console.log('EXTREME PATHOLOGICAL & "ZALGO" ADVERSARIAL FUZZING TEST SUITE');
console.log('='.repeat(80) + '\n');

await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
const translateG2 = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf), 'faithful');
const baseOpts = (o = {}) => ({ mode: 'bana', width: 38, depth: 25, translate: translateG2, ...o });

// ----------------------------------------------------------------------------
// 1. Pathological Unbreakable Token Lengths (50,000 continuous characters)
// ----------------------------------------------------------------------------
console.log('1. Testing Massive Unbreakable Tokens...');

const massiveWord = 'supercalifragilisticexpialidocious'.repeat(1500); // ~51,000 chars without a single space
const tokenDoc = {
  blocks: [
    { type: 'heading', level: 1, text: 'Massive Token Test' },
    { type: 'para', text: massiveWord }
  ]
};

const t0 = Date.now();
const tokenBrf = formatDocument(tokenDoc, baseOpts());
const t1 = Date.now();

check('Massive 50,000-char token formats within 500ms', (t1 - t0) < 500, `Elapsed: ${t1 - t0}ms`);
check('Massive token output obeys 38-cell limit', maxLineLen(tokenBrf) <= 38, `Max: ${maxLineLen(tokenBrf)}`);
check('Massive token produces multiple pages without hanging', tokenBrf.split('\x0c').length > 10);

// ----------------------------------------------------------------------------
// 2. Invisible Unicode, Zero-Width Characters & Bidi Control Marks
// ----------------------------------------------------------------------------
console.log('2. Testing Invisible Unicode & Zero-Width Characters...');

const invisibleChars = [
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\u200E', // LTR mark
  '\u200F', // RTL mark
  '\uFEFF', // byte order mark (zero-width no-break space)
  '\u00AD', // soft hyphen
  '\u2060', // word joiner
  '\u202A', '\u202B', '\u202C', '\u202D', '\u202E' // directional embeddings & overrides
];

let invisibleText = 'The';
for (const ch of invisibleChars) {
  invisibleText += ch + 'quick' + ch + 'brown' + ch + 'fox' + ch + 'jumps' + ch + 'over' + ch + 'the' + ch + 'lazy' + ch + 'dog.';
}

const invisibleDoc = {
  blocks: [
    { type: 'para', text: invisibleText }
  ]
};

const invBrf = formatDocument(invisibleDoc, baseOpts());
check('Invisible unicode characters do not crash translation', invBrf.length > 0);
check('Invisible characters line length <= 38', maxLineLen(invBrf) <= 38, `Max: ${maxLineLen(invBrf)}`);

// ----------------------------------------------------------------------------
// 3. "Zalgo" Stacked Combining Diacritical Marks (50 marks stacked per char)
// ----------------------------------------------------------------------------
console.log('3. Testing "Zalgo" Stacked Combining Marks...');

function makeZalgo(text, depth = 30) {
  let res = '';
  for (const char of text) {
    res += char;
    for (let i = 0; i < depth; i++) {
      // Combining diacritical marks range \u0300 to \u036F
      res += String.fromCharCode(0x0300 + ((char.charCodeAt(0) + i) % 0x6F));
    }
  }
  return res;
}

const zalgoText = makeZalgo('HE COMES THE GLITCH IS REAL', 30);
const zalgoDoc = {
  blocks: [
    { type: 'heading', level: 1, text: makeZalgo('ZALGO HEADING', 15) },
    { type: 'para', text: zalgoText }
  ]
};

const zalgoBrf = formatDocument(zalgoDoc, baseOpts());
check('Zalgo stacked combining text translates safely', zalgoBrf.length > 0 && !zalgoBrf.includes('undefined'));
check('Zalgo line lengths <= 38 cells', maxLineLen(zalgoBrf) <= 38, `Max: ${maxLineLen(zalgoBrf)}`);

// ----------------------------------------------------------------------------
// 4. Extreme Nesting Depth (50 Levels of Nested Lists & Containers)
// ----------------------------------------------------------------------------
console.log('4. Testing Extreme Nesting Depths...');

const nestedListItems = [];
for (let lvl = 1; lvl <= 50; lvl++) {
  nestedListItems.push({ text: `Deeply nested item level ${lvl}`, level: lvl });
}

const deepDoc = {
  blocks: [
    { type: 'heading', level: 1, text: '50-Level Deep List' },
    { type: 'list', items: nestedListItems }
  ]
};

const deepBrf = formatDocument(deepDoc, baseOpts());
check('50-level nested list formats without stack overflow', deepBrf.length > 0);
check('50-level nested list line length <= 38', maxLineLen(deepBrf) <= 38, `Max: ${maxLineLen(deepBrf)}`);

// ----------------------------------------------------------------------------
// 5. Degenerate Page Dimensions (Micro & Macro Geometries)
// ----------------------------------------------------------------------------
console.log('5. Testing Degenerate Page Geometries...');

const standardDoc = {
  blocks: [
    { type: 'heading', level: 1, text: 'Geometry Test' },
    { type: 'para', text: 'This paragraph is tested across pathological page dimensions.' }
  ]
};

// Micro-geometry 5x3 (clamped defensively to min width 10, depth 10)
const microBrf = formatDocument(standardDoc, baseOpts({ width: 5, depth: 3 }));
check('Micro page 5x3 does not infinite loop or crash', microBrf.length > 0);
check('Micro page max line width clamped to min 10', maxLineLen(microBrf) <= 10, `Max: ${maxLineLen(microBrf)}`);

// Degenerate 1x1 (clamped defensively to min width 10, depth 10)
const nanoBrf = formatDocument(standardDoc, baseOpts({ width: 1, depth: 1 }));
check('Nano page 1x1 executes gracefully', nanoBrf.length > 0);
check('Nano page max line width clamped to min 10', maxLineLen(nanoBrf) <= 10, `Max: ${maxLineLen(nanoBrf)}`);

// Ultra-wide macro-geometry 250x100 (clamped defensively to max width 60, depth 45)
const macroBrf = formatDocument(standardDoc, baseOpts({ width: 250, depth: 100 }));
check('Macro page 250x100 executes cleanly', macroBrf.length > 0);
check('Macro page max line width clamped to max 60', maxLineLen(macroBrf) <= 60, `Max: ${maxLineLen(macroBrf)}`);

// ----------------------------------------------------------------------------
// 6. Massive Empty Block Sequences (5,000 empty paragraphs)
// ----------------------------------------------------------------------------
console.log('6. Testing Massive Empty Block Sequences...');

const emptyDoc = {
  blocks: Array.from({ length: 5000 }, () => ({ type: 'para', text: '' }))
};

const emptyBrf = formatDocument(emptyDoc, baseOpts());
check('5,000 empty blocks produces empty string safely', emptyBrf === '');

// Summary
console.log('\n' + '='.repeat(80));
console.log(`EXTREME FUZZING & ZALGO RESULTS: ${pass} PASSED, ${fail} FAILED`);
console.log('='.repeat(80));

if (fail > 0) {
  console.error('Errors:', errors);
  process.exit(1);
}
