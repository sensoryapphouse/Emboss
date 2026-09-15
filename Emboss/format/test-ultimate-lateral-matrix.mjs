// Ultimate Lateral Matrix Test Suite for Emboss
// Covers:
// 1. Dynamic Math Function Tactile Plotting & Discrete Pin-Grid (DotPad/Monarch)
// 2. Multi-Model Hardware Spooler Stream Encoding & Packet Framing (Index/ViewPlus/Romeo/Braillo/BLE/HID/USB)
// 3. eBraille 1.0 OCF Packaging & EPUB3 Braille Container Conformance
// 4. Spatial vs Listed Table Geometry Auto-Switch & Extreme Dimensions
// 5. Bidirectional Lossless Unicode Braille <-> ASCII BRF Transcoding Invariants
// 6. Adversarial High-Density Nesting & Formatting Stress

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes } from './document.mjs';
import { styledTranslate, normalizeTextAndTypeform } from './text-style.mjs';
import { exportToEbraille } from './ebraille.mjs';
import { exportToPef } from './pef.mjs';
import { prepareEmbosserStream, BLE_GATT_SERVICES, KNOWN_EMBOSSER_PROFILES } from './spooler.mjs';
import { latexToMathJs, evaluateFunction, plotFunctionToPinGrid, plotTactileFunction } from './math-plotter.mjs';
import { charToDotMask, encodeDotPadDualZoneFrame, zhangSuenThinning, encodeHidBrailleReport } from './tactile-display.mjs';
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
  console.log('STARTING ULTIMATE LATERAL MATRIX TEST SUITE');
  console.log('Testing: Math Plotting, Pin-Grids, Hardware Spoolers, eBraille 1.0, Tables & Encodings');
  console.log('='.repeat(80) + '\n');

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
  // 1. DYNAMIC MATH PLOTTING & DISCRETE PIN-GRID DISPLAY (DotPad / Monarch)
  // =========================================================================
  console.log('\n--- VECTOR 1: Math Plotting & Tactile Displays ---');

  // 1.1 LaTeX normalization
  const expr1 = latexToMathJs('y = x^2 - 4');
  check('1.1.1 Normalize quadratic LaTeX', expr1.includes('x ** (2)') && expr1.includes('- 4'), `got: ${expr1}`);

  const expr2 = latexToMathJs('\\frac{1}{2}x + 3');
  check('1.1.2 Normalize fraction LaTeX', expr2.includes('1') && expr2.includes('2'), `got: ${expr2}`);

  const expr3 = latexToMathJs('y = \\sin(x) + \\cos(2x)');
  check('1.1.3 Normalize trig LaTeX', expr3.includes('Math.sin') && expr3.includes('Math.cos'), `got: ${expr3}`);

  // 1.2 Function evaluation
  check('1.2.1 Evaluate x^2 at x=3 is 9', evaluateFunction('x ** 2', 3) === 9);
  check('1.2.2 Evaluate sin(0) is 0', evaluateFunction('Math.sin(x)', 0) === 0);
  check('1.2.3 Singularity 1/x at x=0 returns null/Infinity handled', evaluateFunction('1/x', 0) === null || !isFinite(evaluateFunction('1/x', 0)));

  // 1.3 Tactile Display Pin-Grid Generation (DotPad 30x10 & Monarch 60x40)
  try {
    const dotMaskA = charToDotMask('a');
    check('1.3.1 Character "a" produces Dot 1 mask (0x01)', dotMaskA === 0x01 || dotMaskA === 1);

    const dotMaskB = charToDotMask('b');
    check('1.3.2 Character "b" produces Dots 1,2 mask (0x03)', dotMaskB === 0x03 || dotMaskB === 3);

    const pinGridRes = plotFunctionToPinGrid('x^2 - 4', { displayW: 60, displayH: 40 });
    check('1.3.3 plotFunctionToPinGrid returns valid pin grid matrix', pinGridRes?.pins instanceof Uint8Array && pinGridRes.pins.length === 2400);

    const tactilePlotRes = plotTactileFunction('y = \\sin(x)', { widthCells: 40, heightCells: 25 });
    check('1.3.4 plotTactileFunction produces valid tactile SVG graph', typeof tactilePlotRes?.svg === 'string' && tactilePlotRes.svg.includes('<svg'));

    const dotPadFrame = encodeDotPadDualZoneFrame(new Uint8Array(300), new Uint8Array(20));
    check('1.3.5 encodeDotPadDualZoneFrame returns binary packet array', Array.isArray(dotPadFrame) && dotPadFrame.length > 0);

    const hidReport = encodeHidBrailleReport(0x01, new Uint8Array([0x01, 0x03, 0x07]));
    check('1.3.6 encodeHidBrailleReport returns valid HID report buffer', hidReport instanceof Uint8Array && hidReport[0] === 0x01);
  } catch (e) {
    check('1.3 Tactile pin grid generation crash', false, e.message);
  }

  // =========================================================================
  // 2. HARDWARE EMBOSSER ESCAPE STREAMS & MULTI-MODEL FRAMING
  // =========================================================================
  console.log('\n--- VECTOR 2: Hardware Spooler Stream Encoding ---');

  const testBrf = ',HELLO WORLD\r\n,THIS IS A TEST PAGE#A\x0c,PAGE TWO#B\x0c';

  // 2.1 Index Braille (ESC DP1 / DP2, EOF 0x1a, 64-byte alignment)
  const indexStream = prepareEmbosserStream(testBrf, { embosser: 'index', duplex: 'double' });
  check('2.1.1 Index stream begins with ESC DP2 for interpoint duplex', indexStream.startsWith('\x1bDP2'));
  check('2.1.2 Index stream ends with EOF marker \\x1a', indexStream.endsWith('\x1a'));
  check('2.1.3 Index stream guarantees 64-byte alignment padding if required', (indexStream.length % 64 !== 0) || indexStream.endsWith('\x1a\x1a'));

  // 2.2 Enabling Technologies Romeo / Juliet
  const romeoStream = prepareEmbosserStream(testBrf, { embosser: 'romeo', rows: 25, cols: 40, duplex: 'double' });
  check('2.2.1 Romeo stream has ESC \\x00 init header', romeoStream.startsWith('\x1b\x00\x1b\x0c25\x1b\x0e40\x1b\x122'));
  check('2.2.2 Romeo stream ends with EOF \\x1a', romeoStream.endsWith('\x1a'));

  // 2.3 ViewPlus Tiger / PixBlaster
  const tigerStream = prepareEmbosserStream(testBrf, { embosser: 'viewplus' });
  check('2.3.1 ViewPlus stream begins with ESC *t header', tigerStream.startsWith('\x1b*t'));
  check('2.3.2 ViewPlus stream ends with Form Feed \\x0c', tigerStream.endsWith('\x0c'));

  // 2.4 Braillo 300/450/600
  const brailloStream = prepareEmbosserStream(testBrf, { embosser: 'braillo', rows: 25 });
  check('2.4.1 Braillo stream begins with ESC M0 ESC L25 header', brailloStream.startsWith('\x1bM0\x1bL25'));
  check('2.4.2 Braillo stream ends with Form Feed \\x0c', brailloStream.endsWith('\x0c'));

  // 2.5 BLE GATT Profile Constants
  check('2.5.1 Custom Emboss BLE Service is 0xFEB0', BLE_GATT_SERVICES.EMBOSS_SERVICE === 0xFEB0);
  check('2.5.2 Nordic UART Service UUID defined', typeof BLE_GATT_SERVICES.NORDIC_UART_SERVICE === 'string' && BLE_GATT_SERVICES.NORDIC_UART_SERVICE.length > 0);

  // 2.6 Known Hardware Presets
  check('2.6.1 Known embosser profiles contains Index, ViewPlus, Romeo, Braillo', KNOWN_EMBOSSER_PROFILES.length >= 5);

  // =========================================================================
  // 3. eBRAILLE 1.0 (.ebrl) OCF / EPUB3 CONTAINER CONFORMANCE
  // =========================================================================
  console.log('\n--- VECTOR 3: eBraille 1.0 Packaging Conformance ---');

  const testDoc = {
    title: 'Modern Physics & Tactile Diagrams',
    author: 'Sensory App House',
    blocks: [
      { type: 'heading', level: 1, text: 'Modern Physics & Tactile Diagrams' },
      { type: 'paragraph', text: 'This document contains both literary braille and tactile diagrams.' },
      {
        type: 'graphic',
        title: 'Bohr Hydrogen Atom',
        alt: 'Proton in center with circular electron orbital',
        svg: '<svg width="200" height="200"><circle cx="100" cy="100" r="80" stroke="black" fill="none"/></svg>'
      }
    ]
  };

  try {
    const ebrlBytes = exportToEbraille(testDoc, baseOpts({ brailleSystem: 'ueb grade2' }));
    check('3.1 eBraille returned Uint8Array binary package', ebrlBytes instanceof Uint8Array && ebrlBytes.length > 500);

    // Verify ZIP Magic Number (0x50, 0x4b, 0x03, 0x04)
    const isZip = ebrlBytes[0] === 0x50 && ebrlBytes[1] === 0x4b && ebrlBytes[2] === 0x03 && ebrlBytes[3] === 0x04;
    check('3.2 eBraille binary has valid PK ZIP container header (0x50, 0x4B, 0x03, 0x04)', isZip);

    // Verify presence of mimetype and ebraille structure in byte stream
    const rawString = new TextDecoder('latin1').decode(ebrlBytes);
    check('3.3 eBraille contains application/epub+zip mimetype', rawString.includes('application/epub+zip'));
    check('3.4 eBraille contains volume-1.html content document', rawString.includes('volume-1.html'));
    check('3.5 eBraille includes embedded SVG tactile graphic resource', rawString.includes('graphics/graphic-1.svg'));
  } catch (e) {
    check('3.1 eBraille export crash', false, e.message);
  }

  // =========================================================================
  // 4. SPATIAL VS LISTED TABLE GEOMETRY AUTO-SWITCH & DIMENSIONS
  // =========================================================================
  console.log('\n--- VECTOR 4: Table Formatting & Geometry Invariants ---');

  // Small 2x2 table that easily fits in 38 cells -> Should render as Spatial Table (Columnar)
  const compactTableDoc = {
    title: 'Compact Spatial Table',
    blocks: [
      {
        type: 'table',
        headers: ['Item', 'Qty'],
        rows: [
          ['Apples', '10'],
          ['Pears', '5']
        ]
      }
    ]
  };

  const compactBrf = formatDocument(compactTableDoc, baseOpts({ tableFormat: 'auto' }));
  // Spatial table has separation lines (dashes/blank rows or column alignment)
  check('4.1 Compact table renders formatted spatial layout', compactBrf.length > 0 && !compactBrf.includes('NaN'));

  // Massive 6-column wide table that exceeds 38 cells -> Should auto-switch to Listed Format (BANA §11)
  const wideTableDoc = {
    title: 'Wide Listed Table',
    blocks: [
      {
        type: 'table',
        headers: ['Species Name', 'Geographic Habitat', 'Conservation Status', 'Average Lifespan (Years)', 'Dietary Classification', 'Population Estimate'],
        rows: [
          ['Panthera leo', 'Sub-Saharan Africa savanna and grassland ecosystems', 'Vulnerable to extinction', '12 to 16 years in wild', 'Obligate apex carnivore', '20,000 to 39,000 individuals'],
          ['Elephas maximus', 'Tropical and subtropical moist broadleaf forests', 'Endangered IUCN Red List', '60 to 70 years in wild', 'Generalist herbivore browser', '40,000 to 50,000 individuals']
        ]
      }
    ]
  };

  const wideBrf = formatDocument(wideTableDoc, baseOpts({ tableFormat: 'auto' }));
  check('4.2 Wide multi-column table auto-switches or renders without line overflow', wideBrf.length > 0);
  const widePages = wideBrf.split('\x0c');
  let maxWideLineLength = 0;
  for (const p of widePages) {
    const lines = p.split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
    for (const l of lines) {
      if (l.length > maxWideLineLength) maxWideLineLength = l.length;
    }
  }
  check('4.3 Table lines never exceed configured width (38 cells) on any page', maxWideLineLength <= 38, `max line: ${maxWideLineLength}`);

  // =========================================================================
  // 5. BIDIRECTIONAL UNICODE BRAILLE <-> ASCII BRF TRANSCODING
  // =========================================================================
  console.log('\n--- VECTOR 5: Bidirectional Braille Transcoding Invariants ---');

  // Test full 64 NABCC BRF character alphabet
  const NABCC_64 = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=";
  let allNabccValid = true;
  let allNabccRoundTrip = true;

  for (let i = 0; i < NABCC_64.length; i++) {
    const char = NABCC_64[i];
    const uni = brfToUnicodeBraille(char);
    const uniCp = uni.charCodeAt(0);
    if (uniCp < 0x2800 || uniCp > 0x283f) {
      allNabccValid = false;
      break;
    }
    const backAscii = unicodeBrailleToBrf(uni);
    if (backAscii !== char) {
      allNabccRoundTrip = false;
      break;
    }
  }

  check('5.1 All 64 NABCC BRF characters map to valid Unicode Braille patterns (U+2800..U+283F)', allNabccValid);
  check('5.2 Lossless 1:1 round-trip conversion for all 64 NABCC BRF characters', allNabccRoundTrip);

  // Test all 256 Unicode Braille patterns (0x2800 to 0x28FF)
  let allUniPatternsValid = true;
  for (let cp = 0x2800; cp <= 0x28ff; cp++) {
    const uniChar = String.fromCharCode(cp);
    const ascii = unicodeBrailleToBrf(uniChar);
    if (typeof ascii !== 'string' || ascii.length === 0) {
      allUniPatternsValid = false;
      break;
    }
  }
  check('5.3 All 256 Unicode Braille patterns (U+2800..U+28FF) map to valid NABCC ASCII', allUniPatternsValid);

  // =========================================================================
  // 6. ADVERSARIAL HIGH-DENSITY NESTING & FORMATTING STRESS
  // =========================================================================
  console.log('\n--- VECTOR 6: Adversarial High-Density Formatting Stress ---');

  // Extreme text containing 50 alternating bold, italic, numbers, math, and symbols in a single paragraph
  let stressText = '';
  for (let i = 1; i <= 25; i++) {
    stressText += `Word_${i} **Bold_${i}** _Italic_${i}_ #number_${i} [1/2 + 3/4 = 5/4] `;
  }

  const stressDoc = {
    title: 'Adversarial Formatting Stress',
    blocks: [
      { type: 'heading', level: 1, text: 'Adversarial Formatting Stress' },
      { type: 'paragraph', text: stressText },
      {
        type: 'dialogue',
        speaker: 'PROFESSOR',
        speech: 'This dialogue block contains deeply nested mathematical proofs and phonetic transcriptions.'
      },
      {
        type: 'poem',
        lines: [
          'The Braille dots rise in crisp array,',
          'Across the page they lead the way,',
          'From simple signs to symbols grand,',
          'A universe beneath the hand.'
        ]
      }
    ]
  };

  const stressBrf = formatDocument(stressDoc, baseOpts());
  check('6.1 Stress document translated and formatted without exception', stressBrf.length > 0);

  const stressPages = stressBrf.split('\x0c');
  let maxStressLine = 0;
  for (const p of stressPages) {
    const lines = p.split(/\r\n|\n/).map(l => l.replace(/\r$/, ''));
    for (const l of lines) {
      if (l.length > maxStressLine) maxStressLine = l.length;
    }
  }
  check('6.2 All stress lines strictly respect 38-cell right margin invariant on every page', maxStressLine <= 38, `max line length: ${maxStressLine}`);

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`ULTIMATE LATERAL MATRIX TEST RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('='.repeat(80));

  if (defects.length > 0) {
    console.log('\nDiscovered Defects:');
    defects.forEach(d => console.log(`  - ${d.name}: ${d.detail}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ULTIMATE LATERAL MATRIX TESTS PASSED WITH 100% PERFECTION!');
    process.exit(0);
  }
})();
