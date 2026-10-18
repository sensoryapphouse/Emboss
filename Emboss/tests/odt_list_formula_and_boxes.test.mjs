// K36 row (EMBOSS-TASKS.md, "Follow-ups from the 26 Sep wave"), items (c) and (d)'s ODT half:
//
//  (c) an ODT list item whose only content is a formula was dropped outright (parseOdtList's
//      `if (directText)` guard never ran, since a <draw:frame> contributes nothing to
//      getOdtText — same gap the paragraph/heading M1 fix already closed for a lone display
//      equation, just never mirrored into the list-item reader).
//  (d) an ODT text box (<draw:frame><draw:text-box>) had no box/sidebar detection at all —
//      every one, bordered/filled or not, was flattened into plain paragraphs in reading
//      order (G4/D9, odt_frames.test.mjs). K7/BANA §7 box detection already exists for DOCX
//      (docxParaBorderInfo/docxTcBoxInfo/docxTxbxBoxInfo) and HTML (htmlBoxSignal); this adds
//      the ODT text-box case, reading the frame's own <style:graphic-properties>
//      (draw:stroke/draw:fill/draw:fill-color) the same "explicit, positive signal only" way
//      docxTxbxBoxInfo reads a DOCX floating text box's <a:ln>/<a:solidFill>.
//
// Fixtures built with the repo's own zip helper (web/zip.mjs), the same pattern
// odt_frames.test.mjs and foreign_language.test.mjs use for a synthetic .odt package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseOdt } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
  + 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
  + 'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
  + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

const zip = (parts) => makeZip(parts.map((p) => ({ name: p.name, data: new TextEncoder().encode(p.text) }))).arrayBuffer();
const doc = (bodyXml, autoStyles = '') => zip([
  { name: 'content.xml', text: `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>${autoStyles}</office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>` },
]);

// ---------------------------------------------------------------------------------------------
// K36c: a list item whose only content is a formula
// ---------------------------------------------------------------------------------------
const MATHML = '<math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:mi>x</math:mi></math:math>';
// The same shape odt_frames.test.mjs's "object replacement image" test uses: a <draw:object>
// pointing at its own zip part (read as MathML by odtMathObjectToMathml), plus the
// ObjectReplacements bitmap <draw:image> a non-formula object would fall back to.
const formulaFrame = (name) => `<draw:frame draw:name="${name}"><draw:object xlink:href="./${name}"/><draw:image xlink:href="./ObjectReplacements/${name}" xlink:type="simple"/></draw:frame>`;
const docWithFormula = async (bodyXml) => zip([
  { name: 'content.xml', text: `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>` },
  { name: 'Formula1/content.xml', text: MATHML },
]);

test('K36c: a list item whose only content is a formula keeps the item, with the equation as a maths segment', async () => {
  const body = `<text:list>
<text:list-item><text:p>Before</text:p></text:list-item>
<text:list-item><text:p>${formulaFrame('Formula1')}</text:p></text:list-item>
<text:list-item><text:p>After</text:p></text:list-item>
</text:list>`;
  const m = await parseOdt(await docWithFormula(body));
  assert.equal(m.blocks.length, 1, 'no stray blocks — the formula stayed inside the list item, not hoisted out');
  assert.equal(m.blocks[0].type, 'list');
  const items = m.blocks[0].items;
  assert.equal(items.length, 3, 'the formula item was kept, not silently dropped');
  assert.equal(items[0].text, 'Before');
  assert.equal(items[2].text, 'After');
  assert.equal(items[1].text, '', 'no print text of its own');
  assert.ok(Array.isArray(items[1].segments), 'the formula item carries item.segments');
  const mathSegs = items[1].segments.filter((s) => s.type === 'math');
  assert.equal(mathSegs.length, 1);
  assert.match(mathSegs[0].mathml, /<(math:)?mi>x<\/(math:)?mi>/);
});

test('K36c: a list item with a formula AND text keeps both (unchanged: the inline-formula path already worked)', async () => {
  const body = `<text:list><text:list-item><text:p>Solve ${formulaFrame('Formula1')} for x.</text:p></text:list-item></text:list>`;
  const m = await parseOdt(await docWithFormula(body));
  const item = m.blocks[0].items[0];
  assert.equal(item.text, 'Solve for x.');
  assert.ok(item.segments.some((s) => s.type === 'math'));
});

test('K36c: an ordinary list (no formulas at all) is unaffected', async () => {
  const m = await parseOdt(await docWithFormula('<text:list><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p>two</text:p></text:list-item></text:list>'));
  assert.deepEqual(m.blocks[0].items.map((i) => i.text), ['one', 'two']);
  assert.ok(!m.blocks[0].items.some((i) => i.segments));
});

// ---------------------------------------------------------------------------------------------
// K36d (ODT half): box detection for a <draw:frame><draw:text-box>
// ---------------------------------------------------------------------------------------
const gstyle = (name, attrs) => `<style:style style:name="${name}" style:family="graphic"><style:graphic-properties ${attrs}/></style:style>`;
const shape = (m) => m.blocks.map((b) => b.type === 'box' ? 'box:' + (b.title || '') + ':' + b.blocks.map((x) => x.text).join('|') : b.type + ':' + (b.text ?? ''));

test('K36d: a bordered ODT text box becomes a box block', async () => {
  const autos = gstyle('BorderedBox', 'draw:stroke="solid" svg:stroke-color="#000000" draw:fill="none"');
  const body = `<text:p>Before</text:p>
<text:p><draw:frame draw:style-name="BorderedBox" draw:name="SideNote"><draw:text-box><text:p>Boxed text.</text:p></draw:text-box></draw:frame>Anchor</text:p>
<text:p>After</text:p>`;
  const m = await parseOdt(await doc(body, autos));
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'box', 'para', 'para']);
  const box = m.blocks[1];
  assert.equal(box.blocks.length, 1);
  assert.equal(box.blocks[0].text, 'Boxed text.');
  assert.equal(box.boxColor, undefined, 'a border with no fill has no boxColor');
});

test('K36d: a filled ODT text box becomes a box block with its boxColor', async () => {
  const autos = gstyle('FilledBox', 'draw:stroke="none" draw:fill="solid" draw:fill-color="#ff0000"');
  const body = `<text:p><draw:frame draw:style-name="FilledBox"><draw:text-box><text:p>Red box.</text:p></draw:text-box></draw:frame></text:p>`;
  const m = await parseOdt(await doc(body, autos));
  const box = m.blocks.find((b) => b.type === 'box');
  assert.ok(box, 'the filled frame became a box');
  assert.equal(box.boxColor, 'red');
});

test('K36d: a short bold leading paragraph becomes the box title (extractBoxTitle, shared with DOCX/HTML)', async () => {
  const autos = gstyle('BorderedBox', 'draw:stroke="solid" svg:stroke-color="#000000" draw:fill="none"')
    + `<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>`;
  const body = `<text:p><draw:frame draw:style-name="BorderedBox"><draw:text-box><text:p><text:span text:style-name="B">Warning</text:span></text:p><text:p>Body text.</text:p></draw:text-box></draw:frame></text:p>`;
  const m = await parseOdt(await doc(body, autos));
  const box = m.blocks.find((b) => b.type === 'box');
  assert.equal(box.title, 'Warning');
  assert.deepEqual(box.blocks.map((b) => b.text), ['Body text.']);
});

test('K36d: an unbordered, unfilled ODT text box (explicit "none"/"none", or no style at all) stays plain paragraphs', async () => {
  const autos = gstyle('PlainFrame', 'draw:stroke="none" draw:fill="none"');
  const bodyStyled = `<text:p>Before</text:p><text:p><draw:frame draw:style-name="PlainFrame"><draw:text-box><text:p>Side note.</text:p></draw:text-box></draw:frame>Anchor</text:p><text:p>After</text:p>`;
  const styled = await parseOdt(await doc(bodyStyled, autos));
  assert.deepEqual(styled.blocks.map((b) => b.type), ['para', 'para', 'para', 'para']);
  assert.deepEqual(styled.blocks.map((b) => b.text), ['Before', 'Side note.', 'Anchor', 'After']);

  const bodyNoStyle = `<text:p><draw:frame><draw:text-box><text:p>No style at all.</text:p></draw:text-box></draw:frame></text:p>`;
  const noStyle = await parseOdt(await doc(bodyNoStyle));
  assert.ok(!noStyle.blocks.some((b) => b.type === 'box'));
  assert.equal(noStyle.blocks[0].text, 'No style at all.');
});

test('K36d: a text box holding a heading and a list keeps the list inside the box, the heading pulled out as the box title (extractBoxTitle: an explicit heading is always a title)', async () => {
  const autos = gstyle('BorderedBox', 'draw:stroke="solid" svg:stroke-color="#000000" draw:fill="none"');
  const body = `<text:p><draw:frame draw:style-name="BorderedBox"><draw:text-box><text:h text:outline-level="2">Sidebar</text:h><text:list><text:list-item><text:p>one</text:p></text:list-item></text:list></draw:text-box></draw:frame></text:p>`;
  const m = await parseOdt(await doc(body, autos));
  const box = m.blocks.find((b) => b.type === 'box');
  assert.equal(box.title, 'Sidebar');
  assert.deepEqual(box.blocks.map((b) => b.type), ['list']);
});
