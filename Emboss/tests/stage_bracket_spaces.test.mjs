// A89 (random-action testing, seed 1982326777, Firefox): a stage direction ending in a space ("2" then " ") was brailled in UKAAF's
// added square brackets as "[2 ]"; a save trims the space, so the reopened document had "[2]". The brackets now go round the
// direction's words without the spaces at its edges, before a save as after.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate } from '../format/text-style.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const translate = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null), 'faithful');
const doc = (stage) => ({ title: null, blocks: [{ type: 'para', text: 'Before.' }, stage, { type: 'para', text: 'After.' }] });
const fmt = (stage) => formatDocument(doc(stage), { mode: 'ukaaf', width: 38, depth: 25, translate, suppressHeader: true });
test('ukaaf: spaces at the edges of a stage direction stay outside its brackets', () => {
  const plain = fmt({ type: 'stage', text: 'Enter two' });
  assert.equal(fmt({ type: 'stage', segments: [{ type: 'text', text: 'Enter two', href: '#n2' }, { type: 'text', text: ' ' }] }), plain);
  assert.equal(fmt({ type: 'stage', segments: [{ type: 'text', text: ' ' }, { type: 'text', text: 'Enter two ' }] }), plain);
});

// A89 (random-action testing, seed 1081764635, Chrome): Shift+Enter three times at the start of a heading left three line breaks
// before its text; in UKAAF the heading was then indented. A save drops line breaks at a heading's edges, so the reopened heading
// was not. Line breaks and spaces at the very start or end of a heading are now ignored in both modes.
for (const mode of ['ukaaf', 'bana']) {
  test(`${mode}: line breaks at the edges of a heading do not change its braille`, () => {
    const f = (h) => formatDocument({ title: null, blocks: [{ type: 'para', text: 'Before.' }, h, { type: 'para', text: 'After.' }] }, { mode, width: 38, depth: 25, translate, suppressHeader: true });
    for (const level of [1, 2, 3, 4]) {
      const plain = f({ type: 'heading', level, text: 'Three-level bullets' });
      assert.equal(f({ type: 'heading', level, text: 'Three-level bullets', segments: [{ type: 'text', text: '\n' }, { type: 'text', text: '\n' }, { type: 'text', text: '\nThree-level bullets' }] }), plain, `level ${level}`);
      assert.equal(f({ type: 'heading', level, text: 'Three-level bullets', segments: [{ type: 'text', text: 'Three-level bullets\n ' }] }), plain, `level ${level}, trailing`);
    }
  });
}

// A89 (the nightly random-action run, seed 1763563818, Chrome): a spatial table cell starting with spaces ("  BrailleRow 1, Col 3")
// made its column wider; the reader squeezes the spaces, so the reopened table was narrower. Spaces at a cell's edges (and runs
// of them inside it) do not count in any table format now, as the listed and linear formats already did not.
for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: spaces at the edges of a spatial table cell do not widen its column`, () => {
    const f = (c) => formatDocument({ title: null, blocks: [{ type: 'table', format: 'spatial', headers: ['Header 1', 'Header 2', 'Header 3'], rows: [['Row 1, Col 1', 'Row 1, Col 2', c], ['Row 2, Col 1', 'Row 2, Col 2', 'Row 2, Col 3']] }] }, { mode, width: 38, depth: 25, translate, suppressHeader: true });
    assert.equal(f('  BrailleRow 1, Col 3'), f('BrailleRow 1, Col 3'));
    assert.equal(f(' BrailleRow 1, Col 3  '), f('BrailleRow 1, Col 3'));
  });
}
