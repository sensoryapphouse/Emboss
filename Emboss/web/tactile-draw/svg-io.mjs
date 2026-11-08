// Tactile drawing tool (W14): reading and writing SVG. A port of SVGParser.swift and SVGWriter.swift (Paul's SwiftUI SVG editor), with these changes:
//  - the parser takes a DOM parser (the browser's, or jsdom's in tests) instead of XMLParser, and keeps fill, stroke and dash settings from a parent <g>;
//  - colours are not kept: a fill colour becomes an area texture (the same colour always gets the same texture), a dash array a dashed or dotted line,
//    a thick or thin stroke a thick or thin line - unless the file is our own, which carries data-t-* attributes with the exact styles;
//  - a transform (translate, scale, matrix, rotate) is baked into the shape (a turned rectangle or ellipse becomes a path), where the Swift parser
//    kept only rotate() as a rotation;
//  - paths are kept as absolute segments, not normalised against a bounding box (path.mjs);
//  - what cannot be imported (images, <use>, gradients ...) is reported, never silently dropped;
//  - the writer escapes every value, writes only what it knows (so a script or event handler in an imported file cannot come through), and leaves
//    hidden shapes out, as SVGWriter did.
// Our own files are plain SVG that opens in any editor; the tactile meaning is in data-t-* attributes and url(#tx-...) patterns.
import { MM } from './constants.mjs';
import { parsePathData, pathToD, mapSegs, fmt } from './path.mjs';
import { TactileDoc, makeShape } from './model.mjs';
import { LINE_STYLES, TEXTURES, lineStyle, textureById, symbolById } from './tactile.mjs';
import { labelBox } from './geometry.mjs';

const r3 = (v) => Math.round(v * 1000) / 1000;
const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// ---------------- transforms ----------------
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function parseTransform(str) {
  let m = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let g;
  while ((g = re.exec(str || ''))) {
    const a = g[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (a.some((x) => !Number.isFinite(x))) continue;
    let t = null;
    if (g[1] === 'matrix' && a.length === 6) t = a;
    else if (g[1] === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (g[1] === 'scale') t = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
    else if (g[1] === 'rotate') {
      const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      t = [c, s, -s, c, 0, 0];
      if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (g[1] === 'skewX') t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (g[1] === 'skewY') t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (t) m = mul(m, t);
  }
  return m;
}
const axisAligned = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

// ---------------- reading ----------------
const IGNORED = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'pattern', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'marker', 'symbol', 'namedview', 'script', 'font', 'filter']);
const WHITE = new Set(['#fff', '#ffffff', 'white', 'transparent', 'none', 'rgb(255,255,255)', 'rgb(255, 255, 255)']);

function styleOf(el, inherited) {
  const st = { ...inherited };
  const set = (k, v) => { if (v !== undefined && v !== null && v !== '') st[k] = String(v).trim(); };
  for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray']) set(k, el.getAttribute(k));
  for (const part of String(el.getAttribute('style') || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) { const k = part.slice(0, i).trim().toLowerCase(); if (['fill', 'stroke', 'stroke-width', 'stroke-dasharray'].includes(k)) set(k, part.slice(i + 1)); }
  }
  if (el.getAttribute('display') === 'none') st.hidden = true;
  return st;
}

export function parseSvg(text, { DOMParser: DP = globalThis.DOMParser, cells, lines } = {}) {
  const fail = (error) => ({ doc: null, error, skipped: [], notes: [] });
  let xml;
  try {
    xml = new DP().parseFromString(String(text || ''), 'image/svg+xml');
  } catch (e) { return fail(`This is not a valid SVG file (${String(e.message || e).split('\n')[0]}).`); }
  const root = xml && xml.documentElement;
  if (!root || root.localName === 'parsererror' || (xml.getElementsByTagName && xml.getElementsByTagName('parsererror').length)) return fail('This is not a valid SVG file.');
  if (root.localName.toLowerCase() !== 'svg') return fail('This file is not an SVG drawing.');

  const own = root.getAttribute('data-tactile-draw') === '1';
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let width = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] : num(root.getAttribute('width'), 0);
  let height = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[3] : num(root.getAttribute('height'), 0);
  if (!(width > 0) || !(height > 0)) { width = 38 * MM.cell; height = 25 * MM.line; }
  const doc = new TactileDoc({
    cells: cells ?? (own ? num(root.getAttribute('data-cells'), 38) : Math.max(1, Math.ceil(width / MM.cell - 1e-9))),
    lines: lines ?? (own ? num(root.getAttribute('data-lines'), 25) : Math.max(1, Math.ceil(height / MM.line - 1e-9))),
    width: r3(width), height: r3(height),
  });
  if (own && root.getAttribute('data-legend')) { try { const l = JSON.parse(root.getAttribute('data-legend')); if (l && typeof l === 'object') for (const [k, v] of Object.entries(l)) doc.legend[String(k)] = String(v); } catch { /* ignore a damaged legend */ } }
  const skipped = [], notes = [];
  const colours = new Map();
  const textureFor = (fill) => {
    const f = String(fill ?? '#000').replace(/\s+/g, ' ').toLowerCase();
    if (WHITE.has(f)) return 'none';
    const u = /^url\(\s*['"]?#tx-([a-z-]+)['"]?\s*\)$/.exec(f);
    if (u) return textureById(u[1]) ? u[1] : 'none';
    if (f.startsWith('url(')) return 'none';
    if (!colours.has(f)) colours.set(f, TEXTURES[colours.size % TEXTURES.length].id);
    return colours.get(f);
  };
  const lineFor = (st, defaultStroke) => {
    const stroke = (st.stroke ?? defaultStroke ?? 'none').toLowerCase();
    if (stroke === 'none' || stroke === 'transparent') return 'none';
    const w = num(st['stroke-width'], 1);
    const dash = String(st['stroke-dasharray'] || '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
    if (dash.length && dash.some((n) => n > 0)) return dash[0] <= 2 ? 'dotted' : (dash.length >= 4 ? 'dash-dot' : 'dashed');
    return w >= 1.8 ? 'thick' : (w <= 0.6 ? 'thin' : 'solid');
  };
  const ownStyles = (el, shape, closed) => {
    const l = el.getAttribute('data-t-line');
    if (l && (l === 'none' || LINE_STYLES.some((x) => x.id === l))) shape.line = l;
    const t = el.getAttribute('data-t-texture');
    if (closed && t && (t === 'none' || textureById(t))) shape.texture = t;
  };
  const finish = (el, shape) => {
    const nm = el.getAttribute('data-name') || el.getAttribute('id') || '';
    shape.name = nm.replace(/[\u0000-\u001F]/g, '').slice(0, 80);
    return shape;
  };
  const pts = (str, m) => { const n = String(str || '').split(/[\s,]+/).filter(Boolean).map(Number); const out = []; for (let i = 0; i + 1 < n.length; i += 2) if (Number.isFinite(n[i]) && Number.isFinite(n[i + 1])) { const q = app(m, n[i], n[i + 1]); out.push({ x: r3(q[0]), y: r3(q[1]) }); } return out; };
  const KAPPA = 0.5522847498;
  const ellipsePath = (cx, cy, rx, ry, m) => {
    const P = (x, y) => app(m, x, y);
    const c = [[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]];
    const segs = [{ c: 'M', p: P(cx + rx, cy) }];
    const ctl = [[cx + rx, cy + KAPPA * ry, cx + KAPPA * rx, cy + ry, cx, cy + ry], [cx - KAPPA * rx, cy + ry, cx - rx, cy + KAPPA * ry, cx - rx, cy], [cx - rx, cy - KAPPA * ry, cx - KAPPA * rx, cy - ry, cx, cy - ry], [cx + KAPPA * rx, cy - ry, cx + rx, cy - KAPPA * ry, cx + rx, cy]];
    for (const k of ctl) { const p = []; for (let i = 0; i < 6; i += 2) p.push(...P(k[i], k[i + 1])); segs.push({ c: 'C', p }); }
    segs.push({ c: 'Z', p: [] });
    void c;
    return segs;
  };
  const roundSegs = (segs) => segs.map((g) => ({ c: g.c, p: g.p.map(r3) }));

  const readElement = (el, st0, m0, out) => {
    const name = el.localName.toLowerCase();
    if (IGNORED.has(name)) return;
    const st = styleOf(el, st0);
    const m = el.getAttribute('transform') ? mul(m0, parseTransform(el.getAttribute('transform'))) : m0;
    if (st.hidden) return;
    const kind = el.getAttribute('data-t-kind');
    if (name === 'g' && kind === 'label') {
      const t = el.getElementsByTagName('text')[0];
      const x = num(t && t.getAttribute('x')), y = num(t && t.getAttribute('y')) - MM.labelH;
      const q = app(m, x, y);
      out.push(finish(el, makeShape('text', { x: r3(q[0]), y: r3(q[1]), text: el.getAttribute('data-print') || '', braille: (t && t.textContent) || '' })));
      return;
    }
    if (name === 'g' && kind === 'symbol') {
      const q = app(m, num(el.getAttribute('data-cx')), num(el.getAttribute('data-cy')));
      const sym = symbolById(el.getAttribute('data-symbol'));
      out.push(finish(el, makeShape('symbol', { cx: r3(q[0]), cy: r3(q[1]), size: num(el.getAttribute('data-size'), MM.minSymbol), symbol: sym.id })));
      return;
    }
    if (name === 'g' || name === 'a') {
      const g = finish(el, makeShape('group', { role: el.getAttribute('data-t-role') || '' }));
      for (const c of Array.from(el.children)) readElement(c, st, m, g.children);
      if (g.children.length) out.push(g);
      return;
    }
    let s = null;
    if (name === 'rect') {
      const x = num(el.getAttribute('x')), y = num(el.getAttribute('y')), w = num(el.getAttribute('width')), h = num(el.getAttribute('height'));
      if (axisAligned(m)) {
        const a = app(m, x, y), b = app(m, x + w, y + h);
        s = makeShape('rect', { x: r3(Math.min(a[0], b[0])), y: r3(Math.min(a[1], b[1])), width: r3(Math.abs(b[0] - a[0])), height: r3(Math.abs(b[1] - a[1])), rx: r3(num(el.getAttribute('rx')) * Math.abs(m[0])) });
      } else {
        const segs = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((q, i) => ({ c: i ? 'L' : 'M', p: app(m, q[0], q[1]) }));
        s = makeShape('path', { segs: roundSegs([...segs, { c: 'Z', p: [] }]) });
      }
      s.texture = textureFor(st.fill); s.line = lineFor(st); ownStyles(el, s, true);
    } else if (name === 'circle' || name === 'ellipse') {
      const cx = num(el.getAttribute('cx')), cy = num(el.getAttribute('cy'));
      const rx = name === 'circle' ? num(el.getAttribute('r')) : num(el.getAttribute('rx')), ry = name === 'circle' ? rx : num(el.getAttribute('ry'));
      if (axisAligned(m)) {
        const c = app(m, cx, cy);
        s = makeShape('ellipse', { cx: r3(c[0]), cy: r3(c[1]), rx: r3(rx * Math.abs(m[0])), ry: r3(ry * Math.abs(m[3])) });
      } else s = makeShape('path', { segs: roundSegs(ellipsePath(cx, cy, rx, ry, m)) });
      s.texture = textureFor(st.fill); s.line = lineFor(st); ownStyles(el, s, true);
    } else if (name === 'line') {
      const a = app(m, num(el.getAttribute('x1')), num(el.getAttribute('y1'))), b = app(m, num(el.getAttribute('x2')), num(el.getAttribute('y2')));
      s = makeShape('line', { x1: r3(a[0]), y1: r3(a[1]), x2: r3(b[0]), y2: r3(b[1]) });
      s.line = lineFor(st, '#000'); ownStyles(el, s, false);   // a line with no stroke set is drawn black (as SVGParser did), not left invisible
    } else if (name === 'polyline' || name === 'polygon') {
      const points = pts(el.getAttribute('points'), m);
      if (points.length < 2) { skipped.push(`A ${name} with fewer than two points was left out.`); return; }
      s = makeShape(name, { points });
      s.line = lineFor(st, name === 'polyline' ? '#000' : undefined);
      if (name === 'polygon') s.texture = textureFor(st.fill);
      ownStyles(el, s, name === 'polygon');
    } else if (name === 'path') {
      const segs = roundSegs(mapSegs(parsePathData(el.getAttribute('d')), (x, y) => app(m, x, y)));
      if (!segs.length) { skipped.push('A path with no usable data was left out.'); return; }
      s = makeShape('path', { segs });
      const closed = segs.some((g) => g.c === 'Z');
      s.line = lineFor(st, closed ? undefined : '#000');
      s.texture = textureFor(st.fill === undefined && !closed ? 'none' : st.fill);
      ownStyles(el, s, true);
    } else if (name === 'text') {
      const q = app(m, num(el.getAttribute('x')), num(el.getAttribute('y')));
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const isBraille = raw && /^[⠀-⣿ ]+$/.test(raw);
      s = makeShape('text', { x: r3(q[0]), y: r3(q[1] - MM.labelH), text: isBraille ? '' : raw, braille: isBraille ? raw : '' });
    } else {
      skipped.push(`<${name}> was not imported.`);
      return;
    }
    out.push(finish(el, s));
  };
  const rootStyle = styleOf(root, {});
  const found = [];
  for (const c of Array.from(root.children)) readElement(c, rootStyle, IDENT, found);
  for (const s of found) doc.attach(s);
  if (colours.size > TEXTURES.length) notes.push('The file uses more fill colours than there are textures; some share a texture.');
  return { doc, skipped: [...new Set(skipped)], notes, own };
}

// ---------------- writing ----------------
const strokeAttrs = (s) => {
  if (!s.line || s.line === 'none') return ' stroke="none"';
  const l = lineStyle(s.line);
  return ` stroke="#000" stroke-width="${fmt(l.width)}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"`;
};
const fillAttr = (s) => ` fill="${s.texture && s.texture !== 'none' && textureById(s.texture) ? `url(#tx-${s.texture})` : 'none'}"`;
const meta = (s, closed) => ` data-t-line="${esc(s.line || 'none')}"${closed ? ` data-t-texture="${esc(s.texture || 'none')}"` : ''}${s.name ? ` data-name="${esc(s.name)}"` : ''}`;
const ptsStr = (p) => p.map((q) => `${fmt(q.x)},${fmt(q.y)}`).join(' ');

function writeShape(s, ind, o = {}) {
  if (s.visible === false) return '';
  switch (s.kind) {
    case 'rect': return `${ind}<rect x="${fmt(s.x)}" y="${fmt(s.y)}" width="${fmt(s.width)}" height="${fmt(s.height)}"${s.rx > 0 ? ` rx="${fmt(s.rx)}"` : ''}${fillAttr(s)}${strokeAttrs(s)}${meta(s, true)}/>\n`;
    case 'ellipse': return Math.abs(s.rx - s.ry) < 1e-9
      ? `${ind}<circle cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" r="${fmt(s.rx)}"${fillAttr(s)}${strokeAttrs(s)}${meta(s, true)}/>\n`
      : `${ind}<ellipse cx="${fmt(s.cx)}" cy="${fmt(s.cy)}" rx="${fmt(s.rx)}" ry="${fmt(s.ry)}"${fillAttr(s)}${strokeAttrs(s)}${meta(s, true)}/>\n`;
    case 'line': return `${ind}<line x1="${fmt(s.x1)}" y1="${fmt(s.y1)}" x2="${fmt(s.x2)}" y2="${fmt(s.y2)}" fill="none"${strokeAttrs(s)}${meta(s, false)}/>\n`;
    case 'polyline': return `${ind}<polyline points="${ptsStr(s.points)}" fill="none"${strokeAttrs(s)}${meta(s, false)}/>\n`;
    case 'polygon': return `${ind}<polygon points="${ptsStr(s.points)}"${fillAttr(s)}${strokeAttrs(s)}${meta(s, true)}/>\n`;
    case 'path': return `${ind}<path d="${pathToD(s.segs)}"${fillAttr(s)}${strokeAttrs(s)}${meta(s, true)}/>\n`;
    case 'text': {
      const b = labelBox(s);
      const n = Math.max(1, Array.from(s.braille || '').length);
      const pad = MM.haloGap;
      return `${ind}<g data-t-kind="label" data-print="${esc(s.text)}"${s.name ? ` data-name="${esc(s.name)}"` : ''}>\n`
        + `${ind}  <rect class="halo" x="${fmt(b.x - pad)}" y="${fmt(b.y - pad)}" width="${fmt(b.width + 2 * pad)}" height="${fmt(b.height + 2 * pad)}" fill="#fff" stroke="none"/>\n`
        + (o.noLabelText ? '' : `${ind}  <text x="${fmt(b.x)}" y="${fmt(b.y + MM.labelH)}" font-size="${fmt(MM.labelH * 1.6)}" textLength="${fmt(n * MM.cell)}" lengthAdjust="spacingAndGlyphs" fill="#000">${esc(s.braille)}</text>\n`) + `${ind}</g>\n`;
    }
    case 'symbol': {
      const sym = symbolById(s.symbol);
      return `${ind}<g data-t-kind="symbol" data-symbol="${esc(sym.id)}" data-size="${fmt(s.size)}" data-cx="${fmt(s.cx)}" data-cy="${fmt(s.cy)}"${s.name ? ` data-name="${esc(s.name)}"` : ''}>\n${ind}  ${sym.draw(fmt(s.cx), fmt(s.cy), fmt(s.size / 2))}\n${ind}</g>\n`;
    }
    case 'group': {
      const kids = s.children.map((c) => writeShape(c, ind + '  ', o)).join('');
      if (!kids) return '';
      return `${ind}<g${s.name ? ` data-name="${esc(s.name)}"` : ''}${s.role ? ` data-t-role="${esc(s.role)}"` : ''}>\n${kids}${ind}</g>\n`;
    }
    default: return '';
  }
}

function usedTextureIds(shapes, acc = new Set()) {
  for (const s of shapes) {
    if (s.visible === false) continue;
    if (s.kind === 'group') usedTextureIds(s.children, acc);
    else if (s.texture && s.texture !== 'none' && textureById(s.texture)) acc.add(s.texture);
  }
  return acc;
}

/** The drawing as an SVG document string. User units are millimetres on the embossed page. */
export function writeSvg(doc, { title, noLabelText = false } = {}) {
  const used = usedTextureIds(doc.shapes);
  const defs = TEXTURES.filter((t) => used.has(t.id)).map((t) => `    ${t.pattern}\n`).join('');
  const legend = Object.keys(doc.legend || {}).length ? ` data-legend="${esc(JSON.stringify(doc.legend))}"` : '';
  const w = fmt(doc.width), h = fmt(doc.height);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-tactile-draw="1" data-units="mm" data-cells="${doc.cells}" data-lines="${doc.lines}"${legend}>\n`;
  if (title) out += `  <title>${esc(title)}</title>\n`;
  if (defs) out += `  <defs>\n${defs}  </defs>\n`;
  out += doc.shapes.map((s) => writeShape(s, '  ', { noLabelText })).join('');
  return out + '</svg>\n';
}
