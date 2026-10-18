// K3 (EMBOSS-TASKS.md section K; transcriber KD, BANA): BF2016 §11.6.1d — "Transcribe
// numerals aligned by place value in print AS SHOWN, i.e., placed to align digits, decimals,
// or commas" — and §11.6.1c — "Left-adjust items within the columns of a table (not
// including numbers) EVEN THOUGH the print text shows column entries centered or
// right-adjusted." Read together: braille aligns a numeric column by place value ONLY when
// PRINT itself aligned that column, never as a guess from the numbers' own punctuation (the
// superseded F-7 heuristic — Emboss/tests/table_rules.test.mjs). Each reader now records
// print's own column alignment as `block.printAlign[c]` ('right' | 'decimal' | undefined);
// document.mjs's numericAlignApplies gates place-value alignment on it (transcriber override
// `block.columnAlign[c]` still wins either way).
//
// Each test below is written to FAIL against Emboss's pre-K3 document.mjs/readers (the
// punctuation heuristic would auto-align a comma/decimal column regardless of printAlign, and
// no reader produced printAlign at all).
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { formatBlock, traceBlock } from '../format/document.mjs';
import { parseHtml, parseRtf, parseDtbook, parseDocx, parseOdt } from '../input/parse.mjs';
import { parseDoc } from '../input/doc.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { writeDoc } from './helpers/doc-writer.mjs';
import { makeZip } from '../web/zip.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const up = (s) => String(s).toUpperCase();
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');
const findTable = (blocks) => blocks.find((b) => b && b.type === 'table');

let translate;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t) => louis.translate(t, T, null);
});
const realOpts = (mode, width = 38) => ({ mode, standard: mode, width, depth: 25, translate, translatePos: (t) => louis.translatePos(t, louis.TABLES.uebG2) });

// ===========================================================================================
// 1. Formatter (document.mjs): printAlign gates place-value alignment, not punctuation.
// ===========================================================================================
describe('K3 — the formatter aligns a numeric column only when block.printAlign says print did', () => {
  test('printAlign "right" place-value-aligns a column with NO comma/decimal at all', () => {
    const block = {
      type: 'table', format: 'columnar', printAlign: ['right'],
      headers: ['No.'], rows: [['1'], ['10']],
    };
    const lines = clean(formatBlock(block, fakeOpts('bana', 40)));
    const row1 = lines.find((l) => l.trim() === '1');
    assert.ok(row1 && /^\s+1$/.test(row1), `printAlign:'right' must right-pad even a punctuation-free column: ${JSON.stringify(lines)}`);
    parity(block, fakeOpts('bana', 40));
  });

  test('printAlign "decimal" place-value-aligns on the decimal point', () => {
    const block = {
      type: 'table', format: 'columnar', printAlign: ['decimal'],
      headers: ['Amount'], rows: [['1.5'], ['12.25']],
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    const short = lines.find((l) => l.includes('1.5') && !l.includes('12.25'));
    const long = lines.find((l) => l.includes('12.25'));
    assert.ok(short && long, JSON.stringify(lines));
    // the decimal points must land in the same column
    const dotCol = (l) => l.indexOf('.');
    assert.equal(dotCol(short), dotCol(long), `decimal points must align: ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('a comma/decimal-bearing column with NO printAlign stays left (K3 supersedes the old punctuation guess)', () => {
    const block = {
      type: 'table', format: 'columnar',
      headers: ['Total'], rows: [['1,712'], ['12,000']],
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    const shortRow = lines.find((l) => l.includes('1,712') && !l.includes('12,000'));
    assert.ok(shortRow, JSON.stringify(lines));
    assert.ok(!/^\s/.test(shortRow), `no printAlign at all: the comma column must stay flush left, not auto-align on its comma: ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('columnAlign transcriber override still wins over printAlign in either direction', () => {
    const o = fakeOpts('bana', 40);
    const forcedLeft = {
      type: 'table', format: 'columnar', printAlign: ['right'], columnAlign: ['left'],
      headers: ['Total'], rows: [['1,712'], ['12,000']],
    };
    const linesLeft = clean(formatBlock(forcedLeft, o));
    const shortRow = linesLeft.find((l) => l.includes('1,712'));
    assert.ok(shortRow && !/^\s/.test(shortRow), `columnAlign:'left' must override printAlign:'right': ${JSON.stringify(linesLeft)}`);
    parity(forcedLeft, o);

    const forcedRight = {
      type: 'table', format: 'columnar', printAlign: [undefined], columnAlign: ['right'],
      headers: ['No.'], rows: [['1'], ['10']],
    };
    const linesRight = clean(formatBlock(forcedRight, o));
    const row1 = linesRight.find((l) => l.trim() === '1');
    assert.ok(row1 && /^\s+1$/.test(row1), `columnAlign:'right' must override the absence of printAlign: ${JSON.stringify(linesRight)}`);
    parity(forcedRight, o);
  });
});

// ===========================================================================================
// 2. HTML/EPUB reader: align="right" / align="char" char="." / style="text-align:right" on
//    td/th, and <col>/<colgroup> — parse.mjs's markupCellAlign + directTableCols.
// ===========================================================================================
describe('K3 — HTML/EPUB reader records printAlign from td/col markup', () => {
  test('style="text-align:right" on every data cell of a column -> printAlign "right"', () => {
    const html = `<table><tr><th>No.</th><th>Sq</th></tr>
      <tr><td style="text-align:right">1</td><td>1</td></tr>
      <tr><td style="text-align:right">10</td><td>100</td></tr></table>`;
    const m = parseHtml(html);
    const t = findTable(m.blocks);
    assert.ok(t, JSON.stringify(m.blocks));
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.ok(!t.printAlign[1], JSON.stringify(t.printAlign));
  });

  test('align="char" char="." on data cells -> printAlign "decimal"', () => {
    const html = `<table><tr><th>Amount</th></tr>
      <tr><td align="char" char=".">1.5</td></tr>
      <tr><td align="char" char=".">12.25</td></tr></table>`;
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.printAlign[0], 'decimal');
  });

  test('<col align="right"> (column-level) applies even when individual td cells carry no align of their own', () => {
    const html = `<table><colgroup><col/><col align="right"/></colgroup>
      <tr><th>No.</th><th>Total</th></tr>
      <tr><td>1</td><td>1,712</td></tr>
      <tr><td>2</td><td>12,000</td></tr></table>`;
    const t = findTable(parseHtml(html).blocks);
    assert.ok(!t.printAlign || !t.printAlign[0], JSON.stringify(t.printAlign));
    assert.equal(t.printAlign[1], 'right', JSON.stringify(t.printAlign));
  });

  test('a column whose data cells DISAGREE (one "right", one "char") is left undetected (no false positive)', () => {
    const html = `<table><tr><th>X</th></tr>
      <tr><td align="right">1</td></tr>
      <tr><td align="char" char=".">2</td></tr></table>`;
    const t = findTable(parseHtml(html).blocks);
    assert.ok(!t.printAlign || !t.printAlign[0], JSON.stringify(t.printAlign));
  });

  test('a cell with NO align attribute is silence, not disagreement — the one positive vote in the column still counts', () => {
    const html = `<table><tr><th>X</th></tr>
      <tr><td align="right">1</td></tr>
      <tr><td>2</td></tr></table>`;
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
  });

  test('end to end: an HTML table with a right-aligned punctuation-free column formats place-value-aligned', () => {
    const html = `<table><tr><th>No.</th></tr>
      ${Array.from({ length: 10 }, (_, i) => `<tr><td style="text-align:right">${i + 1}</td></tr>`).join('')}</table>`;
    const t = findTable(parseHtml(html).blocks);
    t.format = 'columnar';
    const lines = clean(formatBlock(t, fakeOpts('bana', 40)));
    const row1 = lines.find((l) => l.trim() === '1');
    assert.ok(row1 && /^\s+1$/.test(row1), JSON.stringify(lines));
  });
});

// ===========================================================================================
// 3. DTBook (NIMAS) reader: align/char on td/col — parse.mjs's parseTable.
// ===========================================================================================
describe('K3 — DTBook (parseTable) reader records printAlign from td/col markup', () => {
  const doc = (body) => parseDtbook(`<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`);

  test('align="right" on data <td>s -> printAlign "right"', () => {
    const t = findTable(doc(`<table><tbody>
      <tr><th>No.</th></tr>
      <tr><td align="right">1</td></tr>
      <tr><td align="right">10</td></tr>
    </tbody></table>`).blocks);
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
  });

  test('<col align="char" char="."/> (column-level) -> printAlign "decimal"', () => {
    const t = findTable(doc(`<table><col/><col align="char" char="."/><tbody>
      <tr><th>No.</th><th>Amount</th></tr>
      <tr><td>1</td><td>1.5</td></tr>
      <tr><td>2</td><td>12.25</td></tr>
    </tbody></table>`).blocks);
    assert.ok(!t.printAlign[0], JSON.stringify(t.printAlign));
    assert.equal(t.printAlign[1], 'decimal', JSON.stringify(t.printAlign));
  });
});

// ===========================================================================================
// 4. RTF reader: \qr and \tqdec — parse.mjs's parseRtf.
// ===========================================================================================
describe('K3 — RTF reader records printAlign from \\qr / \\tqdec', () => {
  test('\\qr on every data cell paragraph -> printAlign "right"', () => {
    const rtf = String.raw`{\rtf1\ansi
{\trowd \cellx2000\cellx4000
{\pard\intbl No.\cell}
{\pard\intbl Sq\cell}
\row}
{\trowd \cellx2000\cellx4000
{\pard\qr\intbl 1\cell}
{\pard\intbl 1\cell}
\row}
{\trowd \cellx2000\cellx4000
{\pard\qr\intbl 10\cell}
{\pard\intbl 100\cell}
\row}}`;
    const t = findTable(parseRtf(rtf).blocks);
    assert.ok(t, JSON.stringify(parseRtf(rtf).blocks));
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.ok(!t.printAlign[1], JSON.stringify(t.printAlign));
  });

  test('\\tqdec on a data cell paragraph -> printAlign "decimal"', () => {
    const rtf = String.raw`{\rtf1\ansi
{\trowd \cellx4000
{\pard\intbl Amount\cell}
\row}
{\trowd \cellx4000
{\pard\tqdec\tx2000\intbl 1.5\cell}
\row}
{\trowd \cellx4000
{\pard\tqdec\tx2000\intbl 12.25\cell}
\row}}`;
    const t = findTable(parseRtf(rtf).blocks);
    assert.equal(t.printAlign[0], 'decimal', JSON.stringify(t.printAlign));
  });
});

// ===========================================================================================
// 5. DOCX reader: w:jc="right"/"end" and a decimal tab stop on a data cell's paragraph.
// ===========================================================================================
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function buildDocx(bodyXml) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const buf = await makeZip([{ name: 'word/document.xml', text: docXml }]).arrayBuffer();
  return parseDocx(buf);
}
describe('K3 — DOCX reader records printAlign from w:jc / a decimal tab stop', () => {
  test('w:jc val="right" on data cell paragraphs -> printAlign "right"', async () => {
    const bodyXml = `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>
        <w:tc><w:p><w:r><w:t>No.</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Sq</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>10</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>`;
    const m = await buildDocx(bodyXml);
    const t = findTable(m.blocks);
    assert.ok(t, JSON.stringify(m.blocks));
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.ok(!t.printAlign[1], JSON.stringify(t.printAlign));
  });

  test('a decimal tab stop (w:tab val="decimal") on data cell paragraphs -> printAlign "decimal"', async () => {
    const bodyXml = `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>
        <w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:pPr><w:tabs><w:tab w:val="decimal" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>1.5</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:pPr><w:tabs><w:tab w:val="decimal" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>12.25</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>`;
    const m = await buildDocx(bodyXml);
    const t = findTable(m.blocks);
    assert.equal(t.printAlign[0], 'decimal', JSON.stringify(t.printAlign));
  });
});

// ===========================================================================================
// 6. ODT reader: fo:text-align "end"/"right" on the cell paragraph's own style.
// ===========================================================================================
describe('K3 — ODT reader records printAlign from a paragraph style\'s fo:text-align', () => {
  test('fo:text-align="end" on the data cells\' paragraph style -> printAlign "right"', async () => {
    const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
    const content = `<?xml version="1.0"?><office:document-content ${NS}>
      <office:automatic-styles>
        <style:style style:name="RightAlign" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style>
      </office:automatic-styles>
      <office:body><office:text>
        <table:table>
          <table:table-row><table:table-cell><text:p>No.</text:p></table:table-cell></table:table-row>
          <table:table-row><table:table-cell><text:p text:style-name="RightAlign">1</text:p></table:table-cell></table:table-row>
          <table:table-row><table:table-cell><text:p text:style-name="RightAlign">10</text:p></table:table-cell></table:table-row>
        </table:table>
      </office:text></office:body>
    </office:document-content>`;
    const buf = await makeZip([{ name: 'content.xml', data: new TextEncoder().encode(content) }]).arrayBuffer();
    const m = await parseOdt(buf);
    const t = findTable(m.blocks);
    assert.ok(t, JSON.stringify(m.blocks));
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
  });
});

// ===========================================================================================
// 7. .doc (binary Word 97-2003) reader: sprmPJc (justification) on data cell paragraphs.
// ===========================================================================================
describe('K3 — .doc reader records printAlign from sprmPJc (justification)', () => {
  test('jc:2 (right) on data cell paragraphs -> printAlign "right"', async () => {
    const spec = {
      body: [{
        table: [
          ['No.', 'Sq'],
          [{ blocks: [{ p: '1', jc: 2 }] }, { blocks: [{ p: '1' }] }],
          [{ blocks: [{ p: '10', jc: 2 }] }, { blocks: [{ p: '100' }] }],
        ],
      }],
    };
    const m = await parseDoc(writeDoc(spec));
    const t = findTable(m.blocks);
    assert.ok(t, JSON.stringify(m.blocks));
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.ok(!t.printAlign[1], JSON.stringify(t.printAlign));
  });
});

// ===========================================================================================
// 8. NIMAS export/import round trip: block.printAlign -> <col align="…"/> -> printAlign again.
// ===========================================================================================
describe('K3 — NIMAS export/import round-trips block.printAlign through <col align>', () => {
  test('printAlign "right" and "decimal" both survive a save/reopen round trip', () => {
    const block = {
      type: 'table', headers: ['No.', 'Amount', 'Label'],
      rows: [['1', '1.5', 'a'], ['10', '12.25', 'bb']],
      printAlign: ['right', 'decimal', undefined],
    };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    assert.match(xml, /<col align="right"\/>/, xml);
    assert.match(xml, /<col align="char" char="\."\/>/, xml);
    const reopened = parseDtbook(xml);
    const t = findTable(reopened.blocks);
    assert.ok(t, xml);
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.equal(t.printAlign[1], 'decimal', JSON.stringify(t.printAlign));
    assert.ok(!t.printAlign[2], JSON.stringify(t.printAlign));
  });

  test('a table with no printAlign at all writes no <col> and stays unaligned on reopen', () => {
    const block = { type: 'table', headers: ['Total'], rows: [['1,712'], ['12,000']] };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    assert.ok(!/<col\b/.test(xml), xml);
    const t = findTable(parseDtbook(xml).blocks);
    assert.ok(!t.printAlign, JSON.stringify(t));
  });
});
