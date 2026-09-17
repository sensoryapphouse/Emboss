// A production note written as "[Transcriber's Note: …]" is brailled inside the UEB TN
// indicators without its print brackets and label, and without emphasis that covers the
// whole note (BANA Formats §3.2: the indicators mark the note; A27d).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const seen = [];
const o = (mode) => ({ mode, width: 40, depth: 25, translate: (s, tf) => { seen.push(tf); return up(s); }, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });

test('brackets and label are replaced by the TN indicators', () => {
  for (const mode of ['bana', 'ukaaf']) {
    const b = { type: 'note', text: "[Transcriber's Note: The diagram is magnified.]" };
    const lines = formatBlock(b, o(mode));
    assert.equal(lines.join(' ').trim(), '@.<THE DIAGRAM IS MAGNIFIED.@.>', mode);
    assert.deepEqual(traceBlock(b, o(mode)).map((t) => t.s), lines, `${mode}: trace matches`);
  }
});

test('italics covering the whole note are dropped; the trace points at the note text', () => {
  seen.length = 0;
  const b = { type: 'note', segments: [{ type: 'text', text: "[TN: The diagram is ", tf: 1 }, { type: 'text', text: 'magnified.]', tf: 1 }] };
  const lines = formatBlock(b, o('bana'));
  assert.equal(lines.join(' ').trim(), '@.<THE DIAGRAM IS MAGNIFIED.@.>');
  assert.ok(seen.every((tf) => !tf || !tf.some(Boolean)), 'no typeform passed to the translator');
  const traced = traceBlock(b, o('bana'));
  const line = traced[0];
  const i = line.s.indexOf('THE');
  assert.deepEqual(line.src[i], { u: 0, c: 5 }, 'first word maps past the removed "[TN: "');
});

test('a note without the print markers is unchanged; partial emphasis is kept', () => {
  assert.equal(formatBlock({ type: 'note', text: 'Plain note' }, o('bana')).join(' ').trim(), '@.<PLAIN NOTE@.>');
  seen.length = 0;
  formatBlock({ type: 'note', segments: [{ type: 'text', text: 'See ' }, { type: 'text', text: 'Figure 2', tf: 1 }] }, o('bana'));
  assert.ok(seen.some((tf) => tf && tf.some(Boolean)), 'partial emphasis still reaches the translator');
});
