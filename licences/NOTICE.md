# Third-party software in Translate

Translate is © Sensory App House Ltd and licensed CC BY-NC-SA 4.0. It carries the
software below, each under its own licence. Every one of them travels with the
app: nothing here is fetched from a third party at run time, so using Translate
reports nothing about the reader to anyone.

The texts named here ship beside this file in `/licences/` on every deploy, and
`build-translate.sh` copies them from the sources given, so they cannot drift
from what is actually shipped.

## liblouis — braille translation

* Version 3.38.0 (`liblouis/configure.ac`), compiled to WebAssembly as
  `engine/liblouis-wasm.js` / `.wasm`, with the translation tables under
  `/liblouis/tables/`.
* Licence: **GNU LGPL 2.1 or later** — full text in `liblouis-LGPL-2.1.txt`.
  (liblouis' own tree also carries GPL 3.0 in `COPYING`, which covers its
  command-line tools; the library this app uses is the LGPL part.)
* Upstream: http://liblouis.io — source for the exact version compiled here is
  the upstream 3.38.0 release, unmodified. Sensory App House Ltd will supply
  that source, and the build flags used, to anyone who asks, for as long as the
  app is distributed. This is the LGPL 2.1 §6 offer.

## Temml — maths layout (LaTeX to MathML)

* Version 0.13.3, vendored at `web/vendor/temml.min.js`. That file is what the
  app loads; `package.json` names the same version so the manifest and the
  deploy agree (it said `^0.13.4` while 0.13.3 shipped).
* Licence: **MIT** — full text in `Temml-MIT.txt` (© 2020 Ron Kok).
* Upstream: https://github.com/ronkok/Temml

## MathCAT — braille and speech for maths

* MathCAT 0.7.6-beta.9, wrapped by the crate `emboss_mathcat` 0.1.0 and compiled
  to WebAssembly at `engine/mathcat/pkg-web/`.
* Licence: **MIT** — full text in `MathCAT-MIT.txt` (© 2022 Neil Soiffer).
* Upstream: https://github.com/NSoiffer/MathCAT

## Inter — the interface typeface

* Licence: **SIL Open Font License 1.1** — full text in `Inter-OFL-1.1.txt`.
* Upstream: https://rsms.me/inter/

## Iconoir — UI icons

* Regular style, 24x24, stroke-based. The settings, close, focus-mode and
  export-arrow icons are inlined as an SVG `<symbol>` sprite directly in
  `Translate/index.html`, rather than shipped as separate files — nothing to
  vendor beyond the path data itself.
* Licence: **MIT** — full text in `Iconoir-MIT.txt` (© 2021 Luca Burgio).
* Upstream: https://iconoir.com

**Why they replaced emoji, which is the part worth not undoing.** The four
controls used emoji glyphs, and some mobile fonts render those as full-colour
pictures rather than as a symbol that takes the surrounding text's colour. A
coloured pictogram ignores the palette, ignores a high-contrast setting, and
cannot be recoloured for focus mode — so on exactly the devices where the app
most needs to be legible, the icons stopped obeying it. Swapped in the brand
audit of 2026-09-12; reasoning recorded here on 10 Oct from Paige's own notes
in their fork (`web/icons/README.md`, PaigeBraille/translate#10), which our
copy had not carried across.

| emoji replaced | Iconoir icon | used for |
|---|---|---|
| ⚙ | `settings` | the Settings button, and inline in Help wherever it says "Settings" |
| ✕ | `xmark` | closing the Help dialog |
| ⛶ | `maximize` | entering and leaving focus mode |
| ▾ | `nav-arrow-down` | the Export button's dropdown indicator |

## APH Braille Shadows — the braille typeface

* Used by permission of the American Printing House for the Blind. What is known
  about that permission, and its limits, is recorded in
  `/web/fonts/PROVENANCE.md`, which ships with the app.
* It is NOT included in the public source repository, which is why that build
  falls back to a plain braille face.
