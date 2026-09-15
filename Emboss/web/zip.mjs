// Minimal STORE-only ZIP builder (no compression) for packaging multi-volume BRF,
// docx, and eBraille downloads in the browser — no external library.
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c;
}

function crc32(bytes) {
  let c = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ CRC32_TABLE[(c ^ bytes[i]) & 0xFF];
  }
  return (c ^ (-1)) >>> 0;
}

// files: [{ name, text | data }] → Blob (application/zip)
export function makeZip(files) {
  const enc = new TextEncoder();
  const encodedFiles = [];
  let totalDataSize = 0;
  let cdSize = 0;

  for (const f of files) {
    const nameB = enc.encode(f.name);
    const dataB = f.data instanceof Uint8Array ? f.data : enc.encode(f.text ?? '');
    const crc = crc32(dataB);
    encodedFiles.push({ nameB, dataB, crc });
    totalDataSize += 30 + nameB.length + dataB.length;
    cdSize += 46 + nameB.length;
  }

  const endRecordSize = 22;
  const out = new Uint8Array(totalDataSize + cdSize + endRecordSize);
  const view = new DataView(out.buffer);

  let offset = 0;
  const records = [];

  for (const f of encodedFiles) {
    const localOffset = offset;
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(offset + 8, 0, true); // store (no compression)
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint32(offset + 14, f.crc, true);
    view.setUint32(offset + 18, f.dataB.length, true);
    view.setUint32(offset + 22, f.dataB.length, true);
    view.setUint16(offset + 26, f.nameB.length, true);
    view.setUint16(offset + 28, 0, true);
    offset += 30;

    out.set(f.nameB, offset);
    offset += f.nameB.length;
    out.set(f.dataB, offset);
    offset += f.dataB.length;

    records.push({ nameB: f.nameB, crc: f.crc, size: f.dataB.length, localOffset });
  }

  const cdStart = offset;
  for (const r of records) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, r.crc, true);
    view.setUint32(offset + 20, r.size, true);
    view.setUint32(offset + 24, r.size, true);
    view.setUint16(offset + 28, r.nameB.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, r.localOffset, true);
    offset += 46;

    out.set(r.nameB, offset);
    offset += r.nameB.length;
  }

  const actualCdSize = offset - cdStart;
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, records.length, true);
  view.setUint16(offset + 10, records.length, true);
  view.setUint32(offset + 12, actualCdSize, true);
  view.setUint32(offset + 16, cdStart, true);
  view.setUint16(offset + 20, 0, true);

  return new Blob([out], { type: 'application/zip' });
}
