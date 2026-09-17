// A2: index page references reach the braille.
//  - An index entry's page references directly follow it: BANA Formats §21.4 (Example 21-12
//    "Sea, 237"); UKAAF B004 App I ("page numbers directly follow the index entry").
//    They were dropped from the braille for every list that was not contents.
//  - <lic class="index-line">/<lic class="index-pg"> make an index (it was read as contents,
//    and the long page column made the UKAAF contents layout throw: the list was skipped).
//  - Linked references side by side (<a>p. 98</a><a>p. 101</a>) are separate: "p. 98, p. 101".
//  - UKAAF contents whose page column would take more than half the line fall back to the
//    same layout instead of throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
const opts = (mode, width = 40) => ({ mode, width, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const parity = (blk, o) => assert.deepEqual(traceBlock(blk, o).map((t) => t.s), formatBlock(blk, o));

test('index page references follow the entry, in both modes', () => {
  const blk = { type: 'list', kind: 'index', items: [{ text: 'Aegean Sea', page: '237' }, { text: 'Africa,', page: '365, 461' }, { text: 'Bold', segments: [{ type: 'text', text: 'Bold', tf: 4 }], page: '5' }] };
  for (const mode of ['bana', 'ukaaf']) {
    const lines = formatBlock(blk, opts(mode));
    assert.ok(lines.includes('AEGEAN SEA, 237'), JSON.stringify(lines));
    assert.ok(lines.includes('AFRICA, 365, 461'), JSON.stringify(lines));
    parity(blk, opts(mode));
  }
});

test('an index with linked page references is parsed as an index', () => {
  const d = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>Index</h1><level2><h2>A</h2>
    <list type="pl"><li><lic class="index-line">Alain</lic><lic class="index-pg"><a href="#a">p. 141</a><a href="#b">p. 192</a></lic></li></list>
  </level2></level1></bodymatter></book></dtbook>`);
  const list = d.blocks.find((b) => b.type === 'list');
  assert.equal(list.kind, 'index');
  assert.deepEqual(list.items[0], { text: 'Alain', page: 'p. 141, p. 192' });
  assert.equal(d.warnings, undefined);
  assert.ok(formatBlock(list, opts('ukaaf', 38)).includes('ALAIN, P. 141, P. 192'));
});

test('UKAAF contents with a page column too wide for columns do not throw', () => {
  const long = Array.from({ length: 11 }, (_, i) => `p. ${100 + i}`).join(', ');
  const blk = { type: 'list', kind: 'toc', items: [{ text: 'Entry', page: long }, { text: 'Next', page: 'p. 3' }] };
  const lines = formatBlock(blk, opts('ukaaf', 38));
  assert.ok(lines.length > 2, JSON.stringify(lines));
  assert.ok(lines.join(' ').includes('P. 110'));
  parity(blk, opts('ukaaf', 38));
});

// The save keeps what the braille shows (the corpus benchmark now re-reads every save).
const reread = (body) => {
  const d = parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1>${body}</level1></bodymatter></book></dtbook>`);
  const xml = exportToNimasXml(d);
  return { d, xml, again: parseDtbook(xml) };
};
const lists = (m) => m.blocks.filter((b) => b.type === 'list');

test('save: index page references are kept', () => {
  const { xml, again } = reread(`<list type="pl"><li><lic class="index-line">Alain</lic><lic class="index-pg"><a href="#a">p. 141</a><a href="#b">p. 192</a></lic></li></list>`);
  assert.match(xml, /<lic class="bai-index-page">p\. 141, p\. 192<\/lic>/);
  assert.deepEqual(lists(again)[0].items[0], { text: 'Alain', page: 'p. 141, p. 192' });
  assert.equal(lists(again)[0].kind, 'index');
});

test('save: list numbering is kept (a list split by a page turn; lettered items)', () => {
  const { d, xml, again } = reread(`<list type="ol"><li>one</li><pagenum page="normal">5</pagenum><li>two</li><li>three</li></list><list type="ol"><li>b. bee</li><li>d. dee</li></list>`);
  assert.match(xml, /<list type="ol" start="2">/);
  assert.match(xml, /<li>b\. bee<\/li>/);
  const markers = (m) => lists(m).map((l) => l.items.map((i) => i.marker));
  assert.deepEqual(markers(d), [['1.'], ['2.', '3.'], ['b.', 'd.']]);
  assert.deepEqual(markers(again), markers(d));
});
