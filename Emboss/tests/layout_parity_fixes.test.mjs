// Regression tests for the two formatBlock/traceBlock divergences found by
// scripts/check-layout-parity.mjs (Fable review #2) and fixed on 26 Sep 2026. Each case
// checks BOTH that the two layout paths agree line for line (what buildDocPages relies on:
// the editor shows traceBlock's lines, the tests and gold runner see formatBlock's) AND the
// braille itself, so a fix that made them agree on the wrong answer would still fail.
//
// 1. Spaces around an uncontracted " ... " run (BANA Sample 17-12, rule 17.10.2): the gold
//    braille is `,theater1 is great4 444 ,this play will`. traceBlock's cell trace re-ran
//    segmentsToBraille on the one uncontracted line, whose final boundary trim dropped the
//    run's own spaces (`great4444,this`), changing the line wrapping too. formatBlock was right.
// 2. A hyperlinked run inside a table cell, paragraph-form and listed tables (F-233 /
//    BANA 6.12.3.b(3); Paul's decision LINK-1, 25 Sep: imported hyperlinks get the first
//    transcriber-defined typeform, `@#7`...`@#'`). formatBlock's joinSegs / pushPlain merged
//    the linked run into its plain neighbours and dropped `hyperlink`; traceBlock (tcJoined,
//    via groupSegments, as for every paragraph) kept it. traceBlock was right.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { formatBlock, traceBlock } from '../format/document.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const T1 = louis.TABLES.uebG1;
const translate = (t, tf) => louis.translate(t, T, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
const translateG1 = (t) => louis.translate(t, T1, null);

const opts = (mode, extra = {}) => ({
  mode, standard: mode, width: 40, depth: 25,
  paragraphStyle: 'indented', tableFormat: 'auto', listStyle: 'spaced', toc: true,
  translate, translatePos, translateG1, ...extra,
});

// formatBlock and traceBlock agree (lines and keepGroups); returns formatBlock's lines.
function bothPaths(block, o) {
  const real = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false);
  assert.deepEqual(traced.map((t) => t.s), [...real], `${o.mode}: formatBlock vs traceBlock lines`);
  assert.deepEqual(traced.keepGroups ?? null, real.keepGroups ?? null, `${o.mode}: keepGroups`);
  return real;
}

// BANA Sample 17-12's review paragraph, exactly as scripts/gold-run.mjs builds it.
const review = {
  type: 'para',
  segments: [
    { type: 'text', text: 'The new play Pryde of the West, which openned last night at the Crown Theater, is great.', uncontracted: true },
    { type: 'text', text: ' ... ', uncontracted: true },
    { type: 'text', text: 'This play will be a big hit, and Ms. Lopez is going to become a star without equell.', uncontracted: true },
  ],
};
// Gold (tests/gold/bana-formats-2016/section-17/sample-17-12.json) braille.lines[9..13].
const REVIEW_GOLD = [
  ',the new play ,pryde of the ,west1 which',
  'openned last night at the ,crown',
  ',theater1 is great4 444 ,this play will',
  'be a big hit1 and ,ms4 ,lopez is going',
  'to become a star without equell4',
];

test('17-12: spaces around an uncontracted " ... " run kept in the trace path (both modes)', () => {
  for (const mode of ['bana', 'ukaaf']) {
    // Blocked (the gold's box paragraph starts in cell 1), so the wrapping matches the gold's own.
    const lines = bothPaths(review, opts(mode, { paragraphStyle: 'block' }));
    assert.deepEqual(lines.filter(Boolean).map((l) => l.toLowerCase()), REVIEW_GOLD, `${mode}: braille`);
  }
});

test('17-12: the same paragraph inside a box (the gold sample\'s own structure)', () => {
  const box = { type: 'box', blocks: [{ type: 'heading', level: 1, text: 'MARIA LOPEZ STARS IN NEW MUSICOL PLAY', segments: [{ type: 'text', text: 'MARIA LOPEZ STARS IN NEW MUSICOL PLAY', uncontracted: true }] }, review] };
  for (const mode of ['bana', 'ukaaf']) {
    const lines = bothPaths(box, opts(mode));
    assert.ok(lines.some((l) => l.includes(',THEATER1 IS GREAT4 444 ,THIS PLAY WILL')), `${mode}: spaced ellipsis line`);
  }
});

const cell = (segs) => ({ text: segs.map((s) => s.text).join(''), segments: segs });
const linkedTable = (headers) => ({
  type: 'table', headers,
  rows: [
    // A link mid-cell (custom-shape-tutorial.odt block #935's own shape) ...
    ['logheight', cell([{ type: 'text', text: 'The height as specified by the svg:height ' }, { type: 'text', text: '19.543', href: 'https://example.org/a', hyperlink: true }, { type: 'text', text: ' attribute is used.' }])],
    // ... and one whose plain text follows the link (must not be swallowed into it).
    ['logwidth', cell([{ type: 'text', text: 'See ' }, { type: 'text', text: 'the width', href: 'https://example.org/b', hyperlink: true }, { type: 'text', text: ' attribute.' }])],
  ],
});

test('hyperlink indicator on a linked run in a paragraph-form table cell (both modes)', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const lines = bothPaths({ ...linkedTable([]), format: 'paragraph' }, opts(mode));
    const text = lines.join('\n');
    assert.ok(text.includes("SVG;3HEI<T @#7#AI4EDC@#' ATTRIBUTE"), `${mode}: first link wrapped, plain text after it outside`);
    assert.ok(text.includes(",SEE @#7! WID?@#'"), `${mode}: second link wrapped, closed before the plain text`);
  }
});

test('hyperlink indicator on a linked run in a listed table cell with headings (both modes)', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const lines = bothPaths({ ...linkedTable(['Name', 'Meaning']), format: 'listed' }, opts(mode));
    const text = lines.join('\n');
    assert.ok(text.includes("SVG;3HEI<T @#7#AI4EDC@#' ATTRIBUTE"), `${mode}: first link wrapped`);
    assert.ok(text.includes(",SEE @#7! WID?@#' ATTRIBUTE4"), `${mode}: second link wrapped, closed before the plain text`);
  }
});

test('hyperlink in a table cell matches a paragraph with the same segments (consistency)', () => {
  const segs = linkedTable([]).rows[1][1].segments;
  for (const mode of ['bana', 'ukaaf']) {
    const para = bothPaths({ type: 'para', segments: segs }, opts(mode)).join(' ');
    assert.ok(para.includes(",SEE @#7! WID?@#' ATTRIBUTE4"), `${mode}: paragraph wraps the link the same way`);
  }
});
