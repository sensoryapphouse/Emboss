// K35 (EMBOSS-TASKS.md section K): two independent fixes, tested together since both
// finish off table-cell fields K3/the layout-table work already carried in the model but
// never fully reached the editor or NIMAS.
//
// 1. block.columnAlign (the transcriber's own per-column place-value override, K3;
//    document.mjs's numericAlignApplies) already worked from a hand-built model, but had no
//    editor control and did not survive a NIMAS save/reopen. This file tests: (a) 'decimal'
//    is now accepted as a columnAlign value, exactly like 'right' (numericAlignApplies); (b)
//    nimas-export.mjs writes it as a class token on the same <col> print's own alignment
//    already uses (bana-col-align-left/-right/-decimal), identified by the <col>'s position;
//    (c) parse.mjs reads it back into block.columnAlign, independently of printAlign; (d) the
//    round trip is stable through a second save/reopen; (e) a plain table (no columnAlign,
//    no printAlign) still writes no <col> at all.
//
// 2. A picture kept inside a data-table cell (an `imgnote` segment: format/cell-markup.mjs,
//    input/parse.mjs's docxCellValue, BANA 10.11.1) used to fall through cell-dom.mjs's
//    segmentsToCellHtml to the plain-text branch, so the editor showed only its description
//    and any further edit to the cell's OTHER text silently dropped the picture (no chip ever
//    round-tripped it back into an imgnote segment). This file tests cell-dom.mjs directly
//    (it has no DOM/browser dependency, like table_rich_cells.test.mjs): the picture is now
//    an atomic, non-editable chip that survives editing text elsewhere in the same cell, with
//    every field a save needs (src, prodnote, render, uncontracted, spanTypeform), plus an
//    optional thumbnail when the caller can resolve `src` to a displayable URL.
//
// Each test here is written to FAIL against Emboss's pre-K35 document.mjs / nimas-export.mjs
// / parse.mjs / cell-dom.mjs (columnAlign was 'left'/'right' only and never left the model;
// an imgnote segment in a cell rendered as bare text with no chip at all).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { formatBlock, traceBlock } from '../format/document.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { segmentsToCellHtml, cellHtmlToSegments, cellFromEditableHtml, cellToEditableHtml } from '../format/cell-dom.mjs';
import { cellIsRich, cellPlainText, cellFromSegments } from '../format/cell-markup.mjs';

const up = (s) => String(s).toUpperCase();
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');
const findTable = (blocks) => blocks.find((b) => b && b.type === 'table');

// ===========================================================================================
// 1a. Formatter: columnAlign 'decimal' is the same instruction as 'right' (numericAlignApplies).
// ===========================================================================================
describe('K35 — columnAlign "decimal" place-value-aligns a column, same as "right"', () => {
  test('columnAlign "decimal" overrides the absence of printAlign', () => {
    const block = {
      type: 'table', format: 'columnar', printAlign: [undefined], columnAlign: ['decimal'],
      headers: ['No.'], rows: [['1'], ['10']],
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    const row1 = lines.find((l) => l.trim() === '1');
    assert.ok(row1 && /^\s+1$/.test(row1), `columnAlign:'decimal' must place-value-align, like 'right': ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('columnAlign "decimal" aligns on the decimal point itself', () => {
    const block = {
      type: 'table', format: 'columnar', columnAlign: ['decimal'],
      headers: ['Amount'], rows: [['1.5'], ['12.25']],
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    const short = lines.find((l) => l.includes('1.5') && !l.includes('12.25'));
    const long = lines.find((l) => l.includes('12.25'));
    assert.ok(short && long, JSON.stringify(lines));
    assert.equal(short.indexOf('.'), long.indexOf('.'), `decimal points must align: ${JSON.stringify(lines)}`);
    parity(block, o);
  });

  test('columnAlign "left" still overrides a "decimal" printAlign', () => {
    const block = {
      type: 'table', format: 'columnar', printAlign: ['decimal'], columnAlign: ['left'],
      headers: ['Amount'], rows: [['1.5'], ['12.25']],
    };
    const o = fakeOpts('bana', 40);
    const lines = clean(formatBlock(block, o));
    const short = lines.find((l) => l.includes('1.5') && !l.includes('12.25'));
    assert.ok(short && !/^\s/.test(short), `columnAlign:'left' must still win over printAlign:'decimal': ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});

// ===========================================================================================
// 1b. NIMAS export/import round trip: block.columnAlign <-> a class token on print's own <col>.
// ===========================================================================================
describe('K35 — NIMAS export/import round-trips block.columnAlign through a <col> class token', () => {
  test('left, right and decimal all survive a save/reopen round trip, independent of printAlign', () => {
    const block = {
      type: 'table', headers: ['No.', 'Amount', 'Label'],
      rows: [['1', '1.5', 'a'], ['10', '12.25', 'bb']],
      columnAlign: ['left', 'right', 'decimal'],
    };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    assert.match(xml, /<col class="bana-col-align-left"\/>/, xml);
    assert.match(xml, /<col class="bana-col-align-right"\/>/, xml);
    assert.match(xml, /<col class="bana-col-align-decimal"\/>/, xml);
    const reopened = parseDtbook(xml);
    const t = findTable(reopened.blocks);
    assert.ok(t, xml);
    assert.deepEqual(t.columnAlign, ['left', 'right', 'decimal'], JSON.stringify(t.columnAlign));
    // Stable through a second save/reopen.
    const xml2 = exportToNimasXml(reopened, { title: 'T' });
    const reopened2 = parseDtbook(xml2);
    assert.deepEqual(findTable(reopened2.blocks).columnAlign, ['left', 'right', 'decimal']);
    assert.equal(xml2, exportToNimasXml(reopened2, { title: 'T' }), 'save -> reopen -> save is stable');
  });

  test('columnAlign and printAlign on the same column both round-trip from the one <col>', () => {
    const block = {
      type: 'table', headers: ['Total'], rows: [['1,712'], ['12,000']],
      printAlign: ['right'], columnAlign: ['left'],
    };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    assert.match(xml, /<col align="right" class="bana-col-align-left"\/>/, xml);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.printAlign[0], 'right', JSON.stringify(t.printAlign));
    assert.equal(t.columnAlign[0], 'left', JSON.stringify(t.columnAlign));
  });

  test('a columnAlign override past the last printAlign column still gets its own <col>', () => {
    const block = {
      type: 'table', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']],
      columnAlign: [undefined, undefined, 'right'],
    };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    const cols = [...xml.matchAll(/<col[^/]*\/>/g)].map((m) => m[0]);
    assert.equal(cols.length, 3, xml);
    assert.equal(cols[2], '<col class="bana-col-align-right"/>', xml);
    const t = findTable(parseDtbook(xml).blocks);
    assert.ok(!t.columnAlign[0] && !t.columnAlign[1], JSON.stringify(t.columnAlign));
    assert.equal(t.columnAlign[2], 'right');
  });

  test('a table with neither columnAlign nor printAlign writes no <col> and reopens with neither', () => {
    const block = { type: 'table', headers: ['Total'], rows: [['1,712'], ['12,000']] };
    const xml = exportToNimasXml({ blocks: [block] }, { title: 'T' });
    assert.ok(!/<col\b/.test(xml), xml);
    const t = findTable(parseDtbook(xml).blocks);
    assert.ok(!t.printAlign, JSON.stringify(t));
    assert.ok(!t.columnAlign, JSON.stringify(t));
  });
});

// ===========================================================================================
// 2. A picture kept in a data-table cell (imgnote) is an atomic, non-destructive editor chip.
// ===========================================================================================
describe('K35 — a table cell\'s own picture (imgnote segment) is a chip cell-dom.mjs round-trips', () => {
  test('segmentsToCellHtml renders an atomic, non-editable chip carrying every save field', () => {
    const html = segmentsToCellHtml([{ type: 'imgnote', text: 'A red apple', src: 'images/apple.png' }]);
    assert.match(html, /<span class="cell-imgnote-chip"[^>]*contenteditable="false"[^>]*>/, html);
    assert.match(html, /data-text="A red apple"/, html);
    assert.match(html, /data-src="images\/apple\.png"/, html);
    assert.match(html, /A red apple<\/span>/, html);   // the description text (no resolver: a plain picture glyph precedes it, no <img> thumbnail)
    assert.doesNotMatch(html, /cell-imgnote-thumb/, html);
  });

  test('cellHtmlToSegments reads the chip back into the exact same imgnote segment', () => {
    const original = { type: 'imgnote', text: 'A red apple', src: 'images/apple.png' };
    const html = segmentsToCellHtml([original]);
    assert.deepEqual(cellHtmlToSegments(html), [original]);
  });

  test('a production-note-only picture (no src) keeps its prodnote/render flags', () => {
    const original = { type: 'imgnote', text: 'Chart: sales by quarter', prodnote: true, render: 'optional' };
    const html = segmentsToCellHtml([original]);
    assert.doesNotMatch(html, /data-src=/, html);
    assert.deepEqual(cellHtmlToSegments(html), [original]);
  });

  test('uncontracted/spanTypeform flags on an imgnote segment round-trip too', () => {
    const original = { type: 'imgnote', text: 'apple', src: 'images/apple.png', uncontracted: true, spanTypeform: true };
    const html = segmentsToCellHtml([original]);
    assert.deepEqual(cellHtmlToSegments(html), [original]);
  });

  test('editing OTHER text in the cell keeps the picture (the bug this fixes)', () => {
    const segs = [{ type: 'text', text: 'See: ' }, { type: 'imgnote', text: 'A red apple', src: 'images/apple.png' }];
    const html = segmentsToCellHtml(segs);
    // The browser leaves the atomic chip's own HTML untouched and only changes text around it.
    const edited = html + ' nice';
    const cell = cellFromEditableHtml(edited);
    assert.ok(cellIsRich(cell), 'the cell is still rich (keeps its segments), not collapsed to plain text');
    const picture = cell.segments.find((g) => g.type === 'imgnote');
    assert.ok(picture, `the picture segment must survive editing other text in the cell: ${JSON.stringify(cell)}`);
    assert.equal(picture.src, 'images/apple.png');
    assert.equal(picture.text, 'A red apple');
    assert.equal(cellPlainText(cell), 'See: A red apple nice');
  });

  test('a thumbnail <img> is shown when the caller can resolve src to a displayable URL, not otherwise', () => {
    const seg = { type: 'imgnote', text: 'A red apple', src: 'images/apple.png' };
    const withoutResolver = segmentsToCellHtml([seg]);
    assert.doesNotMatch(withoutResolver, /cell-imgnote-thumb/, withoutResolver);
    const withResolver = segmentsToCellHtml([seg], (src) => `blob:resolved/${src}`);
    assert.match(withResolver, /<img class="cell-imgnote-thumb" src="blob:resolved\/images\/apple\.png"/, withResolver);
    // The resolver never sees a segment with no src (a prodnote-only picture) and the chip
    // still reads back to the same segment either way.
    assert.deepEqual(cellHtmlToSegments(withResolver), [seg]);
  });

  test('cellToEditableHtml passes its resolver through for a whole cell (string or object)', () => {
    const cell = cellFromSegments('A red apple', [{ type: 'imgnote', text: 'A red apple', src: 'images/apple.png' }]);
    const html = cellToEditableHtml(cell, (src) => `blob:resolved/${src}`);
    assert.match(html, /cell-imgnote-thumb/, html);
  });
});
