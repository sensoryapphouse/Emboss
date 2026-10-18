// OLE2 Compound File (CFB) reader — Emboss/input/cfb.mjs.
//
// Fixtures:
//   * cfb_samples/textutil-hello.doc — a REAL compound file written by an independent
//     implementation: macOS's own `textutil -convert doc` (Apple's Word 97 .doc writer),
//     made 25 Sep 2026 from the two-line text "Hello compound file world." /
//     "Second paragraph.". Version 3, 512-byte sectors, four 4096-byte streams.
//   * everything else is built in memory with the test-only writer in
//     helpers/cfb-writer.mjs (version 3 and 4, mini stream, nested storages, reversed
//     chains, a >7 MB file whose FAT needs DIFAT sectors), then corrupted on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCfb, isCfb, CfbError } from '../input/cfb.mjs';
import { writeCfb } from './helpers/cfb-writer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bytesOf = (n, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const same = (a, b) => a && b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

test('real .doc written by macOS textutil: header, directory and stream contents', () => {
  const buf = new Uint8Array(fs.readFileSync(path.join(HERE, 'cfb_samples/textutil-hello.doc')));
  assert.ok(isCfb(buf));
  const f = readCfb(buf);
  assert.equal(f.majorVersion, 3);
  assert.equal(f.sectorSize, 512);
  assert.equal(f.root.clsid, '00020906-0000-0000-c000-000000000046', 'Word.Document.8 class id');
  assert.deepEqual(f.entries.map((e) => [e.path, e.type, e.size]), [
    ['1Table', 'stream', 4096],
    ['WordDocument', 'stream', 4096],
    ['\x05SummaryInformation', 'stream', 4096],
    ['\x05DocumentSummaryInformation', 'stream', 4096],
  ]);
  const wd = f.getStream('WordDocument');
  assert.equal(wd.length, 4096);
  assert.equal(wd[0] | (wd[1] << 8), 0xA5EC, 'Word FIB magic number');
  const text = Buffer.from(wd).toString('utf16le');
  assert.ok(text.includes('Hello compound file world.'), 'document text found in the WordDocument stream');
  const si = f.getStream('\x05SummaryInformation');
  assert.equal(si[0] | (si[1] << 8), 0xFFFE, 'property-set byte-order mark');
  assert.deepEqual(f.listStorage('').map((e) => e.name), f.entries.map((e) => e.name));
});

for (const version of [3, 4]) {
  for (const reverseChains of [false, true]) {
    test(`writer round trip: version ${version}${reverseChains ? ', reversed chains' : ''} (mini stream, regular stream, nested storages)`, () => {
      const small = new TextEncoder().encode('Equation Native payload '.repeat(10));
      const edge = bytesOf(4095, 7);                       // largest mini-stream size
      const cutoff = bytesOf(4096, 8);                     // smallest regular-FAT size
      const big = bytesOf(70000, 9);
      const buf = writeCfb([
        { path: 'ObjectPool/_1234/Equation Native', data: small },
        { path: 'ObjectPool/_1234/\x01CompObj', data: new Uint8Array([1, 0, 0xFE, 0xFF]) },
        { path: 'Edge', data: edge },
        { path: 'Cutoff', data: cutoff },
        { path: 'Big', data: big },
        { path: 'Empty stream', data: new Uint8Array(0) },
        { path: 'Empty storage', storage: true },
      ], { version, reverseChains });
      const f = readCfb(buf);
      assert.equal(f.majorVersion, version);
      assert.equal(f.sectorSize, version === 4 ? 4096 : 512);
      assert.ok(same(f.getStream('ObjectPool/_1234/Equation Native'), small));
      assert.ok(same(f.getStream('/objectpool/_1234/EQUATION NATIVE'), small), 'case-insensitive, leading slash accepted');
      assert.ok(same(f.getStream('Edge'), edge));
      assert.ok(same(f.getStream('Cutoff'), cutoff));
      assert.ok(same(f.getStream('Big'), big));
      assert.equal(f.getStream('Empty stream').length, 0);
      assert.equal(f.getStream('ObjectPool'), null, 'a storage is not a stream');
      assert.equal(f.getStream('No such stream'), null);
      assert.deepEqual(f.listStorage('ObjectPool/_1234').map((e) => e.name).sort(), ['\x01CompObj', 'Equation Native'].sort());
      assert.deepEqual(f.listStorage('Empty storage'), []);
      assert.deepEqual(f.listStorage('nowhere'), []);
      const eq = f.entries.find((e) => e.path === 'ObjectPool/_1234/Equation Native');
      assert.deepEqual({ ...eq }, { name: 'Equation Native', path: 'ObjectPool/_1234/Equation Native', type: 'stream', size: small.length, clsid: '' });
    });
  }
}

test('a file over 7 MB (FAT needs DIFAT sectors beyond the header\'s 109) reads correctly', () => {
  const big = bytesOf(8 * 1024 * 1024, 3);
  const buf = writeCfb([{ path: 'Huge', data: big }, { path: 'Tiny', data: new Uint8Array([1, 2, 3]) }], { version: 3, reverseChains: true });
  const numFat = new DataView(buf.buffer).getUint32(0x2C, true);
  const numDifat = new DataView(buf.buffer).getUint32(0x48, true);
  assert.ok(numFat > 109 && numDifat >= 1, `fixture really uses DIFAT (FAT sectors ${numFat}, DIFAT sectors ${numDifat})`);
  const f = readCfb(buf);
  assert.ok(same(f.getStream('Huge'), big));
  assert.ok(same(f.getStream('Tiny'), new Uint8Array([1, 2, 3])));
});

test('storage CLSIDs are reported (how an OLE object says what it is)', () => {
  // Equation Editor 3.0's CLSID {0002CE02-0000-0000-C000-000000000046}, stored little-endian.
  const clsid = new Uint8Array([0x02, 0xCE, 0x02, 0x00, 0, 0, 0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0x46]);
  const f = readCfb(writeCfb([{ path: 'x', data: new Uint8Array(1) }], { rootClsid: clsid }));
  assert.equal(f.root.clsid, '0002ce02-0000-0000-c000-000000000046');
});

test('a file truncated inside its last sector is tolerated', () => {
  const data = bytesOf(5000, 4);
  const buf = writeCfb([{ path: 'S', data }]);
  // The stream is the last thing written; its final sector holds 5000 - 4608 = 392 bytes.
  const cut = buf.subarray(0, buf.length - 100);
  assert.ok(same(readCfb(cut).getStream('S'), data));
});

// ---- corrupt input: always a CfbError with a clear message, never a hang/RangeError ----

test('not a compound file / truncated header / unsupported version', () => {
  assert.equal(isCfb(new Uint8Array([1, 2, 3])), false);
  assert.equal(isCfb(new TextEncoder().encode('PK\x03\x04 a zip file')), false);
  assert.equal(isCfb(null), false);
  assert.throws(() => readCfb(new Uint8Array(600)), (e) => e instanceof CfbError && /not a compound file/.test(e.message));
  const good = writeCfb([{ path: 'S', data: new Uint8Array(10) }]);
  assert.throws(() => readCfb(good.subarray(0, 300)), (e) => e instanceof CfbError && /truncated/.test(e.message));
  const badVer = good.slice(); new DataView(badVer.buffer).setUint16(0x1A, 5, true);
  assert.throws(() => readCfb(badVer), (e) => e instanceof CfbError && /unsupported compound file/.test(e.message));
  const badBom = good.slice(); new DataView(badBom.buffer).setUint16(0x1C, 0x1234, true);
  assert.throws(() => readCfb(badBom), (e) => e instanceof CfbError && /byte-order/.test(e.message));
});

function fatOf(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fatSector = dv.getUint32(0x4C, true);
  return { dv, base: (fatSector + 1) * 512 };
}

test('a FAT chain that loops is reported, not followed forever', () => {
  const buf = writeCfb([{ path: 'S', data: bytesOf(5000) }]);
  const f0 = readCfb(buf);
  assert.ok(f0.getStream('S'));
  // Point every FAT entry that ends a chain back at sector 0's successor chain start:
  // find the stream's chain end (ENDOFCHAIN) and replace it with its own first sector.
  const { dv, base } = fatOf(buf);
  const dirStart = dv.getUint32(0x30, true);
  const entries = [];
  for (let i = 0; i < 128; i++) entries.push(dv.getUint32(base + i * 4, true));
  // the stream's first sector is recorded in its directory entry (entry 1, offset 116)
  const streamStart = dv.getUint32((dirStart + 1) * 512 + 128 + 116, true);
  let s = streamStart; while (entries[s] !== 0xFFFFFFFE) s = entries[s];
  dv.setUint32(base + s * 4, streamStart, true);
  assert.throws(() => readCfb(buf).getStream('S'), (e) => e instanceof CfbError && /loops|longer than expected/.test(e.message));
});

test('a chain pointing outside the file is reported', () => {
  const buf = writeCfb([{ path: 'S', data: bytesOf(5000) }]);
  const { dv } = fatOf(buf);
  const dirStart = dv.getUint32(0x30, true);
  dv.setUint32((dirStart + 1) * 512 + 128 + 116, 5000, true);   // stream starts at sector 5000
  assert.throws(() => readCfb(buf).getStream('S'), (e) => e instanceof CfbError && /beyond the allocation table|outside the file/.test(e.message));
});

test('a directory whose sibling links loop is reported', () => {
  const buf = writeCfb([{ path: 'A', data: new Uint8Array(4) }, { path: 'B', data: new Uint8Array(4) }, { path: 'C', data: new Uint8Array(4) }]);
  const dv = new DataView(buf.buffer);
  const dirStart = dv.getUint32(0x30, true);
  const dirOff = (dirStart + 1) * 512;
  // every non-root entry's left sibling → entry 1 (makes a cycle through the tree)
  for (let i = 1; i <= 3; i++) dv.setUint32(dirOff + i * 128 + 68, 1, true);
  assert.throws(() => readCfb(buf), (e) => e instanceof CfbError && /directory/.test(e.message));
});

test('a mini-stream chain that points outside the mini stream is reported', () => {
  const buf = writeCfb([{ path: 'S', data: bytesOf(300) }]);
  const dv = new DataView(buf.buffer);
  const dirStart = dv.getUint32(0x30, true);
  dv.setUint32((dirStart + 1) * 512 + 128 + 116, 900, true);   // mini sector 900 does not exist
  assert.throws(() => readCfb(buf).getStream('S'), (e) => e instanceof CfbError);
});

test('random garbage after a valid signature never throws anything but CfbError', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const junk = bytesOf(512 * (1 + (seed % 9)), seed);
    junk.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    if (seed % 2) { const v = new DataView(junk.buffer); v.setUint16(0x1A, 3, true); v.setUint16(0x1C, 0xFFFE, true); v.setUint16(0x1E, 9, true); v.setUint16(0x20, 6, true); v.setUint32(0x2C, 1, true); v.setUint32(0x4C, seed % 4, true); v.setUint32(0x30, seed % 3, true); }
    try {
      const f = readCfb(junk);
      for (const e of f.entries) if (e.type === 'stream') { try { f.getStream(e.path); } catch (err) { assert.ok(err instanceof CfbError, `seed ${seed}: ${err}`); } }
    } catch (err) {
      assert.ok(err instanceof CfbError, `seed ${seed}: ${err && err.stack}`);
    }
  }
});
