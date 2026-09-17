// Heading levels 4-6 survive load -> editor -> save -> braille, instead of collapsing
// to level 3 (the pre-existing `Math.min(3, …)` clamp in input/parse.mjs, editor.mjs and
// format/document.mjs). See input/parse.mjs's `walk` (DTBook), the DTBook `nearestLevelDepth`
// helper it adds, and format/document.mjs's `formatHeading` / `traceBlock` 'heading' case.
//
// Braille rules implemented for levels 4-6, read from the standards texts (see
// references/_text/):
//  BANA (braille-formats-2016.txt) §4.2.1: "When there are more than three distinct
//    heading levels in print, cell-7 headings are applied only to the lowest hierarchy
//    level; the use of centered headings is extended to one or more subsection levels as
//    necessary." §4.2.2: "The order of braille heading hierarchy is as follows: centered,
//    cell-5, cell-7." Formats defines no fourth margin treatment, so — keeping levels 1-3
//    exactly as already implemented (L1 centred, L2 cell-5, L3 cell-7; byte-identical is
//    required) — levels 4-6 use the one BANA tool left for "extending" the hierarchy:
//    the centred treatment, same as level 1 (§4.4.1-2).
//  UKAAF (B004.txt) Appendix A, "Good practice example of six heading levels":
//    "Level 4: Cell 1 heading with runovers in cell 5, preceded by a blank line. Use a
//     typeform indicator, such as bold." / "Level 5: Same as level 4, but without
//     typeform indicators." / "Level 6: Starting in cell 3 with runovers in cell 5. Use a
//     typeform indicator such as bold." Levels 1-3 there are renumbered for a book-length
//     document and conflict with the existing (§5, byte-identical-required) L1-3 scheme,
//     so only the L4-6 additions are applied, appended after the existing L3: L4/L5 share
//     L2's cell-1/runover-5 margins (L4 forced bold, L5 plain); L6 shares L3's
//     cell-3/runover-5 margins, forced bold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
const { parseDtbook } = await import('../input/parse.mjs');

// ---------------------------------------------------------------------------
// A stand-in translator (as tests/bana_nested_margins.test.mjs uses): uppercases
// the text and wraps it in ^ … ^ when ANY character carries a truthy typeform bit,
// so a test can see whether the heading's forced bold (forceBold in document.mjs)
// reached the translator without needing the real liblouis engine.
// ---------------------------------------------------------------------------
const upper = (s) => String(s).toUpperCase();
const tfTranslate = (s, tf) => (Array.isArray(tf) && tf.some(Boolean) ? `^${upper(s)}^` : upper(s));
const tfTranslatePos = (s, tf) => { const b = tfTranslate(s, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, s.length - 1)) }; };
const opts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: tfTranslate, translatePos: tfTranslatePos, listStyle: 'spaced', toc: false, ...extra });
const leading = (l) => l.length - l.replace(/^ +/, '').length;
const bodyLines = (brf) => brf.split(/\r?\n/).filter((l) => l.trim() && !/#[A-J]+$/.test(l.trim()) && !l.includes('\f'));

// =============================================================================
// 1) DTBook parsing: h1-h6, and a level4 > hd resolving to level 4.
// =============================================================================
test('DTBook: <h1>..<h6> survive as heading levels 1-6 (no Math.min(3, …) clamp)', () => {
  const xml = `<?xml version="1.0"?>
<book xmlns="http://www.daisy.org/z3986/2005/dtbook/">
<bodymatter>
<level1><h1>Level one</h1>
<level2><h2>Level two</h2>
<level3><h3>Level three</h3>
<level4><h4>Level four</h4>
<level5><h5>Level five</h5>
<level6><h6>Level six</h6><p>Deepest paragraph.</p></level6>
</level5></level4></level3></level2></level1>
</bodymatter>
</book>`;
  const model = parseDtbook(xml);
  const headings = model.blocks.filter((b) => b.type === 'heading');
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(headings.map((h) => h.text), ['Level one', 'Level two', 'Level three', 'Level four', 'Level five', 'Level six']);
});

test('DTBook: <hd> takes the depth of its nearest level1..level6 ancestor; <bridgehead> stays level 2', () => {
  const xml = `<?xml version="1.0"?>
<book xmlns="http://www.daisy.org/z3986/2005/dtbook/">
<bodymatter>
<level1><hd>Top hd (no ancestor level -> falls to 1)</hd>
<level4>
<hd>Nested generic heading</hd>
<p>Body text.</p>
<bridgehead>A bridgehead</bridgehead>
</level4>
</level1>
</bodymatter>
</book>`;
  const model = parseDtbook(xml);
  const headings = model.blocks.filter((b) => b.type === 'heading');
  // The outer <hd> sits directly inside <level1>, so it takes depth 1.
  assert.equal(headings[0].level, 1, `top hd under level1 -> level 1: ${JSON.stringify(headings)}`);
  // The nested <hd> sits inside <level4>, so it takes depth 4.
  assert.equal(headings[1].level, 4, `nested hd under level4 -> level 4: ${JSON.stringify(headings)}`);
  // <bridgehead> always stays level 2, regardless of ancestry.
  assert.equal(headings[2].level, 2, `bridgehead stays level 2: ${JSON.stringify(headings)}`);
});

// =============================================================================
// 2) BANA braille: levels 4-6 are centred, like level 1 (§4.2.1, §4.2.2, §4.4.1-2).
//    Levels 1-3 keep their existing centred / cell-5 / cell-7 treatment.
// =============================================================================
// Formats §4.2.1: with more than three distinct print levels, cell-7 is kept for the
// lowest level only (cell-5 for the next) and centred headings extend downwards —
// so a heading's tier depends on the document's deepest level, not its number alone.
const lineOf = (lines, word) => lines.find((l) => l.includes(word)) || '';
const centred = (line, w = 40) => {
  const lead = leading(line);
  const trail = w - line.length;
  return lead >= 3 && Math.abs(lead - Math.max(0, trail)) <= 1;
};

test('BANA: a document with six levels — h1-h4 centred, h5 cell-5, h6 cell-7 (§4.2.1)', () => {
  const brf = formatDocument({ blocks: [1, 2, 3, 4, 5, 6].flatMap((L) => [
    { type: 'heading', level: L, text: `Level${'ABCDEF'[L - 1]}` },
    { type: 'para', text: 'Some body text.' },
  ]) }, opts('bana'));
  const lines = brf.split(/\r?\n/);
  for (const L of [1, 2, 3, 4]) {
    const l = lineOf(lines, `LEVEL${'ABCDEF'[L - 1]}`);
    assert.ok(centred(l), `h${L} centred in a 6-level document: ${JSON.stringify(l)}`);
  }
  assert.equal(leading(lineOf(lines, 'LEVELE')), 4, 'h5 is the next-to-lowest level → cell 5');
  assert.equal(leading(lineOf(lines, 'LEVELF')), 6, 'h6 is the lowest level → cell 7');
});

test('BANA: sparse deep levels (h1, h2, h5) keep the three-tier mapping top-down', () => {
  const brf = formatDocument({ blocks: [
    { type: 'heading', level: 1, text: 'Topa' }, { type: 'para', text: 'x.' },
    { type: 'heading', level: 2, text: 'Midb' }, { type: 'para', text: 'x.' },
    { type: 'heading', level: 5, text: 'Lowc' }, { type: 'para', text: 'x.' },
  ] }, opts('bana'));
  const lines = brf.split(/\r?\n/);
  assert.ok(centred(lineOf(lines, 'TOPA')), 'h1 centred');
  assert.equal(leading(lineOf(lines, 'MIDB')), 4, 'h2 cell 5');
  assert.equal(leading(lineOf(lines, 'LOWC')), 6, 'h5 is the third distinct level → cell 7');
});

test('BANA: documents that stop at h3 are unchanged (h1 centred, h2 cell-5, h3 cell-7)', () => {
  const text = 'A Heading';
  const l2 = formatBlock({ type: 'heading', level: 2, text }, opts('bana'), false);
  const l3 = formatBlock({ type: 'heading', level: 3, text }, opts('bana'), false);
  assert.equal(leading(l2[1]), 4, `L2 blocked in cell 5: ${JSON.stringify(l2)}`);
  assert.equal(leading(l3[1]), 6, `L3 blocked in cell 7: ${JSON.stringify(l3)}`);
});

test('BANA: a centred extended level before a list keeps its blank line; the cell-7 level does not', () => {
  const brf = formatDocument({ blocks: [
    { type: 'heading', level: 1, text: 'Ha' }, { type: 'heading', level: 2, text: 'Hb' },
    { type: 'heading', level: 3, text: 'Hc' }, { type: 'para', text: 'x.' },
    { type: 'heading', level: 4, text: 'Section' },
    { type: 'list', items: [{ text: 'one' }, { text: 'two' }] },
    { type: 'heading', level: 5, text: 'Sub' }, { type: 'para', text: 'x.' },
    { type: 'heading', level: 6, text: 'Deepest' },
    { type: 'list', items: [{ text: 'three' }] },
  ] }, opts('bana'));
  const lines = brf.split(/\r?\n/);
  const s = lines.findIndex((l) => l.includes('SECTION'));
  assert.equal(lines[s + 1], '', `six levels: h4 is an extended centred level, so its blank line stays (§4.4.1): ${JSON.stringify(lines)}`);
  const d = lines.findIndex((l) => l.includes('DEEPEST'));
  assert.notEqual(lines[d + 1], '', `h6 is cell-7: no blank before its list (§4.5.3 / §8.3.3a): ${JSON.stringify(lines)}`);
});

// =============================================================================
// 3) UKAAF braille: Appendix A levels 4-6, appended after the existing L1-3.
// =============================================================================
test('UKAAF: level 5 shares level 2\'s cell-1/runover-5 margins and stays plain (no bold)', () => {
  const text = 'A Heading';
  const l2 = formatBlock({ type: 'heading', level: 2, text }, opts('ukaaf'), false);
  const l5 = formatBlock({ type: 'heading', level: 5, text }, opts('ukaaf'), false);
  assert.deepEqual(l5, l2, `App A L5 = L2 margins, no typeform: ${JSON.stringify(l5)} vs ${JSON.stringify(l2)}`);
  assert.ok(!l5.some((l) => l.includes('^')), `L5 carries no bold marker: ${JSON.stringify(l5)}`);
});

test('UKAAF: level 4 uses level 2\'s margins (cell 1 / runover 5) but forces bold', () => {
  const text = 'A Heading';
  const l4 = formatBlock({ type: 'heading', level: 4, text }, opts('ukaaf'), false);
  assert.equal(leading(l4[1]), 0, `L4 entry starts in cell 1: ${JSON.stringify(l4)}`);
  assert.ok(l4.some((l) => l.includes('^')), `L4 carries a bold marker: ${JSON.stringify(l4)}`);
});

test('UKAAF: level 6 uses level 3\'s margins (cell 3 / runover 5) but forces bold', () => {
  const text = 'A Heading';
  const l3 = formatBlock({ type: 'heading', level: 3, text }, opts('ukaaf'), false);
  const l6 = formatBlock({ type: 'heading', level: 6, text }, opts('ukaaf'), false);
  assert.equal(leading(l6[1]), leading(l3[1]), `L6 entry indent matches L3's cell 3: ${JSON.stringify(l6)} vs ${JSON.stringify(l3)}`);
  assert.ok(l6.some((l) => l.includes('^')), `L6 carries a bold marker: ${JSON.stringify(l6)}`);
  assert.ok(!l3.some((l) => l.includes('^')), `L3 (unchanged) carries no bold marker: ${JSON.stringify(l3)}`);
});

test('UKAAF: a bold override replaces any print emphasis already on the heading (forceBold)', () => {
  const seg = [{ type: 'text', text: 'plain then ' }, { type: 'text', text: 'italic', tf: 1 }];
  const l4 = formatBlock({ type: 'heading', level: 4, segments: seg, text: 'plain then italic' }, opts('ukaaf'), false);
  const joined = l4.join(' ');
  // Every segment (including the originally-plain one) is now bold-wrapped — forceBold
  // overrides tf on every non-math segment, it doesn't only add bold to already-emphasised
  // runs. segmentsToBraille translates adjacent text segments as one run with a typeform
  // array (A27a), so the whole heading is one bold run.
  assert.ok(/\^PLAIN THEN ITALIC\^/.test(joined), `originally-plain segment is now bold: ${joined}`);
  const seen = [];
  const rec = (str, tf) => { seen.push(tf); return tfTranslate(str, tf); };
  formatBlock({ type: 'heading', level: 4, segments: seg, text: 'plain then italic' }, opts('ukaaf', { translate: rec }), false);
  const tfs = seen.filter(Array.isArray).flat();
  assert.ok(tfs.length && tfs.every((b) => b === 4), `every character is bold and none italic: ${JSON.stringify(seen)}`);
  assert.equal((joined.match(/\^/g) || []).length, 2, `one bold run (two ^ markers) for the whole heading: ${joined}`);
});

// =============================================================================
// 4) traceBlock (cell-trace twin of formatBlock) matches formatBlock exactly for
//    every new level, in both modes — the invariant format/test-celltrace.mjs
//    checks for every other block type (no drift between the two code paths).
// =============================================================================
test('traceBlock matches formatBlock byte-for-byte for levels 4-6, both modes', () => {
  const text = 'Trace Me';
  for (const mode of ['bana', 'ukaaf']) {
    for (const L of [4, 5, 6]) {
      const block = { type: 'heading', level: L, text };
      const real = formatBlock(block, opts(mode), false);
      const traced = traceBlock(block, opts(mode), false);
      assert.equal(traced.length, real.length, `${mode} L${L}: same line count`);
      traced.forEach((t, i) => assert.equal(t.s, real[i], `${mode} L${L} line ${i}: traceBlock drift`));
    }
  }
});

// =============================================================================
// 5) formatDocument of h1-h3 is byte-identical to a snapshot taken from the
//    formatter BEFORE this change (git show HEAD of format/document.mjs, run with
//    the same stand-in translator, before any Math.min(3, …) clamp was touched).
// =============================================================================
test('formatDocument: level 1-3 headings are byte-identical to the pre-change snapshot', () => {
  const blocks = [
    { type: 'para', text: 'Intro paragraph before headings.' },
    { type: 'heading', level: 1, text: 'First Level Heading' },
    { type: 'para', text: 'Body under one.' },
    { type: 'heading', level: 2, text: 'Second Level Heading' },
    { type: 'para', text: 'Body under two.' },
    { type: 'heading', level: 3, text: 'Third Level Heading' },
    { type: 'para', text: 'Body under three.' },
  ];
  const snapshotOpts = (mode) => ({ mode, width: 30, depth: 25, translate: tfTranslate, listStyle: 'spaced', toc: false });

  // Captured via `git show HEAD:Emboss/format/document.mjs` (the commit this test
  // was added against) run through the same blocks/options, before formatHeading /
  // traceBlock / joinsWithoutBlank were touched for levels 4-6.
  const SNAPSHOT_BANA = '  INTRO PARAGRAPH BEFORE\r\nHEADINGS.\r\n\r\n     FIRST LEVEL HEADING\r\n\r\n  BODY UNDER ONE.\r\n\r\n    SECOND LEVEL HEADING\r\n  BODY UNDER TWO.\r\n\r\n      THIRD LEVEL HEADING\r\n  BODY UNDER THREE.\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n                            #A\r\n';
  const SNAPSHOT_UKAAF = '                            #A\r\n  INTRO PARAGRAPH BEFORE\r\nHEADINGS.\r\n\r\n         "31111111111\r\n     FIRST LEVEL HEADING\r\n  BODY UNDER ONE.\r\n\r\nSECOND LEVEL HEADING\r\n  BODY UNDER TWO.\r\n\r\n  THIRD LEVEL HEADING\r\n  BODY UNDER THREE.\r\n';

  assert.equal(formatDocument({ blocks }, snapshotOpts('bana')), SNAPSHOT_BANA, 'BANA h1-h3 output unchanged');
  assert.equal(formatDocument({ blocks }, snapshotOpts('ukaaf')), SNAPSHOT_UKAAF, 'UKAAF h1-h3 output unchanged');
});
