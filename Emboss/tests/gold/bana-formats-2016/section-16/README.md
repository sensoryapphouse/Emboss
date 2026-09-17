# Gold examples — BANA Braille Formats 2016, §16 (Notes)

## What these files are

32 JSON files, one per worked example/sample named in the section's own running rule text and
§16.12's own numbered list:

- **14** inline **Examples**: `example-16-1.json` … `example-16-14.json` (`example-16-13` and
  `example-16-14` are the source's own two `(Print Only)` items — no braille anywhere).
- **13** numbered **Samples**: `sample-16-01.json` … `sample-16-13.json`.
- **5** embedded, unnumbered `Sample:`/`Example:` illustrations quoted inline within running
  rule text (distinct from the 13 numbered §16.12 Samples): `sample-16-7.7a.json` (rule
  16.7.7a), `sample-16-7.7b.json` (16.7.7b), `sample-16-8.1b.json` (16.8.1b),
  `sample-16-9.2c.json` (16.9.2c), `sample-16-11.1g.json` (16.11.1g) — named after their citing
  rule since none has a "16-N" number of its own.

Each file has the same top-level shape as the §4/§7/§8/§11 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "notes": [...], "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is the same flat array section-4/7/8 already use (`{kind, level, text,
features}`, plus `items`/`headers` where the content is a list or table), with ONE addition
this section needs: a paragraph's own reference points are marked inline with a literal
`[ref:MARK]` token (e.g. `"Hamlet[ref:*]"`), and a **separate** `print.notes[]` array records
each note's `{ref, placement, text}` — `placement` is how print physically laid the note out
(`footnote`: below a rule at page-bottom; `margin`: alongside the text; `inline`: bracketed
directly at the point of reference, B004 Example 1's own style). `print.notes[]` entries are
matched to `[ref:MARK]` tokens strictly by ARRAY/TEXT ORDER (not by re-matching the `ref` text,
since several files reuse one mark for more than one note — e.g. Sample 16-4's three hollow-dot
`°` marks, each keying a different note).

Two additional `kind`s appear only in this section:

- `{kind:"note", text, features}` — a print-side record of a margin/side-note's own real
  wording (used only where a note has NO `[ref:MARK]` anywhere in its own paragraph at all —
  BANA 16.4b/c's "notes without a reference mark", e.g. Example 16-6's "Slag is the dross of
  metal" — or a standalone, fully-quotable explanatory transcriber's note with nothing
  referencing it, e.g. Example 16-5's opening "All underlined words below have associated
  notes."). `buildModel16` tells the two apart by position: a `note` block that comes right
  AFTER a referencing paragraph with no `[ref:MARK]` token is the unbuildable 16.4b case (built
  as the literal embedded word "note", per that rule, with the note's real wording recorded as
  a limitation); a `note` block with nothing referencing it — usually the FIRST block, or right
  after a heading — is real, quotable content, built directly.
- `{kind:"limitation", text}` — braille content with no print-side counterpart at all to build
  it from (Samples 16-12/16-13's own leading grouping-indicator transcriber's note, §16.11's
  own boilerplate wording — the print page shows only the labelled essay/letter, not this TN's
  own text). Recorded directly as a `limitations` entry, never guessed.

`kind:"table"` uses this section's own flat `items[]` of pipe-separated cell strings (`"1 |
Death of spouse | 100"`, matching section-8's own list-item convention rather than section-7/
11's separate `headers[]`/`rows[]`) — this book's own tables here are plain key/value listings,
never a clean tabular header row in the print itself; `headers` is added only where confidently
inferrable (Sample 16-9, from `printFeatures`'s own description). An `items` entry with no
`" | "` at all (Sample 16-10's "Precious Metals"/"Fossil Fuels") is a sub-heading row inside
the table, built as its own single wide cell. Every table is wrapped in a `box`.

## How these files were made

1. Two independent Sonnet transcriptions of the section already existed (Run A and Run B),
   each having read `references/_text/braille-formats-2016.txt` (lines 12310-13356) and the PDF
   page images (`references/bana/braille-formats-2016.pdf`, pp.429-464; PDF page = printed
   page-after-hyphen + 428).
2. Every field of every file was diffed programmatically between the two runs
   (`compare-gold-16/diffall.mjs`/`diffcore.mjs`, scratch working copies). The two runs used
   two structurally different `print` schemas for the same content (see `differences.md`'s §1)
   — Run B's `[ref:MARK]`/`print.notes[]` schema was adopted throughout, matching this task's
   required shape.
3. `illustrates.rule`/`.quote` and `textLines` were reset to `Emboss/docs/standards-map.md`'s
   own already-reconciled "BANA §16 — worked examples" table for every file (both runs'
   independent guesses at which lettered sub-rule an example illustrates disagreed often and
   were superseded, not averaged — see `differences.md`'s §2 for the full id mapping).
4. `braille.width` was independently re-derived (not taken from either run) for every disputed
   file by stripping the item's own fixed left padding or numbered-Sample line-number field
   (field width `digits(max line number)+3`, per the section-4/11 precedent, held constant
   across an internal page break) from the raw source `.txt` and measuring for a genuine
   column-40 anchor (a right-flush page number, a note-separation/dashed-rule line, a table
   header row). This **overturned** Run A's own inference for Example 16-10, Example 16-11 and
   Sample 16-8 (each has no real column-40 evidence — the same tabbed-reference-mark anomaly
   the task brief itself names, or, for 16-11, weaker evidence Run A itself had flagged) —
   `width` is `null` for those three, matching Run B, not Run A. See `differences.md`'s §3 for
   the complete file-by-file account.
5. Every disputed `braille.lines` value was re-extracted character-by-character (Python,
   U+2800→space, exact padding measurement) rather than picked from either run; Run B was
   correct in every one of the 6 files checked (Run A undercounts leading blank-cell padding by
   a consistent 2 cells in several places, and once inserts a token — `"9` in Sample 16-10's
   percentage-range cells — that does not exist in the source at all). See `differences.md`'s
   §4.
6. `Sample 16-11.1g` (5 lines of literal grouping-indicator/key codes) was resolved against
   `standards-map.md`'s own existing "Has braille? No" classification for this item, not either
   run's own say-so — confirmed directly against the source: the codes are print's own citation
   of the braille signs being defined (exactly like rule 16.2.2's own reference-mark table),
   not a worked braille excerpt. See `differences.md`'s §5.
7. A handful of files needed their `print.blocks`/`print.notes` content corrected once
   `buildModel16` was actually run against them (redundant restated note text removed, a
   placeholder note text/placement corrected against the source, Example 16-5 reshaped into
   its real underline-not-symbol structure, stray `[print page N]`/`[line N]` pagination
   annotations stripped). See `differences.md`'s §6 for the full list.

## `buildModel16` — the note/footnote/endnote model

A paragraph's `[ref:MARK]` tokens become `noteref` segments (matching real DTBook parsing,
`Emboss/input/parse.mjs:1919-1931`); the matching `print.notes[]` entry becomes a
`{type:'footnote', id}` block with the SAME synthetic id, placed right after that paragraph
(matching real DTBook document order — Emboss's own `noteLayout`, `document.mjs:2768-2806`,
then moves it to its actual printed position). Per BANA 16.2.1 ("the reference mark is
typically repeated ... before the word at the beginning of the note"), a genuine symbol/letter/
digit mark is rebuilt as its own leading `noteref` segment on the note block too — but a mark
that is really a print line-number/range key (e.g. Example 16-8's "164-166") is left as plain
text, since 16.9.4's own separate line-numbering convention, not a superscripted symbol, is
what print actually shows there.

Two placements Emboss has no mechanism for at all (`notes-writeup.md` F-107, not yet merged into
`standards-findings.md`) are built as a best-faith approximation, not silently skipped:

- **`inline`** (B004 Example 1's own bracketed-at-point-of-reference style): the one paragraph
  is split into three top-level blocks — text, a `{type:'note'}` block carrying the note's own
  wording, text — since no inline-note SEGMENT type exists anywhere in `document.mjs`. Always
  mismatches (the note lands on its own indented line, not fused into the sentence); the cause
  is F-107, not a new finding.
- **a note with no `[ref:MARK]` token in its own paragraph at all** (BANA 16.4b/c, "notes
  without a reference mark" — e.g. Example 16-6's unmarked margin note): the literal embedded
  word "note" is built (per 16.4b's own instruction), and the note's real wording is recorded
  as a `limitations` entry — nothing in the model can carry the real content here, only the
  placeholder 16.4b itself prescribes.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-16 --update-status`: **0 match, 14
mismatch, 11 not-representable, 7 no-braille** (32 files). No file in this section matches
byte-for-byte — every one of §16's own notes constructs exercises at least one of the gaps
`notes-writeup.md` F-106 through F-120 already document (inline notes F-107, no-reference-mark
notes F-107, note ordering/placement F-108, in-table footnotes F-109, table-format note sequences
F-110, endnote-section machinery F-111, consecutive-UKAAF-footnote spacing F-112, keyed-marginal-
labels F-119 — confirmed directly by this reconciliation's own gold-vs-Emboss run, e.g.
`b004-11-1`'s F-107 reproduction, `b004-11-2`'s F-112 reproduction) — plus, for 11 of the 14
`mismatch` files (Examples 16-1/16-2/16-5/16-7/16-9/16-11, Samples 16-1/16-3/16-4/16-5/16-6), a
newly-documented, non-defect cause: `standards-findings.md` F-82, an isolated single-item demo
excerpt (no real surrounding page) necessarily diverges from Emboss's real output on two
systemic, EXPECTED grounds — the mandatory §16.5.1a note-separation line, and the referencing
paragraph's own default first-line indent — neither of which the tiny excerpt itself shows,
since it was never really the start of a braille page/volume. See `differences.md` (this
reconciliation's own working notes, kept with the task's scratch files) for the complete
per-file cause, and each file's own `resolution` field for a short pointer to it.
