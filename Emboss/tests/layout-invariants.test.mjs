import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';

function mockTranslate(text) {
  if (!text) return '';
  return text.toUpperCase();
}

const GEOMETRIES = [
  { width: 28, depth: 20 },
  { width: 30, depth: 25 },
  { width: 32, depth: 25 },
  { width: 38, depth: 25 },
  { width: 40, depth: 25 },
  { width: 42, depth: 28 },
];

function generateCorpus() {
  const blocks = [];
  
  // 1. Headings of different lengths
  blocks.push({ type: 'heading', level: 1, text: 'Short Title' });
  blocks.push({ type: 'heading', level: 1, text: 'A Much Longer Title That Might Exceed Twenty Characters On Narrow Formats' });
  blocks.push({ type: 'heading', level: 2, text: 'Section 1.1: Foundations of Braille Transcription & Typography' });
  blocks.push({ type: 'heading', level: 3, text: 'Sub-sub-section with detailed breakdown' });

  // 2. Paragraphs with varying word lengths and punctuation
  blocks.push({
    type: 'para',
    text: 'Standard paragraph with regular English words and normal spacing. It should format with cell 3 indent and cell 1 runover in indented mode.'
  });
  blocks.push({
    type: 'para',
    text: 'A paragraph containing extremely long words like Supercalifragilisticexpialidocious and Pneumonoultramicroscopicsilicovolcanoconiosis and Antidisestablishmentarianism that test hyphenation boundaries.'
  });
  blocks.push({
    type: 'para',
    text: 'Paragraph with embedded numbers $100,000,000 and dates 2026-09-01 and mathematical fragments 1 + 2 = 3 and 100% accuracy.'
  });

  // 3. Numbered and bulleted lists (nested)
  blocks.push({
    type: 'list',
    items: [
      { text: 'First item in the list that is short.' },
      { text: 'Second item in the list that extends across multiple lines to test list runover indents and margin consistency across pages.' },
      { text: 'Third item.', marker: '3.' },
      { text: 'Fourth item with numbers and symbols: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10.', marker: '4.' }
    ]
  });

  // 4. Spatial tables
  blocks.push({
    type: 'table',
    headers: ['Element', 'Symbol', 'Atomic Number', 'Mass'],
    rows: [
      ['Hydrogen', 'H', '1', '1.008'],
      ['Helium', 'He', '2', '4.0026'],
      ['Lithium', 'Li', '3', '6.94'],
      ['Beryllium', 'Be', '4', '9.0122']
    ]
  });

  // 5. Document break
  blocks.push({ type: 'indicator', kind: 'asterisks' });

  // 6. Large multi-paragraph sequence
  for (let i = 0; i < 20; i++) {
    blocks.push({
      type: 'para',
      text: `Paragraph ${i + 1}: Continuous automated text generation designed to fill multiple braille pages. Testing page breaking, running headers, and line width geometry across pages.`
    });
  }

  return blocks;
}

test('Layout Invariant: Zero Line Overflows across all standard embosser geometries', () => {
  const corpus = generateCorpus();

  for (const geom of GEOMETRIES) {
    for (const pStyle of ['indented', 'block']) {
      const opts = {
        mode: 'ukaaf',
        width: geom.width,
        depth: geom.depth,
        paragraphStyle: pStyle,
        translate: mockTranslate
      };

      const brf = formatDocument({ title: 'Invariant Corpus Test', blocks: corpus }, opts);
      const pages = brf.split('\x0c');

      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const lines = pages[pIdx].split(/\r\n|\n/);
        // Exclude trailing blank line if present
        if (lines.length && lines[lines.length - 1] === '') lines.pop();

        // Invariant 1: Page depth must not exceed geom.depth
        assert.ok(
          lines.length <= geom.depth,
          `Page ${pIdx + 1} exceeded depth: ${lines.length} lines > max ${geom.depth} (Geom: ${geom.width}x${geom.depth}, Style: ${pStyle})`
        );

        // Invariant 2: No single line must ever exceed geom.width cells
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
          const line = lines[lIdx];
          assert.ok(
            line.length <= geom.width,
            `Line ${lIdx + 1} on Page ${pIdx + 1} exceeded width: ${line.length} cells > max ${geom.width} [${line}] (Geom: ${geom.width}x${geom.depth})`
          );
        }
      }
    }
  }
});

test('Layout Invariant: Indented Paragraphs strictly obey cell 3 indent and cell 1 runover', () => {
  const blocks = [
    { type: 'para', text: 'This is the first sentence of an indented paragraph that is long enough to span across multiple lines of braille output.' }
  ];

  const opts = {
    mode: 'ukaaf',
    width: 38,
    depth: 25,
    paragraphStyle: 'indented',
    suppressHeader: true,
    translate: mockTranslate
  };

  const brf = formatDocument({ title: null, blocks }, opts);
  const lines = brf.split(/\r\n|\n/).filter(l => l.length > 0 && l !== '\x0c');

  assert.ok(lines.length >= 2, 'Expected multi-line paragraph');
  // First line starts with 2 spaces (cell 3)
  assert.equal(lines[0].startsWith('  '), true, `First line should start with 2 spaces: "${lines[0]}"`);
  assert.notEqual(lines[0].charAt(2), ' ', `First line should start on cell 3: "${lines[0]}"`);
  // Second line starts at cell 1 (no leading spaces)
  assert.notEqual(lines[1].charAt(0), ' ', `Runover line should start at cell 1: "${lines[1]}"`);
});
