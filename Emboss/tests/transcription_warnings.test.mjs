// Fable review #5 (Emboss/docs/fable-review-26sep.md): silent failures reach the braille with
// no sign to the user — a skipped block, a traceBlock fallback, a blanked/untranslatable
// character, a table layout fallback. The formatter now collects structured warnings on
// `opts.warnings` ({ kind, blockIndex, blockType, message, snippet, ... }) alongside the
// existing `opts.untranslatable` (F-213) channel — never changing the braille itself. These
// tests force each warning kind and assert both the warning shape AND that the braille is
// byte-identical to what the formatter would produce without the warnings channel (or, for a
// truly skipped block, identical to the document with that block simply removed — exactly
// what formatBlock's own `return []` already did before this change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatDocumentAsync } from '../format/document.mjs';

const up = (s) => String(s || '').toUpperCase();
const baseOpts = (extra) => ({ mode: 'bana', width: 30, depth: 25, translate: up, ...extra });

test('block-skipped: a block whose formatter throws is dropped with a structured warning, braille otherwise unchanged', () => {
  const badItem = { type: 'list', kind: 'unordered', items: [{ segments: 'not-an-array' }] };
  const withBad = { title: 'T', blocks: [{ type: 'para', text: 'before' }, badItem, { type: 'para', text: 'after' }] };
  const withoutBad = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'para', text: 'after' }] };
  const opts1 = baseOpts();
  const brfWithBad = formatDocument(withBad, opts1);
  const opts2 = baseOpts();
  const brfWithoutBad = formatDocument(withoutBad, opts2);
  assert.equal(brfWithBad, brfWithoutBad, 'a skipped block must braille exactly as if it were absent');
  assert.equal(opts1.warnings.length, 1);
  const w = opts1.warnings[0];
  assert.equal(w.kind, 'block-skipped');
  assert.equal(w.blockIndex, 1);
  assert.equal(w.blockType, 'list');
  assert.ok(w.message && w.message.length, 'carries the underlying error message');
});

test('block-skipped: an equation whose maths engine throws is dropped with a warning (formatMath/traceTable math case)', () => {
  const mathToBrf = () => { throw new Error('maths engine exploded'); };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'math', latex: 'x^2' }, { type: 'para', text: 'after' }] };
  const opts = baseOpts({ mathToBrf });
  const brf = formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  assert.equal(opts.warnings[0].kind, 'block-skipped');
  assert.equal(opts.warnings[0].blockIndex, 1);
  assert.match(brf, /BEFORE/);
  assert.match(brf, /AFTER/);
});

test('trace-fallback: traceBlock throwing falls back to formatBlock silently in the braille, but is recorded', () => {
  const translatePos = () => { throw new Error('translatePos-boom'); };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'before' }, { type: 'para', text: 'traced text' }] };
  const optsPlain = baseOpts();
  const brfPlain = formatDocument(doc, optsPlain);
  const optsTraced = baseOpts({ translatePos });
  const brfTraced = formatDocument(doc, optsTraced);
  assert.equal(brfTraced, brfPlain, 'the braille from the traceBlock fallback must match formatBlock exactly');
  assert.equal(optsTraced.warnings.length, 2, 'one per block, since every traceBlock call fails here');
  for (const w of optsTraced.warnings) {
    assert.equal(w.kind, 'trace-fallback');
    assert.equal(w.message, 'translatePos-boom');
  }
  assert.deepEqual(optsTraced.warnings.map((w) => w.blockIndex), [0, 1]);
});

// ICON-1 (Paul, 28 Sep 2026): BANA now turns a character like this one into its own
// transcriber-defined print symbol instead of the full cell (Emboss/tests/print_icons.test.mjs
// covers that), so this generic "the scrub mechanism itself works" test — not about icons, just
// about the escape -> full-cell/warning channel — is forced to UKAAF mode (UK-8: no Special
// Symbols page there, so the pre-ICON-1 full-cell + warning behaviour is unchanged) to keep
// exercising exactly what it always has.
test('lou-undefined-char: liblouis\'s undefined-character escape is scrubbed to a full cell and counted (UKAAF)', () => {
  const translateLou = (s) => {
    const t = String(s || '');
    return t.includes('shape') ? t.toUpperCase().replace(/shape/i, "'\\X2764'") : t.toUpperCase();
  };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'A shape word.' }] };
  const opts = baseOpts({ translate: translateLou, mode: 'ukaaf', standard: 'ukaaf' });
  const brf = formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  const w = opts.warnings[0];
  assert.equal(w.kind, 'lou-undefined-char');
  assert.equal(w.blockIndex, 0);
  assert.equal(w.count, 1);
  assert.deepEqual(w.chars, ['❤']);
  assert.ok(brf.includes('='), 'the undefined character becomes the full-cell placeholder, never a raw escape');
  assert.ok(!brf.includes('\\X'), 'no raw liblouis escape ever reaches the BRF');
  // Matches the pre-existing F-213 channel exactly (same event, two views of it).
  assert.equal(opts.untranslatable.length, 1);
  assert.equal(opts.untranslatable[0].codePoint, 0x2764);
});

test('lou-undefined-char + translatePos: an undefined-character escape discards the provisional traceBlock pass exactly once (not double-counted) (UKAAF — ICON-1, 28 Sep 2026: BANA would make this an icon symbol instead)', () => {
  // Regression: buildDocPages/Async deliberately distrusts traceBlock's own output whenever
  // it scrubbed an undefined-character escape (the LOU_UNDEFINED_CHAR_RE safety net) and
  // reformats the block with formatBlock instead — so a naive per-scrub-call counter would see
  // the character twice (once from the discarded traceBlock pass, once from the authoritative
  // formatBlock pass). The count must reflect the one character actually in the source text,
  // and the discarded pass is itself worth a trace-fallback warning (editor cell-linking
  // degrades for that block even though the braille is correct either way).
  const translateLou = (s) => {
    const t = String(s || '');
    return t.includes('shape') ? t.toUpperCase().replace(/shape/i, "'\\X2764'") : t.toUpperCase();
  };
  const translatePosLou = (s) => ({ braille: translateLou(s), inputPos: Array.from(String(s), (_, i) => i) });
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'A shape word.' }] };
  const opts = baseOpts({ translate: translateLou, translatePos: translatePosLou, mode: 'ukaaf', standard: 'ukaaf' });
  formatDocument(doc, opts);
  const byKind = Object.fromEntries(opts.warnings.map((w) => [w.kind, w]));
  assert.equal(opts.warnings.length, 2);
  assert.equal(byKind['trace-fallback'].blockIndex, 0);
  assert.equal(byKind['lou-undefined-char'].count, 1);
  assert.deepEqual(byKind['lou-undefined-char'].chars, ['❤']);
});

test('blanked-char: a tactile-graphic raster row with a non-BRF character is blanked and counted (toBrfCells)', () => {
  const doc = { title: 'T', blocks: [{ type: 'graphic', title: 'diagram', lines: ['*1*', 'zz*'] }] };
  const opts = baseOpts();
  formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  const w = opts.warnings[0];
  assert.equal(w.kind, 'blanked-char');
  assert.equal(w.blockIndex, 0);
  assert.equal(w.count, 2);       // two 'z' characters on the second row
  assert.deepEqual(w.chars, ['z']);
});

test('table-fallback: a chosen layout that cannot be used falls back to Listed (BANA), and is recorded', () => {
  const wideTable = {
    type: 'table',
    format: 'columnar',
    headers: ['Column One Is Very Long', 'Column Two Is Also Long', 'Column Three Long Too'],
    rows: [['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'], ['dddddddddd', 'eeeeeeeeee', 'ffffffffff']],
  };
  const doc = { title: 'T', blocks: [wideTable] };
  const opts = baseOpts({ width: 30 });
  const brf = formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  const w = opts.warnings[0];
  assert.equal(w.kind, 'table-fallback');
  assert.equal(w.blockIndex, 0);
  assert.equal(w.requestedMode, 'columnar');
  assert.equal(w.resolvedLayout, 'listed');
  assert.match(brf, /PRINT FORMAT IS/);   // the Listed-table transcriber's note (F-x, BANA §11.9)

  // 'auto' falling to Listed is the rule working (BANA §11.9), not a warning.
  const docAuto = { title: 'T', blocks: [{ ...wideTable, format: undefined }] };
  const optsAuto = baseOpts({ width: 30 });
  formatDocument(docAuto, optsAuto);
  assert.equal(optsAuto.warnings.length, 0);

  // An explicit Listed request is NOT a fallback — no warning.
  const doc2 = { title: 'T', blocks: [{ ...wideTable, format: 'listed' }] };
  const opts2 = baseOpts({ width: 30 });
  formatDocument(doc2, opts2);
  assert.equal(opts2.warnings.length, 0);

  // A table that fits columnar produces no warning either.
  const doc3 = { title: 'T', blocks: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }] };
  const opts3 = baseOpts({ width: 30 });
  formatDocument(doc3, opts3);
  assert.equal(opts3.warnings.length, 0);
});

test('table-fallback: the same check fires on the traceTable (editor cell-linking) path', () => {
  const wideTable = {
    type: 'table',
    format: 'columnar',
    headers: ['Column One Is Very Long', 'Column Two Is Also Long', 'Column Three Long Too'],
    rows: [['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc']],
  };
  const doc = { title: 'T', blocks: [wideTable] };
  const translatePos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
  const opts = baseOpts({ width: 30, translatePos });
  formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  assert.equal(opts.warnings[0].kind, 'table-fallback');
});

test('an ordinary, well-formed document produces no warnings at all', () => {
  const doc = { title: 'T', blocks: [{ type: 'heading', text: 'Chapter One', level: 1 }, { type: 'para', text: 'All is well.' }, { type: 'list', kind: 'unordered', items: [{ text: 'One' }, { text: 'Two' }] }] };
  const opts = baseOpts();
  formatDocument(doc, opts);
  assert.deepEqual(opts.warnings, []);
});

// ICON-1 (Paul, 28 Sep 2026): UKAAF, same reason as the two lou-undefined-char tests above — BANA
// would now make this an icon symbol, not a warning.
test('warnings survive the block cache unchanged (editor re-render reusing opts.blockCache) (UKAAF)', () => {
  const translateLou = (s) => {
    const t = String(s || '');
    return t.includes('shape') ? t.toUpperCase().replace(/shape/i, "'\\X2764'") : t.toUpperCase();
  };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'A shape word.' }] };
  const blockCache = new Map();
  const opts1 = baseOpts({ translate: translateLou, blockCache, mode: 'ukaaf', standard: 'ukaaf' });
  const brf1 = formatDocument(doc, opts1);
  const opts2 = baseOpts({ translate: translateLou, blockCache, mode: 'ukaaf', standard: 'ukaaf' });
  const brf2 = formatDocument(doc, opts2);
  assert.equal(brf1, brf2);
  assert.deepEqual(opts1.warnings, opts2.warnings);
  assert.equal(opts2.warnings.length, 1);
  assert.equal(opts2.warnings[0].kind, 'lou-undefined-char');
});

test('async formatting (formatDocumentAsync, used by the editor) collects the same warnings', async () => {
  const badItem = { type: 'list', kind: 'unordered', items: [{ segments: 'not-an-array' }] };
  const doc = { title: 'T', blocks: [{ type: 'para', text: 'before' }, badItem, { type: 'para', text: 'after' }] };
  const opts = baseOpts();
  const brf = await formatDocumentAsync(doc, opts);
  assert.equal(opts.warnings.length, 1);
  assert.equal(opts.warnings[0].kind, 'block-skipped');
  assert.match(brf, /BEFORE/);
  assert.match(brf, /AFTER/);
});

// A65: an inline equation the maths engine rejects is left out of the braille; that is now a
// warning too (once per block, even when both layout paths run for it).
test('block-skipped (inline): a rejected inline equation is reported once, in both layout paths', async () => {
  const mathToBrf = () => { throw new Error('maths engine exploded'); };
  const doc = { title: 'T', blocks: [{ type: 'para', segments: [{ type: 'text', text: 'See ' }, { type: 'math', latex: 'x^2' }, { type: 'text', text: ' here.' }] }] };
  const opts = baseOpts({ mathToBrf });
  formatDocument(doc, opts);
  assert.equal(opts.warnings.length, 1);
  assert.equal(opts.warnings[0].kind, 'block-skipped');
  assert.equal(opts.warnings[0].inline, true);
  assert.equal(opts.warnings[0].blockIndex, 0);
  const translatePos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
  const opts2 = baseOpts({ mathToBrf, translatePos });
  await formatDocumentAsync(doc, opts2);
  assert.equal(opts2.warnings.filter((w) => w.kind === 'block-skipped').length, 1);
});

// A64: a block whose segments are not an array must not stop the whole document.
test('a block with malformed segments does not stop the conversion', () => {
  const doc = { title: 'T', blocks: [{ type: 'heading', level: 1, segments: 'not-an-array' }, { type: 'para', text: 'after' }] };
  const opts = baseOpts();
  const brf = formatDocument(doc, opts);
  assert.match(brf, /AFTER/);
});
