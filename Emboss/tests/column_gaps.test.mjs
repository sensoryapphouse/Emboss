// K33 (26 Sep 2026): column gaps are two blank cells, pinned against the BANA gold as corrected from the book's own
// cell positions (Emboss/scripts/gold-spacing-audit/: the gold had been transcribed from a text dump that turned two
// blank cells into one, and Emboss's formatter had been tuned to it).
//
//  BANA 11.2.5b: "Each column is separated from a following column by two blank cells." — on every line, including
//    after an entry that exactly fills its column and after a run of guide dots (11.6.1f: guide dots "fill out the
//    width of a column"; Example 4-10 `well """"  bett]`). Transcriber KD confirms 11.2.5b. The one-cell gap of 11.7.1
//    (numeric passage indicator) is not used.
//  BANA 11.4.2b: the separation line "extends across the full width of the column"; its runs are two cells apart too.
//  BANA 14.5.1d / 14.6.1e / 14.10.5a: two blank spaces after a speaker's name that print does not set off from the
//    dialogue, and after a cartoon character's name (Samples 14-5, 14-11, 14-12).
//  UKAAF B004 §12: "guide dots are used to bridge the gap between columns, leaving a space at each end. Two cells is
//    the minimum length" — B004's own Example 1 (page image) runs the dots to one cell before the next column.
//
// Every expectation is a line of the book (the corrected gold, or B004's page image), never Emboss's own output.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatBlock, traceBlock } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');
const GOLD = path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016');
const gold = (section, file) => JSON.parse(fs.readFileSync(path.join(GOLD, section, file), 'utf8'));
const up = (l) => String(l).toUpperCase();
const rstrip = (l) => String(l).replace(/\s+$/, '');

let o, ou;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
  o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): tableEndMarker defaults true in UKAAF, adding a
  // dot-2s line after every table — turned off here since this file is pinned to column-gap
  // spacing only, not end markers.
  ou = { ...o, mode: 'ukaaf', standard: 'ukaaf', tableEndMarker: false };
});

// gold-run.mjs builds each sample's model from its print only; its section is fixed when the module loads, so each
// section gets its own module instance (a distinct URL).
async function goldRun(section, id) {
  process.env.GOLD_RUN_SECTION = section;
  const m = await import(pathToFileURL(path.join(EMBOSS, 'scripts', 'gold-run.mjs')).href + '?k33=' + section);
  const hit = m.loadSamples().find((x) => x.sample.id === id);
  assert.ok(hit, `gold sample ${id} in ${section}`);
  return m.runOne(hit.sample);
}
const parity = (block, opts) => {
  const f = formatBlock(block, opts, false).map(rstrip);
  const t = traceBlock(block, opts, false).map((x) => rstrip(x.s));
  assert.deepEqual(t, f, 'formatBlock and traceBlock agree (A39)');
  return f;
};

test('Example 11-2: the table matches the book line for line (two cells after an entry that fills its column)', async () => {
  const r = await goldRun('section-11', 'example-11-2');
  assert.deepEqual(r.actual.lines, r.expected.lines, r.diagnosis);
  assert.equal(r.status, 'match');
  // "mosquito" exactly fills its column, and is still followed by two blank cells (the old one-cell narrowing gave
  // `MOSQUITO #CJ "DS`); "gorilla" pads one cell first, so "39 days" and "59 years" start in the same cell.
  assert.ok(r.expected.lines.includes('MOSQUITO  #CJ "DS') && r.expected.lines.includes('GORILLA   #EJ YE>S'), 'the corrected gold');
  assert.ok(r.actual.lines.includes('MOSQUITO  #CJ "DS'), JSON.stringify(r.actual.lines));
});

test('Example 11-2: the separation line runs are two cells apart (11.4.2b)', async () => {
  const r = await goldRun('section-11', 'example-11-2');
  const sep = r.expected.lines.find((l) => l.startsWith('"3'));
  assert.match(sep, /^"3+  "3+$/, 'the corrected gold itself');
  assert.ok(r.actual.lines.includes(sep), JSON.stringify(r.actual.lines));
});

test('Example 4-10: two cells after a run of guide dots, and between separation runs (11.6.1f, 11.2.5b)', async () => {
  const r = await goldRun('section-4', 'example-4-10');
  assert.deepEqual(r.actual.lines, r.expected.lines, r.diagnosis);
  for (const line of ['WELL """"  BETT] """""  BE/', 'BADLY """  WORSE """""  WOR/', '"33333333  "3333333333  "3333333333']) {
    assert.ok(r.expected.lines.includes(line), `the corrected gold has ${line}`);
    assert.ok(r.actual.lines.includes(line), `${line}: ${JSON.stringify(r.actual.lines)}`);
  }
});

test('Sample 11-22 (vertical division) and Sample 11-7: the book\'s two-cell gaps', async () => {
  for (const id of ['sample-11-22', 'sample-11-07']) {
    const r = await goldRun('section-11', id);
    assert.deepEqual(r.actual.lines, r.expected.lines, `${id}: ${r.diagnosis}`);
  }
});

test('a table of every kind keeps the same column positions on every line (formatBlock == traceBlock)', () => {
  const block = { type: 'table', headers: ['Animal', 'X', 'Y'], rows: [['mosquito', 'a', 'b'], ['ox', 'bb', ''], ['gorilla', '', 'c']] };
  const lines = parity(block, o).filter(Boolean);
  // Column 1 is 8 cells ("MOSQUITO"), column 2 is 3 (";,X"): column 2 starts in cell 11 (8 + 2 blank cells) and
  // column 3 in cell 16 (10 + 3 + 2) on every line — headings, separation line, an exactly-filling entry, a
  // guide-dotted entry (11.6.1f) and a blank entry's guide dots across the column (11.6.4) alike.
  assert.deepEqual(lines, [',ANIMAL   ;,X  ;,Y', '"3333333  "33  "33', 'MOSQUITO  A    ;B', 'OX """""  BB   """', 'GORILLA   """  ;C']);
});

test('14.10.5a / 14.5.1d: two blank cells after a speaker\'s name with no print distinction (Sample 14-11)', () => {
  const g = gold('section-14', 'sample-14-11.json');
  const speech = g.print.blocks.find((b) => b.kind === 'speech' && /^Woman {2}My parents/.test(b.text));
  const lines = parity({ type: 'play', subtype: 'prose', text: speech.text }, o);
  const at = g.braille.lines.findIndex((l) => l.startsWith(',woman  ,my p>5ts'));
  assert.ok(at >= 0, 'the corrected gold line');
  assert.deepEqual(lines, g.braille.lines.slice(at, at + 3).map(up));
  assert.equal(lines[0], ',WOMAN  ,MY P>5TS GET 9TO T[N NEXT WEEK1');
  // Sample 14-5: print sets "Craig" off from his line by nothing at all (14.5.1d); the name is marked by two spaces.
  const g5 = gold('section-14', 'sample-14-5.json');
  assert.ok(g5.braille.lines.includes(',craig  ,yes1 ! ,delphis4'), 'the corrected gold line');
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', text: 'Craig  Yes, the Delphis.' }, o), [',CRAIG  ,YES1 ! ,DELPHIS4']);
});

test('the speaker gap keeps print\'s own distinction: one space after punctuation, emphasis or a name in capitals', () => {
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', text: 'Peter:  Run, run.' }, o), [',PET]3 ,RUN1 RUN4']);
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', text: 'CAROL  You do not.' }, o), [',,C>OL ,Y D N4']);
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', segments: [{ type: 'text', text: 'Craig', tf: 1 }, { type: 'text', text: '  Yes.' }] }, o), ['.1,CRAIG ,YES4']);
  // a §13 poem line is not dialogue: its wide gaps are only kept when the transcriber marks them (13.6.3, wideSpaces)
  assert.deepEqual(parity({ type: 'play', subtype: 'verse', text: 'Can  dy' }, o), [',C DY']);
  // UKAAF follows print (B004 App K); no rule-made gap
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', text: 'Woman  Hello.' }, ou), [',WOMAN ,HELLO4']);
  // 14.6.2a / 15.5.2b: print's large space, marked by the transcriber, stays three cells
  assert.deepEqual(parity({ type: 'play', subtype: 'prose', text: 'Antonio: O,', speakerGap: true }, o), [',ANTONIO3   ,O1']);
});

test('UKAAF B004 §12 Example 1: guide dots run to one cell before the next column, columns two cells apart', () => {
  const rows = Array.from({ length: 10 }, (_, i) => [String(i + 1), String((i + 1) ** 2), String((i + 1) ** 3)]);
  const lines = parity({ type: 'table', headers: ['No', 'Square', 'Cube'], rows }, ou).filter(Boolean);
  // B004's page image (PDF p.12), cell for cell. Task 2, 26 Sep 2026: Emboss used to add a "3
  // separation line B004's own example does not show (isBanaOpts gate, document.mjs) — the
  // header row is now followed directly by the first data row, exactly as B004 has it.
  assert.equal(lines[0], ',NO  ,SQU>E  ,CUBE');
  assert.deepEqual(lines.slice(1), ['#A   #A """" #A', '#B   #D """" #H', '#C   #I """" #BG', '#D   #AF """ #FD', '#E   #BE """ #ABE',
    '#F   #CF """ #BAF', '#G   #DI """ #CDC', '#H   #FD """ #EAB', '#I   #HA """ #GBI', '#AJ  #AJJ "" #AJJJ']);
});
