// K20-K22 (25 Sep 2026): the BANA June 2024 foreign-language revision (1.16.2, RUEB 4.2.2/4.2.4) and three
// errata fixes, reviewed in docs/bana-2024-changes-review.md (rows A2, A15, C5, C6, section 3).
//  - K20: liblouis is NFC-normalised before translation (translate/translatePos, engine/louis.mjs and
//    engine/louis-browser.mjs), so decomposed accents (base letter + combining mark — common from web
//    pages and some Word files) no longer make liblouis contract across the accented letter or misplace
//    capital signs. translatePos's click-position map is remapped back to the CALLER's own (possibly
//    NFD) offsets, so the editor's print<->braille linking still works on decomposed text. Old English
//    (`seg.lang === 'ang'`) is uncontracted per BANA 1.16.2, via the EXISTING `seg.uncontracted` grade-1
//    path (input/lang.mjs finishLanguages) — the formatter itself still never reads `lang` (see that
//    file's header and tests/foreign_language.test.mjs).
//  - K21: an accent printed above a hyphen, dash or other non-letter symbol is written (unspaced) BEFORE
//    the symbol, not after (prepareMarks in engine/louis.mjs and engine/louis-browser.mjs, BANA 21.9.3b).
//  - K22: (a) Example 10-16's old strip of liblouis's own passage terminator (`stripWordRunTerminator`)
//    is removed — the errata corrects the book's expected braille to include the terminator, which is
//    exactly what liblouis already gives unmodified. (b) The checkmark bullet is `@%` (dot 4, dots
//    1-4-6), not `"%` (dot 5, dots 1-4-6) — Sample 8-13's errata, UEB 3.28.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const { parseFile } = await import(path.join(EMBOSS, 'input', 'parse.mjs'));
const { formatDocument, formatBlock, traceBlock } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const { parseCellMarkup } = await import(path.join(EMBOSS, 'format', 'cell-markup.mjs'));

const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const opts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, translatePos, suppressHeader: true };
const optsNoPos = { ...opts, translatePos: undefined };

const clean = (a) => a.map((l) => l.replace(/\s+$/, ''));
const fmt = (block, o = opts) => clean(formatBlock(block, o));
const trc = (block, o = opts) => clean(traceBlock(block, o).map((t) => t.s));
const both = (block, o = opts) => { const a = fmt(block, o); assert.deepEqual(trc(block, o), a, 'traceBlock differs from formatBlock (A39)'); return a; };
const segs = (t) => ({ segments: parseCellMarkup(t) });

// ---------------------------------------------------------------------------------------------------
// K20: NFC normalisation before liblouis
// ---------------------------------------------------------------------------------------------------
// RUEB 2024 section 4.2 examples (docs/bana-2024-changes-review.md, row A2). Confirmed correct with NFC
// input already; NFD (decomposed) input used to contract across the accented letter and misplace
// capital signs (Général -> ",G^/5^/]AL" instead of ",G^/EN^/ERAL").
const ACCENT_EXAMPLES = [
  ['café', 'CAF^/E'],
  ['señor', 'SE^]NOR'],
  ['Général', ',G^/EN^/ERAL'],
  ['Märchen', ',M^3AR*5'],
  ['Händel', ',H^3ANDEL'],
  ['blessèd', 'B.S^*ED'],
  ['théâtre', '?^/E^%ATRE'],
  ['AOÛT', ',,AO^%UT'],
];

test('K20: RUEB section 4.2 accent examples give identical (correct) braille in NFC and NFD', () => {
  for (const [word, expected] of ACCENT_EXAMPLES) {
    const nfc = word.normalize('NFC'), nfd = word.normalize('NFD');
    assert.notEqual(nfc, nfd, `${word}: fixture should actually have distinct NFC/NFD forms`);
    assert.equal(translate(nfc), expected, `NFC ${word}`);
    assert.equal(translate(nfd), expected, `NFD ${word}`);
    assert.equal(translate(nfc), translate(nfd), `NFC/NFD braille differs for ${word}`);
  }
});

test('K20: translatePos maps an NFD word\'s cells back to the CALLER\'s own (NFD) offsets', () => {
  const nfd = 'Général'.normalize('NFD');            // 9 code units: G e <acute> n e <acute> r a l
  assert.equal(nfd.length, 9, 'fixture is actually decomposed');
  const { braille, inputPos } = translatePos(nfd);
  assert.equal(braille, ',G^/EN^/ERAL');
  assert.equal(inputPos.length, braille.length, 'one position per output character');
  for (const p of inputPos) assert.ok(Number.isInteger(p) && p >= 0 && p < nfd.length, `inputPos ${p} must index the CALLER's NFD string (length ${nfd.length})`);
  // the composed form's own positions stay a valid, simple 0..6 map (sanity check the fast/no-fold path too)
  const nfc = 'Général'.normalize('NFC');
  const posNfc = translatePos(nfc);
  assert.equal(posNfc.braille, braille);
  for (const p of posNfc.inputPos) assert.ok(p >= 0 && p < nfc.length);
});

test('K20: Old English (lang=ang) is uncontracted end to end (BANA 1.16.2)', async () => {
  const FILL = 'This is an ordinary English paragraph with plenty of plain words in it, written for the test. '.repeat(6);
  const html = `<html lang="en"><body><p>${FILL}</p><p>The word <span lang="ang">hwæt</span> opens the poem.</p></body></html>`;
  const m = await parseFile('t.html', html);
  const seg = m.blocks[1].segments && m.blocks[1].segments.find((s) => s.lang === 'ang');
  assert.ok(seg, 'the reader kept the Old English span');
  assert.equal(seg.uncontracted, true, 'an Old English segment is marked uncontracted (reused seg.uncontracted path)');
  const out = formatDocument(m, opts);
  assert.match(out, /;;?HWA\^6ET/, `the grade-1 word indicator wraps the Old English word:\n${out}`);
});

// ---------------------------------------------------------------------------------------------------
// K21: modifier before a modified hyphen, dash or other symbol (BANA 21.9.3b)
// ---------------------------------------------------------------------------------------------------
test('K21: an accent above a hyphen, dash or other symbol goes BEFORE it, unspaced (BANA 21.9.3b)', () => {
  assert.equal(translate('-̈e'), '^3-E', 'hyphen + diaeresis + e');
  assert.equal(translate('il-̂t'), 'IL^%-T', 'il + hyphen+circumflex + t: no spurious grade-1 indicator (cf. bare "il-t" -> "IL-;T")');
  assert.equal(translate('—̈'), '^3,-', 'em dash + diaeresis');
  // an ordinary accented LETTER (not a symbol) is untouched by K21 -- still just the normal letter form
  assert.equal(translate('café'), 'CAF^/E');
  // position mapping survives the output reorder too
  const { braille, inputPos } = translatePos('il-̂t');
  assert.equal(braille, 'IL^%-T');
  assert.equal(inputPos.length, braille.length);
  for (const p of inputPos) assert.ok(p >= 0 && p < 'il-̂t'.length);
});

// ---------------------------------------------------------------------------------------------------
// K22(a): Example 10-16 errata -- liblouis's own passage terminator is no longer stripped
// ---------------------------------------------------------------------------------------------------
test('K22(a): two underlined words keep liblouis\'s own passage terminator (errata Example 10-16)', () => {
  const block = { type: 'para', ...segs('What is (<u>to</u> <u>go</u>) on right now?') };
  const lines = both(block);
  assert.ok(lines.some((l) => l.includes('"<_1TO _1G_\'">')), lines.join('\n'));
  // the same output with no trace path (translatePos undefined) matches too
  assert.deepEqual(fmt(block, optsNoPos), lines);
});

// ---------------------------------------------------------------------------------------------------
// K22(b): the checkmark bullet is @%, not "%
// ---------------------------------------------------------------------------------------------------
test('K22(b): the checkmark bullet is @% (dot 4, dots 1-4-6), not "% (errata Sample 8-13, UEB 3.28)', () => {
  const list = { type: 'list', kind: 'list', items: [{ text: 'Ticked', marker: '√', level: 0 }] };
  const lines = both(list).filter(Boolean);
  assert.ok(lines[0].startsWith('@% '), lines[0]);
  assert.ok(!lines[0].startsWith('"% '), lines[0]);
});
