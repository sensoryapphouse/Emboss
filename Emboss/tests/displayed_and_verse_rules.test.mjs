// Findings F-93, F-94, F-121 — BANA Braille Formats 2016 §9 (Displayed Material,
// Epigraphs) and §13 (Poetry and Song Lyrics).
//
// F-93 — BANA 9.2.2b:
//   "Do not insert blank lines between individual items in displayed material unless
//   required by other formats, e.g., between a heading and a paragraph."
//   Two consecutive `{type:'para', style:'quote'}` blocks (one displayed passage split
//   into two print paragraphs — exactly what input/parse.mjs's blockquote handling
//   produces for a <blockquote> with two <p> children) each carried their own
//   leading/trailing blank line, and the generic same-line dedupe in buildDocPages
//   collapsed the doubled blank down to ONE line, not zero.
//
// F-94 — BANA 9.3.1b/c:
//   "Do not treat epigraphs as displayed material." (9.3.1c)
//   "Transcribe epigraphs according to their formats, i.e., a poem in poetry format,
//   3-1 margins for indented paragraphs, etc." (9.3.1b)
//   `epigraph` was a member of `QUOTE_STYLES`, so a `style:'epigraph'` paragraph got the
//   IDENTICAL adjusted/blocked displayed-material margin (3-3) as a Blockquote — this
//   directly contradicts 9.3.1c and makes 9.3.1b's own "indented paragraph" (3-1) case
//   unreachable. Fixed by giving epigraph its own distinct style, mapped to the ordinary
//   paragraph margin (respecting `block.blocked` if the print is blocked, per 9.3.1b's
//   own "etc."), while keeping 9.3.1d's blank line before and after.
//
// F-121 — BANA 13.3.1a/13.7.1a (13.9.3b/13.11.2b share the same root cause):
//   "Leave a blank line before and after a poem. Exceptions: Do not insert a blank line
//   between a cell-5 or cell-7 heading and the poem to which it applies. ..." (13.3.1a)
//   "Precede and follow a prose poem with blank lines." (13.7.1a)
//   `formatPlay` never pushed a leading/trailing blank line, unlike formatList/formatBox/
//   formatHeading, which all add their own. Fixed with a poem-run boundary detector in
//   buildDocPages/buildDocPagesAsync (mirroring the existing noteLayout/verseRunLevels
//   per-run tagging pattern): a run of contiguous verse-line blocks (one per print line,
//   stanza breaks allowed inside) is ONE poem; a self-contained "whole poem" block
//   (`type` verse/poem/poetry, its own `.lines` array) is always its own poem, even next
//   to another one of the same kind — 13.9.3b's "leave a blank line between the first and
//   second [scansion] versions" is exactly two such poems placed back to back, the same
//   shape as the "two consecutive poems" case below; a run of contiguous `para`/
//   `style:'verse'` blocks (Emboss's prose-poem representation, §13.7) is treated the
//   same way, parallel to F-93's own quote-paragraph run. The existing cell-5/cell-7
//   heading exception (`joinsWithoutBlank`, already correct — see F-26/bana_nested_margins
//   test) is unaffected and re-checked here as a regression guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatBlock, traceBlock } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) });
const opts = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, suppressHeader: true, ...extra });
const bodyLines = (doc, extra) => formatDocument(doc, opts(extra)).split('\f')[0].split(/\r?\n/);
const leading = (l) => l.length - l.trimStart().length;

// =========================================================================================
// F-93 — BANA §9.2.2b: no blank line between the paragraphs of one displayed passage
// =========================================================================================

test('F-93: two consecutive quote paragraphs have NO blank line between them', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'Before the quote.' },
    { type: 'para', style: 'quote', text: 'Quote paragraph A.' },
    { type: 'para', style: 'quote', text: 'Quote paragraph B.' },
    { type: 'para', text: 'After the quote.' },
  ] });
  const iA = lines.findIndex((l) => l.trim() === 'QUOTE PARAGRAPH A.');
  const iB = lines.findIndex((l) => l.trim() === 'QUOTE PARAGRAPH B.');
  assert.ok(iA >= 0 && iB >= 0, JSON.stringify(lines));
  assert.equal(iB, iA + 1, `no blank line between the passage's own two paragraphs: ${JSON.stringify(lines)}`);
  // The passage's own outer boundary (9.2.2a) is unaffected: one blank before A, one after B.
  assert.equal(lines[iA - 1], '', JSON.stringify(lines));
  assert.equal(lines[iB + 1], '', JSON.stringify(lines));
});

test('F-93: three consecutive quote paragraphs — no blank between any pair', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', text: 'Quote paragraph A.' },
    { type: 'para', style: 'quote', text: 'Quote paragraph B.' },
    { type: 'para', style: 'quote', text: 'Quote paragraph C.' },
  ] });
  const idx = (t) => lines.findIndex((l) => l.trim() === t);
  const iA = idx('QUOTE PARAGRAPH A.'), iB = idx('QUOTE PARAGRAPH B.'), iC = idx('QUOTE PARAGRAPH C.');
  assert.ok(iA >= 0 && iB >= 0 && iC >= 0, JSON.stringify(lines));
  assert.equal(iB, iA + 1, JSON.stringify(lines));
  assert.equal(iC, iB + 1, JSON.stringify(lines));
});

test('F-93 regression: a quote paragraph followed by an ORDINARY paragraph still keeps the outer blank', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', text: 'Quote paragraph A.' },
    { type: 'para', text: 'Ordinary paragraph after.' },
  ] });
  const iA = lines.findIndex((l) => l.trim() === 'QUOTE PARAGRAPH A.');
  const iP = lines.findIndex((l) => l.trim() === 'ORDINARY PARAGRAPH AFTER.');
  assert.ok(iA >= 0 && iP >= 0, JSON.stringify(lines));
  assert.equal(lines[iA + 1], '', `9.2.2a's own outer blank is unaffected: ${JSON.stringify(lines)}`);
  assert.equal(iP, iA + 2, JSON.stringify(lines));
});

test('F-93 regression: two nested (level 1) quote paragraphs still get no blank, at the nested margin', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', level: 1, text: 'Nested quote paragraph A.' },
    { type: 'para', style: 'quote', level: 1, text: 'Nested quote paragraph B.' },
  ] });
  const iA = lines.findIndex((l) => l.trim() === 'NESTED QUOTE PARAGRAPH A.');
  const iB = lines.findIndex((l) => l.trim() === 'NESTED QUOTE PARAGRAPH B.');
  assert.ok(iA >= 0 && iB >= 0, JSON.stringify(lines));
  assert.equal(iB, iA + 1, JSON.stringify(lines));
  assert.equal(leading(lines[iA]), 4, `level-1 quote is 2 cells further right (§9.2.2): ${JSON.stringify(lines)}`);
});

test('F-93 regression: a quote paragraph at a DIFFERENT nesting level than its neighbour still gets a blank (different passage/margin)', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', style: 'quote', text: 'Outer quote paragraph.' },
    { type: 'para', style: 'quote', level: 1, text: 'Nested quote paragraph.' },
  ] });
  const iOuter = lines.findIndex((l) => l.trim() === 'OUTER QUOTE PARAGRAPH.');
  const iNested = lines.findIndex((l) => l.trim() === 'NESTED QUOTE PARAGRAPH.');
  assert.ok(iOuter >= 0 && iNested >= 0, JSON.stringify(lines));
  assert.equal(lines[iOuter + 1], '', `different margins are not "the same displayed passage": ${JSON.stringify(lines)}`);
});

// =========================================================================================
// F-94 — BANA §9.3.1b/c: an epigraph keeps its OWN print margin, not Blockquote's
// =========================================================================================

test('F-94: an epigraph paragraph gets the ordinary 3-1 paragraph margin, NOT Blockquote\'s 3-3 blocked margin', () => {
  const longQuote = 'This blockquote paragraph is deliberately long enough that it must wrap onto a second braille line so the runover margin can be checked.';
  const longEpi = 'This epigraph paragraph is deliberately long enough that it must wrap onto a second braille line so the runover margin can be checked.';
  const quoteLines = formatBlock({ type: 'para', style: 'quote', text: longQuote }, opts());
  const epiLines = formatBlock({ type: 'para', style: 'epigraph', text: longEpi }, opts());
  const quoteBody = quoteLines.filter((l) => l !== '');
  const epiBody = epiLines.filter((l) => l !== '');
  assert.ok(quoteBody.length >= 2 && epiBody.length >= 2, JSON.stringify({ quoteLines, epiLines }));
  // Blockquote (§9.2.2): adjusted margin, blocked 3-3 (first === runover, both indented).
  assert.equal(leading(quoteBody[0]), 2, JSON.stringify(quoteLines));
  assert.equal(leading(quoteBody[1]), 2, JSON.stringify(quoteLines));
  // Epigraph (§9.3.1b/c): ordinary paragraph margin, indented 3-1 (first line cell 3, runover cell 1).
  assert.equal(leading(epiBody[0]), 2, `epigraph first line cell 3: ${JSON.stringify(epiLines)}`);
  assert.equal(leading(epiBody[1]), 0, `epigraph runover cell 1 (NOT blocked like a quote): ${JSON.stringify(epiLines)}`);
});

test('F-94: an epigraph still gets a blank line before and after (§9.3.1d)', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'Before the epigraph.' },
    { type: 'para', style: 'epigraph', text: 'Epigraph line one.' },
    { type: 'para', text: 'After the epigraph.' },
  ] });
  const iEpi = lines.findIndex((l) => l.trim() === 'EPIGRAPH LINE ONE.');
  assert.ok(iEpi > 0, JSON.stringify(lines));
  assert.equal(lines[iEpi - 1], '', JSON.stringify(lines));
  assert.equal(lines[iEpi + 1], '', JSON.stringify(lines));
});

test('F-94: an epigraph that follows print\'s own blocked-paragraph convention (block.blocked) is blocked 1-1, not forced to 3-1', () => {
  const long = 'This blocked epigraph paragraph is deliberately long enough that it must wrap onto a second braille line for the runover check.';
  const lines = formatBlock({ type: 'para', style: 'epigraph', text: long, blocked: true }, opts());
  const body = lines.filter((l) => l !== '');
  assert.ok(body.length >= 2, JSON.stringify(lines));
  for (const l of body) assert.ok(!l.startsWith(' '), `9.3.1b's own "etc." — blocked print stays blocked: ${JSON.stringify(lines)}`);
});

test('F-94: formatBlock/traceBlock parity for a plain-text epigraph paragraph', () => {
  const o = { ...opts(), translatePos: upPos };
  const block = { type: 'para', style: 'epigraph', text: 'An epigraph paragraph long enough to wrap onto a second line for good measure.' };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-94: formatBlock/traceBlock parity for a segmented (rich-text) epigraph paragraph', () => {
  const o = { ...opts(), translatePos: upPos };
  const segments = [{ type: 'text', text: 'An ' }, { type: 'text', text: 'emphasised', tf: 4 }, { type: 'text', text: ' epigraph phrase, long enough to wrap onto a second line.' }];
  const block = { type: 'para', style: 'epigraph', segments };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// =========================================================================================
// F-121 — BANA §13.3.1a / §13.7.1a: a blank line before and after a poem / prose poem
// =========================================================================================

const verseLine = (text, level) => (level ? { type: 'play', subtype: 'verse', style: 'verse', level, text } : { type: 'play', subtype: 'verse', style: 'verse', text });

test('F-121: a blank line precedes a poem that follows an ORDINARY paragraph', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'Prose before the poem.' },
    verseLine('First verse line.'),
    verseLine('Second verse line.'),
    { type: 'para', text: 'Prose after the poem.' },
  ] });
  const iProse = lines.findIndex((l) => l.trim() === 'PROSE BEFORE THE POEM.');
  const iLine1 = lines.findIndex((l) => l.trim() === 'FIRST VERSE LINE.');
  assert.ok(iProse >= 0 && iLine1 > iProse, JSON.stringify(lines));
  assert.equal(lines[iLine1 - 1], '', `13.3.1a: blank line before the poem: ${JSON.stringify(lines)}`);
});

test('F-121: a blank line follows a poem that is followed by an ORDINARY paragraph, with none between the poem\'s own two lines', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'Prose before the poem.' },
    verseLine('First verse line.'),
    verseLine('Second verse line.'),
    { type: 'para', text: 'Prose after the poem.' },
  ] });
  const iLine1 = lines.findIndex((l) => l.trim() === 'FIRST VERSE LINE.');
  const iLine2 = lines.findIndex((l) => l.trim() === 'SECOND VERSE LINE.');
  const iProseAfter = lines.findIndex((l) => l.trim() === 'PROSE AFTER THE POEM.');
  assert.ok(iLine1 >= 0 && iLine2 === iLine1 + 1, `no blank line between the poem's own lines: ${JSON.stringify(lines)}`);
  assert.equal(lines[iLine2 + 1], '', `13.3.1a: blank line after the poem: ${JSON.stringify(lines)}`);
  assert.equal(iProseAfter, iLine2 + 2, JSON.stringify(lines));
});

test('F-121 regression: NO blank line between a cell-5 or cell-7 heading and the poem it applies to (13.3.1a exception, already correct — see F-26/bana_nested_margins)', () => {
  const cell5 = bodyLines({ blocks: [
    { type: 'heading', level: 2, text: 'Ode' },
    verseLine('A single verse line.'),
    { type: 'para', text: 'Prose after.' },
  ] });
  const iHead5 = cell5.findIndex((l) => l.trim() === 'ODE');
  const iLine5 = cell5.findIndex((l) => l.trim() === 'A SINGLE VERSE LINE.');
  assert.ok(iHead5 >= 0 && iLine5 >= 0, JSON.stringify(cell5));
  assert.equal(iLine5, iHead5 + 1, `no blank after a cell-5 heading: ${JSON.stringify(cell5)}`);

  const cell7 = bodyLines({ blocks: [
    { type: 'heading', level: 3, text: 'Ode' },
    verseLine('A single verse line.'),
    { type: 'para', text: 'Prose after.' },
  ] });
  const iHead7 = cell7.findIndex((l) => l.trim() === 'ODE');
  const iLine7 = cell7.findIndex((l) => l.trim() === 'A SINGLE VERSE LINE.');
  assert.ok(iHead7 >= 0 && iLine7 >= 0, JSON.stringify(cell7));
  assert.equal(iLine7, iHead7 + 1, `no blank after a cell-7 heading: ${JSON.stringify(cell7)}`);
});

test('F-121 regression: a CENTRED heading before a poem still keeps its own blank line (not one of 13.3.1a\'s named exceptions)', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 1, text: 'Poem' },
    verseLine('A single verse line.'),
  ] });
  const iHead = lines.findIndex((l) => l.trim() === 'POEM');
  const iLine = lines.findIndex((l) => l.trim() === 'A SINGLE VERSE LINE.');
  assert.ok(iHead >= 0 && iLine >= 0, JSON.stringify(lines));
  assert.equal(lines[iHead + 1], '', `centred heading's own trailing blank (§4.4.1) is kept: ${JSON.stringify(lines)}`);
  assert.equal(iLine, iHead + 2, JSON.stringify(lines));
});

test('F-121: two consecutive poems (13.9.3b\'s own "first and second version" shape) keep a blank line BETWEEN them, none inside either', () => {
  const doc = { blocks: [
    { type: 'poem', lines: ['First line of poem one.', 'Second line of poem one.'] },
    { type: 'poem', lines: ['First line of poem two.', 'Second line of poem two.'] },
  ] };
  const lines = bodyLines(doc);
  const i1a = lines.findIndex((l) => l.trim() === 'FIRST LINE OF POEM ONE.');
  const i1b = lines.findIndex((l) => l.trim() === 'SECOND LINE OF POEM ONE.');
  const i2a = lines.findIndex((l) => l.trim() === 'FIRST LINE OF POEM TWO.');
  const i2b = lines.findIndex((l) => l.trim() === 'SECOND LINE OF POEM TWO.');
  assert.ok([i1a, i1b, i2a, i2b].every((i) => i >= 0), JSON.stringify(lines));
  assert.equal(i1b, i1a + 1, `no blank inside poem one: ${JSON.stringify(lines)}`);
  assert.equal(i2b, i2a + 1, `no blank inside poem two: ${JSON.stringify(lines)}`);
  assert.equal(lines[i1b + 1], '', `exactly one blank BETWEEN the two poems: ${JSON.stringify(lines)}`);
  assert.equal(i2a, i1b + 2, JSON.stringify(lines));
});

test('F-121 / BANA 13.11.2b: a blank line precedes the first verse of a song, following a title and its own attribution line', () => {
  const lines = bodyLines({ blocks: [
    { type: 'heading', level: 1, text: 'Song Title' },
    { type: 'attribution', text: 'Text centered below the title.' },
    verseLine('First verse line.'),
    verseLine('Second verse line.'),
  ] });
  const iAttr = lines.findIndex((l) => l.trim() === 'TEXT CENTERED BELOW THE TITLE.');
  const iVerse1 = lines.findIndex((l) => l.trim() === 'FIRST VERSE LINE.');
  assert.ok(iAttr >= 0 && iVerse1 > iAttr, JSON.stringify(lines));
  assert.equal(lines[iVerse1 - 1], '', `13.11.2b: blank line before the first verse: ${JSON.stringify(lines)}`);
});

test('F-121: formatBlock/traceBlock parity for a "whole poem" block (type:poem with a .lines array)', () => {
  const o = { ...opts(), translatePos: upPos };
  const block = { type: 'poem', lines: ['First line of the poem.', 'Second line of the poem.'] };
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

test('F-121: formatBlock/traceBlock parity for an ordinary per-line verse block', () => {
  const o = { ...opts(), translatePos: upPos };
  const block = verseLine('A single verse line, long enough to wrap onto a second braille line for the runover check just in case.');
  const formatted = formatBlock(block, o, false);
  const traced = traceBlock(block, o, false).map((t) => t.s);
  assert.deepEqual(traced, formatted, JSON.stringify({ formatted, traced }));
});

// --- Prose poetry (§13.7.1a) — Emboss's `{type:'para', style:'verse'}` representation ---

test('F-121: a blank line precedes and follows a prose poem (§13.7.1a), none between its own paragraphs', () => {
  const lines = bodyLines({ blocks: [
    { type: 'para', text: 'Prose before.' },
    { type: 'para', style: 'verse', text: 'Prose poem paragraph one.' },
    { type: 'para', style: 'verse', text: 'Prose poem paragraph two.' },
    { type: 'para', text: 'Prose after.' },
  ] });
  const iBefore = lines.findIndex((l) => l.trim() === 'PROSE BEFORE.');
  const iOne = lines.findIndex((l) => l.trim() === 'PROSE POEM PARAGRAPH ONE.');
  const iTwo = lines.findIndex((l) => l.trim() === 'PROSE POEM PARAGRAPH TWO.');
  const iAfter = lines.findIndex((l) => l.trim() === 'PROSE AFTER.');
  assert.ok([iBefore, iOne, iTwo, iAfter].every((i) => i >= 0), JSON.stringify(lines));
  assert.equal(lines[iOne - 1], '', `13.7.1a: blank line before the prose poem: ${JSON.stringify(lines)}`);
  assert.equal(iTwo, iOne + 1, `no blank between the prose poem's own paragraphs: ${JSON.stringify(lines)}`);
  assert.equal(lines[iTwo + 1], '', `13.7.1a: blank line after the prose poem: ${JSON.stringify(lines)}`);
  assert.equal(iAfter, iTwo + 2, JSON.stringify(lines));
  // 13.7.1b: follow print for paragraph indentation — an ordinary (non-blocked) 3-1 margin.
  assert.equal(leading(lines[iOne]), 2, JSON.stringify(lines));
});
