// Stage directions (A27j): UKAAF B004 (K. Plays) encloses them in square brackets with no
// typeform indicators; BANA Formats §14.4.1a/c follows print (no added enclosures) and
// drops font attributes. Both use 7-7 margins here (BANA §14.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const o = (mode) => ({ mode, width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) });
const cases = [
  { b: { type: 'stage', text: 'He exits.' }, bana: 'HE EXITS.', ukaaf: '[HE EXITS.]' },
  { b: { type: 'stage', text: '[He exits.]' }, bana: '[HE EXITS.]', ukaaf: '[HE EXITS.]' },
  { b: { type: 'stage', text: '(aside)' }, bana: '(ASIDE)', ukaaf: '(ASIDE)' },
  { b: { type: 'stage', segments: [{ type: 'text', text: 'Laughing', tf: 1 }] }, bana: 'LAUGHING', ukaaf: '[LAUGHING]' },
];

for (const mode of ['bana', 'ukaaf']) {
  test(`${mode}: brackets follow the standard and the trace matches`, () => {
    for (const c of cases) {
      const lines = formatBlock(c.b, o(mode));
      assert.deepEqual(lines, [`      ${c[mode]}`], JSON.stringify(c.b));
      assert.deepEqual(traceBlock(c.b, o(mode)).map((t) => t.s), lines);
    }
  });
}
