// Test-only OLE2 Compound File (CFB) WRITER, used to build fixtures for the reader in
// Emboss/input/cfb.mjs (and the OLE equation objects MTEF tests wrap). Written from
// [MS-CFB]; not shipped in the app.
//
//   writeCfb(streams, opts) -> Uint8Array
//     streams: [{ path: 'Storage/Sub/Stream name', data: Uint8Array }]  (storages are
//              created implicitly from the paths; { path, storage: true } makes an empty one)
//     opts.version       3 (512-byte sectors, default) or 4 (4096-byte sectors)
//     opts.miniCutoff    stream-size cutoff for the mini stream (default 4096)
//     opts.reverseChains link each regular chain from its last sector back to its first,
//                        so a reader that assumes contiguous/ascending chains is caught
//     opts.rootClsid     16-byte Uint8Array CLSID for the Root Entry
//     opts.clsids        { 'path': Uint8Array(16) } CLSIDs for storages

const ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD, DIFSECT = 0xFFFFFFFC, NOSTREAM = 0xFFFFFFFF;

function cfbCompare(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  const A = a.toUpperCase(), B = b.toUpperCase();
  return A < B ? -1 : A > B ? 1 : 0;
}

export function writeCfb(streams, opts = {}) {
  const version = opts.version || 3;
  const ss = version === 4 ? 4096 : 512;
  const cutoff = opts.miniCutoff ?? 4096;
  const perSector = ss / 4;

  // ---- directory tree ----
  const root = { name: 'Root Entry', type: 5, kids: new Map(), data: null, clsid: opts.rootClsid };
  const ensure = (parts) => {
    let node = root;
    for (const p of parts) {
      if (!node.kids.has(p)) node.kids.set(p, { name: p, type: 1, kids: new Map(), data: null, clsid: opts.clsids?.[p] });
      node = node.kids.get(p);
    }
    return node;
  };
  for (const s of streams) {
    const parts = s.path.split('/').filter(Boolean);
    if (s.storage) { ensure(parts); continue; }
    const parent = ensure(parts.slice(0, -1));
    parent.kids.set(parts[parts.length - 1], { name: parts[parts.length - 1], type: 2, kids: new Map(), data: s.data });
  }
  const dir = [];
  const addNode = (node) => { node.idx = dir.length; dir.push(node); for (const k of node.kids.values()) addNode(k); };
  addNode(root);
  // children → balanced BST by CFB order
  const build = (sorted) => {
    if (!sorted.length) return NOSTREAM;
    const mid = sorted.length >> 1;
    const n = sorted[mid];
    n.left = build(sorted.slice(0, mid));
    n.right = build(sorted.slice(mid + 1));
    return n.idx;
  };
  for (const node of dir) {
    node.left ??= NOSTREAM; node.right ??= NOSTREAM;
    const kids = [...node.kids.values()].sort((a, b) => cfbCompare(a.name, b.name));
    node.child = build(kids);
  }
  for (const node of dir) { node.left ??= NOSTREAM; node.right ??= NOSTREAM; }

  // ---- mini stream ----
  const miniFat = [];
  const miniParts = [];
  for (const node of dir) {
    if (node.type !== 2 || !node.data.length || node.data.length >= cutoff) continue;
    const n = Math.ceil(node.data.length / 64);
    node.start = miniFat.length;
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? ENDOFCHAIN : miniFat.length + 1);
    const padded = new Uint8Array(n * 64); padded.set(node.data);
    miniParts.push(padded);
  }
  const miniStream = new Uint8Array(miniParts.reduce((a, p) => a + p.length, 0));
  { let o = 0; for (const p of miniParts) { miniStream.set(p, o); o += p.length; } }
  root.size = miniStream.length;

  // ---- regular sectors ----
  const dirBytes = new Uint8Array(Math.ceil(dir.length / (ss / 128)) * ss);
  const miniFatBytes = new Uint8Array(Math.ceil(miniFat.length * 4 / ss) * ss);
  { const v = new DataView(miniFatBytes.buffer); for (let i = 0; i < miniFatBytes.length / 4; i++) v.setUint32(i * 4, i < miniFat.length ? miniFat[i] : FREESECT, true); }
  const blobs = [];                                        // { bytes, owner }
  blobs.push({ bytes: dirBytes, kind: 'dir' });
  if (miniFat.length) blobs.push({ bytes: miniFatBytes, kind: 'minifat' });
  if (miniStream.length) blobs.push({ bytes: miniStream, kind: 'ministream' });
  for (const node of dir) if (node.type === 2 && node.data.length >= cutoff) blobs.push({ bytes: node.data, kind: 'stream', node });
  const dataSectors = blobs.reduce((a, b) => a + Math.ceil(b.bytes.length / ss), 0);
  let fatN = 1, difatN = 0;
  for (;;) {
    const total = dataSectors + fatN + difatN;
    const nf = Math.ceil(total / perSector);
    const nd = nf > 109 ? Math.ceil((nf - 109) / (perSector - 1)) : 0;
    if (nf === fatN && nd === difatN) break;
    fatN = nf; difatN = nd;
  }
  const totalSectors = dataSectors + fatN + difatN;
  const fat = new Array(fatN * perSector).fill(FREESECT);
  const fatSecs = [], difatSecs = [];
  let next = 0;
  for (let i = 0; i < fatN; i++) { fatSecs.push(next); fat[next++] = FATSECT; }
  for (let i = 0; i < difatN; i++) { difatSecs.push(next); fat[next++] = DIFSECT; }
  const body = new Uint8Array(totalSectors * ss);
  for (const b of blobs) {
    const n = Math.ceil(b.bytes.length / ss);
    const secs = [];
    for (let i = 0; i < n; i++) secs.push(next + i);
    next += n;
    // physical placement: sequential; logical chain order optionally reversed
    const order = opts.reverseChains ? secs.slice().reverse() : secs;
    for (let i = 0; i < n; i++) fat[order[i]] = i === n - 1 ? ENDOFCHAIN : order[i + 1];
    b.start = n ? order[0] : ENDOFCHAIN;
    b.order = order;
  }
  // write blob bytes (after directory is serialised, below)
  const put = (b) => { for (let i = 0; i < b.order.length; i++) body.set(b.bytes.subarray(i * ss, (i + 1) * ss), b.order[i] * ss); };
  const dirBlob = blobs.find((b) => b.kind === 'dir');
  const mfBlob = blobs.find((b) => b.kind === 'minifat');
  const msBlob = blobs.find((b) => b.kind === 'ministream');
  root.start = msBlob ? msBlob.start : ENDOFCHAIN;
  for (const b of blobs) if (b.kind === 'stream') b.node.start = b.start;

  // ---- serialise directory ----
  const dv = new DataView(dirBytes.buffer);
  for (let i = 0; i < dirBytes.length / 128; i++) {
    const o = i * 128;
    const node = dir[i];
    if (!node) { dv.setUint32(o + 68, NOSTREAM, true); dv.setUint32(o + 72, NOSTREAM, true); dv.setUint32(o + 76, NOSTREAM, true); continue; }
    const name = node.name.slice(0, 31);
    for (let k = 0; k < name.length; k++) dv.setUint16(o + k * 2, name.charCodeAt(k), true);
    dv.setUint16(o + 64, (name.length + 1) * 2, true);
    dirBytes[o + 66] = node.type;
    dirBytes[o + 67] = 1;                                 // black
    dv.setUint32(o + 68, node === root ? NOSTREAM : node.left, true);
    dv.setUint32(o + 72, node === root ? NOSTREAM : node.right, true);
    dv.setUint32(o + 76, node.type === 2 ? NOSTREAM : node.child, true);
    if (node.clsid) dirBytes.set(node.clsid, o + 80);
    const size = node.type === 2 ? node.data.length : node === root ? root.size : 0;
    const start = node.type === 2 ? (node.data.length ? node.start : ENDOFCHAIN) : node === root ? root.start : 0;
    dv.setUint32(o + 116, start, true);
    dv.setUint32(o + 120, size, true);
  }
  for (const b of blobs) put(b);

  // ---- FAT + DIFAT sectors ----
  const bv = new DataView(body.buffer);
  for (let i = 0; i < fatN; i++) for (let k = 0; k < perSector; k++) bv.setUint32(fatSecs[i] * ss + k * 4, fat[i * perSector + k], true);
  const overflow = fatSecs.slice(109);
  for (let d = 0; d < difatN; d++) {
    const base = difatSecs[d] * ss;
    for (let k = 0; k < perSector - 1; k++) {
      const v = overflow[d * (perSector - 1) + k];
      bv.setUint32(base + k * 4, v === undefined ? FREESECT : v, true);
    }
    bv.setUint32(base + (perSector - 1) * 4, d + 1 < difatN ? difatSecs[d + 1] : ENDOFCHAIN, true);
  }

  // ---- header ----
  const header = new Uint8Array(ss);
  const hv = new DataView(header.buffer);
  header.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
  hv.setUint16(0x18, 0x3E, true);
  hv.setUint16(0x1A, version, true);
  hv.setUint16(0x1C, 0xFFFE, true);
  hv.setUint16(0x1E, version === 4 ? 12 : 9, true);
  hv.setUint16(0x20, 6, true);
  hv.setUint32(0x28, version === 4 ? dirBytes.length / ss : 0, true);
  hv.setUint32(0x2C, fatN, true);
  hv.setUint32(0x30, dirBlob.start, true);
  hv.setUint32(0x38, cutoff, true);
  hv.setUint32(0x3C, mfBlob ? mfBlob.start : ENDOFCHAIN, true);
  hv.setUint32(0x40, mfBlob ? mfBlob.order.length : 0, true);
  hv.setUint32(0x44, difatN ? difatSecs[0] : ENDOFCHAIN, true);
  hv.setUint32(0x48, difatN, true);
  for (let i = 0; i < 109; i++) hv.setUint32(0x4C + i * 4, i < fatSecs.length ? fatSecs[i] : FREESECT, true);

  const out = new Uint8Array(ss + body.length);
  out.set(header);
  out.set(body, ss);
  return out;
}
