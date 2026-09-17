# Gold examples — BANA Braille Formats 2016, §12 (Sidebars)

## What these files are

7 JSON files, one per Sample named in §12.4's own table of contents and running rule text:
`sample-12-1.json` … `sample-12-7.json`. Five of the seven (`sample-12-1`, `sample-12-2`,
`sample-12-4`, `sample-12-5`, `sample-12-6`) are captioned "(Print Only)" in the source — no
braille transcription exists for them anywhere in the book. Only `sample-12-3` and
`sample-12-7` carry real braille.

Each file has the same top-level shape as the §7/§8 precedents:

```
{
  "id", "title", "pdfPages", "textLines", "illustrates",
  "print": { "blocks": [...], "notes", "surroundingText", "printFeatures" },
  "braille": { "width", "lines", "pageBreaks", "notes" },
  "uncertain": [ ... ],
  "sources": ["A", "B"],
  "resolution": "..."
}
```

`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text, features }` — `level` is `1`/`2`/`3`/`4` (centred/cell-5/
  cell-7/cell-9), re-derived directly from this section's own agreed `braille.lines` wherever
  braille exists (`sample-12-3`'s "Critical Thinking Skills" and `sample-12-7`'s "Use
  Vocabulary" are both confirmed CENTRED this way — see "Corrections found in both runs"
  below), never taken on either transcription run's own say-so. Print-only samples' heading
  levels are recorded on the strength of the page image's own visual hierarchy alone, since
  there is no braille to confirm them against (see each file's own `uncertain`/`resolution`).
- `{ kind:"paragraph", text, features }` — ordinary running prose.
- `{ kind:"attribution", text, features }` — a fixed cell-5/cell-5 block (BANA §9.4
  `formatAttribution`, reused exactly as the §3 gold precedent reuses it for a "Directions:"-
  style line), used here for `sample-12-7`'s own "Choose the correct term from the list to
  complete each sentence." — confirmed against the braille's own 4-cell first-AND-runover
  margin, which matches neither an ordinary paragraph nor a centred/cell-5 heading.
- `{ kind:"list", items:[...], features }` — a single list, `items[]` of `{marker, text}`,
  reusing `buildListItem` exactly as the §7/§8 precedents do.
- `{ kind:"sidebar", title?, colorNote?, blocks:[...], features }` — BANA §12's own subject
  matter: print's own sidebar, recursed into and built into a document `{type:"box", title?,
  blocks:[...]}` block — IDENTICAL treatment to the §7 gold precedent's own `box` kind, since
  `document.mjs`'s `formatBox` handles `type:'box'` and `type:'sidebar'` the same way
  (`case 'sidebar': return formatBox(block, o)`, `document.mjs:2062`; a print sidebar simply
  IS a box in Emboss's document model, per this task's own brief). `title` is present only
  where the sidebar carries its own accompanying heading set directly on the box (BANA
  7.2.1e) — e.g. `sample-12-1`'s "Try It Out", `sample-12-4`'s "Voices on Government",
  `sample-12-6`'s "You will learn . . ."/"Vocabulary" — and is passed straight through to
  `box.title`. A `kind:"box"` synonym is accepted identically by `buildModel12`, for
  consistency with the §7/§8 builders, though no file in this section currently uses it.
- `{ kind:"other", text, features }` — never modeled; recorded as a limitation, matching the
  §7/§8/§9 precedent's exact convention. Used throughout this section for print-page-number
  badges and running-head/footer text (no document-model counterpart), for the "(Formats:
  ...Location)" instructional callouts BANA itself adds to annotate these worked examples
  (page furniture, not print content a real transcriber would ever encounter), and — once,
  `sample-12-3`'s own CD-icon cross-reference box — for a boxed-in-print element whose real
  braille margin matches neither an ordinary paragraph nor `formatBox`'s box-line convention
  (BANA itself distinguishes a cross-reference from a sidebar in that very sample's own title,
  12.2.1).

## PDF page mapping

**PDF page = printed page + 340** for all of §12, confirmed at `sample-12-1` (printed 12-4,
footer "12-4 Section 12 / Sidebars" on PDF p.344) and re-checked at every subsequent sample's
own footer through `sample-12-7` (printed 12-12/12-13, PDF pp.352-353) — no drift anywhere in
the section. PDF p.351 (printed 12-11) is a blank divider page, confirmed by rendering it
directly (see `sample-12-6`'s own resolution note).

## Corrections found in BOTH runs (not a disagreement between them — errors shared by two
non-independent runs of the same model)

Both transcription runs of this section were produced by the same model (Gemini), so their
agreement with each other is not independent evidence — every claim either run made was
re-checked against the primary source. This reconciliation found several places where both
runs agreed with each other and were still wrong:

1. **`sample-12-3`'s braille dropped three real source lines, recording them as blank.** Both
   runs' `braille.lines` (byte-identical between them, and each run's own `summary.md` claimed
   full in-session verbatim verification) replace three lines of the source `.txt`
   (`references/_text/braille-formats-2016.txt` lines 10111-10142) with an empty string: line 3
   and line 22 are each a literal `444` omission marker, and line 9 is a full 40-cell `7`
   box-TOP line (leaving only the box's own bottom `g` line, at what both runs numbered as
   their own line 20). All three are restored here, confirmed against both the source `.txt`
   (byte-exact, via a small Python script) and the rendered PDF page image (`references/bana/
   braille-formats-2016.pdf` p.347), which shows the same three lines under the excerpt's own
   printed line numbers 3, 9, and 22. This is precisely the failure mode this reconciliation
   was warned about: two non-independent runs of the same model agreeing with each other,
   including both explicitly claiming to have verified the content, is not evidence.
2. **`sample-12-7`'s braille likewise dropped its own trailing `444` line** (source line 19,
   `references/_text/braille-formats-2016.txt` line 10206) the same way, in the one run that
   populated this sample's braille at all (run B's own `braille.lines` was empty for this
   file — an apparent extraction failure in that run, not a disagreement to arbitrate).
   Restored here the same way.
3. **Both runs left several headings' level unset or guessed**, matching this section's own
   equivalent of the §7 `sample-7-03`/§8 precedent: `sample-12-3`'s "Critical Thinking Skills"
   and `sample-12-7`'s "Use Vocabulary" are both confirmed CENTRED (level 1) by
   forward-translating the heading text through Emboss's own `uebG2` translator and matching
   byte-for-byte against the given (corrected) braille line — in both cases the braille's own
   leading-blank-cell count matches `floor((40-len)/2)` for the heading's own braille-cell
   length, not a fixed cell-5/cell-7 indent.
4. **Both runs transcribed several of this section's own decorative ALL-CAPS print headings
   ("Learning the Skill", "Practicing the Skill", "Application Activity", "Critical Thinking
   Skills", "Use Vocabulary") as literal ALL-CAPS text.** Forward-translating the literal
   ALL-CAPS form through Emboss's translator produces a DIFFERENT capitalization pattern (a
   double/triple capital-sign or passage-capitalization indicator per word) than the given
   braille actually shows (a single capital sign per word, e.g. `,le>n+ ! ,skill` — two capital
   signs only, for "Learning"/"Skill"). The real transcriber evidently braille'd these
   decorative print headings in ordinary Title Case, not literal ALL-CAPS; this reconciliation
   follows the braille's own evidence and records each such heading's `text` in Title Case,
   confirmed by an exact forward-translation match against the corrected braille.
5. **`sample-12-6`'s `pdfPages`:** run B's JSON included both 350 and 351 (run A included only
   350); run B's own `summary.md` already says p.351 is "a blank divider ... properly adjusted
   to reflect only the page with content" — the JSON itself just didn't match that statement.
   Confirmed blank by rendering the page directly; `pdfPages:[350]` (run A) is used.

## Structural disagreements between the two runs, resolved from the source

- **`sample-12-1`**: the only wording disagreement in this section — one bulleted item's
  parenthetical reads "(Latin for 'It does not follow')" (run A, capital I) vs "'it does not
  follow'" (run B, lowercase i). This sample is Print Only, so the PDF page image itself was
  read directly (re-rendered at 400dpi and cropped) — the print clearly capitalizes "It", since
  the phrase opens its own quoted clause. Run A is correct.
- **`sample-12-3`'s sidebar placement and reading order**: run A placed the sidebar
  immediately after "Learning the Skill"'s own paragraph (following the print's own yellow
  arrow, which points from "follow the steps listed on the left" into the sidebar); run B kept
  the sidebar in its literal visual position, before the "Learning the Skill" heading. The
  corrected braille settles this: the box's own top/bottom lines sit between the "Learning the
  Skill" paragraph and "Application Activity", so run A's placement (and the arrow's own
  reading-order cue — this sample's whole point, per its own title) is used. Both runs already
  agreed the entire "Practicing the Skill" section (heading, both source quotes, and the
  3-question list) has no braille counterpart in this excerpt; this reconciliation additionally
  found, from the restored line-3 `444` marker, that "Synthesizing Information" and its own
  introductory paragraph are ALSO omitted — a second gap neither run's own notes mention.
- **`sample-12-4`'s reading order**: run A moved the "(Formats: Possible Location)" callout to
  right after the opening five paragraphs and moved the entire "Voices on Government" sidebar
  to the very end of the page, after "The Albany Plan" section; run B kept the sidebar in its
  own visual position (after "Early Attempts") and the callout, followed by "The Albany Plan",
  directly after it. The PDF page image (p.348, re-rendered and cropped) settles this
  decisively: the callout's own arrow visibly starts right under the sidebar's bottom edge and
  curves down-left to point at the words "Albany Plan of Union." at the end of the paragraph in
  "The Albany Plan" section — run B's structure and reading order is correct.
- **`sample-12-5`'s structural completeness**: run A's print.blocks are properly structured
  (real heading levels, an image-placeholder block, the vertical photo-credit text, nested list
  items); run B collapsed both sidebars into single opaque text blobs (even merging the
  "(Formats: Possible Locations)" callout into the "Foldables" box's own text) and used
  non-schema block kinds (`credit`, `caption`, `footer`). Both runs' wording otherwise matches;
  run A's structure is used, converted to this task's own `items[]` list convention.

## A genuinely new finding: a sidebar's box lines are not conditional in Emboss

BANA 12.3.1f says box lines are added "for clarity **if** the content of the sidebar
interrupts the flow of text" — conditional wording — and `sample-12-7`'s own vocabulary
word-list sidebar is transcribed with NO box border at all (just a blank line before and
after, per 12.3.1e), while `sample-12-3`'s sidebar in the very same section IS boxed. Emboss's
`formatBox` (shared unconditionally by every `box`/`sidebar` document-model block) always
emits a top and bottom border line with no way to omit it — see **standards-findings.md
F-230** for the full evidence trail. `sample-12-7` is expected to mismatch on this account
(among others).

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-12 --update-status`: **0 match, 2
mismatch, 5 no-braille** (`sample-12-1`, `-2`, `-4`, `-5`, `-6` are Print Only). Both
mismatches trace to a mix of documented, evidence-based book-excerpt limitations and one new
Emboss finding, with nothing left unexplained:

- **`sample-12-3`** (mismatch) — first differing line is line 1 itself (the print page number
  `#chj`/"380" trailing the heading, which this section's schema has no running-head field to
  build, matching the section-1 precedent's own "documentary only" treatment of a print page
  number); after that, the model legitimately over-produces relative to the given braille at
  both of this file's own `444`-marked excerpt cuts ("Synthesizing Information" and the entire
  "Practicing the Skill" section), per the section-7 `sample-7-03` precedent for a print/
  braille length mismatch in the source corpus itself — not an Emboss defect. The one genuine,
  isolated Emboss gap in this file is the inline transcriber's-note tail on the "Learning the
  Skill" paragraph (`@.<2l@.>`), which Emboss cannot fuse into running text at all — F-107,
  reused. The CD cross-reference box at the end is deliberately left as `{kind:'other'}` (not
  built), per this section's own schema note above.
- **`sample-12-7`** (mismatch) — first differing line is again line 1 (the model legitimately
  builds the "Chapter 6 Review" heading and the entire "Chapter Summary" sidebar, which this
  braille excerpt omits with no marker of any kind — the same book-excerpt-limitation
  treatment as `sample-12-3`, extended to an UNmarked omission per the section-7 `sample-7-03`
  precedent for exactly that situation). Once past that, the "Use Vocabulary" section itself
  matches almost exactly (heading, directions line, and all eight vocabulary words byte-
  identical) except for the new box-line finding above (**F-230** — this sidebar's own real
  braille has no box border at all) and the pre-existing blank-fill gap (**F-36**, reused — the
  print's own underscore-rule blanks have no dot-5 equivalent in Emboss) on the 6-of-8
  fill-in-the-blank items the given braille excerpt does not transcribe (a `444`-marked
  truncation, per the section-3 `sample-3-01`/section-7 `sample-7-03` precedent for building
  the full print content regardless).

See `Emboss/docs/standards-findings.md` F-36, F-107, F-230 for the specific findings this
run's mismatches trace to, and `Emboss/tests/gold_bana_section12.test.mjs` for the regression
guard.
