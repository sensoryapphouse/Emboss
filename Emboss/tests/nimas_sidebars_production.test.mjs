import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ensure DOMParser is globally available in Node environment
globalThis.DOMParser = DOMParser;

import { parseDtbook } from '../input/parse.mjs';
import { formatDocument, traceBlock } from '../format/document.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Multi-element Sidebar: <hd>, <p>, <list>, and <table>', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_science_01" render="required">
          <hd>Science in Context</hd>
          <p>Scientific discoveries often depend on <strong>rigorous experimentation</strong>.</p>
          <list type="ul">
            <li>Observation of phenomena</li>
            <li>Formulation of hypothesis</li>
            <li>Controlled testing</li>
          </list>
          <table class="bana-spatial">
            <caption>Experimental Results</caption>
            <thead>
              <tr><th>Trial</th><th>Temp</th><th>Rate</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>20C</td><td>1.2</td></tr>
              <tr><td>2</td><td>30C</td><td>2.4</td></tr>
            </tbody>
          </table>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.equal(doc.blocks.length, 1, 'Should produce 1 top-level box block');
  
  const box = doc.blocks[0];
  assert.equal(box.type, 'box');
  assert.equal(box.id, 'sb_science_01');
  assert.equal(box.render, 'required');
  assert.equal(box.title, 'Science in Context');
  assert.equal(box.blocks.length, 5, 'Should contain 5 child blocks');

  assert.equal(box.blocks[0].type, 'heading');
  assert.equal(box.blocks[1].type, 'para');
  assert.equal(box.blocks[2].type, 'list');
  assert.equal(box.blocks[3].type, 'caption');
  assert.equal(box.blocks[4].type, 'table');

  // Verify braille formatting
  const brf = formatDocument(doc, { mode: 'bana', width: 40, depth: 25, translate: (s) => s.toUpperCase() });
  const allLines = brf.split(/\r?\n/);

  // Top box line is dots 2356 ('7') full width (BANA Formats §7.1.3), and the
  // sidebar heading sits on the line after it with no blank between (§4.3.5)
  const topIdx = allLines.indexOf('7'.repeat(40));
  assert.ok(topIdx >= 0, 'Top boxline border rendered');
  assert.ok(allLines[topIdx + 1].includes('SCIENCE IN CONTEXT'), `Heading follows the top box line (got "${allLines[topIdx + 1]}")`);
  assert.ok(!allLines.some(l => l.startsWith('333 ')), 'Title is no longer spliced into the top box line');
  // Bottom box line is dots 12356 ('G') full width
  assert.ok(allLines.includes('G'.repeat(40)), 'Bottom boxline border rendered');

  // Verify XML round-trip
  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<sidebar id="sb_science_01" render="required">'), 'Retains sidebar tag with attributes');
  assert.ok(exportedXml.includes('<hd>Science in Context</hd>'), 'Retains heading');
  assert.ok(exportedXml.includes('<strong>rigorous experimentation</strong>'), 'Retains strong formatting');
  assert.ok(exportedXml.includes('<caption>Experimental Results</caption>'), 'Retains table caption');

  const reparsed = parseDtbook(exportedXml);
  assert.equal(reparsed.blocks.length, 1);
  assert.equal(reparsed.blocks[0].title, 'Science in Context');
  assert.equal(reparsed.blocks[0].blocks.length, 5);
  assert.equal(reparsed.blocks[0].blocks[3].type, 'caption');
  assert.equal(reparsed.blocks[0].blocks[3].text, 'Experimental Results');
  assert.equal(reparsed.blocks[0].blocks[4].type, 'table');
  assert.equal(reparsed.blocks[0].blocks[4].rows.length, 2);
});

test('Sidebar Containing Poetry & Verse with Author Byline', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_poem_01">
          <hd>Literary Focus: Metaphor</hd>
          <poem>
            <title>Fog</title>
            <linegroup>
              <line><linenum>1</linenum>The fog comes</line>
              <line>on little cat feet.</line>
            </linegroup>
            <linegroup>
              <line><linenum>3</linenum>It sits looking</line>
              <line>over harbor and city</line>
              <line>on silent haunches</line>
              <line>and then moves on.</line>
            </linegroup>
            <byline>— Carl Sandburg</byline>
          </poem>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.equal(doc.blocks.length, 1);
  const box = doc.blocks[0];
  assert.equal(box.type, 'box');

  // Verify child blocks inside box
  const hasHeading = box.blocks.some(b => b.type === 'heading' && b.text === 'Literary Focus: Metaphor');
  const hasPoemTitle = box.blocks.some(b => b.type === 'heading' && b.text === 'Fog');
  const hasVerseLines = box.blocks.some(b => b.type === 'play' && b.subtype === 'verse');
  const hasByline = box.blocks.some(b => b.type === 'attribution' && b.text.includes('Carl Sandburg'));

  assert.ok(hasHeading, 'Contains sidebar heading');
  assert.ok(hasPoemTitle, 'Contains poem title');
  assert.ok(hasVerseLines, 'Contains verse lines');
  assert.ok(hasByline, 'Contains byline attribution');

  // Roundtrip export
  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<sidebar id="sb_poem_01" render="required">'));
  assert.ok(exportedXml.includes('<byline>— Carl Sandburg</byline>'));

  const reparsed = parseDtbook(exportedXml);
  assert.equal(reparsed.blocks.length, 1);
});

test('Sidebar Containing Dramatic Play & Stage Directions', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_drama_01">
          <hd>Scene Study</hd>
          <speaker>PROSPERO</speaker>
          <p class="bai-play">Our revels now are ended. These our actors, As I foretold you, were all spirits.</p>
          <stage>(He waves his wand slowly)</stage>
          <speaker>ARIEL</speaker>
          <p class="bai-play"><em>(Bowing low)</em> Thy thoughts I cleave to.</p>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const box = doc.blocks[0];
  assert.equal(box.type, 'box');

  const speakers = box.blocks.filter(b => b.type === 'play' && b.style === 'play-speaker');
  const stages = box.blocks.filter(b => b.type === 'stage');

  assert.equal(speakers.length, 4, 'PROSPERO, speech, ARIEL, speech');
  assert.equal(stages.length, 1, 'Stage direction captured');

  // Roundtrip export
  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<sidebar id="sb_drama_01" render="required">'));
  assert.ok(exportedXml.includes('<p class="bai-stage">'));
  assert.ok(exportedXml.includes('<em>(Bowing low)</em>'));

  const reparsed = parseDtbook(exportedXml);
  assert.equal(reparsed.blocks.length, 1);
  assert.equal(reparsed.blocks[0].blocks.length, 6);
});

test('Sidebar with Definition Lists and Exercise Questions', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_vocab_01">
          <hd>Vocabulary &amp; Review</hd>
          <dl>
            <dt>Kinetic Energy</dt>
            <dd>The energy an object has due to its motion.</dd>
            <dt>Potential Energy</dt>
            <dd>The energy stored in an object because of its position.</dd>
          </dl>
          <list type="ol" class="bai-exercise">
            <li class="bai-exercise">1. Define kinetic energy in your own words.</li>
            <li class="bai-exercise">2. Give an example of potential energy.</li>
          </list>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const box = doc.blocks[0];
  assert.equal(box.type, 'box');

  const dlBlock = box.blocks.find(b => b.type === 'list' && (b.kind === 'glossary' || b.style === 'glossary'));
  const exBlock = box.blocks.find(b => b.type === 'list' && (b.kind === 'exercise' || b.style === 'exercise'));

  assert.ok(dlBlock, 'Contains definition list block');
  assert.equal(dlBlock.items.length, 2, '2 glossary items');
  assert.ok(exBlock, 'Contains exercise list block');
  assert.equal(exBlock.items.length, 2, '2 exercise items');

  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<dl>'));
  assert.ok(exportedXml.includes('<dt>Kinetic Energy</dt>'));
  assert.ok(exportedXml.includes('<list type="ol" class="bai-exercise">'));

  const reparsed = parseDtbook(exportedXml);
  assert.equal(reparsed.blocks.length, 1);
  assert.equal(reparsed.blocks[0].blocks.length, 3);
});

test('Nested Sidebars & Multi-level Box Containers', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="outer_box">
          <hd>Unit Overview</hd>
          <p>This unit covers physics and chemistry foundations.</p>
          <sidebar id="inner_box_01">
            <hd>Lab Safety Warning</hd>
            <p>Always wear safety goggles when handling acid.</p>
          </sidebar>
          <p>Review the safety steps before proceeding.</p>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  assert.equal(doc.blocks.length, 1, 'Outer box is single top-level block');
  
  const outerBox = doc.blocks[0];
  assert.equal(outerBox.id, 'outer_box');
  
  const innerBox = outerBox.blocks.find(b => b.type === 'box' && b.id === 'inner_box_01');
  assert.ok(innerBox, 'Nested inner box parsed inside outer box blocks');
  assert.equal(innerBox.title, 'Lab Safety Warning');

  const exportedXml = exportToNimas(doc);
  assert.ok(exportedXml.includes('<sidebar id="outer_box" render="required">'));
  assert.ok(exportedXml.includes('<sidebar id="inner_box_01" render="required">'));
  assert.ok(exportedXml.includes('<hd>Lab Safety Warning</hd>'));

  const reparsed = parseDtbook(exportedXml);
  assert.equal(reparsed.blocks.length, 1);
  assert.ok(reparsed.blocks[0].blocks.some(b => b.type === 'box' && b.id === 'inner_box_01'));
});

test('Sidebar Word-Level Tracing (traceBlock): Accurate coordinates for child blocks', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <sidebar id="sb_trace_test">
          <hd>Trace Test Box</hd>
          <p>Important boxed announcement.</p>
        </sidebar>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseDtbook(xml);
  const box = doc.blocks[0];

  const fakeTranslatePos = (text) => ({
    braille: text.toUpperCase(),
    inputPos: Array.from(text, (_, i) => i)
  });

  const traced = traceBlock(box, { width: 40, translatePos: fakeTranslatePos });
  assert.ok(Array.isArray(traced), 'traceBlock returns array of lines');
  assert.ok(traced.length >= 4, 'Includes blank, top border, content, bottom border, blank');

  // Check top border title mapping
  const titleLine = traced.find(l => l.s.includes('TRACE TEST BOX'));
  assert.ok(titleLine, 'Title line exists in traced lines');
  
  const titleCellsWithSrc = titleLine.src.filter(src => src !== null);
  assert.ok(titleCellsWithSrc.length > 0, 'Title braille cells have non-null source coordinate mappings');

  // Check paragraph content mapping
  const contentLine = traced.find(l => l.s.includes('IMPORTANT BOXED'));
  assert.ok(contentLine, 'Content line exists in traced lines');
  const contentCellsWithSrc = contentLine.src.filter(src => src !== null);
  assert.ok(contentCellsWithSrc.length > 0, 'Content cells have non-null source coordinate mappings');
});

test('Production Textbook Sidebar Audit: Full fidelity on large-nimas.xml sidebars', () => {
  const largeNimasPath = path.resolve(__dirname, '../web/large-nimas.xml');
  assert.ok(fs.existsSync(largeNimasPath), `Production textbook fixture must exist at ${largeNimasPath}`);

  const xmlContent = fs.readFileSync(largeNimasPath, 'utf8');
  const doc = parseDtbook(xmlContent);

  const sidebars = doc.blocks.filter(b => b.type === 'box');
  assert.ok(sidebars.length > 0, `Textbook contains ${sidebars.length} sidebars`);

  // Verify all sidebars have valid structures and can export cleanly
  for (const sb of sidebars) {
    assert.ok(sb.type === 'box');
    if (sb.blocks) {
      assert.ok(Array.isArray(sb.blocks), 'Sidebar blocks is array');
    }
  }

  // Export full textbook and verify all sidebars remain intact
  const exported = exportToNimas(doc);
  const reparsed = parseDtbook(exported);
  const reparsedSidebars = reparsed.blocks.filter(b => b.type === 'box');

  assert.equal(reparsedSidebars.length, sidebars.length, 'Every single production sidebar survives roundtrip');
});
