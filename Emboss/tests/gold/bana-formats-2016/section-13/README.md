# Gold examples — BANA Braille Formats 2016, §13 (Poetry and Song Lyrics)

## What these files are

25 JSON files, one per worked example/sample named in the section's own running rule text and
its own numbered Samples list, matching `Emboss/docs/standards-map.md`'s own already-reconciled
"BANA §13 — worked examples" table:

- **7** inline **Examples**: `example-13-1.json` … `example-13-7.json`.
- **14** numbered **Samples**: `sample-13-01.json` … `sample-13-14.json`.
- **4** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples — distinct from the 14
  numbered Samples): `sample-note-13-6-2.json` (rule 13.6.2), `sample-note-13-6-3.json`
  (13.6.3), `sample-note-13-6-4b.json` (13.6.4b), `sample-note-13-9-3g.json` (13.9.3g) — named
  after their citing rule since none has its own "13-N" number.

The two related UKAAF B004 Appendix J items (line-by-line method, line-indicator method) live
alongside this section in `Emboss/tests/gold/ukaaf-b004/appendix-j/` (see that folder's own
README) — 27 files in total for this reconciliation.

Of the 25 files here, 21 carry a real `braille.lines` transcription; the 4 embedded `Sample:`
notes have `braille.width`/`braille.lines` null/empty — the source gives only the suggested
English wording for a transcriber's note at each one's own citing location, never a braille
rendering of it there (confirmed directly: no U+2800/braille-ASCII characters appear anywhere
in any of the four rule passages that quote them). `sample-note-13-9-3g` is a partial exception:
the EQUIVALENT symbol key IS given a real braille rendering, but only later in the book, as the
opening of the separate worked Sample 13-9 — recorded there only (`sample-13-09.json`), not
duplicated under this file's own name.

Each file has the same top-level shape as the §4/§7/§8/§9/§16 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes", "variants" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — level 1/2/3 = centred/cell-5/cell-7, exactly as
  the §4/§7/§8/§9 precedents. Used both for ordinary section/title headings AND for a poem's own
  real, separate print heading line naming a stanza/verse (Sample 13-2's Roman-numeral "I."/"II."
  stanza headings; Sample 13-14's "2."/"3." verse-number lines, each on their own braille line
  ahead of the stanza, per the gold braille — see `buildModel13`'s comment below on why this is
  NOT the same thing as a `number` folded into a poem line's own text).
- `{ kind:"paragraph", text, features }` — ordinary running prose, including 13.2.1's poetry
  embedded within narrative text (Example 13-1), which needs no verse machinery at all.
- `{ kind:"attribution", text, features }` — a poem's own trailing signature/credit line printed
  in BANA §9.4's attribution style (cell 5, blocked) — e.g. Sample 13-4's "e.e. cummings" after
  the poem — distinct from a centred BYLINE directly under a title (which prints centred, and is
  instead modelled as its own `kind:"heading"`, `level:1` line — see Samples 13-2/13-5/13-7).
- `{ kind:"poem", features, stanzas:[{ lines:[{ text, indent, number }] }] }` — BANA §13's own
  verse content. `stanzas[]` has more than one entry only where the poem itself has a real
  stanza break (a blank line in the print poem); `indent` is a LEVEL (0, 1, 2…), not a literal
  cell count — `(leading blank cells in the gold braille) / 2`, independently re-measured for
  EVERY line in every poem in this section (not taken from either transcription run's own
  say-so: see this reconciliation's `differences.md` §6 for several cases where both runs
  independently mis-measured a line's own level, sometimes agreeing with each other and still
  being wrong). `number` is populated only where a stanza/verse number is genuinely FOLDED INTO
  the print text of a poem's first line (none of this section's own gold files actually do this
  — Samples 13-2's and 13-14's own numbers both turned out, once directly measured, to be their
  OWN separate print heading/poem lines instead, see above); the field is kept in the schema for
  completeness and because `buildModel13` supports it (folding a `number` into its line's own
  text, faithfully reproducing `parse.mjs`'s real, and per `standards-findings.md` F-123 buggy,
  behaviour) in case a future section needs it.
- `{ kind:"other", text (or null), features }` — never modelled; recorded as a limitation
  exactly like the §4/§7/§8/§9/§5 precedents' own 'other' — a musical-notation graphic (Sample
  13-13/13-14's staff notation), a symbol-only scansion/meter diagram with no lines of poetry at
  all (Example 13-5/13-7 — see `differences.md` §6 for why Example 13-5's own quotation is
  modelled this way rather than as a 2-level `poem`), a footnote's own editorial annotation
  (Example 13-5's "dot locator" note, Sample 13-08's phonetic respelling), or a shape poem's own
  prose description of its visible words (Sample 13-3, whose real reading order the source
  itself cannot be measured to with confidence — 13.5.2's own difficulty).

## How these files were made

1. Two independent Sonnet transcriptions of the section already existed (Run A and Run B), each
   reading `references/_text/braille-formats-2016.txt` (lines 10214-11060) and the PDF page
   images (`references/bana/braille-formats-2016.pdf`, pp.355-384; PDF page = printed page +
   354).
2. Every field of every file was diffed programmatically between the two runs — `braille.lines`
   first (15 of 27 files, across both this section and Appendix J, were byte-identical between
   the two runs), THEN, separately, every poem's own `print.blocks` `indent`/`number` fields
   (which can disagree, or both be wrong, even where the corresponding `braille.lines` text
   agrees exactly — the field `buildModel13` actually consumes to compute margins, not the raw
   braille text itself). See `differences.md` for the complete field-by-field account.
3. `illustrates.rule` was reset to `standards-map.md`'s own already-reconciled table for every
   file (both runs' own independent guesses at the exact sub-rule disagreed with that table in
   several places), matching the section-16 gold precedent's own step 3.
4. Every disputed leading-blank-cell count (and, for the two files that turned out most
   error-prone — Sample 13-12's two-page stress/meter diagram, and as a smaller check Samples
   13-04/13-10 — EVERY line, not just the disputed ones) was re-derived character-by-character
   against the source (Python, U+2800 = one blank cell, the reference-line-number/box-margin
   field's own width measured and stripped first). This found four instances where BOTH runs had
   the wrong value (Sample 13-12's two centred header lines and two of its stress-diagram rows;
   Sample 13-13's title; Sample 13-14's title) — never resolved by picking a side, always by
   direct measurement. See `differences.md` §4.
5. A handful of `print.blocks` corrections were made once `buildModel13` was actually run
   against the reconciled files and a mismatch's root cause was traced back to the print-side
   model rather than a genuine Emboss gap: a wrongly-deep `indent` mirroring PRINT's own visual
   depth instead of the NORMAL braille level 13.3.1d actually requires (Example 13-4); a missed
   real stanza break (Sample 13-04); a trailing poet's signature modelled as an ordinary
   paragraph instead of an attribution (Sample 13-04); a centred byline modelled as an ordinary
   paragraph instead of a centred heading (Samples 13-02/13-05/13-07); two verse numbers
   modelled as a `number` field folded into their line's own text instead of their own real,
   separate print heading line (Sample 13-14). See `differences.md` §6 for the full account and
   evidence for each.

## `buildModel13` — the poem/verse model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to learn the
real verse model `buildModel13` reproduces: a print `<poem>`/`<linegroup>`/`<line>` (or this
gold schema's own `stanzas[].lines[]`) becomes a run of document
`{type:'play', subtype:'verse', style:'verse', text, level}` blocks, one per print line — the
SAME shape `parse.mjs`'s `parsePoem` (~lines 2468-2542) builds from real DTBook markup. `level`
is the line's own `indent` (omitted when 0, matching `parsePoem`'s own `if (lnLvl > 0)`); the
poem-wide `maxLevel` that `nestedMargins('poetry', ...)` needs for every line's RUNOVER margin
(Formats §13.3.1: "runovers begin two cells to the right of the FARTHEST indented level") is
computed automatically over the whole document by `verseRunLevels` (`document.mjs:178-190`) —
`buildModel13` never sets it itself. A stanza boundary (more than one entry in a poem's own
`stanzas[]`) becomes a `{type:'indicator', kind:'line'}` block between the two stanzas' own
line-runs, exactly the block `parsePoem` itself inserts between two `<linegroup>` siblings.

A `number` on a poem line (a stanza/verse number the source folds into the text of a stanza's
first line — BANA 13.4.1b/13.11.4a's own subject) is folded into that line's own text as a
literal `"N "` prefix, NOT built as a separate cell-5 heading — not a simplification, but a
faithful reproduction of `parse.mjs`'s own real (and, per `standards-findings.md` F-123, buggy)
behaviour: there is no cell-5-heading code path for a poem/stanza number anywhere in
`document.mjs`. Where print instead shows the number as its OWN separate, independent heading
line (both of this section's own actual worked examples — see above), the gold file already
models it as an ordinary `kind:"heading"` block, unaffected by F-123.

Two systemic, already-documented Emboss gaps make nearly every poem in this section diverge from
its own gold braille independent of anything `buildModel13` does — merged from
`assess-13/poetry-writeup.md` into `standards-findings.md` as part of this reconciliation:

- **F-121** — `formatPlay` never adds the blank line BANA 13.3.1a / B004 App J require before and
  after a poem (`document.mjs:790-800` pushes no leading/trailing `''`). The single largest
  cause of mismatch in this corpus.
- **F-123** — a stanza/verse `number` folded into a line's text (see above) is never rendered as
  the cell-5 heading 13.4.1b/13.11.4a require.

Every other §13/App J finding (F-122, F-124 through F-130) is examples/samples-specific; see the
per-sample notes in `status.json` and `differences.md` for which file demonstrates which one.
Shape/scansion poems (Sample 13-3's ampersand spiral; Examples 13-5/13-7's mark-above-letter
diagrams) are `buildModel13`'s explicit limitation, matching the standard's own acknowledgement
that these need a transcriber's description or a tactile graphic, not a literal braille
transcription an algorithm could derive from the print text alone (13.5.1, F-127).

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-13 --update-status`: **3 match** (Examples
13-2, 13-3, 13-4 — single-level or, once corrected, normally-indented multi-level poems short
enough to need none of F-121's blank lines and nothing else this corpus's other findings touch),
**12 mismatch**, **6 not-representable** (a print-only 'other' block was left out of the model:
Examples 13-5/13-7, Samples 13-03/13-08/13-13/13-14), **4 no-braille** (the three
sample-notes with no braille anywhere near their own citing text). Every `mismatch`/
`not-representable` file's cause is one or more of: F-121 (missing blank line around a poem —
Example 13-1/13-6, Samples 13-01/13-05/13-06/13-07/13-09/13-10/13-11/13-12), F-124 (multi-space
wide spacing collapses to one space — Samples 13-05/13-06), F-125 (grade-1/uncontracted passage
indicator per-LINE not per-POEM — Example 13-6, Samples 13-06/13-10/13-11), F-127 (mark-above-
letter diagram, no representable structure — Examples 13-5/13-7, Samples 13-09/13-12),
**F-84** (independently reproduced a third time: Samples 13-02/13-05/13-07's centred title+byline
pairs keep a blank line the unconditional `centred>centred` heading-join rule wrongly suppresses
— another agent's concurrent section-5 reconciliation recorded this same gap first), or **F-85**
(new — a boxed inline Example's own book-layout left margin shifts its own line-wrap points:
Example 13-1). See `differences.md` for the complete, file-by-file breakdown, and
`Emboss/tests/gold_bana_section13.test.mjs` for the regression guard.
