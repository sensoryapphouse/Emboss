// A print asterism break (⁂ ⁂ ⁂), A27l. BANA Formats §1.9.5: follow print; a symbol with no
// braille equivalent becomes a transcriber-defined symbol (RUEB §3.26: ⠹, grade 1 mode →
// ";?"), centred and spaced, explained before its first use (RUEB §3.26.1, Formats §3.3.1)
// until the Special Symbols page exists. UKAAF B004: three spaced centred asterisks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;
const up = (s) => String(s).toUpperCase();
const opts = (mode) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const body = (brf) => brf.replace(/\r/g, '').split('\n').filter((l) => l.trim() && !/^\s+#[A-J]+$/.test(l));

test('the parser keeps ⁂ as its own break kind and the NIMAS save keeps the symbol', () => {
  const d = parseDtbook('<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><p>One.</p><div class="doc-break"><p class="break">⁂ ⁂ ⁂</p></div><p class="break">* * *</p></level1></bodymatter></book></dtbook>');
  assert.deepEqual(d.blocks.filter((b) => b.type === 'break').map((b) => b.kind), ['asterism', 'asterisks']);
  const again = parseDtbook(exportToNimasXml(d));
  assert.deepEqual(again.blocks.filter((b) => b.type === 'break').map((b) => b.kind), ['asterism', 'asterisks']);
});

test('BANA: transcriber-defined symbol, explained once before its first use', () => {
  const blocks = [{ type: 'para', text: 'One.' }, { type: 'break', kind: 'asterism' }, { type: 'para', text: 'Two.' }, { type: 'break', kind: 'asterism' }];
  const lines = body(formatDocument({ blocks }, opts('bana')));
  assert.equal(lines.filter((l) => l.trim() === ';? ;? ;?').length, 2, JSON.stringify(lines));
  assert.equal(lines.filter((l) => l.includes('@.<.=;?')).length, 1, 'one note, at the first use');
  assert.ok(lines.findIndex((l) => l.includes('@.<.=;?')) < lines.findIndex((l) => l.trim() === ';? ;? ;?'));
  const tn = formatBlock({ type: 'break', kind: 'asterism', tdNote: true }, opts('bana'));
  assert.deepEqual(traceBlock({ type: 'break', kind: 'asterism', tdNote: true }, opts('bana')).map((t) => t.s), tn);
});

test('UKAAF: three spaced centred asterisks, no note', () => {
  const lines = body(formatDocument({ blocks: [{ type: 'para', text: 'One.' }, { type: 'break', kind: 'asterism' }] }, opts('ukaaf')));
  assert.ok(lines.some((l) => l.trim() === '"9 "9 "9'), JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.includes('@.<')));
});
