// Box/sidebar detection for the Word and HTML/EPUB importers (BANA Formats §7, box lines; K7
// names a box's colour when the document's boxes differ — field-registry.mjs `boxColor`).
// OOXML/HTML have no native "this is a sidebar" element, so each reader infers one from raw
// formatting a sighted reader would notice — see the file comments in input/parse.mjs above
// docxParaBorderInfo (DOCX) and htmlBoxSignal (HTML/EPUB) for the full signal list and why each
// one is conservative. Every check here failed before that fix (a box came out as ordinary
// boxless paragraphs, and no box ever carried a `boxColor`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDocx, parseHtml } from '../input/parse.mjs';
import { parseDoc } from '../input/doc.mjs';
import { makeZip } from '../web/zip.mjs';

const loBytes = (name) => { const b = readFileSync(new URL(`./fixtures/libreoffice/${name}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const V = 'urn:schemas-microsoft-com:vml';

const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const docx = async (bodyXml) => parseDocx(await zipBuf([{
  name: 'word/document.xml',
  text: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}" xmlns:v="${V}"><w:body>${bodyXml}</w:body></w:document>`,
}]));
const ALL_SIDE_BORDER = `<w:top w:val="single" w:sz="8" w:color="000000"/><w:left w:val="single" w:sz="8" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:color="000000"/><w:right w:val="single" w:sz="8" w:color="000000"/>`;

// ---------- DOCX: paragraph border run (w:pBdr, Word's own "box" grouping rule) ----------

test('docx: a run of paragraphs sharing the same 4-side pBdr becomes one box, with the first bold short paragraph as its title', async () => {
  const d = await docx(`
    <w:p><w:r><w:t>Intro.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pBdr>${ALL_SIDE_BORDER}</w:pBdr><w:shd w:val="clear" w:fill="FFFF00"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Tip</w:t></w:r></w:p>
    <w:p><w:pPr><w:pBdr>${ALL_SIDE_BORDER}</w:pBdr><w:shd w:val="clear" w:fill="FFFF00"/></w:pPr><w:r><w:t>Body text of the tip box.</w:t></w:r></w:p>
    <w:p><w:r><w:t>After the box.</w:t></w:r></w:p>`);
  assert.equal(d.blocks[0].text, 'Intro.');
  const box = d.blocks[1];
  assert.equal(box.type, 'box', JSON.stringify(d.blocks));
  assert.equal(box.title, 'Tip');
  assert.equal(box.boxColor, 'yellow');
  assert.deepEqual(box.blocks, [{ type: 'para', text: 'Body text of the tip box.' }]);
  assert.equal(d.blocks[2].text, 'After the box.');
  assert.equal(d.blocks.length, 3);
});

test('docx: a paragraph with only a bottom border (a rule line) is NOT a box', async () => {
  const d = await docx(`
    <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:color="000000"/></w:pBdr></w:pPr><w:r><w:t>Just a rule line.</w:t></w:r></w:p>`);
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].type, 'para');
  assert.equal(d.blocks[0].text, 'Just a rule line.');
});

test('docx: two adjacent bordered paragraphs with DIFFERENT borders are two one-paragraph boxes, not one', async () => {
  const otherBorder = `<w:top w:val="single" w:sz="24" w:color="FF0000"/><w:left w:val="single" w:sz="24" w:color="FF0000"/><w:bottom w:val="single" w:sz="24" w:color="FF0000"/><w:right w:val="single" w:sz="24" w:color="FF0000"/>`;
  const d = await docx(`
    <w:p><w:pPr><w:pBdr>${ALL_SIDE_BORDER}</w:pBdr></w:pPr><w:r><w:t>Box one.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pBdr>${otherBorder}</w:pBdr></w:pPr><w:r><w:t>Box two.</w:t></w:r></w:p>`);
  assert.equal(d.blocks.length, 2);
  assert.ok(d.blocks.every((b) => b.type === 'box'), JSON.stringify(d.blocks));
  assert.deepEqual(d.blocks[0].blocks, [{ type: 'para', text: 'Box one.' }]);
  assert.deepEqual(d.blocks[1].blocks, [{ type: 'para', text: 'Box two.' }]);
});

// ---------- DOCX: single-cell bordered/shaded table ----------

test('docx: a bordered/shaded single-cell table with several paragraphs becomes a box, not flattened plain paragraphs', async () => {
  const d = await docx(`
    <w:tbl><w:tr><w:tc><w:tcPr><w:tcBorders>${ALL_SIDE_BORDER}</w:tcBorders><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Fun Fact</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cats sleep for most of their lives.</w:t></w:r></w:p>
    </w:tc></w:tr></w:tbl>`);
  assert.equal(d.blocks.length, 1);
  const box = d.blocks[0];
  assert.equal(box.type, 'box', JSON.stringify(d.blocks));
  assert.equal(box.title, 'Fun Fact');
  assert.equal(box.boxColor, 'blue');
  assert.deepEqual(box.blocks, [{ type: 'para', text: 'Cats sleep for most of their lives.' }]);
});

test('docx: a bordered single-cell table with only ONE short paragraph stays a plain paragraph (not "several")', async () => {
  const d = await docx(`
    <w:tbl><w:tr><w:tc><w:tcPr><w:tcBorders>${ALL_SIDE_BORDER}</w:tcBorders></w:tcPr>
    <w:p><w:r><w:t>Page 4</w:t></w:r></w:p>
    </w:tc></w:tr></w:tbl>`);
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].type, 'para');
  assert.equal(d.blocks[0].text, 'Page 4');
});

test('docx: an unbordered, unshaded single-cell table (an ordinary layout table) still flattens to plain paragraphs', async () => {
  const d = await docx(`
    <w:tbl><w:tr><w:tc>
    <w:p><w:r><w:t>Line one.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Line two.</w:t></w:r></w:p>
    </w:tc></w:tr></w:tbl>`);
  assert.equal(d.blocks.length, 2);
  assert.ok(d.blocks.every((b) => b.type === 'para'), JSON.stringify(d.blocks));
});

// ---------- DOCX: floating text box (wps:txbx / legacy VML v:textbox) ----------

test('docx: a DrawingML text box with an explicit border/fill becomes a box; an undecorated one stays flat paragraphs', async () => {
  const decorated = `<w:p><w:r><w:drawing><wp:anchor><wp:docPr id="1" name="TextBox1"/><a:graphic><a:graphicData><wps:wsp><wps:spPr><a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Boxed text.</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
  const plain = `<w:p><w:r><w:drawing><wp:anchor><wp:docPr id="2" name="RunningHead"/><a:graphic><a:graphicData><wps:wsp><wps:spPr></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Running Head</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
  const d = await docx(decorated + plain);
  assert.equal(d.blocks.length, 2, JSON.stringify(d.blocks));
  assert.equal(d.blocks[0].type, 'box');
  assert.equal(d.blocks[0].boxColor, 'blue');
  assert.deepEqual(d.blocks[0].blocks, [{ type: 'para', text: 'Boxed text.' }]);
  assert.equal(d.blocks[1].type, 'para');
  assert.equal(d.blocks[1].text, 'Running Head');
});

test('docx: a legacy VML text box (v:shape/v:textbox) with explicit stroked/filled colours becomes a box', async () => {
  const decorated = `<w:p><w:r><w:pict><v:shape stroked="t" strokecolor="black" filled="t" fillcolor="#D9E2F3"><v:textbox><w:txbxContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Notice</w:t></w:r></w:p><w:p><w:r><w:t>Legacy VML box body.</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  const plain = `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Plain running head.</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
  const d = await docx(decorated + plain);
  assert.equal(d.blocks.length, 2, JSON.stringify(d.blocks));
  assert.equal(d.blocks[0].type, 'box');
  assert.equal(d.blocks[0].title, 'Notice');
  assert.equal(d.blocks[0].boxColor, 'blue');
  assert.equal(d.blocks[1].type, 'para');
});

// ---------- .doc (legacy binary): the same box rule, from OfficeArt FOPT fill/line ----------

test('doc: a LibreOffice-written text box with an explicit fill/line becomes a box, matching its own .docx export', async () => {
  // Real-file parity gap: doc.mjs's own OfficeArt shape reader (doc-art.mjs) did not carry a
  // shape's fill/line colour or "is it actually drawn" flag at all, so a .doc text box always
  // stayed flat paragraphs even when its own .docx export (same source file, LibreOffice's
  // Save As) was boxed by the DrawingML/VML check above — see
  // Emboss/tests/doc_reader.test.mjs's own "LibreOffice .doc: a text box…" parity test.
  const doc = await parseDoc(loBytes('lo-textbox.doc'));
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para', 'box', 'para'], JSON.stringify(doc.blocks));
  assert.deepEqual(doc.blocks[1].blocks, [{ type: 'para', text: 'Text inside a text box.' }]);
  assert.equal(doc.blocks[1].boxColor, undefined);   // white fill: no colour worth naming (K7)
});

// ---------- HTML/EPUB ----------

test('html: <aside> becomes a box, with a leading heading as its title', () => {
  const d = parseHtml('<body><p>Before.</p><aside><h3>Did you know?</h3><p>Sidebar body text.</p></aside><p>After.</p></body>');
  assert.equal(d.blocks.length, 3, JSON.stringify(d.blocks));
  const box = d.blocks[1];
  assert.equal(box.type, 'box');
  assert.equal(box.title, 'Did you know?');
  assert.deepEqual(box.blocks, [{ type: 'para', text: 'Sidebar body text.' }]);
});

test('html: role="complementary" and epub:type="sidebar" both become boxes', () => {
  const d1 = parseHtml('<body><div role="complementary"><p>Complementary content.</p></div></body>');
  assert.equal(d1.blocks[0].type, 'box', JSON.stringify(d1.blocks));
  const d2 = parseHtml('<html xmlns:epub="http://www.idpf.org/2007/ops"><body><div epub:type="sidebar"><p>Sidebar content.</p></div></body></html>');
  assert.equal(d2.blocks[0].type, 'box', JSON.stringify(d2.blocks));
});

test('html: a class name like "sidebar"/"callout"/"note-box" becomes a box; "footnote"/"endnote" do not', () => {
  const sidebar = parseHtml('<body><div class="sidebar"><p>One.</p></div></body>').blocks[0];
  assert.equal(sidebar.type, 'box');
  const callout = parseHtml('<body><div class="callout-box"><p>Two.</p></div></body>').blocks[0];
  assert.equal(callout.type, 'box');
  const pgNote = parseHtml('<body><div class="note"><p class="hang">A marginal sidenote.</p></div></body>').blocks[0];
  assert.equal(pgNote.type, 'para', 'class="note" alone (Project Gutenberg sidenotes) is not a box: ' + JSON.stringify(pgNote));
  const footnote = parseHtml('<body><div class="footnote"><p>Not a box.</p></div></body>').blocks[0];
  assert.equal(footnote.type, 'para', JSON.stringify(footnote));
});

test('html: a full CSS border (inline style) becomes a box and names its background colour (K7); a bottom-border-only rule line does not', () => {
  const boxed = parseHtml('<body><div style="border: 1px solid #000; background-color: #ADD8E6;"><p><b>Warning</b></p><p>Watch out.</p></div></body>').blocks[0];
  assert.equal(boxed.type, 'box', JSON.stringify(boxed));
  assert.equal(boxed.title, 'Warning');
  assert.equal(boxed.boxColor, 'blue');   // K7: a light-blue tint reads as "blue", not nearest-RGB "pink" — see hexToColorName
  const rule = parseHtml('<body><p style="border-bottom: 1px solid #ccc;">Just a rule line, not a box.</p></body>').blocks[0];
  assert.equal(rule.type, 'para');
  const ruleDiv = parseHtml('<body><div style="border-bottom: 2px solid #000;"><p>Text under a rule.</p></div></body>').blocks[0];
  assert.equal(ruleDiv.type, 'para', JSON.stringify(ruleDiv));
});

test('html: a plain background-colour with no border/class/role signal is NOT a box on its own', () => {
  const d = parseHtml('<body><div style="background-color: yellow;"><p>Just a tint, not a box.</p></div></body>');
  assert.equal(d.blocks[0].type, 'para', JSON.stringify(d.blocks));
});

test('html via EPUB chapters (parseEpub calls parseHtml per chapter): the same <aside> detection applies', async () => {
  const { parseEpub } = await import('../input/parse.mjs');
  const chapterHtml = '<html><body><p>Before.</p><aside class="sidebar"><p>Sidebar text.</p></aside></body></html>';
  const files = [
    { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch1"/></spine></package>' },
    { name: 'ch1.xhtml', text: chapterHtml },
  ];
  const d = await parseEpub(await zipBuf(files));
  assert.equal(d.blocks.length, 2, JSON.stringify(d.blocks));
  assert.equal(d.blocks[1].type, 'box');
  assert.deepEqual(d.blocks[1].blocks, [{ type: 'para', text: 'Sidebar text.' }]);
});
