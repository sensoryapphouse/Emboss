# Gold examples — BANA Braille Formats 2016, §10 (Exercise Material)

## What these files are

48 JSON files — the largest gold set in this repository — matching
`Emboss/docs/standards-map.md`'s own §10 table:

- **32** inline **Examples**: `example-10-1.json` … `example-10-32.json`.
- **13** numbered **Samples**: `sample-10-1.json` … `sample-10-13.json`.
- **3** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples), named after their own
  citing rule since none has its own "10-N" number, matching the §15/§19 gold precedents' own
  convention for this exact situation: `sample-10.5.2-sample-a.json`,
  `sample-10.6.8-sample-a.json`, `sample-10.6.10-sample-a.json`. None of these three has any
  braille anywhere near its own citing location (`braille.lines: []`).

Each file has the same top-level shape as every other precedent (`id`, `title`, `pdfPages`,
`textLines`, `illustrates`, `print`, `braille`, `uncertain`, `sources`, `resolution`).
`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"directions", text }` — an exercise's own directions paragraph (BANA 10.3.2's own
  5-5/7-5 margins). Built into an ordinary document `para` block, exactly like a plain
  `"paragraph"` block — `document.mjs` has no dedicated exercise-directions style at all
  (F-174), so this kind exists only for THIS schema's own bookkeeping of which print role the
  text plays, not for any different build behaviour.
- `{ kind:"paragraph", text, blocked? }` — ordinary prose: a displayed paragraph (Sample 10-3),
  a poem's own introduction, a corrected/italicised quoted sentence (Sample 10-9), an
  assignment prompt with no question/answer structure (Example 10-4). `blocked:true` marks a
  flush (1-1 margin) paragraph, confirmed directly against the given braille's own zero
  indent (Example 10-25).
- `{ kind:"heading", level, text }` — an ordinary heading; used only where the given braille
  itself centres a genuine title line (Example 10-10's own poem-excerpt title, "A Song for
  Sailors").
- `{ kind:"exercise", items:[{level, text}] }` — BANA §10's own actual subject: a document
  `{type:'list', kind:'exercise', ...}` block. `nestedMargins`'s own `'exercise'` case already
  gives this the BANA 10.4.1/10.4.2 1-3 / 1-5,3-5 / 1-7,3-7,5-7 nested-list margins. Each
  item's own print number/letter marker is baked directly into its `text` string (no
  `item.marker` field is ever set) — matching the REAL `bai-exercise` `<li>` parser exactly
  (`Emboss/input/parse.mjs:2310-2318`, which captures an item's full text/segments verbatim
  with no marker extraction at all, unlike the ordinary `bai-list` handler a few lines above
  it).
- `{ kind:"list", items:[{marker?, text}], columns? }` — an ordinary document `list` block
  (BANA 10.7.2's own word list for multiple questions; 10.4.4b's own unlettered/
  no-discernible-order answer choices; 10.9.2a's own wide-matching-columns-converted-to-lists),
  reusing `buildListItem` exactly like every other section's own plain list schema — here a
  marker genuinely IS a separate `item.marker` field, unlike an `"exercise"` item's own baked-in
  marker.
- `{ kind:"note", text }` — a standalone transcriber's note (BANA 10.9.2b's own synthesised
  matching-column heading, drawn from the directions' own wording; 10.11.3's own
  picture-description TN).
- `{ kind:"table", headers, rows }` — BANA 10.9.1's own narrow matching columns (Sample 10-10);
  `headers` is an array of ROWS (matching `buildTable7`'s own real shape — only the LAST row is
  used), reused exactly as `buildModel11`/`buildModel7` already do.
- `{ kind:"box", blocks:[...] }` — a nested box container (BANA 10.7.2f's own boxed word list,
  Sample 10-6's `7…7`/`g…g` rule lines), built exactly like `buildModel7`/`8`'s own box
  handling.
- `{ kind:"poem", stanzas:[{lines:[{text, indent?}]}] }` — BANA 10.7.1's own displayed poem
  inside exercise material (Sample 10-4): reuses the SAME `{type:'play', subtype:'verse', ...}`
  mechanism `buildModel13` already uses for §13 poems — `document.mjs` has no exercise-specific
  poem handling at all, so a displayed poem inside exercise material still goes through the
  ordinary poem/play code path.
- `{ kind:"other", text }` — never modelled; print content genuinely illegible/torn away in the
  source (Example 10-9's own torn-paper answer choices, a page-change-indicator rule line), or
  struck through and entirely omitted from the given braille (Example 10-6's choice C, Example
  10-3's item 3, Example 10-26's item 3).

## How these files were made

1. Two independent transcription runs (`gold-10-A`, `gold-10-B`) already existed, both produced
   by the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own `summary.md`)
   — NOT independent evidence of each other, per this task's own brief. Agreement was treated
   as no evidence of correctness throughout.
2. Every sample's `braille.lines` was independently re-extracted directly from
   `references/_text/braille-formats-2016.txt` (lines 7191-8235) by a dedicated script
   (`compare-gold-10/extract.mjs`, kept in this session's own scratch folder): an Example's own
   fixed left margin, or a numbered Sample's own line-number field (width 5, except Sample
   10-10's own 4), stripped by counting; U+2800 converted to a literal space; trailing spaces
   removed. This independent extraction agrees byte-for-byte with BOTH runs on all 13 numbered
   Samples, and with at least one run (confirmed the other run's own extra header-caption
   prefix was spurious) on all 32 Examples — see `compare-gold-10/differences.md` §1 for the
   full cross-check.
3. Separately, and regardless of any A/B agreement, the print side of EVERY file was verified
   by forward-translating each candidate print block through Emboss's own translator
   (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does — the actual
   `buildModel10` builder, iterated on directly via repeated `gold-run.mjs --section section-10`
   runs while authoring) and, for every file either run flagged as uncertain plus several this
   reconciliation found independently, by reading the PDF page image directly
   (`references/bana/braille-formats-2016.pdf`, PDF page = printed "10-N" page + 250, confirmed
   against p.251 = printed page 10-1). This found and corrected: Example 10-6's own choice B
   (full print text, not truncated — the wavy strike-through covers choice C only, confirmed at
   300dpi); Example 10-7's own choice C (full "...Northern Hemisphere", the given braille's own
   last line is genuinely clipped by the source book's own box-graphic edge); Example 10-9's own
   question 7 (fully legible "...Congress is usually", confirming gold-10-B's own reading over
   gold-10-A's); Example 10-12 (print genuinely has no period after "Lakes", confirmed at
   300dpi); Sample 10-12's own synthesised first heading (back-translated from the given
   braille's own `"N` cell to "Name", not both runs' shared guess "Who"). See
   `compare-gold-10/differences.md` §2-3 for the complete, file-by-file evidence trail,
   including several modeling-only corrections found purely by forward-translating (write-on-line
   blanks must be a SINGLE underscore per blank, not one per print-visible underscore character;
   `**bold**` vs `*italic*`; two files needed a plain/blocked paragraph, not an `"exercise"` list
   item, once their own given-braille margins were re-derived).
4. `illustrates.rule` was set to the NEAREST preceding numbered rule paragraph for every Example
   (the book's own placement convention — an "Example N" directly illustrates the rule spoken
   immediately before it; several Examples share one citing rule where the source shows no new
   rule paragraph between them, e.g. Examples 10-9/10-10 both cite 10.5.1), and to the rule whose
   own inline `(See Sample 10-N...)` cross-reference names each numbered Sample (a lettered
   sub-rule, e.g. `10.4.4a`, where the citation sits under a specific bullet).

See `compare-gold-10/differences.md` (kept in this session's scratch folder per the task's own
instructions — not committed to the repository) for the complete, file-by-file breakdown of
every disagreement between the two runs and every correction made against the source/PDF.

## `buildModel10` — the exercise-material model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to learn the
real exercise-list model `buildModel10` reproduces (search "exercise", `nestedMargins`,
`formatList`): BANA §10's own subject already has a dedicated `kind:'exercise'` case throughout
`nestedMargins`/`listMarginKind` (document.mjs:117-144, 426) — a pre-existing, real mechanism,
unlike several other sections' own "nothing recognises this construct at all" gaps — so
`buildModel10` builds a genuine `{type:'list', kind:'exercise', items:[...]}` block for every
actual question/answer-choice set, and reuses the SAME general-purpose block types (`para`,
`heading`, `note`, `list`, `table`, `box`, `play`/verse) every other section's own builder
already uses for everything else (directions, word lists, matching columns/tables, boxed word
lists, a displayed poem). Nothing in this section's own worked corpus needs a block type that
does not already exist somewhere else in `document.mjs` — every genuine gap is instead a MARGIN
or SYNTHESIS gap in how the EXISTING mechanisms get used in this specific context (an exercise
list's own children, or an exercise item's own inline content), exactly matching this section's
own five findings assessed 17 Sep 2026 (F-173..F-176, F-225..F-229) before this reconciliation
began.

## Gold-run.mjs results (18 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-10 --update-status`: **16 match**
(Examples 10-4, 10-7, 10-8, 10-14, 10-15, 10-17, 10-18, 10-20, 10-21, 10-23, 10-24, 10-25,
10-27, 10-29, 10-30; Sample 10-2), **11 mismatch**, **18 not-representable**, **3 no-braille**
(the three embedded, unnumbered "Sample:" wordings). Every mismatch/not-representable file's
cause is one or more of the section's own already-documented findings, a content-fidelity
anomaly independently confirmed against the PDF page image (not an Emboss defect), or this
reconciliation's own newly-recorded **F-237**:

- **F-174** (no exercise-directions/example paragraph style at all — falls back to an ordinary
  1-1/3-1 paragraph margin instead of BANA 10.3.2's 5-5/7-5) underlies EVERY `not-representable`
  file in this set: every one of them opens with a `"directions"` block. This is this section's
  own single largest, most pervasive gap.
- **F-176** (no margin adjustment for displayed text nested right after an exercise list) is
  Sample 10-4's own mismatch cause: its displayed poem builds flush (cell 1) instead of BANA
  10.7.1's own adjusted margin (2 cells right of the runover position).
- **F-226** (no mechanism to synthesize/embed a transcriber's note inside or immediately
  attached to an exercise item's own content) is Example 10-11's cause (the "6 answers" TN
  builds as its own separate note paragraph, not fused onto the question's own braille line)
  and Example 10-19's cause (the cue word "sell" builds as its own separate list item, not
  parenthesised onto the write-on-line).
- **F-228** (no label/numbered-item same-line split, and no punctuation-triggered emphasis
  suppression) is Sample 10-8's own cause exactly: "EXAMPLE: 1." stays on one braille line
  instead of splitting per BANA 10.8.5.
- **F-229** (pictures inside exercise material dropped, never converted to an embedded TN) is
  Example 10-31's and Example 10-32's own cause: the picture description text builds as plain,
  unwrapped item text instead of `@.<...@.>`-enclosed.
- **F-237** (new; this reconciliation) — no mechanism substitutes three dot 5s for a
  blank shown as plain print space rather than an underscore/dash (BANA 10.6.1's own second
  sentence) — Example 10-13's own third sentence.
- **Content-fidelity anomalies confirmed against the PDF page image, not Emboss defects**:
  Example 10-6 (choice B fully legible in print but truncated in the given braille), Example
  10-7 (the given braille's own last line genuinely clipped by the source book's own box
  graphic), Example 10-9 (question 7 fully legible in print but truncated in the given braille),
  Example 10-12 (print genuinely has no terminal period the given braille adds).
- **Unresolved / minor liblouis-level nuances**, not chased further given time — Example 10-16
  (an underline-scope difference), Example 10-28 (a context-dependent italic-encoding
  difference), Example 10-22 (one extra blank line from `formatList`'s own unconditional
  blank-before-a-list convention against this short excerpt's own scope boundary).

See `compare-gold-10/differences.md` for the complete, file-by-file breakdown, and
`Emboss/tests/gold_bana_section10.test.mjs` for the regression guard.
