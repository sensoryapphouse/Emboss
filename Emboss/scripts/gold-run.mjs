#!/usr/bin/env node
// Gold-example runner: BANA Braille Formats 2016, multi-section.
//
// For every gold file in tests/gold/bana-formats-2016/<section>/*.json, builds a
// document model from its `print` field ONLY (never from `braille` — that is the
// expected result, not an input), formats it with formatDocument in BANA mode at
// 40 cells / 25 lines using the real liblouis translator (uebG2), and compares the
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
//                      README.md), and "b004-appendix-g" (UKAAF B004 Appendix G,
//                      Quoted material — same schema as section-9, both gold files
//                      no-braille prose-only "Examples"; gold files live under
//                      tests/gold/ukaaf-b004/appendix-g/, see that directory's own
//                      README.md).
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
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const TABLES = louis.TABLES.uebG2;
const translate = (t, tf) => louis.translate(t, TABLES, tf || null);

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
const UKAAF_GOLD_DIRS = { 'b004-6-9': 'sections-6-9', 'b004-11': 'section-11', 'b004-appendix-g': 'appendix-g', 'b004-appendix-j': 'appendix-j' };
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

  const rawRows = Array.isArray(print.rows) ? print.rows : [];
  const rows = rawRows.map((r, ri) => (Array.isArray(r) ? r : [r]).map((v, ci) => cellToModel(v, limitations, `rows[${ri}][${ci}]`)));

  const hasTable = headerRow.length > 0 || rows.length > 0;
  let table = null;
  if (hasTable) {
    table = { type: 'table', format: 'auto', headers: headerRow, rows };
    if (headerGroups) table.headerGroups = headerGroups;
    const noBox = /\bno box\b|\bnot enclosed\b|\bunboxed\b|\bno border\b|without.*\bbox\b/i.test(printFeatures);
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
      if (!noBox) {
        table.titlePosition = 'in-box';
        limitations.push(`print gives no field for whether the table heading sits before or after the box's top line (BANA 11.3.1b "follow print"); defaulted to titlePosition:'in-box' (the majority pattern found across this section's own worked samples) — see standards-findings.md F-4.`);
      }
    }
    if (noBox) {
      blocks.push(table);
    } else {
      blocks.push({ type: 'box', blocks: [table] });
    }
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
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments(b.text);
      const para = { type: 'para', ...tos };
      const standaloneHeading = prevKind === 'heading' && !(prevHeadingLevel === 1 && headingRunLen > 1);
      if (standaloneHeading || RUN_IN_HEADING_RE.test(b.features || '')) para.blocked = true;
      blocks.push(para);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
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
    // Compound marker (an ordinal, e.g. "2.") PLUS a separate print bullet — only
    // example-8-5a/-5b use this. Emboss's list formatter (formatList, document.mjs)
    // has no way to combine an ordinal marker with a bullet indicator on one item; the
    // ordinal alone is built, and the missing bullet is recorded as a limitation.
    limitations.push(`${where}: has both an ordinal marker (${JSON.stringify(marker)}) and a print bullet ("${bullet}") — Emboss's list formatter cannot combine an ordinal marker with a bullet indicator on one item; built with the ordinal marker only, the bullet is dropped (not representable).`);
    if (marker) item.marker = esc(marker);
  } else if (marker === '•') {
    item.marker = '•'; // Emboss's one supported bullet correspondence (BANA 8.6.2a "Dot")
  } else if (marker && BULLET_GLYPHS.has(marker)) {
    limitations.push(`${where}: print bullet "${marker}" has no braille correspondence built in Emboss besides the primary dot bullet • (F-33) — dropped, not guessed.`);
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
      blocks.push({ type: 'heading', level: b.level, ...tos });
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
      blocks.push({ type: 'para', ...tos });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      if (b.columns && Number(b.columns) > 1) {
        limitations.push(`list has print.blocks columns:${b.columns} (print laid this list out in ${b.columns} side-by-side columns) — Emboss has no side-by-side list-column layout (F-34); built, and will render, as a single column.`);
      }
      const built = items.map((it, i) => buildListItem(it, limitations, `list item ${i}`));
      if (built.some((it) => it.blank)) {
        limitations.push(`list has one or more skeleton-outline blank-fill items (print gives a division number with no text, e.g. a ruled blank line to write on) — Emboss has no dot-5 blank-fill mechanism (F-36); built with empty text, the blank-fill symbol is not representable.`);
      }
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'box') {
      const inner = buildBlocks8(b.blocks, limitations);
      blocks.push({ type: 'box', blocks: inner });
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
//                        `colorNote` (BANA 7.5.2 — Sample 7-2's "yellow"/"orange")
//                        has no field anywhere in Emboss's box model (F-72, no
//                        colour/screened-box support at all); recorded as a
//                        limitation only, never built into the box's own line.
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
      }
      if (b.colorNote) {
        limitations.push(`box has print.blocks colorNote:${JSON.stringify(b.colorNote)} (BANA 7.5.2 — the box's own opening line should embed this colour name in transcriber's-note indicators, one blank cell before the border resumes) — Emboss has no colour/screened-box support at all (F-72); built with an ordinary, unmarked box line.`);
      }
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
      if (isSymbolMark) {
        noteBlock.segments = [{ type: 'noteref', text: mark }, { type: 'text', text: esc(entry.text || '') }];
      } else {
        noteBlock.text = esc(entry.text || '');
      }
      noteBlocks.push(noteBlock);
    } else {
      limitations.push(`${where}: noteref mark "${mark}" has no matching print.notes[] entry — built with no note text.`);
    }
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
      if (!hasRef) {
        blocks.push({ type: 'para', ...textOrSegments(raw) });
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
        if (hasRealText) blocks.push({ type: 'para', segments: result.segments });
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
      blocks.push({ type: 'para', continuation: !!b.continuation, ...tos });
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
      if (!page) {
        limitations.push(`pagenum block has no text — not built.`);
        continue;
      }
      blocks.push({ type: 'pagenum', page: esc(page) });
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
    } else if (kind === 'quote') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'para', style: 'quote', ...tos });
    } else if (kind === 'epigraph') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'para', style: 'epigraph', ...tos });
    } else if (kind === 'attribution' || kind === 'source') {
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'attribution', ...tos });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => buildListItem({ text: it }, limitations, `list item ${i}`));
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'box') {
      const inner = buildBlocks9(b.blocks, limitations);
      const boxBlock = { type: 'box', blocks: inner };
      if (b.title != null && String(b.title).trim()) boxBlock.title = esc(String(b.title).trim());
      blocks.push(boxBlock);
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — not itself transcribed into this sample's braille, or needs a block type this schema has no room for): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
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
// There is no markup token for this in Emboss's own cell-markup DSL, and no `tf` bit for
// it either — TYPEFORM (cell-markup.mjs) only has italic/underline/bold, never script or
// any of UEB's five transcriber-defined indicators (standards-findings.md F-T1). Every
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
      limitations.push(`${where} uses transcriber-defined typeform symbol #${n} (BANA 5.5.1/5.9.1 — colour, double underline, a shape outline, etc.) on "${inner}" — Emboss's TYPEFORM bitmask has no bit for any of the five UEB transcriber-defined indicators or for script (F-T1); built as plain unstyled text, the attribute is not representable.`);
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
  for (const b of printBlocks) {
    if (!b || typeof b !== 'object') continue;
    const kind = b.kind;
    if (kind === 'heading') {
      if (b.level == null) {
        limitations.push(`heading block "${b.text}" has no level in print.blocks — not built.`);
        continue;
      }
      const tos = textOrSegments5(b.text, limitations, 'heading');
      blocks.push({ type: 'heading', level: b.level, ...tos });
    } else if (kind === 'paragraph') {
      const tos = textOrSegments5(b.text, limitations, 'paragraph');
      blocks.push({ type: 'para', ...tos });
    } else if (kind === 'list') {
      const items = Array.isArray(b.items) ? b.items : [];
      const built = items.map((it, i) => {
        const tos = textOrSegments5(it, limitations, `list item ${i}`);
        return tos.segments ? { segments: tos.segments } : { text: tos.text };
      });
      blocks.push({ type: 'list', kind: 'list', items: built });
    } else if (kind === 'other') {
      limitations.push(`print block kind 'other' (not modeled — braille-only content with no print-side counterpart in this schema, e.g. a transcriber's-note symbols key): "${String(b.text ?? '').slice(0, 160)}"`);
    } else {
      limitations.push(`unrecognised print.blocks kind "${kind}" — not modeled: "${String(b.text ?? '').slice(0, 160)}"`);
    }
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
function buildBlocks13(printBlocks, limitations) {
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
      // A poem's own trailing signature/credit line (e.g. Sample 13-4's "e.e. cummings" after
      // the poem) — BANA §9.4's attribution margin (cell 5, blocked), formatAttribution,
      // document.mjs:767-773 — distinct from a centred byline directly under a title, which
      // this schema instead models as its own `kind:'heading'` level-1 line (see above).
      const tos = textOrSegments(b.text);
      blocks.push({ type: 'attribution', ...tos });
    } else if (kind === 'poem') {
      const stanzas = Array.isArray(b.stanzas) ? b.stanzas : [];
      stanzas.forEach((st, si) => {
        if (si > 0) blocks.push({ type: 'indicator', kind: 'line' });
        const lines = (st && Array.isArray(st.lines)) ? st.lines : [];
        for (const ln of lines) {
          if (!ln) continue;
          let raw = String(ln.text ?? '');
          if (!raw.trim()) continue;
          if (ln.number != null && String(ln.number).trim()) raw = String(ln.number).trim() + ' ' + raw;
          const tos = textOrSegments(raw);
          const blk = { type: 'play', subtype: 'verse', style: 'verse', ...tos };
          const lvl = Number(ln.indent) || 0;
          if (lvl > 0) blk.level = lvl;
          blocks.push(blk);
        }
      });
    } else if (kind === 'other') {
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
  return { doc: { title: null, blocks }, limitations, hasTable: hasContent };
}

const MODEL_BUILDERS = { 'section-11': buildModel11, 'section-4': buildModel4, 'section-8': buildModel8, 'section-7': buildModel7, 'section-1': buildModel1, 'b004-6-9': buildModel1, 'section-16': buildModel16, 'b004-11': buildModel16, 'section-9': buildModel9, 'b004-appendix-g': buildModel9, 'section-5': buildModel5, 'section-13': buildModel13, 'b004-appendix-j': buildModel13 };
function buildModel(sample) {
  const fn = MODEL_BUILDERS[SECTION];
  if (!fn) throw new Error(`No model builder registered for --section ${SECTION}`);
  return fn(sample);
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
const IS_UKAAF_SECTION = SECTION === 'b004-6-9' || SECTION === 'b004-11' || SECTION === 'b004-appendix-j';
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

export { GOLD_DIR, STATUS_FILE };

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
  const diffOps = diffLines(expected.lines, actual.lines);
  const isMatch = expected.lines.length === actual.lines.length && expected.lines.every((l, i) => l === actual.lines[i]);
  const coreUnrepresentable = (SECTION === 'section-4' || SECTION === 'section-8' || SECTION === 'section-7' || SECTION === 'section-1' || SECTION === 'b004-6-9' || SECTION === 'section-16' || SECTION === 'b004-11' || SECTION === 'section-9' || SECTION === 'b004-appendix-g' || SECTION === 'section-13' || SECTION === 'b004-appendix-j')
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
