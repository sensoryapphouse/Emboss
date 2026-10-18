# Gold examples — BANA Formats 2016, §22 (Bibliographies)

4 JSON files, `example-22-1.json` ... `example-22-4.json`, in the section-2 shape (`id, title, pdfPages, textLines, illustrates, print, braille, uncertain, sources ["A","B"], resolution`). `pdfPages` is the printed page 22-N (page images `references/_gemini/gold-22-A/page-597.png` ... `-599.png`).

## How they were made

Two Gemini runs (`references/_gemini/gold-22-A/out`, `gold-22-B/out`) compared field by field with `references/_gemini/gold-22-A/source-lines-17223-17322.txt` and the page images. Braille lines were re-derived from the source by script (14-column margin for Example 22-1, 9 for the others; U+2800 cells to spaces) and every line checked as verbatim.

- **braille.lines.** A and B agree in 22-2, 22-3, 22-4. In 22-1 A dropped a backslash on line 6 (`,p"p1` for `,p\"p1`, the "ou" contraction in "Poupart"); B and the source have it. Neither run listed the print-picture blank lines; those (4 source lines after each caption) are excluded here, as in section 20.
- **illustrates.** Both runs' rules and quotes agree with the source and were script-verified. B cited 22.3.1 + 22.3.2 for Example 22-4; only 22.3.2, which the example directly follows, is cited (as in A).
- **print.** A and B agree in text. Italic extents were checked against the braille passage indicators and the page images: the italic run includes the full stop in 22-3 and in the first entry of 22-4 (the terminator follows the period); "(1945)." is roman. Long dashes are written as two em dashes; the three hyphens in 22-3 are bold.
- **pdfPages.** A gave PNG numbers (597 to 599); B the section page; B's is used.

## Counts

Braille lines identical in A and B: 3 files; genuine disagreement: 1 (22-1); formatting-only differences: 0. No `status.json` yet.

## How to run (added 23 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-22` (`buildModel22`; never `--update-status` until reviewed). One bibliography = one plain list; a citation is a level-0 item, an annotation a level-1 item (the only way Emboss expresses the 1-5/3-5 margins, F-184). Guard test: `Emboss/tests/gold_bana_section22.test.mjs` (baseline mode). Diagnosis: `Emboss/docs/wip/gold-diagnosis-section-20-22.md`.
