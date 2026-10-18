// Formatter fixes from the real-book re-check of 24 Sep 2026 (docs/real-book-validation-24sep-recheck.md), one describe
// block per problem, in the order they were fixed. Every expectation comes from the rule quoted with it, or from the
// invariant that the page planner (applyPageBoundaries, format/document.mjs) and the page assembler (assemble,
// format/page.mjs) agree line for line - never from Emboss's own earlier output.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { formatDocument, formatDocumentAsync, formatBlock, traceBlock, tableLayout } from '../format/document.mjs';
import { banaPageChangeNumber } from '../format/page.mjs';
import * as louis from '../engine/louis.mjs';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');

// ---- fake translate (structural tests: which line goes on which page) ----------------------------------------------
const up = (s) => String(s).toUpperCase();
const upPos = (s) => ({ braille: up(s), inputPos: Array.from(String(s), (_, i) => i) });
const bana = (extra = {}) => ({ mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: upPos, ...extra });
const rstrip = (l) => String(l).replace(/\s+$/, '');
const splitPages = (brf) => brf.split('\f').map((p) => p.split('\r\n').slice(0, -1));
const PER_PAGE = 23;                                         // BANA 25 lines: line 1 (print page / running head) and line 25 (page number)
const body = (page) => page.slice(1, 1 + PER_PAGE);
const lastText = (lines) => { for (let k = lines.length - 1; k >= 0; k--) if (lines[k].trim()) return k; return -1; };
const firstText = (lines) => lines.findIndex((l) => l.trim());
const pageOf = (pages, re) => pages.findIndex((pg) => body(pg).some((l) => re.test(l)));

const words = (n, tag = 'w') => Array.from({ length: n }, (_, i) => tag + (i % 10)).join(' ');
const para = (n, tag) => ({ type: 'para', text: words(n, tag) });
const pn = (page) => ({ type: 'pagenum', page, text: page });
const gloss = (terms) => ({ type: 'list', kind: 'glossary', style: 'glossary', items: terms.map((t) => ({ term: t, def: `the meaning of ${t}, used for testing the glossary layout` })) });

function run(doc, o) {
  const trace = {};
  const brf = formatDocument(doc, { ...o, trace });
  return { brf, pages: splitPages(brf), trace };
}
// The invariant: the lines applyPageBoundaries planned for every page are exactly the body lines assemble put on it.
function assertPlanMatches({ pages, trace }, label = '') {
  const { pages: plan, lines } = trace.pagePlan;
  assert.equal(plan.length, pages.length, `${label}: planned ${plan.length} pages, assembled ${pages.length}`);
  plan.forEach((pg, p) => {
    const end = p + 1 < plan.length ? plan[p + 1].start : lines.length;
    const planned = lines.slice(pg.start + pg.free, end).map(rstrip);
    if (p + 1 < plan.length) assert.equal(planned.length, PER_PAGE, `${label}: page ${p + 1} planned ${planned.length} body lines`);
    while (planned.length < PER_PAGE) planned.push('');
    assert.deepEqual(pages[p].slice(1, 1 + PER_PAGE).map(rstrip), planned, `${label}: page ${p + 1} body differs from the plan`);
    if (pg.free) assert.ok(rstrip(pages[p][0]).endsWith(banaPageChangeNumber(rstrip(lines[pg.start]))), `${label}: page ${p + 1} line 1 does not carry the lifted indicator`);
  });
}

// ====================================================================================================================
// Problem 1 (a regression) and the formatter half of bug 7. BANA 21.2.1a: "Start each alphabetic reference on a new
// braille page." The parser now splits a glossary at each print page turn (glossary list, pagenum, glossary list), and a
// decorative image with no text can sit between two pieces. forcedPageBreakBlocks treated every piece as a new
// reference and forced a page before it (anthology: 15 breaks, 180 blank lines). BANA 1.11: the page change indicator
// goes in place. Only the first piece of a glossary opens a new page.
// ====================================================================================================================
describe('problem 1: a print page turn (or an empty image) inside a glossary does not force a new braille page', () => {
  test('the re-check repro: gamma stays on the glossary\'s page, after the page change line', () => {
    const r = run({ blocks: [pn('1'), { type: 'heading', level: 2, text: 'Glossary' }, gloss(['alpha', 'beta']), pn('2'), gloss(['gamma', 'delta'])] }, bana());
    assertPlanMatches(r, 'repro');
    assert.equal(r.pages.length, 1, `one braille page, got ${r.pages.length}`);
    assert.ok(body(r.pages[0]).some((l) => /^GAMMA/.test(l.trim())));
  });
  test('the bug 7 repro: glossary, image with no alt text, glossary, image, glossary gives one page', () => {
    const r = run({ blocks: [pn('1'), para(90), pn('2'), { type: 'heading', level: 2, text: 'Glossary' }, gloss(['alpha', 'beta']),
      { type: 'graphic', src: 'x.jpg', alt: '' }, gloss(['gamma', 'delta']), { type: 'graphic', src: 'x.jpg', alt: '' }, gloss(['epsilon'])] }, bana());
    assertPlanMatches(r, 'bug 7');
    // 21.2.1a still applies once: the glossary (its heading) opens page 2; everything after it stays there.
    assert.equal(r.pages.length, 2, `two braille pages (text, glossary), got ${r.pages.length}`);
    for (const t of ['GLOSSARY', 'ALPHA', 'GAMMA', 'EPSILON']) assert.equal(pageOf(r.pages, new RegExp('^\\s*' + t)), 1, `${t} on page 2`);
  });
  test('a long glossary split at many print pages flows on: no page ends early before a piece', () => {
    const blocks = [pn('1'), para(40), { type: 'heading', level: 2, text: 'Glossary' }];
    for (let p = 2; p <= 12; p++) blocks.push(gloss([`term${p}a`, `term${p}b`, `term${p}c`]), pn(String(p)));
    const r = run({ blocks }, bana());
    assertPlanMatches(r, 'long');
    r.pages.slice(1, -1).forEach((pg, k) => {
      const b = body(pg);
      // a page may end with at most one blank line (a page change line moved on, BANA 1.11.4), never a run of them
      assert.ok(PER_PAGE - 1 - lastText(b) <= 1, `page ${k + 2} ends ${PER_PAGE - 1 - lastText(b)} lines early`);
    });
  });
  test('the first piece still opens a new page, and a later, separate glossary still gets its own', () => {
    const r = run({ blocks: [pn('1'), para(60), { type: 'heading', level: 2, text: 'Glossary' }, gloss(['alpha']), pn('2'), gloss(['beta']),
      { type: 'heading', level: 1, text: 'Unit Two' }, para(20), para(20), para(20), { type: 'heading', level: 2, text: 'Science Glossary' }, gloss(['gamma'])] }, bana());
    assertPlanMatches(r, 'two references');
    assert.equal(pageOf(r.pages, /^\s*GLOSSARY/), 1);
    assert.equal(pageOf(r.pages, /^BETA/), 1, 'the continuation stays with its glossary');
    assert.equal(pageOf(r.pages, /^\s*SCIENCE GLOSSARY/), 2, 'the second glossary opens its own page (21.2.1a)');
  });
});

// ====================================================================================================================
// Problem 2. BANA 11.2.6 (keep a table on one page when possible; "Insert the page break at the beginning of a new row
// if possible") and 11.16: a listed table's title and transcriber's note stay with its first row. Before, only the rows
// were keep groups, so the note could be left at the page foot with the table on the next page (anthology p535).
// ====================================================================================================================
describe('problem 2: a listed table\'s title and note stay with its first row', () => {
  const longDef = 'to direct your attention or effort toward a particular thing that you want to understand or explain to others in the class';
  const listed = (rows) => ({ type: 'table', format: 'listed', title: 'Academic Vocabulary', headers: ['Word', 'Definition', 'Related Forms'], rows });
  test('the note never ends a page with the first row on the next (a sweep of paragraph lengths)', () => {
    let moved = 0;
    for (let a = 40; a <= 200; a += 4) {
      const t = listed([['focus', longDef, 'focused, focusing, focuses'], ['analyze', 'to study closely', 'analysis']]);
      const r = run({ blocks: [pn('1'), para(a), t] }, bana());
      assertPlanMatches(r, `a=${a}`);
      const noteEnd = r.pages.findIndex((pg) => body(pg).some((l) => /ENTRIES\.@?\.?>?$|ENTRIES\./.test(rstrip(l))));
      const firstRow = pageOf(r.pages, /^\s{4}WORD: FOCUS/);
      assert.ok(noteEnd >= 0 && firstRow >= 0, `a=${a}: note and first row found`);
      assert.equal(firstRow, noteEnd, `a=${a}: the note is on page ${noteEnd + 1}, the first row on page ${firstRow + 1}`);
      const title = pageOf(r.pages, /^\s+ACADEMIC VOCABULARY/);
      assert.equal(title, firstRow, `a=${a}: the title is on page ${title + 1}, the first row on page ${firstRow + 1}`);
      if (firstRow === 1) moved++;
    }
    assert.ok(moved > 0, 'some lengths move the table to page 2');
  });
  test('a first row too long to share a page with the note follows it directly (at least two of its lines under the note)', () => {
    const huge = Array.from({ length: 12 }, (_, i) => `sentence ${i} of a very long definition that runs on`).join(' ');
    for (let a = 40; a <= 240; a += 8) {
      const r = run({ blocks: [pn('1'), para(a), listed([['focus', huge, 'focused'], ['b', 'c', 'd']])] }, bana());
      assertPlanMatches(r, `a=${a}`);
      r.pages.forEach((pg, p) => {
        const b = body(pg), k = lastText(b);
        assert.ok(!(k >= 0 && /ENTRIES\./.test(b[k])), `a=${a}: page ${p + 1} ends with the note`);
      });
      const noteP = r.pages.findIndex((pg) => body(pg).some((l) => /ENTRIES\./.test(l)));
      const b = body(r.pages[noteP]);
      const at = b.findIndex((l) => /ENTRIES\./.test(l));
      assert.ok(b.slice(at + 1).filter((l) => l.trim()).length >= 2, `a=${a}: two lines of the first row under the note`);
      // and no page of blank lines under a lone note: the note's page is full down to its last line
      if (noteP < r.pages.length - 1) assert.equal(lastText(b), PER_PAGE - 1, `a=${a}: the page with the note is filled`);
    }
  });
  test('formatBlock and traceBlock agree, keep groups included', () => {
    const t = listed([['focus', longDef, 'focused'], ['analyze', '', 'analysis']]);
    const f = formatBlock(t, bana()), tr = traceBlock(t, bana());
    assert.deepEqual(tr.map((x) => rstrip(x.s)), f.map(rstrip));
    assert.deepEqual(tr.keepGroups, f.keepGroups);
    assert.equal(f.keepGroups.length, 2, 'one group per row');
    assert.deepEqual([f.keepGroups[0][0], f.keepGroups[0][2]], [1, 'L'], 'the first row\'s group starts at the title (tagged: it has a lead)');
  });
});

// ====================================================================================================================
// Problem 3. UEB 9.7.3: "For better readability, ignore a change in typeform for closing punctuation when a typeform
// word indicator is used." The colon after a listed table's heading (BANA 11.16.1d) is Emboss's, not print's, so it
// takes the heading's typeform: `^1,DEF9I;N3`, as BrailleBlaster writes `^1,A2REVIA;NS3` - not `^1,DEF9I;N^'3`
// (745 terminators in the anthology). 9.7.2: "When there is doubt ... consider the punctuation as being included in
// the typeform", so a passage's terminator follows the colon.
// ====================================================================================================================
describe('problem 3: a bold listed-table heading takes its colon without a terminator (UEB 9.7.3)', () => {
  let o;
  before(async () => {
    await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
    const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
    o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translatePos: (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null) };
  });
  const bold = (text) => ({ text, segments: [{ type: 'text', text, tf: 4 }] });
  const table = () => ({ type: 'table', format: 'listed', headers: [bold('Word'), bold('Definition'), bold('Related Forms'), bold('Part of Speech Here')],
    rows: [['focus', 'to direct', 'focused', 'verb'], ['abbreviate', '', 'abbreviation', 'verb']] });
  test('the re-check repro: no bold terminator before a colon; the word indicator covers the colon', () => {
    const lines = formatBlock(table(), o).map(rstrip);
    const text = lines.join('\n');
    assert.ok(!/\^'3/.test(text), `a bold terminator before a colon:\n${text}`);
    assert.ok(lines.some((l) => l.trim() === '^1,^W3 FOCUS'), `row heading: ${lines.join(' | ')}`);
    assert.ok(lines.includes('^1,DEF9I;N3 TO DIRECT'), `entry: ${lines.join(' | ')}`);
    assert.ok(lines.includes('^1,RELAT$ ^1,=MS3 FOCUS$'), 'two words: a word indicator on each, no terminator');
    assert.ok(lines.includes('^1,DEF9I;N3 """'), 'a blank entry: heading, colon, guide dots');
    assert.ok(lines.some((l) => /^\^7.*3\^' V]B$/.test(l)), `three words: a passage, terminated after the colon: ${lines.join(' | ')}`);
  });
  test('a plain heading keeps its plain colon', () => {
    const lines = formatBlock({ type: 'table', format: 'listed', headers: ['Word', 'Definition'], rows: [['focus', 'to direct']] }, o).map(rstrip);
    assert.ok(lines.includes(',DEF9I;N3 TO DIRECT'), lines.join(' | '));
  });
  test('formatBlock and traceBlock agree; the added colon has no print source', () => {
    const f = formatBlock(table(), o), tr = traceBlock(table(), o);
    assert.deepEqual(tr.map((x) => rstrip(x.s)), f.map(rstrip));
    const line = tr.find((x) => x.s.startsWith('^1,DEF9I;N3 TO'));
    assert.equal(line.src[line.s.indexOf('3 TO')], null, 'the colon cell maps to no cell text');
    assert.equal(line.src[1] && line.src[1].u, 1, 'the heading cells map to header cell 1');
  });
});

// ====================================================================================================================
// Problem 5 of the re-check (item 4 of the task). BANA 11.16.1l's note says "Row headings are blocked in cell 5; column
// headings begin in cell 1. All headings are repeated for clarity. A colon separates headings from table entries."
// A table with no headings (formatListed's noHeadings) has neither repeated headings nor colons, so the note says only
// what its layout does.
// ====================================================================================================================
describe('problem 5: the listed-table note for a table with no headings', () => {
  const noHead = { type: 'table', format: 'listed', headers: ['', '', ''], rows: [['alpha', 'one', ''], ['beta', 'two', 'three']] };
  test('no mention of repeated headings or a colon; says where the entries go', () => {
    const text = formatBlock(noHead, bana()).join(' ').replace(/\s+/g, ' ');
    assert.ok(!/HEADINGS ARE REPEATED/.test(text) && !/COLON/.test(text), text);
    assert.ok(/THE FIRST ENTRY OF EACH ROW IS BLOCKED IN CELL 5; THE OTHER ENTRIES OF THE ROW BEGIN IN CELL 1\./.test(text), text);
    assert.ok(/A SERIES OF THREE GUIDE DOTS INDICATES A BLANK ENTRY IN PRINT\./.test(text), 'the blank-entry note is still true (guide dots used)');
    const lines = formatBlock(noHead, bana()).map(rstrip);
    assert.ok(lines.includes('    ALPHA') && lines.includes('ONE') && !lines.some((l) => l.includes(':')), 'the layout the note describes');
  });
  test('a table with headings keeps the full 11.16.1l note; format and trace agree', () => {
    const withHead = { ...noHead, headers: ['Name', 'Number', 'Other'] };
    assert.ok(/ALL HEADINGS ARE REPEATED FOR CLARITY\. A COLON SEPARATES HEADINGS FROM TABLE ENTRIES\./.test(formatBlock(withHead, bana()).join(' ').replace(/\s+/g, ' ')));
    for (const t of [noHead, withHead]) assert.deepEqual(traceBlock(t, bana()).map((x) => rstrip(x.s)), formatBlock(t, bana()).map(rstrip));
  });
});

// ====================================================================================================================
// Problem 6 of the re-check (item 5 of the task). BANA 11.4.4a: "When a table is continued on succeeding braille pages,
// repeat the column headings and separation line on each succeeding braille page"; 11.4.4b: a blank line between a
// running head and the repeated headings. A vertically divided table's section split over a page now repeats that
// section's headings (maths p8 -> p9, anthology p1104).
// ====================================================================================================================
describe('problem 6: a vertical-division section continued on the next page repeats its headings', () => {
  const rows = Array.from({ length: 14 }, (_, i) => [`Row ${i + 1}`, String(10 * i), String(6 * i), i % 2 ? 'yes' : 'no']);
  const wide = { type: 'table', format: 'vertical', headers: ['Row', 'Volume of popcorn in ounces', 'Price of the bag in dollars', 'Proportional or not'], rows };
  const isSep = (l) => /^\s*"3/.test(l);
  test('the fixture divides; format and trace agree, keep groups included', () => {
    assert.equal(tableLayout(wide, bana()), 'vertical');
    const f = formatBlock(wide, bana()), t = traceBlock(wide, bana());
    assert.deepEqual(t.map((x) => rstrip(x.s)), f.map(rstrip));
    assert.deepEqual(t.keepGroups, f.keepGroups);
  });
  test('every page that continues a section opens with that section\'s headings and separation line', () => {
    let continued = 0;
    for (let a = 60; a <= 320; a += 6) {
      const r = run({ blocks: [pn('1'), para(a), wide] }, bana());
      assertPlanMatches(r, `a=${a}`);
      r.pages.forEach((pg, p) => {
        if (!p) return;
        const b = body(pg), k = firstText(b);
        if (k < 0 || !/^ROW \d/.test(b[k])) return;          // this page opens with a data row: a continued section
        continued++;
        assert.fail(`a=${a}: page ${p + 1} opens with a data row, no repeated headings: ${b.slice(0, 3).join(' | ')}`);
      });
      // a repeated heading (one followed by a row other than the first) is the heading of the section it continues
      let last = null;
      const secOf = (l) => (/VOLUME/.test(l) ? 1 : /PRICE/.test(l) ? 2 : /PROPORTIONAL/.test(l) ? 3 : 0);
      r.pages.forEach((pg, p) => {
        const b = body(pg);
        b.forEach((l, k) => {
          if (!secOf(l) || !isSep(b[k + 1] || '')) return;
          const next = b.slice(k + 2).find((x) => x.trim()) || '';
          if (!/^ROW 1 /.test(next)) assert.equal(secOf(l), last, `a=${a}: page ${p + 1} repeats section ${secOf(l)}'s heading inside section ${last}`);
          last = secOf(l);
        });
      });
    }
    assert.equal(continued, 0);
  });
  test('a repeated section heading sits under a running head after one blank line, and on line 2 without one (11.4.4b)', () => {
    const many = { ...wide, format: 'vertical', rows: Array.from({ length: 40 }, (_, i) => [`Row ${i + 1}`, String(i), String(i), 'no']) };
    const shortT = splitPages(formatDocument({ title: 'Short', blocks: [many] }, bana()));
    const longT = splitPages(formatDocument({ title: 'A title far too long to fit as a running head at all', blocks: [many] }, bana()));
    const cont = (pages) => pages.findIndex((pg, p) => p > 0 && /VOLUME|PRICE|PROPORTIONAL/.test(pg[1] + pg[2]) && isSep(pg[2] + '') + isSep(pg[3] + ''));
    const s = cont(shortT), l = cont(longT);
    assert.ok(s > 0 && l > 0, 'a continued section in both');
    assert.ok(rstrip(shortT[s][0]).includes('SHORT'));
    assert.equal(rstrip(shortT[s][1]), '', 'blank line under the running head');
    assert.ok(/VOLUME|PRICE|PROPORTIONAL/.test(shortT[s][2]) && isSep(shortT[s][3]), shortT[s].slice(0, 4).join(' | '));
    assert.ok(/VOLUME|PRICE|PROPORTIONAL/.test(longT[l][1]) && isSep(longT[l][2]), `headings on line 2: ${longT[l].slice(0, 4).join(' | ')}`);
  });
  test('repeatHeadings: false keeps the old behaviour (no repeat), UKAAF unchanged', () => {
    const off = { ...wide, repeatHeadings: false };
    const f = formatBlock(off, bana());
    assert.ok(f.keepGroups.every((g) => g[2] === undefined || g[2] === 'W'), 'no repeatable heading groups (W: the notes kept with the first section)');
    assert.equal(formatBlock(wide, { ...bana(), mode: 'ukaaf', standard: 'ukaaf' }).keepGroups, undefined);
  });
});

// ====================================================================================================================
// Sync and async pagination agree on the documents above.
// ====================================================================================================================
describe('sync and async pagination agree', () => {
  test('glossary pieces, listed and vertical tables', async () => {
    const docs = [
      { blocks: [pn('1'), { type: 'heading', level: 2, text: 'Glossary' }, gloss(['alpha', 'beta']), pn('2'), gloss(['gamma'])] },
      { blocks: [pn('1'), para(150), { type: 'table', format: 'listed', title: 'T', headers: ['A', 'B'], rows: [['x', words(90)], ['y', 'z']] }] },
      { blocks: [pn('1'), para(200), { type: 'table', format: 'vertical', headers: ['Row', 'Volume of popcorn in ounces', 'Price of the bag in dollars', 'Proportional or not'],
        rows: Array.from({ length: 12 }, (_, i) => [`Row ${i}`, '1', '2', '3']) }] },
    ];
    for (const d of docs) assert.equal(await formatDocumentAsync(d, bana()), formatDocument(d, bana()));
  });
});
