# Emboss

A standalone **PWA** that converts documents (**.docx · .odt · .epub · .html · .md · .rtf · .txt · .xml / .nimas**) into properly formatted **BRF** braille (UEB / Nemeth), interpreting document structure into correct braille *layout*. Runs entirely in the browser; wrappable in a native desktop webview (macOS / Windows). Engine: **liblouis 3.38.0** (LGPL) + **MathCAT** compiled to WebAssembly.

---

## Features

- **Standards Compliance (UKAAF ↔ BANA)**: Bi-directional switching supporting UKAAF and BANA Formats 2016 layout specifications.
- **Contracted & Uncontracted Braille**: Grade 1 and Grade 2 UEB translation.
- **Full Global Localisation**: 112+ Liblouis translation tables across English, Spanish, French, German, Italian, Welsh, Gaelic, and more.
- **Dual-Pane Live Braille Editor**: Real-time bi-directional synchronization between print formatting (Lexical) and Braille representation with Perkins 6-key chording.
- **Modern Driverless Embosser Spooler**: Direct hardware embossing via Web Bluetooth (BLE `0xFEB0`), WebHID (driverless USB), WebSerial, and Network REST / WebSockets.
- **Tactile Graphics & Image RIP**: High-resolution rasterization for ViewPlus Tiger (7 dot-height relief) and Index Braille double-strike dithering with anti-slicing page boundary splitting.
- **Advanced Document Structures**:
  - **Tables**: Automatic BANA/UKAAF Listed Table and spatial matrix layout.
  - **Poetry & Drama**: Numbered line stanzas with runovers and speaker attributions.
  - **Notes & Footnotes**: Enclosed Transcriber Notes (`. , ... ,.`) and automated footnote end-notes.
  - **Educational XML**: Native parsing of NIMAS 1.1 and DAISY DTBook textbooks.
- **Physical 3D Relief Simulation**: Photorealistic embossing simulator with dynamic directional lighting and tactile dot relief.

---

## Running Locally

```bash
# Serve the app at http://localhost:8137
node scripts/serve.mjs
```
Open [http://localhost:8137/](http://localhost:8137/) (or `/Emboss/web/index.html` for converter / `/Emboss/web/editor/index.html` for editor).

---

## Running Tests

```bash
# Run format test suites
node scripts/test-all-file-formats.mjs
node scripts/test-nimas-suite.mjs
```

---

## Building a Distribution

```bash
# Assemble self-contained dist/ bundle
node Emboss/scripts/build-dist.mjs
```

---

## Licensing & Copyright

**Emboss © 2026 Sensory App House Ltd. All rights reserved.**  
Licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International Public License (CC BY-NC-SA 4.0)](LICENSE).

Third-party dependencies (liblouis, MathCAT, Temml, Lexical, Lucide, Inter) retain their respective open-source licenses — see [NOTICE.md](NOTICE.md).
