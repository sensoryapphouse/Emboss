// K31 — BANA Formats §10.8.5 / §10.8.6 (March 2024 Updates, Updates_Braille_Formats_2016.txt):
//   10.8.5: "When a label is followed by a numbered item on the same line, move the numbered
//           item to the next line so all numbered items begin in the same cell. Keep the
//           label in cell 1." (Sample 10-8)
//   10.8.6: "When a label is followed by more than one sentence, each sentence begins in cell
//           1." (Sample 10-9; the March 2024 Update clarifies "the appropriate cell for the
//           applicable exercise" — cell 3 for a 1-5/3-5 exercise with numbered/lettered
//           directions, cell 1 otherwise.)
//
// The formatter already had the FIELDS for this (item.label/labelSegments/example,
// field-registry.mjs, "BANA 10.8") — formatList/traceBlock lay a labelled item's label on its
// own line and give it the 10.8.3 blank line before/after. What was missing was ever SETTING
// those fields from an item's own plain text: only gold-run.mjs's own gold-reconciliation
// script did it, splitting the label out of the print JSON before the model ever reached the
// formatter — a step real documents never get (no reader anywhere produces `label`/
// `labelSegments`/`example` — see field-registry.mjs's own "note").
//
// K31 moves the recognition into the formatter itself: document.mjs's deriveExerciseLabels,
// called from formatList and traceBlock in place of `block.items` (A39 parity — both must
// derive the same items). Recognition, in order of preference:
//   1. An explicit field already on the item (item.label/labelSegments/example) — set by a
//      reader or the editor — is always honoured as given and never touched here.
//   2. Failing that, a conservative text pattern: the item's own leading word(s) are "Example"
//      / "Model" / "Sample" (§10.8.1's "etc." covers reasonable compounds such as "Sample
//      Answer" through the same word set plus an "Answer" continuation, never a bare "Answer"
//      as the label that STARTS an example), optionally followed by a colon, AND the label is
//      followed by either a numbered/lettered item on the same line (10.8.5) or a further,
//      unlabelled, unnumbered item at the same level that continues the example (10.8.6). A
//      label with nothing after it to split is left exactly as given (both rules require a
//      continuation before the label moves to its own line).
//
// Every expected line below is taken from the quoted rule text above or from gold Samples
// 10-8 / 10-9 (Emboss/tests/gold/bana-formats-2016/section-10/{sample-10-8,sample-10-9}.json)
// — gold-run.mjs's own hand split is now removed (K31) and both samples match through this
// formatter code alone: `node Emboss/scripts/gold-run.mjs --section section-10`.
//
// Every test here FAILS against the pre-K31 document.mjs (no deriveExerciseLabels at all: an
// exercise item's text/segments pass through formatList/traceBlock completely unchanged, so a
// combined "EXAMPLE: 1. ..." item never splits and item.example is never set).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, formatDocument, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const banaOpts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const ukaafOpts = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const indent = (line) => line.length - line.replace(/^ +/, '').length;
// A39: formatBlock and traceBlock must produce identical lines for every block tested here.
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

describe('K31 / BANA 10.8.5 — a label followed by a numbered item on the same line', () => {
  test('splits the label onto its own line, in cell 1, before the numbered item (Sample 10-8)', () => {
    const block = { type: 'list', kind: 'exercise', items: [
      { level: 0, text: 'EXAMPLE: 1. The president lives in the white house.' },
    ] };
    const o = banaOpts();
    parity(block, o);
    const lines = clean(formatBlock(block, o));
    assert.deepEqual(lines, ['', 'EXAMPLE:', '1. THE PRESIDENT LIVES IN THE WHITE', '  HOUSE.', '']);
    assert.equal(indent(lines[1]), 0, 'the label stands in cell 1');
    assert.equal(indent(lines[2]), 0, 'the numbered item also begins in cell 1, not run on from the label');
  });

  test('does not split when nothing follows the label on the same item (no numbered item, no continuation)', () => {
    const block = { type: 'list', kind: 'exercise', items: [
      { level: 0, text: 'Example: this stays on one line.' },
    ] };
    const o = banaOpts();
    parity(block, o);
    assert.deepEqual(clean(formatBlock(block, o)), ['', 'EXAMPLE: THIS STAYS ON ONE LINE.', '']);
  });

  test('leaves an ordinary (non-exercise) list item alone even when its text looks like a label', () => {
    const block = { type: 'list', kind: 'list', items: [
      { level: 0, text: 'Example: 1. not exercise material' },
    ] };
    const o = banaOpts();
    parity(block, o);
    assert.deepEqual(clean(formatBlock(block, o)), ['', 'EXAMPLE: 1. NOT EXERCISE MATERIAL', '']);
  });

  // UK-5 (28 Sep, James / decisions.md "UKAAF"): 'compact' is now the UKAAF DEFAULT list style —
  // orthogonal to K31 (BANA-only exercise-label splitting), but the compact margins/no-blank-lines
  // would otherwise change this test's own expected layout, so `listStyle: 'spaced'` pins the
  // pre-UK-5 margins this test is actually checking.
  test('does not apply outside BANA mode', () => {
    const block = { type: 'list', kind: 'exercise', items: [
      { level: 0, text: 'EXAMPLE: 1. The president lives in the white house.' },
    ] };
    const o = ukaafOpts({ listStyle: 'spaced' });
    parity(block, o);
    assert.deepEqual(clean(formatBlock(block, o)), ['', 'EXAMPLE: 1. THE PRESIDENT LIVES IN THE', '  WHITE HOUSE.', '']);
  });
});

describe('K31 / BANA 10.8.6 — a label followed by more than one sentence', () => {
  test('each sentence begins in cell 1, formatting (bold/italic) carried through as segments (Sample 10-9)', () => {
    const block = { type: 'list', kind: 'exercise', items: [
      { level: 0, segments: [{ type: 'text', text: 'Example:', tf: 'b' }, { type: 'text', text: ' Ms. Ross are the seasons at the South Pole like ours?' }] },
      { level: 0, segments: [{ type: 'text', text: 'Ms. Ross, are the seasons at the South Pole like ours?', tf: 'i' }] },
      { level: 0, text: '7. No the seasons in Antarctica are the reverse of ours.' },
      { level: 0, text: '8. The continent as a matter of fact is like an enormous freezer.' },
    ] };
    const o = banaOpts();
    parity(block, o);
    const lines = clean(formatBlock(block, o));
    assert.deepEqual(lines, [
      '', 'EXAMPLE:',
      'MS. ROSS ARE THE SEASONS AT THE SOUTH', '  POLE LIKE OURS?',
      'MS. ROSS, ARE THE SEASONS AT THE SOUTH', '  POLE LIKE OURS?',
      '',
      '7. NO THE SEASONS IN ANTARCTICA ARE THE', '  REVERSE OF OURS.',
      '8. THE CONTINENT AS A MATTER OF FACT IS', '  LIKE AN ENORMOUS FREEZER.',
      '',
    ]);
    assert.equal(indent(lines[1]), 0, 'the label stands in cell 1');
    assert.equal(indent(lines[2]), 0, 'the first sentence begins in cell 1');
    assert.equal(indent(lines[4]), 0, 'the second sentence also begins in cell 1, not run on');
    // 10.8.3: a blank line separates the example from the numbered question that follows it,
    // once the example's own continuation sentences end (the numbered items are NOT part of it).
    assert.equal(lines[6], '', 'blank line after the example, before question 7');
  });

  test('the label survives being split off the item text: labelSegments keeps the original formatting (tf)', () => {
    const item = { level: 0, segments: [{ type: 'text', text: 'Model:', tf: 'b' }, { type: 'text', text: ' first sentence.' }], };
    const block = { type: 'list', kind: 'exercise', items: [item, { level: 0, text: 'second, unlabelled sentence.' }] };
    const o = banaOpts();
    const lines = clean(formatBlock(block, o));
    assert.deepEqual(lines, ['', 'MODEL:', 'FIRST SENTENCE.', 'SECOND, UNLABELLED SENTENCE.', '']);
  });
});

describe('K31 — explicit model fields (reader/editor-set) always win over the text pattern', () => {
  test('an item that already carries label/labelSegments/example is used exactly as given, not reprocessed', () => {
    const block = { type: 'list', kind: 'exercise', items: [
      { level: 0, text: 'the body only.', label: 'Ex.', example: true },
      { level: 0, text: 'more.' },
    ] };
    const o = banaOpts();
    parity(block, o);
    assert.deepEqual(clean(formatBlock(block, o)), ['', 'EX.', 'THE BODY ONLY.', '', 'MORE.', '']);
  });
});

describe('K31 / BANA 10.2.3 + 10.8.3 — the blank line between directions and exercise material', () => {
  test('is dropped for ordinary exercise material but kept when the exercise opens with an example', () => {
    const doc = { blocks: [
      { type: 'para', text: 'Mark the capitalization errors.', directions: true },
      { type: 'list', kind: 'exercise', items: [{ level: 0, text: 'EXAMPLE: 1. The president lives in the white house.' }] },
      { type: 'para', text: 'More directions.', directions: true },
      { type: 'list', kind: 'exercise', items: [{ level: 0, text: '1. plain question, no example label.' }] },
    ] };
    const o = banaOpts();
    const text = formatDocument(doc, o);
    const lines = text.split('\f')[0].split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
    const exampleAt = lines.indexOf('EXAMPLE:');
    assert.ok(exampleAt > 0, `expected an EXAMPLE: line: ${JSON.stringify(lines)}`);
    assert.equal(lines[exampleAt - 1], '', '10.8.3: directions keep their blank line before an example (overriding 10.2.3)');
    const plainAt = lines.findIndex((l) => l.includes('PLAIN QUESTION'));
    assert.ok(plainAt > 0, `expected the plain question line: ${JSON.stringify(lines)}`);
    assert.notEqual(lines[plainAt - 1], '', '10.2.3: no blank line between directions and ordinary exercise material');
  });
});
