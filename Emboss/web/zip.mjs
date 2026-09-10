// Minimal STORE-only ZIP builder (no compression) for packaging multi-volume BRF
// downloads in the browser — no external library. File contents and names are
// UTF-8 encoded (BRF is ASCII today, but this stays correct if any non-ASCII cell
// ever reaches the output). Good enough for a handful of small text files.
function crc32(bytes) {
  let c = ~0 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
const u16 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
const cat = (arrs) => { const len = arrs.reduce((s, a) => s + a.length, 0); const out = new Uint8Array(len); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

// files: [{ name, text }] → Blob (application/zip)
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const records = [];
  let offset = 0;
  const push = (arr) => { parts.push(arr); offset += arr.length; };
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const dataB = enc.encode(f.text ?? '');          // UTF-8, not a lossy 1-byte truncation
    const crc = crc32(dataB);
    const localOffset = offset;
    // general-purpose bit flag = 0x0800 → filename/content are UTF-8 (bit 11)
    push(cat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(dataB.length), u32(dataB.length), u16(nameB.length), u16(0), nameB, dataB]));
    records.push({ nameB, crc, size: dataB.length, localOffset });
  }
  const cdStart = offset;
  for (const r of records) {
    push(cat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(r.crc), u32(r.size), u32(r.size), u16(r.nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(r.localOffset), r.nameB]));
  }
  const cdSize = offset - cdStart;
  push(cat([u32(0x06054b50), u16(0), u16(0), u16(records.length), u16(records.length), u32(cdSize), u32(cdStart), u16(0)]));
  return new Blob([cat(parts)], { type: 'application/zip' });
}
