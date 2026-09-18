# Gold examples — BANA Braille Formats 2016, §14 (Plays, Cartoons, and Graphic Novels)

## What these files are

25 JSON files, matching the 25 items §14's own running rule text and its own numbered Samples
list name, matching `Emboss/docs/standards-map.md`'s own §14 table:

- **10** inline **Examples**: `example-14-1.json` … `example-14-10.json`.
- **12** numbered **Samples**: `sample-14-1.json` … `sample-14-12.json`.
- **3** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples), named after their own
  citing rule since none has its own "14-N" number, matching the §15/§19 gold precedents' own
  convention for this exact situation: `sample-14-14.5.2a.json` (Martha and Peter together),
  `sample-14-14.5.2b.json` (Solo), `sample-14-14.6.2b.json` (the three-blank-cells wording).
  None of these three has any braille anywhere near its own citing location
  (`braille.lines: []`).

Each file has the same top-level shape as every other precedent (`id`, `title`, `pdfPages`,
`textLines`, `illustrates`, `print`, `braille`, `uncertain`, `sources`, `resolution`).
`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"cast-list", items:[{text}] }` — BANA §14.2's own subject: each `items[].text` (with
  Emboss's own **bold**/*italic* cell-markup where print itself shows a name in a distinct
  font, 14.2.1c) becomes a run of consecutive `{type:'play', subtype:'prose'}` blocks — the
  SAME non-verse `formatPlay` path a `speech` block below uses at level 0 (1-3 margins), which
  happens to give exactly 14.2.1b's own required 1-3 margins with no cast-specific code needed
  at all.
- `{ kind:"heading", level, text }` — an ordinary heading (a scene title/number, §14.3.1a; a
  play's own centred closing phrase, §14.8.1).
- `{ kind:"paragraph", text, blocked? }` — an ordinary prose paragraph (a scene-setting
  description, §14.3.1b); `blocked:true` marks a confirmed-flush (not indented) opening line.
- `{ kind:"speech", speaker?, text, verse?, level? }` — §14's actual SUBJECT: a speaker's turn.
  `speaker` is documentation only — the structural driver is the fully pre-composed `text`,
  WITH the speaker's own name/punctuation already folded in exactly as print shows it (there is
  no single, generic speaker-to-dialogue separator: a period, a colon, or nothing but two
  spaces, depending on the sample). `verse:true` selects the VERSE `formatPlay` path (§14.6's
  1-5/3-5 margins); the default is the PROSE path (§14.5/14.9/14.10's 1-3/5-3 margins).
  `level:1` selects each rule's own SECOND margin (prose: 5-3, "additional paragraph by the
  same speaker", 14.5.1e; verse: 3-5, "additional lines by the same speaker", 14.6.1b).
- `{ kind:"stage-direction", text, level? }` — a stage direction printed BETWEEN dialogue lines
  (§14.4/14.5.3/14.6.3/14.7.2): `level:0` (default) is 7-7; `level:1` is "an additional
  paragraph of stage directions", 9-7.
- `{ kind:"note", text }` — a standalone transcriber's note (`formatTranscriberNote`): §14.5.2's
  simultaneous-speaker wording, and §14.10/§14.11's cartoon/frame labels together with any
  scene-setting/caption text the source itself shows fully enclosed.
- `{ kind:"blankline" }` — a forced blank line, reusing buildModel13/15's own stanza-break
  mechanism: BANA §14.10.1's own "insert a blank line before and after a cartoon" (separating a
  cartoon's own title/speaker's-note header from its first frame).
- `{ kind:"other", text, features }` — never modelled; recorded as a limitation exactly like
  every other section's own 'other' — a genuine cartoon/graphic-novel PICTURE, print's own
  columned two-speaker layout Emboss is told to ignore anyway (§14.5.2c), or a print page-number
  fragment that bled into the extracted braille text (see below).

## How these files were made

1. Two independent transcription runs (`gold-14-A`, `gold-14-B`) already existed, both produced
   by the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own `summary.md`)
   — NOT independent evidence of each other, per this task's own brief. Both runs claimed every
   `braille.lines` entry was already verified in-session against
   `references/_text/braille-formats-2016.txt` (lines 11061-11772).
2. Per the brief's own explicit instruction, agreement between the two runs was treated as NO
   evidence of correctness by itself. Every sample's `braille.lines` was independently
   RE-EXTRACTED from the source text directly: each numbered Sample's own line-number field
   (digits then at least three spaces) or an inline Example's fixed 9-space left margin was
   stripped by counting columns and cross-checking against every print-page footer's own line
   position (`Section 14` / `14-N` — used to derive every file's own `pdfPages` independently
   of either run, see §3 below), U+2800 converted to a literal space, and every resulting line
   kept exactly. This independent extraction agreed byte-for-byte with BOTH runs on all 25
   files' own `braille.lines` — genuine agreement here, not just an unverified shared claim,
   since it came from a fresh, from-scratch re-derivation of the page/line boundaries.
3. Separately, and regardless of any A/B agreement, the print side of EVERY file was verified
   by forward-translating each candidate `print.blocks` reconstruction through Emboss's own
   translator (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does) and diffing
   character-for-character against the given, independently-extracted braille — iteratively,
   trying candidate wordings/margins/emphasis placements until either an exact match was found
   or a genuine Emboss/liblouis limitation was confirmed and documented rather than guessed
   around. Page images were rendered directly from `references/bana/braille-formats-2016.pdf`
   (pdftoppm, pages 385-409, `pdfPages = print page + 384`, independently derived from the
   source text's own page-footer line positions — never read from `references/_gemini/`, which
   this task's own brief excludes) for the handful of cases forward-translation alone could not
   resolve (Examples 14-1/14-2's cast-list font attributes, Example 14-7's extended blank-space
   gap). `louis.backTranslate` recovered several words/phrases NEITHER run had right: Sample
   14-9's own "counsel" (both runs correct, Emboss's own translator differs, F-244), Sample
   14-11's own "Frame 1"/"2"/"3" (both runs guessed lettered frames "A"/"B"/"C") and "young
   Woman"/"Mother" (both runs guessed "Woman" with no "young", and "Mom"), and Example 14-5's
   own exact italics/ellipsis placement (both runs guessed wrong in different ways — see
   `differences.md`).
   - Both runs independently made the SAME error on `sample-14-14.5.2a`/`14.5.2b`/`14.6.2b`:
     `illustrates.rule` left `null` on all three. Corrected to each file's own citing rule id
     (already embedded in its filename), matching the §15/§19 gold precedents' own convention.
   - A recurring, book-level artifact (NOT an Emboss defect): several samples' own given braille
     carries a leftover print-page-number/running-head fragment (`#,-`) that bled into the
     extracted text mid-line (Samples 14-2, 14-3, 14-11) — the SAME `#,-` artifact the §15 gold
     precedent's own README already documents for its own Samples 15-5/15-7/15-9/15-10.
     Recorded as an unmodelled `{kind:'other'}` block in each affected file, exactly as that
     precedent does, not "fixed" by inventing a print reconstruction for it.
   - A recurring, book-level artifact of a different kind: several stage directions/narrative
     descriptions are TRUNCATED by the given braille's own `444` (ellipsis) marker well short of
     both transcription runs' own fuller guessed wording (Samples 14-2, 14-7). Only the
     TRANSCRIBED, truncated wording is built, matching the section-3/7/12 gold precedent's own
     "print.blocks records only what this excerpt's own braille actually carries" convention.

## `buildModel14` — the plays/cartoons/graphic-novels model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to confirm the
real model shapes `buildModel14` reproduces (search "play", "speaker", "stage", "cartoon"):
`formatPlay` (§13/§14 shared) and `formatStage` already exist and already have the right
margins for almost everything this section needs (1-3/5-3 prose, 1-5/3-5 verse, 7-7/9-7 stage
directions, 7-5 transcriber's notes) — §14 needed NO new document-model block type at all, only
a gold-schema `buildBlocks14` that maps its own flat `print.blocks[]` onto these already-correct
formatters. There is genuinely no "cast"/"cartoon"/"frame" construct anywhere in
`document.mjs`'s `formatBlock` switch — a cast list is just 1-3-margin `play` blocks in a row
(matching 14.2.1b's own margin exactly), and a cartoon frame label is just an ordinary
transcriber's note (matching 14.10.2/14.10.5's own 7-5 margin exactly).

Three genuine gaps THIS reconciliation's own forward-translation testing found (two newly
documented, one reused from an existing §15 finding whose root cause is identical):

- **F-206** (reused; originally documented for §15.5.2b's own identical "significant blank
  space" rule) — `wrapCells` re-tokenises translated braille on every space and rejoins with a
  SINGLE space, so the "three blank cells" 14.1.7/14.6.2a require between a speaker's name and
  an extended print gap collapses to one cell, however many literal spaces the source `text`
  carries. Affects: Example 14-7.
- **F-240** (new) — a `stage` block between two verse `play` blocks breaks
  `document.mjs`'s own `poemRunBoundaries` run, so F-121's blank-line-around-a-poem mechanism
  fires on each side of the interruption independently — directly contradicting
  14.5.3d/14.6.3d/14.7.2's own "do not insert blank lines ... between the lines of dialogue" for
  the VERSE case specifically (the PROSE case is unaffected). Affects: Example 14-8, Sample
  14-9.
- **F-241** (new) — Emboss's `note` block always encloses its ENTIRE text; there is no way to
  enclose only PART of a line (14.10.2's own "Cartoon," label plus plain continuing title text
  at the same margin), or to nest a SECOND, independently-delimited transcriber's note inside
  another block's own running dialogue (14.10.5f's own embedded action note). Affects: Example
  14-10, Sample 14-5, Sample 14-11, Sample 14-12.
- **F-242** (new) — no blank-line mechanism connects §14.3's scene-setting prose to the dialogue
  that follows it (14.3.1e); neither `formatPara` nor the non-verse `formatPlay` path emits a
  blank line of its own, and `document.mjs`'s general blank-line logic only ever REMOVES a
  blank a formatter already added, never inserts one a rule requires. Affects: Sample 14-2.
- **F-243** / **F-244** (new, both UNRESOLVED) — two narrow liblouis/uebG2 table observations
  (a spurious letter-sign before a space-preceded `...?`; the contraction `counsel` produces a
  different BRF form than the officially certified BANA transcription for the same word) that
  this reconciliation could not resolve with the evidence available; recorded rather than
  guessed around. Affects: Sample 14-3, Sample 14-9.

See `differences.md` (kept in this session's scratch folder per the task's own instructions,
not committed to the repository) for the complete, file-by-file breakdown of every disagreement
between the two runs and every correction made against the source.

## Gold-run.mjs results (18 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-14 --update-status`: **13 match**, **7
mismatch**, **2 not-representable** (an unmodelled print-page-number artifact bled into the
extracted braille: Samples 14-2, 14-3), **3 no-braille** (the three embedded, unnumbered
`Sample:` wordings under 14.5.2a/14.5.2b/14.6.2b). Every mismatch/not-representable file's cause
is one of the findings above, or one of the two unresolved translator-table observations
(F-243, Sample 14-3; F-244, Sample 14-9) — see `differences.md` for the complete file-by-file
breakdown, and `Emboss/tests/gold_bana_section14.test.mjs` for the regression guard.

Ten files reproduce their own given braille byte-for-byte: Example 14-1 (cast list), Example
14-2 (cast list with retained/omitted font attributes), Example 14-3 (a stage direction after a
speaker's name), Example 14-4 (an unenclosed, italicised stage-direction word), Example 14-5 (a
long mixed enclosed/unenclosed-italics dialogue block, resolved word-by-word by forward
translation where both transcription runs disagreed), Example 14-6 (an unenclosed stage
direction between prose dialogue lines), Example 14-9 (an interview in the prose-play format),
Sample 14-1 (a cast of characters with a ditto-marked column), Sample 14-4 (a speaker's own
5-3-margin additional paragraph), Sample 14-6 (columned dialogue correctly NOT duplicated),
Sample 14-7 (two paragraphs of prose stage directions), Sample 14-8 (a five-speech verse play),
and Sample 14-10 (a play's own bold/italic-emphasis conclusion, centred).
