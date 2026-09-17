// BANA Formats §1.10.1: words are not divided at the end of a line — including inside a
// columnar table's cells (A27b). A squeezed column takes cells from roomier columns so its
// longest word fits; when that is impossible the table uses the listed format (BANA) /
// paragraph form (UKAAF) instead of splitting words mid-word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (mode, width) => ({ mode, width, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), listStyle: 'spaced' });
const words = (block) => [...(block.headers || []), ...block.rows.flat()].flatMap((c) => up(c).split(' '));

// A divided word shows up as a token that is a proper prefix of a source word (and is
// not itself a source word), e.g. "SUCROS" for "SUCROSE".
function brokenWords(lines, block) {
  const whole = new Set(words(block));
  const body = lines.join('\n').replace(/@\.<[\s\S]*?@\.>/g, ' ');       // transcriber's notes are generated text
  const tokens = body.split(/\s+/).map((t) => t.replace(/[:.,;]+$/, '')).filter((t) => t.length >= 2);
  return tokens.filter((t) => !whole.has(t) && [...whole].some((w) => w.length > t.length && w.startsWith(t)));
}

test('a spatial table whose words cannot all fit uses the fallback format instead of dividing words', () => {
  const block = {
    type: 'table', format: 'columnar',             // as a source marked class="bana-spatial"

    headers: ['Substance', 'Formula', 'Classification'],
    rows: [['Hydrochlorofluorocarbon', 'CHClF2 refrigerant gas', 'Ozone-depleting'], ['Polytetrafluoroethylene', 'C2F4 polymer', 'Fluoropolymer']],
  };
  for (const mode of ['bana', 'ukaaf']) {
    const lines = formatBlock(block, opts(mode, 30));
    assert.deepEqual(brokenWords(lines, block), [], `${mode}: ${JSON.stringify(lines)}`);
    assert.ok(lines.some((l) => l.includes('@.<')), `${mode}: fallback format with its transcriber's note: ${JSON.stringify(lines)}`);
    assert.deepEqual(traceBlock(block, opts(mode, 30)).map((t) => t.s), lines, `${mode}: trace matches`);
  }
});

test('a squeezed column borrows cells so its longest word stays whole', () => {
  const block = {
    type: 'table', format: 'columnar',
    headers: ['Name', 'Notes'],
    rows: [['Extraordinarily long name here', 'a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h']],
  };
  const lines = formatBlock(block, opts('bana', 30));
  assert.ok(lines.some((l) => l.startsWith('EXTRAORDINARILY ')), JSON.stringify(lines));
  assert.deepEqual(brokenWords(lines, block), [], JSON.stringify(lines));
  assert.deepEqual(traceBlock(block, opts('bana', 30)).map((t) => t.s), lines);
});
