# Icons

The app's UI icons (settings gear, close, fullscreen/focus mode, the export
menu's dropdown arrow) are inlined directly as an SVG `<symbol>` sprite near
the top of `Translate/index.html`'s `<body>`, rather than kept as separate
files here — the app is build-free and self-hosts everything it uses, so
there is nothing to bundle. This folder exists only to carry the licence for
where those `<path>`s came from.

Source: [Iconoir](https://iconoir.com), regular style, 24x24, MIT-licensed —
`iconoir-LICENSE.txt` in this folder is that licence, copied verbatim.

Icons used, and why: emoji glyphs (⚙ ✕ ⛶) rendered as full-colour pictures on
some mobile fonts instead of a plain symbol that takes the surrounding text's
colour — inconsistent with everything else in the brand palette, and the
reason these were swapped in (brand audit, 2026-09-12).

| Symbol replaced | Iconoir icon | Used for |
|---|---|---|
| ⚙ | `settings` | Settings button, and inline in help text wherever it says "Settings" |
| ✕ | `xmark` | Closing the Help dialog |
| ⛶ | `maximize` | Entering/exiting Focus mode |
| ▾ | `nav-arrow-down` | The Export button's dropdown indicator |

## Emboss (feedback 30 Sep 2026, item 18)

Emboss follows the same brand pass. Its icons are the same Iconoir regular set, kept in one module, `web/icons.mjs`
(this `web/` is Emboss's, which Translate's build shares): the pages refer to them as
`<svg class="icon"><use href="#icon-NAME"/></svg>`, and the module adds the symbols to the page when it is imported.
`tests/brand_style.test.mjs` checks every icon a page or the code asks for is in the module.

Quick Mode (`web/index.html`) also carries, inline at the top of its `<body>` as Translate's page does, the five symbols its own markup
refers to (`settings`, `xmark`, `play`, `download`, `nav-arrow-down`), so they are drawn at first paint and not only once the script has
loaded. The module adds every other symbol to that same `<svg id="emboss-icon-sprite">` and never one a second time (the editor has no
inline sprite, so it gets the whole set from the module). The test holds the inline symbols to this module's path data, so they cannot drift.

| Replaced | Iconoir icon | Used for |
|---|---|---|
| ⚙ (and a Feather gear) | `settings` | Settings; Braille formatting buttons; inline in help |
| ✕ | `xmark` | Every dialog, notice and panel close button; removing a print page number |
| ▼ ▲ ◀ ▶ | `nav-arrow-down` / `-up` / `-left` / `-right` | Menu carets; the tactile display's page buttons |
| ▶ ⏹ | `play`, `square` | Read aloud / Stop |
| 🖨 | `printer` | Print the title page; hardware preview badges |
| ⬇ | `download` | Download; the drop-a-file hint |
| 🗑 | `trash` | Delete on a picture, table, graphic or equation card |
| ⚠ ⛔ | `warning-triangle`, `warning-circle` | Notice / Error labels; warning badges (drawn in CSS) |
| 🔣↻ 📖↻ | `refresh` | Regenerate a Special Symbols page / Title Page |
| 📑 📊 📄 📈 📚 | `list`, `table`, `page`, `graph-up`, `open-book` | Contents box, table bar, print page badge, Plot, volume tag |
| slash-menu emoji | `page-search`, `list`, `chat-lines`, `movie`, `journal-page`, `help-circle`, `chat-bubble-empty`, `edit-pencil`, `notes`, `info-circle`, `box-iso`, `open-book`, `multiple-pages-empty`, `hashtag`, `table`, `table-rows`, `calculator`, `sigma-function`, `graph-up`, `media-image`, `settings`, `label`, `box`, `page` | The editor's / commands |

Where the words already say it (the style list, table layouts, picture size and textures, status messages), the emoji was
simply removed.
