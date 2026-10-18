// IMP-W12 (Paul, 30 Sep 2026, Emboss/docs/decisions.md "Word import"): "A picture with no description raises
// a transcription warning asking for one." The formatter already leaves an undescribed, uncaptioned picture out
// of the braille (BANA 6.4.1); it now also says so through the existing transcription-warnings channel
// (opts.warnings, tests/transcription_warnings.test.mjs), once per picture, naming its block. A picture the
// author marked decorative (Word's "Mark as decorative", carried on the graphic block as `decorative: true`)
// is not reported. The braille itself never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { formatDocument, formatDocumentAsync } = await import(process.env.DOCUMENT_MJS || '../format/document.mjs');
const { parseDocx } = await import('../input/parse.mjs');
const { makeZip } = await import('../web/zip.mjs');

const up = (s) => String(s || '').toUpperCase();
const opts = (extra) => ({ mode: 'bana', width: 30, depth: 25, translate: up, ...extra });
const KIND = 'picture-no-description';
const pics = (o) => (o.warnings || []).filter((w) => w.kind === KIND);

test('IMP-W12: an undescribed, uncaptioned picture raises one warning naming its block; the braille is unchanged', () => {
  const withPic = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'graphic', src: 'a.png', alt: '' }, { type: 'para', text: 'after' }] };
  const without = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'para', text: 'after' }] };
  const o1 = opts(), o2 = opts();
  const brf = formatDocument(withPic, o1);
  assert.equal(brf, formatDocument(without, o2), 'the warning never changes the braille');
  const w = pics(o1);
  assert.equal(w.length, 1, JSON.stringify(o1.warnings));
  assert.equal(w[0].blockIndex, 1);
  assert.equal(w[0].blockType, 'graphic');
  assert.match(w[0].message, /^A picture has no description\. Add one so the braille can describe it\.$/);
  assert.equal(pics(o2).length, 0);
});

test('IMP-W12: UKAAF warns the same way', () => {
  const o = opts({ mode: 'ukaaf', standard: 'ukaaf' });
  formatDocument({ title: 'T', blocks: [{ type: 'para', text: 'x' }, { type: 'graphic', src: 'a.png' }] }, o);
  assert.equal(pics(o).length, 1);
  assert.equal(pics(o)[0].blockIndex, 1);
});

test('IMP-W12: one warning per picture, each in its own block', () => {
  const o = opts();
  formatDocument({ title: 'T', blocks: [
    { type: 'graphic', src: 'a.png', alt: '' }, { type: 'para', text: 'mid' }, { type: 'graphic', src: 'b.png', alt: '  ' },
  ] }, o);
  assert.deepEqual(pics(o).map((w) => w.blockIndex), [0, 2]);
});

test('IMP-W12: no warning when the picture has alt text, a caption, a description or a citation, or is marked decorative', () => {
  const o = opts();
  formatDocument({ title: 'T', blocks: [
    { type: 'para', text: 'x' },
    { type: 'graphic', src: 'a.png', alt: 'A red triangle' },
    { type: 'graphic', src: 'b.png', alt: '', caption: 'Figure 1' },
    { type: 'graphic', src: 'c.png', alt: '', description: 'A production note' },
    { type: 'graphic', src: 'd.png', alt: '', citation: 'Photo: A. Person' },
    { type: 'graphic', src: 'e.png', alt: '', decorative: true },
  ] }, o);
  assert.equal(pics(o).length, 0, JSON.stringify(o.warnings));
});

test('IMP-W12: the editor path (formatDocumentAsync with translatePos, which lays a block out twice) still gives one warning per picture', async () => {
  const translatePos = (t) => { const b = up(t); return { braille: b, inputPos: Array.from(b, (_, i) => i) }; };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'graphic', src: 'a.png', alt: '' }, { type: 'graphic', src: 'b.png', alt: '' }] };
  const o = opts({ translatePos });
  await formatDocumentAsync(doc, o);
  assert.deepEqual(pics(o).map((w) => w.blockIndex), [1, 2], JSON.stringify(o.warnings));
  const o2 = opts({ translatePos, blockCache: new Map() });
  await formatDocumentAsync(doc, o2);
  await formatDocumentAsync(doc, o2);   // second pass: served from the block cache, must still carry the warnings
  assert.deepEqual(pics(o2).map((w) => w.blockIndex), [1, 2], JSON.stringify(o2.warnings));
});

// ---- Word: how the reader tells "no description" from "marked decorative" ----
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const drawing = (docPrInner, docPrAttrs) => `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1" cy="1"/><wp:docPr id="1" ${docPrAttrs}>${docPrInner}</wp:docPr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
const DECORATIVE = '<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';
async function readPics(paras) {
  const body = paras.map((x) => `<w:p><w:r>${x}</w:r></w:p>`).join('');
  const files = [
    { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>` },
    { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>' },
    { name: 'word/media/image1.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]) },
  ];
  return parseDocx(await makeZip(files).arrayBuffer());
}

test('IMP-W12 (Word): descr="" with a default name is undescribed (warns); "Mark as decorative" is not', async () => {
  const model = await readPics([
    drawing('', 'name="Picture 1" descr=""'),
    drawing(DECORATIVE, 'name="Picture 2" descr=""'),
    drawing('', 'name="Picture 3" descr="A red triangle"'),
  ]);
  const g = model.blocks.filter((b) => b.type === 'graphic');
  assert.equal(g.length, 3, JSON.stringify(model.blocks));
  assert.ok(!g[0].decorative && !g[0].alt, 'an empty descr with a default name: undescribed');
  assert.equal(g[1].decorative, true, 'the author marked it decorative');
  assert.ok(!g[1].alt);
  assert.equal(g[2].alt, 'A red triangle');
  const o = opts();
  formatDocument(model, o);
  assert.deepEqual(pics(o).map((w) => w.blockIndex), [model.blocks.indexOf(g[0])], JSON.stringify(o.warnings));
});
