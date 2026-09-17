// Test Suite: Project Load / Open Parity & Round-Trip Invariants (Phase 6C)
// Verifies multi-format file ingestion (XML, NIMAS, DTBook, DOCX, MD, HTML, EPUB, TXT),
// BANA style rehydration, and triple-hop round-trip invariance (AST1 -> XML1 -> AST2 -> XML2 -> AST3).

import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseFile, parseDtbook, parseNimasXml, BINARY_EXTS } from '../input/parse.mjs';
import { exportToNimasXml, serializeBlock } from '../input/nimas-export.mjs';
import { STYLE_DEFINITIONS } from '../format/styles.mjs';

console.log('=== Running Project Load / Open Parity & Invariants Tests (Phase 6C) ===');

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

// -----------------------------------------------------------------------------
// 1. File Dispatch & Extension Ingestion
// -----------------------------------------------------------------------------
test('BINARY_EXTS includes all required binary package formats', () => {
  assert.ok(BINARY_EXTS.has('docx'), 'docx must be binary');
  assert.ok(BINARY_EXTS.has('odt'), 'odt must be binary');
  assert.ok(BINARY_EXTS.has('epub'), 'epub must be binary');
  assert.ok(BINARY_EXTS.has('zip'), 'zip must be binary');
  assert.ok(BINARY_EXTS.has('ebrl'), 'ebrl must be binary');
  assert.ok(BINARY_EXTS.has('ebraille'), 'ebraille must be binary');
});

await testAsync('parseFile routes .xml, .nimas, and .dtbook strings to parseDtbook', async () => {
  const xmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en-US">
  <head><meta name="dc:Title" content="Science Grade 7" /></head>
  <book>
    <bodymatter>
      <level1>
        <h1>Cell Structure</h1>
        <p>Cells are the fundamental units of life.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const docFromXml = await parseFile('document.xml', xmlSample);
  assert.equal(docFromXml.title, 'Science Grade 7');
  assert.equal(docFromXml.blocks.length, 2);

  const docFromNimas = await parseFile('textbook.nimas', xmlSample);
  assert.equal(docFromNimas.title, 'Science Grade 7');
  assert.equal(docFromNimas.blocks.length, 2);

  const docFromDtbook = await parseFile('textbook.dtbook', xmlSample);
  assert.equal(docFromDtbook.title, 'Science Grade 7');
  assert.equal(docFromDtbook.blocks.length, 2);
});

await testAsync('parseFile routes Markdown text correctly', async () => {
  const mdSample = `# Chapter 1: Motion\n\nSpeed is the distance traveled divided by time.\n\n* First\n* Second`;
  const doc = await parseFile('notes.md', mdSample);
  assert.ok(doc.blocks.length >= 2);
  assert.ok(doc.blocks[0].type === 'heading' || doc.blocks[0].type === 'title');
  assert.equal(doc.blocks[0].text, 'Chapter 1: Motion');
});

await testAsync('parseFile routes HTML text correctly', async () => {
  const htmlSample = `<!DOCTYPE html><html><head><title>HTML Doc</title></head><body><h1>Web Title</h1><p>Paragraph body.</p></body></html>`;
  const doc = await parseFile('sample.html', htmlSample);
  assert.ok(doc.blocks.length >= 2);
  assert.equal(doc.blocks[0].type, 'heading');
  assert.equal(doc.blocks[0].text, 'Web Title');
});

// -----------------------------------------------------------------------------
// 2. Complete 15 BANA Style Rehydration Parity
// -----------------------------------------------------------------------------
test('Rehydrates all 15 BANA styles from NIMAS DTBook XML with 100% fidelity', () => {
  const sourceXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="en-US">
  <head>
    <meta name="dc:Title" content="BANA Master Taxonomy" />
  </head>
  <book>
    <frontmatter>
      <doctitle>BANA Master Taxonomy</doctitle>
    </frontmatter>
    <bodymatter>
      <level1>
        <h1>Major Heading (H1)</h1>
        <h2>Subheading (H2)</h2>
        <h3>Minor Heading (H3)</h3>
        <pagenum id="p_1" page="normal">1</pagenum>
        <p>Standard paragraph with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, and <code class="uncontracted">NASA</code> uncontracted code.</p>
        <list type="pl" class="toc">
          <li class="bai-toc-entry"><lic class="bai-toc-text">Chapter 1: Introduction</lic><lic class="bai-toc-page">1</lic></li>
          <li class="bai-toc-entry" level="1"><lic class="bai-toc-text">Section 1.1: Background</lic><lic class="bai-toc-page">5</lic></li>
        </list>
        <list type="ul">
          <li>Unordered bullet item 1</li>
          <li>Unordered bullet item 2</li>
        </list>
        <list type="ol">
          <li>Ordered numbered item 1</li>
          <li>Ordered numbered item 2</li>
        </list>
        <list type="ol" class="bai-exercise">
          <li class="bai-exercise">1. Solve the quadratic equation:</li>
          <li class="bai-exercise" level="1">a. x^2 - 4 = 0</li>
        </list>
        <p class="bai-play">ROMEO: Lady, by yonder blessed moon I vow.</p>
        <p class="bai-stage">[Juliet appears on the balcony above.]</p>
        <p class="bai-verse">Shall I compare thee to a summer's day?</p>
        <table class="bana-listed">
          <caption>Element Properties</caption>
          <tabletn>Listed table with 2 columns.</tabletn>
          <thead><tr><th>Element</th><th>Symbol</th></tr></thead>
          <tbody>
            <tr><td>Hydrogen</td><td>H</td></tr>
            <tr><td>Helium</td><td>He</td></tr>
          </tbody>
        </table>
        <table class="bana-spatial">
          <caption>Planetary Radii</caption>
          <thead><tr><th>Planet</th><th>Radius (km)</th></tr></thead>
          <tbody>
            <tr><td>Earth</td><td>6371</td></tr>
          </tbody>
        </table>
        <sidebar>
          <hd>DID YOU KNOW?</hd>
          <p>Braille cells consist of 6 embossed dots in a 3x2 matrix.</p>
        </sidebar>
        <prodnote>Transcriber Note: End of unit.</prodnote>
        <note class="footnote">1. Reference source: Astronomical Almanac.</note>
        <caption>Figure 1: Earth orbit trajectory.</caption>
        <byline>— Dr. Jane Goodall</byline>
        <m:math alttext="a^2 + b^2 = c^2"><m:semantics><m:annotation encoding="application/x-tex">a^2 + b^2 = c^2</m:annotation></m:semantics></m:math>
        <hr/>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const model = parseDtbook(sourceXml);
  assert.equal(model.title, 'BANA Master Taxonomy');

  // Verify Headings
  const h1 = model.blocks.find(b => b.type === 'heading' && b.level === 1);
  assert.ok(h1);
  assert.equal(h1.text, 'Major Heading (H1)');

  const h2 = model.blocks.find(b => b.type === 'heading' && b.level === 2);
  assert.ok(h2);
  assert.equal(h2.text, 'Subheading (H2)');

  const h3 = model.blocks.find(b => b.type === 'heading' && b.level === 3);
  assert.ok(h3);
  assert.equal(h3.text, 'Minor Heading (H3)');

  // Verify Page Number
  const pagenum = model.blocks.find(b => b.type === 'pagenum');
  assert.ok(pagenum);
  assert.equal(pagenum.text, '1');

  // Verify Paragraph with inline segments
  const para = model.blocks.find(b => b.type === 'para');
  assert.ok(para);
  assert.ok(para.segments && para.segments.length > 0);
  assert.ok(para.segments.some(s => s.tf === 4 && s.text.includes('bold')));
  assert.ok(para.segments.some(s => s.tf === 1 && s.text.includes('italic')));
  assert.ok(para.segments.some(s => s.tf === 2 && s.text.includes('underline')));
  assert.ok(para.segments.some(s => s.uncontracted === true && s.text.includes('NASA')));

  // Verify TOC
  const toc = model.blocks.find(b => b.type === 'list' && b.kind === 'toc');
  assert.ok(toc);
  assert.equal(toc.items.length, 2);
  assert.equal(toc.items[0].page, '1');
  assert.equal(toc.items[1].page, '5');

  // Verify Exercise
  const ex = model.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  assert.ok(ex);
  assert.equal(ex.items.length, 2);

  // Verify Drama & Poetry
  const dialogue = model.blocks.find(b => b.type === 'play' && (b.subtype === 'prose' || !b.subtype));
  assert.ok(dialogue);
  assert.equal(dialogue.text, 'ROMEO: Lady, by yonder blessed moon I vow.');

  const stage = model.blocks.find(b => b.type === 'stage');
  assert.ok(stage);
  assert.equal(stage.text, '[Juliet appears on the balcony above.]');

  const verse = model.blocks.find(b => b.type === 'play' && b.subtype === 'verse');
  assert.ok(verse);
  assert.equal(verse.text, "Shall I compare thee to a summer's day?");

  // Verify Listed Table
  const listedTable = model.blocks.find(b => b.type === 'table' && b.format === 'listed');
  assert.ok(listedTable);
  assert.deepEqual(listedTable.headers, ['Element', 'Symbol']);
  assert.equal(listedTable.rows.length, 2);

  // Verify Spatial Table
  const spatialTable = model.blocks.find(b => b.type === 'table' && b.format === 'spatial');
  assert.ok(spatialTable);
  assert.deepEqual(spatialTable.headers, ['Planet', 'Radius (km)']);
  assert.equal(spatialTable.rows.length, 1);

  // Verify Sidebar
  const sidebar = model.blocks.find(b => b.type === 'box');
  assert.ok(sidebar);
  assert.equal(sidebar.title, 'DID YOU KNOW?');
  assert.ok(sidebar.blocks && sidebar.blocks.length >= 2);

  // Verify Notes, Footnotes, Caption, Attribution
  const note = model.blocks.find(b => b.type === 'note' && b.text.includes('Transcriber Note'));
  assert.ok(note);
  assert.equal(note.text, 'Transcriber Note: End of unit.');

  const footnote = model.blocks.find(b => b.type === 'footnote');
  assert.ok(footnote);
  assert.equal(footnote.text, '1. Reference source: Astronomical Almanac.');

  const caption = model.blocks.find(b => b.type === 'caption' && b.text.includes('Figure 1'));
  assert.ok(caption);
  assert.equal(caption.text, 'Figure 1: Earth orbit trajectory.');

  const attribution = model.blocks.find(b => b.type === 'attribution');
  assert.ok(attribution);
  assert.equal(attribution.text, '— Dr. Jane Goodall');

  // Verify Math
  const math = model.blocks.find(b => b.type === 'math');
  assert.ok(math);
  assert.ok(math.mathml || math.latex);
});

// -----------------------------------------------------------------------------
// 3. Triple-Hop Round-Trip Invariance Gate (AST1 -> XML1 -> AST2 -> XML2 -> AST3)
// -----------------------------------------------------------------------------
test('Triple-Hop Round-Trip Invariance: AST1 -> XML1 -> AST2 -> XML2 -> AST3', () => {
  const ast1 = {
    title: 'Round Trip Parity Document',
    metadata: { uid: 'parity-triple-hop', lang: 'en-US' },
    blocks: [
      { type: 'heading', level: 1, text: 'Round Trip Parity Document' },
      { type: 'pagenum', page: 'front_i' },
      {
        type: 'list',
        kind: 'toc',
        items: [
          { text: 'Unit 1: The Cosmos', page: '1' },
          { text: 'Chapter 1: Solar Flares', page: '12', level: 1 }
        ]
      },
      { type: 'pagenum', page: '1' },
      { type: 'heading', level: 2, text: 'Unit 1: The Cosmos' },
      {
        type: 'para',
        segments: [
          { type: 'text', text: 'The sun is a ' },
          { type: 'text', text: 'G-type main-sequence star', tf: 4 },
          { type: 'text', text: ' denoted as ' },
          { type: 'text', text: 'G2V', uncontracted: true },
          { type: 'text', text: '.' }
        ]
      },
      {
        type: 'play',
        text: 'ASTRONOMER: Look at the solar prominence!'
      },
      {
        type: 'stage',
        text: '[The observatory telescope rotates slowly.]'
      },
      {
        type: 'play',
        subtype: 'verse',
        text: 'Stars whisper in the velvet night,'
      },
      {
        type: 'caption',
        text: 'Table 1: Solar Layers'
      },
      {
        type: 'note',
        kind: 'tabletn',
        text: 'Listed table of solar layers.'
      },
      {
        type: 'table',
        format: 'listed',
        headers: ['Layer', 'Temperature'],
        rows: [
          ['Core', '15,000,000 K'],
          ['Corona', '1,000,000 K']
        ]
      },
      {
        type: 'box',
        title: 'FAST FACT',
        blocks: [
          { type: 'heading', level: 2, text: 'FAST FACT' },
          { type: 'para', text: 'Light takes about 8 minutes and 20 seconds to reach Earth.' }
        ]
      },
      { type: 'note', text: 'Transcriber Note: Diagram omitted for brevity.' },
      { type: 'footnote', text: '1. Source: NASA Solar Dynamics Observatory.' },
      { type: 'caption', text: 'Image of a coronal mass ejection.' },
      { type: 'attribution', text: '— NASA / SDO Team' }
    ]
  };

  // Hop 1: AST1 -> XML1
  const xml1 = exportToNimasXml(ast1);

  // Hop 2: XML1 -> AST2
  const ast2 = parseDtbook(xml1);

  // Hop 3: AST2 -> XML2
  const xml2 = exportToNimasXml(ast2);

  // Hop 4: XML2 -> AST3
  const ast3 = parseDtbook(xml2);

  // Assert Deep Invariance
  assert.equal(ast2.title, ast1.title, 'Title must survive Hop 1');
  assert.equal(ast3.title, ast2.title, 'Title must survive Hop 2');

  assert.equal(ast2.blocks.length, ast1.blocks.length, 'Block count must match in AST2');
  assert.equal(ast3.blocks.length, ast2.blocks.length, 'Block count must match in AST3');

  // Compare block types across all 3 ASTs
  for (let i = 0; i < ast1.blocks.length; i++) {
    const b1 = ast1.blocks[i];
    const b2 = ast2.blocks[i];
    const b3 = ast3.blocks[i];

    assert.equal(b2.type, b1.type, `Block ${i} type must match between AST1 and AST2 (${b1.type})`);
    assert.equal(b3.type, b2.type, `Block ${i} type must match between AST2 and AST3 (${b2.type})`);

    if (b1.text) {
      assert.equal(b2.text, b1.text, `Block ${i} text must match`);
      assert.equal(b3.text, b2.text, `Block ${i} text must match`);
    }

    if (b1.type === 'table') {
      assert.equal(b2.format, b1.format, `Table ${i} format must match`);
      assert.deepEqual(b2.headers, b1.headers, `Table ${i} headers must match`);
      assert.deepEqual(b2.rows, b1.rows, `Table ${i} rows must match`);
      assert.deepEqual(b3.rows, b2.rows, `Table ${i} rows must match in AST3`);
    }

    if (b1.type === 'box') {
      assert.equal(b2.title, b1.title, `Box ${i} title must match`);
      assert.equal(b3.title, b2.title, `Box ${i} title must match in AST3`);
      assert.equal(b2.blocks.length, b1.blocks.length, `Box ${i} child blocks count must match`);
      assert.equal(b3.blocks.length, b2.blocks.length, `Box ${i} child blocks count must match in AST3`);
    }
  }

  // Compare XML strings
  assert.equal(xml1.trim(), xml2.trim(), 'Generated XML1 and XML2 must be 100% byte-for-byte identical');
});

// -----------------------------------------------------------------------------
// 4. Mathematical Formula & Annotation Round-Trip
// -----------------------------------------------------------------------------
test('Math formulas with MathML and LaTeX annotations survive round-trip', () => {
  const astWithMath = {
    title: 'Physics & Mathematics',
    metadata: { uid: 'math-test-01', lang: 'en-US' },
    blocks: [
      { type: 'heading', level: 1, text: 'Physics & Mathematics' },
      {
        type: 'para',
        segments: [
          { type: 'text', text: 'The Einstein equation is ' },
          { type: 'math', latex: 'E = mc^2' },
          { type: 'text', text: ' in special relativity.' }
        ]
      },
      {
        type: 'math',
        latex: '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}'
      }
    ]
  };

  const xml = exportToNimasXml(astWithMath);
  assert.ok(xml.includes('alttext="E = mc^2"'));
  assert.ok(xml.includes('<m:annotation encoding="application/x-tex">E = mc^2</m:annotation>'));

  const rehydrated = parseDtbook(xml);
  assert.equal(rehydrated.blocks.length, 3);
  assert.equal(rehydrated.blocks[1].type, 'para');
  assert.ok(rehydrated.blocks[1].segments.some(s => s.type === 'math' && s.latex === 'E = mc^2'));
  assert.equal(rehydrated.blocks[2].type, 'math');
  assert.ok(rehydrated.blocks[2].latex.includes('\\int_'));
});

// -----------------------------------------------------------------------------
// 5. Nested Sidebar Card & Mixed List Round-Trip
// -----------------------------------------------------------------------------
test('Nested Sidebar Cards and Multi-level Lists survive round-trip with structure intact', () => {
  const complexAst = {
    title: 'Advanced Formatting',
    metadata: { uid: 'complex-01', lang: 'en-US' },
    blocks: [
      {
        type: 'box',
        title: 'LAB SAFETY NOTE',
        blocks: [
          { type: 'heading', level: 2, text: 'LAB SAFETY NOTE' },
          { type: 'para', text: 'Always wear protective safety goggles during chemical titration.' },
          {
            type: 'list',
            ordered: true,
            items: [
              { text: 'Step 1: Check eye wash station.', level: 0 },
              { text: 'Step 2: Inspect glassware for cracks.', level: 0 }
            ]
          }
        ]
      }
    ]
  };

  const xml = exportToNimasXml(complexAst);
  assert.ok(xml.includes('<sidebar render="required">'));
  assert.ok(xml.includes('<hd>LAB SAFETY NOTE</hd>'));
  assert.ok(xml.includes('<list type="ol">'));

  const parsed = parseDtbook(xml);
  assert.equal(parsed.blocks.length, 1);
  const box = parsed.blocks[0];
  assert.equal(box.type, 'box');
  assert.equal(box.title, 'LAB SAFETY NOTE');
  assert.equal(box.blocks.length, 3);
  assert.equal(box.blocks[2].type, 'list');
  assert.equal(box.blocks[2].items.length, 2);
});

console.log(`\nAll ${passCount} Phase 6C Project Load / Open Parity tests passed cleanly with 100% invariance!`);
