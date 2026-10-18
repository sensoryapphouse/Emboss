// MathML written with a namespace prefix other than m:/mml:/mathml: (ODF's own `math:`, or any
// other) must still be normalised to `m:` with alttext/altimg on <m:math>, or the saved NIMAS
// file fails the DAISY MathML-in-DTBook Schematron rules (found 26 Sep by the importer agent).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMathMl } from '../input/nimas-export.mjs';

test('any MathML namespace prefix is normalised to m: with alttext and altimg', () => {
  const raw = '<math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:mi>x</math:mi><math:mo>+</math:mo><math:mn>1</math:mn></math:math>';
  const out = normalizeMathMl(raw, 'x plus 1');
  assert.match(out, /^<m:math\b/);
  assert.match(out, /\balttext="/);
  assert.match(out, /\baltimg="/);
  assert.ok(!/math:/.test(out.replace(/<\/?m:math\b/g, '')), out);
  assert.ok(!/xmlns:math=/.test(out), out);
  assert.match(out, /<m:mi>x<\/m:mi>/);
});

test('the usual unprefixed and m: forms are unchanged by the generalisation', () => {
  const a = normalizeMathMl('<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi></math>', 'y');
  const b = normalizeMathMl('<m:math><m:mi>y</m:mi></m:math>', 'y');
  assert.match(a, /<m:mi>y<\/m:mi>/);
  assert.match(b, /<m:mi>y<\/m:mi>/);
});
