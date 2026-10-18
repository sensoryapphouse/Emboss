// Word 97–2003 binary .doc — formatting: SPRMs (property modifiers), the stylesheet (STSH),
// the character/paragraph formatting FKPs (PlcBteChpx / PlcBtePapx), the list tables
// (PlfLst / PlfLfo) and the font table. Written from [MS-DOC] sections 2.6 (SPRMs),
// 2.9.271 STSH, 2.9.43/2.9.176 FKPs, 2.9.147 LSTF / 2.9.150 LVL / 2.9.131 LFO.
//
// Property objects are deliberately small: only what the Emboss document model uses.

import { DocError, reader, readPlc, decodeUtf16 } from './doc-fib.mjs';

// ---- SPRM operand sizes ([MS-DOC] 2.2.5.1: spra = bits 13-15) ----
// Calls fn(sprm, dataOff, dataLen) for every SPRM in bytes[start, end). A truncated final
// SPRM is dropped rather than read past the end.
export function forEachSprm(bytes, start, end, fn) {
  let pos = start;
  end = Math.min(end, bytes.length);
  while (pos + 2 <= end) {
    const sprm = bytes[pos] | (bytes[pos + 1] << 8);
    pos += 2;
    const spra = sprm >> 13;
    let dataOff = pos, len;
    switch (spra) {
      case 0: case 1: len = 1; break;
      case 2: case 4: case 5: len = 2; break;
      case 3: len = 4; break;
      case 7: len = 3; break;
      default: {                                             // 6: variable length
        if (pos >= end) return;
        if (sprm === 0xD608 || sprm === 0xD606) {            // sprmTDefTable(10): 2-byte cb, cb-1 bytes follow
          if (pos + 2 > end) return;
          const cb = bytes[pos] | (bytes[pos + 1] << 8);
          dataOff = pos + 2; len = Math.max(0, cb - 1);
        } else if (sprm === 0xC615 && bytes[pos] === 255) { // sprmPChgTabs with its long form
          let q = pos + 1;
          const del = bytes[q] || 0; q += 1 + del * 4;
          const add = bytes[q] || 0; q += 1 + add * 3;
          dataOff = pos + 1; len = q - dataOff;
        } else {
          dataOff = pos + 1; len = bytes[pos];
        }
      }
    }
    if (dataOff + len > end) return;
    fn(sprm, dataOff, len);
    pos = dataOff + len;
  }
}

const rdU16 = (b, o) => b[o] | (b[o + 1] << 8);
const rdI16 = (b, o) => { const v = rdU16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const rdI32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));

// K36d: a border code (BRC, [MS-DOC] 2.9.20/2.9.21) — Word 97+'s 4-byte per-side border
// descriptor, the operand of sprmPBrcTop/Left/Bottom/Right (paragraph borders, below) and of
// each side of a table cell's own border (readTap's sprmTDefTable TC array, below): byte 0
// dptLineWidth (eighths of a point; 0 = no line), byte 1 brcType (0 = none), byte 2 ico (a
// fixed 17-entry palette index, 0 = auto), byte 3 dptSpace:5 | fShadow:1 | fFrame:1 | reserved:1.
// `w`/`type` are all this file needs to decide "is there a visible line here" (mirrors
// parse.mjs's docxParaBorderInfo: val && val!=='nil' && sz>0); `ico` is kept for a coarse
// boxColor guess (docBrcColorName, doc.mjs).
function readBrc(b, o) {
  return { w: b[o] || 0, type: b[o + 1] || 0, ico: b[o + 2] || 0 };
}
// True when a BRC (readBrc) describes an actual visible line, not "no border".
export function brcVisible(brc) { return !!(brc && brc.type && brc.w > 0); }

// ---- character properties ----
// The toggles (bold/italic/…) carry 0 off, 1 on, 0x80 "same as the style", 0x81 "opposite".
const CHP_TOGGLES = { 0x0835: 'bold', 0x0836: 'italic', 0x0837: 'strike', 0x083A: 'smallCaps', 0x083B: 'caps', 0x083C: 'vanish', 0x0838: 'outline', 0x0839: 'shadow', 0x0858: 'emboss', 0x0854: 'imprint' };
export function newChp() {
  return { bold: false, italic: false, strike: false, dstrike: false, smallCaps: false, caps: false, vanish: false, kul: 0, iss: 0,
    rmarkDel: false, rmarkIns: false, fldVanish: false, specVanish: false, fSpec: false, fOle2: false, fData: false, fObj: false,
    picLocation: null, symbol: null, istd: 10, ftc: null, lid: null, lidFE: null, lidBi: null };
}

// Apply one character SPRM. `style` is the CHP the toggles' 0x80/0x81 refer to.
export function applyChpSprm(chp, sprm, b, o, len, style) {
  const tog = CHP_TOGGLES[sprm];
  if (tog) {
    const v = b[o];
    chp[tog] = v === 0 ? false : v === 1 ? true : v === 0x80 ? !!(style && style[tog]) : v === 0x81 ? !(style && style[tog]) : !!v;
    return;
  }
  switch (sprm) {
    case 0x0800: chp.rmarkDel = !!b[o]; break;                // sprmCFRMarkDel
    case 0x0801: chp.rmarkIns = !!b[o]; break;                // sprmCFRMarkIns
    case 0x0802: chp.fldVanish = !!b[o]; break;               // sprmCFFldVanish
    case 0x6A03: chp.picLocation = rdI32(b, o) >>> 0; break;  // sprmCPicLocation
    case 0x0806: chp.fData = !!b[o]; break;                   // sprmCFData
    case 0x6A09: chp.symbol = { ftc: rdU16(b, o), xchar: rdU16(b, o + 2) }; break;   // sprmCSymbol
    case 0x080A: chp.fOle2 = !!b[o]; break;                   // sprmCFOle2
    case 0x0818: chp.specVanish = !!b[o]; break;              // sprmCFSpecVanish
    case 0x4A30: chp.istd = rdU16(b, o); break;               // sprmCIstd
    case 0x2A3E: chp.kul = b[o]; break;                       // sprmCKul (underline type; 0 none)
    case 0x2A48: chp.iss = b[o]; break;                       // sprmCIss (1 superscript, 2 subscript)
    case 0x2A53: chp.dstrike = !!b[o]; break;                 // sprmCFDStrike
    case 0x0855: chp.fSpec = !!b[o]; break;                   // sprmCFSpec
    case 0x0856: chp.fObj = !!b[o]; break;                    // sprmCFObj
    case 0x4A4F: chp.ftc = rdU16(b, o); break;                // sprmCRgFtc0 (ASCII font)
    case 0x486D: case 0x4873: chp.lid = rdU16(b, o); break;   // sprmCRgLid0(_80)
    // The language of East Asian text (sprmCRgLid1 / _80) and of right-to-left text (sprmCLidBi): which one applies
    // depends on the run's script (input/lang.mjs scriptSlot). Recorded as seg.lang only; braille is unchanged.
    case 0x486E: case 0x4874: chp.lidFE = rdU16(b, o); break; // sprmCRgLid1(_80)
    case 0x485F: chp.lidBi = rdU16(b, o); break;              // sprmCLidBi
    default: break;
  }
}

// ---- paragraph properties ----
// Table nesting depth is capped (Word allows 63 levels) so a damaged value cannot make the
// reader unwrap a table a billion times.
const MAX_TABLE_DEPTH = 64;
export function newPap() {
  return { istd: 0, ilfo: 0, ilvl: 0, outLvl: 9, fInTable: false, fTtp: false, itap: 0, fInnerCell: false, fInnerTtp: false,
    dxaLeft: 0, dxaLeft1: 0, jc: 0, dcs: 0, fHuge: null,
    brcTop: null, brcLeft: null, brcBottom: null, brcRight: null };   // K36d: paragraph border (readBrc), one per side
}

export function applyPapSprm(pap, sprm, b, o, len) {
  switch (sprm) {
    case 0x4600: pap.istd = rdU16(b, o); break;               // sprmPIstd
    case 0x260A: pap.ilvl = b[o]; break;                      // sprmPIlvl
    case 0x460B: pap.ilfo = rdI16(b, o); break;               // sprmPIlfo
    case 0x2640: pap.outLvl = b[o]; break;                    // sprmPOutLvl
    case 0x2416: pap.fInTable = !!b[o]; if (pap.fInTable && !pap.itap) pap.itap = 1; if (!pap.fInTable) pap.itap = 0; break;   // sprmPFInTable
    case 0x2417: pap.fTtp = !!b[o]; break;                    // sprmPFTtp
    case 0x6649: pap.itap = Math.max(0, Math.min(MAX_TABLE_DEPTH, rdI32(b, o))); pap.fInTable = pap.itap > 0; break;    // sprmPItap
    case 0x664A: pap.itap = Math.max(0, Math.min(MAX_TABLE_DEPTH, pap.itap + rdI32(b, o))); pap.fInTable = pap.itap > 0; break;   // sprmPDtap
    case 0x244B: pap.fInnerCell = !!b[o]; break;              // sprmPFInnerTableCell
    case 0x244C: pap.fInnerTtp = !!b[o]; break;               // sprmPFInnerTtp
    case 0x845E: case 0x840F: pap.dxaLeft = rdI16(b, o); break;   // sprmPDxaLeft / 80
    case 0x8460: case 0x8411: pap.dxaLeft1 = rdI16(b, o); break;  // sprmPDxaLeft1 / 80
    case 0x2461: case 0x2403: pap.jc = b[o]; break;           // sprmPJc / 80
    case 0x442C: pap.dcs = b[o] & 0x07; break;                // sprmPDcs: drop cap (1 dropped, 2 in margin)
    case 0xC60D: case 0xC615: {                               // sprmPChgTabsPapx / sprmPChgTabs: tab stops
      const tabs = new Map(pap.tabs || []);
      let q = o;
      const end = o + len;
      const nDel = b[q++] || 0;
      for (let i = 0; i < nDel && q + 2 <= end; i++, q += 2) tabs.delete(rdI16(b, q));
      if (sprm === 0xC615) q += nDel * 2;                     // rgdxaClose
      const nAdd = q < end ? b[q++] : 0;
      for (let i = 0; i < nAdd && q + i * 2 + 2 <= end; i++) {
        const pos = rdI16(b, q + i * 2);
        const tbd = b[q + nAdd * 2 + i] || 0;
        tabs.set(pos, (tbd >> 3) & 0x07);                      // TBD.tlc: the leader (1 = dots)
      }
      pap.tabs = tabs;
      break;
    }
    case 0x6646: pap.fHuge = rdI32(b, o) >>> 0; break;        // sprmPHugePapx: grpprl lives in the Data stream
    // K36d (BANA §7 box/sidebar detection, doc.mjs's docParaBoxKey): sprmPBrcTop/Left/Bottom/
    // Right ([MS-DOC] 2.6.4), the modern (Word 97+) 4-byte BRC per side — see readBrc, above.
    // The matching "80" (Word 6/95-compatible, 2-byte BRC80) sprms are not read: every writer
    // this reader targets (Word 97+, LibreOffice) emits the modern form for a paragraph border
    // applied through Format > Borders and Shading, the same assumption parse.mjs's docx
    // border reading makes (w:pBdr is itself Word 97+-only).
    case 0x6424: pap.brcTop = readBrc(b, o); break;           // sprmPBrcTop
    case 0x6425: pap.brcLeft = readBrc(b, o); break;          // sprmPBrcLeft
    case 0x6426: pap.brcBottom = readBrc(b, o); break;        // sprmPBrcBottom
    case 0x6427: pap.brcRight = readBrc(b, o); break;         // sprmPBrcRight
    default: break;
  }
}

// Apply a grpprl to a PAP, following sprmPHugePapx into the Data stream when present.
export function applyPapGrpprl(pap, b, start, end, dataStream) {
  forEachSprm(b, start, end, (sprm, o, len) => {
    applyPapSprm(pap, sprm, b, o, len);
    if (sprm === 0x6646 && dataStream && pap.fHuge != null) {
      const fc = pap.fHuge; pap.fHuge = null;
      if (fc + 2 <= dataStream.length) {
        const cb = rdU16(dataStream, fc);
        applyPapGrpprl(pap, dataStream, fc + 2, Math.min(dataStream.length, fc + 2 + cb), null);
      }
    }
  });
}

// ---- table properties (from a row-end / TTP paragraph's PAPX) ----
export function readTap(b, start, end, dataStream) {
  const tap = { itcMac: 0, centers: [], tcs: [], header: false };
  const each = (bytes, s, e) => forEachSprm(bytes, s, e, (sprm, o, len) => {
    switch (sprm) {
      case 0xD608: case 0xD606: {                              // sprmTDefTable
        const itc = bytes[o];
        tap.itcMac = itc;
        tap.centers = [];
        for (let i = 0; i <= itc && o + 1 + i * 2 + 2 <= o + len; i++) tap.centers.push(rdI16(bytes, o + 1 + i * 2));
        tap.tcs = [];
        let q = o + 1 + (itc + 1) * 2;
        for (let i = 0; i < itc; i++) {
          if (q + 20 <= o + len) {
            const grf = rdU16(bytes, q);
            // K36d: the same 20-byte TC record already read above for horz/vert merge also
            // carries the cell's own four borders ([MS-DOC] 2.9.339 TC: rgf:2, wWidth:2, then
            // brcTop/Left/Bottom/Right, each a 4-byte BRC — see readBrc, above) — used by
            // doc.mjs to box a bordered one-cell table the same way a bordered paragraph run
            // is boxed (K7/BANA §7, parity with parse.mjs's docxTcBoxInfo).
            const bordered = [4, 8, 12, 16].every((off) => brcVisible(readBrc(bytes, q + off)));
            tap.tcs.push({ horz: grf & 3, vert: (grf >> 5) & 3, bordered });
            q += 20;
          } else tap.tcs.push({ horz: 0, vert: 0, bordered: false });
        }
        break;
      }
      case 0x3404: tap.header = !!bytes[o]; break;             // sprmTTableHeader
      case 0x563A: tap.istd = bytes[o] | (bytes[o + 1] << 8); break;   // sprmTIstd: the table style
      case 0xD62B: {                                          // sprmTVertMerge: itc, flags
        const i = bytes[o], v = bytes[o + 1];
        if (tap.tcs[i]) tap.tcs[i].vert = v;
        break;
      }
      case 0x5624: {                                          // sprmTMerge: itcFirst, itcLim
        const f = bytes[o], l = bytes[o + 1];
        for (let i = f; i < l && i < tap.tcs.length; i++) tap.tcs[i].horz = i === f ? 1 : 2;
        break;
      }
      case 0x5625: {                                          // sprmTSplit: itcFirst, itcLim
        const f = bytes[o], l = bytes[o + 1];
        for (let i = f; i < l && i < tap.tcs.length; i++) tap.tcs[i].horz = 0;
        break;
      }
      case 0x7621: {                                          // sprmTInsert: itcInsert, ctc, dxaCol
        const at = bytes[o], ctc = bytes[o + 1], dxa = rdI16(bytes, o + 2);
        if (at <= tap.itcMac && ctc) {
          const base = tap.centers[Math.min(at, tap.centers.length - 1)] ?? 0;
          const add = []; for (let k = 1; k <= ctc; k++) add.push(base + k * dxa);
          const shifted = tap.centers.slice(at + 1).map((c) => c + ctc * dxa);
          tap.centers = [...tap.centers.slice(0, at + 1), ...add, ...shifted];
          tap.tcs.splice(at, 0, ...Array.from({ length: ctc }, () => ({ horz: 0, vert: 0 })));
          tap.itcMac += ctc;
        }
        break;
      }
      case 0x5622: {                                          // sprmTDelete: itcFirst, itcLim
        const f = bytes[o], l = Math.min(bytes[o + 1], tap.itcMac);
        if (l > f) {
          tap.tcs.splice(f, l - f);
          tap.centers.splice(f + 1, l - f);
          tap.itcMac -= (l - f);
        }
        break;
      }
      case 0x6646: {                                          // sprmPHugePapx: rest of the TAP in the Data stream
        if (dataStream) {
          const fc = rdI32(bytes, o) >>> 0;
          if (fc + 2 <= dataStream.length) { const cb = rdU16(dataStream, fc); each(dataStream, fc + 2, Math.min(dataStream.length, fc + 2 + cb)); }
        }
        break;
      }
      default: break;
    }
  });
  each(b, start, end);
  return tap;
}

// ---- stylesheet ([MS-DOC] 2.9.271 STSH) ----
// Returns { styles: Array<{istd, sti, stk, istdBase, name, linked, papx:{istd,start,end}|null, chpx:{start,end}|null}|null>, bytes }.
export function readStylesheet(table, fc, lcb) {
  const out = { styles: [], bytes: table };
  if (!lcb || fc + lcb > table.length) return out;
  const r = reader(table);
  const cbStshi = r.u16(fc);
  const stshi = fc + 2;
  const cstd = r.u16(stshi);
  const cbBase = r.u16(stshi + 2) || 10;
  let pos = stshi + cbStshi;
  const end = fc + lcb;
  for (let istd = 0; istd < cstd && pos + 2 <= end; istd++) {
    const cbStd = r.u16(pos);
    pos += 2;
    if (!cbStd) { out.styles.push(null); continue; }
    const s = pos, e = Math.min(end, pos + cbStd);
    pos += cbStd;
    try {
      const w0 = r.u16(s), w1 = r.u16(s + 2), w2 = r.u16(s + 4);
      const sti = w0 & 0x0FFF;
      const stk = w1 & 0x000F;
      const istdBase = (w1 >> 4) & 0x0FFF;
      const cupx = w2 & 0x000F;
      let linked = false;
      if (cbBase >= 18 && s + 12 <= e) {
        const istdLink = r.u16(s + 10) & 0x0FFF;
        linked = istdLink !== 0 && istdLink !== 0x0FFF;
      }
      let q = s + cbBase;
      const cch = r.u16(q); q += 2;
      const name = decodeUtf16(table.subarray(q, Math.min(e, q + cch * 2)));
      q += cch * 2 + 2;                                       // chars + null terminator
      const upxs = [];
      for (let k = 0; k < cupx && q + 2 <= e; k++) {
        const cbUpx = r.u16(q); q += 2;
        upxs.push({ start: q, end: Math.min(e, q + cbUpx) });
        q += cbUpx + (cbUpx & 1);
      }
      const st = { istd, sti, stk, istdBase, name, linked, papx: null, chpx: null };
      if (stk === 1) {                                        // paragraph style: UpxPapx, UpxChpx
        if (upxs[0] && upxs[0].end - upxs[0].start >= 2) st.papx = { istd: r.u16(upxs[0].start), start: upxs[0].start + 2, end: upxs[0].end };
        if (upxs[1]) st.chpx = upxs[1];
      } else if (stk === 2) {                                 // character style: UpxChpx
        if (upxs[0]) st.chpx = upxs[0];
      } else if (stk === 3) {                                 // table style: UpxTapx, UpxPapx, UpxChpx
        if (upxs[1] && upxs[1].end - upxs[1].start >= 2) st.papx = { istd: r.u16(upxs[1].start), start: upxs[1].start + 2, end: upxs[1].end };
        if (upxs[2]) st.chpx = upxs[2];
      } else if (stk === 4) {                                 // numbering style: UpxPapx
        if (upxs[0] && upxs[0].end - upxs[0].start >= 2) st.papx = { istd: r.u16(upxs[0].start), start: upxs[0].start + 2, end: upxs[0].end };
      }
      out.styles.push(st);
    } catch { out.styles.push(null); }
  }
  // A character style Word auto-generates as a paragraph style's "linked" twin (its own look
  // in a run, e.g. a Heading style's bold/italic) is named "<paragraph style name> Char" in
  // every Word/LibreOffice writer, whatever the file format. .docx carries this pairing
  // explicitly (w:link); this .doc STSH's own STD only has an istdLink field when
  // cbSTDBaseInFile >= 18 (real Word writers), which LibreOffice's .doc export does not write
  // (cbSTDBaseInFile 10, StdfBase only, no istdLink field at all) — the name-based match below
  // is the only source of `linked` in that case. Found via the "Heading 4 Char" style in a real
  // LibreOffice .doc export left unmarked, wrongly letting its own bold/italic through as
  // emphasis on a run (doc.mjs's resolveChp: parity item 3 / parse.mjs's runEmphasis already
  // exclude a linked style's own look from being read as user emphasis).
  const paraNames = new Set();
  for (const s of out.styles) if (s && s.stk === 1 && s.name) paraNames.add(s.name.toLowerCase());
  for (const s of out.styles) {
    if (!s || s.linked || s.stk !== 2 || !s.name) continue;
    const m = /^(.+?)\s+char$/i.exec(s.name);
    if (m && paraNames.has(m[1].toLowerCase())) s.linked = true;
  }
  return out;
}

// Resolved paragraph/character properties of a style, following istdBase (memoised).
export function makeStyleResolver(stsh, dataStream) {
  const papMemo = new Map(), chpMemo = new Map();
  const get = (istd) => (istd >= 0 && istd < stsh.styles.length ? stsh.styles[istd] : null);
  const pap = (istd, depth = 0) => {
    if (papMemo.has(istd)) return papMemo.get(istd);
    const st = get(istd);
    let p;
    if (!st || depth > 20) p = newPap();
    else {
      const base = st.istdBase !== 0x0FFF && st.istdBase !== istd ? pap(st.istdBase, depth + 1) : newPap();
      p = { ...base };
      if (st.papx) applyPapGrpprl(p, stsh.bytes, st.papx.start, st.papx.end, dataStream);
      p.istd = istd;
    }
    papMemo.set(istd, p);
    return p;
  };
  const chp = (istd, depth = 0) => {
    if (chpMemo.has(istd)) return chpMemo.get(istd);
    const st = get(istd);
    let c;
    if (!st || depth > 20) c = newChp();
    else {
      const base = st.istdBase !== 0x0FFF && st.istdBase !== istd ? chp(st.istdBase, depth + 1) : newChp();
      c = { ...base };
      if (st.chpx) forEachSprm(stsh.bytes, st.chpx.start, st.chpx.end, (sprm, o, len) => applyChpSprm(c, sprm, stsh.bytes, o, len, base));
    }
    chpMemo.set(istd, c);
    return c;
  };
  return { get, pap, chp, styles: stsh.styles };
}

// ---- formatting FKPs ----
// Every CHPX run in the file, sorted by FC: { fcStart, fcEnd, start, end } (grpprl byte range in
// the WordDocument stream; start === end for a run with no CHPX).
export function readChpxRuns(wd, table, fc, lcb) {
  const runs = [];
  if (!lcb) return runs;
  const plc = readPlc(table, fc, lcb, 4);
  const tr = reader(table);
  for (let i = 0; i < plc.n; i++) {
    const pn = tr.u32(plc.dataOff(i)) & 0x3FFFFF;
    const base = pn * 512;
    if (base + 512 > wd.length) continue;
    const crun = wd[base + 511];
    for (let k = 0; k < crun; k++) {
      const fcS = rdI32(wd, base + k * 4) >>> 0, fcE = rdI32(wd, base + (k + 1) * 4) >>> 0;
      const bOff = wd[base + (crun + 1) * 4 + k] * 2;
      let s = 0, e = 0;
      if (bOff) { const cb = wd[base + bOff]; s = base + bOff + 1; e = Math.min(base + 511, s + cb); }
      runs.push({ fcStart: fcS, fcEnd: fcE, start: s, end: e });
    }
  }
  runs.sort((a, b) => a.fcStart - b.fcStart);
  return runs;
}

// Every PAPX run in the file, sorted by FC: { fcStart, fcEnd, istd, start, end } — fcEnd is
// just past the paragraph's own mark.
export function readPapxRuns(wd, table, fc, lcb) {
  const runs = [];
  if (!lcb) return runs;
  const plc = readPlc(table, fc, lcb, 4);
  const tr = reader(table);
  for (let i = 0; i < plc.n; i++) {
    const pn = tr.u32(plc.dataOff(i)) & 0x3FFFFF;
    const base = pn * 512;
    if (base + 512 > wd.length) continue;
    const cpara = wd[base + 511];
    for (let k = 0; k < cpara; k++) {
      const fcS = rdI32(wd, base + k * 4) >>> 0, fcE = rdI32(wd, base + (k + 1) * 4) >>> 0;
      const bOff = wd[base + (cpara + 1) * 4 + k * 13] * 2;
      let istd = 0, s = 0, e = 0;
      if (bOff) {
        let o = base + bOff;
        let cb = wd[o];
        let len;
        if (cb === 0) { cb = wd[o + 1]; len = 2 * cb; o += 2; } else { len = 2 * cb - 1; o += 1; }
        if (len >= 2) { istd = rdU16(wd, o); s = o + 2; e = Math.min(base + 512, o + len); }
      }
      runs.push({ fcStart: fcS, fcEnd: fcE, istd, start: s, end: e });
    }
  }
  runs.sort((a, b) => a.fcStart - b.fcStart);
  return runs;
}

// Binary search: the run whose [fcStart, fcEnd) holds fc, or null.
export function findRun(runs, fc) {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (fc < r.fcStart) hi = mid - 1;
    else if (fc >= r.fcEnd) lo = mid + 1;
    else return r;
  }
  return null;
}

// ---- lists ([MS-DOC] 2.9.147 LSTF, 2.9.150 LVL, 2.9.131 LFO, 2.9.133 LFOLVL) ----
// nfc → the WordprocessingML numFmt name the .docx reader's numbering code understands.
const NFC_FMT = { 0: 'decimal', 1: 'upperroman', 2: 'lowerroman', 3: 'upperletter', 4: 'lowerletter', 5: 'ordinal', 6: 'cardinaltext', 7: 'ordinaltext', 22: 'decimalzero', 23: 'bullet', 255: 'none' };

function readLvl(b, pos, end) {
  if (pos + 28 > end) throw new DocError('a list level (LVL) runs past the end of the table stream');
  const startAt = rdI32(b, pos);
  const nfc = b[pos + 4];
  const flags = b[pos + 5];
  const ilvlRestartLim = b[pos + 26];
  const cbChpx = b[pos + 24], cbPapx = b[pos + 25];
  let q = pos + 28;
  const papx = { start: q, end: q + cbPapx }; q += cbPapx;
  const chpx = { start: q, end: q + cbChpx }; q += cbChpx;
  const cch = rdU16(b, q); q += 2;
  const xst = decodeUtf16(b.subarray(q, Math.min(end, q + cch * 2)));
  q += cch * 2;
  const fLegal = !!(flags & 0x04);
  // The number text's placeholders are the level indexes 0–8 as characters; write them the
  // WordprocessingML way ("%1.%2") so the shared marker code can fill them in.
  let lvlText = '';
  for (const ch of xst) { const c = ch.charCodeAt(0); lvlText += c < 9 ? `%${c + 1}` : ch; }
  return { lvl: { startAt, nfc, numFmt: NFC_FMT[nfc] || 'other', fLegal, fNoRestart: !!(flags & 0x08), ilvlRestartLim, lvlText, papx, chpx }, next: q };
}

export function readLists(table, fib) {
  const lsts = new Map();                                     // lsid → { levels: [lvl…] }
  const lfos = [];                                            // index ilfo-1 → { lsid, overrides: Map(ilvl → {startAt?, lvl?}) }
  const e1 = fib.fcLcb.PlfLst;
  if (e1 && e1.lcb >= 2 && e1.fc + e1.lcb <= table.length) {
    try {
      const cLst = rdI16(table, e1.fc);
      const lstfs = [];
      for (let i = 0; i < cLst; i++) {
        const o = e1.fc + 2 + i * 28;
        lstfs.push({ lsid: rdI32(table, o), simple: !!(table[o + 26] & 1) });
      }
      // The LVLs follow the LSTF array directly (whatever lcbPlfLst says — writers differ on
      // whether it covers them).
      let pos = e1.fc + 2 + cLst * 28;
      for (const l of lstfs) {
        const levels = [];
        const n = l.simple ? 1 : 9;
        for (let k = 0; k < n; k++) { const { lvl, next } = readLvl(table, pos, table.length); levels.push(lvl); pos = next; }
        lsts.set(l.lsid, { levels });
      }
    } catch { /* a damaged list table: paragraphs just lose their numbering */ }
  }
  const e2 = fib.fcLcb.PlfLfo;
  if (e2 && e2.lcb >= 4 && e2.fc + e2.lcb <= table.length) {
    try {
      const lfoMac = rdI32(table, e2.fc) >>> 0;
      const heads = [];
      for (let i = 0; i < lfoMac && i < 32767; i++) {
        const o = e2.fc + 4 + i * 16;
        heads.push({ lsid: rdI32(table, o), clfolvl: table[o + 12] });
      }
      let pos = e2.fc + 4 + lfoMac * 16;
      for (const h of heads) {
        const overrides = new Map();
        pos += 4;                                             // LFOData.cp
        for (let k = 0; k < h.clfolvl; k++) {
          const startAt = rdI32(table, pos), grf = rdI32(table, pos + 4) >>> 0;
          pos += 8;
          const ilvl = grf & 0x0F;
          const ov = {};
          if (grf & 0x10) ov.startAt = startAt;
          if (grf & 0x20) { const { lvl, next } = readLvl(table, pos, table.length); ov.lvl = lvl; pos = next; }
          overrides.set(ilvl, ov);
        }
        lfos.push({ lsid: h.lsid, overrides });
      }
    } catch { /* keep what was read */ }
  }
  // (ilfo, ilvl) → effective level definition, or null. ilfo is 1-based.
  const level = (ilfo, ilvl) => {
    const lfo = lfos[ilfo - 1];
    if (!lfo) return null;
    const ov = lfo.overrides.get(ilvl);
    if (ov && ov.lvl) return ov.startAt != null ? { ...ov.lvl, startAt: ov.startAt } : ov.lvl;
    const lst = lsts.get(lfo.lsid);
    const base = lst && lst.levels[Math.min(ilvl, lst.levels.length - 1)];
    if (!base) return null;
    return ov && ov.startAt != null ? { ...base, startAt: ov.startAt } : base;
  };
  return { lsts, lfos, level, lsidOf: (ilfo) => (lfos[ilfo - 1] ? lfos[ilfo - 1].lsid : null) };
}

// ---- font table (SttbfFfn) → font names by ftc ----
export function readFonts(table, fib) {
  const names = [];
  const e = fib.fcLcb.SttbfFfn;
  if (!e || !e.lcb || e.fc + e.lcb > table.length) return names;
  try {
    let pos = e.fc;
    let cData = rdU16(table, pos); pos += 2;
    if (cData === 0xFFFF) { cData = rdU16(table, pos); pos += 2; }
    pos += 2;                                                 // cbExtra
    for (let i = 0; i < cData && pos < e.fc + e.lcb; i++) {
      const cb = table[pos];
      const s = pos + 1, end = s + cb;
      let name = '';
      for (let q = s + 39; q + 1 < end; q += 2) { const c = rdU16(table, q); if (!c) break; name += String.fromCharCode(c); }
      names.push(name);
      pos = end;
    }
  } catch { /* names read so far */ }
  return names;
}
