# Gold examples — UKAAF B004, Appendix J (Poetry)

## What these files are

2 JSON files, one per worked example in this appendix, captioned only by their method name (not
numbered in the source): `b004-j-1.json` (the "line by line" method, appears first) and
`b004-j-2.json` (the "line indicator" method, appears second). Both illustrate the SAME poem,
Edward Lear's "The Owl and the Pussy-Cat" (public domain, quoted verbatim per this task's
instruction), each with real print AND real braille (`references/_text/B004.txt`, lines 811-901;
`references/ukaaf/presentation-guidelines-B004.pdf`, pp.26-29).

These sit alongside `Emboss/tests/gold/bana-formats-2016/section-13/` (BANA Formats 2016 §13,
Poetry and Song Lyrics — see that folder's own README) as part of the same reconciliation; the
schema, `buildModel13` model builder, and most method notes are identical and are not repeated
here.

`b004-j-1.json` carries a `braille.variants` array of one entry — the source's own "Or:"
alternative rendering of the SAME poem (both stanzas starting in cell 3 with no blank line
between them, the line-by-line method's own named alternative to the primary rendering's blank-
line-plus-cell-1 convention) — `{ "label", "lines" }`. Both worked examples have a genuine
mid-example page break (printed page 26/27 for `b004-j-1`, 27/28 for `b004-j-2`), recorded in
`braille.pageBreaks` as `{ afterLineIndex, note }` (this repository's own established shape,
matching the `section-9`/`section-11`/`section-16` precedent — see `differences.md` §7 for why a
literal form-feed character inside `braille.lines`, one of the two transcription runs' own
approach, was NOT used).

## Width

Both worked examples' own gold reconciliation independently confirmed `braille.width: 40` (not
UKAAF's width-agnostic default of 38 cells, which `b004-6-9`/`b004-11` fall back to elsewhere in
this repository for lack of any column anchor) — `gold-run.mjs` formats this appendix at UKAAF
margins but BANA's 40-cell width accordingly (`SECTION === 'b004-appendix-j'` special-cases
`UKAAF_WIDTH` to 40).

## `b004-j-1`, line 0 — a genuine correction, not a pick between the two runs

The source's PRIMARY rendering begins BOTH of its stanzas flush at cell 1 (confirmed directly:
0 leading ASCII spaces at `B004.txt` lines 845 and 850) — one of the two independent
transcription runs had mis-measured the very first line at cell 3, matching the SEPARATE "Or:"
alternative's own margin instead of the primary rendering's real one. See `differences.md` §8 for
the full account, including why this also resolves — as a measurement error, not a genuine
editorial inconsistency in the source — a stated uncertainty about the primary rendering using
two different stanza-opening conventions.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section b004-appendix-j --update-status`: **2 mismatch**
(neither matches, nor is expected to). `b004-j-1` (line by line method) mismatches primarily on
`assess-13/poetry-writeup.md` F-121 (no blank line before/after a poem — B004 App J's own
guiding principle requires it exactly as BANA 13.3.1a does) plus ordinary UEB contraction
choices differing from the book's own 1970s-vintage transcription (e.g. "owl" as `{L` in the
source vs Emboss's own `[L`). `b004-j-2` (line indicator method) mismatches on F-128 — the line-
indicator method (a symbol placed at the end of each verse line, poetry written continuously
rather than one line per braille line) does not exist anywhere in Emboss at all; the gold model
is necessarily built as ordinary line-by-line verse instead, which cannot reproduce the source's
own continuous, indicator-joined lines. See this reconciliation's own `differences.md` (kept in
the session's scratch folder per the task instructions, not in the repository) and
`Emboss/tests/gold_bana_section13.test.mjs` (the shared regression guard for both this appendix
and BANA §13).
