// Word 97–2003 binary .doc — pictures, drawn shapes, text boxes and embedded OLE objects.
//
//   * An inline picture is the character 0x01 whose sprmCPicLocation points at a PICF in the
//     Data stream ([MS-DOC] 2.9.192 PICFAndOfficeArtData); since Word 97 the PICF is followed
//     by an OfficeArt shape container and the picture itself as an OfficeArtFBSE + BLIP
//     ([MS-ODRAW] 2.2.32 / 2.2.23).
//   * A floating picture or text box is the character 0x08 at a CP listed in PlcSpaMom
//     (FSPA: the shape id), with the shape in the drawing group at fcDggInfo (OfficeArtContent)
//     and its picture in the drawing group's BStore — embedded, or in the WordDocument stream
//     at FBSE.foDelay.
//   * A text box's text lives in the text-box subdocument; PlcftxbxTxt gives each box's CP
//     range and the shape it belongs to (FTXBXS.lid, else the shape's lTxid).
//   * An embedded object (0x01 with sprmCFOle2) is the ObjectPool storage "_<picLocation>".
//
// Pictures come back as { src: '', alt, _res: { path, mime, bytes | Promise<bytes> } }; doc.mjs
// moves `_res` into model.resources exactly as parseDocx does for word/media/*.

import { reader, readPlc, decodeUtf16 } from './doc-fib.mjs';

const REC = { DggContainer: 0xF000, BStoreContainer: 0xF001, DgContainer: 0xF002, SpgrContainer: 0xF003, SpContainer: 0xF004,
  FBSE: 0xF007, FSP: 0xF00A, FOPT: 0xF00B, SecondaryFOPT: 0xF121, TertiaryFOPT: 0xF122 };
const BLIP = { 0xF01A: 'emf', 0xF01B: 'wmf', 0xF01C: 'pict', 0xF01D: 'jpg', 0xF01E: 'png', 0xF01F: 'dib', 0xF029: 'tiff', 0xF02A: 'jpg' };

function recHeader(u8, o) {
  if (o + 8 > u8.length) return null;
  const verInst = u8[o] | (u8[o + 1] << 8);
  return { ver: verInst & 0x0F, inst: verInst >> 4, type: u8[o + 2] | (u8[o + 3] << 8), len: (u8[o + 4] | (u8[o + 5] << 8) | (u8[o + 6] << 16) | (u8[o + 7] << 24)) >>> 0, off: o, body: o + 8 };
}
// Walk records in [start, end), descending into containers (ver 0xF); fn(rec) may return
// false to skip a container's children.
function walkRecords(u8, start, end, fn, depth = 0) {
  let o = start;
  while (o + 8 <= end) {
    const h = recHeader(u8, o);
    if (!h) break;
    const recEnd = Math.min(end, h.body + h.len);
    const descend = fn(h, recEnd);
    if (h.ver === 0xF && descend !== false && depth < 32) walkRecords(u8, h.body, recEnd, fn, depth + 1);
    o = h.body + h.len;
    if (h.len === 0 && h.ver !== 0xF) continue;
  }
}

// OfficeArtFOPT properties → { pib, txid, pictureId, name, description }
function readFopt(u8, h, recEnd, into) {
  const n = h.inst;
  let complexAt = h.body + n * 6;
  for (let i = 0; i < n; i++) {
    const o = h.body + i * 6;
    if (o + 6 > recEnd) break;
    const opid = u8[o] | (u8[o + 1] << 8);
    const pid = opid & 0x3FFF, fComplex = !!(opid & 0x8000);
    const op = (u8[o + 2] | (u8[o + 3] << 8) | (u8[o + 4] << 16) | (u8[o + 5] << 24)) >>> 0;
    let complex = null;
    if (fComplex) { complex = u8.subarray(complexAt, Math.min(recEnd, complexAt + op)); complexAt += op; }
    if (pid === 0x0104) into.pib = op;                          // pib: BStore index (1-based)
    else if (pid === 0x0080) into.txid = op;                    // lTxid
    else if (pid === 0x010B) into.pictureId = op;               // pictureId: an OLE shape's object (doc.mjs floatingOle)
    else if (pid === 0x0380 && complex) into.name = cleanStr(decodeUtf16(complex));
    else if (pid === 0x0381 && complex) into.description = cleanStr(decodeUtf16(complex));
    // K7/BANA §7 (box/sidebar detection, parse.mjs's docxTxbxBoxInfo): a shape's fill/line
    // colour and "is it actually drawn" flag, read the same conservative way as the .docx
    // reader's DrawingML/VML check — an EXPLICIT positive signal only. [MS-ODRAW] 2.3.4/2.3.7:
    // fillColor (0x0181) and lineColor (0x01C0) are each an MSOCOLORREF (low 3 bytes RGB, high
    // byte a flag — 0 for a literal RGB, nonzero for a scheme/system colour index, which is
    // deliberately not resolved to a literal colour here, same as parse.mjs leaving an
    // unresolved `a:schemeClr` box uncoloured); "fFilled"/"fLine" are single bits (0x10 in the
    // Fill group's boolean properties, 0x08 in the Line group's) inside the LAST property of
    // each 64-slot property group (0x01BF, 0x01FF) — packed as (usageMask << 16 | value), so a
    // bit only means something when its OWN bit is set in the usage mask too (confirmed against
    // this repo's own lo-textbox.doc fixture: LibreOffice writes 0x01BF=0x00100010 — mask and
    // value both have bit 4 set — for its default text box's explicit white fill, and
    // 0x01FF=0x0008000E — mask bit 3 set, value bit 3 set — for its explicit black border).
    else if (pid === 0x0181) into._fillColor = op;
    else if (pid === 0x01BF) into._fillBool = op;
    else if (pid === 0x01C0) into._lineColor = op;
    else if (pid === 0x01FF) into._lineBool = op;
  }
}
const cleanStr = (s) => s.replace(/\0[\s\S]*$/, '').replace(/\s+/g, ' ').trim();

// A BLIP record → { ext, bytes | Promise<bytes> } (metafiles are usually deflate-compressed).
function readBlip(u8, h) {
  const ext = BLIP[h.type];
  if (!ext) return null;
  const twoUids = (h.inst & 1) === 1;
  let o = h.body + 16 + (twoUids ? 16 : 0);
  const end = Math.min(u8.length, h.body + h.len);
  if (ext === 'emf' || ext === 'wmf' || ext === 'pict') {
    if (o + 34 > end) return null;
    const cbSize = (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
    const rd32 = (q) => (u8[q] | (u8[q + 1] << 8) | (u8[q + 2] << 16) | (u8[q + 3] << 24));
    const rc = [rd32(o + 4), rd32(o + 8), rd32(o + 12), rd32(o + 16)];
    const compression = u8[o + 32];
    const data = u8.slice(o + 34, end);
    const raw = compression === 0 ? inflate(data, cbSize) : Promise.resolve(data);
    // A WMF blip is stored without its placeable header (the OfficeArt metafile header
    // carries the bounds instead); put one back so converters see a normal .wmf file.
    return { ext, bytes: ext === 'wmf' ? raw.then((b) => (b ? wmfWithHeader(b, rc[2] - rc[0], rc[3] - rc[1], rc) : b)) : raw };
  }
  o += 1;                                                        // tag
  const data = u8.slice(o, end);
  if (ext === 'dib') return { ext: 'dib', bytes: data };
  if (ext === 'jpg' && data[0] === 0x89 && data[1] === 0x50) return { ext: 'png', bytes: data };   // mislabelled
  return { ext, bytes: data };
}

async function inflate(data, expected) {
  try {
    const ds = new DecompressionStream('deflate');
    const out = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
    return expected && out.length > expected ? out.subarray(0, expected) : out;
  } catch {
    try {
      const ds = new DecompressionStream('deflate-raw');
      return new Uint8Array(await new Response(new Blob([data.subarray(2)]).stream().pipeThrough(ds)).arrayBuffer());
    } catch { return null; }
  }
}

// FBSE → { blip } from its embedded BLIP or the delay stream (the WordDocument stream).
function readFbse(u8, h, delay) {
  if (h.body + 36 > u8.length) return null;
  const size = (u8[h.body + 20] | (u8[h.body + 21] << 8) | (u8[h.body + 22] << 16) | (u8[h.body + 23] << 24)) >>> 0;
  const foDelay = (u8[h.body + 28] | (u8[h.body + 29] << 8) | (u8[h.body + 30] << 16) | (u8[h.body + 31] << 24)) >>> 0;
  const cbName = u8[h.body + 33];
  const embeddedAt = h.body + 36 + cbName;
  if (h.len > 36 + cbName) {
    const bh = recHeader(u8, embeddedAt);
    if (bh) return readBlip(u8, bh);
  }
  if (delay && size && foDelay !== 0xFFFFFFFF && foDelay + 8 <= delay.length) {
    const bh = recHeader(delay, foDelay);
    if (bh) return readBlip(delay, bh);
  }
  return null;
}

// Word's own automatic shape names ("Picture 3", "Image 2" …) are not descriptions
// (the same rule the .docx reader uses — pictureNameAsAlt, below).
const DEFAULT_PICTURE_NAME_RE = /^(picture|image|graphic|imagen|imagem|afbeelding|immagine|grafik|bild|billede|bilde|graphique|gr[aá]fico)\s*\d+$/i;
// A picture's object name as its alt text, or '' when the name is no description: Word's automatic "Picture 3", or a name that looks
// like a file name — no spaces, with an underscore or an image file extension ("ACMA_LOGO_BLACK_55mm", "logo.png"; feedback 30 Sep
// item 8, Paul 1 Oct: the braille note read "Illustration: ACMA_LOGO_BLACK_55mm"). Shared with parse.mjs's .docx reader.
export function pictureNameAsAlt(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n || DEFAULT_PICTURE_NAME_RE.test(n)) return '';
  if (!/\s/.test(n) && (/_/.test(n) || /\.(png|jpe?g|gif|bmp|tiff?|svg|emf|wmf|webp|heic)$/i.test(n))) return '';
  return n;
}
function makeImage(ctx, blip, props) {
  const name = (props && props.name) || '';
  const alt = (props && props.description) || pictureNameAsAlt(name);
  if (!blip || !blip.bytes) return { src: '', alt };
  ctx.picCount = (ctx.picCount || 0) + 1;
  // doc.mjs turns this into a model resource (converting a metafile/DIB) once bytes are ready.
  return { src: '', alt, _res: { name: `media/image${ctx.picCount}`, ext: blip.ext, bytes: blip.bytes } };
}

// ---- inline picture: PICF + OfficeArtInlineSpContainer in the Data stream ----
export function inlinePicture(ctx, fc) {
  if (ctx.picCache && ctx.picCache.has(fc)) return ctx.picCache.get(fc);
  const img = inlinePictureUncached(ctx, fc);
  if (ctx.picCache) ctx.picCache.set(fc, img);
  return img;
}
function inlinePictureUncached(ctx, fc) {
  const data = ctx.data;
  if (!data || fc == null || fc + 0x44 > data.length) return null;
  const r = reader(data);
  const lcb = r.i32(fc);
  const cbHeader = r.u16(fc + 4);
  const mm = r.i16(fc + 6);
  if (lcb < cbHeader || fc + lcb > data.length + 1) return null;
  const end = Math.min(data.length, fc + lcb);
  let o = fc + cbHeader;
  if (mm === 0x66) o += 1 + data[o];                            // MM_SHAPEFILE: a picture name follows
  if (mm !== 0x64 && mm !== 0x66) {
    // Pre-OfficeArt picture: a bare Windows metafile (no placeable header).
    return makeImage(ctx, { ext: 'wmf', bytes: wmfWithHeader(data.slice(o, end), r.i16(fc + 8), r.i16(fc + 10)) }, null);
  }
  const props = {};
  let blip = null;
  walkRecords(data, o, end, (h, recEnd) => {
    if (h.type === REC.FOPT || h.type === REC.SecondaryFOPT || h.type === REC.TertiaryFOPT) readFopt(data, h, recEnd, props);
    else if (h.type === REC.FBSE && !blip) { blip = readFbse(data, h, ctx.wd); return false; }
    else if (BLIP[h.type] && !blip) blip = readBlip(data, h);
    return true;
  });
  if (!blip && props.pib && ctx.art) blip = ctx.art.blipAt(props.pib);
  return makeImage(ctx, blip, props);
}

// A placeable-header WMF (what image tools expect) from a bare metafile.
function wmfWithHeader(mf, xExt, yExt, rc = null) {
  if (mf.length >= 4 && mf[0] === 0xD7 && mf[1] === 0xCD && mf[2] === 0xC6 && mf[3] === 0x9A) return mf;   // already placeable
  const out = new Uint8Array(22 + mf.length);
  const dv = new DataView(out.buffer);
  const clamp = (v) => Math.max(-32768, Math.min(32767, v | 0));
  dv.setUint32(0, 0x9AC6CDD7, true);
  if (rc) { dv.setInt16(6, clamp(rc[0]), true); dv.setInt16(8, clamp(rc[1]), true); }
  dv.setInt16(10, rc ? clamp(rc[2]) : Math.max(1, xExt || 1000), true);
  dv.setInt16(12, rc ? clamp(rc[3]) : Math.max(1, yExt || 1000), true);
  dv.setUint16(14, 1440, true);
  let sum = 0; for (let i = 0; i < 20; i += 2) sum ^= dv.getUint16(i, true);
  dv.setUint16(20, sum, true);
  out.set(mf, 22);
  return out;
}

// ---- the drawing group: BStore + main-document shapes; PlcSpaMom anchors ----
export function readArt(ctx) {
  const { table, fib } = ctx;
  const bstore = [];                                            // 1-based pib → FBSE header
  const shapes = new Map();                                     // spid → { spid, pib, txid, name, description }
  const e = fib.fcLcb.DggInfo;
  if (e && e.lcb && e.fc + e.lcb <= table.length) {
    try {
      let o = e.fc;
      const end = e.fc + e.lcb;
      const dgg = recHeader(table, o);
      if (dgg && dgg.type === REC.DggContainer) {
        walkRecords(table, dgg.body, Math.min(end, dgg.body + dgg.len), (h) => {
          if (h.type === REC.FBSE) { bstore.push(h); return false; }
          return h.type === REC.BStoreContainer;
        });
        o = dgg.body + dgg.len;
      }
      while (o < end) {
        const dgglbl = table[o]; o += 1;
        const dg = recHeader(table, o);
        if (!dg || dg.type !== REC.DgContainer) break;
        if (dgglbl === 0) {                                     // main document (1 = headers: ignored)
          let cur = null;
          walkRecords(table, dg.body, Math.min(end, dg.body + dg.len), (h, recEnd) => {
            if (h.type === REC.SpContainer) { cur = {}; }
            else if (h.type === REC.FSP && cur) {
              cur.spid = (table[h.body] | (table[h.body + 1] << 8) | (table[h.body + 2] << 16) | (table[h.body + 3] << 24)) >>> 0;
              if (table[h.body + 4] & 0x10) cur.ole = true;           // OfficeArtFSP.fOleShape ([MS-ODRAW] 2.2.40): an embedded object
              shapes.set(cur.spid, cur);
            }
            else if ((h.type === REC.FOPT || h.type === REC.SecondaryFOPT || h.type === REC.TertiaryFOPT) && cur) readFopt(table, h, recEnd, cur);
            return true;
          });
        }
        o = dg.body + dg.len;
      }
    } catch { /* drawings unreadable: floating shapes are skipped */ }
  }
  const anchors = new Map();                                    // CP → spid
  const s = fib.fcLcb.PlcSpaMom;
  if (s && s.lcb) {
    try {
      const plc = readPlc(table, s.fc, s.lcb, 26);
      const r = reader(table);
      for (let i = 0; i < plc.n; i++) anchors.set(plc.cps[i], r.u32(plc.dataOff(i)));
    } catch { /* no anchors */ }
  }
  const blipCache = new Map();
  const blipAt = (pib) => {
    if (blipCache.has(pib)) return blipCache.get(pib);
    const h = bstore[pib - 1];
    const b = h ? readFbse(table, h, ctx.wd) : null;
    blipCache.set(pib, b);
    return b;
  };
  const shapeCache = new Map();
  const shapeAt = (cp) => {
    if (!anchors.has(cp)) return null;
    if (shapeCache.has(cp)) return shapeCache.get(cp);
    const res = shapeAtUncached(cp);
    shapeCache.set(cp, res);
    return res;
  };
  const shapeAtUncached = (cp) => {
    const spid = anchors.get(cp);
    const sh = shapes.get(spid) || { spid };
    const out = { spid, txid: sh.txid };
    if (sh.ole) out.ole = true;
    if (sh.pib) {
      const blip = blipAt(sh.pib);
      if (blip) out.image = makeImage(ctx, blip, sh);
    }
    // K7/BANA §7: box/sidebar detection for a text box (doc.mjs's anchoredContent) — see the
    // comment above readFopt's own fillColor/lineColor/fillBool/lineBool reading.
    const explicitBit = (raw, bit) => raw != null && ((raw >>> 16) & bit) !== 0 && (raw & bit) !== 0;
    const literalRgbHex = (raw) => (raw != null && ((raw >>> 24) & 0xFF) === 0) ? (raw & 0xFFFFFF).toString(16).padStart(6, '0') : null;
    out.hasFill = explicitBit(sh._fillBool, 0x10);
    out.hasLine = explicitBit(sh._lineBool, 0x08);
    if (out.hasFill) out.fillColorHex = literalRgbHex(sh._fillColor);
    return out;
  };
  return { shapeAt, blipAt, shapes, anchors };
}

// ---- text boxes: spid → [{start, end}] CP ranges in the text-box subdocument ----
export function textboxRanges(ctx) {
  const out = new Map();
  const e = ctx.fib.fcLcb.PlcftxbxTxt;
  const sub = ctx.subs.txbx;
  if (!e || !e.lcb || sub.end <= sub.start) return out;
  try {
    const plc = readPlc(ctx.table, e.fc, e.lcb, 22);
    const r = reader(ctx.table);
    // spid by lTxid (high word = 1-based text box index) for shapes whose FTXBXS lid is unset
    const byTxid = new Map();
    for (const sh of ctx.art.shapes.values()) if (sh.txid) byTxid.set((sh.txid >>> 16) - 1, sh.spid);
    // An OLE shape has no lTxid; its pictureId carries the same 1-based story index in its
    // high word ([MS-ODRAW] 2.3.23 pictureId; doc.mjs floatingOle).
    for (const sh of ctx.art.shapes.values()) if (sh.ole && !sh.txid && sh.pictureId >>> 16 && !byTxid.has((sh.pictureId >>> 16) - 1)) byTxid.set((sh.pictureId >>> 16) - 1, sh.spid);
    for (let i = 0; i < plc.n; i++) {
      const d = plc.dataOff(i);
      const fReusable = r.i16(d + 8);
      const lid = r.i32(d + 14);
      if (fReusable) continue;
      const start = sub.start + plc.cps[i], end = Math.min(sub.end, sub.start + plc.cps[i + 1]);
      if (end <= start) continue;
      let spid = ctx.art.shapes.has(lid >>> 0) ? lid >>> 0 : byTxid.get(i);
      if (spid == null) spid = lid >>> 0;
      if (!out.has(spid)) out.set(spid, []);
      out.get(spid).push({ start, end });
    }
  } catch { /* text boxes unreadable */ }
  return out;
}

// ---- embedded OLE object: ObjectPool/_<id> → { progId, equationNative } ----
export function oleObjectInfo(ctx, id) {
  if (id == null) return null;
  const base = `ObjectPool/_${id >>> 0}`;
  const info = { progId: '', equationNative: null };
  try {
    const compObj = ctx.cfb.getStream(`${base}/\x01CompObj`);
    if (compObj) info.progId = compObjProgId(compObj);
    info.equationNative = ctx.cfb.getStream(`${base}/Equation Native`) || null;
  } catch { /* unreadable object */ }
  if (!info.progId && !info.equationNative) return null;
  return info;
}

// \x01CompObj ([MS-OLEDS] 2.3.8 CompObjStream): header 28 bytes, then AnsiUserType,
// AnsiClipboardFormat, Reserved1 (the ProgID), each a length-prefixed string.
function compObjProgId(u8) {
  try {
    const r = reader(u8);
    let o = 28;
    const lpstr = () => { const n = r.u32(o); o += 4; const s = new TextDecoder('windows-1252').decode(u8.subarray(o, o + n)).replace(/\0[\s\S]*$/, ''); o += n; return s; };
    lpstr();                                                    // AnsiUserType ("Microsoft Equation 3.0")
    const cf = r.u32(o);                                        // ClipboardFormat: 0, or -1/-2 + u32, or a string
    if (cf === 0) o += 4;
    else if (cf === 0xFFFFFFFF || cf === 0xFFFFFFFE) o += 8;
    else lpstr();
    const n = r.u32(o);
    if (n > 0 && n < 256) return lpstr();
  } catch { /* no ProgID */ }
  return '';
}

