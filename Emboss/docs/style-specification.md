# Emboss style specification — DRAFT for transcriber review

Status: **draft, 16 Sep 2026.** Written from the standards and the code, not yet reviewed by transcribers. **Paul decides**; transcriber feedback is input. Once agreed, this document is the single source for the style registry (`Emboss/format/styles.mjs`), which drives the slash menu, the style dropdown, the exporter, the parser and the braille formatter (decision G1).

Sources, cited throughout:
- **BANA** — *Braille Formats: Principles of Print-to-Braille Transcription*, 2016 (`references/_text/braille-formats-2016.txt`).
- **UKAAF** — B004 *Braille presentation guidelines* (`references/_text/B004.txt`).
- **UEB** — *Rules of Unified English Braille*, 2024 (`references/iceb/rueb-2024.pdf`); UK computer code: BAUK *Braille Computer Notation*, 2006 (`references/ukaaf/braille-computer-notation.pdf`).
- **DTBook** — ANSI/NISO Z39.86-2005 DTBook 2005-3 DTD (`references/dtd/dtbook-2005-3.dtd`), validated with DAISY Pipeline 2 (NIMAS 1.1 rules).
- **BrailleBlaster** — 3.2.3, `programData/utd/nimas.parserMap.xml` and `BANA.styleDefs.xml` (github.com/aphtech/brailleblaster).

How to read an entry: **Saved as** is the DTBook markup Emboss writes; **BB** is BrailleBlaster's equivalent style; margins are *first-line cell – runover cell*; "blank before/after" means a blank braille line. ⚠ marks a known gap between this spec and the current code (task numbers from `EMBOSS-TASKS.md`). **Q** marks a question for transcribers.

---

## 1. Principles

1. **One registry.** Every style has one entry: id, menu label, saved markup, BANA format, UKAAF format, levels, containment. Menus, parser, exporter and formatter all read it (G1).
2. **Saved files are valid NIMAS.** Only DTBook elements are written; BANA-only distinctions use `class`, with BrailleBlaster's `bai-*` names where BrailleBlaster defines them (D5). BrailleBlaster's custom elements (`<bai-play>` etc.) are read, never written (A24).
3. **Formats come from the mode.** BANA and UKAAF differ in margins and blank lines; the style is the same, the formatter applies the mode.
4. **Levels are nesting, not separate styles.** A level-2 list item is the List style at depth 2; margins are computed from the deepest level in the block (BANA §8.5.1b, B004 App. C).
5. **Hidden features.** Tactile graphics, graph plotting and hardware controls stay in the code and appear only with **Ctrl/Cmd+Shift+\\**, whose state is remembered (G1).

## 2. The menu (first release)

Styles (apply to the current block):

| Menu label | id | Category |
|---|---|---|
| Body Text | `body` | text |
| Heading 1–6 | `h1`…`h6` | heading |
| Bullet List | `list-bullet` | list |
| Numbered List | `list-number` | list |
| Plain List | `plain` | list |
| Index Entry | `index` | list |
| TOC Entry | `toc` | list |
| Exercise | `exercise` | list |
| Glossary | `glossary` | list |
| Poetry | `poem` | poetry |
| Play Dialogue | `dialogue` | drama |
| Stage Direction | `stage` | drama |
| Blockquote | `quote` | text |
| Caption | `caption` | text |
| Attribution | `attribution` | text |
| Footnote | `footnote` | note |
| Transcriber's Note | `note` | note |
| Computer Code | `code` | text |
| Sidebar Box | `sidebar` | container |

Inserts (objects, not styles): Table (spatial / listed), Equation, Formula Templates, Math Matrix, Print Page Number, Document Break. Hidden behind Ctrl/Cmd+Shift+\\: Tactile Graphic, Plot Tactile Graph, Emboss, Embosser & Hardware settings.

⚠ Today the slash menu (33 entries) and the dropdown (18) disagree with each other and with this list; "Caption / Byline" and "Attribution / Byline" labels are wrong (Byline is now part of Attribution); Heading 4–6 are not offered in the menus.

## 3. Styles

### Body Text — `body`
- **Saved as** `<p>`. **BB** Body Text.
- **BANA** §1.9: paragraphs 3-1, no blank line between; blocked paragraphs 1-1 with a blank line between (§1.9.3). **UKAAF** §9 / App. B: 3-1, or blocked with a blank line.
- Indented vs blocked is a document setting, not a style. **Levels:** none. **Contains:** text, emphasis, maths, code, print page turns. **Appears in:** document, sidebar, list item (as a following paragraph), note.
- A paragraph interrupted by a print page turn is split around the page change indicator and resumes in cell 1 (BANA §1.11.3, B004 §8).

### Headings — `h1`…`h6`
- **Saved as** `<h1>`…`<h6>` inside `<level1>`…`<level6>`; `<hd>` inside sidebars and lists. **BB** Centered Heading / Cell 5 Heading / Cell 7 Heading.
- **BANA** §4: tiers are centred, cell-5, cell-7 (§4.2.2). With more than three distinct print levels, cell-7 is kept for the lowest and centred headings extend downwards (§4.2.1) — the tier depends on the document's deepest level. Blank line before; none between connected headings (§4.3.3); none between cell-5/7 and a following list or poem (§4.5.3, §8.3.3a, §13.3.1a); never the last line of a page (§4.3.9); font attributes ignored (§4.3.7).
- **UKAAF** §5 / App. A: L1 centred with a preceding indicator line; L2 cell 1 / runover 5; L3 cell 3 / runover 5; App. A L4 cell 1 bold, L5 cell 1 plain, L6 cell 3 bold (runovers cell 5).
- **Levels:** 1–6. **Contains:** text (emphasis dropped in braille), maths. **Appears in:** document, sidebar (`<hd>`).
- An author line printed with a title belongs to the heading (BANA §2.3.5, §4.3.3 Example 4-2). **Q:** mark it as a connected heading, or leave it as Attribution under the title?

### Bullet List — `list-bullet`
- **Saved as** `<list type="ul">` + `<li>`; nested lists as `<list>` inside `<li>` (G8). **BB** L-styles (list items).
- **BANA** §8: 1-3 with blank lines around the list (§8.3.2); nested margins per §8.5.1b (1-5/3-5, 1-7/3-7/5-7 …); bullets retained, following print (§8.6.2): primary bullet `_4`, other symbols as transcriber-defined symbols listed on the Special Symbols page. **UKAAF** §10 / App. C: levels distinguishable by indentation (1/5, 3/7, 5/9 …) or the 5/1 compact layout.
- **Levels:** unlimited (depth). **Contains:** text, maths, a nested list, following paragraphs. **Appears in:** document, sidebar, list item, note.
- ⚠ Saved flat with `class="level-N"` today, and bullets are dropped on import (G8, A6). ⚠ No Special Symbols page yet (G8).

### Numbered List — `list-number`
- **Saved as** `<list type="ol" enum="1|a|A|i|I" start="n">` + `<li>`. **BB** L-styles.
- **BANA** §8, and §8.8 for outlines: numbers/letters follow print (§8.8.3). **UKAAF** as Bullet List.
- **Levels / contains / appears in:** as Bullet List. ⚠ `enum`/`start` ignored today (G8).

### Plain List — `plain`
- **Saved as** `<list type="pl">`. **BB** L-styles.
- **BANA** §8.3 simple vertical list, 1-3. **UKAAF** §10.
- **Levels / contains / appears in:** as Bullet List. **Q:** is a separate Plain List style needed when print has no markers, or should Bullet/Numbered cover it?

### Index Entry — `index`
- **Saved as** `<list type="pl" class="bai-index">`, items `<li class="bai-index">` (BrailleBlaster's class). **BB** I-styles (INDEX margin type).
- **BANA** §21.2, §21.4: each alphabetic reference starts on a new braille page (§21.2.1a); main entry cell 1, sub-entries +2, all runovers two cells past the deepest sub-entry (§21.2.1b); alphabetical division letters centred (§21.2.3); font attributes ignored when all entries are emphasised (§21.2.2). **UKAAF** App. I: runovers two cells past the deepest entry; page numbers directly after the entry.
- **Levels:** unlimited. **Contains:** text, page references. **Appears in:** document (rear matter).
- ⚠ New-page rule not implemented (A8). **Q:** add BB's Alphabetic Division and Guide Word styles?

### TOC Entry — `toc`
- **Saved as** `<list type="pl" class="toc">`, items `<li class="bai-toc-entry">` with `<lic class="bai-toc-text">` / `<lic class="bai-toc-page">`; centred TOC headings `<li class="bai-toc-center">`. **BB** TOC margin type.
- **BANA** §2.10: nested margins (§2.10.6b); guide dots with a blank cell each side before the page number (§2.10.7a); transcriber-generated contents pages numbered with `t` (§2.2.1b). **UKAAF** App. H: print and braille page columns, hyphen leaders.
- **Levels:** unlimited. **Appears in:** front matter.
- ⚠ Print view breaks multi-line entries (G9); UKAAF two-column layout not implemented; guide-dot spacing wrong (audit).

### Exercise — `exercise`
- **Saved as** `<list type="ol" class="bai-exercise">`, items `<li class="bai-exercise">`. **BB** E-styles (EXERCISE margin type); Directions (5-5) and Directions 7-5.
- **BANA** §10: exercise items as nested lists with aligned runovers (§10.4); directions blocked in cell 5. **UKAAF:** no specific rule (use nested-list layout).
- **Levels:** unlimited. **Contains:** text, maths, sub-questions (nested). **Appears in:** document, sidebar.
- ⚠ The registry also has `exercise-sub` with class `bai-exercise-sub`, which BrailleBlaster does not know — sub-questions should be depth, not a separate style. **Q:** add an Exercise Directions style (BB has one)?

### Glossary — `glossary`
- **Saved as** `<dl>` + `<dt>` / `<dd>`. **BB** G-styles.
- **BANA** §21.6 (glossaries): term and definition per print; nested margins as other alphabetic references. **UKAAF:** no specific rule.
- **Levels:** unlimited. ⚠ The parser inserts an em dash between term and definition that is not in print (audit L5; BANA §1.1.4 follow print).

### Poetry — `poem`
- **Saved as** `<poem>` + `<linegroup>` + `<line>`; title `<title>`/`<hd>`; author `<author>`; line numbers `<linenum>`. **BB** P-styles (POEM list type).
- **BANA** §13: line-by-line, 1-3, runovers aligned for multi-level poems (§13.3.1); blank line before and after the poem (§13.3.1a); stanzas separated by a blank line (§13.4.1a); line numbers at the right margin, not repeated on runovers (§15.3.1b). **UKAAF** App. J: each line in cell 1, runovers cell 5; stanzas separated by a blank line or starting in cell 3; or the line-indicator method for space saving.
- **Levels:** per print indentation. **Contains:** lines, stanzas, title, author, line numbers. **Appears in:** document, sidebar.
- ⚠ Saved as `<p class="bai-verse">` today (A19, A21) — `bai-verse` means verse drama to BrailleBlaster. ⚠ Line numbers are prefixed to the text; no blank lines around the poem (audit M3).

### Play Dialogue — `dialogue`
- **Saved as** `<p class="bai-play">` (level 1: `class="bai-play level-1"`); verse drama `<p class="bai-verse">`. **BB** Prose Play 1-3 / 5-3; Verse Play 1-5 / 3-5.
- **BANA** §14: prose dialogue 1-3, speaker names follow print; verse plays 1-5 / 3-5 (§14.6.1). **UKAAF** App. K: speaker names follow print (italic if print does not distinguish them); prose/verse changes start a new paragraph; shared verse lines get 3 blank cells after the second speaker's name.
- **Levels:** 0–1. **Contains:** speaker name, text, embedded stage directions.
- **Q:** should Verse Drama be its own menu entry (it is a distinct BB style)?

### Stage Direction — `stage`
- **Saved as** `<p class="bai-stage">`. **BB** Stage Directions 7-7 / 9-7; Prose 5-5 / 7-5.
- **BANA** §14.4–14.5: 7-7 (9-7 nested); font attributes ignored (§14.4.1c). **UKAAF** App. K: enclose in square brackets; typeform indicators not needed.
- ⚠ UKAAF brackets not added (audit).

### Blockquote — `quote`
- **Saved as** `<blockquote>` + `<p>`. **BB** Displayed Blocked Text (3-3) / Displayed Body Text (5-3) / Displayed 3-5.
- **BANA** §9.2: adjusted left margin cell 3 (two cells right of the surrounding runover), blocked 3-3 or indented 5-3, blank line before and after, none between paragraphs of one passage. **UKAAF** App. B / G: paragraphs 7-5, no blank lines (a blank between two separate extracts); or full width preceded by a blank line and followed by a dot-2s indicator line.
- **Contains:** paragraphs, list, poem, attribution. **Q:** offer BANA's blocked vs indented choice (BB has both)? **Q:** epigraphs (BANA §9.3) — same style or separate?

### Caption — `caption`
- **Saved as** `<caption>` inside `<table>` or `<imggroup>`. **BB** Caption (7-5), Description (7-5).
- **BANA** §6.2.2: caption 7-5, no blank line before; transcriber's label and description in transcriber's-note indicators on the following line. **UKAAF:** no specific rule.
- ⚠ Saved captions outside a table/image are moved; the editor has no image-description field distinct from the caption. **Q:** add BB's Description style?

### Attribution — `attribution`
- **Saved as** `<byline>` (DTBook has no other element; decision 16 Sep). **BB** Attribution.
- **BANA** §9.4.1: after the quote/poem/story; blocked in the fifth cell to the right of the start of the previous line; never starts a new braille page; blank line after; font attributes kept only for distinction. **UKAAF:** no specific rule.
- ⚠ Fixed at cell 5 today; page rule not applied (A23). **Q:** add BANA's Source Citation (§9.5, BB has it) as a separate style?

### Footnote — `footnote`
- **Saved as** `<noteref idref="#id">` at the reference point + `<note id="id" class="footnote">`. **BB** Footnote (1-3).
- **BANA** §16: reference `;9#a` style indicators; notes after the print page's text, separated by a line of dots 25 (`"333333`); 1-3; additional paragraphs 5-3. **UKAAF** §11 / App. D: notes near the text if few, else collected at the end of the volume; all notes referenced.
- **Contains:** paragraphs. ⚠ `<noteref>` not kept; notes not collected; no separation line (A5).

### Transcriber's Note — `note`
- **Saved as** `<prodnote render="required">` (decision D6). **BB** TRANS_NOTE emphasis in a 7-5 block.
- **BANA** §3: transcriber's-note indicators `@.<` … `@.>`; standard notes 7-5 (§3.2.2); a Transcriber's Notes page for general notes (§2.6). **UKAAF** §11: indicators as UEB; no fixed margin.
- **Contains:** text. ⚠ Saved with `render="optional"` today; imported publisher prodnotes lose their own `render` (A22). ⚠ No Transcriber's Notes page yet.

### Computer Code — `code`
- **Saved as** `<code>` (inline) — ⚠ currently `<code class="uncontracted">` inside `<p>`. **BB:** none.
- **UEB** §11.10 computer notation: uncontracted, with grade-1 / computer-notation indicators; UK: BAUK *Braille Computer Notation*. BANA Formats has no section on code.
- **Q:** block code (multi-line listings, `<samp>`/`<kbd>`) as a separate style? Which notation — UEB computer notation or the 8-dot computer code — for the UK?

### Sidebar Box — `sidebar`
- **Saved as** `<sidebar render="required">` + `<hd>`. **BB** Box, Full Box, Color Box, Color Full Box.
- **BANA** §7 and §12: top box line `7` (dots 2356), bottom `g` (dots 12356); nested boxes use `=` outside; heading on the line after the top line; no blank after the top line or before the bottom line; top line kept with at least one text line (§7.3.5). **UKAAF:** no box-line rule (sidebars follow print or use indicator lines).
- **Levels:** nesting allowed. **Contains:** anything except another document-level heading hierarchy. **Q:** support BB's Full Box and colour boxes (§7.4–7.5)?

## 4. Inserts

| Insert | Saved as | Notes |
|---|---|---|
| Table | `<table>` + `<caption>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` | BANA §11: spatial (guide dots, `"333` separator), listed (§11.16), stairstep/linear not built. UKAAF §12 / App. E: guide dots; paragraph form when too wide. ⚠ Cells are plain text; no overrun warning (G15). |
| Equation | `<m:math alttext altimg>` (MathML 3, `m:` prefix); displayed maths inside its own `<p>` | UEB maths or Nemeth (BANA/ICEB); Nemeth switch indicators in UEB context. ⚠ Editor round-trip loses maths (G6). |
| Print Page Number | `<pagenum id page="normal|front|special">` | BANA §1.11, B004 §8. |
| Document Break | `<p class="bana-break-asterisks">` | BANA §1.9.5 centred print break symbol. **Q:** DTBook has no `<hr>`; keep the class-based paragraph? |
| Tactile Graphic *(hidden)* | `<imggroup>` + `<img src="data:image/svg+xml…">` + `<prodnote render="required">` | BANA §6. |
| Plot Tactile Graph *(hidden)* | as Tactile Graphic | |

## 5. Containment

| Container | May contain |
|---|---|
| Document level (`levelN`) | every style and insert |
| Sidebar Box | body, headings (`<hd>`), lists, exercise, glossary, poetry, drama, blockquote, caption, attribution, notes, code, table, equation, print page, nested sidebar |
| List item | text, maths, code, nested list, following paragraphs; ⚠ tables/sidebars inside list items are dropped on import (A2) |
| Poem | title, author, line groups, lines, line numbers, print page; ⚠ other children dropped on import (A2) |
| Blockquote | paragraphs, lists, poem, attribution |
| Table cell | text; ⚠ emphasis and maths flattened (G15) |
| Footnote / Transcriber's Note | paragraphs (text only for TN) |

## 6. Candidates from BANA / BrailleBlaster not yet in Emboss

Each needs a decision (**Q**): Source Citation (BANA §9.5, BB), Epigraph (BANA §9.3), Exercise Directions (BANA §10, BB Directions 5-5 / 7-5), Image Description (BANA §6.2, BB Description), Alphabetic Division and Guide Word (BANA §21.2–21.3, BB), Incidental Note (BB), Marginal and Paragraph Headings (BANA §4.7–4.8), Verse Drama as a separate menu entry (BB Verse Play), Full / Colour Box (BANA §7, BB), Spelling lists (BANA §17), Pronunciation (BANA §20).

## 7. Registry corrections (code vs this spec)

- `toc` declares `class="toc-entry"`; the exporter writes `bai-toc-entry` (keep `bai-toc-entry`).
- `exercise-sub` (`bai-exercise-sub`) is not a BrailleBlaster class; sub-questions are depth.
- `break` declares `xmlTag: 'hr'`, which is not a DTBook element; the exporter writes a classed `<p>`.
- `caption` is labelled "Caption / Attribution" and `attribution` "Attribution / Byline" — labels should be "Caption" and "Attribution".
- `h1` declares margins 1-1; headings take their tier from the document (BANA §4.2.1).
- `poem` declares `xmlTag: 'poem'`; the exporter writes `<p class="bai-verse">` (A19).
- No `code` or `h4`–`h6` entries exist.
