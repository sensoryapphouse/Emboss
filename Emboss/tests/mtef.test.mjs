// Old-style Word equations (Equation Editor 3.0 = MTEF 3, MathType 4+ = MTEF 5) -> MathML,
// Emboss/input/mtef.mjs.
//
// Test material:
//   * the MathType 4.0 quadratic-formula MTEF published byte-for-byte in Design Science's
//     "MathType MTEF v.5" specification (its worked example) — real MathType output;
//   * every other equation is written record by record from the MTEF 3 / MTEF 5 record
//     layouts with tests/helpers/mtef-writer.mjs, then (for the OLE tests) wrapped in a
//     compound file the way Word stores it.
// Each equation's MathML is checked against hand-written correct MathML of the same
// equation, compared through MathCAT's UEB and Nemeth braille (the output that matters),
// plus structural checks on the MathML itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mtefToMathML, equationNativeToMathML, oleEquationToMathML, readOleEquation, parseMtef, MtefError } from '../input/mtef.mjs';
import { v3, v5, FACE, EMB, equationNative, oleEquationObject } from './helpers/mtef-writer.mjs';
import { writeCfb } from './helpers/cfb-writer.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const toUeb = makeMathToBrf('ukaaf');
const toNemeth = makeMathToBrf('bana');
const M = (inner) => `<math display="block">${inner}</math>`;
const conv = (bytes) => mtefToMathML(new Uint8Array(bytes));

// Same braille (UEB and Nemeth) as the hand-written MathML, and MathCAT did not fail on it.
const MATHCAT_FAILED = '/#';                               // node-maths-helper's fallback (⠌⠼)
function sameBraille(mathml, expected, label) {
  const u = toUeb(mathml), n = toNemeth(mathml);
  assert.ok(u && u !== MATHCAT_FAILED && n && n !== MATHCAT_FAILED, `${label}: MathCAT could not read ${mathml}`);
  assert.equal(u, toUeb(expected), `${label}: UEB\n got      ${mathml}\n expected ${expected}`);
  assert.equal(n, toNemeth(expected), `${label}: Nemeth\n got      ${mathml}\n expected ${expected}`);
}

const X = (c) => v3.char(FACE.VARIABLE, c);
const N3 = (c) => v3.char(FACE.NUMBER, c);
const S3 = (c) => v3.char(FACE.SYMBOL, c);
const X5 = (c) => v5.char(FACE.VARIABLE, c);
const N5 = (c) => v5.char(FACE.NUMBER, c);
const S5 = (c) => v5.char(FACE.SYMBOL, c);

// ---------------------------------------------------------------------------------------
// Real MathType output: the published MTEF v.5 example (quadratic formula numerator/denominator)
// ---------------------------------------------------------------------------------------
const QUADRATIC = [0x05, 0x01, 0x00, 0x04, 0x00, 0x44, 0x53, 0x4D, 0x54, 0x34, 0x00, 0x00, 0x13, 0x57, 0x69, 0x6E, 0x41, 0x6C, 0x6C, 0x42, 0x61, 0x73, 0x69, 0x63, 0x43, 0x6F, 0x64, 0x65, 0x50, 0x61, 0x67, 0x65, 0x73, 0x00, 0x11, 0x05, 0x54, 0x69, 0x6D, 0x65, 0x73, 0x20, 0x4E, 0x65, 0x77, 0x20, 0x52, 0x6F, 0x6D, 0x61, 0x6E, 0x00, 0x11, 0x03, 0x53, 0x79, 0x6D, 0x62, 0x6F, 0x6C, 0x00, 0x11, 0x05, 0x43, 0x6F, 0x75, 0x72, 0x69, 0x65, 0x72, 0x20, 0x4E, 0x65, 0x77, 0x00, 0x11, 0x04, 0x4D, 0x54, 0x20, 0x45, 0x78, 0x74, 0x72, 0x61, 0x00, 0x12, 0x00, 0x08, 0x21, 0x2F, 0x45, 0x8F, 0x44, 0x2F, 0x41, 0x50, 0xF4, 0x10, 0x0F, 0x47, 0x5F, 0x41, 0x50, 0xF2, 0x1F, 0x1E, 0x41, 0x50, 0xF4, 0x15, 0x0F, 0x41, 0x00, 0xF4, 0x45, 0xF4, 0x25, 0xF4, 0x8F, 0x42, 0x5F, 0x41, 0x00, 0xF4, 0x10, 0x0F, 0x43, 0x5F, 0x41, 0x00, 0xF4, 0x8F, 0x45, 0xF4, 0x2A, 0x5F, 0x48, 0xF4, 0x8F, 0x41, 0x00, 0xF4, 0x10, 0x0F, 0x40, 0xF4, 0x8F, 0x41, 0x7F, 0x48, 0xF4, 0x10, 0x0F, 0x41, 0x2A, 0x5F, 0x44, 0x5F, 0x45, 0xF4, 0x5F, 0x45, 0xF4, 0x5F, 0x41, 0x0F, 0x0C, 0x01, 0x00, 0x01, 0x00, 0x01, 0x02, 0x02, 0x02, 0x02, 0x00, 0x02, 0x00, 0x01, 0x01, 0x01, 0x00, 0x03, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x0A, 0x01, 0x00, 0x03, 0x00, 0x0B, 0x00, 0x00, 0x01, 0x00, 0x02, 0x04, 0x86, 0x12, 0x22, 0x2D, 0x02, 0x00, 0x83, 0x62, 0x00, 0x02, 0x04, 0x86, 0xB1, 0x00, 0xB1, 0x03, 0x00, 0x0A, 0x00, 0x00, 0x01, 0x00, 0x02, 0x00, 0x83, 0x62, 0x00, 0x03, 0x00, 0x1C, 0x00, 0x00, 0x0B, 0x01, 0x01, 0x01, 0x00, 0x02, 0x00, 0x88, 0x32, 0x00, 0x00, 0x00, 0x0A, 0x02, 0x04, 0x86, 0x12, 0x22, 0x2D, 0x02, 0x00, 0x88, 0x34, 0x00, 0x02, 0x00, 0x83, 0x61, 0x00, 0x02, 0x00, 0x83, 0x63, 0x00, 0x00, 0x0B, 0x01, 0x01, 0x00, 0x00, 0x0A, 0x01, 0x00, 0x02, 0x00, 0x88, 0x32, 0x00, 0x02, 0x00, 0x83, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00];

test('real MathType 4 MTEF (the specification\'s worked example): quadratic formula', () => {
  const ast = parseMtef(new Uint8Array(QUADRATIC));
  assert.equal(ast.version, 5);
  assert.equal(ast.inline, false);
  const mml = conv(QUADRATIC);
  assert.equal(mml, M('<mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac>'));
  sameBraille(mml, M('<mfrac><mrow><mo>-</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>-</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac>'), 'quadratic');
});

// ---------------------------------------------------------------------------------------
// The equation set, each in MTEF 3 (Equation Editor 3.0) and MTEF 5 (MathType) form.
// ---------------------------------------------------------------------------------------
const CASES = [
  {
    name: 'x^2 + 1 = 0',
    v3: v3.eqn(v3.line(X('x'), v3.tmpl(15, 0, v3.size.SUB, v3.nullLine(), v3.line(N3('2'))), v3.size.FULL, S3('+'), N3('1'), S3('='), N3('0'))),
    v5: v5.eqn(v5.line(X5('x'), v5.tmpl(28, 0, v5.nullLine(), v5.line(N5('2'))), S5('+'), N5('1'), S5('='), N5('0'))),
    expected: '<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn><mo>=</mo><mn>0</mn>',
  },
  {
    name: 'fraction (a + b)/2',
    v3: v3.eqn(v3.line(v3.tmpl(14, 0, v3.line(X('a'), S3('+'), X('b')), v3.line(N3('2'))))),
    v5: v5.eqn(v5.line(v5.tmpl(11, 0, v5.line(X5('a'), S5('+'), X5('b')), v5.line(N5('2'))))),
    expected: '<mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></mfrac>',
  },
  {
    name: 'square root √(x + 1) and cube root ∛8',
    v3: v3.eqn(v3.line(v3.tmpl(13, 0, v3.line(X('x'), S3('+'), N3('1')), v3.nullLine()), S3(','), v3.tmpl(13, 1, v3.line(N3('8')), v3.line(N3('3'))))),
    v5: v5.eqn(v5.line(v5.tmpl(10, 0, v5.line(X5('x'), S5('+'), N5('1')), v5.nullLine()), S5(','), v5.tmpl(10, 1, v5.line(N5('8')), v5.line(N5('3'))))),
    expected: '<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt><mo>,</mo><mroot><mn>8</mn><mn>3</mn></mroot>',
  },
  {
    name: 'subscripts and superscripts x₁² + a_n',
    v3: v3.eqn(v3.line(X('x'), v3.tmpl(15, 2, v3.line(N3('1')), v3.line(N3('2'))), S3('+'), X('a'), v3.tmpl(15, 1, v3.line(X('n')), v3.nullLine()))),
    v5: v5.eqn(v5.line(X5('x'), v5.tmpl(29, 0, v5.line(N5('1')), v5.line(N5('2'))), S5('+'), X5('a'), v5.tmpl(27, 0, v5.line(X5('n')), v5.nullLine()))),
    expected: '<msubsup><mi>x</mi><mn>1</mn><mn>2</mn></msubsup><mo>+</mo><msub><mi>a</mi><mi>n</mi></msub>',
  },
  {
    name: 'Greek letters α + β = Γ',
    v3: v3.eqn(v3.line(v3.char(FACE.LCGREEK, 'α'), S3('+'), v3.char(FACE.LCGREEK, 'β'), S3('='), v3.char(FACE.UCGREEK, 'Γ'))),
    v5: v5.eqn(v5.line(v5.char(FACE.LCGREEK, 'α'), S5('+'), v5.char(FACE.LCGREEK, 'β'), S5('='), v5.char(FACE.UCGREEK, 'Γ'))),
    expected: '<mi>α</mi><mo>+</mo><mi>β</mi><mo>=</mo><mi>Γ</mi>',
  },
  {
    name: 'integral with limits ∫₀¹ x² dx',
    v3: v3.eqn(v3.line(v3.tmpl(21, 2, v3.line(X('x'), v3.tmpl(15, 0, v3.nullLine(), v3.line(N3('2'))), X('d'), X('x')), v3.line(N3('0')), v3.line(N3('1')), S3('∫')))),
    v5: v5.eqn(v5.line(v5.tmpl(15, 0x31, v5.line(X5('x'), v5.tmpl(28, 0, v5.nullLine(), v5.line(N5('2'))), X5('d'), X5('x')), v5.line(N5('0')), v5.line(N5('1')), S5('∫')))),
    expected: '<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><msup><mi>x</mi><mn>2</mn></msup><mi>d</mi><mi>x</mi>',
  },
  {
    name: 'sum with limits Σ_{i=1}^{n} i²',
    v3: v3.eqn(v3.line(v3.tmpl(29, 1, v3.line(X('i'), v3.tmpl(15, 0, v3.nullLine(), v3.line(N3('2')))), v3.line(X('i'), S3('='), N3('1')), v3.line(X('n')), S3('∑')))),
    v5: v5.eqn(v5.line(v5.tmpl(16, 0x70, v5.line(X5('i'), v5.tmpl(28, 0, v5.nullLine(), v5.line(N5('2')))), v5.line(X5('i'), S5('='), N5('1')), v5.line(X5('n')), S5('∑')))),
    expected: '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>i</mi><mn>2</mn></msup>',
  },
  {
    name: 'stretching parentheses and brackets (a/b)² − [x + 1]',
    v3: v3.eqn(v3.line(v3.tmpl(1, 0, v3.line(v3.tmpl(14, 0, v3.line(X('a')), v3.line(X('b')))), S3('('), S3(')')), v3.tmpl(15, 0, v3.nullLine(), v3.line(N3('2'))), S3('−'), v3.tmpl(3, 0, v3.line(X('x'), S3('+'), N3('1')), S3('['), S3(']')))),
    v5: v5.eqn(v5.line(v5.tmpl(1, 3, v5.line(v5.tmpl(11, 0, v5.line(X5('a')), v5.line(X5('b')))), S5('('), S5(')')), v5.tmpl(28, 0, v5.nullLine(), v5.line(N5('2'))), S5('−'), v5.tmpl(3, 3, v5.line(X5('x'), S5('+'), N5('1')), S5('['), S5(']')))),
    expected: '<msup><mrow><mo>(</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo>)</mo></mrow><mn>2</mn></msup><mo>−</mo><mrow><mo>[</mo><mi>x</mi><mo>+</mo><mn>1</mn><mo>]</mo></mrow>',
  },
  {
    name: '2×2 matrix in brackets',
    v3: v3.eqn(v3.line(v3.tmpl(3, 0, v3.line(v3.matrix(2, 2, v3.line(X('a')), v3.line(X('b')), v3.line(X('c')), v3.line(X('d')))), S3('['), S3(']')))),
    v5: v5.eqn(v5.line(v5.tmpl(3, 3, v5.line(v5.matrix(2, 2, v5.line(X5('a')), v5.line(X5('b')), v5.line(X5('c')), v5.line(X5('d')))), S5('['), S5(']')))),
    expected: '<mrow><mo>[</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo>]</mo></mrow>',
  },
  {
    name: 'text inside an equation: x = 2 if y > 0',
    v3: v3.eqn(v3.line(X('x'), S3('='), N3('2'), v3.chars(FACE.TEXT, ' if '), X('y'), S3('>'), N3('0'))),
    v5: v5.eqn(v5.line(X5('x'), S5('='), N5('2'), v5.chars(FACE.TEXT, ' if '), X5('y'), S5('>'), N5('0'))),
    expected: '<mi>x</mi><mo>=</mo><mn>2</mn><mtext>\u00A0if\u00A0</mtext><mi>y</mi><mo>&gt;</mo><mn>0</mn>',
  },
  {
    name: 'embellishments: vector v⃗, dot ẋ, prime f′, bar x̄',
    v3: v3.eqn(v3.line(v3.char(FACE.VARIABLE, 'v', { embell: [EMB.RARROW] }), S3(','), v3.char(FACE.VARIABLE, 'x', { embell: [EMB.DOT] }), S3(','), v3.char(FACE.VARIABLE, 'f', { embell: [EMB.PRIME] }), S3(','), v3.char(FACE.VARIABLE, 'x', { embell: [EMB.OBAR] }))),
    v5: v5.eqn(v5.line(v5.char(FACE.VARIABLE, 'v', { embell: [EMB.RARROW] }), S5(','), v5.char(FACE.VARIABLE, 'x', { embell: [EMB.DOT] }), S5(','), v5.char(FACE.VARIABLE, 'f', { embell: [EMB.PRIME] }), S5(','), v5.char(FACE.VARIABLE, 'x', { embell: [EMB.OBAR] }))),
    expected: '<mover accent="true"><mi>v</mi><mo>→</mo></mover><mo>,</mo><mover accent="true"><mi>x</mi><mo>˙</mo></mover><mo>,</mo><msup><mi>f</mi><mo>′</mo></msup><mo>,</mo><mover accent="true"><mi>x</mi><mo>¯</mo></mover>',
  },
  {
    name: 'function name with a power: sin²x',
    v3: v3.eqn(v3.line(v3.chars(FACE.FUNCTION, 'sin'), v3.tmpl(15, 0, v3.nullLine(), v3.line(N3('2'))), X('x'))),
    v5: v5.eqn(v5.line(v5.char(FACE.FUNCTION, 's', { funcStart: true }), v5.chars(FACE.FUNCTION, 'in'), v5.tmpl(28, 0, v5.nullLine(), v5.line(N5('2'))), X5('x'))),
    expected: '<msup><mi>sin</mi><mn>2</mn></msup><mi>x</mi>',
  },
  {
    name: 'cases: left brace around a pile',
    v3: v3.eqn(v3.line(X('y'), S3('='), v3.tmpl(2, 1, v3.line(v3.pile(1, v3.line(X('x'), S3(','), X('x'), S3('≥'), N3('0')), v3.line(S3('−'), X('x'), S3(','), X('x'), S3('<'), N3('0')))), S3('{')))),
    v5: v5.eqn(v5.line(X5('y'), S5('='), v5.tmpl(2, 1, v5.line(v5.pile(1, v5.line(X5('x'), S5(','), X5('x'), S5('≥'), N5('0')), v5.line(S5('−'), X5('x'), S5(','), X5('x'), S5('<'), N5('0')))), S5('{')))),
    expected: '<mi>y</mi><mo>=</mo><mrow><mo>{</mo><mtable columnalign="left"><mtr><mtd><mi>x</mi><mo>,</mo><mi>x</mi><mo>≥</mo><mn>0</mn></mtd></mtr><mtr><mtd><mo>−</mo><mi>x</mi><mo>,</mo><mi>x</mi><mo>&lt;</mo><mn>0</mn></mtd></mtr></mtable></mrow>',
  },
  {
    name: 'limit lim_{x→0}',
    v3: v3.eqn(v3.line(v3.tmpl(39, 1, v3.line(v3.chars(FACE.FUNCTION, 'lim')), v3.line(X('x'), S3('→'), N3('0')), v3.nullLine()), v3.chars(FACE.FUNCTION, 'sin'), X('x'))),
    v5: v5.eqn(v5.line(v5.tmpl(23, 0x10, v5.line(v5.chars(FACE.FUNCTION, 'lim')), v5.line(X5('x'), S5('→'), N5('0')), v5.nullLine()), v5.char(FACE.FUNCTION, 's', { funcStart: true }), v5.chars(FACE.FUNCTION, 'in'), X5('x'))),
    expected: '<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mi>sin</mi><mi>x</mi>',
  },
];

for (const c of CASES) {
  for (const ver of ['v3', 'v5']) {
    test(`${c.name} (${ver === 'v3' ? 'Equation Editor 3.0, MTEF 3' : 'MathType, MTEF 5'})`, () => {
      const mml = conv(c[ver]);
      sameBraille(mml, M(c.expected), `${c.name} ${ver}`);
    });
  }
}

test('MathML shape: structural checks for the templates', () => {
  assert.match(conv(CASES[1].v3), /^<math display="block"><mfrac><mrow><mi>a<\/mi><mo>\+<\/mo><mi>b<\/mi><\/mrow><mn>2<\/mn><\/mfrac><\/math>$/);
  assert.match(conv(CASES[2].v5), /<msqrt>.*<\/msqrt>.*<mroot><mn>8<\/mn><mn>3<\/mn><\/mroot>/);
  assert.match(conv(CASES[5].v3), /<msubsup><mo>∫<\/mo><mn>0<\/mn><mn>1<\/mn><\/msubsup>/, 'integral: integral-style limits (msubsup)');
  assert.match(conv(CASES[6].v5), /<munderover><mo>∑<\/mo><mrow><mi>i<\/mi><mo>=<\/mo><mn>1<\/mn><\/mrow><mi>n<\/mi><\/munderover>/, 'sum: lower then upper');
  // EXPECTATION CHANGED 30 Sep 2026 (import fix list #31, .doc part; Paul's Word equation decision A84): a bracket pair of a MathType /
  // Equation Editor bracket template is stretchy and fenced, as omml.mjs writes Word's m:d: <mo fence="true" stretchy="true">.
  assert.match(conv(CASES[7].v3), /<msup><mrow><mo fence="true" stretchy="true">\(<\/mo><mfrac>/, 'the superscript applies to the whole bracket');
  assert.match(conv(CASES[8].v5), /<mtable><mtr><mtd><mi>a<\/mi><\/mtd><mtd><mi>b<\/mi><\/mtd><\/mtr>/);
  assert.match(conv(CASES[9].v3), /<mtext>\u00A0if\u00A0<\/mtext>/, 'spaces around words kept (no-break), as omml.mjs does');
  assert.match(toUeb(conv(CASES[9].v3)), /#B IF ;Y/, 'so the braille has "2 if y" as separate words');
  assert.match(conv(CASES[11].v5), /<msup><mi>sin<\/mi><mn>2<\/mn><\/msup>/);
});

// ---------------------------------------------------------------------------------------
// Encoding details
// ---------------------------------------------------------------------------------------
test('double dot, under-bar and tilde embellishments give real braille accents', () => {
  const mml = conv(v5.eqn(v5.line(v5.char(FACE.VARIABLE, 'x', { embell: [EMB.DDOT] }), S5(','), v5.char(FACE.VARIABLE, 'y', { embell: [EMB.TILDE] }), S5(','), v5.char(FACE.VARIABLE, 'z', { embell: [29] }))));
  assert.equal(mml, M('<mrow><mover accent="true"><mi>x</mi><mo>˙˙</mo></mover><mo>,</mo><mover accent="true"><mi>y</mi><mo>˜</mo></mover><mo>,</mo><munder accentunder="true"><mi>z</mi><mo>¯</mo></munder></mrow>'));
  for (const code of ['UEB', 'Nemeth']) {
    const brf = (code === 'UEB' ? toUeb : toNemeth)(mml);
    assert.ok(!/_\*X|'_\*/.test(brf), `${code}: no "unknown character" escape in ${brf}`);
  }
});

test('Greek stored as Symbol-font letters (a, b in a Greek style) becomes α, β', () => {
  const mml = conv(v3.eqn(v3.line(v3.char(FACE.LCGREEK, 'a'), S3('+'), v3.char(FACE.LCGREEK, 'b'))));
  assert.equal(mml, M('<mrow><mi>α</mi><mo>+</mo><mi>β</mi></mrow>'));
});

test('multi-digit numbers merge into one <mn>; spaces and MathType spacing characters vanish', () => {
  const mml = conv(v5.eqn(v5.line(N5('1'), N5('2'), N5('.'), N5('5'), v5.char(FACE.SYMBOL, 0xEF02), S5('+'), v5.char(FACE.SPACE, 0xEF04), X5('x'))));
  assert.equal(mml, M('<mrow><mn>12.5</mn><mo>+</mo><mi>x</mi></mrow>'));
});

test('MathType private-use letters: double-struck R, script L, Fraktur g, differential d', () => {
  const mml = conv(v5.eqn(v5.line(v5.char(FACE.SYMBOL, 0xF080 + 17), S5(','), v5.char(FACE.SYMBOL, 0xF100 + 11), S5(','), v5.char(FACE.SYMBOL, 0xF000 + 26 + 6), S5(','), v5.char(FACE.SYMBOL, 0xED10))));
  assert.equal(mml, M('<mrow><mi>ℝ</mi><mo>,</mo><mi>ℒ</mi><mo>,</mo><mi>𝔤</mi><mo>,</mo><mi>d</mi></mrow>'));
});

test('MTEF 5: character with only an 8-bit Symbol-font position (no MTCode)', () => {
  // FONT_STYLE_DEF #2 -> FONT_DEF #2 "Symbol"; typeface -2 refers to it.
  const pre = v5.preamble();
  const bytes = [...v5.header(), ...pre, 0x08, 0x02, 0x00, 0x0A, ...v5.line([0x02, 0x24, 128 - 2, 0x61]), 0x00];
  assert.equal(conv(bytes), M('<mi>α</mi>'));
});

test('nudges (short and long form) and a two-byte variation code are read correctly', () => {
  const eq3 = v3.eqn(v3.line(v3.char(FACE.VARIABLE, 'x', { nudge: true }), S3('+'), N3('1')));
  assert.equal(conv(eq3), M('<mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow>'));
  const eq5 = v5.eqn(v5.line(v5.char(FACE.VARIABLE, 'x', { nudge: true }), v5.tmpl(15, 0x0131, v5.line(X5('y')), v5.line(N5('0')), v5.line(N5('1')), S5('∫'))));
  assert.equal(conv(eq5), M('<mrow><mi>x</mi><mrow><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>y</mi></mrow></mrow>'));
});

test('double integral written as ∬ via variation, contour integral via loop bit', () => {
  assert.match(conv(v5.eqn(v5.line(v5.tmpl(15, 0x02, v5.line(X5('f')), v5.nullLine(), v5.nullLine())))), /<mo>∬<\/mo><mi>f<\/mi>/);
  assert.match(conv(v3.eqn(v3.line(v3.tmpl(21, 3, v3.line(X('f')), v3.nullLine(), v3.nullLine(), S3('∮'))))), /<mo>∮<\/mo><mi>f<\/mi>/);
});

test('a display pile of two equations becomes a one-column table', () => {
  const mml = conv(v3.eqn(v3.pile(4, v3.line(X('x'), S3('='), N3('1')), v3.line(X('y'), S3('='), N3('2')))));
  assert.equal(mml, M('<mtable><mtr><mtd><mrow><mi>x</mi><mo>=</mo><mn>1</mn></mrow></mtd></mtr><mtr><mtd><mrow><mi>y</mi><mo>=</mo><mn>2</mn></mrow></mtd></mtr></mtable>'));
});

// ---------------------------------------------------------------------------------------
// Wrapping: Equation Native stream and OLE compound file
// ---------------------------------------------------------------------------------------
test('Equation Native (28-byte header) and a whole OLE object convert the same way', () => {
  const eq = CASES[0].v3;
  const want = conv(eq);
  assert.equal(equationNativeToMathML(equationNative(eq)), want);
  assert.equal(oleEquationToMathML(oleEquationObject(eq)), want);
  assert.equal(oleEquationToMathML(oleEquationObject(eq, { version: 4 })), want, '4096-byte-sector compound file');
  assert.deepEqual(readOleEquation(oleEquationObject(CASES[0].v5)), { mathml: conv(CASES[0].v5) });
});

// ---------------------------------------------------------------------------------------
// Unreadable input: an error, never a wrong equation
// ---------------------------------------------------------------------------------------
test('unreadable equations are reported as errors, not guessed', () => {
  assert.throws(() => conv([9, 1, 1, 3, 0, 0x0A, 0x01, 0x00]), (e) => e instanceof MtefError && /version 9/.test(e.message));
  assert.throws(() => conv(v3.eqn(v3.line(v3.tmpl(60, 0, v3.line(X('x')))))), (e) => e instanceof MtefError && /selector 60/.test(e.message));
  const full = CASES[1].v3;
  assert.throws(() => conv(full.slice(0, full.length - 6)), (e) => e instanceof MtefError && /ends/.test(e.message), 'truncated');
  assert.throws(() => conv(v5.eqn(v5.line(v5.char(FACE.SYMBOL, 0xE777)))), (e) => e instanceof MtefError && /E777/.test(e.message), 'unknown private-use character');
  assert.throws(() => conv(v3.eqn(v3.line())), (e) => e instanceof MtefError && /empty/.test(e.message));
  assert.throws(() => conv(v3.eqn(v3.line(N3('3'), v3.tmpl(40, 0, v3.line(N3('4'), N3('5')), v3.line(N3('1'), N3('5')))))), (e) => e instanceof MtefError && /long division/.test(e.message), 'long division is left to the transcriber');
  // readOleEquation never throws.
  assert.match(readOleEquation(new Uint8Array([5, 6, 7, 8])).error, /compound-file/);
  assert.match(readOleEquation(writeCfb([{ path: 'Something else', data: new Uint8Array(10) }])).error, /Equation Native/);
  assert.ok(readOleEquation(oleEquationObject([3, 1, 1, 3, 0, 0x0A, 0x01, 0x03, 13])).error);
});

test('fuzz: random bytes after a valid header never throw anything but MtefError', () => {
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 24; };
  for (let i = 0; i < 2000; i++) {
    const body = Array.from({ length: 5 + (i % 60) }, rnd);
    const bytes = i % 2 ? [3, 1, 1, 3, 0, ...body] : [...v5.header(), ...body];
    try { conv(bytes); } catch (e) { assert.ok(e instanceof MtefError, `iteration ${i}: ${e && e.stack}`); }
  }
});
