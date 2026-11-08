// Tactile drawing tool (W14): SVG path data. A port of SVGPathParser.swift (Paul's SwiftUI SVG editor), kept in the same shape: a tokeniser
// that treats a minus sign or a second decimal point as the start of a new number, implicit repeats ("M 10 20 30 40" is a move then a line),
// relative and absolute forms of every command, reflected control points for S and T, and arcs.
// Differences from the Swift original (deliberate):
//  - the result is a list of absolute segments (M L C Q Z) instead of a SwiftUI Path, so a path can be moved, scaled and written back;
//  - arcs become cubic curves (the original used straight pieces), so the shape stays smooth when scaled;
//  - numbers with an exponent ("1e-3") parse; the Swift tokeniser could not;
//  - S and T reflect the previous control point only after a C/S (or Q/T), as the SVG specification says, and use the current point otherwise;
//  - after a Z the next drawing command starts at the subpath's start point (an M is inserted), as the specification says.

const NUM = /^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/;
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Parse path data into absolute segments: {c:'M'|'L'|'C'|'Q'|'Z', p:[numbers]}. Bad data is skipped, never thrown. */
export function parsePathData(d) {
  const s = String(d || '');
  let i = 0;
  const segs = [];
  const skipSep = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  const num = () => {
    skipSep();
    const m = NUM.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const flag = () => {   // arc flags may be written without separators ("a1 1 0 015 5")
    skipSep();
    if (s[i] === '0' || s[i] === '1') return Number(s[i++]);
    return null;
  };
  let cx = 0, cy = 0, sx = 0, sy = 0;   // current point, subpath start
  let lastCurve = null;                // {type:'C'|'Q', x, y}: the last control point, for S and T
  let cmd = null, afterZ = false;
  const lineTo = (x, y) => { if (afterZ) { segs.push({ c: 'M', p: [sx, sy] }); afterZ = false; } segs.push({ c: 'L', p: [x, y] }); cx = x; cy = y; lastCurve = null; };
  for (;;) {
    skipSep();
    if (i >= s.length) break;
    const ch = s[i];
    if (/[A-Za-z]/.test(ch)) {
      if (!ARGS.hasOwnProperty(ch.toUpperCase())) { i++; cmd = null; continue; }   // an unknown letter: skip it and its numbers
      cmd = ch; i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (segs.length && segs[segs.length - 1].c !== 'Z') segs.push({ c: 'Z', p: [] });
        cx = sx; cy = sy; afterZ = true; lastCurve = null; cmd = null;
        continue;
      }
    } else if (cmd === null) { i++; continue; }       // numbers with no command: ignored
    const up = cmd.toUpperCase(), rel = cmd !== up;
    const n = ARGS[up];
    const a = [];
    for (let k = 0; k < n; k++) {
      const v = up === 'A' && (k === 3 || k === 4) ? flag() : num();
      if (v === null) break;
      a.push(v);
    }
    if (a.length < n) { cmd = null; if (a.length === 0 && i < s.length && !/[A-Za-z]/.test(s[i])) i++; continue; }   // not enough numbers: drop this group
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (up === 'M') {
      const x = a[0] + ox, y = a[1] + oy;
      segs.push({ c: 'M', p: [x, y] });
      cx = sx = x; cy = sy = y; afterZ = false; lastCurve = null;
      cmd = rel ? 'l' : 'L';                         // the pairs after the first are implicit line-tos
    } else if (up === 'L') lineTo(a[0] + ox, a[1] + oy);
    else if (up === 'H') lineTo(a[0] + ox, cy);
    else if (up === 'V') lineTo(cx, a[0] + oy);
    else if (up === 'C' || up === 'S' || up === 'Q' || up === 'T') {
      if (afterZ) { segs.push({ c: 'M', p: [sx, sy] }); afterZ = false; }
      if (up === 'C') {
        const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
        segs.push({ c: 'C', p }); lastCurve = { type: 'C', x: p[2], y: p[3] }; cx = p[4]; cy = p[5];
      } else if (up === 'S') {
        const c1 = lastCurve && lastCurve.type === 'C' ? [2 * cx - lastCurve.x, 2 * cy - lastCurve.y] : [cx, cy];
        const p = [c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        segs.push({ c: 'C', p }); lastCurve = { type: 'C', x: p[2], y: p[3] }; cx = p[4]; cy = p[5];
      } else if (up === 'Q') {
        const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        segs.push({ c: 'Q', p }); lastCurve = { type: 'Q', x: p[0], y: p[1] }; cx = p[2]; cy = p[3];
      } else {
        const c1 = lastCurve && lastCurve.type === 'Q' ? [2 * cx - lastCurve.x, 2 * cy - lastCurve.y] : [cx, cy];
        const p = [c1[0], c1[1], a[0] + ox, a[1] + oy];
        segs.push({ c: 'Q', p }); lastCurve = { type: 'Q', x: c1[0], y: c1[1] }; cx = p[2]; cy = p[3];
      }
    } else if (up === 'A') {
      const x = a[5] + ox, y = a[6] + oy;
      if (afterZ) { segs.push({ c: 'M', p: [sx, sy] }); afterZ = false; }
      for (const p of arcToCubics(cx, cy, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, x, y)) segs.push({ c: p.length === 2 ? 'L' : 'C', p });
      cx = x; cy = y; lastCurve = null;
    }
  }
  return segs.filter((g, k) => !(g.c === 'M' && segs[k + 1] && segs[k + 1].c === 'M'));   // a move straight followed by a move draws nothing
}

/** An SVG elliptical arc (endpoint form) as cubic curves (each at most 90 degrees). Returns arrays of [x1,y1,x2,y2,x,y], or [x,y] for a line. */
export function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / (den || 1e-12)));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const ccx = cosP * cxp - sinP * cyp + (x1 + x2) / 2, ccy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
  const step = dth / n, t = (4 / 3) * Math.tan(step / 4);
  const out = [];
  const pt = (a) => [cosP * rx * Math.cos(a) - sinP * ry * Math.sin(a) + ccx, sinP * rx * Math.cos(a) + cosP * ry * Math.sin(a) + ccy];
  const dpt = (a) => [-cosP * rx * Math.sin(a) - sinP * ry * Math.cos(a), -sinP * rx * Math.sin(a) + cosP * ry * Math.cos(a)];
  for (let k = 0; k < n; k++) {
    const a1 = th1 + k * step, a2 = a1 + step;
    const p1 = pt(a1), p2 = k === n - 1 ? [x2, y2] : pt(a2), d1 = dpt(a1), d2 = dpt(a2);
    out.push([p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], p2[0], p2[1]]);
  }
  return out;
}

/** Absolute path data from segments (what parsePathData reads back to the same segments). */
export function pathToD(segs) {
  return segs.map((g) => (g.c === 'Z' ? 'Z' : `${g.c} ${g.p.map(fmt).join(' ')}`)).join(' ');
}

/** Sub-paths as lists of points; curves are sampled `n` times each. Z closes by repeating the first point. */
export function flattenPath(segs, n = 12) {
  const subs = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0;
  for (const g of segs) {
    if (g.c === 'M') { cur = [{ x: g.p[0], y: g.p[1] }]; subs.push(cur); cx = sx = g.p[0]; cy = sy = g.p[1]; }
    else if (g.c === 'L') { if (!cur) { cur = [{ x: cx, y: cy }]; subs.push(cur); } cur.push({ x: g.p[0], y: g.p[1] }); cx = g.p[0]; cy = g.p[1]; }
    else if (g.c === 'C' || g.c === 'Q') {
      if (!cur) { cur = [{ x: cx, y: cy }]; subs.push(cur); }
      const x0 = cx, y0 = cy;
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        if (g.c === 'C') cur.push({ x: u * u * u * x0 + 3 * u * u * t * g.p[0] + 3 * u * t * t * g.p[2] + t * t * t * g.p[4], y: u * u * u * y0 + 3 * u * u * t * g.p[1] + 3 * u * t * t * g.p[3] + t * t * t * g.p[5] });
        else cur.push({ x: u * u * x0 + 2 * u * t * g.p[0] + t * t * g.p[2], y: u * u * y0 + 2 * u * t * g.p[1] + t * t * g.p[3] });
      }
      cx = g.p[g.p.length - 2]; cy = g.p[g.p.length - 1];
    } else if (g.c === 'Z' && cur) { cur.push({ x: sx, y: sy }); cx = sx; cy = sy; cur = null; }
  }
  return subs;
}

export function pathBounds(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sub of flattenPath(segs, 16)) for (const p of sub) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (x0 === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Apply fn(x, y) -> [x', y'] to every point (control points too). Returns new segments. */
export function mapSegs(segs, fn) {
  return segs.map((g) => {
    const p = [];
    for (let k = 0; k < g.p.length; k += 2) { const q = fn(g.p[k], g.p[k + 1]); p.push(q[0], q[1]); }
    return { c: g.c, p };
  });
}
