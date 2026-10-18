// Formatter fixes found by running the BANA Formats section 11 (Tables) gold set (23 Sep 2026):
//  1. a table title that wraps is divided in balanced lines, not greedy (BANA 4.4.3; F-28/F-40; Sample 11-2);
//  2. no blank line between a caption and the box that follows it (BANA 7.2.1e, 11.3.1c/d; F-69; Sample 11-1);
//  3. a blank cell in the row-heading column is blank in braille, not guide dots (BANA 11.5.3a; Sample 11-5).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s) => ({ braille: translate(s), inputPos: Array.from(s, (_, i) => i) });
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos, suppressHeader: true };

function lines(blocks) {
  const brf = formatDocument({ title: null, blocks }, opts) || '';
  return brf.split('\x0c')[0].split('\r\n').map((l) => l.replace(/\s+$/, ''));
}

test('table title that wraps is balanced, not greedy (formatBlock and traceBlock agree)', () => {
  const table = { type: 'table', title: 'Summary Comparison of Outlays for Payments for Individuals', headers: ['A', 'B'], rows: [['x', 'y']] };
  const out = formatBlock(table, opts).map((l) => l.trim()).filter(Boolean);
  const first = out.slice(0, 2);
  assert.equal(first.length, 2);
  // Balanced: neither line is nearly full while the other holds a single stranded word.
  assert.ok(Math.abs(first[0].length - first[1].length) <= 8, JSON.stringify(first));
  const traced = traceBlock(table, opts);
  const tl = (traced.lines || traced).map((l) => (typeof l === 'string' ? l : l.s ?? '')).map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(tl.slice(0, 2), first);
});

test('no blank line between a caption and the box that follows it', () => {
  const out = lines([
    { type: 'caption', text: 'Figure 24-7 The APY is the best indicator.' },
    { type: 'box', blocks: [{ type: 'table', headers: ['A', 'B'], rows: [['x', 'y']] }] },
  ]);
  const capEnd = out.findIndex((l) => /^\s*g{10,}|^\s*7{10,}/.test(l));
  assert.ok(capEnd > 0, out.join('\n'));
  assert.notEqual(out[capEnd - 1], '', out.join('\n'));
});

test('a blank implied row heading stays blank, not guide dots (11.5.3a)', () => {
  const table = { type: 'table', headers: ['', 'Value'], rows: [['Gender', ''], ['', '12'], ['', '34']] };
  const out = formatBlock(table, opts);
  const dataRows = out.filter((l) => /#/.test(l));
  assert.ok(dataRows.length >= 2);
  for (const l of dataRows) assert.ok(!l.startsWith('"'), 'row starts with guide dots: ' + l);
});
