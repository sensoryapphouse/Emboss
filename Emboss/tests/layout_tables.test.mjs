// Layout tables vs data tables (Emboss/input/table-kind.mjs), Word table captions, pictures in
// data-table cells, and the NIMAS export of a table with a heading row only.
//
// BANA Formats §11.1.1 / §11.2.3: a table is data arranged in columns and rows to be
// compared; a Word table used only for page layout (letterhead, form, photo beside a
// biography, two columns of prose, a one-cell sidebar) is read as ordinary text in reading
// order. When the evidence is unclear the table stays a table (see table-kind.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseDocx, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { buildNimasPackage } from '../input/nimas-package.mjs';
import { classifyTable, isLayoutTable } from '../input/table-kind.mjs';
import { cellSegments, cellPlainText } from '../format/cell-markup.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

// A minimal stored (uncompressed) zip.
function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameB = Buffer.from(name), body = typeof data === 'string' ? Buffer.from(enc.encode(data)) : Buffer.from(data);
    const crc = zlib.crc32(body);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(body.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(body.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, body); centrals.push(ch, nameB);
    offset += 30 + nameB.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>`;
const STYLES = `<?xml version="1.0"?><w:styles ${NS}>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`;

const t = (s) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const para = (s, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${s ? t(s) : ''}</w:p>`;
const bullet = (s) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${t(s)}</w:p>`;
const pic = (descr) => `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="${descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdI"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const tc = (...inner) => `<w:tc>${inner.join('') || '<w:p/>'}</w:tc>`;
const tr = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const trHeader = (...cells) => `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cells.join('')}</w:tr>`;
const tbl = (rows, tblPr = '') => `<w:tbl><w:tblPr>${tblPr}</w:tblPr>${rows.join('')}</w:tbl>`;
const docx = (body) => makeZip({
  'word/document.xml': `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`,
  'word/_rels/document.xml.rels': RELS, 'word/styles.xml': STYLES, 'word/media/a.png': PNG,
});
const kinds = (d) => (d.tableKinds || []).map((k) => k.kind);

// ---------------------------------------------------------------- layout tables
test('letterhead (logo | address) is read as its picture then its text, in reading order', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(`<w:p>${pic('Acme logo')}</w:p>`), tc(para('Acme Training Services'), para('123 Main Street, Anytown')))]) + para('Dear reader,')));
  assert.equal(d.blocks.filter((b) => b.type === 'table').length, 0, 'no table');
  assert.deepEqual(d.blocks.map((b) => b.type), ['graphic', 'para', 'para', 'para']);
  assert.equal(d.blocks[0].alt, 'Acme logo');
  assert.deepEqual(d.blocks.slice(1).map((b) => b.text), ['Acme Training Services', '123 Main Street, Anytown', 'Dear reader,']);
  assert.ok((d.resources || []).some((r) => r.path === 'media/a.png'), 'the logo bytes are kept');
  assert.deepEqual(kinds(d), ['layout']);
});

test('a form (Name: | blank, Date: | blank) is its labels, with no column heading and no rule', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(para('Name:')), tc(para(''))), tr(tc(para('Date:')), tc(para('')))])));
  assert.deepEqual(d.blocks.map((b) => [b.type, b.text]), [['para', 'Name:'], ['para', 'Date:']]);
  assert.equal(d.tableKinds[0].reason, 'form (label: blank)');
});

test('photo beside a biography keeps the heading, picture and paragraphs as blocks', async () => {
  const d = await parseDocx(docx(tbl([tr(
    tc(`<w:p>${pic('Portrait of Jane Smith')}</w:p>`),
    tc(para('Jane Smith', 'Heading2'), para('Jane taught braille for thirty years.'), para('She lives in Leeds.')),
  )])));
  assert.deepEqual(d.blocks.map((b) => b.type), ['graphic', 'heading', 'para', 'para']);
  assert.equal(d.blocks[1].level, 2);
  assert.equal(d.blocks[1].text, 'Jane Smith');
});

test('two columns of prose are read left column first, then right', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(para('Left one.'), para('Left two.')), tc(para('Right one.'), para('Right two.')))])));
  assert.deepEqual(d.blocks.map((b) => b.text), ['Left one.', 'Left two.', 'Right one.', 'Right two.']);
  assert.ok(d.blocks.every((b) => b.type === 'para'));
});

test('a one-cell sidebar keeps its heading, paragraph and list; lists do not run on across cells', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(para('Did you know?', 'Heading2'), para('Braille has six dots.'), bullet('Dot 1'), bullet('Dot 2')))])
    + tbl([tr(tc(bullet('Left item')), tc(bullet('Right item')))])));
  assert.deepEqual(d.blocks.map((b) => b.type), ['heading', 'para', 'list', 'list', 'list']);
  assert.deepEqual(d.blocks[2].items.map((i) => i.text), ['Dot 1', 'Dot 2']);
  assert.deepEqual(kinds(d), ['layout', 'layout']);
});

test('a data table nested in a layout table stays a table', async () => {
  const inner = tbl([tr(tc(para('City')), tc(para('Population'))), tr(tc(para('Leeds')), tc(para('812,000'))), tr(tc(para('York')), tc(para('202,000')))]);
  const d = await parseDocx(docx(tbl([tr(tc(para('Facts', 'Heading2'), inner))])));
  assert.deepEqual(d.blocks.map((b) => b.type), ['heading', 'table']);
  assert.deepEqual(d.blocks[1].headers, ['City', 'Population']);
  assert.deepEqual(kinds(d), ['layout', 'data']);
});

// ---------------------------------------------------------------- real data tables stay tables
test('a normal grid with a heading row stays a table', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(para('Animal')), tc(para('Legs')), tc(para('Habitat'))),
    tr(tc(para('Spider')), tc(para('8')), tc(para('Everywhere'))), tr(tc(para('Horse')), tc(para('4')), tc(para('Grassland')))])));
  const tb = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(tb.headers, ['Animal', 'Legs', 'Habitat']);
  assert.equal(tb.rows.length, 2);
  assert.deepEqual(d.tableKinds, [{ kind: 'data', reason: 'heading-like first row' }]);
});

test('a two-column term/definition table with a heading row stays a table', async () => {
  const def = 'the process by which green plants use sunlight to make food from carbon dioxide and water, releasing oxygen';
  const d = await parseDocx(docx(tbl([tr(tc(para('Term')), tc(para('Definition'))),
    tr(tc(para('photosynthesis')), tc(para(def))), tr(tc(para('respiration')), tc(para('the release of energy from food in cells'))),
  ])));
  const tb = d.blocks.find((b) => b.type === 'table');
  assert.deepEqual(tb.headers, ['Term', 'Definition']);
  assert.equal(tb.rows[0][1], def);
  assert.deepEqual(kinds(d), ['data']);
});

test('a picture in a data-table cell stays in its cell (with its bytes), not after the table', async () => {
  const d = await parseDocx(docx(tbl([tr(tc(para('Animal')), tc(para('Picture'))),
    tr(tc(para('Cat')), tc(`<w:p>${pic('A tabby cat')}</w:p>`)), tr(tc(para('Dog')), tc(para('none')))])));
  assert.deepEqual(d.blocks.map((b) => b.type), ['table'], 'no graphic block after the table');
  const cell = d.blocks[0].rows[0][1];
  const seg = cellSegments(cell).find((g) => g.type === 'imgnote');
  assert.ok(seg, 'the picture is an inline picture note in its cell');
  assert.equal(seg.text, 'A tabby cat');
  assert.equal(seg.src, 'media/a.png');
  assert.ok((d.resources || []).some((r) => r.path === 'media/a.png'), 'its bytes are embedded');
  const xml = exportToNimasXml(d);
  assert.match(xml, /<td><img src="media\/a\.png" alt="A tabby cat"\/><\/td>/);
  assert.ok(buildNimasPackage(d).files.some((f) => f.name.endsWith('/media/a.png')), 'a saved NIMAS package carries the picture file');
  assert.deepEqual(kinds(d), ['data']);
});

test('a picture-heavy table with a marked header row stays a table', async () => {
  const d = await parseDocx(docx(tbl([trHeader(tc(para('Photo')), tc(para('About'))),
    tr(tc(`<w:p>${pic('Jane')}</w:p>`), tc(para('Jane taught braille.'), para('She lives in Leeds.'), para('She has a dog.')))])));
  assert.equal(d.blocks[0].type, 'table');
  assert.deepEqual(d.tableKinds, [{ kind: 'data', reason: 'marked header row' }]);
});

test('a single-row table with Word\'s header-row flag stays a table (heading row only)', async () => {
  const d = await parseDocx(docx(tbl([trHeader(tc(para('Name')), tc(para('Score')))])));
  assert.deepEqual(d.blocks.map((b) => b.type), ['table']);
  assert.deepEqual(d.blocks[0].headers, ['Name', 'Score']);
  assert.deepEqual(d.blocks[0].rows, []);
  assert.deepEqual(kinds(d), ['data']);
});

test('alt text and a data-table style mark a table as data', async () => {
  const one = tbl([tr(tc(para('Only one row')), tc(para('of prose')))], '<w:tblCaption w:val="Results"/>');
  const two = tbl([tr(tc(para('Only one row')), tc(para('of prose')))], '<w:tblStyle w:val="GridTable4-Accent1"/>');
  const d = await parseDocx(docx(one + para('between') + two));
  assert.deepEqual(d.blocks.map((b) => b.type), ['table', 'para', 'table']);
  assert.deepEqual(d.tableKinds.map((k) => k.reason), ['table alt text or caption', 'data table style "GridTable4-Accent1"']);
});

// ---------------------------------------------------------------- captions
const dataRows = [tr(tc(para('Region')), tc(para('Population'))), tr(tc(para('North')), tc(para('1200'))), tr(tc(para('South')), tc(para('900')))];

test('a "Table n" Caption paragraph before the table becomes its title', async () => {
  const d = await parseDocx(docx(para('Table 1: Population by region', 'Caption') + tbl(dataRows) + para('After.')));
  assert.deepEqual(d.blocks.map((b) => b.type), ['table', 'para']);
  assert.equal(d.blocks[0].title, 'Table 1: Population by region');
});

test('a "Table n" Caption paragraph after the table becomes its title', async () => {
  const d = await parseDocx(docx(para('Before.') + tbl(dataRows) + para('Table 2: Population by region', 'Caption') + para('After.')));
  assert.deepEqual(d.blocks.map((b) => b.type), ['para', 'table', 'para']);
  assert.equal(d.blocks[1].title, 'Table 2: Population by region');
  assert.equal(d.blocks[2].text, 'After.');
});

test('a SEQ Table field marks the paragraph as the table\'s label even without the Caption style', async () => {
  const seq = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ Table \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const d = await parseDocx(docx(`<w:p>${t('Table ')}${seq}${t(': Rainfall')}</w:p>` + tbl(dataRows)));
  assert.deepEqual(d.blocks.map((b) => b.type), ['table']);
  assert.equal(d.blocks[0].title, 'Table 3: Rainfall');
});

test('a Caption paragraph that is not a label becomes a caption block before the table (BANA 11.2.8a)', async () => {
  const d = await parseDocx(docx(tbl(dataRows) + para('Figures are estimates for 2020.', 'Caption') + para('Source: census', 'Caption')));
  assert.deepEqual(d.blocks.map((b) => b.type), ['caption', 'table', 'para']);
  assert.equal(d.blocks[0].text, 'Figures are estimates for 2020.');
  assert.equal(d.blocks[2].text, 'Source: census', 'a source line stays where it is');
});

// ---------------------------------------------------------------- NIMAS export
test('a table with a heading row only exports no empty <td/> row, stays valid in shape, and reads back', async () => {
  const xml = exportToNimasXml({ title: 'T', blocks: [{ type: 'table', headers: ['Name', 'Score'], rows: [] }] });
  const table = xml.slice(xml.indexOf('<table'), xml.indexOf('</table>') + 8);
  assert.doesNotMatch(table, /<td>\s*<\/td>|<td\/>/, 'no spurious empty data row');
  assert.match(table, /<tbody>\s*<tr>\s*<th>Name<\/th>\s*<th>Score<\/th>\s*<\/tr>\s*<\/tbody>/, 'the heading row is the table\'s one row');
  const back = parseDtbook(xml).blocks.find((b) => b.type === 'table');
  assert.deepEqual(back.headers.map(cellPlainText), ['Name', 'Score']);
  assert.deepEqual(back.rows, []);
});

// ---------------------------------------------------------------- the rule itself (every reader)
test('classifyTable: explicit signals and structure', () => {
  const c = (text, more = {}) => ({ text, paragraphs: text ? 1 : 0, images: 0, headings: 0, lists: 0, tables: 0, span: 1, ...more });
  const grid = [[c('A'), c('B')], [c('1'), c('2')], [c('3'), c('4')]];
  assert.equal(classifyTable({ rows: grid, role: 'presentation' }).kind, 'layout', 'HTML role=presentation');
  assert.equal(classifyTable({ rows: [[c('x')]], headerRow: true }).kind, 'data', 'marked header row wins over one cell');
  assert.equal(classifyTable({ rows: grid }).kind, 'data');
  assert.equal(classifyTable({ rows: [[c('')], [c('')]] }).empty, true);
  assert.equal(classifyTable({ rows: [[c('Only')], [c('one')], [c('column')]] }).reason, 'single column');
  assert.equal(classifyTable({ rows: [[c('Name:'), c('____')], [c('Signed:'), c('')]] }).form, true, 'underscore write-on line counts as a blank');
  assert.equal(classifyTable({ rows: [[c('x', { images: 1 }), c('a much longer piece of text that is not a heading at all, running on')], [c('y', { images: 1 }), c('more')]] }).kind, 'layout');
  assert.equal(isLayoutTable({ rows: [[c('Mon'), c('Tue')], [c('rain'), c('sun')]] }), false, 'uncertain → data');
  assert.equal(isLayoutTable({ rows: [[c('Light'), c('One')]], styleName: 'Light Shading Accent 1' }), false);
});
