# Gold examples — BANA Braille Formats 2016, §2 (Transcriber-Generated Pages and Front Matter)

## What these files are

48 JSON files, one per worked example/sample named in the section's own table of
contents (§2.13's own "Samples" list) and running rule text:

- **18** inline **Examples**: `example-2-1.json` … `example-2-18.json`.
- **20** numbered **Samples**: `sample-2-01.json` … `sample-2-20.json` (zero-padded,
  matching the §3/§13 gold precedent's convention).
- **6** named components of **Sample 2-21** ("Transcriber-Generated and Front
  Matter Pages"), one file per page named in the source's own six-page structure
  (source lines 2795–2928): `sample-2-21-title-page-volume-1.json`,
  `sample-2-21-special-symbols.json`, `sample-2-21-transcribers-notes.json`,
  `sample-2-21-table-of-contents-volume-1.json`,
  `sample-2-21-table-of-contents-volume-2.json`,
  `sample-2-21-pronunciation-key-in-front-matter-pages.json` — both independent
  transcription runs already split Sample 2-21 this same six-way (matching the
  source's own sequence of sub-headings), so no re-splitting was needed.
- **4** embedded, unnumbered `Sample:`/`Samples:` wordings quoted inline within
  running rule text (suggested transcriber's-note phrasings, not full worked
  examples, matching the §3 gold precedent's own convention for this exact
  situation): `sample-2-3-7a.json` (rule 2.3.7a's transcriber/transcription-segment
  year-and-name wording), `sample-2-6-1c.json` (rule 2.6.1c's other-codes
  notification wording), `sample-2-6-1d.json` (rule 2.6.1d's four altered-print-
  format notices), `sample-2-8-1a.json` (rule 2.8.1a's cover/jacket transcriber's
  note wording) — none of these four has a real braille rendering anywhere near its
  own citing location (`braille.lines: []`).

Each file has the same top-level shape as the §3/§4 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates": { "rule", "quote" },
  "print": { "blocks": [...], "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A","B"],
  "resolution": "..."
}
```

`print.blocks` is `[]` for every one of this section's 48 files — this section's
own subject (transcriber-generated title/contents/special-symbols/transcriber's-
notes pages) has no print original of running text to model into
heading/paragraph/list blocks:

- The 18 inline **Examples** are bare braille fragments: the book's own page shows
  only the cited rule text and a boxed braille excerpt, nothing else to transcribe
  (confirmed directly against the page images, `references/_gemini/gold-2-A/
  page-045.png` … `page-064.png`).
- The 20 numbered **Samples** (and 3 of Sample 2-21's 6 components — Title Page
  Volume 1, Table of Contents Volume 1, Table of Contents Volume 2) each illustrate
  their rule with a **photograph** of a real book's cover, title page, copyright
  page, or contents page (`references/_gemini/gold-2-A/page-068.png` …
  `page-098.png`) — a picture, not print running text, so there is nothing for
  this section's flat `{kind, level, text, features}` block schema to hold
  faithfully; building one would mean inventing structure the source itself
  doesn't give as text. `print.notes` records which page image to consult instead.
- Sample 2-21's other 3 components (Special Symbols, Transcriber's Notes,
  Pronunciation Key) are themselves transcriber-generated pages, braille-only like
  the inline Examples.
- The 4 anonymous `Sample:`/`Samples:` wordings use the §3 precedent's own
  `print.transcriberNote` convention: a plain-English copy of the suggested
  wording, with `print.blocks: []` (there is no other print content at all — the
  wording itself is the entire citing passage).

No `buildModel2` exists yet in `Emboss/scripts/gold-run.mjs` (see "Status" below),
so this section's own worked-out document-model schema for future formatter
comparison is intentionally left for later; these files record the reconciled
**evidence** (verbatim rule quotes and verbatim braille), not a model of how
Emboss should build it.

## How these files were made

1. Two independent transcription runs ("gold-2-A", "gold-2-B") already existed,
   both produced by the same process (Gemini Pro via Antigravity, per each run's
   own `references/_gemini/gold-2-A/out/summary.md` /
   `references/_gemini/gold-2-B/out/summary.md`), each reading
   `references/_gemini/gold-2-A/source-lines-1390-2934.txt` (one numbered source
   line per line — both runs used the same source-line file, so this one copy is
   authoritative for both) and the PDF page images
   (`references/_gemini/gold-2-A/pages-2-1-to-2-54.pdf` and the individual
   `page-045.png` … `page-098.png`; printed page 2-N = PNG `page-0(44+N).png`,
   confirmed against every file's own `pdfPages`).
2. Every file's `braille.lines` was compared between the two runs. **On raw
   content** (ignoring blank-line placement) **the two runs agree in all 48
   files** — there was no run-vs-run wording/character disagreement in this
   section's braille anywhere. The runs differ systematically in how they handle
   the source's own blank braille lines: run A keeps every literal blank line
   (leading, internal, and trailing) exactly as the source shows it; run B
   silently strips leading (and sometimes internal/trailing) blank lines. This
   reconciliation re-derived every file's `braille.lines` directly from
   `source-lines-1390-2934.txt` (its own line-numbered content, the "(Return to
   Text)" navigational marker and page running-head/footer furniture excluded,
   the book's own line-number field and left margin stripped by counting, U+2800
   blank braille cells converted to plain spaces) and confirmed **A's
   blank-line-inclusive convention is the one that matches the source
   byte-for-byte** — 33 of the 48 files were independently re-derived from source
   and matched run A's `braille.lines` exactly. This also matches how blank
   braille lines are already handled elsewhere in this gold corpus (e.g.
   `tests/gold/bana-formats-2016/section-5`'s own U+2800-filler-line convention).
   `sources` is `["A","B"]` throughout; each file's own `resolution` field
   records whether the two runs agreed outright or needed this blank-line
   reconciliation.
3. Three genuine content-level errors were found and corrected against the source
   (not just a blank-line convention difference):
   - **`example-2-13`** — both runs identically mis-included the print caption's
     own wrapped second line ("continuation indicator)", the tail of "Example
     2-13: Print Pages with Continuation Letter (the c is a continuation
     indicator)", source line 1810) as if it were a first braille line. Removed —
     it is plain print caption text, not valid BRF ASCII, and carries no
     line-number field in the source.
   - **`sample-2-6-1d`** — run A fabricated a two-line `braille.lines` fragment by
     mis-reading wrapped PRINT prose (source lines 1919–1924, rule 2.6.1d's own
     anonymous "Samples:" wordings) as braille; run B correctly recorded none.
     Corrected to `braille.lines: []`.
   - **`sample-2-12`** — run A dropped the source's own genuine trailing blank
     braille line (numbered "22" in the source, all U+2800 blank cells, source
     line 2561) between the last content line and the page's "(Return to Text)"
     marker; run B kept it. The reconciled file keeps A's version with that one
     line restored.
4. `illustrates.quote`: run B's own `quote` field is not a quote of the cited
   rule anywhere in this section — every one of its 48 files instead echoes that
   file's own title/caption text. Run A's `quote` field IS the real rule text in
   every file, but is wrong in two systematic ways, both corrected here by
   re-deriving the exact cited span from `source-lines-1390-2934.txt`:
   - **Over-scoped**: several files cite one specific numbered sub-item of a
     lettered rule (e.g. `example-2-11` cites `2.3.8d(1)`) but run A quoted the
     ENTIRE lettered rule, every numbered sub-item included — corrected to just
     the cited sub-item's own text (`example-2-5`, `example-2-6`, `example-2-11`,
     `example-2-12`, `example-2-13`, `example-2-14`).
   - **Missing or truncated**: files whose citation is a bare
     `"(See Sample N: ...)"` cross-reference (not a lettered/numbered rule) had no
     real quote at all (run A recorded the literal placeholder string
     "cross-reference") or were cut off mid-sentence — corrected to the rule's own
     complete cross-reference sentence, or (for `2.10.1e`/`2.10.11`, which have no
     separate cross-reference sentence) the complete cited rule text
     (`sample-2-09`, `sample-2-10`, `sample-2-11`, `sample-2-12`, `sample-2-13`,
     `sample-2-14`, `sample-2-17`, `sample-2-18`, `sample-2-20`).
   - A further five files (`sample-2-05`, `sample-2-06`, `sample-2-07`,
     `sample-2-08`, `sample-2-6-1c`) were correctly scoped but had a stray
     mid-sentence page running-head/footer line (from the source's own PDF page
     break) spliced into the middle or end of the quote text by the extraction;
     removed.
   - Every remaining file's `quote` (35 of 48) was verified verbatim against the
     source as-is, unchanged from run A.
   - Every one of this section's 48 `illustrates.quote` values (and the 4
     anonymous samples' `print.transcriberNote`) was re-verified, file by file,
     to appear verbatim in `source-lines-1390-2934.txt` as a final check on this
     reconciliation's own output (see `notes.md` in the reconciliation's own
     scratch folder for the full verification log).
5. `title` uses run B's clean `"Example 2-N: ..."`/`"Sample 2-N: ..."` caption text
   (verified verbatim against the source's own caption lines) rather than run A's
   more verbose `"BANA Example 2-N (Example 2-N: ...)"` form, with one correction:
   `sample-2-21-title-page-volume-1`'s title was run B's own umbrella caption for
   the WHOLE Sample 2-21 ("Sample 2-21: Transcriber-Generated and Front Matter
   Pages"); every one of this sample's other 5 sibling files correctly uses its
   own component sub-heading instead, so this file is corrected to match
   ("Title Page Volume 1", source line 2802).
6. `pdfPages` (all from run A; run B left this field empty throughout) was
   independently re-derived from the source's own page running-head/footer lines
   for every file and matches run A exactly in all 48 cases.

## Status

`buildModel2` is registered in `Emboss/scripts/gold-run.mjs` (`'section-2'`). Run:

    node Emboss/scripts/gold-run.mjs --section section-2
    node --test Emboss/tests/gold_bana_section2.test.mjs

Because every file here has `print.blocks: []`, `buildModel2` builds an empty
document and records, per page type, the specific Emboss feature that is missing
(title page, second title page, Special Symbols page, Transcriber's Notes page,
`t`/`p` page numbering, contents layouts; stages 1-8 of
`Emboss/docs/transcriber-pages-plan.md`). It never derives a model from the braille.
Result: 44 `not-representable`, 4 `no-braille` (the anonymous `Sample:` wordings),
0 `match`. As formatter features land and print models are added, entries change
status; no `status.json` is checked in yet (the guard test uses this baseline until
one is recorded with `--update-status`).

## How the page numbering is exercised (Stage 1, 23 Sep)

The `t`/`p` numbers these files show (`t#a` on Sample 2-21's Title Page / Special Symbols /
Transcriber's Notes, `p#a` on its contents) are produced by `seriesPageNumber` (`format/page.mjs`)
and checked by `Emboss/tests/transcriber_pages_numbering.test.mjs`, not by `gold-run` (which still
has no `buildModel2` for this section). The volume title page (F-57) now ends `T#A` on line 25.

## How the Transcriber's Notes page is exercised (Stages 2 and 3, 23 Sep)

`buildModel2` builds Sample 2-21's "Transcriber's Notes" component as a `tnpage` block (BANA 2.6.1;
`format/document.mjs` `formatTnPage`) from `print.tnEntries` (one print-wording string per 3-1
paragraph) when a gold file supplies it. No file does yet: `print.blocks` is `[]` for all 48, and the
component's wording is stated in print form only for "The atlas is omitted." (rule 2.6.1d); its other two
entries exist only as braille, and input is never derived from the expected braille. So it stays
`not-representable`, with that reason printed. Layout is instead checked in
`Emboss/tests/transcriber_pages_tn.test.mjs` against the gold's own heading line and its
"The atlas is omitted." line, which the renderer reproduces exactly. Known differences from the gold page
even once the wording is supplied: the gold shows a final `444` line and the number `t3` (it is the third
transcriber page of Sample 2-21; a lone page here is `t1`).

