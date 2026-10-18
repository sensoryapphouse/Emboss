// Deep Hardware Embosser Protocol & Byte-Level Driver Test Suite
// Verifies raw escape sequences, raster graphics, duplex interleaving, and packet protocols
// for Index, ViewPlus Tiger, Enabling Technologies, Braillo, APH Monarch, and DotPad.

import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEmbosserStream, detectEmbosserFromPort, KNOWN_EMBOSSER_PROFILES } from '../format/spooler.mjs';
import {
  charToDotMask,
  lineToDotMasks,
  formatTactileViewport,
  encodeHumanWareFrame,
  encodeDotPadLinePacket,
  encodeDotPadDualZonePackets,
  expand20CellsTo30DotPadBytes,
  calculateDotPadChecksum,
  standardBrailleToDotPadPinByte,
  packPixelsToDotPadHex,
  encodeHidBrailleReport
} from '../format/tactile-display.mjs';

test('Hardware Protocols: Index Braille V4/V5 Complete Byte Stream', () => {
  const brf = ' ,CHAPTER #A\r\n ,TEXT.\x0c ,PAGE #B\r\n ,MORE TEXT.\x0c';
  
  // Simplex
  const streamSimplex = prepareEmbosserStream(brf, { embosser: 'index', width: 40, depth: 25, duplex: 'single' });
  assert.ok(streamSimplex.includes(',CHAPTER #A'), 'Stream must contain chapter text');
  assert.ok(streamSimplex.includes(',PAGE #B'), 'Stream must contain second page text');
  assert.ok(streamSimplex.endsWith('\x1a'), 'Index stream must terminate with SUB (0x1A)');
  assert.ok(streamSimplex.includes('\x0c\x1a'), 'Form feed must precede SUB termination');

  // Duplex / Interpoint (PageBlaster)
  const streamDuplex = prepareEmbosserStream(brf, { embosser: 'pageblaster', width: 38, depth: 25, duplex: 'double' });
  assert.ok(streamDuplex.endsWith('\x1a'));
  assert.ok(streamDuplex.includes('\x0c'));
});

test('Hardware Protocols: Enabling Technologies Romeo & Juliet Protocol Setup', () => {
  const brf = ' ,ROMEO TEST PAGE.\x0c';
  
  // Romeo Single-Sided
  const streamRomeo = prepareEmbosserStream(brf, { embosser: 'romeo', width: 40, depth: 25, duplex: 'single' });
  assert.ok(streamRomeo.startsWith('\x1bA@@\x1bK@\x1bW@'), 'Romeo header opens with the driver\'s reset commands (A12, 23 Sep: bytes taken from APH libembosser)');
  assert.ok(streamRomeo.includes('\x1bR' + String.fromCharCode(40 + 64)), 'Romeo carries its cells-per-line as ESC R <cols+64>');
  assert.ok(streamRomeo.includes('\x1bQ' + String.fromCharCode(25 + 64)), 'Romeo carries its lines-per-page as ESC Q <rows+64>');
  assert.ok(!streamRomeo.endsWith('\x1a'), 'these models take no trailing EOF byte (A12, 23 Sep: APH libembosser)');

  // Juliet Double-Sided (Interpoint)
  const streamJuliet = prepareEmbosserStream(brf, { embosser: 'juliet', width: 38, depth: 27, duplex: 'double' });
  assert.ok(streamJuliet.startsWith('\x1bA@@\x1bK@\x1bW@'), 'Juliet shares the Enabling Technologies header');
  assert.ok(streamJuliet.includes('\x1bR' + String.fromCharCode(38 + 64)), 'Juliet carries 38 cells per line');
  assert.ok(streamJuliet.includes('\x1bQ' + String.fromCharCode(27 + 64)), 'Juliet carries 27 lines per page');
  assert.ok(!streamJuliet.endsWith('\x1a'), 'no trailing EOF byte for these models (A12, 23 Sep)');
});

test('Hardware Protocols: ViewPlus Tiger & PixBlaster Graphics Stream', () => {
  const brf = ' ,VIEWPLUS TIGER TEST.\x0c';
  const streamVP = prepareEmbosserStream(brf, { embosser: 'viewplus' });
  assert.ok(!streamVP.startsWith('\x1b'), 'ViewPlus gets plain BRF: its own driver writes no header (A12, 23 Sep)');
  assert.ok(streamVP.endsWith('\x0c'), 'ViewPlus stream must terminate with form feed');

  const streamPix = prepareEmbosserStream(brf, { embosser: 'pixblaster' });
  assert.ok(!streamPix.startsWith('\x1b'), 'PixBlaster shares the ViewPlus path, so also plain BRF');
});

test('Hardware Protocols: Braillo 200/400/600 Heavy Industrial Protocol', () => {
  const brf = ' ,BRAILLO HEAVY PRODUCTION.\x0c';
  const streamBraillo = prepareEmbosserStream(brf, { embosser: 'braillo', depth: 27 });
  assert.ok(streamBraillo.startsWith('\x1bS1\x1bJ0\x1bN0\x1bR0\x1bA27'), 'Braillo header carries its 27 lines per page (A12, 23 Sep)');
  assert.ok(streamBraillo.endsWith('\x0c'), 'Braillo must conclude with Form Feed');
});

test('Hardware Protocols: USB Vendor & Product ID Detection Matrix', () => {
  const devices = [
    { port: { usbVendorId: 0x11a9, usbProductId: 0x6001 }, expectedId: 'index', name: 'Index Braille' },
    { port: { usbVendorId: 0x0bd7, usbProductId: 0x0010 }, expectedId: 'viewplus', name: 'ViewPlus Tiger' },
    { port: { usbVendorId: 0x0403, usbProductId: 0x6001 }, expectedId: 'generic', name: 'FTDI Serial generic' },
    { port: { usbVendorId: 0x10c4, usbProductId: 0xea60 }, expectedId: 'generic', name: 'Silicon Labs generic' }
  ];

  for (const d of devices) {
    const profile = detectEmbosserFromPort({ getInfo: () => d.port });
    assert.equal(profile.id, d.expectedId, `Port matching failed for ${d.name}`);
  }
});

test('Hardware Protocols: Tactile Pin Arrays (Monarch, DotPad & HID Braille)', () => {
  // Monarch HumanWare frame protocol (10 lines x 32 cells)
  const sampleBraille = '⠠⠓⠑⠇⠇⠕⠀⠠⠺⠕⠗⠇⠙';
  const masks = lineToDotMasks(sampleBraille, 32);
  const tenLines = Array.from({ length: 10 }, () => masks);
  const humanWareFrame = encodeHumanWareFrame(tenLines);
  assert.equal(humanWareFrame.length, 4 + 10 * (1 + 32)); // 334 bytes
  assert.equal(humanWareFrame[0], 0x1b); // ESC
  assert.equal(humanWareFrame[1], 0x4d); // 'M'
  assert.equal(humanWareFrame[2], 10);   // 10 lines
  assert.equal(humanWareFrame[3], 32);   // 32 cells wide

  // DotPad pin conversion & dual zone packets
  const rawBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  const linePacket = encodeDotPadLinePacket(rawBytes, 0);
  assert.ok(linePacket.length > 5);
  assert.equal(linePacket[0], 0xAA); // Sync byte 1 (0xAA)
  assert.equal(linePacket[1], 0x55); // Sync byte 2 (0x55)

  const checksum = calculateDotPadChecksum(new Uint8Array([0x01, 0x02, 0x03]));
  assert.equal(typeof checksum, 'number');

  // USB HID Braille Report (Usage Page 0x41)
  const hidReport = encodeHidBrailleReport(0x01, masks);
  assert.equal(hidReport.length, 1 + 32);
  assert.equal(hidReport[0], 0x01); // Report ID
  assert.equal(hidReport[1], 0x20); // First cell dot mask
});
