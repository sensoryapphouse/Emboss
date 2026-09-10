// Regression gate for inline maths inside a docx HEADING or LIST ITEM (reviewer
// finding #9): the heading must keep its level (and TOC inclusion) and the list
// must stay one continuous block, with the equation preserved as a segment —
// instead of collapsing to a plain paragraph / splitting the list.
import zlib from 'zlib';
import { DOMParser } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
import { parseDocx } from '../input/parse.mjs';

// minimal STORE (uncompressed) zip containing one entry — enough for parseDocx
function makeDocx(documentXml) {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from(documentXml);
  const crc = zlib.crc32(data);
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4);
  lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  const local = Buffer.concat([lfh, name, data]);
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6);
  cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28); cdh.writeUInt32LE(0, 42);
  const central = Buffer.concat([cdh, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  const buf = Buffer.concat([local, central, eocd]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// multi-entry STORE zip (for a docx that also carries word/numbering.xml)
function makeDocxMulti(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, xml } of entries) {
    const nameB = Buffer.from(name), data = Buffer.from(xml), crc = zlib.crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22); lfh.writeUInt16LE(nameB.length, 26);
    const local = Buffer.concat([lfh, nameB, data]);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6);
    cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameB.length, 28); cdh.writeUInt32LE(offset, 42);
    locals.push(local); centrals.push(Buffer.concat([cdh, nameB])); offset += local.length;
  }
  const localAll = Buffer.concat(locals), centralAll = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralAll.length, 12); eocd.writeUInt32LE(localAll.length, 16);
  const buf = Buffer.concat([localAll, centralAll, eocd]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const omath = (v) => `<m:oMath><m:r><m:t>${v}</m:t></m:r></m:oMath>`;
const numPr = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
const xml = `<w:document ${W} ${M}><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter </w:t></w:r>${omath('x')}</w:p>
  <w:p>${numPr}<w:r><w:t>First item</w:t></w:r></w:p>
  <w:p>${numPr}<w:r><w:t>Middle with </w:t></w:r>${omath('y')}<w:r><w:t> equation</w:t></w:r></w:p>
  <w:p>${numPr}<w:r><w:t>Third item</w:t></w:r></w:p>
</w:body></w:document>`;

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`); } };

(async () => {
  const { blocks } = await parseDocx(makeDocx(xml));
  const summary = blocks.map((b) => b.type + (b.level ? `(L${b.level})` : '') + (b.segments ? '[seg]' : '') + (b.items ? `{${b.items.length}}` : ''));

  const heading = blocks.find((b) => b.type === 'heading');
  check('heading kept its type + level (not demoted to para)', !!heading && heading.level === 1, JSON.stringify(summary));
  check('heading carries maths segments', !!heading && !!heading.segments && heading.segments.some((s) => s.type === 'math'));
  check('heading keeps text (for the TOC entry)', !!heading && (heading.text || '').includes('Chapter'));

  const lists = blocks.filter((b) => b.type === 'list');
  check('the list is ONE continuous block (not split by the maths item)', lists.length === 1, JSON.stringify(summary));
  const items = lists[0]?.items || [];
  check('list has all 3 items', items.length === 3, JSON.stringify(items));
  check('middle item carries maths segments in order', !!items[1]?.segments && items[1].segments.some((s) => s.type === 'math') && items[1].segments.some((s) => s.type === 'text'));
  check('first/third items are plain text', items[0]?.text === 'First item' && items[2]?.text === 'Third item');

  // Regression: docx run emphasis (w:rPr b/i/u) → liblouis typeform bits (bold=4, italic=1, underline=2).
  const emphXml = `<w:document ${W}><w:body>
    <w:p><w:r><w:t>normal </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>ital</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>under</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>notbold</w:t></w:r></w:p>
  </w:body></w:document>`;
  const eb = (await parseDocx(makeDocx(emphXml))).blocks;
  const boldRun = eb[0]?.segments?.find((s) => s.text === 'bold');
  check('bold run → tf bold(4)', boldRun?.tf === 4, JSON.stringify(eb[0]));
  check('plain run before bold has no tf', eb[0]?.segments?.[0]?.tf === undefined);
  check('italic run → tf italic(1)', eb[1]?.segments?.[0]?.tf === 1);
  check('underline run → tf underline(2)', eb[2]?.segments?.[0]?.tf === 2);
  check('w:b val="false" → not bold (plain text path)', eb[3]?.segments === undefined && eb[3]?.text === 'notbold');

  // Regression: docx numbered-list markers computed from word/numbering.xml (bug #9 follow-up).
  const numXml = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const numLowerXml = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const listBody = `<w:document ${W}><w:body>
    <w:p>${numPr}<w:r><w:t>First</w:t></w:r></w:p>
    <w:p>${numPr}<w:r><w:t>Second</w:t></w:r></w:p>
    <w:p>${numPr}<w:r><w:t>Third</w:t></w:r></w:p>
  </w:body></w:document>`;

  const decBlocks = (await parseDocx(makeDocxMulti([{ name: 'word/document.xml', xml: listBody }, { name: 'word/numbering.xml', xml: numXml }]))).blocks;
  const decList = decBlocks.find((b) => b.type === 'list');
  check('docx decimal list → "1." "2." "3." markers', JSON.stringify(decList?.items.map((i) => i.marker)) === '["1.","2.","3."]', JSON.stringify(decList?.items));

  const alphaBlocks = (await parseDocx(makeDocxMulti([{ name: 'word/document.xml', xml: listBody }, { name: 'word/numbering.xml', xml: numLowerXml }]))).blocks;
  const alphaList = alphaBlocks.find((b) => b.type === 'list');
  check('docx lowerLetter list → "a)" "b)" "c)" markers (lvlText honoured)', JSON.stringify(alphaList?.items.map((i) => i.marker)) === '["a)","b)","c)"]', JSON.stringify(alphaList?.items));

  // No numbering.xml → we can't tell ordered from bullet, so markers stay absent (unchanged behaviour, byte-exact path preserved).
  const noNumBlocks = (await parseDocx(makeDocx(`<w:document ${W}><w:body><w:p>${numPr}<w:r><w:t>First</w:t></w:r></w:p></w:body></w:document>`))).blocks;
  check('docx list WITHOUT numbering.xml stays markerless', noNumBlocks.find((b) => b.type === 'list')?.items?.[0]?.marker === undefined);

  console.log(`\ndocx inline-maths gate: ${pass}/${pass + fail} checks pass`);
  process.exit(fail ? 1 : 0);
})();
