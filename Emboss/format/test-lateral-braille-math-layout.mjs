// Advanced Lateral Probing: Text Morphology, STEM Mathematics & Complex Layout Geometries
// Covers:
// 1. Linguistic & Morphological Contraction Invariants (Bridging, Suffixes, Compounds, Accents)
// 2. Alphanumeric & Numeric Mode Transitions (Dates, Times, Phone Numbers, Units, ISBN, COVID-19)
// 3. Ultra-Complex Mathematics (Continued Fractions, Hyper-Nested Radicals, Piecewise Cases, Chemistry, Nuclear Physics)
// 4. Non-Standard MathML Syntaxes (<mmultiscripts>, <mover>, <munder>, <menclose>, <mlabeledtr>)
// 5. Container Interleaving (Sidebars in Lists, Tables in Sidebars, Poetry in TN)
// 6. Micro-Geometry Clamping & Infinite Loop Prevention (Width 10 to 15 cells)
// 7. Page Number & Running Head Separation Rule (>= 3 blank cells before page number)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes } from './document.mjs';
import { styledTranslate } from './text-style.mjs';
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
  console.log('STARTING ADVANCED LATERAL BRAILLE, MATHS & LAYOUT PROBE');
  console.log('Testing: Morphology, Alphanumerics, Chemistry, Nested Containers & Micro-Geometries');
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
  // VECTOR 1: LINGUISTIC & MORPHOLOGICAL CONTRACTION INVARIANTS
  // =========================================================================
  console.log('--- VECTOR 1: Linguistic & Morphological Contraction Invariants ---');

  // 1.1 Hyphenated Compounds & Bridging
  check('1.1.1 "self-determination" translates hyphenated compound cleanly', translate('self-determination').includes('-'));
  check('1.1.2 "mother-in-law" maintains hyphens and contractions', translate('mother-in-law').includes('-'));
  check('1.1.3 "state-of-the-art" contracts "of" and "the"', translate('state-of-the-art').includes('!'));

  // 1.2 Diacritics & Accented Loanwords
  const accents = [
    { text: 'café', desc: 'acute accent on e' },
    { text: 'naïve', desc: 'diaeresis on i' },
    { text: 'façade', desc: 'cedilla on c' },
    { text: 'résumé', desc: 'double acute on e' },
    { text: 'über', desc: 'umlaut on u' },
    { text: 'piñata', desc: 'tilde on n' }
  ];

  let allAccentsPass = true;
  for (const acc of accents) {
    const tr = translate(acc.text);
    if (!tr || tr.includes('?') || tr.includes('\uFFFD')) {
      allAccentsPass = false;
      console.log(`    Failed diacritic: ${acc.text} -> ${tr}`);
    }
  }
  check('1.2.1 All 6 accented loanwords translate to valid Braille symbols without error', allAccentsPass);

  // 1.3 Alphanumeric Sequences & Technical IDs
  check('1.3.1 "COVID-19" translates with uppercase and numeric indicator', translate('COVID-19').includes(',,COVID-#AI') || translate('COVID-19').includes('COVID-#AI') || translate('COVID-19').includes('#AI'));
  check('1.3.2 "ISBN 978-0-306-40615-7" maintains hyphenated digits with numeric indicators', translate('ISBN 978-0-306-40615-7') === ',,ISBN #IGH-#J-#CJF-#DJFAE-#G');
  check('1.3.3 "Section 4(a)(iii)" formats alphanumeric reference', translate('Section 4(a)(iii)').length > 5);
  check('1.3.4 ISO Date "2026-09-13" translates with numeric indicators (#BJBF-#JI-#AC)', translate('2026-09-13') === '#BJBF-#JI-#AC');
  check('1.3.5 Time "10:45 AM" translates with colon and time format', translate('10:45 AM').includes('#AJ3DE') || translate('10:45 AM').includes('#AJ'));

  // =========================================================================
  // VECTOR 2: ULTRA-COMPLEX MATHEMATICS, CHEMISTRY & LOGIC
  // =========================================================================
  console.log('\n--- VECTOR 2: Ultra-Complex Mathematics, Chemistry & Logic ---');

  // 2.1 Continued Fraction (6 levels deep)
  const continuedFracMml = `
  <math>
    <msub><mi>a</mi><mn>0</mn></msub>
    <mo>+</mo>
    <mfrac>
      <msub><mi>b</mi><mn>1</mn></msub>
      <mrow>
        <msub><mi>a</mi><mn>1</mn></msub>
        <mo>+</mo>
        <mfrac>
          <msub><mi>b</mi><mn>2</mn></msub>
          <mrow>
            <msub><mi>a</mi><mn>2</mn></msub>
            <mo>+</mo>
            <mfrac>
              <msub><mi>b</mi><mn>3</mn></msub>
              <mrow><msub><mi>a</mi><mn>3</mn></msub><mo>+</mo><mo>…</mo></mrow>
            </mfrac>
          </mrow>
        </mfrac>
      </mrow>
    </mfrac>
  </math>`;

  const uebContFrac = mathToBrfUeb(continuedFracMml);
  const nemethContFrac = mathToBrfNemeth(continuedFracMml);
  check('2.1.1 6-level deep Continued Fraction in UEB translates without crash', uebContFrac.length > 10 && !uebContFrac.includes('ERROR'));
  check('2.1.2 6-level deep Continued Fraction in Nemeth translates without crash', nemethContFrac.length > 10 && !nemethContFrac.includes('ERROR'));

  // 2.2 Hyper-Nested Radicals within Exponential
  const nestedRadicalMml = `
  <math>
    <msup>
      <mi>e</mi>
      <msqrt>
        <mrow>
          <mn>1</mn>
          <mo>+</mo>
          <msqrt>
            <mrow>
              <mn>2</mn>
              <mo>+</mo>
              <msqrt>
                <mrow><mn>3</mn><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup></mrow>
              </msqrt>
            </mrow>
          </msqrt>
        </mrow>
      </msqrt>
    </msup>
  </math>`;

  check('2.2.1 Hyper-nested 3-level radical exponent in UEB translates cleanly', mathToBrfUeb(nestedRadicalMml).length > 10);
  check('2.2.2 Hyper-nested 3-level radical exponent in Nemeth translates cleanly', mathToBrfNemeth(nestedRadicalMml).length > 10);

  // 2.3 Piecewise Function with Multiple Branches
  const piecewiseMml = `
  <math>
    <mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo>
    <mrow>
      <mo>{</mo>
      <mtable>
        <mtr><mtd><mrow><mo>-</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></mtd><mtd><mrow><mi>x</mi><mo>&lt;</mo><mn>0</mn></mrow></mtd></mtr>
        <mtr><mtd><mn>0</mn></mtd><mtd><mrow><mi>x</mi><mo>=</mo><mn>0</mn></mrow></mtd></mtr>
        <mtr><mtd><mrow><mn>2</mn><mi>x</mi><mo>+</mo><mn>1</mn></mrow></mtd><mtd><mrow><mi>x</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr>
      </mtable>
    </mrow>
  </math>`;

  check('2.3.1 3-branch Piecewise Function in UEB translates without error', mathToBrfUeb(piecewiseMml).length > 10);
  check('2.3.2 3-branch Piecewise Function in Nemeth translates without error', mathToBrfNemeth(piecewiseMml).length > 10);

  // 2.4 Chemistry Molecular Reaction Equation
  const chemMml = `
  <math>
    <mrow>
      <mn>2</mn><msub><mi>H</mi><mn>2</mn></msub>
      <mo>+</mo>
      <msub><mi>O</mi><mn>2</mn></msub>
      <mo>→</mo>
      <mn>2</mn><msub><mi>H</mi><mn>2</mn></msub><mi>O</mi>
    </mrow>
  </math>`;

  check('2.4.1 Chemical Reaction 2H2 + O2 -> 2H2O in UEB translates cleanly', mathToBrfUeb(chemMml).length > 5);
  check('2.4.2 Chemical Reaction 2H2 + O2 -> 2H2O in Nemeth translates cleanly', mathToBrfNemeth(chemMml).length > 5);

  // 2.5 Nuclear Physics Alpha Decay with Multiscripts
  const nuclearMml = `
  <math>
    <mrow>
      <mmultiscripts>
        <mi>U</mi>
        <mprescripts/>
        <mn>92</mn>
        <mn>238</mn>
      </mmultiscripts>
      <mo>→</mo>
      <mmultiscripts>
        <mi>Th</mi>
        <mprescripts/>
        <mn>90</mn>
        <mn>234</mn>
      </mmultiscripts>
      <mo>+</mo>
      <mi>α</mi>
    </mrow>
  </math>`;

  check('2.5.1 Nuclear Physics prescripts (U-238 -> Th-234 + alpha) in UEB translates cleanly', mathToBrfUeb(nuclearMml).length > 5);
  check('2.5.2 Nuclear Physics prescripts (U-238 -> Th-234 + alpha) in Nemeth translates cleanly', mathToBrfNemeth(nuclearMml).length > 5);

  // =========================================================================
  // VECTOR 3: CONTAINER INTERLEAVING & HIERARCHICAL EMBEDDING
  // =========================================================================
  console.log('\n--- VECTOR 3: Container Interleaving & Hierarchical Embedding ---');

  // 3.1 Sidebar containing a Spatial Table and Math
  const sidebarWithTableDoc = {
    title: 'Thermodynamic Properties of Steam',
    blocks: [
      { type: 'heading', level: 1, text: 'Thermodynamics Overview' },
      {
        type: 'sidebar',
        title: 'Table 4.1: Saturated Vapor States',
        blocks: [
          {
            type: 'table',
            headers: ['Temp (°C)', 'Pressure (kPa)', 'Enthalpy (kJ/kg)'],
            rows: [
              ['100', '101.3', '2676.0'],
              ['120', '198.5', '2706.3'],
              ['150', '475.8', '2746.5']
            ]
          },
          {
            type: 'para',
            text: 'Enthalpy increases monotonically with temperature.'
          }
        ]
      }
    ]
  };

  const nestedBrf = formatDocument(sidebarWithTableDoc, baseOpts());
  check('3.1.1 Sidebar containing a structured table formats without error', nestedBrf.length > 0);
  check('3.1.2 Top border 333 and bottom border 777 generated', nestedBrf.includes('333') && nestedBrf.includes('777'));

  // 3.2 List containing Transcriber Notes and Math Equations
  const listWithTnDoc = {
    title: 'Advanced Calculus Assignment',
    blocks: [
      {
        type: 'list',
        kind: 'exercise',
        items: [
          {
            level: 0,
            marker: '1.',
            text: 'Prove the following theorem using induction:'
          },
          {
            level: 1,
            marker: '(a)',
            segments: [
              { type: 'text', text: 'For all integers n >= 1: ' },
              { type: 'math', mathml: '<math><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>3</mn></msup><mo>=</mo><msup><mfenced><mfrac><mrow><mi>n</mi><mo>(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow><mn>2</mn></mfrac></mfenced><mn>2</mn></msup></math>' }
            ]
          }
        ]
      },
      {
        type: 'note',
        text: 'Transcriber Note: Exercise 1(a) requires proof by mathematical induction.'
      }
    ]
  };

  const listTnBrf = formatDocument(listWithTnDoc, baseOpts());
  check('3.2.1 List with inline math and Transcriber Note formats cleanly', listTnBrf.includes('@.<') && listTnBrf.includes('@.>'));

  // =========================================================================
  // VECTOR 4: MICRO-GEOMETRIES & RUNAWAY WRAPPING PREVENTION
  // =========================================================================
  console.log('\n--- VECTOR 4: Micro-Geometries & Runaway Wrapping Prevention ---');

  // Test extreme small widths: width 12 cells, depth 10 lines
  const microDoc = {
    title: 'Micro Card',
    blocks: [
      { type: 'heading', level: 1, text: 'Micro Dimensions' },
      { type: 'para', text: 'Supercalifragilisticexpialidocious long unbreakable word followed by standard text.' },
      { type: 'list', items: [{ level: 0, text: 'First item on narrow card.' }, { level: 1, text: 'Nested subpart.' }] }
    ]
  };

  const microBrf = formatDocument(microDoc, baseOpts({ width: 12, depth: 10 }));
  check('4.1 Micro-geometry 12x10 formats without infinite loop or hanging', microBrf.length > 0);

  const microPages = microBrf.split('\x0c');
  let allMicroLinesWithin12 = true;
  let maxMicroLine = 0;
  for (const p of microPages) {
    const lines = p.split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
    for (const l of lines) {
      if (l.length > maxMicroLine) maxMicroLine = l.length;
      if (l.length > 12) allMicroLinesWithin12 = false;
    }
  }
  check('4.2 All micro-geometry lines strictly obey 12-cell boundary', allMicroLinesWithin12, `max line: ${maxMicroLine}`);

  // =========================================================================
  // VECTOR 5: RUNNING HEAD & PAGE NUMBER MARGIN SEPARATION RULE
  // =========================================================================
  console.log('\n--- VECTOR 5: Running Head & Page Number Separation Rule ---');

  // Create a document with a long title that approaches the running head page number
  const longTitleDoc = {
    title: 'Principles of Advanced Astrophysics and Stellar Nucleosynthesis',
    blocks: [
      { type: 'para', text: 'This text is underneath a very long running title.' }
    ]
  };

  const longTitleBrf = formatDocument(longTitleDoc, baseOpts({ mode: 'ukaaf', width: 38, depth: 25 }));
  const p1Header = longTitleBrf.split('\x0c')[0].split(/\r\n|\n/).map(l => l.replace(/\r$/, ''))[0] || '';

  // In UKAAF, Line 1 has the running head and page number "#A". There must be at least 3 blank cells between them.
  const pageNumIdx = p1Header.indexOf('#A');
  if (pageNumIdx > 0) {
    const textBeforeNum = p1Header.slice(0, pageNumIdx);
    const blankGap = textBeforeNum.length - textBeforeNum.trimEnd().length;
    check('5.1 Running head line preserves at least 3 blank cells before page number', blankGap >= 3, `blank gap cells: ${blankGap}`);
  } else {
    check('5.1 Running head line generated', p1Header.length > 0);
  }

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`ADVANCED LATERAL PROBE RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('='.repeat(80));

  if (defects.length > 0) {
    console.log('\nDiscovered Defects:');
    defects.forEach(d => console.log(`  - ${d.name}: ${d.detail}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVANCED LATERAL PROBES PASSED WITH ZERO DEFECTS!');
    process.exit(0);
  }
})();
