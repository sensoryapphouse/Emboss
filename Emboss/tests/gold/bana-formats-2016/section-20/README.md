# Gold examples — BANA Formats 2016, §20 (Pronunciation)

## What these files are

36 JSON files, one per worked example in the section's running text:

- **31** inline Examples: `example-20-1.json` ... `example-20-31.json`.
- **3** print-only Samples (`sample-20-01.json`, `-02`, `-03`): full-page photographs of dictionary/glossary pages, no braille.
- **1** braille Sample (`sample-20-04.json`, "Pronunciation Key without Heading"): two braille pages.
- **1** unnumbered inline example under rule 20.7.3c (`sample-20-7-3c.json`): a print-style title-page line, no braille.

Each file has the section-2 shape: `id, title, pdfPages, textLines, illustrates {rule, quote}, print {blocks, notes, surroundingText, printFeatures}, braille {width, lines, pageBreaks, notes}, uncertain, sources ["A","B"], resolution`. `pdfPages` is the printed page number 20-N (N), which is also the position in `references/_gemini/gold-20-A/page-NNN.png` (file number 538 + N).

## How they were made

Two independent Gemini runs (`references/_gemini/gold-20-A/out`, `gold-20-B/out`) were compared field by field with `references/_gemini/gold-20-A/source-lines-15511-16057.txt` (the section's text) and the page images. Every braille line was re-derived from the source by script (margin, or the 5-column line-number field for Sample 20-4, stripped by counting; U+2800 cells converted to spaces; trailing spaces removed; page footers and the "New Braille Page" marker excluded).

1. **braille.lines.** In all 31 inline Examples A and B agree on every character. They differ only in that B also lists the 4 blank source lines after each caption as braille lines (217 lines in B against 90 in A). Those lines are the print-original picture area: the page image (for example `page-540.png`) shows the print text in the box above the braille, and the text extraction turned that area into blank lines. They are not braille, so they are **excluded** (A's convention). This differs from the section-2 files, which keep such leading blanks; if the corpus wants them back, each file's `braille.notes` records the gap. Genuine blank braille lines inside the braille are kept (Example 20-28, line 2: a full row of U+2800 cells).
2. **Sample 20-4** had real faults in both runs: A left a form-feed on line 1, listed the "New Braille Page" marker as a braille line and gave `pageBreaks: []`; B kept the picture-area blanks and left a stray space on line 1. Re-derived: 30 lines, `pageBreaks: [23]` (line 1 of braille page 2). Line 1 is 43 characters in the source but about 40 cells in the image; kept verbatim and flagged in `uncertain`.
3. **illustrates.** A recorded rule `20.x` and the file caption as the quote in every file. B's rule ids were usable but its quotes were sometimes a page footer or a contents line (e.g. Examples 20-6 and 20-7, Samples 20-1 to 20-4). All rules and quotes were re-derived from the source and script-checked as verbatim. Where an example follows a lettered list without naming an item, the numbered rule's lead sentence (or the whole 20.4 a-d list for Examples 20-6/20-7) is cited; each such choice is named in the file's `uncertain`.
4. **print.** B left `print.blocks` empty in every file. A's blocks were checked against the page images; the text was corrected where the image differs (stress primes, missing final prime in 20-9, diacritics in 20-14, 20-18, 20-26, ligatures in 20-13, the bold/italic extents) and each `resolution` says what changed. Diacritics are approximated with combining Unicode characters and the braille modifiers remain the authority; `uncertain` lists the doubtful ones (20-13, 20-14, 20-17, 20-18, 20-19, 20-27, Sample 20-4). Samples 20-1 to 20-3 are photographs of whole dictionary pages: `blocks: []` with a note pointing to the page image (A's summaries were dropped).
5. **pdfPages.** A left it empty; B's values were checked against the source's page footers and match.

## Counts

Braille lines: 4 files identical in A and B (the three print-only samples and 7-3c, all empty); 31 differ in formatting only (the picture-area blank lines); 1 genuine disagreement (Sample 20-4). Every file needed the `illustrates` and `print` work above.

No `status.json` and no `buildModel20` yet; these files record reconciled evidence only.

## How to run (added 23 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-20` (`buildModel20` in `Emboss/scripts/gold-run.mjs`; never `--update-status` until the results are reviewed). The model comes only from `print.blocks` plus the emphasis named in `print.printFeatures`; a dictionary entry (20-21..20-26) is a glossary item, a snippet is an isolated flush paragraph (each print line its own paragraph, since a paragraph has no forced line break). Pronunciation keys (tables) and ligature/stroke/tertiary-stress content the print text cannot carry are `not-representable`. Guard test: `Emboss/tests/gold_bana_section20.test.mjs` (baseline mode until a status.json exists). Diagnosis: `Emboss/docs/wip/gold-diagnosis-section-20-22.md`.
