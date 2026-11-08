// X9 / W16 (Paul, 4 Nov 2026: A1, B1, C1, D1 and the later addition): braille typed with the six keys keeps the print it replaced
// and every hand-brailled run is marked. The pure parts: keeping and merging a run's print (input/sixkey-runs.mjs), and how a run is
// saved in the DTBook file and read back (input/nimas-export.mjs, input/parse.mjs). The editor's own behaviour is in
// tests/test-sixkey-replaced.mjs (a browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';
import { formatDocument } from '../format/document.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';
import {
  normalizePrint, printText, printToAttr, printFromAttr, capturePrint, collapseWithMap, sixkeyForText, splitTextBySixkey, piecesOfText,
} from '../input/sixkey-runs.mjs';

globalThis.DOMParser = DOMParser;

test('a print is text and equations; adjacent text joins, empties go', () => {
  assert.deepEqual(normalizePrint(['a', '', 'b', { latex: 'x^2' }, 'c']), ['ab', { latex: 'x^2' }, 'c']);
  assert.equal(normalizePrint([]), null);
  assert.equal(normalizePrint(['']), null);
  assert.equal(normalizePrint('word'), null);
  assert.equal(printText(['see ', { latex: 'x^2' }]), 'see $x^2$');
});

test('the print survives the file attribute, and bad attributes read as no print', () => {
  const p = ['a "quoted" word\nnext', { latex: 'x', mathml: '<math><mi>x</mi></math>' }];
  assert.deepEqual(printFromAttr(printToAttr(p)), p);
  assert.equal(printToAttr(null), null);
  assert.equal(printFromAttr('not json'), null);
  assert.equal(printFromAttr(''), null);
  assert.equal(printFromAttr('{"a":1}'), null);
});

test('typing over a selection keeps its print; a whole earlier run gives back its own print, not its cells', () => {
  assert.deepEqual(capturePrint([{ text: 'cat' }]), ['cat']);
  assert.deepEqual(capturePrint([{ text: 'the ' }, { latex: 'x^2' }, { text: ' end' }]), ['the ', { latex: 'x^2' }, ' end']);
  // the whole run is selected: its original print is kept
  assert.deepEqual(capturePrint([{ run: true, text: '⠁⠃', print: ['cat'], whole: true }]), ['cat']);
  // part of a run: only its cells are known
  assert.deepEqual(capturePrint([{ run: true, text: '⠁', print: ['cat'], whole: false }, { text: ' dog' }]), ['⠁ dog']);
  // a run with no print selected whole: its cells
  assert.deepEqual(capturePrint([{ run: true, text: '⠁⠃', whole: true }]), ['⠁⠃']);
  assert.equal(capturePrint([{ text: '   ' }]), null);
  assert.equal(capturePrint([]), null);
});

test('runs measured in raw paragraph text follow the model text (collapsed spaces, trimmed ends)', () => {
  const c = collapseWithMap('  a   b  ');
  assert.equal(c.text, 'a b');
  assert.equal(c.map[2], 0);
  assert.equal(c.map[6], 2);
  const r = sixkeyForText('Hi  ⠁⠃ there', [{ start: 4, end: 6, print: ['x'] }], false);
  assert.equal(r.text, 'Hi ⠁⠃ there');
  assert.deepEqual(r.sixkey, [{ start: 3, end: 5, print: ['x'] }]);
  // a paragraph of typed braille only keeps its spaces; trailing blanks are dropped and the run is clipped to what is left
  const e = sixkeyForText('⠁⠃   ⠉⠙  ', [{ start: 0, end: 9 }], true);
  assert.equal(e.text, '⠁⠃   ⠉⠙');
  assert.deepEqual(e.sixkey, [{ start: 0, end: 7 }]);
  // a run that is only trimmed spaces vanishes
  assert.deepEqual(sixkeyForText('a  ', [{ start: 1, end: 3 }], false).sixkey, []);
});

test('runs are cut out of a text as segments, each marked; bad ranges are ignored', () => {
  const segs = splitTextBySixkey('Hi ⠁⠃ there', [{ start: 3, end: 5, print: ['word'] }]);
  assert.deepEqual(segs, [{ type: 'text', text: 'Hi ' }, { type: 'text', text: '⠁⠃', sixkey: { print: ['word'] } }, { type: 'text', text: ' there' }]);
  assert.deepEqual(splitTextBySixkey('⠁⠃', [{ start: 0, end: 2 }]), [{ type: 'text', text: '⠁⠃', sixkey: {} }]);
  assert.deepEqual(splitTextBySixkey('abc', [{ start: 2, end: 9 }, { start: -1, end: 1 }, { start: 1, end: 1 }]), [{ type: 'text', text: 'abc' }]);
  // two runs side by side stay two runs
  assert.equal(splitTextBySixkey('⠁⠃⠉', [{ start: 0, end: 2 }, { start: 2, end: 3, print: ['z'] }]).length, 2);
  assert.deepEqual(piecesOfText('a⠁', [{ start: 1, end: 2 }]), [{ text: 'a' }, { text: '⠁', run: {} }]);
});

const one = (block) => { const xml = exportToNimas({ title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, block] }); return { xml, back: parseDtbook(xml) }; };
const para = (back) => back.blocks.find((b) => b.type === 'para');

test('the DTBook file keeps a run and its print: plain-text paragraph with runs (sidecar form)', () => {
  const { xml, back } = one({ type: 'para', text: 'Hi ⠁⠃ and ⠉ end', sixkey: [{ start: 3, end: 5, print: ['word "one"'] }, { start: 10, end: 11 }] });
  assert.match(xml, /<span class="bana-sixkey" title="\[&quot;word \\&quot;one\\&quot;&quot;\]">⠁⠃<\/span>/);
  assert.match(xml, /<span class="bana-sixkey">⠉<\/span>/);
  const p = para(back);
  assert.ok(Array.isArray(p.segments), 'read back as segments');
  assert.deepEqual(p.segments.filter((s) => s.sixkey).map((s) => [s.text, s.sixkey]), [['⠁⠃', { print: ['word "one"'] }], ['⠉', {}]]);
  assert.equal(p.segments.map((s) => s.text).join(''), 'Hi ⠁⠃ and ⠉ end');
});

test('the DTBook file keeps a run on a segment (emphasis around it) and an equation print', () => {
  const eq = { latex: 'x^2', mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>' };
  const { xml, back } = one({ type: 'para', segments: [{ type: 'text', text: 'bold', tf: 4 }, { type: 'text', text: ' ' }, { type: 'text', text: '⠁', sixkey: { print: [eq] } }] });
  assert.match(xml, /class="bana-sixkey"/);
  const run = para(back).segments.find((s) => s.sixkey);
  assert.deepEqual(run.sixkey.print, [eq]);
  assert.equal(run.text, '⠁');
});

test('a run in a list item and a heading survives too', () => {
  const li = one({ type: 'list', items: [{ segments: [{ type: 'text', text: '⠁', sixkey: { print: ['a'] } }, { type: 'text', text: ' tail', tf: 4 }] }] });
  const item = li.back.blocks.find((b) => b.type === 'list').items[0];
  assert.deepEqual((item.segments || []).find((s) => s.sixkey)?.sixkey, { print: ['a'] });
  const h = exportToNimas({ title: 'T', blocks: [{ type: 'heading', level: 2, segments: [{ type: 'text', text: '⠁⠃', sixkey: {} }, { type: 'text', text: ' x', tf: 4 }] }] });
  const hb = parseDtbook(h).blocks.find((b) => b.type === 'heading' && b.level === 2);
  assert.deepEqual((hb.segments || []).find((s) => s.sixkey)?.sixkey, {});
});

test('a paragraph made only of a typed run keeps its spaces through the file (U+2800 blanks) and the run mark', () => {
  const { xml, back } = one({ type: 'para', text: '⠁⠃   ⠉⠙', sixkey: [{ start: 0, end: 7 }] });
  assert.match(xml, /class="bana-sixkey"/);
  const p = para(back);
  assert.equal((p.segments || []).map((s) => s.text).join('').replace(/⠀/g, ' '), '⠁⠃   ⠉⠙');
  assert.ok((p.segments || []).some((s) => s.sixkey));
});

test('a model with no runs exports exactly as before (no sixkey in the file)', () => {
  const { xml } = one({ type: 'para', text: 'Plain ⠁⠃ text.' });
  assert.doesNotMatch(xml, /sixkey/);
});

test('the marks never change the braille: the formatter lays out marked and unmarked runs identically', () => {
  const tr = (s) => unicodeBrailleToBrf(String(s).toUpperCase());
  const opts = { mode: 'bana', width: 40, depth: 25, translate: tr };
  const plain = [{ type: 'para', text: 'Hi ⠁⠃ there.' }, { type: 'para', text: '⠁⠃   ⠉⠙' }];
  const marked = [
    { type: 'para', text: 'Hi ⠁⠃ there.', sixkey: [{ start: 3, end: 5, print: ['word'] }] },
    { type: 'para', text: '⠁⠃   ⠉⠙', sixkey: [{ start: 0, end: 7 }] },
  ];
  const segs = [{ type: 'para', segments: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: '⠁⠃', sixkey: { print: ['word'] } }, { type: 'text', text: ' there.' }] }];
  assert.equal(formatDocument({ title: 'T', blocks: marked }, opts), formatDocument({ title: 'T', blocks: plain }, opts));
  assert.equal(formatDocument({ title: 'T', blocks: segs }, opts), formatDocument({ title: 'T', blocks: [{ type: 'para', segments: [{ type: 'text', text: 'Hi ⠁⠃ there.' }] }] }, opts));
});
