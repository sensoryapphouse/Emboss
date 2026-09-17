// F-40 / F-28 — BANA Braille Formats 2016 §4.4.3 (references/_text/braille-formats-2016.txt
// lines 3320-3330): "Headings should be balanced and divided at a logical location when
// longer than one line." Example 4-8 ("Balanced Centered Heading") is this rule's own
// worked illustration: "Using Natural Resources in the United States" divides as
// "USING NATURAL RESOURCES" / "IN THE UNITED STATES" — a break after the fourth word,
// NOT a greedy fill that would instead pack "...IN THE UNITED" onto line 1 and strand
// "STATES" alone on line 2.
//
// Before this fix, `centredBlock` (Emboss/format/document.mjs) wrapped a centred heading
// with the same plain greedy `wrapCells` used everywhere else in the formatter: word
// boundaries are respected ("logical location") but each line is packed as full as it
// will fit before moving on, so long headings are never "balanced". This tests the
// heading-only fix (`centredHeadingBlock` / `balancedWrapWidth`, and their trace mirror
// `tcCentredHeadingBlock`) against:
//   1. BANA's own Example 4-8, reproduced from `print.blocks` through the REAL liblouis
//      translator exactly as `gold-run.mjs` does, compared to
//      tests/gold/bana-formats-2016/section-4/example-4-8.json's `braille.lines` verbatim.
//   2. A synthetic case (a stand-in upper-case translator, so the arithmetic is checkable
//      by hand) whose expected split is derived independently by brute force below —
//      trying every valid word-boundary split into the minimum number of lines and
//      picking the one that minimizes the longest line — never by reading off whatever
//      Emboss's own code currently emits.
// Both include a formatBlock/traceBlock parity check (see table_heading_placement.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBlock, traceBlock } from '../format/document.mjs';
import { wrapCells } from '../format/layout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

const upper = (s) => String(s).toUpperCase();
const upperPos = (s) => ({ braille: upper(s), inputPos: Array.from(s, (_, i) => i) });

// --- 1. BANA Example 4-8, against the real gold braille -------------------------------

test('F-40: BANA Example 4-8 ("Using Natural Resources in the United States") divides at the logical, balanced break — matches the gold braille exactly', async () => {
  const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const TABLES = louis.TABLES.uebG2;
  const translate = (t, tf) => louis.translate(t, TABLES, tf || null);
  const translatePos = (t, tf) => {
    const b = translate(t, tf);
    return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, t.length - 1)) };
  };

  // print.blocks (example-4-8.json): {kind:'heading', level:1, text:'USING NATURAL
  // RESOURCES IN THE UNITED STATES'} — built exactly as gold-run.mjs's buildModel4 does.
  const block = { type: 'heading', level: 1, text: 'USING NATURAL RESOURCES IN THE UNITED STATES' };
  const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos };

  // Expected lines, taken verbatim from tests/gold/bana-formats-2016/section-4/
  // example-4-8.json's own `braille.lines`, upper-cased to match this project's BRF
  // ASCII convention (see table_spanning_headers.test.mjs's identical convention note).
  const expected = [
    '',
    '        ,,,us+ natural res\\rces',
    '           9 ! unit$ /ates,\'',
    '',
  ].map((l) => l.toUpperCase());

  const lines = formatBlock(block, o, false);
  assert.deepEqual(lines, expected, `formatBlock should match Example 4-8's gold braille: ${JSON.stringify(lines)}`);

  // The greedy wrap this replaces would instead strand "STATES" alone on line 2 (F-40's
  // own reproduction) — confirm the fix actually changed something, not just that the
  // gold comparison happens to already pass.
  const greedyLine2 = wrapCells(translate(block.text), 34, 0, 0).slice(-1)[0];
  assert.notEqual(greedyLine2.trim(), lines[2].trim(), 'sanity: plain greedy wrap would have produced a different (unbalanced) split');

  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, lines, `traceBlock should mirror formatBlock exactly: ${JSON.stringify({ lines, traced })}`);
});

// --- 2. Synthetic case: independently-derived balanced split ---------------------------

// Brute-force the "correctly balanced" split for a word list at a given width: the
// minimum number of lines wrapCells itself needs (never split a word, never exceed
// width), then, among every way to divide the words into exactly that many contiguous
// groups without exceeding the width, the one whose longest line is shortest (ties
// broken by lowest variance). This is an independent statement of BANA 4.4.3's
// "balanced... rather than divided arbitrarily" — not a read-off of Emboss's own output.
function bestBalancedSplit(words, width) {
  const k = wrapCells(words.join(' '), width, 0, 0).length;
  let best = null;
  const rec = (start, remaining, acc) => {
    if (remaining === 0) {
      const groups = [...acc, words.slice(start)];
      if (acc.length && start === words.length) return; // guard: last group would be empty
      const lens = groups.map((g) => g.join(' ').length);
      if (lens.some((l) => l > width) || lens.some((l) => l === 0)) return;
      const max = Math.max(...lens);
      const variance = lens.reduce((a, b) => a + (b - max) * (b - max), 0);
      if (!best || max < best.max || (max === best.max && variance < best.variance)) {
        best = { groups: groups.map((g) => g.join(' ')), max, variance };
      }
      return;
    }
    for (let i = start; i <= words.length - remaining; i++) {
      rec(i + 1, remaining - 1, [...acc, words.slice(start, i + 1)]);
    }
  };
  rec(0, k - 1, []);
  return best.groups;
}

test('F-40 synthetic: a heading whose greedy wrap would strand a short last group instead divides at the balanced break', () => {
  // Word lengths chosen (5,5,7,8,8,6) so greedy packs three-then-two words (28/15 cells,
  // wrapWidth 32) while an earlier break balances the two lines far better (19/24).
  const text = 'Alpha Betaa Gammaaa Deltaaaa Epsilonn Zetaaa';
  const words = text.toUpperCase().split(' ');
  const w = 38, wrapWidth = w - 6; // matches formatHeading's real BANA centred call

  const greedy = wrapCells(text.toUpperCase(), wrapWidth, 0, 0);
  assert.equal(greedy.length, 2, `sanity: this text needs exactly 2 lines at width ${wrapWidth}: ${JSON.stringify(greedy)}`);
  const greedyLens = greedy.map((l) => l.length);
  assert.deepEqual(greedyLens, [28, 15], `sanity: plain greedy wrap is unbalanced (28/15): ${JSON.stringify(greedy)}`);

  const balanced = bestBalancedSplit(words, wrapWidth);
  assert.deepEqual(balanced, ['ALPHA BETAA GAMMAAA', 'DELTAAAA EPSILONN ZETAAA'],
    `independently-derived balanced split: ${JSON.stringify(balanced)}`);
  const balancedLens = balanced.map((l) => l.length);
  assert.ok(Math.max(...balancedLens) < Math.max(...greedyLens),
    `balanced split's longest line (${Math.max(...balancedLens)}) must be shorter than greedy's (${Math.max(...greedyLens)})`);

  const block = { type: 'heading', level: 1, text };
  const o = { mode: 'bana', standard: 'bana', width: w, depth: 25, translate: upper, translatePos: upperPos };
  const lines = formatBlock(block, o, false);
  const trimmed = lines.map((l) => l.trim());
  assert.deepEqual(trimmed, ['', ...balanced, ''], `formatBlock should use the balanced split, not greedy: ${JSON.stringify(lines)}`);
  // Each line individually centred within the full page width (§4.4.1-2), same as
  // centredBlock's own convention.
  balanced.forEach((content, i) => {
    const pad = Math.max(0, Math.floor((w - content.length) / 2));
    assert.equal(lines[i + 1], ' '.repeat(pad) + content, `line ${i + 1} centred: ${JSON.stringify(lines)}`);
  });

  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, lines, `traceBlock should mirror formatBlock exactly: ${JSON.stringify({ lines, traced })}`);
});

test('F-40 regression: a heading that already fits on one line is unaffected', () => {
  const block = { type: 'heading', level: 1, text: 'Short Heading' };
  const o = { mode: 'bana', standard: 'bana', width: 38, depth: 25, translate: upper, translatePos: upperPos };
  const lines = formatBlock(block, o, false);
  assert.deepEqual(lines.map((l) => l.trim()), ['', 'SHORT HEADING', ''], JSON.stringify(lines));
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, lines, 'traceBlock mirrors formatBlock for a single-line heading too');
});
