# Gold examples — BANA Braille Formats 2016, §21 (Alphabetic References)

## What these files are

55 JSON files, matching the 39 inline **Examples** (`example-21-1.json` … `example-21-39.json`),
11 numbered **Samples** (`sample-21-1.json` … `sample-21-11.json`), 2 embedded, unnumbered
`Sample:` illustrations quoted inline within running rule text (`sample-21.3.1d-sample.json`,
`sample-21.8.6c-sample.json` — matching the §15/§19 gold precedents' own convention for this
exact situation), and 3 UKAAF B004 Appendix I "Good practice" bullet points
(`b004-i-good-practice-1/2/3.json` — B004's own index-formatting good-practice guidance,
`references/_text/B004.txt` lines 803-808; no braille, no BANA rule id).

Each file has the same top-level shape as every other precedent (`id`, `title`, `pdfPages`,
`textLines`, `illustrates`, `print`, `braille`, `uncertain`, `sources`, `resolution`).
`print.blocks[]` is a flat array; each element is one of:

- `{ kind:"heading", level, text }` — an ordinary centred/cell-5 heading, used both for an
  ordinary document title AND for an alphabetical division letter (BANA 21.2.3) — there is no
  dedicated division-letter construct anywhere in Emboss (F-191), so a division letter is built
  the only way it CAN be, as a generic heading, and the section's own known blank-line-placement
  bug (21.2.3d) is left to surface as a real, informative mismatch rather than papered over.
- `{ kind:"paragraph", text, blocked? }` — ordinary prose (21.1.1's own general text, a Title
  Page line for 21.2.5). `blocked:true` marks a flush (cell-1, no indent) paragraph, confirmed
  directly against the given braille's own zero indent — e.g. Example 21-2's introductory
  sentence, flush directly under its own heading.
- `{ kind:"note", text }` — a standalone transcriber's note (`formatTranscriberNote`) — the two
  embedded, unnumbered "Sample:" wordings under 21.3.1d/21.8.6c.
- `{ kind:"list", style, items }` — a document `list` block. `style:"glossary"` routes to
  Emboss's own real `glossary`/`formatGlossary` mechanism (BANA §21.5/§21.6/§21.7/§21.8's own
  entry-word + definition pairs): `items[]` of `{term, def, level, termSegments?, defSegments?}`,
  `level` 1-based (matching every other section's own `buildListItem` convention). Anything else
  is an ordinary `list` (BANA §21.4 indexes, §21.7.2 single-level thesauruses): `items[]` of
  `{text, level, page, segments?}`, whose own `page` field is passed straight through to
  `document.mjs`'s real `pageSuffix` mechanism (BANA 21.4.4 "an index entry consists of the word
  or phrase with all its page references" — the section's own basic, already-working
  page-reference path). A plain list item's own `text`, and a glossary item's own `term`/`def`,
  go through Emboss's ordinary `**bold**`/`*italic*`/`` `uncontracted` `` cell-markup DSL; where
  that flat string syntax cannot express the needed run (bold nested inside an italic passage,
  e.g. Example 21-21's own sample sentence), a raw, already-built `termSegments`/`defSegments`
  array is supplied directly instead and passed through verbatim.
- `{ kind:"other", text, features }` — never modeled; braille page guide words and every mock/
  simulated-braille-page illustration (F-192, no guide-word mechanism exists at all — Examples
  21-7/8/9/10/11), a multilevel dictionary entry with numbered/lettered subentries or a run-in
  derived entry (F-193/F-195 — Examples 21-23/24/25/26/30/33, Sample 21-11), a glossary entry
  with its own syllabified pronunciation (F-200 — Sample 21-3), a glossary entry's own nested
  illustrative/displayed material (F-195 — Samples 21-7/21-8), or a foreign-language entry whose
  own per-page shared left margin must be COMPUTED from the longest preceding article rather than
  hand-assigned (F-193/F-199 — Examples 21-36/21-37).

## How these files were made

1. Two independent transcription runs (`gold-21-A`, `gold-21-B`) already existed, both produced
   by the SAME model (Gemini, 17 Sep 2026, per each run's own `summary.md`) — NOT independent
   evidence of each other, per this task's own brief. Diffed programmatically
   (`compare-gold-21/diffcheck.mjs`, kept in scratch): **every field of every one of the 55 files
   was byte-identical between the two runs except the `sources` tag itself** — the strongest
   possible confirmation of the brief's own warning. Every fact in these files was therefore
   independently re-verified against the source text and, where the text alone does not settle a
   diacritic or unclear glyph, the PDF page image — never taken on either run's own say-so.
2. `braille.lines` for every file was independently re-derived from
   `references/_text/braille-formats-2016.txt` (lines 16058-17222) by a from-scratch script
   (`compare-gold-21/reextract.py`) that strips a leading form-feed page-break marker, the
   "Example N:"/"Sample N:" caption line and any leading blank lines/running-header-footer text
   before real content starts, the numbered-Sample line-number field or the per-file left margin
   (confirmed to vary file-by-file, not a single book-wide constant — measured directly per file
   from its own caption line's own indent, never assumed), and converts U+2800 to a plain space.
   This independent extraction agreed byte-for-byte with both (identical) runs on 41 of the 55
   files; on the other 14, BOTH runs shared the SAME extraction bug (bogus caption/blank/
   page-header lines copied into `braille.lines` as if they were real braille content, in 9
   files; 4 further lines silently DROPPED in Example 21-8; a left margin left un-stripped in
   Example 21-37; a wrongly-non-empty array where the source has no braille at all in Example
   21-31) — corrected in all 14. See `differences.md` §1 for the complete file list and evidence.
3. Separately, and regardless of A/B agreement, the print side of every file was rebuilt onto the
   flat schema above (both runs' own schema used a raw semantic `entries[]` extraction no
   existing Emboss block type can consume) and forward-translated through Emboss's own translator
   (`Emboss/engine/louis.mjs`, `uebG2`, exactly as `gold-run.mjs` does) — used as a MEASURING pass
   (running the real tool, `node Emboss/scripts/gold-run.mjs --section section-21`, and reading
   its own actual diff output) rather than a hand-simulated prediction, per this task's own
   "never invent, always record" precedent. This recovered and corrected: a shared placeholder
   bug (`"Answers a-e."`) in ALL FIVE of this corpus's no-braille prose-only files (§2 below); six
   `illustrates.rule` corrections (a stray period/space, a wrong rule citation, a null left where
   the source's own §21.10 list names one, a full instruction sentence left in place of a rule
   id); several print-side construction fixes found only by actually running the translator and
   comparing byte-for-byte (Example 21-32's own bold/plain word boundaries, Example 21-5's own
   entries wrongly split across two braille lines that are actually one, a `def` field left
   `null` that silently dropped Example 21-21's own entire definition). See `differences.md` §2-4
   for the complete evidence trail.
4. `illustrates.rule` was corrected for six files as described above (§3), matching the
   §15/§19/§13/§16 gold precedents' own step.

See `differences.md` (kept in this session's scratch folder,
`compare-gold-21/differences.md`, per the task's own instructions — not committed to the
repository) for the complete, file-by-file breakdown of every disagreement and every correction
made against the source, including a genuine discovery about `gold-run.mjs`'s own measuring
harness (§6 there: an `uncontracted:true` segment is not actually translated grade-1 within this
harness, since `gold-run.mjs` never wires `o.translateG1` the way the real app does,
`Emboss/web/app.mjs:347` — a harness gap, not an Emboss product defect, and not claimed as a new
finding for that reason).

## `buildModel21` — the alphabetic-references model

`Emboss/format/document.mjs` and `Emboss/input/parse.mjs` were read (read-only) to learn the real
index/glossary model `buildModel21` reproduces (search "index", "glossary", "pageSuffix",
"nestedMargins"): an index/glossary list is NOT a new construct for this section — `document.mjs`
already has a working `formatList`/`pageSuffix` path (BANA §21.4's own page-reference mechanism)
and a working `formatGlossary`/`glossarySegments` path (§21.5/§21.6/§21.7/§21.8's own entry-word +
definition mechanism, real BUT already known-buggy per F-194) from earlier sections' own work —
`buildModel21` therefore builds every representable construct through these two REAL, PRE-EXISTING
mechanisms (plus the generic heading/paragraph/note block types every other section already
shares) rather than inventing anything new, and records every genuine alphabetic-reference
construct this flat schema and these two mechanisms cannot express — a division letter's own
blank-line placement rules, guide words, a multilevel dictionary/thesaurus entry, a
pronunciation-bearing glossary entry, a glossary entry's own nested illustrative material, a
foreign-entry's own computed shared margin — as a documented limitation, per the block-kind list
above and the comment block directly above `buildBlocks21` in `Emboss/scripts/gold-run.mjs`.

## Gold-run.mjs results (18 Sep 2026)

`node Emboss/scripts/gold-run.mjs --section section-21 --update-status`: **4 match** (Examples
21-4, 21-5, 21-14, 21-15 — a plain "follow print" index/glossary passage needing no punctuation
or margin correction reproduces byte-for-byte), **22 mismatch**, **20 not-representable**, **9
no-braille** (the 2 embedded "Sample:" wordings, the 3 B004 good-practice bullets, and 4
print-only worked examples the source itself gives no braille for at all — Examples 21-27, 21-28,
21-29, 21-31). Every mismatch/not-representable file's cause is one or more of the section's own
already-documented findings, plus two newly-confirmed here:

- **F-194** (`glossarySegments` unconditionally injects a colon between term and definition,
  never the applicable 1-/2-blank-cell spacing) is this section's single most common mismatch
  cause, confirmed on 8 files (Examples 21-16/17/18/19/20/21/32, Sample 21-2) — this is precisely
  the rule text (§21.5.1c/d/e) this section's own worked examples exist to illustrate, so these
  are the intended, informative demonstrations of an already-known bug, not new information.
- **F-238** (new — `pageSuffix`'s own trailing-punctuation regex, the SAME bug class as F-194 in
  a sibling code path, does not recognise a closing enclosure symbol): Example 21-1's own
  `"Action archaeology,"` gets a spurious second comma inserted after its own closing quote.
- **F-239** (new — a plain list item's own literal multi-space gap collapses to one space, the
  same root cause F-206 already names reproduced against this section's own §21.5.1e/§21.7.2
  spacing rules): Sample 21-9, Sample 21-10, and Example 21-19's own "daft" item.
- **F-191** (no alphabetical-division-letter construct; a generic heading's own default blank-
  line placement bleeds through, sometimes adding an unwanted blank, sometimes omitting one two
  consecutive centred headings needed): Examples 21-2, 21-3, 21-13, Samples 21-5, 21-6, 21-10.
- **F-192** (no guide-word mechanism at all): Examples 21-7/8/9/10/11, Sample 21-1's own
  trailing guide-word line, Sample 21-4's own mid-entry gap.
- **F-193**/**F-195** (no thesaurus/dictionary construct; a glossary item is a flat term/def pair
  with no nested-material field): Examples 21-23/24/25/26/30/33/36/37, Samples 21-3/7/8/11.
- **F-199**/**F-200** (no superscript-repositioning logic; no dictionary-entry/pronunciation-key
  AST node): Examples 21-34/35, Sample 21-3.
- **F-202** (no automatic foreign-language detection): Examples 21-38/39.
- **F-201**-adjacent (no construct for a heading with its own trailing page-number suffix):
  Example 21-12.

Two further items are left genuinely unresolved rather than forced to a conclusion either way
(§9 of `differences.md`): Example 21-22's own `bacterías` (the only one of 5 Spanish words
tested that matches neither plain nor uncontracted translation — possibly a source-text
extraction artefact, not conclusively an Emboss behaviour), and a handful of pronunciation-guide
diacritic glyphs in Examples 21-23/28/29 carried unchanged from the prior transcriptions. See
`differences.md` for the complete, file-by-file breakdown, and
`Emboss/tests/gold_bana_section21.test.mjs` for the regression guard.
