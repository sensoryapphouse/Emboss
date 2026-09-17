# Gold examples — BANA Braille Formats 2016, §15 (Line-Numbered and Line-Lettered Text)

## What these files are

14 JSON files, one per worked example/sample named in the section's own running rule text and its
own numbered Samples list, matching `Emboss/docs/standards-map.md`'s own already-reconciled "BANA
§15 — worked examples" table:

- **2** inline **Examples**: `example-15-1.json`, `example-15-2.json`.
- **10** numbered **Samples**: `sample-15-1.json` … `sample-15-10.json`.
- **2** embedded, unnumbered `Sample:` illustrations quoted inline within running rule text
  (suggested transcriber's-note wordings, not full worked examples): `sample-15-15.4.1d.json`
  (rule 15.4.1d's own three-blank-cells wording) and `sample-15-15.8.1b.json` (rule 15.8.1b's own
  counted-words wording) — named after their citing rule since neither has its own "15-N" number,
  matching the §13/§3 gold precedents' own convention for this exact situation. Neither has a
  braille rendering anywhere near its own citing location (`braille.lines: []`).

Each file has the same top-level shape as the §3/§4/§7/§8/§9/§13/§16 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — an ordinary heading (level as given), exactly as
  every other precedent. Used only where the given braille itself carries a row for it (Sample
  15-9's own "The Rat That Had a Fast Rate") — a sample's own CITATION title (e.g. "Sample 15-8:
  Poem with Line Numbers and Rhyme Scheme") is never modeled this way even where it is genuinely
  printed on the page (both transcription runs wrongly did this for Sample 15-8; see
  `differences.md` §2 item 8): it lives only in the `title`/`id` fields, matching every other gold
  section's own convention, confirmed here by the given braille having no row for it at all.
- `{ kind:"other", text, features }` — never modeled; a print page number (Samples 15-5's `#,-`,
  15-7's "–107–", 15-9's reversed "7", 15-10's "-144-") or any other page-decoration content with
  no braille-buildable counterpart in this schema. Recorded as a limitation exactly like every
  other section's own 'other'.
- `{ kind:"stanzabreak" }` — a blank line between two runs of poem lines (a real stanza break in
  the print poem), reusing buildModel13's own `{type:'indicator', kind:'line'}` convention.
- `{ kind:"paragraph", text, continuation?, features }` — an ORDINARY prose paragraph with NO
  linenum apparatus at all: this section's own §15.7.1 "Paragraph Format" rhyme scheme (Example
  15-1), where a rhyme-scheme letter is shown with ordinary retained print emphasis inline in
  running text, not a line-numbering construct. `continuation:true` (matching `buildModel1`'s own
  convention) marks a paragraph that is a flush run-on of the rule's own preceding sentence, not a
  fresh paragraph start.
- `{ kind:"numbered", text, number, newPara?, printVisible?, features }` — this section's actual
  SUBJECT: §15.2 margin-numbered paragraphs, §15.3/15.4/15.6.1a/15.8/15.9.3 line- or
  paragraph-numbered PROSE. `number` (a string, or `null`) is the ACTUAL right-margin number this
  unit carries in braille — populated for EVERY numbered unit in this gold corpus, not just the
  ones print itself happens to display (`printVisible` records which ones print itself shows;
  every other value was independently decoded from the given braille's own right-margin digits,
  standard braille-ASCII numeral letters `a`=1…`j`=0 — see `differences.md` §2 for the full,
  file-by-file decode). Consecutive `"numbered"` blocks belong to the SAME flowing print paragraph
  (built as one `para` block with several linenum-tagged segments, so Emboss's own `wrapNumbered`
  sees one continuous stream and can wrap a print line's text across braille rows exactly as the
  gold braille shows) UNLESS a block sets `newPara:true`, which starts a fresh paragraph — every
  block in Sample 15-1 (margin-numbered paragraphs, one number per whole paragraph) sets this;
  Sample 15-2's own two print paragraphs set it only on their own first line each.
- `{ kind:"verse", text, level, letter?, number?, features }` — a STANDALONE POEM line (§15.5.1,
  §15.7.2, §15.7.3, §15.9.3): `level` is a LEVEL (0, 1, 2…), independently re-measured for every
  line in every poem in this section from the given, already-verified braille (leading blank
  cells / 2), not taken from either transcription run's own say-so. `letter` (a rhyme-scheme
  letter, §15.7.2/15.7.3) and `number` (a periodic line count, §15.5/15.7.3/15.9.3) are BOTH kept
  in the schema since Sample 15-8 genuinely carries both on some lines — see `buildModel15` below
  for which one actually gets built.
- `{ kind:"dialogue", text, level, number?, features }` — a PLAY DIALOGUE line (§15.5.2, and the
  verse portion of §15.6's own interspersed prose+verse): a speaker's own turn (`"SPEAKER. text"` /
  `"SPEAKER: text"`, matching how the given braille actually shares a speaker's name with the
  opening words of their own first line — see `differences.md` §2 item 5 for Sample 15-7's own
  correction of this), or a continuation line of the SAME speech with no speaker repeated. `level`
  is measured the same way as `"verse"`'s own. Distinguished from `"verse"` because it goes
  through a DIFFERENT part of `document.mjs` with a DIFFERENT bug (see `buildModel15` below).

## How these files were made

1. Two independent transcription runs (`gold-15-A`, `gold-15-B`) already existed, both produced by
   the SAME model (Gemini Pro via Antigravity, 17 Sep 2026, per each run's own `summary.md`) — NOT
   independent evidence of each other, per this task's own brief (an earlier pair of runs shared
   six errors including invented print text). Both runs' own `summary.md` records that every
   `braille.lines` entry was already verified in-session, verbatim, against
   `references/_text/braille-formats-2016.txt` (lines 11773-12309) before this reconciliation
   began — agreement between the two runs on a braille line is therefore NOT independent
   confirmation of anything, only a record that both runs performed the same (correct) verbatim
   check.
2. Every field of every file was diffed programmatically between the two runs
   (`compare-gold-15/diffcheck.mjs`): 12 of 14 files' `braille.lines` are byte-identical; Samples
   15-5 and 15-7 disagree (see `differences.md` §1) and were resolved by re-reading the source
   directly, never by picking a side outright (Sample 15-5's own resolution is a SPLIT decision:
   A's own leading-blank-lines guess is wrong, but A's own number-placement guess is right, while
   B has it the other way around).
3. Separately, and regardless of A/B agreement, the print side of EVERY file was verified by
   forward-translating each candidate print reconstruction through Emboss's own translator
   (`Emboss/engine/louis.mjs`, `uebG2` table, exactly as `gold-run.mjs` does) and diffing
   character-for-character against the already-agreed braille — per this task's own brief, since
   both runs share one model and could share one error invisibly. This found: two files (Examples
   15-1/15-2) whose print side was entirely REBUILT from the braille (both runs left it empty);
   one shared error (Sample 15-8's spurious citation-title block, present in BOTH runs); one
   independently-found data-quality issue (§3 below, unrelated to any A-vs-B disagreement) in
   three files' own `braille.lines` width; and a handful of smaller field corrections (`number`
   completeness in six files, a rule-id correction in two files, a prose/verse split in one file).
   See `differences.md` for the complete, file-by-file evidence trail.
4. `illustrates.rule` was reset to `standards-map.md`'s own already-reconciled table for Samples
   15-7 and 15-10 (both runs' own independent guesses used a non-existent placeholder rule id,
   `"15.10"`, for both — apparently mistaking the SAMPLE's own number for a rule number), matching
   the §13/§16 gold precedents' own step 3.
5. A width anomaly independent of any A-vs-B disagreement (`differences.md` §3): three files'
   `braille.lines` (Sample 15-2, Sample 15-6, Example 15-2) right-justify a number/letter far past
   the file's own declared 40-cell `braille.width` (up to column 66/70/65) — a source
   text-extraction artifact, confirmed by re-deriving the correct gap with `wrapNumbered`'s own
   formula (`width − textLength − numWidth`) and finding it reduces every line to EXACTLY 40 cells
   with the actual text/number/letter content completely unchanged. Corrected in all three files.

## `buildModel15` — the line-numbered/line-lettered text model

`Emboss/format/document.mjs`, `Emboss/format/layout.mjs`, and `Emboss/input/parse.mjs` were read
(read-only) to learn the real line-number model `buildModel15` reproduces (search "linenum",
"LN_OPEN", "lineNumber", "wrapNumbered"): a print line number (A30) travels through the pipeline
as a `{type:'linenum', text}` segment — the SAME shape `parse.mjs` itself builds from a real
`<linenum>` element (`parse.mjs:1928-1933`) — which THREE different consuming code paths handle
THREE different ways, each with its own already-documented bug:

- **`"numbered"` → `formatSegmentedPara`/`wrapNumbered`** (§15.2/15.3/15.4/15.6.1a/15.8/15.9.3,
  ordinary prose or a margin-numbered paragraph): the segment is kept GENUINE and fed to
  `wrapNumbered` (`document.mjs:719-742`, `layout.mjs:154-231`), which is largely CORRECT — it
  right-justifies the number, flushes a line before a second number can land on it (15.4.1e), and
  never invents a number the source doesn't tag (15.5.1b/15.6.1b) — EXCEPT for §15.2's own
  paragraph-number case, where the SAME mechanism wrongly draws the number to the right margin
  instead of leaving it inline before the paragraph's own text (**F-205**), and for EVERY case's
  own automatic transcriber's note, which uses fixed generic wording with no blank line after it
  instead of the source's own specific wording (**F-234**, new).
- **`"verse"` → `parsePoem`'s own `numPrefix` fold** (§15.5.1/15.7.2/15.7.3/15.9.3, a standalone
  poem line): `parse.mjs`'s `parsePoem` NEVER emits a genuine `linenum` segment for a poem line at
  all — it reads the `<linenum>` text itself and prepends it as a literal `"N "` string directly
  onto the line's own text (`numPrefix = ... ; t = numPrefix + t`), so by the time the document
  model reaches `document.mjs`, the number is just ordinary text at the LEFT margin, not a
  right-margin marker (**F-182**). `buildModel15` reproduces this exactly, matching `buildModel13`'s
  own established `number`-folding convention for §13 poems: a `"verse"` block's own `letter`
  field (see below) is folded the same way. Where a poem line carries BOTH a `letter` and a
  `number` (Sample 15-8's own construct), only `letter` is folded in — `number` is deliberately
  never built, reproducing `parsePoem`'s own `findLinenum` returning only the FIRST `<linenum>`
  child of a line and silently losing the second (also **F-182**).
- **`"dialogue"` → `formatPlay`** (§15.5.2, and the verse portion of §15.6's own interspersed
  prose+verse — a SPEAKER's line, not a bare poem line): this is a DIFFERENT parse path from
  `"verse"`'s own (there is no `<poem>` here, just consecutive speaker/dialogue elements), so a
  genuine `linenum` segment survives all the way to `document.mjs`'s `formatPlay`
  (`document.mjs:890-899`) — which then calls `segmentsToBraille` WITHOUT `lineNumbers:true` on
  EITHER its prose or verse branch, silently discarding the segment entirely (not merely
  misplacing it, **F-181** — `standards-map.md`'s own row for BANA 15.5.2a already names this
  exact mechanism for Sample 15-6). `formatPlay` also never adds the blank line BANA
  §13.3.1a/§14's own convention wants around a poem/play passage — the SAME already-documented,
  reused finding **F-121** (written for §13's own poems, but the code, `formatPlay` itself, is
  identical).

Every §15 finding this reconciliation's `--update-status` run traces a mismatch to is either
already documented (**F-181**, **F-182**, **F-205**, **F-207**, **F-208**, reused from the
section's own earlier assessment) or newly recorded here (**F-234**); nothing was left
unattributed. See `differences.md` for the complete, file-by-file breakdown of which finding
explains which file, and `Emboss/tests/gold_bana_section15.test.mjs` for the regression guard.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-15 --update-status`: **0 match**,
**8 mismatch**, **4 not-representable** (a print-only 'other' block left out of the model: Samples
15-5, 15-7, 15-9, 15-10), **2 no-braille** (the two embedded, unnumbered "Sample:" wordings under
15.4.1d/15.8.1b). Every mismatch/not-representable file's cause is one or more of: **F-205**
(Sample 15-1's own paragraph number lands at the right margin instead of inline); **F-234** (the
automatic line-number note's fixed wording/missing blank line — Samples 15-2, 15-3, 15-4, 15-7's
prose portion, 15-9); **F-181** (Sample 15-6's dialogue numbers dropped entirely; Sample 15-7's
verse portion likewise) plus the reused **F-121** (no blank line around the dialogue passage,
Sample 15-6); **F-182** (Example 15-2 and Sample 15-5's rhyme letter folded left instead of
right-justified; Sample 15-8's rhyme letter folded left AND its periodic line number lost
entirely); **F-208** (Sample 15-9's counted-words 3-cell gap requirement, `wrapNumbered` only ever
gives 2). Example 15-1 is the section's closest thing to a match — its ENTIRE reconstructed
sentence, both margin choices, and all five italic emphasis markers reproduce byte-for-byte; its
one remaining difference is an unresolved braille-contraction micro-detail on a single four-letter
word (see `differences.md` §4), not a §15 line-numbering defect at all. See `differences.md` for
the complete, file-by-file breakdown, and `Emboss/tests/gold_bana_section15.test.mjs` for the
regression guard.
