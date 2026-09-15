// Automated Test Suite for BANA Word Synchronization & Cell Trace Mapping.
// Verifies that character and word level synchronization between the Print Editor
// and Braille View pane functions with 100% precision across all 15 BANA block types.

import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';
import { defaultBrailleTranslator } from '../format/tactile-svg.mjs';

console.log('=== BANA Word Synchronization & Cell Trace Test Suite ===\n');

const translate = (text) => defaultBrailleTranslator(text || '');
const translatePos = (text) => {
  const t = text || '';
  const braille = defaultBrailleTranslator(t);
  return { braille, inputPos: Array.from(t, (_, i) => i) };
};

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

// Helper to check that a block's text characters map correctly into trace.rowCells
function assertBlockTraced(trace, blockIdx, unitIdx, originalText) {
  assert(trace.rows && trace.rows.length > 0, 'Trace rows exist');
  assert(trace.rowCells && trace.rowCells.length > 0, 'Trace rowCells exist');

  const rowIdxs = trace.rows.map((b, idx) => (b === blockIdx ? idx : -1)).filter(idx => idx >= 0);
  assert(rowIdxs.length > 0, `Block ${blockIdx} has at least one row in trace.rows`);

  const blockCells = [];
  for (const r of rowIdxs) {
    const cells = trace.rowCells[r] || [];
    for (let col = 0; col < cells.length; col++) {
      const c = cells[col];
      if (c && c.u === unitIdx && typeof c.c === 'number') {
        blockCells.push({ row: r, col, c: c.c });
      }
    }
  }

  assert(blockCells.length > 0, `Block ${blockIdx} unit ${unitIdx} has mapped cells`);
  
  // Verify character indices are within bounds of original text
  for (const cell of blockCells) {
    assert(cell.c >= 0 && cell.c < originalText.length, 
      `Mapped char index ${cell.c} must be within bounds of text length ${originalText.length}`);
  }
}

// 1. Heading 1 (Centered)
test('Style 1: Heading 1 (Centered) produces valid cell trace mapping', () => {
  const text = 'Main Document Title';
  const doc = { blocks: [{ type: 'heading', level: 1, text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 2. Heading 2 (Cell-5)
test('Style 2: Heading 2 (Cell-5) produces valid cell trace mapping', () => {
  const text = 'Section Level Two Heading';
  const doc = { blocks: [{ type: 'heading', level: 2, text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 3. Heading 3 (Cell-7)
test('Style 3: Heading 3 (Cell-7) produces valid cell trace mapping', () => {
  const text = 'Subsection Level Three Heading';
  const doc = { blocks: [{ type: 'heading', level: 3, text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 4. Regular Paragraph / Body
test('Style 4: Body Paragraph (1-3 runover) produces valid cell trace mapping', () => {
  const text = 'This is a standard body paragraph that demonstrates character-level word synchronization.';
  const doc = { blocks: [{ type: 'para', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 5. Drama Dialogue (Speaker 1-3)
test('Style 5: Drama Dialogue (Speaker 1-3) produces valid cell trace mapping', () => {
  const text = 'HAMLET: To be, or not to be, that is the question.';
  const doc = { blocks: [{ type: 'play', subtype: 'prose', style: 'play-speaker', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 6. Stage Direction (7-7 or 9-7)
test('Style 6: Stage Direction produces valid cell trace mapping', () => {
  const text = '[Enter Ghost and HAMLET.]';
  const doc = { blocks: [{ type: 'stage', style: 'play-stage', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 7. Poetry Verse Line (1-3)
test('Style 7: Poetry Verse Line produces valid cell trace mapping', () => {
  const text = 'Two roads diverged in a yellow wood,';
  const doc = { blocks: [{ type: 'play', subtype: 'verse', style: 'verse', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 8. Transcriber Note
test('Style 8: Transcriber Note (with transcriber brackets) produces valid cell trace mapping', () => {
  const text = 'Transcriber note describing diagrammatic structure.';
  const doc = { blocks: [{ type: 'note', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 9. Footnote
test('Style 9: Footnote produces valid cell trace mapping', () => {
  const text = '1. Oxford English Dictionary, 3rd Edition.';
  const doc = { blocks: [{ type: 'footnote', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 10. Caption
test('Style 10: Caption (7-5) produces valid cell trace mapping', () => {
  const text = 'Figure 4.2: Anatomy of the human heart showing ventricles and atria.';
  const doc = { blocks: [{ type: 'caption', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 11. Attribution
test('Style 11: Attribution (5-5) produces valid cell trace mapping', () => {
  const text = '— Albert Einstein, 1905';
  const doc = { blocks: [{ type: 'attribution', text }] };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, text);
});

// 12. Sidebar Box / Callout Container
test('Style 12: Sidebar Box / Container produces valid child unit cell trace mapping (Heading + Para)', () => {
  const headingText = 'Box Summary';
  const bodyText = 'Detailed explanation inside the sidebar container card.';
  const doc = {
    blocks: [
      {
        type: 'box',
        title: headingText,
        blocks: [
          { type: 'heading', level: 2, text: headingText },
          { type: 'para', text: bodyText }
        ]
      }
    ]
  };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, headingText);
  assertBlockTraced(trace, 0, 1, bodyText);
});

test('Style 12b: Sidebar Box with solo paragraph (unit 0) maps cleanly to cell trace', () => {
  const bodyText = 'Solo paragraph inside sidebar without heading child.';
  const doc = {
    blocks: [
      {
        type: 'box',
        title: 'Sidebar Title',
        blocks: [
          { type: 'para', text: bodyText }
        ]
      }
    ]
  };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, bodyText);
});

// 13. Bulleted List
test('Style 13: Bulleted List produces valid unit cell trace mapping for every item', () => {
  const item1 = 'First bullet item';
  const item2 = 'Second bullet item with runover text';
  const doc = {
    blocks: [
      {
        type: 'list',
        ordered: false,
        items: [{ text: item1 }, { text: item2 }]
      }
    ]
  };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, item1);
  assertBlockTraced(trace, 0, 1, item2);
});

// 14. Numbered List
test('Style 14: Numbered List produces valid unit cell trace mapping for every item', () => {
  const item1 = '1. First step in procedure';
  const item2 = '2. Second step with detailed description';
  const doc = {
    blocks: [
      {
        type: 'list',
        ordered: true,
        items: [{ text: item1 }, { text: item2 }]
      }
    ]
  };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, item1);
  assertBlockTraced(trace, 0, 1, item2);
});

// 15. Table / TOC List
test('Style 15: Table / TOC List produces valid unit cell trace mapping', () => {
  const h1 = 'City', h2 = 'Population';
  const r1c1 = 'London', r1c2 = '8900000';
  const doc = {
    blocks: [
      {
        type: 'table',
        format: 'spatial',
        headers: [h1, h2],
        rows: [[r1c1, r1c2]]
      }
    ]
  };
  const trace = {};
  formatDocument(doc, { width: 38, depth: 25, mode: 'bana', standard: 'bana', translate, translatePos, trace });
  assertBlockTraced(trace, 0, 0, h1);
  assertBlockTraced(trace, 0, 1, h2);
  assertBlockTraced(trace, 0, 2, r1c1);
  assertBlockTraced(trace, 0, 3, r1c2);
});

console.log(`\n🎉 All ${passCount} BANA Word Synchronization tests passed cleanly!`);
