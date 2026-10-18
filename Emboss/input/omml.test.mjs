// Node test for omml.mjs using @xmldom/xmldom (no browser DOMParser in Node).
// Run: node input/omml.test.mjs
import { DOMParser } from '@xmldom/xmldom';
import { ommlElementToMathML } from './omml.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const toUeb = makeMathToBrf('ukaaf');
const toNemeth = makeMathToBrf('bana');

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
    // EXPECTATION CHANGED (A84, Paul 30 Sep 2026; Emboss/docs/expectation-changes.md): an m:d bracket is a
    // stretchy fence (Word's brackets grow with their content), so the print view can write \left( ... \right).
    // It was a plain <mo>(</mo>. The braille is unchanged (MathCAT ignores the flags).
    check('opens with a stretchy fence (', /<mo fence="true" stretchy="true">\(<\/mo>/.test(mathml));
    check('closes with a stretchy fence )', /<mo fence="true" stretchy="true">\)<\/mo>/.test(mathml));
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
    // EXPECTATION CHANGED (A84): the function is applied (U+2061) and the brackets are stretchy fences.
    check('sin is applied to its argument (function application)', /<mi>sin<\/mi><mo>\u2061<\/mo>/.test(mathml));
    check('has fenced parens around x', /<mo fence="true" stretchy="true">\(<\/mo><mi>x<\/mi><mo fence="true" stretchy="true">\)<\/mo>/.test(mathml));
  }
);

// ---------------------------------------------------------------------
// DOCX-equation-import fixes (AGENTS.md task, 25 Sep 2026): fraction type,
// n-ary limLoc, plain-text runs, and degree/prime operators.
// ---------------------------------------------------------------------

// ---- Fix 4: m:fPr/m:type ----
run(
  'fraction type: noBar -> mfrac linethickness="0" (binomial coefficient)',
  `<m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f>`,
  (mathml) => {
    check('has linethickness="0"', /<mfrac linethickness="0">/.test(mathml), mathml);
    check('no plain <mfrac> (would mean the type was ignored)', !/<mfrac>/.test(mathml), mathml);
  }
);
run(
  'fraction type: lin -> linear "n/k", not a stacked mfrac at all',
  `<m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f>`,
  (mathml) => {
    check('no <mfrac> at all', !/<mfrac/.test(mathml), mathml);
    check('is num <mo>/</mo> den', /<mi>n<\/mi><mo>\/<\/mo><mi>k<\/mi>/.test(mathml), mathml);
  }
);
run(
  'fraction type: skw -> mfrac bevelled="true"',
  `<m:f><m:fPr><m:type m:val="skw"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f>`,
  (mathml) => check('has bevelled="true"', /<mfrac bevelled="true">/.test(mathml), mathml)
);
run(
  'fraction type: absent (default) -> plain <mfrac>, unchanged',
  `<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>`,
  (mathml) => check('is plain <mfrac>', /^<math display="block"><mfrac><mn>1<\/mn><mn>2<\/mn><\/mfrac><\/math>$/.test(mathml), mathml)
);
{
  // Braille: a binomial coefficient (n choose k) written as a noBar fraction in
  // parentheses must braille as a general/no-bar fraction, not an ordinary barred one —
  // this is the case the fix exists for (AGENTS.md fix 4's "common case").
  const noBarMathml = ommlElementToMathML(parseOMath(
    `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f></m:e></m:d>`
  ));
  const barMathml = ommlElementToMathML(parseOMath(
    `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f></m:e></m:d>`
  ));
  const nemethNoBar = toNemeth(noBarMathml);
  const nemethBar = toNemeth(barMathml);
  console.log(`\n=== binomial coefficient (n choose k): noBar vs bar, Nemeth braille ===`);
  console.log(' noBar Nemeth:', nemethNoBar, '  bar Nemeth:', nemethBar);
  check('noBar braille differs from an ordinary barred fraction (fix 4 is not a no-op)', nemethNoBar !== nemethBar, `noBar=${nemethNoBar} bar=${nemethBar}`);
}

// ---- Fix 3: m:naryPr/m:limLoc ----
run(
  'nary limLoc="subSup" -> msubsup (not munderover)',
  `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub><m:r><m:t>i</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>`,
  (mathml) => {
    check('has <msubsup>', /<msubsup>/.test(mathml), mathml);
    check('no <munderover>', !/<munderover>/.test(mathml), mathml);
  }
);
run(
  'nary limLoc="undOvr" explicit on an integral -> stays munderover (explicit wins over the integral default)',
  `<m:nary><m:naryPr><m:chr m:val="∫"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r><m:r><m:t>dx</m:t></m:r></m:e></m:nary>`,
  (mathml) => check('has <munderover>', /<munderover>/.test(mathml), mathml)
);
run(
  'nary integral (∫) with NO limLoc -> defaults to subSup (Word\'s own integral default), not undOvr',
  `<m:nary><m:naryPr><m:chr m:val="∫"/></m:naryPr><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r><m:r><m:t>dx</m:t></m:r></m:e></m:nary>`,
  (mathml) => {
    check('has <msubsup>', /<msubsup>/.test(mathml), mathml);
    check('no <munderover>', !/<munderover>/.test(mathml), mathml);
  }
);
run(
  'nary sum (∑) with NO limLoc -> still defaults to undOvr (unchanged; only the integral family defaults to subSup)',
  `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>i</m:t></m:r><m:r><m:t>=</m:t></m:r><m:r><m:t>1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary>`,
  (mathml) => {
    check('has <munderover>', /<munderover>/.test(mathml), mathml);
    check('no <msubsup>', !/<msubsup>/.test(mathml), mathml);
  }
);

// ---- Fix 2: plain-text runs (m:rPr/m:sty val="p", m:rPr/m:nor) ----
run(
  'plain-text run: a multi-letter word -> <mtext> (not one <mi> per run, mashed against neighbours)',
  `<m:r><m:rPr><m:nor/></m:rPr><m:t>distance</m:t></m:r>`,
  (mathml) => check('has <mtext>distance</mtext>', /<mtext>distance<\/mtext>/.test(mathml), mathml)
);
run(
  'plain-text run: a single upright letter (the "d" in "dx") -> mi mathvariant="normal", not mtext',
  `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>d</m:t></m:r><m:r><m:t>x</m:t></m:r>`,
  (mathml) => {
    check('has <mi mathvariant="normal">d</mi>', /<mi mathvariant="normal">d<\/mi>/.test(mathml), mathml);
    check('no <mtext>', !/<mtext>/.test(mathml), mathml);
  }
);
run(
  'plain-text run: leading/trailing spaces survive as non-breaking spaces inside <mtext>',
  `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve"> if </m:t></m:r>`,
  (mathml) => check('mtext has U+00A0 on both sides', /<mtext> if <\/mtext>/.test(mathml), JSON.stringify(mathml))
);
run(
  'plain-text run with mixed letters/digits (">0") falls back to ordinary tokenizing, not mtext',
  `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>&gt;0</m:t></m:r>`,
  (mathml) => {
    check('has <mo>&gt;</mo>', /<mo>&gt;<\/mo>/.test(mathml), mathml);
    check('has <mn>0</mn>', /<mn>0<\/mn>/.test(mathml), mathml);
    check('no <mtext>', !/<mtext>/.test(mathml), mathml);
  }
);
{
  // Braille: "x if x > 0 and x is even" must come out as separate braille words, not
  // "XIFX...ANDXISEVEN" run together — this is the whole point of fix 2 (see AGENTS.md).
  const mathml = ommlElementToMathML(parseOMath(
    `<m:r><m:t>x</m:t></m:r>` +
    `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve"> if </m:t></m:r>` +
    `<m:r><m:t>x</m:t></m:r><m:r><m:t>&gt;</m:t></m:r><m:r><m:t>0</m:t></m:r>` +
    `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve"> and </m:t></m:r>` +
    `<m:r><m:t>x</m:t></m:r>` +
    `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve"> is even</m:t></m:r>`
  ));
  const ueb = toUeb(mathml);
  const nemeth = toNemeth(mathml);
  console.log('\n=== "x if x > 0 and x is even": word-spacing in braille ===');
  console.log(' UEB   :', ueb);
  console.log(' Nemeth:', nemeth);
  check('UEB has "IF" as its own word (space on both sides)', / IF /.test(ueb), ueb);
  check('UEB has "AND" as its own word', / AND /.test(ueb), ueb);
  check('UEB does not run "IF" into the following X ("IFX")', !/IFX/.test(ueb), ueb);
  check('Nemeth has "IF" as its own word', / IF /.test(nemeth), nemeth);
  check('Nemeth does not run "ISEVEN" together', !/ISEVEN/.test(nemeth), nemeth);
}

// ---- Fix 5: degree / prime operators ----
run(
  'degree sign (°) -> <mo>, not <mi>',
  `<m:r><m:t>90°</m:t></m:r>`,
  (mathml) => check('has <mo>°</mo>', /<mo>°<\/mo>/.test(mathml), mathml)
);
run(
  'prime (′) on a superscript -> <mo>, not <mi>',
  `<m:sSup><m:e><m:r><m:t>f</m:t></m:r></m:e><m:sup><m:r><m:t>′</m:t></m:r></m:sup></m:sSup>`,
  (mathml) => check('has <msup><mi>f</mi><mo>′</mo></msup>', /<msup><mi>f<\/mi><mo>′<\/mo><\/msup>/.test(mathml), mathml)
);
run(
  'double prime (″) and triple prime (‴) -> <mo>',
  `<m:r><m:t>″</m:t></m:r><m:r><m:t>‴</m:t></m:r>`,
  (mathml) => {
    check('has <mo>″</mo>', /<mo>″<\/mo>/.test(mathml), mathml);
    check('has <mo>‴</mo>', /<mo>‴<\/mo>/.test(mathml), mathml);
  }
);
{
  // Braille: degree must stay bound to the preceding number, in both codes — no braille
  // word-space token between "90" and the degree mark.
  const mathml = ommlElementToMathML(parseOMath(`<m:r><m:t>90°</m:t></m:r>`));
  const ueb = toUeb(mathml);
  const nemeth = toNemeth(mathml);
  console.log('\n=== 90°: degree braille ===');
  console.log(' UEB   :', ueb, '  Nemeth:', nemeth);
  check('UEB has no space between the number and the degree mark', !/#[A-J]+ /.test(ueb), ueb);
  check('Nemeth has no space between the number and the degree mark', !/#[0-9]+ /.test(nemeth), nemeth);
}

// ---- Defensive: unknown/malformed OMML content is not silently dropped ----
run(
  'a stray m:t not wrapped in m:r keeps its text (defensive, not real Word output)',
  `<m:foo><m:t>kept</m:t></m:foo>`,
  (mathml) => check('text "kept" survives', /kept/.test(mathml), mathml)
);
run(
  'a wholly unknown leaf element with direct text keeps its text',
  `<m:someFutureThing>xyz</m:someFutureThing>`,
  (mathml) => check('text "xyz" survives', /xyz/.test(mathml), mathml)
);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
