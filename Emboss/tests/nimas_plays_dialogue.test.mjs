import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDtbook, parseNimasXml } from '../input/parse.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

test('Plays & Dialogue (BANA §13.1): Multi-character prose play with <speaker>, <stage>, and dialogue paragraphs', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>The Tempest — Act I, Scene II</h1>
        <div class="play">
          <stage>[Enter PROSPERO and MIRANDA]</stage>
          <speaker>MIRANDA</speaker>
          <p class="bai-play">If by your art, my dearest father, you have put the wild waters in this roar, allay them.</p>
          <speaker>PROSPERO</speaker>
          <p class="bai-play">Be collected: No more amazement: tell your piteous heart there's no harm done.</p>
          <p class="bai-play" level="1">I have done nothing but in care of thee, of thee, my dear one, thee, my daughter, who art ignorant of what thou art.</p>
          <stage>(Lays down his mantle)</stage>
        </div>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.ok(doc, 'Document should parse');

  const heading = doc.blocks.find(b => b.type === 'heading');
  assert.ok(heading, 'Heading should exist');
  assert.equal(heading.text, 'The Tempest — Act I, Scene II');

  const stages = doc.blocks.filter(b => b.type === 'stage');
  assert.equal(stages.length, 2, 'Should parse both stage directions');
  assert.equal(stages[0].text, '[Enter PROSPERO and MIRANDA]');
  assert.equal(stages[1].text, '(Lays down his mantle)');

  const dialogueBlocks = doc.blocks.filter(b => b.type === 'play' && b.subtype === 'prose');
  assert.equal(dialogueBlocks.length, 5, 'Should parse 2 speakers + 3 dialogue paragraphs');

  const mirandaSpeaker = dialogueBlocks.find(b => b.text === 'MIRANDA');
  assert.ok(mirandaSpeaker, 'Miranda speaker block should exist');

  const prosperoContinuation = dialogueBlocks.find(b => b.text && b.text.includes('I have done nothing but in care of thee'));
  assert.ok(prosperoContinuation, 'Prospero continuation block should exist');
  assert.equal(prosperoContinuation.level, 1, 'Continuation paragraph should retain level=1');

  // Verify BANA formatting
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 38,
    depth: 25,
    translate: (s) => s.toUpperCase(),
  });

  const brfLines = brf.split(/\r?\n/).filter(l => l.trim() && !l.includes('#A'));

  // Stage direction: 7-7 format (starts with 6 spaces)
  const stage0Line = brfLines.find(l => l.includes('ENTER PROSPERO'));
  assert.ok(stage0Line, 'Stage line should exist in braille');
  assert.equal(stage0Line.startsWith('      ['), true, 'Stage direction starts in Cell 7 (6 spaces)');

  // Speaker line: 1-3 format (starts with 0 spaces)
  const mirandaLine = brfLines.find(l => l.startsWith('MIRANDA'));
  assert.ok(mirandaLine, 'Speaker line starts in Cell 1 (0 spaces)');

  // Continuation paragraph: 5-3 format (starts with 4 spaces)
  const contLine = brfLines.find(l => l.includes('I HAVE DONE NOTHING'));
  assert.ok(contLine, 'Continuation line should exist in braille');
  assert.equal(contLine.startsWith('    I HAVE'), true, 'Speaker continuation paragraph starts in Cell 5 (4 spaces)');
});

test('Plays & Dialogue Margins (BANA §13.1 & §13.3): Exact margin validation', () => {
  const o = {
    width: 32,
    mode: 'bana',
    translate: (s) => s.toUpperCase(),
  };

  // 1. Dialogue Level 0 (Speaker / Main Dialogue): 1-3 format
  const dial0Block = {
    type: 'play',
    subtype: 'prose',
    style: 'play-speaker',
    level: 0,
    text: 'HAMLET: To be, or not to be, that is the question: Whether tis nobler in the mind.',
  };
  const dial0Lines = formatBlock(dial0Block, o);
  assert.ok(dial0Lines.length >= 2, 'Long dialogue should wrap');
  assert.equal(dial0Lines[0].startsWith('HAMLET:'), true, 'Level 0 dialogue first line starts in Cell 1 (0 spaces)');
  assert.equal(dial0Lines[1].startsWith('  '), true, 'Level 0 dialogue runover starts in Cell 3 (2 spaces)');
  assert.equal(dial0Lines[1].startsWith('   '), false, 'Level 0 dialogue runover should NOT start in Cell 4+');

  // 2. Dialogue Level 1 (Speaker Continuation Paragraph): 5-3 format
  const dial1Block = {
    type: 'play',
    subtype: 'prose',
    style: 'play-speaker',
    level: 1,
    text: 'Thus conscience does make cowards of us all, and thus the native hue of resolution.',
  };
  const dial1Lines = formatBlock(dial1Block, o);
  assert.ok(dial1Lines.length >= 2, 'Long continuation dialogue should wrap');
  assert.equal(dial1Lines[0].startsWith('    THUS'), true, 'Level 1 continuation first line starts in Cell 5 (4 spaces)');
  assert.equal(dial1Lines[1].startsWith('  '), true, 'Level 1 continuation runover starts in Cell 3 (2 spaces)');
  assert.equal(dial1Lines[1].startsWith('   '), false, 'Level 1 continuation runover should NOT start in Cell 4+');

  // 3. Stage Direction Level 0: 7-7 format
  const stage0Block = {
    type: 'stage',
    style: 'play-stage',
    level: 0,
    text: '[Enter Ghost, Hamlet, and Horatio talking quietly]',
  };
  const stage0Lines = formatBlock(stage0Block, o);
  assert.ok(stage0Lines.length >= 2, 'Long stage direction should wrap');
  assert.equal(stage0Lines[0].startsWith('      ['), true, 'Level 0 stage first line starts in Cell 7 (6 spaces)');
  assert.equal(stage0Lines[1].startsWith('      '), true, 'Level 0 stage runover starts in Cell 7 (6 spaces)');
  assert.equal(stage0Lines[1].startsWith('       '), false, 'Level 0 stage runover should NOT start in Cell 8+');

  // 4. Stage Direction Level 1 (Nested): 9-7 format
  const stage1Block = {
    type: 'stage',
    style: 'play-stage',
    level: 1,
    text: '(Aside to Horatio concerning the mysterious appearance of the phantom)',
  };
  const stage1Lines = formatBlock(stage1Block, o);
  assert.ok(stage1Lines.length >= 2, 'Long nested stage direction should wrap');
  assert.equal(stage1Lines[0].startsWith('        ('), true, 'Level 1 stage first line starts in Cell 9 (8 spaces)');
  assert.equal(stage1Lines[1].startsWith('      '), true, 'Level 1 stage runover starts in Cell 7 (6 spaces)');
  assert.equal(stage1Lines[1].startsWith('       '), false, 'Level 1 stage runover should NOT start in Cell 8+');
});

test('Dramatic Verse Dialogue (BANA §13.2): Multi-level verse lines in play context', () => {
  const o = {
    width: 32,
    mode: 'bana',
    translate: (s) => s.toUpperCase(),
  };

  // Verse Line Level 0: 1-3 format
  const verse0 = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 0,
    text: 'Now is the winter of our discontent made glorious summer by this sun of York',
  };
  const verse0Lines = formatBlock(verse0, o);
  assert.ok(verse0Lines.length >= 2);
  assert.equal(verse0Lines[0].startsWith('NOW IS'), true, 'Level 0 verse starts in Cell 1 (0 spaces)');
  assert.equal(verse0Lines[1].startsWith('  '), true, 'Level 0 verse runover starts in Cell 3 (2 spaces)');

  // Verse Line Level 1 (Indented Verse): 3-5 format
  const verse1 = {
    type: 'play',
    subtype: 'verse',
    style: 'verse',
    level: 1,
    text: 'And all the clouds that lourd upon our house in the deep bosom of the ocean buried',
  };
  const verse1Lines = formatBlock(verse1, o);
  assert.ok(verse1Lines.length >= 2);
  assert.equal(verse1Lines[0].startsWith('  AND ALL'), true, 'Level 1 verse starts in Cell 3 (2 spaces)');
  assert.equal(verse1Lines[1].startsWith('    '), true, 'Level 1 verse runover starts in Cell 5 (4 spaces)');
});

test('Plays with Inline Formatting & Emphasis: <em>, <strong>, <u> within speaker lines and stage directions', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p class="bai-play"><strong>MACBETH:</strong> Is this a <em>dagger</em> which I see before me?</p>
        <p class="bai-stage"><em>(Reaching toward the <u>floating blade</u>)</em></p>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.equal(doc.blocks.length, 2, 'Should parse 2 blocks');

  const macbethBlock = doc.blocks[0];
  assert.equal(macbethBlock.type, 'play');
  assert.ok(macbethBlock.segments, 'Should have inline segments');
  
  const boldSeg = macbethBlock.segments.find(s => s.text && s.text.includes('MACBETH:'));
  assert.ok(boldSeg, 'Bold speaker name should exist');
  assert.equal((boldSeg.tf || 0) & 4, 4, 'Speaker name should have TF_BOLD bit 4');

  const italicSeg = macbethBlock.segments.find(s => s.text && s.text.includes('dagger'));
  assert.ok(italicSeg, 'Italic dagger should exist');
  assert.equal((italicSeg.tf || 0) & 1, 1, 'Italic dagger should have TF_ITALIC bit 1');

  const stageBlock = doc.blocks[1];
  assert.equal(stageBlock.type, 'stage');
  assert.ok(stageBlock.segments, 'Stage should have inline segments');

  const underlineSeg = stageBlock.segments.find(s => s.text && s.text.includes('floating blade'));
  assert.ok(underlineSeg, 'Underline segment should exist');
  assert.equal((underlineSeg.tf || 0) & 2, 2, 'Underline segment should have TF_UNDERLINE bit 2');

  // Verify roundtrip export to NIMAS XML
  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<p class="bai-play">'), 'Exported XML should contain bai-play paragraph');
  assert.ok(exportedXml.includes('<p class="bai-stage">'), 'Exported XML should contain bai-stage paragraph');
  assert.ok(exportedXml.includes('<strong>MACBETH:</strong>'), 'Exported XML should retain strong tag');
  assert.ok(exportedXml.includes('<em>dagger</em>'), 'Exported XML should retain em tag');
  assert.ok(exportedXml.includes('class="underline"') || exportedXml.includes('<u>'), 'Exported XML should retain underline styling');
});

test('Plays Inside <sidebar> Elements', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_play_01">
          <hd>Drama Spotlight</hd>
          <speaker>OTHELLO</speaker>
          <p class="bai-play">O, beware, my lord, of jealousy; it is the green-ey'd monster.</p>
          <stage>(Draws his sword)</stage>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const sidebar = doc.blocks.find(b => b.type === 'sidebar' || b.type === 'box');
  assert.ok(sidebar, 'Sidebar block should exist');
  assert.ok(sidebar.blocks, 'Sidebar should contain child blocks');

  const othelloSpeaker = sidebar.blocks.find(b => b.type === 'play' && b.text === 'OTHELLO');
  assert.ok(othelloSpeaker, 'Othello speaker should exist inside sidebar');

  const othelloSpeech = sidebar.blocks.find(b => b.type === 'play' && b.text.includes('green-ey\'d monster'));
  assert.ok(othelloSpeech, 'Speech should exist inside sidebar');

  const stage = sidebar.blocks.find(b => b.type === 'stage');
  assert.ok(stage, 'Stage direction should exist inside sidebar');
  assert.equal(stage.text, '(Draws his sword)');
});

test('Play Dialogue Word-Level Tracing (traceBlock): Coordinates accurately map source characters to braille cells', () => {
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
    subtype: 'prose',
    style: 'play-speaker',
    level: 0,
    text: 'HAMLET: Speak the speech, I pray you.',
  };

  const traced = traceBlock(block, o, false, 0);
  assert.ok(traced.length > 0, 'traceBlock should return lines');
  assert.equal(traced[0].s, 'HAMLET: SPEAK THE SPEECH, I PRAY YOU.');
  assert.deepEqual(traced[0].src[0], { u: 0, c: 0 }, 'First cell should map to char index 0');
  assert.deepEqual(traced[0].src[8], { u: 0, c: 8 }, 'Cell 8 should map to char index 8');
});

test('Full NIMAS Play XML Round-Trip Parity', () => {
  const originalXml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h2>The Tragedy of Julius Caesar</h2>
        <p class="bai-stage">[Flourish. Enter CAESAR; ANTONY, for the course; CALPHURNIA, PORTIA, DECIUS]</p>
        <p class="bai-play">CAESAR: Calphurnia!</p>
        <p class="bai-play">CASCA: Peace, ho! Caesar speaks.</p>
        <p class="bai-play">CAESAR: Set on; and leave no ceremony out.</p>
        <p class="bai-stage">[Music]</p>
        <p class="bai-play">SOOTHSAYER: Caesar!</p>
        <p class="bai-play">CAESAR: Ha! who calls?</p>
        <p class="bai-play">CASCA: Bid every noise be still: peace yet again!</p>
        <p class="bai-play">CAESAR: Who is it in the press that calls on me? I hear a tongue, shriller than all the music, cry 'Caesar!'</p>
        <p class="bai-play" level="1">Speak; Caesar is turn'd to hear.</p>
        <p class="bai-play">SOOTHSAYER: Beware the ides of March.</p>
        <p class="bai-play">CAESAR: What man is that?</p>
        <p class="bai-play">BRUTUS: A soothsayer bids you beware the ides of March.</p>
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
    assert.equal(b2.style, b1.style, `Block ${i} style must match (${b1.style})`);
    if (b1.level != null) {
      assert.equal(b2.level, b1.level, `Block ${i} level must match`);
    }
    if (b1.text) {
      assert.equal(b2.text, b1.text, `Block ${i} text must match`);
    }
  }
});
