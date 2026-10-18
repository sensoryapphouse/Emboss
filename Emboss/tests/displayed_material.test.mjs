// K6 — BANA Braille Formats 2016 §9.2 (Format for Displayed Material), transcriber KD.
//
// (a) §9.2.2c: "Cell-5 and cell-7 headings within displayed material are based on the
//     adjusted left margin. Consequently the margins for cell-5 headings are blocked in
//     7-7, and cell-7 headings are blocked in 9-9." KD: "Yes, and the margin should shift
//     outward." Before this fix, formatHeading (document.mjs) never looked at whether a
//     heading was inside displayed material — a cell-5/cell-7 heading kept its ordinary
//     5-5 / 7-7 margin everywhere, contradicting the rule's own worked margins.
// (b) §9.2.2d: "Blocked paragraphs are blocked at the adjusted left margin; indented
//     paragraphs begin 2 cells to the right of the adjusted left margin." KD: "Both! Fully
//     dependent upon what print has." Before this fix, quoteMargins (document.mjs) only
//     ever produced the blocked form (first === runover) — there was no way to reach the
//     indented form at all, from any reader.
//
// Structural flag: `block.displayed` (heading/list) and `block.displayIndent` (a quote
// paragraph) are optional formatter fields — field-registry.mjs — read back through DTBook
// class tokens `bana-displayed` / `bana-display-indent` and set on import from print's own
// structure/indent (parseHtml's <blockquote> handling covers HTML *and* EPUB, which reads
// chapters through parseHtml; parseDocx recognises Word's built-in Quote/Intense Quote
// style and its own w:ind firstLine). ODT and the binary .doc reader have no blockquote/
// quote-paragraph detection of any kind yet (a pre-existing gap, not one this task
// introduces) so they cannot detect displayed material at all yet, let alone its indent —
// see the K6 final report for the full per-reader account.
//
// Every test below is written to fail against the pre-K6 formatter/parser (verified by hand
// against the saved pre-change copies in this task's scratch directory).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { formatDocument, formatBlock } from '../format/document.mjs';
import { parseHtml, parseDocx, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

const up = (s) => String(s).toUpperCase();
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, suppressHeader: true, ...extra });
const bodyLines = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/);
const leading = (l) => l.length - l.trimStart().length;
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

// =========================================================================================
// (a) §9.2.2c — a cell-5/cell-7 heading inside displayed material shifts outward
// =========================================================================================

test('§9.2.2c: an ordinary (non-displayed) cell-5 heading keeps its plain 5-5 margin', () => {
  const lines = formatBlock({ type: 'heading', level: 2, text: 'A cell-5 heading' }, opts());
  const body = lines.filter((l) => l !== '');
  assert.equal(leading(body[0]), 4, `cell-5 = 0-based column 4: ${JSON.stringify(lines)}`);
});

test('§9.2.2c: a cell-5 heading inside displayed material (block.displayed) is blocked in 7-7', () => {
  const lines = formatBlock({ type: 'heading', level: 2, text: 'A cell-5 heading', displayed: true }, opts());
  const body = lines.filter((l) => l !== '');
  assert.equal(leading(body[0]), 6, `7-7 = 0-based column 6: ${JSON.stringify(lines)}`);
});

test('§9.2.2c: an ordinary (non-displayed) cell-7 heading keeps its plain 7-7 margin', () => {
  const lines = formatBlock({ type: 'heading', level: 3, text: 'A cell-7 heading' }, opts());
  const body = lines.filter((l) => l !== '');
  assert.equal(leading(body[0]), 6, `cell-7 = 0-based column 6: ${JSON.stringify(lines)}`);
});

test('§9.2.2c: a cell-7 heading inside displayed material (block.displayed) is blocked in 9-9', () => {
  const lines = formatBlock({ type: 'heading', level: 3, text: 'A cell-7 heading' , displayed: true }, opts());
  const body = lines.filter((l) => l !== '');
  assert.equal(leading(body[0]), 8, `9-9 = 0-based column 8: ${JSON.stringify(lines)}`);
});

test('§9.2.2c: a runover line of a displayed cell-5/cell-7 heading shifts by the same amount', () => {
  const long5 = 'A cell-5 heading long enough that it must wrap onto a second braille line to check the runover margin.';
  const long7 = 'A cell-7 heading long enough that it must wrap onto a second braille line to check the runover margin.';
  const l5 = formatBlock({ type: 'heading', level: 2, text: long5, displayed: true }, opts()).filter((l) => l !== '');
  const l7 = formatBlock({ type: 'heading', level: 3, text: long7, displayed: true }, opts()).filter((l) => l !== '');
  assert.ok(l5.length >= 2 && l7.length >= 2, JSON.stringify({ l5, l7 }));
  assert.equal(leading(l5[0]), 6); assert.equal(leading(l5[1]), 6, `cell-5 runover also 7: ${JSON.stringify(l5)}`);
  assert.equal(leading(l7[0]), 8); assert.equal(leading(l7[1]), 8, `cell-7 runover also 9: ${JSON.stringify(l7)}`);
});

test('§9.2.2c: a centred heading is unaffected by block.displayed ("remain based on the non-adjusted left margin")', () => {
  const plain = formatBlock({ type: 'heading', level: 1, text: 'A centred heading' }, opts());
  const displayed = formatBlock({ type: 'heading', level: 1, text: 'A centred heading', displayed: true }, opts());
  assert.deepEqual(displayed, plain, JSON.stringify({ plain, displayed }));
});

test('§9.2.2c example, read literally: a cell-5 heading directly inside a quoted passage lands at 7-7, with the surrounding quote at the ordinary 3-3', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', text: 'Quote paragraph before the heading.' },
    { type: 'heading', level: 2, text: 'A heading inside the quote', displayed: true },
    { type: 'para', style: 'quote', text: 'Quote paragraph after the heading.' },
  ] });
  const iQuote = lines.findIndex((l) => l.trim() === 'QUOTE PARAGRAPH BEFORE THE HEADING.');
  const iHead = lines.findIndex((l) => l.trim() === 'A HEADING INSIDE THE QUOTE');
  assert.ok(iQuote >= 0 && iHead >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[iQuote]), 2, `surrounding quote at the adjusted margin, cell 3: ${JSON.stringify(lines)}`);
  assert.equal(leading(lines[iHead]), 6, `heading shifted outward to 7-7: ${JSON.stringify(lines)}`);
});

// =========================================================================================
// §9.1.2 — a list within displayed material takes the adjusted margin too
// =========================================================================================

test('§9.1.2: a list inside displayed material (block.displayed) is indented 2 cells further than an ordinary list', () => {
  const item = { text: 'One item, long enough to need no wrapping at all here.' };
  const plain = formatBlock({ type: 'list', items: [item] }, opts()).filter((l) => l.trim() !== '');
  const displayed = formatBlock({ type: 'list', items: [item], displayed: true }, opts()).filter((l) => l.trim() !== '');
  assert.ok(plain.length && displayed.length, JSON.stringify({ plain, displayed }));
  assert.equal(leading(displayed[0]), leading(plain[0]) + 2, JSON.stringify({ plain, displayed }));
});

// =========================================================================================
// (b) §9.2.2d — blocked vs. indented displayed paragraphs
// =========================================================================================

test('§9.2.2d: a displayed paragraph is BLOCKED by default (first line === runover, both at the adjusted margin)', () => {
  const long = 'A displayed paragraph long enough that it must wrap onto a second braille line to check its runover margin.';
  const lines = formatBlock({ type: 'para', style: 'quote', text: long }, opts()).filter((l) => l !== '');
  assert.ok(lines.length >= 2, JSON.stringify(lines));
  assert.equal(leading(lines[0]), 2, `blocked: first line at the adjusted margin, cell 3: ${JSON.stringify(lines)}`);
  assert.equal(leading(lines[1]), 2, `blocked: runover at the same margin: ${JSON.stringify(lines)}`);
});

test('§9.2.2d: block.displayIndent moves ONLY the first line 2 cells right; the runover stays at the adjusted margin', () => {
  const long = 'A displayed paragraph long enough that it must wrap onto a second braille line to check its runover margin.';
  const lines = formatBlock({ type: 'para', style: 'quote', text: long, displayIndent: true }, opts()).filter((l) => l !== '');
  assert.ok(lines.length >= 2, JSON.stringify(lines));
  assert.equal(leading(lines[0]), 4, `indented: first line 2 cells right of the adjusted margin, cell 5: ${JSON.stringify(lines)}`);
  assert.equal(leading(lines[1]), 2, `runover unchanged, still cell 3: ${JSON.stringify(lines)}`);
});

test('§9.2.2d: a nested (level 1) indented displayed paragraph shifts the same 2 cells, on top of its own nesting', () => {
  const long = 'A nested displayed paragraph long enough that it must wrap onto a second braille line here.';
  const blocked = formatBlock({ type: 'para', style: 'quote', level: 1, text: long }, opts()).filter((l) => l !== '');
  const indented = formatBlock({ type: 'para', style: 'quote', level: 1, text: long, displayIndent: true }, opts()).filter((l) => l !== '');
  assert.equal(leading(blocked[0]), 4, JSON.stringify(blocked));
  assert.equal(leading(indented[0]), 6, JSON.stringify(indented));
  assert.equal(leading(indented[1]), 4, `runover keeps the plain nested margin: ${JSON.stringify(indented)}`);
});

test('§9.2.2b + §9.2.2d: a blocked paragraph directly followed by an indented one is still ONE passage — no blank line between them', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', text: 'Blocked paragraph, as print has it.' },
    { type: 'para', style: 'quote', text: 'Indented paragraph, as print has it.', displayIndent: true },
  ] });
  const iA = lines.findIndex((l) => l.trim() === 'BLOCKED PARAGRAPH, AS PRINT HAS IT.');
  const iB = lines.findIndex((l) => l.trim() === 'INDENTED PARAGRAPH, AS PRINT HAS IT.');
  assert.ok(iA >= 0 && iB >= 0, JSON.stringify(lines));
  assert.equal(iB, iA + 1, `KD: "fully dependent upon what print has" — mixing blocked/indented within one passage does not itself start a new passage: ${JSON.stringify(lines)}`);
  assert.equal(leading(lines[iA]), 2, JSON.stringify(lines));
  assert.equal(leading(lines[iB]), 4, JSON.stringify(lines));
});

// =========================================================================================
// §9.2.2 (Q-28, confirmed by a BANA transcriber 25 Sep 2026 — round 1 item 19): a displayed
// passage nested in a list ("item.blocks", the list-item-blocks model added 25 Sep) takes its
// margin from the LIST's own nesting depth, not from a `level` the block itself happens to
// carry (item.blocks never sets one). The rule's own worked example: "displayed material
// within a nested list that has margins 1-7, 3-7, 5-7 would begin in cell 9" — a 3-level list
// (maxLevel 2, every item sharing runover cell 7) puts a nested displayed passage at cell 9.
// Every test below is written to fail against the pre-Q-28 formatter (verified by hand against
// the saved pre-change copy in this task's scratch directory): before this fix, a quote block
// inside item.blocks always fell back to block.level ?? 0, i.e. the plain (non-nested) cell-3
// margin, regardless of how deep the enclosing list actually was.
// =========================================================================================

test('§9.2.2 / Q-28: a displayed passage inside a ONE-LEVEL list item takes cell 5 (one nesting step in), not the plain cell 3', () => {
  const list = { type: 'list', items: [
    { text: 'The only item.', blocks: [{ type: 'para', style: 'quote', text: 'Quoted line.' }] },
  ] };
  const lines = formatBlock(list, opts()).filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.trim() === 'QUOTED LINE.');
  assert.ok(i >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i]), 4, `one list level -> cell 5 (0-based 4), not the plain cell 3: ${JSON.stringify(lines)}`);
});

test('§9.2.2 / Q-28: BANA\'s own worked example — a THREE-level nested list (1-7, 3-7, 5-7) puts a displayed passage nested in it at cell 9', () => {
  const list = { type: 'list', items: [
    { level: 0, text: 'Top level item.' },
    { level: 1, text: 'Second level item.' },
    { level: 2, text: 'Third level item.', blocks: [{ type: 'para', style: 'quote', text: 'Quoted line.' }] },
  ] };
  const lines = formatBlock(list, opts()).filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.trim() === 'QUOTED LINE.');
  assert.ok(i >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i]), 8, `maxLevel 2 (the whole list's own depth, §9.2.2's own example) -> cell 9: ${JSON.stringify(lines)}`);
});

test('§9.2.2 / Q-28: the margin comes from the LIST\'s own maxLevel, not the individual item\'s own (shallower) level', () => {
  // The quote sits under the level-0 (top) item, but the list itself nests to level 2 elsewhere:
  // every item shares one runover (nestedMargins), so the displayed passage still lands at cell 9.
  const list = { type: 'list', items: [
    { level: 0, text: 'Top level item.', blocks: [{ type: 'para', style: 'quote', text: 'Quoted line.' }] },
    { level: 1, text: 'Second level item.' },
    { level: 2, text: 'Third level item.' },
  ] };
  const lines = formatBlock(list, opts()).filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.trim() === 'QUOTED LINE.');
  assert.ok(i >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i]), 8, `the list's own deepest level (2) sets one shared runover for every item: ${JSON.stringify(lines)}`);
});

test('§9.2.2 / Q-28: an explicitly deeper hand-set level on the displayed block is never pulled shallower by the list', () => {
  const list = { type: 'list', items: [
    { text: 'The only item.', blocks: [{ type: 'para', style: 'quote', level: 5, text: 'Quoted line.' }] },
  ] };
  const lines = formatBlock(list, opts()).filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.trim() === 'QUOTED LINE.');
  assert.ok(i >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i]), 12, `hand-set level 5 (2 + 5*2 = 12) is kept, not lowered to the list's own level 1: ${JSON.stringify(lines)}`);
});

test('§9.2.2 / Q-28 is BANA-only: a UKAAF-mode list leaves a nested displayed passage at its plain (unnested) margin', () => {
  const ukaaf = (extra = {}) => ({ mode: 'ukaaf', standard: 'ukaaf', width: 40, depth: 25, translate: up, suppressHeader: true, ...extra });
  const list = { type: 'list', items: [
    { level: 0, text: 'Top item.' },
    { level: 1, text: 'Nested item.', blocks: [{ type: 'para', style: 'quote', text: 'Quoted line.' }] },
  ] };
  const lines = formatDocument({ blocks: [list] }, ukaaf()).split('\f')[0].split(/\r?\n/).filter((l) => l.trim() !== '');
  const i = lines.findIndex((l) => l.trim() === 'QUOTED LINE.');
  assert.ok(i >= 0, JSON.stringify(lines));
  assert.equal(leading(lines[i]), 6, `UKAAF quoteMargins' own plain (level 0) value, unaffected by list nesting: ${JSON.stringify(lines)}`);
});

// =========================================================================================
// Readers: HTML / EPUB (parseEpub delegates to parseHtml per chapter)
// =========================================================================================

test('reader (HTML/EPUB): a heading nested in a <blockquote> alongside a <p> is displayed:true; the <p> is not', () => {
  const html = '<blockquote><h3>A quoted heading</h3><p>A quoted paragraph.</p></blockquote>';
  const { blocks } = parseHtml(html);
  const h = blocks.find((b) => b.type === 'heading');
  const p = blocks.find((b) => b.type === 'para');
  assert.ok(h && p, JSON.stringify(blocks));
  assert.equal(h.displayed, true, JSON.stringify(blocks));
  assert.equal(h.level, 3, JSON.stringify(blocks));
  assert.equal(p.style, 'quote', JSON.stringify(blocks));
});

test('reader (HTML/EPUB): a <blockquote><p> with a positive CSS text-indent reads as displayIndent:true', () => {
  const html = '<blockquote><p style="text-indent: 2em">Indented, following print.</p></blockquote>';
  const { blocks } = parseHtml(html);
  const p = blocks.find((b) => b.type === 'para');
  assert.ok(p, JSON.stringify(blocks));
  assert.equal(p.style, 'quote');
  assert.equal(p.displayIndent, true, JSON.stringify(blocks));
});

test('reader (HTML/EPUB): a <blockquote><p> with no text-indent has no displayIndent (blocked, the default)', () => {
  const html = '<blockquote><p>Blocked, the ordinary case.</p></blockquote>';
  const { blocks } = parseHtml(html);
  const p = blocks.find((b) => b.type === 'para');
  assert.ok(p, JSON.stringify(blocks));
  assert.ok(!p.displayIndent, JSON.stringify(blocks));
});

test('reader (HTML/EPUB): text-indent: 0 is still the blocked form, not indented', () => {
  const html = '<blockquote><p style="text-indent: 0">Not indented.</p></blockquote>';
  const { blocks } = parseHtml(html);
  const p = blocks.find((b) => b.type === 'para');
  assert.ok(!p.displayIndent, JSON.stringify(blocks));
});

// =========================================================================================
// Reader: DOCX (w:ind firstLine on a Quote/Intense Quote styled paragraph)
// =========================================================================================

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function buildDocx(bodyXml) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}</w:body></w:document>`;
  const buf = await makeZip([{ name: 'word/document.xml', text: docXml }]).arrayBuffer();
  return parseDocx(buf);
}
const docxP = (styleId, text, firstLine) => `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${firstLine != null ? `<w:ind w:firstLine="${firstLine}"/>` : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('reader (DOCX): a paragraph styled Quote becomes a displayed-quotation paragraph', async () => {
  const doc = await buildDocx(docxP('Quote', 'Blocked, no firstLine.'));
  const p = doc.blocks.find((b) => b.type === 'para');
  assert.ok(p, JSON.stringify(doc.blocks));
  assert.equal(p.style, 'quote', JSON.stringify(doc.blocks));
  assert.ok(!p.displayIndent, JSON.stringify(doc.blocks));
});

test('reader (DOCX): Intense Quote with a positive w:ind firstLine reads as displayIndent:true', async () => {
  const doc = await buildDocx(docxP('IntenseQuote', 'Indented, following print.', 360));
  const p = doc.blocks.find((b) => b.type === 'para');
  assert.ok(p, JSON.stringify(doc.blocks));
  assert.equal(p.style, 'quote');
  assert.equal(p.displayIndent, true, JSON.stringify(doc.blocks));
});

test('reader (DOCX): a Quote paragraph with a negative (hanging) firstLine stays blocked', async () => {
  const doc = await buildDocx(docxP('Quote', 'Hanging indent, not first-line.', -360));
  const p = doc.blocks.find((b) => b.type === 'para');
  assert.ok(!p.displayIndent, JSON.stringify(doc.blocks));
});

test('reader (DOCX): an ordinary (non-Quote) paragraph is unaffected', async () => {
  const doc = await buildDocx(docxP('Normal', 'Plain body text.'));
  const p = doc.blocks.find((b) => b.type === 'para');
  assert.ok(!p.style, JSON.stringify(doc.blocks));
});

// =========================================================================================
// NIMAS / DTBook round trip: model -> XML -> model, twice, braille unchanged throughout
// =========================================================================================

const exportModel = (m) => quiet(() => exportToNimasXml(m, { uid: 'k6-test', date: '2026-01-01' }));
const parse = (xml) => quiet(() => parseDtbook(xml));

test('round trip: a displayed heading (block.displayed) keeps its flag and its braille through two save/reopen cycles', () => {
  const m0 = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'T' },
    { type: 'para', style: 'quote', text: 'Quote before.' },
    { type: 'heading', level: 2, text: 'A displayed heading', displayed: true },
    { type: 'para', style: 'quote', text: 'Quote after.' },
  ] };
  const before = formatBlock(m0.blocks[2], opts());
  const x1 = exportModel(m0);
  assert.match(x1, /bana-displayed/, x1);
  const m1 = parse(x1);
  const h1 = m1.blocks.find((b) => b.type === 'heading' && b.level === 2);
  assert.ok(h1, JSON.stringify(m1.blocks));
  assert.equal(h1.displayed, true, JSON.stringify(m1.blocks));
  assert.deepEqual(formatBlock(h1, opts()), before, 'braille unchanged after one round trip');
  const x2 = exportModel(m1);
  const m2 = parse(x2);
  const h2 = m2.blocks.find((b) => b.type === 'heading' && b.level === 2);
  assert.equal(h2.displayed, true, JSON.stringify(m2.blocks));
  assert.deepEqual(formatBlock(h2, opts()), before, 'braille unchanged after a second round trip');
  assert.equal(x2, exportModel(m2), 'save -> reopen -> save is stable');
});

test('round trip: a single-paragraph displayed quote keeps displayIndent and its braille through two save/reopen cycles', () => {
  const long = 'An indented displayed paragraph, long enough to wrap and show its runover margin here.';
  const m0 = { title: 'T', blocks: [{ type: 'heading', level: 1, text: 'T' }, { type: 'para', style: 'quote', text: long, displayIndent: true }] };
  const before = formatBlock(m0.blocks[1], opts());
  const x1 = exportModel(m0);
  assert.match(x1, /bana-display-indent/, x1);
  const m1 = parse(x1);
  const p1 = m1.blocks.find((b) => b.type === 'para');
  assert.equal(p1.style, 'quote'); assert.equal(p1.displayIndent, true, JSON.stringify(m1.blocks));
  assert.deepEqual(formatBlock(p1, opts()), before);
  const x2 = exportModel(m1);
  const m2 = parse(x2);
  const p2 = m2.blocks.find((b) => b.type === 'para');
  assert.equal(p2.displayIndent, true, JSON.stringify(m2.blocks));
  assert.deepEqual(formatBlock(p2, opts()), before);
  assert.equal(x2, exportModel(m2));
});

test('round trip: a MULTI-paragraph displayed quote (blockquoteId run) keeps each paragraph\'s own displayIndent independently', () => {
  const m0 = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'T' },
    { type: 'para', style: 'quote', text: 'Blocked paragraph one.' },
    { type: 'para', style: 'quote', text: 'Indented paragraph two.', displayIndent: true },
  ] };
  const x1 = exportModel(m0);
  assert.match(x1, /bana-display-indent/, x1);
  const m1 = parse(x1);
  const paras = m1.blocks.filter((b) => b.type === 'para' && b.style === 'quote');
  assert.equal(paras.length, 2, JSON.stringify(m1.blocks));
  assert.ok(!paras[0].displayIndent, JSON.stringify(paras));
  assert.equal(paras[1].displayIndent, true, JSON.stringify(paras));
  const x2 = exportModel(m1);
  assert.equal(x1, x2, 'save -> reopen -> save is stable');
});

test('round trip: displayIndent on a list-nested displayed quote (deeper level) round-trips and keeps its shifted braille', () => {
  const m0 = { title: 'T', blocks: [
    { type: 'heading', level: 1, text: 'T' },
    { type: 'para', style: 'quote', level: 1, text: 'Nested indented quote.', displayIndent: true },
  ] };
  const before = formatBlock(m0.blocks[1], opts());
  const m1 = parse(exportModel(m0));
  const p1 = m1.blocks.find((b) => b.type === 'para');
  assert.equal(p1.level, 1, JSON.stringify(m1.blocks));
  assert.equal(p1.displayIndent, true, JSON.stringify(m1.blocks));
  assert.deepEqual(formatBlock(p1, opts()), before);
});

// =========================================================================================
// Reader: DTBook/NIMAS read of a genuine (not Emboss-exported) source document
// =========================================================================================

test('reader (DTBook/NIMAS): a source file whose own <blockquote> nests a heading before a <p> reads both back correctly', () => {
  const xml = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
    <h1>Title</h1>
    <blockquote><h3>A quoted heading</h3><p>A quoted paragraph.</p></blockquote>
  </level1></bodymatter></book></dtbook>`;
  const { blocks } = parse(xml);
  const h = blocks.find((b) => b.type === 'heading' && b.level === 3);
  const p = blocks.find((b) => b.type === 'para' && b.style === 'quote');
  assert.ok(h && p, JSON.stringify(blocks));
  assert.equal(h.displayed, true, JSON.stringify(blocks));
});
