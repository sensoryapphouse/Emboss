// Four proven note-formatting bugs from the BANA §16 gold-sample assessment
// (Emboss/docs/standards-findings.md F-106, F-108, F-109, F-113). Each describe block
// quotes the rule it proves and reproduces the finding's own scenario; expected results
// come from the rule text (references/_text/braille-formats-2016.txt §16), never from
// Emboss's prior output.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
const opts = (mode, extra) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), ...extra });
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);
const lines = (brf) => brf.replace(/\r/g, '').split('\n');

describe('F-106 — BANA 16.2.2 superscripted hollow dot reference mark', () => {
  // "Examples of print reference marks and their braille equivalent … Superscripted
  // hollow dot ;9"0" (BANA 16.2.2). Example 16-2: "<craft;9"0"> craft;9"04
  for (const mark of ['°', '○', '◦', '•']) {
    test(`mark ${JSON.stringify(mark)} -> ;9"0, formatBlock/traceBlock parity`, () => {
      const b = { type: 'para', segments: [{ type: 'text', text: 'Word' }, { type: 'noteref', text: mark, idref: 'x' }] };
      const f = formatBlock(b, opts('bana'));
      assert.ok(f.join('').includes('WORD;9"0'), `${JSON.stringify(mark)}: ${JSON.stringify(f)}`);
      assert.deepEqual(traceBlock(b, opts('bana')).map((t) => t.s), f);
    });
  }

  test('parser recognises a hollow-dot print character in a DTBook <noteref>', () => {
    const d = doc('<p>Craft<noteref idref="#n1">○</noteref>.</p><note id="n1" class="Footnote"><p>○ A note.</p></note>');
    const p = d.blocks[0];
    assert.deepEqual(p.segments.find((g) => g.type === 'noteref'), { type: 'noteref', text: '○', idref: 'n1' });
    const out = lines(formatDocument(d, opts('bana'))).join('\n');
    assert.match(out, /CRAFT;9"0\./);
  });
});

describe('F-108 — noteLayout ordering (BANA 16.5.1c/g/h)', () => {
  // 16.5.1c: "List notes in the order in which they appear in the text."
  test('an unreferenced note does not jump ahead of a still-pending referenced note', () => {
    const blocks = [
      { type: 'para', segments: [{ type: 'text', text: 'See' }, { type: 'noteref', text: '1', idref: 'n1' }] },
      { type: 'footnote', text: '1 First note, referenced.', id: 'n1' },
      { type: 'footnote', text: '2 Second note, never referenced.', id: 'n2' },
    ];
    const out = lines(formatDocument({ blocks }, opts('bana')));
    const iA = out.findIndex((l) => l.includes('FIRST NOTE'));
    const iB = out.findIndex((l) => l.includes('SECOND NOTE'));
    assert.ok(iA > 0 && iB > 0, out.join('\n'));
    assert.ok(iA < iB, `note A (referenced, appears first) must precede note B (unreferenced):\n${out.join('\n')}`);
  });

  // 16.5.1g/h: a note run must not be displaced past a later heading that starts a new
  // section on the same print page (no intervening pagenum).
  test('a note run is not displaced past a later heading', () => {
    const blocks = [
      { type: 'heading', level: 1, text: 'First Section' },
      { type: 'para', segments: [{ type: 'text', text: 'Line one' }, { type: 'noteref', text: '1', idref: 'n1' }] },
      { type: 'footnote', text: '1 Note about line one.', id: 'n1' },
      { type: 'heading', level: 1, text: 'Next Section' },
      { type: 'para', text: 'Line two.' },
    ];
    const out = lines(formatDocument({ blocks }, opts('bana')));
    const iNote = out.findIndex((l) => l.includes('NOTE ABOUT LINE ONE'));
    const iHeading2 = out.findIndex((l) => l.includes('NEXT SECTION'));
    assert.ok(iNote > 0 && iHeading2 > 0, out.join('\n'));
    assert.ok(iNote < iHeading2, `the first section's own note run must precede "Next Section", not follow it:\n${out.join('\n')}`);
  });
});

describe('F-109 — BANA 16.8.1a: a footnote referenced from a table cell stays before the table', () => {
  test('a footnote referenced only inside a table cell renders before the table, not after', () => {
    const blocks = [
      { type: 'para', text: 'Some intro text before the table.' },
      { type: 'footnote', text: '1 Note about the table entry.', id: 'tn1' },
      { type: 'table', headers: ['Region', 'Value'], rows: [[{ text: 'North' }, { segments: [{ type: 'text', text: '10' }, { type: 'noteref', text: '1', idref: 'tn1' }] }]] },
      { type: 'pagenum', text: '2' },
      { type: 'para', text: 'Text on the next print page.' },
    ];
    const out = lines(formatDocument({ blocks }, opts('bana')));
    const iNote = out.findIndex((l) => l.includes('NOTE ABOUT THE TABLE ENTRY'));
    const iTable = out.findIndex((l) => l.includes('NORTH'));
    assert.ok(iNote > 0 && iTable > 0, out.join('\n'));
    assert.ok(iNote < iTable, `the note must precede the table (BANA 16.8.1a):\n${out.join('\n')}`);
  });
});

describe('F-113 — a multi-paragraph <note> keeps its paragraphs (BANA 16.5.1d / B004 D)', () => {
  const SRC = '<note id="n1" class="Footnote"><p>First paragraph of the note.</p><p>Second paragraph of the note.</p></note>';

  test('parser preserves both paragraphs distinctly instead of flattening them', () => {
    const d = doc(SRC);
    const note = d.blocks.find((b) => b.type === 'footnote');
    assert.ok(note, JSON.stringify(d.blocks));
    assert.ok(Array.isArray(note.blocks), `expected note.blocks to preserve paragraphs: ${JSON.stringify(note)}`);
    assert.deepEqual(note.blocks.map((p) => p.text), ['First paragraph of the note.', 'Second paragraph of the note.']);
  });

  test('formatBlock indents the second paragraph at 5-3 (BANA), formatBlock/traceBlock parity', () => {
    const note = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${SRC}</level1></bodymatter></book></dtbook>`).blocks.find((b) => b.type === 'footnote');
    const f = formatBlock(note, opts('bana'));
    // 1-3 margin (first cell 1) for paragraph 1, 5-3 margin (first cell 5) for paragraph 2.
    const p1 = f.find((l) => l.includes('FIRST PARAGRAPH'));
    const p2 = f.find((l) => l.includes('SECOND PARAGRAPH'));
    assert.ok(p1 && p2, JSON.stringify(f));
    assert.equal(p1.match(/^ */)[0].length, 0, JSON.stringify(f));
    assert.equal(p2.match(/^ */)[0].length, 4, JSON.stringify(f));
    assert.deepEqual(traceBlock(note, opts('bana')).map((t) => t.s), f);
  });

  test('round-trips through DTBook export/parse keeping both paragraphs', () => {
    const d = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${SRC}</level1></bodymatter></book></dtbook>`);
    const xml = exportToNimasXml(d);
    assert.match(xml, /<p>First paragraph of the note\.<\/p>/);
    assert.match(xml, /<p>Second paragraph of the note\.<\/p>/);
    const again = parseDtbook(xml).blocks.find((b) => b.type === 'footnote');
    assert.ok(Array.isArray(again.blocks), xml);
    assert.deepEqual(again.blocks.map((p) => p.text), ['First paragraph of the note.', 'Second paragraph of the note.']);
  });
});
