// Index Braille ESC +g Tactile Bit-Image Rasterizer for Emboss
// Generates binary graphic streams for Index Braille (Basic-D / Everest-D V4/V5) & APH PageBlaster.

/**
 * Encodes a 1-bit binary dot matrix into Index Braille ESC +g bitmap packets.
 * In Index graphic mode, dots are encoded column-by-column (8 vertical dots per byte).
 * 
 * @param {boolean[][]} bitMatrix - 2D boolean array [row][col] (true = punched dot, false = blank).
 * @returns {Uint8Array} Binary Index graphic stream.
 */
export function encodeIndexGraphicStream(bitMatrix) {
  const rows = bitMatrix.length;
  const cols = rows > 0 ? bitMatrix[0].length : 0;
  if (!rows || !cols) return new Uint8Array([0x1b, 0x0c]);

  const bytes = [];
  // Reset / Header for Index Tactile Graphics: ESC + g
  // Format: \x1b+g{cols_high}{cols_low}{rows_high}{rows_low}
  bytes.push(0x1b, 0x2b, 0x67);
  bytes.push((cols >> 8) & 0xff, cols & 0xff);
  bytes.push((rows >> 8) & 0xff, rows & 0xff);

  // Encode in 8-dot vertical slices (columns)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r += 8) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (r + bit < rows && bitMatrix[r + bit][c]) {
          byteVal |= (1 << bit);
        }
      }
      bytes.push(byteVal);
    }
  }

  // End of Graphic & Eject Page: ESC \x0c
  bytes.push(0x1b, 0x0c);
  return new Uint8Array(bytes);
}

/**
 * Rasterizes an SVG string to an Index 1-bit dot matrix using an HTML5 Canvas.
 * @param {string} svgString - Tactile SVG string.
 * @param {number} widthDots - Horizontal dot width (e.g. 120-160 dots).
 * @param {number} heightDots - Vertical dot height.
 * @returns {Promise<Uint8Array>}
 */
export async function rasterizeSvgToIndex(svgString, widthDots = 160, heightDots = 120) {
  if (typeof document === 'undefined') {
    // Node environment fallback
    const mockGrid = Array.from({ length: heightDots }, (_, r) =>
      Array.from({ length: widthDots }, (_, c) => (r === 0 || r === heightDots - 1 || c === 0 || c === widthDots - 1))
    );
    return encodeIndexGraphicStream(mockGrid);
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
            // Luminance threshold for binary dot punch (dark < 140 = punch)
            const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            const isDot = data[idx + 3] > 64 && lum < 140;
            row.push(isDot);
          }
          grid.push(row);
        }

        resolve(encodeIndexGraphicStream(grid));
      };

      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG for Index rasterization: ' + e));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}
