// TBL-NUM-1 (Paul, 28 Sep 2026; KD round-2 Q4, questions-round-2.md "Tables (§11 ...)"): BANA
// §11.7.1j-l / UEB §6.9 — a table whose row headings and column entries are all numbers may
// use the numeric passage indicator ('##' before the first entry, "#'" after the last, so no
// individual number needs its own numeral sign) instead of a numeral sign before every number,
// optionally combined with a one-cell gap between columns (§11.7.1l) where the standard 2-cell
// gap does not fit the table on one page. Off by default (block.numericPassage); see
// document.mjs's computeTableColumns/numericPassageEligible/applyNumericPassageMarks and
// formatTable/traceTable's formatColumnar/traceColumnar for the implementation this exercises.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatBlock, traceBlock } from '../format/document.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';
import { parseDtbook } from '../input/parse.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');
const GOLD_FILE = path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016', 'section-11', 'example-11-9.json');

let o;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
  o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
});

// formatBlock/traceBlock must always agree (A39, check-layout-parity.mjs's own comparison) —
// every assertion in this file goes through the output this returns, never formatBlock alone.
function parity(block, opts) {
  const f = formatBlock(block, opts, false);
  const t = traceBlock(block, opts, false).map((x) => x.s);
  assert.deepEqual(t, f, 'formatBlock and traceBlock agree (A39)');
  return f;
}
const trimEnd = (ls) => { const out = [...ls]; while (out.length && out[out.length - 1] === '') out.pop(); return out; };
const rstrip = (l) => String(l).replace(/\s+$/, '');
// formatBlock/traceBlock (unlike formatDocument's buildDocPages) do not trim a leading blank
// line of their own or strip trailing padding spaces — mirror gold-run.mjs's own
// expectedLinesFor / trimLeadingBlank convention (and column_gaps.test.mjs's rstrip) so a
// direct formatBlock call compares like with like against a gold `braille.lines` array.
const clean = (ls) => { const out = ls.map(rstrip); return out[0] === '' ? out.slice(1) : out; };
// A fresh-opts warning check for JUST the format (or just the trace) path — mirrors
// transcription_warnings.test.mjs's own table-fallback tests, which never share one
// `_warnings` array between formatBlock and traceBlock (each path warns independently).
function formatWarnings(block, opts) {
  const w = { ...opts, _warnings: [] };
  formatBlock(block, w, false);
  return w._warnings;
}
function traceWarnings(block, opts) {
  const w = { ...opts, _warnings: [] };
  traceBlock(block, w, false);
  return w._warnings;
}

test('Example 11-9: the numeric passage table matches the book line for line, with the option on', () => {
  const block = {
    type: 'table',
    numericPassage: true,
    title: 'SAMPLE NUMBER TABLE',
    headers: ['', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri'],
    rows: [
      ['1', '87171', '43062', '39713', '10024', '3272'],
      ['2', '28903', '50856', '30549', '89187', '1674'],
      ['3', '86244', '71151', '55036', '13044', '3316'],
    ],
  };
  const actual = trimEnd(clean(parity(block, o)));
  const gold = JSON.parse(fs.readFileSync(GOLD_FILE, 'utf8'));
  // Same normalisation gold-run.mjs's expectedLinesFor applies: the gold corpus's own
  // lower-case transcription artifact is upper-cased before comparing (see that function's
  // header comment / gold-run.mjs's SUMMARY).
  const expected = trimEnd(gold.braille.lines.map((l) => (typeof l === 'string' ? l.toUpperCase() : l)));
  assert.deepEqual(actual, expected, `expected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  // The note (11.7.1j "place a transcriber's note before the table"), the dot-locator-for-
  // mention symbols (11.7.1l "these symbols are required on the Special Symbols page" — UEB
  // §3.3.1's '.=' convention, BANA §2.5.2c), the opening/closing markers and the digit-letter
  // row headings (1/2/3 -> a/b/c) are all present.
  assert.ok(actual.includes('.=## ,NUM]IC PASSAGE 9DICATOR'), JSON.stringify(actual));
  assert.ok(actual.includes(".=#' ,NUM]IC T]M9ATOR@.>"), JSON.stringify(actual));
  assert.ok(actual.some((l) => l.startsWith('##A')), JSON.stringify(actual));
  assert.ok(actual.some((l) => l.endsWith("CCAF#'")), JSON.stringify(actual));
  // 11.7.1j's own condition ("only when it results in the table appearing on one page") is
  // met here without narrowing the gap — the standard 2-cell gutter (11.2.5b, K33) already
  // fits, so 11.7.1l's optional one-cell gap is NOT used (gold-verified: two spaces between
  // every pair of columns, not one).
  assert.ok(actual.some((l) => l.includes('HGAGA  DCJFB')), 'two-cell gutter, not one, when it already fits: ' + JSON.stringify(actual));
});

test('a two-column numeric table: with the option, entries carry the passage markers and no per-entry numeral sign; without, plain numeral translation', () => {
  const base = { type: 'table', headers: ['', 'Amount'], rows: [['1', '5'], ['2', '9']] };
  const on = parity({ ...base, numericPassage: true }, o);
  const off = parity({ ...base, numericPassage: false }, o);
  assert.deepEqual(on, ['', '      @.<,SYMBOLS US$ 2L3', '', '.=## ,NUM]IC PASSAGE 9DICATOR', ".=#' ,NUM]IC T]M9ATOR@.>", '', '     ,AM.T', '     "3333', '##A  E    ', "B    I#'  ", '']);
  assert.deepEqual(off, ['', '    ,AM.T', '    "3333', '#A  #E   ', '#B  #I   ', '']);
  // No numeral sign ('#') anywhere on the passage's OWN entry lines once opened, except the
  // opening/closing markers themselves.
  assert.ok(!on[8].replace('##A', '').includes('#'), on[8]);
  // Off (plain numeral translation): every entry keeps its own numeral sign.
  assert.ok(off[3].includes('#A') && off[3].includes('#E'), off[3]);
});

test('a non-numeric table with the option on: unchanged output, and a table-fallback warning', () => {
  const bad = { type: 'table', numericPassage: true, headers: ['Name', 'Score'], rows: [['Ann', '87'], ['Bob', 'n/a']] };
  const plain = { ...bad, numericPassage: false };
  const onLines = parity(bad, o);
  const offLines = parity(plain, o);
  assert.deepEqual(onLines, offLines, 'the option is ignored — the table is not all-numeric (the Score column has "n/a")');
  // formatBlock and traceBlock each record their own table-fallback warning independently
  // (transcription_warnings.test.mjs's own convention — never shared, so checked separately).
  for (const warnings of [formatWarnings(bad, o), traceWarnings(bad, o)]) {
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].kind, 'table-fallback');
    assert.match(warnings[0].message, /not eligible/);
  }
});

test('a numeric-passage table combined with a two-tier header: option ignored, warning pushed (no gold table combines them)', () => {
  const block = {
    type: 'table',
    numericPassage: true,
    headers: ['Year', 'Total'],
    headerGroups: [{ text: 'Group', from: 0, to: 1 }],
    rows: [['1', '2'], ['3', '4']],
  };
  const lines = parity(block, o);
  assert.ok(!lines.join('\n').includes('##'), 'no passage marker: ' + JSON.stringify(lines));
  for (const warnings of [formatWarnings(block, o), traceWarnings(block, o)]) {
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].kind, 'table-fallback');
  }
});

test('11.7.1l: the one-cell gap is used only once the standard two cells does not fit the table on one page, and both layout paths still agree', () => {
  const block = {
    type: 'table',
    numericPassage: true,
    headers: ['', 'A', 'B', 'C'],
    rows: [
      ['1', '2222', '3333', '4444'],
      ['2', '5555', '6666', '7777'],
    ],
  };
  // Wide enough for the standard 2-cell gutter (natural width): two spaces between columns.
  const wide = parity(block, { ...o, width: 24 });
  assert.ok(wide.some((l) => l.includes('BBBB  CCCC')), JSON.stringify(wide));
  // Narrow enough that only the one-cell gutter (11.7.1l) still keeps it columnar on one
  // page — both formatBlock and traceBlock (parity()) must reach the SAME layout choice
  // (this was the bug found while building this feature: traceTable's own 'auto'-mode
  // pre-check tried only the 2-cell gutter and rejected the table before traceColumnar's
  // matching 1-cell fallback ever ran, sending it to vertical division instead of
  // formatTable's 1-cell columnar — see traceTable's autoWidths comment).
  const narrow = parity(block, { ...o, width: 22 });
  assert.ok(narrow.some((l) => l.includes('BBBB CCCC') && !l.includes('BBBB  CCCC')), JSON.stringify(narrow));
});

test('NIMAS round trip: numericPassage is written as a DTBook class token and re-read unchanged', () => {
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'table', headers: ['', 'Amount'], rows: [['1', '5'], ['2', '9']], numericPassage: true }] };
  const xml = exportToNimas(model);
  assert.match(xml, /<table class="bana-numeric-passage">/);
  const back = parseDtbook(xml);
  const t = back.blocks.find((b) => b.type === 'table');
  assert.equal(t.numericPassage, true);
  // A table that does not use the option writes no such class token (fields are written only when set).
  const modelOff = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'table', headers: ['', 'Amount'], rows: [['1', '5'], ['2', '9']] }] };
  const xmlOff = exportToNimas(modelOff);
  assert.ok(!xmlOff.includes('bana-numeric-passage'), xmlOff);
});
