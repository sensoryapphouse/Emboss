// Gate for the round-trip proofread (web/proofread.mjs) against the REAL liblouis
// engine. The priority is NO FALSE POSITIVES: normal prose must round-trip clean,
// or the "⚠ review" flag becomes noise the user learns to ignore.
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { proofread, roundTrip, blockEntries } from '../web/proofread.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const tr = (s) => louis.translate(s, louis.TABLES.uebG2);
const bt = (s) => louis.backTranslate(s, louis.TABLES.uebG2);

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } };

// 1) A varied clean corpus must round-trip with zero issues.
const clean = [
  'The quick brown fox jumps over the lazy dog.',
  'Chapter One: A Beginning',
  'She said, "Knowledge and wisdom are not the same thing."',
  'The children walked about the mother and her little ones.',
  'It was the best of times; it was the worst of times.',
  'First item', 'Second item', 'Third item',
  'Mathematics, science, and language arts.',
  'about above according across after afternoon again',      // UEB wordsigns / contractions
  'people rather said some their these upon whose word',
  'A number like 1,234 and a date 2026 appear here.',
];
for (const t of clean) {
  const r = roundTrip(t, tr, bt);
  ok(r.ok, `clean text should round-trip: "${t}" -> "${r.back}"`);
}

// 2) proofread() over a whole model: clean blocks → clean report; maths skipped.
const model = { blocks: [
  { type: 'heading', level: 1, text: 'Introduction' },
  { type: 'para', text: 'Braille is a tactile writing system.' },
  { type: 'list', items: [{ text: 'apples' }, { text: 'oranges and pears' }] },
  { type: 'para', segments: [{ type: 'text', text: 'the area is ' }, { type: 'math', latex: 'x^2' }] },
  { type: 'indicator', kind: 'asterisks' },
] };
const rep = proofread(model, tr, bt);
ok(rep.clean, `whole-model proofread should be clean; issues=${JSON.stringify(rep.issues)}`);
ok(rep.checked === 4, `should check 4 texts (heading + para + 2 list items; maths skipped), got ${rep.checked}`);

// 3) An empty / indicator-only model checks nothing and is clean.
const empty = proofread({ blocks: [{ type: 'indicator', kind: 'asterisks' }] }, tr, bt);
ok(empty.clean && empty.checked === 0, `indicator-only model: clean & 0 checked, got ${JSON.stringify(empty)}`);

// 4) A list item's further content (item.blocks — a further paragraph, the editor's "Continue
// Item"; and a table the item holds) is checked in the right order, right after the item's own
// line (document.mjs formatItemBlocks / editor.mjs mergeListItemBlocks build this same shape).
const ibEntries = blockEntries({ type: 'list', items: [
  { text: 'First line of the item.', blocks: [
    { type: 'para', text: 'A further paragraph of the same item.' },
    { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
  ] },
  { text: 'Second item, no further content.' },
] });
ok(ibEntries.map((e) => e.text).join(' | ') === 'First line of the item. | A further paragraph of the same item. | A | B | 1 | 2 | Second item, no further content.',
  `blockEntries reads item.blocks (further paragraph + table cells) in order: ${JSON.stringify(ibEntries.map((e) => e.text))}`);
ok(ibEntries.map((e) => e.itemIdx).join(',') === '0,1,2,3,4,5,6', `blockEntries itemIdx is sequential list lines: ${ibEntries.map((e) => e.itemIdx).join(',')}`);
const ibModel = { blocks: [{ type: 'list', items: [
  { text: 'Please see the table below.', blocks: [
    { type: 'para', text: 'It lists apples and pears.' },
    { type: 'table', headers: ['Fruit', 'Count'], rows: [['apples', 'three'], ['pears', 'four']] },
  ] },
] }] };
const ibRep = proofread(ibModel, tr, bt);
ok(ibRep.clean, `item.blocks content should round-trip clean; issues=${JSON.stringify(ibRep.issues)}`);
// item line + further paragraph + 2 header cells + 4 row cells (2 rows x 2 cols) = 8
ok(ibRep.checked === 8, `should check 8 texts, got ${ibRep.checked}`);

console.log(`\nround-trip proofread gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
