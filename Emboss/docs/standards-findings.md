# Standards findings — tables and related columns

What this is: every rule in `standards-map.md` whose Emboss status is *partial*, *not done*,
or (for a worked example) doesn't match, written up as a finding: the rule(s) it covers
(quoted verbatim, with id), what Emboss actually does (with evidence — function/file:line),
what the standard requires, a proposed classification, and the test that would prove a fix.
Findings are numbered F-1, F-2, … Closely related rules that share one root cause and one
fix are grouped into a single finding rather than repeated 96 times — each finding lists
every rule id it resolves, so every row of the map marked partial/not done is traceable to
exactly one finding below (a coverage check is in `assess-tables/summary.md`). Nothing here
has been fixed: every bug goes to Paul's task list; "standard unclear" and "deliberate
choice" items go to Paul for a decision (see also `standards-questions.md`).

No code or tests were changed while producing this document.

---

## F-1 — Rowspan is dropped, not expanded: an implied row heading corrupts every row it covers

**Rules:** BANA 11.5.3a, 11.5.3b, 11.5.3c, 11.5.3d

> “When a row heading is not repeated but refers to more than one column entry, leave the
> area(s) where the inferred row heading(s) belong blank.” (BANA 11.5.3a)

**What Emboss does:** `parseTable` (`Emboss/input/parse.mjs:2828-2955`) expands a `colspan`
by inserting blank cells (lines 2896-2897, 2933-2935) so later columns stay aligned, but it
never reads or expands `rowspan` at all. A `<th rowspan="2">` row heading is read once, for
its own `<tr>`, and every later row that print left blank in that column is **not** padded
with a blank cell — so the whole row shifts one column to the left instead.

Reproduced (scratch experiment, not an existing test):

```html
<tr><th rowspan="2">North</th><td>2020</td><td>10</td></tr>
<tr><td>2021</td><td>12</td></tr>
```
parses to
```json
[["North","2020","10"], ["2021","12"]]
```
— row 2 should be `["", "2021", "12"]` (blank row heading, year, value); instead "2021" lands
in the Region column and every subsequent column is shifted, silently corrupting the data a
sighted reader would see as three clean columns.

**What the standard requires:** the row-heading cell stays blank for every row after the
first one it covers; column entries keep their own columns.

**Classification:** **bug.** This is a data-corruption defect, not a formatting nuance — it
will misalign any table using `rowspan` for a repeated/implied row heading (a common
authoring pattern), and nothing downstream (formatter, editor, exporter) can recover the
lost alignment once parseTable has scrambled it.

**Test that would prove a fix:** a round-trip test parsing a DTBook table with `rowspan` on
a `<th>`/`<td>`, asserting the resulting `rows` array has a blank string in the spanned
column for every row after the first, and that `formatBlock`'s columnar output leaves that
row's row-heading area blank (guide-dot free, since it's a real blank not an omission) rather
than shifting later columns.

**Status: fixed.** `Emboss/tests/table_rowspan.test.mjs` (5 tests: the reproduction above;
rowspan in a `<thead>` header row spanning two head rows; rowspan and colspan together;
rowspan reaching past the table's last row, which must not throw; and `formatBlock`'s
columnar output staying column-aligned) — all fail against the pre-fix `parseTable` and pass
after it. BANA 11.5.3a is explicit about what a spanned row-heading area should hold ("leave
the area(s) where the inferred row heading(s) belong blank" — not a repeat), so `parseTable`
(`Emboss/input/parse.mjs`) now tracks `rowspan` the same way it already tracked `colspan`: a
shared `rowSpans` map, keyed by column, records how many further rows a spanned cell still
owes a blank to, for every row of the table (`<thead>` rows and body rows, in document
order — a header row's own rowspan is registered before any later head row is read, since a
`<th rowspan="2">` can span from the first head row into the second). Each later row's cells
are read column-by-column (`readSpannedRow`): a pending span inserts `''` and is consumed
before the next real `<th>`/`<td>` is placed, including a span that runs past the row's own
last cell (e.g. a rowspan on the final column) and one that reaches past the table's last
row (left unconsumed, harmlessly, when parsing ends). This applies the same blank-fill to any
rowspanned cell, row heading or ordinary column entry, since the alignment guarantee is a
data-integrity property, not one specific to row headings. `exportToNimasXml` round-trips the
result as an empty `<td></td>` (valid DTBook/NIMAS; confirmed with
`Emboss/scripts/daisy-validate.mjs`, 0 errors apart from the pre-existing suppressed empty
`<meta>` rule bug), and the editor's headers/rows arrays stay rectangular since every row
`readSpannedRow` returns is already padded to the table's column count.

---

## F-2 — A deliberately blank table row renders as guide dots in every column, not a blank line

**Rule:** BANA 11.5.4

> “Blank Lines. Follow print when blank lines are used to show row groupings, or to set off
> rows of column totals. (See Sample 11-6: Table with Blank Rows on page 11-30.)”

**What Emboss does:** `tableCellFill` (`Emboss/format/document.mjs:877-888`) treats *every*
empty cell the same way: an empty cell on a column's first line becomes guide dots
(`TABLE_GUIDE.repeat(cw)`), because that is the correct rendering for BANA 11.6.4's "blank
entry to be filled in". There is no separate code path for "this whole row is print's own
blank spacer row", so a row of all-empty cells comes out as a row of guide dots in every
column, not a blank braille line.

Reproduced (scratch experiment):
```js
rows: [['North','10'], ['South','20'], ['',''], ['UK Total','30']]
```
formats (BANA mode, width 30) as:
```
NORTH ""  10
SOUTH ""  20
""""""""  """
UK TOTAL  30
```
— the third line should be a genuinely blank line, matching Sample 11-6's own braille (a
truly empty line before "UK" in the standard's quoted braille), not a row of guide dots.

**What the standard requires:** a row print used purely as a visual spacer/grouping device
stays blank in braille — no guide dots, since there's nothing to "fill in".

**Classification:** **bug.** The blank-entry guide-dot rule (11.6.4) and the blank-row rule
(11.5.4) need different rendering, and Emboss's data model (a row is just an array of empty
strings) currently can't distinguish "print left this cell blank, fill it with dots" from
"print left this whole row blank on purpose, leave it blank" — some marker (e.g. treat a row
whose every cell is empty as a spacer row) is needed.

**Test that would prove a fix:** a table block with a row of all-empty strings between two
data rows; assert the formatted output for that row is `''` (or omitted), not a row of `"`
characters.

**Status update (18 Sep 2026, fixed).** `formatColumnar`/`traceColumnar`
(`Emboss/format/document.mjs`) now detect a data row whose every column is blank and render
it as one genuinely empty line, no guide dots — mirrored in `renderVerticalSection`/
`traceVerticalSection` (BANA §11.14 wide-table division, T4/F-18) for the same reason: it
uses the identical `tableCellFill` mechanism, so the same bug existed there. `tableCellFill`
itself is unchanged (still correct for a real blank *entry*, §11.6.4) — the new check happens
one level up, before a blank row's cells ever reach it.

The straightforward "every cell blank ⇒ blank line" rule, tried first, broke a passing gold
sample: BANA §11.9.1 **Skeleton tables** (Sample 11-17, `tests/gold/bana-formats-2016/
section-11/sample-11-17.json` — "only the five column headings are filled in print; all four
rows are entirely blank, intended for the reader to fill in their own interests") are a
table whose *every* row is blank by design, and 11.9.1.b is explicit that this case still
gets guide dots: "Indicate empty column entries with guide dots." Re-running `gold-run.mjs
--section section-11 --update-status` after the naive fix showed exactly this: sample-11-17's
own line-count mismatch got *worse* (differs by -7 instead of -3 lines), because all four
guide-dotted skeleton rows collapsed to blank lines. The final rule distinguishes the two
cases the same way 11.5.4 and 11.9.1.b themselves do — 11.5.4's "show row groupings, or set
off rows of totals" presumes *other* rows with real content to group/total; 11.9.1's skeleton
format is a table with no real content anywhere. So the blank-line treatment fires only when
`rows.some(row => row.some(cell => cell !== ''))` is true for the table as a whole (i.e. at
least one row has real content) — a fully-blank table keeps every row guide-dotted, as
11.9.1.b requires. This discriminator is applied identically in all four code paths.

**Test:** `Emboss/tests/table_rules.test.mjs` (F-2 describe block): a mixed table (real rows +
one all-blank spacer row) renders the spacer as `''`, both with a fake and the real liblouis
translator, cross-checked against Sample 11-06's own three-column shape; a row mixing a real
entry with one blank cell still guide-dots the blank cell (11.6.4, unaffected); and the
Sample-11-17 regression case (a table whose every row is blank) still guide-dots every row.
`formatBlock`/`traceBlock` parity is asserted for every case.

**Gold result:** `gold-run.mjs --section section-11 --update-status` — 2 match / 32 mismatch /
2 no-braille, identical to the pre-fix baseline (Sample 11-06 itself stays mismatch: its own
`braille.pageBreaks` and repeated-header-on-continuation-page convention are gaps this fix
does not touch — Emboss does not paginate mid-table at all; see F-13). No sample's diagnosis
text changed, confirming both that the fix introduced no regression and that no gold sample's
own *first differing line* happens to be a blank-row line specifically (later, still-mismatch
lines are not surfaced by the tool's own first-diff reporting) — the fix is proven by the
unit tests above and by the Sample-11-17 regression check, not by a gold status flip.

---

## F-3 — A table's transcriber's note and its caption render in the wrong order for real (parsed) documents

**Rule:** BANA 11.2.5f

> “Insert print notes pertaining to a table after the table title/label, but before the body
> of the table and any transcriber's notes.”

**What Emboss does:** `parseTable` (`Emboss/input/parse.mjs:2828-2846`) reads a table's
`<tabletn>`/`<caption>` children and pushes them as two **separate sibling blocks** ahead of
the `table` block, in the order **tabletn-note, then caption**, then the table itself.
`formatTable`'s own title-then-tabletn ordering (`Emboss/format/document.mjs:1085,1101,
1174-1181`) only fires when `.title`/`.tabletn` are set directly on the table *object*, which
the parser never does (verified — see F-4) — so for every real parsed document, the final
braille sequence is **[transcriber's note] [caption] [table body]**, exactly backwards from
the rule's "after the title/label, but before the body ... and any transcriber's notes".

**What the standard requires:** caption/title first, then the print note, then the table
body.

**Classification:** **bug.** It's a simple ordering defect in `parseTable`: swap which block
is pushed first (caption before tabletn-note) to match the rule, or merge both onto the table
object the way `nimas-export.mjs`'s `captionForTable` already does for *export* only
(`Emboss/input/nimas-export.mjs:1116-1122`) — that merge has no equivalent on the *format*
side at all.

**Test that would prove a fix:** parse a DTBook table with both `<caption>` and `<tabletn>`
present, run the resulting blocks through `formatBlock`/`formatDocument`, and assert the
caption's line(s) precede the transcriber's-note's line(s), which precede the table body.

**Status update (18 Sep 2026, fixed).** `parseTable` (`Emboss/input/parse.mjs`) now pushes the
`caption` block before the `tabletn` note block (previously the reverse) — a one-line
reordering of the two `targetBlocks.push(...)` calls, with a comment quoting 11.2.5f directly
at the point of the fix so a future edit can't silently re-invert it. `formatTable`'s own
title-then-tabletn ordering (this finding's original, dead, alternate fix path) is unchanged
and still never fires for a real parsed table (F-4 is the finding that tracks *that* gap
directly; this fix does not touch it) — the ordering guarantee for a real document now comes
entirely from the sibling-block push order in `parseTable`, matching how the parser already
worked for every other case.

**Test:** `Emboss/tests/table_rules.test.mjs` (F-3 describe block) — two tests: (1) parses a
DTBook `<table>` with both `<caption>` and `<tabletn>` and asserts `parseDtbook`'s own
`blocks` array orders `caption` before `note` before `table`; (2) runs the same document
through `formatDocument` in both BANA and UKAAF mode and asserts the caption's rendered line
precedes the transcriber's-note's rendered line, which precedes the table body's own rendered
line — proving the fix survives all the way to braille, not just the AST.

**Gold evidence:** none directly — the §11 gold schema (`tests/gold/bana-formats-2016/
section-11/README.md`) has no `tabletn` field at all (`print.notes` is transcription metadata
only, never fed into `gold-run.mjs`'s model; grep of every section-11 gold file confirms none
carries a table print-note alongside its caption), so no gold sample exercises this ordering.
Proven instead by the DTBook round-trip unit test above, per this finding's own original "Test
that would prove a fix" — consistent with this project's convention for a fix no worked
example happens to cover (cf. F-12's overhang branches, similarly synthetic-tested).

---

## F-4 — BANA's caption/heading distinction (7-5, not centred vs. centred) can never be reached for a real document

**Rules:** BANA 11.2.8b (partial), 11.3.1a, 11.3.1b, 11.3.1c, 11.3.1d, 11.3.2a

> “Use 7-5 margins. If the table has no title or heading, insert an identifier (e.g., figure,
> chart, table, etc.) enclosed in transcriber's note indicators. The caption follows the
> identifier on the same line.” (BANA 11.2.8b)
>
> “Center table headings.” (BANA 11.3.1a)

**What Emboss does:** BANA distinguishes a table **caption** (an explanatory blurb, 7-5
margins, never centred — 11.2.8b) from a table **heading** (the table's own title, e.g.
"Table 12: Populations" — centred, 11.3.1a, and centred + repeated with "(cont.)" if
sequentially numbered, 11.3.2a/b). Emboss's DTBook model has exactly one element, `<caption>`,
for both concepts, and:
- `formatTable`'s `formatTitle()` (`Emboss/format/document.mjs:1085-1089`) reads
  `block.title || block.caption` and always **centres** it (`centred(tStr, w)`) — the
  "heading" treatment.
- The standalone `'caption'` block formatter, `formatCaption`
  (`Emboss/format/document.mjs:677-685`), uses 7-5 margins and never centres — the "caption"
  treatment.
- `parseTable` (as in F-3) always emits a standalone `'caption'` block, **never** sets
  `.title`/`.caption` on the table object itself — grep of `parse.mjs`/`nimas-export.mjs`/
  `editor.mjs` for a table `.title` assignment finds none outside test fixtures
  (`bana_table_format.test.mjs`, `nimas_table_roundtrip.test.mjs`).

So for every real parsed or editor-authored table, a print caption/heading *always* takes the
7-5, non-centred `formatCaption` path — correct for a genuine caption, but wrong whenever the
print text was actually a "Table 12: Populations"-style **heading** that BANA wants centred
(11.3.1a) and, if numbered, repeated with "(cont.)" on continuation pages (11.3.2a/b, see
F-14). Conversely, `formatTable`'s centring code exists but is dead for real content — it
only ever fires in unit tests that construct a table object with `.title` set by hand. There
is also no code anywhere that inserts the "no title? add a figure/chart/table identifier in
TN brackets" fallback (second half of 11.2.8b), and none that positions a heading relative to
a box's top/bottom line (11.3.1b/c/d).

**What the standard requires:** the transcriber (or the source markup) must say which of the
two a given `<caption>` is, so Emboss can pick 7-5-not-centred vs. centred(+numbered-repeat).

**Classification:** **standard unclear as applied to Emboss's data model** — BANA's own text
is not ambiguous, but nothing in DTBook/NIMAS (or Emboss's own table block) currently records
which of the two a given caption is; that's a genuine open question (see
`standards-questions.md`, Q-1). Until that's answered, treat the "identifier-in-TN-brackets
for an untitled table" and "box-line-adjacent heading placement" sub-parts as **not done** (no
code at all), and the centre-vs-7-5 split as **partial** (one path or the other always fires,
never the "right" one on the strength of any actual signal).

**Test that would prove a fix:** once the caption-vs-heading distinction has a signal (e.g. a
`kind: 'heading' | 'caption'` field, or a class name), a test asserting a `kind:'heading'`
table title is centred (and, if `sequential:true`, repeated centred with "(cont.)" on a
continuation page — see F-14) while a `kind:'caption'` one uses 7-5 margins, not centred.

**Stage 4 gold evidence (BANA Formats 2016 §11 gold examples, 17 Sep 2026 —
`Emboss/scripts/gold-run.mjs`):** running the section's 36 worked examples confirms both
open sub-parts of this finding directly, without needing to guess a fix:
- *which of the two `print.caption` is* — `gold-run.mjs`'s own model builder has to guess
  from `print.printFeatures`'s English wording ("title" vs "caption") which BANA treatment
  applies, for exactly the reason this finding gives: the gold JSON schema (built from the
  same print-copy description a real DTBook import would carry) has no field that says so
  either. Sample 11-1 (`sample-11-01.json`, this section's own worked example of 11.2.8b)
  gets the caption path and reproduces the correct 6-4/no-centring shape once boxed/cased
  correctly (only the identifier-in-TN-brackets sub-rule and a wrap-point difference remain,
  the latter flagged uncertain in the gold data's own `uncertain` field).
- *box-adjacent heading placement, 11.3.1b/c/d* — Samples 11-4, 11-14, 11-22 (among others)
  put the box's top rule line ('7777...') as braille line 1, with the print title rendered
  *inside* the box on the next line; Emboss's model (heading pushed before/outside the box,
  the only placement the format code supports) instead puts the title first and the box
  after, e.g. for Sample 11-4:
  ```
  expected line 1: "7777777777777777777777777777777777777777"
  actual   line 1: "       ,TABLE #D4 ,M9IMUM ,VIABLE"
  ```
  confirming 11.3.1b ("may be before or after a top box line... follow print") has no
  code path for the "after/inside" case at all, and, separately, that the print schema this
  pilot's gold data uses doesn't record which one the original book chose — the same
  data-model gap this finding already names for BANA's own document model.

**Status update (17 Sep 2026, fixed — centre-vs-7-5 split and box-line placement):** the
centre/caption split and 11.3.1b/c/d box-line placement are now **done** (mechanism); the
11.2.8b identifier-in-TN-brackets fallback for an untitled table is still **not done** (no
gold sample or existing test exercises it, so nothing was built to avoid guessing its exact
wording).

- **Signal chosen (Q-1 option b):** a `class="bana-heading"` on DTBook's `<caption>` marks it
  as BANA's HEADING (11.3.1a) rather than its CAPTION (11.2.8) — `parseTable`
  (`Emboss/input/parse.mjs`) now reads it onto the table block itself as `block.title`
  (a string, or an array when the heading has more than one real hard print line — a `<br/>`
  inside the heading `<caption>`, e.g. a sequence number on its own line above the title
  proper, BANA Example 11-4 — kept separate by the new `getTextLines` helper; a plain
  caption's own `<br/>` stays cosmetic, unchanged via `getCleanText`). A second class token,
  `bana-heading-before-box`, sets `block.titlePosition:'before-box'` (BANA 11.3.1b's "before a
  top box line" case); its absence defaults to `'in-box'` ("after a top box line", right
  after it). `exportToNimasXml` writes the same class(es) back, `<br/>`-joining a multi-line
  title, so a save round-trips (`nimas_table_roundtrip.test.mjs` still passes unchanged for
  the plain-caption case; the new signal is proven by
  `Emboss/tests/table_heading_placement.test.mjs`). The editor's real `TableNode`
  (`Emboss/web/editor/editor.mjs`) gained matching `__title`/`__titlePosition` fields,
  get/set, `decorate()`, `exportJSON`/`importJSON`, and `appendBlock`/`buildModel` wiring —
  reviewed by hand against the identical pre-existing `getFormat`/`setFormat` pattern it
  mirrors; not separately unit-tested here because `editor.mjs` cannot be imported under
  plain Node (browser-style absolute imports resolved only by the app's own dev server) — a
  pre-existing constraint (see F-5), not something to paper over with a reimplemented mock.
- **Formatter (BANA 11.3.1a, centred; 11.3.1c/d, no blank line):** `formatTable`'s title
  helper now reads `block.title` **only** (`Emboss/format/document.mjs`, `tableTitleLines` —
  the `|| block.caption` fallback this finding reported is removed: a `block.caption` set
  directly on the table object, the legacy dual-use path, no longer takes the centred
  heading path — `table_heading_placement.test.mjs`'s regression test). Each print line of
  a multi-line title is centred (and wrapped if it alone overflows the width) independently,
  never joined to an adjacent line even when the two would fit together — gold-verified
  against BANA Example 11-4 ("Table 9.5" stays alone, above "Smoking Among Americans...")
  and BANA Sample 11-2 ("Table 11.1" stays alone, above "Summary Comparison...").
- **Box-line placement (11.3.1b/c/d):** `'in-box'` needed no new placement code at all —
  `formatBox`'s pre-existing leading-blank dedupe already collapses the table's own leading
  `''` against the still-empty box body, so a table's internal `formatTitle()` output lands
  right after the top box line with no blank, for free, once real content actually reaches
  it (this dead code path is exactly what this finding reported as unreachable). `'before-
  box'` is new: `formatBox` detects a table child with `title` + `titlePosition:'before-box'`,
  computes its title with the same `tableTitleLines` helper, and splices it in ahead of the
  top border with no blank of its own, rendering the table itself with that title suppressed
  (a shallow clone with `title: null`) so it isn't rendered twice. `traceBlock`/`traceTable`
  mirror both paths exactly (`table_heading_placement.test.mjs`'s parity test).
- **`gold-run.mjs` (Stage 4/5, print fields only, never `braille`):** `print.caption`'s own
  role (CAPTION vs HEADING) is no longer guessed from `printFeatures`'s English wording — it
  was found unreliable two ways during this fix (Sample 11-22's own text never says "title"/
  "centred" at all; Sample 11-08's says "caption" for a heading that its own gold braille
  shows centred). The signal used instead is BANA 11.2.8a's own definition of a caption as
  "usually a brief explanation": every one of this section's 19 captioned samples/examples
  was checked, and exactly one (`sample-11-01`, this section's own worked illustration of
  11.2.8) is a complete, terminally-punctuated sentence — every other captioned sample is a
  bare name/label with no terminal punctuation at all, and is treated as a HEADING. Box-line
  placement (`titlePosition`) has no print-field signal either — this finding's own gold
  evidence above already establishes that — so it defaults to `'in-box'`, the majority
  pattern actually found when this fix's own re-derivation checked every boxed captioned
  sample's braille (Samples 11-4, 11-9, 11-11, 11-14, 11-16, 11-21, 11-22, 11-24 are in-box;
  Samples 11-2, 11-5, 11-6, 11-26 are before-box) — a fixed default informed by that
  aggregate check, never read per-sample from that sample's own `braille` at model-build time.
- **Gold result:** `example-11-2` (no caption/title at all, the section's simplest boxed
  table) now **matches** exactly (previously mismatch; also needed the F-10 gutter fix
  below). Every other captioned/boxed sample's title/box placement is now structurally
  correct where checked by hand (e.g. Sample 11-4/11-22's box-then-heading order, Sample
  11-26's heading-then-box order, Sample 11-1's caption path down to a single unrelated
  wrap-point difference already flagged `uncertain` in the gold data) but most still report
  **mismatch**/**not-representable** overall because of *other*, separate, already-tracked
  gaps this fix did not touch: multi-row headers (F-12), bold/emphasis-passage indicators
  (not yet a tracked finding — the "`,,,…,'`" bold-caption punctuation seen in Samples 11-08/
  11-09/11-12/11-16 etc.), alternate wide-table formats (F-18), the numeric passage
  indicator (F-11), and (Sample 11-04) a column-squeeze/word-minimum-width limit that
  forces a listed fallback where BANA's own book fits the table columnar — newly observed
  while proving this fix, not previously in the map/findings; flagged for Paul rather than
  fixed here, out of this finding's scope. `status.json` records the current truth for all
  36 samples (`node Emboss/scripts/gold-run.mjs --update-status`).

---

## F-5 — `bana_table_editor_sync.test.mjs` tests its own reimplemented `TableNode`, not the shipped one, for caption/tabletn

**Rules:** related to BANA 11.2.5f, 11.2.7a, 11.2.7b, 11.2.8a (all marked "done (mechanism)"
in the map — this finding is about the *proof*, not the underlying capability)

**What Emboss does:** the real editor's `TableNode` (`Emboss/web/editor/editor.mjs:853-964`)
carries `__headers`/`__rows`/`__format` only (default format `'spatial'`) — there is no
caption or tabletn field, and `appendBlock`'s table branch (`editor.mjs:6574-6577`) and the
Lexical→AST `buildModel` table branch (`editor.mjs:2474-2486`) never read or write
`b.caption`/`b.title`/`b.tabletn`. `Emboss/tests/bana_table_editor_sync.test.mjs` defines its
**own** `TableNode` (lines 39-153) with `getCaption`/`setCaption`/`getTabletn`/`setTabletn`
and a default format of `'auto'` — neither of which the shipped node has — and its
assertions at lines 350-351, 423-424, 435-436, 492-493 ("TableNode caption matches",
"exportJSON tabletn preserved", etc.) all pass against that private mock. They currently
provide **zero** coverage of caption/tabletn behaviour in the real product, and would keep
passing even if the real `TableNode` were changed to add or break caption/tabletn support.

(In the real editor, a caption/tabletn is instead a separate sibling block using the
"Caption / Attribution" or "Note" block style, `editor.mjs:6107`/1630 — which *is* wired
correctly, per F-3/F-4's caveats — but it is not anchored to its table, and the table widget's
own UI has no caption/tabletn affordance or preview.)

**Classification:** **standard unclear? No — this one's a test-fidelity bug**, not a
standards question: the test's default format (`'auto'`) and field set don't match the node
it claims to test. Flagging it here rather than silently "fixing" the test, per the project's
own rule that findings are never fixed silently.

**Test that would prove a fix:** import the *real* `TableNode` from `editor.mjs` (or a
factored-out shared module) instead of redefining it in the test file; then either add
caption/tabletn fields to the real node (if Paul wants that authoring path) and re-assert, or
delete the caption/tabletn assertions and replace them with a test of the sibling-block path
that's actually shipped.

---

## F-6 — Guide dots never appear between numeric columns

**Rules:** BANA 11.6.1f (partial), B004 12 guide-dots (partial), B004 E ex1-guide-dots (partial)

> “Two or more guide dots lead the reader from one column to the next, and are inserted to
> fill out the width of a column with shorter entries or to designate blank spaces within the
> table.” (BANA 11.6.1f)
>
> “When using tabular form, guide dots are used to bridge the gap between columns, leaving a
> space at each end. Two cells is the minimum length.” (B004 12 guide-dots)

**What Emboss does:** `tableCellFill` (`Emboss/format/document.mjs:877-888`) branches on
`numPad`: when a column is numeric (`numPad >= 0`), it always returns plain space padding and
**never reaches the guide-dot branch**, regardless of how much of the column width is unused.

Reproduced with the *real* liblouis `en-ueb-g2` table, against B004 §12 Example 1's own
worked example (No./Square/Cube, 1-10): Emboss's Square/Cube columns come out
space-padded (`#A       #A`) where the standard's own quoted braille shows guide dots
bridging the same gap (`#a """" #a`). Reproduced again against Appendix E's own worked
example (Household Expenditure, once transposed and with its £ sign relocated to the column
headings so the table reaches columnar layout at all — see F-25): the Year 1/Year 2 numeric
columns come out fully space-padded, no guide dots, where the standard's own braille shows a
short guide-dot run stopping just short of each figure — same mechanism, same fix.

**What the standard requires:** guide dots bridge the gap after *any* short entry, headings
and figures alike; nothing in either standard exempts numeric columns.

**Classification:** **bug.** `tableCellFill`'s numeric branch needs to guide-dot a short
numeric entry exactly as the non-numeric branch does, while still place-value-padding entries
that participate in decimal/place-value alignment (see F-7 — the two need to compose, not
override each other).

**Test that would prove a fix:** a table with a numeric column of mixed widths (e.g. "1",
"100"), width wide enough to leave a multi-cell gap after the short entries; assert guide dots
(not blank padding) fill that gap, matching the mechanism already tested for text columns
(`table_no_word_division.test.mjs`).

**Status update (18 Sep 2026, fixed).** `tableCellFill`'s `numPad >= 0` branch
(`Emboss/format/document.mjs`) now computes the leftover gap AFTER the place-value `pre`
padding (`cw - len - pre.length`) and guide-dots it exactly like the non-numeric branch — one
blank cell then dots to the column edge, only when the gap is ≥ 3 cells (§11.6.1f's own "leave
one space… two or more guide dots"), never on a runover line or the table's last column
(unchanged pre-existing conditions). The leading `pre` padding itself (the place-value
alignment BANA 11.6.1d asks for) stays plain space, never guide-dotted — it positions digits/
decimals/commas, it isn't "the gap to the next column" §11.6.1f describes. This composes
correctly with F-7's own fix (a numeric column that ends up NOT place-value-aligned at all,
because `numericAlignApplies` says so, simply has `numPad` come back `-1` and takes the plain
text branch instead — the two fixes don't interact beyond that).

**Test:** `Emboss/tests/table_rules.test.mjs` (F-6 describe block) — a structural test with a
fake translator (a short entry is bridged by guide dots when its column has a next column and
≥3 cells of gap); a test against the *real* liblouis `en-ueb-g2` translator reproducing B004
§12 Example 1's own No./Square/Cube table (references/_text/B004.txt), asserting guide dots
appear on 9 of its 10 data rows (every row but "10/100/1000", where every entry already
reaches its own column's natural width); and a no-shortfall regression case (an entry that
already fills its column gets no dots). `formatBlock`/`traceBlock` parity is asserted
throughout. `Emboss/tests/table_vertical_division.test.mjs`'s own pre-existing numeric-column
fixture (`fiveColBlock`, Quiz One/Two/Three/Four scores) exercised `renderVerticalSection`'s
identical `tableCellFill` call and was found to encode the pre-fix (space-padded) behaviour;
its expected lines were updated to the correct guide-dotted form, citing this rule, per the
project's own "a test's expected result must come from the standard" rule.

**Gold evidence:** no BANA §11 gold sample happens to have a numeric column whose entries are
short enough, against a header-driven column width, to leave a guide-dot-worthy gap after a
figure (Sample 11-2's Total/Direct/Grants columns, the section's clearest numeric columns, are
all either exactly as wide as their header or filled edge-to-edge by their own decimal-
alignment padding — see F-7's gold evidence below); B004 §12 has no gold JSON at all (only
BANA §11/B004 §6-9/§11/Appendix E/G/J are covered — see `standards-testing.md`'s own pilot
scope). The fix is proven against B004's own primary source text directly instead, per this
project's precedent for a rule with no gold JSON to hand (`standards-map.md`'s own B004 rows
for 11.6.1f/B004 12 guide-dots/B004 E ex1-guide-dots were "proven wrong by a scratch
experiment" the same way before this fix existed).

---

## F-7 — Any numeric column is unconditionally right/place-value aligned, even a plain left-aligned label column

**Rules:** BANA 11.6.1d (partial), B004 12 alignment-left (partial), B004 12
alignment-numeric (partial)

> “Transcribe numerals aligned by place value in print as shown, i.e., placed to align
> digits, decimals, or commas.” (BANA 11.6.1d)
>
> “Column entries (including any column headings) are normally aligned on the left.”
> (B004 12 alignment-left)
>
> “However, if figures are to be worked on or summed etc. down a column, the figures may be
> aligned on the right (or their decimal points aligned).” (B004 12 alignment-numeric)

**What Emboss does:** `numericColumnPlan` (`Emboss/format/document.mjs:850-864`) is invoked
for *every* column whose entries are all numeric (`computeTableColumns`,
`Emboss/format/document.mjs:1031`) — there is no per-column opt-out, and no distinction
between "a sequential/ID column that happens to be all digits" (should stay left-aligned,
B004's default) and "a column of figures meant to be worked on or summed" (*may* be
right-aligned, B004's optional case).

Reproduced with the real liblouis `en-ueb-g2` table against B004 §12 Example 1: the "No."
column (1..10, a plain row label, never summed) comes out right-padded to align with "10"
(`" #A"` vs `"#AJ"`), though the standard's own braille keeps it flush left throughout
(`#a`, …, `#aj`, no leading space).

**What the standard requires:** left-alignment is the default even for a column of digits;
right/decimal alignment is an optional, transcriber-chosen treatment for figures specifically
meant to be compared/summed down the column.

**Classification:** **bug** (over-eager heuristic with no escape hatch) — B004's alignment
choice is explicitly a transcriber judgement call ("may"), and BANA 11.6.1d only mandates
alignment where numbers *are* place-value-sensitive (e.g. a currency/decimal column), not
every incidental sequence of digits.

**Test that would prove a fix:** a table with a purely sequential numeric first column (like
"No.") and a genuine decimal-figures column; assert the sequential column stays left-aligned
while the figures column aligns by place value — needs a way to mark a column as
"don't align" (e.g. per-column `align` hint, or simply excluding a single/first column by
convention) that the current one-size-fits-all detection doesn't offer.

**Status update (18 Sep 2026, fixed — decision below).** `numericColumnPlan` no longer runs
unconditionally for every all-numeric column. A new gate, `numericAlignApplies(colAlign,
rawColumnEntries)` (`Emboss/format/document.mjs`, used by both `computeTableColumns` and
`traceTable`'s mirrored copy), decides per column:

- **Default (no override):** place-value alignment applies only when at least one entry in
  the column actually carries a decimal point or thousands comma — read directly off BANA
  11.6.1d's own wording, "aligned by place value … to align digits, **decimals**, or
  **commas**": punctuation to line up, not any incidental run of bare digits. A
  punctuation-free numeric column (B004's own "No.", 1..10) defaults to left-adjusted
  (§11.6.1c / B004 12 alignment-left's "normally aligned on the left"); a column that carries
  real place-value punctuation (a comma or decimal point on at least one entry) defaults to
  place-value alignment (§11.6.1d).
- **Override:** `block.columnAlign` — an array parallel to the columns, `columnAlign[c]` one
  of `'left'` / `'right'` — is the "way to mark a column as 'don't align'" this finding asked
  for, in both directions: `'left'` forces left-adjustment even over a punctuated column;
  `'right'` forces place-value alignment even over a punctuation-free one (e.g. a plain
  sequential column the transcriber *does* want summed, B004 12 alignment-numeric's own "may").
  This lives on the document-model table block only for now — no DTBook markup or editor UI
  wires it yet (out of this fix's scope; a future finding, if a real document needs it).

**Why the punctuation test, not a smarter heuristic:** deciding "is this column meant to be
summed" from data shape alone is exactly the kind of guess `standards-testing.md`'s own rules
forbid (a test's expected result comes from the standard or a worked example, never a guess).
The punctuation test isn't a guess — it is BANA's own rule text naming its three alignment
targets ("digits, decimals, or commas") — and it is gold-verified in **both** directions from
two different worked examples that would otherwise conflict if alignment applied
unconditionally to every numeric column, or to none:
- **B004 §12 Example 1's own "No." column** (`references/_text/B004.txt`, 1..10, no comma or
  decimal anywhere) is flush left throughout in the book's own quoted braille (`#a` … `#aj`,
  no leading pad) — confirming the default must be OFF for punctuation-free digits.
- **BANA Sample 11-2's own "Total" column** (`tests/gold/bana-formats-2016/section-11/
  sample-11-02.json` — "981,712" / "1,001,676" / "1,054,503" / "1,128,432", real thousands
  commas) IS place-value aligned in the sample's own agreed braille: the shorter 7-character
  "981,712" (row 1) is preceded by 2 more leading cells than the 9-character "1,001,676" (row
  2), so every row's comma/digits line up — read directly off `braille.lines` rows 12-15 —
  confirming the default must stay ON for a punctuated column, i.e. this fix could not simply
  turn place-value alignment off everywhere either.

`traceTable`'s own numeric-plan computation (a duplicate of `computeTableColumns`'s, kept
separate so a trace can never call into the formatter) was updated identically, gating on the
same `numericAlignApplies` helper.

**Test:** `Emboss/tests/table_rules.test.mjs` (F-7 describe block) — B004 Example 1's "No."
column stays flush left (fake translator AND the real liblouis `en-ueb-g2` translator);
BANA Sample 11-2's "Total" column keeps its place-value alignment unchanged (real translator,
re-deriving the expected braille tokens rather than hand-guessing liblouis' own contraction);
and a `columnAlign` override test proving both directions (`'right'` forces alignment on a
punctuation-free column, `'left'` keeps a punctuated one flush). `formatBlock`/`traceBlock`
parity is asserted throughout.

**Gold result:** `gold-run.mjs --section section-11 --update-status` — 2 match / 32 mismatch /
2 no-braille, identical to the pre-fix baseline, note text unchanged for every sample. Sample
11-2 itself stays `mismatch` both before and after this fix (its first differing line is an
unrelated box/title-placement gap, F-4's own "before-box" vs "in-box" default — reached before
the diff ever gets to the Total/Direct/Grants data rows), so this fix could not have flipped
its overall status either way; it was Total's own column-by-column comparison above, checked
directly against `sample-11-02.json`'s `braille.lines`, that proves the default was correct
for that column, and nothing in the gold run regressed once the fix landed.

---

## F-8 — A blank column separation line is drawn under every column once *any* column has a heading

**Rule:** BANA 11.4.2c

> “Columns without a heading do not have a separation line.”

**What Emboss does:** `formatColumnar`'s heading block (`Emboss/format/document.mjs:1186-
1193`) is gated on `headers.some(h => h.trim())` for the *whole table* — once any column has
a non-blank heading, `tableSeparator()` draws a full-width dot-5/dot-25 line under **every**
column, including ones whose own heading is blank.

**What the standard requires:** a column with no heading gets no separation line under it —
i.e. the line should be per-column, not all-or-nothing.

**Classification:** **bug.** `tableSeparator` (`Emboss/format/document.mjs:832-838`) would
need to blank out the segment under any column whose own header is empty, rather than
drawing dots the full width unconditionally.

**Test that would prove a fix:** a 3-column table where only columns 1 and 3 have headings;
assert the rendered separation line has dots under columns 1 and 3 but blanks (not dots)
under column 2.

**Status update (18 Sep 2026, fixed).** `tableSeparator` (`Emboss/format/document.mjs`) now
takes a `hasHeader` array (one boolean per column, that column's own header text trimmed
non-empty) and builds a plain blank segment — the column's own width, not a dot run — for any
column whose `hasHeader` entry is false, exactly the convention `renderVerticalSection`/
`traceVerticalSection` (BANA §11.14 wide-table division) already used for their own
independently-built separator line (this fix reuses that same per-column boolean array, now
shared instead of duplicated). The blank segment never narrows the gutter after it (F-10/Q-7's
"ends in a plain space" rule — `hasHeader.map(Boolean)` doubles as `tableSeparator`'s own
`exactFill` array, so a headed column's dot run still narrows to a 1-cell gutter same as
before, while a headless column's blank segment keeps the full 2-cell gutter). All four call
sites (`formatColumnar`, `formatGroupedHeaderRows`'s own sub-column-tier separator line, and
their two `traceTable` mirrors) now pass `headers.map(h => !!h.trim())` (or the traced
equivalent, `headerTrs.map(h => !!h.s.trim())`) instead of nothing.

**Test:** `Emboss/tests/table_rules.test.mjs` (F-8 describe block) — a 3-column table
(`['Name', '', 'Score']`) asserts the separation line carries exactly 2 dot runs (one guide-
dot character each), not 3, in both BANA and UKAAF mode; two regression cases confirm an
every-column-headed table still gets one dot run per column, and a no-column-headed table
still draws no separation line at all (the pre-existing whole-table gate, unchanged for that
case). `formatBlock`/`traceBlock` parity is asserted throughout.

**Gold evidence:** none directly — every section-11 gold sample whose table reaches columnar
layout has a heading on every column it shows (including column 0, the row heading, which in
this section's worked examples always carries its own label such as "Region/Nation" or
"Fiscal Year" — the one shape 11.4.2c's rule text actually targets, a table with at least one
genuinely unheaded column, does not happen to occur among this section's 36 worked examples).
Proven by a synthetic test grounded directly in the rule text instead, per this project's
established precedent for a real but gold-uncovered case (cf. F-12's own overhang branches).
`gold-run.mjs --section section-11 --update-status` reports the unchanged 2 match / 32
mismatch / 2 no-braille baseline, confirming no regression on any sample this fix touches
(every one of them has all-headed columns, so `tableSeparator`'s new per-column branch is a
no-op for the whole section — its old and new code paths agree exactly wherever `hasHeader` is
all-true).

---

## F-9 — No enforced two-line cap on headings, row headings, or column entries

**Rules:** BANA 11.4.1 (partial), 11.5.1c (partial), 11.6.1

> “Column headings immediately precede their respective columns, and are limited to two
> lines.” (BANA 11.4.1)
>
> “Column entries are limited to two lines. Entries that cannot be limited to two lines
> require another specialized table format.” (BANA 11.6.1)

**What Emboss does:** `formatColumnar` wraps headers and entries with plain word-wrap
(`wrapCells`, `Emboss/format/document.mjs:1187,1197`) with no maximum line count and no
trigger to switch format when a cell needs 3+ lines — a very long heading or entry simply
keeps wrapping (3, 4, … lines) rather than the table falling back to a specialised format as
the rule requires.

**What the standard requires:** any heading/row-heading/entry that can't fit two lines forces
a different table format (§11.12+) — Emboss has no such height-driven trigger (only a
*width*-driven one, `fitColumnWidths`).

**Classification:** **bug/gap** — the width-based fallback trigger (`resolveTableLayout`,
`Emboss/format/document.mjs:1052-1063`) has no height-based counterpart at all.

**Test that would prove a fix:** a table with one entry long enough to need 3 wrapped lines
at the given width; assert the table falls back to listed/paragraph format instead of
rendering a 3-line cell.

---

## F-10 — The inter-column gutter is a hardcoded constant; the "one blank cell" option never fires

**Rules:** BANA 11.7.1k, 11.7.1l

> “One blank cell may be used between columns of numbers when the column headings are no
> wider than the longest entry in the column. This should be done only when it would result
> in the table appearing on one page.” (BANA 11.7.1k)

**What Emboss does:** `computeTableColumns` (`Emboss/format/document.mjs:1042`):
`const gutter = 2;` — an unconditional constant used by every table, with no conditional
1-cell mode.

**What the standard requires:** the transcriber may narrow the gutter to one cell between
numeric columns specifically to rescue a table that would otherwise not fit one page.

**Classification:** **not done** (missing feature, not obviously a bug — BANA frames it as
optional, "when it would result in the table appearing on one page", which needs the same
sort of trial-then-fallback logic `fitColumnWidths` already does for column width).

**Test that would prove a fix:** a table that doesn't fit at gutter=2 but would fit at
gutter=1 with all-numeric columns whose headers are no wider than their data; assert Emboss
renders it columnar at 1-cell gutter rather than falling back to listed/paragraph.

**Stage 4 gold evidence (BANA Formats 2016 §11 gold examples, 17 Sep 2026):** this finding's
own hardcoded-constant framing is confirmed by the *simplest* columnar table in the whole
gold set, Example 11-2 (`example-11-2.json`, a plain 2-column, single-row-header, no-title,
no-box-omission table — deliberately chosen here because it has none of §11's other
confounds: no rowspan/multi-row header (F-12), no title/box-adjacency ambiguity (F-4), no
alternate wide-table format (F-18)). Once the gold corpus's own letter-case convention is
normalised (F-24) and the isolated-sample leading-blank line is accounted for (both handled
by `gold-run.mjs`, not by changing what's expected), the *only* remaining difference is the
gutter itself:
```
expected: "3333333 "33333333333333333      (1 blank cell after the 8-wide column-1 rule)
actual:   "3333333  "33333333333333333     (2 blank cells — computeTableColumns' gutter=2)
```
and identically for the two data rows whose column-1 entry ("mosquito", "elephant") exactly
fills the natural column width (8 cells) with no fill needed:
```
expected: "mosquito #cj "ds"          (1 blank cell)
actual:   "MOSQUITO  #CJ "DS"         (2 blank cells)
```
while a *short* entry that column ("gorilla", 7 cells, needing 1 cell of fill) matches
exactly on both sides (1 fill cell + 2 gutter cells = 3 blank cells either way) — so the
discrepancy is specific to the exactly-fills-its-column case, not a uniform "gutter should be
1, not 2." This is a narrower, more specific observation than 11.7.1k/l's already-documented
"optional 1-cell gutter for numeric columns to rescue a page-fit problem" (this table fits
easily at gutter=2, so 11.7.1k's own trigger condition doesn't apply) — recorded here as a
**new, distinct sub-finding, classification "standard unclear"**: it isn't yet clear from the
rule text alone whether BANA's "two blank cells" (11.2.5b) is meant to be measured from the
*column's nominal width* (Emboss's reading — always 2 more cells after the widest possible
entry) or is satisfied once an entry reaches the column's own edge with no room left for a
guide-dot run (which would explain a 1-cell reduction specifically when fill is otherwise
zero). Needs a rule re-read or a transcriber's confirmation before treating this as a bug —
see `standards-questions.md` Q-7.

**Status update (17 Sep 2026, fixed — Paul's decision, `EMBOSS-TASKS.md` T7, 17 Sep 2026:
"follow the book's examples — one cell between columns where an entry exactly fills its
column; two otherwise").** `computeTableColumns`'s `gutter = 2` is unchanged (still the
nominal budget `fitColumnWidths`/page-fit decisions reserve — this is a *rendering-time*
narrowing, not a different page-fit rule; 11.7.1k/l's own optional numeric-column 1-cell
mode, F-11, remains separately not done). `formatColumnar`/`traceColumnar`
(`Emboss/format/document.mjs`) now compute the gutter *per column boundary, per line* via a
new `colGutter`/`joinTableRow` pair, narrowing to one cell wherever that column's fully
padded content on that line does not end in a plain space — covering three cases the
re-derivation below found necessary:
- the *entry-reaches-the-edge* case this finding already gives (`tableCellFill` returns
  `{pre:'', post:''}`, len ≥ column width) — BANA Example 11-2's "mosquito"/"elephant".
- a *guide-dot run* that reaches the column's edge to bridge a short entry
  (`tableCellFill`'s guide-dot branch — `post` non-empty but ending in a dot, not a space)
  narrows exactly the same way, found only once BANA Sample 11-1 was checked (`,daily
  """"""""" #e4ci.0` — one blank cell between the dot run and the number, not two): the
  discriminator is "ends in a plain space", not "no fill at all".
- the header separation line (`tableSeparator`) always exactly fills its own column by
  construction (a dot-run), so its gap is now hardcoded to one cell rather than the
  parameterised `gutter` — gold-verified against BANA Example 11-2's own line
  (`"3333333 "33333333333333333`).

Excluded, on purpose, after this narrowing broke a passing, previously-fixed regression
test (`table_rowspan.test.mjs`, F-1): a wholly **blank** cell (BANA §11.6.4's own "blank
space" guide-dot convention, `tableCellFill`'s `!len` branch) never narrows, even though its
guide-dot fill (on the first line) also reaches the column's edge — a deliberate full-width
placeholder needs to keep lining up with the un-blank rows around it (a rowspanned row's
blank row-heading area, for instance), and no gold sample gives evidence either way for this
specific sub-case, so it was left at the standard's own nominal two cells rather than
guessed. Header text narrows the same way as a data entry when it happens to be the widest
thing in its column — a synthetic case where the header alone sets the column width
(`bana_table_format.test.mjs` Test 1's "NAME"/"AGE") narrows to one; that pre-existing
test's fixed-spacing assertions were updated to match, citing this rule (a test's expected
result must come from the standard, never from Emboss's old output).

**Gold result:** Example 11-2 now **matches** exactly (together with the F-4 fix, its only
other difference). `standards-questions.md` Q-7 is answered by Paul's decision above; left
in place as a record of the question, with this note added.
`Emboss/tests/table_heading_placement.test.mjs` proves both narrowing cases (entry- and
guide-dot-fill), the always-one-cell separator line, and formatBlock/traceBlock parity.

---

## F-11 — No numeric passage indicator support

**Rule:** BANA 11.7.1j

> “Tables consisting solely of numbers in the row headings and column entries may use the
> numeric passage indicator to save space. … This is done only when it results in the table
> appearing on one page.”

**What Emboss does:** grep of `Emboss/format/document.mjs` for "numeric passage" (or the
UEB `#`/apostrophe passage-indicator/terminator convention in a table context) finds
nothing; `computeTableColumns`/`formatColumnar` never emit one.

**Classification:** **not done** (missing feature — BANA Example 11-9 cannot be reproduced
at all today).

**Test that would prove a fix:** an all-numeric table that only fits one page with the
passage indicator applied; assert the rendered table opens with `.=#`/closes with `.=#'`
(the sample's own convention) around each numeric row/column run, with the explanatory TN
BANA 11.7.1j requires.

---

## F-12 — No second heading tier: complex (sub-column) headings, row subheadings, and multi-entry listed headings all need one

**Rules:** BANA 11.4.3, 11.4.3a, 11.4.3b, 11.4.3c, 11.5.1b, 11.16.1g

> “Complex Tables with Column and Sub-column Headings. The primary column heading is
> left-justified over the secondary sub-column heading.” (BANA 11.4.3)
>
> “When there are row subheadings, use 1-5 margins for the primary row headings and 3-5
> margins for the secondary row headings.” (BANA 11.5.1b)

**What Emboss does:** `block.headers` is a flat 1-D array and `block.rows` a flat 2-D array
in every code path (`computeTableColumns`, `Emboss/format/document.mjs:998-1046`;
`parseTable`, `Emboss/input/parse.mjs:2828-2955`; the editor's `TableNode`,
`Emboss/web/editor/editor.mjs:853-964`) — there is no representation anywhere for a second
heading tier, whether that's BANA's primary/secondary *column* headings (11.4.3), primary/
secondary *row* headings (11.5.1b), or the listed format's "column heading with multiple
entries" case (11.16.1g).

**Classification:** **not done** (structural data-model gap — all three symptoms share one
root cause, so one design decision fixes all three).

**Test that would prove a fix:** would need a design for how a second tier is represented
(e.g. `headers: [{text, sub:[...]}, ...]`) before a test can assert anything; flag for Paul
as a design decision, not a small patch.

**Stage 4 gold evidence (BANA Formats 2016 §11 gold examples, 17 Sep 2026):** four of this
section's 27 numbered samples have a genuine two-row, column-spanning header in `print` —
Sample 11-2 (Complex Table, primary heading "In Millions of Dollars" over Total/Direct/
Grants), Sample 11-9 (Table with Dashes, "Semiannual averages" over 1st/2nd half), Sample
11-13 (a French table, "article défini" over masc./fém. singular/plural), and Sample 11-15
(One Cell between Columns, same shape as 11-2's table). `Emboss/scripts/gold-run.mjs` cannot
build any of the four faithfully — `computeTableColumns`'s single flat `headers` row (as this
finding says) forces dropping the entire spanning row, e.g. Sample 11-2's primary heading
"Fiscal Year | In Millions of Dollars |  | " is lost outright, leaving only "Fiscal Year /
Total / Direct / Grants" — so all four are recorded in `status.json` as
**`not-representable`** rather than `mismatch` (the model itself loses real print content,
not just a formatting choice). This is the single largest concrete, rule-numbered confirmation
of this finding's root cause found in the pilot.

**Status update (17 Sep 2026, fixed — the column-heading half only: BANA 11.4.3/a/b/c):**
the second, primary column-heading tier is now **done**. Row subheadings (11.5.1b) and the
listed format's multi-entry column heading (11.16.1g) are unchanged — **still not done** —
they were never in this fix's scope (a different data-model shape: row headings run down
the first column, not across a header row) and remain open for a future finding.

- **Data model:** `block.headers` stays the flat sub-column/single-tier row (unchanged
  shape); `block.headerGroups = [{ text, from, to }]` (0-based inclusive column span) is new,
  carrying the primary heading. A column with a single-tier heading beside a group (no
  sub-heading of its own, e.g. Sample 11-2's "Fiscal Year" beside Total/Direct/Grants) has no
  entry in `headerGroups` at all — this is how the data itself records "no second tier here".
- **DTBook round trip:** a two-row `<thead>` of nothing but `<th>` — a `colspan > 1` cell is a
  group's primary heading over its sub-columns; a `rowspan > 1` cell is a single-tier heading
  spanning both header rows (no group) — is read by `parseTable`
  (`Emboss/input/parse.mjs`, the new `isTwoTierHeader` branch) into this shape, and written
  back identically by `exportToNimasXml`'s table case (`Emboss/input/nimas-export.mjs`) —
  proven round-trip by `table_spanning_headers.test.mjs`. Two safeguards keep this narrow:
  (a) it only fires when `<thead>` has *exactly* two rows and *both* are pure `<th>` — a
  single-row `<thead>` (the overwhelming majority of tables) is completely untouched; (b) it
  only fires when row 1 actually carries a `colspan`/`rowspan` signal — two plain `<th>` rows
  with neither (no hierarchy signalled at all) keep the pre-existing behaviour (second row
  leads the body), preserving `corpus_word_losses.test.mjs`'s own "every `<thead>` row is
  kept" case unchanged. `table_rowspan.test.mjs`'s own two-`<thead>`-row test (which predates
  this fix and asserted the *old*, F-1-era behaviour — the second row read as a data row) was
  updated to assert the new, correct `headerGroups` reading instead, citing this rule, per the
  project's own "change only when a quoted rule shows the old expectation was wrong" rule.
  `Emboss/input/load-audit.mjs`'s word-loss counter was also extended to scan
  `headerGroups[].text` — it did not know to look there, and without this fix a table with a
  real two-tier header (e.g. `Emboss/tests/nimas_samples/9780076996285NIMAS.xml`'s "Unboxed
  Plant" over Day/Plant Height/Observations) would have reported its own primary heading as a
  lost word purely because of *where* this fix now stores it, not because anything was
  actually dropped.
- **Formatter (11.4.3a/b/c) — gold-derived, not guessed:** `formatGroupedHeaderRows`/
  `traceGroupedHeaderRows` (`Emboss/format/document.mjs`) render, in order: the primary row
  (blank under any ungrouped column), the primary row's own separation line (one continuous
  dot run the width of the group's own span, `groupSpanWidth` — blank under ungrouped
  columns, 11.4.2c read as "without a heading AT THAT TIER"), an "extra" row block only when
  some ungrouped column's own heading needs more lines than the sub-column row does, the
  sub-column row itself (every column, grouped or not — an ungrouped column's own heading is
  bottom-aligned against this row), and finally the pre-existing per-column
  `tableSeparator` call, unchanged. This exact row order/alignment was derived by reading
  11.4.3 together with **all four** of this section's own two-tier-header gold samples at
  once (11-2, 11-9, 11-13, 11-15) — not from any one of them alone — because only Sample 11-2
  exercises the "extra row" case (its "Fiscal Year" doesn't fit its own 7-cell column and
  wraps to "Fiscal"/"Year"; the other three samples' single-tier headings fit on one line and
  sit directly on the sub-column row). `computeTableColumns`/`traceTable` fold a group's own
  width need into the natural column widths *before* squeezing (11.4.3a's "wider than all of
  the sub-column headings" clause) — using the primary heading's **widest word**, not its
  whole unwrapped text (so it can still wrap like any other heading, §11.4.1, and does not
  force a table wider than necessary) — and `resolveTableLayout`'s `'auto'`-mode pre-check
  (which normally only attempts a squeeze when the table already fits unsqueezed) now also
  attempts it whenever `headerGroups` is present, since a single-tier column's own heading
  needing to wrap (again, Sample 11-2's "Fiscal Year") would otherwise reject the table before
  the squeeze ever got a chance to fit it.
- **Open question for Paul (11.4.3a's own widening clause is NOT gold-verified):** none of
  this section's four two-tier samples has a primary heading actually wider than its own
  span, so nothing here confirms *where* the extra width should go if it were. This fix adds
  the shortfall to the span's **last** sub-column (a documented, defensible-but-unverified
  choice — see the map's `standards-map.md` row for 11.4.3a); an equally plausible reading is
  that the primary heading simply wraps onto a second line instead, the same as any other
  column heading (§11.4.1), leaving the span's width untouched. No gold example in this
  section settles it either way.
- **Gold result:** all four of this section's genuine two-tier-header samples — 11-2, 11-9,
  11-13, 11-15 — move from `status.json`'s **`not-representable`** (this finding's own root
  cause: real print content silently dropped) to **`mismatch`** (the header block itself is
  now built and rendered correctly — verified character-for-character against each sample's
  own gold `braille.lines` in isolation, `table_spanning_headers.test.mjs`'s test 3 — but the
  *rest* of each sample's braille still differs for reasons this finding never claimed to fix):
  Sample 11-2's own title-before-box default and a title wrap-point difference (F-4's own
  documented minority-case default, unrelated to this fix); Sample 11-9's numeric column-gutter
  interaction after a guide-dot dash entry (F-10's own hardcoded 2-cell gutter, reproducible
  with no `headerGroups` involved at all) plus an un-modelled transcriber's-note continuation
  marker and a title wrap-point difference; Sample 11-13's foreign-language passage (this
  section's own sample is Portuguese vocabulary mislabelled "French" in print, §11.7 — Emboss's
  gold-run model has no signal for "translate this passage uncontracted" nor for silently
  dropping the print periods §11.7.1.c/e/f allows a transcriber to omit); and Sample 11-15's
  own worked illustration of BANA 11.7.1k (a numeric table fits one page only with the
  optional one-blank-cell gutter, `standards-map.md`'s own row for 11.7.1k already recording
  `computeTableColumns`'s hardcoded `gutter = 2` as "not done" — without it, 11-15 cannot reach
  columnar layout at width 40 at all and falls to the listed fallback). None of these four are
  new findings; all were already visible in the map/other findings before this fix, and none
  is fixed here. `status.json` records the current truth for all 36 samples
  (`node Emboss/scripts/gold-run.mjs --update-status`); no previously-`match`ing sample
  regressed.

**Status update (17 Sep 2026, Change 2 — Paul's decision, `EMBOSS-TASKS.md` T9's own note
on §11.4.3a, 17 Sep 2026): the "open question" directly above is now settled — not by
guessing where the extra width goes, but by not widening the sub-columns at all when it can
be avoided.** BANA 11.4.3a: "The separation line is the width of the primary heading when
it is wider than all of the sub-column headings." Paul's reading: a primary heading wider
than its own span OVERHANGS unwrapped, without touching the sub-columns beneath, whenever
the whole table still fits the line with that overhang; the separation line then takes the
heading's own (full, unwrapped) width; the next column starts two cells after the wider of
the heading and its span. Only when the overhang itself would not fit the page does the
heading wrap within the span — the behaviour this finding originally shipped, unchanged,
still widening the span only to the heading's own widest word (never its whole unwrapped
text — words are never divided, A27b/§1.10.1).

- **Where the decision is made:** `computeTableColumns` (`Emboss/format/document.mjs`)
  tries the overhang first for each group whose heading is wider than its span (measured
  PRE-squeeze, against the table's natural column widths): if the running total of every
  column's natural width, plus every overhang already granted to an earlier group, plus
  this one, still fits the line, the group is flagged `.overhang = true` and the shortfall
  is recorded in a new `overhangWidths[]` array (rendering-only padding, keyed by the
  group's last column) — `colWidths` itself is left untouched. Otherwise the pre-existing
  wrap-in-span widening runs exactly as before.
- **Rendering:** `formatGroupedHeaderRows`/`traceGroupedHeaderRows` render an `.overhang`
  group's heading as a single unwrapped line at its own full width (never wrapped via
  `wrapCells`), and its separation line at that same width. A new pair of small helpers,
  `padOverhang`/`overhangExactFill`, append `overhangWidths`' blank cells (never
  guide-dotted — the same "this is layout padding, not column content" reasoning as
  11.6.1g's own runover rule) after the group's last sub-column on every OTHER row of the
  table too (the extra-row block, the sub-column heading row, and every data row,
  `formatColumnar`'s general row loop), and force the standard 2-cell gutter there instead
  of F-10/Q-7's narrowed 1-cell gutter — together giving exactly "two cells after the wider
  of the heading and its span." Both helpers are no-ops (return their input unchanged)
  whenever no column has an overhang, so they are called unconditionally from the shared
  row-rendering code without needing an `if (headerGroups.length)` guard at each call site.
- **Not gold-verified, same as before:** no sample in this section's gold set has a primary
  heading wider than its own span (this finding's own earlier text, above), so neither the
  overhang branch nor the (unchanged) wrap branch is proven against a worked BANA example —
  both are tested directly against the rule text instead
  (`table_heading_placement.test.mjs`'s two new 11.4.3a tests, plus a trace-parity test),
  and `standards-questions.md` carries a new question to a transcriber on which reading is
  correct, since 11.4.3a's own wording supports either.
- **Interaction with T9 (auto-squeeze, this same file's F-18 status update below):** the
  overhang decision runs BEFORE `fitColumnWidths`' squeeze and never widens `colWidths`, so
  by construction an overhang is only ever granted when the table already fits unsqueezed —
  a squeeze is never asked to find room for an overhang it doesn't know about. No gold
  sample exercises a two-tier header AND the auto-squeeze at once, so this interaction is
  reasoned from the code, not gold-proven.
- **Gold result:** unchanged — this fix touches only the (gold-unexercised) case where a
  primary heading is wider than its span; `node Emboss/scripts/gold-run.mjs --section
  section-11 --update-status` (17 Sep 2026) shows no sample's status changed because of
  Change 2 specifically (T9's own, separate effect on 5 samples is recorded below, F-18).

---

## F-13 — No table-aware pagination: headings never repeat, "(cont.)" never appears, tables/rows can split anywhere

**Rules:** BANA 11.2.6c, 11.2.6d, 11.2.6e, 11.3.2b, 11.3.2c, 11.4.4a, 11.4.4b, 11.4.4c

> “Place tables on a single braille page whenever possible.” (BANA 11.2.6c)
>
> “When a sequentially numbered table is longer than one braille page, repeat and center the
> table number on line 25 of each succeeding braille page, followed by "(cont.)".”
> (BANA 11.3.2b)
>
> “Repeat the column headings (with accompanying separation lines) at the top of each
> succeeding page.” (BANA 11.4.4a)

**What Emboss does:** `page.mjs`'s `assemble()` (`Emboss/format/page.mjs:140-256`) chunks
formatted lines into pages purely by line count; the only table-aware pagination hook in the
whole codebase is `keepGroupIndex`/`applyPageBoundaries`
(`Emboss/format/document.mjs:2206-2312`), used *exclusively* by `formatListed`'s per-row
keep-together groups (`Emboss/format/document.mjs:1146-1164`, proven by
`listed_row_keep_together.test.mjs`). A **columnar** table has none of: a whole-table
keep-on-one-page preference, a break-at-a-row-boundary preference, the 3-cells-before-page-
number rule, repeated column headings on a continuation page, or the numbered-table "(cont.)"
notation on line 25.

**Classification:** **not done** across the board — this is the single biggest pagination
gap the pilot found; BANA Example 11-5 (a worked example of 11.3.2b) cannot be reproduced at
all today.

**Test that would prove a fix:** a columnar table long enough to force a page break; assert
the column headings (with separation line) repeat at the top of the continuation page, with a
blank line under the running head per 11.4.4b.

---

## F-14 — No source-citation formatting for tables

**Rule:** BANA 11.2.5g

> “Place source citations on the next line after completion of the table blocked four cells
> to the right of the material it follows.”

**What Emboss does:** grep of `document.mjs`/`parse.mjs`/`nimas-export.mjs` for a table
"citation"/"source" concept finds nothing but an unrelated document-metadata field
(`Emboss/input/parse.mjs:3265`). BANA Sample 11-9's source citation, blocked below the table,
has no supporting block type or margin logic at all.

**Classification:** **not done** (missing feature).

**Test that would prove a fix:** a table followed by a source-citation block; assert it's
blocked 4 cells right of the material it follows, with the blank-line rule after a bottom box
line (11.2.5g's own qualifier) respected.

---

## F-15 — No structural support for a key-list transcriber's note (nested 7-5/1-3/cell-5 margins in one note)

**Rules:** BANA 11.8.1b, 11.8.1c, 11.8.1d, 11.8.2a, 11.8.2c, 11.8.2d, 11.8.2e, 11.8.2h,
11.8.2i, 11.8.2j, 11.8.2k, 11.8.2l, 11.8.2m, 11.8.2n, 11.8.2o

> “The transcriber's note has multiple elements. Use 7-5 margins for the note and 1-3
> margins for the key list. Cell-5 headings may also be part of the transcriber's note.”
> (BANA 11.8.2a)

**What Emboss does:** `formatTranscriberNote` (`Emboss/format/document.mjs:600-630`) wraps a
whole TN at **one** margin pair. There is no code path that nests a 1-3 key-item list, or
cell-5 "Column headings"/"Row headings" group headings, inside a single TN frame the way
BANA's key-list note requires, and no validator for the key-item constraints (2-3 cells;
no shortform/contraction clash; a dot-3/6 letter, except recognised ISO abbreviations —
11.8.1b/c/d).

**Classification:** **not done** — the whole keying feature (device a key, list it in a
structured note) is unimplemented; BANA Sample 11-16 cannot be reproduced.

**Test that would prove a fix:** would need a compound-TN rendering primitive (a TN body at
7-5 containing a nested list at 1-3, with cell-5 group headers) before any of these 15 rules
becomes individually testable; flag for Paul as a design decision.

---

## F-16 — No ditto-mark handling

**Rules:** BANA 11.6.6, 11.6.6a, 11.6.6b

> “Dittos. The ditto mark (dots 5, 2) is left-adjusted in the appropriate column.”

**What Emboss does:** grep of `document.mjs`/`parse.mjs`/`nimas-export.mjs`/`editor.mjs` for
"ditto" finds no matches anywhere. A literal ditto glyph typed into a cell would just
translate as ordinary text — no left-adjustment special case, no "never at the top of a
continuation page, repeat the term instead" guard, and no auto-listing on the Special Symbols
page.

**Classification:** **not done** (missing feature; BANA Sample 11-12 cannot be reproduced).

**Test that would prove a fix:** a table using a ditto mark whose column happens to fall at
the top of a forced page break; assert the term is repeated instead of a lone ditto opening
the page.

**Stage 4 gold evidence (BANA Formats 2016 §11 gold examples, 17 Sep 2026):** confirmed
directly — Sample 11-12's own print copy already uses a literal typographic ditto mark
(`"`) in several cells (`print.rows`, e.g. `["0.90", "\"", "\""]`, repeating the row above's
"Surplus"/"Fall"). `Emboss/scripts/gold-run.mjs --sample sample-11-12` feeds that `"`
straight through `formatTable` with no ditto-specific handling at all: it is translated as
an ordinary print quotation mark by liblouis, not converted to BANA's dedicated dots-5,2
ditto sign — confirming this finding names the right root cause (no code path recognises a
ditto, print or braille) rather than the narrower "repeated words aren't collapsed" reading.

---

## F-17 — No retained horizontal line within a table (e.g. for a total row)

**Rules:** BANA 11.6.2, 11.6.2a, 11.6.2b

> “Horizontal Lines. Omit horizontal lines within a table unless they are referred to in
> print or used to separate a total from a preceding list of numbers.”

**What Emboss does:** there is no UEB horizontal-line-mode symbol generation anywhere in the
table code; `tableSeparator` (`Emboss/format/document.mjs:832-838`) is the heading/entry
separation line only, unrelated to a body rule separating data from a total.

**Classification:** **not done** (missing feature; BANA Sample 11-8, Column Totals, cannot
be reproduced).

**Test that would prove a fix:** a table whose last row is a total, print showing a rule
above it; assert Emboss renders the UEB horizontal-line-mode symbol across that column's
width, per 11.6.2b.

---

## F-18 — Only one of BANA's six wide-table alternate formats exists: Listed. Facing pages, vertical division, interchange, linear, and stairstep are entirely unimplemented

**Rules:** BANA 11.12.1 (partial), 11.12.2, the whole 11.13.1 cluster (a-m), the whole
11.14.1 cluster (a-c), the whole 11.17.1 cluster (a-k), the whole 11.18.1 cluster
(a-l), B004 E ex2-split-facing-pages, B004 E ex2-align-rows, B004 E ex2-extend-guidelines
— 48 rows in the map. (BANA 11.15.1, column/row interchange, and B004 E ex1-transpose
[Appendix E's own transposed-table example] are a closely related gap but are classified
"out of scope" rather than "not done" — see their own rows in the map: a transcriber can
achieve the same braille by pre-transposing their own data before typing it in, with no
Emboss-specific support needed either way. See F-25 for what happens when a transcriber
*does* pre-transpose Appendix E's own worked example.)

> “When choosing an alternate table format, keep in mind that readability is more important
> than space. Select a format that best supports the table content along with student
> activities.” (BANA 11.12.2)

**What Emboss does:** `resolveTableLayout` (`Emboss/format/document.mjs:1052-1063`)
recognises exactly three layouts — `columnar`, `listed`, `paragraph` — and a too-wide table
*always* becomes `listed` in BANA mode (or `paragraph` in UKAAF mode); grep of
`document.mjs`/`editor.mjs` for "facing"/"vertical"/"interchang"/"linear"/"stairstep" (table
sense) finds no matches. `formatListed` itself (§11.16) is fully and solidly implemented (see
the map's BANA 11.16.1 rows, and `bana_table_format.test.mjs`/`listed_row_keep_together.
test.mjs`/`nimas_table_roundtrip.test.mjs`), so this is not a gap in *that* format — it's the
complete absence of the other five. Confirmed again against UKAAF B004 Appendix E's own
facing-pages worked example (Table 3: Weather Forecast for Somewhere City, 7 columns x 5
rows): `tableLayout()` reports `paragraph` for it (UKAAF's over-wide fallback), never a
facing-page split.

**What the standard requires:** BANA gives the transcriber six named alternate formats for a
wide table and asks them to pick the one that best serves the content (11.12.2); Emboss
offers exactly one, automatically, with no way to choose facing pages, vertical division,
column/row interchange, linear, or stairstep even when one of those would clearly suit the
content better (e.g. a table with only 3-4 columns and short entries, ideal for stairstep,
still becomes Listed).

**Classification:** **not done** — by far the largest completeness gap the pilot found
(45 of the map's 111 partial/not-done rows). Whether it's worth building all five, some, or
none is a scope decision for Paul, not something to guess at here.

**Test that would prove a fix:** for whichever alternate(s) Paul decides to build, a table
whose print original uses that named format (BANA Samples 11-21 through 11-27 give one each)
diffed character-for-character against the standard's own quoted braille.

**Stage 4 gold evidence (BANA Formats 2016 §11 gold examples, 17 Sep 2026):** ran exactly
that test for Samples 11-21 through 11-27 via `Emboss/scripts/gold-run.mjs`. Every one of
them still fits Emboss's 40-cell columnar layout once each print table is modelled on its
own (the pilot's isolated-sample construction can't reproduce facing-page splitting or a
book's specific alternate-format choice; see also F-4 on box/title placement), so `auto`
simply renders them columnar — none reach any of the five missing alternate formats at all.
Samples 11-25 (Linear) and 11-23 (Interchanged Columns and Rows) additionally happen to
exceed 40 cells once headers/rows are modelled and fall back to `formatListed`'s BANA §11.16
Listed format (the one alternate that *does* exist) instead of their own named format,
producing Emboss's own generic transcriber's note ("Print format is changed. Row headings
are blocked in cell 5...", `LISTED_TN`, `document.mjs:957`) in place of the book's own
format-specific note, e.g. Sample 11-25 expects
`"@.<,A S]IES ( ?REE DOT #ES..."` (11.17's own wording) and Emboss produces
`"@.<,PR9T =MAT IS *ANG$4 ,R[ H1D+S..."` (the wrong, generic Listed-format note) —
concrete confirmation that Listed is not just missing coverage for the other five formats
but is actively substituted for them whenever a table happens to be too wide.

**Status update (17 Sep 2026, T9 — Paul's decision, `EMBOSS-TASKS.md` T9, 17 Sep 2026:
"Auto tries the squeeze first ... otherwise fall back (vertical division once built, listed
until then)"). Auto now squeezes before falling back to Listed; wide-table formats other
than Listed are still not built (this finding's own scope, unchanged).** BANA §11.6.1:
"Column entries are limited to two lines. Entries that cannot be limited to two lines
require another specialized table format." Before this fix, `resolveTableLayout`'s 'auto'
mode only attempted `fitColumnWidths`'s word-preserving squeeze when the table already fit
the line at its UNSQUEEZED natural width (or carried a two-tier header, F-12's own
carve-out) — otherwise it fell straight to Listed without ever trying to squeeze. 'auto' now
always tries the squeeze first and accepts columnar only when it fits AND every entry
(headers included) stays within two lines at the squeezed width (`fitsTwoLines`, new) —
word division itself was already prevented by `fitColumnWidths`'s `columnMinWidths`.

- **A second, genuine bug found proving this fix (fixed as part of the same job):**
  `columnMinWidths` only required a column to be at least as wide as its OWN widest word —
  it never accounted for §11.6.1a's 2-cell runover indent. A multi-word entry whose widest
  word lands on a RUNOVER line (pushed there by an earlier word) needs 2 cells of headroom
  BEYOND its own length to survive there; without that margin, `fitColumnWidths` would
  squeeze the column to exactly the word's own length and `wrapCells`'s own "overflow safety
  net" (an arbitrary character cut, documented in `standards-map.md`'s own 1.10.1 row as
  "unrelated to line-end division") would silently divide the word — found on ordinary
  English text (e.g. "individuals"), not a corner case. `columnMinWidths` now adds 2 cells to
  a row entry's contribution whenever that entry has more than one word (a single-word entry
  has no earlier word to push it onto a runover line, so needs no extra margin); headers
  (runover 0) are unchanged. `table_auto_squeeze.test.mjs` regression-tests this directly.
- **Sample 11-04 is NOT this fix's proof, and does not reach columnar** — proving the fix
  against it (as originally proposed) surfaced that its own "Habitat Unit" column has a
  genuine word-division dilemma of a different kind: "20 ac/territory"/"1 ac/territory" are
  each a single UNSPACED print token (no space around the "/"), so at every column width
  this table can squeeze to (its row-heading and population columns already sit at their own
  word-preserving minimum, leaving no more width to give habitat), that whole 12-cell token
  cannot fit a runover line (indent 2) without being divided. The book's own braille
  confirms it: it divides "ac/territory" at the slash (`",bald ,eagle #ejj ac_/ne/ site"`
  vs. `"#bj ac_/" / "t]ritory"` for the Williamson's Sapsucker row) — treating a
  slash-joined compound like a hyphenated one. This is the SAME root cause
  `standards-map.md`'s BANA 1.10.1 row already records "partial": "neither permitted
  exception [instructional hyphenation, or division in line-numbered material] has any code
  path to deliberately invoke it" — a slash-joined compound is a reasonable reading of that
  same "hyphenated compound word" discretion, just not one any existing gold sample had
  surfaced before. Adding that discretion (a new word-division MODE, not a squeeze/fallback
  decision) was out of T9's scope and risks a much larger, unreviewed change to the shared
  `wrapCells` primitive used throughout the whole document — so it is left to 1.10.1's own
  existing "partial" status rather than built here. `gold-run.mjs --sample sample-11-04`
  (17 Sep 2026) confirms sample-11-04 still falls back to Listed after this fix, for exactly
  this reason (not a bug in the fix).
- **Gold result (5 of this section's 36 samples change, none regress, none newly match):**
  `node Emboss/scripts/gold-run.mjs --section section-11 --update-status` (17 Sep 2026) —
  example-11-6, sample-11-07, sample-11-11, sample-11-14 and sample-11-27 now reach columnar
  layout (or come far closer to the gold line count) instead of falling to Listed; all five
  remain `mismatch` (for reasons this fix never claimed to address — e.g. sample-11-27's
  remaining diff is F-18's own "no Facing Pages/Interchange/etc." gap, sample-11-14's is an
  un-modelled figure-in-table cross-reference), and the previously-matching Example 11-2 does
  not regress. `status.json` records the current truth for all 36 samples.
- **Corpus evidence (real books, `Emboss/web/test_corpus_1000`, 17 Sep 2026):** of 194
  `format:'auto'` table blocks found across the corpus's ~1150 DTBook files, 96 resolved to
  columnar under the OLD 'auto' pre-check and 111 resolve to columnar now — 15 tables move
  from Listed/paragraph to columnar, none move the other way (measured with a temporary
  export/counting script, removed after — not left in the codebase). `run_1000_corpus_
  benchmark.mjs` and `run_800_nimas_benchmark.mjs` both still pass in full (1150/1150,
  800/800) after this fix.

**Status update (17 Sep 2026, T4 — Paul's decision, `EMBOSS-TASKS.md` T4, 17 Sep 2026:
"build in this order: vertical division (§11.14, also the automatic fallback when its
sections fit a page; listed stays the last resort), then stairstep ... linear ...
interchange ... facing pages ... last").** BANA §11.14 Wide Tables: Vertical Division is
now **done** — the first of the five missing alternate formats (this finding's own "45 map
rows" gap shrinks by the 4 rows for 11.14/11.14.1a-c; facing pages/interchange/linear/
stairstep remain **not done**, unchanged, out of this fix's scope per Paul's build order).

> "A wide table may be divided into vertical sections. When a divided table takes more
> than a single page, the preferred format is to place the table on facing pages."
> (11.14.1) "a. Divided tables should be on one braille page if possible." "b. Repeat the
> row headings for each section of the table." "c. Use a transcriber's note to inform the
> reader of the vertically divided table. Sample: Table is divided vertically into 2
> sections." (BANA Formats 2016, lines 8962-8970)

- **Model:** `block.format = 'vertical'` — a new, selectable table format alongside the
  pre-existing `'listed'`/`'spatial'`/`'columnar'`/`'auto'`, round-tripped through DTBook as
  `<table class="bana-vertical">` (`Emboss/input/parse.mjs`'s `parseTable`,
  `Emboss/input/nimas-export.mjs`'s table case — mirroring the pre-existing `bana-listed`
  convention). No new data fields: vertical division divides the table's own existing
  `headers`/`rows` at render time, the same shape every other table format already uses.
- **Where the division is computed:** `computeVerticalSections` (`Emboss/format/
  document.mjs`) — column 0 is always the row-heading column (§11.5.1), so this greedily
  packs the DATA columns (1..colCount-1) into consecutive sections, each of which, WITH
  column 0 repeated (11.14.1b), must fit the line at the columns' own NATURAL (unsqueezed)
  width — never squeezed. Natural width, not a squeeze, is what BANA's own Sample 11-22
  shows: none of its six data columns is narrowed; they are simply grouped 4+2 across two
  sections. Returns null (no division possible) when even a single data column cannot fit
  beside the row-heading column, or when the whole table needs only one section (division
  achieves nothing) — the caller falls through to Listed either way, per §11.12.1's "when
  the techniques for shortening column width do not create enough additional space,
  another table format is used."
- **`resolveTableLayout`/`tableLayout` (the toolbar warning, G15) — three call sites, all
  agreeing by construction:** an explicit `format:'vertical'` tries `computeVerticalSections`
  and falls back to Listed/paragraph if it returns null (mirroring how explicit `'columnar'`
  already falls back when its own squeeze fails); `'auto'` mode tries the pre-existing
  word-preserving squeeze first (T9, unchanged) and, only if that still doesn't reach a
  usable columnar table, tries vertical division BEFORE falling back to Listed/paragraph,
  which stays the last resort exactly as Paul's decision specifies. A table with a two-tier
  header (`block.headerGroups`, F-12, BANA §11.4.3) never tries vertical division — no gold
  sample combines the two, and dividing columns under a primary heading that spans several
  of them would need its own, unverified span-splitting rule; such a table still falls to
  Listed, unchanged.
- **Rendering (`formatTable`/`traceTable`, `Emboss/format/document.mjs`):** each section
  renders its own header row + separation line + data rows, exactly like an ordinary
  columnar table, with one difference gold-verified against Sample 11-22 itself: BANA
  §11.4.2c ("Columns without a heading do not have a separation line") applies to the
  row-heading column too whenever ITS OWN heading cell is blank (Sample 11-22's row-heading
  column has no column heading over it at all) — the separation line is plain spaces under
  that column, not a dot run, in every section. The rule's own sample TN wording (11.14.1c)
  opens the table; sections are separated by a single blank line (11.14.1a: kept to one
  braille page); the row headings repeat in full in every section (11.14.1b).
  `table_vertical_division.test.mjs` proves `formatBlock`/`traceBlock` render identically.
- **Gold result: Sample 11-22 ("Table Divided Vertically") now MATCHES the standard's own
  braille exactly, character for character** — `node Emboss/scripts/gold-run.mjs --section
  section-11 --sample sample-11-22` (17 Sep 2026): before this fix, `mismatch` (fell to
  Listed, "line count differs by +21 (expected 21, actual 42)" — the wrong format entirely,
  wrong TN, more than double the length); after, `match`. This is the first sample in this
  section's 36-sample gold set whose expected braille required an alternate wide-table
  format Emboss did not yet build (F-4/F-12's own fixes only ever reached samples that were
  already representable in columnar/Listed). `node Emboss/scripts/gold-run.mjs --section
  section-11 --update-status` (17 Sep 2026): 1 new match (sample-11-22), 0 regressions
  (Example 11-2 still matches). Two other samples' MISMATCH REASON changes (not a
  regression — neither ever matched, and neither is claimed fixed here): Sample 11-23
  ("Interchanged Columns and Rows") and Sample 11-25 ("Linear Table Format") now reach
  Emboss's own vertical-division TN/layout instead of the generic Listed TN, because
  'auto' tries vertical division before Listed and their own modelled columns happen to
  divide into sections that fit — the SAME "isolated-sample construction can't reproduce a
  book's specific alternate-format choice" caveat this finding already recorded for Listed
  substituting for all five missing formats (Stage 4 gold evidence, above) now applies to
  vertical division too, for exactly the two formats not yet built (linear, interchange).
- **§7 evidence (F-77's own fix, unrelated to vertical division but run in the same job):**
  `node Emboss/scripts/gold-run.mjs --section section-7 --update-status` (17 Sep 2026) —
  sample-7-01's line-count note changes from "line count differs by +3 (expected 18, actual
  21)" to no line-count note at all (exact count now matches); status stays
  `not-representable` (the sample's own separate, unrelated `#,-` running-head artifact,
  F-N-something already recorded, is untouched by this fix).
- **Suite/benchmarks:** `node Emboss/scripts/run-all-tests.mjs` — 119/119 headless
  (was 118/118; `table_vertical_division.test.mjs` added). `node scripts/
  run_1000_corpus_benchmark.mjs` — 1150/1150 DTBook files pass. `node scripts/
  run_800_nimas_benchmark.mjs` — 800/800 pass. `node Emboss/scripts/daisy-validate.mjs` on
  a hand-built DTBook containing a `class="bana-vertical"` table (Sample 11-22's own data)
  — VALID (0 errors). Chrome (editor, live source via `.claude/launch.json`'s new
  `emboss-live` config): inserted a table, cycled the per-table format toolbar button
  through Auto → Spatial → Listed → **Vertical Division** → Auto, correct label/tooltip at
  each step, no console errors.
- **Editor data plumbing (targeted edits, `Emboss/web/editor/editor.mjs` +
  `Emboss/web/editor/index.html` + `Emboss/web/locales/en.json`):** the per-table toolbar
  format button now cycles `auto → spatial → listed → vertical → auto` (was `... → listed →
  auto`); the global default-table-format settings dropdown gained a `vertical` option; the
  toolbar's "too wide" warning badge (G15) treats `layout === 'vertical'` the same as
  `'columnar'` (not a warning — it is a deliberate, standard-compliant alternate format, not
  evidence something doesn't fit) for both an explicit `format:'vertical'` table and an
  `'auto'`/`'spatial'` table that resolves to it.
- **Left open, unchanged from before this fix:** facing pages (§11.13), interchange
  (§11.15), linear (§11.17) and stairstep (§11.18) — still **not done**, per Paul's own
  build order (vertical division first). Vertical division combined with a two-tier header
  (§11.4.3) is untested and unbuilt (falls to Listed) — no gold sample exercises that
  combination. `computeVerticalSections` does not attempt a per-section squeeze (it only
  ever tries each column at its own natural width); this matches Sample 11-22 exactly and
  keeps the change small, but a table whose sections would only fit if squeezed a little
  still falls to Listed rather than a squeezed vertical division — not gold-contradicted
  (no sample needs it) but worth flagging as a possible future refinement.

---

## F-19 — UKAAF paragraph-form rows are indented one cell short of the standard's own worked example

**Rule:** B004 12b

> “Paragraph form, where the information in each row of the table is converted to a
> paragraph in braille, with items separated by punctuation rather than being aligned.”

**What Emboss does:** `formatParagraphForm` hardcodes `wrapCells(..., w, 2, 0)` for both its
opening transcriber's note and every data row (`Emboss/format/document.mjs:1102,1105,1125`)
— first line indented 2 cells (a "3-1" margin).

Reproduced with the real liblouis `en-ueb-g2` table against B004 §12 Example 2 (the bank
statement): every row's braille *content* matches the standard's own quoted braille exactly,
character for character — but the first line of the TN and of every row is indented 2 spaces
in Emboss's output where the reference example indents 3 spaces (a "4-1" margin, one cell
further right):

```
actual:   "  #JC_/#JI_/#AD2 ,DIRECT ,DEBIT TO"
expected: "   #jc_/#ji_/#ad2 ,Direct ,Debit"
```

**Classification:** **bug**, low severity (a one-cell margin, not a content error) — high
confidence given the content match is otherwise exact.

**Test that would prove a fix:** re-run the B004 §12 Example 2 comparison (script kept in
`assess-tables/`) after changing the two `wrapCells` calls' first-line indent from 2 to 3;
assert an exact character match against the standard's quoted braille.

**Status update (18 Sep 2026, fixed).** All three `wrapCells(..., w, 2, 0)` calls in
`formatParagraphForm` (the opening TN, the paragraph-form-explanation TN, and every data row)
now read `wrapCells(..., w, 3, 0)`, and the corresponding three calls in `traceParagraphForm`
(`Emboss/format/document.mjs`) were updated identically for `formatBlock`/`traceBlock` parity.
The runover margin (the second `wrapCells` argument, `0`) is unchanged — B004's own worked
example never wraps a row onto a third line, so nothing in this section's evidence pins down
the runover cell; the finding's own reproduction and this fix are both scoped to the
first-line indent only, which is the one B004's braille actually shows.

**Test:** `Emboss/tests/table_rules.test.mjs` (F-19 describe block) — a structural test with a
fake translator asserts the opening TN and every row's first line begin with exactly 3 blank
cells; a second test runs B004 §12 Example 2's own bank-statement table (`references/_text/
B004.txt`) through the real liblouis `en-ueb-g2` translator and asserts the TN line and the
first data row both have exactly 3 leading blank cells, matching the standard's own quoted
braille (`   #jc_/#ji_/#ad2 ,Direct ,Debit`) — reproducing exactly the comparison this finding
made when it first found the bug, now permanent. `formatBlock`/`traceBlock` parity is
asserted in both tests.

**Gold evidence:** none — B004 §12 has no gold JSON in `tests/gold/ukaaf-b004/` (only §6-9,
§11, Appendix E/G/J are covered by the pilot's gold corpus; see `standards-testing.md`).
Proven against B004's own primary source text directly, the same evidentiary standard this
finding's own original reproduction used.

---

## F-20 — No automatic explanatory transcriber's note for blank guide-dot entries in columnar (spatial) format

**Rule:** BANA 11.6.4 (partial)

> “Use guide dots across the width of a column to indicate a blank space or a blank to be
> filled in. Explain the series of guide dots in a transcriber's note.”

**What Emboss does:** the guide-dot mechanism itself is correct for a blank cell
(`tableCellFill`, `Emboss/format/document.mjs:877-888`), and `formatListed` auto-generates
its own explanatory note (`LISTED_BLANK_TN` via `listedTnParagraphs`,
`Emboss/format/document.mjs:961-966`, proven by `bana_table_format.test.mjs` Test 5) — but
`formatColumnar` has no equivalent: a spatial table with blank cells gets guide dots with no
auto-generated TN explaining them.

**Classification:** **bug/gap** — an easy, contained fix once F-2's row-vs-cell distinction
is sorted (the auto-TN should fire only when an actual blank *entry*, not a deliberate blank
*row*, occurs).

**Test that would prove a fix:** a columnar table with one blank entry (not a blank row);
assert the output includes an explanatory TN naming the guide-dot convention.

---

## F-21 — Row heading repeated in the last column is never suppressed

**Rule:** BANA 11.5.1e

> “Row headings repeated in the last column are omitted.”

**What Emboss does:** no code detects or suppresses a row heading print repeats verbatim in
the table's last column; every column, including a trailing repeat of the row heading, is
rendered exactly as given.

**Classification:** **not done** (missing feature; low severity — the transcriber can just
leave that cell blank themselves when typing the table, achieving the same result without
Emboss's help).

**Test that would prove a fix:** a table whose last column repeats column 0's text for every
row; assert Emboss leaves the repeat out (or, at minimum, that there's a documented way for
the transcriber to say "omit this").

---

## F-22 — Box-around-table and per-page column width are unautomated corners

**Rules:** BANA 11.2.5c (partial), 11.2.5e (partial)

> “The width of a column is determined by the widest entry in the column on that braille
> page … Column widths do not need to match the column widths on the previous or following
> page of long tables.” (BANA 11.2.5c)
>
> “Box lines may be omitted when a table will fit on a single page without them.”
> (BANA 11.2.5e)

**What Emboss does:** `computeTableColumns` (`Emboss/format/document.mjs:1029-1039`)
computes one global column width for the whole table, never recomputed per braille page (only
matters for a table split across pages whose columns' widest entry differs page to page — an
edge case, and the rule's negative permission ["do not need to match"] is satisfied trivially
since Emboss never attempts to match anyway). A table nested in a `box` block renders
correctly via the generic `formatBox` (`Emboss/format/document.mjs:749-770`) wrapping whatever
`formatBlock` returns for the table — but there's no automation of the optional "omit the box
lines if the table fits on one page without them" judgement.

**Classification:** **out of scope for the omission judgement** (a page-fit-dependent
aesthetic choice), **partial** for the per-page width recompute (real gap, low real-world
impact — no existing table+box or multi-page-width test either way).

**Test that would prove a fix:** low priority; would need a table long enough to split across
pages with genuinely different natural column widths on each page, which is an unusual case.

---

## F-23 — `fitColumnWidths`'s runover-avoidance is a byte-width heuristic, not "ease of reading by touch"

**Rule:** BANA 11.1.3 (partial)

> “A Braille Reader's Perspective. … In braille, this ease of reading works only if each
> entry will fit on one line. When columns have runovers, this ease of use is compromised.”

**What Emboss does:** `fitColumnWidths` (`Emboss/format/document.mjs:891-944`) does squeeze
columns to reduce runovers and falls back to listed/paragraph format rather than let every
column run over — a reasonable proxy — but it optimises for "fits the page width", not the
rule's actual concern (a touch reader's ability to scan/compare rows), which isn't something
a formatter can measure directly.

**Classification:** **deliberate choice, reasonable given the rule is fundamentally a human
judgement** — no fix proposed; noted here only because the map's Stage-1 "not-applicable"
testability tag undersells the fact that Emboss *does* make a genuine effort toward this
rule's goal, just not a literal implementation of it.

**Test that would prove a fix:** none proposed (not a bug).

---

## F-24 — The gold §11 corpus's `braille.lines` uses an inverted (lowercase) ASCII braille
letter-case convention — a Stage-3 gold-transcription artifact, not an Emboss defect

**Where found:** Stage 4 (`Emboss/scripts/gold-run.mjs`), running every gold example in
`Emboss/tests/gold/bana-formats-2016/section-11/*.json` against Emboss's real,
liblouis-backed `translate()`.

**What the gold data does:** every `braille.lines` entry in this section's 36 gold files
spells the alphabet and the a-j/1-0 digit letters in **lowercase** — e.g. Example 11-2:
`',animal   ,l;ge/ ,life ,span'`, `'mosquito #cj "ds'`, `'gggggggggggggggggggggggggggggggggggggggg'`
(bottom box rule).

**What real North American Braille ASCII actually uses:** **uppercase** for the same dot
patterns. This is independently verifiable inside this same repository, three ways:
1. BrailleBlaster's own real `.brf` output, already checked in at
   `Emboss/tests/nimas_samples/*.bb_out.brf` (a comparison-only reference tool per
   `standards-testing.md`) — e.g. `sample1.docx.bb_out.brf` begins
   `",ONCE ^U A "T A POOR WOODMAN LIV$..."` — uppercase throughout.
2. Emboss's own `translate()` (`Emboss/engine/louis.mjs`, `TABLES.uebG2`, the real
   `en-us-brf.dis` liblouis display table) independently produces the same uppercase
   convention for the same text, e.g. `translate("Figure 24-7  The APY is the best
   indicator...")` → `",FIGURE #BD-#G  ,! ,,APY IS ! BE/ 9DICATOR..."`.
3. Emboss's own pre-existing (unrelated) tests already assert the uppercase convention for a
   box's bottom rule — `bana_sidebar_sync.test.mjs:533` ("Bottom boxline contains GGG
   symbols", `GGGGGGG`), `bana_dynamic_style_menus.test.mjs:425`,
   `test_nimas_production.mjs:334` — all predating this pilot.

Non-alphabetic BRF ASCII characters (`,` `#` `"` `.` etc.) have no case, so they read
identically either way and give no clue by themselves; only the letters (and the a-j digit
letters) are affected, and they are affected on **every** line of **every** sample with any
braille at all (checked: every one of the 26 bottom-box-rule lines in the section is spelled
`g...g`, never `G...G` — a consistent, corpus-wide pattern, not an isolated slip).

**Classification:** **gold-corpus data-quality issue (Stage 3), not an Emboss defect.** The
two independent Sonnet read-throughs of the PDF's own rendered dot-pattern images
(`standards-testing.md` Stage 3) evidently picked the wrong ASCII case when converting a
rendered braille dot pattern to text — an easy mistake, since a dot pattern rendered as a
raster/font glyph carries no textual "case" of its own to copy. This is not a rule the
standard states differently from what Emboss does; it's a transcription-representation slip
in the fixture data itself.

**What this affects:** without accounting for it, *every* comparison in this pilot would
report 100% MISMATCH purely from letter case, burying every real structural finding (F-1
through F-23, F-4's box-adjacency gap, F-10's gutter question, F-12's header-tier gap, F-16's
ditto gap, F-18's missing alternate formats) under a single, mechanical, corpus-wide
artifact. `gold-run.mjs` therefore normalises it away (`.toUpperCase()`, which touches only
a-z and leaves every non-alphabetic BRF ASCII character untouched) before scoring any
sample — documented in the runner's `expectedLinesFor()` — so that MATCH/MISMATCH reflects
real formatting agreement, not this case flip. The *raw*, as-given gold text is still kept
alongside in the runner's output for full transparency.

**Recommendation for Paul:** decide whether to correct the case of the 36 gold JSON files'
`braille.lines` directly (re-deriving them, ideally re-checked against the PDF page images
rather than just re-cased mechanically, in case the case flip masked a different genuine
transcription slip on the same line) so future stages don't need this normalisation step.
Not done here — Stage 4/5's brief is to measure, not to edit Stage 3's gold files.

**Test that would prove this is understood, not guessed:** `Emboss/scripts/gold-run.mjs`'s
own three-way cross-check above (BrailleBlaster reference output, Emboss's own translate(),
Emboss's own pre-existing uppercase-box-line tests) — no gold file was edited to reach this
conclusion.

---

## F-25 — `resolveTableLayout`'s auto mode never tries to squeeze an over-wide table into columnar form — it falls back before `fitColumnWidths` gets a chance

**Rule:** B004 E ex1-transpose (contributing cause — see also F-6, F-18)

> “To fit the braille page, the table has been transposed, capitals and bold are omitted and
> the pound sign moved to the column headings.” (B004 Appendix E)

**Where found:** assessing `B004 E Example 1` (Household Expenditure) against the code —
specifically, checking what happens once a transcriber does the transposition themselves
(the pre-processing `B004 E ex1-transpose`/BANA 11.15.1/F-18 says Emboss can rely on) and
feeds Emboss the already-transposed 3-column, 7-row table.

**What Emboss does:** `resolveTableLayout` (`Emboss/format/document.mjs:1052-1063`):

```js
function resolveTableLayout(c) {
  if (c.mode === 'listed') return { layout: 'listed' };
  if (c.mode === 'paragraph' || c.mode === 'table-paragraph') return { layout: 'paragraph' };
  const fallbackLayout = c.bana ? 'listed' : 'paragraph';
  const tryColumnar = () => { /* calls fitColumnWidths, the column-squeezing function */ };
  if (c.mode === 'columnar') return tryColumnar();
  if (c.totalSpatialWidth <= c.w) return tryColumnar();
  return { layout: fallbackLayout };               // <-- never squeezes first
}
```

`fitColumnWidths` — the function that squeezes an over-wide table's columns down to fit,
falling back only if even the 2-cell/longest-word minimum can't fit — is reached only when
the table's format is explicitly forced to `'columnar'`, or when its *natural* (unsqueezed)
width already fits the page. In the default `'auto'` mode (`settings.tableFormat`, default
`'auto'`; `Emboss/format/document.mjs:1004`), an over-wide table goes straight to the
wide-table fallback (`listed`/`paragraph`) without ever attempting the squeeze — even though
squeezing might have been enough.

**Reproduced** (scratch experiments, read-only, no code/tests changed): the transposed
Household Expenditure table (row labels up to 33 characters, two numeric columns), width 38:
- With the £ sign left in every data cell (as print originally has it, before the
  £-relocation half of `ex1-transpose` is applied) and format forced to `'columnar'`: still
  falls back to `paragraph`. `columnMinWidths` (`document.mjs:946-953`) computes each
  numeric cell as one unbreakable "word" (e.g. `£11,256.62` → braille `@L#AA1BEF4FB`, 12
  cells) since a number can't wrap; minimum widths for the 3 columns sum to **39** cells (11
  + 12 + 12 + 2×2 gutter = 39) — **one cell over** the 38-cell budget. So even the forced
  `'columnar'` mode's squeeze attempt correctly reports "cannot fit" here; this table
  genuinely cannot be columnar with £ in every cell at this width. This is not F-25's bug —
  it's the correct answer, and it is exactly why the rule relocates £ to the headings.
- With the £ sign relocated to the two column headings instead (`'Year 1 (£)'`, `'Year 2
  (£)'`) and omitted from the data cells — the rule as actually stated — the minimum widths
  drop to 35 cells (well under budget) and the table **does** fit columnar once
  `fitColumnWidths` is given the chance (`format: 'columnar'` forced). But with `format`
  left at its default `'auto'`, `resolveTableLayout`'s natural-width check
  (`c.totalSpatialWidth <= c.w`) still sees the table's *unsqueezed* natural width (well over
  38, since natural widths use each column's *widest* entry with no squeezing at all) and
  routes straight to `paragraph` — identical output to the un-relocated-£ case, even though
  this version could have been rescued into columnar form.

**What the standard requires:** nothing directly (this is Emboss's own internal layout
decision, not a rule B004/BANA states), but it undermines the very "how to fit the braille
page" judgement `B004 E ex1-transpose`/BANA 11.12.1 asks a transcriber (or a program acting on
their behalf) to make: a table that *can* be made to fit columnar, given a licence to squeeze
its columns, is instead silently downgraded to the wide-table fallback whenever it happens to
be constructed or parsed with the default `'auto'` format setting — which is every table
unless someone (a transcriber, or a future auto-detection heuristic) remembers to force
`'columnar'`/`'spatial'` on it by hand.

**Classification:** **bug/gap.** `resolveTableLayout`'s `'auto'` branch should try
`tryColumnar()` (which already correctly reports "cannot fit" via `fitColumnWidths`'s own
null return) before falling back, not only when the *unsqueezed* width already fits. This is
a general table-layout gap, not specific to UKAAF or to Appendix E — it would affect any
BANA table too — but it was only surfaced by trying to reproduce this exact worked example,
because the prior §12 pilot's Example 1/2 both happened to already fit (or already force a
specific format) without ever exercising this exact branch.

**Test that would prove a fix:** a table whose natural (unsqueezed) width exceeds the page
but whose `fitColumnWidths`-squeezed width would fit, in `'auto'` mode with no explicit
`format`; assert it renders `columnar` (matching `tableLayout()`), not the wide-table
fallback. Household Expenditure (£ relocated to headings, width 38) is a ready-made case.

**Status update (17 Sep 2026, fixed — T9, `EMBOSS-TASKS.md` T9, this exact fix):**
`resolveTableLayout`'s `'auto'` branch now always tries `tryColumnar()` first — no longer
gated on the unsqueezed natural width — and accepts columnar when it fits and every entry
stays within BANA §11.6.1's two-line cap (`fitsTwoLines`). This is precisely the fix this
finding asked for. See `standards-findings.md`'s own F-18 status update (this file, tables
section) for the full write-up, the `columnMinWidths` runover-margin bug found alongside it,
and the gold/corpus evidence (`table_auto_squeeze.test.mjs` proves this finding's own worked
case directly: a table whose natural width exceeds the page but whose squeezed width fits,
`'auto'`, no explicit `format`, now renders `columnar`).

---

*(F-1 through F-25 above cover every row of `standards-map.md` whose status is partial or
not done, plus the worked examples that don't match — see `assess-tables/summary.md` for the
row-by-row coverage check, and `Emboss/tests/gold/bana-formats-2016/section-11/status.json`
for the Stage 4 gold-example run this pilot added. F-25 was found assessing UKAAF B004
Appendix E, added 17 Sep 2026 — see `standards-map.md`'s "UKAAF B004, Appendix E — Tables"
section.)*

---

# Standards findings — headings

F-26 onward cover Stage 2 (Assess) of BANA Braille Formats 2016 §4 and UKAAF B004 §5 +
Appendix A (Headings), added 17 Sep 2026. Same method as above: every row of
`standards-map.md` whose status is `partial` or `not done` is traceable to exactly one
finding below. No code or tests were changed while producing this document.

---

## F-26 — `joinsWithoutBlank` drops the blank line before *any* heading that follows *any*
other heading, not only "connected" same-tier pairs

**Rules:** BANA 4.4.1 (partial), 4.5.1 (partial), 4.6.2 (partial). (BANA 4.3.3, 4.5.6, 4.5.7
are satisfied by the same code and are not part of this finding — they are the cases it gets
*right*.)

> “A centered heading is preceded and followed by a blank line. Exceptions: [a related box;
> a table-of-contents entry; alphabetic divisions]” (BANA 4.4.1)
>
> “Precede a cell-5 heading with a blank line.” (BANA 4.5.1)
>
> “Precede a cell-7 heading with a blank line. Exception: There is no blank line between a
> cell-5 heading and cell-7 heading.” (BANA 4.6.2)

**What Emboss does:** `joinsWithoutBlank` (`Emboss/format/document.mjs:195-200`):

```js
function joinsWithoutBlank(prev, block, o) {
  if (o.mode !== 'bana' || !prev || !block || prev.type !== 'heading') return false;
  if (block.type === 'heading') return true;
  if (banaTier(prev.level, o) === 'centred') return false;
  return block.type === 'list' || block.type === 'glossary' || isVerseBlock(block);
}
```

The second line — `if (block.type === 'heading') return true;` — fires whenever the
*current* block is a heading and the *previous* one was too, with no check on either
heading's tier. This correctly covers BANA 4.3.3's "connected headings" (same-tier pairs:
Examples 4-2/4-3/4-4 are all title+author/chapter-number+title/unit-number+title at one
level) and 4.5.6/4.5.7 (cell-5→cell-5, cell-5→cell-7), which is why those rules are `done`.
But it also fires for every *other* heading-to-heading adjacency, which BANA does not
exempt from the default blank line:

Reproduced (scratch experiment, `formatDocument` with a stand-in uppercase translator):

```js
formatDocument({ blocks: [
  { type: 'heading', level: 1, text: 'ChapterTitle' },   // centred
  { type: 'heading', level: 2, text: 'FirstSection' },    // cell-5
  { type: 'para', text: 'Body.' },
] }, { mode: 'bana', width: 38, depth: 25, translate, listStyle: 'spaced', toc: false, suppressHeader: true })
```
produces
```
             CHAPTERTITLE
    FIRSTSECTION
  BODY.
```
— no blank line at all between the centred heading and the cell-5 heading that follows it.
The same happens for a centred heading immediately followed by a cell-7 heading. BANA 4.4.1
requires a centred heading to keep its trailing blank line in every case except three named
exceptions (a related box, a TOC entry, an alphabetic division) — "followed by another
heading" is not one of them. BANA 4.5.1 requires a cell-5 heading to be *preceded* by a
blank line unconditionally; BANA 4.6.2 requires the same for cell-7 *except specifically*
when it follows a cell-5 heading — not when it follows a centred heading, as in the second
reproduction above.

**What the standard requires:** the blank-line suppression that `joinsWithoutBlank`
implements should only fire for the specific pairs BANA actually names as exceptions
(4.3.3's connected pairs, which in every one of BANA's own examples share one tier; 4.5.6
cell-5→cell-5; 4.5.7/4.6.2 cell-5→cell-7) — not for every heading-to-heading adjacency
regardless of tier.

**Classification:** **bug.** The check is a straightforward over-generalisation: it tests
`block.type === 'heading'` where it should test something closer to "both headings are the
same tier, or this is specifically a cell-5→cell-7 pair" before returning `true`.

**Test that would prove a fix:** a document with a centred (L1) heading immediately followed
by a cell-5 (L2) heading, and a separate case with a centred heading immediately followed by
a cell-7 (L3) heading; assert both retain a blank line between them (BANA 4.4.1/4.5.1 and
4.4.1/4.6.2 respectively), while the existing `bana_nested_margins.test.mjs` cases
(centred→centred with intervening text, cell-5→cell-5, cell-5→cell-7) continue to pass
unchanged.

**Status update (17 Sep 2026, fixed):** `joinsWithoutBlank` (`Emboss/format/document.mjs`)
now looks up both headings' tiers (`banaTier`) and only drops the blank line for the exact
pairs BANA names, via a `HEADING_JOIN_TIERS` table documented in place at the function:
centred→centred (§4.3.3), cell-5→cell-5 (§4.5.6), cell-5→cell-7 (§4.5.7/§4.6.2). Every other
pair — centred→cell-5, centred→cell-7 (the bug this finding reported), and the three
pairings §4.5.5/§4.6.6 say shouldn't occur at all (cell-5→centred, cell-7→centred,
cell-7→cell-5, cell-7→cell-7) — now keeps the receiving tier's own default blank line
(§4.4.1/§4.5.1/§4.6.2). `Emboss/tests/heading_blank_lines.test.mjs` proves all nine tier
pairs individually against `formatDocument`, plus a formatBlock/traceBlock parity check per
tier; the pre-existing `Emboss/tests/bana_nested_margins.test.mjs` centred→cell-5 assertion
encoded the old (buggy) behaviour and was corrected to assert the blank line is kept, citing
§4.4.1/§4.5.1 (its cell-5→cell-7 assertion was already correct and is unchanged). Gold
result: `Emboss/scripts/gold-run.mjs --section section-4` shows no status regressions (every
sample's match/mismatch/not-representable classification is unchanged); `sample-4-01`'s own
heading sequence (Reading Preview [centred] → Objectives [cell-5], and Real-World Reading
Link [cell-7] → Nonspecific Immunity [centred]) now gains the two blank lines this fix adds,
visible in its diff output, though the sample's overall status stays `mismatch` for other,
already-tracked reasons (list-item flattening, page-change numbers, emphasis passages — none
of them heading-blank-line related). `--section section-11` is unaffected (`joinsWithoutBlank`
only fires in BANA mode between two heading blocks; no status changed). A DTBook built with
`exportToNimasXml` for a centred→cell-5→cell-7→centred sequence, re-parsed with `parseDtbook`
and formatted, round-trips with the correct blank lines and passes
`Emboss/scripts/daisy-validate.mjs` (0 errors, 7 suppressed known-bug `<meta>` warnings).

---

## F-27 — No code suppresses the blank line between a centred heading and a following box
(BANA 4.4.1a)

**Rule:** BANA 4.4.1a.

> “Do not insert a blank line between a centered heading and a related box.” (BANA 4.4.1a)

**What Emboss does:** `formatHeading`'s BANA centred branch (`Emboss/format/document.mjs:243`)
always emits its own trailing blank line, and nothing in `joinsWithoutBlank`
(`document.mjs:195-200`) or the main content-join loop (`document.mjs:2526-2536`) exempts a
following `box`/`sidebar` block. Reproduced (scratch experiment):

```js
formatDocument({ blocks: [
  { type: 'heading', level: 1, text: 'Centred Then Box' },
  { type: 'box', blocks: [{ type: 'para', text: 'Boxed text.' }] },
] }, { mode: 'bana', width: 38, depth: 25, translate, listStyle: 'spaced', toc: false, suppressHeader: true })
```
produces
```
           CENTRED THEN BOX

7777777777777777777777777777777777777
  BOXED TEXT.
GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
```
— a blank line always appears before the top box line. (Separately, Emboss also has no
signal anywhere that would distinguish a box that "relates to" the preceding heading from
one that does not — see the Test note below.)

**What the standard requires:** no blank line between the centred heading and the box's top
line, when the box relates to that heading.

**Classification:** **not done.** No code implements this exception at all; it isn't a
narrow bug in an existing mechanism (compare F-26), it's an absent one.

**Test that would prove a fix:** once a "this box relates to the preceding heading" signal
exists (e.g. a flag the parser/editor sets when a box immediately follows a heading with no
intervening block, mirroring how BANA §11.3.1b's table-heading-position signal was added —
`standards-findings.md` F-4), a test asserting a centred heading directly followed by such a
box has no blank line between them, while an *unrelated* box (or no signal set) keeps the
default blank line.

---

## F-28 — Centred-heading line division is a plain greedy wrap, never balanced (BANA 4.4.3)

**Rule:** BANA 4.4.3.

> “Headings should be balanced and divided at a logical location when longer than one line.”
> (BANA 4.4.3)

**What Emboss does:** `centredBlock` (`Emboss/format/document.mjs:36-38`), used by
`formatHeading`'s centred branch, calls `wrapCells(text, wrapWidth, 0, 0)` and centres each
resulting line independently. `wrapCells`'s wrapping (`Emboss/format/layout.mjs`) is a plain
greedy fill: it packs as many whole words as fit on a line before moving to the next, never
looking ahead to balance the *last* line against the others. Reproduced (scratch
experiment):

```js
formatHeading({ type: 'heading', level: 1,
  text: 'A Rather Long Chapter Heading That Needs To Wrap Across Two Lines Of Braille' },
  { mode: 'bana', width: 38, translate }, false)
```
produces three lines of 33/33/27 characters:
```
    A RATHER LONG CHAPTER HEADING
    THAT NEEDS TO WRAP ACROSS TWO
           LINES OF BRAILLE
```
— word boundaries are respected ("logical location," satisfied), but the division is not
balanced: the first two lines are packed to near the wrap limit and the third is left much
shorter, rather than the three lines being roughly even. BANA Example 4-8 ("Balanced
Centered Heading") is this section's own worked illustration of exactly this rule and has no
test.

**What the standard requires:** when a heading needs more than one line, the lines should be
divided so their lengths are visually balanced, not merely word-wrapped to fill each line as
full as possible before the next.

**Classification:** **partial.** The "logical location" (word-boundary) half is done; the
"balanced" half has no code attempting it at all.

**Test that would prove a fix:** a heading requiring exactly two lines, chosen so a naive
greedy wrap would produce a short second line; assert the two lines' lengths differ by no
more than some small tolerance (e.g. 1-2 cells) once dividing more evenly, rather than
greedily filling the first line. BANA Example 4-8's own worked text/braille would make a
good gold case at Stage 3.

---

## F-29 — BANA 4.4.1's table-of-contents and alphabetic-division exceptions have nowhere to
attach: Emboss's TOC and index mechanisms never render a "centred heading"

**Rules:** BANA 4.4.1b, 4.4.1c.

> “A centered heading is preceded but not followed by a blank line in a table of contents
> entry.” (BANA 4.4.1b)
>
> “Do not insert blank lines before or after alphabetic divisions in alphabetic references.”
> (BANA 4.4.1c)

**What Emboss does:** Emboss's table of contents is generated by `buildToc`/`tocEntryLines`
(`Emboss/format/document.mjs:2157,327-353`), which always produces the fixed dot-leader/
page-number layout for a `toc` list's own `items` — a centred heading (`formatHeading`,
`document.mjs:229-258`) is never one of the structures that can appear as a TOC entry, so
4.4.1b's specific "blank before, not after" exception has no code path to attach to (a real
TOC entry is never centred in the first place, and the general 4.4.1 default is never even
reached for it). Likewise, no "alphabetic division"/letter-divider heading concept exists
anywhere in the parser or formatter — grep of `parse.mjs`/`document.mjs` for "alphabetic"
finds only the unrelated index-margin comment at `document.mjs:75` (nested-margin handling
for BANA §21.2.1b indexes, a different rule). A centred heading used as an alphabetic
division would simply receive the ordinary 4.4.1 default (blank both sides), not 4.4.1c's
exception.

**What the standard requires:** a centred heading that functions as a TOC entry keeps its
leading blank but drops the trailing one; a centred heading used as an alphabetic-reference
letter divider gets no blank line on either side.

**Classification:** **not done** (both). Neither scenario has any representation in
Emboss's data model, so neither exception can currently be produced, correctly or
incorrectly — the general default simply always applies instead.

**Test that would prove a fix:** once a TOC-entry-styled-as-centred-heading or an
alphabetic-division-heading concept exists in the block model, a test asserting the
specific blank-line pattern each exception requires, distinct from the 4.4.1 default.

---

## F-30 — BANA 4.5.3's multi-column-list exception can never fire: Emboss has no
multi-column list format

**Rule:** BANA 4.5.3.

> “The heading is usually not followed by a blank line, and takes precedence over the use of
> blank lines in other formats, such as lists (unless the list is arranged in more than one
> column).” (BANA 4.5.3)

**What Emboss does:** `joinsWithoutBlank` (`Emboss/format/document.mjs:195-200`) drops the
blank line before any `list`/`glossary`/verse block that follows a cell-5 or cell-7 heading,
with no check on how many columns the list has — because no such check could ever matter:
`nestedMargins` (`document.mjs:88-100`), which computes every list's margins, has no
"columns" list kind at all (BANA Formats §8.4.1a, "Simple Lists in Columns," referenced by
this very rule, is unimplemented — grep of `document.mjs`/`parse.mjs` for a multi-column
list construct finds none). The base rule (no blank line, for an ordinary single-column
list) is therefore correctly satisfied in every case Emboss can actually produce, but the
named exception has nothing to except.

**What the standard requires:** the no-blank-line default should not apply when the
following list is arranged in more than one column — a blank line should appear there
instead.

**Classification:** **partial.** The single-column case (everything Emboss can currently
build) is done; the multi-column exception is not done, tied to the pre-existing absence of
a multi-column list format (itself outside this Headings assessment's scope — a Lists-section
gap, not a Headings-specific one).

**Test that would prove a fix:** once a multi-column list format exists, a test asserting a
cell-5/cell-7 heading immediately followed by such a list keeps its blank line, unlike the
single-column case `bana_nested_margins.test.mjs` already proves.

---

## F-31 — No shape-indicator/icon mechanism exists anywhere in Emboss (BANA 4.9.1, 4.9.2b,
4.9.3)

**Rules:** BANA 4.9.1, 4.9.2b, 4.9.3.

> “Icons may be used with headings or within text to indicate specific types of text, e.g.,
> important facts, essay questions, etc. … The icon (shape indicator and letters) is
> preceded and followed by a blank space.” (BANA 4.9.1)
>
> “List the icon on the Special Symbols page.” (BANA 4.9.3)

**What Emboss does:** grep of `document.mjs`/`parse.mjs`/`editor.mjs` for an icon or
UEB-shape-indicator construct attached to a heading (or to text generally) finds nothing —
the only `icon:` fields anywhere are unrelated editor-toolbar glyphs for maths symbols in
`Emboss/web/editor/editor.mjs` (e.g. `icon: '½'`), not a print-icon-to-braille-shape
mechanism. Separately, no "Special Symbols page" feature exists at all —
`document.mjs:60-61`'s own comment states this plainly: "Until the Special Symbols page
exists (G8), the first transcriber-defined symbol is explained in a transcriber's note
before its first use" (the workaround Emboss already uses for its one existing
transcriber-defined symbol, the asterism — see `indicatorLine`/`tdSymbolNote`,
`document.mjs:52-68`). A transcriber can express an icon heading *in words* (BANA 4.9.2a,
which needs no dedicated code and is `done`), but cannot devise and place an actual
shape-indicator icon (4.9.2b) or list one on a Special Symbols page (4.9.3).

**What the standard requires:** a shape-indicator-plus-letters icon, spaced before and
after, may be placed next to a heading (4.9.1) or devised by the transcriber (4.9.2b), and
any such icon is listed on the Special Symbols page (4.9.3).

**Classification:** **not done** (all three). This is a missing feature, not a narrow bug —
consistent with the tables pilot's own G8 cross-reference (`document.mjs:60-61`) already
flagging the Special Symbols page as a known, currently-unbuilt piece of infrastructure that
several other findings (there, transcriber-defined table symbols) are also waiting on.

**Test that would prove a fix:** once a shape-indicator/icon mechanism and a Special Symbols
page both exist, a test asserting a heading with an attached icon renders the shape
indicator plus letters, spaced correctly, in the position print used (before/after), and
that the icon is listed once on the Special Symbols page.

---

## F-32 — UKAAF heading levels beyond 6 collapse to level 6's treatment with no further
distinguishing tool (B004 Appendix A)

**Rule:** B004 A Headings.

> “There may be occasions where more complicated and lengthy texts need more than three
> heading levels. In this case any format of braille heading may be assigned more than once
> provided that they are distinguished by some other means such as terminology (e.g. Unit,
> Part, Chapter, Section) or type face.” (B004 A Headings)

**What Emboss does:** `formatHeading`'s UKAAF branch (`Emboss/format/document.mjs:249-255`)
implements Appendix A's own illustrated 6-level scheme exactly (L4/L5 share L2's cell-1/
runover-5 margins, distinguished only by a forced bold marker on L4 —
`Emboss/tests/heading_levels_4_6.test.mjs`). But the branch's final `else`
(`document.mjs:255`) catches every level *from 6 upward* — there is no level-7+ case, so a
7th distinct heading level would render identically to level 6 (cell 3 / runover 5, bold),
with no further distinguishing means (a different terminology cue is a content/text
decision the transcriber could still make, but Emboss offers no *additional* margin or
typeform tool the way it does for levels 4-6 relative to 1-3).

**What the standard requires:** a text needing more than 6 distinct heading levels may reuse
a braille heading format more than once, provided each reuse is distinguished "by some other
means" — implying some further distinguishing device is expected to exist for the transcriber
to reach for, not merely that Emboss stops adding new ones after level 6.

**Classification:** **standard unclear as applied to Emboss's implementation** — B004
Appendix A itself only illustrates up to 6 levels and does not specify what a 7th should look
like, so it is not obviously a bug that Emboss also stops at 6; but nothing was built or
decided for the case the rule's own general wording (open-ended "there may be occasions…")
seems to anticipate. See `standards-questions.md` Q-11.

**Test that would prove a fix:** once a decision is made for level 7+ (e.g. cycling back to
reuse level 4/5's margins with a different typeform, or extending centred treatment further
as BANA does), a test asserting a 7-level document distinguishes its 7th level from its 6th
by *some* means beyond plain repetition.

---

*(F-26 through F-32 above cover every row of `standards-map.md`'s BANA §4 / B004 §5+A
Headings tables whose status is `partial` or `not done` — worked-example rows are left at
Stage 1 pending Stage 3/4. See `standards-map.md`'s two Headings sections for the full
row-by-row status, and `standards-questions.md` Q-10/Q-11 for the two open questions this
assessment raised (BANA 4.3.6's "unclear" row has no finding of its own, per this file's own
scope — only `partial`/`not done` rows get one).)*

---

# Standards findings — lists (BANA §8, B004 §10 + Appendix C; assessed 17 Sep 2026)

## F-33 — No shape-fidelity for print bullets, no way to bullet a plain `<list type="ul">` without a literal glyph, and no Special Symbols page/note to document one

**Rules:** BANA 8.6.2 (partial), 8.6.2a (partial), 8.6.2b (not done), 8.7.1a (partial)

> "Retain bullets whenever they are used in lists." (BANA 8.6.2)
>
> "Follow print for the symbol used as a bullet. If the print symbol does not have a
> corresponding symbol in braille, devise a symbol using a transcriber-defined symbol
> indicator." (BANA 8.6.2a)
>
> "List all bullet symbols except the primary bullet indicator (dots 456, 256) on the Special
> Symbols page, or in a transcriber's note before the text." (BANA 8.6.2b)

**What Emboss does:** `formatList`/the list case of `traceBlock` (`Emboss/format/document.mjs
:400-401,1826`) render `item.marker === '•'` as the single UEB primary bullet `_4`. The
parser only ever sets that one marker, and only when the print bullet is a *literal* leading
character matched by `BULLET_PREFIX_RE` (`Emboss/input/parse.mjs:2082`):

```js
const BULLET_PREFIX_RE = /^\s*[•\-\*•‣◦⁃∙▪▫●○·]+\s+/;
```

Three separate gaps follow from this:

1. **A `<list type="ul">` with no literal bullet character in its item text gets no marker at
   all**, so no bullet reaches the braille. This is already an open, acknowledged item —
   `EMBOSS-TASKS.md` **A6**: "Parser drops bullets for `<list type=\"ul\">`" — **Open**.
   "Formatter already renders `•` as `_4`." This finding does not discover A6; it confirms it
   is still open and ties it to the specific map rows it leaves unsatisfied.
2. **Every recognised bullet-like glyph is folded into the SAME marker.** `-`, `*`, and the
   filled/hollow square and circle characters in the regex (`▪▫●○`) all
   become `item.marker = '•'` (`parse.mjs:2341`) and so all render as the identical `_4`,
   instead of BANA 8.6.2a's own six distinct worked correspondences (dot, hollow square,
   solid square, hollow circle, triangle, checkmark — each with its own braille form, e.g.
   `$#d` for a hollow square "[will require a grade 1 indicator]"). A triangle or checkmark
   glyph (not in the regex at all) is not recognised as a bullet and reaches the braille
   translator as a literal, untranslated character.
3. **No transcriber-defined-symbol or Special Symbols page mechanism exists for a bullet.**
   `document.mjs:60`'s own comment says so plainly: "Until the Special Symbols page exists
   (G8), the first transcriber-defined symbol is explained in a transcriber's note…" — and
   the one transcriber-defined-symbol note Emboss does generate, `tdSymbolNote`
   (`document.mjs:64-68`), fires only for `block.kind === 'asterism'`, never for a list
   bullet. `EMBOSS-TASKS.md` **G8** records this as **Decided** (16 Sep 2026) but explicitly
   **"To build: … formatter markers, Special Symbols page"** — not built as of 17 Sep 2026.

Reproduced (read of `document.mjs`/`parse.mjs`, not a new test): a `list` block with items
whose print bullet is a hollow square (`▫`, e.g. "▫ Apple") formats identically to a
filled circle ("● Pear") — both become `_4 APPLE` / `_4 PEAR` in BANA mode, though the rule's
own table gives the hollow square a different braille form.

**What the standard requires:** every print bullet is retained using its own print-matching
braille correspondence when one exists (or a devised transcriber-defined symbol when it
doesn't), documented once on the Special Symbols page or in a transcriber's note — not
silently collapsed to one universal symbol, and not silently dropped for a `ul` list with no
literal bullet character in its source text.

**Classification:** **bug** (item 1, A6 — a real, already-open defect: bullets are lost, not
merely under-differentiated) and **not built** (items 2 and 3 — G8's own decision already
calls for this to be built; it is a scoping gap, not a disputed rule reading).

**Test that would prove a fix:** (1) a DTBook `<list type="ul"><li>Apple</li></list>` with
no literal bullet character parses to an item that still carries a bullet marker (from the
list's `type="ul"`, not from the text) and formats with `_4`. (2) A list mixing a hollow
square and a filled circle bullet (as distinct `<li>` markup, e.g. a `class` or literal
distinct glyph) formats each with ITS OWN correspondence, not both with `_4`. (3) Formatting
any list with more than the primary bullet present, a Special Symbols entry/transcriber's
note is generated naming that symbol.

**Status: not fixed.** Recorded for Paul's task list (A6 already open; G8 already decided but
not built) — no code or tests were changed producing this finding.

**Status update (18 Sep 2026, item 1/A6 fixed; items 2 and 3 still open, unchanged):**
- **Fix:** `parseSingleList`'s per-`<li>` bullet handling (`Emboss/input/parse.mjs`, the
  `else if (detectedKind !== 'plain' && !isToc)` branch) now falls back to
  `itemMarker = '•'` when `BULLET_PREFIX_RE` finds no literal bullet character AND the
  list's own `type` attribute is `"ul"` — the signal chosen is the DTBook `type="ul"`
  attribute itself (an explicitly unordered list), not any property of the item text, so a
  `type="pl"` (plain, no enumerator) list is untouched and a list already carrying a literal
  bullet glyph is unaffected (same `marker: '•'` as before). `formatList`/`traceBlock` already
  rendered `marker === '•'` as `_4` (BANA 8.6.2a) before this fix — nothing there changed.
- **Export round-trip:** `nimas-export.mjs`'s existing `keepMarkers` logic
  (`Emboss/input/nimas-export.mjs` ~line 534, `items.every((it) => !it.marker || it.marker
  === '•')` → `{tagOpen: '<list type="ul">', keepMarkers: false}`) already treated a plain
  `'•'` marker as implicit and wrote no marker into the item text — this was not changed, and
  is exactly what makes the round trip lossless: reloading a `type="ul"` list with no literal
  bullet regenerates `marker: '•'` on every item from the signal above, without ever having
  written a literal `•` glyph into the exported DTBook XML.
- **Verified:** a real `<list type="ul"><li>Apple</li><li>Pear</li></list>` now parses with
  `item.marker === '•'` on every item, formats as `_4 APPLE` / `_4 PEAR`, exports as
  `<li>Apple</li>` (no glyph) inside `<list type="ul">`, and reloading that XML regenerates
  the same markers. `Emboss/tests/demo_fixes.test.mjs` (`describe('F-33/A6 ...')`) covers the
  parse, the BANA 8.6.2a-shaped output, the no-regression case for a list that DOES carry a
  literal bullet, the `type="pl"` negative case, and the full export/reimport round trip.
  Two pre-existing tests asserted the OLD (buggy) "no marker at all" behaviour for a plain
  `type="ul"` sub-list and were updated citing this rule: `Emboss/tests/
  nested_lists_roundtrip.test.mjs` ("ordered list with an unordered sub-list…", now asserts
  `marker === '•'`, never numeric) and `Emboss/input/parse-regressions.test.mjs` (#6, the
  NIMAS-sourced `<list type="ul">` case now expects `marker: '•'` on each item; the unrelated
  HTML/ODT expectations in the same check are untouched since those parsers have their own,
  separate list code).
- **Gold:** `node Emboss/scripts/gold-run.mjs --section section-8` is unchanged before/after
  this fix (`match: 6 mismatch: 2 not-representable: 19`, `sample-8-13/14/15` all
  `not-representable`) — this section's own `buildModel8` (`Emboss/scripts/gold-run.mjs`)
  builds each list item's `marker` directly from the gold JSON's own `print.blocks[].
  items[].marker` field, bypassing `parse.mjs` entirely, so it cannot exercise this parser-
  level fix either way; `sample-8-14`/`sample-8-15`'s own remaining `not-representable`
  causes are exactly items 2/3 of this finding (hollow-circle/solid-square correspondence,
  still open below), not item 1.
- **Still open, unchanged (items 2 and 3):** per-glyph bullet-shape correspondence (hollow
  square/circle, solid square, checkmark, triangle each with their own braille form) and the
  Special Symbols page/transcriber's-note mechanism for a non-primary bullet — explicitly out
  of scope for this pass; left for a future task.

---

## F-34 — No side-by-side column-list layout: a print list set in columns is always collapsed to a single column, with no page-aware refill and no column-count-change note

**Rules:** BANA 8.4.1 (partial), 8.4.1a (unclear), 8.4.1b (partial), 8.4.1c (not done),
8.4.1e (not done), 8.4.1g (not done)

> "Simple listed items may appear in columns. When it is obvious the list has been printed in
> side-by-side columns to save space, the arrangement can be retained if it fits, but it does
> not have to be duplicated." (BANA 8.4.1)
>
> "When a columned list is too long for a single braille page, list the words in columns and
> fill the page with as many words as will fit. … Continue listing the words in columns on
> the next braille page." (BANA 8.4.1g)

**What Emboss does:** `formatList` and the list case of `traceBlock` have no column-layout
code path at all — a grep of `Emboss/format/document.mjs` for column handling finds it only
in the table formatter (`computeTableColumns`/`formatColumnar`) and in `tocColumns` (a
contents list's page-number column, `document.mjs:292-370`), never in ordinary list
rendering. Every list — columned in print or not — is unconditionally rendered as one
vertical column (`nestedMargins`, `document.mjs:88-100`, has no column dimension at all).

This happens to satisfy 8.4.1's OWN fallback ("does not have to be duplicated… may also be
presented in a single column"), so Emboss is never wrong to collapse — but it can never
retain the side-by-side arrangement print used, and does so unconditionally, not as a
transcriber's discretionary choice made per list. Everything downstream that only matters
when columns exist is then unreachable: 8.4.1b's two-blank-cell second-column margin and
"no guide dots between columns" (the first-column-in-cell-1 half is trivially true since the
single column already starts at cell 1); 8.4.1c's "keep on one page" (moot — see F-35 for the
separate, general absence of any block-aware pagination); 8.4.1e's transcriber's note when
the column count changes (there is no column count to change); and 8.4.1g's page-by-page
column refill (needs both the column feature and page-aware layout, neither of which exists).

Whether a print columned WORD LIST would even reach Emboss's list code, rather than its table
code (which DOES already render columns, per the already-assessed §11 map), is itself
unclear — DTBook has no distinct "list set in print columns" construct, so the answer depends
on how a real transcriber's source marks such content up.

**What the standard requires:** retain the side-by-side arrangement when it fits (the
transcriber's actual first-choice option, not merely the allowed fallback), with the specific
column margins (8.4.1b), one-page preference (8.4.1c), transcriber's note on a forced
column-count change (8.4.1e), and page-spanning refill (8.4.1g) that only apply once columns
exist.

**Classification:** **not built** — this is a real formatting feature (retaining print's
side-by-side word-list columns) that Emboss has never implemented; the always-legal
single-column fallback happens to be all it does. Whether it's worth building depends on how
often a real transcription source presents this pattern as a `<list>` rather than a `<table>`
— see Q-12.

**Test that would prove a fix:** a print list explicitly marked as columned (however the
source ends up recording that) formats with two or more side-by-side columns, cell-1 first
column, a two-cell gap to the second column, no guide dots between them, and — for a list
too long for one page — continues in columns on the next braille page rather than falling
through to a single column.

**Status: not fixed.**

---

## F-35 — No list-aware pagination at all: none of BANA's page-start/page-split rules for lists are implemented

**Rules:** BANA 8.3.4 (heading), 8.3.4a (not done), 8.3.4b (not done), 8.3.5 (heading),
8.3.5a (not done), 8.3.5b (not done), 8.3.5c (not done), 8.3.5d (not done)

> "Start the list on line 1 when a running head is not used, if there are two or more blank
> lines at the bottom of the previous page. Start the list on line 2 when braille is on the
> last or next-to-last line of the previous page." (BANA 8.3.4a)
>
> "A heading must be followed by at least one complete list item before the list is continued
> on a new braille page." (BANA 8.3.5d)

**What Emboss does:** `assemble` (`Emboss/format/page.mjs:140-256`) paginates by slicing the
flat line array into fixed-size `perPage` chunks; the only content it inspects at all is the
BANA print-page-change indicator (`banaPageChangeNumber`). `document.mjs`'s own page-boundary
pass (the R8 heading-protection logic, around `document.mjs:2263-2313`) only special-cases
headings and box lines. Neither layer has any concept of a `list` block, an item boundary
within one, or how many blank lines closed the previous page — so:

- 8.3.4a/b (which braille line a list starts on at the top of a page, depending on running
  head and how the previous page ended) is never checked;
- 8.3.5a (a list "may be divided… if necessary" — implying it's normally kept together when
  not necessary) has no together-keeping logic to make that a real choice, only an accident
  of wherever the fixed chunk boundary falls;
- 8.3.5b/c (the first item may start on the next-to-last line only if it fits on one braille
  line; a list must never start on the very last line) are both unchecked — a list can start
  anywhere, including the last line of a page;
- 8.3.5d (a heading must be followed by at least one *complete* list item before a
  page-continued list) is unchecked at the item level — the generic heading-keep-together
  logic protects a heading's next line of text, not a whole (possibly multi-line) list item.

This is the identical shape of gap already recorded for tables in `standards-findings.md`
F-13 ("No table-aware pagination: headings never repeat, `(cont.)` never appears,
tables/rows can split anywhere") — the same root cause (`assemble`'s block-blind fixed-size
chunking), applied here to lists instead of tables.

**What the standard requires:** a list's starting line depends on the running head and the
previous page's own ending; a list is protected from starting on the very last line of a
page and, when following a heading, from continuing without at least one complete item first.

**Classification:** **not built.** Like F-13, this is a structural gap in the pagination
layer, not a disputed rule reading — `page.mjs`/`document.mjs`'s page-boundary code would
need to become aware of list-item boundaries the way it is currently aware of heading
boundaries.

**Test that would prove a fix:** build a document whose line count places a list's first
item exactly at the last, next-to-last, or third-from-last line of a page under each of
{running head on/off, previous page's own blank-line count}, and assert the list starts on
the specific line 8.3.4a/b requires, never on the last line (8.3.5c), and that a heading
immediately followed by a list that must continue onto the next page keeps at least one
complete item with the heading (8.3.5d).

**Status: not fixed.**

---

## F-36 — No BANA §8.8 outline-specific machinery: no skeleton-outline blank symbol and no per-page outline guide text

**Rules:** BANA 8.8.2 (not done), 8.8.5 (not done), 8.8.5a (not done), 8.8.5b (not done),
8.8.5c (not done), 8.8.5d (not done), 8.8.5e (not done), 8.8.5f (not done)

> "Follow print for the symbol used to represent blanks in a skeleton outline. Insert three
> dot 5s to represent blank space (no print symbol). A transcriber's note is required to
> explain the use of the dot 5s." (BANA 8.8.2)
>
> "Guide Text for Entire Documents in Outline Format. To aid the reader when an entire
> document is printed in outline format, center the last division number used on each
> braille page on line 25." (BANA 8.8.5)

**What Emboss does:** Emboss has no distinct "outline" kind anywhere in its model — a grep of
`document.mjs`/`parse.mjs`/`editor.mjs` for "outline" finds nothing but unrelated matches
(SVG/tactile-graphic "outlines", an ODT `outline-level` attribute used for heading levels).
An outline is simply formatted as an ordinary nested `list` block, which correctly gives it
8.5.1b's shared margins (8.8.1 and 8.8.3 are `done` in the map for exactly this reason — the
general nested-list mechanism happens to satisfy them). But two outline-specific behaviours
that have no general-purpose equivalent elsewhere in Emboss are simply absent:

1. **8.8.2's skeleton-outline blank.** No code represents "print left this division blank" as
   distinct from an ordinary empty string; there is no three-dot-5 substitution and no
   transcriber's-note generation for it. Grep of `document.mjs`/`parse.mjs` for "skeleton"
   finds nothing.
2. **8.8.5's per-page outline guide text (a-f).** `page.mjs`'s `assemble()` and
   `document.mjs`'s pagination code have no concept of "the last outline division used on
   this page," so nothing centres it on line 25, nothing reserves the required three blank
   cells before/after it or before the page number, nothing repeats the last division with
   "(cont.)" when a page has no new division of its own, and there is no odd-page-only option
   (8.8.5f). This is a second, independent instance of the same "no block-aware pagination"
   root cause as F-35/F-13, but for a feature (per-page repeating guide text) that has no
   counterpart anywhere else in the codebase to borrow from, unlike a table's running head.

**What the standard requires:** a skeleton outline's print-blank divisions become a
documented three-dot-5 symbol when print itself has none; a document transcribed wholly in
outline format carries a centred, margin-disciplined, continuation-aware guide-text line on
line 25 of every braille page (or every odd page, at the agency's option).

**Classification:** **not built.** Neither behaviour has any partial implementation to
extend — both are absent outright, and (8.8.5) would need genuinely new pagination
infrastructure (a per-page "current outline division" tracker), not a small patch to
`assemble`.

**Test that would prove a fix:** (1) a skeleton outline item with an empty division (no
print symbol) formats with three dot-5 cells and a transcriber's note explaining them,
appearing once, before first use. (2) A whole-document outline spanning several braille
pages has a centred division number on line 25 of every page, at least three blank cells on
each side (and after the entry when no braille page number appears), and repeats the last
division with "(cont.)" on any page introducing no new one.

**Status: not fixed.**

---

## F-37 — No "directions" line concept: a list following exercise directions still gets the default blank line

**Rule:** BANA 8.3.3c

> "A list is not preceded by a blank line: … When it follows directions. (See Formats, §10,
> Exercise Material.)" (BANA 8.3.3c)

**What Emboss does:** Emboss has no representation of an exercise's "directions" line
distinct from an ordinary paragraph — grep of `document.mjs`/`parse.mjs` for "direction"
finds only unrelated stage-direction code (BANA §14). `joinsWithoutBlank`
(`Emboss/format/document.mjs:195-200`), which is where 8.3.3a's own no-blank-line exception
(a cell-5/cell-7 heading before a list) is implemented, recognises only `block.type ===
'heading'` as the preceding block; it has no case for a preceding paragraph that happens to
be "directions" text. So a directions paragraph immediately followed by an exercise-kind
list gets the ordinary 8.3.2a default blank line, not this exception.

Reproduced (read of the code, not a new test): `{type:'para', text:'Directions: Answer each
question.'}` followed by `{type:'list', kind:'exercise', items:[…]}` would format with a
blank line between them, in both BANA and UKAAF mode — the code path is identical to any
other paragraph-then-list sequence; nothing keys off "directions."

**What the standard requires:** no blank line between a "directions" line and the exercise
list it introduces.

**Classification:** **not built** — pending a decision on how a "directions" line should
even be represented in Emboss's model (a plain paragraph immediately preceding an
`exercise`-kind list, by position? a dedicated block/class, per `style-specification.md`'s
own open question on "Exercise Directions (BANA §10, BB Directions 5-5 / 7-5)")? That
representation question is itself open (see Q-13) — this finding is downstream of it, not a
simple formatter bug.

**Test that would prove a fix:** a `para` immediately followed by an `exercise`-kind `list`,
however "directions" ends up being marked, formats with NO blank line between them.

**Status: not fixed.**

---

## F-38 — Emphasis shared by every item of a list is never omitted

**Rule:** BANA 8.1.4a

> "Omit emphasis when the entire list uses the same print font attribute." (BANA 8.1.4a)

**What Emboss does:** `formatList` and the list case of `traceBlock`
(`Emboss/format/document.mjs:396-408,1788-1831`) pass each item's own `segments` straight to
`segmentsToBraille`/`o.translate` with `tf` preserved, whatever the rest of the list carries.
No code scans a list block's items to detect a font attribute shared by every one of them —
unlike headings and stage directions, where `stripEmphasis` (`document.mjs:109-111`) is
applied unconditionally (BANA 8.1.4a is instead a *conditional* strip, only when the whole
list is uniform, so it isn't simply a matter of reusing `stripEmphasis` as-is).

Reproduced (read of the code, not a new test): a 3-item list block whose every item's
`segments` carries `tf:4` (bold) would still emit a bold indicator on every braille line —
8.1.4a requires that be dropped once every item shares the one attribute; only 8.1.4b's
opposite case (some items italicised, others not) is currently exercised, by
`Emboss/format/test-deep-typeform-matrix.mjs`, and it correctly keeps the emphasis, but
nothing tests or implements the uniform-whole-list case.

**What the standard requires:** when literally every item of a list carries the same one
print font attribute (e.g. every entry in an italicised vocabulary list), that attribute
carries no distinguishing information and is dropped from the braille; when it distinguishes
some items from others, it is kept (8.1.4b, already `done`).

**Classification:** **bug** — a narrow one (it only fires when a whole list is uniformly
emphasised, which is presumably uncommon), but a plain miss against an "exact"-rated rule
with no ambiguity in its own wording.

**Test that would prove a fix:** a list block whose every item's `segments` carries the
identical non-zero `tf` value formats with NO emphasis indicator anywhere in the list; an
otherwise-identical list where only some items carry that `tf` keeps it on exactly those
items (the existing `test-deep-typeform-matrix.mjs` case, unchanged).

**Status: not fixed.**

---

## F-39 — A paragraph immediately introduced by a heading is not given the flush first line the gold corpus consistently shows

**Rule:** not pinned to one single BANA clause — see "What the standard requires" below —
but the pattern is confirmed directly and repeatedly against this section's own worked
examples/samples, independently of any one rule citation.

**What Emboss does:** `formatPara` (`Emboss/format/document.mjs:455-466`) and
`formatSegmentedPara` (`:583-593`) both compute the first line's indent as
`(isBlock || block.continuation) ? 0 : 2` — the only two ways to get a flush (0-indent)
first line are `o.paragraphStyle === 'block'` (a document-wide toggle, which also adds a
blank line after every paragraph — checked directly and confirmed wrong for this purpose)
or `block.continuation` (specifically the print-page-turn-resume flag, §1.11.3). Neither
applies to an ordinary paragraph that is the first paragraph of its own excerpt, immediately
introduced by a heading, so its first line always gets the standard cell-3 (2-cell)
first-line indent.

Reproduced against the §4 gold corpus (`Emboss/tests/gold/bana-formats-2016/section-4/`,
built and run via `node Emboss/scripts/gold-run.mjs --section section-4`): every one of the
following paragraphs' braille begins its first line completely flush at column 1 — the SAME
position as its own runover lines, not the usual 2-cell-deeper first line: `example-4-12`'s
paragraph after "REMEMBER" (a cell-5 heading with NO blank line before the paragraph);
`example-4-13`/`example-4-14`'s paragraph after "COMMUNITY SERVICE" (a CENTRED heading WITH
its own blank line before the paragraph — so this is not simply "no blank line before it");
`example-4-6`'s paragraph inside the box (also a centred heading, WITH a blank line before
the paragraph); `sample-4-01`'s "Objectives"/"Real-World Reading Link"/"Barriers" paragraphs
(cell-5/cell-7, no blank); `sample-4-02`'s two activity paragraphs (cell-7, no blank);
`sample-4-03`'s excerpt paragraph (cell-7, no blank); all three `sample-4-05-option-*`
files' Darwin paragraph (cell-5/cell-7, no blank); `sample-4-06`'s first paragraph (cell-5,
no blank). The one paragraph in this section that does NOT need this treatment —
`example-4-3`'s italic lead-in, which correctly keeps the ordinary 2-cell first-line indent
— also directly follows two connected centred headings with a blank line before it, so
"blank line or not" and "heading tier" do not, on their own, explain the difference; what
every flush case shares, and `example-4-3` alone does not, is being the excerpt's own very
first paragraph immediately under the heading(s) that introduce it (vs. `example-4-3`'s
paragraph, which — per its own `features`, "cut off at the bottom edge of the image" — reads
as a fragment of a longer passage that was already underway, not a fresh paragraph start).
Building the model from `print.blocks` and running it through the real `formatDocument`
reproduces the extra 2-cell indent on every flush case's first line as the *only* remaining
difference from the gold braille once each file's own content is otherwise correct (see
`differences.md` in that section's own reconciliation notes for the per-file before/after,
and the file's own `uncertain` array where this is flagged).

**What the standard requires:** exactly which BANA clause governs this was not pinned down
during this reconciliation — Paul may know the specific rule, or it may be page-layout
convention rather than a numbered rule — but the pattern itself is unambiguous and repeats
across eight independent worked items in this one short section: a paragraph that is the
very first thing under the heading(s) introducing an excerpt starts flush, at the same
column as its own runover, not at the ordinary first-line indent.

**Classification:** **not built / open question** — the exact triggering condition needs a
rule citation before it can be implemented with confidence; `joinsWithoutBlank`
(`document.mjs:195-200`) already has the right shape of exception (checking `prev.type ===
'heading'`) for the no-blank-line half of this pattern, but that alone doesn't explain the
centred-heading-with-blank-line cases (`example-4-6`, `example-4-13`, `example-4-14`) also
needing a flush paragraph, so this is flagged for Paul to identify the governing rule (or
confirm it is house convention, not a numbered BANA rule) before a fix is attempted.

**Test that would prove a fix:** once the triggering condition is known: a `heading`
followed immediately by a `para` block, in the configuration the rule actually specifies,
formats with the paragraph's first line flush at column 1, matching its own runover margin
— not the ordinary 2-cell first-line indent; `example-4-3`'s own case (a paragraph fragment
continuing already-underway text, not the excerpt's first paragraph) keeps the ordinary
2-cell indent, unchanged — this file's own regression guard must not flip that back to
flush by accident.

**Status: not fixed.**


**Rule identified (17 Sep 2026):** BANA 1.9.3 — "Use 1-1 margins for blocked paragraphs. A blank
line precedes each blocked paragraph, unless it follows a cell-5 or cell-7 heading." with the
exception "Use indented paragraphs when an entire text is printed in blocked paragraphs. Note this
change on the Transcriber's Notes page." The §4 excerpts are blocked in print, so the gold is
1-1. Fix: a per-paragraph blocked style that follows print (DTBook signal to be chosen, e.g.
`<p class="blocked">`; editor style), the 1.9.3 blank-line rule, and the whole-text exception
(when every paragraph is blocked, indent all and add the TN). gold-run should set it from
`print.blocks[].features` where the transcription says the paragraph is blocked. Classification:
bug (not done) — not a question for Paul.

**Status update (17 Sep 2026, fixed — per-paragraph blocked style, §1.9.3):** a `block.blocked`
flag is now **done**: the 1-1 margins, the blank-line rule with its cell-5/cell-7 exception, the
DTBook round trip, and the editor style are all wired to the real code paths, not a
reimplementation; the §1.9.3 exception clause (indent everything when an entire text is blocked)
is deliberately **not** auto-applied — see "Whole-text exception" below.

- **Model / formatter (BANA 1.9.3):** `formatPara`/`formatSegmentedPara`
  (`Emboss/format/document.mjs`) read a new `block.blocked` flag, independent of the existing
  document-wide `o.paragraphStyle === 'block'` toggle (which gets 1-1 margins right but adds
  its blank line *after*, not *before*, every paragraph — confirmed wrong for this rule, kept
  unchanged for whatever else relies on it). A blocked paragraph gets `first = 0` (flush,
  matching its own runover, also 0) and an unconditional leading blank line, standing in for
  the rule's default "a blank line precedes each blocked paragraph". `joinsWithoutBlank`
  gained one more case: once a `heading` is confirmed not `centred` (the existing check), a
  following `blocked` paragraph joins with no blank — exactly the rule's own exception,
  "unless it follows a cell-5 or cell-7 heading" (`banaTier` can only be `cell5`/`cell7` at
  that point). `traceBlock`'s `paraLike` and its own `case 'para'` segments branch mirror both
  changes exactly (parity proven below). Tests: `Emboss/tests/blocked_paragraphs.test.mjs`
  (1-1 margins, plain and segmented; blank line before a blocked paragraph after an ordinary
  paragraph and after a centred heading, collapsing with the heading's own trailing blank to
  exactly one; no blank after a cell-5 or cell-7 heading; a regression check that an
  *unblocked* paragraph after a cell-5 heading is unaffected).
- **DTBook round trip:** `<p class="blocked">` (`parseDtbook`'s `makeP`, `Emboss/input/
  parse.mjs`) — checked directly for clashes against every other `p` class this parser reads
  (`bai-play`, `-verse`, `-stage`, `byline`/`attribution`, `quote`/`blockquote`/`extract`,
  `-stanza-break`, `bana-break-*`): none share a substring with `blocked` (`'blockquote'.
  includes('blocked')` is false), so the check is a safe, independent `cls.includes('blocked')`
  add-on to the existing plain-paragraph branch, not a reordering. `exportToNimasXml`'s `case
  'para'` (`Emboss/input/nimas-export.mjs`) writes it back, combined with the pre-existing
  `level-N` class token (nesting) rather than replacing it — `<p class="blocked level-2">`.
  `parseSidebar` (`Emboss/input/parse.mjs`) has its own, separate copy of `makeP` for `<p>`
  inside a `<sidebar>`/box — the §4 gold corpus's own Example 4-6 is exactly this case (a
  blocked paragraph inside a box) — so both copies were updated identically; `exportToNimasXml`
  needed only the one change, since a box's child blocks already recurse through the same
  top-level `case 'para'`. Tests in `blocked_paragraphs.test.mjs`: a top-level `<p
  class="blocked">`, a plain `<p>` (unaffected), the `level-N` combination, and a `<p
  class="blocked">` inside a `<sidebar>`.
- **Editor style ("Blocked Paragraph", alongside the existing paragraph style):**
  `Emboss/format/styles.mjs` gained a `blocked` entry in `STYLE_DEFINITIONS` (1-1, blank
  before, `xmlClass: 'blocked'`) for the Style Inspector. `Emboss/web/editor/editor.mjs`
  follows the existing `getPageTurn`/`getNote` prototype-extension pattern exactly:
  `ParagraphNode.prototype.getBlocked`/`setBlocked` (backed by `__blocked`), wired into
  `afterCloneFrom`, `createDOM`/`updateDOM` (a `bana-blocked` CSS class), `exportJSON`/
  `updateFromJSON`/static `importJSON`, `paraBlock()` (Lexical → model) and `appendBlock()`
  (model → Lexical). Because it layers onto whatever paragraph style is already selected
  (a plain body paragraph can be blocked; a quote/attribution/etc. paragraph ignores the flag
  entirely, matching the formatter), it is a new toolbar toggle button (`btnBlockedPara`,
  `index.html`, next to the `blockStyle` dropdown) rather than one more mutually-exclusive
  dropdown option, following bold/italic/underline's own toggle-button pattern. Not
  separately unit-tested here because `editor.mjs` cannot be imported under plain Node (see
  F-4/F-5's identical caveat about `TableNode`) — reviewed by hand against the pattern it
  mirrors; the model-level round trip it feeds (`paraBlock`/`appendBlock`) is exercised
  indirectly by every other editor-model test that already passes unchanged.
- **Locale note:** the new style name and toolbar label
  (`app.style_names.blocked` = "Blocked Paragraph", `app.styles.blocked_paragraph`) were added
  to `Emboss/web/locales/en.json` **only**, per instruction — every other language falls back
  to English for this string until translated.
- **Whole-text exception (§1.9.3's own exception clause):** "Use indented paragraphs when an
  entire text is printed in blocked paragraphs" is a whole-document editorial judgement, not
  something the formatter should decide or silently un-apply on the transcriber's behalf, so
  it is surfaced as a `loadWarnings` notice (`Emboss/input/load-audit.mjs`,
  `blockedParagraphCounts`) instead of being automated: when every ordinary (unstyled) body
  paragraph in the loaded document is blocked, the transcriber is told and can choose to
  switch to indented paragraphs and add the Transcriber's Note themselves. A styled paragraph
  (quote, attribution, ...) is excluded from the count — it ignores its own `blocked` flag
  regardless, so it plays no part in "an entire text ... in blocked paragraphs". A document
  needs at least two such paragraphs to trigger the notice (a single-paragraph document
  trivially has "every paragraph blocked" without that being a meaningful whole-text signal)
  — a deliberate implementation threshold, not read from the rule text itself; flagged here in
  case Paul wants it lowered to one. Proven both as a unit (`blocked_paragraphs.test.mjs`:
  fires on an all-blocked multi-paragraph document, not on a mixed one, not on a single
  paragraph, and ignores styled paragraphs) and end-to-end through the real export → parse
  pipeline (`exportToNimasXml` then `parseDtbook`, checked by hand during this fix).
- **`gold-run.mjs` (§4 builder, print fields only, never `braille`):** the exact
  `print.blocks[].features` wording this finding's own write-up expected ("blocked"/"flush")
  turned out not to be present verbatim anywhere in the reconciled §4 gold corpus (checked
  directly, `grep -rn` across every file) — the reconciliation's own wording is different, and
  a real, non-circular signal had to be re-derived from `print` alone rather than assumed.
  `buildModel4` now sets `para.blocked = true` when EITHER (a) the paragraph immediately
  follows a *standalone* `heading` print block — verified directly against every gold file's
  own agreed `braille.lines`: an excerpt's opening paragraph, right under the heading(s)
  introducing it, is flush, while a later, non-heading-adjacent paragraph in the same excerpt
  is not (e.g. `sample-4-01`'s two "Nonspecific Immunity" paragraphs — the first, heading-
  adjacent, is flush; the second is not) — "standalone" excludes the second (or later) heading
  of a run of connected CENTRED headings (§4.3.3, "do not insert a blank line between
  connected headings" — one conceptual heading split across lines: title+author, chapter-
  number+title, unit-number+title, all level 1); `example-4-3`'s paragraph directly follows
  such a pair ("Theme 1"/"Transitions") and is that section's own worked illustration of
  4.3.3, not of a paragraph opening under a heading — its own resolution note calls it "an
  ordinary paragraph". This is level-specific, not "any connected run": `sample-4-05-option-2`'s
  two CELL-5 headings ("Connection to History"/"The tree of life") are connected the same way
  but for a different reason (§4.5.6, "an equally important cell-5 heading" — each
  independently able to introduce content, confirmed by its own gold braille keeping the
  following paragraph flush), so only level-1 runs are excluded. Or (b) the paragraph's own
  `features` names it a run-in (paragraph) heading — checked directly, `grep -rn "run-in"
  .../section-4/*.json`: "run-in (paragraph) heading"/"run-in heading"/"bold run-in heading" —
  e.g. `sample-4-01`'s "Skin barrier"/"Chemical barriers" sub-paragraphs, confirmed flush by
  that file's own `notes` field.
- **Gold result (`node Emboss/scripts/gold-run.mjs --section section-4 --update-status`):**
  **4 → 9 matches** of 25 (16 not affected by this finding: 6 not-representable, 1 no-braille,
  9 still mismatch for other, already-tracked reasons). Newly matching: `example-4-12`,
  `example-4-13`, `example-4-14`, `sample-4-05-option-1`, `sample-4-05-option-2`.
  `example-4-3`/`example-4-4` were already matching and stay matching (the level-1 connected-
  run exclusion above keeps `example-4-3`'s own non-blocked paragraph correct). Every sample
  that still mismatches now fails on a *different*, later line than before — each one checked
  by hand against its own `--sample` diff and confirmed to be a pre-existing, separate,
  already-documented gap this fix does not touch: `example-4-6` (a box-nested paragraph's
  runover indents 2 cells in the gold, not 0 — a box-content-nesting question this fix's own
  1-1 margins do not address, newly exposed, not previously a tracked finding; flagged for
  Paul/a follow-up finding, out of scope here), `example-4-7`/`example-4-15`/`example-4-2`
  (unrelated wrap/typeform/line-count gaps, pre-existing), `sample-4-01`/`-02`/`-03`/`-06`
  (pre-existing typeform/indicator/list-structure bugs — `sample-4-01` in particular has
  several independent, already-known issues per its own gold README), `sample-4-05-option-3`
  (the already-flagged `@#7...@#'` typeform-bracket mismatch). No regression:
  `--section section-8` and `--section section-11` (and `section-7`, added by another agent
  during this fix) report byte-identical status counts before and after.

---

## F-40 — A long centred heading is divided by generic greedy word-wrap, not at a "logical, balanced" break

**Rule:** BANA 4.4.3

> "When a centered heading must be divided because it is too long to fit on one line, divide
> it at a logical break in the wording, keeping the two (or more) lines reasonably balanced in
> length, rather than filling each line to the maximum width." (BANA 4.4.3, as illustrated by
> Example 4-8)

**What Emboss does:** `formatHeading`'s centred tier (`Emboss/format/document.mjs:243`) calls
`centredBlock(plainT(), w, Math.max(1, w - 6))`, which wraps the translated text with the
same generic greedy word-wrap (`wrapCells`/`wrapCellsSrc`, `format/layout.mjs`) used
everywhere else in the formatter — fitting as many words as will physically fit on each line
— with no heading-specific logic to prefer a "logical" phrase break or to balance the two
resulting lines' lengths.

Reproduced against the §4 gold corpus: `example-4-8` ("Using Natural Resources in the United
States", too long for one 40-cell braille line) is this section's own worked illustration of
rule 4.4.3. Its gold braille divides the heading as "USING NATURAL RESOURCES" / "IN THE
UNITED STATES" — a break after the fourth word, leaving the first line under-full — but
Emboss's greedy wrap instead produces "USING NATURAL RESOURCES IN THE UNITED" / "STATES",
filling the first line to capacity and stranding a single word on the second. Building the
model from `print.blocks` (a single `heading` block, `level:1`, the full title text) and
running it through the real `formatDocument` reproduces this exact wrong break as the only
difference from the gold braille for this sample (see `node Emboss/scripts/gold-run.mjs
--section section-4 --sample example-4-8`).

**What the standard requires:** the heading is divided at a logical point in the wording
(here, the natural phrase boundary between "...Natural Resources" and "in the United
States"), with the resulting lines kept reasonably balanced, not divided arbitrarily by
whatever fits.

**Classification:** **not built** — this needs heading-specific wrap logic (candidate break
points scored by "how logical" and "how balanced," which for an automatic formatter likely
means preferring a break after a natural phrase/clause rather than mid-phrase, and preferring
the split whose two line-lengths are closest) that does not exist anywhere in the codebase;
a plain reuse of the generic word-wrap cannot satisfy this rule for an arbitrary heading.

**Test that would prove a fix:** a single long centred heading whose greedy word-wrap would
strand one short word alone on a second line, but which has an earlier, more balanced break
point at a natural phrase boundary, formats divided at that earlier break instead.

**Status update (17 Sep 2026, fixed):** a new `balancedWrapWidth`/`centredHeadingBlock` pair
(`Emboss/format/document.mjs`, next to `centredBlock`) replaces `centredBlock` ONLY in
`formatHeading`'s BANA centred branch (every other centred use — the document title, UKAAF's
own L1 heading, a table heading, "Contents"/volume titles — keeps plain `centredBlock`
unchanged, since §4.4.3's balanced-division requirement is specific to centred HEADINGS).
`balancedWrapWidth` finds the NARROWEST wrap width that still needs the same (minimum) number
of lines `wrapCells`' own greedy fill needs at the full wrap width — binary search, since
greedy line count is monotonic non-increasing in width — then wraps at that narrower width;
this can never split a word (the search floor is the longest word) and never adds a line
beyond the minimum. `tcCentredHeadingBlock` mirrors it exactly for the cell-trace path.
Verified against `example-4-8` at width 40 (wrapWidth 34): the old code produced 33/7-cell
lines (only "STATES" stranded); the fix produces 23/17, breaking after "RESOURCES" — the
gold braille exactly (`node Emboss/scripts/gold-run.mjs --section section-4 --sample
example-4-8` now MATCHES; previously MISMATCH). `Emboss/tests/heading_balanced_wrap.test.mjs`
proves this against the real gold braille (via the real liblouis translator, exactly as
gold-run.mjs builds it) plus a synthetic case whose expected split is derived independently
by brute force (trying every valid word-boundary split into the minimum line count and
picking the one whose longest line is shortest) rather than read off Emboss's own output,
with a formatBlock/traceBlock parity check in both cases, and a same-line/no-op regression
case. Gold result: `--section section-4 --update-status` moves `example-4-8` from `mismatch`
to `match`; every other sample's status is unchanged (`--section section-11` also
unaffected). A DTBook built with `exportToNimasXml` for this exact heading, re-parsed with
`parseDtbook` and formatted, round-trips with the balanced break intact and passes
`Emboss/scripts/daisy-validate.mjs` (0 errors, 7 suppressed known-bug `<meta>` warnings).

---

## F-41 — Rule 4.3.7's "unless necessary for clarity" exception for heading typeform is not implemented

**Rule:** BANA 4.3.7

> "Do not use typeform to indicate specific print attributes such as italics, boldface, and
> font style/size for print headings unless it is necessary for clarity." (BANA 4.3.7, as
> illustrated by Example 4-7)

**What Emboss does:** `formatHeading`'s `plainT()` (`Emboss/format/document.mjs:233`)
unconditionally calls `stripEmphasis(block.segments)` before translation for every centred,
cell-5, and cell-7 heading, with no code path that ever keeps a heading's typeform — the
"unless necessary for clarity" exception has no representation at all; the general rule
(drop typeform in headings) is implemented, but its own explicit exception, which the
section's OWN worked example exists specifically to illustrate, is not.

Reproduced against the §4 gold corpus: `example-4-7` ("Henrik Ibsen, *A Doll's House*" — the
title is italicised in print specifically so the reader can tell where the author's name
ends and the play's title begins, i.e. exactly the "necessary for clarity" case) and
`sample-4-03`'s two-line "Restif de la Bretonne, / *Nocturnal Spectator*" heading (same
exception, a work title needing to stay distinguishable from the two-line heading's other
half) both lose their italics entirely when built as `heading` blocks and run through the
real `formatDocument` (`node Emboss/scripts/gold-run.mjs --section section-4 --sample
example-4-7` / `--sample sample-4-03`) — the gold braille's typeform brackets around the
title portion are simply absent from Emboss's output, with every other character of both
lines otherwise correct. (The SAME italic markup on a `para`-type block, not a `heading`
block, is correctly preserved elsewhere in this same gold corpus, e.g. the book title in
`sample-4-05`'s Darwin paragraph — confirming the loss is specific to `formatHeading`'s
unconditional strip, not a general markup-handling defect.)

**What the standard requires:** typeform inside a heading is dropped by default (the common
case, correctly implemented), but is KEPT when needed to distinguish two parts of the heading
that would otherwise be ambiguous — the exact case both worked examples above illustrate.

**Classification:** **not built** — there is no signal in the current block schema for "this
heading's typeform is clarity-necessary, keep it," so this is a modelling gap as much as a
formatter one; at minimum, `formatHeading` would need an opt-in (e.g. a `block.keepEmphasis`
flag, set only where the source itself needs the distinction) rather than the current
unconditional `stripEmphasis`.

**Test that would prove a fix:** a heading block whose segments carry `tf` and an explicit
"keep this" signal formats WITH its typeform indicator preserved around exactly the marked
segment; an otherwise-identical heading with no such signal keeps today's behaviour
(typeform stripped).

**Status: not fixed.**

---

# Standards findings — lists, gold §8 reconciliation (assessed 17 Sep 2026)

*(Found while reconciling the two independent §8 gold transcriptions against Emboss's
actual output via `Emboss/scripts/gold-run.mjs --section section-8`; F-33 through F-38
above already cover this section's assessed-but-not-yet-gold-tested gaps. The three
findings below are additional, specific defects/gaps this reconciliation's own
gold-file-vs-Emboss comparison newly surfaced.)*

## F-42 — No way to combine an ordinal list marker with a print bullet on one item, and no "align the beginning character" support for a list where only some items are bulleted

**Rules:** BANA 8.7.1.a (partial), 8.7.1.b (not done)

> "To indicate that only some items in the list have bullets or other print indicators,
> such as pictures: a. Follow print for the symbol used as a bullet. The bullet begins
> in cell 1 and is followed by a space. Symbols used must be listed in a transcriber's
> note or placed on the Special Symbols page. b. Align the beginning character of all
> items. Runovers are two cells to the right of the beginning of the items." (BANA
> 8.7.1.a-b)

**What Emboss does:** `formatList` (`Emboss/format/document.mjs:396-408`) builds an
item's leading text as `marker = item.marker ? item.marker + ' ' : ''`, with one special
case (`item.marker === '•'`) for the primary bullet. An item's `marker` field can hold
EITHER an ordinal ("1.", "2.") OR a bullet glyph, never both, and there is no mechanism
to left-pad an unbulleted item's own ordinal so that it starts at the SAME cell as a
bulleted sibling's ordinal (8.7.1.b's "align the beginning character of all items").
Reproduced directly against BANA Formats 2016's own Example 8-5a/8-5b (a 3-item numbered
list where only item 2 additionally carries a print bullet): the gold braille shows item
2 as `_4 #b4 ...` (bullet in cell 1, its own number "2." beginning at cell 4) and items 1
and 3 as `   #a4 ...` / `   #c4 ...` (three leading blank cells, so THEIR numbers also
begin at cell 4) — i.e. every item's number is aligned to the same column regardless of
whether it individually carries a bullet. Built from this reconciliation's own gold
model (`Emboss/tests/gold/bana-formats-2016/section-8/example-8-5a.json`, item 2 carrying
both `marker:"2."` and `bullet:"dot"`), `gold-run.mjs`'s `buildModel8` can only build ONE
of the two per item (see its own recorded limitation) — Emboss has no way to produce
either the compound "bullet + aligned ordinal" rendering for the bulleted item, or the
blank-padded alignment for the unbulleted ones.

**What the standard requires:** in a list where only some items are bulleted, the
bulleted item's own bullet-then-ordinal (or bullet-then-text) sequence, AND every
unbulleted item's own ordinal/text, must all begin their "real" content (the character
after the bullet, where present) at the identical cell.

**Classification:** **not built** — a distinct gap from F-33 (which is about bullet
*shape* fidelity, i.e. which correspondence symbol to use); this is about a completely
absent alignment/combination mechanism for the specific "only some items bulleted" list
shape (8.7.1), which has no partial implementation to extend.

**Test that would prove a fix:** a 3-item list where only item 2 carries a print bullet
formats with item 2 as `<bullet> <space><ordinal> text` and items 1/3 as `<blank
cells the same width as "<bullet><space>"><ordinal> text` — every item's ordinal
beginning in the same cell.

**Status: not fixed.** (Confirmed against `Emboss/tests/gold/bana-formats-2016/
section-8/example-8-5a.json` / `example-8-5b.json`; no code changed producing this
finding — `document.mjs` was not touched, per this task's own scope.)

---

## F-43 — A box's own trailing blank line is not collapsed against a following paragraph, producing one extra blank line

**Rule:** not pinned to one specific BANA clause — a general box/blank-line mechanics
question, exercised here by the gold corpus's own worked example.

**What Emboss does:** `sample-8-04` (Simple Boxed List) models as `[paragraph("text"),
box[heading, list], paragraph("text")]` — a boxed heading+list sandwiched between two
placeholder paragraphs representing the book's own elided-surrounding-text convention.
Every line INSIDE the box (the heading, the top/bottom `7...7`/`g...g` rules, and all
five list items) matches the gold braille byte-for-byte. The only difference, beyond the
already-expected/documented placeholder-text limitation (the "444" ellipsis has no
print-side input, F-\* — see the file's own `resolution`), is that Emboss's actual output
inserts ONE EXTRA blank line between the box's closing (bottom rule) and the second
placeholder paragraph that the gold braille does not have — `document.mjs`'s own comment
on `buildDocPages` (around the "adjacent-blank dedup" logic quoted in gold-run.mjs's own
header comment) describes exactly this kind of collapsing for two ordinary blocks, but
this specific box-then-paragraph transition does not appear to be covered by it.

**What the standard requires:** BANA §7 (Boxed Material) calls for a single blank line
around a box, not two; a plain paragraph immediately following a box's bottom rule should
not accumulate an extra blank line beyond the box's own trailing one.

**Classification:** **bug** (narrow, box→paragraph-specific) — reproduced directly via
`node Emboss/scripts/gold-run.mjs --section section-8 --sample sample-8-04`, which shows
the box's own internal content matching exactly and the sole remaining structural
difference (beyond the documented placeholder-text gap) being this one extra blank line
right after the box's bottom rule.

**Test that would prove a fix:** a document `{blocks:[{type:'box',
blocks:[...]}, {type:'para', text:'...'}]}` formats with exactly ONE blank line between
the box's bottom rule and the paragraph's own first line, not two.

**Status: not fixed.** (`document.mjs` was not touched to investigate or fix this — out
of this task's scope; recorded for a future session. No code or tests changed producing
this finding beyond the gold file and `gold-run.mjs`'s own `buildModel8`.)

---

## F-44 — Paragraph margin/line-break has no per-context override; a book's own "directions" and short introductory-sentence conventions are always given the single default indented (3-1) treatment

**Rules:** BANA 8.3.3.c (context only — see F-37 for the blank-line half of this same
gap)

**What Emboss does:** `formatPara` (`document.mjs`) has exactly one non-quote paragraph
treatment in BANA mode: 3-1 margins (first line indented 2 cells, runover flush), the
whole paragraph's text flowed and greedily word-wrapped as one continuous run — there is
no signal in the `para` block type for "this paragraph should use a different fixed
margin" or "this paragraph's own sentence boundaries are real line breaks, not just
wrap points." Reproduced directly against two of this section's own worked examples:
- `example-8-4` ("Write the principal parts for each verb. Use your dictionary if
  needed.", the two-sentence "directions" text immediately preceding an exercise-kind
  list): the gold braille gives EACH sentence its own braille line, both indented 4
  cells (a cell-5-like margin, not 3-1) — Emboss's default 'indented' paragraph
  treatment instead greedily wraps the concatenated two-sentence text as one continuous
  paragraph at the ordinary 3-1 margin, merging the two sentences across line
  boundaries wherever they happen to fit.
- `example-8-6` (the boxed illustration's one-sentence introduction, "This is his wish
  list from the Louis L'Amour collection. Bulleted items are out of stock."): the gold
  braille gives this paragraph a flush (1-1, no first-line indent) margin, not the
  default 3-1 indent Emboss produces.
Both are the SAME underlying gap — no per-block/per-context paragraph margin or
line-break override — surfacing as two different concrete symptoms.

**What the standard requires:** BANA Formats §10 (Exercise Material, cross-referenced by
8.3.3.c) evidently gives "directions" text its own distinct margin/line-break
convention, separate from ordinary running prose; introductory sentences inside a boxed
illustration in this book are set flush. Neither convention is representable from
Emboss's current single fixed paragraph treatment.

**Classification:** **not built** — closely related to, but distinct from, F-37 (which
is specifically about the missing/extra BLANK LINE before a directions-introduced list);
this finding is about the directions paragraph's own MARGIN and LINE-BREAK behavior, and
about a plain introductory paragraph's margin choice, neither of which F-37 covers.
Blocked on the same open representation question as F-37 (Q-13: how should "directions"
be marked in Emboss's model at all?) for the 8.3.3.c half; the flush-introductory-sentence
half (example-8-6) has no rule citation of its own found in this section and may be a
book-specific stylistic choice rather than a testable BANA requirement — flagged with
lower confidence for that reason.

**Test that would prove a fix:** (1) a paragraph explicitly marked as "directions"
immediately preceding an exercise-kind list formats with each of its sentences on its
own line, indented 4 cells (cell-5-like), matching Formats §10's own convention once that
representation question (Q-13) is settled. (2) A paragraph explicitly marked "flush"
(however that ends up being represented) formats with no first-line indent.

**Status: not fixed.** No code changed producing this finding — `document.mjs` was not
touched, per this task's own scope.

---

# Standards findings — general formats (BANA §1, B004 §6–9; assessed 17 Sep 2026)

## F-45 — No computation of implied/inferred print page numbers

**Rules:** BANA 1.11.5, 1.11.5a, 1.11.5b

> "For a number of reasons, a print page may not show a page number, yet it is implied. In
> braille, the print page number is inserted whether or not it appears in print." (1.11.5)

**What Emboss does:** a `pagenum` block only ever carries the literal `page` string given by
the source markup (`Emboss/input/parse.mjs` — every `pagenumBlock()`/`<pagenum>` reader takes
`text`/`value` verbatim; grep confirms no arithmetic on it). `formatPageNum`
(`Emboss/format/document.mjs:830-850`) requires that string to be truthy or emits nothing.
Nothing in the pipeline infers a missing number from its neighbours (e.g. "the page after 41
must be 42").

**What the standard requires:** an implied number must still appear in braille, even when
print shows none (an image covering the number; front matter that starts mid-sequence).

**Classification:** not done. This is mechanizable (increment from the last known number) but
unbuilt; the current behaviour is a straight pass-through of whatever the DTBook source
already encodes.

**Test that would prove a fix:** a document with `pagenum` pages `40`, (missing), `42` where
Emboss is expected to insert an implied `41`.

---

## F-46 — Combined/omitted print-page-number ranges are pass-through text, never computed

**Rules:** BANA 1.11.8, 1.11.8a, 1.11.8c, 1.12.1

> "Combine the initial roman or arabic number with the number of the page on which the text
> section actually begins (e.g., i-v, I-V, or 1-5) and place this combined page number at the
> right margin." (1.11.8a)

**What Emboss does:** whatever string a `pagenum` block carries (e.g. `"1-5"`, `"44-45"`) is
translated and placed at the right margin like any other page number
(`formatPageNum`/`banaRunningHead`, `Emboss/format/document.mjs:830-850`,
`Emboss/format/page.mjs:62-80`) — confirmed because `banaPageChangeNumber`'s regex
(`Emboss/format/page.mjs:92-97`, `^-{3,}([^-\s]\S*)$`) accepts any non-space run, hyphens
included, and the continuation-letter machinery then carries that same combined string forward
page to page. So *placement* of an already-decided combined number is done; *deciding* the
range (which pages were blank/omitted, where the arabic sequence actually starts) is never
computed — the source markup must already contain the finished string.

**What the standard requires:** the transcriber (here, Emboss) works out which print pages are
combined and produces the range itself.

**Classification:** partial — placement mechanism done, decision logic not done.

---

## F-47 — Facing-pages-as-one-page (1.12.1) is the same pass-through as F-46

**Rules:** BANA 1.12.1 (see F-46; listed separately because it is its own map row)

Same evidence and classification as F-46: **partial**.

---

## F-48 — No letter/number page-identifier transformation (hyphen omission, word→letter substitution)

**Rules:** BANA 1.13.1c, 1.13.1d, 1.13.1e, 1.13.1f

> "Omit the print hyphen; a transcriber's note noting this change to print is required."
> (1.13.1c)
> "Words preceding page numbers are changed to an appropriate uppercase letter, e.g., change
> Reference 1 to R1." (1.13.1d)

**What Emboss does:** a page-identifier string (e.g. `"S1-7"`, `"Reference 1"`) is rendered
character-for-character by `o.translate` with no substring transformation anywhere in
`Emboss/input/parse.mjs` or `Emboss/format/document.mjs` (grep for a hyphen-stripping or
word→letter substitution in the page-number path finds nothing), and no Transcriber's Note is
auto-generated for either change. Also affects `buildToc` (`Emboss/format/document.mjs:2412`),
which never performs the "same method" cross-reference substitution 1.13.1e asks for.

**What the standard requires:** the print hyphen is dropped, a preceding word becomes an
uppercase letter, and both changes are recorded on the Transcriber's Notes page (see F-57 for
the missing TN-page feature itself).

**Classification:** not done, all four rows.

---

## F-49 — No spelled-out (alphabetic) page-number feature at all

**Rules:** BANA 1.14.1, 1.14.1a, 1.14.1b, 1.14.1c, 1.14.1d, 1.14.1e, 1.14.1f, 1.14.1g

> "Some books include spelled out (alphabetic) print page numbers in addition to the numeric
> numbers... it is important to include both numeric and alphabetic numbers in braille."
> (1.14.1)

**What Emboss does:** a `pagenum` block has exactly one `page` field; there is no companion
alphabetic field anywhere in the data model (`Emboss/input/parse.mjs`), and neither
`formatPageNum` nor `banaRunningHead` (`Emboss/format/document.mjs:830-850`,
`Emboss/format/page.mjs:62-80`) has a second line, position, or six-cell dots-36 lead-in for
it. Grep for "alphabetic"/"spelled out" across `Emboss/format/*.mjs` finds nothing related to
page numbers.

**What the standard requires:** every numeric page number that print also spells out in words
must get a second, specially-placed alphabetic line, with its own placement/continuation/
combined-number rules (1.14.1a-g).

**Classification:** not done, all eight rows — one missing feature, not eight separate gaps.

---

## F-50 — Continuation letters beyond `z` use bijective base-26 (AA, AB, AC…), not BANA's doubled-letter scheme (aa, bb, cc…)

**Rules:** BANA 1.11.7c

> "Use double letters, aa, bb, etc., when the continuation page number goes beyond z."

**What Emboss does:** `continuationPrefix(idx)` (`Emboss/format/page.mjs:12-20`) is a plain
bijective base-26 counter. Reproduced directly (node REPL against `page.mjs`):

```
continuationPrefix(26) -> "Z"
continuationPrefix(27) -> "AA"
continuationPrefix(28) -> "AB"
continuationPrefix(29) -> "AC"
```

BANA's own rule wants the 27th, 28th, 29th continuation pages labelled `aa`, `bb`, `cc` — the
same letter doubled, incrementing which letter is doubled, not a two-letter alphabetic count.
`Emboss/tests/test-printpage.mjs`'s continuation tests only exercise `a`/`b` (page 1's first
two continuations), so this divergence is untested and unnoticed.

**Classification:** bug. Any book whose print page runs past 26 braille-page continuations
(a long, page-1-only chapter) gets the wrong continuation letters from the 27th one onward.

**Test that would prove a fix:** `continuationPrefix(27) === 'aa'`, `continuationPrefix(28) ===
'bb'`, `continuationPrefix(52) === 'zz'`, `continuationPrefix(53) === 'aaa'` (per the same
doubling pattern one level deeper, by analogy — Q-15 asks Paul to confirm the 53rd+ case, since
the rule text only gives examples up to double letters).

---

## F-51 — No "unnumbered print page change" concept: the whole of BANA §1.11.6 is unreachable

**Rules:** BANA 1.11.6a, 1.11.6c, 1.11.6d, 1.11.6e

> "Insert a row of unspaced dots 36 across the width of the line to indicate print page
> changes." (1.11.6a, for a book/section with no print page numbers at all)

**What Emboss does:** `formatPageNum` (`Emboss/format/document.mjs:830-833`) returns `[]`
whenever a `pagenum` block's `page` value is empty — there is no "page changed but not
numbered" block/marker type in the data model at all, so the bare full-width dots-36 row this
section describes can never be emitted (confirmed by `page.mjs:90`'s own comment: "a bare row
of dots 36 with no number... is not a numbered indicator and returns null"). Because that
marker doesn't exist, its page-25/page-1/running-head placement rules (1.11.6c/d/e) have no
code to place at all.

**Classification:** not done, all four rows — one missing block type, not four gaps.

---

## F-52 — No double-spacing feature exists

**Rules:** BANA 1.7.1b, 1.7.2a, 1.7.2b, 1.7.2c, 1.7.2d, 1.7.2e, 1.7.2f, 1.7.2g, 1.7.2h, 1.7.2i

> "An agency may request double-spacing." (1.7.1b) / "Use two blank lines wherever there is
> normally one blank line." (1.7.2a)

**What Emboss does:** grep across `Emboss/format`, `Emboss/web`, `Emboss/input` for
"doublespac"/"double-spac"/"double spac" finds nothing but an unrelated string-literal comment
in vendor speech code. There is no settings field, no UI control, and no formatter branch for
double line spacing anywhere.

**Classification:** not done, all ten rows — a single absent feature.

---

## F-53 — No print-interlining feature

**Rule:** BANA 1.7.3

> "If print interlining is requested, the print must appear word-for-word above the braille."

**What Emboss does:** grep for "interlin" across the format/input/editor code finds nothing.
No import path, data field, or export mode produces print-above-braille interlining.

**Classification:** not done.

---

## F-54 — No end-of-volume / end-of-book statement feature

**Rules:** BANA 1.6.5, 1.6.5a, 1.6.5b, 1.6.5c, 1.6.5d, 1.6.5e, 1.6.5f, 1.6.5g, 1.6.5h

> "In each volume include a centered-and-numbered volume statement enclosed in transcriber's
> note indicators: End of Volume __." (1.6.5a)

**What Emboss does:** grep for "End of Volume"/"The End"/"end.of.volume" across
`Emboss/format/document.mjs` finds nothing. `formatVolumes`
(`Emboss/format/document.mjs:3044-3064`) ends a volume's BRF the moment its page budget runs
out — no statement, centred or otherwise, is ever appended, and none of the placement rules
that depend on it (last-line-of-page fit, carry-one-line-over, "Curtain Falling" for plays)
have anything to attach to.

**Classification:** not done, all nine rows — one missing feature.

---

## F-55 — No "Preliminary Volume" / "Supplement" labelling

**Rules:** BANA 1.6.3, 1.6.3a, 1.6.3b, 1.6.3c, 1.6.4a, 1.6.4b

**What Emboss does:** `volumeTitlePage` (`Emboss/format/document.mjs:3016-3034`) only ever
produces `"VOLUME N OF M"`; there is no concept of a volume composed entirely of front matter
("Preliminary Volume") or back matter ("Supplement"), no arabic-number-when-more-than-one
variant, and no agency toggle to call the first volume "Volume 1" instead of "Preliminary
Volume" (1.6.3c — mechanizable, simply unbuilt).

**Classification:** not done, all six rows.

---

## F-56 — Volume splitting is a pure page-count cutoff; it never respects a "logical content break"

**Rules:** BANA 1.6.1a, 1.6.1b

> "End a braille volume with a logical break in content, e.g., at the end of a unit, part,
> chapter, or section." (1.6.1a) / "Adherence to this principle is more important than
> maintaining uniform volume size." (1.6.1b)

**What Emboss does:** `formatVolumes` (`Emboss/format/document.mjs:3044-3064`) slices
`b.bodyPages` every `o.volumePages` pages with `Array.slice`, with no awareness of heading
level or chapter boundaries. `Emboss/tests/volume-splitting.test.mjs`'s own multi-volume test
proves this by design ("Split every 5 body pages") — a chapter is routinely split mid-page
across two volumes in that test.

**Classification:** not done, both rows — the only way to honour 1.6.1a today is for whoever
picks `volumePages` to happen to land it on a chapter boundary by hand.

---

## F-57 — The per-volume title page carries no braille page number at all

**Rules:** BANA 1.15.1, 1.15.1a (partial, for this page only)

> "All pages, including transcriber-generated and front matter pages, must have a braille page
> number." (1.15.1)

**What Emboss does:** `volumeTitlePage` (`Emboss/format/document.mjs:3016-3034`) returns its
lines straight to `toBRF` with no `brailleNumber`/footer call anywhere in the function.
Reproduced directly: a two-volume BANA document's volume-2 title page renders as

```
========================================

               TEST BOOK

             VOLUME 2 OF 2




...(blank lines)...
========================================
```

— no `#`-prefixed braille page number anywhere on the page. Every other page type Emboss
generates (body pages via `assemble`, TOC pages via `buildToc`) does get a number.

**Classification:** bug (a concrete, real front-matter page violates the "all pages" rule).
Doesn't affect body pages or TOC pages, which are numbered correctly (see 1.15.1a done for
those).

**Test that would prove a fix:** the reproduction above, asserting the volume title page's
last (or bottom-right) content contains a `#`-prefixed number, e.g. `t#A` per F-58's own
recommended prefix.

---

## F-58 — Only the TOC gets a front-matter ('P') page-number prefix; nothing ever gets the transcriber-generated ('t') prefix

**Rules:** BANA 1.15.1b, 1.15.1c (partial — see also F-57)

> "Precede transcriber-generated braille page numbers by t." (1.15.1b) / "Precede print front
> matter braille page numbers by p." (1.15.1c)

**What Emboss does:** `buildToc` (`Emboss/format/document.mjs:2450`) does prefix its own page
numbers with `'P'` (the comment literally says "preliminary page number, e.g. P#A") — so
1.15.1c is done for the one front-matter page type Emboss actually generates. But grep for a
`'t' + brailleNumber(...)` (or equivalent) anywhere in `document.mjs`/`page.mjs` finds nothing:
no page Emboss produces (including the un-numbered volume title page of F-57, which — once
numbered — would itself be a transcriber-generated page under this rule) ever gets the `t`
prefix.

**Classification:** 1.15.1c partial (works for TOC pages only, no general "front matter page"
concept for anything else); 1.15.1b not done.

---

## F-59 — Volume cover/spine-label/label generator (`cover.mjs`) is dead code, unreachable from the app

**Rules:** BANA 1.6.2c, 1.17.1, 1.17.2, 1.17.3

**What Emboss does:** `Emboss/format/cover.mjs` implements `generateVolumeCover`,
`generateSpineLabel`, and `generateDividerPage` — functions that would plausibly satisfy parts
of 1.6.2c/1.17.1. But grep across the whole `Emboss/` tree shows these three functions are
referenced only by `Emboss/scripts/build-dist.mjs` (bundle file list) and cached by
`Emboss/web/sw.js` (service worker) — never imported or called by `Emboss/web/editor/editor.mjs`
or by any test. There is no UI control, menu item, or export path that reaches this code.

Even taken on its own terms, `generateSpineLabel` only concatenates title (truncated to 20
characters) + volume number — it never includes "inclusive print pages" (part of 1.17.1's
typical content) or "inclusive letters" for dictionaries (1.17.2), and enforces no 30-cell/
2-4-line limit (1.17.3) on the finished string.

**Classification:** not done, all four rows — both because the feature is unreachable in the
shipped product, and because (even if wired up) it wouldn't satisfy 1.17.1/1.17.2/1.17.3's own
content/size requirements.

---

## F-60 — Book title on page 1 is a single string; no compound grade-level/subtitle/series/edition, and volumes 2+ don't get their own §1.8.1 title-page treatment

**Rules:** BANA 1.8.1 (partial), 1.8.2 (partial, for the multi-volume case)

> "The complete book title, including a grade level (if indicated in print), subtitle, series
> title, and edition name or number, appears on the first line(s) of braille page 1 in each
> volume." (1.8.1, emphasis on "in each volume")

**What Emboss does:** `doc.title` is a single string, populated from `dc:title`/`metadata.title`
(`Emboss/input/parse.mjs:1431,3552`) — there is no subtitle/series/edition/grade-level field
anywhere in the data model, so a book whose print title page has these as separate typographic
elements can only be represented if they were all concatenated by hand into one string before
import.

Separately: `bookTitleLines`/`banaRunningHead`'s `pageOneTitle` special treatment (centred,
multi-line, 3-cell clearances — `Emboss/format/document.mjs:2960-2969`,
`Emboss/format/page.mjs:62-80`) only fires for `pageNum === 1` of the *whole, unsplit* document.
Reproduced directly: formatting a two-volume BANA document and inspecting volume 2's own first
BODY page (after `renumberPage` restarts it at braille page 1, per 1.15.1d) shows the ordinary
running head, not the §1.8.1 title-page treatment — and 1.8.2's stated exception ("except...
the first page of text in each volume, where the full title is indicated") is likewise only
honoured for the document's overall page 1, not for volume 2 onward.

**Classification:** both partial.

---

## F-61 — Over-long running-head title is omitted, never abbreviated to key words

**Rule:** BANA 1.8.2e

> "If a title is too long to use as the running head, either adjust capitalization or choose
> key words from the title."

**What Emboss does:** `banaRunningHead`'s `place()` (`Emboss/format/page.mjs:62-80`) tries the
print-case title, then an all-lowercase fallback (the "adjust capitalization" option); if
neither fits, the comment says plainly: "An over-long title is OMITTED rather than overflowing
the line". Neither the code nor any surrounding logic ever selects/shortens to key words.

**Classification:** partial — one of the standard's two remedies exists; the other doesn't, and
the actual fallback (silent omission) is neither of them.

---

## F-62 — Word-division exceptions have no code path; only the blanket "never divide" default exists

**Rule:** BANA 1.10.1

> "Do not divide words at the end of a line except for purposes of instruction... or in
> line-numbered prose or poetry."

**What Emboss does:** `wrapCells` (`Emboss/format/layout.mjs:7-57`) never splits a word to make
it fit a line — the only place it ever cuts a word mid-stream is the "hard-chunk" fallback
(lines 32-43), which fires only when a single word is wider than the *entire page width*, an
overflow safety net unrelated to ordinary line-end division. So the rule's default ("do not
divide") is satisfied everywhere, but neither of its two *permitted* exceptions — deliberate
instructional hyphenation following print syllabification, or division in line-numbered
material — has any way to be invoked; a transcriber cannot switch either on even where BANA
allows it.

**Classification:** partial.

---

## F-63 — Default page geometry is 38 cells, not BANA's 40, unless an embosser preset supplies it

**Rule:** BANA 1.7.1

> "Materials are usually embossed on 11½″ × 11″ braille paper with 25 lines, with a maximum of
> 40 cells per line."

**What Emboss does:** `defaultWidth`/`defaultDepth` in the editor (`Emboss/web/editor/editor.mjs:
2938-2939`) fall back to `38` cells / `25` lines when no embosser preset is selected; only the
named hardware presets in `Emboss/format/spooler.mjs` (`cells: 40, lines: 25`) supply BANA's
literal 40×25. 25 lines matches the standard either way; the cells-per-line default does not,
unless a preset is chosen.

**Classification:** partial.

---

## F-64 — No interpoint-duplex page-number suppression; `embosserDuplex` is a physical transport setting only

**Rule:** BANA 1.15.1f

> "Some agencies suppress the even braille page number in interpoint braille."

**What Emboss does:** the only duplex-related setting, `embosserDuplex`
(`Emboss/web/editor/editor.mjs:7462,7599`), is passed through to `Emboss/format/pef.mjs`'s
`duplexOpt` — it controls how the physical PEF/embosser output is generated (single- vs
double-sided printing), and is never consulted by `assemble`/`brailleNumber`
(`Emboss/format/page.mjs`) to omit an even page number from the *content* stream itself.

**Classification:** not done (this is a judgement-driven agency option per the rule's own
wording, but the toggle itself is entirely unbuilt, so "out of scope" would understate it).

---

## F-65 — `mathCode` is one whole-document switch; §1.3.1's "occasional" vs. §1.2.6's "throughout" distinction can't be mixed within a document

**Rules:** BANA 1.3.1 (partial); BANA 1.2.6 is done (see below) for contrast

**What Emboss does:** `effectiveMathCode` (`Emboss/format/node-maths-helper.mjs:18`, tested by
`Emboss/format/test-braille-table.mjs:47-52`) picks one of `ueb`/`nemeth` for the entire
document (`auto` defaults from `mode`, or an explicit override) — there is no per-instance
override that would let a UEB-primary book (1.3.1) carry occasional Nemeth-coded technical
passages, or vice versa; whatever the document-level choice is, it applies to every `math`
block uniformly.

**Classification:** 1.2.6 itself is **done** (a document-wide, consistent UEB/Nemeth choice
exists and is tested); 1.3.1 is **partial** (the "occasional, primary-code-stays-UEB" case
can't be expressed alongside a Nemeth-primary document, only as its own separate document).

---

## F-66 — UKAAF's page-information line never carries a print page number

**Rules:** B004 6 (partial), B004 7 (partial), B004 7 N.B. (not done)

> "Each braille page should generally carry a page information line (PIL) indicating the
> braille page number, the print page number (optional), and title or current section name."
> (B004 6)
> Good practice example (B004 7): "Braille page number top right / Print page number top left."

**What Emboss does:** `runningHead(pageNum, titleBrl, width)` (`Emboss/format/page.mjs:36-53`)
takes exactly two content parameters — the braille page number (placed top-right) and the
title (centred) — there is no third parameter for a print page number anywhere in its
signature or body, and `assemble`'s UKAAF branch (`Emboss/format/page.mjs:227-232`) never
tracks a "current print page" the way the BANA branch does (`currentPrintPageBrl`,
`Emboss/format/page.mjs:159-226`). The only place a print page number appears at all in UKAAF
mode is `formatPageNum`'s body-level turn indicator (§8, done — see F-67), which announces a
*change* but isn't a persistent PIL fixture a reader can find on any page without first
scanning the body for the most recent turn line.

**What the standard requires:** per B004 6/7's own good-practice example, the print page
number is a permanent, locatable part of the PIL itself (top-left), separate from the §8
mid-body change indicator.

**Classification:** B004 6/7 partial (braille page number + title done; print page number
missing from the PIL); B004 7 N.B. (which page number to show when a braille page spans two
print pages) not done, since the PIL field it would apply to doesn't exist.

---

## F-67 — B004 §8 (print page turn indicator) and paragraph cell-1 resumption: done

**Rules:** B004 8

For contrast with F-66: this rule (the mid-body turn indicator, distinct from the PIL) **is**
implemented and matches the worked example closely. `formatPageNum`'s UKAAF branch
(`Emboss/format/document.mjs:846-848`) emits `'"3' + pageBrl` centred — dot 5 (`"`) + dots 25
(`3`) immediately followed by the page number, no space — matching the worked example's
`"3#gd` shape. `formatPara`'s `continuation` handling (`Emboss/format/document.mjs:452-454,
462`) resumes the interrupted paragraph at cell 1, both explicitly cross-referenced to B004 §8
in the code's own comments. Evidence in `Emboss/tests/test-printpage.mjs` (UKAAF section,
"Centred Print Page Change Indicator Line in Body").

**Classification:** done. (Listed here, not under a "done" heading elsewhere, because it sits
right next to F-66's gap and the two are easy to conflate.)

---

## F-68 — Foreign-language handling (1.16.3) is entirely delegated to the shared liblouis UEB table; no Emboss-authored evidence either way

**Rule:** BANA 1.16.3

**What Emboss does:** there is no `foreign`/`lang`-conditional branch anywhere in the
translation path (`Emboss/input/parse.mjs`, `Emboss/format/document.mjs`) — a foreign word or
phrase inside an English paragraph is translated by the exact same `o.translate()` call as
everything else, into the shared liblouis UEB table (`Emboss/engine/louis-browser.mjs`). Every
part of this rule (modified letter indicators for accents, suppressing a contraction across a
modified letter, UEB symbols for inverted punctuation) is liblouis-table behaviour, not
Emboss-authored logic — and this pilot ran no gold example against it.

**Classification:** unclear, not partial/not-done — there is genuinely no Emboss-specific
evidence to grade in either direction; only a Stage-3 gold example built from BANA's own
Example 1-18/1-19 (already in the map's worked-examples table) run through the real liblouis
translator could answer it (see Q-16).

---

## Rows resolved as done, not written up above (for completeness — coverage check)

Several substantive rows are **done** with direct code/test evidence and needed no finding:
BANA 1.1.2, 1.1.4, 1.1.8, 1.2.6, 1.4.4, 1.6.2a, 1.7.1a, 1.8.1a-e, 1.8.2 (core mechanism; see
F-60 for its multi-volume gap), 1.8.2a-d, 1.9.1, 1.9.2, 1.9.3, 1.9.5, 1.11.1, 1.11.2, 1.11.3,
1.11.3a, 1.11.3d, 1.11.4, 1.11.6b, 1.11.7a, 1.11.7b, 1.11.8a (placement half only — see F-46 for
its decision half), 1.13.1a, 1.13.1b, 1.15.1a (for body/TOC pages — see F-57 for the volume
title page exception), 1.15.1d, 1.15.1e, 1.15.1g; B004 8 (F-67), B004 9. Their Evidence/Tests
cells in the map cite the same functions/tests named above (`page.mjs`'s `assemble`/
`banaRunningHead`/`runningHead`/`brailleNumber`/`renumberPage`/`continuationPrefix`,
`document.mjs`'s `formatPara`/`formatHeading`/`formatPageNum`/`applyPageBoundaries`/
`singleBlankAroundPageChange`/`bookTitleLines`, `nestedMargins`; tests
`Emboss/tests/test-printpage.mjs`, `Emboss/tests/bana_nested_margins.test.mjs`,
`Emboss/tests/bana_nested_list_indent.test.mjs`, `Emboss/tests/volume-splitting.test.mjs`).

Rows 1.11.3b and 1.11.3c (blank line before/after the page-change indicator, tied to whatever
the *neighbouring* block's own formatter emits) are marked **partial**: no code specifically
enforces "a blank line precedes/follows the indicator whenever the surrounding format would
normally have one" — it only works when each neighbour's own blank-line rule happens to be
right, with no dedicated join logic the way `singleBlankAroundPageChange` (1.11.3d) or
`joinsWithoutBlank` (heading joins) provide. No gold example was run in this pass to confirm
either way in practice.

---

# Standards findings — boxed material (BANA §7; assessed 17 Sep 2026)

## F-69 — No exception anywhere suppresses the blank line between a box and its accompanying heading, caption, directions, or source citation

**Rule:** BANA 7.2.1e.

> "Do not leave a blank line between boxed material and any accompanying heading, caption,
> directions, or source citation." (BANA 7.2.1e)

**What Emboss does:** Every top-level block boundary gets a default blank line unless some
specific exception in `joinsWithoutBlank` (`Emboss/format/document.mjs:274-278`) or an
equivalent mechanism suppresses it — and nothing does for a `box`/`sidebar` block on either
side. Reproduced (scratch, `box-probe.mjs`):

```js
formatDocument({ blocks: [
  { type: 'heading', level: 1, text: 'Chapter Heading' },
  { type: 'box', blocks: [{ type: 'para', text: 'Boxed text.' }] },
] }, { translate, width: 40, depth: 25, mode: 'bana', standard: 'bana', suppressHeader: true })
```
produces
```
              ,*APT] ,H1D+

7777777777777777777777777777777777777777
  ,BOX$ TEXT4
GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
```
— a blank line separates the heading from the box's top line, though the standard requires
none when the box accompanies that heading. The same defect reproduces for a `caption` block
directly before a box (blank line present) and for a `box` directly followed by a `caption`
(blank line present) — i.e. the gap is not heading-specific and not one-directional.

**What the standard requires:** no blank line between a box and any heading, caption,
directions, or source citation that accompanies it, on either side.

**Classification:** **not done.** This is the general form of `standards-findings.md` F-27
("No code suppresses the blank line between a centred heading and a following box", BANA
4.4.1a) — F-27 covers only the single case of a *centred heading* immediately *before* a box.
BANA 7.2.1e is broader: it also names captions, directions, and source citations, and (by its
own wording, "between... and") applies however the two are ordered. Both findings share one
root cause and would likely share one fix: some "this text accompanies the following/
preceding box" signal, and a `joinsWithoutBlank`-style exception keyed on it.

**Test that would prove a fix:** once an "accompanies this box" signal exists, tests asserting
no blank line for each of: heading-then-box, caption-then-box, box-then-caption, and
directions-then-box, while an *unrelated* heading/caption next to a box (no signal set) keeps
the default blank line, matching F-27's own proposed test shape.

---

## F-70 — Box border lines never narrow for line-numbered text (BANA 7.3.3b)

**Rule:** BANA 7.3.3b.

> "The length of box lines within line-numbered text adheres to the required two blank cells
> before line numbers." (BANA 7.3.3b)

**What Emboss does:** `formatBox`'s width (`const w = o.width || 38`, `Emboss/format/
document.mjs`) is passed straight to `boxBorders`, with no reference to `o.lineNumberWidth` —
the document-wide narrowing that ordinary numbered prose *does* apply (`lineNumberInfo`,
`document.mjs:2652-2666`; consumed by `wrapNumbered`, `document.mjs:613-620`, whose own
comment says "the text of every numbered line ends 2 cells before the widest number").
Reproduced (scratch, `box-probe2.mjs`):

```js
formatDocument({ blocks: [
  { type: 'para', text: '…', segments: [{ type: 'linenum', text: '1' }, { type: 'text', text: 'First numbered line of prose padding padding.' }] },
  { type: 'box', blocks: [{ type: 'para', text: 'Boxed aside inside numbered prose.' }] },
  { type: 'para', text: '…', segments: [{ type: 'linenum', text: '2' }, { type: 'text', text: 'Second numbered line of prose padding padding.' }] },
] }, { translate, width: 40, depth: 25, mode: 'bana', standard: 'bana', suppressHeader: true })
```
produces the numbered paragraph correctly padded out to leave room for its line number
(`...PADD+        #A`, ending exactly at cell 40 with the number flush right, 2 blank cells
before it), but the box's top and bottom borders in between are a full, unnarrowed 40-cell
run of `7`/`G` — not adjusted for the line-number column at all.

**What the standard requires:** a box border line appearing within line-numbered text should
be narrowed the same way numbered prose lines are, leaving room for the line-number column.

**Classification:** **bug.** `boxBorders`/`formatBox` simply never consult
`o.lineNumberWidth`, which is already computed and available (every other numbered-text
consumer reads it).

**Test that would prove a fix:** a document with a genuine `linenum` segment elsewhere (so
`o.lineNumberWidth > 0`) and a box nested in that numbered flow; assert the box's top/bottom
border length is `o.width - 2 - o.lineNumberWidth` (or whatever exact narrowing normal
numbered prose uses), not the full page width.

---

## F-71 — A box's own title heading can be stranded alone at the bottom of a page (BANA 7.3.5a)

**Rule:** BANA 7.3.5a.

> "A top box line must be followed by at least one line of text on the braille page. If the
> box line is followed by a heading, the heading must be followed by at least one line of
> text." (BANA 7.3.5a)

**What Emboss does:** `applyPageBoundaries`'s box-pairing logic (`Emboss/format/
document.mjs:2664-2750`) computes, for a top box line, `boxNeed` as the border plus *only the
next single line* (skipping blanks/extra top borders) — satisfying the base "≥1 line of text"
requirement, since the box is pushed to the next page as a unit if that pair wouldn't fit. But
it never checks *what kind* of line that "next line" is: a box's own title heading
(`formatBox`, `document.mjs:828-869`) carries the *box's own* block index in the flattened
content array, not a `type:'heading'` block index, so `applyPageBoundaries`'s separate
`isHeading()`-based orphan-heading logic (used elsewhere for genuine heading blocks) never
sees it, and nothing requires a *further* line after the heading specifically. Reproduced
(scratch, `box-probe.mjs`, "Box near a page boundary"): 20 filler paragraphs fill lines 1-20,
then

```js
{ type: 'box', title: 'Boxed Note', blocks: [{ type: 'para', text: 'Short boxed text.' }] }
```
produces the top border on line 22 and the heading "BOXED NOTE" on line 23 — the **last two
lines of the page** — followed immediately by the page-number footer; the box's real body
text ("SHORT BOXED TEXT") is pushed alone to the start of the next page. The heading is
followed by **zero** lines of text on the page it opens on, exactly the situation 7.3.5a's
second sentence prohibits.

**What the standard requires:** when a top box line is immediately followed by a heading, that
heading must itself be followed by at least one line of real text on the same braille page —
not just satisfied by the heading line counting as the box line's own "one line of text".

**Classification:** **bug** (a narrow one — the base case of 7.3.5a, and 7.3.5b, are both
correctly implemented; see the map's own BANA 7.3.5b row).

**Test that would prove a fix:** construct a document where a box's top border plus its title
heading exactly fill the remaining lines of a page (as above); assert that Emboss instead
pushes the top-border+heading+first-real-text-line group together onto the next page, leaving
no page boundary immediately after a box's own heading.

---

## F-72 — No colour/screened-box support at all (BANA 7.5.1, 7.5.2)

**Rules:** BANA 7.5.1, BANA 7.5.2.

> "Books may use boxes in various colors, also called screened materials, to distinguish
> types of content. Indicate the box color unless all the boxes are the same color."
> (BANA 7.5.1)
>
> "Insert the name of the color, enclosed in transcriber's note indicators, at the beginning
> of the opening box line. A blank cell separates the embedded transcriber's note from the box
> line." (BANA 7.5.2)

**What Emboss does:** a grep of `document.mjs`/`parse.mjs`/`nimas-export.mjs`/`editor.mjs` for
a box colour field finds nothing — the only "color"/"colour" hits are an unrelated CSS rule
and an unrelated RTF colour-table comment. No code reads, stores, or round-trips a box's
colour at all. Reproduced (scratch, `box-probe.mjs`, "Box with a color field set"): a `box`
block with `color: 'yellow'` set formats byte-identically to one without it — the field is
silently dropped.

Separately, even if a colour *were* captured, 7.5.2 requires the colour name to be spliced
into the box's own **opening border line** (in TN brackets, one blank cell after it) — but
`formatBox` (`document.mjs:828-869`) always renders a box's title/heading on the line *after*
the top border, never merged into it, and `Emboss/tests/bana_sidebar_sync.test.mjs` has its
own explicit regression assertion for exactly the opposite: `"Title is no longer spliced into
the top box line"`.

**What the standard requires:** a way to mark a box's colour, and code that embeds the colour
name in TN brackets at the very start of the box's own opening border line, one blank cell
before the border characters resume.

**Classification:** **not done.** This is a genuinely unimplemented feature, not a narrow bug
— confirmed as an open, undecided area in Paul's own baseline: `Emboss/docs/
style-specification.md:158` already flags "Q: support BB's Full Box and colour boxes
(§7.4–7.5)?" as unresolved. See `questions-7.md` Q-21.

**Test that would prove a fix:** once a colour field and an opening-line splice mechanism
exist, a test asserting a box with `color: 'yellow'` renders its top border as
`@.<yellow@.> 7777…` (TN brackets, one blank cell, then the border run continuing to the full
page width), matching BANA Sample 7-2's own pattern.

---

## F-73 — No facing-print-pages support for boxes at all (BANA 7.4.1a, partial 7.4.1c/d)

**Rules:** BANA 7.4.1a (not done); BANA 7.4.1c, 7.4.1d (partial — the transcriber's-note/
page-change mechanism works, the placement judgement is out of scope).

> "When a single box is shown across print pages and it is read as if it were on a single
> page... Use combined page numbers, e.g., 22-23, a22-23, etc. Box lines may be omitted if the
> content will fit on a single braille page without them." (BANA 7.4.1a)

**What Emboss does:** a grep of `document.mjs`/`parse.mjs`/`page.mjs` for a combined
print-page-number form (e.g. "22-23") and for "facing" finds nothing. `formatPageNum`
(`document.mjs:909-929`) always formats a single page value; there is no facing-braille-pages
layout at all (the table equivalent, BANA §11.13, is separately `not done` per
`standards-findings.md` F-18); and no "omit box lines if the content fits on one braille page
without them" heuristic exists anywhere in `formatBox`/`boxBorders` — a box's lines are always
drawn unconditionally (BANA 7.1.2's own mechanism).

7.4.1b, by contrast, needs no extra code and is **done**: two full-page boxes on adjoining
print pages are simply two separate `box` blocks, each already getting its own top/bottom
lines by default, with individual (optionally continuation-lettered) print-page numbers
handled generically by `pagenum` blocks.

7.4.1c/d each combine a mechanical requirement (insert a transcriber's note; keep the box
intact across an internal print-page change) with a placement judgement ("place it at the
most logical place"/"insert the box at the most appropriate location"). The mechanical halves
are done: reproduced (scratch, `box-probe3.mjs`) a `pagenum` block nested *inside* a box's own
`blocks` renders correctly and the box stays intact as one continuous, single-bordered unit
spanning the page change (because `page.mjs`'s `banaPageChangeNumber()` scan matches on
rendered line text, regardless of nesting), and a manually-authored `note` block renders
wherever placed. The placement judgement is not automated, and per BANA 7.3.1's own
precedent, should not be.

**What the standard requires:** combined page numbers, an optional facing-braille-pages
layout and box-line omission for 7.4.1a; the mechanical halves of 7.4.1c/d are otherwise met.

**Classification:** **not done** (7.4.1a); **partial** (7.4.1c, 7.4.1d) — the non-judgement
parts. Cross-ref `style-specification.md:158`'s own open question, which names §7.4
explicitly alongside §7.5's colour boxes (F-72) as an undecided feature area.

**Test that would prove a fix:** for 7.4.1a, once combined page numbers and a
facing-braille-pages layout are built, tests analogous to BANA §11.13's own (deferred until
that table feature is built, since boxes would reuse the same underlying mechanism per the
rule's own "(See Formats, §11.13...)" cross-reference).

---

## F-74 — "Screened material" is only recognised via an explicit `<sidebar>` element (BANA 7.1.1)

**Rule:** BANA 7.1.1 (partial; the "screened materials" half).

> "The provisions of this section apply to materials printed inside boxes, screened materials
> shown by the use of colors or shaded backgrounds, or material that should be set off from
> the body of the text." (BANA 7.1.1)

**What Emboss does:** a `box` block is only ever produced from a literal `<sidebar>` element,
or (only one level down) from a `<div class="…sidebar…">` nested *inside* an already-open
sidebar (`parseSidebar`'s own recursive child loop, `Emboss/input/parse.mjs:2752`). The
top-level block dispatcher that walks the main document body only checks
`cTag === 'sidebar'` (`parse.mjs:2604-2605`) — there is no equivalent fallback there for a
`<div>`/other element whose class or attributes signal "screened"/"shaded"/"set off" material
without an actual `<sidebar>` wrapper. Such a top-level container would flatten into ordinary
paragraphs with no box lines at all, never reaching `formatBox`.

**What the standard requires:** any material shown as boxed, screened (by colour/shading), or
otherwise set off from the body text should get §7's treatment — not only material inside a
literal `<sidebar>`.

**Classification:** **standard unclear as applied to Emboss's data model** — BANA's own text
is not ambiguous, but DTBook/NIMAS gives no dedicated "screened, no box" element, so it's an
open question what source signal (if any, beyond `<sidebar>`) should trigger box treatment.
See `questions-7.md` Q-20.

**Test that would prove a fix:** once a signal is agreed, a test parsing a top-level
`<div class="screened">` (or whatever signal is chosen) with no `<sidebar>` ancestor, and
asserting it produces a `box` block / renders with box lines.

---

## F-75 — A box's own title is always a fixed cell-5, plain-text heading — never centred, never emphasised (BANA 7.2.1e)

**Rule:** BANA 7.2.1e (contributing cause).

> "Do not leave a blank line between boxed material and any accompanying heading, caption,
> directions, or source citation." (BANA 7.2.1e)

**Where found:** reconciling BANA Braille Formats 2016 §7's own gold examples
(`Emboss/tests/gold/bana-formats-2016/section-7/`) against Emboss's actual output via
`gold-run.mjs`. Example 7-2 ("Boxed Columns") is a box titled "Forms of be" (the word "be" set
in italics in print) wrapping a two-column table; every one of its 10 expected braille lines
matches Emboss's own generated output exactly **except** the title line itself.

**What Emboss does:** `formatBox` (`Emboss/format/document.mjs:838`):

```js
if (rawTitle && !hasTitleHeading) add(formatHeading({ type: 'heading', level: 2, text: rawTitle }, inner, false));
```

A box's own `title` field is always wrapped into a synthetic `{ type: 'heading', level: 2,
text: rawTitle }` object before formatting — `level` is hardcoded to `2` (BANA's cell-5 tier,
`formatHeading`'s `banaTier`), and only `text` (a plain string via `String(block.title).trim()`
a few lines above) is ever passed through, never `segments` — so any emphasis/markup the box's
own title might carry is silently discarded regardless of how the caller constructs the box
block.

**Reproduced** (`node Emboss/scripts/gold-run.mjs --section section-7 --sample example-7-2`):
expected line 2 is `               ,=MS ( .12` (15 leading blank cells — CENTRED, confirmed by
direct measurement of the source `.txt`, line 5443: `floor((40−10)/2)=15` for this 10-cell
braille title — and carrying an italics indicator `.1` before the contracted "be"); Emboss's
actual output is `    ,=MS ( 2` (4 leading blank cells — cell-5 — and no italics indicator at
all, since the plain-string `title` field carries no markup).

**What the standard requires:** nothing directly prescribes a single fixed tier for a box's own
title in the rule text itself (7.2.1e only forbids a blank line between the box and the
heading) — but this section's own worked example shows the title CAN be centred, and the box's
own title can carry emphasis (an italicised word) the same way any other heading text can.

**Classification:** **bug/gap.** `formatBox`'s title-heading construction should read a tier
(and, ideally, segments) from the box block's own data rather than hardcoding `level: 2` and
`text`-only — mirroring how a table's own title (`tableTitle`/`titlePosition`, the same file's
`buildModel11`/`formatBox` before-box/in-box logic) already carries more than one fixed shape.

**Test that would prove a fix:** a box with `title: 'Forms of be'` and some way to mark it
centred (and/or with an embedded bold/italic segment on "be"); assert the rendered title line
is centred (`floor((width−len)/2)` leading blanks) and/or carries the expected emphasis
indicator, not a fixed 4-cell indent with plain text only. `example-7-2.json`'s own gold file
is a ready-made worked case.

---

## F-76 — The §7 gold schema (and `buildModel7`) has no representation for print's own per-line line numbers (BANA §1.11/§15 "line-numbered text")

**Rule:** contributing cause to BANA 7.3.3.b (see F-70, which this finding compounds).

**Where found:** reconciling BANA Braille Formats 2016 §7's own gold examples. Example 7-1
("Box within Line-Numbered Prose") is this section's own worked illustration of 7.3.3.b — a
box embedded within continuously line-numbered prose, where each print line of running text
(and each line of the boxed quotation) carries its own line-number code at the right margin
(`#HJ`=80, `#HA`=81, `#HB`=82 in the expected braille).

**What Emboss does:** the gold reconciliation's own `print.blocks` schema for this section
(`tests/gold/bana-formats-2016/section-7/README.md`) has no field anywhere for a paragraph's
own print line number, and `buildModel7` (`Emboss/scripts/gold-run.mjs`) builds an ordinary
`{type:'para', text}` block with no `linenum` segments at all — even though Emboss's document
model DOES support `linenum` segments correctly elsewhere (F-70's own reproduction code
constructs `{ type: 'linenum', text: '1' }` and gets a correctly-padded, correctly-narrowed
numbered line back for ordinary prose outside a box). Reproduced
(`node Emboss/scripts/gold-run.mjs --section section-7 --sample example-7-1`): Emboss's actual
output carries no line-number codes on any of its 9 lines at all, and (since `o.lineNumberWidth`
is only ever populated from real `linenum` segments elsewhere in the document, which this
model never supplies) the box's own top border is not narrowed either — compounding with,
but distinct from, F-70's own separate box-narrowing gap.

**What the standard requires:** nothing new beyond 7.3.3.b itself — this finding is about the
*gold reconciliation's own modelling scope*, not a fresh reading of the standard, and is
recorded here (rather than silently absorbed into F-70) so a future pass that extends
`buildModel7` to carry real line numbers can re-run Example 7-1 and attribute what remains
purely to F-70.

**Classification:** **schema/tooling gap**, not an Emboss code defect in its own right — filed
here so the large, multi-cause mismatch on `example-7-1` is not miscounted as evidence against
F-70 alone.

**Test that would prove a fix:** extend the §7 gold schema with a per-paragraph line-number
field, teach `buildModel7` to emit `linenum` segments from it, and re-run
`gold-run.mjs --sample example-7-1`; the remaining mismatch (if any) should then be
attributable to F-70 alone (the box border still not narrowing), not to missing line-number
codes throughout.

---

## F-77 — `formatTable` inserts a blank line between every data row whenever ANY row wraps to multiple lines, citing a rule number that does not exist in this reference copy

**Rule:** cited in code as "BANA §11.3.4" — no such rule exists in
`references/_text/braille-formats-2016.txt` (§11.3 runs 11.3.1–11.3.2 only; the nearest actual
per-row blank-line rule, BANA 11.16.k, is specific to the unrelated Listed Table Format for
wide tables).

**Where found:** reconciling BANA Braille Formats 2016 §7's own gold examples. Sample 7-1
("Two Boxes Separated by a Blank Line") contains two boxed tables; the second box's last row
("Electrical" / "electrons in an electrical current") wraps its second column onto an extra
physical line. The expected braille (source `.txt` lines 5599–5606) carries **no blank line
anywhere** between any of that box's four data rows, including around the wrapped one.

**What Emboss does:** `formatTable` (`Emboss/format/document.mjs:1608-1636`):

```js
// Check if any row has multi-line cells (BANA §11.3.4 inter-row spacing rule)
const hasMultiLine = rowWrappedData.some((cellWrapped) => Math.max(1, ...cellWrapped.map((l) => l.length)) > 1);
...
  if (hasMultiLine && ri < rowWrappedData.length - 1) {
    out.push('');
  }
```

Once ANY row in the table wraps to more than one physical line, a blank line is inserted after
**every** data row (not just around the wrapped one) — for `columnar` tables generally, and
again for a second, near-identical `hasMultiLine` check for the spatial/trace codepath
(`document.mjs:2613-2618`). Reproduced
(`node Emboss/scripts/gold-run.mjs --section section-7 --sample sample-7-01`): Emboss's actual
output for the Kinetic Energy box inserts a blank line after each of its first three
(non-wrapping) rows as well as around the wrapped fourth row — 21 lines total for a box whose
expected braille is 10 lines.

**What the standard requires:** BANA Formats 2016 has no rule numbered §11.3.4 in this edition,
and its actual per-row blank-line rule (11.16.k) is explicitly scoped to the Listed Table
Format ("wide tables... numerous columns... repetitive entries") — not to an ordinary columnar
table whose one row happens to wrap. This section's own worked sample (Sample 7-1) directly
contradicts the blanket rule as coded: a wrapped row does not, by itself, require blank-line
separation from its neighbours.

**Classification:** **bug.** The `hasMultiLine` blank-line insertion should not fire
unconditionally for every columnar table with any wrapped row; at minimum, its own rule
citation should be corrected or the actual justification tracked down (it may be conflating
BANA 11.16.k's Listed-Table-Format-specific rule with ordinary columnar tables, or encoding a
transcriber house-style choice not found in this edition's own text at all).

**Test that would prove a fix:** `sample-7-01.json`'s own second box (Kinetic Energy) is a
ready-made worked case — build it via `buildModel7`/`formatTable` and assert the rendered
table carries no blank line between any of its four data rows, matching the gold braille
exactly, once the `hasMultiLine` logic is corrected or its real justification is confirmed and
narrowed.

**Status update (17 Sep 2026, fixed):** the `hasMultiLine` blank-line insertion is
**removed** — no rule in `references/_text/braille-formats-2016.txt` requires it (§11.3 runs
only 11.3.1-11.3.2, confirming the bogus citation; §11.5.4 "Blank Lines. Follow print when
blank lines are used to show row groupings, or to set off rows of column totals" only
follows PRINT's own blank lines, never manufactures one for a wrapped row; §11.6 has no
blank-line rule of any kind). BANA 11.16.k ("Leave a blank line before each row") is
confirmed still scoped to the Listed Table Format alone (`listedTnParagraphs`/`formatListed`,
unaffected by this fix) — this finding's own suspicion that the code conflated the two rules
is the correct diagnosis.

- **Where fixed:** `Emboss/format/document.mjs` — the `hasMultiLine` computation and its
  `if (hasMultiLine && ri < rowWrappedData.length - 1) out.push('')` guard removed from both
  `formatColumnar` (rendering) and its trace mirror inside `traceTable` (parity) — the two
  sites this finding's own "Where found" cited (formerly `document.mjs:1608-1636` and
  `:2613-2618`; both renumbered by other work landing in this file meanwhile, same logic).
  Nothing else in the row-rendering loop changed: a row's OWN wrapped lines are unaffected,
  only the extra blank line invented between rows.
- **Gold evidence, exactly this finding's own worked case:** `node Emboss/scripts/
  gold-run.mjs --section section-7 --sample sample-7-01` (17 Sep 2026) — before this fix,
  sample-7-01's own diagnosis (Stage 4 run, recorded in `status.json`) read "line count
  differs by +3 (expected 18, actual 21)" — precisely the 3 spurious blank lines this
  finding describes (one after each of the Kinetic Energy box's first three rows, one
  around the wrapped fourth); after, the line-count note disappears entirely (18 vs 18,
  exact). `status.json`'s recorded status stays `not-representable` (the sample's own
  separate, unrelated `#,-` print-invisible running-head artifact — already recorded, nothing
  to do with this fix) — `node Emboss/scripts/gold-run.mjs --section section-7
  --update-status` records this. Sample-7-02 (this finding's own "Read first" companion) is
  unaffected either way — its own remaining mismatch is entirely the `#,-` artifact, not a
  wrapped row.
- **BANA §11 evidence:** `node Emboss/scripts/gold-run.mjs --section section-11
  --update-status` (17 Sep 2026) — no section-11 sample's status changes because of this
  fix specifically (every section-11 sample with a wrapped row was already `mismatch` for
  other, larger reasons — e.g. Sample 11-04's own word-division gap, T9's status update
  above); the fix is still exercised by that section's tables generally (any wrapped
  columnar row anywhere no longer gets the spurious blank line), just not one that flips a
  status on its own here.
- **Regression tests:** `Emboss/tests/table_auto_squeeze.test.mjs` — the pre-existing
  `squeezeBlock` test (which had encoded the OLD, buggy blank-line behaviour) updated to
  assert NO blank line between its two wrapped rows, citing this fix; two new dedicated
  tests added, one mirroring Sample 7-1's own Kinetic Energy box exactly (last row wraps,
  no blank line anywhere) and one with a wrapped MIDDLE row (no blank line either side),
  plus a `formatBlock`/`traceBlock` parity test. `Emboss/tests/bana_table_format.test.mjs`'s
  own Test 2 (which asserted `linesBetween.includes('')` under the old, incorrect "BANA
  §11.3.4" citation) updated to assert the opposite, citing this same fix.
- **Suite/benchmarks:** `node Emboss/scripts/run-all-tests.mjs` — 119/119 headless, no
  regressions. `node scripts/run_1000_corpus_benchmark.mjs` — 1150/1150. `node scripts/
  run_800_nimas_benchmark.mjs` — 800/800.

---

## F-78 — `formatAttribution` blocks at a fixed cell 5, never computed relative to the line it actually follows (BANA 9.4.1b, 9.5.1b)

**Rules:** BANA 9.4.1b, 9.5.1b

> "Block attributions in the fifth cell to the right of the beginning of the previous line."
> (9.4.1b)
> "Block a source citation in the fifth cell to the right of the beginning of the previous
> line." (9.5.1b)

**Where found:** reconciling BANA Braille Formats 2016 §9's own gold examples. Sample 9-6
("Attribution") blocks a boxed quotation at cell 3 and its attribution at cell 7 — cell 3 + 4,
exactly matching 9.4.1b's own wording. Running this sample through `buildModel9`/
`formatAttribution` instead produces the attribution at cell 5.

**What Emboss does:** `formatAttribution` (`Emboss/format/document.mjs`, "Attribution (Formats
§9.4.1)" comment) computes the margin as a flat, hard-coded `wrapCells(body, w, 4, 4)` — cell 5
for both the first line and any runover — with no parameter or lookup of the position the
*actual* previous rendered line began at. The code comment already flags this as an
approximation ("approximated as the fixed cell 5 ... since the last line of the quoted matter
begins in cell 1 or, for BANA displayed material, cell 3"), but the approximation is only
correct in the cell-1 case; for a cell-3 displayed quotation (the fifth cell to its right is
cell 7, not cell 5) it is wrong. Reproduced directly:
`node Emboss/scripts/gold-run.mjs --section section-9 --sample sample-9-06` — Emboss renders
the attribution "—Justice Lewis F. Powell, Jr., 1972" at cell 5 (`    ,-,JU/ICE...`) against an
expected cell 7 (`      ,-,JU/ICE...`), merging what should be two lines (name/title vs. year)
into one because the narrower expected column width is no longer being used to compute
wrapping either. The same fixed-cell-5 output also shows up in `sample-9-01` (attribution after
a cell-3 quotation, expected cell 7) and in the first letter of `sample-9-10` (signature after
a cell-3 closing phrase, expected cell 7) — it happens to coincide with the correct answer only
where the preceding line begins at cell 1 (e.g. the second letter of `sample-9-10`).

**What the standard requires:** the attribution/citation margin tracks whatever cell the
*actual* preceding line began at, plus 4 — not a fixed absolute cell.

**Classification:** **bug.** `formatAttribution` needs to know (or be told) the first-line
indent of the block it follows, the same way `quoteMargins`/`formatPara` already thread
adjusted-margin state through the document, rather than assuming cell 1 unconditionally.

**Test that would prove a fix:** an `attribution` block immediately following a `quote`-styled
paragraph at cell 3 (BANA mode); assert the attribution is blocked at cell 7 (indent 6), not
the current fixed cell 5 (indent 4) — `sample-9-06`'s own quote+attribution pair is a ready-made
gold case for this once fixed.

---

## F-79 — BANA 9.2.2e's "displayed sentences [or verse] treated as a list" gets no adjusted-margin offset when built as an ordinary list

**Rule:** BANA 9.2.2e

> "Multiple displayed sentences are treated as a list beginning at the adjusted left margin;
> e.g., if the adjusted left margin is 5, displayed sentences would be placed with margins
> 5-7."

**Where found:** reconciling BANA Braille Formats 2016 §9's own gold examples. Example 9-4
("Displayed Multiple Sentences") is a two-item list of displayed sentences, each blocked at
cell 3 with its own runover at cell 5 — exactly the adjusted-margin-plus-list-runover pattern
9.2.2e describes. Sample 9-2 ("Italicized Displayed Verse") shows the identical cell-3/cell-5
pattern for a four-line poetic verse, which this section's own rule text treats the same way
(a displayed passage of several "items"). Running either through `buildModel9`'s `list` kind
(which reuses the same `buildListItem`/`nestedMargins` machinery `buildModel7`/`buildModel8`
already use for ordinary lists) produces cell 1 / cell 3 instead.

**What Emboss does:** `nestedMargins('list', 0, 0, 'bana')` (`Emboss/format/document.mjs`)
returns `{first: 0, runover: 2}` — cell 1 / cell 3, BANA 8.5.1b's ordinary top-level list
margin — for a ordinary, non-nested list. Unlike a `quote`/`epigraph` paragraph, whose
`quoteMargins` explicitly adds 2 cells to the base displayed-material margin per `block.level`
(document.mjs's own "Nested displayed matter... moves a further 2 cells per level" comment,
covering 9.2.2's own nested-list example), a `list` block has no equivalent mechanism at all
for "this list itself sits inside/at the displayed-material adjusted margin" — its margin is
computed purely from its own nesting level among list items, with no way to inherit an outer
adjusted margin the way a quote paragraph can. Reproduced directly:
`node Emboss/scripts/gold-run.mjs --section section-9 --sample example-9-4` — Emboss renders
the two displayed sentences at cell 1/cell 3 against an expected cell 3/cell 5.

**What the standard requires:** a list of displayed sentences (or verse lines) begins at the
section's own adjusted left margin (cell 3 by default), not at the ordinary top-level list
margin (cell 1).

**Classification:** **not done** (missing feature). A list embedded in, or standing in for,
displayed material has no way to pick up the surrounding adjusted margin the way a quote
paragraph does via `block.level`.

**Test that would prove a fix:** a `list` block built with some signal that it is itself
displayed material (however that signal ends up being represented); assert its first item is
blocked at cell 3 with runovers at cell 5, matching `example-9-4`'s and `sample-9-2`'s own gold
braille, instead of the ordinary cell-1/cell-3 list margin.

---

## F-80 — `formatAttribution`'s unconditional trailing blank line prevents modelling consecutive attribution-like fragments that print itself runs together with none

**Rule:** BANA 9.4.1d, 9.5.1c/d (the "blank line after" rules, taken together with the absence
of any rule requiring a blank line *between* two immediately-adjacent attribution/citation-like
fragments)

**Where found:** reconciling BANA Braille Formats 2016 §9's own gold examples. Sample 9-7
("Source Citation to an Image") transcribes six short, print-distinct caption/credit/citation
fragments as consecutive braille lines with **no blank line at all** between any of them.
Sample 9-10 ("Letters with Signatures as Attributions") transcribes a closing phrase followed
immediately by "(Signed)" and a script signature, again with no blank line between the three.

**What Emboss does:** `formatAttribution` (`Emboss/format/document.mjs`) always appends a
single trailing `''` after its own wrapped lines
(`const out = [...wrapCells(body, w, 4, 4), '']`), unconditionally — there is no parameter or
surrounding-context check that suppresses it when the very next block is itself another
attribution-like fragment print keeps tight against this one. Building either sample's several
short fragments as separate `attribution` blocks (the only way to give each its own distinct
cell-5/cell-7 position, since a single block wraps its whole text continuously and cannot force
independent physical lines for genuinely separate print fragments) therefore inserts an
unwanted blank line after every fragment but the last. Reproduced directly:
`node Emboss/scripts/gold-run.mjs --section section-9 --sample sample-9-10` — Emboss's actual
output for the first letter's closing shows `"(SIGNED)"` / `""` / `"WILHELM"` / four further
blank lines (the page padding out to `depth:25`) where the expected braille has `"(Signed)"`
immediately followed by `"Wilhelm"` with no blank at all.

**What the standard requires:** consecutive attribution/citation-like print fragments that
print itself keeps tight together (a closing phrase immediately above "(Signed)" and a
signature; a stack of short image/caption credits) transcribe with no blank line between them;
only the true end of the whole attribution/citation run gets one.

**Classification:** **bug** (for the general blank-line-after behaviour, which is otherwise
correct per 9.4.1d/9.5.1d) combined with **not done** (missing feature: no way to say "this
attribution-like block is immediately followed by another one of the same run, suppress my own
trailing blank").

**Test that would prove a fix:** two consecutive `attribution` blocks with some way to mark the
first as "continues without a blank" (mirroring how `quote`/`para` blocks already use
`block.continued`/`block.continuation` around a page turn); assert no blank line is emitted
between them, only after the second.

---

## F-81 — Displayed material that interrupts a sentence in print is never automatically relocated to the end of the paragraph or sentence (BANA 9.2.2f)

**Rule:** BANA 9.2.2f

> "Displayed material may be relocated to the end of a paragraph when it interferes with the
> flow of text. If the page has no paragraph breaks, the displayed material may be placed at
> the end of a sentence."

**Where found:** reconciling BANA Braille Formats 2016 §9's own gold examples. Sample 9-1
("Displayed Quote") is this rule's own named worked example: in print, a displayed quotation
and its attribution are inserted mid-sentence ("...Churchill and Roosevelt agreed that"
[QUOTE + ATTRIBUTION] "defeating Hitler should be..."); the corresponding braille relocates the
quotation and its attribution to the end of that same sentence, transcribing the whole
sentence first and the quotation afterward.

**What Emboss does:** a grep of `format/document.mjs`/`input/parse.mjs` for "relocat" (as a
print-content concept) finds nothing — `buildDocPages` and the paragraph/quote formatters
render every block strictly in the order the document model gives them, with no logic anywhere
that recognises "this displayed-material block interrupts the paragraph before/after it" and
moves it past the paragraph's own end. Reproduced directly:
`node Emboss/scripts/gold-run.mjs --section section-9 --sample sample-9-01` — building the
document model in PRINT's own interrupted order (paragraph fragment, quote, attribution,
paragraph continuing, new paragraph — the only faithful reading of the print page itself)
produces braille in that same interrupted order, whereas the gold transcription (and this
rule's own point) requires the quote+attribution to move past the paragraph's own end.

**What the standard requires:** a transcriber recognises when displayed material would
interrupt a print sentence/paragraph's own flow and relocates it (quote and any attribution
together) to follow that sentence or paragraph instead.

**Classification:** **not done** (missing feature). This is an editorial/structural decision
about where to place a block relative to the surrounding paragraph text, not a margin or
blank-line calculation — there is no code path anywhere that reorders blocks based on where
displayed material falls relative to a paragraph break.

**Test that would prove a fix:** N/A until block relocation exists in some form; once it does,
`sample-9-01`'s own print content (paragraph interrupted by quote+attribution) is a ready-made
gold case — assert the quote+attribution end up after the paragraph's own full sentence, not
in the middle of it.

---

## F-82 — An isolated single-item note demonstration (no surrounding page) diverges from Emboss's real output on two systemic, expected grounds: the mandatory §16.5.1a note-separation line, and the referencing paragraph's own default first-line indent

**Where found:** reconciling BANA Braille Formats 2016 §16 (Notes)'s own gold examples
(`node Emboss/scripts/gold-run.mjs --section section-16`), across the majority of this
section's short, isolated one/two-sentence-plus-note demonstration boxes (Examples 16-1, 16-2,
16-5, 16-7, 16-9, 16-11; Samples 16-1, 16-3, 16-4, 16-5, 16-6 — 11 of this section's 14
`mismatch`-status files).

**What Emboss does, and why it's correct:** `noteLead` (`document.mjs:719-720`) always emits a
`"333333` separation line (BANA §16.5.1a) before the first note in a run, in BANA mode; and
`formatSegmentedPara`/`formatDocument`'s ordinary paragraph path indents a new paragraph's
first line at cell 3 (2 blank cells) unless it is a `continuation`. Both are simply doing what
Formats §16.5.1a and the paragraph convention require — verified correct against every gold
file in this section whose excerpt DOES include real page context (e.g. Sample 16-2, which
opens directly on a heading, not a bare paragraph, and gets the separator right where its own
gold braille shows it).

**Why the gold excerpt still disagrees:** every one of this section's own tiny "Example 16-N"
demonstration boxes is a two-to-nine-line **isolated illustration**, boxed and set off from the
book's surrounding running text — never a real print page, and never literally the start of a
new braille page or volume either. Its own `braille.lines` (correctly transcribed from the
source) therefore starts flush with no separator (because the source excerpt begins mid-page,
after whatever real content came before it in the book, not at a true page/volume start) and
with no first-line paragraph indent either (for the same reason — this text is not really the
first thing on its braille page). Building a `formatDocument` model from just this excerpt's
own print content necessarily starts a FRESH, isolated one-block document, which Emboss then
correctly renders as if it really were the start of a page/volume — with the separator and the
indent both present, per the rules that apply at a genuine page/document start.

**Classification:** **gold-corpus measurement artifact, not an Emboss defect** — precisely
BANA's own "worked-example" convention (a short excerpt lifted out of its real page context)
colliding with what `gold-run.mjs`'s own methodology can build (print content only, no
surrounding page). Every one of these files' own `resolution`/`uncertain` notes already says
so; this finding names the pattern once so it isn't mistaken for 11 separate, unexplained
regressions. It does not affect this section's `not-representable` files (those disagree for
their own, already-documented reasons — F-106 through F-120, `notes-writeup.md`) nor Sample
16-2/16-8/16-9/16-10/16-11/16-12/16-13 (each opens on a heading, a table, or a page-spanning
excerpt with real preceding content, not a bare isolated paragraph).

**Test that would prove a fix:** N/A — there is nothing to fix; a `formatDocument` test
embedding one of these same short excerpts INSIDE a larger surrounding document (a preceding
paragraph, or an explicit "not the first block on the page" marker) would show the separator/
indent landing correctly relative to that larger context, confirming the mechanism itself is
sound.

---

## F-83 — BANA §5.3's many contextual "ignore font attribute" exceptions (standing-alone letters, word-parts, part-of-speech abbreviations, stage directions, exercise numbers, quoted matter, alphabetic-reference entry words) have no code path outside headings/lists

**Rules:** BANA 5.3.2, 5.3.3, 5.3.4, 5.3.8, 5.3.9, 5.3.10, 5.3.11

> "Ignore font attributes used for letters that mean letters and are shown standing alone..."
> (5.3.2) / "...used with word parts standing alone, e.g., prefixes, suffixes..." (5.3.3) /
> "...used with parts-of-speech abbreviations..." (5.3.4) / "...for scene settings and stage
> directions in plays or dialogue" (5.3.8) / "...for numbers/letters beginning exercise
> material, alphabetic divisions, etc." (5.3.9) / "...used to indicate quoted material enclosed
> in quotation marks" (5.3.10) / "...for entry words in alphabetic references, unless required
> for distinction..." (5.3.11)

**What Emboss does:** `stripEmphasis` (`Emboss/format/document.mjs:153-155`) is called only
from `formatHeading` — unconditionally, for every heading (`standards-findings.md` F-41,
`assess-5/typeforms-writeup.md` F-87) — and nowhere else. `formatList`/`buildListItem` never
call it either (F-88, scoped to just the "entire list uniformly emphasized" case, 5.3.7). An
ordinary paragraph's segments (`formatPara`/`formatSegmentedPara`) go through
`segmentsToBraille`/`groupSegments` with no stripping step at all, for any reason. Reproduced
directly against real `formatDocument` + real liblouis
(`node Emboss/scripts/gold-run.mjs --section section-5`): example-5-1's standing-alone letters
i/e/c keep their italic symbol indicator (`.2I`, `.2;E1`) though 5.3.2 says to ignore it;
example-5-2's word-part fragments "dis-"/"ible"/"-ance" keep bold/italic word indicators
though 5.3.3 says to ignore them; example-5-3's "v." abbreviation keeps its italic indicator
though 5.3.4 says to ignore it; example-5-8's "(amused)" stage direction keeps an italic
passage indicator though 5.3.8 says to ignore it; example-5-9's bold exercise numerals keep a
bold indicator though 5.3.9 says to ignore it; sample-5-02's bold-italic pull-quote keeps both
attributes though 5.3.10 says to ignore them; example-5-10's "Gift tax" headword keeps its
bold indicator though 5.3.11 says to ignore it for an ordinary (non-distinctive) entry word.

**What the standard requires:** each of these seven sub-rules has its own condition for when a
decorative print font attribute is dropped rather than carried into braille — e.g.
distinguishing "a lone letter standing for itself" from "a whole word," or "an ordinary entry
word" from "a foreign/distinctive one." None of these conditions is detectable from a `tf` bit
alone; each needs its own piece of contextual, sometimes genuinely judgement-based, logic.

**Classification:** **not built.** A large, mostly judgement-based feature area, not a small
fix — distinct from F-41/F-87 (headings, which strip everything unconditionally and need a
narrower "keep this part" exception) and from F-88 (lists, which never strip, and only for the
single "whole list is emphasized" case, 5.3.7). Every one of these seven sub-rules would need
Emboss to recognize a print-side signal (a letter standing alone with no adjacent letters, a
hyphenated word-fragment, a short abbreviation followed by a period, dialogue enclosed in
parentheses, a leading list marker, quotation marks, an alphabetic-reference entry position)
that nothing in Emboss's parser currently looks for.

**Test that would prove a fix:** for each sub-rule, a paragraph/list-item block whose segments
carry `tf` on exactly the print content the rule describes (a standing-alone letter, a
hyphenated fragment, etc.) formats with that `tf` dropped, while an adjacent segment carrying
the same emphasis for an unrelated reason keeps it.

**Status: not fixed.**

---

## F-84 — BANA §4.3.3's "no blank line between connected same-tier headings" is applied unconditionally, with no way to mark two adjacent centred headings as NOT connected

**Rules:** BANA 4.3.3 (via `HEADING_JOIN_TIERS`, `document.mjs:273`), as illustrated by
BANA Formats 2016 §5's own Examples 5-4, 5-11, 5-12 (rules 5.3.5, 5.4.2)

**What Emboss does:** `joinsWithoutBlank` (`document.mjs:274-276`) drops the blank line
between ANY two consecutive same-tier headings whose tier pair is in `HEADING_JOIN_TIERS`
(`centred>centred`, `cell5>cell5`, `cell5>cell7`) — unconditionally, with no field on either
heading block able to opt a specific pair OUT of the join. Reproduced
(`node Emboss/scripts/gold-run.mjs --section section-5`, example-5-4/5-11/5-12): each of these
three worked examples models a title-page-style block as two consecutive centred (level-1)
headings — a title, then a byline — and BANA's OWN worked braille shows a genuine blank line
between them (`Emboss/tests/gold/bana-formats-2016/section-5/example-5-4.json`
`braille.lines[2]`, and similarly in example-5-11/5-12), directly contradicting the
unconditional join. `formatDocument` correctly reproduces §4.3.3's own named examples (title +
author, chapter-number + chapter-title, unit-number + unit-title — gold-verified against §4's
own corpus) but has no way to distinguish those from a case, like these three §5 worked
examples, where the source book's own layout keeps a blank line between two adjacent centred
lines despite them looking like the same "title + byline" shape.

**What the standard requires:** §4.3.3's own wording only actually promises no blank line for
its own specific "connected heading" construct; nothing in the quoted text of Formats 4.3.3 (or
5.3.5/5.4.2, which these three §5 worked examples illustrate) states that EVERY pair of
adjacent same-tier headings must join without a blank line.

**Classification:** **not built** — a real, non-hypothetical gap surfaced by an independent
section's own gold corpus, not a hypothetical edge case. Whether a given "title, then byline"
pair should join without a blank (§4.3.3's own convention) or keep one (as these three §5
worked examples independently, consistently show) depends on transcriber intent/context not
represented anywhere in the heading block's own fields (`level`, `text`, `segments`). A
`block.noJoin`-style per-block signal, defaulting to the current always-join behaviour for the
tiers already in `HEADING_JOIN_TIERS`, would let a print source that explicitly wants a blank
between two same-tier headings say so.

**Test that would prove a fix:** two consecutive centred heading blocks with an explicit
"don't join" signal format WITH a blank line between them, while the same two blocks without
the signal keep formatting exactly as today (no regression for §4's own already-gold-verified
connected-heading examples).

**Status: not fixed.**

---

## F-85 — A boxed inline "Example" excerpt's own book-layout left margin is baked into the gold corpus's `braille.lines`, so an isolated Example's line-wrap points never match Emboss's real (unboxed) output

**Where found:** reconciling BANA Braille Formats 2016 §13 (Poetry and Song Lyrics)'s gold
examples (`node Emboss/scripts/gold-run.mjs --section section-13`), specifically Example 13-1
(`example-13-1.json`, illustrating 13.2.1b/c, poetry embedded in narrative text).

**What Emboss does, and why it's correct:** `formatDocument` builds a fresh, isolated document
from the excerpt's own `print.blocks` and wraps its text flush at cell 1 (an ordinary
paragraph, no box). This is the right behaviour for the CONTENT itself — nothing in
13.2.1b/13.2.1c asks for any extra left margin.

**Why the gold excerpt still disagrees:** four of this section's seven inline "Example 13-N"
boxes (13-1, 13-4, 13-6, 13-7 — confirmed directly against `references/_text/braille-formats-
2016.txt`) carry a uniform 9-column left margin of literal ASCII spaces on every one of their
own `.txt` lines, an artifact of how the source PDF's own bordered "Example" box rendered into
its text layer (confirmed: built from plain ASCII spaces, never the U+2800 blank-cell character
this source otherwise always uses for genuine blank braille cells; stripping it makes the
longest line come out to exactly 40 cells in every case, the section's real page width). The
three inline Examples with no such box margin (13-2, 13-3, 13-5) have 0 leading spaces measured
the same way. Because this margin is real column-position padding actually present in the
source's own transcribed `braille.lines` (not a separator that could simply be trimmed away
without changing where the text itself wraps), an isolated excerpt whose wrapped text is long
enough to need more than one physical line — Example 13-1's three-line quotation is the only
one of the four margined Examples long enough to wrap at all — necessarily wraps at DIFFERENT
column positions once Emboss's real (margin-free) 40-cell line is used, shifting every word
after the first wrap point onto a different line than the book's own margined rendering shows.
(Examples 13-4/13-6/13-7 also carry the margin but happen to wrap at the same points regardless,
once their own OTHER content issues are fixed — see this reconciliation's `differences.md`.)

**Classification:** **gold-corpus measurement artifact, not an Emboss defect** — the same
general category as F-82 (an isolated demonstration excerpt colliding with what `gold-run.mjs`
can build from print content alone), but a different specific mechanism: here the excerpt's own
book-typesetting box margin is physically present in the transcribed `braille.lines` text
itself and shifts wrap points, rather than a missing separator/indent at the top of the excerpt.
Not worth working around in `buildModel13` (stripping the leading spaces was already done, per
this section's own gold-file convention of using clean cell-1 print text) — the divergence is
inherent to comparing a boxed, book-margined transcription against Emboss's own unboxed output,
not something a correct `formatDocument` could ever reproduce without inventing a fictitious
box-margin feature no BANA rule calls for.

**Test that would prove a fix:** N/A — there is nothing to fix; the four affected files'
`resolution` notes and this section's own README document the margin so it is not mistaken for
an unexplained regression.

**Status: not fixed** (not applicable — measurement artifact).

---

# Standards findings — typeforms (BANA §5; assessed 17 Sep 2026)

## F-86 — UEB script and the five transcriber-defined typeform indicators are fully
implemented in the bundled liblouis UEB table, but completely unreachable from Emboss's own code

**Rules:** BANA 5.1.4, 5.5.1, 5.5.2, 5.9.1 (and, by dependence, 5.9.2, 5.5.3, Example 5-14,
Sample 5-1, Sample 5-3)

> "UEB defines symbols for italics, bold, underlining, and script. There are also five
> transcriber-defined typeform indicators to be used for other print font attributes." (BANA
> 5.1.4)

**What Emboss does:** `engine/louis.mjs:33` and `engine/louis-browser.mjs:88` both define
`TYPEFORM = { plain: 0, italic: 1, underline: 2, bold: 4 }` — three bits only.
`Emboss/input/parse.mjs:511` (`TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4`) and
`Emboss/format/cell-markup.mjs:15` repeat the same three bits. The editor's toolbar
(`Emboss/web/editor/editor.mjs:2191,6135-6137`) offers only Bold/Italic/Underline commands.
No file in the repository ever constructs `tf = 8` (script) or any of `16/32/64/128/256/512`
(transnote/trans1-trans5), and no parser code detects a print feature (a script/cursive
typeface, or any color/highlighting/double-underline/shape/etc. that would need a
transcriber-defined indicator) that isn't already one of italic/bold/underline.

Yet `liblouis/tables/en-ueb-g1.ctb` (included by the live `en-ueb-g2.ctb` table Emboss
actually translates with) fully defines all of it:

```
88: emphclass italic
89: emphclass underline
90: emphclass bold
91: emphclass script
92: emphclass transnote
93: emphclass trans1
...
97: emphclass trans5
...
120-125: emphletter/begemphword/endemphword/lenemphphrase/begemphphrase/endemphphrase script
131-164: the same full set of signs for trans1 through trans5
```

Reproduced (scratch probe, `assess-5/probe.mjs`, real `formatDocument` + real liblouis, BANA
40×25 — not a committed repo test):

- TEST 3: a segment with `tf: 8` (script) manually built renders as `@1SCRIPT` — a correct,
  distinct word-scope script indicator — even though nothing in Emboss's own code can ever
  produce `tf: 8` from real input.
- TEST 4: a segment with `tf: 32` (trans1) renders as `@#1SPECIAL` — a correct, distinct
  word-scope transcriber-defined-indicator-1 sign, again unreachable from real input.

**What the standard requires:** italics/bold/underline/script all need their defined UEB
symbol; anything else (color, double-underlining, small caps not otherwise distinguished,
highlighting, words in shapes) needs one of the five transcriber-defined indicators, used in
order (5.5.2) and explained on a Special Symbols page or in a transcriber's note (5.5.3).

**Classification:** **not built.** This is not a liblouis/engine limitation — the engine and
the UEB table both work correctly the moment a typeform bit reaches them. The entire gap is
in Emboss's own plumbing: nothing in the parser ever recognizes a print feature that should
become script or a transcriber-defined indicator, nothing in `TYPEFORM` exposes the bits, and
the editor has no UI to apply them. This blocks: 5.1.4/5.5.1 (script + all 5
transcriber-defined attributes), 5.5.2 (ordering — nothing to order), 5.5.3 (nothing exists
to list on a Special Symbols page, which itself also doesn't exist — see F-89), 5.9.1/5.9.2
(words in shapes), and the worked examples that depend on them (Example 5-14, Sample 5-1,
Sample 5-3, Example 5-17).

**Test that would prove a fix:** a parser test asserting that a recognized non-italic/
bold/underline print feature (e.g. an inline `<span class="color-blue">`, `<span
style="font-family:cursive">`, or a `<span class="shape-rectangle">`) produces a segment with
the correct `tf` bit (8 for script, 32/64/128/256/512 for trans1-5, assigned in first-use
order per 5.5.2); an editor test that a UI control can apply script/transcriber-defined
typeform to a selection; a `document.mjs` round trip confirming the resulting braille carries
the correct liblouis-emitted sign.

**Status: not fixed.**

---

## F-87 — `formatHeading`'s unconditional `stripEmphasis` also blocks 5.3.1's "partially
emphasized" exception and 5.4.2's title/preposition worked examples (same root cause as F-41)

**Rules:** BANA 5.3.1 (in part), 5.4.2

> "When these items are partially emphasized, however, font attributes must be retained."
> (BANA 5.3.1) / "Follow print when a title is printed in italics or other emphasizing
> typeface and follows a preposition that is in a different typeface..." (BANA 5.4.2, as
> illustrated by Examples 5-11/5-12)

**What Emboss does:** `stripEmphasis` (`Emboss/format/document.mjs:153-155`) unconditionally
drops `tf` from every segment of every centred/cell-5/cell-7 heading (`formatHeading`,
`document.mjs:308-320`), with no field or code path that ever preserves any part of a
heading's typeform. `standards-findings.md` F-41 already documents this exact defect for
Formats §4.3.7's own "unless necessary for clarity" exception (using `example-4-7` and
`sample-4-03` from the §4 gold corpus). §5's own rules hit the identical code from two
different angles:

- 5.3.1's "partially emphasized...must be retained" exception describes a heading where
  SOME but not all of the text is emphasized — `stripEmphasis` cannot honour this, because it
  strips everything regardless of whether the emphasis is partial or total. Reproduced
  (`assess-5/probe.mjs` TEST 5): a heading `"Chapter One: "` (plain) + `"The Beginning"`
  (`tf:1`, italic) renders as `,*APT] ,"O3 ,! ,2G9N+` — no italics anywhere.
- 5.4.2's own worked examples (5-11, 5-12) are BOTH headings where a title keeps its italics
  while a preposition/byline stays plain, or vice versa — the exact "partial retention"
  shape `stripEmphasis` cannot produce.

**What the standard requires:** a heading's typeform is dropped by default, but retained
for the part of it that needs to stay distinguishable (5.3.1's own wording; 5.4.2's worked
examples).

**Classification:** **not built** — same classification as F-41, since it is the same
missing mechanism (an opt-in "keep this segment's typeform" signal on a heading block) seen
from a second, independent angle in a different section of the standard. Recommend
resolving F-41 and this finding together rather than as two separate fixes.

**Test that would prove a fix:** the same test F-41 asks for (a heading block whose segments
carry `tf` and an explicit "keep this" signal formats WITH the typeform indicator preserved
around exactly the marked segment) would also cover 5.3.1's partial-emphasis exception and
5.4.2's title/preposition worked examples once it exists.

**Status: not fixed.** (Tracked jointly with F-41; not a new independent code path.)

---

## F-88 — `formatList` never strips decorative typeform, the mirror-image gap to F-87/F-41

**Rules:** BANA 5.3.1 (in part), 5.3.7

> "In general, font attributes in tables of contents, headings..., dedications, titles,
> lists, etc., do not reinforce learning or have any additional value for the reader." (BANA
> 5.3.1) / "Ignore font attributes when an entire vocabulary or spelling words list is
> emphasized." (BANA 5.3.7)

**What Emboss does:** `formatList` (`Emboss/format/document.mjs:450-491`) renders
`item.segments` via `segmentsToBraille` with no call to `stripEmphasis` anywhere in the
function — unlike headings (F-87/F-41) and stage directions (§14.4.1c, correctly stripped),
a list/TOC item's `tf` is ALWAYS retained, regardless of whether the emphasis is purely
decorative. Reproduced (`assess-5/probe.mjs` TEST 6): a list item `"An "` + `"emphasised"`
(`tf:1`) + `" list entry."` renders as `#A4 ,AN .1EMPHASIS$ LI/ 5TRY4` — the italic word
indicator is kept.

This is the opposite failure mode from headings: headings ALWAYS strip (wrong when partial
retention is needed, F-87), lists NEVER strip (wrong when the whole item's emphasis is purely
decorative, as 5.3.1's default and 5.3.7's "entire list" case both require).

**What the standard requires:** decorative font attributes in lists/TOC/dedications/titles
are ignored by default (5.3.1); an entire vocabulary/spelling list that is emphasized in
print is transcribed with no attribute at all (5.3.7, Example 5-7).

**Classification:** **not built.** Judging "is this decorative" is a human/editorial call
Emboss cannot make unaided (matching this map's treatment of comparable judgement calls,
e.g. BANA 11.2.3), but 5.3.7's case is closer to mechanical: "the entire list is
emphasized" is a checkable property of the block (every item's segments carry the same
non-zero `tf`) that Emboss could act on without needing semantic judgement, and currently
does not.

**Test that would prove a fix:** a list block where every item is uniformly emphasized
formats with the emphasis dropped from every item (5.3.7); a list block with a
transcriber-supplied "this attribute is decorative, ignore it" signal (mirroring the F-87/
F-41 fix in spirit) formats accordingly.

**Status: not fixed.**

---

## F-89 — No Special Symbols page exists in any generalised form

**Rule:** BANA 5.5.3 (and, by dependence, 5.9.2)

> "The transcriber-defined indicator(s) and termination indicator(s) are listed on the
> Special Symbols page, or in a transcriber's note before the text." (BANA 5.5.3)

**What Emboss does:** `Emboss/format/document.mjs:104`'s own comment states: "Until the
Special Symbols page exists (G8), the first transcriber-defined symbol is explained in a
transcriber's note before its first use..." — confirming this is a known, standing gap, not
newly discovered here. The only transcriber-defined symbol Emboss currently has any support
for at all is a single hardcoded print-asterism substitute (`TD_SYMBOL_1 = ';?'`,
`document.mjs:92-111`), explained via a hand-written, ad hoc transcriber's note
(`tdSymbolNote`) — unrelated to font-attribute typeform indicators and not a generalised
"Special Symbols page" mechanism usable for any other symbol category (guide dots, braille
indicators for tables, or the typeform indicators §5 needs).

**What the standard requires:** every transcriber-defined indicator and its terminator used
anywhere in a volume must be listed, either on a dedicated Special Symbols page or in a
transcriber's note before the text.

**Classification:** **not built.** Blocked further by F-86 (there is nothing to list, since
no transcriber-defined typeform indicators can be produced in the first place), but this is
an independent, pre-existing gap in its own right — a Special Symbols page would also be
needed for BANA's other symbol categories (guide dots, tables, etc.), not just typeforms.

**Test that would prove a fix:** a document using two or more transcriber-defined symbols
(of any kind) produces a Special-Symbols-page block listing each with its definition, in
first-use order.

**Status: not fixed.**

---

## F-90 — A font-emphasis passage spanning consecutive paragraphs gets a terminator on
EVERY paragraph, not just the final one

**Rule:** BANA 5.6.2

> "Insert the passage terminator at the end of the final paragraph." (BANA 5.6.2)

**What Emboss does:** Each block (including each paragraph) is formatted and translated
independently; nothing in `document.mjs` tracks "this paragraph continues an open typeform
passage begun in the previous block". Reproduced (`assess-5/probe.mjs` TEST 7): two
consecutive, fully-italicised paragraphs each independently open a passage indicator (".7")
AND independently close it with a terminator (".'") — the first paragraph's terminator should
not be there per 5.6.2 (only the passage indicator at each paragraph's start, per 5.6.1,
which IS satisfied correctly, being a side effect of the same independent-block
translation).

**What the standard requires:** one opening passage indicator per paragraph of the run
(5.6.1 — already satisfied), but only ONE terminator, at the very end of the LAST paragraph
of the run (5.6.2).

**Classification:** **bug** (a UEB-conformance defect, not merely unimplemented): any
document with a font-emphasis passage spanning more than one paragraph will emit an extra,
incorrect terminator/reopen pair at every paragraph boundary within the passage.

**Test that would prove a fix:** two (or more) consecutive paragraphs sharing one
document-level "this is one continuing typeform passage" flag format with a passage
indicator at the start of each paragraph but a terminator only after the last one.

**Status: not fixed.**

---

## F-91 — No color, small-caps, or shape-detection code exists anywhere in the parser

**Rules:** BANA 5.2.1a, 5.2.1b, 5.4.1 (in part), 5.9.1, Sample 5-3

**What Emboss does:** Exhaustive grep of `Emboss/input/parse.mjs`, `Emboss/format/
document.mjs`, `Emboss/web/editor/editor.mjs`, and `Emboss/format/cell-markup.mjs` finds:
zero matches for "smallcap"/"small cap"/"font-variant" (small capitals, 5.2.1a/5.2.1b); zero
matches for any inline colour style/attribute read into a segment (`style`/`color` as a
markup signal — the only "color"/"highlight" hits in `editor.mjs` are the editor's OWN UI
chrome, e.g. button background colour, unrelated to document content) (5.4.1's colour
clause, Sample 5-3's six colour indicators); zero matches for "rectangle"/"oval"/"shape"/
"border" as a content construct (5.9.1's words-enclosed-in-shapes).

**What the standard requires:** small capitals get a transcriber-defined indicator or full
capitalisation (5.2.1a/b); colour is followed in braille via a transcriber-defined indicator
when meaningful (5.4.1, Sample 5-3); words enclosed in shapes get a transcriber-defined
indicator (5.9.1).

**Classification:** **not built.** Distinct from F-86 (which is about the typeform-bit
plumbing once a feature IS detected): this finding is that the features themselves are never
detected from source markup in the first place — even if F-86 were fixed, none of these
three print features would ever reach the typeform mechanism, because nothing recognizes
them as input.

**Test that would prove a fix:** a parser test that an inline colour style, a small-caps
style, or a shape/border wrapper on a `<span>` produces a segment carrying the appropriate
typeform bit (once F-86 also exists).

**Status: not fixed.**

---

## F-92 — Italics/bold/underline scope (symbol/word/passage) and terminators are correctly
produced end-to-end, but proven only by an ad hoc probe, not a committed test

**Rules:** BANA 5.1.4 (italic/bold/underline portion), 5.6.1, 5.7.1a, 5.7.1b, 5.7.1c

**What Emboss does:** `groupSegments` (`document.mjs:553-579`) groups adjacent
same-typeform text into one liblouis `translate()` call (with a per-character typeform
array), so liblouis's own UEB-table logic can correctly choose a symbol-, word-, or
passage-scope indicator and emit the matching terminator — including when emphasis starts or
ends mid-word, and when an emphasised word is immediately followed by punctuation (the
`document.mjs:548-550` comment cites this as a previously-fixed defect, "A27a"). Verified
directly against real `formatDocument` + real liblouis (BANA 40×25) in `assess-5/probe.mjs`:

- TEST 1: a standing-alone italic letter → symbol indicator (`.2`); an italic whole word →
  word indicator (`.1`); a fully italicised sentence → passage indicator (`.7`)…terminator
  (`.'`).
- TEST 8: an italicised word immediately followed by a comma → correct terminator placement.
- TEST 9: italics starting/ending mid-word (Example 5-15's own construct) → correct
  indicator/terminator pair at the internal boundary.
- TEST 10: emphasis on only the initial letter of a word that still contracts to a
  whole-word sign (5.7.1b's own scenario) → the contraction is used, correctly wrapped.

**What the standard requires:** exactly this behaviour (5.1.4, 5.6.1, 5.7.1a-c).

**Classification:** **working as required**, i.e. these sub-rules are genuinely "done" —
this finding exists only to flag that NO committed repository test currently proves any of
it (the only existing typeform tests, `nimas_bana_structures.test.mjs` and
`formatting_serialization_roundtrip.test.mjs`, check that `tf` bits are correctly assigned
by the parser and round-tripped through NIMAS XML, not that liblouis picks the right
indicator scope or terminator placement). A future regression in `groupSegments` or the
liblouis table upgrade would go undetected.

**Test that would prove it stays fixed:** commit a test (e.g.
`Emboss/tests/typeform_scope.test.mjs`) covering the constructs in TESTs 1/8/9/10 above,
asserting on the literal BRF indicator/terminator characters.

**Status: working, not covered by a committed test.**

---

## Coverage note

Every §5 row of `standards-map.md` marked `partial`, `not done`, or `out of scope` is
covered by one of F-86 through F-91 above (or by the pre-existing F-41, for the heading
portion of 5.3.1/5.4.2, tracked jointly as F-87). F-92 documents working behaviour that
lacks committed test coverage. No row was left unaddressed.

---

# Standards findings — displayed material, attributions, source information (BANA §9, B004 Appendix G; assessed 17 Sep 2026)

## F-93 — A multi-paragraph displayed passage keeps one blank line between its own
paragraphs, not zero

**Rule:** BANA 9.2.2b

> "Do not insert blank lines between individual items in displayed material unless required
> by other formats, e.g., between a heading and a paragraph."

**What Emboss does:** `input/parse.mjs`'s blockquote handling turns a `<blockquote>` with two
`<p>` children into two sibling blocks, `{type:'para', style:'quote', text:'...'}` each — this
is exactly "one displayed passage with two paragraphs". `quoteMargins`/`quoteLines`
(`Emboss/format/document.mjs:511-526`) give every quote-styled paragraph its own leading and
trailing blank line (`['', ...lines, '']`) unconditionally, with no code that recognises "this
paragraph is followed by another paragraph of the *same* displayed passage" the way
`joinsWithoutBlank` (document.mjs:274-279) recognises heading-to-heading adjacency and drops
the blank entirely.

Reproduced (`probe1.mjs`, BANA mode, width 30):
```
{ type: 'para', style: 'quote', text: 'Quote paragraph A.' },
{ type: 'para', style: 'quote', text: 'Quote paragraph B.' },
```
renders as
```
  QUOTE PARAGRAPH A.
                        <- one blank line
  QUOTE PARAGRAPH B.
```
The passage's own outer boundary (one blank before the first paragraph, one after the last)
is correct — only the *inter*-paragraph gap is wrong. Something downstream collapses the two
blocks' doubled blank (each contributes one) down to one line rather than to zero, since two
consecutive blank *strings* in the content array would otherwise show as two blank braille
lines, and only one appears.

**What the standard requires:** zero blank lines between the paragraphs of one displayed
passage (the "e.g., between a heading and a paragraph" clause is the sole named exception,
and does not apply here).

**Classification:** **bug.** Any multi-paragraph quotation, epigraph or extract gets a
spurious blank line inserted between its own paragraphs.

**Test that would prove a fix:** a document with two consecutive `{type:'para',
style:'quote'}` blocks; assert the formatted output has **no** blank line between them (only
the single leading/trailing blank of the passage as a whole).

**Status update (17 Sep 2026, fixed):** `joinsWithoutBlank` (`Emboss/format/document.mjs`)
gained a §9.2.2b case, following the exact shape of its existing heading-tier logic (F-26):
when the block that follows is a `para` and BOTH it and the preceding block resolve to the
same `quoteMargins` (same `first`/`runover`, i.e. the same adjusted margin — same quote style
bucket at the same nesting `level`), the join drops the blank line entirely, the same
drop-and-collapse machinery the heading cases already use — the preceding paragraph's own
trailing blank and the following paragraph's own leading blank are both removed, not merged
into one. A different nesting level (a different adjusted margin) is treated as a different
passage and keeps the default blank (regression-tested directly). This required restructuring
`joinsWithoutBlank`'s own top-level guard, which previously short-circuited to `false` for any
`prev` that was not a heading; it now branches on `prev.type === 'heading'` internally, adding
the new quote-paragraph case as a sibling branch, with no change to the heading logic itself.
Tests: `Emboss/tests/displayed_and_verse_rules.test.mjs` — two and three consecutive quote
paragraphs (no blank between any pair, outer blank kept before the first / after the last); a
quote paragraph followed by an ordinary paragraph (outer blank unaffected); two nested
(`level:1`) quote paragraphs (still no blank, at the nested margin); a quote paragraph next to
one at a *different* level (blank kept — different margin, not "the same displayed passage").
No change was needed to `formatPara`/`formatSegmentedPara`/`traceBlock` themselves — the fix
is entirely in the cross-block join logic, so formatBlock/traceBlock parity for a quote
paragraph is unaffected (pre-existing tests still pass). Gold: no BANA §9 worked example
contains two consecutive `kind:"quote"` print blocks, so this fix is proved by the unit test,
not by a gold-run status change; `node Emboss/scripts/gold-run.mjs --section section-9
--update-status` shows no status changes (§9's own multi-paragraph blockquotes are, in this
corpus, single-paragraph). A DTBook built with `exportToNimasXml` for a two-paragraph
`<blockquote>`, re-parsed with `parseDtbook` and formatted, shows zero blank lines between the
two paragraphs and passes `Emboss/scripts/daisy-validate.mjs` (0 errors, 7 suppressed
known-bug `<meta>` warnings).

---

## F-94 — Epigraphs are formatted exactly like Blockquote: wrong margin, and font attributes
are never omitted

**Rules:** BANA 9.3.1b, 9.3.1c, 9.3.1e

> "Do not treat epigraphs as displayed material." (9.3.1c)
> "Transcribe epigraphs according to their formats, i.e., a poem in poetry format, 3-1
> margins for indented paragraphs, etc." (9.3.1b)
> "Omit font attributes unless needed for distinction." (9.3.1e)

**What Emboss does:** `input/parse.mjs` parses an `<epigraph>` element exactly like a
`<blockquote>` — both go through the same branch (`cTag === 'epigraph' || cTag ===
'blockquote'`, line 2625-2626) producing `{type:'para', style:'quote', ...}`. `QUOTE_STYLES`
(`Emboss/format/document.mjs:510`) explicitly includes `'epigraph'` alongside `'quote'` /
`'blockquote'` / `'extract'` / `'displayed'`, so `quoteMargins` gives an epigraph paragraph
the *identical* treatment as a Blockquote: the displayed-material adjusted margin (cell 3,
blocked) plus a blank line before and after.

Reproduced (`probe1.mjs`, BANA mode, width 30):
```
{ type: 'para', style: 'epigraph', text: 'Epigraph line one.' }
```
renders as
```
  BEFORE PARAGRAPH.
                        <- blank
  EPIGRAPH LINE ONE.
                        <- blank
  AFTER PARAGRAPH.
```
— byte-identical margin/blank pattern to a `style:'quote'` paragraph in the same position
(compare `probe1.mjs`'s "BANA quote blank-line behaviour" trace). This directly contradicts
9.3.1c, and makes 9.3.1b's own worked example unreachable: an epigraph that is an "indented
paragraph" should get the ordinary body-paragraph margin "3-1" (BANA §1.9: cell 3 first line,
cell 1 runover) — not the quote's adjusted 3-3 blocked margin it actually gets. A verse
epigraph can only get correct poetry formatting if the transcriber uses the separate Poem
style instead of Epigraph/Blockquote — nothing routes an `<epigraph><poem>...` structure to
poetry formatting automatically.

Separately, `segmentsToBraille` (document.mjs:634-660), used for every paragraph including
epigraphs, applies whatever `tf` (typeform) a segment already carries unconditionally — there
is no logic anywhere that omits font attributes on an epigraph by default and restores them
only "when needed for distinction" (9.3.1e). (9.2.3a/b, the parallel pair for ordinary
displayed material, has the same one-sided gap: 9.2.3a's "retain for partial emphasis" is
satisfied by the same pass-through, but 9.2.3b's "omit when the whole passage is emphasised"
has no detection logic at all — see F-99.)

**What the standard requires:** an epigraph keeps its OWN print-format margins (3-1 for a
plain paragraph, poetry format for verse, etc.), not the displayed-material adjusted margin;
9.3.1d's blank-line-before/after is the one thing that happens to coincide with quote's
existing behaviour.

**Classification:** **bug** (9.3.1b/9.3.1c — margin) and **not done, missing feature**
(9.3.1e — no font-attribute omission exists for anything, epigraph included). Fixing the
margin bug likely means giving `epigraph` its own entry in `QUOTE_STYLES`/`quoteMargins` (or
removing it from that set and mapping it to plain-paragraph margins by default), which is a
design decision for Paul — `Emboss/docs/style-specification.md` already flags "epigraphs
(BANA §9.3) — same style or separate?" as an open question (line 128). See `questions-9.md`
Q-30.

**Test that would prove a fix:** an epigraph paragraph in BANA mode; assert it renders at the
ordinary body-paragraph margin (cell 3 / cell 1), not cell 3 / cell 3, while still keeping the
blank line before and after (9.3.1d).

**Status update (17 Sep 2026, fixed — margin, 9.3.1b/c; 9.3.1e left open):** the margin bug is
**done**: Paul's decision (per this task) was a distinct style, not folding epigraph into
plain-paragraph margins by default — `epigraph` is removed from `QUOTE_STYLES`
(`Emboss/format/document.mjs`), so `quoteMargins` returns `null` for it and it falls through
to `formatPara`/`formatSegmentedPara`'s ordinary paragraph branch (3-1, or 1-1 if the
transcriber's own print marks it `blocked`, §1.9.3's "etc." case) — not a reimplementation,
the SAME margin code path every other paragraph already uses. 9.3.1d's blank line before/after
(the one thing that genuinely coincides with Blockquote) is added independently by a small
`withEpigraphBlanks`/`withEpigraphBlanksTc` helper pair, gated to BANA mode (B004 names no
epigraph rule), applied in `formatPara`, `formatSegmentedPara`, `traceBlock`'s `paraLike` and
its segmented `case 'para'` branch (parity proven directly, see tests below) — kept outside
`QUOTE_STYLES` deliberately so 9.3.1c's own wording ("do not treat as displayed material")
stays true of the margin, not just the blank line. A poem epigraph (9.3.1b's own "a poem in
poetry format" case) needed no formatter change at all: `input/parse.mjs`'s `<epigraph>`
handling (new top-level branch, mirroring `<blockquote>`'s own hasElements/pushParaParts
shape) walks a `<poem>` child as itself, which was already routed to the ordinary `parsePoem`
dispatch — reproduced directly (`<epigraph><poem><linegroup><line>...` parses to plain
`{type:'play', subtype:'verse', ...}` blocks, no `style:'epigraph'` anywhere).
**9.3.1e (font attributes) is explicitly NOT part of this fix** — out of this task's scope
(see F-99's identical gap for 9.2.3b) and left **not done, missing feature**, unchanged.
- **Model/formatter:** `Emboss/format/document.mjs` — `QUOTE_STYLES` narrowed to
  `quote`/`blockquote`/`extract`/`displayed`; `isEpigraph`/`withEpigraphBlanks` (formatPara/
  formatSegmentedPara) and `withEpigraphBlanksTc` (traceBlock) added. Tests (all in
  `Emboss/tests/displayed_and_verse_rules.test.mjs`): an epigraph gets the ordinary 3-1
  margin, not Blockquote's 3-3 (proven against a long paragraph that wraps, checking both the
  first line AND the runover); the blank line before/after is kept; a `block.blocked` epigraph
  (print's own blocked convention, 9.3.1b's "etc.") is 1-1, not forced to 3-1;
  formatBlock/traceBlock parity for a plain-text and a segmented (typeform) epigraph
  paragraph.
- **DTBook round trip:** `input/parse.mjs` gained a top-level `tag === 'epigraph'` branch in
  `walk()` (DTD: `<!ELEMENT epigraph (%flow;)*>`, dtbook-2005-3.dtd, valid directly under a
  `levelN`) — plain running text becomes `{type:'para', style:'epigraph', ...}`; a block child
  is walked as itself. A new `isInsideEpigraph` check (mirroring the existing `isInsideQuote`)
  in the `tag === 'p'` dispatch tags a `<p>` directly inside `<epigraph>` the same way, so a
  multi-paragraph epigraph (checked directly: `<epigraph><p>...</p><p>...</p></epigraph>`)
  round-trips both paragraphs as `style:'epigraph'`, not the first only. The pre-existing
  nested `cTag === 'epigraph' || cTag === 'blockquote'` branch inside `parsePoem`'s own
  linegroup-child handling (an `<epigraph>`/`<blockquote>` interleaved between poem lines) is
  split into its own `cTag === 'epigraph'` arm emitting `style:'epigraph'`, leaving the
  `blockquote` arm unchanged. `Emboss/input/nimas-export.mjs`'s `case 'para'` gained a
  `block.style === 'epigraph'` branch emitting `<epigraph><p>...</p></epigraph>`, checked
  directly before the pre-existing `quote`/`blockquote` branch so it cannot be shadowed.
  Checked directly against the fuzz corpus (`node scripts/run_1000_corpus_benchmark.mjs`):
  the naive `hasElements` test copied from `<blockquote>`'s own branch mis-classified a bare
  inline child (`<epigraph>text<span>more</span></epigraph>`, no `<p>`) as block content,
  silently dropping the loose text node when `walk()` (which only visits ELEMENT children)
  recursed into it — the SAME latent gap `<blockquote>` still has, not introduced by this fix,
  left alone there since it is out of this task's scope. Fixed for the new `<epigraph>` branch
  only by excluding `INLINE_TAGS` from its own `hasElements` test, matching the "unknown
  container" fallback's own `wrapInlineRuns` convention; confirmed by the corpus benchmark
  going from 1149/1150 back to 1150/1150 DTBook files after the fix (the one prior failure,
  `file_0057_shuffled_5857_xmldtbook_1.xml`, has exactly this shape).
- **Editor style list / locale:** `Emboss/format/styles.mjs` gained an `epigraph`
  `STYLE_DEFINITIONS` entry (3-1, blank before/after, `xmlTag: 'epigraph'`) for the Style
  Inspector, and `resolveStyleFromXml` maps the `epigraph` tag to it (checked ahead of the
  `quote` rule so it is not shadowed). `Emboss/web/locales/en.json` gained
  `app.style_names.epigraph = "Epigraph"` **only**, per instruction — every other language
  falls back to English until translated. The interactive editor's own toolbar/slash-menu
  entry for selecting the Epigraph style (the `editor.mjs` wiring §9.3 would need, on the
  pattern F-39's `blocked` toggle established) was **not** added — `editor.mjs` cannot be
  imported under plain Node, the change touches several coordinated points (dropdown
  definition, `banaStyle` mapping, detection heuristics), and it is not needed by this task's
  own verification steps (a document model with an epigraph block can be built and exported
  directly without going through the interactive editor) — left open, flagged for Paul.
- **Gold:** `node Emboss/scripts/gold-run.mjs --section section-9 --update-status` shows no
  status changes; `sample-9-05` (BANA's own "Sample 9-5: Epigraph") stays `not-representable`
  for an already-documented, unrelated reason (its own leading `kind:'other'` running-head
  block) — its own epigraph paragraph's margin is unaffected by that, but the sample's gold
  braille also blocks its epigraph at cell 1 (matching this book's own blocked-paragraph
  convention, per the gold file's own note), which `buildModel9` does not currently signal via
  `block.blocked` — an already-documented harness limitation (see this section's own README,
  "Known, expected non-matches": the whole gold-run harness uses one document-wide
  `paragraphStyle`, not a per-sample override), not a new gap this fix introduces.
  `--section section-4`/`--section section-8` show no status changes (neither section's
  content uses `style:'epigraph'`). A DTBook built with `exportToNimasXml` for a two-paragraph
  epigraph, re-parsed with `parseDtbook` and formatted, round-trips both paragraphs as
  `style:'epigraph'` and passes `Emboss/scripts/daisy-validate.mjs` (0 errors, 7 suppressed
  known-bug `<meta>` warnings).

---

## F-95 — Headings inside displayed material never get the adjusted margin (and Blockquote's
content model has no place for one)

**Rule:** BANA 9.2.2c

> "Cell-5 and cell-7 headings within displayed material are based on the adjusted left
> margin. Consequently the margins for cell-5 headings are blocked in 7-7, and cell-7
> headings are blocked in 9-9."

**What Emboss does:** `formatHeading` (`Emboss/format/document.mjs:308-333`) computes cell-5
and cell-7 margins as fixed offsets — `wrapCells(plainT(), w, 4, 4)` and `wrapCells(plainT(),
w, 6, 6)` — with no parameter for an enclosing quote/displayed-material context, unlike
`formatPara`, which explicitly checks `quoteMargins(block, o)` before falling back to ordinary
paragraph margins. There is no equivalent check in `formatHeading` at all. Separately,
`Emboss/docs/style-specification.md`'s own containment table (§5, "Blockquote | paragraphs,
lists, poem, attribution") does not list a heading among the blocks a Blockquote may contain —
so even authoring a heading "inside displayed material" has no defined route through the
parser or style registry today.

**What the standard requires:** a cell-5/cell-7 heading appearing within displayed material
is blocked 2 cells further right than usual (7-7 / 9-9 instead of 5-5 / 7-7), tracking
whatever the surrounding displayed material's own adjusted margin is; a centred heading inside
displayed material keeps its full-width centring but needs 3 blank cells of separation from
the adjusted margin.

**Classification:** **not done** (missing feature) for the margin shift; the containment gap
is a prerequisite design question (does Emboss even support a heading inside a quote at all?)
— see `questions-9.md` Q-33.

**Test that would prove a fix:** once headings can appear inside displayed material, a
cell-5/cell-7 heading there should be built and asserted at 7-7/9-9 instead of the ordinary
5-5/7-7.

---

## F-96 — The nested-list adjusted-margin example (BANA 9.2.2) is not verified against any
real parsed or authored document

**Rule:** BANA 9.2.2

> "...it may be necessary to change this left margin for some types of displayed material,
> e.g., displayed material within a nested list that has margins 1-7, 3-7, 5-7 would begin in
> cell 9."

**What Emboss does:** `quoteMargins` (document.mjs:511-517) computes `nest = block.level * 2`
and adds it to the cell-3 base, so `level=3` correctly arithmetically reaches cell 9 (2 + 2×3
= 8, i.e. offset 8 = cell 9) matching the rule's own example. But no path was found in
`input/parse.mjs` or `web/editor/editor.mjs` that sets a quote paragraph's `level` from the
nesting depth of a *surrounding list* — the one existing assignment of `level` to a
`style:'quote'` block (`input/parse.mjs:3262`) derives it from `getElementLevel(child)`, which
tracks DTBook's document-section nesting (`<level1>`…`<level6>`), not list-item depth. The
cell-9 example was only reproduced in `probe1.mjs` by hand-setting `level: 1` on a quote block
placed as a sibling of a list, not by parsing or authoring the actual nested-list-containing-
displayed-material structure the rule describes.

**What the standard requires:** the adjusted margin tracks the actual surrounding runover
position, whatever nesting produced it.

**Classification:** **unclear** — the arithmetic is right, but whether any real input can
reach it is unverified; needs a decision on whether/how a quote block should inherit nesting
level from a containing list (see `questions-9.md` Q-28).

**Test that would prove a fix:** a DTBook fixture with a `<blockquote>` genuinely nested
inside a 3-level list, parsed and formatted, asserting the resulting margin is cell 9.

---

## F-97 — BANA's "indented" displayed-paragraph option does not exist; only "blocked" is
available

**Rule:** BANA 9.2.2d

> "Blocked paragraphs are blocked at the adjusted left margin; indented paragraphs begin 2
> cells to the right of the adjusted left margin."

**What Emboss does:** `quoteMargins` (document.mjs:514-516) always returns `first === runover`
for BANA (`{first: 2+nest, runover: 2+nest, blank:true}`) — i.e. only the "blocked" case (3-3,
or 5-5/7-7 nested) is ever produced. The "indented" alternative (first line 2 cells right of
the adjusted margin, e.g. 5-3) has no code path and no style-registry option.
`Emboss/docs/style-specification.md` (line 128) already records this as an open question:
"offer BANA's blocked vs indented choice (BB has both)?"

**What the standard requires:** either option is print-format-dependent; Emboss should be
able to produce whichever the transcriber selects.

**Classification:** **not done** (missing feature; also a style-spec open question — see
`questions-9.md` Q-29).

**Test that would prove a fix:** once an "indented" quote variant exists (however it is
selected), assert its first line is 2 cells right of `runover`, e.g. cell 5 / cell 3 for BANA.

---

## F-98 — No code recognises BANA's "displayed word list" construct at all (short or long)

**Rules:** BANA 9.2.4, 9.2.5a, 9.2.5b, 9.2.5c

> "Horizontal word lists across the print page must fit on a single braille line, with each
> word separated by a blank cell... Change word lists that do not fit on a single braille
> line to columns, listing the words from left to right."

**What Emboss does:** there is no block type or check anywhere in `document.mjs`/`parse.mjs`
for a "word list" as BANA describes it — a print horizontal word list arrives (if at all) as
an ordinary paragraph or quote paragraph and is plain word-wrapped by `formatParagraph`/
`wrapCells`, with no verification that it fits on one line (9.2.4) and no fallback to a
left-to-right multi-column layout when it doesn't (9.2.5a), so the associated column-gutter
(9.2.5b) and no-guide-dots (9.2.5c) rules have nothing to apply to either — Emboss's List
style (`formatList`, document.mjs:450+) is a vertical, one-item-per-line format (bulleted /
numbered / plain), not a horizontal-then-columnar word arrangement.

**What the standard requires:** a short word list is kept on one braille line (words
separated by a blank cell); a long one is broken into left-to-right columns with a 2-cell
gutter and no guide dots.

**Classification:** **not done** (missing feature) for all four rows.

**Test that would prove a fix:** a short word list that fits on one line, asserting it stays
on one line with single-cell word separation; a long one that doesn't fit, asserting it
becomes left-to-right columns with a 2-cell gutter and no guide dots.

---

## F-99 — Font attributes on a fully-emphasised displayed passage are never omitted

**Rule:** BANA 9.2.3b

> "Omit font attributes when the entire section of displayed material is emphasized."

**What Emboss does:** `segmentsToBraille` (document.mjs:634-660) translates every segment
with whatever `tf` it carries, unconditionally — there is no check for "every segment in this
displayed passage shares the same non-zero `tf`" that would trigger omitting it. (9.2.3a, the
partial-emphasis case, is satisfied by this same pass-through, which is why it is marked
done — the gap is specifically the *omit-when-whole-passage* exception.)

**What the standard requires:** when print italicises (or otherwise emphasises) an entire
displayed passage for legibility reasons rather than for genuine distinction, braille drops
the font-attribute indicators throughout.

**Classification:** **not done** (missing feature).

**Test that would prove a fix:** a quote-styled paragraph whose every segment carries the same
non-zero `tf`; assert the emitted braille carries no typeform indicators, while a paragraph
with only *some* segments emphasised still keeps them (9.2.3a, already correct).

---

## F-100 — Attributions and citations have no page-boundary awareness

**Rules:** BANA 9.4.1a, BANA 9.5.1b (page clause)

> "Do not start the attribution on a new braille page." (9.4.1a)
> "At least one line of the source citation must be on the same page as the material to
> which it applies." (9.5.1b)

**What Emboss does:** `Emboss/format/page.mjs`'s `assemble()` has no keep-with-previous-block
concept of any kind — a grep for "keepWithNext"/"orphan"/"widow"/"neverStartsPage" across
`format/page.mjs` finds nothing. An `attribution` block (or any block reused to carry a source
citation, see F-101) is paginated exactly like any other content line, purely by line count, so
nothing stops it landing as the very first line of a new braille page. This is the same root
cause already reported for tables in this map's §11 assessment (BANA 11.2.6c/d/e, "not done" —
`page.mjs`'s pagination has no block-type awareness at all).

**What the standard requires:** an attribution stays with (or is carried forward attached to)
the text it follows, never opening a page on its own; a source citation keeps at least one
line on the same page as the material it cites.

**Classification:** **not done** (missing feature).

**Test that would prove a fix:** a document engineered so an attribution/citation would fall
as the first line of a page under plain line-count pagination; assert the page break instead
moves earlier, carrying the last line of the preceding text across with it.

---

## F-101 — BANA §9.5 Source Citations has no dedicated style; Attribution must be overloaded

**Rules:** BANA 9.5.1a (placement), BANA 9.5.1b (margin half)

> "Source citations are inserted at the most appropriate location." (9.5.1a)
> "Block a source citation in the fifth cell to the right of the beginning of the previous
> line." (9.5.1b)

**What Emboss does:** there is no `citation`/`source` block type or style-registry entry
anywhere (`Emboss/format/styles.mjs` has no such entry; `Emboss/docs/style-specification.md`
line 138 explicitly flags this as open: "add BANA's Source Citation (§9.5, BB has it) as a
separate style?"). The only way to get the cell-5 blocking 9.5.1b wants is to reuse the
`attribution` block/style, which happens to give the right margin and blank-line behaviour
(reproduced in `probe2.mjs`: an `attribution` block placed after an ordinary paragraph gets no
blank before it and one after; placed after a heading, no blank at all between them — see the
"done" rows 9.5.1c/9.5.1d/9.5.2 in `standards-map.md`) — but nothing in the data model or UI
distinguishes "this is Formats §9.4 Attribution" from "this is Formats §9.5 Source Citation",
two sections the standard treats separately (with different exception clauses, e.g. 9.5.1b's
page-keeping rule, F-100). 9.5.1a's placement judgement is the transcriber's call in any case
(marked "out of scope").

**What the standard requires:** a source citation is its own concept, separately named from
an attribution, with its own placement and page-keeping rules.

**Classification:** **deliberate choice, pending Paul** (whether reusing Attribution is
acceptable, or a distinct Source Citation style should be added) — see `questions-9.md`
Q-31.

**Test that would prove a fix:** N/A until Paul decides; if a distinct style is added, the
existing attribution-margin tests would need a parallel citation-margin test.

---

## F-102 — Image source citations and permission-to-copy notices are not automatically
placed

**Rules:** BANA 9.5.4, 9.5.5

> "Place any associated source citation or copyright information appearing with an image in
> a new 7-5 paragraph following the caption." (9.5.4)
> "In braille, place the note on the line following the title/heading [regardless of print
> position]." (9.5.5)

**What Emboss does:** the Caption style (`formatCaption`, document.mjs:756-764: `first=6,
runover=4` for BANA, i.e. 7-5) gives the right margin for 9.5.4's image-source paragraph, so a
transcriber could manually add a second caption-styled block after an image's own caption —
but nothing distinguishes or auto-sequences two captions for one image, and `formatCaption`
always opens with its own leading blank line (`['', ...wrapCells(...)]`), so whether the
result matches Sample 9-7's exact spacing is unverified (a Stage 3/gold-example question).
For 9.5.5, the rule requires *actively relocating* a permission note from wherever print put
it (often the page bottom) to sit on the line right after the title/heading; Emboss only ever
renders blocks in the order the source document already has them — nothing moves a block
relative to another one.

**What the standard requires:** 9.5.4's source/copyright paragraph directly follows an
image's caption; 9.5.5's permission note is repositioned next to the heading regardless of
its print location.

**Classification:** **partial** (9.5.4 — margin mechanism exists via Caption reuse, sequencing
and exact spacing unverified) and **not done** (9.5.5 — no relocation logic of any kind
exists).

**Test that would prove a fix:** 9.5.4 — Sample 9-7 built and run through `gold-run.mjs`
(Stage 3) to confirm the two-caption sequencing matches exactly. 9.5.5 — a document with a
permission note authored away from its heading; assert the formatted output moves it to
directly follow the heading.

---

## F-103 — Table source citations (BANA 9.5.3) repeat the already-reported §11 gap

**Rule:** BANA 9.5.3

> "Tables/Charts. Insert the source citation on the next line after the completion of the
> table."

**What Emboss does:** identical missing feature already reported as `standards-findings.md`
F-14 ("No source-citation formatting for tables", covering BANA 11.2.5g, the §11 wording of
the same requirement) — no block type or margin logic places a source citation after a table.

**Classification:** **not done** (missing feature; duplicate of F-14, not a new one).

**Test that would prove a fix:** see F-14.

---

## F-104 — Cross-references and incidental notes (§9.6) have no representation at all

**Rules:** BANA 9.6.1a, 9.6.1b, 9.6.1c, 9.6.1d, 9.6.1e

> "Do not use a reference mark." / "Ignore font attributes except when they are necessary for
> distinction." / "A blank line precedes and follows the note..." / "When the note includes a
> heading... Use 7-7 margins for the heading. Transcribe the note on the next line using 5-5
> margins." / "Use 7-5 margins for a note without a heading."

**What Emboss does:** a grep of `document.mjs`/`input/parse.mjs` for "cross-reference" or
"incidental" (as a print-content concept, not a code comment) finds nothing. The only note-
like block Emboss has is the Transcriber's Note (`formatTranscriberNote`, document.mjs:705-
712), which wraps its content in UEB TN indicators (`@.< … @.>`) — appropriate for the
transcriber's *own* commentary, but semantically wrong for a cross-reference or incidental
note, which is real print content the author wrote, not a transcriber's aside. Reusing it
would misrepresent the source. `Emboss/docs/style-specification.md` (line 185) already lists
"Incidental Note (BB)" among the style candidates not yet built. No code anywhere implements
the specific 7-7-heading/5-5-note or 7-5-no-heading margin scheme these rules describe, or
reference-mark suppression for this construct, or its own blank-line rule.

**What the standard requires:** a cross-reference/incidental note is its own construct: no
reference mark, font attributes ignored except for distinction, blank line before and after,
and a specific two-tier (7-7/5-5) or single-tier (7-5) margin depending on whether it carries
its own heading.

**Classification:** **not done** (missing feature, all five rows).

**Test that would prove a fix:** once a Cross-reference/Incidental Note style exists, a note
with a heading asserted at 7-7 (heading) / 5-5 (note text, no blank between); a note without
a heading asserted at 7-5; both with a blank line before and after.

---

## F-105 — Correspondence/diary formatting (§9.7): script-font signatures and un-boxed
letter spacing are not automated

**Rules:** BANA 9.7.1c, BANA 9.7.2 (blank-line clause)

> "Use the script font to indicate a script signature." (9.7.1c)
> "Insert a blank line before and after the letter if it is not enclosed in a box." (9.7.2)

**What Emboss does:** a grep of `input/parse.mjs`/`format/document.mjs`/`web/editor/
editor.mjs` for "script" finds only sub/superscript handling (an unrelated concept) — no
"script font"/handwriting typeform category is recognised by import or the editor at all, so
a signature printed in a script typeface has no distinguishing signal to translate into
braille. Separately, reproduced by the same mechanism as 9.5.1c (`probe2.mjs`): Emboss's
block-to-block joining inserts no blank line between ordinary (non-quote-styled) blocks by
default, so an un-boxed instructional letter — a plain run of paragraphs — gets no automatic
blank line before or after unless the transcriber adds one manually; a boxed letter gets it
for free from the Sidebar style's own `blankBefore`/`blankAfter: true`.

**What the standard requires:** a script signature is marked distinctly in braille (script
font is BANA's own suggested cue); every instructional letter not enclosed in a box gets a
blank line before and after it, unconditionally.

**Classification:** **not done** (9.7.1c — missing feature) and **partial** (9.7.2 — the
main "full width, not displayed material" clause is satisfied by omission since an ordinary
paragraph is already full-width; the blank-line clause needs manual authoring for the
un-boxed case).

**Test that would prove a fix:** 9.7.1c — N/A until a script-font signal exists to test
against. 9.7.2 — an un-boxed sequence of letter paragraphs; assert a blank line appears before
the first and after the last automatically.

---

*(F-93 through F-105 above cover every row of `standards-map.md`'s BANA §9 / B004 Appendix G
sections whose status is partial or not done. UKAAF's own corner of this territory — B004
Appendix G, all 5 rows — is in noticeably better shape: every row assessed "done", since the
`quoteMargins` UKAAF branch (cell 7 / cell 5, no blank lines) already matches Appendix G
Example 2 exactly, and the general typeform pass-through already satisfies Example 1. The
BANA side carries most of this section's gaps, concentrated in three areas: the epigraph/
displayed-material conflation (F-94), pagination/relocation awareness that is absent
project-wide, not §9-specific (F-100, F-102's 9.5.5, F-103), and three constructs with no
representation at all — displayed word lists (F-98), cross-references/incidental notes
(F-104), and (respectively) a dedicated Source Citation style (F-101).)*

---

# Standards findings — notes (BANA §16, B004 §11 + Appendix D; assessed 17 Sep 2026)

## F-106 — BANA §16.2.2's "superscripted hollow dot" reference-mark symbol has no braille
equivalent

**Rule:** BANA 16.2.2 (partial).

> "Examples of print reference marks and their braille equivalent … Superscripted hollow dot
> ;9"0" (BANA 16.2.2)

**What Emboss does:** `NOTE_SYMBOLS` (`Emboss/format/document.mjs:597`) maps only asterisk,
dagger and double dagger to their direct braille symbols; `noterefBraille`
(`document.mjs:598-604`) superscripts (`;9…`) a letter or number mark, and otherwise falls
through to `` `;9${o.translate(mark).trim()}` `` — sending the raw print character straight
to the braille translator. There is no case for a hollow-dot mark at all.

Reproduced (scratch script, real liblouis `uebG2`, `verify_examples.mjs`): passing a
hollow-dot-like mark character as a `noteref` produces, for three plausible print characters:

```
hollow-dot mark "○" -> [ '  CRAFT;9;$=' ]
hollow-dot mark "•" -> [ '  CRAFT;9_4' ]
hollow-dot mark "◦" -> [ "  CRAFT;9'\\X25E6'" ]
```

None of these is `;9"0`, the braille the rule's own table requires (matching BANA Example
16-2: `"<craft;9"0"> craft;9"04`).

**What the standard requires:** any print hollow-dot reference mark becomes exactly `;9"0`,
the same way asterisk/dagger/double-dagger already get their own fixed symbol regardless of
what liblouis would otherwise produce for that raw character.

**Classification:** **bug** (a one-entry gap in an otherwise-correct symbol table).

**Test that would prove a fix:** extend `NOTE_SYMBOLS` (or add a parallel check) so a
hollow-dot mark (however the parser represents it — a decision for whoever fixes this, see
`questions-16.md` Q-34) produces `;9"0`; assert this alongside the existing
`note_references.test.mjs` 'marks' test, which currently only covers letters, capitals and
daggers.

**Status update (17 Sep 2026, fixed):** `NOTE_SYMBOLS` (`Emboss/format/document.mjs:623`) now
maps four Unicode candidates — `°` (U+00B0 DEGREE SIGN), `○` (U+25CB WHITE CIRCLE), `◦`
(U+25E6 WHITE BULLET) and `•` (U+2022 BULLET) — to the rule's fixed `;9"0` symbol, resolving
Q-34's option (a) ("add a fixed set of likely Unicode hollow-dot characters"). `°` is not a
guess: re-checking this section's own gold transcriptions
(`Emboss/tests/gold/bana-formats-2016/section-16/example-16-2.json` and `sample-16-04.json`,
both built independently for the earlier Stage-4 assessment) shows the transcribers already
settled on `°` for the PDF's "small raised open circle" glyph in both Example 16-2 and all
three marks of Sample 16-4 — direct evidence for the most likely real-world character, not
just a plausible candidate. The parser needed no change: `<noteref>` already carries whatever
print character its `textContent` holds (`Emboss/input/parse.mjs:1919-1930`) straight through
to `noterefBraille`, so once the symbol table has the entry the DTBook round trip works
without further plumbing. Re-running the gold section after the fix (`gold-run.mjs --section
section-16`) shows Example 16-2 and Sample 16-4 now producing the correct `;9"0` symbol in
their braille (confirmed against the diff output); both samples remain `mismatch` overall for
unrelated reasons (page-furniture/pagination and typeform differences outside this finding's
scope). Proven by `Emboss/tests/notes_rules.test.mjs`'s F-106 describe block (all four marks,
`formatBlock`/`traceBlock` parity, and a DTBook `<noteref>` parse-and-format check).

---

## F-107 — No inline-note construct: an embedded note never shares a line with the text it
applies to

**Rules:** BANA 16.4b (partial), 16.4c (not done); B004 D notes-referencing (partial, the
"except where directly inserted in braille at the point of reference" clause); B004 11
guiding-principles (partial).

> "Insert the word 'note', enclosed in transcriber's note indicators, after the point of
> reference in the text. … The embedded note must be on the same line as at least one word
> or phrase to which it applies." (BANA 16.4b/c)
>
> "All notes … need referencing, except where directly inserted in braille at the point of
> reference." (B004 D notes-referencing)

**What Emboss does:** a `note` block is always formatted by `formatTranscriberNote`
(`document.mjs:705-712`) at its own 7-5 margins (`tnMargins`, `document.mjs:679`) as a
standalone block with its own line(s) — there is no mechanism anywhere that fuses a note
onto the end of the *preceding* block's own last line. `groupSegments`
(`document.mjs:547-587`), which builds the mixed-content runs a paragraph's own segments are
translated through, only special-cases `math`, `noteref` and `linenum` segment types; nothing
resembling an inline "note" segment is recognised there or anywhere else in
`document.mjs`/`input/parse.mjs`.

Reproduced twice (scratch scripts, real liblouis, `verify_examples.mjs`):

1. **BANA 16.4c** — `formatDocument` with `[{type:'para', text:'The floating stuff is called
   slag.'}, {type:'note', text:'note'}, {type:'para', text:'The slag is then skimmed off.'}]`
   produces:
   ```
     ,! FLOAT+ /UFF IS CALL$ SLAG4
         @.<NOTE@.>
     ,! SLAG IS !N SKIMM$ (F4
   ```
   — the indicator-wrapping (`@.<NOTE@.>`) is exactly right, but it sits on its own indented
   line, not fused onto `",! FLOAT+ /UFF IS CALL$ SLAG4"` as BANA's own Example 16-6 requires
   (`",t float+ /uff is call$ slag4 @.<note@.>"`, one line).

2. **B004 D's "directly inserted … at point of reference"** — a UKAAF paragraph built from
   segments `[text, {type:'note', text:'where the famous 1066 battle took place'}, text, …]`
   (the natural way to model B004's own Example 1) produces:
   ```
     ,!Y TRAVELL$ TO ,HA/+S ": ! FAM\S
   #AJFF BATTLE TOOK PLACE4 ,_M VISITORS
   5JOY EAT+ FI% & *IPS F ! ,BLUE ,DOLPH9
   RE/AURANT O!R RE/AURANTS >E AVAILABLE6
   ```
   with **no `.<`/`.>` transcriber's-note brackets at all** — a `note`-typed segment inside a
   paragraph's `segments` array is not a type `groupSegments` recognises, so it is silently
   treated as plain text (it has its own `.text` field) and merged straight into the
   sentence. B004's own Example 1 requires `.<": ! fam\s #ajff battle took place.>` — the
   note content set off in brackets, inline.

**What the standard requires:** an embedded/inline note (BANA's placeholder "note" marker,
or B004's fuller inline-footnote content) renders in the TN indicators it always gets
*inline*, sharing a braille line with the text it applies to, not as a separate block.

**Classification:** **not done** — this isn't a narrow bug in an existing mechanism, it's an
architecture gap: nothing in the segment model represents "a short run of TN-wrapped text
glued into the middle of this paragraph's own line-wrapping."

**Test that would prove a fix:** once an inline-note segment type exists, a paragraph built
from `[text, {type:'note'/'inline-tn', text:'…'}, text]` should format with the TN-bracketed
text appearing mid-line (wrapped along with the rest of the paragraph, per BANA 16.4c and
B004 Example 1), not as its own block.

---

## F-108 — `noteLayout`'s deferred-flush placement can silently reorder notes and displace
them past subsequent headings

**Rules:** BANA 16.5.1 (partial), 16.5.1c (partial), 16.5.1g (not done), 16.5.1h (not done);
B004 11 guiding-principles (partial, "consistently applied").

> "List notes in the order in which they appear in the text." (BANA 16.5.1c)
>
> "Notes may be separated by a title/heading or a blank line when there are multiple titles
> with separate note references on one print page." (BANA 16.5.1g)
>
> "Do not insert a blank line between a note separation line and a title or heading." (BANA
> 16.5.1h)

**What Emboss does:** `noteLayout` (`document.mjs:2768-2806`, BANA mode only) decides where
each footnote renders. For a block `bi` that references a note, the note's index is pushed
into a `pending` array (`document.mjs:2799-2800`) rather than `order` directly; `pending`
is only flushed into `order` (`document.mjs:2801, 2806`) at the next `'pagenum'` block or at
the very end of all blocks. Meanwhile, any block that does **not** reference a note —
including an *unreferenced* footnote, or a heading that starts an entirely separate section
— is pushed straight into `order` as soon as it's reached (`document.mjs:2797`), **ahead of**
whatever is still sitting in `pending`.

Reproduced (scratch scripts, real liblouis, BANA 40x25, `verify_examples.mjs` /
`repro3_note_heading.mjs` / `repro4_note_then_heading.mjs`):

1. **Reorders relative to an unreferenced note (16.5.1c):** blocks
   `[para→noteref(n1), footnote n1 (referenced), footnote n2 (never referenced)]`, no
   `pagenum` anywhere, produce:
   ```
     ,SEE;9#A4
   "333333
   #B ,SECOND NOTE "<N"E REF];ED">4
   #A ,F/ NOTE "<REF];ED">4
   ```
   Note 2 (never referenced, appearing second in the source) renders **before** note 1
   (referenced, appearing first and referenced first) — exactly reversed.

2. **Displaces a note past a later section's own heading (16.5.1g/16.5.1h):** blocks
   `[para→noteref(n1), footnote n1, heading 'Next Section']`, no `pagenum`, produce:
   ```
     LINE ONE;91

       NEXT SECTION
   "333333
   1 NOTE ABOUT LINE ONE.
   ```
   The note is pushed all the way past the heading (to the end of the document, per the
   documented "or at the end of the document" fallback) — so the "note run immediately
   followed by a heading, no blank line" adjacency 16.5.1h is about, and the "separate title
   with its own note run" scenario 16.5.1g addresses (Sample 16-2's whole structure: a
   footnoted title, then a second footnoted title, both on **one** print page with no
   `pagenum` between them), essentially cannot be produced correctly by the current
   algorithm whenever no page-boundary happens to separate the two titles.

**What the standard requires:** notes stay in the order they appear in the text (16.5.1c);
on a single print page carrying more than one titled section, each with its own notes, an
earlier section's note run is separated from the next section's own heading by (at most) a
blank line or a cell-5 heading — never pushed past it entirely (16.5.1g/h).

**Classification:** **bug.** The `pending`/flush-at-next-pagenum design is a reasonable
approximation of "end of print page" when a document has real `pagenum` markers close
together, but its behaviour degrades badly (silent reordering, unbounded displacement) the
moment an unreferenced note or an intervening heading sits between a referenced note and the
next page boundary — which is exactly Sample 16-2's own construction.

**Test that would prove a fix:** a `formatDocument` test with `[referenced note A, unreferenced
note B]` (no pagenum) asserting A's text precedes B's; and a second test with
`[heading+footnoted para, heading, para]` (no pagenum between the two headings) asserting the
first heading's own note run appears before the second heading, not after it.

**Status update (17 Sep 2026, partially fixed — the ordering/displacement bug only):**
`noteLayout` (`Emboss/format/document.mjs:3036-3092`) no longer pushes an unreferenced note
straight into `order` ahead of a still-pending referenced one: a note that is `isNote(b)` and
not `moved` now joins `pending` in its own turn (instead of `order` immediately), so it keeps
its queue position relative to notes released by earlier blocks. A heading is now also a
flush point for `pending`, alongside a `pagenum` block, so a note run can no longer be pushed
past a later heading that starts a new section on the same print page. Both of this finding's
own reproductions are fixed: the unreferenced-note reversal (16.5.1c) and the note-run
displaced past a later heading (16.5.1g/h's ordering precondition). Proven by
`Emboss/tests/notes_rules.test.mjs`'s F-108 describe block (both scenarios, `formatDocument`).

**Still not done (16.5.1g/h's own formatting construct, not this finding's "bug"):** the
underlying reorder/displacement algorithm is fixed, but the rule's own separator-CHOICE
mechanism was never built and remains out of scope for this fix (a feature gap, not a bug):
nothing detects "multiple titles with separate note references on one print page" to choose
between a cell-5 heading and a blank line (16.5.1g), and `formatHeading`'s unconditional
leading blank line is not suppressed when a heading immediately follows a note run's own
separation line (16.5.1h) — `joinsWithoutBlank` only special-cases a *preceding* heading, not
a preceding note run. Sample 16-2's own page-break-spanning construction (a note run
continuing onto a new braille page, reopening with the separation line and a repeated title,
no blank line between them) needs this same not-yet-built mechanism and is unaffected by this
fix. See `standards-map.md`'s 16.5.1g/16.5.1h rows.

---

## F-109 — A footnote referenced from inside a table cell is relocated to *after* the table,
not before it

**Rule:** BANA 16.8.1a (not done); interacts with 16.5.1b, 16.5.1i.

> "Place notes before tables as, in most situations, they need to be read before reading the
> table to understand the entries in the table." (BANA 16.8.1a)

**What Emboss does:** `noteLayout`'s reference-scan (`document.mjs:2778-2787`) decides which
block "references" a note by `JSON.stringify`-ing every non-note block and checking whether
the string `"noteref"` appears anywhere in it (`document.mjs:2780`). A `table` block whose
own cell content carries a `noteref` segment matches this scan exactly like an ordinary
paragraph would — so the table itself, not the text that actually precedes it, is treated as
"the referencing block," and the note is queued to render at the next print-page boundary,
i.e. **after** the table.

Reproduced (scratch script, real liblouis, BANA 40x25, `repro1_table_note_moved.mjs`): a
one-row/one-column table whose only cell carries `{type:'noteref', text:'1', idref:'tn1'}`,
with the referenced footnote positioned immediately *before* the table in the source
(`[para, footnote tn1, table, pagenum, para]`), formats as:

```
  SOME INTRO TEXT BEFORE THE TABLE.

REGION    VALUE
"3333333 "3333
NORTH;91 10

"333333
1 NOTE ABOUT THE TABLE ENTRY.
----------------------------------NORMAL
  TEXT ON THE NEXT PRINT PAGE.
```

The note's separation line and text land **after** the table body, not before it.

**What the standard requires:** the note stays before the table (16.8.1a) — see also F-110,
since even without this misplacement bug there is no code implementing 16.8.1's own
note-before-table sequence at all.

**Classification:** **bug.** This will corrupt any DTBook table built with real
`<noteref>`/`<annoref>` markup in a cell (a realistic authoring pattern for footnoted table
entries, e.g. BANA's own Sample 16-9).

**Test that would prove a fix:** a `formatDocument` test with a footnote immediately
preceding a table whose only reference to that footnote is a `noteref` inside a cell;
assert the footnote's lines still precede the table's lines in the output.

**Status update (17 Sep 2026, fixed):** `noteLayout` (`Emboss/format/document.mjs:3036-3092`)
now tracks notes released by a `table` block separately from notes released by an ordinary
paragraph (`releasedByTable` vs `releasedBy`): a table's own released note(s) are spliced
directly into `order` immediately before the table itself, never deferred into the `pending`
queue that surfaces at the next print-page boundary. Re-running this finding's own
reproduction confirms the fix: the footnote now renders before the table body, not after it.
Proven by `Emboss/tests/notes_rules.test.mjs`'s F-109 describe block, and confirmed against a
real DTBook document (a table-cell `<noteref>` whose footnote precedes the table in the
source) through `parseDtbook` → `formatDocument` and separately validated with
`Emboss/scripts/daisy-validate.mjs` after `exportToNimasXml` (0 errors). This finding's own
note about F-110 stands: 16.8.1's fuller "notes in table format" sequence (the auto TN
announcement, 1-3 margins specific to that context, no-blank-lines-between-notes) remains
unimplemented — out of scope for this fix (a feature gap, not this finding's ordering bug).
Separately, `Emboss/scripts/gold-run.mjs`'s own §16 model builder (`buildModel16`, off-limits
for this fix) still has no noteref/segment support for table cells at all — it strips a
`[ref:MARK]` token from a cell before building the model, so gold samples 16-09/16-10 (which
exercise exactly this construct) remain `not-representable` in the gold run regardless of this
fix; that limitation is in the test harness, not in `document.mjs`'s formatting code.

---

## F-110 — §16.8.1's whole "notes in table format" sequence has no implementation; the one
related mechanism uses the wrong margin

**Rules:** BANA 16.8.1b, 16.8.1c, 16.8.1d, 16.8.1e, 16.8.1f, 16.8.1h (all not done); 16.8.1g
(not-applicable — nothing to apply it to yet); 16.8.2a (partial, right margin/wrong format
too).

> "Insert a transcriber's note before the table. Sample: 'Note(s) in the table below.' … Do
> not include the note(s) within the transcriber's note. … Place a blank line after the
> transcriber's note and then insert the reference note(s). Use 1-3 margins for all notes.
> Begin each note with the appropriate reference mark … Do not leave blank lines between
> notes. … Other transcriber's notes follow the reference note(s)." (BANA 16.8.1b-h)

**What Emboss does:** the only table-note code path for the standard (spatial/columnar)
table format is `block.tabletn`/`block.note` in `formatColumnar`
(`document.mjs:1584-1586`):

```js
if (block.tabletn || block.note) {
  out.push(...wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 6, 4), '');
}
```

This is a **single free-text transcriber's note**, supplied whole by the author, wrapped at
`w, 6, 4` — i.e. **7-5 margins**, the margin §16.8.2a specifies for the ALTERNATE (listed/
linear/stairstep) table formats, not the 1-3 margins §16.8.1e requires for this — the
standard/spatial — format. There is no code anywhere that: auto-generates the "Note(s) in
the table below." announcement (16.8.1b); keeps the note text itself out of that
announcement (16.8.1c, moot since nothing merges them either way); inserts a blank line then
a *sequence* of separately reference-marked notes (16.8.1d, f); or distinguishes "the
reference note(s)" from "other transcriber's notes" that should follow them (16.8.1h).

**What the standard requires:** before a standard-format table, an auto (or at least
structured) transcriber's note announcing notes exist, a blank line, then each reference
note at 1-3 margins beginning with its own reference mark, with no blank lines between them,
followed by any other transcriber's notes.

**Classification:** **not done.** This isn't a bug in an existing mechanism so much as an
absent one — the `tabletn`/`note` field is a different, simpler construct (one paragraph of
free text, likely built for describing a table-format change, à la the Listed Table Format's
own `LISTED_TN`) that happens to share a name with what §16.8.1 needs, not an implementation
of it.

**Test that would prove a fix:** once a `block.tableNotes = [{mark, text}, …]` (or similar)
shape exists, a `formatColumnar` test asserting: the announcement TN, then a blank line, then
each note at 1-3 margins with no blank lines between them, all before the table's own header
row.

---

## F-111 — No endnote-section structure: no forced page break, no auto "NOTES" heading, no
repeated abbreviations list, and no editor authoring path

**Rules:** BANA 16.9.1 (partial, authorability), 16.9.3a (not done), 16.9.3b (not done),
16.9.3e (not done); BANA 16.1.5c (partial).

> "Begin an endnote section on a new braille page." (BANA 16.9.3a)
>
> "Insert the heading NOTES if the text does not include a heading at the beginning of the
> note section. Enclose it in transcriber's note indicators, on line 1 (line 3 if a running
> head is used)." (BANA 16.9.3b)
>
> "Before the note section in each volume, repeat lists of abbreviations for book/magazine
> titles referred to in the endnotes." (BANA 16.9.3e)

**What Emboss does:** `kind: 'endnote'` is recognised throughout the parse/export/format
pipeline (`parse.mjs:1774`; `nimas-export.mjs:1011`; `document.mjs`'s `isNote`/`noteLead`),
and an endnote keeps its document position (excluded from `noteLayout`'s movement,
`document.mjs:2770`) and renders at 1-3 margins (`formatFootnote`, `document.mjs:721-739`).
But:

- No code anywhere forces a page break before an endnote section — `page.mjs`'s `assemble()`
  and `document.mjs`'s `applyPageBoundaries` (`document.mjs:2816-2933`) have no awareness of
  a `kind:'endnote'` block at all (grep of both files for "endnote" turns up only the
  placement/margin logic already cited).
- No code auto-inserts a "NOTES" TN heading, or checks whether one is already present.
- No code tracks or repeats a "list of abbreviations for book/magazine titles" before an
  endnote section in any volume.
- The Emboss **editor** has no UI to create a note with `kind:'endnote'`, or convert an
  existing footnote into one: `setNote` (`editor.mjs:180`) only ever receives a `kind` that
  was already on the block when it was built from parsed DTBook (`editor.mjs:6639`,
  `if (b.type === 'footnote' && b.id) p.setNote({ id: b.id, kind: b.kind })`), and the
  command-palette style list (`editor.mjs:6138-6156`) offers "Footnote" and "Transcriber's
  Note" but no "Endnote" option anywhere. An author starting a document from scratch in the
  Emboss editor cannot produce an endnote section at all — only a round-tripped DTBook import
  that already classed its `<note>` elements can carry the `kind` through.

**What the standard requires:** an endnote section starts on its own new braille page, gets
an auto "NOTES" TN heading when print supplies none, and is preceded in each volume by a
repeated abbreviations list; all of this should be authorable from the editor, not only
importable.

**Classification:** **not done**, in four related but distinct ways (page break, heading,
abbreviations list, editor authorability) — grouped here since they share one root cause
(§16.9's endnote-section machinery was never built beyond the bare `kind` flag).

**Test that would prove a fix:** a `formatDocument`/`assemble()` test asserting an
`endnote`-kind block always starts a fresh braille page; a test asserting a "NOTES" TN
heading appears when the endnote section's own first block isn't a heading; and (once the
editor gains an "Endnote" style command) an editor round-trip test creating one from
scratch.

---

## F-112 — B004's own worked Example 2 shows no blank line between two consecutive
footnotes, but `noteLead` always inserts one in UKAAF mode

**Rule:** B004 11 example-2 (not independently statused — see `standards-map.md`'s
example-table note — but flagged here since it surfaced during assessment of the adjacent
rule rows and B004's general note-placement principle).

> "#a4 ": ! fam\s #ajff battle took place4
> #b4 o!r re/aurants >e available6" (B004.txt, Example 2's own braille, no blank line
> between the two note entries)

**What Emboss does:** `noteLead` (`document.mjs:719-720`) returns `['']` — a leading blank
line — before **every** UKAAF-mode footnote, unconditionally:

```js
const noteLead = (block, o) => (isBanaOpts(o) && block.kind !== 'endnote' ? (block.noteRunStart ? [NOTE_SEPARATOR] : []) : ['']);
```

Reproduced (scratch script, real liblouis, UKAAF, `verify_examples.mjs`): two consecutive
footnotes (`n1`, `n2`, both referenced, no BANA-only separation line) format as:

```
#A ": ! FAM\S #AJFF BATTLE TOOK PLACE4

#B O!R RE/AURANTS >E AVAILABLE6
```

— a blank line appears between them, unlike B004's own Example 2.

**What the standard requires:** unclear — B004 gives no numbered rule for blank lines
between consecutive footnotes at all, only this one worked example showing them adjacent
with no blank line.

**Classification:** **standard unclear / possible bug.** Since B004 supplies no explicit
rule, this may be a deliberate Emboss house convention (a blank line before every UKAAF note,
matching how BANA endnotes/§16.9 also always get a blank lead via the same `['']` branch) —
or it may simply be wrong for the *inline run of consecutive footnotes* case Example 2 shows.
Sent to `questions-16.md` (Q-42) rather than logged as a bug outright.

**Test that would prove a fix (if Paul decides it's a bug):** a UKAAF `formatDocument` test
with two consecutive referenced footnotes and no intervening content, asserting no blank
line between them, matching B004 Example 2's own braille exactly.

---

## F-113 — A multi-paragraph `<note>` collapses into one flat block, losing the paragraph
break entirely

**Rules:** BANA 16.5.1d (partial, the "5-3 margins for additional paragraphs" clause); B004 D
multi-paragraph-notes (not done).

> "Use 1-3 margins; for additional paragraphs in a note, use 5-3 margins." (BANA 16.5.1d)
>
> "Ensure that notes containing more than one paragraph are treated as such (software can
> automatically separate the paragraphs into two separate notes)." (B004 D
> multi-paragraph-notes)

**What Emboss does:** `pushNote` (`parse.mjs:1766-1776`) reads a `<note>` element via
`pushAtomic` (`parse.mjs:1674-1681`), which calls `getCleanText(el)` to build the block's
`.text` — a single flattened string. `<p>` is not one of `pushNote`'s `NOTE_SPLIT_TAGS`
(`table`/`imggroup`/`img`/`image` only, `parse.mjs:1788`), so multiple `<p>` children of one
`<note>` are joined into that one string, with no paragraph boundary preserved at all.

Reproduced (scratch script, real `parseDtbook`, `repro2_multipara_note.mjs`): parsing

```xml
<note id="n1" class="Footnote">
  <p>First paragraph of the note.</p>
  <p>Second paragraph of the note.</p>
</note>
```

produces exactly one block:

```json
{ "type": "footnote", "text": "First paragraph of the note. Second paragraph of the note.", "id": "n1" }
```

**What the standard requires:** the second (and any further) paragraph is recognisable as a
continuation, formatted at 5-3 margins (BANA) — or, per B004's own phrasing, treated as if it
were "two separate notes."

**Classification:** **bug** (a parser data-loss defect, not a formatting nuance — the
paragraph boundary that the standard needs is discarded before `document.mjs` ever sees the
note).

**Test that would prove a fix:** parse a DTBook `<note>` with two `<p>` children; assert the
resulting block preserves both paragraphs distinctly (e.g. `block.blocks = [para1, para2]`,
matching the shape `formatFootnote` already knows how to render via its existing
`Array.isArray(block.blocks)` branch, `document.mjs:723-729`), and that `formatBlock`
indents the second paragraph at 5-3 (BANA) rather than running it into the first.

**Status update (17 Sep 2026, fixed):** `pushNote` (`Emboss/input/parse.mjs:1774-1816`) now
checks a `<note>`'s direct `<p>` children before flattening: with more than one, each `<p>` is
kept as its own `{type:'para', text, segments}` block in `blk.blocks` (the shape this
finding's own proving test named), instead of being joined into one string by `getCleanText`.
A single-`<p>` note (the common case) is unaffected — same `text`/`segments` shape as before.
`formatFootnote` and its `traceBlock` mirror (`Emboss/format/document.mjs:755-770,
2394-2404`) render each paragraph directly (not via a recursive generic `formatBlock` call,
which would have applied ordinary body-paragraph margins): the opening paragraph at 1-3 (0,2),
every one after it at 5-3 (4,2) in BANA per 16.5.1d; B004 gives no margin rule for a
multi-paragraph note (only that it is "treated as such"), so UKAAF keeps every paragraph at
the same margin, still on its own line rather than merged into the one before it.
`Emboss/input/nimas-export.mjs`'s `case 'footnote'` round-trips `block.blocks` back to
separate `<p>` elements instead of one. Proven by `Emboss/tests/notes_rules.test.mjs`'s F-113
describe block (parser preserves both paragraphs; `formatBlock` 5-3 indent with
`traceBlock` parity; a full DTBook export/parse round trip); confirmed end to end with
`Emboss/scripts/daisy-validate.mjs` against a saved DTBook carrying a two-paragraph note (0
validation errors).

**Editor authoring (checked, not changed):** `Emboss/web/editor/editor.mjs` represents a
footnote as one Lexical `ParagraphNode` per block (`appendBlock`, `fillFromBlock`) — it does
not merge multiple editor paragraphs into one footnote or otherwise flatten a note's text, but
it also has no multi-paragraph-note authoring UI (a separate, pre-existing gap, not built
here — see Q-35's inline-note question for the closest existing discussion of note-related
editor gaps). Before this fix, loading a DTBook with a `block.blocks`-shaped footnote into the
editor would have silently produced an EMPTY paragraph (`fillFromBlock` had no case for
`b.blocks` and fell through past `b.segments`/`b.lines`/`b.speaker`/`b.speech` to a `b.text`
check that a blocks-only footnote has no value for) — real data loss on load, not just a
missing feature. `fillFromBlock` now joins a `b.blocks`-shaped block's paragraphs with a
forced line break within the one editor paragraph node when nothing else populates it, so the
note's actual words survive visibly in the editor instead of vanishing; this is a data-safety
plumbing fix, not multi-paragraph-note editing — saving such a note back out currently
produces one `<p>` with an embedded line break, not two `<p>` elements, until the editor
itself grows a real multi-paragraph note construct.

---

## F-114 — §16.6 (Gloss Notes in Foreign Language Texts) has no distinguishing construct

**Rules:** BANA 16.6a (not done), 16.6b (partial, margin coincidence only), 16.6c (not done).

> "Place gloss notes in foreign language materials on the line following the material to
> which the note applies. Use 7-5 margins and follow print for any reference marks used. If
> no print reference mark is used, insert an embedded transcriber's note following the point
> of reference within the text." (BANA 16.6a-c)

**What Emboss does:** grep of `input/parse.mjs`, `format/document.mjs` and
`input/nimas-export.mjs` for "gloss" finds only the unrelated BANA §19 glossary/dictionary
list feature (`type:'list', kind:'glossary'`) — nothing marks a note as a *gloss* note (a
translation of a foreign-language word/phrase) at all. The generic `note` block's default
7-5 margin (`tnMargins`, `document.mjs:679`) happens to match 16.6b's requirement, but purely
by coincidence — nothing signals "place this note on the line following the material," and a
gloss note round-trips through DTBook/the editor indistinguishably from any other note.

**What the standard requires:** a gloss note is recognisable as such, placed on the line
immediately following its foreign-language material, at 7-5 margins.

**Classification:** **not done.**

**Test that would prove a fix:** once a `kind:'gloss'` (or similar) signal exists, a
`formatDocument` test asserting a gloss note renders on the line directly following the
foreign-language text it glosses, at 7-5 margins, distinguishable in the parsed model from an
ordinary note.

---

## F-115 — §16.7.5 (notes referring to notes on a different page/volume, nested margins) is
wholly unimplemented

**Rules:** BANA 16.7.5, 16.7.5a, 16.7.5b, 16.7.5c, 16.7.5d (all not done).

> "When a note refers to another note located on a different page or in a different volume,
> repeat the referenced note after the original note. … Transcribe the note on the current
> page using 1-5 or 1-7 margins … 3-5 or 3-7 … 5-7 …" (BANA 16.7.5/16.7.5a-c)

**What Emboss does:** grep of `parse.mjs`/`document.mjs`/`nimas-export.mjs` finds zero
references to §16.7.5 anywhere. There is no construct for "this note references another
note" (as distinct from ordinary in-text `noteref`s), no repetition of a referenced note, and
no escalating-margin (1-5/1-7 → 3-5/3-7 → 5-7) nested-note-chain formatting.

**What the standard requires:** a note chain referencing earlier notes is repeated after the
original with progressively deeper margins.

**Classification:** **not done** — no partial mechanism exists to build on.

**Test that would prove a fix:** N/A until the underlying model gains a "this note references
that other note" concept; at that point, a `formatFootnote`-style test at each of the three
margin tiers.

---

## F-116 — §16.7.6 (notes continued across a print-page break) is wholly unimplemented

**Rule:** BANA 16.7.6 (not done).

> "When a note is divided between print pages, complete the entire note on the print page on
> which it begins … Treat the page with the continued note as if it is blank; combine that
> print page number with the following print page number." (BANA 16.7.6)

**What Emboss does:** `pushNote` (`parse.mjs:1766-1776`) reads a `<note>`'s content
atomically with no concept of it spanning a `pagenum` boundary; grep of
`parse.mjs`/`document.mjs` finds no reference to §16.7.6 or to combining/blanking a print
page for a continued note.

**Classification:** **not done.**

**Test that would prove a fix:** N/A until a "note continues past this print page" signal
exists in the model.

---

## F-117 — No facing-page (recto/verso) concept exists anywhere; combined print-page numbers
are manual-only

**Rules:** BANA 16.7.7 (partial), 16.7.7a (partial); B004 D facing-pages (not done).

> "Use combined print page numbers when transcribing text and notes printed on facing pages."
> (BANA 16.7.7)
>
> "Notes on facing pages in print … can, if practicable, be placed on facing pages in
> braille." (B004 D facing-pages)

**What Emboss does:** grep of `format/page.mjs` and `format/document.mjs` for
"facing"/"interpoint"/"recto"/"verso" returns nothing — Emboss has no concept of a braille
page's left/right (odd/even, facing) position at all, only a linear sequence of pages
(`page.mjs`'s `assemble()`). A **combined** print-page number (e.g. "45-a70") is achievable
by simply typing it as the free-text value of a `pagenum` block (`formatPageNum`,
`document.mjs:909-929`, passes `block.page ?? block.text` straight to the translator) — but
nothing computes, validates, or requires this, and nothing can guarantee that two related
pieces of content (text and its note) land on physically facing pages.

**Classification:** **partial** (16.7.7/16.7.7a — the numbering half is manually achievable)
/ **not done** (B004 D facing-pages — no facing-page mechanism at all).

**Test that would prove a fix:** N/A for the facing-page-placement half until Emboss gains a
recto/verso pagination concept; the combined-numbering half is already testable today via a
manually-typed pagenum string (no code change needed, just a documentation/authoring note).

---

## F-118 — Volume-placement rules for notes rely entirely on the generic, non-semantic
volume splitter

**Rules:** BANA 16.1.5d (partial), 16.9.2b (partial), 16.9.2c (partial), 16.10.1a (partial),
16.10.1b (partial); B004 D near-text-placement (partial), B004 D end-of-book (partial).

> "In a separate volume for heavily annotated text." (BANA 16.1.5d)
>
> "Endnotes at the end of a book generally are divided and placed at the end of the volume in
> which the references appear." (BANA 16.9.2b)
>
> "[Notes] can be placed close to the text in braille if few in number, or else collected
> into a section at the end of the braille volume." (B004 D near-text-placement)

**What Emboss does:** `formatVolumes`/`formatVolumesAsync` (`document.mjs:3282-3326`) split
a finished, already-laid-out document into volumes purely by page count
(`o.volumePages`) — there is no concept of "put this document's notes/endnotes in their own
volume," no automatic grouping of notes by which volume their references fall in, and no
auto-inserted "The endnotes to the text are in a separate volume" (or equivalent) TN
sentence anywhere. Every one of these rules is achievable only by an author manually
ordering the source blocks so that notes end up wherever `volumePages` happens to break, and
manually authoring any explanatory TN.

**Classification:** **partial**, uniformly, for every rule in this group — a working but
purely mechanical volume feature exists; the semantic "notes belong together in their own
volume" judgement this whole family of rules calls for is left entirely to the transcriber.

**Test that would prove a fix:** N/A until/unless a semantic "notes volume" feature is
designed; not clearly worth building given how rarely "heavily annotated" texts needing a
dedicated notes volume arise (a question for Paul, `questions-16.md` Q-43).

---

## F-119 — §16.11 (Keying Technique for Marginal Labels) is wholly unimplemented

**Rules:** BANA 16.11.1, 16.11.1a, 16.11.1d, 16.11.1e, 16.11.1f, 16.11.1g (not done);
16.11.1b, 16.11.1c (not-applicable — moot, nothing to apply them to).

> "List the labels in a key before the text. … Use braille grouping indicators to enclose the
> affected text." (BANA 16.11.1/16.11.1g)

**What Emboss does:** grep of `input/parse.mjs`, `format/document.mjs` and
`web/editor/editor.mjs` for "grouping indicator", `.=<`, `.=>` and "marginal" returns nothing
at all. There is no marginal-label recognition, no key-letter assignment, no TN-enclosed key
list, and no braille grouping-indicator support anywhere in the codebase — this entire
sub-section of §16 has no supporting code of any kind.

**Classification:** **not done**, in full.

**Test that would prove a fix:** N/A until the underlying constructs (marginal-label
recognition, a key-assignment step, grouping-indicator rendering) are designed and built;
likely a significant feature, not a small fix — worth a scoping conversation with Paul before
work starts (`questions-16.md` Q-41).

---

## F-120 — No cross-note emphasis-suppression exception, and nothing strips font attributes
from line numbers within a note

**Rule:** BANA 16.5.1f (not done).

> "Retain font attributes unless all notes using the same reference mark are entirely
> emphasized. Do not retain font attributes for line numbers." (BANA 16.5.1f)

**What Emboss does:** font-attribute (`tf`) segments are retained through translation
generically for any text, including note content — correct for the common case — but nothing
analyses "are all notes sharing this reference mark entirely emphasized" to trigger the
exception (that would require a cross-note, cross-reference-mark scan nothing currently
performs), and nothing distinguishes a "line number" appearing within a note's own text from
ordinary note content to strip its font attributes specifically.

**Classification:** **not done** for the exception clause; the default (retain font
attributes) is already correct without any special-casing.

**Test that would prove a fix:** N/A until a cross-note reference-mark index exists to detect
the "all notes with this mark are emphasized" condition; likely low priority given how rare
the triggering condition is (every note sharing one reference mark, entirely emphasized).

---

*(F-106 through F-120 above cover every row of `standards-map.md`'s BANA §16 / B004 §11 +
Appendix D sections whose status is partial or not done. Rows marked `not-applicable` are
bare headings, definitions, cross-references, or genuinely moot given an earlier finding
already covering the underlying gap. Counts and a per-row finding map are in the task's
final report.)*

---

# Standards findings — poetry and song lyrics (BANA §13, B004 Appendix J; assessed 17 Sep 2026)

## F-121 — A poem/verse block gets no blank line before or after it, ever

**Rules:** BANA 13.3.1a ("Leave a blank line before and after a poem..."), 13.7.1a ("Precede
and follow a prose poem with blank lines"), 13.9.3b ("Leave a blank line between the first
and second versions"), 13.11.2b ("Do leave a blank line before the beginning of the first
verse").

**Input:** a document model `{ blocks: [ {type:'para', text:'Prose before...'},
{type:'play', subtype:'verse', level:0, text:'The wind was a torrent...'},
{type:'play', subtype:'verse', level:0, text:'And the moon was a ghostly galleon...'},
{type:'para', text:'Prose after...'} ] }`, formatted BANA 40×25 via `formatDocument`.

**Expected:** a blank line between the last prose line and the poem's first line, and
between the poem's last line and the next prose line (13.3.1a's default case — neither of
its two named exceptions, cell-5/7-heading-before-poem or glossary-entry, applies here).

**Actual:** no blank line either side. Reproduced live (scratch `probe.mjs`,
`assess-13/probe.mjs`):
```
  0: [  ,? IS PROSE 2F ! POEM1 RUNN+ AL;G]
  1: [NORMALLY 9 ! TEXT4]
  2: [,! W9D 0 A TORR5T ( D>K;S AM;G ! GU/Y]
  3: [  TREES]
  4: [,& ! MOON 0 A <O/LY GALLEON TOSS$ ^U]
  5: [  CL\DY S1S]
  6: [  ,? IS PROSE AF ! POEM1 RUNN+ AL;G]
  7: [NORMALLY Z WELL4]
```
Line 1→2 (prose→poem) and line 5→6 (poem→prose) both have no blank line. `formatPlay`
(`Emboss/format/document.mjs:790-800`) never pushes a leading/trailing `''`, unlike
`formatList` (`document.mjs:463`, `['']` before), `formatBox` (`document.mjs:889`) and
`formatHeading` (`document.mjs:325-327`), which all add their own blank lines. The SAME
probe confirms a `para` block styled `verse` (Emboss's prose-poem representation) has the
identical gap (13.7.1a). This is already flagged in `Emboss/docs/style-specification.md:112`
("no blank lines around the poem (audit M3)").

One narrow *exception* to 13.3.1a — no blank line between a cell-5/7 heading and the poem it
applies to — IS implemented and tested (`joinsWithoutBlank`, `document.mjs:274-284`, includes
`isVerseBlock(block)`; `Emboss/tests/bana_nested_margins.test.mjs`, "no blank line between a
cell-5 or cell-7 heading and a list or poem"). That exception is currently vacuous: it
suppresses a blank line that the general case never adds in the first place.

**Classification:** bug. **Status:** not done (13.3.1a, 13.7.1a, 13.9.3b, 13.11.2b all share
this root cause).

**Status update (17 Sep 2026, fixed):** all four rules are **done**, via one mechanism: a new
`poemRunBoundaries` (`Emboss/format/document.mjs`, next to `verseRunLevels`) that finds each
poem/prose-poem's own two ends across the flat `blocks` array — not inside `formatPlay`/
`formatPara` themselves, since a run's start/end depends on the SIBLING blocks either side of
it, exactly like the existing heading-join logic (F-26) does. Three block shapes, three rules
for what counts as one poem, each cited directly at the code:
- a per-print-line block (`type:'play'`, subtype/style verse — what `parse.mjs`'s `parsePoem`
  and the real DTBook `<poem>`/`<linegroup>`/`<line>` round trip always produce, one block per
  braille line): a maximal contiguous run, stanza-break indicators allowed inside (mirrors
  `verseRunLevels`'s own grouping exactly) — no blank between its own lines, only at the run's
  two ends.
- a self-contained "whole poem" block (`type` verse/poem/poetry, its own `.lines` array):
  always its OWN poem, even sitting directly next to another one of the same kind — this is
  exactly 13.9.3b's "leave a blank line between the first and second [scansion] versions" (two
  complete poems placed back to back) and the general "two consecutive poems" case, both of
  which must keep a blank line between them, not be merged into one run.
- a run of contiguous `para`/`style:'verse'` blocks (Emboss's prose-poem representation,
  §13.7): merges like the per-line verse form (its own paragraphs are one prose poem),
  parallel to how F-93/`joinsWithoutBlank` treats the paragraphs of one quoted passage.

`buildDocPages`/`buildDocPagesAsync` inject the leading/trailing `''` directly into a block's
own `lines`/`srcs` right after it is formatted (or read from cache) — gated to BANA mode only
(B004 App J names no forced blank line around a poem) — leaving the pre-existing
`joinsWithoutBlank` cell-5/cell-7-heading exception completely untouched: since it already
runs a few lines further down the SAME loop and pops/skips blank lines by scanning for `''`,
it drops this new leading blank exactly when it applies, with no code change needed there
(regression-tested directly). `traceBlock` was missing a `case 'verse': case 'poem': case
'poetry':` entirely (it fell through to `default: paraLike(block)`, silently mis-rendering a
`.lines`-array poem as an empty ordinary paragraph) — a genuine, separate parity gap, not
introduced by this fix but needed to prove the "two consecutive poems" test's own
formatBlock/traceBlock parity requirement; added, mirroring `formatBlockUnguarded`'s own
`.lines` loop exactly (same `itemUnit` scheme `formatList`/`case 'list'` already use).
- **Tests** (`Emboss/tests/displayed_and_verse_rules.test.mjs`): a blank line before a poem
  after an ordinary paragraph; a blank line after a poem before an ordinary paragraph, with
  none between the poem's own two lines; the cell-5/cell-7-heading exception re-checked
  (regression); a centred heading before a poem still keeps ITS OWN blank line (not one of
  13.3.1a's two named exceptions); two consecutive "whole poem" blocks (13.9.3b's own
  "first and second version" shape) keep exactly one blank line between them, none inside
  either; formatBlock/traceBlock parity for a `.lines`-array whole-poem block and for an
  ordinary per-line verse block; a prose poem (13.7.1a) gets a blank line before/after, none
  between its own two paragraphs, at the ordinary (non-displayed) 3-1 margin (13.7.1b).
- **Gold:** `node Emboss/scripts/gold-run.mjs --section section-13 --update-status` flips
  three previously-`match` worked examples to `mismatch` — **example-13-2, example-13-3,
  example-13-4** — each a standalone single-poem worked example (BANA's own "Poem with One
  Level" / "Three-Level Poem" / "Poem with Deep Indention") with nothing before or after it in
  this section's own `print.blocks` schema; the new trailing blank line this fix correctly
  adds (13.3.1a has no "poem is the last thing in the excerpt" exception) has no counterpart
  in the standard's own typeset page, which simply ends where the illustrative fragment ends —
  the SAME "known, expected non-match" pattern this section's own README already documents for
  isolated worked-example fragments (a leading blank is silently trimmed by the pre-existing
  document-start rule, so only the trailing side differs). No other section-13/Appendix-J
  sample's status changed. `--section section-9`/`--section section-4`/`--section section-8`
  show no status changes (none of their content is poem/verse-shaped). A DTBook built with
  `exportToNimasXml` for a poem between two ordinary paragraphs, re-parsed with `parseDtbook`
  and formatted, shows the correct blank lines both sides and passes
  `Emboss/scripts/daisy-validate.mjs` (0 errors, 7 suppressed known-bug `<meta>` warnings).
- **Incidental effect on F-122** (13.8.1, not itself part of this task): because the trailing
  blank after a poem run is now added unconditionally in BANA mode, F-122's own reproduction
  (a footnote's note-separation line directly after a poem) now ALSO gets its required blank
  line, checked directly — not claimed fixed here (out of this task's requested scope; F-122's
  own status is left as Paul finds it), flagged for Paul to confirm and update F-122 directly.

---

## F-122 — A footnote/note-separator line directly after a poem gets no blank line before it (BANA mode)

**Rule:** BANA 13.8.1 ("...Leave a blank between the end of a stanza, or the end of a poem,
and the note separation line.")

**Input:** `{ blocks: [ verse-line, verse-line, {type:'footnote', text:'...'} ] }`, BANA mode.

**Expected:** one blank line between the poem's last line and the note-separation line
(`"333333`).

**Actual:** the separator is emitted directly under the poem's last line, no blank between.
Reproduced live:
```
  0: [,A L9E ( POETRY ) A REF];E"9]
  1: [,A SECOND L9E ( POETRY1 ! LA/ ( ! /ANZA]
  2: ["333333]
  3: [,A FOOTNOTE EXPLA9+ ! REF];E M>K4]
```
`noteLead` (`document.mjs:739-740`) only prepends a blank line (`['']`) in UKAAF mode; in
BANA mode a run-starting note gets no leading blank at all
(`block.noteRunStart ? [NOTE_SEPARATOR] : []`). This is not verse-specific — any BANA content
directly preceding a footnote run has the same gap — but it directly breaks 13.8.1's own
wording, discovered here because it is this section's own explicit rule.

**Classification:** bug. **Status:** not done.

---

## F-123 — Stanza and verse numbers are prefixed as plain text, never rendered as cell-5 headings

**Rules:** BANA 13.4.1b ("Use cell-5 headings for stanza numbers"), 13.11.4a ("Transcribe
verse numbers as cell-5 headings").

**Input:** a `<poem><linegroup><linenum>1</linenum><line>First line...</line>...` DTBook
fragment (matching `Emboss/tests/nimas_poetry_verse.test.mjs`'s own "Poetry Sibling Line
Numbers" shape), or a bare verse block with a leading number.

**Expected:** the stanza/verse number "1" rendered on its own centred/cell-5 line (BANA
§4.5, cell 4 first, cell 4 runover), separate from the poem's own 1-3/1-5/etc. margins.

**Actual:** the number is prefixed directly onto the first verse line's own text.
`parsePoem`'s stanza-number handling (`Emboss/input/parse.mjs`, ~lines 2485-2518,
`stanzaLinenum`) builds `numPrefix = (innerLinenum || stanzaLinenum) + ' '` and prepends it to
the line text; `formatPlay` (`document.mjs:790-800`) has no heading/level concept for a
stanza or verse number at all. Reproduced live: a verse line `'1 First line of stanza one'`
renders as `#A ,F/ L9E...` (braille "1" glued to the start of the text line), never as its
own centred/cell-5 line.

**Classification:** bug/gap. **Status:** not done (both rules; same underlying cause).

---

## F-124 — Runs of multiple spaces collapse to one, so BANA's "three blank cells" wide-spacing convention cannot be produced

**Rule:** BANA 13.6.3 ("Use three blank cells to separate widely spaced words or phrases.").
Also affects the spacing half of 13.9.5 (symbol-only scansion/meter diagrams, which typically
rely on multiple-space alignment).

**Input:** `formatBlock({ type:'play', subtype:'verse', level:0, text:'AAA   BBB   CCC   DDD' }, { width:60, mode:'bana', translate: s=>s.toUpperCase() })` (identity translate, to see raw spacing).

**Expected:** the three literal spaces between each word are preserved (or at minimum,
distinguishably wider than a normal one-cell word gap).

**Actual:** `["AAA BBB CCC DDD"]` — collapsed to single spaces. No mechanism anywhere in the
verse/text pipeline preserves a deliberate multi-cell gap; ordinary single-space-normalised
text handling applies uniformly.

**Classification:** bug (the rule cannot be satisfied even by a transcriber who tries).
**Status:** not done.

---

## F-125 — Uncontracted/grade-1 marking is per verse-LINE, not per POEM: a poem-spanning grade-1 passage never has just one opening/closing indicator pair

**Rules:** BANA 13.6.4a ("Use uncontracted braille. Use the grade 1 passage indicator and
terminator around the ENTIRE POEM..."), 13.9.3d ("Transcribe the second version in
uncontracted braille...").

**Input:** two verse-line blocks, each with `segments:[{type:'text', text:'...',
uncontracted:true}]`, BANA mode.

**Expected:** one grade-1 passage indicator before the poem's first line and one terminator
after its last line (mirroring `formatCodeBlock`'s own block-spanning wrap,
`Emboss/format/document.mjs:1670-1686`, which opens/closes the G1 passage indicator once
around an entire multi-line code block).

**Actual:** each line gets its OWN indicator/terminator pair. Reproduced live:
```
  0: [;;;,F/ L9E ( ! POEM WRITT5 UNCONTRACT$;']
  1: [;;;,SECOND L9E ( ! POEM AL UNCONTRACT$;']
```
`formatPlay` (`document.mjs:790-800`) formats each verse-line block independently via
`segmentsToBraille`, which wraps each contiguous `uncontracted` run within a SINGLE block
(`document.mjs:660-664`) — there is no poem-spanning equivalent of `formatCodeBlock`'s
block-level G1 wrap for verse.

**Classification:** gap. **Status:** not done (13.6.4a); partial (13.9.3d — the content
itself does come out correctly translated in grade 1 line by line, just not wrapped in the
single pair the rule and 13.6.4a both describe).

---

## F-126 — No page-break protection exists for verse lines or stanzas

**Rules:** BANA 13.3.1b ("A line of poetry may not be divided between braille pages."),
13.4.1d ("Leave a blank line at the top of the next braille page when a stanza ends on line
24 or 25..."), 13.4.2 ("Stanza Division. When a page break would occur following the first
line of a stanza, take the entire stanza to the next braille page.").

**Evidence:** `applyPageBoundaries` (`Emboss/format/document.mjs:2840-2942`) only recognises
`heading`, `pagenum` and `graphic` blocks by type, plus generic `contentKeep`/`lines.keepGroups`
groups. The only two places anything sets `keepGroups` are the footnote separator pair
(`document.mjs:758`) and listed-table rows (`document.mjs:1571-1589`, BANA §11.16j). No code
anywhere references `isVerseBlock` in a pagination context (`layout.mjs` has no verse/poem
reference at all; `document.mjs`'s pagination functions have none either) — a long verse
line's runover, or a stanza's opening line, can be split across a page boundary exactly like
any other paragraph.

**Classification:** gap. **Status:** not done (all three rules).

---

## F-127 — No "doubly-transcribed poem" (scansion/stress/meter) feature exists, and a diacritic placed above a specific letter cannot be represented at all

**Rules:** BANA 13.9.3 ("Transcribe a poem that contains stress, scansion, or meter marks
twice..."), 13.9.3c ("...cell 3 for the left margin and the standard nested list format"),
13.9.3e ("Follow print when stress and meter symbols are placed above the affected
words...").

**Evidence:** Emboss's block/segment model represents each verse line as a single row of
characters (`formatPlay`, `document.mjs:790-800`); nothing anywhere places a symbol one line
above a specific letter (a raised diacritic), and there is no linkage anywhere in the
codebase between a "first version" and "second version" of the same poem (no shared id, no
automatic same-page placement, no automatic title/attribution repetition rule). A transcriber
can only approximate the double-writing technique by hand-authoring two independent poem
blocks; nothing in Emboss enforces or assists 13.9.3's page-placement/title rule, and 13.9.3e
literally cannot be produced in the current single-line text model.

**Classification:** not built. **Status:** not done.

---

## F-128 — UKAAF B004 App J's "line indicator" method for writing poetry continuously does not exist

**Rules:** B004 J guiding-principle ("...the 'line Indicator' method may be employed where
space-saving is desirable..."), B004 J line-indicator-method ("Poetry may be written
continuously with the line indicator placed at the end of each verse line...").

**Evidence:** grep of `document.mjs`/`parse.mjs`/`editor.mjs` for a per-verse-line-end
indicator symbol finds nothing; the only "indicator line" concept in the codebase
(`indicatorLine`, `document.mjs:96`) is the unrelated horizontal section-break rule
(dot-2s/colons/asterisks), not a symbol placed at the end of individual verse lines. Only the
"line by line" method (one verse line per braille line) is implemented.

**Classification:** not built. **Status:** not done.

---

## F-129 — UKAAF line-by-line method's own "start each stanza in cell 3, no blank line" alternative has no supporting option

**Rule:** B004 J line-by-line-method ("...alternatively, each stanza or paragraph may start
in cell 3 of a new line.").

**Evidence:** `nestedMargins('poetry', ...)` (`document.mjs:132-144`) and the
`{type:'indicator', kind:'stanza'}` mechanism (`document.mjs:1880`) together only ever
produce the FIRST named option (blank line before the stanza, first line in cell 1) —
confirmed live (scratch probe "ukaaf-two-stanzas"). Unlike lists, which have an
`o.listStyle` option (`'spaced'` vs `'compact'`, see `nestedMargins`'s own `kind === 'list'`
branch, `document.mjs:136-139`), there is no equivalent style switch for poetry, so the
"start in cell 3, no blank" alternative cannot be selected.

**Classification:** gap. **Status:** partial (the primary/default option works and is
tested; the rule's own named alternative is missing).

---

## F-130 — Three §13/Appendix-J rules depend on the pre-existing "no Special Symbols page" gap

**Rules:** BANA 13.2.1c, 13.9.2, 13.9.4b (all "...Identify [symbols] on the Special Symbols
page, or in a transcriber's note before the text.").

**Evidence:** this is the SAME cross-cutting, already-documented gap noted elsewhere in this
map (e.g. BANA 4.9.3, 8.6.2b, 16.2.2b, 5.5.3; `standards-findings.md` F-31/F-33): no "Special
Symbols page" front-matter feature exists anywhere in Emboss, and no structured mechanism
ties a specific symbol's usage in the text to any automatically-generated documentation of
it. Not a new root cause — flagged here only because it recurs in this section.

**Classification:** pre-existing gap (see F-31/F-33). **Status:** not done (all three rows).

---

# Standards findings — transcriber-generated pages and front matter (BANA §2, B004 §1–4 + Appendix H; assessed 17 Sep 2026)

## F-131 — No transcriber-generated ('t') braille-page-number prefix mechanism exists anywhere

**Rules:** BANA 2.1.1, 2.2.1, 2.2.1b, 2.2.1c, 2.7.1

> "Braille page numbers are preceded by the letter t, e.g., t1, t2, etc." (2.2.1b)

**What Emboss does:** grep of `format/document.mjs`/`format/page.mjs` for a `'t' + brailleNumber(...)`-style prefix (paralleling `buildToc`'s own `'P' + brailleNumber(...)`, `document.mjs:2712`) finds nothing. This is the same gap already logged as `standards-findings.md` F-58 for the parallel BANA §1.15.1b rule — extending it here to the four §2 rules that also depend on it: 2.1.1's "distinguished... by a unique set of braille page numbers", 2.2.1's ordering of the four transcriber-generated page types (moot with none producible), 2.2.1b/c's `t1`/restart-at-`t1` requirements, and 2.7.1's "front matter pages follow the transcriber-generated pages" (nothing to follow). `volumeTitlePage` — the closest thing Emboss has to a non-body page — renders no page number at all (F-57).

**Classification:** not done, all five rows — one missing mechanism, already tracked as F-58.

**Test that would prove a fix:** a document with `doc.title` set and no other front matter, formatted BANA, whose first page (whatever type it is) shows a `t`-prefixed number.

---

## F-132 — No Title Page feature exists anywhere in Emboss

**Rules:** BANA 2.3.1, 2.3.3a, 2.3.3b, 2.3.3c, 2.3.3d, 2.3.3e, 2.3.4a, 2.3.4b, 2.3.4c, 2.3.4d, 2.3.4g

> "All volumes include a transcriber-generated title page with five segments of information."
> (2.3.3a)

**What Emboss does:** grep of `format/document.mjs`, `format/page.mjs`, `input/parse.mjs`, `input/nimas-export.mjs` and `web/editor/editor.mjs` for "Title Page"/"titlePage"/a five-segment layout finds nothing. The only place `doc.title` is rendered is `bookTitleLines`/`banaRunningHead` (`document.mjs`, the `pageOneTitle` mechanism, tested by `tests/book_title_running_head.test.mjs`) — that satisfies BANA §1.8.1 ("book title on braille page 1"), a *different* rule (`standards-findings.md` F-60), not this dedicated transcriber-generated page: no segments, no page number of its own, no place for author/publisher/ISBN/transcriber/volume information. There is also no `subtitle`/`series`/`edition`/`gradeLevel` field anywhere in `input/parse.mjs`'s data model (only `doc.title`, a single string). Reproduced: `formatDocument` on a model with `doc.title`/`metadata.docauthor` set and no other front-matter blocks produces only the body pages with the title inline on page 1 — no separate title page of any kind.

**Classification:** not done, all eleven rows — one missing feature (the Title Page container and its layout rules).

**Test that would prove a fix:** a document with title/subtitle/grade-level/author metadata set, formatted BANA, whose output begins with a distinct Title Page (five segments, 1-3 margins, text on both line 1 and line 25) before any body content.

---

## F-133 — Author segment has only a single `docauthor` string; no per-author line control, affiliation, editor, or translator fields

**Rules:** BANA 2.3.5a, 2.3.5b, 2.3.5c, 2.3.5d, 2.3.5e, 2.3.5f, 2.3.5g

> "Authors may be listed on separate lines, or follow one another on the same line, separated
> by a comma." (2.3.5c)

**What Emboss does:** `input/parse.mjs:1450-1453` does collect every `<docauthor>` into `metadata.docauthors` (plural), so multi-author data can exist — but no Title Page layout code consumes `metadata.docauthors` at all (grep of `document.mjs` finds nothing), so neither the "By" rule (2.3.5a), capitalization (2.3.5b), one-line-per-author-vs-comma-joined choice (2.3.5c), nor the "et al." truncation for >3 authors (2.3.5e) can be produced. No `affiliation`/`degree` (2.3.5d), `editor` (2.3.5f), or `translator` (2.3.5g) field exists anywhere in the data model.

**Classification:** not done, all seven rows — depends on F-132 (no Title Page to place any of this on) plus missing data-model fields for 2.3.5d/f/g specifically.

**Test that would prove a fix:** a model with `metadata.docauthors` (3+ names) and a translator field, formatted BANA, whose Title Page author segment lists only the first name + "et al." with the full list on the second title page, and the translator on the line after the author.

---

## F-134 — No publisher, copyright, ISBN, or printing-history rendering; `metadata.publisher` is parsed and exported but never used

**Rules:** BANA 2.3.6a(1), 2.3.6a(2), 2.3.6b, 2.3.6c, 2.3.6d(1), 2.3.6d(2), 2.3.6d(3), 2.3.6d(4), 2.3.6e(1), 2.3.6e(2), 2.3.6f(1), 2.3.6f(3), 2.3.6f(4), 2.3.6f(5), 2.3.6f(6), 2.3.6f(7), 2.3.6g(2)

> "When authorized by copyright law, the title page states "Published by" followed by the
> publisher information." (2.3.6a(1))

**What Emboss does:** `metadata.publisher` is parsed from `dc:publisher` (`parse.mjs:1433`) and round-tripped on NIMAS export (`nimas-export.mjs:1248`) but never rendered into braille output anywhere — grep of `document.mjs`/`web/editor/editor.mjs` for `metadata.publisher`/`.publisher` finds no consumer. No publisher-city/state, publisher-URL, copyright-date/holder, ISBN/ISSN, or printing-history field exists anywhere in `input/parse.mjs`'s data model at all; none of the "Published by"/"With permission of the publisher"/"Transcription of"/"Printing history:" fixed wordings exist in `document.mjs` either.

**Classification:** not done, all seventeen rows — depends on F-132 (no Title Page) plus a substantial set of missing metadata fields that NIMAS/DTBook import does not currently populate even where the source format could carry them (e.g. `dc:identifier` for ISBN is not specifically parsed for this purpose).

**Test that would prove a fix:** a model with publisher/copyright/ISBN metadata set, formatted BANA, whose Title Page Publisher and Copyright segment matches Sample 2-9 (U.S. Title Page)'s structure.

---

## F-135 — No Transcriber/Transcription-segment fields (year, base code, transcriber/proofreader/tactile-specialist names, sponsoring agency)

**Rules:** BANA 2.3.7a, 2.3.7b, 2.3.7c

**What Emboss does:** no transcription-year/base-code/proofreader/tactile-graphics-specialist/sponsoring-agency field exists anywhere in `input/parse.mjs`'s data model (only `metadata.docauthor`, the print author, which is unrelated to who transcribed the book).

**Classification:** not done, all three rows — depends on F-132 plus missing metadata fields (transcription is not something NIMAS/DTBook source files record at all; this would need new UI/import support, not just new rendering code).

**Test that would prove a fix:** a model with transcriber-segment metadata set, formatted BANA, whose Title Page carries it.

---

## F-136 — No Volume Information segment on the Title Page

**Rules:** BANA 2.3.8a(1), 2.3.8a(2), 2.3.8a(3), 2.3.8b, 2.3.8c, 2.3.8d(1), 2.3.8d(2), 2.3.8d(3), 2.3.8d(4)

> "Individual volumes in the braille edition are indicated with consecutive arabic numbers."
> (2.3.8a(2))

**What Emboss does:** the total-volume count and consecutive arabic volume numbering are already computed and rendered — but only on `volumeTitlePage`'s own separate "Volume N of M" line (`document.mjs:3278-3296,3306-3327`), a pre-existing, unrelated feature (BANA §1.6, `standards-findings.md` F-55), never on this Title Page segment, which does not exist (F-132). There is no "Preliminary Volume"/"Supplement" concept (F-55), no "uncontracted/partially contracted volume" tracking, and no computation anywhere of the *range* of print pages a volume covers (needed for 2.3.8d(1)-(4)'s inclusive-print-page-number reporting) or of accounted-for `t`/`p`/body page numbers (2.3.8c, depends on F-131).

**Classification:** 2.3.8a(2) partial (the underlying arabic-numbering mechanism exists, just on the wrong page); the other eight rows not done — depends on F-132, F-131, and F-55.

**Test that would prove a fix:** a two-volume BANA document's Title Page volume-information segment showing "Volume 1 of 2" plus the correct inclusive print-page range for that volume.

---

## F-137 — No Second/Subsequent Title Page feature exists anywhere

**Rules:** BANA 2.4.1, 2.4.1a, 2.4.1b, 2.4.1c, 2.4.1d, 2.4.2a, 2.4.2b, 2.4.2c

**What Emboss does:** grep of `document.mjs`/`parse.mjs`/`web/editor/editor.mjs` finds no "second title page"/overflow-page concept at all — nowhere to place an overflowing author list, the CNIB reproduction statement, or transcriber/transcription overflow.

**Classification:** not done, all eight rows — one missing feature, independent of (but naturally built alongside) F-132.

**Test that would prove a fix:** a document whose author list exceeds 3 names, formatted BANA, produces a second title page listing the full author list.

---

## F-138 — No Special Symbols page exists; confirmed by the code's own comment

**Rules:** BANA 2.5.1, 2.5.2a, 2.5.2c, 2.5.2d, 2.5.2e

> "Until the Special Symbols page exists (G8), the first transcriber-defined symbol is
> explained in a transcriber's note before its first use" — `format/document.mjs`, the
> comment immediately preceding `tdSymbolNote`.

**What Emboss does:** the fallback described in that comment (an inline TN at first use, BANA §3.3.1, via `tdSymbolNote`) is the only symbol-explanation mechanism Emboss has; it is not a page, does not list every symbol used in the volume, is not centred-heading formatted ("SPECIAL SYMBOLS USED IN THIS VOLUME"), and does not sort in braille order. No tracking of "every symbol used in the volume" exists either — only the single first-asterism-use case (`firstAsterism`, `document.mjs:2998`).

**Classification:** not done, all five rows — one missing feature, already flagged as a known gap ("G8") by the code itself.

**Test that would prove a fix:** a document using two distinct transcriber-defined symbols, formatted BANA, produces a Special Symbols page listing both in braille order with the `.=` dot-locator and capitalized meanings.

---

## F-139 — No Transcriber's Notes PAGE exists; the inline TN mechanism is structurally incompatible with it

**Rules:** BANA 2.6.1, 2.6.1a, 2.6.1b, 2.6.1c, 2.6.1d

> "Transcribe all notes as 3-1 paragraphs. Do not use the transcriber's note indicators."
> (2.6.1b)

**What Emboss does:** only per-occurrence transcriber's notes exist (`formatTranscriberNote`, `document.mjs:600-630`; `case 'note'`, `document.mjs:1425`), placed wherever the transcriber inserts one in the body. There is no consolidated end-of-front-matter page listing recurring format/usage notes, and no tracking of which notes "occur more than once" to decide what belongs there. Worse, even if reused, `formatTranscriberNote` always wraps its content in the UEB transcriber's-note indicator dots — the *opposite* of what 2.6.1b requires for this page (plain 3-1 paragraphs, no indicators).

**Classification:** not done, all five rows — one missing feature, and the closest existing mechanism cannot simply be repurposed (would need a genuinely new, indicator-free note-list renderer).

**Test that would prove a fix:** a document with a recurring special format (e.g. a Nemeth math region), formatted BANA, produces a Transcriber's Notes page (centred heading, plain 3-1 paragraphs) noting it.

---

## F-140 — No braille-page-forcing primitive exists in Emboss

**Rules:** BANA 2.7.1a, 2.8.1a, 2.9.1a, 2.9.1c, 2.10.13a

> "Each item in the front matter begins on a new braille page." (2.7.1a)

**What Emboss does:** reproduced directly — a scratch document with two front-matter-like paragraphs separated only by a heading renders them on the same braille page whenever they fit (`assemble`, `page.mjs:140-256`, chunks purely by line count). Grep of `document.mjs`/`input/parse.mjs` for a page-break/page-type block beyond the `'break'` asterism divider (BANA §1.9.5, a visual divider, not a page break) and the `'page'` print-page-number marker (an annotation, not a break) finds none. There is no way to mark a block "must start a fresh braille page," so nothing — cover/jacket material (2.8.1a), a dedication/acknowledgements section (2.9.1a/c), or a categorized table of contents (2.10.13a) — can be isolated onto its own page.

**Classification:** not done, all five rows — one missing primitive, needed by several otherwise-independent features.

**Test that would prove a fix:** a `forcePageBreak` (or similar) block/flag that, inserted between two ordinary paragraphs, guarantees the second starts braille line 1 of a new page even when both would otherwise fit on one page together.

---

## F-141 — No general front-matter ('p') page-number-prefix mechanism; only `buildToc`'s own auto-generated pages get one

**Rules:** BANA 2.7.1b, 2.10.2f

> "Precede braille page numbers by p, e.g., p1, p2, etc." (2.7.1b)

**What Emboss does:** the same gap as F-131, but for the `p` (front-matter) prefix rather than `t` (transcriber-generated) — already logged as `standards-findings.md` F-58 ("Only the TOC gets a front-matter ('P') page-number prefix"). Reproduced (scratch probe): a manually-authored `list` block of `kind:'toc'` placed before the body renders on the same page as, and with the identical page number to, the body content that follows it — no `p`-prefixed numbering at all for ordinary front matter (2.10.2f's "table of contents on or inside the cover... is braille page p1" is unreachable for the same reason).

**Classification:** not done, both rows — same missing mechanism as F-58/F-131.

**Test that would prove a fix:** any front-matter block, formatted BANA, rendered with a `p`-prefixed page number distinct from the body's own numbering.

---

## F-142 — No computation of implied/inferred print page numbers (front matter)

**Rules:** BANA 2.7.1c, 2.7.1e

> "Print front matter pages may have implied page numbering. ... Implied print numbers are
> added to all corresponding braille pages." (2.7.1e)

**What Emboss does:** the generic print-page-number mechanism (`input/parse.mjs`'s `pagenum` handling; `formatPrintPageHeader`, `page.mjs`) applies uniformly to any content, front matter included, when the transcriber inserts an explicit print-page marker — but *implied* (unnumbered) print pages have no computation at all. This is the same gap already logged as `standards-findings.md` F-45 ("No computation of implied/inferred print page numbers"), assessed for BANA §1.11.6, which 2.7.1e itself cross-references directly. This is simply that finding's rule list extended to cover the front-matter-specific statement of the same requirement.

**Classification:** 2.7.1c partial (explicit numbering works, implied does not); 2.7.1e not done — both already tracked as F-45.

**Test that would prove a fix:** see F-45's own test.

---

## F-143 — No "repeated content relocated to end of front matter" logic

**Rules:** BANA 2.7.1d

**What Emboss does:** print order is preserved trivially (Emboss never reorders blocks, a generic behaviour that applies everywhere) — but grep of `document.mjs` for "cast of characters"/"pronunciation key"/repeated-content relocation finds nothing. Subsequent-volume front matter is not itself a distinguished concept either (BANA §2.12's volume restart, `renumberPage`, only concerns body pages).

**Classification:** partial (order preservation is a free side-effect of generic behaviour; the actual relocation-to-end-of-front-matter-in-every-volume logic is not done).

**Test that would prove a fix:** a document with a "Pronunciation Key" appearing once in print front matter, split into two volumes, where the key is repeated at the end of front matter in both volumes with its original print page number retained.

---

## F-144 — No cover/jacket transcription feature (distinct from the tactile physical-cover generator)

**Rules:** BANA 2.8.1

**What Emboss does:** Emboss has no concept of transcribed cover/jacket content as a distinguished input at all — it would have to be typed as ordinary body blocks, with nothing restricting such blocks to volume 1 specifically when a document is split (`formatVolumes`, `document.mjs:3306-3327`, distributes body pages purely by page count). **Important distinction, to avoid confusing this with existing code:** `format/cover.mjs`'s `generateVolumeCover` produces a tactile *physical binding* cover for the finished braille volume (`standards-findings.md` F-59, itself dead/unreachable code) — that is BANA §1.17's spine-label/binding concern, not a transcription of the print book's own cover-copy content into front matter, which is what this rule requires. The two are unrelated features that happen to share the word "cover."

**Classification:** not done — depends on F-140 (page-break primitive) for correct placement even if the content-inclusion gap were fixed.

**Test that would prove a fix:** a document with cover-blurb content marked as such, split into two volumes, where the cover content appears only in volume 1.

---

## F-145 — Dedication/acknowledgements: print typeform is preserved by default, not ignored

**Rules:** BANA 2.9.1f

> "Ignore emphasis unless needed for distinction." (2.9.1f)

**What Emboss does:** an ordinary paragraph/list preserves print typeform (bold/italic) by default rather than dropping it (the same preserve-not-drop default `table_rich_cells.test.mjs` documents elsewhere); no code strips emphasis from body paragraphs generally (`stripEmphasis`, `document.mjs:153-155`, applies only to centred/cell-5/cell-7 headings, not ordinary paragraphs).

**Classification:** not done — a transcriber must manually omit emphasis markup when typing dedication/acknowledgements text; Emboss does not do it for them.

**Test that would prove a fix:** a dedication paragraph with inline bold markup, formatted BANA, renders with the bold indicator dropped.

---

## F-146 — No brief/full table-of-contents distinction, and no multi-volume table-of-contents splitting at all

**Rules:** BANA 2.10.1a, 2.10.1c, 2.10.2d, 2.10.2e, 2.10.9a, 2.10.9b, 2.10.9c, 2.10.9d, 2.10.9e, 2.10.10, 2.10.10a

> "Subsequent volumes contain only the portion of the table of contents pertaining to the
> print pages in that volume." (2.10.2e)

**What Emboss does:** Emboss has exactly two table-of-contents mechanisms — a manually-authored `list` block of `kind:'toc'` (parsed from a print `<div class="toc">`-like source, `input/parse.mjs:2005-2064`) and `buildToc` (`document.mjs:2674-2728`), an auto-generated "Contents" section built from the document's own headings and their *braille* page numbers, gated by the editor's `o.toc` checkbox. **Neither has any "brief" vs. "full" distinction, any per-volume splitting, or any "Volume 1"/"Volume 2"/"Following Volumes" labelling.** `formatVolumes`/`formatVolumesAsync` (`document.mjs:3306-3327,3328-3346`) attach `b.tocPages` only to the first volume's chunk (`...(idx === 0 ? b.tocPages : [])`) — every volume after the first gets no table of contents at all, not a filtered portion of it.

**Classification:** not done, all eleven rows — one substantial missing feature (a genuinely multi-volume-aware table of contents), compounded by `standards-findings.md` F-56 (volume splitting has no concept of chapter/unit boundaries either, so even "which entries belong to which volume" cannot be computed reliably yet).

**Test that would prove a fix:** a document split into two volumes by `formatVolumes`, where volume 2's braille output includes a table-of-contents page listing only the headings whose content actually falls in volume 2, headed "Volume 2".

---

## F-147 — The manually-authored contents list does not force a page break and gets no page-number prefix at all

**Rules:** BANA 2.10.2b, 2.10.2c

> "The table of contents begins on a new braille page." (2.10.2b)

**What Emboss does:** `buildToc`'s auto-generated Contents section is architecturally always its own separate page array, so it trivially starts fresh — but the manually-authored `kind:'toc'` list (representing a *real* print table of contents) does not force a page break at all. Reproduced (scratch probe, BANA mode): a document with an ordinary paragraph, then a `list` block of `kind:'toc'`, then a heading and body text renders the toc-list on the **same page**, immediately after the preceding paragraph, with no page break before or after it, and with the identical (ordinary body) page number as its surroundings — never `t`-prefixed even when the editor's `o.toc` auto-generation (which *does* exist for exactly this "transcriber-generated contents for informal materials" use case) is `P`-prefixed instead of `t`-prefixed (F-131/F-58).

**Classification:** partial — depends on F-140 (page-break primitive) for 2.10.2b, and on F-131 (t-prefix mechanism) for 2.10.2c.

**Test that would prove a fix:** see F-140's and F-131's own tests.

---

## F-148 — No hoisted per-entry identifier word (e.g. "Chapter") in either table-of-contents mechanism

**Rules:** BANA 2.10.2g, 2.10.2h, 2.10.4a, 2.10.4b, 2.10.4c, 2.10.4d

> "Tables of contents frequently include chapter, lesson, etc., before each of the main
> numbered entries. ... this identifier is placed in cell 1 ... The identifier is omitted
> before the individual entries." (2.10.2g)

**What Emboss does:** neither mechanism has any concept of a repeated per-entry identifier word to hoist and de-duplicate: `buildToc` renders each heading's own text verbatim (`document.mjs:2679-2700`) and the manually-authored `kind:'toc'` list renders each item's own text verbatim (`tocEntryLines`, `document.mjs:411-438`) — neither strips a leading "Chapter"/"Lesson" from individual entries nor inserts a single hoisted identifier line above them. The related front/body/back-matter blank-line separators (2.10.4a/b) and the "blank line before only the first of several consecutive centred headings" rule (2.10.4c) have no supporting front/body/back-matter distinction in the data model either (same absence as BANA 2.1.1).

**Classification:** not done, all six rows — one missing feature (per-entry-identifier hoisting) plus a related missing data-model distinction.

**Test that would prove a fix:** a print contents list where every entry begins "Chapter N:", formatted BANA, produces a single hoisted "Chapter" line in cell 1 above the entries, each of which then omits its own "Chapter N:" prefix.

---

## F-149 — `buildToc`'s fixed "Contents" wording does not follow print, and neither TOC mechanism centres unit/part headings or shows a volume indicator

**Rules:** BANA 2.10.3a, 2.10.3b, 2.10.3d

> "Center the print contents heading (e.g., Table of Contents, What You Will Study, etc.)."
> (2.10.3a)

**What Emboss does:** the manually-authored `kind:'toc'` list has no heading of its own — whatever `heading` block precedes it in the source is centred/spaced by the ordinary generic heading mechanism, satisfying "follow print"/"omit when none" by construction — but `buildToc` always renders the fixed, translated word "Contents" (`document.mjs:2677`, `o.translate('Contents')`) regardless of print's own wording (e.g. "What You Will Study"), and never emits a "Volume 1" line (2.10.3b) at all. Neither mechanism distinguishes a unit/part heading from an ordinary chapter heading — `buildToc` positions every heading level purely by indentation (`nestedMargins`, `document.mjs:2685`), never by centring (2.10.3d).

**Classification:** 2.10.3a partial (works via the generic heading mechanism for the manual-list path; wrong for `buildToc`); 2.10.3b/3d not done.

**Test that would prove a fix:** an `o.toc`-generated contents page whose title reads whatever the document itself calls its contents section (not a hard-coded "Contents"), and whose unit/part-level headings render centred rather than indented.

---

## F-150 — Right-margin buffer and ALL-CAPS/small-caps title-casing not enforced on contents pages

**Rules:** BANA 2.10.7b, 2.10.8a

> "Any line without a page number ends at least six cells before the right margin." (2.10.7b)

**What Emboss does:** no code checks or enforces a six-cell right-margin buffer on any contents-page line lacking a page number — `centredBlock` (used for `buildToc`'s heading) simply centres text within the full page width with no reserved margin. "Follow print" for capitalization is satisfied trivially (text rendered verbatim, no case transform) — but the ALL-CAPS/small-capitals→title-case conversion has no implementation anywhere: grep of `document.mjs`/`input/parse.mjs` for "titleCase"/"smallCaps" finds no matches at all.

**Classification:** 2.10.7b not done; 2.10.8a partial.

**Test that would prove a fix:** a very long centred contents heading that would otherwise run within six cells of the right margin, wrapped/truncated to respect the buffer; an all-uppercase contents source converted to title case on output.

---

## F-151 — Continuation letters are not stripped from a manually-authored contents entry's page number

**Rules:** BANA 2.10.5, 2.10.7a

> "Page numbers for contents entries are placed, without the continuation letter, at the
> right margin..." (2.10.7a)

**What Emboss does:** **BANA 2.10.5 is implemented and cited by name in the code** — `buildToc`'s own comment (`document.mjs`) reads: "BANA Formats §2.10.5: 'Table of contents entries may not appear on line 1 or line 25 ...', so a contents page is a blank line 1, depth−2 entry lines, and the P-numbered last line." Both `buildToc` and `tocEntryLines` (`document.mjs:411-438,2690-2698`) also implement the guide-dot leader exactly as 2.10.7a describes. **Gaps:** the interpoint even-page exception to 2.10.5 has no support (no interpoint/duplex awareness anywhere, `standards-findings.md` F-64); the manually-authored list's page numbers are rendered verbatim from source text with no continuation-letter stripping for 2.10.7a; and neither line/margin reservation nor the guide-dot mechanism apply to a manually-authored `kind:'toc'` list at all when it isn't on its own dedicated page (consistent with F-147).

**Classification:** both partial — the core mechanism for `buildToc` (BANA's own auto-generated Contents) is solid; the interpoint exception and continuation-letter stripping are the specific gaps.

**Test that would prove a fix:** a `kind:'toc'` list item whose print page reference includes a continuation letter (e.g. "12a"), rendered with the letter dropped per 2.10.7a.

---

## F-152 — Extraneous contents-page material and unnumbered contents entries only partly handled

**Rules:** BANA 2.10.2i, 2.10.11

**What Emboss does:** a sidebar/box or other block placed adjacent to a `kind:'toc'` list renders using its own existing formatting rules (`formatBox`, etc.) — satisfying "treat per other formatting guidelines" generically — but nothing checks or enforces the six-cell right-margin constraint specifically on such interleaved content (F-150). A page-less list item is, however, correctly handled at its indentation level: `tocInColumns` (`document.mjs:453`) is false when `item.page` is falsy, so `formatList`'s ordinary rendering applies, still at the item's own `nestedMargins('toc', ...)` level.

**Classification:** both partial.

**Test that would prove a fix:** a linear/unnumbered contents entry inside a nested `kind:'toc'` list, rendered at the correct subentry indentation with no dangling page-number leader.

---

## F-153 — No transposed-material or categorized-table-of-contents representation

**Rules:** BANA 2.10.12a, 2.10.12b, 2.10.12c, 2.10.13, 2.10.13b

> "The text itself is not repeated in its original print location. Insert a transcriber's
> note, on the original print page, indicating where the material can be found." (2.10.12c)

**What Emboss does:** "transposed material" has no representation anywhere in `input/parse.mjs`'s data model — content is always transcribed in the order the source gives it, with no "moved to a different location" concept to track and cross-reference in a table-of-contents entry or an original-location note. Likewise, no "categorized table of contents" concept exists — a second `kind:'toc'` list (e.g. "List of Poems") would simply be parsed and rendered like any other `toc` list, wherever the transcriber places it, with no volume-1-only restriction and no coordinated cell-5 genre/subject heading.

**Classification:** not done, all five rows — one missing data-model concept (transposition) plus one missing feature (categorized contents), neither depending on the other.

**Test that would prove a fix:** a chapter's endnotes moved to the back of the book in print but transcribed at the end of the chapter, with a transcriber's note at the original location and a correctly-positioned table-of-contents entry.

---

## F-154 — No automatic reclassification of an alphabetically-ordered contents list as an index, and no all-volumes replication

**Rules:** BANA 2.10.15

**What Emboss does:** a distinct `kind:'index'` list format does exist (`input/parse.mjs`'s `isIndex`/`detectedKind` branches; `listMarginKind`, `document.mjs:366`; `pageSuffix`, `document.mjs:446-451`, per BANA §21/B004 App I) — so the *destination* format this rule asks for is implemented and usable if the source is parsed/marked as an index rather than a `toc` list. But nothing automatically inspects entry order to decide `toc` vs. `index`, and the "included in all volumes" replication has no support at all (same absence as F-146, worse here since even volume 1 alone isn't guaranteed for a `toc`-kind list placed outside the auto-generated path).

**Classification:** partial — the index rendering mechanism exists; the auto-detection and all-volumes replication do not.

**Test that would prove a fix:** an alphabetically-ordered print contents list, parsed and formatted, rendered using index conventions (no guide words) and repeated in every volume of a split document.

---

## F-155 — B004 4/H "guiding principles": Emboss provides partial building blocks, no dedicated identification/navigation feature

**Rules:** B004 4 guiding-principles, B004 H guiding-principles

> "Every document must have some form of identification and longer documents need guidance
> on the structure." (B004 4) / "The contents pages should be simple to locate and
> navigate. ... If no contents page is present in the print document, a contents page should
> still be considered for the braille document." (B004 H)

**What Emboss does:** Emboss carries some raw identification data (`doc.title`, `metadata.docauthor`/`docauthors`, `metadata.publisher`) and can show the title inline on braille page 1 (BANA §1.8.1) and a bare "Volume N of M" line when split — but has no dedicated identification/title page assembling "what it is, who it is from, how many volumes" together (F-132's gap). For contents navigation, the `o.toc` auto-generated Contents feature (`buildToc`, gated by the editor checkbox `web/editor/editor.mjs:2081`) directly answers "even with no print contents page, generate one" — a real, user-facing, UKAAF-tested capability (`contents_layout.test.mjs`, `format/test-toc.mjs`) — but the deeper navigation aids (multi-volume/categorised/brief-contents, F-146/F-153) are not built.

**Classification:** both partial.

**Test that would prove a fix:** see F-132's and F-146's own tests — these two rows are satisfied incrementally as those underlying features are built.

---

## Coverage check

All 118 rows of `standards-map.md`'s BANA §2 and B004 §1–4 + Appendix H sections marked
`partial` or `not done` are covered above, each by exactly one finding (F-143, F-144, F-145,
F-154 cover a single row each; the rest group multiple rows sharing one root cause). Rows
marked `done`, `out of scope`, `not-applicable`, or `unclear` are not repeated here per the
findings-file convention (`standards-findings.md`'s own header).

---

## F-156 — A note's body does not begin with its own reference indicator/number

**Rules:** BANA 16.5.1 (note format) — the worked examples show every note body opening with the
same reference mark that appears in the text: Example 16-1 text `,hamlet"9` / note `"9,o!llo`;
Sample 16-1 notes `"9,,$s4 ,,note,-…`, `"9"9…`, `@,?…`; numbered notes open with `;9#a` in the
same way (16.2.1).

**What Emboss does:** `formatFootnote` (`Emboss/format/document.mjs`) renders the note text bare:
for `<p>Text<noteref idref="#n1">1</noteref></p><note id="n1"><p>Single note.</p></note>` in BANA
mode the output is `  TEXT WITH A NOTE;91 HERE.` / `"333333` / `SINGLE NOTE.` — the reference
`;9#a` (or `"9` for an asterisk) is missing from the note line. Reproduced 17 Sep 2026 against
both HEAD and the working tree (pre-dates the F-106…F-113 fixes). Gold: `example-16-1` expects
`"9,o!llo`, actual has the text without the indicator (`gold-run.mjs --section section-16`).

**Classification:** bug (not done).

**Test that would prove a fix:** a one-paragraph and a two-paragraph note, numbered and
asterisked: the first note line begins with the reference mark followed by the text; the §16
gold statuses for example-16-1 and sample-16-01 improve.

**Status update (18 Sep 2026, fixed):** `formatFootnote` and its trace mirror (`traceBlock`'s
`case 'footnote'`, `Emboss/format/document.mjs`) now prepend the note's own reference mark.
- **Signal:** a new `findNoteMarks(blocks)` (`document.mjs`) walks the whole document tree once
  (deep — a noteref nested in a list item, table cell or heading is found too) and maps each
  referenced note `id` to the mark text of the noteref that points at it — "using the same
  symbol the noteref used", per this file's own instruction. `buildDocPages`/`buildDocPagesAsync`
  attach the looked-up mark onto the note's own block as `noteMark` before calling
  `formatBlock`/`traceBlock`, the same way `noteRunStart`/`tdNote`/`lnNote` are already attached.
  `formatFootnote` renders it via the existing `noterefBraille({text: block.noteMark}, o)` (so
  `NOTE_SYMBOLS` and the digit/letter cases already used for the in-text mark are reused
  unchanged) and prepends it to the OPENING paragraph only (16.5.1d's own 1-3/5-3 multi-
  paragraph split is otherwise untouched).
- **No double-marking:** a new `noteBodyStartsWithMark(block, mark)` skips the prepend when the
  note's own leading text (or first segment) already starts with that mark — covering a source
  already transcribed with the mark as literal text (e.g. `notes_rules.test.mjs`'s/
  `note_references.test.mjs`'s own `<note><p>1 First note.</p></note>` convention, which must
  not become `;911 FIRST NOTE`).
- **Reproduced fixed:** the finding's own repro (`<p>Text<noteref idref="#n1">1</noteref>
  here.</p><note id="n1"><p>Single note.</p></note>`) now renders `;91SINGLE NOTE.`, not bare
  `SINGLE NOTE.`.
- **Gold (`node Emboss/scripts/gold-run.mjs --section section-16`):** the missing-mark symptom
  is gone from both proving samples — `example-16-1`'s note line is now `"9,O!LLO` (was bare
  `,O!LLO`) and `sample-16-01`'s five notes all open with their own repeated mark(s) exactly as
  before AND after this fix (buildModel16, another agent's model builder, already pre-baked a
  leading `noteref` segment into each note's own `segments` as a stand-in for this fix, so
  `sample-16-01`'s diff was unaffected either way; `noteBodyStartsWithMark` confirms no double
  mark results now that both mechanisms coexist). Both samples remain `mismatch` in the section-
  wide summary (still 14 mismatch / 11 not-representable / 7 no-braille, unchanged) because each
  has its own SEPARATE, unrelated cause: `example-16-1`'s title paragraph keeps a 2-cell
  indent the gold's isolated-illustration box formatting does not use, and gains one extra
  `"333333` separator line (BANA 16.5.1a's run-start rule firing for an isolated single-note
  illustration, not a real end-of-page note run); `sample-16-01` is missing its trailing print-
  page-number field (`#,-`) and has the same extraneous separator line. Neither is part of this
  finding's own scope (F-156 is only about the missing mark).
- **Tests:** `Emboss/tests/demo_fixes.test.mjs` (`describe('F-156 ...')`) — the finding's own
  repro, BANA Example 16-1 against the real liblouis translator, the numbered-mark case, the
  multi-paragraph opening-paragraph-only case, the already-literal-mark no-double-mark
  regression guard, and `formatBlock`/`traceBlock` parity for both the single- and multi-
  paragraph shapes. All of `Emboss/tests/notes_rules.test.mjs` and
  `Emboss/tests/note_references.test.mjs` (pre-existing note-formatting tests) still pass
  unchanged. `node Emboss/scripts/run-all-tests.mjs`: no new failures (see this task's own
  final report for the two pre-existing, unrelated section-18/21 gaps).

---

# Standards findings — pronunciation (BANA §20; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-157 — No syllable-aware line breaking

**Rules:** BANA 20.2.1c

> "A syllabified word that does not fit on one braille line must be divided at a syllable break."

**What Emboss does:** `wrapCells` (`Emboss/format/layout.mjs`) hard-chunks oversized words strictly by character count (`w.slice(0, chunkSize)`) when they exceed the page width, and breaks regular lines only at space boundaries. It has no awareness of syllable boundaries, middle dots, or hyphenation rules.

Reproduced in logic (no probe needed): `const words = braille.split(' ')` followed by unconditional slice when `w.length > width - indent`.

**What the standard requires:** When a word showing syllabification in print must be broken across a line, the break must occur at a syllable boundary (hyphen or middle dot), not an arbitrary character limit.

**Classification:** bug. Emboss does not support syllable-aware hyphenation or line-breaking.

**Test that would prove a fix:** A format test containing a long syllabified word (`syl·la·ble`) that does not fit on the current line breaks precisely at the middle dot.


## F-158 — No transcriber-defined modifier mechanism for diacritics

**Rules:** BANA 20.4b, 20.4c, 20.4.1b

> "A transcriber-defined modifier is used for print diacritic markings that have no braille equivalent."

**What Emboss does:** Emboss has no mechanism in its AST (`TYPEFORM` or otherwise) to represent transcriber-defined modifiers, and no mechanism to generate a Special Symbols page (precedents F-86 and F-88).

**What the standard requires:** Unrepresentable diacritics must use a transcriber-defined modifier listed on the Special Symbols page.

**Classification:** not done (feature absent). 

**Test that would prove a fix:** A format test where a custom diacritic is encoded with a transcriber-defined modifier and successfully translated and listed on the Special Symbols page.


## F-159 — Font attributes are not stripped from diacritic notation

**Rules:** BANA 20.4.2

> "When a syllable is marked with both stress signs and print emphasis (font attributes), the font attributes are ignored in the diacritic notation."

**What Emboss does:** Emboss applies all font attributes (like italics) through its AST `segments` directly to liblouis, regardless of the presence of diacritics. 

Reproduced in probe `test_diacritic_italic.mjs`:
`{ type: 'text', text: 'a\u0301', tf: louis.TYPEFORM.italic }` -> `.1^/A`

**What the standard requires:** The italic emphasis should have been stripped contextually because of the presence of the diacritic.

**Classification:** not done (feature absent). Emboss does not analyze text context to override stylistic markup.

**Test that would prove a fix:** A format test containing diacritics and italics translating to diacritics only.


## F-160 — Advanced diacritic grouping, stacking, and ligature rules not implemented

**Rules:** BANA 20.4.4, 20.4.5a, 20.4.5b, 20.4.6a, 20.4.6b

> "When a single diacritic modifier applies to more than one letter, the modified letters are enclosed in braille grouping indicators..."

**What Emboss does:** Emboss relies exclusively on `liblouis` for diacritics. `liblouis` lacks support for grouping indicators around multi-letter diacritics (like U+0361), falling back to hexadecimal translation (`A'\X0361';B`). `liblouis` also lacks support for advanced diacritic stacking logic on ligatures.

**What the standard requires:** Proper UEB grouping indicators for multi-letter diacritics, and correct sequential application of multiple diacritics.

**Classification:** not done (feature absent). Upstream `liblouis` limitation not shimmed by Emboss.

**Test that would prove a fix:** A format test containing `a\u0361b` outputting valid UEB grouping indicators.


## F-161 — No dictionary-entry AST node for blank-cell spacing

**Rules:** BANA 20.6.1c

> "When the main entry word is followed by punctuation... one blank cell separates it (including any respelling and pronunciation) from the definition segment."

**What Emboss does:** Emboss has no `<dictionary-entry>` or similar AST node. Reference entries are transcribed as generic paragraphs or lists, so exact cell spacing between the main entry word and definition cannot be algorithmically enforced.

**What the standard requires:** A forced one-cell blank space separating the entry word from the definition.

**Classification:** not done (feature absent).

**Test that would prove a fix:** A dictionary entry AST block outputting a strict 1-cell space even if the source text contains different whitespace.


## F-162 — No pronunciation-key or summary-key AST node / formatting

**Rules:** BANA 20.7.3a, 20.7.3b, 20.7.4c, 20.7.4d, 20.7.5a, 20.7.6a, 20.7.6c

> "Pronunciation keys are inserted before the alphabetic reference material, regardless of where they are placed in print."

**What Emboss does:** Emboss has no semantic AST node for pronunciation keys or summary keys. It cannot reorder blocks (F-155), contextually omit headings, automatically inject dot locators, or omit summary keys when a pronunciation key is present.

**What the standard requires:** Context-aware placement, structural reordering, and specific prefixing/omission rules for pronunciation keys.

**Classification:** not done (feature absent).

**Test that would prove a fix:** A document containing a pronunciation key at the end, which Emboss automatically reorders to the front of the volume.

---

# Standards findings — Transcriber's Notes (BANA §3; §3 gold reconciliation, 17 Sep 2026)

## F-163 — A transcriber's note block has no awareness of its own surrounding context: no contextual margin for a short embedded note, and no blank-line adjacency rules

**Rules:** BANA 3.2.1c ("Do not insert blank lines before or after a transcriber's note
unless required by other formats"), 3.2.3 ("An embedded transcriber's note is seven words
or fewer and may be shown within the text... or standing alone, e.g., used as a heading").

**What Emboss does:** `formatTranscriberNote` (`Emboss/format/document.mjs:819-826`) always
wraps a `note` block's content at BANA's fixed `tnMargins` (`document.mjs:793`: `first:6,
runover:4`, i.e. cell-7/cell-5) and never emits a blank line of its own before or after —
correct for an ordinary "standard" note (3.2.2), but a `note` block has no way to express
either "I am a short, ≤7-word EMBEDDED note (3.2.3) sitting among already-differently-margined
content, so I should take THAT margin instead" or "I need a blank line before/after me because
of what precedes/follows, not because of my own rule." Reproduced directly against this
reconciliation's gold data (`Emboss/tests/gold/bana-formats-2016/section-3/`,
`gold-run.mjs --section section-3`):

1. **No contextual margin for an embedded note.** `sample-3-01`'s two one-word embedded notes
   ("Term", "Definition", 3.2.3, standing alone as column headings inside a matching-exercise
   excerpt whose own heading/attribution content sits at a 4-cell margin) are printed in the
   book's own gold braille at that SAME 4-cell margin (`    @.<,T]M@.>`) — but
   `formatTranscriberNote`'s fixed 6-cell margin gives `      @.<,T]M@.>` instead. There is no
   parameter or contextual signal `formatTranscriberNote` can consume to use a margin other
   than the hard-coded 6/4.
2. **No blank-line suppression between a note and a following list.** The same two
   `sample-3-01` notes are immediately followed, with NO blank line, by the list of matching-
   exercise items each one introduces; Emboss's list formatter (`formatList`, its default
   "spaced" house style) unconditionally opens a list with a leading blank line, and nothing
   in `document.mjs`'s block-adjacency logic (the "connected headings" `HEADING_JOIN_TIERS`
   mechanism cited elsewhere in this file covers heading-to-heading and heading-to-list
   adjacency, not note-to-list) suppresses it for a note used as the list's own heading.
3. **No blank-line insertion between an ordinary paragraph and a following note where one is
   needed.** `example-3-4`'s closing dialogue line ("Third Plebeian. Let him be Caesar.") is
   followed, WITH a blank line, by the "Text continues on page 834." continuation note
   (BANA 3.3.3) in the book's own gold braille — `formatTranscriberNote` never emits a leading
   blank of its own (correctly, per 3.2.1c, for the ordinary case), so nothing supplies this
   one either. (`example-3-3`'s own paragraph-then-note transition, by contrast, correctly has
   NO blank line — so this is not simply "always add a blank before a note"; the source shows
   both behaviours depending on context this reconciliation did not fully characterise.)

**Classification:** not done (feature/context-awareness absent) for points 1 and 2; point 3 is
recorded as an open, only partially characterised gap — the CONDITION under which a blank
line is needed before a note is not yet understood well enough from this section's own nine
worked examples alone to state as a rule.

**Test that would prove a fix:** a document with a matching-exercise-style excerpt (a 4-cell
attribution/heading block, an embedded one-word note used as a column heading, then a list)
formats the note at the SAME 4-cell margin as its surrounding content, with no blank line
between the note and the list that follows it (`sample-3-01`'s own gold status improves).

---

---

# Standards findings — transcriber's notes (BANA §3; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-164 — Multi-paragraph transcriber's notes are flattened into a single paragraph

**Rules:** BANA 3.2.1b

> “This note may contain multiple notes and paragraphs before it is closed.” (BANA 3.2.1b)

**What Emboss does:** `pushTextOnly` (`Emboss/input/parse.mjs:3385`) processes `<prodnote>` tags by extracting only the text nodes (`getCleanText`) and concatenating them. Paragraph boundaries (`<p>`) inside the `<prodnote>` are destroyed and replaced by a single space, flattening the multi-paragraph note into a single `text` string for the resulting `note` block.

Reproduced (probe `out/probes/probe-3.mjs`):

```xml
<prodnote><p>Paragraph 1.</p><p>Paragraph 2.</p></prodnote>
```
parses to
```json
[
  {
    "type": "note",
    "text": "Paragraph 1. Paragraph 2."
  }
]
```

**Classification:** bug

**Test that would prove a fix:** A format test where a `<prodnote>` with two `<p>` tags is parsed into a note block containing multiple paragraphs, and rendered with the first paragraph in 7-5 margins and the second paragraph in 5-5 (or 5-3 per BANA 16.5.1d) margins.

## F-165 — Embedded (inline) transcriber's notes are impossible; all notes become blocks

**Rules:** BANA 3.1.4, BANA 3.2.3

> “Transcriber’s notes consisting of seven words or fewer are embedded in the text.” (BANA 3.1.4)
> “An embedded transcriber’s note is seven words or fewer and may be shown within the text...” (BANA 3.2.3)

**What Emboss does:** `BLOCK_TAGS` (`Emboss/input/parse.mjs:1469`) includes `prodnote`. As a result, a `<prodnote>` embedded within a paragraph forces a block split. Emboss then formats the short transcriber's note as a standalone 7-5 block (`formatTranscriberNote` in `Emboss/format/document.mjs`), rather than embedding it inline within the surrounding text.

**Classification:** not done (feature absent)

**Test that would prove a fix:** A format test where a `<prodnote>` with 3 words inside a `<p>` is parsed as an inline segment (`inlineSegments`) and formatted sequentially within the paragraph, surrounded by `@.<` and `@.>`.

## F-166 — No mechanism to format a 1-3 list of symbols/abbreviations

**Rules:** BANA 3.3.2

> “Use 1-3 margins for identifications of two or more abbreviations or symbols, preceded and followed by a blank line.” (BANA 3.3.2)

**What Emboss does:** Emboss has no style or component capable of rendering a transcriber's note as a 1-3 list surrounded by blank lines with `@.>` at the end of the last item. Transcriber's notes (`<prodnote>`) are strictly formatted as 7-5 blocks (`Emboss/format/styles.mjs:223`), and regular lists do not receive transcriber note indicators.

**Classification:** not done (feature absent)

**Test that would prove a fix:** A format test where a specifically tagged list of symbols is formatted in 1-3 margins, surrounded by blank lines, and enclosed in `@.<` and `@.>` indicators.

## F-167 — No Transcriber's Notes or Special Symbols page generation

**Rules:** BANA 3.3.1, BANA 3.4.1, BANA 3.4.2

> “List the technical symbols on the Special Symbols page.” (BANA 3.4.2)
> “Include a comment on the Transcriber’s Notes page...” (BANA 3.4.1)

**What Emboss does:** Emboss has no mechanism to auto-generate a Special Symbols page or a Transcriber's Notes page. (This is a restatement of the existing gap F-158 and the note in `style-specification.md`).

**Classification:** not done (feature absent)

**Test that would prove a fix:** A format test where a document containing technical notation automatically produces a Transcriber's Notes page and Special Symbols page in the front matter.

---

# Standards findings — illustrative materials (BANA §6; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-168 — Source citations and copyright info within `imggroup` are lost

**Rules:** BANA 6.2.1a, 6.2.2c

> "Any associated copyright information that may appear alongside the image should be included in a new paragraph after the completion of the caption." (BANA 6.2.1a)
> "When an illustration has a source citation, place it immediately following the caption using 7-5 margins. If a description of the illustration is required, begin the source citation on the line following the description." (BANA 6.2.2c)

**What Emboss does:** `parseImgGroup` (`Emboss/input/parse.mjs`, line 1693) only parses `img`, `image`, `caption`, `prodnote`, and page number tags. It explicitly ignores any other elements in an `<imggroup>`, such as `<cite>`, completely losing source citations. If a transcriber attempts to work around this by placing the citation or copyright inside `<caption>` (e.g., `<caption><p>Caption</p><p>Copyright</p></caption>`), `pushTextOnly` flattens the paragraphs into a single space-separated string, preventing the copyright from appearing in a "new paragraph" as required.

Reproduced in `out/probes/probe-6.mjs` and `out/probes/probe-6c.mjs`:

```json
[
  {
    "type": "graphic",
    "src": "foo.jpg",
    "alt": "",
    "caption": "This is the caption. Copyright info."
  }
]
```

**What the standard requires:** Source citations and copyright information must be preserved and rendered separately from the caption (e.g. after the description, or as a new paragraph).

**Classification:** bug / not done (feature absent)

**Test that would prove a fix:** `Emboss/tests/parse-imggroup-cite.test.mjs` parsing `<imggroup><img><caption>...</caption><prodnote>...</prodnote><cite>...</cite></imggroup>` into a model that preserves the citation block.


## F-169 — Missing specialized format support for forms

**Rules:** BANA 6.7.3b, 6.7.3g

> "Use a 1-3 margin for each form item." (BANA 6.7.3b)
> "Precede a sample response with the sample response symbol..." (BANA 6.7.3g)

**What Emboss does:** Emboss processes DTBook markup which lacks a semantic `<form>` or `<form-item>` tag, and Emboss implements no specific list variation to enforce the "sample response symbol". Form items must be manually mocked by transcribers using ordinary lists (`<list type="pl">`) and manually inserted symbols.

**What the standard requires:** Specialized structural formatting for forms (1-3 margins specifically for forms) and auto-insertion of the sample response symbol where required.

**Classification:** not done (feature absent)

**Test that would prove a fix:** `Emboss/tests/format-form.test.mjs` successfully translating a form block with a sample response into a 1-3 formatted item preceded by a sample response symbol.


## F-170 — Missing specialized format support for timelines and screenshots

**Rules:** BANA 6.10.1a, 6.12.1a

> "Begin a timeline on a new braille page..." (BANA 6.10.1a)
> "Enclose all screenshots in a box." (BANA 6.12.1a)

**What Emboss does:** Emboss does not provide a semantic mechanism for encoding a `timeline` block (to force a new page) or a `screenshot` block (to automatically apply BANA box lines). Transcribers must manually insert page breaks and box lines using standard block types.

**What the standard requires:** Automatic structural handling for timelines (beginning on a new page) and screenshots (enclosing within box lines).

**Classification:** not done (feature absent)

**Test that would prove a fix:** `Emboss/tests/format-timeline-screenshot.test.mjs` translating a `timeline` block to ensure it starts on a new page, and a `screenshot` block to ensure it is boxed.


## F-171 — Missing specialized format support for slide presentations

**Rules:** BANA 6.13.1a, 6.13.1d

> "Each slide number is treated as the print page number." (BANA 6.13.1a)
> "If speaker’s notes are included, use 7-5 margins. Begin a note with the identifier “Note,” enclosed in transcriber’s note indicators." (BANA 6.13.1d)

**What Emboss does:** Emboss lacks semantic elements for `<slide>` or speaker notes. Therefore, slide numbers are not automatically mapped to the print page change indicator, and speaker notes are not automatically prefixed with "Note," in transcriber's note indicators using 7-5 margins.

**What the standard requires:** Slide numbers act as print pages, and speaker notes are automatically styled with the specific "Note," identifier.

**Classification:** not done (feature absent)

**Test that would prove a fix:** `Emboss/tests/format-slides.test.mjs` translating a `slide` block containing a number and a speaker note into a print page indicator and a 7-5 note starting with "Note,".

---

# Standards findings — sidebars (BANA §12; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-172 — Sidebars inside a Table of Contents incorrectly boxed and/or dropped

**Rules:** BANA 12.3.1c

> "Exception: Follow Formats, §2.10.2i, Table of Contents guidelines when sidebars appear within the table of contents." (BANA 12.3.1c)

**What Emboss does:** The parser (`parse.mjs`, `TOC_EXCLUDE`) explicitly ignores `<sidebar>` elements when extracting items from a `<list class="toc">`. If a sidebar is parsed successfully (e.g. as a sibling of the list), it is mapped to a `type: 'box'` object and `formatBox` unconditionally applies 7/G box lines to it, regardless of its surrounding context.

**What the standard requires:** A sidebar inside a Table of Contents must follow TOC formatting guidelines (BANA 2.10.2i), which dictates that they are formatted as nested lists and that box lines are *not* used.

**Classification:** bug / not done

**Test that would prove a fix:** A test proving that a `<sidebar>` nested inside or directly adjacent to a `<list class="toc">` is rendered without top and bottom box lines.

---

# Standards findings — exercise material (BANA §10; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-173: Missing page-breaking logic to keep exercises and answer choices together

BANA Formats §10.1.7 and §10.3.1 strictly require that exercise items, their answer choices, and their directions remain on the same page whenever possible, specifying an order of preference for how they may be broken across pages when they do not fit.

Emboss lacks this page-breaking logic. `page.mjs` and `spooler.mjs` do not implement block-level "keep together" semantics for `list class="bai-exercise"`.

## F-174: Missing specific formatting support for exercise directions and examples

BANA Formats §10.3 and §10.6 prescribe specific formatting (5-3 margins or 7-3 for multiple paragraphs) for exercise directions. Similarly, §10.8 dictates spacing and margin requirements for exercise examples. 

Emboss does not provide `directions` or `example` styles for exercises (only stage directions exist in `styles.mjs`). Consequently, these elements fall back to standard paragraph margins, failing the required indention patterns.

## F-175: Missing logic to emit a blank line before exercise material after page change indicators

BANA Formats §10.2.2 requires emitting a blank line before exercise material following a page change indicator. Emboss does not contextually track page change indicators to conditionally inject blank lines before exercise lists.

## F-176: Displayed text inside exercises lacks adjusted left margin

BANA Formats §10.7.1 requires displayed text within exercises to have an adjusted left margin (2 cells to the right of the runover position of the preceding text). 

Emboss does not adjust the left margin for nested `list` or `para` blocks based on the runover position of the parent `exercise`.

**Reproduction (probe-10-displayed.mjs):**

```javascript
import { formatDocument } from '../../repo/Emboss/format/document.mjs';
const doc = {
  blocks: [
    {
      type: 'list',
      kind: 'exercise',
      maxLevel: 0,
      items: [
        { level: 0, text: '1. Which of the following is correct?' }
      ]
    },
    {
      type: 'list',
      kind: 'list',
      maxLevel: 0,
      items: [
        { level: 0, text: 'This is displayed text.' }
      ]
    }
  ]
};
const o = { mode: 'bana', width: 40, translate: (t) => t };
const p = formatDocument(doc, o);
console.log(p[0]);
```
**Output:**
```
1. Which of the following is correct?

This is displayed text.
```
*Notice "This is displayed text." starts in cell 1 (1-3 margin), instead of cell 5 (2 cells right of the exercise's runover cell 3).*

---

# Standards findings — plays, cartoons, and graphic novels (BANA §14; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-177 — Missing support for shared verse lines

**Rules:** B004 K Good practice 5

> "If two or more speakers share a verse line, this should be indicated by leaving 3 blank cells after the name of the second or subsequent speaker."

**What Emboss does:** Emboss has no semantic support or logic to insert 3 blank cells when multiple speakers share a verse line in UKAAF.

**What the standard requires:** 3 blank cells must separate the speakers sharing a verse line.

**Classification:** feature absent / not done

**Test that would prove a fix:** A `play-speaker` block (or similar) parsed with multiple shared speakers outputting exactly 3 blank cells between them.

---

## F-178 — Emphasis on fully capitalized speaker names retained

**Rules:** BANA 14.1.4

> "If print uses both full capitalization and emphasis to show speaker names, retain the capitalization and omit the emphasis."

**What Emboss does:** `parse.mjs` extracts a speaker and their dialogue into a single `<p class="play-speaker">` block. The emphasis tags are stored in the block's `segments`, which `formatPlay` unconditionally forwards to `segmentsToBraille`, rendering all emphasis markers.

**What the standard requires:** The formatter should strip the emphasis markers specifically from the speaker name if it is fully capitalized, while leaving emphasis in the dialogue intact.

**Classification:** bug / not done

**Test that would prove a fix:** A `<p class="play-speaker"><em>HAMLET.</em> To be...</p>` rendered without the italic indicators around "HAMLET".

---

## F-179 — Extended blank space after speaker name not supported

**Rules:** BANA 14.1.7, 14.6.2a

> "When there is an extended blank space between the speaker’s name and the first word of the speech, this space is indicated by three blank cells in braille."

**What Emboss does:** Emboss normalizes all whitespace and has no structural block/attribute to signify an "extended blank space" that maps to 3 blank cells.

**What the standard requires:** An extended blank space separating the speaker from dialogue must be transcribed as 3 blank cells.

**Classification:** feature absent / not done

**Test that would prove a fix:** A semantic mechanism to request the extended blank space resulting in 3 blank cells.

---

## F-180 — Verse play first line uses incorrect margins

**Rules:** BANA 14.6.1a

> "a. Use 1-5 margins for the first line of dialogue [in verse plays]."

**What Emboss does:** `formatPlay` handles verse plays by delegating to `nestedMargins('poetry')`. For a single-level poem (level 0), this returns `first: 0, runover: 2`, resulting in 1-3 margins instead of 1-5.

**What the standard requires:** The first line of dialogue in a verse play must begin in cell 1 with runovers in cell 5 (1-5 margins).

**Classification:** bug / not done

**Test that would prove a fix:** A `<p class="play-verse">` block rendered with a 4-space indent (cell 5) on its wrapped runover lines.

---

# Standards findings — line-numbered and line-lettered text (BANA §15; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-181 — Line numbers in prose plays are dropped entirely

**Rules:** BANA 15.8.1b, 15.8.1c

> "Place line numbers... at the right margin of the braille line."

**What Emboss does:** `formatPlay` (which processes prose plays) relies on `wrapCells` instead of `wrapNumbered`, and when it calls `segmentsToBraille`, it defaults the `lineNumbers` parameter to `false`. As a result, `{ type: 'linenum' }` segments inside `<p class="play-speaker">` are silently discarded and do not appear in the braille output at all.

**What the standard requires:** Line numbers in prose plays must be formatted at the right margin.

**Classification:** bug / not done

**Test that would prove a fix:** A `<p class="play-speaker">` with a `<linenum>` child formatting the play speaker/dialogue text with the line number appearing correctly right-justified.

---

## F-182 — Line numbers and letters in poetry appear at the left margin

**Rules:** BANA 15.7.2c, 15.7.2d, 15.7.2g, 15.7.3c

> "Place each letter... at the right margin of the braille line..." (15.7.2d)
> "Place line numbers... at the right margin." (15.7.3c)

**What Emboss does:** In `parse.mjs`, the `parsePoem` function loops over child nodes. When it encounters `<linenum>`, it extracts the text and explicitly prepends it to the start of the poetry line (`t = numPrefix + t`). This causes verse line numbers and line-letters to be formatted strictly on the left margin, destroying their semantic identity as line numbers and preventing `wrapNumbered` from justifying them to the right.

**What the standard requires:** Verse line numbers and rhyme scheme letters must be placed at the right margin.

**Classification:** bug / not done

**Test that would prove a fix:** A `<poem>` element containing `<linenum>` elements outputting the line numbers/letters right-justified on the braille page.

---

# Standards findings — spelling lists and activities (BANA §17; assessed 17 Sep 2026 by Gemini Pro, merged in-session)

## F-183 — Definition lists explicitly inject a colon regardless of spelling activity formatting rules

**Rules:** BANA 17.6.1b, 17.6.1c

> "Leave one blank cell between an entry word and its definition when the entry word is followed by punctuation..." (17.6.1b)
> "Leave two blank cells between entries and definitions when the entry words are phrases..." (17.6.1c)

**What Emboss does:** Emboss processes all `<dl>` elements as standard glossaries (`formatGlossary`). When it builds the segment list in `glossarySegments(it)`, it contains the logic `const sep = /[:—-]$/.test(term) ? ' ' : ': ';`. It unconditionally injects a colon separator (and a single space) between the term and definition if the term does not end with one. It provides no mechanism to omit the colon and apply the varied blank cell spacing required by spelling activity definition lists.

**What the standard requires:** Definition lists used in spelling activities must be formatted using one or two blank cells separating the entry and definition, without adding a colon.

**Classification:** bug / not done

**Test that would prove a fix:** A `<dl class="spelling-def">` (or similar) where `cat` and `A small domesticated...` are separated only by blank cells, with no colon automatically injected.

---

# Standards findings — bibliographies (BANA §22) (assessed 17 Sep 2026)

## F-184 — The annotated-bibliography margin split (1-5 / 3-5) only appears when the print's own bibliographic-information/annotation boundary happens to be authored as a nested list item; nothing in Emboss's data model records that boundary

**Rules:** BANA 22.3.1 (partial), 22.3.2 (partial); illustrated by BANA Example 22-4 (partial)

> "Annotated bibliographies have descriptive information as well as bibliographic
> information. List the bibliographic information using 1-5 margins and the descriptive
> information using 3-5 margins." (BANA 22.3.1)
>
> "Use margins of 1-5, 3-5 for mixed bibliographies that include both annotated and
> unannotated entries." (BANA 22.3.2)

**What Emboss does:** there is no `bibliography`/`annotation` concept anywhere in Emboss —
a bibliography can only reach the formatter as an ordinary `<list type="pl">` block (parsed
by `parseSingleList`, `Emboss/input/parse.mjs:2014-2077`, which assigns `detectedKind =
'plain'` for `type="pl"` and no other signal). Its margins come from the fully generic
`nestedMargins(kind, level, maxLevel, mode, listStyle)` (`Emboss/format/document.mjs:132`),
called once per item from `formatList` (`document.mjs:515-552`) with `maxLevel` computed by
`listMaxLevel` (`document.mjs:420-424`) by scanning **every item of the same list block**. In
BANA mode this reduces to `{ first: level*2, runover: maxLevel*2+2 }` for every list kind
(the kind-specific branches only affect UKAAF).

This formula happens to produce **exactly** BANA's two margin schemes:
- a single-level list (every item at level 0, `maxLevel=0`) → `first:0, runover:2` = cell
  1 / cell 3 (22.2.1's 1-3 — see the "done" rows below).
- a two-level list (a level-0 item followed by a level-1 item, `maxLevel=1`) → level 0:
  `first:0, runover:4` = cell 1 / cell 5; level 1: `first:2, runover:4` = cell 3 / cell 5 —
  **exactly** 22.3.1's "1-5 bibliographic, 3-5 descriptive".

Probe (`probe22.mjs`, real liblouis, BANA 40×25) confirms this for an entry built as
`<list type="pl"><li>L'Engle... Young Readers.<list type="pl"><li>The Newbery Medal
winner...</li></list></li></list>` (level 0 = citation, level 1 = annotation, one nested
`<li>`):
```
",L',5GLE1 ,MADELE9E \"<#AIFB\">4 ,A"
"    ,WR9KLE 9 ,\"T4 ,NEW ,YORK3 ,BANTAM"
"    ,D\\BLE\"D ,DELL ,BOOKS = ,\"Y ,R1D]S4"
"  ,! ,NEWB]Y ,M$AL W9N] IS A MIXTURE ("
"    SCI;E FIC;N & MY/ICISM4"
```
— citation runs cell 1/cell 5 (0 / 4 leading spaces), annotation cell 3/cell 5 (2 / 4 leading
spaces): the exact scheme BANA Example 22-4 illustrates.

But the SAME probe, given the identical text with the annotation left as continuous prose in
the **same** `<li>` as the citation (no nested `<list>` at all — arguably the more natural way
a transcriber or a DTBook-conversion pipeline would encode one continuous paragraph of print,
since DTBook has no "annotation" element and nothing tells an author to split it into a
sub-list), collapses to a single flat item and loses the split entirely:
```
",L',5GLE1 ,MADELE9E \"<#AIFB\">4 ,A"
"  ,WR9KLE 9 ,\"T4 ,NEW ,YORK3 ,BANTAM"
"  ,D\\BLE\"D ,DELL ,BOOKS = ,\"Y ,R1D]S4 ,!"
"  ,NEWB]Y ,M$AL W9N] IS A MIXTURE ("
"  SCI;E FIC;N & MY/ICISM4 ,TWO *N & A FR"
```
— every runover line (citation's own runover AND the whole annotation) sits at cell 3, not
the required cell 5 for the annotation; the citation/annotation boundary is invisible to
Emboss (`nestedMargins`/`listMaxLevel` never asked to find it), so 22.3.1's split simply does
not happen.

22.3.2 (mixed annotated/unannotated bibliographies) compounds this with a second,
independent structure-dependency. `listMaxLevel` scans **one list block**, so whether an
*unannotated* entry correctly inherits the elevated 1-5/3-5 scheme (22.3.2's requirement)
depends on whether it shares that block with an annotated one. Probe (`probe22c.mjs`)
confirms both directions: a plain entry ("Smith, John…") placed in the **same** `<list>`
block as an annotated entry is correctly promoted to cell-5 runover (`"    ,PRESS1
#BJJA4"`, 4 leading spaces) — 22.3.2 satisfied, purely as a side effect of sharing
`maxLevel` with its neighbour; the identical plain entry placed in its **own**, separate
`<list>` block (e.g. because each entry became its own `<list>` element, which is at least
as plausible an authoring/export shape as one giant list) stays at cell-3 runover
(`"  ,PRESS1 #BJJA4"`, 2 leading spaces) — 22.3.2 violated, because that block's own
`maxLevel` is 0 and knows nothing about the annotated entry elsewhere in the document.

**What the standard requires:** every annotated entry's bibliographic line(s) at 1-5, its
descriptive/annotation line(s) at 3-5; when a bibliography mixes annotated and unannotated
entries, every entry (annotated or not) uses that same 1-5/3-5 scheme.

**Classification:** **standard unclear as applied to Emboss's data model** — the same shape
of gap as `standards-findings.md` F-4 (table caption vs. heading): BANA's own text is not
ambiguous, but DTBook/NIMAS has no element or attribute recording (a) where a bibliography
entry's citation ends and its annotation begins, or (b) that several `<list>` blocks
together form one bibliography that must share a single margin decision. The nested-list
mechanism that *would* produce the right output already exists and needs no new formatting
code — what's missing is a signal that tells the parser "this text is the annotation" and
"these blocks are one bibliography," which nothing in Emboss's model, or in DTBook itself,
currently carries. See `questions-22.md` Q-57.

**Test that would prove a fix:** once a signal exists (e.g. a `class="bai-biblio-note"` on
the annotation, or a wrapping `<div class="bibliography">`/`<list class="bai-bibliography">`
around the whole set of entries so a single `maxLevel` can be computed across it), a test
parsing a DTBook fragment with that markup asserts (1) the citation renders 1-5, the
annotation 3-5, even when both are one `<li>`'s continuous text; and (2) an unannotated entry
elsewhere in the same marked bibliography also renders at 1-5/3-5, not 1-3.

**Status: not fixed.** No code or tests were changed producing this finding.

---

## F-185 — No foreign-language braille exists at all: a bibliography "entirely in a foreign language" cannot be produced in its own alphabet, and nothing detects that it should be

**Rule:** BANA 22.2.4

> "Transcribe bibliographies that are entirely in a foreign language in uncontracted braille
> using the appropriate foreign alphabet symbols." (BANA 22.2.4)

**What Emboss does:** `engine/louis.mjs`'s `TABLES` export (`Emboss/engine/louis.mjs:13-17`)
wires up exactly three tables — `uebG2`, `uebG1`, `uebG2_unicode` — **all English UEB**.
`Emboss/liblouis/tables/` ships roughly 475 table files including dedicated tables for many
other languages (French, Spanish, German, Greek, Cyrillic-script languages, etc., by their
usual liblouis filenames), but nothing in Emboss's own code (`engine/louis.mjs`,
`engine/louis-browser.mjs`, `format/document.mjs`, `input/parse.mjs`) ever references any of
them — a grep for "foreign" across `format/`/`input/` finds only an unrelated MathML
"foreign content" comment (`format/cell-dom.mjs:42`), and a grep for `xml:lang`
(`input/parse.mjs:1411`) shows the document's declared language is read once, for the
top-level `doc.lang` field, and never consulted by the formatter or translator to select a
different table or a translation mode.

Separately, Emboss does have a working generic "uncontracted" (grade-1) mechanism —
`segmentsToBraille` (`document.mjs:746-`) reads `o.translateG1`/`o.translateUncontracted` for
any segment marked `uncontracted:true`, which `parse.mjs` sets from a literal `<code>` tag or
a `class` containing "uncontracted"/"phonetic"/"ipa"/etc. (`input/parse.mjs:1965`) — built for
code blocks and IPA, not bibliographies, and requiring the source to mark the text explicitly
(there is no automatic "this whole bibliography is in French" detection anywhere).

Probe (`probe22b.mjs`, real liblouis, `translateG1` wired to `TABLES.uebG1`) shows both halves
of the gap directly:
- A French entry ("Camus, Albert. L'Étranger. Paris: Gallimard, 1942.") marked
  `class="uncontracted"` correctly comes out letter-for-letter with no UEB contractions
  (`;;;,CAMUS1 ,ALBERT4 ,L',^/ETRANGER4  ,PARIS3 ,GALLIMARD1 #AIDB4;'` — "ALBERT"/
  "GALLIMARD" spelled in full, not contracted with UEB's "er" sign) — this happens to be
  *readable* only because French uses the Latin alphabet and liblouis's UEB table has an
  escape convention for a few accented Latin letters; it is still **English/UEB** braille,
  not "the appropriate foreign alphabet symbols" of French braille (which assigns some
  letters/accents to different cells and has its own punctuation and contraction
  conventions BANA §22.2.4 does not ask Emboss to reproduce, but which this mechanism cannot
  reproduce either way, since only English UEB tables are wired in).
- The identical mechanism applied to a bibliography entirely in **Greek** (no Latin letters
  at all) fails outright: every Greek letter outside the UEB table's charset is emitted as a
  literal, unreadable escape sequence embedded in the braille text itself, e.g.
  `";;;,.O.M'\\X03AE'.R.O.U1"` — `'\X03AE'` is liblouis's own undefined-character escape
  for U+03AE (η with tonos), the same fallback `engine/louis.mjs`'s own header comment
  describes for non-BMP characters (`"a 𝑥 b" -> "A '\XD835''\XDC65' ;B"`) — proving there is
  no path at all to a genuine non-Latin foreign alphabet.
- With **no** markup at all (the default a bibliography would get if a transcriber did not
  know to add `class="uncontracted"`), the same French entry translates with ordinary UEB
  Grade 2 contractions (`,L',^/ETRANG]4` — "]" is the UEB "er" contraction, inside a French
  word), which is simply wrong braille for French text, uncontracted or not.

**What the standard requires:** a print bibliography that is entirely in a foreign language
is transcribed uncontracted, in that language's own appropriate alphabet symbols — for any
language, not just accented-Latin ones — and this should follow automatically from the
bibliography being in that language, not require a transcriber to hand-mark every entry with
an unrelated "uncontracted"/"code" signal built for a different purpose.

**Classification:** **not built.** No part of this rule has real support: no language
detection, no language-specific braille table wired up (despite the underlying liblouis
distribution already carrying tables for many languages, unused), and the one applicable
generic mechanism (`uncontracted` segments) only coincidentally half-works for Latin-alphabet
languages when manually flagged. This is a genuine, currently-absent feature, not a
disputed reading of the rule.

**Test that would prove a fix:** (1) a `<list>`/entry carrying a language signal (e.g.
`xml:lang="fr"`) for text entirely in that language formats in that language's own
uncontracted braille table, chosen automatically, without any `class="uncontracted"`
workaround. (2) The same for a non-Latin-alphabet language (e.g. Greek or Russian), producing
real braille cells for every character, not an undefined-character escape. (3) A bibliography
with no foreign-language signal keeps ordinary UEB Grade 2 English contraction (unaffected by
this fix).

**Status: not fixed.** No code or tests were changed producing this finding. See
`questions-22.md` Q-58 for the scoping question (this is a nontrivial feature — full
foreign-language table support — not a small patch).

---

*(F-184 and F-185 above cover the partial/not-done rows of `standards-map.md`'s BANA §22
— Bibliographies. Every other rule of the section is either a bare heading/rationale
paragraph (not-applicable) or fully "done" via the pre-existing generic list/segment/
translation mechanisms described in each row's own Evidence: BANA 22.2.1 (1-3 margins),
22.2.2 (punctuation/font attributes via the shared segment+typeform pipeline), 22.2.3 (long
dash / "follow print for any other symbol", satisfied precisely because no special-case code
exists to get in the way of an ordinary character reaching the translator), and Worked
Examples 22-1/22-2/22-3 (reproduced with equivalent, not the exact original, print input,
since a worked example gives braille only — no print text is recoverable from it standalone).)*

---

# Standards findings — grammar (BANA §18) (assessed 17 Sep 2026)

## F-186 — No inline/embedded transcriber's-note mechanism; only a standalone note block exists

**Rules:** BANA 18.3.3c, 18.6.1b (also referenced by Sample 18-3, Example 18-5)

> “When isolated punctuation is emphasized with something other than italics, bold,
> underlining, or script, insert a transcriber’s note after the punctuation mark or
> applicable word to identify the print emphasis.” (BANA 18.3.3c)

> “Do not devise symbols to represent these signs. Enclose the name or a brief description of
> each print mark in an embedded transcriber’s note, followed by the meaning or function of
> the mark as stated in print.” (BANA 18.6.1b)

**What Emboss does:** the UEB transcriber's-note indicators `@.<` / `@.>` (`TN_OPEN`/
`TN_CLOSE`, `Emboss/format/document.mjs:18`) are only ever emitted by whole-block formatters —
`formatTranscriberNote` (document.mjs:819-826), the table/footnote TN helpers, and the
line-number note — each producing one standalone paragraph at a fixed margin pair (BANA 7-5,
`tnMargins`, document.mjs:793). Nothing inserts these indicators mid-segment, i.e. embedded
inline within a sentence immediately after one particular word or punctuation mark, which is
exactly what BANA 18.3.3c's Example 18-5 and 18.6.1b's Sample 18-3 both require.

Reproduced (`assess-18/probe.mjs` Probe D): typing the note's own indicator characters
literally into running text —

```
"I didn't think so, but it's @.<apostrophe is red@.> x."
```

— does **not** produce an embedded note. It mistranslates, because `@`, `.`, `<`, `>` are
just ordinary punctuation to the translator:

```
["  ,I DIDN'T ?9K S1 B X'S @A4@<APO/ROPHE","IS R$@A4@> ;X4",""]
```

**What the standard requires:** the note appears on the very same braille line as the word or
mark it explains, inline within the sentence (Example 18-5: `...s1 .7b t's @.<apo/rophe is
r$@.> x4.'`), not as a separate paragraph before or after it.

**Classification:** **gap (not a regression — a missing feature).** This blocks every rule
in §18 that requires an embedded, mid-sentence note (18.3.3c, 18.6.1b) and the worked
examples that illustrate them (Example 18-5, Sample 18-3), and plausibly recurs anywhere else
in Formats that calls for the same "embedded transcriber's note" pattern (BANA's own term for
it, distinct from a standalone TN paragraph).

**Test that would prove a fix:** a paragraph/segment API that allows a `note` fragment to be
inserted between two ordinary text segments within the same block, rendering `@.<...@.>`
inline at the correct point without disturbing the rest of the line's wrapping; a test
reproducing Example 18-5 exactly and asserting the note appears on the same output line as
`x4.'`.

**Status: not done.**

---

## F-187 — No "braille grouping indicator" (UEB's dedicated enclosure symbol) exists anywhere

**Rules:** BANA 18.6.2e, 18.6.5b (also 16.11.1g, already flagged separately by
standards-findings.md F-119)

> “Phrases should be enclosed in braille grouping indicators. Explain this usage in a
> transcriber’s note.” (BANA 18.6.2e)

> “Enclose the insertion in braille grouping indicators. Note: the grouping indicators will
> likely require grade 1 indicators preceding them.” (BANA 18.6.5b)

**What Emboss does:** UEB's generic "braille grouping indicator" is a dedicated symbol pair
(rendered in the book's own braille-ASCII as `;<` / `;>`, e.g. Example 18-8's
`@5;<betwe5 ,fr.e & ,5gl&;>`, and Sample 16-12/16-13's `.=<` / `.=>` variant) — distinct from
ordinary print-style enclosure punctuation (parentheses, square brackets, etc.), which *does*
translate correctly on its own (see F-S18 evidence for BANA 18.5.3a/18.6.4b below). Grep of
`Emboss/format/cell-markup.mjs`, `Emboss/format/text-style.mjs` and `Emboss/format/
document.mjs` for "grouping", `;<`, `;>`, `.=<`, `.=>` finds no hits anywhere in the
codebase. `standards-findings.md` F-119 already documented this specifically for §16.11
("No braille-grouping-indicator (.=< / .=>) or keyed-marginal-label construct exists
anywhere in parse.mjs/document.mjs/editor.mjs") — this finding confirms the same absence
recurs independently in §18 (18.6.2e, 18.6.5b), which needs the plain `;<`/`;>` form rather
than F-119's `.=<`/`.=>` "mention" form.

By contrast, ordinary print-style enclosure characters translate correctly with zero
Emboss-specific code — live-verified (`assess-18/probe.mjs` Probe I):

```
"He has (green) hair."  ->  ["  ,HE HAS \"<GRE5\"> HAIR4"]
"He has [green] hair."  ->  ["  ,HE HAS .<GRE5.> HAIR4"]
```

— these are the standard UEB round/square-bracket punctuation signs, not the grouping
indicator the rules above specifically ask for.

**What the standard requires:** a specific UEB "braille grouping indicator" symbol pair,
generated on demand around arbitrary spans of text.

**Classification:** **gap.** Confirmed to affect at least four rules across two sections
(16.11.1g, 18.6.2e, 18.6.5b) plus everything that depends on them (18.6.2b/c/d, Sample 18-4).

**Test that would prove a fix:** a helper that wraps a translated span in the UEB grouping
indicator (with the grade-1 indicator prepended when the wrapped content needs it, per
18.6.5b's own note), usable both as a standalone block wrapper and inline within a segment
run (which also needs F-186's inline-insertion capability to reach mid-sentence uses).

**Status: not done.**

---

## F-188 — Only one transcriber-defined symbol exists in the whole codebase, hardcoded to one use

**Rules:** BANA 18.2.2b (sample only), 18.6.3a, 18.7.1, 18.7.3 (also referenced by Special
Symbols page mentions throughout §18: 18.4.1c, 18.7.2, 18.7.3, 18.8.2, 18.8.3a, 18.6.5d)

> “Use a transcriber-defined typeform indicator to show the crossed-out word(s). (See UEB,
> §9.5, Transcriber-Defined Typeform Indicators.)” (BANA 18.6.3a)

> “Linear diagramming shows sentence structure, using font attributes to distinguish between
> parts of speech. Use transcriber-defined typeform indicators if needed (as seen for the
> double underlining in the example below).” (BANA 18.7.1)

> “Use a transcriber-defined typeform indicator before words enclosed in shapes, e.g.,
> circles, boxes, etc.” (BANA 18.7.3)

**What Emboss does:** `TYPEFORM` (`Emboss/engine/louis.mjs:33`, `Emboss/engine/
louis-browser.mjs:89`) only has three bits — `{italic: 1, underline: 2, bold: 4}` — matched
by `TF_ITALIC`/`TF_UNDERLINE`/`TF_BOLD` in `Emboss/format/cell-markup.mjs:15`. UEB §9.5's
"transcriber-defined typeform indicator" is a fundamentally different thing: a numbered or
lettered custom mark the transcriber invents and explains, independent of italic/underline/
bold. The only transcriber-defined symbol anywhere in the codebase is a single hardcoded
constant, `TD_SYMBOL_1` (`;?`, `document.mjs:94`), used for exactly one purpose (the print
asterism `⁂` section-break indicator), with its own one-off explanatory-note flag
(`block.tdNote`, document.mjs:108-112, wired up only at the two asterism call sites,
document.mjs:3355 and 3494). There is no allocator that could mint a second, third, etc.
transcriber-defined mark, and no "Special Symbols" page block type at all (grep of
document.mjs/parse.mjs for "Special Symbols" finds nothing) — every one of §18's many
"list this on the Special Symbols page, or in a transcriber's note" instructions can only
ever fall back to the freeform `note` mechanism, one occurrence at a time.

A direct consequence: two of §18's most concrete worked examples cannot be reproduced even in
principle. Example 18-9 (BANA 18.7.1) distinguishes a sentence's subject/verb pair by
**single vs. double underlining** — Emboss has only one underline bit, so there is no way to
render a second, visually distinct underline style. Sample 18-5 (BANA 18.7.3) needs two
independent transcriber-defined marks (one for a circled word, one for a boxed word) — Emboss
has no way to produce even one beyond the pre-assigned asterism symbol, let alone two
user-chosen ones.

**What the standard requires:** an open-ended supply of transcriber-defined symbols the
transcriber can invent, assign, and explain per document, as needed.

**Classification:** **gap.** This is the single largest structural cause of "not done" status
across §18 — it blocks 18.6.3a, 18.7.1 (partially), 18.7.3, and every worked example that
uses more than the asterism's one pre-existing symbol (Example 18-2's `.=@#2`, Example 18-6's
`.=^#1`, Example 18-9, Sample 18-5).

**Test that would prove a fix:** a general "assign the next unused transcriber-defined
symbol" allocator (extending the existing single-purpose `TD_SYMBOL_1`/`tdNote` pattern to N
symbols), usable as a typeform (a document-wide id mapped to a chosen UEB indicator sequence)
and documented automatically via the existing `note`-before-first-use pattern; regression
tests reproducing Example 18-9's single/double underline distinction and Sample 18-5's two
shape marks.

**Status: not done.**

---

## F-189 — Sentence diagramming (§18.7 margins, §18.4 analogy symbols, §18.8 spatial arrows) has no layout support

**Rules:** BANA 18.4.1, 18.7.1 (margin half), 18.8.1, 18.8.2, 18.8.2a/b/c, 18.8.3a/b, 18.8.4
(also Examples 18-11 through 18-14, 18.3.4b)

> “Use 1-3 margins for each diagrammed sentence.” (BANA 18.7.1)

> “Precede and follow each arrow/sentence pair by blank lines.” (BANA 18.8.1)

> “Use line mode to represent the arrow shaft. The line should end above the first letter of
> the word from which the arrow points.” (BANA 18.8.3b)

**What Emboss does:** `formatBlock`'s dispatcher (`document.mjs:2056-2106`) has no case for a
diagram, arrow, or analogy-symbol block of any kind; grep of `document.mjs`/`parse.mjs`/
`nimas-export.mjs`/`text-style.mjs`/`editor.mjs` for "grammar", "diagram", "analogy",
"arrow", "line mode", "16.2.3" finds nothing relevant (the sole hit, an `IDENTIFIED_RE` regex
matching the word "diagram" as an image-caption prefix, `document.mjs:1950`, is unrelated —
it is about figure/illustration captions, not sentence diagrams). Three distinct capabilities
are all simultaneously absent:

1. **A 1-3 margin for a plain diagrammed sentence.** `formatPara`'s non-quote branch
   (document.mjs:636-649) gives ordinary paragraphs 3-1 margins by default; the only paths
   that give 1-3 are `formatList` (live-verified, Probes J/K) and footnote continuations —
   neither is a "diagrammed sentence" block, so nothing currently produces 1-3 for one.
2. **UEB's dedicated BANA analogy sign** (`3`/`33` for "is to"/"as", §18.4.1) — a literal
   digit "3" typed as text would collide with an actual number; no dedicated symbol path
   exists.
3. **Spatial, column-aware placement of a symbol on the line above/below another line**,
   which every one of §18.8's arrow rules needs (an arrow must start above the first letter
   of a specific word on the sentence line below it, and a multi-shaft arrow's line-mode
   shaft must end above a different specific word). This is a genuinely two-dimensional
   layout requirement with no analogue anywhere else in the codebase that was found. That
   liblouis can independently translate a bare Unicode arrow character in ordinary running
   text is not evidence to the contrary — live-verified (`assess-18/probe.mjs` Probe G):
   `"Tom → did you submit your article?"` → `["  ,TOM ;\\O DID Y SUBMIT YR >TICLE8"]` —
   this only proves liblouis's UEB table has *a* arrow sign; nothing in Emboss places any
   symbol on a separate line aligned to a specific column of the line below it.

**What the standard requires:** §18.7's diagrammed sentences at 1-3 margins; §18.4.1's
analogy sign, non-breakable across a line, with blank cells around it; §18.8's arrows and
line-mode shafts spatially positioned above/below specific words of the sentence they
describe.

**Classification:** **gap.** All of §18.4.1, all of §18.8 (bar the pure-TN fallback of
18.8.2e), and half of §18.7.1 are blocked by this; it is the section's second major
structural cause of "not done" after F-188.

**Test that would prove a fix:** for (1), a `diagrammed-sentence` block type or a `margin`
override on `para` giving 1-3; for (2), a dedicated analogy-symbol segment type with its own
translation and no-break handling; for (3), a genuinely new two-line "annotation row above a
text row, column-aligned to specific words" primitive — plus reproductions of Examples
18-10 (margin), and 18-11/18-12a/18-12b/18-13/18-14 (arrows), diffed against the book's own
braille.

**Status: not done.**

---

## F-190 — A non-breaking space is silently normalised away; nothing keeps two words on one braille line

**Rules:** BANA 18.4.1b, 18.6.2d (same-line clause), 18.6.5a, 18.8.2c

> “Do not divide a word pair between lines.” (BANA 18.4.1b, analogy symbols)

> “Keep words or phrases between which an arrow shows a relationship on a single braille
> line.” (BANA 18.8.2c)

**What Emboss does:** `normalizeTextAndTypeform` (`Emboss/format/text-style.mjs`) explicitly
converts a non-breaking space (U+00A0) and several other Unicode space variants to an
ordinary, breakable ASCII space before wrapping ever sees the text — its own comment says
"Replaces non-standard spaces (NBSP...) with standard space." There is no other no-break
primitive for inline text anywhere in the wrapping code (`wrapCells`/`wrapBody`,
document.mjs) — the only "keep together" mechanism that exists at all is block-level
(`keepGroups`, used for table/list row-keeping, document.mjs), which operates on whole lines
of a block, not on two words within a running sentence.

Reproduced (`assess-18/probe.mjs` Probe M): a sentence with a NBSP deliberately placed between
two words, at a width chosen so the wrap boundary falls near it —

```js
`Twelve thirteen fourteen fifteen sixteen seventeen eighteen.`
```

still wraps as:

```
["  ,TWELVE ?IRTE5 F\\RTE5 FIFTE5","SIXTE5 SEV5TE5 EI<TE54"]
```

— "sixteen" and "seventeen" (deliberately NBSP-joined) land on two different lines anyway;
the NBSP provided no protection at all.

**What the standard requires:** two words joined by an analogy symbol, or connected by an
arrow's relationship, must never be split across a line break; a keyed proofreading mark must
stay on the same line as the word it marks.

**Classification:** **gap.** Confirmed to affect 18.4.1b directly; almost certainly also
affects 18.6.2d's "same braille line as the marked word" clause and 18.8.2c's word-pair
requirement (both blocked anyway by other missing features, F-187/F-189, but this would
remain a problem even if those were built). 18.6.5a's caret-stays-with-its-inserted-word
requirement is only accidentally safe today (ordinary adjacent text normally wraps together)
and would break the same way under the right line length.

**Test that would prove a fix:** either preserve a genuine NBSP through `normalizeTextAndTypeform`
(converting it to a real no-break space marker `wrapCells` respects when deciding a break
point) or add an explicit "these N tokens must not be split" primitive at the segment level;
a test built exactly like Probe M, asserting the two joined words always land on the same
output line regardless of where the natural wrap point would otherwise fall.

**Status: not done.**

---

# Standards findings — alphabetic references (BANA §21, B004 Appendix I) (assessed 17 Sep 2026)

## F-191 — No alphabetical-division-letter construct exists anywhere; a generic heading
stand-in gets some behaviours right by accident and one demonstrably wrong

**Rules:** BANA 21.2.3a (partial-by-accident), 21.2.3b (partial-by-accident), 21.2.3c
(partial-by-accident), 21.2.3d (**not done — reproduced bug**), 21.2.3e (partial-by-accident),
21.2.3f (partial-by-accident), 21.2.3g (not done), 21.2.3h (done, trivially)

> "a. Center alphabetical division letters." (21.2.3a)
> "b. The grade 1 indicator is used before alphabetical division letters as required." (21.2.3b)
> "c. Insert a blank line before, but not after, the first alphabetical division." (21.2.3c)
> "d. Do not insert blank lines before or after other alphabetical divisions." (21.2.3d)
> "e. Follow print for capitalization." (21.2.3e)
> "f. Alphabetical divisions are followed by at least one line of text at the bottom of the
> braille page." (21.2.3f)
> "g. Insert one blank line when print uses only blank lines to separate alphabetical
> divisions." (21.2.3g)
> "h. Do not insert blank lines if alphabetical divisions are not indicated in print." (21.2.3h)

**What Emboss does:** there is no `division` block/kind anywhere in the codebase (grep of
`document.mjs`/`parse.mjs`/`styles.mjs`/`nimas-export.mjs` for "division" turns up only the
unrelated §11 wide-table "vertical division" feature). `Emboss/docs/style-specification.md`'s
own Index Entry entry says so directly: **"⚠ New-page rule not implemented (A8). Q: add BB's
Alphabetic Division and Guide Word styles?"** — an open, unresolved question, not a built
feature. The only way a division letter can reach the formatter at all today is if the
transcriber authors it as an ordinary `heading` block between index/glossary list blocks.

Probed directly (`probe21.mjs`, real liblouis, BANA mode): a `heading` "A" immediately
followed by an `index` list, then a `heading` "B" immediately followed by another `index`
list:
```
                   ,A

,AEG1N ,SEA1 #BCG

                  ;,B

,BOLD1 #E
```
This shows: (i) "A" is centred and capitalised correctly (21.2.3a/e) — for free, via the
generic heading formatter, not any division-specific code; (ii) liblouis supplies the grade-1
indicator (`;`) before "B" on its own, because bare lowercase `b` is the UEB one-cell
contraction for "but" and needs disambiguating — "A" needed none, correctly, since `a` is not
a whole-word contraction (21.2.3b is satisfied by liblouis's own grade-1 decision, not by any
Emboss-authored rule); (iii) **both** "A" (the first division) **and** "B" (a later division)
get a blank line before them, because `document.mjs`'s generic heading rule inserts a blank
line before every heading by default (per `style-specification.md`'s own "Blank line before"
note) with no notion of "first division vs. a later one" — this is a **direct, reproduced
violation of 21.2.3d**, which requires NO blank line before a division after the first.
21.2.3f (a division must not be the last line on a page) would be satisfied only because the
existing generic heading-orphan-control code (`document.mjs` around line 3223, "the heading
itself must not be orphaned… BANA Formats §1.15.2") applies to any block of `type === 'heading'`
— again, coincidental, not §21-specific. 21.2.3g (one blank line when print shows *only*
blank lines, no printed letters, between divisions) has no supporting code at all: there is no
signal in the AST for "this gap between two index entries is an unlabelled division", so
Emboss cannot special-case it — not done. 21.2.3h (no blank lines when print gives no
division signal whatsoever) is trivially satisfied, since Emboss never invents structure that
isn't there.

**What the standard requires:** a first-class recognition of an alphabetical division letter,
distinct from an ordinary heading, so blank-line placement can depend on "is this the first
division" (21.2.3c/d) and on whether print shows a labelled or blank-line-only division
(21.2.3g/h) — none of which a generic heading block can express.

**Classification:** not done (feature absent); the coincidental correctness of a/b/e/f is
noted so a future implementer does not assume more already works than does.

**Test that would prove a fix:** a document with three index alphabetical divisions (first
one, then two more) shows a blank line before the first division only, and any of them that
would otherwise fall on the last line of a page is pushed to the next page with at least one
entry following it.

---

## F-192 — No guide-word mechanism exists anywhere: neither braille page guide words nor a
way to retain print's own guide words

**Rules:** BANA 21.3.1b (not done), 21.3.1c (not done), 21.3.1d (not done), 21.3.1e (not
done), 21.3.2 (not done), 21.3.2a–j (not done, all ten), 21.6.3d (not done), 21.6.5d (not
done), 21.9.4a (not done), 21.9.4b (not done)

> "Braille Page Guide Words. Add braille page guide words to all alphabetic references except
> bibliographies. An agency may choose to omit the guide words in certain alphabetic
> references, such as indexes." (21.3.2, introducing a–j)
> "d. The language by which the glossary is organized should be used for guide words."
> (21.6.3d)
> "d. Guide words are generated from the cell-5 headings." (21.6.5d)

**What Emboss does:** a repository-wide search for "guide word"/"guideword" (case-
insensitive) across `document.mjs`, `parse.mjs`, `nimas-export.mjs`, and `editor.mjs` returns
**zero** matches. There is no code that scans a braille page's own alphabetic-reference
content for its first/last main entry, no centring of a guide-word line, no "at least three
blank cells" spacing, no dash-joining, no shortening, and no "(cont.)" continuation logic.
`style-specification.md`'s Index Entry entry flags this as a known, undecided gap: **"Q: add
BB's Alphabetic Division and Guide Word styles?"**. Because no guide-word generator exists at
all, every rule that depends on guide words being generated (21.6.3d — which language to draw
them from; 21.6.5d — generating them from cell-5 headings; 21.9.4a/b — which words to select
in foreign material) has nothing to attach to and is equally not done. 21.3.1b–e (retaining
and formatting *print's own* guide words, for the rare case where the text is teaching guide-
word use, 21.3.1a) also has no support: nothing in the AST distinguishes print's own printed
guide-word line from ordinary running text, so it cannot be centred (21.3.1b), protected from
adjacent blank lines (21.3.1c), or have its own separator symbol preserved as a distinct
feature (21.3.1e) — Emboss would simply pass such text through as an ordinary line/paragraph,
with no braille-page-boundary awareness (pagination is currently print-page-position-blind
for this purpose in any case, since braille pages are computed by line count only —
`Emboss/format/page.mjs`).

**What the standard requires:** braille page guide words are core apparatus for the great
majority of alphabetic references (only indexes may optionally omit them) — a mechanism that,
at the end of formatting each braille page, looks at that page's own first and last main
(level-0) entries and synthesises a centred, dash-joined, correctly-spaced guide-word line
(shortened when necessary, "(cont.)" when a page has no new main entries), and can draw that
same text from cell-5 glossary headings or the organizing language for bilingual glossaries.

**Classification:** not done (feature entirely absent).

**Test that would prove a fix:** an index of at least two braille pages produces a centred
guide-word line on each page's last line, giving the correct first/last main-entry pair per
page, joined by a dash, at least three blank cells from both the margins and the page number,
and reading "(cont.)" for a page that starts mid-entry with no new main entry of its own.

---

## F-193 — No thesaurus or dictionary construct exists; only glossaries and indexes are
first-class list kinds

**Rules:** BANA 21.7.1a (not done), 21.8.5 (not done), 21.8.5a (not done), 21.8.5b (not
done), 21.8.5c (not done), 21.8.5d (not done), 21.8.5e (not done), 21.8.5f (not done),
21.9.2c (not done), 21.9.2d (not done), 21.9.2e(1) (not done), 21.9.2e(2) (not done),
21.9.2e(3) (not done), 21.9.2e(4) (not done), 21.9.2e(5) (not done), 21.9.2e(6) (not done),
21.9.2e(7) (not done), 21.9.2f (not done)

> "Multilevel Dictionary Entries. All of the following are treated as subentries, no matter
> how they appear in print: a. Parts of speech… b. Each numbered or lettered definition…
> c. Run-in derived entries… d. Synonyms or antonyms. e. 'See also' references…" (21.8.5–e)

**What Emboss does:** `Emboss/format/styles.mjs`, `document.mjs`, `parse.mjs`, `nimas-
export.mjs` and `editor.mjs` contain no occurrence of "thesaurus" or "dictionary" anywhere
(grep of all five files returns nothing). The only alphabetic-reference-aware list kinds are
`index` (`styles.mjs:134`) and `glossary` (a `<dl>`-only construct, see F-194/F-195).
There is therefore no code that can look at flat dictionary-entry prose ("parts of speech",
"numbered definitions", "run-in derived entries", "see also") and reclassify pieces of it as
subentries/sub-subentries (21.8.5a–f — 21.8.5g, "words of foreign derivation are contracted",
is different and is covered separately below since it needs no dictionary-aware code at all).
The same absence blocks every bilingual/foreign-dictionary transform in 21.9.2c–f and
21.9.2e(1)-(7): substituting a colon for a comma before a translation, transposing a special
sign ahead of the entry word, computing a per-page shared left margin from the longest
preceding article, and stepping subentries/runovers off that computed margin. None of this
exists; a document author's only option today is to hand-author the final margins directly as
list levels (which get the CORRECT cell positions once chosen — see 21.9.2a below, "done") —
but nothing computes what those levels/margins should be from the print material described in
21.9.2e.

Probed (`probe21.mjs`): a plain undecorated `list` block ("happy" at level 0, "glad" at level
1, standing in for a multilevel thesaurus, since no `thesaurus` kind exists) formats with
`GLAD` correctly two cells right of `HAPPY` (§21.7.3a's 1-5/3-5 nested pattern — see the
"done" rows below), proving the *margin* mechanism is generic and reusable, but nothing
inspects a thesaurus's own print cue (per 21.7.3: "entries are often bold and subentries
another font attribute such as italics") to *decide* which words are level 0 vs. level 1 in
the first place — that inference (21.7.1a, "follow print layout of entries and subentries")
is not implemented; a human has to pre-assign the levels.

**What the standard requires:** structural recognition of dictionary/thesaurus print
conventions (bold vs. italic entries, numbered/lettered definitions, run-in derived forms,
"see also", print colons/asterisks/commas in bilingual entries) sufficient to build the
correct subentry/margin structure automatically, rather than requiring the source to already
carry pre-computed list levels.

**Classification:** not done (feature/AST absent).

**Test that would prove a fix:** a flat dictionary-style input carrying two part-of-speech
labels for one entry ("flat adj. … flat adv. …") automatically formats the second
part-of-speech as a subentry one level deeper, with no manually pre-assigned `level` field.

---

## F-194 — `glossarySegments` unconditionally injects a colon between term and definition,
never the applicable 1-/2-blank-cell spacing

**Rules:** BANA 21.5.1c (not done), 21.5.1d (not done), 21.5.1e (not done), 21.6.1 (partial)

*(Same code path as `F-183`, found during the §17 Spelling Lists assessment — cited, not
repeated, but reproduced here against §21's own rule text since §21.5.1/§21.6.1 are the rules
that actually govern glossaries, not §17.)*

> "c. Leave one blank cell between the entry-word segment and the definition segment when the
> entry word is followed by punctuation, capitalization, or enclosure symbols." (21.5.1c)
> "d. Leave two blank cells between the entry-word segment and the definition segment when it
> is not followed by punctuation, capitalization, or enclosure symbols." (21.5.1d)

**What Emboss does:** `glossarySegments` (`Emboss/format/document.mjs`, "Glossary definition
list formatting" section) computes `const sep = /[:—-]$/.test(term) ? ' ' : ': ';` — i.e. it
inserts a **literal colon** (plus one space) whenever the term does not already end in `:`,
`—`, or `-`, and otherwise a single space. Probed (`probe21.mjs`, real liblouis, BANA):
- term `"cat"` (no trailing punctuation at all — the exact case 21.5.1d says needs **two
  blank cells and no punctuation**) produces `CAT3 ,A SMALL DOME/ICAT$ ANIMAL4` — a
  fabricated colon (ASCII `3`) appears between the entry and its definition, which print
  never had, followed by only ONE space, not two blank cells.
- term `"addiction:"` (already print-punctuated — the 21.5.1c case) produces
  `ADDIC;N3 COMPULSIVE NE$4` with one space after the (real, print-supplied) colon — correct
  by coincidence of how the input happened to be typed, not because the code detected
  "punctuation/capitalization/enclosure symbol".

The regex also never accounts for capitalization or an enclosure symbol (a closing paren or
quote) ending the entry word, both of which 21.5.1c also calls for one-cell spacing on; only
a literal trailing `:`/`—`/`-` character is recognised.

**What the standard requires:** one blank cell when the entry word segment is followed by
punctuation, capitalization, or an enclosure symbol; two blank cells otherwise — and no colon
invented where print did not have one (this governs simple glossaries generally, 21.6.1, and
21.5.1e's further "two blank spaces before all definitions when styles are mixed").

**Classification:** bug / not done (same defect as F-183, confirmed again against §21's own
wording and with a fresh probe).

**Test that would prove a fix:** a `<dl>` entry with a plain, unpunctuated term formats with
exactly two blank cells and no colon between term and definition; one whose term already ends
in a closing parenthesis formats with exactly one blank cell.

---

## F-196 — No per-list/per-glossary/per-paragraph emphasis-stripping exists; `stripEmphasis`
is wired to headings only

**Rules:** BANA 21.2.2 (not done), 21.5.2a (not done), 21.7.3b (not done), 21.9.1a (not done)

*(Same root cause as F-38, "Emphasis shared by every item of a list is never omitted",
cited not repeated, but this is a distinct set of rule ids from §21 rather than §8.)*

> "Font Attributes. Ignore entry word font attributes when all entry words are emphasized.
> Use emphasis only for entry words requiring distinction." (21.2.2)
> "b. Omit font attributes for entry words at the main and subentry levels." (21.7.3b, a
> multilevel thesaurus)
> "a. Ignore print emphasis for entry words, subentry words, and all translations and
> definitions unless needed for distinction." (21.9.1a)

**What Emboss does:** `stripEmphasis` (`document.mjs`) is called only at heading-formatting
call sites (four call sites, all inside heading formatters). `formatList`/`formatGlossary`
never call it, so any `tf` (typeform/emphasis) carried on a list item's or glossary
definition's segments passes straight through. Probed (`probe21.mjs`): a two-level list
("happy" with `tf: 2` italic, "glad" plain) — standing in for a multilevel thesaurus, since no
`thesaurus` kind exists — formats as `_1HAPPY` / `GLAD`: the UEB italic-open indicator `_1` is
retained, proving font attributes on entry words are never omitted, regardless of whether
every entry in the reference shares the same emphasis (21.2.2) or whether the construct is
specifically a multilevel thesaurus (21.7.3b) or foreign-language material (21.9.1a).

**What the standard requires:** entry-word font attributes are dropped when they carry no
distinguishing information (all entries emphasized alike, or a thesaurus/foreign-material
entry/subentry level that must be typeform-free by rule), retained only where the rule itself
calls for retention (e.g. 21.5.3's sample sentences, 21.2.4b's cross-references — see the
`done` rows below, which are correct only because nothing strips anything, not because
Emboss compares "is this shared").

**Classification:** not done (feature absent, same class of gap as F-38).

**Test that would prove a fix:** an alphabetic-reference list block where every entry word
carries the same `tf`, and a formatting pass drops it while retaining emphasis manually
flagged as "needs distinction".

---

## F-197 — No Special Symbols page exists; every §21 rule that asks for one has nowhere to
put its listing

**Rules:** BANA 21.6.3c (not done), 21.8.2 (partial — the "Special Symbols" clause only),
21.8.6b (not done), 21.9.3a (not done — see also F-198/F-158 for its modifier half)

*(Cites F-89 "No Special Symbols page exists in any generalised form" and F-138 "No Special
Symbols page exists; confirmed by the code's own comment" — not repeated.)*

> "c. List foreign language symbols on the Special Symbols page." (21.6.3c)
> "b. List the superscript indicator on the Special Symbols page, or in a transcriber's note
> before the text." (21.8.6b)

**What Emboss does:** as F-89/F-138 already establish, no generalised Special Symbols page
construct exists anywhere in Emboss. The one narrow exception — `tdSymbolNote` (`document.mjs`,
"Until the Special Symbols page exists (G8), the first transcriber-defined symbol is
explained in a transcriber's note…") — fires only for `block.kind === 'asterism'`, never for a
glossary foreign-language symbol, a superscript indicator, or any other §21 symbol. A
transcriber's note is still possible as free text (`formatTranscriberNote`, mechanism only —
see F-199), so the "or in a transcriber's note" half of 21.8.6b/21.8.2 can be satisfied by
hand-typing one, but nothing generates or requires it automatically.

**What the standard requires:** a place — the Special Symbols page, or an automatically
inserted transcriber's note — where every non-standard symbol these rules introduce
(foreign-language accented letters, a superscript indicator, dictionary print markers) is
documented once, near the front of the volume.

**Classification:** not done (feature absent, same class of gap as F-89/F-138).

**Test that would prove a fix:** a document using a foreign accented letter in a glossary
entry causes a Special-Symbols-page (or auto-generated transcriber's note) entry to appear
listing that letter.

---

## F-200 — No dictionary-entry or pronunciation-key AST node; glossaries-with-pronunciation
cannot be built at all

**Rules:** BANA 21.6.2 (not done)

*(Cites F-161 "No dictionary-entry AST node for blank-cell spacing" and F-162 "No
pronunciation-key or summary-key AST node/formatting", found assessing §20 Pronunciation —
not repeated; §21.6.2 explicitly cross-references §20.7 for this reason.)*

> "Glossaries with Pronunciation… When entry words are shown with syllable breaks, insert the
> word in contracted form with no syllable breaks at the margin. Follow this (after one blank
> cell) with the word showing syllable breaks and using contracted braille." (21.6.2)

**What Emboss does:** `glossarySegments`/`formatGlossary` (`document.mjs`) has exactly one
term field and one definition field per item — there is no way to express "the same word
written twice, once plain and once syllabified", nor the "one blank cell" separator this
specific rule calls for (distinct from 21.5.1c/d's one/two cell rule for entry-vs-definition).
This is the identical structural gap F-161/F-162 already found in §20: no dictionary-entry AST
node exists to hold a second, syllabified writing of the entry word.

**What the standard requires:** a glossary-with-pronunciation entry able to hold both an
unsyllabified and a syllabified writing of the entry word, one blank cell apart, both
contracted.

**Classification:** not done (feature absent — same as F-161/F-162).

**Test that would prove a fix:** a glossary entry whose print shows syllable breaks
("pre·sen·ta·tion") formats as the plain contracted word, one blank cell, then the same word
contracted with its syllable-break marks retained.

---

## F-201 — No Title Page feature exists; the inclusive-letter-sequence rules have nowhere to
render

**Rules:** BANA 21.2.5 (not done), 21.2.5a (not done), 21.2.5b (not done), 21.2.5c (not done)

*(Cites F-132 "No Title Page feature exists anywhere in Emboss" — not repeated.)*

> "Alphabetic Reference Type and Letter Sequence on the Title Page. When an alphabetic
> reference… occupies more than one braille volume, include the sequence of letters that
> identify the range of entries contained in that volume on the title page." (21.2.5)

**What Emboss does:** as F-132 already establishes, Emboss has no Title Page feature of any
kind, so there is nowhere for a volume's inclusive letter sequence, its alphabetic-reference
type label ("Index," "Thesaurus," etc.), or its uncontracted-braille rendering to be placed.
The underlying `uncontracted` per-segment mechanism that 21.2.5b would need does exist
generically (`document.mjs`/`parse.mjs`, see F-202) but is unreachable here for want of
anywhere to attach it.

**What the standard requires:** a title page (existing generally, per F-132) able to carry,
after the volume number, an alphabetic-reference type label and an uncontracted-braille
inclusive letter sequence.

**Classification:** not done (feature absent — same as F-132).

**Test that would prove a fix:** a two-volume index's volume-2 title page shows "Index alt-
arte" (or similar) with the letter sequence in uncontracted braille.

---

## F-203 — The index/list `page` field is a plain string with no segments/emphasis, and
print-page ranges are pass-through text only

**Rules:** BANA 21.4.3 (not done), 21.6.3f (partial)

*(21.6.3f cites F-46 "Combined/omitted print-page-number ranges are pass-through text, never
computed" — not repeated.)*

> "Font Attributes. Omit font attributes when a letter such as m for map, or p for photograph
> is emphasized as part of a page number in the index." (21.4.3)
> "f. English and foreign language glossary word entries may appear on facing pages. Combine
> the entries into a nested list as above, and use combined print page numbers, e.g., 454-455,
> a454-455, b454-455, etc." (21.6.3f)

**What Emboss does:** `pageSuffix` (`document.mjs`, "A list item's page references…") reads
`item.page` as a single plain string (`String(item.page ?? '').trim()`) and translates it as
plain text — there is no `segments`/`tf` field on an item's `page` at all, so even *retaining*
an emphasised map/photo letter within a page reference is structurally impossible, let alone
selectively omitting it. For 21.6.3f, the same plain-string `page` field means a transcriber
who types the combined range directly (e.g. `"454-455"`) gets it through verbatim (same
pass-through class of gap as F-46's table/contents page-number ranges) — but nothing detects
that two entries came from facing print pages and computes the combined form automatically.

**What the standard requires:** an index page-reference able to carry per-character emphasis
so an emphasised map/photo letter can be selectively dropped (21.4.3), and automatic
computation of a combined print-page range from two facing-page entries (21.6.3f).

**Classification:** not done (21.4.3, structural absence) / partial (21.6.3f, manual
pass-through only, same class as F-46).

**Test that would prove a fix:** an index entry whose page field carries an emphasised "m"
(e.g. `12, 15m`) formats with the emphasis dropped from the page reference.

---

## F-204 — Alphabetic references do not force a new braille page

**Rules:** BANA 21.2.1a (not done)

> "a. Start each alphabetic reference on a new braille page." (21.2.1a)

**What Emboss does:** `Emboss/docs/style-specification.md`'s own Index Entry entry says
plainly: **"⚠ New-page rule not implemented (A8)."** No code in `document.mjs`/`page.mjs`
forces a page break before a block of kind `index` or `glossary`; pagination
(`Emboss/format/page.mjs`) chunks purely by line count regardless of block kind.

**What the standard requires:** every alphabetic reference (index, glossary, thesaurus,
dictionary, etc.) begins on a fresh braille page, whatever content preceded it.

**Classification:** not done (acknowledged gap, task A8).

**Test that would prove a fix:** a document with a short paragraph immediately followed by an
`index`/`glossary` block starts that block at the top of the next braille page even though
the preceding page had room left.

---

## F-198 — No transcriber-defined-modifier mechanism; accent marks on a foreign dash/hyphen
cannot be represented

**Rules:** BANA 21.9.3a (not done)

*(Cites F-158 "No transcriber-defined modifier mechanism for diacritics" — not repeated.)*

> "a. Insert the appropriate modifier (unspaced) before the braille dash or hyphen if an
> accent mark is shown above the print symbol… Explain this usage on the Special Symbols
> page." (21.9.3a)

**What Emboss does:** as F-158 already establishes for §20, there is no transcriber-defined-
modifier mechanism anywhere in the AST or translation pipeline, and (F-197/F-89/F-138) no
Special Symbols page to explain one on even if it existed.

**What the standard requires:** a modifier symbol invented for an accented dash/hyphen and
documented on the Special Symbols page.

**Classification:** not done (same as F-158).

**Test that would prove a fix:** as F-158's own test.

---

## F-202 — The per-segment `uncontracted` (grade-1) flag exists and works, but nothing
automatically detects a foreign-language word to apply it

**Rules:** BANA 21.6.3b (partial), 21.9.1b (out of scope for the language-determination half;
partial for the contraction half)

> "b. Use uncontracted braille for foreign language entry words, using the appropriate
> accented letters and symbols for the language." (21.6.3b)

**What Emboss does:** the `uncontracted` per-segment flag is a real, working mechanism
(`document.mjs`'s `segmentsToBraille`/`translateLine`, and `parse.mjs` around line 1965,
which sets it from a handful of recognised classes: `uncontracted`, `bai-trans4`, `phonetic`,
`pronunciation`, `pron`, `ipa`). But nothing infers it from a foreign-language *signal* — the
only per-element language attribute Emboss reads at all is a document-level `xml:lang`/`lang`
on the root (`parse.mjs`), never a per-span `xml:lang` on an individual glossary entry word —
so a foreign entry word is only rendered uncontracted if the transcriber manually applies one
of those specific classes. This is a working building block, not automatic recognition.

**What the standard requires:** foreign-language entry words are automatically uncontracted;
21.9.1b additionally requires *determining* — for an ambiguous abbreviation such as "inf." —
whether it is English or foreign in the first place, which the rule's own wording
("It is important to determine whether abbreviations are given in English or the foreign
language") hands to human judgement, since "inf." and "sing." are genuinely ambiguous without
semantic understanding of the surrounding sentence.

**Classification:** partial (21.6.3b — mechanism exists, manual-only) / out of scope for the
language-determination judgement in 21.9.1b (the rule's own wording, quoted above, describes
an ambiguity only a reader with semantic understanding can resolve) — partial for 21.9.1b's
remaining, mechanical "then use contracted/uncontracted braille accordingly" half, which
reuses the same `uncontracted` flag once the determination is made.

**Test that would prove a fix:** a glossary entry word tagged `xml:lang="es"` renders in
uncontracted braille without an explicit `class="uncontracted"`.

---

## F-195 — Glossary entries are flat term/definition pairs only: no cell-5 heading option,
no nested illustrative-material blocks

**Rules:** BANA 21.6.5c (not done), 21.6.5d (not done — see also F-192), 21.6.5e (not
done), 21.6.5f (not done), 21.6.5g (not done)

> "c. Treat the entry word or entry heading as a cell-5 heading. Use this format for the
> entire section, even if some entries do not have samples." (21.6.5c)
> "e. Use the appropriate format for the example, e.g., paragraphs, poetry, etc." (21.6.5e)
> "g. Examples of glossary terms are treated as displayed material when they follow the
> definition." (21.6.5g)

**What Emboss does:** a glossary `item` (`glossarySegments`/`formatGlossary`, `document.mjs`)
has only `term`/`termSegments`, `def`/`defSegments`, `text`, and `segments` — flat inline
content at a fixed nested-margin indent (`first = lvl === 0 ? 0 : 2 + (lvl-1)*2`). There is no
"cell-5 heading" formatting option available to a glossary item (that treatment exists only
for the dedicated heading block type, which a glossary item is not and cannot contain), and no
way for a glossary item to hold an arbitrary nested block (a `poem`, a displayed paragraph, a
diagram) the way a `sidebar` or `box` can. Consequently 21.6.5c (cell-5 heading treatment),
21.6.5d (guide words from those headings — also blocked by F-192), 21.6.5e (format the
example appropriately, e.g. as poetry), 21.6.5f (no blank line between the heading and the
illustrative material), and 21.6.5g (treat the example as displayed material) all have no
supporting structure to act on.

**What the standard requires:** a glossary entry able to carry, after its cell-5-heading
entry word, arbitrary nested illustrative material (poetry, displayed text, diagrams) in its
own appropriate format, without an intervening blank line.

**Classification:** not done (structural limitation — the glossary item shape has no field
for nested blocks of arbitrary type).

**Test that would prove a fix:** a glossary entry whose sample is a two-line poem formats the
entry word as a cell-5 heading immediately followed (no blank line) by the poem in its own
poetry format.

---

## F-199 — No repositioning logic for entry-word markers (superscript numbers, transposed
print signs); free-text transcriber's notes remain the only manual workaround

**Rules:** BANA 21.8.6a (partial — repositioning half not done), 21.8.6c (not done — TN
auto-insertion), 21.9.2d (not done)

> "a. Regardless of print placement, place the superscript number after the entry word in
> braille. Follow print for spacing." (21.8.6a)
> "c. Insert a transcriber's note when the superscript numbers appear before the entry words
> in print." (21.8.6c)
> "d. If a special print sign (e.g., an asterisk) is printed after an entry word, the asterisk
> symbol is transposed to precede the entry word. Explain this rearrangement in a
> transcriber's note placed before its first occurrence." (21.9.2d)

**What Emboss does:** superscript/subscript text has a generic representation (`SCRIPT_MARKS`
in `parse.mjs`), but nothing inspects a dictionary entry's own structure to detect "this
superscript number currently precedes the entry word in print" and move it after — pass-
through preserves whatever position the source already has. Similarly nothing detects a
trailing special print sign (e.g. an asterisk) and transposes it ahead of the entry word.
Both rules' transcriber's-note clauses can be satisfied only by hand-typing a `note` block
(`formatTranscriberNote`, mechanism only — it renders any transcriber-authored text at BANA's
fixed 7-5 margins, but nothing auto-generates or auto-triggers the note from detecting the
superscript-before-entry-word or sign-transposition condition).

**What the standard requires:** automatic repositioning of a superscript number (or a special
print sign) relative to the entry word, and an automatically inserted transcriber's note when
that repositioning actually changed something from its print position.

**Classification:** partial (mechanism for manually-authored notes and superscript rendering
exists) / not done (the repositioning and auto-note-triggering logic itself).

**Test that would prove a fix:** a dictionary entry with a superscript number placed before
the entry word in the source model formats with the number moved after the entry word, and a
transcriber's note documenting the change is auto-inserted before the entry.

---

# Standards findings — line-numbered and line-lettered text, reassessed rows (BANA §15) (assessed 17 Sep 2026)

## F-205 — Margin-Numbered Paragraphs (§15.2) has no distinct implementation: the paragraph
number lands at the right margin instead of inline, and only source-tagged paragraphs get one

**Rules:** BANA 15.2.1b, 15.2.1c

> "b. Insert the paragraph number before the beginning of the paragraph." (15.2.1b)
> "c. Number every paragraph, even if only some paragraphs are numbered in print." (15.2.1c)

**What Emboss does:** parse.mjs treats a `<linenum>` at the start of an ordinary `<p>` exactly
like a §15.3/§15.4 line-numbered-PROSE marker (`inVerseLine` is false outside a `<line>`/`<ln>`,
so it becomes an ordinary `{type:'linenum'}` segment). `formatSegmentedPara` then always routes
it through `lineNumberWord`/`wrapNumbered` (document.mjs:720-733), which unconditionally moves
the number to the RIGHT margin of the paragraph's first braille line and even injects the
§15.4.1d transcriber's note ("Line numbers are shown at the right margin…Three blank cells…")
before it — a note that describes the §15.3/15.4 convention, not §15.2's.

Probe (`probe.mjs 2001`; two paragraphs tagged `<linenum>5</linenum>` / `<linenum>7</linenum>`,
one untagged in between, real liblouis, BANA 40x25):

```
      @.<,L9E NUMB]S >E %[N AT ! "R M>G9
    ": PR9T NUMB]S A L9E4 ,?REE BLANK
    CELLS )9 A BRL L9E %[ ": T PR9T L9E
    2G9S4@.>
  ,ONCE ^U A "T ! WOLF PUT ON ! OLD   #E
LADY'S %AWL & CAP4
  ,HE TRI$ TO IMITATE GR&MA'S QUAV]+
VOICE4
  ,OP5 ! LAT* & COME IN4              #G
```

The number ends up at the right margin ("...OLD#E") instead of before the paragraph text
("#E ,ONCE..."), per 15.2.1b. The untagged middle paragraph gets no number at all — nothing in
Emboss computes or inserts a paragraph number that the source doesn't already carry, so
"number every paragraph, even if only some are numbered in print" (15.2.1c) cannot be met
unless a human has already hand-numbered every paragraph before it reaches Emboss (defeating
the point of "only some…numbered in print"). Emboss also has no separate/parameterised code
path at all for §15.2 — everything with a `<linenum>` outside a `<line>`/poem falls into the
same §15.3/15.4 pipeline, including the wrong three-blank-cell transcriber's note.

**What the standard requires:** the number is inline, at the start of the paragraph's own text,
on every paragraph (not moved to the margin, and not omitted for paragraphs the print itself
leaves unnumbered).

**Classification:** bug / not done. Distinct from F-181/F-182 (different rule, different code
path — this is the "paragraph-number-outside-a-`<line>`" case, not a play or a poem).

**Test that would prove a fix:** a `<p>` with a leading `<linenum>` renders with the number as
an ordinary leading word of the paragraph (not moved to the margin, no line-numbered-prose note
triggered); a document with only some `<p>`s tagged renders every paragraph numbered once the
transcriber/converter's own numbering scheme is honoured (see Q-66/Q-67 below for what
"honoured" should mean).

---

## F-206 — No mechanism for a "significant blank space" between a verse-play speaker's name
and the first word of dialogue (three blank cells + required transcriber's note)

**Rule:** BANA 15.5.2b

> "b. Insert three blank spaces in braille when in print a significant blank space is left
> between the speaker's name and the first word of the dialogue. A transcriber's note is
> required explaining this format."

**What Emboss does:** a play-speaker/verse line's segments are collapsed through the ordinary
`groupSegments`/`segmentsToBraille` text path, which normalises any run of horizontal
whitespace to a single space (`t.replace(/[^\S\n]+/g, ' ')`, document.mjs:673) before
translation. There is no signal anywhere in the parser or formatter for "this gap in the print
was significant", no code that turns such a gap into three literal blank cells, and no
transcriber's-note text for this convention (compare `LINE_NUMBER_NOTE`, which exists only for
§15.4.1d).

Probe (`probe.mjs 552`, third block: `{ type:'play', subtype:'prose', style:'play-speaker',
text: 'CAESAR.        Speak.' }`, eight literal spaces in the source):

```
,,CAES>4 ,SP1K4
```

The eight-space gap collapses to the ordinary single inter-word space; nothing distinguishes it
from a normal space, and it is not preceded/followed by any transcriber's note.

**What the standard requires:** three blank cells in the braille, plus a transcriber's note
explaining the convention.

**Classification:** feature absent / not done.

**Test that would prove a fix:** a play-speaker/verse block whose source records a "significant
gap" (needs its own markup — see Q-68) renders as three literal blank cells with an
accompanying transcriber's note, distinguishable from an ordinary single space between words.

---

## F-207 — Interspersed line-numbered prose (§15.6.1a) is only numbered where the source
already tags a `<linenum>`; Emboss does not add the missing sequential numbers the rule requires

**Rule:** BANA 15.6.1a

> "a. Prose. Every print line is numbered."

**What Emboss does:** the prose portion of an interspersed passage goes through the same
generic line-numbered-prose mechanism as §15.4 (A30): a print line gets a braille number only
when the source has an explicit `<linenum>` on it; `lineNumberInfo` (document.mjs:3059-3074)
only ever reports numbers it finds, and nothing in parse.mjs or document.mjs computes/inserts a
sequential number for an unmarked line.

Probe (`probe.mjs 561`; a `<p>` with one tagged line, followed by a `<poem>` verse with a
different tagged line, real liblouis, BANA 40x25):

```
  ,SECOND CITIZ54 ,TRULY1 SIR1 ALL T
,I LIVE BY IS ) ! AWL4                #B
```

only the one tagged print line in the prose block carries a number; a passage with several
unnumbered print lines interspersed would show no number on any of them, contrary to "every
print line is numbered".

**What the standard requires:** every print line of the prose portion carries a braille line
number, whether or not the print itself shows one there.

**Classification:** bug / not done, BUT see Q-67: this is the same limitation that
`standards-map.md`'s own (already-assessed, out of this reassessment's scope) BANA 15.4.1b row
relies on to be marked "done" — i.e. the working assumption there is that the DTBook source is
expected to arrive with a `<linenum>` on every actual print line, sequentially numbered by
whoever prepares it, and Emboss's only job is to place what it's given. If that is indeed the
intended workflow, 15.6.1a is satisfied by the same mechanism and this finding reduces to a
documentation point, not a code gap; if Emboss itself is expected to auto-sequence, this is a
real feature gap. Flagged to Paul rather than assumed either way.

**Test that would prove a fix (if a code gap):** an interspersed-prose block with print lines
left deliberately untagged renders every one of them numbered in braille, in sequence.

---

## F-208 — Counted Words (§15.8.1a) reuses the generic 2-cell line-numbered-text gap; the
rule's own 3-cell requirement is not implemented

**Rule:** BANA 15.8.1a

> "a. Treat counted words as line-numbered text, leaving three spaces at the end of each line
> of text."

**What Emboss does:** `wrapNumbered` (layout.mjs:154-157) hardcodes
`textW = Math.max(8, width - numW - 2)` — a minimum gap of exactly two blank cells before the
widest number — for every caller, with no parameter to request the wider three-cell gap this
rule specifically asks for. This is the same formula, and the same minimum, used for ordinary
line-numbered prose (§15.3.1c's "at least two blank cells").

Probe (`probe5.mjs`/`probe6.mjs`; a paragraph text sized so its final numbered line is packed to
the algorithm's own textW): the gap shrinks to as little as 3 cells and the pattern of the
formula (`width - numW - 2`) proves it can reach exactly 2 whenever the text is long enough to
fill textW — there is no floor of 3 anywhere in the code. The existing
`line_numbered_prose.test.mjs` ("the number is at the right margin...") independently asserts
the same `-2` minimum for ordinary line-numbered prose (`lines.every((x) =>
x.replace(/ +#[A-J]+$/, '').length <= 40 - 3 - 2)`), confirming the formula is shared and
2-cell, not 3-cell, throughout.

**What the standard requires:** counted-word lines end with three blank cells before the
right-margin count, not the general two.

**Classification:** bug / not done.

**Test that would prove a fix:** a counted-words paragraph whose text is sized to the current
`textW` (i.e. would produce exactly a 2-cell gap under the existing formula) instead produces a
3-cell gap when `wrapNumbered` is invoked in "counted words" mode.

---

## F-209 — No automatic support for "note changes in print format on the Transcriber's Notes
page" (§15.9.3g); only a free-form, unprompted mechanism exists

**Rule:** BANA 15.9.3g

> "g. Note changes in print format on the Transcriber's Notes page."

**What Emboss does:** the only place §15 rules get an *automatic* Transcriber's Notes entry is
15.4.1d's `LINE_NUMBER_NOTE`, injected by `lineNumberInfo`/`lineNumberNote`
(document.mjs:735-742) purely for the three-blank-cell line-numbered-prose convention. Nothing
detects a change in print format (e.g. a shift from paragraph to verse format within a
religious text) or drafts/prompts for a note describing it. A transcriber can still hand-write
whatever they want into the document's existing free-form Transcriber's Notes page (already
assessed under §3), so the capability is not blocked, merely not automated or prompted the way
15.4.1d's own case is.

**What the standard requires:** the transcriber notes format changes on the TN page; nothing in
the rule says this must be automatic, but nothing in Emboss helps recognise or draft it either.

**Classification:** feature absent (partial — a manual workaround exists) — see Q-68.

**Test that would prove a fix:** N/A unless Paul decides Emboss should flag/draft such notes
itself (see Q-68); if the free-form TN page is accepted as sufficient, no code change is
needed and this row should be re-classified "done" with that note.

---

## Rows resolved to "done" (no new finding) — evidence

- **BANA 15.1.2** (grade-1/numeric indicator): `translate()` itself (liblouis's UEB grade-2
  table) emits the disambiguating indicator whenever a bare digit string or a bare letter is
  translated — confirmed directly: `translate('270')` → `#BGJ` (numeric indicator `#`),
  `translate('b')` → `;B` (letter indicator `;`). Both the prose/margin/counted-words path
  (`lineNumberWord`, document.mjs:720-723) and the poem numPrefix path (parse.mjs's
  `parsePoem`) hand the raw digit/letter text straight to `o.translate()`, so the indicator is
  never omitted — independent of the separately-tracked (F-182) defect in *where* the poem case
  places the result. Probe: `probe.mjs 1512`.
- **BANA 15.2.1a** (follow print for blocked/indented paragraphs): `block.blocked` is honoured
  identically whether or not the same paragraph carries a `<linenum>` — probe `probe7.mjs`: two
  `<p class="blocked">` paragraphs, each with a leading `<linenum>`, both render with 1-1
  margins and a preceding blank line, exactly as any other blocked paragraph would
  (document.mjs formatPara/formatSegmentedPara, lines 636-648 and 774-786). The (separate,
  F-205) position defect for the number itself does not disturb this.
- **BANA 15.3.1e** (follow print for a word divided at a line end): Emboss performs no
  hyphenation/rehyphenation of its own; `wrapNumbered` only ever breaks on spaces, so a literal
  hyphen already in the source text passes straight through untouched. Probe (`probe8.mjs`):
  `"happi-" + <linenum>12</linenum> + "ness"` renders as `HAPPI-   NESS` — the hyphen is
  preserved verbatim and the number correctly attaches to the following word.
- **BANA 15.4.1e** (two numbered print lines never start on one braille line): `wrapNumbered`
  explicitly flushes the current line before accepting a second number
  (`if (curNum != null || …) flush();`, layout.mjs:209) — already proven by the existing test
  `line_numbered_prose.test.mjs` ("two numbered print lines never start on one braille line…")
  and reconfirmed with the real translator (`probe.mjs 414e`): three short numbered segments (5,
  10, 15) each land on their own braille line.
- **BANA 15.5.1a** / **15.7.2a** / **15.7.3a** ("use poetry format"): a numbered/lettered poem
  is parsed and formatted through the exact same `<poem>`/`parsePoem`/`formatPlay`(`isVerse`)
  machinery as any other poem (already assessed under §13), unaffected by the presence of a
  `<linenum>` — probes `probe.mjs 551` and `573d` show ordinary poem structure/margins around
  the numbers regardless of the (separately tracked) number-placement defect.
- **BANA 15.5.1b** / **15.6.1b** / **15.7.3b** ("follow print for line numbers; do not add
  numbers absent from print"): `parsePoem` only ever prefixes a number/letter when a `<linenum>`
  element is actually present in the source; unnumbered lines are left exactly as printed.
  Probes `probe.mjs 551` (lines 1/2/4 unnumbered, line 3 numbered) and `561` (the poem's second
  line, untagged, gets no number) confirm nothing is invented. (Where the number IS present, its
  on-page position is the separate, already-covered F-182 defect — see the "not done" rows for
  15.5.1c/15.7.3d below; this row's own narrower claim, non-invention, holds.)
- **BANA 15.6.1** (each prose/verse section formatted per its own indentation guidelines):
  dispatch is purely by `block.type`/`style` — a `type:'para'` block always gets ordinary
  prose margins (formatPara/formatSegmentedPara) and a `type:'play', subtype:'verse'` block
  always gets poetry-format margins (formatPlay/`nestedMargins('poetry', …)`) regardless of
  adjacency. Probe `probe.mjs 561`: the prose paragraph shows the standard 2-space/cell-3
  first-line indent while the interspersed poem line is handled by the verse code path in the
  same document.
- **BANA 15.7.1** (paragraph-format rhyme-scheme letters, retain font attributes): an
  in-body-text rhyme-scheme sequence marked with ordinary emphasis (e.g. `<i>abba</i>`) is
  handled by Emboss's regular emphasis/segment machinery — no special §15.7.1 code is needed or
  present, and none is required by the rule's own "follow print" wording. Probe `probe.mjs 571`:
  `abba` renders wrapped in the UEB italics passage indicators, inline in the running text,
  exactly as printed.
- **BANA 15.9.3b** / **15.9.3d** (verse number at the right margin of the verse's first braille
  line; not repeated on runover lines): religious verse is modelled as an ordinary `<p>` (3-1
  margins, per the already-assessed 15.9.3a), so a leading `<linenum>` goes through the same
  A30 line-numbered-prose mechanism used for 15.3.1b/d, which already places a number once, at
  the right margin of the print line's first braille line, and never repeats it. Probe
  (`probe.mjs 593`): a long wrapping verse shows its number ("#A") only on its first braille
  line; several runover lines that follow carry no number; the next verse gets its own number
  ("#B") only once.
- **BANA 15.9.3e** (notes to the text at the bottom of the print page): satisfied by Emboss's
  existing, already-assessed general footnote-placement mechanism (BANA §16.5.1, "Place notes
  at the end of the print page" — document.mjs:3114 `notePlacement`/`formatFootnote`), which is
  generic to any part of the document and needs no §15.9-specific support.
- **BANA 15.9.3f** (no line-numbered text on a page-number line): identical requirement, and
  identical evidence, to the already-assessed BANA 15.3.1a/15.7.2b rows — pagination reserves
  lines 1 and 25 for page indicators universally, so line-numbered/verse-numbered text is never
  placed there.

(Two caveats worth Paul's attention even on "done" rows: the §15.4.1d `LINE_NUMBER_NOTE` also
fires — wrongly worded for the construct — whenever ANY `<linenum>` reaches an ordinary `<p>`,
including margin-numbered paragraphs (F-205) and counted words; it happens not to fire for
15.9.3's religious-verse case in the probe above only because no earlier `<linenum>`-bearing
paragraph preceded it in that tiny test document, not because Emboss recognises the
construct — a real book combining §15.9 verse numbering with any other `<linenum>` use would
still get the wrong note. This is recorded under F-205, not repeated as its own finding.)

---

## Rows resolved to "not done" citing an existing finding (no new finding number)

- **BANA 15.5.1c** ("maintain the two-cell margin before print line numbers"): not done — same
  root cause as F-182 (`parsePoem`'s `numPrefix` prepends the number as ordinary left-margin
  text instead of routing it through `wrapNumbered`). Probe `probe.mjs 551`: the number "5"
  appears glued to the start of its line's text ("#E ,:AT MY/]IES…"), with no margin at all,
  let alone the required two cells.
- **BANA 15.5.2a** ("use the format outlined in 15.5.1a-c for a play written in verse"): not
  done — same root cause as F-181, extended: `formatPlay` (document.mjs:890-899) calls
  `segmentsToBraille(block.segments, o)` without `lineNumbers: true` on BOTH its prose and its
  verse (`isVerse`) branches, so a `<linenum>` segment on a verse-play dialogue line (the
  Sample-15-6 case) is silently discarded exactly like F-181's prose-play case, not merely
  misplaced. Probe `probe.mjs 552`: a verse-play line carrying a `linenum` segment for "5"
  produces no trace of the number anywhere in the output.
- **BANA 15.7.3d** ("position the rhyme-scheme letters one cell before the longest line
  number"): not done — same root cause as F-182, with an additional specific symptom: `parsePoem`'s
  `findLinenum` (parse.mjs) returns only the FIRST `<linenum>` child of a poem line, so when a
  line carries both a rhyme-scheme letter AND a line number (BANA Sample 15-8's own construct),
  the second marker is silently dropped, not merely misplaced. Probe `probe.mjs 573d`: lines
  authored with both `<linenum>c</linenum><linenum>17</linenum>` show only the letter "c"; the
  number "17" never appears anywhere in the output.

---

# Standards findings — spelling lists and activities, reassessed rows (BANA §17) (assessed 17 Sep 2026)

## F-210 — Typeform is silently dropped from every uncontracted (grade-1) text run

**Rule:** BANA 17.4.1c ("If required, insert the appropriate termination indicator to indicate
the end of the emphasis in a partially emphasized word.") — the uncontracted-with-partial-
emphasis form of 17.4.1b's three-way word list (contracted / uncontracted / uncontracted+
partial emphasis; see Sample 17-6 `a^1cc^'ident^1ally`).

**What Emboss does:** `segmentsToBraille`'s `translateLine` (`Emboss/format/document.mjs`,
around line 748-758) branches on `isUncontracted`:
```js
const g1 = o.translateG1 || o.translateUncontracted;
const tr = g1 ? g1(str) : (tf ? o.translate(str, tf) : o.translate(str));
```
When a grade-1 (`translateG1`) function is supplied, `tr = g1(str)` is called with `str`
**only** — `tf` is never forwarded, so any typeform carried by an uncontracted segment is
discarded. This is not just a probe artifact: the real app's own wiring
(`Emboss/web/app.mjs:347`, `const translateG1 = ... (t) => makeTranslators(louis,
UEB_TABLES.g1).translate(t)`) is itself single-argument, so there is no code path anywhere
that can pass a typeform into grade-1 translation.

**Reproduced** (`probe.mjs`, TEST C — a word list item modelling Sample 17-6's third column,
`accidentally` with `tf:4` (bold) on the "a" and "ident" sub-runs, all marked
`uncontracted:true`): output is
```
;;A;;CC;;IDENT;;ALLY
```
— every letter is plain grade-1 text; no bold indicator (`^1`/`.1`) appears anywhere, though
two of the four sub-runs were marked bold. Compare `Emboss/format/document.mjs`'s own grade-2
path (`groupSegments`, confirmed working by F-92): an ordinary contracted run keeps its
per-character `tf` array and liblouis correctly emits symbol/word/passage indicators and
terminators from it. The uncontracted path has no equivalent.

**What the standard requires:** a word transcribed uncontracted MUST still show which of its
letters/syllables were bold/italic/underlined in print (17.4.1b), with the termination
indicator 17.4.1c asks for marking exactly where that emphasis ends within the word.

**Classification:** bug — not built. Blocks 17.4.1c outright (there is nothing to terminate,
because the emphasis is never emitted in the first place).

**Test that would prove a fix:** an uncontracted segment carrying `tf` formats with the correct
UEB symbol/word/passage typeform indicator AND terminator nested inside the grade-1 wrapper
(e.g. `;;a^1cc^'ident^1ally` or BANA's own `^1` scheme), not silently plain.

**Status: not fixed.**

---

## F-211 — No inline/embedded transcriber's-note segment: `TN_OPEN`/`TN_CLOSE` only ever wrap a whole block

**Rules:** BANA 17.11.2b ("Enclose the repeated word in an embedded transcriber's note to
distinguish it from surrounding text" — Example 17-9: `,my jeans @.<je-ns@.> %runk...`, the TN
brackets sit *inside* a running sentence) and 17.13.1b ("...add the contracted form of the word
at the end of the equation, enclosed in transcriber's note indicators" — Example 17-13:
`amaze^1ment @.<amaze;t@.>`, the TN brackets sit at the end of a list item, same line).

**What Emboss does:** `formatTranscriberNote` (`Emboss/format/document.mjs:819-826`) is the
only code that ever emits `TN_OPEN`/`TN_CLOSE` (`@.<`/`@.>`, `document.mjs:18`), and it always
operates on a whole `block` at the block's own TN margins (`tnMargins`) — there is no segment
type that wraps a sub-run of a paragraph's or list item's own `segments` in TN brackets.
`groupSegments` (`document.mjs`, ~line 657) only special-cases `type: 'math'`, `'noteref'` and
`'linenum'`; any other segment type, including `{type:'note', ...}`, falls through to the
default plain-text branch and is rendered as ordinary text with no brackets at all.

**Reproduced** (`probe4.mjs`, last test): a list item modelled on Example 17-13
(`amaze + ment = amazement` uncontracted, followed by a `{type:'note', text:'amazement'}`
segment for the contracted-form annotation) formats as
```
;;;AMAZE "6 MENT "7 AMAZEMENT;' AMAZE;T
```
— `AMAZE;T` (the contracted form) is emitted as plain contracted text with **no** `@.<`/`@.>`
around it; the `note` type tag on the segment is silently ignored.

**What the standard requires:** the repeated/derived word must be visibly set off from the rest
of the line by transcriber's-note indicators, without triggering a block-level TN's own blank
lines/margins (both 17.11.2b's and 17.13.1b's samples keep it on the SAME braille line as the
surrounding uncontracted text).

**Classification:** not built — a real, missing primitive (an inline TN segment type), not a
judgement call; the block-level TN mechanism it would parallel already exists and is proven
elsewhere (11.7.1a, 17.11.1d, 17.13.2, etc., all cited in `standards-map.md` as "done"/generic).

**Test that would prove a fix:** a segment `{type:'tn', text:'...'}` (or similar) inside a
paragraph's/list item's `segments` renders as `@.<...@.>` inline, with no blank line or margin
change, immediately adjacent to the surrounding translated text.

**Status: not fixed.**

---

## F-212 — No per-item content-length alignment for foreign-vocabulary lists with variable-length preceding articles

**Rules:** BANA 17.7.3a-f (Example 17-2: `la medicina`, `las pastillas`, `el sintoma`, `la tos`
— each entry's preceding article/pronoun is a different length, and every rule a-f is about
computing a shared left margin, from the block's own longest article, so every entry's actual
NOUN starts in the same braille cell, with runovers/subentries offset from that computed
position, not from a fixed per-level margin).

**What Emboss does:** `nestedMargins` (`document.mjs:132-144`) computes `{first, runover}` from
only `level`/`maxLevel`/`mode`/`listStyle` — a fixed, small set of discrete margin pairs, never
from the actual rendered LENGTH of any item's own content. `glossarySegments`
(`document.mjs:996-1008`), the code `<dl>`-based §17.7 word lists actually use (per 17.7.2b/c's
own "done" evidence), likewise has no per-item, content-length-driven margin: every entry gets
the same `first`/`runover` pair from its `level` alone (`document.mjs:1017-1019`). No function
anywhere in `document.mjs` scans a block's items for the longest string and derives a margin
from it (confirmed by `grep -n "longest" Emboss/format/document.mjs`, which returns only
unrelated word-wrap/decimal-alignment comments, none touching list/glossary margins).

**What the standard requires:** the block's own longest article sets cell 1 (17.7.3a); every
item's own initial noun letter must align at the SAME cell across the whole list, so a
`"las "` entry needs a different left margin from an `"el "` entry (17.7.3b/c); each page must
be independently re-aligned (17.7.3d); runovers/subentries are computed two cells from THAT
per-list (or per-page) margin, not from a fixed level-based one (17.7.3e/f).

**Classification:** not built — this is a real formatting feature with no code representation
at all (not judgement: BANA gives an exact, mechanical alignment procedure), distinct from the
already-tracked column/table alignment gaps (F-12, F-18) since it is list/glossary-specific and
driven by string length rather than table geometry.

**Test that would prove a fix:** a `<dl>`/glossary block whose terms are
`"la medicina"`/`"las pastillas"`/`"el sintoma"` (different article lengths) formats with every
entry's noun-initial letter in the SAME cell, that cell computed from the longest article
present, and subentries/runovers offset from it per 17.7.3e/f.

**Status: not fixed.**

---

## F-213 — A print icon/shape marker with no liblouis mapping is not "devised" as a transcriber-defined symbol; it leaks a raw hex escape into the braille stream

**Rules:** BANA 17.5.1 ("...follow print for the symbol used. If a print symbol does not have a
corresponding symbol in braille, devise a symbol using a shape indicator or a
transcriber-defined symbol indicator."), 17.5.1a (begin the symbol/icon in cell 1), 17.5.1d
(list symbols/icons on the Special Symbols page or in a transcriber's note).

**What Emboss does:** `formatList` (`document.mjs:515-556`) special-cases exactly one marker,
the plain bullet `'•'` (`item.marker === '•'` → `UEB_BULLET`, `document.mjs:544-545`); every
other marker string is passed straight to `o.translate()` as ordinary text
(`document.mjs:549`). For a marker character with no entry in the liblouis UEB table (a print
icon such as a pencil glyph), liblouis's own fallback for an untranslatable character emits a
literal escape sequence rather than any braille sign.

**Reproduced** (`probe.mjs`, TEST F — a list item marked with U+270F PENCIL, not the plain
bullet): the marker renders as
```
'\X270F' (T5 MISSPELL$ ^WS
```
— the raw string `\X270F` (a hex-escape leak, not a braille cell) appears directly in the BRF
output, immediately followed by the item text with no intervening space (the assumed "at least
one space" of 17.5.1a is not honoured either, since nothing recognises this as a symbol needing
its own spacing rule). There is no shape-indicator or transcriber-defined-symbol generator for
an arbitrary icon anywhere in `document.mjs` — the only transcriber-defined symbol Emboss can
produce at all is the single hardcoded print-asterism substitute (`TD_SYMBOL_1`,
`document.mjs:92-111`; this is also F-89's "no generalised Special Symbols page" gap).

**What the standard requires:** an icon with no braille equivalent must be *devised* as a
shape indicator or transcriber-defined symbol (never left untranslated), begun in cell 1 with
at least one following space, and listed on a Special Symbols page or explanatory TN.

**Classification:** bug/not built — worse than a mere gap, since the untranslatable-character
fallback actively corrupts the braille line with literal escape text a reader would never be
able to interpret.

**Test that would prove a fix:** a list item marked with any Unicode icon/shape with no direct
UEB mapping formats with a devised shape/transcriber-defined symbol (never a raw `\XHHHH`
escape) in cell 1 followed by at least one space, and the symbol is listed (Special Symbols
page or a TN) before its first use.

**Status: not fixed.**

---

## Coverage note — rows resolved by existing findings, not duplicated here

- **17.2.2a**, **17.7.2a** (ignore font attributes/typeface for an entire spelling/vocabulary
  word list): **F-88** (BANA 5.3.7, "ignore font attributes when an entire vocabulary or
  spelling words list is emphasized" — `formatList` never strips decorative typeform).
  Reproduced fresh for both code paths this reassessment needed: `probe.mjs` TEST A
  (`formatList`/`<list type="pl">`, output `^1BRA9` / `^1/RANG]` / `^1GLOBE` — bold kept on
  every item) and `probe3.mjs` TEST E (`formatGlossary`/`<dl>`, output
  `.7EL M$IO AMBI5TE.'3 5VIRON;T` — italic kept on the foreign entry word), confirming F-88's
  root cause (no stripping call, ever, outside headings/stage directions) reaches the
  glossary/`<dl>` code path too, not only `formatList` itself.
- **17.6.1a** (ignore entry word font attributes, *except* when distinction is required):
  **F-83** (BANA 5.3.11, near-identical wording, "ignore font attributes for entry words in
  alphabetic references, unless required for distinction"). Reproduced fresh via
  `probe3.mjs` TEST D (`formatGlossary`, bold entry word `doctor` — an ordinary,
  non-distinctive term — rendered as `^1DOCTOR^'3 A PHYSICIAN`, bold retained), extending
  F-83's diagnosis (previously demonstrated only via a markdown-parsed paragraph, "Gift tax")
  to the `<dl>`/glossary code path §17.6 actually uses.
- **17.2.2g** (long spelling lists may be changed to columns): **F-34** ("No side-by-side
  column-list layout... always collapsed to a single column"). Reproduced fresh
  (`probe.mjs` TEST G, `block.columns:2` on a 4-item list): every item still renders on its own
  line, one per row — the `columns` field is silently ignored.
- **17.5.1c** (transcribe multi-column *marked* lists vertically): the SAME F-34 behaviour
  (always-vertical rendering) happens to be exactly what this rule asks for, so it is cited as
  confirming evidence for a "done" status here, not a gap — the opposite of its role for
  17.2.2g.
- **17.2.2e**, **17.4.1d** (phrase clause: "leave TWO blank cells" between contracted and
  uncontracted phrases): **F-124** ("Runs of multiple spaces collapse to one, so BANA's
  'three blank cells' wide-spacing convention cannot be produced"). Reproduced fresh
  (`probe2.mjs`): a list item phrase-pair authored with 2 *or* 3 literal spaces between the
  contracted and uncontracted forms both collapse to exactly one blank cell in the output
  (`GD MORN+ ;;;GOOD MORNING;'`) — confirming F-124's root cause (`groupSegments`'s
  `text.replace(/[^\S\n]+/g,' ')`, `document.mjs` ~line 673, plus the same
  `replace(/\s+/g,' ')` normalisation repeated throughout `input/parse.mjs`'s own text
  extraction) is general-purpose and reaches ordinary list items, not only the verse/poetry
  path F-124 was originally measured against. The SINGLE-blank-cell case (17.2.2e/17.4.1d's
  single-word clause) is unaffected and works correctly (`probe.mjs` TEST B1:
  `BRA9 ;;BRAIN`, exactly one blank cell for one authored space).

---

## Everything else marked "done" here: mechanism confirmed by direct probe, no new finding needed

Summarised, not repeated at length: the underlying "contracted first, then an
`uncontracted:true` repeat" segment mechanism (17.2.2c/d, 17.3.2/17.3.3, 17.8.1, 17.9.2,
17.10.2/17.10.3, 17.11.1a-d, 17.11.2a/c, 17.12.1a/c/d, 17.12.2a, 17.13.1a) is real, wired to a
genuine grade-1 liblouis table (`Emboss/engine/louis.mjs` `TABLES.uebG1`), and produces
correct, well-formed BRF for every construct probed. Three probes matched the standard's own
worked braille byte-for-byte: `probe4.mjs`'s asterisk-omission word `S"9"9"9"9"9"9"9D` (BANA's
own Example 17-5: `s"9"9"9"9"9"9"9d`), its hyphen-run omission word `;S-------;D` (Example
17-6: `;s-------;d`), and `probe5.mjs`'s arrow symbol `;\O` inside an uncontracted word-formation
item (matching Sample 17-17/17-18's own documented arrow convention `.=\o`). Ordinary
punctuation/enclosure symbols (`<`, `>`) and mathematical signs (`+`, `=` → `"6`/`"7`, matching
Sample 17-15/17-17's own symbol table) all pass through `translate()` faithfully
(`probe5.mjs`). Definition lists never auto-repeat their term in uncontracted form
(`probe5.mjs` TEST "Definition list plain") — 17.6.1's own requirement is simply the absence of
a feature Emboss doesn't have, so it is trivially satisfied.

One residual, narrower gap, not written up as a full separate finding since it only fires in a
rare edge case: **17.8.1a** ("do not divide a syllabified word between lines unless too long...
must be at a syllable break") is correct when print separates syllables with SPACES (BANA's own
Example 17-3, `en er gy` — `wrapCells`, `Emboss/format/layout.mjs:7-57`, only ever breaks a
line at an existing space, so a forced break always lands on the syllable boundary; reproduced,
`probe6.mjs`, width 10: `EN ER` / `GY`). It is NOT correct when a syllabified word uses hyphens
with no spaces at all (`brink-man-ship`, BANA's own Sample 17-10 wording): forced to wrap,
`wrapCells`'s hard-chunk fallback (`layout.mjs:33-43`) slices the string at an arbitrary
character position with no awareness of the hyphens, reproduced at width 10 as `BRINK-MA` /
`N-SHIP` — splitting the middle syllable "man" between its "a" and "n", not at a hyphen. Marked
`partial` in the map for this reason; a fix would teach `wrapCells` (or a syllable-aware caller)
to prefer breaking at a literal hyphen/dot inside an otherwise-unbreakable "word" before falling
back to a raw character-count chunk.

---

# Standards findings — plays, cartoons and graphic novels, reassessed rows (BANA §14) (assessed 17 Sep 2026)

## F-214 — Multi-volume cast-of-characters repetition and title-page page-number transposition not implemented

**Rules:** BANA 14.2.2, 14.2.2a, 14.2.2b, 14.2.2c, 14.2.2d

> "14.2.2 When a play is longer than a single volume: a. Repeat the cast of characters in
> each volume of the continued play. b. Include the repeated cast of characters in print
> page number order in the front matter pages. c. Include the print page number on the front
> matter page. d. Include the transposed print page numbers for the repeated cast of
> characters on the title page."

**What Emboss does:** `formatVolumes` (`Emboss/format/document.mjs:3671-3690`) splits an
already-assembled sequence of body pages into volumes purely by page count; the TOC/prelim
pages it builds (`b.tocPages`) "ride with volume 1" only (line 3669's own comment) and are
never rebuilt or duplicated for volume 2, 3, etc. There is no code anywhere in
`document.mjs` that detects a cast-of-characters block, re-inserts it into a later volume's
front matter, or computes/transposes print page numbers onto a title page (`grep -n
"front matter\|title page\|transpos"` over `format/document.mjs` returns nothing).

**What the standard requires:** Each volume of a multi-volume play must open with its own
copy of the cast of characters in the front matter, each entry showing its own print page
number, and the title page listing the transposed print-page ranges covered.

**Classification:** feature absent / not done

**Test that would prove a fix:** A play long enough to split into two volumes (`formatVolumes`
with a small `o.volumePages`), asserting the cast-of-characters list (and its print page
numbers) appears in volume 2's front matter, and that volume 2's title page lists the
transposed print pages for that repeated section.

---

## F-215 — Font attributes are never omitted from a scene-setting paragraph

**Rules:** BANA 14.3.1d

> "d. Omit font attributes unless needed for distinction."

**What Emboss does:** A scene setting has no dedicated block type (`grep -n -i "scene"` over
`format/document.mjs` and `input/parse.mjs` returns nothing); it is authored as an ordinary
`para` block. `formatPara` (`Emboss/format/document.mjs:636-649`) never calls `stripEmphasis`
— unlike `stageParts`/`formatStage` (§14.4.1c) or heading formatting, which explicitly strip
emphasis. Probed directly (BANA 40×25, real liblouis uebG2):

```
<p>[A room in the palace.] <em>Evening.</em></p>
```
renders as
```
  .<,A ROOM 9 ! PALACE4.> .1,EV5+4
```
— `.1` is the UEB italic-word indicator: the `<em>` on "Evening." is retained verbatim, with
no way to tell Emboss the emphasis is stylistic only and should be dropped.

**What the standard requires:** Emphasis on scene-setting text that isn't needed to
distinguish it from surrounding text must not appear in the braille at all (default: omit).

**Classification:** bug / not done

**Test that would prove a fix:** A scene-setting paragraph carrying non-distinguishing
`<em>`/`<strong>` emphasis, formatted with the emphasis indicators absent from the output.

---

## F-216 — Two blank spaces between a speaker's/character's name and dialogue collapse to one

**Rules:** BANA 14.5.1d, 14.6.1e, 14.10.3c, 14.10.5a, 14.10.5c

> "Insert two blank spaces between speaker names and dialogue if print shows no distinction
> between the names and the dialogue…" (14.5.1d; verbatim also at 14.6.1e, 14.10.3c)
> "a. Using 1-3 margins, begin dialogue with the character's name followed by two spaces."
> (14.10.5a)
> "c. When the dialogue is continued in another frame, repeat the character's name, followed
> by two spaces." (14.10.5c)

**What Emboss does:** `groupSegments` (`Emboss/format/document.mjs:657-696`) collapses every
run of non-newline whitespace in a text segment to a single space before translation
(`t = String(seg.text ?? '').replace(/[^\S\n]+/g, ' ')`, line 673). Probed directly (real
liblouis uebG2, `formatBlock`):

```js
{ type: 'play', subtype: 'prose', style: 'play-speaker', level: 0,
  text: 'HAMLET  To be, or not to be.' }   // two spaces typed between name and dialogue
```
renders as
```
",,HAMLET ,TO BE1 OR N TO BE4"
```
— a single blank cell, not two, regardless of how many spaces the transcriber types into the
source. There is no other mechanism (attribute, block boundary, etc.) available to request
two blank cells here.

**What the standard requires:** Exactly two blank cells must separate the name from the
dialogue in this situation (and after a repeated name continuing a cartoon frame).

**Classification:** bug / not done

**Test that would prove a fix:** A `play-speaker` block whose speaker name has no print
distinction from its dialogue, formatted with exactly two blank cells (not one) between them.

---

## Rows resolved without a new finding (cited existing findings)

- **BANA 14.5.1b, 14.6.1c** ("If print uses both full capitalization and emphasis to show
  speaker names, retain the capitalization and omit the emphasis") restate 14.1.4's rule for
  prose and verse plays respectively and fail for the same reason: see
  `standards-findings.md` **F-178**.
- **BANA 14.7.1** ("Dialogue… i.e., 1-3 margins for the prose sections and 1-5, 3-5 margins
  for the verse sections") — the prose margins are correct; the verse margins inherit the
  same `nestedMargins('poetry', …)` bug as verse plays proper: see `standards-findings.md`
  **F-180**.

---

# Standards findings — codes and puzzles (BANA §19) (assessed 17 Sep 2026)

## F-217 — No code anywhere recognises any §19 construct

Exhaustive grep across `Emboss/format/document.mjs`, `text-style.mjs`, `layout.mjs`,
`Emboss/input/parse.mjs`, `Emboss/input/nimas-export.mjs`, `Emboss/web/editor/editor.mjs`,
and the tactile-graphics files (`tactile-svg.mjs`, `tactile-display.mjs`) for "puzzle",
"crossword", "sudoku", "morse", "linear key", "code character" and "grid" (in the puzzle
sense) returns zero hits anywhere outside this project's own rule-text comments. There is no
`case` in `formatBlock`'s switch (`document.mjs:2056-2106`) for any of these; the only
two block types that could plausibly carry devised/uncontracted puzzle content at all are the
generic `'para'` and `'code'` block formatters (`formatPara`, `formatCodeBlock`), neither of
which knows anything about a puzzle, code, or grid.

**Classification:** bug/gap (a whole rule section is unimplemented). This finding underlies
"not done" for every row below unless a *generic*, pre-existing mechanism happens to satisfy
that specific rule (see F-218).

---

## F-219 — Every existing text path collapses multi-space grid alignment and discards a
line's own leading indentation

`wrapCells` (`Emboss/format/layout.mjs:7-53`), used by both `formatPara` and
`formatCodeBlock` (the only candidate block types), tokenizes its *already-translated* string
by splitting on `' '` and filtering empty entries (`braille.split(' ').filter(w=>w.length>0)`),
then rebuilds each line by joining words with exactly one space and re-applying its OWN fixed
`firstIndent`/`runoverIndent`. Two consequences, both confirmed live:

- **Multi-space runs collapse to one space.** `louis.translate()` itself does NOT collapse
  whitespace (`assess-19/probe2.mjs`, `multi-space-g1`: `"a    b    c    d"` →
  `"A    B    C    D"`, spacing intact) — but the SAME text through `formatPara`
  (`assess-19/probe1.mjs`, "para-with-multi-space-grid") or `formatCodeBlock`
  ("code-block-column-alignment": `"a    b    c    d\n#a   #b   #c   #d"` → `"A B C D"` /
  `"_?A _?B _?C _?D"`, both single-spaced) loses it. Any rule needing exact column spacing —
  a linear-key code-character/letter alignment (19.2.2d/e), a crossword/word-search grid's
  "same number of spaces as squares" (19.5.3g), doubled wide-puzzle columns (19.5.3e), or
  Morse's "three blank cells between words" (19.4.1c) — cannot survive either path.
- **A line's own leading whitespace is discarded and replaced with the block's configured
  margin**, since `wrapCells` always re-applies `firstIndent`/`runoverIndent` rather than
  preserving a line's original indentation. This makes it structurally impossible to
  reproduce an irregularly-shaped puzzle's print letter placement (19.6.1f) or a
  flower/animal-shaped grid squared off with print-driven offsets (19.5.3a) through either
  block type.

**Classification:** gap. **Status:** not done (rules listed above).

---

## F-220 — The "dot locator for use" (RUEB §3.14 / §5.4.3) is never emitted

BANA 19.2.2a and 19.2.2g both require the dot locator for "use" (⠐⠐⠿) immediately before a
grade 1 passage indicator/terminator placed on its own line; RUEB §5.4.3 makes this
mandatory whenever the "separate line" method is used ("When this method is used, precede
each indicator by the dot locator for 'use'"), which 19.6.1b invokes too. The only code that
already puts a grade-1 passage indicator/terminator on its own line, `formatCodeBlock`
(`Emboss/format/document.mjs:1894-1909`), emits the bare `G1_PASSAGE_OPEN`/`G1_TERMINATOR`
constants (`';;;'` / `";'"`, `document.mjs:19`) with nothing preceding them. No dot-locator
constant or helper exists anywhere for this purpose — the ONE dot-locator Emboss does
implement is the *different* "dot locator for mention" (§3.13, ASCII `.=`), hardcoded to the
narrow `tdSymbolNote`/asterism case (`document.mjs:101-109`, comment: "the symbol preceded by
the dot locator for mention (.=)"); grep for "dot locator" / "dotLocator" across every `.mjs`
under `Emboss/` finds no "use" variant at all.

Reproduced (`assess-19/probe1.mjs`, "code-block-linear-key-like"): lines 2 and 5 of the
output are bare `[;;;]` and `[;']`.

**Classification:** bug (a required indicator is silently omitted wherever this mechanism is
the closest available one). **Status:** not done (BANA 19.2.2a, 19.2.2g, 19.6.1b).

---

## F-221 — No inline/embedded transcriber's-note mechanism exists — only whole-block notes

BANA 19.5.2e-g require a crossword clue's column-letter/row-number (and, per 19.5.2g, the
optional letter count) to be enclosed in an "embedded" transcriber's note on the SAME line as
the clue, immediately after it; 19.6.1e requires an embedded "(cont.)" note on a puzzle's last
line. Emboss's only transcriber's-note mechanism, `formatTranscriberNote`/`case 'note'`
(`document.mjs:818-824`), is a standalone BLOCK that wraps `TN_OPEN`/`TN_CLOSE` (`@.<`/`@.>`,
BRF indicators spliced in AFTER translation, `document.mjs:18`) around its own content,
always on its own line(s). No segment type or inline markup recognised by any
paragraph/list-item formatter (`segmentsToBraille`, `cellSegments`, `parse.mjs`'s inline-tag
set) lets a list item's own text embed a mid-line TN — `noteref` is a footnote/endnote
POINTER, a different mechanism entirely; grep for an inline/embedded-note segment type
across `document.mjs`/`cell-markup.mjs`/`parse.mjs` finds none. A transcriber cannot
approximate this by typing the literal `@.<`/`@.>` characters into print source text either,
since those are BRF-level sentinels added only after translation, not print text a document
model carries through unmolested.

The clue-suffix TEXT itself (the letter/row-number, and the optional count) is otherwise
trivial to append to a clue's plain text — reproduced (`assess-19/probe3.mjs`,
"list-clue-with-suffix": `"Parent's female (a1) (6)"` → `,P>5T'S FEMALE "<A#A"> "<#F">`,
correctly translated — just without the required TN enclosure).

**Classification:** gap. **Status:** not done (19.5.2g, 19.6.1e); 19.5.2e/19.5.2f are
separately "done, mechanism only" for the text-placement half (see F-218).

---

## F-222 — No facility to author a raw/devised braille cell exists outside two narrow,
hardcoded special cases

19.2.1b needs an arbitrary transcriber-devised symbol; 19.5.3d needs the "full cell" (all six
dots); 19.7.1a needs UEB line-mode's horizontal/vertical rule cells. Ordinary print text
routed through `louis.translate()` cannot produce these on demand — reproduced
(`assess-19/probe2.mjs`, `literal-equals-g1`): a literal `"="` character (chosen because BRF
ASCII `'='` is the full-cell code point, `Emboss/engine/brf-ascii.mjs:3`, `BRF64` index 63)
translates to `'"7'` (the UEB equals sign), not a bare full cell. Two mechanisms in the
codebase DO inject a raw, untranslated BRF sequence directly — `TD_SYMBOL_1 = ';?'`
(`document.mjs:93`, a devised symbol for a print asterism) and `tableSeparator`'s
`TABLE_GUIDE`-based dot-5/dot-25 line (`document.mjs:832-838`, the UEB line-mode mechanism
19.7.1a would need) — but both are hardcoded to their one existing caller (`kind ===
'asterism'`; table rendering only) and are not exposed for a puzzle/grid block to reuse.

**Classification:** gap. **Status:** not done (19.2.1b, 19.5.3d, 19.7.1a).

---

## F-223 — Pagination has no awareness of puzzle/grid content

19.1.2 (single-page-fit/facing pages), 19.5.3h/i/j/k (grid page-fit, continuation-page
column-letter repeat respecting the page-number line, facing/continued pages, interpoint
facing pages for grid+clues) and 19.6.1e (per-page "(cont.)") all need pagination to
recognise a puzzle/grid as a unit. `page.mjs`'s `assemble()` (`page.mjs:140-256`) chunks
lines purely by count with no block-type awareness at all; the only block-aware pagination
hook anywhere, `keepGroupIndex`/`applyPageBoundaries` (`document.mjs:2206-2312`), is used
solely by `formatListed`'s row-keep-together groups and never sees a puzzle/grid (which
doesn't exist as a block type per F-217 in any case).

**Classification:** gap. **Status:** not done (rules listed above).

---

## F-218 — Generic mechanisms that already work for parts of this section (positive
findings)

Several §19 rules are satisfied — not by any §19-specific code, but because a pre-existing,
general-purpose mechanism happens to do the right thing when the transcriber authors the
content directly:

- **Standalone transcriber's notes** (19.2.1c, 19.2.1d [TN option], 19.2.2f, 19.3.1d,
  19.4.1a [TN option], 19.5.1, 19.5.3a [TN half], 19.5.3j [TN half], 19.5.3l) via
  `formatTranscriberNote`/`'note'` — the same "type arbitrary wording, Emboss doesn't invent
  it" mechanism as every other section's model finding (e.g. §11's 11.2.7a/b). The "Special
  Symbols page" alternative named in 19.2.1d/19.4.1a is NOT built (`document.mjs:101`:
  "Until the Special Symbols page exists (G8)…"), so those two rows are **partial**, not
  done, despite the TN half working.
- **"Follow print when there are braille equivalents"** (19.2.1a) and the whole of 19.4.2
  ("follow print" for Morse sound-syllables, plus 19.4.2a-d) need no code at all: ordinary
  pass-through translation renders whatever the transcriber types, and (unlike 19.4.1's
  dot/dash form) 19.4.2's hyphen-joined-syllable representation never needs more than a
  single space between tokens, so it does not trip F-219's collapse.
- **Uncontracted (grade-1) text runs** (19.3.1e, 19.5.2d, 19.6.1a) via a segment marked
  `uncontracted:true`, handled generically by `translateLine`/`segmentsToBraille`
  (`document.mjs:748-769`). Reproduced (`assess-19/probe3.mjs`,
  "para-with-uncontracted-segment"): `"stdgf"`/`"kqwwoz"` come out as `;;STDGF`/`;;KQWWOZ`
  (correct grade-1 word indicator + letters).
- **Numbers joined by hyphens** (19.3.1a): reproduced (`assess-19/probe2.mjs`,
  `numbers-hyphen-g1/g2`) `"7-4-33-12"` → `"#G-#D-#CC-#AB"` — each side of a hyphen
  automatically gets its own numeral sign, matching the pattern in BANA's own Example 19-1
  (`#g-#d-#cc-#ab-#h-#ae …`) exactly. Ordinary UEB numeral behaviour, no §19 code needed.
- **A literal hyphen or underscore survives translation as the correct isolated symbol**:
  `"-"` → `"-"` (dots 3-6, UEB hyphen sign) and `"_"` → `".-"` (RUEB §7.2 low
  line/underscore, dots 4-6 + 3-6) — confirmed against `braille-formats-2016.txt`'s own
  symbols-list, line 18516: "`.-` Low line, Underscore" (`assess-19/probe2.mjs`,
  `underscore-alone-g1/g2`, `hyphen-alone-g1/g2`). This covers 19.3.1g and 19.7.1d directly.
  Single-letter grade-1 indicators (19.3.1f, "may be required… per general contraction
  rules") are likewise ordinary, unmodified UEB behaviour — reproduced
  (`assess-19/probe2.mjs`, `letters-a-to-e-g2`: `"a b c d e"` → `"A ;B ;C ;D ;E"`, automatic
  letter-indicator insertion before ambiguous single-letter contractions).
- **Cell-5 heading tier** (19.5.2b, "Across"/"Down") via the generic BANA
  heading-level-2-is-cell-5 mapping (`banaTier`, `document.mjs:278-282`) — reproduced
  (`assess-19/probe3.mjs`, "across-down-cell5-heading").
- **1-3 margins for a list** (19.5.2c) via the generic BANA single-level list margin default
  (`nestedMargins`, `document.mjs:132-144`: level 0 → `first:0, runover:2`, i.e. cell 1 /
  cell 3) — no puzzle-specific code needed.
- **Clue text placement** (19.5.2a "place clues before the grid" — ordinary document block
  order is preserved faithfully, same reasoning as §11's 11.2.8a; 19.5.2e/19.5.2f, the
  column-letter/row-number/letter-count TEXT — trivially appended to a clue's own text, see
  F-221 for why the required TN *enclosure* is separately not done).
- **Single blank cell / no forced word-splitting** (19.3.1b/c, 19.4.1b, 19.4.2b): ordinary
  single-space word separation and `wrapCells`'s never-split-a-word behaviour (unless one
  token alone exceeds the page width — the same "hard-chunk" fallback already gold-verified
  elsewhere, e.g. `table_no_word_division.test.mjs`) already do the right thing.
- **No forced blank lines between a code block's own lines** (19.6.1d): `formatCodeBlock`
  pushes each wrapped line back-to-back with no inserted blank (`document.mjs:1904-1906`),
  and `wrapCells`'s own `'\n'` handling likewise never forces a blank between non-empty
  paragraph lines.
- **A trailing blank line after a code block** (19.2.2h, the "blank line" half):
  `formatCodeBlock` already always appends `''` after `G1_TERMINATOR`
  (`document.mjs:1907`); the "or closing box line" alternative is available generically via
  `formatBox`.
- **Sudoku's own single-space digit/underscore body** (19.7.1c, 19.7.1d): unlike a
  crossword/word-search grid, a Sudoku row never needs more than one space between tokens,
  so it does not trip F-219. Reproduced (`assess-19/probe4.mjs`, "sudoku-row-as-para"):
  digits translate correctly with their own numeral sign (`"1"` → `"#A"`, `"8"` → `"#H"`)
  and an underscore for an empty square comes out `.-`, matching Sample 19-7's own rendering,
  with every token's single-space separation intact. 19.7.1b ("do not enclose in boxing
  lines") is true **by omission**, the same reasoning §11's model gives for 11.5.5/11.6.3:
  Emboss never wraps content in a box unless a `box` block is explicitly used.

**Classification:** n/a (positive findings, not bugs). These are cited as "done, mechanism
only" in `standards-map.md` — none of them is §19-specific automation; every one depends on
the transcriber authoring the content correctly by hand.

---

## F-224 — Morse's devised dot/dash symbols translate correctly in isolation, but nothing
preserves the spacing that makes them readable as Morse

BANA 19.4.1's "4"/"-" symbol definitions are this reference manual's OWN ASCII-braille
notation (`braille-formats-2016.txt` uses the same BRF/NABCC convention throughout — compare
`document.mjs`'s `TABLE_GUIDE = '"'` for dot 5, confirmed against the codebase) for two real
UEB symbols: `braille-formats-2016.txt` line 18466 lists ASCII `4` as "Period, Full stop,
Decimal" (dots 2-5-6) and line 18511 lists `-` as "Hyphen" (dots 3-6). Reproduced
(`assess-19/probe2.mjs`, `morse-period-hyphen-g1/g2`): a literal period `"."` and hyphen
`"-"` translate to exactly `"4"`/`"-"` in both grade-1 and grade-2 mode — so the devised
symbols themselves ARE reachable by typing ordinary punctuation. However:

- 19.4.1c's three-blank-cell word separator collapses to one blank cell through both
  `formatPara` and `formatCodeBlock` (F-219), making a Morse "word" indistinguishable from
  a Morse "letter" once formatted — reproduced (`assess-19/probe2.mjs`,
  `morse-word-3space-g1`: raw `translate()` alone preserves the 3-space gap, `". - ."` +
  3 spaces + `"- . -"` → `"4 - 4"` + 3 spaces + `"- 4 -"`, but that string still has to pass
  through `wrapCells` in either candidate block type, which discards the distinction).
- 19.4.1d ("do not divide words between lines") cannot be honoured either, once
  19.4.1c's collapse has erased where one Morse word ends and the next begins:
  `wrapCells` treats every single-space-separated symbol group as its own independently
  wrappable "word" token, with no concept of a multi-symbol Morse word that must stay
  together.
- 19.4.1b ("one blank cell between symbols within a word") is separately satisfiable on its
  own terms (ordinary single-space survives) — but combined with 19.4.1c's failure, the
  output cannot be told apart from a run of single-letter Morse "words".

**Classification:** bug/gap, root cause shared with F-219. **Status:** not done (19.4.1c,
19.4.1d); 19.4.1b done in isolation (noted above, cross-referenced).

---

## Coverage note

Every row of `standards-map.md`'s §19 section whose Emboss status is `partial` or `not
done` is traceable to exactly one of F-217 through F-223 or F-224 above (a rule
citing more than one — e.g. 19.5.3a citing both F-217/2 and, for its TN half, F-218 —
is marked `partial`, not `not done`, when at least one half is genuinely satisfied).
Headings, definitions, and cross-reference rows are `not-applicable` throughout and are not
findings. The worked-examples table (Samples 19-1…19-7, Examples 19-1…19-5, and the embedded
unnumbered TN-wording samples) is `not tried`: this task is Stage 2 (Assess); no gold model
builder exists yet for §19 in `Emboss/scripts/gold-run.mjs`, and building/running one is
Stage 3/4 work, out of scope here.

---

# Standards findings — exercise material, reassessed rows (BANA §10) (assessed 17 Sep 2026)

## F-225: Write-on-line devices before/after exercise questions are never omitted

BANA Formats §10.5.1: "Omit lines, dashes, circles, boxes, or other print devices printed
before or after questions, indicating where students are to answer questions."

Emboss's `bai-exercise` list-item parser (`Emboss/input/parse.mjs:2310-2318`) captures an
item's full text/segments verbatim with no filtering; nothing in `parse.mjs`/`document.mjs`
recognises "a print device that indicates where a student writes an answer" as a category to
strip. Any such device that reaches Emboss as literal characters (e.g. a run of underscores
or dashes placed before or after a question purely to show writing space, as in the
standard's own Examples 10-9/10-10) is transcribed unchanged instead of omitted.

**Classification:** not done (gap; whether this needs code or is properly a transcription-time
content decision is exactly the open question this reassessment could not resolve from the
rule text alone — see Q-74 in `questions-10.md`).

---

## F-226: No mechanism to synthesize an embedded transcriber's note for exercise write-on-lines or missing matching-column headings

Four rules require Emboss to synthesize *new* content — a count, an explanatory sentence, or
a heading derived from a directions paragraph's own wording — and wrap it in the UEB
transcriber's-note indicators:

- BANA §10.5.2: "insert the number of expected answers in an embedded transcriber's note"
  following a question, when unnumbered/unlettered write-on-lines don't otherwise state the
  count.
- BANA §10.6.8: use an underscore/dash followed by the enclosed word or phrase, "Insert a
  transcriber's note to explain this usage."
- BANA §10.6.10: when print shows a question mark over an underscore/dash, drop the question
  mark and "Insert a transcriber's note explaining this usage."
- BANA §10.9.2b: when a converted matching-columns list has no print heading, "insert a
  heading, enclosed in transcriber's note indicators, using terms suggested in the
  directions."

Emboss's `bai-exercise` item parser (`Emboss/input/parse.mjs:2310-2318`) has no code path
that counts write-on-lines, detects a question-mark-over-underscore pattern, or derives
heading text from a directions paragraph. No inline transcriber's-note wrapping (`TN_OPEN`/
`TN_CLOSE`, `Emboss/format/document.mjs:16-18`) is ever applied to exercise-item content —
contrast the dedicated `formatTranscriberNote`/`traceOrFormatPrintImage` machinery used
elsewhere (`document.mjs:788-819`, `1943-1980`), neither of which is wired to exercise list
items at all.

**Classification:** not done (missing mechanism; covers BANA 10.5.2, 10.6.8, 10.6.10, 10.9.2b).

---

## F-227: A word list for multiple questions is never repositioned before the first question

BANA Formats §10.7.2e: "Regardless of print location, place the word list before the first
question." (See the standard's own Sample 10-6, "Word List Moved.")

Emboss renders whatever block order the source document gives it (the linear `blocks` walk
in `formatDocument`, `Emboss/format/document.mjs`); nothing recognises a "word list for
multiple questions" as a distinct construct or moves it ahead of the first question it serves
when print places it elsewhere. Getting this right depends entirely on how the transcriber
orders the source blocks, with no check or correction from Emboss.

**Classification:** not done.

---

## F-228: No conditional emphasis suppression or same-line label/number split for exercise examples

BANA Formats §10.8.2 requires emphasis to be dropped from a label identifying an
example/model/sample-with-answer specifically when the label is followed by punctuation
(contrast §10.8.1, where emphasis is kept when the label is *not* followed by punctuation,
which Emboss's unconditional retention already satisfies). `formatList`
(`Emboss/format/document.mjs:515-556`) never strips a segment's `tf` typeform, and no code
anywhere conditions emphasis retention on trailing punctuation (confirmed by grep of
`document.mjs`) — so the punctuation-triggered suppression case can never be produced.

BANA Formats §10.8.5 requires a label and a numbered item that print shows on the same
line to be split onto separate lines, with every numbered item then sharing one starting
cell and the label kept in cell 1. No code anywhere detects a label sharing a source line
with a numbered item, or re-flows it onto its own line.

**Classification:** not done (covers BANA 10.8.2 and 10.8.5 — two distinct label-handling
gaps with the same root cause: exercise-item text is opaque, unstructured content to Emboss).

---

## F-229: Pictures inside exercise material are dropped, not converted to a transcriber's note

BANA Formats §10.11.1: "An embedded transcriber's note (TN) with a brief description is used
in material that is partially or totally pictures." §10.11.3: a transcriber's-note indicator
in cell 7 before the word "Pictures", closed after the last entry, for a separate all-picture
portion of an exercise.

`inlineSegments` (`Emboss/input/parse.mjs:1937`) discards any inline `<img>`/`<image>`
element found inside a list item — including a `bai-exercise` item — with `breakWord();
continue;` and captures no alt text or description at all, unlike the dedicated illustration
path (`traceOrFormatPrintImage`, `Emboss/format/document.mjs:1943-1980`) used for standalone
image blocks.

**Reproduction** (`probe-exercise-reassess.mjs`, part H): a `bai-exercise` item built from

```xml
<li class="bai-exercise">The <img src="butterfly.jpg" alt="butterfly"/> flew south for the winter.</li>
```

parses to `{ "text": "The  flew south for the winter." }` — the image is silently gone, no
`alt` text captured — and formats to `",! FLEW S\\? = ! W9T]4"` with no TN at all, where
BANA's own Example 10-31 requires `,! @.<butt]fly@.> flew s\? = ! w9t]4` (`references/_text/
braille-formats-2016.txt` lines 7853-7855).

There is also no cell-7-TN-wrapping mechanism for §10.11.3's "a separate portion of an
exercise is shown as pictures" case — no code inserts a transcriber's-note indicator before
the word "Pictures" or closes one after a run of all-picture entries.

**Classification:** not done (covers BANA 10.11.1 and 10.11.3).

**Status update (18 Sep 2026, §10.11.1 fixed; §10.11.3 still open, unchanged):**
- **Fix:** `inlineSegments` (`Emboss/input/parse.mjs`) takes a new `imageAsNote` parameter;
  when true and an `<img>`/`<image>` is found (via the existing `excludeTags`/`LI_SPLIT_TAGS`
  branch that used to just `breakWord()` past every list-item image) with a non-empty `alt`,
  it becomes a new `{type: 'imgnote', text: alt, src}` segment right where the image sat,
  instead of being dropped; a decorative image with no `alt` still falls through to the old
  `breakWord()` behaviour. The `bai-exercise` item builder (`parseSingleList`) is the only
  caller that passes `imageAsNote: true`, so ordinary/toc/index list items are unaffected. The
  same `<li>`'s own image-to-standalone-`graphic`-block split-out (`liTables`/`emitTables`,
  used by every item kind so a table/image "in the item" becomes its own following block) now
  skips an image already consumed this way, so the picture is represented exactly once, never
  duplicated as both an inline TN and a trailing `graphic` block.
- **Correction (18 Sep 2026, same day):** the first pass only checked `class="bai-exercise"`
  on the `<li>` itself, matching this finding's own reproduction snippet above — but a real
  source can equally mark the WHOLE `<list>` once (`<list class="bai-exercise" type="ol">`
  with plain, unclassed `<li>` children) rather than repeating the class on every item. That
  shape fell through to the ORDINARY ordered-list branch (numbered marker, `imageAsNote`
  never passed), so the image was still silently dropped/split out on that real path even
  though the `<li>`-class unit test was green. Fixed by also computing `listIsExercise` from
  the `<list>` element's own `class` (`parseSingleList`, alongside the existing `isToc`/
  `isIndex` container checks) and taking the exercise-item branch when EITHER the `<li>` or
  its `<list>` carries `bai-exercise`. Reproduced fixed directly: `<list class="bai-exercise"
  type="ol"><li>The <img src="b.jpg" alt="Butterfly"/> flew south for the winter.</li></list>`
  — before, `parseDtbook` gave `{"type":"list","items":[{"text":"The  flew south for the
  winter.","marker":"1."}],"ordered":true}` plus a separate `{"type":"graphic","src":"b.jpg",
  "alt":"Butterfly"}` block, formatting (both modes) to `"1. THE FLEW SOUTH FOR THE WINTER."`
  with `"@.<BUTTERFLY@.>"` on its own line afterwards; after, the item keeps a single
  `imgnote` segment, no `graphic` block is produced, and both BANA and UKAAF format the
  sentence as `"THE @.<BUTTERFLY@.> FLEW SOUTH FOR THE\n  WINTER."` — the note inline where
  the picture was, exactly as BANA Example 10-31 requires. Added as its own case in
  `Emboss/tests/demo_fixes.test.mjs` ("coordinator repro: class=\"bai-exercise\" on the
  `<list>` itself…").
- **Correction 2 (18 Sep 2026, same day) — two further regressions from Correction 1, both
  reproduced and fixed:**
  1. **Exercise items lost their printed number.** Routing a `<list class="bai-exercise"
     type="ol">` with plain `<li>` children into the exercise-item branch (Correction 1)
     meant they no longer passed through the ORDINARY ordered branch's marker synthesis —
     so `{"type":"list","items":[{"text":"…","marker":"1."}],"ordered":true}` became
     `{"kind":"exercise","ordered":true}` items with NO `marker` at all, and the formatted
     braille lost its BANA §10.4 print numbering entirely (in both modes). Fixed by
     synthesizing the exercise item's own marker inside the exercise branch itself
     (`synthesizeOrderedMarker(counter, enumAttr)`, `Emboss/input/parse.mjs`, the same
     helper and `counter`/`enumAttr` the ordinary branch already uses) whenever the list is
     ordered (`isOl`) — but ONLY when the item's own flat text does not already carry a
     literal marker, checked with a new `EXERCISE_MARKER_RE` (`/^\s*\(?(\d+|[a-zA-Z]
     |[ivxlcdm]+)[\.\)]\s+/`, a version of the existing `NUMBER_PREFIX_RE` that also
     accepts a parenthesized form — `nimas_exercise_index.test.mjs`'s own §10.4.2b 3-level
     hierarchy test uses "1.", "a." AND "(1)" markers baked into three different items'
     text in one document, so a synthesis check using only the plain form would have
     double-numbered the parenthesized one; caught by re-running the full suite, not by
     this task's own new tests, and fixed before reporting). The original bai-exercise
     convention (a marker baked into the item's own text, e.g. "1. Which…", kept verbatim
     with no separate `item.marker` field — `Emboss/scripts/gold-run.mjs`'s own documented
     convention) is completely unchanged for any item that already has one.
  2. **The `imgnote` segment did not survive the editor.** `Emboss/web/editor/editor.mjs`'s
     Lexical node set and its two segment ⇄ node conversion points had no case for the new
     segment type, so a document loaded into the editor and re-saved lost the TN indicators
     around the picture description (`",! ,BUTT]FLY FLEW S\? = ! W9T]4"` instead of `",!
     @.<BUTT]FLY@.> FLEW S\? = ! W9T]4"` — the word survived as plain inline text, but the
     wrapping was gone). Fixed by adding a new `ImgNoteNode` (an atomic `TextNode` carrying
     the alt text plus the source `<img>`'s `src`, purely for the round trip — mirrors
     `NoteRefNode`, the closest existing analog: both are "the print already supplies this
     mark/word, keep it as an atomic run" nodes, `editor.mjs` immediately above `NoteRefNode`'s
     own definition), registered in the editor's `nodes:[…]` array, and wired into both
     conversion directions exactly where `noteref`/`linenum` already are: `nodeToRuns`
     (Lexical → model, the shared helper both paragraphs AND list items already call, so a
     `bai-exercise` item's own image note is covered with no separate list-item code path)
     gained an `$isImgNoteNode(child)` case building `{type:'imgnote', text, src?}`;
     `fillFromBlock` (model → Lexical) gained an `else if (s.type === 'imgnote')` case
     alongside its existing `noteref`/`linenum` cases, calling a new `$createImgNoteNode`.
     `editor.mjs` cannot be imported under plain Node (a pre-existing constraint, see F-5),
     so this was verified by reading the code against the `NoteRefNode`/`noteref` pattern it
     mirrors line-for-line, not by an editor unit test, per this task's own instruction; the
     already-verified headless `parseDtbook` → `formatDocument` path (`demo_fixes.test.mjs`)
     was and remains correct on its own — this correction is about the SEPARATE editor
     Lexical model only.
  Re-verified: `node Emboss/scripts/run-all-tests.mjs` (134/134 headless, 0 failures — the
  `nimas_exercise_index.test.mjs` regression above was caught here and fixed before this
  report), `node scripts/run_1000_corpus_benchmark.mjs` (1150/1150), `node
  scripts/run_800_nimas_benchmark.mjs` (800/800, 100% DTD valid). Two new cases added to
  `Emboss/tests/demo_fixes.test.mjs`: the coordinator's exact two-item marker repro, and a
  guard that an already-marked bai-exercise item (the original convention) is not
  double-numbered.
- **Rendering:** `groupSegments`/`segmentsToBraille` and their trace mirror `tcJoined`
  (`Emboss/format/document.mjs`) gained an `imgnote` case: `TN_OPEN + o.translate(text).trim()
  + TN_CLOSE`, with no per-character source (the description comes from the image's `alt`
  attribute, not a position in the item's own print text) — mirroring how
  `traceOrFormatPrintImage`'s own standalone-image description already uses `tcDeco`. No
  "Illustration"/label word is added, matching §10.11.1's own worked example (unlike the
  standalone-figure path's §6.2.2b label, which is a different rule).
- **Export round-trip:** `serializeInlineSegments` (`Emboss/input/nimas-export.mjs`) re-emits
  an `imgnote` segment as `<img src="…" alt="…"/>` (the `src` is carried through on the
  segment purely for round-tripping; the renderer never reads it) — reloading regenerates the
  same `imgnote` segment, not bare alt text loose in the paragraph.
- **Verified against the rule text:** BANA Braille Formats 2016 (`references/_text/
  braille-formats-2016.txt` lines 7853-7855, Example 10-31) — `<li class="bai-exercise">The
  <img src="butterfly.jpg" alt="butterfly"/> flew south for the winter.</li>` now formats
  (real liblouis UEB Grade 2) to `,! @.<BUTT]FLY@.> FLEW S\? = ! W9T]4`, matching `,!
  @.<butt]fly@.> flew s\? = ! w9t]4` exactly but for this project's own established
  uppercase-vs-gold-lowercase convention (see the section-16/section-11 findings' own notes on
  this). `Emboss/tests/demo_fixes.test.mjs` (`describe("F-229 ...")`) covers the finding's own
  reproduction (image survives, no standalone `graphic` duplicate), this exact BANA example
  against the real translator, the export/reimport round trip, a decorative (no-`alt`) image
  regression guard, and `formatBlock`/`traceBlock` parity for the list block.
- **Gold:** `node Emboss/scripts/gold-run.mjs --section section-10` does NOT exercise this fix
  and is unchanged before/after (`match: 8 mismatch: 31 not-representable: 6 no-braille: 3`) —
  this section's own `buildModel10`/`buildBlocks10` (`Emboss/scripts/gold-run.mjs`, another
  agent's concurrent work) represents `example-10-31`'s picture as bracketed literal print
  text (`"The [picture of a butterfly] flew south for the winter."`, run through
  `parseCellMarkup`) rather than a structural `<img>` element, so it never reaches
  `parse.mjs`'s `bai-exercise`/`inlineSegments` code this fix touches at all — the actual gold
  sample's own `not-representable` diagnosis is liblouis's plain UEB translation of the
  literal `[`/`]` characters (`.<`/`.>`, no leading `@`) on the FULL bracket contents ("picture
  of a butterfly"), a different, coincidental mechanism, not this finding's own `@.<`/`@.>`
  transcriber's-note wrapper. Proven instead directly against the rule text/Example 10-31 as
  above, using the real `<img>` construct BANA §10.11.1 and Emboss's real DTBook parser both
  actually use.
- **Still open, unchanged:** §10.11.3 (the cell-7-TN-wrapping "Pictures" run for a separate
  all-picture portion of an exercise) — no gold sample exercises it and it is a distinct
  mechanism from the embedded inline note this pass fixed; left for a future task.

---

# Standards findings — Sidebars (BANA §12; gold-reconciled 17 Sep 2026, section-12)

## F-230: A sidebar's box lines are unconditional — Emboss cannot produce a border-less sidebar

**Rules:** BANA 12.3.1e ("Insert a blank line before and after a sidebar"), 12.3.1f ("Add
box lines for clarity **if** the content of the sidebar interrupts the flow of text" —
conditional wording, not "always"), 12.3.1g (a sidebar "necessary for the understanding of a
particular text" is simply inserted before that text, with no box-line requirement stated at
all).

**What Emboss does:** Every `type:'box'`/`type:'sidebar'` document-model block is formatted by
the single shared `formatBox` (`Emboss/format/document.mjs:948`), via `boxBorders`
(`document.mjs:932`), which unconditionally emits a full-width top and bottom border line
(`7`.../`G`... , or `=`.../`=`... for an exterior box wrapping a nested one) around every box's
content. There is no flag, field, or code path anywhere in `formatBox`/`boxBorders` to omit
the border and fall back to a plain blank-line-delimited insertion.

**What the standard requires (evidence):** BANA Braille Formats 2016, Sample 12-7 ("Word List
in a Sidebar", `references/bana/braille-formats-2016.pdf` p.353, `references/_text/
braille-formats-2016.txt` lines 10188-10206) transcribes its own vocabulary-word-list sidebar
with NO box border at all: the source shows only a blank line, the eight flush-left word/
page-reference lines, and a further blank line — no `7777...7`/`gggg...g` anywhere around
them (confirmed directly against both the source `.txt` and the rendered PDF page image, which
carries the excerpt's own line numbers 1-13). This is consistent with 12.3.1g's own wording
(a sidebar inserted "before the related text" purely for reading-order reasons, with no
mention of box lines) as distinct from 12.3.1f's conditional "for clarity" box-line rule —
BANA's own Sample 12-3 (same section, `Emboss/tests/gold/bana-formats-2016/section-12/
sample-12-3.json`), by contrast, DOES box its own sidebar (a genuinely inserted, flow-
interrupting list), confirming the two sample sidebars are deliberately transcribed
differently, not that one of them is in error.

**Reproduction:** build a `{type:'box', blocks:[{type:'list', kind:'list', items:[{text:'assault, C45'}, ...]}]}` document (or run
`node Emboss/scripts/gold-run.mjs --section section-12 --sample sample-12-7`) and observe that
`formatBox` always adds a 40-cell `7777...7` line immediately before the list and a `gggg...g`
line immediately after it — lines the real Sample 12-7 braille (`Emboss/tests/gold/
bana-formats-2016/section-12/sample-12-7.json`, `braille.lines`) does not have.

**Classification:** bug / not done.

**Test that would prove a fix:** a test asserting that a sidebar/box block, when flagged
(however the fix chooses to signal it — e.g. a `boxed:false` field defaulting to today's
always-on behaviour for backward compatibility) as not requiring box lines, formats as plain
blank-line-delimited content with no `7`/`G`/`=` border row, while an unflagged sidebar/box
keeps today's unconditional border. See `Emboss/tests/gold_bana_section12.test.mjs` and
`Emboss/tests/gold/bana-formats-2016/section-12/README.md` for the full worked-example
evidence trail.

---

# Standards findings — Illustrative Materials (BANA §6; assessed 17 Sep 2026, gold reconciliation)

## F-231 — The transcriber's-note label word for an unidentified illustration is hard-coded to "Illustration", never the print-appropriate word BANA 6.2.2b calls for

**Rules:** BANA 6.2.2b

> "If the original print copy does not identify an illustration, insert a label in a transcriber's note (e.g., photograph, figure, etc.) followed by the text of the caption on the same line." (BANA 6.2.2b)

**What Emboss does:** `traceOrFormatPrintImage` (`Emboss/format/document.mjs`, ~line 1969) decides whether a caption needs a label (`!parts.caption || !IDENTIFIED_RE.test(parts.caption)`) but, when one is needed, always emits the literal English word "Illustration" (`tn('Illustration')`), regardless of what kind of picture it is or what word the source transcription actually uses.

**What the standard requires (evidence):** every one of this section's own worked examples that needs a label uses a picture-appropriate word, never "Illustration": Example 6-1 ("Photograph with Caption") uses `[Photograph]` (`references/bana/braille-formats-2016.pdf` p.146, confirmed by forward-translating the caption text and diffing against the agreed braille — `Emboss/tests/gold/bana-formats-2016/section-6/example-6-1.json`); Example 6-3 uses `[Photograph]` again (p.148, `example-6-3.json`); Sample 6-12's own Ming-dynasty figure uses `[Picture]` (p.174, `sample-6-12.json`). Running `node Emboss/scripts/gold-run.mjs --section section-6 --sample example-6-1` shows Emboss producing `@.<,ILLU/RA;N@.>` where the standard has `@.<,PHOTOGRAPH@.>` — otherwise the two outputs are identical.

**Classification:** bug / not done (the document model has no field to carry the label word at all — `figure.type`/`figure.figure.type` in this gold corpus's own schema records it as documentation only, since nothing in `document.mjs` consumes it).

**Test that would prove a fix:** `Emboss/tests/gold_bana_section6.test.mjs` — `example-6-1`, `example-6-3`, and `sample-6-12` all currently mismatch/are recorded not-representable on exactly this one word; a fix (e.g. reading a `block.figureType`/`block.label` field into the "Illustration" slot) should make the affected lines match. `Emboss/tests/gold/bana-formats-2016/section-6/README.md` has the full worked-example evidence trail.

## F-232 — liblouis's UEB Grade-2 table adds a letter-sign before a single-letter print abbreviation immediately followed by a period, contrary to at least one BANA worked example

**Rules:** none specific — a general UEB Grade-2 translation-fidelity gap surfaced by BANA 6.10.1's own worked timeline example.

**What Emboss does:** `Emboss/engine/louis.mjs`'s `translate()` (the `en-ueb-g2.ctb` table), given the plain text `"c. 1100 Incas settle in Cuzco."`, produces a leading UEB letter-indicator (`;`) before the lone letter `c`: `;C4 #AAJJ...`. This reproduces regardless of surrounding context (tested standalone, mid-sentence, and as the very first word of a longer passage — `Emboss/tests/gold/bana-formats-2016/section-6/sample-6-10.json`'s own `uncertain` entry records the exact experiments).

**What the standard requires (evidence):** BANA Braille Formats 2016, Sample 6-10 ("Timeline with Multiple Events", `references/bana/braille-formats-2016.pdf` p.172, printed page 6-28) transcribes "c. 1100 Incas settle in Cuzco." with NO letter-indicator before the abbreviation: `c4#aajj ,9cas settle 9 ,cuzco4` (confirmed directly against the source `.txt`, `references/_text/braille-formats-2016.txt` line 5063, and the rendered page image).

**Classification:** gap / not done — this is inside the third-party liblouis UEB table Emboss ships, not `document.mjs`'s own document-model code, so a fix (if any) is upstream; recorded here because it makes an otherwise-perfect Emboss reproduction of Sample 6-10 mismatch on this one word.

**Test that would prove a fix:** `Emboss/tests/gold_bana_section6.test.mjs`'s `sample-6-10` case; a fix would make its currently-recorded `mismatch` become `match`.

## F-233 — No construct exists for a second, independent inline "hyperlink" indicator distinct from bold/italic/underline

**Rules:** BANA 6.12.3.b(3)

> "Indicate hyperlinks, which are a word, phrase, or image that can be clicked on to jump to a different location." (BANA 6.12.3.b(3))

**What Emboss does:** `Emboss/format/cell-markup.mjs`'s inline markup DSL, and `document.mjs`'s segment `tf` bitmask (`TF_ITALIC`/`TF_UNDERLINE`/`TF_BOLD`), support exactly three overlapping emphasis types. There is no fourth kind of inline span, and no way to nest two independent indicators (one for print emphasis, a second for "this is a hyperlink") around the same text.

**What the standard requires (evidence):** BANA Braille Formats 2016, Sample 6-15 ("Screenshot", `references/bana/braille-formats-2016.pdf` p.180, "Screenshot for Web Page Layout" box) wraps each hyperlinked phrase in a hyperlink-boundary indicator pair (`@#7`...`@#'`) that is layered ON TOP OF the phrase's own bold passage indicator (`^7`...`^'`) — e.g. `@#7,sci;e3 ,a/ronomy3 ,sol> ,sy/em3 ,planets3 ,m>s3 ^7,life on ,m>s8^'@#'` (confirmed directly against the source `.txt`, lines 5287-5289, and cross-checked against the same phrase's simpler, non-hyperlink-boxed rendering two screenshots earlier on the same page, which has the bold markers alone). Emboss's own model (`Emboss/tests/gold/bana-formats-2016/section-6/sample-6-15.json`) can build the bold span but has nothing for the second wrapper.

**Classification:** not done (feature absent).

**Test that would prove a fix:** a test asserting a paragraph/caption segment carrying both a `tf` bitmask AND a new "hyperlink" flag produces two independently-nested indicator pairs around the same text; `Emboss/tests/gold_bana_section6.test.mjs`'s `sample-6-15` case (currently `mismatch`) would be one worked check of it, though not the only remaining cause of that file's mismatch (see also F-231, F-222).

# Standards findings — line-numbered and line-lettered text, gold-run confirmation (BANA §15) (assessed 17 Sep 2026)

## F-234 — The automatic §15.4.1d line-numbered-prose transcriber's note uses fixed, generic wording and adds no blank line before the text that follows, unlike the section's own worked illustration

**Rules:** BANA 15.4.1d, 15.8.1b/c

> "Insert a transcriber's note before the text when the three blank cells is used in only one section. Sample: Three blank cells occurring within a braille line indicate the beginning of a new print line." (15.4.1d)
> "b. Insert a transcriber's note explaining the use of the three blank cells... c. Insert a blank line between the transcriber's note and the beginning of the line-numbered material." (15.8.1b/c)

**What Emboss does:** `lineNumberNote`/`LINE_NUMBER_NOTE` (`Emboss/format/document.mjs:735-742`) is a single hard-coded English sentence ("Line numbers are shown at the right margin where print numbers a line. Three blank cells within a braille line show where that print line begins.") inserted, verbatim and unconditionally, before the first block `lineNumberInfo` finds carrying a `linenum` segment — with no way to supply the source's own note wording instead, and with no blank line inserted between the note and the numbered text that follows (`formatSegmentedPara` simply prepends `[...note, ...lines]`, `document.mjs:774-786`, with no separating `''`).

**What the standard requires (evidence):** BANA Braille Formats 2016 Sample 15-3 ("Line-Numbered Prose with Transcriber's Note", `references/bana/braille-formats-2016.pdf` p.420, printed page 15-10) is this section's own worked illustration of the rule, and its own note reads "Three blank cells occurring within a braille line indicate the beginning of a new print line." — different wording from Emboss's fixed text — and is followed by a genuine BLANK braille line before the numbered prose begins (`Emboss/tests/gold/bana-formats-2016/section-15/sample-15-3.json`'s own gold `braille.lines`, row 5 of 15, confirmed directly against the source text). Sample 15-9 ("Marginal Numbers Indicating Words Read", p.427) independently confirms the same blank-line requirement for the closely-related §15.8.1b/c "counted words" note. Running `node Emboss/scripts/gold-run.mjs --section section-15 --sample "BANA Sample 15-3"` shows Emboss's own automatic note differing from the book's in wording AND omitting the blank line that follows it in the source, on an otherwise line-for-line-matching passage.

**Classification:** bug / not done — the document model has no field to carry the source's own preferred note wording (LINE_NUMBER_NOTE is not parameterised at all), and `lineNumberNote`'s own output never adds the trailing blank line 15.8.1c explicitly requires (and Sample 15-3's own worked illustration of 15.4.1d shows too, though 15.4.1d's own rule text does not say so as explicitly).

**Test that would prove a fix:** a document whose first line-numbered block is preceded by a source-supplied note wording renders that exact wording (not the hard-coded English sentence), followed by one blank braille line before the numbered text begins; `Emboss/tests/gold_bana_section15.test.mjs`'s `sample-15-3` and `sample-15-9` cases are the worked checks (both currently `mismatch`/`not-representable` partly on this cause).

# Standards findings — spelling lists and activities, gold-run confirmation (BANA §17) (assessed 18 Sep 2026)

## F-235 — No paragraph margin mechanism produces the 5-5 (cell 5 first line, cell 5 runover) indent this section's own "activity directions" instruction lines consistently need

**Rules:** none named directly — a cross-cutting formatting convention this section's own worked Examples/Samples consistently show for the imperative instruction line that introduces a spelling activity (e.g. "Write these words in alphabetical order.", "Unscramble the following spelling words.", "Complete each equation to make a word list.", "Read this narrative and rewrite the underlined words..."), distinct from both BANA's ordinary indented paragraph (§1.9.3, 3-1) and its blocked paragraph (§1.9.3, 1-1).

**What Emboss does:** `formatPara` (`Emboss/format/document.mjs:636-649`) computes an ordinary paragraph's own left margin from exactly two inputs — `block.blocked` (giving `first:0, runover:0`, cell 1/cell 1) and the absence of it (giving `first:2, runover:0`, cell 3/cell 1) — with `block.continuation` also collapsing to `first:0`. There is no third option, and no field anywhere in the document model that could ask for `first:4, runover:4` (cell 5/cell 5) on an ordinary `para` block; `quoteMargins` (`document.mjs:579-585`) is the only other margin source a `para` block can take, and it gives cell 3/cell 3 (BANA mode) for a `style:'quote'` paragraph, not cell 5/cell 5 either.

**What the standard requires (evidence):** confirmed directly, file by file, against this reconciliation's own gold corpus (`Emboss/tests/gold/bana-formats-2016/section-17/`, `braille.lines` re-extracted independently from `references/_text/braille-formats-2016.txt`, lines 13357-14309): every one of Sample 17-2's ("Write these words in alphabetical order.", source line 13899), Sample 17-4's ("Unscramble...", line 13944), Sample 17-11's ("Write each word, adding ie or ei...", line 13899 [sic, 14105]), Sample 17-12's ("This headline and play review...", line 14127), Sample 17-13's ("Read this narrative...", line 14155), Sample 17-15's ("Complete each equation...", line 14203), Sample 17-17's ("Directions: Make new words...", line 14261), Sample 17-18's own table-header line ("If the noun ends in...", line 14291), and Example 17-11's ("Write list words by adding...", line 13765) own directions/instruction line carries a 4-cell leading indent (cell 5) on BOTH its first line and every runover line — never the 2-cell (cell 3) indent an ordinary unblocked `para` block gives by default. Running `node Emboss/scripts/gold-run.mjs --section section-17 --sample "BANA Sample 17-2"` (and the other samples named above) confirms this directly: Emboss's own output consistently indents these lines 2 cells short of the given braille.

**Classification:** gap / not done — no code path anywhere in `document.mjs` can produce a cell-5/cell-5 paragraph margin; this is a genuine missing capability (a third paragraph-margin option), not a judgement call about which of the two existing options to pick.

**Test that would prove a fix:** a `para` block carrying some new field (e.g. `style:'directions'` or a numeric margin override) renders at `first:4, runover:4`; `Emboss/tests/gold_bana_section17.test.mjs`'s own directions-carrying samples (17-2, 17-4, 17-11, 17-12, 17-13, 17-15, 17-17, 17-18) are the worked checks (all currently `mismatch` partly on this cause).

## F-236 — `glossarySegments` silently drops a definition (or term) supplied only as `defSegments`/`termSegments` when its own plain `def`/`term` string is empty

**Rules:** none named directly — a data-shape defect in the general glossary/definition-list mechanism BANA §17.6/17.7 (and §19/§21's own dl-based word lists) all share.

**What Emboss does:** `glossarySegments` (`Emboss/format/document.mjs:996-1008`) reads BOTH a plain `term`/`def` string and, separately, a `termSegments`/`defSegments` array — its own header comment explicitly says "whether or not the parts carry emphasis... the parser keeps segments for every `<dt>`/`<dd>`, the editor only for formatted ones, and both must braille alike." But its own combining logic, `if (term && def) { ...return [...termSegs, sep, ...defSegs]; }`, tests the PLAIN STRING variables' truthiness only — not whether `termSegs`/`defSegs` (which DO prefer the `*Segments` arrays when present) are themselves non-empty. An item supplying `termSegments`/`term:'doctor'` alongside a `defSegments`-only definition (no plain `def` string at all, e.g. because the definition carries an italicised word-mention and was authored as segments) has a truthy `term` but a falsy (empty-string) `def`, so the `if` branch is skipped entirely; the function then falls through to its own final line, `return term ? termSegs : defSegs;`, which returns ONLY `termSegs` — the entry word is rendered, and its ENTIRE definition (segments and all) is silently dropped from the output, with no error or limitation recorded anywhere.

**What the standard requires (evidence):** reproduced directly while reconciling this section's own gold corpus (Sample 17-9, "Word Usage List", BANA 17.6.1b — `Emboss/tests/gold/bana-formats-2016/section-17/sample-17-9.json`): building the item `{term:'advice, advise:', defSegments:[{type:'text',text:'Advice'},{type:'text',text:' is a noun; ',...},{type:'text',text:'advise',tf:1},{type:'text',text:' is a verb.'}]}` with no plain `def` string produced `ADVICE1 ADVISE3` and nothing else — the whole definition vanished. Supplying a plain-text `def` fallback ALONGSIDE `defSegments` (purely so the truthiness check passes; the segments are still what actually renders) made the same file format byte-for-byte correctly against the book's own given braille. BANA gives no rule that would ever want a definition silently omitted this way.

**Classification:** bug / not done.

**Test that would prove a fix:** a glossary item built with `termSegments`/`defSegments` only (no plain `term`/`def` string at all) still renders both the term and the definition; `Emboss/scripts/gold-run.mjs`'s own `buildBlocks17` (section-17 builder) works around this today by always supplying a plain-text fallback alongside any `*Segments` array — see the comment directly above that code.

---

## F-237 — No mechanism substitutes three dot 5s (and a transcriber's note) when print shows a blank space, rather than an underscore/dash, for an omitted word

BANA Formats §10.6.1: "An underscore represents a low line in print that indicates omission
of a word or a blank to be filled in. Follow print for other symbols used to show omissions
or blanks to be filled in. **If print uses empty space to show an omission, substitute three
dot 5s and insert a transcriber's note explaining the change from print.**"

Reproduced directly while reconciling this section's own gold corpus (`Emboss/tests/gold/
bana-formats-2016/section-10/example-10-13.json`, BANA Example 10-13's own third sentence,
"It is _ o'clock." — print shows plain blank space between "is" and "o'clock", not an
underscore/dash/other symbol): the given braille substitutes three dot 5s (`"""`,
`references/_text/braille-formats-2016.txt` line 7528) with no transcriber's note nearby (the
note itself, per the rule, would need to explain the *general* convention once, not per
instance — this worked example shows only the substituted result). Emboss's exercise-item
text is opaque, untyped print content (the SAME root cause F-225/F-226/F-229 already document
for this section): nothing in `Emboss/input/parse.mjs` or `Emboss/format/document.mjs`
detects "this word-gap in the source is empty space rather than a literal underscore/dash
character" — there is no way for the model to distinguish the two cases at all, let alone
substitute three dot 5s for one of them. A gold `print.blocks` item built with literal
whitespace where print shows a blank translates via `louis.translate()` to nothing at all
(the whitespace is simply consumed as ordinary word-spacing) rather than to three dot 5s.

**Classification:** not done (missing mechanism; distinct from F-225's own write-on-line
*omission* rule and from F-226's own TN-*synthesis* rule list, which does not include this
one — BANA 10.5.2, 10.6.8, 10.6.10, and 10.9.2b only).

**Test that would prove a fix:** a `bai-exercise` (or plain paragraph) item whose source text
contains a run of plain whitespace standing in for an omitted word (as opposed to a literal
underscore/dash) formats to three dot 5s (`"""` in BRF ASCII) in place of that gap.

# Standards findings — alphabetic references, gold-run confirmation (BANA §21) (assessed 18 Sep 2026)

## F-238 — `pageSuffix`'s "is the entry word already punctuated" check does not recognise a closing enclosure symbol (a curly quote, parenthesis), so it inserts a spurious extra comma after one

**Rules:** BANA 21.4.3 (secondary effect), 21.4.4, 21.2.2 (page-reference half)

*(Same class of bug as F-194 — `glossarySegments`'s own trailing-punctuation regex missing enclosure symbols — found independently here in a SIBLING code path, `pageSuffix`, not `glossarySegments` itself; cited, not repeated.)*

> "The entry-word segment includes the word or phrase being defined... page numbers directly follow the index entry." (21.4.4, 21.1.1's own general index convention)

**What Emboss does:** `pageSuffix` (`Emboss/format/document.mjs`, "A list item's page references…") computes `const comma = /[,:;.]$/.test(plain) ? '' : o.translate(',').trim();` — exactly like `glossarySegments`'s own regex (F-194), it recognises only a literal trailing `,`/`:`/`;`/`.` character, never a closing enclosure symbol (a curly closing quote `”`, a closing parenthesis). Probed directly (`node Emboss/scripts/gold-run.mjs --section section-21 --sample "BANA Example 21-1"`, real liblouis, BANA): the gold index item `"“Action archaeology,”"` (BANA Formats 2016 Example 21-1, `references/bana/braille-formats-2016.pdf` p.558) already carries its own comma INSIDE the closing quote, matching the print `"Action archaeology," 302` exactly — but `pageSuffix` sees the plain text's own LAST character (the closing curly quote `”`), which is not in `[,:;.]`, and inserts a SECOND, spurious comma before the page number. Expected `8,AC;N >*AEOLOGY10 #CJB`, actual `8,AC;N >*AEOLOGY101 #CJB` — an extra `1` (braille-ASCII comma) appears between the closing quote (`0`) and the page number.

**What the standard requires:** no invented punctuation between an already-punctuated entry word (however it is punctuated — a trailing comma, a closing quote, a closing parenthesis) and its page reference.

**Classification:** bug (same root cause and same fix as F-194, in a second, independent call site).

**Test that would prove a fix:** an index item whose entry word already ends in a closing quote or parenthesis (not a bare `,`/`:`/`;`/`.`) formats with no additional comma inserted before its page reference.

---

## F-239 — A plain (non-glossary) list item's literal multi-space gap collapses to one space, losing §21's own "two/three blank cells" spacing rules

**Rules:** BANA 21.5.1e (mixed-style entries), 21.7.2 (single-level thesaurus spacing, by the same mechanism)

*(Same root cause as F-206, "a significant blank space… normalises to a single space" — found there for a play-speaker/dialogue line, `document.mjs:673`'s `t.replace(/[^\S\n]+/g, ' ')` inside `groupSegments`/`segmentsToBraille`; cited, not repeated, but reproduced here against §21's own rule text and a DIFFERENT calling block type, `formatList`'s plain `item.text`/`item.segments` path, not `formatPlay`.)*

> "e. Insert two blank spaces before the start of all definitions or descriptions when the alphabetic reference has a variety of entry styles." (21.5.1e)
> "Single-Level Thesaurus. Use 1-3 margins for all entries." (21.7.2, illustrated by Sample 21-9's own two literal blank cells between an entry word and its abbreviated part-of-speech label)

**What Emboss does:** probed directly (`node Emboss/scripts/gold-run.mjs --section section-21 --sample "BANA Sample 21-9"`, real liblouis, BANA): a plain `list` item's own text, `"agree v. coincide, get along, …"`, carries two literal blank cells between the entry word and `v.` in the gold braille (`references/bana/braille-formats-2016.pdf` p.594) — expected `AGREE  ;V4 CO9CIDE1…`, actual `AGREE ;V4 CO9CIDE1…`, the double space collapsed to one. The same collapse reproduces on Example 21-19's own "Mixed Entries" worked illustration of 21.5.1e itself (`"daft"`/`"crazy, silly"`) and on Sample 21-10's own multilevel-thesaurus entries. Because a plain list item's text/segments are rendered through the same `groupSegments`/`segmentsToBraille` path F-206 already names, any deliberate multi-space gap authored directly in an item's own text is silently normalised to one space, with no per-item "preserve this gap" mechanism.

**What the standard requires:** a two-blank-cell (21.5.1e) or three-blank-cell (the related 21.8.1a "counted words" convention, F-208) gap survives into the braille exactly as authored, not collapsed to Emboss's own ordinary single inter-word space.

**Classification:** bug (same root cause as F-206, reproduced against a second block type and a second section's own rule text).

**Test that would prove a fix:** a plain list item's own text or segments carrying two (or three) literal blank cells between two words renders with that exact gap preserved, not collapsed to one.

---

## F-240 — A `stage` block between two verse `play` lines breaks `poemRunBoundaries`, adding a blank line BANA §14 explicitly forbids around a between-dialogue stage direction

**Rules:** BANA 14.5.3d / 14.6.3d / 14.7.2

> "d. Do not insert blank lines before or after stage directions or cues printed outside or
> between the lines of dialogue." (14.5.3d, reused verbatim by 14.6.3d for the verse case and by
> 14.7.2 for mixed prose-and-verse)

**What Emboss does:** `document.mjs`'s `poemRunBoundaries` (the mechanism F-121 already documents
as adding a blank line before/after a POEM) treats a maximal run of consecutive `{type:'play',
subtype:'verse'}` blocks as one poem; a `{type:'stage'}` block sitting between two such blocks is
neither a verse block nor a recognised stanza separator (`isVerseSeparator`), so it FLUSHES the
run — each side of the interruption becomes its own isolated single-line "poem", and gets F-121's
own blank-line-before/blank-line-after treatment independently. Probed directly against this
reconciliation's own gold corpus (`node Emboss/scripts/gold-run.mjs --section section-14 --sample
"BANA Sample 14-9"`, real liblouis, BANA): King's own speech (`[Exit Horatio.]` then three lines
of verse) gets a spurious blank line between the stage direction and the verse that follows it —
expected (`references/bana/braille-formats-2016.pdf` p.404 / Sample 14-9) has NO blank line there
at all. Example 14-8 (`--sample "BANA Example 14-8"`) shows the same mechanism from the other
side: TWO stage directions between two verse lines each pick up a blank line on BOTH sides,
turning a 4-line excerpt with no blank lines anywhere into a 6-line one. The PROSE case is
unaffected — a non-verse `play` block never satisfies `isVerseLineBlock`, so no run/boundary logic
ever runs on it (confirmed: Example 14-6, the prose analogue of Example 14-8, matches exactly).

**What the standard requires:** no blank line anywhere around a stage direction printed between
lines of dialogue, verse or prose alike.

**Classification:** bug (a correct mechanism, F-121, applied too eagerly — it does not recognise
a `stage` block as something that belongs INSIDE the surrounding verse run rather than ending it).

**Test that would prove a fix:** a verse play with a `stage` block between two `play`/`subtype:
'verse'` blocks (all three sharing one speech, or two different speeches) formats with NO blank
line before or after the stage direction, matching `Emboss/tests/gold_bana_section14.test.mjs`'s
own Sample 14-9 / Example 14-8 regression cases.

---

## F-241 — Emboss's `note` block always encloses its ENTIRE text in transcriber's-note indicators; there is no way to enclose only PART of a line, or to nest a second, independent transcriber's note inside another block

**Rules:** BANA 14.10.2, 14.10.3f, 14.10.4a/b, 14.10.5, 14.11.1b

> "Insert the word 'Cartoon,' enclosed in transcriber's notes symbols. Use 7-5 margins.
> Continuing on the same line, insert the cartoon title and artist's name, followed by the date
> and copyright information..." (14.10.2 — only ONE word is enclosed; the rest of the same 7-5
> line is ordinary text)
> "f. If necessary, a brief description of the action in the frame is enclosed in the
> transcriber's note with the frame number. If the action relates only to a specific character,
> insert a transcriber's note following the character's name." (14.10.5f — a SECOND, independent
> transcriber's note, nested inside a frame's own dialogue line)

**What Emboss does:** `formatTranscriberNote` (`document.mjs:819-826`) wraps `TN_OPEN + inner +
TN_CLOSE` around the WHOLE of `tnContent(block).segs` — there is no parameter, segment flag, or
second block type that encloses only PART of a `note` block's own text, and no way for a
`play`/`stage`/`speech` block to carry a nested, independently-delimited transcriber's note
inside its own single margin. Probed directly (`node Emboss/scripts/gold-run.mjs --section
section-14 --sample "BANA Example 14-10"`, real liblouis, BANA): the single-frame-cartoon
template's own first line (`references/bana/braille-formats-2016.pdf` p.393) encloses only the
word "Cartoon" (`@.<,c>toon@.>`) before continuing in plain text ("title, artist's name, date and
copyright remain") at the SAME 7-5 margin — built as a `note` block, Emboss instead encloses the
whole thing, `@.<,C>TOON TITLE1 ... REMA9@.>`. Sample 14-5's own line 3 shows the SAME defect in
the opposite direction: the given braille encloses only `Craig, Peter` and leaves print's own word
"Together" OUTSIDE the enclosure (`@.<,craig1 ,pet]@.> ,tgr`); Emboss closes the enclosure only
after both. Samples 14-11/14-12 show the NESTING variant: a frame's own dialogue line
legitimately carries a second, independent transcriber's note describing the character's action
(`,capta9 ,ju/ice @.</&+ at ! ice prison@.> ,*ill...`, "Captain Justice [standing at the ice
prison] Chill out...") — with no nested-note mechanism, the closest Emboss can produce is the
ORDINARY stage-direction-in-dialogue parenthesis enclosure (`"<`/`">`, 14.4.1c's own mechanism),
which is visually similar but a different BRF symbol pair from the real transcriber's-note
indicators the given braille actually uses.

**What the standard requires:** a transcriber's note that encloses only part of a paragraph
(leaving the surrounding text at the same margin, unenclosed), and — separately — a paragraph
that itself carries one or more independently-delimited nested transcriber's notes inside its own
running text.

**Classification:** feature absent / not done (two related but distinct gaps: partial enclosure
of one block, and nesting a second enclosure inside another).

**Test that would prove a fix:** a `note` block with a `segments`-level flag marking only PART of
its text as TN-enclosed renders with the enclosure symbols around just that part; a `play`/
`speech` block with an embedded nested-note segment renders that segment wrapped in `@.<`/`@.>`
without wrapping the rest of the line.

---

## F-242 — No blank-line mechanism connects BANA §14.3's scene-setting prose to the dialogue that follows it (14.3.1e)

**Rule:** BANA 14.3.1e

> "e. Insert a blank line to separate scene settings from dialogue."

**What Emboss does:** neither `formatPara` (ordinary or `blocked`) nor the non-verse `formatPlay`
path emits a blank line of its own when a scene-setting paragraph is immediately followed by the
first line of dialogue — the two block formatters have no knowledge of each other, and
`document.mjs`'s own general block-blank-line logic (`joinsWithoutBlank`, `buildDocPages`) only
ever REMOVES a blank line that a formatter already added (for a heading, a poem run, a blocked
paragraph's own leading blank per §1.9.3); it never INSERTS one a rule requires. Probed directly
(`node Emboss/scripts/gold-run.mjs --section section-14 --sample "BANA Sample 14-2"`, real
liblouis, BANA): Sample 14-2's own indented stage-setting paragraph ("A bell rings in the
entryway...") is followed immediately, with no blank line, by NORA's own first line of dialogue —
`references/bana/braille-formats-2016.pdf` p.397 clearly shows a blank line there, per 14.3.1e.

**What the standard requires:** a blank line always separates the LAST scene-setting paragraph
from the FIRST line of dialogue that follows it, regardless of either block's own margin/type.

**Classification:** feature absent / not done.

**Test that would prove a fix:** a scene-setting `paragraph` block immediately followed by a
`play`/`speech` block formats with exactly one blank line between them.

---

## F-243 — liblouis's uebG2 table inserts a letter-sign before a bare `...?` (ellipsis directly followed by a question mark) that is itself preceded by a word-space, which the given BANA braille for the same print text does not have

**Rule:** none specific — a UEB punctuation-disambiguation table behaviour, observed against BANA
Sample 14-3's own worked braille.

**What Emboss does:** probed directly (`node Emboss/scripts/gold-run.mjs --section section-14
--sample "BANA Sample 14-3"`, real liblouis, BANA): the print text "...means ...?" (a trailing,
space-separated ellipsis then a question mark, `references/bana/braille-formats-2016.pdf` p.398)
forward-translates to `M1NS 444;8` — a spurious letter-sign cell (`;`) appears between the
ellipsis (`444`) and the question mark (`8`) — where the given braille has `m1ns 4448`, no
letter-sign at all. Gluing the ellipsis directly onto the PRECEDING word (no space) removes the
letter-sign but also removes the given braille's own inter-word space, so no candidate print text
reproduces the given braille exactly; the same pattern reproduces on the same sample's own final
line (`,,john 444 ,i 4448` expected vs `,,JOHN 444 ,I 444;8` actual).

**What the standard requires:** unknown without consulting a UEB punctuation-disambiguation
reference directly — possibly a table refinement (a bare `?` immediately after a `...` run does
not need a letter-sign the way a bare `?` after ordinary text does), possibly a legitimate
transcriber's choice the general-purpose uebG2 table does not special-case. Left UNRESOLVED by
this reconciliation (`tests/gold/bana-formats-2016/section-14/README.md`, `differences.md`).

**Classification:** unresolved (possible liblouis table gap; not enough evidence to classify as a
confirmed bug in Emboss's own code, since the table itself is a third-party liblouis asset).

**Test that would prove a fix:** confirm against an authoritative UEB punctuation reference
whether `...?` needs a letter-sign after a preceding word-space, then adjust the uebG2 table (or
document that the given BANA braille itself is non-standard) accordingly.

---

## F-244 — liblouis's uebG2 table contracts "counsel" differently from the officially certified BANA braille for the same word

**Rule:** none specific — a UEB contraction-table divergence, observed against BANA Sample 14-9's
own worked braille (a direct Hamlet quotation, "...and so I thank you for your good counsel.").

**What Emboss does:** probed directly (`node Emboss/scripts/gold-run.mjs --section section-14
--sample "BANA Sample 14-9"`, real liblouis, BANA): `o.translate('counsel')` consistently produces
`C\NSEL` (confirmed in isolation and in full sentence context) — the given, officially certified
BANA braille (`references/bana/braille-formats-2016.pdf` p.404) instead has `c\ncel`. The word
itself is not in doubt (Shakespeare's own canonical text, and both of this reconciliation's own
independent transcription runs already agree on "counsel"); the two BRF forms decode to two
different letter sequences after the shared `c` + `ou`-sign opening, an ordinary liblouis
table-vs-certified-transcription mismatch for this one word, not a gold-data transcription error.

**What the standard requires:** `c\ncel` for "counsel" in this context (whatever UEB rule
produces that specific contraction choice — not yet identified).

**Classification:** unresolved (possible liblouis uebG2 table gap for this specific word/context;
not enough evidence to identify the exact contraction rule liblouis is missing).

**Test that would prove a fix:** identify the UEB rule that makes "counsel" contract to `c\ncel`
rather than liblouis's own current `c\nsel`, confirm it against a second independent occurrence of
the word elsewhere in the BANA corpus, then adjust the uebG2 table.
