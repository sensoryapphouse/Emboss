// .docx parity with .doc (25 Sep 2026 "leftovers" — EMBOSS-TASKS.md): five gaps the .doc
// reader's own parity checks found in parseDocx (input/parse.mjs) relative to parseDoc
// (input/doc.mjs), which already got these right:
//   1. w:isLgl forces EVERY %n placeholder in the DISPLAYED level's own marker to plain
//      Arabic numerals, not just the placeholder for the level that happens to carry isLgl
//      itself (listMarker previously applied each referenced level's own isLgl).
//   2. a paragraph with no direct w:numPr, styled with a paragraph style that itself carries
//      a default w:pPr/w:numPr (Word's "List Bullet"/"List Number", incl. a basedOn chain),
//      is a list item — same as .doc's STD-level ilfo/ilvl. A direct w:numId="0" on the
//      paragraph still cancels it. Numbered HEADINGS via style numPr are unaffected (already
//      worked, and must not become list items).
//   3. hidden text (w:vanish/w:specVanish) and superscript/subscript (w:vertAlign), and
//      caps/smallCaps/strike, set by a CHARACTER style, a PARAGRAPH style (either's own rPr,
//      walking basedOn), or styles.xml's own docDefaults/rPrDefault — not only direct rPr.
//   4. a paragraph mark tracked as deleted (w:pPr/w:rPr/w:del) or moved-from
//      (w:pPr/w:rPr/w:moveFrom, OOXML-only — .doc has no move-tracking concept) joins that
//      paragraph onto the one after it, as Word shows once changes are accepted — matching
//      .doc's own markDeleted/paragraphsIn behaviour exactly.
//   5. MSGraph.Chart*/Excel.Chart* embedded objects get the friendly name "chart" in the
//      "embedded object not transcribed (…)" placeholder, same table used by doc.mjs.
//
// Each test below either checks parseDoc(.doc) and parseDocx(.docx) build the SAME model from
// the same content (writeDoc/writeDocx, tests/helpers/doc-writer.mjs — same twin-fixture
// convention as doc_reader.test.mjs), or, for the one OOXML-only case (a moved-from paragraph
// mark — .doc has no move tracking at all), checks parseDocx alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDoc } from '../input/doc.mjs';
import { parseDocx } from '../input/parse.mjs';
import { writeDoc, writeDocx } from './helpers/doc-writer.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';

const { supOpen, end } = SCRIPT_MARKS;

// Model -> comparable JSON, same normalisation doc_reader.test.mjs uses (note ids lose their
// reader-specific prefix; byte arrays compare by content).
const norm = (m) => JSON.parse(JSON.stringify(m, (k, v) => (v instanceof Uint8Array ? Array.from(v) : typeof v === 'string' ? v.replace(/^docx?-(fn|en)-/, 'X-$1-') : v)));
const parity = async (spec) => ({ doc: await parseDoc(writeDoc(spec)), docx: await parseDocx(await writeDocx(spec)) });

// ---------------------------------------------------------------------------------------
// Item 1: w:isLgl / LVLF.fLegal — every numeral in the DISPLAYED level's marker is Arabic.
// ---------------------------------------------------------------------------------------
test('item 1 parity: legal numbering forces every numeral in the displayed level to Arabic, in both .doc and .docx', async () => {
  // Level 0 (upperRoman, no isLgl) keeps its own Roman numeral; level 1 has isLgl and its
  // lvlText "%1.%2" pulls in level 0's OWN counter too — Word shows "1.1", not "I.1", because
  // the level being DISPLAYED (level 1) has isLgl, not because level 0 does.
  const spec = {
    lists: { 1: [{ fmt: 'upperRoman', text: '%1.' }, { fmt: 'lowerLetter', text: '%1.%2', legal: true }] },
    body: [{ p: 'Roman', list: { id: 1, level: 0 } }, { p: 'Legal sub', list: { id: 1, level: 1 } }, { p: 'Roman two', list: { id: 1, level: 0 } }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const markers = docx.blocks.find((b) => b.type === 'list').items.map((i) => i.marker);
  assert.deepEqual(markers, ['I.', '1.1', 'II.'], JSON.stringify(markers));
});

// ---------------------------------------------------------------------------------------
// Item 2: numbering inherited from a paragraph style (no direct w:numPr) is a list item.
// ---------------------------------------------------------------------------------------
test('item 2 parity: a paragraph styled "List Bullet" with no numPr of its own is a list item, in both .doc and .docx', async () => {
  const spec = {
    styles: [{ name: 'List Bullet', type: 'para', basedOn: 'Normal', list: { id: 9, level: 0 } }],
    lists: { 9: [{ fmt: 'bullet', text: '' }] },
    body: [
      { p: 'Not a list.' },
      { p: 'Bulleted by style one', style: 'List Bullet' },
      { p: 'Bulleted by style two', style: 'List Bullet' },
      { p: 'Not a list either.' },
    ],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const lists = docx.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 1, JSON.stringify(docx.blocks));
  assert.deepEqual(lists[0].items.map((i) => [i.text, i.marker]), [['Bulleted by style one', '•'], ['Bulleted by style two', '•']]);
  // surrounding plain paragraphs stay plain, not folded into the list
  assert.deepEqual(docx.blocks.filter((b) => b.type === 'para').map((b) => b.text), ['Not a list.', 'Not a list either.']);
});

test('item 2 parity: a nested list style (basedOn chain), in both .doc and .docx', async () => {
  const spec = {
    styles: [
      { name: 'List Number', type: 'para', basedOn: 'Normal', list: { id: 9, level: 0 } },
      { name: 'List Number 2', type: 'para', basedOn: 'List Number' },   // inherits the style's numPr up the basedOn chain
    ],
    lists: { 9: [{ fmt: 'decimal', text: '%1.' }] },
    body: [{ p: 'One', style: 'List Number' }, { p: 'Two (via basedOn chain)', style: 'List Number 2' }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const lists = docx.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 1, JSON.stringify(docx.blocks));
  assert.deepEqual(lists[0].items.map((i) => [i.text, i.marker]), [['One', '1.'], ['Two (via basedOn chain)', '2.']]);
});

test('item 2 parity: a direct numId="0" cancels a style\'s own numbering (Word\'s "List Paragraph" style, no bullet/number left), in both .doc and .docx', async () => {
  // Deliberately NOT right after another numbered item: whether an unmarked list-styled
  // paragraph right after a numbered one is folded into that item's own further paragraph
  // (item.blocks) is a separate, pre-existing feature the .doc reader does not implement at
  // all (doc.mjs has no docxContinuesItem/docxAddItemPara equivalent) — outside this task's
  // five items, and not what this test is checking. Preceded by a plain paragraph instead,
  // so both readers agree: no list is open yet, so cancelling the style's numbering here
  // can only ever produce a fresh, unmarked list item, not a continuation of anything.
  const spec = {
    body: [
      { p: 'Not a list.' },
      // "List Paragraph" is Word's own built-in style (EXTRA_BUILTIN in doc-writer.mjs) — no
      // numPr of its own — with a DIRECT numId="0" override, same as Word writes when a user
      // manually removes the numbering from one list-styled paragraph.
      { p: 'Cancelled', style: 'List Paragraph', list: { id: 0, level: 0 } },
    ],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const lists = docx.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 1, JSON.stringify(docx.blocks));
  assert.deepEqual(lists[0].items.map((i) => [i.text, i.marker]), [['Cancelled', undefined]]);
});

test('item 2: a numbered HEADING via style numPr is still a heading, never a list item (regression guard)', async () => {
  const spec = {
    styles: [{ name: 'Heading 1', type: 'para', sti: 1, basedOn: 'Normal', list: { id: 9, level: 0 } }],
    lists: { 9: [{ fmt: 'decimal', text: '%1' }] },
    body: [{ p: 'Introduction', style: 'heading 1' }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.equal(docx.blocks.filter((b) => b.type === 'list').length, 0, JSON.stringify(docx.blocks));
  assert.deepEqual(docx.blocks[0], { type: 'heading', level: 1, text: '1 Introduction' });
});

// ---------------------------------------------------------------------------------------
// Item 3: hidden text, sub/superscript, caps/smallCaps/strike set by a style, not just
// direct run formatting.
// ---------------------------------------------------------------------------------------
test('item 3 parity: w:vanish set by a PARAGRAPH style hides its runs; a direct override still un-hides one, in both .doc and .docx', async () => {
  const spec = {
    styles: [{ name: 'Hidden Note', type: 'para', basedOn: 'Normal', vanish: true }],
    body: [{ p: [{ text: 'Hidden ' }, { text: 'Visible', vanish: false }], style: 'Hidden Note' }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(docx.blocks.map((b) => b.text), ['Visible']);
});

test('item 3 parity: w:vanish set by a CHARACTER style hides just that run, in both .doc and .docx', async () => {
  const spec = {
    styles: [{ name: 'Secret', type: 'char', vanish: true }],
    body: [{ p: [{ text: 'Before ' }, { text: 'secret', style: 'Secret' }, { text: ' after' }] }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(docx.blocks.map((b) => b.text), ['Before after']);
});

test('item 3 parity: w:vertAlign (superscript) set by a PARAGRAPH style, not just a direct run, in both .doc and .docx', async () => {
  // superscript comes from the paragraph style; the run itself carries no direct vertAlign at
  // all, so both readers must resolve it purely from the style to superscript the whole line.
  const spec = {
    styles: [{ name: 'Ref Mark', type: 'para', basedOn: 'Normal', superscript: true }],
    body: [{ p: 'raised', style: 'Ref Mark' }, { p: 'baseline' }],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(docx.blocks.map((b) => b.text), [`${supOpen}raised${end}`, 'baseline']);
});

test('item 3 parity: caps/smallCaps/strike set by a PARAGRAPH style upper-case/strike the run text, in both .doc and .docx', async () => {
  const spec = {
    styles: [
      { name: 'Shout', type: 'para', basedOn: 'Normal', caps: true },
      { name: 'Whisper', type: 'para', basedOn: 'Normal', smallCaps: true },
      { name: 'Crossed', type: 'para', basedOn: 'Normal', strike: true },
    ],
    body: [
      { p: 'loud text', style: 'Shout' },
      { p: 'quiet text', style: 'Whisper' },
      { p: 'gone text', style: 'Crossed' },
    ],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(docx.blocks.slice(0, 2).map((b) => b.text), ['LOUD TEXT', 'QUIET TEXT']);
  assert.deepEqual(docx.blocks[2].segments, [{ type: 'text', text: 'gone text', transcriberTypeform: 'strike' }]);
});

test('item 3: styles.xml docDefaults/rPrDefault is the last fallback when neither the run nor any style sets vanish (docx-only: .doc has no separate docDefaults part)', async () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const { makeZip } = await import('../web/zip.mjs');
  const docXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hidden by default</w:t></w:r></w:p></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  const buf = await makeZip([{ name: 'word/document.xml', text: docXml }, { name: 'word/styles.xml', text: stylesXml }]).arrayBuffer();
  const doc = await parseDocx(buf);
  assert.equal(doc.blocks.length, 0, JSON.stringify(doc.blocks));
});

// ---------------------------------------------------------------------------------------
// Item 4: a deleted (or, docx-only, moved-from) paragraph mark joins with the next paragraph.
// ---------------------------------------------------------------------------------------
test('item 4 parity: a deleted paragraph mark joins its paragraph with the next one, in both .doc and .docx', async () => {
  const spec = {
    body: [
      { p: 'Heading text', style: 'heading 2', delMark: true },
      { p: ' continues as plain text.' },
      { p: 'Joined by a deleted ', delMark: true },
      { p: 'paragraph mark.' },
      { p: 'After.' },
    ],
  };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  // the SURVIVING paragraph's own formatting wins: the heading style was on the deleted-mark
  // paragraph, so the merged paragraph is a plain paragraph, not a heading
  assert.deepEqual(docx.blocks.map((b) => b.type + ':' + b.text), [
    'para:Heading text continues as plain text.',
    'para:Joined by a deleted paragraph mark.',
    'para:After.',
  ]);
});

test('item 4 parity: several consecutive deleted paragraph marks all join into the one paragraph that keeps its own mark, in both .doc and .docx', async () => {
  const spec = { body: [{ p: 'One ', delMark: true }, { p: 'two ', delMark: true }, { p: 'three.' }] };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  assert.deepEqual(docx.blocks, [{ type: 'para', text: 'One two three.' }]);
});

test('item 4: a moved-from paragraph mark joins its paragraph with the next one (docx-only — .doc has no move tracking)', async () => {
  const spec = { body: [{ p: 'Moved away ', moveFromMark: true }, { p: 'lands here.' }] };
  const docx = await parseDocx(await writeDocx(spec));
  assert.deepEqual(docx.blocks, [{ type: 'para', text: 'Moved away lands here.' }]);
});

// ---------------------------------------------------------------------------------------
// Item 5: MSGraph.Chart*/Excel.Chart* -> "chart" friendly name.
// ---------------------------------------------------------------------------------------
test('item 5 parity: MSGraph.Chart and Excel.Chart embedded objects read as "chart", in both .doc and .docx', async () => {
  const spec = { body: [{ p: ['Old chart: ', { ole: 'MSGraph.Chart.8' }] }, { p: ['New chart: ', { ole: 'Excel.Chart.8' }] }] };
  const { doc, docx } = await parity(spec);
  assert.deepEqual(norm(doc), norm(docx));
  const notes = docx.blocks.flatMap((b) => b.segments || []).filter((s) => s.type === 'imgnote');
  assert.deepEqual(notes.map((n) => n.text), ['embedded object not transcribed (chart)', 'embedded object not transcribed (chart)']);
});
