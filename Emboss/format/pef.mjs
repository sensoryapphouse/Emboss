// PEF (Portable Embosser Format 1.0) XML exporter module.
// Converts BRF braille pages into PEF 1.0 XML documents (http://www.daisy.org/ns/2008/pef).
//
// Contract: opts.translate MUST be the same braille translate function the caller used
// for its preview/BRF. There is deliberately no default — an earlier default of
// `t => t.toUpperCase()` produced PEF files holding print letters mapped through the
// NABCC table (uncontracted, no capitals, wrong digits) that did not match the preview.

import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { formatVolumes } from './document.mjs';

export function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// A PEF <row> may hold ONLY Unicode braille patterns (U+2800–U+28FF). brfToUnicodeBraille
// maps any non-NABCC char (é, curly quotes, lowercase…) to an ASCII space; replace every
// such char with the blank cell U+2800 and report how many were replaced.
export function brfLineToPefRow(line) {
  let replaced = 0;
  const row = brfToUnicodeBraille(line).replace(/[^\u2800-\u28FF]/g, () => { replaced++; return '\u2800'; });
  return { row, replaced };
}

export function requireTranslate(opts, fnName) {
  if (!opts || typeof opts.translate !== 'function') {
    throw new Error(`${fnName}: opts.translate must be the braille translate function used for the preview — the export would otherwise contain print letters, not the previewed braille.`);
  }
}

export function makePefIdentifier() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `urn:uuid:${c.randomUUID()}`;
  return `emboss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Converts a document model into a PEF 1.0 XML document.
 * @param {Object} doc - Document model ({ title, blocks }).
 * @param {Object} opts - The SAME format options used for the preview (translate, mode, width,
 *   depth, paragraphStyle, listStyle, tableFormat, mathToBrf, volumePages, includeCovers) plus
 *   optional duplex ('single' | 'double', default double) and identifier.
 * @returns {string} PEF 1.0 XML.
 */
export function exportToPef(doc, opts = {}) {
  requireTranslate(opts, 'exportToPef');
  const width = Math.max(10, Number(opts.width) || 38);
  const depth = Math.max(10, Number(opts.depth) || 25);
  const title = doc?.title || 'Untitled Document';
  const mode = (opts.mode || 'ukaaf').toUpperCase();
  const duplexOpt = opts.duplex ?? opts.embosserDuplex;
  const duplex = duplexOpt === 'single' ? 'false' : 'true';
  const identifier = opts.identifier || makePefIdentifier();
  const date = new Date().toISOString().slice(0, 10);

  const volumes = formatVolumes(doc, { ...opts, width, depth });
  const body = [];
  let replacedTotal = 0;

  for (const vol of volumes) {
    body.push(`    <volume cols="${width}" rows="${depth}" rowgap="0" duplex="${duplex}">`);
    body.push('      <section>');
    const pages = (vol.brf || '').split('\x0c');
    for (const pageStr of pages) {
      if (!pageStr && pages.length > 1) continue;
      body.push('        <page>');
      const lines = pageStr.split(/\r\n|\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        const { row, replaced } = brfLineToPefRow(line);
        replacedTotal += replaced;
        body.push(`          <row>${row}</row>`);
      }
      body.push('        </page>');
    }
    body.push('      </section>');
    body.push('    </volume>');
  }

  if (replacedTotal) {
    console.warn(`exportToPef: ${replacedTotal} non-braille character(s) in the BRF were replaced with blank cells (U+2800).`);
  }

  const xmlLines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<pef version="1.0" xmlns="http://www.daisy.org/ns/2008/pef">',
    '  <head>',
    '    <meta xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `      <dc:format>application/x-pef+xml</dc:format>`,
    `      <dc:identifier>${escapeXml(identifier)}</dc:identifier>`,
    `      <dc:title>${escapeXml(title)}</dc:title>`,
    `      <dc:date>${date}</dc:date>`,
    `      <dc:description>Formatted braille (${escapeXml(mode)}) created with Emboss</dc:description>`,
    '    </meta>',
    ...(replacedTotal ? [`    <!-- warning: ${replacedTotal} non-braille character(s) replaced with U+2800 -->`] : []),
    '  </head>',
    '  <body>',
    ...body,
    '  </body>',
    '</pef>',
  ];
  return xmlLines.join('\n');
}
