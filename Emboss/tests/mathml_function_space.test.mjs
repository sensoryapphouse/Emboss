// Found 1 Oct 2026: Paul's A84 decision (D6, import fix list #31) put UEB's space between a subscript or superscript ending in a
// letter and a following function name ("a_n cos x": Guidelines for Technical Material 9.3.3; MathCAT spaces a function from a
// plain letter but not from one inside a script) — but only for Word equations (omml.mjs) and the .doc reader (mtef.mjs). The same
// equation from Markdown/LaTeX (<mo>cos</mo>), HTML, ODT, or retyped in the editor's maths field still brailled "A;5NCOS". The space
// is now added to any equation just before MathCAT (engine/maths.mjs, format/node-maths-helper.mjs), UEB only; Nemeth is unchanged
// (it joins a letter and a function abbreviation, IMP-W10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebFunctionSpaceInMathML } from '../input/omml.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const forms = {
  word: '<math><mrow><msub><mi>a</mi><mi>n</mi></msub><mspace width="0.3em"/><mi>cos</mi><mo>&#x2061;</mo><mi>x</mi></mrow></math>',
  mi: '<math><mrow><msub><mi>a</mi><mi>n</mi></msub><mi>cos</mi><mo>&#x2061;</mo><mi>x</mi></mrow></math>',
  latexMo: '<math><mrow><msub><mi>a</mi><mi>n</mi></msub><mo>cos</mo><mi>x</mi></mrow></math>',
  sup: '<math><mrow><msup><mi>e</mi><mi>x</mi></msup><mi>sin</mi><mo>&#x2061;</mo><mi>y</mi></mrow></math>',
};

test('UEB: every form of "a_n cos x" brailles with the space before the function; Nemeth is unchanged', () => {
  const ueb = makeMathToBrf('ukaaf'), nem = makeMathToBrf('bana');
  for (const k of ['word', 'mi', 'latexMo']) {
    assert.match(ueb(forms[k]), /^A;5N COS /, k);
    assert.equal(nem(forms[k]), nem(forms.word), k);
  }
  assert.match(ueb(forms.sup), /;9X S/);   // (MathCAT writes sin as S9, the 'in' groupsign, in every context: a question for KD)
  assert.doesNotMatch(makeMathToBrf('ukaaf')(forms.sup.replace('<mi>sin</mi>', '<mi>b</mi>')), /9X B/);   // not before an ordinary letter
});

test('the space is added only after a script ending in a letter, before a function name, and never twice', () => {
  assert.equal(uebFunctionSpaceInMathML(forms.word), forms.word);
  assert.match(uebFunctionSpaceInMathML(forms.mi), /<\/msub><mspace width="0\.3em"\/><mi>cos<\/mi>/);
  const digit = '<math><mrow><msub><mi>a</mi><mn>2</mn></msub><mi>cos</mi><mi>x</mi></mrow></math>';
  assert.equal(uebFunctionSpaceInMathML(digit), digit);
  const notFn = '<math><mrow><msub><mi>a</mi><mi>n</mi></msub><mi>b</mi></mrow></math>';
  assert.equal(uebFunctionSpaceInMathML(notFn), notFn);
});
