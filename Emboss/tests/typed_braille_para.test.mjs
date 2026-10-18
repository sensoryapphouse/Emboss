// Feedback 30 Sep 2026, item 3 (Paul, 1 Oct: "yes"): braille typed into the editor with six-key entry (or pasted Unicode braille)
// came out with the paragraph's indent, so the transcriber could not place it exactly. A paragraph made only of typed braille is
// now output exactly as typed: from cell 1, no paragraph indent, its spaces and line breaks kept, wrapped only where a line is
// longer than the page. A paragraph that mixes print and typed braille is still an ordinary paragraph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

// as styledTranslate: print is translated (upper-cased here), typed Unicode braille passes through as BRF
const tr = (s) => unicodeBrailleToBrf(String(s).toUpperCase());
const U = (brf) => Array.from(brf, (ch) => (ch === ' ' || ch === '\n' ? ch : String.fromCodePoint(0x2800 + ' A1B\'K2L@CIF/MSP"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)='.indexOf(ch)))).join('');
const body = (blocks, mode, extra = {}) => {
  const out = formatDocument({ title: 'T', blocks: [{ type: 'para', text: 'START' }, ...blocks, { type: 'para', text: 'END' }] }, { mode, width: 40, depth: 25, translate: tr, ...extra }).split(/\r?\n/);
  const a = out.findIndex((l) => /START/.test(l)), b = out.findIndex((l) => /END/.test(l));
  return out.slice(a + 1, b);
};

test('a paragraph of typed braille starts in cell 1, not at the paragraph indent', () => {
  for (const mode of ['bana', 'ukaaf']) {
    assert.deepEqual(body([{ type: 'para', text: U('HELLO WORLD') }], mode), ['HELLO WORLD'], mode);
    assert.deepEqual(body([{ type: 'para', segments: [{ type: 'text', text: U('HELLO WORLD') }] }], mode), ['HELLO WORLD'], `${mode} segments`);
  }
});

test('typed braille keeps its spaces: runs of spaces, leading spaces and blank cells (U+2800)', () => {
  assert.deepEqual(body([{ type: 'para', text: U('A   B') }], 'bana'), ['A   B']);
  assert.deepEqual(body([{ type: 'para', text: '    ' + U('AB') }], 'bana'), ['    AB']);
  assert.deepEqual(body([{ type: 'para', text: U('A') + '⠀⠀' + U('B') }], 'bana'), ['A  B']);
});

test('typed braille keeps its line breaks (Shift+Enter), in plain text and in segments', () => {
  assert.deepEqual(body([{ type: 'para', text: U('AB\n  CD') }], 'bana'), ['AB', '  CD']);
  assert.deepEqual(body([{ type: 'para', segments: [{ type: 'text', text: U('AB') }, { type: 'text', text: U('\n  CD') }] }], 'ukaaf'), ['AB', '  CD']);
});

test('a typed line longer than the page wraps at its last space that fits, the runover in cell 1; no space means a break at the edge', () => {
  const long = 'X'.repeat(30) + ' ' + 'Y'.repeat(15);
  assert.deepEqual(body([{ type: 'para', text: U(long) }], 'bana'), ['X'.repeat(30), 'Y'.repeat(15)]);
  assert.deepEqual(body([{ type: 'para', text: U('Z'.repeat(45)) }], 'bana'), ['Z'.repeat(40), 'Z'.repeat(5)]);
});

test('typed braille is not given the blank line of UKAAF block paragraphs', () => {
  const o = { mode: 'ukaaf', width: 40, translate: tr, paragraphStyle: 'block' };
  assert.deepEqual(formatBlock({ type: 'para', text: 'Ab' }, o, false), ['AB', ''], 'an ordinary block paragraph has its blank line');
  assert.deepEqual(formatBlock({ type: 'para', text: U('AB') }, o, false), ['AB']);
});

test('a paragraph that mixes print and typed braille is an ordinary paragraph (indent kept)', () => {
  assert.deepEqual(body([{ type: 'para', text: 'Hello ' + U('AB') }], 'bana'), ['  HELLO AB']);
  assert.deepEqual(body([{ type: 'para', segments: [{ type: 'text', text: 'see ' }, { type: 'text', text: U('AB') }] }], 'bana'), ['  SEE AB']);
});

test('formatBlock and traceBlock agree, and each typed cell links back to its own character', () => {
  const o = { mode: 'bana', width: 40, translate: tr, translatePos: (s) => ({ braille: tr(s), inputPos: Array.from(tr(s), (_, i) => i) }) };
  for (const block of [{ type: 'para', text: U('AB   CD\nEF') }, { type: 'para', segments: [{ type: 'text', text: U('AB') }, { type: 'text', text: U(' CD') }] }]) {
    const traced = traceBlock(block, o, false, 3);
    assert.deepEqual(traced.map((t) => t.s), formatBlock(block, { ...o, translatePos: undefined }, false), JSON.stringify(block));
    for (const t of traced) for (let i = 0; i < t.s.length; i++) if (t.s[i] !== ' ') assert.equal(t.src[i]?.u, 3);
  }
  const traced = traceBlock({ type: 'para', text: U('AB   CD\nEF') }, o, false, 3);
  assert.deepEqual(traced.map((t) => t.src.map((x) => (x ? x.c : null))), [[0, 1, 2, 3, 4, 5, 6], [8, 9]]);
  // segments are linked in the editor's collapsed coordinates (its flatSegText): a run of spaces counts as one character
  const seg = traceBlock({ type: 'para', segments: [{ type: 'text', text: U('AB   CD') }, { type: 'text', text: U('EF') }] }, o, false, 0);
  assert.deepEqual(seg.map((t) => t.src.map((x) => (x ? x.c : null))), [[0, 1, 2, 2, 2, 3, 4, 5, 6]]);
});

test('a styled paragraph of typed braille keeps its style (a quotation keeps its margins)', () => {
  const quoted = body([{ type: 'para', style: 'quote', text: U('AB CD') }], 'bana');
  assert.ok(quoted.some((l) => /^ {2,}AB CD$/.test(l)), JSON.stringify(quoted));
});

test('typed braille keeps its spacing through save and reopen (spaces XML would collapse are saved as blank cells)', async () => {
  const { saveAndReopen } = await import('./helpers/nimas-braille.mjs');
  for (const block of [{ type: 'para', text: U('AB   CD\n  E') }, { type: 'para', segments: [{ type: 'text', text: '  ' + U('AB C') }, { type: 'text', text: U('D\n   E') }] }]) {
    const model = { title: 'T', blocks: [{ type: 'para', text: 'START' }, block, { type: 'para', text: 'END' }] };
    const { xml, back } = await saveAndReopen(model);
    assert.ok(!/<p>[^<]* {2}/.test(xml), xml);
    for (const mode of ['bana', 'ukaaf']) assert.deepEqual(body(back.blocks.slice(1, -1), mode), body([block], mode), `${mode}: ${xml}`);
  }
  // a paragraph that mixes print and braille is saved as it always was
  const { xml } = await saveAndReopen({ title: 'T', blocks: [{ type: 'para', text: 'Hello ' + U('AB') }] });
  assert.ok(!/⠀/.test(xml));
});
