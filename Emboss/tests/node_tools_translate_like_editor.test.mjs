// Import fix list #55 (Paul approved 1 Oct 2026): the Node tools that measure Emboss against the standards must translate the
// way the editor and Quick Mode do - liblouis wrapped in styledTranslate (sub/superscript level signs by RUEB's grade-1 rules,
// A86; quote exchange, UK-3; invisible-character clean-up) - not a bare liblouis call. Before this, gold-run, test-corpus and
// check-layout-parity passed a plain translator, so a change to any of that was invisible to them.
//
// Three groups:
//   1. format/node-translate-helper.mjs builds exactly what the app builds (compared with styledTranslate wired by hand the way
//      editor.mjs / app.mjs wire it, and with the app source itself so the two cannot drift apart unnoticed);
//   2. scripts/gold-run.mjs hands the formatter that translator (it is importable, so it is checked by behaviour);
//   3. format/test-corpus.mjs and scripts/check-layout-parity.mjs (programs that run on import / in workers, so they are checked
//      by reading their source) build theirs through the helper and no longer pass a bare liblouis call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { styledTranslate } from '../format/text-style.mjs';
import { makeTranslators, UEB_TABLES } from '../web/braille-table.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const read = (rel) => fs.readFileSync(path.join(EMBOSS, rel), 'utf8');

const SUB = '', SUP = '', END = '';
const raw = (s, tf) => louis.translate(s, louis.TABLES.uebG2, tf || null);

// ---------- 1. the helper is what the app builds ----------
test('the helper resolves sub/superscripts exactly as the app does (RUEB 3.24.1, 3.4; A86)', () => {
  const { translate } = editorTranslators(louis);
  const tr = makeTranslators(louis, UEB_TABLES.g2);
  const g1 = (s, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(s, tf);
  const app = styledTranslate((s, tf) => tr.translate(s, tf), 'faithful', g1);        // editor.mjs currentFormatOpts / app.mjs transcribe
  for (const text of [
    `H${SUB}2${END}O`,                                    // single item: ,H;5#B,O
    `x${SUP}2${END} and CO${SUB}2${END}`,
    `mass${SUB}sun${END}`,                                // RUEB 3.4: a word as the script puts the word in grade 1 (needs translateG1)
    `x${SUP}2y${END} plus 4m${SUP}2${END}`,
    'Price £5 and soft­hyphen',            // invisible-character clean-up
    '‘Hello,’ she said.',
  ]) assert.equal(translate(text), app(text), JSON.stringify(text));
  assert.match(translate(`H${SUB}2${END}O`), /;5#B/, 'a subscript level sign is in the braille');
  assert.match(translate(`mass${SUB}sun${END}`), /;;5<SUN>/, 'the word goes into grade 1 (RUEB 3.4 "mass" with subscript "sun")');
  assert.notEqual(raw(`H${SUB}2${END}O`), translate(`H${SUB}2${END}O`), 'a bare liblouis call does not do this - that was the gap');
});

test('quote exchange follows the setting (UK-3, RUEB 7.6.4); the default is faithful', () => {
  const text = '‘Hello,’ she said.';
  assert.equal(editorTranslators(louis).translate(text), raw(text), 'faithful: unchanged');
  assert.equal(editorTranslators(louis, { quoteStyle: 'exchange' }).translate(text), raw('“Hello,” she said.'), 'exchange: double quote signs');
});

test('translateG1 is supplied for UEB (and is the grade-1 table), absent for other codes', () => {
  const ueb = editorTranslators(louis);
  assert.equal(typeof ueb.translateG1, 'function');
  assert.equal(ueb.translateG1('abc and the'), louis.translate('abc and the', louis.TABLES.uebG1));
  const g1only = editorTranslators(louis, { table: 'g1' });
  assert.equal(g1only.translate('and the'), louis.translate('and the', louis.TABLES.uebG1), 'grade 1 table selected');
  const other = editorTranslators(louis, { table: '/tables/en-us-brf.dis,/tables/ru-litbrl.ctb' });
  assert.equal(other.translateG1, undefined, 'no grade 1 translator for a non-UEB code (the app passes none either)');
});

test('translatePos is the editor’s: same house clean-up, cells point at the original text', () => {
  const { translatePos } = editorTranslators(louis);
  const text = 'ab­cd​ef';                                   // soft hyphen at 2, zero-width space at 5
  const res = translatePos(text);
  const seen = new Set(res.inputPos.filter((p) => typeof p === 'number' && p >= 0));
  assert.ok(![...seen].some((p) => p === 2 || p === 5), 'no cell points at a removed character');
  assert.ok(typeof res.braille === 'string' && res.braille.length === res.inputPos.length);
});

test('the helper copies the app wiring: editor.mjs and app.mjs still build translate the way the helper does', () => {
  // If someone changes how the app wires translate (another quote default, another grade-1 rule), this fails until the helper
  // (and so every Node tool) follows - the whole point of #55.
  const editor = read('web/editor/editor.mjs'), app = read('web/app.mjs');
  assert.ok(editor.includes("const translateG1 = /en-ueb/.test(table) ? (s, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(s, tf) : undefined;"), 'editor translateG1');
  assert.ok(editor.includes("styledTranslate((s, tf) => tr.translate(s, tf), settings.quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null)"), 'editor translate');
  // 1 Oct 2026 (feedback item 7): translatePos takes the grade-1 translator too, as translate does (the helper follows).
  assert.ok(editor.includes("styledTranslatePos((s, tf) => tr.translatePos(s, tf || null), settings.quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null)"), 'editor translatePos');
  // 17 Oct 2026 (feedback item 9a): Quick Mode takes every setting from the saved settings (buildOpts), not from its own Settings controls, so the quote style is s.quoteStyle
  assert.ok(app.includes("const translateG1 = /en-ueb/.test(table) ? (t, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(t, tf) : undefined;"), 'Quick Mode translateG1');
  assert.ok(app.includes("styledTranslate((t, tf) => tr.translate(t, tf), s.quoteStyle || 'faithful', /en-ueb-g2/.test(table) ? translateG1 : null)"), 'Quick Mode translate');
  const settings = read('web/settings.mjs');
  assert.match(settings, /quoteStyle: 'faithful'/, "the default quote style is 'faithful' for every standard");
  const helper = read('format/node-translate-helper.mjs');
  assert.ok(helper.includes("quoteStyle = 'faithful'"), 'the helper defaults to the app default');
});

// ---------- 2. gold-run ----------
test('gold-run formats with the editor’s translator (sub/superscripts resolved)', async () => {
  process.env.GOLD_RUN_SECTION = 'section-11';
  const gold = await import('../scripts/gold-run.mjs');
  assert.ok(gold.OPTS && typeof gold.OPTS.translate === 'function', 'gold-run exports the options it formats with');
  const text = `H${SUB}2${END}O and mass${SUB}sun${END}`;
  assert.equal(gold.OPTS.translate(text), editorTranslators(louis).translate(text));
  assert.match(gold.OPTS.translate(`H${SUB}2${END}O`), /;5#B/);
  assert.equal(typeof gold.OPTS.translateG1, 'function', 'the raw grade 1 translator, as the app passes it');
});

// ---------- 3. test-corpus and check-layout-parity ----------
for (const rel of ['format/test-corpus.mjs', 'scripts/check-layout-parity.mjs']) {
  test(`${rel} builds its translators with editorTranslators, not a bare liblouis call`, () => {
    const src = read(rel);
    assert.ok(/editorTranslators\(/.test(src), 'uses the helper');
    assert.ok(!/(?:const|let)\s+translate(?:Pos|G1)?\s*=\s*\(?[^;\n]*louis\.translate/.test(src), 'no hand-made translate = louis.translate(...)');
  });
}

// ---------- 4. the editor's position trace resolves the markers too (styledTranslatePos, #55) ----------
// Before, styledTranslatePos handed U+E000-U+E002 to liblouis, which escapes them. The layout noticed the escape, dropped the
// trace and laid the block out again with `translate`: right braille, but no cell-to-print link for the block and a
// "trace-fallback" notice. The trace now gives the same braille as `translate` (with positions) for every run it can do exactly.
const POS_CASES = {
  'single digit subscript (H2O)': `Water is H${SUB}2${END}O.`,
  'superscript after a letter and after a number': `x${SUP}2${END} and 4m${SUP}2${END} then 3${SUP}2${END}a`,
  'a letter-script after a number-script': `x${SUB}2${END}a`,
  'a letter as the script': `x${SUP}n${END}`,
  'a bracketed expression as the script': `x${SUP}(n+1)${END} ok`,
  'an empty (raised-space) script': `a${SUB}${END}b`,
  'a footnote reference number': `see${SUP}12${END} here`,
  'a marker at the very end, unclosed': `CO${SUB}2`,
};
for (const [name, text] of Object.entries(POS_CASES)) {
  test(`position trace: ${name} - same braille as translate, one input position per cell`, () => {
    const { translate, translatePos } = editorTranslators(louis);
    const r = translatePos(text);
    assert.equal(r.braille, translate(text), 'braille identical to translate');
    assert.equal(r.inputPos.length, r.braille.length, 'a position for every cell');
    assert.ok(r.inputPos.every((p) => Number.isInteger(p) && p >= 0 && p < text.length), `positions are indices into the text: ${r.inputPos}`);
    for (let k = 1; k < r.inputPos.length; k++) assert.ok(r.inputPos[k] >= r.inputPos[k - 1], `positions never go backwards: ${r.inputPos}`);
  });
}

test('position trace: the level sign points at its marker, the digit at its digit, the letter after at itself', () => {
  const { translatePos } = editorTranslators(louis);
  const text = `CO${SUB}2${END}!`;                       // C0 O1 SUB2 '2'3 END4 !5   ->  ,,CO;5#B6
  const r = translatePos(text);
  assert.equal(r.braille, ',,CO;5#B6');
  assert.deepEqual(r.inputPos, [0, 0, 0, 1, 2, 2, 3, 3, 5], 'caps sign+C, O, ";5" at the marker, "#B" at the digit, "!" at itself');
});

test('position trace: with quote exchange and a removed invisible character the positions still index the original text', () => {
  const { translatePos } = editorTranslators(louis, { quoteStyle: 'exchange' });
  const text = `‘H${SUB}2${END}­O’`;     // soft hyphen at 4+... removed
  const r = translatePos(text);
  assert.ok(r.inputPos.every((p) => p >= 0 && p < text.length));
  assert.ok(!r.inputPos.includes(text.indexOf('­')), 'no cell points at the removed soft hyphen');
});

// Changed 1 Oct 2026 (feedback 30 Sep item 7, Paul: the editor showed "Editor link degraded" as a transcription warning for these
// blocks): a run that needs the grade 1 translator is now traced too (styledTranslatePos with translateG1 ->
// resolveGroupedScriptsPos). Was: left to the layout fallback, with a trace-fallback notice and no cell links.
test('a run that needs the grade 1 translator is traced too: same braille, no trace-fallback, its cells link to its word', async () => {
  const { formatDocumentAsync } = await import('../format/document.mjs');
  const { translate, translatePos, translateG1 } = editorTranslators(louis);
  const text = `The mass${SUB}sun${END} and x${SUP}2${END}.`;
  const doc = { title: null, blocks: [{ type: 'para', text }] };
  const base = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true };
  const quick = (await import('../format/document.mjs')).formatDocument(doc, base);
  const o = { ...base, translatePos, trace: {} };
  const editor = await formatDocumentAsync(doc, o);
  assert.equal(editor, quick, 'editor braille equals Quick Mode braille');
  assert.match(editor, /;;5<SUN>/);
  assert.ok(!(o.warnings || []).some((w) => w.kind === 'trace-fallback'), `no trace-fallback: ${JSON.stringify(o.warnings)}`);
  const cells = o.trace.rowCells.flat().filter(Boolean);
  assert.ok(cells.length >= 15, 'the row carries a print source for its cells');
  const word = [text.indexOf('mass'), text.indexOf(END) + 1];
  const r = translatePos(text);
  const at = r.braille.indexOf(';;5<SUN>');
  for (let k = at; k < at + 8; k++) assert.ok(r.inputPos[k] >= word[0] && r.inputPos[k] < word[1], `cell ${k} links into the word "mass(sun)": ${r.inputPos[k]}`);
  for (let k = 1; k < r.inputPos.length; k++) assert.ok(r.inputPos[k] >= r.inputPos[k - 1], 'positions never go backwards');
});

test('a block whose scripts are all single items is traced (no trace-fallback) and its cells link to the print text', async () => {
  const { formatDocumentAsync, formatDocument } = await import('../format/document.mjs');
  const { translate, translatePos, translateG1 } = editorTranslators(louis);
  const doc = { title: null, blocks: [{ type: 'para', text: `Water is H${SUB}2${END}O and x${SUP}2${END}.` }] };
  const base = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true };
  const o = { ...base, translatePos, trace: {} };
  const editor = await formatDocumentAsync(doc, o);
  assert.equal(editor, formatDocument(doc, base), 'editor braille equals Quick Mode braille');
  assert.ok(!(o.warnings || []).some((w) => w.kind === 'trace-fallback'), `no trace-fallback: ${JSON.stringify(o.warnings)}`);
  const cells = o.trace.rowCells.flat();
  assert.ok(cells.length > 0 && cells.filter(Boolean).length >= 15, 'the row carries a print source for its cells');
  const text = doc.blocks[0].text;
  const subAt = text.indexOf(SUB);
  assert.ok(cells.some((c) => c && c.c === subAt + 1), 'a cell points at the subscript digit itself');
});
