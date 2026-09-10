// Node test for omml.mjs using @xmldom/xmldom (no browser DOMParser in Node).
// Run: node input/omml.test.mjs
import { DOMParser } from '@xmldom/xmldom';
import { ommlElementToMathML } from './omml.mjs';

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function parseOMath(fragmentXml) {
  const xml = `<m:oMath xmlns:m="${MATH_NS}">${fragmentXml}</m:oMath>`;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.documentElement;
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS: ${name}`);
  } else {
    failures++;
    console.log(`  FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
  }
}

function run(name, fragmentXml, assertions) {
  console.log(`\n=== ${name} ===`);
  console.log('OMML in :', fragmentXml);
  const el = parseOMath(fragmentXml);
  const mathml = ommlElementToMathML(el);
  console.log('MathML out:', mathml);
  assertions(mathml);
}

// ---------------------------------------------------------------------
// 1. x^2 + 1   (superscript + run text with operator)
// ---------------------------------------------------------------------
run(
  'x^2 + 1 (sSup)',
  `
  <m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
  `,
  (mathml) => {
    check('has <math display="block">', /<math display="block">/.test(mathml));
    check('has <msup>', /<msup>/.test(mathml));
    check('base is <mi>x</mi>', /<msup><mi>x<\/mi>/.test(mathml));
    check('sup is <mn>2</mn>', /<mn>2<\/mn><\/msup>/.test(mathml));
  }
);

// Full expression: x^2 + 1 as separate runs
run(
  'x^2 + 1 (full expression)',
  `
  <m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
  <m:r><m:t>+</m:t></m:r>
  <m:r><m:t>1</m:t></m:r>
  `,
  (mathml) => {
    check('contains msup then + operator then mn 1',
      /<msup>.*<\/msup><mo>\+<\/mo><mn>1<\/mn>/.test(mathml), mathml);
  }
);

// ---------------------------------------------------------------------
// 2. 1/2 (fraction)
// ---------------------------------------------------------------------
run(
  '1/2 (fraction)',
  `
  <m:f>
    <m:num><m:r><m:t>1</m:t></m:r></m:num>
    <m:den><m:r><m:t>2</m:t></m:r></m:den>
  </m:f>
  `,
  (mathml) => {
    check('has <mfrac>', /<mfrac>/.test(mathml));
    check('num is <mn>1</mn>', /<mfrac><mn>1<\/mn>/.test(mathml));
    check('den is <mn>2</mn>', /<mn>2<\/mn><\/mfrac>/.test(mathml));
  }
);

// ---------------------------------------------------------------------
// 3. sqrt(2) (radical, no degree)
// ---------------------------------------------------------------------
run(
  'sqrt(2) (radical, empty degree)',
  `
  <m:rad>
    <m:deg></m:deg>
    <m:e><m:r><m:t>2</m:t></m:r></m:e>
  </m:rad>
  `,
  (mathml) => {
    check('has <msqrt>', /<msqrt>/.test(mathml));
    check('no <mroot>', !/<mroot>/.test(mathml));
    check('body is <mn>2</mn>', /<msqrt><mn>2<\/mn><\/msqrt>/.test(mathml));
  }
);

// Cube root: sqrt with a real degree -> mroot
run(
  'cube root (radical with degree -> mroot)',
  `
  <m:rad>
    <m:deg><m:r><m:t>3</m:t></m:r></m:deg>
    <m:e><m:r><m:t>8</m:t></m:r></m:e>
  </m:rad>
  `,
  (mathml) => {
    check('has <mroot>', /<mroot>/.test(mathml));
    check('base then degree order', /<mroot><mn>8<\/mn><mn>3<\/mn><\/mroot>/.test(mathml));
  }
);

// ---------------------------------------------------------------------
// 4. Fraction-with-subscript: x_1 / y  (a fraction whose numerator has a
//    subscripted base)
// ---------------------------------------------------------------------
run(
  'fraction with subscript in numerator (x_1 / y)',
  `
  <m:f>
    <m:num>
      <m:sSub>
        <m:e><m:r><m:t>x</m:t></m:r></m:e>
        <m:sub><m:r><m:t>1</m:t></m:r></m:sub>
      </m:sSub>
    </m:num>
    <m:den><m:r><m:t>y</m:t></m:r></m:den>
  </m:f>
  `,
  (mathml) => {
    check('has <mfrac>', /<mfrac>/.test(mathml));
    check('numerator has <msub>', /<mfrac><msub>/.test(mathml));
    check('msub base x, sub 1', /<msub><mi>x<\/mi><mn>1<\/mn><\/msub>/.test(mathml));
    check('denominator is <mi>y</mi>', /<mi>y<\/mi><\/mfrac>/.test(mathml));
  }
);

// ---------------------------------------------------------------------
// Bonus: delimiter (parentheses) and nary (summation) sanity checks
// ---------------------------------------------------------------------
run(
  'delimiter (x + y) with parens',
  `
  <m:d>
    <m:e>
      <m:r><m:t>x</m:t></m:r>
      <m:r><m:t>+</m:t></m:r>
      <m:r><m:t>y</m:t></m:r>
    </m:e>
  </m:d>
  `,
  (mathml) => {
    check('opens with <mo>(</mo>', /<mo>\(<\/mo>/.test(mathml));
    check('closes with <mo>)</mo>', /<mo>\)<\/mo>/.test(mathml));
  }
);

run(
  'nary summation with sub/sup',
  `
  <m:nary>
    <m:naryPr><m:chr m:val="∑"/></m:naryPr>
    <m:sub><m:r><m:t>i</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>1</m:t></m:r></m:sub>
    <m:sup><m:r><m:t>n</m:t></m:r></m:sup>
    <m:e><m:r><m:t>i</m:t></m:r></m:e>
  </m:nary>
  `,
  (mathml) => {
    check('has <munderover>', /<munderover>/.test(mathml));
    check('operator is the sum sign', /<mo>∑<\/mo>/.test(mathml));
  }
);

run(
  'func sin(x)',
  `
  <m:func>
    <m:fName><m:r><m:t>sin</m:t></m:r></m:fName>
    <m:e><m:d><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:e>
  </m:func>
  `,
  (mathml) => {
    check('has function name mi sin', /<mi>sin<\/mi>/.test(mathml));
    check('has parens around x', /<mo>\(<\/mo><mi>x<\/mi><mo>\)<\/mo>/.test(mathml));
  }
);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
