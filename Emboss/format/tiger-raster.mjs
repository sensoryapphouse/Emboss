// ViewPlus Tiger PRN Rasterizer for Emboss
// Converts SVG or image pixel data into multi-height ViewPlus Tiger / APH PixBlaster binary streams.
// Tiger embossers support 8 dot heights (0=flat, 7=maximum elevation).

/**
 * Converts grayscale/color luminance (0-255) to Tiger dot height (0-7).
 * 0 (white) -> 0 (no dot)
 * 255 (black) -> 7 (maximum height)
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @param {number} [a=255] - Alpha (0-255)
 * @returns {number} Dot height 0..7
 */
export function pixelToTigerHeight(r, g, b, a = 255) {
  if (a < 48) return 0;
  // Perceived brightness (0 = black, 255 = white)
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  // Invert: 0 brightness (black) is highest elevation
  const inverted = (255 - brightness) * (a / 255);
  if (inverted < 12) return 0; // Flat paper
  
  // BANA Elevation Hierarchy Curve:
  // Solid black (inverted >= 235) -> Height 7 (Primary Outlines / Curves)
  // Dark gray / Axes (inverted 190..234) -> Height 6
  // Medium dark (inverted 140..189) -> Height 5
  // Fill textures (inverted 80..139) -> Heights 3..4
  // Subtle grid / guide dots (inverted 12..79) -> Heights 1..2
  if (inverted >= 235) return 7;
  if (inverted >= 190) return 6;
  if (inverted >= 140) return 5;
  if (inverted >= 100) return 4;
  if (inverted >= 65) return 3;
  if (inverted >= 35) return 2;
  return 1;
}

/**
 * Encodes a 2D height grid (matrix of 0..7 values) into a Tiger PRN escape stream.
 * @param {number[][]} heightGrid - 2D array [row][col] with dot heights 0..7.
 * @param {Object} [options={}] - Encoding options.
 * @param {number} [options.dpi=20] - Dot resolution (20, 40, or 100 DPI).
 * @returns {Uint8Array} Binary PRN byte stream.
 */
export function encodeTigerPrn(heightGrid, options = {}) {
  const rows = heightGrid.length;
  const cols = rows > 0 ? heightGrid[0].length : 0;
  if (!rows || !cols) return new Uint8Array([0x1b, 0x2a, 0x74, 0x0c]); // Empty text reset + FF

  const bytes = [];
  // Reset and enter Tiger Graphics Mode: ESC * r 1 A (Start Graphic)
  bytes.push(0x1b, 0x2a, 0x72, 0x31, 0x41);

  // Scan line by line
  for (let r = 0; r < rows; r++) {
    // Escape header for raster line: ESC * b {len} W
    const row = heightGrid[r];
    // Tiger nibble-packed dot heights: 2 pixels per byte (upper nibble = left dot, lower nibble = right dot)
    const packed = [];
    for (let c = 0; c < cols; c += 2) {
      const h1 = (row[c] || 0) & 0x07;
      const h2 = (row[c + 1] || 0) & 0x07;
      packed.push((h1 << 4) | h2);
    }

    const lenStr = String(packed.length);
    bytes.push(0x1b, 0x2a, 0x62); // ESC * b
    for (let i = 0; i < lenStr.length; i++) bytes.push(lenStr.charCodeAt(i));
    bytes.push(0x57); // 'W'
    bytes.push(...packed);
  }

  // End Graphic & Form Feed: ESC * r B \x0c
  bytes.push(0x1b, 0x2a, 0x72, 0x42, 0x0c);
  return new Uint8Array(bytes);
}

/**
 * Rasterizes an SVG string to a ViewPlus Tiger height grid using an HTML5 Canvas.
 * @param {string} svgString - Tactile SVG string.
 * @param {number} widthDots - Number of horizontal dots (e.g. 40 * 2.5mm / DPI = ~80-160 dots).
 * @param {number} heightDots - Number of vertical dots.
 * @returns {Promise<Uint8Array>}
 */
export async function rasterizeSvgToTiger(svgString, widthDots = 160, heightDots = 120) {
  if (typeof document === 'undefined') {
    // Node environment fallback: mock height grid
    const mockGrid = Array.from({ length: heightDots }, (_, r) =>
      Array.from({ length: widthDots }, (_, c) => (r === 0 || r === heightDots - 1 || c === 0 || c === widthDots - 1 ? 7 : 0))
    );
    return encodeTigerPrn(mockGrid);
  }

  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = widthDots;
      canvas.height = heightDots;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, widthDots, heightDots);

      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        ctx.drawImage(img, 0, 0, widthDots, heightDots);
        URL.revokeObjectURL(url);

        const imgData = ctx.getImageData(0, 0, widthDots, heightDots);
        const { data, width, height } = imgData;
        const grid = [];

        for (let r = 0; r < height; r++) {
          const row = [];
          for (let c = 0; c < width; c++) {
            const idx = (r * width + c) * 4;
            const h = pixelToTigerHeight(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]);
            row.push(h);
          }
          grid.push(row);
        }

        resolve(encodeTigerPrn(grid));
      };

      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG for Tiger rasterization: ' + e));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}
