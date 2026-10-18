// K7 (coloured/screened boxes, BANA 7.5.1-7.5.2) and K8 (a table's key of devised symbols,
// BANA 11.8.1-11.8.2), transcriber KD's round-1 feedback (Emboss/docs/transcription-policy.md
// §10 Boxes, §11 Tables). Every expected braille string below is checked against the standard's
// own rule text and worked examples (references/_text/braille-formats-2016.txt: §7.5, Sample 7-2
// for K7; §11.8, Sample 11-16 for K8) — never against Emboss's own pre-change output. Each case
// fails without the field-registry/document.mjs changes (boxColor / o._boxColorsUniform for K7,
// block.key / block.keyIntro / tableKeyNoteLines for K8): confirmed by temporarily reverting
// those changes and re-running this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimas } from '../input/nimas-export.mjs';
import { formatBlock, traceBlock, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

let translate, translateG1, translatePos;
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
translate = (t, tf) => louis.translate(t, T, tf || null);
translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };

const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (doc, o = OPTS) => {
  const blocks = doc.blocks.slice(1);   // skip the title heading document.mjs's pre-pass adds context for
  for (const b of blocks) if (b && typeof b === 'object') assert.deepEqual(clean(traceBlock(b, o).map((t) => t.s)), clean(formatBlock(b, o)), `traceBlock must match formatBlock for ${b.type}`);
};

// ---------------------------------------------------------------------------------------------
// K7 — coloured boxes (BANA 7.5.1-7.5.2)
// ---------------------------------------------------------------------------------------------
test('K7: two boxes of different colours each name their own colour at the start of the opening box line (7.5.1-7.5.2, Sample 7-2)', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'box', title: 'Yellow box', blocks: [{ type: 'para', text: 'Words here.' }], boxColor: 'yellow' },
      { type: 'box', title: 'Orange box', blocks: [{ type: 'para', text: 'More words.' }], boxColor: 'orange' },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const yellowLine = page.find((l) => l.startsWith('@.<'));
  const orangeLine = page.slice(page.indexOf(yellowLine) + 1).find((l) => l.startsWith('@.<'));
  // "yellow" and "orange" translated (real liblouis UEB grade 2), enclosed in TN indicators, a
  // blank cell, then the interior top box line (dot 7) filling the rest of the 40-cell width.
  const yellowBrl = translate('yellow').trim(), orangeBrl = translate('orange').trim();
  assert.equal(yellowLine, `@.<${yellowBrl}@.> ` + '7'.repeat(40 - (`@.<${yellowBrl}@.> `).length));
  assert.equal(orangeLine, `@.<${orangeBrl}@.> ` + '7'.repeat(40 - (`@.<${orangeBrl}@.> `).length));
  // The bottom border of each box is NOT prefixed (7.5.2 names the OPENING box line only) and
  // stays the full, unprefixed width.
  const bottoms = page.filter((l) => /^G+$/.test(l));
  assert.equal(bottoms.length, 2);
  for (const l of bottoms) assert.equal(l, 'G'.repeat(40));
  parity(doc);
});

test('K7: boxes that are all the same colour say nothing (7.5.1 "unless all the boxes are the same color")', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'box', title: 'Box A', blocks: [{ type: 'para', text: 'Words here.' }], boxColor: 'yellow' },
      { type: 'box', title: 'Box B', blocks: [{ type: 'para', text: 'More words.' }], boxColor: 'YELLOW' },   // case-insensitive match
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  assert.ok(!page.some((l) => l.startsWith('@.<')), 'no colour TN when every box shares one colour');
  const tops = page.filter((l) => /^7+$/.test(l));
  assert.equal(tops.length, 2);
  for (const l of tops) assert.equal(l, '7'.repeat(40));
  parity(doc);
});

test('K7: a single coloured box (nothing to differ from) says nothing either', () => {
  const doc = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'box', title: 'Only box', blocks: [{ type: 'para', text: 'Words.' }], boxColor: 'blue' }] };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  assert.ok(!page.some((l) => l.startsWith('@.<')));
  parity(doc);
});

test('K7: a box with no boxColor set says nothing, even when other boxes differ', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'box', title: 'Coloured', blocks: [{ type: 'para', text: 'Words.' }], boxColor: 'green' },
      { type: 'box', title: 'Unmarked', blocks: [{ type: 'para', text: 'More.' }] },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const colourLines = page.filter((l) => l.startsWith('@.<'));
  assert.equal(colourLines.length, 1);
  parity(doc);
});

test('K7: field registry: boxColor round-trips through DTBook export/re-import', () => {
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside.' }], boxColor: 'blue' }] };
  const xml = exportToNimas(model);
  assert.match(xml, /class="[^"]*bana-box-color[^"]*"/);
  const back = parseDtbook(xml);
  const box = back.blocks.find((b) => b.type === 'box' || b.type === 'sidebar');
  assert.equal(box.boxColor, 'blue');
});

// ---------------------------------------------------------------------------------------------
// K8 — a table's key of devised symbols (BANA 11.8.1-11.8.2, Sample 11-16 / Sample 11-8)
// ---------------------------------------------------------------------------------------------
const sat = {
  title: 'T',
  blocks: [
    { type: 'heading', level: 1, text: 'T' },
    {
      type: 'table', title: 'SAT Scores by Race & Ethnicity', headers: ['rec', 'vms', 'mms'],
      rows: [['nan', '123', '456'], ['aam', '789', '234'], ['wht', '567', '890']],
      key: [
        { symbol: 'mms', meaning: 'SAT Math Min Scores' },
        { symbol: 'rec', meaning: 'Racial/Ethnic Category' },
        { symbol: 'vms', meaning: 'SAT Verbal Min Scores' },
        { symbol: 'aam', meaning: 'African American', group: 'row' },
        { symbol: 'nan', meaning: 'Native American or Alaskan Native', group: 'row' },
        { symbol: 'wht', meaning: 'White', group: 'row' },
      ],
    },
  ],
};

test('K8: a table with both column and row key items gets cell-5 "Column headings"/"Row headings" groups, each alphabetised by symbol (11.8.2m-n, Sample 11-16)', () => {
  const page = formatDocument(sat, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const introIdx = page.findIndex((l) => l.trim().startsWith('@.<'));
  assert.ok(introIdx >= 0, 'the key list opens a transcriber\'s note');
  const colIdx = page.findIndex((l) => l.trim() === translate('Column headings').trim());
  const rowIdx = page.findIndex((l) => l.trim() === translate('Row headings').trim());
  assert.ok(colIdx > introIdx && rowIdx > colIdx, 'Column headings, then Row headings, in that order');
  // Alphabetised by symbol, not by meaning: mms, rec, vms / aam, nan, wht.
  const colItems = page.slice(colIdx + 1, rowIdx).filter((l) => l.trim());
  const rowItems = page.slice(rowIdx + 1).filter((l) => l.trim()).slice(0, 3);
  assert.deepEqual(colItems.map((l) => l.trim().split(/\s+/)[0]), ['MMS', 'REC', 'VMS'].map((s) => translate(s.toLowerCase()).trim()));
  assert.deepEqual(rowItems.map((l) => l.trim().split(/\s+/)[0]), ['AAM', 'NAN', 'WHT'].map((s) => translate(s.toLowerCase()).trim()));
  // The closing TN indicator is on the very last key item, nowhere earlier.
  const closeIdx = page.findIndex((l) => l.includes('@.>'));
  assert.equal(page[closeIdx].trim(), rowItems[rowItems.length - 1].trim());
  assert.ok(!page.slice(introIdx, closeIdx).some((l, i) => i < closeIdx - introIdx && l.includes('@.>')), 'only one closing indicator');
  parity(sat);
});

test('K8: a blank line separates the key list from the table title and from the column headings (11.8.2d/h)', () => {
  const page = formatDocument(sat, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const introIdx = page.findIndex((l) => l.trim().startsWith('@.<'));
  assert.equal(page[introIdx - 1], '', 'blank line before the key list, after the title');
  const closeIdx = page.findIndex((l) => l.includes('@.>'));
  assert.equal(page[closeIdx + 1], '', 'blank line after the key list');
});

test('K8: a column-only key gets no "Column headings" cell-5 label — items follow the intro directly (Sample 11-8)', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'table', headers: ['nf', 'nh'], rows: [['1', '2']], key: [{ symbol: 'nf', meaning: 'Number of FI employees' }, { symbol: 'nh', meaning: 'Number of HE employees' }] },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  assert.ok(!page.some((l) => l.trim() === translate('Column headings').trim()));
  assert.ok(!page.some((l) => l.trim() === translate('Row headings').trim()));
  const introIdx = page.findIndex((l) => l.trim().startsWith('@.<'));
  assert.equal(page[introIdx].trim(), `@.<${translate('Key to column headings:').trim()}`);
  parity(doc);
});

test('K8: a row-only key says "Key to row headings:"', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'table', headers: ['A'], rows: [['x']], key: [{ symbol: 'x', meaning: 'An example row', group: 'row' }] },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const introIdx = page.findIndex((l) => l.trim().startsWith('@.<'));
  assert.equal(page[introIdx].trim(), `@.<${translate('Key to row headings:').trim()}`);
  parity(doc);
});

test('K8: an own wording for the key intro (keyIntro) overrides the standard sentence (11.8.2a)', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'table', headers: ['A'], rows: [['x']], key: [{ symbol: 'x', meaning: 'An example' }], keyIntro: 'Abbreviations used:' },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const introIdx = page.findIndex((l) => l.trim().startsWith('@.<'));
  assert.equal(page[introIdx].trim(), `@.<${translate('Abbreviations used:').trim()}`);
  parity(doc);
});

test('K8: an ordinary table note and the key list combine into ONE transcriber\'s note, the key list last (11.8.2i)', () => {
  const doc = {
    title: 'T',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      { type: 'table', headers: ['A'], rows: [['x']], tabletn: 'This table has been condensed.', key: [{ symbol: 'x', meaning: 'An example' }] },
    ],
  };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  const opens = page.filter((l) => l.trim().startsWith('@.<'));
  const closes = page.filter((l) => l.includes('@.>'));
  assert.equal(opens.length, 1, 'only one opening indicator: the ordinary note and the key share one TN');
  assert.equal(closes.length, 1, 'only one closing indicator');
  assert.equal(opens[0].trim(), `@.<${translate('This table has been condensed.').trim()}`);
  parity(doc);
});

test('K8: a table with no key renders exactly as before (regression — no stray key-list lines)', () => {
  const doc = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }] };
  const page = formatDocument(doc, { ...OPTS }).split('\f')[0].split(/\r?\n/);
  assert.ok(!page.some((l) => l.trim().startsWith('@.<') || l.includes('@.>')));
  parity(doc);
});

test('K8: field registry: key and keyIntro round-trip through DTBook export/re-import', () => {
  const model = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], key: [{ symbol: 'nf', meaning: 'Number of items' }, { symbol: 'aam', meaning: 'African American', group: 'row' }], keyIntro: 'My own wording:' }] };
  const xml = exportToNimas(model);
  assert.match(xml, /class="[^"]*bana-key[^"]*"/);
  const back = parseDtbook(xml);
  const table = back.blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.key, model.blocks[1].key);
  assert.equal(table.keyIntro, 'My own wording:');
});
