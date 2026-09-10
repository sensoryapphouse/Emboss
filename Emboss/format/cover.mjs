// Tactile Volume Cover, Spine Label & Binder Divider generator.
// Produces embossed title pages, braille spine labels, and physical volume dividers.
// Output is NABCC ASCII BRF only (never Unicode braille), every line <= width.

import { centred } from './document.mjs';
import { wrapCells } from './layout.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

// NABCC cells for the rules: '=' is dots 123456 (full cell), 'C' is dots 14 (thin rule).
const FULL_CELL = '=';
const THIN_CELL = 'C';

const geometry = (opts) => ({
  w: Math.max(10, Number(opts.width) || 38),
  depth: Math.max(10, Number(opts.depth) || 25),
  translate: typeof opts.translate === 'function' ? opts.translate : (t) => t.toUpperCase(),
});

// Translate, force NABCC ASCII, wrap to the width, centre each line, and guarantee <= w.
function centredLines(text, translate, w) {
  const brl = unicodeBrailleToBrf(translate(text)).replace(/[^\x20-\x7E]/g, ' ');
  return wrapCells(brl, w, 0, 0)
    .map((l) => l.trim().slice(0, w))
    .filter((l, i, a) => l || a.length === 1)
    .map((l) => centred(l, w).slice(0, w));
}

// Clamp a page to `depth` lines: content lines are truncated, the final border kept.
function fitPage(lines, depth, footer) {
  const body = lines.slice(0, Math.max(0, depth - footer.length));
  while (body.length < depth - footer.length) body.push('');
  return [...body, ...footer];
}

/**
 * Generates a full tactile embossed cover page.
 * @returns {string[]} BRF lines (exactly `depth` of them, each <= width).
 */
export function generateVolumeCover(doc, volumeNum, totalVolumes, opts = {}) {
  const { w, depth, translate } = geometry(opts);
  const title = (doc?.title || 'UNTITLED DOCUMENT').toUpperCase();
  const border = FULL_CELL.repeat(w);
  const thinBorder = THIN_CELL.repeat(w);

  const lines = [border, ''];
  lines.push(...centredLines(title, translate, w));
  lines.push('', thinBorder, '');
  lines.push(...centredLines(`VOLUME ${volumeNum} OF ${totalVolumes}`, translate, w));
  lines.push('');
  if (opts.author) {
    lines.push(...centredLines(`BY ${opts.author}`, translate, w));
    lines.push('');
  }
  lines.push(...centredLines('PRODUCED BY EMBOSS PWA', translate, w));
  lines.push('', thinBorder, '');
  lines.push(...centredLines(`STANDARD: ${(opts.mode || 'UKAAF').toUpperCase()}`, translate, w));
  lines.push('');

  return fitPage(lines, depth, [border]);
}

/**
 * Generates a short spine label string (NABCC ASCII) for braille label tape or cardstock.
 */
export function generateSpineLabel(title, volumeNum, totalVolumes, opts = {}) {
  const { translate } = geometry(opts);
  const tShort = (title || 'DOC').slice(0, 20).toUpperCase();
  const volStr = `VOL ${volumeNum}/${totalVolumes}`;
  const label = `${translate(tShort)} - ${translate(volStr)}`;
  return unicodeBrailleToBrf(label).replace(/[^\x20-\x7E]/g, ' ');
}

/**
 * Generates a tactile section/binder divider page.
 * @returns {string[]} BRF lines (exactly `depth` of them, each <= width).
 */
export function generateDividerPage(volumeNum, sectionTitle, opts = {}) {
  const { w, depth, translate } = geometry(opts);
  const thickLine = FULL_CELL.repeat(w);

  const lines = [thickLine, thickLine, ''];
  lines.push(...centredLines(`SECTION DIVIDER - VOLUME ${volumeNum}`, translate, w));
  if (sectionTitle) {
    lines.push('');
    lines.push(...centredLines(sectionTitle, translate, w));
  }
  lines.push('');

  return fitPage(lines, depth, [thickLine, thickLine]);
}
