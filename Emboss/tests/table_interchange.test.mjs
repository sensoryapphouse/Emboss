// BANA Braille Formats 2016 §11.15 Wide Tables: Interchanged Columns and Rows; UKAAF B004 Appendix E, "Good practice
// example of a transposed table".
//
//   11.15.1 "Sometimes it is possible to fit a wide table across the page by interchanging the table columns and rows.
//   This is done only if it preserves the clarity of the table. Insert a transcriber's note before the table. Sample:
//   Columns and rows are interchanged."
//   B004 App E: "To fit the braille page, the table has been transposed ..." — its braille opens with the note
//   "The table has been transposed in braille and capitals are not indicated."
//
// Emboss: table `format: 'interchange'` (or settings tableFormat 'interchange'), selectable only — whether it "preserves
// the clarity of the table" is the transcriber's judgement, so 'auto' never picks it. The print column headings become
// the row headings and the print row headings the column headings; the result is an ordinary columnar table, with the
// rule's note first in the table's opening note, when it fits across the page (squeezed without dividing a word, no
// entry over two lines, §11.6.1). Otherwise the table is laid out as 'auto' would lay it out.
//
// The exact-braille proof is BANA's own Sample 11-23 (tests/gold/bana-formats-2016/section-11/sample-11-23.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument, formatBlock, traceBlock, tableLayout, getBlockSignature, suggestTranscriberNotes } from '../format/document.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { sanitizeSettings } from '../web/settings.mjs';
import * as louis from '../engine/louis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const opts = (mode = 'bana', extra = {}) => ({ mode, standard: mode, width: mode === 'bana' ? 40 : 38, depth: 25, translate, ...extra });
const up = (l) => l.toUpperCase();
const rstrip = (l) => l.replace(/\s+$/, '');
const lines = (block, o = opts()) => formatBlock(block, o, false).map(rstrip);
const nonBlank = (a) => a.filter((l) => l !== '');

// Sample 11-23's print (the gold file's print description, not its braille).
const gold = JSON.parse(fs.readFileSync(path.join(HERE, 'gold', 'bana-formats-2016', 'section-11', 'sample-11-23.json'), 'utf8'));
const sunrise = (format = 'interchange', extra = {}) => ({ type: 'table', format, headers: gold.print.headers[0], rows: gold.print.rows, ...extra });

test('Sample 11-23: the interchanged table is the book\'s braille, line for line', () => {
  // The gold's line 1 is the placeholder "text" and line 2 its blank line; the book boxes the table (11.2.5).
  const pages = formatDocument({ title: null, blocks: [{ type: 'box', blocks: [sunrise()] }] }, opts('bana', { suppressHeader: true }))
    .split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n').map(rstrip));
  const want = gold.braille.lines.slice(2).map(up);
  while (want.length && want[want.length - 1] === '') want.pop();
  assert.deepEqual(pages[0].slice(0, want.length), want);
});

test('11.15.1: the transcriber\'s note comes before the table, in the rule\'s own words (BANA); B004\'s in UKAAF', () => {
  const b = lines(sunrise());
  assert.equal(nonBlank(b)[0], '      @.<,COLUMNS & R[S >E 9T]*ANG$4@.>');
  // the column headings are the print row headings, the row headings the print column headings
  assert.match(nonBlank(b)[1], /^ {6},SUNRISE +,SUNSET$/);
  assert.deepEqual(nonBlank(b).slice(3).map((l) => l.split(' ')[0]), [',JAN', ',FEB', ',M>', ',APR', ',MAY', ',JUN']);
  const u = lines(sunrise(), opts('ukaaf'));
  assert.match(nonBlank(u).slice(0, 2).join(' '), /^ +@\.<,! TABLE HAS BE5 TRANSPOS\$ 9 +BRL4@\.>$/);
  assert.ok(!/COLUMNS & R\[S/.test(u.join('\n')));
});

test('a note of the table\'s own comes first, then the interchange note, in one note (as the columnar format joins them)', () => {
  const b = nonBlank(lines(sunrise('interchange', { tabletn: 'Times are local.' })));
  assert.equal(b[0], '      @.<,"TS >E LOCAL4');
  assert.equal(b[1], '      ,COLUMNS & R[S >E 9T]*ANG$4@.>');   // each paragraph of the note in 7-5, as formatColumnar sets them
});

test('Auto never interchanges: the same table under auto (or no format) is not transposed and has no interchange note', () => {
  for (const fmt of ['auto', null, 'columnar', 'vertical']) {
    const b = lines(sunrise(fmt));
    assert.ok(!/COLUMNS & R\[S/.test(b.join('\n')), String(fmt));
    assert.notEqual(tableLayout(sunrise(fmt), opts()), 'interchange');
  }
  assert.equal(tableLayout(sunrise(), opts()), 'interchange');
});

test('settings tableFormat "interchange" applies to a table with no format of its own; a table\'s own format wins', () => {
  assert.deepEqual(lines(sunrise(null), opts('bana', { tableFormat: 'interchange' })), lines(sunrise()));
  assert.deepEqual(lines(sunrise('auto'), opts('bana', { tableFormat: 'interchange' })), lines(sunrise('auto')));
  assert.equal(sanitizeSettings({ tableFormat: 'interchange' }).tableFormat, 'interchange');
});

test('not interchanged (laid out as auto): does not fit even interchanged, a two-tier heading, row subheadings, no rows', () => {
  // 3 print columns of long text x 6 rows: interchanged it has 7 columns, far too wide
  const tall = { type: 'table', headers: ['Name', 'Description', 'Notes'],
    rows: Array.from({ length: 6 }, (_, i) => [`Item ${i + 1}`, 'A fairly long description of the thing', 'Some further notes here']) };
  const grouped = { ...sunrise('auto'), headerGroups: [{ text: 'First half', from: 1, to: 6 }] };
  const subs = { ...sunrise('auto'), rowSubheadings: [{ row: 0, text: 'Times' }] };
  const noRows = { type: 'table', headers: ['A', 'B'], rows: [] };
  for (const t of [tall, grouped, subs, noRows]) {
    assert.deepEqual(lines({ ...t, format: 'interchange' }), lines({ ...t, format: 'auto' }));
    assert.equal(tableLayout({ ...t, format: 'interchange' }, opts()), tableLayout({ ...t, format: 'auto' }, opts()));
  }
});

test('print alignment: kept when every print data column shares it; a key to the column headings keys the row headings', () => {
  const t = { type: 'table', format: 'interchange', headers: ['', 'Alpha', 'Beta', 'Gamma'], rows: [['Row one', '1.5', '12.25', '3'], ['Row two', '10', '2.5', '100.75']], printAlign: [null, 'decimal', 'decimal', 'decimal'] };
  // decimal alignment (11.6.1d) in each new column (a print row): the decimal points line up
  assert.deepEqual(nonBlank(lines(t)).slice(3), [',ALPHA   #A4E    #AJ', ',2TA    #AB4BE    #B4E', ',GAMMA   #C ""  #AJJ4GE']);
  // mixed print alignment: none carried (entries left-justified, guide dots)
  assert.deepEqual(nonBlank(lines({ ...t, printAlign: [null, 'decimal', null, 'decimal'] })).slice(3), [',ALPHA  #A4E    #AJ', ',2TA    #AB4BE  #B4E', ',GAMMA  #C """  #AJJ4GE']);
  const keyed = { ...sunrise(), key: [{ symbol: 'Jan', meaning: 'January' }] };
  assert.match(lines(keyed).join('\n'), /,KEY TO R\[ H1D\+S3\n,JAN ,JANU>Y@\.>/);
});

test('A39: traceBlock gives formatBlock\'s lines, and each braille entry traces back to its own PRINT cell', () => {
  const o = { ...opts(), translatePos };
  for (const t of [sunrise(), sunrise('interchange', { tabletn: 'Times are local.' }), { ...sunrise(), headers: gold.print.headers[0].slice(0, 5) }]) {
    const f = formatBlock(t, o, false);
    const tr = traceBlock(t, o, false);
    assert.deepEqual(tr.map((x) => x.s), f);
  }
  const tr = traceBlock(sunrise(), o, false);
  const at = (needle) => { const l = tr.find((x) => x.s.includes(needle)); const i = l.s.indexOf(needle); return l.src[i] && l.src[i].u; };
  const H = gold.print.headers[0].length, C = H;
  assert.equal(at(',SUNRISE'), H + 0 * C + 0);          // print row 0's heading
  assert.equal(at(',SUNSET'), H + 1 * C + 0);           // print row 1's heading
  assert.equal(at(',JAN'), 1);                          // print column heading 1
  assert.equal(at(',JUN'), 6);                          // print column heading 6
  assert.equal(at('#G3#BC'), H + 0 * C + 1);            // Sunrise, Jan (7:23 AM)
  assert.equal(at('#H3#CA'), H + 1 * C + 6);            // Sunset, Jun (8:31 AM)
  // whole documents: the editor path (translatePos) gives the same braille
  for (const mode of ['bana', 'ukaaf']) {
    const doc = { title: 'Book', blocks: [{ type: 'para', text: 'Before.' }, sunrise(), { type: 'para', text: 'After.' }] };
    assert.equal(formatDocument(doc, { ...opts(mode), translatePos }), formatDocument(doc, opts(mode)));
  }
});

test('cache key and transcriber\'s notes page: the format is part of the key; the Transcriber\'s Notes page offers a note', () => {
  assert.notEqual(getBlockSignature(sunrise(), opts(), false), getBlockSignature(sunrise('auto'), opts(), false));
  const s = suggestTranscriberNotes([sunrise()], opts());
  assert.ok(s.some((n) => n.id === 'table-interchange'), JSON.stringify(s));
  assert.ok(!suggestTranscriberNotes([sunrise('auto')], opts()).some((n) => n.id === 'table-interchange'));
});

test('NIMAS round trip: format "interchange" is class="bana-interchange"; the print table itself is kept as print has it', () => {
  const block = sunrise();
  const xml = exportToNimasXml({ title: null, blocks: [block] });
  assert.match(xml, /<table class="bana-interchange">/);
  const find = (bs) => bs.find((b) => b && b.type === 'table') || bs.map((b) => (b && b.blocks ? find(b.blocks) : null)).find(Boolean);
  const t = find(parseDtbook(xml).blocks);
  assert.equal(t.format, 'interchange');
  assert.deepEqual(t.rows, block.rows);
});
