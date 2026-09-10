// Comprehensive unit tests for UKAAF B004 §8 and BANA Formats §1.6 print page numbers in Emboss
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate } from '../format/text-style.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const T = louis.TABLES.uebG2;
const raw = (t, tf) => louis.translate(t, T, tf);
const translate = styledTranslate(raw, 'faithful');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m); } };

function getPages(brf) {
  return brf.split('\x0c').map((p) => p.replace(/\r\n$/, '').split('\r\n'));
}

console.log('=== TEST SUITE: Print Page Numbers (UKAAF B004 & BANA Formats 2016) ===\n');

// -----------------------------------------------------------------------------
// 1. UKAAF: Centred Print Page Change Indicator Line in Body
// -----------------------------------------------------------------------------
{
  const doc = {
    blocks: [
      { type: 'para', text: 'Top of print page 12.' },
      { type: 'pagenum', page: '13' },
      { type: 'para', text: 'Start of print page 13.' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 1, 'UKAAF doc produces at least 1 page');
  const page1 = pages[0];

  // UKAAF Line 1: Braille page number right-aligned
  const line1 = page1[0];
  ok(line1.endsWith('#A'), `UKAAF Page 1 Line 1 ends with braille page number #A (got: "${line1}")`);

  // UKAAF body: Centred "3#AC indicator
  const pagenumLine = page1.find(l => l.includes('"3'));
  ok(pagenumLine != null, 'UKAAF print page line contains "3 indicator');
  const expectedPageBrl = translate('13').trim();
  ok(pagenumLine.includes('"3' + expectedPageBrl), 'UKAAF indicator is immediately followed by page number');
  const trimmed = pagenumLine.trim();
  const leadingSpaces = pagenumLine.indexOf(trimmed);
  const trailingSpaces = 38 - leadingSpaces - trimmed.length;
  ok(Math.abs(leadingSpaces - trailingSpaces) <= 1, `UKAAF print page line is centred (leading: ${leadingSpaces}, trailing: ${trailingSpaces})`);
}

// -----------------------------------------------------------------------------
// 2. UKAAF: Multi-Page with Running Head and Braille Page Numbers
// -----------------------------------------------------------------------------
{
  const doc = {
    title: 'Short Story',
    blocks: [
      { type: 'heading', level: 1, text: 'Chapter One' },
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 15 }, (_, i) => ({ type: 'para', text: `Paragraph ${i + 1} with plenty of words to fill up multiple lines across the page.` })),
      { type: 'pagenum', page: '2' },
      ...Array.from({ length: 15 }, (_, i) => ({ type: 'para', text: `Second chapter paragraph ${i + 1} filling subsequent braille lines.` }))
    ]
  };
  const brf = formatDocument(doc, { standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 2, `UKAAF multi-page doc produced ${pages.length} pages (expected >= 2)`);

  // Page 1 Line 1: #A at right
  ok(pages[0][0].endsWith('#A'), `UKAAF Page 1 Line 1 ends with #A`);

  // Page 2 Line 1: Running head title centred + #B at right
  const page2Line1 = pages[1][0];
  ok(page2Line1.endsWith('#B'), `UKAAF Page 2 Line 1 ends with #B (got: "${page2Line1}")`);
  const titleBrl = translate('short story').trim();
  ok(page2Line1.includes(titleBrl), `UKAAF Page 2 Line 1 contains centred running head title "${titleBrl}"`);
}

// -----------------------------------------------------------------------------
// 3. BANA: Single Page - Print Page Top-Right (Line 1), Braille Page Bottom-Right (Line 25)
// -----------------------------------------------------------------------------
{
  const doc = {
    blocks: [
      { type: 'pagenum', page: '5' },
      { type: 'para', text: 'This is the opening text of print page 5.' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length === 1, `BANA single-page doc produces 1 page (got ${pages.length})`);
  const page1 = pages[0];

  // BANA Line 1: Print page number right-aligned (#E)
  const line1 = page1[0];
  ok(line1.endsWith('#E'), `BANA Page 1 Line 1 ends with print page #E (got: "${line1}")`);

  // BANA Line 25 (last line): Braille page number right-aligned (#A)
  const lastLine = page1[page1.length - 1];
  ok(lastLine.endsWith('#A'), `BANA Page 1 Line 25 ends with braille page #A (got: "${lastLine}")`);
}

// -----------------------------------------------------------------------------
// 4. BANA: Multi-Page Continuation (1 -> a1 -> b1)
// -----------------------------------------------------------------------------
{
  // Fill enough paragraphs under print page 1 to span 3 braille pages
  const doc = {
    blocks: [
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 28 }, (_, i) => ({
        type: 'para',
        text: `Paragraph number ${i + 1}: Continuous descriptive narrative designed to generate multiple braille lines on each sheet.`
      }))
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 3, `BANA continuation doc produced ${pages.length} pages (expected >= 3)`);

  // Page 1 Line 1: #A (print page 1)
  ok(pages[0][0].endsWith('#A'), `BANA Page 1 Line 1 is "#A" (got: "${pages[0][0]}")`);
  ok(pages[0][pages[0].length - 1].endsWith('#A'), `BANA Page 1 Line 25 is braille page "#A"`);

  // Page 2 Line 1: A#A (continuation a1)
  ok(pages[1][0].endsWith('A#A'), `BANA Page 2 Line 1 is continuation "A#A" (got: "${pages[1][0]}")`);
  ok(pages[1][pages[1].length - 1].endsWith('#B'), `BANA Page 2 Line 25 is braille page "#B"`);

  // Page 3 Line 1: B#A (continuation b1)
  ok(pages[2][0].endsWith('B#A'), `BANA Page 3 Line 1 is continuation "B#A" (got: "${pages[2][0]}")`);
  ok(pages[2][pages[2].length - 1].endsWith('#C'), `BANA Page 3 Line 25 is braille page "#C"`);
}

// -----------------------------------------------------------------------------
// 5. BANA: Mid-Page Transition Line & Continuation on Following Page
// -----------------------------------------------------------------------------
{
  const doc = {
    blocks: [
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 14 }, (_, i) => ({
        type: 'para',
        text: `Page 1 para ${i + 1}: Text filling the first braille page and continuing onto the second.`
      })),
      { type: 'pagenum', page: '2' },
      ...Array.from({ length: 18 }, (_, i) => ({
        type: 'para',
        text: `Page 2 para ${i + 1}: Text that starts mid-page on braille page 2 and spills onto braille page 3.`
      }))
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 3, `BANA mid-page transition doc produced ${pages.length} pages`);

  // Page 2 started on print page 1, so Line 1 is continuation "A#A"
  ok(pages[1][0].endsWith('A#A'), `BANA Page 2 Line 1 starts with continuation "A#A" (got: "${pages[1][0]}")`);

  // Page 2 body contains the mid-page transition line: "3----- #B
  const transLine = pages[1].find(l => l.startsWith('"3-'));
  ok(transLine != null, `BANA Page 2 body contains mid-page transition line`);
  if (transLine) {
    ok(transLine.length === 40, `BANA transition line spans 40 cells (got ${transLine.length})`);
    ok(transLine.endsWith(' #B'), `BANA transition line ends with " #B" (got "${transLine}")`);
  }

  // Page 3 started on print page 2 (which began on Page 2), so Page 3 Line 1 is continuation "A#B"
  ok(pages[2][0].endsWith('A#B'), `BANA Page 3 Line 1 is continuation "A#B" (got: "${pages[2][0]}")`);
  ok(pages[2][pages[2].length - 1].endsWith('#C'), `BANA Page 3 Line 25 is braille page "#C"`);
}

// -----------------------------------------------------------------------------
// 6. BANA: Top-of-Page Transition Suppression
// -----------------------------------------------------------------------------
{
  // In BANA with depth 25, content lines per page = 23 (lines 2..24).
  // We craft a block that takes exactly 23 content lines on Page 1.
  // Then print page 2 starts at the very top of Page 2 body.
  const doc = {
    blocks: [
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 11 }, (_, i) => ({
        type: 'para',
        text: `Line pair ${i + 1}: Two lines of text here to fill the page exactly.`
      })),
      { type: 'pagenum', page: '2' },
      { type: 'para', text: 'First paragraph of print page 2 at the top of the braille page.' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 2, `Top-of-page suppression doc produced ${pages.length} pages`);

  // Page 2 Line 1 should be fresh print page 2: "#B" (not continuation "A#A" or "A#B")
  ok(pages[1][0].endsWith('#B'), `BANA Page 2 Line 1 is "#B" (got: "${pages[1][0]}")`);

  // Page 2 body should NOT contain a transition line "3----- #B
  const transLineInPage2 = pages[1].find(l => l.startsWith('"3-'));
  ok(transLineInPage2 == null, `BANA Page 2 suppressed the transition line in body (got: "${transLineInPage2}")`);
}

// -----------------------------------------------------------------------------
// 7. BANA: Running Head with Print Page on Line 1
// -----------------------------------------------------------------------------
{
  const doc = {
    title: 'Biology 101',
    blocks: [
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 25 }, (_, i) => ({
        type: 'para',
        text: `Paragraph ${i + 1}: Biology course content discussing cell mitosis and meiosis in detail.`
      }))
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pages = getPages(brf);
  ok(pages.length >= 2, `BANA running head doc produced ${pages.length} pages`);

  // Page 2 Line 1 has running head and continuation print page "A#A"
  const page2Line1 = pages[1][0];
  ok(page2Line1.endsWith('A#A'), `BANA Page 2 Line 1 ends with "A#A"`);
  const titleBrl = translate('biology 101').trim();
  ok(page2Line1.includes(titleBrl), `BANA Page 2 Line 1 contains running head title "${titleBrl}"`);
  // Check ≥3 blank cells clearance before print page number
  const titleIdx = page2Line1.indexOf(titleBrl);
  const printPageIdx = page2Line1.lastIndexOf('A#A');
  const gap = printPageIdx - (titleIdx + titleBrl.length);
  ok(gap >= 3, `BANA Line 1 has at least 3 cells of clearance between running head and page number (got ${gap})`);
}

// -----------------------------------------------------------------------------
// 8. Document Without Print Pages
// -----------------------------------------------------------------------------
{
  const doc = {
    title: 'No Print Pages',
    blocks: [
      { type: 'para', text: 'This document has no print page number markers at all.' }
    ]
  };
  const brfUkaaf = formatDocument(doc, { standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate });
  const pagesUkaaf = getPages(brfUkaaf);
  ok(pagesUkaaf[0][0].endsWith('#A'), 'UKAAF Line 1 has braille page #A when no print pages');

  const brfBana = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, translate });
  const pagesBana = getPages(brfBana);
  ok(pagesBana[0][pagesBana[0].length - 1].endsWith('#A'), 'BANA Line 25 has braille page #A when no print pages');
  ok(!pagesBana[0][0].endsWith('#A'), 'BANA Line 1 does not have print page when none provided');
}

// -----------------------------------------------------------------------------
// 9. Coercion & Translation of Alphanumeric and Roman Numerals
// -----------------------------------------------------------------------------
{
  const doc = {
    blocks: [
      { type: 'pagenum', page: 123 },
      { type: 'pagenum', page: 'iv' },
      { type: 'pagenum', page: 'A-5' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, translate });
  ok(brf.includes('"3' + translate('123').trim()), 'Numeric page number 123 translated');
  ok(brf.includes('"3' + translate('iv').trim()), 'Roman numeral page "iv" translated');
  ok(brf.includes('"3' + translate('A-5').trim()), 'Alphanumeric page "A-5" translated');
}

// -----------------------------------------------------------------------------
// 10. BANA: Orphan Prevention (Formats 2016 §1.15.2) - No Isolated Transition Line at Bottom
// -----------------------------------------------------------------------------
{
  // 23 body lines per BANA page when depth=25 (Line 1 is header, Line 25 is footer, Lines 2-24 are body).
  // If we fill 22 body lines, then a pagenum block with following text would exceed the page (22 + 1 + 1 = 24 > 23),
  // so the pagenum must be pushed to Page 2, and suppressed on Page 2's body since it's at the top of the braille page.
  const doc = {
    blocks: [
      { type: 'pagenum', page: '1' },
      ...Array.from({ length: 22 }, (_, i) => ({ type: 'para', text: `Line ${i + 1} content.` })),
      { type: 'pagenum', page: '2' },
      { type: 'para', text: 'Start of print page 2 body text.' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'bana', mode: 'bana', width: 40, depth: 25, paragraphStyle: 'indent', translate });
  const pages = getPages(brf);
  ok(pages.length >= 2, `BANA orphan prevention produced at least 2 pages (got ${pages.length})`);

  const page1 = pages[0];
  const page2 = pages[1];

  // Page 1 should NOT contain a transition line "3- at the bottom
  const transLineInPage1 = page1.find(l => l.includes('"3-'));
  ok(transLineInPage1 == null, `BANA Page 1 has no orphaned transition line at bottom (got: "${transLineInPage1}")`);
  ok(page1[0].endsWith('#A'), 'BANA Page 1 Line 1 is print page #A');
  ok(page1[page1.length - 1].endsWith('#A'), 'BANA Page 1 Line 25 is braille page #A');

  // Page 2 should have print page #B on Line 1 and body text on Line 2 (transition suppressed)
  ok(page2[0].endsWith('#B'), `BANA Page 2 Line 1 is print page #B (got: "${page2[0]}")`);
  const transLineInPage2 = page2.find(l => l.includes('"3-'));
  ok(transLineInPage2 == null, `BANA Page 2 suppressed top-of-page transition line (got: "${transLineInPage2}")`);
  ok(page2[page2.length - 1].endsWith('#B'), 'BANA Page 2 Line 25 is braille page #B');
}

// -----------------------------------------------------------------------------
// 11. UKAAF: Orphan Prevention (B004 §8) - Print Page Indicator Not Stranded at Bottom
// -----------------------------------------------------------------------------
{
  // 24 body lines per UKAAF page when depth=25 (Line 1 is header, Lines 2-25 are body).
  // If we fill 23 body lines, then a pagenum block (1 line) + 1 text line cannot fit on Page 1 (23 + 2 = 25 > 24),
  // so the pagenum moves to Page 2.
  const doc = {
    blocks: [
      ...Array.from({ length: 23 }, (_, i) => ({ type: 'para', text: `Line ${i + 1} of document.` })),
      { type: 'pagenum', page: '2' },
      { type: 'para', text: 'First line of print page 2 text.' }
    ]
  };
  const brf = formatDocument(doc, { standard: 'ukaaf', mode: 'ukaaf', width: 38, depth: 25, paragraphStyle: 'indent', translate });
  const pages = getPages(brf);
  ok(pages.length >= 2, `UKAAF orphan prevention produced at least 2 pages (got ${pages.length})`);

  const page1 = pages[0];
  const page2 = pages[1];

  // Page 1 should NOT contain the "3#B indicator
  const indicatorInPage1 = page1.find(l => l.includes('"3'));
  ok(indicatorInPage1 == null, `UKAAF Page 1 has no orphaned indicator at bottom (got: "${indicatorInPage1}")`);

  // Page 2 should contain the "3#B indicator at top of body followed by text
  const indicatorInPage2 = page2.find(l => l.includes('"3'));
  ok(indicatorInPage2 != null, 'UKAAF Page 2 contains the print page indicator');
}

console.log(`\ntest-printpage: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);

