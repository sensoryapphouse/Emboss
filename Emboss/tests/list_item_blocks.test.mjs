// List items with more than one paragraph, or with a table inside them (25 Sep 2026).
//
// Model: a list item may carry `blocks: [...]` -- its further content after its first paragraph (more paragraphs, a
// table, a code block ...), in print order, before its sub-items (which stay flat, level-tagged items). An item with no
// `blocks` is unchanged.
//
// Braille: BANA Formats §10.3.3 "Begin additional paragraphs two cells to the right of the runover position" (the same
// rule as §16.3d for notes, 1-3 then 5-3, and §11.18f for column entries). A table inside an item is formatted as any
// table (§11.2.5a cell 1, §11.2.5d a blank line before and after) and the list goes on after it. UKAAF B004 has no rule
// of its own; the same shape (1/3 -> 5/3) keeps a further paragraph apart from both a new item and a runover.
//
// Covered: every reader (DOCX, HTML/EPUB, ODT, DTBook/NIMAS, Markdown), the braille margins (BANA and UKAAF, nested,
// the B004 compact style), a table inside an item, formatBlock/traceBlock parity (A39), the NIMAS round trip and the
// cache key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseDocx, parseHtml, parseOdt, parseDtbook, parseMarkdown } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock, getBlockSignature } from '../format/document.mjs';
import { makeZip } from '../web/zip.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const up = (s) => String(s).toUpperCase();
const opts = (mode, width = 30, extra = {}) => ({ mode, width, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), ...extra });
const TABLE = { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] };
const lists = (m) => m.blocks.filter((b) => b.type === 'list');

// ---------------------------------------------------------------- readers

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NUMBERING = `<?xml version="1.0"?><w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const docx = async (body) => {
  const xml = `<?xml version="1.0"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`;
  const blob = makeZip([
    { name: 'word/numbering.xml', text: NUMBERING },
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: 'word/document.xml', text: xml },
  ]);
  return parseDocx(await blob.arrayBuffer());
};
const wItem = (t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const wCont = (t) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="720"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const wPara = (t, ind = '') => `<w:p>${ind ? `<w:pPr><w:ind w:left="${ind}"/></w:pPr>` : ''}<w:r><w:t>${t}</w:t></w:r></w:p>`;
const wCell = (t, bold) => `<w:tc><w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${t}</w:t></w:r></w:p></w:tc>`;
const wTable = (ind) => `<w:tbl><w:tblPr>${ind ? `<w:tblInd w:w="${ind}" w:type="dxa"/>` : ''}</w:tblPr>`
  + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${wCell('Year', true)}${wCell('Total', true)}</w:tr>`
  + `<w:tr>${wCell('2019')}${wCell('14')}</w:tr><w:tr>${wCell('2020')}${wCell('17')}</w:tr><w:tr>${wCell('2021')}${wCell('23')}</w:tr></w:tbl>`;

test('DOCX: a ListParagraph with no numbering after a numbered item is that item\'s further paragraph', async () => {
  const m = await docx(wItem('Item one.') + wCont('Its second paragraph.') + wItem('Item two.'));
  assert.equal(lists(m).length, 1);
  const [a, b] = lists(m)[0].items;
  assert.equal(a.text, 'Item one.');
  assert.deepEqual(a.blocks, [{ type: 'para', text: 'Its second paragraph.' }]);
  assert.equal(b.text, 'Item two.');
  assert.equal(b.marker, '2.');
});

test('DOCX: an indented plain paragraph continues the item; a paragraph at the margin ends the list', async () => {
  const m = await docx(wItem('Item one.') + wPara('Indented follow-on.', '720') + wPara('Body text.') + wItem('Item two.'));
  const [first] = lists(m);
  assert.deepEqual(first.items[0].blocks, [{ type: 'para', text: 'Indented follow-on.' }]);
  assert.deepEqual(m.blocks.map((b) => b.type), ['list', 'para', 'list']);
});

test('DOCX: an indented table between two items of the list is inside the first item; the list goes on', async () => {
  const m = await docx(wItem('Item with a table:') + wTable(720) + wItem('Next item.'));
  assert.deepEqual(m.blocks.map((b) => b.type), ['list']);
  const [a, b] = m.blocks[0].items;
  assert.equal(a.blocks.length, 1);
  assert.equal(a.blocks[0].type, 'table');
  assert.equal(b.text, 'Next item.');
  assert.equal(b.marker, '2.');
  // a table at the margin still ends the list (numbering goes on)
  const m2 = await docx(wItem('Item.') + wTable(0) + wItem('Next item.'));
  assert.deepEqual(m2.blocks.map((x) => x.type), ['list', 'table', 'list']);
  assert.equal(m2.blocks[0].items[0].blocks, undefined);
  assert.equal(m2.blocks[2].items[0].marker, '2.');
});

test('HTML/EPUB: <li> with several <p>, a table and a <pre>', () => {
  const m = parseHtml('<ol><li><p>First para.</p><p>Second <em>para</em>.</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></li><li>Intro<pre>code here</pre></li><li><p>Only one.</p></li></ol>');
  const [l] = lists(m);
  assert.equal(l.items.length, 3);
  const [a, b, c] = l.items;
  assert.equal(a.text, 'First para.');
  assert.equal(a.blocks.length, 2);
  assert.equal(a.blocks[0].type, 'para');
  assert.deepEqual(a.blocks[0].segments.map((s) => s.text), ['Second ', 'para', '.']);
  assert.equal(a.blocks[1].type, 'table');
  assert.equal(b.text, 'Intro');
  assert.deepEqual(b.blocks, [{ type: 'code', text: 'code here' }]);
  assert.equal(c.text, 'Only one.');
  assert.equal(c.blocks, undefined);
  assert.equal(m.blocks.length, 1, 'no table or paragraph split out of the list');
});

const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
test('ODT: <text:list-item> with several <text:p>', async () => {
  const content = `<?xml version="1.0"?><office:document-content ${ODT_NS}><office:body><office:text><text:list><text:list-item><text:p>First.</text:p><text:p>Its second paragraph.</text:p></text:list-item><text:list-item><text:p>Second.</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`;
  const m = await parseOdt(await makeZip([{ name: 'content.xml', text: content }]).arrayBuffer());
  const [l] = lists(m);
  assert.deepEqual(l.items.map((i) => i.text), ['First.', 'Second.']);
  assert.deepEqual(l.items[0].blocks, [{ type: 'para', text: 'Its second paragraph.' }]);
});

const dtb = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>T</h1>${body}</level1></bodymatter></book></dtbook>`);
const DTB_LIST = '<list type="ol"><li><p>First <em>para</em>.</p><p>Second para.</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></li><li>Second item.</li></list>';
test('DTBook/NIMAS: <li> with <p>s and a <table> keeps them as the item\'s blocks, the list unbroken', () => {
  const m = dtb(DTB_LIST);
  assert.deepEqual(m.blocks.map((b) => b.type), ['heading', 'list']);
  const [a, b] = m.blocks[1].items;
  assert.equal(a.text, 'First para.');
  assert.equal(a.blocks.length, 2);
  assert.deepEqual(a.blocks[0], { type: 'para', text: 'Second para.' });
  assert.equal(a.blocks[1].type, 'table');
  assert.equal(b.marker, '2.');
});

test('Markdown: an indented paragraph after a blank line is the item\'s further paragraph', () => {
  const m = parseMarkdown('1. First item\n\n   Its second *paragraph*\n   wraps here.\n\n2. Second item\n\nAfter the list.');
  assert.deepEqual(m.blocks.map((b) => b.type), ['list', 'para']);
  const [a, b] = m.blocks[0].items;
  assert.equal(a.blocks.length, 1);
  assert.deepEqual(a.blocks[0].segments.map((s) => s.text), ['Its second ', 'paragraph', ' wraps here.']);
  assert.equal(b.text, 'Second item');
  // 30 Sep 2026 (Markdown import fix list #28; Paul's brief: "loose lists stay ONE list"; CommonMark 5.3: a blank line between items makes
  // a loose list, not two lists; docs/expectation-changes.md). It was 2 lists, the second starting its numbering again.
  assert.equal(lists(parseMarkdown('- a\n- b\n\n- c')).length, 1);
  assert.equal(lists(parseMarkdown('- a\n- b\n\n- c'))[0].items.length, 3);
});

// ---------------------------------------------------------------- braille

const LIST = { type: 'list', ordered: true, items: [
  { text: 'first item text that runs over a line', marker: '1.', blocks: [{ type: 'para', text: 'second paragraph of the first item runs over' }] },
  { text: 'second', marker: '2.' }] };

test('BANA §10.3.3: a further paragraph starts two cells right of the runover (1-3 item -> 5-3)', () => {
  assert.deepEqual(formatBlock(LIST, opts('bana')), [
    '',
    '1. FIRST ITEM TEXT THAT RUNS',
    '  OVER A LINE',
    '    SECOND PARAGRAPH OF THE',
    '  FIRST ITEM RUNS OVER',
    '2. SECOND',
    '',
  ]);
});

test('BANA nested list: runover cell 5, a further paragraph of a sub-item at 7-5 (Example 10-3)', () => {
  const nested = { type: 'list', items: [{ text: 'main', marker: 'A.' }, { text: 'sub item', marker: '1.', level: 1, blocks: [{ type: 'para', text: 'more about the sub item here' }] }] };
  assert.deepEqual(formatBlock(nested, opts('bana')), ['', 'A. MAIN', '  1. SUB ITEM', '      MORE ABOUT THE SUB ITEM', '    HERE', '']);
});

// UK-5 (28 Sep, James / decisions.md "UKAAF"): 'compact' is now the UKAAF default listStyle, so the
// "1/3" case below needs an explicit `listStyle: 'spaced'` to keep exercising the style it names.
test('UKAAF: 1/3 list -> a further paragraph at 5/3; the B004 compact style keeps the item\'s margins', () => {
  assert.deepEqual(formatBlock(LIST, opts('ukaaf', 30, { listStyle: 'spaced' })), [
    '',
    '1. FIRST ITEM TEXT THAT RUNS',
    '  OVER A LINE',
    '    SECOND PARAGRAPH OF THE',
    '  FIRST ITEM RUNS OVER',
    '2. SECOND',
    '',
  ]);
  // 28 Sep: compact keeps the item's print marker (numbers are content; UK-5 made compact the UKAAF default).
  assert.deepEqual(formatBlock(LIST, opts('ukaaf', 30, { listStyle: 'compact' })), [
    '    1. FIRST ITEM TEXT THAT',
    'RUNS OVER A LINE',
    '    SECOND PARAGRAPH OF THE',
    'FIRST ITEM RUNS OVER',
    '    2. SECOND',
  ]);
});

test('a table inside an item: blank line, the table from cell 1, blank line, then the next item (BANA §11.2.5)', () => {
  const l = { type: 'list', items: [{ text: 'see the table', marker: '1.', blocks: [TABLE] }, { text: 'next', marker: '2.' }] };
  const table = formatBlock(TABLE, opts('bana')).filter((x) => x !== '');
  assert.deepEqual(formatBlock(l, opts('bana')), ['', '1. SEE THE TABLE', '', ...table, '', '2. NEXT', '']);
  // the item's table last in the list: one blank line after it, not two
  const endsInTable = { type: 'list', items: [{ text: 'x', marker: '1.', blocks: [TABLE] }] };
  const out = formatBlock(endsInTable, opts('bana'));
  assert.notEqual(out[out.length - 2], '');
  assert.equal(out[out.length - 1], '');
});

test('A39: traceBlock gives the same lines as formatBlock, and each further paragraph is its own unit', () => {
  const l = { type: 'list', items: [
    { text: 'one', marker: '1.', blocks: [{ type: 'para', text: 'one more' }, TABLE, { type: 'para', segments: [{ type: 'text', text: 'last', tf: 4 }] }] },
    { text: 'two', marker: '2.' }] };
  for (const mode of ['bana', 'ukaaf']) {
    const f = formatBlock(l, opts(mode));
    const t = traceBlock(l, opts(mode));
    assert.deepEqual(t.map((x) => x.s), f, mode);
    assert.deepEqual(t.keepGroups, f.keepGroups, mode + ' keep groups');
    const units = t.map((x) => (x.src.find(Boolean) || {}).u).filter((u) => u != null);
    assert.deepEqual([...new Set(units)], [0, 1, 2, 3], mode + ': item, its two paragraphs, the next item');
  }
});

test('the list page rules (F-35) still apply, and a table inside an item keeps its row groups', () => {
  const l = { type: 'list', items: [{ text: 'one', marker: '1.', blocks: [TABLE] }, { text: 'two', marker: '2.' }] };
  const f = formatBlock(l, opts('bana'));
  assert.ok(Array.isArray(f.keepGroups) && f.keepGroups.length >= 2);
  assert.equal(f.keepGroups[0][0], 1, 'the list-start group (8.3.5) comes first');
  const tableStart = f.indexOf(formatBlock(TABLE, opts('bana')).find((x) => x !== ''));
  assert.ok(f.keepGroups.slice(1).some((g) => g[0] >= tableStart), 'the table\'s own row groups, at their place in the list');
});

// (a guard: getBlockSignature already keys a list on JSON.stringify(block.items), which takes in item.blocks)
test('cache key: getBlockSignature changes when an item\'s blocks change', () => {
  const a = { type: 'list', items: [{ text: 'one', marker: '1.', blocks: [{ type: 'para', text: 'x' }] }] };
  const b = { type: 'list', items: [{ text: 'one', marker: '1.', blocks: [{ type: 'para', text: 'y' }] }] };
  const c = { type: 'list', items: [{ text: 'one', marker: '1.' }] };
  const o = opts('bana');
  assert.notEqual(getBlockSignature(a, o), getBlockSignature(b, o));
  assert.notEqual(getBlockSignature(a, o), getBlockSignature(c, o));
});

// ---------------------------------------------------------------- NIMAS

test('NIMAS: item.blocks are written as <p>/<table> inside the <li> and read back unchanged', () => {
  const m = dtb(DTB_LIST);
  const xml = exportToNimasXml(m);
  const li = xml.slice(xml.indexOf('<li>'), xml.indexOf('</li>') + 5);
  assert.match(li, /^<li>First <em>para<\/em>\.\s*<p>Second para\.<\/p>\s*<table>[\s\S]*<\/table>\s*<\/li>$/);
  const again = dtb(xml.slice(xml.indexOf('<list'), xml.lastIndexOf('</list>') + 7));
  assert.deepEqual(again.blocks[1], m.blocks[1]);
  // and a model built elsewhere (Markdown) round-trips too, braille identical
  const md = parseMarkdown('1. First item\n\n   Its second paragraph.\n\n2. Second item');
  const back = parseDtbook(exportToNimasXml(md));
  const bl = lists(back)[0];
  assert.deepEqual(bl.items[0].blocks, [{ type: 'para', text: 'Its second paragraph.' }]);
  assert.deepEqual(formatBlock(bl, opts('bana')), formatBlock(lists(md)[0], opts('bana')));
});

test('DOCX save and reopen: an item\'s further paragraph and table come back inside the item', async () => {
  const { exportToDocxBlob } = await import('../web/docx-export.mjs');
  const table = { type: 'table', headers: ['Year', 'Total'], rows: [['2019', '14'], ['2020', '17'], ['2021', '23']] };
  const model = { blocks: [{ type: 'list', ordered: true, items: [
    { text: 'First item.', marker: '1.', blocks: [{ type: 'para', text: 'Its second paragraph.' }, table] },
    { text: 'Second item.', marker: '2.' }] }] };
  const back = await parseDocx(await exportToDocxBlob(model, 'T').arrayBuffer());
  assert.deepEqual(back.blocks.map((b) => b.type), ['list']);
  const [a, b] = back.blocks[0].items;
  assert.deepEqual(a.blocks[0], { type: 'para', text: 'Its second paragraph.' });
  assert.equal(a.blocks[1].type, 'table');
  assert.deepEqual(a.blocks[1].rows, table.rows);
  assert.equal(b.marker, '2.');
});
