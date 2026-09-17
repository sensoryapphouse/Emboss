# Emboss styles → DTBook 2005-3 (NIMAS) elements

Corrected version of the style table in the draft letter to Kyle (APH), checked on 2026-09-16 against what Emboss **actually writes** (`Emboss/input/nimas-export.mjs`, `serializeBlock`) — not against intent. Decisions are Paul's; open points are marked **Decide**.

The example files in `docs/aph-example/` were regenerated the same day:

- `source-sample.xml` — the hand-made "everything" example. Before this date it **failed** DAISY's NIMAS 1.1 check (a `<noteref>` without a `#` fragment; two `<m:math>` without `alttext`/`altimg`); both fixed. It now validates (`node Emboss/scripts/daisy-validate.mjs`).
- `emboss-sample-saved.xml` — that file loaded into the editor in Chrome and saved by Emboss. Validates against NIMAS 1.1 (DAISY Pipeline 2, engine 1.15.5).
- `emboss-sample-bana-40x25.brf` — the braille Emboss produced from it in BANA mode, 40 × 25, UEB grade 2. Six pages, every page 25 lines, no line over 40 cells.

Known problems in those outputs (fix before sending, or say so in the letter): the running head and `<doctitle>` read "Table of Contents" instead of the book title; the running head drops capital signs (BANA §1.8.2d says follow print); the poem is saved as paragraphs, not `<poem>`; the footnote reference is not linked (`<noteref>` dropped); links, `<cite>` and `<docauthor>` are dropped on save. All are listed in `EMBOSS-TASKS.md`.

| Emboss style | Letter says | Emboss writes today | Notes |
|---|---|---|---|
| Body Text | `<p>` | `<p>` | ✓ |
| H1 / H2 / H3 | `<h1>`–`<h3>` / `<level1>`–`<level3>` | `<h1>`–`<h3>` inside `<level1>`–`<level3>` | ✓ Levels 4–6 are also kept (`<h4>`–`<h6>`) since 16 Sep; BANA extends centred headings when a book has more than three levels (§4.2.1). |
| Bullet List | `<list type="ul">` + `<li>` | `<list type="ul">` + `<li>` | ✓ On **load**, bullets are currently dropped (task A6). |
| Numbered List | `<list type="ol">` + `<li>` | `<list type="ol">` + `<li>` | ✓ Nested lists are written with `class="level-N"` on `<li>`, not as nested `<list>` elements — **Decide** (G8). |
| Plain List | *(not in letter)* | `<list type="pl">` | Supported (Paul, 16 Sep). BANA §8. |
| Index Entry | *(not in letter)* | `<list type="pl" class="bai-index">`, sub-entries `class="bai-index level-N"` | Supported (Paul, 16 Sep). BANA §21.4. |
| TOC Entry | `class="toc-entry"` → **use `bai-toc-entry`** | `<list type="pl" class="toc">` + `<li class="bai-toc-entry">` + `<lic class="bai-toc-text">` / `<lic class="bai-toc-page">` | Uses DTBook's own `<lic>` list-item components for the page column. |
| Exercise | `class="exercise"` → **use `bai-exercise`** | `<list type="ol" class="bai-exercise">` + `<li class="bai-exercise">` | ✓ BrailleBlaster's class (Decision D5). |
| Glossary / Definition List | *(not in letter)* | `<dl>` + `<dt>` / `<dd>` | Standard DTBook. |
| Poetry | `<poem>` + `<linegroup>` + `<line>` | **`<p class="bai-verse">`** per line | ✗ **Decided:** save as `<poem>`/`<linegroup>`/`<line>` (to build: A19, A21 — `bai-verse` means verse drama in BrailleBlaster). |
| Play Dialogue | `class="play"` → **use `bai-play`** | `<p class="bai-play">` | ✓ Decision D5 (a DTBook `<p>`, not BrailleBlaster's `<bai-play>` element). |
| Stage Direction | `class="stage"` → **use `bai-stage`** | `<p class="bai-stage">` | ✓ Decision D5. |
| Caption | `<caption>` | `<caption>` (moved into the following `<table>`) | ✓ |
| Attribution | `<byline>` inside `<blockquote>` | `<byline>` | **Decided:** one Attribution style writes `<byline>` (DTBook has no other element; BANA §9.4.1; BrailleBlaster maps `<byline>` to Attribution). No separate Byline style. |
| Footnote | `<noteref>` + `<note>` | `<note class="footnote" id="…"><p>…</p></note>` — **no `<noteref>`** | ✗ Reference link not kept (task A5). NIMAS rules require `noteref@idref="#id"`. |
| Transcriber's Note | `<prodnote>` | `<prodnote render="optional">` | **Decided:** `render="required"` (to build); imported prodnotes keep their own value (A22). |
| Sidebar Box | `<sidebar>` | `<sidebar render="required">` + `<hd>` | ✓ `render` is required by the DTD. |
| Table | `<table>` + children | `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`, `<caption>` | ✓ Spatial/listed choice written as `class` when set. |
| Blockquote | `<blockquote>` | `<blockquote class="quote"><p class="quote">` | ✓ |
| Computer Code | *(not in letter)* | `<code class="uncontracted">` inside `<p>` | Supported (Paul, 16 Sep). UEB §11.10 computer notation (UK: BAUK *Braille Computer Notation*); BANA Formats has no code section. |
| Print Page | *(not in letter)* | `<pagenum id="…" page="normal/front/special">` | Also kept when it falls inside a paragraph or heading (16 Sep). |
| Document Break | *(not in letter)* | `<p class="bana-break-asterisks">***</p>` | |
| Equation | *(not in letter)* | `<m:math alttext="…" altimg="…">` (inside `<p>` when displayed) | MathML 3, `m:` prefix as DAISY specifies. |

## Class names — **Decided (D5)**

Emboss writes `bai-*` class names (`bai-verse`, `bai-play`, `bai-stage`, `bai-exercise`, `bai-index`, `bai-toc-entry`, …). They were introduced on 9 Sep in the commit "achieve full BrailleBlaster parity" alongside other BrailleBlaster-style classes the parser recognises (`bai-trans4`, `bai-tabletn`, `bai-toc-center`), so they very probably mirror BrailleBlaster's conventions — the repository does not say so explicitly. None of the real NIMAS samples use them. The letter proposes plain names (`exercise`, `play`, `stage`, `toc-entry`).

Confirmed from BrailleBlaster's own configuration (next section). **Decision (Paul, 16 Sep):** use BrailleBlaster's `bai-*` class names where it defines them as classes; keep play/verse-drama/stage as DTBook `<p>` with `bai-*` classes; never write BrailleBlaster's custom elements; read them on import.

## What the standards and BrailleBlaster actually do (checked 16 Sep)

Sources: BANA *Braille Formats* 2016 and UKAAF B004 (`references/_text/`); the official DTBook 2005-3 DTD (`references/dtd/`); BrailleBlaster 3.2.3 as installed (`/Applications/BrailleBlaster.app/.../programData/utd/nimas.parserMap.xml`) and its source (github.com/aphtech/brailleblaster).

**Byline / attribution.** DTBook has one element: `<byline>` — "information about the creator of or contributor to a work". BANA §9.4.1 defines an *attribution* as "the identification of the source or author of material", usually after a quote, poem or story: block it in the fifth cell to the right of the start of the previous line, never start it on a new braille page, always a blank line after (§9.5 treats source citations the same way). An author shown with a title is part of the title/heading (§2.3.5 author segment; §4.3.3 connected headings, Example 4-2). UKAAF B004 has no rule for attributions or bylines. BrailleBlaster maps **every** `<byline>` to its single **Attribution** style. → One Attribution style that writes `<byline>` matches DTBook, BANA's terminology and BrailleBlaster.

**Class names.** NIMAS/DTBook allow `class` on every element and define no values; DAISY's NIMAS 1.1 validator accepts any. BANA and UKAAF are silent on markup. BrailleBlaster is the only consumer that gives classes meaning: `<li class="bai-exercise">`, `bai-index`, `bai-toc-entry`, `bai-toc-center` (margin types), `<span class="linenum">`, `<span class="underline">`. For drama it expects its own **elements** — `<bai-play level="0|1">`, `<bai-verse level>`, `<bai-stage level>` — and `<bai-tabletn>`, `<bai-trans1…5>`; those are not DTBook elements, so a file using them fails NIMAS validation. In BrailleBlaster `bai-verse` means **verse drama** (Verse Play 1-5 / 3-5); poems are `<poem>`/`<linegroup>`/`<line>` (its POEM list type). Emboss currently writes poems as `<p class="bai-verse">`, which means the wrong thing to BrailleBlaster.

**prodnote / transcriber's notes.** DTBook: `<prodnote>` "contains language added to the alternative-format version by the producer" (descriptions of visuals, operating instructions, differences from print); `render` is required — `required` = "essential content for the user", `optional` = "some user preference may allow skipping over the content". BANA §3: transcriber's notes are inserted by the transcriber and always brailled with transcriber's-note indicators. BrailleBlaster imports `<prodnote>` as a plain PRODNOTE container (ignores `render`); its transcriber's notes are braille-side markup (TRANS_NOTE emphasis in a 7-5 block), e.g. it turns image `alt` text into one. → A transcriber's note is producer-added, essential text: `<prodnote render="required">`. Publisher prodnotes in imported files must keep their own `render` value (Emboss currently rewrites them to `optional`).
