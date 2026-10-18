// Audit batch S5b (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md, "Maths in Node checks differs from maths in the product"):
// the Node maths helper (format/node-maths-helper.mjs - used by the layout-parity check, the corpus and most tests) prepared and tidied
// MathCAT's braille differently from the browser wrapper (engine/maths.mjs - the product): a BANA equation lacked the Nemeth code-switch
// wrap, a matrix kept its 8-dot row marker (an `M`), an empty equation came out as a stray cell, a LaTeX segment was refused. Now every
// pure step is in engine/maths-core.mjs and the two wrappers differ only in how they load and call MathCAT.
//
// This file runs the browser wrapper in Node (tests/lib/browser-maths.mjs: its source with only the MathCAT bootstrap swapped) and the Node
// helper side by side on the same MathML, and requires the SAME braille (or the same kind of failure) from both. Agreement alone could hide a
// shared mistake, so several results are also pinned to reviewed expectations. The browser wrapper is the reference: its braille is what
// ships and these pins did not change with the refactor (they were taken from it before the shared module existed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserWrapper } from './lib/browser-maths.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';
import { formatDocument, formatDocumentAsync } from '../format/document.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const NS = 'xmlns="http://www.w3.org/1998/Math/MathML"';
const M = (inner, attrs = '') => `<math ${NS}${attrs}>${inner}</math>`;
const CASES = {
  number: M('<mn>42</mn>'),
  inline: M('<mi>x</mi><mo>+</mo><mn>2</mn><mo>=</mo><mn>5</mn>'),
  display: M('<mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup>', ' display="block"'),
  sqrt: M('<msqrt><mi>x</mi></msqrt>'),
  matrix: M('<mrow><mo>[</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo>]</mo></mrow>'),
  text: M('<mi>x</mi><mo>=</mo><mn>3</mn><mtext> for all </mtext><mi>y</mi>'),
  fragment: '<mi>x</mi><mo>+</mo><mn>1</mn>',                 // a bare editor fragment, no <math> wrapper
  empty: M('<mrow/>'),
  emptyBare: '<math/>',
  blank: '   ',
  rejected: M('<mfrac><mn>1</mn></mfrac>'),                    // MathCAT: "mfrac should have 2 children"
  notMathML: '<math><mi>x</mi>',                              // not well-formed
};
const MODES = [['bana', 'nemeth'], ['ukaaf', 'ueb']];          // [the Node helper's mode, the browser wrapper's mode]

const browser = await loadBrowserWrapper();
const inBrowser = (mathml, bmode) => browser.mathToBrf({ mathml }, bmode);
const outcome = (f) => { try { return { brf: f() }; } catch (e) { return { threw: true, rejected: e && e.mathRejected === true, message: String(e && e.message) }; } };

for (const [nmode, bmode] of MODES) {
  const node = makeMathToBrf(nmode);
  for (const [name, mathml] of Object.entries(CASES)) {
    test(`[${nmode}] ${name}: the Node helper and the browser wrapper give the same result`, () => {
      const b = outcome(() => inBrowser(mathml, bmode));
      const n = outcome(() => node({ mathml }));
      assert.deepEqual(n, b, `browser ${JSON.stringify(b)} vs node ${JSON.stringify(n)}`);
    });
  }
  test(`[${nmode}] a bare MathML string (the parity check's probe) and { mathml } are the same call`, () => {
    assert.equal(node(CASES.inline), node({ mathml: CASES.inline }));
  });
  test(`[${nmode}] a LaTeX-only segment goes through Temml in the Node helper as in the product`, () => {
    const viaBrowser = outcome(() => browser.latexToBrf('x+2=5', bmode, requireTemml()));
    const viaNode = outcome(() => node({ latex: 'x+2=5' }));
    assert.deepEqual(viaNode, viaBrowser);
    assert.ok(viaNode.brf && viaNode.brf.length > 0, JSON.stringify(viaNode));
  });
  test(`[${nmode}] a segment with neither MathML nor LaTeX fails the same plain way`, () => {
    assert.deepEqual(outcome(() => node({})), outcome(() => browser.mathToBrf({}, bmode)));
  });
}

import { createRequire } from 'node:module';
function requireTemml() { return createRequire(import.meta.url)('temml'); }

// ---- reviewed expectations (not just agreement) ----
// BRF ASCII; Nemeth in BANA is wrapped in the code-switch indicators `_% ` ... ` _:` (BANA "Nemeth Code within UEB Contexts", the product's
// choice, engine/maths-core.mjs NEMETH_OPEN/NEMETH_CLOSE). Each cell below was checked by hand against the Nemeth / UEB tables.
const PINNED = {
  bana: {
    number: '_% #42 _:',                         // numeric indicator #, 4 and 2 as lower-cell digits
    inline: '_% X+2 .K #5 _:',                   // x+2, space, comparison sign =, space, numeric indicator 5
    display: '_% ?1/2#+X^2 _:',                  // simple fraction opener ?, 1, /, 2, closer #, +, x, superscript indicator ^, 2
    sqrt: '_% >X] _:',                           // radical >, x, radical closer ]
    empty: '', emptyBare: '', blank: '',
  },
  ukaaf: {
    number: '#DB',                               // numeric indicator, 4, 2
    inline: 'X"6#B "7 #E',                       // x, plus, 2, space, equals, space, 5
    display: '#A/B"6X9#B',                       // numeric fraction 1/2, plus, x, superscript indicator, 2
    empty: '', emptyBare: '', blank: '',
  },
};
for (const [nmode, bmode] of MODES) {
  for (const [name, brf] of Object.entries(PINNED[nmode])) {
    test(`[${nmode}] ${name} is the reviewed braille, from both paths`, () => {
      assert.equal(makeMathToBrf(nmode)({ mathml: CASES[name] }), brf);
      assert.equal(inBrowser(CASES[name], bmode), brf);
    });
  }
}
test('[bana] a matrix: each row after the first starts a new braille line (audit E-1) and no 8-dot marker leaks as an M, from both paths', () => {
  for (const out of [makeMathToBrf('bana')({ mathml: CASES.matrix }), inBrowser(CASES.matrix, 'nemeth')]) {
    assert.equal(out, '_% ,@(#1 #2\n3 #4,@) _:');   // as shipped; see the report: the numeric indicator is not repeated on row 2 (S5B-Q1)
    assert.ok(!out.includes('M'));
  }
});
test('[ukaaf] a matrix has no row marker to clean and is the same from both paths', () => {
  assert.equal(makeMathToBrf('ukaaf')({ mathml: CASES.matrix }), inBrowser(CASES.matrix, 'ueb'));
});
test('a rejected equation throws a mathRejected failure from both paths in both codes; empty and whitespace-only ones never do', () => {
  for (const [nmode, bmode] of MODES) {
    for (const f of [(m) => makeMathToBrf(nmode)({ mathml: m }), (m) => inBrowser(m, bmode)]) {
      for (const bad of [CASES.rejected, CASES.notMathML]) {
        let err = null; try { f(bad); } catch (e) { err = e; }
        assert.ok(err && err.mathRejected === true, `${nmode}: ${bad}`);
      }
      for (const ok of [CASES.empty, CASES.emptyBare, CASES.blank]) assert.equal(f(ok), '');
    }
  }
});
// ---- the formatter sees the same thing whichever wrapper it is given ----
const up = (s) => String(s).toUpperCase();
const optsFor = (mode, mathToBrf) => ({
  mode, standard: mode, width: 40, depth: 25,
  translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
  mathToBrf,
});
const model = () => ({ title: null, blocks: [
  { type: 'para', segments: [{ type: 'text', text: 'SOLVE ' }, { type: 'math', mathml: CASES.inline }, { type: 'text', text: ' NOW' }] },
  { type: 'math', mathml: CASES.display },
  { type: 'para', text: 'AFTER' },
  { type: 'math', mathml: CASES.matrix },
  { type: 'math', mathml: CASES.empty },
] });
for (const [nmode, bmode] of MODES) {
  for (const [fname, fmt] of [['formatDocument', (m, o) => formatDocument(m, o)], ['formatDocumentAsync', (m, o) => formatDocumentAsync(m, o)]]) {
    test(`[${nmode}] ${fname}: a document with inline, display, matrix and empty maths is the same braille through either wrapper`, async () => {
      const a = await fmt(model(), optsFor(nmode, makeMathToBrf(nmode)));
      const b = await fmt(model(), optsFor(nmode, (seg) => browser.mathToBrf(seg, bmode)));
      assert.equal(a, b);
      assert.ok(a.includes('SOLVE') && a.includes('AFTER'));
    });
  }
}

// ---- one copy of each pure step ----
test('the two wrappers import the shared module and keep no copy of its steps', () => {
  for (const f of [['engine', 'maths.mjs'], ['format', 'node-maths-helper.mjs']]) {
    const src = fs.readFileSync(path.join(here, '..', ...f), 'utf8');
    assert.match(src, /maths-core\.mjs/, `${f.join('/')} imports maths-core.mjs`);
    assert.doesNotMatch(src, /function cleanMathCatBraille|const NEMETH_OPEN\s*=|NEMETH_ROW_SEP_RE\s*=|tidyMathMLForBraille\(/, `${f.join('/')} has no copy of the shared steps`);
  }
});
test('the shared module is in the build and in the service worker\'s pre-cache list', () => {
  const build = fs.readFileSync(path.join(here, '..', 'scripts', 'build-dist.mjs'), 'utf8');
  const sw = fs.readFileSync(path.join(here, '..', 'web', 'sw.js'), 'utf8');
  assert.match(build, /\['engine\/maths-core\.mjs', 'engine\/maths-core\.mjs'\]/);
  assert.match(sw, /'\/engine\/maths-core\.mjs'/);
});
