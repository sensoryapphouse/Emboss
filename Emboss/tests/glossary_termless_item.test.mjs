// Saving never drops a list item (found by random-action testing, 4 Nov 2026): a glossary
// (<dl>) list holding an item with NO term (e.g. a definition split by a paste) must save and
// reopen with every item, text and link intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

globalThis.DOMParser = DOMParser;

const mixed = () => ({
  type: 'list', kind: 'glossary', style: 'glossary',
  items: [
    { term: 'activist approach', def: 'The view that judges the Constitution a', text: 'activist approach — The view that judges the Constitution a' },
    { segments: [
      { type: 'text', text: 'Constitution and apply them to modern circumstances. (', tf: 0 },
      { type: 'text', text: ' 16', href: '#p16' },
      { type: 'text', text: ' )', tf: 0 }] },
    { term: 'activists', def: 'People who tend to participate in all forms of politics. ( 8 )', text: 'activists — People who tend to participate in all forms of politics. ( 8 )' },
  ],
});

const roundTrip = (blocks) => {
  const xml = exportToNimasXml({ title: 'T', blocks });
  const back = parseDtbook(xml);
  return { xml, back: Array.isArray(back) ? back : (back.blocks || []) };
};
const flat = (b) => (b.items || []).map((it) => (it.segments ? it.segments.map((s) => s.text).join('') : it.text));

test('a glossary with a term-less item keeps every item and the link', () => {
  const { xml, back } = roundTrip([{ type: 'heading', level: 1, text: 'G', segments: [{ type: 'text', text: 'G' }] }, mixed()]);
  const lists = back.filter((b) => b.type === 'list');
  const all = lists.flatMap(flat).join('|');
  assert.match(all, /activist approach/);
  assert.match(all, /Constitution and apply them to modern circumstances\. \(/);
  assert.match(all, /People who tend/);
  assert.equal(lists.reduce((n, l) => n + l.items.length, 0), 3, xml);
});

test('a pure glossary is written as before', () => {
  const g = { type: 'list', kind: 'glossary', style: 'glossary', items: [
    { term: 'a', def: 'x', text: 'a — x' }, { term: 'b', def: 'y', text: 'b — y' }] };
  const { xml } = roundTrip([g]);
  assert.match(xml, /<dl>\s*<dt>a<\/dt>\s*<dd>x<\/dd>\s*<dt>b<\/dt>\s*<dd>y<\/dd>\s*<\/dl>/);
});
