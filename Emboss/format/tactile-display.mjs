// Multi-line tactile display driver for APH Monarch (32x10), DotPad (30x10 + 20 Braille),
// and standard USB-IF HID Braille Displays.
// Provides live streaming of translated braille viewports and tactile graphics via WebBluetooth,
// WebHID, and WebSerial APIs without requiring external SDKs or native driver installations.

/**
 * Checks if the Web Bluetooth API is supported in the current browser.
 * @returns {boolean}
 */
export function isWebBluetoothSupported() {
  return typeof globalThis !== 'undefined' && Boolean(globalThis.navigator?.bluetooth);
}

const BRF64 = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=";
const BRF_TO_DOTS = (() => {
  const m = new Map();
  for (let i = 0; i < 64; i++) m.set(BRF64[i], i);
  return m;
})();

/**
 * Converts a single character (Unicode braille \u2800-\u28FF, ASCII BRF, or alphanumeric) to an 8-dot bitmask byte.
 * Bit 0 = Dot 1, Bit 1 = Dot 2, Bit 2 = Dot 3, Bit 3 = Dot 4,
 * Bit 4 = Dot 5, Bit 5 = Dot 6, Bit 6 = Dot 7, Bit 7 = Dot 8.
 * @param {string} ch
 * @returns {number} 8-bit unsigned integer (0x00 - 0xFF)
 */
export function charToDotMask(ch) {
  if (!ch) return 0;
  const code = ch.charCodeAt(0);
  // Unicode Braille Patterns: U+2800 to U+28FF
  if (code >= 0x2800 && code <= 0x28ff) {
    return code - 0x2800;
  }
  // Standard North American Braille ASCII (BRF)
  const d = BRF_TO_DOTS.get(ch) ?? BRF_TO_DOTS.get(ch.toUpperCase());
  return d !== undefined ? d : 0x00;
}

/**
 * Converts a string line of braille or text into a Uint8Array of cell dot bitmasks.
 * @param {string} line
 * @param {number} width - Target cell width (e.g. 32 for Monarch, 30 or 20 for DotPad)
 * @returns {Uint8Array}
 */
export function lineToDotMasks(line = '', width = 32) {
  const result = new Uint8Array(width);
  const chars = Array.from(line || '');
  for (let i = 0; i < width; i++) {
    result[i] = i < chars.length ? charToDotMask(chars[i]) : 0x00;
  }
  return result;
}

/**
 * Formats a document's full braille rows into a 10-line x N-cell viewport frame.
 * @param {string[]|string} braille - Array of braille row strings or newline-separated text.
 * @param {Object} options
 * @param {number} [options.startLine=0] - 0-indexed top line of the viewport.
 * @param {number} [options.width=32] - Display width in cells (Monarch=32, DotPad=30).
 * @param {number} [options.lines=10] - Display height in lines (default=10).
 * @returns {{ lines: Uint8Array[], startLine: number, totalLines: number, hasNext: boolean, hasPrev: boolean, textRows: string[] }}
 */
export function formatTactileViewport(braille = [], { startLine = 0, width = 32, lines = 10 } = {}) {
  const rawRows = Array.isArray(braille) ? braille : String(braille || '').split(/\r?\n/);
  const totalLines = Math.max(1, rawRows.length);
  const safeStart = Math.max(0, Math.min(startLine, Math.max(0, totalLines - 1)));
  
  const textRows = [];
  const lineMasks = [];

  for (let i = 0; i < lines; i++) {
    const lineIdx = safeStart + i;
    const rowText = lineIdx < rawRows.length ? rawRows[lineIdx] : '';
    textRows.push(rowText.slice(0, width).padEnd(width, ' '));
    lineMasks.push(lineToDotMasks(rowText, width));
  }

  return {
    lines: lineMasks,
    startLine: safeStart,
    totalLines,
    width,
    displayLines: lines,
    hasNext: safeStart + lines < totalLines,
    hasPrev: safeStart > 0,
    textRows
  };
}

/**
 * HumanWare / APH Monarch packet framing.
 * Encodes a 32x10 multi-line tactile frame into standard command packets.
 * @param {Uint8Array[]} lines - Array of 10 line bitmask arrays (each 32 bytes).
 * @returns {Uint8Array} Packed binary frame ready for transmission over WebHID/WebSerial.
 */
export function encodeHumanWareFrame(lines) {
  const numLines = lines.length;
  const width = lines[0]?.length || 32;
  const packetSize = 4 + numLines * (1 + width);
  const buffer = new Uint8Array(packetSize);
  
  buffer[0] = 0x1b; // ESC
  buffer[1] = 0x4d; // 'M' = Multi-line Display Matrix
  buffer[2] = numLines;
  buffer[3] = width;
  
  let offset = 4;
  for (let i = 0; i < numLines; i++) {
    buffer[offset++] = i; // Line index (0-9)
    buffer.set(lines[i], offset);
    offset += width;
  }
  
  return buffer;
}

/**
 * Maps an ISO standard 8-dot Braille byte mask into DotPad's physical pin byte layout.
 * Standard Braille: Dot 1 (bit 0), Dot 2 (bit 1), Dot 3 (bit 2), Dot 4 (bit 3),
 *                   Dot 5 (bit 4), Dot 6 (bit 5), Dot 7 (bit 6), Dot 8 (bit 7).
 * DotPad Pin Layout:
 *   Left col:  Dot 1 (bit 0), Dot 2 (bit 1), Dot 3 (bit 2), Dot 7 (bit 3).
 *   Right col: Dot 4 (bit 4), Dot 5 (bit 5), Dot 6 (bit 6), Dot 8 (bit 7).
 * @param {number} b - 8-bit unsigned integer (0x00 - 0xFF)
 * @returns {number} 8-bit unsigned integer (0x00 - 0xFF)
 */
export function standardBrailleToDotPadPinByte(b) {
  const d1 = (b >> 0) & 1; // Dot 1
  const d2 = (b >> 1) & 1; // Dot 2
  const d3 = (b >> 2) & 1; // Dot 3
  const d4 = (b >> 3) & 1; // Dot 4
  const d5 = (b >> 4) & 1; // Dot 5
  const d6 = (b >> 5) & 1; // Dot 6
  const d7 = (b >> 6) & 1; // Dot 7
  const d8 = (b >> 7) & 1; // Dot 8

  return (d1 << 0) | (d2 << 1) | (d3 << 2) | (d7 << 3) |
         (d4 << 4) | (d5 << 5) | (d6 << 6) | (d8 << 7);
}

/**
 * Computes the XOR checksum with seed 0xA5 for DotPad command frames.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function calculateDotPadChecksum(bytes) {
  let c = 0xa5;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
  }
  return c & 0xff;
}

/**
 * Encodes a single line packet for the DotPad display.
 * Header: [0xAA, 0x55, LEN_MSB, LEN_LSB, DEST_LINE_ID, 0x02, 0x00, MODE, START_CELL, ...DATA, CHECKSUM]
 * @param {number} lineId - 0 for 20-cell braille line, 1..10 for 30-cell graphics lines.
 * @param {boolean} isTextMode - true for text mode (0x80), false for graphics mode (0x00).
 * @param {number} startCell - Start cell index (0-based, default 0).
 * @param {Uint8Array|number[]} dataBytes - Cell bitmasks (20 bytes for line 0, 30 bytes for lines 1-10).
 * @returns {Uint8Array}
 */
export function encodeDotPadLinePacket(lineId = 0, isTextMode = false, startCell = 0, dataBytes = new Uint8Array(lineId === 0 ? 20 : 30)) {
  const rawBytes = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(dataBytes);
  const bytes = new Uint8Array(rawBytes.length);
  for (let i = 0; i < rawBytes.length; i++) {
    bytes[i] = standardBrailleToDotPadPinByte(rawBytes[i]);
  }
  const mode = isTextMode ? 0x80 : 0x00;
  const payloadLen = 1 + bytes.length; // 1 byte startCell + N bytes data
  const totalLen = 5 + payloadLen; // 2 byte command + 1 byte mode + payloadLen
  
  const packet = new Uint8Array(4 + totalLen);
  packet[0] = 0xaa;
  packet[1] = 0x55;
  packet[2] = (totalLen >> 8) & 0xff;
  packet[3] = totalLen & 0xff;
  packet[4] = lineId & 0xff;
  packet[5] = 0x02; // Command MSB
  packet[6] = 0x00; // Command LSB
  packet[7] = mode;
  packet[8] = startCell & 0xff;
  packet.set(bytes, 9);
  
  const checksumRegion = packet.subarray(4, 9 + bytes.length);
  packet[9 + bytes.length] = calculateDotPadChecksum(checksumRegion);
  return packet;
}

/**
 * Expands a 20-cell braille row (each cell 2 pins wide) into a 30-cell / 60-pin DotPad line
 * by inserting a 1-pin blank column separator between adjacent cells (2 pins cell + 1 pin gap = 3 pins/cell).
 * @param {Uint8Array|number[]} cells20 - 20 bytes of braille dot masks.
 * @returns {Uint8Array} 30 bytes for DotPad hardware line packet.
 */
export function expand20CellsTo30DotPadBytes(cells20) {
  const result = new Uint8Array(30);
  const src = cells20 instanceof Uint8Array ? cells20 : new Uint8Array(cells20 || 20);

  for (let r = 0; r < 4; r++) {
    const leftBit = (r === 0 ? 0x01 : (r === 1 ? 0x02 : (r === 2 ? 0x04 : 0x40)));
    const rightBit = (r === 0 ? 0x08 : (r === 1 ? 0x10 : (r === 2 ? 0x20 : 0x80)));

    for (let c = 0; c < 60; c++) {
      const cellIdx = Math.floor(c / 3);
      const colInCell = c % 3;
      let isSet = false;
      if (colInCell === 0 && cellIdx < src.length) {
        isSet = Boolean(src[cellIdx] & leftBit);
      } else if (colInCell === 1 && cellIdx < src.length) {
        isSet = Boolean(src[cellIdx] & rightBit);
      }
      // colInCell === 2 is the 1-pin blank spacer column

      if (isSet) {
        const outByteIdx = Math.floor(c / 2);
        const isOutRight = (c % 2) === 1;
        const outBit = isOutRight ? rightBit : leftBit;
        result[outByteIdx] |= outBit;
      }
    }
  }
  return result;
}

/**
 * Encodes a complete multi-line dual-zone update for DotPad (300 cells graphic area + 20 cells braille row).
 * Returns an array of 11 discrete line packets (Line 0 for text, Lines 1-10 for graphics).
 * @param {Uint8Array|Uint8Array[]} graphicCells - 300 bytes (graphic), 200 bytes (20-cell text), or array of 10 rows.
 * @param {Uint8Array|string} brailleCells - 20 bytes (or 20-char string) for the bottom text line.
 * @returns {Uint8Array[]} Array of 11 packets [line0Packet, line1Packet, ..., line10Packet].
 */
export function encodeDotPadDualZonePackets(graphicCells = new Uint8Array(300), brailleCells = new Uint8Array(20)) {
  const packets = [];

  // Line 0: Text row (20 cells)
  let bBytes = new Uint8Array(20);
  if (typeof brailleCells === 'string') {
    bBytes = lineToDotMasks(brailleCells, 20);
  } else if (brailleCells instanceof Uint8Array) {
    bBytes.set(brailleCells.subarray(0, 20));
  }
  packets.push(encodeDotPadLinePacket(0, true, 0, bBytes));

  // Lines 1..10: Graphic area (30 cells per line)
  if (Array.isArray(graphicCells)) {
    for (let l = 1; l <= 10; l++) {
      const row = graphicCells[l - 1] || new Uint8Array(30);
      let rowBytes;
      if (row.length === 20) {
        rowBytes = expand20CellsTo30DotPadBytes(row);
      } else {
        rowBytes = new Uint8Array(30);
        rowBytes.set(row.subarray(0, 30));
      }
      packets.push(encodeDotPadLinePacket(l, false, 0, rowBytes));
    }
  } else if (graphicCells instanceof Uint8Array) {
    if (graphicCells.length === 200) {
      for (let l = 1; l <= 10; l++) {
        const row20 = graphicCells.subarray((l - 1) * 20, l * 20);
        const rowBytes = expand20CellsTo30DotPadBytes(row20);
        packets.push(encodeDotPadLinePacket(l, false, 0, rowBytes));
      }
    } else {
      for (let l = 1; l <= 10; l++) {
        const rowBytes = new Uint8Array(30);
        rowBytes.set(graphicCells.subarray((l - 1) * 30, l * 30));
        packets.push(encodeDotPadLinePacket(l, false, 0, rowBytes));
      }
    }
  } else {
    for (let l = 1; l <= 10; l++) {
      packets.push(encodeDotPadLinePacket(l, false, 0, new Uint8Array(30)));
    }
  }

  return packets;
}

/**
 * Backward compatibility helper for legacy dual-zone callers.
 * Returns the array of 11 packets.
 */
export function encodeDotPadDualZoneFrame(graphicCells = new Uint8Array(300), brailleCells = new Uint8Array(20)) {
  return encodeDotPadDualZonePackets(graphicCells, brailleCells);
}

/**
 * Packs a 0/1 pixel buffer into the DotPad SDK per-cell hex byte format
 * (each cell is 2 dots wide x 4 dots tall).
 * Left and right nibbles in each 2-pin cell are column-swapped ((x ^ 1)).
 * @param {Uint8Array|number[]} pixels - 0/1 pixel array (width * height).
 * @param {number} displayW - Grid width in pins (default 60 for 30 cells).
 * @param {number} displayH - Grid height in pins (default 40 for 10 rows).
 * @param {number} numRows - Number of cell rows (default 10).
 * @returns {string} Hex string representation for DotPad SDK.
 */
export function packPixelsToDotPadHex(pixels, displayW = 60, displayH = 40, numRows = 10) {
  const nibbles = new Uint8Array(displayW * numRows);
  for (let y = 0; y < displayH; y++) {
    const band = Math.floor(y / 4);
    const bit = y % 4;
    for (let x = 0; x < displayW; x++) {
      if (pixels[y * displayW + x]) {
        nibbles[(x ^ 1) + band * displayW] |= (1 << bit);
      }
    }
  }
  return Array.from(nibbles, (n) => n.toString(16).toUpperCase()).join('');
}

/**
 * Rasterizes an SVG string to a 300-byte cell matrix (30x10 cells, 60x40 pins) for DotPad.
 * If the SVG contains precomputed `data-dotpad-matrix`, it directly decodes the hex bytes.
 * Otherwise, uses high-precision subpixel sampling to ensure thin vector lines, coordinate curves,
 * and braille tick labels are captured with crisp 1-pin fidelity without bilinear blooming.
 * @param {string} svgString - Tactile SVG vector content.
 * @param {number} [widthPins=60] - Width in pins (default 60 for 30 cells).
 * @param {number} [heightPins=40] - Height in pins (default 40 for 10 rows).
 * @returns {Promise<Uint8Array>} 300-byte array where each byte is an 8-pin cell mask.
 */
/**
 * Zhang-Suen parallel morphological thinning algorithm.
 * Reduces 2D binary masks/strokes down to 1-pin continuous topological skeletons.
 * @param {Uint8Array} grid - 1D array of width * height (0 or 1)
 * @param {number} width
 * @param {number} height
 */
export function zhangSuenThinning(grid, width, height) {
  let changed = true;
  const get = (x, y) => (x >= 0 && x < width && y >= 0 && y < height ? (grid[y * width + x] ? 1 : 0) : 0);

  while (changed) {
    changed = false;
    const toDelete1 = [];

    // Step 1
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!grid[y * width + x]) continue;

        const p2 = get(x, y - 1);
        const p3 = get(x + 1, y - 1);
        const p4 = get(x + 1, y);
        const p5 = get(x + 1, y + 1);
        const p6 = get(x, y + 1);
        const p7 = get(x - 1, y + 1);
        const p8 = get(x - 1, y);
        const p9 = get(x - 1, y - 1);

        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;

        const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let a = 0;
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] === 0 && neighbors[i + 1] === 1) a++;
        }
        if (a !== 1) continue;

        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;

        toDelete1.push(y * width + x);
      }
    }

    for (const idx of toDelete1) {
      grid[idx] = 0;
      changed = true;
    }

    const toDelete2 = [];
    // Step 2
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (!grid[y * width + x]) continue;

        const p2 = get(x, y - 1);
        const p3 = get(x + 1, y - 1);
        const p4 = get(x + 1, y);
        const p5 = get(x + 1, y + 1);
        const p6 = get(x, y + 1);
        const p7 = get(x - 1, y + 1);
        const p8 = get(x - 1, y);
        const p9 = get(x - 1, y - 1);

        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;

        const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let a = 0;
        for (let i = 0; i < 8; i++) {
          if (neighbors[i] === 0 && neighbors[i + 1] === 1) a++;
        }
        if (a !== 1) continue;

        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;

        toDelete2.push(y * width + x);
      }
    }

    for (const idx of toDelete2) {
      grid[idx] = 0;
      changed = true;
    }
  }
}

/**
 * Rasterizes an SVG string to a 300-byte cell matrix (30x10 cells, 60x40 pins) for DotPad.
 * If the SVG contains precomputed `data-dotpad-matrix`, it directly decodes the hex bytes.
 * Otherwise, uses high-precision edge extraction and morphological thinning to guarantee crisp
 * 1-pin continuous contours without anti-aliasing blooming or unreadable solid-fill plateaus.
 * @param {string} svgString - Tactile SVG vector content.
 * @param {number} [widthPins=60] - Width in pins (default 60 for 30 cells).
 * @param {number} [heightPins=40] - Height in pins (default 40 for 10 rows).
 * @returns {Promise<Uint8Array>} 300-byte array where each byte is an 8-pin cell mask.
 */
export async function rasterizeSvgToDotPadCells(svgString, widthPins = 60, heightPins = 40) {
  if (!svgString) {
    return new Uint8Array(300);
  }

  // 1. Direct hex decoding if SVG carries precomputed discrete pin matrix
  if (typeof svgString === 'string' && svgString.includes('data-dotpad-matrix=')) {
    const m = svgString.match(/data-dotpad-matrix=["']([0-9a-fA-F]+)["']/);
    if (m && m[1] && m[1].length >= 600) {
      const hex = m[1];
      const bytes = new Uint8Array(300);
      for (let i = 0; i < 300; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      return bytes;
    }
  }

  if (typeof document === 'undefined') {
    return new Uint8Array(300);
  }

  return new Promise((resolve) => {
    try {
      const renderW = 600;
      const renderH = Math.round(renderW * (heightPins / widthPins));
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = renderW;
      sampleCanvas.height = renderH;
      const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sCtx) return resolve(new Uint8Array(300));

      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, renderW, renderH);

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        sCtx.drawImage(img, 0, 0, renderW, renderH);
        URL.revokeObjectURL(url);

        const highResData = sCtx.getImageData(0, 0, renderW, renderH).data;
        const matrix = new Uint8Array(300); // 30 cols x 10 rows

        const sampleStepX = renderW / widthPins;
        const sampleStepY = renderH / heightPins;
        const radiusX = Math.max(1, Math.floor(sampleStepX * 0.45));
        const radiusY = Math.max(1, Math.floor(sampleStepY * 0.45));

        const binaryGrid = new Uint8Array(widthPins * heightPins);

        for (let r = 0; r < heightPins; r++) {
          for (let c = 0; c < widthPins; c++) {
            const centerX = Math.floor((c + 0.5) * sampleStepX);
            const centerY = Math.floor((r + 0.5) * sampleStepY);

            let maxInverted = 0;
            for (let dy = -radiusY; dy <= radiusY; dy++) {
              const sy = centerY + dy;
              if (sy < 0 || sy >= renderH) continue;
              for (let dx = -radiusX; dx <= radiusX; dx++) {
                const sx = centerX + dx;
                if (sx < 0 || sx >= renderW) continue;
                const idx = (sy * renderW + sx) * 4;
                const red = highResData[idx];
                const green = highResData[idx + 1];
                const blue = highResData[idx + 2];
                const alpha = highResData[idx + 3];
                if (alpha > 32) {
                  const brightness = 0.299 * red + 0.587 * green + 0.114 * blue;
                  const inv = (255 - brightness) * (alpha / 255);
                  if (inv > maxInverted) maxInverted = inv;
                }
              }
            }
            if (maxInverted >= 75) {
              binaryGrid[r * widthPins + c] = 1;
            }
          }
        }

        // Apply Morphological Thinning to reduce thick anti-aliased strokes to crisp 1-pin contours
        zhangSuenThinning(binaryGrid, widthPins, heightPins);

        for (let cellRow = 0; cellRow < 10; cellRow++) {
          for (let cellCol = 0; cellCol < 30; cellCol++) {
            const px = cellCol * 2;
            const py = cellRow * 4;

            const d1 = binaryGrid[py * widthPins + px] ? 1 : 0;
            const d2 = binaryGrid[(py + 1) * widthPins + px] ? 1 : 0;
            const d3 = binaryGrid[(py + 2) * widthPins + px] ? 1 : 0;
            const d4 = binaryGrid[py * widthPins + (px + 1)] ? 1 : 0;
            const d5 = binaryGrid[(py + 1) * widthPins + (px + 1)] ? 1 : 0;
            const d6 = binaryGrid[(py + 2) * widthPins + (px + 1)] ? 1 : 0;
            const d7 = binaryGrid[(py + 3) * widthPins + px] ? 1 : 0;
            const d8 = binaryGrid[(py + 3) * widthPins + (px + 1)] ? 1 : 0;

            const mask = (d1 << 0) | (d2 << 1) | (d3 << 2) | (d4 << 3) |
                         (d5 << 4) | (d6 << 5) | (d7 << 6) | (d8 << 7);
            matrix[cellRow * 30 + cellCol] = mask;
          }
        }

        resolve(matrix);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(new Uint8Array(300));
      };

      img.src = url;
    } catch {
      resolve(new Uint8Array(300));
    }
  });
}

/**
 * Standard USB-IF HID Braille Display Output Report encoder (Usage Page 0x41).
 * @param {number} reportId
 * @param {Uint8Array} cellMasks
 * @returns {Uint8Array}
 */
export function encodeHidBrailleReport(reportId = 0x00, cellMasks = new Uint8Array(32)) {
  const report = new Uint8Array(1 + cellMasks.length);
  report[0] = reportId;
  report.set(cellMasks, 1);
  return report;
}

/**
 * Multi-Line Tactile Display Manager Singleton.
 * Supports APH Monarch (32x10), DotPad (30x10 + 20 Braille), and USB-IF HID Braille Displays.
 */
export class TactileDisplayManager {
  constructor() {
    this.connection = null; // { type: 'hid'|'serial'|'bluetooth'|'simulated', device: any, port: any, characteristic: any }
    this.deviceProfile = { id: 'monarch', name: 'APH Monarch Dynamic Display', width: 32, lines: 10, brailleCells: 0 };
    this.currentStartLine = 0;
    this.activeLineIndex = 0;
    this.lastBraille = [];
    this.lastGraphic = null;
    this.autoFollowCursor = true;
    this.listeners = new Set();
  }

  isSupported() {
    return typeof globalThis !== 'undefined' && (
      Boolean(globalThis.navigator?.hid) ||
      Boolean(globalThis.navigator?.serial) ||
      Boolean(globalThis.navigator?.bluetooth)
    );
  }

  isConnected() {
    return this.connection !== null;
  }

  setDeviceProfile(profileId = 'monarch') {
    if (profileId === 'dotpad') {
      this.deviceProfile = { id: 'dotpad', name: 'DotPad Dynamic Display', width: 20, lines: 10, brailleCells: 20 };
    } else {
      this.deviceProfile = { id: 'monarch', name: 'APH Monarch Dynamic Display', width: 32, lines: 10, brailleCells: 0 };
    }
  }

  getDeviceProfile() {
    return { ...this.deviceProfile };
  }

  getConnectionInfo() {
    if (!this.connection) return { connected: false, startLine: 0, lines: 10, width: 32 };
    return {
      connected: true,
      type: this.connection.type,
      name: this.connection.name || 'Tactile Display',
      width: this.deviceProfile.width,
      lines: this.deviceProfile.lines,
      brailleCells: this.deviceProfile.brailleCells,
      startLine: this.currentStartLine,
      profile: this.getDeviceProfile(),
      viewport: {
        startLine: this.currentStartLine,
        width: this.deviceProfile.width,
        lines: this.deviceProfile.lines
      }
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, data) {
    for (const fn of this.listeners) {
      try { fn(event, data); } catch (e) { console.error('Tactile display listener error:', e); }
    }
  }

  handleHardwareInput(dataView) {
    if (!dataView || dataView.byteLength === 0) return;
    const bytes = new Uint8Array(dataView.buffer || dataView);

    // Check for DotPad Panning Key notification (starts with AA 55 00 09 00 03 12 00)
    if (bytes.length >= 10 && bytes[0] === 0xaa && bytes[1] === 0x55 && bytes[6] === 0x03 && bytes[7] === 0x12) {
      const panningCode = bytes[9] & 0x0f;
      if (panningCode === 4) {
        this.prevPage();
      } else if (panningCode === 2) {
        this.nextPage();
      }
      this.notify('input', { raw: dataView, code: panningCode, type: 'dotpad-panning' });
      return;
    }

    const code = (typeof dataView.getUint8 === 'function') ? dataView.getUint8(0) : bytes[0];
    if (code === 0x01 || code === 0x20) {
      this.nextPage();
    } else if (code === 0x02 || code === 0x21) {
      this.prevPage();
    }
    this.notify('input', { raw: dataView, code });
  }

  /**
   * Attempts a silent background auto-reconnection to any previously paired Bluetooth device.
   * Does NOT trigger user-facing picker modals.
   * @param {'monarch'|'dotpad'} [target='dotpad']
   * @returns {Promise<{ success: boolean, name?: string, error?: string }>}
   */
  async autoReconnect(target = 'dotpad') {
    if (this.connection) return { success: true, ...this.getConnectionInfo() };
    if (typeof navigator === 'undefined' || !navigator.bluetooth || !navigator.bluetooth.getDevices) {
      return { success: false, error: 'WebBluetooth getDevices not supported' };
    }
    try {
      const known = await navigator.bluetooth.getDevices();
      if (!known || known.length === 0) {
        return { success: false, error: 'No previously paired devices found' };
      }

      // Prioritize devices with names matching known tactile displays
      const sorted = [...known].sort((a, b) => {
        const na = (a.name || '').toLowerCase();
        const nb = (b.name || '').toLowerCase();
        const scoreA = (na.includes('dot') ? 10 : 0) + (na.includes('ipad') ? 5 : 0) + (na.includes('blues') ? 5 : 0);
        const scoreB = (nb.includes('dot') ? 10 : 0) + (nb.includes('ipad') ? 5 : 0) + (nb.includes('blues') ? 5 : 0);
        return scoreB - scoreA;
      });

      for (const dev of sorted) {
        try {
          const res = await this._setupGattConnection(dev, target);
          if (res && res.success) {
            console.log('TactileDisplay: Silently auto-reconnected to known device:', res.name);
            return res;
          }
        } catch (e) {
          console.warn('TactileDisplay: Auto-reconnect failed for device:', dev.name, e);
        }
      }
    } catch (err) {
      console.warn('TactileDisplay: Error during autoReconnect:', err);
    }
    return { success: false, error: 'Could not auto-reconnect to any known Bluetooth device' };
  }

  /**
   * Establishes GATT connection and discovers UART/HID characteristics for a BluetoothDevice.
   * @private
   */
  async _setupGattConnection(device, target = 'dotpad') {
    if (!device || !device.gatt) {
      return { success: false, error: 'Invalid Bluetooth device' };
    }

    this._explicitDisconnect = false;
    const server = await device.gatt.connect();
    let writeChar = null;
    let notifyChar = null;
    let matchedDotPad = false;

    const targetServices = [
      {
        serviceUuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Official DotPad Microchip ISSC UART
        writeUuid: '49535343-1e4d-4bd9-ba61-23c647249616',
        notifyUuid: '49535343-1e4d-4bd9-ba61-23c647249616'
      },
      {
        serviceUuid: '0000fef5-0000-1000-8000-00805f9b34fb', // Dot Inc. GATT Service
        writeUuid: null,
        notifyUuid: null
      },
      {
        serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
        writeUuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
        notifyUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
      },
      {
        serviceUuid: 'd0611e78-bbb4-4591-a5f8-487910ae4366', // BlueS iOS Bridge
        writeUuid: null,
        notifyUuid: null
      },
      {
        serviceUuid: '9fa480e0-4967-4542-9390-d343dc5d04ae', // BlueS Peripheral Service
        writeUuid: null,
        notifyUuid: null
      }
    ];

    for (const item of targetServices) {
      try {
        const svc = await server.getPrimaryService(item.serviceUuid);
        if (svc) {
          matchedDotPad = true;
          if (item.writeUuid) {
            try { writeChar = await svc.getCharacteristic(item.writeUuid); } catch (_) {}
          }
          if (item.notifyUuid) {
            try { notifyChar = await svc.getCharacteristic(item.notifyUuid); } catch (_) {}
          }
          if (!writeChar || !notifyChar) {
            const chars = await svc.getCharacteristics();
            for (const c of chars) {
              if (!writeChar && (c.properties.write || c.properties.writeWithoutResponse)) {
                writeChar = c;
              }
              if (!notifyChar && (c.properties.notify || c.properties.indicate)) {
                notifyChar = c;
              }
            }
          }
          if (writeChar) break;
        }
      } catch (e) {
        // Service not present on this peripheral, try next candidate
      }
    }

    if (notifyChar) {
      try {
        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', (ev) => {
          const val = ev.target?.value;
          this.handleHardwareInput(val);
        });
      } catch (ne) {
        console.warn('Could not start notifications on tactile display:', ne);
      }
    }

    const isDot = matchedDotPad || target === 'dotpad' || (device.name || '').toLowerCase().includes('dot') || (device.name || '').toLowerCase().includes('ipad') || (device.name || '').toLowerCase().includes('iphone');
    this.setDeviceProfile(isDot ? 'dotpad' : 'monarch');
    const displayName = (isDot && (device.name || '').toLowerCase().includes('ipad'))
      ? `${device.name} (DotPad 320)`
      : (device.name || (isDot ? 'DotPad 320' : 'Tactile Display'));
    this.connection = {
      type: 'bluetooth',
      name: displayName,
      device,
      characteristic: writeChar,
      notifyCharacteristic: notifyChar
    };

    const handleDisconnect = async () => {
      if (this._explicitDisconnect) return;
      console.log('Bluetooth GATT disconnected, attempting auto-reconnection...');
      this.notify('disconnect', null);
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          await new Promise(r => setTimeout(r, 1000 * attempt));
          if (this._explicitDisconnect) return;
          if (device && device.gatt && !device.gatt.connected) {
            await device.gatt.connect();
            console.log('Auto-reconnected to Bluetooth device successfully');
            this.notify('connect', this.getConnectionInfo());
            await this.renderCurrentViewport();
            return;
          }
        } catch (e) {
          console.warn(`Reconnection attempt ${attempt} failed:`, e);
        }
      }
    };
    device.addEventListener('gattserverdisconnected', handleDisconnect);

    this.notify('connect', this.getConnectionInfo());
    await this.renderCurrentViewport();
    return { success: true, ...this.getConnectionInfo() };
  }

  /**
   * Connects to an APH Monarch, DotPad, or compatible tactile display.
   * @param {Object} [opts]
   * @param {'auto'|'bluetooth'|'hid'|'serial'|'simulated'|'dotpad-simulated'} [opts.transport='auto']
   * @param {'monarch'|'dotpad'} [opts.target='monarch']
   * @returns {Promise<{ success: boolean, type: string, name: string }>}
   */
  async connect({ transport = 'auto', target = 'monarch' } = {}) {
    if (this.connection) {
      await this.disconnect();
    }

    this.setDeviceProfile(target);

    // 1. Simulated connections
    if (transport === 'simulated' || transport === 'dotpad-simulated') {
      const isDot = transport === 'dotpad-simulated' || target === 'dotpad';
      this.setDeviceProfile(isDot ? 'dotpad' : 'monarch');
      this.connection = {
        type: 'simulated',
        name: isDot ? 'DotPad 320 (Simulated 30×10 + 20 Braille)' : 'APH Monarch (Simulated 32×10 Display)',
        device: null
      };
      this.notify('connect', this.getConnectionInfo());
      this.renderCurrentViewport();
      return { success: true, ...this.getConnectionInfo() };
    }

    // 2. WebBluetooth (DotPad ISSC Microchip Transparent UART, Nordic BLE & Broad Scan)
    if (transport === 'auto' || transport === 'bluetooth') {
      if (typeof navigator !== 'undefined' && navigator.bluetooth) {
        try {
          // First, attempt to reuse existing granted devices without prompting if getDevices is available
          if (navigator.bluetooth.getDevices) {
            try {
              const known = await navigator.bluetooth.getDevices();
              if (known && known.length > 0) {
                for (const kDev of known) {
                  try {
                    const res = await this._setupGattConnection(kDev, target);
                    if (res && res.success) {
                      return res;
                    }
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }

          // If no known device connected, prompt user for pairing
          const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [
              '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Official DotPad Microchip ISSC BLE UART
              '0000fef5-0000-1000-8000-00805f9b34fb', // Dot Inc. GATT Service
              '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
              'd0611e78-bbb4-4591-a5f8-487910ae4366', // BlueS iOS Service
              '9fa480e0-4967-4542-9390-d343dc5d04ae'  // BlueS Peripheral Service
            ]
          });

          if (device) {
            return await this._setupGattConnection(device, target);
          }
        } catch (err) {
          console.warn('WebBluetooth request dismissed or failed:', err);
          if (transport === 'bluetooth' || err.name === 'NotFoundError' || err.name === 'NotAllowedError' || err.name === 'SecurityError') {
            return { success: false, error: err.message || 'Bluetooth connection cancelled.' };
          }
        }
      }
    }

    // 3. WebHID (Monarch / DotPad USB / USB-IF Braille displays)
    if ((transport === 'auto' || transport === 'hid') && typeof navigator !== 'undefined' && navigator.hid) {
      try {
        const devices = await navigator.hid.requestDevice({
          filters: [
            { usagePage: 0x41 },   // USB-IF Braille Display Usage Page
            { vendorId: 0x32ac },   // Dot Inc.
            { vendorId: 0x0bd7 },   // HumanWare / ViewPlus
            { vendorId: 0x11a9 },   // Index
            { vendorId: 0x1868 }
          ]
        }).catch(() => []);
        if (devices && devices.length > 0) {
          const device = devices[0];
          if (!device.opened) await device.open();
          const isDot = (device.vendorId === 0x32ac) || (device.productName || '').toLowerCase().includes('dot');
          this.setDeviceProfile(isDot ? 'dotpad' : 'monarch');
          this.connection = {
            type: 'hid',
            name: device.productName || (isDot ? 'DotPad 320' : 'APH Monarch Braille Display'),
            device
          };
          this.notify('connect', this.getConnectionInfo());
          this.renderCurrentViewport();
          return { success: true, ...this.getConnectionInfo() };
        }
      } catch (err) {
        console.warn('WebHID request dismissed or failed:', err);
      }
    }

    // 4. WebSerial (Monarch / DotPad FTDI USB UART)
    if ((transport === 'auto' || transport === 'serial') && typeof navigator !== 'undefined' && navigator.serial) {
      try {
        const port = await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x0403, usbProductId: 0x6010 }, // DotPad FTDI FT2232
            { usbVendorId: 0x0403, usbProductId: 0x6015 }  // DotPad FTDI FT-X
          ]
        }).catch(() => navigator.serial.requestPort().catch(() => null));
        if (port) {
          await port.open({ baudRate: 115200 });
          this.connection = {
            type: 'serial',
            name: target === 'dotpad' ? 'DotPad (WebSerial USB)' : 'APH Monarch (WebSerial USB/Bluetooth)',
            port
          };
          this.notify('connect', this.getConnectionInfo());
          this.renderCurrentViewport();
          return { success: true, ...this.getConnectionInfo() };
        }
      } catch (err) {
        console.warn('WebSerial request dismissed or failed:', err);
      }
    }

    return { success: false, error: 'No device selected or hardware API unavailable.' };
  }

  async disconnect() {
    if (!this.connection) return;
    try {
      if (this.connection.type === 'bluetooth' && this.connection.device?.gatt?.connected) {
        this.connection.device.gatt.disconnect();
      } else if (this.connection.type === 'hid' && this.connection.device?.opened) {
        await this.connection.device.close();
      } else if (this.connection.type === 'serial' && this.connection.port) {
        await this.connection.port.close();
      }
    } catch (e) {
      console.warn('Error during disconnect:', e);
    }
    this.connection = null;
    this.notify('disconnect', null);
  }

  /**
   * Updates the document braille and graphic content and streams active viewport.
   * Supports page-aware graphic vs text page streaming.
   * @param {string[]|string} braille
   * @param {number} [cursorLine] - Optional active cursor line for auto-following.
   * @param {Uint8Array|Map<number, { matrix: Uint8Array, title: string }>|Object} [graphicData] - Graphic matrix or map of line -> graphic.
   * @param {string} [graphicBrailleLine] - Optional 20-cell Braille text string for Line 0.
   */
  async updateBraille(braille, cursorLine = null, graphicData = null, graphicBrailleLine = null) {
    this.lastBraille = Array.isArray(braille) ? braille : String(braille || '').split(/\r?\n/);
    
    if (graphicData instanceof Map) {
      this.graphicMap = graphicData;
    } else if (graphicData && typeof graphicData === 'object' && !ArrayBuffer.isView(graphicData)) {
      this.graphicMap = new Map(Object.entries(graphicData).map(([k, v]) => [Number(k), v]));
    } else if (graphicData) {
      this.lastGraphic = graphicData;
      this.lastGraphicBrailleLine = graphicBrailleLine;
      this.graphicMap = null;
    } else {
      this.lastGraphic = null;
      this.lastGraphicBrailleLine = null;
      this.graphicMap = null;
    }
    
    if (this.autoFollowCursor && cursorLine !== null && cursorLine >= 0) {
      this.scrollToLine(cursorLine);
    } else {
      await this.renderCurrentViewport();
    }
  }

  getGraphicForLine(lineIndex) {
    const lines = this.deviceProfile.lines;
    const pageStart = Math.floor(lineIndex / lines) * lines;
    if (this.graphicMap) {
      for (const [line, g] of this.graphicMap.entries()) {
        const gPageStart = Math.floor(line / lines) * lines;
        if (pageStart === gPageStart || (lineIndex >= line && lineIndex < line + lines)) {
          return g;
        }
      }
      return null;
    }
    if (this.lastGraphic) {
      return { matrix: this.lastGraphic, title: this.lastGraphicBrailleLine || '' };
    }
    return null;
  }

  getDotPadActiveFrame() {
    const lines = 10;
    const width = 20;
    const totalLines = this.lastBraille.length || 1;
    const pageNumber = Math.floor(this.currentStartLine / lines) + 1;
    const totalPages = Math.ceil(totalLines / lines) || 1;

    const viewport = formatTactileViewport(this.lastBraille, {
      startLine: this.currentStartLine,
      width: 20,
      lines: 10
    });

    const graphic = this.getGraphicForLine(this.currentStartLine);
    const isGraphic = Boolean(graphic && graphic.matrix);

    const activeLine = (typeof this.activeLineIndex === 'number' && this.activeLineIndex >= this.currentStartLine && this.activeLineIndex < this.currentStartLine + lines)
      ? this.activeLineIndex
      : this.currentStartLine;

    const readingRowIndex = Math.max(0, activeLine - this.currentStartLine);
    const readingRowText = viewport.textRows[readingRowIndex] || this.lastBraille[activeLine] || viewport.textRows[0] || '';

    return {
      isGraphic,
      graphicMatrix: isGraphic ? graphic.matrix : null,
      brailleLine: isGraphic ? (graphic.title || readingRowText || '') : readingRowText,
      activeLine,
      textRows: viewport.textRows,
      viewportLines: viewport.lines,
      startLine: this.currentStartLine,
      totalLines,
      pageNumber,
      totalPages
    };
  }

  scrollToLine(lineIndex) {
    this.activeLineIndex = Math.max(0, lineIndex);
    const lines = this.deviceProfile.lines;
    const targetPageStart = Math.floor(lineIndex / lines) * lines;
    if (targetPageStart !== this.currentStartLine) {
      this.currentStartLine = targetPageStart;
    }
    return this.renderCurrentViewport();
  }

  nextPage() {
    const total = this.lastBraille.length || 1;
    const lines = this.deviceProfile.lines;
    if (this.currentStartLine + lines < total) {
      this.currentStartLine += lines;
      this.activeLineIndex = this.currentStartLine;
      return this.renderCurrentViewport();
    }
    return Promise.resolve(null);
  }

  prevPage() {
    const lines = this.deviceProfile.lines;
    if (this.currentStartLine > 0) {
      this.currentStartLine = Math.max(0, this.currentStartLine - lines);
      this.activeLineIndex = this.currentStartLine;
      return this.renderCurrentViewport();
    }
    return Promise.resolve(null);
  }

  setPage(pageNum) {
    const lines = this.deviceProfile.lines;
    const totalLines = this.lastBraille.length || 1;
    const maxPage = Math.max(1, Math.ceil(totalLines / lines));
    const targetPage = Math.max(1, Math.min(pageNum, maxPage));
    this.currentStartLine = (targetPage - 1) * lines;
    this.activeLineIndex = this.currentStartLine;
    return this.renderCurrentViewport();
  }

  async renderCurrentViewport() {
    const viewport = formatTactileViewport(this.lastBraille, {
      startLine: this.currentStartLine,
      width: this.deviceProfile.width,
      lines: this.deviceProfile.lines
    });

    const activeFrame = this.getDotPadActiveFrame();
    this.notify('viewport', { ...viewport, activeFrame });

    if (!this.connection) return viewport;

    try {
      const isDot = this.deviceProfile.id === 'dotpad';

      if (isDot) {
        // Dual-zone DotPad payload: 300 bytes graphics + 20 bytes text
        const activeGraphic = activeFrame.graphicMatrix || viewport.lines;
        const activeBrailleLine = activeFrame.brailleLine;
        const dotpadPackets = encodeDotPadDualZonePackets(activeGraphic, activeBrailleLine);

        if (this.connection.type === 'bluetooth' && this.connection.characteristic) {
          const char = this.connection.characteristic;
          for (const packet of dotpadPackets) {
            try {
              if (char.writeValue) {
                await char.writeValue(packet);
              } else if (char.writeValueWithResponse) {
                await char.writeValueWithResponse(packet);
              } else if (char.writeValueWithoutResponse) {
                await char.writeValueWithoutResponse(packet);
              }
            } catch (wErr) {
              try {
                if (char.writeValueWithResponse) await char.writeValueWithResponse(packet);
                else if (char.writeValueWithoutResponse) await char.writeValueWithoutResponse(packet);
              } catch (retryErr) {
                console.warn('Bluetooth line write error:', retryErr);
              }
            }
            // Pacing delay between line writes for BLE buffer stability
            await new Promise(r => setTimeout(r, 20));
          }
        } else if (this.connection.type === 'serial' && this.connection.port?.writable) {
          const writer = this.connection.port.writable.getWriter();
          for (const packet of dotpadPackets) {
            await writer.write(packet);
          }
          writer.releaseLock();
        }
      } else {
        // Standard Monarch / HumanWare / USB-IF HID payload
        if (this.connection.type === 'hid' && this.connection.device?.opened) {
          for (let i = 0; i < viewport.lines.length; i++) {
            const report = encodeHidBrailleReport(i + 1, viewport.lines[i]);
            await this.connection.device.sendReport(i + 1, report.subarray(1));
          }
        } else if (this.connection.type === 'serial' && this.connection.port?.writable) {
          const packet = encodeHumanWareFrame(viewport.lines);
          const writer = this.connection.port.writable.getWriter();
          await writer.write(packet);
          writer.releaseLock();
        }
      }
    } catch (err) {
      console.warn('Error transmitting to tactile display:', err);
      this.notify('error', err);
    }

    return viewport;
  }
}

// Export singleton instance
export const tactileDisplay = new TactileDisplayManager();
if (typeof globalThis !== 'undefined') {
  globalThis.tactileDisplay = tactileDisplay;
}

