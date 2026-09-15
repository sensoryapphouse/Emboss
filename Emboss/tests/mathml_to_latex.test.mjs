// Comprehensive Unit Test Suite for MathML to LaTeX converter.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const normActual = (actual || '').replace(/\s+/g, ' ').trim();
  const normExpected = (expected || '').replace(/\s+/g, ' ').trim();
  if (normActual === normExpected) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    Actual:   "${normActual}"`);
    console.error(`    Expected: "${normExpected}"`);
  }
}

console.log('--- Running MathML to LaTeX Test Suite ---');

// 1. Basic arithmetic
check(
  'Simple sum: 1 + 2 = 3',
  mathmlToLatex('<math><mn>1</mn><mo>+</mo><mn>2</mn><mo>=</mo><mn>3</mn></math>'),
  '1 + 2 = 3'
);

// 2. Variables & Greek letters
check(
  'Greek variables: alpha + beta = gamma',
  mathmlToLatex('<math><mi>α</mi><mo>+</mo><mi>β</mi><mo>=</mo><mi>γ</mi></math>'),
  '\\alpha + \\beta = \\gamma'
);

// 3. Fractions
check(
  'Fraction: 1/2',
  mathmlToLatex('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>'),
  '\\frac{1}{2}'
);

check(
  'Algebraic fraction: (x + 1)/(x - 1)',
  mathmlToLatex('<math><mfrac><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mrow><mi>x</mi><mo>-</mo><mn>1</mn></mrow></mfrac></math>'),
  '\\frac{x + 1}{x - 1}'
);

// 4. Square Roots & Nth Roots
check(
  'Square root: sqrt(x)',
  mathmlToLatex('<math><msqrt><mi>x</mi></msqrt></math>'),
  '\\sqrt{x}'
);

check(
  'Nth root: root(3, x + 1)',
  mathmlToLatex('<math><mroot><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mn>3</mn></mroot></math>'),
  '\\sqrt[3]{x + 1}'
);

// 5. Superscripts and Subscripts
check(
  'Superscript: x^2',
  mathmlToLatex('<math><msup><mi>x</mi><mn>2</mn></msup></math>'),
  'x^{2}'
);

check(
  'Subscript: a_i',
  mathmlToLatex('<math><msub><mi>a</mi><mi>i</mi></msub></math>'),
  'a_{i}'
);

check(
  'Sub-Superscript: x_0^2',
  mathmlToLatex('<math><msubsup><mi>x</mi><mn>0</mn><mn>2</mn></msubsup></math>'),
  'x_{0}^{2}'
);

// 6. Quadratic Formula (with namespace prefix <m:math>)
const quadraticMml = `<m:math display="inline">
  <m:mi>x</m:mi>
  <m:mo>=</m:mo>
  <m:mfrac>
    <m:mrow>
      <m:mo>−</m:mo>
      <m:mi>b</m:mi>
      <m:mo>±</m:mo>
      <m:msqrt>
        <m:mrow>
          <m:msup><m:mi>b</m:mi><m:mn>2</m:mn></m:msup>
          <m:mo>−</m:mo>
          <m:mn>4</m:mn><m:mi>a</m:mi><m:mi>c</m:mi>
        </m:mrow>
      </m:msqrt>
    </m:mrow>
    <m:mrow>
      <m:mn>2</m:mn><m:mi>a</m:mi>
    </m:mrow>
  </m:mfrac>
</m:math>`;

check(
  'Quadratic Formula with m: prefix',
  mathmlToLatex(quadraticMml),
  'x = \\frac{- b \\pm \\sqrt{b^{2} - 4ac}}{2a}'
);

// 7. Pythagorean Theorem
const pythMml = `<m:math display="inline"><m:msup><m:mi>a</m:mi><m:mn>2</m:mn></m:msup><m:mo>+</m:mo><m:msup><m:mi>b</m:mi><m:mn>2</m:mn></m:msup><m:mo>=</m:mo><m:msup><m:mi>c</m:mi><m:mn>2</m:mn></m:msup></m:math>`;

check(
  'Pythagorean Theorem',
  mathmlToLatex(pythMml),
  'a^{2} + b^{2} = c^{2}'
);

// 8. Math functions
check(
  'Trig function: sin(theta)',
  mathmlToLatex('<math><mi>sin</mi><mo>(</mo><mi>θ</mi><mo>)</mo></math>'),
  '\\sin (\\theta)'
);

// 9. Limits and Summations
check(
  'Underscript limit: lim_{x -> 0}',
  mathmlToLatex('<math><munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder></math>'),
  '\\lim_{x\\to 0}'
);

check(
  'Under-over summation: sum_{i=1}^n i',
  mathmlToLatex('<math><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi></math>'),
  '\\sum_{i = 1}^{n} i'
);

// 10. Fences
check(
  'Fenced brackets [a, b]',
  mathmlToLatex('<math><mfenced open="[" close="]"><mrow><mi>a</mi><mo>,</mo><mi>b</mi></mrow></mfenced></math>'),
  '\\left[a, b\\right]'
);

// 11. Matrix / Table
const matrixMml = `<math>
  <mtable>
    <mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr>
    <mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr>
  </mtable>
</math>`;

check(
  'Identity Matrix (mtable)',
  mathmlToLatex(matrixMml),
  '\\begin{matrix} 1 & 0 \\\\ 0 & 1 \\end{matrix}'
);

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
