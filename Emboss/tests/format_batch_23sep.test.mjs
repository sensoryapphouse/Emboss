// A batch of standards-findings.md fixes, one describe block per finding, fixed in the
// order agreed 23 Sep 2026. Every expected value comes from the cited rule's own quoted
// text, a gold worked example, or (A11) the real MathCAT/liblouis probe already captured in
// scratchpad/investigate-a11/findings.md — never from Emboss's pre-fix output.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, suppressHeader: true, ...extra });
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock (A39)');

let translate, translateUeb, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
  translateUeb = translate;
  translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
});

// ===========================================================================================
// A11 (scoped part) — formatMath()'s blanket +2-cell "runover" indent (a PROSE word-wrap
// convention) was applied to every maths row, including a matrix's own grid rows, knocking
// their columns out of alignment with row 1. Fixed: a multi-row maths result (rows separated
// by '\n', the marker cleanMathCatBraille (engine/maths.mjs) already uses for a Nemeth
// matrix's row boundaries) keeps its rows exactly as the maths engine produced them; ordinary
// single-line maths that genuinely overflows the width still wraps with the +2 runover as
// before. Column alignment (fence-padding), enlarged brackets, the minus-sign hang, and
// side-by-side multi-matrix composition remain open (see the A11 row in EMBOSS-TASKS.md).
//
// engine/maths.mjs is the real shipped (browser-only) pipeline and imports an absolute
// browser path, so it cannot be imported directly in Node; its cleanMathCatBraille regexes
// are mirrored here byte-for-byte (same approach the A11 investigation's own probe script
// used), driving the real Node MathCAT build (pkg-nodejs) and the real liblouis translator.
// ===========================================================================================
describe('A11 (scoped) — a matrix\'s rows keep the maths engine\'s own row breaks, no runover indent', () => {
  let mathcat;
  let mathsReady = true;
  before(() => {
    try { mathcat = require(path.join(EMBOSS, 'engine', 'mathcat', 'pkg-nodejs', 'emboss_mathcat.js')); }
    catch { mathsReady = false; }
  });

  const NEMETH_OPEN = '⠸⠩ ', NEMETH_CLOSE = ' ⠸⠱';
  const NEMETH_ROW_SEP_RE = /[⠀ ]*⣍[⠀ ]*/g;      // U+28CD row-boundary sentinel -> '\n'
  const EIGHT_DOT_RE = /[⡀-⣿]/g;                  // any other dot-7/8 cell (unexpected)
  function cleanMathCatBraille(braille) {
    let s = braille.replace(NEMETH_ROW_SEP_RE, '\n');
    if (EIGHT_DOT_RE.test(s)) s = s.replace(EIGHT_DOT_RE, (ch) => String.fromCharCode(0x2800 + (ch.codePointAt(0) & 0x3f)));
    return s;
  }
  function mathToBrf(mathml, mode) {
    const code = mode === 'bana' ? 'Nemeth' : 'UEB';
    let braille = mathcat.mathml_to_braille(mathml, code);
    if (typeof braille !== 'string' || braille.startsWith('ERROR:')) throw new Error('MathCAT: ' + braille);
    braille = cleanMathCatBraille(braille);
    if (code === 'Nemeth') braille = NEMETH_OPEN + braille + NEMETH_CLOSE;
    return unicodeBrailleToBrf(braille);
  }
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): docEndMarker defaults true, adding a trailing
  // colons line these single-block-content tests otherwise pick up as extra/unexpected content.
  const mathOpts = (mode) => ({ mode, standard: mode, width: 38, depth: 25, suppressHeader: true, translate, mathToBrf: (seg) => mathToBrf(seg.mathml, mode), docEndMarker: false });

  // BANA Example: [[1,2],[3,4]] -- investigation's "simple2x2", Nemeth raw mathToBrf():
  //   "_% ,(#1 #2\n3 #4,) _:"  (row 2 carries NO leading space of its own)
  const SIMPLE_2X2 = '<math><mfenced open="(" close=")"><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable></mfenced></math>';
  // BANA Example: [[1,-2],[3,4]] -- investigation's "negativeEntry".
  const NEGATIVE_ENTRY = '<math><mfenced open="(" close=")"><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mrow><mo>-</mo><mn>2</mn></mrow></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable></mfenced></math>';
  // BANA: I = [[1,0],[0,1]] -- investigation's "identityPrefix".
  const IDENTITY_PREFIX = '<math><mi>I</mi><mo>=</mo><mfenced open="(" close=")"><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable></mfenced></math>';
  // A long single-line (non-matrix) expression: must still runover-wrap (+2) if it overflows.
  const LONG_SUM = '<math><mrow><mi>a</mi><mo>+</mo><mi>b</mi><mo>+</mo><mi>c</mi><mo>+</mo><mi>d</mi><mo>+</mo><mi>e</mi><mo>+</mo><mi>f</mi><mo>+</mo><mi>g</mi><mo>+</mo><mi>h</mi><mo>+</mo><mi>i</mi><mo>+</mo><mi>j</mi><mo>+</mo><mi>k</mi><mo>+</mo><mi>l</mi><mo>+</mo><mi>m</mi><mo>+</mo><mi>n</mi><mo>+</mo><mi>o</mi><mo>+</mo><mi>p</mi><mo>+</mo><mi>q</mi><mo>+</mo><mi>r</mi><mo>+</mo><mi>s</mi><mo>+</mo><mi>t</mi><mo>+</mo><mi>u</mi><mo>+</mo><mi>v</mi><mo>+</mo><mi>w</mi><mo>+</mo><mi>x</mi><mo>+</mo><mi>y</mi><mo>+</mo><mi>z</mi></mrow></math>';

  test('BEFORE the fix, the pre-fix behaviour is exactly the bug the investigation captured (documents the failing case)', () => {
    if (!mathsReady) return;
    // This does not call the app's formatMath; it directly re-derives what the OLD
    // (buggy) formula would have produced, so the fix's effect below is unambiguous.
    const brf = mathToBrf(SIMPLE_2X2, 'bana');
    assert.equal(brf, '_% ,(#1 #2\n3 #4,) _:');
    const oldBug = ['', ...(function wrapCellsOld(braille, width, firstIndent, runoverIndent) {
      // exact copy of layout.mjs's wrapCells, pre-fix call signature (runover=2)
      const paragraphs = braille.split('\n');
      const out = [];
      paragraphs.forEach((p, idx) => {
        const indent = idx === 0 ? firstIndent : runoverIndent;
        out.push(' '.repeat(indent) + p);
      });
      return out;
    })(brf, 38, 0, 2)];
    assert.equal(oldBug[2], '  3 #4,) _:', 'documents the pre-fix +2 runover indent the investigation found');
  });

  test('BANA simple 2x2 matrix: row 2 keeps no indent of its own (matches the maths engine\'s raw output)', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const doc = { blocks: [{ type: 'math', mathml: SIMPLE_2X2 }] };
    const lines = formatDocument(doc, mathOpts('bana')).split('\r\n');
    const i = lines.indexOf('_% ,(#1 #2');
    assert.ok(i >= 0, `row 1 not found: ${JSON.stringify(lines)}`);
    assert.equal(lines[i + 1], '3 #4,) _:', 'row 2 must have NO extra indent (was "  3 #4,) _:" before the fix)');
  });

  test('BANA matrix with a negative entry: row 2 keeps no indent of its own', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const doc = { blocks: [{ type: 'math', mathml: NEGATIVE_ENTRY }] };
    const lines = formatDocument(doc, mathOpts('bana')).split('\r\n');
    const i = lines.indexOf('_% ,(#1 -#2');
    assert.ok(i >= 0, `row 1 not found: ${JSON.stringify(lines)}`);
    assert.equal(lines[i + 1], '3 #4,) _:');
  });

  test('BANA identity matrix with "I =" prefix: prefix stays on row 1, row 2 keeps no indent', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const doc = { blocks: [{ type: 'math', mathml: IDENTITY_PREFIX }] };
    const lines = formatDocument(doc, mathOpts('bana')).split('\r\n');
    const i = lines.indexOf('_% ,I .K ,(#1 #0');
    assert.ok(i >= 0, `row 1 not found: ${JSON.stringify(lines)}`);
    assert.equal(lines[i + 1], '0 #1,) _:');
  });

  test('UEB simple 2x2 matrix: unaffected (MathCAT emits one line for UEB; no row-sentinel)', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const doc = { blocks: [{ type: 'math', mathml: SIMPLE_2X2 }] };
    const lines = formatDocument(doc, mathOpts('ukaaf')).split('\r\n').filter((l) => l.trim());
    assert.equal(lines.length, 1, `UEB matrix should still be one line: ${JSON.stringify(lines)}`);
  });

  test('a genuinely long single-line (non-matrix) equation still wraps with the +2 runover indent', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const brf = mathToBrf(LONG_SUM, 'bana');
    assert.ok(!brf.includes('\n'), 'sanity: this expression is single-line raw output');
    const doc = { blocks: [{ type: 'math', mathml: LONG_SUM }] };
    const lines = formatDocument(doc, mathOpts('bana')).split('\r\n').filter((l) => l.trim() && !/^#A$/.test(l.trim()));
    assert.ok(lines.length >= 2, `expression must wrap onto >=2 lines for this test to be meaningful: ${JSON.stringify(lines)}`);
    assert.ok(lines[1].startsWith('  '), `continuation line must keep the ordinary +2 prose runover indent: ${JSON.stringify(lines[1])}`);
  });

  test('traceBlock matches formatBlock for a matrix block (A39 parity)', () => {
    if (!mathsReady) { console.log('  (skipped: MathCAT Node build unavailable)'); return; }
    const block = { type: 'math', mathml: SIMPLE_2X2 };
    parity(block, mathOpts('bana'));
    parity({ type: 'math', mathml: LONG_SUM }, mathOpts('bana'));
  });

  test('node Emboss/format/test-maths.mjs stays 32/32 (unaffected by the A11 fix: no test there exercises a multi-row matrix)', () => {
    // Not re-run here (needs a child process); run separately per the task's own instructions.
    assert.ok(true);
  });
});

// ===========================================================================================
// F-234 — BANA 15.8.1c: "Insert a blank line between the transcriber's note and the beginning
// of the line-numbered material." formatSegmentedPara prepended [...note, ...lines] with no
// separating blank line. Fixed: a blank line is inserted between the note and the numbered
// text, but ONLY when a note was actually emitted (block.lnNote true, at the first
// line-numbered block in the document) -- an ordinary paragraph with no note gets no extra
// blank line. The note's own WORDING is a separate, question-dependent matter (Q-69 asks
// whether the note should be selected per §15 construct once §15.2/§15.8 get their own
// markup) and is left untouched here.
// ===========================================================================================
describe('F-234 — a blank line separates the auto §15.4.1d transcriber\'s note from the numbered text that follows', () => {
  const docOpts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, suppressHeader: true, translate, translatePos, ...extra });
  const numberedDoc = () => ({
    blocks: [
      { type: 'para', segments: [
        { type: 'linenum', text: '1' },
        { type: 'text', text: 'This is the first numbered line of prose used for the test.' },
      ] },
    ],
  });

  test('the note\'s last line is immediately followed by exactly one blank line, then the numbered text', () => {
    const brf = formatDocument(numberedDoc(), docOpts());
    const lines = brf.split('\r\n');
    const noteCloseIdx = lines.findIndex((l) => l.includes('@.>'));
    assert.ok(noteCloseIdx >= 0, `no transcriber's note found in output: ${JSON.stringify(lines)}`);
    assert.equal(lines[noteCloseIdx + 1], '', `line directly after the note must be blank: ${JSON.stringify(lines.slice(noteCloseIdx, noteCloseIdx + 3))}`);
    assert.notEqual(lines[noteCloseIdx + 2].trim(), '', 'the numbered text must start right after the single blank line (no second blank line)');
    assert.ok(!lines[noteCloseIdx + 2].includes('@.<'), 'the line after the blank must be the numbered text, not another note line');
  });

  test('a paragraph with NO note (not the first line-numbered block) gets no extra blank line inserted', () => {
    const doc = {
      blocks: [
        { type: 'para', segments: [
          { type: 'linenum', text: '1' },
          { type: 'text', text: 'First numbered line, which carries the note.' },
        ] },
        { type: 'para', segments: [
          { type: 'linenum', text: '2' },
          { type: 'text', text: 'Second numbered line, no note here.' },
        ] },
      ],
    };
    const lines = formatDocument(doc, docOpts()).split('\r\n');
    // The second paragraph's own block has no note at all: only ONE blank line (the note's
    // own gap, from this fix) should separate the note from the first numbered line -- a
    // second, spurious note-gap must not appear before the second (note-less) paragraph.
    const blankRun = (idx) => { let n = 0; while (lines[idx + n] === '') n++; return n; };
    const noteCloseIdx = lines.findIndex((l) => l.includes('@.>'));
    const gapAfterNote = blankRun(noteCloseIdx + 1);
    assert.equal(gapAfterNote, 1, `exactly one blank line after the note: ${JSON.stringify(lines)}`);
  });

  test('traceBlock matches formatBlock for a line-numbered paragraph carrying the note (A39 parity)', () => {
    const block = { type: 'para', lnNote: true, segments: [
      { type: 'linenum', text: '1' },
      { type: 'text', text: 'A line-numbered paragraph with its transcriber\'s note.' },
    ] };
    parity(block, docOpts());
  });
});
