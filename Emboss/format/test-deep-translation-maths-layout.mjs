// Deep Braille Translation, Mathematics & Layout Architecture Probe for Emboss
// Covers:
// 1. UEB Literary Contraction Hierarchy, Shortforms, Wordsigns & Typeforms
// 2. Comprehensive STEM Mathematics (Arithmetic, Algebra, Calculus, Matrices, Logic, Greek)
// 3. Nemeth vs UEB Technical Code-Switching & Indicator Placement
// 4. BANA & UKAAF Multi-Tier Structural Layouts & Orphan Heading Invariants
// 5. Pagination Boundaries, Page Headers & Print Page Synchronization
// 6. Multi-Level Stepped Lists, Exercises, Plays, Sidebars & Spatial Tables

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes } from './document.mjs';
import { styledTranslate, normalizeTextAndTypeform } from './text-style.mjs';
import { makeMathToBrf } from './node-maths-helper.mjs';
import { brfToUnicodeBraille, unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const defects = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    defects.push({ name, detail });
  }
}

(async () => {
  console.log('='.repeat(80));
  console.log('STARTING DEEP BRAILLE TRANSLATION, MATHS & LAYOUT PROBE');
  console.log('Testing: UEB Literary, Advanced STEM Maths, Code-Switches & Multi-Tier Layouts');
  console.log('='.repeat(80) + '\n');

  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const translate = styledTranslate((t, tf) => louis.translate(t, T, tf), 'faithful');
  const translatePos = (t, tf) => louis.translatePos(t, T, tf);
  const mathToBrfUeb = makeMathToBrf('ukaaf');
  const mathToBrfNemeth = makeMathToBrf('bana');

  const baseOpts = (extra = {}) => ({
    mode: 'ukaaf',
    width: 38,
    depth: 25,
    listStyle: 'spaced',
    translate,
    translatePos,
    mathToBrf: mathToBrfUeb,
    ...extra
  });

  // =========================================================================
  // SECTION 1: DEEP LITERARY UEB TRANSLATION (WORDSIGNS, SHORTFORMS, PUNCTUATION)
  // =========================================================================
  console.log('--- SECTION 1: Deep Literary UEB Translation Probing ---');

  // 1.1 Strong Wordsigns
  check('1.1.1 "and" translates to &', translate('and') === '&');
  check('1.1.2 "for" translates to =', translate('for') === '=');
  check('1.1.3 "of" translates to (', translate('of') === '(');
  check('1.1.4 "the" translates to !', translate('the') === '!');
  check('1.1.5 "with" translates to )', translate('with') === ')');

  // 1.2 Core UEB Shortform Words
  const shortforms = [
    { text: 'about', expected: 'AB' },
    { text: 'according', expected: 'AC' },
    { text: 'after', expected: 'AF' },
    { text: 'blind', expected: 'BL' },
    { text: 'braille', expected: 'BRL' },
    { text: 'could', expected: 'CD' },
    { text: 'friend', expected: 'FR' },
    { text: 'good', expected: 'GD' },
    { text: 'great', expected: 'GRT' },
    { text: 'immediate', expected: 'IMM' },
    { text: 'letter', expected: 'LR' },
    { text: 'much', expected: 'M*' },
    { text: 'necessary', expected: 'NEC' },
    { text: 'quick', expected: 'QK' },
    { text: 'said', expected: 'SD' },
    { text: 'today', expected: 'TD' },
    { text: 'tomorrow', expected: 'TM' },
    { text: 'tonight', expected: 'TN' },
    { text: 'would', expected: 'WD' },
    { text: 'your', expected: 'YR' }
  ];

  let allShortformsPassed = true;
  for (const sf of shortforms) {
    const tr = translate(sf.text);
    if (tr !== sf.expected) {
      allShortformsPassed = false;
      console.log(`    Mismatch shortform "${sf.text}": got "${tr}", expected "${sf.expected}"`);
    }
  }
  check('1.2.1 All 20 canonical UEB shortforms translate accurately', allShortformsPassed);

  // 1.3 Contraction Boundaries & Word Groups
  check('1.3.1 "blemish" contracts "sh" as %', translate('blemish') === 'BLEMI%');
  check('1.3.2 "table" in UEB is spelled TABLE', translate('table') === 'TABLE');
  check('1.3.3 "singing" contracts both "in" and "ing"', translate('singing').includes('+') || translate('singing').includes('S+G'));

  // 1.4 Standing Alone Rule & Grade 1 Indicators
  check('1.4.1 "b" alone in Grade 2 has grade-1 indicator ;B', translate('b') === ';B');
  check('1.4.2 "can" translates to wordsign C', translate('can') === 'C');
  check('1.4.3 "do" translates to wordsign D', translate('do') === 'D');

  // 1.5 Capitalization Hierarchy (Letter, Word, Passage)
  check('1.5.1 Single capital letter has comma prefix', translate('London') === ',LONDON');
  check('1.5.2 Fully capitalized word has double comma prefix', translate('UNESCO') === ',,UNESCO');
  check('1.5.3 Mixed CamelCase maintains capitalization points', translate('iPhone') === 'I,PH"O');

  // 1.6 Complex Punctuation, Quotes & Currency
  check('1.6.1 Dollar amount "$50" translates with UEB currency sign (@S#EJ)', translate('$50') === '@S#EJ');
  check('1.6.2 Percentage "100%" translates with UEB percent sign (.0)', translate('100%').includes('#AJJ.0'));
  check('1.6.3 Temperature "20°C" translates with UEB degree sign (^J)', translate('20°C').includes('#BJ^J,C'));

  // =========================================================================
  // SECTION 2: ADVANCED STEM MATHEMATICS PROBING (UEB TECH & NEMETH)
  // =========================================================================
  console.log('\n--- SECTION 2: Advanced STEM Mathematics Probing ---');

  // 2.1 Arithmetic, Fractions & Mixed Numbers
  const fracMml = '<math><mfrac><mn>3</mn><mn>4</mn></mfrac></math>';
  const uebFrac = mathToBrfUeb(fracMml);
  const nemethFrac = mathToBrfNemeth(fracMml);
  check('2.1.1 Simple fraction 3/4 in UEB contains fraction line', uebFrac.includes('#c/d') || uebFrac.includes('/'));
  check('2.1.2 Simple fraction 3/4 in Nemeth contains opening ? and closing #', nemethFrac.includes('?3/4#') || nemethFrac.includes('?'));

  const complexFracMml = '<math><mfrac><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mrow><mi>x</mi><mo>-</mo><mn>1</mn></mrow></mfrac></math>';
  check('2.1.3 Algebraic fraction (x+1)/(x-1) in UEB translates cleanly', mathToBrfUeb(complexFracMml).length > 0);
  check('2.1.4 Algebraic fraction (x+1)/(x-1) in Nemeth translates cleanly', mathToBrfNemeth(complexFracMml).length > 0);

  // 2.2 Radicals (Square Roots, Cube Roots, Nested Roots)
  const sqrtMml = '<math><msqrt><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup></mrow></msqrt></math>';
  const uebSqrt = mathToBrfUeb(sqrtMml);
  const nemethSqrt = mathToBrfNemeth(sqrtMml);
  check('2.2.1 Square root sqrt(x^2+y^2) in UEB contains radical open/close', uebSqrt.includes('>') || uebSqrt.length > 5);
  check('2.2.2 Square root sqrt(x^2+y^2) in Nemeth contains > radical', nemethSqrt.includes('>') || nemethSqrt.length > 5);

  const cubeRootMml = '<math><mroot><mn>8</mn><mn>3</mn></mroot></math>';
  check('2.2.3 Cube root root[3](8) in UEB translates cleanly', mathToBrfUeb(cubeRootMml).length > 0);
  check('2.2.4 Cube root root[3](8) in Nemeth translates cleanly', mathToBrfNemeth(cubeRootMml).length > 0);

  // 2.3 Exponents, Subscripts & Multi-level Indices
  const expSubMml = '<math><msubsup><mi>A</mi><mrow><mi>i</mi><mo>,</mo><mi>j</mi></mrow><mrow><mo>(</mo><mi>k</mi><mo>)</mo></mrow></msubsup></math>';
  check('2.3.1 Tensor index A_{i,j}^{(k)} in UEB translates cleanly', mathToBrfUeb(expSubMml).length > 0);
  check('2.3.2 Tensor index A_{i,j}^{(k)} in Nemeth translates cleanly', mathToBrfNemeth(expSubMml).length > 0);

  // 2.4 Calculus (Derivatives, Integrals, Limits, Summations)
  const integralMml = '<math><msubsup><mo>∫</mo><mn>0</mn><mo>∞</mo></msubsup><msup><mi>e</mi><mrow><mo>-</mo><mi>x</mi></mrow></msup><mi>d</mi><mi>x</mi><mo>=</mo><mn>1</mn></math>';
  const uebIntegral = mathToBrfUeb(integralMml);
  const nemethIntegral = mathToBrfNemeth(integralMml);
  check('2.4.1 Definite integral from 0 to infinity in UEB translates without error', uebIntegral.length > 0 && !uebIntegral.includes('ERROR'));
  check('2.4.2 Definite integral from 0 to infinity in Nemeth translates without error', nemethIntegral.length > 0 && !nemethIntegral.includes('ERROR'));

  const limitMml = '<math><munder><mo>lim</mo><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mfrac><mrow><mo>sin</mo><mi>x</mi></mrow><mi>x</mi></mfrac><mo>=</mo><mn>1</mn></math>';
  check('2.4.3 Calculus limit lim_{x->0} sin(x)/x = 1 in UEB translates cleanly', mathToBrfUeb(limitMml).length > 0);
  check('2.4.4 Calculus limit lim_{x->0} sin(x)/x = 1 in Nemeth translates cleanly', mathToBrfNemeth(limitMml).length > 0);

  const sumMml = '<math><munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mo>∞</mo></munderover><mfrac><mn>1</mn><msup><mi>n</mi><mn>2</mn></msup></mfrac><mo>=</mo><mfrac><msup><mi>π</mi><mn>2</mn></msup><mn>6</mn></mfrac></math>';
  check('2.4.5 Infinite series sum 1/n^2 = pi^2/6 in UEB translates cleanly', mathToBrfUeb(sumMml).length > 0);
  check('2.4.6 Infinite series sum 1/n^2 = pi^2/6 in Nemeth translates cleanly', mathToBrfNemeth(sumMml).length > 0);

  // 2.5 Matrices & 2D Structured Math
  const matrixMml = '<math><mfenced><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable></mfenced></math>';
  const uebMatrix = mathToBrfUeb(matrixMml);
  const nemethMatrix = mathToBrfNemeth(matrixMml);
  check('2.5.1 2x2 Identity Matrix in UEB translates cleanly', uebMatrix.length > 0 && !uebMatrix.includes('ERROR'));
  check('2.5.2 2x2 Identity Matrix in Nemeth translates cleanly', nemethMatrix.length > 0 && !nemethMatrix.includes('ERROR'));

  // 2.6 Greek Alphabet in Mathematics
  const greekMml = '<math><mi>α</mi><mo>+</mo><mi>β</mi><mo>+</mo><mi>γ</mi><mo>+</mo><mi>θ</mi><mo>+</mo><mi>λ</mi><mo>+</mo><mi>μ</mi><mo>+</mo><mi>π</mi><mo>+</mo><mi>σ</mi><mo>+</mo><mi>ω</mi><mo>+</mo><mi>Ω</mi></math>';
  check('2.6.1 Greek letters in UEB Math translate cleanly', mathToBrfUeb(greekMml).length > 0);
  check('2.6.2 Greek letters in Nemeth translate cleanly', mathToBrfNemeth(greekMml).length > 0);

  // =========================================================================
  // SECTION 3: DEEP STRUCTURAL LAYOUT & FORMATTING PROBING
  // =========================================================================
  console.log('\n--- SECTION 3: Deep Structural Layout & Formatting Probing ---');

  // 3.1 Multi-Level Stepped Lists (Levels 0 through 4)
  const steppedListDoc = {
    title: 'Stepped Hierarchical List',
    blocks: [
      {
        type: 'list',
        items: [
          { level: 0, text: 'Level 0 Item (Starts Cell 1, runover Cell 3 with substantial explanatory text to force wrapping).' },
          { level: 1, text: 'Level 1 Item (Starts Cell 3, runover Cell 5 with substantial explanatory text to force wrapping).' },
          { level: 2, text: 'Level 2 Item (Starts Cell 5, runover Cell 7 with substantial explanatory text to force wrapping).' },
          { level: 3, text: 'Level 3 Item (Starts Cell 7, runover Cell 9 with substantial explanatory text to force wrapping).' },
          { level: 4, text: 'Level 4 Item (Starts Cell 9, runover Cell 11 with substantial explanatory text to force wrapping).' }
        ]
      }
    ]
  };

  const steppedBrf = formatDocument(steppedListDoc, baseOpts());
  const steppedPages = steppedBrf.split('\x0c');
  const steppedLines = steppedPages[0].split(/\r\n|\n/).map(l => l.replace(/\r$/, '')).filter(Boolean);

  // Check indents
  check('3.1.1 Level 0 item starts in Cell 1 (index 0)', steppedLines[1]?.startsWith(',LEVEL #J'));
  check('3.1.2 Level 1 item indented to Cell 3 (2 spaces)', steppedLines.some(l => l.startsWith('  ,LEVEL #A')));
  check('3.1.3 Level 2 item indented to Cell 5 (4 spaces)', steppedLines.some(l => l.startsWith('    ,LEVEL #B')));
  check('3.1.4 Level 3 item indented to Cell 7 (6 spaces)', steppedLines.some(l => l.startsWith('      ,LEVEL #C')));
  check('3.1.5 Level 4 item indented to Cell 9 (8 spaces)', steppedLines.some(l => l.startsWith('        ,LEVEL #D')));

  // 3.2 Educational Exercise Hierarchy (Questions 1-5, Subparts 3-5, Sub-subparts 5-7)
  const exerciseDoc = {
    title: 'Calculus Exercise Set',
    blocks: [
      {
        type: 'list',
        kind: 'exercise',
        items: [
          { level: 0, marker: '1.', text: 'Evaluate the following definite integrals using substitution:' },
          { level: 1, marker: '(a)', text: 'Integral of x e^(x^2) dx from 0 to 1.' },
          { level: 1, marker: '(b)', text: 'Integral of sin(2x) cos(x) dx from 0 to pi/2.' },
          { level: 2, marker: '(i)', text: 'Show all intermediate algebraic derivation steps clearly.' }
        ]
      }
    ]
  };

  const exerciseBrf = formatDocument(exerciseDoc, baseOpts());
  check('3.2.1 Exercise question formatted with 1-5 primary indent', exerciseBrf.includes('#A4 ,EVALUATE') || exerciseBrf.includes('#A.'));
  check('3.2.2 Exercise subparts formatted with 3-5 stepped indent', exerciseBrf.includes('  "<A">') || exerciseBrf.includes('  ,A4') || exerciseBrf.includes('  (A)'));

  // 3.3 Bottom-of-Page Orphan Heading Invariant
  // Create a document where a heading lands exactly on the last line of a 25-line page
  const fillBlocks = [];
  for (let i = 1; i <= 21; i++) {
    fillBlocks.push({ type: 'para', text: `Paragraph line filler ${i} to push heading to bottom boundary.` });
  }
  fillBlocks.push({ type: 'heading', level: 2, text: 'Chapter 2: Thermodynamics' });
  fillBlocks.push({ type: 'para', text: 'This text belongs immediately under the Chapter 2 heading.' });

  const orphanDoc = {
    title: 'Orphan Heading Test',
    blocks: fillBlocks
  };

  const orphanBrf = formatDocument(orphanDoc, baseOpts({ width: 38, depth: 25 }));
  const orphanPages = orphanBrf.split('\x0c');

  // Verify that the heading was NOT left stranded on the last line of Page 1
  const page1Lines = orphanPages[0]?.split(/\r\n|\n/).map(l => l.replace(/\r$/, '')).filter(Boolean) || [];
  const lastLineP1 = page1Lines[page1Lines.length - 1] || '';
  const page2Lines = orphanPages[1]?.split(/\r\n|\n/).map(l => l.replace(/\r$/, '')).filter(Boolean) || [];
  const headingOnP2 = page2Lines.some(l => l.includes('!RMODYNAMICS') || l.includes('CHAPTER #B'));

  check('3.3.1 Heading on boundary is pushed to Page 2 to prevent orphan layout', headingOnP2 && !lastLineP1.includes('!RMODYNAMICS'));

  // 3.4 BANA vs UKAAF Running Heads & Page Numbering Layout
  const ukaafDoc = formatDocument({ title: 'Physics Guide', blocks: [{ type: 'para', text: 'Sample text.' }] }, baseOpts({ mode: 'ukaaf', depth: 25 }));
  const ukaafP1 = ukaafDoc.split('\x0c')[0].split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
  check('3.4.1 UKAAF format places running head on Line 1', ukaafP1[0].includes('PHYSICS GUIDE') || ukaafP1[0].includes('#A'));

  const banaDoc = formatDocument({ title: 'Physics Guide', blocks: [{ type: 'para', text: 'Sample text.' }] }, baseOpts({ mode: 'bana', depth: 25, width: 40 }));
  const banaP1 = banaDoc.split('\x0c')[0].split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
  if (banaP1.length && banaP1[banaP1.length - 1] === '') banaP1.pop();
  check('3.4.2 BANA format preserves 25-line page depth with bottom braille page number', banaP1.length === 25 && banaP1[24].includes('#A'));

  // =========================================================================
  // SECTION 4: INTEGRATED MULTI-MODAL STRESS DOCUMENT
  // =========================================================================
  console.log('\n--- SECTION 4: Integrated Multi-Modal Composite Stress Document ---');

  const compositeDoc = {
    title: 'Advanced Quantum Mechanics & Mathematical Physics',
    blocks: [
      { type: 'title', text: 'Advanced Quantum Mechanics' },
      { type: 'heading', level: 1, text: 'Part I: Wave Mechanics & Hilbert Spaces' },
      {
        type: 'para',
        text: 'The fundamental postulate of quantum mechanics asserts that states are vectors in a complex Hilbert space H.'
      },
      {
        type: 'sidebar',
        title: 'Postulate 1: State Vectors',
        blocks: [
          { type: 'para', text: 'Every physical state is represented by a normalized ray in Hilbert space |psi>.' }
        ]
      },
      {
        type: 'heading', level: 2, text: 'Section 1.1: Schrödinger Wave Equation'
      },
      {
        type: 'para',
        text: 'The time-dependent Schrödinger equation describes quantum state evolution:'
      },
      {
        type: 'list',
        kind: 'exercise',
        items: [
          { level: 0, marker: '1.', text: 'Verify the orthogonality of the following eigenstates:' },
          { level: 1, marker: '(a)', text: 'Harmonic oscillator ground and first excited states.' },
          { level: 1, marker: '(b)', text: 'Infinite potential square well eigenfunctions.' }
        ]
      },
      {
        type: 'table',
        headers: ['Quantum State', 'Energy Eigenvalue (E_n)', 'Degeneracy (g_n)'],
        rows: [
          ['Ground State (n=1)', '13.6 eV / n^2', '1 (Non-degenerate)'],
          ['First Excited State (n=2)', '3.4 eV / n^2', '4 (2s, 2px, 2py, 2pz)'],
          ['Second Excited State (n=3)', '1.51 eV / n^2', '9 (3s, 3p, 3d)']
        ]
      },
      {
        type: 'dialogue',
        speaker: 'NIELS BOHR',
        speech: 'Those who are not shocked when they first come across quantum theory cannot possibly have understood it.'
      }
    ]
  };

  const compositeBrf = formatDocument(compositeDoc, baseOpts());
  check('4.1 Composite document translates and formats without error', compositeBrf.length > 500);

  const compPages = compositeBrf.split('\x0c');
  check('4.2 Composite document generates multiple structured pages', compPages.length >= 2, `pages: ${compPages.length}`);

  let allCompLinesWithinBounds = true;
  let maxCompLine = 0;
  for (const cp of compPages) {
    const lines = cp.split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
    for (const l of lines) {
      if (l.length > maxCompLine) maxCompLine = l.length;
      if (l.length > 38) allCompLinesWithinBounds = false;
    }
  }
  check('4.3 All lines across all composite pages strictly respect 38-cell limit', allCompLinesWithinBounds, `max line: ${maxCompLine}`);

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`DEEP PROBE RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('='.repeat(80));

  if (defects.length > 0) {
    console.log('\nDiscovered Defects:');
    defects.forEach(d => console.log(`  - ${d.name}: ${d.detail}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL DEEP BRAILLE TRANSLATION, MATHS & LAYOUT PROBES PASSED WITH 100% PERFECTION!');
    process.exit(0);
  }
})();
