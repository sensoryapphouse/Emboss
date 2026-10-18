// A89 (random-action testing, seed 1982326777, WebKit): a contents entry the editor gives with formatted runs and no plain text
// ({ segments: [ "STEM Module Project ", bold "Design an Animal's Adaptations" ] }) found no heading to take its braille page
// number from — the entry is matched to its heading by its words, and only `text` was read — so the number appeared only after
// a save and reopen (the reader gives both). The entry's words are now read from its runs when it has no text.
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
const body = Array.from({ length: 30 }, (_, i) => ({ type: 'para', text: `Paragraph ${i + 1} of the chapter, long enough to fill a line or two of braille.` }));
const doc = (entry) => ({ title: null, blocks: [
  { type: 'list', kind: 'toc', style: 'toc', items: [entry, { text: 'Module Wrap-Up', page: '47', level: 1 }] },
  ...body, { type: 'heading', level: 2, text: "STEM Module Project Design an Animal's Adaptations" }, ...body, { type: 'heading', level: 2, text: 'Module Wrap-Up' }, ...body,
] });
const segs = [{ type: 'text', text: 'STEM Module Project ' }, { type: 'text', text: "Design an Animal's Adaptations", tf: 4 }];
for (const mode of ['ukaaf', 'bana']) {
  test(`${mode}: a contents entry given only as formatted runs gets the same braille page number as one with its text`, () => {
    const fmt = (entry) => formatDocument(doc(entry), { mode, width: 40, depth: 25, translate });
    const withText = fmt({ text: "STEM Module Project Design an Animal's Adaptations", segments: segs, page: '45', level: 1 });
    const runsOnly = fmt({ segments: segs, page: '45', level: 1 });
    assert.equal(runsOnly, withText);
  });
}
