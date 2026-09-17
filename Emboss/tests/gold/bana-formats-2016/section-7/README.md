# Gold examples — BANA Braille Formats 2016, §7 (Boxed Material)

## What these files are

8 JSON files, one per worked example/sample named in §7's own table of contents (§7.7) and
running rule text: 5 inline **Examples** (`example-7-1.json` … `example-7-5.json`) and 3
numbered **Samples** (`sample-7-01.json` … `sample-7-03.json`). Examples 7-3, 7-4 and 7-5 are
explicitly captioned "(Print Only)" — no braille exists for them anywhere in the source.

Each file has the same top-level shape as the §4/§8 precedents:

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

- `{ kind:"heading", level, text, features }` — `level` is `1`/`2`/`3` (centred/cell-5/cell-7),
  re-derived directly from this section's own agreed `braille.lines` by counting leading
  U+2800 blank cells (matching the centring formula `floor((40−len)/2)` for a centred heading,
  or a fixed 4/6 for cell-5/cell-7) — never taken from either transcription run's own "level"
  field. Two headings were settled this way: sample-7-02's "STUDY..." line (4 leading cells =
  cell-5) and sample-7-03's "Top Nine States by Population" (5 leading cells = centred, since
  `floor((40−29)/2)=5` for its own 29-cell braille text).
- `{ kind:"paragraph", text, features }` — ordinary running prose.
- `{ kind:"list", items:[...], features }` — a single list (Example 7-4's fill-in-the-blank
  worksheet rows, Sample 7-2's numbered vocabulary items). Each item is
  `{ marker, level, text }`; this section's own lists use only plain ordinal markers
  (`"1."`, `"11."`), never a bullet.
- `{ kind:"table", headers, rows, features }` — a single flat header row (`headers[0]`) plus
  data rows; every table in this section has exactly one header row (no §11-style multi-row
  header groups are needed here).
- `{ kind:"box", title?, colorNote?, blocks:[...], features }` — print's own boxed/screened
  material (BANA §7's own subject matter), recursed into and built into a document
  `{type:"box", title?, blocks:[...]}` block. `title` is present only where the box carries
  its own accompanying heading (BANA 7.2.1e) set directly on the box rather than as a nested
  heading child — Example 7-2's "Forms of be", Example 7-5's "Studio Background" — and is
  passed straight through to Emboss's own `box.title` document-model field
  (`formatBox`, `Emboss/format/document.mjs:828`). `colorNote` (present only on Sample 7-2's
  two screened-word-list boxes) records the colour name BANA 7.5.2 requires embedded in the
  box's own opening line ("yellow"/"orange") — Emboss has no field or mechanism to build this
  into the braille at all (standards-findings.md F-72), so it is recorded for reference only.
  A box's `blocks[]` can nest another `box` (Sample 7-3's exterior/interior structure, BANA
  7.6.1) — `formatBox`'s own `boxBorders` auto-detects a box that itself holds a nested `box`
  child as the EXTERIOR border (`=`), and a box that doesn't as an INTERIOR border (`7`/`g`),
  with no separate flag needed in this schema.
- `{ kind:"other", text, features }` — never modeled; recorded as a limitation. Used in this
  section for print-invisible braille running-head/reference codes with no print-side
  counterpart at all (Sample 7-1/7-2's own trailing `#,-` codes), matching the section-8
  precedent's exact convention for the same kind of artefact.

- `sources` is always `["A", "B"]`: both independent transcriptions were compared for every
  field. `braille.lines` was byte-identical between the two runs on **every one of the 5
  braille-bearing files** in this section (Example 7-1, Example 7-2, Sample 7-1, Sample 7-2,
  Sample 7-3) — every disagreement was in the print-side fields, or (once, materially) in the
  print-side *content itself* being wrong in both runs (see "Corrections found in BOTH runs"
  below).
- `resolution` is a short prose note. Where the two runs already agreed, it says so. Where
  they disagreed, it says which was right and why, with a source `.txt` line number, a PDF
  page, or a direct measurement/experiment as evidence.

## PDF page mapping

**PDF page = printed page + 184** for all of §7, confirmed at the first footer met (PDF p.185
shows footer "7-1") and re-checked against every subsequent footer through 7-12 (PDF 196) — no
drift found anywhere in the section.

## Corrections found in BOTH runs (not a disagreement between them — a joint error against the
primary source)

Both runs agreed with each other on several points that turned out to be wrong against the
PDF page image or a direct `translate()` experiment — reconciliation caught these by treating
"both runs agree" as a hypothesis to check against the source, not as automatic truth:

1. **Example 7-1**'s quotation ("Never say 'We learn' so-and-so...") was transcribed by both
   runs with straight ASCII apostrophes around the nested quoted phrases. The print image uses
   proper typographic single quotation marks, and only the curly form (`‘We learn’`)
   reproduces the expected braille's own nested-quote indicator (`,8,we le>n,0`) when run
   through Emboss's `translate()` — confirmed by direct experiment. Corrected.
2. **Example 7-2**'s box title: both runs assumed (without checking) that "Forms of be" sits
   at a fixed cell-5 indent. Direct measurement of the source `.txt` (line 5443: 15 leading
   U+2800 cells before `,=ms ( .12`, matching the centring formula `floor((40−10)/2)=15` for
   this 10-cell braille title) shows it is actually CENTRED. (Emboss's own `formatBox` always
   renders a box title at a fixed cell-5 tier regardless — see standards-findings.md F-75 —
   so this sample is expected to mismatch on that account, not a gold-data error.)
3. **Sample 7-2**'s vocabulary list items: both runs transcribed each item as
   `"word — sentence"` with a literal em dash between the cursive vocabulary word and its
   usage sentence. The PDF page image (p.194) shows NO punctuation there at all — just two
   columns read left to right, with the word repeated in **bold** inside the sentence,
   matching the braille's own `^1` emphasis indicator before the second occurrence. Corrected
   to drop the invented em dash and mark the repeated word `**bold**` instead — this alone
   brought all ten of the yellow box's list items into an exact byte-for-byte match against
   Emboss's own generated braille.
4. **Sample 7-3**'s heading level ("Top Nine States by Population"): both runs left this
   unset. Re-derived directly from the source `.txt`'s own leading-blank-cell count (5 cells,
   matching `floor((40−29)/2)=5`) — CENTRED, not a guessed cell-5/cell-7 tier.

## Structural disagreements between the two runs

- **Example 7-2 / Example 7-5 / Sample 7-1 / Sample 7-2's box titles and nested content**: one
  run consistently nested a box's own accompanying heading as a separate sibling `heading`
  block (or flattened a nested table/list directly onto the box block with no child wrapper);
  the other used a dedicated `title` field on the box itself and/or kept explicit `blocks[]`
  nesting. Reconciled in favour of the `title`-field + explicit-nesting convention throughout,
  matching this task's own box → `{type:'box', title?, blocks:[...]}` document-model mapping
  and the section-8 precedent's own box/list nesting style.
- **Example 7-5**'s overall box structure: one run nested TWO levels of box (an untitled outer
  box wrapping a separately-titled inner "Studio Background" box); the PDF page image (p.190)
  shows only ONE rounded panel, with the two "Copyrighted Image" placeholders overlapping its
  own top edge rather than sitting in a separate outer container — the flat, single-box
  structure is used.
- **Sample 7-3**'s second paragraph and interior/exterior box nesting: one run dropped the
  panel's own second paragraph ("The following is the state-by-state population count...")
  from `print.blocks` entirely, and flattened the table directly onto the outer box with no
  interior-box nesting — even though that same run's own `braille.notes` independently
  describes both the missing paragraph and the exterior/interior `=`/`7`/`g` border structure.
  Confirmed the paragraph is genuinely present in print (PDF p.196) and that the nesting is
  required to reproduce the braille's own four border lines; the complete structure is used.

## Schema notes

- **Boxes are this section's own subject matter** — all 8 files involve at least one `box`
  block. Nested boxes-within-boxes (Sample 7-3) nest a `box` block inside another `box`
  block's own `blocks[]` array; Emboss's `boxBorders` auto-detects exterior (`=`) vs interior
  (`7`/`g`) borders purely from this nesting, with no explicit flag in the schema.
- **`colorNote`** (BANA 7.5.2) has no counterpart anywhere in Emboss's document model — see
  standards-findings.md F-72. Recorded on the box block purely for the gold file's own
  completeness; `buildModel7` logs it as a limitation and builds an ordinary, unmarked box
  line.
- **Print-invisible braille reference codes** (a trailing `#,-`-style code with no print
  counterpart) are recorded as their own `{kind:"other"}` block, exactly as the section-8
  precedent does for the same situation — this registers as a documented limitation rather
  than an unexplained mismatch.
- **This section's own gold schema has no representation for print's own per-line line
  numbers** (BANA §1.11/§15's "line-numbered text" feature, the whole subject of Example 7-1
  and rule 7.3.3.b). Modelling that fully (an Emboss `linenum` segment per print line) was out
  of scope for this reconciliation's `buildModel7`; Example 7-1 is therefore expected to
  mismatch substantially beyond the single cause standards-findings.md F-70 already documents
  — see the new finding F-76.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-7 --update-status`: **0 match, 3
mismatch, 2 not-representable, 3 no-braille** (Examples 7-3/7-4/7-5 are print-only). Every
mismatch/not-representable traces to a documented, evidence-based cause:

- **example-7-1** (mismatch) — box lines never narrow for line-numbered text (F-70) compounded
  by this section's own schema having no line-number representation at all (F-76); the
  resulting model omits Example 7-1's per-line print-page codes entirely.
- **example-7-2** (mismatch) — a box's own title is always rendered at a fixed cell-5 tier
  with no emphasis support, never centred (F-75); everything else in this file is a byte-for-
  byte match.
- **sample-7-01** (not-representable) — the sample's own braille-only `#,-` reference code has
  no print-side counterpart to build (recorded via `{kind:"other"}`); a genuine, separate
  Emboss table-layout gap (F-77 — a blanket inter-row blank line inserted whenever ANY row
  wraps, contradicted by this very sample's own second box) also contributes.
- **sample-7-02** (not-representable) — the sample's own heading-line `#,-` code (as above)
  plus BANA 7.5.2's colour-name box-line embedding, which Emboss has no mechanism for at all
  (F-72). Once the joint em-dash transcription error (see above) was corrected, all ten of the
  yellow box's list items match Emboss's own output exactly.
- **sample-7-03** (mismatch) — the braille excerpt truncates content this section's own print
  genuinely contains (only the panel's first sentence is transcribed, ending in a `444`
  omission marker; the whole second paragraph has no braille counterpart at all) — a
  documented, expected print/braille length mismatch in the source corpus itself, not an
  Emboss defect, matching the section-8 precedent's own "text/444 placeholder" convention.
