// A23 — BANA Formats §9.4.1's two attribution-placement rules:
//   9.4.1a: "Do not start the attribution on a new braille page. If necessary, carry the
//           last line of text, followed by the attribution, to a new braille page."
//   9.4.1b: "Block attributions in the fifth cell to the right of the beginning of the
//           previous line."
// formatAttribution used to block every attribution at a FIXED cell 5 (wrapCells(body, w,
// 4, 4)) and page.mjs's assemble()/applyPageBoundaries had no keep-with-previous concept for
// an attribution at all (F-100). Both are wrong whenever the previous braille line does not
// itself begin in cell 1 (a plain paragraph's own FIRST line) — 9.4.1b's own worked example,
// gold sample-9-6 ("Attribution"), blocks the attribution at cell 7 because the quotation it
// follows begins at cell 3, not cell 5.
//
// THE DECIDED RULE (23 Sep, this task): "the beginning of the previous line" is taken
// literally — the immediately preceding braille content LINE, whatever produced it (a
// paragraph's own runover, a displayed quotation, a poem line, another attribution, …), not a
// fixed cell 5 and not the block's own first-line margin when that differs from its runover
// (an ordinary 3-1 paragraph's runover sits LEFT of its own first line; the rule names "the
// previous LINE", singular, not "the passage" — see the runover test below). EXCEPTION: a
// heading is not "the previous line" for this rule — 9.4.1's own definition is that an
// attribution identifies the source of "the quote, poem, story, etc.", i.e. of textual/
// narrative matter, not of a title, and empirically a centred heading's own (often large,
// centring-derived) indent pushed the attribution far enough right to wrap it onto two lines,
// breaking displayed_and_verse_rules.test.mjs's 13.11.2b song test and
// nimas_bana_structures.test.mjs's byline-after-heading test (both now pass unmodified with
// this fix). Implemented in document.mjs's attributionCellFor (buildDocPages/
// buildDocPagesAsync), consumed by formatAttribution/traceBlock via block.attribCell.
//
// Every expected value below is taken from the quoted rule text above, from sample-9-6's own
// agreed braille (Emboss/tests/gold/bana-formats-2016/section-9/sample-9-06.json), or from the
// two regression tests' own already-agreed expectations (heading -> cell-5 default) — never
// from Emboss's pre-fix output. See docs/standards-findings.md F-100 and the BANA
// 9.4.1a/9.4.1b rows in docs/standards-map.md.
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

// ---- fake translate (structural tests: margins, page breaks) ----------------------------
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const banaOpts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const ukaafOpts = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, translatePos: upPos, suppressHeader: true, ...extra });
const pageOneLines = (doc, opts) => formatDocument(doc, opts).split('\f')[0].split(/\r?\n/);
const allPages = (doc, opts) => formatDocument(doc, opts).split('\f').map((p) => p.split(/\r?\n/));
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const indent = (line) => line.length - line.replace(/^ +/, '').length;
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

// ---- real liblouis en-ueb-g2 translator (rule-text / gold-example tests) ----------------
let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
});
const realBanaOpts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, translate, translatePos, suppressHeader: true, ...extra });

// ===========================================================================================
// 9.4.1b — "Block attributions in the fifth cell to the right of the beginning of the
// previous line." NOT a fixed cell 5.
// ===========================================================================================
describe('A23a — BANA 9.4.1b: an attribution blocks 5 cells right of the PREVIOUS line\'s own start', () => {
  // Disambiguates "the previous LINE" (literal) from "the passage's own left margin" (the
  // block's first-line indent): an ordinary paragraph's FIRST line sits at cell 3, but its
  // RUNOVER — the line actually immediately above the attribution here — sits at cell 1. Had
  // the fix used the paragraph's own first-line margin instead, the attribution would land at
  // cell 7 (cell 3 + 4); the decided literal reading gives cell 5 (the runover's cell 1 + 4),
  // which happens to coincide with the old fixed default here (an ordinary paragraph is not
  // itself "the quote, poem, story, etc." §9.4.1 describes, so this is also the sane fallback
  // shape) but is derived the same way as every other case in this group, not special-cased.
  test('after a paragraph whose runover (last) line starts in cell 1: attribution at cell 5 (the runover\'s own cell 1, not the paragraph\'s first-line cell 3)', () => {
    const doc = { blocks: [
      { type: 'para', text: 'This paragraph is deliberately long so that it wraps onto a second runover line which begins in cell one.' },
      { type: 'attribution', text: 'Attrib after para.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const firstLine = lines.find((l) => l.startsWith('  THIS PARAGRAPH'));
    const runover = lines.find((l) => l.startsWith('THAT IT WRAPS'));
    const attrib = lines.find((l) => l.includes('ATTRIB AFTER PARA'));
    assert.ok(firstLine && runover && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(firstLine), 2, `sanity: an ordinary paragraph's FIRST line is cell 3 (indent 2): ${JSON.stringify(firstLine)}`);
    assert.equal(indent(runover), 0, `sanity: its runover line starts in cell 1 (indent 0): ${JSON.stringify(runover)}`);
    assert.equal(indent(attrib), 4, `attribution must block at cell 5 (indent 4) — the RUNOVER's cell 1 + 4, not the first line's cell 3 + 4: ${JSON.stringify(attrib)}`);
  });

  test('after a displayed quotation (BANA cell 3): attribution at cell 7, not the old fixed cell 5 — matches gold sample-9-6', () => {
    const doc = { blocks: [
      { type: 'para', style: 'quote', text: 'A short displayed quotation.' },
      { type: 'attribution', text: 'Quote attribution.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const quoteLine = lines.find((l) => l.includes('A SHORT DISPLAYED QUOTATION'));
    const attrib = lines.find((l) => l.includes('QUOTE ATTRIBUTION'));
    assert.ok(quoteLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(quoteLine), 2, `sanity: BANA displayed quote begins at cell 3 (indent 2): ${JSON.stringify(quoteLine)}`);
    assert.equal(indent(attrib), 6, `attribution must block at cell 7 (quote's cell 3 + 4), per sample-9-6: ${JSON.stringify(attrib)}`);
  });

  test('after a nested (level 1) displayed quotation, cell 5: attribution at cell 9', () => {
    const doc = { blocks: [
      { type: 'para', style: 'quote', level: 1, text: 'A nested displayed quotation.' },
      { type: 'attribution', text: 'Nested quote attribution.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const quoteLine = lines.find((l) => l.includes('A NESTED DISPLAYED QUOTATION'));
    const attrib = lines.find((l) => l.includes('NESTED QUOTE ATTRIBUTION'));
    assert.ok(quoteLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(quoteLine), 4, `sanity: nested quote begins at cell 5 (indent 4): ${JSON.stringify(quoteLine)}`);
    assert.equal(indent(attrib), 8, `attribution must block at cell 9 (quote's cell 5 + 4): ${JSON.stringify(attrib)}`);
  });

  test('after a poem line (level 1, cell 3): attribution at cell 7', () => {
    const doc = { blocks: [
      { type: 'play', subtype: 'verse', style: 'verse', level: 1, text: 'A short poem line.' },
      { type: 'attribution', text: 'Poem attribution.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const poemLine = lines.find((l) => l.includes('A SHORT POEM LINE'));
    const attrib = lines.find((l) => l.includes('POEM ATTRIBUTION'));
    assert.ok(poemLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(poemLine), 2, `sanity: level-1 poem line begins at cell 3 (indent 2): ${JSON.stringify(poemLine)}`);
    assert.equal(indent(attrib), 6, `attribution must block at cell 7 (poem line's cell 3 + 4): ${JSON.stringify(attrib)}`);
  });

  test('gold sample-9-6 (BANA Formats §9.4.1b worked example): the quotation begins cell 3, the attribution cell 7', () => {
    // Reproduces gold/bana-formats-2016/section-9/sample-9-06.json's own agreed braille
    // structure with the real translator: a lead-in paragraph, a displayed quote, and an
    // attribution — the quote's cell-3 beginning is 9.4.1b's own "previous line".
    const doc = { blocks: [
      { type: 'para', text: 'In reviewing the case the Court said:' },
      { type: 'para', style: 'quote', text: 'Its resolution is a matter of national concern.' },
      { type: 'attribution', text: 'Justice Lewis F. Powell, Jr., 1972' },
    ] };
    // Emboss's real BRF output is uppercase ascii-braille (gold-run.mjs normalises gold's
    // own lowercase-printed lines the same way before comparing) — match case-insensitively.
    const lines = clean(pageOneLines(doc, realBanaOpts()));
    const quoteLine = lines.find((l) => /resolu;n/i.test(l));
    const attrib = lines.find((l) => /,lewis/i.test(l));
    assert.ok(quoteLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(quoteLine), 2, `sample-9-6: quotation at cell 3: ${JSON.stringify(quoteLine)}`);
    assert.equal(indent(attrib), 6, `sample-9-6: attribution at cell 7 (cell 3 + 4): ${JSON.stringify(attrib)}`);
  });

  test('formatBlock/traceBlock parity for an explicit block.attribCell (mirrors the buildDocPages-computed offset)', () => {
    const o = fakeOpts('bana', 40);
    parity({ type: 'attribution', text: 'Cell 9 attribution.', attribCell: 8 }, o);
    parity({ type: 'attribution', text: 'No attribCell set, default cell 5.' }, o);
  });

  // THE DECIDED EXCEPTION: a heading is not "the previous line" for 9.4.1b. Reproduces the
  // exact regression that got the first A23 attempt reverted (23 Sep) — a centred level-1
  // heading ("Song Title", BANA §13.11.2b's song case) sits at roughly cell 16-17 at width 40;
  // relative-to-heading placement would have put the attribution at cell ~21, where its own
  // text ('Text centered below the title.', 31 chars incl. period) no longer fits the
  // remaining ~19-cell width and wraps onto a second line — breaking any test that looks for
  // the whole attribution text on one line (displayed_and_verse_rules.test.mjs's own
  // F-121/13.11.2b test, and the byline-after-heading test in nimas_bana_structures.test.mjs,
  // both exercise this shape end-to-end). Kept at the plain cell-5 default instead.
  test('directly after a CENTRED heading (no other text between): keeps the cell-5 default, does not inherit the heading\'s own centred indent', () => {
    const doc = { blocks: [
      { type: 'heading', level: 1, text: 'Song Title' },
      { type: 'attribution', text: 'Text centered below the title.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const headingLine = lines.find((l) => l.includes('SONG TITLE'));
    const attrib = lines.find((l) => l.trim() === 'TEXT CENTERED BELOW THE TITLE.');
    assert.ok(headingLine, `heading line not found: ${JSON.stringify(lines)}`);
    assert.ok(indent(headingLine) > 8, `sanity: a centred level-1 heading sits well right of cell 5: ${JSON.stringify(headingLine)}`);
    assert.ok(attrib, `attribution must appear as ONE unwrapped line, not split by an inherited deep indent: ${JSON.stringify(lines)}`);
    assert.equal(indent(attrib), 4, `attribution after a heading keeps the cell-5 default (indent 4): ${JSON.stringify(attrib)}`);
  });

  // A heading is excluded only as the DIRECT previous line — once ordinary text intervenes,
  // the relative rule resumes normally (this is exactly gold sample-9-6's own shape: heading,
  // lead-in paragraph, quote, attribution — the heading is not "the previous line" there
  // either, simply because the quote comes between).
  test('a heading followed by body text, then an attribution: the relative rule applies to the TEXT, not the heading', () => {
    const doc = { blocks: [
      { type: 'heading', level: 1, text: 'The Constitutional Issue' },
      { type: 'para', style: 'quote', text: 'A short displayed quotation.' },
      { type: 'attribution', text: 'Quote attribution.' },
    ] };
    const lines = clean(pageOneLines(doc, banaOpts()));
    const quoteLine = lines.find((l) => l.includes('A SHORT DISPLAYED QUOTATION'));
    const attrib = lines.find((l) => l.includes('QUOTE ATTRIBUTION'));
    assert.ok(quoteLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    assert.equal(indent(attrib), 6, `attribution still blocks at cell 7 (quote's cell 3 + 4), unaffected by the earlier heading: ${JSON.stringify(attrib)}`);
  });
});

// ===========================================================================================
// 9.4.1a — "Do not start the attribution on a new braille page. If necessary, carry the last
// line of text, followed by the attribution, to a new braille page."
// ===========================================================================================
describe('A23b — BANA 9.4.1a: an attribution never starts a braille page', () => {
  test('an attribution that would land as the very first line of a new page instead pulls the line above it over too', () => {
    // 25 one-line filler paragraphs exactly fill a depth-25 page (suppressHeader: true ->
    // perPage === depth === 25), so the attribution that follows would be pushed to line 1
    // of page 2 by plain line-count pagination alone.
    const fillers = [];
    for (let i = 1; i <= 25; i++) fillers.push({ type: 'para', text: `Filler line ${i}.` });
    const doc = { blocks: [...fillers, { type: 'attribution', text: 'Attribution line.' }, { type: 'para', text: 'After attribution paragraph.' }] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.ok(pages.length >= 2, `expected at least 2 pages: ${JSON.stringify(pages)}`);
    const [page1, page2] = pages;
    // Page 1 must NOT contain "Filler line 25." — it was carried to page 2 with the attribution.
    assert.ok(!page1.some((l) => l.includes('FILLER LINE 25')), `"Filler line 25." must be carried to page 2, not left on page 1: ${JSON.stringify(page1)}`);
    // Page 2's first non-blank line must be the carried-over last line of text, not the attribution.
    const firstNonBlank2 = page2.find((l) => l !== '');
    assert.ok(firstNonBlank2 && firstNonBlank2.includes('FILLER LINE 25'), `page 2 must open with the carried-over last line of text, not the attribution: ${JSON.stringify(page2)}`);
    // The attribution itself must never be the opening line of a page.
    for (const page of pages) {
      const firstNonBlank = page.find((l) => l !== '');
      if (firstNonBlank) assert.ok(!firstNonBlank.includes('ATTRIBUTION LINE'), `an attribution must never open a braille page: ${JSON.stringify(page)}`);
    }
    // The attribution must still directly follow that carried-over line, at its correct
    // 9.4.1b margin (previous line "Filler line 25." begins at cell 3, indent 2 -> cell 7, indent 6).
    const attribLineIdx = page2.findIndex((l) => l.includes('ATTRIBUTION LINE'));
    assert.equal(attribLineIdx, 1, `attribution must sit directly under the carried-over line: ${JSON.stringify(page2)}`);
    assert.equal(indent(page2[attribLineIdx]), 6, `carried attribution keeps its correct 9.4.1b margin: ${JSON.stringify(page2[attribLineIdx])}`);
  });

  test('an attribution comfortably mid-page is untouched (no spurious page break)', () => {
    const doc = { blocks: [
      { type: 'para', text: 'A short paragraph.' },
      { type: 'attribution', text: 'An attribution well within the page.' },
      { type: 'para', text: 'A paragraph that follows.' },
    ] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.equal(pages.length, 1, `no page break should occur here: ${JSON.stringify(pages)}`);
  });
});

// ===========================================================================================
// UKAAF B004 has no §9.4 attribution rule (standards-map.md / questions-for-transcribers.md
// item 13b) — its attribution keeps its pre-existing fixed placement and plain line-count
// pagination untouched by this fix.
// ===========================================================================================
describe('A23c — UKAAF mode: unchanged (no B004 rule for attribution placement)', () => {
  test('a UKAAF attribution stays at its fixed margin regardless of what precedes it', () => {
    const doc = { blocks: [
      { type: 'para', style: 'quote', text: 'A UKAAF displayed quotation.' },
      { type: 'attribution', text: 'UKAAF attribution.' },
    ] };
    const lines = clean(pageOneLines(doc, ukaafOpts()));
    const quoteLine = lines.find((l) => l.includes('A UKAAF DISPLAYED QUOTATION'));
    const attrib = lines.find((l) => l.includes('UKAAF ATTRIBUTION'));
    assert.ok(quoteLine && attrib, `lines not found: ${JSON.stringify(lines)}`);
    // UKAAF quote margin (quoteMargins) is cell 7 (indent 6); if the attribution followed
    // BANA's relative rule it would land at indent 10 — it must not.
    assert.equal(indent(quoteLine), 6, `sanity: UKAAF displayed quote begins at cell 7 (indent 6): ${JSON.stringify(quoteLine)}`);
    assert.equal(indent(attrib), 4, `UKAAF attribution keeps its old fixed cell 5 (indent 4), not the BANA-relative offset: ${JSON.stringify(attrib)}`);
  });

  test('a UKAAF attribution may still open a new page (no B004 keep-together rule to enforce)', () => {
    const fillers = [];
    for (let i = 1; i <= 25; i++) fillers.push({ type: 'para', text: `Filler line ${i}.` });
    const doc = { blocks: [...fillers, { type: 'attribution', text: 'Attribution line.' }] };
    const pages = allPages(doc, ukaafOpts()).map(clean);
    assert.ok(pages.length >= 2, `expected at least 2 pages: ${JSON.stringify(pages)}`);
    // Behaviour is simply whatever plain line-count pagination already did before this fix
    // (which only touches BANA mode) — no assertion on where the break falls, only that
    // UKAAF's own attribCell/keep-group logic was never engaged (covered by the margin test
    // above); this test just documents that UKAAF formatting still runs without erroring
    // when a page break happens to land on an attribution.
  });
});
