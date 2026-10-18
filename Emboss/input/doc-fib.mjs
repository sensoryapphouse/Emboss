// Word 97–2003 binary .doc — the File Information Block (FIB), the piece table (CLX) and
// the document text, plus the small binary helpers the rest of the .doc reader shares.
// Written from Microsoft's published [MS-DOC] specification (sections 2.5 FIB, 2.8.35 CLX,
// 2.9.177 PCD, 2.4.1 "Retrieving Text"); LibreOffice's ww8 import, Apache POI HWPF,
// antiword and wvWare were consulted for behaviour on real files, not copied.
//
// Everything here works on plain Uint8Arrays so it runs unchanged in the browser and Node.

export class DocError extends Error {
  constructor(message, code) { super(message); this.name = 'DocError'; this.code = code || 'corrupt'; }
}

// ---- little-endian readers (bounds-checked: a read past the end throws a DocError) ----
export function reader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const chk = (o, n) => { if (o < 0 || o + n > u8.length) throw new DocError(`read past the end of a .doc structure (offset ${o})`); };
  return {
    u8: (o) => { chk(o, 1); return u8[o]; },
    i8: (o) => { chk(o, 1); return dv.getInt8(o); },
    u16: (o) => { chk(o, 2); return dv.getUint16(o, true); },
    i16: (o) => { chk(o, 2); return dv.getInt16(o, true); },
    u32: (o) => { chk(o, 4); return dv.getUint32(o, true); },
    i32: (o) => { chk(o, 4); return dv.getInt32(o, true); },
    len: u8.length,
    bytes: u8,
  };
}

// FibRgFcLcb97 — the (fc, lcb) pairs, in order ([MS-DOC] 2.5.6). Only the names are needed to
// look a structure up; the list stops at the last one the reader uses.
const FC_NAMES = ['StshfOrig', 'Stshf', 'PlcffndRef', 'PlcffndTxt', 'PlcfandRef', 'PlcfandTxt', 'PlcfSed', 'PlcPad',
  'PlcfPhe', 'SttbfGlsy', 'PlcfGlsy', 'PlcfHdd', 'PlcfBteChpx', 'PlcfBtePapx', 'PlcfSea', 'SttbfFfn', 'PlcfFldMom',
  'PlcfFldHdr', 'PlcfFldFtn', 'PlcfFldAtn', 'PlcfFldMcr', 'SttbfBkmk', 'PlcfBkf', 'PlcfBkl', 'Cmds', 'Unused1',
  'SttbfMcr', 'PrDrvr', 'PrEnvPort', 'PrEnvLand', 'Wss', 'Dop', 'SttbfAssoc', 'Clx', 'PlcfPgdFtn', 'AutosaveSource',
  'GrpXstAtnOwners', 'SttbfAtnBkmk', 'Unused2', 'Unused3', 'PlcSpaMom', 'PlcSpaHdr', 'PlcfAtnBkf', 'PlcfAtnBkl',
  'Pms', 'FormFldSttbs', 'PlcfendRef', 'PlcfendTxt', 'PlcfFldEdn', 'Unused4', 'DggInfo', 'SttbfRMark', 'SttbCaption',
  'SttbAutoCaption', 'PlcfWkb', 'PlcfSpl', 'PlcftxbxTxt', 'PlcfFldTxbx', 'PlcfHdrtxbxTxt', 'PlcffldHdrTxbx',
  'StwUser', 'SttbTtmbd', 'CookieData', 'PgdMotherOldOld', 'BkdMotherOldOld', 'PgdFtnOldOld', 'BkdFtnOldOld',
  'PgdEdnOldOld', 'BkdEdnOldOld', 'SttbfIntlFld', 'RouteSlip', 'SttbSavedBy', 'SttbFnm', 'PlfLst', 'PlfLfo',
  'PlcfTxbxBkd', 'PlcfTxbxHdrBkd'];

// Word 6.0 / Word 95 (and older) write a different, pre-Unicode FIB and property layout.
export const MSG_OLD_WORD = 'This is a Word 6.0 or Word 95 document (or older). Emboss reads Word 97–2003 .doc files and newer: open it in Word (or LibreOffice) and save it as a Word document (.docx), then load that file.';
export const MSG_ENCRYPTED = 'This Word document is password-protected (encrypted), so Emboss cannot read it. Open it in Word, remove the password (Save As > Tools > General Options, or File > Info > Protect Document), save it, and load it again.';

// Read the FIB from the start of the WordDocument stream ([MS-DOC] 2.5.1). Throws a DocError
// with code 'old-word' or 'encrypted' for files this reader deliberately does not handle.
export function readFib(wd) {
  if (!wd || wd.length < 0x40) throw new DocError('the WordDocument stream is too short to hold a FIB');
  const r = reader(wd);
  const wIdent = r.u16(0);
  const nFibBase = r.u16(2);
  if (wIdent !== 0xA5EC && wIdent !== 0xA5DC) {
    if (wIdent === 0xA5DB || wIdent === 0xA59B) throw new DocError(MSG_OLD_WORD, 'old-word');
    throw new DocError('the WordDocument stream does not start with a Word FIB (not a Word document?)');
  }
  const flags = r.u16(0x0A);
  const fib = {
    wIdent,
    nFib: nFibBase,
    lid: r.u16(0x06),
    fDot: !!(flags & 0x0001),
    fGlossary: !!(flags & 0x0002),
    fComplex: !!(flags & 0x0004),
    fEncrypted: !!(flags & 0x0100),
    fWhichTblStm: !!(flags & 0x0200),
    fObfuscated: !!(flags & 0x8000),
    lKey: r.u32(0x0E),
  };
  // Word 6 (nFib 101) / Word 95 (104) / Word 97 betas below 0xC0. The later nFibNew check
  // below catches a Word 97+ file whose base nFib was left at the 97 value.
  if (nFibBase < 0xC0 && nFibBase !== 0) throw new DocError(MSG_OLD_WORD, 'old-word');
  if (fib.fEncrypted || fib.fObfuscated) throw new DocError(MSG_ENCRYPTED, 'encrypted');
  let o = 0x20;
  const csw = r.u16(o); o += 2 + csw * 2;                            // fibRgW97 (unused here)
  const cslw = r.u16(o); o += 2;
  const lw = (i) => (i < cslw ? r.i32(o + i * 4) : 0);
  fib.cbMac = lw(0) >>> 0;
  fib.ccp = { text: lw(3), ftn: lw(4), hdd: lw(5), mcr: lw(6), atn: lw(7), edn: lw(8), txbx: lw(9), hdrTxbx: lw(10) };
  for (const k of Object.keys(fib.ccp)) if (!(fib.ccp[k] > 0)) fib.ccp[k] = 0;
  o += cslw * 4;
  const cbRgFcLcb = r.u16(o); o += 2;
  fib.fcLcb = {};
  for (let i = 0; i < cbRgFcLcb && i < FC_NAMES.length; i++) {
    const at = o + i * 8;
    if (at + 8 > wd.length) break;
    fib.fcLcb[FC_NAMES[i]] = { fc: r.u32(at), lcb: r.u32(at + 4) };
  }
  o += cbRgFcLcb * 8;
  if (o + 4 <= wd.length) {
    const cswNew = r.u16(o);
    if (cswNew > 0) fib.nFib = r.u16(o + 2);
  }
  return fib;
}

// A PLC ([MS-DOC] 2.2.2): n+1 CPs (u32) followed by n data elements of cbData bytes each.
// Returns { cps: number[], data(i) -> {off} , n }.
export function readPlc(u8, fc, lcb, cbData) {
  const r = reader(u8);
  if (fc + lcb > u8.length) throw new DocError('a .doc table structure runs past the end of its stream');
  const n = cbData ? Math.floor((lcb - 4) / (4 + cbData)) : Math.floor(lcb / 4) - 1;
  if (n < 0) return { n: 0, cps: [], dataOff: () => 0 };
  const cps = [];
  for (let i = 0; i <= n; i++) cps.push(r.u32(fc + i * 4));
  const base = fc + (n + 1) * 4;
  return { n, cps, dataOff: (i) => base + i * cbData };
}

// Windows-1252 for the 0x80–0x9F range of a "compressed" (8-bit) piece ([MS-DOC] 2.9.73
// FcCompressed: the listed exceptions are exactly cp1252's C1 replacements).
const CP1252_HI = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];

// Parse the CLX ([MS-DOC] 2.9.38): the Prc array (grpprls referenced by a piece's Prm1) and
// the PlcPcd piece table. Each piece: { cpStart, cpEnd, fc (byte offset of its first
// character in the WordDocument stream), compressed (1 byte/char cp1252, else UTF-16LE), prm }.
export function readClx(table, fc, lcb) {
  const r = reader(table);
  const end = fc + lcb;
  if (end > table.length) throw new DocError('the piece table runs past the end of the table stream');
  const prcs = [];
  let pos = fc;
  while (pos < end) {
    const clxt = r.u8(pos);
    if (clxt === 1) {
      const cb = r.i16(pos + 1);
      prcs.push(table.subarray(pos + 3, pos + 3 + Math.max(0, cb)));
      pos += 3 + Math.max(0, cb);
      continue;
    }
    if (clxt !== 2) throw new DocError('the piece table (CLX) is corrupt');
    const lcbPlc = r.u32(pos + 1);
    const plc = readPlc(table, pos + 5, lcbPlc, 8);
    const pieces = [];
    for (let i = 0; i < plc.n; i++) {
      const d = plc.dataOff(i);
      const fcRaw = r.u32(d + 2);
      const compressed = !!(fcRaw & 0x40000000);
      const fcv = fcRaw & 0x3FFFFFFF;
      const cpStart = plc.cps[i], cpEnd = plc.cps[i + 1];
      if (cpEnd <= cpStart) continue;
      pieces.push({ cpStart, cpEnd, fc: compressed ? fcv / 2 : fcv, compressed, prm: r.u16(d + 6) });
    }
    return { prcs, pieces };
  }
  throw new DocError('the piece table (CLX) has no PlcPcd');
}

// The whole document's character stream (main text + every subdocument, in CP order) as one
// JS string, one UTF-16 code unit per CP — which is exactly how Word counts CPs, so a string
// index IS a CP. Missing/short pieces are padded with U+0000 rather than shifting later CPs.
export function buildText(wd, pieces) {
  // A damaged piece table must not make the reader build a gigantic string: no document has
  // more characters than its WordDocument stream has bytes, and CPs only ever increase.
  const cap = wd.length;
  let last = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.cpStart < last || p.cpStart >= cap) { pieces.length = i; break; }
    if (p.cpEnd > cap) p.cpEnd = cap;
    last = p.cpEnd;
  }
  const total = pieces.length ? pieces[pieces.length - 1].cpEnd : 0;
  const parts = [];
  let cp = 0;
  for (const p of pieces) {
    if (p.cpStart > cp) { parts.push('\0'.repeat(p.cpStart - cp)); cp = p.cpStart; }
    if (p.cpStart < cp) continue;                          // overlapping piece: ignore (corrupt)
    const n = p.cpEnd - p.cpStart;
    let s = '';
    if (p.compressed) {
      const chunk = [];
      for (let k = 0; k < n; k++) {
        const b = p.fc + k < wd.length ? wd[p.fc + k] : 0;
        chunk.push(b >= 0x80 && b <= 0x9F ? CP1252_HI[b - 0x80] : b);
        if (chunk.length >= 8192) { s += String.fromCharCode(...chunk); chunk.length = 0; }
      }
      if (chunk.length) s += String.fromCharCode(...chunk);
    } else {
      const chunk = [];
      for (let k = 0; k < n; k++) {
        const at = p.fc + k * 2;
        chunk.push(at + 1 < wd.length ? wd[at] | (wd[at + 1] << 8) : 0);
        if (chunk.length >= 8192) { s += String.fromCharCode(...chunk); chunk.length = 0; }
      }
      if (chunk.length) s += String.fromCharCode(...chunk);
    }
    parts.push(s);
    cp = p.cpEnd;
  }
  return { text: parts.join(''), total: Math.max(total, cp) };
}

// Map a CP to the piece holding it and the byte FC of that character.
export function makeCpMapper(pieces) {
  const starts = pieces.map((p) => p.cpStart);
  const pieceAt = (cp) => {
    let lo = 0, hi = pieces.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= cp) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans < 0 || cp >= pieces[ans].cpEnd) return -1;
    return ans;
  };
  const fcOf = (cp) => {
    const i = pieceAt(cp);
    if (i < 0) return null;
    const p = pieces[i];
    return { fc: p.fc + (cp - p.cpStart) * (p.compressed ? 1 : 2), piece: p, index: i };
  };
  return { pieceAt, fcOf };
}

// The subdocument CP ranges ([MS-DOC] 2.4.1: main text, then footnotes, headers, macro,
// annotations, endnotes, text boxes, header text boxes — each starting where the last ends).
export function subdocRanges(fib, textLength = Infinity) {
  const c = fib.ccp;
  const order = [['main', c.text], ['ftn', c.ftn], ['hdd', c.hdd], ['mcr', c.mcr], ['atn', c.atn], ['edn', c.edn], ['txbx', c.txbx], ['hdrTxbx', c.hdrTxbx]];
  const out = {};
  let cp = 0;
  for (const [k, n] of order) { out[k] = { start: Math.min(cp, textLength), end: Math.min(cp + n, textLength) }; cp += n; }
  return out;
}

// ---- \x05SummaryInformation property set ([MS-OLEPS]) → { title, subject, author } ----
export function readSummaryInfo(bytes) {
  const out = {};
  if (!bytes || bytes.length < 48) return out;
  try {
    const r = reader(bytes);
    if (r.u16(0) !== 0xFFFE) return out;
    const nSets = r.u32(24);
    if (!nSets) return out;
    const setOff = r.u32(28 + 16);
    const nProps = r.u32(setOff + 4);
    const props = new Map();
    for (let i = 0; i < nProps && i < 256; i++) props.set(r.u32(setOff + 8 + i * 8), setOff + r.u32(setOff + 12 + i * 8));
    let codepage = 1252;
    if (props.has(1)) { const o = props.get(1); if (r.u16(o) === 2) codepage = r.u16(o + 4); }
    const str = (pid) => {
      if (!props.has(pid)) return null;
      const o = props.get(pid);
      const type = r.u16(o);
      const n = r.u32(o + 4);
      if (type === 0x1E) {                                  // VT_LPSTR (codepage string)
        const raw = bytes.subarray(o + 8, o + 8 + n);
        let s;
        if (codepage === 1200) s = decodeUtf16(raw);
        else { try { s = new TextDecoder(codepage === 65001 ? 'utf-8' : 'windows-' + codepage).decode(raw); } catch { s = new TextDecoder('windows-1252').decode(raw); } }
        return s.replace(/\0[\s\S]*$/, '').trim() || null;
      }
      if (type === 0x1F) return decodeUtf16(bytes.subarray(o + 8, o + 8 + n * 2)).replace(/\0[\s\S]*$/, '').trim() || null;
      return null;
    };
    const title = str(2), subject = str(3), author = str(4);
    if (title) out.title = title;
    if (subject) out.subject = subject;
    if (author) out.author = author;
  } catch { /* a broken property set only loses the metadata */ }
  return out;
}

export function decodeUtf16(u8) {
  let s = '';
  const chunk = [];
  for (let i = 0; i + 1 < u8.length; i += 2) {
    chunk.push(u8[i] | (u8[i + 1] << 8));
    if (chunk.length >= 8192) { s += String.fromCharCode(...chunk); chunk.length = 0; }
  }
  if (chunk.length) s += String.fromCharCode(...chunk);
  return s;
}
