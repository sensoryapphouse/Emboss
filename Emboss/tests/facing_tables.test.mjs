// K15 (EMBOSS-TASKS.md): wide tables on facing pages — BANA Braille Formats 2016 §11.13 (with §11.6.1b, §11.4.4,
// §11.14.1) and UKAAF B004 Appendix E ("Good practice example of a table over two pages").
//
//   11.13.1 "Wide tables may be placed on facing pages in single-sided and interpoint production. Care must be taken
//   to ensure that the first page is on the left-hand page."  a. full width of the two pages;  b. "the front side of
//   the left facing page may be blank";  c. a transcriber's note before the table;  d. only the table and its related
//   content on the facing pages;  e. notes and headings above the top box line, which "serves as a locator on the right
//   facing page and must be followed by column headings";  f. the box line after the print page number line (line 3
//   with a running head);  g. the title on the left-hand page only;  h. the source after the table on the left-hand
//   page only;  i. no row headings on the right-hand page;  j/k. the separation line and guide dots of the last
//   left-hand column run on to the right margin;  l. a column may end in the last cell;  m. the right-hand page's
//   first column begins in cell 1.
//   11.6.1b "Begin all column entries on the line on which the row heading ends." (row alignment across the pair)
//   11.14.1 "When a divided table takes more than a single page, the preferred format is to place the table on
//   facing pages." (the automatic order, BANA only)
//
// The exact-braille proof is BANA's own Sample 11-21 (tests/gold/bana-formats-2016/section-11/sample-11-21.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;
import { formatDocument, formatVolumes, formatBlock, traceBlock, tableLayout, getBlockSignature } from '../format/document.mjs';
import { parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import * as louis from '../engine/louis.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const W = 40;
const base = (mode = 'bana') => ({ mode, standard: mode, width: W, depth: 25, translate });
const pagesOf = (brf) => brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));
const fmt = (blocks, extra = {}, doc = {}) => pagesOf(formatDocument({ title: null, ...doc, blocks }, { ...base(extra.mode), ...extra }));
// BANA page with line-1 furniture: body = lines 2..24.
const body = (page) => page.slice(1, 24);
const trimEnd = (a) => { const b = a.slice(); while (b.length && b[b.length - 1] === '') b.pop(); return b; };

// Sample 11-21's print (the gold file's print description, not its braille).
const gold = JSON.parse(fs.readFileSync(path.join(HERE, 'gold', 'bana-formats-2016', 'section-11', 'sample-11-21.json'), 'utf8'));
const unionized = (format = 'facing') => ({
  type: 'table', format, title: gold.print.caption, headers: gold.print.headers[0], rows: gold.print.rows,
  printAlign: gold.print.columnAlign.map((a) => (a === 'decimal' || a === 'right' ? a : null)),
});
const up = (l) => l.toUpperCase();

// A long, wide numeric table: 9 columns, `n` rows (row 3 has a two-line row heading).
const wide = (n, format = 'facing', extra = {}) => ({
  type: 'table', format, title: 'Table 3', ...extra,
  headers: ['Country', '1900', '1910', '1920', '1930', '1940', '1950', '1960', '1970'],
  rows: Array.from({ length: n }, (_, i) => [i === 2 ? 'Republic of Somewhere Else' : `Land ${i + 1}`, ...Array.from({ length: 8 }, (_, k) => `${(i * 7 + k * 13) % 90 + 10}.${k}`)]),
});
const para = (text) => ({ type: 'para', text });
const pagenum = (page) => ({ type: 'pagenum', page });

test('Sample 11-21: the left and right pages match the book from the table heading on', () => {
  const pages = fmt([pagenum('60'), unionized()]);
  const g = gold.braille.lines.map(up);
  // Left-hand page: line 1 carries the print page number (#fj), as in the book.
  assert.equal(pages[0][0].trim(), '#FJ');
  // The book's line 1 also carries the start of the note beside the page number; Emboss keeps line 1 for the
  // page number, so the note starts on line 2 (and wraps differently). From the heading on, the lines are the book's,
  // except that the separation line and guide dots of the last left-hand column end in cell 40: the rule says "to the
  // right margin" (11.13.1j/k) and the page image (PDF p.328) shows cell 40; the gold text, from the PDF text layer,
  // lost the double spaces between columns and so ended them at cell 37 (K33: the gold's column gaps are now the
  // book's two cells; `toMargin` extends any run the gold still ends short of the margin).
  const left = body(pages[0]);
  const at = left.indexOf(g[3]);                               // the centred heading ",UNIONIZ$ ,MANUAL ,"W]S"
  assert.ok(at > 0, 'the table heading is on the left-hand page');
  const toMargin = (l) => (/["3]$/.test(l) ? l + l.slice(-1).repeat(W - l.length) : l);
  assert.deepEqual(left.slice(at, at + 9), g.slice(3, 12).map(toMargin));
  // The transcriber's note (11.13.1c's sample wording) comes first, then a blank line, then the heading (Sample 11-21).
  assert.deepEqual(left.slice(0, at), ['      @.<,! FOLL[+ TABLE IS R1D ACR FAC+', '    PAGES4@.>', '']);
  // Right-hand page: the print page number continues (a#fj, as in the book), nothing above the top box line (no
  // title, 11.13.1g), the remaining columns from cell 1 with no row headings (11.13.1i, m), line for line with the
  // left-hand page.
  assert.equal(pages[1][0], g[12]);
  const right = body(pages[1]);
  assert.deepEqual(right.slice(0, at + 1), Array(at + 1).fill(''));
  assert.deepEqual(right.slice(at + 1, at + 9), g.slice(16, 24));
  assert.deepEqual(trimEnd(right).length, trimEnd(left).length);
  assert.equal(pages.length, 2);
});

test('Sample 11-21: the column split is the book\'s (1900-1930 left, 1940-1950 right)', () => {
  const pages = fmt([pagenum('60'), unionized()]);
  // Two blank cells between columns (11.2.5b; K33 - the page image of Sample 11-21 shows two; the one-cell gap this
  // test used to pin came from the gold's text-dump transcription).
  assert.match(pages[0].join('\n'), /#AIJJ  #AIAJ  #AIBJ  #AICJ/);
  assert.match(pages[1].join('\n'), /^#AIDJ  #AIEJ$/m);
});

test('the table starts on a left-hand page: an even page in interpoint, after a blank page when needed (11.13.1, 11.13.1b)', () => {
  const lead = Array.from({ length: 26 }, (_, i) => para(`Paragraph number ${i + 1} of the text.`));   // runs onto page 2
  const ip = fmt([...lead, pagenum('60'), unionized()], { interpoint: true });
  // page 2 ends the text, page 3 (a right-hand page) is left blank, the table opens page 4 (left) and 5 (right)
  assert.ok(ip[1].some((l) => /,P>AGRAPH/.test(l)));
  assert.deepEqual(body(ip[2]).filter(Boolean), [], 'page 3 is blank');
  assert.match(ip[3].join('\n'), /FOLL\[\+ TABLE IS R1D/);
  assert.equal(ip[3][0].trim(), '#FJ', 'the print page change goes with the table (not onto the blank page)');
  assert.match(ip[4].join('\n'), /#AIDJ  #AIEJ/);
  // single-sided: any page can be bound as the left-hand page — no page is added
  const ss = fmt([...lead, pagenum('60'), unionized()]);
  assert.match(ss[2].join('\n'), /FOLL\[\+ TABLE IS R1D/);
  assert.equal(ss.length, ip.length - 1);
  // interpoint, text ending on an odd page: the table's page is already even — no blank page
  const ip2 = fmt([para('Short text.'), pagenum('60'), unionized()], { interpoint: true });
  assert.match(ip2[1].join('\n'), /FOLL\[\+ TABLE IS R1D/);
  assert.match(ip2[2].join('\n'), /#AIDJ  #AIEJ/);
  // the table itself as the first page of an interpoint book: page 1 is a right-hand page, so it is left blank
  const ip3 = fmt([unionized()], { interpoint: true });
  assert.deepEqual(ip3[0].slice(0, 24).filter(Boolean), []);
  assert.match(ip3[1].join('\n'), /FOLL\[\+ TABLE IS R1D/);
});

test('only the table is on the facing pages: the text before and after it is on other pages (11.13.1d)', () => {
  const pages = fmt([para('Text before the table.'), unionized(), para('Text after the table.')]);
  assert.equal(pages.length, 4);
  assert.match(pages[0].join('\n'), /2F ! TABLE/);
  assert.ok(!/TABLE IS R1D/.test(pages[0].join('\n')));
  assert.match(pages[1].join('\n'), /TABLE IS R1D/);
  assert.ok(!/AF ! TABLE/.test(pages[1].join('\n') + pages[2].join('\n')));
  assert.match(pages[3].join('\n'), /AF ! TABLE/);
});

// A table too wide for the two pages at its natural widths, so each page's columns are squeezed (the row heading
// "North West Territories" and the entry "none grown" each take two lines).
const crops = (format = 'facing') => ({
  type: 'table', format, headers: ['Region', 'Wheat', 'Barley', 'Oats', 'Rye', 'Maize', 'Rice', 'Hops', 'Flax'],
  rows: [['North', '1234', '2345', '3456', '4567', '5678', '6789', '7890', '11'],
    ['North West Territories', '1234', '2345', '3456', '4567', '5678', '6789', 'none grown', '11'],
    ['South', '1234', '2345', '3456', '4567', '5678', '6789', '7890', '11']],
});

test('row alignment: entries begin on the line on which the row heading ends, on both pages (11.6.1b)', () => {
  const [left, right] = fmt([crops()]);
  const li = left.findIndex((l) => l.startsWith(',NOR? ,WE/'));
  assert.ok(li > 0);
  // the row heading runs over (11.6.1a: two cells in); the entries begin on its last line, on the left-hand page ...
  assert.ok(!/#/.test(left[li]), 'no entry on the row heading\'s first line');
  assert.match(left[li + 1], /^ {2},T\]RITORIES +#ABCD  #BCDE +#CDEF$/);
  // ... and on the same line of the right-hand page, whose first line of the row is blank
  assert.equal(right[li], '');
  assert.match(right[li + 1], /^#DEFG .*N"O GR\[N  #AA$/);
  // the rows before and after are level on the two pages (guide dots, then the two-cell column gap: 11.2.5b, K33)
  assert.match(left[li - 1], /^,NOR\? "+  #ABCD/);
  assert.match(right[li - 1], /^#DEFG .*#GHIJ "+  #AA$/);
  assert.match(left[li + 2], /^,S\\\? "+  #ABCD/);
  assert.match(right[li + 2], /^#DEFG /);
  // the column headings, separation lines and box lines are level too (11.13.1e: the top box line is the locator)
  const top = left.findIndex((l) => /^7{40}$/.test(l));
  assert.equal(right[top], '7'.repeat(W));
  assert.match(left[top + 1], /^,REGION +,:1T/);
  assert.match(right[top + 1], /^,RYE /);
  assert.match(left[top + 2], /^"3+  "3/);   // two cells between separation runs (K33)
  assert.match(right[top + 2], /^"3/);
  assert.equal(left[li + 3], 'G'.repeat(W));
  assert.equal(right[li + 3], 'G'.repeat(W));
});

test('B004 App E Example 2 (UKAAF, 38 cells): split across the pages, rows lined up, runovers left blank opposite', () => {
  const g = JSON.parse(fs.readFileSync(path.join(HERE, 'gold', 'ukaaf-b004', 'appendix-e', 'example-2.json'), 'utf8'));
  const days = { Monday: 'Mon', Tuesday: 'Tues', Wednesday: 'Wed', Thursday: 'Thurs', Friday: 'Fri' };   // "Days of the week are abbreviated."
  const t = { type: 'table', format: 'facing', title: ['Table 3:', 'Weather Forecast for Somewhere City'], headers: g.print.headers[0], rows: g.print.rows.map((r) => [days[r[0]], ...r.slice(1)]) };
  const [left, right] = fmt([t], { mode: 'ukaaf', width: 38 });
  // B004's split: Summary, Maximum temperature, Humidity on the left; Visibility, Pressure, Wind direction and speed right
  const hl = left.findIndex((l) => /,SUMM>Y/.test(l));
  assert.match(left[hl], /,SUMM>Y +,MAXIMUM +,HUMID;Y/);
  assert.match(right[hl], /^,VISIBIL;Y +,PRESSURE +,W9D +,W9D$/);
  // "Light cloud" runs over on the left: the right-hand page leaves that line blank so the next row lines up
  const tues = left.findIndex((l) => l.startsWith(',TUES'));
  assert.match(left[tues + 1], /^ +CL\\D$/);
  assert.equal(right[tues + 1], '');
  assert.match(left[tues + 2], /^,W\$/);
  assert.match(right[tues + 2], /^,GD "+ #AJAFMB/);
  // the guidelines on the first page extend to the right-hand side (38 cells)
  assert.equal(left[tues].length, 38);
});

test('a longer table continues on further page pairs, headings repeated on both pages (11.4.4a/b, 11.13.1f)', () => {
  const pages = fmt([pagenum('12'), wide(40)], { interpoint: true }, { title: 'My Book' });
  // pages: 2-3, 4-5, 6-7 (the first page is a right-hand page with only the carried print page number, so blank)
  const isLeft = (p) => /TABLE IS R1D|,C\.TRY/.test(p.join('\n')) && /,L& /.test(p.join('\n'));
  const lefts = pages.map((p, i) => (isLeft(p) ? i + 1 : null)).filter(Boolean);
  assert.ok(lefts.length >= 2, 'at least two pairs');
  lefts.forEach((n) => assert.equal(n % 2, 0, `left-hand page ${n} is an even page`));
  lefts.forEach((n, k) => {
    const left = pages[n - 1], right = pages[n];
    // same line structure: headings line for line
    const hl = left.findIndex((l) => /^,C\.TRY/.test(l));
    assert.ok(hl > 0);
    assert.match(right[hl], /^#AIBJ  #AICJ/);
    assert.match(left[hl + 1], /^"3/);
    assert.match(right[hl + 1], /^"3/);
    if (k > 0) {
      // a continuation pair: a running head is used, so a blank line 2 before the repeated headings (11.4.4b)
      assert.equal(hl, 2);
      assert.equal(left[1], '');
      assert.equal(right[1], '');
      assert.match(left[24], /,TABLE #C "<3T4">/, '"(cont.)" note on the left-hand page (11.3.2b)');
    }
    assert.ok(!/"<3T4">/.test(right[24]), 'no "(cont.)" note on a right-hand page (11.13.1g)');
    // the title only on the first left-hand page (11.13.1g)
    assert.equal(left.some((l) => l.trim() === ',TABLE #C'), k === 0);
    assert.ok(!right.some((l) => l.trim() === ',TABLE #C'));
  });
  // box lines: top on the first pair only, bottom on the last pair only, both on both pages
  const tops = pages.map((p, i) => (p.some((l) => /^7{40}$/.test(l)) ? i + 1 : null)).filter(Boolean);
  const bottoms = pages.map((p, i) => (p.some((l) => /^G{40}$/.test(l)) ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(tops, [lefts[0], lefts[0] + 1]);
  assert.deepEqual(bottoms, [lefts[lefts.length - 1], lefts[lefts.length - 1] + 1]);
  // every row is on exactly one pair, in order
  const rowsSeen = pages.flatMap((p) => p.filter((l) => /^,L& #/.test(l)).map((l) => l.split(' ')[1]));
  assert.equal(rowsSeen.length, 39);
});

test('the right-hand page never shows row headings; its first column starts in cell 1 (11.13.1i, m)', () => {
  const pages = fmt([wide(6)]);
  const right = pages[1];
  assert.ok(right.every((l) => !/,L&|,C\.TRY|,REPUBLIC/.test(l)));
  assert.ok(right.some((l) => /^#/.test(l)));
  assert.ok(right.every((l) => l.length <= W));
});

test('the last left-hand column: separation line and guide dots run on to the right margin (11.13.1j, k)', () => {
  const pages = fmt([wide(6)]);
  const left = pages[0];
  const sep = left.find((l) => /^"3/.test(l));
  assert.equal(sep.length, W);
  assert.match(sep, /3$/);
  const rows = left.filter((l) => /^,L& #/.test(l));
  rows.forEach((l) => { assert.equal(l.length, W); assert.match(l, /\d \"+$|[A-J] \"+$/); });
});

test('the source goes after the table on the left-hand page only (11.13.1h)', () => {
  const pages = fmt([{ ...wide(6), citation: 'Source: Made-up Statistics Office.' }]);
  const left = pages[0], right = pages[1];
  const b = left.findIndex((l) => /^G{40}$/.test(l));
  assert.match(left[b + 1], /^ {4},S\\RCE3/);
  assert.equal(right[b + 1], '');
  assert.equal(pages.flatMap((p) => p).filter((l) => /S\\RCE3/.test(l)).length, 1);
  // when the source would not fit on the table's last page, it goes after the table heading, blocked 4 cells in from
  // the beginning of the heading's last line
  const full = fmt([{ ...wide(16), citation: 'Source: Made-up Statistics Office.' }]);
  const l0 = full[0];
  const h = l0.findIndex((l) => l.trim() === ',TABLE #C');
  assert.equal(l0[h + 1].trimStart().slice(0, 7), ',S\\RCE3');
  assert.equal(l0[h + 1].length - l0[h + 1].trimStart().length, (l0[h].length - l0[h].trimStart().length) + 4);
  assert.equal(full.flatMap((p) => p).filter((l) => /S\\RCE3/.test(l)).length, 1);
});

test('automatic order (BANA): squeeze -> vertical division on one page -> facing pages -> listed (11.14.1, KD)', () => {
  // Sample 11-21/11-22's table: the vertical division fits one page, so 'auto' divides it (Sample 11-22)
  const small = fmt([unionized('auto')]);
  assert.match(small[0].join('\n'), /DIVID\$ V\]TICALLY/);
  // a divided table longer than a page is set on facing pages instead
  const long = fmt([wide(12, 'auto')]);
  assert.match(long[0].join('\n'), /TABLE IS R1D ACR FAC\+/);
  // a table that fits the page stays columnar
  const narrow = fmt([{ type: 'table', format: 'auto', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] }]);
  assert.ok(!/FAC\+/.test(narrow[0].join('\n')));
  // UKAAF: facing pages are only a good-practice example (B004 App E), never chosen automatically
  const uk = fmt([wide(12, 'auto')], { mode: 'ukaaf' });
  assert.ok(!/FAC\+/.test(uk.flat().join('\n')));
  // a table that cannot be divided vertically: facing pages only for a table of figures (two or more all-number
  // columns — KD's number-heavy tables); any other table keeps Listed as before
  const figures = { type: 'table', format: 'auto', headers: ['Region of the country and its area', 'Wheat', 'Barley', 'Oats', 'Rye', 'Maize', 'Rice'],
    rows: [['The northern and western territories of the whole country', '12.5', '22.5', '32.5', '42.5', '52.5', '62.5']] };
  assert.equal(tableLayout(figures, base()), 'facing');
  const words = { type: 'table', format: 'auto', headers: ['Animal Name', 'Habitat Description', 'Population Count'],
    rows: [['Mountain Gorilla', 'Dense tropical forest', '880 individuals'], ['Snow Leopard', 'High mountain terrain', '4000 individuals']] };
  assert.equal(tableLayout(words, { ...base(), width: 30 }), 'listed');
  assert.equal(tableLayout({ ...words, format: 'facing' }, { ...base(), width: 30 }), 'facing', 'but it can be chosen');
  // tableLayout (the editor's badge) agrees
  assert.equal(tableLayout(wide(12, 'auto'), base()), 'facing');
  assert.equal(tableLayout(unionized('auto'), base()), 'vertical');
  assert.equal(tableLayout(wide(12, 'facing'), base('ukaaf')), 'facing');
});

test('facing pages in UKAAF: heading, note, headings; no box lines; rows aligned; guidelines to the right-hand side (B004 App E)', () => {
  const pages = fmt([wide(6)], { mode: 'ukaaf' });
  const left = pages[0], right = pages[1];
  assert.match(left.join('\n'), /,TABLE #C\n {2}@\.<,! FOLL\[\+ TABLE IS TO 2 R1D ACR\nFAC\+ PAGES4@\.>/);
  assert.ok(!pages.flat().some((l) => /^7{10,}$|^G{10,}$/.test(l)));
  const hl = left.findIndex((l) => /^,C\.TRY/.test(l));
  assert.match(right[hl], /^#AIBJ/);
  left.filter((l) => /^,L& #/.test(l)).forEach((l) => assert.equal(l.length, W));
});

test('not set on facing pages: inside a box, too wide for two pages, or narrow enough for one page', () => {
  const inBox = fmt([{ type: 'box', blocks: [wide(4)] }]);
  assert.ok(!/FAC\+/.test(inBox.flat().join('\n')));
  const tooWide = { ...wide(3), headers: ['Country', ...Array.from({ length: 14 }, (_, k) => `Year ${1900 + k}`)], rows: [['A', ...Array(14).fill('12.5')]] };
  assert.ok(!/FAC\+/.test(fmt([tooWide]).flat().join('\n')));
  const narrow = fmt([{ type: 'table', format: 'facing', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']] }]);
  assert.ok(!/FAC\+/.test(narrow.flat().join('\n')));
  assert.equal(narrow.length, 1);
});

test('A39: traceBlock and formatBlock give the same lines; the editor path (translatePos) gives the same pages', () => {
  const o = { ...base(), translatePos };
  for (const t of [unionized(), wide(9), { ...wide(5), citation: 'Source: X.' }]) {
    const b = { ...t, _facingPerPage: 23 };
    const f = formatBlock(b, o, false);
    const tr = traceBlock(b, o, false);
    assert.deepEqual(tr.map((x) => x.s), f);
    assert.deepEqual(tr.keepGroups, f.keepGroups);
    assert.ok(f.some((l) => l.length > W), 'the block carries both pages');
  }
  for (const mode of ['bana', 'ukaaf']) {
    const doc = { title: 'Book', blocks: [para('Before.'), pagenum('3'), wide(30), para('After.')] };
    assert.equal(formatDocument(doc, { ...base(mode), translatePos }), formatDocument(doc, base(mode)));
  }
  // the page length is part of the cache key (BANA 11.14.1 depends on it)
  assert.notEqual(getBlockSignature({ ...wide(3), _facingPerPage: 23 }, base(), false), getBlockSignature({ ...wide(3), _facingPerPage: 22 }, base(), false));
});

test('NIMAS round trip: format "facing" is class="bana-facing"', () => {
  const block = { type: 'table', format: 'facing', headers: ['A', 'B'], rows: [['1', '2']] };
  const xml = exportToNimasXml({ title: null, blocks: [block] });
  assert.match(xml, /<table class="bana-facing">/);
  const find = (bs) => bs.find((b) => b && b.type === 'table') || bs.map((b) => (b && b.blocks ? find(b.blocks) : null)).find(Boolean);
  const t = find(parseDtbook(xml).blocks);
  assert.equal(t.format, 'facing');
  assert.deepEqual(t.rows, block.rows);
});

// ---- Volumes (K15 follow-up). BANA 11.13.1: "Care must be taken to ensure that the first page is on the left-hand page";
// 11.13.1b: "the front side of the left facing page may be blank"; 1.15.1d: "Begin the main text of each volume with
// braille page 1". A volume split (settings volumePages) never separates the two pages of a pair, and in interpoint the
// left-hand page is an even page of its own volume. BANA says nothing else about tables at a volume boundary: a volume
// boundary is a page boundary, so the page-turn rules (11.4.4a repeated headings, 11.3.2b "(cont.)") already apply there.
const volPages = (vols) => vols.map((v) => v.brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n')).slice(1));   // less the volume title page
const kindOf = (p) => {
  const t = p.join('\n');
  if (/FOLL\[\+ TABLE IS R1D|,C\.TRY|,UNIONIZ\$/.test(t) && (/,L& |,D5M>K/.test(t))) return 'L';
  if (/#AIDJ  #AIEJ|^#AI[F-G]J/m.test(t) || (/^#AI[B-J]J  #AI/m.test(t) && !/,L& |,D5M>K/.test(t))) return 'R';
  return body(p).some(Boolean) ? 'text' : 'blank';
};
const vdoc = (n, table) => ({ title: 'Book', blocks: [...Array.from({ length: n }, (_, i) => para(`Paragraph number ${i + 1} of the text.`)), pagenum('60'), table, para('After the table.')] });

test('volumes: the two pages of a facing pair are never split between volumes (single-sided)', () => {
  // 26 paragraphs: text on pages 1-2, the pair on 3-4, text on 5. At 3 pages a volume the old fixed split put the
  // left-hand page at the end of volume 1 and the right-hand page at the start of volume 2.
  const vols = volPages(formatVolumes(vdoc(26, unionized()), { ...base(), volumePages: 3 }));
  assert.deepEqual(vols.map((v) => v.map(kindOf)), [['text', 'text'], ['L', 'R', 'text']]);
  // each volume numbered from braille page 1 (1.15.1d)
  vols.forEach((v) => v.forEach((p, k) => assert.equal(p[24].trim(), ['#A', '#B', '#C'][k])));
});

test('volumes, interpoint: the left-hand page stays even in its volume — a blank page added, or the book\'s own dropped', () => {
  // 50 paragraphs: text on pages 1-3, the pair on 4-5 (even already, no blank page in the book). At 3 pages a volume the
  // pair opens volume 2, where page 1 is a right-hand page: it is left blank and the pair is on pages 2-3.
  const a = volPages(formatVolumes(vdoc(50, unionized()), { ...base(), interpoint: true, volumePages: 3 }));
  assert.deepEqual(a.map((v) => v.map(kindOf)), [['text', 'text', 'text'], ['blank', 'L', 'R'], ['text']]);
  // the added blank page: running head kept, no print page number (its continuation letter is the next page's), page #a
  assert.equal(a[1][0][0].trim(), ',BOOK');
  assert.equal(a[1][0][24].trim(), '#A');
  assert.equal(a[1][1][0].trim().slice(-3), '#FJ', 'the print page change stays on the left-hand page');
  // 75 paragraphs: text on pages 1-4, the book's blank page 5, the pair on 6-7. Volume 2 starts at page 4, so the pair
  // is on its pages 2-3 without the blank page: it is dropped (the old split put the blank and the left-hand page in
  // volume 2 and the right-hand page in volume 3).
  const b = volPages(formatVolumes(vdoc(75, unionized()), { ...base(), interpoint: true, volumePages: 3 }));
  assert.deepEqual(b.map((v) => v.map(kindOf)), [['text', 'text', 'text'], ['text', 'L', 'R'], ['text']]);
  // 26 paragraphs, 4 pages a volume: the book's blank page 3 goes with the pair into volume 2 (pages 1-3)
  const c = volPages(formatVolumes(vdoc(26, unionized()), { ...base(), interpoint: true, volumePages: 4 }));
  assert.deepEqual(c.map((v) => v.map(kindOf)), [['text', 'text'], ['blank', 'L', 'R', 'text']]);
});

test('volumes: a table on several pairs may change volume only between pairs; every left-hand page even in interpoint', () => {
  for (const interpoint of [false, true]) {
    const doc = { title: 'Book', blocks: [para('Opening text.'), pagenum('12'), wide(40), para('After the table.')] };
    const whole = pagesOf(formatDocument(doc, { ...base(), interpoint }));
    const wholeKinds = whole.map(kindOf).filter((k) => k !== 'blank');
    for (let maxV = 2; maxV <= 7; maxV++) {
      const vols = volPages(formatVolumes(doc, { ...base(), interpoint, volumePages: maxV }));
      const kinds = vols.map((v) => v.map(kindOf));
      kinds.forEach((v, vi) => v.forEach((k, i) => {
        if (k === 'L') {
          assert.equal(v[i + 1], 'R', `maxV ${maxV}, volume ${vi + 1}: left-hand page ${i + 1} has its right-hand page after it`);
          if (interpoint) assert.equal((i + 1) % 2, 0, `maxV ${maxV}, volume ${vi + 1}: left-hand page ${i + 1} is even`);
        }
        if (k === 'R') assert.equal(v[i - 1], 'L');
      }));
      // nothing lost or repeated: the same pages in the same order as the single-volume book (blank pages aside)
      assert.deepEqual(kinds.flat().filter((k) => k !== 'blank'), wholeKinds, `maxV ${maxV}`);
      // a volume is over maxV only when it holds just a pair (and its blank page)
      kinds.forEach((v) => { if (v.length > maxV) assert.ok(v.filter((k) => k === 'text').length === 0 && v.length <= 3, JSON.stringify(v)); });
    }
  }
});

test('volumes without a facing-pages table: the fixed split every volumePages pages is unchanged', () => {
  const doc = vdoc(75, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] });
  for (const interpoint of [false, true]) {
    const vols = volPages(formatVolumes(doc, { ...base(), interpoint, volumePages: 3 }));
    assert.deepEqual(vols.map((v) => v.length), [3, 1]);
  }
});
