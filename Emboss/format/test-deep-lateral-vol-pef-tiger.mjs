// Deep Lateral Testing: Multi-Volume Braille, PEF 1.0 XML, Tiger PRN Rasterizer, Index Rasterizer, and 100+ Locales
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes } from './document.mjs';
import { exportToPef, brfLineToPefRow } from './pef.mjs';
import { pixelToTigerHeight, encodeTigerPrn } from './tiger-raster.mjs';
import { encodeIndexGraphicStream } from './index-raster.mjs';
import { styledTranslate } from './text-style.mjs';
import { DOMParser } from '@xmldom/xmldom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const defects = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    defects.push({ name, detail });
  }
}

(async () => {
  console.log('='.repeat(80));
  console.log('STARTING ADVANCED LATERAL TEST SUITE');
  console.log('Testing: Multi-Volume Braille, PEF 1.0, Tiger PRN, Index Raster, & 100+ Locales');
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
  // 1. MULTI-VOLUME BRAILLE SPLITTING INVARIANTS (BANA §1.3 / UKAAF)
  // =========================================================================
  console.log('1. Testing Multi-Volume Braille Splitting Invariants...');

  // Create a massive 200+ page textbook
  const massiveBlocks = [
    { type: 'heading', level: 1, text: 'Advanced Physics Principles: Comprehensive Coursebook' },
    { type: 'paragraph', text: 'This massive coursebook spans multiple physical braille volumes.' }
  ];
  for (let ch = 1; ch <= 15; ch++) {
    massiveBlocks.push({ type: 'heading', level: 2, text: `Chapter ${ch}: Dynamics and Quantum Phenomena` });
    for (let p = 1; p <= 12; p++) {
      massiveBlocks.push({
        type: 'paragraph',
        text: `Section ${ch}.${p}: Detailed exploration of gravitational and electromagnetic wave propagation through spacetime with substantial textual explanations.`
      });
    }
  }

  const massiveDoc = {
    title: 'Advanced Physics Principles',
    blocks: massiveBlocks
  };

  try {
    const singleBrf = formatDocument(massiveDoc, baseOpts());
    const totalSinglePages = singleBrf.split('\x0c').length;
    check('1.1 Massive document generated substantial single BRF', totalSinglePages > 15);

    // Split into volumes with 10 pages per volume budget
    const volumes = formatVolumes(massiveDoc, baseOpts({ volumePages: 10 }));
    check('1.2 Multiple volumes generated', Array.isArray(volumes) && volumes.length >= 2, `volume count: ${volumes?.length}`);

    // Verify volume invariants
    let allVolumesValid = true;
    volumes.forEach((vol, idx) => {
      const volNum = idx + 1;
      if (vol.volume !== volNum || vol.of !== volumes.length) allVolumesValid = false;
      if (!vol.spineLabel || !vol.spineLabel.includes(`VOL ${volNum}/${volumes.length}`)) allVolumesValid = false;
      if (!vol.brf || typeof vol.brf !== 'string' || vol.brf.length === 0) allVolumesValid = false;

      // Check volume title page
      const volPages = vol.brf.split('\x0c');
      const page1 = volPages[0] || '';
      if (!page1.includes('VOL') && !page1.includes('#A') && !page1.includes('VOLUME')) {
        allVolumesValid = false;
      }
    });
    check('1.3 All volumes have valid volume numbering, title pages, and spine labels', allVolumesValid);
  } catch (e) {
    check('1.1 Multi-volume splitting crash', false, e.message);
  }

  // =========================================================================
  // 2. PEF 1.0 (PORTABLE EMBOSSER FORMAT) XML COMPLIANCE
  // =========================================================================
  console.log('\n2. Testing PEF 1.0 XML Compliance...');

  try {
    const pefXml = exportToPef(massiveDoc, baseOpts({ volumePages: 10, identifier: 'urn:uuid:test-pef-12345' }));
    check('2.1 PEF XML string generated', typeof pefXml === 'string' && pefXml.length > 0);

    const parser = new DOMParser();
    const dom = parser.parseFromString(pefXml, 'application/xml');
    const root = dom.documentElement;

    check('2.2 PEF root element name is pef', root.nodeName === 'pef');
    check('2.3 PEF namespace is http://www.daisy.org/ns/2008/pef', root.getAttribute('xmlns') === 'http://www.daisy.org/ns/2008/pef');
    check('2.4 PEF version is 1.0', root.getAttribute('version') === '1.0');

    const meta = dom.getElementsByTagName('head')[0]?.getElementsByTagName('meta')[0];
    check('2.5 PEF meta container present', !!meta);

    const volumes = dom.getElementsByTagName('volume');
    check('2.6 PEF contains multiple volume elements', volumes.length >= 2, `volume elements: ${volumes.length}`);

    // Assert all rows contain exclusively Unicode Braille patterns (U+2800 to U+28FF)
    const rows = dom.getElementsByTagName('row');
    let allRowsValidBraille = true;
    for (let i = 0; i < rows.length; i++) {
      const text = rows[i].textContent || '';
      for (let j = 0; j < text.length; j++) {
        const cp = text.charCodeAt(j);
        if (cp < 0x2800 || cp > 0x28ff) {
          allRowsValidBraille = false;
          break;
        }
      }
      if (!allRowsValidBraille) break;
    }
    check('2.7 Every PEF row contains exclusively valid Unicode Braille patterns (U+2800..U+28FF)', allRowsValidBraille);
  } catch (e) {
    check('2.1 PEF export crash', false, e.message);
  }

  // =========================================================================
  // 3. VIEWPLUS TIGER TACTILE PRN RASTERIZER
  // =========================================================================
  console.log('\n3. Testing ViewPlus Tiger PRN Rasterizer...');

  try {
    // 3.1 Pixel luminance elevation curve
    check('3.1 Black pixel (0,0,0) produces height 7 (max elevation)', pixelToTigerHeight(0, 0, 0) === 7);
    check('3.2 White pixel (255,255,255) produces height 0 (flat paper)', pixelToTigerHeight(255, 255, 255) === 0);
    check('3.3 Dark gray pixel (40,40,40) produces height 6', pixelToTigerHeight(40, 40, 40) === 6);
    check('3.4 Mid gray pixel (128,128,128) produces height 4 or 5', [4, 5].includes(pixelToTigerHeight(128, 128, 128)));
    check('3.5 Transparent pixel (alpha < 48) produces height 0', pixelToTigerHeight(0, 0, 0, 20) === 0);

    // 3.2 2D Grid Nibble Packing & Escape Encoding
    const testGrid = [
      [7, 0, 5, 2, 0, 0],
      [7, 7, 7, 7, 3, 0],
      [0, 0, 0, 0, 0, 0]
    ];
    const prnStream = encodeTigerPrn(testGrid, { dpi: 20 });
    check('3.6 PRN byte stream produced as Uint8Array', prnStream instanceof Uint8Array && prnStream.length > 0);
    // Verify Tiger Graphics Mode escape sequence: ESC * r 1 A (0x1b, 0x2a, 0x72, 0x31, 0x41)
    const hasHeader = prnStream[0] === 0x1b && prnStream[1] === 0x2a && prnStream[2] === 0x72 && prnStream[3] === 0x31 && prnStream[4] === 0x41;
    check('3.7 PRN stream contains valid Tiger ESC * r 1 A escape header', hasHeader);
  } catch (e) {
    check('3.1 Tiger rasterizer crash', false, e.message);
  }

  // =========================================================================
  // 4. INDEX BRAILLE TACTILE GRAPHIC RASTERIZER
  // =========================================================================
  console.log('\n4. Testing Index Braille Tactile Graphic Rasterizer...');

  try {
    const binaryMatrix = [
      [true, false, true, false, true, true],
      [false, true, false, true, false, false],
      [true, true, true, false, false, true]
    ];
    const indexStream = encodeIndexGraphicStream(binaryMatrix);
    check('4.1 Index tactile rasterizer produced valid Uint8Array byte stream', indexStream instanceof Uint8Array && indexStream.length > 0);
    // Verify Index Graphic ESC + g header (0x1b, 0x2b, 0x67)
    const hasIndexHeader = indexStream[0] === 0x1b && indexStream[1] === 0x2b && indexStream[2] === 0x67;
    check('4.2 Index tactile stream contains ESC + g header', hasIndexHeader);
  } catch (e) {
    check('4.1 Index rasterizer crash', false, e.message);
  }

  // =========================================================================
  // 5. 100+ LOCALES JSON COVERAGE & FALLBACK INTEGRITY
  // =========================================================================
  console.log('\n5. Testing 100+ Locales JSON Coverage & Integrity...');

  const localesDir = path.join(projectRoot, 'web/locales');
  if (fs.existsSync(localesDir)) {
    const localeFiles = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
    // D3 (Paul, 16 Sep): only real translations are shipped — every locale file is one the
    // picker offers, and the picker offers no language without a file.
    const { ALL_SUPPORTED_LOCALES } = await import('../web/locales-data.mjs');
    const offered = ALL_SUPPORTED_LOCALES.map((l) => `${l.code}.json`).sort();
    check('5.1 Locale files are exactly the offered languages (no English copies)', JSON.stringify([...localeFiles].sort()) === JSON.stringify(offered) && localeFiles.includes('en.json'), `files: ${localeFiles.join(',')}`);

    const enJson = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf-8'));
    let totalEnKeys = 0;
    for (const k in enJson) {
      if (typeof enJson[k] === 'object' && enJson[k] !== null) {
        totalEnKeys += Object.keys(enJson[k]).length;
      } else {
        totalEnKeys++;
      }
    }
    check('5.2 English baseline contains translation keys', totalEnKeys > 50, `total keys: ${totalEnKeys}`);

    let allLocalesValidJson = true;
    let corruptedLocale = null;
    let rtlLocalesFound = 0;
    const RTL_CODES = new Set(['ar', 'he', 'fa', 'ur', 'ckb', 'syc', 'uga', 'yi']);

    for (const lf of localeFiles) {
      const langCode = lf.replace('.json', '');
      try {
        const raw = fs.readFileSync(path.join(localesDir, lf), 'utf-8');
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          allLocalesValidJson = false;
          corruptedLocale = lf;
          break;
        }
        if (RTL_CODES.has(langCode)) rtlLocalesFound++;
      } catch (err) {
        allLocalesValidJson = false;
        corruptedLocale = lf;
        break;
      }
    }

    check('5.3 All 100+ locale files are 100% valid JSON', allLocalesValidJson, corruptedLocale ? `failed on ${corruptedLocale}` : '');
    check('5.4 RTL locales (Arabic, Hebrew) verified present', rtlLocalesFound >= 2, `found: ${rtlLocalesFound}`);
  }

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`ADVANCED LATERAL TEST RESULTS: ${pass} PASSED, ${fail} FAILED`);
  console.log('='.repeat(80));

  if (defects.length > 0) {
    console.log('\nDiscovered Defects:');
    defects.forEach(d => console.log(`  - ${d.name}: ${d.detail}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ALL ADVANCED LATERAL TESTS PASSED WITH ZERO DEFECTS!');
    process.exit(0);
  }
})();
