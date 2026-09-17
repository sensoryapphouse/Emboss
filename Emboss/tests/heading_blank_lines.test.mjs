// F-26 — BANA Braille Formats 2016 §4: `joinsWithoutBlank` (Emboss/format/document.mjs)
// used to drop the blank line before ANY heading that followed ANY other heading, with
// no check on either heading's tier. This exercises every heading-tier pair against the
// rules actually quoted in `references/_text/braille-formats-2016.txt` (lines 3124-3793)
// and recorded in `standards-findings.md` F-26 / `standards-map.md` (BANA 4.3.3, 4.4.1,
// 4.5.1, 4.5.5, 4.5.6, 4.5.7, 4.6.2, 4.6.6):
//
//   centred -> centred : NO blank — §4.3.3 "Do not insert a blank line between connected
//                         headings." (Examples 4-2/4-3/4-4: title+author, chapter
//                         number+title, unit number+title — each pair same-tier.)
//   cell-5  -> cell-5  : NO blank — §4.5.6 "A cell-5 heading may be followed by an
//                         equally important cell-5 heading, without a blank line
//                         between the two headings."
//   cell-5  -> cell-7  : NO blank — §4.5.7 "A cell-5 heading may be followed by a
//                         cell-7 heading, without an intervening blank line" / §4.6.2
//                         "Exception: There is no blank line between a cell-5 heading
//                         and cell-7 heading."
//   centred -> cell-5  : blank KEPT — §4.4.1 "A centered heading is preceded and
//                         followed by a blank line" (its three named exceptions —
//                         a related box, a TOC entry, an alphabetic division — do not
//                         name "followed by another heading") + §4.5.1 "Precede a
//                         cell-5 heading with a blank line" (unconditional).
//   centred -> cell-7  : blank KEPT — §4.4.1 (as above) + §4.6.2 "Precede a cell-7
//                         heading with a blank line" (its only exception names a
//                         PRECEDING cell-5 heading, not centred).
//   cell-5  -> centred : blank KEPT — §4.5.5 "A cell-5 heading cannot be followed by a
//                         centered heading" says this pairing does not occur in a
//                         well-formed document; if it appears anyway, no rule exempts
//                         it, so §4.4.1's default applies.
//   cell-7  -> centred,
//   cell-7  -> cell-5,
//   cell-7  -> cell-7  : blank KEPT — §4.6.6 "A cell-7 heading cannot be followed by a:
//                         Centered heading / Cell-5 heading / Cell-7 heading" names no
//                         exception either; the receiving tier's own default rule
//                         applies if it appears anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const upper = (s) => String(s).toUpperCase();
const upperPos = (s) => ({ braille: upper(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, translate: upper, suppressHeader: true, ...extra });

// Fixed level -> tier mapping when a document has <= 3 distinct heading levels
// (Formats §4.2.1-2, banaTier's own documented default): 1 = centred, 2 = cell-5,
// 3 = cell-7.
const TIER_LEVEL = { centred: 1, cell5: 2, cell7: 3 };

function joinLines(prevTier, nextTier) {
  const lines = formatDocument({ blocks: [
    { type: 'heading', level: TIER_LEVEL[prevTier], text: 'HeadOne' },
    { type: 'heading', level: TIER_LEVEL[nextTier], text: 'HeadTwo' },
    { type: 'para', text: 'Body text.' },
  ] }, opts()).split('\f')[0].split(/\r?\n/);
  const at = (t) => lines.findIndex((l) => l.trim() === t);
  return { lines, iOne: at('HEADONE'), iTwo: at('HEADTWO') };
}

const NO_BLANK = [
  ['centred', 'centred', 'BANA §4.3.3 (connected headings)'],
  ['cell5', 'cell5', 'BANA §4.5.6'],
  ['cell5', 'cell7', 'BANA §4.5.7 / §4.6.2 exception'],
];
const BLANK_KEPT = [
  ['centred', 'cell5', 'BANA §4.4.1 default + §4.5.1'],
  ['centred', 'cell7', 'BANA §4.4.1 default + §4.6.2'],
  ['cell5', 'centred', 'BANA §4.5.5 (disallowed pairing; §4.4.1 default applies)'],
  ['cell7', 'centred', 'BANA §4.6.6 (disallowed pairing; §4.4.1 default applies)'],
  ['cell7', 'cell5', 'BANA §4.6.6 (disallowed pairing; §4.5.1 default applies)'],
  ['cell7', 'cell7', 'BANA §4.6.6 (disallowed pairing; §4.6.2 default applies)'],
];

for (const [prevTier, nextTier, rule] of NO_BLANK) {
  test(`F-26: ${prevTier} -> ${nextTier} heading keeps NO blank line (${rule})`, () => {
    const { lines, iOne, iTwo } = joinLines(prevTier, nextTier);
    assert.ok(iOne >= 0 && iTwo >= 0, JSON.stringify(lines));
    assert.equal(iTwo, iOne + 1, `${prevTier} -> ${nextTier} should be adjacent (no blank): ${JSON.stringify(lines)}`);
  });
}

for (const [prevTier, nextTier, rule] of BLANK_KEPT) {
  test(`F-26: ${prevTier} -> ${nextTier} heading KEEPS its blank line (${rule})`, () => {
    const { lines, iOne, iTwo } = joinLines(prevTier, nextTier);
    assert.ok(iOne >= 0 && iTwo >= 0, JSON.stringify(lines));
    assert.equal(lines[iOne + 1], '', `${prevTier} -> ${nextTier} should have a blank line: ${JSON.stringify(lines)}`);
    assert.equal(iTwo, iOne + 2, `${prevTier} -> ${nextTier} should be separated by exactly one blank line: ${JSON.stringify(lines)}`);
  });
}

// Regression: the cases the previous (buggy) `joinsWithoutBlank` already got right must
// keep working once it is limited to the specific tier pairs above.
test('F-26 regression: §4.3.3 connected centred headings at document start still join with no blank', () => {
  const lines = formatDocument({ blocks: [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'heading', level: 1, text: 'Subtitle' },
    { type: 'para', text: 'Body.' },
  ] }, opts()).split('\f')[0].split(/\r?\n/);
  const at = (t) => lines.findIndex((l) => l.trim() === t);
  assert.equal(at('SUBTITLE'), at('TITLE') + 1, JSON.stringify(lines));
});

// formatBlock/traceBlock parity (see table_heading_placement.test.mjs): joinsWithoutBlank
// itself sits above formatBlock/traceBlock (it joins already-rendered block-level lines
// in formatDocument's own content-assembly loop, shared verbatim by both the sync and
// async document builders), but a heading's OWN rendering must still trace identically
// for every tier this finding touches, so a regression there cannot hide behind this fix.
test('F-26: formatBlock/traceBlock parity for every heading tier used above', () => {
  const o = { ...opts(), translatePos: upperPos };
  for (const level of [1, 2, 3]) {
    const block = { type: 'heading', level, text: 'Some Heading Text' };
    const formatted = formatBlock(block, o, false);
    const traced = traceBlock(block, o, false).map((t) => t.s);
    assert.deepEqual(traced, formatted, `level ${level} trace mirrors format: ${JSON.stringify({ formatted, traced })}`);
  }
});
