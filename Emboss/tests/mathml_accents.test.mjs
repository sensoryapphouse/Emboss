// Import fix list #44 (audit lo-odt-w14-vec, 1 Oct 2026): a vector arrow (or hat, tilde, bar, dot) written as a COMBINING
// character in an <mo> — as LibreOffice's equations (ODT), MathML in HTML/EPUB/DTBook and some MathType files give it — brailled
// as a hex escape ("0020D7"): MathCAT has no braille for the combining form. D7 fixed this for Word equations in omml.mjs (the
// spacing character MathML uses for the same accent: vector arrow -> U+2192, hat -> ^ ...). The same mapping is now applied to
// every equation just before MathCAT (engine/maths.mjs, format/node-maths-helper.mjs), whichever reader it came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spacingAccentsInMathML } from '../input/omml.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const ODT_VEC = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mover accent="true"><mi>v</mi><mo stretchy="true">⃗</mo></mover></math>';

test('#44: a combining accent alone in an <mo> becomes its spacing form; anything else is untouched', () => {
  assert.equal(spacingAccentsInMathML(ODT_VEC), ODT_VEC.replace('⃗', '→'));
  assert.equal(spacingAccentsInMathML('<mover><mi>x</mi><mo>&#x302;</mo></mover>'), '<mover><mi>x</mi><mo>^</mo></mover>');
  assert.equal(spacingAccentsInMathML('<mover><mi>x</mi><mo>&#8407;</mo></mover>'), '<mover><mi>x</mi><mo>→</mo></mover>');
  const plain = '<mrow><mi>a</mi><mo>+</mo><mi>b̂</mi></mrow>';          // a combining mark inside a token with its letter: left alone
  assert.equal(spacingAccentsInMathML(plain), plain);
});

test('#44: the ODT vector equation brailles without a hex escape, in UEB and Nemeth', () => {
  for (const mode of ['ukaaf', 'bana']) {
    const brf = makeMathToBrf(mode)(ODT_VEC);
    assert.ok(!/0020D|\\X20D7|20D7/i.test(brf), `${mode}: ${brf}`);
    assert.ok(brf.length > 0, mode);
  }
});
