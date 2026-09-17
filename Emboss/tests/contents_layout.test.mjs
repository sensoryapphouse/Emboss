// Contents pages (A27g).
//  BANA Formats §2.10.7a: guide dots (dot 5) preceded and followed by a blank cell, the page
//  number at the right margin; with no room for two dots the number follows the entry.
//  UKAAF B004 (H): hyphen lead lines; print page and braille page columns 2 cells apart,
//  headed "print page" / "braille page" (braille pages from the document's own pagination).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), ...extra });
const toc = { type: 'list', kind: 'toc', items: [{ text: 'Chapter 1: Beginnings', page: '1' }, { text: 'Chapter 2: Middles', page: '9' }, { text: 'A very long contents entry that has to wrap onto a second line', page: '12' }] };
const filler = (n) => Array.from({ length: n }, (_, i) => ({ type: 'para', text: `Paragraph ${i} with enough words to fill a braille line or two here.` }));

test('BANA: guide dots with a blank cell either side; number at the right margin', () => {
  const lines = formatBlock(toc, opts('bana')).filter(Boolean);
  const first = lines[0];
  assert.match(first, /^CHAPTER 1: BEGINNINGS "+ 1$/);
  assert.equal(first.length, 40);
  assert.deepEqual(traceBlock(toc, opts('bana')).map((t) => t.s), formatBlock(toc, opts('bana')));
});

test('UKAAF: hyphen lead lines, print and braille page columns with headings', () => {
  const doc = { blocks: [{ type: 'pagenum', page: '1', text: '1' }, toc, ...filler(3), { type: 'heading', level: 1, text: 'Chapter 1: Beginnings' }, ...filler(40), { type: 'heading', level: 1, text: 'Chapter 2: Middles' }, ...filler(5)] };
  const pages = formatDocument(doc, opts('ukaaf')).replace(/\r/g, '').split('\f');
  const lines = pages[0].split('\n');
  const h = lines.findIndex((l) => /PRINT\s+BRAILLE$/.test(l));
  assert.ok(h > 0, lines.join('\n'));
  assert.match(lines[h + 1], /PAGE\s+PAGE$/);
  const col = lines[h].indexOf('PRINT');
  const e1 = lines.find((l) => l.includes('BEGINNINGS'));
  assert.match(e1, /BEGINNINGS -+ 1/);
  assert.equal(e1.indexOf(' 1 ') + 1, col, 'print page sits in the print column');
  const pageOf = (text) => pages.findIndex((p) => p.split('\n').some((l) => l.trim() === text));
  const c2 = lines.find((l) => l.includes('MIDDLES'));
  const brl = c2.slice(lines[h].indexOf('BRAILLE')).trim();
  const expected = pageOf('CHAPTER 2: MIDDLES') + 1;
  assert.ok(expected > 1, 'chapter 2 is on a later page');
  const brlNum = (n) => '#' + String(n).replace(/\d/g, (d) => 'JABCDEFGHI'[d]);     // braille page number form (#E = 5)
  assert.equal(brl, brlNum(expected), `braille page column: ${c2}`);
});

test('UKAAF without print pages: braille column only; trace matches', () => {
  const o = opts('ukaaf', { _hasPrintPages: false });
  const lines = formatBlock(toc, o);
  assert.ok(!lines.some((l) => l.includes('PRINT')));
  assert.ok(lines.some((l) => /BRAILLE$/.test(l)));
  assert.deepEqual(traceBlock(toc, o).map((t) => t.s), lines);
  assert.deepEqual(traceBlock(toc, opts('ukaaf')).map((t) => t.s), formatBlock(toc, opts('ukaaf')));
});

test('generated contents: BANA guide dots, UKAAF hyphens', () => {
  const doc = { blocks: [{ type: 'heading', level: 1, text: 'Introduction' }, ...filler(2), { type: 'heading', level: 2, text: 'Details' }, ...filler(2)] };
  const bana = formatDocument(doc, opts('bana', { toc: true })).replace(/\r/g, '');
  assert.match(bana, /INTRODUCTION "+ #A\n/);
  const ukaaf = formatDocument(doc, opts('ukaaf', { toc: true })).replace(/\r/g, '');
  assert.match(ukaaf, /INTRODUCTION -+ #A\n/);
});
