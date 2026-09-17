// Parser losses found by scripts/run_1000_corpus_benchmark.mjs (the DAISY/NIMAS corpus):
//  - an ordinary list item made of <lic> parts ("1." + an equation) was read as a contents
//    entry, and its equation dropped (file_0043: 109 of 144 equations lost);
//  - a table inside a definition (<dd>) was folded into the definition text (file_0076);
//  - running text inside an unrecognised container (<div><a> Part A <code>…</code> Part B</a>)
//    was dropped (file_0074).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);

test('<lic> item with an item number and an equation is a numbered item, not contents', () => {
  const d = doc(`<list type="ol"><li><lic>1.</lic> <lic><m:math><m:mn>2</m:mn></m:math></lic></li><li><lic>2.</lic> <lic><m:math><m:mn>3</m:mn></m:math></lic></li></list>`);
  const list = d.blocks.find((b) => b.type === 'list');
  assert.notEqual(list.kind, 'toc');
  assert.equal((exportToNimasXml(d).match(/<m:math\b/g) || []).length, 2);
});

test('<lic> contents entries (text + page number) are still contents', () => {
  const d = doc(`<list type="pl"><li><lic>Chapter One</lic> <lic>5</lic></li><li><lic>Chapter Two</lic> <lic class="pagenum">12</lic></li></list>`);
  const list = d.blocks.find((b) => b.type === 'list');
  assert.equal(list.kind, 'toc');
  assert.deepEqual(list.items.map((i) => [i.text, i.page]), [['Chapter One', '5'], ['Chapter Two', '12']]);
});

test('a table inside a definition is its own block after that definition', () => {
  const d = doc(`<dl><dt>data</dt><dd>numbers in tables: <table><tbody><tr><td>012345</td></tr></tbody></table> Data is sorted.</dd><dt>next</dt><dd>more</dd></dl>`);
  assert.deepEqual(d.blocks.map((b) => b.type), ['list', 'table', 'list']);
  assert.ok(!/012345/.test(d.blocks[0].items[0].def));
  assert.equal(d.blocks[1].rows[0][0], '012345');
});

test('running text inside an unrecognised inline container is kept', () => {
  const d = doc(`<div><a href="x"> Part A <code>This is some code</code> Part B</a></div><div><p>Block one</p></div>`);
  const texts = d.blocks.map((b) => b.text);
  assert.ok(texts.some((t) => /Part A.*This is some code.*Part B/.test(t || '')), JSON.stringify(d.blocks));
  assert.ok(texts.includes('Block one'));
});
