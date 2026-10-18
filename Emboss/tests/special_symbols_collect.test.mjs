// G8 stage 4: collectSpecialSymbols(blocks, o) — the symbols that need a Special Symbols page entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSpecialSymbols } from '../format/document.mjs';

const list = (items) => ({ type: 'list', items });

test('no symbols -> []', () => {
  assert.deepEqual(collectSpecialSymbols([], {}), []);
  assert.deepEqual(collectSpecialSymbols([{ type: 'paragraph', text: 'Hi' }, list([{ marker: '•', text: 'a' }])], {}), []);
});

test('nested list: hollow circle (level 2) and solid square (level 3); dot excluded', () => {
  const b = [list([
    { marker: '•', level: 0, text: 'one' },
    { marker: '○', level: 1, text: 'two' },
    { marker: '■', level: 2, text: 'three' },
  ])];
  const r = collectSpecialSymbols(b, {});
  assert.equal(r.length, 2);
  const c = r.find((e) => e.print === '○'), s = r.find((e) => e.print === '■');
  assert.equal(c.braille, ';$='); assert.equal(c.kind, 'bullet'); assert.equal(c.level, 1); assert.equal(c.name, 'hollow circle');
  assert.equal(s.braille, '_$#D'); assert.equal(s.level, 2);
  assert.deepEqual(c.firstUse, [0, 1]);
});

test('same glyph twice -> one entry, first use kept', () => {
  const r = collectSpecialSymbols([list([{ marker: '○', text: 'a' }]), list([{ marker: '○', text: 'b' }])], {});
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].firstUse, [0, 0]);
});

test('item.bullet beside an ordinal marker counts', () => {
  const r = collectSpecialSymbols([list([{ marker: '1.', bullet: 'hollow square', text: 'a' }])], {});
  assert.deepEqual(r.map((e) => e.braille), [';$#D']);
});

test('symbols inside a sidebar and a note', () => {
  const b = [
    { type: 'paragraph', text: 'x' },
    { type: 'sidebar', blocks: [list([{ marker: '▲', text: 'a' }])] },
    { type: 'note', blocks: [{ type: 'paragraph', segments: [{ type: 'brl', brl: '.=@#7 ', text: '[' }] }] },
  ];
  const r = collectSpecialSymbols(b, {});
  assert.equal(r.length, 2);
  assert.ok(r.some((e) => e.kind === 'bullet' && e.braille === ';$#C' && e.firstUse.join() === '1,0,0'));
  assert.ok(r.some((e) => e.kind === 'literal' && e.braille === '.=@#7' && e.print === '[' && e.firstUse.join() === '2,0'));
});

test('literal cells in list items, tnpage entries and table cells', () => {
  const seg = { type: 'brl', brl: ';?', text: '⁂' };
  const r = collectSpecialSymbols([
    list([{ marker: '1.', segments: [seg], text: '' }]),
    { type: 'tnpage', entries: [{ segments: [{ type: 'brl', brl: '"9', text: '*' }] }] },
    { type: 'table', rows: [[{ segments: [{ type: 'brl', brl: '@,?', text: '†' }] }]] },
  ], {});
  assert.deepEqual(r.map((e) => e.braille).sort(), ['"9', ';?', '@,?']);
});

test('braille order (UEB 1.1.2), not first use', () => {
  // ;$#C = ⠨.. see order table; here: literal 'B'-line-1 cell vs a line-3 cell vs a line-7 cell
  const mk = (brl) => ({ type: 'paragraph', segments: [{ type: 'brl', brl, text: brl }] });
  const r = collectSpecialSymbols([mk('U'), mk('@'), mk('A'), mk('K')], {});
  assert.deepEqual(r.map((e) => e.braille), ['A', 'K', 'U', '@']);   // line 1, line 2, line 3, line 7 (dot 4 = @)
});

test('dot bullet alone is excluded; odd entries do not throw', () => {
  assert.deepEqual(collectSpecialSymbols([list([{ marker: '•', text: 'a' }, { bullet: 'dot', marker: '1.' }])], {}), []);
  assert.doesNotThrow(() => collectSpecialSymbols([null, undefined, 3, 'x', [], [null], {}, { items: [null, 5, {}] }, { blocks: 'no' }, { segments: [null, 1] }, list(null)], undefined));
  assert.deepEqual(collectSpecialSymbols(null, {}), []);
});

test('G8 stage 1: opt-in level glyphs are collected; default nested dots are not', () => {
  const its = [{ marker: '•', level: 0, text: 'a' }, { marker: '•', level: 1, text: 'b' }, { marker: '•', level: 2, text: 'c' }];
  assert.deepEqual(collectSpecialSymbols([list(its)], {}), []);
  const r = collectSpecialSymbols([{ type: 'list', symbols: ['•', '◦', '▪'], items: its }], {});
  assert.deepEqual(r.map((e) => e.print).sort(), ['▪', '◦']);
  assert.equal(collectSpecialSymbols([list(its)], { nestedBullets: true }).length, 2);
});
