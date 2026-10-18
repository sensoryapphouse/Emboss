// BANA 11.16.1g (KD, the BANA transcriber, 28 Sep 2026 — the March 2024 errata's reason for
// Sample 11-24 line 15, closing K28's last item): a listed-table column heading followed by a
// cell that holds MORE THAN ONE entry (print shows several office-holders, one per line, in a
// single cell — Sample 11-24's Secretary of State/Treasury/War/Navy columns) is laid out with
// the heading alone at 1-5 margins and each entry at 3-5 margins, not "heading: entry" run
// together at 1-3 (11.16.1f, which stays the rule for a column with only a single entry).
//
// A cell's entries are '\n'-separated (see format/cell-markup.mjs and format/document.mjs's
// splitCellEntries); parse.mjs's brAsNewline now reads a <br/> back as '\n' for a listed table
// too (previously only for stairstep), so an imported table can actually carry one.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// A plain, easy-to-read stand-in translate (as listed_table_headings.test.mjs and others in
// this suite use): margins are checked from the literal leading spaces on each returned line,
// which up()/translatePos below leave untouched.
const up = (s) => String(s).toUpperCase();
const opts = () => ({
  mode: 'bana', standard: 'bana', width: 40, depth: 25,
  translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});

// formatBlock (formatListed) and traceBlock (traceTable's traceListed) must agree exactly —
// A39, and the specific thing check-layout-parity.mjs sweeps over the whole corpus for.
function bothPaths(table) {
  const o = opts();
  const real = formatBlock(table, o, false);
  const traced = traceBlock(table, o, false);
  assert.equal(traced.length, real.length, 'formatBlock/traceBlock line count must match');
  for (let i = 0; i < real.length; i++) assert.equal(traced[i].s, real[i], `line ${i} text must match`);
  assert.deepEqual(traced.keepGroups, real.keepGroups, 'keepGroups must match');
  return real;
}

describe('BANA 11.16.1g: listed-table column heading with multiple entries', () => {
  test('a multi-entry cell lays out the heading alone at 1-5 and each entry at 3-5', () => {
    const table = {
      type: 'table', format: 'listed',
      headers: ['President', 'Secretary of State'],
      rows: [['George Washington', 'Thomas Jefferson\nEdmund Randolph\nTimothy Pickering']],
    };
    const lines = bothPaths(table);

    // Heading alone, cell 1 (1-5's first-line margin) — colon, no entry run onto the line.
    assert.ok(lines.includes('SECRETARY OF STATE:'), `expected a heading-alone line:\n${lines.join('\n')}`);
    // Each entry at cell 3 (3-5's first-line margin: 2 leading spaces).
    assert.ok(lines.includes('  THOMAS JEFFERSON'), `expected an indented entry line:\n${lines.join('\n')}`);
    assert.ok(lines.includes('  EDMUND RANDOLPH'), `expected an indented entry line:\n${lines.join('\n')}`);
    assert.ok(lines.includes('  TIMOTHY PICKERING'), `expected an indented entry line:\n${lines.join('\n')}`);
    // The entries follow the heading line in the same order print gave them (11.16.1i).
    const hi = lines.indexOf('SECRETARY OF STATE:');
    assert.deepEqual(lines.slice(hi, hi + 4), ['SECRETARY OF STATE:', '  THOMAS JEFFERSON', '  EDMUND RANDOLPH', '  TIMOTHY PICKERING']);

    // The old bug (11.16.1f applied to every column): heading and first entry run together
    // on one 1-3 line, the runover entries spilling to cell 3 instead of cell 5. That line
    // must not appear now.
    assert.ok(!lines.some((l) => l.includes('SECRETARY OF STATE: THOMAS JEFFERSON')), `must not run heading and entry together:\n${lines.join('\n')}`);
  });

  test('a single-entry table is unchanged (11.16.1f: 1-3 margins, "heading: entry" on one line)', () => {
    const table = {
      type: 'table', format: 'listed',
      headers: ['President', 'Vice President'],
      rows: [['George Washington', 'John Adams']],
    };
    const lines = bothPaths(table);
    assert.ok(lines.includes('VICE PRESIDENT: JOHN ADAMS'), `expected the unchanged single-entry line:\n${lines.join('\n')}`);
    assert.ok(!lines.includes('VICE PRESIDENT:'), `a single entry must not be split onto its own heading line:\n${lines.join('\n')}`);
  });

  test('a mixed row: a single-entry column and a multi-entry column together', () => {
    const table = {
      type: 'table', format: 'listed',
      headers: ['President', 'Vice President', 'Secretary of State'],
      rows: [['George Washington', 'John Adams', 'Thomas Jefferson\nEdmund Randolph']],
    };
    const lines = bothPaths(table);
    // Single-entry column: unchanged, one 1-3 line.
    assert.ok(lines.includes('VICE PRESIDENT: JOHN ADAMS'), `single-entry column must stay on one line:\n${lines.join('\n')}`);
    // Multi-entry column: heading alone, then each entry indented.
    const hi = lines.indexOf('SECRETARY OF STATE:');
    assert.notEqual(hi, -1, `expected a heading-alone line:\n${lines.join('\n')}`);
    assert.deepEqual(lines.slice(hi, hi + 3), ['SECRETARY OF STATE:', '  THOMAS JEFFERSON', '  EDMUND RANDOLPH']);
    // The single-entry column's line comes before the multi-entry column's (print's own column order, 11.16.1i).
    assert.ok(lines.indexOf('VICE PRESIDENT: JOHN ADAMS') < hi, 'columns must stay in print order');
  });

  test('a blank cell (no entries at all) is unaffected: three guide dots, not a heading-alone split', () => {
    const table = {
      type: 'table', format: 'listed',
      headers: ['President', 'Vice President'],
      rows: [['George Washington', '']],
    };
    const lines = bothPaths(table);
    assert.ok(lines.some((l) => l.includes('"""')), `expected the guide-dot blank entry:\n${lines.join('\n')}`);
  });
});

describe('an imported listed table can carry a multi-entry cell', () => {
  let translate, translatePos;
  before(async () => {
    await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
    const T = louis.TABLES.uebG2;
    translate = (t, tf) => louis.translate(t, T, tf || null);
    translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
  });

  const dtbook = (tableXml) => `<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
    ${tableXml}
  </level1></bodymatter></book></dtbook>`;
  const findTable = (blocks) => blocks.find((b) => b && b.type === 'table');

  test('a <br/>-separated cell in a bana-listed table round-trips as a multi-entry ("\\n") cell', () => {
    const xml = dtbook(`<table class="bana-listed">
      <thead><tr><th>President</th><th>Secretary of State</th></tr></thead>
      <tr><td>George Washington</td><td>Thomas Jefferson<br/>Edmund Randolph<br/>Timothy Pickering</td></tr>
    </table>`);
    const t = findTable(parseDtbook(xml).blocks);
    assert.equal(t.format, 'listed');
    assert.equal(t.rows[0][1], 'Thomas Jefferson\nEdmund Randolph\nTimothy Pickering');

    // ... and lays out per 11.16.1g once formatted.
    const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
    const lines = formatBlock(t, o);
    const hi = lines.findIndex((l) => /SECRETARY OF STATE.?$/i.test(l) || l.trim().toUpperCase().startsWith(',SEC'));
    assert.notEqual(hi, -1, `expected a heading-alone line for the multi-entry column:\n${lines.join('\n')}`);

    // Re-exporting the re-parsed table keeps the same <br/>-separated cell (round-trip is stable).
    const xml2 = exportToNimasXml({ title: null, blocks: [t] });
    assert.match(xml2, /Thomas Jefferson<br\/>Edmund Randolph<br\/>Timothy Pickering/);
  });
});
