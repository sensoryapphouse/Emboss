// ICON-1 (Paul, 28 Sep 2026; KD round-2 answer Q7e) / RUEB §3.26, BANA 17.5.1d, 2.5.2: a print
// character liblouis has no braille cell for (a pointing hand, a warning sign, a check box…) gets
// its own transcriber-defined print symbol in BANA mode — assigned in order of first appearance,
// reused on repeat, listed on the Special Symbols page with a description, and no longer raises the
// lou-undefined-char warning. UKAAF (UK-8: no Special Symbols page) keeps the old full-cell +
// warning behaviour unchanged. This file covers BMP characters only; a non-BMP emoji (e.g. the
// brief's own lightbulb 💡, U+1F4A1) is covered separately by tests/emoji_icons.test.mjs (A78) —
// engine/louis.mjs's/louis-browser.mjs's own foldNonBmp no longer pre-substitutes the full cell
// for one ahead of document.mjs's scrub layer, closing the gap this comment used to describe.
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

const POINTING_HAND = '☞';   // ☞ WHITE RIGHT POINTING INDEX
const WARNING_SIGN = '⚠';    // ⚠ WARNING SIGN
const CHECK_BOX = '☐';       // ☐ BALLOT BOX

const bana = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: rawTranslate, translatePos: rawTranslatePos, suppressHeader: true, ...extra });
const ukaaf = (extra) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: rawTranslate, translatePos: rawTranslatePos, suppressHeader: true, ...extra });
// The editor's own translate/translatePos wrapping (format/text-style.mjs), on top of the same
// raw liblouis calls, so this test exercises exactly what web/editor/editor.mjs hands document.mjs.
const bananEditor = (extra) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25,
  translate: styledTranslate(rawTranslate, 'faithful'), translatePos: styledTranslatePos(rawTranslatePos, 'faithful'),
  suppressHeader: true, ...extra });

const sympageLines = (brf) => brf.split('\n').filter((l) => l.trim().startsWith('.='));

test('two different icons get the first and second transcriber-defined symbols, in order of appearance', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `See ${WARNING_SIGN} first, then ${POINTING_HAND} second.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  assert.ok(!/\\X/i.test(brf), 'no raw liblouis escape ever reaches the BRF');
  // Warning sign was seen FIRST in the text, so it gets slot 1 (dots 1456 alone, grade 1 mode,
  // RUEB §3.26 — BRF ';?'); pointing hand, seen second, gets slot 2 (numeral sign + dots 1456,
  // BRF '#?') — not the other way around. The Special Symbols page entries themselves are the
  // cleanest place to check this (collectSpecialSymbols sorts by braille order, not first-use
  // order — see document.mjs's own comment — so the check is against each entry's own symbol,
  // not their position in the list).
  const lines = sympageLines(brf);
  const warn = lines.find((l) => /W>N\+ SIGN/.test(l));
  const point = lines.find((l) => /PO9T\+ H&/.test(l));
  assert.ok(warn && point, lines.join('\n'));
  assert.ok(warn.startsWith('.=;?'), warn);
  assert.ok(point.startsWith('.=#?'), point);
});

test('the same icon repeated reuses its symbol', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `First ${POINTING_HAND} use.` },
    { type: 'para', text: `Second ${POINTING_HAND} use, same icon.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  const occurrences = (brf.match(/;\?/g) || []).length;
  assert.equal(occurrences, 3, 'both body occurrences plus the one Symbols page entry use the same (first) symbol, not two different ones');
  assert.equal(sympageLines(brf).length, 2, 'dot locator + exactly one icon entry — not two');
});

test('the Symbols page lists both icons with descriptions (RUEB 2.5.2d: symbol, space, capitalised meaning)', () => {
  const o = bana();
  const model = { title: null, blocks: [
    { type: 'para', text: `A ${POINTING_HAND} and a ${CHECK_BOX}.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  const lines = sympageLines(brf);
  assert.equal(lines.length, 3, 'dot locator + two icons'); // .= itself, .=;? , .=.../@#?
  assert.ok(lines.some((l) => l.startsWith('.=;?') && /PO9T\+ H&/.test(l)), lines.join('\n'));   // "Pointing hand" (UEB G2 contracted)
  assert.ok(lines.some((l) => l.startsWith('.=#?') && /\*ECK BOX/.test(l)), lines.join('\n'));    // "Check box"
});

test('alt text wins over the Unicode name', () => {
  const o = bana({ iconAlt: { [POINTING_HAND]: 'tap here' } });
  const model = { title: null, blocks: [
    { type: 'para', text: `See ${POINTING_HAND}.` },
    { type: 'sympage', auto: true },
  ] };
  const brf = formatDocument(model, o);
  const lines = sympageLines(brf);
  assert.ok(lines.some((l) => /TAP "H/.test(l)), lines.join('\n'));   // "Tap here" (UEB G2), not "Pointing hand"
  assert.ok(!lines.some((l) => /PO9T\+ H&/.test(l)), lines.join('\n'));
});

test('no lou-undefined-char warning for a BANA icon; the character is byte-identical to a symbol, never an escape', () => {
  const o = bana();
  const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: `A ${WARNING_SIGN} here.` }] }, o);
  assert.ok(!/\\X/i.test(brf));
  assert.equal(o.untranslatable, undefined, 'the icon is handled as a symbol, not recorded as untranslatable');
  const kinds = (o.warnings || []).map((w) => w.kind);
  assert.ok(!kinds.includes('lou-undefined-char'), kinds);
});

test('UKAAF unchanged: the same icon still becomes the full cell, recorded on o.untranslatable, with the lou-undefined-char warning', () => {
  const o = ukaaf();
  const brf = formatDocument({ title: null, blocks: [{ type: 'para', text: `A ${WARNING_SIGN} here.` }] }, o);
  assert.ok(brf.includes('='), brf);
  assert.ok(!/\\X/i.test(brf));
  assert.deepEqual((o.untranslatable || []).map((e) => e.codePoint), [WARNING_SIGN.codePointAt(0)]);
  const kinds = (o.warnings || []).map((w) => w.kind);
  assert.ok(kinds.includes('lou-undefined-char'), kinds);
  assert.equal(o._iconSymbols, undefined, 'UKAAF never assigns an icon symbol at all');
});

test('editor path (formatDocumentAsync + translatePos, styledTranslate/styledTranslatePos wrapping) agrees exactly with the plain path', async () => {
  const model = { title: null, blocks: [
    { type: 'para', text: `See ${WARNING_SIGN} first, then ${POINTING_HAND} second, then ${WARNING_SIGN} again.` },
    { type: 'para', text: `And a ${CHECK_BOX}.` },
    { type: 'sympage', auto: true },
  ] };
  const oPlain = bana();
  const brfPlain = formatDocument(model, oPlain);
  const oEditor = bananEditor();
  const brfEditor = await formatDocumentAsync(model, oEditor);
  assert.equal(brfEditor, brfPlain, 'the editor (translatePos + text-style.mjs wrapping) path must braille identically to the plain formatDocument path');
  assert.ok(!(oEditor.warnings || []).some((w) => w.kind === 'lou-undefined-char'));
});

// The print asterism (BANA 1.9.5) already uses the first transcriber-defined symbol: icons start at the second.
test('ICON-1: with a print asterism in the document, the first icon takes the second symbol', async () => {
  const { formatDocument } = await import('../format/document.mjs');
  const louis = await import('../engine/louis.mjs');
  const pathMod = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const root = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..');
  await louis.init(pathMod.join(root, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2; const translate = (s, tf) => louis.translate(s, T, tf || null);
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'Before.' }, { type: 'break', kind: 'asterism' }, { type: 'para', text: 'See ☞ here.' }] };
  const brf = formatDocument(doc, { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate });
  const line = brf.split('\r\n').find((l) => /SEE/.test(l)) || '';
  assert.ok(/#\?/.test(line) && !/ ;\? /.test(line), `the icon uses the second symbol (#?), not the asterism's: ${line}`);
});
