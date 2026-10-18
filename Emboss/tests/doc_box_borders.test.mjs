// K36d (EMBOSS-TASKS.md row K36, second half): ".doc bordered paragraph runs and bordered
// one-cell tables aren't boxed (docx are)". K7/BANA §7 box/sidebar detection already exists
// for DOCX (parse.mjs's docxParaBorderInfo/docxTcBoxInfo — see the file comment above
// docxParaBorderInfo for the three ways Word fakes a sidebar with no native box element) and
// for a .doc floating text box (doc.mjs's own anchoredContent, using doc-art.mjs's
// shape.hasFill/hasLine). This adds the other two .doc cases: a paragraph "box" border
// (sprmPBrcTop/Left/Bottom/Right, doc-props.mjs's readBrc) and a bordered one-cell table
// (the same border bytes, read from the TC array sprmTDefTable already carries).
//
// doc-writer.mjs (tests/helpers) is extended alongside this: `blk.border` (a paragraph) and a
// table cell's `border` (an object with `.blocks`) now write real sprmPBrcTop/Left/Bottom/
// Right / TC border bytes, from the spec, the same way every other doc-writer.mjs feature is
// built (see that file's own header comment — no Word/LibreOffice is available to the test
// suite). doc-props.mjs's own byte-level reading is checked directly too (applyPapSprm/
// brcVisible), the "test at the level of the parsed paragraph properties" fallback the brief
// allows, alongside the full writeDoc()/parseDoc() round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDoc } from '../input/doc.mjs';
import { newPap, applyPapSprm, brcVisible } from '../input/doc-props.mjs';
import { writeDoc } from './helpers/doc-writer.mjs';

const shape = (m) => m.blocks.map((b) => (b.type === 'box' ? 'box:' + (b.title || '') + ':' + b.blocks.map((x) => x.text).join('|') : b.type + ':' + (b.text ?? '')));

// ---------------------------------------------------------------------------------------------
// doc-props.mjs: the raw BRC bytes (sprmPBrcTop/Left/Bottom/Right operand)
// ---------------------------------------------------------------------------------------
const brc = (w, type, ico = 0, flags = 0) => Uint8Array.from([w, type, ico, flags]);

test('doc-props: sprmPBrcTop/Left/Bottom/Right fill pap.brcTop/Left/Bottom/Right (readBrc)', () => {
  const pap = newPap();
  assert.equal(pap.brcTop, null, 'no border by default');
  applyPapSprm(pap, 0x6424, brc(4, 1, 6), 0, 4);   // sprmPBrcTop
  applyPapSprm(pap, 0x6427, brc(8, 2, 0), 0, 4);   // sprmPBrcRight
  assert.deepEqual(pap.brcTop, { w: 4, type: 1, ico: 6 });
  assert.deepEqual(pap.brcRight, { w: 8, type: 2, ico: 0 });
  assert.equal(pap.brcLeft, null);
});

test('doc-props: brcVisible is false for width 0, type 0 ("none") or no border at all', () => {
  assert.equal(brcVisible(null), false);
  assert.equal(brcVisible({ w: 0, type: 1, ico: 1 }), false, 'zero width: no line');
  assert.equal(brcVisible({ w: 4, type: 0, ico: 1 }), false, 'brcType 0: none');
  assert.equal(brcVisible({ w: 4, type: 1, ico: 0 }), true, 'ico 0 (auto colour) is still a visible line');
});

// ---------------------------------------------------------------------------------------------
// doc.mjs: a bordered paragraph run
// ---------------------------------------------------------------------------------------
test('K36d: a single bordered paragraph becomes a box block', async () => {
  const body = [{ p: 'Before' }, { p: 'Solo boxed line.', border: true }, { p: 'After' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:Before', 'box::Solo boxed line.', 'para:After']);
  const box = m.blocks[1];
  assert.equal(box.render, 'required');
});

test('K36d: a run of consecutive bordered paragraphs (matching border) becomes ONE box, in order', async () => {
  const body = [{ p: 'Before' }, { p: 'One', border: true }, { p: 'Two', border: true }, { p: 'Three', border: true }, { p: 'After' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:Before', 'box::One|Two|Three', 'para:After']);
});

test('K36d: two separate bordered runs (a plain paragraph between them) become two boxes', async () => {
  const body = [{ p: 'A', border: true }, { p: 'middle' }, { p: 'B', border: true }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['box::A', 'para:middle', 'box::B']);
});

test('K36d: a plain document with no borders at all is unaffected (default output unchanged)', async () => {
  const body = [{ p: 'One' }, { p: 'Two' }, { p: 'Three' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:One', 'para:Two', 'para:Three']);
  assert.ok(!m.blocks.some((b) => b.type === 'box'));
});

// ---------------------------------------------------------------------------------------------
// doc.mjs: a bordered one-cell table
// ---------------------------------------------------------------------------------------
test('K36d: a bordered one-cell table with several paragraphs becomes a box', async () => {
  const body = [{ p: 'Before' }, { table: [[{ blocks: [{ p: 'Row one' }, { p: 'Row two' }], border: true }]] }, { p: 'After' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:Before', 'box::Row one|Row two', 'para:After']);
});

test('K36d: a bordered one-cell table with only ONE paragraph stays plain (parity with docxTcBoxInfo\'s "several paragraphs" rule)', async () => {
  const body = [{ p: 'Before' }, { table: [[{ blocks: [{ p: 'Solo row' }], border: true }]] }, { p: 'After' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:Before', 'para:Solo row', 'para:After']);
  assert.ok(!m.blocks.some((b) => b.type === 'box'));
});

test('K36d: an UNbordered one-cell table (default output unchanged) stays plain, flattened paragraphs', async () => {
  const body = [{ p: 'Before' }, { table: [[{ blocks: [{ p: 'Row one' }, { p: 'Row two' }] }]] }, { p: 'After' }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:Before', 'para:Row one', 'para:Row two', 'para:After']);
  assert.ok(!m.blocks.some((b) => b.type === 'box'));
});

test('K36d: a bordered single-COLUMN table of several ROWS (not a true 1x1 table) is never boxed', async () => {
  const body = [{ table: [[{ blocks: [{ p: 'R1' }], border: true }], [{ blocks: [{ p: 'R2' }], border: true }]] }];
  const m = await parseDoc(writeDoc({ body }));
  assert.deepEqual(shape(m), ['para:R1', 'para:R2']);
  assert.ok(!m.blocks.some((b) => b.type === 'box'));
});
