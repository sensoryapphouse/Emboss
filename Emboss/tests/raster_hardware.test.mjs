import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelToTigerHeight, encodeTigerPrn } from '../format/tiger-raster.mjs';
import { encodeIndexGraphicStream } from '../format/index-raster.mjs';

test('Tiger Raster: pixelToTigerHeight maps luminance to 8 distinct dot heights', () => {
  // Pure white (255, 255, 255) -> 0 (no dot)
  assert.equal(pixelToTigerHeight(255, 255, 255), 0);
  // Pure black (0, 0, 0) -> 7 (maximum height)
  assert.equal(pixelToTigerHeight(0, 0, 0), 7);
  // Dark gray (60, 60, 60) -> high dot (5..6)
  const darkH = pixelToTigerHeight(60, 60, 60);
  assert.ok(darkH >= 5 && darkH <= 6);
  // Light gray (200, 200, 200) -> low dot (1..2)
  const lightH = pixelToTigerHeight(200, 200, 200);
  assert.ok(lightH >= 1 && lightH <= 2);
});

test('Tiger Raster: encodeTigerPrn outputs valid ViewPlus escape sequences', () => {
  const grid = [
    [7, 0, 3, 0],
    [0, 5, 0, 2]
  ];
  const bytes = encodeTigerPrn(grid);
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 10);
  // Starts with ESC * r 1 A (0x1b, 0x2a, 0x72, 0x31, 0x41)
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x2a);
  assert.equal(bytes[2], 0x72);
  assert.equal(bytes[3], 0x31);
  assert.equal(bytes[4], 0x41);
  // Concludes with Form Feed (0x0c)
  assert.equal(bytes[bytes.length - 1], 0x0c);
});

test('Index Raster: encodeIndexGraphicStream outputs valid Index ESC +g packets', () => {
  const bitMatrix = [
    [true, false, true, false],
    [false, true, false, true],
    [true, true, true, true],
    [false, false, false, false],
    [true, false, false, true],
    [false, true, true, false],
    [false, false, false, false],
    [true, true, true, true]
  ];
  const bytes = encodeIndexGraphicStream(bitMatrix);
  assert.ok(bytes instanceof Uint8Array);
  // Header: ESC + g (0x1b, 0x2b, 0x67)
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x2b);
  assert.equal(bytes[2], 0x67);
  // Trailer: ESC FF (0x1b, 0x0c)
  assert.equal(bytes[bytes.length - 2], 0x1b);
  assert.equal(bytes[bytes.length - 1], 0x0c);
});
