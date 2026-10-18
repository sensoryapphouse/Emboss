# Gold spacing audit (K33, 26 Sep 2026)

The BANA gold examples' braille was first transcribed from a plain-text dump of
`references/bana/braille-formats-2016.pdf` that turned runs of exactly two blank cells into one
(483 of 503 such runs). These scripts rebuild each braille line of the book from the PDF's glyph
positions (fixed cell pitch: 10.1199 pt at 14 pt, 11.5693 pt at 16 pt) — cross-checked against a
300-dpi rendering of every page (5,023 of 5,034 braille lines agree cell for cell) — and compare
every gold line with the book.

- `book.py` — rebuild the book's braille lines with exact cell positions (needs Python `pymupdf`).
- `audit.py`, `classify.py` — compare gold with the book; classify each difference.
- `make_corrections.py`, `apply.py` — produce and apply `corrections.json` (each gold file gets a
  `corrections` entry).
- `fulllist.md` — every corrected line (380 lines in 97 files).

Use these before trusting any gold line's spacing. Never re-transcribe gold braille from a text dump.

## Full-line regeneration (Fable review recommendation 1, 26 Sep 2026)

The audit above only ever compared MATCHED, non-blank lines' spacing — it had no way to check a
wholly blank line (a text dump has nothing to show where one is), a page break inside an example,
or a line missing from/extra in the gold. `regen.py`'s PRIMARY evidence for both is this book's
own left-margin line number (font `LucidaConsole`, read by `book_margins.py`), printed beside
every braille line inside a numbered box — including a wholly blank one, still a real row (U+2800
glyphs) that still gets a number — and the `-New Braille Page-` marker text/numbering-reset that
marks a page break. Only a box with no margin numbers at all falls back to the K33-era vertical-gap
measurement. See `regen-report.md` for what was found, including two real bugs this script caught
in itself while being checked against the PDF by hand (never applied unreviewed):

- a duplicate-run false positive: two neighbouring worked examples, 21-3 and 21-4, share their
  opening lines verbatim a few lines apart on the same page while illustrating *opposite* rules
  about the blank line between them — `regen.py` refuses to infer a blank-line count from any
  anchor whose text repeats nearby;
- an existing-correction conflict: an errata/addendum's own replacement wording, or the blank-line
  gap an errata specifically closed, must never be re-touched by a fresh PDF reading (the PDF
  predates the correction) — `protected_lines()` protects any REWRITTEN line wherever it sits in a
  gap (not just at the gap's own two edges), and `protected_pairs()` (narrowly, from an actual
  before/after diff of the correction — not every adjacent pair in its `after`, which flagged
  unrelated content elsewhere as "protected" too) protects a gap an errata closed without
  rewriting either flanking line.

- `regen.py` — regenerate; writes `regen_raw.json` (one record per example: matched/unmatched,
  blank-line diffs, and every other issue found, classified — see the module docstring).
- `apply_regen.py` — apply the unambiguous blank-line diffs to gold, recording a `corrections`
  entry per file in the SAME convention as `apply.py`'s (`source: "pdf-glyphs"`,
  `reasonClass: "blank-line"` instead of `apply.py`'s spacing-audit `source` string, so the two
  are easy to tell apart; never a second, different `corrections` shape).
- `check_regen.py` — two regression checks: (1) re-derives every `pdf-glyphs`-corrected file's
  blank lines fresh from the PDF and fails if any now disagrees; (2) across ALL gold files, fails
  if any line/gap protected by an existing non-`pdf-glyphs` correction was altered. Skips cleanly
  (exit 0) when the PDF, `pymupdf`, or `numpy` are unavailable (the PDF is untracked).

`audit.py`, `apply.py`, and `book.py` now resolve the repo root from their own file location
(never hard-coded to the main checkout), so they always read/write the gold files of whichever
worktree is running them; `book.py` still reads the PDF itself from the main checkout (or a
worktree-local copy, if one happens to exist) since the PDF is untracked and only the main
checkout has one.
