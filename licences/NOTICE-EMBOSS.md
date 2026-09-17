# Third-party software in Emboss

Emboss is © 2026 Sensory App House Ltd. Emboss's own licence terms are stated
in the app's About dialog and in `COPYRIGHT.md` at the repository root; this
file does not restate them. It lists the third-party components that travel
with every Emboss build — the `dist/` tree assembled by
`Emboss/scripts/build-dist.mjs` — with the version actually shipped, where it
came from, and where the full licence text lives. Nothing listed here is
fetched from a third party at run time: everything runs from the served files.

The build copies this whole `licences/` directory into `dist/licences/`, and
`Emboss/scripts/check-dist.mjs` fails the build if this notice or any licence
text it names is missing from the result, so they cannot drift from what ships.

(`licences/NOTICE.md` is the equivalent file for Translate.)

## liblouis 3.38.0 — braille translation

* **Shipped as:** `engine/liblouis-wasm.js` + `engine/liblouis-wasm.wasm`
  (the library statically compiled to WebAssembly), and its translation tables
  under `/tables/` (all 475 tables from `liblouis/tables/`, because
  `engine/louis-browser.mjs` loads tables on demand by name and any of the
  supported locales may ask for any of them).
* **Version:** 3.38.0 — `liblouis/configure.ac` (`AC_INIT([Liblouis], [3.38.0] …)`);
  the compiled engine's `lou_version()` reports the same (see `BUILD_LOG.md`).
* **Licence:** **GNU Lesser General Public License 2.1 or later** — full text in
  `liblouis-LGPL-2.1.txt`. (The liblouis tree also carries GPL 3.0 in
  `COPYING`; that covers its command-line tools, which Emboss does not use.
  The library and the tables are the LGPL part.)
* **Upstream:** https://liblouis.io — https://github.com/liblouis/liblouis

### LGPL 2.1 §6 — relinking and source

liblouis is *statically* linked into `engine/liblouis-wasm.wasm`. Under LGPL
2.1 §6 a recipient must be able to modify liblouis and relink Emboss against
the modified version. To make that possible:

* The complete source of the exact liblouis compiled here — the upstream
  3.38.0 release, unmodified — is in the repository at `liblouis/`
  (`Emboss/liblouis` is a symlink to it).
* The build recipe that produced the shipped `.js`/`.wasm` — emscripten
  version, `configure` host/flags, and the full `emcc` link line including the
  exported functions and runtime methods — is recorded in `BUILD_LOG.md` at
  the repository root under **"Build recipe (WASM)"**.
* Rebuilding with a modified liblouis and dropping the resulting
  `liblouis-wasm.js` and `liblouis-wasm.wasm` over the two files in
  `engine/` is all that is needed: `engine/louis-browser.mjs` loads the engine
  only through the `createLiblouis()` factory those files export, and the
  tables are plain files under `/tables/`.
* Sensory App House Ltd will supply that source and those build instructions
  to anyone who asks, for as long as the app is distributed.

## MathCAT 0.7.6-beta.9 — braille and speech for maths

* **Shipped as:** `engine/mathcat/pkg-web/emboss_mathcat.js` +
  `emboss_mathcat_bg.wasm`, produced from the wrapper crate `emboss_mathcat`
  0.1.0 in `Emboss/engine/mathcat/src-crate/`. MathCAT's speech and braille
  rule files are embedded in the wasm (the crate's `include-zip` feature) and
  are part of MathCAT under the same licence.
* **Version:** 0.7.6-beta.9 — pinned as `mathcat = "=0.7.6-beta.9"` in
  `src-crate/Cargo.toml`, resolved in `Cargo.lock`, and the version string
  embedded in the shipped `emboss_mathcat_bg.wasm` reads `0.7.6-beta.9`.
* **Licence:** **MIT** (© 2022 Neil Soiffer) — full text in `MathCAT-MIT.txt`.
* **Upstream:** https://github.com/NSoiffer/MathCAT

## Temml 0.13.3 — LaTeX to MathML

* **Shipped as:** `vendor/temml.min.js` (from `web/vendor/temml.min.js`).
* **Version:** 0.13.3 — the bundle's own `version:"0.13.3"`; `package.json`
  pins `temml` to `0.13.3`.
* **Licence:** **MIT** (© 2020 Ron Kok) — full text in `Temml-MIT.txt`.
* **Upstream:** https://github.com/ronkok/Temml

## MathLive 0.101.2 — maths input field

* **Shipped as:** `vendor/mathlive.min.js` (from `web/vendor/mathlive.min.js`),
  plus the assets the MathLive package distributes with it: `vendor/sounds/`
  (keypress and plonk `.wav`) and `vendor/fonts/` (the `KaTeX_*.woff2` maths
  faces MathLive renders with).
* **Version:** 0.101.2 — the bundle header reads `/** MathLive 0.101.2 */`;
  `package.json` names `mathlive ^0.101.2`.
* **Licence:** **MIT** (© 2017–present Arno Gourdol) — full text in
  `MathLive-MIT.txt`, which is the licence file the MathLive npm package ships
  for everything in it, fonts and sounds included. The `KaTeX_*` fonts
  originate from the KaTeX project (https://github.com/KaTeX/KaTeX); the
  MathLive package carries no separate licence file for them.
* **Upstream:** https://github.com/arnog/mathlive

## Lexical 0.46.0 — the editor framework

* **Shipped as:** `editor/vendor-lexical.mjs` (from
  `web/editor/vendor-lexical.mjs`), a single bundle of `lexical`,
  `@lexical/rich-text`, `@lexical/list`, `@lexical/selection` and
  `@lexical/utils`.
* **Version:** 0.46.0 — the version string inside the bundle; `package.json`
  names all five packages at `^0.46.0`.
* **Licence:** **MIT** (© Meta Platforms, Inc. and affiliates) — full text in
  `Lexical-MIT.txt`.
* **Upstream:** https://github.com/facebook/lexical

## Inter — the interface typeface

* **Shipped as:** `fonts/inter-*.woff2` (from `web/fonts/`).
* **Licence:** **SIL Open Font License 1.1** — full text in
  `Inter-OFL-1.1.txt` (also beside the fonts as `fonts/Inter-OFL.txt`).
* **Upstream:** https://rsms.me/inter/

## APH Braille Shadows — the braille typeface

* **Shipped as:** `fonts/APH_Braille_Shadows.{woff2,woff,ttf}`.
* Used by permission of the American Printing House for the Blind. What is
  known about that permission, and its limits, is recorded in
  `fonts/PROVENANCE.md`, which ships with the app next to the font files.
* It is NOT included in the public source repository, which is why that build
  falls back to a plain braille face.

## In the source tree but not in the build

* `web/vendor/verovio/` — Verovio 6.2.0 (LGPL-3.0-or-later; its own
  `NOTICE.txt` is in that directory). `build-dist.mjs` does not copy it and no
  Emboss runtime file imports it, so it is not part of a shipped Emboss build.
  It is listed here only so that the `Emboss/web/vendor/` directory is fully
  accounted for.

Everything else in `dist/` — the pages, the layout engine under `format/`,
`input/`, the `Translate/*.mjs` modules shared with Translate, and the tiny
`serve.mjs` — is Sensory App House Ltd's own work.
