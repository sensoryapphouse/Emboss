# Gold examples — UKAAF B004, Appendix E (Tables)

## What these files are

2 JSON files, one per "Good practice example" in this appendix (it has no other
worked examples — see `standards-map.md`'s "B004 Appendix E — Tables" section):

- `example-1.json` — "Good practice example of a transposed table" (Household Expenditure).
- `example-2.json` — "Good practice example of a table over two pages" (Table 3: Weather
  Forecast for Somewhere City).

Same shape as `../../bana-formats-2016/section-11/*.json`:

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

One schema adaptation: `illustrates` is an **array** of `{ "rule", "quote" }` objects here,
not a single object as in the BANA files. BANA's examples each illustrate sub-rules of one
numbered parent rule (`"rule": "11.13.1"` covers 11.13.1a/j/k/m together); this appendix has
no numbered rules at all, so each example's own descriptive-id rules (`B004 E ex1-transpose`,
`B004 E ex1-guide-dots`, etc. — see the standards map) are listed individually instead of
being folded under one shared number.

## How these files were made

1. Two independent extraction runs already existed for this section
   (`extract-E-A`/`extract-E-B` in the task's scratch folder), each having read
   `references/_text/B004.txt` lines 538–672 and the PDF page images
   (`references/ukaaf/presentation-guidelines-B004.pdf`, pages 17–21). Their differences are
   reconciled in `../../../docs/../../` — see the task's `differences.md` (kept in the
   session's scratch folder per the task instructions, not in the repository) for the full
   per-row account.
2. **The `.txt` extraction was found to be unreliable for exact braille spacing in this
   section, and was not used as-is.** `references/_text/B004.txt` is a `pdftotext`-style
   reconstruction that inserts *extra* whitespace on some lines to preserve visual column
   alignment; for `example-1.json`'s Household Expenditure table (the rows and headers
   printed on PDF page 17), this inflates 38-cell lines to 70–78 characters, and for
   `example-2.json`'s right-hand facing page it doubles every inter-row blank line from 1 to
   2. Both were caught only by reading the PDF's own embedded text runs directly (PyMuPDF
   `page.get_text('dict')`, one span per literal `Tj`/`TJ` operation — not a layout
   reconstruction) and, for the blank-line count, by measuring each line's actual vertical
   position (`bbox` y-coordinate) and computing the line pitch. See each file's own
   `braille.notes`/`resolution` for the exact before/after and the measurements. Neither
   independent extraction run caught this (both compared the `.txt` against itself or against
   a rendered image for gross structure only, not against character/line positions).
3. `braille.width` is **38** for both examples, confirmed (not assumed): every full data line
   in both examples is exactly 38 characters once read correctly from the PDF, and the
   braille page-number tokens (`#eb`/`#ec` in `example-2.json`) sit right-justified in column
   38 of an otherwise-38-cell line.
4. Two braille signs neither extraction run could decode were resolved here using
   `references/_text/rueb-2024.txt` (RUEB, Third Edition 2024) together with
   `Emboss/engine/brf-ascii.mjs`'s `BRF64` table (the exact Unicode-braille-dot-pattern ↔
   ASCII-braille-character mapping Emboss itself uses for BRF), and independently confirmed
   by feeding the same literal print text through Emboss's own real liblouis `en-ueb-g2`
   translator and getting an exact match:
   - `example-1.json` line 4/5's `"<@l">` = "(£)" — the pound sign in parentheses, added once
     per column heading per the example's own stated rule.
   - `example-2.json`'s `;,e` (Wednesday's Wind-direction cell) = RUEB §5.2.1's grade‑1‑symbol
     indicator before a standalone letter "e" that could otherwise be misread as a
     contraction — RUEB's own worked example for §5.2.1 is literally the letter "e".

   One sign remains genuinely undecoded in both files: the closing `"31111111111` run at the
   end of each example's braille (a plausible end-of-transcriber's-note/end-of-table marker,
   no RUEB citation found) — left as a question, see `../../../docs/standards-questions.md`.

## Known uncertainty carried from the extraction stage

`example-2.json` reproduces, with exact PDF-measured evidence (not just visual impression),
run B's finding that this example's own braille appears to contradict its own stated rule
("The rows on the facing pages must line up"): the left-hand page has zero blank lines
between its five day-rows; the right-hand page has exactly one blank line between every row
(measured from PDF line-pitch, not the `.txt`, which shows two). This is left as-is, flagged
for Paul rather than corrected or explained away — see `standards-map.md`'s Unresolved
section and `differences.md`.
