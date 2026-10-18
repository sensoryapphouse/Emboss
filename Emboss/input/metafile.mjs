// WMF / EMF / EMF+ -> SVG, and DIB(BMP) -> PNG: turns the Windows metafile picture formats
// Word/RTF documents embed (clip art, charts-as-pictures, equation previews, diagrams) into
// an ordinary image resource Emboss already knows how to carry — the same
// {path, mime, bytes} shape parse.mjs uses for a PNG/JPEG (model.resources; see
// embedGraphicResources and mimeForPath there). No dependency: a from-scratch record parser
// plus a from-scratch, stored-block-only PNG encoder (no zlib/deflate library — a PNG IDAT is
// valid with uncompressed "stored" deflate blocks, so no real compression is needed).
//
// Design: adapted from Paul's own earlier converter at
//   "/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Xcode kids/Old Sensory/wmf-to-svg/"
// (wmf2svg.html's WMFParser/EMFParser/SVGRenderer classes, and the standalone emf-parser.js —
// Paul's own code, reused freely). The record-parsing approach (read each record's fields into
// a small typed object, dispatch on a shared "type" string so one renderer serves both WMF and
// EMF) and the Arc/Pie/Chord angle math are carried over close to as-is. Rewritten as a
// dependency-free ES module (no `document`/DOM, runs in Node for the test suite and in the
// browser for the editor) and extended/fixed against [MS-WMF]/[MS-EMF]/[MS-EMFPLUS
// ] to cover
// this task's scope:
//   - SetViewportOrgEx/SetViewportExtEx are now actually applied to every drawn point (the
//     original only used SetWindowOrg/Ext, for the SVG viewBox, and left the viewport org/ext
//     records unhandled — correct only for files where window == viewport).
//   - EMF's world transform (SETWORLDTRANSFORM/MODIFYWORLDTRANSFORM) is applied.
//   - EMR_EXTCREATEPEN (95) is read — the original only read the classic EMR_CREATEPEN (38),
//     missing the cosmetic/geometric pens LibreOffice and other modern writers emit.
//   - Embedded bitmaps: WMF STRETCHDIB/DIBSTRETCHBLT and EMF STRETCHDIBITS/BITBLT are decoded
//     (via the DIB decoder below) and placed as an inlined <image>; the original didn't do this
//     at all.
//   - PolyBezier/PolyBezierTo are real cubic <path> curves (the original approximated every
//     bezier as straight line segments).
//   - INTERSECTCLIPRECT becomes an SVG <clipPath>.
//   - A minimal EMF+ record reader (EMR_COMMENT "EMF+" streams) for the common case of solid-
//     colour rects/ellipses/lines and a world-transform stack, used only when the EMF carries
//     no GDI ("dual-mode") fallback content to draw instead — the spec's recommended behaviour.
//   - Text alignment: the original's horizontal-align check (`textAlign & 0x0006`) misread
//     TA_CENTER (6) as TA_RIGHT and never reached its own TA_CENTER branch; fixed, and a
//     TA_TOP/TA_BASELINE vertical offset was added (the original always anchored text as if
//     TA_BASELINE, so TA_TOP text — the common case — sat noticeably too high).
//   - EMR_EXTCREATEFONTINDIRECTW's face name offset was off by 36 bytes (facename actually
//     starts right after LOGFONTW's fixed fields, at d+32 — not d+68); fixed.
//   - Every record is applied in its own try/catch so one malformed/unrecognised record can
//     never abort the rest of the picture; an unparseable file (bad header/signature) or a
//     picture that ends up with nothing drawable returns null so the caller can fall back to
//     the description placeholder, per this module's contract.
// Not carried over: the original's MDCR "custom metadata" extraction (Paul's own authoring-
// tool provenance data bolted onto WMF via ESCAPE records) — outside this task's scope and it
// would add dead weight to the SVG for every ordinary Office picture that never has any.

'use strict';

// ============================================================================================
// Shared byte/SVG helpers
// ============================================================================================

function makeReader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    len: bytes.length,
    u8: (o) => dv.getUint8(o),
    i8: (o) => dv.getInt8(o),
    u16: (o) => dv.getUint16(o, true),
    i16: (o) => dv.getInt16(o, true),
    u32: (o) => dv.getUint32(o, true),
    i32: (o) => dv.getInt32(o, true),
    f32: (o) => dv.getFloat32(o, true),
  };
}

function concatBytes(arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtN(n) {
  if (!isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function colorHex(c) {
  const clamp = (v) => Math.max(0, Math.min(255, v | 0));
  return '#' + [clamp(c.r), clamp(c.g), clamp(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ============================================================================================
// Dependency-free PNG encoder (stored/uncompressed deflate — no zlib library needed) and a
// BMP/DIB (BITMAPINFOHEADER or BITMAPCOREHEADER) decoder, shared by:
//  - RTF \dibitmap blips (a bare DIB, no 14-byte BITMAPFILEHEADER) and standalone .bmp files
//    (dibToPngBytes / dibToResource, below)
//  - WMF STRETCHDIB/DIBSTRETCHBLT and EMF STRETCHDIBITS/BITBLT embedded bitmaps, inlined as an
//    <image> inside the generated SVG
// ============================================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}
function u32be(n) { return new Uint8Array([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]); }
function pngChunk(type, data) {
  const typeBytes = new Uint8Array(type.length);
  for (let i = 0; i < type.length; i++) typeBytes[i] = type.charCodeAt(i);
  const body = concatBytes([typeBytes, data]);
  return concatBytes([u32be(data.length), body, u32be(crc32(body))]);
}
// zlib wrapper around "stored" (BTYPE=00, uncompressed) deflate blocks — always valid deflate,
// just not compressed; fine for the modest bitmap sizes clip-art embeds.
function zlibStore(data) {
  const header = new Uint8Array([0x78, 0x01]);
  const blocks = [];
  const MAXB = 65535;
  let i = 0;
  if (data.length === 0) blocks.push(new Uint8Array([1, 0, 0, 0xFF, 0xFF]));
  while (i < data.length) {
    const remaining = data.length - i;
    const len = Math.min(MAXB, remaining);
    const isFinal = (i + len >= data.length) ? 1 : 0;
    const nlen = (~len) & 0xFFFF;
    const blockHeader = new Uint8Array([isFinal, len & 0xFF, (len >> 8) & 0xFF, nlen & 0xFF, (nlen >> 8) & 0xFF]);
    blocks.push(concatBytes([blockHeader, data.subarray(i, i + len)]));
    i += len;
  }
  return concatBytes([header, ...blocks, u32be(adler32(data))]);
}
/** Encodes RGBA pixel bytes (top-down, width*height*4) as a PNG file. */
export function encodePNG(width, height, rgba) {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = pngChunk('IHDR', concatBytes([u32be(width), u32be(height), new Uint8Array([8, 6, 0, 0, 0])]));
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = pngChunk('IDAT', zlibStore(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));
  return concatBytes([sig, ihdr, idat, iend]);
}

function maskToChannel(pixelVal, mask) {
  if (!mask) return 0;
  let shift = 0, m = mask >>> 0;
  while (m && !(m & 1)) { m >>>= 1; shift++; }
  const bits = Math.max(1, Math.round(Math.log2(m + 1)));
  const maxVal = (1 << bits) - 1 || 1;
  const raw = (pixelVal & mask) >>> shift;
  return Math.round((raw * 255) / maxVal);
}

/**
 * Decodes a BITMAPINFOHEADER/BITMAPCOREHEADER-style DIB (no file header) starting at `offset`.
 * Supports 1/4/8/24/32bpp BI_RGB and 16/32bpp BI_BITFIELDS; returns null for anything else
 * (RLE compression, corrupt/truncated data, an unreasonable size) rather than throwing — "DIB
 * to PNG if simple" per this module's scope.
 */
export function decodeDIB(bytes, offset = 0) {
  try {
    if (offset + 4 > bytes.length) return null;
    const r = makeReader(bytes);
    const headerSize = r.u32(offset);
    const isCore = headerSize === 12;
    let width, height, bpp, compression = 0, clrUsed = 0;
    if (isCore) {
      if (offset + 12 > bytes.length) return null;
      width = r.i16(offset + 4);
      height = r.i16(offset + 6);
      bpp = r.u16(offset + 10);
    } else if (headerSize >= 40 && offset + 40 <= bytes.length) {
      width = r.i32(offset + 4);
      height = r.i32(offset + 8);
      bpp = r.u16(offset + 14);
      compression = r.u32(offset + 16);
      clrUsed = r.u32(offset + 32);
    } else return null;
    const topDown = height < 0;
    const h = Math.abs(height), w = Math.abs(width);
    if (!w || !h || w > 20000 || h > 20000 || w * h > 40000000) return null;
    if (compression !== 0 && compression !== 3) return null; // RLE4/RLE8/JPEG/PNG-in-DIB: not "simple"
    if (bpp !== 1 && bpp !== 4 && bpp !== 8 && bpp !== 16 && bpp !== 24 && bpp !== 32) return null;
    let pos = offset + headerSize;
    let maskR = 0, maskG = 0, maskB = 0;
    if (compression === 3 && (bpp === 16 || bpp === 32)) {
      if (pos + 12 > bytes.length) return null;
      maskR = r.u32(pos); maskG = r.u32(pos + 4); maskB = r.u32(pos + 8);
      pos += 12;
    } else if (bpp === 16) {
      maskR = 0x7C00; maskG = 0x03E0; maskB = 0x001F; // BI_RGB 16bpp is implicitly 5-5-5
    }
    let palette = null;
    if (bpp <= 8) {
      const count = clrUsed || (1 << bpp);
      const entrySize = isCore ? 3 : 4;
      if (count > 256 || pos + count * entrySize > bytes.length) return null;
      palette = new Array(count);
      for (let i = 0; i < count; i++) {
        const b = bytes[pos + i * entrySize], g = bytes[pos + i * entrySize + 1], rr = bytes[pos + i * entrySize + 2];
        palette[i] = [rr, g, b];
      }
      pos += count * entrySize;
    }
    const stride = Math.ceil((w * bpp) / 32) * 4;
    if (pos + stride * h > bytes.length) return null;
    const rgba = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) {
      const srcRow = topDown ? row : (h - 1 - row);
      const rowStart = pos + srcRow * stride;
      for (let x = 0; x < w; x++) {
        let rr = 0, g = 0, b = 0, a = 255;
        if (bpp === 1) { const byte = bytes[rowStart + (x >> 3)]; const bit = (byte >> (7 - (x & 7))) & 1; [rr, g, b] = palette[bit] || [0, 0, 0]; }
        else if (bpp === 4) { const byte = bytes[rowStart + (x >> 1)]; const idx = (x & 1) ? (byte & 0xF) : (byte >> 4); [rr, g, b] = palette[idx] || [0, 0, 0]; }
        else if (bpp === 8) { const idx = bytes[rowStart + x]; [rr, g, b] = palette[idx] || [0, 0, 0]; }
        else if (bpp === 16) { const v = bytes[rowStart + x * 2] | (bytes[rowStart + x * 2 + 1] << 8); rr = maskToChannel(v, maskR); g = maskToChannel(v, maskG); b = maskToChannel(v, maskB); }
        else if (bpp === 24) { b = bytes[rowStart + x * 3]; g = bytes[rowStart + x * 3 + 1]; rr = bytes[rowStart + x * 3 + 2]; }
        else { b = bytes[rowStart + x * 4]; g = bytes[rowStart + x * 4 + 1]; rr = bytes[rowStart + x * 4 + 2]; a = 255; }
        const o = (row * w + x) * 4;
        rgba[o] = rr; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
    return { width: w, height: h, rgba };
  } catch { return null; }
}

/** A standalone .bmp file (14-byte 'BM' file header) or a bare DIB (RTF \dibitmap / WMF blip). */
export function decodeBmpOrDib(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const offset = (bytes[0] === 0x42 && bytes[1] === 0x4D) ? 14 : 0; // 'BM'
  return decodeDIB(bytes, offset);
}
export function dibToPngBytes(bytes) {
  const img = decodeBmpOrDib(bytes);
  if (!img) return null;
  try { return encodePNG(img.width, img.height, img.rgba); } catch { return null; }
}
/** A {path, mime:'image/png', bytes} resource, the same shape as a parsed PNG/JPEG. */
export function dibToResource(bytes, path) {
  const png = dibToPngBytes(bytes);
  if (!png) return null;
  return { path, mime: 'image/png', bytes: png };
}

// ============================================================================================
// GDI render state, shared by WMF and EMF record streams (both parsers below emit the same
// canonical {type, ...} record shape so one dispatcher/renderer serves either format).
// ============================================================================================

function newRenderState() {
  return {
    winOrg: { x: 0, y: 0 }, winExt: { x: 1, y: 1 },
    vpOrg: { x: 0, y: 0 }, vpExt: { x: 1, y: 1 },
    xform: { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 },
    pen: { style: 0, width: 1, r: 0, g: 0, b: 0, null: false },
    brush: { style: 0, r: 255, g: 255, b: 255, null: false },
    font: { height: -12, weight: 400, italic: false, underline: false, strike: false, face: '' },
    textColor: { r: 0, g: 0, b: 0 }, textAlign: 0, polyFillMode: 1,
    curPos: { x: 0, y: 0 },
  };
}
function cloneState(s) {
  return {
    winOrg: { ...s.winOrg }, winExt: { ...s.winExt }, vpOrg: { ...s.vpOrg }, vpExt: { ...s.vpExt },
    xform: { ...s.xform }, pen: { ...s.pen }, brush: { ...s.brush }, font: { ...s.font },
    textColor: { ...s.textColor }, textAlign: s.textAlign, polyFillMode: s.polyFillMode,
    curPos: { ...s.curPos },
  };
}
function applyXform(st, x, y) {
  const m = st.xform;
  return { x: x * m.m11 + y * m.m21 + m.dx, y: x * m.m12 + y * m.m22 + m.dy };
}
function toDevice(st, x, y) {
  const w = applyXform(st, x, y);
  const sx = st.winExt.x ? st.vpExt.x / st.winExt.x : 1;
  const sy = st.winExt.y ? st.vpExt.y / st.winExt.y : 1;
  return { x: (w.x - st.winOrg.x) * sx + st.vpOrg.x, y: (w.y - st.winOrg.y) * sy + st.vpOrg.y };
}
function trackPt(ctx, p) {
  const b = ctx.bbox;
  if (p.x < b.minX) b.minX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y > b.maxY) b.maxY = p.y;
}

function strokeAttrs(state) {
  const p = state.pen;
  if (p.null || p.style === 5) return { stroke: 'none' };
  const w = Math.max(p.width, 1);
  let dash = null;
  if (p.style === 1) dash = `${w * 4},${w * 2}`;
  else if (p.style === 2) dash = `${w},${w * 2}`;
  else if (p.style === 3) dash = `${w * 4},${w * 2},${w},${w * 2}`;
  else if (p.style === 4) dash = `${w * 4},${w * 2},${w},${w * 2},${w},${w * 2}`;
  return { stroke: colorHex(p), strokeWidth: w, dash };
}
function fillAttrs(state) {
  if (state.brush.null || state.brush.style === 1) return { fill: 'none' };
  return { fill: colorHex(state.brush), fillRule: state.polyFillMode === 1 ? 'evenodd' : 'nonzero' };
}
function attrStr(o) {
  let s = '';
  if (o.fill !== undefined) s += ` fill="${o.fill}"`;
  if (o.fillRule) s += ` fill-rule="${o.fillRule}"`;
  if (o.stroke !== undefined) s += ` stroke="${o.stroke}"`;
  if (o.strokeWidth !== undefined) s += ` stroke-width="${fmtN(o.strokeWidth)}"`;
  if (o.dash) s += ` stroke-dasharray="${o.dash}"`;
  return s;
}

function flushLineBuf(ctx) {
  if (ctx.lineBuf && ctx.lineBuf.length > 1) {
    const pts = ctx.lineBuf.map((p) => `${fmtN(p.x)},${fmtN(p.y)}`).join(' ');
    ctx.parts.push(`<polyline points="${pts}" fill="none"${attrStr(strokeAttrs(ctx.state))}/>`);
  }
  ctx.lineBuf = null;
}
function doMoveTo(ctx, x, y) {
  const d = toDevice(ctx.state, x, y);
  if (ctx.inPath) { ctx.pathD += `M${fmtN(d.x)},${fmtN(d.y)} `; ctx.state.curPos = { x, y }; trackPt(ctx, d); return; }
  flushLineBuf(ctx);
  ctx.state.curPos = { x, y };
  ctx.lineBuf = [d];
  trackPt(ctx, d);
}
function doLineTo(ctx, x, y) {
  const d = toDevice(ctx.state, x, y);
  if (ctx.inPath) { ctx.pathD += `L${fmtN(d.x)},${fmtN(d.y)} `; ctx.state.curPos = { x, y }; trackPt(ctx, d); return; }
  if (!ctx.lineBuf) ctx.lineBuf = [toDevice(ctx.state, ctx.state.curPos.x, ctx.state.curPos.y)];
  ctx.lineBuf.push(d);
  ctx.state.curPos = { x, y };
  trackPt(ctx, d);
}
function doPolygon(ctx, points, closed) {
  if (!points || !points.length) return;
  if (ctx.inPath) {
    // [MS-EMF] path-bracket semantics: the current position persists across records inside
    // BeginPath/EndPath. Polyline/Polygon (unlike a bare MoveTo) do not start a fresh,
    // disconnected figure here — they continue the figure already open, connecting from
    // wherever the pen currently is. Only bootstrap a moveto if this is the very first
    // record of the bracket (pathD still empty) so the path data has a starting point.
    let i = 0;
    if (!ctx.pathD) {
      const d0 = toDevice(ctx.state, points[0].x, points[0].y);
      ctx.pathD += `M${fmtN(d0.x)},${fmtN(d0.y)} `; trackPt(ctx, d0);
      i = 1;
    }
    for (; i < points.length; i++) { const d = toDevice(ctx.state, points[i].x, points[i].y); ctx.pathD += `L${fmtN(d.x)},${fmtN(d.y)} `; trackPt(ctx, d); }
    if (closed) ctx.pathD += 'Z ';
    const last = points[points.length - 1];
    ctx.state.curPos = { x: last.x, y: last.y };
    return;
  }
  flushLineBuf(ctx);
  const devPts = points.map((p) => toDevice(ctx.state, p.x, p.y));
  devPts.forEach((p) => trackPt(ctx, p));
  const ptsStr = devPts.map((p) => `${fmtN(p.x)},${fmtN(p.y)}`).join(' ');
  if (closed) ctx.parts.push(`<polygon points="${ptsStr}"${attrStr({ ...fillAttrs(ctx.state), ...strokeAttrs(ctx.state) })}/>`);
  else ctx.parts.push(`<polyline points="${ptsStr}" fill="none"${attrStr(strokeAttrs(ctx.state))}/>`);
}
function doPolyPolygon(ctx, polygons) {
  flushLineBuf(ctx);
  let d = '';
  for (const poly of polygons || []) {
    if (!poly.length) continue;
    const d0 = toDevice(ctx.state, poly[0].x, poly[0].y); trackPt(ctx, d0);
    d += `M${fmtN(d0.x)},${fmtN(d0.y)} `;
    for (let i = 1; i < poly.length; i++) { const p = toDevice(ctx.state, poly[i].x, poly[i].y); trackPt(ctx, p); d += `L${fmtN(p.x)},${fmtN(p.y)} `; }
    d += 'Z ';
  }
  if (!d.trim()) return;
  ctx.parts.push(`<path d="${d.trim()}"${attrStr({ ...fillAttrs(ctx.state), ...strokeAttrs(ctx.state) })}/>`);
}
function doPolyBezier(ctx, points, isTo) {
  if (!points || !points.length) return;
  const devPts = points.map((p) => toDevice(ctx.state, p.x, p.y));
  devPts.forEach((p) => trackPt(ctx, p));
  let d, ctrlPts;
  if (isTo) {
    // PolyBezierTo continues from the current position (an implicit "line" relationship, not a
    // moveto). Inside an open path bracket that already has a current figure, appending our own
    // "M" here — even though it lands on the same point — starts a *new* SVG subpath; CloseFigure
    // later only closes the most recently started subpath, so the earlier part of the figure (e.g.
    // everything before a mid-bracket Polyline "bridge") never gets closed along the true boundary
    // and the fill instead auto-closes it with a straight chord, cutting a notch out of the shape.
    // Only bootstrap a moveto when this is genuinely the first thing drawn in the bracket.
    ctrlPts = devPts;
    if (ctx.inPath && ctx.pathD) {
      d = '';
    } else {
      const start = toDevice(ctx.state, ctx.state.curPos.x, ctx.state.curPos.y);
      d = `M${fmtN(start.x)},${fmtN(start.y)} `;
    }
  } else {
    d = `M${fmtN(devPts[0].x)},${fmtN(devPts[0].y)} `;
    ctrlPts = devPts.slice(1);
  }
  for (let i = 0; i + 2 < ctrlPts.length; i += 3) {
    const c1 = ctrlPts[i], c2 = ctrlPts[i + 1], p = ctrlPts[i + 2];
    d += `C${fmtN(c1.x)},${fmtN(c1.y)} ${fmtN(c2.x)},${fmtN(c2.y)} ${fmtN(p.x)},${fmtN(p.y)} `;
  }
  const last = points[points.length - 1];
  ctx.state.curPos = { x: last.x, y: last.y };
  if (ctx.inPath) { ctx.pathD += d; return; }
  flushLineBuf(ctx);
  ctx.parts.push(`<path d="${d.trim()}" fill="none"${attrStr(strokeAttrs(ctx.state))}/>`);
}
function rectPoints(rec) {
  return { left: Math.min(rec.left, rec.right), top: Math.min(rec.top, rec.bottom), right: Math.max(rec.left, rec.right), bottom: Math.max(rec.top, rec.bottom) };
}
function doRectangle(ctx, rec, rounded) {
  flushLineBuf(ctx);
  const rp = rectPoints(rec);
  const p0 = toDevice(ctx.state, rp.left, rp.top), p1 = toDevice(ctx.state, rp.right, rp.bottom);
  trackPt(ctx, p0); trackPt(ctx, p1);
  const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
  let rxa = '';
  if (rounded && rec.rw != null && rec.rh != null) {
    const zero = toDevice(ctx.state, 0, 0);
    const sx = Math.abs(toDevice(ctx.state, rec.rw, 0).x - zero.x);
    const sy = Math.abs(toDevice(ctx.state, 0, rec.rh).y - zero.y);
    rxa = ` rx="${fmtN(sx / 2)}" ry="${fmtN(sy / 2)}"`;
  }
  ctx.parts.push(`<rect x="${fmtN(x)}" y="${fmtN(y)}" width="${fmtN(w)}" height="${fmtN(h)}"${rxa}${attrStr({ ...fillAttrs(ctx.state), ...strokeAttrs(ctx.state) })}/>`);
}
function doEllipse(ctx, rec) {
  flushLineBuf(ctx);
  const rp = rectPoints(rec);
  const p0 = toDevice(ctx.state, rp.left, rp.top), p1 = toDevice(ctx.state, rp.right, rp.bottom);
  trackPt(ctx, p0); trackPt(ctx, p1);
  const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2, rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
  ctx.parts.push(`<ellipse cx="${fmtN(cx)}" cy="${fmtN(cy)}" rx="${fmtN(rx)}" ry="${fmtN(ry)}"${attrStr({ ...fillAttrs(ctx.state), ...strokeAttrs(ctx.state) })}/>`);
}
function doArcLike(ctx, rec, kind) {
  flushLineBuf(ctx);
  const rp = rectPoints(rec);
  const p0 = toDevice(ctx.state, rp.left, rp.top), p1 = toDevice(ctx.state, rp.right, rp.bottom);
  trackPt(ctx, p0); trackPt(ctx, p1);
  const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2, rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
  if (!rx || !ry) return;
  const sd = toDevice(ctx.state, rec.xStart, rec.yStart), ed = toDevice(ctx.state, rec.xEnd, rec.yEnd);
  const startAngle = Math.atan2(-(sd.y - cy) / ry, (sd.x - cx) / rx);
  const endAngle = Math.atan2(-(ed.y - cy) / ry, (ed.x - cx) / rx);
  const x1 = cx + rx * Math.cos(startAngle), y1 = cy - ry * Math.sin(startAngle);
  const x2 = cx + rx * Math.cos(endAngle), y2 = cy - ry * Math.sin(endAngle);
  let sweep = startAngle - endAngle;
  if (sweep < 0) sweep += 2 * Math.PI;
  const largeArc = sweep > Math.PI ? 1 : 0;
  let d = `M${fmtN(x1)},${fmtN(y1)} A${fmtN(rx)},${fmtN(ry)} 0 ${largeArc} 0 ${fmtN(x2)},${fmtN(y2)}`;
  if (kind === 'pie') d += ` L${fmtN(cx)},${fmtN(cy)} Z`;
  else if (kind === 'chord') d += ' Z';
  const fa = kind === 'arc' ? { fill: 'none' } : fillAttrs(ctx.state);
  ctx.parts.push(`<path d="${d}"${attrStr({ ...fa, ...strokeAttrs(ctx.state) })}/>`);
}
function doText(ctx, x, y, text) {
  if (!text) return;
  flushLineBuf(ctx);
  const d = toDevice(ctx.state, x, y);
  trackPt(ctx, d);
  const zero = toDevice(ctx.state, 0, 0);
  const heightRaw = Math.abs(ctx.state.font.height) || 12;
  const fontPx = Math.max(6, Math.abs(toDevice(ctx.state, 0, heightRaw).y - zero.y)) || 12;
  const horiz = ctx.state.textAlign & 0x06;
  const anchor = horiz === 6 ? 'middle' : (horiz === 2 ? 'end' : 'start');
  const vert = ctx.state.textAlign & 0x18; // TA_TOP=0x00, TA_BOTTOM=0x08, TA_BASELINE=0x18
  const ty = vert === 0x18 ? d.y : d.y + fontPx * 0.8; // TA_TOP/TA_BOTTOM: approximate the baseline offset
  const face = ctx.state.font.face || 'sans-serif';
  const weight = ctx.state.font.weight >= 600 ? ' font-weight="bold"' : '';
  const style = ctx.state.font.italic ? ' font-style="italic"' : '';
  const deco = ctx.state.font.underline ? ' text-decoration="underline"' : '';
  ctx.parts.push(`<text x="${fmtN(d.x)}" y="${fmtN(ty)}" font-size="${fmtN(fontPx)}" font-family="${esc(face)}" fill="${colorHex(ctx.state.textColor)}" text-anchor="${anchor}"${weight}${style}${deco}>${esc(text)}</text>`);
}
function doStretchDib(ctx, rec) {
  flushLineBuf(ctx);
  const img = decodeDIB(rec.dibBytes, 0);
  if (!img) return; // undecodable embedded bitmap (RLE, corrupt…): skip, never throw
  let png;
  try { png = encodePNG(img.width, img.height, img.rgba); } catch { return; }
  const b64 = bytesToBase64(png);
  const p0 = toDevice(ctx.state, rec.destX, rec.destY);
  const p1 = toDevice(ctx.state, rec.destX + rec.destW, rec.destY + rec.destH);
  trackPt(ctx, p0); trackPt(ctx, p1);
  const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x) || img.width, h = Math.abs(p1.y - p0.y) || img.height;
  ctx.parts.push(`<image x="${fmtN(x)}" y="${fmtN(y)}" width="${fmtN(w)}" height="${fmtN(h)}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/>`);
}
function doIntersectClipRect(ctx, rec) {
  const rp = rectPoints(rec);
  const p0 = toDevice(ctx.state, rp.left, rp.top), p1 = toDevice(ctx.state, rp.right, rp.bottom);
  trackPt(ctx, p0); trackPt(ctx, p1);
  const x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
  const id = 'c' + (ctx.nextClipId++);
  ctx.defs.push(`<clipPath id="${id}"><rect x="${fmtN(x)}" y="${fmtN(y)}" width="${fmtN(w)}" height="${fmtN(h)}"/></clipPath>`);
  ctx.parts.push(`<g clip-path="url(#${id})">`);
  ctx.totalOpenGroups++;
}
function doSaveDC(ctx) { ctx.dcStack.push({ state: cloneState(ctx.state), groupsBefore: ctx.totalOpenGroups }); }
function doRestoreDC(ctx, n) {
  const stack = ctx.dcStack;
  if (!stack.length) return;
  let targetLen;
  if (n == null || n === -1) targetLen = stack.length - 1;
  else if (n < 0) targetLen = Math.max(0, stack.length + n);
  else targetLen = Math.min(stack.length - 1, Math.max(0, n - 1));
  const popped = stack[targetLen];
  stack.length = targetLen;
  ctx.state = cloneState(popped.state);
  while (ctx.totalOpenGroups > popped.groupsBefore) { ctx.parts.push('</g>'); ctx.totalOpenGroups--; }
}
function allocIndex(ctx) { let i = 0; while (ctx.objects.has(i)) i++; return i; }
function doCreatePen(ctx, rec) {
  const idx = rec.index != null ? rec.index : allocIndex(ctx);
  ctx.objects.set(idx, { kind: 'pen', style: rec.style, width: rec.width, r: rec.color.r, g: rec.color.g, b: rec.color.b, null: (rec.style & 0xF) === 5 });
}
function doCreateBrush(ctx, rec) {
  const idx = rec.index != null ? rec.index : allocIndex(ctx);
  ctx.objects.set(idx, { kind: 'brush', style: rec.style, r: rec.color.r, g: rec.color.g, b: rec.color.b, null: rec.style === 1 });
}
function doCreateFont(ctx, rec) {
  const idx = rec.index != null ? rec.index : allocIndex(ctx);
  ctx.objects.set(idx, { kind: 'font', height: rec.height, weight: rec.weight, italic: !!rec.italic, underline: !!rec.underline, strike: !!rec.strikeOut, face: rec.faceName || '' });
}
function doSelectObject(ctx, idx) {
  const o = ctx.objects.get(idx);
  if (!o) return;
  if (o.kind === 'pen') ctx.state.pen = { style: o.style & 0xF, width: o.width, r: o.r, g: o.g, b: o.b, null: o.null };
  else if (o.kind === 'brush') ctx.state.brush = { style: o.style, r: o.r, g: o.g, b: o.b, null: o.null };
  else if (o.kind === 'font') ctx.state.font = { height: o.height, weight: o.weight, italic: o.italic, underline: o.underline, strike: o.strike, face: o.face };
}
const STOCK_BRUSHES = {
  0: { r: 255, g: 255, b: 255, style: 0 }, 1: { r: 192, g: 192, b: 192, style: 0 }, 2: { r: 128, g: 128, b: 128, style: 0 },
  3: { r: 64, g: 64, b: 64, style: 0 }, 4: { r: 0, g: 0, b: 0, style: 0 }, 5: { r: 0, g: 0, b: 0, style: 1, null: true },
};
const STOCK_PENS = {
  6: { r: 255, g: 255, b: 255, style: 0, width: 1 }, 7: { r: 0, g: 0, b: 0, style: 0, width: 1 },
  8: { r: 0, g: 0, b: 0, style: 5, width: 0, null: true },
};
function doSelectStock(ctx, stockId) {
  if (STOCK_BRUSHES[stockId]) ctx.state.brush = STOCK_BRUSHES[stockId];
  else if (STOCK_PENS[stockId]) ctx.state.pen = STOCK_PENS[stockId];
}
function applyModifyXform(ctx, rec) {
  if (rec.mode === 1) { ctx.state.xform = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 }; return; } // MWT_IDENTITY
  const cur = ctx.state.xform;
  const mul = (X, Y) => ({
    m11: X.m11 * Y.m11 + X.m12 * Y.m21, m12: X.m11 * Y.m12 + X.m12 * Y.m22,
    m21: X.m21 * Y.m11 + X.m22 * Y.m21, m22: X.m21 * Y.m12 + X.m22 * Y.m22,
    dx: X.dx * Y.m11 + X.dy * Y.m21 + Y.dx, dy: X.dx * Y.m12 + X.dy * Y.m22 + Y.dy,
  });
  ctx.state.xform = rec.mode === 3 ? mul(cur, rec) : mul(rec, cur); // 2=left-multiply, 3=right-multiply
}
function emitPath(ctx, fill, stroke) {
  if (!ctx.pathD || !ctx.pathD.trim()) { ctx.pathD = ''; return; }
  const fa = fill ? fillAttrs(ctx.state) : { fill: 'none' };
  const sa = stroke ? strokeAttrs(ctx.state) : { stroke: 'none' };
  ctx.parts.push(`<path d="${ctx.pathD.trim()}"${attrStr({ ...fa, ...sa })}/>`);
  ctx.pathD = '';
}

function applyRecord(ctx, rec) {
  switch (rec.type) {
    case 'SetWindowOrg': ctx.state.winOrg = { x: rec.x, y: rec.y }; return;
    case 'SetWindowExt': ctx.state.winExt = { x: rec.w, y: rec.h }; return;
    case 'SetViewportOrg': ctx.state.vpOrg = { x: rec.x, y: rec.y }; return;
    case 'SetViewportExt': ctx.state.vpExt = { x: rec.w, y: rec.h }; return;
    case 'SetWorldTransform': ctx.state.xform = { m11: rec.m11, m12: rec.m12, m21: rec.m21, m22: rec.m22, dx: rec.dx, dy: rec.dy }; return;
    case 'ModifyWorldTransform': applyModifyXform(ctx, rec); return;
    case 'SetTextColor': ctx.state.textColor = rec.color; return;
    case 'SetTextAlign': ctx.state.textAlign = rec.align; return;
    case 'SetPolyFillMode': ctx.state.polyFillMode = rec.mode; return;
    case 'SaveDC': doSaveDC(ctx); return;
    case 'RestoreDC': doRestoreDC(ctx, rec.dc); return;
    case 'CreatePen': doCreatePen(ctx, rec); return;
    case 'CreateBrush': doCreateBrush(ctx, rec); return;
    case 'CreateFont': doCreateFont(ctx, rec); return;
    case 'SelectObject': doSelectObject(ctx, rec.index); return;
    case 'SelectStockObject': doSelectStock(ctx, rec.stockId & 0x7fffffff); return;
    case 'DeleteObject': ctx.objects.delete(rec.index); return;
    case 'MoveTo': doMoveTo(ctx, rec.x, rec.y); return;
    case 'LineTo': doLineTo(ctx, rec.x, rec.y); return;
    case 'Polygon': doPolygon(ctx, rec.points, true); return;
    case 'Polyline': doPolygon(ctx, rec.points, false); return;
    case 'PolyPolygon': doPolyPolygon(ctx, rec.polygons); return;
    case 'PolyBezier': doPolyBezier(ctx, rec.points, false); return;
    case 'PolyBezierTo': doPolyBezier(ctx, rec.points, true); return;
    case 'Rectangle': doRectangle(ctx, rec, false); return;
    case 'RoundRect': doRectangle(ctx, rec, true); return;
    case 'Ellipse': doEllipse(ctx, rec); return;
    case 'Arc': doArcLike(ctx, rec, 'arc'); return;
    case 'Pie': doArcLike(ctx, rec, 'pie'); return;
    case 'Chord': doArcLike(ctx, rec, 'chord'); return;
    case 'TextOut': case 'ExtTextOut': doText(ctx, rec.x, rec.y, rec.text); return;
    case 'StretchDib': doStretchDib(ctx, rec); return;
    case 'IntersectClipRect': doIntersectClipRect(ctx, rec); return;
    case 'BeginPath': flushLineBuf(ctx); ctx.inPath = true; ctx.pathD = ''; return;
    case 'EndPath': ctx.inPath = false; return;
    case 'AbortPath': ctx.inPath = false; ctx.pathD = ''; return;
    case 'CloseFigure': if (ctx.inPath) ctx.pathD += 'Z '; return;
    case 'FillPath': emitPath(ctx, true, false); return;
    case 'StrokePath': emitPath(ctx, false, true); return;
    case 'StrokeAndFillPath': emitPath(ctx, true, true); return;
    case 'EmfPlusComment': (ctx.emfPlusChunks ||= []).push(rec.data); return;
    default: return; // unknown/unsupported (incl. SetMapMode, SetROP2, SetBkColor/Mode, ESCAPE…): no-op
  }
}

function computeViewBox(ctx, placeableBounds) {
  const b = ctx.bbox;
  if (isFinite(b.minX) && isFinite(b.maxX) && b.maxX >= b.minX && b.maxY >= b.minY) {
    const pad = 2;
    return { x: b.minX - pad, y: b.minY - pad, w: Math.max(1, (b.maxX - b.minX) + 2 * pad), h: Math.max(1, (b.maxY - b.minY) + 2 * pad) };
  }
  if (placeableBounds) return { x: 0, y: 0, w: Math.max(1, placeableBounds.right - placeableBounds.left), h: Math.max(1, placeableBounds.bottom - placeableBounds.top) };
  return { x: 0, y: 0, w: 100, h: 100 };
}
function assembleSvg(vb, defs, parts) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmtN(vb.x)} ${fmtN(vb.y)} ${fmtN(vb.w)} ${fmtN(vb.h)}" width="${fmtN(vb.w)}" height="${fmtN(vb.h)}">`;
  if (defs.length) svg += `<defs>${defs.join('')}</defs>`;
  svg += parts.join('');
  svg += '</svg>';
  return svg;
}

function renderToSvg(parsed) {
  if (!parsed || !parsed.ok) return null;
  const ctx = {
    state: newRenderState(), dcStack: [], objects: new Map(), parts: [], defs: [],
    lineBuf: null, inPath: false, pathD: '', totalOpenGroups: 0, nextClipId: 0,
    bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };
  if (parsed.placeableBounds) {
    const pb = parsed.placeableBounds;
    const w = Math.max(1, pb.right - pb.left), h = Math.max(1, pb.bottom - pb.top);
    ctx.state.winExt = { x: w, y: h }; ctx.state.vpExt = { x: w, y: h };
    ctx.state.winOrg = { x: pb.left, y: pb.top };
  }
  for (const rec of parsed.records) {
    try { applyRecord(ctx, rec); } catch { /* one bad record never aborts the picture */ }
  }
  flushLineBuf(ctx);
  ctx.pathD = ''; // an unterminated path bracket at EOF: drop rather than guess at it
  // EMF+: only attempted when the file had no usable GDI ("dual-mode") drawing to fall back
  // to, per [MS-EMFPLUS]'s own recommendation.
  if (!parsed.hasGdiDrawing && ctx.emfPlusChunks && ctx.emfPlusChunks.length) {
    try { renderEmfPlus(ctx, ctx.emfPlusChunks); } catch { /* best-effort only */ }
  }
  while (ctx.totalOpenGroups > 0) { ctx.parts.push('</g>'); ctx.totalOpenGroups--; }
  if (!ctx.parts.length && !ctx.defs.length) return null; // nothing drawable: let the caller fall back
  return assembleSvg(computeViewBox(ctx, parsed.placeableBounds), ctx.defs, ctx.parts);
}

// ============================================================================================
// Minimal EMF+ (EMR_COMMENT "EMF+" record streams): solid-colour rects/ellipses/lines and a
// world-transform save/restore stack — the common content in charts/diagrams pasted as
// pictures. Paths, gradients, images and text inside an EMF+-only stream are not rendered
// (best effort, per this module's scope); every record is skipped by its own declared size on
// anything unrecognised, so this can never desync or throw.
// ============================================================================================

const EMFPLUS = {
  Object: 0x4008, FillRects: 0x400A, DrawRects: 0x400B, FillEllipse: 0x400E, DrawEllipse: 0x400F,
  DrawLines: 0x400D, Save: 0x4020, Restore: 0x4021, SetWorldTransform: 0x4025, ResetWorldTransform: 0x4026,
};
function argbToHex(argb) {
  const r = (argb >>> 16) & 0xFF, g = (argb >>> 8) & 0xFF, b = argb & 0xFF;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function renderEmfPlus(ctx, chunks) {
  const data = concatBytes(chunks);
  const r = makeReader(data);
  const objects = new Map();
  let xform = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };
  const stack = [];
  const tf = (x, y) => ({ x: x * xform.m11 + y * xform.m21 + xform.dx, y: x * xform.m12 + y * xform.m22 + xform.dy });
  const objColor = (idx) => { const o = objects.get(idx); return o ? argbToHex(o.argb) : '#000000'; };
  let offset = 0, safety = 0;
  while (offset + 12 <= data.length && safety < 50000) {
    safety++;
    let type, flags, size;
    try { type = r.u16(offset); flags = r.u16(offset + 2); size = r.u32(offset + 4); } catch { break; }
    if (size < 12 || offset + size > data.length) break;
    const off = offset + 12, len = size - 12;
    try {
      switch (type) {
        case EMFPLUS.Object: {
          const objType = (flags >> 8) & 0xFF, idx = flags & 0xFF; // 1=Brush,2=Pen
          if (objType === 1 && len >= 8 && r.u32(off + 4) === 0) objects.set(idx, { argb: r.u32(off + 8) }); // SolidColor brush
          else if (objType === 2 && len >= 20) {
            const penDataFlags = r.u32(off + 8);
            let argb = 0xFF000000;
            if (penDataFlags === 0 && len >= 32 && r.u32(off + 24) === 0) argb = r.u32(off + 28); // embedded solid-colour brush
            objects.set(idx, { argb });
          }
          break;
        }
        case EMFPLUS.FillRects: case EMFPLUS.DrawRects: {
          let p = off, colorHexStr;
          if (flags & 0x8000) { colorHexStr = argbToHex(r.u32(p)); p += 4; } else { colorHexStr = objColor(r.u32(p)); p += 4; }
          const count = Math.min(r.u32(p), 2000); p += 4;
          for (let i = 0; i < count; i++) {
            const x = r.f32(p), y = r.f32(p + 4), w = r.f32(p + 8), h = r.f32(p + 12); p += 16;
            const c0 = tf(x, y), c1 = tf(x + w, y + h);
            trackPt(ctx, c0); trackPt(ctx, c1);
            const rx = Math.min(c0.x, c1.x), ry = Math.min(c0.y, c1.y), rw = Math.abs(c1.x - c0.x), rh = Math.abs(c1.y - c0.y);
            ctx.parts.push(type === EMFPLUS.FillRects
              ? `<rect x="${fmtN(rx)}" y="${fmtN(ry)}" width="${fmtN(rw)}" height="${fmtN(rh)}" fill="${colorHexStr}"/>`
              : `<rect x="${fmtN(rx)}" y="${fmtN(ry)}" width="${fmtN(rw)}" height="${fmtN(rh)}" fill="none" stroke="${colorHexStr}" stroke-width="1"/>`);
          }
          break;
        }
        case EMFPLUS.FillEllipse: case EMFPLUS.DrawEllipse: {
          let p = off, colorHexStr;
          if (flags & 0x8000) { colorHexStr = argbToHex(r.u32(p)); p += 4; } else { colorHexStr = objColor(r.u32(p)); p += 4; }
          const x = r.f32(p), y = r.f32(p + 4), w = r.f32(p + 8), h = r.f32(p + 12);
          const c0 = tf(x, y), c1 = tf(x + w, y + h);
          trackPt(ctx, c0); trackPt(ctx, c1);
          const cx = (c0.x + c1.x) / 2, cy = (c0.y + c1.y) / 2, rx = Math.abs(c1.x - c0.x) / 2, ry = Math.abs(c1.y - c0.y) / 2;
          ctx.parts.push(type === EMFPLUS.FillEllipse
            ? `<ellipse cx="${fmtN(cx)}" cy="${fmtN(cy)}" rx="${fmtN(rx)}" ry="${fmtN(ry)}" fill="${colorHexStr}"/>`
            : `<ellipse cx="${fmtN(cx)}" cy="${fmtN(cy)}" rx="${fmtN(rx)}" ry="${fmtN(ry)}" fill="none" stroke="${colorHexStr}" stroke-width="1"/>`);
          break;
        }
        case EMFPLUS.DrawLines: {
          let p = off;
          const colorHexStr = objColor(r.u32(p)); p += 4;
          const count = Math.min(r.u32(p), 4000); p += 4;
          const pts = [];
          for (let i = 0; i < count; i++) { pts.push(tf(r.f32(p), r.f32(p + 4))); p += 8; }
          pts.forEach((pt) => trackPt(ctx, pt));
          if (pts.length > 1) ctx.parts.push(`<polyline points="${pts.map((pt) => `${fmtN(pt.x)},${fmtN(pt.y)}`).join(' ')}" fill="none" stroke="${colorHexStr}" stroke-width="1"/>`);
          break;
        }
        case EMFPLUS.SetWorldTransform: xform = { m11: r.f32(off), m12: r.f32(off + 4), m21: r.f32(off + 8), m22: r.f32(off + 12), dx: r.f32(off + 16), dy: r.f32(off + 20) }; break;
        case EMFPLUS.ResetWorldTransform: xform = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 }; break;
        case EMFPLUS.Save: stack.push(xform); break;
        case EMFPLUS.Restore: if (stack.length) xform = stack.pop(); break;
        default: break; // paths, images, gradients, text, clipping…: out of this minimal reader's scope
      }
    } catch { /* skip this EMF+ record, keep going */ }
    offset += size;
  }
}

// ============================================================================================
// WMF ([MS-WMF]) parser
// ============================================================================================

function wmfColor(r, off) { const v = r.u32(off); return { r: v & 0xFF, g: (v >>> 8) & 0xFF, b: (v >>> 16) & 0xFF }; }
function wmfPoints(r, off, n) {
  const pts = [], max = Math.min(Math.max(n, 0), 20000);
  for (let i = 0; i < max; i++) pts.push({ x: r.i16(off + 2 + i * 4), y: r.i16(off + 4 + i * 4) });
  return pts;
}
function parseWmfPolyPolygon(r, off) {
  const nPoly = r.u16(off);
  const counts = [];
  for (let i = 0; i < nPoly; i++) counts.push(r.u16(off + 2 + i * 2));
  let p = off + 2 + nPoly * 2;
  const polygons = [];
  for (const c of counts) { const pts = []; for (let i = 0; i < c; i++) { pts.push({ x: r.i16(p), y: r.i16(p + 2) }); p += 4; } polygons.push(pts); }
  return { type: 'PolyPolygon', polygons };
}
function parseWmfFont(r, off, paramBytes) {
  const rec = {
    type: 'CreateFont', index: null,
    height: r.i16(off), width: r.i16(off + 2), escapement: r.i16(off + 4), orientation: r.i16(off + 6),
    weight: r.i16(off + 8), italic: r.u8(off + 10), underline: r.u8(off + 11), strikeOut: r.u8(off + 12), charset: r.u8(off + 13),
  };
  let name = '';
  for (let i = 18; i < paramBytes; i++) { const b = r.u8(off + i); if (!b) break; name += String.fromCharCode(b); }
  rec.faceName = name;
  return rec;
}
function parseWmfArc(r, off, kind) {
  return { type: kind, yEnd: r.i16(off), xEnd: r.i16(off + 2), yStart: r.i16(off + 4), xStart: r.i16(off + 6), bottom: r.i16(off + 8), right: r.i16(off + 10), top: r.i16(off + 12), left: r.i16(off + 14) };
}
function parseWmfTextOut(r, off) {
  const len = r.i16(off);
  if (len <= 0 || len > 8000) return null;
  let text = '';
  for (let i = 0; i < len; i++) text += String.fromCharCode(r.u8(off + 2 + i));
  const padLen = len + (len % 2);
  return { type: 'TextOut', y: r.i16(off + 2 + padLen), x: r.i16(off + 4 + padLen), text };
}
function parseWmfExtTextOut(r, off) {
  const y = r.i16(off), x = r.i16(off + 2), len = r.i16(off + 4), opts = r.u16(off + 6);
  if (len <= 0 || len > 8000) return null;
  let strOff = off + 8;
  if (opts & 0x0006) strOff += 8; // ETO_OPAQUE | ETO_CLIPPED: a Rectangle(8) precedes the string
  let text = '';
  for (let i = 0; i < len; i++) text += String.fromCharCode(r.u8(strOff + i));
  return { type: 'ExtTextOut', x, y, text };
}
function parseWmfStretchDib(r, bytes, off, paramBytes, hasColorUsage) {
  let p = off + 4; // RasterOperation
  if (hasColorUsage) p += 2;
  if (p + 16 > off + paramBytes) return null;
  const destH = r.i16(p + 8), destW = r.i16(p + 10), yDest = r.i16(p + 12), xDest = r.i16(p + 14);
  const dibStart = p + 16, dibEnd = off + paramBytes;
  if (dibStart >= dibEnd) return null;
  return { type: 'StretchDib', destX: xDest, destY: yDest, destW, destH, dibBytes: bytes.subarray(dibStart, dibEnd) };
}
function parseWmfRecord(r, bytes, off, sizeWords, func) {
  const p = off + 6;
  const paramBytes = sizeWords * 2 - 6;
  switch (func) {
    case 0x0106: return { type: 'SetPolyFillMode', mode: r.u16(p) };
    case 0x0209: return { type: 'SetTextColor', color: wmfColor(r, p) };
    case 0x012E: return { type: 'SetTextAlign', align: r.u16(p) };
    case 0x020B: return { type: 'SetWindowOrg', y: r.i16(p), x: r.i16(p + 2) };
    case 0x020C: return { type: 'SetWindowExt', h: r.i16(p), w: r.i16(p + 2) };
    case 0x020D: return { type: 'SetViewportOrg', y: r.i16(p), x: r.i16(p + 2) };
    case 0x020E: return { type: 'SetViewportExt', h: r.i16(p), w: r.i16(p + 2) };
    case 0x0214: return { type: 'MoveTo', y: r.i16(p), x: r.i16(p + 2) };
    case 0x0213: return { type: 'LineTo', y: r.i16(p), x: r.i16(p + 2) };
    case 0x001E: return { type: 'SaveDC' };
    case 0x0127: return { type: 'RestoreDC', dc: r.i16(p) };
    case 0x02FA: return { type: 'CreatePen', index: null, style: r.u16(p), width: r.i16(p + 2), color: wmfColor(r, p + 6) };
    case 0x02FC: return { type: 'CreateBrush', index: null, style: r.u16(p), color: wmfColor(r, p + 2), hatch: r.u16(p + 6) };
    case 0x02FB: return parseWmfFont(r, p, paramBytes);
    case 0x012D: return { type: 'SelectObject', index: r.u16(p) };
    case 0x01F0: return { type: 'DeleteObject', index: r.u16(p) };
    case 0x0324: return { type: 'Polygon', points: wmfPoints(r, p, r.i16(p)) };
    case 0x0325: return { type: 'Polyline', points: wmfPoints(r, p, r.i16(p)) };
    case 0x0538: return parseWmfPolyPolygon(r, p);
    case 0x041B: return { type: 'Rectangle', bottom: r.i16(p), right: r.i16(p + 2), top: r.i16(p + 4), left: r.i16(p + 6) };
    case 0x0418: return { type: 'Ellipse', bottom: r.i16(p), right: r.i16(p + 2), top: r.i16(p + 4), left: r.i16(p + 6) };
    case 0x061C: return { type: 'RoundRect', rh: r.i16(p), rw: r.i16(p + 2), bottom: r.i16(p + 4), right: r.i16(p + 6), top: r.i16(p + 8), left: r.i16(p + 10) };
    case 0x0817: return parseWmfArc(r, p, 'Arc');
    case 0x081A: return parseWmfArc(r, p, 'Pie');
    case 0x0830: return parseWmfArc(r, p, 'Chord');
    case 0x0521: return parseWmfTextOut(r, p);
    case 0x0A32: return parseWmfExtTextOut(r, p);
    case 0x0F43: return parseWmfStretchDib(r, bytes, p, paramBytes, true);
    case 0x0B41: return parseWmfStretchDib(r, bytes, p, paramBytes, false);
    case 0x0416: return { type: 'IntersectClipRect', bottom: r.i16(p), right: r.i16(p + 2), top: r.i16(p + 4), left: r.i16(p + 6) };
    default: return null; // incl. SetMapMode/SetBkMode/SetROP2/SetBkColor/ESCAPE/EOF: no-op
  }
}

function parseWMF(bytes) {
  if (bytes.length < 18) return { ok: false };
  const r = makeReader(bytes);
  let offset = 0, placeableBounds = null;
  if (bytes.length >= 22 && r.u32(0) === 0x9AC6CDD7) {
    placeableBounds = { left: r.i16(6), top: r.i16(8), right: r.i16(10), bottom: r.i16(12) };
    offset = 22;
  }
  if (offset + 18 > bytes.length) return { ok: false };
  const headerSize = r.u16(offset + 2);
  if (headerSize !== 9) return { ok: false }; // the standard WMF header is always 9 WORDs
  offset += headerSize * 2;
  const records = [];
  let safety = 0;
  while (offset + 6 <= bytes.length && safety < 200000) {
    safety++;
    const recOff = offset;
    let recSizeWords, func;
    try { recSizeWords = r.u32(recOff); func = r.u16(recOff + 4); } catch { break; }
    if (recSizeWords < 3) break;
    const recEnd = recOff + recSizeWords * 2;
    if (recEnd > bytes.length) break; // truncated final record: stop, keep what parsed so far
    try {
      const rec = parseWmfRecord(r, bytes, recOff, recSizeWords, func);
      if (rec) records.push(rec);
    } catch { /* skip this record */ }
    if (func === 0x0000) break; // META_EOF
    offset = recEnd;
  }
  return { ok: true, placeableBounds, records, hasGdiDrawing: true };
}

// ============================================================================================
// EMF ([MS-EMF]) parser
// ============================================================================================

function emfColor(r, off) { const v = r.u32(off); return { r: v & 0xFF, g: (v >>> 8) & 0xFF, b: (v >>> 16) & 0xFF }; }
function emfWorldTransform(r, d, kind) {
  const rec = { type: kind, m11: r.f32(d), m12: r.f32(d + 4), m21: r.f32(d + 8), m22: r.f32(d + 12), dx: r.f32(d + 16), dy: r.f32(d + 20) };
  if (kind === 'ModifyWorldTransform') rec.mode = r.u32(d + 24);
  return rec;
}
function parseEmfExtCreatePen(r, d) {
  return { type: 'CreatePen', index: r.u32(d), style: r.u32(d + 20), width: r.i32(d + 24), color: emfColor(r, d + 32) };
}
function parseEmfFont(r, d, byteLen) {
  const ih = r.u32(d), height = r.i32(d + 4), weight = r.i32(d + 20);
  const italic = r.u8(d + 24), underline = r.u8(d + 25), strikeOut = r.u8(d + 26);
  let name = '';
  const nameOff = d + 32; // right after LOGFONTW's fixed 28 bytes (from d+4) — see header notes
  for (let i = 0; i < 32; i++) {
    const charOff = nameOff + i * 2;
    if (charOff + 1 >= byteLen) break;
    const ch = r.u16(charOff);
    if (!ch) break;
    name += String.fromCharCode(ch);
  }
  return { type: 'CreateFont', index: ih, height, weight, italic, underline, strikeOut, faceName: name };
}
function emfPoly32(r, d, kind) {
  const count = Math.min(r.u32(d + 16), 20000), pts = [], p = d + 20;
  for (let i = 0; i < count; i++) pts.push({ x: r.i32(p + i * 8), y: r.i32(p + i * 8 + 4) });
  return { type: kind, points: pts };
}
function emfPoly16(r, d, kind) {
  const count = Math.min(r.u32(d + 16), 20000), pts = [], p = d + 20;
  for (let i = 0; i < count; i++) pts.push({ x: r.i16(p + i * 4), y: r.i16(p + i * 4 + 2) });
  return { type: kind, points: pts };
}
function emfPolyPolyN(r, d, kind, wide) {
  const nP = r.u32(d + 16), counts = [];
  for (let i = 0; i < nP; i++) counts.push(r.u32(d + 24 + i * 4));
  let p = d + 24 + nP * 4;
  const step = wide ? 8 : 4;
  const readPt = wide ? (o) => ({ x: r.i32(o), y: r.i32(o + 4) }) : (o) => ({ x: r.i16(o), y: r.i16(o + 2) });
  if (kind === 'Polygon') {
    const polygons = [];
    for (const c of counts) { const pts = []; for (let i = 0; i < c; i++) { pts.push(readPt(p)); p += step; } polygons.push(pts); }
    return { type: 'PolyPolygon', polygons };
  }
  const out = [];
  for (const c of counts) { const pts = []; for (let i = 0; i < c; i++) { pts.push(readPt(p)); p += step; } out.push({ type: 'Polyline', points: pts }); }
  return out;
}
function parseEmfExtTextOut(r, bytes, recOff, d, isWide) {
  const x = r.i32(d + 28), y = r.i32(d + 32), nChars = r.u32(d + 36), offString = r.u32(d + 40);
  if (!nChars || nChars > 8000) return null;
  const strStart = recOff + offString;
  let text = '';
  if (isWide) { for (let i = 0; i < nChars; i++) { const o = strStart + i * 2; if (o + 1 >= bytes.length) break; text += String.fromCharCode(r.u16(o)); } }
  else { for (let i = 0; i < nChars; i++) { const o = strStart + i; if (o >= bytes.length) break; text += String.fromCharCode(r.u8(o)); } }
  return { type: 'ExtTextOut', x, y, text };
}
function parseEmfStretchDibits(r, bytes, recOff, d) {
  const xDest = r.i32(d + 16), yDest = r.i32(d + 20);
  const offBmiSrc = r.u32(d + 40), cbBmiSrc = r.u32(d + 44), offBitsSrc = r.u32(d + 48), cbBitsSrc = r.u32(d + 52);
  const cxDest = r.i32(d + 64), cyDest = r.i32(d + 68);
  if (!cbBmiSrc || !cbBitsSrc) return null;
  const bmiStart = recOff + offBmiSrc, bitsStart = recOff + offBitsSrc;
  if (bmiStart + cbBmiSrc > bytes.length || bitsStart + cbBitsSrc > bytes.length) return null;
  return { type: 'StretchDib', destX: xDest, destY: yDest, destW: cxDest, destH: cyDest, dibBytes: concatBytes([bytes.subarray(bmiStart, bmiStart + cbBmiSrc), bytes.subarray(bitsStart, bitsStart + cbBitsSrc)]) };
}
function parseEmfBitBlt(r, bytes, recOff, d) {
  const xDest = r.i32(d + 16), yDest = r.i32(d + 20), cxDest = r.i32(d + 24), cyDest = r.i32(d + 28);
  const offBmiSrc = r.u32(d + 76), cbBmiSrc = r.u32(d + 80), offBitsSrc = r.u32(d + 84), cbBitsSrc = r.u32(d + 88);
  if (!cbBmiSrc || !cbBitsSrc) return null; // a solid-fill BLT (PATCOPY etc, no source bitmap): out of scope
  const bmiStart = recOff + offBmiSrc, bitsStart = recOff + offBitsSrc;
  if (bmiStart + cbBmiSrc > bytes.length || bitsStart + cbBitsSrc > bytes.length) return null;
  return { type: 'StretchDib', destX: xDest, destY: yDest, destW: cxDest, destH: cyDest, dibBytes: concatBytes([bytes.subarray(bmiStart, bmiStart + cbBmiSrc), bytes.subarray(bitsStart, bitsStart + cbBitsSrc)]) };
}
function parseEmfComment(r, bytes, d) {
  const dataSize = r.u32(d), dataOff = d + 4;
  if (dataSize < 4 || dataOff + dataSize > bytes.length) return null;
  let commentId;
  try { commentId = r.u32(dataOff); } catch { return null; }
  if (commentId === 0x2B464D45) return { type: 'EmfPlusComment', data: bytes.subarray(dataOff + 4, dataOff + dataSize) }; // 'EMF+'
  return null;
}
const EMF_DRAWING_TYPES = new Set(['Polygon', 'Polyline', 'PolyPolygon', 'PolyBezier', 'PolyBezierTo', 'Rectangle', 'RoundRect', 'Ellipse', 'Arc', 'Pie', 'Chord', 'TextOut', 'ExtTextOut', 'StretchDib', 'LineTo']);

function parseEmfRecord(r, bytes, off, type, size) {
  const d = off + 8;
  switch (type) {
    case 9: return { type: 'SetWindowExt', w: r.i32(d), h: r.i32(d + 4) };
    case 10: return { type: 'SetWindowOrg', x: r.i32(d), y: r.i32(d + 4) };
    case 11: return { type: 'SetViewportExt', w: r.i32(d), h: r.i32(d + 4) };
    case 12: return { type: 'SetViewportOrg', x: r.i32(d), y: r.i32(d + 4) };
    case 19: return { type: 'SetPolyFillMode', mode: r.u32(d) };
    case 22: return { type: 'SetTextAlign', align: r.u32(d) };
    case 24: return { type: 'SetTextColor', color: emfColor(r, d) };
    case 27: return { type: 'MoveTo', x: r.i32(d), y: r.i32(d + 4) };
    case 30: return { type: 'IntersectClipRect', left: r.i32(d), top: r.i32(d + 4), right: r.i32(d + 8), bottom: r.i32(d + 12) };
    case 33: return { type: 'SaveDC' };
    case 34: return { type: 'RestoreDC', dc: r.i32(d) };
    case 35: return emfWorldTransform(r, d, 'SetWorldTransform');
    case 36: return emfWorldTransform(r, d, 'ModifyWorldTransform');
    case 37: { const ih = r.u32(d); return (ih & 0x80000000) !== 0 ? { type: 'SelectStockObject', stockId: ih } : { type: 'SelectObject', index: ih }; }
    case 38: return { type: 'CreatePen', index: r.u32(d), style: r.u32(d + 4), width: r.i32(d + 8), color: emfColor(r, d + 16) };
    case 39: return { type: 'CreateBrush', index: r.u32(d), style: r.u32(d + 4), color: emfColor(r, d + 8), hatch: r.u32(d + 12) };
    case 95: return parseEmfExtCreatePen(r, d);
    case 40: return { type: 'DeleteObject', index: r.u32(d) };
    case 82: return parseEmfFont(r, d, bytes.length);
    case 42: return { type: 'Ellipse', left: r.i32(d), top: r.i32(d + 4), right: r.i32(d + 8), bottom: r.i32(d + 12) };
    case 43: return { type: 'Rectangle', left: r.i32(d), top: r.i32(d + 4), right: r.i32(d + 8), bottom: r.i32(d + 12) };
    case 44: return { type: 'RoundRect', left: r.i32(d), top: r.i32(d + 4), right: r.i32(d + 8), bottom: r.i32(d + 12), rw: r.i32(d + 16), rh: r.i32(d + 20) };
    case 54: return { type: 'LineTo', x: r.i32(d), y: r.i32(d + 4) };
    case 2: return emfPoly32(r, d, 'PolyBezier');
    case 3: return emfPoly32(r, d, 'Polygon');
    case 4: return emfPoly32(r, d, 'Polyline');
    case 5: return emfPoly32(r, d, 'PolyBezierTo');
    case 6: return emfPoly32(r, d, 'Polyline'); // PolylineTo: approximated as a plain polyline
    case 7: return emfPolyPolyN(r, d, 'Polyline', true);
    case 8: return emfPolyPolyN(r, d, 'Polygon', true);
    case 85: return emfPoly16(r, d, 'PolyBezier');
    case 86: return emfPoly16(r, d, 'Polygon');
    case 87: return emfPoly16(r, d, 'Polyline');
    case 88: return emfPoly16(r, d, 'PolyBezierTo');
    case 89: return emfPoly16(r, d, 'Polyline');
    case 90: return emfPolyPolyN(r, d, 'Polyline', false);
    case 91: return emfPolyPolyN(r, d, 'Polygon', false);
    case 59: return { type: 'BeginPath' };
    case 60: return { type: 'EndPath' };
    case 61: return { type: 'CloseFigure' };
    case 62: return { type: 'FillPath' };
    case 63: return { type: 'StrokeAndFillPath' };
    case 64: return { type: 'StrokePath' };
    case 68: return { type: 'AbortPath' };
    case 76: return parseEmfBitBlt(r, bytes, off, d);
    case 81: return parseEmfStretchDibits(r, bytes, off, d);
    case 83: return parseEmfExtTextOut(r, bytes, off, d, false);
    case 84: return parseEmfExtTextOut(r, bytes, off, d, true);
    case 70: return parseEmfComment(r, bytes, d);
    default: return null; // incl. SetMapMode/SetBkMode/SetROP2/SetBkColor/clip-region records/HEADER/EOF
  }
}

function parseEMF(bytes) {
  if (bytes.length < 88) return { ok: false };
  const r = makeReader(bytes);
  if (r.u32(0) !== 1) return { ok: false }; // EMR_HEADER
  const headerSize = r.u32(4);
  if (headerSize < 88 || headerSize > bytes.length) return { ok: false };
  if (r.u32(40) !== 0x464D4520) return { ok: false }; // 'EMF ' signature
  const placeableBounds = { left: r.i32(8), top: r.i32(12), right: r.i32(16), bottom: r.i32(20) };
  let offset = headerSize;
  const records = [];
  let hasGdiDrawing = false;
  let safety = 0;
  while (offset + 8 <= bytes.length && safety < 300000) {
    safety++;
    const recOff = offset;
    let recType, recSize;
    try { recType = r.u32(recOff); recSize = r.u32(recOff + 4); } catch { break; }
    if (recSize < 8 || recOff + recSize > bytes.length) break;
    try {
      const rec = parseEmfRecord(r, bytes, recOff, recType, recSize);
      if (rec) { records.push(rec); if (EMF_DRAWING_TYPES.has(rec.type)) hasGdiDrawing = true; }
    } catch { /* skip this record */ }
    if (recType === 14) break; // EMR_EOF
    offset = recOff + recSize;
  }
  return { ok: true, placeableBounds, records, hasGdiDrawing };
}

// ============================================================================================
// Public API
// ============================================================================================

function toU8(bytes) { return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); }

/** WMF (placeable or standard) bytes -> an SVG string, or null (malformed / nothing drawable). */
export function wmfToSvg(bytes) {
  try { return renderToSvg(parseWMF(toU8(bytes))); } catch { return null; }
}
/** EMF bytes -> an SVG string, or null (malformed / nothing drawable). */
export function emfToSvg(bytes) {
  try { return renderToSvg(parseEMF(toU8(bytes))); } catch { return null; }
}
/** Autodetects WMF vs EMF (by the EMF header's own type+signature) and converts to SVG. */
export function metafileToSvg(bytes) {
  const u8 = toU8(bytes);
  if (u8.length >= 44) {
    try {
      const r = makeReader(u8);
      if (r.u32(0) === 1 && r.u32(40) === 0x464D4520) return emfToSvg(u8);
    } catch { /* fall through to WMF */ }
  }
  return wmfToSvg(u8);
}
/** A {path, mime:'image/svg+xml', bytes} resource, the same shape as a parsed PNG/JPEG. */
export function metafileToResource(bytes, path) {
  const svg = metafileToSvg(bytes);
  if (!svg) return null;
  return { path, mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg) };
}
