import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

test('Poetry & Verse (BANA §13): Multi-stanza poem with <title>, <linegroup>, <line>, <linenum>, <pagenum>', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <pagenum id="p40" page="normal">40</pagenum>
        <poem>
          <title>Icarus's Flight</title>
          <linegroup>
            <line>What else could the boy have done? Wasn't</line>
            <line>flight both an escape and a great uplifting?</line>
            <line>And so he flew. But how could he appreciate</line>
            <line>his freedom without knowing the exact point</line>
          </linegroup>
          <linegroup>
            <line><span class="linenum">5</span> where freedom stopped? So he flew upward</line>
            <line>and the sun dissolved the wax and he fell.</line>
            <line>But at last in his anticipated plummeting</line>
            <line>he grasped the confines of what had been</line>
          </linegroup>
          <linegroup>
            <line>his liberty. You say he flew too far?</line>
            <line><span class="linenum">10</span> He flew just far enough. He flew precisely</line>
            <line>to the point of wisdom. Would it</line>
            <line>have been better to flutter ignorantly</line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.ok(doc, 'Document should parse');
  
  // Verify heading
  const titleBlock = doc.blocks.find(b => b.type === 'heading' && b.text.includes("Icarus's Flight"));
  assert.ok(titleBlock, 'Poem title should be parsed as heading');

  // Verify verse lines
  const verseBlocks = doc.blocks.filter(b => b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse'));
  assert.equal(verseBlocks.length, 12, 'All 12 verse lines across 3 stanzas should be parsed');

  // Verify line numbers are captured cleanly
  const line5 = verseBlocks.find(b => b.text && b.text.includes('where freedom stopped'));
  assert.ok(line5, 'Line 5 block should exist');
  assert.ok(line5.text.includes('5'), 'Line 5 should retain line number 5');

  const line10 = verseBlocks.find(b => b.text && b.text.includes('He flew just far enough'));
  assert.ok(line10, 'Line 10 block should exist');
  assert.ok(line10.text.includes('10'), 'Line 10 should retain line number 10');

  // Verify stanza break indicators exist between stanzas
  const indicators = doc.blocks.filter(b => b.type === 'indicator' && (b.kind === 'line' || b.kind === 'stanza'));
  assert.ok(indicators.length >= 2, 'Should have stanza break indicators between stanzas');

  // Verify BANA formatting
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 38,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const brfLines = brf.split(/\r?\n/).filter(l => !l.includes('#A') && !l.includes('"3-'));
  
  // Find lines corresponding to poem text
  const poemBrfLines = brfLines.filter(l => l.includes('WHAT ELSE') || l.includes('WHERE FREEDOM') || l.includes('HIS LIBERTY'));
  assert.ok(poemBrfLines.length >= 3, 'Poem lines should be present in braille output');

  // Check 1-3 margin (starts at Cell 1 -> index 0)
  for (const pl of poemBrfLines) {
    assert.equal(pl[0] !== ' ', true, `Poem line "${pl}" should start in Cell 1 (no leading spaces)`);
  }
});

test('Poetry Margins (BANA §13.2.1): Multi-level verse margins (Level 0 = 1-3, Level 1 = 3-5, Level 2 = 5-7)', () => {
  const o = {
    width: 30,
    mode: 'bana',
    translate: (s) => s.toUpperCase(),
  };

  // Level 0 Verse: regular line wrapping
  const lvl0Block = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 0,
    text: 'The wind was a torrent of darkness among the gusty trees',
  };
  const lvl0Lines = formatBlock(lvl0Block, o);
  assert.ok(lvl0Lines.length >= 2, 'Long level 0 verse line should wrap');
  assert.equal(lvl0Lines[0].startsWith('THE WIND'), true, 'Level 0 first line starts in Cell 1 (0 spaces)');
  assert.equal(lvl0Lines[1].startsWith('  '), true, 'Level 0 runover line starts in Cell 3 (2 spaces)');
  assert.equal(lvl0Lines[1].startsWith('   '), false, 'Level 0 runover line should NOT start in Cell 4+');

  // Level 1 Verse: indented line wrapping
  const lvl1Block = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 1,
    text: 'And the moon was a ghostly galleon tossed upon cloudy seas',
  };
  const lvl1Lines = formatBlock(lvl1Block, o);
  assert.ok(lvl1Lines.length >= 2, 'Long level 1 verse line should wrap');
  assert.equal(lvl1Lines[0].startsWith('  AND THE'), true, 'Level 1 first line starts in Cell 3 (2 spaces)');
  assert.equal(lvl1Lines[1].startsWith('    '), true, 'Level 1 runover line starts in Cell 5 (4 spaces)');
  assert.equal(lvl1Lines[1].startsWith('     '), false, 'Level 1 runover line should NOT start in Cell 6+');

  // Level 2 Verse: sub-indented line wrapping
  const lvl2Block = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 2,
    text: 'The road was a ribbon of moonlight over the purple moor',
  };
  const lvl2Lines = formatBlock(lvl2Block, o);
  assert.ok(lvl2Lines.length >= 2, 'Long level 2 verse line should wrap');
  assert.equal(lvl2Lines[0].startsWith('    THE ROAD'), true, 'Level 2 first line starts in Cell 5 (4 spaces)');
  assert.equal(lvl2Lines[1].startsWith('      '), true, 'Level 2 runover line starts in Cell 7 (6 spaces)');
});

test('Poetry with Inline Formatting & Math: <em>, <strong>, <u>, and <math> inside verse lines', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>Listen, my children, and <em>you shall hear</em></line>
            <line>Of the <strong>midnight ride</strong> of Paul Revere,</line>
            <line>On the <u>eighteenth of April</u>, in Seventy-Five:</line>
            <line>Hardly a man is now alive with formula <math><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></math></line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const verseBlocks = doc.blocks.filter(b => b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse'));
  assert.equal(verseBlocks.length, 4, 'All 4 verse lines should be parsed');

  // Verify italic segment
  assert.ok(verseBlocks[0].segments, 'Line 1 should have segments');
  const emSeg = verseBlocks[0].segments.find(s => s.text && s.text.includes('you shall hear'));
  assert.ok(emSeg, 'Italic segment should exist');
  assert.equal((emSeg.tf || 0) & 1, 1, 'Italic segment should have TF_ITALIC bit 1');

  // Verify bold segment
  assert.ok(verseBlocks[1].segments, 'Line 2 should have segments');
  const boldSeg = verseBlocks[1].segments.find(s => s.text && s.text.includes('midnight ride'));
  assert.ok(boldSeg, 'Bold segment should exist');
  assert.equal((boldSeg.tf || 0) & 4, 4, 'Bold segment should have TF_BOLD bit 4');

  // Verify underline segment
  assert.ok(verseBlocks[2].segments, 'Line 3 should have segments');
  const uSeg = verseBlocks[2].segments.find(s => s.text && s.text.includes('eighteenth of April'));
  assert.ok(uSeg, 'Underline segment should exist');
  assert.equal((uSeg.tf || 0) & 2, 2, 'Underline segment should have TF_UNDERLINE bit 2');

  // Verify math segment
  assert.ok(verseBlocks[3].segments, 'Line 4 should have segments');
  const mathSeg = verseBlocks[3].segments.find(s => s.type === 'math');
  assert.ok(mathSeg, 'Math segment should exist');
  assert.ok(mathSeg.mathml.includes('<mi>m</mi>') || mathSeg.mathml.includes('mc'), 'Math segment should retain MathML');

  // Verify roundtrip serialization to NIMAS DTBook XML
  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<p class="bai-verse">'), 'Exported XML should contain verse paragraphs');
  assert.ok(exportedXml.includes('<em>you shall hear</em>'), 'Exported XML should preserve em tags');
  assert.ok(exportedXml.includes('<strong>midnight ride</strong>'), 'Exported XML should preserve strong tags');
  assert.ok(exportedXml.includes('class="underline">eighteenth of April</span>') || exportedXml.includes('<u>eighteenth of April</u>'), 'Exported XML should preserve underline tags');
});

test('Ungrouped Poem with Author Attribution (<byline> / <author>)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <title>The Road Not Taken</title>
          <byline>Robert Frost</byline>
          <line>Two roads diverged in a yellow wood,</line>
          <line>And sorry I could not travel both</line>
          <line>And be one traveler, long I stood</line>
          <line>And looked down one as far as I could</line>
          <line>To where it bent in the undergrowth;</line>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const titleBlock = doc.blocks.find(b => b.type === 'heading');
  assert.ok(titleBlock, 'Poem title should be parsed');
  assert.equal(titleBlock.text, 'The Road Not Taken');

  const attribBlock = doc.blocks.find(b => b.type === 'attribution');
  assert.ok(attribBlock, 'Author attribution should be parsed');
  assert.equal(attribBlock.text, 'Robert Frost');

  const verseBlocks = doc.blocks.filter(b => b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse'));
  assert.equal(verseBlocks.length, 5, 'All 5 verse lines should be parsed');
});

test('Poetry Sibling Line Numbers: <linenum> as child of <linegroup> preceding <line>', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <poem>
          <linegroup>
            <line>Line one of the poem</line>
            <line>Line two of the poem</line>
            <line>Line three of the poem</line>
            <line>Line four of the poem</line>
            <linenum>5</linenum>
            <line>Line five of the poem</line>
          </linegroup>
        </poem>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const verseBlocks = doc.blocks.filter(b => b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse'));
  assert.equal(verseBlocks.length, 5, '5 lines should be parsed');
  
  const line5 = verseBlocks[4];
  assert.ok(line5.text.includes('5'), 'Line 5 should include the sibling linenum 5');
  assert.ok(line5.text.includes('Line five of the poem'), 'Line 5 text should be preserved');
});

test('Poetry Word-Level Tracing (traceBlock): Coordinates accurately map source characters to braille cells', () => {
  const o = {
    width: 38,
    mode: 'bana',
    translate: (s) => s.toUpperCase(),
    translatePos: (text, tf) => ({
      braille: text.toUpperCase(),
      inputPos: Array.from({ length: text.length }, (_, i) => i),
    }),
  };

  const block = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 0,
    text: 'What else could the boy have done?',
  };

  const traced = traceBlock(block, o, false, 0);
  assert.ok(traced.length > 0, 'traceBlock should return traced lines');
  
  const line0 = traced[0];
  assert.equal(line0.s, 'WHAT ELSE COULD THE BOY HAVE DONE?');
  assert.equal(line0.src.length, line0.s.length);
  
  // Verify character coordinate mapping
  assert.deepEqual(line0.src[0], { u: 0, c: 0 }, 'First cell should map to char index 0');
  assert.deepEqual(line0.src[5], { u: 0, c: 5 }, 'Cell 5 should map to char index 5');
});

test('Full NIMAS Poetry XML Round-Trip Parity', () => {
  const originalXml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>Poem of Nature</h2>
        <byline>Emily Dickinson</byline>
        <p class="bai-verse">Nature is what we see—</p>
        <p class="bai-verse">The Hill—the Afternoon—</p>
        <p class="bai-verse">Squirrel—Eclipse—the Bumble bee—</p>
        <p class="bai-verse">Nay—Nature is Heaven—</p>
        <hr class="bai-stanza-break"/>
        <p class="bai-verse">Nature is what we hear—</p>
        <p class="bai-verse">The Bobolink—the Sea—</p>
        <p class="bai-verse">Thunder—the Cricket—</p>
        <p class="bai-verse">Nay—Nature is Harmony—</p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc1 = parseDtbook(originalXml);
  const exportedXml = exportToNimas(doc1);
  const doc2 = parseDtbook(exportedXml);

  assert.equal(doc2.blocks.length, doc1.blocks.length, 'Block counts must match across round-trip');
  for (let i = 0; i < doc1.blocks.length; i++) {
    const b1 = doc1.blocks[i];
    const b2 = doc2.blocks[i];
    assert.equal(b2.type, b1.type, `Block ${i} type must match (${b1.type})`);
    if (b1.text) {
      assert.equal(b2.text, b1.text, `Block ${i} text must match`);
    }
  }
});
