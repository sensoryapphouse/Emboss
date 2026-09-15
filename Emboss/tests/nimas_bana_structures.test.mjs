import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNimasXml, parseMarkdown, parseHtml } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

test('Step 1: <bridgehead> is parsed as level-2 heading and formatted at Cell 5 in BANA mode', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>Main Chapter</h1>
        <p>Paragraph before bridgehead.</p>
        <bridgehead>Analyze the Text</bridgehead>
        <p>Paragraph following bridgehead.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const bridgeheadBlock = doc.blocks.find((b) => b.text === 'Analyze the Text');
  assert.ok(bridgeheadBlock, 'Bridgehead block should be found');
  assert.equal(bridgeheadBlock.type, 'heading', 'Bridgehead should be parsed as heading');
  assert.equal(bridgeheadBlock.level, 2, 'Bridgehead should be level 2 (Cell 5 heading)');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  // Cell 5 heading is indented by 4 spaces
  const headingLine = lines.find((l) => l.includes('ANALYZE THE TEXT'));
  assert.ok(headingLine, 'Heading text should be in formatted output');
  assert.equal(headingLine.indexOf('ANALYZE THE TEXT'), 4, 'Heading should start at cell 5 (4 spaces)');
});

test('Step 1: <byline> is parsed as attribution and formatted with blank line and Cell 5 indent', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>Poem Title</h1>
        <byline>By Emily Dickinson</byline>
        <p>This is the poem text.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const bylineBlock = doc.blocks.find((b) => b.type === 'attribution');
  assert.ok(bylineBlock, 'Attribution block should be found');
  assert.equal(bylineBlock.text, 'By Emily Dickinson');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const bylineLine = lines.find((l) => l.includes('BY EMILY DICKINSON'));
  assert.ok(bylineLine, 'Byline text should be in formatted output');
  assert.equal(bylineLine.indexOf('BY EMILY DICKINSON'), 4, 'Attribution should start at cell 5 (4 spaces)');
});

test('Step 2: Prose Play Dialogue is formatted with 1-3 margin (speaker cell 1, runover cell 3)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p class="bai-play" level="0">HAMLET: To be, or not to be, that is the question: whether tis nobler in the mind to suffer the slings and arrows of outrageous fortune.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const playBlock = doc.blocks.find((b) => b.type === 'play');
  assert.ok(playBlock, 'Play block should be found');
  assert.equal(playBlock.subtype, 'prose');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 30,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 2, 'Should wrap into multiple lines');
  // First line starts at cell 1 (0 leading spaces)
  assert.equal(lines[0].startsWith('HAMLET:'), true, 'Line 1 begins in cell 1');
  // Second line starts at cell 3 (2 leading spaces)
  assert.equal(lines[1].startsWith('  '), true, 'Line 2 runover is indented by 2 spaces (cell 3)');
  assert.notEqual(lines[1].startsWith('   '), true, 'Line 2 runover should not be 3 or more spaces');
});

test('Step 2: Stage Directions are formatted with 7-7 margin (indented 6 spaces)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p class="bai-stage" level="0">[Exit Hamlet, dragging out Polonius into the adjacent corridor.]</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const stageBlock = doc.blocks.find((b) => b.type === 'stage');
  assert.ok(stageBlock, 'Stage block should be found');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 35,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const contentLines = brf.split(/\r?\n/).filter((l) => l.trim() && !l.includes('#A'));
  assert.ok(contentLines.length >= 2, 'Should wrap into multiple lines');
  // All stage lines start at cell 7 (6 leading spaces)
  for (const line of contentLines) {
    assert.equal(line.startsWith('      '), true, 'Every line should start at cell 7 (6 spaces)');
    assert.notEqual(line.startsWith('       '), true, 'Should not be indented more than 6 spaces');
  }
});

test('Step 3: Exercise lists (bai-exercise) are formatted with 1-5 margin for main questions and 3-5 for sub-questions', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <list>
          <li class="bai-exercise" level="0">1. Explain how the character reacts to the crisis in the opening chapter of the story.</li>
          <li class="bai-exercise" level="1">a. What specific evidence from page 12 supports your conclusion?</li>
        </list>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const listBlock = doc.blocks.find((b) => b.type === 'list');
  assert.ok(listBlock, 'List block should be found');
  assert.equal(listBlock.kind, 'exercise', 'List should have kind exercise');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 35,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).filter((l) => l.trim() && !l.includes('#A'));
  
  // Question 1 (level 0): starts in cell 1 (0 spaces), runover in cell 5 (4 spaces)
  const q1Line1 = lines.find((l) => l.startsWith('1. EXPLAIN'));
  assert.ok(q1Line1, 'Question 1 line 1 should start at cell 1');
  const q1Line2 = lines.find((l) => l.includes('CRISIS IN THE OPENING'));
  assert.ok(q1Line2, 'Question 1 line 2 should exist');
  assert.equal(q1Line2.startsWith('    '), true, 'Question 1 runover is cell 5 (4 spaces)');

  // Sub-question a (level 1): starts in cell 3 (2 spaces), runover in cell 5 (4 spaces)
  const qaLine1 = lines.find((l) => l.includes('A. WHAT SPECIFIC'));
  assert.ok(qaLine1, 'Sub-question line 1 should exist');
  assert.equal(qaLine1.startsWith('  '), true, 'Sub-question line 1 starts in cell 3 (2 spaces)');
  assert.notEqual(qaLine1.startsWith('   '), true, 'Sub-question should not have 3 or more spaces');
});

test('Step 3: Index lists (bai-index) are formatted with 1-3 margin for main entries and 3-5 for sub-entries', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <rearmatter>
      <level1>
        <list>
          <li class="bai-index" level="0">Aeronautics, historical developments and major milestones throughout the twentieth century, 142</li>
          <li class="bai-index" level="1">early gliders and flight trials, 145</li>
        </list>
      </level1>
    </rearmatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const listBlock = doc.blocks.find((b) => b.type === 'list');
  assert.ok(listBlock, 'List block should be found');
  assert.equal(listBlock.kind, 'index', 'List should have kind index');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 35,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).filter((l) => l.trim() && !l.includes('#A'));

  // Main entry (level 0): starts in cell 1 (0 spaces), runover in cell 3 (2 spaces)
  const e1Line1 = lines.find((l) => l.startsWith('AERONAUTICS,'));
  assert.ok(e1Line1, 'Main entry line 1 starts in cell 1');
  const e1Line2 = lines.find((l) => l.includes('DEVELOPMENTS AND MAJOR'));
  assert.ok(e1Line2, 'Main entry line 2 should exist');
  assert.equal(e1Line2.startsWith('  '), true, 'Main entry runover is cell 3 (2 spaces)');
  assert.notEqual(e1Line2.startsWith('   '), true, 'Main entry runover should not be 3 or more spaces');

  // Sub-entry (level 1): starts in cell 3 (2 spaces), runover in cell 5 (4 spaces)
  const e2Line1 = lines.find((l) => l.includes('EARLY GLIDERS AND FLIGHT'));
  assert.ok(e2Line1, 'Sub-entry line 1 should exist');
  assert.equal(e2Line1.startsWith('  '), true, 'Sub-entry line 1 starts in cell 3 (2 spaces)');
});

test('Step 4: Centered TOC Headings (bai-toc-center) and TOC entries (bai-toc-entry)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <frontmatter>
      <level1>
        <list>
          <li class="bai-toc-center">Collection 1 Bold Actions</li>
          <li class="bai-toc-entry" level="0">Rogue Wave Theodore Taylor 3</li>
          <li class="bai-toc-entry" level="1">Vocabulary and Comprehension Study Guide 14</li>
        </list>
      </level1>
    </frontmatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const heading = doc.blocks.find((b) => b.type === 'heading' && b.text.includes('Bold Actions'));
  assert.ok(heading, 'TOC centered heading should be converted to heading');
  assert.equal(heading.level, 1, 'TOC centered heading should be Level 1');

  const tocList = doc.blocks.find((b) => b.type === 'list' && b.kind === 'toc');
  assert.ok(tocList, 'TOC list should have kind toc');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).filter((l) => l.trim() && !l.includes('#A'));

  // Centered heading
  const centerLine = lines.find((l) => l.includes('COLLECTION 1 BOLD ACTIONS'));
  assert.ok(centerLine, 'Centered TOC line should exist');
  assert.ok(centerLine.startsWith(' '), 'Centered heading should have leading spaces');

  // TOC entry (level 0): starts in cell 1 (0 spaces), runover in cell 3
  const toc1 = lines.find((l) => l.startsWith('ROGUE WAVE'));
  assert.ok(toc1, 'Level 0 TOC entry starts in cell 1');
});

test('Step 4: Poetry Line Numbers (<linenum>) placed cleanly without disrupting verse flow', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>The wind was a torrent of darkness among the gusty trees,</line>
            <line>The moon was a ghostly galleon tossed upon cloudy seas,</line>
            <line>The road was a ribbon of moonlight over the purple moor, <linenum>5</linenum></line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const linesWithLinenum = doc.blocks.filter((b) => (b.type === 'para' || b.type === 'play') && b.text && b.text.includes('ribbon of moonlight'));
  assert.ok(linesWithLinenum.length > 0, 'Poem line should be parsed');
  assert.ok(linesWithLinenum[0].text.includes('5'), 'Line number should be retained in the block');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const brfLines = brf.split(/\r?\n/).filter((l) => l.trim() && !l.includes('#A'));
  const targetLine = brfLines.find((l) => l.includes('RIBBON OF MOONLIGHT'));
  assert.ok(targetLine, 'Poem line should be present in braille output');
});

test('Step 1 (Parity): Inline <em>, <strong>, <b>, <i>, <u> generate UEB typeform segments', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>This has <em>italic words</em> and <strong>bold words</strong> and <u>underlined</u> text.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const para = doc.blocks[0];
  assert.ok(para.segments, 'Paragraph with formatting should be parsed as segments');
  assert.ok(para.segments.length >= 3, 'Should have multiple segments');
  
  const italicSeg = para.segments.find(s => s.text && s.text.includes('italic words'));
  assert.ok(italicSeg, 'Italic segment should exist');
  assert.equal(italicSeg.tf & 1, 1, 'Italic segment should have TF_ITALIC (1)');

  const boldSeg = para.segments.find(s => s.text && s.text.includes('bold words'));
  assert.ok(boldSeg, 'Bold segment should exist');
  assert.equal(boldSeg.tf & 4, 4, 'Bold segment should have TF_BOLD (4)');

  const underSeg = para.segments.find(s => s.text && s.text.includes('underlined'));
  assert.ok(underSeg, 'Underline segment should exist');
  assert.equal(underSeg.tf & 2, 2, 'Underline segment should have TF_UNDERLINE (2)');
});

test('Step 1 (Parity): Markdown *italic* and **bold** generate typeform segments', () => {
  const md = `This is a paragraph with *italic text* and **bold text**.`;
  const doc = parseMarkdown(md);
  const para = doc.blocks[0];
  assert.ok(para.segments, 'Markdown paragraph with formatting should be segmented');
  const italicSeg = para.segments.find(s => s.text && s.text.includes('italic text'));
  assert.ok(italicSeg, 'Italic segment should exist in markdown');
  assert.equal(italicSeg.tf & 1, 1, 'Markdown italic should have TF_ITALIC');
  const boldSeg = para.segments.find(s => s.text && s.text.includes('bold text'));
  assert.ok(boldSeg, 'Bold segment should exist in markdown');
  assert.equal(boldSeg.tf & 4, 4, 'Markdown bold should have TF_BOLD');
});

test('Step 1 (Parity): formatDocument passes typeform bits to translate for inline formatting', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Text with <em>italic emphasis</em> included.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const receivedTfs = [];
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (str, tf) => {
      if (tf) receivedTfs.push({ str, tf });
      return str.toUpperCase();
    }
  });

  const italicCall = receivedTfs.find(c => c.str.includes('italic emphasis'));
  assert.ok(italicCall, 'Translator should receive italic emphasis string with tf array');
  assert.ok(italicCall.tf.every(b => (b & 1) === 1), 'All characters in italic emphasis should have italic bit 1');
});

test('Step 2 (Parity): Multi-element <sidebar> preserves distinct child paragraphs, lists, and formatting inside boxlines', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar>
          <hd>Science Spotlight</hd>
          <p>This is paragraph one with <em>italic key</em>.</p>
          <list>
            <li>Fact A</li>
            <li>Fact B</li>
          </list>
          <p>This is paragraph two.</p>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const boxBlock = doc.blocks.find(b => b.type === 'box');
  assert.ok(boxBlock, 'Box block should be found');
  assert.equal(boxBlock.title, 'Science Spotlight');
  assert.ok(boxBlock.blocks && boxBlock.blocks.length >= 3, 'Box should contain child blocks (p, list, p)');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  assert.ok(lines.some(l => l.startsWith('333 SCIENCE SPOTLIGHT')), 'Should have top boxline with title');
  assert.ok(lines.some(l => l.includes('PARAGRAPH ONE')), 'Should have paragraph one');
  assert.ok(lines.some(l => l.includes('FACT A')), 'Should have list items');
  assert.ok(lines.some(l => l.includes('PARAGRAPH TWO')), 'Should have paragraph two');
  assert.ok(lines.some(l => l.startsWith('77777777')), 'Should have bottom boxline');
});

test('Step 3 (Parity): Table of Contents entries generate BANA dot leaders connecting to right-margin page numbers', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <frontmatter>
      <level1>
        <h1>Contents</h1>
        <list class="toc">
          <li class="bai-toc-entry">
            <lic class="bai-toc-text">Collection 1: Bold Actions</lic>
            <lic class="bai-toc-page">1</lic>
          </li>
          <li class="bai-toc-entry" level="1">
            <lic class="bai-toc-text">Rogue Wave by Theodore Taylor</lic>
            <lic class="bai-toc-page">3</lic>
          </li>
        </list>
      </level1>
    </frontmatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const listBlock = doc.blocks.find(b => b.type === 'list' && b.kind === 'toc');
  assert.ok(listBlock, 'TOC list block should be found');
  assert.equal(listBlock.items.length, 2, 'Should have 2 TOC items');
  assert.ok(listBlock.items[0].page, 'First item should have page number');
  assert.equal(listBlock.items[0].page, '1');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const entryLine = lines.find(l => l.includes('COLLECTION 1: BOLD ACTIONS'));
  assert.ok(entryLine, 'TOC entry line should exist');
  assert.ok(entryLine.endsWith('1'), 'Line should end with page number 1 right-aligned');
  assert.ok(entryLine.includes('""'), 'Line should contain BANA dot leaders (dots 5 "")');
});

test('Step 4 (Parity): <note class="footnote"> is formatted with BANA 1-3 margin (Cell 1 first, Cell 3 runover) without TN quotes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Main text referring to the note<noteref idref="#fn1">1</noteref>.</p>
        <note id="fn1" class="footnote">1. This is a scholarly footnote explaining the historical origin in depth.</note>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const fnBlock = doc.blocks.find(b => b.type === 'footnote');
  assert.ok(fnBlock, 'Footnote block should be found with type footnote');

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const fnLine = lines.find(l => l.startsWith('1. THIS IS A SCHOLARLY FOOTNOTE'));
  assert.ok(fnLine, 'Footnote line should start at Cell 1 (no indent)');
  assert.ok(!fnLine.includes("'"), 'Footnote should not have transcriber note apostrophe quotes');
});

test('Step 5 (Parity): <br/> in stanzas or addresses forces a new braille line without new paragraph indent', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>123 High Street<br/>Springfield, IL 62701<br/>USA</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(Boolean);
  assert.ok(lines.length >= 3, 'Address with 2 <br/> tags should produce at least 3 distinct braille lines');
  assert.ok(lines[0].includes('123 HIGH STREET'), 'Line 1 should contain street address');
  assert.ok(lines[1].includes('SPRINGFIELD, IL 62701'), 'Line 2 should contain city/state/zip');
  assert.ok(lines[2].includes('USA'), 'Line 3 should contain country');
});

test('Step 6 (Parity): Inline <span class="uncontracted"> and <code> produce uncontracted segments with Grade 1 translation', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>Type <code class="bai-trans4">printf("hello")</code> in terminal or <span class="uncontracted">spellout</span>.</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const para = doc.blocks[0];
  assert.ok(para.segments, 'Paragraph should be parsed as segments');
  
  const codeSeg = para.segments.find(s => s.text && s.text.includes('printf'));
  assert.ok(codeSeg, 'Code segment should exist');
  assert.equal(codeSeg.uncontracted, true, 'Code segment should have uncontracted: true');

  const uncontractedSeg = para.segments.find(s => s.text && s.text.includes('spellout'));
  assert.ok(uncontractedSeg, 'Uncontracted segment should exist');
  assert.equal(uncontractedSeg.uncontracted, true, 'Uncontracted segment should have uncontracted: true');

  const g1Calls = [];
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
    translateG1: (s) => {
      g1Calls.push(s);
      return '[G1:' + s.toUpperCase() + ']';
    }
  });

  assert.ok(g1Calls.some(s => s.includes('printf')), 'translateG1 should be called for code');
  assert.ok(g1Calls.some(s => s.includes('spellout')), 'translateG1 should be called for spellout');
  assert.ok(brf.includes('[G1:PRINTF("HELLO")]'), 'BRF should include Grade 1 translated code span');
});

test('Step 7 (Parity): <tabletn> inside or preceding <table> emits a BANA transcriber note block with TN quotes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <tabletn>Table note: column 1 lists atomic symbols; column 2 lists atomic weights.</tabletn>
          <tr><th>Symbol</th><th>Weight</th></tr>
          <tr><td>H</td><td>1.008</td></tr>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const noteBlock = doc.blocks.find(b => b.type === 'note' && b.kind === 'tabletn');
  assert.ok(noteBlock, 'Table transcriber note block should be found');
  assert.ok(noteBlock.text.includes('column 1 lists atomic symbols'));

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const tnLine = lines.find(l => l.includes('TABLE NOTE: COLUMN 1 LISTS'));
  assert.ok(tnLine, 'Table transcriber note line should exist in BRF');
  assert.ok(tnLine.includes('@.<') || tnLine.includes("'") || tnLine.includes('@'), 'BANA table note should contain transcriber note quote indicators');
});

test('Step 8 (Parity): <caption> and <figcaption> are formatted with BANA 7-5 margin (Cell 7 first, Cell 5 runover)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <table>
          <caption>Table 1.1: Densities of common planetary elements and materials.</caption>
          <tr><th>Element</th><th>Density</th></tr>
          <tr><td>Iron</td><td>7.87</td></tr>
        </table>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const captionBlock = doc.blocks.find(b => b.type === 'caption');
  assert.ok(captionBlock, 'Caption block should be extracted');
  assert.ok(captionBlock.text.includes('Densities of common planetary elements'));

  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 40,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const lines = brf.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const capLine = lines.find(l => l.includes('TABLE 1.1: DENSITIES'));
  assert.ok(capLine, 'Caption line should exist in BRF');
  assert.ok(capLine.startsWith('      TABLE 1.1: DENSITIES'), 'BANA caption first line should start at Cell 7 (6 leading spaces)');
});
