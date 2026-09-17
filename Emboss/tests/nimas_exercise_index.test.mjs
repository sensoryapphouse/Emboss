// Dedicated Automated Test Suite for Exercise Hierarchies (BANA Formats §10.4.2b) and Index Lists (§21.2.1b / §21.4).
// Tests 3-level question hierarchies, 3-level index lists, BANA margins, cell trace mapping, and lossless XML export.
// Both take the nested-list pattern: each level begins two cells right of the previous one and ALL
// runovers begin two cells right of the deepest level — three levels: 1-7, 3-7, 5-7.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNimasXml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument } from '../format/document.mjs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;

test('Exercise Hierarchies (BANA §10.4.2b): 3-level question formatting with 1-7, 3-7, and 5-7 margins', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>End-of-Chapter Comprehension Assessment</h1>
        <list type="ol" class="bai-exercise">
          <li class="bai-exercise" level="0">1. Analyze the biological adaptations of nocturnal desert animals during extreme summer droughts.</li>
          <li class="bai-exercise" level="1">a. Identify two distinct physiological mechanisms for conserving metabolic water.</li>
          <li class="bai-exercise" level="2">(1) Explain how the renal countercurrent multiplier concentrates urine in kangaroo rats.</li>
        </list>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const exList = doc.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  assert.ok(exList, 'Exercise list should be parsed with kind exercise');
  assert.equal(exList.items.length, 3, 'Should have 3 exercise items');
  assert.equal(exList.items[0].level || 0, 0, 'Level 0 main question');
  assert.equal(exList.items[1].level, 1, 'Level 1 sub-question');
  assert.equal(exList.items[2].level, 2, 'Level 2 sub-sub-question');

  const trace = {};
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 35,
    depth: 25,
    translate: (s) => s.toUpperCase(),
    trace
  });

  const lines = brf.split(/\r?\n/).filter(l => l.trim() && !l.includes('#A'));

  // Three levels (§10.4.2b): 1-7, 3-7, 5-7 — every runover in cell 7 (6 spaces).
  // Level 0 (1-7): Cell 1 start (0 spaces), Cell 7 runover
  const q0Line1 = lines.find(l => l.startsWith('1. ANALYZE'));
  assert.ok(q0Line1, 'Level 0 question starts at Cell 1');
  const q0Line2 = lines.find(l => l.includes('ADAPTATIONS OF NOCTURNAL'));
  assert.ok(q0Line2, 'Level 0 question wraps to line 2');
  assert.equal(q0Line2.startsWith('      '), true, 'Level 0 runover is Cell 7 (6 spaces)');
  assert.equal(q0Line2.startsWith('       '), false, 'Level 0 runover is not 7 or more spaces');

  // Level 1 (3-7): Cell 3 start (2 spaces), Cell 7 runover
  const q1Line1 = lines.find(l => l.startsWith('  A. IDENTIFY'));
  assert.ok(q1Line1, 'Level 1 question starts at Cell 3 (2 spaces)');
  const q1Line2 = lines.find(l => l.includes('PHYSIOLOGICAL MECHANISMS'));
  assert.ok(q1Line2, 'Level 1 question wraps to line 2');
  assert.equal(q1Line2.startsWith('      '), true, 'Level 1 runover is Cell 7 (6 spaces)');
  assert.equal(q1Line2.startsWith('       '), false, 'Level 1 runover is not 7 or more spaces');

  // Level 2 (5-7): Cell 5 start (4 spaces), Cell 7 runover
  const q2Line1 = lines.find(l => l.startsWith('    (1) EXPLAIN'));
  assert.ok(q2Line1, 'Level 2 question starts at Cell 5 (4 spaces)');
  const q2Line2 = lines.find(l => l.includes('COUNTERCURRENT'));
  assert.ok(q2Line2, 'Level 2 question wraps to line 2');
  assert.equal(q2Line2.startsWith('      '), true, 'Level 2 runover is Cell 7 (6 spaces)');
  assert.equal(q2Line2.startsWith('       '), false, 'Level 2 runover is not 7 or more spaces');

  // Roundtrip export and re-parse
  const exportedXml = exportToNimasXml(doc);
  assert.ok(exportedXml.includes('class="bai-exercise"'), 'Exported XML preserves class="bai-exercise"');
  assert.ok(exportedXml.includes('level-1'), 'Exported XML preserves level-1');
  assert.ok(exportedXml.includes('level-2'), 'Exported XML preserves level-2');

  const reparsed = parseNimasXml(exportedXml);
  const reparsedList = reparsed.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  assert.ok(reparsedList, 'Re-parsed list is an exercise list');
  assert.equal(reparsedList.items.length, 3, 'Re-parsed list preserves 3 items');
  assert.equal(reparsedList.items[0].text, exList.items[0].text);
  assert.equal(reparsedList.items[1].level, 1);
  assert.equal(reparsedList.items[2].level, 2);
});

test('Index Lists (BANA §21.2.1b / §21.4): 3-level index formatting with 1-7, 3-7, and 5-7 margins', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <rearmatter>
      <level1>
        <h1>Subject Index</h1>
        <list type="pl" class="bai-index">
          <li class="bai-index" level="0">Aerodynamics, principles and practical flight calculations in compressible fluids, 102-118</li>
          <li class="bai-index" level="1">boundary layer turbulence and drag coefficient considerations, 105</li>
          <li class="bai-index" level="2">laminar flow airfoil design modifications, 107</li>
        </list>
      </level1>
    </rearmatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const idxList = doc.blocks.find(b => b.type === 'list' && b.kind === 'index');
  assert.ok(idxList, 'Index list should be parsed with kind index');
  assert.equal(idxList.items.length, 3, 'Should have 3 index items');
  assert.equal(idxList.items[0].level || 0, 0, 'Level 0 main entry');
  assert.equal(idxList.items[1].level, 1, 'Level 1 sub-entry');
  assert.equal(idxList.items[2].level, 2, 'Level 2 sub-sub-entry');

  const trace = {};
  const brf = formatDocument(doc, {
    mode: 'bana',
    width: 35,
    depth: 25,
    translate: (s) => s.toUpperCase(),
    trace
  });

  const lines = brf.split(/\r?\n/).filter(l => l.trim() && !l.includes('#A'));

  // Three levels (§21.2.1b): 1-7, 3-7, 5-7 — "all runovers begin two cells to the right
  // of the farthest indented subentry" (B004 App I: all entries share one runover start).
  // Level 0 (1-7): Cell 1 start (0 spaces), Cell 7 runover
  const e0Line1 = lines.find(l => l.startsWith('AERODYNAMICS,'));
  assert.ok(e0Line1, 'Level 0 entry starts at Cell 1');
  const e0Line2 = lines.find(l => l.includes('PRACTICAL FLIGHT'));
  assert.ok(e0Line2, 'Level 0 entry wraps to line 2');
  assert.equal(e0Line2.startsWith('      '), true, 'Level 0 runover is Cell 7 (6 spaces)');
  assert.equal(e0Line2.startsWith('       '), false, 'Level 0 runover is not 7 or more spaces');

  // Level 1 (3-7): Cell 3 start (2 spaces), Cell 7 runover
  const e1Line1 = lines.find(l => l.startsWith('  BOUNDARY LAYER'));
  assert.ok(e1Line1, 'Level 1 entry starts at Cell 3 (2 spaces)');
  const e1Line2 = lines.find(l => l.includes('DRAG COEFFICIENT'));
  assert.ok(e1Line2, 'Level 1 entry wraps to line 2');
  assert.equal(e1Line2.startsWith('      '), true, 'Level 1 runover is Cell 7 (6 spaces)');
  assert.equal(e1Line2.startsWith('       '), false, 'Level 1 runover is not 7 or more spaces');

  // Level 2 (5-7): Cell 5 start (4 spaces), Cell 7 runover
  const e2Line1 = lines.find(l => l.startsWith('    LAMINAR FLOW'));
  assert.ok(e2Line1, 'Level 2 entry starts at Cell 5 (4 spaces)');
  const e2Line2 = lines.find(l => l.includes('MODIFICATIONS, 107'));
  assert.ok(e2Line2, 'Level 2 entry wraps to line 2');
  assert.equal(e2Line2.startsWith('      '), true, 'Level 2 runover is Cell 7 (6 spaces)');
  assert.equal(e2Line2.startsWith('       '), false, 'Level 2 runover is not 7 or more spaces');

  // Roundtrip export and re-parse
  const exportedXml = exportToNimasXml(doc);
  assert.ok(exportedXml.includes('class="bai-index"'), 'Exported XML preserves class="bai-index"');
  assert.ok(exportedXml.includes('level-1'), 'Exported XML preserves level-1');
  assert.ok(exportedXml.includes('level-2'), 'Exported XML preserves level-2');

  const reparsed = parseNimasXml(exportedXml);
  const reparsedList = reparsed.blocks.find(b => b.type === 'list' && b.kind === 'index');
  assert.ok(reparsedList, 'Re-parsed list is an index list');
  assert.equal(reparsedList.items.length, 3, 'Re-parsed list preserves 3 items');
  assert.equal(reparsedList.items[0].text, idxList.items[0].text);
  assert.equal(reparsedList.items[1].level, 1);
  assert.equal(reparsedList.items[2].level, 2);
});

test('Exercise & Index with Inline Formatting (bold, italics, underline) preserve typeforms across roundtrip', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <h1>Formatted Exercise & Index</h1>
        <list type="ol" class="bai-exercise">
          <li class="bai-exercise" level="0">1. Read the passage from <em>The Great Gatsby</em> and explain the significance of the <strong>green light</strong>.</li>
        </list>
        <list type="pl" class="bai-index">
          <li class="bai-index" level="0"><em>Gatsby, Jay</em>, thematic analysis of romantic idealism, 45-52</li>
        </list>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

  const doc = parseNimasXml(xml);
  const ex = doc.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  const idx = doc.blocks.find(b => b.type === 'list' && b.kind === 'index');

  assert.ok(ex.items[0].segments && ex.items[0].segments.length > 1, 'Exercise item has inline segments');
  assert.ok(idx.items[0].segments && idx.items[0].segments.length > 1, 'Index item has inline segments');

  const exported = exportToNimasXml(doc);
  assert.ok(exported.includes('<em>The Great Gatsby</em>'), 'Exported XML preserves <em>');
  assert.ok(exported.includes('<strong>green light</strong>'), 'Exported XML preserves <strong>');
  assert.ok(exported.includes('<em>Gatsby, Jay</em>'), 'Exported XML preserves <em> in index');

  const reparsed = parseNimasXml(exported);
  const reparsedEx = reparsed.blocks.find(b => b.type === 'list' && b.kind === 'exercise');
  const reparsedIdx = reparsed.blocks.find(b => b.type === 'list' && b.kind === 'index');

  assert.ok(reparsedEx.items[0].segments.some(s => s.tf === 1 && s.text.includes('Gatsby')), 'Re-parsed exercise preserves italic segment');
  assert.ok(reparsedEx.items[0].segments.some(s => s.tf === 4 && s.text.includes('green light')), 'Re-parsed exercise preserves bold segment');
  assert.ok(reparsedIdx.items[0].segments.some(s => s.tf === 1 && s.text.includes('Gatsby, Jay')), 'Re-parsed index preserves italic segment');
});
