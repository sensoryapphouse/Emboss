#!/usr/bin/env node
// page-end-blanks.mjs — diagnosis metric for the "Emboss produces 11-15% more
// pages than BrailleBlaster" question (Fable review, 26 Sep 2026, section 1;
// see docs/diagnosis-ukaaf-and-page-count-26sep.md and
// docs/real-book-validation-24sep*.md, which first measured "pages ending
// with 5 or more blank lines" by hand for one book). This script makes that
// metric runnable against ANY BRF (Emboss's own, or a BrailleBlaster export)
// so it can be tracked per-commit / per-book instead of re-measured by hand.
//
// DIAGNOSIS ONLY — this script does not change, and must not be used to
// change, formatter/parser/editor behaviour (AGENTS.md rule 1, and this
// task's own brief).
//
// What it measures, per BRF:
//   - page count
//   - total blank lines at page ends (summed over all pages)
//   - a histogram of "blank lines at this page's end" (0, 1, 2, ... and a
//     configurable "N+" bucket)
//   - (Emboss BRFs only, best-effort) the top "causes": for each page whose
//     trailing blank run is at or above --big (default 5, matching the
//     24 Sep report's own threshold), what kind of content opens the NEXT
//     page — a heading kept with its following text, a table kept together,
//     a list, a box, a forced section break, or something unclassified.
//     This is done by pattern-matching the BRF text itself (there is no
//     block-by-block trace available from a bare .brf file), so it is a
//     heuristic, not a re-run of the formatter. See classifyPageStart()
//     for exactly what each pattern is and format/document.mjs for the
//     BRF shapes it is matched against (box lines ~2894/3940/3947,
//     indicator lines ~123, page-change line format in format/page.mjs
//     ~114). Cross-check any specific finding against document.mjs before
//     acting on it — this script's classification is a starting point for
//     that reading, not a replacement for it.
//
// A page's BODY is defined the same way docs/real-book-validation-24sep-
// recheck.md defines it: line 1 is furniture (running head / print page
// number) and the last line of the page is furniture (the braille page
// number), so the body is every line strictly between them. This matches
// both Emboss's and BrailleBlaster's BANA 40x25 output (both put exactly
// one furniture line at the top and bottom of every full page). The script
// does not assume a fixed depth: it always drops just the first and last
// line of whatever lines a page has, so a short final page (or a
// non-25-line geometry) is still handled sensibly. Pass --depth to also
// sanity-check that pages have the expected number of lines (a warning
// only; it does not change what is counted).
//
// Usage:
//   node scripts/page-end-blanks.mjs <file.brf> [file2.brf ...]
//     [--big N]        threshold for "big" gap / the headline "N+" stat (default 5)
//     [--depth N]      expected lines per full page, for a sanity warning only (default 25)
//     [--exclude-last] drop the last page of each file from the histogram/total
//                       (a book's final page is expected to end early; the
//                       24 Sep report excluded it from its own "pages with
//                       few body lines" check for the same reason)
//     [--causes]       print the best-effort per-book "top causes" breakdown
//                       (Emboss BRFs only — meaningless noise on a
//                       BrailleBlaster file, since its line shapes don't
//                       match Emboss's block vocabulary; the script does not
//                       try to guess which is which, so pass this only for
//                       Emboss files)
//     [--json]         machine-readable output instead of the text report
//
// Exit code is always 0 — this is a reporting tool, not a gate.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------
// Page splitting
// ---------------------------------------------------------------------

// Split a raw BRF (read as latin1, matching format/test-corpus.mjs and
// scripts/test-emboss-g2-broad-corpus.mjs's own convention for this
// 64-character BRF-ASCII text) into pages, each an array of lines with the
// trailing empty string (from the final \r\n before the form feed) dropped.
export function splitPages(raw) {
  return raw.split('\f').map((pg) => {
    const lines = pg.split(/\r\n|\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }).filter((lines) => lines.length > 0 || false); // keep even a single blank page; only drop a truly empty trailing split
}

// Body lines of a page: drop the first (running head / print page number)
// and last (braille page number) line. A page with 2 or fewer lines has no
// body by this definition (both lines are furniture, or there is only
// furniture) and is skipped by the counters below.
function bodyOf(pageLines) {
  if (pageLines.length <= 2) return [];
  return pageLines.slice(1, -1);
}

const isBlank = (line) => line.trim() === '';

// Trailing run of blank body lines, i.e. "blank lines at this page's end".
function trailingBlankCount(bodyLines) {
  let n = 0;
  for (let i = bodyLines.length - 1; i >= 0; i--) {
    if (isBlank(bodyLines[i])) n++; else break;
  }
  return n;
}

// ---------------------------------------------------------------------
// Best-effort classifier for what opens a page, for the "causes" report.
// Every pattern here is taken from format/document.mjs / format/page.mjs
// (see the header comment); this is pattern-matching the OUTPUT text, not
// re-running the formatter, so treat a classification as a lead to verify
// by reading document.mjs, not as ground truth.
// ---------------------------------------------------------------------
const PAGE_CHANGE_RE = /^-{3,}[^-\s]\S*$/; // format/page.mjs BANA_PAGE_CHANGE_RE
const BOX_TOP_RE = /^7{4,}$/;              // format/document.mjs ~2894/3940: '7'.repeat(width)
const BOX_BOTTOM_RE = /^G{4,}$/;           // ~2894/3947: 'G'.repeat(width)
const BOX_EXTERIOR_RE = /^={4,}$/;         // ~2894: '='.repeat(width) (exterior box)
const INDICATOR_LINE_RE = /^\s*"3[13]{4,}\s*$/;      // format/document.mjs ~123: indicatorLine('dot2s'|'colons')
const ASTERISK_BREAK_RE = /^\s*"9( "9){1,}\s*$/;     // ~123: indicatorLine('asterism'|'asterisks')
const TABLE_SEP_RE = /^-{10,}$/;            // a full-width dash rule with nothing after it (columnar table separator; distinct from PAGE_CHANGE_RE, which always has a non-dash tail)
const ORDERED_LIST_RE = /^\s{1,6}#[a-j]\S*[0-9]/i; // e.g. "  #A4 ..." (nestedIndent list numbering)
const BULLET_LIST_RE = /^\s{1,6}_4\s/;      // e.g. "_4 DESCRIBE ..." (bullet glyph)
const HEADING_INDENT_RE = /^\s{6,}\S/;       // a level-1/centred heading is indented well past body margin

function classifyPageStart(nextPageBody) {
  const first = (nextPageBody.find((l) => !isBlank(l)) ?? '').trimEnd();
  if (first === '') return 'blank page / no content line found';
  if (PAGE_CHANGE_RE.test(first)) return 'page-change indicator (print page turn)';
  if (BOX_TOP_RE.test(first) || BOX_EXTERIOR_RE.test(first)) return 'box top line (sidebar/box kept together)';
  if (BOX_BOTTOM_RE.test(first)) return 'box bottom line (stray — check keep grouping)';
  if (INDICATOR_LINE_RE.test(first)) return 'section end-marker / indicator line';
  if (ASTERISK_BREAK_RE.test(first)) return 'asterism / break';
  if (TABLE_SEP_RE.test(first)) return 'table separator row (table kept together)';
  if (ORDERED_LIST_RE.test(first)) return 'ordered list item (list kept together)';
  if (BULLET_LIST_RE.test(first)) return 'bullet list item (list kept together)';
  if (HEADING_INDENT_RE.test(first)) return 'centred heading (heading kept with next)';
  if (/^\s{2,5}\S/.test(first)) return 'new paragraph / list runover (indented, not centred)';
  return 'body text continuing (cell-1 line)';
}

// ---------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------

export function analyzeBrf(raw, { big = 5, depth = 25, excludeLast = false, causes = false } = {}) {
  let pages = splitPages(raw);
  if (pages.length && pages[pages.length - 1].every(isBlank)) pages = pages.slice(0, -1); // drop a wholly-blank trailing split artifact
  const total = pages.length;
  const analyzed = excludeLast ? pages.slice(0, -1) : pages;

  const histogram = new Map(); // trailingBlankCount -> page count
  let sumBlank = 0;
  let bigCount = 0;
  let depthMismatches = 0;
  const causesMap = new Map(); // classification -> count
  const bigPages = []; // { pageIndex (1-based), blanks, nextPageStart }

  for (let i = 0; i < analyzed.length; i++) {
    const lines = analyzed[i];
    if (depth && lines.length !== depth + 1 && lines.length !== depth) depthMismatches++; // +1 allows for an unpopped trailing blank on odd inputs
    const body = bodyOf(lines);
    const blanks = trailingBlankCount(body);
    histogram.set(blanks, (histogram.get(blanks) || 0) + 1);
    sumBlank += blanks;
    if (blanks >= big) {
      bigCount++;
      let cause = null;
      if (causes && i + 1 < pages.length) {
        cause = classifyPageStart(bodyOf(pages[i + 1]));
        causesMap.set(cause, (causesMap.get(cause) || 0) + 1);
      }
      bigPages.push({ page: i + 1, blanks, cause });
    }
  }

  return {
    pages: total,
    pagesAnalyzed: analyzed.length,
    totalBlankAtPageEnds: sumBlank,
    histogram: [...histogram.entries()].sort((a, b) => a[0] - b[0]),
    bigThreshold: big,
    pagesWithBigGap: bigCount,
    depthMismatches,
    causes: causes ? [...causesMap.entries()].sort((a, b) => b[1] - a[1]) : null,
    bigPages,
  };
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function formatReport(file, r) {
  const lines = [];
  lines.push(`\n=== ${file} ===`);
  lines.push(`pages: ${r.pages}${r.pagesAnalyzed !== r.pages ? ` (${r.pagesAnalyzed} analyzed, last page excluded)` : ''}`);
  lines.push(`total blank lines at page ends: ${r.totalBlankAtPageEnds}`);
  lines.push(`pages ending with ${r.bigThreshold}+ blank lines: ${r.pagesWithBigGap}`);
  if (r.depthMismatches) lines.push(`note: ${r.depthMismatches} page(s) did not have the expected line count — check --depth`);
  lines.push('histogram (blank lines at page end -> page count):');
  for (const [n, count] of r.histogram) lines.push(`  ${String(n).padStart(3)}: ${count}`);
  if (r.causes) {
    lines.push(`top causes for pages with ${r.bigThreshold}+ trailing blank lines (what opens the NEXT page; heuristic, see script header):`);
    for (const [cause, count] of r.causes) lines.push(`  ${String(count).padStart(4)}  ${cause}`);
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let big = 5, depth = 25, excludeLast = false, causes = false, json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--big') big = Number(argv[++i]);
    else if (a === '--depth') depth = Number(argv[++i]);
    else if (a === '--exclude-last') excludeLast = true;
    else if (a === '--causes') causes = true;
    else if (a === '--json') json = true;
    else files.push(a);
  }
  if (files.length === 0) {
    console.error('Usage: node scripts/page-end-blanks.mjs <file.brf> [...] [--big N] [--depth N] [--exclude-last] [--causes] [--json]');
    process.exit(2);
  }
  const results = {};
  for (const f of files) {
    const raw = fs.readFileSync(path.resolve(f), 'latin1');
    results[f] = analyzeBrf(raw, { big, depth, excludeLast, causes });
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const [f, r] of Object.entries(results)) console.log(formatReport(f, r));
  }
}

// Only run the CLI when invoked directly (so the test file can import
// splitPages/analyzeBrf without triggering it). Compares real filesystem
// paths (not raw URL strings) so this still matches when the path contains
// spaces or other characters that fileURLToPath's source URL percent-encodes.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
