# Gold examples — BANA Braille Formats 2016, §18 (Grammar)

## What these files are

31 JSON files, matching the 31 items `gold-18-A`/`gold-18-B`'s own `summary.md` files
transcribed for this section and this task's own advance count:

- **16** inline **Examples**: `example-18-1.json` … `example-18-15.json` (Example 18-12 is
  split into `example-18-12a.json`/`example-18-12b.json`, two separate worked examples under
  one shared caption number, matching the source itself).
- **5** numbered **Samples**: `sample-18-1.json` … `sample-18-5.json`.
- **10** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples), named after their own
  citing rule since none has its own "18-N" number, matching the §15/§19 gold precedents' own
  convention for this exact situation: `sample-18-18.2.1.json`, `sample-18-18.2.2b.json`,
  `sample-18-18.3.3b.json`, `sample-18-18.4.1c.json`, `sample-18-18.5.2c.json`,
  `sample-18-18.5.3d.json`, `sample-18-18.6.4e.json`, `sample-18-18.7.3.json`,
  `sample-18-18.8.2e.json`, `sample-18-18.9.1.json`. None of these ten has any braille
  anywhere near its own citing location (`braille.lines: []`) — confirmed directly against the
  source at each file's own `textLines`.

Each file has the same top-level shape as every other precedent (`id`, `title`, `pdfPages`,
`textLines`, `illustrates`, `print`, `braille`, `uncertain`, `sources`, `resolution`).
`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"note", text }` — a standalone transcriber's note (`formatTranscriberNote`), the one
  mechanism that works correctly whenever a note's own wording stands alone (Examples 18-1,
  18-4, 18-8; the Option-1 notes of Samples 18-1/18-2).
- `{ kind:"paragraph", text, blocked?, continuation? }` — an ordinary `para` block.
  `blocked:true` (matching `buildModel4`'s/`buildModel19`'s own convention) marks a print line
  the given braille shows flush at cell 1; `continuation:true` marks a block that is a flush
  run-on of the immediately preceding block (no leading blank line of its own), used here for
  Example 18-4's own run of three one-line example sentences (matching `buildModel1`'s own
  convention for the flag).
- `{ kind:"list", items:[{text}] }` — a document `list` block (Example 18-1's plain list of
  names, Sample 18-1/18-2's own "label: word" lists, Sample 18-3's proofreading-marks list
  where representable).
- `{ kind:"other", text }` — never modeled; recorded as a limitation. §18 is overwhelmingly
  this kind: an embedded/mid-sentence transcriber's note (F-186), a phrase needing a braille
  grouping indicator (F-187), a devised transcriber-defined symbol or typeform marking specific
  words (F-188), or a linear/spatial sentence diagram, arrow, or analogy symbol (F-189) — this
  schema has no block type for any of these, so the whole passage each one covers is recorded
  here rather than approximated with a misleadingly-partial paragraph. Where the underlying
  WORDING is still separable and meaningful on its own (e.g. a list of plain names that would
  normally carry a symbol prefix, or a sentence that would normally carry an arrow above it),
  this reconciliation instead built an ordinary `paragraph`/`list` block for the wording and
  used `other` only for the specific unbuildable mark/diagram — see each file's own
  `resolution` field for which choice was made and why.

## How these files were made

1. Two independent transcription runs (`gold-18-A`, `gold-18-B`) already existed, both
   produced by the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own
   `summary.md`) — NOT independent evidence of each other, per this task's own brief. Run A's
   own `summary.md` says all 147 of its own braille lines were verified in-session verbatim
   against the source; run B's own `summary.md` says the same for its 143 lines but flags one
   own discrepancy at Example 18-7 (resolved below). Per the brief's own explicit instruction,
   agreement between the two runs was treated as NO evidence of correctness on its own.
2. Every sample's `braille.lines` was independently RE-EXTRACTED from
   `references/_text/braille-formats-2016.txt` (lines 14310-14955) directly, never copied from
   either run: for each file's own declared `textLines` range, the book's own fixed left
   margin (a constant leading-space count, re-measured per file from every line in its own
   range — 15, 9, or 0 spaces depending on the page) was stripped, U+2800 was converted to a
   literal space, and — for the five numbered Samples — the line-number field (digits then at
   least three spaces, a 4- or 5-character field depending on the sample's own maximum line
   number) was also stripped. This independent extraction agreed byte-for-byte with BOTH runs
   on the majority of files; it also caught cases where BOTH runs (being the same model) shared
   the identical omission:
   - **Examples 18-12a/18-12b** (spatial arrow diagrams): BANA 18.8.1 requires a blank braille
     line before AND after every arrow/sentence pair. The source's own required blank lines are
     genuine, full 40-blank-cell rows within each file's own declared `textLines` range —
     distinct from the ordinary empty gap lines around every worked example's own heading. Run
     B kept these; run A dropped them (both files).
   - **Examples 18-13/18-14**: both runs agree on every line they DID capture, but both
     independently dropped the file's own final line — a required TRAILING blank line still
     within each file's own declared `textLines` end. Corrected by re-deriving the full range
     from source directly, exactly the situation this task's brief warns about (the same model,
     making the same omission, in two "independent" runs).
   - **Example 18-1**: run A's own margin measurement (15 spaces) is correct throughout; run
     B's own braille.lines added a spurious extra indent not present anywhere in the source.
   - **Sample 18-4**: the file's own braille numbering starts at line 5 (source line 14913),
     meaning the file's own unnumbered lines 1-4 (a "Note: This sample uses..." paragraph) were
     genuinely NEVER brailled at all. Run B correctly excluded them; run A spliced them in as
     if they were braille content, with four fabricated blank lines.
   - **Example 18-7**: this task's own brief already flagged the exact discrepancy — run B's
     `":]e y see a @54` does not occur anywhere in the source and does not forward-translate
     from any plausible English wording; run A's `": y see a @54` matches the source verbatim
     (line 14586) and forward-translates from "Insert an adjective where you see a ^." exactly.
3. Separately, and regardless of any A/B agreement, the print side of EVERY file with braille
   was verified by forward-translating each candidate print reconstruction through Emboss's own
   translator (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does) and diffing
   against the already-independently-extracted braille, and by back-translating the given
   braille (`louis.backTranslate`) to recover exact wording neither run had captured or had
   captured only approximately. This recovered, among other things: Example 18-1's own
   transcriber's-note wording ("...in the list of names are red.", not either run's own
   "section below"/"bold red type" guesses); the exact split of Sample 18-1's/18-2's own
   Option 1 (braille.lines) vs Option 2 (braille.variants), neither run having applied this
   split consistently to BOTH samples (Sample 18-1's own braille.lines from both runs
   flattened both Options into one array, including the print-only "Option 1"/"Option 2"
   captions as if they were braille content); Example 18-3's own bold-punctuation typeform
   boundaries (the given braille's scattered `^22`/`^26`/`^28`/`^24` sequences are bold
   start/end indicator PAIRS around each bold punctuation mark, not visual artifacts — modeled
   here with real bold segment markup, confirmed by forward-translation reproducing them almost
   exactly); and Example 18-13's/18-14's own correct typeform boundary for a word ending in a
   sentence period (`*friendly.*`/`*rattles.*`, period INSIDE the italic/bold span — the given
   braille has no separate terminator before the period; marking the period as plain,
   `*friendly*.`, forward-translates with a spurious extra terminator, confirmed live).
4. `illustrates.rule`/`illustrates.quote` was reset, file by file, from either run's own
   guess (often the example/sample's own CAPTION text, e.g. "Example 18-11: Diagramming with
   Two Separate Arrows", rather than the actual RULE text it illustrates) to the rule text
   itself, matched to the example/sample's own placement directly under a numbered rule
   heading in the source (confirmed for every file, not assumed) — matching the §15/§19 gold
   precedents' own step 4. **Unlike** the §19 gold precedent (where both runs shared a single
   hard-set placeholder rule id, `"19.2.2"`, across all six embedded quotes), both runs here
   already correctly matched each of the ten embedded `Sample:` quotes to its own real citing
   rule id — no placeholder-id bug recurs in §18.
5. This task's own brief states "Samples 18-2 and 18-3 show two Options each: first as
   braille.lines, the rest as braille.variants." The source does not support this claim as
   written: **Samples 18-1 and 18-2** are the section's own two-Option samples (each captioned
   "Option 1" / "Option 2" in the source, at 14802/14813 and 14833/14859 respectively); Sample
   18-3 has only ONE transcription (confirmed directly: the source's own "(Return to Text)" at
   line 14898 follows immediately after item 13, then Sample 18-4's own heading — no Option 2
   anywhere). Both runs' own `uncertain` fields, independently, already reached this same
   conclusion for Sample 18-3. Settled from the source, per this task's own instruction to do
   so whenever a claim — including the brief's own — conflicts with it; Sample 18-1 was
   restructured to match Sample 18-2's own established `{braille.lines, braille.variants:
   [{label, lines}]}` convention (used elsewhere in this gold corpus, e.g.
   `section-13/sample-13-03.json`) accordingly.

See `differences.md` (kept in this session's scratch folder,
`compare-gold-18/differences.md`, per the task's own instructions — not committed to the
repository) for the complete, file-by-file breakdown of every disagreement between the two
runs and every correction made against the source.

## `buildModel18` — the grammar model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to confirm
`standards-findings.md` F-186..F-190 (already assessed before this reconciliation began, 17
Sep 2026) — no "label", "diagram", "typeform" (beyond the three ordinary italic/underline/bold
bits), or "uncontracted"-adjacent construct exists anywhere for §18's own subject matter:

- **F-186** — no inline/embedded transcriber's-note mechanism; only a standalone `note` block
  exists (`formatTranscriberNote` always produces its own paragraph at fixed 6-4 margins).
  Blocks Examples 18-5/18-6, Sample 18-3's own per-mark note-plus-meaning list items, and
  Sample 18-4's own internally-structured note (an intro sentence, a blank line, then a
  numbered key list, all inside ONE `@.<...@.>` span in the source — `formatTranscriberNote`
  only ever wraps its content as one flat run-on paragraph, with no internal blank-line/list
  support of its own).
- **F-187** — no UEB "braille grouping indicator" (`;<`/`;>`) exists anywhere in the codebase,
  distinct from ordinary print-style parentheses/brackets (which translate correctly with zero
  Emboss-specific code — confirmed live, e.g. Example 18-7's own `(long, shaggy, short)`).
  Blocks Example 18-8's own inserted-phrase enclosure.
- **F-188** — only one transcriber-defined symbol exists in the whole codebase
  (`TD_SYMBOL_1`, hardcoded to the print asterism) — UEB §9.5's open-ended "transcriber-defined
  typeform indicator" (a numbered/lettered mark the transcriber invents per document) cannot be
  minted a second time. Blocks Example 18-2's own red-letter mark, Example 18-6's own
  crossed-out-word mark, Example 18-9's own single-vs-double-underline distinction (Emboss's
  TYPEFORM has only one underline bit), and Sample 18-5's own two shape marks (circled/boxed).
- **F-189** — no diagram/arrow/analogy-symbol layout support of any kind, AND no way to give an
  ordinary paragraph a non-default first-line/runover margin pair (its own "test that would
  prove a fix" already names a `margin` override on `para` giving 1-3 as part of the fix).
  Blocks every arrow diagram (Examples 18-11 through 18-14) outright, and is also the direct
  cause of a recurring, narrower margin mismatch seen on several files that are NOT arrow
  diagrams at all: Example 18-4's own three short example sentences (the given braille shows a
  flush first line / cell-3 runover — a "1-3" hanging margin — for a wrapped sentence;
  `formatPara`'s own non-quote branch hardcodes `runover:0` unconditionally, so a wrapped
  continuation always sits flush, never indented) and Example 18-10's own single-line sentence
  (the given braille is flush at cell 1; an ordinary `para` defaults to a 2-cell first-line
  indent with no override available).
- **F-174** (reused from §10's own already-recorded finding, not restated as new — its own
  general shape, "no directions/example paragraph style exists", recurs identically here): a
  cell-5-indented introductory/directions sentence appears in several places in §18
  (Examples 18-2, 18-3, 18-7, 18-14 all indent their own lead-in sentence 4 cells beyond the
  book's own margin, rather than the ordinary 2-cell paragraph default) with no dedicated block
  type or margin override to produce it — an ordinary `para` block always falls back to its own
  2-cell default.
- **F-190** — no no-break primitive exists for §18.4.1's own analogy-symbol word pairs; not
  directly exercised by any file with braille in this gold set (§18.4.1's own worked material
  is entirely the embedded, no-braille `sample-18-18.4.1c.json`), listed here for completeness.

Every mismatch this reconciliation's own `--update-status` run traces to is one of F-174,
F-186, F-187, F-188, F-189 (reused, already documented before this task began) — nothing was
left unattributed, and no new finding was needed. See `differences.md` for the complete,
file-by-file breakdown of which finding explains which file, and
`Emboss/tests/gold_bana_section18.test.mjs` for the regression guard.

A separate, narrower observation, not itself an Emboss code gap: several numbered Samples'
own first braille line (Samples 18-1, 18-2, 18-3, 18-5) carries a trailing right-margin cell
(`#,-` — a braille page number, e.g. for print page 18-15) as page furniture belonging to the
BOOK's own page layout, not to the sample's own content — recorded in each such file's own
`braille.notes`, never built (matching every other gold section's own "print page number: never
modeled" convention), and expected to appear as part of each such file's own mismatch even once
every genuine content-side gap above is fixed.

## Gold-run.mjs results (18 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-18 --update-status`: **1 match** (Example
18-1 — a transcriber's note plus a plain list of names, the section's own least-encumbered
worked example), **7 mismatch**, **12 not-representable**, **11 no-braille** (the ten embedded,
unnumbered "Sample:" wordings, plus Example 18-15's own print-only spatial diagram).
"Not-representable" (rather than a plain "mismatch") is reported whenever `buildModel18` left
out ANY real print content it was given — reusing `runOne`'s own established §4/§7/§8/§1/§16/
§9/§13/§3/§6/§15/§19/§14/§17/§10/§21 convention (`section-18` added to that same list, the only
non-additive edit made to `gold-run.mjs` beyond the new builder and its dispatch entry) rather
than Emboss producing outright wrong output for content it WAS given:

- **not-representable** (12): Examples 18-2, 18-5, 18-6, 18-9, 18-11, 18-12a, 18-12b, 18-13,
  18-14; Samples 18-3, 18-4, 18-5 — every one of these has at least one `other` limitation
  (F-186/F-187/F-188/F-189) alongside whatever WAS built.
- **mismatch** (7): Examples 18-3, 18-4, 18-7, 18-8, 18-10; Samples 18-1, 18-2 — every one of
  these was built with NO `other` block at all (no limitation recorded), so its mismatch is a
  genuine formatting-only difference from otherwise fully-attempted content: Examples 18-3,
  18-4, 18-7 (F-174's own "no directions/example paragraph margin" gap), Example 18-10 and
  Sample 18-1/18-2 (a plain margin/wrap difference, F-189's own "no margin override on para"
  gap, or — Sample 18-1/18-2 — the Option 1/Option 2 split itself, already exact per §1 above),
  and Example 18-8 (built as plain text with no grouping-indicator markup at all, since none
  exists to invoke, F-187 — recorded in the file's own `print.notes`/`resolution` rather than
  as a block-level `other` limitation, so it is not counted among the 12 above).

See `differences.md` for the complete, file-by-file breakdown of every mismatch's own first
differing line and finding attribution.
