// A78: emoji and other characters beyond U+FFFF now reach ICON-1 (RUEB §3.26, BANA 17.5.1d/
// 2.5.2)/the UKAAF full-cell-plus-warning path, instead of silently becoming the plain full
// cell with no symbol and no warning. Emboss/tests/print_icons.test.mjs's own header comment
// (and document.mjs's ICON_SYMBOL_BRL comment) flagged this as a known gap: foldNonBmp/bmpFold
// (Emboss/engine/louis.mjs, Emboss/engine/louis-browser.mjs) used to pre-substitute ANY non-BMP
// code point with no single-character NFKC fold with the full-cell placeholder before liblouis
// ever ran, so document.mjs's scrub layer (scanUndefinedEscapes/assignIconSymbol) never saw an
// escape to intercept for one. foldNonBmp now keeps such a code point's two surrogate units
// intact instead: liblouis's own undefined-character-escape fallback ('\Xhhhh' per 16-bit unit)
// fires for each half, exactly as it already does for an ordinary undefined BMP character, and
// document.mjs's scanUndefinedEscapes (which already re-pairs adjacent surrogate-half escapes —
// its own comment anticipated exactly this fix) takes it from there. Mathematical alphanumerics
// (𝑥 U+1D465 etc.) still fold to their plain BMP letter via NFKC, unchanged.
//
// Mirrors tests/print_icons.test.mjs's structure/opts exactly (same bana()/ukaaf()/
// bananEditor() helper shapes) so this file reads as "the same suite, non-BMP input".
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { formatDocument, formatDocumentAsync } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const { styledTranslate, styledTranslatePos } = await import(path.join(EMBOSS, 'format', 'text-style.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const rawTranslate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const rawTranslatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);

const LIGHT_BULB = '💡';        // U+1F4A1, no NFKC fold — document.mjs's own worked example
const PROHIBITED = '🚫';        // U+1F6AB, no NFKC fold — a second, distinct icon
const MATH_ITALIC_X = '𝑥';      // U+1D465 MATHEMATICAL ITALIC SMALL X — NFKC folds to plain 'x'

const bana = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: rawTranslate, translatePos: rawTranslatePos, suppressHeader: true, ...extra });
const ukaaf = (extra) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: rawTranslate, translatePos: rawTranslatePos, suppressHeader: true, ...extra });
// The editor's own translate/translatePos wrapping (format/text-style.mjs), on top of the same
// raw liblouis calls, so this test exercises exactly what web/editor/editor.mjs hands document.mjs.
const bananEditor = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25,
  translate: styledTranslate(rawTranslate, 'faithful'), translatePos: styledTranslatePos(rawTranslatePos, 'faithful'),
  suppressHeader: true, ...extra });

const sympageLines = (brf) => brf.split('\n').filter((l) => l.trim().startsWith('.='));

test('engine: an unfoldable non-BMP character (💡) reaches translate() as two undefined-char escapes, not the pre-substituted full cell', () => {
  const raw = louis.translate(`a ${LIGHT_BULB} b`, louis.TABLES.uebG2);
  assert.match(raw, /\\XD83D.*\\XDCA1/, `expected the paired high/low surrogate escapes: ${raw}`);
  assert.ok(!raw.includes('='), 'no pre-substituted full cell in the raw engine output');
});

test('engine: a mathematical alphanumeric (𝑥) still folds via NFKC to its plain letter, unchanged', () => {
  const raw = louis.translate(`a ${MATH_ITALIC_X} b`, louis.TABLES.uebG2);
  const plain = louis.translate('a x b', louis.TABLES.uebG2);
  assert.equal(raw, plain, `𝑥 must braille byte-identical to plain x: ${raw} vs ${plain}`);
  assert.ok(!/\\X/.test(raw), 'no undefined-char escape for a folded mathematical alphanumeric');
});

test('BANA: 💡 gets a transcriber-defined icon symbol and a Special Symbols page entry', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `Turn on the ${LIGHT_BULB} switch.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  assert.ok(!/\\X/i.test(brf), 'no raw liblouis escape ever reaches the BRF');
  assert.equal(o.untranslatable, undefined, 'handled as an icon symbol, not recorded as untranslatable');
  const kinds = (o.warnings || []).map((w) => w.kind);
  assert.ok(!kinds.includes('lou-undefined-char'), kinds);
  const lines = sympageLines(brf);
  assert.equal(lines.length, 2, 'dot locator + exactly one icon entry');
  assert.ok(lines[1].startsWith('.=;?'), `expected the FIRST transcriber-defined symbol slot: ${lines[1]}`);
});

test('BANA: two different emoji get two different symbols, in order of first appearance', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `First ${LIGHT_BULB}, then ${PROHIBITED}.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  const lines = sympageLines(brf);
  assert.equal(lines.length, 3, 'dot locator + two distinct icon entries');
  assert.ok(lines.some((l) => l.startsWith('.=;?')), lines.join('\n'));   // 💡 first -> slot 1
  assert.ok(lines.some((l) => l.startsWith('.=#?')), lines.join('\n'));   // 🚫 second -> slot 2
});

test('BANA: the same emoji repeated reuses its symbol (not a new one each time)', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `First ${LIGHT_BULB} use.` },
    { type: 'para', text: `Second ${LIGHT_BULB} use, same icon.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  assert.equal(sympageLines(brf).length, 2, 'dot locator + exactly one icon entry — not two');
  const occurrences = (brf.match(/;\?/g) || []).length;
  assert.equal(occurrences, 3, 'both body occurrences plus the one Symbols page entry use the same (first) symbol, not two different ones');
});

test('UKAAF: 💡 becomes the full cell plus a lou-undefined-char warning (today: silent full cell)', () => {
  const o = ukaaf();
  const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: `A ${LIGHT_BULB} here.` }] }, o);
  assert.ok(brf.includes('='), brf);
  assert.ok(!/\\X/i.test(brf), 'no raw escape leaks into the BRF');
  assert.deepEqual((o.untranslatable || []).map((e) => e.codePoint), [LIGHT_BULB.codePointAt(0)]);
  const kinds = (o.warnings || []).map((w) => w.kind);
  assert.ok(kinds.includes('lou-undefined-char'), kinds);
  assert.equal(o._iconSymbols, undefined, 'UKAAF never assigns an icon symbol at all');
});

test('editor path (formatDocumentAsync + translatePos) agrees exactly with the plain formatDocument path for an emoji document', async () => {
  const model = { title: null, blocks: [
    { type: 'para', text: `See ${LIGHT_BULB} first, then ${PROHIBITED} second, then ${LIGHT_BULB} again.` },
    { type: 'para', text: `Some maths: ${MATH_ITALIC_X} squared.` },
    { type: 'sympage', auto: true },
  ] };
  const oPlain = bana();
  const brfPlain = formatDocument(model, oPlain);
  const oEditor = bananEditor();
  const brfEditor = await formatDocumentAsync(model, oEditor);
  assert.equal(brfEditor, brfPlain, 'the editor (translatePos + text-style.mjs wrapping) path must braille identically to the plain formatDocument path');
  assert.ok(!(oEditor.warnings || []).some((w) => w.kind === 'lou-undefined-char'));
  const lines = sympageLines(brfEditor);
  assert.equal(lines.length, 3, 'dot locator + two distinct icon entries, via the editor path too');
});

test('translatePos: cell positions for an emoji document still map back to the CALLER\'s own string offsets (print<->braille sync)', () => {
  // The raw engine contract (Emboss/engine/louis.mjs's own translatePos): every inputPos entry
  // indexes into the string passed to translatePos, regardless of how many liblouis-internal
  // units (two surrogate escapes, now, instead of one placeholder cell) a code point expanded
  // to along the way — foldNonBmp's `map` plus rawTranslatePos's own remap is what keeps this
  // true; scrubUndefinedPos (document.mjs) then re-collapses the escape's own run of positions
  // to the single source index once more, for the replacement cell(s) it substitutes.
  const text = `a${LIGHT_BULB}b`;
  const res = louis.translatePos(text, louis.TABLES.uebG2);
  assert.ok(Array.isArray(res.inputPos) && res.inputPos.length > 0);
  for (const p of res.inputPos) assert.ok(p >= 0 && p < text.length, `inputPos entry ${p} out of range for ${JSON.stringify(text)}`);
});
