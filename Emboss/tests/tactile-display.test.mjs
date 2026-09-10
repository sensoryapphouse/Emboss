// Unit tests for multi-line tactile display driver (APH Monarch, DotPad & USB-IF HID)
import test from 'node:test';
import assert from 'node:assert/strict';
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
  rasterizeSvgToDotPadCells,
  encodeHidBrailleReport,
  isWebBluetoothSupported,
  TactileDisplayManager
} from '../format/tactile-display.mjs';

test('charToDotMask: Unicode Braille Patterns', () => {
  // \u2800 = empty cell (0x00)
  assert.equal(charToDotMask('⠀'), 0x00);
  // \u2801 = dot 1 (0x01)
  assert.equal(charToDotMask('⠁'), 0x01);
  // \u2803 = dot 1, 2 (0x03)
  assert.equal(charToDotMask('⠃'), 0x03);
  // \u280B = dot 1, 2, 4 (0x0B)
  assert.equal(charToDotMask('⠋'), 0x0B);
  // \u283F = full 6-dot cell (0x3F)
  assert.equal(charToDotMask('⠿'), 0x3F);
  // \u28FF = full 8-dot cell (0xFF)
  assert.equal(charToDotMask('⣿'), 0xFF);
});

test('charToDotMask: ASCII BRF characters', () => {
  assert.equal(charToDotMask(' '), 0x00);
  assert.equal(charToDotMask('a'), 0x01);
  assert.equal(charToDotMask('b'), 0x03);
  assert.equal(charToDotMask('c'), 0x09);
  assert.equal(charToDotMask('1'), 0x02);
});

test('lineToDotMasks: slices and pads correctly', () => {
  const line = '⠁⠃⠉'; // 3 chars
  const masks = lineToDotMasks(line, 32);
  assert.equal(masks.length, 32);
  assert.equal(masks[0], 0x01);
  assert.equal(masks[1], 0x03);
  assert.equal(masks[2], 0x09);
  assert.equal(masks[3], 0x00);
  assert.equal(masks[31], 0x00);
});

test('formatTactileViewport: produces 10-line x 32-cell viewports for Monarch', () => {
  const rows = [
    'Line 1: ⠠⠓⠑⠇⠇⠕',
    'Line 2: ⠠⠺⠕⠗⠇⠙',
    'Line 3: ⠠⠍⠕⠝⠁⠗⠉⠓',
    'Line 4', 'Line 5', 'Line 6', 'Line 7', 'Line 8', 'Line 9', 'Line 10',
    'Line 11', 'Line 12', 'Line 13'
  ];

  // First page (lines 0 to 9)
  const vp1 = formatTactileViewport(rows, { startLine: 0, width: 32, lines: 10 });
  assert.equal(vp1.lines.length, 10);
  assert.equal(vp1.lines[0].length, 32);
  assert.equal(vp1.startLine, 0);
  assert.equal(vp1.totalLines, 13);
  assert.equal(vp1.hasNext, true);
  assert.equal(vp1.hasPrev, false);

  // Second page (lines 10 to 12)
  const vp2 = formatTactileViewport(rows, { startLine: 10, width: 32, lines: 10 });
  assert.equal(vp2.lines.length, 10);
  assert.equal(vp2.startLine, 10);
  assert.equal(vp2.hasNext, false);
  assert.equal(vp2.hasPrev, true);
});

test('encodeHumanWareFrame: binary packet structure', () => {
  const line1 = new Uint8Array(32);
  line1[0] = 0x01;
  const line2 = new Uint8Array(32);
  line2[0] = 0x03;
  const lines = [line1, line2];

  const packet = encodeHumanWareFrame(lines);
  // Header: 0x1B, 'M', 2 lines, 32 width
  assert.equal(packet[0], 0x1B);
  assert.equal(packet[1], 0x4D);
  assert.equal(packet[2], 2);
  assert.equal(packet[3], 32);
  // Line 0
  assert.equal(packet[4], 0); // index 0
  assert.equal(packet[5], 0x01);
  // Line 1
  assert.equal(packet[4 + 33], 1); // index 1
  assert.equal(packet[4 + 33 + 1], 0x03);
});

test('encodeDotPadLinePacket: encodes single text line (20 cells)', () => {
  const textCells = new Uint8Array(20).fill(0xFF);
  const packet = encodeDotPadLinePacket(0, true, 0, textCells);

  // Sync AA 55, Len MSB 00, Len LSB 1A (26 bytes), DestId 00, Cmd 02 00, Mode 80, StartCell 00, 20 data bytes, 1 checksum = 30 bytes
  assert.equal(packet.length, 30);
  assert.equal(packet[0], 0xAA);
  assert.equal(packet[1], 0x55);
  assert.equal(packet[2], 0x00);
  assert.equal(packet[3], 0x1A); // 26
  assert.equal(packet[4], 0x00); // Line 0
  assert.equal(packet[5], 0x02); // Cmd MSB
  assert.equal(packet[6], 0x00); // Cmd LSB
  assert.equal(packet[7], 0x80); // Mode Text
  assert.equal(packet[8], 0x00); // StartCell 0
  assert.equal(packet[9], 0xFF);
  assert.equal(packet[28], 0xFF);

  // Checksum XOR verification
  const cs = calculateDotPadChecksum(packet.subarray(4, 29));
  assert.equal(packet[29], cs);
});

test('encodeDotPadLinePacket: encodes graphic line (30 cells)', () => {
  const graphCells = new Uint8Array(30).fill(0x01);
  const packet = encodeDotPadLinePacket(1, false, 0, graphCells);

  // Length = 5 + 1 + 30 = 36 = 0x24. Packet length = 4 + 36 = 40 bytes
  assert.equal(packet.length, 40);
  assert.equal(packet[0], 0xAA);
  assert.equal(packet[1], 0x55);
  assert.equal(packet[2], 0x00);
  assert.equal(packet[3], 0x24);
  assert.equal(packet[4], 0x01); // Line 1
  assert.equal(packet[7], 0x00); // Mode Graphic
  assert.equal(packet[9], 0x01);

  const cs = calculateDotPadChecksum(packet.subarray(4, 39));
  assert.equal(packet[39], cs);
});

test('encodeDotPadDualZonePackets: encodes 11 discrete line packets (1 text + 10 graphic)', () => {
  const graphics = new Uint8Array(300);
  graphics[0] = 0xFF; // Top-left cell active
  graphics[299] = 0x01; // Bottom-right cell active

  const brailleLine = '⠠⠙⠕⠞⠏⠁⠙'; // "Dotpad"
  const packets = encodeDotPadDualZonePackets(graphics, brailleLine);

  assert.equal(packets.length, 11);
  // Packet 0: text row
  assert.equal(packets[0][4], 0x00); // Dest Line 0
  assert.equal(packets[0][7], 0x80); // Text mode
  assert.equal(packets[0][9], standardBrailleToDotPadPinByte(charToDotMask('⠠')));

  // Packets 1..10: graphic rows
  for (let l = 1; l <= 10; l++) {
    assert.equal(packets[l][4], l);
    assert.equal(packets[l][7], 0x00); // Graphic mode
  }
  assert.equal(packets[1][9], standardBrailleToDotPadPinByte(0xFF)); // First graphic cell
  assert.equal(packets[10][9 + 29], standardBrailleToDotPadPinByte(0x01)); // Last graphic cell
});

test('encodeHidBrailleReport: report formatting', () => {
  const cells = new Uint8Array(32);
  cells[0] = 0x07;
  const report = encodeHidBrailleReport(1, cells);
  assert.equal(report.length, 33);
  assert.equal(report[0], 1);
  assert.equal(report[1], 0x07);
});

test('TactileDisplayManager: Monarch lifecycle & navigation', async () => {
  const manager = new TactileDisplayManager();
  assert.equal(manager.isConnected(), false);

  let connectFired = false;
  let viewportCount = 0;
  manager.subscribe((event, data) => {
    if (event === 'connect') connectFired = true;
    if (event === 'viewport') viewportCount++;
  });

  const res = await manager.connect({ transport: 'simulated' });
  assert.equal(res.success, true);
  assert.equal(manager.isConnected(), true);
  assert.equal(connectFired, true);

  const sampleBraille = Array.from({ length: 25 }, (_, i) => `Row ${i + 1} braille: ⠠⠓⠑⠇⠇⠕`);
  await manager.updateBraille(sampleBraille);
  assert.equal(manager.currentStartLine, 0);

  // Next page
  await manager.nextPage();
  assert.equal(manager.currentStartLine, 10);

  // Next page
  await manager.nextPage();
  assert.equal(manager.currentStartLine, 20);

  // Prev page
  await manager.prevPage();
  assert.equal(manager.currentStartLine, 10);

  // Jump to specific page via setPage
  await manager.setPage(3);
  assert.equal(manager.currentStartLine, 20);
  await manager.setPage(1);
  assert.equal(manager.currentStartLine, 0);

  // Cursor auto-follow to line 22
  await manager.updateBraille(sampleBraille, 22);
  assert.equal(manager.currentStartLine, 20);

  await manager.disconnect();
  assert.equal(manager.isConnected(), false);
});

test('expand20CellsTo30DotPadBytes: converts 20-cell line with 1-pin spacer column to 30 DotPad bytes', () => {
  const cells = new Uint8Array(20);
  cells[0] = 0x3F; // Full 6-dot cell in cell 0 (pins 0 and 1)
  cells[1] = 0x3F; // Full 6-dot cell in cell 1 (pins 3 and 4)
  const bytes30 = expand20CellsTo30DotPadBytes(cells);

  assert.equal(bytes30.length, 30);
  // Byte 0 (pins 0 & 1) contains cell 0
  assert.equal(bytes30[0], 0x3F);
  // Byte 1 (pins 2 & 3): pin 2 is blank spacer (left col = 0), pin 3 is left col of cell 1 (right col = 0x38)
  assert.equal(bytes30[1], 0x38); // bits 3,4,5
  // Byte 2 (pins 4 & 5): pin 4 is right col of cell 1 (left col = 0x07), pin 5 is blank spacer (right col = 0)
  assert.equal(bytes30[2], 0x07); // bits 0,1,2
});

test('TactileDisplayManager: DotPad dual-zone connection & simulation', async () => {
  const manager = new TactileDisplayManager();
  const res = await manager.connect({ transport: 'dotpad-simulated', target: 'dotpad' });
  assert.equal(res.success, true);
  assert.equal(manager.isConnected(), true);
  assert.equal(manager.deviceProfile.width, 20);
  assert.equal(manager.deviceProfile.lines, 10);
  assert.equal(manager.deviceProfile.brailleCells, 20);

  const sampleBraille = ['Line 1: ⠠⠙⠕⠞⠏⠁⠙', 'Line 2: ⠠⠞⠑⠎⠞'];
  await manager.updateBraille(sampleBraille);
  assert.equal(manager.currentStartLine, 0);

  await manager.disconnect();
  assert.equal(manager.isConnected(), false);
});

test('packPixelsToDotPadHex: column-swapped nibble packing', () => {
  const pixels = new Uint8Array(60 * 40); // 60 wide x 40 tall
  // Top-left pixel (x=0, y=0) in first cell -> x^1 = 1 -> second nibble has bit 0 set
  pixels[0] = 1;
  const hex = packPixelsToDotPadHex(pixels, 60, 40, 10);
  assert.equal(hex.length, 600); // 60 * 10 nibbles
  assert.equal(hex[0], '0');
  assert.equal(hex[1], '1');
});

test('rasterizeSvgToDotPadCells: graceful fallback without DOM', async () => {
  const matrix = await rasterizeSvgToDotPadCells('<svg></svg>');
  assert.equal(matrix instanceof Uint8Array, true);
  assert.equal(matrix.length, 300);
});

test('zhangSuenThinning: reduces thick multi-pixel strokes to 1-pixel connected skeletons', async () => {
  const { zhangSuenThinning } = await import('../format/tactile-display.mjs');
  // 12x12 grid with a 3-pixel thick horizontal stroke
  const width = 12, height = 12;
  const grid = new Uint8Array(width * height);
  for (let y = 4; y <= 6; y++) {
    for (let x = 2; x <= 9; x++) {
      grid[y * width + x] = 1;
    }
  }

  const beforeCount = grid.filter(p => p === 1).length;
  assert.equal(beforeCount, 24); // 3 rows * 8 cols

  zhangSuenThinning(grid, width, height);

  const afterCount = grid.filter(p => p === 1).length;
  assert.ok(afterCount < beforeCount, 'Thinning should remove outer and interior pixels');
  assert.ok(afterCount >= 4 && afterCount <= 8, 'Should reduce 3-pixel thick stroke to 1-pixel skeleton');
});

test('TactileDisplayManager: getDotPadActiveFrame formats 20x10 standalone when disconnected', async () => {
  const manager = new TactileDisplayManager();
  assert.equal(manager.isConnected(), false);

  const sampleBraille = [
    '⠠⠞⠓⠊⠎⠀⠊⠎⠀⠁⠀⠇⠕⠝⠛⠀⠃⠗⠁⠊⠇⠇⠑⠀⠇⠊⠝⠑⠀⠞⠓⠁⠞⠀⠑⠭⠉⠑⠑⠙⠎⠀⠞⠺⠑⠝⠞⠽⠀⠉⠑⠇⠇⠎',
    '⠠⠎⠑⠉⠕⠝⠙⠀⠇⠊⠝⠑⠀⠕⠋⠀⠞⠑⠭⠞'
  ];
  await manager.updateBraille(sampleBraille);

  const frame = manager.getDotPadActiveFrame();
  assert.equal(frame.pageNumber, 1);
  assert.equal(frame.viewportLines.length, 10);
  assert.equal(frame.viewportLines[0].length, 20);
  assert.equal(typeof frame.brailleLine, 'string');
});
