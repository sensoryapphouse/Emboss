// A8 — BANA Formats §21.2.1a: "Start each alphabetic reference on a new braille page."
//
// §21.1.1 scopes "alphabetic reference" for the whole of §21: "This section contains general
// provisions for alphabetic references, e.g., glossaries, thesauruses, dictionaries, indexes,
// and other alphabetic reference materials (e.g. gazetteers)" — but bibliographies are
// explicitly carved out ("treated as a separate category... see Bibliographies, section 22"),
// and §22 (22.1-22.3.2, standards-map.md) has no equivalent new-page rule of its own. UKAAF
// B004 Appendix I ("Index to books") has no matching rule either (its own "Good practice"
// bullets cover runovers/page references only) — so this is a BANA-only requirement.
//
// Emboss only models two of §21.1.1's named constructs as distinct block kinds today: `list`
// blocks with kind 'index' or kind 'glossary' (no 'thesaurus'/'dictionary' kind exists,
// standards-findings.md F-193) — both covered below. A bibliography reaches the formatter as
// an unclassed `list` (kind 'plain', standards-map.md BANA 22.2.1's own evidence) and must NOT
// be forced onto a new page, since §21's rule does not apply to it.
//
// THE DECIDED RULE (23 Sep, this task): implemented as a general "this block always opens a
// fresh braille page" mechanism (`forcedPageBreakBlocks`, `Emboss/format/document.mjs`,
// consumed by `applyPageBoundaries`) rather than an index-specific special case, so a later
// rule needing the same behaviour (e.g. the transcriber's own pages, or BANA Formats
// §1.15.1d's "begin the main text of each volume with braille page 1" front matter) can add
// its own predicate to the same Set with no further plumbing. Unlike the existing heading/
// keep-group page-fit checks in applyPageBoundaries (which move a group to the next page only
// when it additionally FITS there), a forced break is unconditional: it always starts a new
// page, and does nothing at all when the block already opens one (no blank page is ever
// inserted).
//
// See docs/standards-findings.md F-204 and the BANA 21.2.1a row in docs/standards-map.md.
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
const allPages = (doc, opts) => formatDocument(doc, opts).split('\f').map((p) => p.split(/\r?\n/));
const clean = (lines) => lines.map((l) => l.replace(/\s+$/, ''));
const fakeOpts = (mode, width = 40) => ({
  mode, standard: mode, width, depth: 25, translate: up,
  translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }),
});
const parity = (block, o) => assert.deepEqual(clean(traceBlock(block, o).map((t) => t.s)), clean(formatBlock(block, o)), 'traceBlock must match formatBlock');

const fillers = (n) => { const a = []; for (let i = 1; i <= n; i++) a.push({ type: 'para', text: `Filler line ${i}.` }); return a; };
const indexBlock = (items = ['Apple, 3', 'Banana, 7']) => ({ type: 'list', kind: 'index', items: items.map((t) => ({ text: t })) });
const glossaryBlock = () => ({ type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'Alpha', def: 'The first letter.' }, { term: 'Beta', def: 'The second letter.' }] });
const bibliographyBlock = () => ({ type: 'list', kind: 'plain', items: [{ text: 'Smith, John. A Book. Publisher, 2000.' }] });

// ---- real liblouis en-ueb-g2 translator (running-head / page-number continuity) --------
let translate, translatePos;
before(async () => {
  await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  translate = (t, tf) => louis.translate(t, T, tf || null);
  translatePos = (t, tf) => louis.translatePos(t, T, tf || null);
});
const realBanaOpts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 38, depth: 25, translate, translatePos, ...extra });

// ===========================================================================================
describe('A8 — BANA 21.2.1a: an index/glossary always opens a new braille page', () => {
  test('an index after body text that leaves room on the page still starts a new braille page', () => {
    const doc = { blocks: [{ type: 'para', text: 'Some body text before the index.' }, indexBlock()] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.ok(pages.length >= 2, `expected the index to be pushed to its own page: ${JSON.stringify(pages)}`);
    assert.ok(!pages[0].some((l) => l.includes('APPLE')), `page 1 must not contain any index entry: ${JSON.stringify(pages[0])}`);
    const firstNonBlank2 = pages[1].find((l) => l !== '');
    assert.ok(firstNonBlank2 && firstNonBlank2.includes('APPLE'), `page 2 must open with the index's first entry: ${JSON.stringify(pages[1])}`);
  });

  test('a glossary after body text also starts a new braille page (§21.1.1 names glossaries too)', () => {
    const doc = { blocks: [{ type: 'para', text: 'Some body text before the glossary.' }, glossaryBlock()] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.ok(pages.length >= 2, `expected the glossary to be pushed to its own page: ${JSON.stringify(pages)}`);
    assert.ok(!pages[0].some((l) => l.includes('ALPHA')), `page 1 must not contain any glossary entry: ${JSON.stringify(pages[0])}`);
    const firstNonBlank2 = pages[1].find((l) => l !== '');
    assert.ok(firstNonBlank2 && firstNonBlank2.includes('ALPHA'), `page 2 must open with the glossary's first entry: ${JSON.stringify(pages[1])}`);
  });

  test('an index that ALREADY falls at the top of a braille page does not gain a spurious blank page', () => {
    // 25 one-line filler paragraphs exactly fill a depth-25 page (suppressHeader: true ->
    // perPage === depth === 25), so the index that follows already opens page 2 under plain
    // line-count pagination alone — no padding should be inserted before it.
    const doc = { blocks: [...fillers(25), indexBlock()] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.equal(pages.length, 2, `no extra blank page should appear before the index: ${JSON.stringify(pages.map((p) => p.filter((l) => l !== '')))}`);
    const firstNonBlank2 = pages[1].find((l) => l !== '');
    assert.ok(firstNonBlank2 && firstNonBlank2.includes('APPLE'), `page 2 must open directly with the index, no blank page: ${JSON.stringify(pages[1])}`);
  });

  test('an index that already opens the very first page of the document is untouched', () => {
    const doc = { blocks: [indexBlock()] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.equal(pages.length, 1, `a lone index must not spawn a leading blank page: ${JSON.stringify(pages)}`);
    const firstNonBlank = pages[0].find((l) => l !== '');
    assert.ok(firstNonBlank && firstNonBlank.includes('APPLE'), `page 1 must open with the index: ${JSON.stringify(pages[0])}`);
  });

  test('a bibliography (out of §21 scope, governed separately by §22) is NOT forced onto a new page', () => {
    const doc = { blocks: [{ type: 'para', text: 'Some body text before the bibliography.' }, bibliographyBlock()] };
    const pages = allPages(doc, banaOpts()).map(clean);
    assert.equal(pages.length, 1, `a bibliography must stay on the same page as preceding text when it fits: ${JSON.stringify(pages)}`);
    assert.ok(pages[0].some((l) => l.includes('SMITH, JOHN')), `bibliography entry must be present on page 1: ${JSON.stringify(pages[0])}`);
  });

  test('UKAAF mode: unchanged (no B004 rule forcing an index/glossary onto a new page)', () => {
    const doc = { blocks: [{ type: 'para', text: 'Some body text before the index.' }, indexBlock()] };
    const pages = allPages(doc, ukaafOpts()).map(clean);
    assert.equal(pages.length, 1, `UKAAF has no §21.2.1a-equivalent rule, so the index stays with preceding text: ${JSON.stringify(pages)}`);
    assert.ok(pages[0].some((l) => l.includes('APPLE')), `index entry must be present on page 1: ${JSON.stringify(pages[0])}`);
  });

  test('the braille page number and running head continue correctly across the forced break', () => {
    // Real translator, headers ON (no suppressHeader), with print-page furniture so the BANA
    // running head/footer machinery is fully exercised (title on line 1, braille page number
    // bottom-right per Formats §1.6/§1.15.1a).
    const doc = { blocks: [
      { type: 'pagenum', page: '1' },
      { type: 'para', text: 'Some body text before the index.' },
      indexBlock(['Apple, 3']),
    ] };
    const pages = allPages(doc, realBanaOpts({ title: 'A Book' })).map(clean);
    assert.ok(pages.length >= 2, `expected at least 2 pages: ${JSON.stringify(pages)}`);
    // Braille page numbers are the LAST line of each BANA page, in ascending ASCII-braille
    // order (the very last array entry is '' — the split(/\r?\n/) artifact of each line's own
    // trailing \r\n — so the footer is the entry before it).
    const footer1 = pages[0][pages[0].length - 2];
    const footer2 = pages[1][pages[1].length - 2];
    assert.match(footer1.trim(), /^#A$/i, `page 1's braille page number must be #a: ${JSON.stringify(footer1)}`);
    assert.match(footer2.trim(), /^#B$/i, `page 2's braille page number must be #b, continuing on from page 1: ${JSON.stringify(footer2)}`);
    // Running head (line 1) must still carry the title/print-page furniture on page 2.
    const head2 = pages[1][0];
    assert.ok(head2 && head2.trim().length > 0, `page 2 must still carry its own running head line: ${JSON.stringify(pages[1])}`);
  });

  test('formatBlock/traceBlock stay byte-identical for index and glossary blocks (A39 — the mechanism lives in applyPageBoundaries, not the leaf formatters)', () => {
    const o = fakeOpts('bana', 40);
    parity(indexBlock(), o);
    parity(glossaryBlock(), o);
  });
});
