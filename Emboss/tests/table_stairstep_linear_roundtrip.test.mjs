// T4 follow-up (F-18): block.format 'stairstep' / 'linear' (plus stairstep's subdivisionRows /
// subdivisionHeading) survive DTBook export -> parse. Vertical/listed/spatial are unchanged
// (see table_vertical_division.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';

const findTable = (blocks) => {
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'table') return b;
    if (Array.isArray(b.blocks)) { const r = findTable(b.blocks); if (r) return r; }
  }
  return null;
};
const tbl = (x) => x.match(/<table[\s\S]*<\/table>/)[0];
const trip = (block) => {
  const xml = exportToNimasXml({ title: null, blocks: [block] });
  return { xml, t: findTable(parseDtbook(xml).blocks) };
};

test('stairstep round-trips with subdivision rows, heading and multi-paragraph cells', () => {
  const block = {
    type: 'table', format: 'stairstep', headers: ['Place', 'Note'],
    rows: [['Asia', ''], ['Japan', 'one\ntwo'], ['Europe', ''], ['France', 'x']],
    subdivisionRows: [0, 2], subdivisionHeading: 'Continent',
  };
  const { xml, t } = trip(block);
  assert.match(xml, /<table class="bana-stairstep" title="Continent">/);
  assert.equal(t.format, 'stairstep');
  assert.deepEqual(t.headers, block.headers);
  assert.deepEqual(t.rows, block.rows);
  assert.deepEqual(t.subdivisionRows, [0, 2]);
  assert.equal(t.subdivisionHeading, 'Continent');
  // second round: export of the re-parse is identical
  assert.equal(tbl(exportToNimasXml({ title: null, blocks: [t] })), tbl(xml));
});

test('stairstep without subdivisions carries none', () => {
  const { xml, t } = trip({ type: 'table', format: 'stairstep', headers: ['A', 'B'], rows: [['1', '2']] });
  assert.match(xml, /<table class="bana-stairstep">/);
  assert.equal(t.format, 'stairstep');
  assert.equal(t.subdivisionRows, undefined);
  assert.equal(t.subdivisionHeading, undefined);
});

test('linear round-trips', () => {
  const block = { type: 'table', format: 'linear', headers: ['State', 'Capital'], rows: [['Ohio', 'Columbus']] };
  const { xml, t } = trip(block);
  assert.match(xml, /<table class="bana-linear">/);
  assert.equal(t.format, 'linear');
  assert.deepEqual(t.rows, block.rows);
  assert.equal(tbl(exportToNimasXml({ title: null, blocks: [t] })), tbl(xml));
});

test('subdivision data is ignored on a non-stairstep table', () => {
  const { xml } = trip({ type: 'table', format: 'listed', headers: ['A', 'B'], rows: [['1', '2']], subdivisionRows: [0], subdivisionHeading: 'X' });
  assert.doesNotMatch(xml, /bana-subdivision|title=/);
});
