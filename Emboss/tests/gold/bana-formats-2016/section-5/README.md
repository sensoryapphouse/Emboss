# Gold examples — BANA Braille Formats 2016, §5 (Typeforms)

## What these files are

20 JSON files, one per worked example/sample named in the section's own table of contents
(§5.10) and running rule text: the 17 inline **Examples** (`example-5-1.json` …
`example-5-17.json`) and the 3 numbered **Samples** (`sample-5-01.json` … `sample-5-03.json`).

18 of the 20 carry braille (`braille.width: 40`); 2 are explicitly "(Print Only)" in the
source and have no braille at all (`braille.width: null`): `example-5-5` (Bold Ignored) and
`example-5-6` (Italics Ignored), both illustrating rule 5.3.6.

Each file has the same top-level shape as the §4/§7/§8/§9 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [{ "kind", "level", "text", "features", "items" }, ...],
             "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "lineNumbers"?, "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — `level` is `1`/`2`/`3` (centred/cell-5/
  cell-7), **re-derived directly from this section's own agreed `braille.lines`** for every
  file that has one (the same fixed-4/6-cell-indent-or-`(40−len)//2` test the section-4/7/8
  precedent uses), never taken from either transcription run's own `level` field — run A
  asserted `1` for several headings, run B left `level: null` throughout the entire section
  on principle ("§5 is not about heading-level placement"); both are superseded here by direct
  measurement. Applies to: example-5-4/5-11/5-12's centred title/byline lines (all verified
  centred by the formula) and example-5-7/5-9's headings (both verified a fixed 4-cell indent,
  i.e. cell-5 — neither run had asserted any level for these at all).
- `{ kind:"paragraph", text, features }` — ordinary running prose.
- `{ kind:"list", items:[...], features }` — `items[]` is a flat array of plain inline-marked-
  up **strings**, not `{marker, level, text}` objects like §7/8/9's own list items — every list
  in this section is a single flat run with its own ordinal/lettered marker already folded
  into the item's own text (e.g. `"**1.** *friend*"`); no sub-levels or bullets occur anywhere
  in this section.
- `{ kind:"other", features }` — never modeled; used for braille-only content with no
  print-side counterpart at all, matching the section-4/7/8/9 precedent's own convention for
  the same construct — here, every `{{tdN}}`-symbols-key transcriber's note that opens the
  braille of Examples 5-14/5-16/5-17 and Samples 5-1/5-3 (each restates, inside the braille
  only, a "Symbols used" legend that in print sits with the RULE text, not inside that
  worked example's own box).

Inline emphasis inside `text`/`items` strings uses Emboss's own real cell-markup DSL
(`Emboss/format/cell-markup.mjs`, confirmed directly by executing `parseCellMarkup` on every
string in this corpus), **not** the loose "*italic*/**bold**/__underline__" shorthand either
transcription run's own documentation described:

- `**bold**`, `*italic*` — non-nesting; two separate, non-overlapping spans in one string are
  fine, but bold-inside-italic (or vice versa) is NOT supported by the plain-text branch of
  this parser and must use nested HTML tags instead (`<b>...<i>...</i>...</b>`, confirmed to
  combine `tf` bits correctly) if it's ever needed — not needed anywhere in this section's
  own worked examples once example-5-10/sample-5-02's two bold-italic spans were rewritten
  this way (see differences.md's "Corrections").
- `<u>underline</u>` — **not** `__underline__`, which this DSL parses as an alias for
  **bold**, not underline (`cell-markup.mjs:68`) — a real trap the two transcription runs'
  own stated schema fell into; every genuinely-underlined span in this section
  (example-5-15, example-5-16, sample-5-01) was rewritten from `__x__` to `<u>x</u>`.
- `` `code` `` — uncontracted braille (not used in this section).
- `{{tdN: X}}` — this reconciliation's own placeholder for a transcriber-defined typeform span
  (colour, double underline, a shape outline, etc.) applied to text X, numbered in first-use
  order within that file's own print text (not tied to a Special-Symbols legend's own listed
  order, which is a book-wide, not per-passage, ordering — see sample-5-03, where the legend
  lists pink before purple but the passage's own colour sequence uses purple before pink ever
  appears). There is deliberately no real markup token for this: Emboss's own `TYPEFORM`
  bitmask has no bit for any of UEB's five transcriber-defined indicators or for script at all
  (`standards-findings.md` F-86, cross-referenced from the new F-83/F-84 this reconciliation
  adds). `buildModel5` unwraps every `{{tdN: X}}` span to its own inner text X (recording a
  limitation once per distinct symbol number actually used) before the string reaches
  `textOrSegments`/`parseCellMarkup` — so a genuine `*italic*`/`<u>underline</u>` run nested
  inside an otherwise-unrepresentable transcriber-defined span (example-5-14's own
  demonstration sentence) still parses correctly for the attribute Emboss CAN represent.

`braille.lineNumbers` (present only on the three numbered Samples, a schema addition proposed
by run B and adopted here) is a parallel array to `braille.lines` holding the printed
line-number for each entry (starting at 1, 7, and 1 respectively for Samples 5-1, 5-2, 5-3 —
Sample 5-2's own excerpt genuinely starts at line 7 in the source, lines 1-6 simply absent,
not blank). The base schema used by the §4/7/8/9 precedents has no such field; the three
numbered Samples in this section are the only worked examples anywhere in this corpus so far
that print an explicit line number on every line, so recording it separately keeps `lines`
purely as braille-cell content while still preserving this genuinely-present structural fact.

- `sources` is always `["A", "B"]`: two independent Sonnet transcriptions were compared for
  every field of every item.
- `resolution` is a short prose note citing the evidence for how any disagreement was settled
  — a source `.txt` line number, a PDF page, or a direct measurement against the
  (already-agreed) `braille.lines` — see `differences.md` (the working scratch copy of this
  reconciliation's own evidence trail) for the full per-file reasoning, including several
  corrections made to BOTH runs' own accounts, not just a pick between them (example-5-8's
  dialogue text was over-read by both runs relative to what the braille actually transcribes;
  example-5-9's heading wording was independently decoded from the braille itself, not taken
  from either run's own guess).

## How these files were made

1. Two independent transcription runs ("A" and "B") already existed, each having read
   `references/_text/braille-formats-2016.txt` (lines 3794-4348) and the PDF page images
   (`references/bana/braille-formats-2016.pdf`, pages 127-143; `PDF page = printed page +
   126`, confirmed directly against the printed-page-footer text on every page boundary
   through this section).
2. Every field of every item was diffed programmatically between the two runs
   (`compare-gold-5/diffall.mjs`, scratch working copy) — 1195 lines of raw diff across all
   20 files.
3. A **third, independent** re-derivation of every `braille.lines` array was built directly
   from the raw `.txt` (`compare-gold-5/extract.py`), distinguishing U+2800 (blank braille
   cell) from literal ASCII space at the character level for every relevant line, and used as
   the actual tie-breaker for every braille-level disagreement — not either run's own account.
   This caught a systematic bug in run B (present in roughly half this section's files): B's
   own stated convention only strips the fixed literal-space margin, but B's actual output
   also stripped genuine intra-line indentation (a runover/continuation line's own hanging
   indent, or a numbered Sample's own use of `_` cell alignment) wherever that indentation
   happened to be encoded as leading U+2800 cells rather than literal margin spaces — verified
   directly against specific `.txt` line numbers (e.g. example-5-10's lines 4028/4030/4031
   each carry the 9-space margin followed by exactly 2 literal U+2800 cells of real
   indentation that B's output drops).
4. Two files' worth of dialogue/heading text were corrected beyond what either run reported,
   not merely picked between them — see `differences.md`'s "Corrections beyond the two runs"
   for example-5-8 (both runs invented dialogue continuation beyond what the given braille's
   own `444`/`4444` markers support) and example-5-9 (the heading's wording, "What You Will
   Discover", independently decoded letter-by-letter from the braille rather than guessed).
5. Heading `level` for example-5-4/5-7/5-9/5-11/5-12 was newly measured directly against each
   file's own agreed `braille.lines`, not taken from either run.
6. `Emboss/format/cell-markup.mjs`'s `parseCellMarkup` was executed directly (not just read)
   on every `text`/`items` string in the finished 20-file corpus, both to discover the real
   DSL's actual behaviour (uncovering the `__x__`→bold trap and the no-nesting limitation
   described above) and to confirm the final corpus parses cleanly with no stray literal
   markup characters leaking through after `{{tdN}}`-stripping.
7. `buildModel5` (`Emboss/scripts/gold-run.mjs`) was added and run against all 20 files
   (`node Emboss/scripts/gold-run.mjs --section section-5 --update-status`); every resulting
   mismatch's first differing line was traced to a specific cause and matched against an
   existing finding (F-41, F-86, F-82) or a newly-added one (F-83, F-84 — see
   `Emboss/docs/standards-findings.md`).

## What Emboss cannot build here (see `standards-findings.md`)

- **F-83 (new)** — BANA §5.3's many contextual "ignore font attribute" exceptions (standing-
  alone letters 5.3.2, word-parts 5.3.3, part-of-speech abbreviations 5.3.4, stage directions
  5.3.8, exercise numbers/letters 5.3.9, quoted matter 5.3.10, alphabetic-reference entry
  words 5.3.11) have no code path outside headings (F-41/F-87, which always strip — the
  opposite problem) or the single "entire list emphasized" case (F-88, 5.3.7). An ordinary
  paragraph in Emboss never drops a `tf` bit for any reason. Affects example-5-1, 5-2, 5-3,
  5-7, 5-8, 5-9, 5-10, 5-13, sample-5-02 — the majority of this section's `mismatch` files.
- **F-86** (`assess-5/typeforms-writeup.md`, scratch — not yet merged into
  `standards-findings.md` by number, cross-referenced from F-83/F-84) — script and the five
  UEB transcriber-defined typeform indicators are fully supported by the bundled liblouis UEB
  table but completely unreachable from Emboss's own `TYPEFORM` constant/parser/editor.
  Affects every `{{tdN}}`-bearing file: example-5-14, 5-16, 5-17, sample-5-01, sample-5-03.
- **F-84 (new)** — `HEADING_JOIN_TIERS` (`document.mjs:273`) unconditionally suppresses the
  blank line between two consecutive centred (or cell5→cell5/cell5→cell7) headings, with no
  per-pair way to opt out, though Examples 5-4/5-11/5-12's own worked braille shows a genuine
  blank line between their title/byline pair. Affects example-5-4, 5-11, 5-12.
- **F-82** (already documented against §16) generalizes directly here: an isolated
  single-paragraph/single-list worked-example excerpt gets Emboss's genuinely-correct default
  first-line paragraph indent (and, for a list, the genuinely-correct blank line after the
  list block) that the excerpt itself doesn't show, because the excerpt is lifted out of its
  real page context. A contributing or sole cause for example-5-1, 5-2, 5-3, 5-9, 5-13, 5-15.

See `differences.md` for the complete per-file evidence trail, every disagreement's
resolution, and the unresolved-in-the-primary-source list (Sample 5-3's `#,-` marker and its
mid-sentence truncation; Example 5-4's poem-line italics; a handful of smaller, individually
`uncertain`-flagged items).
