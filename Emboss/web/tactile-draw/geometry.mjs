// Tactile drawing tool (W14): geometry of the shapes - bounding boxes, moving, scaling, outlines, distances. (SVGElement.swift boundingRect,
// containsPoint, and CanvasView.swift applyResize, redone so every kind moves and scales the same way.)
import { MM } from './constants.mjs';
import { pathBounds, flattenPath, mapSegs } from './path.mjs';

export const snapValue = (v, step) => (step > 0 ? Math.round(v / step) * step + 0 : v);

/** The box a one-line braille label takes: one cell wide per braille character. */
export function labelBox(s) {
  const n = Math.max(1, Array.from(s.braille || '').length);
  return { x: s.x, y: s.y, width: n * MM.cell, height: MM.labelH };
}

const union = (boxes) => {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
const ptsBox = (pts) => union(pts.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
export const unionBoxes = union;

export function bbox(s) {
  switch (s.kind) {
    case 'rect': return { x: s.x, y: s.y, width: s.width, height: s.height };
    case 'ellipse': return { x: s.cx - s.rx, y: s.cy - s.ry, width: s.rx * 2, height: s.ry * 2 };
    case 'line': return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), width: Math.abs(s.x2 - s.x1), height: Math.abs(s.y2 - s.y1) };
    case 'polyline': case 'polygon': return ptsBox(s.points);
    case 'path': return pathBounds(s.segs);
    case 'text': return labelBox(s);
    case 'symbol': return { x: s.cx - s.size / 2, y: s.cy - s.size / 2, width: s.size, height: s.size };
    case 'group': return union(s.children.filter((c) => c.visible !== false).map(bbox));
    default: return { x: 0, y: 0, width: 0, height: 0 };
  }
}

export function translateShape(s, dx, dy) {
  switch (s.kind) {
    case 'rect': case 'text': s.x += dx; s.y += dy; break;
    case 'ellipse': case 'symbol': s.cx += dx; s.cy += dy; break;
    case 'line': s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; break;
    case 'polyline': case 'polygon': for (const p of s.points) { p.x += dx; p.y += dy; } break;
    case 'path': s.segs = mapSegs(s.segs, (x, y) => [x + dx, y + dy]); break;
    case 'group': for (const c of s.children) translateShape(c, dx, dy); break;
  }
  return s;
}

/** Map the shape from box `from` into box `to` (resizing). A label only moves: its size is its braille. */
export function scaleShape(s, from, to) {
  const sx = from.width > 1e-9 ? to.width / from.width : 1;
  const sy = from.height > 1e-9 ? to.height / from.height : 1;
  const mx = (x) => (from.width > 1e-9 ? (x - from.x) * sx + to.x : x - from.x + to.x);
  const my = (y) => (from.height > 1e-9 ? (y - from.y) * sy + to.y : y - from.y + to.y);
  switch (s.kind) {
    case 'rect': { const x = mx(s.x), y = my(s.y); s.width = s.width * sx; s.height = s.height * sy; s.x = x; s.y = y; break; }
    case 'ellipse': { const cx = mx(s.cx), cy = my(s.cy); s.rx = s.rx * sx; s.ry = s.ry * sy; s.cx = cx; s.cy = cy; break; }
    case 'line': { const a = [mx(s.x1), my(s.y1), mx(s.x2), my(s.y2)]; [s.x1, s.y1, s.x2, s.y2] = a; break; }
    case 'polyline': case 'polygon': for (const p of s.points) { const x = mx(p.x), y = my(p.y); p.x = x; p.y = y; } break;
    case 'path': s.segs = mapSegs(s.segs, (x, y) => [mx(x), my(y)]); break;
    case 'text': { const b = bbox(s); s.x = mx(b.x); s.y = my(b.y); break; }
    case 'symbol': { const cx = mx(s.cx), cy = my(s.cy); s.size = Math.max(0.1, s.size * Math.min(Math.abs(sx), Math.abs(sy))); s.cx = cx; s.cy = cy; break; }
    case 'group': for (const c of s.children) scaleShape(c, from, to); break;
  }
  return s;
}

/** Shapes as point lists: [{pts, closed}]. Used for hit tests and label spacing. */
export function outlines(s) {
  switch (s.kind) {
    case 'rect': return [{ pts: [{ x: s.x, y: s.y }, { x: s.x + s.width, y: s.y }, { x: s.x + s.width, y: s.y + s.height }, { x: s.x, y: s.y + s.height }], closed: true }];
    case 'ellipse': {
      const pts = [];
      for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push({ x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) }); }
      return [{ pts, closed: true }];
    }
    case 'line': return [{ pts: [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], closed: false }];
    case 'polyline': return [{ pts: s.points, closed: false }];
    case 'polygon': return [{ pts: s.points, closed: true }];
    case 'path': return flattenPath(s.segs, 12).map((pts) => ({ pts, closed: pts.length > 2 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-6 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 1e-6 }));
    case 'group': return s.children.flatMap(outlines);
    default: return [];
  }
}

export function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
export function polyContains(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const inBox = (b, p, tol) => p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;

export function shapeHit(s, p, tol) {
  if (s.kind === 'text' || s.kind === 'symbol') return inBox(bbox(s), p, tol);
  if (s.kind === 'group') return s.children.some((c) => c.visible !== false && shapeHit(c, p, tol));
  for (const o of outlines(s)) {
    if (o.closed && polyContains(o.pts, p)) return true;
    const n = o.pts.length;
    for (let i = 0; i < n - 1 + (o.closed ? 1 : 0); i++) if (segDist(p, o.pts[i], o.pts[(i + 1) % n]) <= tol) return true;
  }
  return false;
}

/** Shortest distance between a rectangle and an outline (0 when they touch or cross). */
export function boxToOutlineDistance(box, o) {
  const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }];
  const pts = o.pts, n = pts.length;
  let best = Infinity;
  const segs = [];
  for (let i = 0; i < n - 1 + (o.closed ? 1 : 0); i++) segs.push([pts[i], pts[(i + 1) % n]]);
  if (n === 1) segs.push([pts[0], pts[0]]);
  for (const [a, b] of segs) {
    if (inBox(box, a, 0) || inBox(box, b, 0)) return 0;
    for (let k = 0; k < 4; k++) {
      const c = corners[k], d = corners[(k + 1) % 4];
      if (segIntersect(a, b, c, d)) return 0;
      best = Math.min(best, segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
    }
  }
  return best;
}
function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
export function boxDistance(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}
export const boxContains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
export function polylineLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return l; }
export function polygonArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y); return Math.abs(a / 2); }
