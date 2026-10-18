// Formatter fixes from the BANA Formats section 18 (Grammar) and 19 (Codes and Puzzles) gold sets (23 Sep 2026):
//  - literal-cell segment {type:'brl'}: grouping indicators (18.6.5b), transcriber-defined symbols with the dot locator
//    for mention (18.6.3a, Examples 18-2, 18-6, 18-8), devised cells (19.2.1b);
//  - embedded transcriber's note in a sentence or a clue via the existing {type:'imgnote'} segment (18.3.3c, 19.5.2g);
//  - para.diagram (1-3 margins, 18.7.1) and para.arrowLines (blank lines around an arrow/sentence pair, 18.8.1);
//  - para.wordGaps (three blank cells between Morse words, 19.4.1c);
//  - code block dotLocator (19.2.2a/g, 19.6.1b), keepSpaces (19.2.2d, 19.5.3g), spaceLetters (19.6.1c).
// Every new field is optional; without it output is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatBlock, traceBlock, getBlockSignature } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (s, tf) => ({ braille: translate(s, tf), inputPos: Array.from(s, (_, i) => i) });
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const body = (a) => a.filter((l) => l !== '');
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock'); return a; };
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });

test('brl segment: grouping indicators and a mention-locator symbol inside a sentence (Example 18-8)', () => {
  const p = { type: 'para', blocked: true, segments: [T('The War of the Whiskers '), { type: 'brl', text: '^', brl: '@5;<' }, T('between France and England'), { type: 'brl', text: '', brl: ';>' }, T(' raged from 1152 to 1453.')] };
  const out = both(p);
  assert.ok(out.join('\n').includes('@5;<'), out.join('\n'));          // (liblouis contracts "between" to 2T; the book shows it spelled out: a translator matter)
  assert.ok(out.join('\n').includes(',5GL&;> RAG$'), out.join('\n'));
  // in a transcriber's note: dot locator for mention + the symbol
  const n = both({ type: 'note', segments: [T('A caret '), { type: 'brl', text: '^', brl: '.=@5' }, T(' shows an insertion.')] });
  assert.ok(n.join(' ').includes('.=@5'), n.join('\n'));
  assert.ok(n[0].startsWith('      @.<'), n[0]);
});

test('brl segment: transcriber-defined symbol before each list item text (Example 18-2)', () => {
  const l = { type: 'list', kind: 'list', items: [{ segments: [{ type: 'brl', text: '', brl: '@#2' }, T('General Robert E. Lee')] }] };
  const out = both(l);
  assert.equal(body(out)[0], '@#2,G5]AL ,ROB]T ;,E4 ,LEE');
});

test('embedded transcriber\'s note in a sentence (Example 18-5) and in a clue (Example 19-4)', () => {
  const s = both({ type: 'para', blocked: true, continuation: true, segments: [T('I didn’t think so, but that’s '), { type: 'imgnote', text: 'apostrophe is red' }, T(' it.')] });
  assert.ok(s.join(' ').includes('@.<APO/ROPHE IS'), s.join('\n'));
  assert.ok(s.join(' ').includes('R$@.>'), s.join('\n'));
  const c = both({ type: 'list', kind: 'list', items: [{ segments: [T('1. Parent’s female child '), { type: 'imgnote', text: 'a1 (8)' }] }] });
  assert.equal(body(c)[0], '#A4 ,P>5T\'S FEMALE * @.<A#A "<#H">@.>');
});

test('diagrammed sentence: 1-3 margins (18.7.1); arrow lines with blank lines around the pair (18.8.1)', () => {
  const long = 'The stadium crowd was large and friendly and the players were happy about it all.';
  const d = both({ type: 'para', diagram: true, text: long });
  assert.ok(!d[0].startsWith(' ') && d[1].startsWith('  '), d.join('\n'));
  const a = both({ type: 'para', text: 'The stadium crowd was large.', arrowLines: ['          "333333334333333334', '          ;\\%      _        _'] });
  assert.equal(a[0], '');
  assert.equal(a[1], '          "333333334333333334');
  assert.equal(a[a.length - 1], '');
  assert.ok(a[3].startsWith(',! /ADIUM'), a.join('\n'));
  // default is unchanged: an ordinary paragraph is 3-1
  assert.ok(fmt({ type: 'para', text: 'The boy played in the park.' })[0].startsWith('  ,!'));
  // UKAAF ignores the field
  const uk = { ...opts, mode: 'ukaaf', standard: 'ukaaf' };
  assert.ok(fmt({ type: 'para', diagram: true, text: 'The boy played.' }, uk)[0].startsWith('  '));
});

test('Morse: three blank cells between words survive (19.4.1c, Example 19-2)', () => {
  const p = both({ type: 'para', wordGaps: true, blocked: true, continuation: true, text: '-- --- .-. ... .   -.-. --- -.. .' });
  assert.equal(p[0], '-- --- 4-4 444 4   -4-4 --- -44 4');
  // without the field the gap collapses as before
  assert.equal(fmt({ type: 'para', blocked: true, continuation: true, text: '-- --- .-. ... .   -.-. --- -.. .' })[0], '-- --- 4-4 444 4 -4-4 --- -44 4');
});

test('word puzzle: dot locator around the grade 1 passage, letters spaced (19.6.1b/c, Example 19-5)', () => {
  const b = { type: 'code', dotLocator: true, spaceLetters: true, text: 'wsflowerll\nqqfnwwioyw' };
  const out = both(b);
  assert.deepEqual(out, ['', '""=;;;', 'W S F L O W E R L L', 'Q Q F N W W I O Y W', '""=;\'', '']);
  // default: bare indicators, letters unspaced
  const d = fmt({ type: 'code', text: 'wsflowerll' });
  assert.equal(d[1], ';;;');
  assert.ok(!d[2].includes(' '), d[2]);
});

test('linear key: a line keeps its own blanks (19.2.2d, 19.5.3g)', () => {
  const b = { type: 'code', dotLocator: true, keepSpaces: true, text: 'CODE     q w e r\nLETTER   a b c d' };
  const out = both(b);
  assert.equal(out[2], ',,CODE     Q W E R');
  assert.ok(out[3].startsWith(',,LETTER   A'), out[3]);
  const d = fmt({ type: 'code', text: 'CODE     q w e r' });
  assert.equal(d[2], ',,CODE Q W E R');
});

test('cache key changes with each new optional field', () => {
  const base = { type: 'para', text: 'x  y' };
  const sig = (b) => getBlockSignature(b, opts, false);
  const s0 = sig(base);
  for (const f of [{ wordGaps: true }, { diagram: true }, { arrowLines: ['a'] }]) assert.notEqual(sig({ ...base, ...f }), s0, JSON.stringify(f));
  const c = { type: 'code', text: 'a b' };
  for (const f of [{ dotLocator: true }, { keepSpaces: true }, { spaceLetters: true }]) assert.notEqual(sig({ ...c, ...f }), sig(c), JSON.stringify(f));
});

test('document path gives the same lines with and without the cell trace', () => {
  const blocks = [{ type: 'para', diagram: true, text: 'The boy played in the park.' }, { type: 'code', dotLocator: true, keepSpaces: true, text: 'a  b' }, { type: 'para', wordGaps: true, text: '.-   -.' }];
  const a = formatDocument({ title: null, blocks }, opts);
  const b = formatDocument({ title: null, blocks }, { ...opts, translatePos: undefined });
  assert.equal(a, b);
});
