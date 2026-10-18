// D8 (g4-real-file-import.md): table CELL content keeps its structure on import.
// A cell with emphasis, a link or a note reference is a { text, segments } object
// (format/cell-markup.mjs); a plain cell stays a string. Paragraphs in a cell are joined by
// a space (a '\n' is only understood by the stairstep format). A picture in an ODT / HTML cell
// becomes a graphic block after the table (a Word data table keeps it in the cell — see
// layout_tables.test.mjs), and a note's body follows the table too.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseDocx, parseOdt, parseDtbook, parseHtml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
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

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const run = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const cell = (...paras) => `<w:tc>${paras.map((p) => `<w:p>${p}</w:p>`).join('')}</w:tc>`;

function docxWithTable() {
  const doc = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:tbl>
    <w:tr>${cell(run('Name'))}${cell(run('Head ', '<w:b/>') + run('two'))}</w:tr>
    <w:tr>${cell(run('Plain'))}${cell(run('bold ', '<w:b/>') + run('and ') + run('ital', '<w:i/>') + '<w:hyperlink r:id="rIdL">' + run('link') + '</w:hyperlink>')}</w:tr>
    <w:tr>${cell(run('First paragraph'), run('Second paragraph'))}${cell(run('noted') + '<w:r><w:footnoteReference w:id="2"/></w:r>')}</w:tr>
    <w:tr>${cell(run('with picture') + '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="P" descr="A pic"/><a:graphic><a:graphicData><a:blip r:embed="rIdI"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')}${cell(run('x'))}</w:tr>
  </w:tbl><w:p>${run('After')}</w:p></w:body></w:document>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rIdL" Type="x/hyperlink" Target="https://example.org/a" TargetMode="External"/>
    <Relationship Id="rIdI" Type="x/image" Target="media/a.png"/></Relationships>`;
  const notes = `<?xml version="1.0"?><w:footnotes ${W_NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
    <w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r>${run(' The footnote body.')}</w:p></w:footnote></w:footnotes>`;
  return makeZip({ 'word/document.xml': doc, 'word/_rels/document.xml.rels': rels, 'word/footnotes.xml': notes, 'word/media/a.png': PNG });
}

test('DOCX: emphasis, link, note and picture in a cell are kept; plain cells stay strings', async () => {
  const d = await parseDocx(docxWithTable());
  const ti = d.blocks.findIndex((b) => b.type === 'table');
  const t = d.blocks[ti];
  assert.deepEqual(t.headers[0], 'Name');
  assert.equal(t.headers[1].text, 'Head two');
  assert.equal(t.headers[1].segments[0].tf, 4);
  assert.equal(t.rows[0][0], 'Plain');
  const c = t.rows[0][1];
  assert.equal(c.text, 'bold and itallink');
  assert.ok(c.segments.some((g) => g.tf === 4 && g.text === 'bold '));
  assert.ok(c.segments.some((g) => g.tf === 1 && g.text === 'ital'));
  assert.ok(c.segments.some((g) => g.href === 'https://example.org/a' && g.text === 'link'));
  assert.equal(t.rows[1][0], 'First paragraph Second paragraph', 'paragraphs are separated');
  assert.ok(t.rows[1][1].segments.some((g) => g.type === 'noteref'));
  const after = d.blocks.slice(ti + 1);
  assert.ok(after.some((b) => b.type === 'footnote' && /footnote body/.test(b.text || '')), 'the note body follows the table');
  // layout_tables.test.mjs: a picture in a Word DATA table's cell now stays in its cell, as an
  // inline picture note (imgnote) with its file, instead of a graphic block after the table.
  assert.ok(!after.some((b) => b.type === 'graphic'), 'the cell picture is not moved after the table');
  const g = t.rows[2][0].segments.find((s) => s.type === 'imgnote');
  assert.ok(g && g.text === 'A pic' && g.src === 'media/a.png', 'the cell picture stays in its cell');
  assert.ok((d.resources || []).length >= 1, 'and its bytes are embedded');
});

const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
function odtWithTable() {
  const content = `<?xml version="1.0"?><office:document-content ${ODT_NS}>
  <office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles>
  <office:body><office:text><table:table table:name="T">
   <table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Value</text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><text:p>Plain</text:p></table:table-cell>
     <table:table-cell><text:p><text:span text:style-name="T1">bold </text:span>and <text:span text:style-name="T2">ital</text:span><text:a xlink:href="https://example.org/o">link</text:a></text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><text:p>First</text:p><text:p>Second</text:p></table:table-cell>
     <table:table-cell><text:p>noted<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>The odt note.</text:p></text:note-body></text:note></text:p></table:table-cell></table:table-row>
   <table:table-row><table:table-cell><table:table><table:table-row><table:table-cell><text:p>nested <draw:frame draw:name="F"><draw:image xlink:href="Pictures/a.png"/><svg:title>An image</svg:title></draw:frame></text:p></table:table-cell></table:table-row></table:table></table:table-cell><table:table-cell><text:p>y</text:p></table:table-cell></table:table-row>
  </table:table><text:p>After</text:p></office:text></office:body></office:document-content>`;
  return makeZip({ 'content.xml': content, 'Pictures/a.png': PNG });
}

test('ODT: emphasis, link, note and picture in a cell are kept; paragraphs are separated', async () => {
  const d = await parseOdt(odtWithTable());
  const ti = d.blocks.findIndex((b) => b.type === 'table');
  const t = d.blocks[ti];
  assert.equal(t.rows[1][0], 'Plain');
  const c = t.rows[1][1];
  assert.equal(c.text, 'bold and itallink');
  assert.ok(c.segments.some((g) => g.tf === 4) && c.segments.some((g) => g.tf === 1) && c.segments.some((g) => g.href === 'https://example.org/o'));
  assert.equal(t.rows[2][0], 'First Second');
  assert.ok(t.rows[2][1].segments.some((g) => g.type === 'noteref'));
  const after = d.blocks.slice(ti + 1);
  assert.ok(after.some((b) => b.type === 'footnote' && /odt note/.test(b.text || '')));
  assert.ok(after.some((b) => b.type === 'graphic' && b.alt === 'An image'), 'the picture in a nested layout table is kept');
  // IMP-W6 (Paul, 30 Sep 2026): a nested table is no longer flattened into its cell ('nested'); the cell holds "(table follows)" and the
  // inner table follows the outer one as a table of its own.
  assert.equal(t.rows[3][0], '(table follows)');
  assert.ok(after.some((b) => b.type === 'table' && JSON.stringify(b.rows) === '[["nested"]]'), 'the nested table follows, with its text');
});

test('exporter writes the cell markup and it survives a re-parse (DOCX and ODT)', async () => {
  for (const d of [await parseDocx(docxWithTable()), await parseOdt(odtWithTable())]) {
    const xml = exportToNimasXml(d);
    assert.match(xml, /<td>[^<]*<strong>bold <\/strong>/);
    assert.match(xml, /<a href="https:\/\/example\.org\/[ao]">link<\/a>/);
    assert.match(xml, /<td>[^]*?<noteref/);
    const back = parseDtbook(xml).blocks.find((b) => b.type === 'table');
    const cells = [...back.headers, ...back.rows.flat()];
    const c = cells.find((x) => cellPlainText(x) === 'bold and itallink');
    assert.ok(c, 'the rich cell is back');
    const segs = cellSegments(c);
    assert.ok(segs.some((g) => g.tf === 4) && segs.some((g) => g.tf === 1) && segs.some((g) => g.href));
    assert.ok(cells.some((x) => cellSegments(x).some((g) => g.type === 'noteref')));
    assert.ok(cells.includes('Plain'));
  }
});

test('HTML: emphasis, a link and a picture in a cell are kept', () => {
  const d = parseHtml('<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td><b>bold</b> <a href="https://e.org/">l</a><img src="a.png" alt="pic"></td></tr></table>');
  const t = d.blocks.find((b) => b.type === 'table');
  assert.equal(t.rows[0][0], 'x');
  assert.ok(t.rows[0][1].segments.some((g) => g.tf === 4) && t.rows[0][1].segments.some((g) => g.href === 'https://e.org/'));
  assert.ok(d.blocks.some((b) => b.type === 'graphic' && b.alt === 'pic'), 'the cell picture follows the table');
  assert.equal(parseHtml('<table><tr><th>A</th></tr><tr><td>plain</td></tr></table>').blocks[0].rows[0][0], 'plain');
});
