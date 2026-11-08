// Tactile drawing tool (W14): the dot preview - the drawing as the raised dots an embosser would make (one dot per 2.5 mm, the braille dot grid),
// with labels drawn as real braille cells. This is a preview of where dots fall, not a model of any one embosser's dot heights (those, and a
// per-target version, are left for a later version).
import { MM } from './constants.mjs';

/** Pixels (RGBA, a white background with black ink) to a grid of dots: a dot where at least `threshold` of the block is dark. */
export function dotsFromPixels(data, width, height, sub, threshold = 0.1) {
  const cols = Math.floor(width / sub), rows = Math.floor(height / sub);
  const dots = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let dark = 0;
      for (let y = 0; y < sub; y++) for (let x = 0; x < sub; x++) {
        const i = ((r * sub + y) * width + (c * sub + x)) * 4;
        const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        if (data[i + 3] > 40 && lum < 140) dark++;
      }
      if (dark / (sub * sub) >= threshold) dots[r * cols + c] = 1;
    }
  }
  return { cols, rows, dots };
}

/** The dot positions (mm) of a braille string whose first cell's top-left is (x, y): dots 1-3 down the left, 4-6 down the right. */
export function brailleDotPositions(braille, x, y) {
  const out = [];
  Array.from(braille || '').forEach((ch, i) => {
    const code = ch.codePointAt(0);
    if (code < 0x2800 || code > 0x28ff) return;
    const mask = code - 0x2800;
    const x0 = x + i * MM.cell + (MM.cell - MM.dot) / 2;
    const pos = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]];
    pos.forEach(([col, row], b) => { if (mask & (1 << b)) out.push({ x: x0 + col * MM.dot, y: y + row * MM.dot }); });
  });
  return out;
}

/**
 * Draw the preview onto a canvas. `svgNoLabels` is the drawing with its labels' braille text left out (the halos stay, to blank what is under
 * them); `labels` are the shapes of kind 'text'. Resolves to {dots, cols, rows} or null when the browser could not draw the SVG.
 */
export async function drawDotPreview(canvas, svgNoLabels, doc, labels, { px = 5 } = {}) {
  const sub = 4;
  const cols = Math.ceil(doc.width / MM.dot), rows = Math.ceil(doc.height / MM.dot);
  const off = document.createElement('canvas');
  off.width = cols * sub; off.height = rows * sub;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, off.width, off.height);
  const url = URL.createObjectURL(new Blob([svgNoLabels], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The drawing could not be drawn as dots.')); img.src = url; });
    octx.drawImage(img, 0, 0, off.width, off.height);
  } catch { URL.revokeObjectURL(url); return null; }
  URL.revokeObjectURL(url);
  const { data } = octx.getImageData(0, 0, off.width, off.height);
  const grid = dotsFromPixels(data, off.width, off.height, sub);
  canvas.width = cols * px; canvas.height = rows * px;
  const ctx = canvas.getContext('2d');
  const cs = getComputedStyle(canvas);
  ctx.fillStyle = cs.getPropertyValue('--td-paper').trim() || '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ink = cs.getPropertyValue('--td-ink').trim() || '#000';
  ctx.fillStyle = ink;
  const k = px / MM.dot;
  let count = 0;
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (grid.dots[r * grid.cols + c]) { ctx.beginPath(); ctx.arc((c + 0.5) * px, (r + 0.5) * px, px * 0.32, 0, Math.PI * 2); ctx.fill(); count++; }
  for (const l of labels) for (const d of brailleDotPositions(l.braille, l.x, l.y)) { ctx.beginPath(); ctx.arc(d.x * k, d.y * k, px * 0.32, 0, Math.PI * 2); ctx.fill(); count++; }
  return { dots: count, cols, rows };
}
