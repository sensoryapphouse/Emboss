# Standards questions — tables and related columns

Concise questions for a transcriber, arising from the "unclear" corners found while
assessing Emboss's table code against BANA Braille Formats 2016 §11 and UKAAF B004 §12
(`standards-map.md`, `standards-findings.md`). These are not yet sent anywhere — collected
here per the project's method until the rest of the pilot's checks are done.

---

**Q-1. How should Emboss tell a table's *caption* from its *heading*?**

BANA treats these as two different things with two different formats:
- a **caption** (an explanatory blurb) — 7-5 margins, never centred, and if the table has no
  title/heading of its own, preceded by an identifier ("Figure", "Table", etc.) in
  transcriber's-note brackets (§11.2.8b).
- a **heading** (the table's own title, e.g. "Table 12: State Populations") — centred
  (§11.3.1a), and if sequentially numbered, repeated centred with "(cont.)" on line 25 of
  every continuation page (§11.3.2a/b).

DTBook/NIMAS gives Emboss exactly one element, `<caption>`, for both. Right now every table
caption Emboss parses is rendered as the *caption* case (7-5, not centred) — correct for a
genuine caption, wrong whenever the print text was really BANA's *heading*. See
`standards-findings.md` F-4.

Options to put to Paul: (a) always treat a `<caption>` as a caption (current behaviour,
simplest, sometimes wrong); (b) add a signal a transcriber sets when marking up the source
(e.g. a class, or a checkbox in the editor) saying "this is the table's heading, centre it";
(c) heuristic — e.g. treat text starting "Table N" / matching a sequential-numbering pattern
as a heading, everything else as a caption. Which does Paul want, and does it matter enough
to build before the rest of the pilot (NIMAS/DTBook, translation checks) is done?

_Q-1 — built 17 Sep 2026 (F-4 fix), option (b): `<caption class="bana-heading">` (a class,
not a checkbox — parse.mjs/nimas-export.mjs/editor.mjs's real TableNode all read/write it;
`bana-heading-before-box` is the further §11.3.1b before/after-a-box-line signal). Option
(c)'s "Table N" heuristic was tried and rejected for `gold-run.mjs`'s own model-building (no
`braille`-derived shortcut): checked against every one of BANA §11's own 19 captioned
samples, a "Table N" prefix does not separate the heading group from the caption group (both
groups have it and lack it) — what does separate them is BANA 11.2.8a's own definition of a
caption as an explanation: exactly one sample (Sample 11-1, this section's own worked
caption illustration) is a complete, terminally-punctuated sentence; every other captioned
sample is a bare label, and is a heading. See `standards-findings.md` F-4's "Status update".
Still open: which of a heading's box-line placement (before/after) a print copy actually
used has no DTBook-derivable signal at all (11.3.1b says "follow print", but nothing in
DTBook records which print chose) — `gold-run.mjs` defaults to 'in-box' (the majority found
across this section's own samples) only for building its own comparison model, not as a
transcription rule Paul has endorsed; a real transcriber still sets it explicitly via the
class above._

---

**Q-2. Should a numeric column ever right-align/place-value-align automatically, or only when the transcriber says so?**

B004 §12 says column entries are "normally aligned on the left", and figures "*may*" be
aligned right or by decimal point when they're meant to be worked on or summed down the
column — an optional, transcriber-judged exception, not the default. BANA 11.6.1d similarly
only requires place-value alignment for numbers print itself shows aligned that way.

Emboss currently applies place-value/right alignment to *any* column of all-numeric entries,
with no way to keep a plain sequential/ID column (like a "No." column, or a row number) left-
aligned instead — proven wrong against B004 §12's own worked Example 1 (see
`standards-findings.md` F-7).

Question for Paul/a transcriber: should the *default* be left-aligned (matching B004's stated
norm), with right/decimal alignment only when a column is explicitly marked as "figures to
align" (e.g. by a per-column setting or a class on the source `<td>`s) — or is there a
reliable-enough automatic heuristic (e.g. "align only if the column also has a numeric
heading/total", or "align only in BANA mode, never UKAAF") that avoids needing that signal?

---

**Q-3. Which of BANA's five missing wide-table alternates (if any) are worth building?**

Emboss's only automatic fallback for a table too wide for the page is BANA's Listed format
(§11.16, fully implemented) — Facing Pages (§11.13), Vertical Division (§11.14), Column/Row
Interchange (§11.15), Linear (§11.17), and Stairstep (§11.18) don't exist at all
(`standards-findings.md` F-18, by far the largest single gap found — 45 of the 111
partial/not-done rows in the map).

Building all five is a substantial project. Questions for Paul: which of these actually come
up in the textbooks Emboss transcribes in practice? Is Listed-format-always an acceptable
permanent choice for BANA (given §11.12.2 says readability should drive the choice, not
"whichever one exists"), or does at least one of the others (Stairstep for short, few-column
tables; Linear for simple factual tables without embedded punctuation) need to exist before
this section can be called "done"?

---

**Q-4. Is the one-cell-between-numeric-columns option (§11.7.1k/l) and the numeric passage
indicator (§11.7.1j) worth building, or is Listed/Paragraph fallback an acceptable
substitute?**

Both are BANA's own space-saving techniques for keeping a numbers-only table on one braille
page rather than falling back to Listed format; Emboss currently has neither (gutter is a
hardcoded 2 cells; no numeric-passage-indicator support at all — `standards-findings.md`
F-10/F-11). Since Listed format already exists as a working fallback, is the extra
space-saving machinery worth the effort, or is "it becomes Listed" an acceptable outcome for
these tables?

---

**Q-5. Does the key-list transcriber's-note format (§11.8.1-11.8.2 — devised keys, cell-5
grouped, alphabetised 1-3 list) need building, or is manual TN authoring (typed by the
transcriber as free text) good enough for now?**

Emboss's TN mechanism (`formatTranscriberNote`) supports one flat margin per note; it cannot
produce BANA's nested 7-5/cell-5/1-3 key-list structure (`standards-findings.md` F-15). A
transcriber can still type *something* as a plain paragraph before the table, just not in
that exact structured form. Is the structured form something Paul's transcription work
actually needs, or is free-text TN authoring an acceptable stand-in?

---

**Q-6. Should Appendix E ("Tables", B004, starting right after §12's own closing
cross-reference to it) be pulled into this pilot, as a further Stage-1 extraction pass?**

Carried over unresolved from `standards-map.md`'s Stage 1 (the map's own "Unresolved — for
Paul" section): both independent extraction runs stopped at the end of §12 because the task
specified reading "to the next numbered section", and B004 has no numbered §13 — the table of
contents lists §1-12 only, followed by the unnumbered "Appendix - Supplementary guidelines",
of which E is Tables. `B004 12 cross-reference` records that §12 points there, but Appendix
E's own content has not been extracted or assessed anywhere in this pilot.

**Resolved, 17 Sep 2026: yes.** Appendix E has now been extracted (two independent runs,
reconciled), assessed against the code, and given two gold examples — see
`standards-map.md`'s "UKAAF B004, Appendix E — Tables" section,
`Emboss/tests/gold/ukaaf-b004/appendix-e/`, and findings F-6 (extended)/F-18 (extended)/F-25.
Two new questions came out of that pass — Q-7 and Q-8 below.

---

**Q-7. Is Appendix E's own worked "table over two pages" example internally consistent with
its own stated rule ("the rows on the facing pages must line up")?**

Measured directly from the PDF's line geometry (`references/ukaaf/presentation-guidelines-
B004.pdf` pages 20-21; not just `references/_text/B004.txt`, whose blank-line count here is
itself off by one — a separate, related extraction artifact, see `standards-map.md`'s
Appendix E section and the task's `differences.md`): the left-hand facing page's five
day-rows have zero blank lines between them; the right-hand facing page has exactly one
blank line between every row. The two pages' rows do not start on the same physical line,
and the gap widens by one line for every row down the table — the example appears not to
satisfy the very rule it is meant to illustrate. Is this a genuine erratum in B004's own
guide (worth reporting upstream to UKAAF), an intentional convention this pilot doesn't know
about (e.g. rows anchored to the top of a taller row-slot rather than sharing an exact line
number), or an artifact of the guide's own typesetting tool with no normative weight either
way? This decides whether `B004 E ex2-align-rows` should ever be tested for an exact
line-for-line match against this particular example, or whether a different/corrected target
is needed first.

Two braille signs neither independent extraction run could decode were resolved without
needing to ask: `"<@l">` (Example 1, under each "Year N" heading) decodes to "(£)" and `;,e`
(Example 2, Wednesday's Wind direction "E") decodes to RUEB §5.2.1's grade-1-symbol-indicator
before a standalone letter that could be misread as a contraction — both confirmed two ways
(a RUEB citation, and an exact match from feeding the same literal print text through
Emboss's own real liblouis `en-ueb-g2` translator). See `standards-map.md`'s Appendix E
section and the two gold files' `uncertain` fields. One sign remains genuinely undecoded: the
closing `"31111111111` run at the end of both worked examples (plausibly an end-of-note or
end-of-table marker; no RUEB citation found for this exact form) — if anyone recognises it,
that would close out the only fully open decode question this pass leaves behind.

---

**Q-8. Is it worth fixing `resolveTableLayout`'s `'auto'`-mode gap (`standards-findings.md`
F-25) — where an over-wide table never even tries the column-squeeze that might have made it
fit columnar, unless `format` is explicitly forced to `'columnar'`/`'spatial'`?**

This surfaced while assessing Appendix E's transposed-table example: a table whose columns
*can* be squeezed to fit the page (per `fitColumnWidths`, which already exists and already
gets this right when actually invoked) is instead silently downgraded straight to the
wide-table fallback (`listed` in BANA mode, `paragraph` in UKAAF mode) whenever it is left at
the default `'auto'` format — which is every table, unless a transcriber remembers to
override it per-table. It is a general table-layout gap (not UKAAF- or Appendix-E-specific),
found only because this example happened to sit right at that boundary. Given F-18 already
documents that most over-wide tables have nowhere better to fall back to anyway (five of six
BANA alternate formats don't exist), is rescuing a few more tables into columnar form via
this fix worth the (small, contained) change, or does it not matter enough in practice to
prioritise ahead of the bigger gaps (Q-3)?

_Q-8 — decided by Paul, 17 Sep 2026 (`EMBOSS-TASKS.md` T9): yes — 'auto' always tries the
squeeze first now, accepting columnar only when every entry (headers included) fits in ≤2
lines with no word divided (BANA §11.6.1), otherwise falling back as before. Built the same
day; see `standards-findings.md`'s F-18 status update for the gold/corpus evidence (5 of 36
§11 gold samples reach columnar instead of Listed; 15 of 194 corpus 'auto' tables likewise)._

---

**Q-9. Is a table's inter-column gutter genuinely narrower (1 cell, not 2) whenever a column
entry exactly fills that column's natural width, with no guide-dot fill needed?**

Stage 4's gold-example run (`standards-findings.md` F-10) found this in the *simplest*
BANA §11 worked example, Example 11-2 (a plain 2-column table with no other confound): the
book's own braille shows exactly 1 blank cell after "mosquito"/"elephant" (each exactly 8
cells, the column's full natural width) but the expected 3 blank cells (1 fill + 2 gutter)
after "gorilla" (7 cells, needing 1 cell of fill) — i.e. the *total* span
(entry+fill+gutter) is constant at colWidth+1 whenever the widest entry appears, not
colWidth+2 as Emboss's hardcoded `gutter = 2` (`document.mjs:1042`) always produces. This
doesn't match either reading of "leave two blank cells between columns" (11.2.5b) or the
narrower "one blank cell for numeric columns to rescue a page-fit problem" (11.7.1k/l,
already tracked separately) that the map currently records. Is BANA's real rule that the
gutter is measured from wherever the column's content ends (so a full-width entry only ever
gets 1 blank cell after it, since there's no room left for a guide-dot run), rather than a
constant 2 cells added on top of a fixed column width regardless of what actually printed in
it? A second worked example with the same shape (Example 11-3) shows the identical pattern,
so this looks systematic, not a one-off transcription slip — but it wasn't independently
re-derived from the PDF's raster dot image, only from the extracted `.txt`, so a
transcriber's/Paul's confirmation would help before treating it as a confirmed bug.

_Q-9 (gutter) — decided by Paul, 17 Sep: follow the book's examples (one cell where an entry exactly fills its column). Q-3 — decided: build vertical division, stairstep, linear, interchange, facing pages in that order (T4)._

---

**Q-10. Does BANA §4.3.6 ("A heading is not preceded by a blank line when it follows the
note separation line") also cover the heading that opens the next section after a whole run
of footnotes ends — or only the literal, narrower case of a heading placed as the very first
line of a note block?**

Arising from assessing BANA §4 (Headings) against `Emboss/format/document.mjs`
(`standards-map.md` row `BANA 4.3.6`): Emboss's own note/footnote block
(`formatFootnote`/`noteLead`, `document.mjs:641-650`) never places a heading as the line
immediately following the note-separation line (`"333333`) — a footnote block always
renders a run of note *text* there, never a nested heading — so the literal adjacency the
rule names cannot arise from Emboss's own structures. What *can* arise is a heading that
opens a new section right after a page's whole run of footnotes ends; that heading
currently gets the default leading blank line (verified by a scratch probe), the same as it
would after any ordinary paragraph. Is that the correct reading — the rule is genuinely
narrow, about a heading that could only follow the separator line directly, which Emboss (or
any note format) never produces — or does BANA intend the no-blank-line treatment to extend
to "the heading that follows a run of notes," which would need new code (comparable to how
§4.3.5's top-box-line exception is implemented)? See `standards-findings.md`'s discussion
under the `BANA 4.3.6` row (no dedicated finding — the row's status is `unclear`, not
`partial`/`not done`).

---

**Q-11. Should Emboss define a 7th (and beyond) UKAAF heading level, and if so what
distinguishes it from level 6?**

Arising from assessing UKAAF B004 Appendix A ("Good practice example of six heading
levels") against `Emboss/format/document.mjs`'s `formatHeading` (`standards-map.md` row
`B004 A Headings`, finding F-32): Appendix A illustrates exactly 6 levels, and Emboss
implements that scheme precisely (`Emboss/tests/heading_levels_4_6.test.mjs`), but its
UKAAF branch has no case beyond level 6 — a document needing a 7th distinct heading level
would render it identically to level 6 (cell 3, runover 5, bold), with no further
distinguishing margin or typeform tool, even though B004 Appendix A's own wording ("there
may be occasions where more complicated and lengthy texts need more than three heading
levels … any format may be assigned more than once provided that they are distinguished by
some other means") reads as open-ended, not capped at 6. Is a 7th+ level realistic for the
books Emboss transcribes in practice? If so, should it cycle back through level 4/5's
margins with a different typeform (e.g. underline, or the UKAAF box-line convention), or is
"stops at 6" an acceptable permanent limit, with anything deeper handled by a transcriber's
note explaining the convention used?

---

**Q-12. Should a print list set in side-by-side columns be authored as a `<table>` or a
`<list>` — and does it matter that Emboss's `<list>` path never renders columns at all?**

BANA 8.4.1 lets a transcriber either retain a print word-list's side-by-side column layout
or collapse it to one column, at their discretion. Emboss's list formatter (`formatList`,
`Emboss/format/document.mjs`) has NO column-layout code at all — every `list` block, columned
in print or not, is always rendered as a single vertical column. Emboss's TABLE formatter,
by contrast, already renders genuine side-by-side columns (the already-assessed §11 map).

DTBook has no construct that specifically means "a list set out in print columns" — such
content could be marked up either way. Options to put to Paul: (a) accept that a columned
word list is always collapsed to one column when authored as a `<list>` (current behaviour,
simplest, matches one of the rule's two allowed outcomes, but never offers the other); (b)
tell transcribers to mark a print-columned word list as a `<table>` instead, so it gets
Emboss's existing columnar rendering (a workaround, not a fix to the `list` path, and the
result would be styled/exported as a table, not a list, which may not match what a real
NIMAS source does); (c) build column support into `formatList` itself (real work — see
`standards-findings.md` F-34). Which does Paul want, and how often does this pattern actually
show up in real transcription sources?

---

**Q-13. How should a "directions" line for exercise material be represented, so a following
list can suppress its blank line (BANA 8.3.3c)?**

BANA 8.3.3c says a list is not preceded by a blank line "when it follows directions" (in
exercise material, §10). Emboss has no representation of a "directions" line distinct from
an ordinary paragraph at all — `style-specification.md` itself already lists "Exercise
Directions (BANA §10, BB Directions 5-5 / 7-5)" among the styles awaiting a decision. Until
that's decided, 8.3.3c can't be implemented (see `standards-findings.md` F-37): should a
directions line be (a) any plain paragraph immediately before an `exercise`-kind list, keyed
purely by position (simplest, but would also silently suppress the blank line before any
ordinary paragraph that happens to precede an exercise list without being "directions"); (b)
a dedicated style/class the transcriber marks explicitly (matches BrailleBlaster's own
Directions 5-5/7-5 margin styles, per `style-specification.md`); or (c) out of scope for now,
left as the current default-blank-line behaviour until Exercise Directions is decided as its
own style? This question is upstream of, and blocks, F-37.

---

**Q-14. Is it worth building real per-print-symbol bullet correspondences and a Special
Symbols page for lists now, or should this wait?**

BANA 8.6.2a gives six distinct print-bullet-to-braille correspondences (dot, hollow/solid
square, hollow circle, triangle, checkmark); Emboss currently collapses every recognised
bullet-like glyph to the single primary bullet `_4` (`Emboss/input/parse.mjs`
`BULLET_PREFIX_RE`), and has no Special Symbols page or per-bullet transcriber's note
mechanism at all (`EMBOSS-TASKS.md` G8: "Decided… To build:… Special Symbols page" — not yet
built). Separately, `EMBOSS-TASKS.md` A6 ("Parser drops bullets for `<list type=\"ul\">`") is
already open and, on its own, is a plainer bug (bullets vanish outright) than the
symbol-fidelity gap. Given G8 is already Paul's decision and already on the task list (see
`standards-findings.md` F-33), this question is really about sequencing: does A6 (bullets
vanishing) get priority over the fuller G8 build (six distinct symbols + Special Symbols
page), given the pilot's "keep costs reasonable" instruction?

---

**Q-15. For BANA 1.11.7c's continuation letters beyond double letters (52+), what comes after `zz`?**

BANA 1.11.7c only gives examples up to double letters ("aa, bb, etc."). Emboss's
`continuationPrefix` is currently a plain bijective base-26 counter (confirmed wrong for even
the *first* double-letter case — see `assess-1/general-writeup.md` F-50: it produces `AA, AB,
AC…` where BANA wants `aa, bb, cc…`). Once F-50 is fixed to double the same letter (aa, bb,
cc, ..., zz), what should the 53rd continuation page (past `zz`) be labelled? Triple letters
(`aaa`) by the same doubling logic, or does BANA's convention simply not anticipate a print
page needing more than 52 continuation braille pages (in which case "unclear/never happens" is
an acceptable answer and no code needs to handle it)?

---

**Q-16. Is BANA 1.16.3 (foreign language in an English context) something this pilot can grade at all, or does it belong entirely to the liblouis UEB table?**

Every part of this rule (contracting foreign words normally, modified letter indicators for
accented letters, suppressing a contraction across a modified letter, UEB symbols for inverted
punctuation) is handled — if it's handled at all — by the shared liblouis UEB translation
table Emboss calls via `o.translate()`, not by any Emboss-authored code (see F-68: grep for
`foreign`/`lang`-conditional logic in the translation path finds nothing). BANA's own Example
1-18/1-19 are already rows in the map's worked-examples table (BANA §1, "Has braille: No" — not
yet transcribed).

Should this pilot (a) build those two as Stage-3 gold examples and run them through the real
liblouis translator to get a genuine done/not-done answer, treating it as a liblouis-table
correctness question rather than an Emboss one; (b) treat it as out of scope for Emboss testing
entirely, since Emboss's own code has and needs no opinion on it; or (c) leave it "unclear" as
recorded and move on, since fixing anything here (if it's even wrong) would mean patching the
liblouis table, not Emboss?

---

**Q-17. Should the UKAAF page-information line ever show a persistent print page number (top-left), or is the mid-body §8 turn indicator considered sufficient?**

F-66: Emboss's UKAAF running head/PIL (`Emboss/format/page.mjs`'s `runningHead()`) shows only
the braille page number (top-right) and title (centred) — never a print page number. B004 §7's
own good-practice example says "Print page number top left" as part of the PIL itself, separate
from §8's mid-body turn-announcement line (which Emboss does implement correctly). Building a
persistent top-left print-page field into the UKAAF PIL is a real, scoped feature (track
"current print page" through UKAAF's `assemble()` the same way the BANA branch already tracks
`currentPrintPageBrl`) — worth doing before NIMAS/DTBook work continues, or a lower priority
since the information is still recoverable (a reader can find the most recent §8 indicator by
scanning backward)?

---

**Q-18. How much of the "front matter / transcriber-generated page" machinery (§1.15.1b/c, the volume title page's missing page number, Preliminary/Supplement volumes, end-of-volume statements, print-interlining, double-spacing) is worth building now, versus noting as known gaps and moving on to NIMAS/DTBook and the translation checks?**

This pass found a cluster of BANA §1/§1.6/§1.7/§1.15/§1.17 rules with no code at all (not
"wrong", simply absent): double-spacing (F-52, ten rows), print-interlining (F-53), end-of-
volume/end-of-book statements (F-54, nine rows), Preliminary/Supplement volume labelling
(F-55, six rows), the volume title page's missing braille page number (F-57, a reproducible
bug on an existing feature), the missing `t`-prefix for transcriber-generated pages (F-58),
and the unreachable `cover.mjs` volume-cover/spine-label generator (F-59, dead code). None of
these are disputed readings of the standard — they're straightforwardly missing features. Given
the project's "keep costs reasonable" instruction and the plan to move to B004 → NIMAS/DTBook →
translation checks next, which (if any) of these should go onto the task list now rather than
wait for the "Run and sort" stage across the whole standard?

---

**Q-19. Is "not-applicable" the right call for BANA 1.1.11 (print running headers/footers ignored in braille), given DTBook/NIMAS input never encodes them in the first place?**

1.1.11 says print running headers/footers (chapter title, book title repeated per page, etc.)
are omitted from the braille transcription. Emboss's DTBook/NIMAS import
(`Emboss/input/parse.mjs`) has no concept of a "print running header" element to strip — the
assumption in this assessment is that NIMAS production practice already omits these before the
DTBook is built, so there is nothing left for Emboss to filter. Is that assumption right, or
could a real DTBook legitimately carry repeated per-page header text as ordinary body
paragraphs that Emboss would then wrongly transcribe as content? If the latter, this row should
be reclassified from "not-applicable" to "not done" (a detectable-and-droppable pattern Emboss
currently doesn't drop).

---

**Q-20. What print signal, if any, should mark "screened material" as boxed when there is no
`<sidebar>` element?**

BANA 7.1.1 applies §7's rules equally to material printed inside a literal box **and** to
"screened materials shown by the use of colors or shaded backgrounds" — treating both alike
as "boxed material". Emboss currently only ever produces a `box` block from an explicit
`<sidebar>` element (or a nested `<div class="…sidebar…">` one level inside an already-open
sidebar). A book that marks screened/shaded material some other way in its DTBook/NIMAS source
— a top-level `<div>` with a different class, or no distinguishing markup at all beyond
authoring convention — would never be recognised, and would flatten into ordinary paragraphs
with no box lines. See `boxes-writeup.md` F-74.

Is this a real gap worth closing (do real books actually mark screened material without a
`<sidebar>` wrapper?), or is `<sidebar>` already how every real screened-material case reaches
Emboss in practice (in which case 7.1.1 is effectively fully satisfied and this is moot)?

---

**Q-21. Should Emboss support different-coloured/screened boxes at all (BANA 7.5), and if so,
how should the colour be captured and rendered?**

BANA 7.5.1/7.5.2 require indicating a box's colour (unless every box in the book is the same
colour) by splicing the colour name, in transcriber's-note brackets, into the very start of
the box's own opening border line (e.g. `@.<yellow@.> 7777…`, BANA Sample 7-2). Emboss has no
colour field on a box at all right now, and its title-placement convention is the opposite of
what this needs — `formatBox` always puts a box's title/heading on the line *after* the top
border, and `Emboss/tests/bana_sidebar_sync.test.mjs` has its own regression test asserting
titles are *not* spliced into the border line. See `boxes-writeup.md` F-72.

This is already flagged as an open question in Paul's own baseline
(`Emboss/docs/style-specification.md:158`: "Q: support BB's Full Box and colour boxes
(§7.4–7.5)?"). Options: (a) don't support it (out of scope, current behaviour); (b) add a
`color` field to the box block/DTBook markup (e.g. a class) and a distinct border-line-splice
render path used only when it's set, leaving the existing after-the-line title placement
unchanged for boxes with no colour. Which does Paul want, and is it worth building before the
rest of the §7/§7.4 gaps (Q-22)?

---

**Q-22. Does Paul want facing-braille-pages / combined-page-number support for boxes that
span facing print pages (BANA §7.4)?**

BANA 7.4.1a lets a box that reads across two facing print pages as a single unit be
transcribed as one box with a combined page number (e.g. "22-23"), optionally omitting its box
lines if the content fits on one braille page without them, or — for a table specifically —
produced as facing braille pages (cross-referencing BANA §11.13). Emboss has no combined
page-number rendering, no facing-braille-pages layout, and no box-line-omission heuristic at
all; the §11.13 table equivalent is separately tracked as not done
(`standards-findings.md` F-18). See `boxes-writeup.md` F-73.

`style-specification.md:158` already flags §7.4 as an open question alongside §7.5's colour
boxes (Q-21). Given F-18 (the table facing-pages gap) is already on the list, does Paul want
the box version built at the same time (they'd likely share a facing-pages mechanism), or
deferred as a separate, lower-priority item?

---

**Q-23. BANA 11.4.3a: when a table's primary (two-tier) column heading is wider than all of
its sub-column headings combined, should it overhang unwrapped, or wrap onto a second line
within its sub-columns' own width?**

11.4.3a says only: "Insert a separation line after the primary heading… The separation line
is the width of the primary heading when it is wider than all of the sub-column headings" —
it says the SEPARATION LINE takes the heading's width in that case, but never says outright
whether the heading TEXT above it is also left unwrapped (overhanging past its sub-columns)
or is instead wrapped onto a second line the same way any other column heading can be
(§11.4.1's generic two-line cap), leaving the sub-columns' own width untouched either way.
Paul's interim decision (17 Sep 2026, Change 2, `EMBOSS-TASKS.md` T9's own note): overhang
unwrapped whenever the whole table still fits the line with the overhang (separation line at
the heading's full width; the next column starts two cells after the wider of the heading and
its span); wrap within the span, widened only to the heading's own widest word, only when the
overhang itself would not fit the page. This is implemented (`computeTableColumns`'s
`overhangWidths`/`.overhang`, `formatGroupedHeaderRows`/`traceGroupedHeaderRows`,
document.mjs) and tested directly against the rule text (`table_heading_placement.test.mjs`),
but **no worked example in this section has a primary heading actually wider than its own
span** (standards-findings.md F-12's original observation, still true), so neither branch is
gold-verified. Is Paul's reading above the one a transcriber would recognise, or would a real
transcriber always wrap the heading instead (treating "the separation line is the width of the
primary heading" as describing only the LINE, not licence to overhang the heading text itself
past the columns it heads)?

---

**Q-24. Should Emboss build out script + the five transcriber-defined typeform indicators
(BANA 5.1.4, 5.5.1, 5.5.2, 5.5.3, 5.9.1), given the underlying liblouis UEB table already
supports all of them correctly?**

`liblouis/tables/en-ueb-g1.ctb` (included by the live translation table) fully defines
`emphclass script` and `emphclass trans1` through `trans5`, each with its own symbol/word/
passage signs and terminator (verified directly: injecting `tf=8`/`tf=32` into a real
`formatDocument` + liblouis run produces correct, distinct signs). Nothing in Emboss's own
code — not the parser, not the `TYPEFORM` constant, not the editor's toolbar — ever produces
or exposes these bits (see `assess-5/typeforms-writeup.md` F-86). Building this out would
need, at minimum: (a) a way for a source document to say "this run is script" or "this run
is transcriber-defined attribute N" (an editor UI control, plus DOCX/HTML import signals —
e.g. a CSS class or font-family convention for script; something for colour/highlighting/
double-underline, per F-91); (b) a per-document registry assigning trans1-trans5 in
first-use order (5.5.2) and refusing a 6th; (c) a generalised Special Symbols page (or
transcriber's-note fallback) listing whichever indicators were used (5.5.3, blocked
separately — see Q-27). This is a substantial feature, not a small fix. Given the project's
existing style-specification.md documents which BANA/UKAAF gaps are deliberate provisional
choices, should this go on the task list as a real feature, be deferred, or does Paul want a
narrower first slice (e.g. script only, or one hardcoded transcriber-defined colour
indicator, without the full ordering/registry machinery)?

---

**Q-25. Should headings (and/or lists) gain an explicit "keep this segment's emphasis, don't
strip it" signal?**

`standards-findings.md` F-41 already asks this for Formats §4.3.7's own "necessary for
clarity" exception. BANA 5.3.1 raises the identical question from within §5 (the
"partially emphasized...must be retained" exception for headings/lists/TOC/dedications), and
5.4.2's worked examples (5-11, 5-12) are headings that specifically need PARTIAL retention.
Separately, `formatList` has the opposite default from headings — it never strips anything,
so a wholly-decorative list-wide emphasis (5.3.7, Example 5-7) is always wrongly kept. Should
one design (e.g. a `block.keepEmphasis` flag, or per-segment) cover both the "keep part of a
heading's emphasis" and "drop a whole list's decorative emphasis" cases, or are these two
separate features? (See `assess-5/typeforms-writeup.md` F-87, F-88.)

---

**Q-26. Should `document.mjs` track a typeform passage spanning consecutive paragraphs, per
UEB §9.9.1 (cited by BANA 5.6.2 itself)?**

Currently every paragraph is translated independently, so a font-emphasis passage spanning
two or more consecutive, fully-emphasised paragraphs gets a terminator on EVERY paragraph
instead of only the last one (`assess-5/probe.mjs` TEST 7; `assess-5/typeforms-writeup.md`
F-90 — classified as a bug, not merely unimplemented). This would need a way to mark
"paragraph N continues the same typeform passage as paragraph N-1" (similar in spirit to the
existing `block.continued`/`block.continuation` flags used for a paragraph split around a
print page turn, `document.mjs:531-533`) and suppress the terminator until the final
paragraph of the run. Worth fixing given it's a small, well-scoped defect with a clear
correct behaviour (unlike the larger F-86/Q-24 feature)?

---

**Q-27. Is a generalised "Special Symbols page" (BANA 5.5.3, and needed elsewhere in
Formats too) worth building now, or only once transcriber-defined typeform indicators
(Q-24) are being built anyway?**

`document.mjs:104`'s own comment already flags this as a known, standing gap — currently
worked around for exactly one hardcoded symbol (the print asterism) via an ad hoc
transcriber's note, with no way to list any other symbol category (guide dots, table
indicators, or the typeform indicators this section needs). Since Q-24's answer determines
whether there is anything new to list, should this wait for that decision, or is a general
Special Symbols mechanism worth its own task regardless (it would also fix the asterism's
current one-off special-casing)?

---

**Q-28. Should a quote/epigraph block ever inherit its adjusted margin from a surrounding
list's nesting depth automatically, or is a manually-set level acceptable?**

BANA 9.2.2 gives a worked example: displayed material inside a triple-nested list (margins
1-7/3-7/5-7) should begin at cell 9, two cells right of that list's own runover. Emboss's
`quoteMargins` (document.mjs:511-517) computes this correctly *arithmetically* (`nest =
level*2`), but nothing in the parser or editor sets a quote block's `level` from the depth of
an actually-surrounding list — the one existing `level` assignment for a quote block tracks
DTBook section nesting (`<level1>`…), a different concept. See F-96.

Options: (a) leave `level` as something the transcriber sets by hand when they know displayed
material is nested (simplest, already works arithmetically); (b) have the parser/editor derive
it automatically from actual list nesting depth when a quote appears inside a list item.
Which does Paul want, and is (a) good enough given how rare deeply-nested displayed material
inside a list is likely to be?

---

**Q-29. Should Emboss offer BANA's "indented" displayed-paragraph option (5-3), or is
"blocked" (3-3) enough?**

BANA 9.2.2d gives transcribers a choice: paragraphs of displayed material can be "blocked" at
the adjusted margin (what Emboss always does today) or "indented" 2 cells further right on the
first line only. `Emboss/docs/style-specification.md` already asks this as an open question
("offer BANA's blocked vs indented choice (BB has both)?"). See F-97.

Options: (a) blocked only (current, simplest); (b) add an indented variant, selectable per
document or per quote block. Which does Paul want?

---

**Q-30. Should Epigraph share Blockquote's style, or become its own, given they need
different margins?**

`Emboss/docs/style-specification.md` already flags this ("epigraphs (BANA §9.3) — same style
or separate?"), and this assessment found the answer matters concretely: BANA 9.3.1c says
"do not treat epigraphs as displayed material" and 9.3.1b's own example wants an epigraph
paragraph at the ordinary body-paragraph margin (3-1), not the displayed-material adjusted
margin (3-3) Epigraph currently gets by sharing Blockquote's `style:'quote'`/`QUOTE_STYLES`
membership. See F-94.

Options: (a) give `epigraph` its own style entry, defaulting to plain body-paragraph margins
(3-1) unless the transcriber picks Poem for verse; (b) keep sharing Blockquote's style but add
a way to say "this one is an epigraph, use its own margin"; (c) decide the current shared
behaviour is acceptable and 9.3.1b/c should be read more loosely than this assessment did.
Which does Paul want? (9.3.1d's blank-line-before/after and 9.3.1e's font-attribute question
are separate from this margin question — 9.3.1e has no omission logic at all yet regardless of
which style epigraph ends up using.)

---

**Q-31. Should BANA §9.5 Source Citations get its own style, distinct from §9.4 Attribution?**

The two sections describe different things (an attribution identifies who wrote/said the
quoted material; a source citation gives the origin of data/an illustration/a table), with at
least one rule that only applies to citations, not attributions (9.5.1b's "at least one line
must stay on the same page" — itself unimplemented either way, see F-100). Today a transcriber
must reuse Attribution for a citation to get the right cell-5 margin at all — which happens to
satisfy the blank-line rules for free (9.5.1c/9.5.1d/9.5.2 all pass), but conflates two
concepts the standard keeps separate. See F-101.

Options: (a) accept the Attribution reuse as Emboss's answer (simplest, works for the margin
and blank-line rules today); (b) add a distinct Source Citation style so the two concepts are
tracked separately (needed if the same-page-keeping rule, or per-context margin differences
like 9.5.4's images, are ever built). Which does Paul want, and how urgent is it relative to
the rest of the pilot?

---

**Q-32. Does the two-caption sequencing for an image's source/copyright text (9.5.4) actually
match Sample 9-7's exact spacing?**

`formatCaption` gives the right 7-5 margin for a second, source-citation-carrying caption
placed after an image's own caption, but always opens with its own leading blank line — and
Sample 9-7 ("Source Citation to an Image") is a worked, page-braille example that could settle
whether that leading blank is wanted here or not. This assessment is Stage 2 (Assess), not
Stage 3 (Gold examples), so Sample 9-7 was not built and run. See F-102.

This is really a "build the gold example next" flag rather than a question needing a decision
from Paul now — noting it so Stage 3 doesn't skip it.

---

**Q-33. Can a heading appear inside displayed material at all — and if so, how should its
margin track the adjusted margin?**

BANA 9.2.2c requires cell-5/cell-7 headings inside displayed material to shift to 7-7/9-9, but
`Emboss/docs/style-specification.md`'s own containment table doesn't list a heading among the
blocks Blockquote may contain, and `formatHeading` has no adjusted-margin parameter at all.
See F-95.

Options: (a) decide this combination doesn't need supporting (headings inside quotes may be
rare enough in real transcription work to defer); (b) add heading to Blockquote's allowed
content and thread the adjusted margin through `formatHeading`. Which does Paul want, and how
urgent is it?

---

**Q-34. How should a "hollow dot" print reference mark reach Emboss, so it can map to `;9"0`?**

BANA 16.2.2's symbol table gives a fixed braille equivalent for a hollow-dot reference mark
(`;9"0`), the same way it does for asterisk/dagger/double-dagger — but "hollow dot" isn't one
Unicode character with an obvious canonical form (candidates seen in the wild: ○ U+25CB,
◦ U+25E6, • U+2022, or a specific glyph in the source font). Right now `NOTE_SYMBOLS`
(`document.mjs:597`) only has asterisk/dagger/double-dagger; a hollow-dot mark falls through
to raw liblouis translation and produces garbage (see `notes-writeup.md` F-106).

Options: (a) add a fixed set of likely Unicode hollow-dot characters to `NOTE_SYMBOLS`;
(b) give the parser/editor a way to flag a reference mark explicitly as "hollow dot"
regardless of which character represents it in the source (similar to how table headings
got an explicit class signal, F-4/Q-1 in the tables findings). Which does Paul want, and how
common is this particular mark in the material Emboss actually needs to handle?

---

**Q-35. Should Emboss build a true inline-note segment type, and if so, how does it wrap
within a paragraph's own line-fill?**

Both BANA §16.4 (a placeholder "note" marker glued onto the end of the text it applies to)
and B004 Appendix D's "except where directly inserted in braille at the point of reference"
case need a note's TN-bracketed content to sit *inline*, sharing a line with surrounding
prose and wrapping along with it — something Emboss's segment model has no equivalent of
today (every `note`/`footnote` block always starts its own fresh line; see `notes-writeup.md`
F-107). This is a bigger design question than most: it needs a new segment type recognised by
`groupSegments`, and a policy for what happens when the inline TN text is too long to fit on
the line it's glued to (does it wrap normally, or force a line break before it?).

Is this worth building now, given it affects both a BANA sub-rule (16.4c) and a B004 one
(notes-referencing's own exception clause), or should it wait? If built, should the parser
represent it as a new segment `type` (e.g. `'inline-note'`), or should DTBook's own
`<prodnote>`/`<annotation>` embedded inline just be read differently depending on context?

---

**Q-36. Is `noteLayout`'s "queue until the next print-page marker" placement the right model
at all, or does BANA §16.5.1 need real per-print-page tracking?**

F-108 (`notes-writeup.md`) found that `noteLayout`'s deferred-flush design can silently
reorder a referenced note past an unreferenced one, and can displace a note past an entire
subsequent section (heading and all) whenever no `pagenum` block happens to sit between them
— which defeats 16.5.1c (text order), 16.5.1g (separating same-page note runs by heading),
and 16.5.1h (no blank line between a note run and a following heading) all at once for any
document that doesn't mark every print page explicitly.

This seems like a genuine bug regardless (notes shouldn't reorder relative to each other),
but fixing it properly for 16.5.1g/h might need `noteLayout` to reason about "is there
another note-bearing heading between here and the next real page boundary" rather than just
"is there a `pagenum` block." Is a straightforward ordering fix (keep pending notes in their
original relative order; never let one hop ahead of another) enough for now, or does Paul
want the fuller multi-title-per-page behaviour (16.5.1g) built at the same time?

---

**Q-37. Should a table's own cell content ever be allowed to "claim" a preceding footnote at
all?**

F-109 found that a footnote referenced from inside a table cell gets moved to *after* the
table (via `noteLayout`'s blind `"noteref"` JSON scan treating the table block as the
referencing block) — the opposite of what BANA 16.8.1a wants (notes belong *before* the
table). The straightforward fix is to exclude table blocks from `noteLayout`'s
reference-scanning entirely (table-cell noterefs would then need their own note-placement
handling per §16.8, which doesn't exist yet either — F-110). Is that the right general
direction (table-referenced notes are always §16.8's problem, never §16.5's), or are there
cases where a table-cell noteref genuinely should behave like an ordinary in-text one (moved
to end-of-print-page, per §16.5.1)?

---

**Q-38. Should multi-paragraph note splitting be automatic (parser-side), or does the
transcriber decide?**

F-113 found that a DTBook `<note>` with two `<p>` children collapses into one flat block —
both BANA 16.5.1d (5-3 margins for "additional paragraphs in a note") and B004 D's own
"software can automatically separate the paragraphs into two separate notes" phrasing imply
some kind of automatic behaviour is expected. Should Emboss's parser automatically preserve
each `<p>` as its own sub-block within the footnote (so `formatFootnote`'s existing
`block.blocks` array mechanism, `document.mjs:723-729`, renders each at the right margin), or
does "software can automatically separate…" mean something more literal — actually splitting
one multi-paragraph `<note>` into two independent, separately-numbered notes? These would
render quite differently.

---

**Q-39. Is a facing-page (recto/verso) pagination concept worth building at all?**

F-117 found that Emboss has no notion of a braille page's left/right position — BANA 16.7.7's
"combined print page numbers" and B004 D's "notes on facing pages … placed on facing pages in
braille" both assume this concept exists. It's a fairly deep change (interpoint pagination
awareness throughout `page.mjs`/`document.mjs`), and the manual workaround (typing a combined
page number as free text) already covers the numbering half. Does the material Paul is
targeting actually contain enough facing-page note layouts (plays, mainly, per B004's own
example) to justify building real facing-page awareness, or is the manual-numbering fallback
sufficient for now?

---

**Q-40. What should trigger the endnote-section page break and auto "NOTES" heading, given
there's no explicit "this is the start of an endnote section" block today?**

F-111 found that nothing forces a new braille page before an endnote section (16.9.3a) or
auto-inserts a "NOTES" TN heading when none is given (16.9.3b) — partly because there's no
single block that marks "the endnote section starts here" (endnotes are just individual
`kind:'endnote'` footnote blocks, wherever the author put them). Should Emboss infer the
start of an endnote section as "the first `kind:'endnote'` block after a run of non-endnote
content," or should the author/parser mark it explicitly (e.g. a `sectionStart` flag on the
first endnote, similar to how table headings got an explicit signal)? The answer affects both
this rule and the (also-missing) editor UI for creating an endnote section from scratch.

---

**Q-41. How much of §16.11 (Keying Technique for Marginal Labels) is worth building, and
when?**

F-119 found this entire sub-section — marginal-label recognition, key-letter assignment,
braille grouping indicators (`.=<`/`.=>`), the TN-enclosed key list — has zero supporting
code anywhere. It's a distinct, fairly self-contained feature (unlike most of §16, it doesn't
touch the note/footnote pipeline at all) that would need: a way to mark print text as a
"marginal label" during parsing/authoring, a key-assignment step (manual, since 16.11.1a-c
say the letters must reflect meaning and avoid numbers/contractions), and new
grouping-indicator rendering. Is this common enough in the material Paul is targeting to
prioritize, or should it wait?

---

**Q-42. Is the blank line Emboss inserts before every UKAAF footnote correct, given B004's
own Example 2 shows none between consecutive footnotes?**

F-112 found `noteLead` (`document.mjs:719-720`) unconditionally returns a blank line before
every UKAAF-mode footnote — including a second footnote immediately following a first one —
whereas B004's own worked Example 2 shows the two footnotes adjacent with no blank line
between them. B004 gives no explicit numbered rule here, only this one example. Is the
current blank-line-before-every-note behaviour a deliberate UKAAF house style Paul wants kept
(distinguishing each note visually), or should Emboss match Example 2 exactly and omit the
blank line between consecutive footnotes that form one run?

---

**Q-43. Is a semantic "notes volume" feature worth building, or is manual placement +
the existing page-count volume splitter good enough?**

F-118 found that every volume-placement rule for notes (BANA 16.1.5d, 16.9.2b/c, 16.10.1a/b;
B004 D near-text-placement, end-of-book) is achievable today only by an author manually
ordering blocks so notes land wherever `formatVolumes`'s page-count split happens to fall,
with no automatic grouping of "this document's notes/endnotes" into their own volume and no
auto-inserted explanatory TN. Given how rarely a "heavily annotated" text needing a dedicated
notes volume is likely to come up compared with the rest of the standards-testing backlog, is
this worth scoping as a real feature, or should it stay a manual-authoring convention (with
Paul deciding, per book, how to split volumes and where to place the explanatory TN)?

---

**Q-44. Should a poem/verse block get an automatic blank line before/after it, the way lists
and boxes already do?**

`formatList` and `formatBox` both push their own leading/trailing blank line; `formatPlay`
(verse) does not (F-121). BANA 13.3.1a requires one (with two named exceptions, one of which —
cell-5/7 heading before the poem — is already coded and tested but currently does nothing
because there's no default blank line to suppress). Fixing this affects several other rules
at once (13.7.1a prose poems, 13.9.3b between two doubly-transcribed versions, 13.11.2b before
the first verse) since they share the same root cause. Worth prioritising given how many rules
it unblocks at once?

---

**Q-45. Should stanza/verse numbers get their own cell-5-heading rendering instead of being
prefixed to the line's text?**

13.4.1b and 13.11.4a both call for this; currently the parser folds a stanza/verse number
into the first line's plain text (F-123), which also means it isn't distinguishable from the
line's own content (e.g. it currently gets caught up in the same word-wrap as the verse text).
Is this worth a dedicated fix, and if so, is a stanza/verse number represented in the source
markup distinctly enough today (`<linenum>`) to drive it?

---

**Q-46. Is the UKAAF "line indicator" method (B004 App J) worth building at all?**

It's explicitly optional ("may be employed where space-saving is desirable") and Emboss
already fully supports the "normal" line-by-line method. Building it would need a genuinely
new per-verse-line-end symbol and stanza-numbering convention (F-128) with no BANA analogue.
Given the pilot's "keep costs reasonable" instruction, should this stay unbuilt unless a real
transcription needs it?

---

**Q-47. Is the §13.9 scansion/stress "double-writing" technique in scope for Emboss at all?**

It needs (a) a diacritic placed one line above a specific letter (F-127) — something no part of
Emboss's single-line-per-verse-line text/braille model can represent today — and (b) tracking
a relationship between a poem's two separate transcriptions (shared page placement,
conditional title/attribution repetition). This looks like a much larger feature than the
rest of §13 combined, for a narrow use case (poems specifically marked up with scansion). Is
it worth scoping, or should 13.9.3/13.9.3c/13.9.3e stay marked "not done" indefinitely as
genuinely out of reach for now?

---

**Q-48. Should Emboss have a way to preserve deliberate multi-space gaps (BANA 13.6.3's
"three blank cells", and 13.9.5's symbol-diagram spacing)?**

Right now any run of spaces collapses to one, everywhere in the text pipeline (F-124), so this
rule cannot be satisfied even by a careful transcriber. If wanted, is the right layer a
parser-side escape (e.g. a literal non-breaking-space run that survives to the formatter), or
a formatter-side flag on the block/segment?

---

**Q-49. Given how many sections' rules reference it (this section: 13.2.1c, 13.9.2, 13.9.4b;
also 4.9.3, 8.6.2b, 16.2.2b, 5.5.3 and others already found), should the "Special Symbols
page" (BANA §2.5, front matter) move up the priority list?**

Recorded here only because it recurs yet again in §13/Appendix J — no new information, just
another data point on how often this single missing feature is the blocker.

---

**Q-50. Is the Title Page / Second Title Page / Special Symbols Page / Transcriber's Notes
Page feature set in scope at all, and if so, how much of it?**

`frontmatter-writeup.md` F-132/F-137/F-138/F-139 found that none of these four
transcriber-generated pages exist in any form — not a missing formatting detail, but an
entirely absent feature. Building even the simplest version (Title Page with just
title/author) requires new data-model fields Emboss currently has none of (subtitle, series,
edition, grade level, publisher, copyright date/holder, ISBN, printing history, transcriber
name, base code, proofreader, translator, editor) and most of these are not reliably present
in NIMAS/DTBook source files at all — some (transcription year, base code, transcriber name)
describe the *transcription itself*, not the source book, so they could only ever come from
new UI fields the transcriber fills in by hand, not from import.

Options: (a) build a minimal Title Page (title + author only, everything else typed as a
generic front-matter block) now; (b) build the full five-segment page with new UI fields for
transcriber/transcription/publisher/ISBN metadata; (c) defer the whole feature — Emboss users
may already produce a title page by hand as ordinary body content, imperfectly, and accept
that as the interim state. Which does Paul want, and how much of it (if any) belongs before
NIMAS/DTBook and translation checks are done?

---

**Q-51. Should the multi-volume table-of-contents work (F-146) wait for BANA §1.6's volume-
splitting fix (F-56) first?**

F-146 found that `buildToc`'s pages always ride entirely with volume 1, and no per-volume
splitting, "Volume 1"/"Volume 2" labelling, brief-vs-full distinction, or mid-chapter
"(cont.)" continuation exists. But `standards-findings.md` F-56 (assessed for BANA §1.6.1a)
already found that volume splitting itself is a pure page-count cutoff with no concept of
chapter/unit boundaries — so even *if* a per-volume table-of-contents were built today, it
could not correctly say "this entry's content starts in volume 2" without F-56 being fixed
first (the split point is arbitrary relative to headings).

Does Paul want F-56 (logical-break volume splitting) fixed before this table-of-contents work
is attempted, since building the latter on top of the former's current arbitrary cutoff would
produce a feature that is right by construction only when the cutoff happens to land on a
chapter boundary?

---

**Q-52. `buildToc`'s auto-generated Contents heading always reads "Contents" — should it be
configurable to match print's own wording?**

F-149 found `buildToc` (`document.mjs:2677`) hard-codes the translated word "Contents" as its
heading, but BANA 2.10.3a requires the print document's own contents heading ("Table of
Contents", "What You Will Study", etc.) to be followed. Since `buildToc` builds its contents
from headings rather than from a real print contents page, there is no natural source for
"what print called it" unless a new field is added (e.g. an optional heading-text setting next
to the existing `o.toc` checkbox).

Is a fixed "Contents" acceptable for the auto-generated case (arguably reasonable, since this
path exists for informal materials with no real print contents page — B004 3e's own "know how
to create a table of contents automatically" scenario), or should it be made configurable?

---

**Q-53. Should Emboss auto-detect an alphabetically-ordered contents list and switch it to
index formatting (BANA 2.10.15), or should the transcriber mark this explicitly?**

F-154 found the destination format (index) already exists and works, but nothing decides
*when* to use it instead of the ordinary contents format. This is the same shape of choice as
`standards-questions.md`'s existing Q-1 (table caption vs. heading): (a) always treat a
`kind:'toc'` list as a contents list (current behaviour, sometimes wrong for an alphabetical
one); (b) add an explicit signal (a class/checkbox) meaning "this is really an index"; (c) a
heuristic that inspects entry order and infers alphabetical sequencing automatically. Which
does Paul want?

---

**Q-54. Does the `t`/`p` page-number-prefix gap (F-131/F-141, extending existing F-58) need
its own fix, or should it be bundled with whichever of Q-50's page features gets built?**

Every one of the missing pages in Q-50 would also need correct `t`-prefixed (transcriber-
generated) or `p`-prefixed (front-matter) braille page numbering to be genuinely useful, and
right now *nothing* Emboss produces gets a `t` prefix and only `buildToc`'s own pages get `p`
(as `P`, in fact — see F-58's own note that the letter case itself may also need checking
against the standard's lowercase `p1`/`t1` examples). Building a small, general
"front-matter/transcriber-generated page number" primitive once, ahead of the specific pages
that would consume it, seems likely to be cheaper than re-deriving it per feature — does Paul
agree, and if so, should it be prioritized ahead of Q-50's page-content work?
