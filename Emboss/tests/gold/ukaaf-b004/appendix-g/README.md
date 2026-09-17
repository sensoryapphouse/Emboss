# Gold examples — UKAAF B004 Appendix G (Quoted material)

## What these files are

2 JSON files, `b004-g-1.json` and `b004-g-2.json`, one per "Example" named under B004
Appendix G's own "Good practice examples of quoted material" heading
(`references/_text/B004.txt` lines 715–731, `references/ukaaf/presentation-guidelines-B004.pdf`
page 24 — this document's own PDF page number equals its printed page number, no offset,
confirmed against the adjacent Appendix F/H pages' own footer numbers).

**Both files are marked no-braille, not dropped.** Unlike every BANA §9 worked example, and
unlike B004's own neighbouring Appendix F ("Forms") and Appendix H ("Tables of contents") —
both of which show an actual "Print:" excerpt followed by a "Braille:" transcription —
Appendix G's two "Examples" are each a single sentence of generic prose guidance describing an
acceptable transcription *technique* (typeform indicators or literal quotation marks for
Example 1; a 4-cell quote indent with cell-7 paragraphs and cell-5 runovers for Example 2).
There is no specific quoted passage shown in print anywhere on the page, and therefore nothing
rendered into braille to transcribe. This was independently confirmed by both transcription
runs two ways: (a) the `.txt` extraction has no braille-cell content (no BRF-ASCII lines) near
lines 715–731, and (b) the PDF page image was read directly and shows only the heading, the
"Guiding principles" sentence, and the two "Example" prose sentences — no figure, box, or
braille block of any kind.

Both files therefore have `braille.width: null`, `braille.lines: []`, and a `print.blocks`
array containing the example's own prose as a single `kind:"other"` block (never modelled —
there is no print excerpt for `buildModel9`/a B004-Appendix-G builder to build from, and
nothing in `braille.lines` to compare against). Both are recorded as `status: "no-braille"` by
`gold-run.mjs`, exactly like BANA `example-9-1`/`example-9-2` in the neighbouring section-9
folder.

## Same top-level shape as the section-9 precedent

```
{
  "id", "title", "pdfPages", "pdfFile", "textLines", "illustrates",
  "print": { "blocks": [{ "kind":"other", "level", "text", "features" }], "notes",
             "surroundingText", "printFeatures" },
  "braille": { "width": null, "lines": [], "pageBreaks": [], "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`pdfFile` is included (unlike the BANA section-9 files, which all point to the same
`braille-formats-2016.pdf`) since these two files' source PDF differs from the rest of this
gold corpus.

## How these files were made

Two independent transcription runs ("A" and "B") agreed completely on the substantive facts
above — there was no disagreement about the print content, the absence of braille, or the
absence of an offset in this PDF's own page numbering. The only disagreement was
`illustrates.rule`/`quote`: run A quoted each Example's own specific text under a distinct id
("B004 Appendix G, Example 1" / "Example 2"); run B quoted the section's shared "Guiding
principle" sentence identically for BOTH files, which is less specific and would make the two
gold files indistinguishable by `illustrates` alone. Resolved to run A's convention, matching
this project's established one-rule/example-per-file convention (see the section-9 and
section-4/8 READMEs' own "illustrates" sections).

## Gold-run.mjs

`gold-run.mjs --section section-9` also picks up these two files by treating
`ukaaf-b004/appendix-g` as its own tiny gold sub-set (see the runner's own `SECTION_DIRS`
comment) — both are expected to report `status: "no-braille"` and require no model-building
logic beyond what `example-9-1`/`example-9-2` already exercise.
