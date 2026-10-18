// The content of the synthetic .doc fixtures in this folder (written by
// tests/helpers/doc-writer.mjs — see make-fixtures.mjs). Each spec describes one small
// document; the parity fixtures are also written as a .docx twin so the test can check that
// parseDoc and parseDocx build the same model from the same document.
import { deflateSync } from 'node:zlib';
import { v3, FACE } from '../../helpers/mtef-writer.mjs';

// ---- tiny images ----
function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
export function png(w, h, [r, g, b]) {
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) raw.push(r, g, b); }
  const chunk = (type, data) => {
    const t = [...type].map((c) => c.charCodeAt(0));
    const len = data.length;
    const crc = crc32([...t, ...data]);
    return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...t, ...data, crc >>> 24, (crc >> 16) & 255, (crc >> 8) & 255, crc & 255];
  };
  const ihdr = [0, 0, 0, w, 0, 0, 0, h, 8, 2, 0, 0, 0];
  return Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...chunk('IHDR', ihdr), ...chunk('IDAT', [...deflateSync(Uint8Array.from(raw))]), ...chunk('IEND', [])]);
}
// A placeable WMF drawing one rectangle.
export function tinyWmf() {
  const recs = [[5, 0x020B, 0, 0], [5, 0x020C, 100, 100], [7, 0x041B, 90, 90, 10, 10], [3, 0x0000]];
  const body = [];
  for (const [size, func, ...p] of recs) body.push(size, 0, func, ...p);
  const total = 9 + body.length;
  const words = [1, 9, 0x0300, total & 0xFFFF, total >>> 16, 0, 7, 0, 0, ...body];
  const out = new Uint8Array(22 + words.length * 2);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x9AC6CDD7, true); dv.setInt16(10, 100, true); dv.setInt16(12, 100, true); dv.setUint16(14, 1440, true);
  let sum = 0; for (let i = 0; i < 20; i += 2) sum ^= dv.getUint16(i, true);
  dv.setUint16(20, sum, true);
  words.forEach((v, i) => dv.setUint16(22 + i * 2, v & 0xFFFF, true));
  return out;
}
export const RED = png(2, 2, [255, 0, 0]);
export const BLUE = png(3, 1, [0, 0, 255]);

// ---- basics: text, styles, emphasis, notes, lists, a table, links, fields, special characters ----
export const basics = {
  title: 'Basics fixture', author: 'Emboss tests',
  lists: { 1: [{ fmt: 'decimal', text: '%1.' }, { fmt: 'lowerLetter', text: '%2)' }], 2: [{ fmt: 'bullet' }] },
  header: 'Running head (headers are not transcribed)',
  body: [
    { p: 'The Document Title', style: 'Title' },
    { p: 'Chapter One', style: 'heading 1' },
    { p: ['Plain ', { text: 'bold', b: true }, ' and ', { text: 'italic', i: true }, ' and ', { text: 'under', u: true }, ', H', { text: '2', sub: true }, 'O, x', { text: '2', sup: true }, '.'] },
    { p: ['A note', { footnote: [{ p: 'The footnote text.' }] }, ' and an end', { endnote: [{ p: ['Endnote ', { text: 'one', i: true }] }] }, '.'] },
    { p: 'Section', style: 'heading 2' },
    { p: 'First', list: { id: 1, level: 0 } },
    { p: 'Second', list: { id: 1, level: 0 } },
    { p: 'Nested', list: { id: 1, level: 1 } },
    { p: 'Third', list: { id: 1, level: 0 } },
    { p: 'Between the lists.' },
    { p: 'Bullet one', list: { id: 2, level: 0 } },
    { p: 'Bullet two', list: { id: 2, level: 0 } },
    { table: [['Name', 'Age'], ['Ann', [{ text: '30', b: true }]], [{ blocks: [{ p: 'Wide' }], span: 2 }]] },
    { p: ['Visit ', { text: 'our site', href: 'https://example.com/' }, ' now.'] },
    { p: ['Tab', { tab: true }, 'bed', { br: true }, 'line', { nbHyphen: true }, 'x', { softHyphen: true }, 'y ', { sym: { font: 'Symbol', code: 0xF061 } }] },
    { p: ['Keep ', { text: 'gone', del: true }, { text: 'added', ins: true }, ' ', { text: 'secret', vanish: true }, 'end ', { text: 'caps', caps: true }, ' ', { text: 'small', smallCaps: true }] },
    { p: ['Field: ', { field: 'PAGE', result: '7' }, ' and ', { field: 'XE "index entry"' }, 'done'] },
    { p: ['Crossed ', { text: 'out', strike: true }, ' text.'] },
  ],
};

// ---- objects: style classification, pictures, shapes, text boxes, equations, OLE, complex tables ----
export const objects = {
  styles: [
    { name: 'Überschrift 1', type: 'para', sti: 1, basedOn: 'Normal' },
    { name: 'Chapter Head', type: 'para', sti: 0x0FFE, basedOn: 'Normal', outline: 1 },
    { name: 'Strong', type: 'char', sti: 87, bold: true },
    { name: 'Heading 3 Char', type: 'char', sti: 0x0FFE, bold: true, linked: 'heading 3' },
  ],
  body: [
    { p: 'Localised heading', style: 'Überschrift 1' },
    { p: 'Custom outline style', style: 'Chapter Head' },
    { p: 'Direct outline', outline: 2 },
    { p: ['Char style ', { text: 'strong', style: 'Strong' }, ' and ', { text: 'linked', style: 'Heading 3 Char' }] },
    { p: ['Inline picture: ', { image: { png: RED, alt: 'A red square' } }] },
    { p: 'Figure 1: red', style: 'caption' },
    { floatImage: { png: BLUE, alt: 'Blue bar' } },
    { textbox: [{ p: 'Boxed heading', style: 'heading 2' }, { p: ['Boxed ', { text: 'text', i: true }] }] },
    { p: ['Equation ', { equation: v3.eqn(v3.line(v3.chars(FACE.VARIABLE, 'x'), v3.char(FACE.TEXT, '+'), v3.chars(FACE.NUMBER, '1'))) }, ' inline.'] },
    { p: [{ equation: v3.eqn(v3.line(v3.chars(FACE.VARIABLE, 'y'))) }] },
    { p: ['Broken ', { equation: null }, ' eq.'] },
    { p: ['Sheet: ', { ole: 'Excel.Sheet.8' }] },
    { table: [
      ['H1', 'H2', 'H3'],
      [{ blocks: [{ p: 'tall' }], vmerge: 'restart' }, 'b', { blocks: [{ p: 'outer' }, { table: [['in1', 'in2'], ['in3', 'in4']] }] }],
      [{ blocks: [{ p: '' }], vmerge: 'continue' }, { blocks: [{ p: 'wide' }], span: 2 }],
      [['pic ', { image: { png: RED, alt: 'cell pic' } }], ['note', { footnote: [{ p: 'cell note' }] }], ''],
    ] },
  ],
};

// ---- extras (no .docx twin): features whose .docx form the twin writer does not produce ----
export const extras = {
  body: [
    { p: ['Ruby: ', { field: 'EQ \\* jc2 \\* "Font:MS Mincho" \\* hps10 \\o\\ad(\\s\\up 9(かんじ),漢字)' }, ' end'] },
    { p: ['Crossed ', { text: 'out', strike: true }, ' word'] },
    { p: 'O', dropCap: true },
    { p: 'nce upon a time.' },
    { p: ['Metafile: ', { image: { wmf: tinyWmf(), alt: 'A drawn box' } }] },
    { p: ['Packed metafile: ', { image: { wmf: tinyWmf(), alt: 'Packed box', deflate: (b) => Uint8Array.from(deflateSync(b)) } }] },
    { p: ['Line one', { br: true }, { br: true }, 'Line three'] },
    { p: ['Heading with', { br: true }, 'a break'], style: 'heading 2' },
    { p: ['See ', { field: 'HYPERLINK \\l "chapter2"', result: 'chapter two' }, '.'] },
    { p: ['Page one', { pageBreak: true }, 'page two'] },
    { p: ['Starred', { footnote: [{ p: 'Star note.' }], mark: '*' }, ' and numbered', { footnote: [{ p: 'Numbered note.' }] }, '.'] },
    { p: 'Joined by a deleted ', delMark: true },
    { p: 'paragraph mark.' },
  ],
};

// ---- tables: layout vs data (table-kind.mjs), captions, header rows, table styles ----
export const tables = {
  lists: { 1: [{ fmt: 'bullet' }] },
  styles: [{ name: 'Grid Table 4 - Accent 1', type: 'table', sti: 0x0FFE }],
  body: [
    { p: 'Table 1: Scores', style: 'caption' },
    { table: [['Name', 'Score'], ['Ann', '3'], ['Bob', '5']] },
    { p: 'Before a layout table.' },
    { table: [[{ blocks: [{ p: 'Cell heading', style: 'heading 2' }, { p: 'Left text.' }] }, { blocks: [{ p: 'Right one', list: { id: 1, level: 0 } }, { p: 'Right two', list: { id: 1, level: 0 } }] }]] },
    { p: '' },
    { table: [['Name:', ''], ['Date:', '___']] },
    { p: '' },
    { table: [['Only one column'], ['second row']] },
    { p: '' },
    { table: [['A long first cell that is certainly longer than forty characters of text', 'x'], ['y', 'z']], header: true },
    { p: '' },
    { table: [['A long first cell that is certainly longer than forty characters of text', 'x'], ['y', 'z']], tstyle: 'Grid Table 4 - Accent 1' },
    { p: '' },
    { table: [[{ blocks: [{ p: 'Outer' }, { table: [['In A', 'In B'], ['1', '2']] }] }]] },
    { p: '' },
    { table: [['K', 'V'], ['k1', 'v1']] },
    { p: 'A plain caption', style: 'caption' },
    { p: 'After.' },
  ],
};

// ---- numbering: numbered headings, a list carrying on after an interruption, legal
// numbering, contents entries (toc styles, a dot-leader line) ----
export const numbering = {
  lists: {
    1: [{ fmt: 'decimal', text: '%1.' }],
    3: [{ fmt: 'decimal', text: '%1' }, { fmt: 'decimal', text: '%1.%2' }],
    4: [{ fmt: 'upperRoman', text: '%1.' }, { fmt: 'lowerLetter', text: '%1.%2' }],
  },
  styles: [
    { name: 'heading 1', type: 'para', sti: 1, basedOn: 'Normal', list: { id: 3, level: 0 } },
    { name: 'heading 2', type: 'para', sti: 2, basedOn: 'Normal', list: { id: 3, level: 1 } },
  ],
  body: [
    { p: 'Contents', style: 'heading 3' },
    { p: ['Introduction', { tab: true }, '1'], style: 'toc 1' },
    { p: ['Background', { tab: true }, '2'], style: 'toc 2' },
    { p: ['Manual entry', { tab: true }, 'iv'], tabs: [{ pos: 8000, leader: 'dot' }] },
    { p: ['Name:', { tab: true }, 'Ann'], tabs: [{ pos: 3000 }] },
    { p: 'Introduction', style: 'heading 1' },
    { p: 'Scope', style: 'heading 2' },
    { p: 'Detail', style: 'heading 2' },
    { p: 'Method', style: 'heading 1' },
    { p: 'First step', list: { id: 1, level: 0 } },
    { p: 'Second step', list: { id: 1, level: 0 } },
    { p: 'An interruption.' },
    { p: 'Third step', list: { id: 1, level: 0 } },
    { p: 'Roman', list: { id: 4, level: 0 } },
    { p: 'Legal sub', list: { id: 4, level: 1 } },
  ],
};

export const tiny = { body: [{ p: 'Hello' }] };
