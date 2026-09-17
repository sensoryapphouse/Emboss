# Gold examples — BANA Braille Formats 2016, §4 (Headings)

## What these files are

25 JSON files, one per worked example/sample/option named in the section's
own table of contents (§4.12) and running rule text: the 15 inline
**Examples** (`example-4-1.json` … `example-4-15.json`) and the 7 numbered
**Samples** (`sample-4-01.json` … `sample-4-07-option-2.json`), with two
Samples split one file per "Option" because the source itself shows the same
print excerpt rendered several different ways:

- `sample-4-05-option-1.json` / `-option-2.json` / `-option-3.json` (Sample
  4-5 shows three options)
- `sample-4-07-option-1.json` / `-option-2.json` (Sample 4-7 shows two)

22 rows named `BANA Example 4-N` / `BANA Sample 4-N` exist in the source
(15 Examples + 7 Samples); with the two multi-option Samples split, that
gives 22 − 2 + 3 + 2 = **25 files**. 24 of the 25 carry braille
(`braille.width: 40`); only `example-4-1.json` ("Three Distinct Heading
Levels") is explicitly "(Print Only)" and has no braille at all
(`braille.width: null`).

Each file has the same shape as the §11 precedent, plus the same two extra
fields:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [{ "kind", "level", "text", "features" }, ...],
             "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

Section 4's print schema differs from §11's table-shaped one: print content
here is a flat list of `print.blocks`, each `{kind, level, text, features}`
— `kind` is `"heading"`, `"paragraph"`, `"list-item"`, or `"other"`; `level`
is `1`/`2`/`3` (centered/cell-5/cell-7) for a genuine heading block, or
`null` where the block is not a positioned heading (a paragraph, a list
item, a run-in heading kept inline within a paragraph's own `text`, or
content — like a front-of-book icon key — that print shows but that never
itself gets transcribed into this sample's braille).

- `sources` is always `["A", "B"]`: two independent Sonnet transcriptions of
  the section were compared for every field of every item.
- `resolution` is a short prose note citing the evidence for how any
  disagreement was settled — a source `.txt` line number, a PDF page, or a
  direct measurement against the (already-agreed) `braille.lines`.

## How these files were made

1. Two independent transcription runs ("A" and "B") already existed, each
   having read `references/_text/braille-formats-2016.txt` (lines
   3124–3793) and the PDF page images (`references/bana/
   braille-formats-2016.pdf`, pages 105–126).
2. Every field of every item was diffed programmatically between the two
   runs (`compare-gold-4/diffall.mjs` in the working scratch copy).
   **`braille.lines` and `braille.width` agreed byte-for-byte between the
   two runs on every single one of the 25 files** — a very different
   picture from the print-side fields, where both runs made independent
   errors (see below). Several agreed-`braille.lines` values were
   independently re-derived a *third* time directly from the `.txt` with a
   small script (`compare-gold-4/extract.mjs`) as an extra check, including
   every line implicated in a disputed `level`/`kind`/structural field.
3. Every heading's `level` (centered=1 / cell-5=2 / cell-7=3) was verified
   directly against the agreed `braille.lines`, never taken on either run's
   say-so: 0 leading blank cells with the line's own indent matching the
   centering formula `(40−len)//2` is centered; a fixed 4 leading blank
   cells is cell-5; a fixed 6 is cell-7 (`compare-gold-4/analyze_levels.mjs`).
   This caught real errors in **both** runs independently:
   - Run A: `example-4-2` (byline heading actually centered, not cell-5,
     contradicting A's own note); `example-4-12`, `example-4-15`
     (marginal/icon headings actually cell-5, A recorded `null`);
     `sample-4-03` (all three heading levels shifted down by one);
     `sample-4-05-option-1` (heading actually cell-7, A recorded `null`,
     **and** A's own prose describes Option 1 as "kept as a run-in,
     un-relocated" — which flatly contradicts A's own `braille.lines` for
     that file, which shows the heading relocated to a cell-7 line; that
     description in fact matches Option 3, not Option 1); A's
     `sample-4-05-option-2.json` also carries a false `uncertain` claim that
     Options 1 and 2 have byte-identical braille — they do not (line 2's
     indent differs by two cells) — refuted directly against the `.txt`.
   - Run B: `sample-4-04` ("PRIMARY Sources" — no error here, B was right);
     `sample-4-05-option-2`'s own `print.blocks[1].level` says `3` (cell-7)
     while that same file's own `braille.notes` prose says both headings
     get "the SAME cell-5 indent" — an internal self-contradiction in run
     B, resolved here in favour of the directly-measured evidence (cell-5,
     level 2), not either run's stated field.
4. `sample-4-01` (84 raw field diffs, by far the largest disagreement) and
   `sample-4-07-option-1/-option-2` (their `print.blocks` counts differed
   9 vs. 5, and the block order didn't line up at all) were rebuilt from
   the actual PDF page images (pages 118 and 126) read directly, not by
   picking one run's account — see `differences.md` for the page-by-page
   reasoning.
5. Two genuine print/braille mismatches with no representation in this
   section's `print.blocks` schema were identified and documented rather
   than forced to "match":
   - `sample-4-01`: print's own Objectives/New-Vocabulary/Review-Vocabulary
     lists are longer than what the braille excerpt actually transcribes
     (the braille truncates with a `444` continuation marker); there is no
     "N more items omitted" block kind, so the model built from the full
     print content is expected to over-produce lines relative to the
     abbreviated gold braille — a documented limitation, not a bug.
   - `sample-4-07-option-2`: the icon graphics are rendered as
     transcriber-defined shape codes (`@$es`/`@$cp`/`@$hw`) — pre-encoded
     BRF ASCII with no print-text equivalent to translate from. Recorded as
     `kind:"other"` and excluded from the model.
   - `example-4-10` / `example-4-11`: cell-5/cell-7 heading followed by a
     related- or unrelated-columns word table. This section's print.blocks
     kinds (heading/paragraph/list-item/other) have no table/columns block
     type, so the table content is recorded as `other` rather than forced
     into a plain list that would silently mis-format. Expect a documented
     mismatch limited to the table rows, not the heading.

## `illustrates` convention

Per the §11 precedent: `rule` is a bare numeric id (no "BANA" prefix, e.g.
`"4.5.7"`, `"4.9.2.a"` — a dot always precedes a lettered sub-clause
suffix, matching §11's `"11.2.8.b"` style, not run A's un-dotted
`"4.9.2b"`), and `quote` is the **entirety** of the specific rule id named
— not an editorial trim to "just the relevant sentence" — matching how
every §11 example's `quote` is the full text of the specific sub-rule cited.
Where run A and run B differed only in how much of a shared, unlettered
rule they quoted (e.g. `sample-4-02`'s rule 4.2.2, `example-4-14`'s rule
4.8.1), the full rule text was restored.

## Paragraph (run-in) headings

Rule 4.8's "paragraph (run-in) heading" is, by definition, never a
standalone braille line — it is emphasis-marked text sitting inside its own
paragraph. Emboss's `heading` document-model block type always emits its
own line, so a run-in heading is represented here as plain text *embedded
inside its enclosing `paragraph` block*, using Emboss's `*bold*` cell-markup
syntax where print itself adds emphasis (e.g. `example-4-13`'s mixed-case
"Action Plan"), and with no markup at all where the rule says none should be
added (e.g. `example-4-14`'s full-caps "ACTION PLAN", per 4.8.1's "no
additional emphasis" clause for uppercase paragraph headings). There is
never a separate `kind:"heading"` block for these — see `differences.md` for
why run A's 3-block structure for `example-4-13`/`-14` (a standalone heading
block plus a separate paragraph) does not match what the braille shows.

## Page-mapping note

Both runs independently corrected the task brief's suggested mapping
("printed page 4-1 is PDF page 102") and agreed on the same corrected
answer: **printed page 4-1 is PDF page 105** (confirmed directly from the
page image: PDF p.105 shows the Section 4 title/TOC and rule 4.1.1, footer
"4-1"). PDF p.104 is an unnumbered blank verso page (Section 4, like Section
3 before it, starts on a right-hand page). The mapping then runs
**PDF page = printed page number + 104** for the whole of Section 4, through
PDF p.126 = printed page 4-22 (the last page of Sample 4-7).

## Known uncertainties

Most files have an empty `uncertain` array. Where one or more residual
uncertainties remain, they are recorded on that file's own array; the two
most significant, beyond the ordinary "not cross-checked against a Special
Symbols page" caveats repeated on a few icon/shape-code items, are:

1. **`sample-4-01`** — print's own Objectives/Vocabulary lists are longer
   than the braille excerpt transcribes (see above); this is recorded, not
   silently trimmed to match.
2. **`sample-4-05-option-1`/`-option-2`** — run A's own prose account of
   which option does what was internally inconsistent with its own data;
   resolved from the (agreed, independently re-verified) `braille.lines`
   directly — see `differences.md`.

## Scope note on `illustrates`

As with §11, `illustrates` names one specific numbered rule and quotes it
verbatim, rather than attempting an exhaustive cross-check of every
possible applicable rule. `sample-4-01` is the one item cited against a
single rule (4.1.1, the rule whose own text explicitly cross-references
"Sample 4-1") even though it also incidentally touches rule 4.2.1's
more-than-three-levels provision; that provision's own explicit
cross-reference is to Example 4-1, not this sample, so only 4.1.1 is named
here, per the one-rule-per-file convention.
