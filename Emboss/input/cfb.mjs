// OLE2 Compound File Binary (CFB) reader — the container format of Word 97-2003 .doc,
// .xls, .ppt, and of every OLE object embedded in a .docx (`word/embeddings/oleObject*.bin`,
// e.g. an Equation Editor 3.0 / MathType equation). Pure JS, no dependencies: runs in the
// browser and in Node.
//
// Written from Microsoft's published specification [MS-CFB] "Compound File Binary File
// Format" (header, FAT/DIFAT/mini FAT sector chains, 128-byte directory entries, red-black
// sibling trees). No code was copied from any other implementation.
//
// ---------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------
//   isCfb(bytes) -> boolean
//       true when `bytes` (Uint8Array | ArrayBuffer | typed-array view) starts with the CFB
//       signature D0 CF 11 E0 A1 B1 1A E1. Cheap; never throws.
//
//   readCfb(bytes) -> Cfb                                   throws CfbError on a bad file
//       Parses the header, the FAT (including DIFAT chains, i.e. files over ~7 MB), the
//       mini FAT and the whole directory. Supports major version 3 (512-byte sectors) and
//       version 4 (4096-byte sectors).
//
//   Cfb = {
//     majorVersion: 3 | 4,
//     sectorSize:   512 | 4096,
//     entries: [{ name, path, type, size, clsid }]
//         Every storage and stream in the file (the root excluded), depth-first in
//         directory-tree order. `type` is 'storage' | 'stream'. `path` is the entry's
//         '/'-joined name path from the root, e.g. 'ObjectPool/_1234/Equation Native'
//         (names are kept verbatim, including the control-character prefixes OLE uses,
//         e.g. '\x01CompObj', '\x05SummaryInformation'). `size` is the stream's byte
//         length (0 for a storage). `clsid` is the entry's CLSID as a lower-case
//         'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' string, or '' when all zero.
//     root: { name, clsid }       the Root Entry (its clsid identifies the file's class)
//     getStream(path) -> Uint8Array | null
//         The stream's bytes (a fresh copy, exactly `size` long), or null when no stream
//         has that path. Path matching is case-insensitive per [MS-CFB] and accepts a
//         leading '/'. Throws CfbError if the stream's sector chain is corrupt (a loop, an
//         out-of-range sector, or a chain shorter than the stream's size).
//     listStorage(path = '') -> [{ name, path, type, size, clsid }]
//         The direct children of the storage at `path` ('' or '/' = the root), or [] when
//         there is no such storage.
//   }
//
//   class CfbError extends Error    every error thrown by this module; its message says
//                                   what is wrong with the file ("not a compound file",
//                                   "FAT sector 12 is outside the file", ...).
//
// Robustness: every sector index, chain and directory link is range-checked and loop-
// guarded, so a truncated or hostile file produces a CfbError, never an infinite loop, an
// out-of-memory or a RangeError. A file that is merely truncated inside its last sector
// (common in the wild) is tolerated: the missing bytes read as zero.
// ---------------------------------------------------------------------------------------

export class CfbError extends Error {
  constructor(message) { super(message); this.name = 'CfbError'; }
}

const SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const MAXREGSECT = 0xFFFFFFFA;
const ENDOFCHAIN = 0xFFFFFFFE;
const FREESECT = 0xFFFFFFFF;
const NOSTREAM = 0xFFFFFFFF;
const HEADER_DIFAT_COUNT = 109;

function toU8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes && bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new CfbError('not a compound file: expected bytes (Uint8Array or ArrayBuffer)');
}

export function isCfb(bytes) {
  let u8;
  try { u8 = toU8(bytes); } catch { return false; }
  if (u8.length < 8) return false;
  for (let i = 0; i < 8; i++) if (u8[i] !== SIGNATURE[i]) return false;
  return true;
}

function clsidString(u8, off) {
  let zero = true;
  for (let i = 0; i < 16; i++) if (u8[off + i]) { zero = false; break; }
  if (zero) return '';
  const h = (i) => u8[off + i].toString(16).padStart(2, '0');
  // Data1 (LE u32), Data2 (LE u16), Data3 (LE u16), Data4 (8 bytes as stored).
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

export function readCfb(bytes) {
  const u8 = toU8(bytes);
  if (!isCfb(u8)) throw new CfbError('not a compound file (OLE2 signature missing)');
  if (u8.length < 512) throw new CfbError('compound file is truncated: shorter than its 512-byte header');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);

  const majorVersion = u16(0x1A);
  const sectorShift = u16(0x1E);
  const miniShift = u16(0x20);
  if (u16(0x1C) !== 0xFFFE) throw new CfbError('compound file header is corrupt (byte-order mark is not FFFE)');
  if (!((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12))) {
    throw new CfbError(`unsupported compound file: version ${majorVersion} with sector shift ${sectorShift} (expected 3/9 or 4/12)`);
  }
  if (miniShift !== 6) throw new CfbError(`compound file header is corrupt (mini sector shift ${miniShift}, expected 6)`);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const numFatSectors = u32(0x2C);
  const firstDirSector = u32(0x30);
  const miniCutoff = u32(0x38) || 4096;
  const firstMiniFatSector = u32(0x3C);
  const numMiniFatSectors = u32(0x40);
  const firstDifatSector = u32(0x44);
  const numDifatSectors = u32(0x48);

  // Sector n lives at (n + 1) * sectorSize (the header fills "sector -1"; in version 4 the
  // header's 512 bytes are padded out to a whole 4096-byte sector).
  const sectorCount = Math.ceil((u8.length - sectorSize) / sectorSize);
  const maxSectors = Math.max(0, sectorCount);
  const sectorBytes = (n, what) => {
    if (n > MAXREGSECT || n >= maxSectors) throw new CfbError(`${what}: sector ${n} is outside the file (file has ${maxSectors} sectors)`);
    const start = (n + 1) * sectorSize;
    const end = start + sectorSize;
    if (end <= u8.length) return u8.subarray(start, end);
    const padded = new Uint8Array(sectorSize);           // truncated inside the last sector
    padded.set(u8.subarray(start));
    return padded;
  };
  const sectorU32 = (n, what) => {
    const s = sectorBytes(n, what);
    const sv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const out = new Array(sectorSize / 4);
    for (let i = 0; i < out.length; i++) out[i] = sv.getUint32(i * 4, true);
    return out;
  };

  // ---- DIFAT: the list of FAT sector numbers (109 in the header, the rest chained) ----
  if (numFatSectors > maxSectors) throw new CfbError(`compound file header is corrupt: it claims ${numFatSectors} FAT sectors but the file only has ${maxSectors} sectors`);
  const fatSectors = [];
  for (let i = 0; i < HEADER_DIFAT_COUNT && fatSectors.length < numFatSectors; i++) {
    const s = u32(0x4C + i * 4);
    if (s === FREESECT) break;
    fatSectors.push(s);
  }
  {
    let d = firstDifatSector;
    const seen = new Set();
    let n = 0;
    while (fatSectors.length < numFatSectors && d !== ENDOFCHAIN && d !== FREESECT) {
      if (seen.has(d)) throw new CfbError(`DIFAT chain loops back to sector ${d}`);
      if (++n > numDifatSectors + 1 && numDifatSectors) throw new CfbError('DIFAT chain is longer than the header says');
      seen.add(d);
      const words = sectorU32(d, 'DIFAT');
      for (let i = 0; i < words.length - 1 && fatSectors.length < numFatSectors; i++) {
        if (words[i] === FREESECT) continue;
        fatSectors.push(words[i]);
      }
      d = words[words.length - 1];
    }
  }
  if (fatSectors.length < numFatSectors) throw new CfbError(`DIFAT lists only ${fatSectors.length} of the ${numFatSectors} FAT sectors`);

  // ---- FAT ----
  const fat = [];
  for (const s of fatSectors) {
    const words = sectorU32(s, 'FAT');
    for (let i = 0; i < words.length; i++) fat.push(words[i]);
  }

  // Follow a chain in `table` from `start`, returning the sector list. `limit` bounds the
  // length (so a looping or absurd chain is caught without walking it forever).
  const chain = (table, start, limit, what) => {
    const out = [];
    const seen = new Set();
    let s = start;
    while (s !== ENDOFCHAIN) {
      if (s === FREESECT || s > MAXREGSECT) throw new CfbError(`${what}: chain hits an unused/special sector marker (0x${s.toString(16)})`);
      if (s >= table.length) throw new CfbError(`${what}: chain points at sector ${s}, beyond the allocation table (${table.length} entries)`);
      if (seen.has(s)) throw new CfbError(`${what}: chain loops back to sector ${s}`);
      if (out.length >= limit) throw new CfbError(`${what}: chain is longer than expected (${limit} sectors)`);
      seen.add(s);
      out.push(s);
      s = table[s];
    }
    return out;
  };
  const readChain = (start, size, what) => {
    // size === null → read the whole chain (used for the directory and mini FAT).
    const limit = size == null ? maxSectors : Math.ceil(size / sectorSize);
    if (size != null && size > u8.length) throw new CfbError(`${what}: declared size ${size} is larger than the whole file`);
    if (size === 0) return new Uint8Array(0);
    const secs = chain(fat, start, size == null ? maxSectors : Math.max(limit, 1), what);
    const total = size == null ? secs.length * sectorSize : size;
    if (secs.length * sectorSize < total) throw new CfbError(`${what}: chain has ${secs.length} sectors, too short for ${total} bytes`);
    const out = new Uint8Array(total);
    for (let i = 0; i < secs.length; i++) {
      const b = sectorBytes(secs[i], what);
      const off = i * sectorSize;
      if (off >= total) break;
      out.set(b.subarray(0, Math.min(sectorSize, total - off)), off);
    }
    return out;
  };

  // ---- Directory ----
  if (firstDirSector === ENDOFCHAIN || firstDirSector === FREESECT) throw new CfbError('compound file has no directory');
  const dirBytes = readChain(firstDirSector, null, 'directory');
  const dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const nDir = Math.floor(dirBytes.length / 128);
  const dir = [];
  for (let i = 0; i < nDir; i++) {
    const o = i * 128;
    const nameLen = Math.min(64, dirDv.getUint16(o + 64, true));
    let name = '';
    for (let k = 0; k + 1 < nameLen; k += 2) {
      const c = dirDv.getUint16(o + k, true);
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    const type = dirBytes[o + 66];
    const sizeLo = dirDv.getUint32(o + 120, true);
    const sizeHi = dirDv.getUint32(o + 124, true);
    // Version 3 files may leave garbage in the high 32 bits of the size (per [MS-CFB]).
    const size = majorVersion === 3 ? sizeLo : sizeHi * 0x100000000 + sizeLo;
    dir.push({
      name, type,
      left: dirDv.getUint32(o + 68, true),
      right: dirDv.getUint32(o + 72, true),
      child: dirDv.getUint32(o + 76, true),
      clsid: clsidString(dirBytes, o + 80),
      start: dirDv.getUint32(o + 116, true),
      size,
    });
  }
  if (!dir.length || dir[0].type !== 5) throw new CfbError('compound file directory is corrupt: the first entry is not the Root Entry');
  const root = dir[0];

  // ---- Mini FAT + mini stream (streams smaller than the cutoff live here) ----
  let miniFat = null;
  let miniStream = null;
  const loadMini = () => {
    if (miniStream) return;
    miniFat = [];
    if (numMiniFatSectors && firstMiniFatSector !== ENDOFCHAIN) {
      const mf = readChain(firstMiniFatSector, null, 'mini FAT');
      const mv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mv.getUint32(i, true));
    }
    miniStream = root.size ? readChain(root.start, root.size, 'mini stream') : new Uint8Array(0);
  };
  const readMini = (start, size, what) => {
    loadMini();
    const secs = chain(miniFat, start, Math.ceil(size / miniSize), what);
    if (secs.length * miniSize < size) throw new CfbError(`${what}: mini chain has ${secs.length} sectors, too short for ${size} bytes`);
    const out = new Uint8Array(size);
    for (let i = 0; i < secs.length; i++) {
      const from = secs[i] * miniSize;
      const n = Math.min(miniSize, size - i * miniSize);
      if (from + n > miniStream.length) throw new CfbError(`${what}: mini sector ${secs[i]} is outside the mini stream`);
      out.set(miniStream.subarray(from, from + n), i * miniSize);
    }
    return out;
  };

  // ---- Walk the directory tree (each storage's children form a red-black tree) ----
  const entries = [];
  const children = new Map();                              // dir index → [entry]
  const byPath = new Map();                                // lower-case path → { entry, idx }
  const visited = new Set([0]);
  const collect = (childIdx, parentPath, parentKey, depth) => {
    if (depth > 64) throw new CfbError('compound file directory is nested too deeply');
    const list = [];
    // In-order walk of the sibling tree, iterative with an explicit stack.
    const stack = [];
    let cur = childIdx;
    let guard = 0;
    while (stack.length || (cur !== NOSTREAM)) {
      if (++guard > nDir * 2 + 8) throw new CfbError('compound file directory tree loops');
      if (cur !== NOSTREAM) {
        if (cur >= nDir) throw new CfbError(`compound file directory is corrupt: entry link ${cur} is out of range`);
        if (visited.has(cur)) throw new CfbError(`compound file directory is corrupt: entry ${cur} is linked twice`);
        visited.add(cur);
        stack.push(cur);
        cur = dir[cur].left;
        continue;
      }
      const idx = stack.pop();
      list.push(idx);
      cur = dir[idx].right;
    }
    const out = [];
    for (const idx of list) {
      const d = dir[idx];
      if (d.type !== 1 && d.type !== 2) continue;          // unallocated/unknown: skip
      const path = parentPath ? `${parentPath}/${d.name}` : d.name;
      const entry = { name: d.name, path, type: d.type === 1 ? 'storage' : 'stream', size: d.type === 2 ? d.size : 0, clsid: d.clsid };
      entries.push(entry);
      out.push(entry);
      byPath.set(path.toLowerCase(), { entry, idx });
      if (d.type === 1) children.set(path.toLowerCase(), d.child !== NOSTREAM ? collect(d.child, path, path.toLowerCase(), depth + 1) : []);
    }
    return out;
  };
  children.set('', root.child !== NOSTREAM ? collect(root.child, '', '', 0) : []);

  const norm = (p) => String(p || '').replace(/^\/+|\/+$/g, '').toLowerCase();

  return {
    majorVersion,
    sectorSize,
    entries,
    root: { name: root.name, clsid: root.clsid },
    listStorage(path = '') {
      return (children.get(norm(path)) || []).slice();
    },
    getStream(path) {
      const hit = byPath.get(norm(path));
      if (!hit || hit.entry.type !== 'stream') return null;
      const d = dir[hit.idx];
      const what = `stream "${hit.entry.path}"`;
      if (d.size === 0) return new Uint8Array(0);
      return d.size < miniCutoff ? readMini(d.start, d.size, what) : readChain(d.start, d.size, what);
    },
  };
}

export default readCfb;
