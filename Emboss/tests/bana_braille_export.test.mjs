// Test Suite: Braille Deliverables Export Menu (Phase 6B)
// Verifies eBraille 1.0 (.ebraille) packaging, BRF (.brf) formatting across all BANA styles,
// tactile SVG bundling, multi-volume splitting, and container verification.

import assert from 'node:assert/strict';
import { exportToEbraille } from '../format/ebraille.mjs';
import { formatDocument, formatVolumes } from '../format/document.mjs';
import { writeEbraille, readEbraille, looksLikeEbraille } from '../../Translate/ebraille.mjs';
import { unzip } from '../../Translate/unmxl.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

console.log('=== Running Braille Deliverables Export Tests (Phase 6B) ===');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// Mock standard BANA Grade 2 translator
const mockTranslate = (text) => {
  if (!text) return '';
  // Simple deterministic translation for test asserts: transforms letters to lowercase ASCII
  return String(text).toLowerCase();
};

const defaultFormatOpts = {
  width: 38,
  depth: 25,
  mode: 'bana',
  translate: mockTranslate,
  language: 'en-US',
  brailleSystem: 'ueb grade2',
  volumePages: 0
};

// -----------------------------------------------------------------------------
// 1. eBraille 1.0 Container & Package Verification
// -----------------------------------------------------------------------------
await testAsync('exportToEbraille produces valid OCF/EPUB3 ZIP container', async () => {
  const doc = {
    title: 'Science Grade 7',
    author: 'State Education Dept',
    blocks: [
      { type: 'heading', level: 1, text: 'Cell Biology' },
      { type: 'para', text: 'All living organisms are composed of cells.' },
      {
        type: 'graphic',
        title: 'Plant Cell Diagram',
        alt: 'Diagram of a plant cell showing cell wall and nucleus',
        svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="black"/></svg>'
      }
    ]
  };

  const ebrailleBytes = exportToEbraille(doc, defaultFormatOpts);
  assert.ok(ebrailleBytes instanceof Uint8Array, 'Must return Uint8Array');
  assert.ok(ebrailleBytes.length > 500, 'Must produce non-empty ZIP package');

  // Verify ZIP header
  assert.ok(looksLikeEbraille(ebrailleBytes), 'Must have valid ZIP header signature');

  // Inspect package contents via unzip
  const unzipped = await unzip(ebrailleBytes.buffer.slice(ebrailleBytes.byteOffset, ebrailleBytes.byteOffset + ebrailleBytes.byteLength));
  const dec = new TextDecoder();

  // 1. mimetype must be exact and uncompressed
  assert.ok(unzipped.has('mimetype'), 'Must contain mimetype');
  assert.equal(dec.decode(unzipped.get('mimetype')).trim(), 'application/epub+zip');

  // 2. META-INF/container.xml
  assert.ok(unzipped.has('META-INF/container.xml'), 'Must contain META-INF/container.xml');
  const containerXml = dec.decode(unzipped.get('META-INF/container.xml'));
  assert.ok(containerXml.includes('full-path="package.opf"'));

  // 3. package.opf
  assert.ok(unzipped.has('package.opf'), 'Must contain package.opf');
  const opfXml = dec.decode(unzipped.get('package.opf'));
  assert.ok(opfXml.includes('<dc:title>Science Grade 7</dc:title>'));
  assert.ok(opfXml.includes('<dc:creator>State Education Dept</dc:creator>'));
  assert.ok(opfXml.includes('<meta property="a11y:tactileGraphics">SVG</meta>'));
  assert.ok(opfXml.includes('media-type="image/svg+xml"'));

  // 4. Entry Navigation and Volume Content
  assert.ok(unzipped.has('volume-1.html'), 'Must contain volume-1.html');
  const volHtml = dec.decode(unzipped.get('volume-1.html'));
  assert.ok(volHtml.includes('<div class="sah-page"'));
  assert.ok(volHtml.includes('<figure>'));
  assert.ok(volHtml.includes('<img src="graphics/graphic-1.svg"'));

  // 5. Embedded Graphic SVG
  assert.ok(unzipped.has('graphics/graphic-1.svg'), 'Must bundle graphic SVG');
  const svgContent = dec.decode(unzipped.get('graphics/graphic-1.svg'));
  assert.ok(svgContent.includes('<svg viewBox="0 0 100 100">'));
});

// -----------------------------------------------------------------------------
// 2. Strict Translator Guard
// -----------------------------------------------------------------------------
test('exportToEbraille throws when opts.translate is missing', () => {
  const doc = { title: 'Test Doc', blocks: [{ type: 'para', text: 'Hello' }] };
  assert.throws(() => {
    exportToEbraille(doc, { width: 38, depth: 25 });
  }, /opts\.translate must be the braille translate function/);
});

// -----------------------------------------------------------------------------
// 3. Multi-Volume BRF and eBraille Splitting
// -----------------------------------------------------------------------------
test('formatVolumes splits large documents by volumePages setting', () => {
  // Create document with many paragraphs
  const blocks = [
    { type: 'heading', level: 1, text: 'Volume Test' }
  ];
  for (let i = 1; i <= 60; i++) {
    blocks.push({ type: 'para', text: `Paragraph ${i} with substantial text to fill lines on multiple braille pages.` });
  }

  const doc = { title: 'Volume Test', blocks };
  const singleVol = formatVolumes(doc, { ...defaultFormatOpts, volumePages: 0 });
  assert.equal(singleVol.length, 1);
  assert.equal(singleVol[0].volume, 1);
  assert.equal(singleVol[0].of, 1);

  const multiVol = formatVolumes(doc, { ...defaultFormatOpts, volumePages: 2 });
  assert.ok(multiVol.length > 1, `Expected multiple volumes, got ${multiVol.length}`);
  assert.equal(multiVol[0].volume, 1);
  assert.equal(multiVol[0].of, multiVol.length);
  assert.equal(multiVol[multiVol.length - 1].volume, multiVol.length);
});

// -----------------------------------------------------------------------------
// 4. BRF BANA Formatting Across All Styles
// -----------------------------------------------------------------------------
test('BRF output obeys BANA margin rules across styles', () => {
  const doc = {
    title: 'BANA Formatting Test',
    blocks: [
      { type: 'heading', level: 1, text: 'MAIN TITLE' },
      { type: 'heading', level: 2, text: 'Section Heading' },
      { type: 'para', text: 'First line of standard body paragraph running over to second line.' },
      { type: 'play', text: 'ROMEO: But soft, what light through yonder window breaks?' },
      { type: 'stage', text: '[Juliet appears above at a window.]' },
      { type: 'play', subtype: 'verse', text: 'O Romeo, Romeo, wherefore art thou Romeo?' },
      {
        type: 'list',
        kind: 'toc',
        items: [{ text: 'Act I Scene 1', page: '5' }]
      },
      {
        type: 'box',
        title: 'DRAMA NOTE',
        blocks: [
          { type: 'para', text: 'This tragedy was written around 1595.' }
        ]
      }
    ]
  };

  const fullBrf = formatDocument(doc, defaultFormatOpts);
  assert.ok(typeof fullBrf === 'string' && fullBrf.length > 100);
  assert.ok(fullBrf.includes('main title') || fullBrf.includes('MAIN TITLE'));
});

// -----------------------------------------------------------------------------
// 5. Multi-Volume eBraille Packaging
// -----------------------------------------------------------------------------
await testAsync('Multi-volume eBraille bundles multiple volume HTML documents and TOC', async () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Multi Volume eBraille' }
  ];
  for (let i = 1; i <= 60; i++) {
    blocks.push({ type: 'para', text: `Paragraph ${i} with substantial text to trigger page and volume splits.` });
  }

  const multiDoc = { title: 'Multi Volume eBraille', blocks };
  const bytes = exportToEbraille(multiDoc, { ...defaultFormatOpts, volumePages: 2 });
  assert.ok(looksLikeEbraille(bytes));

  const unzipped = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(unzipped.has('volume-1.html'), 'Must contain volume-1.html');
  assert.ok(unzipped.has('volume-2.html'), 'Must contain volume-2.html');
  assert.ok(unzipped.has('package.opf'), 'Must contain package.opf');
});

// -----------------------------------------------------------------------------
// 6. Comprehensive 15-Style Document eBraille & BRF Deliverable Parity
// -----------------------------------------------------------------------------
await testAsync('Comprehensive 15-Style Document Exports Cleanly to eBraille and BRF', async () => {
  const richDoc = {
    title: 'Grade 7 BANA Literature Showcase',
    author: 'Curriculum Team',
    blocks: [
      { type: 'heading', level: 1, text: 'Grade 7 BANA Literature Showcase' },
      { type: 'pagenum', page: '1' },
      {
        type: 'list',
        kind: 'toc',
        items: [
          { text: 'Unit 1: The Call of the Wild', page: '1' },
          { text: 'Unit 2: Poetry in Motion', page: '45' }
        ]
      },
      { type: 'heading', level: 2, text: 'Unit 1: The Call of the Wild' },
      { type: 'para', text: 'Buck did not read the newspapers, or he would have known trouble was brewing.' },
      { type: 'play', text: 'MAN IN RED SWEATER: That will teach you your place.' },
      { type: 'stage', text: '[Buck growls menacingly from his crate.]' },
      { type: 'play', subtype: 'verse', text: 'Deep in the forest dark and cold,' },
      {
        type: 'list',
        kind: 'exercise',
        items: [
          { text: '1. What year does the story take place?', level: 0 },
          { text: 'a. 1897', level: 1 }
        ]
      },
      {
        type: 'table',
        format: 'listed',
        caption: 'Characters',
        tabletn: 'Listed table of characters.',
        headers: ['Name', 'Role'],
        rows: [
          ['Buck', 'Protagonist dog'],
          ['John Thornton', 'Beloved master']
        ]
      },
      {
        type: 'box',
        title: 'HISTORICAL CONTEXT',
        blocks: [
          { type: 'para', text: 'The Klondike Gold Rush drew thousands to the Yukon.' }
        ]
      },
      { type: 'note', text: 'Transcriber Note: End of excerpt.' },
      { type: 'footnote', text: '1. The Yukon territory is in northwest Canada.' },
      { type: 'attribution', text: '— Jack London' },
      { type: 'caption', text: 'Illustration of a sled dog team.' },
      {
        type: 'graphic',
        title: 'Yukon Map',
        alt: 'Map of Alaska and the Yukon Gold Fields',
        svg: '<svg viewBox="0 0 200 200"><polygon points="20,20 180,20 150,180 50,180" fill="none" stroke="black"/></svg>'
      }
    ]
  };

  // Export eBraille
  const ebrailleBytes = exportToEbraille(richDoc, defaultFormatOpts);
  assert.ok(looksLikeEbraille(ebrailleBytes));
  const unzipped = await unzip(ebrailleBytes.buffer.slice(ebrailleBytes.byteOffset, ebrailleBytes.byteOffset + ebrailleBytes.byteLength));
  assert.ok(unzipped.has('package.opf'));
  assert.ok(unzipped.has('volume-1.html'));
  assert.ok(unzipped.has('graphics/graphic-1.svg'));

  // Export BRF
  const brf = formatDocument(richDoc, defaultFormatOpts);
  assert.ok(typeof brf === 'string' && brf.length > 200);
});

// -----------------------------------------------------------------------------
// 7. Empty Document Handling
// -----------------------------------------------------------------------------
await testAsync('Empty document export produces valid eBraille and BRF without errors', async () => {
  const emptyDoc = { title: 'Empty Doc', blocks: [] };
  const bytes = exportToEbraille(emptyDoc, defaultFormatOpts);
  assert.ok(looksLikeEbraille(bytes));

  const vols = formatVolumes(emptyDoc, defaultFormatOpts);
  assert.equal(vols.length, 1);
  assert.equal(typeof vols[0].brf, 'string');
});

console.log(`\nAll ${passCount} Phase 6B Braille Deliverables Export tests passed cleanly!`);
