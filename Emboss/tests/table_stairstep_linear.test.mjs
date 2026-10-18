// T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026 — standards-findings.md F-18): BANA Braille
// Formats 2016 §11.18 Stairstep Table Format and §11.17 Linear Table Format, both SELECTABLE
// (`block.format = 'stairstep' | 'linear'`), never chosen by 'auto'.
//
//   11.18.1 "Limit this format to tables with four or fewer columns. For larger tables use the
//   Listed Table Format in Formats, §11.16."
//   c. note "Table changed as follows:", blank line, headings blocked 1-1 / 3-3 / 5-5 / 7-7, the
//      closing note indicator after the last heading;  d. blank line after the note;
//   e. entries 1-1, 3-3, 5-5, 7-7;  f. later paragraphs of an entry two cells in (3-3 -> 5-3);
//   j. a subdivision heading is a cell-5 heading, named first in the note;
//   l. three unspaced guide dots for a blank entry, explained in the note.
//
//   11.17.1 linear: no colons/semicolons in the table; note, blank line, column order
//   ("State: Capital; Nickname; Bird", 1-3), blank line, each row "First: second; third" (1-3),
//   a blank entry is three dot 5s followed by the punctuation.
//
// The exact-braille proofs are BANA's own worked samples 11-25 (linear), 11-26 (stairstep) and
// 11-27 (subdivision headings), compared line for line. gold-run.mjs always models a table with
// format 'auto', so the proofs here run the SAME model gold-run builds, with only the format
// (and, for 11-27, the transcriber-supplied headings) set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, tableLayout, getBlockSignature, formatDocument } from '../format/document.mjs';
import { loadSamples, runOne } from '../scripts/gold-run.mjs';   // also initialises liblouis
import * as louis from '../engine/louis.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (width = 40, mode = 'bana') => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const lead = (l) => l.length - l.trimStart().length;

// ---------- gold helpers (real liblouis, as gold-run.mjs) ----------
const goldOpts = {
  mode: 'bana', standard: 'bana', width: 40, depth: 25, suppressHeader: true,
  translate: (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null),
  translateG1: (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null),
};
const sampleById = (id) => loadSamples().find(({ sample }) => sample.id === id).sample;
const formatGold = (doc) => {
  const brf = formatDocument(doc, goldOpts) || '';
  const lines = brf.split('\x0c').flatMap((p) => p.replace(/\r\n$/, '').split('\r\n'));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
};
const goldExpected = (sample) => {
  let l = sample.braille.lines.slice();
  if (l[0] === 'text') l = l.slice(1);
  if (l[0] === '') l = l.slice(1);
  l = l.map((x) => x.toUpperCase());
  while (l.length && l[l.length - 1] === '') l.pop();
  return l;
};
const findTable = (blocks) => {
  for (const b of blocks) {
    if (b.type === 'table') return b;
    if (b.blocks) { const t = findTable(b.blocks); if (t) return t; }
  }
  return null;
};

test('BANA Sample 11-25 (Linear Table Format): exact character-for-character match with format "linear"', () => {
  const sample = sampleById('sample-11-25');
  const { doc } = runOne(sample).model;
  findTable(doc.blocks).format = 'linear';
  assert.deepEqual(formatGold(doc), goldExpected(sample));
});

test('BANA Sample 11-26 (Stairstep Table Format): the note, the 1-1/3-3/5-5/7-7 entries match the standard exactly', () => {
  const sample = sampleById('sample-11-26');
  // The gold sample's own title line carries a page number and its second page opens with
  // one too (running-head artefacts of the book, not table content); compare the body only:
  // from the transcriber's note (gold line 3) to the last entry line (before the bottom box line).
  const table = { type: 'table', format: 'stairstep', headers: sample.print.headers[0], rows: sample.print.rows };
  const gl = sample.braille.lines;
  const expected = gl.slice(2, gl.findIndex((l) => /^g+$/.test(l))).map((l) => l.replace(/\s+a#bcc$/, '').toUpperCase());
  assert.deepEqual(formatGold({ title: null, blocks: [table] }), expected);
});

test('BANA Sample 11-27 (Subdivision Headings, 11.18.1j): exact match with transcriber-devised headings', () => {
  const sample = sampleById('sample-11-27');
  // Print has no headings (11.18.1k: "Headings may be devised when there are none in print");
  // the book's own note names them "State location" (the subdivision), "Amusement park", "Location".
  const table = {
    type: 'table', format: 'stairstep', headers: ['Amusement park', 'Location'], rows: sample.print.rows,
    subdivisionRows: [0, 5], subdivisionHeading: 'State location',
  };
  assert.deepEqual(formatGold({ title: null, blocks: [table] }), goldExpected(sample));
});

// ---------- rule-by-rule, with the uppercase test translator ----------
const stair = {
  type: 'table', format: 'stairstep',
  headers: ['Question', 'Answer', 'Reason'],
  rows: [['Why', 'Yes', 'Because'], ['Where', 'Here', 'There']],
};

test('11.18.1c/d/e: note, blank line, headings 1-1 / 3-3 / 5-5, closing indicator after the last, blank line, entries 1-1 / 3-3 / 5-5', () => {
  assert.equal(tableLayout(stair, opts()), 'stairstep');
  assert.deepEqual(clean(formatBlock(stair, opts())), [
    '',
    '      @.<TABLE CHANGED AS FOLLOWS:',
    '',
    'QUESTION',
    '  ANSWER',
    '    REASON@.>',
    '',
    'WHY',
    '  YES',
    '    BECAUSE',
    'WHERE',
    '  HERE',
    '    THERE',
    '',
  ]);
});

test('11.18.1e: the fourth column is blocked at 7-7, and a wrapped entry keeps its margin (runover = first line)', () => {
  const t = {
    type: 'table', format: 'stairstep', headers: ['A', 'B', 'C', 'D'],
    rows: [['one', 'two', 'three', 'four five six seven eight nine ten eleven twelve thirteen']],
  };
  const lines = clean(formatBlock(t, opts(30)));
  const i = lines.indexOf('      FOUR FIVE SIX SEVEN');
  assert.ok(i > 0, JSON.stringify(lines));
  assert.equal(lead(lines[i + 1]), 6, JSON.stringify(lines));
  assert.equal(lead(lines[i + 2]), 6, JSON.stringify(lines));
});

test('11.18.1f: a second paragraph of an entry starts two cells right of the margin (3-3 becomes 5-3)', () => {
  const t = {
    type: 'table', format: 'stairstep', headers: ['A', 'B'],
    rows: [['x', 'first paragraph\nsecond paragraph is long enough to wrap around the line end']],
  };
  const lines = clean(formatBlock(t, opts(30)));
  const i = lines.indexOf('  FIRST PARAGRAPH');
  assert.ok(i > 0, JSON.stringify(lines));
  assert.equal(lead(lines[i + 1]), 4, JSON.stringify(lines));   // 5-…
  assert.equal(lead(lines[i + 2]), 2, JSON.stringify(lines));   // …-3
});

test('11.18.1l: a blank entry is three unspaced guide dots at its margin, explained in the note', () => {
  const t = { type: 'table', format: 'stairstep', headers: ['A', 'B'], rows: [['x', ''], ['', 'y']] };
  const lines = clean(formatBlock(t, opts()));
  assert.deepEqual(lines, [
    '',
    '      @.<A SERIES OF THREE GUIDE DOTS',
    '    INDICATES A BLANK ENTRY.',
    '      TABLE CHANGED AS FOLLOWS:',
    '',
    'A',
    '  B@.>',
    '',
    'X',
    '  """',
    '"""',
    '  Y',
    '',
  ]);
});

test('11.18.1j: a subdivision row is a cell-5 heading named first in the note; groups are set off by a blank line', () => {
  const t = {
    type: 'table', format: 'stairstep', headers: ['Park', 'Place'],
    rows: [['Florida', ''], ['Epcot', 'Orlando'], ['California', ''], ['Disneyland', 'Anaheim']],
    subdivisionRows: [0, 2], subdivisionHeading: 'State',
  };
  assert.deepEqual(clean(formatBlock(t, opts())), [
    '',
    '      @.<TABLE CHANGED AS FOLLOWS:',
    '',
    '    STATE',
    'PARK',
    '  PLACE@.>',
    '',
    '    FLORIDA',
    'EPCOT',
    '  ORLANDO',
    '',
    '    CALIFORNIA',
    'DISNEYLAND',
    '  ANAHEIM',
    '',
  ]);
});

test('11.18.1g: each row (with its subdivision heading) is one keep-together group', () => {
  const t = {
    type: 'table', format: 'stairstep', headers: ['Park', 'Place'],
    rows: [['Florida', ''], ['Epcot', 'Orlando'], ['Seaworld', 'Orlando']],
    subdivisionRows: [0], subdivisionHeading: 'State',
  };
  const lines = formatBlock(t, opts());
  // lines: 0 '', 1 TN, 2 '', 3 STATE, 4 PARK, 5 PLACE, 6 '', 7 FLORIDA, 8 EPCOT, 9 ORLANDO, 10 SEAWORLD, 11 ORLANDO, 12 ''
  assert.deepEqual(lines.keepGroups, [[7, 9], [10, 11]], JSON.stringify(clean(lines)));
});

// ---------- linear ----------
const lin = {
  type: 'table', format: 'linear',
  headers: ['State', 'Capital', 'Bird'],
  rows: [['Alabama', 'Montgomery', 'Yellowhammer'], ['Arkansas', '', 'Mockingbird']],
};

test('11.17.1b-k: note, blank line, order "First: second; third" (1-3), blank line, one paragraph per row (1-3), blank entry = three dot 5s + punctuation', () => {
  assert.equal(tableLayout(lin, opts()), 'linear');
  assert.deepEqual(clean(formatBlock(lin, opts())), [
    '',
    '      @.<A SERIES OF THREE DOT 5S',
    '    INDICATES A BLANK SPACE IN PRINT.',
    '      COLUMNS FOLLOW ONE ANOTHER IN THIS',
    '    ORDER:',
    '',
    'STATE: CAPITAL; BIRD@.>',
    '',
    'ALABAMA: MONTGOMERY; YELLOWHAMMER',
    'ARKANSAS: """2 MOCKINGBIRD',
    '',
  ]);
});

test('11.17.1h/i: a row too long for one line runs over in 1-3 and every row starts in cell 1; each row is a keep-together group (11.17.1g)', () => {
  const t = {
    type: 'table', format: 'linear', headers: ['A', 'B', 'C'],
    rows: [['first row entry', 'second entry is here', 'third entry ends'], ['next', 'row', 'short']],
  };
  const lines = formatBlock(t, opts(30));
  const c = clean(lines);
  const i = c.indexOf('FIRST ROW ENTRY: SECOND ENTRY');
  assert.ok(i > 0, JSON.stringify(c));
  assert.equal(lead(c[i + 1]), 2, JSON.stringify(c));
  assert.equal(lead(c[c.indexOf('NEXT: ROW; SHORT')]), 0, JSON.stringify(c));
  assert.equal(lines.keepGroups.length, 2);
  assert.equal(lines.keepGroups[0][0], i);
});

test('11.17.1a: a table title is followed by a blank line before the note', () => {
  const c = clean(formatBlock({ ...lin, title: 'States' }, opts()));
  assert.deepEqual(c.slice(0, 4), ['', '                 STATES', '', '      @.<A SERIES OF THREE DOT 5S']);
});

test('a source table note is the first paragraph of the same transcriber\'s note (both formats)', () => {
  const s = clean(formatBlock({ ...stair, tabletn: 'Source note.' }, opts()));
  assert.deepEqual(s.slice(1, 4), ['      @.<SOURCE NOTE.', '      TABLE CHANGED AS FOLLOWS:', '']);
  const l = clean(formatBlock({ ...lin, tabletn: 'Source note.' }, opts()));
  assert.equal(l[1], '      @.<SOURCE NOTE.');
});

// ---------- qualifying tests: anything that does not qualify falls back, never partly renders ----------
test('11.18.1: more than four columns falls back to Listed (UKAAF: paragraph form)', () => {
  const t = { type: 'table', format: 'stairstep', headers: ['A', 'B', 'C', 'D', 'E'], rows: [['1a', '2a', '3a', '4a', '5a']] };
  assert.equal(tableLayout(t, opts()), 'listed');
  assert.equal(tableLayout({ ...t, headers: t.headers.slice(0, 4), rows: [t.rows[0].slice(0, 4)] }, opts()), 'stairstep');
  assert.equal(tableLayout({ ...stair }, opts(40, 'ukaaf')), 'paragraph');
  assert.equal(tableLayout({ ...lin }, opts(40, 'ukaaf')), 'paragraph');
});

test('11.17.1 / 11.18.1a: two or more columns of numbers disqualify both formats; one is allowed', () => {
  const two = { headers: ['Name', 'Year', 'Count'], rows: [['a', '1990', '5'], ['b', '1991', '7']] };
  assert.equal(tableLayout({ type: 'table', format: 'stairstep', ...two }, opts()), 'listed');
  assert.equal(tableLayout({ type: 'table', format: 'linear', ...two }, opts()), 'listed');
  const one = { headers: ['Name', 'Year', 'Note'], rows: [['a', '1990', 'x'], ['b', '1991', 'y']] };
  assert.equal(tableLayout({ type: 'table', format: 'stairstep', ...one }, opts()), 'stairstep');
  assert.equal(tableLayout({ type: 'table', format: 'linear', ...one }, opts()), 'linear');
});

test('11.17.1: a colon or semicolon anywhere in the table rules linear out', () => {
  assert.equal(tableLayout({ ...lin, rows: [['Alabama', 'a: b', 'x'], ['b', 'c', 'd']] }, opts()), 'listed');
  assert.equal(tableLayout({ ...lin, rows: [['Alabama', 'a; b', 'x'], ['b', 'c', 'd']] }, opts()), 'listed');
  assert.equal(tableLayout({ ...lin, headers: ['State', 'Cap:', 'Bird'] }, opts()), 'listed');
  assert.equal(tableLayout({ ...stair, rows: [['a: b', 'c', 'd']] }, opts()), 'stairstep');   // stairstep has no such rule
});

test('both notes name every column heading, so a blank heading, one column (linear), a two-tier heading, or a subdivision with no heading text fall back', () => {
  assert.equal(tableLayout({ ...stair, headers: ['Question', '', 'Reason'] }, opts()), 'listed');
  assert.equal(tableLayout({ ...lin, headers: ['State', '', 'Bird'] }, opts()), 'listed');
  assert.equal(tableLayout({ type: 'table', format: 'linear', headers: ['A'], rows: [['x']] }, opts()), 'listed');
  assert.equal(tableLayout({ ...stair, headerGroups: [{ text: 'Both', from: 1, to: 2 }] }, opts()), 'listed');
  assert.equal(tableLayout({ ...stair, subdivisionRows: [0] }, opts()), 'listed');
});

test('selectable only: "auto" never picks stairstep or linear, and the existing formats are unchanged', () => {
  const wide = { type: 'table', format: 'auto', headers: ['Alpha column', 'Beta column', 'Gamma column'], rows: [['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc']] };
  for (const w of [30, 40]) assert.ok(!['stairstep', 'linear'].includes(tableLayout(wide, opts(w))));
  assert.equal(tableLayout({ ...wide, format: undefined }, opts(30)), tableLayout(wide, opts(30)));
  // a subdivision field on a non-stairstep table changes nothing
  assert.deepEqual(formatBlock({ ...wide, subdivisionRows: [0], subdivisionHeading: 'x' }, opts(30)), formatBlock(wide, opts(30)));
});

// ---------- formatBlock / traceBlock parity ----------
const parityCases = {
  stairstep: stair,
  'stairstep, title + note + blanks': { ...stair, title: 'The Title', tabletn: 'A note.', rows: [['Why', '', 'Because'], ['', 'Here', 'There']] },
  'stairstep, four wrapping columns': { type: 'table', format: 'stairstep', headers: ['A', 'B', 'C', 'D'], rows: [['one', 'two words here', 'three words go here now', 'four five six seven eight nine ten eleven twelve']] },
  'stairstep, subdivision': { type: 'table', format: 'stairstep', headers: ['Park', 'Place'], rows: [['Florida', ''], ['Epcot', 'Orlando'], ['California', ''], ['Disney', 'Anaheim']], subdivisionRows: [0, 2], subdivisionHeading: 'State' },
  'stairstep, multi-paragraph entry': { type: 'table', format: 'stairstep', headers: ['A', 'B'], rows: [['x', 'first paragraph\nsecond paragraph is long enough to wrap around the line end']] },
  'stairstep, rich cells': { type: 'table', format: 'stairstep', headers: ['A', '*B*'], rows: [['x *bold* y', 'plain']] },
  linear: lin,
  'linear, title + note + wrap': { type: 'table', format: 'linear', title: 'T', tabletn: 'A note.', headers: ['A', 'B', 'C'], rows: [['first row entry', 'second entry is here', 'third entry ends'], ['', 'b', '']] },
  'linear, rich cells': { type: 'table', format: 'linear', headers: ['A', 'B'], rows: [['x *bold* y', '_it_']] },
  'stairstep falling back': { ...stair, headers: ['A', 'B', 'C', 'D', 'E'], rows: [['1', '2', '3', '4', '5']] },
  'linear falling back': { ...lin, rows: [['a;b', 'c', 'd']] },
};
for (const [name, block] of Object.entries(parityCases)) {
  test(`formatBlock and traceBlock agree: ${name}`, () => {
    for (const w of [30, 40]) {
      const formatted = formatBlock(block, opts(w));
      const traced = traceBlock(block, opts(w), false, 0);
      assert.deepEqual(traced.map((t) => t.s), formatted, `width ${w}`);
      assert.deepEqual(traced.keepGroups ?? null, formatted.keepGroups ?? null, `keepGroups, width ${w}`);
      for (const t of traced) assert.equal(t.src.length, t.s.length, `src length: ${JSON.stringify(t.s)}`);
    }
  });
}

test('the trace links entries back to their cells (stairstep and linear)', () => {
  const s = traceBlock(stair, opts(), false, 0);
  const why = s.find((t) => t.s === 'WHY');
  assert.deepEqual(why.src.map((x) => x && x.u), [3, 3, 3]);           // 3 headers, then row 0 col 0
  const key = s.find((t) => t.s === '  ANSWER');
  assert.ok(key.src.slice(2).every((x) => x && x.u === 1));            // header unit = column index
  const l = traceBlock(lin, opts(), false, 0);
  const alabama = l.find((t) => t.s.startsWith('ALABAMA:'));
  assert.equal(alabama.src[0].u, 3);
  assert.equal(alabama.src[7], null);                                  // the ':' is decoration
});

test('getBlockSignature: the format and the subdivision fields are part of the cache key', () => {
  const o = opts();
  const base = getBlockSignature(stair, o, false);
  assert.notEqual(base, getBlockSignature({ ...stair, format: 'linear' }, o, false));
  const sub = { ...stair, subdivisionRows: [0], subdivisionHeading: 'State' };
  assert.notEqual(base, getBlockSignature(sub, o, false));
  assert.notEqual(getBlockSignature(sub, o, false), getBlockSignature({ ...sub, subdivisionRows: [1] }, o, false));
  assert.notEqual(getBlockSignature(sub, o, false), getBlockSignature({ ...sub, subdivisionHeading: 'Other' }, o, false));
  // a block with neither field keeps its old key shape
  assert.equal(getBlockSignature(stair, o, false), getBlockSignature({ ...stair }, o, false));
});
