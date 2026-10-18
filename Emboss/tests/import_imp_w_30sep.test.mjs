// Word-import decisions IMP-W1, W2, W5, W6, W9, W11 (Paul, 30 Sep 2026; Emboss/docs/decisions.md "Word import"),
// as they apply to the document READERS (parse.mjs: .docx, HTML/EPUB, ODT, RTF; doc.mjs: .doc).
//   IMP-W1  a Subtitle goes WITH its Title as one heading — never a new chapter
//   IMP-W2  Shift+Enter keeps a forced line break in an ordinary paragraph; verse layout only for a poem/verse style
//   IMP-W5  merged cells repeat the merged text in every cell they cover
//   IMP-W6  a nested table: the outer stays a table, the inner one follows as its own table
//   IMP-W9  comments, headers, footers stay out of the braille, with a load notice
//   IMP-W11 ruby: the base text followed by the guide in brackets
// Every test here was written to FAIL against the readers as they were before this batch (shown by pointing
// PARSE_MJS / DOC_MJS at saved copies placed next to the real files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { parseDocx, parseDtbook, parseHtml, parseOdt, parseRtf } = await import(process.env.PARSE_MJS || '../input/parse.mjs');
const { exportToNimasXml } = await import(process.env.NIMAS_MJS || '../input/nimas-export.mjs');
const { formatDocument } = await import('../format/document.mjs');
const { makeZip } = await import('../web/zip.mjs');
const { parseDoc } = await import(process.env.DOC_MJS || '../input/doc.mjs');
const { writeDoc } = await import('./helpers/doc-writer.mjs');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = `xmlns:w="${W}" xmlns:r="${R}"`;

/** Build a .docx in memory and read it. styles: the inner XML of styles.xml; parts: extra {name, text}. */
async function readDocx({ body, styles, parts = [] }) {
  const files = [{ name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>` }];
  if (styles) files.push({ name: 'word/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>${styles}</w:styles>` });
  files.push(...parts);
  return parseDocx(await makeZip(files).arrayBuffer());
}
const p = (t, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const style = (id, name, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
const upper = (s) => String(s).toUpperCase();
const lines = (brf) => brf.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter(Boolean);
const flat = (b) => (typeof b.text === 'string' ? b.text : (b.segments || []).map((s) => s.text || '').join(''));

// =====================================================================================================
// IMP-W1: Title and Subtitle
// =====================================================================================================
const TITLE_STYLES = style('Title', 'Title') + style('Subtitle', 'Subtitle', '<w:basedOn w:val="Normal"/>')
  + style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>');

test('IMP-W1: a Subtitle paragraph goes with the Title as one title block, not a second chapter', async () => {
  const m = await readDocx({
    styles: TITLE_STYLES,
    body: p('Main title', '<w:pStyle w:val="Title"/>') + p('The subtitle', '<w:pStyle w:val="Subtitle"/>')
      + p('Chapter one', '<w:pStyle w:val="Heading1"/>') + p('Body text.'),
  });
  const titles = m.blocks.filter((b) => b.type === 'title');
  assert.equal(titles.length, 1, JSON.stringify(m.blocks));
  assert.equal(titles[0].text, 'Main title\nThe subtitle', 'the subtitle is the second line of the same heading');
  assert.equal(m.title, 'Main title', 'the document title is the Title paragraph alone');
  assert.deepEqual(m.blocks.map((b) => b.type), ['title', 'heading', 'para']);
});

test('IMP-W1: a custom style based on Subtitle is a subtitle too; a Subtitle with no Title before it is not a chapter', async () => {
  const m = await readDocx({
    styles: TITLE_STYLES + style('BookSub', 'Book Sub', '<w:basedOn w:val="Subtitle"/>'),
    body: p('Chapter one', '<w:pStyle w:val="Heading1"/>') + p('Lone subtitle', '<w:pStyle w:val="Subtitle"/>') + p('Main', '<w:pStyle w:val="Title"/>') + p('Custom sub', '<w:pStyle w:val="BookSub"/>'),
  });
  assert.deepEqual(m.blocks.map((b) => [b.type, flat(b)]), [['heading', 'Chapter one'], ['para', 'Lone subtitle'], ['title', 'Main\nCustom sub']]);
});

test('IMP-W1: the saved XML has one heading for Title+Subtitle (the subtitle inside it) and reopens as the same title', async () => {
  const m = await readDocx({
    styles: TITLE_STYLES,
    body: p('Main title', '<w:pStyle w:val="Title"/>') + p('The subtitle', '<w:pStyle w:val="Subtitle"/>') + p('Chapter one', '<w:pStyle w:val="Heading1"/>') + p('Body text.'),
  });
  const xml = exportToNimasXml(m);
  assert.equal((xml.match(/bana-title/g) || []).length, 1, xml);
  assert.match(xml, /<h1 class="bana-title">Main title<br\/>The subtitle<\/h1>/);
  assert.equal((xml.match(/<level1>/g) || []).length, 2, 'the title block and the chapter: no third level for the subtitle');
  const again = await parseDtbook(xml);
  const t = again.blocks.find((b) => b.type === 'title');
  assert.equal(flat(t), 'Main title\nThe subtitle');
});

test('IMP-W1: in braille (BANA and UKAAF) both lines are centred, on separate lines', async () => {
  const m = await readDocx({
    styles: TITLE_STYLES,
    body: p('Main title', '<w:pStyle w:val="Title"/>') + p('The subtitle', '<w:pStyle w:val="Subtitle"/>') + p('Body text.'),
  });
  for (const mode of ['bana', 'ukaaf']) {
    const l = lines(formatDocument(m, { mode, width: 32, depth: 25, translate: upper }));
    const b = l.findIndex((x) => x.includes('THE SUBTITLE')), a = b - 1;   // (BANA also has the running head "MAIN TITLE" above)
    assert.ok(b > 0 && l[a].trim() === 'MAIN TITLE' && l[b].trim() === 'THE SUBTITLE', `${mode}: ${JSON.stringify(l)}`);
    assert.ok(l[a].length > 8 && l[b].length > 8, `${mode}: centred`);
  }
});

// ODT and RTF read a Subtitle the same way (one heading with the Title), so a saved-and-reopened or RTF/ODT-sourced book is not different.
const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
  + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
  + 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
async function readOdt(bodyXml, { styles = '', stylesXml = null } = {}) {
  const content = `<?xml version="1.0"?><office:document-content ${ODT_NS}><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;
  const files = [{ name: 'content.xml', data: new TextEncoder().encode(content) }];
  if (stylesXml) files.push({ name: 'styles.xml', data: new TextEncoder().encode(`<?xml version="1.0"?><office:document-styles ${ODT_NS}>${stylesXml}</office:document-styles>`) });
  return parseOdt(await makeZip(files).arrayBuffer());
}

test('IMP-W1: ODT and RTF - a Subtitle goes with the Title, not a chapter of its own', async () => {
  const o = await readOdt('<text:p text:style-name="Title">Main</text:p><text:p text:style-name="Subtitle">Sub</text:p><text:h text:outline-level="1">Chapter</text:h>');
  assert.deepEqual(o.blocks.map((b) => [b.type, flat(b)]), [['title', 'Main\nSub'], ['heading', 'Chapter']]);
  const r = parseRtf('{\\rtf1{\\stylesheet{\\s1 Title;}{\\s2 Subtitle;}}\\pard\\s1 Main\\par\\pard\\s2 Sub\\par\\pard Body.\\par}');
  assert.deepEqual(r.blocks.map((b) => [b.type, flat(b)]), [['title', 'Main\nSub'], ['para', 'Body.']], JSON.stringify(r.blocks));
  assert.equal(r.title, 'Main');
});

// =====================================================================================================
// IMP-W2: Shift+Enter
// =====================================================================================================
const br = '<w:r><w:br/></w:r>';
const t = (x) => `<w:r><w:t xml:space="preserve">${x}</w:t></w:r>`;

test('IMP-W2: Shift+Enter in an ordinary paragraph is a forced line break in ONE paragraph, not verse', async () => {
  const m = await readDocx({ body: `<w:p>${t('Line one')}${br}${t('Line two')}${br}${t('Line three')}</w:p>` });
  assert.equal(m.blocks.length, 1, JSON.stringify(m.blocks));
  assert.equal(m.blocks[0].type, 'para');
  assert.equal(flat(m.blocks[0]), 'Line one\nLine two\nLine three');
  assert.ok(!JSON.stringify(m.blocks).includes('verse'));
});

test('IMP-W2: w:br with w:clear (text-wrapping clear) is a forced line break too; a column or page break is not', async () => {
  const m = await readDocx({ body: `<w:p>${t('Wrapped')}<w:r><w:br w:type="textWrapping" w:clear="all"/></w:r>${t('second')}</w:p>`
    + `<w:p>${t('Col one.')}<w:r><w:br w:type="column"/></w:r>${t('Col two.')}</w:p>` });
  assert.deepEqual(m.blocks.map(flat), ['Wrapped\nsecond', 'Col one. Col two.']);
});

test('IMP-W2: a line break keeps its emphasis, drops spaces at the line edges, and ignores a break at the very start or end', async () => {
  const m = await readDocx({ body: `<w:p>${br}${t('Bold ')}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">word </w:t></w:r>${br}${t(' after')}${br}</w:p>` });
  assert.equal(m.blocks.length, 1);
  assert.equal(flat(m.blocks[0]), 'Bold word\nafter');
  assert.ok(m.blocks[0].segments.some((s) => s.tf === 4 && /word/.test(s.text)), 'the bold run keeps its bold');
});

test('IMP-W2: the forced break reaches the braille as a line break and survives Save (<br/>)', async () => {
  const m = await readDocx({ body: `<w:p>${t('Dear Sir')}${br}${t('Yours truly')}</w:p>` });
  const l = lines(formatDocument(m, { mode: 'bana', width: 32, depth: 25, translate: upper }));
  assert.ok(l.some((x) => x.includes('DEAR SIR')) && !l.some((x) => x.includes('DEAR SIR') && x.includes('YOURS TRULY')), JSON.stringify(l));
  const xml = exportToNimasXml(m);
  assert.match(xml, /<p>Dear Sir<br\/>Yours truly<\/p>/);
  assert.ok(!/bai-verse|<poem|linegroup/.test(xml), xml);
});

test('IMP-W2: a paragraph in a poem / verse / poetry / lyric style (by id, name, or basedOn) keeps the verse split', async () => {
  const styles = style('Poem', 'Poem') + style('MyStanza', 'My Stanza', '<w:basedOn w:val="Poem"/>') + style('Lyrics1', 'Song Lyrics') + style('VerseStyle', 'Verse text');
  for (const sid of ['Poem', 'MyStanza', 'Lyrics1', 'VerseStyle']) {
    const m = await readDocx({ styles, body: `<w:p><w:pPr><w:pStyle w:val="${sid}"/></w:pPr>${t('Roses are red')}${br}${t('Violets are blue')}</w:p>` });
    const verse = m.blocks.filter((b) => b.type === 'play' && b.subtype === 'verse');
    assert.deepEqual(verse.map((b) => b.text), ['Roses are red', 'Violets are blue'], `${sid}: ${JSON.stringify(m.blocks)}`);
  }
});

// =====================================================================================================
// IMP-W5: merged cells repeat the merged text in every cell they cover (every reader)
// =====================================================================================================
// The table every reader is given: a header row whose first cell spans two columns; a first-column cell merged down two rows;
// a last row whose second cell spans two columns.
const MERGED = {
  headers: ['Head', 'Head', 'H3'],
  rows: [['VM', 'd2', 'd3'], ['VM', 'e2', 'e3'], ['f1', 'Span2', 'Span2']],
};
const tableOf = (m) => m.blocks.find((b) => b.type === 'table');
const cellTxt = (c) => (c && typeof c === 'object' ? c.text : c);
const grid = (tb) => ({ headers: tb.headers.map(cellTxt), rows: tb.rows.map((r) => r.map(cellTxt)) });

const dtc = (inner, pr = '') => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${pr}</w:tcPr>${inner}</w:tc>`;
const dtr = (cells, hdr = false) => `<w:tr>${hdr ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
const dtbl = (rows) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl>`;

test('IMP-W5: Word - gridSpan and vMerge repeat the merged text; the header row stays the header row', async () => {
  const m = await readDocx({
    body: dtbl(
      dtr(dtc(p('Head'), '<w:gridSpan w:val="2"/>') + dtc(p('H3')), true)
      + dtr(dtc(p('VM'), '<w:vMerge w:val="restart"/>') + dtc(p('d2')) + dtc(p('d3')))
      + dtr(dtc('<w:p/>', '<w:vMerge/>') + dtc(p('e2')) + dtc(p('e3')))
      + dtr(dtc(p('f1')) + dtc(p('Span2'), '<w:gridSpan w:val="2"/>')))
      + p('After.'),
  });
  assert.deepEqual(grid(tableOf(m)), MERGED);
});

test('IMP-W5: Word - a merged cell with bold text repeats as bold text (rich cell copied to every cell it covers)', async () => {
  const m = await readDocx({
    body: dtbl(
      dtr(dtc(p('A')) + dtc(p('B')) + dtc(p('C')), true)
      + dtr(dtc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p>', '<w:gridSpan w:val="2"/>') + dtc(p('x')))),
  });
  const r = tableOf(m).rows[0];
  assert.equal(cellTxt(r[0]), 'Bold'); assert.equal(cellTxt(r[1]), 'Bold');
  assert.ok(r[0].segments && r[1].segments && r[0].segments[0].tf === 4 && r[1].segments[0].tf === 4);
});

test('IMP-W5: HTML - colspan and rowspan (thead and tbody) repeat the merged text', () => {
  const m = parseHtml('<table><thead><tr><th colspan="2">Head</th><th>H3</th></tr></thead><tbody>'
    + '<tr><td rowspan="2">VM</td><td>d2</td><td>d3</td></tr><tr><td>e2</td><td>e3</td></tr>'
    + '<tr><td>f1</td><td colspan="2">Span2</td></tr></tbody></table>');
  assert.deepEqual(grid(tableOf(m)), MERGED);
});

test('IMP-W5: HTML - a body row with colspan under an all-th header row', () => {
  const m = parseHtml('<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td colspan="3">All three</td></tr></table>');
  assert.deepEqual(grid(tableOf(m)), { headers: ['A', 'B', 'C'], rows: [['All three', 'All three', 'All three']] });
});

const otc = (t, attrs = '') => `<table:table-cell ${attrs}><text:p>${t}</text:p></table:table-cell>`;
const ocov = '<table:covered-table-cell/>';
test('IMP-W5: ODT - number-columns-spanned / number-rows-spanned repeat the merged text (header rows and body)', async () => {
  const m = await readOdt(`<table:table>
    <table:table-header-rows><table:table-row>${otc('Head', 'table:number-columns-spanned="2"')}${ocov}${otc('H3')}</table:table-row></table:table-header-rows>
    <table:table-row>${otc('VM', 'table:number-rows-spanned="2"')}${otc('d2')}${otc('d3')}</table:table-row>
    <table:table-row>${ocov}${otc('e2')}${otc('e3')}</table:table-row>
    <table:table-row>${otc('f1')}${otc('Span2', 'table:number-columns-spanned="2"')}${ocov}</table:table-row>
  </table:table>`);
  assert.deepEqual(grid(tableOf(m)), MERGED);
});

test('IMP-W5: RTF - \\clmgf/\\clmrg and \\clvmgf/\\clvmrg repeat the merged text', () => {
  const m = parseRtf('{\\rtf1\\ansi\n'
    + '\\trowd\\trhdr\\clmgf\\cellx3000\\clmrg\\cellx6000\\cellx9000\n\\pard\\intbl Head\\cell \\cell H3\\cell \\row\n'
    + '\\trowd\\clvmgf\\cellx3000\\cellx6000\\cellx9000\n\\pard\\intbl VM\\cell d2\\cell d3\\cell \\row\n'
    + '\\trowd\\clvmrg\\cellx3000\\cellx6000\\cellx9000\n\\pard\\intbl \\cell e2\\cell e3\\cell \\row\n'
    + '\\trowd\\cellx3000\\clmgf\\cellx6000\\clmrg\\cellx9000\n\\pard\\intbl f1\\cell Span2\\cell \\cell \\row\n}');
  assert.deepEqual(grid(tableOf(m)), MERGED);
});

test('IMP-W5: .doc - horizontal and vertical merges repeat the merged text', async () => {
  const m = await parseDoc(writeDoc({ body: [{ table: [
    [{ blocks: [{ p: 'Head' }], span: 2 }, 'H3'],
    [{ blocks: [{ p: 'VM' }], vmerge: 'restart' }, 'd2', 'd3'],
    [{ blocks: [{ p: '' }], vmerge: 'continue' }, 'e2', 'e3'],
    ['f1', { blocks: [{ p: 'Span2' }], span: 2 }],
  ] }] }));
  assert.deepEqual(grid(tableOf(m)), MERGED);
});

// =====================================================================================================
// IMP-W6: nested tables - the outer table stays a table, the inner one follows it as its own table
// =====================================================================================================
const PH = '(table follows)';
const words = (m, w) => JSON.stringify(m.blocks).split(w).length - 1;

test('IMP-W6: Word - a nested table follows its outer table as a table of its own; a placeholder stands in the outer cell', async () => {
  const inner = dtbl(dtr(dtc(p('Inner1')) + dtc(p('Inner2')), true) + dtr(dtc(p('Inner3')) + dtc(p('Inner4'))));
  const m = await readDocx({
    body: dtbl(dtr(dtc(p('OuterA')) + dtc(p('OuterB')), true) + dtr(dtc(p('a1') + inner + '<w:p/>') + dtc(p('b1')))) + p('After.'),
  });
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table', 'para']);
  assert.deepEqual(grid(m.blocks[0]), { headers: ['OuterA', 'OuterB'], rows: [[`a1 ${PH}`, 'b1']] });
  assert.deepEqual(grid(m.blocks[1]), { headers: ['Inner1', 'Inner2'], rows: [['Inner3', 'Inner4']] });
  for (const w of ['Inner1', 'Inner2', 'Inner3', 'Inner4']) assert.equal(words(m, w), 1, `${w} appears once`);
});

test('IMP-W6: Word - the audit shape (one row, no header row: outer text | nested table) is kept as a table too, and the inner one is a table even though it is one row', async () => {
  const inner = dtbl(dtr(dtc(p('alphaInner1')) + dtc(p('alphaInner2'))));
  const m = await readDocx({ body: dtbl(dtr(dtc(p('alphaOuter1')) + dtc(inner + '<w:p/>'))) });
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table']);
  assert.deepEqual(grid(m.blocks[0]), { headers: ['alphaOuter1', PH], rows: [] });
  assert.deepEqual(grid(m.blocks[1]), { headers: ['alphaInner1', 'alphaInner2'], rows: [] });
});

test('IMP-W6: Word - tables nested two deep follow in order; the caption after the outer table stays the outer table\'s', async () => {
  const innermost = dtbl(dtr(dtc(p('Deep1')) + dtc(p('Deep2')), true) + dtr(dtc(p('Deep3')) + dtc(p('Deep4'))));
  const middle = dtbl(dtr(dtc(p('Mid1')) + dtc(p('Mid2')), true) + dtr(dtc(p('m3') + innermost + '<w:p/>') + dtc(p('m4'))));
  const m = await readDocx({
    styles: style('Caption', 'caption'),
    body: dtbl(dtr(dtc(p('Out1')) + dtc(p('Out2')), true) + dtr(dtc(p('o3') + middle + '<w:p/>') + dtc(p('o4')))) + p('Table 1: The outer table', '<w:pStyle w:val="Caption"/>'),
  });
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table', 'table']);
  assert.deepEqual(m.blocks.map((b) => cellTxt(b.headers[0])), ['Out1', 'Mid1', 'Deep1']);
  assert.equal(m.blocks[0].title, 'Table 1: The outer table');
  assert.equal(m.blocks[1].title, undefined);
});

test('IMP-W6: Word - a layout table (a heading in a cell) holding a nested table is still unwrapped, as before', async () => {
  const inner = dtbl(dtr(dtc(p('Inner1')) + dtc(p('Inner2')), true) + dtr(dtc(p('Inner3')) + dtc(p('Inner4'))));
  const m = await readDocx({
    styles: style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'),
    body: dtbl(dtr(dtc(p('A heading', '<w:pStyle w:val="Heading1"/>') + inner + '<w:p/>') + dtc(p('side')))),
  });
  assert.equal(m.blocks[0].type, 'heading');
  assert.ok(m.blocks.some((b) => b.type === 'table' && cellTxt(b.headers[0]) === 'Inner1'));
  assert.ok(!JSON.stringify(m.blocks).includes(PH));
});

test('IMP-W6: Word - the saved XML has both tables and reopens as two tables', async () => {
  const inner = dtbl(dtr(dtc(p('Inner1')) + dtc(p('Inner2')), true) + dtr(dtc(p('Inner3')) + dtc(p('Inner4'))));
  const m = await readDocx({ body: dtbl(dtr(dtc(p('OuterA')) + dtc(p('OuterB')), true) + dtr(dtc(p('a1') + inner + '<w:p/>') + dtc(p('b1')))) });
  const xml = exportToNimasXml(m);
  assert.equal((xml.match(/<table[ >]/g) || []).length, 2, xml);
  const again = await parseDtbook(xml);
  assert.deepEqual(again.blocks.filter((b) => b.type === 'table').map((b) => b.headers.map(cellTxt)), [['OuterA', 'OuterB'], ['Inner1', 'Inner2']]);
});

test('IMP-W6: HTML - an inner table is one table after the outer, not repeated cells', () => {
  const m = parseHtml('<table><tr><th>OuterA</th><th>OuterB</th></tr><tr><td>a1<table><tr><th>Inner1</th><th>Inner2</th></tr><tr><td>Inner3</td><td>Inner4</td></tr></table></td><td>b1</td></tr></table><p>After.</p>');
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table', 'para']);
  assert.deepEqual(grid(m.blocks[0]), { headers: ['OuterA', 'OuterB'], rows: [[`a1 ${PH}`, 'b1']] });
  assert.deepEqual(grid(m.blocks[1]), { headers: ['Inner1', 'Inner2'], rows: [['Inner3', 'Inner4']] });
  for (const w of ['Inner1', 'Inner2', 'Inner3', 'Inner4']) assert.equal(words(m, w), 1, `${w} appears once`);
});

test('IMP-W6: HTML - the audit shape (alphaOuter1 | inner one-row table)', () => {
  const m = parseHtml('<table><tr><td>alphaOuter1</td><td><table><tr><td>alphaInner1</td><td>alphaInner2</td></tr></table></td></tr></table>');
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table']);
  assert.deepEqual(grid(m.blocks[0]).headers.concat(grid(m.blocks[0]).rows.flat()), ['alphaOuter1', PH]);
  assert.deepEqual(grid(m.blocks[1]).headers.concat(grid(m.blocks[1]).rows.flat()), ['alphaInner1', 'alphaInner2']);
});

test('IMP-W6: ODT - an inner table follows the outer one as its own table', async () => {
  const inner = `<table:table><table:table-row>${otc('alphaInner1')}${otc('alphaInner2')}</table:table-row></table:table>`;
  const m = await readOdt(`<table:table><table:table-row>${otc('alphaOuter1')}<table:table-cell>${inner}<text:p/></table:table-cell></table:table-row></table:table>`);
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table']);
  assert.deepEqual(grid(m.blocks[0]).headers.concat(grid(m.blocks[0]).rows.flat()), ['alphaOuter1', PH]);
  assert.deepEqual(grid(m.blocks[1]).headers.concat(grid(m.blocks[1]).rows.flat()), ['alphaInner1', 'alphaInner2']);
  for (const w of ['alphaInner1', 'alphaInner2']) assert.equal(words(m, w), 1, `${w} appears once`);
});

test('IMP-W6: RTF - \\itap2 / \\nestcell / \\nestrow: the outer table keeps its cells, the inner table follows it', () => {
  const m = parseRtf('{\\rtf1\\ansi\n'
    + '\\trowd\\trgaph108\\cellx4500\\cellx9000\n'
    + '\\pard\\intbl\\itap1 alphaOuter1\\cell\n'
    + '\\pard\\intbl\\itap2 alphaInner1\\nestcell\n'
    + '\\pard\\intbl\\itap2 alphaInner2\\nestcell\n'
    + '{\\*\\nesttableprops\\trowd\\trgaph108\\cellx2250\\cellx4500\\nestrow}\\nonesttables\\par\n'
    + '\\cell\\row\n'
    + '\\pard\\plain Last paragraph.\\par}');
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table', 'para']);
  assert.deepEqual(grid(m.blocks[0]).headers.concat(grid(m.blocks[0]).rows.flat()), ['alphaOuter1', PH]);
  assert.deepEqual(grid(m.blocks[1]).headers.concat(grid(m.blocks[1]).rows.flat()), ['alphaInner1', 'alphaInner2']);
});

test('IMP-W6: .doc - a nested table follows its outer table as a table of its own', async () => {
  const m = await parseDoc(writeDoc({ body: [{ table: [
    ['OuterA', 'OuterB'],
    [{ blocks: [{ p: 'a1' }, { table: [['Inner1', 'Inner2'], ['Inner3', 'Inner4']] }] }, 'b1'],
  ] }, { p: 'After.' }] }));
  assert.deepEqual(m.blocks.map((b) => b.type), ['table', 'table', 'para']);
  assert.deepEqual(grid(m.blocks[0]), { headers: ['OuterA', 'OuterB'], rows: [[`a1 ${PH}`, 'b1']] });
  assert.deepEqual(grid(m.blocks[1]), { headers: ['Inner1', 'Inner2'], rows: [['Inner3', 'Inner4']] });
});

// =====================================================================================================
// IMP-W9: comments, headers, footers stay out of the braille, with a load notice saying what was left out
// =====================================================================================================
const part = (name, root, inner) => ({ name, text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} ${NS}>${inner}</w:${root}>` });
const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const pageOfPages = '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>3</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p>';

test('IMP-W9: Word - comments and running headers/footers are not transcribed, and the load notice says so', async () => {
  const m = await readDocx({
    body: para('Body text.'),
    parts: [
      part('word/comments.xml', 'comments', `<w:comment w:id="0" w:author="Reviewer">${para('Please check this')}</w:comment><w:comment w:id="1" w:author="Reviewer">${para('Second remark')}</w:comment>`),
      part('word/header1.xml', 'hdr', para('Company confidential')),
      part('word/header2.xml', 'hdr', para('Company confidential')),       // the first-page header: the same header, counted once
      part('word/footer1.xml', 'ftr', pageOfPages),                        // page furniture only: not real text
      part('word/footer2.xml', 'ftr', para('Draft copy')),
    ],
  });
  assert.deepEqual(m.blocks.map(flat), ['Body text.']);
  assert.deepEqual(m.warnings, ['2 comments, a running header and a running footer were not transcribed.']);
});

test('IMP-W9: Word - one comment alone; no notice at all when there is nothing but page numbers', async () => {
  const one = await readDocx({ body: para('Body.'), parts: [part('word/comments.xml', 'comments', `<w:comment w:id="0">${para('Only one')}</w:comment>`)] });
  assert.deepEqual(one.warnings, ['a comment was not transcribed.']);
  const none = await readDocx({ body: para('Body.'), parts: [part('word/footer1.xml', 'ftr', pageOfPages), part('word/header1.xml', 'hdr', '<w:p/>'), part('word/comments.xml', 'comments', '')] });
  assert.equal(none.warnings, undefined);
});

test('IMP-W9: ODT - an annotation is no longer transcribed into its paragraph; headers/footers with text are counted', async () => {
  const m = await readOdt('<text:p>before <office:annotation><dc:creator>Reviewer</dc:creator><dc:date>2026-09-30T10:00:00</dc:date><text:p>Comment body</text:p></office:annotation>after.</text:p>', {
    stylesXml: '<office:master-styles><style:master-page style:name="Standard"><style:header><text:p>Company confidential</text:p></style:header>'
      + '<style:footer><text:p>Page <text:page-number>1</text:page-number></text:p></style:footer></style:master-page></office:master-styles>',
  });
  assert.deepEqual(m.blocks.map(flat), ['before after.']);
  assert.deepEqual(m.warnings, ['a comment and a running header were not transcribed.']);
});

test('IMP-W9: RTF - an annotation (comment), a header and a footer are counted, and none of their text is in the body', () => {
  const m = parseRtf('{\\rtf1\\ansi{\\header \\pard Company confidential\\par}{\\footer \\pard Page {\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}\\par}'
    + '\\pard Body {\\*\\atnid AB}{\\*\\atnauthor Me}\\chatn{\\*\\annotation{\\*\\atnref 0}\\pard A comment here\\par} text.\\par}');
  assert.deepEqual(m.blocks.map(flat), ['Body text.']);
  assert.deepEqual(m.warnings, ['a comment and a running header were not transcribed.']);
});

test('IMP-W9: .doc - comments, a header and a footer are counted (a document made with the test writer)', async () => {
  const m = await parseDoc(writeDoc({ header: 'Company confidential', footer: 'Draft copy', comments: ['Please check', 'Second remark'], body: [{ p: 'Body text.' }] }));
  assert.deepEqual(m.blocks.map(flat), ['Body text.']);
  assert.deepEqual(m.warnings, ['2 comments, a running header and a running footer were not transcribed.']);
});

test('IMP-W9: .doc - a LibreOffice-written file with a Word comment says so', async () => {
  const { readFileSync } = await import('node:fs');
  const b = readFileSync(new URL('./fixtures/import-audit/doc/lo-w05-notes-comments.doc', import.meta.url));
  const m = await parseDoc(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.ok((m.warnings || []).some((w) => /comment/.test(w) && /not transcribed/.test(w)), JSON.stringify(m.warnings));
  assert.ok(!JSON.stringify(m.blocks).includes('alphacommentbody'), 'the comment text is not in the document');
});

// =====================================================================================================
// IMP-W1 / IMP-W2 in the .doc reader (the same decisions as .docx)
// =====================================================================================================
test('IMP-W1: .doc - a Subtitle goes with the Title as one title block', async () => {
  const m = await parseDoc(writeDoc({ body: [{ p: 'Main title', style: 'Title' }, { p: 'The subtitle', style: 'Subtitle' }, { p: 'Chapter one', style: 'heading 1' }, { p: 'Body.' }] }));
  assert.deepEqual(m.blocks.map((b) => [b.type, flat(b)]), [['title', 'Main title\nThe subtitle'], ['heading', 'Chapter one'], ['para', 'Body.']]);
  assert.equal(m.title, 'Main title');
  const lone = await parseDoc(writeDoc({ body: [{ p: 'Chapter one', style: 'heading 1' }, { p: 'Lone subtitle', style: 'Subtitle' }] }));
  assert.deepEqual(lone.blocks.map((b) => [b.type, flat(b)]), [['heading', 'Chapter one'], ['para', 'Lone subtitle']]);
});

test('IMP-W2: .doc - Shift+Enter in an ordinary paragraph is a forced line break in one paragraph; a poem style keeps the verse split', async () => {
  const m = await parseDoc(writeDoc({
    styles: [{ name: 'Poem', type: 'para', basedOn: 'Normal' }],
    body: [{ p: ['Line one', { br: true }, 'Line two', { br: true }, { text: 'bold', b: true }, ' three'] },
      { p: ['Roses are red', { br: true }, 'Violets are blue'], style: 'Poem' }],
  }));
  assert.equal(m.blocks.length, 3, JSON.stringify(m.blocks));
  assert.equal(m.blocks[0].type, 'para');
  assert.equal(flat(m.blocks[0]), 'Line one\nLine two\nbold three');
  assert.deepEqual(m.blocks.slice(1).map((b) => [b.type, b.subtype, b.text]), [['play', 'verse', 'Roses are red'], ['play', 'verse', 'Violets are blue']]);
});

// =====================================================================================================
// IMP-W11: ruby (phonetic guide) - the base text followed by the guide in brackets
// =====================================================================================================
test('IMP-W11: Word - w:ruby gives the base text and its guide in brackets, nothing dropped or glued', async () => {
  const m = await readDocx({
    body: '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:r><w:ruby><w:rubyPr/><w:rt><w:r><w:t>かんじ</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>漢字</w:t></w:r></w:rubyBase></w:ruby></w:r><w:r><w:t xml:space="preserve"> end. </w:t></w:r>'
      + '<w:r><w:ruby><w:rt><w:r><w:t>alpharuby</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>alphabase</w:t></w:r></w:rubyBase></w:ruby></w:r></w:p>',
  });
  assert.equal(flat(m.blocks[0]), 'See 漢字 (かんじ) end. alphabase (alpharuby)');
});

test('IMP-W11: HTML - <ruby>/<rt>/<rp> give the base text and the guide in brackets (the <rp> fallback brackets are not doubled)', () => {
  const m = parseHtml('<p>See <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby> end.</p><p><ruby>alphabase<rt>alpharuby</rt></ruby></p>'
    + '<table><tr><th>H</th></tr><tr><td><ruby>cellbase<rt>cellguide</rt></ruby></td></tr></table>');
  assert.equal(flat(m.blocks[0]), 'See 漢字 (かんじ) end.');
  assert.equal(flat(m.blocks[1]), 'alphabase (alpharuby)');
  assert.equal(cellTxt(tableOf(m).rows[0][0]), 'cellbase (cellguide)');
});

test('IMP-W11: ODT - text:ruby gives the base text and the guide in brackets', async () => {
  const m = await readOdt('<text:p>See <text:ruby><text:ruby-base>漢字</text:ruby-base><text:ruby-text>かんじ</text:ruby-text></text:ruby> end.</text:p>');
  assert.equal(flat(m.blocks[0]), 'See 漢字 (かんじ) end.');
});

test('IMP-W11: .doc - a Word ruby (EQ \\o\\ad field) gives the base text and the guide in brackets', async () => {
  const m = await parseDoc(writeDoc({ body: [{ p: ['Ruby: ', { field: 'EQ \\* jc2 \\* "Font:MS Mincho" \\* hps10 \\o\\ad(\\s\\up 9(かんじ),漢字)' }, ' end'] }] }));
  assert.equal(flat(m.blocks[0]), 'Ruby: 漢字 (かんじ) end');
});

// =====================================================================================================
// .doc parity with the .docx fixes of 30 Sep (import fix list #36 symbol fonts, #34 the linked "... Char" twin)
// =====================================================================================================
test('.doc parity #36: an unmapped symbol is U+FFFD (not the white square) and named in the warning; the corrected Wingdings / Symbol entries', async () => {
  const m = await parseDoc(writeDoc({ body: [{ p: ['a ', { sym: { font: 'Wingdings', code: 0xF076 } }, ' b ', { sym: { font: 'Wingdings', code: 0xF0E1 } }, ' c ', { sym: { font: 'Symbol', code: 0xF077 } }, ' d ', { sym: { font: 'Wingdings', code: 0xF0E8 } }] }] }));
  assert.equal(flat(m.blocks[0]), 'a � b ↑ c ω d ➔');
  assert.ok(!flat(m.blocks[0]).includes('□'));
  assert.equal(m.warnings.length, 1);
  assert.match(m.warnings[0], /1 symbol typed in a symbol font \(Wingdings F076\) has no known equivalent/);
});

test('.doc parity #34: a linked "... Char" twin style is ignored only inside a paragraph of its partner style; elsewhere its bold is the author\'s', async () => {
  const m = await parseDoc(writeDoc({
    styles: [
      { name: 'Notes', type: 'para', basedOn: 'Normal' },
      { name: 'Notes Char', type: 'char', sti: 0x0FFE, bold: true, linked: 'Notes' },
      { name: 'Heading 3 Char', type: 'char', sti: 0x0FFE, bold: true, linked: 'heading 3' },
    ],
    body: [
      { p: ['in a normal paragraph: ', { text: 'bold twin', style: 'Heading 3 Char' }] },
      { p: ['in the partner paragraph: ', { text: 'not bold', style: 'Notes Char' }], style: 'Notes' },
    ],
  }));
  assert.deepEqual(m.blocks[0].segments.map((s) => [s.text, s.tf || 0]), [['in a normal paragraph: ', 0], ['bold twin', 4]]);
  assert.equal(flat(m.blocks[1]), 'in the partner paragraph: not bold');
  assert.ok(!(m.blocks[1].segments || []).some((s) => s.tf), 'no emphasis inside the partner paragraph');
});

test('IMP-W5 / IMP-W6: RTF written by LibreOffice (a merged cell is one cell over two grid columns; nested tables by \\nestcell) gives the same tables', async () => {
  const { readFileSync } = await import('node:fs');
  const m = parseRtf(readFileSync(new URL('./fixtures/import-audit/rtf/lo-w12-tables.rtf', import.meta.url), 'utf8'));
  const tb = m.blocks.filter((b) => b.type === 'table').map(grid);
  assert.deepEqual(tb[2], { headers: ['alphaSpanHead', 'alphaSpanHead', 'alphaH3b'], rows: [['alphaVM', 'd2', 'd3'], ['alphaVM', 'e2', 'e3'], ['f1', 'alphaSpan2', 'alphaSpan2']] });
  assert.deepEqual(tb.slice(4, 6), [{ headers: ['alphaOuter1', PH], rows: [] }, { headers: ['alphaInner1', 'alphaInner2'], rows: [] }]);
});

// Found in the merge review (30 Sep): the Title + Subtitle block ("Main\nSub") was brailled as ONE wrapped line — the title
// layout translated the forced break as a space. Each line is now centred on its own (both layout paths; layout parity).
test('IMP-W1: a Title with its Subtitle is brailled as two centred lines, as print sets them', async () => {
  const { formatDocument } = await import('../format/document.mjs');
  const up = (t) => String(t).toUpperCase().replace(/\n/g, ' ');   // as liblouis does: a line break in the text is a space
  const brf = formatDocument({ blocks: [{ type: 'title', text: 'Specimen framework document:\nExecutive agencies' }, { type: 'para', text: 'Body.' }] },
    { mode: 'bana', width: 38, depth: 25, translate: up });
  const lines = brf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.includes('SPECIMEN FRAMEWORK DOCUMENT:'), lines.join(' | '));
  assert.ok(lines.includes('EXECUTIVE AGENCIES'), lines.join(' | '));
});
