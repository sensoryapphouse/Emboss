// Gate for translatePos (cell→source-char map used by word/cell-level linking).
// Verifies against the real engine that the braille matches translate() exactly and
// that inputPos maps each cell back to the source character that produced it.
import path from 'path';
import * as louis from '../engine/louis.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// cells for a source char range [s,e)
const cellsFor = (braille, inputPos, s, e) => {
  const out = [];
  for (let j = 0; j < braille.length; j++) if (braille[j] !== ' ' && inputPos[j] >= s && inputPos[j] < e) out.push(j);
  return out;
};

for (const text of ['The quick brown fox', 'Chapter One', 'A short list', 'reading and writing']) {
  const { braille, inputPos } = louis.translatePos(text, T);
  ok(braille === louis.translate(text, T), `braille matches translate(): "${text}"`);
  ok(inputPos.length === braille.length, `inputPos length == braille length: "${text}"`);
  ok(inputPos.every((p) => p >= 0 && p <= text.length), `every inputPos in range: "${text}"`);
  // non-space cells are monotonic in source position (words map left→right)
  const ns = []; for (let j = 0; j < braille.length; j++) if (braille[j] !== ' ') ns.push(inputPos[j]);
  ok(ns.every((p, i) => i === 0 || p >= ns[i - 1]), `source positions non-decreasing: "${text}"`);
}

// "brown" (chars 10..15 of "The quick brown fox") maps to exactly the "BR[N" cells.
{
  const text = 'The quick brown fox';
  const { braille, inputPos } = louis.translatePos(text, T);
  const cells = cellsFor(braille, inputPos, 10, 15);
  const got = cells.map((j) => braille[j]).join('');
  ok(got === 'BR[N', `"brown" → cells "BR[N", got "${got}"`);
  // and none of those cells belong to a neighbouring word
  ok(cells.every((j) => inputPos[j] >= 10 && inputPos[j] < 15), '"brown" cells stay within the word');
}

// A contracted whole-word wordsign: "the" → one cell mapping back into [0,3).
{
  const { braille, inputPos } = louis.translatePos('the end', T);
  ok(braille.startsWith('!'), `"the" → wordsign "!" (got "${braille}")`);
  ok(inputPos[0] >= 0 && inputPos[0] < 3, '"the" cell maps into the word');
}

console.log(`\ncell-map gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
