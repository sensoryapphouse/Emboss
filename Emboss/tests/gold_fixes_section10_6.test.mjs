// Formatter fixes from the BANA Formats section 10 (Exercises) and section 6 (Illustrations) gold sets (23 Sep 2026):
//  - two underlined words: no spurious passage terminator (Example 10-16);
//  - image note between two lists, print-page indicator inside a continuing list: no blank lines (6.2.2a, 1.11.3; Samples 6-12, 6-11);
//  - source citation after an illustration caption/description (6.2.2c, F-168);
//  - directions: 7-5 additional paragraph (10.3.2), 1-5 lettered directions (10.3.3), blank after a page change indicator (10.2.2, Example 10-1);
//  - a note above an exercise question takes no blank (10.6.8, 10.6.10; Examples 10-19, 10-22);
//  - word list keeps its blank after directions (10.7.2b); exercise example blanks and label line (10.8.2, 10.8.3, 10.8.5, 10.8.6);
//  - matching columns without guide dots (10.9.1d); a cell-5 heading in TN indicators (10.9.2b).
// Every new field is optional; without it output is unchanged - EXCEPT `example`/`label`/
// `labelSegments` on an exercise item (BANA 10.8), which K31 (25 Sep 2026) made self-setting:
// document.mjs's own deriveExerciseLabels recognises the label from the item's plain text when
// the field was not already given explicitly (see the "exercise example" test below).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCellMarkup } from '../format/cell-markup.mjs';

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
// The document path must give the same lines with and without the cell trace.
const docBoth = (blocks) => { const a = doc(blocks, opts); assert.deepEqual(doc(blocks, optsNoPos), a, 'trace / no-trace document output differs'); return a; };
const segs = (t) => ({ segments: parseCellMarkup(t) });

test('two underlined words before punctuation keep liblouis\'s own passage terminator (Example 10-16, errata: K22)', () => {
  // The book's original Example 10-16 read "<_1to _1g">, matched by stripping liblouis's own
  // terminator; the errata corrects the expected braille to "<_1to _1g_'">, which is exactly
  // what liblouis gives unmodified, so nothing is stripped any more (K22a).
  const out = docBoth([{ type: 'para', ...segs('What is (<u>to</u> <u>go</u>) on right now?') }]);
  assert.ok(out[0].includes('"<_1TO _1G_\'">'), out[0]);
  // a real passage (three words) keeps its terminator too
  const pass = docBoth([{ type: 'para', ...segs('Now <u>one two three four</u> today.') }]).join('\n');
  assert.ok(pass.includes("_'") || pass.includes('_7'), pass);
});

test('list / image note / list: no blank line around the note (6.2.2a, Sample 6-12)', () => {
  const a = { type: 'list', kind: 'list', items: [{ text: 'one' }, { text: 'two' }] };
  const b = { type: 'list', kind: 'list', items: [{ text: 'three' }] };
  const img = { type: 'graphic', caption: 'A statue', figureType: 'Picture' };
  const out = docBoth([a, img, b]);
  assert.ok(!out.includes(''), out.join('\n'));
  assert.ok(out[2].startsWith('      @.<,PICTURE@.>'), out[2]);
  // a paragraph before the image keeps the blank it always had
  const p = docBoth([{ type: 'para', text: 'Intro.' }, img, b]);
  assert.equal(p.filter((l) => l === '').length, 1, p.join('\n'));
});

test('print page indicator inside a continuing list takes no blank line (Sample 6-11)', () => {
  const a = { type: 'list', kind: 'list', items: [{ text: 'one' }] };
  const b = { type: 'list', kind: 'list', items: [{ text: 'two' }] };
  const out = docBoth([a, { type: 'pagenum', page: '477' }, b]);
  assert.equal(out.length, 3, out.join('\n'));
  assert.ok(/^-+#DGG$/.test(out[1]), out[1]);
  // a paragraph after the indicator keeps the ordinary blank
  const p = docBoth([a, { type: 'pagenum', page: '477' }, { type: 'para', text: 'Then.' }]);
  assert.ok(p.includes(''), p.join('\n'));
});

test('source citation follows the caption, or the description, in 7-5 (6.2.2c, F-168)', () => {
  const g = { type: 'graphic', caption: 'Figure 1. A ship.', citation: 'Courtesy of the Historical Society' };
  const out = both(g);
  assert.ok(out[0].startsWith('      ,FIGURE'), out.join('\n'));
  assert.ok(out[out.length - 1].startsWith('      ,C\\RTESY'), out.join('\n'));
  assert.equal(out.length, 2, out.join('\n'));
  const d = both({ ...g, description: 'A drawing of a ship' });
  const iDesc = d.findIndex((l) => l.includes('@.<'));
  const iCit = d.findIndex((l) => l.includes('C\\RTESY'));
  assert.ok(iCit > iDesc, d.join('\n'));
  assert.deepEqual(both({ type: 'graphic', caption: 'Figure 1. A ship.' }).length, 1);
});

test('additional directions paragraph is 7-5; lettered directions are 1-5 with the items nested (10.3.2, 10.3.3)', () => {
  const two = docBoth([
    { type: 'para', directions: true, text: 'Write each sentence.' },
    { type: 'para', directions: true, directionsContinued: true, text: 'Draw one line under the adjective.' },
  ]);
  assert.ok(two[0].startsWith('    ,WRITE'), two[0]);
  assert.ok(two[1].startsWith('      ,DRAW'), two[1]);
  const nested = docBoth([
    { type: 'para', directions: true, directionsLabelled: true, text: 'A. Use each of the following words in a complete sentence.' },
    { type: 'para', directions: true, directionsContinued: true, text: 'Use adjectives to describe what each dwelling looks like.' },
    { type: 'list', kind: 'exercise', items: [{ text: '1. house', level: 1 }, { text: '2. farm', level: 1 }] },
  ]);
  assert.equal(nested[0], ',A4 ,USE EA* ( ! FOLL[+ ^WS 9 A COMPLETE');
  assert.equal(nested[1], '    S5T;E4');
  assert.ok(nested[2].startsWith('      ,USE ADJ'), nested[2]);
  assert.equal(nested[4], '  #A4 H\\SE');
  // formatBlock and traceBlock agree for the new margins
  both({ type: 'para', directions: true, directionsContinued: true, text: 'Draw one line under the adjective.' });
  both({ type: 'para', directions: true, directionsLabelled: true, text: 'A. Use each word.' });
});

test('a blank line follows a page change indicator before directions (10.2.2, Example 10-1)', () => {
  const out = docBoth([
    { type: 'list', kind: 'exercise', items: [{ text: '59. Where (do, does) the box belong?' }] },
    { type: 'pagenum', page: '63' },
    { type: 'para', directions: true, text: 'List each word used as an adjective.' },
  ]);
  const i = out.findIndex((l) => /^-+#FC$/.test(l));
  assert.ok(i > 0, out.join('\n'));
  assert.notEqual(out[i - 1], '', 'no blank before the indicator (1.11.3d keeps the one after)');
  assert.equal(out[i + 1], '', out.join('\n'));
  assert.ok(out[i + 2].startsWith('    ,LI/'), out.join('\n'));
});

test('a transcriber note above an exercise question leaves no blank (10.6.10, Example 10-22)', () => {
  const out = docBoth([
    { type: 'note', text: 'Print shows a question mark over an underscore. In braille, the question mark is omitted.' },
    { type: 'list', kind: 'exercise', items: [{ ...segs('What is \\_ right now?') }] },
  ]);
  assert.ok(!out.slice(0, -1).includes(''), out.join('\n'));
  assert.equal(out[out.length - 1], ',:AT IS .- "R N[8');
});

test('a word list keeps the blank after the directions; without the flag it joins as before (10.7.2b, 10.2.3)', () => {
  const dir = { type: 'para', directions: true, text: 'Use the words below.' };
  const words = { type: 'list', kind: 'list', items: [{ text: 'Nixon' }, { text: 'Carter' }] };
  assert.equal(docBoth([dir, { ...words, wordList: true }])[1], '');
  assert.notEqual(docBoth([dir, words])[1], '');
});

test('exercise example: blank before and after; label on its own line without emphasis before punctuation (10.8.2, 10.8.3, 10.8.5, 10.8.6)', () => {
  const dir = { type: 'para', directions: true, text: 'Mark the capitalization errors.' };
  const list = { type: 'list', kind: 'exercise', items: [
    { ...segs('**Example** *France* was an important center'), example: true },
    { text: 'Answer It', example: true },
    { text: '1. Women were not accepted.' },
  ] };
  const out = docBoth([dir, list]);
  const iEx = out.findIndex((l) => l.startsWith('^1,EXAMPLE'));
  assert.equal(out[iEx - 1], '', out.join('\n'));
  assert.equal(out[iEx + 2], '', out.join('\n'));                 // example line, Answer line, then a blank
  assert.ok(out[iEx + 3].startsWith('#A4'), out.join('\n'));
  // K31 / BANA 10.8.4 (Sample 10-7 itself is exactly this: "Example"/"Answer" bold, no colon,
  // one sentence, nothing to split): without the explicit flag, document.mjs's own
  // deriveExerciseLabels now recognises the same "Example ...", "Answer ..." pair from their
  // plain leading text alone and gives byte-identical output — the flag is no longer needed
  // for a reader that just gives the label as ordinary text/segments, like everything else.
  const plain = docBoth([dir, { ...list, items: list.items.map(({ example, ...r }) => r) }]);
  assert.deepEqual(plain, out, 'K31: auto-recognised from text alone, same as the explicit example:true above');
  // label on its own line
  const labelled = both({ type: 'list', kind: 'exercise', items: [
    { label: 'EXAMPLE:', text: '1. The president lives in the white house.', example: true },
    { text: '1. the statue of liberty' },
  ] });
  assert.equal(labelled[1], ',,EXAMPLE3');
  assert.ok(labelled[2].startsWith('#A4 ,! PRESID5T'), labelled.join('\n'));
  // a bold label followed by a colon loses its bold; without punctuation it keeps it
  const boldColon = both({ type: 'list', kind: 'exercise', items: [{ labelSegments: parseCellMarkup('**Example:**'), text: 'Ms. Ross are you here?' }] });
  assert.ok(!boldColon[1].includes('^1'), boldColon.join('\n'));
  assert.equal(boldColon[1], ',EXAMPLE3');
  const boldPlain = both({ type: 'list', kind: 'exercise', items: [{ labelSegments: parseCellMarkup('**Example**'), text: 'France was here' }] });
  assert.ok(boldPlain[1].includes('^1,EXAMPLE'), boldPlain.join('\n'));
});

test('matching columns take no guide dots when marked (10.9.1d, Sample 10-10)', () => {
  const table = { type: 'table', headers: [['State', 'Capital']], rows: [['Ohio', 'Des Moines'], ['Kentucky', 'Columbus']] };
  assert.ok(both({ ...table, guideDots: false }).every((l) => !/ "" |"{2,}/.test(l.replace(/^"3+/, ''))), 'no guide dots');
  assert.ok(both(table).some((l) => l.includes('""')), 'guide dots by default');
});

test('a heading in TN indicators is a cell-5 heading with the list directly under it (10.9.2b)', () => {
  const out = docBoth([
    { type: 'para', directions: true, text: 'Who did what?' },
    { type: 'note', cell5: true, text: 'Name' },
    { type: 'list', kind: 'list', items: [{ marker: '1.', text: 'Prince Henry' }] },
  ]);
  assert.equal(out[1], '');
  assert.equal(out[2], '    @.<,"N@.>');
  assert.ok(out[3].startsWith('#A4'), out.join('\n'));
  both({ type: 'note', cell5: true, text: 'Name' });
  assert.equal(fmt({ type: 'note', text: 'Name' })[0], '      @.<,"N@.>');   // default stays cell 7
});

test('new fields are part of the cache key', () => {
  const sig = (b) => getBlockSignature(b, opts, false);
  const base = { type: 'para', directions: true, text: 'x' };
  assert.notEqual(sig(base), sig({ ...base, directionsContinued: true }));
  assert.notEqual(sig(base), sig({ ...base, directionsLabelled: true }));
  assert.notEqual(sig({ type: 'list', kind: 'list', items: [] }), sig({ type: 'list', kind: 'list', items: [], wordList: true }));
  assert.notEqual(sig({ type: 'table', rows: [] }), sig({ type: 'table', rows: [], guideDots: false }));
  assert.notEqual(sig({ type: 'note', text: 'a' }), sig({ type: 'note', text: 'a', cell5: true }));
  assert.notEqual(sig({ type: 'graphic', caption: 'c' }), sig({ type: 'graphic', caption: 'c', citation: 'x' }));
});
