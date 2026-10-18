// DOCX import defect fixes, second pass (docx-fix audit 2, 25 Sep 2026 — see AGENTS.md's
// brief and the second audit's own repro .docx files/harness for the read-only investigation
// this task builds on). Each `test()` below is one numbered item from that brief:
//   1. a Heading-styled paragraph carrying w:numPr (directly or via its style) is a numbered
//      heading, not a list item, with the number kept at the start of the heading text
//   2a. w:isLgl forces the displayed marker to plain Arabic numerals, regardless of numFmt
//   2b. list numbering continues across an interrupting non-list paragraph for the same numId
//   3.  a picture marked decorative (adec:decorative), or whose only "alt" is Word's own
//       default docPr name ("Picture 3"), gets no alt text (BANA 6.4.1 omission applies)
//   4/5. TOC1-9 styled paragraphs, and a manual dot-leader tab-stop contents line, become
//       'toc' list entries (text + page number); an ordinary tab with no dot leader is
//       unchanged (a single space)
//   6.  w:footnoteReference/w:endnoteReference customMarkFollows uses the following run's
//       text as the mark (no auto-number, no duplicated body text); w:footnotePr/w:endnotePr
//       numFmt (sectPr or settings.xml) governs the auto-numbered case
//   7.  an underlined run of nothing but spaces (BANA §10.6.1 "empty space" blank) becomes
//       three dot 5s plus an embedded transcriber's note, instead of silently vanishing
//   8.  an encrypted (CFB-signature) or truncated/corrupt .docx throws a clear, actionable
//       message instead of "not a zip (no EOCD)"
//   9.  w:sym Wingdings F0FD/F0FE map to ☒/☑ (the wordSymGlyph table correction)
//   WMF/EMF: a word/media/*.wmf or *.emf image resource is converted to SVG (metafile.mjs),
//       not embedded as unrenderable raw bytes (coordinator request, same DOCX image-handling
//       area as item 3)
//   strike: w:strike/w:dstrike (direct or via character style) sets transcriberTypeform
//       'strike' on the run's text segment (coordinator request: DOCX wiring for the
//       strikethrough agent's own convention)
//
// Each test is written to FAIL against the pre-fix parse.mjs — verified by hand, temporarily
// pointing the import below at the saved pre-change copy in the scratch dir
// (docx-fix2/parse.mjs.orig) — see this task's final report for the exact before/after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseDocx, parseFile } from '../input/parse.mjs';
import { makeZip } from '../web/zip.mjs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

async function buildDocx({ bodyXml, rels = '', extraParts = [], extraNs = '' }) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}"${extraNs}><w:body>${bodyXml}</w:body></w:document>`;
  const parts = [{ name: 'word/document.xml', text: docXml }, ...extraParts];
  if (rels) parts.push({ name: 'word/_rels/document.xml.rels', text: rels });
  const buf = await makeZip(parts).arrayBuffer();
  return parseDocx(buf);
}
const RELS = (...rs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rs.join('')}</Relationships>`;

// ---------------------------------------------------------------------------------------
// Item 1: numbered headings.
// ---------------------------------------------------------------------------------------
test('item 1: a Heading-styled paragraph with w:numPr is a numbered heading, not a list item', async () => {
  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="${W}">
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
  const bodyXml =
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Background</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/numbering.xml', text: numbering }] });
  assert.equal(doc.blocks.filter((b) => b.type === 'list').length, 0, 'no list block: ' + JSON.stringify(doc.blocks));
  const headings = doc.blocks.filter((b) => b.type === 'heading');
  assert.equal(headings.length, 2, JSON.stringify(doc.blocks));
  assert.equal(headings[0].text, '1 Introduction');
  assert.equal(headings[0].level, 1);
  assert.equal(headings[1].text, '1.1 Background');
  assert.equal(headings[1].level, 2);
});

test('item 1: "Chapter %1" lvlText numbered heading', async () => {
  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="${W}">
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Chapter %1"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Getting Started</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/numbering.xml', text: numbering }] });
  const h = doc.blocks.find((b) => b.type === 'heading');
  assert.equal(h.text, 'Chapter 1 Getting Started', JSON.stringify(doc.blocks));
});

// ---------------------------------------------------------------------------------------
// Item 2a: w:isLgl legal-style numbering forces Arabic numerals.
// ---------------------------------------------------------------------------------------
test('item 2a: w:isLgl forces the displayed marker to decimal regardless of numFmt', async () => {
  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="${W}">
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/><w:isLgl/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2."/><w:isLgl/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
  const p = (t, ilvl) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const bodyXml = p('First', 0) + p('Sub', 1) + p('Second', 0);
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/numbering.xml', text: numbering }] });
  const list = doc.blocks.find((b) => b.type === 'list');
  assert.deepEqual(list.items.map((it) => it.marker), ['1.', '1.1.', '2.'], JSON.stringify(list.items));
});

// ---------------------------------------------------------------------------------------
// Item 2b: list numbering continues across an interrupting non-list paragraph.
// ---------------------------------------------------------------------------------------
test('item 2b: numbering continues (does not restart) across an interrupting plain paragraph, same numId', async () => {
  const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="${W}">
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`;
  const p = (t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const bodyXml = p('One') + p('Two') + `<w:p><w:r><w:t>An interrupting paragraph.</w:t></w:r></w:p>` + p('Three');
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/numbering.xml', text: numbering }] });
  const lists = doc.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 2, JSON.stringify(doc.blocks));
  assert.deepEqual(lists[0].items.map((it) => it.marker), ['1.', '2.']);
  assert.deepEqual(lists[1].items.map((it) => it.marker), ['3.'], 'continues from 2, does not restart at 1: ' + JSON.stringify(lists[1].items));
});

// ---------------------------------------------------------------------------------------
// Item 3: decorative pictures and Word's own default picture names.
// ---------------------------------------------------------------------------------------
const pngBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const imgRels = RELS(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`);
function drawingXml({ name = 'Picture 1', descr, decorative = false } = {}) {
  const docPrAttrs = `id="1" name="${name}"${descr != null ? ` descr="${descr}"` : ''}`;
  const docPr = decorative
    ? `<wp:docPr ${docPrAttrs}><a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst></wp:docPr>`
    : `<wp:docPr ${docPrAttrs}/>`;
  return `<w:r><w:drawing><wp:inline>${docPr}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
test('item 3: a picture marked decorative gets no alt text', async () => {
  const bodyXml = `<w:p>${drawingXml({ name: 'Picture 3', decorative: true })}</w:p>`;
  const doc = await buildDocx({ bodyXml, rels: imgRels, extraParts: [{ name: 'word/media/image1.png', data: pngBytes }] });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, JSON.stringify(doc.blocks));
  assert.equal(g.alt, '');
});
test('item 3: a picture whose only "alt" is Word\'s own default name gets no alt text', async () => {
  const bodyXml = `<w:p>${drawingXml({ name: 'Picture 7' })}</w:p>`;
  const doc = await buildDocx({ bodyXml, rels: imgRels, extraParts: [{ name: 'word/media/image1.png', data: pngBytes }] });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, '');
});
test('item 3: a picture with a real author-written descr keeps it', async () => {
  const bodyXml = `<w:p>${drawingXml({ name: 'Picture 7', descr: 'A red triangle diagram' })}</w:p>`;
  const doc = await buildDocx({ bodyXml, rels: imgRels, extraParts: [{ name: 'word/media/image1.png', data: pngBytes }] });
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.alt, 'A red triangle diagram');
});

// ---------------------------------------------------------------------------------------
// Items 4/5: TOC styles and dot-leader contents lines.
// ---------------------------------------------------------------------------------------
test('item 4: TOC1/TOC2 styled paragraphs become a toc list with entry text + page number', async () => {
  const tocEntry = (level, text, page) =>
    `<w:p><w:pPr><w:pStyle w:val="TOC${level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs></w:pPr>` +
    `<w:r><w:t>${text}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${page}</w:t></w:r></w:p>`;
  const bodyXml = tocEntry(1, 'Chapter One', '1') + tocEntry(2, 'Section 1.1', '2') + tocEntry(1, 'Chapter Two', '5');
  const doc = await buildDocx({ bodyXml });
  const list = doc.blocks.find((b) => b.type === 'list' && b.kind === 'toc');
  assert.ok(list, JSON.stringify(doc.blocks));
  assert.deepEqual(list.items.map((it) => [it.text, it.page, it.level || 0]), [
    ['Chapter One', '1', 0], ['Section 1.1', '2', 1], ['Chapter Two', '5', 0],
  ]);
});

test('item 5: a manual dot-leader tab-stop line becomes a toc entry (text + page number)', async () => {
  const bodyXml = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">Introduction</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>1</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const list = doc.blocks.find((b) => b.type === 'list' && b.kind === 'toc');
  assert.ok(list, JSON.stringify(doc.blocks));
  assert.deepEqual(list.items, [{ text: 'Introduction', page: '1' }]);
});

test('item 5: a tab with no dot leader stays a single space (unchanged)', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Name:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>__________</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  assert.equal(doc.blocks.filter((b) => b.type === 'list' && b.kind === 'toc').length, 0, JSON.stringify(doc.blocks));
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, 'Name: __________');
});

// ---------------------------------------------------------------------------------------
// Item 6: custom footnote marks and numFmt.
// ---------------------------------------------------------------------------------------
test('item 6: w:customMarkFollows uses the next run\'s text as the mark, not an auto-number, and is not duplicated as body text', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">A statement</w:t></w:r>` +
    `<w:r><w:footnoteReference w:id="1" w:customMarkFollows="1"/></w:r>` +
    `<w:r><w:t>*</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> continues.</w:t></w:r></w:p>`;
  const footnotesXml = `<?xml version="1.0"?><w:footnotes xmlns:w="${W}">
    <w:footnote w:id="1"><w:p><w:r><w:t>*</w:t></w:r><w:r><w:t xml:space="preserve"> A custom asterisk footnote.</w:t></w:r></w:p></w:footnote>
  </w:footnotes>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/footnotes.xml', text: footnotesXml }] });
  const para = doc.blocks.find((b) => b.type === 'para');
  const ref = para.segments.find((s) => s.type === 'noteref');
  assert.equal(ref.text, '*', JSON.stringify(para.segments));
  const bodyAfter = para.segments[para.segments.length - 1];
  assert.equal(bodyAfter.text, ' continues.', 'the "*" must not be duplicated as body text: ' + JSON.stringify(para.segments));
});

test('item 6: footnotePr numFmt=lowerRoman governs the auto-numbered mark', async () => {
  const bodyXml = `<w:p><w:r><w:t>A statement</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>` +
    `<w:sectPr><w:footnotePr><w:numFmt w:val="lowerRoman"/></w:footnotePr></w:sectPr>`;
  const footnotesXml = `<?xml version="1.0"?><w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Roman note.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/footnotes.xml', text: footnotesXml }] });
  const para = doc.blocks.find((b) => b.type === 'para');
  const ref = para.segments.find((s) => s.type === 'noteref');
  assert.equal(ref.text, 'i', JSON.stringify(para.segments));
});

// ---------------------------------------------------------------------------------------
// Item 7: underlined-space "write-on-line" blanks (BANA 10.6.1).
// ---------------------------------------------------------------------------------------
test('item 7: an underlined run of spaces becomes three dot 5s plus a transcriber\'s note, not silence', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">Name: </w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">          </w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  const brl = para.segments.find((s) => s.type === 'brl');
  assert.ok(brl, 'a brl (literal braille) segment must replace the vanished blank: ' + JSON.stringify(para.segments));
  assert.equal(brl.brl, '"""');
  const note = para.segments.find((s) => s.type === 'imgnote');
  assert.ok(note && note.prodnote, 'an embedded transcriber\'s note must explain the change from print: ' + JSON.stringify(para.segments));
});

// ---------------------------------------------------------------------------------------
// Item 8: encrypted / corrupt DOCX.
// ---------------------------------------------------------------------------------------
test('item 8: a CFB-signature (password-protected) .docx throws a clear, actionable message', async () => {
  const cfb = new Uint8Array(512);
  cfb.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0);
  await assert.rejects(() => parseFile('secret.docx', cfb.buffer), /password-protected/i);
});

test('item 8: a truncated .docx throws a clear "damaged or incomplete" message, not "not a zip (no EOCD)"', async () => {
  const docXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;
  const full = new Uint8Array(await makeZip([{ name: 'word/document.xml', text: docXml }]).arrayBuffer());
  const truncated = full.slice(0, Math.floor(full.length * 0.6));
  await assert.rejects(() => parseFile('truncated.docx', truncated.buffer), (e) => {
    assert.match(e.message, /damaged or incomplete/i);
    assert.doesNotMatch(e.message, /EOCD/i);
    return true;
  });
});

test('item 8: random bytes with a .docx extension throw the same clear "damaged" message', async () => {
  const junk = new Uint8Array(200);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 37) % 256;
  await assert.rejects(() => parseFile('junk.docx', junk.buffer), /damaged or incomplete/i);
});

// ---------------------------------------------------------------------------------------
// Item 9: Wingdings F0FD/F0FE.
// ---------------------------------------------------------------------------------------
test('item 9: Wingdings F0FE -> ☑ (ballot box with check), F0FD -> ☒ (ballot box with X)', async () => {
  const bodyXml = `<w:p><w:r><w:sym w:font="Wingdings" w:char="F0FE"/></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F0FD"/></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.text, '☑ and ☒', JSON.stringify(para));
});

// ---------------------------------------------------------------------------------------
// WMF/EMF image resources (coordinator request).
// ---------------------------------------------------------------------------------------
// Minimal hand-built WMF (one Rectangle record), duplicated from the field layout
// Emboss/tests/metafile.test.mjs's own builders already use/verify against [MS-WMF] — just
// enough for metafileToSvg to have something drawable to convert.
class BW {
  constructor() { this.chunks = []; }
  bytes(u8) { this.chunks.push(u8); return this; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, true); return this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return this.bytes(b); }
  toBytes() {
    let len = 0; for (const c of this.chunks) len += c.length;
    const out = new Uint8Array(len); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}
function concatB(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function wmfRecord(func, params) {
  const padded = params.length % 2 === 0 ? params : concatB([params, Uint8Array.of(0)]);
  const w = new BW(); w.u32(3 + padded.length / 2); w.u16(func); w.bytes(padded);
  return w.toBytes();
}
const wmfEOF = () => wmfRecord(0x0000, new Uint8Array(0));
const wmfHeader = () => { const w = new BW(); w.u16(1); w.u16(9); w.u16(0x0300); w.u32(0); w.u16(0); w.u32(0); w.u16(0); return w.toBytes(); };
const wmfRectangle = (l, t, r, b) => wmfRecord(0x041B, new BW().i16(b).i16(r).i16(t).i16(l).toBytes());
function buildTinyWmf() {
  return concatB([wmfHeader(), wmfRectangle(0, 0, 100, 100), wmfEOF()]);
}
test('WMF/EMF: a word/media/*.wmf image resource is converted to SVG, not embedded raw', async () => {
  const wmfBytes = buildTinyWmf();
  const rels = RELS(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>`);
  const bodyXml = `<w:p>${drawingXml({ name: 'Picture 1', descr: 'A drawing' })}</w:p>`;
  const doc = await buildDocx({ bodyXml, rels, extraParts: [{ name: 'word/media/image1.wmf', data: wmfBytes }] });
  assert.ok(Array.isArray(doc.resources) && doc.resources.length === 1, JSON.stringify(doc.resources));
  assert.equal(doc.resources[0].mime, 'image/svg+xml', JSON.stringify(doc.resources[0]));
  assert.ok(doc.resources[0].path.endsWith('.svg'), doc.resources[0].path);
  const svgText = new TextDecoder().decode(doc.resources[0].bytes);
  assert.match(svgText, /<svg/);
  const g = doc.blocks.find((b) => b.type === 'graphic');
  assert.equal(g.src, doc.resources[0].path);
});

// ---------------------------------------------------------------------------------------
// Strikethrough wiring (coordinator request).
// ---------------------------------------------------------------------------------------
test('strikethrough: a direct w:strike run gets transcriberTypeform "strike"', async () => {
  const bodyXml = `<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r><w:r><w:rPr><w:strike/></w:rPr><w:t>struck</w:t></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  const hit = para.segments.find((s) => s.text === 'struck');
  assert.equal(hit.transcriberTypeform, 'strike', JSON.stringify(para.segments));
  assert.equal(para.segments[0].transcriberTypeform, undefined);
});

test('strikethrough: w:dstrike (double strikethrough) also gets transcriberTypeform "strike"', async () => {
  const bodyXml = `<w:p><w:r><w:rPr><w:dstrike/></w:rPr><w:t>struck</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.segments[0].transcriberTypeform, 'strike', JSON.stringify(para.segments));
});

test('strikethrough: a character style with w:strike (rStyle, no direct rPr toggle) is honoured', async () => {
  const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
    <w:style w:type="character" w:styleId="Deleted"><w:rPr><w:strike/></w:rPr></w:style>
  </w:styles>`;
  const bodyXml = `<w:p><w:r><w:rPr><w:rStyle w:val="Deleted"/></w:rPr><w:t>struck</w:t></w:r></w:p>`;
  const doc = await buildDocx({ bodyXml, extraParts: [{ name: 'word/styles.xml', text: stylesXml }] });
  const para = doc.blocks.find((b) => b.type === 'para');
  assert.equal(para.segments[0].transcriberTypeform, 'strike', JSON.stringify(para.segments));
});
