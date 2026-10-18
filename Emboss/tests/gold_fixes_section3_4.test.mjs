// Optional fields from the BANA Formats section 3 (Transcriber's notes) and section 4 (Headings) gold set (23 Sep 2026).
// Every field is optional; without it output is unchanged (asserted below).
//  - note.mentionSymbols  F-138: dot locator for mention (.=) before the first use of a listed symbol in the note
//  - note.keyList/keyLocator  F-15, BANA 3.3.2: intro at 7-5, identifications 1-3 between blank lines, closing indicator on the last
//  - para.hangingMargins  F-107 (example 3-2): a paragraph in 1-3 margins holding an embedded (imgnote) note
//  - heading.keepEmphasis  F-41 (already in formatHeading): asserted here for BANA 4.3.7 partial emphasis
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };

test('no optional field: notes and paragraphs unchanged', () => {
  const n = { type: 'note', text: 'The symbol × represents multiplication.' };
  assert.deepEqual(both({ ...n, mentionSymbols: [], keyList: false }), both(n));
  assert.ok(!both(n)[0].includes('.="8'));
  const p = { type: 'para', text: 'Hello there.' };
  assert.deepEqual(both({ ...p, hangingMargins: false }), both(p));
});

test('mentionSymbols: .= before the first use of the symbol only (example 3-1)', () => {
  const out = both({ type: 'note', text: 'The symbol × represents multiplication.', mentionSymbols: ['×'] });
  assert.deepEqual(out, ['      @.<,! SYMBOL .="8 REPRES5TS', '    MULTIPLICA;N4@.>']);
  const twice = both({ type: 'note', text: 'A × and another × sign.', mentionSymbols: ['×'] });
  assert.equal(twice.join(' ').split('.="8').length - 1, 1);
  assert.notEqual(getBlockSignature({ type: 'note', text: 'x', mentionSymbols: ['×'] }, opts), getBlockSignature({ type: 'note', text: 'x' }, opts));
});

test('keyList: intro 7-5, items 1-3 with .=, blanks around, closing indicator on last (example 3-3)', () => {
  const b = { type: 'note', text: 'Analogy symbols used:\n: is to\n:: as', keyList: true, keyLocator: true };
  assert.deepEqual(both(b), ['      @.<,ANALOGY SYMBOLS US$3', '', '.=3 IS TO', '.=33 Z@.>', '']);
  const noLoc = both({ ...b, keyLocator: false });
  assert.deepEqual(noLoc.slice(2, 4), ['3 IS TO', '33 Z@.>']);
  assert.notEqual(getBlockSignature(b, opts), getBlockSignature({ ...b, keyList: false }, opts));
  assert.notEqual(getBlockSignature(b, opts), getBlockSignature({ ...b, keyLocator: false }, opts));
  // fewer than two items: not a key list
  assert.deepEqual(both({ type: 'note', text: 'Intro:\n: is to', keyList: true }), both({ type: 'note', text: 'Intro:\n: is to' }));
});

test('hangingMargins: paragraph with embedded note in 1-3 margins (example 3-2)', () => {
  const b = { type: 'para', hangingMargins: true, segments: [{ type: 'text', text: 'Electrical energy → ' }, { type: 'imgnote', text: 'right arrow' }, { type: 'text', text: ' light and heat' }] };
  assert.deepEqual(both(b), [',ELECTRICAL 5]GY ;\\O @.<"R >R[@.> LI<T &', '  H1T']);
  assert.notEqual(getBlockSignature(b, opts), getBlockSignature({ ...b, hangingMargins: false }, opts));
});

test('heading keepEmphasis keeps italic on the emphasised part (example 4-7)', () => {
  const segs = [{ type: 'text', text: 'Henrik Ibsen, ' }, { type: 'text', text: "A Doll's House", tf: 1 }];
  const kept = both({ type: 'heading', level: 1, segments: segs, keepEmphasis: true });
  // K1 (25 Sep): since BANA 5.3.1 ("When these items are partially emphasized, however, font attributes must be
  // retained"), a partly italic heading keeps its italics without keepEmphasis; a wholly italic one drops them.
  const auto = both({ type: 'heading', level: 1, segments: segs });
  const dropped = both({ type: 'heading', level: 1, segments: [{ type: 'text', text: "A Doll's House", tf: 1 }] });
  assert.ok(kept.join('').includes('.7'));
  assert.deepEqual(auto, kept);
  assert.ok(!dropped.join('').includes('.'));
});
