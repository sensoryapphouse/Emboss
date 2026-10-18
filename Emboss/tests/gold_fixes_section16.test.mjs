// Formatter and gold-builder fixes from the BANA Formats section 16 (Notes) gold set (23 Sep 2026).
// Every new field is optional; without it output is unchanged.
//  - footnote.noteMarkPlacement: 'none' (16.5.1d, no printed mark) / 'inline' (16.2.2a, mark where print puts it)
//  - inline embedded transcriber's note on the text line (16.4b/c), via the existing `imgnote` segment
//  - gold builder: note text markup, [ref:] inside note text, note keyed to a highlighted word, headword-anchored "note"
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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
const T = (text, extra = {}) => ({ type: 'text', text, ...extra });

test('noteMarkPlacement: default prefixes the mark; "none" omits it; "inline" puts it where the body says (16.5.1d, 16.2.2a)', () => {
  const dflt = both({ type: 'footnote', noteMark: '°', text: 'craft.' });
  assert.equal(dflt[0], ';9"0CRAFT4');
  const none = both({ type: 'footnote', noteMark: '°', noteMarkPlacement: 'none', text: 'craft.' });
  assert.equal(none[0], 'CRAFT4');
  const inl = both({ type: 'footnote', noteMark: '°', noteMarkPlacement: 'inline', segments: [T('craft'), { type: 'noteref', text: '°' }, T('.')] });
  assert.equal(inl[0], 'CRAFT;9"04');
  const base = { type: 'footnote', noteMark: '°', text: 'craft.' };
  assert.notEqual(getBlockSignature(base, opts, false), getBlockSignature({ ...base, noteMarkPlacement: 'none' }, opts, false));
});

test('embedded transcriber\'s note on the text line (16.4b/c, Example 16-6)', () => {
  const p = { type: 'para', blocked: true, segments: [T('That floating stuff is called slag. '), { type: 'imgnote', text: 'note' }, T(' The slag is then skimmed off.')] };
  const out = both(p).filter((l, i) => i || l);   // formatBlock leads a blocked paragraph with a blank line
  assert.deepEqual(out, [',T FLOAT+ /UFF IS CALL$ SLAG4 @.<NOTE@.>', ',! SLAG IS !N SKIMM$ (F4']);
});

// ---- the gold builder, through gold-run's own runOne (section-16 model builder) ----
process.env.GOLD_RUN_SECTION = 'section-16';
const gold = await import(path.join(EMBOSS, 'scripts', 'gold-run.mjs'));
const GOLD = path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016', 'section-16');
const load = (id) => JSON.parse(fs.readFileSync(path.join(GOLD, id + '.json'), 'utf8'));
const lines = (r) => r.actual.lines.map((l) => l.replace(/\s+$/, ''));

test('gold builder, Example 16-6: the embedded "note" sits on the text line after the note\'s headword; with blocked:true the gold lines match', () => {
  const s = load('example-16-6');
  s.print.blocks[0].blocked = true;   // what-if: the print paragraph is flush (the gold file does not say so yet)
  const r = gold.runOne(s);
  assert.deepEqual(lines(r), r.expected.lines.map((l) => l.replace(/\s+$/, '')));
});

test('gold builder, Example 16-10: two unmarked notes each get an embedded "note" after their own headword', () => {
  const r = gold.runOne(load('example-16-10'));
  const first = lines(r)[0];
  assert.ok(first.includes(',ROMANS1 @.<NOTE@.>'), first);
  assert.equal((lines(r).join('\n').match(/@\.<NOTE@\.>/g) || []).length, 2, lines(r).join('\n'));
  assert.ok(lines(r).join('\n').includes('C.TRYM51\n@.<NOTE@.>') || lines(r).join('\n').includes('C.TRYM51 @.<NOTE@.>'), lines(r).join('\n'));
});

test('gold builder: a note whose headword is not in the paragraph keeps the separate note block (unchanged)', () => {
  const s = load('example-16-6');
  s.print.notes[0].text = 'Zzzq is something else';
  s.print.blocks[1].text = 'Zzzq is something else';
  const r = gold.runOne(s);
  assert.ok(lines(r).some((l) => l.trim() === '@.<NOTE@.>'), lines(r).join('\n'));
});

test('gold builder, Example 16-2 what-if: [ref:°] in the note text places the mark after the word and no mark is prefixed (16.2.2a)', () => {
  const s = load('example-16-2');
  s.print.notes[0].text = 'craft[ref:°].';   // the gold file itself carries this since the 23 Sep print correction; set it explicitly so the test does not depend on the file
  const r = gold.runOne(s);
  assert.ok(lines(r).includes('CRAFT;9"04'), lines(r).join('\n'));
  assert.ok(!lines(r).some((l) => l.startsWith(';9"0CRAFT')), lines(r).join('\n'));
  // default note text (no [ref:] in it): the mark is still prefixed
  const dd = load('example-16-2');
  dd.print.notes[0].text = 'craft.';
  const d = gold.runOne(dd);
  assert.ok(lines(d).includes(';9"0CRAFT4'), lines(d).join('\n'));
});

test('gold builder, Example 16-9: a note keyed to a highlighted word has no mark and no embedded "note" (16.3a, 16.5.1d); bold headword is a typeform', () => {
  const r = gold.runOne(load('example-16-9'));
  const all = lines(r).join('\n');
  assert.ok(!all.includes('@.<NOTE@.>'), all);
  assert.ok(lines(r).some((l) => l.startsWith('^1PR$ACI')), all);          // bold word indicator, no mark before it
  assert.ok(!lines(r).some((l) => /^;9|^"9|^@,\?/.test(l)), all);
  assert.ok(r.model.limitations.some((x) => /transcriber-defined typeform/.test(x)), 'the highlight itself stays a recorded limitation');
});

test('gold builder: **bold** / *italic* in note text becomes typeform segments, not literal asterisks', () => {
  const s = load('example-16-1');
  s.print.notes[0].text = 'Othello *Moor* of **Venice**';
  const r = gold.runOne(s);
  const all = lines(r).join('\n');
  assert.ok(!all.includes('"9MOOR'), all);
  assert.ok(!/MOOR.*\\?\*/.test(all), all);
  assert.ok(all.includes('.1') || all.includes('^'), all);
});
