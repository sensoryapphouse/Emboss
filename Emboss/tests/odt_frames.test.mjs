// G4/D8: pictures and captions inside <draw:text-box> (captioned figures) and nested frames
// in ODT. Synthetic package built with the repo's own zip helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseOdt } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
const img = (n, extra = '') => `<draw:frame draw:name="Image${n}">${extra}<draw:image xlink:href="Pictures/p${n}.png" xlink:type="simple"/></draw:frame>`;
const build = async (bodyXml) => {
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;
  return makeZip([
    { name: 'content.xml', data: new TextEncoder().encode(content) },
    { name: 'Pictures/p1.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'Pictures/p2.png', data: new Uint8Array([4, 5, 6]) },
    { name: 'Pictures/p3.png', data: new Uint8Array([7, 8, 9]) },
  ]).arrayBuffer();
};
const graphics = (m) => m.blocks.filter((b) => b.type === 'graphic');

test('captioned figure: frame > text-box > p > frame + caption text', async () => {
  const body = `<text:p>Before</text:p>
<text:p><draw:frame draw:name="Frame1"><draw:text-box><text:p text:style-name="Figure"><draw:frame draw:name="Image1"><svg:title>A cat</svg:title><draw:image xlink:href="Pictures/p1.png"/></draw:frame>Figure <text:sequence>1</text:sequence>: The cat</text:p></draw:text-box></draw:frame>See the figure.</text:p>
<text:p>After</text:p>`;
  const m = await parseOdt(await build(body));
  const g = graphics(m);
  assert.equal(g.length, 1);
  assert.equal(g[0].src, 'Pictures/p1.png');
  assert.equal(g[0].alt, 'A cat');
  assert.match(g[0].caption, /^Figure 1: The cat$/);
  const texts = m.blocks.map((b) => b.type === 'graphic' ? '[img]' : b.text);
  assert.deepEqual(texts, ['Before', '[img]', 'See the figure.', 'After']);
});

test('several figures in order, deeper nesting, draw:a wrapper, no duplicates', async () => {
  const fig = (n, cap) => `<draw:frame><draw:text-box><text:p>${img(n)}${cap}</text:p></draw:text-box></draw:frame>`;
  const body = `<text:p>${fig(1, 'Fig one')}</text:p>
<text:p><draw:a xlink:href="http://x.org">${fig(2, 'Fig two')}</draw:a></text:p>
<text:p><draw:frame><draw:text-box><text:p><draw:frame><draw:text-box><text:p>${img(3)}Deep caption</text:p></draw:text-box></draw:frame></text:p></draw:text-box></draw:frame></text:p>`;
  const m = await parseOdt(await build(body));
  const g = graphics(m);
  assert.deepEqual(g.map((x) => x.src), ['Pictures/p1.png', 'Pictures/p2.png', 'Pictures/p3.png']);
  assert.deepEqual(g.map((x) => x.caption), ['Fig one', 'Fig two', 'Deep caption']);
  assert.equal(m.resources.length, 3);
});

test('an ordinary frame still yields one graphic and a text-only box adds none', async () => {
  const body = `<text:p>${img(1)}</text:p><text:p><draw:frame><draw:text-box><text:p>Just words</text:p></draw:text-box></draw:frame></text:p>`;
  const m = await parseOdt(await build(body));
  assert.equal(graphics(m).length, 1);
});

// ---- text-only text boxes (G4/D9) and the remaining lost pictures ----
const box = (inner, name = '') => `<draw:frame${name ? ` draw:name="${name}"` : ''}><draw:text-box>${inner}</draw:text-box></draw:frame>`;
const shape = (m) => m.blocks.map((b) => b.type === 'graphic' ? '[img]' : b.type === 'list' ? 'list:' + b.items.map((i) => i.text).join('|') : b.type + ':' + (b.text ?? JSON.stringify(b.rows)));

test('a text-only box is emitted as paragraphs in document order, keeping emphasis and links', async () => {
  const styles = `<office:automatic-styles><style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}>${styles}<office:body><office:text>
<text:p>Before</text:p>
<text:p>${box('<text:p>Side note <text:span text:style-name="B">bold</text:span> and <text:a xlink:href="http://x.org">link</text:a>.</text:p><text:p>Second para</text:p>', 'SideNote')}Anchor text</text:p>
<text:p>After</text:p></office:text></office:body></office:document-content>`;
  const m = await parseOdt(await makeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }]).arrayBuffer());
  assert.deepEqual(shape(m), ['para:Before', 'para:Side note bold and link.', 'para:Second para', 'para:Anchor text', 'para:After']);
  const p = m.blocks[1];
  assert.ok(p.segments.some((s) => s.tf && s.text === 'bold'));
  assert.ok(p.segments.some((s) => s.href === 'http://x.org'));
});

test('a text box holding a heading and a list keeps them as such', async () => {
  const body = `<text:p>${box('<text:h text:outline-level="2">Sidebar</text:h><text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>')}</text:p>`;
  const m = await parseOdt(await build(body));
  assert.deepEqual(shape(m), ['heading:Sidebar', 'list:one|two']);
});

test('the same box anchored twice is emitted once', async () => {
  const b = box('<text:p>Repeated words</text:p>', 'Box7');
  const m = await parseOdt(await build(`<text:p>A${b}</text:p><text:p>B${b}</text:p>`));
  assert.equal(m.blocks.filter((x) => x.text === 'Repeated words').length, 1);
  assert.deepEqual(m.blocks.map((x) => x.text), ['Repeated words', 'A', 'B']);
});

test('deeply nested boxes stop at the depth guard without hanging', async () => {
  let inner = '<text:p>core</text:p>';
  for (let i = 0; i < 20; i++) inner = `<text:p>lvl${i}${box(inner, 'L' + i)}</text:p>`;
  const m = await parseOdt(await build(inner));
  assert.ok(m.blocks.length >= 8 && m.blocks.length < 21);   // bounded, outer levels kept
});

test('a text box inside a table cell follows the table', async () => {
  const tbl = `<table:table xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><table:table-row><table:table-cell><text:p>cell${box('<text:p>Boxed in cell</text:p>')}</text:p></table:table-cell></table:table-row></table:table>`;
  const m = await parseOdt(await build(tbl));
  assert.equal(m.blocks[0].type, 'table');
  assert.equal(m.blocks[0].rows[0][0], 'cell');
  assert.deepEqual(m.blocks.slice(1).map((b) => b.text), ['Boxed in cell']);
});

test('an object replacement image (draw:object + draw:image) is a graphic with its alt text', async () => {
  const obj = `<draw:frame draw:name="Object1"><draw:object xlink:href="./Object 1"/><draw:image xlink:href="./ObjectReplacements/Object 1" xlink:type="simple"/><svg:desc>Formula alt</svg:desc></draw:frame>`;
  const m = await parseOdt(await build(`<text:p>${obj}</text:p>`));
  const g = graphics(m);
  assert.equal(g.length, 1);
  assert.equal(g[0].description, 'Formula alt');
  // CHANGED 30 Sep 2026 (import fix list #35, audit #21): the frame's name ("Object1") is a label for the shape, not alt text.
  // Was: alt === 'Object1'. The description (svg:desc) is what the picture says.
  assert.equal(g[0].alt, '');
});

test('pictures in list items, headings and body-level frames are no longer lost', async () => {
  const body = `<text:list><text:list-item><text:p>item ${img(1)}</text:p></text:list-item></text:list>
<text:h text:outline-level="1">Head ${img(2)}</text:h>
${img(3)}`;
  const m = await parseOdt(await build(body));
  assert.deepEqual(graphics(m).map((g) => g.src).sort(), ['Pictures/p1.png', 'Pictures/p2.png', 'Pictures/p3.png']);
  assert.deepEqual(m.blocks.filter((b) => b.type !== 'graphic').map((b) => b.type), ['list', 'heading']);
});

test('a picture frame directly inside a text box (no paragraph) is kept', async () => {
  const m = await parseOdt(await build(`<text:p>${box(img(1))}</text:p>`));
  assert.equal(graphics(m).length, 1);
});

// ---- tables inside text boxes ----
const TBL = 'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
const cell = (t) => `<table:table-cell><text:p>${t}</text:p></table:table-cell>`;
const boxTable = `<table:table ${TBL}><table:table-header-rows><table:table-row>${cell('Name')}${cell('Qty')}</table:table-row></table:table-header-rows><table:table-row>${cell('Apple')}${cell('3')}</table:table-row><table:table-row>${cell('Pear')}${cell('5')}</table:table-row></table:table>`;

test('a table inside a text box becomes a table block in document order', async () => {
  const body = `<text:p>Before</text:p><text:p>${box(`<text:p>Above</text:p>${boxTable}<text:p>Below</text:p>`, 'TblBox')}</text:p><text:p>After</text:p>`;
  const m = await parseOdt(await build(body));
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'para', 'table', 'para', 'para']);
  const t = m.blocks[2];
  assert.deepEqual(t.headers, ['Name', 'Qty']);
  assert.deepEqual(t.rows, [['Apple', '3'], ['Pear', '5']]);
});

test('a table in a box anchored twice is emitted once', async () => {
  const b = box(boxTable, 'TblBox2');
  const m = await parseOdt(await build(`<text:p>A${b}</text:p><text:p>B${b}</text:p>`));
  assert.equal(m.blocks.filter((x) => x.type === 'table').length, 1);
});

test('a table inside nested boxes is found once and deep nesting stays bounded', async () => {
  const m = await parseOdt(await build(`<text:p>${box(`<text:p>${box(boxTable, 'Inner')}</text:p>`, 'Outer')}</text:p>`));
  assert.equal(m.blocks.filter((x) => x.type === 'table').length, 1);
});

test('master-page headers and footers in styles.xml are not imported as body text', async () => {
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text><text:p>Body only</text:p></office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:master-styles><style:master-page style:name="Standard"><style:header><text:p>Running title <text:page-number/></text:p></style:header><style:footer><text:p>Footer words</text:p></style:footer></style:master-page></office:master-styles></office:document-styles>`;
  const m = await parseOdt(await makeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }, { name: 'styles.xml', data: new TextEncoder().encode(styles) }]).arrayBuffer());
  assert.deepEqual(m.blocks.map((b) => b.text), ['Body only']);
});
