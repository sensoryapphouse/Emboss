// Word equations (OMML) -> MathML / LaTeX / braille: functions, brackets and accents
// (Emboss/docs/import-fix-list.md #31 and #32, task A84).
//
// The three problems, each seen in Paul's test file (w00-paul-test-word-doc-2.docx, the Fourier
// series f(x) = a0 + sum (an cos(n pi x/L) + bn sin(n pi x/L))):
//   1. m:func (sin, cos, log, lim ...) was imported as plain text (<mtext>cos</mtext>, LaTeX \text{cos}) instead
//      of a function application. The expected form is the standard one MathCAT understands:
//      <mi>cos</mi><mo>&#x2061;</mo> (ApplyFunction), LaTeX \cos (\operatorname{name} for an unknown name).
//   2. m:d brackets were plain <mo>(</mo>...<mo>)</mo>, so the print view showed small brackets round a fraction.
//      Word's brackets stretch (unless m:grow is 0): <mo fence="true" stretchy="true">, LaTeX \left( ... \right).
//   3. The vector-arrow accent (U+20D7, a COMBINING character) reached MathCAT as it was and came out spelled in
//      hex in the braille ("0020D7"). Combining accents are turned into the spacing characters MathCAT knows
//      (U+2192 arrow, ^, ~, macron, dot, diaeresis), LaTeX \vec / \hat / \tilde / \bar / \dot / \ddot.
//
// Rules behind the braille assertions: UEB Guidelines for Technical Material 2014 section 9.3 (a function name
// followed by a lower-case letter, or preceded by a letter, is spaced); Nemeth Code (a function abbreviation is
// followed by a space). MathCAT does the braille; these tests pin the MathML it is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { ommlElementToMathML } from '../input/omml.mjs';
import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';

const require = createRequire(import.meta.url);
const mathcat = require(fileURLToPath(new URL('../engine/mathcat/pkg-nodejs/emboss_mathcat.js', import.meta.url)));

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const omml = (inner) => new DOMParser().parseFromString(`<m:oMath xmlns:m="${M}">${inner}</m:oMath>`, 'application/xml').documentElement;
const toMathML = (inner) => ommlElementToMathML(omml(inner));
const toLatex = (inner) => mathmlToLatex(toMathML(inner)).replace(/\s+/g, ' ');
const ueb = (mml) => mathcat.mathml_to_braille(mml, 'UEB');
const nemeth = (mml) => mathcat.mathml_to_braille(mml, 'Nemeth');
const SP = '⠀';                                     // braille blank

const run = (t) => `<m:r><m:t>${t}</m:t></m:r>`;
const plain = (t) => `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>${t}</m:t></m:r>`;
const func = (name, arg) => `<m:func><m:fName>${plain(name)}</m:fName><m:e>${arg}</m:e></m:func>`;
const sub = (b, s) => `<m:sSub><m:e>${run(b)}</m:e><m:sub>${run(s)}</m:sub></m:sSub>`;
const frac = (n, d) => `<m:f><m:num>${run(n)}</m:num><m:den>${run(d)}</m:den></m:f>`;
const dlm = (props, ...bodies) => `<m:d><m:dPr>${props}</m:dPr>${bodies.map((b) => `<m:e>${b}</m:e>`).join('')}</m:d>`;

// ---------------------------------------------------------------------------------------------------------
// 1. Functions
// ---------------------------------------------------------------------------------------------------------
test('m:func: a known function name is <mi>name</mi> + ApplyFunction, never <mtext>', () => {
  const mml = toMathML(func('cos', run('x')));
  assert.match(mml, /<mi>cos<\/mi><mo>\u2061<\/mo><mi>x<\/mi>/, mml);
  assert.doesNotMatch(mml, /<mtext>/, mml);
});

test('m:func: function application is one three-child <mrow> (name, ApplyFunction, argument)', () => {
  // MathCAT\'s UEB rule for "a letter then a function name" looks for exactly this shape.
  const mml = toMathML(func('sin', frac('n', 'L')));
  assert.match(mml, /^<math display="block"><mrow><mi>sin<\/mi><mo>\u2061<\/mo><mfrac>.*<\/mfrac><\/mrow><\/math>$/, mml);
});

test('m:func: LaTeX is \\cos, \\sin, \\log, \\ln, \\max (not \\text{...})', () => {
  for (const n of ['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'arcsin', 'sinh']) {
    const latex = toLatex(func(n, run('x')));
    assert.equal(latex, `\\${n} x`, `${n}: ${latex}`);
  }
});

test('m:func: a name LaTeX has no command for becomes \\operatorname{name}', () => {
  assert.equal(toLatex(func('sgn', run('x'))), '\\operatorname{sgn} x');
  assert.equal(toLatex(func('cosec', run('x'))), '\\operatorname{cosec} x');
});

test('m:func: a name split over several runs is one function name', () => {
  const split = `<m:func><m:fName>${plain('c')}${plain('o')}${plain('s')}</m:fName><m:e>${run('x')}</m:e></m:func>`;
  assert.match(toMathML(split), /<mi>cos<\/mi><mo>\u2061<\/mo>/);
  assert.equal(toLatex(split), '\\cos x');
});

test('m:func: log with a subscript base keeps the function name: \\log_{2}x', () => {
  const log2 = `<m:func><m:fName><m:sSub><m:e>${plain('log')}</m:e><m:sub>${run('2')}</m:sub></m:sSub></m:fName><m:e>${run('x')}</m:e></m:func>`;
  const mml = toMathML(log2);
  assert.match(mml, /<msub><mi>log<\/mi><mn>2<\/mn><\/msub><mo>\u2061<\/mo><mi>x<\/mi>/, mml);
  assert.equal(toLatex(log2), '\\log_{2}x');
});

test('m:func: a squared function (sin^2 x) keeps the name as the base of the superscript', () => {
  const sin2 = `<m:func><m:fName><m:sSup><m:e>${plain('sin')}</m:e><m:sup>${run('2')}</m:sup></m:sSup></m:fName><m:e>${run('x')}</m:e></m:func>`;
  assert.match(toMathML(sin2), /<msup><mi>sin<\/mi><mn>2<\/mn><\/msup><mo>\u2061<\/mo>/);
  assert.equal(toLatex(sin2), '\\sin^{2}x');
});

test('limits: lim with a limit below it (inside m:func, or alone) is \\lim_{x\\to 0}', () => {
  const limLow = `<m:limLow><m:e>${plain('lim')}</m:e><m:lim>${run('x→0')}</m:lim></m:limLow>`;
  assert.equal(toLatex(limLow), '\\lim_{x\\to 0}');
  assert.match(toMathML(limLow), /<munder><mi>lim<\/mi>/);
  const inFunc = `<m:func><m:fName>${limLow}</m:fName><m:e>${run('f')}${dlm('', run('x'))}</m:e></m:func>`;
  assert.equal(toLatex(inFunc), '\\lim_{x\\to 0} f\\left(x\\right)');
});

test('limits: max and min with a limit below keep working', () => {
  const maxLow = `<m:func><m:fName><m:limLow><m:e>${plain('max')}</m:e><m:lim>${run('x')}</m:lim></m:limLow></m:fName><m:e>${run('f')}</m:e></m:func>`;
  assert.equal(toLatex(maxLow), '\\max_{x} f');
});

test('m:func: a function with no argument keeps just its name (no dangling ApplyFunction)', () => {
  const mml = toMathML(`<m:func><m:fName>${plain('sin')}</m:fName><m:e/></m:func>`);
  assert.match(mml, /<mi>sin<\/mi>/);
  assert.doesNotMatch(mml, /\u2061/);
  assert.doesNotMatch(mml, /<mtext>/);
});

test('braille: the function is a function (a_n cos x): Nemeth and UEB read it as cos, separated from what follows', () => {
  const mml = toMathML(sub('a', 'n') + func('cos', frac('nπx', 'L')));
  const u = ueb(mml);
  const n = nemeth(mml);
  // function name is followed directly by the fraction (Nemeth: a space after the abbreviation)
  assert.match(n, /⠉⠕⠎⠀⠹/, `Nemeth: ${n}`);
  // UEB Technical Guidelines 9.3.3: a function name preceded directly by a letter (here the subscript n) is spaced
  assert.ok(u.includes('⠝' + SP + '⠉⠕⠎'), `UEB has no space between subscript n and cos: ${u}`);
});

test('braille: a_n cos x + b_n sin x (two functions after subscripts) — UEB spaces each function from its subscript', () => {
  const mml = toMathML(sub('a', 'n') + func('cos', run('x')) + run('+') + sub('b', 'n') + func('sin', run('x')));
  const u = ueb(mml);
  assert.ok(u.includes('⠝' + SP + '⠉⠕⠎'), `cos not spaced: ${u}`);
  assert.ok(u.includes('⠝' + SP + '⠎'), `sin not spaced: ${u}`);    // sin = s + "in" contraction
});

test('braille: a function after an ordinary letter is unchanged (y cos x keeps MathCAT\'s own spacing)', () => {
  const mml = toMathML(run('y') + func('cos', run('x')));
  assert.equal(mml.includes('mspace'), false, mml);
});

// ---------------------------------------------------------------------------------------------------------
// 2. Delimiters
// ---------------------------------------------------------------------------------------------------------
const FENCE = (c) => `<mo fence="true" stretchy="true">${c}</mo>`;

test('m:d: default brackets are stretchy fences', () => {
  const mml = toMathML(dlm('', run('x')));
  assert.equal(mml, `<math display="block"><mrow>${FENCE('(')}<mi>x</mi>${FENCE(')')}</mrow></math>`);
});

test('m:d: begChr / endChr are honoured', () => {
  const mml = toMathML(dlm('<m:begChr m:val="["/><m:endChr m:val="]"/>', run('x')));
  assert.equal(mml, `<math display="block"><mrow>${FENCE('[')}<mi>x</mi>${FENCE(']')}</mrow></math>`);
});

test('m:d: an empty begChr or endChr means no bracket on that side, marked by an empty fence', () => {
  const mml = toMathML(dlm('<m:begChr m:val=""/><m:endChr m:val="}"/>', run('x')));
  assert.equal(mml, `<math display="block"><mrow><mo fence="true" stretchy="true"></mo><mi>x</mi>${FENCE('}')}</mrow></math>`);
  assert.equal(toLatex(dlm('<m:begChr m:val=""/><m:endChr m:val="}"/>', run('x'))), '\\left.x\\right\\}');
  assert.equal(toLatex(dlm('<m:begChr m:val="{"/><m:endChr m:val=""/>', run('x'))), '\\left\\{x\\right.');
});

test('m:d: m:grow 0 (brackets not stretched) gives stretchy="false" and plain brackets in LaTeX', () => {
  const inner = dlm('<m:grow m:val="0"/>', run('x'));
  assert.match(toMathML(inner), /<mo fence="true" stretchy="false">\(<\/mo>/);
  assert.equal(toLatex(inner), '(x)');
});

test('m:d: m:grow 1 or absent stretches; m:shp (centred / match) does not change the brackets', () => {
  assert.match(toMathML(dlm('<m:grow m:val="1"/><m:shp m:val="match"/>', run('x'))), /stretchy="true"/);
  assert.match(toMathML(dlm('<m:shp m:val="centered"/>', run('x'))), /stretchy="true"/);
});

test('m:d: several arguments are joined by sepChr (Word\'s default is |, not a comma)', () => {
  const comma = dlm('<m:sepChr m:val=","/>', run('a'), run('b'), run('c'));
  assert.equal(toMathML(comma), `<math display="block"><mrow>${FENCE('(')}<mi>a</mi><mo separator="true">,</mo><mi>b</mi><mo separator="true">,</mo><mi>c</mi>${FENCE(')')}</mrow></math>`);
  assert.equal(toLatex(comma), '\\left(a, b, c\\right)');
  const bar = dlm('', run('a'), run('b'));
  assert.match(toMathML(bar), /<mi>a<\/mi><mo separator="true">\|<\/mo><mi>b<\/mi>/);
});

test('m:d: LaTeX is \\left( ... \\right) round a fraction', () => {
  assert.equal(toLatex(dlm('', frac('a', 'b'))), '\\left(\\frac{a}{b}\\right)');
});

test('m:d: each kind of bracket has its LaTeX form', () => {
  const one = (b, e) => toLatex(dlm(`<m:begChr m:val="${b}"/><m:endChr m:val="${e}"/>`, run('x')));
  assert.equal(one('[', ']'), '\\left[x\\right]');
  assert.equal(one('{', '}'), '\\left\\{x\\right\\}');
  assert.equal(one('|', '|'), '\\left|x\\right|');
  assert.equal(one('⟨', '⟩'), '\\left\\langle x\\right\\rangle');
  assert.equal(one('⌊', '⌋'), '\\left\\lfloor x\\right\\rfloor');
  assert.equal(one('⌈', '⌉'), '\\left\\lceil x\\right\\rceil');
  assert.equal(one('‖', '‖'), '\\left\\|x\\right\\|');
});

test('m:d: the braille is what it was (MathCAT ignores the fence flags)', () => {
  const mml = toMathML(dlm('', frac('a', 'b')));
  assert.equal(nemeth(mml), '⠷⠹⠁⠌⠃⠼⠾');                 // (a/b) fraction in brackets
  assert.equal(ueb(mml), '⠰⠰⠐⠣⠷⠁⠨⠌⠃⠾⠐⠜');
});

test('m:d: the function argument form sin(x) is a function applied to a bracketed argument', () => {
  const mml = toMathML(func('sin', dlm('', run('x'))));
  assert.match(mml, /<mi>sin<\/mi><mo>\u2061<\/mo><mrow><mo fence="true" stretchy="true">\(<\/mo><mi>x<\/mi>/, mml);
  assert.equal(toLatex(func('sin', dlm('', run('x')))), '\\sin \\left(x\\right)');
});

// ---------------------------------------------------------------------------------------------------------
// 3. Accents
// ---------------------------------------------------------------------------------------------------------
const acc = (chr, base) => `<m:acc><m:accPr>${chr === null ? '' : `<m:chr m:val="${chr}"/>`}</m:accPr><m:e>${run(base)}</m:e></m:acc>`;
const COMBINING = /[\u0300-\u036F\u20D0-\u20FF]/;

test('accent: vector arrow (U+20D7, combining) becomes the spacing arrow U+2192 and \\vec', () => {
  const mml = toMathML(acc('\u20D7', 'v'));
  assert.equal(mml, '<math display="block"><mover accent="true"><mi>v</mi><mo>→</mo></mover></math>');
  assert.equal(toLatex(acc('\u20D7', 'v')), '\\vec{v}');
});

test('accent: the braille of a vector has no hex escape in UEB or Nemeth', () => {
  const mml = toMathML(acc('\u20D7', 'v'));
  const u = ueb(mml);
  const n = nemeth(mml);
  assert.doesNotMatch(u, /⠸⠡⠭/, `UEB hex escape: ${u}`);          // the "\x" hex marker
  assert.doesNotMatch(n, /⠸⠡⠭/, `Nemeth hex escape: ${n}`);
  assert.doesNotMatch(u + n, /⠼⠚⠚⠃⠚/, 'the digits 0020D7 are spelled out');
  // and it is the same braille as a plain arrow accent
  const plainArrow = '<math><mover accent="true"><mi>v</mi><mo>→</mo></mover></math>';
  assert.equal(u, ueb(plainArrow));
  assert.equal(n, nemeth(plainArrow));
});

test('accent: every combining accent Word uses becomes a spacing character MathCAT can braille', () => {
  const cases = [
    ['\u0302', '^', '\\hat'], ['\u0303', '~', '\\tilde'], ['\u0304', '¯', '\\bar'], ['\u0305', '¯', '\\bar'],
    ['\u0307', '˙', '\\dot'], ['\u0308', '..', '\\ddot'], ['\u20D7', '→', '\\vec'],
  ];
  for (const [chr, spacing, tex] of cases) {
    const mml = toMathML(acc(chr, 'x'));
    assert.doesNotMatch(mml, COMBINING, `combining character left in: ${mml}`);
    assert.ok(mml.includes(`<mo>${spacing}</mo>`), `${chr.codePointAt(0).toString(16)}: ${mml}`);
    assert.equal(toLatex(acc(chr, 'x')), `${tex}{x}`);
    assert.doesNotMatch(ueb(mml), /⠸⠡⠭/, `UEB hex escape for ${chr.codePointAt(0).toString(16)}`);
    assert.doesNotMatch(nemeth(mml), /⠸⠡⠭/, `Nemeth hex escape for ${chr.codePointAt(0).toString(16)}`);
  }
});

test('accent: triple dot (U+20DB) is three full stops; the print view writes it as dots over x (MathLive has no \\dddot)', () => {
  assert.ok(toMathML(acc('\u20DB', 'x')).includes('<mo>...</mo>'));
  assert.equal(toLatex(acc('\u20DB', 'x')), '\\overset{\\cdot\\cdot\\cdot}{x}');
  assert.doesNotMatch(nemeth(toMathML(acc('\u20DB', 'x'))), /\u2838\u2821\u282d/);
});

test('accent: no m:chr means Word\'s default, a hat', () => {
  assert.equal(toLatex(acc(null, 'x')), '\\hat{x}');
  assert.doesNotMatch(toMathML(acc(null, 'x')), COMBINING);
});

test('accent: a spacing character already in the file is kept', () => {
  assert.ok(toMathML(acc('→', 'v')).includes('<mo>→</mo>'));
  assert.equal(toLatex(acc('→', 'v')), '\\vec{v}');
});

test('accent: left arrow and left-right arrow accents', () => {
  assert.ok(toMathML(acc('\u20D6', 'v')).includes('<mo>←</mo>'));
  assert.ok(toMathML(acc('\u20E1', 'v')).includes('<mo>↔</mo>'));
  assert.equal(toLatex(acc('\u20D6', 'v')), '\\overleftarrow{v}');
  assert.equal(toLatex(acc('\u20E1', 'v')), '\\overleftrightarrow{v}');
});

// ---------------------------------------------------------------------------------------------------------
// The whole Fourier series of Paul's test file (w00-paul-test-word-doc-2.docx), as Word wrote it
// ---------------------------------------------------------------------------------------------------------
const FOURIER = `${run('f')}${dlm('', run('x'))}${run('=')}${sub('a', '0')}${run('+')}` +
  `<m:nary><m:naryPr><m:chr m:val="∑"/><m:grow m:val="1"/></m:naryPr><m:sub>${run('n=1')}</m:sub><m:sup>${run('∞')}</m:sup>` +
  `<m:e>${dlm('', sub('a', 'n') + func('cos', frac('nπx', 'L')) + run('+') + sub('b', 'n') + func('sin', frac('nπx', 'L')))}</m:e></m:nary>`;

test('Fourier series from Paul\'s test file: LaTeX has \\cos and \\sin and stretchy brackets', () => {
  assert.equal(toLatex(FOURIER),
    'f\\left(x\\right) = a_{0} + \\sum_{n = 1}^{∞} \\left(a_{n} \\cos \\frac{nπx}{L} + b_{n} \\sin \\frac{nπx}{L}\\right)');
});

test('Fourier series: UEB and Nemeth braille separate the function names', () => {
  const mml = toMathML(FOURIER);
  const u = ueb(mml);
  const n = nemeth(mml);
  assert.ok(!u.startsWith('ERROR') && !n.startsWith('ERROR'), `${u} / ${n}`);
  assert.ok(u.includes('⠝' + SP + '⠉⠕⠎'), `UEB: ${u}`);      // n, space, cos
  assert.ok(u.includes('⠝' + SP + '⠎⠊⠝') || u.includes('⠝' + SP + '⠎'), `UEB sin: ${u}`);
});

// ---------------------------------------------------------------------------------------------------------
// MathML -> LaTeX for the MathML other readers write (ODT / LibreOffice, .doc / MathType, MathLive):
// the same three problems, found in engine/mathml-to-latex.mjs (import fix list #31, "ODT, RTF")
// ---------------------------------------------------------------------------------------------------------
const tex = (mml) => mathmlToLatex(`<math>${mml}</math>`).replace(/\s+/g, ' ');

test('MathML to LaTeX: a stretchy fenced <mrow> is \\left ... \\right (LibreOffice scalable brackets, MathLive)', () => {
  assert.equal(tex('<mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mrow><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow><mo fence="true" form="postfix" stretchy="true">)</mo></mrow>'),
    '\\left(\\frac{a}{b}\\right)');
  assert.equal(tex('<mrow><mo fence="true" stretchy="true">{</mo><mi>a</mi><mo fence="true" stretchy="true">}</mo></mrow>'), '\\left\\{a\\right\\}');
});

test('MathML to LaTeX: brackets without the fence flag, or with stretchy="false", stay plain', () => {
  assert.equal(tex('<mrow><mo>(</mo><mi>a</mi><mo>)</mo></mrow>'), '(a)');
  assert.equal(tex('<mrow><mo stretchy="false">(</mo><mi>a</mi><mo stretchy="false">)</mo></mrow>'), '(a)');
  assert.equal(tex('<mrow><mo fence="true" stretchy="false">(</mo><mi>a</mi><mo fence="true" stretchy="false">)</mo></mrow>'), '(a)');
});

test('MathML to LaTeX: an empty fence is \\left. / \\right.', () => {
  assert.equal(tex('<mrow><mo fence="true" stretchy="true">{</mo><mi>x</mi><mo fence="true" stretchy="true"></mo></mrow>'), '\\left\\{x\\right.');
});

test('MathML to LaTeX: mfenced with open="" is \\left. (an empty attribute is not the default bracket)', () => {
  assert.equal(tex('<mfenced open="" close="]"><mi>x</mi></mfenced>'), '\\left.x\\right]');
  assert.equal(tex('<mfenced><mi>x</mi></mfenced>'), '\\left(x\\right)');
});

test('MathML to LaTeX: an <mtext> that is only an operator is the operator, not upright text (LibreOffice writes "+" this way)', () => {
  assert.equal(tex('<mrow><mi>a</mi><mtext>+</mtext><mi>b</mi><mtext>=</mtext><mn>1</mn></mrow>'), 'a + b = 1');
  assert.equal(tex('<mrow><mtext>-</mtext><mi>b</mi></mrow>'), '- b');
});

test('MathML to LaTeX: prose in an <mtext> stays \\text{}', () => {
  assert.equal(tex('<mrow><mi>x</mi><mtext> if </mtext><mi>y</mi></mrow>'), 'x\\text{ if }y');
});

test('MathML to LaTeX: an <mtext> that is a function name (MathType / .doc) is the function', () => {
  assert.equal(tex('<mrow><mtext>sin</mtext><mi>x</mi></mrow>'), '\\sin x');
  assert.equal(tex('<mrow><mtext>log</mtext><mi>x</mi></mrow>'), '\\log x');
});

test('MathML to LaTeX: an <mi> applied as a function (U+2061) with no LaTeX command is \\operatorname', () => {
  assert.equal(tex('<mi>sgn</mi><mo>\u2061</mo><mi>x</mi>'), '\\operatorname{sgn} x');
  assert.equal(tex('<mi>sgn</mi><mi>x</mi>'), '\\mathrm{sgn}x');            // not applied: still a word of variables
  assert.equal(tex('<mi>cos</mi><mo>\u2061</mo><mi>x</mi>'), '\\cos x');
});

test('MathML to LaTeX: lim, max, min below a limit are subscripts: \\lim_{x\\to 0}, \\max_{x}', () => {
  assert.equal(tex('<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder>'), '\\lim_{x\\to 0}');
  assert.equal(tex('<munder><mi>max</mi><mi>x</mi></munder>'), '\\max_{x}');
});

test('MathML to LaTeX: accent marks (spacing and combining forms)', () => {
  const over = (mark) => tex(`<mover accent="true"><mi>x</mi><mo>${mark}</mo></mover>`);
  assert.equal(over('→'), '\\vec{x}');
  assert.equal(over('\u20D7'), '\\vec{x}');
  assert.equal(over('^'), '\\hat{x}');
  assert.equal(over('~'), '\\tilde{x}');
  assert.equal(over('¯'), '\\bar{x}');
  assert.equal(over('˙'), '\\dot{x}');
  assert.equal(over('..'), '\\ddot{x}');
  assert.equal(over('´'), '\\acute{x}');
  assert.equal(over('ˇ'), '\\check{x}');
  assert.equal(over('˘'), '\\breve{x}');
});
