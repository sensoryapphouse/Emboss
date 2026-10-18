// K13: "List every braille symbol used" (doc.exhaustiveSymbols, field-registry.mjs) — an opt-in Special
// Symbols page extra. collectSpecialSymbols(blocks, o) still only returns what BANA Appendix G REQUIRES
// unless o.exhaustiveSymbols === true; on, it also lists the ordinary UEB indicators/punctuation the document
// uses that Appendix G does not require. Uses the real liblouis engine (like field_registry.test.mjs), since
// the detection reads what the engine actually wrote rather than guessing from the print text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSpecialSymbols, formatDocument } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const EX = (extra) => ({ ...OPTS, exhaustiveSymbols: true, ...extra });

const para = (text) => ({ type: 'para', text });

// ---------------------------------------------------------------------------------------------------------------
test('off by default: exhaustive symbols add nothing (K13 opt-in)', () => {
  const blocks = [para('I saw 42 cats in London, and café résumé naïve. Wait... really? "Quoted."')];
  assert.deepEqual(collectSpecialSymbols(blocks, OPTS), []);            // exhaustiveSymbols not set
  assert.deepEqual(collectSpecialSymbols(blocks, { ...OPTS, exhaustiveSymbols: false }), []);
});

test('on: numeric indicator and ellipsis are found', () => {
  const r = collectSpecialSymbols([para('I saw 42 cats. Wait...')], EX());
  const brls = r.map((e) => e.braille);
  assert.ok(brls.includes('#'), 'numeric indicator');
  assert.ok(brls.includes('444'), 'ellipsis');
  assert.ok(r.every((e) => e.kind === 'exhaustive'));
});

test('on: accented letters get their modified-letter indicator', () => {
  const r = collectSpecialSymbols([para('café résumé naïve')], EX());
  const brls = r.map((e) => e.braille);
  assert.ok(brls.includes('^/'), 'acute accent (é)');
  assert.ok(brls.includes('^3'), 'diaeresis (ï)');
});

test('on: multi-cell bracket/brace punctuation is found; a plain hyphen is not', () => {
  const r = collectSpecialSymbols([para('(parens) [brackets] {braces} - a hyphen')], EX());
  const brls = r.map((e) => e.braille);
  for (const b of ['"<', '">', '.<', '.>', '_<', '_>']) assert.ok(brls.includes(b), `${b} present`);
  assert.ok(!brls.includes('-'), 'a single-cell hyphen is not exhaustive-listed');
});

test('on: capitalized symbol indicator is found for a standalone capital letter', () => {
  const r = collectSpecialSymbols([para('A cat sat.')], EX());
  assert.ok(r.some((e) => e.braille === ',' && e.kind === 'exhaustive'));
});

test('on: the standard typeform indicator is found from a run\'s own tf bit, one per typeform used', () => {
  const blocks = [{ type: 'para', segments: [
    { type: 'text', text: 'This word is ' },
    { type: 'text', text: 'italic', tf: 1 },
    { type: 'text', text: ' and this one is ' },
    { type: 'text', text: 'bold', tf: 4 },
    { type: 'text', text: '.' },
  ] }];
  const r = collectSpecialSymbols(blocks, EX());
  const italic = r.find((e) => e.braille === '.1');
  const bold = r.find((e) => e.braille === '^1');
  assert.ok(italic, 'italic word indicator');
  assert.equal(italic.kind, 'exhaustive');
  assert.ok(bold, 'bold word indicator');
  // No underline in this document.
  assert.ok(!r.some((e) => e.braille === '_1'));
});

test('on: transcriber-defined literal cells and typeforms still collect (required entries unaffected)', () => {
  const blocks = [
    { type: 'para', segments: [{ type: 'brl', brl: '.=@#7 ', text: '[' }] },
    { type: 'para', segments: [{ type: 'text', text: 'x', transcriberTypeform: 'strike' }] },
  ];
  const req = collectSpecialSymbols(blocks, OPTS);
  const withExtra = collectSpecialSymbols(blocks, EX());
  assert.ok(req.some((e) => e.kind === 'literal'));
  assert.ok(req.some((e) => e.kind === 'typeform'));
  // Every required entry is still present when exhaustive mode is on.
  for (const e of req) assert.ok(withExtra.some((x) => x.braille === e.braille && x.kind === e.kind), e.braille);
});

test('on: skips the transcriber\'s notes / special symbols pages\' own text', () => {
  const blocks = [
    { type: 'tnpage', matter: 'transcriber', entries: [{ text: 'See page 42... really?' }] },
    { type: 'sympage', matter: 'transcriber', entries: [{ print: '(', braille: '"<', description: 'Open paren' }] },
  ];
  assert.deepEqual(collectSpecialSymbols(blocks, EX()), []);
});

test('on: no engine to hand (o.translate missing) adds nothing and does not throw', () => {
  assert.doesNotThrow(() => collectSpecialSymbols([para('42... café')], { exhaustiveSymbols: true }));
  assert.deepEqual(collectSpecialSymbols([para('42... café')], { exhaustiveSymbols: true }), []);
});

test('braille order: exhaustive entries sort into the same UEB §1.1.2 order as required ones', () => {
  const blocks = [
    { type: 'para', segments: [{ type: 'brl', brl: 'A', text: 'x' }] },   // line-1 cell, forced first in the table
    para('42'),   // numeric indicator '#' — a later line in the order table
  ];
  const r = collectSpecialSymbols(blocks, EX());
  const iA = r.findIndex((e) => e.braille === 'A');
  const iNum = r.findIndex((e) => e.braille === '#');
  assert.ok(iA >= 0 && iNum >= 0 && iA < iNum, 'the literal A-line cell sorts before the numeric indicator');
});

// ---------------------------------------------------------------------------------------------------------------
// End to end: an auto Special Symbols page lists the exhaustive entries too, and the page's own order/heading
// rules (dot locator first, then braille order; BANA heading) are unaffected.
test('end to end: an auto Special Symbols page includes exhaustive entries under the usual heading', () => {
  const doc = {
    title: 'T',
    mode: 'bana', standard: 'bana', exhaustiveSymbols: true,
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      para('I saw 42 cats. Wait... really?'),
      { type: 'sympage', matter: 'transcriber', auto: true },
    ],
  };
  const brf = formatDocument(doc, { translate, translateG1, translatePos, width: 40, depth: 25, suppressHeader: true });
  assert.match(brf, /SPECIAL SYMBOLS/);
  assert.match(brf, /\.=#/);      // numeric indicator entry, dot-locator prefixed
  assert.match(brf, /\.=444/);    // ellipsis entry
});

test('end to end: off (default) keeps the Special Symbols page to the required entries only', () => {
  const doc = {
    title: 'T',
    mode: 'bana', standard: 'bana',
    blocks: [
      { type: 'heading', level: 1, text: 'T' },
      para('I saw 42 cats. Wait... really?'),
      { type: 'sympage', matter: 'transcriber', auto: true },
    ],
  };
  const brf = formatDocument(doc, { translate, translateG1, translatePos, width: 40, depth: 25, suppressHeader: true });
  // Nothing in this document needs a required Special Symbols entry, so the page is dormant (not printed).
  assert.doesNotMatch(brf, /SPECIAL SYMBOLS/);
});
