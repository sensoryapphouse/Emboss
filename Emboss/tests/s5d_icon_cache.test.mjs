// Audit batch S5d (Emboss/docs/chatgpt-audit-15oct.md, "Cached non-position formatter API"): the sync formatter's per-block cache
// (o.blockCache) did not include the document's icon-symbol mapping in a non-list block's key. Putting a different icon BEFORE a
// cached paragraph gives that paragraph's icon the next symbol slot, but the cached lines still had the old slot: the braille of the
// paragraph and the Special Symbols page disagreed. (The editor's traced path does not supply this cache and Quick Mode does not
// either; the reproduction is the sync cached API.) The key now carries the mapping, so a warm cache equals a cold render.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
// no translatePos: the non-position formatter API, the one that supplies a block cache
const opts = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, suppressHeader: true, ...extra });

const BULB = '\u{1F4A1}', PROHIBITED = '\u{1F6AB}';
const para = (text) => ({ type: 'para', text });

test('S5d: a warm blockCache equals a cold render after an icon is put before a cached paragraph', () => {
  const cache = new Map();
  // (the bulb paragraph is not the first block in either document: the cache key also holds "first on the page")
  const first = { title: null, blocks: [para('Plain text first.'), para(`Turn on the ${BULB} switch.`)] };
  const firstBrf = formatDocument(first, opts({ blockCache: cache }));
  // a different icon now comes before it: the bulb moves from the first symbol to the second
  const second = { title: null, blocks: [para('Plain text first.'), para(`Do not ${PROHIBITED} enter.`), para(`Turn on the ${BULB} switch.`)] };
  const cold = formatDocument(second, opts());
  const warm = formatDocument(second, opts({ blockCache: cache }));
  assert.notEqual(firstBrf.split('\n').find((l) => /SWIT/.test(l)), cold.split('\n').find((l) => /SWIT/.test(l)), 'the test is meaningful: the bulb\'s symbol changed');
  assert.equal(warm, cold, 'the cached paragraph with the bulb must show the bulb\'s new symbol');
});

test('S5d: with no icons a block cache is still used (the key adds nothing)', () => {
  const cache = new Map();
  const doc = { title: null, blocks: [para('One.'), para('Two.')] };
  formatDocument(doc, opts({ blockCache: cache }));
  const n = cache.size;
  assert.ok(n >= 2);
  formatDocument(doc, opts({ blockCache: cache }));
  assert.equal(cache.size, n);
});
