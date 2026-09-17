# Gold examples — BANA Braille Formats 2016, §8 (Lists)

## What these files are

27 JSON files, one per worked example/sample named in the section's own table of
contents (§8.10) and running rule text: the 10 inline **Examples**
(`example-8-1.json` … `example-8-9.json`, with `example-8-5a`/`example-8-5b` for the two
bullet-glyph variants of the same list) and the 17 numbered **Samples**
(`sample-8-01.json` … `sample-8-17.json`).

Each file has the same top-level shape as the §4/§11 precedents, plus the same two extra
fields:

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

- `{ kind:"heading", level, text, features }` — `level` is `1`/`2`/`3`
  (centred/cell-5/cell-7), **re-derived directly from this section's own agreed
  `braille.lines`** for every file that has one (never taken from either transcription
  run's own raw "level" field — both runs' own values were unreliable, see below).
- `{ kind:"paragraph", text, features }` — ordinary running prose, or this book's own
  literal `"text"` placeholder standing in for elided surrounding running text (see
  Schema notes).
- `{ kind:"list", items:[...], columns, features }` — a single list, print's own vertical
  or side-by-side arrangement. Unlike §4's flat `list-item` siblings, §8's own gold
  schema nests `items[]` directly under one `list` block (there is exactly one list per
  worked illustration in this section). Each item is
  `{ marker, level, text, bullet, features }`:
  - `level` is **1-based** (1 = main entry, 2/3/4 = successive subentry levels) — the
    section-8 buildModel8 model builder converts this to Emboss's own 0-based
    `nestedMargins`/`listMaxLevel` convention (level−1) before building the document
    model; see `Emboss/scripts/gold-run.mjs`'s own comment on `buildListItem`.
  - `marker` is the print item's own ordinal/lettered/roman-numeral marker text (`"1."`,
    `"A."`, `"a."`, `"I."`) where print numbers/letters the item, the literal bullet
    glyph (`"•"`, `"○"`, `"■"`, `"√"`, …) where print bullets it, or `null` for a plain
    unmarked item.
  - `bullet` is set **only** where an item carries BOTH an ordinal marker AND a separate
    print bullet (Example 8-5a/8-5b's item 2) — a value from BANA 8.6.2.a's own
    correspondence-table names (`"dot"`, `"solid-square"`, …). Emboss's list formatter
    has no way to combine the two (standards-findings.md F-42); buildModel8 builds the
    ordinal alone and records the dropped bullet as a limitation.
  - a skeleton-outline blank-fill entry (Example 8-7) has `text: null` — print gives a
    division number with no fill text (a ruled blank line for the reader to write on),
    and Emboss has no dot-5 blank-fill mechanism to build the rest from
    (standards-findings.md F-36).
- `{ kind:"box", blocks:[...] }` — print's own ruled box (BANA §7): a nested container,
  recursed into and built into a document `{type:"box", blocks:[...]}` block. Used only
  where the box's entire content is itself representable (`sample-8-04`); where a box
  contains content this schema has no way to build at all (a braille-only transcriber's
  note with no print counterpart, `sample-8-13`), the box is deliberately left out of
  `print.blocks` and the gap is recorded in that file's own `resolution` instead of
  forcing an incomplete box.
- `{ kind:"other", text, features }` — never modeled; recorded as a limitation. Used for
  content with no print-side counterpart at all reachable from this schema's block kinds
  (a print-invisible braille running-head/reference code, or Example 8-8/8-9's isolated
  page-25 guide-text label, which is page-layout machinery per 8.8.5, not list content).

- `sources` is always `["A", "B"]`: both independent transcriptions were compared for
  every field.
- `resolution` is a short prose note. Where the two runs already agreed, it says so.
  Where they disagreed, it says which was right and why, with a source `.txt` line
  number, a PDF page, or a direct measurement as evidence — see `differences.md` (the
  working copy of this reconciliation's own evidence) for the full per-file reasoning.

## How these files were made

1. Two independent Sonnet transcriptions of the section (runs "A" and "B") already
   existed, each having read `references/_text/braille-formats-2016.txt` (lines
   5681–6524) and the PDF page images (`references/bana/braille-formats-2016.pdf`, pages
   197–226; `PDF page = printed page + 196`, confirmed for the whole section by checking
   every printed-page-footer boundary from 8-1 through 8-30).
2. Every field of every item was diffed programmatically between the two runs
   (`compare-gold-8/diffall.mjs`, scratch working copy). `braille.lines` was
   byte-identical between the two runs on **every one of the 27 files** — the print-side
   fields (free-text `features`/`notes`/`printFeatures`/`surroundingText`, `illustrates`,
   and several items' own `level`/`marker` fields) accounted for every disagreement.
3. Every heading's level (1/2/3) was **re-derived directly** from the section's own
   agreed `braille.lines`, never taken from either run's own "level" field: both runs'
   own values were unreliable in different ways — run A left several `null`, and run B
   used a fixed literal "5" for every heading regardless of its ACTUAL position,
   including two (`sample-8-11`, `sample-8-12`) whose own `braille.notes` prose
   contradicted that literal value by correctly calling them "the centered heading."
   Resolved the same way the section-4 precedent resolved its own heading-level
   disagreements: counting the exact run of literal U+2800 blank-cell characters in the
   source `.txt` before the heading text (4 = cell-5, 6 = cell-7 fixed regardless of
   text length; anything else must match the centring formula `floor((40−len)/2)` for
   that heading's own text length) — done for every one of this section's 8 heading
   occurrences (`example-8-3`, `sample-8-03/04/05/11/12/14/15`), not assumed from either
   run's account. Two (`sample-8-11`, `-12`) turned out centred; the rest cell-5.
4. Two genuine miscounts, found only by going back to the primary source rather than
   picking either run, were corrected:
   - `sample-8-08`'s print word list: run A counted 87 items, run B counted 86 (and
     B's own ordering was shifted by one from "into" onward). Recounted directly against
     a freshly-rendered 300dpi PNG of the PDF page image (216): **88** words in six
     columns of 15/15/15/15/15/13, confirmed as one single alphabetical sequence
     column-major.
   - Example 8-8/8-9's guide-text line: run A stripped a flat 25-character margin
     (giving the right total width, 40, but the wrong leading-blank count); run B
     measured the right leading-blank count (via the same U+2800-counting method as
     step 3) but kept the `.txt`'s own literal ASCII-space count for the gap before the
     trailing page number, which — like `sample-8-08`'s own already-flagged
     inter-column spacing — is not a reliable cell count from this PDF-to-text
     pipeline. Reconciled by combining B's correct leading-blank count with BANA
     8.8.5.a's own "center guide text" rule (confirming the leading count via
     `floor((40−len)/2)`) and the section's own established 40-cell total-width
     invariant for the trailing gap.
5. `example-8-7`'s skeleton-outline blank-fill marker (transcribed identically by both
   runs as the two-character ASCII sequence `.-`, but left **uncertain** against rule
   8.8.2's "three dot 5s") was **settled, not left open**: decoded exactly via Emboss's
   own canonical BRF-ASCII table (`Emboss/engine/brf-ascii.mjs`, `BRF64`) rather than by
   eye — `.` = dots {4,6}, `-` = dots {3,6}, i.e. two ordinary two-dot cells, not three
   dot-5 cells (dot-5 alone is `"` in this same table — compare the literal `"""`
   guide-dot rows already used in the section-11 precedent). This is now a settled
   finding: the worked example's own braille does not literally follow rule 8.8.2's own
   prescription for the blank-fill symbol.
6. `example-8-5a`/`example-8-5b`'s book-title items: run A transcribed them ALL-CAPS,
   run B retyped them Title-Case. Confirmed ALL-CAPS directly against the PDF page image
   (204). `example-8-6`'s "Louis L'Amour": run A used a straight apostrophe, run B a
   curly one (`’`); confirmed curly directly against the PDF page image (205).
7. `sample-8-04`'s print.blocks were reshaped into an explicit nested `{kind:"box",
   blocks:[heading, list]}` block (run A had the right content — heading, list, and two
   placeholder paragraphs — but as a flat sibling sequence with no box grouping; run B
   dropped the placeholder paragraphs even though its own `braille.notes` describes
   them) so `buildModel8` can build the box's actual top/bottom rule pair, rather than
   leaving box construction unrepresentable the way `sample-8-13`'s box (which contains
   an un-modelable braille-only note) has to.
8. Rule quotes (`illustrates.quote`) follow the section-4 precedent's own convention:
   the **entirety** of the specific rule id named, including any trailing "(See Sample/
   Example N…)" cross-reference that is literally part of that clause's own printed
   sentence (matching how the precedent's own `sample-4-02`/`sample-11-24` keep theirs) —
   not an editorial trim. The one incomplete quote found (`example-8-5a`/`-5b`'s clause
   8.7.1.a, missing its own final sentence in run A and merged with clause b's separate
   text in run B) was restored to the clause's own complete, exact text.

## Where the two runs (or the `.txt` itself) could not be trusted at face value

See `differences.md` (the working scratch copy of this reconciliation) for the complete
per-file evidence trail. In summary, beyond the heading-level, `sample-8-08` count, and
Example 8-8/8-9 margin items above (§3-4):

- `sample-8-08`'s inter-column blank-cell spacing in `braille.lines` remains **not**
  independently pixel-verified (carried forward from run A's own flagged uncertainty) —
  word content/order is now independently confirmed against the print image, but the
  exact number of blank cells between the three braille columns should not be relied on
  as pixel-exact.
- A handful of Samples' line 1 carry a trailing 2-3 character reference code (`#i`,
  `#aj`, `#de`, `#hi`, …) whose exact purpose was not determined by either run; each is
  now recorded as its own `{kind:"other"}` print block (so it is scored as an explicit,
  documented limitation rather than a silent, unexplained mismatch) rather than repeated
  verbosely file by file.

## Schema notes

- **Blank braille cells** (U+2800 in the source `.txt`): a line that is entirely blank
  cells is recorded as `""`; a line with blank cells only at its start/middle keeps them
  as plain spaces — matching the section-11 precedent exactly.
- **This book's `"text"` placeholder**: several Samples excerpt only the middle of a
  print page, and represent the elided surrounding running text with the literal braille
  word "text" followed by a `444` ellipsis marker (dot-3 ×3), sometimes on both the
  opening AND closing line of the excerpt (`sample-8-04`). This is kept as an ordinary
  `paragraph` block with `text:"text"` — the `444` ellipsis itself has no print-side
  input to build from and is recorded as a limitation, not invented.
- **`braille.pageBreaks`** is non-empty for exactly two items: `example-8-5b` (implicit —
  line numbering resets 25→1 with no marker text) and `sample-8-08` (explicit — literal
  "—New Braille Page—" marker text after line 25, recorded ONLY in `pageBreaks`, never as
  its own entry in `braille.lines` — matching the section-11 precedent, `sample-11-06`).
- **`columns`** is set on a `list` block only where print itself lays the list out in
  side-by-side columns. Emboss has no side-by-side list-column layout at all
  (standards-findings.md F-34) — every columned sample is expected, and documented, to
  mismatch on exactly that account, collapsed to a single column.
- All braille widths are `40`, confirmed the same way as the section-4/11 precedents.

## Known uncertainties

Most files have an empty `uncertain` array. Two are carried forward from the source runs
with no further resolution possible from the given materials:

1. **`example-8-1`** — the exact dot-by-dot rendering of the parenthesis-like inline
   (a)/(b)/(c) markers was transcribed verbatim but not independently decoded against
   print's own parentheses.
2. **`example-8-5b`** — the carried-over "text (cont.)" line's exact spacing (shown only
   as context, not this example's own graded content) was not independently
   pixel-verified.

## Scope note on `illustrates`

Per the §4/§11 precedent: one rule id per file, `quote` is the entirety of that specific
rule's own text (see "How these files were made" §8 above for the one convention
clarification this section needed: the entire quoted text includes any trailing
cross-reference that is part of the clause's own printed sentence).

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-8 --update-status`: **5 match, 2
mismatch, 20 not-representable** (0 no-braille — every file in this section carries
braille). See `differences.md` for the mismatch-by-mismatch cause, grouped by
`standards-findings.md` finding (F-33 through F-38 pre-existing; F-42/F-43/F-44 new,
found by this reconciliation's own gold-vs-Emboss comparison).
