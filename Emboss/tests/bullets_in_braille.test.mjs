// G8 (Paul's decision): braille KEEPS the print bullet — BANA primary bullet `_4` (BANA 8.6.2) — for a bulleted list
// from EVERY input (before this only NIMAS <list type="ul"> did). parse -> format (BANA 40x25 UEB, the options
// scripts/gold-run.mjs sets) -> every item line starts with `_4`; ordered lists stay numbered; a plain list has no bullet.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseHtml, parseEpub, parseDocx, parseOdt, parseMarkdown, parseRtf, parseDtbook } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const OPTS = {
  mode: 'bana', standard: 'bana', width: 40, depth: 25,
  translate: (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null),
  translateG1: (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null),
  suppressHeader: true,
};
const lines = (model) => formatDocument({ blocks: model.blocks, title: model.title }, OPTS).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const zipBuf = async (files) => await makeZip(files).arrayBuffer();
const bs = '\\';

test('HTML <ul>, nested: _4 at level 1 and level 2; <ol> unchanged', () => {
  const m = parseHtml('<ul><li>Apples<ul><li>Red</li></ul></li><li>Pears</li></ul><ol><li>One</li></ol>');
  assert.deepEqual(m.blocks[0].items.map((i) => i.marker), ['•', '•', '•']);
  assert.equal(m.blocks[1].items[0].marker, '1.');
  const l = lines(m);
  assert.deepEqual(l.slice(0, 3), ['_4 ,APPLES', '  _4 ,R$', '_4 ,PE>S']);
  assert.ok(l.some((x) => x.startsWith('#A4 ')), l.join('\n'));
});

test('EPUB <ul>', async () => {
  const epub = await zipBuf([
    { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', text: '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Book</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
    { name: 'OEBPS/c1.xhtml', text: '<html xmlns="http://www.w3.org/1999/xhtml"><body><ul><li>Apples</li><li>Pears</li></ul></body></html>' },
  ]);
  const l = lines(await parseEpub(epub));
  assert.ok(l.includes('_4 ,APPLES') && l.includes('_4 ,PE>S'), l.join('\n'));
});

test('Markdown - / * / + bullets (and a nested one); a numbered item stays numbered', () => {
  for (const c of ['-', '*', '+']) {
    const l = lines(parseMarkdown(`${c} a\n${c} b\n  ${c} c\n1. x`));
    assert.deepEqual(l.slice(0, 3), ['_4 A', '_4 ;B', '  _4 ;C'], `${c}: ${l.join('|')}`);
    assert.ok(l.some((x) => x.startsWith('#A4 ')));
  }
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docxPara = (t, numId, ilvl) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const numbering = (glyph, font) => `<?xml version="1.0"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${glyph}"/><w:rPr><w:rFonts w:ascii="${font}"/></w:rPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

test('DOCX Word bullets: Symbol dot keeps _4; Wingdings square/check and Courier o keep their own bullet; nested; numbered stays numbered', async () => {
  // [lvlText glyph, font, level-0 first cells, level-1 ("o", Word's default level-2 bullet) first cells]
  // Changed 17 Oct 2026 (APH feedback point 15, Paul: 15a): Word's "o" AT LEVEL 2 (ilvl 1) is Word's default nested-bullet look, so it
  // is the ordinary bullet `_4`, no longer the hollow circle `;$=`. An "o" chosen for a top-level list still keeps its circle (row 5).
  const cases = [['', 'Symbol', '_4', '_4'], ['', 'Wingdings', '_$#D', '_4'], ['', 'Wingdings', '@%', '_4'], ['', 'Wingdings', ';$#D', '_4'],
    // IMP-W7 (Paul, 30 Sep 2026): Wingdings' arrowhead (U+F0D8) and heavy arrow (U+F0E8) are arrow bullets - they keep their print shape,
    // brailled as the first transcriber-defined symbol (BANA 8.6.2a, UEB 3.26: `;?`), not the ordinary bullet `_4` as before.
    ['o', 'Courier New', ';$=', '_4'], ['', 'Wingdings', ';?', '_4'], ['', 'Wingdings', ';?', '_4']];
  for (const [glyph, font, b0, b1] of cases) {
    const body = docxPara('Apples', 1, 0) + docxPara('Red', 1, 1) + docxPara('Pears', 1, 0) + '<w:p><w:r><w:t>Break</w:t></w:r></w:p>' + docxPara('One', 2, 0);
    const buf = await zipBuf([
      { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` },
      { name: 'word/numbering.xml', text: numbering(glyph, font) },
    ]);
    const l = lines(await parseDocx(buf));
    const tag = `${font} U+${glyph.codePointAt(0).toString(16)}: ${l.join('|')}`;
    assert.deepEqual(l.slice(0, 3), [`${b0} ,APPLES`, `  ${b1} ,R$`, `${b0} ,PE>S`], tag);
    assert.ok(l.some((x) => x.startsWith('#A4 ')), tag);
  }
});

const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"';
test('ODT bullet list (list-level-style-bullet), nested; a numbered list stays without a bullet', async () => {
  const styles = `<office:automatic-styles><text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/><text:list-level-style-bullet text:level="2" text:bullet-char="◦"/></text:list-style><text:list-style style:name="L2"><text:list-level-style-number text:level="1"/></text:list-style></office:automatic-styles>`;
  const body = `<text:list text:style-name="L1"><text:list-item><text:p>Apples</text:p><text:list><text:list-item><text:p>Red</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>Pears</text:p></text:list-item></text:list>
<text:list text:style-name="L2"><text:list-item><text:p>One</text:p></text:list-item></text:list>`;
  const buf = await zipBuf([{ name: 'content.xml', text: `<?xml version="1.0"?><office:document-content ${ODT_NS}>${styles}<office:body><office:text>${body}</office:text></office:body></office:document-content>` }]);
  const m = await parseOdt(buf);
  const l = lines(m);
  assert.deepEqual(l.slice(0, 3), ['_4 ,APPLES', '  _4 ,R$', '_4 ,PE>S'], l.join('|'));
  assert.equal(m.blocks[1].items[0].marker, undefined);
  assert.ok(!l.some((x) => /_4 ,"O/.test(x)));
});

test('RTF bullet paragraphs: \\bullet, Symbol \\\'b7, \\u61623?, empty marker; numbered stays numbered', () => {
  const groups = [
    `{${bs}pntext${bs}bullet${bs}tab}`,
    `{${bs}pntext${bs}f3${bs}'b7${bs}tab}`,
    `{${bs}listtext${bs}f3${bs}u-3913?${bs}tab}`,
    `{${bs}pntext${bs}tab}`,
  ];
  for (const g of groups) {
    const rtf = `{${bs}rtf1{${bs}pard${g}Apple${bs}par}{${bs}pard${g}Pear${bs}par}{${bs}pard Gap${bs}par}{${bs}pard{${bs}pntext 1.${bs}tab}One${bs}par}}`;
    const l = lines(parseRtf(rtf));
    assert.deepEqual(l.slice(0, 2), ['_4 ,APPLE', '_4 ,PE>'], `${g}: ${l.join('|')}`);
    assert.ok(l.some((x) => x.startsWith('#A4 ')), `${g}: ${l.join('|')}`);
  }
});

test('NIMAS: ul keeps _4; a plain list (type="pl") has NO bullet', () => {
  const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><list type="ul"><li>Apples</li></list><list type="pl"><li>Plain</li></list></level1></bodymatter></book></dtbook>`;
  const l = lines(parseDtbook(xml));
  assert.ok(l.includes('_4 ,APPLES'), l.join('|'));
  assert.ok(l.includes(',PLA9'), l.join('|'));
});

test('a list item whose text already begins with a bullet glyph gets ONE _4 (Gutenberg licence lists)', () => {
  const m = parseHtml('<ul><li>• You pay a fee</li><li>- dash item</li><li>* star item</li></ul>');
  assert.deepEqual(m.blocks[0].items.map((i) => i.text), ['You pay a fee', 'dash item', 'star item']);
  const l = lines(m);
  assert.ok(l[0].startsWith('_4 ,Y'), l.join('|'));
  assert.ok(!l.some((x) => x.includes('_4 _4')), l.join('|'));
});

test('a leading -1, an en-dash range or *emphasis* in a bullet item is NOT stripped as a bullet', () => {
  const m = parseHtml('<ul><li>-1 is the answer</li><li>–5 to 9</li><li>−3 degrees</li><li>*starred*</li><li><em>Lead</em> word</li></ul>');
  assert.deepEqual(m.blocks[0].items.map((i) => i.text), ['-1 is the answer', '–5 to 9', '−3 degrees', '*starred*', 'Lead word']);
  assert.ok(m.blocks[0].items.every((i) => i.marker === '•'));
});

test('duplicate bullet with inline markup: the glyph goes from the first segment too', () => {
  const m = parseHtml('<ul><li>• <em>Lead</em> word</li></ul>');
  const it = m.blocks[0].items[0];
  assert.equal(it.text, 'Lead word');
  assert.ok(!it.segments || !/^\s*•/.test(it.segments[0].text || ''), JSON.stringify(it.segments));
  assert.ok(!lines(m).some((x) => x.includes('_4 _4')));
});

test('Markdown: "- • item" gives one bullet', () => {
  const m = parseMarkdown('- • item one\n- item two\n');
  assert.deepEqual(m.blocks[0].items.map((i) => i.text), ['item one', 'item two']);
});

test('RTF Wingdings/Courier bullets keep their own bullet: \'a7 (square),  (check), o (hollow circle)', () => {
  const cases = [[`${bs}'a7`, '_$#D'], [`${bs}u-3844?`, '@%'], ['o', ';$=']];   // -3844 = 0xF0FC as a signed 16-bit \u value
  for (const [glyph, cells] of cases) {
    const g = `{${bs}listtext${bs}f3 ${glyph}${bs}tab}`;
    const rtf = `{${bs}rtf1{${bs}pard${g}Apple${bs}par}{${bs}pard${g}Pear${bs}par}}`;
    const l = lines(parseRtf(rtf));
    assert.deepEqual(l.slice(0, 2), [`${cells} ,APPLE`, `${cells} ,PE>`], `${glyph}: ${l.join('|')}`);
  }
});
