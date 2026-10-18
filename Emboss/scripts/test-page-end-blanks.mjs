// Unit test for scripts/page-end-blanks.mjs, on a synthetic BRF whose
// blank-line-at-page-end counts are known by construction (not read off a
// real book, so there is no ambiguity about the "right" answer). Diagnosis
// task, 26 Sep 2026 (docs/diagnosis-ukaaf-and-page-count-26sep.md, part B).
// Plain-node pass/fail harness, matching tests/test-printpage.mjs's style.

import { splitPages, analyzeBrf } from './page-end-blanks.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m); } };

// Build one 25-line BANA page: line 1 = running head, lines 2-24 = body (23
// lines), line 25 = braille page number. `bodyLines` is an array of exactly
// 23 strings (blank or not); the caller controls how many trailing blanks
// it has.
function makePage({ head = '  ,SOME BOOK', bodyLines, pageNum }) {
  if (bodyLines.length !== 23) throw new Error(`test bug: need exactly 23 body lines, got ${bodyLines.length}`);
  return [head, ...bodyLines, pageNum].join('\r\n');
}

function blankBody(nContent, nTrailingBlank) {
  const arr = [];
  for (let i = 0; i < nContent; i++) arr.push(`  CONT5T L9E ${i + 1}`);
  for (let i = 0; i < nTrailingBlank; i++) arr.push('');
  if (arr.length !== 23) throw new Error('test bug: body must total 23 lines');
  return arr;
}

// ---------------------------------------------------------------------
// 1. splitPages: three pages, form-feed separated, trailing \r\n dropped.
// ---------------------------------------------------------------------
{
  const page1 = makePage({ bodyLines: blankBody(23, 0), pageNum: '                                      #A' });
  const page2 = makePage({ bodyLines: blankBody(18, 5), pageNum: '                                      #B' });
  const page3 = makePage({ bodyLines: blankBody(15, 8), pageNum: '                                      #C' });
  const brf = [page1, page2, page3].join('\f');
  const pages = splitPages(brf);
  ok(pages.length === 3, `splitPages should see 3 pages, got ${pages.length}`);
  ok(pages[0].length === 25, `page 1 should have 25 lines, got ${pages[0].length}`);
  ok(pages[0][0] === '  ,SOME BOOK', 'page 1 line 1 (running head) preserved');

  // A real BRF's trailing form feed at end-of-file must not create a
  // phantom extra (empty) page.
  const brfWithTrailingFF = brf + '\f';
  const pages2 = splitPages(brfWithTrailingFF);
  ok(pages2.length === 3, `a trailing form feed at EOF must not add a phantom page, got ${pages2.length}`);
}

// ---------------------------------------------------------------------
// 2. analyzeBrf: known trailing-blank counts per page, summed correctly.
// ---------------------------------------------------------------------
{
  const page1 = makePage({ bodyLines: blankBody(23, 0), pageNum: '  #A' }); // 0 trailing blank
  const page2 = makePage({ bodyLines: blankBody(18, 5), pageNum: '  #B' }); // 5 trailing blank
  const page3 = makePage({ bodyLines: blankBody(15, 8), pageNum: '  #C' }); // 8 trailing blank
  const brf = [page1, page2, page3].join('\f');
  const r = analyzeBrf(brf, { big: 5 });

  ok(r.pages === 3, `expected 3 pages, got ${r.pages}`);
  ok(r.totalBlankAtPageEnds === 0 + 5 + 8, `expected total blank 13, got ${r.totalBlankAtPageEnds}`);
  ok(r.pagesWithBigGap === 2, `expected 2 pages at/above the big=5 threshold (pages 2 and 3), got ${r.pagesWithBigGap}`);
  const hist = Object.fromEntries(r.histogram);
  ok(hist[0] === 1, 'histogram: one page with 0 trailing blank lines');
  ok(hist[5] === 1, 'histogram: one page with 5 trailing blank lines');
  ok(hist[8] === 1, 'histogram: one page with 8 trailing blank lines');
}

// ---------------------------------------------------------------------
// 3. A blank line in the MIDDLE of the body (not trailing) must not count,
//    and must not break the trailing scan early. This is the case the
//    naive "count all blank lines" approach gets wrong and this script
//    exists to avoid: only the RUN at the very end of the body counts.
// ---------------------------------------------------------------------
{
  const body = [];
  for (let i = 0; i < 10; i++) body.push(`  L9E ${i}`);
  body.push(''); // one blank line mid-body
  for (let i = 0; i < 9; i++) body.push(`  L9E B ${i}`);
  for (let i = 0; i < 3; i++) body.push(''); // 3 trailing blank
  ok(body.length === 23, 'test bug check: body is 23 lines');
  const page = makePage({ bodyLines: body, pageNum: '  #A' });
  const r = analyzeBrf(page, { big: 5 });
  ok(r.totalBlankAtPageEnds === 3, `mid-body blank line must not be counted as trailing; expected 3, got ${r.totalBlankAtPageEnds}`);
}

// ---------------------------------------------------------------------
// 4. --exclude-last drops the final page from the histogram/total (a
//    book's last page is expected to end early; the 24 Sep real-book
//    report excludes it from the equivalent check for the same reason).
// ---------------------------------------------------------------------
{
  const page1 = makePage({ bodyLines: blankBody(23, 0), pageNum: '  #A' });
  const page2 = makePage({ bodyLines: blankBody(3, 20), pageNum: '  #B' }); // last page, ends early
  const brf = [page1, page2].join('\f');
  const withLast = analyzeBrf(brf, { big: 5 });
  const withoutLast = analyzeBrf(brf, { big: 5, excludeLast: true });
  ok(withLast.pagesWithBigGap === 1, 'without --exclude-last, the short last page counts as a big gap');
  ok(withoutLast.pagesWithBigGap === 0, 'with --exclude-last, the short last page is dropped');
  ok(withoutLast.pages === 2 && withoutLast.pagesAnalyzed === 1, 'pages vs pagesAnalyzed distinguishes the total from what was counted');
}

// ---------------------------------------------------------------------
// 5. --causes classification: a heading-shaped line and a list-item line
//    opening the next page get distinct, sensible labels. This is a
//    heuristic over the output text (see the script's header comment) so
//    the test only checks the patterns the script itself claims to
//    recognise, built the same way format/document.mjs builds them.
// ---------------------------------------------------------------------
{
  const indicatorLine = '             "31111111111'; // format/document.mjs indicatorLine('dot2s', 38): '"3' + '1'.repeat(10), centred
  const gapPage = makePage({ bodyLines: blankBody(15, 8), pageNum: '  #A' });
  const headingNextPage = makePage({ bodyLines: ['          ,A CENTR$ HEAD+', ...Array(22).fill('  BODY TEXT')], pageNum: '  #B' });
  const brf = [gapPage, headingNextPage].join('\f');
  const r = analyzeBrf(brf, { big: 5, causes: true });
  ok(r.bigPages.length === 1, 'one big-gap page found');
  ok(r.bigPages[0].cause === 'centred heading (heading kept with next)', `expected a centred-heading classification, got ${JSON.stringify(r.bigPages[0].cause)}`);

  const boxNextPage = makePage({ bodyLines: ['7777777777777777777777', ...Array(22).fill('  BOX CONT5T')], pageNum: '  #B' });
  const brf2 = [gapPage, boxNextPage].join('\f');
  const r2 = analyzeBrf(brf2, { big: 5, causes: true });
  ok(r2.bigPages[0].cause === 'box top line (sidebar/box kept together)', `expected a box classification, got ${JSON.stringify(r2.bigPages[0].cause)}`);

  const listNextPage = makePage({ bodyLines: ['  #A4 ,FIR/ ITEM', ...Array(21).fill('  BODY TEXT'), ''], pageNum: '  #B' });
  const brf3 = [gapPage, listNextPage].join('\f');
  const r3 = analyzeBrf(brf3, { big: 5, causes: true });
  ok(r3.bigPages[0].cause === 'ordered list item (list kept together)', `expected an ordered-list classification, got ${JSON.stringify(r3.bigPages[0].cause)}`);
  void indicatorLine; // referenced for documentation of the pattern source; not asserted separately here
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
