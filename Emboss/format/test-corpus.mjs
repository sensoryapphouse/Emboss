import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { makeMathToBrf } from './node-maths-helper.mjs';

// Repeatable Node harness: for each of the 8 UKAAF gold corpus samples, build
// a document model from the print source, run it through formatDocument in
// UKAAF mode at the sample's own geometry, and diff CONTENT line-by-line
// against the gold .brf.
//
// Both sides are reduced to "content lines" (running heads / blank
// page-number-only lines and form-feed page breaks removed) before
// diffing, because a raw byte/line diff would be dominated by pagination
// noise that is orthogonal to what's being tested here (page assembly
// itself is already gold-gated byte-exact by test-pages.mjs). This harness
// is about the BLOCK FORMATTER: paragraphs, headings, lists, notes.
//
// Every sample's gold BRF opens with UKAAF-sample-series front matter that
// is NOT derivable from the print source at all: a "Sample N" cover line
// and a "Note: the new UEB signs used in this sample..." block explaining
// braille signs used, closed by a dot-2s indicator line (B004 Glossary:
// "indicator line ... placed after a section is complete"). That block is
// skipped on the gold side (see stripFrontMatter) and reported separately
// as OUT-OF-SCOPE — it is publisher series boilerplate, not something a
// general document-to-BRF converter should ever synthesise. The sample's
// own title (e.g. "The Three Wishes") IS modelled and IS diffed.
//
// HONESTY NOTE: this harness does NOT claim the corpus "passes". Today only a
// minority of content lines match gold byte-for-byte; the per-sample comments
// below document WHY (transcriber judgment calls, unimplemented features,
// liblouis table behaviour) but those explanations are documentation, not
// exemptions — every non-identical line is counted as a MISMATCH. What the
// harness enforces is a REGRESSION GATE: format/corpus-models/baseline.json
// records the per-sample match count last accepted, and the run exits 1 if
// any sample drops below its baseline (or throws). Improvements are reported
// and can be locked in with --update-baseline.
//
// Usage: node format/test-corpus.mjs [--update-baseline] [sampleNum ...]
//   e.g. node format/test-corpus.mjs 1 2      (only samples 1 and 2)
//        node format/test-corpus.mjs          (all 9 sample files)
//        node format/test-corpus.mjs --update-baseline   (rewrite baseline.json)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;
const CORPUS = path.join(projectRoot, 'corpus', 'ukaaf');
const BASELINE_PATH = path.join(__dirname, 'corpus-models', 'baseline.json');

// ---------------------------------------------------------------------
// Gold-file loading + boilerplate skip + page-furniture stripping
// ---------------------------------------------------------------------

function loadGoldPages(file) {
  const raw = fs.readFileSync(path.join(CORPUS, file), 'latin1');
  return raw.split('\x0c').map((pg) => {
    const lines = pg.split('\r\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  });
}

// UKAAF running head = page 1's line 1 (blank but for the top-right braille
// page number) and, from page 2 on, line 1 (title centred + page number).
// Drop line 1 of every page to get pure content lines, matching how
// test-pages.mjs itself defines "content lines" for assemble().
function stripRunningHeads(pages) {
  const out = [];
  for (const pg of pages) out.push(...pg.slice(1));
  return out;
}

// Skip the leading blank(s) + "Sample N" cover line + "Note: ..." block +
// its closing dot-2s indicator line. Returns the content lines starting at
// the sample's own title.
function stripFrontMatter(contentLines) {
  const idx = contentLines.findIndex((l) => /^\s*"3(1{5,})\s*$/.test(l));
  if (idx === -1) return { body: contentLines, frontMatter: [], title: [] };
  // The "Sample N" cover label is always a distinct centred line — find it.
  const sampleIdx = contentLines.findIndex((l) => /^\s*,SAMPLE #/.test(l));
  // Title/subtitle runs from just after the cover label up to (not
  // including) the "Note:" explanation block start.
  const noteIdx = contentLines.findIndex((l) => /^\s*,NOTE3/.test(l));
  const titleStart = sampleIdx === -1 ? 0 : sampleIdx + 1;
  const titleEnd = noteIdx === -1 ? idx : noteIdx;
  const title = contentLines.slice(titleStart, titleEnd);
  return {
    title,
    frontMatter: contentLines.slice(0, idx + 1),
    body: [...title, ...contentLines.slice(idx + 1)],
  };
}

// ---------------------------------------------------------------------
// Our own output: strip running heads/page furniture the same way.
// ---------------------------------------------------------------------
function ourContentLines(brf) {
  const pages = brf.split('\x0c').map((pg) => {
    const lines = pg.split('\r\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  });
  return stripRunningHeads(pages);
}

// ---------------------------------------------------------------------
// Diff + report helpers
// ---------------------------------------------------------------------

// Categoriser: only MECHANICALLY recognisable diff classes get a descriptive
// tag (so a reader can see at a glance which mismatches are the known
// quote-sign / italics / closing-indicator classes). The tag is purely
// informational — a tagged line is still a MISMATCH and still counts against
// the sample. Anything not mechanically recognisable is plain "MISMATCH".
function defaultCategorize(i, o, g) {
  // The gold's closing colons indicator line (end of whole document) — an
  // OPTIONAL indicator line per B004 Glossary ("can be... a blank line"),
  // not modelled since our doc models don't add a synthetic trailing block.
  if (o === '<none>' && /^\s*"3{4,}\s*$/.test(g)) return 'MISMATCH (gold closing indicator line; not modelled)';
  return 'MISMATCH';
}

function diffSample(name, ours, gold, categorize) {
  const n = Math.max(ours.length, gold.length);
  let matches = 0;
  const diffs = [];
  for (let i = 0; i < n; i++) {
    const o = ours[i] ?? '<none>';
    const g = gold[i] ?? '<none>';
    if (o === g) { matches++; continue; }
    const cat = (categorize && categorize(i, o, g)) || defaultCategorize(i, o, g);
    diffs.push({ line: i + 1, ours: o, gold: g, cat });
  }
  console.log(`\n=== ${name}: ${matches}/${n} content lines match gold (${n - matches} mismatch) ===`);
  for (const d of diffs) {
    console.log(`  [${d.cat}] line ${d.line}`);
    console.log(`    ours: ${JSON.stringify(d.ours)}`);
    console.log(`    gold: ${JSON.stringify(d.gold)}`);
  }
  return { matches, total: n, diffs };
}

// ---------------------------------------------------------------------
// Per-sample document models (built from the print PDFs; see corpus/ukaaf/).
// ---------------------------------------------------------------------
import { sample1 } from './corpus-models/sample1.mjs';
import { sample2 } from './corpus-models/sample2.mjs';
import { sample3 } from './corpus-models/sample3.mjs';
import { sample4 } from './corpus-models/sample4.mjs';
import { sample5 } from './corpus-models/sample5.mjs';
import { sample6 } from './corpus-models/sample6.mjs';
import { sample7a } from './corpus-models/sample7a.mjs';
import { sample7 } from './corpus-models/sample7.mjs';
import { sample8 } from './corpus-models/sample8.mjs';

const SAMPLES = [
  {
    n: '1', file: 'sample1.brf', geometry: { width: 38, depth: 25 }, build: sample1,
    // All remaining diffs trace to one root cause: the print PDF renders
    // dialogue with U+2018/2019 (single curly quotes), which liblouis
    // correctly translates per RUEB 7.6.2 as the two-cell single-quote sign
    // (",8" / ",0"); gold instead has the plain double-quote sign ("8" /
    // "0"). Verified against the native oracle directly:
    //   printf '“Test”' | lou_translate en-us-brf.dis,en-ueb-g2.ctb -> 8TE/0
    //   printf '‘Test’' | lou_translate en-us-brf.dis,en-ueb-g2.ctb -> ,8TE/,0
    // CONFIRMED as a legitimate, RUEB-sanctioned transcriber choice (not a
    // bug) by cross-checking sample 4 ("Some Jokes"): its print source mixes
    // “double” and ‘single’ curly quotes across different jokes, yet gold
    // renders EVERY joke's dialogue with the bare double-quote sign
    // regardless of which the print used. RUEB rule 7.6.4: "It is
    // permissible for the assignment of the double and single quotation
    // marks throughout a print text to be exchanged. Explain this change in
    // a transcriber's note." That's exactly this. The extra cell then
    // cascades into the greedy word-wrap, shifting a word or two across a
    // line break on the following line(s) — same root cause, not a second bug.
    categorize: (i, o, g) => {
      const QUOTE_NOTE = 'MISMATCH (quote-sign class: RUEB 7.6.4 permits exchanging double/single quote assignment; gold uses the double-quote sign for all dialogue — see comment)';
      if (/,8|,0/.test(o) && !/,8|,0/.test(g) && (/8|0/.test(g))) return QUOTE_NOTE;
      // Line 24 (0-based 23): the extra cell used by ",0" vs "0" on the
      // previous line pushes the word "^WS" ("was") across the line break —
      // a downstream word-wrap cascade of the same single root cause above.
      if (i === 23) return QUOTE_NOTE + ' [wrap cascade from previous line]';
      return null; // fall through to default categorizer
    },
  },
  {
    n: '2', file: 'sample2.brf', geometry: { width: 38, depth: 25 }, build: sample2,
    // Verified (see BUILD_LOG / session notes): once italics markers, the
    // ingredient-list indent scheme (B004 §10 Ex1 "1-3 + blank lines", which
    // our formatList implements, vs Ex2 "5-1, no blank lines", which gold
    // uses here — both are named "good practice examples" in B004, i.e. a
    // transcriber's free choice) and the heading-indicator-line choice are
    // set aside, the word stream is a byte-for-byte match with ZERO
    // content diffs. Every remaining diff below is one of those three
    // known, understood judgment calls (or a knock-on line-count shift
    // caused by them) — not a new independent bug.
    // NOTE: the explanation above is documentation, not an exemption — every
    // differing line still counts as a MISMATCH against the baseline gate.
    categorize: (i, o, g) => {
      if (/\.1|\.7|\.'/.test(o) || /\.1|\.7|\.'/.test(g)) return 'MISMATCH (italic typeform class: indicators not implemented)';
      return null; // fall through to default categorizer
    },
  },
  {
    n: '3', file: 'sample3.brf', geometry: { width: 38, depth: 25 }, build: sample3,
    // Fully reconciled character-for-character (verified in session) once
    // these seven independent, understood causes are set aside — none are
    // formatting-engine bugs:
    //  1. Headline wrap: gold balances the 4-line centred headline shorter
    //     than a full 38-cell greedy fill would (transcriber's aesthetic
    //     choice; B004 doesn't mandate a wrap policy for titles).
    //  2/5. Bold "WASHINGTON" (^1) and italic report title (.7...') —
    //     typeform not implemented (OUT-OF-SCOPE, R15).
    //  3. "CO2" -> gold has the subscript-2 sign (;5#2); our docx parser
    //     doesn't read w:vertAlign (subscript/superscript) run properties,
    //     so plain "CO2" text has no way to know it should be subscripted.
    //     Real gap, but a new *parser* feature, not a formatting bug.
    //  4. "WASHINGTON – A" dash spacing: liblouis keeps spaces around a
    //     spaced en-dash (–) and drops them for a closed em-dash (—) —
    //     verified against the native oracle both ways. Gold's spacing
    //     implies the transcriber's source used a closed dash; the print
    //     PDF extraction shows a spaced en-dash. Print-source ambiguity.
    //  6. Phone number "+61 7 3839 2677": gold uses the UEB numeric-space
    //     sign between groups (this sample's own Note explicitly documents
    //     it); a literal space in plain text translates as an ordinary word
    //     space instead. Needs phone-number-pattern detection to insert the
    //     special numeric-space character before translation — a new
    //     feature, OUT-OF-SCOPE for a conservative bug-fix pass.
    //  7. "to be at" -> liblouis's en-ueb-g2.ctb contracts "be" to the
    //     whole-word sign here; gold spells it out. Reproduced identically
    //     by the native lou_translate oracle (not a WASM parity bug), and
    //     engine tables are out of bounds per the task's guardrails.
    //  8. "ipcc.ch" -> liblouis Grade 2 contracts "ch"; gold spells it out.
    //     RUEB 10.12.3 says contractions ARE normally used inside URLs
    //     embedded in text (with a worked example contracting "chicken" in
    //     a URL), so this looks like a liblouis-table-specific edge case
    //     for a 2-letter final segment, not a formatting-layer bug.
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '4', file: 'sample4.brf', geometry: { width: 38, depth: 25 }, build: sample4,
    // Fully reconciled: content is character-for-character identical (verified
    // in session) once two known judgment calls are set aside: (a) gold
    // splits the first joke's single print paragraph into two braille
    // paragraphs at "Finally, he finished..." — a transcriber readability
    // choice for a long paragraph, no rule violation; (b) the RUEB 7.6.4
    // quote-sign exchange (see sample 1) confirmed systematic across every
    // joke here regardless of print's single/double curly quotes. The
    // "***" breaks use the 3-asterisks indicator line (B004 Glossary R17) —
    // this sample exposed that form was entirely unimplemented; fixed in
    // format/document.mjs's indicatorLine().
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '5', file: 'sample5.brf', geometry: { width: 38, depth: 25 }, build: sample5,
    // Fully reconciled character-for-character (verified in session) after:
    //  - heading indicator-line choice (as sample 2);
    //  - RUEB 7.6.4 quote-sign exchange (as sample 1/4);
    //  - a liblouis quote-directionality nuance: closing ’ after an
    //    all-caps word (RETURNS’) comes out as a bare apostrophe, not the
    //    closing-quote sign — an engine-side disambiguation heuristic
    //    (RUEB 7.6.7-7.6.10 acknowledge such cases are genuinely
    //    ambiguous), out of bounds since engine tables aren't touched;
    //  - the "17″×1¼″" inch-mark directional rendering (same class of
    //    liblouis nondirectional-quote inference, not fully reproduced
    //    even after restoring the print's likely original characters);
    //  - phone-number numeric-space sign (as sample 3, OUT-OF-SCOPE, needs
    //    phone-pattern detection to insert the special character);
    //  - one apparent print-vs-master wording difference, "seal" (print)
    //    vs "seals" (gold's braille) — left as printed rather than silently
    //    "corrected" in the model, since that would be putting words in
    //    the source's mouth rather than transcribing it faithfully.
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '6', file: 'sample6.brf', geometry: { width: 38, depth: 25 }, build: sample6,
    // Fully reconciled: content is character-for-character identical
    // (verified in session). The only diff class is indentation — gold's
    // glossary entries are flush cell-1 (no first-line indent, no runover
    // indent, no blank lines), which is neither an existing "para" (3-1)
    // nor "list" (1-3/5-1) shape. There's no dedicated "definition list /
    // glossary" block type in the document model — OUT-OF-SCOPE (a real,
    // valid feature gap worth adding later, not a rule violation to fix
    // now: B004 doesn't mandate one specific glossary layout).
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '7a', file: 'sample7a-simple-maths.brf', geometry: { width: 38, depth: 27 }, build: sample7a, hasMaths: true,
    // OUT-OF-SCOPE by design: maths is a separate, later module per
    // SETUP_AND_VALIDATION.md's scope boundary. This sample specifically
    // shows the SAME derivation twice in two different maths notations
    // side-by-side for comparison — a presentation this pipeline doesn't
    // attempt (one notation per mode). Included only to confirm the
    // pipeline runs end-to-end at the sample's own 38x27 geometry without
    // crashing (it does) and to exercise the `math` block code path via
    // the Node maths helper (format/node-maths-helper.mjs).
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '7', file: 'sample7-intermediate-maths.brf', geometry: { width: 38, depth: 25 }, build: sample7, hasMaths: true,
    // OUT-OF-SCOPE by design: maths module gated separately (see sample 7a).
    // Equations aren't extractable from the print PDF as text (OMML/image
    // content -> blank gaps in pdftotext output); this model only carries
    // the surrounding narrative text plus one representative `math` block
    // to confirm the pipeline runs end-to-end without crashing.
    // (no categorize override: the notes above are documentation, not an exemption — every differing line is a MISMATCH)
  },
  {
    n: '8', file: 'sample8-computer-code.brf', geometry: { width: 38, depth: 25 }, build: sample8,
    // OUT-OF-SCOPE by design (see corpus-models/sample8.mjs): the literal
    // code block (grade-1 passage indicators, uncontracted, cell-1) isn't
    // modelled — no `code` block type exists. Surrounding prose paragraphs
    // DO match gold exactly. One incidental finding: the print PDF's own
    // title says "Computer Program Extract" but gold's braille title says
    // "COMPUTER PROGRAM EXAMPLE" — a genuine print-vs-master wording
    // discrepancy (not silently corrected in the model, same principle as
    // sample 5's "seal"/"seals").
    categorize: (i, o, g) => {
      if (i === 0) return 'MISMATCH (title class: print PDF says "Extract", gold braille says "Example" — print-vs-master wording discrepancy, not corrected)';
      return null; // fall through to default categorizer (code block layout is not implemented — still a MISMATCH)
    },
  },
];

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);
  const mathToBrf = makeMathToBrf('ukaaf');

  const argv = process.argv.slice(2);
  const updateBaseline = argv.includes('--update-baseline');
  const wanted = argv.filter((a) => !a.startsWith('--'));
  const results = [];

  for (const s of SAMPLES) {
    if (wanted.length && !wanted.includes(s.n)) continue;
    const goldPages = loadGoldPages(s.file);
    const goldContent = stripRunningHeads(goldPages);
    const { body: goldBody, frontMatter, title } = stripFrontMatter(goldContent);
    const skipped = frontMatter.length - title.length; // "Sample N" line + Note block + indicator

    console.log(`\n--- Sample ${s.n}: skipping ${skipped} front-matter line(s) (OUT-OF-SCOPE, publisher series boilerplate) ---`);

    const doc = s.build();
    const opts = {
      mode: 'ukaaf', width: s.geometry.width, depth: s.geometry.depth,
      translate, mathToBrf: s.hasMaths ? mathToBrf : undefined,
    };
    let brf;
    try {
      brf = formatDocument(doc, opts);
    } catch (e) {
      console.log(`\n=== Sample ${s.n}: THREW: ${e.stack} ===`);
      results.push({ n: s.n, matches: 0, total: goldBody.length, threw: true });
      continue;
    }
    const ourLines = ourContentLines(brf);

    const r = diffSample(`Sample ${s.n}`, ourLines, goldBody, s.categorize);
    results.push({ n: s.n, ...r });
  }

  // ---------------------------------------------------------------------
  // Baseline regression gate. baseline.json = { "<sample n>": { matches, total } }
  // ---------------------------------------------------------------------
  let baseline = null;
  if (fs.existsSync(BASELINE_PATH)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); } catch (e) {
      console.log(`\nERROR: could not parse ${BASELINE_PATH}: ${e.message}`);
    }
  }

  console.log('\n\n========== SUMMARY (per-sample match/total vs baseline) ==========');
  let totalMatches = 0, totalLines = 0, regressions = 0, improvements = 0, threw = 0;
  const newBaseline = baseline ? { ...baseline } : {};
  for (const r of results) {
    totalMatches += r.matches;
    totalLines += r.total;
    const b = baseline && baseline[r.n];
    let verdict;
    if (r.threw) { verdict = 'THREW'; threw++; }
    else if (!b) { verdict = 'no baseline'; }
    else if (r.matches < b.matches) { verdict = `REGRESSION (baseline ${b.matches}/${b.total})`; regressions++; }
    else if (r.matches > b.matches) { verdict = `improved (baseline ${b.matches}/${b.total})`; improvements++; }
    else { verdict = 'at baseline'; }
    console.log(`Sample ${r.n.padEnd(2)}: ${String(r.matches).padStart(3)}/${String(r.total).padEnd(3)} content lines match  -- ${verdict}`);
    newBaseline[r.n] = { matches: r.matches, total: r.total };
  }

  // Report the corpus-wide figure against the FULL corpus size even when a
  // subset was requested, so the number is never inflated by cherry-picking.
  const fullTotal = wanted.length
    ? Object.values(newBaseline).reduce((a, b) => a + (b.total || 0), 0)
    : totalLines;
  console.log(`\nUKAAF gold corpus: ${totalMatches}/${fullTotal} lines match (baseline-gated)${wanted.length ? ` [subset run: samples ${wanted.join(', ')}]` : ''}`);

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + '\n');
    console.log(`Baseline written to ${BASELINE_PATH}`);
    process.exitCode = threw ? 1 : 0;
    return;
  }

  if (!baseline) {
    console.log(`FAIL: no baseline at ${BASELINE_PATH} — run with --update-baseline to create it.`);
    process.exitCode = 1;
  } else if (threw || regressions) {
    console.log(`FAIL: ${regressions} sample(s) below baseline, ${threw} threw.`);
    process.exitCode = 1;
  } else {
    console.log(`OK: no sample below baseline${improvements ? ` (${improvements} improved — run --update-baseline to lock in)` : ''}.`);
    process.exitCode = 0;
  }
})();
