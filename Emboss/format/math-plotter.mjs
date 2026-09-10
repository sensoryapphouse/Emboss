// Mathematical Function to Tactile SVG & Discrete Display Plotter for Emboss.
// Takes LaTeX or standard algebraic expressions (e.g. "x^2 - 4", "y = \sin(x)", "\frac{1}{2}x + 3")
// and generates mathematically exact tactile coordinate graphs:
// 1. Direct 60x40 discrete pin-grid plotting for dynamic displays (DotPad 320, Monarch) with
//    crisp 1-pin axes, 1-pin ticks, continuous Bresenham curves, and discrete Braille cell injection.
// 2. Isotropic 1:1 aspect ratio tactile SVG graphs with BANA/UKAAF compliance for paper embossers.
// 3. UEB Math formula encoding for the dedicated 20-cell Braille text reading row.

import { transpileTactileSvg, defaultBrailleTranslator } from './tactile-svg.mjs';
import { charToDotMask } from './tactile-display.mjs';

/**
 * Normalizes LaTeX math strings into standard evaluatable JavaScript math expressions.
 * @param {string} latex 
 * @returns {string} Clean JS expression in terms of x
 */
export function latexToMathJs(latex) {
  if (!latex) return '';
  let expr = latex.trim();

  // Strip "y =", "f(x) =", "g(x) =" prefix
  expr = expr.replace(/^(y\s*=|f\s*\(\s*x\s*\)\s*=|g\s*\(\s*x\s*\)\s*=)\s*/i, '');

  // Handle \frac{a}{b} -> ((a)/(b))
  expr = expr.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))');

  // Handle powers: x^{2} -> x ** (2), x^2 -> x ** (2)
  expr = expr.replace(/\^\{([^{}]+)\}/g, ' ** ($1)');
  expr = expr.replace(/\^([0-9a-zA-Z.]+)/g, ' ** ($1)');

  // Handle \sqrt{a} -> Math.sqrt(a)
  expr = expr.replace(/\\sqrt\{([^{}]+)\}/g, 'Math.sqrt($1)');

  // Handle standard trig and functions
  expr = expr.replace(/\\sin/g, 'Math.sin');
  expr = expr.replace(/\\cos/g, 'Math.cos');
  expr = expr.replace(/\\tan/g, 'Math.tan');
  expr = expr.replace(/\\ln/g, 'Math.log');
  expr = expr.replace(/\\log/g, 'Math.log10');
  expr = expr.replace(/\\exp/g, 'Math.exp');
  expr = expr.replace(/\\pi/g, 'Math.PI');
  expr = expr.replace(/\\e\b/g, 'Math.E');

  // Handle implicit multiplication (e.g. 2x -> 2*x, 3(x) -> 3*(x), )x -> )*x)
  expr = expr.replace(/(\d+)\s*([a-zA-Z(])/g, '$1 * $2');
  expr = expr.replace(/([)])\s*([a-zA-Z0-9(])/g, '$1 * $2');
  expr = expr.replace(/\b([a-wy-zA-WY-Z])\s*([(])/g, '$1 * $2');

  return expr;
}

/**
 * Evaluates an algebraic function for a given x value.
 * @param {string} jsExpr - Expression in terms of x
 * @param {number} x - Input value
 * @returns {number|null} Output value, or null if undefined/infinity/NaN
 */
export function evaluateFunction(jsExpr, x) {
  try {
    const fn = new Function('x', 'Math', `return (${jsExpr});`);
    const y = fn(x, Math);
    if (typeof y !== 'number' || isNaN(y) || !isFinite(y)) return null;
    return y;
  } catch (_) {
    return null;
  }
}

/**
 * Checks if a LaTeX math expression represents a plottable algebraic function of x.
 * @param {string} latex 
 * @returns {boolean}
 */
export function isPlottableEquation(latex) {
  if (!latex || typeof latex !== 'string') return false;
  const s = latex.trim();
  if (s.length < 1) return false;

  // Reject matrices, tables, cases, multi-equations
  if (s.includes('\\begin{') || s.includes('\\matrix') || s.includes('\\pmatrix') || s.includes('\\bmatrix') || s.includes('\\cases') || s.includes('\\\\')) {
    return false;
  }

  // Reject summation, product, integral without clear single-variable function format
  if (s.includes('\\sum') || s.includes('\\prod') || s.includes('\\int')) {
    return false;
  }

  // Must contain an independent variable (x, t, or theta)
  if (!/\b[xX]\b|[tT]|\\theta/.test(s)) {
    return false;
  }

  const expr = latexToMathJs(s);
  if (!expr) return false;

  const testVal1 = evaluateFunction(expr, 1);
  const testVal2 = evaluateFunction(expr, 2);
  return (testVal1 !== null && typeof testVal1 === 'number') || (testVal2 !== null && typeof testVal2 === 'number');
}

/**
 * Formats a clean UEB Math representation of the equation for the 20-cell text row (Line 0 on DotPad).
 * @param {string[]} eqList
 * @param {Array<{ type: string, x: number, y: number }>} [pois]
 * @returns {string} 20-character padded Unicode Braille string
 */
export function formatUebMathLine(eqList = [], pois = []) {
  if (!eqList.length) eqList = ['x'];
  const firstEq = eqList[0].replace(/^(y\s*=|f\(x\)\s*=|g\(x\)\s*=)\s*/i, '').trim();

  // Convert formula tokens to UEB Math:
  let formulaUeb = '⠰⠰⠰⠽⠀⠐⠶⠀';
  let formattedExpr = firstEq
    .replace(/\^2\b/g, '⠔⠼⠃')
    .replace(/\^3\b/g, '⠔⠼⠉')
    .replace(/\^([0-9]+)/g, (_, n) => `⠔${defaultBrailleTranslator(n)}`)
    .replace(/\bx\b/g, '⠭')
    .replace(/\+/g, '⠐⠬')
    .replace(/-/g, '⠐⠤')
    .replace(/\*/g, '⠐⠡')
    .replace(/\//g, '⠐⠌')
    .replace(/\\sin/g, '⠎⠊⠝')
    .replace(/\\cos/g, '⠉⠕⠎')
    .replace(/\\tan/g, '⠞⠁⠝')
    .replace(/\\sqrt/g, '⠜')
    .replace(/(\d+)/g, (m) => defaultBrailleTranslator(m));

  formulaUeb += formattedExpr + '⠰⠄';

  // If there are roots, append them if space permits
  const roots = (pois || []).filter((p) => p.type === 'root');
  if (roots.length > 0 && formulaUeb.length <= 13) {
    const rootStrs = roots.slice(0, 2).map((r) => defaultBrailleTranslator(r.x.toFixed(0)));
    const withRoots = `${formulaUeb}⠀${rootStrs.join('⠂')}`;
    if (withRoots.length <= 20) {
      return withRoots.slice(0, 20).padEnd(20, '⠀');
    }
  }

  return formulaUeb.slice(0, 20).padEnd(20, '⠀');
}

/**
 * Computes optimal, feature-centric domain and range bounds for tactile coordinate graphing.
 * Uses roots, extrema, and intercepts to frame curves cleanly without extreme distortion or squishing.
 * @param {string[]} eqList
 * @param {Object} opts
 * @returns {{ xMin: number, xMax: number, yMin: number, yMax: number }}
 */
export function calculateOptimalPlotBounds(eqList, opts = {}) {
  if (typeof opts.xMin === 'number' && typeof opts.xMax === 'number' &&
      typeof opts.yMin === 'number' && typeof opts.yMax === 'number') {
    return { xMin: opts.xMin, xMax: opts.xMax, yMin: opts.yMin, yMax: opts.yMax };
  }

  const evalStep = 0.05;
  const features = [];
  const yAtZero = [];

  eqList.forEach((eqStr) => {
    const expr = latexToMathJs(eqStr);
    let prevY = null;
    let prevSlope = null;

    const y0 = evaluateFunction(expr, 0);
    if (y0 !== null && isFinite(y0)) yAtZero.push(y0);

    for (let x = -8; x <= 8.001; x += evalStep) {
      const y = evaluateFunction(expr, x);
      if (y !== null && isFinite(y)) {
        // Detect Root (sign change in y)
        if (prevY !== null && ((prevY < 0 && y >= 0) || (prevY > 0 && y <= 0))) {
          const rootX = x - evalStep * (y / (y - prevY));
          features.push({ type: 'root', x: rootX, y: 0 });
        }
        // Detect Extrema / Vertex
        if (prevY !== null) {
          const slope = (y - prevY) / evalStep;
          if (prevSlope !== null && ((prevSlope > 0 && slope < 0) || (prevSlope < 0 && slope > 0))) {
            features.push({ type: 'extrema', x, y });
          }
          prevSlope = slope;
        }
        prevY = y;
      } else {
        prevY = null;
        prevSlope = null;
      }
    }
  });

  const nearFeatures = features.filter((f) => Math.abs(f.x) <= 6 && Math.abs(f.y) <= 8);

  let span = 5;
  if (nearFeatures.length > 0) {
    const minFx = Math.min(...nearFeatures.map(f => f.x));
    const maxFx = Math.max(...nearFeatures.map(f => f.x));
    const minFy = Math.min(...nearFeatures.map(f => f.y));
    const maxFy = Math.max(...nearFeatures.map(f => f.y));

    const maxAbsX = Math.max(Math.abs(minFx), Math.abs(maxFx), 2);
    const maxAbsY = Math.max(Math.abs(minFy), Math.abs(maxFy), 2);

    const spanX = Math.min(8, Math.max(3, Math.ceil(maxAbsX + 1.5)));
    const spanY = Math.min(8, Math.max(3, Math.ceil(maxAbsY + 1.5)));
    span = Math.max(spanX, spanY);
  } else if (yAtZero.length > 0) {
    const y0 = yAtZero[0];
    span = Math.min(8, Math.max(4, Math.ceil(Math.abs(y0) + 2)));
  }

  const xMin = typeof opts.xMin === 'number' ? opts.xMin : -span;
  const xMax = typeof opts.xMax === 'number' ? opts.xMax : span;
  const yMin = typeof opts.yMin === 'number' ? opts.yMin : -span;
  const yMax = typeof opts.yMax === 'number' ? opts.yMax : span;

  return { xMin, xMax, yMin, yMax };
}

/**
 * Direct Discrete Pin-Grid Math Plotter for DotPad (60x40 pins, 30x10 cells) and Monarch (64x40 pins).
 * Plots functions directly onto a 2D pin array with 100% mathematical precision:
 * - 1:1 isotropic aspect ratio (no horizontal stretching or flattening)
 * - Single-pin wide axes ($x=x_0$, $y=y_0$) with clean 1-pin arrowheads
 * - 1-pin tick marks at integer units
 * - Unbroken, single-pin continuous curve paths using Bresenham's line algorithm
 * - Standard discrete Braille cell injection for 'y' and 'x' axis labels with cleared halos
 * 
 * @param {string} latexOrExpr
 * @param {Object} [opts]
 * @returns {{ matrix: Uint8Array, brailleLine: string, widthPins: number, heightPins: number, pins: Uint8Array, pointsOfInterest: Array }}
 */
export function plotFunctionToPinGrid(latexOrExpr, opts = {}) {
  const eqList = String(latexOrExpr || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!eqList.length) eqList.push('x');

  const widthPins = opts.widthPins || 60;   // DotPad 320 = 60 pins (30 cells)
  const heightPins = opts.heightPins || 40; // DotPad 320 = 40 pins (10 rows)
  const numCellsW = Math.floor(widthPins / 2);
  const numCellsH = Math.floor(heightPins / 4);

  // 1. Evaluate optimal bounds and sample curves
  const bounds = calculateOptimalPlotBounds(eqList, opts);
  const xMin = bounds.xMin;
  const xMax = bounds.xMax;
  const yMin = bounds.yMin;
  const yMax = bounds.yMax;

  const curves = [];
  const pointsOfInterest = [];

  const evalStep = 0.05;
  eqList.forEach((eqStr) => {
    const expr = latexToMathJs(eqStr);
    const pts = [];
    let prevY = null;
    let prevSlope = null;

    for (let x = xMin; x <= xMax + 0.001; x += evalStep) {
      const y = evaluateFunction(expr, x);
      if (y !== null && isFinite(y)) {
        pts.push({ x, y });

        // Detect Root (sign change in y)
        if (prevY !== null && ((prevY < 0 && y >= 0) || (prevY > 0 && y <= 0))) {
          const rootX = x - evalStep * (y / (y - prevY));
          pointsOfInterest.push({ type: 'root', x: rootX, y: 0 });
        }

        // Detect Extrema / Vertex (slope sign change)
        if (prevY !== null) {
          const slope = (y - prevY) / evalStep;
          if (prevSlope !== null && ((prevSlope > 0 && slope < 0) || (prevSlope < 0 && slope > 0))) {
            pointsOfInterest.push({ type: 'extrema', x, y });
          }
          prevSlope = slope;
        }
        prevY = y;
      } else {
        pts.push({ x, y: null });
        prevY = null;
        prevSlope = null;
      }
    }
    curves.push({ expr, pts });
  });

  // 2. Compute isotropic 1:1 scale
  // Reserve margin for arrowheads and braille labels (4 pins margin)
  const marginPinsX = 4;
  const marginPinsY = 4;
  const availablePinsW = widthPins - 2 * marginPinsX;
  const availablePinsH = heightPins - 2 * marginPinsY;

  const xRange = xMax - xMin;
  const yRange = yMax - yMin;

  const scaleX = availablePinsW / xRange;
  const scaleY = availablePinsH / yRange;
  // Strictly locked 1:1 aspect ratio: 1 math unit in X == 1 math unit in Y
  const scale = Math.min(scaleX, scaleY);

  // Pin origin (0, 0)
  const originPinX = Math.round(widthPins / 2 - ((xMin + xMax) / 2) * scale);
  const originPinY = Math.round(heightPins / 2 + ((yMin + yMax) / 2) * scale);

  const toPinX = (x) => Math.round(originPinX + x * scale);
  const toPinY = (y) => Math.round(originPinY - y * scale);

  // Pin Buffer (60 x 40)
  const pins = new Uint8Array(widthPins * heightPins);
  const setPin = (x, y) => {
    if (x >= 0 && x < widthPins && y >= 0 && y < heightPins) pins[y * widthPins + x] = 1;
  };
  const clearPin = (x, y) => {
    if (x >= 0 && x < widthPins && y >= 0 && y < heightPins) pins[y * widthPins + x] = 0;
  };
  const getPin = (x, y) => {
    if (x >= 0 && x < widthPins && y >= 0 && y < heightPins) return pins[y * widthPins + x];
    return 0;
  };

  // 3. Draw Single-Pin X and Y Axes with 1-Pin Arrowheads
  const minAxisX = Math.max(2, toPinX(xMin));
  const maxAxisX = Math.min(widthPins - 3, toPinX(xMax));
  const minAxisY = Math.max(2, toPinY(yMax));
  const maxAxisY = Math.min(heightPins - 3, toPinY(yMin));

  // X-Axis (row = originPinY)
  if (originPinY >= 0 && originPinY < heightPins) {
    for (let px = minAxisX; px <= maxAxisX; px++) {
      setPin(px, originPinY);
    }
    // X-Axis Arrowhead at maxAxisX
    setPin(maxAxisX - 1, originPinY - 1);
    setPin(maxAxisX, originPinY);
    setPin(maxAxisX - 1, originPinY + 1);
  }

  // Y-Axis (col = originPinX)
  if (originPinX >= 0 && originPinX < widthPins) {
    for (let py = minAxisY; py <= maxAxisY; py++) {
      setPin(originPinX, py);
    }
    // Y-Axis Arrowhead at minAxisY (top)
    setPin(originPinX - 1, minAxisY + 1);
    setPin(originPinX, minAxisY);
    setPin(originPinX + 1, minAxisY + 1);
  }

  // 4. Draw 1-Pin Tick Marks
  const tickStep = scale >= 4 ? 1 : (scale >= 2 ? 2 : 5);
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += tickStep) {
    if (x === 0) continue;
    const px = toPinX(x);
    if (px >= minAxisX + 1 && px <= maxAxisX - 2 && originPinY >= 0 && originPinY < heightPins) {
      setPin(px, originPinY - 1);
      setPin(px, originPinY + 1);
    }
  }

  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += tickStep) {
    if (y === 0) continue;
    const py = toPinY(y);
    if (py >= minAxisY + 2 && py <= maxAxisY - 1 && originPinX >= 0 && originPinX < widthPins) {
      setPin(originPinX - 1, py);
      setPin(originPinX + 1, py);
    }
  }

  // 5. Draw Continuous Function Curves (Bresenham's Line Algorithm)
  const drawBresenhamLine = (x0, y0, x1, y1, pattern = 'solid') => {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let stepCount = 0;

    while (true) {
      let draw = true;
      if (pattern === 'dashed') {
        draw = (stepCount % 5) < 3; // 3 pins on, 2 pins off
      } else if (pattern === 'dotted') {
        draw = (stepCount % 3) === 0; // 1 pin on, 2 pins off
      }
      if (draw) setPin(x0, y0);
      stepCount++;

      if (x0 === x1 && y0 === y1) break;
      let e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };

  const PATTERNS = ['solid', 'dashed', 'dotted', 'solid'];
  curves.forEach((curve, curveIdx) => {
    const pattern = PATTERNS[curveIdx % PATTERNS.length];
    let prevPx = null;
    let prevPy = null;

    // High density sampling (0.2 pin step in x)
    const pinSampleStep = 0.25 / scale;
    for (let x = xMin; x <= xMax + 0.001; x += pinSampleStep) {
      const y = evaluateFunction(curve.expr, x);
      if (y !== null && isFinite(y) && y >= yMin - 2 && y <= yMax + 2) {
        const px = toPinX(x);
        const py = toPinY(y);
        if (prevPx !== null && prevPy !== null) {
          // Connect consecutive points with Bresenham line
          drawBresenhamLine(prevPx, prevPy, px, py, pattern);
        } else {
          setPin(px, py);
        }
        prevPx = px;
        prevPy = py;
      } else {
        prevPx = null;
        prevPy = null;
      }
    }
  });

  // 6. Points of Interest Markers (Roots & Extrema)
  if (opts.showPoints !== false) {
    pointsOfInterest.forEach((poi) => {
      const px = toPinX(poi.x);
      const py = toPinY(poi.y);
      if (px >= 2 && px < widthPins - 2 && py >= 2 && py < heightPins - 2) {
        if (poi.type === 'root') {
          // Solid cross/diamond root marker
          setPin(px, py);
          setPin(px - 1, py);
          setPin(px + 1, py);
          setPin(px, py - 1);
          setPin(px, py + 1);
        } else {
          // Hollow ring vertex marker
          setPin(px - 1, py - 1);
          setPin(px, py - 1);
          setPin(px + 1, py - 1);
          setPin(px - 1, py + 1);
          setPin(px, py + 1);
          setPin(px + 1, py + 1);
          setPin(px - 1, py);
          setPin(px + 1, py);
          clearPin(px, py);
        }
      }
    });
  }

  // 7. Inject Standard Discrete Braille Cells for 'y' and 'x' Labels with Cleared Halo
  const drawBrailleLabel = (startPx, startPy, textOrChars) => {
    const str = typeof textOrChars === 'string' ? textOrChars : String.fromCharCode(textOrChars);
    const chars = Array.from(str);

    chars.forEach((ch, idx) => {
      const mask = charToDotMask(ch);
      const px = startPx + (idx * 3); // 2 pins for cell + 1 pin blank column spacer
      const py = startPy;

      if (px < 0 || px >= widthPins - 1 || py < 0 || py >= heightPins - 3) return;

      // Clear a 1-pin protective gutter around the cell
      for (let dy = -1; dy <= 4; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          clearPin(px + dx, py + dy);
        }
      }

      // Set discrete Braille dots (1 pin per dot)
      if (mask & 0x01) setPin(px, py);           // Dot 1
      if (mask & 0x02) setPin(px, py + 1);       // Dot 2
      if (mask & 0x04) setPin(px, py + 2);       // Dot 3
      if (mask & 0x08) setPin(px + 1, py);       // Dot 4
      if (mask & 0x10) setPin(px + 1, py + 1);   // Dot 5
      if (mask & 0x20) setPin(px + 1, py + 2);   // Dot 6
      if (mask & 0x40) setPin(px, py + 3);       // Dot 7
      if (mask & 0x80) setPin(px + 1, py + 3);   // Dot 8
    });
  };

  const drawBrailleCell = (cellCol, cellRow, charOrMask) => {
    drawBrailleLabel(cellCol * 2, cellRow * 4, charOrMask);
  };

  if (opts.showBrailleLabels !== false) {
    // Braille 'y' (⠽) placed at cell above Y-axis
    const yCellCol = Math.max(0, Math.min(numCellsW - 1, Math.floor((originPinX + 2) / 2)));
    drawBrailleCell(yCellCol, 0, '⠽');

    // Braille 'x' (⠭) placed at cell to the right of X-axis
    const xCellRow = Math.max(0, Math.min(numCellsH - 1, Math.floor((originPinY - 4) / 4)));
    drawBrailleCell(numCellsW - 1, xCellRow, '⠭');
  }

  // 8. Convert 60x40 Pin Grid to 300-Byte Matrix (30 cols x 10 rows)
  const matrix = new Uint8Array(numCellsW * numCellsH);
  for (let cellRow = 0; cellRow < numCellsH; cellRow++) {
    for (let cellCol = 0; cellCol < numCellsW; cellCol++) {
      const px = cellCol * 2;
      const py = cellRow * 4;

      const d1 = getPin(px, py);
      const d2 = getPin(px, py + 1);
      const d3 = getPin(px, py + 2);
      const d4 = getPin(px + 1, py);
      const d5 = getPin(px + 1, py + 1);
      const d6 = getPin(px + 1, py + 2);
      const d7 = getPin(px, py + 3);
      const d8 = getPin(px + 1, py + 3);

      const mask = (d1 << 0) | (d2 << 1) | (d3 << 2) | (d4 << 3) |
                   (d5 << 4) | (d6 << 5) | (d7 << 6) | (d8 << 7);
      matrix[cellRow * numCellsW + cellCol] = mask;
    }
  }

  const brailleLine = formatUebMathLine(eqList, pointsOfInterest);

  return {
    matrix,
    brailleLine,
    widthPins,
    heightPins,
    pins,
    xDomain: [xMin, xMax],
    yDomain: [yMin, yMax],
    pointsOfInterest
  };
}

/**
 * Generates a complete tactile SVG plot from a LaTeX/math expression or multi-curve list.
 * Supports multiple curves (e.g. "x^2 - 4, 2x + 1"), automatic points of interest (roots/extrema),
 * strictly isotropic 1:1 aspect ratio, and custom device adaptations:
 * - ViewPlus Tiger / APH PixBlaster: 8-Height 3D elevation palette (Heights 7, 5, 3, 6, 4) with 3D tactile relief.
 * - Index Braille: 1-bit mechanical dot matrix with BANA line styles (Solid, Dashed, Dotted, Dash-Dot) and BANA Key.
 * - Swell Paper: Carbon-black vector outlines with 25mm binding clearance and protective halos.
 * - DotPad 320 & Monarch: Direct discrete 60x40 / 64x40 pin matrix generation + 20-cell UEB Math reading row.
 * - Text Embossers: Formatted mathematical summary with root/vertex table for transcriber note mode.
 * 
 * @param {string} latexOrExpr - Formula string e.g. "x^2 - 4" or "x^2 - 4, 2x + 1"
 * @param {Object} [opts] - Plotting options
 * @returns {{ svg: string, title: string, xDomain: [number, number], yDomain: [number, number], matrix: Uint8Array, brailleLine: string, textSummary: string, warnings: string[] }}
 */
export function plotTactileFunction(latexOrExpr, opts = {}) {
  const eqList = String(latexOrExpr || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!eqList.length) eqList.push('x');

  const targetDevice = opts.targetDevice || opts.embosser || 'dotpad';
  const isDotpad = targetDevice === 'dotpad';
  const isMonarch = targetDevice === 'monarch';
  const isTiger = targetDevice === 'viewplus' || targetDevice === 'tiger' || targetDevice === 'aph';
  const isSwell = targetDevice === 'swell' || targetDevice === 'piaf';
  const isIndex = targetDevice === 'index';
  const isDisplay = isDotpad || isMonarch;

  // Generate the discrete pin matrix first for true mathematical ground truth
  const pinPlot = plotFunctionToPinGrid(latexOrExpr, {
    widthPins: isMonarch ? 64 : 60,
    heightPins: 40,
    xMin: opts.xMin,
    xMax: opts.xMax,
    yMin: opts.yMin,
    yMax: opts.yMax,
    autoScaleY: opts.autoScaleY !== false,
    showPoints: opts.showPoints !== false,
    showBrailleLabels: true,
  });

  const [xMin, xMax] = pinPlot.xDomain;
  const [yMin, yMax] = pinPlot.yDomain;

  const showKey = opts.showKey !== false && (eqList.length > 1 || opts.showKey === true);
  const showPoints = opts.showPoints !== false;
  // Dynamic tactile displays suppress background grid lines to avoid clutter; paper embossers show light grid
  const showGrid = typeof opts.showGrid === 'boolean' ? opts.showGrid : !isDisplay;
  const showNumbers = typeof opts.showNumbers === 'boolean' ? opts.showNumbers : !isDisplay;

  // Dimensions tailored to device physical page/cell geometry
  let width = opts.width;
  let baseHeight = opts.height;
  let margin = opts.margin;

  if (!width) {
    if (isMonarch) width = 440;
    else if (isDotpad) width = 420;
    else if (isTiger) width = 460;
    else if (isIndex) width = 450;
    else width = 420;
  }
  if (!baseHeight) {
    if (isDisplay) baseHeight = 280;
    else if (isTiger) baseHeight = 320;
    else baseHeight = 300;
  }
  if (typeof margin !== 'number') {
    if (isSwell) margin = 40; // 25mm binding clearance
    else if (isDisplay) margin = 28;
    else margin = 36;
  }

  const keyHeight = showKey ? (eqList.length * 28 + 20) : 0;
  const height = baseHeight + keyHeight;

  const plotBoxW = width - 2 * margin;
  const plotBoxH = baseHeight - 2 * margin;

  // STRICT 1:1 ISOTROPIC ASPECT RATIO
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const maxScaleX = plotBoxW / xRange;
  const maxScaleY = plotBoxH / yRange;
  const unitScale = Math.min(maxScaleX, maxScaleY);

  const actualPlotW = xRange * unitScale;
  const actualPlotH = yRange * unitScale;
  const offsetX = margin + (plotBoxW - actualPlotW) / 2;
  const offsetY = margin + (plotBoxH - actualPlotH) / 2;

  const toScreenX = (x) => offsetX + (x - xMin) * unitScale;
  const toScreenY = (y) => offsetY + (yMax - y) * unitScale;

  const originX = Math.max(offsetX, Math.min(offsetX + actualPlotW, toScreenX(0)));
  const originY = Math.max(offsetY, Math.min(offsetY + actualPlotH, toScreenY(0)));

  // Device-specific curve styles
  let CURVE_STYLES = [];
  if (isTiger) {
    // ViewPlus Tiger 8-Height 3D Topography Palette (distinct tactile heights)
    CURVE_STYLES = [
      { stroke: '#000000', strokeWidth: '3.6', dash: '', linecap: 'round', name: 'Height 7 (Solid Black)' },
      { stroke: '#2563eb', strokeWidth: '3.4', dash: '', linecap: 'round', name: 'Height 5 (Royal Blue)' },
      { stroke: '#16a34a', strokeWidth: '3.2', dash: '', linecap: 'round', name: 'Height 3 (Green)' },
      { stroke: '#dc2626', strokeWidth: '3.4', dash: '', linecap: 'round', name: 'Height 6 (Crimson)' },
      { stroke: '#0d9488', strokeWidth: '3.2', dash: '', linecap: 'round', name: 'Height 4 (Teal)' },
    ];
  } else {
    // Standard BANA tactile line styles for 1-bit embossers & displays
    CURVE_STYLES = [
      { stroke: '#000000', strokeWidth: isDisplay ? '3.0' : '2.8', dash: '', linecap: 'round', name: 'Solid' },
      { stroke: '#000000', strokeWidth: isDisplay ? '2.8' : '2.6', dash: '8,5', linecap: 'butt', name: 'Dashed' },
      { stroke: '#000000', strokeWidth: isDisplay ? '2.8' : '2.6', dash: '2,6', linecap: 'round', name: 'Dotted' },
      { stroke: '#000000', strokeWidth: isDisplay ? '2.8' : '2.6', dash: '9,4,2,4', linecap: 'butt', name: 'Dash-Dot' },
    ];
  }

  // 1. Build Grid, Ticks, and Axis Labels
  let gridSvg = '';
  let ticksSvg = '';
  let labelsSvg = '';

  const gridStroke = isTiger ? '#e2e8f0' : '#cccccc';
  const gridDash = isIndex ? '2,6' : '3,3';

  const xTickStep = Math.max(1, Math.round(xRange / 6));
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += xTickStep) {
    if (x === 0) continue;
    const sx = toScreenX(x);
    if (showGrid) {
      gridSvg += `<line x1="${sx.toFixed(1)}" y1="${offsetY.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(offsetY + actualPlotH).toFixed(1)}" stroke="${gridStroke}" stroke-width="0.8" stroke-dasharray="${gridDash}" />`;
    }
    ticksSvg += `<line x1="${sx.toFixed(1)}" y1="${(originY - 4).toFixed(1)}" x2="${sx.toFixed(1)}" y2="${(originY + 4).toFixed(1)}" stroke="#000000" stroke-width="1.6" />`;
    if (showNumbers) {
      labelsSvg += `<text x="${sx.toFixed(1)}" y="${(originY + 18).toFixed(1)}" text-anchor="middle" font-size="11px" fill="#000000">${x}</text>`;
    }
  }

  const yTickStep = Math.max(1, Math.round(yRange / 6));
  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += yTickStep) {
    if (y === 0) continue;
    const sy = toScreenY(y);
    if (showGrid) {
      gridSvg += `<line x1="${offsetX.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(offsetX + actualPlotW).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="${gridStroke}" stroke-width="0.8" stroke-dasharray="${gridDash}" />`;
    }
    ticksSvg += `<line x1="${(originX - 4).toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(originX + 4).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#000000" stroke-width="1.6" />`;
    if (showNumbers) {
      labelsSvg += `<text x="${(originX - 12).toFixed(1)}" y="${(sy + 4).toFixed(1)}" text-anchor="end" font-size="11px" fill="#000000">${y}</text>`;
    }
  }

  // BANA 6.5.1: Origin labeled in Quadrant III (bottom-left of axis intersection)
  if (showNumbers && xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
    labelsSvg += `<text x="${(originX - 8).toFixed(1)}" y="${(originY + 16).toFixed(1)}" text-anchor="end" font-size="11px" fill="#000000">0</text>`;
  }

  // 2. Build Axes with Clean Proportional Arrowheads
  const axesSvg = `
    <!-- X-Axis -->
    <line x1="${(offsetX - 6).toFixed(1)}" y1="${originY.toFixed(1)}" x2="${(offsetX + actualPlotW + 8).toFixed(1)}" y2="${originY.toFixed(1)}" stroke="#000000" stroke-width="2.0" stroke-linecap="round" />
    <polygon points="${(offsetX + actualPlotW + 12).toFixed(1)},${originY.toFixed(1)} ${(offsetX + actualPlotW + 6).toFixed(1)},${(originY - 3).toFixed(1)} ${(offsetX + actualPlotW + 6).toFixed(1)},${(originY + 3).toFixed(1)}" fill="#000000" />
    <text x="${(offsetX + actualPlotW + 16).toFixed(1)}" y="${(originY + 4).toFixed(1)}" font-size="12px" font-weight="bold" fill="#000000">x</text>

    <!-- Y-Axis -->
    <line x1="${originX.toFixed(1)}" y1="${(offsetY + actualPlotH + 6).toFixed(1)}" x2="${originX.toFixed(1)}" y2="${(offsetY - 8).toFixed(1)}" stroke="#000000" stroke-width="2.0" stroke-linecap="round" />
    <polygon points="${originX.toFixed(1)},${(offsetY - 12).toFixed(1)} ${(originX - 3).toFixed(1)},${(offsetY - 6).toFixed(1)} ${(originX + 3).toFixed(1)},${(offsetY - 6).toFixed(1)}" fill="#000000" />
    <text x="${originX.toFixed(1)}" y="${(offsetY - 16).toFixed(1)}" text-anchor="middle" font-size="12px" font-weight="bold" fill="#000000">y</text>
  `;

  // 3. Build Curves and Points of Interest
  let curvesSvg = '';
  let poiSvg = '';
  const numSamples = 240;
  const sampleStep = xRange / numSamples;
  const curvesMeta = [];

  eqList.forEach((eqStr, curveIdx) => {
    const expr = latexToMathJs(eqStr);
    const style = CURVE_STYLES[curveIdx % CURVE_STYLES.length];
    curvesMeta.push({ raw: eqStr, style: style.name });

    let curvePathD = '';
    let inSegment = false;

    for (let i = 0; i <= numSamples; i++) {
      const x = xMin + i * sampleStep;
      const y = evaluateFunction(expr, x);
      if (y !== null && isFinite(y) && y >= yMin - 10 && y <= yMax + 10) {
        const sx = toScreenX(x).toFixed(1);
        const sy = toScreenY(y).toFixed(1);
        if (!inSegment) {
          curvePathD += `M ${sx} ${sy} `;
          inSegment = true;
        } else {
          curvePathD += `L ${sx} ${sy} `;
        }
      } else {
        inSegment = false;
      }
    }

    const dashAttr = style.dash ? `stroke-dasharray="${style.dash}"` : '';
    curvesSvg += `<path d="${curvePathD.trim()}" fill="none" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linecap="${style.linecap}" stroke-linejoin="round" ${dashAttr} />`;
  });

  if (showPoints) {
    pinPlot.pointsOfInterest.forEach((poi) => {
      if (poi.x >= xMin && poi.x <= xMax && poi.y >= yMin && poi.y <= yMax) {
        const px = toScreenX(poi.x).toFixed(1);
        const py = toScreenY(poi.y).toFixed(1);
        if (poi.type === 'root') {
          poiSvg += `<circle cx="${px}" cy="${py}" r="3.6" fill="#000000" />`;
        } else {
          poiSvg += `<circle cx="${px}" cy="${py}" r="3.6" fill="#ffffff" stroke="#000000" stroke-width="2.0" />`;
        }
      }
    });
  }

  // 4. Build BANA Key (if multi-curve)
  let keySvg = '';
  if (showKey) {
    let keyItemsSvg = '';
    let startY = baseHeight + 10;
    keyItemsSvg += `<text x="${margin}" y="${startY}" font-size="12px" font-weight="bold" fill="#000000">Key:</text>`;
    curvesMeta.forEach((curve, ki) => {
      const itemY = startY + (ki + 1) * 22;
      const style = CURVE_STYLES[ki % CURVE_STYLES.length];
      const dashAttr = style.dash ? `stroke-dasharray="${style.dash}"` : '';
      const sampleLine = `<line x1="${margin}" y1="${itemY - 4}" x2="${margin + 32}" y2="${itemY - 4}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linecap="${style.linecap}" ${dashAttr} />`;
      const cleanEq = curve.raw.replace(/^(y\s*=|f\(x\)\s*=)\s*/i, '');
      const labelText = `<text x="${margin + 40}" y="${itemY}" font-size="11px" fill="#000000">y = ${cleanEq} (${style.name})</text>`;
      keyItemsSvg += `${sampleLine}${labelText}`;
    });
    keySvg = `<g class="tactile-key" role="region" aria-label="Tactile Key">${keyItemsSvg}</g>`;
  }

  // Pack precomputed DotPad cell matrix into hex string attribute
  const matrixHex = Array.from(pinPlot.matrix, (b) => b.toString(16).padStart(2, '0')).join('');

  // 5. Assemble Full Raw SVG
  const rawSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-dotpad-matrix="${matrixHex}" data-braille-line="${pinPlot.brailleLine}">
      <!-- Grid -->
      <g class="tactile-grid">${gridSvg}</g>
      <!-- Axes & Ticks -->
      <g class="tactile-axes">${axesSvg}${ticksSvg}</g>
      <!-- Function Curves -->
      <g class="tactile-curves">${curvesSvg}</g>
      <!-- Points of Interest -->
      <g class="tactile-poi">${poiSvg}</g>
      <!-- Labels -->
      <g class="tactile-labels">${labelsSvg}</g>
      <!-- BANA Key -->
      ${keySvg}
    </svg>
  `.trim();

  const transpiled = transpileTactileSvg(rawSvg, {
    brailleCode: opts.brailleCode || 'en-ueb-g2',
    applyTextures: true,
    translateLabels: true,
    translator: opts.translator,
  });

  // 6. Generate Complete Text Summary for Transcriber's Note Mode
  const rootStr = pinPlot.pointsOfInterest.filter((p) => p.type === 'root').map((p) => `x = ${p.x.toFixed(2)}`).join(', ') || 'None';
  const vertexStr = pinPlot.pointsOfInterest.filter((p) => p.type === 'extrema').map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`).join(', ') || 'None';
  const textSummary = `[Graph of ${eqList.join(', ')}. Domain: [${xMin}, ${xMax}], Range: [${yMin}, ${yMax}]. Roots: ${rootStr}. Vertex/Extrema: ${vertexStr}.]`;

  const displayTitle = `Graph of ${eqList.map((e) => `y = ${e.replace(/^(y\s*=|f\(x\)\s*=)\s*/i, '')}`).join(' and ')}`;

  return {
    svg: transpiled.svg,
    title: displayTitle,
    xDomain: [xMin, xMax],
    yDomain: [yMin, yMax],
    curves: curvesMeta,
    matrix: pinPlot.matrix,
    brailleLine: pinPlot.brailleLine,
    textSummary,
    warnings: transpiled.warnings || [],
  };
}
