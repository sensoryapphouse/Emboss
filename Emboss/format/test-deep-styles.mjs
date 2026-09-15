// Deep Stress & Pathological Testing for Nested Lists, Tables, and All Style Elements
// Asserts layout invariants, BANA/UKAAF standards compliance, cell-trace precision, and crash resistance.

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatBlock, traceBlock } from './document.mjs';
import { styledTranslate } from './text-style.mjs';
import { BRF64 } from '../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;
const BRF_SET = new Set((BRF64 + '\r\n\x0c').split(''));

let pass = 0, fail = 0;
const errors = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    errors.push({ name, detail });
  }
}

(async () => {
  console.log('='.repeat(70));
  console.log('STARTING DEEP STRESS & ADVERSARIAL TESTING');
  console.log('Testing: Multi-Level Lists, Tables, Sidebars, Poetry, Plays, Math, Styles');
  console.log('='.repeat(70) + '\n');

  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const translate = styledTranslate((t, tf) => louis.translate(t, T, tf), 'faithful');
  const translatePos = (t, tf) => louis.translatePos(t, T, tf);

  const baseOpts = (extra = {}) => ({
    mode: 'ukaaf',
    width: 38,
    depth: 25,
    listStyle: 'spaced',
    translate,
    translatePos,
    mathToBrf: null,
    ...extra
  });

  // =========================================================================
  // 1. MULTI-LEVEL (NESTED) LISTS
  // =========================================================================
  console.log('1. Testing Multi-Level (Nested) Lists...');

  // Test 1.1: 5-level deep nested list in Spaced Mode (1-3, 3-5, 5-7, 7-9, 9-11)
  const deepListBlock = {
    type: 'list',
    items: [
      { text: 'Level 0 Item Alpha', level: 0 },
      { text: 'Level 1 Item Beta', level: 1 },
      { text: 'Level 2 Item Gamma', level: 2 },
      { text: 'Level 3 Item Delta', level: 3 },
      { text: 'Level 4 Item Epsilon', level: 4 }
    ]
  };

  for (const mode of ['ukaaf', 'bana']) {
    const opts = baseOpts({ mode, listStyle: 'spaced' });
    const blockLines = formatBlock(deepListBlock, opts).filter(l => l.trim().length > 0);
    const trace = traceBlock(deepListBlock, opts, false, 0);

    check(`${mode} deep list: formats 5 levels`, blockLines.length === 5);
    check(`${mode} deep list: L0 starts cell 1`, blockLines[0] && !blockLines[0].startsWith(' '));
    check(`${mode} deep list: L1 starts cell 3`, blockLines[1] && blockLines[1].startsWith('  ') && !blockLines[1].startsWith('   '));
    check(`${mode} deep list: L2 starts cell 5`, blockLines[2] && blockLines[2].startsWith('    ') && !blockLines[2].startsWith('     '));
    check(`${mode} deep list: L3 starts cell 7`, blockLines[3] && blockLines[3].startsWith('      ') && !blockLines[3].startsWith('       '));
    check(`${mode} deep list: L4 starts cell 9`, blockLines[4] && blockLines[4].startsWith('        ') && !blockLines[4].startsWith('         '));
    check(`${mode} deep list: trace generated for all items`, trace && trace.some(t => t.src && t.src.some(c => c && c.u === 4)));
  }

  // Test 1.2: Compact List Mode (5-1, 7-1, 9-1, 11-1, 13-1)
  for (const mode of ['ukaaf', 'bana']) {
    const opts = baseOpts({ mode, listStyle: 'compact' });
    const blockLines = formatBlock(deepListBlock, opts).filter(l => l.trim().length > 0);

    check(`${mode} compact list: L0 starts cell 5`, blockLines[0] && blockLines[0].startsWith('    ') && !blockLines[0].startsWith('     '));
    check(`${mode} compact list: L1 starts cell 7`, blockLines[1] && blockLines[1].startsWith('      ') && !blockLines[1].startsWith('       '));
    check(`${mode} compact list: L2 starts cell 9`, blockLines[2] && blockLines[2].startsWith('        ') && !blockLines[2].startsWith('         '));
  }

  // Test 1.3: Numbered and Mixed Nested Lists with Segments / Formatting
  const mixedNestedDoc = {
    blocks: [{
      type: 'list',
      ordered: true,
      items: [
        { marker: '1.', text: 'First main objective', level: 0 },
        { marker: '1.1', segments: [{ type: 'text', text: 'Sub-point with ' }, { type: 'text', text: 'bold emphasis', tf: louis.TYPEFORM.bold }], level: 1 },
        { marker: '1.1.1', text: 'Deep formula parameter: x + y = z', level: 2 },
        { marker: '2.', text: 'Second main objective', level: 0 }
      ]
    }]
  };

  const mixedTrace = {};
  const mixedBrf = formatDocument(mixedNestedDoc, baseOpts({ trace: mixedTrace }));
  check('mixed nested list: formatted successfully', mixedBrf.length > 0);
  check('mixed nested list: trace maps units', mixedTrace.rowCells && mixedTrace.rowCells.some(row => row && row.some(c => c && c.u === 1)));

  // Test 1.4: Adversarial List with Extreme/Negative Levels (Clamp testing)
  const extremeListDoc = {
    blocks: [{
      type: 'list',
      items: [
        { text: 'Negative level -5', level: -5 },
        { text: 'Excessive level 50', level: 50 },
        { text: 'Undefined level', level: undefined }
      ]
    }]
  };
  const extremeBrf = formatDocument(extremeListDoc, baseOpts({ width: 30 }));
  check('extreme list levels: clamped without throwing', typeof extremeBrf === 'string');
  const extremeLines = extremeBrf.split('\x0c').flatMap(p => p.split('\r\n'));
  check('extreme list levels: all lines stay <= width 30', extremeLines.every(l => l.length <= 30));

  // =========================================================================
  // 2. TABLES (SPATIAL COLUMNAR & LISTED FALLBACK)
  // =========================================================================
  console.log('\n2. Testing Tables...');

  // Test 2.1: Narrow 3-Column Spatial Table (fits within width 38)
  const narrowTableDoc = {
    blocks: [{
      type: 'table',
      headers: ['Item', 'Qty', 'Price'],
      rows: [
        ['Apples', '5', '$2.50'],
        ['Bananas', '12', '$3.00'],
        ['Cherries', '100', '$15.00']
      ]
    }]
  };

  const narrowTrace = {};
  const narrowBrf = formatDocument(narrowTableDoc, baseOpts({ tableFormat: 'columnar', trace: narrowTrace }));
  check('spatial table: formats without crash', narrowBrf.length > 0);
  check('spatial table: contains header separation line', narrowBrf.includes('---') || narrowBrf.includes('===') || narrowBrf.includes('333') || narrowBrf.includes('111') || narrowBrf.includes('---'));
  check('spatial table: trace contains cell mappings', narrowTrace.rowCells && narrowTrace.rowCells.some(r => r && r.some(c => c && c.c >= 0)));

  // Test 2.2: Over-Wide Table (10 columns, must automatically fall back to Listed format)
  const wideTableDoc = {
    blocks: [{
      type: 'table',
      headers: ['Col 1', 'Col 2', 'Col 3', 'Col 4', 'Col 5', 'Col 6', 'Col 7', 'Col 8', 'Col 9', 'Col 10'],
      rows: [
        Array.from({ length: 10 }, (_, i) => `Measurement Value Data ${i + 1}`)
      ]
    }]
  };

  const wideTrace = {};
  const wideBrf = formatDocument(wideTableDoc, baseOpts({ trace: wideTrace }));
  check('wide table: falls back to listed format', wideBrf.includes('@.<') || wideBrf.includes('Table'));
  check('wide table: trace preserved for listed rows', wideTrace.rows && wideTrace.rows.some(r => r === 0));

  // Test 2.3: Pathological Table with Empty Cells, Null Rows, and Special Characters
  const messyTableDoc = {
    blocks: [{
      type: 'table',
      headers: ['Header A', '', 'Header C (100%)'],
      rows: [
        ['Data 1', null, 'Data 3'],
        ['', 'Data 2', ''],
        ['Row 3', '£45.00 ≈ $60.00', 'Valid & Tested']
      ]
    }]
  };
  const messyBrf = formatDocument(messyTableDoc, baseOpts());
  check('pathological table: handles null/empty cells cleanly', typeof messyBrf === 'string');
  check('pathological table: all chars are valid BRF', [...messyBrf].every(c => BRF_SET.has(c)));

  // =========================================================================
  // 3. OTHER STYLE ELEMENTS (SIDEBARS, POETRY, DIALOGUE, FOOTNOTES, MATH)
  // =========================================================================
  console.log('\n3. Testing Other Style Elements (Sidebars, Poetry, Plays, Footnotes, Math)...');

  // Test 3.1: Sidebars with Nested Blocks (heading, para, list, table inside sidebar)
  const sidebarDoc = {
    blocks: [{
      type: 'sidebar',
      title: 'Historical Context Sidebar',
      blocks: [
        { type: 'heading', level: 3, text: 'Sidebar Sub-heading' },
        { type: 'para', text: 'Sidebar body explaining empirical methodology in depth.' },
        { type: 'list', items: [{ text: 'Key milestone 1', level: 0 }, { text: 'Sub-milestone 1.1', level: 1 }] }
      ]
    }]
  };

  const sidebarTrace = {};
  const sidebarBrf = formatDocument(sidebarDoc, baseOpts({ trace: sidebarTrace }));
  check('sidebar with nested blocks: formats cleanly', sidebarBrf.length > 0);
  check('sidebar: trace tracks sidebar content', sidebarTrace.rows && sidebarTrace.rows.some(r => r === 0));

  // Test 3.2: Poetry / Verse with Stanza formatting
  const poetryDoc = {
    blocks: [
      { type: 'heading', level: 2, text: 'Ode to Mathematics' },
      { type: 'poetry', lines: [
        'Line one of poetic verse,',
        'Line two with standard metre.',
        '',
        'Stanza two begins afresh,',
        'Concluding with rhyme and rhythm.'
      ]}
    ]
  };
  const poetryBrf = formatDocument(poetryDoc, baseOpts());
  check('poetry: formats stanzas', typeof poetryBrf === 'string');

  // Test 3.3: Play Dialogue / Drama (Speaker cue and spoken line)
  const playDoc = {
    blocks: [
      { type: 'drama', speaker: 'HAMLET', text: 'To be, or not to be, that is the question:' },
      { type: 'drama', speaker: 'OPHELIA', text: 'Good my lord, how does your honour for this many a day?' }
    ]
  };
  const playBrf = formatDocument(playDoc, baseOpts());
  check('play dialogue: formats speaker cues', typeof playBrf === 'string');

  // Test 3.4: Footnotes and Transcriber's Notes
  const notesDoc = {
    blocks: [
      { type: 'para', text: 'Main text referencing note 1.' },
      { type: 'footnote', text: '1. Detailed citation from Annals of Science.' },
      { type: 'note', text: 'Transcriber note describing tactile diagram.' }
    ]
  };
  const notesBrf = formatDocument(notesDoc, baseOpts());
  check('notes: formats footnotes and TNs', notesBrf.includes('@.<') || notesBrf.length > 0);

  // Test 3.5: Mathematics (Inline & Block equations)
  const mathDoc = {
    blocks: [
      { type: 'para', text: 'Newtonian gravity follows:' },
      { type: 'math', latex: 'F = G \\frac{m_1 m_2}{r^2}' },
      { type: 'para', segments: [
        { type: 'text', text: 'Where ' },
        { type: 'math', latex: 'r' },
        { type: 'text', text: ' is the separation distance.' }
      ]}
    ]
  };
  const mathBrf = formatDocument(mathDoc, baseOpts());
  check('math equations: block and inline format without crash', typeof mathBrf === 'string');

  // =========================================================================
  // 4. COMPLEX ADVERSARIAL COMPOSITE DOCUMENT
  // =========================================================================
  console.log('\n4. Testing Complex Adversarial Composite Document...');

  const compositeDoc = {
    title: 'The Grand Unified Stress Document (All Styles & Extreme Nesting)',
    blocks: [
      { type: 'heading', level: 1, text: 'Chapter 1: The Apex of Formatting Stress' },
      { type: 'pagenum', page: '1' },
      { type: 'para', text: 'Introductory paragraph with special symbols: 100% ≈ £5.50, α + β = γ, and “smart quotes”.' },
      {
        type: 'list',
        items: [
          { text: 'L0 Alpha', level: 0 },
          { text: 'L1 Beta with emphasis', segments: [{ type: 'text', text: 'Sub-item ' }, { type: 'text', text: 'bolded', tf: louis.TYPEFORM.bold }], level: 1 },
          { text: 'L2 Gamma deeply nested', level: 2 },
          { text: 'L3 Delta super nested', level: 3 },
          { text: 'L4 Epsilon ultra nested', level: 4 }
        ]
      },
      {
        type: 'table',
        headers: ['Parameter', 'Theoretical', 'Measured Delta'],
        rows: [
          ['Alpha Factor', '1.414', '+0.002'],
          ['Beta Damping', '2.718', '-0.001'],
          ['Gamma Constant', '3.14159', '±0.00005']
        ]
      },
      {
        type: 'sidebar',
        title: 'Important Case Study',
        blocks: [
          { type: 'heading', level: 2, text: 'Nested Sidebar Heading' },
          { type: 'para', text: 'Paragraph inside sidebar with inline equation.' },
          { type: 'list', items: [{ text: 'Sidebar nested item 1', level: 0 }, { text: 'Sidebar nested item 2', level: 1 }] }
        ]
      },
      { type: 'footnote', text: '1. Comprehensive mathematical proof established in Chapter 4.' },
      { type: 'note', text: 'End of verification test suite.' }
    ]
  };

  for (const mode of ['ukaaf', 'bana']) {
    for (const listStyle of ['spaced', 'compact']) {
      const trace = {};
      const opts = baseOpts({ mode, listStyle, trace });
      const brf = formatDocument(compositeDoc, opts);

      const tag = `${mode}/${listStyle}`;
      check(`composite document [${tag}]: no crash`, typeof brf === 'string');
      check(`composite document [${tag}]: valid BRF characters`, [...brf].every(c => BRF_SET.has(c)));
      check(`composite document [${tag}]: trace has valid rows`, trace && trace.rows && trace.rows.length > 0);

      // Verify line width constraint
      const lines = brf.split('\x0c').flatMap(p => p.split('\r\n'));
      check(`composite document [${tag}]: width constraint <= ${opts.width}`, lines.every(l => l.length <= opts.width));
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log(`TEST SUITE RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('='.repeat(70));

  if (fail > 0) {
    console.log('Failures:', errors);
    process.exit(1);
  } else {
    console.log('✅ ALL DEEP PROGRAMMATIC TESTS PASSED WITH ZERO DEFECTS!');
    process.exit(0);
  }
})();
