// Five box/attribution/glossary/illustration bugs written up in
// Emboss/docs/standards-findings.md (F-70, F-71, F-80, F-236, F-231), fixed one at a time in
// Emboss/docs/wip/box-attrib-glossary-fixes.md's own stage order. Every expected value below
// comes from the cited rule's own quoted text or a gold worked example
// (Emboss/tests/gold/bana-formats-2016/section-6, section-7, section-9, section-17) — never
// from Emboss's pre-fix output. One describe block per finding.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';
import * as louis from '../engine/louis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---- fake translate (structural tests: blank lines, margins, word boundaries) -----------
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const bodyLines = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/);
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

// ---- real liblouis en-ueb-g2 translator (rule-text / worked-example tests) ---------------
let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
});
const realOpts = (mode, width = 38) => ({
  mode, standard: mode, width, depth: 25, translate, translatePos,
});

// ===========================================================================================
// F-70 — BANA 7.3.3b: "The length of box lines within line-numbered text adheres to the
// required two blank cells before line numbers." boxBorders (document.mjs) passes o.width
// straight to the border repeat, never consulting o.lineNumberWidth (already computed
// document-wide by lineNumberInfo, the same value ordinary numbered prose narrows against —
// wrapNumbered's own "text ends 2 cells before the widest number" formula).
// ===========================================================================================
describe('F-70 — a box border line narrows for line-numbered text (BANA 7.3.3b)', () => {
  test('a box nested between numbered paragraphs narrows its top/bottom border to width - 2 - lineNumberWidth', () => {
    const doc = { blocks: [
      { type: 'para', segments: [{ type: 'linenum', text: '1' }, { type: 'text', text: 'First numbered line of prose padding padding.' }] },
      { type: 'box', blocks: [{ type: 'para', text: 'Boxed aside inside numbered prose.' }] },
      { type: 'para', segments: [{ type: 'linenum', text: '2' }, { type: 'text', text: 'Second numbered line of prose padding padding.' }] },
    ] };
    const lines = bodyLines(doc, { width: 40 });
    const topBorder = lines.find((l) => /^7+$/.test(l));
    assert.ok(topBorder, `no unnarrowed-or-narrowed top border found: ${JSON.stringify(lines)}`);
    // o.lineNumberWidth is 1 (single-digit "1"/"2"); expected border length is width - 2 - 1 = 37.
    assert.equal(topBorder.length, 37, `top border must narrow to width - 2 - lineNumberWidth: ${JSON.stringify(lines)}`);
  });

  test('a box with no line-numbered text anywhere in the document keeps a full-width border', () => {
    const doc = { blocks: [
      { type: 'para', text: 'Ordinary prose with no line numbers at all, padding padding padding.' },
      { type: 'box', blocks: [{ type: 'para', text: 'Boxed aside.' }] },
    ] };
    const lines = bodyLines(doc, { width: 40 });
    const topBorder = lines.find((l) => /^7+$/.test(l));
    assert.ok(topBorder, `no top border found: ${JSON.stringify(lines)}`);
    assert.equal(topBorder.length, 40, `border must stay full width with no line numbers: ${JSON.stringify(lines)}`);
  });

  test('formatBlock/traceBlock called directly on a box, with no o.lineNumberWidth key at all (not just 0), does not throw and keeps a full-width border', () => {
    // Regression: boxBorders/formatBox must work when called outside formatDocument's own
    // buildDocPages (which is the only place that ever sets o.lineNumberWidth) — e.g. a
    // single-block preview/round-trip call that never goes through lineNumberInfo at all.
    const block = { type: 'box', blocks: [{ type: 'para', text: 'Boxed aside.' }] };
    const o = fakeOpts('bana', 40); // no lineNumberWidth key whatsoever
    assert.doesNotThrow(() => formatBlock(block, o));
    assert.doesNotThrow(() => traceBlock(block, o));
    const lines = clean(formatBlock(block, o));
    const topBorder = lines.find((l) => /^7+$/.test(l));
    assert.ok(topBorder, `no top border found: ${JSON.stringify(lines)}`);
    assert.equal(topBorder.length, 40, `border must be full width when o.lineNumberWidth is entirely absent: ${JSON.stringify(lines)}`);
    parity(block, o);
  });
});

// ===========================================================================================
// F-71 — BANA 7.3.5a: "A top box line must be followed by at least one line of text on the
// braille page. If the box line is followed by a heading, the heading must be followed by at
// least one line of text." applyPageBoundaries's box-pairing logic (document.mjs) computes
// boxNeed for a top box line as the border plus only the NEXT single line, satisfying the base
// "≥1 line of text" requirement even when that next line is the box's own synthetic title
// heading (formatBox splices it into the box's own block index, so applyPageBoundaries's
// isHeading()-based orphan logic never sees it as a heading at all) — nothing then requires a
// FURTHER line after the heading specifically.
// ===========================================================================================
describe("F-71 — a box's own title heading is never stranded alone at the bottom of a page (BANA 7.3.5a)", () => {
  test('a box whose top border + title heading would exactly fill the remaining lines of a page moves as a whole to the next page', () => {
    // Exactly the finding's own reproduction (standards-findings.md F-71, "box-probe.mjs"):
    // 20 one-line filler paragraphs, default (non-suppressed) BANA header/footer, depth 25 —
    // the top border lands on line 22, "BOXED NOTE" on line 23 (the page's last line),
    // immediately followed by the page-number footer; the real box text is pushed alone to
    // the next page. A page number footer line (right-justified braille number) is not "a
    // line of text" the heading is followed by.
    const filler = Array.from({ length: 20 }, (_, i) => ({ type: 'para', text: `Filler paragraph number ${i + 1}.` }));
    const doc = { blocks: [
      ...filler,
      { type: 'box', title: 'Boxed Note', blocks: [{ type: 'para', text: 'Short boxed text.' }] },
    ] };
    const raw = formatDocument(doc, opts({ width: 40, depth: 25, suppressHeader: undefined }));
    const pages = raw.split('\f');
    const isPageNumFooter = (l) => /^ *#?[A-Z0-9]{1,4}$/.test(l.trim()) && /^ +\S/.test(l) && l.length === 40;
    for (const page of pages) {
      const lines = page.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
      const headingIdx = lines.findIndex((l) => l.trim() === 'BOXED NOTE');
      if (headingIdx === -1) continue;
      // Whatever page the heading lands on, at least one non-blank real-text line must follow
      // it before the page ends (blank padding lines and the page-number footer don't count).
      const after = lines.slice(headingIdx + 1);
      const hasRealTextAfter = after.some((l) => l.trim() !== '' && !isPageNumFooter(l) && !/^G+$/.test(l.trim()));
      assert.ok(hasRealTextAfter, `box heading "BOXED NOTE" on this page has no real text line after it (page lines): ${JSON.stringify(lines)}`);
    }
    // Sanity: the heading and the real box text must both actually appear somewhere.
    const joined = pages.join('\f');
    assert.ok(joined.includes('BOXED NOTE'), 'title heading missing entirely');
    assert.ok(joined.includes('SHORT BOXED TEXT'), 'box body text missing entirely');
  });
});

// ===========================================================================================
// F-80 — BANA 9.4.1d/9.5.1c/d ("blank line after" an attribution/citation) taken together with
// the absence of any rule requiring a blank line BETWEEN two immediately-adjacent
// attribution/citation-like fragments (Sample 9-7 "Source Citation to an Image", Sample 9-10
// "Letters with Signatures as Attributions" — both transcribe several short, print-distinct
// caption/credit/citation/signature fragments as consecutive braille lines with NO blank line
// between any of them). formatAttribution always appends a trailing '' unconditionally, so
// building each fragment as a separate `attribution` block inserts an unwanted blank line
// after every fragment but the last.
// ===========================================================================================
describe('F-80 — an attribution block marked block.continued emits no trailing blank line', () => {
  test('two consecutive attribution blocks, the first marked continued: no blank line between them, one after the second', () => {
    const lines = bodyLines({ blocks: [
      { type: 'attribution', text: '(Signed)', continued: true },
      { type: 'attribution', text: 'Wilhelm' },
    ] });
    const trimmed = lines.map((l) => l.replace(/\s+$/, ''));
    const iSigned = trimmed.findIndex((l) => l.includes('(SIGNED)'));
    const iWilhelm = trimmed.findIndex((l) => l.includes('WILHELM'));
    assert.ok(iSigned >= 0 && iWilhelm >= 0, `fragments not found: ${JSON.stringify(trimmed)}`);
    assert.equal(iWilhelm, iSigned + 1, `no blank line must separate the two continued attribution fragments: ${JSON.stringify(trimmed)}`);
  });

  test('an attribution block with no block.continued flag keeps its trailing blank line (regression, unchanged default)', () => {
    const lines = bodyLines({ blocks: [
      { type: 'attribution', text: 'An ordinary attribution.' },
      { type: 'para', text: 'The paragraph that follows it.' },
    ] });
    const trimmed = lines.map((l) => l.replace(/\s+$/, ''));
    const iAttr = trimmed.findIndex((l) => l.includes('ORDINARY ATTRIBUTION'));
    assert.ok(iAttr >= 0, `attribution not found: ${JSON.stringify(trimmed)}`);
    assert.equal(trimmed[iAttr + 1], '', `an un-flagged attribution must still get its own trailing blank line (9.4.1d/9.5.1d): ${JSON.stringify(trimmed)}`);
  });

  test('formatBlock/traceBlock parity for a continued attribution block', () => {
    const o = fakeOpts('bana', 40);
    const block = { type: 'attribution', text: 'Wilhelm', continued: true };
    parity(block, o);
    const block2 = { type: 'attribution', text: 'An ordinary attribution.' };
    parity(block2, o);
  });
});

// ===========================================================================================
// F-236 — glossarySegments (document.mjs) reads BOTH a plain term/def string and a separate
// termSegments/defSegments array, but its own combining condition `if (term && def)` tests
// only the PLAIN STRING variables' truthiness — not whether termSegs/defSegs (which already
// prefer the *Segments arrays when present) are themselves non-empty. An item supplying
// termSegments/term alongside a defSegments-only definition (no plain def string at all) has a
// truthy term but a falsy (empty) def, skips the combining branch entirely, and falls through
// to `return term ? termSegs : defSegs` — which returns ONLY termSegs, silently dropping the
// entire definition. (Sample 17-9, "Word Usage List", BANA 17.6.1b, is the reproduction case.)
// ===========================================================================================
describe('F-236 — glossarySegments keeps a defSegments/termSegments-only term or definition', () => {
  test('a plain term + defSegments-only definition (no plain def string at all) keeps both', () => {
    const block = { type: 'glossary', items: [{
      term: 'advice, advise:',
      defSegments: [
        { type: 'text', text: 'Advice' },
        { type: 'text', text: ' is a noun; ' },
        { type: 'text', text: 'advise', tf: 1 },
        { type: 'text', text: ' is a verb.' },
      ],
    }] };
    const lines = bodyLines({ blocks: [block] });
    const joined = lines.join(' ');
    assert.ok(joined.includes('ADVICE, ADVISE:'), `term missing: ${JSON.stringify(lines)}`);
    assert.ok(joined.includes('IS A VERB'), `definition (defSegments) silently dropped: ${JSON.stringify(lines)}`);
  });

  test('termSegments-only + defSegments-only (no plain term/def strings at all) keeps both', () => {
    const block = { type: 'glossary', items: [{
      termSegments: [{ type: 'text', text: 'doctor', tf: 1 }],
      defSegments: [{ type: 'text', text: 'a physician' }],
    }] };
    const lines = bodyLines({ blocks: [block] });
    const joined = lines.join(' ');
    assert.ok(joined.includes('DOCTOR'), `term (termSegments) missing: ${JSON.stringify(lines)}`);
    assert.ok(joined.includes('A PHYSICIAN'), `definition missing: ${JSON.stringify(lines)}`);
  });

  test('plain term + plain def (no *Segments at all) combine without an invented colon (F-183/F-194)', () => {
    const block = { type: 'glossary', items: [{ term: 'cat', def: 'a small domesticated feline' }] };
    const lines = bodyLines({ blocks: [block] });
    const joined = lines.join(' ');
    assert.ok(/CAT +A SMALL DOMESTICATED FELINE/.test(joined) && !joined.includes('CAT:'), `plain term/def must be separated by spacing, not an invented colon: ${JSON.stringify(lines)}`);
  });
});

// ===========================================================================================
// F-231 — BANA 6.2.2b: "If the original print copy does not identify an illustration, insert a
// label in a transcriber's note (e.g., photograph, figure, etc.) followed by the text of the
// caption on the same line." traceOrFormatPrintImage (document.mjs) always emits the literal
// English word "Illustration" (tn('Illustration')) when a label is needed, regardless of what
// kind of picture it is. Example 6-1/6-3 need "Photograph"; Sample 6-12 needs "Picture" — the
// document model has no field to carry the word at all.
// ===========================================================================================
describe('F-231 — an unidentified illustration\'s TN label uses the supplied word, not a hard-coded "Illustration"', () => {
  test('block.figureType supplies the label word (Example 6-1\'s own "Photograph")', () => {
    const lines = bodyLines({ blocks: [
      { type: 'graphic', figureType: 'Photograph', caption: 'a beardless Abraham Lincoln' },
    ] });
    const joined = lines.join(' ');
    assert.ok(joined.includes('@.<PHOTOGRAPH@.>'), `expected the supplied label word "Photograph": ${JSON.stringify(lines)}`);
    assert.ok(!joined.includes('ILLUSTRATION'), `must not fall back to "Illustration" once a word is supplied: ${JSON.stringify(lines)}`);
  });

  test('a different figureType (Sample 6-12\'s own "Picture") is used exactly as supplied', () => {
    const lines = bodyLines({ blocks: [
      { type: 'graphic', figureType: 'Picture', caption: 'Ivory statue of a Daoist figure' },
    ] });
    const joined = lines.join(' ');
    assert.ok(joined.includes('@.<PICTURE@.>'), `expected the supplied label word "Picture": ${JSON.stringify(lines)}`);
  });

  test('regression: no figureType supplied keeps the existing default "Illustration"', () => {
    const lines = bodyLines({ blocks: [
      { type: 'graphic', caption: 'a scene with no identifying caption text' },
    ] });
    const joined = lines.join(' ');
    assert.ok(joined.includes('@.<ILLUSTRATION@.>'), `default label must stay "Illustration" when nothing is supplied: ${JSON.stringify(lines)}`);
  });

  test('a caption that already identifies the illustration (e.g. starts with "Photograph") gets no label at all, figureType or not', () => {
    const lines = bodyLines({ blocks: [
      { type: 'graphic', figureType: 'Photograph', caption: 'Photograph of a beardless Abraham Lincoln' },
    ] });
    const joined = lines.join(' ');
    assert.ok(!joined.includes('@.<'), `caption already identifies the picture — no TN label should be added: ${JSON.stringify(lines)}`);
  });

  test('formatBlock/traceBlock parity for a graphic block carrying figureType', () => {
    const o = fakeOpts('bana', 40);
    const block = { type: 'graphic', figureType: 'Picture', caption: 'a small illustration' };
    parity(block, o);
  });
});

// A70 (EMBOSS-TASKS.md, 26 Sep) / "one layout path" stage 2: an empty box — no title, no
// content, no child-table citation — used to still emit its bare top and bottom border
// lines (formatBox's `top`/`bottom` were unconditional). The editor no longer leaves an
// empty box behind (the sidebar fix already referenced by this task's own row), but an
// imported document can still produce one. Paul's decision (the task brief): drop it
// entirely rather than emit bare borders — the one deliberate braille output change this
// stage makes; every other block type/case must stay byte-identical (see
// scripts/check-layout-parity.mjs / the corpus BRF diff in the stage's own report).
describe('A70 — an empty box (no title, no content) produces nothing, not bare border lines', () => {
  test('a box with no title, no text and no blocks: formatBlock returns no lines at all', () => {
    const lines = formatBlock({ type: 'box' }, fakeOpts('bana', 40));
    assert.deepEqual(lines, [], `an empty box must vanish entirely: ${JSON.stringify(lines)}`);
  });

  test('a sidebar with an empty blocks array behaves the same as no blocks', () => {
    const lines = formatBlock({ type: 'sidebar', blocks: [] }, fakeOpts('bana', 40));
    assert.deepEqual(lines, []);
  });

  test('UKAAF: an empty box also produces nothing', () => {
    const lines = formatBlock({ type: 'box' }, fakeOpts('ukaaf', 40));
    assert.deepEqual(lines, []);
  });

  test('formatBlock/traceBlock parity for the empty-box case', () => {
    const o = fakeOpts('bana', 40);
    parity({ type: 'box' }, o);
  });

  test('regression guard: a box with a title still renders (only a TRULY empty box vanishes)', () => {
    const lines = formatBlock({ type: 'box', title: 'A Note' }, fakeOpts('bana', 40));
    assert.ok(lines.length > 0, 'a titled box must still produce its heading and border lines');
    assert.ok(lines.some((l) => l.includes('A NOTE')), JSON.stringify(lines));
  });

  test('regression guard: a box with only text still renders', () => {
    const lines = formatBlock({ type: 'box', text: 'Some boxed text.' }, fakeOpts('bana', 40));
    assert.ok(lines.length > 0, 'a box with body text must still produce its border lines and body');
    assert.ok(lines.some((l) => l.includes('SOME BOXED TEXT')), JSON.stringify(lines));
  });

  test('regression guard: a box whose only content is a below-box table citation still renders', () => {
    const lines = formatBlock({ type: 'box', blocks: [
      { type: 'table', headers: ['A'], rows: [['1']], citation: { text: 'Source', position: 'below-box' } },
    ] }, fakeOpts('bana', 40));
    // The table itself is real content, so this never actually reaches the empty-box path —
    // included as a guard that a box is never mistaken for empty just because it hoists a
    // citation below the border.
    assert.ok(lines.length > 0);
  });
});
