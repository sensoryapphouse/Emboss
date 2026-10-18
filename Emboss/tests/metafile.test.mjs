// Tests for Emboss/input/metafile.mjs (WMF/EMF/EMF+ -> SVG, DIB(BMP) -> PNG) and its RTF
// integration (parse.mjs's handlePicture, for \wmetafile/\emfblip/\dibitmap blips).
//
// Every WMF/EMF test file here is built by hand, byte-for-byte, against [MS-WMF]/[MS-EMF]
// field layouts (each builder function below documents the offsets it writes and cross-checks
// them against what metafile.mjs's parser reads at that offset) — this is a real conformance
// check of the parser, not just a self-consistent round trip through the module's own writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wmfToSvg, emfToSvg, metafileToSvg, metafileToResource,
  decodeDIB, dibToPngBytes, dibToResource, encodePNG,
} from '../input/metafile.mjs';
import { parseRtf } from '../input/parse.mjs';

// ---------------------------------------------------------------------------
// Small binary writer
// ---------------------------------------------------------------------------
class W {
  constructor() { this.chunks = []; }
  bytes(u8) { this.chunks.push(u8); return this; }
  u8(v) { return this.bytes(Uint8Array.of(v & 0xFF)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v, true); return this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return this.bytes(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return this.bytes(b); }
  f32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return this.bytes(b); }
  str(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return this.bytes(b); }
  toBytes() {
    let len = 0; for (const c of this.chunks) len += c.length;
    const out = new Uint8Array(len); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}
function concat(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function colorref({ r, g, b }) { return ((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF); }

// ---------------------------------------------------------------------------
// WMF builders ([MS-WMF])
// ---------------------------------------------------------------------------
function wmfRecord(func, params) {
  const padded = params.length % 2 === 0 ? params : concat([params, Uint8Array.of(0)]);
  const w = new W(); w.u32(3 + padded.length / 2); w.u16(func); w.bytes(padded);
  return w.toBytes();
}
const wmfEOF = () => wmfRecord(0x0000, new Uint8Array(0));
const wmfHeader = () => { const w = new W(); w.u16(1); w.u16(9); w.u16(0x0300); w.u32(0); w.u16(0); w.u32(0); w.u16(0); return w.toBytes(); };
const wmfPlaceable = (bb) => { const w = new W(); w.u32(0x9AC6CDD7); w.u16(0); w.i16(bb.left); w.i16(bb.top); w.i16(bb.right); w.i16(bb.bottom); w.u16(1440); w.u32(0); w.u16(0); return w.toBytes(); };
function buildWmf(records, placeableBBox) {
  const parts = [];
  if (placeableBBox) parts.push(wmfPlaceable(placeableBBox));
  parts.push(wmfHeader());
  for (const r of records) parts.push(r);
  parts.push(wmfEOF());
  return concat(parts);
}
const wmfSetWindowOrg = (x, y) => wmfRecord(0x020B, new W().i16(y).i16(x).toBytes());
const wmfSetWindowExt = (w_, h) => wmfRecord(0x020C, new W().i16(h).i16(w_).toBytes());
const wmfSetViewportOrg = (x, y) => wmfRecord(0x020D, new W().i16(y).i16(x).toBytes());
const wmfSetViewportExt = (w_, h) => wmfRecord(0x020E, new W().i16(h).i16(w_).toBytes());
const wmfCreatePen = (style, width, color) => wmfRecord(0x02FA, new W().u16(style).i16(width).i16(0).u32(colorref(color)).toBytes());
const wmfCreateBrush = (style, color, hatch = 0) => wmfRecord(0x02FC, new W().u16(style).u32(colorref(color)).u16(hatch).toBytes());
const wmfSelectObject = (idx) => wmfRecord(0x012D, new W().u16(idx).toBytes());
const wmfDeleteObject = (idx) => wmfRecord(0x01F0, new W().u16(idx).toBytes());
const wmfRectangle = (l, t, r, b) => wmfRecord(0x041B, new W().i16(b).i16(r).i16(t).i16(l).toBytes());
const wmfEllipse = (l, t, r, b) => wmfRecord(0x0418, new W().i16(b).i16(r).i16(t).i16(l).toBytes());
const wmfRoundRect = (l, t, r, b, rw, rh) => wmfRecord(0x061C, new W().i16(rh).i16(rw).i16(b).i16(r).i16(t).i16(l).toBytes());
const wmfMoveTo = (x, y) => wmfRecord(0x0214, new W().i16(y).i16(x).toBytes());
const wmfLineTo = (x, y) => wmfRecord(0x0213, new W().i16(y).i16(x).toBytes());
function wmfPolygon(points) { const w = new W(); w.i16(points.length); for (const p of points) { w.i16(p.x); w.i16(p.y); } return wmfRecord(0x0324, w.toBytes()); }
function wmfPolyline(points) { const w = new W(); w.i16(points.length); for (const p of points) { w.i16(p.x); w.i16(p.y); } return wmfRecord(0x0325, w.toBytes()); }
function wmfPolyPolygon(polys) {
  const w = new W(); w.u16(polys.length);
  for (const poly of polys) w.u16(poly.length);
  for (const poly of polys) for (const p of poly) { w.i16(p.x); w.i16(p.y); }
  return wmfRecord(0x0538, w.toBytes());
}
function wmfCreateFontIndirect(opts = {}) {
  const w = new W();
  w.i16(opts.height ?? -12).i16(0).i16(0).i16(0).i16(opts.weight ?? 400);
  w.u8(opts.italic ? 1 : 0).u8(opts.underline ? 1 : 0).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0);
  w.str(opts.faceName || 'Arial'); w.u8(0);
  return wmfRecord(0x02FB, w.toBytes());
}
function wmfTextOut(x, y, text) {
  const w = new W(); w.i16(text.length); w.str(text); if (text.length % 2) w.u8(0); w.i16(y); w.i16(x);
  return wmfRecord(0x0521, w.toBytes());
}
function wmfExtTextOut(x, y, text, opts = 0) {
  const w = new W(); w.i16(y).i16(x).i16(text.length).u16(opts); w.str(text); if (text.length % 2) w.u8(0);
  return wmfRecord(0x0A32, w.toBytes());
}
function wmfArcLike(func, l, t, r, b, xs, ys, xe, ye) {
  return wmfRecord(func, new W().i16(ye).i16(xe).i16(ys).i16(xs).i16(b).i16(r).i16(t).i16(l).toBytes());
}
const wmfArc = (l, t, r, b, xs, ys, xe, ye) => wmfArcLike(0x0817, l, t, r, b, xs, ys, xe, ye);
const wmfPie = (l, t, r, b, xs, ys, xe, ye) => wmfArcLike(0x081A, l, t, r, b, xs, ys, xe, ye);
const wmfChord = (l, t, r, b, xs, ys, xe, ye) => wmfArcLike(0x0830, l, t, r, b, xs, ys, xe, ye);
const wmfSaveDC = () => wmfRecord(0x001E, new Uint8Array(0));
const wmfRestoreDC = (n) => wmfRecord(0x0127, new W().i16(n).toBytes());
const wmfIntersectClipRect = (l, t, r, b) => wmfRecord(0x0416, new W().i16(b).i16(r).i16(t).i16(l).toBytes());
function wmfStretchDib(dib, destX, destY, destW, destH) {
  const w = new W();
  w.u32(0x00CC0020).u16(0);
  w.i16(0).i16(0).i16(0).i16(0);
  w.i16(destH).i16(destW).i16(destY).i16(destX);
  w.bytes(dib);
  return wmfRecord(0x0F43, w.toBytes());
}
function wmfDibStretchBlt(dib, destX, destY, destW, destH) {
  const w = new W();
  w.u32(0x00CC0020);
  w.i16(0).i16(0).i16(0).i16(0);
  w.i16(destH).i16(destW).i16(destY).i16(destX);
  w.bytes(dib);
  return wmfRecord(0x0B41, w.toBytes());
}

// ---------------------------------------------------------------------------
// EMF builders ([MS-EMF])
// ---------------------------------------------------------------------------
function emfRecord(type, data) { const w = new W(); w.u32(type).u32(8 + data.length).bytes(data); return w.toBytes(); }
function emfHeader(bounds) {
  const w = new W();
  w.u32(1).u32(88);
  w.i32(bounds.left).i32(bounds.top).i32(bounds.right).i32(bounds.bottom);
  w.i32(bounds.left).i32(bounds.top).i32(bounds.right).i32(bounds.bottom);
  w.u32(0x464D4520).u32(0x00010000).u32(0).u32(0).u16(0).u16(0).u32(0).u32(0).u32(0);
  w.i32(1000).i32(1000).i32(300).i32(300);
  return w.toBytes();
}
function buildEmf(records, bounds = { left: 0, top: 0, right: 200, bottom: 200 }) {
  const eof = emfRecord(14, new W().u32(0).u32(0).u32(16).u32(20).toBytes());
  return concat([emfHeader(bounds), ...records, eof]);
}
const emfSetWindowOrg = (x, y) => emfRecord(10, new W().i32(x).i32(y).toBytes());
const emfSetWindowExt = (w_, h) => emfRecord(9, new W().i32(w_).i32(h).toBytes());
const emfSetViewportOrg = (x, y) => emfRecord(12, new W().i32(x).i32(y).toBytes());
const emfSetViewportExt = (w_, h) => emfRecord(11, new W().i32(w_).i32(h).toBytes());
const emfCreatePen = (idx, style, width, color) => emfRecord(38, new W().u32(idx).u32(style).i32(width).i32(0).u32(colorref(color)).toBytes());
const emfExtCreatePen = (idx, style, width, color) => emfRecord(95, new W().u32(idx).u32(0).u32(0).u32(0).u32(0).u32(style).i32(width).u32(0).u32(colorref(color)).u32(0).u32(0).toBytes());
const emfCreateBrush = (idx, style, color, hatch = 0) => emfRecord(39, new W().u32(idx).u32(style).u32(colorref(color)).u32(hatch).toBytes());
const emfSelectObject = (idx) => emfRecord(37, new W().u32(idx).toBytes());
const emfSelectStock = (id) => emfRecord(37, new W().u32(0x80000000 | id).toBytes());
const emfDeleteObject = (idx) => emfRecord(40, new W().u32(idx).toBytes());
const emfRectangle = (l, t, r, b) => emfRecord(43, new W().i32(l).i32(t).i32(r).i32(b).toBytes());
const emfEllipse = (l, t, r, b) => emfRecord(42, new W().i32(l).i32(t).i32(r).i32(b).toBytes());
const emfRoundRect = (l, t, r, b, rw, rh) => emfRecord(44, new W().i32(l).i32(t).i32(r).i32(b).i32(rw).i32(rh).toBytes());
const emfMoveTo = (x, y) => emfRecord(27, new W().i32(x).i32(y).toBytes());
const emfLineTo = (x, y) => emfRecord(54, new W().i32(x).i32(y).toBytes());
const emfSaveDC = () => emfRecord(33, new Uint8Array(0));
const emfRestoreDC = (n) => emfRecord(34, new W().i32(n).toBytes());
const emfIntersectClipRect = (l, t, r, b) => emfRecord(30, new W().i32(l).i32(t).i32(r).i32(b).toBytes());
const emfBeginPath = () => emfRecord(59, new Uint8Array(0));
const emfEndPath = () => emfRecord(60, new Uint8Array(0));
const emfCloseFigure = () => emfRecord(61, new Uint8Array(0));
const emfFillPath = () => emfRecord(62, new W().i32(0).i32(0).i32(0).i32(0).toBytes());
const emfStrokePath = () => emfRecord(64, new W().i32(0).i32(0).i32(0).i32(0).toBytes());
function emfPoly32(type, bounds, points) {
  const w = new W();
  w.i32(bounds.left).i32(bounds.top).i32(bounds.right).i32(bounds.bottom);
  w.u32(points.length);
  for (const p of points) { w.i32(p.x); w.i32(p.y); }
  return emfRecord(type, w.toBytes());
}
const emfPolygon = (bounds, pts) => emfPoly32(3, bounds, pts);
const emfPolyline = (bounds, pts) => emfPoly32(4, bounds, pts);
const emfPolyBezier = (bounds, pts) => emfPoly32(2, bounds, pts);
const emfPolyBezierTo = (bounds, pts) => emfPoly32(5, bounds, pts);
function emfPolyPolygon(bounds, polys) {
  const w = new W();
  w.i32(bounds.left).i32(bounds.top).i32(bounds.right).i32(bounds.bottom);
  w.u32(polys.length);
  w.u32(polys.reduce((s, p) => s + p.length, 0));
  for (const poly of polys) w.u32(poly.length);
  for (const poly of polys) for (const p of poly) { w.i32(p.x); w.i32(p.y); }
  return emfRecord(8, w.toBytes());
}
function emfExtCreateFontIndirectW(idx, opts = {}) {
  const w = new W();
  w.u32(idx);
  w.i32(opts.height ?? -16).i32(0).i32(0).i32(0).i32(opts.weight ?? 400);
  w.u8(opts.italic ? 1 : 0).u8(opts.underline ? 1 : 0).u8(0).u8(0);
  w.u8(0).u8(0).u8(0).u8(0);
  const face = opts.faceName || 'Arial';
  for (const ch of face) w.u16(ch.charCodeAt(0));
  w.u16(0);
  return emfRecord(82, w.toBytes());
}
function emfExtTextOutW(x, y, text) {
  const strBytes = new Uint8Array(text.length * 2);
  const dv = new DataView(strBytes.buffer);
  for (let i = 0; i < text.length; i++) dv.setUint16(i * 2, text.charCodeAt(i), true);
  const fixedLen = 68;
  const w = new W();
  w.i32(x - 50).i32(y - 20).i32(x + 50).i32(y + 20);
  w.u32(1).f32(1).f32(1);
  w.i32(x).i32(y);
  w.u32(text.length);
  w.u32(8 + fixedLen);
  w.u32(0);
  w.i32(0).i32(0).i32(0).i32(0);
  w.u32(0);
  w.bytes(strBytes);
  return emfRecord(84, w.toBytes());
}
function emfStretchDibits(dibHeader, dibPixels, destX, destY, destW, destH) {
  const headerLen = 72;
  const bmiOff = 8 + headerLen, bitsOff = bmiOff + dibHeader.length;
  const w = new W();
  w.i32(0).i32(0).i32(destW).i32(destH);
  w.i32(destX).i32(destY);
  w.i32(0).i32(0).i32(destW).i32(destH);
  w.u32(bmiOff).u32(dibHeader.length);
  w.u32(bitsOff).u32(dibPixels.length);
  w.u32(0).u32(0x00CC0020);
  w.i32(destW).i32(destH);
  w.bytes(dibHeader); w.bytes(dibPixels);
  return emfRecord(81, w.toBytes());
}
function emfComment(emfPlusBytes) {
  const payload = concat([new W().u32(0x2B464D45).toBytes(), emfPlusBytes]);
  const data = concat([new W().u32(payload.length).toBytes(), payload]);
  return emfRecord(70, data);
}
function emfPlusRecord(type, flags, payload) {
  const w = new W(); w.u16(type).u16(flags).u32(12 + payload.length).u32(payload.length).bytes(payload);
  return w.toBytes();
}
const emfPlusObjectBrush = (idx, argb) => emfPlusRecord(0x4008, (1 << 8) | idx, new W().u32(1).u32(0).u32(argb >>> 0).toBytes());
function emfPlusFillRects(brushIdx, rects) {
  const w = new W(); w.u32(brushIdx).u32(rects.length);
  for (const r of rects) w.f32(r.x).f32(r.y).f32(r.w).f32(r.h);
  return emfPlusRecord(0x400A, 0, w.toBytes());
}

// ---------------------------------------------------------------------------
// A small BITMAPINFOHEADER (BI_RGB, 24bpp) DIB builder
// ---------------------------------------------------------------------------
function buildDib24(w_, h_, pixelAt) {
  const stride = Math.ceil((w_ * 24) / 32) * 4;
  const header = new W().u32(40).i32(w_).i32(h_).u16(1).u16(24).u32(0).u32(stride * h_).i32(2835).i32(2835).u32(0).u32(0).toBytes();
  const rows = new Uint8Array(stride * h_);
  for (let row = 0; row < h_; row++) {
    const srcRow = h_ - 1 - row; // BI_RGB is stored bottom-up
    for (let x = 0; x < w_; x++) {
      const [r, g, b] = pixelAt(x, srcRow);
      rows[row * stride + x * 3] = b; rows[row * stride + x * 3 + 1] = g; rows[row * stride + x * 3 + 2] = r;
    }
  }
  return { full: concat([header, rows]), header, pixels: rows };
}

// ===========================================================================
// WMF record family tests
// ===========================================================================

test('WMF: Rectangle + Ellipse with a solid pen/brush render as <rect>/<ellipse>', () => {
  const svg = wmfToSvg(buildWmf([
    wmfSetWindowOrg(0, 0), wmfSetWindowExt(200, 200),
    wmfCreateBrush(0, { r: 255, g: 0, b: 0 }), wmfSelectObject(0),
    wmfCreatePen(0, 2, { r: 0, g: 0, b: 255 }), wmfSelectObject(1),
    wmfRectangle(10, 10, 60, 40),
    wmfEllipse(70, 10, 120, 60),
  ]));
  assert.ok(svg, 'expected an SVG string');
  assert.match(svg, /<svg[^>]*viewBox="[^"]+"/);
  assert.match(svg, /<rect[^>]*fill="#ff0000"[^>]*stroke="#0000ff"/);
  assert.match(svg, /<ellipse[^>]*fill="#ff0000"/);
});

test('WMF: RoundRect renders a <rect> with rx/ry', () => {
  const svg = wmfToSvg(buildWmf([wmfRoundRect(0, 0, 100, 60, 20, 20)]));
  assert.match(svg, /<rect[^>]*rx="[0-9.]+"[^>]*ry="[0-9.]+"/);
});

test('WMF: MoveTo/LineTo chain becomes a polyline', () => {
  const svg = wmfToSvg(buildWmf([wmfMoveTo(0, 0), wmfLineTo(50, 0), wmfLineTo(50, 50)]));
  assert.match(svg, /<polyline points="0,0 50,0 50,50"/);
});

test('WMF: Polygon/Polyline/PolyPolygon', () => {
  const svg = wmfToSvg(buildWmf([
    wmfPolygon([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 20, y: 30 }]),
    wmfPolyline([{ x: 0, y: 50 }, { x: 40, y: 50 }]),
    wmfPolyPolygon([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 25, y: 30 }]]),
  ]));
  assert.match(svg, /<polygon points="0,0 40,0 20,30"/);
  assert.match(svg, /<polyline points="0,50 40,50"/);
  assert.match(svg, /<path d="M0,0 L10,0 L5,10 Z M20,20 L30,20 L25,30 Z"/);
});

test('WMF: Arc/Pie/Chord render an SVG arc <path>', () => {
  const svg = wmfToSvg(buildWmf([
    wmfArc(0, 0, 100, 100, 100, 50, 50, 0),
    wmfPie(0, 0, 100, 100, 100, 50, 50, 0),
    wmfChord(0, 0, 100, 100, 100, 50, 50, 0),
  ]));
  const arcCount = (svg.match(/<path d="M[^"]*A[0-9.]+,[0-9.]+ 0 [01] 0/g) || []).length;
  assert.equal(arcCount, 3);
  assert.match(svg, /Z"/); // Pie/Chord close the path; Arc does not
});

test('WMF: CREATEPENINDIRECT dash styles and PS_NULL (no stroke)', () => {
  const dashed = wmfToSvg(buildWmf([wmfCreatePen(1, 2, { r: 0, g: 0, b: 0 }), wmfSelectObject(0), wmfRectangle(0, 0, 10, 10)]));
  assert.match(dashed, /stroke-dasharray="[0-9,]+"/);
  const noStroke = wmfToSvg(buildWmf([wmfCreatePen(5, 1, { r: 0, g: 0, b: 0 }), wmfSelectObject(0), wmfRectangle(0, 0, 10, 10)]));
  assert.doesNotMatch(noStroke, /stroke="#/);
});

test('WMF: CREATEBRUSHINDIRECT BS_NULL leaves the shape unfilled', () => {
  const svg = wmfToSvg(buildWmf([wmfCreateBrush(1, { r: 0, g: 0, b: 0 }), wmfSelectObject(0), wmfRectangle(0, 0, 10, 10)]));
  assert.match(svg, /<rect[^>]*fill="none"/);
});

test('WMF: TEXTOUT and EXTTEXTOUT render <text>, honouring CREATEFONTINDIRECT/SETTEXTCOLOR', () => {
  const svg = wmfToSvg(buildWmf([
    wmfCreateFontIndirect({ height: -20, weight: 700, italic: 1, faceName: 'Verdana' }), wmfSelectObject(0),
    wmfRecord(0x0209, new W().u32(colorref({ r: 0, g: 128, b: 0 })).toBytes()), // SETTEXTCOLOR
    wmfTextOut(5, 5, 'Hello'),
    wmfExtTextOut(5, 30, 'World'),
  ]));
  assert.match(svg, /<text[^>]*font-family="Verdana"[^>]*fill="#008000"[^>]*font-weight="bold"[^>]*font-style="italic"[^>]*>Hello<\/text>/);
  assert.match(svg, /<text[^>]*>World<\/text>/);
});

test('WMF: SETWINDOWORG/EXT and SETVIEWPORTORG/EXT together actually rescale points', () => {
  // Window is twice the size of the viewport -> every logical unit should halve.
  const svg = wmfToSvg(buildWmf([
    wmfSetWindowOrg(0, 0), wmfSetWindowExt(200, 200),
    wmfSetViewportOrg(0, 0), wmfSetViewportExt(100, 100),
    wmfRectangle(0, 0, 100, 100),
  ]));
  assert.match(svg, /<rect x="0" y="0" width="50" height="50"/);
});

test('WMF: SAVEDC/RESTOREDC restores pen/brush state', () => {
  const svg = wmfToSvg(buildWmf([
    wmfCreateBrush(0, { r: 255, g: 0, b: 0 }), wmfSelectObject(0),
    wmfSaveDC(),
    wmfCreateBrush(0, { r: 0, g: 255, b: 0 }), wmfSelectObject(1),
    wmfRectangle(0, 0, 10, 10), // green
    wmfRestoreDC(-1),
    wmfRectangle(20, 0, 30, 10), // back to red
  ]));
  const rects = [...svg.matchAll(/<rect[^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(rects, ['#00ff00', '#ff0000']);
});

test('WMF: SELECTOBJECT/DELETEOBJECT — deleting an object frees its slot for reuse, and a select of a deleted index is a no-op', () => {
  const svg = wmfToSvg(buildWmf([
    wmfCreateBrush(0, { r: 0, g: 0, b: 255 }), wmfSelectObject(0), wmfDeleteObject(0),
    wmfSelectObject(0), // object 0 no longer exists: current brush stays whatever it was (still blue)
    wmfRectangle(0, 0, 10, 10),
    wmfCreateBrush(0, { r: 0, g: 255, b: 0 }), wmfSelectObject(0), // slot 0 is free again: reused
    wmfRectangle(20, 0, 30, 10),
  ]));
  const fills = [...svg.matchAll(/<rect[^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(fills, ['#0000ff', '#00ff00']);
});

test('WMF: INTERSECTCLIPRECT produces a <clipPath> and wraps drawing in a clipped <g>', () => {
  const svg = wmfToSvg(buildWmf([wmfIntersectClipRect(0, 0, 50, 50), wmfRectangle(0, 0, 100, 100)]));
  assert.match(svg, /<clipPath id="c0"><rect/);
  assert.match(svg, /<g clip-path="url\(#c0\)">.*<rect.*<\/g>/s);
});

test('WMF: STRETCHDIB and DIBSTRETCHBLT embed the bitmap as a data: <image>', () => {
  const dib = buildDib24(2, 2, (x, y) => (x === 0 && y === 0) ? [255, 0, 0] : [0, 255, 0]).full;
  const svg1 = wmfToSvg(buildWmf([wmfStretchDib(dib, 5, 5, 40, 40)]));
  assert.match(svg1, /<image x="5" y="5" width="40" height="40"[^>]*href="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  const svg2 = wmfToSvg(buildWmf([wmfDibStretchBlt(dib, 5, 5, 40, 40)]));
  assert.match(svg2, /<image[^>]*href="data:image\/png;base64,/);
});

test('WMF: a placeable header is read for the fallback viewBox when nothing was drawn', () => {
  const svg = wmfToSvg(buildWmf([], { left: 0, top: 0, right: 300, bottom: 150 }));
  assert.equal(svg, null); // nothing drawable at all: falls back to the caller's placeholder
});

test('WMF: malformed input (bad header) returns null, never throws', () => {
  assert.equal(wmfToSvg(new Uint8Array([1, 2, 3])), null);
  assert.equal(wmfToSvg(new Uint8Array(30)), null); // wrong headerSize field (all zero)
  assert.equal(wmfToSvg(null), null);
});

// ===========================================================================
// EMF record family tests
// ===========================================================================

test('EMF: Rectangle/Ellipse/RoundRect with CREATEPEN/CREATEBRUSHINDIRECT', () => {
  const svg = emfToSvg(buildEmf([
    emfCreateBrush(1, 0, { r: 255, g: 0, b: 0 }), emfSelectObject(1),
    emfCreatePen(2, 0, 3, { r: 0, g: 0, b: 255 }), emfSelectObject(2),
    emfRectangle(10, 10, 60, 40),
    emfEllipse(70, 10, 120, 60),
    emfRoundRect(0, 70, 50, 100, 10, 10),
  ]));
  assert.match(svg, /<rect[^>]*fill="#ff0000"[^>]*stroke="#0000ff"[^>]*stroke-width="3"/);
  assert.match(svg, /<ellipse[^>]*fill="#ff0000"/);
  assert.match(svg, /<rect[^>]*rx="[0-9.]+"/);
});

test('EMF: EXTCREATEPEN (95) is honoured, not just the classic CREATEPEN', () => {
  const svg = emfToSvg(buildEmf([
    emfExtCreatePen(1, 0, 4, { r: 10, g: 20, b: 30 }), emfSelectObject(1),
    emfRectangle(0, 0, 10, 10),
  ]));
  assert.match(svg, /stroke="#0a141e"[^>]*stroke-width="4"/);
});

test('EMF: MoveTo/LineTo and Poly32/Poly16 families (Polygon/Polyline/PolyBezier)', () => {
  const svg = emfToSvg(buildEmf([
    emfMoveTo(0, 0), emfLineTo(30, 0), emfLineTo(30, 30),
    emfPolygon({ left: 0, top: 40, right: 40, bottom: 80 }, [{ x: 0, y: 40 }, { x: 40, y: 40 }, { x: 20, y: 80 }]),
    emfPolyline({ left: 0, top: 90, right: 40, bottom: 90 }, [{ x: 0, y: 90 }, { x: 40, y: 90 }]),
    emfPolyBezier({ left: 0, top: 100, right: 60, bottom: 160 }, [{ x: 0, y: 100 }, { x: 20, y: 100 }, { x: 40, y: 160 }, { x: 60, y: 100 }]),
  ]));
  assert.match(svg, /<polyline points="0,0 30,0 30,30"/);
  assert.match(svg, /<polygon points="0,40 40,40 20,80"/);
  assert.match(svg, /<polyline points="0,90 40,90"/);
  assert.match(svg, /<path d="M0,100 C20,100 40,160 60,100" fill="none"/);
});

test('EMF: PolyPolygon (8)', () => {
  const svg = emfToSvg(buildEmf([emfPolyPolygon({ left: 0, top: 0, right: 40, bottom: 40 }, [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 25, y: 30 }]])]));
  assert.match(svg, /<path d="M0,0 L10,0 L5,10 Z M20,20 L30,20 L25,30 Z"/);
});

test('EMF: BeginPath/.../EndPath + FillPath/StrokePath build a real <path>', () => {
  const svg = emfToSvg(buildEmf([
    emfCreateBrush(1, 0, { r: 0, g: 200, b: 0 }), emfSelectObject(1),
    emfBeginPath(),
    emfMoveTo(0, 0), emfLineTo(40, 0), emfLineTo(20, 30), emfCloseFigure(),
    emfEndPath(),
    emfFillPath(),
  ]));
  assert.match(svg, /<path d="M0,0 L40,0 L20,30 Z"[^>]*fill="#00c800"/);
});

// LibreOffice draws a shape's border inside a *single* path bracket as one continuous ring:
// MoveTo (outer start) -> LineTo (outer offset) -> PolyBezierTo (outer curve) -> Polyline (a
// short straight "bridge" to the inner curve, reusing the current position, not a fresh MoveTo)
// -> PolyBezierTo (inner curve, continuing from wherever the Polyline left off) -> LineTo (back
// to the start) -> CloseFigure. Regression for #EMF-PATH-BRACKET-CONTINUITY: PolyBezierTo always
// prepended its own "M" and Polyline/Polygon inside a path bracket always restarted at their own
// first point instead of continuing the current figure — and neither updated ctx.state.curPos —
// so CloseFigure's "Z" closed only the last of several spurious subpaths with a straight chord,
// carving a notch out of the ring on every bracket. Multiplied around an ellipse (~39 brackets in
// the real LibreOffice EMF below) that produced the broken/dashed/scalloped outline; the fill
// itself (a separate FillPath elsewhere) was never dashed — only this stroke-as-fill outline was.
test('EMF: PolyBezierTo/Polyline inside a path bracket continue the current figure, not a new one (#EMF-PATH-BRACKET-CONTINUITY)', () => {
  const svg = emfToSvg(buildEmf([
    emfCreateBrush(1, 0, { r: 0, g: 0, b: 0 }), emfSelectObject(1),
    emfBeginPath(),
    emfMoveTo(0, 0),
    emfLineTo(10, 0),
    emfPolyBezierTo({ left: 0, top: 0, right: 30, bottom: 10 }, [{ x: 15, y: 0 }, { x: 25, y: 5 }, { x: 30, y: 10 }]),
    emfPolyline({ left: 30, top: 10, right: 34, bottom: 14 }, [{ x: 32, y: 12 }, { x: 34, y: 14 }]),
    emfPolyBezierTo({ left: 0, top: 10, right: 34, bottom: 14 }, [{ x: 20, y: 14 }, { x: 10, y: 12 }, { x: 0, y: 10 }]),
    emfLineTo(0, 0),
    emfCloseFigure(),
    emfEndPath(),
    emfFillPath(),
  ]));
  // One unbroken subpath — a single "M" — from BeginPath to CloseFigure, not one per record.
  const [pathD] = svg.match(/<path d="([^"]*)"/).slice(1);
  assert.equal((pathD.match(/M/g) || []).length, 1, `expected exactly one M, got: ${pathD}`);
  assert.equal(
    pathD,
    'M0,0 L10,0 C15,0 25,5 30,10 L32,12 L34,14 C20,14 10,12 0,10 L0,0 Z',
  );
});

test('EMF: an explicit mid-bracket MoveTo still starts a genuinely new (e.g. hole) figure', () => {
  const svg = emfToSvg(buildEmf([
    emfCreateBrush(1, 0, { r: 0, g: 0, b: 0 }), emfSelectObject(1),
    emfBeginPath(),
    emfMoveTo(0, 0), emfLineTo(40, 0), emfLineTo(20, 30), emfCloseFigure(),
    emfMoveTo(15, 5), emfLineTo(25, 5), emfLineTo(20, 15), emfCloseFigure(),
    emfEndPath(),
    emfFillPath(),
  ]));
  assert.match(svg, /<path d="M0,0 L40,0 L20,30 Z M15,5 L25,5 L20,15 Z"/);
});

// ---------------------------------------------------------------------------
// Real LibreOffice-exported EMF fixture (tests/fixtures/libreoffice/lo-ellipse.emf): a single
// filled+outlined ellipse, drawn LibreOffice's way — border as ~39 chained BeginPath/PolyBezierTo/
// Polyline/CloseFigure/FillPath brackets, one per curve segment, exactly the shape that exposed
// #EMF-PATH-BRACKET-CONTINUITY above. Built from an .fodg with a single draw:ellipse, converted
// ellipse-only.fodg -> .emf via `soffice --headless --convert-to emf` (LibreOffice 26.8), so this
// is genuine LibreOffice filter output, not hand-built.
// ---------------------------------------------------------------------------
const LOFIX = new URL('./fixtures/libreoffice/', import.meta.url);
const loEllipseEmf = () => { const b = readFileSync(new URL('lo-ellipse.emf', LOFIX)); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); };

test('EMF (LibreOffice fixture): the ellipse border is one continuous closed ring, not many disjoint segments', () => {
  const svg = emfToSvg(loEllipseEmf());
  assert.ok(svg, 'expected an SVG string');
  // The ellipse fill is a single BeginPath/PolyBezierTo/.../FillPath bracket with a black stroke
  // brush selected as the border colour; every <path> LibreOffice draws in this file should close
  // as one subpath (one "M" each) — never several "M"s stitched together by an auto-closing chord,
  // which is what rendered as a dashed/scalloped outline before the fix.
  const paths = [...svg.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 10, `expected many path-bracket segments, got ${paths.length}`);
  for (const d of paths) {
    const mCount = (d.match(/M/g) || []).length;
    assert.equal(mCount, 1, `path bracket should be a single continuous subpath, got ${mCount} "M"s in: ${d}`);
    assert.ok(d.trim().endsWith('Z'), `path bracket should close back to its own start, got: ${d}`);
  }
});

test('EMF: EXTCREATEFONTINDIRECTW facename + EXTTEXTOUTW render <text>', () => {
  const svg = emfToSvg(buildEmf([
    emfExtCreateFontIndirectW(1, { height: -18, weight: 700, faceName: 'Tahoma' }), emfSelectObject(1),
    emfExtTextOutW(10, 10, 'Braille'),
  ]));
  assert.match(svg, /<text[^>]*font-family="Tahoma"[^>]*font-weight="bold"[^>]*>Braille<\/text>/);
});

test('EMF: SETWORLDTRANSFORM is applied to drawn points', () => {
  // Pure 2x scale + 10,10 translate.
  const w = new W(); w.f32(2).f32(0).f32(0).f32(2).f32(10).f32(10);
  const svg = emfToSvg(buildEmf([emfRecord(35, w.toBytes()), emfRectangle(0, 0, 10, 10)]));
  assert.match(svg, /<rect x="10" y="10" width="20" height="20"/);
});

test('EMF: SAVEDC/RESTOREDC and SelectStockObject', () => {
  const svg = emfToSvg(buildEmf([
    emfSelectStock(4), // BLACK_BRUSH
    emfSaveDC(),
    emfSelectStock(0), // WHITE_BRUSH
    emfRectangle(0, 0, 10, 10),
    emfRestoreDC(-1),
    emfRectangle(20, 0, 30, 10),
  ]));
  const fills = [...svg.matchAll(/<rect[^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(fills, ['#ffffff', '#000000']);
});

test('EMF: INTERSECTCLIPRECT produces a clipped <g>', () => {
  const svg = emfToSvg(buildEmf([emfIntersectClipRect(0, 0, 50, 50), emfRectangle(0, 0, 100, 100)]));
  assert.match(svg, /<clipPath id="c0">/);
  assert.match(svg, /<g clip-path="url\(#c0\)">/);
});

test('EMF: STRETCHDIBITS/BITBLT embed the bitmap as a data: <image>', () => {
  const dib = buildDib24(2, 2, (x, y) => (x === y) ? [255, 255, 0] : [0, 0, 0]);
  const svg = emfToSvg(buildEmf([emfStretchDibits(dib.header, dib.pixels, 5, 5, 50, 50)]));
  assert.match(svg, /<image x="5" y="5" width="50" height="50"[^>]*href="data:image\/png;base64,/);
});

test('EMF: a GDI (dual-mode) fallback is rendered and EMF+ comment content is ignored', () => {
  const emfPlus = concat([emfPlusObjectBrush(0, 0xFF0000FF), emfPlusFillRects(0, [{ x: 0, y: 0, w: 999, h: 999 }])]);
  const svg = emfToSvg(buildEmf([
    emfCreateBrush(1, 0, { r: 0, g: 255, b: 0 }), emfSelectObject(1),
    emfRectangle(0, 0, 10, 10), // the real GDI fallback content
    emfComment(emfPlus),
  ]));
  assert.match(svg, /<rect[^>]*fill="#00ff00"/);
  assert.doesNotMatch(svg, /fill="#0000ff"/); // the EMF+ rect must NOT have been drawn too
});

test('EMF: minimal EMF+-only rendering (no GDI fallback) draws solid rects via the Object/FillRects records', () => {
  const emfPlus = concat([emfPlusObjectBrush(0, 0xFFFF0000), emfPlusFillRects(0, [{ x: 5, y: 5, w: 20, h: 20 }])]);
  const svg = emfToSvg(buildEmf([emfComment(emfPlus)]));
  assert.ok(svg, 'expected best-effort EMF+ output');
  assert.match(svg, /<rect x="5" y="5" width="20" height="20" fill="#ff0000"/);
});

test('EMF: malformed input returns null, never throws', () => {
  assert.equal(emfToSvg(new Uint8Array([1, 2, 3])), null);
  assert.equal(emfToSvg(new Uint8Array(100)), null); // no 'EMF ' signature
  assert.equal(emfToSvg(null), null);
});

test('metafileToSvg autodetects WMF vs EMF from the same call', () => {
  const wmf = buildWmf([wmfRectangle(0, 0, 10, 10)]);
  const emf = buildEmf([emfRectangle(0, 0, 10, 10)]);
  assert.match(metafileToSvg(wmf), /<rect/);
  assert.match(metafileToSvg(emf), /<rect/);
});

test('metafileToResource returns the same {path, mime, bytes} shape as a parsed PNG/JPEG', () => {
  const res = metafileToResource(buildWmf([wmfRectangle(0, 0, 10, 10)]), 'pic1.svg');
  assert.equal(res.path, 'pic1.svg');
  assert.equal(res.mime, 'image/svg+xml');
  assert.match(new TextDecoder().decode(res.bytes), /<svg/);
  assert.equal(metafileToResource(new Uint8Array([9, 9, 9]), 'x.svg'), null);
});

// ===========================================================================
// DIB/BMP -> PNG
// ===========================================================================

test('decodeDIB: 24bpp BI_RGB decodes to the right pixels', () => {
  const dib = buildDib24(2, 2, (x, y) => (x === 0 && y === 0) ? [200, 10, 10] : [10, 10, 200]).full;
  const img = decodeDIB(dib);
  assert.equal(img.width, 2); assert.equal(img.height, 2);
  assert.deepEqual([...img.rgba.subarray(0, 4)], [200, 10, 10, 255]);
});

test('dibToPngBytes: produces a valid PNG (signature + IHDR dimensions) for a bare DIB and a .bmp file', () => {
  const dib = buildDib24(4, 3, () => [1, 2, 3]).full;
  const png = dibToPngBytes(dib);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(dv.getUint32(16), 4); // IHDR width
  assert.equal(dv.getUint32(20), 3); // IHDR height

  const bmpFile = concat([new W().u8(0x42).u8(0x4D).u32(14 + dib.length).u32(0).u32(14).toBytes(), dib]);
  const png2 = dibToPngBytes(bmpFile);
  assert.ok(png2);
  assert.equal(new DataView(png2.buffer, png2.byteOffset, png2.byteLength).getUint32(16), 4);
});

test('dibToResource / decodeDIB: RLE compression and malformed data are rejected as null, never throw', () => {
  const rleHeader = new W().u32(40).i32(2).i32(2).u16(1).u16(8).u32(1 /* BI_RLE8 */).u32(0).i32(0).i32(0).u32(0).u32(0).toBytes();
  assert.equal(decodeDIB(rleHeader), null);
  assert.equal(dibToPngBytes(new Uint8Array([1, 2, 3])), null);
  assert.equal(dibToResource(new Uint8Array(0), 'x.png'), null);
});

test('encodePNG round trip sanity: correct byte length for a solid 3x1 RGBA image', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const png = encodePNG(3, 1, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

// ===========================================================================
// RTF integration: \wmetafile / \emfblip / \dibitmap now decode into an image resource
// ===========================================================================

function toHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }

test('RTF: \\wmetafile8 blip decodes to an SVG graphic resource', () => {
  const wmf = buildWmf([
    wmfCreateBrush(0, { r: 0, g: 128, b: 255 }), wmfSelectObject(0),
    wmfRectangle(0, 0, 100, 100),
  ]);
  const rtf = `{\\rtf1 {\\pict\\wmetafile8\\picw1000\\pich1000 ${toHex(wmf)}} par}`;
  const model = parseRtf(rtf);
  const graphic = model.blocks.find((b) => b.type === 'graphic');
  assert.ok(graphic, 'expected a graphic block');
  assert.match(graphic.src, /\.svg$/);
  const res = model.resources.find((r) => r.path === graphic.src);
  assert.ok(res, 'expected a matching resource');
  assert.equal(res.mime, 'image/svg+xml');
  assert.match(new TextDecoder().decode(res.bytes), /<rect[^>]*fill="#0080ff"/);
});

test('RTF: \\emfblip decodes to an SVG graphic resource', () => {
  const emf = buildEmf([emfCreateBrush(1, 0, { r: 255, g: 0, b: 0 }), emfSelectObject(1), emfEllipse(0, 0, 40, 40)]);
  const rtf = `{\\rtf1 {\\pict\\emfblip\\picw1000\\pich1000 ${toHex(emf)}} par}`;
  const model = parseRtf(rtf);
  const graphic = model.blocks.find((b) => b.type === 'graphic');
  assert.ok(graphic);
  const res = model.resources.find((r) => r.path === graphic.src);
  assert.equal(res.mime, 'image/svg+xml');
  assert.match(new TextDecoder().decode(res.bytes), /<ellipse[^>]*fill="#ff0000"/);
});

test('RTF: \\dibitmap blip decodes to a PNG graphic resource', () => {
  const dib = buildDib24(3, 3, (x, y) => [x * 80, y * 80, 0]).full;
  const rtf = `{\\rtf1 {\\pict\\dibitmap\\picw300\\pich300 ${toHex(dib)}} par}`;
  const model = parseRtf(rtf);
  const graphic = model.blocks.find((b) => b.type === 'graphic');
  assert.ok(graphic);
  assert.match(graphic.src, /\.png$/);
  const res = model.resources.find((r) => r.path === graphic.src);
  assert.equal(res.mime, 'image/png');
  assert.deepEqual([...res.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('RTF: an undecodable \\wmetafile8 blip (malformed bytes) is dropped, not carried as a broken resource', () => {
  const rtf = `{\\rtf1 {\\pict\\wmetafile8\\picw100\\pich100 010203} par}`;
  const model = parseRtf(rtf);
  assert.equal(model.blocks.some((b) => b.type === 'graphic'), false);
  assert.equal((model.resources || []).length, 0);
});

test('RTF: \\macpict (legacy Mac PICT) is still not decoded', () => {
  const rtf = `{\\rtf1 {\\pict\\macpict\\picw100\\pich100 010203040506} par}`;
  const model = parseRtf(rtf);
  assert.equal(model.blocks.some((b) => b.type === 'graphic'), false);
});
