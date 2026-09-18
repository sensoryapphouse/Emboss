# Gold examples — BANA Braille Formats 2016, §17 (Spelling Lists and Activities)

## What these files are

33 JSON files, matching the 33 items the section's own numbered running text and Samples list
names (13 inline Examples + 18 numbered Samples + 2 embedded, unnumbered `Sample:` wordings):

- **13** inline **Examples**: `example-17-1.json` … `example-17-13.json`.
- **18** numbered **Samples**: `sample-17-1.json` … `sample-17-18.json`.
- **2** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples), named after their own
  citing rule since neither has its own "17-N" number, matching the §15/§19 gold precedents'
  own convention for this exact situation: `sample-17-17.11.1d.json` (rule 17.11.1d's own
  short crossed-out-letters wording) and `sample-17-17.11.2c.json` (17.11.2c's own longer
  wording, "...The repeated word is enclosed within transcriber's note indicators."). Neither
  has a braille rendering anywhere near its own citing location (`braille.lines: []`).

Each file has the same top-level shape as every other precedent (`id`, `title`, `pdfPages`,
`textLines`, `illustrates`, `print`, `braille`, `uncertain`, `sources`, `resolution`).
`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text }` — an ordinary heading (level 1/2/3 = centred/cell-5/cell-7,
  re-measured directly against each file's own agreed braille, never taken on either
  transcription run's say-so — see `differences.md` for the Sample 17-6/17-18 corrections this
  found). Print's own all-caps typography is NOT necessarily kept: where the given braille shows
  only ordinary per-word capitalisation (a single-comma word-cap sign per word, "to"/"of" etc.
  left lowercase), the heading text is built in title case, matching BANA's own "ignore print's
  all-caps emphasis" convention (§18.2.1); where the braille genuinely preserves a whole-phrase
  all-caps run (the triple-comma/`,'`-terminated passage form), the heading text is kept in caps
  (Sample 17-12's own boxed "MARIA LOPEZ STARS IN"/"NEW MUSICOL PLAY").
- `{ kind:"paragraph", text, blocked?, continuation? }` — ordinary prose OR this book's own
  imperative "activity directions" instruction line ("Write...", "Complete...",
  "Unscramble...", "Read..."). `blocked:true` (matching `buildModel4`/`19`'s own convention)
  marks a paragraph the given braille shows flush (1-1) directly under a cell-5/7 heading with
  no blank line between (§1.9.3's own heading-adjacency exception — Samples 17-6/17-9's own
  intro paragraphs). `continuation:true` is this builder's own device for a paragraph the given
  braille shows FLUSH (cell 1) with no leading blank line at all and no preceding heading to
  join against (every isolated worked "Example" in this section turns out to need this —
  Examples 17-4/17-5/17-6/17-7/17-9/17-12 — plus Sample 17-3's own genuine excerpt and Sample
  17-8's own opening paragraph); `formatPara`'s own `continuation` field (`document.mjs:644`)
  happens to give exactly this margin+no-blank combination even though its own doc-comment
  frames it as "a paragraph resuming after a print page turn" — a deliberate reuse of an
  existing mechanism for its OUTPUT shape, not its documented purpose. Neither field can
  reproduce the 5-5 margin this section's OWN "activity directions" convention actually needs
  (there is no third option) — see **F-235**, new.
- `{ kind:"note", text }` — a standalone transcriber's note (`formatTranscriberNote`) — the
  block-level TN mechanism, already working for every one of this section's own worked
  illustrations of it (17.9.2a, 17.11.1d, 17.13.1c, 17.13.2 — `standards-map.md`, "done").
- `{ kind:"list", items:[{text, marker?}] }` — an ordinary spelling/activity word list
  (BANA §17.2-17.5, §17.8-17.13's own subject matter). An item's own `text` goes through the
  usual cell-markup DSL (`` `backtick` `` = uncontracted grade-1 run) and, where the given
  braille shows BOTH the contracted first writing AND the uncontracted repeat (17.2.2c-e), the
  item's own text carries BOTH forms already ("brain `brain`") — there is no automatic
  "spelling list duplicates its own word" mechanism anywhere in Emboss; 17.2.2c/d is a content
  decision the transcriber/importer must already have made (`standards-map.md`, "done" only
  once both forms are supplied), reflected here as a reconciliation decision, not read off
  print pixels (print itself shows the word only once).
- `{ kind:"glossary", items:[{term, def}] }` — a definition/foreign-vocabulary list (BANA §17.6
  Definition Lists / §17.7 Word Lists in Foreign Language Texts), built via Emboss's own `<dl>`
  mechanism (`standards-map.md` 17.6.1/17.7.2b-c, "done"). `term`/`def` accept the same
  cell-markup DSL as any other text field (Sample 17-9's own italicised word-mentions inside a
  definition) — this reconciliation found and worked around a genuine `document.mjs` bug doing
  so, **F-236**, new (see below).
- `{ kind:"box", blocks:[...] }` — print's own ruled box (BANA §7), a nested container recursed
  into and built exactly like `buildModel7`/`8`/`12`'s own box handling (Samples 17-5, 17-7,
  17-12's own boxed word lists/review).
- `{ kind:"other", text, features }` — never modelled; a devised picture-icon marker with no
  print character to build from (F-213), a print table the transcriber's own braille already
  linearises into running text with nothing table-shaped left to model, or a multiple-choice
  answer grid abridged by the transcriber mid-list.

## How these files were made

1. Two independent transcription runs (`gold-17-A`, `gold-17-B`) already existed, both produced
   by the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own `summary.md`)
   — NOT independent evidence of each other, per this task's own brief. Both runs' own
   `summary.md` claims every `braille.lines` entry was already verified in-session against
   `references/_text/braille-formats-2016.txt` (lines 13357-14309) with "Issues noted: []" — but
   the two runs disagree on total line count (285 vs 281), so this claim alone was not trusted.
2. Per this task's own explicit instruction, agreement between the two runs was treated as NO
   evidence of correctness. Every sample's `braille.lines` was independently RE-EXTRACTED from
   the source text directly (never copied from either run): for a numbered Sample, the
   line-number field (digits then >=3 spaces) was stripped; for an unnumbered Example, the fixed
   left margin was measured (the count of leading ASCII space characters on the block's own
   content lines, excluding the title/page-number lines); U+2800 was converted to a literal
   space and trailing spaces stripped. This independent extraction agreed byte-for-byte with
   BOTH runs on 23 of 31 real-braille files; on the remaining 8 it found a genuine error in one
   or both runs — including THREE files (Samples 17-7, 17-10, 17-12) where BOTH runs
   independently dropped the very same genuine trailing blank braille line, exactly the kind of
   shared, model-correlated gap this task's own brief warned about. See `differences.md`
   (kept in this session's scratch folder, `compare-gold-17/differences.md`, per the task's own
   instructions — not committed to the repository) for the complete, file-by-file breakdown.
3. Separately, and regardless of A/B agreement, the print side of EVERY file was verified by
   forward-translating each candidate `print.blocks` reconstruction through Emboss's own
   translator (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does, via the new
   `buildModel17`) and diffing character-for-character against the already-independently-
   extracted braille. This found and fixed two genuine modelling/code issues along the way
   (Sample 17-6's heading was wrongly built in all-caps; `glossarySegments` was found to
   silently drop a definition supplied only as `defSegments` — **F-236**, new, worked around in
   the builder) before settling on the final reconciled files. See `differences.md` for the
   complete evidence trail.
4. `illustrates.rule` was checked against the source's own explicit `(See Sample N: Title on
   page N.)` cross-references (and the surrounding clause text, for Examples) for every file.
   Unlike the §19 gold precedent, this section's own two embedded `Sample:` quotes were NOT
   affected by a shared placeholder id — both runs already had `17.11.1d`/`17.11.2c` correct.
   Eleven files needed a correction anyway: three where a run cited an outright wrong or
   nonexistent rule number (Sample 17-7's own "17.4", Sample 17-8's own "17.6.2c" — there is no
   17.6.2 anywhere in this section), the rest resolved to a more specific lettered clause than
   either run's own bare section id. See `differences.md` §2 for the complete table.

## `buildModel17` — the spelling-lists-and-activities model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to learn the
real word-list/glossary model `buildModel17` reproduces (search "uncontracted", "formatList",
"glossary"): an ordinary spelling/activity list goes through `formatList`
(`document.mjs:515-552`, the SAME mechanism §4/§7/§8/§19's own gold builders already use for
their own lists) and a definition/foreign-vocabulary list goes through `formatGlossary`/
`glossarySegments` (`document.mjs:1010-1026`/`996-1008`), a genuinely dedicated `<dl>`-style
mechanism with no precedent-section builder using it before this one. Both are pre-existing,
general-purpose mechanisms — `buildModel17` builds only what they can express, and records
every genuine limitation (a devised icon marker, a transcriber's editorial abridgement, a
linearised print table) as documented, not guessed.

## Gold-run.mjs results (18 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-17 --update-status`: **4 match** (Examples
17-4, 17-5, 17-6; Sample 17-9), **25 mismatch**, **2 not-representable** (Samples 17-5, 17-14 —
a transcriber's own editorial mid-list abridgement, matching `buildModel8`'s own established
`"444"` precedent, not a code gap), **2 no-braille** (the two embedded, unnumbered `Sample:`
wordings). Every mismatch/not-representable file's cause is one or more of:

- **F-235** (new) — no paragraph margin mechanism produces the 5-5 (cell 5/cell 5) indent this
  section's own "activity directions" instruction lines consistently need (`formatPara` only
  ever gives cell 3/cell 1 or cell 1/cell 1): Example 17-11; Samples 17-2, 17-4, 17-11, 17-12,
  17-13, 17-15, 17-17, 17-18.
- **A gap in `gold-run.mjs`'s OWN test harness, not in Emboss itself**: its `OPTS`
  (`gold-run.mjs:2586-2593`) never wires a grade-1 (`translateG1`) translator, so a segment
  marked `uncontracted:true` gets the correct UEB grade-1 indicator (`;;`/`;;;...;'`) added, but
  the letter content inside it still comes from the ordinary grade-2 `translate()` function —
  confirmed directly (a standalone probe against the exact same `formatDocument`/`OPTS` wiring
  this script uses). The real web app's own `translateG1` wiring (`Emboss/web/app.mjs:347`) is
  separate, real code, already independently confirmed working (minus typeform, F-210) via
  probes against the real app in this section's own `standards-map.md` assessment. Per this
  task's own strict `gold-run.mjs` edit scope (only `buildModel17` + dispatch entries), this was
  NOT fixed here — flagged via a spawn_task for a follow-up session instead. Affects: Examples
  17-3, 17-7, 17-8, 17-9, 17-10, 17-12, 17-13; Samples 17-1, 17-3, 17-6, 17-10, 17-16.
- **F-211** (reused) — no inline/embedded transcriber's-note segment (`@.<...@.>` mid-sentence):
  Examples 17-9, 17-12, 17-13; Sample 17-16.
- **F-183** (reused) — `glossarySegments` always injects either a colon or a single blank cell,
  never BANA's own required two-blank-cell phrase-entry spacing: Sample 17-8.
- **F-185** (reused) — no foreign-language braille support; English UEB Grade-2 contraction
  rules misfire on Spanish letter sequences: Examples 17-1, 17-2.
- **F-212** (reused) — no per-item content-length list/glossary alignment: Example 17-2.
- **F-213** (reused) — a devised picture-icon marker leaks/is dropped, no print character to
  build from: Sample 17-7.
- **F-236** (new) — `glossarySegments` silently drops a definition supplied only as
  `defSegments` when its own plain `def` string is empty; worked around in `buildBlocks17`
  (always supplies a plain-text fallback alongside any `*Segments` array) — see the code comment
  directly above it in `gold-run.mjs`.

See `differences.md` for the complete, file-by-file breakdown, and
`Emboss/tests/gold_bana_section17.test.mjs` for the regression guard.
