# Gold examples — BANA Braille Formats 2016, §6 (Illustrative Materials)

## What these files are

23 JSON files, one per worked example/sample named in the section's own running rule
text and its "Samples" appendix (§6.14):

- **4** inline **Examples**: `example-6-1.json` … `example-6-4.json`.
- **16** numbered **Samples**: `sample-6-1.json` … `sample-6-16.json`.
- **3** embedded, unnumbered `Sample:` block wordings quoted inline within running rule
  text (illustrative print wording for a transcriber's note, no worked braille of their
  own — matching the §3 gold precedent's own convention for this exact situation),
  named after the rule that cites them: `bana-6.4.2-sample.json`, `bana-6.8.2c-sample.json`,
  `bana-6.10.4-sample.json`.

Each file has the same top-level shape as the §3/§4/§7/§8/§9/§13 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — level 1 = centred, 2 = cell-5, matching
  every other section's own convention. A print line break inside a two-line title
  (`sample-6-7`'s "Pedigree of Santa / Cruz Sweetheart Orchid", `sample-6-13`'s "Change
  in Distribution of the / American Workforce, 1870-1920") is written as a `\n` in
  `text`; `buildModel6` splits it into two CONSECUTIVE heading blocks at the same level
  rather than one block with an embedded newline, so each print line is centred
  independently with document.mjs's own `HEADING_JOIN_TIERS` suppressing the blank line
  between them — reproducing the book's own two-line title exactly (confirmed:
  `sample-6-7` matches byte-for-byte).
- `{ kind:"paragraph", text, features }` — ordinary running prose, `textOrSegments()`'d
  exactly like every other section (Emboss's own `*bold*`/`_italic_`/`` `code` `` cell-
  markup DSL where print itself shows emphasis — needed here for `sample-6-1`'s bold
  "Diving's early history.", `example-6-3`'s bold "Views of anger", `sample-6-4`'s bold
  "Order"/"Form").
- `{ kind:"list", items }` — reuses `buildListItem` exactly as the §7/§8/§9/§16
  precedents do: numeric/ordinal `marker` for §6.8.2's ascending-ancestral numbered
  lists (`sample-6-6`, `sample-6-7`), `level` (1-based, converted to Emboss's 0-based
  internally) for §6.5.1/6.8.1/6.9.1/6.10.3/6.10.6's nested lists, `'•'` for §6.11.3-
  style bulleted lists (`sample-6-14`).
- `{ kind:"table", headers, rows }` — reuses `buildTable7`'s own shape (`headers` is an
  array of header ROWS, i.e. `[["1870","1920"]]`, matching that function's own
  `rawHeaders[rawHeaders.length-1]` convention) for §6.11.3's bar-graph-as-table option
  (`sample-6-13`).
- `{ kind:"box", title, blocks }` — reuses `buildBlocks7`'s own nested-box recursion for
  §6.12.1a's boxed screenshots (`sample-6-15`, two separate boxes in one file).
- `{ kind:"pagenum", text }` — BANA 1.11.3's mid-braille-page print-page-change
  indicator, reusing the §1/§3 gold precedent's own `{type:'pagenum', page}` document
  block (`sample-6-11`, `sample-6-16`).
- `{ kind:"note", text, features }` — a standalone transcriber's note
  (`formatTranscriberNote`), used for every note in this section that is NOT paired
  with an image caption: §6.5.1/6.7.3c/6.8.1c/6.8.2c/6.10.2/6.13.1c's own explanatory/
  methodology notes, and §6.6/6.9/6.13's "Section N"/"Note," embedded labels.
- `{ kind:"figure", figure:{type, description, labels}, description? }` — **never
  built directly.** `figure.figure` is pure documentation (what the image depicts, its
  print labels) — confirmed, repeatedly, during this reconciliation, to often not
  correspond to anything the sample's own braille excerpt actually renders at all
  (`example-6-1`/`example-6-2`'s own `figure.description`, `sample-6-5`/`6-6`/`6-7`/
  `6-9`'s own flat `figure.labels`). Only a **sibling** `description` string (NOT
  nested inside `figure`) is ever built, and only two ways:
  1. merged into ONE document `graphic` block together with the very NEXT
     `print.blocks` entry, if it is `kind:"caption"` — BANA 6.2.2's caption+description
     image model (`document.mjs`'s real `traceOrFormatPrintImage`/`printImageParts`),
     the SAME mechanism that emits the "[Illustration]" transcriber's-note label per
     6.2.2b when the caption doesn't itself identify the picture (`example-6-1`,
     `example-6-3`, `sample-6-1`, `sample-6-12`, `sample-6-15`);
  2. with no caption to pair with, built ALONE as a standalone `{type:'note'}` block
     (`sample-6-2`'s own reconciliation finding: with nothing to attach a label to, the
     real braille never carries an "[Illustration]" line at all — going through the
     image-label path would fabricate a line the book's own braille never has).

  A `caption` block reached any other way (no preceding `figure`, or a SECOND caption
  immediately after one already consumed — a photo credit/source citation, 6.2.2c) is
  never built; recorded as a limitation citing F-168.

## How these files were made

1. Two independent transcription runs ("gold-6-A", "gold-6-B") already existed, both
   produced by the same model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's
   own `summary.md`), each reading `references/_text/braille-formats-2016.txt` (lines
   4349-5344) and the PDF page images (`references/bana/braille-formats-2016.pdf`,
   pages 145-183; PDF page = printed page + 144).
2. Per the task's own standing instruction, **agreement between the two runs was
   treated as no evidence** (both runs share one underlying model, and the §3
   reconciliation had already found six shared errors, including invented print text,
   between an "independent" pair produced the same way). Every field of every file —
   agreements included — was checked against the primary sources directly:
   - **Braille**: every `braille.lines` array was independently re-derived from
     `source-6.txt` (`compare-gold-6/decode.mjs`, using `engine/brf-ascii.mjs`'s
     `unicodeBrailleToBrf` on the book's own Unicode braille glyphs, after stripping
     each excerpt line's own numeric line-number prefix) — never taken from either
     run's own array. This caught margin errors in **12 of the 23 files** (see
     `differences.md`, kept in the session's scratch folder per the task's own
     instructions, not in the repository) — some by a uniform offset (an un-stripped
     line-number margin), some inconsistent line-by-line (`sample-6-5`), and, most
     importantly:
   - **A filing-script bug, not a transcription error**: the in-session script that
     normalised both runs' `braille.lines` before reconciliation (stripping line-number
     fields) wrongly turned every all-digit braille line into a blank line (fixed
     17 Sep 2026: it now blanks only one- or two-digit residue). This
     silently deleted the book's own excerpt-truncation ellipsis (`444`, BRF ASCII for
     three dot-5s) in six files, and the BANA §7.1.3 top box-rule line (`7` × 42) in
     two — found and restored by re-decoding the affected ranges directly; see
     `differences.md`'s own "Session-wide correction" section for the full list.
   - **Print text**: every print field was forward-translated through Emboss's own UEB
     Grade-2 translator (`Emboss/engine/louis.mjs`, table `uebG2`) and diffed,
     word-for-word, against the (now-corrected) agreed `braille.lines`; where liblouis's
     own `backTranslate()` was needed to recover wording NEITHER run had captured at
     all (`sample-6-2`'s own transcriber's note, `sample-6-6`/`6-7`'s exact note
     wording), the recovered text was always confirmed with a forward-translation round
     trip before being accepted. This process found and corrected, beyond the shared
     margin/ellipsis bugs above:
     - four cases of a shared ALL-CAPS-vs-title-case error (`sample-6-3`'s "Important
       Notice to Medical Personnel:", `sample-6-4`'s "(Please print clearly)" — the
       latter left as an `uncertain` residual capitalisation question, since a genuine
       all-caps reading does not reproduce the agreed braille's own indicator placement
       either);
     - three cases of a shared misread name/number: `sample-6-6`'s "Weir"/"Gasset"
       (should be "Wright"/"Gachet") and "1898" (should be "1908"); `sample-6-5`'s
       second "Anne 1658-1714" (should be "1718"); `sample-6-4`'s "March 6, 2011"/
       "$60051" (should be "2001"/"$65051", B alone right; A wrong on both);
     - two cases of a shared unrecorded typeform (bold, not the plain text either run
       gave): `example-6-3`'s "Views of anger", `sample-6-1`'s "Diving's early
       history." — each confirmed by testing BOTH italic and bold typeform arrays
       against the agreed braille and keeping only the one that reproduced it exactly;
     - one case of a shared invented fabrication: `sample-6-4`'s run B invented a whole
       set of address/teacher/room field values ("Address 248 Greenwood", "Teacher Mrs.
       Lee Grade 6 Room 8", …) where the agreed braille shows only an ellipsis — dropped
       entirely, not adopted;
     - two wrong `illustrates.rule` citations in run A (`sample-6-5`, `sample-6-7`: both
       copy-pasted rule 6.13.1's Slide-Presentation text onto a genealogical-chart/
       pedigree-chart sample) — B's citations were correct and are used;
     - one shared wrong `pdfPages`/mapping value each in `example-6-4` (both runs gave
       `[6]`) and `sample-6-11` (A gave 174, B's 173 is right) — recomputed directly
       from the page-footer sequence;
     - `sample-6-5`'s/`sample-6-14`'s section labels: both runs used lettered "Section
       A"/"B"/"C" where the agreed braille uses NUMBERS ("Section 1"/"2"/"3" — a UEB
       number sign, not a letter, confirmed by forward translation).
3. Two multi-option samples (`sample-6-12`, `sample-6-13`) show the SAME print content
   transcribed two valid ways (per 6.10.6/6.11.3's own "another option may be…"); to
   keep one file per original sample (matching the task's own file-count instruction),
   only one option is modelled in each — the simpler, more-representable one (a cell-5
   heading + flat list for 6-12's "Option 2"; a real table for 6-13's "Option 2") — with
   the other option's own existence and location in `source-6.txt` recorded in
   `print.notes` for anyone who wants to build it too.
4. `figure.figure`/`figure.labels` (what an image depicts, its print labels) turned out,
   across this whole section, to be almost entirely non-buildable documentation rather
   than content that is itself transcribed into braille — see the `print.blocks[]`
   schema section above for exactly which two cases DO get built. Deciding which was
   which, file by file, was the single largest piece of reconciliation work in this
   section (see `differences.md`).

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-6 --update-status`: **5 match**
(`example-6-2`, `sample-6-2`, `sample-6-6`, `sample-6-7`, `sample-6-8`), **11 mismatch**,
**3 not-representable**, **4 no-braille** (the three embedded `bana-6.*-sample` rule
illustrations plus `example-6-4`, all print-only). Every mismatch/not-representable
traces to one of the findings below, with nothing left over:

- **F-231 (new) — hard-coded "Illustration" label**: `example-6-1` (mismatch),
  `example-6-3` (not-representable, F-168 also applies), `sample-6-1`
  (not-representable, F-168 also applies), `sample-6-12` (mismatch, alongside a
  block-transition blank-line quirk noted below), `sample-6-15` (mismatch, alongside
  F-222/F-233). Every one of these files' captions fails to identify the picture
  itself (per 6.2.2b), so Emboss's own hard-coded "Illustration" label appears where
  the book uses "Photograph"/"Picture" instead — otherwise these files' image lines
  match exactly.
- **F-168 (reused) — source citations/photo credits lost**: `example-6-3`'s "David
  Madison/Corbis" credit, `sample-6-1`'s "Courtesy of Historical Diving Society, USA"
  citation — neither is built; both files are `not-representable` on this alone once
  F-231's label word is set aside.
- **F-169 (reused) — no forms support**: `sample-6-3` (mismatch — no specific
  limitation is recorded for this file so it does not classify as
  not-representable, though the underlying cause is identical), `sample-6-4`
  (not-representable — box lines and 6.7.3g's script indicators both apply).
- **F-222 (reused) — no facility to author a devised braille symbol**: `sample-6-5`'s
  marriage-line connector between spouse names (mismatch — missing symbol cells only,
  a nested-list structure that otherwise matches exactly); `sample-6-15`'s URL-quote
  symbol pair.
- **F-233 (new) — no second, independent "hyperlink" inline indicator**: `sample-6-15`,
  alongside F-231/F-222 — this file mismatches on three independent, narrow causes at
  once, not one.
- **F-171 (reused) — no slide/speaker-note semantics**: `sample-6-16` (mismatch —
  slide-number-as-page-number, the "Note," speaker-note margin/label convention, and
  the lettered-continuation page-number scheme are all unmodelled).
- **F-232 (new) — liblouis's UEB Grade-2 table adds an unneeded letter-sign before
  "c."**: `sample-6-10` — this file is otherwise a byte-for-byte match; the single
  cause is inside the third-party liblouis table, not `document.mjs`.
- **Excerpt-truncation ellipsis (documented, non-defect — matching the "444" precedent
  already established by the section-1/4/8 gold files)**: `sample-6-9` (mismatch, this
  is the ENTIRE cause — every other line matches exactly), `sample-6-11` (mismatch,
  same), `sample-6-13`'s own bar-graph-as-table rendering (mismatch — Emboss's plain
  `format:'auto'` table falls back to a long "COL n: value" form for a table whose
  category names don't fit column width, rather than the book's own aligned 3-column
  layout; recorded here rather than chased further, since the tool's own top-of-file
  comment already anticipates "a bar-graph derivation… is recorded per-sample instead
  of invented" as an accepted class of gap).
- **`sample-6-14`**: mismatches on F-171-adjacent, unmodelled page-reference tokens
  (`b#ig`/`c#ig`) and an inter-page continuation marker (`#,-`), plus the same
  excerpt-truncation ellipsis pattern as above, applied three times (once per section).

See `Emboss/docs/standards-findings.md` F-168, F-169, F-171, F-222, F-231, F-232, F-233
for the specific findings this run's mismatches trace to, and
`Emboss/tests/gold_bana_section6.test.mjs` for the regression guard.
