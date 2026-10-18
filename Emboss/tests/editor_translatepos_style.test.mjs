// A71 (26 Sep 2026): the editor's braille comes from the layout path's position-tracking
// translator (o.translatePos), which applied only the quote exchange. Quick Mode's translator
// (styledTranslate) also cleans up whitespace and invisible characters, so for the same text the
// editor brailled a soft hyphen as a hyphen, a zero-width space as a space, and wrote a raw
// no-break space (0xA0) into the BRF. styledTranslatePos gives the editor the same house style, with
// each braille cell still pointing at the right character of the original text.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatDocumentAsync } from '../format/document.mjs';
import { styledTranslate, styledTranslatePos } from '../format/text-style.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const raw = (s, tf) => louis.translate(s, T, tf || null);
const rawPos = (s, tf) => louis.translatePos(s, T, tf || null);

const CASES = {
  'no-break space': 'Price £5 today.',
  'narrow no-break space': 'Page 12 here.',
  'zero-width space': 'zero​width word.',
  'soft hyphen': 'extra­ordinary result.',
  'bidi mark': 'left‎right text.',
  'subscript marker': 'Carbon dioxide is CO2 in air.',
  'unicode braille': 'Literal ⠁⠃⠉ braille here.',
  'curly quotes': '‘Hello,’ she said.',
};

for (const quoteStyle of ['faithful', 'exchange']) {
  test(`editor and Quick Mode braille agree (${quoteStyle} quotes)`, async () => {
    for (const [name, text] of Object.entries(CASES)) {
      const doc = { title: null, blocks: [{ type: 'para', text }] };
      const base = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: styledTranslate(raw, quoteStyle) };
      const quick = formatDocument(doc, base);
      const editor = await formatDocumentAsync(doc, { ...base, translatePos: styledTranslatePos(rawPos, quoteStyle) });
      assert.equal(editor, quick, `${name}: editor braille differs from Quick Mode`);
      assert.ok(/^[\x00-\x7f]*$/.test(editor), `${name}: the BRF must be plain ASCII`);
    }
  });
}

test('positions still point at the original text after characters are removed', () => {
  const text = 'ab­cd​ef';                 // soft hyphen at 2, zero-width space at 5
  const res = styledTranslatePos(rawPos)(text);
  const kept = [...text].map((c, i) => i).filter((i) => i !== 2 && i !== 5);
  const seen = new Set(res.inputPos.filter((p) => typeof p === 'number' && p >= 0));
  assert.ok(![...seen].some((p) => p === 2 || p === 5), 'no cell points at a removed character');
  assert.ok([...seen].every((p) => kept.includes(p)), `every position is a kept index: ${[...seen]}`);
  assert.ok(seen.has(0) && seen.has(7), 'the first and last kept characters are both reached');
});
