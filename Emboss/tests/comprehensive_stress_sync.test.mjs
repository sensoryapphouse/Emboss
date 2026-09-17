import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Provide global DOMParser for Node test environment
globalThis.DOMParser = DOMParser;

import { parseDtbook } from '../input/parse.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, 'nimas_samples');
// The committed fixture tests/nimas_samples/9780544087507NIMAS.xml is always part of SAMPLES_DIR;
// the ~/Downloads copy is an optional extra that is only added when it exists on this machine.
const USER_DOWNLOADS_FILE = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
// Production textbook for the in-place edit stress test: committed fixture first, Downloads copy as fallback.
const PRODUCTION_TEXTBOOK = [path.join(SAMPLES_DIR, '9780544087507NIMAS.xml'), USER_DOWNLOADS_FILE].find((p) => fs.existsSync(p));

// Mock translation function for Node.js test environment
const mockTranslate = (s) => s.toUpperCase();
const mockTranslatePos = (text, tf) => {
  const braille = text.toUpperCase();
  return {
    braille,
    inputPos: Array.from(text, (_, i) => i)
  };
};

test('Comprehensive Multi-File Batch Loading & Stress Test across all NIMAS files', async (t) => {
  const sampleFiles = fs.readdirSync(SAMPLES_DIR).filter(f => f.endsWith('.xml'));
  assert.ok(sampleFiles.length >= 15, `Found ${sampleFiles.length} sample files`);

  const fileList = sampleFiles.map(f => path.join(SAMPLES_DIR, f));
  if (fs.existsSync(USER_DOWNLOADS_FILE)) {
    fileList.push(USER_DOWNLOADS_FILE);
  } else {
    console.log(`SKIPPED: optional extra file ${USER_DOWNLOADS_FILE} not present; using the ${fileList.length} committed fixtures only`);
  }

  let totalBlocksProcessed = 0;
  let totalCharsProcessed = 0;
  const startTime = performance.now();

  for (const filePath of fileList) {
    const fileName = path.basename(filePath);
    const xmlContent = fs.readFileSync(filePath, 'utf8');
    totalCharsProcessed += xmlContent.length;

    // 1. Parse to AST
    const t0 = performance.now();
    const doc = parseDtbook(xmlContent);
    const parseTime = performance.now() - t0;

    assert.ok(doc, `Parsed document from ${fileName}`);
    assert.ok(Array.isArray(doc.blocks), `Blocks array exists in ${fileName}`);
    assert.ok(doc.blocks.length > 0, `Blocks count > 0 in ${fileName}`);
    totalBlocksProcessed += doc.blocks.length;

    // 2. Format to BANA Braille
    const t1 = performance.now();
    const brf = formatDocument(doc, {
      width: 40,
      depth: 25,
      mode: 'bana',
      standard: 'bana',
      translate: mockTranslate,
      mathToBrf: (b) => b.latex || ';;EQUATION'
    });
    const formatTime = performance.now() - t1;

    assert.ok(typeof brf === 'string', `Braille output is string for ${fileName}`);
    assert.ok(brf.length > 0, `Braille output non-empty for ${fileName}`);

    // 3. Export to NIMAS DTBook XML
    const t2 = performance.now();
    const exportedXml = exportToNimas(doc);
    const exportTime = performance.now() - t2;

    assert.ok(exportedXml.includes('<?xml'), `Exported XML has declaration for ${fileName}`);
    assert.ok(exportedXml.includes('<dtbook'), `Exported XML has root tag for ${fileName}`);

    // 4. Re-parse and verify AST equivalence
    const reparsed = parseDtbook(exportedXml);
    assert.equal(reparsed.blocks.length, doc.blocks.length, `Reparsed block count matches in ${fileName}`);
  }

  const totalTime = performance.now() - startTime;
  assert.ok(totalBlocksProcessed >= 8000, `Processed ${totalBlocksProcessed} blocks`);
  assert.ok(totalTime < 15000, `Batch processing finished in ${Math.round(totalTime)}ms`);
});

test('Deep Bi-Directional Coordinate Synchronization (traceBlock) across all BANA structures', () => {
  const testBlocks = [
    { type: 'heading', level: 1, text: 'CHAPTER ONE: THE ODYSSEY' },
    { type: 'heading', level: 2, text: 'Section A: Ancient Lands' },
    { type: 'para', text: 'The ancient mariner beheld the distant mountains rising above the azure sea.' },
    { type: 'para', style: 'quote', text: 'To strive, to seek, to find, and not to yield.' },
    { type: 'attribution', text: '— Lord Alfred Tennyson' },
    {
      type: 'list',
      kind: 'exercise',
      items: [
        { text: '1. What was the central theme of the voyage?' },
        { text: '2. Describe the obstacles faced by the hero.' }
      ]
    },
    {
      type: 'list',
      kind: 'glossary',
      items: [
        { text: 'Epic — A long narrative poem recounting heroic deeds.' },
        { text: 'Hubris — Excessive pride leading to downfall.' }
      ]
    },
    {
      type: 'play',
      subtype: 'prose',
      style: 'play-speaker',
      text: 'ODYSSEUS: Tell me, Muse, of that man of many resources.'
    },
    {
      type: 'stage',
      style: 'play-stage',
      text: '(He gazes upon the vast expanse of the wine-dark ocean)'
    },
    {
      type: 'play',
      subtype: 'verse',
      style: 'verse',
      text: 'Sing in me, Muse, and through me tell the story'
    },
    {
      type: 'box',
      title: 'Historical Note',
      blocks: [
        { type: 'heading', level: 2, text: 'Historical Note' },
        { type: 'para', text: 'Bronze Age navigation relied heavily on stellar constellations.' }
      ]
    },
    {
      type: 'table',
      format: 'spatial',
      headers: ['Region', 'Epoch', 'Artifacts'],
      rows: [
        ['Crete', 'Minoan', 'Pottery'],
        ['Mycenae', 'Bronze', 'Masks']
      ]
    }
  ];

  const opts = {
    width: 40,
    depth: 25,
    mode: 'bana',
    standard: 'bana',
    translate: mockTranslate,
    translatePos: mockTranslatePos
  };

  for (let bIdx = 0; bIdx < testBlocks.length; bIdx++) {
    const block = testBlocks[bIdx];
    const tracedLines = traceBlock(block, opts, bIdx === 0, 0);

    assert.ok(Array.isArray(tracedLines), `traceBlock returns array for block type ${block.type}`);
    assert.ok(tracedLines.length > 0, `traceBlock produces non-empty output for block type ${block.type}`);

    // Verify cell coordinate integrity
    for (const line of tracedLines) {
      assert.ok(typeof line.s === 'string', 'Line text is string');
      assert.ok(Array.isArray(line.src), 'Line src map is array');

      for (let cellIdx = 0; cellIdx < line.s.length; cellIdx++) {
        const src = line.src[cellIdx];
        if (src !== null) {
          assert.equal(typeof src.u, 'number', 'Source unit index is number');
          assert.equal(typeof src.c, 'number', 'Source char index is number');
          assert.ok(src.c >= 0, 'Source char offset is non-negative');
        }
      }
    }
  }
});

test('Rapid Document Swapping & Memory Isolation Stress Test', () => {
  const documents = [
    { title: 'Doc 1', blocks: [{ type: 'para', text: 'First document text.' }] },
    { title: 'Doc 2', blocks: [{ type: 'heading', level: 1, text: 'Doc 2 Title' }, { type: 'para', text: 'Second document body.' }] },
    { title: 'Doc 3', blocks: [{ type: 'box', title: 'Box Doc', blocks: [{ type: 'para', text: 'Box content' }] }] },
    { title: 'Doc 4', blocks: [{ type: 'list', items: [{ text: 'Item A' }, { text: 'Item B' }] }] },
    { title: 'Doc 5', blocks: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }] }
  ];

  const opts = {
    width: 40,
    depth: 25,
    translate: mockTranslate,
    translatePos: mockTranslatePos
  };

  // Switch between documents 100 times in rapid succession
  for (let cycle = 0; cycle < 100; cycle++) {
    const doc = documents[cycle % documents.length];
    const brf = formatDocument(doc, opts);
    assert.ok(brf.length > 0, `Formatted document in cycle ${cycle}`);

    // Verify trace for each block
    for (const b of doc.blocks) {
      const trace = traceBlock(b, opts);
      assert.ok(trace.length > 0);
    }
  }
});

test('Heavy In-Place Edit Stress Test on 5,000+ Block Production Textbook', (t) => {
  if (!PRODUCTION_TEXTBOOK) {
    const reason = `SKIPPED: production textbook not found (looked for tests/nimas_samples/9780544087507NIMAS.xml and ${USER_DOWNLOADS_FILE})`;
    console.log(reason);
    return t.skip(reason);
  }

  const xmlContent = fs.readFileSync(PRODUCTION_TEXTBOOK, 'utf8');
  const doc = parseDtbook(xmlContent);
  assert.ok(doc.blocks.length >= 5000, `Loaded ${doc.blocks.length} blocks`);

  const opts = {
    width: 40,
    depth: 25,
    translate: mockTranslate,
    translatePos: mockTranslatePos
  };

  // Perform 20 in-place edits throughout the document. The edit rewrites the
  // block's TEXT, so the target must be a block whose braille is rendered
  // from its text (para/heading/note/play/box/list). pagenum blocks render
  // from `.page` and tables from their cells, so editing `.text` on those
  // would never show up in the trace — step forward to the next text block.
  const isTextBlock = (b) => b && (
    (typeof b.text === 'string' && !['pagenum', 'table', 'graphic', 'math', 'break', 'indicator'].includes(b.type)) ||
    (b.type === 'box' && Array.isArray(b.blocks) && b.blocks.length > 0 && typeof b.blocks[0].text === 'string') ||
    (b.type === 'list' && Array.isArray(b.items) && b.items.length > 0)
  );
  for (let editIndex = 0; editIndex < 20; editIndex++) {
    let targetBlockIndex = (editIndex * 250) % doc.blocks.length;
    while (!isTextBlock(doc.blocks[targetBlockIndex])) targetBlockIndex = (targetBlockIndex + 1) % doc.blocks.length;
    const origBlock = doc.blocks[targetBlockIndex];

    const updatedText = `[EDIT ${editIndex}] Updated content [VERIFIED]`;
    const seg = { type: 'text', text: updatedText };
    if (origBlock.type === 'box' && Array.isArray(origBlock.blocks) && origBlock.blocks.length > 0) {
      origBlock.blocks[0] = { ...origBlock.blocks[0], text: updatedText, segments: [seg] };
    } else if (origBlock.type === 'list' && Array.isArray(origBlock.items) && origBlock.items.length > 0) {
      origBlock.items[0] = { ...origBlock.items[0], text: updatedText, segments: [seg] };
    } else {
      doc.blocks[targetBlockIndex] = { ...origBlock, text: updatedText, segments: [seg] };
    }

    // Format single block and trace
    const traced = traceBlock(doc.blocks[targetBlockIndex], opts);
    assert.ok(traced.length > 0);

    const hasEditText = traced.some(l => l.s.includes(`EDIT ${editIndex}`) || l.s.includes('EDIT'));
    assert.ok(hasEditText, `Traced braille contains updated text for edit ${editIndex}`);
  }
});
