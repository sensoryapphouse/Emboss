// F-128 / F-129 - UKAAF B004 App J poetry methods, optional `poemMethod` on verse lines (UKAAF only):
//   'line-indicator': "Poetry may be written continuously with the line indicator placed at the end of each verse line.
//     Each stanza begins in cell 3 of a new line. The line indicator occurs at the end of each stanza except the last.
//     It doesn't appear at the end of a poem or verse extract." Indicator cells: `o.lineIndicator` (default '_' = dots 456).
//   'stanza-cell3': "...alternatively, each stanza or paragraph may start in cell 3 of a new line." (no blank line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 30, depth: 25, translate: up, suppressHeader: true, ...extra });
const body = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
const v = (text, extra = {}) => ({ type: 'play', subtype: 'verse', style: 'verse', text, ...extra });
const sep = { type: 'indicator', kind: 'line' };
const poem = (pm) => [v('one two', pm ? { poemMethod: pm } : {}), v('three four'), sep, v('five six'), v('seven')];

test('default (no poemMethod): line by line, blank line between stanzas', () => {
  assert.deepEqual(body({ blocks: poem() }).filter((_, i, a) => i < 5), ['ONE TWO', 'THREE FOUR', '', 'FIVE SIX', 'SEVEN']);
});

test('line-indicator: running text, indicator after every line but the last, stanzas at cell 3', () => {
  const l = body({ blocks: poem('line-indicator') });
  assert.equal(l[0], '  ONE TWO_ THREE FOUR_');
  assert.equal(l[1], '  FIVE SIX_ SEVEN');
  assert.ok(!/_\s*$/.test(l[1]));
});

test('line-indicator wraps with runovers in cell 1 and honours o.lineIndicator', () => {
  const blocks = [v('alpha beta gamma delta', { poemMethod: 'line-indicator' }), v('epsilon zeta eta theta')];
  const l = body({ blocks }, { width: 24, lineIndicator: '_/' });
  assert.equal(l[0], '  ALPHA BETA GAMMA');
  assert.equal(l[1], 'DELTA_/ EPSILON ZETA ETA');
  assert.ok(!l[1].startsWith(' '));
  assert.ok(!l.join('').replace(/\s+$/, '').endsWith('_/'));
});

test('stanza-cell3: no blank line, first line of each stanza in cell 3', () => {
  const l = body({ blocks: poem('stanza-cell3') });
  assert.deepEqual(l.slice(0, 4), ['  ONE TWO', 'THREE FOUR', '  FIVE SIX', 'SEVEN']);
});

test('BANA ignores poemMethod (output unchanged)', () => {
  const b = (pm) => formatDocument({ blocks: poem(pm) }, opts({ mode: 'bana', standard: 'bana', width: 40 }));
  assert.equal(b('line-indicator'), b(null));
  assert.equal(b('stanza-cell3'), b(null));
});

test('formatBlock / traceBlock parity for the method blocks', () => {
  for (const block of [
    { type: 'play', subtype: 'verse', segments: [{ type: 'text', text: 'one two' }, { type: 'brl', text: '', brl: '_' }, { type: 'text', text: ' three' }], poemFirst: 2, poemRunover: 0 },
    v('one two three four five', { poemFirst: 2, poemRunover: 4 }),
  ]) {
    const o = { ...opts({ width: 12 }), translatePos: upPos };
    const f = formatBlock(block, o, false);
    const t = traceBlock(block, o, false).map((x) => x.s);
    assert.deepEqual(t, f, JSON.stringify({ f, t }));
  }
});
