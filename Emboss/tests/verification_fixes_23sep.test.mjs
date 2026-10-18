// Fixes for the problems the independent verification of 23 Sep 2026 found in that day's own fixes:
// P1 wordGaps widths (F-206/F-219), P2 forced page break walk-back and scope (F-204), P3 straight-quote
// definitions (F-183/F-194), P5 directions + list inside a box (F-235), P6 unmapped bullets (F-33/F-42) and
// over-wide arrowLines (F-189). (P4, the editor caption, is a browser case in test-editor-save-fidelity.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (mode = 'bana') => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), suppressHeader: true });
const lines = (blocks, mode) => formatDocument({ blocks }, opts(mode)).replace(/\r/g, '').split('\n');
const flat = (b, mode = 'bana') => formatBlock(b, opts(mode)).map((l) => l.replace(/\s+$/, ''));
const gapLine = (b) => flat({ type: 'para', wordGaps: true, blocked: true, ...b }).find((l) => l.trim());

test('P1: a run of 2 blanks is 2 cells, a run of 3 is 3 (19.4.1c, Example 19-2)', () => {
  assert.equal(gapLine({ text: 'abc  def' }), 'ABC  DEF');
  assert.equal(gapLine({ text: 'abc   def' }), 'ABC   DEF');
  assert.equal(gapLine({ text: 'abc   def  ghi' }), 'ABC   DEF  GHI');
  assert.equal(gapLine({ text: 'abc  def   ghi' }), 'ABC  DEF   GHI');
  assert.equal(gapLine({ text: 'abc     def' }), 'ABC   DEF', 'a longer run is capped at three cells');
  assert.equal(gapLine({ text: 'abc def' }), 'ABC DEF');
});
test('P1: a gap at a segment boundary keeps its width; single blanks stay single', () => {
  const segs = (a, b, c) => [{ type: 'text', text: a }, { type: 'text', text: b, italic: true }, { type: 'text', text: c }];
  assert.equal(gapLine({ segments: segs('abc  ', 'def', '  ghi') }), 'ABC  DEF  GHI');
  assert.equal(gapLine({ segments: segs('abc ', 'def', ' ghi') }), 'ABC DEF GHI');
  assert.equal(gapLine({ segments: segs('abc  ', 'def', ' ghi') }), 'ABC  DEF GHI');
});
test('P1: the gap sentinels no longer collide with the line-number markers (no control character leaks)', () => {
  const l = formatDocument({ blocks: [{ type: 'para', text: 'abc  def', wordGaps: true, blocked: true }] }, opts());
  assert.ok(!/[\u0001-\u0004]/.test(l));
});
test('P1: traceBlock agrees with formatBlock', () => {
  const b = { type: 'para', text: 'abc   def  ghi', wordGaps: true, blocked: true };
  const t = traceBlock(b, opts(), false, 0).map((x) => x.s.replace(/\s+$/, ''));
  assert.deepEqual(t, flat(b));
});

const H = (text, level = 1) => ({ type: 'heading', level, text });
const P = (text) => ({ type: 'para', text });
const gl = (extra = {}) => ({ type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'cat', def: 'an animal' }], ...extra });
const pageOf = (blocks, needle, mode = 'bana') => formatDocument({ blocks }, opts(mode)).replace(/\r/g, '').split('\f').findIndex((pg) => pg.includes(needle));

test('P2: the walk-back does not cross an earlier heading that heads other material', () => {
  const blocks = [P('Earlier'), H('Chapter 5'), P('One.'), P('Two.'), H('Glossary', 2), gl()];
  assert.equal(pageOf(blocks, 'CHAPTER 5'), 0, 'Chapter 5 stays on the first page');
  assert.equal(pageOf(blocks, 'TWO.'), 0);
  assert.equal(pageOf(blocks, 'GLOSSARY'), 1, 'the Glossary heading opens page 2');
  assert.equal(pageOf(blocks, 'CAT'), 1);
});
test('P2: title, headnote and division letter still travel together (Example 21-2 shape)', () => {
  const blocks = [P('Earlier'), H('Words to Know'), P('Go to the page number.'), H('A'), { type: 'list', kind: 'index', items: [{ text: 'apple, 3' }] }];
  assert.equal(pageOf(blocks, 'WORDS TO KNOW'), 1);
  assert.equal(pageOf(blocks, 'APPLE'), 1);
  assert.equal(pageOf(blocks, 'EARLIER'), 0);
});
test('P2: a plain definition list does not force a new page; a glossary named by its heading, or flagged, does', () => {
  const plain = [P('Earlier'), H('Spelling activity'), gl()];
  assert.equal(pageOf(plain, 'SPELLING ACTIVITY'), 0);
  assert.equal(pageOf(plain, 'CAT'), 0);
  const named = [P('Earlier'), H('Glossary'), gl()];
  assert.equal(pageOf(named, 'GLOSSARY'), 1);
  const flagged = [P('Earlier'), H('Word bank'), gl({ reference: true })];
  assert.equal(pageOf(flagged, 'WORD BANK'), 1);
  const dict = [P('Earlier'), H('Word bank'), gl({ dictionary: true })];
  assert.equal(pageOf(dict, 'WORD BANK'), 1);
  const optOut = [P('Earlier'), H('Glossary'), gl({ reference: false })];
  assert.equal(pageOf(optOut, 'GLOSSARY'), 0);
});
test('P2: UKAAF is unchanged (no forced break)', () => {
  assert.equal(pageOf([P('Earlier'), H('Glossary'), gl()], 'GLOSSARY', 'ukaaf'), 0);
});

test('P3: a definition opening with a straight quote takes one blank, like a curly quote', () => {
  const one = (def) => flat({ type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'cat', def }] }).find((l) => l.trim());
  assert.equal(one('"a big cat"'), 'CAT "A BIG CAT"');
  assert.equal(one('“a big cat”'), 'CAT “A BIG CAT”');
  assert.equal(one("'a big cat' ok"), "CAT 'A BIG CAT' OK");
  assert.equal(one("'tis a thing"), "CAT  'TIS A THING", 'a lone apostrophe is not an enclosure: two blanks');
  assert.equal(one('an animal'), 'CAT  AN ANIMAL');
});

test('P5: directions then a list inside a box join with no blank line, as at top level', () => {
  const dir = { type: 'para', text: 'Circle each answer.', directions: true };
  const list = { type: 'list', kind: 'exercise', items: [{ text: 'one' }, { text: 'two' }] };
  const box = { type: 'box', blocks: [dir, list] };
  const f = flat(box);
  assert.deepEqual(f.slice(2, 5), ['    CIRCLE EACH ANSWER.', 'ONE', 'TWO']);
  assert.deepEqual(traceBlock(box, opts(), false, 0).map((x) => x.s.replace(/\s+$/, '')), f, 'traceBlock mirrors formatBlock');
  const other = flat({ type: 'box', blocks: [{ type: 'para', text: 'Plain.' }, list] });
  assert.equal(other[3], '', 'other pairs in a box keep their blank line');
});

test('P6: an unmapped bullet glyph or name falls back to the dot bullet, never raw text or a dropped bullet', () => {
  const item = (it) => flat({ type: 'list', kind: 'list', items: [it] }).find((l) => l.trim());
  // IMP-W7 (Paul, 30 Sep 2026; BANA 8.6.2a): a star is a custom print bullet, no longer the dot: BANA brailles it as the first
  // transcriber-defined symbol (`;?`) and lists it on the Special Symbols page (tests/custom_bullets.test.mjs). Dot-like glyphs
  // (●, *) and an unknown bullet NAME still fall back to the dot.
  assert.equal(item({ marker: '★', text: 'a' }), ';? A');
  assert.equal(item({ marker: '●', text: 'b' }), '_4 B');
  assert.equal(item({ marker: '*', text: 'c' }), '_4 C');
  assert.equal(item({ bullet: 'star', text: 'e' }), '_4 E');
  assert.equal(item({ marker: '1.', bullet: 'star', text: 'f' }), '_4 1. F');
  assert.equal(item({ marker: '□', text: 'g' }), ';$#D G', 'a mapped glyph keeps its own cells');
  assert.equal(item({ marker: '1.', text: 'h' }), '1. H', 'an ordinal is not a bullet');
});
test('P6: an arrowLine wider than the page is clipped to the width', () => {
  const b = { type: 'para', text: 'Sentence', diagram: true, arrowLines: ['-'.repeat(60)] };
  const f = flat(b);
  assert.ok(f.every((l) => l.length <= 40), JSON.stringify(f));
  assert.deepEqual(traceBlock(b, opts(), false, 0).map((x) => x.s.replace(/\s+$/, '')), f);
});
