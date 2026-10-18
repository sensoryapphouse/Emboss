// ODT (LibreOffice) import fixes, 30 Sep 2026 — import fix list #16, #18, #19, #35, #27 (ODT part), #7, #1d, #1c (ODT part),
// #15e and audit finding o01/lo-w02 (small/all caps, script font), the contents list and the document title.
//
// Each test builds a small .odt with the repo's own zip helper (web/zip.mjs), the pattern odt_frames.test.mjs uses, and
// checks the model parseOdt returns against what the Word reader (parseDocx) produces for the same thing:
//   - numbered list items carry `marker` ("1.", "a.", "(i)"), as Word's do (parseDocx listMarker);
//   - sub/superscript runs are bracketed with the format/text-style.mjs SCRIPT_MARKS markers (U+E000 / U+E001 open, U+E002
//     close), and a raised or lowered run of only spaces marks nothing (RUEB 11.4.1);
//   - hidden text and tracked deletions are not transcribed (Word: w:vanish, w:del); insertions stay;
//   - small capitals and all capitals are upper-cased (RUEB 9.6.1, Word's w:smallCaps / w:caps); a script face gets the
//     script typeform (TF_SCRIPT = 8, Word's SCRIPT_FONT_RE);
//   - a picture with no description has no alt text (Word: the auto-generated "Picture 3" name is never the alt text);
//   - "Quotations" is a quotation paragraph (Word's Quote), "Preformatted Text" a code block (Word's Source Code), a
//     paragraph bordered on all four sides a box (Word's w:pBdr), consecutive ones one box;
//   - a contents list is { type: 'list', kind: 'toc' } with item.page (Word's TOC1-9 paragraphs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseOdt, parseFile, BINARY_EXTS } from '../input/parse.mjs';
import { SCRIPT_MARKS as M } from '../format/text-style.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
  + 'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
  + 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" '
  + 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
  + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
const enc = (s) => new TextEncoder().encode(s);
// body: the office:text children; auto: content.xml automatic styles; styles: styles.xml office:styles; meta: office:meta
const odt = ({ body, auto = '', styles = null, meta = null, files = [], fonts = '' }) => {
  const parts = [{ name: 'content.xml', data: enc(`<?xml version="1.0"?><office:document-content ${NS}><office:font-face-decls>${fonts}</office:font-face-decls><office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`) }];
  if (styles !== null) parts.push({ name: 'styles.xml', data: enc(`<?xml version="1.0"?><office:document-styles ${NS}><office:styles>${styles}</office:styles></office:document-styles>`) });
  if (meta !== null) parts.push({ name: 'meta.xml', data: enc(`<?xml version="1.0"?><office:document-meta ${NS}><office:meta>${meta}</office:meta></office:document-meta>`) });
  for (const f of files) parts.push(f);
  return makeZip(parts).arrayBuffer();
};
const read = async (spec) => parseOdt(await odt(spec));
const textOf = (b) => (b.segments ? b.segments.map((s) => s.text || '').join('') : b.text);
const texts = (m) => m.blocks.map((b) => (b.type === 'list' ? b.items.map(textOf).join('|') : textOf(b)));

// ---- list styles ---------------------------------------------------------------------------------------------------
const numLevel = (n, fmt, extra = '') => `<text:list-level-style-number text:level="${n}" style:num-format="${fmt}" ${extra}/>`;
const bulletLevel = (n) => `<text:list-level-style-bullet text:level="${n}" text:bullet-char="•"/>`;
const STD = `<text:list-style style:name="LN">${numLevel(1, '1', 'style:num-suffix="."')}${numLevel(2, 'a', 'style:num-suffix="."')}${numLevel(3, 'i', 'style:num-prefix="(" style:num-suffix=")"')}</text:list-style>`
  + `<text:list-style style:name="LB">${bulletLevel(1)}${bulletLevel(2)}</text:list-style>`;
const li = (t, sub = '', attrs = '') => `<text:list-item${attrs}><text:p>${t}</text:p>${sub}</text:list-item>`;
const ul = (style, items, attrs = '') => `<text:list${style ? ` text:style-name="${style}"` : ''}${attrs}>${items}</text:list>`;
const listItems = (m) => m.blocks.filter((b) => b.type === 'list').flatMap((b) => b.items);

test('#16: a numbered ODT list carries its numbers as markers, nested levels included (Word: "1." "a." "(i)")', async () => {
  const m = await read({ auto: STD, body: ul('LN', li('A', ul('LN', li('a1') + li('a2', ul('LN', li('i1'))))) + li('B') + li('C')) });
  const items = listItems(m);
  assert.deepEqual(items.map((i) => i.marker), ['1.', 'a.', 'b.', '(i)', '2.', '3.']);
  assert.deepEqual(items.map((i) => i.level || 0), [0, 1, 1, 2, 0, 0]);
  assert.deepEqual(items.map((i) => i.text), ['A', 'a1', 'a2', 'i1', 'B', 'C']);
});

test('#16: a bullet list keeps its bullet and a list with no list style stays unmarked (unchanged)', async () => {
  const m = await read({ auto: STD, body: ul('LB', li('x') + li('y', ul('LB', li('z')))) + ul(null, li('plain')) });
  const items = listItems(m);
  assert.deepEqual(items.map((i) => i.marker || null), ['•', '•', '•', null]);
});

test('#16: start values on the level style and on a list item; upper-case letters and roman numerals', async () => {
  const auto = `<text:list-style style:name="S4">${numLevel(1, '1', 'style:num-suffix="." text:start-value="4"')}</text:list-style>`
    + `<text:list-style style:name="SA">${numLevel(1, 'A', 'style:num-suffix="."')}</text:list-style>`
    + `<text:list-style style:name="SR">${numLevel(1, 'I', 'style:num-suffix=")"')}</text:list-style>`;
  const m = await read({ auto, body: ul('S4', li('p') + li('q') + li('r', '', ' text:start-value="10"') + li('s')) + ul('SA', li('a') + li('b')) + ul('SR', li('x') + li('y') + li('z') + li('w')) });
  assert.deepEqual(listItems(m).map((i) => i.marker), ['4.', '5.', '10.', '11.', 'A.', 'B.', 'I)', 'II)', 'III)', 'IV)']);
});

test('#16: continue-numbering and continue-list carry the count on; a plain second list restarts', async () => {
  const body = ul('LN', li('a') + li('b'))
    + '<text:p>between</text:p>'
    + ul('LN', li('c') + li('d'), ' text:continue-numbering="true"')
    + '<text:p>between</text:p>'
    + ul('LN', li('e'))
    + ul('LN', li('f') + li('g'), ' xml:id="L1"')
    + '<text:p>between</text:p>'
    + ul('LN', li('h'), ' text:continue-list="L1"');
  const m = await read({ auto: STD, body });
  assert.deepEqual(listItems(m).map((i) => i.marker), ['1.', '2.', '3.', '4.', '1.', '1.', '2.', '3.']);
});

test('#16: display-levels 2 shows both numbers ("1.1.", Word lvlText "%1.%2."); a label the save cannot carry as a marker is item text', async () => {
  const auto = `<text:list-style style:name="LD">${numLevel(1, '1', 'style:num-suffix="."')}${numLevel(2, '1', 'style:num-suffix="." text:display-levels="2"')}</text:list-style>`;
  const m = await read({ auto, body: ul('LD', li('a', ul('LD', li('a1') + li('a2'))) + li('b', ul('LD', li('b1')))) });
  // "1.1." is not a marker the NIMAS save and re-open can carry (a save would bring back "1." and the text), so, like a
  // numbered Word heading's number, it is written into the item's text: saved and brailled as printed.
  assert.deepEqual(listItems(m).map((i) => i.marker || null), ['1.', null, null, '2.', null]);
  assert.deepEqual(listItems(m).map((i) => i.text), ['a', '1.1. a1', '1.2. a2', 'b', '2.1. b1']);
});

test('#16: a label such as "Section A:" or "(1)" — prefix and suffix from the list style', async () => {
  const auto = `<text:list-style style:name="LS">${numLevel(1, 'A', 'style:num-prefix="Section " style:num-suffix=":"')}</text:list-style>`
    + `<text:list-style style:name="LP">${numLevel(1, '1', 'style:num-prefix="(" style:num-suffix=")"')}</text:list-style>`;
  const m = await read({ auto, body: ul('LS', li('Prelims') + li('Terms')) + ul('LP', li('x') + li('y')) });
  assert.deepEqual(listItems(m).map((i) => i.text), ['Section A: Prelims', 'Section B: Terms', 'x', 'y']);
  assert.deepEqual(listItems(m).map((i) => i.marker || null), [null, null, '(1)', '(2)']);
});

test('#16: a list style in styles.xml, and a list with no style-name whose paragraph style names the list style', async () => {
  const styles = `<text:list-style style:name="Numbering_20_123">${numLevel(1, '1', 'style:num-suffix="."')}</text:list-style>`
    + '<style:style style:name="PL" style:family="paragraph" style:list-style-name="Numbering_20_123"/>';
  const m = await read({ styles, body: ul('Numbering_20_123', li('a') + li('b')) + '<text:list><text:list-item><text:p text:style-name="PL">c</text:p></text:list-item><text:list-item><text:p text:style-name="PL">d</text:p></text:list-item></text:list>' });
  assert.deepEqual(listItems(m).map((i) => i.marker), ['1.', '2.', '1.', '2.']);
});

test('#7: a list header keeps its text, as an unnumbered item that is not counted', async () => {
  const body = `<text:list text:style-name="LN"><text:list-header><text:p>The heading</text:p></text:list-header>${li('one')}${li('two')}</text:list>`;
  const items = listItems(await read({ auto: STD, body }));
  assert.deepEqual(items.map((i) => i.text), ['The heading', 'one', 'two']);
  assert.deepEqual(items.map((i) => i.marker || null), [null, '1.', '2.']);
});

test('#16: an empty numbered item still counts (print shows its number); an item holding only a sub-list does not', async () => {
  const body = ul('LN', li('one') + '<text:list-item><text:p/></text:list-item>' + li('three') + `<text:list-item>${ul('LN', li('sub'))}</text:list-item>` + li('four'));
  const items = listItems(await read({ auto: STD, body }));
  assert.deepEqual(items.map((i) => [i.text, i.marker]), [['one', '1.'], ['three', '3.'], ['sub', 'a.'], ['four', '4.']]);
});

// ---- sub / superscript ---------------------------------------------------------------------------------------------
const SCRIPT_AUTO = '<style:style style:name="Tsub" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>'
  + '<style:style style:name="Tsup" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>'
  + '<style:style style:name="Tpos" style:family="text"><style:text-properties style:text-position="33% 58%"/></style:style>'
  + '<style:style style:name="Tneg" style:family="text"><style:text-properties style:text-position="-25% 58%"/></style:style>'
  + '<style:style style:name="Tbase" style:family="text"><style:text-properties style:text-position="0% 100%"/></style:style>'
  + '<style:style style:name="Tsubb" style:family="text"><style:text-properties style:text-position="sub 58%" fo:font-weight="bold"/></style:style>'
  + '<style:style style:name="Tchild" style:family="text" style:parent-style-name="Tsup"/>';
const span = (s, t) => `<text:span text:style-name="${s}">${t}</text:span>`;

test('#18: style:text-position sub/super/percentages become the Word sub/superscript markers', async () => {
  const m = await read({ auto: SCRIPT_AUTO, body: `<text:p>H${span('Tsub', '2')}O and x${span('Tsup', '2')} and y${span('Tpos', '3')} and z${span('Tneg', 'n')} and w${span('Tbase', '0')} and c${span('Tchild', '4')}</text:p>` });
  assert.equal(m.blocks[0].text, `H${M.subOpen}2${M.end}O and x${M.supOpen}2${M.end} and y${M.supOpen}3${M.end} and z${M.subOpen}n${M.end} and w0 and c${M.supOpen}4${M.end}`);
  assert.equal(textOf(m.blocks[0]), m.blocks[0].text, 'the segments carry the same markers');
});

test('#18: adjacent runs of the same level share one marker pair; a raised or lowered space marks nothing', async () => {
  const m = await read({ auto: SCRIPT_AUTO, body: `<text:p>mass${span('Tsub', 'su')}${span('Tsubb', 'n')} guidance${span('Tsup', ' ')}next</text:p>` });
  assert.equal(m.blocks[0].text, `mass${M.subOpen}sun${M.end} guidance next`);
});

test('#18: sub/superscript inside a heading, a list item and a table cell', async () => {
  const body = `<text:h text:outline-level="1">CO${span('Tsub', '2')} levels</text:h>`
    + ul('LN', li(`x${span('Tsup', '2')}`))
    + `<table:table><table:table-column/><table:table-column/><table:table-row><table:table-cell><text:p>a${span('Tsub', '1')}</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>`;
  const m = await read({ auto: SCRIPT_AUTO + STD, body });
  assert.equal(m.blocks[0].text, `CO${M.subOpen}2${M.end} levels`);
  assert.equal(listItems(m)[0].text, `x${M.supOpen}2${M.end}`);
  const cell = m.blocks.find((b) => b.type === 'table').rows[0][0];
  assert.match(typeof cell === 'string' ? cell : JSON.stringify(cell), new RegExp(`a[\\s\\S]*${M.subOpen}`.replace(/[-]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)));
});

// ---- hidden text and tracked changes -------------------------------------------------------------------------------
const HID_AUTO = '<style:style style:name="Thid" style:family="text"><style:text-properties text:display="none"/></style:style>'
  + '<style:style style:name="Phid" style:family="paragraph"><style:text-properties text:display="none"/></style:style>'
  + '<style:style style:name="Phid2" style:family="paragraph" style:parent-style-name="Phid"/>';

test('#19: text hidden by its style, by a hidden-text field or by a hidden-paragraph field is not transcribed', async () => {
  const body = `<text:p>before ${span('Thid', 'secret1')} after</text:p>`
    + '<text:p text:style-name="Phid">secret2 whole paragraph</text:p>'
    + '<text:p text:style-name="Phid2">secret3 derived</text:p>'
    + '<text:p>keep <text:hidden-text text:condition="ooow:" text:string-value="secret4" text:is-hidden="true"/>this</text:p>'
    + '<text:p>shown <text:hidden-text text:condition="ooow:" text:string-value="visible5" text:is-hidden="false">visible5</text:hidden-text> here</text:p>'
    + '<text:p>secret6 <text:hidden-paragraph text:condition="true" text:is-hidden="true"/></text:p>'
    + '<text:p>last</text:p>';
  const m = await read({ auto: HID_AUTO, body });
  const all = texts(m).join(' | ');
  assert.doesNotMatch(all, /secret/);
  assert.deepEqual(texts(m), ['before after', 'keep this', 'shown visible5 here', 'last']);
});

test('#19: hidden text in a list item and a table cell is not transcribed either', async () => {
  const body = ul('LN', li(`keep ${span('Thid', 'secret1')}`) + `<text:list-item><text:p text:style-name="Phid">secret2</text:p></text:list-item>`)
    + `<table:table><table:table-column/><table:table-row><table:table-cell><text:p>cell ${span('Thid', 'secret3')}</text:p></table:table-cell></table:table-row></table:table>`;
  const m = await read({ auto: HID_AUTO + STD, body });
  assert.doesNotMatch(JSON.stringify(m.blocks), /secret/);
  assert.equal(listItems(m).length, 1);
});

const TRACKED = '<text:tracked-changes text:track-changes="true">'
  + '<text:changed-region text:id="del1"><text:deletion><office:change-info><dc:creator>Ed</dc:creator></office:change-info><text:p text:style-name="Standard">deletedtext1</text:p></text:deletion></text:changed-region>'
  + '<text:changed-region text:id="ins1"><text:insertion><office:change-info><dc:creator>Ed</dc:creator></office:change-info></text:insertion></text:changed-region>'
  + '<text:changed-region text:id="del2"><text:deletion><office:change-info><dc:creator>Ed</dc:creator></office:change-info><text:p>deletedtext2</text:p></text:deletion></text:changed-region>'
  + '</text:tracked-changes>';

test('#19: tracked deletions are not transcribed (their text sits in text:tracked-changes); insertions stay', async () => {
  const body = TRACKED + '<text:p>Some <text:change text:change-id="del1"/> text <text:change-start text:change-id="ins1"/>inserted words<text:change-end text:change-id="ins1"/> end.</text:p>';
  const m = await read({ body });
  assert.deepEqual(texts(m), ['Some text inserted words end.']);
});

test('#19: a deletion written as a change-start / change-end range hides what is inside it, across paragraphs too', async () => {
  const body = TRACKED + '<text:p>one <text:change-start text:change-id="del2"/>gone1 gone2</text:p><text:p>gone3<text:change-end text:change-id="del2"/> two</text:p><text:p>three <text:change-start text:change-id="ins1"/>kept<text:change-end text:change-id="ins1"/></text:p>';
  const m = await read({ body });
  assert.deepEqual(texts(m), ['one', 'two', 'three kept']);
});

// ---- small capitals, all capitals, script fonts ---------------------------------------------------------------------
const CAPS_AUTO = '<style:style style:name="Tsc" style:family="text"><style:text-properties fo:font-variant="small-caps"/></style:style>'
  + '<style:style style:name="Tup" style:family="text"><style:text-properties fo:text-transform="uppercase"/></style:style>'
  + '<style:style style:name="Tlow" style:family="text"><style:text-properties fo:text-transform="lowercase"/></style:style>'
  + '<style:style style:name="Pcaps" style:family="paragraph"><style:text-properties fo:text-transform="uppercase"/></style:style>'
  + '<style:style style:name="Tscr" style:family="text"><style:text-properties style:font-name="Brush Script MT"/></style:style>'
  + '<style:style style:name="Tdecl" style:family="text"><style:text-properties style:font-name="Fancy"/></style:style>'
  + '<style:style style:name="Tplain" style:family="text"><style:text-properties style:font-name="Liberation Serif"/></style:style>';

test('audit o01/lo-w02: small capitals and all capitals are upper-cased (RUEB 9.6.1), in the text and the segments', async () => {
  const m = await read({ auto: CAPS_AUTO, body: `<text:p>a ${span('Tsc', 'smallcap')} b ${span('Tup', 'allcap')} c ${span('Tlow', 'Low')}</text:p><text:p text:style-name="Pcaps">whole para</text:p>` });
  assert.equal(m.blocks[0].text, 'a SMALLCAP b ALLCAP c Low');
  assert.equal(textOf(m.blocks[0]), 'a SMALLCAP b ALLCAP c Low');
  assert.equal(m.blocks[1].text, 'WHOLE PARA');
});

test('audit o01: a script or handwriting font gets the script typeform (Word SCRIPT_FONT_RE), a plain font does not', async () => {
  const fonts = '<style:font-face style:name="Fancy" svg:font-family="&apos;Lucida Handwriting&apos;"/>';
  const m = await read({ auto: CAPS_AUTO, fonts, body: `<text:p>a ${span('Tscr', 'scripty')} ${span('Tdecl', 'fancy')} ${span('Tplain', 'plain')}</text:p>` });
  const seg = (t) => m.blocks[0].segments.find((s) => s.text.includes(t));
  assert.equal(seg('scripty').tf & 8, 8);
  assert.equal(seg('fancy').tf & 8, 8, 'a font declared with svg:font-family "Lucida Handwriting"');
  assert.ok(!(seg('plain').tf & 8));
});

// ---- pictures --------------------------------------------------------------------------------------------------------
const png = { name: 'Pictures/p1.png', data: new Uint8Array([137, 80, 78, 71]) };
const frame = (name, inner) => `<draw:frame draw:name="${name}" text:anchor-type="as-char"><draw:image xlink:href="Pictures/p1.png" xlink:type="simple"/>${inner}</draw:frame>`;

test('#35: a picture with no description has no alt text — the frame name (Image2) is not a description', async () => {
  const m = await parseOdt(await odt({ body: `<text:p>${frame('Image2', '')}</text:p><text:p>${frame('graphics1', '<svg:desc>A dog on a hill</svg:desc>')}</text:p><text:p>${frame('Image3', '<svg:title>The cat</svg:title>')}</text:p>`, files: [png] }));
  const g = m.blocks.filter((b) => b.type === 'graphic');
  assert.equal(g.length, 3);
  assert.equal(g[0].alt, '');
  assert.ok(!g[0].description);
  assert.equal(g[1].alt || '', '');
  assert.equal(g[1].description, 'A dog on a hill');
  assert.equal(g[2].alt, 'The cat');
});

// ---- quotations, preformatted text, bordered paragraphs ---------------------------------------------------------------
const PSTYLES = '<style:style style:name="Quotations" style:family="paragraph"/>'
  + '<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph"/>'
  + '<style:style style:name="Text_20_body" style:family="paragraph"/>';
const PAUTO = '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Quotations"><style:paragraph-properties fo:margin-left="0.5in"/></style:style>'
  + '<style:style style:name="P2" style:family="paragraph" style:parent-style-name="Preformatted_20_Text"/>'
  + '<style:style style:name="Pbox" style:family="paragraph" style:parent-style-name="Text_20_body"><style:paragraph-properties fo:border="0.06pt solid #000000" fo:padding="0.1cm"/></style:style>'
  + '<style:style style:name="Pbox2" style:family="paragraph"><style:paragraph-properties fo:border="1pt dashed #ff0000"/></style:style>'
  + '<style:style style:name="Pline" style:family="paragraph"><style:paragraph-properties fo:border-bottom="0.5pt solid #000000"/></style:style>'
  + '<style:style style:name="Pnone" style:family="paragraph"><style:paragraph-properties fo:border="none"/></style:style>'
  + '<style:style style:name="Pfill" style:family="paragraph" style:parent-style-name="Pbox"><style:paragraph-properties fo:background-color="#ffff00"/></style:style>';

test('#27: the Quotations paragraph style (and styles based on it) is a block quotation, like Word\'s Quote', async () => {
  const m = await read({ styles: PSTYLES, auto: PAUTO, body: '<text:p text:style-name="Text_20_body">plain</text:p><text:p text:style-name="Quotations">quoted one</text:p><text:p text:style-name="P1">quoted two</text:p>' });
  assert.deepEqual(m.blocks.map((b) => b.style || null), [null, 'quote', 'quote']);
  assert.deepEqual(m.blocks.map(textOf), ['plain', 'quoted one', 'quoted two']);
});

test('#27: Preformatted Text is a code block, consecutive paragraphs one block, indentation and blank lines kept', async () => {
  const body = '<text:p text:style-name="Text_20_body">before</text:p>'
    + '<text:p text:style-name="P2">void main() {</text:p>'
    + '<text:p text:style-name="P2"><text:s text:c="4"/>printf("hi");</text:p>'
    + '<text:p text:style-name="P2"/>'
    + '<text:p text:style-name="Preformatted_20_Text">}</text:p>'
    + '<text:p text:style-name="Text_20_body">after</text:p>';
  const m = await read({ styles: PSTYLES, auto: PAUTO, body });
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'code', 'para']);
  assert.equal(m.blocks[1].text, 'void main() {\n    printf("hi");\n\n}');
});

test('#27: paragraphs bordered on all four sides are a box, consecutive ones with the same border one box (Word w:pBdr)', async () => {
  const body = '<text:p text:style-name="Text_20_body">outside</text:p>'
    + '<text:p text:style-name="Pbox">boxed one</text:p><text:p text:style-name="Pbox">boxed two</text:p>'
    + '<text:p text:style-name="Text_20_body">between</text:p>'
    + '<text:p text:style-name="Pbox">other box</text:p><text:p text:style-name="Pbox2">different border</text:p>'
    + '<text:p text:style-name="Pline">rule only</text:p><text:p text:style-name="Pnone">no border</text:p>';
  const m = await read({ styles: PSTYLES, auto: PAUTO, body });
  assert.deepEqual(m.blocks.map((b) => b.type), ['para', 'box', 'para', 'box', 'box', 'para', 'para']);
  assert.deepEqual(m.blocks[1].blocks.map(textOf), ['boxed one', 'boxed two']);
  assert.deepEqual(m.blocks[3].blocks.map(textOf), ['other box']);
  assert.deepEqual(m.blocks[4].blocks.map(textOf), ['different border']);
  assert.deepEqual(m.blocks.slice(5).map(textOf), ['rule only', 'no border'], 'a bottom rule alone, or no border, is not a box');
});

test('#27: a filled box keeps its colour; alignment stays ignored (Paul\'s IMP-W8)', async () => {
  const m = await read({ styles: PSTYLES, auto: PAUTO, body: '<text:p text:style-name="Pfill">yellow box</text:p>' });
  assert.equal(m.blocks[0].type, 'box');
  assert.ok(m.blocks[0].boxColor, 'the fill colour is named');
});

// ---- tables ------------------------------------------------------------------------------------------------------------
const tc = (t) => `<table:table-cell><text:p>${t}</text:p></table:table-cell>`;
const cols = (n) => `<table:table-column table:number-columns-repeated="${n}"/>`;
const tr = (...c) => `<table:table-row>${c.join('')}</table:table-row>`;

test('#1d: row groups, table-rows and header rows are all read', async () => {
  const body = `<table:table>${cols(2)}<table:table-header-rows>${tr(tc('H1'), tc('H2'))}</table:table-header-rows>`
    + `<table:table-row-group>${tr(tc('a'), tc('b'))}<table:table-row-group>${tr(tc('c'), tc('d'))}</table:table-row-group></table:table-row-group>`
    + `<table:table-rows>${tr(tc('e'), tc('f'))}</table:table-rows>${tr(tc('g'), tc('h'))}</table:table>`;
  const t = (await read({ body })).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.headers, ['H1', 'H2']);
  assert.deepEqual(t.rows, [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
});

test('#1d: repeated cells and rows are expanded; a huge repeat of empty cells or rows does not explode the table', async () => {
  const empty = (n) => `<table:table-cell table:number-columns-repeated="${n}"/>`;
  const body = `<table:table>${cols(4)}`
    + `<table:table-row><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell>${tc('y')}${empty(1021)}</table:table-row>`
    + `<table:table-row table:number-rows-repeated="2">${tc('r')}${empty(2)}${tc('s')}</table:table-row>`
    + `<table:table-row table:number-rows-repeated="1048570">${empty(1024)}</table:table-row></table:table>`;
  const t = (await read({ body })).blocks.find((b) => b.type === 'table');
  assert.deepEqual(t.rows, [['x', 'x', 'y', ''], ['r', '', '', 's'], ['r', '', '', 's']]);
});

// ---- notes --------------------------------------------------------------------------------------------------------------
test('#1c: a list or a table inside a note body keeps its text (as paragraphs)', async () => {
  const note = '<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body>'
    + '<text:p>Note intro</text:p>'
    + '<text:list><text:list-item><text:p>list item one</text:p></text:list-item><text:list-item><text:p>list item two</text:p></text:list-item></text:list>'
    + '<table:table><table:table-column/><table:table-row><table:table-cell><text:p>cell one</text:p></table:table-cell><table:table-cell><text:p>cell two</text:p></table:table-cell></table:table-row></table:table>'
    + '<text:p>Note outro</text:p></text:note-body></text:note>';
  const m = await read({ body: `<text:p>Body text${note} more.</text:p>` });
  const fn = m.blocks.find((b) => b.type === 'footnote');
  const all = JSON.stringify(fn);
  for (const w of ['Note intro', 'list item one', 'list item two', 'cell one', 'cell two', 'Note outro']) assert.ok(all.includes(w), w);
});

// ---- .fodt and .ott -----------------------------------------------------------------------------------------------------
const FLAT = (body, auto = '') => `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">`
  + `<office:meta><dc:title>Flat title</dc:title></office:meta><office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document>`;

test('#15e: a flat XML ODT (.fodt) is read as an ODT — styles, numbered lists and all — not as plain text', async () => {
  const m = await parseFile('letter.fodt', FLAT(`<text:h text:outline-level="1">Heading</text:h>${ul('LN', li('one') + li('two'))}<text:p>H${span('Tsub', '2')}O</text:p>`, STD + SCRIPT_AUTO));
  assert.equal(m.blocks[0].type, 'heading');
  assert.deepEqual(listItems(m).map((i) => i.marker), ['1.', '2.']);
  assert.equal(m.blocks[2].text, `H${M.subOpen}2${M.end}O`);
  assert.equal(m.title, 'Flat title');
});

test('#15e: a flat XML ODT picture (base64 office:binary-data) becomes a graphic with its bytes', async () => {
  const b64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');
  const m = await parseFile('pic.fodt', FLAT(`<text:p><draw:frame draw:name="Image1"><draw:image><office:binary-data>${b64}</office:binary-data></draw:image><svg:desc>A tiny picture</svg:desc></draw:frame></text:p>`));
  const g = m.blocks.find((b) => b.type === 'graphic');
  assert.ok(g, 'the picture is a graphic block');
  assert.equal(g.description, 'A tiny picture');
  const res = (m.resources || []).find((r) => r.path === g.src);
  assert.ok(res && res.bytes.length === 10 && res.mime === 'image/png');
});

test('#15e: an ODT template (.ott) is a zipped ODT and is read as one (and as bytes)', async () => {
  assert.ok(BINARY_EXTS.has('ott'));
  const m = await parseFile('template.ott', await odt({ auto: STD, body: ul('LN', li('one')) }));
  assert.deepEqual(listItems(m).map((i) => i.marker), ['1.']);
});

// ---- contents list -------------------------------------------------------------------------------------------------------
test('contents: a text:table-of-content is a contents list with page numbers; the "Contents" title is not an entry', async () => {
  const toc = '<text:table-of-content text:name="Contents1"><text:table-of-content-source text:outline-level="3"/><text:index-body>'
    + '<text:index-title text:name="Contents1_Head"><text:p text:style-name="Contents_20_Heading">Contents</text:p></text:index-title>'
    + '<text:p text:style-name="Contents_20_1"><text:a xlink:href="#a1">Introduction<text:tab/>3</text:a></text:p>'
    + '<text:p text:style-name="Contents_20_2"><text:a xlink:href="#a2"><text:span>1.1</text:span><text:tab/>Background<text:tab/>5</text:a></text:p>'
    + '<text:p text:style-name="Contents_20_1"><text:a xlink:href="#a3">Appendix</text:a></text:p>'
    + '</text:index-body></text:table-of-content>';
  const m = await read({ body: toc + '<text:h text:outline-level="1">Introduction</text:h>' });
  const list = m.blocks.find((b) => b.type === 'list');
  assert.equal(list.kind, 'toc');
  assert.deepEqual(list.items.map((i) => [i.text, i.page || null, i.level || 0]), [['Introduction', '3', 0], ['1.1 Background', '5', 1], ['Appendix', null, 0]]);
  assert.ok(!list.items.some((i) => /^Contents$/.test(i.text)));
  const titlePara = m.blocks.find((b) => b.type === 'para' && textOf(b) === 'Contents');
  assert.ok(titlePara, 'the title is kept as an ordinary paragraph, not dropped');
});

// ---- document title -----------------------------------------------------------------------------------------------------
test('title: the first Title paragraph wins; meta.xml dc:title is only the fallback (Word: body title, then core.xml title)', async () => {
  const styles = '<style:style style:name="Title" style:family="paragraph"/>';
  const withTitle = await read({ styles, meta: '<dc:title>Meta title</dc:title><meta:initial-creator>An Author</meta:initial-creator>', body: '<text:p text:style-name="Title">Body title</text:p><text:p>text</text:p>' });
  assert.equal(withTitle.title, 'Body title');
  const noTitle = await read({ styles, meta: '<dc:title>Meta title</dc:title><meta:initial-creator>An Author</meta:initial-creator>', body: '<text:p>text</text:p>' });
  assert.equal(noTitle.title, 'Meta title');
  assert.equal(noTitle.metadata && noTitle.metadata.creator, 'An Author');
  assert.equal(noTitle.blocks.length, 1, 'the fallback title adds no block');
});

// Found in the merge review (30 Sep): widening the printed-number pattern to "(1) " let a numbered DTBook item whose
// content STARTS WITH MATHS — "(100) • (…)" in tests/nimas_samples/9781946636171NIMAS.xml — be numbered "(100)"
// instead of "1.". The printed number is now looked for only in the item's leading text, never inside an equation.
test('a numbered DTBook item that starts with an equation keeps its own number (not the equation\'s "(100)")', async () => {
  const { parseDtbook } = await import('../input/parse.mjs');
  const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><book><bodymatter><level1><h1>T</h1>
<list type="ol"><li><m:math><m:mo>(</m:mo><m:mn>100</m:mn><m:mo>)</m:mo><m:mo>•</m:mo><m:mo>(</m:mo><m:mn>3</m:mn><m:mo>)</m:mo></m:math></li><li>Plain second item</li><li>(c) Printed marker kept</li></list></level1></bodymatter></book></dtbook>`;
  const list = parseDtbook(xml).blocks.find((b) => b.type === 'list');
  assert.equal(list.items[0].marker, '1.');
  assert.equal(list.items[1].marker, '2.');
  assert.equal(list.items[2].marker, '(c)');
});

// Found in the merge review (30 Sep): with .fodt support, a corrupt or mis-named .odt (not a zip, not OpenDocument XML)
// was read as plain text instead of being reported (test-editor-leftovers.mjs "non-hard failure").
test('a file that is neither a zip nor flat OpenDocument XML is reported, not read as text', async () => {
  const junk = new Uint8Array(64).fill(0x2a).buffer;
  await assert.rejects(() => parseOdt(junk), /not an OpenDocument file/);
});
