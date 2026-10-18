// Small, fully-determined findings from Emboss/docs/standards-findings.md fixed 23 Sep 2026:
// F-50 (BANA 1.11.7c doubled continuation letters) and F-238 (no extra comma after an
// entry already punctuated inside a closing quote, BANA Example 21-1).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock } from '../format/document.mjs';
import { continuationPrefix } from '../format/page.mjs';

describe('F-50 continuation letters (BANA 1.11.7c)', () => {
  test('a..z then aa, bb, ... zz', () => {
    assert.equal(continuationPrefix(1), 'A');
    assert.equal(continuationPrefix(2), 'B');
    assert.equal(continuationPrefix(26), 'Z');
    assert.equal(continuationPrefix(27), 'AA');
    assert.equal(continuationPrefix(28), 'BB');
    assert.equal(continuationPrefix(29), 'CC');
    assert.equal(continuationPrefix(52), 'ZZ');
  });
  test('no continuation gives no prefix', () => {
    assert.equal(continuationPrefix(0), '');
  });
});

describe('F-238 page reference after an already-punctuated entry', () => {
  const up = (s) => String(s).toUpperCase();
  const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
  const render = (text) => {
    const block = { type: 'list', kind: 'index', items: [{ text, page: '302' }] };
    const f = formatBlock(block, o).map((l) => l.replace(/\s+$/, '')).join('\n');
    const t = traceBlock(block, o).map((x) => x.s.replace(/\s+$/, '')).join('\n');
    assert.equal(t, f, 'traceBlock must match formatBlock');
    return f;
  };
  test('comma inside a closing quote: no second comma', () => {
    assert.ok(/ACTION ARCHAEOLOGY,” 302/.test(render('“Action archaeology,”')), render('“Action archaeology,”'));
  });
  test('trailing period inside a closing paren: no comma', () => {
    assert.ok(/\(SEE ALSO X\.\) 302/.test(render('Sea (see also X.)')));
  });
  test('unpunctuated entry still gets the comma', () => {
    assert.ok(/SEA, 302/.test(render('Sea')), render('Sea'));
  });
  test('closing quote without inner punctuation still gets the comma', () => {
    assert.ok(/”SEA”, 302|SEA”, 302/.test(render('“Sea”')), render('“Sea”'));
  });
});
