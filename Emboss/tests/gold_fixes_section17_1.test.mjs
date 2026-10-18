// Formatter fixes from the BANA Formats section 17 (Spelling lists and activities) and section 1 gold sets (23 Sep 2026).
// Every new behaviour is optional (or affects only a segment that carried both emphasis and `uncontracted`, whose emphasis used to be
// dropped); without it output is unchanged.
//  - typeform kept on uncontracted (grade 1) text; adjacent uncontracted pieces with emphasis are one word (17.4.1b-c, 17.10.3, 17.13.1)
//  - g1IndicatorNeeded: symbols-only strings (`=`, `+`) need no grade 1 indicator
//  - imgnote.uncontracted (17.11.2b), para.g1Quiet (Examples 17-9, 17-12), list.afterNote (17.9.2a, Sample 17-11)
//  - doc.typeformWordPunct: a single emphasised word followed by punctuation takes no terminator (UEB 9.3.2/9.7.2, Example 1-18)
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, '').toLowerCase());   // braille ASCII lower-cased for readability
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };
const doc = (blocks, extra = {}, o = opts) => clean((formatDocument({ title: null, blocks, ...extra }, o) || '').split('\x0c').join('\r\n').split('\r\n'));
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });
const U = (text, extra = {}) => T(text, { uncontracted: true, ...extra });
const BOLD = 4;

test('17.4.1c: partial bold on an uncontracted word: one word, bold word indicator and terminator (Sample 17-6)', () => {
  const item = { segments: [U('a'), U('cc', { tf: BOLD }), U('ident'), U('ally', { tf: BOLD })] };
  const out = both({ type: 'list', kind: 'list', items: [item] });
  assert.ok(out.some((l) => l.trim() === "a^1cc^'ident^1ally"), out.join('\n'));
  // without emphasis nothing changes: separate uncontracted pieces keep their own indicators
  const plain = both({ type: 'list', kind: 'list', items: [{ segments: [U('a'), U('cc')] }] });
  assert.ok(!/\^/.test(plain.join('')), plain.join('\n'));
});

test('17.10.3: an underlined uncontracted word keeps the underline word indicator (Sample 17-13)', () => {
  const item = { segments: [T('in our '), U('sceince', { tf: 2 }), T(' class')] };
  const out = both({ type: 'list', kind: 'list', items: [item] });
  assert.ok(out.join(' ').includes('_1sceince'), out.join('\n'));
});

test('17.13.1: symbols-only uncontracted pieces (`=`) take no grade 1 indicator in a quiet list (Example 17-13)', () => {
  const item = { segments: [U('amaze +'), T(' '), U('ment', { tf: BOLD }), T(' '), U('='), T(' '), U('amaze'), U('ment', { tf: BOLD })] };
  const out = both({ type: 'list', kind: 'list', items: [item] }).join(' ');
  assert.ok(!out.includes(';;'), out);
  assert.ok(out.includes('amaze^1ment'), out);
});

test('17.11.2b: embedded note with imgnote.uncontracted is written uncontracted; default contracted', () => {
  const para = (uncontracted) => ({ type: 'para', continuation: true, g1Quiet: true, segments: [T('My '), U('jeans'), T(' '), { type: 'imgnote', text: 'je-ns', uncontracted }, T(' shrunk.')] });
  const a = both(para(true)).join(' ');
  assert.ok(a.includes('@.<je-ns@.>'), a);
  assert.ok(!a.includes(';;'), 'g1Quiet: no indicator on jeans: ' + a);
  const dflt = both({ ...para(false), g1Quiet: false }).join(' ');
  assert.ok(/;;/.test(dflt), dflt);
  assert.notEqual(getBlockSignature(para(true), opts, false), getBlockSignature({ ...para(true), g1Quiet: false }, opts, false));
});

test('17.9.2a: list.afterNote puts the explaining note directly above the list; default keeps the blank line', () => {
  const note = { type: 'note', text: 'Print uses a square for omitted letters.' };
  const list = { type: 'list', kind: 'list', items: [{ marker: '1.', text: 'w_ght' }] };
  const withField = doc([note, { ...list, afterNote: true }]);
  const without = doc([note, list]);
  assert.equal(without.length, withField.length + 1, without.join('\n') + '\n--\n' + withField.join('\n'));
  assert.notEqual(getBlockSignature(list, opts, false), getBlockSignature({ ...list, afterNote: true }, opts, false));
});

test('UEB 9.3.2/9.7.2: doc.typeformWordPunct drops the terminator between an italic word and its full stop (Example 1-18); default unchanged', () => {
  const segs = [T('The word for sled is '), T('trineo', { tf: 1 }), T('.')];
  const blocks = [{ type: 'para', segments: segs, continuation: true }];
  const dflt = doc(blocks).join(' ');
  assert.ok(dflt.includes(".1tr9eo.'4"), dflt);
  const on = doc(blocks, { typeformWordPunct: true }).join(' ');
  assert.ok(on.includes('.1tr9eo4') && !on.includes(".'"), on);
  // followed by letters (a plural), or several words: unchanged
  const plural = doc([{ type: 'para', continuation: true, segments: [T('the '), T('trineo', { tf: 1 }), T('s.')] }], { typeformWordPunct: true }).join(' ');
  assert.ok(plural.includes(".'"), plural);
  // traceBlock agrees with formatBlock when the option is on
  const o2 = { ...opts, typeformWordPunct: true };
  both({ type: 'para', continuation: true, segments: segs }, o2);
  assert.notEqual(getBlockSignature(blocks[0], opts, false), getBlockSignature(blocks[0], o2, false));
});
