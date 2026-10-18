// Maths edge cases — audit items E-1 (Nemeth matrix row separator), E-3 (empty
// / untranslatable MathML) and E-4 (non-BMP characters through liblouis).
//
// Run from Emboss/:  node --test tests/maths_edge_cases.test.mjs
//
// engine/maths.mjs is the shipped BROWSER module: it imports the pkg-web
// MathCAT build and brf-ascii.mjs by absolute site path ('/engine/…'), which
// Node cannot resolve. Rather than test a Node-side mirror of its logic (the
// approach format/test-maths.mjs takes), a module resolve hook redirects the
// pkg-web import to a tiny shim over the CommonJS pkg-nodejs build (same
// rules, same wasm crate) and '/engine/*' to the files on disk, so the REAL
// mathmlToBrf / isEmptyMathML / cleanMathCatBraille are exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import * as louis from '../engine/louis.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';
import { formatDocument } from '../format/document.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMB = path.resolve(__dirname, '..');
const projectRoot = fs.existsSync(path.join(EMB, '..', 'liblouis', 'tables')) ? path.resolve(EMB, '..') : EMB;

const MATHCAT_SHIM = 'data:text/javascript,' + encodeURIComponent(`
  import { createRequire } from 'node:module';
  const require = createRequire(${JSON.stringify(pathToFileURL(path.join(EMB, 'tests', 'shim.mjs')).href)});
  const mc = require(${JSON.stringify(path.join(EMB, 'engine', 'mathcat', 'pkg-nodejs', 'emboss_mathcat.js'))});
  export default async function init() {}
  export const mathml_to_braille = mc.mathml_to_braille;
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '/engine/mathcat/pkg-web/emboss_mathcat.js') return { url: MATHCAT_SHIM, shortCircuit: true };
    if (specifier.startsWith('/engine/')) return { url: pathToFileURL(path.join(EMB, specifier)).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const maths = await import(pathToFileURL(path.join(EMB, 'engine', 'maths.mjs')).href);
await maths.initMaths();
await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;

// Capture console.warn for the duration of fn; returns { result, warns }.
function withWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  try { return { result: fn(), warns }; } finally { console.warn = orig; }
}

const ERROR_MARKER = unicodeBrailleToBrf('⠌⠼');        // the old silent error injection
const MATRIX_3x2 = '<math><mrow><mo>(</mo><mtable>'
  + '<mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr>'
  + '<mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr>'
  + '<mtr><mtd><mn>5</mn></mtd><mtd><mn>6</mn></mtd></mtr>'
  + '</mtable><mo>)</mo></mrow></math>';

// ---------------------------------------------------------------- E-1 ----
test('E-1: Nemeth matrix rows come out on separate lines, with no M cell from U+28CD', () => {
  const { result: brf, warns } = withWarns(() => maths.mathmlToBrf(MATRIX_3x2, 'bana'));
  assert.equal(warns.length, 0, 'the row separator is expected, not an error: ' + warns.join(' | '));
  const rows = brf.split('\n');
  assert.equal(rows.length, 3, 'three rows on three lines: ' + JSON.stringify(brf));
  assert.ok(!brf.includes('M'), 'no masked U+28CD row-separator cell: ' + JSON.stringify(brf));
  assert.ok(rows[0].includes('#1 #2'), 'row 1: ' + JSON.stringify(rows[0]));
  assert.ok(rows[1].includes('3 #4'), 'row 2: ' + JSON.stringify(rows[1]));
  assert.ok(rows[2].includes('5 #6'), 'row 3: ' + JSON.stringify(rows[2]));
  assert.ok(brf.startsWith(unicodeBrailleToBrf('⠸⠩') + ' '), 'still wrapped in the Nemeth opening indicator');
  assert.ok(brf.endsWith(' ' + unicodeBrailleToBrf('⠸⠱')), 'still wrapped in the Nemeth terminator');
  for (const r of rows) assert.ok(!/\s$/.test(r) || r === rows[2], 'no trailing blank left before a row break: ' + JSON.stringify(r));
});

test('E-1: the matrix rows survive the formatter as separate braille lines (display block and inline)', () => {
  const opts = { mode: 'bana', width: 38, depth: 25, translate: (t) => louis.translate(t, T), mathToBrf: (seg) => maths.mathToBrf(seg, 'bana') };
  // formatDocument appends the page-number line (right-aligned `#A`); it is not a row.
  const isPageNo = (l) => /^\s*#[A-J]+$/.test(l);
  const block = formatDocument({ blocks: [{ type: 'math', mathml: MATRIX_3x2 }] }, opts);
  const lines = block.split('\r\n').filter((l) => l.trim() && !isPageNo(l));
  assert.equal(lines.length, 3, 'display maths: one braille line per row: ' + JSON.stringify(lines));
  assert.ok(lines.every((l) => !l.includes('M')), 'no M cell in any row: ' + JSON.stringify(lines));
  const inline = formatDocument({ blocks: [{ type: 'para', segments: [{ type: 'text', text: 'See' }, { type: 'math', mathml: MATRIX_3x2 }, { type: 'text', text: 'here.' }] }] }, opts);
  const ilines = inline.split('\r\n').filter((l) => l.trim() && !isPageNo(l));
  assert.ok(ilines.length >= 3, 'inline maths: the rows still break lines: ' + JSON.stringify(ilines));
  assert.ok(ilines.every((l) => !l.includes('M')), 'no M cell inline: ' + JSON.stringify(ilines));
});

test('E-1: UEB matrix output is unaffected and raises no warning', () => {
  const { result: brf, warns } = withWarns(() => maths.mathmlToBrf(MATRIX_3x2, 'ueb'));
  assert.equal(warns.length, 0, warns.join(' | '));
  assert.ok(brf.length > 0);
  assert.ok(!brf.includes('\n'), 'UEB has no row separator to translate: ' + JSON.stringify(brf));
});

test('E-1: any other dots-7/8 cell is reduced to 6 dots with ONE console.warn naming the code points', () => {
  const { result, warns } = withWarns(() => maths.cleanMathCatBraille('⠁⣁⢃⣁'));
  assert.equal(result, '⠁⠁⠃⠁');
  assert.equal(warns.length, 1, 'exactly one warning per translation');
  assert.ok(warns[0].includes('U+28C1') && warns[0].includes('U+2883'), warns[0]);
  // The row separator itself is handled silently and becomes a newline.
  const sep = withWarns(() => maths.cleanMathCatBraille('⠼⠂⠀⣍⠒'));
  assert.equal(sep.result, '⠼⠂\n⠒');
  assert.equal(sep.warns.length, 0);
});

// ---------------------------------------------------------------- E-3 ----
const EMPTY_MATH = [
  '<math></math>',
  '<math>  \n </math>',
  '<math><mrow/></math>',
  '<math><mrow></mrow></math>',
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow><mrow></mrow></mrow></math>',
  '<math><semantics><mrow/><annotation encoding="application/x-tex">x^2</annotation></semantics></math>',
  '<math><!-- nothing --><mstyle displaystyle="true"></mstyle></math>',
  '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mrow/></m:math>',
];

test('E-3: empty MathML → empty string in both codes (no ⠿/⠬ wrapped in switch indicators)', () => {
  for (const mml of EMPTY_MATH) {
    assert.equal(maths.isEmptyMathML(mml), true, 'isEmptyMathML: ' + mml);
    for (const mode of ['bana', 'ueb']) {
      const { result, warns } = withWarns(() => maths.mathmlToBrf(mml, mode));
      assert.equal(result, '', `${mode}: ${mml}`);
      assert.equal(warns.length, 0, `${mode}: no warning for legitimately empty maths: ${mml}`);
    }
  }
  assert.equal(maths.isEmptyMathML(null), true);
  assert.equal(maths.isEmptyMathML(''), true);
});

test('E-3: real content is not mistaken for empty', () => {
  for (const mml of [
    '<math><mi>x</mi></math>',
    '<math><mrow><mn>2</mn></mrow></math>',
    '<math><mi></mi></math>',                 // an empty token is still an element for MathCAT to judge
    '<math><mspace width="1em"/></math>',
    '<math><semantics><mi>y</mi><annotation>y</annotation></semantics></math>',
  ]) assert.equal(maths.isEmptyMathML(mml), false, mml);
  assert.equal(maths.mathmlToBrf('<math><msup><mi>x</mi><mn>2</mn></msup></math>', 'ueb'), unicodeBrailleToBrf('⠭⠰⠔⠼⠃'));
});

// S2b item 11 (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md #11) CHANGES this test's old expectation: a MathCAT error used
// to come back as '' and the formatter dropped the equation without a word. A rejected NON-EMPTY equation is now a thrown failure
// (mathRejected); the formatter shows the "Equation could not be read" note and raises a warning (tests/s2b_rejected_maths.test.mjs).
test('E-3 / S2b #11: MathCAT error → a thrown mathRejected failure plus console.warn, never an injected ⠌⠼ marker and never a silent empty string', () => {
  for (const mml of [
    '<math><mfrac><mn>1</mn></mfrac></math>',    // mfrac needs two children
    '<math><mi>x</math>',                        // not well-formed XML
  ]) {
    for (const mode of ['bana', 'ueb']) {
      const { warns } = withWarns(() => { try { maths.mathmlToBrf(mml, mode); assert.fail('it should have thrown: ' + mml); } catch (e) { assert.equal(e.mathRejected, true, `${mode}: ${mml}: ${e.message}`); } });
      assert.equal(warns.length, 1, `${mode}: one warning surfaced for ${mml}: ${warns.join(' | ')}`);
      assert.ok(/MathCAT/.test(warns[0]), warns[0]);
    }
  }
  // The formatter keeps the text round the equation and marks its place (the rest is in tests/s2b_rejected_maths.test.mjs).
  const opts = { mode: 'ukaaf', width: 38, depth: 25, translate: (t) => louis.translate(t, T), mathToBrf: (seg) => maths.mathToBrf(seg, 'ueb') };
  const { result: out } = withWarns(() => formatDocument({ blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'Before' }, { type: 'math', mathml: '<math><mfrac><mn>1</mn></mfrac></math>' }, { type: 'text', text: 'after.' }] },
  ] }, opts));
  assert.ok(!out.includes(ERROR_MARKER), out);
  assert.ok(!out.includes('\\'), out);
  assert.ok(/@\.</.test(out.replace(/[\r\n\f]/g, '')), 'the transcriber\'s note stands where the equation was: ' + out);
  assert.equal((opts.warnings || []).filter((w) => w.kind === 'math-unreadable').length, 1);
});

// ---------------------------------------------------------------- E-4 ----
test('E-4: translate("a 𝑥 b") folds the mathematical italic x to a plain letter — no \\X escapes', () => {
  for (const table of [louis.TABLES.uebG2, louis.TABLES.uebG1]) {
    const got = louis.translate('a 𝑥 b', table);
    assert.equal(got, louis.translate('a x b', table), table);
    assert.ok(!/[\\'"]/.test(got), 'no backslash/quote garbage: ' + JSON.stringify(got));
  }
  assert.equal(louis.translate('𝐀𝐁 𝟘', T), louis.translate('AB 0', T));
  // BMP compatibility characters are deliberately NOT NFKC-folded: liblouis
  // brailles them natively (superscript indicator, fraction) and a fold would
  // lose that. Guard against someone "simplifying" to a whole-string normalize.
  assert.equal(louis.translate('x² ½', T), 'X;9#B #A/B');
});

// A78 (Paul's decision, 28 Sep 2026, docs/decisions.md ICON-1): this test used to pin
// foldNonBmp pre-substituting a single full-cell placeholder for any unfoldable non-BMP
// character, so a bare louis.translate() call never saw liblouis's own undefined-character
// escape for one. That silently hid the character from format/document.mjs's scrub layer too
// (scanUndefinedEscapes/assignIconSymbol), so it could never become a BANA transcriber-defined
// icon symbol and UKAAF never raised its lou-undefined-char warning for it — audit item A78
// closes that gap (see engine/louis.mjs's own "Non-BMP input" comment and
// tests/emoji_icons.test.mjs for the document-level BANA/UKAAF coverage this enables).
// foldNonBmp now keeps an unfoldable code point's two surrogate units intact instead, so a bare
// translate()/translatePos() call gets the raw '\Xhhhh' escape per unit — exactly what it
// already returns for an ordinary undefined BMP character (e.g. ⚠) — and it is the CALLER's job
// to scrub that, same as for any other undefined character; document.mjs's installScrub already
// does this for every real document.
test('E-4: emoji and other unfoldable non-BMP input reach translate() as liblouis\'s own undefined-char escape, one per surrogate half (A78)', () => {
  const got = louis.translate('a 😀 b', T);
  // 😀 U+1F600 = high surrogate D83D, low surrogate DE00.
  assert.equal(got, "A '\\XD83D''\\XDE00' ;B", JSON.stringify(got));
  assert.ok(!got.includes('='), 'no pre-substituted full-cell placeholder — A78 moved that decision to the caller (document.mjs: BANA icon symbol, UKAAF full cell + warning)');
  // Unicode-braille display table: liblouis's undefined-char escape is still raised (its own
  // ASCII text then goes through the Unicode display table like any other output, so the exact
  // cells differ from the .dis table above — only the "no silent full-cell placeholder" claim
  // is checked here).
  assert.notEqual(louis.translate('a 😀 b', louis.TABLES.uebG2_unicode), '⠁⠀⠿⠀⠰⠃', 'must not be the old silent full-cell placeholder');
  // Supplementary CJK, a lone (malformed) surrogate, and an emoji sequence: each now surfaces
  // liblouis's own escape too, rather than being silently swallowed.
  assert.ok(louis.translate('𠀋', T).includes('\\X'), louis.translate('𠀋', T));
  assert.ok(louis.translate('a\uD835 b', T).includes('\\X'), louis.translate('a\uD835 b', T));
  assert.ok(louis.translate('Hi 👋🏽!', T).includes('\\X'), louis.translate('Hi 👋🏽!', T));
});

test('E-4: translatePos keeps braille identical to translate() and indexes into the caller\'s string', () => {
  for (const s of ['a 𝑥 b', 'a 😀 b', '𝑡he', 'a𝑥𝑦b', 'The 𝑥 value', 'Hi 👋🏽!', 'a\uD835 b']) {
    const { braille, inputPos } = louis.translatePos(s, T);
    assert.equal(braille, louis.translate(s, T), 'identical braille for ' + JSON.stringify(s));
    assert.equal(inputPos.length, braille.length);
    assert.ok(inputPos.every((p) => Number.isInteger(p) && p >= 0 && p < s.length), `indices within the original string for ${JSON.stringify(s)}: ${JSON.stringify(inputPos)}`);
  }
  // 'a 𝑥 b' = a(0) ' '(1) 𝑥(2,3) ' '(4) b(5): the X cell maps to 2 and b's cells to 5.
  const r = louis.translatePos('a 𝑥 b', T);
  assert.equal(r.braille, 'A ;X ;B');
  assert.deepEqual(r.inputPos, [0, 1, 2, 2, 4, 5, 5]);
  // Contractions across a folded letter are preserved (a same-length filler would break the word).
  assert.equal(louis.translatePos('𝑡he', T).braille, louis.translate('the', T));
  assert.equal(louis.translatePos('𝑡he', T).braille, '!');
  // No non-BMP input: untouched fast path, positions exactly as before.
  assert.deepEqual(louis.translatePos('a x b', T).inputPos, [0, 1, 2, 2, 3, 4, 4]);
});

test('E-4: typeform arrays stay aligned when a surrogate pair collapses to one unit', () => {
  const B = louis.TYPEFORM.bold;
  assert.equal(louis.translate('a 𝑥 b', T, [0, 0, B, B, 0, 0]), louis.translate('a x b', T, [0, 0, B, 0, 0]));
  assert.equal(louis.translatePos('a 𝑥 b', T, [0, 0, B, B, 0, 0]).braille, louis.translate('a x b', T, [0, 0, B, 0, 0]));
  assert.equal(louis.translate('a 𝑥 b', T, [0, 0, 0, 0, 0, B]), louis.translate('a x b', T, [0, 0, 0, 0, B]));
});

test('E-4: louis.mjs and louis-browser.mjs carry the same non-BMP handling', () => {
  const grab = (f) => {
    const s = fs.readFileSync(path.join(EMB, 'engine', f), 'utf8');
    const a = s.indexOf('// ---- Non-BMP input'), b = s.indexOf('// Persistent reusable translation buffers');
    assert.ok(a >= 0 && b > a, f + ': helper block markers');
    return s.slice(a, b).replace(/kept identical to louis(-browser)?\.mjs/, 'kept identical');
  };
  assert.equal(grab('louis.mjs'), grab('louis-browser.mjs'));
  for (const f of ['louis.mjs', 'louis-browser.mjs']) {
    const s = fs.readFileSync(path.join(EMB, 'engine', f), 'utf8');
    assert.equal((s.match(/foldNonBmp\(String\(text\), typeform\)/g) || []).length, 2, f + ': both translate() and translatePos() fold');
    assert.ok(s.includes('posMap ? (posMap[p] ?? p) : p'), f + ': translatePos remaps inputPos');
  }
});

// A89 (random-action testing, seed 1982326777, Chrome): an equation typed in the editor is held as a bare fragment (no <math>
// root), and an empty slot left a "?" as loose text inside an <mfrac>. MathCAT rejected it, so the equation was missing from the
// braille — until a save, which wraps the fragment and puts loose text in <mtext> (nimas-export.mjs normalizeMathMl), made it
// appear after reopening. The maths engine now does the same before MathCAT sees it.
test('an editor fragment with loose text brailles, as the saved and reopened equation does', () => {
  const fragment = '<mfrac><mrow><mn>10</mn><mo>&lt;</mo><mn>12</mn></mrow><mrow><msup><mo>sin</mo><mn>8</mn></msup><mo>∑</mo><mfrac><mrow><mi>b</mi><mo>&#8290;</mo><mi>r</mi></mrow>?</mfrac><mi>n</mi></mrow></mfrac>';
  const tidy = '<math><mfrac><mrow><mn>10</mn><mo>&lt;</mo><mn>12</mn></mrow><mrow><msup><mo>sin</mo><mn>8</mn></msup><mo>∑</mo><mfrac><mrow><mi>b</mi><mo>&#8290;</mo><mi>r</mi></mrow><mtext>?</mtext></mfrac><mi>n</mi></mrow></mfrac></math>';
  for (const mode of ['ueb', 'nemeth']) {
    const want = withWarns(() => maths.mathmlToBrf(tidy, mode)).result;
    assert.ok(want, `sanity (${mode}): the tidy equation brailles`);
    assert.equal(withWarns(() => maths.mathmlToBrf(fragment, mode)).result, want, mode);
  }
});
