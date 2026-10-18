// Formatter fixes from the BANA Formats section 21 (indexes, glossaries, dictionaries, thesauruses) gold set, second pass (23 Sep 2026):
//  - 21.7.2 / 21.7.3 thesaurus (optional block.thesaurus): 21.2.1b margins for every level, entry word / label / definition spacing,
//    no "mixed styles" rule (Samples 21-9, 21-10);
//  - 21.2.3c a division letter after a title heading keeps the blank before it, none after it ("A a", Sample 21-10);
//  - 21.8.2 / 21.8.5 / 21.8.6a dictionary (optional block.dictionary): entry parts one blank cell apart (follow print), 21.2.1b margins,
//    superscript entry number always after the entry word (optional item.termSup; Example 21-35);
//  - 21.9.2e shared left margin for entries with a preceding article/pronoun/infinitive (optional block.sharedMargin, item.lead; Example 21-36).
// Every new field is optional; without it output is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos, suppressHeader: true };
const optsNoPos = { ...opts, translatePos: undefined };

const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block) => clean(formatBlock(block, opts));
const trc = (block) => clean(traceBlock(block, opts).map((t) => t.s));
const both = (block) => { const a = fmt(block); assert.deepEqual(trc(block), a, 'traceBlock differs from formatBlock'); return a; };
const doc = (blocks, o = opts) => { const a = clean((formatDocument({ title: null, blocks }, o) || '').split('\x0c')[0].split('\r\n')); while (a.length && a[a.length - 1] === '') a.pop(); return a; };
const docBoth = (blocks) => { const a = doc(blocks, opts); assert.deepEqual(doc(blocks, optsNoPos), a, 'trace / no-trace document output differs'); return a; };
const gold = (name) => {
  const j = JSON.parse(fs.readFileSync(path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016', 'section-21', name + '.json'), 'utf8'));
  const l = j.braille.lines.map((x) => x.toUpperCase());
  if (l[0] === '') l.shift();
  while (l.length && l[l.length - 1] === '') l.pop();
  return l;
};
const gl = (block) => ({ type: 'list', kind: 'glossary', style: 'glossary', ...block });

// TF-1 (Paul, 28 Sep 2026, from KD's round-2 answer): Sample 21-9 illustrates 21.7.2 (still in force, margins
// only — it has no font-attribute clause of its own), but its own recorded braille also happens to exercise old
// BANA 5.3.4 ("ignore font attributes on a part-of-speech abbreviation"), withdrawn — one of the old 5.3.3-5.3.11
// the June 2024 changes do not reprint. The book's real page has "v."/"n." genuinely italic (print.printFeatures:
// "italicized part-of-speech label"); Sample 21-9's own gold braille (2016 rules, left unedited per policy — do
// not edit gold braille) still shows them stripped to plain. Emboss now correctly KEEPS that italic (5.4.1, follow
// print), so this test compares against the current, correct output directly for the two affected lines instead of
// `gold('sample-21-9')` for those two; every other line (margins, entry word, definition layout — genuinely 21.7.2)
// still matches the book exactly. See Emboss/docs/expectation-changes.md.
test('single-level thesaurus: 1-3 margins, entry word + label + definition (21.7.2, Sample 21-9)', () => {
  const b = gl({ thesaurus: true, items: [
    { level: 0, term: 'agree', def: 'v. coincide, get along, side with, harmonize with, match up, concur, stand together, go along with, say yes to, conform —Ant. differ, disagree, debate.', defSegments: [{ type: 'text', text: 'v.', tf: 1 }, { type: 'text', text: ' coincide, get along, side with, harmonize with, match up, concur, stand together, go along with, say yes to, conform —Ant. differ, disagree, debate.' }] },
    { level: 0, term: 'alarm', def: 'n. anxiety, apprehension, dismay, distress, dread, strain, stress, tension —Ant. assurance, composure, peace, repose, security.', defSegments: [{ type: 'text', text: 'n.', tf: 1 }, { type: 'text', text: ' anxiety, apprehension, dismay, distress, dread, strain, stress, tension —Ant. assurance, composure, peace, repose, security.' }] },
  ] });
  const g = gold('sample-21-9');
  // TF-1: the book's "v."/"n." are genuinely italic in print and Emboss now keeps that (was stripped, old 5.3.4).
  const expected = g.map((l) => l.replace(/^AGREE  ;V4/, 'AGREE  .1;V4').replace(/^AL>M  ;N4/, 'AL>M  .1;N4'));
  assert.notDeepEqual(expected, g, 'fixture assumption check: the gold text still has the old-rule plain form');
  assert.deepEqual(docBoth([b]), expected);
  assert.deepEqual(both(b).filter((l) => l !== ''), expected);
});

test('multilevel thesaurus: title, blank, division letter, no blank after it, 1-5 / 3-5 margins (21.7.3, 21.2.3c, Sample 21-10)', () => {
  const ex = (t) => ({ type: 'text', text: t, tf: 1 });
  const b = gl({ thesaurus: true, items: [
    { level: 0, term: 'agree', def: 'v. to express', defSegments: [{ type: 'text', text: "v. to express one's willingness or approval. " }, ex('My parents '), { type: 'text', text: 'agreed', tf: 5 }, ex(' to get a dog for my brother and me.')] },
    { level: 1, term: 'approve', termSegments: [{ type: 'text', text: 'approve', tf: 1 }], def: 'x', defSegments: [{ type: 'text', text: 'to say officially that something is correct or should be done. ' }, ex('The principal '), { type: 'text', text: 'approved', tf: 5 }, ex(' the plan for the field trip.')] },
    { level: 1, term: 'consent', def: 'x', defSegments: [{ type: 'text', text: 'to say yes. ' }, ex('Did Judy '), { type: 'text', text: 'consent', tf: 5 }, ex(' to the plan?')] },
    { level: 1, term: 'antonyms:', def: 'deny, refuse' },
  ] });
  const blocks = [{ type: 'heading', level: 1, text: 'Thesaurus' }, { type: 'heading', level: 1, text: 'A a' }, b];
  assert.deepEqual(docBoth(blocks), gold('sample-21-10'));
  // without the field the same entries keep the glossary defaults (runover 2 + 2*level, mixed styles -> two blanks)
  const plain = fmt({ ...b, thesaurus: false });
  assert.ok(plain.some((l) => /^ {2}ANTONYMS3 {2}/.test(l)), plain.join('\n'));
});

test('division letter after a title heading: blank before, none after; a letter range too (21.2.3c)', () => {
  const list = { type: 'list', kind: 'index', items: [{ text: 'apple', page: '3' }] };
  const out = doc([{ type: 'heading', level: 1, text: 'Index' }, { type: 'heading', level: 1, text: 'A a' }, list]);
  assert.equal(out[1], '', out.join('\n'));
  assert.ok(out[2].trim() === ',A A' && out[3].startsWith('APPLE'), out.join('\n'));
  // two ordinary connected headings are still joined
  const two = doc([{ type: 'heading', level: 1, text: 'Chapter' }, { type: 'heading', level: 1, text: 'Words' }, { type: 'para', text: 'Text.' }]);
  assert.ok(two[1].trim() !== '', two.join('\n'));
});

test('dictionary: one blank after the entry word, superscript number after the entry word (21.8.6a, Example 21-35)', () => {
  const b = gl({ dictionary: true, items: [
    { level: 0, term: 'live', termSup: '1', def: '/lĭv/ v. intr. To be alive; exist' },
    { level: 0, term: 'live', termSup: '2', def: '/līv/ adj. Having life; alive: live animals' },
  ] });
  assert.deepEqual(docBoth([b]), gold('example-21-35'));
  assert.deepEqual(both(b).filter((l) => l !== ''), gold('example-21-35'));
  // default (no dictionary field): two blanks, and termSup still lands after the word
  assert.ok(/^LIVE;9#A {2}_\//.test(fmt({ ...b, dictionary: false })[1]), fmt({ ...b, dictionary: false }).join('\n'));
});

test('dictionary multilevel entry: subentries 2 cells in, every runover 2 cells past the deepest level (21.8.5, 21.2.1b)', () => {
  const b = gl({ dictionary: true, items: [
    { level: 0, term: 'improve', def: 'v.' },
    { level: 1, text: '1 to make or become better in some way that everybody can see and value greatly' },
    { level: 1, text: '2 to make good use of something that one has been given for a while' },
    { level: 2, text: 'a second definition level of some length that has to run over a line' },
  ] });
  const out = both(b).filter((l) => l !== '');
  assert.deepEqual(out.map((l) => l.search(/\S/)), [0, 2, 6, 2, 6, 4, 6]);   // 1-7 / 3-7 / 5-7 (three levels)
  assert.ok(out[0].startsWith('IMPROVE ;V4') && out[1].startsWith('  #A '), out.join('\n'));
});

test('shared margin for entries with a preceding article (21.9.2e, Example 21-36)', () => {
  const b = { type: 'list', kind: 'index', sharedMargin: true, items: [
    { level: 0, lead: 'las', text: 'las botas: boots', page: '8' },
    { level: 0, lead: 'el', text: 'el bote: boat', page: '9;' },
    { level: 1, text: 'el bote de vela: sailboat', page: '10;' },
    { level: 1, text: 'pasear en bote de vela: to go out in a sailboat', page: '10' },
    { level: 0, lead: 'el', text: 'el brazo: arm', page: '7' },
    { level: 0, text: 'brillar: to shine', page: '7' },
    { level: 0, text: 'brindar: to offer', page: '5' },
  ] };
  const out = both(b).filter((l) => l !== '');
  const g = gold('example-21-36');
  // Guard: the geometry (start cell of every line) matches the book's own braille
  assert.deepEqual(out.map((l) => l.search(/\S/)), g.map((l) => l.search(/\S/)), out.join('\n'));
  // without the field the list keeps ordinary 1-3 / 3-5 margins
  const plain = fmt({ ...b, sharedMargin: false }).filter((l) => l !== '');
  assert.equal(plain[1].search(/\S/), 0);
});

test('new fields are part of the block cache key (A39)', () => {
  const items = [{ level: 0, term: 'a', def: 'b' }];
  const sig = (x) => getBlockSignature(gl({ items, ...x }), opts, false);
  assert.notEqual(sig({}), sig({ thesaurus: true }));
  assert.notEqual(sig({}), sig({ dictionary: true }));
  assert.notEqual(sig({}), sig({ alphabeticMargins: true }));
  const l = (x) => getBlockSignature({ type: 'list', kind: 'index', items: [{ text: 'x', lead: 'el' }], ...x }, opts, false);
  assert.notEqual(l({}), l({ sharedMargin: true }));
});

test('glossary entry word as a cell-5 heading: no blank line before its illustrative material (21.6.5c/f, Sample 21-7)', () => {
  const g = gold('sample-21-7');
  const quote = '“It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.”';
  const verse = ["There's a certain Slant of light,", 'Winter afternoons—', 'That oppresses, like the Heft', 'Of Cathedral Tunes—'].map((text) => ({ type: 'play', subtype: 'verse', text, level: 0 }));
  const mk = (entryWord) => [
    { type: 'heading', level: 1, text: 'Glossary' },
    { type: 'heading', level: 2, text: 'Austen, Jane: English novelist', ...(entryWord ? { entryWord: true } : {}) },
    { type: 'para', text: quote },
    { type: 'heading', level: 2, text: 'Dickinson, Emily: American poet', ...(entryWord ? { entryWord: true } : {}) },
    ...verse,
  ];
  const out = docBoth(mk(true));
  // the heading's own line carries the print page number in the book (page furniture, not modelled): compare the rest
  assert.ok(out[2].startsWith(g[0].slice(0, 30)), out[2]);
  assert.deepEqual(out.slice(3, 6), g.slice(1, 4), out.join('\n'));
  const i = out.findIndex((l) => l.startsWith('    ,DICK9SON'));
  assert.deepEqual(out.slice(i + 1, i + 5), g.slice(8, 12), out.join('\n'));
  // a displayed (quotation-style) paragraph or a list directly under the entry word: the flag removes the blank a heading otherwise leaves
  const shown = (entryWord, extra) => docBoth([{ type: 'heading', level: 1, text: 'Glossary' }, { type: 'heading', level: 2, text: 'Austen, Jane', ...(entryWord ? { entryWord: true } : {}) }, { type: 'para', style: 'quote', text: 'Quoted words.', ...extra }]);
  assert.equal(shown(true)[3].trim(), ',QUOT$ ^WS4', shown(true).join('\n'));
  assert.equal(shown(false)[3], '');
});
