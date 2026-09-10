// eBraille 1.0 export for Emboss — a REAL .ebrl, built by the shared writer.
//
// WHAT THIS REPLACED (2026-09-02). The previous exporter wrote its own XML —
// `<ebraille xmlns="http://www.ebu.org/ns/2024/ebraille">`, media type
// application/x-ebraille+xml, extension .ebrf. None of that exists anywhere:
// eBraille 1.0 is an OCF container of XHTML (daisy.github.io/ebraille), the
// DAISY checker rejected the old file outright ("Corrupted EPUB ZIP header"),
// and no eBraille reader could have opened it. Only the name was eBraille.
//
// WHAT IT WRITES NOW. Translate/ebraille.mjs owns the container, the package
// document and the entry page for every app in this repository; this file is
// the Emboss adapter over it. An Emboss document is embosser pages, formatted,
// so that is what the content says: one content document per VOLUME, each page
// a block of lines, every line the cells that would have been embossed -
// blanks included, because on a braille page a blank cell is content. Tactile
// graphics travel as SVG resources and are referenced from the last volume,
// and the package declares them (a11y:tactileGraphics = SVG), as the spec's
// Example 43 shows.
//
// Braille only. The table of contents, the volume labels, captions and even the
// img alt (rendered text, so §3 reaches it) are
// pushed through the same `translate` the pages went through, so nothing on
// the braille side is print (spec §3; the checker's EBR-030).

import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { formatVolumes } from './document.mjs';
import { packageEbraille } from '../Translate/ebraille.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Build a .ebrl (eBraille 1.0) from an Emboss document model.
 * @param {Object} doc  - Emboss document model ({ title, author?, blocks })
 * @param {Object} opts - the formatting options the preview used (width, depth,
 *                        mode, translate, …) plus, optionally:
 *                        brailleSystem  a Braille Codes Registry value
 *                        language       BCP 47 tag WITHOUT the Brai subtag
 * @returns {Uint8Array} the packaged file - save it as .ebrl, application/epub+zip
 */
export function exportToEbraille(doc, opts = {}) {
  const width = Math.max(10, Number(opts.width) || 38);
  const depth = Math.max(10, Number(opts.depth) || 25);
  const title = doc?.title || 'Untitled Document';
  // NO SILENT DEFAULT TRANSLATOR - the rule the PEF exporter follows (#1) and
  // the old exporter kept: a file that "translated" by upper-casing would be
  // print in braille clothing, and nobody would be told.
  if (typeof opts.translate !== 'function') {
    throw new Error('exportToEbraille: opts.translate must be the braille translate function used for the preview');
  }
  const formatOpts = { ...opts, width, depth };
  // The SAME translator the pages went through, so a label is in the same
  // code as the page it labels. Its output is BRF ASCII; the file wants cells.
  const brl = (print) => {
    try { return brfToUnicodeBraille(String(formatOpts.translate(print) ?? '')); }
    catch { return ''; }
  };

  const volumes = formatVolumes(doc, formatOpts);
  const graphics = Array.isArray(doc?.blocks)
    ? doc.blocks.filter((b) => b && b.type === 'graphic' && b.svg) : [];

  const documents = [];
  const toc = [];
  volumes.forEach((vol, vi) => {
    const href = `volume-${vol.volume ?? vi + 1}.html`;
    const label = volumes.length > 1 ? `Volume ${vol.volume ?? vi + 1}` : title;
    const pages = String(vol.brf || '').split('\x0c');
    const pageHtml = [];
    pages.forEach((pageStr, pi) => {
      if (!pageStr && pages.length > 1) return;                 // a trailing form feed
      const lines = pageStr.split(/\r\n|\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      pageHtml.push(`    <div class="sah-page" aria-label="Page ${pi + 1}">\n` +
        lines.map((l) => `      <p>${esc(brfToUnicodeBraille(l))}</p>`).join('\n') +
        `\n    </div>`);
    });
    let body = `  <section class="sah-volume" aria-label="${esc(label)}">\n${pageHtml.join('\n')}\n  </section>`;
    // Tactile graphics ride with the LAST volume: the pages have already been
    // laid out, so the diagram's place in the flow is not recoverable here -
    // but the graphic itself is, and an eBraille reader can show it.
    let svg = false;
    if (vi === volumes.length - 1 && graphics.length) {
      svg = true;
      body += `\n  <section class="sah-graphics" aria-label="Tactile graphics">\n` + graphics.map((g, gi) =>
        `    <figure>\n      <img src="graphics/graphic-${gi + 1}.svg" alt="${esc(brl(g.alt || g.title || 'Tactile graphic') || 'Tactile graphic')}"/>\n` +
        `      <figcaption>${esc(brl(g.title || g.alt || 'Tactile graphic'))}</figcaption>\n    </figure>`).join('\n') +
        `\n  </section>`;
    }
    documents.push({ href, body, svg });
    toc.push({ href, label: brl(label) || label });
  });
  const enc = new TextEncoder();
  const resources = graphics.map((g, gi) => ({
    href: `graphics/graphic-${gi + 1}.svg`, mediaType: 'image/svg+xml', data: enc.encode(String(g.svg)),
  }));

  return packageEbraille({
    title,
    titleBraille: brl(title),
    creator: doc?.author || doc?.creator || 'Unknown',
    producer: 'Sensory App House Ltd',
    language: opts.language || (typeof navigator !== 'undefined' && navigator.language) || 'en',
    systems: [opts.brailleSystem || 'ueb grade2'],
    completeTranscription: true,
    tactileGraphics: graphics.length ? 'SVG' : 'none',
    identitySeed: JSON.stringify(volumes.map((v) => v.brf)),
    toc,
    documents,
    resources,
  });
}
