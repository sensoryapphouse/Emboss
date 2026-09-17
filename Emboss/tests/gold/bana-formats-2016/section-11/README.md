# Gold examples — BANA Braille Formats 2016, §11 (Tables and Related Columns)

## What these files are

36 JSON files, one per worked example/sample in §11: the 9 inline **Examples**
(`example-11-1.json` … `example-11-9.json`) and the 27 numbered **Samples**
(`sample-11-01.json` … `sample-11-27.json`). This is every worked
example/sample named in the section's own table of contents (§11.19) and in
the running rule text — none skipped.

Each file has the same shape as the two source transcriptions it was built
from, plus two extra fields:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "caption", "headers", "rows", "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

- `sources` is always `["A", "B"]`: both independent transcriptions were
  compared for every field.
- `resolution` is a short prose note. Where the two runs already agreed (once
  a couple of purely cosmetic schema choices below were normalized), it says
  so in one generic sentence. Where they disagreed, it says which run was
  right, and why, with a PDF page or source `.txt` line number as evidence.

## How these files were made

1. Two independent Sonnet transcriptions of the section (runs "A" and "B")
   already existed, each having read the section from `references/_text/
   braille-formats-2016.txt` (lines 8236–9994) and the PDF page images
   (`references/bana/braille-formats-2016.pdf`, pages 283–339).
2. Every field of every item was diffed programmatically between the two
   runs. Where they disagreed — or, for `braille.lines`, even where they
   agreed — the source `.txt` was independently re-extracted with a small
   script that (a) strips the fixed left-margin padding the PDF-to-text
   pipeline adds to every line (9 literal spaces for inline Examples, or a
   fixed 5-character line-number field such as `"1    "` / `"25   "` for
   numbered Samples), and (b) converts every U+2800 blank-cell character to
   a plain space. This reconstruction was checked, line by line, against
   both runs across the whole section.
3. Wherever a disagreement turned on print content that isn't in the `.txt`
   at all (most print tables are pictures, not text) or on a specific dot
   pattern, the actual PDF page image was opened and read directly. Every
   page reference in a `resolution` note was read this way, not assumed.
4. Page attribution (`pdfPages`) was cross-checked mechanically: the `.txt`
   extraction embeds a form-feed character at the start of every new PDF
   page, and the source's own running page footer ("11-*NN*") appears right
   before each one, giving `PDF page = 282 + printed page NN` for every page
   boundary in the section, not just the two or three the task brief
   happened to mention.
5. Findings were written up in `../../../../../docs/../../compare-gold/
   differences.md` (see the repository's scratch working copy) and folded
   back into each file's `resolution`/`uncertain` fields and into this
   README's uncertainty list below.

Where the `.txt` and the PDF's dot image disagreed about the actual braille
content, the PDF was treated as the authority (per the section's testing
method); in practice no such disagreement was found — every character
difference between the two transcription runs turned out to be one run's own
slip (a dropped indent space, an extra guide-dot character, a wrong page
number), not a genuine text-vs-image conflict. See `differences.md` for the
full per-item evidence.

## Schema notes: blank cells and page breaks

- **Blank braille cells** (U+2800 in the source `.txt`): a line that is
  *entirely* blank cells is recorded as `""`. A line that has blank cells
  only at its start or in the middle is recorded with plain spaces in their
  place (column 1 of the string is always braille cell 1 — the fixed
  left-margin padding described above has already been removed).
- **`braille.width`** is the section's declared, nominal braille-page width
  in cells: **40**, for every item that has at least one braille line. This
  was confirmed directly, not assumed: every top/bottom box-rule line in the
  section (the runs of `7777...` and `gggg...` characters) measures exactly
  40 characters once the margin is stripped. Two items
  (`example-11-1`, `example-11-7`) are explicitly "(Print Only)" and have no
  braille at all; their `width` is `null`. A handful of items
  (`sample-11-16`, `sample-11-20`, and similarly `sample-11-09`,
  `sample-11-11`, `sample-11-24`, `sample-11-26`) have a line 1 that runs to
  41 characters because a short 3-character reference/page code is appended
  after the top box rule; this is preserved verbatim in `braille.lines` and
  does not change the declared `width`.
- **`braille.pageBreaks`** is an array of
  `{ "afterLineIndex": <1-based index into braille.lines>, "type": "explicit" | "implicit", "note": "..." }`
  objects. Only three items in this section have one:
  - `sample-11-06` — explicit `—New Braille Page—` marker text in the source,
    after line 8.
  - `sample-11-21` — no marker text; the left-hand and right-hand facing
    braille pages are detected because the line numbering silently restarts
    at 1, after line 12.
  - `sample-11-26` — explicit `—New Braille Page—` marker text, after line
    19 (though both halves happen to fit on the same PDF page image).

  Every other item has `pageBreaks: []`.
- **`print.headers`** is always an array of header *rows*, each an array of
  per-column cell strings (never a single flat array) — this is needed
  because several tables have a two-row, column-spanning header (e.g. "In
  Millions of Dollars" over "Total / Direct / Grants"). Where a header cell
  spans multiple columns, its text is repeated in each column it spans
  (matching the print image). Where a column genuinely has no heading text
  in print, the cell is `""` — never a made-up placeholder like `"(row)"` or
  `"(country)"`.

## Known uncertainties and source errata

Most items have no residual uncertainty. Where one remains, it is recorded
on that item's own `uncertain` array. Two are significant enough to flag
here explicitly, because they read like genuine errata in the source book
itself rather than anything to do with either transcription run, and Paul
should decide whether to record them as-is or investigate further:

1. **`sample-11-17` (Skeleton Table with Column Headings)** — the source's
   own transcriber's note says "Print table has five blank rows," but the
   print table in the PDF page image (p. 324, printed 11-42) has only
   **four** blank ruled rows below the header. This was checked directly
   against the page image, not inferred. (Separately: braille legitimately
   shows only *two* blank guide-dot rows, not four or five — that part is not
   an error, it is rule 11.9.1.c(1), "At least two rows must be included in
   the skeleton table.")

2. **`sample-11-24` (Listed Table Format)** — in the "Presidential
   Administrations" table, Washington's Secretary of War is filled in print
   (Henry Knox 1789-1795; Timothy Pickering 1795-1796; James McHenry
   1796-1797), and Secretary of Navy is genuinely blank in print (the office
   did not exist until 1798). The braille, however, gives Secretary of War
   just the token `444` (line 24) — the same token used elsewhere in this
   section as a continuation/ellipsis marker, not as three names — while
   Secretary of Navy correctly gets the three-dot-5 blank-entry marker
   (`"""`, line 25, matching rule 11.16.1.h). So the *blank* marker is
   correctly placed on the row that actually is blank in print; the anomaly
   is that Secretary of War's three names are simply missing from the
   braille, replaced by `444`. This was re-checked directly against the PDF
   page image (p. 332-333) and confirmed it is not a page-break or
   `.txt`-extraction artifact — the full 25-line braille block and the full
   print table are each complete on a single page. It is transcribed here
   exactly as the source gives it, character for character, without
   "fixing" it. Whether this is a known erratum in the printed book, a
   transcription gap specific to this worked sample, or an undocumented
   convention is left for Paul.

A few smaller, lower-confidence items (exact dot-pattern verification not
independently re-derived from the raster image; a transcriber's-note phrase
whose exact word-by-word mapping to a rule's roles isn't fully certain; etc.)
are listed only on the affected item's own `uncertain` array — see
`example-11-3`, `example-11-5`, `example-11-6`, `example-11-9`,
`sample-11-01`, `sample-11-02`, `sample-11-08`, `sample-11-09`,
`sample-11-12`, `sample-11-13`, `sample-11-18`, `sample-11-19`,
`sample-11-21`, `sample-11-26`, and `sample-11-27`.

## Scope note on `illustrates`

The `illustrates` field in every file is run A's version (a `{rule, quote}`
object naming one specific numbered rule and quoting it verbatim), rather
than run B's free-form paragraph. This was a schema preference for testability,
not an exhaustive re-verification of every rule citation against the full
rule text of §11 — that cross-check belongs to the "Extract" stage of the
standards-testing method, not this "Gold examples" stage. One citation was
spot-checked and corrected in passing (`example-11-9`: run B's "rule 11.6.5"
was wrong — that rule is "Segmented Numbers," unrelated; the example
illustrates 11.7.1.j, the numeric-passage-indicator sub-rule, which run A
had cited correctly).
