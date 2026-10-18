// A39: buildDocPages/buildDocPagesAsync used to lay out every uncached block twice when
// o.translatePos was set (always, in the editor) — once via formatBlock for the BRF text,
// once via traceBlock for the cursor/source-offset map — even though traceBlock already
// computes the same lines as formatBlock as a side effect of building that map. They now
// lay a block out once: traceBlock's own lines become the formatted output when
// translatePos is on, and formatBlock only runs when it is off (or as a fallback if
// traceBlock itself throws). See document.mjs's "A39" comment at the buildDocPages /
// buildDocPagesAsync call site.
//
// That is only safe if traceBlock's `s` is byte-identical to formatBlock's line for every
// block type AND every side-channel the pagination code reads off the `lines` array — not
// just the visible text. Two real divergences were found and fixed while proving this:
//  - traceBlock had no 'dialogue' or 'code' case (fell through to a plain-paragraph
//    default), so a dialogue/code block's braille would have silently changed.
//  - formatListed (table listed-format, BANA Formats §11.16j) and formatFootnote (a note's
//    own separator line, §16.5.1a) tag their returned `lines` array with a non-enumerable
//    `.keepGroups` property that applyPageBoundaries reads to keep a table row / a note's
//    separator+first line together across a page break. It carries no visible text of its
//    own, so the `s`-only comparison below can't see it — traceTable/traceBlock's
//    'footnote' case must set the identical property, and buildDocPages must copy it onto
//    the `lines` array it derives from traceBlock's own array (a plain .map() does not
//    carry a non-enumerable property across). This test checks both: the visible lines AND
//    keepGroups, on a varied set of block types, plus a corpus-wide check documented in
//    scratchpad/fix-a39 (56512 real-book block comparisons across all 19 nimas_samples in
//    BANA+UKAAF, 0 mismatches; a full BRF+trace-map before/after diff across the same 38
//    (book,mode) combinations, 0 diffs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as louis from '../engine/louis.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const T1 = louis.TABLES.uebG1;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const translateG1 = (t) => louis.translate(t, T1, null);

// The Node-only headless maths engine (format/node-maths-helper.mjs), same one the corpus
// proof and format/test-corpus.mjs use — real MathCAT, not a stub. Skip the maths case if
// the wasm build isn't present rather than failing the whole file over an unrelated gap.
let mathToBrfBana = null, mathToBrfUkaaf = null;
try {
  const { makeMathToBrf } = await import('../format/node-maths-helper.mjs');
  mathToBrfBana = makeMathToBrf('bana');
  mathToBrfUkaaf = makeMathToBrf('ukaaf');
  // Smoke-test it: a build with no wasm artefact throws on first real use, not on import.
  mathToBrfBana('<math xmlns="http://www.w3.org/1998/Math/MathML"><mn>1</mn></math>');
} catch {
  mathToBrfBana = null; mathToBrfUkaaf = null;
}

function baseOpts(mode, extra = {}) {
  return {
    mode, standard: mode, width: 38, depth: 25,
    paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'spaced', toc: true,
    translate, translatePos, translateG1,
    mathToBrf: mode === 'bana' ? mathToBrfBana : mathToBrfUkaaf,
    ...extra,
  };
}

// Checks formatBlock(block) and traceBlock(block) agree on the visible lines AND on the
// keepGroups side-channel, in both modes — exactly what buildDocPages/buildDocPagesAsync
// now rely on to lay a block out only once.
function checkBlock(label, block, atStart = false, extraOpts = {}) {
  for (const mode of ['bana', 'ukaaf']) {
    const o = baseOpts(mode, extraOpts);
    const real = formatBlock(block, o, atStart);
    const traced = traceBlock(block, o, atStart);
    assert.equal(traced.length, real.length, `${label} (${mode}): line count`);
    for (let i = 0; i < real.length; i++) {
      assert.equal(traced[i].s, real[i], `${label} (${mode}): line ${i} text`);
    }
    assert.deepEqual(traced.keepGroups, real.keepGroups, `${label} (${mode}): keepGroups`);
  }
}

test('heading (levels 1-6, atStart true/false)', () => {
  for (let level = 1; level <= 6; level++) {
    checkBlock(`heading L${level} atStart`, { type: 'heading', level, text: `Heading Level ${level}` }, true);
    checkBlock(`heading L${level}`, { type: 'heading', level, text: `Heading Level ${level}` }, false);
  }
  checkBlock('heading with segments (bold)', { type: 'heading', level: 4, segments: [{ type: 'text', text: 'Bold ' }, { type: 'text', text: 'Heading', tf: 4 }] });
});

test('list (plain, bullet, compact)', () => {
  checkBlock('list plain', { type: 'list', items: [{ text: 'apples' }, { text: 'pears', level: 1 }] });
  checkBlock('list bullet', { type: 'list', items: [{ text: 'apples', marker: '•' }] });
  checkBlock('list compact', { type: 'list', items: [{ text: 'apples' }, { text: 'pears' }] }, false, { listStyle: 'compact' });
});

test('poem / verse', () => {
  checkBlock('poem lines array', { type: 'poem', lines: ['Line one', 'Line two', 'Line three'] });
  checkBlock('verse maxLevel', { type: 'verse', text: 'A line of verse', level: 1, maxLevel: 2 });
  checkBlock('play verse playVerse', { type: 'play', subtype: 'verse', text: 'Verse dialogue line', level: 1, maxLevel: 1, playVerse: true, style: 'dialogue' });
});

test('transcriber note', () => {
  checkBlock('note', { type: 'note', text: 'Transcriber note explaining a symbol.' });
});

test('box (plain text, nested blocks, title, hoisted table title)', () => {
  checkBlock('box text', { type: 'box', text: 'Plain boxed text.' });
  checkBlock('box title+heading child', { type: 'box', title: 'My Box', blocks: [{ type: 'heading', level: 2, text: 'My Box' }, { type: 'para', text: 'Body.' }] });
  checkBlock('box title no heading child', { type: 'box', title: 'Side Note', blocks: [{ type: 'para', text: 'Body text.' }] });
  checkBlock('box table title hoist', { type: 'box', blocks: [{ type: 'table', title: 'Hoisted Title', titlePosition: 'before-box', headers: ['A', 'B'], rows: [['1', '2']] }] });
});

test('table — spatial/listed/columnar/paragraph, and listed-format keepGroups (F-11.16j)', () => {
  const base = { headers: ['Name', 'Score'], rows: [['Alice', '10'], ['Bob', '200'], ['Carol', '3']] };
  for (const format of ['spatial', 'listed', 'columnar', 'paragraph', 'auto']) {
    checkBlock(`table ${format}`, { type: 'table', format, ...base });
  }
  // Listed format specifically must carry a per-row keepGroups on both sides (this is the
  // property a plain .map() drops — see document.mjs's A39 comment).
  const o = baseOpts('bana');
  const listedTable = { type: 'table', format: 'listed', ...base };
  const real = formatBlock(listedTable, o, false);
  const traced = traceBlock(listedTable, o, false);
  assert.ok(Array.isArray(real.keepGroups) && real.keepGroups.length === 3, 'formatBlock listed table has 3 row keepGroups');
  assert.deepEqual(traced.keepGroups, real.keepGroups, 'traceBlock mirrors the listed table keepGroups exactly');
});

test('footnote, including noteRunStart keepGroups (§16.5.1a)', () => {
  checkBlock('footnote plain', { type: 'footnote', text: 'Footnote body text goes here.' });
  checkBlock('footnote blocks', { type: 'footnote', blocks: [{ text: 'Opening para.' }, { text: 'Second para.' }] });
  checkBlock('footnote noteMark', { type: 'footnote', id: 'fn1', noteMark: 'a', text: 'Footnote body text.' });
  // BANA + noteRunStart puts a separator line first; formatFootnote tags [[0,1]] as a
  // keep-group so the separator can't be orphaned from the note's first body line.
  const o = baseOpts('bana');
  const fn = { type: 'footnote', noteRunStart: true, text: 'A footnote that starts a new note run.' };
  const real = formatBlock(fn, o, false);
  const traced = traceBlock(fn, o, false);
  assert.deepEqual(real.keepGroups, [[0, 1]], 'formatFootnote tags the separator+first-line keep-group');
  assert.deepEqual(traced.keepGroups, real.keepGroups, 'traceBlock mirrors the footnote keepGroups exactly');
});

test('line-numbered paragraph (A30)', () => {
  checkBlock('para linenum', { type: 'para', segments: [{ type: 'linenum', text: '2' }, { type: 'text', text: 'The second line.' }] });
  checkBlock('para linenum lnNote (first use)', { type: 'para', lnNote: true, segments: [{ type: 'linenum', text: '1' }, { type: 'text', text: 'The first line of the poem.' }] });
});

test('dialogue (A39 parity fix: traceBlock had no case, fell through to a bare paragraph)', () => {
  checkBlock('dialogue speaker+speech', { type: 'dialogue', speaker: 'HAMLET', speech: 'To be, or not to be.' });
  checkBlock('dialogue speech only', { type: 'dialogue', speech: 'Just speech, no speaker.' });
  checkBlock('dialogue empty', { type: 'dialogue' });
  checkBlock('dialogue with segments', { type: 'dialogue', style: 'dialogue', speaker: 'DR WHO', speech: 'ignored', segments: [{ type: 'text', text: 'DR WHO: ' }, { type: 'text', text: 'Hello there.' }] });
});

test('code (A39 parity fix: traceBlock had no case, dropped the grade-1 passage markers)', () => {
  checkBlock('code single line', { type: 'code', text: 'print(1)' });
  checkBlock('code multi line', { type: 'code', text: 'def f(x):\n    return x + 1\n\nprint(f(42))\n' });
  checkBlock('code long line wraps', { type: 'code', text: 'this is a very long single line of computer code that should wrap across more than one braille line at width 38' });
  checkBlock('code without translateG1 (falls back to translate)', { type: 'code', text: 'a\nb c' }, false, { translateG1: undefined });
});

test('maths (real headless MathCAT, when the wasm build is available)', { skip: !mathToBrfBana }, () => {
  checkBlock('math mathml', { type: 'math', mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>+</mo><mn>1</mn></math>' });
});

// "One layout path" task (Fable review recommendation 2): formatBlock is now a plain
// projection of traceBlock — lines = trace.map(t => t.s) — for the block types listed in
// ROUTED below. formatBlock/formatDocument/every headless test/gold never supply
// o.translatePos, so traceBlock (via tcRun) needs a no-positions mode that still produces
// the same braille from o.translate alone (see tcRun's no-positions branch in
// document.mjs). This checks that mode directly: traceBlock's own `.s` lines, called
// WITHOUT o.translatePos, equal the same call WITH o.translatePos — i.e. dropping the
// source-map bookkeeping never changes the braille.
test('traceBlock no-positions mode == traceBlock with translatePos (routed types)', () => {
  const ROUTED_BLOCKS = [
    { type: 'pagenum', number: '5' },
    { type: 'pagenum', spelled: 'five', number: '5' },
    { type: 'break' },
    { type: 'indicator', kind: 'dot2s' },
    { type: 'indicator', kind: 'line' },
    { type: 'indicator', text: 'Section break' },
    { type: 'blank' },
    { type: 'graphic', title: 'A simple diagram' },
    { type: 'tactile', title: 'A tactile diagram', lines: ['**  **', '  **  '] },
    ...(mathToBrfBana ? [{ type: 'math', mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi><mo>+</mo><mn>2</mn></math>' }] : []),
  ];
  for (const block of ROUTED_BLOCKS) {
    for (const mode of ['bana', 'ukaaf']) {
      const withPos = baseOpts(mode);
      const noPos = baseOpts(mode, { translatePos: undefined });
      const tracedWithPos = traceBlock(block, withPos, false).map((t) => t.s);
      const tracedNoPos = traceBlock(block, noPos, false).map((t) => t.s);
      assert.deepEqual(tracedNoPos, tracedWithPos, `traceBlock ${block.type} (${mode}): no-positions lines must match with-positions lines`);
      // And formatBlock (which now routes these types through traceBlock's no-positions
      // mode) must agree too.
      const real = formatBlock(block, noPos, false);
      assert.deepEqual(real, tracedWithPos, `formatBlock ${block.type} (${mode}): must equal traceBlock's with-positions lines`);
    }
  }
});
