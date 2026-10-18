// Paul's UKAAF decisions UK-1, UK-3, UK-4 (docs/decisions.md "UKAAF"; evidence and code locations in
// docs/diagnosis-ukaaf-and-page-count-26sep.md, causes 1, 3 and 5). UK-2 is explicitly "no change" and is
// not touched here.
//
// UK-1: the dot-2s end-marker (indicator line) B004's Glossary calls optional ("can be placed after a
//   section is complete") was previously emitted unconditionally before every level-1 UKAAF heading after
//   the first. Now off by default; a document option (`endMarkers`) turns it on for the whole document; a
//   block field (`endMarkerBefore`) turns it on for one chosen heading.
// UK-4 (bug-fix half): B004 doesn't call for a blank line between a heading and a sub-heading directly
//   under it (diagnosis cause 5, sample 2: "Ingredients" L1 immediately followed by "For the madeira cake:"
//   L3, gold has no blank line between them). `joinsWithoutBlank` (format/document.mjs) gains a UKAAF
//   branch; BANA's own, separately-documented heading-join tiers are unchanged.
// UK-3: `quoteStyle: 'exchange'` (web/settings.mjs) and `exchangeQuotes`/`styledTranslate`
//   (format/text-style.mjs) already implement "use the double quotation sign for all quotations" (RUEB
//   7.6.4). The missing piece was the automatic transcriber's note RUEB 7.6.4 requires ("Explain this
//   change in a transcriber's note") as an OFFERED suggestion (never placed on the TN page without the
//   transcriber's explicit Add — TP-4) via `suggestTranscriberNotes`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument, formatBlock, traceBlock, getBlockSignature, suggestTranscriberNotes } from '../format/document.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseDtbook } = await import('../input/parse.mjs');
const { exportToNimasXml } = await import('../input/nimas-export.mjs');

const upper = (s) => String(s).toUpperCase();
const tfTranslate = (s, tf) => (Array.isArray(tf) && tf.some(Boolean) ? `^${upper(s)}^` : upper(s));
const opts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: tfTranslate, listStyle: 'spaced', toc: false, ...extra });
const allLines = (brf) => brf.split('\x0c').flatMap((p) => { const a = p.split('\r\n'); a.pop(); return a; });
const INDICATOR = '"31111111111';   // indicatorLine('dot2s', ...) trimmed, see format/document.mjs
// UK-6 (28 Sep, James / decisions.md "UKAAF"): the chapter-end marker (`endMarkers`/`endMarkerBefore`)
// is now the COLONS form, not dot-2s — UK-1's original dot-2s choice is superseded. `docEndMarker: false`
// is passed in the tests below so the new UK-6 doc-end colons marker (on by default) doesn't also match
// this literal and inflate the count.
const CHAPTER_MARKER = '"33333333333';   // indicatorLine('colons', ...) trimmed

// ---------------------------------------------------------------------------------------------------------
// UK-1: end marker, off by default
// ---------------------------------------------------------------------------------------------------------
test('UK-1: UKAAF end marker is OFF by default — a non-first level-1 heading gets no indicator line', () => {
  const blocks = [
    { type: 'para', text: 'Intro.' },
    { type: 'heading', level: 1, text: 'First' },
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 1, text: 'Second' },
    { type: 'para', text: 'Body two.' },
  ];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true }));
  assert.ok(!allLines(brf).some((l) => l.trim() === INDICATOR), `no end-marker line by default: ${JSON.stringify(allLines(brf))}`);
});

test('UK-1: the document option endMarkers turns the indicator on for the whole document', () => {
  // First heading opens the document (nothing before it) — the existing atStart gate (unchanged by UK-1)
  // is what B004 Glossary's "nothing to close at the very top of a document" already relies on.
  const blocks = [
    { type: 'heading', level: 1, text: 'First' },
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 1, text: 'Second' },
    { type: 'para', text: 'Body two.' },
    { type: 'heading', level: 1, text: 'Third' },
    { type: 'para', text: 'Body three.' },
  ];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, endMarkers: true, docEndMarker: false }));
  const lines = allLines(brf).map((l) => l.trim());
  assert.equal(lines.filter((l) => l === CHAPTER_MARKER).length, 2, `one indicator before Second and one before Third, none before First: ${JSON.stringify(lines)}`);
  // never before the very first heading (B004 Glossary: nothing to close at the top of the document)
  const firstIdx = lines.indexOf(upper('First'));
  assert.ok(!lines.slice(0, firstIdx).includes(CHAPTER_MARKER));
});

test('UK-1: the block field endMarkerBefore turns the indicator on for one chosen heading only', () => {
  const blocks = [
    { type: 'para', text: 'Intro.' },
    { type: 'heading', level: 1, text: 'First' },
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 1, text: 'Second', endMarkerBefore: true },
    { type: 'para', text: 'Body two.' },
    { type: 'heading', level: 1, text: 'Third' },
    { type: 'para', text: 'Body three.' },
  ];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false }));
  const lines = allLines(brf).map((l) => l.trim());
  assert.equal(lines.filter((l) => l === CHAPTER_MARKER).length, 1, `exactly one indicator (before Second only): ${JSON.stringify(lines)}`);
  const markerIdx = lines.indexOf(CHAPTER_MARKER);
  assert.equal(lines[markerIdx + 1], upper('Second'));
});

test('UK-1: BANA is unaffected by endMarkers / endMarkerBefore', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'First' },
    { type: 'para', text: 'Body one.' },
    { type: 'heading', level: 1, text: 'Second', endMarkerBefore: true },
    { type: 'para', text: 'Body two.' },
  ];
  const withFlags = formatDocument({ blocks }, opts('bana', { suppressHeader: true, endMarkers: true }));
  const withoutFlags = formatDocument({ blocks: blocks.map((b) => ({ ...b, endMarkerBefore: undefined })) }, opts('bana', { suppressHeader: true }));
  assert.equal(withFlags, withoutFlags, 'BANA output must be byte-identical regardless of the UKAAF-only options');
  assert.ok(!allLines(withFlags).some((l) => l.trim() === INDICATOR));
});

test('UK-1: formatBlock and traceBlock agree on the new conditional indicator (A39 dual-path)', () => {
  for (const endMarkers of [false, true]) {
    for (const endMarkerBefore of [false, true]) {
      const block = { type: 'heading', level: 1, text: 'Second', ...(endMarkerBefore ? { endMarkerBefore: true } : {}) };
      const o = opts('ukaaf', { endMarkers });
      const real = formatBlock(block, o, false);
      const traced = traceBlock(block, o, false);
      assert.equal(traced.length, real.length, `endMarkers=${endMarkers} endMarkerBefore=${endMarkerBefore}: same line count`);
      traced.forEach((t, i) => assert.equal(t.s, real[i], `endMarkers=${endMarkers} endMarkerBefore=${endMarkerBefore} line ${i}: traceBlock drift`));
    }
  }
});

test('UK-1: getBlockSignature keys the endMarkers document option (blockCache correctness)', () => {
  const block = { type: 'heading', level: 1, text: 'Second' };
  const sigOff = getBlockSignature(block, opts('ukaaf', { endMarkers: false }), false);
  const sigOn = getBlockSignature(block, opts('ukaaf', { endMarkers: true }), false);
  assert.notEqual(sigOff, sigOn, 'endMarkers changes formatHeading output but was left out of the cache key');
});

test('UK-1: endMarkers (doc option) and endMarkerBefore (heading field) round-trip through NIMAS save/load', () => {
  const model = { title: 'T', endMarkers: true, blocks: [{ type: 'heading', level: 1, text: 'First' }, { type: 'para', text: 'Body.' }, { type: 'heading', level: 1, text: 'Second', endMarkerBefore: true }, { type: 'para', text: 'Body two.' }] };
  const xml = exportToNimasXml(JSON.parse(JSON.stringify(model)), { uid: 'ukaaf-uk1-test', date: '2026-01-01' });
  const back = parseDtbook(xml);
  assert.equal(back.endMarkers, true, 'doc option round-trips');
  const second = back.blocks.find((b) => b.type === 'heading' && b.text === 'Second');
  assert.equal(second && second.endMarkerBefore, true, 'per-heading field round-trips');
  const first = back.blocks.find((b) => b.type === 'heading' && b.text === 'First');
  assert.ok(!first || !first.endMarkerBefore, 'the other heading did not pick it up');
});

// ---------------------------------------------------------------------------------------------------------
// UK-4 (bug-fix half): no blank line between a heading and a sub-heading directly under it (UKAAF)
// ---------------------------------------------------------------------------------------------------------
test('UK-4: UKAAF — no blank line between a level-1 heading and a level-3 sub-heading directly under it', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Ingredients' },
    { type: 'heading', level: 3, text: 'For the madeira cake' },
    { type: 'para', text: 'Flour.' },
  ];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true }));
  const lines = allLines(brf).map((l) => l.trim());
  const h1 = lines.indexOf(upper('Ingredients'));
  assert.ok(h1 >= 0);
  assert.equal(lines[h1 + 1], upper('For the madeira cake'), `no blank line between the headings: ${JSON.stringify(lines)}`);
});

// UK-5 (28 Sep, James / decisions.md "UKAAF"): superseded by UK-5's blanket "no blank lines except
// before a sub-heading" default — a same-level (non-nested) level-1 heading pair is not a sub-heading,
// so it now gets NO blank line either, same as everything else UK-5 touches. Was "still keeps its
// blank line" under UK-4 alone; UK-5 flips the UKAAF default itself.
test('UK-4/UK-5: UKAAF — an unrelated (non-nested) level-1 heading pair now has no blank line either (UK-5 default)', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Ingredients' },
    { type: 'heading', level: 1, text: 'Method' },
    { type: 'para', text: 'Step one.' },
  ];
  const brf = formatDocument({ blocks }, opts('ukaaf', { suppressHeader: true, docEndMarker: false }));
  const lines = allLines(brf).map((l) => l.trim());
  const h1 = lines.indexOf(upper('Ingredients'));
  assert.ok(h1 >= 0);
  assert.equal(lines[h1 + 1], upper('Method'), `UK-5: no blank line between same-level headings either: ${JSON.stringify(lines)}`);
});

test('UK-4: BANA heading-join behaviour is unchanged by the UKAAF fix', () => {
  const blocks = [
    { type: 'heading', level: 1, text: 'Ingredients' },
    { type: 'heading', level: 3, text: 'For the madeira cake' },
    { type: 'para', text: 'Flour.' },
  ];
  const brf = formatDocument({ blocks }, { mode: 'bana', width: 40, depth: 25, translate: (t) => t, suppressHeader: true, toc: false });
  // Not asserting the exact translated text (translate is identity here) — only that the BANA blank-line
  // convention between L1 (centred) and L3 (cell-7) is untouched: a blank line still separates them.
  const lines = brf.split('\x0c')[0].split('\r\n');
  const h1 = lines.findIndex((l) => l.trim() === 'Ingredients');
  assert.ok(h1 >= 0);
  assert.equal(lines[h1 + 1].trim(), '', 'BANA still has its own blank line between a centred L1 and a cell-7 L3');
});

test('UK-4: two UKAAF list layouts already exist as the listStyle document option (B004 §10 Ex1/Ex2)', () => {
  const block = { type: 'list', items: [{ text: 'Flour' }, { text: 'Butter' }] };
  const spaced = formatBlock(block, opts('ukaaf', { listStyle: 'spaced' }), false);
  const compact = formatBlock(block, opts('ukaaf', { listStyle: 'compact' }), false);
  assert.ok(spaced.includes(''), 'B004 §10 Ex1 (spaced, the default): blank lines between items');
  assert.ok(!compact.includes(''), 'B004 §10 Ex2 (compact): no blank lines between items');
  assert.notDeepEqual(spaced, compact);
});

// ---------------------------------------------------------------------------------------------------------
// UK-3: quote exchange (RUEB 7.6.4) already exists; only the automatic TN suggestion was missing
// ---------------------------------------------------------------------------------------------------------
test('UK-3: no quote-exchange suggestion when quoteStyle is not exchange (default "faithful")', () => {
  const s = suggestTranscriberNotes([{ type: 'para', text: 'He said "hello".' }], opts('ukaaf'));
  assert.ok(!s.some((x) => x.id === 'quote-exchange'));
});

test('UK-3: suggestTranscriberNotes offers the RUEB 7.6.4 note when quoteStyle is exchange', () => {
  const s = suggestTranscriberNotes([{ type: 'para', text: 'He said "hello".' }], opts('ukaaf', { quoteStyle: 'exchange' }));
  const note = s.find((x) => x.id === 'quote-exchange');
  assert.ok(note, `expected a quote-exchange suggestion: ${JSON.stringify(s)}`);
  assert.match(note.reason, /7\.6\.4/, 'cites RUEB 7.6.4');
  assert.equal(note.provisional, note.source !== 'BANA');
});

test('UK-3: web/editor/editor.mjs threads settings.quoteStyle into the format options suggestTranscriberNotes reads', () => {
  const editor = fs.readFileSync(path.join(EMBOSS, 'web', 'editor', 'editor.mjs'), 'utf8');
  // the whole function (it grows: a fixed 2200-character slice missed the line once relaxed braille and the title option were added)
  const start = editor.indexOf('function currentFormatOpts');
  const fn = editor.slice(start, editor.indexOf('\n}\n', start) + 2);
  assert.match(fn, /quoteStyle:\s*settings\.quoteStyle/, 'currentFormatOpts() must pass quoteStyle through so suggestTranscriberNotes(buildModel().blocks, currentFormatOpts()) can see it');
});
