# Gold examples — BANA Braille Formats 2016, §1 (Basic Principles and General Formats)

## What these files are

25 JSON files, one per worked example/sample named in the section's own table of
contents (§1.18) and running rule text: the 20 inline **Examples**
(`example-1-1.json` … `example-1-20.json`) and the 5 numbered **Samples**
(`sample-1-01.json` … `sample-1-05.json`).

Each file has the same top-level shape as the §4/§7/§8/§11 precedents, with one
schema extension for this section — `print.page`:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": {
    "page": { "runningHead", "printPageNumber", "features" },
    "blocks": [...], "notes", "surroundingText", "printFeatures"
  },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.page` records this section's own subject matter — the running head and print
page number that appear on braille page furniture (BANA §1.8, §1.11) — separately
from `print.blocks[]`'s ordinary body content, since §1 is largely ABOUT that
furniture rather than paragraphs/headings/lists in their own right (those are
covered by §4/§8/§9, reused here only where a sample happens to need one).

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — same convention as §4/§7/§8.
- `{ kind:"paragraph", text, features, continuation }` — an ordinary `para` block.
  `continuation:true` marks a paragraph that is itself only a RUNOVER/continuation
  of a sentence begun before this excerpt, or of the same sentence across a
  print-page turn (BANA/UKAAF's own margin rules give a paragraph's FIRST line an
  indent — BANA 1.9.2's 3-1 indented format is this section's own default,
  gold-verified against Sample 1-2's braille; a runover/continuation line is
  always flush, cell 1, regardless of style) — see `buildModel1`'s own comment in
  `Emboss/scripts/gold-run.mjs`.
- `{ kind:"list", items:[...], features }` — a `list` block, items built by the
  same `buildListItem` helper §7/§8 already use (`marker`, `level` 1-based,
  `text`). This section's own lists use plain numeric markers with NO trailing
  period where print itself omits one (Sample 1-1's `"1"`/`"2"`, gold-verified: the
  source's own braille shows `#a`/`#b` with no dot-4 period sign after them) and
  ordinary `"1."`/`"a."`/`"b."` markers elsewhere (Example 1-10).
- `{ kind:"table", headers, rows, features }` — built with the same `cellToModel`
  helper §11/§7 use. `headers` is an array of ROWS (a single-row array for this
  section's own reference tables, matching §11/§7's own two-tables-in-one-field
  convention) — used only for Examples 1-12/1-13, the guide's own letter/number and
  word/number page-numbering reference tables.
- `{ kind:"box", title?, blocks:[...] }` — recursed exactly as §7/§8's own boxes.
  Used once, for Sample 1-5's poem box.
- `{ kind:"pagenum", text, features }` — a document `{type:'pagenum', page}` block:
  BANA's mid-braille-page print-page-change indicator (1.11.3, a full-width row of
  unspaced dots-36 ending in the new page number) or UKAAF's centred page-turn
  indicator (B004 §8). Used ONLY where a worked example's own braille shows this
  indicator as running content (Examples 1-9/1-10, Samples 1-1/1-2) — never
  synthesised from `print.page.printPageNumber`, which is documentary only (see
  below).
- `{ kind:"other", text, features }` — never modeled; recorded as a limitation,
  exactly like §4/§7/§8's own `other` handling. Used for print-only illustrations
  (Examples 1-1/1-2/1-11), braille-only page-layout mechanics with no print
  original given at all (Examples 1-3 through 1-6, 1-9's/1-14 through 1-17's own
  placeholder text), and page-thumbnail/mock-up content Emboss's document model has
  no shape for.

## `print.page.runningHead` / `print.page.printPageNumber` — documentary, not built

BANA 1.8.2/1.11.2 (and UKAAF B004 §6): a print page number that begins at the TOP
of a braille page is placed at the END of the SAME line as the running head, with
no indicator dashes. Emboss's own running-head/page-1-title machinery is real and
directly tested (`Emboss/tests/book_title_running_head.test.mjs`), but it only
activates when this runner's shared per-page furniture (`suppressHeader`) is OFF —
turning it on for this section would force a spurious leading blank line 1 and a
trailing braille-page-number line 25 onto EVERY OTHER sample too (BANA reserves
those two lines whenever a document has any print-page or title furniture at all,
`document.mjs`'s `linesPerPage`), and most of this section's own worked examples
are deliberately a PARTIAL slice of a real 25-line page (lines 4-11, lines 22-25
continuing onto a new page's lines 1-5, etc.), not a complete page — that
reservation would corrupt otherwise-clean comparisons. `suppressHeader` is
therefore kept ON here, matching every other gold section's own `OPTS`
(`gold-run.mjs`), and `print.page.runningHead`/`printPageNumber` are read only for
documentation and always recorded as a **limitation** rather than built — this is
a harness-scope limitation, not an Emboss defect (Examples 1-7, 1-15; Sample 1-5).

## How these files were made

1. Two independent Sonnet transcriptions of the section (runs "A" and "B") already
   existed, each having read `references/_text/braille-formats-2016.txt` (lines
   512-1389) and the BANA PDF page images (`references/bana/braille-formats-2016.pdf`,
   PDF page = printed page + 16, confirmed against the footer of PDF page 17
   reading "1-1" and PDF page 43 reading "1-27").
2. Every field was diffed programmatically between the two runs
   (`compare-gold-1/diffall.py`, scratch working copy) — see `differences.md` for
   the complete per-file account. Both runs independently reported finding NO
   disagreement between the source `.txt` and the rendered PDF page images anywhere
   in this section; every disagreement found here was between the two RUNS' own
   modelling choices, resolved by re-reading the primary source directly (not by
   picking a side) — see "Where the two runs disagreed" below.
3. `braille.lines` were re-derived directly from `references/_text/braille-formats-2016.txt`
   by exact byte-offset inspection (Python, `repr()`), not copied from either run:
   the source's own left-margin/line-number field width was measured and stripped
   per block (not assumed), U+2800 blank-cell characters converted to plain spaces,
   trailing spaces stripped — matching the section-8/11 precedent's own convention.
4. Six braille lines — Example 1-7 line 1, Example 1-14 line 1, Example 1-15
   line 1, Example 1-17 lines 1-2, and Sample 1-4's two facing-page lines with a
   right-flush combined page number — extract far longer than the stated 40-cell
   page width (rule 1.7.1) because the source `.txt`'s own plain-text rendering of
   a title/number set beneath a raster cover-image inserts a run of ordinary ASCII
   filler spaces rather than a literal one-space-per-cell blank-cell run. Both
   independent runs found the same artefact; run B's reconstruction to exactly 40
   cells (keeping the confirmed left content and right content exactly as
   extracted, filling the gap to 40) is used here, **independently re-verified** by
   direct measurement: for every one of the six lines, `leftLen + rightLen +
   reconstructedGap = 40` and the reconstructed gap is always ≥ the 3-cell minimum
   rule 1.8.2/1.11.2 requires (9, 22, 12, 10/12, 4, 29 cells respectively) — run A's
   verbatim (unreconstructed) lines would themselves contradict the section's own
   stated 40-cell rule, so are not used.

## Where the two runs disagreed (resolved, not picked)

See `differences.md` (this reconciliation's own working copy) for the complete
field-by-field account. In summary:

- **Sample 1-1's own dual scenario**: the source shows the SAME print content (a
  two-item numbered list ending one print page, a paragraph opening the next)
  transcribed TWO ways, to contrast where a print-page break falls relative to a
  braille-page boundary (rule 1.11.3.b). Run A modelled both as a non-standard
  `braille.variants` array; run B flattened both PLUS the source's own English
  subheadings into one `lines` array (unusable directly — English captions are not
  braille). Resolved by keeping ONLY the mid-braille-page variant as
  `braille.lines`/`print.blocks` — the one variant `buildModel1`'s `pagenum`-block
  mechanic can actually reproduce without fabricating unseen preceding content —
  and recording the other variant in `braille.notes` for completeness only.
- **Sample 1-5's `#bjab`/`#bjac`/`#bjad`/`#bjae` tokens**: run A left these
  undecoded ("do not resolve to plain arabic digits"); run B decoded them as years
  2012-2015. Independently re-derived here using the SAME `#`+letters-a-through-j
  digit convention already established without dispute elsewhere in this section
  (Example 1-17's `#acge`=1375): `b=2,j=0,a=1,b=2` → "2012", and likewise for the
  other three — run A's claim was checked and found incorrect; run B is right.
- **Sample 1-2's "Others" (not "Otters")**: confirmed directly against the source
  `.txt` and the PDF page image (p.22) by both independent runs; a prior reference
  index's own "Otters" was the error.
- **Paragraph indent/continuation**: gold-verified empirically against Emboss
  itself (not assumed): Sample 1-2's own two paragraphs use DIFFERENT margins —
  the one before the page turn is a runover of off-excerpt prose (flush, no
  indent); the one after the heading is a fresh paragraph (2-cell indent, BANA
  1.9.2's indented 3-1 default). See `buildModel1`'s own `continuation` field.
- **List item markers**: Sample 1-1's own braille shows bare `#a`/`#b` (no
  trailing period sign); Example 1-10's shows `#a4`/`;a4`/`;b4` (WITH a trailing
  period). Both are literal, re-verified per file against `braille.lines`, not
  assumed uniform across the section.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-1 --update-status`: **3
match** (Example 1-8, Example 1-9, Sample 1-2), **4 mismatch**, **13
not-representable**, **5 no-braille**. See `differences.md` for the
mismatch-by-mismatch cause, and `standards-findings.md` for the Emboss-side
findings each not-representable/mismatch sample traces to:

- **F-45** (implied/inferred print page numbers), **F-46** (combined/omitted
  page-number ranges), **F-47** (facing-pages-as-one-page), **F-48**
  (letter/number page-identifier transformation) — Examples 1-12/1-13
  (no-braille: reference tables, not real pages), Samples 1-3/1-4/1-5.
- **F-49** (no spelled-out/alphabetic page-number feature) — Examples 1-14
  through 1-17.
- **F-54** (no end-of-volume/end-of-book statement feature) — Examples 1-3
  through 1-6.
- **F-59** (volume-label generator is dead code) — Example 1-20.
- **F-66** (UKAAF PIL never carries a print page number) — cross-referenced from
  `b004-6-9`'s own README (b004-6-2).
- **Harness-scope, not a defect** (running head needs real per-page furniture this
  runner keeps off — see above) — Examples 1-7, 1-15, Sample 1-5.
- **Mismatch, liblouis-level, not an Emboss format-layer issue** — Sample 1-1 (the
  UEB "to" wordsign is not applied by Emboss's own `uebG2` table call in this
  context — a translation-table matter, not a document-formatting one, per the
  same "delegated to liblouis" precedent as F-68); Examples 1-18/1-19 (the italics
  passage-indicator `.1` has no plain-text input to build from — this gold corpus
  gives `print.blocks[].text` as plain strings, with no typeform/emphasis carrier
  for "this word is italicised in print" the way §7/§8's `textOrSegments` markup
  DSL supports for bold/underline — recorded as unresolved, not a new finding,
  since the underlying mechanism (segments with a typeform) already exists and
  simply wasn't exercised by this reconciliation's own plain-text fields).
- **Mismatch, wrap-granularity** — Example 1-10 (print's own full 4-choice answer
  list vs. the braille excerpt's own `444`-truncated 2-choice slice; expected).

## Known uncertainties

Recorded per-file in each JSON's own `uncertain` array; in summary:

- Six reconstructed over-long lines (see "How these files were made" §4): the
  reconstructed gap width is derived arithmetically (40 − left − right), not
  independently pixel-verified against the PDF.
- Sample 1-1's Variant 1 (print-page break exactly at a braille-page boundary) is
  documented but not compared (see "Where the two runs disagreed").
- Sample 1-5's timeline wording (lines 7-9, 14, 16) is read from the braille
  contractions cross-checked against the infographic's own visible print labels,
  not independently re-typeset from a legible print original.

## Scope note on `illustrates`

Per the §4/§7/§8/§11 precedent: one rule id per file, `quote` is the entirety of
that specific rule's own text.
