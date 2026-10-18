// A small zip reader for tests (stored and deflated entries): { name -> Buffer }.
import zlib from 'node:zlib';
export function readZip(bytes) {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = b.readUInt16LE(off + 10), csize = b.readUInt32LE(off + 20);
    const nameLen = b.readUInt16LE(off + 28), extraLen = b.readUInt16LE(off + 30), commentLen = b.readUInt16LE(off + 32);
    const local = b.readUInt32LE(off + 42);
    const name = b.toString('utf8', off + 46, off + 46 + nameLen);
    const lNameLen = b.readUInt16LE(local + 26), lExtraLen = b.readUInt16LE(local + 28);
    const data = b.subarray(local + 30 + lNameLen + lExtraLen, local + 30 + lNameLen + lExtraLen + csize);
    out.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
