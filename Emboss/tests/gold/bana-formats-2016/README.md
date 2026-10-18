# BANA Braille Formats 2016 gold examples: how to read the match counts

Runner: `node Emboss/scripts/gold-run.mjs --section section-N` (status files: `section-N/status.json`).

## Independence rule

A gold example's input model is built from its PRINT description only (`print.*`). The expected braille (`braille.lines`)
is the result to compare with and must never influence the input. So:

- A builder must not read `braille` to decide anything about the model (column count, title position, italic
  boundaries, blocked or indented paragraphs, wording of a note, spacing).
- Text that the transcriber wrote (a transcriber's note, an identifying-number scheme, a picture description, a
  devised symbol) is braille content, not print. If the example needs it and the print does not carry it, the example
  is not a match: it is `not-representable` (with a specific reason in the diagnosis) or stays `mismatch`.
- If the book shows no print original (a braille-only template) or the print side was rebuilt from the braille, nothing
  is built and the example cannot match.
- If the print page image shows what the input needs, the print description is corrected against the image
  (print only, never braille) and each change is recorded in the file's `printCorrections` with its evidence and the
  resolution sentence "Print description corrected 23 Sep 2026 (see printCorrections)."
- Print-derived rules used by the runner: side-by-side list columns come from `print.blocks[].columns`; a table
  heading is "before the box" when `print.printFeatures` says the title/heading is above or outside the box (and not
  "INSIDE the box"); an activity's opening paragraph is directions when its print text is an instruction.

An honest lower count is the goal, not a high one.

## Evidence strength

A match whose expected braille is a single line (or two or three short lines) carries little evidence: many different
inputs and formatters would produce it. Read such matches as "not contradicted", not as "verified".

## How the runner relaxes the comparison

- Expected lines are upper-cased (the gold transcription sometimes picked the wrong ASCII case; non-letters are unaffected).
- Leading and trailing blank lines are stripped on both sides.
- A first expected line that is just the placeholder `text` (the book's stand-in for surrounding running text) is
  stripped.
- Page-break positions are not compared: only the sequence of lines is.
- A status of `match` means every remaining line is identical; any recorded input limitation does not by itself
  downgrade an identical result, which is why the no-print-original and transcriber-content cases above build nothing.

## Format selected by the illustrated rule

Some builders in `Emboss/scripts/gold-run.mjs` pick a format from `illustrates.rule`: which table format, whether a spelling
list is written uncontracted (17.9.2, 17.10.3, 17.11.2, 17.13.x), a dictionary or thesaurus entry mode, segmented numbers
(11.6.5). The transcriber chooses such a format and the rule names it, so it is a legitimate input. It does not show that
Emboss finds the format from the print alone.

## Print-side fields the builders read (added 23 Sep 2026)

- `print.transcriberNote` / `print.transcriberSupplied`: transcriber-written text or repeats that the braille has and the print
  does not (Examples 3-1..3-3, 10-22, 17-9, 17-13, Samples 17-6, 17-11). They are never built; a builder that finds one and no
  matching print block records a limitation, so the example cannot match.
- Section 20 blocks: `emphasis`, `lineEmphasis`, `lineBreaks`, `entry`, `runningText`. Section 9 lists: `displayed`.
  Section 3 notes: `embedded`, `headingOfList`. All are print observations recorded from the page image.
- The seven-word test for embedded notes (3.2.3) is no longer applied to a note's text; the print block must say `embedded`.

## Known weak matches

These examples currently match, but the input leans on something the print page does not show. Read them as "not contradicted".

- Heading level or format read off the braille or chosen by the rule id: Sample 8-14, Sample 8-15 (heading level 2 taken from
  the braille margin), Example 19-2, Sample 9-02 (displayed verse; the italic omission of 9.2.3b), Sample 11-25, Samples 21-9
  and 21-10, Example 21-35 (entry format chosen by the rule).
- Uncontracting keyed by the illustrated rule: Example 17-11, Sample 17-13 (word-formation text in uncontracted braille, 17.13.1a).
- Example 16-6 (the headword for the embedded note is a guess; only two lines are compared).
- Example 20-11 (only one line compared).
- Example 18-9 (`diagram:true` comes from rule 18.7.1, not from the print; currently a mismatch anyway).
- Sample 12-7 (`boxLines:false` is keyed to the illustrated rule 12.3.1g, not shown by the print; currently a mismatch anyway).
- Sample 14-10 and Example 1-18 used to match only because the runner set `typeformWordPunct` (UEB 9.3.x: no terminator after an
  italic word followed by punctuation), which came from the braille. It is no longer set (23 Sep 2026, round 3); both are mismatches.
- Example 18-5: the embedded note "apostrophe is red" is transcriber-written (the print page shows no note); recorded as a
  limitation, `not-representable`.
- Example 17-10 is an isolated fragment; it no longer matches because its flush margin was a braille observation.
- Example 17-9 (crossed-out words) keeps `continuation` flags on its four print lines: the 1-3 list layout is the format the
  rule selects, not something the print shows.
