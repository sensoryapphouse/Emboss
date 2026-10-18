// Fixes for BANA Formats §20 pronunciation notation (20.3-20.4, 20.6, 21.2.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const { formatDocument, formatBlock, traceBlock } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const T = louis.TABLES.uebG2;
const tr = (s) => louis.translate(s, T);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: (t, tf) => louis.translate(t, T, tf || null), suppressHeader: true };

test('stress marks U+02C8 / U+02CC are ^.b / ^.2 (20.3.1)', () => {
  assert.equal(tr('\\ˈa-prə-ˌkät\\'), '_*^.BA-PR_5-^.2K^3AT_*');
  assert.equal(tr('is ˈ and ˌ.'), 'IS ^.B & ^.24');
});

test('two modifiers on one letter go before it, nearest first (20.4.6)', () => {
  assert.equal(tr('ḉ'), '^&^/C');                      // precomposed c + cedilla + acute
  assert.equal(tr('ḉ'), '^&^/C');
  assert.equal(tr('fē̂ar'), 'F@-^%E>');          // precomposed macron e + circumflex
  assert.equal(tr('fē̂ar'), 'F@-^%E>');
});

test('syllable dot between letters is the raised dot; positions stay aligned', () => {
  assert.equal(tr('ə·māz'), '_5_4M@-AZ');
  const r = louis.translatePos('aˈb', T);
  assert.equal(r.braille.length, r.inputPos.length);
});

test('ordinary text is unchanged', () => {
  assert.equal(tr('café naïve ü'), 'CAF^/E NA^3IVE ^3U');
  assert.equal(tr('the 5′ board'), tr('the 5′ board'));
  assert.equal(tr('a · b'), 'A @* ;B');
});

test('bold entry word of a glossary entry is ignored (21.2.2); the definition keeps its emphasis', () => {
  const doc = (termSegments) => ({ blocks: [{ type: 'list', kind: 'glossary', style: 'glossary', items: [{ level: 0, term: 'accused', def: 'adj. blamed', termSegments, defSegments: [{ type: 'text', text: 'adj. ' }, { type: 'text', text: 'blamed', tf: 1 }] }] }] });
  const bold = formatDocument(doc([{ type: 'text', text: 'accused', tf: 4 }]), opts);
  const plain = formatDocument(doc([{ type: 'text', text: 'accused' }]), opts);
  assert.equal(bold, plain);
  assert.ok(!/\^1/.test(bold.split('\r\n').find((l) => /A3US/.test(l))));
  assert.ok(bold.includes('BLAM'));
});

test('a bold term with no definition (not an entry word) keeps its emphasis', () => {
  // A second, plain entry: a list whose every item is bold loses the bold as decorative (K1, 8.1.4a / 5.3.1).
  const d = { blocks: [{ type: 'list', kind: 'glossary', style: 'glossary', items: [{ level: 0, term: 'accused', termSegments: [{ type: 'text', text: 'accused', tf: 4 }] }, { level: 0, term: 'acquit' }] }] };
  assert.ok(formatDocument(d, opts).includes('^1'));
});

test('traceBlock parity for a glossary entry with a bold entry word (A39)', () => {
  const b = { type: 'list', kind: 'glossary', style: 'glossary', items: [{ level: 0, term: 'accused', def: 'adj. blamed', termSegments: [{ type: 'text', text: 'accused', tf: 4 }] }] };
  const f = formatBlock(b, opts, true);
  const topts = { ...opts, translatePos: (t, tf) => louis.translatePos(t, T, tf || null) };
  const t = traceBlock(b, topts, true, 0).map((l) => (l && typeof l === 'object' ? l.s : l));
  assert.deepEqual(t, f);
});
