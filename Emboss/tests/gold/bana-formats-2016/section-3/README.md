# Gold examples — BANA Braille Formats 2016, §3 (Transcriber's Notes)

## What these files are

9 JSON files, one per worked example/sample named in the section's own running rule
text (§3 has no numbered "Samples" list beyond `Sample 3-1`; the four short,
anonymous `Samples:` block wordings under 3.3.3 and 3.4.1 are recorded separately,
named after their citing rule, matching the §13 gold precedent's own convention for
this exact situation):

- **4** inline **Examples**: `example-3-1.json` … `example-3-4.json`.
- **1** numbered **Sample**: `sample-3-01.json` ("Headings Added to Matching
  Exercise").
- **4** embedded, unnumbered `Samples:` block wordings quoted inline within running
  rule text (suggested transcriber's-note phrasings, not full worked examples):
  `sample-3-3-3-a.json` / `sample-3-3-3-b.json` (rule 3.3.3's "Text continues on
  page 834." / "Text continued from page b832."), `sample-3-4-1-a.json` /
  `sample-3-4-1-b.json` (rule 3.4.1's Nemeth-code / tactile-graphics Transcriber's
  Notes page wordings) — none of these four has a braille rendering anywhere near
  its own citing location (`braille.lines: []`).

Each file has the same top-level shape as the §4/§7/§8/§9/§13/§16 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "transcriberNote", "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array (empty for the four no-braille anonymous samples);
each element is one of:

- `{ kind:"heading", level, text, features }` — level 1 = centred, exactly as the
  §4/§7/§8/§9/§13 precedents (this section's own two headings, `example-3-4`'s
  "LITERATURE AND GOVERNMENT / Rule by the Rich" and `sample-3-01`'s "SAT Vocabulary
  Quiz: / Literary Terms", are both level 1/centred, confirmed against the agreed
  `braille.lines`; no cell-5/cell-7 heading appears in this section's own worked
  examples).
- `{ kind:"paragraph", text, features, continuation? }` — ordinary running prose;
  `continuation:true` (matching `buildModel1`'s own convention, itself matching
  `document.mjs`'s real `formatPara` `continuation` field) marks a paragraph that is
  itself only a run-on continuation of a sentence interrupted by an embedded note
  (`example-3-2`'s own "light and heat", continuing directly after its embedded
  note with no fresh-paragraph indent).
- `{ kind:"note", text, features }` — a transcriber's note (BANA §3's whole subject),
  built directly into a document `{type:'note', text}` block —
  `Emboss/format/document.mjs`'s real `formatTranscriberNote`, dispatched from a
  parsed `<prodnote>`/`<annotation>` exactly the way `parse.mjs` itself builds one
  (`{type:'note', text}` at `parse.mjs:2647`/`2777`/`2782`; see "`buildModel3`" below).
  Used BOTH for a "standard" TN sitting before/after a block of running content
  (`example-3-1`, `example-3-4`'s two notes) AND for a genuinely EMBEDDED, mid-
  sentence note (`example-3-2`'s "right arrow", spliced between two paragraph
  fragments) or a note standing alone as a heading-like label
  (`sample-3-01`'s "Term"/"Definition" column headings) — §3's own running text
  (3.1.4, 3.2.3) treats all of these as the same underlying `<prodnote>` construct,
  differing only in WHERE the note sits relative to the content around it, which
  this schema records simply by the note block's own POSITION in `print.blocks[]`.
- `{ kind:"list", items, features }` — `items[]` is either a flat array of plain
  strings (no markers — `example-3-3`'s three analogy lines, matching the §9 gold
  precedent's own flat string-list convention) or of `{marker, text}` objects
  (`sample-3-01`'s lettered/numbered matching-exercise columns, reusing
  `buildListItem` exactly as the §7/§8/§9/§16 precedents do).
- `{ kind:"attribution", text, features }` — a fixed cell-5 block (BANA §9.4,
  `formatAttribution` — first line AND runover both indented 4 cells, no blank line
  before, one blank line after), reused here (exactly as the §9 gold precedent
  reuses it for its own non-authorship cell-5 content, source citations) for
  `sample-3-01`'s own "Directions:" line, whose margin matches this block, not an
  ordinary paragraph's first-line/flush-runover margin — confirmed directly against
  the gold braille.
- `{ kind:"pagenum", text }` — BANA 1.11.3's mid-braille-page print-page-change
  indicator (a full-width row of unspaced dots-36 ending, with no space, in the new
  page's numeral-sign number), reusing the §1 gold precedent's own `{type:'pagenum',
  page}` document block (`example-3-4`'s two page turns, 833 then 834).
- `{ kind:"other", text (or null), features }` — never modelled; recorded as a
  limitation exactly like the §4/§7/§8/§9/§13/§16 precedents' own 'other'. Not
  actually used by any of this section's own 9 files (kept in the schema/builder for
  consistency with every other section).

`print.transcriberNote` (top-level, string) is kept on every file as a plain-English
summary/documentation copy of the section's own primary transcriber's note wording
— matching the two independent transcription runs' own original schema choice for
this section (`print.blocks[] + print.transcriberNote`, distinct from every other
section's plain `print.blocks[]`-only shape, because §3's whole subject IS the
transcriber's note). `buildModel3` (see below) consumes the EXPLICIT `kind:"note"`
entries inside `print.blocks[]` for structural building whenever `print.blocks` is
non-empty (all 5 files with real braille); for the 4 no-braille anonymous samples,
where `print.blocks` is deliberately left `[]` (there is no other print content at
all — the "Samples:" wording IS the entire citing passage), `buildModel3` falls back
to building a single `{type:'note', ...}` block from `print.transcriberNote` itself.

## How these files were made

1. Two independent transcription runs ("gold-3-A", "gold-3-B") already existed, both
   produced by the same process (Gemini Pro via Antigravity, per each run's own
   `summary.md`), each reading `references/_text/braille-formats-2016.txt` (lines
   2935-3123) and the PDF page images (`references/bana/braille-formats-2016.pdf`,
   pp.99-103; PDF page = printed page + 98).
2. Every field of every file was diffed programmatically between the two runs
   (`compare-gold-3/decode*.mjs` and a `python3 json.dump(sort_keys=True)` diff in
   the working scratch copy): **all 9 files are byte-for-byte identical between run
   A and run B** except the `sources` field — there was no A-vs-B disagreement
   anywhere in this section to arbitrate.
3. Despite that agreement, both runs shared the same errors relative to the actual
   source in 5 of the 9 files — found by forward-translating every `print.blocks`/
   `transcriberNote` candidate wording through Emboss's own UEB translator
   (`Emboss/engine/louis.mjs`) and comparing the result CHARACTER-FOR-CHARACTER
   against the already-agreed `braille.lines` (never re-typed or re-verified here —
   both runs' own braille transcriptions check out completely; only the PRINT-side
   fields describing what produced that braille were wrong). Where a candidate
   didn't reproduce the target, the actual PDF page was read directly to find the
   real print wording, and — for `example-3-2`'s two-cell mystery token — a 600dpi
   render of the PDF page was cropped to the source's own highlighted
   transcriber's-note callout box and its dot pattern read directly, pixel by pixel.
   See `differences.md` for the complete, file-by-file evidence trail (six distinct
   corrections across `example-3-1`, `example-3-2`, `example-3-3`, `example-3-4`,
   and `sample-3-01`, plus a shared `illustrates.quote` error on rule 3.2.3 affecting
   two files).
4. `example-3-2` in particular needed a full rebuild: both runs invented an entire
   print sentence ("Match the Presidents with their pets.") and transcriber's note
   ("headings added") that appear nowhere on the cited page and do not translate to
   anything resembling the agreed braille — the real print content ("Electrical
   energy → light and heat", with an embedded "right arrow" note) was recovered
   entirely from the PDF image and confirmed by an exact forward-translation match.
5. `sample-3-01`'s two matching-exercise lists were rebuilt from three-plus-ellipsis
   (matching the BRAILLE excerpt's own "444"-truncated shape) to the full eight-item
   PRINT content, per the already-established `sample-4-01` precedent
   (`Emboss/tests/gold/bana-formats-2016/section-4/README.md`) for a braille excerpt
   that truncates longer print content — the print itself is not abbreviated, only
   the book's own worked-example excerpt of its braille is.

## `buildModel3` — the transcriber's-note model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to
learn the real transcriber's-note model `buildModel3` reproduces: a print
`<prodnote>`/`<annotation>` becomes a document `{type:'note', text}` block
(`parse.mjs:2647`, `2777`, `2782` — the SAME shape whether the source note sits
before/after a paragraph, is embedded mid-sentence, or stands alone as a heading-
like label; `parse.mjs` always treats `<prodnote>` as block-level, `BLOCK_TAGS`,
`parse.mjs:1469`), formatted by `document.mjs`'s own `formatTranscriberNote`
(`document.mjs:819-826`): the translated text is wrapped in UEB's TN indicators
(`TN_OPEN='@.<'`/`TN_CLOSE='@.>'`, dots-4/46/126 each) and wrapped at BANA's 7-5
margins (`tnMargins`, `document.mjs:793`: `first:6, runover:4` in BANA mode,
UNCONDITIONALLY — there is no separate, narrower margin for a SHORT "embedded"
(≤7-word) note per 3.2.3, or for a note whose own governing rule specifies a
different margin like 3.3.2's 1-3 list). This is the single biggest, systemic
source of mismatch in this section, matching three already-documented Emboss gaps
and one newly-found one during this reconciliation:

- **F-138 (reused — "No Special Symbols page exists")** — `document.mjs`'s
  `tdSymbolNote` dot-locator mechanism (RUEB §3.26.1: a transcriber-defined symbol's
  FIRST use inside its own explanatory note carries a `.=` prefix) is hard-coded to
  the ASTERISM symbol only (`TD_SYMBOL_1`); it does not generalise to any OTHER
  transcriber-defined symbol, so `example-3-1`'s own "×" symbol and `example-3-3`'s
  own ": is to"/":: as" symbol definitions are both missing their `.=` locator when
  built from plain text.
- **F-15 (reused — "No structural support for a key-list transcriber's note")** —
  `formatTranscriberNote` takes one flat block with a single first/runover margin
  pair; it has no way to represent a note whose OWN internal content needs a
  DIFFERENT, narrower margin for part of itself (3.3.2's own 1-3 list of symbol
  identifications, nested inside `example-3-3`'s otherwise-ordinary 7-5 note) — F-15
  was written for §11.8's larger key-list note, but the underlying gap (one margin
  pair per note block) is identical.
- **F-107 (reused — "No inline-note construct")** — there is no inline-note segment
  type anywhere in `document.mjs`; a note that print shows genuinely EMBEDDED
  mid-sentence (`example-3-2`'s "right arrow", 3.2.3's own worked example of this)
  can only be built as a separate top-level block, which Emboss will always place on
  its own indented line rather than fuse into the middle of the surrounding
  sentence — an expected, already-known reproduction of the same gap, not a new one.
- **F-163 (new)** — a `note` block has no awareness of its own surrounding context:
  `sample-3-01`'s two one-word embedded notes ("Term"/"Definition", 3.2.3) sit, in
  the gold braille, at the SAME 4-cell margin as their surrounding attribution/
  heading content (not the fixed 6-cell margin `tnMargins` always gives), with NO
  blank line before the list each one introduces (Emboss's list formatter
  unconditionally opens with one); separately, `example-3-4`'s closing dialogue line
  is followed, WITH a blank line, by its own continuation note — a blank line
  `formatTranscriberNote` never supplies and this reconciliation could not fully
  characterise from nine worked examples alone (`example-3-3`'s own paragraph-then-
  note transition has no such blank line).

`sample-3-01`'s own two lists are additionally expected to over-produce lines
relative to the book's own abridged braille excerpt (its truncating "444" marker has
no print-side input to build from) — the same already-documented, non-defect
limitation `buildBlocks8`'s "text" placeholder records for section 8's own
`sample-4-01`-style excerpts.

`example-3-4`'s two `{kind:'pagenum'}` blocks are expected to build and compare
CORRECTLY — `formatPageNum`'s BANA output (`document.mjs:1029-1043`) is an exact,
already-tested match for BANA 1.11.3's dashed-line-plus-number shape, with nothing
section-3-specific about it.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-3 --update-status`: **0 match**,
**5 mismatch** (all 5 files that carry real braille), **4 no-braille** (the four
anonymous "Samples:" wordings). Every mismatch's cause is exactly one or more of the
findings above, with nothing left over:

- `example-3-1` — F-138 only (the note's own transcriber-defined-symbol first-use
  locator `.=` is missing; everything else, including the paragraph's own flush
  margin, matches once modelled with `continuation:true`).
- `example-3-2` — F-107 only (the whole file is one long structural mismatch: three
  separate blocks instead of one fused mid-sentence note).
- `example-3-3` — F-138 and F-15 together (the note's own first symbol-identification
  line is missing both its `.=` locator and its own narrower 1-3 margin; the
  blank-line-delimited close of the note and start of the plain list is likewise not
  reproduced without a nested-margin note).
- `example-3-4` — F-163 (point 3) only (a missing blank line before the opening
  continuation note) plus the book's own "444" ellipsis placeholder (no print-side
  input to build from — an expected, documented excerpt limitation, not an Emboss
  defect, matching the section-4/section-8 precedent for the identical marker).
- `sample-3-01` — F-163 (points 1 and 2) for both embedded notes' own margin and
  missing note-to-list blank-line suppression, plus the same "444"-ellipsis
  over-production limitation as `example-3-4` (this file's own two lists are built
  from the FULL 8-item print content per the `sample-4-01` precedent, so the model
  legitimately produces more lines than the book's own abridged excerpt).

See `Emboss/docs/standards-findings.md` F-15, F-107, F-138, F-163 for the specific
findings this run's mismatches trace to, and
`Emboss/tests/gold_bana_section3.test.mjs` for the regression guard.
