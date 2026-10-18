// Bug 2 (Emboss/docs/real-book-validation-24sep.md, bug list #2): "Listed tables with no
// header row invent 'Col n' / 'Row n'." Two parts:
//
// 1. HEADINGS FROM PRINT (parse.mjs's parseTable, DTBook and HTML paths): many source
//    tables have no <thead>/<th> at all, but their FIRST row is print's heading row —
//    bold text in <td> cells (e.g. anthology p251: "Word | Definition | Related Forms").
//    A first row is now promoted to headers when every one of its non-empty cells is
//    wholly bold; a first row with any plain text is left as data (a genuinely header-less
//    table must be unaffected).
//
// 2. NO INVENTED LABELS (document.mjs's formatListed and its traceTable mirror, §11.16):
//    BANA 11.16.1's own sub-rules (a-l) only ever describe a listed table that HAS column
//    headings — "Each column heading is followed by a colon" (11.16.1d), "Format the
//    first column heading... as a cell-5 heading" (11.16.1e) — and give no rule for a
//    table with none (F-12's status note: 11.5.3a's "leave... blank" is spatial-only).
//    Emboss's reading (this fix, pending a transcriber's confirmation — see the question
//    below): render each entry alone, with the same margins/blank-line-per-row/guide-dot
//    rules (11.16.1a,f,h,j,k) but no invented "heading: " prefix.
//
// QUESTION FOR A TRANSCRIBER: is "entry alone, no prefix" the right reading of a listed
// table with no print headings at all, or should BANA 11.5.3a's spatial-only "leave the
// area blank" idea (or some other convention) apply instead? Nothing in §11.16 says.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook, parseHtml } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const dtbook = (tableXml) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
  ${tableXml}
</level1></bodymatter></book></dtbook>`;
const findTable = (blocks) => blocks.find((b) => b && b.type === 'table');

// ---------------------------------------------------------------------------------------
// Part 1a: parseTable (DTBook) promotes a bold first row when there is no <thead>/<th>.
// ---------------------------------------------------------------------------------------
describe('parseTable (DTBook): a bold first row with no <thead>/<th> is promoted to headers', () => {
  test('every non-empty cell wholly bold -> promoted, dropped from rows', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Word</strong></td><td><strong>Definition</strong></td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.headers.length, 2);
    assert.equal(t.headers[0].text, 'Word');
    assert.equal(t.headers[1].text, 'Definition');
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.rows[0], ['focus', 'to direct attention']);
  });

  test('a plain (non-bold) first row is left as data — a genuinely header-less table is unaffected', () => {
    const xml = dtbook(`<table>
      <tr><td>Word</td><td>Definition</td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
    assert.deepEqual(t.rows[0], ['Word', 'Definition']);
    assert.deepEqual(t.rows[1], ['focus', 'to direct attention']);
  });

  test('mixed bold/plain cells in the first row (only one cell bold) are left as data', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Word</strong></td><td>Definition</td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
  });

  test('a cell only PARTLY bold (bold word plus plain text in the same cell) is not "wholly bold"', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Word</strong> type</td><td><strong>Definition</strong></td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
  });

  test('an existing <thead> still wins (the bold-first-row check never runs)', () => {
    const xml = dtbook(`<table>
      <thead><tr><th>Word</th><th>Definition</th></tr></thead>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers, ['Word', 'Definition']);
    assert.equal(t.rows.length, 1);
  });

  test('an all-<th> row inside <tbody> is unaffected (already promoted by the existing rule)', () => {
    const xml = dtbook(`<table>
      <tr><th>Word</th><th>Definition</th></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers, ['Word', 'Definition']);
    assert.equal(t.rows.length, 1);
  });

  test('a second, later bold row (not the FIRST row) is never promoted', () => {
    const xml = dtbook(`<table>
      <tr><td>focus</td><td>to direct attention</td></tr>
      <tr><td><strong>Word</strong></td><td><strong>Definition</strong></td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
  });
});

// ---------------------------------------------------------------------------------------
// Part 1a-ii (24 Sep): a leading row that is ONE cell spanning every column is the table's
// TITLE, not its column heading — anthology grammar-handbook tables like "Present-Tense
// Verb Forms" (9780544087507NIMAS.xml, table-133: colspan="2" over a 2-column body). Moved
// to `block.title` (the field a `bana-heading` <caption> already round-trips through
// <caption class="bana-heading">) so the REAL heading row underneath — an all-<th> row, or
// one wholly bold — is read as the table's headers, and a repeated heading on a later
// braille page shows "Singular"/"Plural", not the title.
// ---------------------------------------------------------------------------------------
describe('parseTable (DTBook): a leading spanning-title row is moved to block.title', () => {
  test('spanning title row (colspan = column count) + a wholly-bold next row -> title + headers', () => {
    const xml = dtbook(`<table>
      <tr><td colspan="2"><strong>Present-Tense Verb Forms</strong></td></tr>
      <tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>
      <tr><td>I sleep</td><td>we sleep</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.title, 'Present-Tense Verb Forms');
    assert.equal(t.headers.length, 2);
    assert.equal(t.headers[0].text, 'Singular');
    assert.equal(t.headers[1].text, 'Plural');
    assert.equal(t.rows.length, 1, 'the title row is not a data row, and the real heading row is not either');
    assert.deepEqual(t.rows[0], ['I sleep', 'we sleep']);
  });

  test('spanning title row (no colspan at all — a lone cell already spans a 2-column table) + an all-<th> next row -> title + headers', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Present-Tense Verb Forms</strong></td></tr>
      <tr><th>Singular</th><th>Plural</th></tr>
      <tr><td>I sleep</td><td>we sleep</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.title, 'Present-Tense Verb Forms');
    assert.deepEqual(t.headers, ['Singular', 'Plural']);
    assert.equal(t.rows.length, 1);
  });

  test('a spanning row that is NOT the first row is left alone (row-subheading territory, not a title)', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>
      <tr><td colspan="2"><strong>Present-Tense Verb Forms</strong></td></tr>
      <tr><td>I sleep</td><td>we sleep</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.title, undefined, 'no title extracted — the spanning row was not the leading row');
    assert.deepEqual(t.headers.map((h) => h.text), ['Singular', 'Plural'], 'the FIRST row (wholly bold, one cell per column) is still promoted as usual');
    assert.equal(t.rows.length, 2, 'the later spanning row and the data row are both left as rows');
  });

  test('a single-column table\'s lone first cell is never read as a title (no second column to span)', () => {
    const xml = dtbook(`<table>
      <tr><td><strong>Word List</strong></td></tr>
      <tr><td>focus</td></tr>
      <tr><td>sleep</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.title, undefined, 'unchanged: a 1-column table has no "spanning every column" title row to find');
    // The pre-existing bold-first-row rule (firstRowIsBoldHeader) still promotes this row as
    // usual — that promotion is untouched by this fix, only the "is it a TITLE" question is.
    assert.equal(t.headers.length, 1);
    assert.equal(t.headers[0].text, 'Word List');
    assert.equal(t.rows.length, 2);
  });

  test('a table with only a title row and one header row (no data rows) still extracts the title', () => {
    const xml = dtbook(`<table>
      <tr><td colspan="2"><strong>Forms of Be</strong></td></tr>
      <tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.title, 'Forms of Be');
    assert.deepEqual(t.headers.map((h) => h.text), ['Singular', 'Plural']);
    assert.equal(t.rows.length, 0);
  });
});

// ---------------------------------------------------------------------------------------
// Part 1b: the same promotion in parseHtml's own (separate) table reader.
// ---------------------------------------------------------------------------------------
describe('parseHtml: the same bold-first-row promotion', () => {
  test('every non-empty cell wholly bold -> promoted, dropped from rows', () => {
    const html = '<table><tr><td><strong>Word</strong></td><td><strong>Definition</strong></td></tr>'
      + '<tr><td>focus</td><td>to direct attention</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.headers.length, 2);
    assert.equal(t.headers[0].text, 'Word');
    assert.equal(t.headers[1].text, 'Definition');
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.rows[0], ['focus', 'to direct attention']);
  });

  test('a plain first row is left as data', () => {
    const html = '<table><tr><td>Word</td><td>Definition</td></tr>'
      + '<tr><td>focus</td><td>to direct attention</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
    assert.deepEqual(t.rows[0], ['Word', 'Definition']);
  });

  test('mixed bold/plain cells in the first row are left as data', () => {
    const html = '<table><tr><td><strong>Word</strong></td><td>Definition</td></tr>'
      + '<tr><td>focus</td><td>to direct attention</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.headers.length, 0);
    assert.equal(t.rows.length, 2);
  });

  test('an all-<th> first row is unaffected (already promoted by the existing rule)', () => {
    const html = '<table><tr><th>Word</th><th>Definition</th></tr>'
      + '<tr><td>focus</td><td>to direct attention</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.deepEqual(t.headers, ['Word', 'Definition']);
    assert.equal(t.rows.length, 1);
  });

  test('a picture in a promoted bold header cell becomes exactly one graphic block (htmlCellValue not double-invoked)', () => {
    const html = '<table><tr><td><strong>Word</strong></td><td><strong><img src="a.png" alt="pic"></strong></td></tr>'
      + '<tr><td>focus</td><td>x</td></tr></table>';
    const blocks = parseHtml(html).blocks;
    const t = findTable(blocks);
    assert.equal(t.headers.length, 2, 'still promoted');
    const pics = blocks.filter((b) => b.type === 'graphic');
    assert.equal(pics.length, 1, 'exactly one graphic block, not duplicated by the bold-header check re-reading the cell');
  });
});

// ---------------------------------------------------------------------------------------
// Part 1b-ii (24 Sep): the same leading spanning-title-row rule, in parseHtml's own table
// reader.
// ---------------------------------------------------------------------------------------
describe('parseHtml: a leading spanning-title row is moved to block.title', () => {
  test('spanning title row (colspan = column count) + a wholly-bold next row -> title + headers', () => {
    const html = '<table><tr><td colspan="2"><strong>Present-Tense Verb Forms</strong></td></tr>'
      + '<tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>'
      + '<tr><td>I sleep</td><td>we sleep</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.title, 'Present-Tense Verb Forms');
    assert.equal(t.headers.length, 2);
    assert.equal(t.headers[0].text, 'Singular');
    assert.equal(t.headers[1].text, 'Plural');
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.rows[0], ['I sleep', 'we sleep']);
  });

  test('a spanning row that is NOT the first row is left alone', () => {
    const html = '<table><tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>'
      + '<tr><td colspan="2"><strong>Present-Tense Verb Forms</strong></td></tr>'
      + '<tr><td>I sleep</td><td>we sleep</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.title, undefined);
    assert.deepEqual(t.headers.map((h) => h.text), ['Singular', 'Plural']);
    assert.equal(t.rows.length, 2);
  });

  test('a single-column table\'s lone first cell is never read as a title', () => {
    const html = '<table><tr><td><strong>Word List</strong></td></tr>'
      + '<tr><td>focus</td></tr><tr><td>sleep</td></tr></table>';
    const t = findTable(parseHtml(html).blocks);
    assert.equal(t.title, undefined);
    // The pre-existing bold-first-row rule still promotes this row — unaffected by this fix.
    assert.equal(t.headers.length, 1);
    assert.equal(t.headers[0].text, 'Word List');
    assert.equal(t.rows.length, 2);
  });
});

// ---------------------------------------------------------------------------------------
// Part 1c: save -> reopen keeps the promoted header exactly (the exporter writes it as a
// real <thead>/<th>, which the existing all-<th> rule reads straight back).
// ---------------------------------------------------------------------------------------
describe('save/reopen: a promoted header survives export + re-parse unchanged (mirrors save_reopen_braille.test.mjs)', () => {
  const up = (s) => String(s).toUpperCase();
  const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
  const braille = (doc) => formatDocument(structuredClone(doc), opts);
  const reopen = (doc) => parseDtbook(exportToNimasXml(structuredClone(doc)));

  test('a bold first row promoted at parse time round-trips to a real <thead> and keeps identical braille', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><td><strong>Word</strong></td><td><strong>Definition</strong></td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const doc = parseDtbook(xml);
    const t = findTable(doc.blocks);
    assert.equal(t.headers.length, 2, 'promoted at first parse');

    const xmlOut = exportToNimasXml(doc);
    assert.ok(xmlOut.includes('<thead>'), 'the promoted row is written back as a real <thead>');

    const back = reopen(doc);
    const t2 = findTable(back.blocks);
    assert.deepEqual(t2.headers, t.headers, 'headers survive the round trip');
    assert.deepEqual(t2.rows, t.rows, 'rows survive the round trip');
    assert.equal(braille(back), braille(doc), 'save -> reopen gives identical braille');
  });

  test('a leading spanning-title row promoted at parse time round-trips through <caption class="bana-heading"> with identical braille', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><td colspan="2"><strong>Present-Tense Verb Forms</strong></td></tr>
      <tr><td><strong>Singular</strong></td><td><strong>Plural</strong></td></tr>
      <tr><td>I sleep</td><td>we sleep</td></tr>
    </table>`);
    const doc = parseDtbook(xml);
    const t = findTable(doc.blocks);
    assert.equal(t.title, 'Present-Tense Verb Forms', 'title extracted at first parse');
    assert.deepEqual(t.headers.map((h) => h.text), ['Singular', 'Plural']);

    const xmlOut = exportToNimasXml(doc);
    assert.ok(xmlOut.includes('<caption class="bana-heading">Present-Tense Verb Forms</caption>'), 'the title is written back as a bana-heading caption');
    assert.ok(xmlOut.includes('<thead>'), 'the real heading row is still written back as a <thead>');

    const back = reopen(doc);
    const t2 = findTable(back.blocks);
    assert.equal(t2.title, t.title, 'title survives the round trip');
    assert.deepEqual(t2.headers, t.headers, 'headers survive the round trip');
    assert.deepEqual(t2.rows, t.rows, 'rows survive the round trip');
    assert.equal(braille(back), braille(doc), 'save -> reopen gives identical braille');
  });

  test('a genuinely header-less table (plain first row) also round-trips unchanged', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><td>Word</td><td>Definition</td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const doc = parseDtbook(xml);
    const t = findTable(doc.blocks);
    assert.equal(t.headers.length, 0);

    const back = reopen(doc);
    const t2 = findTable(back.blocks);
    assert.deepEqual(t2.headers, t.headers);
    assert.deepEqual(t2.rows, t.rows);
    assert.equal(braille(back), braille(doc), 'save -> reopen gives identical braille');
  });
});

// ---------------------------------------------------------------------------------------
// Part 2: formatListed / traceTable invent no "Col n:"/"Row n" label for a table that
// truly has no headings.
// ---------------------------------------------------------------------------------------
describe('formatListed (document.mjs): a header-less table gets no invented "Col n:"/"Row n" label', () => {
  const up = (s) => String(s).toUpperCase();
  const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up };
  const NO_COL = /\bCOL\s*\d/;
  const NO_ROW = /\bROW\s*\d/i;

  test('the bug\'s own repro: headers:[] gives the print text alone, no invented label', () => {
    const table = { type: 'table', format: 'listed', headers: [], rows: [['Word', 'Definition'], ['focus', 'to direct']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(!NO_COL.test(lines), `no invented "Col n" label:\n${lines}`);
    assert.ok(!NO_ROW.test(lines), `no invented "Row n" label:\n${lines}`);
    assert.ok(lines.includes('WORD'), 'the first row\'s own heading-shaped text still appears verbatim');
    assert.ok(lines.includes('DEFINITION'));
    assert.ok(lines.includes('FOCUS'));
    assert.ok(lines.includes('TO DIRECT'));
  });

  test('a header-less table whose first column entry is blank does not invent "Row 1" either', () => {
    const table = { type: 'table', format: 'listed', headers: [], rows: [['', 'Definition'], ['focus', 'to direct']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(!NO_ROW.test(lines), `no invented "Row n" label:\n${lines}`);
  });

  test('a header-less table with a blank entry still guide-dots it (11.16.1h), with no heading prefix', () => {
    const table = { type: 'table', format: 'listed', headers: [], rows: [['focus', '']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(lines.includes('"""'), `blank entry is still three guide dots:\n${lines}`);
    assert.ok(!NO_COL.test(lines), `no invented "Col n" label:\n${lines}`);
  });

  test('a table that HAS headings is unchanged: still "HEADING: entry" (no regression)', () => {
    const table = { type: 'table', format: 'listed', headers: ['Word', 'Definition'], rows: [['focus', 'to direct']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(lines.includes('WORD: FOCUS'));
    assert.ok(lines.includes('DEFINITION: TO DIRECT'));
  });

  test('a table that HAS headings but one row\'s own first entry is blank still says "Row n" (unchanged behaviour)', () => {
    const table = { type: 'table', format: 'listed', headers: ['Word', 'Definition'], rows: [['', 'to direct']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(NO_ROW.test(lines), `a table that DOES have headings keeps its existing "Row n" fallback:\n${lines}`);
  });

  test('a table that HAS headings but one COLUMN has no heading text still says "Col n:" (unchanged behaviour)', () => {
    const table = { type: 'table', format: 'listed', headers: ['Word', ''], rows: [['focus', 'to direct']] };
    const lines = formatBlock(table, o).join('\n');
    assert.ok(lines.includes('COL 2: TO DIRECT'), `a table that DOES have headings keeps its existing "Col n:" fallback:\n${lines}`);
  });
});

// ---------------------------------------------------------------------------------------
// Parity: formatBlock and traceBlock (the A39 trace mirror) must agree exactly, for both
// the with-headings and the header-less shape.
// ---------------------------------------------------------------------------------------
describe('formatBlock/traceBlock parity for listed tables, with and without headings', () => {
  let translate, translatePos;
  before(async () => {
    await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
    const T = louis.TABLES.uebG2;
    translate = (t, tf) => louis.translate(t, T, tf || null);
    translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
  });
  const opts = () => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos });
  const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
  const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

  test('header-less listed table', () => {
    parity({ type: 'table', format: 'listed', headers: [], rows: [['Word', 'Definition'], ['focus', 'to direct attention'], ['', 'a state of being']] }, opts());
  });

  test('header-less listed table with a blank entry (guide dots, no prefix)', () => {
    parity({ type: 'table', format: 'listed', headers: [], rows: [['focus', ''], ['being', 'to exist']] }, opts());
  });

  test('a table that HAS headings (regression baseline)', () => {
    parity({ type: 'table', format: 'listed', headers: ['Word', 'Definition'], rows: [['focus', 'to direct attention'], ['', 'a state of being']] }, opts());
  });

  test('a table that HAS headings but one column has no heading text', () => {
    parity({ type: 'table', format: 'listed', headers: ['Word', ''], rows: [['focus', 'to direct attention']] }, opts());
  });

  test('a bold-first-row promoted table (parse -> format), full pipeline', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><td><strong>Word</strong></td><td><strong>Definition</strong></td></tr>
      <tr><td>focus</td><td>to direct attention</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    parity(t, opts());
  });
});

// ---------------------------------------------------------------------------------------
// New problem 4 (real-book re-check, 24 Sep, Emboss/docs/real-book-validation-24sep-recheck.md):
// the rest of bug 2, in tables with spanned cells (anthology p578, "Capitalization of
// Proper Nouns / Abbreviations"). Two gaps in parseTable, neither a genuine two-tier
// header (BANA §11.4.3, already handled by headerGroups above):
//
// 1. A single-row `<th colspan>` heading — no second all-<th> row of sub-headings under
//    it — used to give `headers` one entry per <th>, so the columns it covers past the
//    first came out with NO heading at all and formatListed invented "Col n" (BANA
//    11.16.1d: every column heading is followed by a colon — there must be one). Fixed by
//    repeating the spanning cell's own text into every column it covers, since there is no
//    sub-heading text in the print to draw on instead.
//
// 2. A first-column `<td rowspan>` (the row heading) — BANA §11.5.3a is explicit that a
//    SPATIAL table leaves the rows it covers blank, and that is unchanged (table_rowspan
//    .test.mjs). But §11.16.1e requires a LISTED table's every row to have its own cell-5
//    heading, so for a `bana-listed` table only, column 0 of the rows a rowspan covers now
//    carries the spanning cell's own text instead of staying blank — which also stops
//    formatListed's "Row n" fallback (it only fires on an actually blank cell).
// ---------------------------------------------------------------------------------------
describe('New problem 4: header colspan and first-column rowspan no longer invent "Col n"/"Row n"', () => {
  const up = (s) => String(s).toUpperCase();
  const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up };
  const NO_COL = /\bCOL\s*\d/;
  const NO_ROW = /\bROW\s*\d/i;

  test('a single-row <thead> colspan heading (no second header row) is repeated over every column it covers', () => {
    const xml = dtbook(`<table class="bana-listed">
      <thead><tr><th colspan="2">Capitalization of Proper Nouns</th><th>Abbreviations</th></tr></thead>
      <tbody><tr><td>Organizations</td><td>American Library Association</td><td>ALA</td></tr></tbody>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers.map((h) => (h && h.text) || h), [
      'Capitalization of Proper Nouns', 'Capitalization of Proper Nouns', 'Abbreviations',
    ]);
    assert.equal(t.headers.length, t.rows[0].length);
    const lines = formatBlock(t, o).join('\n');
    const flat = lines.replace(/\s+/g, ' ');
    assert.ok(!NO_COL.test(lines), `no invented "Col n" label:\n${lines}`);
    assert.ok(flat.includes('CAPITALIZATION OF PROPER NOUNS: ORGANIZATIONS'), lines);
    assert.ok(flat.includes('CAPITALIZATION OF PROPER NOUNS: AMERICAN LIBRARY ASSOCIATION'), lines);
    assert.ok(flat.includes('ABBREVIATIONS: ALA'), lines);
  });

  test('an all-<th> row with no <thead> at all (colspan, body-loop promotion) is repeated the same way', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><th colspan="2">Group</th><th>Total</th></tr>
      <tr><td>a</td><td>b</td><td>3</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers.map((h) => (h && h.text) || h), ['Group', 'Group', 'Total']);
    const lines = formatBlock(t, o).join('\n');
    assert.ok(!NO_COL.test(lines), `no invented "Col n" label:\n${lines}`);
  });

  test('a genuine two-tier header (colspan group + a second all-<th> row of sub-headings, F-12) is unaffected', () => {
    const xml = dtbook(`<table class="bana-listed">
      <thead>
        <tr><th rowspan="2">Product</th><th colspan="2">2024</th></tr>
        <tr><th>Q1</th><th>Q2</th></tr>
      </thead>
      <tbody><tr><td>Widgets</td><td>10</td><td>20</td></tr></tbody>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers, ['Product', 'Q1', 'Q2']);
    assert.deepEqual(t.headerGroups, [{ text: '2024', from: 1, to: 2 }]);
  });

  test('the doc repro: a colspan heading and a first-column rowspan together, in LISTED format', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><th colspan="2">Capitalization of Proper Nouns</th><th>Abbreviations</th></tr>
      <tr><td rowspan="2">Organizations</td><td>American Library Association</td><td>ALA</td></tr>
      <tr><td>World Health Organization</td><td>WHO</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.deepEqual(t.headers.map((h) => (h && h.text) || h), [
      'Capitalization of Proper Nouns', 'Capitalization of Proper Nouns', 'Abbreviations',
    ]);
    // The covered row's column 0 keeps "Organizations" — not blank, not shifted.
    const rowText = (row) => row.map((c) => (c && c.text) || c);
    assert.deepEqual(rowText(t.rows[0]), ['Organizations', 'American Library Association', 'ALA']);
    assert.deepEqual(rowText(t.rows[1]), ['Organizations', 'World Health Organization', 'WHO']);

    const lines = formatBlock(t, o).join('\n');
    const flat = lines.replace(/\s+/g, ' ');
    assert.ok(!NO_COL.test(lines), `no invented "Col n" label:\n${lines}`);
    assert.ok(!NO_ROW.test(lines), `no invented "Row n" label:\n${lines}`);
    assert.ok(flat.includes('CAPITALIZATION OF PROPER NOUNS: ORGANIZATIONS'), lines);
    assert.ok(flat.includes('WORLD HEALTH ORGANIZATION'), lines);
    assert.ok(flat.includes('ABBREVIATIONS: WHO'), lines);
  });

  test('the same table WITHOUT a listed class (spatial/default) keeps the 11.5.3a blank fill unchanged', () => {
    const xml = dtbook(`<table>
      <tr><th colspan="2">Capitalization of Proper Nouns</th><th>Abbreviations</th></tr>
      <tr><td rowspan="2">Organizations</td><td>American Library Association</td><td>ALA</td></tr>
      <tr><td>World Health Organization</td><td>WHO</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.notEqual(t.format, 'listed');
    const rowText = (row) => row.map((c) => (c && c.text) || c);
    // Row-heading column stays blank for the covered row — BANA 11.5.3a, F-1's own rule,
    // untouched by the listed-only fix above.
    assert.deepEqual(rowText(t.rows[1]), ['', 'World Health Organization', 'WHO']);
  });

  test('save -> reopen: the colspan+rowspan repro keeps identical headers, rows and braille', () => {
    const xml = dtbook(`<table class="bana-listed">
      <tr><th colspan="2">Capitalization of Proper Nouns</th><th>Abbreviations</th></tr>
      <tr><td rowspan="2">Organizations</td><td>American Library Association</td><td>ALA</td></tr>
      <tr><td>World Health Organization</td><td>WHO</td></tr>
    </table>`);
    const doc = parseDtbook(xml);
    const before = formatDocument(structuredClone(doc), { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
    const back = parseDtbook(exportToNimasXml(structuredClone(doc)));
    const t1 = findTable(doc.blocks);
    const t2 = findTable(back.blocks);
    assert.deepEqual(t2.headers.map((h) => (h && h.text) || h), t1.headers.map((h) => (h && h.text) || h));
    assert.deepEqual(t2.rows, t1.rows);
    const after = formatDocument(back, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
    assert.equal(after, before, 'save -> reopen gives identical braille');
  });
});
