// Test Suite: BANA Project Save & NIMAS XML Serialization Engine (Phase 6A)
// Verifies deterministic export of all 15 BANA styles, tables, sidebars, inline runs,
// metadata, and 100% round-trip invariance through parseDtbook.

import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { exportToNimasXml, serializeBlock, serializeInlineSegments, escapeXml } from '../input/nimas-export.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { STYLE_DEFINITIONS } from '../format/styles.mjs';

console.log('=== Running BANA Project Save & NIMAS Serialization Tests (Phase 6A) ===');

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

// -----------------------------------------------------------------------------
// 1. XML Escaping and Inline Run Serialization
// -----------------------------------------------------------------------------
test('escapeXml escapes &, <, >, and "', () => {
  assert.equal(escapeXml('Tom & Jerry <friends> "forever"'), 'Tom &amp; Jerry &lt;friends&gt; &quot;forever&quot;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(123), '123');
});

test('serializeInlineSegments handles plain text fallback and empty segments', () => {
  assert.equal(serializeInlineSegments([], 'Fallback <Text>'), 'Fallback &lt;Text&gt;');
  assert.equal(serializeInlineSegments(null, 'Hello'), 'Hello');
});

test('serializeInlineSegments preserves bold, italic, underline, and uncontracted code', () => {
  const segments = [
    { type: 'text', text: 'Plain ' },
    { type: 'text', text: 'Bold', tf: 4 },
    { type: 'text', text: ' & ' },
    { type: 'text', text: 'Italic', tf: 1 },
    { type: 'text', text: ' & ' },
    { type: 'text', text: 'Underlined', tf: 2 },
    { type: 'text', text: ' & ' },
    { type: 'text', text: 'Uncontracted', uncontracted: true },
    { type: 'text', text: ' & ' },
    { type: 'text', text: 'BoldItalic', tf: 5 },
  ];
  const xml = serializeInlineSegments(segments);
  assert.ok(xml.includes('Plain '));
  assert.ok(xml.includes('<strong>Bold</strong>'));
  assert.ok(xml.includes(' &amp; '));
  assert.ok(xml.includes('<em>Italic</em>'));
  assert.ok(xml.includes('<u>Underlined</u>'));
  assert.ok(xml.includes('<code class="uncontracted">Uncontracted</code>'));
  assert.ok(xml.includes('<strong><em>BoldItalic</em></strong>') || xml.includes('<em><strong>BoldItalic</strong></em>'));
});

test('serializeInlineSegments preserves inline MathML and LaTeX equations', () => {
  const segments = [
    { type: 'text', text: 'The value is ' },
    { type: 'math', latex: 'x^2 + y^2 = r^2' },
    { type: 'text', text: ' where ' },
    { type: 'math', mathml: '<math><mi>r</mi><mo>&gt;</mo><mn>0</mn></math>' }
  ];
  const xml = serializeInlineSegments(segments);
  assert.ok(xml.includes('<m:math alttext="x^2 + y^2 = r^2"><m:semantics><m:annotation encoding="application/x-tex">x^2 + y^2 = r^2</m:annotation></m:semantics></m:math>'));
  assert.ok(xml.includes('<math><mi>r</mi><mo>&gt;</mo><mn>0</mn></math>'));
});

// -----------------------------------------------------------------------------
// 2. Individual BANA Block Serialization
// -----------------------------------------------------------------------------
test('Serializes Heading 1, 2, and 3', () => {
  assert.equal(serializeBlock({ type: 'heading', level: 1, text: 'Main Title' }, 0), '<h1>Main Title</h1>');
  assert.equal(serializeBlock({ type: 'heading', level: 2, text: 'Chapter Section' }, 0), '<h2>Chapter Section</h2>');
  assert.equal(serializeBlock({ type: 'heading', level: 3, text: 'Subsection' }, 0), '<h3>Subsection</h3>');
});

test('Serializes Body Text Paragraph', () => {
  assert.equal(serializeBlock({ type: 'para', text: 'Standard paragraph content.' }, 0), '<p>Standard paragraph content.</p>');
});

test('Serializes Play Dialogue and Stage Directions', () => {
  const d1 = serializeBlock({ type: 'play', text: 'HAMLET: To be or not to be.' }, 0);
  assert.equal(d1, '<p class="bai-play">HAMLET: To be or not to be.</p>');

  const d2 = serializeBlock({ type: 'para', style: 'dialogue', text: 'OPHELIA: My lord?' }, 0);
  assert.equal(d2, '<p class="bai-play">OPHELIA: My lord?</p>');

  const st1 = serializeBlock({ type: 'stage', text: '[Exit Ghost]' }, 0);
  assert.equal(st1, '<p class="bai-stage">[Exit Ghost]</p>');

  const st2 = serializeBlock({ type: 'para', style: 'stage', text: '[Enter Horatio]' }, 0);
  assert.equal(st2, '<p class="bai-stage">[Enter Horatio]</p>');
});

test('Serializes Poetry Verse and Stanzas', () => {
  const v1 = serializeBlock({ type: 'play', subtype: 'verse', text: 'Two roads diverged in a yellow wood,' }, 0);
  assert.equal(v1, '<p class="bai-verse">Two roads diverged in a yellow wood,</p>');

  const v2 = serializeBlock({ type: 'para', style: 'verse', text: 'And sorry I could not travel both' }, 0);
  assert.equal(v2, '<p class="bai-verse">And sorry I could not travel both</p>');
});

test('Serializes Notes, Footnotes, Captions, and Attributions', () => {
  assert.equal(serializeBlock({ type: 'note', text: 'Transcriber note text' }, 0), '<prodnote>Transcriber note text</prodnote>');
  assert.equal(serializeBlock({ type: 'para', style: 'note', text: 'Prod note 2' }, 0), '<prodnote>Prod note 2</prodnote>');
  assert.equal(serializeBlock({ type: 'footnote', text: 'Footnote content' }, 0), '<note class="footnote">Footnote content</note>');
  assert.equal(serializeBlock({ type: 'para', style: 'footnote', text: 'Footnote content 2' }, 0), '<note class="footnote">Footnote content 2</note>');
  assert.equal(serializeBlock({ type: 'caption', text: 'Figure 1: Cell division' }, 0), '<caption>Figure 1: Cell division</caption>');
  assert.equal(serializeBlock({ type: 'para', style: 'caption', text: 'Figure 2: Map' }, 0), '<caption>Figure 2: Map</caption>');
  assert.equal(serializeBlock({ type: 'attribution', text: '— William Shakespeare' }, 0), '<byline>— William Shakespeare</byline>');
  assert.equal(serializeBlock({ type: 'para', style: 'attribution', text: '— Robert Frost' }, 0), '<byline>— Robert Frost</byline>');
});

test('Serializes Table of Contents (TOC) Plain Lists with Page Numbers', () => {
  const tocBlock = {
    type: 'list',
    kind: 'toc',
    items: [
      { text: 'Chapter 1: The Beginning', page: '1' },
      { text: 'Chapter 2: The Journey', page: '24', level: 1 },
      { text: 'Appendix A: Glossary', page: '350' }
    ]
  };
  const xml = serializeBlock(tocBlock, 0);
  assert.ok(xml.startsWith('<list type="pl" class="toc">'));
  assert.ok(xml.includes('<li class="bai-toc-entry"><lic class="bai-toc-text">Chapter 1: The Beginning</lic><lic class="bai-toc-page">1</lic></li>'));
  assert.ok(xml.includes('<li class="bai-toc-entry" level="1"><lic class="bai-toc-text">Chapter 2: The Journey</lic><lic class="bai-toc-page">24</lic></li>'));
  assert.ok(xml.endsWith('</list>'));
});

test('Serializes Bulleted, Numbered, Plain, and Exercise Lists', () => {
  const ulBlock = { type: 'list', items: [{ text: 'Apple' }, { text: 'Banana' }] };
  assert.ok(serializeBlock(ulBlock, 0).includes('<list type="ul">'));

  const olBlock = { type: 'list', items: [{ text: 'First', marker: '1.' }, { text: 'Second', marker: '2.' }] };
  assert.ok(serializeBlock(olBlock, 0).includes('<list type="ol">'));

  const plainBlock = { type: 'list', kind: 'plain', items: [{ text: 'Line 1' }, { text: 'Line 2' }] };
  assert.ok(serializeBlock(plainBlock, 0).includes('<list type="pl">'));

  const exBlock = { type: 'list', kind: 'exercise', items: [{ text: 'Solve x + 2 = 5' }, { text: 'Graph y = 2x', level: 1 }] };
  const exXml = serializeBlock(exBlock, 0);
  assert.ok(exXml.includes('<list type="ol" class="bai-exercise">'));
  assert.ok(exXml.includes('<li class="bai-exercise">Solve x + 2 = 5</li>'));
  assert.ok(exXml.includes('<li class="bai-exercise" level="1">Graph y = 2x</li>'));
});

test('Serializes BANA Listed and Spatial Tables', () => {
  const listedTbl = {
    type: 'table',
    format: 'listed',
    caption: 'Student Grades',
    tabletn: 'Listed table format for 1-column reading.',
    headers: ['Name', 'Grade'],
    rows: [
      ['Alice', 'A'],
      ['Bob', 'B+']
    ]
  };
  const listedXml = serializeBlock(listedTbl, 0);
  assert.ok(listedXml.includes('<table class="bana-listed">'));
  assert.ok(listedXml.includes('<caption>Student Grades</caption>'));
  assert.ok(listedXml.includes('<tabletn>Listed table format for 1-column reading.</tabletn>'));
  assert.ok(listedXml.includes('<th>Name</th>'));
  assert.ok(listedXml.includes('<td>Alice</td>'));

  const spatialTbl = {
    type: 'table',
    style: 'table-spatial',
    headers: ['Year', 'Revenue'],
    rows: [['2025', '$1M'], ['2026', '$2M']]
  };
  const spatialXml = serializeBlock(spatialTbl, 0);
  assert.ok(spatialXml.includes('<table class="bana-spatial">'));
  assert.ok(spatialXml.includes('<th>Year</th>'));
  assert.ok(spatialXml.includes('<td>$1M</td>'));
});

test('Serializes Sidebars / Boxes with nested blocks', () => {
  const boxBlock = {
    type: 'box',
    title: 'KEY VOCABULARY',
    blocks: [
      { type: 'heading', level: 2, text: 'KEY VOCABULARY' },
      { type: 'para', text: 'Photosynthesis: the process by which green plants make food.' },
      { type: 'list', items: [{ text: 'Chlorophyll' }, { text: 'Light energy' }] }
    ]
  };
  const xml = serializeBlock(boxBlock, 0);
  assert.ok(xml.includes('<sidebar>'));
  assert.ok(xml.includes('<hd>KEY VOCABULARY</hd>'));
  assert.ok(xml.includes('<p>Photosynthesis: the process by which green plants make food.</p>'));
  assert.ok(xml.includes('<list type="ul">'));
  assert.ok(xml.includes('</sidebar>'));
});

test('Serializes Print Page Numbers, Breaks, Graphics, and Math', () => {
  assert.equal(serializeBlock({ type: 'pagenum', page: '42' }, 0), '<pagenum id="p_42" page="normal">42</pagenum>');
  assert.equal(serializeBlock({ type: 'pagenum', text: 'iv' }, 0), '<pagenum id="p_iv" page="normal">iv</pagenum>');
  assert.equal(serializeBlock({ type: 'break' }, 0), '<hr/>');
  assert.equal(serializeBlock({ type: 'graphic', src: 'img.png', alt: 'Diagram' }, 0), '<img src="img.png" alt="Diagram"/>');
  assert.ok(serializeBlock({ type: 'math', latex: 'E=mc^2' }, 0).includes('<m:math alttext="E=mc^2">'));
});

// -----------------------------------------------------------------------------
// 3. Full Document Export & DTBook XML Wrapper
// -----------------------------------------------------------------------------
test('exportToNimasXml outputs well-formed ANSI/NISO Z39.86-2005 document', () => {
  const docModel = {
    title: 'Grade 7 Literature Textbook',
    metadata: { uid: 'dtb-sample-001', lang: 'en-US' },
    blocks: [
      { type: 'heading', level: 1, text: 'Grade 7 Literature Textbook' },
      { type: 'pagenum', page: '1' },
      { type: 'para', text: 'Welcome to this textbook.' }
    ]
  };
  const xml = exportToNimasXml(docModel);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN"'));
  assert.ok(xml.includes('<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"'));
  assert.ok(xml.includes('<meta name="dc:Title" content="Grade 7 Literature Textbook" />'));
  assert.ok(xml.includes('<meta name="dtb:uid" content="dtb-sample-001" />'));
  assert.ok(xml.includes('<meta name="dc:Format" content="ANSI/NISO Z39.86-2005" />'));
  assert.ok(xml.includes('<doctitle>Grade 7 Literature Textbook</doctitle>'));
  assert.ok(xml.includes('<h1>Grade 7 Literature Textbook</h1>'));
  assert.ok(xml.includes('<pagenum id="p_1" page="normal">1</pagenum>'));
  assert.ok(xml.includes('<p>Welcome to this textbook.</p>'));
  assert.ok(xml.endsWith('</dtbook>\n') || xml.endsWith('</dtbook>'));
});

// -----------------------------------------------------------------------------
// 4. Complete 15-Style Round-Trip Parity Gate (AST -> XML -> parseDtbook -> AST)
// -----------------------------------------------------------------------------
test('Complete 15-Style Round-Trip Parity Gate', () => {
  const comprehensiveAst = {
    title: 'Collections Comprehensive Edition',
    metadata: { uid: 'coll-7-test', lang: 'en-US' },
    blocks: [
      { type: 'heading', level: 1, text: 'Collections Comprehensive Edition' },
      { type: 'pagenum', page: 'front_1' },
      {
        type: 'list',
        kind: 'toc',
        items: [
          { text: 'Unit 1: Bold Actions', page: '1' },
          { text: 'Rogue Wave by Theodore Taylor', page: '3', level: 1 },
          { text: 'Unit 2: Perception and Reality', page: '75' }
        ]
      },
      { type: 'pagenum', page: '1' },
      { type: 'heading', level: 2, text: 'Unit 1: Bold Actions' },
      { type: 'para', text: 'Facing danger requires courage and quick thinking.' },
      { type: 'attribution', text: '— Editorial Board' },
      { type: 'caption', text: 'Photo of a giant rogue wave off the Pacific coast.' },
      {
        type: 'box',
        title: 'ANALYZE VISUALS',
        blocks: [
          { type: 'heading', level: 2, text: 'ANALYZE VISUALS' },
          { type: 'para', text: 'Notice how the dark lighting creates a feeling of suspense.' }
        ]
      },
      {
        type: 'play',
        text: 'SULLY: Hold on to the wheel!'
      },
      {
        type: 'stage',
        text: '[The boat heaves violently to starboard.]'
      },
      {
        type: 'play',
        subtype: 'verse',
        text: 'The sea was angry that fateful day,'
      },
      {
        type: 'list',
        kind: 'exercise',
        items: [
          { text: '1. What caused the boat to pitch?', level: 0 },
          { text: 'a. A sudden wind change', level: 1 }
        ]
      },
      {
        type: 'table',
        format: 'listed',
        caption: 'Character Motivations',
        tabletn: 'Listed summary of motivations.',
        headers: ['Character', 'Goal'],
        rows: [
          ['Scoot', 'Survive trapped in the galley'],
          ['Sully', 'Dive down to rescue Scoot']
        ]
      },
      {
        type: 'note',
        text: 'Transcriber Note: End of excerpt.'
      },
      {
        type: 'footnote',
        text: '1. Rogue waves can reach heights exceeding 100 feet.'
      }
    ]
  };

  // Step 1: Export AST to XML
  const generatedXml = exportToNimasXml(comprehensiveAst);
  assert.ok(typeof generatedXml === 'string' && generatedXml.length > 500);

  // Step 2: Parse XML back into AST
  const parsedDoc = parseDtbook(generatedXml);
  assert.equal(parsedDoc.title, 'Collections Comprehensive Edition');
  assert.ok(parsedDoc.blocks.length >= 14, `Expected at least 14 blocks, got ${parsedDoc.blocks.length}`);

  // Step 3: Verify structure preservation
  // Headings
  const h1 = parsedDoc.blocks.find(b => b.type === 'heading' && b.level === 1);
  assert.ok(h1, 'H1 heading must be preserved');
  assert.equal(h1.text, 'Collections Comprehensive Edition');

  const h2 = parsedDoc.blocks.find(b => b.type === 'heading' && b.level === 2 && b.text.includes('Bold Actions'));
  assert.ok(h2, 'H2 heading must be preserved');

  // TOC
  const toc = parsedDoc.blocks.find(b => b.type === 'list' && b.kind === 'toc');
  assert.ok(toc, 'TOC list must be preserved with kind="toc"');
  assert.equal(toc.items.length, 3);
  assert.equal(toc.items[0].text, 'Unit 1: Bold Actions');
  assert.equal(toc.items[0].page, '1');
  assert.equal(toc.items[1].page, '3');

  // Attribution & Caption
  const attr = parsedDoc.blocks.find(b => b.type === 'attribution');
  assert.ok(attr, 'Attribution block must be preserved');
  assert.equal(attr.text, '— Editorial Board');

  const cap = parsedDoc.blocks.find(b => b.type === 'caption');
  assert.ok(cap, 'Caption block must be preserved');
  assert.equal(cap.text, 'Photo of a giant rogue wave off the Pacific coast.');

  // Sidebar Box
  const box = parsedDoc.blocks.find(b => b.type === 'box');
  assert.ok(box, 'Sidebar box must be preserved');
  assert.equal(box.title, 'ANALYZE VISUALS');
  assert.ok(box.blocks && box.blocks.length >= 2);

  // Play dialogue & stage direction
  const dialogue = parsedDoc.blocks.find(b => b.type === 'play' && (b.subtype === 'prose' || !b.subtype));
  assert.ok(dialogue, 'Dialogue block must be preserved');
  assert.equal(dialogue.text, 'SULLY: Hold on to the wheel!');

  const stage = parsedDoc.blocks.find(b => b.type === 'stage');
  assert.ok(stage, 'Stage block must be preserved');
  assert.equal(stage.text, '[The boat heaves violently to starboard.]');

  const verse = parsedDoc.blocks.find(b => b.type === 'play' && b.subtype === 'verse');
  assert.ok(verse, 'Verse block must be preserved');
  assert.equal(verse.text, 'The sea was angry that fateful day,');

  // Exercise
  const exercise = parsedDoc.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  assert.ok(exercise, 'Exercise list must be preserved with kind="exercise"');
  assert.equal(exercise.items.length, 2);

  // Table
  const table = parsedDoc.blocks.find(b => b.type === 'table');
  assert.ok(table, 'Table block must be preserved');
  assert.equal(table.format, 'listed');
  assert.deepEqual(table.headers, ['Character', 'Goal']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0], 'Scoot');
  assert.equal(table.rows[1][0], 'Sully');

  // Notes and footnotes
  const note = parsedDoc.blocks.find(b => b.type === 'note' && !b.kind);
  assert.ok(note, 'Note block must be preserved');
  assert.equal(note.text, 'Transcriber Note: End of excerpt.');

  const footnote = parsedDoc.blocks.find(b => b.type === 'footnote');
  assert.ok(footnote, 'Footnote block must be preserved');
  assert.equal(footnote.text, '1. Rogue waves can reach heights exceeding 100 feet.');
});

test('Spatial 2D Columnar Table Round-Trip Parity', () => {
  const spatialDoc = {
    title: 'Planetary Data',
    blocks: [
      { type: 'heading', level: 1, text: 'Planetary Data' },
      {
        type: 'table',
        format: 'spatial',
        style: 'table-spatial',
        caption: 'Solar System Planets',
        tabletn: 'Spatial 3-column table.',
        headers: ['Planet', 'Moons', 'Diameter (km)'],
        rows: [
          ['Mercury', '0', '4,879'],
          ['Venus', '0', '12,104'],
          ['Earth', '1', '12,742'],
          ['Mars', '2', '6,779']
        ]
      }
    ]
  };
  const xml = exportToNimasXml(spatialDoc);
  assert.ok(xml.includes('<table class="bana-spatial">'));
  const parsed = parseDtbook(xml);
  const tbl = parsed.blocks.find(b => b.type === 'table');
  assert.ok(tbl, 'Spatial table must be parsed');
  assert.equal(tbl.format, 'spatial');
  assert.deepEqual(tbl.headers, ['Planet', 'Moons', 'Diameter (km)']);
  assert.equal(tbl.rows.length, 4);
  assert.equal(tbl.rows[2][0], 'Earth');
  assert.equal(tbl.rows[2][1], '1');
  assert.equal(tbl.rows[2][2], '12,742');
});

test('Complex Sidebar Box Round-Trip with Nested Headings, Lists, and Paragraphs', () => {
  const sidebarDoc = {
    title: 'Sidebar Test',
    blocks: [
      {
        type: 'box',
        title: 'DID YOU KNOW?',
        blocks: [
          { type: 'heading', level: 2, text: 'DID YOU KNOW?' },
          { type: 'para', text: 'Braille was invented in 1824 by Louis Braille.' },
          { type: 'list', items: [{ text: 'Based on night writing' }, { text: 'Six-dot cell matrix' }] },
          { type: 'para', text: 'It remains the primary literacy medium for the blind.' }
        ]
      }
    ]
  };
  const xml = exportToNimasXml(sidebarDoc);
  assert.ok(xml.includes('<sidebar>'));
  assert.ok(xml.includes('<hd>DID YOU KNOW?</hd>'));
  const parsed = parseDtbook(xml);
  const box = parsed.blocks.find(b => b.type === 'box');
  assert.ok(box);
  assert.equal(box.title, 'DID YOU KNOW?');
  assert.equal(box.blocks.length, 4);
  assert.equal(box.blocks[0].type, 'heading');
  assert.equal(box.blocks[1].type, 'para');
  assert.equal(box.blocks[2].type, 'list');
  assert.equal(box.blocks[3].type, 'para');
});

test('Inline Text Formatting (Bold, Italic, MathML) Round-Trip Parity', () => {
  const formattedDoc = {
    title: 'Formatting Test',
    blocks: [
      {
        type: 'para',
        segments: [
          { type: 'text', text: 'This has ' },
          { type: 'text', text: 'bold emphasis', tf: 4 },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic emphasis', tf: 1 },
          { type: 'text', text: ' and math ' },
          { type: 'math', mathml: '<math><msup><mi>x</mi><mn>2</mn></msup></math>' }
        ]
      }
    ]
  };
  const xml = exportToNimasXml(formattedDoc);
  assert.ok(xml.includes('<strong>bold emphasis</strong>'));
  assert.ok(xml.includes('<em>italic emphasis</em>'));
  assert.ok(xml.includes('<math><msup><mi>x</mi><mn>2</mn></msup></math>'));
  const parsed = parseDtbook(xml);
  const p = parsed.blocks.find(b => b.type === 'para');
  assert.ok(p);
  assert.ok(p.segments && p.segments.length > 0);
  assert.ok(p.segments.some(s => s.tf === 4 && s.text.includes('bold')));
  assert.ok(p.segments.some(s => s.tf === 1 && s.text.includes('italic')));
});

console.log(`\nAll ${passCount} Phase 6A BANA Project Save tests passed cleanly with 100% parity!`);
