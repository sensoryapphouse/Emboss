// Formatter fixes from the BANA Formats section 8 (Lists) gold set (23 Sep 2026):
//  1. bullet glyphs keep their own braille correspondence (8.6.2a; F-33; Samples 8-14, 8-15);
//  2. an ordinal beside a bullet, and unbulleted items aligned with bulleted ones (8.7.1a-b; F-42; Examples 8-5a, 8-6);
//  3. a list printed in side-by-side columns keeps them when it fits (8.4.1, 8.4.1a-b; F-34; Sample 8-5);
//  4. a heading that accompanies a box takes no blank line before it (7.2.1e; F-69; Sample 8-4).
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

const fmt = (block) => formatBlock(block, opts).map((l) => l.replace(/\s+$/, ''));
const trc = (block) => {
  const t = traceBlock(block, opts);
  return (t.lines || t).map((l) => (typeof l === 'string' ? l : l.s ?? '').replace(/\s+$/, ''));
};
const both = (block) => { const a = fmt(block); assert.deepEqual(trc(block), a, 'traceBlock differs from formatBlock'); return a; };
const doc = (blocks) => (formatDocument({ title: null, blocks }, opts) || '').split('\x0c')[0].split('\r\n').map((l) => l.replace(/\s+$/, ''));

test('bullet glyphs other than the dot use their own correspondences (8.6.2a)', () => {
  const list = { type: 'list', kind: 'list', items: [
    { text: 'Tea', marker: '•', level: 0 }, { text: 'Black', marker: '○', level: 1 }, { text: 'Solid', marker: '■', level: 0 },
    { text: 'Ticked', marker: '√', level: 0 }, { text: 'Square', marker: '□', level: 0 }, { text: 'Up', marker: '▲', level: 0 },
  ] };
  const out = both(list).filter(Boolean);
  assert.ok(out[0].startsWith('_4 '), out[0]);
  assert.ok(out[1].startsWith('  ;$= '), out[1]);
  assert.ok(out[2].startsWith('_$#D '), out[2]);
  assert.ok(out[3].startsWith('@% '), out[3]);   // K22(b) / errata: checkmark bullet is @% (dot 4 + dots 146), not "% (Sample 8-13, UEB 3.28)
  assert.ok(out[4].startsWith(';$#D '), out[4]);
  assert.ok(out[5].startsWith(';$#C '), out[5]);
});

test('an ordinal beside a bullet, and unbulleted items aligned to it (8.7.1a-b, Example 8-5a)', () => {
  const list = { type: 'list', kind: 'list', items: [
    { text: 'ONE', marker: '1.', level: 0 }, { text: 'TWO', marker: '2.', bullet: 'dot', level: 0 }, { text: 'THREE', marker: '3.', level: 0 },
  ] };
  const out = both(list).filter(Boolean);
  assert.equal(out[0].indexOf('#'), 3, out.join('\n'));
  assert.ok(out[1].startsWith('_4 #B'), out[1]);
  assert.equal(out[2].indexOf('#'), 3);
});

test('unbulleted items align with bulleted ones and runovers stay two cells in (8.7.1b, Example 8-6)', () => {
  const list = { type: 'list', kind: 'list', items: [
    { text: 'Bowdrie', level: 0 }, { text: 'Chancy', marker: '•', level: 0 },
    { text: 'A very long unbulleted title that must wrap onto a second braille line here', level: 0 },
  ] };
  const out = both(list).filter(Boolean);
  assert.ok(/^ {3}\S/.test(out[0]), out[0]);
  assert.ok(out[1].startsWith('_4 '), out[1]);
  assert.ok(/^ {5}\S/.test(out[3]), out.join('\n'));
});

test('a list with no bullets, or all bulleted, is unchanged', () => {
  const plain = both({ type: 'list', kind: 'list', items: [{ text: 'a', level: 0 }, { text: 'b', level: 0 }] }).filter(Boolean);
  assert.ok(plain.every((l) => /^\S/.test(l)), plain.join('\n'));
  const all = both({ type: 'list', kind: 'list', items: [{ text: 'a', marker: '•', level: 0 }, { text: 'b', marker: '•', level: 0 }] }).filter(Boolean);
  assert.ok(all.every((l) => l.startsWith('_4 ')), all.join('\n'));
});

test('a columned simple list keeps its columns when they fit; column 2 two cells after the longest of column 1 (8.4.1b)', () => {
  const names = ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Northwest Territories', 'Yukon Territory', 'Nunavut'];
  const list = { type: 'list', kind: 'list', columns: 2, items: names.map((text) => ({ text, level: 0 })) };
  const out = both(list).filter(Boolean);
  assert.equal(out.length, 7);
  const start2 = out[0].search(/\s,PR/);
  const longest = Math.max(...out.map((l) => l.split(/ {2,}/)[0].length).slice(0, 7));
  assert.equal(out[0].length - out[0].trimStart().length, 0);
  assert.equal(out[0].indexOf(',PR9CE') , longest + 2, out.join('\n'));
  assert.ok(start2 > 0);
  // the seventh row has only the left column (left column takes the extra item)
  assert.ok(!/\s{2}\S/.test(out[6]), out[6]);
  // a heading before it is separated by a blank line (8.4.1a)
  const d = doc([{ type: 'heading', level: 2, text: 'Provinces' }, list]);
  const h = d.findIndex((l) => /PROV/.test(l));
  assert.equal(d[h + 1], '', d.join('\n'));
  // without `columns`, or with bullets (8.7.1c), it stays one column
  assert.equal(both({ ...list, columns: undefined }).filter(Boolean).length, 13);
  assert.equal(both({ ...list, items: list.items.map((it, i) => (i === 0 ? { ...it, marker: '•' } : it)) }).filter(Boolean).length, 13);
  // too wide for the page: one column
  assert.equal(both({ ...list, columns: 3 }).filter(Boolean).length, 13);
});

test('a heading marked as accompanying the box takes no blank before the top box line (7.2.1e)', () => {
  const box = { type: 'box', blocks: [{ type: 'para', text: 'Boxed text.' }] };
  const withFlag = doc([{ type: 'heading', level: 2, text: 'Care', accompaniesBox: true }, box]);
  const i = withFlag.findIndex((l) => /^7{10,}/.test(l));
  assert.ok(i > 0 && withFlag[i - 1] !== '', withFlag.join('\n'));
  const without = doc([{ type: 'heading', level: 2, text: 'Care' }, box]);
  const j = without.findIndex((l) => /^7{10,}/.test(l));
  assert.equal(without[j - 1], '', without.join('\n'));
});
