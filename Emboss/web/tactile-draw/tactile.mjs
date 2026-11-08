// Tactile drawing tool (W14): what makes a drawing tactile - the line styles, the area textures and the point symbols (our own designs, on the
// braille dot grid), the checks against BANA's "Guidelines and Standards for Tactile Graphics" (2010 web edition section numbers; see
// constants.mjs for the values), the automatic key, and the braille label.
//
// The textures are SVG patterns whose marks sit on a 2.5 mm dot grid so that each embosses as a different pattern of dots. They are NOT copied from
// BANA's appendix or from any other program (tactile-graphics-editors.md, "Licence cautions").
import { MM, LIMITS } from './constants.mjs';
import { bbox, labelBox, outlines, boxToOutlineDistance, boxContains, boxDistance, polylineLength, polygonArea, polyContains } from './geometry.mjs';
export { MM, LIMITS, labelBox };

// Line styles: stroke width in mm and dash pattern. Dashes 6.35-9.5 mm with gaps about half (3.4.3.3).
export const LINE_STYLES = [
  { id: 'solid', name: 'Solid', width: 1, dash: '' },
  { id: 'thin', name: 'Thin', width: 0.5, dash: '' },
  { id: 'thick', name: 'Thick', width: 2, dash: '' },
  { id: 'dashed', name: 'Dashed', width: 1, dash: '8 4' },
  { id: 'dotted', name: 'Dotted', width: 1, dash: '1 3' },
  { id: 'dash-dot', name: 'Dash and dot', width: 1, dash: '8 3 1 3' },
];
const pat = (id, w, h, inner, extra = '') => `<pattern id="tx-${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${extra}>${inner}</pattern>`;
const ST = 'stroke="#000" stroke-width="0.9" fill="none"';
export const TEXTURES = [
  { id: 'dots', name: 'Dots', pattern: pat('dots', 5, 5, '<circle cx="2.5" cy="2.5" r="0.8" fill="#000"/>') },
  { id: 'close-dots', name: 'Close dots', pattern: pat('close-dots', 2.5, 2.5, '<circle cx="1.25" cy="1.25" r="0.6" fill="#000"/>') },
  { id: 'hatch', name: 'Diagonal lines', pattern: pat('hatch', 5, 5, `<path d="M0 0V5" ${ST}/>`, ' patternTransform="rotate(45)"') },
  { id: 'back-hatch', name: 'Opposite diagonal lines', pattern: pat('back-hatch', 5, 5, `<path d="M0 0V5" ${ST}/>`, ' patternTransform="rotate(-45)"') },
  { id: 'grid', name: 'Grid', pattern: pat('grid', 5, 5, `<path d="M5 0H0V5" ${ST}/>`) },
  { id: 'horizontal', name: 'Horizontal lines', pattern: pat('horizontal', 5, 5, `<path d="M0 2.5H5" ${ST}/>`) },
  { id: 'vertical', name: 'Vertical lines', pattern: pat('vertical', 5, 5, `<path d="M2.5 0V5" ${ST}/>`) },
];
const S = 'stroke="#000" stroke-width="1" fill="none"';
export const SYMBOLS = [
  { id: 'circle', name: 'Filled circle', draw: (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#000" stroke="#000" stroke-width="1"/>` },
  { id: 'ring', name: 'Open circle', draw: (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" ${S}/>` },
  { id: 'square', name: 'Square', draw: (x, y, r) => `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" ${S}/>` },
  { id: 'triangle', name: 'Triangle', draw: (x, y, r) => `<polygon points="${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}" ${S}/>` },
  { id: 'diamond', name: 'Diamond', draw: (x, y, r) => `<polygon points="${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}" ${S}/>` },
  { id: 'cross', name: 'Cross', draw: (x, y, r) => `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}" ${S}/>` },
];
export const lineStyle = (id) => LINE_STYLES.find((l) => l.id === id) || LINE_STYLES[0];
export const textureById = (id) => TEXTURES.find((t) => t.id === id) || null;
export const symbolById = (id) => SYMBOLS.find((s) => s.id === id) || SYMBOLS[0];

const walk = (shapes, fn) => { for (const s of shapes) { if (s.visible === false) continue; fn(s); if (s.kind === 'group') walk(s.children, fn); } };
const OUTLINED = new Set(['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const CLOSED = new Set(['rect', 'ellipse', 'polygon', 'path']);
const isArea = (s) => CLOSED.has(s.kind) && s.texture && s.texture !== 'none';

/** The styles a drawing uses, each once, in the order they first appear. */
export function usedStyles(doc) {
  const textures = [], lines = [], symbols = [];
  const add = (a, v) => { if (v && !a.includes(v)) a.push(v); };
  walk(doc.shapes, (s) => {
    if (OUTLINED.has(s.kind) && s.line && s.line !== 'none') add(lines, s.line);
    if (CLOSED.has(s.kind) && s.texture && s.texture !== 'none') add(textures, s.texture);
    if (s.kind === 'symbol') add(symbols, s.symbol);
  });
  return { textures, lines, symbols };
}

/**
 * Checks against BANA. Each warning: {code, severity:'warning', ids, message, rule}. `rule` names the BANA section (2010 web edition).
 */
export function checkDrawing(doc) {
  const out = [];
  const warn = (code, ids, message, rule) => out.push({ code, severity: 'warning', ids, message, rule: `BANA ${rule}` });
  const u = usedStyles(doc);
  const idsOf = (pred) => { const a = []; walk(doc.shapes, (s) => { if (pred(s)) a.push(s.id); }); return a; };
  if (u.textures.length > LIMITS.textures) warn('too-many-textures', idsOf(isArea), `This graphic uses ${u.textures.length} area textures; use at most ${LIMITS.textures} so they can be told apart by touch.`, '3.2.2');
  if (u.lines.length > LIMITS.lines) warn('too-many-lines', idsOf((s) => OUTLINED.has(s.kind) && s.line && s.line !== 'none'), `This graphic uses ${u.lines.length} line styles; use at most ${LIMITS.lines}.`, '3.2.2');
  if (u.symbols.length > LIMITS.symbols) warn('too-many-symbols', idsOf((s) => s.kind === 'symbol'), `This graphic uses ${u.symbols.length} point symbols; use at most ${LIMITS.symbols}.`, '3.2.2');

  const small = [];
  const short = [];
  const tiny = [];
  walk(doc.shapes, (s) => {
    if (isArea(s)) {
      const b = bbox(s);
      let area = b.width * b.height;
      if (s.kind === 'ellipse') area = Math.PI * s.rx * s.ry;
      else if (s.kind === 'polygon') area = polygonArea(s.points);
      if (area < MM.minArea || Math.min(b.width, b.height) < MM.minAreaSide) small.push(s.id);
    }
    if ((s.kind === 'line' || s.kind === 'polyline') && s.line && s.line !== 'none') {
      const len = polylineLength(outlines(s)[0].pts);
      if (len < MM.minLine) short.push(s.id);
    }
    if (s.kind === 'symbol' && s.size < MM.minSymbol) tiny.push(s.id);
  });
  if (small.length) warn('area-too-small', small, `${small.length === 1 ? 'An area is' : small.length + ' areas are'} smaller than 1/4 inch (6.35 mm) across, too small to feel a texture.`, '3.4.3.1');
  if (short.length) warn('line-too-short', short, `${short.length === 1 ? 'A line is' : short.length + ' lines are'} shorter than 1/2 inch (12.7 mm), too short to follow by touch.`, '3.4.3.2');
  if (tiny.length) warn('symbol-too-small', tiny, `${tiny.length === 1 ? 'A point symbol is' : tiny.length + ' point symbols are'} smaller than 1/4 inch (6.35 mm).`, '3.4.3.11');

  // Labels: at least 3 mm from other components; inside an area they are given a clear halo instead.
  const labels = [], others = [];
  walk(doc.shapes, (s) => { if (s.kind === 'text') labels.push(s); else if (s.kind !== 'group') others.push(s); });
  const close = [];
  for (const l of labels) {
    const lb = labelBox(l);
    let bad = false;
    for (const o of others) {
      if (o.kind === 'symbol') { if (boxDistance(lb, bbox(o)) < MM.labelGap) bad = true; continue; }
      const polys = outlines(o);
      const inside = CLOSED.has(o.kind) && polys.some((p) => p.closed && lb && [{ x: lb.x, y: lb.y }, { x: lb.x + lb.width, y: lb.y + lb.height }].every((c) => polyContains(p.pts, c)));
      if (inside) continue;
      if (polys.some((p) => boxToOutlineDistance(lb, p) < MM.labelGap)) bad = true;
    }
    for (const l2 of labels) if (l2 !== l && boxDistance(lb, labelBox(l2)) < MM.labelGap) bad = true;
    if (bad) close.push(l.id);
  }
  if (close.length) warn('label-too-close', close, `${close.length === 1 ? 'A label is' : close.length + ' labels are'} closer than 1/8 inch (3 mm) to a line, shape or other label; move ${close.length === 1 ? 'it' : 'them'} away or leave a clear space.`, '3.4.3.12');

  const page = { x: 0, y: 0, width: doc.cells * MM.cell, height: doc.lines * MM.line };
  const outside = [];
  walk(doc.shapes, (s) => { if (s.kind !== 'group' && !boxContains({ x: page.x - 0.01, y: page.y - 0.01, width: page.width + 0.02, height: page.height + 0.02 }, bbox(s))) outside.push(s.id); });
  if (outside.length) warn('outside-page', outside, `${outside.length === 1 ? 'Something is' : outside.length + ' things are'} outside the braille page (${doc.cells} cells by ${doc.lines} lines).`, '3.4.2');
  if (doc.cells > MM.maxCells || doc.lines > MM.maxLines) warn('page-too-big', [], `The page is ${doc.cells} cells by ${doc.lines} lines; a tactile graphic is at most ${MM.maxCells} cells by ${MM.maxLines} lines.`, '3.4.2');
  return out;
}

/** The automatic key: area textures, then line styles, then point symbols (5.7.1), each in the order first used, with the meaning typed in doc.legend. */
export function buildKey(doc) {
  const u = usedStyles(doc);
  const legend = doc.legend || {};
  const entry = (type, id, name) => ({ type, id, name, meaning: legend[id] || '' });
  return [
    ...u.textures.map((id) => entry('texture', id, (textureById(id) || { name: id }).name)),
    ...u.lines.map((id) => entry('line', id, lineStyle(id).name)),
    ...u.symbols.map((id) => entry('symbol', id, symbolById(id).name)),
  ];
}

/**
 * A label typed in print, as braille. `translate(print)` is the document's braille translator (liblouis, the document's code); `fallback`
 * is used when it throws or gives nothing. Print is one line: line breaks become spaces.
 */
export function translateLabel(text, translate, fallback) {
  const print = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!print) return { print: '', braille: '', cells: 0 };
  let braille = '';
  try { braille = translate ? String(translate(print) || '') : ''; } catch { braille = ''; }
  if (!braille && fallback) { try { braille = String(fallback(print) || ''); } catch { braille = ''; } }
  braille = braille.replace(/[\r\n]+/g, '');
  return { print, braille, cells: Array.from(braille).length };
}
