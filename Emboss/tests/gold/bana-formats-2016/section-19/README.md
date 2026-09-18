# Gold examples — BANA Braille Formats 2016, §19 (Codes and Puzzles)

## What these files are

18 JSON files, matching the 18 items `gold-19-A`/`gold-19-B`'s own `summary.md` files list for
this section (18 total to be exact) and `Emboss/docs/standards-map.md`'s own §19 table:

- **5** inline **Examples**: `example-19-1.json` … `example-19-5.json`.
- **7** numbered **Samples**: `sample-19-1.json` … `sample-19-7.json`.
- **6** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples), named after their own
  citing rule since none has its own "19-N" number, matching the §15 gold precedent's own
  convention for this exact situation: `sample-19-19.2.1c.json`, `sample-19-19.2.2f.json`,
  `sample-19-19.3.1d.json`, `sample-19-19.5.1.json`, `sample-19-19.5.3j.json`,
  `sample-19-19.5.3l.json`. None of these six has any braille anywhere near its own citing
  location (`braille.lines: []`).

Each file has the same top-level shape as every other precedent
(`id`, `title`, `pdfPages`, `textLines`, `illustrates`, `print`, `braille`, `uncertain`,
`sources`, `resolution`). `print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text }` — an ordinary heading (used for Sample 19-5's own
  "Across"/"Down" cell-5 headings).
- `{ kind:"paragraph", text, blocked? }` — ordinary prose. `blocked:true` (matching
  `buildModel4`'s own flush-paragraph convention) marks a puzzle's own flush title line or an
  introductory line whose given braille shows NO differential indent between its own first
  line and its own runover lines (confirmed directly against every file's own agreed braille,
  never assumed) — e.g. Sample 19-1's "Symbolically Speaking" and its own weather/pine-cone
  introduction, Sample 19-4's "Picture Riddle" and its own riddle/golf-sock lines.
- `{ kind:"note", text }` — a standalone transcriber's note (`formatTranscriberNote`), the one
  mechanism this section's own findings (F-218) confirm actually works — every TN in this
  corpus (Examples 19-1/19-4, Samples 19-1/19-2/19-3/19-5/19-6) was decoded straight from the
  given braille by back-translation (`louis.backTranslate`) and, in several cases, matches a
  rule's own quoted "Sample:" wording verbatim.
- `{ kind:"list", items:[{text}] }` — a numbered clue list (Sample 19-5's Across/Down clues,
  each carrying its own embedded position/length annotation as plain trailing text since
  Emboss has no way to enclose it, F-221) or an uncontracted scrambled-word list (Sample
  19-3's five puzzle answers, backtick-marked so `buildModel19` builds a genuine
  `uncontracted:true` segment per F-218's own positive finding).
- `{ kind:"code", text }` — the ONE mechanism (`formatCodeBlock`) that emits any grade-1
  passage-wrapped output at all for a devised code/key/grid (Sample 19-1's key+coded message,
  Sample 19-2's linear key, Sample 19-3's QWERTY key, Example 19-5's word-search grid,
  Sample 19-6's shaped grid). `block.text` is passed through completely unescaped/unparsed by
  cell-markup, matching `formatCodeBlock`'s own real behaviour — expect every one of these to
  mismatch, via F-219 (column alignment collapses), F-220 (the required dot locator for "use"
  is never emitted before the grade-1 passage indicator/terminator), and F-222 (a devised
  substitution symbol, or the sample's own boxed/full-cell rule lines, cannot be produced by
  `louis.translate()` on demand).
- `{ kind:"other", text, features }` — never modeled; a genuine puzzle picture, a
  crossword/word-search/shaped-letter/Sudoku grid, a Sudoku's own line-mode divider rows, or a
  print page-number cell, exactly like every other section's own 'other' convention.

## How these files were made

1. Two independent transcription runs (`gold-19-A`, `gold-19-B`) already existed, both
   produced by the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own
   `summary.md`) — NOT independent evidence of each other, per this task's own brief. Both
   runs' own `summary.md` claims every `braille.lines` entry was already verified in-session
   against `references/_text/braille-formats-2016.txt` (lines 14956-15510) — but the two runs
   disagree on total line counts (183 vs 187), so this claim alone was not trusted.
2. Per this task's own explicit instruction, agreement between the two runs was treated as NO
   evidence of correctness. Every sample's `braille.lines` was independently RE-EXTRACTED from
   the source text directly (never copied from either run): the line-number field (digits then
   at least three spaces, for numbered Samples) or the fixed 9-space left margin (for unnumbered
   Examples) was stripped by counting columns, U+2800 was converted to a literal space, and
   every resulting line — including the digit-cell lines the task named specifically ("7 8 9
   0 …", "444", "7777…") — was kept exactly. This independent extraction agreed byte-for-byte
   with BOTH runs on every file except Samples 19-4 and 19-5 (below); it also confirmed the
   task's own advance knowledge that Sample 19-5 (page 1, lines 1-9) and Sample 19-7 (lines
   1-4) genuinely have no braille in the source at all — not merely "a picture", but literally
   absent from the extracted text, with the numbering itself jumping straight from a lettered
   sub-heading to line 10 (19-5) / line 5 (19-7).
3. Separately, and regardless of any A/B agreement, the print side of EVERY file was verified
   by (a) forward-translating each candidate print paragraph/note/list through Emboss's own
   translator (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does) and diffing
   character-for-character against the already-independently-extracted braille, and (b), for
   the many lines that are NOT ordinary print prose at all (a devised-symbol cryptogram, a
   letter-substitution key, a numbered picture-riddle answer), by BACK-translating the given
   braille (`louis.backTranslate`) and/or manually substituting through the sample's own
   key/legend, then cross-checking the result against the PDF page image
   (`references/bana/braille-formats-2016.pdf`, `pdfPages`). This recovered several things
   NEITHER run had captured or had captured wrongly — see `differences.md` for the complete,
   file-by-file evidence trail; in summary:
   - Two files (Examples 19-1 and 19-2) had NO transcriber's-note block at all in either run,
     despite BANA 19.3.1d requiring exactly one and the given braille actually carrying one —
     recovered by back-translation.
   - Sample 19-1's own cryptogram answer: A had guessed
     "WHEN IT IS GOING TO RAIN, SCALES OF A PINE CONE CLOSE; IN DRY WEATHER, THEY OPEN." — close
     but wrong in two places (missing "THE", and "CLOSE;" instead of "CLOSE UP;"); B left the
     puzzle's own text empty. Independently re-decoded here letter-by-letter through the
     sample's own key table and cross-checked against the PDF image and the symbols appendix
     for the punctuation digits: "WHEN IT IS GOING TO RAIN, THE SCALES OF A PINE CONE CLOSE UP;
     IN DRY WEATHER, THEY OPEN."
   - Both runs, being the same model, made the IDENTICAL error on ALL SIX embedded "Sample:"
     files: every one had `illustrates.rule` hard-set to the fixed placeholder `"19.2.2"`
     regardless of which rule the quote actually illustrates — corrected to each file's own
     rule id (already embedded in its filename, confirmed by re-reading the source at the
     given `textLines`).
   - Sample 19-4's own riddle-answer sentence: B's own guess, "IN CASE THEY GET A HOLE IN
     ONE!", is independently corroborated here by checking its word-length pattern
     (2,4,4,3,1,4,2,3) against the given braille's own numbered blank-groups, which match
     exactly.
   - Sample 19-4's own two-page braille: A recorded it correctly (34 lines, one `pageBreaks`
     entry after line 13); B instead fabricated four extra blank lines between the two pages
     with no `pageBreaks` marker at all — A's version, independently re-derived from source,
     is what this file keeps.
   - Sample 19-5's own two-page braille: BOTH runs mis-handled the 9 missing lines on page 1
     (A used `pageBreaks:[14]`, assuming a 14-line first page; B recorded no `pageBreaks` at
     all) — this reconciliation instead independently re-derives both pages directly from
     source (11 real lines on page 1, the transcriber's note; `pageBreaks:[11]`; 25 lines on
     page 2) and decodes the Across/Down clues fresh via back-translation (neither run had
     transcribed the clue text correctly into `print.blocks` at all).
   - Example 19-4's embedded transcriber's note: decoded the BRF opening/closing-parenthesis
     signs (`"<`/`">`, confirmed against the symbols appendix, source line 18498) to establish
     that only the letter-count is parenthesized ("(8)"), not the column/row designator
     ("a1") — neither run had this exactly right.
   - Sample 19-1's own print puzzle number groupings (Example 19-1, not Sample) were
     independently re-verified against the PDF page image and found to be CORRECT as both
     runs already had them, even though they don't match the given braille's own row-wrap —
     the braille reflows the puzzle's last hyphenated word-group of two print rows onto the
     end of the PRECEDING braille line (19.3.1c, "do not divide words between braille
     lines"), which is a genuine feature of the passage, not a transcription error.
4. `illustrates.rule` was corrected for the six embedded-quote files as described above,
   matching the §15 gold precedent's own step 4.

See `differences.md` (kept in this session's scratch folder, `compare-gold-19/differences.md`,
per the task's own instructions — not committed to the repository) for the complete,
file-by-file breakdown of every disagreement between the two runs and every correction made
against the source.

## `buildModel19` — the codes-and-puzzles model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to confirm
`standards-findings.md` F-217's own claim that NO code anywhere recognises any §19 construct —
there is no `case` in `formatBlock`'s switch for a puzzle, grid, code-character, or linear-key
block type at all. `buildModel19` therefore builds only what a handful of PRE-EXISTING,
general-purpose block types can express (heading, paragraph, note, list, code), and records
every genuine puzzle/grid/key as a documented 'other' limitation rather than inventing a block
type Emboss itself has no way to format — see the block-kind list above and the comment block
directly above `buildBlocks19` in `Emboss/scripts/gold-run.mjs` for the full reasoning per kind.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-19 --update-status`: **1 match** (Example
19-3, a plain "follow print" Morse-sounds paragraph — 19.4.2 needs no special handling at all
and reproduces byte-for-byte), **2 mismatch**, **9 not-representable**, **6 no-braille** (the six
embedded, unnumbered "Sample:" wordings). Every mismatch/not-representable file's cause is one
or more of the section's own already-documented findings:

- **F-217** (no §19 construct recognised at all) underlies every 'other' limitation in every
  not-representable file (Example 19-1's puzzle numbers; Example 19-2's letter/Morse
  alignment; Samples 19-1/19-2/19-3's own boxed key/passage content; Sample 19-4's picture
  clues and numbered answer key; Sample 19-5's crossword grid; Sample 19-6's word-bank and
  shaped grid; Sample 19-7's line-mode divider rows).
- **F-219** (multi-space column alignment collapses to one space, and a line's own leading
  indent is discarded) is the reason every 'code'-block sample (19-1, 19-2, 19-3, Example
  19-5, 19-6) cannot reproduce its own key/grid layout even where a mechanism is attempted.
- **F-220** (the "dot locator for use" is never emitted before a grade-1 passage
  indicator/terminator) is Example 19-5's own mismatch cause exactly: expected `""=;;;`,
  actual `;;;`.
- **F-221** (no inline/embedded transcriber's-note mechanism exists) is Example 19-4's own
  mismatch cause exactly: expected `@.<A#A "<#H">@.>`, actual `A#A "<#H">` — the letter-count's
  own parentheses come out right (an ordinary parenthesis sign), but the required TN
  enclosure around the whole thing does not.
- **F-222** (no facility to author a raw/devised braille cell) underlies the devised-symbol
  cryptogram (Sample 19-1), the Sudoku line-mode divider rows (Sample 19-7), and the crossword
  grid's own hyphen/full-cell alphabet (Sample 19-5).

Sample 19-3 and Sample 19-1's own box-rule diagnosis ("expected output is enclosed in a box…
but Emboss produced no box lines") reflects the same F-217 gap from a different angle: no
puzzle/key content in this schema is ever wrapped in a document `box` block, since doing so
would still not reproduce the required grade-1-passage-inside-a-box nesting these samples
actually need. Sample 19-7's own row-level mismatch (a plain 2-cell paragraph indent the given
braille's own flush rows don't have) is a secondary, expected side effect of building each
Sudoku row as its own separate one-line paragraph block (`formatParagraph` does not preserve a
forced internal line break within a single block's own text — multiple rows joined by `\n` in
one block get re-flowed and merged together instead, confirmed empirically while building this
file) rather than a puzzle-specific defect; the sample's own overall not-representable status
already comes from its line-mode divider limitation (F-222) regardless. See `differences.md`
for the complete, file-by-file breakdown, and `Emboss/tests/gold_bana_section19.test.mjs` for
the regression guard.
