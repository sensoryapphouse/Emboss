// Formatter fixes for the leftovers named in the 23 Sep 2026 reports (sections 18, 12; builder for 14):
//  - a blocked diagrammed sentence keeps its blank line before it (1.9.3, Example 18-9);
//  - imgnote.spanTypeform: an embedded transcriber's note inside one emphasised run does not break the typeform passage (18.3.3c, Example 18-5);
//  - box.boxLines === false: a sidebar without box lines (12.3.1e-g, Sample 12-7).
// Every new field is optional; without it output is unchanged. formatBlock and traceBlock agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });

test('blocked diagrammed sentence keeps the blank line before it (1.9.3, Example 18-9)', () => {
  const p = { type: 'para', blocked: true, diagram: true, text: 'We arrived at the hotel in the evening.' };
  const out = both(p);
  assert.equal(out[0], '');
  assert.ok(out[1].startsWith(',WE'), out.join('\n'));
  // no field, no change: an unblocked diagrammed sentence has no blank; a continuation has none either
  assert.notEqual(both({ type: 'para', diagram: true, text: 'We arrived at the hotel in the evening.' })[0], '');
  assert.notEqual(both({ ...p, continuation: true })[0], '');
  // the field is part of the cache key
  assert.notEqual(getBlockSignature(p, opts, false), getBlockSignature({ ...p, diagram: false }, opts, false));
});

test('an embedded note inside one italic run: the passage indicator spans it (18.3.3c, Example 18-5)', () => {
  const mk = (span) => ({ type: 'para', blocked: true, continuation: true, segments: [T('I didn’t think so, '), T('but that’s ', { tf: 1 }), { type: 'imgnote', text: 'apostrophe is red', ...(span ? { spanTypeform: true } : {}) }, T(' it.', { tf: 1 })] });
  const out = both(mk(true));
  assert.equal(out[0], ",I DIDN'T ?9K S1 .7B T'S @.<APO/ROPHE IS");
  assert.equal(out[1], "R$@.> X4.'");
  // default is unchanged: each piece takes its own indicators
  const plain = both(mk(false)).join(' ');
  assert.ok(plain.includes('.1B') && plain.includes('.1X4'), plain);
  // the cache key carries the field (it is inside the segments)
  assert.notEqual(getBlockSignature(mk(true), opts, false), getBlockSignature(mk(false), opts, false));
});

test('spanTypeform: cell trace gives the note cells no source and later text keeps its own position', () => {
  const b = { type: 'para', blocked: true, continuation: true, segments: [T('but that’s ', { tf: 1 }), { type: 'imgnote', text: 'red', spanTypeform: true }, T(' it and more.', { tf: 1 })] };
  const tr = traceBlock(b, opts);
  const flat = tr.map((t) => t.s).join('');
  assert.ok(flat.includes('@.<R$@.>'), flat);
  const cells = tr.flatMap((t) => Array.from({ length: t.s.length }, (_, i) => (t.src ? t.src[i] : null)));
  const i0 = flat.indexOf('@.<R$@.>');
  for (let i = i0; i < i0 + 8; i++) assert.ok(cells[i] == null, `note cell ${i} should have no source`);
  assert.equal(cells[i0 + 9] && cells[i0 + 9].c, 15, 'X (it) keeps its print position: 11 text + 3 note characters + a space');
});

test('a sidebar without box lines (12.3.1e-g, Sample 12-7); default keeps the box lines', () => {
  const list = { type: 'list', kind: 'list', items: [{ text: 'assault, C45' }, { text: 'gang, C54' }] };
  const boxed = both({ type: 'box', blocks: [list] });
  assert.ok(boxed.some((l) => /^7+$/.test(l)) && boxed.some((l) => /^G+$/.test(l)), boxed.join('\n'));
  const open = both({ type: 'box', boxLines: false, blocks: [list] });
  assert.ok(!open.some((l) => /^[7G]{10,}$/.test(l)), open.join('\n'));
  assert.equal(open[0], '');
  assert.equal(open[open.length - 1], '');
  assert.ok(open.join('\n').includes('ASSAULT'), open.join('\n'));
  assert.notEqual(getBlockSignature({ type: 'box', boxLines: false, blocks: [list] }, opts, false), getBlockSignature({ type: 'box', blocks: [list] }, opts, false));
});
