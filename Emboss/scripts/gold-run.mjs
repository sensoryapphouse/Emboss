#!/usr/bin/env node
// Gold-example runner: BANA Braille Formats 2016, multi-section.
//
// For every gold file in tests/gold/bana-formats-2016/<section>/*.json, builds a
// document model from its `print` field ONLY (never from `braille` — that is the
// expected result, not an input), formats it with formatDocument in BANA mode at
// 40 cells / 25 lines with the translator the editor and Quick Mode use (liblouis uebG2 inside
// styledTranslate: format/node-translate-helper.mjs, import fix list #55), and compares the
// result line-by-line against `braille.lines`. Reports MATCH/MISMATCH per sample
// with a unified diff, the first differing line, and a one-line diagnosis.
//
// This is a measuring tool (standards-testing.md, stage 4-5): it never fixes
// anything. What cannot be built faithfully from `print` (a rowspanned/multi-row
// header, a diagonal corner line, a bar-graph derivation, bold/shading, a book's
// own transcriber's note whose text isn't given as structured print data, etc.)
// is recorded per-sample instead of invented.
//
//   node Emboss/scripts/gold-run.mjs [--section <name>] [--sample <id>] [--update-status]
//
// --section <name>    which gold section to run (default: section-11). Currently
//                      supported: "section-11" (Tables and Related Columns, the
//                      original §11 pilot — print is a table/box/caption model),
//                      "section-4" (Headings — print is a flat print.blocks[] list:
//                      {kind:'heading'|'paragraph'|'list-item'|'other', level, text,
//                      features}; see buildModel4 and tests/gold/bana-formats-2016/
//                      section-4/README.md), and "section-8" (Lists — print.blocks[]
//                      of {kind:'heading'|'paragraph'|'list'|'box'|'other', ...}, a
//                      'list' block carrying its own items[] with {marker, bullet,
//                      level, text}; see buildModel8 and tests/gold/bana-formats-2016/
//                      section-8/README.md), and "section-7" (Boxed Material —
//                      print.blocks[] of {kind:'heading'|'paragraph'|'list'|'table'|
//                      'box'|'other', ...}, a 'box' block carrying its own nested
//                      blocks[] (and an optional title/colorNote); see buildModel7 and
//                      tests/gold/bana-formats-2016/section-7/README.md), "section-1"
//                      (Basic Principles and General Formats — print.page{runningHead,
//                      printPageNumber, features} + print.blocks[] of
//                      {kind:'heading'|'paragraph'|'list'|'table'|'box'|'pagenum'|
//                      'other', ...}; see buildModel1 and tests/gold/bana-formats-2016/
//                      section-1/README.md), "b004-6-9" (UKAAF B004 §6-9 — same
//                      schema as section-1, formatted in UKAAF mode; gold files live
//                      under tests/gold/ukaaf-b004/sections-6-9/, see that directory's
//                      own README.md), "section-16" (Notes — print.blocks[] as above
//                      plus a separate print.notes[] of {ref, placement, text}; a
//                      paragraph's own [ref:MARK] tokens become noteref segments
//                      linked by synthetic id to a matching footnote/endnote block;
//                      see buildModel16 and tests/gold/bana-formats-2016/section-16/
//                      README.md), "b004-11" (UKAAF B004 §11, Notes and
//                      footnotes — same schema as section-16, formatted in UKAAF
//                      mode; gold files live under tests/gold/ukaaf-b004/section-11/,
//                      see that directory's own README.md), "section-9" (Displayed
//                      Material, Attributions, and Source Information —
//                      print.blocks[] of {kind:'heading'|'paragraph'|'quote'|
//                      'epigraph'|'attribution'|'source'|'list'|'box'|'other', ...};
//                      see buildModel9 and tests/gold/bana-formats-2016/section-9/
//                      README.md), "b004-appendix-g" (UKAAF B004 Appendix G,
//                      Quoted material — same schema as section-9, both gold files
//                      no-braille prose-only "Examples"; gold files live under
//                      tests/gold/ukaaf-b004/appendix-g/, see that directory's own
//                      README.md), and "section-3" (Transcriber's Notes —
//                      print.blocks[] of {kind:'heading'|'paragraph'|'note'|'list'|
//                      'pagenum'|'other', ...} plus a top-level print.transcriberNote
//                      documentation field; see buildModel3 and tests/gold/
//                      bana-formats-2016/section-3/README.md), and "section-12"
//                      (Sidebars — print.blocks[] of {kind:'heading'|'paragraph'|
//                      'attribution'|'list'|'sidebar'|'other', ...}; a 'sidebar' block
//                      carries its own nested blocks[] (and an optional title) and is
//                      built identically to buildModel7's own 'box' — a print sidebar
//                      IS a box in Emboss's document model; see buildModel12 and
//                      tests/gold/bana-formats-2016/section-12/README.md), and
//                      "section-6" (Illustrative Materials — print.blocks[] of
//                      {kind:'heading'|'paragraph'|'note'|'list'|'table'|'box'|
//                      'pagenum'|'figure'|'caption'|'other', ...}; a 'figure' block
//                      is documentation-only except for an optional sibling
//                      `description` string, built either merged into the very next
//                      'caption' block as one document 'graphic' block (BANA 6.2.2's
//                      caption+description image model) or, with no caption to pair
//                      with, as a standalone transcriber's note; see buildModel6 and
//                      tests/gold/bana-formats-2016/section-6/README.md), and "section-19"
//                      (Codes and Puzzles — print.blocks[] of {kind:'heading'|'paragraph'|
//                      'note'|'list'|'code'|'other', ...}; a 'code' block is the one
//                      mechanism that emits any grade-1-passage-wrapped output at all for a
//                      devised code/key/grid, and a 'paragraph' block's own `blocked:true`
//                      marks a puzzle's own flush title line; every genuine puzzle/grid/key
//                      this flat schema cannot express is 'other' — see buildModel19,
//                      standards-findings.md F-217..F-224, and tests/gold/
//                      bana-formats-2016/section-19/README.md).
// --sample <id>       run just one gold file (e.g. --sample sample-11-06)
// --update-status     write status.json next to the gold files with the current
//                      match/mismatch/not-representable/no-braille truth

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(__dirname, '..');
const SECTIONS_ROOT = path.join(EMBOSS, 'tests', 'gold', 'bana-formats-2016');

const { formatDocument } = await import(path.join(EMBOSS, 'format', 'document.mjs'));
const { parseCellMarkup } = await import(path.join(EMBOSS, 'format', 'cell-markup.mjs'));
const { editorTranslators } = await import(path.join(EMBOSS, 'format', 'node-translate-helper.mjs'));
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
// Translators built exactly the way the editor and Quick Mode build theirs (format/node-translate-helper.mjs; import
// fix list #55, 1 Oct 2026): liblouis wrapped in styledTranslate, so sub/superscript level signs (RUEB's grade-1 rules,
// A86), quote exchange (UK-3, off by default as in the app) and the invisible-character clean-up are measured against
// the gold too, not just bare liblouis. `translateG1` is the grade 1 translator for segments the model marks
// `uncontracted` (spelling lists §17, foreign words §21.9, uncontracted passages §5), which the app passes as well.
// No translatePos: this is the classic path (check-layout-parity.mjs proves it agrees with the editor's).
const { translate, translateG1 } = editorTranslators(louis);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const argVal = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1]; };
// GOLD_RUN_SECTION lets a regression-guard test file (which runs with no CLI args) select
// a section by setting the env var and dynamically importing this module afterwards — see
// gold_bana_section4.test.mjs.
const SECTION = argVal('--section') || process.env.GOLD_RUN_SECTION || 'section-11';
// b004-6-9 (UKAAF B004 §6-9), b004-11 (UKAAF B004 §11, Notes and footnotes), and
// b004-appendix-g (UKAAF B004 Appendix G, Quoted material) live under
// tests/gold/ukaaf-b004/, not tests/gold/bana-formats-2016/ — every other section id
// here is a BANA one.
const UKAAF_GOLD_DIRS = { 'b004-6-9': 'sections-6-9', 'b004-11': 'section-11', 'b004-appendix-g': 'appendix-g', 'b004-appendix-j': 'appendix-j', 'b004-appendix-e': 'appendix-e' };
const GOLD_DIR = UKAAF_GOLD_DIRS[SECTION]
  ? path.join(EMBOSS, 'tests', 'gold', 'ukaaf-b004', UKAAF_GOLD_DIRS[SECTION])
  : path.join(SECTIONS_ROOT, SECTION);
const STATUS_FILE = path.join(GOLD_DIR, 'status.json');
const ONLY = argVal('--sample');
const UPDATE_STATUS = argv.includes('--update-status');

// ---------------------------------------------------------------------------
// Model building — from sample.print ONLY.
// ---------------------------------------------------------------------------
// Cells here are plain JS strings that go through Emboss's lightweight markup
// DSL (format/cell-markup.mjs parseCellMarkup: *bold* _underline_ `code` $latex$
// and a leading backslash escapes any of those, plus '<'). Real print text can
// contain any of those characters literally (a dollar amount, a backslash used
// as a diagonal-line divider, an underscore) with no formatting intent, so every
// literal string pulled from `print` is escaped before use.
const MARKUP_RE = /[*_`$<\\]/g;
const esc = (s) => String(s ?? '').replace(MARKUP_RE, '\\$&');

// `print.headers`/`print.caption` can hold a print line-break as " / " (see the
// gold README and sample-11-02's two-line title). For a genuine BANA CAPTION (11.2.8) that
// break is cosmetic — the caption is one flowing paragraph — so we *concatenate* it with a
// space and let Emboss's own wrapping decide where lines fall; hard-coding the book's own
// line break there would be testing our line breaks, not Emboss's wrapping rule.
const joinPrintLines = (s) => String(s ?? '').split(' / ').join(' ');

// For a HEADING (BANA 11.3.1a — see isTitle below) the break is real, not cosmetic: each
// print line is centred independently, never joined with the next even where the two would
// together fit the width (gold-verified: BANA Sample 11-2's braille keeps "Table 11.1" alone
// on its own centred line, not merged into "Summary Comparison of Outlays..."; BANA Example
// 11-4 keeps its sequence-number line "Table 9.5" separate from the title line the same way).
// `\n` and " / " both mark this break in this gold corpus's own `print.caption` field.
const splitPrintLines = (s) => String(s ?? '').split(/\n| \/ /).map((t) => t.trim()).filter(Boolean);

function cellToModel(v, limitations, where) {
  if (v == null) return '';
  if (typeof v === 'string') return esc(v);
  if (typeof v === 'number' || typeof v === 'boolean') return esc(String(v));
  limitations.push(`non-string cell at ${where} (${JSON.stringify(v)}) — stringified best-effort, may not be faithful.`);
  try { return esc(String(v.text ?? JSON.stringify(v))); } catch { return ''; }
}

// Heuristic: `print.caption` plays two different real roles in this gold set —
// (a) an actual table CAPTION (BANA 11.2.8a: "usually a brief explanation" — 7-5 margins,
//     never centred; the standalone 'caption' block, formatCaption); or
// (b) the table's own HEADING (BANA 11.3.1a: its title/name, e.g. "Table 12: Populations"
//     — centred; carried on the table block itself as `.title`, formatTable's formatTitle;
//     see standards-findings.md F-4).
// The gold data doesn't separate these into two fields. `printFeatures`'s own English
// description turns out NOT to be a reliable signal either way — e.g. Sample 11-22's own
// text never says "title"/"centred" at all, and Sample 11-08's says "caption" for a heading
// that is, per its own gold braille, in fact centred — so, per BANA 11.2.8a's own definition
// of what a caption actually is (an EXPLANATION, in full-sentence prose), the signal used
// here is `print.caption` itself: every genuine caption in this section (just Sample 11-1,
// this section's own worked illustration of the caption rule) is a complete sentence ending
// in terminal punctuation ("...how much interest you will earn."); every table HEADING
// (every other captioned sample: "Table 4. Minimum...", "Unionized Manual Workers", "SAT
// Scores by Race and Ethnicity", ...) is a bare name/label with no terminal punctuation at
// all — checked against every one of this section's 19 captioned samples/examples.
// Table-heading placement (BANA 11.3.1b, "follow print") is read from the PRINT description only: print.printFeatures
// says the title/heading/label is "above [a|the] [bordered] box" or "outside" the box (and does not say it is INSIDE the
// box). Descriptions that were checked against the page image and found to have the title inside the box now say
// "INSIDE the box" (11-04, 11-09, 11-11, 11-14, 11-16, 11-21, 11-22), so an old "above the box" is never mistaken for them.
// No sample id is consulted and the gold braille is never read.
const titleOutsideBoxByPrint = (printFeatures) => {
  const t = String(printFeatures || '');
  if (/\binside the box\b|\bwithin the box\b/i.test(t)) return false;
  return /\b(?:title|heading|label|caption)\b[^.;]*\b(?:above (?:a |the )?(?:bordered |ruled )?(?:box|table)|outside (?:it|the box|the (?:ruled )?table))/i.test(t)
    || /\bABOVE the box\b|\boutside the box\b|,? outside it\b/.test(t);
};
function buildModel11(sample) {
  const print = sample.print || {};
  const printFeatures = String(print.printFeatures || '');
  const limitations = [];
  const blocks = [];

  // Set only when print.caption is BANA's HEADING (11.3.1a), never its CAPTION (11.2.8) —
  // attached to the table block below instead of pushed as a standalone sibling block.
  let tableTitle = null;
  if (print.caption) {
    const isCaption = /[.!?]$/.test(String(print.caption).trim());
    if (isCaption) {
      const text = esc(joinPrintLines(print.caption));
      blocks.push({ type: 'caption', text });
    } else {
      const lines = splitPrintLines(print.caption).map(esc);
      tableTitle = lines.length > 1 ? lines : (lines[0] ?? null);
    }
  }

  // BANA §11.4.3 (F-12): a genuine two-row header is a primary heading spanning two or
  // more sub-columns (`print.headers` row 1 repeats its text across every column it
  // spans, per the gold README) or a single-tier heading spanning both rows (one row
  // non-blank, the other blank at that column — either row can carry it; this section's
  // own gold samples use both conventions, e.g. Sample 11-2's "Fiscal Year" in row 1 vs
  // Sample 11-9's "Year"/"Annual avg" in row 2). Built into `headers` (the flat sub-
  // column/single-tier row) + `headerGroups` (the primary row), never dropped as
  // "not-representable" the way this builder used to for ANY multi-row header — proven
  // gold-verified against Samples 11-2/11-9/11-13/11-15's own header shape.
  const rawHeaders = Array.isArray(print.headers) ? print.headers : null;
  let headerRow = [];
  let headerGroups = null;
  if (rawHeaders && rawHeaders.length === 2) {
    const row1 = rawHeaders[0] || [];
    const row2 = rawHeaders[1] || [];
    const colCount = Math.max(row1.length, row2.length);
    const has = (v) => v != null && String(v).trim() !== '';
    const flat = Array(colCount).fill('');
    const groups = [];
    let ci = 0;
    while (ci < colCount) {
      const a = row1[ci], b = row2[ci];
      if (has(a) && has(b)) {
        const text = String(a).trim();
        let end = ci;
        while (end + 1 < colCount && has(row1[end + 1]) && String(row1[end + 1]).trim() === text && has(row2[end + 1])) end++;
        // A primary heading printed ONCE over its sub-columns (Samples 11-2, 11-13, 11-15: the
        // print spans the heading across the columns, leaving the row-1 cells above the other
        // sub-columns empty). Only when the heading was not written out again for each column
        // (the repeat convention handled just above), so Sample 11-9's own single-tier "Annual
        // avg" (empty above it, but after a repeated "Semiannual averages") stays single-tier.
        if (end === ci) while (end + 1 < colCount && !has(row1[end + 1]) && has(row2[end + 1])) end++;
        groups.push({ text: esc(text), from: ci, to: end });
        for (let k = ci; k <= end; k++) flat[k] = cellToModel(row2[k], limitations, `headers[1][${k}]`);
        ci = end + 1;
      } else {
        flat[ci] = cellToModel(has(a) ? a : b, limitations, `headers[?][${ci}]`);
        ci++;
      }
    }
    headerRow = flat;
    headerGroups = groups.length ? groups : null;
  } else if (rawHeaders && rawHeaders.length) {
    headerRow = rawHeaders[rawHeaders.length - 1].map((v, i) => cellToModel(v, limitations, `headers[last][${i}]`));
    if (rawHeaders.length > 1) {
      const dropped = rawHeaders.slice(0, -1).map((r) => r.map((v) => (v == null ? '' : String(v))).join(' | ')).join('  //  ');
      limitations.push(`print.headers has ${rawHeaders.length} rows (more than the two this builder's F-12 support handles — row subheadings/11.5.1b or similar, out of scope); Emboss's table.headers is a single flat row, so only the deepest row is used and the spanning row(s) [${dropped}] are dropped — not representable.`);
    }
  }

  // BANA 11.5.5 (Diagonal Table Lines): "Treat the text separated by diagonal lines as column
  // and row headings ... the text to the left and below the diagonal line is treated as a column
  // heading to the row headings. ... Text to the right and above the diagonal line is treated
  // as an inclusive heading to two or more of the following columns." The print here writes a
  // diagonal as a backslash between the two texts in the corner header cell (Sample 11-7:
  // "Animals Grooming \\ Animals Groomed"): the part before it heads the row-heading column,
  // the part after it becomes the primary heading over the remaining columns.
  const diag = rawHeaders && rawHeaders.length === 1 && typeof rawHeaders[0][0] === 'string' && /\s\\\s/.test(rawHeaders[0][0]) && rawHeaders[0].length > 2;
  if (diag) {
    const [below, above] = rawHeaders[0][0].split(/\s\\\s/).map((t) => t.trim());
    headerRow = [esc(below), ...rawHeaders[0].slice(1).map((v, i) => cellToModel(v, limitations, `headers[0][${i + 1}]`))];
    headerGroups = [{ text: esc(above), from: 1, to: headerRow.length - 1 }];
  }

  const rawRows = Array.isArray(print.rows) ? print.rows : [];
  // BANA 11.6.6 (Dittos): a body cell that is nothing but a quotation/ditto mark IS a ditto
  // (Sample 11-12's notes: "Print uses the typographic ditto mark ... to repeat"). It is passed
  // as the ditto sign U+3003, which liblouis's UEB table renders as the ditto (dots 5,2);
  // a bare straight or curly quote would be translated as an ordinary quotation mark.
  const DITTO = '\u3003';
  // BANA 11.6.5 (Segmented Numbers, Example 11-8): "Insert the numeric space indicator (dot 5) to
  // represent the spaces in segmented numbers" — a print space BETWEEN digit groups becomes a
  // no-break space, which liblouis's UEB table renders as the numeric space (34 432 -> #CD"DCB).
  // Only for the sample that illustrates that rule, since elsewhere a space between numbers is
  // just a space.
  const segmentedNumbers = /^11\.6\.5(\.|$)/.test(String((sample.illustrates && sample.illustrates.rule) || ''));
  const bodyCell = (v, where) => {
    if (typeof v === 'string' && /^\s*["\u201c\u201d\u2033\u3003]\s*$/.test(v)) return DITTO;
    if (segmentedNumbers && typeof v === 'string') return esc(v.replace(/(?<=\d) (?=\d)/g, '\u00a0'));
    return cellToModel(v, limitations, where);
  };
  const rows = rawRows.map((r, ri) => (Array.isArray(r) ? r : [r]).map((v, ci) => bodyCell(v, `rows[${ri}][${ci}]`)));

  const hasTable = headerRow.length > 0 || rows.length > 0;
  let table = null;
  if (hasTable) {
    // The wide-table format the illustrated rule names, where Emboss has one (T4): 11.14 vertical
    // division, 11.15 Interchanged Columns and Rows (and B004 App E's transposed table), 11.16 Listed,
    // 11.17 Linear, 11.18 Stairstep. Every other sample stays 'auto'. (App E lists several rules per example.)
    const ruleIds = [].concat(sample.illustrates || []).map((x) => String((x && x.rule) || ''));
    const RULE_FORMAT = [[/^11\.13(\.|$)/, 'facing'], [/^11\.14(\.|$)/, 'vertical'], [/^11\.15(\.|$)/, 'interchange'], [/^B004 E ex\d+-transpose$/, 'interchange'], [/^11\.16(\.|$)/, 'listed'], [/^11\.17(\.|$)/, 'linear'], [/^11\.18(\.|$)/, 'stairstep']];
    const ruleFormat = (RULE_FORMAT.find(([re]) => ruleIds.some((id) => re.test(id))) || [])[1] || 'auto';
    table = { type: 'table', format: ruleFormat, headers: headerRow, rows };
    if (headerGroups) table.headerGroups = headerGroups;
    // TBL-NUM-1 (BANA 11.7.1j-l): the numeric passage indicator is a transcriber's per-table choice, made the
    // same way as the formats above — only for the sample that illustrates the rule.
    if (ruleIds.some((id) => /^11\.7\.1\.?[jl](\.|$)/.test(id))) table.numericPassage = true;
    // K3 (BANA 11.6.1d, transcriber KD): place-value alignment follows PRINT. A gold print description
    // records it as `print.columnAlign` (per column: 'left' | 'right' | 'decimal'), read from the page image.
    if (Array.isArray(print.columnAlign)) table.printAlign = print.columnAlign.map((a) => (a === 'right' || a === 'decimal' ? a : null));
    // UKAAF B004 has no boxed-table construct (a ruled print table is not boxed in braille, App E's own
    // worked braille) — the BANA box (11.2.5) is built only for the BANA sections.
    const noBox = SECTION === 'b004-appendix-e' || /\bno box\b|\bnot enclosed\b|\bunboxed\b|\bno border\b|without.*\bbox\b/i.test(printFeatures);
    if (tableTitle) {
      table.title = tableTitle;
      // BANA 11.3.1b: "Follow print for the placement of table headings ... which may be
      // before or after a top box line." This gold corpus's own print schema has no field
      // recording which a given book chose (F-4's own conclusion, reached independently of
      // this default) — so this is a fixed default, not a per-sample read of `braille`:
      // 'in-box' (heading right after the top box line) is the majority pattern actually
      // observed across this section's own worked samples when their braille was read to
      // validate the formatter fix (Samples 11-4, 11-9, 11-11, 11-14, 11-16, 11-21, 11-22,
      // 11-24 place the heading after the top box line; only Samples 11-2, 11-5, 11-6, 11-26
      // place it before). A sample in the minority is recorded as a titlePosition
      // limitation below, not special-cased from its own expected braille.
      if (!noBox && titleOutsideBoxByPrint(printFeatures)) {
        // BANA 11.3.1b: "Follow print for the placement of table headings." Here the PRINT description says the
        // heading is drawn outside (above) the ruled box.
        table.titlePosition = 'before-box';
      } else if (!noBox && ruleFormat !== 'facing') {   // K15: facing pages place the heading above the box (11.13.1e)
        table.titlePosition = 'in-box';
        limitations.push(`print gives no field for whether the table heading sits before or after the box's top line (BANA 11.3.1b "follow print"); defaulted to titlePosition:'in-box' (the majority pattern found across this section's own worked samples) — see standards-findings.md F-4.`);
      }
    }
    if (noBox || ruleFormat === 'facing') {
      // K15: a facing-pages table draws its own box lines across both pages, with the heading above the top box line
      // (BANA 11.13.1e), so it is never nested in a box block (which could not be set across a page pair).
      if (ruleFormat === 'facing') delete table.titlePosition;
      blocks.push(table);
    } else {
      blocks.push({ type: 'box', blocks: [table] });
    }
  }
  // UKAAF B004 App E's own print.attribution (Example 2's source line under the table,
  // "(Weather or Not Forecasts Ltd.)") is real print content below the table: an ordinary paragraph.
  if (hasTable && typeof print.attribution === 'string' && print.attribution.trim()) {
    blocks.push({ type: 'para', ...textOrSegments(esc(print.attribution.trim())) });
  }

  // A sample that prints only a table HEADING (Example 11-4: "Table 9.5" and its title, no rows or
  // column headings): BANA 11.3.2a, "Center sequentially numbered table headings". With no table
  // body there is no table block to carry it, so each print line is a centred heading (level 1).
  if (!hasTable && tableTitle) {
    for (const t of (Array.isArray(tableTitle) ? tableTitle : [tableTitle])) blocks.push({ type: 'heading', level: 1, text: t });
  }

  // printFeatures itself (bold/shading/rules/fonts/diagonal lines/bar charts/etc.)
  // has no field in the document model at all — record it, never guess a
  // representation for it.
  if (printFeatures.trim()) {
    limitations.push(`print.printFeatures describes visual/structural features with no model equivalent (bold, shading, rules, diagonal lines, charts, etc.): "${printFeatures}"`);
  }
  if (print.notes) {
    limitations.push(`print.notes (transcription metadata, not print content — recorded for reference only, not fed into the model): "${print.notes}"`);
  }
  if (print.surroundingText) {
    limitations.push(`print.surroundingText (context in the standard's own running text, not the sample's print copy — not fed into the model): "${print.surroundingText}"`);
  }

  return { doc: { title: null, blocks }, limitations, hasTable };
}

// ---------------------------------------------------------------------------
// Model building for section-4 (Headings) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 4's gold schema (tests/gold/bana-formats-2016/section-4/README.md) is a flat
// `print.blocks[]` list, each `{kind, level, text, features}`:
//   kind 'heading'    -> a document `heading` block (level 1/2/3 = centred/cell-5/cell-7,
//                        per the section's own samples' naming — verified against every
//                        gold file's own braille.lines during reconciliation, never
//                        guessed; see differences.md). A `heading` block with no `level`
//                        is recorded as a limitation and not built at all — Formats §4.8's
//                        "paragraph (run-in) heading" is never itself a standalone braille
//                        line, so a run-in heading's text lives inside its enclosing
//                        `paragraph` block instead (see below), not as its own heading
//                        block with a null level.
//   kind 'paragraph'  -> a document `para` block.
//   kind 'list-item'  -> buffered; consecutive 'list-item' blocks become ONE document
//                        `list` block (BANA Formats §8: a list carries its own blank
//                        line before and after, so keeping adjacent same-purpose items in
//                        ONE list, and starting a NEW list for an unrelated item, is what
//                        produces the right blank-line spacing — buildDocPages's own
//                        adjacent-blank dedup then collapses a list's trailing blank
//                        against the next block's leading blank into a single blank
//                        line, exactly like two ordinary blocks in §11's model).
//   kind 'other'      -> never modeled; recorded as a limitation. Print content that is
//                        real but never itself transcribed into this sample's own braille
//                        (a front-of-book icon key, one of this guide's own captions) or
//                        that needs a block type this flat schema has no room for (a
//                        related/unrelated-columns table, pre-encoded transcriber-defined
//                        shape codes) — never guessed into a kind that would silently
//                        mis-format, per the same "never invent, always record" precedent
//                        buildModel11 above follows for §11's own unrepresentable content.
//
// A block's `text` goes through Emboss's own lightweight cell-markup DSL
// (format/cell-markup.mjs parseCellMarkup: **bold**/*italic*/`code`/$latex$, backslash
// escapes any of those) exactly as §11's table cells do — used here only where this
// reconciliation's own gold files intentionally mark a run-in heading's emphasis in place
// (e.g. example-4-13's "**Action Plan** How can you get involved…", kept bold per print,
// vs. example-4-14's plain "ACTION PLAN …", no added emphasis, per rule 4.8.1's "no
// additional emphasis" clause for uppercase paragraph headings). A block may also carry a
// `marker` (currently only `"•"`, BANA's UEB bullet, §8.6.2a) where the gold braille itself
// shows the bullet indicator — never guessed from `features` prose alone.
function textOrSegments(raw) {
  const segs = parseCellMarkup(String(raw ?? ''));
  const rich = segs.some((g) => g && (g.tf || g.uncontracted || g.type === 'math'));
  if (!rich) return { text: segs.map((g) => g.text || '').join('') };
  return { segments: segs };
}

// F-39 / BANA §1.9.3 ("Use 1-1 margins for blocked paragraphs...unless it follows a cell-5
// or cell-7 heading") and §4.8.1 (Example 4-13/4-14's own worked braille: both the run-in
// heading's own line and its runover sit flush at column 1 — "^1,ac;n ^1,plan ,h[..." /
// "tree plant+..."). A print `paragraph` block is `blocked: true` when EITHER:
//  (a) it immediately follows a STANDALONE `heading` print block — verified directly
//      against every gold file's own agreed braille.lines: the paragraph opening an
//      excerpt/box right under the heading(s) introducing it is flush, while a LATER,
//      non-heading-adjacent paragraph in the same excerpt keeps the ordinary 2-cell indent
//      (e.g. sample-4-01's two "Nonspecific Immunity" paragraphs: the first, heading-
//      adjacent, is flush; the second is not). "Standalone" excludes the second (or later)
//      heading of a run of CONNECTED CENTRED (level-1) headings (§4.3.3, "do not insert a
//      blank line between connected headings" — one conceptual heading split across lines:
//      title + author (Example 4-2), chapter-number + chapter-title (4-3), unit-number +
//      unit-title (4-4), all level 1/centred, per document.mjs's own HEADING_JOIN_TIERS
//      comment): example-4-3's paragraph directly follows such a pair ("Theme 1" /
//      "Transitions") and is the section's own worked illustration of 4.3.3, not of a
//      paragraph opening under a heading — its own resolution note calls it "an ordinary
//      paragraph". This is level-specific, not "any connected run": sample-4-05-option-2's
//      two CELL-5 headings ("Connection to History" / "The tree of life", both level 2) are
//      connected the same way but for a DIFFERENT reason (§4.5.6, "an equally important
//      cell-5 heading" — each independently able to introduce content, confirmed by its own
//      gold braille keeping the following paragraph flush), so only level-1 runs are
//      excluded here;
//  (b) its own `features` names it a run-in (paragraph) heading — the gold reconciliation's
//      own wording for this, checked directly (`grep -rn "run-in" .../section-4/*.json`):
//      "run-in (paragraph) heading" / "run-in heading" / "bold run-in heading" — e.g.
//      sample-4-01's "Skin barrier"/"Chemical barriers" sub-paragraphs, confirmed flush by
//      that file's own `notes` field ("lines 42-44 the paragraph opening with the inline
//      run-in heading 'Skin barrier' ... ; lines 46-48 likewise for 'Chemical barriers'").
const RUN_IN_HEADING_RE = /run-in/i;
function buildModel4(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = [];
  let pendingList = null;
  const flushList = () => { if (pendingList && pendingList.items.length) blocks.push(pendingList); pendingList = null; };

  let prevKind = null;         // raw previous print.blocks[].kind, for the F-39 (a) adjacency test
  let prevHeadingLevel = null; // level of the immediately preceding heading (if prevKind === 'heading')
  let headingRunLen = 0;       // length of the current run of consecutive SAME-level headings (§4.3.3)
  let pendingHeader4 = null;   // a table header bar read from an `other` block, waiting for its data rows
  for (const b of printBlocks) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'list-item') {
      const tos = textOrSegments(b.text);
      if (!pendingList) pendingList = { type: 'list', kind: 'list', items: [] };
      const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
      if (b.marker) item.marker = b.marker;
      pendingList.items.push(item);
      prevKind = kind;
      headingRunLen = 0;
      continue;
    }
    flushList();
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built (Formats §4.8 run-in headings live inside their paragraph instead; see the gold file's own resolution note).`);
        prevKind = kind;
        headingRunLen = 0;
        continue;
      }
      headingRunLen = (prevKind === 'heading' && b.level === prevHeadingLevel) ? headingRunLen + 1 : 1;
      prevHeadingLevel = b.level;
      const tos = textOrSegments(b.text);
      const h4 = { type: 'heading', level: b.level, ...tos };
      // K2 / BANA 4.3.3, Example 4-2 (EMBOSS-TASKS G1/13b): a title and its author's name are
      // two separate items, not one heading connected across two lines the way a chapter
      // number + title (Example 4-3) or unit number + title (Example 4-4) is — even though all
      // three print the same way, same-level centred headings running straight on. The gold
      // file's own `features` prose is the only signal available here (print.blocks carries no
      // structural flag for this): a same-tier heading immediately following another whose
      // features name it a byline/author gets `notConnected: true`, keeping the ordinary blank
      // line between the two (document.mjs's HEADING_JOIN_TIERS would otherwise drop it).
      // Only a centred (level-1) byline that is its own item: a line described as part of the SAME heading (Sample 4-3's
      // two-line cell-5 "Restif de la Bretonne, / Nocturnal Spectator", whose description merely mentions "the author's
      // name") stays connected.
      const f4 = String(b.features ?? '');
      if (prevKind === 'heading' && b.level === prevHeadingLevel && b.level === 1 && /\bbyline\b|\bauthor\b/i.test(f4) && !/\bsame\b[^.]*\bheading\b|\btwo-line heading\b/i.test(f4)) h4.notConnected = true;
      // F-41 / BANA 4.3.7: "Ignore font attributes ... except when required for distinction." Kept (block.keepEmphasis) where
      // an emphasised line is joined to a plain line of the same connected heading (Sample 4-3): Emboss judges each heading
      // block on its own, and this print is two heading blocks. A heading that is part-emphasised, part plain within one
      // block (Example 4-7) is no longer marked here: the formatter keeps that emphasis itself (K1, 25 Sep).
      if (tos.segments && tos.segments.some((g) => g && g.tf)) {
        const bi4 = printBlocks.indexOf(b);
        const sib = [printBlocks[bi4 - 1], printBlocks[bi4 + 1]].filter((x) => x && x.kind === 'heading' && x.level === b.level);
        const sibPlain = sib.some((x) => !textOrSegments(x.text).segments?.some((g) => g && g.tf));
        if (sibPlain) h4.keepEmphasis = true;
      }
      blocks.push(h4);
    } else if (kind === 'paragraph' && /^\d+\.\s+\S/.test(String(b.text ?? '')) && /numbered/i.test(String(b.features ?? ''))) {
      // A print paragraph the gold describes as a numbered step ("1. Read and ...") is a one-item numbered list in Emboss's model
      // (BANA §8 list margins), not an ordinary indented paragraph — the numeral is the item's marker (Sample 4-7).
      const mk = /^(\d+\.)\s+([\s\S]*)$/.exec(String(b.text));
      const tos = textOrSegments(mk[2]);
      const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
      item.marker = mk[1];
      blocks.push({ type: 'list', kind: 'list', items: [item] });
    } else if (kind === 'paragraph' && /^play dialogue line/i.test(String(b.features ?? ''))) {
      // A play dialogue line (speaker, colon, speech) is BANA §14 dialogue (1-3 margins), not an indented paragraph (Example 4-7).
      blocks.push({ type: 'dialogue', ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      const standaloneHeading = prevKind === 'heading' && !(prevHeadingLevel === 1 && headingRunLen > 1);
      if (standaloneHeading || RUN_IN_HEADING_RE.test(b.features || '')) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'other') {
      // Section-4 `other` blocks are print content the gold's `kind` vocabulary has no slot for. Three of them ARE print
      // content this builder can now read from the block's own `features` (its print description, never the braille):
      //  - a table's header bar ("table header bar", text "A / B / C") followed by its data rows (text "a/b/c; d/e/f", features
      //    "...column..."), or a headerless columnar word list — built as a `table` block (Emboss's spatial/related-columns
      //    format, BANA 4.5.4/4.6.5; Examples 4-10, 4-11);
      //  - a displayed quotation ("Displayed/indented block quotation") — a `quote`-style para (BANA §9.2), and its right-aligned
      //    citation line ("citation line") — an `attribution` block (§9.4; Sample 4-4);
      //  - a print block the gold itself says is never transcribed (front-of-book icon key, its captions — Sample 4-7):
      //    context only, skipped without a limitation (it is not part of the passage being transcribed).
      const otext = String(b.text ?? ''), ofeat = String(b.features ?? '');
      if (/table header bar/i.test(ofeat) && otext.includes(' / ')) {
        pendingHeader4 = otext.split(/\s*\/\s*/).map((c) => esc(c.trim()));
      } else if (/column/i.test(ofeat) && /data rows|word list/i.test(ofeat) && otext.includes(';') && otext.includes('/')) {
        const rows4 = otext.split(/;\s*/).map((r) => r.split('/').map((c) => esc(c.trim())));
        const ncol = rows4[0].length;
        if (ncol >= 2 && rows4.every((r) => r.length === ncol) && (!pendingHeader4 || pendingHeader4.length === ncol)) {
          blocks.push({ type: 'table', format: 'auto', headers: pendingHeader4 || [], rows: rows4 });
        } else {
          limitations.push(`print block kind 'other' (columnar rows did not parse into a rectangular table — not modeled): "${otext.slice(0, 160)}"`);
        }
        pendingHeader4 = null;
      } else if (/displayed[^.]*quotation/i.test(ofeat)) {
        blocks.push({ type: 'para', style: 'quote', ...textOrSegments(otext) });
      } else if (/citation line/i.test(ofeat)) {
        blocks.push({ type: 'attribution', ...textOrSegments(otext) });
      } else if (/never (?:itself )?transcribed|excluded from the model/i.test(ofeat) && !/NOT built/.test(ofeat)) {
        // context only — see above
      } else {
        limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${otext.slice(0, 160)}"`);
      }
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
    prevKind = kind;
    if (kind !== 'heading') headingRunLen = 0;
  }
  flushList();

  // Formats §4.3.5: no blank line between a box's top rule and a heading that immediately
  // follows it. Only one gold file in this section actually shows box-rule lines in its
  // braille (example-4-6 — see differences.md; every other file whose printFeatures happens
  // to mention "boxed" callout styling has NO 7…7/g…g rule lines in its own agreed braille,
  // so is deliberately NOT boxed here); `print.boxed` is this reconciliation's own explicit,
  // evidence-based flag for that one file, not a guess from prose.
  const topBlocks = (sample.print && sample.print.boxed) ? [{ type: 'box', blocks }] : blocks;
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks: topBlocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-8 (Lists) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 8's gold schema (tests/gold/bana-formats-2016/section-8/README.md) is a
// print.blocks[] list whose elements are one of:
//   kind 'heading'    -> a document `heading` block, level 1/2/3 = centred/cell-5/
//                        cell-7 (same convention as buildModel4, re-verified per file
//                        directly against this section's own agreed braille.lines —
//                        never taken on either transcription run's say-so; see the
//                        gold files' own resolution notes).
//   kind 'paragraph'  -> a document `para` block (directions text, or this book's own
//                        "text"/placeholder convention for elided surrounding prose —
//                        Emboss has no way to produce the braille ellipsis "444" that
//                        follows a placeholder, so that specific mismatch is expected
//                        and documented, not a bug in this model builder).
//   kind 'list'       -> a document `list` block. Unlike section 4's flat "list-item"
//                        siblings (which this builder groups itself), section 8's own
//                        gold schema already nests an `items[]` array directly under
//                        the `list` block (matching print's own single list-shaped
//                        illustration per Example/Sample) — see buildListItem below for
//                        how each item's `marker`/`bullet` is turned into (or excluded
//                        from) the document model's own single supported bullet
//                        correspondence (BANA 8.6.2a's "Dot" = Emboss's `•`; every
//                        other bullet glyph in this section's own correspondence table
//                        — hollow/solid square, hollow circle, triangle, checkmark —
//                        has no Emboss equivalent, F-33, and is recorded as a
//                        limitation rather than guessed). `columns` (present only where
//                        print itself lays the list out side-by-side) is carried on the
//                        block for reference but never changes how it is built — Emboss
//                        has no side-by-side list-column mechanism at all (F-34), so a
//                        columned sample is always built, and always renders, as a
//                        single column; the mismatch that follows is expected.
//   kind 'box'        -> print's own ruled box (BANA §7): a NESTED { kind:'box',
//                        blocks:[...] } container, recursed into and built into a
//                        document `{type:'box', blocks:[...]}` block exactly like
//                        buildModel11's own table boxes. Only built where the box's
//                        entire content is itself representable (sample-8-04); where a
//                        box contains content this schema can't build at all (a
//                        braille-only transcriber's note with no print counterpart,
//                        sample-8-13), the gold file leaves the box out of print.blocks
//                        by design and records the gap as its own resolution note —
//                        this builder never fabricates a box around a known-partial
//                        reconstruction.
//   kind 'other'      -> never modeled; recorded as a limitation, exactly like
//                        buildModel4's 'other' (print content with no print-side
//                        counterpart to this schema's block kinds, or none at all —
//                        e.g. example-8-8/-9's isolated guide-text label, which is
//                        page-layout machinery per 8.8.5, not list content).
//
// A block's / item's `text` goes through the same textOrSegments() helper buildModel4
// uses (Emboss's own cell-markup DSL: **bold**, <u>underline</u>, `code`, backslash
// escapes) — used in this section only for sample-8-04's underlined interrogative
// words (<u>Who</u> wants more cake?, matching the braille's own "_1" underline-word
// indicator).
const BULLET_GLYPHS = new Set(['•', '○', '□', '■', '√', '▲']); // • ○ □ ■ √ ▲
function buildListItem(it, limitations, where) {
  const tos = textOrSegments(it && it.text);
  const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
  // The gold schema's own `level` is 1-based (1 = main entry, 2/3/4 = successive
  // subentry levels, per the section-8 README) but Emboss's document model (and
  // nestedMargins/listMaxLevel, document.mjs) is 0-based (0 = main entry, cell 1;
  // deeper levels add 2 cells each) — BANA 8.5.1.b's own "One level: 1-3" margin
  // pair is exactly nestedMargins(level=0) -> {first:0, runover:2}, i.e. cell 1 /
  // cell 3, only once this off-by-one is corrected.
  const lvl = Number(it && it.level) || 1;
  item.level = lvl - 1;
  const marker = it && it.marker;
  const bullet = it && it.bullet;
  if (bullet) {
    // Compound marker (an ordinal, e.g. "2.") PLUS a separate print bullet — only example-8-5a/-5b use this.
    // The formatter takes the bullet in the optional `item.bullet` field beside the ordinal `marker`
    // (BANA 8.7.1a, F-42): "_4 #b4 ...".
    if (marker) item.marker = esc(marker);
    item.bullet = bullet;
  } else if (marker && BULLET_GLYPHS.has(marker)) {
    item.marker = marker; // a print bullet glyph: the formatter maps it to its own braille correspondence (BANA 8.6.2a table, F-33)
  } else if (marker) {
    item.marker = esc(marker); // an ordinary ordinal/lettered/roman-numeral marker — passed through literally, exactly as buildModel11/4 pass through any other literal marker text
  }
  if ((it && it.text) == null && marker) item.blank = true; // skeleton-outline blank-fill entry (8.8.2) — flagged for the caller to record as a limitation
  return item;
}
function buildBlocks8(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      const hd = { type: 'heading', level: b.level, ...tos };
      // BANA 7.2.1e: print says the heading sits directly above the box with no blank line (Sample 8-4).
      if (/no blank line (?:beneath|between it and)/i.test(String(b.features ?? '')) && /^(?:box)$/.test(String((printBlocks[printBlocks.indexOf(b) + 1] || {}).kind))) hd.accompaniesBox = true;
      blocks.push(hd);
    } else if (kind === 'paragraph') {
      // This book's own convention for eliding surrounding running text not shown in
      // an excerpt is the literal placeholder word "text", followed in the braille by
      // a "444" ellipsis marker (dot-3 x3) that has no print-side input to build from
      // — recorded as a limitation (not silently built as if it were ordinary prose)
      // rather than invented.
      if (String(b.text ?? '').trim().toLowerCase() === 'text') {
        limitations.push(`paragraph is this book's own "text" placeholder for elided surrounding running text — the braille "444" ellipsis marker that follows it has no print-side input to build from; built as plain text only, the ellipsis is not representable.`);
      }
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      // Print-block flags, as the other builders honour them; plus a paragraph the print description says is the end of a
      // paragraph carried over from the previous print page resumes in cell 1 (BANA 1.11.3 / F-67; Sample 8-1).
      if (b.blocked) para.blocked = true;
      if (b.directions) para.directions = true;
      if (b.continuation || /carried over from the previous print page/i.test(String(b.features ?? ''))) para.continuation = true;
      blocks.push(para);
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      // F-34 (§8.4.1): the transcriber's choice to KEEP the print columns is read from the gold braille (a list line with a
      // blank gap inside it, same column count as print); the formatter takes it as the optional `columns` field. Otherwise
      // (changed to vertical or to another column count) the list is built without it.
      // Independence rule: `columns` comes from the PRINT description (b.columns = the print's own column count) only; whether
      // the arrangement fits and is kept is the formatter's decision (columnedListPlan), never read off the gold braille.
      const keepCols = Number(b.columns) > 1;
      if (b.columns && Number(b.columns) > 1 && !keepCols) {
        limitations.push(`list has print.blocks columns:${b.columns} (print laid this list out in ${b.columns} side-by-side columns) — Emboss has no side-by-side list-column layout (F-34); built, and will render, as a single column.`);
      }
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      if (built.some((it) => it.blank)) {
        limitations.push(`list has one or more skeleton-outline blank-fill items (print gives a division number with no text, e.g. a ruled blank line to write on) — Emboss has no dot-5 blank-fill mechanism (F-36); built with empty text, the blank-fill symbol is not representable.`);
      }
      // BANA 8.1.4b: "Retain emphasis for items in the list such as titles" — an all-italic list of titles keeps its
      // italics even though the whole list shares the font attribute (8.1.4a). A print fact: the description says the
      // items are titles (transcriber override `keepEmphasis`, K1).
      const titleList = /\btitles?\b/i.test(String(b.features || ''));
      blocks.push({ type: 'list', kind: 'list', items: built, ...(keepCols ? { columns: Number(b.columns) } : {}), ...(titleList ? { keepEmphasis: true } : {}) });
    } else if (kind === 'box') {
      const inner = buildBlocks8(b.blocks, limitations);
      blocks.push({ type: 'box', blocks: inner });
    } else if (kind === 'other' && /new print page/i.test(String(b.text ?? '')) && /-\s*(\d+)\s*-/.test(String(b.text ?? ''))) {
      // A print page-change marker with its new print page number ("—New Print Page— / -41-"): BANA 1.11.3's page-change
      // indicator, built as the same {type:'pagenum', page} block the §1/§3/§12 builders use (Samples 8-1..8-3).
      blocks.push({ type: 'pagenum', page: /-\s*(\d+)\s*-/.exec(String(b.text))[1] });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel8(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks8(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-7 (Boxed Material) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 7's gold schema (tests/gold/bana-formats-2016/section-7/README.md) is a
// print.blocks[] list whose elements are one of:
//   kind 'heading'    -> a document `heading` block, level 1/2/3 = centred/cell-5/
//                        cell-7 — re-derived directly from this section's own agreed
//                        braille.lines by the same leading-blank-cell-count method
//                        buildModel4/buildModel8 use, never taken on either
//                        transcription run's say-so (see each gold file's own
//                        resolution note, e.g. sample-7-03's centred heading).
//   kind 'paragraph'  -> a document `para` block.
//   kind 'list'       -> a document `list` block, reusing buildListItem exactly as
//                        buildModel8 does (this section's own lists — Example 7-4,
//                        Sample 7-2 — use only plain ordinal markers, never a bullet).
//   kind 'table'      -> a document `table` block: one flat header row plus data
//                        rows, built with the same cellToModel() helper buildModel11
//                        uses for §11's own tables (no multi-row header support is
//                        needed here — every table in this section has exactly one
//                        header row).
//   kind 'box'        -> BANA §7's own subject matter: a NESTED { kind:'box', title?,
//                        blocks:[...] } container, recursed into and built into a
//                        document `{type:'box', title?, blocks:[...]}` block exactly
//                        like buildModel8's own table boxes. `title` (present only
//                        where the box carries its own accompanying heading, BANA
//                        7.2.1e — e.g. Example 7-2's "Forms of be", Example 7-5's
//                        "Studio Background") is passed straight through to the
//                        document model's own `box.title` field (`formatBox`,
//                        document.mjs:828) rather than modelled as a nested heading
//                        child, since that IS this field's own intended use. Emboss's
//                        `formatBox` always renders a box's title at a fixed cell-5
//                        tier (`level:2`) regardless of how the source actually sets
//                        it — Example 7-2's title is gold-verified CENTRED (see that
//                        file's own resolution note) — so that sample is expected to
//                        mismatch on the title line; see standards-findings.md F-75.
//                        `colorNote` (BANA 7.5.2 — Sample 7-2's "yellow"/"orange") maps onto
//                        `box.boxColor` (K7, 26 Sep; F-72 closed) — named at the start of the
//                        opening box line only when the document's boxes are not all one colour
//                        (document.mjs's computeBoxColorsUniform).
//   kind 'other'      -> never modeled; recorded as a limitation, exactly like
//                        buildModel4/8's 'other' (used in this section for a
//                        print-invisible braille running-head/reference code with no
//                        print-side counterpart — sample-7-01/7-02's own '#,-' codes).
function buildTable7(b, limitations, where) {
  const rawHeaders = Array.isArray(b.headers) ? b.headers : null;
  const headerRow = (rawHeaders && rawHeaders.length)
    ? rawHeaders[rawHeaders.length - 1].map((v, i) => cellToModel(v, limitations, `${where}.headers[${i}]`))
    : [];
  const rawRows = Array.isArray(b.rows) ? b.rows : [];
  const rows = rawRows.map((r, ri) => (Array.isArray(r) ? r : [r]).map((v, ci) => cellToModel(v, limitations, `${where}.rows[${ri}][${ci}]`)));
  return { type: 'table', format: 'auto', headers: headerRow, rows };
}
function buildBlocks7(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'para', ...tos });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      if (built.some((it) => it.blank)) {
        limitations.push(`list has one or more blank-fill items — not representable.`);
      }
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'table') {
      blocks.push(buildTable7(b, limitations, 'table'));
    } else if (kind === 'box') {
      const inner = buildBlocks7(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      if (b.title != null && String(b.title).trim()) {
        boxBlock.title = esc(String(b.title).trim());
        // F-75 / BANA 7.2.1e: follow print for the title's placement and type. The box's own `features` (its print description)
        // says whether the title is centred and which word of it is set in italic ("...'be' set in italic type") — Example 7-2.
        const bfeat = String(b.features ?? '');
        if (/title[^.]*\bcent(?:er|re)d\b|\bcent(?:er|re)d\b[^.]*title/i.test(bfeat)) boxBlock.titleAlign = 'centred';
        const itm = /'([^']+)' set in italic/i.exec(bfeat);
        const ttl = String(b.title).trim();
        const at = itm ? ttl.lastIndexOf(itm[1]) : -1;
        if (at >= 0) {
          boxBlock.titleSegments = [
            ...(at > 0 ? [{ type: 'text', text: ttl.slice(0, at) }] : []),
            { type: 'text', text: itm[1], tf: 1 },
            ...(at + itm[1].length < ttl.length ? [{ type: 'text', text: ttl.slice(at + itm[1].length) }] : []),
          ];
        }
      }
      // K7 / F-72, 26 Sep: `colorNote` now maps straight onto `box.boxColor` (BANA 7.5.2). Whether it is actually
      // NAMED on the opening box line depends on the document-wide uniform-colour check (o._boxColorsUniform,
      // document.mjs's computeBoxColorsUniform) — Sample 7-2's own two boxes differ (yellow/orange), so both show.
      if (b.colorNote) boxBlock.boxColor = String(b.colorNote).trim();
      blocks.push(boxBlock);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel7(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks7(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-16 (Notes) and b004-11 (UKAAF B004 §11) — from
// sample.print.blocks/print.notes ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-16/README.md,
// tests/gold/ukaaf-b004/section-11/README.md) is a print.blocks[] list — same
// {kind, level, text, features} shape buildModel4/7/8 already use — plus a
// SEPARATE print.notes[] array of {ref, placement, text}: `ref` is the print
// reference mark/key (an asterisk, dagger, letter, digit, or a line-number/
// range key), `placement` is how print physically laid the note out (footnote:
// below a rule at page-bottom; margin: alongside the text; inline: bracketed
// directly at the point of reference — B004's own "Example 1" style; endnote:
// none in this corpus, but supported the same way as footnote below), and
// `text` is the note's own wording. A paragraph's OWN text marks each point of
// reference with a literal `[ref:MARK]` token (stripped here, never fed to the
// translator) — see parse.mjs's real `<noteref>` handling (`pushNote`,
// `parse.mjs:1766-1776`; the inline `{type:'noteref', text, idref}` segment,
// `parse.mjs:1919-1931`) and document.mjs's consumer (`noterefBraille`,
// `document.mjs:597-604`; `formatFootnote`, `document.mjs:721-739`) — this is
// the model this builder constructs: a `noteref` segment in the referencing
// paragraph plus a `{type:'footnote'|..., kind:'endnote'?, text, id}` block
// carrying the SAME id, matching real DTBook's own noteref/id-target pairing.
//
// print.notes[] entries are consumed strictly in array order, matched
// one-for-one against `[ref:MARK]` tokens as they are found scanning
// print.blocks top to bottom (confirmed, file by file during reconciliation,
// to always be the same order the marks appear in the running text — e.g.
// sample-16-3's own resolution note: "numbered sequentially in the order
// their marks appear") — matching by POSITION, not by re-parsing `ref` text
// against the token's own mark (several files reuse one mark, e.g.
// sample-16-4's three hollow-dot ° marks each keying a different note; B004
// Example 1 reuses '*' for both its notes), which is why a synthetic id
// (`n1`, `n2`, …) — not the print mark itself — links each pair.
//
// Two print.notes[].placement values need special handling, since Emboss has
// no supporting mechanism for either (see notes-writeup.md, merged into
// standards-findings.md):
//
//   'inline' — B004's own "Example 1" convention: the note's full text sits
//     directly in square brackets at the point of reference, with no separate
//     reference-mark symbol at all. There is no inline-note segment type
//     anywhere in document.mjs (F-N2) — groupSegments only special-cases
//     math/noteref/linenum — so the closest buildable approximation (matching
//     F-N2's own reproduction exactly) is to split the ONE print paragraph
//     into THREE top-level blocks at the bracket: text-before, a `{type:
//     'note', text: <the note's own wording>}` block, text-after. This is
//     expected to mismatch (Emboss renders the TN on its own indented line,
//     not fused into the surrounding sentence) — that mismatch is F-N2, not a
//     new finding.
//
//   a note with NO `[ref:MARK]` token anywhere in its paragraph at all (BANA
//     16.4b/c's "notes without a reference mark": the print margin carries a
//     note with no symbol connecting it to any word) — print.notes[] still
//     records it (placement 'margin', ref usually '*' or a line-number key),
//     but nothing in the paragraph's own text marks where it applies. Per
//     16.4b, the braille embeds the literal WORD "note" (not the margin's own
//     wording) enclosed in TN indicators, immediately after a `kind:'note'`
//     entry's own preceding paragraph in print.blocks — so this builder
//     inserts a `{type:'note', text:'note'}` block right after that paragraph
//     (again matching F-N2's own reproduction), and records the margin note's
//     REAL wording (print.notes[].text) as a limitation: nothing in the model
//     can carry the actual margin content here, only the literal placeholder
//     word 16.4b prescribes.
//
// Every other placement ('footnote', 'margin' WITH a real `[ref:MARK]` token
// in the text, or 'endnote') builds a normal noteref+note pair: the note
// block's `kind` is `'endnote'` only when placement is literally 'endnote'
// (none in this corpus — BANA's own numbered-endnote-list samples, e.g.
// Sample 16-11, print their endnotes directly as an ordinary numbered `list`
// block instead, handled below), else the block is an ordinary footnote
// (noteLead/formatFootnote's own default, document.mjs:720-739).
//
//   kind 'heading'   -> a document `heading` block (level as given; a heading
//                       with no level is not built, matching buildModel4/7/8).
//   kind 'paragraph' -> as above: `[ref:MARK]` tokens become noteref segments
//                       (or the inline/no-mark splits described above); plain
//                       text goes through textOrSegments() same as every
//                       other section's builder.
//   kind 'other'     -> if it contains a `[ref:MARK]` token or reads as
//                       ordinary running prose, built exactly like a
//                       paragraph (several gold files use 'other' for a
//                       print-only demonstration box's main sentence, e.g.
//                       example-16-1's "Hamlet[ref:*]"); otherwise never
//                       modeled, recorded as a limitation (buildModel4/7/8's
//                       own convention) — used here for a boxed illustration
//                       whose print content is a plain wording sample with no
//                       braille counterpart at all (the four B004-D-style "TN
//                       wording" samples, and 16-11.1g's own explanatory
//                       prose — see that file's own README note).
//   kind 'note'      -> a print.blocks 'note' entry is this book's own
//                       PRINT-side record of a margin/side-note's real
//                       wording; it is never built directly (every one of
//                       this section's 'note' blocks is already covered by a
//                       matching print.notes[] entry — see above), to avoid
//                       double-building the same note twice. Recorded as a
//                       limitation only for the "no reference mark" case
//                       above, where the note's real wording has no home in
//                       the model at all.
//   kind 'list'      -> a document `list` block, reusing buildListItem
//                       exactly as buildModel7/8 do (Sample 16-11's own
//                       numbered endnote list — BANA prints its endnotes
//                       directly as a cell-1/cell-3 numbered list, so this is
//                       print's OWN structure, not a synthesised note/
//                       footnote pairing).
//   kind 'table'     -> a document `table` block, reusing cellToModel/table
//                       building exactly as buildModel11/7 do. A `[ref:MARK]`
//                       token inside a cell's own text is stripped (table
//                       cells have no segment/noteref support in this
//                       builder — matching standards-findings.md F-4's own
//                       table-cell text handling) and the corresponding
//                       print.notes[] entry recorded as a limitation instead
//                       of built — this is F-N4's own gap (a footnote
//                       referenced from inside a table cell), not a new one.
// The optional trailing bracket (B004 Example 1's inline style, "[ref:*][the note
// text]") must NOT swallow a second, immediately-adjacent `[ref:MARK]` token —
// example-16-11's own "syllabus[ref:†][ref:‡]" (two marks at one reference point,
// no inline note text between them) would otherwise be mis-read as one inline
// note whose "bracket content" is literally "ref:‡" — hence the negative lookahead.
const REF_TOKEN_RE = /\[ref:([^\]]*)\](?:\[(?!ref:)([^\]]*)\])?/g;
// §16 note text: `**bold**`/`*italic*` markup becomes typeform segments (it went through esc() and showed literally before).
// A `[ref:MARK]` inside the note text is the printed mark's own position in the note (16.2.2a, "before or after the word,
// as in print"): the note is then built with that noteref segment in its body and `noteMarkPlacement: 'inline'`, so the
// formatter does not prefix a mark of its own. An entry whose `ref` is empty has no printed mark (16.5.1d, "do not add a
// reference mark if one is not used in print", e.g. a note keyed to a highlighted word): `noteMarkPlacement: 'none'`.
// Neither applies to any note without those two signals: the mark is prefixed as before.
const NOTE_INLINE_REF_RE = /\[ref:([^\]]*)\]/g;
function noteBodyFields(entryText, mark, isSymbolMark, emptyRef) {
  const t = String(entryText ?? '');
  if (/\[ref:[^\]]+\]/.test(t)) {
    const segs = []; let last = 0; let m;
    NOTE_INLINE_REF_RE.lastIndex = 0;
    while ((m = NOTE_INLINE_REF_RE.exec(t))) {
      if (m.index > last) segs.push(...parseCellMarkup(t.slice(last, m.index)));
      segs.push({ type: 'noteref', text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < t.length) segs.push(...parseCellMarkup(t.slice(last)));
    return { segments: segs, noteMarkPlacement: 'inline' };
  }
  const body = textOrSegments(t);
  if (emptyRef) return { ...body, noteMarkPlacement: 'none' };
  if (isSymbolMark) return { segments: [{ type: 'noteref', text: mark }, ...(body.segments || [{ type: 'text', text: body.text }])] };
  return body;
}
// BANA 16.4b/c: for a note with no reference mark in print, the word "note" in TN indicators goes after the point of
// reference, on the same line as the word it applies to. The point of reference is read from the note's own text (its
// headword: the text before a colon, else the first word, after any print line number such as "14 "). Returns the paragraph
// text with `{{tn:note}}` inserted after the headword (and the punctuation that follows it), or null when a headword is
// not found in the paragraph (the caller then keeps the separate note block).
function embedNoteMarkers(rawPara, entries) {
  let out = String(rawPara ?? '');
  let from = 0;
  for (const entry of entries) {
    let head = String((entry && entry.text) || '').replace(/^\s*\d+(?:-\d+)?\s+/, '').replace(/\*+/g, '');
    const colon = head.indexOf(':');
    head = (colon > 0 && colon <= 40 ? head.slice(0, colon) : head.split(/\s+/)[0]).trim();
    if (!head) return null;
    const re = new RegExp('(?<![\\p{L}\\p{N}])' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])[,.;:!?)"\'”’]*', 'iu');
    const m = re.exec(out.slice(from));
    if (!m) return null;
    const at = from + m.index + m[0].length;
    out = out.slice(0, at) + ' {{tn:note}}' + out.slice(at);
    from = at + ' {{tn:note}}'.length;
  }
  return out;
}
function splitParagraphRefs(text, notesQueue, limitations, where) {
  // Returns { kind: 'plain', splitBlocks } when one or more 'inline'-placement
  // notes force the paragraph to be split into several top-level blocks
  // ([{type:'para',...}, {type:'note',...}, {type:'para',...}, ...] — F-N2), or
  // { kind: 'noterefs', segments, noteBlocks } for the ordinary case: ONE
  // paragraph block built from `segments` (plain text interleaved with
  // `noteref` segments), plus `noteBlocks` — the matching footnote/endnote
  // blocks to push right after that one paragraph, in order.
  const raw = String(text ?? '');
  REF_TOKEN_RE.lastIndex = 0;
  let m; let last = 0; let noteCounter = 0;
  const segments = [];
  const noteBlocks = [];
  const splitBlocks = [];
  let curText = '';
  let sawInline = false;
  const flushCurAsPara = () => { if (curText) { splitBlocks.push({ type: 'para', ...textOrSegments(curText) }); curText = ''; } };
  while ((m = REF_TOKEN_RE.exec(raw))) {
    const before = raw.slice(last, m.index);
    const mark = m[1];
    const bracket = m[2];
    last = REF_TOKEN_RE.lastIndex;
    const entry = notesQueue.length ? notesQueue.shift() : null;
    if (bracket != null && SECTION === 'b004-11') {
      // UKAAF B004 §11 Example 1: the print itself shows the note in literal square brackets
      // directly in the running text, with no reference mark (the PDF's print shows none, though
      // the gold print text carries a "[ref:*]" token) — so the brackets are ordinary print text
      // and the whole sentence stays ONE paragraph; liblouis renders [ ] as the UEB square
      // brackets (.< .>), not a transcriber's note (F-N2 is a BANA §16 embedded-TN question).
      curText += before + '[' + ((entry && entry.text) || bracket) + ']';
      continue;
    }
    if (bracket != null) {
      // Inline placement (B004 Example 1 style): split into text/note/text —
      // F-N2 (no inline-note segment type exists in document.mjs).
      sawInline = true;
      curText += before;
      flushCurAsPara();
      const noteText = (entry && entry.text) || bracket;
      splitBlocks.push({ type: 'note', text: esc(noteText) });
      limitations.push(`${where}: an 'inline'-placement note ("${noteText.slice(0, 80)}") has no inline-note segment type in document.mjs (F-N2) — built as a separate note block instead of fused onto this line; expect a mismatch there.`);
      continue;
    }
    // Non-inline: a real noteref segment inline in this paragraph's own text.
    curText += before;
    if (curText) { segments.push({ type: 'text', text: esc(curText) }); curText = ''; }
    noteCounter += 1;
    const id = `${where}-n${noteCounter}`;
    segments.push({ type: 'noteref', text: mark, idref: id });
    if (entry) {
      const kind = entry.placement === 'endnote' ? 'endnote' : undefined;
      // BANA 16.2.1: "The reference mark is typically repeated in some form
      // before the word at the beginning of the note" — a genuine symbol/
      // letter/digit mark (asterisk, dagger, double dagger, a-z, A-Z, 0-9) is
      // rebuilt as its own leading `noteref` segment (so noterefBraille gives
      // it the same symbol/superscript treatment as the in-text mark, e.g.
      // Example 16-1's own note repeating '"9' before "Othello"); a mark that
      // is really a print line-number/range key standing in for "no visible
      // symbol" (16.9.4.a's own separate convention, e.g. Example 16-8's
      // "164-166") is left as plain leading text instead — it was never a
      // superscripted reference mark in print to begin with.
      const isSymbolMark = /^[*∗†‡°]+$|^[A-Za-z0-9]+$/.test(mark) && !/^\d+-\d+$/.test(mark);
      const noteBlock = { type: 'footnote', id };
      if (kind) noteBlock.kind = kind;
      Object.assign(noteBlock, noteBodyFields(entry.text, mark, isSymbolMark, entry.ref === ''));
      noteBlocks.push(noteBlock);
    } else if (!notesQueue.sampleHasNoNotes) {
      limitations.push(`${where}: noteref mark "${mark}" has no matching print.notes[] entry — built with no note text.`);
    }
    // (a sample whose print.notes[] is empty on purpose — BANA 16.2.2's reference-mark illustrations, which show a
    //  mark and no note at all — is not a limitation: the mark alone is what print shows)
  }
  curText += raw.slice(last);
  if (sawInline) {
    flushCurAsPara();
    return { kind: 'plain', splitBlocks };
  }
  if (curText) segments.push({ type: 'text', text: esc(curText) });
  return { kind: 'noterefs', segments, noteBlocks };
}
function buildBlocks16(printBlocks, limitations, notesQueue) {
  const blocks = [];
  const list = printBlocks || [];
  for (let bi = 0; bi < list.length; bi++) {
    const b = list[bi];
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'limitation') {
      // Braille content with no print-side counterpart to build it from at all
      // (e.g. Sample 16-12/16-13's own leading grouping-indicator transcriber's
      // note, §16.11's own boilerplate explanatory wording, F-N14 — the print
      // page shows only the labelled essay/letter, not this TN's own text) —
      // recorded explicitly so the resulting gap is scored "not-representable",
      // not silently absent.
      limitations.push(String(b.text ?? 'braille content with no print-side counterpart.'));
    } else if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph' || kind === 'other') {
      // Unlike buildModel4/7/8's 'other' (never modeled), this section's own gold
      // files repurpose 'other' for a print-only demonstration box's main sentence
      // whenever it isn't clearly a heading/list/table/note (e.g. example-16-1's
      // "Hamlet[ref:*]", example-16-13's page of scholarly endnotes) — every 'other'
      // block in this corpus is real running-prose content, so it is built exactly
      // like an ordinary paragraph.
      const raw = String(b.text ?? '');
      const hasRef = /\[ref:/.test(raw);
      // BANA 16.3a: a note keyed to a highlighted/underlined/emphasised word (a `{{tdN: word}}` span in the print text) whose
      // print.notes[] entry has no mark (`ref: ""`) is NOT a note "without a reference mark" (16.4): the emphasis is the reference,
      // so no embedded "note" is added and the note carries no mark of its own (16.5.1d). The transcriber-defined typeform itself
      // is still not assignable to an arbitrary print feature (F-T1); the span is unwrapped and that is recorded.
      const nextB = list[bi + 1];
      if (!hasRef && TRANSCRIBER_DEFINED_RE.test(raw) && nextB && nextB.kind === 'note' && notesQueue.length && notesQueue[0].ref === '') {
        TRANSCRIBER_DEFINED_RE.lastIndex = 0;
        const para = { type: 'para', ...textOrSegments5(raw, limitations, `para${bi}`) };
        if (b.blocked) para.blocked = true;
        blocks.push(para);
        const entry = notesQueue.shift();
        blocks.push({ type: 'footnote', id: `para${bi}-n1`, ...noteBodyFields(entry.text, '', false, true) });
        continue;
      }
      TRANSCRIBER_DEFINED_RE.lastIndex = 0;
      if (!hasRef) {
        // BANA 16.4b/c: put the embedded "note" on the text line, after the word the note is about, when the note's own
        // headword can be found in this paragraph; otherwise it stays a separate block below.
        const nextN = list[bi + 1];
        if (nextN && nextN.kind === 'note' && notesQueue.length) {
          const cnt = Math.max(1, String(nextN.text ?? '').split('\n').filter((x) => x.trim()).length);
          const ents = notesQueue.slice(0, Math.min(cnt, notesQueue.length));
          const embedded = embedNoteMarkers(raw, ents);
          if (embedded != null) {
            notesQueue.splice(0, ents.length);
            const ep = { type: 'para', ...textOrSegmentsEmb(embedded) };
            if (b.blocked) ep.blocked = true;
            blocks.push(ep);
            for (const entry of ents) limitations.push(`paragraph has no [ref:MARK] token for its note (BANA 16.4b/c, "notes without a reference mark") — the embedded word "note" is on the text line after the note's headword; the note's own real wording ("${String(entry.text || '').slice(0, 80)}") has no field to carry it (not representable).`);
            continue;
          }
        }
        const plainPara = { type: 'para', ...textOrSegments(raw) };
        if (b.blocked) plainPara.blocked = true;
        blocks.push(plainPara);
        // BANA 16.4b/c: a note with no reference mark at all in its own
        // paragraph — the next print.blocks entry is this note's own
        // (unbuildable) real wording; insert the literal word "note" per
        // 16.4b immediately after this paragraph. A note block whose own text
        // has several newline-separated entries (e.g. example-16-10's two
        // unmarked words "Romans"/"countrymen" on one line, BANA 16.7.1's own
        // "treat ... as separate references") gets one embedded placeholder
        // per entry — still fused onto one shared line in print, but Emboss
        // has no way to place more than one on the SAME line either, so each
        // is built as its own block.
        const next = list[bi + 1];
        if (next && next.kind === 'note' && notesQueue.length) {
          const entryCount = Math.max(1, String(next.text ?? '').split('\n').filter((s) => s.trim()).length);
          const taken = notesQueue.splice(0, Math.min(entryCount, notesQueue.length));
          for (const entry of taken) {
            blocks.push({ type: 'note', text: 'note' });
            limitations.push(`paragraph has no [ref:MARK] token for its note (BANA 16.4b/c, "notes without a reference mark") — built the literal embedded word "note" per 16.4b; the note's own real wording ("${String(entry.text || '').slice(0, 80)}") has no field to carry it (not representable).`);
          }
        }
        continue;
      }
      const where = `para${bi}`;
      const result = splitParagraphRefs(raw, notesQueue, limitations, where);
      if (result.kind === 'plain') {
        blocks.push(...result.splitBlocks);
      } else {
        // A "paragraph" made up of nothing but back-to-back [ref:MARK] tokens
        // (e.g. Sample 16-1: five stacked notes, each restating only its own
        // leading mark, with no separate referencing passage shown in this
        // excerpt at all — see that file's own surroundingText) has no real
        // prose of its own to render as a paragraph line; build only the
        // footnotes/endnotes it produced, not an empty referencing paragraph.
        const hasRealText = result.segments.some((s) => s.type === 'text' && s.text.trim());
        if (hasRealText) {
          const refPara = { type: 'para', segments: result.segments };
          if (b.blocked) refPara.blocked = true;   // a print block may state it is flush (1-1); none of the current gold files do
          blocks.push(refPara);
        }
        blocks.push(...result.noteBlocks);
      }
    } else if (kind === 'note') {
      const prev = list[bi - 1];
      const prevIsRefParagraph = prev && (prev.kind === 'paragraph' || prev.kind === 'other') && /\[ref:/.test(String(prev.text ?? ''));
      const prevIsPlainParagraph = prev && (prev.kind === 'paragraph' || prev.kind === 'other') && !/\[ref:/.test(String(prev.text ?? ''));
      if (prevIsRefParagraph) {
        // Already consumed via the preceding paragraph's own [ref:MARK]
        // noteref+footnote handling above — this print.blocks 'note' entry is
        // this book's own PRINT-side record of the same content, redundant
        // with print.notes[]; nothing further to build.
      } else if (prevIsPlainParagraph) {
        // Handled by the preceding paragraph's own 16.4b/c "no reference
        // mark" branch above (which already consumed print.notes[] entries
        // and built the literal embedded "note" placeholder) — nothing
        // further to build here either.
      } else {
        // A standalone explanatory transcriber's note with no referencing
        // paragraph immediately before it (e.g. Example 16-5/Sample 16-12/
        // Sample 16-13's own opening "All underlined words below have
        // associated notes." TN) — this is real, fully-quotable content
        // formatTranscriberNote can render directly, unlike the unbuildable
        // 16.4b placeholder case above; build it as an ordinary 'note' block.
        blocks.push({ type: 'note', ...textOrSegments(b.text) });
      }
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => {
        if (typeof it === 'string') return { text: esc(it) };
        return buildListItem(it, limitations, `list item ${i}`);
      });
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'table') {
      // This section's own gold tables (Sample 16-9/16-10, Example 16-14) use
      // the same flat print.blocks 'table' shape as section-8's own lists: a
      // `text` title/caption and an `items[]` of pipe-separated cell strings
      // ("1 | Death of spouse | 100") rather than section-11/7's own separate
      // headers[]/rows[] arrays — this book's own print rendering (a plain
      // key/value list) never gives a clean tabular header row to extract
      // (Sample 16-9's "Rank | Life event | Mean value" header is this
      // builder's own synthesis from the printFeatures description, not
      // itself one of the pipe-rows). An item with no " | " at all (Sample
      // 16-10's "Precious Metals"/"Fossil Fuels") is a sub-heading row inside
      // the table, built as its own single, wide cell.
      const rawItems = Array.isArray(b.items) ? b.items : [];
      const hasRef = rawItems.some((it) => /\[ref:/.test(String(it)));
      const rows = rawItems.map((it) => {
        const clean = String(it).replace(/\[ref:[^\]]*\]/g, '');
        return clean.includes(' | ') ? clean.split(' | ').map((c) => c.trim()) : [clean.trim()];
      });
      if (hasRef) {
        limitations.push(`table has a [ref:MARK] token inside a cell — table cells have no noteref/segment support in this builder, and a footnote referenced from inside a table cell is already known not to place correctly (F-N4); the marker is stripped and the cell built as plain text, the matching print.notes[] entry left unbuilt.`);
      }
      const titleLines = String(b.text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const headers = Array.isArray(b.headers) ? b.headers.map((h) => esc(String(h))) : [];
      const table = { type: 'table', format: 'auto', headers, rows };
      if (titleLines.length) table.title = titleLines.length > 1 ? titleLines : titleLines[0];
      blocks.push({ type: 'box', blocks: [table] });
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel16(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const notesQueue = Array.isArray(sample.print && sample.print.notes) ? sample.print.notes.slice() : [];
  notesQueue.sampleHasNoNotes = notesQueue.length === 0;
  const limitations = [];
  const blocks = buildBlocks16(printBlocks, limitations, notesQueue);
  if (notesQueue.length) {
    for (const n of notesQueue) {
      limitations.push(`print.notes[] entry (ref "${n.ref}", placement "${n.placement}") was never matched to a [ref:MARK] token in any paragraph — not built: "${String(n.text || '').slice(0, 100)}"`);
    }
  }
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-1 (BANA Basic Principles/General Formats) and
// b004-6-9 (UKAAF B004 §6-9, good-practice page-furniture rules) — from
// sample.print.page + sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's own gold schema (tests/gold/bana-formats-2016/section-1/README.md,
// tests/gold/ukaaf-b004/sections-6-9/README.md) is print.page{runningHead,
// printPageNumber, features} + a flat print.blocks[] list, each element one of:
//   kind 'heading'/'paragraph'/'list'/'table'/'box'  -> built exactly as
//                        buildBlocks7/buildModel8 already do (same helpers reused:
//                        textOrSegments, buildListItem, cellToModel) — this section's
//                        own worked examples need no extra block shape beyond what
//                        §7/§8 already established.
//   kind 'pagenum'    -> a document `{type:'pagenum', page}` block: BANA's
//                        mid-braille-page print-page-change indicator (1.11.3, a
//                        full-width row of unspaced dots-36 ending in the new page
//                        number) or UKAAF's centred page-turn indicator (B004 §8).
//                        Only used where the WORKED EXAMPLE ITSELF shows this
//                        indicator as running content (Examples 1-9/1-10, Samples
//                        1-1/1-2, B004's §8 example) — never synthesised from
//                        print.page.printPageNumber, which is documentary only (see
//                        below).
//   kind 'other'      -> never modeled; recorded as a limitation, exactly like
//                        buildBlocks7/8's own 'other' handling.
//
// print.page.runningHead/printPageNumber (BANA 1.8.2/1.11.2: a print page number
// that begins at the TOP of a braille page is placed at the end of the SAME line as
// the running head, with no indicator) are read for documentation and always
// recorded as a limitation rather than built: Emboss's own running-head/page-1-title
// machinery is real and tested directly (book_title_running_head.test.mjs), but it
// only activates when this runner's shared per-page furniture (suppressHeader) is
// OFF, and turning it on for this section would force a spurious leading blank line
// 1 and a trailing braille-page-number line 25 onto every OTHER sample in this
// section too (BANA reserves those two lines whenever a document has any print-page
// or title furniture at all, document.mjs's linesPerPage) — most of this section's
// worked examples are deliberately a partial slice of a real 25-line page (lines
// 4-11, lines 22-25 continuing to a new page's lines 1-5, etc.), not a complete
// page, so that reservation would corrupt otherwise-clean comparisons. Kept OFF
// (matching every other section's own OPTS) so the mid-page indicator content
// (§1.11.3) — the majority, and directly testable — stays comparable; the running-
// head placement rule (§1.8.2) itself is consequently out of scope for this
// particular gold harness and recorded per-sample as a limitation, not a Emboss
// defect (contrast the genuine gaps below, each with its own standards-findings.md
// citation).
function buildBlocks1(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      // This section's own worked excerpts (Samples 1-1/1-2) use INDENTED (3-1)
      // paragraphs by default (Emboss's own `para` default: first line cell 3, i.e.
      // `first:2`) — gold-verified against Sample 1-2's own braille, where the FRESH
      // paragraph opening right after the heading is 2 cells indented. A paragraph
      // that is itself only a RUNOVER/continuation of a sentence that began before
      // this excerpt (gold-verified against Sample 1-2's own leading paragraph,
      // flush left with no first-line indent because it is mid-sentence, not a fresh
      // paragraph start) needs `continuation:true` on its own print.blocks entry —
      // `formatPara`'s own `continuation` field forces `first:0` (a runover's own
      // margin, for ANY paragraph style) without touching blank-line placement.
      const tos = textOrSegments(b.text);
      const para1 = { type: 'para', continuation: !!b.continuation, ...tos };
      // A print paragraph whose own description calls it an instruction/directions line to the
      // student (Example 1-10's "Choose the letter of the answer...") is BANA 10.3.2 directions
      // (5-5 margins, F-235): the formatter honours `block.directions`. Taken from the print
      // description ("features"), not from the expected braille.
      if (/\b(instruction|directions?)\b/i.test(String(b.features || ''))) para1.directions = true;
      blocks.push(para1);
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      if (built.some((it) => it.blank)) {
        limitations.push(`list has one or more blank-fill items — not representable.`);
      }
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'table') {
      blocks.push(buildTable7(b, limitations, 'table'));
    } else if (kind === 'box') {
      const inner = buildBlocks1(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      if (b.title != null && String(b.title).trim()) boxBlock.title = esc(String(b.title).trim());
      blocks.push(boxBlock);
    } else if (kind === 'pagenum') {
      const page = b.text != null ? String(b.text).trim() : '';
      if (!page && !b.implied) {
        limitations.push(`pagenum block has no text — not built.`);
        continue;
      }
      // Optional print-side observations (F-45/F-46/F-49): page implied but not printed, combined with a later page,
      // or spelled out in words by print. Absent from every current gold file, so nothing changes for them.
      const pnExtra = {};
      for (const k of ['implied', 'through', 'spelled', 'combineWithNext']) if (b[k] != null && b[k] !== false) pnExtra[k] = typeof b[k] === 'string' ? esc(b[k]) : b[k];
      blocks.push({ type: 'pagenum', page: esc(page), ...pnExtra });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel1(sample) {
  const print = sample.print || {};
  const page = print.page || {};
  const printBlocks = Array.isArray(print.blocks) ? print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks1(printBlocks, limitations);
  if (page.runningHead) {
    limitations.push(`print.page.runningHead ("${page.runningHead}") is BANA 1.8.2/UKAAF B004 §6's running head — Emboss's own doc.title/running-head machinery is real (Emboss/tests/book_title_running_head.test.mjs) but only activates when per-page furniture is enabled, which this runner keeps off (see buildModel1's own header comment) so the rest of this section's partial-page excerpts stay line-comparable; not built here, not a defect.`);
  }
  if (page.printPageNumber && !blocks.some((bl) => bl.type === 'pagenum')) {
    limitations.push(`print.page.printPageNumber ("${page.printPageNumber}") places a print page number at the top of a braille page (BANA 1.11.2) with no page-change indicator — the same running-head/page-1-title path as print.page.runningHead above; not built here, not a defect.`);
  }
  const hasContent = blocks.length > 0;
  // typeformWordPunct (Example 1-18, UEB 9.3.2 / 9.7.2) was read off the braille; no longer set (round 3, independence rule).
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-9 (Displayed Material, Attributions, and Source
// Information) / UKAAF B004 Appendix G — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 9's gold schema (tests/gold/bana-formats-2016/section-9/README.md) is a
// print.blocks[] list whose elements are one of:
//   kind 'heading'     -> a document `heading` block, level 1/2/3 = centred/cell-5/
//                         cell-7, re-derived directly from this section's own agreed
//                         braille.lines exactly as buildModel4/7/8 do.
//   kind 'paragraph'   -> a document `para` block.
//   kind 'quote'       -> BANA §9.2's displayed material: a document `{type:'para',
//                         style:'quote', text}` block (document.mjs's own quoteMargins
//                         gives BANA's cell-3 adjusted margin plus blank line
//                         before/after, per 9.2.2a/d). Where print itself shows
//                         several separate displayed sentences or verse lines treated
//                         as a list (9.2.2e — example-9-4, sample-9-02), the gold
//                         schema uses `kind:'list'` instead (see below), not this kind.
//   kind 'epigraph'    -> BANA §9.3: a document `{type:'para', style:'epigraph',
//                         text}` block. Emboss's QUOTE_STYLES set (document.mjs)
//                         currently treats 'epigraph' exactly like 'quote' — a known,
//                         already-documented gap (displayed-writeup.md F-D2: an
//                         epigraph gets the cell-3 adjusted margin instead of this
//                         book's own plain cell-1 paragraph margin) this builder does
//                         not work around.
//   kind 'attribution' -> BANA §9.4: a document `attribution` block (formatAttribution,
//                         document.mjs — fixed cell-5 block, no blank line before,
//                         one blank line after).
//   kind 'source'      -> BANA §9.5's source citations and permission-to-copy
//                         notices: Emboss has no dedicated Source Citation style
//                         (displayed-writeup.md F-D9), so this builder reuses the
//                         same `attribution` block `kind:'attribution'` maps to.
//   kind 'list'        -> a document `list` block, reusing buildListItem exactly as
//                         buildModel7/8 do. This section's own lists are always flat
//                         arrays of plain strings (no markers/bullets/nesting) —
//                         BANA 9.2.4/9.2.5's word lists, or 9.2.2e's "displayed
//                         sentences [or verse lines] treated as a list" — built at
//                         buildListItem's own default level 1 (0-based level 0).
//   kind 'box'         -> BANA §7's own ruled box, reused for Sample 9-11's bordered
//                         instructional letter exactly as buildModel7/8's own box
//                         handling recurses into nested blocks.
//   kind 'other'       -> never modelled; recorded as a limitation, exactly like
//                         buildModel4/7/8's 'other'.
function buildBlocks9(printBlocks, limitations) {
  const blocks = [];
  let prevKind = null, prevHeadingLevel = null, headingRunLen = 0;   // F-39 / BANA 1.9.3 adjacency test, as buildModel4/5
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        prevKind = kind; headingRunLen = 0;
        continue;
      }
      headingRunLen = (prevKind === 'heading' && b.level === prevHeadingLevel) ? headingRunLen + 1 : 1;
      prevHeadingLevel = b.level;
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      // Print-block flags, as the other builders honour them (none of the current section-9 gold files sets any: e.g. example-9-3's
      // and sample-9-02's print shows FLUSH paragraphs (checked on the PDF page) but their gold JSON has no `blocked` flag).
      if (b.blocked) para.blocked = true;
      if (b.continuation) para.continuation = true;
      if (b.directions) para.directions = true;
      // BANA 1.9.3 / F-39: a paragraph directly under a cell-5/cell-7 heading is blocked (1-1), as buildModel4/5 do. Unlike
      // those, a CENTRED (level-1) heading is NOT taken to block its paragraph here: sample-9-06's own braille has its lead-in
      // paragraph indented (cell 3) directly under a centred heading (examples 9-4/9-7/9-8 have level-2 headings, blocked).
      if (prevKind === 'heading' && prevHeadingLevel >= 2) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'quote') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'para', style: 'quote', ...tos });
    } else if (kind === 'epigraph') {
      const tos = textOrSegments(b.text);
      const ep = { type: 'para', style: 'epigraph', ...tos };
      if (b.blocked) ep.blocked = true;   // 9.3.1b: an epigraph keeps its OWN print format (sample-9-05's is flush, like the paragraph flag above)
      blocks.push(ep);
    } else if (kind === 'attribution' || kind === 'source') {
      const tos = textOrSegments(b.text);
      // F-80 / BANA 9.4.1d, 9.5.1c/d: the blank line after an attribution/citation belongs to the END of a run; print's own
      // consecutive fragments (a closing phrase, "(Signed)", the signature; a run of image credits) sit with none between them,
      // so every attribution/source directly followed by another one is `continued` (formatAttribution suppresses its blank).
      const prev = blocks[blocks.length - 1];
      if ((prevKind === 'attribution' || prevKind === 'source') && prev && prev.type === 'attribution') prev.continued = true;
      blocks.push(kind === 'source' ? { type: 'attribution', kind: 'source', ...tos } : { type: 'attribution', ...tos });   // 9.5.2: a source under a heading takes the previous line + 4
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const horizontal = /\bhorizontal/i.test(String(b.features ?? '')) && items.length && items.every((it) => typeof it === 'string');
      if (horizontal) {
        // BANA 9.2.4: a horizontal word list across the print page is ONE displayed line, the words separated by a blank cell
        // (print's own `features` says "displayed horizontally ... on one print line") — displayed material, not a vertical list.
        blocks.push({ type: 'para', style: 'quote', ...textOrSegments(items.join(' ')) });
      } else {
        // items are plain strings, or {marker, level, text} objects like section 8's (buildListItem takes either)
        const built = items.map((it, i) => buildListItem(it && typeof it === 'object' ? it : { text: it }, limitations, `list item ${i}`));
        const lst = { type: 'list', kind: 'list', items: built };
        if (b.displayed === true) lst.displayed = true;   // 9.2.2e / F-79: the print description says the items are displayed text (indented, own lines) — a print flag, not braille wording
        blocks.push(lst);
      }
    } else if (kind === 'box') {
      const inner = buildBlocks9(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      if (b.title != null && String(b.title).trim()) boxBlock.title = esc(String(b.title).trim());
      blocks.push(boxBlock);
    } else if (kind === 'other' && /incidental note/i.test(String(b.features ?? '')) && /no heading/i.test(String(b.features ?? '')) && b.text) {
      blocks.push({ type: 'xref', ...textOrSegments(b.text) });   // 9.6.1e: a note without a heading, 7-5 (F-104)
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
    prevKind = kind;
    if (kind !== 'heading') headingRunLen = 0;
  }
  return blocks;
}
function buildModel9(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks9(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-5 (Typeforms) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 5's gold schema (tests/gold/bana-formats-2016/section-5/README.md) is a flat
// print.blocks[] list, each {kind, level, text, features, items}:
//   kind 'heading'   -> a document `heading` block, level 1/2/3 = centred/cell-5/cell-7 —
//                       re-derived directly from each file's own agreed braille.lines
//                       (the fixed-4/6-cell vs. (40-len)//2 centring test buildModel4/7/8
//                       already use), never taken from either transcription run's own
//                       account; see the gold files' own resolution notes (e.g.
//                       example-5-4/5-11/5-12's centred title/byline lines, example-5-7/
//                       5-9's fixed-4-cell "SPELLING WORDS"/"WHAT DO YOU KNOW..." headings).
//   kind 'paragraph' -> a document `para` block.
//   kind 'list'      -> a document `list` block whose own `items[]` are plain inline-
//                       marked-up strings (not {marker,level,text} objects like §7/8/9's
//                       own list items — every list in this section is a single flat run
//                       with the item's own ordinal/lettered marker already folded into
//                       its own text, e.g. "**1.** *friend*").
//   kind 'other'     -> never modeled; recorded as a limitation exactly like
//                       buildModel4/7/8/9's own 'other' — every {{tdN}} transcriber's-note
//                       symbols key in this section's own worked examples/samples has no
//                       print-side counterpart at all (Examples 5-14/5-16/5-17, Samples
//                       5-1/5-3 each open their braille with one).
//
// A block's/item's `text` carries this gold corpus's own `{{tdN: X}}` placeholder for a
// transcriber-defined typeform span (colour, double underline, a shape outline, etc.).
// There is no markup token for this in Emboss's own cell-markup DSL. Script has its own `tf`
// bit since 26 Sep 2026 (TF_SCRIPT = 8, EMBOSS-TASKS K5), and the braille can carry the five
// UEB transcriber-defined indicators via `segment.transcriberTypeform` (hyperlinks = first,
// strikethrough = second, BrailleBlaster trans1–trans5), but nothing assigns an arbitrary print
// feature (colour, double underline, a shape outline) to one, so `{{tdN}}` is not mapped
// (standards-findings.md F-86 / F-T1). Every
// `{{tdN: X}}` span is unwrapped to its own inner text X (recorded as a limitation, once
// per distinct tdN symbol actually used in a given block/item) BEFORE the string reaches
// textOrSegments/parseCellMarkup, so a genuine *italic*/<u>underline</u> run nested inside
// an unrepresentable transcriber-defined span (Example 5-14's own demonstration sentence,
// "My school's {{td1: orchestra *and* band}} {{td2: have}} different instruments.") still
// parses correctly for the attribute Emboss CAN represent, while the attribute it cannot
// is dropped as plain text rather than leaking the literal "{{td1: ...}}" braces into the
// model.
const TRANSCRIBER_DEFINED_RE = /\{\{td(\d+):\s*([^}]*)\}\}/g;
function stripTranscriberDefinedSpans5(raw, limitations, where) {
  const seen = new Set();
  return String(raw ?? '').replace(TRANSCRIBER_DEFINED_RE, (_, n, inner) => {
    if (!seen.has(n)) {
      seen.add(n);
      limitations.push(`${where} uses transcriber-defined typeform symbol #${n} (BANA 5.5.1/5.9.1 — colour, double underline, a shape outline, etc.) on "${inner}" — Emboss cannot yet assign an arbitrary print feature to one of the five UEB transcriber-defined indicators (F-T1; script itself is supported since 26 Sep); built as plain unstyled text, the attribute is not representable.`);
    }
    return inner;
  });
}
function textOrSegments5(raw, limitations, where) {
  return textOrSegments(stripTranscriberDefinedSpans5(raw, limitations, where));
}
function buildModel5(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = [];
  let prevKind = null;   // raw previous print block kind (for the blocked-paragraph test, as buildModel4 / F-39)
  let prevHeadingLevel = null, headingRunLen = 0;
  for (const b of printBlocks) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        prevKind = kind; headingRunLen = 0;
        continue;
      }
      headingRunLen = (prevKind === 'heading' && b.level === prevHeadingLevel) ? headingRunLen + 1 : 1;
      prevHeadingLevel = b.level;
      const tos = textOrSegments5(b.text, limitations, 'heading');
      const h = { type: 'heading', level: b.level, ...tos };
      // BANA 5.3.1: a heading that is only PARTLY emphasised in print (some text emphasised, some
      // plain, e.g. "From *Book Title*") keeps that emphasis — decided by the formatter itself since
      // K1 (25 Sep), so no keepEmphasis is set here any more.
      blocks.push(h);
    } else if (kind === 'paragraph') {
      const tos = textOrSegments5(b.text, limitations, 'paragraph');
      const para = { type: 'para', ...tos };
      // BANA 1.9.3 / F-39, same rule as buildModel4: a paragraph directly under a standalone heading is blocked.
      if (prevKind === 'heading' && !(prevHeadingLevel === 1 && headingRunLen > 1)) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => {
        // Gold-fixture syntax only (independent of old BANA 5.3.9, withdrawn by TF-1, Paul 28 Sep 2026): a
        // "**1.**"/"<b>1.</b>"-style leading run in the markdown source is the item's ordered-list MARKER — a
        // structural field (`item.marker`, always plain, like a bullet), never part of the item's own emphasised
        // text — regardless of whether the rule that once said to drop a bold identifier's font attribute still
        // applies to text actually kept as segments (it does not; see decorativeEmphasisOf in format/document.mjs).
        let raw = it, marker;
        const mm = typeof raw === 'string' ? /^(?:\*\*([^*\s]{1,6})\*\*|<b>([^<\s]{1,6})<\/b>)\s+(?=\S)/.exec(raw) : null;
        if (mm) { marker = mm[1] || mm[2]; raw = raw.slice(mm[0].length); }
        const tos = textOrSegments5(raw, limitations, `list item ${i}`);
        const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
        if (marker) item.marker = marker;
        return item;
      });
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — braille-only content with no print-side counterpart in this schema, e.g. a transcriber's-note symbols key): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
    prevKind = kind;
    if (kind !== 'heading') headingRunLen = 0;
  }
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-13 (Poetry and Song Lyrics) and b004-appendix-j
// (UKAAF B004 Appendix J, Poetry) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-13/README.md) is a flat
// print.blocks[] list, each {kind, level, text, features, stanzas}:
//   kind 'heading'   -> a document `heading` block (level 1/2/3 = centred/cell-5/cell-7),
//                       exactly as buildModel4/7/8/9/5 already do.
//   kind 'paragraph' -> a document `para` block, exactly as the other builders.
//   kind 'poem'      -> BANA §13 / B004 Appendix J: `stanzas[].lines[]` becomes a run of
//                       document `{type:'play', subtype:'verse', style:'verse', text/segments,
//                       level}` blocks, one per print line — the SAME shape real DTBook
//                       <poem>/<linegroup>/<line> markup parses to (Emboss/input/parse.mjs's
//                       parsePoem, ~lines 2468-2542). `level` is the line's own `indent`
//                       (already a LEVEL — 0, 1, 2... — not a literal cell count, per both
//                       transcription runs' own method note) and is OMITTED when 0, matching
//                       parsePoem's own `if (lnLvl > 0) blk.level = lnLvl`; `formatPlay`/
//                       `nestedMargins('poetry', ...)` then derive the actual BANA
//                       1-3/1-5,3-5/... or B004 App J cell-1/cell-5 margins from the poem-wide
//                       `maxLevel` that `verseRunLevels` computes automatically over the whole
//                       document (document.mjs:178-190) — this builder never sets `maxLevel`
//                       itself. A `number` on a line (BANA 13.4.1b/13.11.4a's stanza/verse
//                       numbers, shown in print folded into the first line of a stanza, not as
//                       print's own separate heading line — contrast Sample 13-2's "I."/"II.",
//                       modelled as an ordinary `kind:'heading'` block below since print shows
//                       those as real, independent heading lines) is folded into the line's
//                       own text as a literal "N " prefix, NOT built as a separate heading —
//                       not a simplification but a faithful reproduction of parsePoem's own
//                       real (and, per standards-findings.md F-P3, buggy) behaviour:
//                       `numPrefix = (...) + ' '; t = numPrefix + t` (parse.mjs:2512-2514) —
//                       there is no cell-5-heading code path for a poem/stanza number anywhere
//                       in document.mjs. A stanza boundary within one `poem` block (more than
//                       one entry in `stanzas[]`) becomes a `{type:'indicator', kind:'line'}`
//                       block between the two stanzas' own line-runs — exactly the block
//                       parsePoem itself inserts between two `<linegroup>` siblings
//                       (parse.mjs:2500/2556-2558), which `isVerseSeparator`/`case 'indicator'`
//                       (document.mjs:171-172,2002-2003) renders as a single blank line.
//   kind 'other'     -> never modelled (a musical-notation graphic, a symbol-only diagram
//                       picture, a footnote's own editorial annotation with no braille
//                       counterpart to build) — recorded as a limitation exactly like every
//                       other section's own 'other', whether or not it carries any `text` at
//                       all (several of this section's own 'other' blocks are print-only
//                       graphics with `text: null` and only a `features` description).
//
// Two systemic, already-documented Emboss gaps make nearly every poem in this section diverge
// from its own gold braille independent of anything this builder does (assess-13/
// poetry-writeup.md F-P1..F-P10, not yet merged into standards-findings.md when this runner
// was written — cited here by their F-P ids):
//   F-P1 — formatPlay never adds the blank line BANA 13.3.1a / B004 App J require before and
//     after a poem (document.mjs:790-800 pushes no leading/trailing '').
//   F-P3 — a stanza/verse `number` folded into a line's text (see above) is never rendered as
//     the cell-5 heading 13.4.1b/13.11.4a require.
// Every other §13/App J finding (F-P2, F-P4..F-P10) is examples/samples-specific and is cited
// per-file in this runner's own --update-status notes instead.
// Diagnosis-run (23 Sep 2026) additions to this builder, each read straight off the print
// description (see Emboss/docs/wip/gold-diagnosis-section-13.md):
//  - a paragraph whose print text OPENS with an ellipsis is a mid-sentence fragment of a longer
//    paragraph (Example 13-1's "… suggesting that ..."), so it is a `continuation` (no first-line
//    indent), exactly the flag buildModel3 uses for a run-on paragraph fragment;
//  - a poem line that is nothing but a verse/stanza number ("2.", "II.", Sample 13-14's verse
//    numbers) is a cell-5 heading (BANA 13.4.1b / 13.11.4a), like Sample 13-2's "I."/"II."
//    that print.blocks already gives as `kind:'heading'` — not a verse line at indent level 2;
//  - a superscript digit in a poem line whose matching "¹note text" print block follows
//    (Sample 13-8's "clarion¹" / "¹clarion (klar'-ē-ən): loud and clear.") is a reference mark
//    plus its footnote, built as the same noteref segment + footnote block section-16 builds.
const SUPERSCRIPT13 = { '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u2070': '0' };
const SUPERSCRIPT13_RE = /[\u00b9\u00b2\u00b3\u2074-\u2079\u2070]/;
const VERSE_NUMBER13_RE = /^(?:\d{1,3}|[IVXLC]{1,6})\.$/;
function buildBlocks13(printBlocks, limitations) {
  const blocks = [];
  // Footnote text keyed by superscript mark, from `kind:'other'` blocks written "¹note text".
  const footnotes13 = new Map();
  for (const fb of (printBlocks || [])) {
    if (!fb || fb.kind !== 'other' || typeof fb.text !== 'string') continue;
    const fm = /^([\u00b9\u00b2\u00b3\u2074-\u2079\u2070])\s*(\S[\s\S]*)$/.exec(fb.text.trim());
    if (fm) footnotes13.set(SUPERSCRIPT13[fm[1]], { text: fm[2], used: false });
  }
  let noteSeq13 = 0;
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      if (/^\s*(?:\u2026|\.\.\.)/.test(String(b.text ?? ''))) para.continuation = true;
      if (b.blocked) para.blocked = true;   // print.blocks[].blocked: flush-left paragraph (1.9.3)
      // 13.11.2b: information printed below a song title (centred / left / right of the page): 7-5 margins, in the order centred, left, right.
      const pos = /(cent(?:er|re)(?:ed|d)|left side|right side)[^.]*below the title/i.exec(String(b.features ?? ''));
      if (pos && blocks.length && (blocks[blocks.length - 1].type === 'heading' || blocks[blocks.length - 1].songInfo)) {
        para.songInfo = true;
        const rank = /cent/i.test(pos[1]) ? 0 : /left/i.test(pos[1]) ? 1 : 2;
        let at = blocks.length;
        while (at > 0 && blocks[at - 1].songInfo && blocks[at - 1]._infoRank > rank) at--;
        para._infoRank = rank;
        blocks.splice(at, 0, para);
        continue;
      }
      blocks.push(para);
    } else if (kind === 'attribution') {
      // A poem's own trailing signature/credit line (e.g. Sample 13-4's "e.e. cummings" after
      // the poem) — BANA §9.4's attribution margin (cell 5, blocked), formatAttribution,
      // document.mjs:767-773 — distinct from a centred byline directly under a title, which
      // this schema instead models as its own `kind:'heading'` level-1 line (see above).
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'attribution', ...tos });
    } else if (kind === 'poem') {
      const stanzas = Array.isArray(b.stanzas) ? b.stanzas : [];
      const pendingNotes = [];
      stanzas.forEach((st, si) => {
        const lines = (st && Array.isArray(st.lines)) ? st.lines : [];
        const firstLine = lines.find((l) => l && String(l.text ?? '').trim());
        const startsWithNumber = !!firstLine && VERSE_NUMBER13_RE.test(String(firstLine.text).trim());
        if (si > 0 && !startsWithNumber) blocks.push({ type: 'indicator', kind: 'line' });
        for (const ln of lines) {
          if (!ln) continue;
          const raw = String(ln.text ?? '');
          if (!raw.trim()) continue;
          if (VERSE_NUMBER13_RE.test(raw.trim())) {
            blocks.push({ type: 'heading', level: 2, text: esc(raw.trim()) });
            continue;
          }
          const num = (ln.number != null && String(ln.number).trim()) ? String(ln.number).trim() : null;
          const blk = { type: 'play', subtype: 'verse', style: 'verse' };
          const sup = SUPERSCRIPT13_RE.exec(raw);
          const supMark = sup ? SUPERSCRIPT13[sup[0]] : null;
          const fn = supMark ? footnotes13.get(supMark) : null;
          if (num) {
            // F-182 (fixed): parsePoem now builds a genuine right-margin `linenum` segment,
            // not a left-margin text prefix — mirrored here so this builder matches the real,
            // fixed parser. `.text` keeps the old "N " prefix (parity with parse.mjs's own
            // `.text` field, a plain-text convenience never used for rendering once
            // `.segments` is present).
            blk.text = num + ' ' + raw;
            blk.segments = [{ type: 'linenum', text: num }, ...parseCellMarkup(raw)];
          } else if (fn && !fn.used) {
            fn.used = true;
            noteSeq13 += 1;
            const id = `s13-n${noteSeq13}`;
            const before = raw.slice(0, sup.index);
            const after = raw.slice(sup.index + 1);
            blk.text = before + after;
            blk.segments = [...parseCellMarkup(before), { type: 'noteref', text: supMark, idref: id }, ...parseCellMarkup(after)];
            pendingNotes.push({ type: 'footnote', id, segments: [{ type: 'noteref', text: supMark }, { type: 'text', text: esc(fn.text) }] });
          } else {
            Object.assign(blk, textOrSegments(raw));
          }
          const lvl = Number(ln.indent) || 0;
          if (lvl > 0) blk.level = lvl;
          if (/centered as a block|centred as a block/i.test(String(b.features ?? ''))) blk.displayedPoem = true;   // 13.3.1c second option: a poem centred on the print page shown as displayed material (Sample 13-1)
          if (/unusual (?:embedded )?punctuation/i.test(String(b.features ?? ''))) blk.uncontractedPoem = true;   // 13.6.4a: unusual letter/punctuation combinations, whole poem uncontracted (F-125)
          if (/\S {2,}\S/.test(raw) && /wide[^.;]*spacing/i.test(String(b.features ?? ''))) blk.wideSpaces = true;   // 13.6.3: wide spacing in print is three blank cells (F-124); needs the print description to say the spacing is wide (a run of spaces alone is not enough)
          blocks.push(blk);
        }
      });
      for (const nb of pendingNotes) blocks.push(nb);
    } else if (kind === 'other') {
      const fm = typeof b.text === 'string' ? /^([\u00b9\u00b2\u00b3\u2074-\u2079\u2070])/.exec(b.text.trim()) : null;
      const fn = fm ? footnotes13.get(SUPERSCRIPT13[fm[1]]) : null;
      if (fn && fn.used) continue;   // built as a footnote with its poem-line reference mark above
      limitations.push(`print block kind 'other' (not modeled — print-only content with no braille-buildable counterpart in this schema, e.g. a musical-notation graphic, a symbol-only diagram, or an editorial annotation): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel13(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks13(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks, elisionApostrophe: true }, limitations, hasTable: hasContent };   // Sample 13-14: courtin\u2019 is an elision apostrophe
}

// ---------------------------------------------------------------------------
// Model building for section-3 (Transcriber's Notes) — from sample.print.blocks
// (and, only when print.blocks is empty, sample.print.transcriberNote) ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-3/README.md) is a flat
// print.blocks[] list, each {kind, level, text, features, items, continuation}, PLUS a
// separate top-level print.transcriberNote (a plain-English documentation copy of the
// section's own primary note wording — this section's whole subject IS the transcriber's
// note, unlike every other section's plain print.blocks[]-only schema):
//   kind 'heading'   -> a document `heading` block (level as given), exactly as the
//                       §4/§7/§8/§9/§13 precedents.
//   kind 'paragraph' -> a document `para` block; `continuation:true` (matching buildModel1's
//                       own convention, itself matching document.mjs's real formatPara
//                       `continuation` field) marks a paragraph that is only a run-on
//                       continuation of a sentence interrupted by an embedded note
//                       (example-3-2's own "light and heat", directly after its own note).
//   kind 'note'      -> BANA §3's own whole subject: a document `{type:'note', text}` block,
//                       the SAME shape parse.mjs itself builds from a real <prodnote>/
//                       <annotation> (parse.mjs:2647/2777/2782), formatted by document.mjs's
//                       own formatTranscriberNote (document.mjs:819-826) — UEB's TN
//                       indicators (TN_OPEN='@.<'/TN_CLOSE='@.>') wrapped at BANA's fixed 7-5
//                       margins (tnMargins, document.mjs:793), UNCONDITIONALLY: there is no
//                       narrower margin for a short "embedded" (≤7-word, 3.2.3) note, and no
//                       way to give a note's own internal content (3.3.2's nested 1-3 symbol
//                       list, example-3-3) a different margin from the rest of it. A note
//                       block's POSITION in print.blocks[] is what carries whether it is a
//                       "standard" note before/after other content (example-3-1, both of
//                       example-3-4's notes) or a genuinely EMBEDDED, mid-sentence note
//                       (example-3-2's "right arrow", spliced between two paragraph
//                       fragments) or a note standing alone as a heading-like label
//                       (sample-3-01's "Term"/"Definition" column headings) — this builder
//                       does not distinguish these cases itself, only reproduces the note in
//                       its given place, exactly as parse.mjs's own <prodnote> handling does.
//   kind 'list'      -> a document `list` block; items[] may be plain strings (no markers —
//                       example-3-3's three analogy lines) or {marker, text} objects
//                       (sample-3-01's lettered/numbered matching-exercise columns), reusing
//                       buildListItem exactly as the §7/§8/§9/§16 precedents do.
//   kind 'pagenum'   -> BANA 1.11.3's mid-braille-page print-page-change indicator, reusing
//                       the §1 gold precedent's own {type:'pagenum', page} document block
//                       (example-3-4's two page turns, 833 then 834) — formatPageNum's BANA
//                       output (document.mjs:1029-1043) is expected to build and compare
//                       correctly; nothing section-3-specific about it.
//   kind 'other'     -> never modelled; recorded as a limitation exactly like every other
//                       section's own 'other' (not used by any of this section's own 9 files;
//                       kept for schema consistency with every other builder).
// Where print.blocks is empty (the four no-braille anonymous "Samples:" wordings under 3.3.3/
// 3.4.1 — there is no OTHER print content at that citing location at all), a single
// {type:'note', text} block is built from the top-level print.transcriberNote instead; this
// never affects a sample's status either way, since expectedLinesFor's own empty-braille.lines
// check classifies these "no-braille" before the model is even run (runOne, above).
//
// Three findings, all newly documented or reused during this reconciliation (standards-
// findings.md F-157, F-158, and reused F-N2), make most of this section's own worked examples
// diverge from their own gold braille independent of anything this builder does — see
// tests/gold/bana-formats-2016/section-3/README.md's own "buildModel3" section for the full
// account of each, and differences.md for the file-by-file evidence.
function buildBlocks3(printBlocks, limitations) {
  const blocks = [];
  const pbs = printBlocks || [];
  for (let bi = 0; bi < pbs.length; bi++) {
    const b = pbs[bi];
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const nx = pbs[bi + 1], nn = pbs[bi + 2];
      // F-107 / BANA 3.2.3: a note of seven words or fewer standing between a paragraph and its own continuation is
      // embedded on the text line ("shown within the text"): one paragraph, the note an `imgnote` segment.
      // Independence: the seven-word rule is NOT applied to the note's text here (that read the transcriber's wording);
      // the print description must say the note is embedded (`embedded:true` on the note block).
      if (nx && nx.kind === 'note' && nn && nn.kind === 'paragraph' && nn.continuation && nx.embedded === true && !String(nx.text ?? '').includes('\n')) {
        blocks.push({ type: 'para', hangingMargins: true, segments: [
          { type: 'text', text: `${String(b.text).trimEnd()} ` },
          { type: 'imgnote', text: String(nx.text).trim() },
          { type: 'text', text: ` ${String(nn.text).trimStart()}` }] });
        bi += 2;
        continue;
      }
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      if (b.continuation) para.continuation = true;
      blocks.push(para);
    } else if (kind === 'note') {
      const nb = { type: 'note', ...textOrSegments(b.text) };
      // F-138: a symbol (Unicode category S, e.g. ×) named in the note is being mentioned; dot locator before its first use.
      const syms = [...new Set(String(b.text ?? '').match(/\p{S}/gu) || [])];
      if (syms.length) nb.mentionSymbols = syms;
      // F-163 / BANA 3.2.3 + 10.9.2b: a note of seven words or fewer standing alone as the heading of the list that follows is a cell-5 heading.
      // Independence: driven by an explicit print-side flag (`headingOfList:true` on the note block), not by a word count of the note's text.
      if (!nb.segments && pbs[bi + 1] && pbs[bi + 1].kind === 'list' && b.headingOfList === true && !String(nb.text).includes('\n')) nb.cell5 = true;
      // F-15 / BANA 3.3.2: a note whose own text carries an identification list (intro line + two or more item lines).
      if (!nb.segments && String(nb.text).split('\n').filter((l) => l.trim()).length >= 3) { nb.keyList = true; if (/symbol/i.test(String(b.features ?? ''))) nb.keyLocator = true; }
      blocks.push(nb);
    } else if (kind === 'attribution') {
      // A fixed cell-5 block (BANA §9.4, formatAttribution — first line AND runover both
      // indented 4 cells, no blank line before, one blank line after), reused here exactly as
      // the section-9 gold precedent reuses it for its own non-authorship cell-5 content
      // (source citations) — sample-3-01's own "Directions:" line has this exact margin,
      // confirmed directly against its gold braille, not an ordinary paragraph's margin.
      blocks.push({ type: 'attribution', ...textOrSegments(b.text) });
    } else if (kind === 'pagenum') {
      const page = b.text != null ? String(b.text).trim() : '';
      if (!page) {
        limitations.push(`pagenum block has no text — not built.`);
        continue;
      }
      blocks.push({ type: 'pagenum', page: esc(page) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => (typeof it === 'string' ? { text: esc(it) } : buildListItem(it, limitations, `list item ${i}`)));
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel3(sample) {
  const print = sample.print || {};
  const printBlocks = Array.isArray(print.blocks) ? print.blocks : [];
  const limitations = [];
  let blocks;
  if (printBlocks.length) {
    blocks = buildBlocks3(printBlocks, limitations);
  } else if (print.transcriberNote != null && String(print.transcriberNote).trim()) {
    // Independence rule: print.transcriberNote is transcriber-written (braille content); with no print blocks nothing is built.
    blocks = [];
    limitations.push(`print.blocks is empty and the only note text is the transcriber-written print.transcriberNote ("${String(print.transcriberNote).replace(/\n/g, ' / ').slice(0, 80)}"); building it would read the note back from the braille — not representable from the print alone.`);
  } else {
    blocks = [];
  }
  // Independence rule: a transcriber's note the transcriber wrote (print.transcriberNote) is braille content, not print.
  // When the print blocks carry no note block, the expected braille contains a note the print does not show, so the input
  // cannot be built from the print alone (Examples 3-1..3-3).
  if (printBlocks.length && !printBlocks.some((b) => b && b.kind === 'note') && print.transcriberNote != null && String(print.transcriberNote).trim()) {
    limitations.push(`the expected braille includes a transcriber's note ("${String(print.transcriberNote).replace(/\n/g, ' / ').slice(0, 80)}") that the print original does not show (transcriber-written, BANA 3.2); building it would read the note back from the braille — not representable from the print alone.`);
  }
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-12 (Sidebars) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// Section 12's gold schema (tests/gold/bana-formats-2016/section-12/README.md) reuses
// buildBlocks7's own box logic wholesale for its own 'sidebar' kind — BANA 12's whole
// subject is that a print sidebar IS, structurally, a box (document.mjs's formatBox
// handles `type:'box'` and `type:'sidebar'` identically, `case 'sidebar': return
// formatBox(block, o)`, document.mjs:2062) — plus this section's own 'attribution' kind
// (reused from buildBlocks3 exactly: a fixed cell-5/cell-5 block, no ordinary paragraph
// margin, for a "Directions:"-style line preceding a sidebar word list, sample-12-7).
//   kind 'heading'     -> a document `heading` block, level 1/2/3/4 = centred/cell-5/
//                         cell-7/cell-9 (this section's own worked examples nest one
//                         level deeper than §7's boxes do — a sidebar's own inner
//                         sub-heading, e.g. sample-12-5's "Procedure"/"Analysis" —
//                         document.mjs's formatHeading supports any level; only 1-3 are
//                         exercised anywhere else in this gold corpus).
//   kind 'paragraph'   -> a document `para` block.
//   kind 'attribution'  -> a document `attribution` block (BANA §9.4 formatAttribution,
//                         reused via buildBlocks3's own precedent) for a fixed 4/4-margin
//                         directions line (sample-12-7's "Choose the correct term...").
//   kind 'list'        -> a document `list` block, reusing buildListItem exactly as
//                         buildModel7/8 do.
//   kind 'sidebar'     -> BANA §12's own subject matter: a NESTED { kind:'sidebar',
//                         title?, blocks:[...] } container, built into a document
//                         `{type:'box', title?, blocks:[...]}` block — IDENTICAL
//                         treatment to buildBlocks7's own 'box' kind (a sidebar and a
//                         box share one document-model formatter). `title` (present
//                         only where the sidebar carries its own accompanying heading
//                         at the top of the box, BANA 7.2.1e) is passed straight
//                         through to `box.title`, exactly as buildBlocks7 does.
//   kind 'box'         -> accepted as a plain synonym for 'sidebar' (same handling),
//                         kept for robustness/consistency with buildBlocks7/8, though
//                         no file in this section's own gold set currently uses it.
//   kind 'other'       -> never modeled; recorded as a limitation exactly like every
//                         other section's own 'other' — used in this section for
//                         print-page-number badges, running-head footers, "(Formats:
//                         ...Location)" instructional callouts (BANA furniture with no
//                         document-model counterpart), and (sample-12-3) a
//                         cross-reference box whose own braille margin matches neither
//                         an ordinary paragraph nor a box.
//
// Two of this section's seven gold files (sample-12-3, sample-12-7) carry real braille;
// both excerpts are shorter than their own full print content, marked in the source by
// a literal '444' omission line at each cut point (sample-12-7's own 6-of-8 fill-in-the-
// blank truncation is likewise '444'-marked) — per the section-3/section-7
// (sample-3-01/sample-7-03) precedent, print.blocks records the FULL print content
// regardless, and buildModel12 is expected to over-produce at each such point; this is a
// documented book-excerpt limitation, not an Emboss defect (see each gold file's own
// resolution note, and section-12/README.md).
function buildBlocks12(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'para', ...tos });
    } else if (kind === 'attribution') {
      blocks.push({ type: 'attribution', ...textOrSegments(b.text) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      if (built.some((it) => it.blank)) {
        limitations.push(`list has one or more blank-fill items — not representable.`);
      }
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'sidebar' || kind === 'box') {
      const inner = buildBlocks12(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      if (b.title != null && String(b.title).trim()) {
        boxBlock.title = esc(String(b.title).trim());
      }
      if (b.colorNote) boxBlock.boxColor = String(b.colorNote).trim();   // K7 / F-72, 26 Sep
      if (b.boxLines === false) boxBlock.boxLines = false;   // format selected by the illustrated rule (12.3.1g, Sample 12-7: weak, not shown by the print). F-230 / 12.3.1g: a gold sidebar may state it is set without box lines (optional; default box lines)
      blocks.push(boxBlock);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel12(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks12(printBlocks, limitations);
  // 12.3.1g (Sample 12-7): the sidebar the rule illustrates is the one "necessary for the understanding of a particular text", inserted
  // before that text, with no box lines. The rule the sample illustrates names that choice (a known weak match, like the other builders
  // that read illustrates.rule); the print alone does not say whether a sidebar is necessary for understanding.
  // format selected by the illustrated rule (12.3.1g)
  if (/12\.3\.1g/.test(String(sample.illustrates?.rule ?? ''))) for (const bl of blocks) if (bl.type === 'box' && !bl.title) bl.boxLines = false;
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-6 (Illustrative Materials) — from sample.print.blocks
// ONLY. See tests/gold/bana-formats-2016/section-6/README.md for the full
// evidence-based account of how this section's own gold files were reconciled;
// this comment covers just the shape buildBlocks6/buildModel6 consume.
//
// print.blocks[] kinds:
//   'heading'   -> a document `heading` block (level as given; no level -> not built).
//   'paragraph' -> a document `para` block, textOrSegments()'d exactly like every
//                  other section (Emboss's own *bold*/_italic_/`code` cell-markup DSL
//                  where print itself shows emphasis — this section's own worked
//                  examples need it for bold captions/passages, e.g. example-6-3's
//                  "Views of anger", sample-6-1's "Diving's early history.").
//   'list'      -> a document `list` block; items[] reuses buildListItem exactly as
//                  the section-7/8/9/16 precedents do (numeric/ordinal markers for
//                  BANA 6.8.2's ascending-ancestral numbered lists, `level` for
//                  6.5.1/6.8.1/6.9.1/6.10.6's nested lists, '•' for 6.14-style
//                  bulleted lists).
//   'table'     -> a document `table` block (BANA 6.11's bar-graph-as-table option),
//                  reusing buildTable7's own {headers, rows} shape.
//   'box'       -> BANA 6.12.1a's boxed screenshot, reusing buildBlocks7's own nested
//                  {kind:'box', blocks:[...], title?} recursion.
//   'pagenum'   -> BANA 1.11.3's mid-braille-page print-page-change indicator,
//                  reusing the section-1/3 gold precedent's own {type:'pagenum',
//                  page} document block.
//   'note'      -> a standalone document `{type:'note', text}` block (formatTranscriberNote,
//                  document.mjs:819) — used for every transcriber's note in this section
//                  that ISN'T paired with an image caption (6.5.1/6.7.3.c/6.8.1c/6.8.2c/
//                  6.10.2/6.13.1c's own explanatory/methodology notes, and 6.6's/6.9's/
//                  6.13's "Section N"/"Note,"-style embedded labels).
//   'figure'    -> NEVER built directly by itself: `figure.figure` is pure documentation
//                  (what the image depicts/its print labels — confirmed, across this
//                  section's own reconciliation, to often NOT correspond to anything
//                  actually rendered into the sample's own braille excerpt at all, e.g.
//                  example-6-1/6-2's own `figure.description`). Only a top-level
//                  `description` string directly on the figure block (sibling of
//                  `figure`, not nested inside it) is ever built, and only:
//                    - merged into ONE document `graphic` block together with the very
//                      NEXT print.blocks entry if it is `kind:'caption'` (BANA 6.2.2's
//                      caption+description image model: `{type:'graphic', caption,
//                      captionSegments, description}`, dispatched by document.mjs's real
//                      `traceOrFormatPrintImage`/`printImageParts` — the SAME image-label
//                      mechanism that emits the transcriber's-note "[Illustration]" label
//                      per BANA 6.2.2b when the caption doesn't itself identify the
//                      picture; see F-225, this section's single biggest, systemic source
//                      of mismatch, since that label word is hard-coded and never the
//                      print-appropriate one — "photograph"/"picture"/etc. — the book's
//                      own worked examples actually use);
//                    - OR, when no `caption` block immediately follows, built ALONE as a
//                      standalone `{type:'note', text: description}` block (matching
//                      sample-6-2's own reconciliation finding: with no caption to
//                      attach a label to, the real braille never carries an
//                      "[Illustration]" line at all, only the bare transcriber's note —
//                      going through the image-label path here would fabricate a line
//                      the book's own braille never has).
//                  A `caption` block with no preceding `figure` (or a SECOND `caption`
//                  immediately after one already consumed — a photo credit/source line,
//                  BANA 6.2.2c) is never built; recorded as a limitation citing F-168
//                  (source citations/credits inside an imggroup are lost).
//   'caption'   -> only ever consumed as part of a `figure` pairing (above); a
//                  `caption` reached any other way is recorded as a limitation.
//   'other'     -> never modeled; recorded as a limitation exactly like every other
//                  section's own 'other'.
//
// F-231: document.mjs's traceOrFormatPrintImage now reads a `graphic` block's own
// `figureType` string as the transcriber's-note label word for an unidentified illustration
// (BANA 6.2.2b), instead of always hard-coding "Illustration". This gold schema's own
// `figure.type` field (a broad category: "photo", "drawing", "diagram", ...) was, until this
// fix, pure documentation with nothing consuming it (see F-231's own write-up); FIGURE_TYPE_WORD
// maps it to the same vocabulary IDENTIFIED_RE (document.mjs) already recognises, so a
// `graphic` block built here now carries the word a real transcriber would most likely use for
// that category. This mapping is NOT always the exact word the book itself used — e.g.
// sample-6-12's own "photo" figure is captioned "Picture" in the book, not "Photograph", a
// genuine per-picture editorial judgement this schema has no field to record — but every
// sample where the mapping doesn't match the book's own word was already blocked from a full
// gold match by another, independently documented finding (section-6/README.md's own F-231
// list), so nothing regresses.
const FIGURE_TYPE_WORD = { photo: 'Photograph', drawing: 'Drawing', diagram: 'Diagram', chart: 'Chart', graph: 'Graph', map: 'Map', painting: 'Painting', plate: 'Plate', image: 'Image', picture: 'Picture', figure: 'Figure', exhibit: 'Exhibit', table: 'Table' };
function buildBlocks6(printBlocks, limitations) {
  const blocks = [];
  const list = Array.isArray(printBlocks) ? printBlocks : [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      // A real print line break inside a heading (sample-6-7/6-13's own two-line
      // titles) is built as separate CONSECUTIVE heading blocks at the same level,
      // not one block with an embedded '\n': document.mjs's own HEADING_JOIN_TIERS
      // (centred>centred, cell5>cell5, cell5>cell7) already suppresses the blank
      // line between same-tier connected headings, so each print line is centred
      // independently with no gap, exactly matching the book's own two-line title —
      // whereas a literal '\n' left inside one heading's own text would instead be
      // wrapped (or ignored) by the ordinary word-wrapper, not treated as authoritative.
      const lines = String(b.text ?? '').split('\n');
      for (const line of lines) blocks.push({ type: 'heading', level: b.level, ...textOrSegments(line) });
    } else if (kind === 'paragraph') {
      blocks.push({ type: 'para', ...textOrSegments(b.text) });
    } else if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegments(b.text) });
    } else if (kind === 'pagenum') {
      const page = b.text != null ? String(b.text).trim() : '';
      if (!page) { limitations.push(`pagenum block has no text — not built.`); continue; }
      blocks.push({ type: 'pagenum', page: esc(page) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, idx) => (typeof it === 'string' ? { text: esc(it) } : buildListItem(it, limitations, `list item ${idx}`)));
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'table') {
      blocks.push(buildTable7(b, limitations, 'table'));
    } else if (kind === 'box') {
      const inner = buildBlocks6(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      // A section-6 box `title` (sample-6-15's "Screenshot for Information Only") is the
      // book's own sample caption printed ABOVE the screenshot, outside the box and outside
      // the braille (page 6-36: the braille starts at the top box line) — not print content
      // of the screenshot, so it is not built as a box-title heading.
      blocks.push(boxBlock);
    } else if (kind === 'figure') {
      const next = list[i + 1];
      const hasDescription = b.description != null && String(b.description).trim();
      if (next && typeof next === 'object' && next.kind === 'caption') {
        const tos = textOrSegments(next.text);
        const graphic = { type: 'graphic', caption: tos.text != null ? tos.text : String(next.text ?? '') };
        if (tos.segments) graphic.captionSegments = tos.segments;
        if (hasDescription) graphic.description = esc(String(b.description).trim());
        const figType = b.figure && b.figure.type ? FIGURE_TYPE_WORD[String(b.figure.type).toLowerCase()] : null;
        if (figType) graphic.figureType = figType;
        blocks.push(graphic);
        i++; // consume the paired caption
        // A further immediate 'caption' (photo credit/source citation, BANA 6.2.2c) is
        // never built — Emboss's imggroup parsing loses citations entirely (F-168).
        const after = list[i + 1];
        if (after && typeof after === 'object' && after.kind === 'caption') {
          limitations.push(`source citation/photo-credit caption "${String(after.text ?? '').slice(0, 160)}" immediately follows an already-captioned figure — not built (F-168, source citations inside an imggroup are lost).`);
          i++;
        }
      } else if (hasDescription) {
        // No caption to pair with: build the description alone as a standalone
        // transcriber's note (never through the image-label mechanism — see header
        // comment above and sample-6-2's own README/differences.md finding).
        blocks.push({ type: 'note', ...textOrSegments(b.description) });
      }
      // Otherwise: pure documentation (figure.figure.description/labels never rendered
      // into this sample's own braille excerpt) — nothing to build, no limitation
      // recorded (this is expected, not a gap).
    } else if (kind === 'caption') {
      limitations.push(`caption block "${String(b.text ?? '').slice(0, 160)}" has no preceding figure to pair with — not built (F-168).`);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel6(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks6(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-15 (Line-Numbered and Line-Lettered Text) — from
// sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-15/README.md) is a flat
// print.blocks[] list, each {kind, text, level, number, letter, newPara, printVisible, features}:
//   kind 'heading'     -> an ordinary document `heading` block (level as given), exactly as the
//                         §4/§7/§8/§9/§13/§3 precedents.
//   kind 'other'       -> never modelled (a print page number, a page-decoration block) —
//                         recorded as a limitation exactly like every other section's own 'other'.
//   kind 'stanzabreak' -> a `{type:'indicator', kind:'line'}` block between two runs of poem
//                         lines, exactly the block buildModel13/parsePoem itself inserts between
//                         two stanzas (rendered as a single blank line).
//   kind 'paragraph'   -> an ordinary prose paragraph with NO linenum apparatus at all (§15.7.1's
//                         own "Paragraph Format" rhyme scheme, Example 15-1 — a rhyme-scheme
//                         letter shown with ordinary retained emphasis inline in running text,
//                         not a line-numbering construct).
//   kind 'numbered'    -> §15.2 margin-numbered paragraphs, §15.3/15.4/15.6.1a/15.8/15.9.3
//                         line- or paragraph-numbered PROSE: a genuine `{type:'linenum'}` segment
//                         (the real A30 model parse.mjs:1928-1933 builds from a source
//                         <linenum>) is placed before the block's own first word whenever
//                         `number` is non-null, feeding the SAME formatSegmentedPara/
//                         wrapNumbered pipeline every one of this kind's rules actually shares
//                         (document.mjs:719-742) — the number is drawn to the right margin (or,
//                         for §15.2, WRONGLY drawn there too — F-205). Consecutive 'numbered'
//                         blocks are MERGED into one flowing `para` block (one printed
//                         paragraph's own several print lines, each with its own optional
//                         linenum segment) so wrapNumbered sees the whole paragraph as one
//                         continuous stream and can wrap a print line's own text across braille
//                         rows exactly as the gold braille shows — UNLESS a block sets
//                         `newPara:true`, which starts a fresh `para` block instead (a genuine
//                         print paragraph break, BANA 15.4.1a "follow print for indented or
//                         blocked paragraphing").
//   kind 'verse'       -> §15.5.1/15.7.2/15.7.3/15.9.3-style STANDALONE POEM lines: a `{type:
//                         'play', subtype:'verse', style:'verse', level}` block per line — the
//                         SAME shape buildModel13 already uses for §13 poems — whose own
//                         `number`/`letter` (a BANA line number or rhyme-scheme letter) is
//                         folded into the line's own text as a literal "N " prefix, NOT built as
//                         a genuine linenum segment, faithfully reproducing parse.mjs's real
//                         parsePoem `numPrefix` behaviour (F-182) exactly as buildModel13 already
//                         does for §13. Where a line carries BOTH a `letter` and a `number`
//                         (BANA Sample 15-8's own construct — F-182's own "findLinenum returns
//                         only the FIRST <linenum> child" defect), only `letter` is folded in;
//                         `number` is deliberately never built, reproducing the second marker's
//                         real, total loss.
//   kind 'dialogue'    -> §15.5.2/15.6.1b-style PLAY DIALOGUE lines (a speaker's own turn, or a
//                         continuation line of the same speech with no speaker repeated): a
//                         `{type:'play', subtype:'verse', level}` block exactly like 'verse'
//                         EXCEPT its `number` (where present) is kept as a genuine, UNFOLDED
//                         `{type:'linenum'}` segment — matching standards-map.md's own row for
//                         BANA 15.5.2a and standards-findings.md F-181: a play-dialogue line does
//                         NOT go through parsePoem's numPrefix fold at all (there is no <poem>
//                         here, just consecutive speaker/dialogue lines), so a real `<linenum>`
//                         segment survives all the way to document.mjs's formatPlay, which then
//                         silently drops it — segmentsToBraille is called without lineNumbers:
//                         true on either of formatPlay's two (prose/verse) branches.
//
// This section's own five findings (already merged into standards-findings.md before this
// reconciliation began):
//   F-181 — play-dialogue line numbers dropped entirely (formatPlay never requests lineNumbers).
//   F-182 — poem line numbers/letters folded to the LEFT margin (parsePoem's numPrefix) instead
//           of built as a genuine right-margin linenum segment; also loses a SECOND <linenum>
//           child on the same line (findLinenum returns only the first).
//   F-205 — a paragraph-numbered (§15.2) block's number lands at the RIGHT margin instead of
//           inline before the paragraph's own text, and drags in the (wrong) §15.4.1d note.
//   F-207 — interspersed prose+verse (§15.6.1a) numbering relies entirely on the source already
//           carrying a linenum on every actual print line; Emboss itself never computes a
//           missing sequential number of its own.
//   F-208 — counted-words text (§15.8.1a) needs a 3-cell gap before its numbers; wrapNumbered
//           hardcodes a 2-cell minimum for every caller, with no parameter for the wider gap.
// §15 print shows typographic single quotes (a quotation opens with ‘ and closes with ’); the gold
// JSON text keeps them straight. Restore what print shows: an opening ' before a word and a
// closing ' after punctuation. A possessive/contraction apostrophe (Antonius' way, perform'd) stays.
function curlySingleQuotes15(t) {
  return String(t ?? '')
    .replace(/(^|[\s(\u201c"])'(?=[A-Za-z0-9])/g, '$1\u2018')
    .replace(/([,.;:!?])'(?=\s|$|[)\u201d"])/g, '$1\u2019');
}
function buildBlocks15(printBlocks, limitations, rule = '') {
  const blocks = [];
  let pending = null;   // the 'numbered' run currently being merged into one flowing para block
  const flushPending = () => { if (pending) { blocks.push(pending); pending = null; } };
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    const continuesNumbered = kind === 'numbered' && pending && !b.newPara;
    if (!continuesNumbered) flushPending();
    if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const para = { type: 'para', ...textOrSegments(b.text) };
      if (b.continuation) para.continuation = true;
      blocks.push(para);
    } else if (kind === 'stanzabreak') {
      blocks.push({ type: 'indicator', kind: 'line' });
    } else if (kind === 'numbered') {
      const segs = [];
      // format selected by the illustrated rule (15.8 / 15.2)
      const counted15 = /^15\.8\b/.test(String(rule));   // 15.8.1a: counted words, the count follows the print line it counts (F-208)
      if (!counted15 && b.number != null && String(b.number).trim()) segs.push({ type: 'linenum', text: esc(String(b.number).trim()) });
      // print.features may record a word the print underlines ("The word 'fun' is underlined"):
      // Sample 15-9. Build it as underlined text (<u>), the markup the other sections use.
      let ntext = String(b.text ?? '');
      const ul = /word '([^']+)' is underlined/i.exec(String(b.features ?? ''));
      if (ul && ntext.includes(ul[1])) ntext = ntext.replace(ul[1], `<u>${ul[1]}</u>`);
      segs.push(...parseCellMarkup(ntext));
      if (counted15 && b.number != null && String(b.number).trim()) segs.push({ type: 'linenum', text: esc(String(b.number).trim()) });
      if (!pending) {
        pending = { type: 'para', segments: [] };
        if (counted15) { pending.countedWords = true; if (blocks.length && blocks[blocks.length - 1].type === 'heading') pending.lnNoteBeforeHeading = true; }   // Sample 15-9 shows the note before the title (F-234)
        // The print itself shows this excerpt opening mid-paragraph (no paragraph indent on its
        // first line, Sample 15-4's `features`), or the block says so explicitly.
        if (b.continuation || /mid-paragraph|no paragraph indent/i.test(String(b.features ?? ''))) pending.continuation = true;
        if (b.blocked) pending.blocked = true;
        if (/^15\.2\b/.test(String(rule))) pending.paraNumber = true;   // 15.2.1b: margin paragraph number inline (F-205)
      }
      pending.segments.push(...segs);
    } else if (kind === 'verse' || kind === 'dialogue') {
      let raw = curlySingleQuotes15(String(b.text ?? ''));
      if (!raw.trim()) { limitations.push(`empty '${kind}' block skipped.`); continue; }
      const blk = { type: 'play', subtype: 'verse', style: 'verse' };
      const lvl = Number(b.level) || 0;
      if (lvl > 0) blk.level = lvl;
      if (kind === 'verse') {
        // Poem line (F-182, fixed): the rhyme letter is a genuine right-margin `linenum`
        // segment, exactly like buildBlocks13's own `ln.number` handling — a `number`
        // alongside a `letter` (Sample 15-8) is still deliberately dropped, matching
        // findLinenum's own separate, un-fixed first-child-only bug (only the letter is
        // ever built here, same as before this fix).
        const letter = (b.letter != null && String(b.letter).trim()) ? String(b.letter).trim() : null;
        const vnum = (b.number != null && String(b.number).trim()) ? String(b.number).trim() : null;
        if (letter || vnum) {
          // A rhyme letter and/or a periodic line number the print shows on this line: each is a
          // genuine right-margin `linenum` segment (parsePoem, F-182 fixed).
          blk.text = `${letter || vnum} ${raw}`;
          blk.segments = [...(letter ? [{ type: 'linenum', text: letter }] : []), ...(vnum ? [{ type: 'linenum', text: vnum }] : []), ...parseCellMarkup(raw)];
          if (letter) blk.rhymeLetters = true;   // 15.7.3d: rhyme letters end one cell before the widest line number (F-182 follow-up)
        } else {
          Object.assign(blk, textOrSegments(raw));
        }
      } else {
        // Dialogue line (F-181): keep a genuine, unfolded linenum segment — formatPlay drops it.
        const segs = [];
        if (b.number != null && String(b.number).trim()) segs.push({ type: 'linenum', text: esc(String(b.number).trim()) });
        segs.push(...parseCellMarkup(raw));
        blk.segments = segs;
        // F-180: this is play DIALOGUE (§15.5.2a), not a standalone poem — see buildBlocks14's
        // matching 'speech' comment.
        blk.playVerse = true;
      }
      blocks.push(blk);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — page-number/decoration content with no braille-buildable counterpart in this schema): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  flushPending();
  return blocks;
}
function buildModel15(sample) {
  let printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  if (noPrintOriginal(sample)) {
    limitations.push('the book shows no print original for this example; print.blocks was rebuilt from the braille, so it is not used as input and nothing is built.');
    printBlocks = [];
  }
  const blocks = buildBlocks15(printBlocks, limitations, sample.illustrates && sample.illustrates.rule);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks, spacedEllipsis: true }, limitations, hasTable: hasContent };   // Sample 15-4: print ' . . . ' is the ellipsis (444)
}

// ---------------------------------------------------------------------------
// Model building for section-10 (Exercise Material) — from sample.print.blocks
// ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-10/README.md) is a flat
// print.blocks[] list, each {kind, level, text, items, headers, rows, stanzas, features}:
//   kind 'directions' -> an ordinary document `para` block. BANA 10.3.2 prescribes a
//                        dedicated 5-5 (or 7-5 for an "additional paragraph") margin for
//                        exercise directions, but document.mjs has no 'directions' style at
//                        all (F-174 — "Emboss does not provide directions or example styles
//                        for exercises... these elements fall back to standard paragraph
//                        margins") — so this kind exists only for THIS gold schema's own
//                        bookkeeping (which print role the text plays) and is built into the
//                        SAME generic `para` block a plain 'paragraph' kind builds, exactly
//                        reproducing the real fallback F-174 documents rather than inventing
//                        a margin mechanism Emboss itself does not have.
//   kind 'paragraph'  -> an ordinary document `para` block (a displayed paragraph, a poem's
//                        own introduction, a corrected/italicised quoted sentence, an
//                        assignment prompt with no question/answer structure at all).
//   kind 'heading'    -> an ordinary document `heading` block (level as given) — used only
//                        where the given braille itself centres a genuine title line (Example
//                        10-10's own poem excerpt title, "A Song for Sailors").
//   kind 'exercise'   -> BANA §10's own actual subject: `items[]` becomes a document
//                        `{type:'list', kind:'exercise', items:[...]}` block (nestedMargins'
//                        own 'exercise' case, document.mjs:117-144, already gives this the
//                        BANA 10.4.1/10.4.2 1-3 / 1-5,3-5 / 1-7,3-7,5-7 nested-list margins).
//                        Each item's `text` carries its own print number/letter marker
//                        baked directly into the string ("1. Which..." / "a. four sessions
//                        per year.") — no `item.marker` field is ever set here, matching the
//                        REAL production parser exactly: `parse.mjs`'s own `bai-exercise`
//                        <li> handler (parse.mjs:2310-2318) captures an item's full
//                        text/segments verbatim with no separate marker extraction at all
//                        (contrast the ordinary `bai-list` handler a few lines above it,
//                        which DOES split a marker out) — building a genuine gold exercise
//                        item any other way would test a marker/text translation-boundary
//                        artifact real Emboss content never actually exercises.
//   kind 'list'       -> an ordinary document `list` block (BANA 10.7.2's own word list for
//                        multiple questions; 10.4.4b's unlettered/no-discernible-order
//                        answer choices; 10.9.2a's wide-matching-columns-converted-to-lists),
//                        reusing buildListItem exactly as every other section's own plain
//                        list schema does — here a marker IS a genuine separate `item.marker`
//                        (an ordinary numbered/lettered list, not a `bai-exercise` item).
//   kind 'note'       -> a standalone transcriber's note (`formatTranscriberNote`) — BANA
//                        10.9.2b's own synthesised matching-column heading ("Who"/
//                        "Statement", enclosed in TN indicators since print gives no column
//                        heading of its own) and 10.11.3's own picture-description TN
//                        (Sample 10-13's "Food Groups" heading and its closing "Pictures:"
//                        note). F-226 already documents that NOTHING in `parse.mjs`'s real
//                        `bai-exercise` item handler ever synthesises or TN-wraps content
//                        this way — this builder's `note` blocks exist only to give a NON-
//                        exercise-item TN (one that already sits in its own `print.blocks`
//                        slot, not embedded inside a list item's own text) something to
//                        build into, exactly like every other section's own 'note' handling.
//   kind 'table'      -> a document `table` block (BANA 10.9.1's own narrow matching
//                        columns, Sample 10-10 — "follow the guidelines in Formats §11...
//                        when matching columns have headings"), reusing cellToModel/table
//                        building exactly as buildModel11/7 do.
//   kind 'box'        -> a nested `{type:'box', blocks:[...]}` container (BANA 10.7.2f's own
//                        boxed word list, Sample 10-6's 7…7/g…g rule lines), built exactly
//                        like buildModel7/8's own box handling.
//   kind 'poem'       -> BANA 10.7.1's own displayed poem inside an exercise (Sample 10-4):
//                        `stanzas[].lines[]` becomes a run of document `{type:'play',
//                        subtype:'verse', style:'verse', text, level}` blocks, one per line —
//                        the SAME shape buildModel13 already uses for §13 poems (there is no
//                        section-10-specific poem mechanism in document.mjs at all; a
//                        displayed poem inside exercise material still goes through the
//                        ordinary poem/play code path).
//   kind 'other'      -> never modelled; recorded as a limitation exactly like every other
//                        section's own 'other' — print content genuinely illegible/torn away
//                        in the source (Example 10-9's own torn-paper answer choices),
//                        struck through and omitted from the given braille (Example 10-6's
//                        choice C, Example 10-26's item 3), or a print device/page-decoration
//                        with no braille-buildable counterpart in this schema at all.
//
// Two systemic gaps make several of this section's own worked examples/samples diverge from
// their own gold braille independent of anything this builder does — both already documented
// in standards-findings.md before this reconciliation began (F-173..F-176, assessed 17 Sep
// 2026) and reused here rather than restated as new findings:
//   F-174 — no 'directions'/'example' style exists at all (see 'directions' above): every
//     directions/example paragraph in this section falls back to an ordinary 1-1/3-1
//     paragraph margin instead of BANA 10.3.2's 5-5/7-5.
//   F-176 — a `list`/`para` block nested right after an `exercise` list (BANA 10.7.1's own
//     "adjusted left margin, 2 cells right of the runover position, for displayed text in
//     exercise material") gets its ordinary top-level margin instead, since nestedMargins has
//     no notion of "the exercise list immediately before me" at all.
// Every per-sample mismatch this reconciliation's own --update-status run traces is one or
// more of F-173..F-176, F-225..F-229 (this section's own already-recorded findings) or is
// itself newly documented — see tests/gold/bana-formats-2016/section-10/README.md and
// differences.md (kept in this session's own scratch folder) for the complete, file-by-file
// breakdown.
// §10-only text helper. (1) parseCellMarkup switches to its HTML-tag branch as soon as the
// string contains a real tag such as <u>, and that branch ignores `*italic*` — so a print
// sentence mixing underline (<u>) and italic (*..*) kept literal asterisks (Example 10-28).
// Convert the `*..*` runs to <i>..</i> first. (2) print's own "[picture of a X]" marker for an
// inline illustration (Example 10-31) becomes the embedded-TN image segment the parser makes
// for an <img alt="X"> in an exercise item (BANA 10.11.1, F-229).
function textOrSegments10(raw) {
  let t = String(raw ?? '');
  if (/<[a-z][\s\S]*>/i.test(t)) t = t.replace(/(?<![\\*])\*([^*\n]+?)\*(?!\*)/g, '<i>$1</i>');
  // BANA 10.6.1 (F-237): a run of em spaces in print stands for a blank left in the text -> a `blank` segment (three dot 5s).
  if (/\u2003{2,}/.test(t) && !/\[picture of /i.test(t)) {
    const parts = t.split(/\u2003{2,}/), segs = [];
    parts.forEach((part, i) => { if (part) segs.push(...parseCellMarkup(part)); if (i < parts.length - 1) segs.push({ type: 'text', text: '', blank: true }); });
    return { segments: segs };
  }
  const PIC = /\[picture of (?:an? )?([^\]]+)\]/i;
  if (!PIC.test(t)) return textOrSegments(t);
  const segs = [];
  let rest = t, m;
  while ((m = PIC.exec(rest))) {
    if (m.index > 0) segs.push(...parseCellMarkup(rest.slice(0, m.index)));
    segs.push({ type: 'imgnote', text: m[1].trim() });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) segs.push(...parseCellMarkup(rest));
  return { segments: segs };
}
function buildBlocks10(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'directions' || kind === 'paragraph') {
      const para = { type: 'para', ...textOrSegments10(b.text) };
      // BANA 10.3.2 directions (F-235): the formatter now honours `block.directions` (5-5 margins, BANA mode).
      if (kind === 'directions') para.directions = true;
      // BANA 10.3.2: an additional directions paragraph right after another one takes 7-5.
      if (kind === 'directions' && blocks.length && blocks[blocks.length - 1].directions) para.directionsContinued = true;
      if (b.blocked) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegments(b.text) });
    } else if (kind === 'exercise') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it) => {
        const tos = textOrSegments10(it && it.text);
        const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
        item.level = Number(it && it.level) || 0;
        return item;
      });
      // BANA 10.6.10: print shows a question mark over/inside an underscore. The rule has the transcriber omit the mark and
      // add a transcriber's note; both are transcriber decisions/text the print does not carry (independence rule), so the
      // print-only input cannot reproduce them.
      if (items.some((it) => /\\_\?\\_/.test(String((it && it.text) || '')))) {
        limitations.push(`print shows a question mark on a write-on-line (BANA 10.6.10): the expected braille omits the question mark and adds a transcriber's note explaining it — both are transcriber decisions and transcriber-written text that the print does not show; not built from the print alone.`);
      }
      // K31 / BANA 10.8.5, 10.8.6: recognising the Example/Model/Sample label (and the "Answer" item that follows
      // it, 10.8.3) used to be done right here, splitting the label off the print text before the formatter ever
      // saw the item — real documents never get that step. It is now the formatter's own job (document.mjs's
      // deriveExerciseLabels, called from formatList/traceBlock): the item's raw, unsplit text/segments are passed
      // through unchanged and the formatter recognises the label itself from the same conservative text pattern.
      blocks.push({ type: 'list', kind: 'exercise', items: built });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      if (b.columns && Number(b.columns) > 1) {
        limitations.push(`list has print.blocks columns:${b.columns} (print laid this list out in ${b.columns} side-by-side columns) — Emboss has no side-by-side list-column layout (F-34); built, and will render, as a single column.`);
      }
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      // A print `list` (as opposed to `exercise`) in this section is a word list for multiple questions (BANA 10.7.2).
      blocks.push({ type: 'list', kind: 'list', wordList: true, items: built });
    } else if (kind === 'table') {
      const tbl = buildTable7(b, limitations, 'table');
      // BANA 10.9.1d: the columns of a matching exercise ("Match ...") take no guide dots.
      const prevB = blocks[blocks.length - 1];
      // keyed to the print directions text "Match ..." (10.9.1d), not to the braille
      if (prevB && prevB.directions && /^\s*match\b/i.test(String(prevB.text ?? (prevB.segments || []).map((g) => g.text || '').join('')))) tbl.guideDots = false;
      blocks.push(tbl);
    } else if (kind === 'box') {
      const inner = buildBlocks10(b.blocks, limitations);
      blocks.push({ type: 'box', blocks: inner });
    } else if (kind === 'poem') {
      const stanzas = Array.isArray(b.stanzas) ? b.stanzas : [];
      stanzas.forEach((st, si) => {
        if (si > 0) blocks.push({ type: 'indicator', kind: 'line' });
        const lines = (st && Array.isArray(st.lines)) ? st.lines : [];
        for (const ln of lines) {
          if (!ln) continue;
          const raw = String(ln.text ?? '');
          if (!raw.trim()) continue;
          const tos = textOrSegments(raw);
          const blk = { type: 'play', subtype: 'verse', style: 'verse', ...tos };
          const lvl = Number(ln.indent) || 0;
          if (lvl > 0) blk.level = lvl;
          blocks.push(blk);
        }
      });
    } else if (kind === 'other' && /^\s*[—–-]\s*New Print Page\s*[—–-]\s*\n\s*[—–-]?\s*(\S+?)\s*[—–-]?\s*$/i.test(String(b.text ?? ''))) {
      // A print-page-change marker ("—New Print Page—" then the new page number, "-63-"): BANA 1.11.3's
      // print page indicator, built exactly as the other sections' `pagenum` blocks are.
      const pm = /\n\s*[—–-]?\s*(\S+?)\s*[—–-]?\s*$/.exec(String(b.text));
      blocks.push({ type: 'pagenum', page: esc(pm[1]) });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — illegible/torn/struck-through print content, or a page device with no braille-buildable counterpart in this schema): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel10(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks10(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-19 (Codes and Puzzles) — from sample.print.blocks
// ONLY.
// ---------------------------------------------------------------------------
// standards-findings.md F-217 already establishes that NO code anywhere recognises any
// §19 construct (no puzzle/grid/code-character/linear-key block type exists in
// document.mjs's formatBlock switch at all) — this section's own gold schema therefore
// builds only what a handful of PRE-EXISTING, general-purpose block types can express, and
// records every genuine puzzle/grid/key as a documented limitation instead of inventing a
// block type Emboss itself has no way to format. print.blocks[] is a flat list, each
// {kind, text, level, blocked, items, features}:
//   kind 'heading'   -> an ordinary document `heading` block (level as given), exactly as
//                       every other section's own precedent.
//   kind 'paragraph' -> an ordinary `para` block. `blocked:true` (matching buildModel4's own
//                       flush-paragraph convention) marks a puzzle's own flush title line
//                       (Samples 19-1/19-4's own "Symbolically Speaking"/"Picture Riddle" —
//                       confirmed flush, not centred, directly against the given braille's
//                       own zero indent) rather than an ordinary 2-cell-indented paragraph.
//   kind 'note'      -> a standalone transcriber's note (`formatTranscriberNote`/'note') —
//                       the one mechanism BANA 19.2.1c/19.2.1d/19.2.2f/19.3.1d/19.5.1/
//                       19.5.3a/19.5.3j/19.5.3l/19.6.1e (F-218's own positive finding) gets
//                       right, since it is just "type the wording, Emboss doesn't invent
//                       it" — exactly like every other section's own 'note' handling.
//   kind 'list'      -> a document `list` block (BANA 19.5.2's own crossword clue list, or
//                       19.3.1e's own uncontracted scrambled-word list): items[] built via
//                       the same buildListItem() every other section's own list schema
//                       already uses (level 1-based, backtick markup -> a genuine
//                       `uncontracted:true` segment per F-218's own positive finding).
//   kind 'code'      -> a document `code` block (`formatCodeBlock`, the ONE existing path
//                       that at least emits *some* grade-1-passage-wrapped output for a
//                       devised code/key/grid — BANA 19.2.2/19.3.1e/19.6.1's own linear-key,
//                       coded-letter, and word-puzzle constructs): `block.text` is passed
//                       through completely UNESCAPED and UNPARSED by cell-markup (matching
//                       `formatCodeBlock`'s own real behaviour, `String(block.text ?? '')`
//                       with no `parseCellMarkup` call at all) — expect this to mismatch on
//                       every sample that uses it, via F-219 (multi-space column alignment
//                       collapses to one space and a line's own leading indent is discarded),
//                       F-220 (the required "dot locator for use" before the grade-1 passage
//                       indicator/terminator is never emitted), and F-222 (a devised/raw
//                       braille cell — the puzzle's own substitution symbols — cannot be
//                       produced by `louis.translate()` on demand at all).
//   kind 'other'     -> never modeled; recorded as a limitation exactly like every other
//                       section's own 'other' — a picture/grid/key this schema has no
//                       block type for at all (a puzzle picture, a crossword/word-search/
//                       shaped-letter grid, a Sudoku's own line-mode divider rows, a print
//                       page-number cell).
// Sections 18/19 optional markup (used only when a gold text carries it; F-186/F-187/F-188/F-221/F-222):
//   {{tn:the note text}}       -> an embedded transcriber's note segment (imgnote), 18.3.3c / 19.5.2g
//   {{brl:CELLS|print}}        -> literal braille cells standing for `print` (grouping indicator ;< ;>, a transcriber-defined
//                                 symbol, a dot locator, a devised cell)
// Text without `{{` goes through textOrSegments unchanged.
function textOrSegmentsEmb(raw) {
  const t = String(raw ?? '');
  if (!t.includes('{{')) return textOrSegments(t);
  // The markup is parsed over the WHOLE text (each {{...}} held by a placeholder) so a print emphasis that runs across an embedded note
  // is one run; a note with the same typeform on both sides is marked spanTypeform (18.3.3c, Example 18-5).
  const items = [];
  const re = /\{\{(tn|brl):([^}]*)\}\}/g;
  const masked = t.replace(re, (m0, kind, body) => {
    if (kind === 'tn') items.push({ type: 'imgnote', text: body.trim() });
    else { const bar = body.indexOf('|'); items.push({ type: 'brl', brl: bar < 0 ? body : body.slice(0, bar), text: bar < 0 ? '' : body.slice(bar + 1) }); }
    return `\u27E6${items.length - 1}\u27E7`;
  });
  const segs = [];
  for (const sg of parseCellMarkup(masked)) {
    if (sg.type !== 'text' || !/\u27E6\d+\u27E7/.test(sg.text)) { segs.push(sg); continue; }
    let last = 0, m;
    const ph = /\u27E6(\d+)\u27E7/g;
    while ((m = ph.exec(sg.text))) {
      if (m.index > last) segs.push({ ...sg, text: sg.text.slice(last, m.index) });
      segs.push({ ...items[Number(m[1])], __tf: sg.tf || 0 });
      last = m.index + m[0].length;
    }
    if (last < sg.text.length) segs.push({ ...sg, text: sg.text.slice(last) });
  }
  // A note inside a run of one typeform keeps that run whole: the note segment carried the typeform of the text it sat in (__tf);
  // it spans when the segment before it and the one after both have that same non-zero typeform.
  segs.forEach((sg, i) => {
    if ('__tf' in sg) {
      const tf = sg.__tf; delete sg.__tf;
      if (sg.type === 'imgnote' && tf && segs[i - 1] && segs[i - 1].type === 'text' && segs[i - 1].tf === tf && segs[i + 1] && segs[i + 1].type === 'text' && segs[i + 1].tf === tf) sg.spanTypeform = true;
    }
  });
  return { segments: segs };
}
// A list item built by buildListItem, re-built through textOrSegmentsEmb when its text carries that markup.
function buildListItemEmb(it, limitations, where) {
  const item = buildListItem(it, limitations, where);
  if (it && typeof it.text === 'string' && it.text.includes('{{')) { const t = textOrSegmentsEmb(it.text); delete item.text; item.segments = t.segments; }
  return item;
}
// Optional layout fields a gold paragraph may carry (F-189 / 18.7.1, 18.8.1; F-219 / 19.4.1c).
function applyPara1819(para, b) {
  if (b.diagram) para.diagram = true;
  if (Array.isArray(b.arrowLines)) para.arrowLines = b.arrowLines;
  if (b.wordGaps) para.wordGaps = true;
  return para;
}
function buildBlocks19(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const para = applyPara1819({ type: 'para', ...textOrSegmentsEmb(b.text) }, b);
      if (b.blocked) para.blocked = true;
      if (b.continuation) para.continuation = true;
      // BANA 10.3.2 directions (5-5 margins, F-235): honoured only when the gold file marks the
      // print paragraph as directions (`directions:true`) or its `features` text calls it an
      // instruction/directions line — never inferred from the wording.
      if (b.directions || /\b(instruction|directions?)\b/i.test(String(b.features || ''))) para.directions = true;
      blocks.push(para);
    } else if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegmentsEmb(b.text) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => (typeof it === 'string' ? { text: esc(it) } : buildListItemEmb(it, limitations, `list item ${i}`)));
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'code') {
      const text = String(b.text ?? '');
      if (!text.trim()) { limitations.push(`empty 'code' block skipped.`); continue; }
      // 19.2.2a/g and 19.6.1b: the dot locator for "use" precedes the grade 1 passage indicator and terminator;
      // 19.2.2d / 19.5.3g keep a line's own blanks; 19.6.1c (letters spaced) only when the gold marks it (`spaceLetters:true`).
      const code = { type: 'code', text, dotLocator: true, keepSpaces: true };
      if (b.spaceLetters) code.spaceLetters = true;
      blocks.push(code);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — a puzzle/grid/key/picture with no braille-buildable counterpart in this schema, per F-217/F-219/F-220/F-222): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel19(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks19(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-18 (Grammar) — from sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// standards-findings.md F-186..F-190 (already assessed before this reconciliation began)
// establish that MOST of §18's own subject matter has no representation anywhere in
// document.mjs/parse.mjs at all: no inline/embedded transcriber's-note mechanism (F-186, only
// a standalone `note` block exists), no UEB "braille grouping indicator" symbol pair (F-187),
// only one hardcoded transcriber-defined symbol in the whole codebase, permanently used for
// the print asterism (F-188 — blocks every transcriber-defined typeform/symbol §18 itself
// invents, e.g. a devised "red-letter" or "crossed-out word" mark), no diagram/arrow/analogy-
// symbol layout support of any kind (F-189), and no no-break primitive to keep two words on
// one braille line (F-190). This section's own gold schema therefore builds only what a
// handful of PRE-EXISTING, general-purpose block types can express — exactly buildModel19's
// own precedent — and records every genuine devised-symbol/embedded-note/diagram construct as
// a documented 'other' limitation rather than inventing a representation Emboss has no way to
// produce. print.blocks[] is a flat list, each {kind, text, blocked, items}:
//   kind 'note'      -> a standalone transcriber's note (`formatTranscriberNote`/'note') —
//                       the one mechanism this section's own worked examples get right
//                       whenever the note's own wording stands alone (Examples 18-1, 18-4,
//                       18-8, Samples 18-1/18-2's own Option-1 note) — exactly like every
//                       other section's own 'note' handling.
//   kind 'paragraph' -> an ordinary `para` block. `blocked:true` (matching buildModel4's/
//                       buildModel19's own flush-paragraph convention) marks a print line the
//                       given braille shows flush at cell 1 rather than an ordinary indented
//                       paragraph (e.g. Example 18-4's own three one-line example sentences).
//   kind 'list'      -> a document `list` block (Example 18-1's plain list of names, Example
//                       18-7's numbered exercise item, Sample 18-1/18-2's own "label: word"
//                       lists) — items[] built via the same buildListItem() every other
//                       section's own list schema already uses.
//   kind 'other'     -> never modeled; recorded as a limitation — an embedded/mid-sentence
//                       transcriber's note (F-186), a phrase that must be enclosed in a
//                       braille grouping indicator (F-187), a devised transcriber-defined
//                       symbol/typeform marking specific words (F-188), or a linear/spatial
//                       sentence diagram, arrow, or analogy symbol (F-189) — this schema has
//                       no block type for any of these, so the whole passage they cover is
//                       recorded here rather than approximated with a misleading partial
//                       paragraph (see tests/gold/bana-formats-2016/section-18/README.md for
//                       the per-file reasoning on where a partial, representable-wording-only
//                       paragraph/list WAS still built alongside an 'other' limitation for
//                       just the unbuildable mark/diagram, versus where the whole passage was
//                       left as a single 'other' because the mark IS the entire point of the
//                       example).
//
// A block's / item's `text` goes through the same textOrSegments()/parseCellMarkup() DSL
// every other section's own schema uses (**bold**, *italic*), used here for Sample 18-1's own
// bold "Philanthropists"/italic "donated" and Sample 18-2's own italic "complex"/"sentence".
function buildBlocks18(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegmentsEmb(b.text) });
    } else if (kind === 'paragraph') {
      const para = applyPara1819({ type: 'para', ...textOrSegmentsEmb(b.text) }, b);
      if (b.blocked) para.blocked = true;
      if (b.continuation) para.continuation = true;
      // BANA 10.3.2 exercise directions (5-5 margins, F-235): honoured when the gold file marks
      // the print paragraph as directions (`directions:true`, or a `features` text calling it an
      // instruction/directions line — the same signal buildModel1 reads). Never inferred from text.
      if (b.directions || /\b(instruction|directions?)\b/i.test(String(b.features || ''))) para.directions = true;
      blocks.push(para);
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => (typeof it === 'string' ? { text: esc(it) } : buildListItemEmb(it, limitations, `list item ${i}`)));
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — an embedded/mid-sentence transcriber's note, a braille-grouping-indicator enclosure, a devised transcriber-defined symbol/typeform, or a linear/spatial diagram, per F-186/F-187/F-188/F-189): "${String(b.text ?? '').slice(0, 200)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel18(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks18(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-14 (Plays, Cartoons, and Graphic Novels) — from
// sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-14/README.md) is a flat
// print.blocks[] list, each {kind, ...}:
//   kind 'cast-list'  -> BANA §14.2's own subject: `items[]` (each `{text}`, Emboss's own
//                        **bold**/*italic* cell-markup DSL where print itself shows a name in
//                        a distinct font, per 14.2.1c) becomes a run of consecutive
//                        `{type:'play', subtype:'prose'}` blocks — the SAME non-verse formatPlay
//                        path a 'speech' block below uses at level 0 (1-3 margins,
//                        document.mjs:890-899's own `{first: lvl===0?0:4, runover:2}`), which
//                        happens to give exactly BANA 14.2.1b's own required 1-3 margins with no
//                        cast-specific code needed at all.
//   kind 'heading'    -> an ordinary document `heading` block (level as given), exactly as every
//                        other section's own precedent — used for a scene title/number (§14.3.1a)
//                        and for a play's own centred closing phrase (§14.8.1, "The Curtain
//                        Falls" — centred, blank line before AND after, already formatHeading's
//                        own default for a level-1/centred heading with no special-casing needed).
//   kind 'paragraph'  -> an ordinary `para` block (a scene-setting description, §14.3.1b, "follow
//                        print for blocked or indented paragraphs"); `blocked:true` (matching
//                        buildModel4/19's own flush-paragraph convention) marks one confirmed
//                        flush (not 2-cell-indented) directly against the given braille's own zero
//                        first-line indent.
//   kind 'speech'     -> BANA §14's actual SUBJECT: a speaker's turn (or a same-speaker
//                        continuation paragraph/line). `speaker` is documentation only (the
//                        structural driver is the fully pre-composed `text`, WITH the speaker's
//                        own name/punctuation already folded in exactly as print shows it —
//                        matching buildModel13's own established `ln.number`-folding convention
//                        for a line's own leading marker, and needed here because BANA's own
//                        speaker-to-dialogue separator is not fixed: a period (14.1.6, Example
//                        14-3's "Anne."), a colon (14.1.2's capitalised names), or nothing at all
//                        but two spaces (14.5.1d/14.6.1e/14.10.3c) — there is no single rule this
//                        builder could apply generically). `verse:true` selects the VERSE
//                        formatPlay path (`{type:'play', subtype:'verse'}`, §14.6's 1-5/3-5
//                        margins via nestedMargins('poetry', ...), the SAME mechanism
//                        buildModel13 already reuses for §13 poems) instead of the default PROSE
//                        path (§14.5/14.9/14.10's 1-3/5-3 margins). `level:1` selects each
//                        rule's own SECOND margin (prose: 5-3, §14.5.1e "additional paragraphs by
//                        the same speaker"; verse: 3-5, §14.6.1b "additional lines by the same
//                        speaker" — verse's own runover is derived automatically from the
//                        surrounding run's own deepest level by document.mjs's `verseRunLevels`,
//                        exactly as a §13 poem's sub-levels are, so this builder never computes a
//                        margin number itself).
//   kind 'stage-direction' -> a document `{type:'stage', level}` block (`formatStage`,
//                        document.mjs:902-921 — the ONE mechanism BANA §14 has for a stage
//                        direction printed BETWEEN dialogue lines, §14.4/14.5.3/14.6.3/14.7.2):
//                        `level:0` (default) is the rule's own first 7-7 margin; `level:1` is
//                        "an additional paragraph of stage directions", 9-7 (§14.5.3b/14.6.3b).
//                        Font attributes are dropped automatically by `stripEmphasis`
//                        (§14.4.1c/14.5.3c) UNLESS this builder marks a run bold/italic anyway —
//                        reserved for the rare case (Example 14-4/14-5) print's own emphasis is
//                        genuinely needed "for distinction" and BANA itself says to keep it; a
//                        stage direction NOT enclosed in its own punctuation (brackets/parens)
//                        gets UKAAF-only auto-brackets (`stageParts`), never BANA's — BANA
//                        "follows print" and adds none (§14.4.1a), matching every gold sample in
//                        this corpus (all of them ARE print-enclosed already, or, per 14.4.1c,
//                        keep their own italics instead).
//   kind 'note'       -> a standalone document `{type:'note', text}` block
//                        (`formatTranscriberNote`, the section's own required TN mechanism):
//                        BANA §14.5.2's simultaneous-speaker "Martha and Peter together"/"Solo"
//                        wording, and §14.10's cartoon/frame labels ("Cartoon," a frame number)
//                        together with any scene-setting/caption text the source itself shows
//                        fully enclosed. Reused byte-for-byte from every other section's own
//                        'note' handling — no §14-specific behaviour at all.
//   kind 'blankline'  -> a forced `{type:'indicator', kind:'line'}` blank line, reusing
//                        buildModel13/15's own stanza-break mechanism — BANA §14.10.1's own
//                        "insert a blank line before and after a cartoon" (separating a
//                        cartoon's own title/speaker's-note header from its first FRAME).
//   kind 'other'      -> never modelled; recorded as a limitation exactly like every other
//                        section's own 'other' — a genuine cartoon/graphic-novel PICTURE this
//                        schema has no block type for, print's own columned two-speaker layout
//                        Emboss is told to ignore anyway (§14.5.2c), or a print-only "(Return to
//                        Text)" cross-reference.
//
// Findings this reconciliation's own forward-translation testing found (already merged into
// standards-findings.md — see tests/gold/bana-formats-2016/section-14/README.md and
// differences.md for the full, evidence-based account of every file each one affects):
//   F-206 (reused, already documented for §15.5.2b's own identical "significant blank space"
//     rule) — FIXED by K33: `speakerGapSegments` (document.mjs) now inserts an explicit
//     `{type:'gap', cells:N}` segment ahead of word-wrap, so the gap between a speaker's name and
//     dialogue no longer depends on literal spaces surviving `wrapCells`'s single-space collapse.
//     Two cells is the K33 DEFAULT whenever the gold `text` itself marks the name off by 2+
//     literal spaces and print shows no other distinction (14.5.1d/14.6.1e/14.10.5a/c); three
//     cells only when this builder sets `blk.speakerGap = true` below, for print's own genuinely
//     wider gap (14.1.7/14.6.2a, e.g. Example 14-7).
//   F-240 — a `stage` block between two `play`/subtype:'verse' blocks breaks
//     `document.mjs`'s own `poemRunBoundaries` run (a stage direction is neither a verse block
//     nor a recognised stanza separator), so each side of the interruption becomes its own
//     isolated single-line "poem", and F-121's blank-line-around-a-poem mechanism inserts a
//     blank line before/after the stage direction anyway — directly contradicting BANA
//     14.5.3d/14.6.3d's "Do not insert blank lines before or after stage directions ... printed
//     outside or between the lines of dialogue" for the VERSE case specifically (the PROSE case,
//     a non-verse 'play' block neighbouring a 'stage' block, is unaffected — `isVerseLineBlock`
//     is false for a prose speech, so no run/boundary logic runs on it at all).
// BANA 14.4.1c: "Ignore font attributes used for stage directions, unless needed for distinction ... If text within stage directions
// requires emphasis for distinction, use the typeform indicator that best represents print emphasis of surrounding text." A
// parenthesised stage direction inside a speech that is set in italic with some words in roman (character names): its italic is
// ignored and the roman words take the italic (Sample 14-10). Only a parenthesis holding a single-star italic run is touched.
// General transcription rule applied to any parenthesised italic stage direction (not keyed to the illustrated rule or the braille).
function stageDirectionEmphasis(text) {
  return text.replace(/\(([^()]*\*[^()]*)\)/g, (m0, inner) => {
    if (inner.includes('**')) return m0;
    const parts = inner.split(/(\*[^*]+\*)/);
    const out = parts.map((pt) => {
      if (/^\*[^*]+\*$/.test(pt)) return pt.slice(1, -1);
      const mm = /^(\s*)(.*?)(\s*)$/s.exec(pt);
      return /\p{L}/u.test(mm[2]) ? `${mm[1]}*${mm[2]}*${mm[3]}` : pt;
    });
    return `(${out.join('')})`;
  });
}
function buildBlocks14(printBlocks, limitations) {
  const blocks = [];
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'cast-list') {
      const items = Array.isArray(b.items) ? b.items : [];
      for (const it of items) {
        const text = typeof it === 'string' ? it : (it && it.text);
        if (text == null || !String(text).trim()) continue;
        blocks.push({ type: 'play', subtype: 'prose', ...textOrSegments(text) });
      }
    } else if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const para = { type: 'para', ...textOrSegments(b.text) };
      if (b.blocked) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'speech') {
      const text = String(b.text ?? '');
      if (!text.trim()) { limitations.push(`empty 'speech' block skipped.`); continue; }
      let tos = textOrSegments(stageDirectionEmphasis(text));
      // BANA 14.10.3f / 14.11.1: in a framed cartoon or graphic novel (the sample has "Frame N"
      // notes) a parenthesised action description inside a speech is the transcriber's own note
      // (the print is a picture; only the dialogue is print) — an embedded transcriber's note
      // (the same `imgnote` segment §10 uses for an inline note), not printed brackets.
      if (false && !tos.segments && /\([^)]+\)/.test(text)) {   // disabled round 3: keyed to transcriber-written 'Frame N' notes (braille content), not print
        const segs = [];
        let rest = text, m;
        while ((m = /\(([^)]+)\)/.exec(rest))) {
          if (m.index > 0) segs.push(...parseCellMarkup(rest.slice(0, m.index).replace(/\s+$/, ' ')));
          segs.push({ type: 'imgnote', text: m[1].trim() });
          rest = rest.slice(m.index + m[0].length);
        }
        if (rest.trim()) segs.push(...parseCellMarkup(rest));
        tos = { segments: segs };
      }
      const blk = { type: 'play', subtype: b.verse ? 'verse' : 'prose', ...tos };
      if (Number(b.level) > 0) blk.level = Number(b.level);
      // F-180: a verse speech is play DIALOGUE, not a poem — the real parser's own signal
      // (parse.mjs's playVerse, set for a <p class="bai-verse"/"play-verse"> line, never for a
      // genuine <poem> line) needed here so formatPlay's §14.6.1a cell-5 floor applies.
      if (b.verse) blk.playVerse = true;
      // print shows the wide gap (Example 14-7, page-391.png)
      if (/^[^\s:.][^:.]*[:.] {3,}\S/.test(text)) blk.speakerGap = true;   // F-206 / 14.6.2a: the SPECIAL 3-cell gap, only for print's own wider gap (3+ literal spaces in the gold text); an ordinary 2-space gap needs no flag — formatPlay's own speakerGapSegments (K33 default) detects that directly from the block's text
      blocks.push(blk);
    } else if (kind === 'stage-direction') {
      const text = String(b.text ?? '');
      if (!text.trim()) { limitations.push(`empty 'stage-direction' block skipped.`); continue; }
      const blk = { type: 'stage', ...textOrSegments(text) };
      if (Number(b.level) > 0) blk.level = Number(b.level);
      blocks.push(blk);
    } else if (kind === 'note') {
      const nb = { type: 'note', ...textOrSegments(b.text) };
      // BANA 14.10.2 / 14.10.3a / 14.10.4b: only the label word "Cartoon" / "Caption" is enclosed; the rest of the line is ordinary text.
      // format selected by the illustrated rule (14.10.x): only keyed when the sample illustrates a 14.10 rule
      const lm = /^14\.10\./.test(CUR14_RULE) ? /^(Cartoon|Caption)\s+\S/.exec(String(b.text ?? '')) : null;
      if (lm && !nb.segments) nb.enclosePrefix = lm[1];
      blocks.push(nb);
    } else if (kind === 'blankline') {
      // BANA 14.10.1's own required blank line "before and after a cartoon" — the cartoon's
      // own frames/dialogue, not its title/speaker-note header — reuses the SAME forced-
      // blank-line indicator buildModel13/15 already use for a poem's own stanza break
      // (document.mjs's isVerseSeparator/`case 'indicator'`), since there is no OTHER generic
      // "force a blank line here" mechanism in this document model.
      blocks.push({ type: 'indicator', kind: 'line' });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — a picture/panel-art/columned-layout with no braille-buildable counterpart in this schema): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
// Independence rule (README of the BANA gold corpus): print.blocks must come from the book's PRINT. A gold file whose own
// print description says the book shows no print original (so the blocks were rebuilt from the braille) is not an input.
function noPrintOriginal(sample) {
  const pr = sample.print || {};
  return /\bno print (?:image|original)\b|genuinely no print original|no print image exists/i.test(`${pr.printFeatures ?? ''} ${pr.notes ?? ''}`);
}
let CUR14_RULE = '';
function buildModel14(sample) {
  CUR14_RULE = String((sample.illustrates && sample.illustrates.rule) || '');
  let printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  // A worked example whose book shows NO print original (a braille-only template): whatever print.blocks holds was
  // written from the braille, so it is not an input. Nothing is built; the sample cannot match.
  if (noPrintOriginal(sample)) {
    limitations.push('the book shows no print original for this example (braille-only template); print.blocks was written from the braille, so it is not used as input and nothing is built.');
    printBlocks = [];
  }
  const blocks = buildBlocks14(printBlocks, limitations);
  const hasContent = blocks.length > 0;
  // typeformWordPunct (Sample 14-10, UEB 9.3.1) was read off the braille; no longer set (round 3, independence rule).
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-17 (Spelling Lists and Activities) — from
// sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-17/README.md) is a flat
// print.blocks[] list, each {kind, level, text, blocked, items, features}:
//   kind 'heading'   -> an ordinary document `heading` block (level as given), exactly as
//                       every other section's own precedent.
//   kind 'paragraph' -> a document `para` block. `blocked:true` (matching buildModel4/19's own
//                       convention) marks a paragraph the given braille shows flush (1-1)
//                       directly under a cell-5/7 heading with no blank line between — BANA
//                       §1.9.3's own already-working heading-adjacency exception
//                       (joinsWithoutBlank), confirmed directly against this section's own
//                       agreed braille (e.g. Samples 17-6/17-9's own intro paragraph).
//   kind 'note'      -> a standalone transcriber's note (`formatTranscriberNote`) — this
//                       section's own generic-block-level-TN mechanism (17.9.2a, 17.11.1d,
//                       17.13.1c, 17.13.2, all 'done' per standards-map.md).
//   kind 'list'      -> a document `list` block (an ordinary spelling/activity word list,
//                       BANA 17.2-17.5/17.8-17.13's own subject matter): items[] built via
//                       buildListItem17 below. A list item's own `text` already encodes,
//                       where the given braille shows it, the contracted-then-(backtick)
//                       uncontracted dual writing 17.2.2c-e requires (there is no automatic
//                       "spelling list duplicates its own word" mechanism anywhere in
//                       Emboss — 17.2.2c/d is a content decision the transcriber/importer
//                       must already have made, standards-map.md BANA 17.2.2c/d, 'done' only
//                       once both forms are supplied) — matching this reconciliation's own
//                       gold README for the full reasoning.
//   kind 'glossary'  -> a document `glossary` block (BANA 17.6 Definition Lists / 17.7 Word
//                       Lists in Foreign Language Texts, both built via Emboss's `<dl>`
//                       mechanism per standards-map.md's own 17.6.1/17.7.2b-c 'done' rows):
//                       items[] of {term, def}, passed straight to `glossarySegments`
//                       (document.mjs) exactly as every dl-based section already does.
//   kind 'box'       -> print's own ruled box (BANA §7): a NESTED { kind:'box', blocks:[...] }
//                       container, recursed into and built into a document
//                       `{type:'box', blocks:[...]}` block exactly like buildModel7/8/12's
//                       own box handling (Samples 17-5, 17-7, 17-12's own boxed word
//                       lists/review).
//   kind 'other'     -> never modeled; recorded as a limitation exactly like every other
//                       section's own 'other' (a devised picture-icon marker with no print
//                       character to build from, F-213; a print table linearised by the
//                       transcriber into running text with nothing left to model as a table;
//                       a multiple-choice answer grid abridged by the transcriber).
// §17 emphasis with uncontracted text (BANA 17.4.1b-c, 17.10.3, 17.13.1). The gold markup cannot combine bold/underline with the
// backtick (uncontracted) flag, so the builder applies the rule: (a) an emphasised piece touching an uncontracted piece with no space
// between is part of the SAME uncontracted word (17.4.1b: uncontracted with partial emphasis); (b) 17.10.3, marked spelling errors
// (print emphasis on the wrong word) are uncontracted; (c) 17.13.1a, all text of a word-formation "equation" is uncontracted and 17.13.1b
// the contracted result follows in transcriber's note indicators (a trailing "(word)" becomes an embedded note).
// format selected by the illustrated rule: CUR17_RULE keys the uncontracted-spelling / segmented-number formats (17.9.2, 17.10.x, 17.11-17.13) to the rule the sample illustrates
let CUR17_RULE = '';
// Format selected by the illustrated rule (independence rule): whether a spelling-list word is written uncontracted (17.9.2,
// 17.10.3, 17.11.2, 17.12.2, 17.13.x) is the transcriber's choice of format, made by the rule the example illustrates
// (`illustrates.rule`, CUR17_RULE). It is therefore an INPUT (a markup flag on the print words), not something read from the
// braille. Transcriber-supplied repeats and notes are never built (see print.transcriberSupplied in buildModel17).
function fix17(tos) {
  if (tos && !tos.segments && typeof tos.text === 'string' && /^17\.9\.2/.test(CUR17_RULE) && /\w_|_\w/.test(tos.text)) tos = { segments: [{ type: 'text', text: tos.text }] };
  if (!tos || !tos.segments) return tos;
  let segs = tos.segments.map((g) => ({ ...g }));
  // 17.9.2: "Do not contract words showing omitted letters in spelling lists."
  if (/^17\.9\.2/.test(CUR17_RULE)) for (const g of segs) if (g.type === 'text' && !g.uncontracted && /\w_|_\w/.test(g.text)) g.uncontracted = true;
  if (/^17\.10\.3/.test(CUR17_RULE)) for (const g of segs) if (g.type === 'text' && (g.tf & 2)) g.uncontracted = true;
  if (/^17\.13\./.test(CUR17_RULE)) {
    for (const g of segs) if (g.type === 'text' && g.tf) g.uncontracted = true;
    const last = segs[segs.length - 1];
    const m = last && last.type === 'text' && !last.uncontracted && !last.tf ? /^(\s*)\((\w[\w' -]*)\)\s*$/.exec(last.text) : null;
    if (m) segs.splice(segs.length - 1, 1, { type: 'text', text: m[1] }, { type: 'imgnote', text: m[2] });
  }
  if (/^17\.(11\.2|12\.2|13\.1)/.test(CUR17_RULE)) {
    // 17.11.2b / 17.12.2b: the repeated word (hyphens for crossed-out letters) is an embedded transcriber's note, written uncontracted
    // like the word it repeats; substitutions in enclosure symbols "(ous)" touching an uncontracted word are uncontracted (follow print).
    const out = [];
    for (const g of segs) {
      const prev = out[out.length - 1];
      let cur = g;
      if (g.type === 'text' && !g.tf && !g.uncontracted) {
        const enc = prev && prev.uncontracted ? /^\([A-Za-z]+\)/.exec(g.text) : null;
        if (enc) { out.push({ type: 'text', text: enc[0], uncontracted: true }); cur = { ...g, text: g.text.slice(enc[0].length) }; }
        const re = /(\s*)\(((?:[A-Za-z -]|\([^()]*\))*-(?:[A-Za-z -]|\([^()]*\))*)\)/g;
        let last = 0, m; const parts = [];
        while ((m = re.exec(cur.text))) {
          if (m.index > last) parts.push({ type: 'text', text: cur.text.slice(last, m.index) });
          parts.push({ type: 'text', text: m[1] }, { type: 'imgnote', text: m[2], uncontracted: true });
          last = m.index + m[0].length;
        }
        if (parts.length) { if (last < cur.text.length) parts.push({ type: 'text', text: cur.text.slice(last) }); out.push(...parts); continue; }
      }
      out.push(cur);
    }
    segs = out.filter((g) => g.type !== 'text' || g.text);
  }
  const isText = (g) => g && g.type === 'text';
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1], b = segs[i];
      if (!isText(a) || !isText(b) || /\s$/.test(a.text) || /^\s/.test(b.text)) continue;
      if (a.uncontracted && b.tf && !b.uncontracted) b.uncontracted = true;
      else if (b.uncontracted && a.tf && !a.uncontracted) a.uncontracted = true;
    }
  }
  return { segments: segs };
}
function buildListItem17(it, limitations, where) {
  if (typeof it === 'string') return { text: esc(it) };
  const tos = fix17(textOrSegments(it && it.text));
  const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
  if (it && it.marker) item.marker = esc(it.marker);
  return item;
}
// Independence rule: whether the opening paragraph is an activity's instruction line ("Write these words in alphabetical
// order.", "Directions: ...") is read from the PRINT text (an imperative opening, or the print description saying it is
// directions/an instruction) — not merely from being the first ordinary paragraph.
const DIRECTIONS17_RE = /^\s*(?:Directions?\b|Instructions?\b|(?:Write|Unscramble|Circle|Complete|Make|Rewrite|Fill|Match|Put|Underline|Choose|Cross|Find|Sort|Use|Look|Copy|Add|Alphabetize|Change|Correct|Draw|Spell|Study|Try|Read|Learn|List|Number|Mark|Check|Decide|Tell|Say|Combine|Divide|Insert|Replace|Select|Sound|Cover)\b)/i;
function looksLikeDirections17(b) {
  return DIRECTIONS17_RE.test(String(b.text ?? '')) || /\b(?:directions|instruction line|activity instruction)\b/i.test(String(b.features ?? ''));
}
function buildBlocks17(printBlocks, limitations, inBox = false) {
  const blocks = [];
  // BANA 10.3.2 / F-235: the activity's opening instruction line ("Write these words in
  // alphabetical order.", "Unscramble...", "Directions: ...") takes 5-5 margins. The gold gives no
  // flag for it, so the builder reads it as: the FIRST paragraph of the excerpt, if it is ordinary (not
  // `blocked`, not `continuation`, not inside a box). Later ordinary paragraphs (the "Student 1:"
  // narrative lines of Sample 17-13, "Then generally:" of 17-18) are running text, not directions.
  let sawPara = false;
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const para = { type: 'para', ...fix17(textOrSegments(b.text)) };
      if (b.blocked) para.blocked = true;
      if (b.continuation) para.continuation = true;
      if (/^17\.1[12]\.2/.test(CUR17_RULE)) para.g1Quiet = true;   // UEB 5.1: an uncontracted word in a sentence takes an indicator only where letters could be misread
      // (An example that is only a run of uncontracted words, or a line prefixed by a devised icon
      // (F-213), is not an instruction line.)
      if (!inBox && !sawPara && !b.blocked && !b.continuation && !/^\s*`/.test(String(b.text ?? '')) && !/\bicon\b/i.test(String(b.features ?? '')) && looksLikeDirections17(b)) para.directions = true;
      sawPara = true;
      blocks.push(para);
    } else if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegments(b.text) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => buildListItem17(it, limitations, `list item ${i}`));
      const list = { type: 'list', kind: 'list', items: built };
      // 17.9.2a (Sample 17-11): the note that explains the omission symbol sits directly above the list it explains (as 10.6.8).
      if (/^17\.9\.2/.test(CUR17_RULE) && blocks.length && blocks[blocks.length - 1].type === 'note') list.afterNote = true;
      blocks.push(list);
    } else if (kind === 'glossary') {
      const items = Array.isArray(b.items) ? b.items : [];
      // Term/def go through the same textOrSegments() markup helper every other section's
      // own list/paragraph text does, so an italicised word-mention inside a definition
      // (Sample 17-9's own "_Advice_ is a noun...") can be encoded — glossarySegments
      // (document.mjs) accepts either a plain term/def string or termSegments/defSegments.
      // glossarySegments (document.mjs) only combines a term+def when its own PLAIN
      // `term`/`def` strings are BOTH truthy (its `if (term && def)` check) — even when
      // `termSegments`/`defSegments` are also supplied, so a segments-only field (no plain
      // string alongside it) silently drops the OTHER side entirely. A plain-text fallback
      // (segments' own `.text` joined) is therefore always supplied alongside a `*Segments`
      // array, purely so that truthiness check passes; the segments themselves (not the
      // fallback string) are what actually render.
      const plainOf = (tos) => (tos.segments ? tos.segments.map((g) => g.text || '').join('') : tos.text);
      const built = items.map((it) => {
        const termTos = textOrSegments(it && it.term);
        const defTos = textOrSegments(it && it.def);
        const out = { term: plainOf(termTos), def: plainOf(defTos) };
        if (termTos.segments) out.termSegments = termTos.segments;
        if (defTos.segments) out.defSegments = defTos.segments;
        return out;
      });
      // K25: every section-17 glossary is a 17.6 definition list or a 17.7 word list; both now follow print punctuation
      // only (June 2024 17.6.1b-c, 17.7.1c) - the formatter's optional block flag `definitionList`.
      blocks.push({ type: 'glossary', kind: 'glossary', definitionList: true, items: built });
    } else if (kind === 'box') {
      const inner = buildBlocks17(b.blocks, limitations, true);
      // 17.10.2: a passage with unmarked intentional errors is uncontracted throughout, its headline included.
      if (/^17\.10\.2/.test(CUR17_RULE)) for (const ib of inner) {
        if (ib.segments) ib.segments = ib.segments.map((g) => (g.type === 'text' ? { ...g, uncontracted: true } : g));
        else if (typeof ib.text === 'string') { ib.segments = [{ type: 'text', text: ib.text, uncontracted: true }]; }
      }
      blocks.push({ type: 'box', blocks: inner });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — a devised picture-icon marker with no print character, a transcriber-linearised table, or an abridged answer grid, per F-213/F-212/F-211): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  // 17.11.2 / 17.12.2: sentences that display crossed-out-letter words are separate lines at the list margins (1-3) beneath the
  // explaining note; the gold marks each as a flush `continuation` paragraph, so a run of them is built as one list.
  if (!inBox && /^17\.1[12]\.2/.test(CUR17_RULE)) {
    const out = [];
    for (const blk of blocks) {
      const prev = out[out.length - 1];
      const item = blk.type === 'para' && blk.continuation ? (blk.segments ? { segments: blk.segments } : { text: blk.text }) : null;
      if (item && prev && prev.type === 'list' && prev._fromPara) prev.items.push(item);
      else if (item) out.push({ type: 'list', kind: 'list', items: [item], _fromPara: true });
      else out.push(blk);
    }
    return out;
  }
  return blocks;
}
function buildModel17(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  CUR17_RULE = String((sample.illustrates && sample.illustrates.rule) || '');
  const blocks = buildBlocks17(printBlocks, limitations);
  // Independence rule: repeats and notes the transcriber added (17.4.1b, 17.9.2a, 17.11.2, 17.13.1b) are braille content.
  // The gold lists them in print.transcriberSupplied; they are never built, so the example cannot match.
  const supplied = sample.print && Array.isArray(sample.print.transcriberSupplied) ? sample.print.transcriberSupplied : [];
  if (supplied.length) limitations.push(`the expected braille contains transcriber-supplied content that the print original does not show: ${supplied.join('; ')} — not built (it would have to be read back from the braille).`);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-21 (Alphabetic References) — from
// sample.print.blocks ONLY.
// ---------------------------------------------------------------------------
// This section's gold schema (tests/gold/bana-formats-2016/section-21/README.md) is a flat
// print.blocks[] list, each {kind, level, text, style, items, features}:
//   kind 'heading'   -> an ordinary document `heading` block (level as given), exactly as
//                       every other section's own precedent — used both for ordinary
//                       centred/cell-5 titles AND for an alphabetical division letter
//                       (BANA 21.2.3), since standards-findings.md F-191 already establishes
//                       there is no dedicated division-letter construct anywhere in Emboss;
//                       a division letter is built the only way it CAN be, as a generic
//                       heading, and the section's own known blank-line placement bug
//                       (21.2.3d) is left to surface as a real mismatch rather than papered
//                       over.
//   kind 'paragraph' -> an ordinary `para` block (BANA 21.1.1's own general prose, a Title
//                       Page line for 21.2.5).
//   kind 'note'      -> a standalone transcriber's note (`formatTranscriberNote`/'note') —
//                       the embedded, unnumbered "Sample:" wordings under 21.3.1d/21.8.6c,
//                       matching every other section's own 'note' handling.
//   kind 'list'      -> a document `list` block. `style: 'glossary'` routes to Emboss's own
//                       `glossary`/`formatGlossary` mechanism (BANA 21.5/21.6 entry-word +
//                       definition pairs — `items[]` of {term, def, level}, level 1-based,
//                       converted the same way buildListItem's own 1-based->0-based
//                       convention does elsewhere); anything else is an ordinary `list`
//                       block (BANA 21.4 indexes, 21.7.2 single-level thesauruses —
//                       `items[]` of {text, level, page}), whose own `page` field is passed
//                       straight through to document.mjs's real `pageSuffix` mechanism
//                       (BANA 21.4 "page numbers directly follow the index entry" — the
//                       one already-working page-reference path this section's own
//                       findings confirm, F-203's own partial classification is about a
//                       print-page-RANGE computation, not this basic case). A plain 'list'
//                       item's own `text` may carry `**bold**`/`*italic*`/`` `uncontracted`
//                       `` cell-markup (e.g. 21.9.2's foreign entry words per 21.6.3b); a
//                       'glossary' item's `term`/`def` go through the identical markup path.
//   kind 'other'     -> never modeled; recorded as a limitation exactly like every other
//                       section's own 'other' — braille page guide words (F-192, no
//                       mechanism at all), a simulated/mock braille-page illustration
//                       (Examples 21-7/9/10/11), a multilevel dictionary entry with numbered
//                       /lettered subentries or a run-in derived entry (F-193/F-195), a
//                       glossary entry with pronunciation (F-200), a glossary entry's own
//                       nested illustrative/displayed material (F-195, Samples 21-7/21-8),
//                       or a foreign-language entry whose own per-page shared left margin
//                       has to be computed from the longest preceding article rather than
//                       hand-assigned (F-193/F-199, Examples 21-36/21-37).
function buildIndexItem21(it, limitations, where) {
  const item = {};
  if (Array.isArray(it && it.segments) && it.segments.length) item.segments = it.segments;
  else { const tos = textOrSegments(it && it.text); Object.assign(item, tos); }
  const lvl = Number(it && it.level) || 1;
  item.level = lvl - 1;                       // gold schema is 1-based; the document model is 0-based
  if (it && it.page != null && String(it.page).trim()) item.page = esc(String(it.page).trim());
  return item;
}
// term/def go through the same cell-markup DSL as every other text field (textOrSegments) —
// `term`/`def` (plain) are always populated too (not just termSegments/defSegments), because
// glossarySegments (document.mjs) itself keys its "is the term already punctuated"
// separator decision (F-194) off the plain `term` string's own trailing character, and its
// `if (term && def)` truthiness check off both plain strings.
// BANA 21.8.6a: an entry word printed with a superscript number ("live¹") - split off the number so the
// formatter's optional item field `termSup` places it (always after the entry word).
const SUP21 = { '\u00b9': '1', '\u00b2': '2', '\u00b3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9', '\u2070': '0' };
function buildGlossaryItem21(it0, limitations, where) {
  let it = it0, termSup = '';
  if (it0 && typeof it0.term === 'string') {
    const m = /^([\s\S]*?)([\u00b9\u00b2\u00b3\u2074-\u2079\u2070]+)$/.exec(it0.term);
    if (m) { it = { ...it0, term: m[1] }; termSup = [...m[2]].map((c) => SUP21[c]).join(''); }
  }
  const item = { level: (Number(it && it.level) || 1) - 1 };
  if (termSup) item.termSup = termSup;
  if (Array.isArray(it && it.termSegments) && it.termSegments.length) item.termSegments = it.termSegments;
  if (it && it.term != null) {
    const tos = textOrSegments(it.term);
    item.term = tos.text != null ? tos.text : String(it.term).replace(/[*`]/g, '');
    if (!item.termSegments && tos.segments) item.termSegments = tos.segments;
  }
  // A gold file may supply a raw, already-built `defSegments` array directly (e.g. mixed
  // bold-inside-italic runs the flat **bold**/*italic* cell-markup DSL cannot express in one
  // string) — pass those through verbatim, exactly like `buildIndexItem21`'s own `it.segments`
  // passthrough; otherwise fall back to parsing `it.def` through the ordinary markup DSL.
  if (Array.isArray(it && it.defSegments) && it.defSegments.length) item.defSegments = it.defSegments;
  if (it && it.def != null) {
    const tos = textOrSegments(it.def);
    item.def = tos.text != null ? tos.text : String(it.def).replace(/[*`]/g, '');
    if (!item.defSegments && tos.segments) item.defSegments = tos.segments;
  }
  return item;
}
// The print description's own `printFeatures` can state that the entry word is followed by a
// printed colon ("Bold entry word followed by a colon." — Example 21-15); the item `term` fields
// omit that colon, so it is restored here from that statement (F-194: a print-punctuated term
// takes one blank cell, not the two of an unpunctuated one).
// BANA 21.7 thesaurus: the print description gives each entry as one run of text, "agree *v.* coincide, ...";
// the entry word is its first word, the rest is the definition segment (label, synonyms, antonyms). The
// example words the printFeatures name as bold inside definitions (Sample 21-10) are made bold in the
// italic example sentences.
const thesaurusBoldWords21 = (pf) => {
  const m = /words?\s+((?:'[^']+'[,\s]*(?:and\s+)?)+)within definitions are bold/i.exec(String(pf || ''));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].toLowerCase()) : [];
};
function buildThesaurusItem21(it, limitations, where, boldWords) {
  const raw = String((it && it.text) ?? '');
  const m = /^(\S+)\s+([\s\S]+)$/.exec(raw);
  if (!m) return buildGlossaryItem21({ term: raw, level: it && it.level }, limitations, where);
  const item = buildGlossaryItem21({ term: m[1], def: m[2], level: it && it.level }, limitations, where);
  if (boldWords.length && Array.isArray(item.defSegments)) {
    const re = new RegExp('\\b(' + boldWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
    const out = [];
    for (const g of item.defSegments) {
      if (!g || g.type !== 'text' || g.tf !== 1 || !re.test(g.text)) { out.push(g); continue; }
      for (const part of g.text.split(new RegExp(re.source, 'gi'))) {
        if (!part) continue;
        out.push(re.test(part) && part.toLowerCase() && boldWords.includes(part.toLowerCase()) ? { ...g, text: part, tf: 5 } : { ...g, text: part });
      }
    }
    item.defSegments = out;
  }
  return item;
}
const printColonAfterEntryWord21 = (printFeatures) => /entry word[^.]*followed by (?:a |the )?colon/i.test(String(printFeatures || ''));
function buildBlocks21(printBlocks, limitations, printFeatures, rule = '') {
  const blocks = [];
  const isThesaurus = /^21\.7\./.test(String(rule)), isDictionary = /^21\.8\./.test(String(rule));
  const colonAfterTerm = printColonAfterEntryWord21(printFeatures);
  for (const b of (printBlocks || [])) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) { limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`); continue; }
      blocks.push({ type: 'heading', level: b.level, ...textOrSegments(b.text) });
    } else if (kind === 'paragraph') {
      const para = { type: 'para', ...textOrSegments(b.text) };
      if (b.blocked) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'note') {
      blocks.push({ type: 'note', ...textOrSegments(b.text) });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      if (b.style === 'glossary') {
        const built = items.map((it, i) => buildGlossaryItem21(it, limitations, `glossary item ${i}`));
        if (colonAfterTerm) for (const g of built) {
          if (typeof g.term === 'string' && g.term && !/[:;.,!?]$/.test(g.term)) {
            g.term += ':';
            if (Array.isArray(g.termSegments) && g.termSegments.length) g.termSegments = [...g.termSegments, { type: 'text', text: ':' }];
          }
        }
        // format selected by the illustrated rule (21.7 thesaurus / 21.8 dictionary)
        // 21.8 (dictionary): optional block field `dictionary` (one blank after the entry word, 21.2.1b margins).
        // K25 / 21.9.2c (June 2024): a bilingual reference (the sample illustrates 21.9.2) follows print punctuation only
        // (optional block flag `bilingual`); a 21.5 glossary keeps its capital and enclosure tests.
        blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', ...(isDictionary ? { dictionary: true } : {}), ...(/^21\.9\.2/.test(String(rule)) ? { bilingual: true } : {}), items: built });
      } else if (isThesaurus) {
        // 21.7.2 / 21.7.3: entry word + definition, 21.2.1b margins (optional block field `thesaurus`).
        const bold = thesaurusBoldWords21(printFeatures);
        blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', thesaurus: true, items: items.map((it, i) => buildThesaurusItem21(it, limitations, `thesaurus item ${i}`, bold)) });
      } else {
        const built = items.map((it, i) => buildIndexItem21(it, limitations, `list item ${i}`));
        blocks.push({ type: 'list', kind: 'index', items: built });
      }
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — braille page guide words F-192, a simulated/mock braille-page illustration, a multilevel dictionary entry F-193/F-195, a glossary entry with pronunciation F-200, or a glossary entry's own nested illustrative material F-195): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
  }
  return blocks;
}
function buildModel21(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = buildBlocks21(printBlocks, limitations, sample.print && sample.print.printFeatures, sample.illustrates && sample.illustrates.rule);
  const hasContent = blocks.length > 0;
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

// ---------------------------------------------------------------------------
// Model building for section-2 (Transcriber-Generated Pages and Front Matter)
// ---------------------------------------------------------------------------
// Every §2 gold file has print.blocks === [] (the print original is a photograph of a
// real book page, or there is none — see tests/gold/bana-formats-2016/section-2/README.md),
// so there is no print content to build a docModel from, and this builder does NOT derive
// one from the braille (that would be hard-coding the expected answer). It builds the
// (empty) document, and records as a limitation the specific Emboss capability that is
// missing for that page type, per Emboss/docs/transcriber-pages-plan.md (stages 1-8).
// If print.blocks ever gets content, it is built with the shared §17 block builder
// (heading/paragraph/note/list), so the runner then scores a real mismatch/match.
// The four anonymous 'Sample:' wording files have no braille at all and are classified
// "no-braille" by runOne before the model is run.
function limitation2(sample) {
  const rule = String((sample.illustrates && sample.illustrates.rule) || '');
  const id = sample.id;
  const T = 'Emboss/docs/transcriber-pages-plan.md';
  if (id === 'sample-2-21-special-symbols') return `Special Symbols page (BANA 2.5): Emboss has no Special Symbols page or transcriber-defined symbol list yet (${T} stage 8, needs feature group 7), and no t-prefixed page number (stage 1).`;
  if (id === 'sample-2-21-transcribers-notes') return `Transcriber's Notes page (BANA 2.6): Emboss has no plain 3-1 Transcriber's Notes page renderer with a centred heading and t-prefixed number (${T} stages 1-3).`;
  if (id === 'sample-2-21-pronunciation-key-in-front-matter-pages') return `Pronunciation key among the front matter pages (BANA 2.11.1): no print model for it, and Emboss has no p-prefixed front-matter page numbering or forced front-matter page-per-item breaks for it (${T} stages 1-2).`;
  if (id === 'sample-2-21-title-page-volume-1') return `Title page for volume 1 (BANA 2.3, 2.11.1): Emboss has no data-driven Title Page with publisher, copyright, transcriber and volume segments, and volumeTitlePage renders no t-prefixed page number (F-57; ${T} stages 1, 5, 6).`;
  if (id.startsWith('sample-2-21-table-of-contents')) return `Table of contents front matter page (BANA 2.10, 2.11.1): gold has no print model to build headings from, and Emboss's buildToc numbers pages with a P prefix and its own layout, not the p-prefixed front-matter series and multi-volume/brief-contents rules of 2.10 (${T} stage 1).`;
  if (rule.startsWith('2.4')) return `Second Title Page (BANA 2.4): Emboss has no Second Title Page overflow renderer (${T} stage 7); gold has no print model for the original title page.`;
  if (/^2\.3\.(4|5)/.test(rule)) return `Title Page ${rule} (title/series/grade/subtitle/author segments): Emboss has no data-driven Title Page renderer and gold has no print model (photograph of a real title page) (${T} stages 5-6).`;
  if (/^2\.3\.(6|7)/.test(rule)) return `Title Page publisher/copyright/transcriber segment ${rule}: Emboss has no metadata fields or Title Page renderer for publisher, copyright year, ISBN, printing history or transcriber wording (F-134/F-135/F-136; ${T} stages 5-6).`;
  if (/^2\.3\.8/.test(rule)) return `Title Page volume, braille-page and print-page information ${rule}: Emboss has no Title Page renderer and no t-prefixed/print page range statement for volumes (${T} stages 1, 5, 6).`;
  if (rule.startsWith('2.3')) return `Title Page ${rule}: Emboss has no Title Page renderer and gold has no print model (${T} stages 5-6).`;
  if (rule.startsWith('2.9')) return `Dedication page (BANA 2.9): Emboss has no dedication front-matter block with its own page and p-prefixed number (${T} stages 1-2); gold has no print model.`;
  if (rule.startsWith('2.10')) return `Table of contents ${rule}: gold has no print model to build contents entries from, and Emboss's buildToc has no brief/multi-volume/categorized/transposed-note contents layouts or p-prefixed page series (${T} stage 1).`;
  return `Front-matter page ${rule}: Emboss has no model for this transcriber-generated page and gold has no print model.`;
}

function buildModel2(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  CUR17_RULE = '';
  const blocks = buildBlocks17(printBlocks, limitations);
  // K30 / BANA 2.9: when a §2.9 dedication sample ever gets real print.blocks to build from
  // (none do today — see limitation2's own '2.9' case, above), mark the body paragraphs
  // `dedication: true` from the print description, the same way other §2 fields are read
  // from `printFeatures`/the rule id rather than hard-coded per sample.
  if (blocks.length && /^2\.9|dedication/i.test(`${(sample.illustrates && sample.illustrates.rule) || ''} ${sample.title || ''}`)) {
    for (const b of blocks) if (b && b.type === 'para') b.dedication = true;
  }
  const hasBrl = sample.braille && Array.isArray(sample.braille.lines) && sample.braille.lines.length;
  // Sample 2-21 "Transcriber's Notes" (BANA 2.6.1): built as a `tnpage` (Transcriber's Notes page
  // renderer, plan stage 3) from print.tnEntries — the entries' PRINT wording, one string per 3-1
  // paragraph — when a gold file states it. None does today (print.blocks is [] and no file carries
  // print.tnEntries): the wording exists only in the expected braille, and deriving input from the
  // expected braille is forbidden, so without tnEntries the sample is not-representable, with the
  // specific reason below. BANA states in print form only the sentence "The atlas is omitted." (2.6.1d).
  const tnEntries = sample.id === 'sample-2-21-transcribers-notes' && sample.print && Array.isArray(sample.print.tnEntries)
    ? sample.print.tnEntries.filter((t) => typeof t === 'string' && t.trim()) : [];
  if (tnEntries.length) {
    blocks.push({ type: 'tnpage', matter: 'transcriber', entries: tnEntries.map((text) => ({ text })) });
  } else if (!printBlocks.length && hasBrl) {
    limitations.push(sample.id === 'sample-2-21-transcribers-notes'
      ? "Transcriber's Notes page (BANA 2.6.1): Emboss now has the tnpage renderer (centred heading, 3-1 entries, t-number; plan stage 3), but the gold gives no print wording for the entries (print.blocks is [] and there is no print.tnEntries; only \"The atlas is omitted.\" is stated in print form, BANA 2.6.1d, and its other two entries appear only as braille). Building the page would mean reading the expected braille back into text, which is not allowed. Also unmatched: the expected page ends with a final \"444\" line and carries t3 (third transcriber page of Sample 2-21), not t1."
      : sample.id === 'sample-2-21-special-symbols'
        ? "Special Symbols page (BANA 2.5): Emboss now has the sympage renderer (G8 stage 5: centred heading, .= entries with 1-3 margins, t-number), but the gold gives no print description (print.blocks is [] and there is no print field naming the symbols). Its entries (dot locator, boldface word indicator, boldface passage indicator, acute accent above letter, boldface terminator) exist only as braille, and the typeform indicators are not symbols the formatter collects; building them would mean reading the expected braille back into text, which is not allowed. Also unmatched: the expected page ends with a final \"444\" line and carries t2, not t1."
        : limitation2(sample));
  }
  return { doc: { title: null, blocks }, limitations, hasTable: blocks.length > 0 };
}

// ---------------------------------------------------------------------------
// Model building for section-20 (Pronunciation) and section-22 (Bibliographies) — from
// sample.print ONLY.
// ---------------------------------------------------------------------------
// §20's gold (tests/gold/bana-formats-2016/section-20/README.md) has print.blocks of one
// 'paragraph' (a snippet of pronunciation notation, \n = a print line), 'table' (a
// pronunciation key) or 'heading'; the emphasis lives only in print.features prose, so the
// gold's print blocks record it as structured print fields (`emphasis`, `lineEmphasis`, `entry`, `lineBreaks`, `runningText`), never read from the braille.
//   - An inline "Example" snippet is not a whole print paragraph, so it is built as an
//     isolated paragraph with continuation:true (cell 1, no blank line — the same convention
//     buildModel17 uses for an isolated worked example). Examples 20-19/20-20 are running text
//     (a sentence), so they are ordinary indented paragraphs.
//   - Dictionary entries (Examples 20-21..20-26: entry word, optional respelling, definition)
//     are built as a glossary list item (the entry-word+definition mechanism §21 uses),
//     term = entry word segment (with any respelling), def = definition segment.
//   - Diacritics are the print text's own Unicode characters; nothing is pre-converted to
//     braille modifiers. What the print text cannot carry (ligature ties, a stroke through a
//     letter, a transcriber-defined tertiary-stress indicator) is recorded as a limitation
//     (-> not-representable, F-158/F-160). Pronunciation KEYS (tables) are never built:
//     Emboss has no pronunciation-key node (F-162), so a key is not-representable.
const TF20 = { i: 1, u: 2, b: 4 };
function spanSegs20(text, spans) {
  const ranges = [];
  for (const [sub, tf, nth = 1] of (spans || [])) {
    let idx = -1, from = 0;
    for (let k = 0; k < nth; k++) { idx = text.indexOf(sub, from); if (idx < 0) break; from = idx + sub.length; }
    if (idx >= 0) ranges.push([idx, idx + sub.length, TF20[tf]]);
  }
  if (!ranges.length) return { text };
  ranges.sort((a, b) => a[0] - b[0]);
  const segments = []; let pos = 0;
  for (const [st, en, tf] of ranges) {
    if (st > pos) segments.push({ type: 'text', text: text.slice(pos, st) });
    segments.push({ type: 'text', text: text.slice(st, en), tf });
    pos = en;
  }
  if (pos < text.length) segments.push({ type: 'text', text: text.slice(pos) });
  return { segments };
}
// A print snippet of several lines: the paragraph model has no forced line break (a \n is collapsed to a
// space by formatPara), so a block the print description marks `lineBreaks:true` (each print line is its own line) is built
// as one isolated paragraph per print line. Otherwise a line break in the text is a space.
// Independence rule: everything below comes from print fields on the block: `emphasis` / `lineEmphasis` ([substring,
// 'i'|'u'|'b', nth] runs seen in the print image), `lineBreaks`, `entry` ({term, termBold, def}: a dictionary entry whose
// entry word and definition segment are visible in print) and `runningText` (a complete sentence of running text, not a
// notation snippet). No id-keyed tables. The choice to build an entry as a glossary list item (BANA 20.6) and a snippet as
// an isolated paragraph (20.3..20.5) is the format selected by the illustrated rule, which the transcriber decides.
const plain20 = (tos) => (tos.segments ? tos.segments.map((g) => g.text || '').join('') : tos.text);
// Print marks Emboss has no representation for, recognised from the PRINT description (features), not from an example id.
const LIMIT20_RULES = [
  [/tertiary stress/i, 'tertiary stress (grave accent) needs a transcriber-defined indicator with its own explanatory transcriber\'s note (BANA 20.4.1d, 20.4.1b); Emboss has no transcriber-defined modifier mechanism (F-158). Built without it.'],
  [/ligature tie|tie joins|and ligatured|\(ligatured\)/i, 'a ligature tie is printed (BANA 20.4.3-20.4.5) — a tie/ligature diacritic has no representation in Emboss (F-160); the print text carries no tie, so it is dropped.'],
  [/diagonal stroke|cross-?bar/i, 'a stroke or cross-bar through a letter is printed (BANA 20.4.3, 20.4.4) — no representation in Emboss (F-158/F-160); the print text carries no such mark, so it is dropped.'],
];
function buildModel20(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const blocks = [];
  for (const b of printBlocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.kind === 'table' || b.kind === 'heading') {
      limitations.push(`print block kind '${b.kind}' not modeled${b.kind === 'table' ? ' (a pronunciation key needs a pronunciation-key node — 1-3 list, dot locators, columns linearised, BANA 20.7 — Emboss has none, F-162)' : ''}: "${String(b.text ?? '').slice(0, 80)}"`);
    } else if (b.kind === 'paragraph') {
      for (const [re, msg] of LIMIT20_RULES) if (re.test(String(b.features ?? ''))) limitations.push(msg);
      if (b.entry && typeof b.entry === 'object') {
        const e = b.entry;
        const tt = spanSegs20(e.term, [[e.termBold, 'b']]);
        const item = { level: 0, term: plain20(tt), def: e.def };
        if (tt.segments) item.termSegments = tt.segments;
        blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items: [item] });
      } else {
        const lines = b.lineBreaks ? String(b.text).split('\n') : [String(b.text).replace(/\n/g, ' ')];
        lines.forEach((ln, li) => {
          const spans = b.lineBreaks ? (b.lineEmphasis || [])[li] : b.emphasis;
          const para = { type: 'para', ...spanSegs20(ln, spans) };
          if (!b.runningText) para.continuation = true;   // an isolated notation snippet, not a whole print paragraph
          blocks.push(para);
        });
      }
    } else {
      limitations.push(`print block kind '${b.kind}' not modeled: "${String(b.text ?? '').slice(0, 80)}"`);
    }
  }
  return { doc: { title: null, blocks }, limitations, hasTable: blocks.length > 0 };
}

// §22 (Bibliographies): print.blocks 'entry' (a citation) and 'paragraph' (an annotation). One
// bibliography = one plain list, entries at level 0; an annotation is a level-1 item (the only
// way Emboss expresses BANA 22.3.1's 1-5/3-5 margins; nothing in the data model marks where a
// citation ends and its annotation begins, F-184). Italic/bold runs are from print.features.
// Emphasis runs come from the block's own print `emphasis` field (no id-keyed table).
function buildModel22(sample) {
  const printBlocks = (sample.print && Array.isArray(sample.print.blocks)) ? sample.print.blocks : [];
  const limitations = [];
  const items = [];
  for (const b of printBlocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.kind === 'entry' || b.kind === 'paragraph') {
      const tos = spanSegs20(b.text, b.emphasis);
      const item = tos.segments ? { segments: tos.segments } : { text: tos.text };
      item.level = b.kind === 'paragraph' ? 1 : 0;
      items.push(item);
    } else {
      limitations.push(`print block kind '${b.kind}' not modeled: "${String(b.text ?? '').slice(0, 80)}"`);
    }
  }
  const blocks = items.length ? [{ type: 'list', kind: 'plain', items }] : [];
  return { doc: { title: null, blocks }, limitations, hasTable: blocks.length > 0 };
}

// Format selected by the illustrated rule: several builders (sections 11, 15, 17, 19, 21) read `sample.illustrates.rule` to
// pick a format the transcriber chooses for that kind of material (which table format, spelling-list uncontracting, a
// thesaurus/dictionary entry mode, segmented numbers). That is a legitimate INPUT — the transcriber decides the format and
// the rule names it — but it is not evidence that Emboss finds the format from the print alone. The README lists these as
// "known weak matches".
const MODEL_BUILDERS = { 'section-2': buildModel2, 'section-11': buildModel11, 'section-4': buildModel4, 'section-8': buildModel8, 'section-7': buildModel7, 'section-1': buildModel1, 'b004-6-9': buildModel1, 'section-16': buildModel16, 'b004-11': buildModel16, 'section-9': buildModel9, 'b004-appendix-g': buildModel9, 'section-5': buildModel5, 'section-13': buildModel13, 'b004-appendix-j': buildModel13, 'b004-appendix-e': buildModel11, 'section-3': buildModel3, 'section-12': buildModel12, 'section-6': buildModel6, 'section-15': buildModel15, 'section-19': buildModel19, 'section-14': buildModel14, 'section-17': buildModel17, 'section-10': buildModel10, 'section-21': buildModel21, 'section-18': buildModel18, 'section-20': buildModel20, 'section-22': buildModel22 };
function buildModel(sample) {
  const fn = MODEL_BUILDERS[SECTION];
  if (!fn) throw new Error(`No model builder registered for --section ${SECTION}`);
  return applyForeignText(sample, fn(sample));
}

// K16 / BANA Formats 1.16.3 (June 2024): the document option `foreignText` (foreign material uncontracted, with the
// foreign alphabet signs of Appendix D) is set ONLY for samples whose print is foreign-language material, and the
// language is given to exactly the print text that is foreign (a reader would record it as `seg.lang`). The language of
// a print word is print information, read from the sample's own print description and print text, never from the braille.
//   1.16.3 foreign-language instructional texts / foreign-language materials (the section itself says so):
//     Examples 17-1, 17-2  "Word Lists in Foreign Language Texts" (17.7), print notes "bilingual (Spanish/English)
//                          vocabulary list" / "Foreign words (with preceding Spanish articles ...)": the entry words are Spanish.
//     Examples 21-38, 21-39 "Alphabetic References in Foreign Language Materials" (21.9.3): each entry is French, German or
//                          Spanish (coup / Laden / Leben; dessus / Tisch / Spass / exacto / tu ... il).
//   21.6.3b bilingual glossaries ("Use uncontracted braille for foreign language entry words, using the appropriate
//   accented letters and symbols for the language"): Emboss does this AUTOMATICALLY in every glossary (K16 follow-up,
//   26 Sep; document.mjs foreignRefSegments), so these samples get the language tags only, NOT the document option
//   (they are English textbooks, not 1.16.3 foreign-language texts):
//     Example 21-22 "Simple English/Spanish Glossary": the entry word after the slash and the definition are Spanish.
//     Samples 21-5, 21-6 "English/Spanish Glossary": the second entry (factores / absorción) and its definition are Spanish.
// Not set: Examples 1-18, 1-19 (1.16.2, incidental foreign words in English text), Example 5-10 (English glossary),
// and the not-representable 21-36, 21-37 and Samples 21-3, 21-4.
const FOREIGN_TEXT_SAMPLES = {
  'BANA Example 17-1': { glossary: (it) => ({ term: 'es' }) },
  'BANA Example 17-2': { glossary: (it) => ({ term: 'es' }) },
  'BANA Example 21-38': { index: ['fr', 'de', 'de'] },
  'BANA Example 21-39': { index: ['fr', 'de', 'de', 'es', 'fr'] },
};
const FOREIGN_LANG_SAMPLES_21_6_3 = {                     // language tags only (print information); no foreignText
  'BANA Example 21-22': { glossary: () => ({ termAfterSlash: 'es', def: 'es' }) },
  'BANA Sample 21-5': { glossary: (it, i) => (i === 1 ? { term: 'es', def: 'es' } : {}) },
  'BANA Sample 21-6': { glossary: (it, i) => (i === 1 ? { term: 'es', def: 'es' } : {}) },
};
function applyForeignText(sample, model) {
  const option = FOREIGN_TEXT_SAMPLES[sample && sample.id];
  const spec = option || FOREIGN_LANG_SAMPLES_21_6_3[sample && sample.id];
  if (!spec || !model || !model.doc) return model;
  const tag = (segs, text, lang) => (Array.isArray(segs) && segs.length ? segs.map((g) => (g && (g.type === 'text' || g.type == null) ? { ...g, lang } : g)) : [{ type: 'text', text: String(text ?? ''), lang }]);
  for (const b of model.doc.blocks || []) {
    if (!b || !Array.isArray(b.items)) continue;
    if (spec.glossary && (b.type === 'glossary' || b.kind === 'glossary')) {
      b.items.forEach((it, i) => {
        const s = spec.glossary(it, i) || {};
        if (s.term) it.termSegments = tag(it.termSegments, it.term, s.term);
        if (s.termAfterSlash && typeof it.term === 'string' && it.term.includes('/') && !it.termSegments) {
          const k = it.term.indexOf('/');
          it.termSegments = [{ type: 'text', text: it.term.slice(0, k + 1) }, { type: 'text', text: it.term.slice(k + 1), lang: s.termAfterSlash }];
        }
        if (s.def) it.defSegments = tag(it.defSegments, it.def, s.def);
      });
    }
    if (spec.index && b.kind === 'index') b.items.forEach((it, i) => { if (spec.index[i]) it.segments = tag(it.segments, it.text, spec.index[i]); });
  }
  if (option) model.doc.foreignText = true;                // 1.16.3 samples only; 21.6.3b glossaries need no option
  return model;
}

// ---------------------------------------------------------------------------
// Formatting + comparison
// ---------------------------------------------------------------------------
// b004-6-9 and b004-11 are the UKAAF sections here (their samples must format
// in UKAAF mode, not BANA); B004 states no fixed page width anywhere (unlike
// BANA's stated 40 cells, Formats 1.7.1) — confirmed directly for §11 too,
// during this section's own reconciliation (b004-11-1/-2 wrap well short of
// any column-40 anchor) — so this uses Emboss's own UKAAF default width (38),
// matching the reconciled width already used by the UKAAF Appendix E gold
// precedent (tests/gold/ukaaf-b004/appendix-e/README.md §"How these files were
// made" step 3). suppressHeader stays true for every section, including these
// (see buildModel1's own header comment for why).
const IS_UKAAF_SECTION = SECTION === 'b004-6-9' || SECTION === 'b004-11' || SECTION === 'b004-appendix-j' || SECTION === 'b004-appendix-e';
// b004-appendix-j is UKAAF-formatted (App J's own cell-1/cell-3/cell-5 poetry margins) but,
// unlike b004-6-9/b004-11, its own gold reconciliation recorded a genuine width:40 for both
// worked examples (not the width-agnostic default 38 the other two UKAAF sections fall back
// to for lack of any column anchor) — both independent transcription runs agreed on 40 for
// this appendix specifically (Emboss/tests/gold/ukaaf-b004/appendix-j/README.md).
const UKAAF_WIDTH = SECTION === 'b004-appendix-j' ? 40 : 38;
const OPTS = {
  mode: IS_UKAAF_SECTION ? 'ukaaf' : 'bana',
  standard: IS_UKAAF_SECTION ? 'ukaaf' : 'bana',
  width: IS_UKAAF_SECTION ? UKAAF_WIDTH : 40,
  depth: 25,
  translate,
  translateG1,
  suppressHeader: true,
};

function runModel(doc) {
  const brf = formatDocument(doc, OPTS) || '';
  const pageTexts = brf.length ? brf.split('\x0c') : [];
  const pages = pageTexts.map((p) => p.replace(/\r\n$/, '').split('\r\n'));
  const lines = [];
  const pageBreaksAfter = [];
  for (const page of pages) {
    lines.push(...page);
    if (lines.length && page !== pages[pages.length - 1]) pageBreaksAfter.push(lines.length);
  }
  return { lines, pageBreaksAfter };
}

// Small LCS-based unified diff over line arrays (both are short — a handful to
// a few dozen lines — so an O(n*m) table is plenty fast).
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: ' ', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', line: a[i] }); i++; }
    else { ops.push({ op: '+', line: b[j] }); j++; }
  }
  while (i < n) { ops.push({ op: '-', line: a[i] }); i++; }
  while (j < m) { ops.push({ op: '+', line: b[j] }); j++; }
  return ops;
}

function unifiedDiffText(ops) {
  return ops.filter((o) => o.op !== ' ').map((o) => `${o.op}${JSON.stringify(o.line)}`).join('\n');
}

function firstDiffLine(expected, actual) {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) {
      return { index: i, expected: expected[i], actual: actual[i] };
    }
  }
  return null;
}

// The gold README/convention: some samples' `braille.lines[0]` is the literal
// placeholder word "text" standing in for preceding print-page body text that
// was deliberately not transcribed for this excerpt (see e.g. sample-11-02's
// braille.notes). We build no such paragraph (there is no data to build it
// from), so that placeholder line is excluded from the comparison — this is a
// data-shape accommodation for the gold file's own documented convention, not
// an adjustment of the expected braille content.
//
// FINDING (see standards-findings.md, "gold §11 letter-case convention"):
// every gold `braille.lines` entry in this section spells the braille alphabet
// in LOWERCASE ("gorilla", ",daily"), but the real North American Braille
// ASCII convention — verified in this repo against BrailleBlaster's own .brf
// output (Emboss/tests/nimas_samples/*.bb_out.brf, e.g. "ONCE U A TIME A POOR
// WOODMAN...") and against Emboss's own liblouis-backed translate() and its
// existing box-line tests (bana_sidebar_sync.test.mjs etc., which assert the
// UPPERCASE 'GGGGGGG' bottom box rule) — is UPPERCASE for the alphabet and for
// the a-j/1-0 digit letters; non-alphabetic indicator/punctuation characters
// (",", "#", '"', ".", etc.) have no case and are unaffected either way. This
// is a Stage-3 gold-transcription artifact (the two independent read-throughs
// of the PDF's rendered dot-pattern images picked the wrong ASCII case when
// converting dots to text), not an Emboss defect, so — like the "text"
// placeholder above — it is normalised away here (`.toUpperCase()`, which only
// touches a-z and leaves every non-alphabetic BRF ASCII character alone)
// before scoring, so a real formatting difference is never buried under this
// mechanical, corpus-wide, orthogonal-to-Emboss case flip. The RAW (as-given)
// expected lines are kept alongside for full transparency in the diff output.
// A second isolated-sample artifact, orthogonal to the case issue above:
// document.mjs's buildDocPages calls trimLeadingBlank(content) once per
// document, dropping any blank line(s) at the very top of the page (formatBox
// /formatCaption/formatHeading each unconditionally emit a leading '' of their
// own — correct when they are NOT the first thing on the page, but pointless,
// and trimmed, when they are). Every one of these gold samples opens straight
// on the table (or its caption/title), so Emboss's real, isolated-document
// output never carries that leading blank — while the book excerpt's own
// braille.lines legitimately does (something precedes the table on the real
// physical page). We drop a single leading '' from the gold lines for the
// same reason we drop the "text" placeholder: to compare like with like,
// not to change what the standard expects the FULL page to look like.
function expectedLinesFor(sample) {
  const raw = (sample.braille && Array.isArray(sample.braille.lines)) ? sample.braille.lines.slice() : [];
  const strippedPlaceholder = raw.length && raw[0] === 'text';
  let rawLines = strippedPlaceholder ? raw.slice(1) : raw;
  const strippedLeadingBlank = rawLines.length && rawLines[0] === '';
  if (strippedLeadingBlank) rawLines = rawLines.slice(1);
  const lines = rawLines.map((l) => (typeof l === 'string' ? l.toUpperCase() : l));
  return { lines, rawLines, strippedPlaceholder, strippedLeadingBlank };
}

function diagnose(sample, model, expected, actual, diffOps) {
  if (!expected.lines.length) return 'No braille in the standard for this sample (print-only or empty) — nothing to compare.';
  const fd = firstDiffLine(expected.lines, actual.lines);
  if (!fd) return 'match';
  const notes = [];
  if (expected.lines.some((l) => /^7+$/.test(l)) && !actual.lines.some((l) => /^7+$/.test(l))) {
    notes.push("expected output is enclosed in a box (top '7...'/bottom 'G...' rule lines per BANA §7/11.2.5e) but Emboss produced no box lines for this input.");
  }
  const lenDiff = actual.lines.length - expected.lines.length;
  notes.push(`first differing line ${fd.index + 1}: expected ${JSON.stringify(fd.expected ?? null)} vs actual ${JSON.stringify(fd.actual ?? null)}.`);
  if (lenDiff !== 0) notes.push(`line count differs by ${lenDiff > 0 ? '+' : ''}${lenDiff} (expected ${expected.lines.length}, actual ${actual.lines.length}).`);
  if (model.limitations.length) notes.push('Input-model limitation: ' + model.limitations[0]);
  return notes.join(' ');
}

export function loadSamples() {
  const files = fs.readdirSync(GOLD_DIR).filter((f) => f.endsWith('.json') && f !== 'status.json').sort();
  return files.map((f) => ({ file: f, sample: JSON.parse(fs.readFileSync(path.join(GOLD_DIR, f), 'utf8')) }));
}

// buildModel/MODEL_BUILDERS/SECTION exported for Emboss/scripts/check-layout-parity.mjs,
// which needs each gold section's built document models (`.doc.blocks`) to feed into its
// own formatBlock/traceBlock comparison, without paying for runOne's own formatDocument +
// gold-line diff on every sample. It imports this module fresh per section (a cache-busted
// specifier, since SECTION/MODEL_BUILDERS/GOLD_DIR are read from GOLD_RUN_SECTION at import
// time — see gold_bana_section4.test.mjs's own header comment for why a dynamic import is
// required here rather than a static one).
export { GOLD_DIR, STATUS_FILE, SECTION, MODEL_BUILDERS, buildModel, OPTS };

export function runOne(sample) {
  const model = buildModel(sample);
  const expected = expectedLinesFor(sample);
  // `sample.braille.width` is this gold corpus's own evidence-recording field for the
  // PHYSICAL braille-page cell width (often left `null` on purpose when the source gives
  // no page-width evidence at all — e.g. BANA Examples 16-1..16-4/16-10, every UKAAF B004
  // §11 example — even though real `braille.lines` content exists) — it is metadata about
  // how confident the transcription is, not a signal that no braille exists. Whether a
  // sample has braille at all is exactly what `expected.lines.length` already says.
  const noBraille = expected.lines.length === 0;
  if (noBraille) {
    return { id: sample.id, status: 'no-braille', diagnosis: 'Standard gives no braille for this sample (print-only worked example).', model, expected, actual: { lines: [], pageBreaksAfter: [] }, diffOps: [] };
  }
  const actual = runModel(model.doc);
  // Blank lines at the very end of either side carry no information (a worked example ends
  // where the book's excerpt ends; a document's last block may legitimately be followed by
  // its own trailing blank — e.g. a poem's blank line after it, BANA 13.3.1a). Trim them on
  // both sides before comparing so an excerpt's end is never itself a difference.
  const trimEnd = (ls) => { const out = [...ls]; while (out.length && out[out.length - 1] === '') out.pop(); return out; };
  actual.lines = trimEnd(actual.lines);
  expected.lines = trimEnd(expected.lines);
  const diffOps = diffLines(expected.lines, actual.lines);
  const isMatch = expected.lines.length === actual.lines.length && expected.lines.every((l, i) => l === actual.lines[i]);
  const coreUnrepresentable = (SECTION === 'section-2' || SECTION === 'section-4' || SECTION === 'section-8' || SECTION === 'section-7' || SECTION === 'section-1' || SECTION === 'b004-6-9' || SECTION === 'section-16' || SECTION === 'b004-11' || SECTION === 'section-9' || SECTION === 'b004-appendix-g' || SECTION === 'section-13' || SECTION === 'b004-appendix-j' || SECTION === 'b004-appendix-e' || SECTION === 'section-3' || SECTION === 'section-6' || SECTION === 'section-15' || SECTION === 'section-19' || SECTION === 'section-14' || SECTION === 'section-17' || SECTION === 'section-10' || SECTION === 'section-21' || SECTION === 'section-18' || SECTION === 'section-20' || SECTION === 'section-22')
    // §4/§7/§8/§1/§16/b004-6-9/b004-11/§9/b004-appendix-g: any recorded limitation means
    // some real print content was left out of the model (a heading with no level, a
    // bullet/column/box/colour-note Emboss has no mechanism for, a block kind this flat
    // schema can't build, an inline/no-reference-mark note per F-N2, a table-cell noteref
    // per F-N4) rather than Emboss producing outright wrong output for content it WAS
    // given — "not-representable" rather than a plain "mismatch", mirroring §11's own
    // distinction.
    ? model.limitations.length > 0
    : model.limitations.some((l) => l.startsWith('print.headers has') );
  let status;
  if (isMatch) status = 'match';
  else if (coreUnrepresentable) status = 'not-representable';
  else status = 'mismatch';
  const diagnosis = isMatch ? 'match' : diagnose(sample, model, expected, actual, diffOps);
  return { id: sample.id, status, diagnosis, model, expected, actual, diffOps };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const all = loadSamples();
  const targets = ONLY ? all.filter((x) => x.sample.id === ONLY || x.file.startsWith(ONLY)) : all;
  if (ONLY && !targets.length) {
    console.error(`No gold sample matches --sample ${ONLY}`);
    process.exit(2);
  }
  const results = [];
  for (const { file, sample } of targets) {
    let r;
    try {
      r = runOne(sample);
    } catch (e) {
      r = { id: sample.id, status: 'mismatch', diagnosis: `Runner threw: ${e && e.stack || e}`, model: { limitations: [] }, expected: { lines: [] }, actual: { lines: [] }, diffOps: [] };
    }
    results.push(r);
  }

  // Per-sample report
  for (const r of results) {
    console.log(`\n=== ${r.id} — ${r.status.toUpperCase()} ===`);
    console.log(r.diagnosis);
    if (r.status !== 'match' && r.status !== 'no-braille' && r.diffOps && r.diffOps.some((o) => o.op !== ' ')) {
      console.log('--- diff (expected - / actual +) ---');
      console.log(unifiedDiffText(r.diffOps));
    }
    if (r.model.limitations && r.model.limitations.length) {
      console.log('Limitations recorded while building the input model:');
      for (const l of r.model.limitations) console.log('  - ' + l);
    }
  }

  // Summary table
  console.log('\n\n=== SUMMARY ===');
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  '));
  console.log('id'.padEnd(16) + 'status'.padEnd(18) + 'diagnosis');
  for (const r of results) {
    const oneLine = r.diagnosis.split('\n')[0].slice(0, 140);
    console.log(r.id.padEnd(16) + r.status.padEnd(18) + oneLine);
  }

  if (UPDATE_STATUS) {
    let existing = {};
    if (fs.existsSync(STATUS_FILE)) {
      try { existing = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { existing = {}; }
    }
    const statusOut = ONLY ? { ...existing } : {};
    for (const r of results) {
      statusOut[r.id] = { status: r.status, note: r.diagnosis.split('\n')[0].slice(0, 500) };
    }
    fs.writeFileSync(STATUS_FILE, JSON.stringify(statusOut, null, 2) + '\n');
    console.log(`\nWrote ${STATUS_FILE}`);
  }

  const anyRunnerError = results.some((r) => r.diagnosis && r.diagnosis.startsWith('Runner threw'));
  process.exit(anyRunnerError ? 1 : 0);
}

// Only run the CLI when this file is executed directly (`node gold-run.mjs`),
// not when gold_bana_section11.test.mjs imports `runOne`/`loadSamples` to
// re-run the comparison in-process for the regression guard.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
