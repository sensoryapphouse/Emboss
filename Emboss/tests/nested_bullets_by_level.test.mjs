// G8 stage 1: opt-in sub-level bullet glyphs by list level (block.symbols or o.nestedBullets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, getBlockSignature, collectSpecialSymbols } from '../format/document.mjs';

const o0 = { width: 40, mode: 'bana', translate: (t) => String(t), translatePos: (t) => String(t), listStyle: 'nested' };
const items = () => [
  { marker: '•', level: 0, text: 'one' },
  { marker: '•', level: 1, text: 'two' },
  { marker: '•', level: 2, text: 'three' },
];
const list = (extra = {}, its = items()) => ({ type: 'list', items: its, ...extra });
const fmt = (b, o = o0) => formatBlock(b, o, true);
const plain = (b, o) => JSON.stringify(fmt(b, o));

test('default output unchanged: every level keeps the dot', () => {
  const lines = fmt(list()).filter((l) => l.trim());
  assert.ok(lines.every((l) => l.trim().startsWith('_4')), JSON.stringify(lines));
});

test('opt-in via block.symbols and via o.nestedBullets give level glyphs', () => {
  const a = fmt(list({ symbols: ['•', '◦', '▪'] })).filter((l) => l.trim()).map((l) => l.trim().split(' ')[0]);
  assert.deepEqual(a, ['_4', ';$=', '_$#D']);
  const b = fmt(list(), { ...o0, nestedBullets: true }).filter((l) => l.trim()).map((l) => l.trim().split(' ')[0]);
  assert.deepEqual(b, ['_4', ';$=', '_$#D']);
  assert.notEqual(plain(list()), plain(list({ symbols: ['•', '◦', '▪'] })));
});

test('sequence repeats its last glyph past the end', () => {
  const its = [0, 1, 2, 3].map((level) => ({ marker: '•', level, text: 'x' }));
  const a = fmt(list({ symbols: ['•', '◦'] }, its)).filter((l) => l.trim()).map((l) => l.trim().split(' ')[0]);
  assert.deepEqual(a, ['_4', ';$=', ';$=', ';$=']);
});

test('item.bullet still wins', () => {
  const its = items(); its[1] = { ...its[1], bullet: 'hollow square' };
  const a = fmt(list({ symbols: ['•', '◦', '▪'] }, its)).filter((l) => l.trim()).map((l) => l.trim().split(' ')[0]);
  assert.equal(a[1], ';$#D');
});

test('ordered nested lists are unaffected', () => {
  const its = [{ marker: '1.', level: 0, text: 'a' }, { marker: 'a.', level: 1, text: 'b' }];
  assert.equal(plain(list({ symbols: ['•', '◦'] }, its)), plain(list({}, its)));
});

test('formatBlock and traceBlock agree (opt-in and default)', () => {
  for (const b of [list(), list({ symbols: ['•', '◦', '▪'] })]) {
    const f = fmt(b);
    const t = traceBlock(b, { ...o0, trace: true }, true).map((r) => r.s);
    assert.deepEqual(t, f);
  }
});

test('cache signature differs with symbols / nestedBullets', () => {
  const s0 = getBlockSignature(list(), o0, true);
  assert.notEqual(s0, getBlockSignature(list({ symbols: ['•', '◦'] }), o0, true));
  assert.notEqual(s0, getBlockSignature(list(), { ...o0, nestedBullets: true }, true));
});

test('collectSpecialSymbols reports the level glyphs when opted in, nothing otherwise', () => {
  assert.deepEqual(collectSpecialSymbols([list()], o0), []);
  const r = collectSpecialSymbols([list({ symbols: ['•', '◦', '▪'] })], o0);
  assert.deepEqual(r.map((e) => e.print).sort(), ['▪', '◦']);
  assert.deepEqual(r.find((e) => e.print === '◦').braille, ';$=');
});
