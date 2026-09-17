// Book title and running head (A17, A18, A27f).
//  BANA Formats §1.8.1: the book title in print capitalization, centred on line 1 of braille
//  page 1 (continuing on further lines when long), at least three blank cells before the
//  print page number, then a blank line. §1.8.2: the running head (pages 2+) follows print
//  capitalization, lowercase only when that does not fit.
//  UKAAF: page information line from page 2 (the UKAAF gold sample has none on page 1),
//  capitals omitted (B004 §6).
//  Editor (A17): the loaded document's title is kept (was replaced by the first heading).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument } from '../format/document.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tr = (s) => String(s).replace(/[A-Z]/g, (c) => `,${c}`).toUpperCase();    // capital sign like UEB
const opts = (mode) => ({ mode, width: 40, depth: 25, translate: tr });
const filler = Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `paragraph ${i} with some words to fill a line or two of braille` }));
const pages = (brf) => brf.replace(/\r/g, '').split('\f').map((p) => p.split('\n'));

test('BANA: title with capitals on line 1 of page 1, blank line after; running head keeps capitals', () => {
  const doc = { title: 'Short Title', blocks: [{ type: 'pagenum', page: '5', text: '5' }, { type: 'heading', level: 1, text: 'first chapter' }, ...filler] };
  const ps = pages(formatDocument(doc, opts('bana')));
  const l1 = ps[0][0];
  assert.match(l1, /^\s{3,}\S/);
  assert.ok(l1.includes(',SHORT ,TITLE'), l1);
  assert.equal(ps[0][1], '', 'blank line after the title');
  assert.ok(ps[1][0].includes(',SHORT ,TITLE'), `page 2 running head: ${ps[1][0]}`);
});

test('BANA: a long title continues on line 2 of page 1', () => {
  const doc = { title: 'A Comprehensive Structural Showcase of Every Element', blocks: [...filler] };
  const ps = pages(formatDocument(doc, opts('bana')));
  assert.ok(ps[0][0].trim().startsWith(',A ,COMPREHENSIVE'), ps[0][0]);
  assert.ok(ps[0][1].trim().length > 0 && !ps[0][1].includes('PARAGRAPH'), ps[0][1]);
  assert.equal(ps[0][2], '');
});

test('UKAAF: no title on page 1; lowercase running head from page 2', () => {
  const doc = { title: 'Short Title', blocks: [...filler] };
  const ps = pages(formatDocument(doc, opts('ukaaf')));
  assert.ok(!ps[0][0].includes('TITLE'));
  assert.ok(ps[1][0].includes('SHORT TITLE') && !ps[1][0].includes(','), ps[1][0]);
});

test('editor keeps the loaded title (source check)', () => {
  const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');
  assert.match(ed, /title: loadedDocInfo\.title \|\| \(firstHeading \? firstHeading\.text : null\)/);
  assert.match(ed, /setLoadedDocInfo\(model\);\n\s*modelToLexical\(model\);/);
  assert.match(ed, /if \(loadedDocInfo\.metadata\) model\.metadata = loadedDocInfo\.metadata;/);
});
