# G4 real-file corpus — provenance

Gathered 23 September 2026 for task G4 stage 1 (measuring how real documents in
DOCX, EPUB, HTML, Markdown, RTF and ODT import into NIMAS/DTBook). Every file
below is public domain or under a licence that permits redistribution; the
licence and source are recorded per file. Total corpus size: ~14 MB.

No application code was changed to produce this corpus. See
`Emboss/docs/g4-real-file-import.md` for the stage-2/3 measurement and findings.

## DOCX

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `docx/fungal-skin-nail-infections-guidance.docx` | UK Health Security Agency / PHE, via [gov.uk publication](https://www.gov.uk/government/publications/fungal-skin-and-nail-infections-diagnosis-and-laboratory-investigation), file at `assets.publishing.service.gov.uk/media/5a81c3fd40f0b623026990b0/Fungal_skin_and_nail_infections_guidance_.docx` | Open Government Licence v3.0 (confirmed on the publication page) | 2026-09-23 | Clinical guidance: custom-named heading styles (`PHEFrontPageMainTitle`, `PHEHeading`), numbered/bulleted lists, 4 tables, 2 embedded images, bold/italic emphasis, hyperlinks. No footnotes. |
| `docx/statutory-guidance-probation-roles.docx` | Ministry of Justice, via [gov.uk publication](https://www.gov.uk/government/publications/statutory-guidance-core-probation-roles-and-qualification-requirements), file at `assets.publishing.service.gov.uk/media/624323a1d3bf7f32ac2b93da/...docx` | Open Government Licence v3.0 | 2026-09-23 | Statutory guidance: standard `Heading1`/`Heading2`/`Heading3` styles plus `CoverTitle`/`ContentsHeading`, 3 tables, 2 images, 5 footnotes, 26 hyperlinks. |
| `docx/template-framework-document-executive-agencies.docx` | Cabinet Office / HMT, via [gov.uk publication](https://www.gov.uk/government/publications/managing-public-money-framework-documents), file at `assets.publishing.service.gov.uk/media/62de78c1d3bf7f2d839ff145/...docx` | Open Government Licence v3.0 | 2026-09-23 | Long template document: standard `Heading1`/`Heading2`/`Heading4` plus custom `TitleGrey`/`Subtitle`/`HMTtitlep2`/`AnnexHeading`/`HeadingSpacer` styles, deeply nested numbered lists (up to level 5), 2 tables, 3 images, 24 footnotes, 93 hyperlinks. |

## ODT

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `odt/custom-shape-tutorial.odt` | LibreOffice Documentation Team (Regina Henschel), via [books.libreoffice.org](https://books.libreoffice.org/en/) → `documentation.libreoffice.org/assets/Uploads/Documentation/en/Tutorials/CustomShapes7/Custom-Shape-Tutorial.odt` | Dual-licensed GNU GPL v3+ / Creative Commons Attribution 4.0+ (stated in the document's own Copyright page: "Copyright © 2022 by Regina Henschel") | 2026-09-23 | Large illustrated tutorial (9.7 MB): 3-level headings, ~560 embedded screenshots (mostly wrapped in single-cell layout tables), 592 tables total, footnotes, internal/external links, bold/italic. |
| `odt/model-services-contract-core-terms.odt` | Cabinet Office, via [gov.uk publication](https://www.gov.uk/government/publications/the-model-services-contract-core-terms-england-wales), file at `assets.publishing.service.gov.uk/media/68af25512f185664821558d2/MSC_-_Core_Terms_-_E_W_-_ODT_v2.2A_2025.odt` | Open Government Licence v3.0 | 2026-09-23 | Long legal/contract document: 2-level headings, deeply nested numbered clause lists (up to level 8), 3 tables, 4 images, extensive internal cross-reference and mailto: links, heavy inline bold/italic. |

## RTF

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `rtf/inclusive-accessible-stadia-report.rtf` | Sports Ground Safety Authority / DCMS, via [gov.uk publication](https://www.gov.uk/government/publications/disabled-spectators-and-sporting-event-accessibility), file at `assets.publishing.service.gov.uk/media/5a7f78a1e5274a2e8ab4c61d/the-inclusive-and-accessible-stadia-report-rtf.rtf` | Open Government Licence v3.0 | 2026-09-23 | Government report: Word-style-based headings (`Title`, `TOC Heading`, outline levels), 84 bold runs, 7 footnotes, 43 hyperlink fields. No tables/images in this file. |
| `rtf/patent-journal-special-notices-6946.rtf` | UK Intellectual Property Office, via [gov.uk publication](https://www.gov.uk/government/publications/patent-journal-special-notices-6946), file at `assets.publishing.service.gov.uk/media/62c2ecbee90e07748182420e/special-notices-6946.rtf` | Open Government Licence v3.0 | 2026-09-23 | Patent journal notice listing: mostly flat legal/administrative text, 43 bold runs, 4 italic runs, 19 hyperlink fields, minimal heading structure. |

## EPUB

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `epub/alice-in-wonderland-pg11.epub` | Project Gutenberg ebook #11, *Alice's Adventures in Wonderland* (Lewis Carroll), `gutenberg.org/ebooks/11.epub3.images` | Public domain in the US (pre-1928 work); Project Gutenberg License permits free redistribution | 2026-09-23 | Full novel: 12 chapter headings, 15 verse/poem passages (as `<p class="poem">` + `<br>`), 1 table, 1 blockquote (PG boilerplate), 1 cover image, 220 `<i>` italic runs, 6 `<strong>` runs, 29 links. |
| `epub/pride-and-prejudice-pg1342.epub` | Project Gutenberg ebook #1342, *Pride and Prejudice* (Jane Austen), `gutenberg.org/cache/epub/1342/pg1342.epub` | Public domain in the US | 2026-09-23 | Full novel: 65 chapter headings, epistolary block quotations (letters), 2 tables. |
| `epub/sherlock-holmes-pg1661.epub` | Project Gutenberg ebook #1661, *The Adventures of Sherlock Holmes* (Arthur Conan Doyle), `gutenberg.org/ebooks/1661.epub3.images` | Public domain in the US | 2026-09-23 | Full story collection: 12 chapter headings (+3 sub-headings), 2 tables, 1 cover image, 71 `<i>` italic runs, 1 `<b>`/6 `<strong>` runs, 30 links. |

## HTML

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `html/alice-in-wonderland-pg11.html` | Project Gutenberg, `gutenberg.org/cache/epub/11/pg11-images.html` | Public domain in the US | 2026-09-23 | Same content/markup as the EPUB above, single HTML file (with `images/` referenced but not fetched — Emboss's parser only needs the markup for this test, not the actual image bytes). |
| `html/sherlock-holmes-pg1661.html` | Project Gutenberg, `gutenberg.org/cache/epub/1661/pg1661-images.html` | Public domain in the US | 2026-09-23 | Same content/markup as the EPUB above. |

## Markdown

| File | Source | Licence | Fetched | Contents |
|---|---|---|---|---|
| `md/ch03-02-data-types.md` | *The Rust Programming Language* book, chapter "Data Types", `raw.githubusercontent.com/rust-lang/book/main/src/ch03-02-data-types.md` | Dual-licensed MIT / Apache License 2.0 (repository `LICENSE-MIT` / `LICENSE-APACHE`) | 2026-09-23 | Technical chapter: headings (H2–H4, some inside blockquote asides), 32 fenced code blocks, a real Markdown table, reference-style links, underscore-italic emphasis, blockquote asides. |
| `md/ch08-01-vectors.md` | Same book, chapter "Storing Lists of Values with Vectors" | MIT / Apache-2.0 | 2026-09-23 | Technical chapter: headings (H2/H3), 22 fenced code blocks, reference-style links. |
| `md/ch10-01-syntax.md` | Same book, chapter "Generic Data Types" | MIT / Apache-2.0 | 2026-09-23 | Technical chapter: headings (H2/H3), 30 fenced code blocks, underscore-italic emphasis. |

## How licences were verified

- **GOV.UK / assets.publishing.service.gov.uk files**: each publication page
  (linked above) was fetched and checked for the "Open Government Licence
  v3.0" footer notice, which all six carried.
- **LibreOffice documentation ODT**: the file's own `content.xml` was
  unzipped and inspected; its Copyright page states the dual GPLv3+/CC-BY-4.0+
  licence and author.
- **Project Gutenberg EPUB/HTML**: these editions are in the public domain in
  the United States (source texts predate 1928); Project Gutenberg's own
  licence, embedded in each ebook, additionally permits free redistribution
  of the PG transcription/markup.
- **Rust book Markdown**: the `rust-lang/book` GitHub repository carries
  `LICENSE-MIT` and `LICENSE-APACHE` at its root (checked via the GitHub API
  contents listing), the standard Rust project dual-licence applied to the
  whole repository including `src/*.md`.
