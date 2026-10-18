// Optional table fields from the BANA Formats section 11 (Tables) gold set (23 Sep 2026, part 2).
// Every field is optional; without it output is unchanged (asserted below).
//  - table.citation      F-14, 11.2.5g / 9.5.3: source citation, 5-5 margins; below the box (default) or inside it
//  - table.totalRows     F-17, 11.6.2b: retained horizontal line across each total entry, above a total row
//  - table.rowSubheadings F-12 remainder, 11.5.1b: primary row headings 1-5, secondary row headings 3-5
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };
const nonBlank = (a) => a.filter((l) => l !== '');

const base = () => ({ type: 'table', format: 'columnar', headers: ['Age', 'Males', 'Females'], rows: [['29-44', '34,000', '10,000'], ['45-64', '257,000', '86,000'], ['Total', '291,000', '96,000']] });

test('no optional field: output identical, boxed and unboxed', () => {
  const t = base();
  const plain = both(t);
  assert.deepEqual(both({ ...t, citation: '', totalRows: [], rowSubheadings: [] }), plain);
  assert.deepEqual(both({ type: 'box', blocks: [t] }), both({ type: 'box', blocks: [{ ...t, citation: null }] }));
});

test('citation: unboxed, next line after the table, 5-5 margins (11.2.5g)', () => {
  const plain = both(base());
  const out = both({ ...base(), citation: 'Source: American Heart Association' });
  const n = plain.length - 1;                                    // the table's trailing blank
  assert.deepEqual(out.slice(0, n), plain.slice(0, n));
  assert.match(out[n], /^ {4}\S/);                               // blocked four cells right
  assert.equal(out[n + 1], '');
  assert.ok(out.length >= plain.length + 1);
});

test('citation: long text runs over at cell 5 (5-5)', () => {
  const out = both({ ...base(), citation: 'Source: a very long citation that certainly will not fit on one forty cell line at all' });
  const c = out.filter((l) => /^ {4}\S/.test(l));
  assert.ok(c.length >= 2);
  assert.ok(out.every((l) => !/^ {5,}\S/.test(l) || /^ {4}\S/.test(l) === false));
});

test('citation in a box: default below the bottom box line, no blank between, blank after (11.2.5g, 9.5.3)', () => {
  const out = both({ type: 'box', blocks: [{ ...base(), citation: 'Source: X' }] });
  const bi = out.indexOf('G'.repeat(40));
  assert.ok(bi > 0);
  assert.match(out[bi + 1], /^ {4}\S/);
  assert.equal(out[bi + 2], '');
  assert.equal(out.filter((l) => /^ {4}\S/.test(l)).length, 1);
});

test('citation in a box, position inside-box: last line inside the box, above the bottom box line', () => {
  const out = both({ type: 'box', blocks: [{ ...base(), citation: { text: 'Source: X', position: 'inside-box' } }] });
  const bi = out.indexOf('G'.repeat(40));
  assert.match(out[bi - 1], /^ {4}\S/);
  assert.equal(out[bi + 1], '');
});

test('totalRows: a horizontal line under each numeric total entry, above the total row (11.6.2b)', () => {
  const plain = both(base());
  const out = both({ ...base(), totalRows: [2] });
  assert.equal(out.length, plain.length + 1);
  const ti = out.findIndex((l) => l.startsWith(',TOTAL') || l.startsWith(',total'.toUpperCase()));
  const rule = out[ti - 1];
  assert.match(rule, /^ +"3+ +"3+$/);
  // the line spans exactly the extent of each total entry
  const tot = out[ti];
  const ext = (s) => [...s.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
  const tcells = ext(tot).filter(([a]) => a > 5);
  const rcells = ext(rule);
  assert.equal(rcells.length, 2);
  assert.deepEqual(rcells, tcells.slice(-2));
  // row 0 and out-of-range indexes are ignored
  assert.deepEqual(both({ ...base(), totalRows: [0, 9, -1, 'x'] }), plain);
});

test('totalRows: a total column without digits gets no line', () => {
  const t = { type: 'table', format: 'columnar', headers: ['A', 'B'], rows: [['x', '1'], ['y', '2'], ['Total', 'n/a']] };
  assert.deepEqual(both({ ...t, totalRows: [2] }), both(t));
});

test('rowSubheadings: primary heading 1-5 with no entries, secondary row headings 3-5 with guide dots (11.5.1b)', () => {
  const t = { type: 'table', format: 'columnar', headers: ['Item', '1980', '1981'], rowSubheadings: [{ row: 0, text: 'Machining Centers' }, { row: 2, text: 'Punching and Shearing Machines' }],
    rows: [['Production', '413.0', '482.6'], ['Exports', '56.7', '53.4'], ['Production', '110.6', '97.1'], ['Exports', '13.2', '28.3']] };
  const out = nonBlank(both(t));
  const iM = out.findIndex((l) => l.startsWith(',MA*9+'));
  assert.equal(out[iM], ',MA*9+ ,C5T]S');                        // no entries, no dots
  assert.match(out[iM + 1], /^ {2},PRODUC;N "+ /);               // 3-5: indented two, guide dots after
  assert.match(out[iM + 2], /^ {2},EXPORTS "+ /);
  const iP = out.findIndex((l) => l.startsWith(',PUN*+'));
  assert.ok(iP > iM + 2);
  assert.match(out[iP + 1], /^ {2},PRODUC;N/);
  // the row-heading column is wide enough for the primary heading: every numeric column starts at the same cell
  const starts = out.filter((l) => /#/.test(l)).map((l) => l.indexOf('#'));
  assert.ok(new Set(starts.slice(1)).size <= 2);
});

test('rowSubheadings: a secondary heading that runs over takes cell 5 (3-5)', () => {
  const t = { type: 'table', format: 'columnar', headers: ['Item', 'N'], rowSubheadings: [{ row: 0, text: 'Group' }],
    rows: [['Half pack or more per day of the total', '1.5']] };
  const out = nonBlank(both(t, { ...opts, width: 30 }));
  const runover = out.filter((l) => /^ {4}\S/.test(l));
  assert.ok(runover.length >= 1);
});

test('optional fields join the block-signature cache key', () => {
  const t = base();
  const k = (b) => getBlockSignature(b, opts, false);
  assert.notEqual(k(t), k({ ...t, citation: 'Source: X' }));
  assert.notEqual(k({ ...t, citation: 'Source: X' }), k({ ...t, citation: { text: 'Source: X', position: 'inside-box' } }));
  assert.notEqual(k(t), k({ ...t, totalRows: [2] }));
  assert.notEqual(k(t), k({ ...t, rowSubheadings: [{ row: 0, text: 'G' }] }));
});

test('citation on a non-columnar layout (listed) still follows the table', () => {
  const out = both({ ...base(), format: 'listed', citation: 'Source: X' });
  assert.match(out[out.length - 2], /^ {4}\S/);
  assert.equal(out[out.length - 1], '');
});
