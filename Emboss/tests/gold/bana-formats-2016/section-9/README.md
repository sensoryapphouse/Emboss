# Gold examples — BANA Braille Formats 2016, §9 (Displayed Material, Attributions, and
# Source Information)

## What these files are

19 JSON files, one per worked example/sample named in the section's own table of contents
(§9.8) and running rule text: the 8 inline **Examples** (`example-9-1.json` …
`example-9-8.json`) and the 11 numbered **Samples** (`sample-9-01.json` … `sample-9-11.json`).
Two related UKAAF B004 Appendix G items live alongside this section in
`Emboss/tests/gold/ukaaf-b004/appendix-g/` (see that folder's own note below) — 21 files in
total for this reconciliation.

Two of the eight Examples are captioned "(Print Only)" in the source and carry no braille at
all (`example-9-1`, `example-9-2`; `braille.width: null`, `braille.lines: []`), matching the
convention used for BANA §4's own Print-Only example. Every other file carries real braille
(`braille.width: 40`).

Each file has the same top-level shape as the §4/§7/§8 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [{ "kind", "level", "text", "features", ... }, ...],
             "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — `level` is `1`/`2`/`3` (centred/cell-5/cell-7),
  re-derived directly from this section's own agreed `braille.lines` for every file that has
  one (the leading-blank-cell-count method used by the §4/§7/§8 precedents), never taken on
  either transcription run's own say-so.
- `{ kind:"paragraph", text, features }` — ordinary running prose.
- `{ kind:"quote", text or items, features }` — BANA §9.2's displayed material: built by
  `buildModel9` into a document `{type:'para', style:'quote', text}` block (or, where print
  shows several separate displayed sentences/verse lines treated as a list per 9.2.2e, a
  `{kind:"list", items:[...]}` block instead — see "Displayed sentences and verse as lists"
  below).
- `{ kind:"epigraph", text, features }` — BANA §9.3: built into `{type:'para',
  style:'epigraph', text}`.
- `{ kind:"attribution", text, features }` — BANA §9.4: built into `{type:'attribution',
  text}`.
- `{ kind:"source", text, features }` — BANA §9.5's source citations and permission-to-copy
  notices: Emboss has no dedicated Source Citation style (displayed-writeup.md F-101), so
  `buildModel9` reuses the same `{type:'attribution', text}` block `kind:"attribution"` maps
  to, exactly as F-101 describes.
- `{ kind:"list", items:[...], features }` — a plain list of items (BANA §9.2.4/9.2.5's word
  lists, or 9.2.2e's "displayed sentences treated as a list"). Each item is a **plain string**
  in this section's own schema (unlike §8's richer `{marker, level, text, bullet}` item shape
  — this section's worked lists never use markers or nesting), built via a thin reuse of
  `buildModel8`'s own `buildListItem` helper with `level:1` (0-based level 0) throughout.
- `{ kind:"box", blocks:[...], features }` — BANA §7's own ruled box, reused for Sample 9-11's
  bordered instructional letter exactly as the §8 precedent's `sample-8-04` reuses it.
- `{ kind:"other", text, features }` — never modelled; recorded as a limitation, exactly as
  the §4/§7/§8 precedents: print content with no print-side counterpart to this schema's block
  kinds (a transcriber's-note bracket, a non-text icon, page furniture), or content this
  reconciliation could not build faithfully in any other kind without misrepresenting it (see
  "Compact multi-caption stacks" below).

- `sources` is always `["A", "B"]`: two independent Sonnet transcriptions of the section (plus
  B004 Appendix G) were compared for every field of every item.
- `resolution` is a short prose note citing the evidence for how any disagreement was settled
  — almost always a direct byte-count or PDF-page-image read against the primary source, never
  a pick between the two runs' own say-so.

## How these files were made

1. Two independent transcription runs ("A" and "B") already existed in scratch, each having
   read `references/_text/braille-formats-2016.txt` (lines 6525–7190), the PDF page images
   (`references/bana/braille-formats-2016.pdf`, pages 227–249, `PDF page = printed page +
   226`), `references/_text/B004.txt` (lines 715–731), and the PDF page image
   (`references/ukaaf/presentation-guidelines-B004.pdf`, page 24 — no offset for that
   document).
2. `braille.lines` agreed byte-for-byte between the two runs on **every one of the 19 BANA
   files** except three genuine extraction slips, all resolved directly against the primary
   `.txt` (never by picking a run):
   - **`example-9-4`** and **`example-9-7`**: B omitted a genuine leading blank braille-cell
     line (the block's own left-margin padding plus 40 literal U+2800 characters, e.g. source
     `.txt` line 6627) that A kept. Confirmed by direct byte inspection: these lines are NOT
     the truly-empty `.txt` filler lines that surround them (those really are excluded, per
     the section-8 precedent's own convention) — they carry the block's own left-margin ASCII
     padding plus a full line of blank braille cells, i.e. real transcribed content. A's
     version (with the leading blank) is used.
   - **`sample-9-11`**: A's own line 10 (the letter box's top border) carries a spurious
     leading ASCII space (41 characters after stripping the gutter) that B's does not (40
     characters, matching this file's own uniform width). Root cause found directly in the
     source: `.txt` line 7159 begins with a literal form-feed character (`\x0c`) immediately
     before the line-number field, marking the page boundary for the PDF-to-text extractor —
     not a gutter or content character. A's extraction evidently counted the form-feed as an
     extra leading position; B's (which strips it) is correct and is used.
3. `sample-9-08`'s braille line 1 (heading + hymn number) measures **41 characters**, one more
   than the uniform 40-cell width used everywhere else in this section (confirmed against this
   same file's own two blank filler lines, both exactly 40). Settled from the primary source,
   per the task's own instruction: a byte-precise read of the raw `.txt` confirms the
   post-gutter content is exactly 41 characters (10 blank cells + 19-character title braille +
   8 blank cells + 4-character right-flushed hymn number `#fij`), and the PDF page image
   (p.245) shows nothing anomalous about this specific line's own dot pattern — both source
   formats agree the line is genuinely 41 cells wide. Recorded verbatim (per B's own flagged
   measurement), **not** silently corrected to 40, matching the task's explicit instruction
   not to "correct" this known anomaly.
4. Every heading's level (1/2/3) was re-derived directly from this section's own agreed
   `braille.lines`, never taken from either run's own "level" field, exactly as the §4/§7/§8
   precedents established: a fixed 4 leading blank cells (regardless of centering match) is
   cell-5 (level 2); a fixed 6 is cell-7 (level 3); a leading-blank count that matches the
   centring formula `(40−len)//2` for the text's own length is centred (level 1). This
   corrected several `level: null` placeholders left by one or both runs (`example-9-4`'s
   heading, `example-9-6`'s two-line heading, `example-9-7`'s two headings, `example-9-8`'s
   heading, `sample-9-10`'s two dateline headings).
5. `illustrates.rule` follows the §4/§8 precedent's dotted-letter convention throughout (e.g.
   `9.2.2.e`, not either run's occasional undotted `9.2.2e`) and, where the two runs disagreed
   on WHICH specific sub-rule an example illustrates, was resolved from the agreed braille's
   own evidence rather than either run's guess — most notably **`example-9-3`**, which both
   runs mis-cited (A: 9.2.2e "multiple...as a list", which doesn't fit a single sentence; B:
   the whole of 9.2.2). The agreed braille shows the displayed sentence's own first line and
   runover at the *identical* cell-3 indent — the defining feature of clause **9.2.2d**'s
   "blocked" variant (as opposed to "indented") — so the file is tagged 9.2.2.d, settled
   directly from the measured margins, not from either run's stated id.
6. Two structural (not braille) disagreements were resolved by reading the PDF page image
   directly, per the task's "never pick a run" instruction:
   - **`example-9-6`**: print genuinely shows the source citation at the FOOT of the box,
     below the whole letter excerpt (confirmed against braille-formats-2016.pdf p.233) — but
     this worked example's own short braille excerpt shows the citation ALREADY RELOCATED to
     sit directly under the heading (illustrating 9.5.2), with the letter's own elision device
     and closing line dropped entirely. `print.blocks` are recorded in the order actually
     needed to build this specific excerpt (heading, source, paragraph), not print's raw
     top-to-bottom box layout, matching the excerpt's own evident editorial intent.
   - **`sample-9-01`**: print genuinely shows the quotation interrupting the sentence between
     "agreed that" and "defeating Hitler" (confirmed against p.238); the braille shows the
     RELOCATED order (whole sentence, then quote+attribution), directly illustrating 9.2.2f's
     relocation rule. `print.blocks` are recorded in PRINT's own interrupted order (the only
     correct input for a builder that works from `print` alone) — this is expected to mismatch
     the relocated gold braille; see "New findings" below.

## Displayed sentences and verse as lists

BANA 9.2.2e ("multiple displayed sentences are treated as a list beginning at the adjusted
left margin") is illustrated twice in this section by content that isn't literally an ordinary
print list: `example-9-4`'s two vocabulary sentences, and `sample-9-02`'s four-line poetic
verse (italicized, entirely emphasis-omitted per 9.2.3b). Both measure identically in braille
— first line at cell 3, runover at cell 5 — matching 9.2.2e's own "adjusted margin + list
runover" pattern exactly. Both are modelled here as `kind:"list"` with a plain `items` array
of strings, for `buildModel9` to build consistently with `buildListItem`. `sample-9-03`'s
*second* list (three numbered sentences) is NOT displayed material at all and correctly
measures at ordinary list margins (cell 1 / cell 3), confirming the schema's `list` kind
covers both cases correctly depending on the print's own actual indentation.

## Compact multi-caption stacks

Two files (`sample-9-07`, `sample-9-08`) contain several short, print-distinct caption/credit
fragments transcribed as consecutive braille lines with **no blank line at all** between any
of them. Emboss's only cell-5/cell-7 citation-like block, `attribution` (reused for `source`
too, per F-101), unconditionally appends a trailing blank line after itself
(`format/document.mjs` `formatAttribution`) and wraps its own content continuously rather than
forcing one short phrase per physical line — so neither a single combined block nor several
separate ones can reproduce this print pattern without either merging distinct fragments or
inserting unwanted blank lines. Where the fragments are genuinely separate BANA concepts
(`sample-9-10`'s closing phrase / "(Signed)" / script signature), they are still modelled as
separate blocks and the resulting extra blank lines are an expected, documented mismatch (see
"New findings"). Where they are an incidental caption stack with no independent standing
(`sample-9-08`'s composer/arranger credits), they are folded into one `kind:"other"` block
instead, since building them at all would misrepresent, not merely mis-format, the source.

## `illustrates` convention

One rule id per file (dotted-letter sub-clause suffix, e.g. `9.6.1.e`), `quote` the entirety
of that specific rule/clause's own text, per the §4/§8 precedent. Two Examples (9-7, 9-8) both
illustrate the parent rule 9.6.1 as a whole (each demonstrating a *different* specific clause
— 9.6.1.d's "note with a heading" vs 9.6.1.e's "note without one") rather than the whole
lettered list, since clauses a/b/c/f are not independently exercised by either short excerpt.

## Known, expected non-matches

Beyond the specific Emboss capability gaps below, plain `kind:"paragraph"` blocks throughout
this section are transcribed at **cell 1** (BANA's plain "block" paragraph style) in nearly
every sample's own braille — not the cell-3-first/cell-1-runover "indented" style BANA
Formats' own §4 worked examples use (compare `example-4-3`, which matches with Emboss's
default). Emboss's `paragraphStyle` option supports both styles, but it is a single
document-level setting shared by this whole gold-run harness's `OPTS` object across every
section; this reconciliation does not add a per-sample override (out of scope — "existing
sections' output unchanged for the same code"). Every plain-paragraph mismatch attributable
*solely* to this cause is a harness/measurement artifact, not a standards violation — Emboss
already supports "block" style correctly when a transcriber selects it for a whole document —
and is called out as such in `differences.md`, not filed as a new standards-findings.md entry.

## Gold-run.mjs results

See `differences.md` for the full mismatch-by-mismatch breakdown, `Emboss/docs/standards-findings.md`
for the specific findings newly added by this reconciliation's own gold-vs-Emboss comparison,
and `node Emboss/scripts/gold-run.mjs --section section-9 --update-status` for the current
counts.
