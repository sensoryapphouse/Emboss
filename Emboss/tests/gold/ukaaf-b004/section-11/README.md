# Gold examples — UKAAF B004, §11 (Notes and footnotes)

## What these files are

2 JSON files, one per worked example named in the section's own "Good practice examples of
notes and footnotes" caption: `b004-11-1.json` (Example 1, footnotes placed inline in square
brackets) and `b004-11-2.json` (Example 2, footnotes placed on a separate page/list). B004's
own Appendix D ("Footnotes and endnotes") has **no worked examples of its own** — confirmed
directly against `references/_text/B004.txt` lines 506-537, which contain only bulleted
good-practice rules, and against `Emboss/docs/standards-map.md`'s own B004 §11+Appendix D
worked-examples table, which lists none under Appendix D — so no `b004-d-*.json` files exist.

Same top-level shape and `print.blocks`/`print.notes[]` schema as the section-16 gold files
(`../../bana-formats-2016/section-16/README.md`) — this is the same reconciliation, covering
BANA §16 and B004 §11/Appendix D together (they share one code/tests/findings base per
`standards-map.md`'s own §11 section header).

## How these files were made

1. Two independent Sonnet transcriptions already existed (Run A and Run B), each having read
   `references/_text/B004.txt` lines 284-326 (§11) and the PDF page images
   (`references/ukaaf/presentation-guidelines-B004.pdf`, pp.9-10; printed page number equals
   PDF page number directly here).
2. `illustrates.rule` was reset to `standards-map.md`'s own already-reconciled id,
   `B004 11 guiding-principles` (row `BANA/B004 11 example-1`/`example-2` in that table's own
   worked-examples list, `Illustrates` column) — neither run's own guess (`B004 11 (guiding
   principle)`, or bare `11`) matched the project's own established spelling.
3. `braille.width` is `null` for both files: B004 states no braille cell width anywhere (unlike
   BANA's stated 40, Formats 1.7.1), and the section's own only candidate anchor — a lone
   right-flush "9" print-page-footer marker between the two worked examples (B004.txt line 306)
   — sits between, not inside, either example's own braille and is 41 columns wide, not a clean
   40; not usable width evidence. `gold-run.mjs --section b004-11` formats this section in
   UKAAF mode at Emboss's own default width, 38 (`o.width || 38`, `document.mjs`, throughout) —
   the same convention the UKAAF Appendix E gold precedent already uses.
4. `b004-11-1` line 1's leading indent was corrected from Run A's 3 spaces to Run B's 4 spaces
   — verified directly against the source (`B004.txt` line 297 has exactly 4 leading ASCII
   spaces before the braille begins). `b004-11-2`'s `braille.lines` already agreed
   byte-for-byte between the two runs and were re-verified independently against the source
   (exact leading-space counts on every line) with no further correction needed.

## Gold-run.mjs results (17 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section b004-11 --update-status`: **0 match, 1 mismatch
(b004-11-2), 1 not-representable (b004-11-1)**.

- `b004-11-1` (inline notes): not-representable — F-107 (`notes-writeup.md`, not yet merged into
  `standards-findings.md`): B004's own inline, bracketed-at-point-of-reference note style has
  no inline-note segment type anywhere in `document.mjs`; built as a best-faith
  text/note/text split (matching F-107's own reproduction), which necessarily mismatches (the
  note lands on its own line, not fused into the sentence).
- `b004-11-2` (footnotes on a separate list): mismatch — reproduces F-112 exactly: Emboss's
  `noteLead` (`document.mjs:719-720`) unconditionally inserts a blank line before every UKAAF
  footnote, but B004's own Example 2 shows its two consecutive footnotes with NO blank line
  between them (`"   #a4 ": ! fam\s #ajff battle took / place4" / "   #b4 o!r re/aurants >e
  available6"`, `B004.txt` lines 320-322, no blank line) — confirmed directly by this gold run,
  not just the scratch reproduction `notes-writeup.md` already described.

See `differences.md` (this reconciliation's own working notes, kept with the task's scratch
files, section-16's own directory) for the full account, including the two runs' schema-level
difference and the width/line corrections.
