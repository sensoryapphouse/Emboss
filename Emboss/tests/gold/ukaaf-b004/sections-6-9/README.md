# Gold examples — UKAAF B004, §6-9 (Running Headers, Page Numbering, Print Page Turn Indicators, Paragraphs)

## What these files are

7 JSON files, one per named item in these four short sections: the two
good-practice statement + worked-example pairs for §6 (`b004-6-1.json`
description, `b004-6-2.json` example) and §8 (`b004-8-1.json`,
`b004-8-2.json`), §7's single good-practice description (`b004-7-1.json`, no
worked example given in the source), and §9's two good-practice examples
(`b004-9-1.json`, `b004-9-2.json`, both prose-only — see below).

Same schema as `../../bana-formats-2016/section-1/*.json` (see that section's own
README for the full field-by-field description); these files are formatted in
**UKAAF mode**, not BANA (`gold-run.mjs`'s `--section b004-6-9` sets
`mode:'ukaaf'` and Emboss's own UKAAF default width, 38 cells — B004 states no
fixed cells-per-line page width anywhere in the source, unlike BANA's stated 40
cells (Formats 1.7.1), so 38 is Emboss's own default rather than a value read off
the standard; this matches the width the `ukaaf-b004/appendix-e` gold precedent
independently measured and confirmed for its own two worked tables).

## How these files were made

1. Two independent Sonnet transcriptions ("A" and "B") already existed, each
   having read `references/_text/B004.txt` lines 163-255 and the UKAAF PDF page
   images (`references/ukaaf/presentation-guidelines-B004.pdf`; PDF page number =
   printed footer number directly, confirmed against the footers of PDF pages
   6-8).
2. Every field was diffed programmatically against the parallel BANA §1
   reconciliation's own working copy (`../../../../compare-gold-1/differences.md`
   in the task's scratch folder — see that file for the complete per-item
   account). Both runs independently reported finding no `.txt`/PDF
   disagreement anywhere in these four sections.
3. `braille.lines` were re-derived directly from `references/_text/B004.txt` by
   exact line inspection, keeping the source's own literal spacing (B004 gives no
   stated page width to reconstruct a line to, unlike BANA's six over-long lines
   in the parallel §1 reconciliation) — recorded as extracted, with the
   uncertainty flagged per file rather than "corrected" against an unstated width.

## Structural choices

- `b004-8-2`'s print-page-turn block uses `{kind:'pagenum', text:'74'}` (run A's
  choice, matching `buildModel1`'s schema directly) rather than run B's
  `{kind:'other', text:'[page turn to 74]'}` placeholder — B004 §8's own
  mechanism (`standards-findings.md` F-67) is already recorded as DONE, and this
  is the block shape that exercises it.
- `b004-8-2`'s continuation sentence ("slotting into place...") carries
  `continuation:true` (same sentence resumes after the page turn, per the rule's
  own "unless there is a new paragraph" clause — cell 1, no fresh indent).
- `b004-6-1`/`b004-7-1`/`b004-8-1`/`b004-9-1`/`b004-9-2` are all prose-only
  good-practice DESCRIPTIONS with no worked print/braille pair in the source
  (confirmed against the PDF page images by both independent runs) — modelled as
  a single `{kind:'other', text:null}` block each; status: no-braille.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section b004-6-9 --update-status`: **5
no-braille**, **1 not-representable** (`b004-6-2`), **1 mismatch**
(`b004-8-2`).

- `b004-6-2` (the §6 page-information-line worked example): Emboss's own UKAAF
  running head shows the braille page number and a centred title, but never a
  print page number at all (`standards-findings.md` F-66) — even with this
  runner's shared per-page furniture enabled (it is kept off here, see
  `bana-formats-2016/section-1/README.md`'s own explanation of why), the print
  page number "25" side of this worked example could not be reproduced.
  not-representable, F-66.
- `b004-8-2` (the §8 page-turn-indicator worked example): the indicator mechanism
  itself is confirmed correct (centred, no space before the number; the
  continuation sentence resumes at cell 1) — F-67 stands — but this specific
  worked example's own print mock-up hard-wraps its sentence at particular points
  to fit its own illustration, which a continuous 38-cell reflow does not
  reproduce byte-for-byte. mismatch, documented wrap-granularity cause, not a
  defect in the indicator mechanism.

## Scope note on `illustrates`

One rule id (`"B004 §N"`) per file, matching this appendix's own precedent
(`ukaaf-b004/appendix-e/README.md`) for a source with no numbered sub-rules —
`quote` is the section's own "Guiding principles" paragraph.
