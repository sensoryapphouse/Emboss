// Word (.docx) import fixes, batch of 30 Sep 2026 — import fix list (Emboss/docs/import-fix-list.md) items
// #1b, #15d, #2 + audit w15, #1c, #10 + audit w11, #8, #5 + audit w12, #34, audit w10, #36 + audit w03, #30b, #1e.
// Each group below names the list item it covers. Every test was written to FAIL against the parse.mjs / nimas-export.mjs
// as they were before this batch (shown by pointing PARSE_MJS / NIMAS_MJS at saved copies placed next to the real files).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const { parseDocx, parseDtbook } = await import(process.env.PARSE_MJS || '../input/parse.mjs');
const { exportToNimasXml } = await import(process.env.NIMAS_MJS || '../input/nimas-export.mjs');
const { makeZip } = await import('../web/zip.mjs');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:mc="${MC}" xmlns:w14="${W14}" xmlns:wps="${WPS}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:v="${V}"`;

/** Build a .docx in memory and read it. parts: extra {name, text}; styles/numbering/footnotes/endnotes: the part's inner XML. */
async function read({ body, styles, numbering, footnotes, endnotes, parts = [] }) {
  const files = [{ name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>` }];
  if (styles) files.push({ name: 'word/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>${styles}</w:styles>` });
  if (numbering) files.push({ name: 'word/numbering.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${numbering}</w:numbering>` });
  if (footnotes) files.push({ name: 'word/footnotes.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}>${footnotes}</w:footnotes>` });
  if (endnotes) files.push({ name: 'word/endnotes.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${NS}>${endnotes}</w:endnotes>` });
  files.push(...parts);
  return parseDocx(await makeZip(files).arrayBuffer());
}
const p = (t, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const run = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const tc = (inner) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
// A two-row table whose first row is a marked header row: always read as a DATA table (table-kind.mjs signal 2).
const dataTable = (h1, h2, c1, c2, extra = '') => `<w:tbl><w:tblPr>${extra}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
  + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p(h1))}${tc(p(h2))}</w:tr><w:tr>${tc(p(c1))}${tc(p(c2))}</w:tr></w:tbl>`;
/** All the text of a model, in order, as one string (words only). */
function allText(x) {
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'object') {
      if (Array.isArray(n.segments)) { for (const s of n.segments) if (typeof s.text === 'string') out.push(s.text); }
      else if (typeof n.text === 'string') out.push(n.text);
      for (const k of ['headers', 'rows', 'items', 'blocks', 'cells']) if (n[k]) walk(n[k]);
      for (const k of ['title', 'caption']) if (typeof n[k] === 'string') out.push(n[k]);
    }
  };
  walk(x);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
const cellText = (c) => (typeof c === 'string' ? c : (c && c.text) || '');
const tables = (doc) => doc.blocks.filter((b) => b.type === 'table');
const words = (s) => s.split(/\s+/).filter(Boolean);
const count = (hay, needle) => hay.split(needle).length - 1;

// ============================================================================================================
// #1b  Body-level wrappers whose content disappears: mc:AlternateContent, w:customXml, tracked w:ins/w:del/w:moveTo/w:moveFrom.
// ============================================================================================================
test('#1b: a body-level mc:AlternateContent is read once — the Choice when understood, else the Fallback, never both', async () => {
  const doc = await read({ body:
    `<mc:AlternateContent><mc:Choice Requires="w14">${p('Choice paragraph one')}${p('Choice paragraph two')}</mc:Choice><mc:Fallback>${p('Fallback paragraph')}</mc:Fallback></mc:AlternateContent>`
    + `<mc:AlternateContent><mc:Choice Requires="zzz9" xmlns:zzz9="urn:unknown:ext">${p('Unknown choice')}</mc:Choice><mc:Fallback>${p('Used fallback')}</mc:Fallback></mc:AlternateContent>`
    + p('After') });
  const t = allText(doc.blocks);
  assert.match(t, /Choice paragraph one/); assert.match(t, /Choice paragraph two/);
  assert.doesNotMatch(t, /Fallback paragraph/);
  assert.doesNotMatch(t, /Unknown choice/);
  assert.match(t, /Used fallback/);
  assert.match(t, /After/);
});

test('#1b: a body-level w:customXml wrapping paragraphs or a table keeps their text', async () => {
  const doc = await read({ body:
    `<w:customXml w:uri="urn:x" w:element="e">${p('Inside custom xml')}</w:customXml>`
    + `<w:customXml w:uri="urn:x" w:element="t">${dataTable('HeadA', 'HeadB', 'cellA', 'cellB')}</w:customXml>` });
  assert.match(allText(doc.blocks), /Inside custom xml/);
  assert.equal(tables(doc).length, 1, 'the wrapped table is still a table');
  assert.deepEqual(tables(doc)[0].headers.map(cellText), ['HeadA', 'HeadB']);
});

test('#1b: tracked changes around whole paragraphs or tables at body level — the accepted view', async () => {
  const doc = await read({ body:
    `<w:ins w:id="1" w:author="a">${p('Inserted paragraph')}</w:ins>`
    + `<w:del w:id="2" w:author="a">${p('Deleted paragraph')}</w:del>`
    + `<w:moveTo w:id="3" w:author="a">${p('Moved here paragraph')}</w:moveTo>`
    + `<w:moveFrom w:id="4" w:author="a">${p('Moved away paragraph')}</w:moveFrom>`
    + `<w:ins w:id="5" w:author="a">${dataTable('InsHeadA', 'InsHeadB', 'insA', 'insB')}</w:ins>`
    + `<w:del w:id="6" w:author="a">${dataTable('DelHeadA', 'DelHeadB', 'delA', 'delB')}</w:del>` });
  const t = allText(doc.blocks);
  assert.match(t, /Inserted paragraph/);
  assert.match(t, /Moved here paragraph/);
  assert.doesNotMatch(t, /Deleted paragraph/);
  assert.doesNotMatch(t, /Moved away paragraph/);
  assert.equal(tables(doc).length, 1, 'only the inserted table');
  assert.deepEqual(tables(doc)[0].headers.map(cellText), ['InsHeadA', 'InsHeadB']);
  assert.doesNotMatch(t, /DelHead/);
});

test('#1b: the same wrappers inside a data-table cell', async () => {
  const cell = `<w:ins w:id="1" w:author="a">${p('InsCellPara')}</w:ins><w:del w:id="2" w:author="a">${p('DelCellPara')}</w:del>`
    + `<w:moveFrom w:id="3" w:author="a">${p('MovedAwayCellPara')}</w:moveFrom><w:moveTo w:id="4" w:author="a">${p('MovedHereCellPara')}</w:moveTo>`
    + `<w:customXml w:uri="urn:x" w:element="e">${p('CustomCellPara')}</w:customXml>`
    + `<mc:AlternateContent><mc:Choice Requires="w14">${p('ChoiceCellPara')}</mc:Choice><mc:Fallback>${p('FallbackCellPara')}</mc:Fallback></mc:AlternateContent>`;
  const doc = await read({ body: `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}</w:tr><w:tr>${tc(cell)}${tc(p('plain'))}</w:tr></w:tbl>` });
  assert.equal(tables(doc).length, 1);
  const c = cellText(tables(doc)[0].rows[0][0]);
  for (const want of ['InsCellPara', 'MovedHereCellPara', 'CustomCellPara', 'ChoiceCellPara']) assert.ok(c.includes(want), `${want} in: ${c}`);
  for (const no of ['DelCellPara', 'MovedAwayCellPara', 'FallbackCellPara']) assert.ok(!c.includes(no), `${no} not in: ${c}`);
});

test('#1b: the same wrappers inside a footnote', async () => {
  const note = `<w:footnote w:id="2">${'<w:ins w:id="1" w:author="a">' + p('InsNotePara') + '</w:ins>'}<w:del w:id="2" w:author="a">${p('DelNotePara')}</w:del>`
    + `<w:customXml w:uri="urn:x" w:element="e">${p('CustomNotePara')}</w:customXml></w:footnote>`;
  const doc = await read({ body: `<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`, footnotes: note });
  const t = allText(doc.blocks);
  assert.match(t, /InsNotePara/); assert.match(t, /CustomNotePara/); assert.doesNotMatch(t, /DelNotePara/);
});

// ============================================================================================================
// #15d  Run-level mc:AlternateContent: both Choice and Fallback were read, doubling the text.
// ============================================================================================================
test('#15d: a run-level mc:AlternateContent is read once (Choice when understood, else Fallback)', async () => {
  const doc = await read({ body:
    `<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r>`
    + `<mc:AlternateContent><mc:Choice Requires="w14">${run('chosen words ')}</mc:Choice><mc:Fallback>${run('fallback words ')}</mc:Fallback></mc:AlternateContent>`
    + `<mc:AlternateContent><mc:Choice Requires="zzz9" xmlns:zzz9="urn:unknown:ext">${run('unknown words ')}</mc:Choice><mc:Fallback>${run('rescue words ')}</mc:Fallback></mc:AlternateContent>`
    + `<w:r><w:t>after.</w:t></w:r></w:p>` });
  const t = allText(doc.blocks);
  assert.equal(t, 'Before chosen words rescue words after.');
});

test('#15d: the same inside a bold paragraph (segment path) and a table cell', async () => {
  const para = `<w:p>${run('Bold ', '<w:b/>')}<mc:AlternateContent><mc:Choice Requires="w14">${run('twice?', '<w:b/>')}</mc:Choice><mc:Fallback>${run('twice?', '<w:b/>')}</mc:Fallback></mc:AlternateContent></w:p>`;
  const cellPara = `<w:p><mc:AlternateContent><mc:Choice Requires="w14">${run('once')}</mc:Choice><mc:Fallback>${run('once')}</mc:Fallback></mc:AlternateContent></w:p>`;
  const doc = await read({ body: para + `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}</w:tr><w:tr>${tc(cellPara)}${tc(p('x'))}</w:tr></w:tbl>` });
  assert.equal(allText(doc.blocks.filter((b) => b.type === 'para')), 'Bold twice?');
  assert.equal(cellText(tables(doc)[0].rows[0][0]), 'once');
});

// ============================================================================================================
// #2 + audit w15  Content controls (w:sdt).
// ============================================================================================================
test('#2: an sdt around a table cell (and around a row) keeps the text', async () => {
  const doc = await read({ body: `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}</w:tr>`
    + `<w:tr>${tc(p('c1'))}<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${tc(p('Body copy'))}</w:sdtContent></w:sdt></w:tr>`
    + `<w:sdt><w:sdtPr><w:id w:val="2"/></w:sdtPr><w:sdtContent><w:tr>${tc(p('rowA'))}${tc(p('rowB'))}</w:tr></w:sdtContent></w:sdt>`
    + `</w:tbl>` });
  const t = tables(doc)[0];
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0].map(cellText), ['c1', 'Body copy']);
  assert.deepEqual(t.rows[1].map(cellText), ['rowA', 'rowB']);
});

test('#2: an sdt around the HEADER cell of a table keeps the header', async () => {
  const doc = await read({ body: `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${tc(p('SdtHeader'))}</w:sdtContent></w:sdt></w:tr>`
    + `<w:tr>${tc(p('a'))}${tc(p('b'))}</w:tr></w:tbl>` });
  assert.deepEqual(tables(doc)[0].headers.map(cellText), ['H1', 'SdtHeader']);
});

test('w15: a data table inside a block content control stays a table', async () => {
  const doc = await read({ body: `<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>${dataTable('SdtH1', 'SdtH2', 'sdtc1', 'sdtc2')}</w:sdtContent></w:sdt>` });
  assert.equal(tables(doc).length, 1);
  assert.deepEqual(tables(doc)[0].headers.map(cellText), ['SdtH1', 'SdtH2']);
  assert.deepEqual(tables(doc)[0].rows[0].map(cellText), ['sdtc1', 'sdtc2']);
});

test('w15: an unfilled content control (w:showingPlcHdr) does not transcribe its placeholder prompt', async () => {
  const ph = (inner, extra = '') => `<w:sdtPr><w:id w:val="9"/><w:showingPlcHdr${extra}/><w:text/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent>`;
  const doc = await read({ body:
    p('Inline: ') .replace('</w:p>', `<w:sdt>${ph(run('Click here to enter text'))}</w:sdt><w:r><w:t> end.</w:t></w:r></w:p>`)
    + `<w:sdt>${ph(p('Block placeholder prompt'))}</w:sdt>`
    + `<w:sdt><w:sdtPr><w:id w:val="10"/><w:showingPlcHdr w:val="0"/></w:sdtPr><w:sdtContent>${p('Filled in text')}</w:sdtContent></w:sdt>`
    + `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}</w:tr>`
    + `<w:tr>${tc(`<w:sdt>${ph(p('Cell placeholder prompt'))}</w:sdt>` + p('real cell text'))}${tc(p('x'))}</w:tr></w:tbl>` });
  const t = allText(doc.blocks);
  assert.doesNotMatch(t, /Click here|Block placeholder|Cell placeholder/);
  assert.match(t, /Inline:\s+end\./);
  assert.match(t, /Filled in text/, 'showingPlcHdr w:val="0" means the control is filled in');
  assert.match(t, /real cell text/);
});

test('w15: an unfilled content control around a table CELL leaves an empty cell (the columns do not shift)', async () => {
  const doc = await read({ body: `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}${tc(p('H3'))}</w:tr>`
    + `<w:tr>${tc(p('a'))}<w:sdt><w:sdtPr><w:id w:val="1"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent>${tc(p('Choose an item.'))}</w:sdtContent></w:sdt>${tc(p('c'))}</w:tr></w:tbl>` });
  assert.deepEqual(tables(doc)[0].rows[0].map(cellText), ['a', '', 'c']);
});

// ============================================================================================================
// #1c  A table, list or content control inside a footnote/endnote loses its text.
// ============================================================================================================
test('#1c: a table, a content control and a list inside a footnote keep all their text', async () => {
  const fn = `<w:footnote w:id="2">${p('Note lead paragraph')}`
    + `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${tc(p('NoteCellOne'))}${tc(p('NoteCellTwo'))}</w:tr><w:tr>${tc(p('NoteCellThree'))}${tc(p('NoteCellFour'))}</w:tr></w:tbl>`
    + `<w:sdt><w:sdtPr><w:id w:val="1"/></w:sdtPr><w:sdtContent>${p('NoteSdtPara')}</w:sdtContent></w:sdt>`
    + p('NoteListOne', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') + p('NoteListTwo', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    + `</w:footnote>`;
  const numbering = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const doc = await read({ body: `<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`, footnotes: fn, numbering });
  const t = allText(doc.blocks);
  for (const w of ['Note lead paragraph', 'NoteCellOne', 'NoteCellTwo', 'NoteCellThree', 'NoteCellFour', 'NoteSdtPara', 'NoteListOne', 'NoteListTwo']) assert.ok(t.includes(w), `${w} kept: ${t}`);
  // the cells stay in reading order
  assert.ok(t.indexOf('NoteCellOne') < t.indexOf('NoteCellTwo') && t.indexOf('NoteCellTwo') < t.indexOf('NoteCellThree'));
});

test('#1c: a table inside an ENDNOTE keeps its text', async () => {
  const en = `<w:endnote w:id="2"><w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${tc(p('EndCellOne'))}</w:tr></w:tbl></w:endnote>`;
  const doc = await read({ body: `<w:p><w:r><w:t>Text</w:t></w:r><w:r><w:endnoteReference w:id="2"/></w:r></w:p>`, endnotes: en });
  assert.match(allText(doc.blocks), /EndCellOne/);
});

// ============================================================================================================
// #34  A bold-italic list item came in plain (statutory-guidance-probation-roles.docx): its runs carry the character
//      style "Heading 4 Char" — the auto-created twin (w:link) of the Heading 4 PARAGRAPH style. The twin's look was always
//      ignored (right inside a Heading 4 paragraph, where it is just the heading), even on words in a list paragraph.
// ============================================================================================================
const twinStyles = `<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:link w:val="Heading4Char"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>`
  + `<w:style w:type="character" w:customStyle="1" w:styleId="Heading4Char"><w:name w:val="Heading 4 Char"/><w:link w:val="Heading4"/><w:rPr><w:b/><w:i/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="MyHeading"><w:name w:val="My heading"/><w:basedOn w:val="Heading4"/></w:style>`
  + `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Numberedlist1"><w:name w:val="Numbered list 1"/></w:style>`;
const segTf = (b, text) => { const s = (b.segments || []).find((x) => (x.text || '').includes(text)); return s ? (s.tf || 0) : null; };
test('#34: the twin of a paragraph style, used on words in another kind of paragraph, is bold italic', async () => {
  const doc = await read({ styles: twinStyles, body:
    `<w:p><w:pPr><w:pStyle w:val="Numberedlist1"/></w:pPr>${run('Formal sign-off', '<w:rStyle w:val="Heading4Char"/>')}${run(' plain tail.')}</w:p>`
    + `<w:p>${run('Body words', '<w:rStyle w:val="Heading4Char"/>')}${run(' tail.')}</w:p>` });
  assert.equal(segTf(doc.blocks[0], 'Formal sign-off'), 5, 'bold (4) + italic (1): ' + JSON.stringify(doc.blocks[0]));
  assert.equal(segTf(doc.blocks[0], 'plain tail'), 0);
  assert.equal(segTf(doc.blocks[1], 'Body words'), 5, 'also in a paragraph with no style');
});
test('#34: inside a paragraph of the partner style (or one based on it) the twin is still just the paragraph look', async () => {
  const doc = await read({ styles: twinStyles, body:
    `<w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr>${run('A heading', '<w:rStyle w:val="Heading4Char"/>')}</w:p>`
    + `<w:p><w:pPr><w:pStyle w:val="MyHeading"/></w:pPr>${run('Another heading', '<w:rStyle w:val="Heading4Char"/>')}${run(' and more ')}</w:p>` });
  for (const b of doc.blocks) { assert.equal(b.type, 'heading'); assert.ok(!(b.segments || []).some((s) => s.tf), 'no emphasis on a heading: ' + JSON.stringify(b)); }
});
test('#34: the real probation-roles file — "Formal sign-off as ‘professionally qualified’" is bold italic', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const f = path.join(path.dirname(fileURLToPath(import.meta.url)), 'real_samples', 'docx', 'statutory-guidance-probation-roles.docx');
  if (!fs.existsSync(f)) return;
  const buf = fs.readFileSync(f);
  const doc = await parseDocx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  let found = null;
  const walk = (b) => {
    if (!b || found) return;
    for (const s of b.segments || []) if ((s.text || '').includes('Formal sign-off as')) found = s;
    for (const k of ['items', 'blocks']) for (const c of b[k] || []) walk(c);
  };
  doc.blocks.forEach(walk);
  assert.ok(found, 'the list item is in the model');
  assert.equal(found.tf, 5);
});

// ============================================================================================================
// #1e  WordArt text.
// ============================================================================================================
const vmlWordArt = (text, extra = '') => `<w:r><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" path="m@7,l@8,m@5,21600l@6,21600e" xmlns:o="urn:schemas-microsoft-com:office:office"/>`
  + `<v:shape id="WordArt1" type="#_x0000_t136" style="width:200pt;height:40pt"><v:textpath style="font-family:&quot;Impact&quot;" string="${text}"${extra}/></v:shape></w:pict></w:r>`;
const dmlWordArt = (text) => `<w:r><w:drawing><wp:anchor><wp:docPr id="1" name="WordArt 1"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">`
  + `<wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr><a:prstTxWarp prst="textWave1"/></wps:bodyPr></wps:wsp>`
  + `</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
test('#1e: VML WordArt (v:textpath string="…") is kept as a paragraph where it is anchored', async () => {
  const doc = await read({ body: p('Before') + `<w:p>${vmlWordArt('Grand Opening')}</w:p>` + p('After') });
  assert.deepEqual(doc.blocks.map((b) => b.text), ['Before', 'Grand Opening', 'After']);
});
test('#1e: WordArt anchored in a paragraph with text comes before that text; a switched-off text path is ignored', async () => {
  const doc = await read({ body: `<w:p>${run('Body words ')}${vmlWordArt('Big Title')}${vmlWordArt('hidden one', ' on="f"')}</w:p>` });
  assert.deepEqual(doc.blocks.map((b) => b.text), ['Big Title', 'Body words']);
});
test('#1e: WordArt written both ways (DrawingML in mc:Choice, VML in mc:Fallback) is read once; DrawingML WordArt is a text box', async () => {
  const both = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${dmlWordArt('Twice?').replace(/^<w:r>|<\/w:r>$/g, '')}</mc:Choice><mc:Fallback>${vmlWordArt('Twice?').replace(/^<w:r>|<\/w:r>$/g, '')}</mc:Fallback></mc:AlternateContent></w:r></w:p>`;
  const doc = await read({ body: both });
  assert.equal(allText(doc.blocks), 'Twice?');
});
test('#1e: WordArt inside a data-table cell is kept in the cell', async () => {
  const doc = await read({ body: `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('H1'))}${tc(p('H2'))}</w:tr>`
    + `<w:tr>${tc(`<w:p>${vmlWordArt('Cell Art')}</w:p>` + p('cell words'))}${tc(p('x'))}</w:tr></w:tbl>` });
  assert.equal(cellText(tables(doc)[0].rows[0][0]), 'Cell Art cell words');
});

// ============================================================================================================
// #30b  Word list number formats beyond decimal / letters / roman.
// ============================================================================================================
async function markers(numFmt, count, lvlText = '%1.') {
  const numbering = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${numFmt}"/><w:lvlText w:val="${lvlText}"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const body = Array.from({ length: count }, (_, i) => p('item ' + (i + 1), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')).join('');
  const doc = await read({ body, numbering });
  return doc.blocks[0].items.map((i) => i.marker);
}
test('#30b: ordinal, ordinalText, cardinalText', async () => {
  assert.deepEqual(await markers('ordinal', 4), ['1st.', '2nd.', '3rd.', '4th.']);
  const big = await markers('ordinal', 23);
  assert.deepEqual([big[10], big[11], big[12], big[20], big[21], big[22]], ['11th.', '12th.', '13th.', '21st.', '22nd.', '23rd.']);
  assert.deepEqual(await markers('ordinalText', 4, '%1'), ['First', 'Second', 'Third', 'Fourth']);
  const ot = await markers('ordinalText', 22, '%1');
  assert.deepEqual([ot[11], ot[19], ot[20], ot[21]], ['Twelfth', 'Twentieth', 'Twenty-first', 'Twenty-second']);
  assert.deepEqual(await markers('cardinalText', 3, '%1'), ['One', 'Two', 'Three']);
  const ct = await markers('cardinalText', 22, '%1');
  assert.deepEqual([ct[12], ct[19], ct[20]], ['Thirteen', 'Twenty', 'Twenty-one']);
});
test('#30b: decimalZero, enclosed digits, chicago, hex, full-width digits, number in dash', async () => {
  assert.deepEqual(await markers('decimalZero', 10), ['01.', '02.', '03.', '04.', '05.', '06.', '07.', '08.', '09.', '10.']);
  assert.deepEqual(await markers('decimalEnclosedCircle', 3, '%1'), ['①', '②', '③']);
  assert.deepEqual(await markers('decimalEnclosedParen', 2, '%1'), ['⑴', '⑵']);
  assert.deepEqual(await markers('decimalEnclosedFullstop', 2, '%1'), ['⒈', '⒉']);
  assert.deepEqual(await markers('chicago', 6, '%1'), ['*', '†', '‡', '§', '**', '††']);
  assert.deepEqual((await markers('hex', 11, '%1')).slice(9), ['9'.replace('9', 'A'), 'B']);
  assert.deepEqual(await markers('decimalFullWidth', 2, '%1.'), ['１.', '２.']);
  assert.deepEqual(await markers('numberInDash', 2, '%1'), ['- 1 -', '- 2 -']);
});
test('#30b: letters repeat past z the way Word counts them (aa, bb), and a format in a script with no table keeps plain digits', async () => {
  const l = await markers('lowerLetter', 28, '%1)');
  assert.deepEqual([l[25], l[26], l[27]], ['z)', 'aa)', 'bb)']);
  assert.deepEqual((await markers('upperLetter', 28, '(%1)')).slice(26), ['(AA)', '(BB)']);
  for (const fmt of ['japaneseCounting', 'chineseCounting', 'koreanDigital', 'thaiNumbers', 'hindiNumbers', 'arabicAlpha', 'hebrew1', 'ideographDigital', 'russianLower']) {
    assert.deepEqual(await markers(fmt, 2, '%1.'), ['1.', '2.'], fmt + ' falls back to decimal digits');
  }
});
test('#30b: a level that shows no number (numFmt none) still has no marker', async () => {
  const numbering = `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/><w:lvlText w:val=""/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const doc = await read({ body: p('x', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') + p('y', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'), numbering });
  assert.ok(doc.blocks[0].items.every((i) => !i.marker));
});

// ============================================================================================================
// #36 + audit w03  Symbol fonts: an unmapped w:sym must not silently become a white square; private-use characters typed
//                  in a Symbol/Wingdings run are mapped through the same tables; more Wingdings arrows.
// ============================================================================================================
const sym = (font, code) => `<w:r><w:sym w:font="${font}" w:char="${code}"/></w:r>`;
const paraText = async (inner) => { const doc = await read({ body: `<w:p>${inner}</w:p>` }); return { doc, text: doc.blocks.map((b) => b.text).join('|') }; };
test('#36: an unmapped symbol becomes the replacement character (not the white square), and the import names it in a warning', async () => {
  const { doc, text } = await paraText(run('a ') + sym('Wingdings', 'F076') + run(' b ') + sym('Webdings', 'F061') + run(' c ') + sym('Symbol', 'F060') + run(' d'));
  assert.equal(text, 'a � b � c � d');
  assert.ok(!text.includes('□'));
  assert.equal(doc.warnings.length, 1);
  assert.match(doc.warnings[0], /3 symbols typed in a symbol font \(Wingdings F076, Webdings F061, Symbol F060\)/);
});
test('#36: a document with no unmapped symbol has no symbol warning', async () => {
  const { doc } = await paraText(run('a ') + sym('Wingdings', 'F0E8') + run(' b'));
  assert.equal(doc.warnings, undefined);
});
test('#36: the formatter then reports the replacement character as untranslatable (UKAAF: full cell + record)', async () => {
  const path = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { formatBlock } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
  const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  const { doc } = await paraText(run('a ') + sym('Wingdings', 'F076') + run(' b'));
  const o = { mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate, translateG1: (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null), translatePos: (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null), suppressHeader: true };
  formatBlock(doc.blocks[0], o);
  assert.deepEqual((o.untranslatable || []).map((e) => e.codePoint), [0xFFFD]);
});
test('#36: Wingdings arrows (F0DF-F0F8) map to their arrows', async () => {
  const want = { F0DF: '←', F0E0: '→', F0E1: '↑', F0E2: '↓', F0E3: '↖', F0E4: '↗', F0E5: '↙', F0E6: '↘', F0E7: '⬅', F0E8: '➔', F0E9: '⬆', F0EA: '⬇', F0EF: '⇦', F0F0: '⇨', F0F1: '⇧', F0F2: '⇩', F0D8: '➢' };
  for (const [code, glyph] of Object.entries(want)) assert.equal((await paraText(sym('Wingdings', code))).text, glyph, code);
});
test('#36: the Symbol font — bullet, maths signs, and the Greek letters the old table had wrong', async () => {
  const want = { F0B7: '•', F0B1: '±', F0A3: '≤', F0B9: '≠', F0A5: '∞', F0AE: '→', F077: 'ω', F057: 'Ω', F056: 'ς', F04A: 'ϑ', F061: 'α', F044: 'Δ', F02B: '+', F033: '3' };
  for (const [code, glyph] of Object.entries(want)) assert.equal((await paraText(sym('Symbol', code))).text, glyph, code);
});
test('#36: a private-use character typed in w:t of a Symbol / Wingdings run is mapped like w:sym; other fonts are left alone', async () => {
  const inFont = (font, t) => `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>${t}</w:t></w:r>`;
  const { doc, text } = await paraText(inFont('Symbol', '') + run(' one ') + inFont('Wingdings', '') + run(' two ') + inFont('Wingdings', '') + run(' three ') + inFont('Arial', ''));
  assert.equal(text, '• one ➢ two ➔� three ');
  assert.match(doc.warnings[0], /Wingdings F076/);
});

// ============================================================================================================
// audit w10  Block Text -> block quotation (as Quote is); Source Code / HTML Preformatted / Plain Text / Macro Text and
//            all-monospaced paragraphs -> a code block (the block the HTML reader makes for <pre>).
// ============================================================================================================
const styleDefs = `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="BlockText"><w:name w:val="Block Text"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="MyBlock"><w:name w:val="my block"/><w:basedOn w:val="BlockText"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="HTMLPreformatted"><w:name w:val="HTML Preformatted"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="PlainText"><w:name w:val="Plain Text"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="MacroText"><w:name w:val="macro"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Listing"><w:name w:val="Listing"/><w:basedOn w:val="SourceCode"/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Mono"><w:name w:val="Mono para"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>`
  + `<w:style w:type="character" w:styleId="VerbatimChar"><w:name w:val="Verbatim Char"/><w:rPr><w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>`;
test('w10: Block Text (by id or name, directly or through basedOn) is a block quotation like Quote', async () => {
  const doc = await read({ styles: styleDefs, body:
    p('q style', '<w:pStyle w:val="Quote"/>') + p('block text style', '<w:pStyle w:val="BlockText"/>') + p('derived block style', '<w:pStyle w:val="MyBlock"/>') + p('plain') });
  assert.deepEqual(doc.blocks.map((b) => b.style || b.type), ['quote', 'quote', 'quote', 'para']);
});
test('w10: Source Code / HTML Preformatted / Plain Text / Macro Text are code blocks; consecutive lines are one block', async () => {
  const doc = await read({ styles: styleDefs, body:
    p('intro') + p('int main() {', '<w:pStyle w:val="SourceCode"/>') + p('    return 0;', '<w:pStyle w:val="Listing"/>') + p('', '<w:pStyle w:val="SourceCode"/>') + p('}', '<w:pStyle w:val="SourceCode"/>')
    + p('outro') + p('&lt;b&gt;hi&lt;/b&gt;', '<w:pStyle w:val="HTMLPreformatted"/>') + p('plain text style', '<w:pStyle w:val="PlainText"/>') + p('a macro', '<w:pStyle w:val="MacroText"/>') });
  assert.deepEqual(doc.blocks.map((b) => b.type), ['para', 'code', 'para', 'code']);
  assert.equal(doc.blocks[1].text, 'int main() {\n    return 0;\n\n}');
  assert.equal(doc.blocks[3].text, '<b>hi</b>\nplain text style\na macro');
});
test('w10: line breaks (Shift+Enter) inside a code paragraph stay line breaks', async () => {
  const doc = await read({ styles: styleDefs, body: `<w:p><w:pPr><w:pStyle w:val="SourceCode"/></w:pPr><w:r><w:t>line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>` });
  assert.deepEqual(doc.blocks, [{ type: 'code', text: 'line one\nline two' }]);
});
test('w10: a paragraph whose every run is in a monospaced font is code; one with a proportional run is not', async () => {
  const mono = (t, font = 'Courier New') => run(t, `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>`);
  const doc = await read({ styles: styleDefs, body:
    `<w:p>${mono('all courier ')}${mono('text', 'Consolas')}</w:p>`
    + `<w:p>${run('mixed ')}${mono('courier')}</w:p>`
    + `<w:p><w:pPr><w:pStyle w:val="Mono"/></w:pPr>${run('font from the paragraph style')}</w:p>`
    + `<w:p>${run('char style font', '<w:rStyle w:val="VerbatimChar"/>')}</w:p>`
    + `<w:p>${run('Arial words', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>')}</w:p>`
    + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${mono('Heading in courier')}</w:p>` });
  assert.deepEqual(doc.blocks.map((b) => b.type), ['code', 'para', 'code', 'para', 'heading']);
  assert.match(doc.blocks[0].text, /^all courier text$/);
  assert.equal(doc.blocks[2].text, 'font from the paragraph style\nchar style font', 'the paragraph-style font and the character-style font both count, and the two lines are one block');
});

test('w10: a typewriter-face paragraph with a superscript stays a paragraph (a code block would lose the level)', async () => {
  const c = '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>';
  const doc = await read({ body: `<w:p>${run('m', c)}${run('2', c + '<w:vertAlign w:val="superscript"/>')}</w:p>` });
  assert.equal(doc.blocks[0].type, 'para');
  assert.match(JSON.stringify(doc.blocks[0]), /||||\\u/, 'the raised run is marked');
});

// ============================================================================================================
// #5 + audit w12  A table caption BELOW the table was moved above it, then dropped on Save.
// ============================================================================================================
const capStyles = `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>`;
const tableRows = `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${tc(p('alphaC1'))}${tc(p('alphaC2'))}</w:tr><w:tr>${tc(p('i1'))}${tc(p('i2'))}</w:tr>`;
const saved = (doc) => exportToNimasXml(doc);
const reopened = (doc) => parseDtbook(saved(doc));

// NOT DONE: keeping a caption below the table in its print position. The reader moves a plain caption from below a table to
// above it ON PURPOSE (BANA 11.2.8a, "regardless of its print location"; tests/layout_tables.test.mjs), so that half of fix-list
// item #5 needs Paul's decision. What was really wrong — Save dropping that caption when the table already had a title — is
// fixed, and tested here.
test('#5: a plain caption below a table is still read as the caption block in front of it (BANA 11.2.8a, unchanged)', async () => {
  const doc = await read({ styles: capStyles, body: p('Table 6. Caption above', '<w:pStyle w:val="Caption"/>') + `<w:tbl>${tableRows}</w:tbl>` + p('Caption below alphacapbelow', '<w:pStyle w:val="Caption"/>') + p('After') });
  assert.deepEqual(doc.blocks.map((b) => b.type), ['caption', 'table', 'para']);
  assert.equal(doc.blocks[0].text, 'Caption below alphacapbelow');
  assert.equal(doc.blocks[1].title, 'Table 6. Caption above');
});
test('#5: Save keeps the title (caption above) AND the caption that was below, and Reopen reads both back', async () => {
  const doc = await read({ styles: capStyles, body: p('Table 6. Caption above', '<w:pStyle w:val="Caption"/>') + `<w:tbl>${tableRows}</w:tbl>` + p('Caption below alphacapbelow', '<w:pStyle w:val="Caption"/>') });
  const xml = saved(doc);
  assert.ok(xml.includes('Caption above') && xml.includes('alphacapbelow'), 'both texts are in the saved XML');
  const back = reopened(doc);
  const t = allText(back.blocks);
  assert.ok(t.includes('Caption above') && t.includes('alphacapbelow'), 'both texts come back: ' + t);
  assert.equal(back.blocks.find((b) => b.type === 'table').title, 'Table 6. Caption above');
  // and saving the reopened file again loses nothing
  const again = saved(back);
  assert.ok(again.includes('Caption above') && again.includes('alphacapbelow'));
});
test('Save: a caption block in front of a table that already has a title is kept (as its own caption), not dropped', () => {
  for (const model of [
    { blocks: [{ type: 'caption', text: 'Loose caption text' }, { type: 'table', title: 'Table 1. The title', headers: ['a', 'b'], rows: [['1', '2']] }] },
    { blocks: [{ type: 'table', title: 'Table 1. The title', caption: 'Also a caption', headers: ['a', 'b'], rows: [['1', '2']] }] },
    { blocks: [{ type: 'box', blocks: [{ type: 'caption', text: 'Loose caption text' }, { type: 'table', title: 'Table 1. The title', headers: ['a', 'b'], rows: [['1', '2']] }] }] },
  ]) {
    const xml = saved(model);
    assert.ok(xml.includes('The title'), 'title saved');
    assert.ok(xml.includes('Loose caption text') || xml.includes('Also a caption'), 'the caption text is saved too: ' + JSON.stringify(model));
  }
});
test('Save: a caption in front of a table WITHOUT a title still becomes that table\'s caption (unchanged)', () => {
  const xml = saved({ blocks: [{ type: 'caption', text: 'Plain caption' }, { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] }] });
  assert.match(xml, /<table[^>]*>\s*<caption>Plain caption<\/caption>/);
});

// ============================================================================================================
// #10 + audit w11  A single-cell table used as a box whose borders come from the table STYLE.
// ============================================================================================================
const SIDES4 = (extra = '') => ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"${extra}/>`).join('');
const TABLE_STYLES = `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/></w:tblPr></w:style>`
  + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${SIDES4()}</w:tblBorders></w:tblPr></w:style>`
  + `<w:style w:type="table" w:styleId="MyBox"><w:name w:val="My box"/><w:basedOn w:val="TableGrid"/></w:style>`
  + `<w:style w:type="table" w:styleId="NoLines"><w:name w:val="No lines"/><w:basedOn w:val="TableGrid"/><w:tblPr><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tblBorders></w:tblPr></w:style>`;
const oneCell = (tblPr, cellInner) => `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr>${tc(cellInner)}</w:tr></w:tbl>`;
const box2 = p('Sidebar title') + p('Sidebar text goes here.');

test('#10: a one-cell table whose borders come from its table style (Table Grid) is a box', async () => {
  const doc = await read({ styles: TABLE_STYLES, body: p('Before') + oneCell('<w:tblStyle w:val="TableGrid"/>', box2) + p('After') });
  const box = doc.blocks.find((b) => b.type === 'box');
  assert.ok(box, 'a box block: ' + JSON.stringify(doc.blocks));
  assert.match(allText(box), /Sidebar title.*Sidebar text goes here/);
  assert.equal(tables(doc).length, 0);
});
test('#10: the table style is followed through w:basedOn', async () => {
  const doc = await read({ styles: TABLE_STYLES, body: oneCell('<w:tblStyle w:val="MyBox"/>', box2) });
  assert.ok(doc.blocks.find((b) => b.type === 'box'));
});
test('#10: no box when the style draws no lines, when a derived style switches them off, or when the table overrides them', async () => {
  for (const tblPr of ['<w:tblStyle w:val="TableNormal"/>', '<w:tblStyle w:val="NoLines"/>', '', '<w:tblStyle w:val="TableGrid"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tblBorders>']) {
    const doc = await read({ styles: TABLE_STYLES, body: oneCell(tblPr, box2) });
    assert.ok(!doc.blocks.some((b) => b.type === 'box'), `no box for ${tblPr || '(no style)'}`);
    assert.match(allText(doc.blocks), /Sidebar title.*Sidebar text goes here/, 'the text is still there');
  }
});
test('#10: a box from direct tblBorders still works (unchanged)', async () => {
  const doc = await read({ styles: TABLE_STYLES, body: oneCell(`<w:tblBorders>${SIDES4()}</w:tblBorders>`, box2) });
  assert.ok(doc.blocks.find((b) => b.type === 'box'));
});

// ============================================================================================================
// #8  A tracked paragraph split (Pandoc paragraph_insertion_deletion.docx) ran two paragraphs' words together.
// ============================================================================================================
test('#8: where a deleted paragraph mark joins two paragraphs, their words do not run together', async () => {
  const doc = await read({ body:
    `<w:p><w:pPr><w:rPr><w:ins w:id="0" w:author="a"/></w:rPr></w:pPr><w:r><w:t>This is a</w:t></w:r></w:p>`
    + `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>split</w:t></w:r></w:p>`
    + `<w:p><w:r><w:t>Paragraph.</w:t></w:r></w:p>` });
  assert.deepEqual(doc.blocks.map((b) => b.text), ['This is a', 'split Paragraph.']);
});
test('#8: a run of several deleted marks joins every paragraph with a space, and keeps the survivor\'s style', async () => {
  const doc = await read({ body:
    `<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="a"/></w:rPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>`
    + `<w:p><w:pPr><w:rPr><w:del w:id="2" w:author="a"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">two </w:t></w:r></w:p>`
    + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>three</w:t></w:r></w:p>` });
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].type, 'heading');
  assert.equal(doc.blocks[0].text, 'one two three');
});
