# Gold regeneration report (Fable review recommendation 1)

Generated 2026-09-26, reworked twice after review. Compares the BANA gold `braille.lines` as they stood before this work against a mechanical regeneration from `references/bana/braille-formats-2016.pdf`. 485 gold examples carry braille; this covers all of them.

**Revision history:**
1. First pass: inferred blank lines purely from vertical gaps. Review found 2 of 3 applied corrections wrong (`example-18-8`, `sample-6-16`) -- both had a real, already-recorded reason (an errata, and a page break) the vertical-gap approach could not see. Fixed by making the book's own left-margin line numbers the PRIMARY evidence (see below) and adding `protected_pairs()` (never re-open a blank-line GAP an existing correction already closed).
2. Second pass (this one): review found `protected_pairs()` only protected a GAP's own two flanking lines, not a REWRITTEN line's own text sitting inside a gap -- so 3 of the (by then 34) applied fixes silently overwrote a BANA errata or addendum's replacement wording with the PDF's pre-correction text (`sample-2-13`, `sample-2-09`, `sample-2-21-title-page-volume-1`). Fixed by adding `protected_lines()` (any line an existing non-`pdf-glyphs` correction's own `after` produced is never touched), and, while re-scanning the whole corpus for the same pattern, found `protected_pairs()` ITSELF had become far too broad (protecting every adjacent pair in any multi-line correction's `after`, not just a genuine blank-line-removal decision) -- narrowed to a real before/after diff (see "What was found about blank lines").

## What was found about blank lines

This book's PRIMARY evidence for a blank line is a printed left-margin line number (font `LucidaConsole`) beside every braille line inside a numbered box -- including a wholly blank one, which is still a real row (U+2800 glyphs) and still gets a number. `book_margins.py` reads this font directly; `regen.py` treats it as primary evidence and falls back to the K33-era vertical-gap/pitch measurement only for a box with no margin numbers at all.

**Protecting existing corrections, in its final form:**
- `protected_lines(d)`: every line of text an EXISTING non-`pdf-glyphs` correction's own `after` produced (an errata/addendum's replacement wording, or a K33 spacing rewrite). A candidate diff is refused if ANY of its own current lines -- not just the two lines flanking a gap -- is one of these. This is what `sample-2-13`/`sample-2-09`/`sample-2-21-title-page-volume-1` needed: their errata/addendum line sits INSIDE the gap being compared, not at either edge, so the earlier pair-only check missed it.
- `protected_pairs(d)`: computed from an actual before/after DIFF of each existing correction (never every adjacent pair in its `after`, which is what an earlier version of this did and which flagged completely unrelated content elsewhere in a multi-line correction as "protected" too -- caught while testing `check_regen.py`'s new protected-pair check against the whole corpus and seeing dozens of false positives on files this work never touched). Now takes only the pair either side of a pure BLANK-LINE deletion in that diff -- exactly `example-18-8`'s shape (an errata that removed a blank line between two otherwise-unchanged lines, so neither flanking line's own text is itself "protected content", only the closed gap is).

## What was found about page breaks

Unchanged from the previous pass. This book marks a new braille page starting mid-excerpt either with an explicit `-New Braille Page-` marker line (16 found in the PDF) or silently, by the margin numbering simply restarting at 1. `regen.py` detects a break from these two signals directly, never from `braille.pageBreaks` arithmetic, which is cross-checked only for reporting: a bare int / `{afterLineIndex}` / `{index, label: "New Braille Page"}` all encode `ga = value - 1`, exactly matching the book in 24 of 26 files; `{index, label: "print page change indicator"}` is a different, unrelated thing with no pagination effect (confirmed: zero real breaks in all 6 such files); 2 exceptions to the arithmetic (`sample-6-16`, `sample-9-11`) are harmless since the arithmetic is never relied on for correctness. `pageBreaks` was not touched anywhere in this work.

## Boxes with margin numbers vs vertical-gap fallback

245 of 485 examples' boxes carry left-margin line numbers (primary evidence); the other 240 have none and fall back to the K33-era vertical-gap/pitch measurement.

## Counts per class

A file can appear in more than one class.

| class | examples |
|---|---|
| identical | 348 |
| blank-line difference (applied) | 31 |
| protected by correction (not applied) | 4 |
| lines missing or extra (not applied) | 3 |
| example boundary unclear (not applied) | 109 |
| PDF-unreadable (not applied) | 1 |

Total gold examples with braille: **485**. Boundary-unclear moved from 168 (first pass, vertical-gap only) to 109 now: 62 examples moved OUT (mostly leading/trailing now confirmed via margin numbers), 3 newly flagged.

## Applied: blank-line differences (31 examples, 31 gaps) -- all blank-line, zero content

Every one of the 3 content/misread corrections from the previous pass is now REVERTED (see "Protected by correction" below) -- this class is purely blank-line insertions/deletions now.

- **BANA Sample 14-10** (`section-14/sample-14-10.json`)
  - gold lines 10..10: `[]` -> `['']`
    - PDF p.405, margin line numbers 20..20 (confirmed blank, immediately following this box's last matched line): 1 trailing blank line(s); gold had 0
- **BANA Sample 15-3** (`section-15/sample-15-3.json`)
  - gold lines 0..2: `['', '']` -> `[]`
    - PDF p.420: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 2
- **BANA Sample 15-4** (`section-15/sample-15-4.json`)
  - gold lines 0..2: `['', '']` -> `[]`
    - PDF p.421: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 2
- **BANA Sample 17-7** (`section-17/sample-17-7.json`)
  - gold lines 15..15: `[]` -> `['']`
    - PDF p.484, margin line numbers 20..20 (confirmed blank, immediately following this box's last matched line): 1 trailing blank line(s); gold had 0
- **BANA Sample 18-3** (`section-18/sample-18-3.json`)
  - gold lines 12..12: `[]` -> `['']`
    - PDF p.514, margin line numbers 13..13 (confirmed blank, immediately following this box's last matched line): 1 trailing blank line(s); gold had 0
- **BANA Sample 19-2** (`section-19/sample-19-2.json`)
  - gold lines 16..16: `[]` -> `['']`
    - PDF p.528, margin line numbers 17..17 (confirmed blank, immediately following this box's last matched line): 1 trailing blank line(s); gold had 0
- **sample-2-01** (`section-2/sample-2-01.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.68: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-02** (`section-2/sample-2-02.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.69: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-03** (`section-2/sample-2-03.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.70: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-04** (`section-2/sample-2-04.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.71: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-05** (`section-2/sample-2-05.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.72: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-06** (`section-2/sample-2-06.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.73: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-07** (`section-2/sample-2-07.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.74: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-08** (`section-2/sample-2-08.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.75: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-09** (`section-2/sample-2-09.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.76: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-2-11** (`section-2/sample-2-11.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.78: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-12** (`section-2/sample-2-12.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.81: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-13** (`section-2/sample-2-13.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.83: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-14** (`section-2/sample-2-14.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.84: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-15** (`section-2/sample-2-15.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.85: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-16** (`section-2/sample-2-16.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.86: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-19** (`section-2/sample-2-19.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.91: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-20** (`section-2/sample-2-20.json`)
  - gold lines 0..4: `['', '', '', '']` -> `[]`
    - PDF p.92: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 4
- **sample-2-21-pronunciation-key-in-front-matter-pages** (`section-2/sample-2-21-pronunciation-key-in-front-matter-pages.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.98: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-2-21-special-symbols** (`section-2/sample-2-21-special-symbols.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.96: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-2-21-table-of-contents-volume-1** (`section-2/sample-2-21-table-of-contents-volume-1.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.97: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-2-21-table-of-contents-volume-2** (`section-2/sample-2-21-table-of-contents-volume-2.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.98: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-2-21-title-page-volume-1** (`section-2/sample-2-21-title-page-volume-1.json`)
  - gold lines 0..5: `['', '', '', '', '']` -> `[]`
    - PDF p.95: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 5
- **sample-2-21-transcribers-notes** (`section-2/sample-2-21-transcribers-notes.json`)
  - gold lines 0..1: `['']` -> `[]`
    - PDF p.96: this box's first matched line is itself margin line 1 -- 0 leading blank line(s); gold had 1
- **sample-6-12** (`section-6/sample-6-12.json`)
  - gold lines 13..14: `['']` -> `[]`
    - PDF p.175, margin line numbers 14..13 (primary evidence: this book's own left-margin numbering, including numbered blank rows): gives []; gold had ['']
- **sample-6-4** (`section-6/sample-6-4.json`)
  - gold lines 20..20: `[]` -> `['']`
    - PDF p.163, margin line numbers 21..21 (confirmed blank, immediately following this box's last matched line): 1 trailing blank line(s); gold had 0

### Conflict with a prior `resolution` note (flagged for review, not silently overridden)

Unchanged finding: 15 of the 31 `section-2/sample-2-*` files above carry a `resolution` field claiming their leading blanks are a deliberate, sourced choice from a separate `.txt` reconciliation (not the PDF, and not an errata). Independent, direct PDF verification (margin numbers) for 3 of these (`sample-2-01`, `sample-2-13`, `sample-2-19`) found the box's own margin line 1 has real content immediately, no blank rows before it anywhere on the page -- the leading blanks these notes defend do not exist in the book. Applied, but flagged for a second look.


## Protected by correction: NOT applied (38 total)

Item 3's re-scan: every place across the whole 485-example corpus where the PDF's raw (pre-correction) reading disagrees with a line an EXISTING non-`pdf-glyphs` correction's `after` already decided -- the errata/addendum places, useful in their own right. Two shapes:

**A) the corrected line itself sits inside a gap regen.py examined and would otherwise have rewritten (4 cases)** -- these are the ones this task's own gap-based diffing discovered and is now blocked from touching:

- **BANA Example 18-8** (`section-18/example-18-8.json`): gold lines 2..3: vertical gap says 1 blank line(s), gold has 0, but an existing `corrections` entry already made this pairing deliberately -- left untouched
- **sample-2-09** (`section-2/sample-2-09.json`): gold lines 10..12: margin numbers 10->12 on PDF p.76 say ['  a specializ$ =mat is prohibit$4'], gold has ['  ?an 9 an a3essible =mat is an 9fr+e;t4'], but an existing `corrections` entry already made this pairing deliberately -- left untouched
- **sample-2-13** (`section-2/sample-2-13.json`): gold lines 4..7: margin numbers 1->4 on PDF p.83 say ['', '               ,explora;n'], gold has ['', '          ,,unit #a ,explora;n'], but an existing `corrections` entry already made this pairing deliberately -- left untouched
- **sample-2-21-title-page-volume-1** (`section-2/sample-2-21-title-page-volume-1.json`): gold lines 13..15: margin numbers 9->11 on PDF p.95 say ['  a specializ$ =mat is prohibit$4'], gold has ['  ?an 9 an a3essible =mat is an 9fr+e;t4'], but an existing `corrections` entry already made this pairing deliberately -- left untouched

**B) the corrected line itself became (or is adjacent to) a matched ANCHOR, via exact or fuzzy text matching, so no gap comparison was ever attempted for it -- regen.py structurally never tries to rewrite an anchor's own text, so these were never at risk of being applied, but they are exactly the corpus-wide "PDF disagrees with a corrected line" list requested (34 cases, all previously summarised in prose only, under the K33/K28 audit's own `errata_line` exclusion -- listed individually here for the first time):**

| file | id | gold line | gold (kept) | PDF raw (superseded) | correction source |
|---|---|---|---|---|---|
| `section-10/example-10-16.json` | BANA Example 10-16 | 0 | `,:at is "<_1to _1g_'"> on "r n[8` | `,:at is "<_1to _1g"> on "r n[8` | BANA Errata March 2024 |
| `section-17/example-17-1.json` | BANA Example 17-1 | 0 | `el medio ambiente  5viron;t` | `el medio ambiente3 5viron;t` | BANA foreign-language changes June 2024 |
| `section-17/example-17-1.json` | BANA Example 17-1 | 1 | `el mundo  _w` | `el mundo3 _w` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 0 | `la medicina  m$ic9e` | ` la medicina3 m$ic9e` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 1 | `las pastillas1 las pilodoras  pills1` | `las pastillas1 las pilodoras3 pills1` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 2 | `  tablets` | `      tablets` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 3 | `el sintoma  symptom` | ` el sintoma3 symptom` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 4 | `la tos  c\<` | ` la tos3 c\<` | BANA foreign-language changes June 2024 |
| `section-17/example-17-2.json` | BANA Example 17-2 | 5 | `toser  to c\<` | `    toser3 to c\<` | BANA foreign-language changes June 2024 |
| `section-18/example-18-11.json` | BANA Example 18-11 | 0 | ` ;\["333333333333333` | ` ;\[3333333333333333` | BANA Errata March 2024 |
| `section-18/example-18-11.json` | BANA Example 18-11 | 1 | ` ;\["333333` | ` ;\[3333333` | BANA Errata March 2024 |
| `section-18/example-18-12a.json` | BANA Example 18-12a | 3 | `  ;\["33333333333\["33333333\["3333` | `  ;\[333333333333\[333333333\[33333` | BANA Errata March 2024 |
| `section-2/sample-2-09.json` | sample-2-09 | 9 | `,any fur!r reproduc;n or 4tribu;n o!r` | `,fur!r reproduc;n or 4tribu;n 9 o!r ?an` | BANA Addendum Jan 2020 |
| `section-2/sample-2-21-title-page-volume-1.json` | sample-2-21-title-page-volume-1 | 8 | `,any fur!r reproduc;n or 4tribu;n o!r` | `,fur!r reproduc;n or 4tribu;n 9 o!r ?an` | BANA Addendum Jan 2020 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 0 | `las botas  boots1 #h` | `las botas3 boots1 #h` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 1 | ` el bote  boat1 #i2` | ` el bote3 boat1 #i2` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 2 | `      el bote de vela  sailboat1 #aj2` | `      el bote de vela3 sailboat1 #aj2` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 3 | `      pasear en bote de vela  to g \ 9 a` | `      pasear en bote de vela3 to g \ 9 a` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 5 | ` el brazo  >m1 #g` | ` el brazo3 >m1 #g` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 6 | `    brillar  to %9e1 #g` | `    brillar3 to %9e1 #g` | BANA foreign-language changes June 2024 |
| `section-21/example-21-36.json` | BANA Example 21-36 | 7 | `    brindar  to (f]1 #e` | `    brindar3 to (f]1 #e` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 0 | `to %[  ense]ar1 #d2` | `to %[3 ense]ar1 #d2` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 1 | `     to %[ photos  ense]ar fotos1 #i` | `     to %[ photos3 ense]ar fotos1 #i` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 2 | `   %y  t/mido"<a">1 #b` | `   %y3 t/mido"<a">1 #b` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 3 | `   sick2 to be  estar enfermo"<a">1 #g` | `   sick2 to be3 estar enfermo"<a">1 #g` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 4 | `   silk  la seda1 #h` | `   silk3 la seda1 #h` | BANA foreign-language changes June 2024 |
| `section-21/example-21-37.json` | BANA Example 21-37 | 5 | `   silly  tonto"<a">1 #c` | `   silly3 tonto"<a">1 #c` | BANA foreign-language changes June 2024 |
| `section-21/example-21-39.json` | BANA Example 21-39 | 0 | `dessus1 l(-_"7` | `dessus1 l(--` | BANA Errata March 2024 / Addendum January 2020 (21.9.3a/b) |
| `section-21/example-21-39.json` | BANA Example 21-39 | 1 | `der ,tisch1 ,-e` | `der ,tisch1 -e` | BANA Errata March 2024 / Addendum January 2020 (21.9.3a/b) |
| `section-21/example-21-39.json` | BANA Example 21-39 | 4 | `tu ,-ses1 il^%-t` | `tu -ses1 il^%-t` | BANA Errata March 2024 / Addendum January 2020 (21.9.3a/b) |
| `section-8/sample-8-13.json` | sample-8-13 | 2 | `      @.<,9 ! li/ 2l1 ! symbol .=@% is a` | `      @.<,9 ! li/ 2l1 ! symbol .="% is a` | BANA Errata March 2024 (consistency, not itself part of the erratum) |
| `section-8/sample-8-13.json` | sample-8-13 | 7 | `  @% ! ^w+ ( ! text` | `  "% ! ^w+ ( ! text` | BANA Errata March 2024 |
| `section-8/sample-8-13.json` | sample-8-13 | 8 | `  @% ! /yle ( ! lrs us$ 9 h1d+s` | `  "% ! /yle ( ! lrs us$ 9 h1d+s` | BANA Errata March 2024 |
| `section-8/sample-8-13.json` | sample-8-13 | 9 | `  @% ! way ! 9=ma;n is organiz$ 9to` | `  "% ! way ! 9=ma;n is organiz$ 9to` | BANA Errata March 2024 |

## Lines missing or extra: NOT applied, for review

- **example-13-5** (`section-13/example-13-5.json`)
  - between gold lines 1..5: book has 1 unmatched line(s) ['""=;;;']; gold has 1 unmatched non-blank line(s) ['""=;;; [Dot locator for “use” precedes grade 1 passage indicator standing alone. UEB, §3.14]']
- **example-2-13** (`section-2/example-2-13.json`)
  - between gold lines 4..6: book has 0 unmatched line(s) []; gold has 1 unmatched non-blank line(s) ['  or']
- **sample-6-15** (`section-6/sample-6-15.json`)
  - between gold lines 17..20: book has 0 unmatched line(s) []; gold has 1 unmatched non-blank line(s) ['     screenshot for web page layout']

## PDF-unreadable

Unchanged: of the 11 lines corpus-wide where the glyph-position TEXT reading and the 300-dpi PAGE-IMAGE reading disagree, only one falls inside a gold example's own matched content: **BANA Example 19-2** (`section-19/example-19-2.json`), flagged for lower-confidence provenance only (gold's text already agrees with the glyph-position reading, no diff to apply).

## Example boundary unclear: NOT applied, for review (109 examples)

| sub-category | examples |
|---|---|
| leading not verified (this box has no margin numbers) | 50 |
| ambiguous anchor (duplicate run nearby) | 27 |
| leading+trailing not verified (this box has no margin numbers) | 19 |
| margin numbers not contiguous in this window | 6 |
| trailing not verified (this box has no margin numbers) | 4 |
| no/inconsistent match at all | 1 |
| other | 1 |
| leading/trailing NOT all blank (real content found where gold has blank padding) | 1 |

### leading/trailing NOT all blank (real content found where gold has blank padding) -- full list

- **sample-4-07-option-2** (`section-4/sample-4-07-option-2.json`)
  - leading: margin line(s) [1, 2, 3, 4, 5, 6, 7] on PDF p.126 before this box's first matched line are NOT all blank (e.g. '    ,proc$ure') -- gold's 0 leading blank line(s) left unverified (the excerpt may deliberately start past real content)

### margin numbers not contiguous in this window -- full list

- **sample-1-03** (`section-1/sample-1-03.json`)
  - gold lines 4..5: margin numbers between this box's own y-window on PDF p.39 are [], not the expected contiguous 6..24 -- left for review
- **sample-1-04** (`section-1/sample-1-04.json`)
  - gold lines 1..2: margin numbers between this box's own y-window on PDF p.40 are [], not the expected contiguous 3..24 -- left for review
- **sample-2-21-pronunciation-key-in-front-matter-pages** (`section-2/sample-2-21-pronunciation-key-in-front-matter-pages.json`)
  - gold lines 8..10: margin numbers between this box's own y-window on PDF p.98 are [], not the expected contiguous 9..24 -- left for review
- **sample-2-21-special-symbols** (`section-2/sample-2-21-special-symbols.json`)
  - gold lines 9..11: margin numbers between this box's own y-window on PDF p.96 are [], not the expected contiguous 10..24 -- left for review
- **sample-2-21-transcribers-notes** (`section-2/sample-2-21-transcribers-notes.json`)
  - gold lines 9..11: margin numbers between this box's own y-window on PDF p.96 are [], not the expected contiguous 10..24 -- left for review
- **BANA Sample 21-4** (`section-21/sample-21-4.json`)
  - gold lines 3..5: margin numbers between this box's own y-window on PDF p.588 are [], not the expected contiguous 7..22 -- left for review

### no/inconsistent match at all -- full list

- **example-2-16** (`section-2/example-2-16.json`)
  - no book line matched at all

### other -- full list

- **BANA Example 21-8** (`section-21/example-21-8.json`)
  - gold has 1 blank line(s) exactly at a braille-page boundary (margin numbering 1->1) (gold lines 0..2)
  - gold has 1 blank line(s) exactly at a braille-page boundary (margin numbering 1->1) (gold lines 2..4)
  - gold has 1 blank line(s) exactly at a braille-page boundary (margin numbering 1->1) (gold lines 4..6)

## gold-run.mjs before/after (all 21 BANA sections, no `--update-status`)

Only the 7 sections containing a touched file (2, 6, 14, 15, 17, 18, 19) can possibly differ; the
other 15 are byte-identical before and after by construction. Ran before (all 31 files reverted to
their pre-this-work state) and after (as committed) for those 7, and after only for the rest.

**Status changes: zero**, same as both previous passes. Totals identical before and after:
`no-braille: 83, mismatch: 161, not-representable: 163, match: 161`. Expected: `gold-run.mjs`'s
own `expectedLinesFor` already trims a leading `''` and both sides' trailing blanks before
comparing, which is the shape of most of the leading/trailing fixes above, and every touched
example that remains "mismatch" already differs from Emboss's actual output for unrelated
formatting reasons this work never touched.

## run-all-tests.mjs --jobs 4

239/239 headless tests pass, 0 failures (66 s wall). All 21 `gold_bana_section*.test.mjs` guards
pass, individually and in the full suite (the 7 touched sections run explicitly on their own too,
199/199 pass). No test guard pins literal line content (only match/non-match CATEGORY against
`status.json`), so none needed editing.

## Files changed

- `Emboss/scripts/gold-spacing-audit/audit.py`, `apply.py`, `book.py` -- worktree-root path fixes
  only (unchanged since the first pass)
- `Emboss/scripts/gold-spacing-audit/book_margins.py` -- extracts the book's margin line numbers
  and `-New Braille Page-` markers (unchanged since the first rework)
- `Emboss/scripts/gold-spacing-audit/regen.py` -- this pass adds `protected_lines()` (protects any
  REWRITTEN line an existing correction produced, wherever it sits in a gap, not just at a gap's
  own two edges) and narrows `protected_pairs()` to a genuine before/after diff of each existing
  correction (a pure blank-line-removal decision) rather than every adjacent pair in its `after`
- `Emboss/scripts/gold-spacing-audit/apply_regen.py` -- unchanged this pass
- `Emboss/scripts/gold-spacing-audit/check_regen.py` -- adds check 2: every protected line/pair,
  across ALL gold files (not just pdf-glyphs-touched ones), must still be present/adjacent
- `Emboss/scripts/gold-spacing-audit/README.md` -- documents the above
- `Emboss/scripts/gold-spacing-audit/regen-report.md` -- this file
- 31 gold files (listed under "Applied"), each with one `corrections` entry
  (`source: "pdf-glyphs"`, `reasonClass: "blank-line"`) -- none now touch a protected line

Not committed (large, regenerable, PDF-derived, same convention as the existing K33 artifacts):
`book_lines.json`, `book_margins.json`, `audit_raw.json`, `regen_raw.json`.

## Out-of-scope findings

- `example-13-5`/`example-2-13`/`sample-6-15` ("lines missing or extra" above) need a human look:
  `example-2-13`'s gold includes a standalone `"or"` line that in the PDF is set in ordinary print
  font (not `SimBraille`) -- explanatory prose about two alternative page-number outputs, not
  actual braille content; likely should not be in `braille.lines` at all.
- The section-2 `resolution`-field conflict (above) covers 15 files; the same reasoning may apply
  to other `section-2` files not in this run's touched set that share the same leading-blank
  pattern and have not yet been checked against the PDF directly -- worth a follow-up sweep.
- `sample-6-16`'s `pageBreaks: [26]` value is very likely a data-entry error (should be `25`) --
  `pageBreaks` was left untouched per this task's scope, but flagged here since it is now
  independently confirmed wrong.
- The "Protected by correction" (B) table above is, as far as this tool's own anchor/gap matching
  can discover, the full corpus-wide list of places the PDF disagrees with an errata/addendum
  line -- but it is bounded by that matching (a correction whose line fails to align with the book
  at all, e.g. because the book window itself is wrong, would not surface here and would instead
  show up, if at all, under "lines missing or extra" or "example boundary unclear"). Worth noting
  for anyone treating this table as exhaustive.
